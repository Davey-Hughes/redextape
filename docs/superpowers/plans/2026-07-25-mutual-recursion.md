# Mutually recursive functions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mutually recursive (and forward-referencing) functions compile and run correctly on every backend, so `reference == λ == TM == native` extends to a program class that currently cannot reach any backend.

**Architecture:** Three ordered gates currently reject these programs — `typeck` binds one `fn` name at a time, `desugar` emits one `LetRec` per `fn` in source order, and `lower_asm` binds a name only before its own body. Each is fixed by generalising "one name" to "every name in an adjacent `fn` run", plus a new additive `Core::LetRecGroup` for genuine cycles. `LetRec` is left untouched and the committed step-count goldens are the proof.

**Two deliberate language changes landed in Task 3** — read these before assuming "nothing existing changes":
1. A name defined by a `fn` in a run now wins over an **enclosing** binding of the same name, and over an **earlier member of the same run**. Required so `desugar` agrees with `typeck`'s whole-run pre-binding; the alternative is a typeck/desugar disagreement, i.e. a miscompile. Matches Rust's block-scoped `fn` hoisting.
2. **Duplicate `fn` names within one adjacent run are now a static error** (`the name \`x\` is defined multiple times in the same group of functions`). Once a whole run is pre-bound, such a program has no defensible resolution — one shape typechecked as `Bool` and evaluated to `Nat`. This **rejects programs that previously ran**. Cross-run and nested shadowing remain legal.

**Tech Stack:** Rust (edition 2024), `redextape-core` only — zero dependencies, WASM-clean.

**Design spec:** `docs/superpowers/specs/2026-07-25-mutual-recursion-design.md` (read for rationale).

## Global Constraints

- **No git attribution.** Never add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any similar trailer to commit messages.
- **`redextape-core` has ZERO dependencies and must stay that way** (it is WASM-clean). Add none.
- **`LetRec` is untouched.** A singleton group is NEVER constructed, and a program containing no mutually recursive or forward-referencing `fn` must lower identically. Two classes DO change deliberately — duplicate `fn` names in one adjacent run became a static error, and a `fn` now shadows an enclosing binding for the whole run (see Task 3). **Every committed step-count golden must remain unchanged, but that is a backstop, NOT the proof**: emitting a singleton as a one-member group leaves all five green (three contain no `fn`; the higher-order one is rebuilt as a `LetRec` by `defunc`; and `lower_function` *is* `lower_function_group(ctx, &[one])`, so a one-member group emits byte-identical asm by construction). The guards that bite are `desugar::an_independent_fn_still_lowers_as_a_plain_letrec`, `attribution_golden_add1_of_5`'s `Core::LetRec{..}` destructure, and the byte-identity corpora.
- **Totality (cardinal rule).** No `.unwrap()`/`.expect()`/panic on library paths (test/example code may panic deliberately). New recursive arms inherit the existing depth guards (`MAX_EVAL_DEPTH`, `MAX_LOWER_DEPTH`, `MAX_DEFUNC_DEPTH`) rather than re-deriving them. `Core` spines reach tens of thousands of nodes deep — which is why `Core` has a hand-written iterative `Drop` — so any new walk must be iterative and `take_core_children` MUST enumerate a group's children or teardown recurses and aborts.
- **Groups form only from ADJACENT `fn` runs.** Mutually recursive functions separated by a non-`fn` statement stay unsupported; this bound is tested and documented, not implicit.
- **The clippy gate is `cargo clippy --workspace --all-targets -- -D warnings`**, matching CI. The plain form is weaker and has let lint errors through before.
- **TM steps are unary and explode** (`sum(5)` ≈ 178k against a 5M cap) and the λ leg is step-capped. Keep every test program small; if a natural example cannot fit under a cap, **report it rather than raising the cap**.

---

## File Structure

- `crates/redextape-core/src/typeck.rs` — **modify**: pre-bind a whole adjacent `fn` run before checking any body.
- `crates/redextape-core/src/core.rs` — **modify**: `LetRecGroup` variant, `id()`, `take_core_children`.
- `crates/redextape-core/src/interp.rs` — **modify**: evaluate a group (N slots).
- `crates/redextape-core/src/desugar.rs` — **modify**: SCC + dependency-ordered emission of adjacent `fn` runs.
- `crates/redextape-core/src/lambda/lower.rs` — **modify**: tupled `fix`.
- `crates/redextape-core/src/tm/lower_asm.rs` — **modify**: bind every group name before lowering any body.
- `crates/redextape-core/src/tm/defunc.rs` — **modify**: `peel`/`push_children` handle groups.
- `crates/redextape-core/examples/step_survey.rs` — **modify**: two child-enumeration sites.
- `crates/redextape-core/tests/three_way_oracle.rs` — **modify**: the agreement cases.

## Interfaces produced (referenced across tasks)

- `Core::LetRecGroup(NodeId, Vec<(String, Core)>, Box<Core>)` — every value is a `Lambda`; every name is in scope in every value AND in the body. Constructed only when `n >= 2`.
- `desugar::fn_run_groups(stmts: &[Stmt]) -> Vec<Vec<usize>>` (Task 3) — for one adjacent `fn` run, the SCCs in dependency order (callees first). Indices are into the run.

---

### Task 1: `typeck` accepts a whole `fn` run

The first gate. Today `typeck.rs:253-259` binds each `fn` name monomorphically then checks its body, so a reference to a later `fn` is an unbound variable and the program never reaches `desugar`.

**Files:** Modify `crates/redextape-core/src/typeck.rs`

**Interfaces:** Produces: `analyze(src)` accepting mutual recursion and forward references. Consumes: nothing.

- [ ] **Step 1: Write the failing tests** in `typeck.rs`'s test module:

```rust
#[test]
fn mutually_recursive_fns_typecheck() {
    let src = "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
               fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(10)";
    assert!(crate::analyze(src).diagnostics.is_empty(), "{:?}", crate::analyze(src).diagnostics);
}

#[test]
fn a_forward_reference_without_a_cycle_typechecks() {
    // `a` calls `b`, defined after it, and `b` calls nothing — no cycle, but the same ordering gate.
    let src = "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)";
    assert!(crate::analyze(src).diagnostics.is_empty(), "{:?}", crate::analyze(src).diagnostics);
}

#[test]
fn a_fn_separated_by_a_let_still_cannot_forward_reference() {
    // The documented bound: grouping stops at a non-`fn` statement.
    let src = "fn a(n){ b(n) } let k = 1; fn b(n){ n } a(3)";
    assert!(!crate::analyze(src).diagnostics.is_empty(), "expected an unbound-name diagnostic");
}
```

Adjust `crate::analyze`'s result-field name if it differs — read `lib.rs:38`'s `analyze` and use its real shape.

- [ ] **Step 2: Run them, expect the first two to fail.**

Run: `cargo test -p redextape-core --lib typeck::`
Expected: `mutually_recursive_fns_typecheck` and `a_forward_reference_without_a_cycle_typechecks` FAIL with an unbound-name diagnostic; the third already passes.

- [ ] **Step 3: Pre-bind the run.**

In `infer_block`'s statement loop, before processing statements one at a time, scan forward from the current index for the **maximal run of consecutive `Stmt::Fn`**. For every `fn` in that run, create its `param_tys`/`ret`/`fun` and `env.insert(name, Scheme::mono(fun), false)` — *all* of them — and only then check each body in turn (each body still binds its own params, as `typeck.rs:263-265` already does).

Keep the existing per-`fn` logic for everything else: the `rec_mark`/`body_mark` discipline, the `unify(&ret, &body_ty, *span)`, and monomorphic binding. The only change is *when* the names enter the environment.

**Do not** compute SCCs here. Pre-binding the whole run is strictly more permissive than grouping and needs no graph — Task 3 does the finer analysis for lowering.

- [ ] **Step 4: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib typeck::
cargo test --workspace
```
Expected: the three new tests pass; the whole workspace stays green (this must not change any existing program's typing).

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-core/src/typeck.rs
git commit -m "feat(typeck): bind a whole adjacent fn run before checking bodies"
```

---

### Task 2: `Core::LetRecGroup` and the reference interpreter

The variant, plus the one backend that defines what it *means*. Every other `Core` match site becomes a compile error — that is the safety property; fix each minimally here (return `Unsupported`/unreachable as appropriate) so later tasks give them real behaviour.

**Files:** Modify `crates/redextape-core/src/core.rs`, `src/interp.rs`, and every site the compiler flags.

**Interfaces:** Produces `Core::LetRecGroup(NodeId, Vec<(String, Core)>, Box<Core>)`; the interpreter evaluates it.

- [ ] **Step 1: Write the failing test** in `interp.rs`'s test module, building the group by hand (nothing produces one yet):

```rust
#[test]
fn a_binding_group_lets_its_members_see_each_other() {
    // letrec is_even = \n. if n == 0 { true } else { is_odd(n-1) }
    //    and is_odd  = \n. if n == 0 { false } else { is_even(n-1) }
    // in is_even(4)
    let mut g = crate::desugar::NodeGen::default();
    let group = Core::LetRecGroup(
        g.fresh(),
        vec![
            ("is_even".into(), even_lambda(&mut g)),
            ("is_odd".into(), odd_lambda(&mut g)),
        ],
        Box::new(call(&mut g, "is_even", 4)),
    );
    assert_eq!(eval_core(&group).unwrap(), Value::Bool(true));
}
```

`even_lambda`/`odd_lambda`/`call`/`eval_core` do not exist — write them in the same test module. Read `interp.rs`'s existing tests for how they construct `Core` and invoke evaluation, and mirror that; `NodeGen`'s real path may differ, so use whatever `desugar.rs` exports.

- [ ] **Step 2: Run it, expect failure.**

Run: `cargo test -p redextape-core --lib interp::`
Expected: FAIL to compile — `Core::LetRecGroup` does not exist.

- [ ] **Step 3: Add the variant.**

In `core.rs`'s `Core` enum:

```rust
    /// Mutually recursive bindings: `letrec f1 = v1 and … and fn = vn in body`. Every value is a
    /// `Lambda`, and every name is in scope in every value AND in the body.
    ///
    /// Constructed only for a genuine group (n >= 2) — a single recursive binding stays `LetRec`, so
    /// existing programs lower identically and the step-count goldens do not move.
    LetRecGroup(NodeId, Vec<(String, Core)>, Box<Core>),
```

Add it to `Core::id()`'s match, and — **critically** — to `take_core_children` in the `Drop` impl, unlinking every binding's value and the body. Missing it there means a deep group recurses on teardown and aborts the process.

- [ ] **Step 4: Fix every compile error minimally.**

`cargo build -p redextape-core --all-targets` will name each site. Give the group real behaviour **only** in `interp.rs` (Step 5); everywhere else return the file's existing "unsupported" shape (`LowerError::Unsupported { node, what: "mutually recursive binding group" }`) or extend the walk, whichever matches that site. Expect at least: `desugar.rs`, `lambda/lower.rs`, `tm/lower_asm.rs`, `tm/defunc.rs` (including its `push_children`), `tm/attribute.rs` if it matches on `Core`, and two sites in `examples/step_survey.rs`.

**Report the full list of sites the compiler flagged** — a later review will check none was handled by a catch-all that silently swallows the variant.

- [ ] **Step 5: Evaluate the group** in `interp.rs`, generalising the existing `LetRec` arm (`interp.rs:127-136`) from one slot to N:

```rust
            Core::LetRecGroup(_, bindings, body) => {
                // Same shape as `LetRec`, N-ary: pre-bind EVERY name to a placeholder slot so each
                // value can see all the others, then evaluate the values and patch the slots.
                let mut env2 = env.clone();
                let mut slots = Vec::with_capacity(bindings.len());
                for (name, _) in bindings {
                    let slot = Rc::new(RefCell::new(Value::Unit));
                    self.letrec_slots.push(slot.clone());
                    slots.push(slot.clone());
                    env2 = Some(Rc::new(Frame { name: name.clone(), slot, parent: env2 }));
                }
                for ((_, value), slot) in bindings.iter().zip(&slots) {
                    let v = self.eval(value, &env2)?;
                    *slot.borrow_mut() = v;
                }
                self.eval(body, &env2)
            }
```

- [ ] **Step 6: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib interp::
cargo test --workspace
```

- [ ] **Step 7: Commit.**

```bash
git add -A
git commit -m "feat(core): LetRecGroup binding group + reference-interpreter evaluation"
```

---

### Task 3: `desugar` forms groups in dependency order

The second gate, and the one that makes the feature reachable from source. Today each `Stmt::Fn` becomes its own `LetRec` in source order, so a `fn` cannot see a later one.

**Files:** Modify `crates/redextape-core/src/desugar.rs`

**Interfaces:**
- Consumes: `Core::LetRecGroup` (Task 2).
- Produces: `fn_run_groups(stmts: &[Stmt]) -> Vec<Vec<usize>>` — for one adjacent `fn` run, its SCCs in dependency order (callees first), indices into the run.

- [ ] **Step 1: Write the failing tests** in `desugar.rs`'s test module:

```rust
#[test]
fn mutual_recursion_runs_end_to_end() {
    let src = "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
               fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(10)";
    assert_eq!(crate::run(src).unwrap(), crate::value::Value::Bool(true));
}

#[test]
fn a_forward_reference_without_a_cycle_runs() {
    // No cycle — but `a` still needs to see `b`, which is defined after it.
    assert_eq!(crate::run("fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)").unwrap(),
               crate::value::Value::Nat(7));
}

#[test]
fn a_three_member_cycle_runs() {
    // n = 2 can pass while an n-ary bug lurks; pin n = 3.
    let src = "fn f(n){ if n == 0 { 0 } else { g(n - 1) } } \
               fn g(n){ if n == 0 { 1 } else { h(n - 1) } } \
               fn h(n){ if n == 0 { 2 } else { f(n - 1) } } f(7)";
    assert_eq!(crate::run(src).unwrap(), crate::value::Value::Nat(1));
}

#[test]
fn an_independent_fn_still_lowers_as_a_plain_letrec() {
    // The additive guarantee: a non-mutual `fn` must NOT become a group.
    let core = desugar(&crate::parser::parse("fn f(n){ n + 1 } f(2)").0.unwrap());
    assert!(!contains_group(&core), "a singleton must stay a LetRec, or every step golden moves");
}
```

`contains_group(&Core) -> bool` is an **iterative** worklist walk (never recursive — `Core` spines reach tens of thousands deep). Reuse `core.rs::take_core_children`'s match arms as the authority on which children each variant has.

- [ ] **Step 2: Run them, expect failure.**

Run: `cargo test -p redextape-core --lib desugar::`
Expected: the first three FAIL (unbound name, or a wrong value); the fourth passes already.

- [ ] **Step 3: Add the grouping analysis.**

```rust
/// For one maximal run of adjacent `Stmt::Fn`, return its strongly connected components in
/// DEPENDENCY ORDER — callees before callers — as indices into the run.
///
/// Dependency order matters as much as the grouping: `desugar` nests bindings, so a component must be
/// emitted OUTSIDE every component that calls it. Source order is not enough — `fn a(n){ b(n) } fn b(n){ n }`
/// has no cycle but still needs `b` outermost.
fn fn_run_groups(stmts: &[Stmt]) -> Vec<Vec<usize>>
```

**Signature and contract above; algorithm here** — the body is left to you because it depends on `Stmt`'s exact shape, which you should read rather than have me guess:

1. For each member of the run, collect the set of *other members' names* its body references — by call **or** as a value. Reuse whatever name-collecting walk the file already has if one exists; otherwise write an iterative worklist walk (never recursive).
2. Compute strongly connected components over that graph.
3. Return them in reverse-topological order of the condensation, so every component precedes the components that reference it.

**It must be iterative.** Tarjan's is naturally recursive — if you use it, convert it to an explicit stack, or use Kosaraju's two-pass form with iterative DFS. A recursive SCC over a long `fn` run reintroduces exactly the stack-overflow class `Core`'s hand-written `Drop` exists to prevent.

- [ ] **Step 4: Emit groups in `lower_stmts`.**

Where the fold currently handles `Stmt::Fn` one at a time, instead consume the whole adjacent run: call `fn_run_groups`, and for each component emit — in the order that puts callees outermost — a `Core::LetRec` when the component has **one** member that does not call itself-through-the-group, or a `Core::LetRecGroup` when it has **two or more**.

**A one-member component stays `LetRec`.** This is the additive guarantee and the fourth test pins it.

Preserve the existing right-to-left accumulator discipline and the `NodeId`s each `fn` already receives, so a non-mutual program produces byte-identical `Core`.

- [ ] **Step 5: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib desugar::
cargo test --workspace
```
Expected: all four pass. **If any existing test's expected value changes, STOP and report it** — that means a non-mutual program's lowering moved, which the additive guarantee forbids.

- [ ] **Step 6: Commit.**

```bash
git add crates/redextape-core/src/desugar.rs
git commit -m "feat(desugar): group adjacent fn runs into dependency-ordered SCCs"
```

---

### Task 4: λ lowers a group via a tupled fixpoint

**Files:** Modify `crates/redextape-core/src/lambda/lower.rs`

**Interfaces:** Consumes `Core::LetRecGroup`. Produces `run_lambda` agreement on mutually recursive programs.

- [ ] **Step 1: Write the failing test** in `lambda.rs`'s or `lambda/lower.rs`'s test module (match where the existing `recursion_via_fix` test lives, `lower.rs:491`):

```rust
#[test]
fn mutual_recursion_reduces_to_the_same_value_as_the_reference() {
    let src = "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
               fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(6)";
    let core = crate::desugar::desugar(&crate::parser::parse(src).0.unwrap());
    let expected = crate::run(src).unwrap();
    match crate::lambda::run_lambda(&core, crate::lambda::DEFAULT_CAP) {
        crate::lambda::LambdaRun::Reduced(nf) => {
            assert_eq!(crate::lambda::decode::decode(&nf, &expected), Some(expected));
        }
        other => panic!("lambda did not reduce: {other:?}"),
    }
}
```

Use the real cap constant and the real decode entry point — read how `tests/lambda_oracle.rs` decodes a normal form and mirror it exactly rather than guessing these names.

- [ ] **Step 2: Run it, expect failure.**

Run: `cargo test -p redextape-core --lib lambda`
Expected: FAIL — the group arm returns `Unsupported` from Task 2.

- [ ] **Step 3: Implement the tupled fixpoint.**

The existing single case (`lower.rs:158-166`) is `(\name. body) (fix (\name. value))` with the call-by-name Y at `:23`. The n-ary form takes **one** fixpoint over a tuple and projects:

```
G   = fix (\g. TUPLE(v1', …, vn'))     -- inside each vi', every fj is replaced by (proj_j g)
out = (\f1 … fn. body) (proj_1 G) … (proj_n G)
```

Build `TUPLE` from the existing `encode::cons`/`encode::nil` as a cons-list, and `proj_j` as `head` after `j` applications of `tail`. **No new combinator and no new encoding primitive.**

Push all n names onto `scope` before lowering any value or the body — the direct analogue of the single case's `scope.push(name)`.

- [ ] **Step 4: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib lambda
cargo test --workspace
```

**If the λ run hits the step cap**, that is the risk the spec flagged: call-by-name Y re-expands the tuple per projection rather than sharing it. **Shrink the test program** (e.g. `is_even(4)`) and report the smallest `n` that fits. **Do not raise the cap** to make it pass — report instead.

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-core/src/lambda/lower.rs
git commit -m "feat(lambda): lower a binding group via one tupled fixpoint"
```

---

### Task 5: `lower_asm` binds a group's names before any body

The third gate — the one that makes the TM and native backends able to express the cycle at all.

**Files:** Modify `crates/redextape-core/src/tm/lower_asm.rs`

**Interfaces:** Consumes `Core::LetRecGroup`. Produces `run_tm`/native agreement on mutually recursive programs.

- [ ] **Step 1: Write the failing test** in `lower_asm.rs`'s test module:

```rust
#[test]
fn a_binding_group_lowers_and_runs_on_the_asm_interpreter() {
    let src = "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
               fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)";
    let core = crate::desugar::desugar(&crate::parser::parse(src).0.unwrap());
    let prog = lower_asm(&core).expect("a binding group must lower");
    let expected = crate::run(src).unwrap();
    match run_asm(&prog, DEFAULT_CAPS) {
        AsmRun::Ran(o) => assert_eq!(decode_asm(&o, &expected), Some(expected)),
        other => panic!("did not run: {other:?}"),
    }
}
```

Use the real `run_asm`/`AsmRun`/`DEFAULT_CAPS` spellings from this module's existing tests.

- [ ] **Step 2: Run it, expect failure.**

Run: `cargo test -p redextape-core --lib lower_asm::`
Expected: FAIL — `Unsupported` from Task 2's stub.

- [ ] **Step 3: Lower the group.**

The existing `LetRec` arm (`lower_asm.rs:366-379`) validates the value is a `Lambda`, calls `reject_fn_value(body, name)`, pushes a `fn_scope`, calls `lower_function`, then lowers the body. For a group, do the same **but bind every name first**:

1. Validate every value is a `Core::Lambda`, else `Unsupported` naming the offending binding.
2. `reject_fn_value(body, name)` for **each** name — the group's names must still be call-only in the body.
3. Push one `ctx.fn_scopes` frame for the whole group.
4. **Register every member's `(label, arity)` before lowering any body.** `lower_function` currently allocates the label and calls `ctx.bind_fn` itself, immediately before lowering that one body — which is exactly why mutual recursion fails. Split that: allocate + `bind_fn` all n names, then lower all n bodies. **Read `lower_function` (`lower_asm.rs:~140`) and factor it rather than duplicating it** — one implementation, so the single and group paths cannot drift.
5. Lower the body, pop the scope.

- [ ] **Step 4: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib lower_asm::
cargo test --workspace
```

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-core/src/tm/lower_asm.rs
git commit -m "feat(tm): bind every name in a binding group before lowering any body"
```

---

### Task 6: `defunc` handles groups

`defunc` runs only when `lower_asm` reports `Unsupported` (a higher-order program), so a group containing a closure reaches it.

**Files:** Modify `crates/redextape-core/src/tm/defunc.rs`

**Interfaces:** Consumes `Core::LetRecGroup`. Produces `defunc` accepting groups.

- [ ] **Step 1: Write the failing test** in `defunc.rs`'s test module:

```rust
#[test]
fn a_binding_group_survives_defunctionalization() {
    // Mutually recursive AND higher-order, so `lower_asm` alone cannot handle it and `defunc` runs.
    let src = "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
               fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } \
               fn id(x){ x } ev(4, id)";
    let core = crate::desugar::desugar(&crate::parser::parse(src).0.unwrap());
    let out = defunc(&core).expect("a binding group must defunctionalize");
    let prog = crate::tm::lower_asm(&out).expect("and then lower");
    let expected = crate::run(src).unwrap();
    match crate::tm::run_asm(&prog, crate::tm::DEFAULT_CAPS) {
        crate::tm::AsmRun::Ran(o) => assert_eq!(crate::tm::decode_asm(&o, &expected), Some(expected)),
        other => panic!("did not run: {other:?}"),
    }
}
```

- [ ] **Step 2: Run it, expect failure.**

Run: `cargo test -p redextape-core --lib defunc::`
Expected: FAIL — `Unsupported` from Task 2's stub.

- [ ] **Step 3: Handle groups in `defunc`.**

`peel` (`defunc.rs:113`) walks the top-level prelude collecting `let` bindings and `LetRec`-with-`Lambda` function definitions until the first non-such node. Extend it so a `LetRecGroup` contributes **every** member as a `Func`, preserving each member's own `NodeId`s (`letrec_id`/`lambda_id`) exactly as the single case does — the source map depends on it.

Then extend `push_children` for the new variant. **Report whether anything else in the file needed changing** — in particular whether `topo_order` now sees a cycle among group members, and how you resolved it if so.

- [ ] **Step 4: Run the tests, expect pass.**

```bash
cargo test -p redextape-core --lib defunc::
cargo test --workspace
```

- [ ] **Step 5: Commit.**

```bash
git add crates/redextape-core/src/tm/defunc.rs
git commit -m "feat(tm): defunc peels and re-emits binding groups"
```

---

### Task 7: The oracle, and proof nothing else moved

**Files:** Modify `crates/redextape-core/tests/three_way_oracle.rs`

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Add the agreement cases.**

Read the file's existing helpers (`assert_three_way` and the demo arrays) and add mutually recursive programs to whichever array gives full agreement, sized to fit under both the TM and λ caps:

```rust
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",
```

If either exceeds a cap, shrink it and **report the smallest form that fits** rather than raising a cap.

- [ ] **Step 2: Extend the NATIVE leg too — the spec claims four-way agreement, not three.**

`three_way_oracle.rs` covers `reference == λ == TM`. The native backend lives in the separate
`redextape-native` crate and has its own oracle (`crates/redextape-native/tests/native_oracle.rs`). Add
the same two programs to its case set, using that file's existing helpers, so the claim in the spec —
`reference == λ == TM == native` — is actually asserted rather than assumed.

Run: `cargo test -p redextape-native` (and, if an LLVM toolchain is present,
`LLVM_SYS_221_PREFIX=/opt/homebrew/opt/llvm cargo test -p redextape-native --features llvm`).

- [ ] **Step 3: Prove the additive guarantee held.**

```bash
cargo test --workspace
```
Every committed step-count golden must be **unchanged**. This is the check that `LetRec`'s path was genuinely untouched; a moved golden means a non-mutual program re-lowered and the additive claim is false — **STOP and report it** rather than re-blessing.

- [ ] **Step 4: Prove the guards bite.**

For each, apply the mutant, confirm the named test FAILS, revert, confirm green. **Report every assertion message.**

1. In Task 5's group lowering, bind only the **first** name before lowering bodies → the asm test must fail (this is the whole feature).
2. In Task 4's λ projection, return `proj_1` for every member → the λ test must fail. (`is_even`/`is_odd` are observably different, which is why they were chosen; a symmetric pair would not catch it.)
3. In Task 2's interpreter arm, patch only the first slot → the interpreter test must fail.

A guard that survives its mutant is not a guard — this codebase has shipped several, each found exactly this way.

- [ ] **Step 5: Run the full gate.**

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
./scripts/check-all.sh --no-llvm
```

- [ ] **Step 6: Commit.**

```bash
git add crates/redextape-core/tests/three_way_oracle.rs crates/redextape-native/tests/native_oracle.rs
git commit -m "test: four-way agreement on mutually recursive and forward-referencing programs"
```

---

## Notes for the executor

- **The three gates are ordered and each blocks the next**: `typeck` (Task 1) rejects before `desugar` runs; `desugar` (Task 3) must emit groups before any backend sees one; `lower_asm` (Task 5) is what finally makes the TM and native able to express a cycle. Tasks 2, 4, 6 fill in the backends.
- **`LetRec` must not be touched.** If you find yourself editing its arm anywhere, stop — the additive guarantee is what keeps every step-count golden valid, and those goldens are the only evidence that existing programs still lower identically.
- **Dependency order is as load-bearing as grouping.** `fn a(n){ b(n) } fn b(n){ n }` has no cycle but still fails today, because `desugar` nests bindings in source order. Emitting components callees-outermost fixes both cases at once.
- **Totality is inherited, not re-derived.** New arms sit inside the existing depth-guarded walks. `take_core_children` MUST enumerate a group's children — miss it and a deep group aborts the process on teardown, which no test will catch until it does.
- **Caps are a reporting boundary, not a tuning knob.** λ's call-by-name `fix` re-expands the tuple per projection, so mutual recursion costs λ steps. If a natural example will not fit, shrink the example and report the limit; never raise a cap to make a test pass.
