# Unshadowable scaffolding builtins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a user `fn` named `head`/`tail`/`cons` from capturing the defunctionalizer's own synthesized builtin calls — a **silent miscompile that predates this branch** and that the BOTH slice widened from a clean rejection into a wrong answer.

**Architecture:** `defunc` synthesizes `head($clos)`, `tail($env)` and `cons(tag, env)` using the *bare* builtin names. `lower_asm` resolves a bound user function **before** falling back to the builtin table (`lower_asm.rs:459`), so a user `fn head` shadows the builtin at every call site — including scaffolding the user never wrote. Fix: give the scaffolding `$`-prefixed aliases (`$cons`/`$head`/`$tail`) that resolve to the same builtins. `$` is unforgeable — the lexer rejects it in user identifiers — so scaffolding becomes uncapturable while user code keeps normal shadowing semantics. This follows the **proven** `$box`/`$box_get`/`$box_set` pattern already in the tree.

**Tech Stack:** Rust edition 2024, `redextape-core`. No new dependencies, no new `Instr`, no δ-layer change.

## Global Constraints

- Rust edition 2024, `max_width = 120`, `use_small_heuristics = "Max"`.
- CI gates: `cargo fmt --all --check`; `cargo clippy --workspace --all-targets -- -D warnings`; `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`.
- **No panics on any input.** `defunc`/`lower_asm` stay TOTAL — degrade to `LowerError::Unsupported`, never `expect`/`unwrap`/index-panic.
- **Never miscompile > always accept.**
- **No output NodeId may be carried by two nodes** (`no_output_node_id_is_duplicated` is the guard).
- The `$`-prefixed aliases are **runtime-and-lowering only**: they must NOT enter the typecheck env or `prelude::BUILTIN_NAMES`, exactly as `$box*` does not. User source can never name them.

---

## The defect, measured

At the merge base `3246742`, with **no BOTH function involved**:

```
fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)
   reference = 5     λ = 5     TM = 3        <-- silent wrong answer
```

Mechanism, confirmed by reading the source:
1. `dispatcher` synthesizes `head($clos)` for its tag test (and `tail($env)` when an arm has captures); `rewrite_value_name` synthesizes `cons(tag, nil)`.
2. `topo_order`'s `collect_calls` reads those synthetic `Apply(Var("head"), …)` nodes as calls to the user's same-named `fn`, so it emits the user function **outer** of `$applyN`.
3. `lower_asm.rs:459` — `if let Some(info) = ctx.resolve_fn(fname)` — prefers a bound function over the builtin table, so inside the dispatcher `head` now means the user's function.

What the BOTH slice changed: programs in this shape that *also* make the function BOTH were previously a clean `Unsupported`. Three measured cases now return a wrong value, `HitCap`, or a fault instead.

**Why the alias fixes both halves.** Step 3 stops because `$head` is not a user function name. Step 2 stops for the same reason — `collect_calls` finds no matching emitted name, so no spurious edge is created and the ordering hazard disappears with it.

**Why not simply reject a user `fn` named after a builtin.** That was considered and declined: it leaves the root cause (scaffolding using capturable names) in place, and it removes a program class the reference and λ both accept — a *new* oracle asymmetry, which is the exact thing the BOTH slice existed to close.

---

### Task 1: `$`-prefixed builtin aliases

**Files:**
- Modify: `crates/redextape-core/src/prelude.rs` (the runtime env — the list containing `("$box".into(), Value::Builtin(Builtin::Box))`)
- Modify: `crates/redextape-core/src/tm/lower_asm.rs` (`lower_builtin_apply`'s arity table and dispatch `match`)
- Test: `crates/redextape-core/src/tm/lower_asm.rs` (its `mod tests`)

**Interfaces:**
- Consumes: `Builtin::{Cons, Head, Tail}`, `Value::Builtin`, `Instr::{Cons, Head, Tail}`.
- Produces: `$cons` (arity 2), `$head` (arity 1), `$tail` (arity 1) — usable anywhere the bare names are, on both the reference interpreter and the asm/TM/native path, with identical behaviour including faults.

**Scope note:** add aliases ONLY for the three names `defunc` actually synthesizes. `is_empty` is never synthesized, so it gets no alias — and Task 2's test pins that fact so a future synthesizer of `is_empty` fails loudly rather than silently reintroducing this bug.

- [ ] **Step 1: Write the failing test**

Add to `lower_asm.rs`'s `mod tests`. It asserts the alias is a true alias — same value, same fault behaviour — rather than merely "runs":

```rust
    /// `$cons`/`$head`/`$tail` are aliases for the bare builtins, existing so `defunc`'s synthesized
    /// scaffolding cannot be captured by a user `fn` of the same name (`$` is unforgeable in user
    /// source). An alias that behaved even slightly differently would be worse than the bug it fixes,
    /// so pin equivalence on both a value and a fault.
    #[test]
    fn dollar_aliases_match_their_bare_builtins() {
        for (bare, dollar) in [("cons(7, nil)", "$cons(7, nil)"), ("head(cons(7, nil))", "$head(cons(7, nil))")] {
            let want = run_asm_str(bare);
            let got = run_asm_str(dollar);
            assert_eq!(got, want, "`{dollar}` must behave exactly as `{bare}`");
        }
    }
```

Use whatever helper this module already provides for "lower this source and run it on the asm interpreter"; if none exists with that exact shape, build the `Core` the same way the neighbouring tests in this file do and compare the resulting `Value`s. Do NOT add a new public API for the test's convenience.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --lib dollar_aliases_match_their_bare_builtins`
Expected: FAIL — `call of unknown function `$cons`` from `lower_builtin_apply`'s `_ =>` arm.

- [ ] **Step 3: Add the aliases to the runtime env**

In `prelude.rs`, beside the existing `$box*` entries, add three more mapping to the SAME `Builtin` variants the bare names use — they are aliases, not new operations:

```rust
        // `defunc` synthesizes closure scaffolding (`$applyN`'s tag test, the `cons(tag, env)`
        // representation) and must not have those calls captured by a user `fn` of the same name.
        // `$` is unforgeable in user source, so these aliases are uncapturable. Same `Builtin`
        // variants as the bare names — identical behaviour, including faults. Runtime env ONLY:
        // like `$box*`, they must never enter the typecheck env or `BUILTIN_NAMES`, because they
        // appear only in `defunc`'s output, which is lowered but never typechecked.
        ("$cons".into(), Value::Builtin(Builtin::Cons)),
        ("$head".into(), Value::Builtin(Builtin::Head)),
        ("$tail".into(), Value::Builtin(Builtin::Tail)),
```

- [ ] **Step 4: Add the aliases to `lower_builtin_apply`**

In `lower_asm.rs`, extend the arity table and the dispatch `match` so each alias lowers to the identical `Instr` as its bare name:

```rust
    let expected_arity = match name {
        "cons" | "$cons" => 2,
        "head" | "tail" | "is_empty" => 1,
        "$head" | "$tail" => 1,
        "$box" | "$box_get" => 1,
        "$box_set" => 2,
        _ => return Err(LowerError::Unsupported { node: id, what: format!("call of unknown function `{name}`") }),
    };
```

and in the dispatch:

```rust
        "cons" | "$cons" => ctx.emit(Instr::Cons(dst, regs[0], regs[1])),
        "head" | "$head" => ctx.emit(Instr::Head(dst, regs[0])),
        "tail" | "$tail" => ctx.emit(Instr::Tail(dst, regs[0])),
```

- [ ] **Step 5: Run the tests**

Run: `cargo test -p redextape-core --lib` then `cargo test --workspace`
Expected: PASS, including the new test and every existing one — nothing else should move, since no existing code emits the new names yet.

- [ ] **Step 6: Sabotage-verify the alias is really an alias**

Temporarily make `$head` lower to `Instr::Tail` instead of `Instr::Head`.
Run: `cargo test -p redextape-core --lib dollar_aliases_match_their_bare_builtins`
Expected: FAIL, comparing `$head(cons(7, nil))` against `head(cons(7, nil))`.
Then revert and re-run to confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/prelude.rs crates/redextape-core/src/tm/lower_asm.rs
git commit -m "feat(tm): \$cons/\$head/\$tail aliases for uncapturable scaffolding"
```

---

### Task 2: Emit the aliases from `defunc`'s scaffolding, and close the miscompile

**Files:**
- Modify: `crates/redextape-core/src/tm/defunc.rs` (the `cons`/`head1`/`tail1` synthesis helpers)
- Test: `crates/redextape-core/src/tm/defunc.rs` (its `mod tests`)
- Modify: `crates/redextape-core/tests/three_way_oracle.rs` and `crates/redextape-native/tests/native_oracle.rs` (`FIRST_ORDER_DEMOS`, both copies)

**Interfaces:**
- Consumes: Task 1's `$cons`/`$head`/`$tail`.
- Produces: `defunc` output in which every synthesized list operation uses a `$`-prefixed name; user-written `cons`/`head`/`tail` calls are untouched and keep their own ids.

**The critical distinction:** only *synthesized* calls change. A user's own `head(xs)` flows through `rewrite_apply`'s `is_static` branch and keeps its original `Var` name and id. The helpers `cons`, `head1`, `tail1` in `defunc.rs` are scaffolding-only constructors — verify that before changing them, and report if any is reachable from user code.

- [ ] **Step 1: Write the failing test**

```rust
    /// A user `fn` named after a list builtin must not capture `defunc`'s own scaffolding. Before the
    /// `$`-alias fix this MISCOMPILED SILENTLY: `lower_asm` resolves a bound function before the
    /// builtin table, so the dispatcher's synthesized `head($clos)` tag test resolved to the user's
    /// `head`. Measured at 3246742: reference 5, λ 5, TM 3.
    #[test]
    fn a_user_fn_named_like_a_builtin_does_not_capture_scaffolding() {
        for src in [
            "fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",
            "fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)",
            "fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)",
            "fn tail(x) { x + 1 } fn ap(g, x) { g(x) } tail(1) + ap(tail, 2)",
        ] {
            defunc_preserves_and_lowers(src);
        }
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --lib a_user_fn_named_like_a_builtin_does_not_capture_scaffolding`
Expected: FAIL. Record the exact failure for each of the four programs — they are reported to differ (wrong value, `HitCap`, fault), and the report must say which did what.

- [ ] **Step 3: Switch the synthesis helpers to the aliases**

In `defunc.rs`, change the *emitted name* in the `cons`, `head1` and `tail1` helpers from `"cons"`/`"head"`/`"tail"` to `"$cons"`/`"$head"`/`"$tail"`. Add a comment at each explaining that the `$` form is uncapturable and why that matters. Do not change the helpers' signatures or their call sites.

Then check `is_builtin_fn`/`BUILTIN_FNS`: determine by test whether the aliases need to be listed there. `BUILTIN_FNS` is consulted for USER names (via `rewrite_apply`'s `is_static` and `rewrite_value_name`'s "builtin used as a value" rejection), and synthesized calls are constructed directly rather than routed through `rewrite_apply` — so the aliases may not belong there at all. Add them only if a test demonstrates they are needed, and say in your report which way it went and what demonstrated it.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p redextape-core --lib` then `cargo test --workspace`
Expected: PASS. If any step-count golden moves, STOP and report it rather than re-blessing — the emitted name changes but the emitted `Instr` stream should be identical, so goldens should not move. A moved golden means something other than the name changed.

- [ ] **Step 5: Add oracle coverage in both lists**

Append to `FIRST_ORDER_DEMOS` in BOTH `crates/redextape-core/tests/three_way_oracle.rs` and `crates/redextape-native/tests/native_oracle.rs` (they are separate crates, each with its own hand-maintained copy):

```rust
    // A user `fn` shadowing a list builtin. `defunc` synthesizes `$head($clos)` for its dispatcher
    // tag test, and `lower_asm` resolves a bound function BEFORE the builtin table — so with the
    // bare name this silently miscompiled (measured at 3246742: reference 5, λ 5, TM 3). The `$`
    // form is unforgeable in user source, so scaffolding is uncapturable. 2 + 3 = 5.
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",
    // The same shadowing where the shadowing function is ALSO the value being dispatched. 2 + 3 = 5.
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)",
```

- [ ] **Step 6: Run both oracles**

Run: `cargo test -p redextape-core --test three_way_oracle` and `cargo test -p redextape-native --test native_oracle`
Expected: PASS — `reference == λ == TM == native` on programs that miscompiled before this task.

- [ ] **Step 7: Sabotage-verify the oracle demos are non-vacuous**

Temporarily revert `head1`'s emitted name to `"head"`. Re-run both oracle suites.
Expected: FAIL on the new demos, with a value mismatch rather than a `LowerError`. Quote it. Revert and confirm green.

- [ ] **Step 8: Pin that `is_empty` has no alias, deliberately**

```rust
    /// `is_empty` deliberately has NO `$` alias: `defunc` never synthesizes it, and an unused alias is
    /// a name that later drifts out of sync with the thing it aliases. If a future change starts
    /// synthesizing `is_empty`, this fails and points at the decision instead of silently
    /// reintroducing the capture bug this slice fixed.
    #[test]
    fn defunc_synthesizes_no_unaliased_builtin_call() {
        let src = "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
                   fn add1(x) { x + 1 }\n\
                   [3, 1, 2].map(add1)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "{ds:?}");
        let core = desugar(&prog.unwrap());
        let (d, synthetic) = defunc_mapped(&core).expect("defunc succeeds");
        // Every `Apply` of a bare list-builtin name in the output must come from a node the USER
        // wrote (not in `synthetic`). A synthesized one would be capturable.
        let mut stack = vec![&d];
        while let Some(node) = stack.pop() {
            if let Core::Apply(id, callee, _) = node
                && let Core::Var(_, name) = callee.as_ref()
                && matches!(name.as_str(), "cons" | "head" | "tail" | "is_empty")
            {
                assert!(!synthetic.contains(id), "synthesized call to bare `{name}` at {id} is capturable");
            }
            push_children(node, &mut stack);
        }
    }
```

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/src/tm/defunc.rs crates/redextape-core/tests/three_way_oracle.rs \
        crates/redextape-native/tests/native_oracle.rs
git commit -m "fix(tm): synthesize scaffolding with \$-prefixed builtins, closing a silent miscompile

A user fn named head/tail/cons captured defunc's own synthesized calls,
because lower_asm resolves a bound function before the builtin table. This
predates the BOTH slice; that slice widened it from a clean rejection into
a wrong answer. Measured at 3246742: reference 5, lambda 5, TM 3."
```

---

### Task 3: Correct the boundary rule, and close the review's remaining Minors

**Files:**
- Modify: `crates/redextape-core/src/tm/defunc.rs` (module header, ~lines 24-31)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the BOTH prerequisite note)
- Modify: `docs/superpowers/plans/2026-07-25-defunc-both-called-and-value-used.md` (its stale line citations)
- Modify: `crates/redextape-native/tests/native_oracle.rs` (the one missing demo)

**Interfaces:** documentation and test data only; no code behaviour changes.

- [ ] **Step 1: Fix the module header's boundary rule**

The header currently states the BOTH boundary as "unless its own body applies a value at its OWN arity" and illustrates it with `fn ap(g,y){g(y)} fn f(x){ if x==0 {0} else { ap(f,x-1)+2 } } f(3)`. **That example does not exhibit the stated rule** — `f`'s body applies no value; it *passes* `f` to `ap`, and `ap` is what dispatches. The real cycle is three nodes (`$apply1 → f → ap → $apply1`) and the error message names `ap`. The stated condition is sufficient but not necessary; this counterexample, which the rule predicts is accepted, is in fact rejected:

```
fn ap(g,y) { g(y) } fn f(x) { x + 1 } fn q(z) { ap(f, z) } q(1) + ap(q, 2)
   -> Unsupported { node: 7, what: "cyclic higher-order call graph through `ap`" }
```

Restate the rule as what it actually is — a cycle in the emitted binder graph through the BOTH function's dispatcher, i.e. the function's body *transitively* reaches a dispatcher of its own arity, directly or through another kept `fn` — and swap in an example that genuinely exhibits it:

```
fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)
```

Verify BOTH programs' actual rejection messages before writing the prose, and quote them in your report.

- [ ] **Step 2: Fix the same phrasing where it was copied**

The too-narrow rule also appears in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the devirtualization entry's prerequisite note) and in `docs/superpowers/plans/2026-07-25-defunc-both-called-and-value-used.md`. Correct both to the rule from Step 1. Leave `defunc.rs`'s in-test comment alone if it is accurate for its own program — check, and say which you found.

- [ ] **Step 3: De-line the plan doc**

`docs/superpowers/plans/2026-07-25-defunc-both-called-and-value-used.md` cites `defunc.rs:302-310`, `1053-1055`, `1585`, `1580-1581`. All have drifted (the cycle rule is now at 1080-1082; 1585 is inside a different test). Replace with construct/test/message-name anchors, as was already done for the design spec.

- [ ] **Step 4: Sync the one missing native demo**

`crates/redextape-native/tests/native_oracle.rs`'s `FIRST_ORDER_DEMOS` is missing `fold([3, 1, 2].map(add1), 0, add)` relative to the core oracle's copy (40 vs 39 entries), so that program has three-way but not four-way coverage. Add it, in the same position and with the same comment as the core copy.

- [ ] **Step 5: Verify**

Run: `cargo test --workspace && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings`
Expected: all green. Confirm the two demo lists now have equal entry counts:

```bash
for f in crates/redextape-core/tests/three_way_oracle.rs crates/redextape-native/tests/native_oracle.rs; do
  awk '/^const FIRST_ORDER_DEMOS/,/^\];/' "$f" | grep -c '^    "'
done
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(tm): state the BOTH boundary as the cycle rule it actually is

The module header's worked example did not exhibit the rule it illustrated:
that function's body applies no value, it passes itself to another fn which
dispatches. The condition was sufficient but not necessary."
```

---

## Spec coverage

| Requirement | Task |
|---|---|
| Scaffolding calls become uncapturable | Task 1 (aliases) + Task 2 (emit them) |
| Aliases behave identically to bare builtins | Task 1 steps 1, 6 |
| Aliases stay out of the typecheck env / `BUILTIN_NAMES` | Task 1 step 3 constraint; `$box*` precedent |
| The pre-existing miscompile is closed | Task 2 steps 1, 5, 6 |
| Newly-accepted BOTH programs in this shape are correct | Task 2 step 1 (cases 2-4) |
| Oracle covers it on all four backends | Task 2 steps 5, 6 |
| Non-vacuity proven by sabotage | Task 1 step 6, Task 2 step 7 |
| No future synthesizer silently reintroduces it | Task 2 step 8 |
| The BOTH boundary rule is stated correctly | Task 3 steps 1, 2 |
| Review Minors (plan line citations, native demo sync) | Task 3 steps 3, 4 |
