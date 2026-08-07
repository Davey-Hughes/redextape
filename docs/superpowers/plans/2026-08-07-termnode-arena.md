# `TermNode` Arena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `viewmodel::TermNode`'s `Box` children with `u32` indices into a flat
`TermTree { nodes, root }`, so neither the derived `Serialize` nor the derived `Drop` recurses at any
depth and `lambdaAst` can never trap the wasm shadow stack.

**Architecture:** `to_tree` already builds bottom-up over an explicit worklist into a
`results: Vec<TermNode>` — that vector is the arena in disguise. The change makes `results` a stack of
`u32` indices and appends each completed node to a `nodes: Vec<TermNode>` arena. The walk's
`Enter`/`Abs`/`App` marker protocol, its pop order, and the position of its budget check are all
unchanged. Because the walk builds post-order, the root always lands last.

**Tech Stack:** Rust 2024 (resolver 3), `serde` behind an optional default-off feature,
`serde-wasm-bindgen` at the boundary, `wasm-bindgen-test` in headless Chrome, `cargo-nextest` as the
fast-tier runner.

**Design:** [`../specs/2026-08-07-termnode-arena-design.md`](../specs/2026-08-07-termnode-arena-design.md).

## Global Constraints

- **No library path may panic.** `unwrap_used`, `expect_used`, `panic`, `todo` and `unimplemented` are
  clippy warnings, and CI runs `-D warnings`. `unreachable!` is not an escape hatch either — a panic
  under wasm aborts the module.
- **`clippy.toml`'s test exemptions reach `#[test]` functions and `#[cfg(test)]` modules only.** Free
  helpers in an integration-test file are NOT exempt, which is why each test target carries its own
  `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]`. `wasm_bindgen_test` functions
  are not `#[test]` functions and are covered by the same target-level allow in `browser.rs`.
- **The pre-commit hook runs `cargo fmt` and `cargo clippy -D warnings` on every commit.** Never
  `--no-verify`. A commit whose types exist but whose readers do not is `dead_code` and will be
  rejected — this is why Task 2 is one commit spanning two crates.
- **serde is optional and default-off in `redextape-core`.** Every view-model type carries
  `#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]`.
- **`usize` is 32 bits on wasm32.** `u32` arena indices are therefore exactly as wide as
  `node_budget` on the only target that matters for the hazard; §5's overflow branch is reachable
  only on a 64-bit native build.
- **Corrections land at the original claim site, not only in a new entry.** This is a standing project
  convention and Task 5 is where this plan honours it.
- **Branch `termnode-arena` already exists** and carries the design commit (`740aef6`). `main` is
  protected; this lands as a PR.

---

### Task 1: Establish the hazard is reachable, and size the arena

The deliverable is two recorded numbers and a decision, not code. The spec's §11.3 names this risk
directly: if a 600-element list returns under both shapes, Task 4's regression test proves nothing,
and the fallback has to be chosen before the code changes rather than after.

**Files:**
- Temporarily modify: `crates/redextape-core/tests/viewmodel_contract.rs` (probe, reverted in Step 3)
- Temporarily modify: `crates/redextape-wasm/tests/browser.rs` (probe, reverted in Step 6)
- Record results in: `docs/superpowers/specs/2026-08-07-termnode-arena-design.md` §7 and §11.3

**Interfaces:**
- Consumes: nothing.
- Produces: two numbers quoted verbatim in Task 4's test comments — the 600-element list's logical
  node count and its term depth — and a yes/no on whether `lambdaAst` traps today.

- [ ] **Step 1: Add the native size probe**

Append to `crates/redextape-core/tests/viewmodel_contract.rs`, immediately after
`the_ast_returns_none_over_budget_rather_than_a_partial_tree`:

```rust
/// TEMPORARY PROBE — deleted in Step 3. Reports the two numbers Task 4's browser test needs to be
/// honest about what it exercises. `logical_size` is the count `to_tree` emits (one entry per
/// OCCURRENCE, matching the budget's own accounting), and `depth` is the quantity both recursive
/// paths on `TermNode` are linear in.
#[test]
fn probe_the_600_element_lists_arena() {
    let elems = vec!["0"; 600].join(", ");
    let (term, _map) = lambda_fixture(&format!("[{elems}]"));
    panic!(
        "logical_size = {}, depth = {}",
        redextape_core::lambda::term::logical_size(&term),
        term.depth()
    );
}
```

- [ ] **Step 2: Run the probe and record both numbers**

Run: `cargo test -p redextape-core --test viewmodel_contract probe_the_600 -- --nocapture`

Expected: FAIL, with a panic message of the form `logical_size = N, depth = D`. Write both numbers
down — they are quoted in Task 4.

**Decision rule on `logical_size`:** if it exceeds ~50,000,000 the browser test would allocate an
arena too large to be worth running; in that case reduce the element count until it does not, and use
that count everywhere 600 appears in Task 4. Record the count actually used.

- [ ] **Step 3: Revert the native probe**

```bash
git checkout crates/redextape-core/tests/viewmodel_contract.rs
```

- [ ] **Step 4: Add the browser trap probe**

In `crates/redextape-wasm/tests/browser.rs`, inside
`a_deep_but_legal_program_needs_the_raised_shadow_stack`, after the existing `lambdaStatus`
assertion, add:

```rust
    // TEMPORARY PROBE — reverted in Step 6. Does the CURRENT recursive `TermNode` trap here?
    let ast = call(&session, "lambdaAst", &[JsValue::from_f64(4_000_000_000.0)]);
    assert!(!ast.is_null(), "PROBE: a 600-deep term produced a tree without trapping");
```

- [ ] **Step 5: Run the browser suite and record what happens**

Run: `wasm-pack test --headless --chrome crates/redextape-wasm`

If wasm-pack reports Chrome unavailable, Chrome is installed as `google-chrome-stable` rather than
`google-chrome`; re-run with `CHROME_PATH=/usr/bin/google-chrome-stable` prefixed. chromedriver
self-installs.

Expected, and the whole point of the probe: the module **traps** with
`RuntimeError: memory access out of bounds` and takes the remaining tests in the file down with it —
a wasm trap does not unwind. That is the hazard, observed.

**Decision rule if it does NOT trap:** 600 is not deep enough. Re-run at 690 elements (just under
`MAX_LAMBDA_LOWER_DEPTH` = 700, past which the λ lowering declines and the probe would exercise
nothing). If 690 also returns cleanly, **record that fact in the spec's §11.3 and change Task 4's
Step 3**: the browser test becomes a shape test only, its comment says the trap was not reproducible
at any depth the guards admit, and the arena is justified by the two structural facts alone rather
than by a demonstrated trap. Do not assert a trap that was not observed.

- [ ] **Step 6: Revert the browser probe**

```bash
git checkout crates/redextape-wasm/tests/browser.rs
```

- [ ] **Step 7: Record the measurements in the spec**

In `docs/superpowers/specs/2026-08-07-termnode-arena-design.md`, replace the last sentence of §2
(*"A reachable input exists…"*) with the measured figures, and replace §11.3 with what was observed.
Both edits state numbers, not expectations.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-08-07-termnode-arena-design.md
git commit -m "docs: measure the TermNode hazard — the 600-element list's arena size, depth, and whether it traps"
```

---

### Task 2: The arena types, the walk, and the boundary signature

One commit spanning two crates. The pre-commit clippy gate makes this indivisible: `TermTree` with no
constructor is `dead_code`, and `redextape-wasm` stops compiling the moment `LambdaState::ast` changes
its return type.

**Files:**
- Modify: `crates/redextape-core/src/viewmodel.rs:129-135` (the type), `:144-152` (`LambdaState::ast`),
  `:155-218` (the walk), `:309-329` (the unit test)
- Modify: `crates/redextape-wasm/src/session.rs:17` (import), `:443-448` (`lambda_ast`)

**Interfaces:**
- Consumes: nothing from Task 1 except its recorded numbers, which are not used here.
- Produces:
  - `pub struct TermTree { pub nodes: Vec<TermNode>, pub root: u32 }`
  - `pub enum TermNode { Var(u32), Abs(String, u32), App(u32, u32) }`
  - `LambdaState::ast(c: &LambdaCursor, node_budget: usize) -> Option<TermTree>`
  - `Session::lambda_ast(&self, node_budget: usize) -> Result<Option<TermTree>, SessionError>`

- [ ] **Step 1: Rewrite the unit test against the arena (the failing test)**

Replace `to_tree_matches_the_term_shape_within_budget` in `crates/redextape-core/src/viewmodel.rs`
(currently at `:309-329`) with:

```rust
    #[test]
    fn to_tree_matches_the_term_shape_within_budget() {
        // `App(Var(0), Var(1))` is the minimal discriminator: a transposed pop order builds
        // `App(Var(1), Var(0))` instead, a difference `is_some()` cannot see. Built directly with the
        // `lambda::term` constructors, not lowered from source, so the expected shape is unambiguous.
        //
        // THE ARENA IS ASSERTED IN FULL, INDICES AND ALL, not just its root. Post-order is what makes
        // `root == nodes.len() - 1` true, and an implementation that emitted the right nodes in the
        // wrong order would still satisfy a root-only assertion.
        use crate::lambda::term::{app, var};

        let flat = app(var(0), var(1));
        let flat_ast = LambdaState::ast(&LambdaCursor::new(&flat, 1_000), usize::MAX);
        assert_eq!(
            flat_ast,
            Some(TermTree {
                nodes: vec![TermNode::Var(0), TermNode::Var(1), TermNode::App(0, 1)],
                root: 2,
            })
        );

        // Nested one level, so a fix that only gets the outermost `App` right cannot pass: the
        // function position is itself an `App`, and its two children must land in order too.
        let nested = app(app(var(0), var(1)), var(2));
        let nested_ast = LambdaState::ast(&LambdaCursor::new(&nested, 1_000), usize::MAX);
        assert_eq!(
            nested_ast,
            Some(TermTree {
                nodes: vec![
                    TermNode::Var(0),
                    TermNode::Var(1),
                    TermNode::App(0, 1),
                    TermNode::Var(2),
                    TermNode::App(2, 3),
                ],
                root: 4,
            })
        );
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --lib viewmodel::tests::to_tree_matches`

Expected: FAIL to compile — `cannot find struct, variant or union type 'TermTree' in this scope`, and
`this enum variant takes 2 arguments but 1 argument was supplied` on `TermNode::App(0, 1)`.

- [ ] **Step 3: Replace the type**

In `crates/redextape-core/src/viewmodel.rs`, replace lines 129-135 with:

```rust
/// A λ term as a flat arena, so that NOTHING DERIVED ON IT RECURSES.
///
/// The obvious shape — `Abs(String, Box<TermNode>)` — gives the type two recursive paths, and both
/// are linear in DEPTH rather than node count: serde's derived `Serialize` descends one frame per
/// level, and the compiler's `drop_in_place` walks the `Box` chain the same way. A wasm trap does not
/// unwind, so neither returns an error — both poison the module, and the `Drop` path fires where no
/// caller can see it. `LambdaTerm`, the type this is built FROM, carries a hand-written iterative
/// destructor (`lambda/term.rs:482`) for exactly that hazard; indices are how this type avoids
/// needing one.
///
/// `nodes` is in POST-ORDER — every child precedes its parent — because the walk that builds it
/// completes children before parents. `root` is therefore always `nodes.len() - 1`, and is stored
/// anyway so a consumer never encodes that convention.
///
/// `nodes` is never empty: a term has at least one node, and a zero budget refuses at the first one,
/// so `root` always indexes a real element.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TermTree {
    pub nodes: Vec<TermNode>,
    pub root: u32,
}

/// One node of a [`TermTree`]. Children are indices into that tree's `nodes`, never owned subtrees.
///
/// `u32` rather than `usize` is a BOUNDARY decision, not a memory one: wasm-bindgen maps `u64` to a
/// JavaScript `bigint`, and `Var`'s de Bruijn index is already `u32`, so the payload stays uniformly
/// numeric. On wasm32 `usize` is 32 bits, which makes the two exactly as wide as `node_budget` there.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum TermNode {
    Var(u32),
    Abs(String, u32),
    App(u32, u32),
}
```

- [ ] **Step 4: Change `LambdaState::ast`'s return type**

In the same file, replace lines 144-152 (`LambdaState::ast` and its doc) with:

```rust
    /// The term as a flat tree, or `None` if it exceeds `node_budget`.
    ///
    /// `None` RATHER THAN A PARTIAL TREE. Truncated text is visibly truncated; a truncated AST is a lie
    /// about the term's shape, and a partial arena would be the same lie with an index on it. The count
    /// happens during the walk for the same reason the printer's budget does — building the tree and
    /// then measuring it defeats the purpose.
    pub fn ast(c: &LambdaCursor, node_budget: usize) -> Option<TermTree> {
        let mut budget = node_budget;
        to_tree(c.term(), &mut budget)
    }
```

- [ ] **Step 5: Rewrite the walk**

Replace lines 163-218 (the `to_tree` doc comment and body) with:

```rust
/// `LambdaState::ast`'s walk. ITERATIVE, OVER AN EXPLICIT STACK, deliberately: `LambdaTerm` is only
/// guarded against unbounded depth from the SECOND step onward (`LambdaCursor::next`'s depth check),
/// not at construction, so the very first term a cursor holds can already be deeper than a native
/// recursive walk survives — the same hazard `term.rs`'s own `Drop` and `logical_sizes` are iterative
/// to avoid.
///
/// IT BUILDS AN ARENA RATHER THAN A TREE OF `Box`ES, and that is what extends the same protection to
/// everything that happens to the RESULT. This walk was always safe; the derived `Serialize` and
/// derived `Drop` on the value it returned were not. See [`TermTree`].
///
/// THE BUDGET IS CHECKED BEFORE EACH NODE IS COUNTED AND BUILT, so a term that would exceed it returns
/// `None` at the node that overshoots rather than after the whole tree is built and measured — an
/// early `return` here abandons `work`, `nodes` and `results` without finishing them, which is fine
/// because nothing downstream reads any of them once this function has returned.
///
/// A SHARED SUBTERM COSTS THE BUDGET ONCE PER OCCURRENCE, not once per allocation: the arena is
/// unshared, so a DAG node reached through two parents becomes two distinct entries, and both must be
/// paid for — exactly as `print_lambda_capped` pays per occurrence in the text it writes, not per
/// underlying `Rc`.
fn to_tree<'a>(t: &'a LambdaTerm, budget: &mut usize) -> Option<TermTree> {
    let mut work: Vec<Work<'a>> = Vec::new();
    let mut nodes: Vec<TermNode> = Vec::new();
    let mut results: Vec<u32> = Vec::new();
    work.push(Work::Enter(t));
    while let Some(item) = work.pop() {
        match item {
            Work::Enter(term) => {
                if *budget == 0 {
                    return None;
                }
                *budget -= 1;
                match term.node() {
                    Node::Var(i) => emit(&mut nodes, &mut results, TermNode::Var(*i))?,
                    Node::Abs(name, body) => {
                        work.push(Work::Abs(name.to_string()));
                        work.push(Work::Enter(body));
                    }
                    Node::App(f, a) => {
                        work.push(Work::App);
                        work.push(Work::Enter(a));
                        work.push(Work::Enter(f));
                    }
                }
            }
            // `f` was pushed after `a` (see the `App` arm above), so it is popped from `work` — and
            // therefore built — first. Its index lands in `results` first too, with `a`'s pushed on
            // top once `a` finishes: `results` is itself a stack, so `a` comes off it FIRST and `f`
            // comes off LAST.
            Work::App => {
                let a = results.pop()?;
                let f = results.pop()?;
                emit(&mut nodes, &mut results, TermNode::App(f, a))?;
            }
            Work::Abs(name) => {
                let body = results.pop()?;
                emit(&mut nodes, &mut results, TermNode::Abs(name, body))?;
            }
        }
    }
    let root = results.pop()?;
    Some(TermTree { nodes, root })
}

/// Append `n` to the arena and push the index it landed at onto `results`.
///
/// `None` WHEN THE INDEX WOULD NOT FIT `u32`, refusing through the channel that already means "no
/// tree" rather than panicking — a panic under wasm aborts the module, and `unreachable!` is ruled
/// out for the same reason. 2^32 entries is on the order of 100 GB at `size_of::<TermNode>()`, so
/// this cannot occur; it is written as a branch rather than an assumption because a branch that
/// claims to be total and is not is the defect this project has corrected twice.
fn emit(nodes: &mut Vec<TermNode>, results: &mut Vec<u32>, n: TermNode) -> Option<()> {
    let idx = u32::try_from(nodes.len()).ok()?;
    nodes.push(n);
    results.push(idx);
    Some(())
}
```

- [ ] **Step 6: Update the wasm boundary**

In `crates/redextape-wasm/src/session.rs`, change line 17 from:

```rust
use redextape_core::viewmodel::{LambdaState, TermNode, TmProgram, TmState};
```

to:

```rust
use redextape_core::viewmodel::{LambdaState, TermTree, TmProgram, TmState};
```

and replace `lambda_ast` (lines 443-448) with:

```rust
    /// The term as a flat tree, or `None` when it exceeds `node_budget` — `None` rather than a partial
    /// tree, because a truncated AST is a lie about the term's shape.
    ///
    /// The payload is an ARENA (`TermTree`), not a tree of boxes, so neither serializing it across the
    /// boundary nor dropping it afterwards recurses. See `viewmodel::TermTree`.
    pub fn lambda_ast(&self, node_budget: usize) -> Result<Option<TermTree>, SessionError> {
        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
        Ok(LambdaState::ast(c, node_budget))
    }
```

- [ ] **Step 7: Run the unit test to verify it passes**

Run: `cargo test -p redextape-core --lib viewmodel::tests::to_tree_matches`

Expected: PASS, 1 passed.

- [ ] **Step 8: Run the whole workspace**

Run: `cargo test --workspace`

Expected: PASS. `session.rs`'s two `lambda_ast` tests (`:719` asserting `LambdaAbsent` and `:942`
asserting the budget refusal) read only `is_none`/`is_some`/`Err`, so they compile and pass unchanged.
`viewmodel_contract.rs`'s `the_ast_returns_none_over_budget_rather_than_a_partial_tree` likewise.

- [ ] **Step 9: Run clippy the way the hook and CI will**

Run: `cargo clippy --workspace --all-targets -- -D warnings`

Expected: no warnings. If `emit`'s three parameters trip `clippy::too_many_arguments` (it will not —
the threshold is 7), do not add an `allow`; report it instead.

- [ ] **Step 10: Commit**

```bash
git add crates/redextape-core/src/viewmodel.rs crates/redextape-wasm/src/session.rs
git commit -m "viewmodel: TermNode's children become arena indices, so nothing derived on it recurses"
```

---

### Task 3: The structural round-trip, and TermTree through JSON

Two properties the unit test in Task 2 cannot reach: that flattening moved no structure on a real
program rather than on two hand-built terms, and that the type survives serde at all.

**Files:**
- Modify: `crates/redextape-core/tests/viewmodel_contract.rs` — import at `:11`, new test and helper,
  and `every_view_model_round_trips_through_json` at `:333`

**Interfaces:**
- Consumes: `TermTree`, `TermNode`, `LambdaState::ast` from Task 2.
- Produces: nothing later tasks read.

- [ ] **Step 1: Widen the import**

In `crates/redextape-core/tests/viewmodel_contract.rs`, change line 11 from:

```rust
use redextape_core::viewmodel::{LambdaState, TmProgram, TmState};
```

to:

```rust
use redextape_core::viewmodel::{LambdaState, TermNode, TermTree, TmProgram, TmState};
```

- [ ] **Step 2: Write the failing structural round-trip test**

Add to `crates/redextape-core/tests/viewmodel_contract.rs`, immediately after
`the_ast_returns_none_over_budget_rather_than_a_partial_tree`:

```rust
/// The arena denotes the same tree the term does, on a real lowered program rather than on a term
/// built by hand. `big_list_program()` is 200 elements — first-order, no recursion, and a logical size
/// the existing budget test above already drives with `usize::MAX`.
#[test]
fn the_arena_denotes_the_same_tree_the_term_does() {
    let (term, _map) = lambda_fixture(&big_list_program());
    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
    let tree = LambdaState::ast(&cursor, usize::MAX).expect("an unreachable budget must succeed");

    assert!(arena_matches_term(&tree, &term), "the arena and the term disagree on shape");
    assert_eq!(
        tree.root as usize,
        tree.nodes.len() - 1,
        "the walk builds post-order, so the root is the last node emitted"
    );
}

/// Walk the arena and the term in lockstep, ITERATIVELY.
///
/// A RECURSIVE REBUILD WOULD REINTRODUCE THE EXACT HAZARD THE ARENA REMOVES, inside the test that
/// certifies its removal — and it would pass on every shallow program while failing on the one shape
/// that matters. This is the obvious way to write this test and it is the wrong one.
///
/// Subterms are pushed as BORROWS of the root term, which outlives the walk, so a shared DAG node is
/// visited once per occurrence — matching the arena, which holds one entry per occurrence.
fn arena_matches_term(tree: &TermTree, term: &redextape_core::lambda::term::LambdaTerm) -> bool {
    use redextape_core::lambda::term::Node;

    let mut work: Vec<(u32, &redextape_core::lambda::term::LambdaTerm)> = vec![(tree.root, term)];
    while let Some((idx, t)) = work.pop() {
        let Some(node) = tree.nodes.get(idx as usize) else {
            return false;
        };
        match (node, t.node()) {
            (TermNode::Var(i), Node::Var(j)) => {
                if i != j {
                    return false;
                }
            }
            (TermNode::Abs(name, body), Node::Abs(n2, b2)) => {
                if name != n2 {
                    return false;
                }
                work.push((*body, b2));
            }
            (TermNode::App(f, a), Node::App(f2, a2)) => {
                work.push((*f, f2));
                work.push((*a, a2));
            }
            _ => return false,
        }
    }
    true
}
```

- [ ] **Step 3: Run it to verify it passes**

Run: `cargo test -p redextape-core --test viewmodel_contract the_arena_denotes`

Expected: PASS. This test is written after the implementation deliberately — it is a property check
over a real program, and Task 2 Step 1 already supplied the red-then-green cycle for the shape itself.
If it FAILS, the walk's pop order is transposed and Task 2 Step 5 is where to look.

- [ ] **Step 4: Add `TermTree` to the JSON round-trip**

In `every_view_model_round_trips_through_json` (at `:333`), immediately after the `LambdaState`
assertion `assert_eq!(ls, back);`, add:

```rust
    // `TermTree` was not covered here before the arena, and the omission mattered: `serde_json`'s
    // DESERIALIZER recurses per level too, so a `Box`-shaped `TermNode` had two recursive paths on the
    // way out and a third on the way back in.
    let tree = LambdaState::ast(&cursor, usize::MAX).expect("the fixture fits an unreachable budget");
    let back: TermTree =
        serde_json::from_str(&serde_json::to_string(&tree).expect("serialize")).expect("deserialize");
    assert_eq!(tree, back);
```

- [ ] **Step 5: Run the serde-gated test**

Run: `cargo test -p redextape-core --features serde --test viewmodel_contract every_view_model_round_trips`

Expected: PASS. Without `--features serde` the test does not exist — it is `#[cfg(feature = "serde")]`
because serde is default-off.

- [ ] **Step 6: Run the full check and commit**

Run: `scripts/check-all.sh --no-llvm`

Expected: every row green.

```bash
git add crates/redextape-core/tests/viewmodel_contract.rs
git commit -m "viewmodel: the arena denotes the term, checked iteratively, and TermTree round-trips through JSON"
```

---

### Task 4: The browser regression, and the wire shape measured

**Files:**
- Modify: `crates/redextape-wasm/tests/browser.rs:102-107` (wire shape) and
  `:279-286` (`a_deep_but_legal_program_needs_the_raised_shadow_stack`)

**Interfaces:**
- Consumes: `Session::lambda_ast` from Task 2; Task 1's recorded numbers, quoted in comments.
- Produces: nothing later tasks read.

- [ ] **Step 1: Replace the existing `lambdaAst` assertions with wire-shape assertions**

In `crates/redextape-wasm/tests/browser.rs`, replace lines 102-107 with:

```rust
    let ast = call(&session, "lambdaAst", &[JsValue::from_f64(1_000_000.0)]);
    assert!(!ast.is_null(), "an unreachable node budget yields a tree");

    // THE WIRE SHAPE, MEASURED RATHER THAN DESIGNED — PR 3b's `Decoded` lesson, applied before the
    // fact this time. `TermTree` is a struct, so it crosses as an object with `nodes` and `root`;
    // `TermNode` is an EXTERNALLY TAGGED enum, so each node is `{ Var: n }`, `{ Abs: [name, body] }`
    // or `{ App: [f, a] }`. A consumer branches on which key is present — there is no `kind` field.
    let nodes: Array = get(&ast, "nodes").unchecked_into();
    assert!(nodes.length() > 0, "a term has at least one node");
    assert_eq!(
        num(&ast, "root"),
        f64::from(nodes.length() - 1),
        "post-order puts the root last, and `root` says so explicitly"
    );

    // The term here is Church 42 — `λf. λx. f (f ... x)` — so its root is an `Abs`.
    let root_node = nodes.get(nodes.length() - 1);
    let abs: Array = get(&root_node, "Abs").unchecked_into();
    assert_eq!(abs.length(), 2, "`Abs(String, u32)` crosses as a two-element tuple");
    assert!(abs.get(0).as_string().is_some(), "the binder name marshals as a string");
    // THE LOAD-BEARING ASSERTION FOR `u32` OVER `usize`: an index must arrive as a JS number. A
    // `usize` child would cross as a `bigint`, which `as_f64` cannot read and a renderer cannot index
    // an array with.
    assert!(abs.get(1).as_f64().is_some(), "the body index marshals as a number, not a bigint");

    // `None` must arrive as `null`, not `undefined` — §5.1 writes this `TermTree | null`.
    let refused = call(&session, "lambdaAst", &[JsValue::from_f64(1.0)]);
    assert!(refused.is_null(), "a 1-node budget refuses, and refusal marshals as null");
    assert!(!refused.is_undefined(), "null, specifically — a renderer testing `=== null` must see it");
```

- [ ] **Step 2: Run the browser suite**

Run: `wasm-pack test --headless --chrome crates/redextape-wasm`

Expected: all cases pass.

**If the shape assertions fail**, the measurement disagrees with this plan and the plan is what is
wrong. Read the actual value (`web_sys::console::log_1(&ast)` or the assertion's own `{:?}`), fix
these assertions to match, and correct §7.3 of the design spec in place. Do not adjust the code to
match the plan.

- [ ] **Step 3: Add a depth-tolerance test that samples a REDUCED term**

**REVISED 2026-08-07 after Task 1's measurements, which falsified two things this step originally
assumed.** First, the recursive `TermNode` does NOT trap at any reachable depth on the 8 MiB stack —
so this is not a regression test and must not claim to be. Second, and independent of that: a freshly
compiled 600-element list is depth **607**, while the same program mid-reduction reaches **1,805**,
and an ordinary `sum(100)` reaches `MAX_TERM_DEPTH`'s **3,001**. The original step called `lambdaAst`
straight after `compile`, pinning a depth three times shallower than its own program reaches.

Add a NEW test to `crates/redextape-wasm/tests/browser.rs`, after
`a_deep_but_legal_program_needs_the_raised_shadow_stack` (which is unchanged):

```rust
/// THE DEPTH-TOLERANCE CASE, and it samples a REDUCED term rather than a compiled one.
///
/// NOT A REGRESSION TEST, and the distinction is recorded rather than glossed: measured before the
/// arena landed, the `Box`-shaped `TermNode` did not trap at any depth the guards admit on the 8 MiB
/// shadow stack. There is no crash here to pin. What this pins is that `lambdaAst` tolerates the
/// deepest terms reachable, so a future change that reintroduces per-level recursion — or that lowers
/// the stack — fails here rather than in a browser tab.
///
/// A FRESHLY COMPILED 600-ELEMENT LIST IS DEPTH 607; THE SAME PROGRAM MID-REDUCTION IS 1,805. Sampling
/// only the compile-time term would pin a depth three times shallower than this very program reaches,
/// which is why the loop steps rather than reading once.
///
/// THE BUDGET IS DELIBERATELY UNREACHABLE: `usize` is 32 bits on wasm32, so 4,000,000,000 is a node
/// budget no term can exhaust. A `null` would mean the BUDGET refused rather than the depth being
/// tolerated, and the case would pass for the wrong reason.
#[wasm_bindgen_test]
fn the_ast_tolerates_the_deepest_term_a_reduction_reaches() {
    let elems = vec!["0"; 600].join(", ");
    let (diagnostics, session) = compile(&format!("[{elems}]"));
    assert_eq!(diagnostics.length(), 0, "a 600-deep cons spine is inside every front-end guard");
    assert!(!session.is_null(), "and it compiles at 8 MiB");

    let mut chunks = 0;
    loop {
        let ast = call(&session, "lambdaAst", &[JsValue::from_f64(4_000_000_000.0)]);
        assert!(!ast.is_null(), "the arena crosses at chunk {chunks}");
        let status = call(&session, "runLambda", &[JsValue::from_f64(100.0)]);
        chunks += 1;
        assert!(chunks < 500, "this program normalizes well inside 500 chunks");
        if status.as_string().as_deref() != Some("Running") {
            break;
        }
    }

    let ast = call(&session, "lambdaAst", &[JsValue::from_f64(4_000_000_000.0)]);
    assert!(!ast.is_null(), "and on the normal form too");
    assert!(chunks > 1, "the loop must have actually stepped — one chunk means the run never ran");
}
```

**Verify `runLambda`'s exact name and return shape against `crates/redextape-wasm/src/lib.rs` before
writing this.** It returns a `RunStatus`, a fieldless enum serde renders as the variant NAME — one of
`"Running"`, `"Ended"`, `"Capped"`, `"DepthRefused"`. If the export or the encoding differs, follow
the code and note the difference in your report.

**CHUNK BUDGET CORRECTED TWICE DURING EXECUTION, and the original was a real defect.** This step first
specified `2_000`. Measured, the 600-element list normalizes in exactly **1,200 β-steps**, so a
2,000-step chunk consumed the whole reduction in one pass — the loop ran once, every `lambdaAst` call
landed on either the initial or the normalized term, and the test never sampled the mid-reduction
depth it exists to reach. The general lesson: a chunk budget larger than the program's step count
silently degrades this test into the compile-time-only test Task 1's measurements already rejected,
and it does so while staying green.

`300` was the first correction, and review found it still insufficient — not because it was wrong, but
because **the test observed no depth at all**, so four samples could straddle a peak and nothing would
notice. The final value is `100`, alongside a helper that computes the arena's depth in a single
linear pass (valid because the arena is post-order: every child index is already resolved when its
parent is reached) and asserts the peak. Measured across the run:
`607, 707, 807, …, 1707, 1803, 1803` — depth climbs monotonically at ~1 per β-step and plateaus, so
the straddling risk turned out not to arise for this shape. The assertion is `peak > 1_500`.

**That helper is not incidental.** It is an iterative consumer-side walk of the arena — precisely the
capability the design's §0 says the flat shape exists to make possible, demonstrated rather than
asserted.

- [ ] **Step 4: Run the browser suite again**

Run: `wasm-pack test --headless --chrome crates/redextape-wasm`

Expected: all cases pass, including the deep one — which is the observation the whole slice exists to
produce.

- [ ] **Step 5: Confirm the release build still links and check its size**

Run: `wasm-pack build --release --target web crates/redextape-wasm`

Expected: succeeds. Note the byte count; PR 3b left it at 604,966 bytes, and the arena should move it
by a few hundred bytes at most. A large move means something other than this change landed.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-wasm/tests/browser.rs
git commit -m "wasm: pin the arena's wire shape in a browser, and prove it tolerates the deepest term a reduction reaches"
```

---

### Task 5: Amend the specs and the roadmap

The design spec's §8 names three sites. Corrections land at the original claim, not only in a new
entry — this is the lesson the roadmap records as the most expensive one this project has learned.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-plan4-viewmodels-and-wasm-design.md:263` and `:423`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — the two entries at `:2981-2995`
  and `:3098-3102`
- Modify: `docs/superpowers/specs/2026-08-07-termnode-arena-design.md` — status line

**Interfaces:**
- Consumes: the measured wire shape from Task 4 and the numbers from Task 1.
- Produces: nothing.

- [ ] **Step 1: Correct §4.2's type block**

At `2026-08-05-plan4-viewmodels-and-wasm-design.md:263`, replace:

```rust
pub enum TermNode { Var(u32), Abs(String, Box<TermNode>), App(Box<TermNode>, Box<TermNode>) }
```

with:

```rust
pub struct TermTree { pub nodes: Vec<TermNode>, pub root: u32 }
pub enum TermNode { Var(u32), Abs(String, u32), App(u32, u32) }
```

and add immediately below it:

> **CORRECTED 2026-08-07.** This section originally specified `Box` children. That gave the type two
> recursive paths — a derived `Serialize` and a derived `Drop`, both linear in depth — on a value that
> crosses the wasm boundary, where a trap does not unwind. See
> [`2026-08-07-termnode-arena-design.md`](2026-08-07-termnode-arena-design.md).

- [ ] **Step 2: Correct §5.1's TypeScript**

At `:423`, replace `lambdaAst(nodeBudget: number): TermNode | null` with the shape Task 4 measured,
written as TypeScript. Assuming Task 4 confirmed the externally-tagged encoding:

```ts
lambdaAst(nodeBudget: number): {
  nodes: ({ Var: number } | { Abs: [string, number] } | { App: [number, number] })[]
  root: number
} | null
```

If Task 4 measured something different, write what it measured.

- [ ] **Step 3: Mark both roadmap entries closed**

In `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, the boundary-completion entry's paragraph
beginning **"THERE ARE TWO RECURSIVE PATHS ON `TermNode`"** (`:2981`) and the shadow-stack entry's
paragraph beginning **"And `Serialize` is only one of the two recursive paths"** (`:3098`) both
describe this as open. Prefix each with:

> **CLOSED 2026-08-07 — structurally, not by a guard.** `TermNode`'s children are now `u32` indices
> into a flat `TermTree`, so neither derived impl recurses at any depth and no depth constant was
> added. Design:
> [`../specs/2026-08-07-termnode-arena-design.md`](../specs/2026-08-07-termnode-arena-design.md).

Leave the original text intact below each prefix; it is the record of what was true.

- [ ] **Step 4: Add a roadmap entry for the slice**

Append a `####` entry at the end of the Plan 4 section, following the house style of the entries
above it: what shipped, what was measured (Task 1's two numbers, and whether the trap reproduced),
what the alternatives were and why they lost, and the coverage row for `viewmodel.rs`. State the
`wasm-pack build --release` byte count from Task 4 Step 5 against PR 3b's 604,966.

- [ ] **Step 5: Flip the design spec's status**

In `docs/superpowers/specs/2026-08-07-termnode-arena-design.md`, change
**Status: designed, not built.** to **Status: built.**

- [ ] **Step 6: Final gate**

Run: `scripts/check-all.sh --no-llvm`

Expected: every row green.

Run: `cargo llvm-cov --workspace --summary-only`

Expected: check the **per-file row for `viewmodel.rs`**, not the workspace total. PR 3b's entry
establishes why: a shell that absorbed logic it should not hold shows more lines and falling coverage
on the file doing the work. `viewmodel.rs` gains `emit` and loses three `Box::new` calls, so its row
should be flat or up.

- [ ] **Step 7: Commit and open the PR**

```bash
git add docs/
git commit -m "docs: the TermNode arena lands — two recursive paths closed, and the claims they falsified corrected in place"
git push -u origin termnode-arena
```

Then open a PR against `main` with a body following the house style of PR #14: what ships, what was
measured, and any scope change stated rather than slipped in.

---

## Self-Review

**Spec coverage.** §1 decisions 1–4 land in Task 2; decision 5 in Task 4 Step 1; decision 6 is
preserved by Task 2 Step 6 leaving the export and its parameter alone. §2's hazard is what Task 1
probes. §3's types are Task 2 Step 3, including the non-empty and post-order properties, both asserted
in Task 3 Step 2. §4's walk is Task 2 Step 5. §5's overflow refusal is `emit`. §6's error table is
unchanged by construction and re-verified by Task 2 Step 8. §7's four tests are Tasks 2–4: existing
tests carry over (Task 2 Step 8), structural round-trip (Task 3 Step 2), wire shape measured (Task 4
Step 1), depth regression (Task 4 Step 3). §8's three amendment sites are Task 5 Steps 1–3. §10's
one-commit constraint is honoured by Task 2. §11's three risks are each actioned: risk 1 by Task 4's
measurement-beats-plan rule, risk 2 is a consumer property with no code to write, risk 3 by Task 1's
decision rule.

**Placeholder scan.** One number is deliberately not written down — the 600-element list's logical size
and depth — and Task 1 exists to produce it, with an explicit decision rule for each outcome including
the one where the trap does not reproduce. That is the same treatment PR 3b's plan gave its own
measurement task. Every other step carries complete code and an exact command with expected output.

**Type consistency.** `TermTree { nodes, root }` and `TermNode { Var(u32), Abs(String, u32), App(u32,
u32) }` are spelled identically in Tasks 2, 3, 4 and 5. `LambdaState::ast` returns `Option<TermTree>`
in Task 2 Steps 3, 4 and in Task 3's two call sites. `Session::lambda_ast` returns
`Result<Option<TermTree>, SessionError>` in Task 2 Step 6 and nowhere else. `emit` has one definition
and three call sites, all in Task 2 Step 5. `arena_matches_term` is defined and called once each in
Task 3 Step 2.
