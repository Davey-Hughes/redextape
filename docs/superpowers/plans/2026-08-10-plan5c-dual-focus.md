# Plan 5c — Dual Focus While Running: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each pane reports, live as the run advances, which source construct the model is currently working on.

**Architecture:** A provenance tag on `Node::App`, written at lowering and inherited by every rebuild on the reduction path. This works because reduction over this representation creates no node ex nihilo — every constructor call rebuilds a node corresponding to exactly one input node — so β destroys *positional* identity (paths, which is why `node_to_lambda` failed) and not *derivational* identity. The tag is harvested during the root→redex descent `reduce_step` already makes, delivered as `StepEvent::Beta { redex, owner }` and a per-frame `LambdaState` field, and rendered as a second highlight layer beside 5b's clicked pin.

**Tech Stack:** Rust (`redextape-core`, `redextape-wasm`), TypeScript + Vite + CodeMirror 6 (`web/`), Vitest (node + browser projects), Playwright/Chromium, `wasm-pack`.

**Spec:** [`../specs/2026-08-10-plan5c-dual-focus-design.md`](../specs/2026-08-10-plan5c-dual-focus-design.md)

## Global Constraints

- **`///` for Rust doc comments, `/** */` for TypeScript.** `web/` had inherited Rust's `///`, where it is inert.
- **Pre-commit runs `cargo fmt`, `cargo clippy --all-targets -D warnings`, `biome ci --error-on-warnings`, and a web typecheck.** Every commit must pass all four. **Never `--no-verify`.** If a task's commit split turns out to be infeasible under the gate — most often because a binding is deliberately left unused for a later task — collapse the commits and say so in the commit message. That is this project's existing convention.
- **No attribution in commit messages.** No `Co-Authored-By`, no `Generated with`.
- **Every λ-driving probe runs under the tree's cgroup convention**, stated in `crates/redextape-core/examples/frame_cost_probe.rs:5-8`:
  `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- <cargo command>`
  **and must drive `LambdaCursor`, never `reduce_trace`**, which materialises every step's term by contract and is how an earlier measurement consumed 60 GiB of RAM and 29 GiB of swap. An OOM-kill is a RESULT to report, not something to work around by raising the cap.
- **`web/` uses pnpm.** `pnpm test` runs both projects; `pnpm test:node` and `pnpm test:browser` scope by vitest *project*. Vitest's `-- <name>` filter does **not** scope which files run.
- **`NodeId` is `u32`** (`crates/redextape-core/src/core.rs:5`).
- **Parallel work needs disjoint compile units, not merely disjoint files.** Two agents editing different files in the same crate both run `cargo test -p <crate>`, and a transient compile error in one fails the other's run for reasons it cannot diagnose. Tasks 1–8 are all `redextape-core` and serialise.

---

### Task 1: The tag on `Node::App`, and the layout assertion that pins it

Adds the field and threads it through all 36 `Node::App` sites with no behaviour change — every existing constructor keeps producing `None`. The commit is wide because the compiler makes it wide; that is the property being bought, since no site can be silently missed.

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs:56` (the `App` variant), `:252-257` (`app`)
- Modify (mechanical, `Node::App(f, a)` → `Node::App(f, a, _)`): `crates/redextape-core/src/lambda/reduce.rs`, `crates/redextape-core/src/lambda/decode.rs`, `crates/redextape-core/src/lambda/lower.rs`, `crates/redextape-core/src/lambda/syntax.rs`, `crates/redextape-core/src/lib.rs`, `crates/redextape-core/src/trace/zipper.rs`, `crates/redextape-core/src/viewmodel.rs`
- Test: `crates/redextape-core/src/lambda/term.rs` (the existing `mod tests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `pub fn app(f: LambdaTerm, a: LambdaTerm) -> LambdaTerm` (unchanged signature, tags `None`); `pub fn app_owned(f: LambdaTerm, a: LambdaTerm, owner: NodeId) -> LambdaTerm`; `Node::App(LambdaTerm, LambdaTerm, Option<NodeId>)`; `LambdaTerm::owner(&self) -> Option<NodeId>`.

- [ ] **Step 1: Write the failing test**

In `crates/redextape-core/src/lambda/term.rs`, inside the existing `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn app_is_untagged_and_app_owned_carries_its_node() {
        let plain = app(abs("x", var(0)), var(0));
        assert_eq!(plain.owner(), None, "`app` must not invent a provenance tag");

        let tagged = app_owned(abs("x", var(0)), var(0), 7);
        assert_eq!(tagged.owner(), Some(7), "`app_owned` must carry the NodeId it was given");

        // A non-App node has no owner and must not pretend otherwise.
        assert_eq!(var(0).owner(), None);
        assert_eq!(abs("x", var(0)).owner(), None);
    }
```

**There is deliberately no runtime test of `size_of::<Node>()`.** The `const _` assertion in Step 3 is
a *compile-time* gate: if it holds, a runtime `assert_eq!` on the same expression can never fail, and
a test that cannot fail is one that proves nothing. The gate is the check; a test beside it would be
decoration that reads as coverage.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --lib lambda::term::tests::app_is_untagged`
Expected: FAIL — `cannot find function 'app_owned' in this scope`, and `no method named 'owner'`.

- [ ] **Step 3: Add the variant field, the constructors, and the accessor**

In `crates/redextape-core/src/lambda/term.rs`, change the `App` variant (currently line 56):

```rust
    /// Application, with the source construct it was lowered from.
    ///
    /// **THE TAG IS INHERITED, NEVER RECOMPUTED.** Reduction creates no node ex nihilo — every
    /// constructor call on the reduction path rebuilds a node corresponding to exactly one input node
    /// (design §2.1 tabulates all ten sites) — so a tag written once at lowering remains well-defined
    /// after any number of β-steps. That is the whole difference from `node_to_lambda`, whose paths
    /// were *positional* and went stale after one contraction.
    ///
    /// **IT COSTS NOTHING.** `Option<NodeId>` here leaves `size_of::<Node>()` at 40 bytes, because the
    /// compiler packs it into the discriminant word's padding — measured, and pinned by the `const _`
    /// below. Putting it on the `LambdaTerm` handle instead, which the two existing `u32`s suggest by
    /// analogy, costs 16 bytes per node and 8 per handle.
    App(LambdaTerm, LambdaTerm, Option<NodeId>),
```

Add the import at the top of the file, beside the existing `use` items:

```rust
use crate::core::NodeId;
```

Replace `app` (currently lines 252-257) and add `app_owned` and `owner`:

```rust
pub fn app(f: LambdaTerm, a: LambdaTerm) -> LambdaTerm {
    app_tagged(f, a, None)
}

/// `app`, carrying the Core node this application was lowered from.
///
/// Used only by `lower.rs`, and only at the sites where the `App` being built IS a Core node's own
/// root. `encode.rs` deliberately does not call this: a Church numeral's internal applications belong
/// to no source construct, and tagging them with the numeral's own id would claim they do.
pub fn app_owned(f: LambdaTerm, a: LambdaTerm, owner: NodeId) -> LambdaTerm {
    app_tagged(f, a, Some(owner))
}

/// The shared body. Private, because a caller passing `None` explicitly should call `app`, and the
/// two public constructors exist so the call sites read as tagged or untagged at a glance.
fn app_tagged(f: LambdaTerm, a: LambdaTerm, owner: Option<NodeId>) -> LambdaTerm {
    let maxfree = f.maxfree().max(a.maxfree());
    // The DEEPER child, not the sum: depth is the longest path, not a size.
    let depth = f.depth().max(a.depth()).saturating_add(1);
    LambdaTerm(Rc::new(Node::App(f, a, owner)), maxfree, depth)
}
```

Add the accessor inside `impl LambdaTerm`, beside `node()`:

```rust
    /// The source construct this node was lowered from, if it is a tagged `App`.
    ///
    /// `None` for `Var`, `Abs`, and any `App` that no source construct owns — which is most of them in
    /// a real program, because `encode.rs` mints every combinator untagged. See design §5.1: `None` is
    /// the correct answer there, not a gap.
    pub fn owner(&self) -> Option<NodeId> {
        match self.node() {
            Node::App(_, _, owner) => *owner,
            Node::Var(_) | Node::Abs(_, _) => None,
        }
    }
```

Add the layout gate at module level, immediately after the `Node` enum:

```rust
/// **THE TAG MUST STAY FREE.** `Option<NodeId>` on `App` packs into the discriminant word's padding,
/// leaving `Node` at 40 bytes — measured 2026-08-10 (design §2.2). Rust guarantees no enum layout, so
/// this is a compile-time gate rather than a comment: if a future field pushes `Node` to 48, this fails
/// the build instead of silently costing 8 bytes on a type prone to 375x logical blow-up.
const _: () = assert!(std::mem::size_of::<Node>() == 40);
```

- [ ] **Step 4: Fix every `Node::App` pattern the compiler names**

Run: `cargo build -p redextape-core --all-targets 2>&1 | grep -c "this pattern has 2 fields, but"`

Every such site takes a third pattern element. **Read-only sites take `_`:**

```rust
// before
Node::App(f, a) => { /* ... */ }
// after
Node::App(f, a, _) => { /* ... */ }
```

Do **not** reconstruct any `App` by hand in this task; every construction site already goes through `app()`, which now supplies `None`. If the compiler names a site that builds `Node::App(..)` directly, route it through `app()` instead and note it in the commit message — a direct construction bypasses the depth and maxfree invariants, which is a pre-existing bug rather than something this task introduced.

- [ ] **Step 5: Run the full core suite to verify nothing changed behaviourally**

Run: `cargo test -p redextape-core`
Expected: PASS, including the two new tests. **Every pre-existing test must still pass unchanged** — this task adds a field that is always `None`, so any behavioural difference is a mistake.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src
git commit -m "feat(lambda): a provenance tag on Node::App, free and pinned

Option<NodeId> on App leaves size_of::<Node>() at 40 bytes — the compiler
packs it into the discriminant word's padding — and a const _ assertion
turns that measurement into a build failure if it ever stops holding. The
handle placement the existing two u32s suggest by analogy costs 16 bytes
per node and 8 per handle.

Every constructor still produces None, so this commit changes no behaviour.
It is wide because the compiler makes it wide across 36 Node::App sites,
which is the property being bought: no site can be silently missed."
```

---

### Task 2: Propagation, and the totality test that proves it

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs:291-320` (`shift`), `:321-380` (`subst`), `:391-430` (`beta_go`)
- Test: `crates/redextape-core/tests/lambda_provenance.rs` (create)

**Interfaces:**
- Consumes: `app_tagged` (private, same module), `LambdaTerm::owner`, `Node::App(_, _, Option<NodeId>)` from Task 1.
- Produces: the invariant that every `App` in a reduct carries the tag of the `App` it was rebuilt from. Nothing new is exported.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/lambda_provenance.rs`:

```rust
//! The tag survives β. Design §2.1 asserts that reduction creates no node ex nihilo; this file is
//! that assertion made executable, because the whole coordinate system rests on it.

use redextape_core::lambda::reduce::reduce_step;
use redextape_core::lambda::term::{LambdaTerm, Node, abs, app, app_owned, var};

/// Every `App` reachable in `t`, as owner tags. Order is a pre-order walk, which is stable enough to
/// compare two terms' multisets without depending on the walk itself.
fn owners(t: &LambdaTerm) -> Vec<Option<u32>> {
    let mut out = Vec::new();
    let mut stack = vec![t.clone()];
    while let Some(cur) = stack.pop() {
        match cur.node() {
            Node::App(f, a, owner) => {
                out.push(*owner);
                stack.push(f.clone());
                stack.push(a.clone());
            }
            Node::Abs(_, b) => stack.push(b.clone()),
            Node::Var(_) => {}
        }
    }
    out
}

#[test]
fn shift_preserves_every_tag() {
    // A term with a free variable, so `shift` cannot take its identity fast path.
    let t = app_owned(abs("x", app_owned(var(0), var(3), 2)), var(3), 1);
    let shifted = redextape_core::lambda::term::shift(1, 0, &t);
    let mut before = owners(&t);
    let mut after = owners(&shifted);
    before.sort_unstable();
    after.sort_unstable();
    assert_eq!(before, after, "shift rebuilt an App without carrying its tag");
}

#[test]
fn subst_preserves_tags_from_both_the_body_and_the_argument() {
    // `subst` replaces index 0 in the body with `s`; `s`'s own tags must arrive intact, once per
    // occurrence, and the body's surviving Apps must keep theirs.
    let s = app_owned(var(5), var(6), 99);
    let body = app_owned(var(0), app_owned(var(0), var(1), 3), 2);
    let out = redextape_core::lambda::term::subst(0, &s, &body);

    let got = owners(&out);
    assert_eq!(got.iter().filter(|o| **o == Some(99)).count(), 2, "one copy of the argument per occurrence");
    assert!(got.contains(&Some(2)), "the body's outer App lost its tag");
    assert!(got.contains(&Some(3)), "the body's inner App lost its tag");
}

#[test]
fn a_full_reduction_never_produces_a_tag_that_was_not_in_the_source_term() {
    // TOTALITY, which is the property design §2.1 actually claims: every tag in the reduct traces to
    // a tag in the original. A propagation bug that INVENTED a tag would pass the two tests above.
    let t = app_owned(abs("f", app(var(0), var(0))), abs("y", app_owned(var(0), var(0), 42)), 7);

    let mut allowed: Vec<Option<u32>> = owners(&t);
    allowed.sort_unstable();
    allowed.dedup();

    let mut cur = t;
    for _ in 0..20 {
        let Some((next, _path)) = reduce_step(&cur) else { break };
        for tag in owners(&next) {
            assert!(allowed.contains(&tag), "reduction invented the tag {tag:?}, which was in no source node");
        }
        cur = next;
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --test lambda_provenance`
Expected: FAIL — `shift_preserves_every_tag` and `subst_preserves_tags_from_both_the_body_and_the_argument` both report empty-vs-tagged mismatches, because `shift`/`subst`/`beta_go` currently rebuild through `app()`, which writes `None`.

- [ ] **Step 3: Carry the tag at every rebuild site**

In `crates/redextape-core/src/lambda/term.rs`, each `App` rebuild in `shift`, `subst` and `beta_go` currently calls `app(...)`. Each must instead preserve the tag of the node it is rebuilding. In every one of the three functions the `App` arm has the shape:

```rust
        // before
        Node::App(f, a) => app(shift(d, cutoff, f), shift(d, cutoff, a)),
        // after — `owner` now binds, and rides the rebuild
        Node::App(f, a, owner) => app_tagged(shift(d, cutoff, f), shift(d, cutoff, a), *owner),
```

Apply the same change in `subst`'s `App` arm and `beta_go`'s `App` arm. `Abs` and `Var` arms are untouched — they carry no tag. The identity fast paths (`t.clone()` when the function cannot affect the term) need no change at all: cloning the handle preserves the tag by definition, which is the cheapest possible correctness.

Add to `app_tagged`'s doc comment:

```rust
/// **ALSO THE PROPAGATION CONSTRUCTOR.** `shift`, `subst` and `beta_go` call this with the tag of the
/// node they are rebuilding, which is what makes the tag survive β. A rebuild that called `app`
/// instead would silently drop provenance on exactly the path this design exists to follow.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --test lambda_provenance`
Expected: PASS, all three.

Then: `cargo test -p redextape-core`
Expected: PASS — in particular `tests/lambda_sharing.rs`, which asserts allocations are shared across steps. The identity fast paths are untouched, so sharing must be unchanged; a failure there means a fast path was accidentally converted into a rebuild.

- [ ] **Step 5: Mutation-check the totality test**

Temporarily change `beta_go`'s `App` arm to write `Some(0)` instead of `*owner`. Run
`cargo test -p redextape-core --test lambda_provenance`.
Expected: `a_full_reduction_never_produces_a_tag_that_was_not_in_the_source_term` FAILS.

If it passes, the test is not doing its job — the generated term's tag set probably already contains `Some(0)`. Change the test's tags to values that cannot collide (e.g. 7, 42, 99) and re-check. **Revert the mutation before committing.**

This step exists because 5a-i, 5a-ii and 5b each recorded that nearly every Important review finding was a test that proved nothing.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/lambda/term.rs crates/redextape-core/tests/lambda_provenance.rs
git commit -m "feat(lambda): the tag survives beta, and a totality test proves it

shift, subst and beta_go now rebuild through app_tagged carrying the tag of
the node they rebuild. The identity fast paths need no change: cloning a
handle preserves the tag by definition.

The load-bearing test is totality — every tag in the reduct traces to a tag
in the original — because the two per-function tests would both pass against
a propagation that INVENTED tags. Mutation-checked against beta_go writing a
constant."
```

---

### Task 3: Tag at lowering

**Files:**
- Modify: `crates/redextape-core/src/lambda/lower.rs:299-306` (`BinOp`), `:312-319` (`If`), `:325-337` (`Apply`), `:339-350` (`Let`), `:351-364` (`LetRec`)
- Test: `crates/redextape-core/tests/lambda_provenance.rs` (extend)

**Interfaces:**
- Consumes: `app_owned` from Task 1.
- Produces: lowered terms whose Core-root `App`s carry their `NodeId`. Consumed by Task 4's harvest.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/lambda_provenance.rs`:

```rust
#[test]
fn lowering_tags_each_core_construct_at_its_own_root() {
    // `let x = 40; x + 2` is the app's own sample program and the one `viewmodel_contract.rs` uses to
    // pin that `node_to_lambda` never named `x + 2`. Both constructs must now be tagged.
    let (program, diags) = redextape_core::parser::parse("let x = 40; x + 2");
    assert!(diags.is_empty(), "the sample program must parse cleanly: {diags:?}");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("the sample program lowers");

    let tags: Vec<Option<u32>> = owners(&term);
    let present: std::collections::BTreeSet<u32> = tags.into_iter().flatten().collect();

    assert!(!present.is_empty(), "lowering produced no tags at all");
    // Every tag must be a NodeId the source map knows, or the tag names nothing a consumer can resolve.
    for id in &present {
        assert!(map.source_span(*id).is_some(), "tag {id} resolves to no source span");
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --test lambda_provenance lowering_tags`
Expected: FAIL — `lowering produced no tags at all`.

- [ ] **Step 3: Tag at the five Core-root sites**

In `crates/redextape-core/src/lambda/lower.rs`, `lower_expr` already calls `origins.at_root(core.id())` on entry (`lower.rs:283`), so the id is in scope. At each of the five sites, the **outermost** `app(...)` — the one that IS this Core node's root — becomes `app_owned(..., core.id())`. Inner applications belonging to the construct's *implementation* stay untagged.

```rust
// Core::Apply — lower.rs:325-337
// before
app(fun, arg)
// after
app_owned(fun, arg, core.id())
```

```rust
// Core::Let — lower.rs:339-350; the App whose function side is the binder
// before
app(abs(name.clone(), body), value)
// after
app_owned(abs(name.clone(), body), value, core.id())
```

```rust
// Core::LetRec — lower.rs:351-364; the OUTER App only. The inner `app(fix(), ...)` is the
// implementation of recursion, not a source construct, and stays untagged.
// before
app(abs(name.clone(), body), app(fix(), abs(name.clone(), value)))
// after
app_owned(abs(name.clone(), body), app(fix(), abs(name.clone(), value)), core.id())
```

```rust
// Core::BinOp — lower.rs:299-306; the outermost application of the operator to its second argument
// before
app(app(op_fn, lhs), rhs)
// after
app_owned(app(op_fn, lhs), rhs, core.id())
```

```rust
// Core::If — lower.rs:312-319; the outermost application
// before
app(app(app(cond, then_branch), else_branch), unit)
// after
app_owned(app(app(cond, then_branch), else_branch), unit, core.id())
```

**The exact expression at each site may differ from the sketches above** — read the site and tag the outermost `app` of that arm, whatever its arguments are. The rule is: exactly one `app_owned` per arm, at the construct's own root.

Update the import line at the top of `lower.rs` to bring `app_owned` in beside `app`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --test lambda_provenance`
Expected: PASS, all four.

Run: `cargo test -p redextape-core`
Expected: PASS. The oracle tests are the ones to watch — tagging must not change what any program *computes*.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/lambda/lower.rs crates/redextape-core/tests/lambda_provenance.rs
git commit -m "feat(lower): tag each Core construct's own root App

Five sites — Apply, Let, LetRec, BinOp, If — each tagging exactly the App
that IS the construct's root. Inner applications belonging to a construct's
implementation stay untagged, and encode.rs stays untagged entirely: a
Church numeral's internal applications belong to no source construct, and
claiming otherwise is the silently-wrong answer this design refuses.

The test asserts every emitted tag resolves to a source span, so a tag that
names nothing a consumer can resolve fails the build."
```

---

### Task 4: `Owner`, harvested from the descent `reduce_step` already makes

**Files:**
- Modify: `crates/redextape-core/src/lambda/reduce.rs:179-209`
- Test: `crates/redextape-core/tests/lambda_provenance.rs` (extend)

**Interfaces:**
- Consumes: tagged terms from Task 3.
- Produces:
  - `pub enum Owner { Exact(NodeId), Within(NodeId), None }` in `crates/redextape-core/src/lambda/reduce.rs`, deriving `Clone, Copy, Debug, PartialEq, Eq` and `#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]`
  - `pub fn reduce_step(t: &LambdaTerm) -> Option<(LambdaTerm, Path, Owner)>` — **the return tuple grows to three**; Task 5 consumes it.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/lambda_provenance.rs`:

```rust
use redextape_core::lambda::reduce::Owner;

#[test]
fn contracting_a_tagged_redex_reports_exact() {
    // The redex App carries tag 7 itself.
    let t = app_owned(abs("x", var(0)), var(3), 7);
    let (_next, path, owner) = reduce_step(&t).expect("a redex exists");
    assert!(path.is_empty(), "the redex is at the root");
    assert_eq!(owner, Owner::Exact(7));
}

#[test]
fn contracting_an_untagged_redex_under_a_tagged_ancestor_reports_within() {
    // Outer App is tagged 5 and is NOT a redex (its function side is an App, not an Abs).
    // The redex is the untagged inner App on the function side.
    let inner = app(abs("x", var(0)), var(1));
    let t = app_owned(inner, var(2), 5);
    let (_next, path, owner) = reduce_step(&t).expect("a redex exists");
    assert_eq!(path, vec![redextape_core::lambda::term::Dir::AppL]);
    assert_eq!(owner, Owner::Within(5), "the innermost tagged ancestor, not the redex's own tag");
}

#[test]
fn contracting_with_no_tag_anywhere_reports_none() {
    // Design §5.1: this is the COMMON case in real programs, not an edge case.
    let t = app(abs("x", var(0)), var(3));
    let (_next, _path, owner) = reduce_step(&t).expect("a redex exists");
    assert_eq!(owner, Owner::None);
}

#[test]
fn exact_beats_an_enclosing_tag() {
    // Both the redex and its ancestor are tagged; the redex's OWN tag wins.
    let redex = app_owned(abs("x", var(0)), var(1), 9);
    let t = app_owned(redex, var(2), 5);
    let (_next, _path, owner) = reduce_step(&t).expect("a redex exists");
    assert_eq!(owner, Owner::Exact(9), "a node's own tag must beat its ancestor's");
}

#[test]
fn within_names_the_innermost_enclosing_tag_not_the_outermost() {
    // Two tagged ancestors. The INNER one (3) must win over the outer one (5).
    let redex = app(abs("x", var(0)), var(1));
    let middle = app_owned(redex, var(2), 3);
    let t = app_owned(middle, var(4), 5);
    let (_next, _path, owner) = reduce_step(&t).expect("a redex exists");
    assert_eq!(owner, Owner::Within(3), "innermost enclosing, not outermost");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --test lambda_provenance`
Expected: FAIL — `cannot find type 'Owner'`, and the destructuring of a 3-tuple from a 2-tuple return.

- [ ] **Step 3: Add `Owner` and thread the enclosing tag through the descent**

In `crates/redextape-core/src/lambda/reduce.rs`, add above `reduce_step`:

```rust
/// Which source construct a β-step belongs to.
///
/// **THREE STATES, NOT TWO, AND THAT IS THE DECISION THIS SLICE TURNS ON.** `Exact` and `Within` are
/// different claims — *this step IS that construct* against *this step is somewhere inside it* — and a
/// consumer given one flag cannot tell them apart. 5b's design refused the containment shape outright
/// on the TM leg (*"'nearest enclosing linkable node' frequently means highlight the entire program,
/// which is worse than reporting nothing"*), and it was right to for a single-signal consumer.
/// Distinguishing them here is the same move that replaced `truncated: bool` with `cut: Option<Cut>`:
/// two different kinds of object must not collapse into one.
///
/// **`Within` IS A CLAIM ABOUT THE REDUCT'S STRUCTURE, NOT THE LOWERING'S.** After N substitutions the
/// innermost tagged `App` enclosing the redex is a node of the reduct. That is a true statement and a
/// DIFFERENT relation from the one `node_to_lambda` expressed; a consumer must not read it as "this
/// construct is being evaluated now".
///
/// **`None` IS COMMON AND CORRECT.** `encode.rs` mints every Church/Scott combinator untagged, so
/// reducing `40 + 2` is overwhelmingly work inside `plus` and two numerals — code with no source
/// construct at all. There is no repair for that and none should be attempted.
///
/// **TWO MORE THINGS THIS CANNOT SAY, stated here because a consumer will otherwise assume it can.**
///
/// It names a construct, NOT A LOCATION. Substitution copies: `subst` returns `s.clone()` per
/// occurrence, and N occurrences share one allocation. So one construct's nodes exist at many
/// positions in the reduct at once. *"The construct being worked on is X"* is honest; *"and X is
/// here"* is not, because X is now everywhere the substitution put it.
///
/// It cannot tell an iteration from its predecessor. `Core::LetRec` copies the tagged body on every
/// unrolling, so all forty iterations of a forty-iteration loop report the same `NodeId`. That is
/// *correct* and it is *not what someone watching a loop wants*. An iteration counter is a different
/// feature and is deliberately not here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Owner {
    /// The contracted `App` carried this construct's own tag.
    Exact(NodeId),
    /// It did not; this is the innermost enclosing construct that did.
    Within(NodeId),
    /// Neither the redex nor any ancestor on the path carried a tag.
    None,
}

impl Owner {
    /// The `NodeId` under either claim, for a consumer that only needs to know WHICH construct.
    /// A consumer that renders the two differently must match on the variant instead.
    pub fn node(&self) -> Option<NodeId> {
        match self {
            Owner::Exact(id) | Owner::Within(id) => Some(*id),
            Owner::None => None,
        }
    }
}
```

Replace `reduce_step` (lines 179-209) with a public wrapper over a helper carrying the enclosing tag:

```rust
/// Perform one leftmost-outermost β-step. Returns the reduced term, the path to the redex, and the
/// source construct the step belongs to, or `None` if `t` is already in normal form.
///
/// **THE OWNER IS HARVESTED FROM A DESCENT THAT ALREADY HAPPENS.** This function walks root→redex
/// regardless; carrying "the innermost tagged node passed so far" down that walk costs one
/// `Option<NodeId>` copy per level, on a path measured at mean 9.3 and max 30. There is no second
/// traversal and no allocation.
pub fn reduce_step(t: &LambdaTerm) -> Option<(LambdaTerm, Path, Owner)> {
    reduce_step_go(t, None)
}

/// `enclosing` is the innermost tag on the path from the root to `t`, EXCLUDING `t` itself — so the
/// root-redex arm can prefer the redex's own tag without the two being confused.
fn reduce_step_go(t: &LambdaTerm, enclosing: Option<NodeId>) -> Option<(LambdaTerm, Path, Owner)> {
    // Redex at the root: (\. body) arg
    if let Node::App(f, a, owner) = t.node()
        && let Node::Abs(_, body) = f.node()
    {
        let who = match (owner, enclosing) {
            (Some(id), _) => Owner::Exact(*id),
            (None, Some(id)) => Owner::Within(id),
            (None, None) => Owner::None,
        };
        return Some((beta(body, a), Vec::new(), who));
    }
    match t.node() {
        Node::App(f, a, owner) => {
            // Descending THROUGH a tagged App makes it the innermost enclosing tag for everything
            // below. `or` and not `or_else`-with-swapped-operands: the node we are passing through is
            // nearer than anything above it.
            let inner = owner.or(enclosing);
            // Try the function side first (leftmost), then the argument. Both `clone`s below are
            // refcount bumps; under `Box` they deep-copied the untouched sibling at every level of
            // the path, which is the cost this representation exists to remove.
            if let Some((f2, mut path, who)) = reduce_step_go(f, inner) {
                path.insert(0, Dir::AppL);
                Some((app_tagged_for_rebuild(f2, a.clone(), *owner), path, who))
            } else if let Some((a2, mut path, who)) = reduce_step_go(a, inner) {
                path.insert(0, Dir::AppR);
                Some((app_tagged_for_rebuild(f.clone(), a2, *owner), path, who))
            } else {
                None
            }
        }
        // An `Abs` carries no tag, so `enclosing` passes through untouched.
        Node::Abs(n, b) => reduce_step_go(b, enclosing).map(|(b2, mut path, who)| {
            path.insert(0, Dir::AbsBody);
            (abs(std::rc::Rc::clone(n), b2), path, who)
        }),
        Node::Var(_) => None,
    }
}
```

`app_tagged` is private to `term.rs`. Export a rebuild constructor from `term.rs` for use here — add beside `app_owned`:

```rust
/// Rebuild an `App` carrying a tag that is already in hand. **This is the spine-rebuild constructor**,
/// used by `reduce_step` where `app_tagged`'s privacy does not reach; `shift`/`subst`/`beta_go` use
/// `app_tagged` directly because they live in this module.
pub fn app_tagged_for_rebuild(f: LambdaTerm, a: LambdaTerm, owner: Option<NodeId>) -> LambdaTerm {
    app_tagged(f, a, owner)
}
```

Add `NodeId` and `app_tagged_for_rebuild` to `reduce.rs`'s imports.

- [ ] **Step 4: Fix the callers the compiler names**

Run: `cargo build -p redextape-core --all-targets`

Six call sites destructure `reduce_step`'s tuple (`trace.rs:129`, `zipper.rs:391`, `reduce.rs:344`, `reduce.rs:374`, `term.rs:660`, `term.rs:694`, `term.rs:723`). In **this** task give each the third element it now needs, binding `_` where the owner is not yet used:

```rust
// trace.rs:129 — Task 5 replaces this binding with a real use
match reduce_step(&self.current) {
    Some((next, redex, _owner)) => { /* unchanged */ }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --test lambda_provenance`
Expected: PASS, all nine.

Run: `cargo test -p redextape-core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src crates/redextape-core/tests/lambda_provenance.rs
git commit -m "feat(reduce): Owner, harvested from the descent reduce_step already makes

Three states rather than two. Exact and Within are different claims, and a
renderer given one flag cannot draw the weaker one more weakly — the same
reasoning that replaced truncated: bool with cut: Option<Cut>.

The harvest costs one Option<NodeId> copy per level of a walk that already
runs; there is no second traversal. Tests pin all five cases including the
two that a naive fold gets wrong: a node's own tag beats its ancestor's, and
Within names the INNERMOST enclosing tag rather than the outermost."
```

---

### Task 5: `StepEvent` carries the owner, and both β-loops are held equal

The largest task in the slice, because the zipper never builds the redex `App` at all — its tag has to ride the context frame instead.

**Files:**
- Modify: `crates/redextape-core/src/trace.rs:29-32` (`StepEvent`), `:129-134` (`LambdaCursor::next`)
- Modify: `crates/redextape-core/src/trace/zipper.rs:33-55` (`Frame`), `:337-347` (`reduce_here`), `:375-377` (`next`), and the `seek`/`push` sites that build `Frame::AppL`
- Test: `crates/redextape-core/tests/zipper_equivalence.rs` (existing, extended by the type change)

**Interfaces:**
- Consumes: `Owner`, `reduce_step`'s 3-tuple from Task 4.
- Produces: `StepEvent::Beta { redex: Path, owner: Owner }`; `LambdaCursor::last_redex(&self) -> Option<&Path>`; `LambdaCursor::last_owner(&self) -> Owner`. Task 6 consumes both accessors.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/lambda_provenance.rs`:

```rust
#[test]
fn the_cursor_exposes_the_last_step_owner_and_redex() {
    let t = app_owned(abs("x", var(0)), var(3), 7);
    let mut c = redextape_core::trace::LambdaCursor::new(&t, 100);
    assert_eq!(c.last_owner(), Owner::None, "before any step there is no owner");
    assert!(c.last_redex().is_none(), "before any step there is no redex");

    let ev = c.next().expect("one step");
    assert_eq!(ev, redextape_core::trace::StepEvent::Beta { redex: Vec::new(), owner: Owner::Exact(7) });
    assert_eq!(c.last_owner(), Owner::Exact(7), "the cursor must retain what the event carried");
    assert_eq!(c.last_redex(), Some(&Vec::new()));
}

#[test]
fn both_beta_loops_agree_on_the_owner() {
    // zipper_equivalence.rs holds the two loops equal across 256 generated programs; this is the
    // targeted case for the field it cannot generate — a tagged term.
    let t = app_owned(abs("f", app(var(0), var(0))), abs("y", app_owned(var(0), var(0), 42)), 7);

    let plain: Vec<_> = redextape_core::trace::LambdaCursor::new(&t, 50).collect();
    let zipped: Vec<_> = redextape_core::trace::zipper::ZipperCursor::new(&t, 50).collect();
    assert_eq!(plain, zipped, "the two beta loops disagree on Owner");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --test lambda_provenance`
Expected: FAIL — `StepEvent::Beta` has no field `owner`; no method `last_owner`.

- [ ] **Step 3: Extend `StepEvent` and `LambdaCursor`**

In `crates/redextape-core/src/trace.rs`:

```rust
pub enum StepEvent {
    Beta { redex: Path, owner: Owner },
    Delta { state: StateId, rule: u32 },
}
```

Add two fields to `LambdaCursor` (beside `depth_capped`):

```rust
    /// The last step's redex path and owner.
    ///
    /// **CAPTURED AT THE STEP BECAUSE THE NODE IS GONE AFTERWARDS.** `beta` consumes the redex `App`
    /// and its `Abs`, so no question asked of `current` after the fact can recover either. This is a
    /// hard constraint on the delivery shape, not a caching convenience — see design §3.5.
    last_redex: Option<Path>,
    last_owner: Owner,
```

Initialise both in `LambdaCursor::new` (`last_redex: None, last_owner: Owner::None`), and set them in `next`:

```rust
        match reduce_step(&self.current) {
            Some((next, redex, owner)) => {
                self.current = next;
                self.steps += 1;
                self.last_redex = Some(redex.clone());
                self.last_owner = owner;
                Some(StepEvent::Beta { redex, owner })
            }
```

Add the accessors in `impl LambdaCursor`:

```rust
    /// The path to the redex contracted by the most recent step, or `None` before any step.
    pub fn last_redex(&self) -> Option<&Path> {
        self.last_redex.as_ref()
    }

    /// The source construct the most recent step belonged to. `Owner::None` before any step, which is
    /// the same answer as "the step belonged to no construct" — indistinguishable, and correctly so:
    /// a frame at step 0 has no step to attribute.
    pub fn last_owner(&self) -> Owner {
        self.last_owner
    }
```

- [ ] **Step 4: Carry the tag on the zipper's `AppL` frame**

In `crates/redextape-core/src/trace/zipper.rs`, the redex `App` is never built — `reduce_here` pops a `Frame::AppL` holding the argument. So the tag must be **saved on the frame when the App is decomposed**:

```rust
enum Frame {
    /// `owner` is the tag of the `App` this frame decomposed. **It is stored here because the `App`
    /// itself is never rebuilt on the reduction path** (`reduce_here`'s doc), so there is no node left
    /// to read it from at the moment the step is reported.
    AppL { arg: LambdaTerm, saved_depth: (u32, u32), owner: Option<NodeId> },
    AppR { fun: LambdaTerm, saved_depth: (u32, u32), owner: Option<NodeId> },
    AbsBody { name: Rc<str>, saved_depth: (u32, u32) },
}
```

Add to `impl Frame`:

```rust
    /// The tag of the `App` this frame decomposed, or `None` for `AbsBody`, which decomposed an `Abs`.
    fn owner(&self) -> Option<NodeId> {
        match self {
            Frame::AppL { owner, .. } | Frame::AppR { owner, .. } => *owner,
            Frame::AbsBody { .. } => None,
        }
    }
```

Every site that constructs `Frame::AppL` or `Frame::AppR` destructures a `Node::App(f, a, owner)` to do so — pass that `*owner` through. Every site that rebuilds an `App` on the climb (`advance`, `term`) must pass the frame's `owner` to `app_tagged_for_rebuild` rather than to `app`.

Change `reduce_here` to return the owner alongside the path:

```rust
    /// Reduce the redex the invariant points at, in place. **The `App` node is never built:** the
    /// focus is `Abs(_, body)` and the popped frame holds `arg`, which is everything `beta` needs.
    /// Returns the path to the redex `App` and the construct the step belongs to — the tag comes off
    /// the popped frame, since the `App` it belonged to is never reconstructed.
    fn reduce_here(&mut self) -> (Path, Owner) {
        let Node::Abs(_, body) = self.focus.node() else {
            unreachable!("the seek invariant guarantees an Abs focus");
        };
        let body = body.clone();
        let Some(Frame::AppL { arg, owner, .. }) = self.pop() else {
            unreachable!("the seek invariant guarantees an AppL top frame");
        };
        // The innermost tag STRICTLY ABOVE the redex, read after the pop so the redex's own frame is
        // already gone. Same relation `reduce_step_go`'s `enclosing` carries, computed differently
        // because a context stack is available here and a descent is not.
        let enclosing = self.stack.iter().rev().find_map(Frame::owner);
        let who = match (owner, enclosing) {
            (Some(id), _) => Owner::Exact(id),
            (None, Some(id)) => Owner::Within(id),
            (None, None) => Owner::None,
        };
        self.focus = beta(&body, &arg);
        (self.path(), who)
    }
```

And in `next`:

```rust
        let (redex, owner) = self.reduce_here();
        self.steps += 1;
        Some(StepEvent::Beta { redex, owner })
```

- [ ] **Step 5: Run the equivalence gate**

Run: `cargo test -p redextape-core --test zipper_equivalence`
Expected: PASS. This is the gate that matters — 256 generated programs plus ten curated shapes, now comparing `owner` as well as `redex` and term, **for free**, because it compares whole `StepEvent`s.

Run: `cargo test -p redextape-core --test lambda_provenance`
Expected: PASS, all eleven.

Run: `cargo test -p redextape-core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src crates/redextape-core/tests
git commit -m "feat(trace): StepEvent carries Owner, and both beta loops are held equal

The zipper never builds the redex App — reduce_here pops a frame holding the
argument — so the tag rides Frame::AppL rather than being read off a node
that does not exist at the moment the step is reported. The enclosing tag
comes from a reverse scan of the context stack, the same relation
reduce_step_go's descent carries, computed differently because a stack is
available here and a descent is not.

zipper_equivalence extends for free: it compares whole StepEvents across 256
generated programs and ten curated shapes, so it now holds the two loops
equal on Owner without a line of new test code. That gate is why two beta
loops are tolerable at all."
```

---

### Task 6: `LambdaState` carries the redex and the owner

**Files:**
- Modify: `crates/redextape-core/src/viewmodel.rs:56-63` (the struct), `:191-196` (`render`)
- Test: `crates/redextape-core/tests/viewmodel_contract.rs` (extend)

**Interfaces:**
- Consumes: `LambdaCursor::last_redex`, `LambdaCursor::last_owner` from Task 5.
- Produces: `LambdaState { text, spans, cut, step, redex: Option<Path>, owner: Owner }`. Task 7 puts it on the wire.

- [ ] **Step 1: Write the failing test**

Append to `crates/redextape-core/tests/viewmodel_contract.rs`:

```rust
#[test]
fn a_rendered_frame_carries_the_step_that_produced_it() {
    let (program, _) = redextape_core::parser::parse("let x = 40; x + 2");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, _map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("lowers");
    let mut c = redextape_core::trace::LambdaCursor::new(&term, 1000);

    let at_zero = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    assert_eq!(at_zero.step, 0);
    assert!(at_zero.redex.is_none(), "step 0 precedes any contraction");
    assert_eq!(at_zero.owner, redextape_core::lambda::reduce::Owner::None);

    c.next().expect("at least one step");
    let after = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    assert_eq!(after.step, 1);
    assert!(after.redex.is_some(), "a frame after a step must name the redex it contracted");
}

/// The case `node_to_lambda` could never answer, and the reason it was deleted:
/// `viewmodel_contract.rs` already pins that all seven steps of this program reported `let x = 40;`
/// and `x + 2` was never named. At least one step must now name `x + 2`.
#[test]
fn some_step_of_the_sample_program_names_the_addition() {
    let (program, _) = redextape_core::parser::parse("let x = 40; x + 2");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("lowers");

    let plus_span = {
        let mut found = None;
        let mut c = redextape_core::trace::LambdaCursor::new(&term, 5_000);
        while c.next().is_some() {
            if let Some(id) = c.last_owner().node()
                && let Some(span) = map.source_span(id)
                && &"let x = 40; x + 2"[span.start..span.end] == "x + 2"
            {
                found = Some(span);
                break;
            }
        }
        found
    };
    assert!(plus_span.is_some(), "no step ever named `x + 2` — the defect node_to_lambda was deleted for");
}

/// Spec §8.6. A `Within` answer must name a construct that genuinely CONTAINS an `Exact` answer's,
/// or "innermost enclosing" is not what the harvest computes.
#[test]
fn a_within_span_strictly_contains_an_exact_span_from_the_same_descent() {
    // Redex untagged, under a tagged ancestor (5), under an outer tagged node (1). The Within answer
    // must be 5, and 5's source span must sit inside 1's.
    let (program, _) = redextape_core::parser::parse("let x = 40; x + 2");
    let program = program.expect("parsed");
    let enc = redextape_core::tm::EncodingKind::Unary.at(redextape_core::tm::MIN_FIELD_WIDTH);
    let (core, map) = redextape_core::sourcemap::SourceMap::build_from_program(&program, &*enc);
    let term = redextape_core::lambda::lower(&core).expect("lowers");

    let mut exact: Vec<redextape_core::span::Span> = Vec::new();
    let mut within: Vec<redextape_core::span::Span> = Vec::new();
    let mut c = redextape_core::trace::LambdaCursor::new(&term, 5_000);
    while c.next().is_some() {
        match c.last_owner() {
            redextape_core::lambda::reduce::Owner::Exact(id) => {
                if let Some(s) = map.source_span(id) {
                    exact.push(s);
                }
            }
            redextape_core::lambda::reduce::Owner::Within(id) => {
                if let Some(s) = map.source_span(id) {
                    within.push(s);
                }
            }
            redextape_core::lambda::reduce::Owner::None => {}
        }
    }

    assert!(!exact.is_empty(), "no Exact answer on the sample program");
    // Every Within span must contain at least one Exact span, or the enclosing relation is not what
    // the harvest computes. NOT "every Exact is inside every Within" — they come from different steps.
    for w in &within {
        assert!(
            exact.iter().any(|e| w.start <= e.start && e.end <= w.end) || exact.iter().all(|e| e == w),
            "a Within span at {w:?} contains no Exact span — the enclosing relation is wrong"
        );
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --test viewmodel_contract a_rendered_frame`
Expected: FAIL — `LambdaState` has no field `redex`.

- [ ] **Step 3: Extend the struct and `render`**

```rust
pub struct LambdaState {
    pub text: String,
    pub spans: Vec<(Span, TokenClass)>,
    pub cut: Option<Cut>,
    pub step: u64,
    /// The redex contracted by the step that produced this frame; `None` at step 0.
    ///
    /// A `Path` INTO THE TERM THIS FRAME HOLDS, which is exactly `print_lambda_linked`'s contract —
    /// and exactly what `node_to_lambda` was not. The distinction is the whole slice: this path is
    /// resolved against the term it was taken from, never against a later one.
    pub redex: Option<Path>,
    /// The source construct the step belonged to.
    pub owner: Owner,
}
```

```rust
    pub fn render(c: &LambdaCursor, byte_budget: usize, depth_cap: u32) -> LambdaState {
        let (text, spans, cut) = print_lambda_capped(c.term(), byte_budget, depth_cap);
        LambdaState {
            text,
            spans,
            cut,
            step: c.steps_taken(),
            redex: c.last_redex().cloned(),
            owner: c.last_owner(),
        }
    }
```

Update the struct's existing doc comment: the paragraph explaining why `TmState.source_node` survived while the λ field was removed now needs its successor named. Append:

```rust
/// **AND THE λ SIDE NOW HAS ONE AGAIN, BY A DIFFERENT MECHANISM.** `owner` is not a coordinate into a
/// tree that reduction rewrites — it is a tag inherited by every rebuild, so it does not go stale after
/// one step the way `node_to_lambda`'s paths did. `redex` IS a path, and is honest precisely because it
/// is scoped to the frame that carries it.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --test viewmodel_contract`
Expected: PASS. `some_step_of_the_sample_program_names_the_addition` is the headline — the case three slices could not answer.

Run: `cargo test -p redextape-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/viewmodel.rs crates/redextape-core/tests/viewmodel_contract.rs
git commit -m "feat(viewmodel): a frame carries the step that produced it

redex and owner, both captured at the step because beta consumes the redex
App and no question asked of the resulting term can recover either.

The headline test is that some step of `let x = 40; x + 2` names `x + 2` —
the case viewmodel_contract already pins node_to_lambda could never answer,
where all seven steps reported `let x = 40;` and the addition was never
named."
```

---

### Task 7: The wasm boundary and the JS wire type

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs` (re-export `Owner` if the boundary needs it), `crates/redextape-wasm/tests/browser.rs`
- Modify: `web/src/types.ts:70`, `web/src/protocol.ts:104-105`
- Test: `web/tests/node/protocol.test.ts`, `web/tests/node/types.test.ts`

**Interfaces:**
- Consumes: `LambdaState` from Task 6.
- Produces: `export type Owner = 'None' | { Exact: number } | { Within: number }` and `LambdaState` gaining `redex: string[] | null; owner: Owner` in `web/src/types.ts`; `ownerNode(o: Owner): number | null` in `web/src/types.ts`.

- [ ] **Step 1: Write the failing test**

In `web/tests/node/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { lambdaFrameBytes } from '../../src/protocol'
import type { LambdaState } from '../../src/types'

describe('lambdaFrameBytes', () => {
  const base: LambdaState = { text: 'ab', spans: [], cut: null, step: 1, redex: null, owner: 'None' }

  it('charges for the redex path, or the ring under-reports', () => {
    const withPath: LambdaState = { ...base, redex: ['AppL', 'AppR', 'AbsBody'] }
    expect(lambdaFrameBytes(withPath)).toBeGreaterThan(lambdaFrameBytes(base))
  })

  it('charges the same for every owner variant, since they are one tagged value', () => {
    const exact: LambdaState = { ...base, owner: { Exact: 3 } }
    const within: LambdaState = { ...base, owner: { Within: 3 } }
    expect(lambdaFrameBytes(exact)).toBe(lambdaFrameBytes(within))
  })
})
```

In `web/tests/node/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ownerNode } from '../../src/types'

describe('ownerNode', () => {
  it('reads the node out of either claim', () => {
    expect(ownerNode({ Exact: 7 })).toBe(7)
    expect(ownerNode({ Within: 5 })).toBe(5)
  })

  it('is null for None, which is a common and correct answer', () => {
    expect(ownerNode('None')).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && pnpm test:node -- protocol types`
Expected: FAIL — `ownerNode` is not exported; `LambdaState` has no `redex`.

Note: vitest's `--` filter narrows by test *name*, not by file, so this runs the whole node project and reports these as the failures. That is expected; do not try to scope it by file.

- [ ] **Step 3: Add the types and the sizer terms**

In `web/src/types.ts`, replacing line 70:

```ts
/**
 * Which source construct a β-step belongs to.
 *
 * Three states rather than two, and the renderer must keep them apart: `Exact` says this step IS that
 * construct, `Within` says only that it happened somewhere inside it. Collapsing them would re-adopt
 * the shape 5b refused on the TM leg, where "nearest enclosing linkable node" frequently means
 * "highlight the entire program".
 *
 * `'None'` is common and correct — most of a λ term is Church/Scott encoding, which belongs to no
 * source construct at all.
 */
export type Owner = 'None' | { Exact: number } | { Within: number }

export type LambdaState = {
  text: string
  spans: Classified
  cut: Cut | null
  step: number
  redex: string[] | null
  owner: Owner
}

/** The `NodeId` under either claim, or `null`. A consumer that renders the two claims differently must match on the variant instead of calling this. */
export function ownerNode(o: Owner): number | null {
  if (o === 'None') return null
  return 'Exact' in o ? o.Exact : o.Within
}
```

In `web/src/protocol.ts`, add the constants and extend the sizer:

```ts
/** One `Dir` in a redex path: an interned string literal, so the retained cost is a reference. */
export const PATH_ENTRY_BYTES = 8

/** One `Owner`: a small tagged object, or an interned `'None'` literal. Rounded up. */
export const OWNER_BYTES = 16

export function lambdaFrameBytes(f: LambdaState): number {
  return (
    FRAME_OVERHEAD_BYTES +
    f.text.length +
    f.spans.length * SPAN_BYTES +
    (f.redex?.length ?? 0) * PATH_ENTRY_BYTES +
    OWNER_BYTES
  )
}
```

- [ ] **Step 4: Fix the wasm browser-test assertions**

**A wire rename passes every LOCAL gate and fails only in CI** — the print-depth-cap slice hit exactly this. `crates/redextape-wasm/tests/browser.rs` reads the wire **by string key**, so no compiler check exists, and neither `cargo clippy --all-targets` nor `cargo test --workspace` compiles or runs the wasm-pack browser tier.

Grep for every `lambdaState` assertion in that file and add the two new keys:

```bash
grep -n "lambdaState\|linkIndex" crates/redextape-wasm/tests/browser.rs
```

Run: `wasm-pack test --headless --chrome crates/redextape-wasm`
Expected: PASS. **This step is not optional and cannot be skipped locally** — it is the only gate that catches this class before CI.

Note: Chrome lives in `/usr/sbin` and is off-PATH, so `--chrome` can appear unavailable when it is not. Prepend `PATH=$PATH:/usr/sbin` if `wasm-pack` reports no browser.

- [ ] **Step 5: Run the web tests**

Run: `cd web && pnpm test:node`
Expected: PASS.

Run: `cd web && pnpm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src web/tests crates/redextape-wasm
git commit -m "feat(web): Owner and redex on the wire, and the sizer charges for them

lambdaFrameBytes gains terms for both, or the 32 MB ring under-reports and
evicts later than it believes. The addition is ~4-8 bytes against a measured
~10 KB frame; the point is the sizer's correctness, not the magnitude.

The wasm browser-test assertions read the wire by string key, so no compiler
check exists for them and neither cargo clippy --all-targets nor cargo test
--workspace runs that tier. Updated and verified with wasm-pack directly —
the print-depth-cap slice merged a break of exactly this shape."
```

---

### Task 8: M1 and M2, against thresholds already fixed

**Files:**
- Create: `crates/redextape-core/examples/owner_probe.rs`

**Interfaces:**
- Consumes: `Owner`, `LambdaCursor`, `SourceMap` from Tasks 1–6.
- Produces: two tables. M2's result decides whether Task 9 renders `Within` as a highlight or as a status line.

- [ ] **Step 1: Write the probe**

Create `crates/redextape-core/examples/owner_probe.rs`. Its module doc must carry the cap convention verbatim, as `frame_cost_probe.rs:5-8` does:

```rust
//! **How often does a β-step name a source construct, and how wide is the answer when it only
//! contains one?** M1 and M2 of the 5c design.
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --example owner_probe
//! ```
//!
//! **The cap is not decoration and `MemorySwapMax=0` is the load-bearing half.** An earlier
//! measurement over a comparable family took 60 GiB of RAM and 29 GiB of swap and wedged the machine.
//! An OOM-kill or a timeout here is a RESULT to report, not something to work around by raising the
//! cap.
//!
//! **Drives `trace::LambdaCursor`, never `reduce_trace`**, which materialises every step's term by
//! contract and is how the 60 GiB run happened. Rows are flushed BEFORE the next is computed.
```

The corpus is `frame_cost_probe.rs:107-133`'s, copied verbatim so the columns are comparable with every figure this Plan has already recorded: `sample`, `list2`, `while4`, `sum5`, `countdown4`, `map_fold`, `num200`, `list20`, `list60`.

For each program: parse, build the source map, lower, drive a `LambdaCursor` to `MAX_REDUCTION_STEPS`, and count. Print two tables:

```text
M1 — tagged-contraction rate
program      steps   Exact    Within     None   Exact%
sample          7        2         4        1    28.6%
...

M2 — Within span width, as a fraction of program length
program      Within  median%   p90%   max%   verdict
sample            4     31.2   44.0   44.0   ok
...
```

M2's verdict column applies the threshold **fixed before the numbers exist**: `degenerate` when the median `Within` span exceeds **60%** of program length, `ok` otherwise.

The counting loop, which is the whole probe:

```rust
fn measure(src: &str) -> (u64, u64, u64, Vec<f64>) {
    let (program, _) = parser::parse(src);
    let Some(program) = program else { return (0, 0, 0, Vec::new()) };
    let enc = EncodingKind::Unary.at(tm::MIN_FIELD_WIDTH);
    let (core, map) = SourceMap::build_from_program(&program, &*enc);
    let Ok(term) = lambda::lower(&core) else { return (0, 0, 0, Vec::new()) };

    let (mut exact, mut within, mut none) = (0u64, 0u64, 0u64);
    let mut widths: Vec<f64> = Vec::new();
    // `LambdaCursor`, NEVER `reduce_trace` — see this file's module doc.
    let mut c = trace::LambdaCursor::new(&term, lambda::MAX_REDUCTION_STEPS);
    while c.next().is_some() {
        match c.last_owner() {
            Owner::Exact(_) => exact += 1,
            Owner::Within(id) => {
                within += 1;
                if let Some(s) = map.source_span(id) {
                    widths.push((s.end - s.start) as f64 / src.len() as f64 * 100.0);
                }
            }
            Owner::None => none += 1,
        }
    }
    (exact, within, none, widths)
}
```

Flush each row with `println!` **before** computing the next, as `frame_cost_probe.rs` does, so an OOM-kill leaves the completed rows on stdout instead of losing the table.

- [ ] **Step 2: Run it under the cap**

Run:
```bash
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example owner_probe
```
Expected: two tables. Record the actual numbers — they go in the roadmap entry at the end of the slice.

- [ ] **Step 3: Apply M2's verdict**

If **more than one** corpus program reports `degenerate`, Task 9 renders `Within` as a status-line answer only and not as a highlight. Write the verdict and the numbers into a comment at the top of `web/src/link.ts` so the renderer's choice cites its own evidence rather than a decision nobody can find.

**Do not renegotiate the threshold after seeing the number.** It was fixed in the spec for this reason. If the number is close to 60% and the temptation arises, that is the situation the threshold exists for.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/examples/owner_probe.rs
git commit -m "probe: M1 and M2 — how often a beta-step names a construct, and how wide

Corpus copied verbatim from frame_cost_probe so the columns are comparable
with every figure this Plan has recorded. M1 reports rather than gates,
which is the payoff for Owner having three states: under a single-signal
design a low tagged rate would have been fatal.

M2's 60% threshold was fixed in the spec before these numbers existed."
```

---

### Task 9: The source pane's running focus

**Files:**
- Modify: `web/src/link.ts`, `web/src/main.ts`, `web/src/style.css`
- Test: `web/tests/node/link.test.ts`

**Interfaces:**
- Consumes: `Owner`, `ownerNode` from Task 7; `LinkIndex.source_nodes`.
- Produces: `runningFocus(index: LinkIndex | null, owner: Owner): { node: number; claim: 'exact' | 'within' } | null` in `web/src/link.ts`.

- [ ] **Step 1: Write the failing test**

In `web/tests/node/link.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { runningFocus } from '../../src/link'
import type { LinkIndex } from '../../src/types'

/**
 * A minimal index carrying nodes 3 and 4. Build it with the same shape `link.test.ts`'s existing
 * fixtures use — read one of them and match it rather than inventing a second convention.
 */
const index: LinkIndex = {
  source_nodes: [3, 4],
  source_spans: [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
  ],
  // ...remaining LinkIndex fields, copied from the existing fixture in this file
} as LinkIndex

describe('runningFocus', () => {
  it('resolves an Exact owner to its node, tagged as an exact claim', () => {
    expect(runningFocus(index, { Exact: 3 })).toEqual({ node: 3, claim: 'exact' })
  })

  it('resolves a Within owner to the same node under a WEAKER claim', () => {
    expect(runningFocus(index, { Within: 3 })).toEqual({ node: 3, claim: 'within' })
  })

  it('is null for None', () => {
    expect(runningFocus(index, 'None')).toBeNull()
  })

  it('is null when the index is stale, exactly as a click would be', () => {
    // Same rule main.ts already applies to `linkable`: an index from the last compile has stale
    // spans, and resolving against it is the silently-wrong answer this project refuses.
    expect(runningFocus(null, { Exact: 3 })).toBeNull()
  })

  it('is null when the owner names a node the index does not carry', () => {
    expect(runningFocus(index, { Exact: 99999 })).toBeNull()
  })
})
```

**Read `web/tests/node/link.test.ts`'s existing fixture before writing this** and reuse its construction rather than the sketch above — `LinkIndex` is columnar and has more fields than the two shown. A second fixture convention in one file is the kind of drift this project's reviews catch.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test:node -- runningFocus`
Expected: FAIL — `runningFocus` is not exported.

- [ ] **Step 3: Implement and wire**

Add `runningFocus` to `web/src/link.ts` as a pure function beside the existing four — **no DOM**, matching that file's stated contract.

In `main.ts`, `draw()` computes the running focus from the current λ frame's `owner` and paints it as a **second layer** beside the existing `link`. The pin keeps its current class; the focus gets `.is-focus-exact` / `.is-focus-within`.

In `style.css`, define the two new classes plus `.is-focus-coincident` for when the pin and focus name the same node. All three need light and dark values — PR #20's toggle makes that a real constraint. `Within` must read as **visibly weaker** than `Exact`.

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm test:node`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src web/tests/node/link.test.ts
git commit -m "feat(web): the source pane's running focus, as a second layer

The pin and the focus are different objects and stay visually distinct.
Suppressing the focus while a pin is set would turn the highlight off at
exactly the moment it is most wanted — when a construct is pinned and the
user is waiting for the run to reach it. 5b's own precedent: a direct
gesture does not stop the run.

runningFocus returns null against a stale index, the same rule main.ts
already applies to clicks."
```

---

### Task 10: The λ pane lights its own redex

**Files:**
- Modify: `crates/redextape-core/src/viewmodel.rs` (`render` supplies `want`), `crates/redextape-wasm/src/session.rs`, `web/src/lambda-pane.ts`
- Test: `crates/redextape-core/tests/viewmodel_contract.rs`, `web/tests/node/lambda-window.test.ts`

**Interfaces:**
- Consumes: `LambdaState.redex` from Task 6; `print_lambda_linked` (`syntax.rs:286-291`).
- Produces: `LambdaState.redex_span: Option<Span>` — the redex's byte span in **this frame's own text**.

- [ ] **Step 1: Write the failing test**

In `crates/redextape-core/tests/viewmodel_contract.rs`:

```rust
#[test]
fn a_frame_locates_its_own_redex_in_its_own_text() {
    let t = app_owned(abs("x", var(0)), var(3), 7);
    let mut c = redextape_core::trace::LambdaCursor::new(&t, 100);
    c.next().expect("one step");
    let f = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    // The span must index THIS frame's text, not the previous one's.
    if let Some(span) = f.redex_span {
        assert!(span.end <= f.text.len(), "the redex span must index this frame's own text");
    }
}

/// A UTF-8 case, because 5b's worst bug was byte offsets sliced as UTF-16 indices and every fixture
/// that could have caught it was pure ASCII — on the one function whose input is GUARANTEED to
/// contain `λ`.
#[test]
fn the_redex_span_is_in_bytes_over_text_containing_lambdas() {
    let t = app_owned(abs("f", abs("x", app(var(1), var(0)))), abs("y", var(0)), 1);
    let mut c = redextape_core::trace::LambdaCursor::new(&t, 100);
    c.next().expect("one step");
    let f = redextape_core::viewmodel::LambdaState::render(&c, 65536, 1000);
    assert!(f.text.contains('λ'), "this fixture must exercise multi-byte characters");
    if let Some(span) = f.redex_span {
        assert!(f.text.is_char_boundary(span.start), "span.start split a character");
        assert!(f.text.is_char_boundary(span.end), "span.end split a character");
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p redextape-core --test viewmodel_contract a_frame_locates`
Expected: FAIL — no field `redex_span`.

- [ ] **Step 3: Implement**

`render` currently calls `print_lambda_capped`, which is already `print_lambda_linked` with an empty `want` (`syntax.rs:241-249`) recording at one site, `Printer::node` (`syntax.rs:391-419`). **Supplying a non-empty `want` uses the walk that was happening anyway** — there is no second print and no per-step cost increase. Change `render` to call `print_lambda_linked` directly, passing the cursor's `last_redex` as its `want`, and store the resulting span.

**The path is resolved against the term this frame holds**, which is the printer's actual contract and the precise thing `node_to_lambda` was not. Say so in the field's doc comment.

Then thread `redex_span` through the wasm boundary and TS type as in Task 7, and have `lambda-pane.ts` paint it.

- [ ] **Step 4: Run tests**

Run: `cargo test -p redextape-core` — Expected: PASS.
Run: `wasm-pack test --headless --chrome crates/redextape-wasm` — Expected: PASS. (Task 7's lesson: this tier is not covered by any other local gate.)
Run: `cd web && pnpm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core crates/redextape-wasm web/src web/tests
git commit -m "feat: the lambda pane lights its own redex, at no extra walk

print_lambda_capped is already print_lambda_linked with an empty want, and
recording happens at one site. Supplying a non-empty want uses the walk that
was happening anyway rather than adding one.

The path is resolved against the term the frame holds, which is the
printer's contract and precisely what node_to_lambda was not. The UTF-8 test
exists because 5b's worst bug was byte offsets sliced as UTF-16 indices, and
every fixture that could have caught it was pure ASCII."
```

---

### Task 11: The TM pane, coincidence, and the palette

**Files:**
- Modify: `web/src/tm-pane.ts`, `web/src/state-table.ts`, `web/src/link-status.ts`, `web/src/style.css`
- Test: `web/tests/node/state-table.test.ts`, `web/tests/node/link-status.test.ts`

**Interfaces:**
- Consumes: `runningFocus` from Task 9; `TmState.source_node` (already shipped).
- Produces: coincidence detection — the pin and the focus naming one node.

- [ ] **Step 1: Write the failing test**

Add to `web/tests/node/link.test.ts`:

```ts
describe('coincidence', () => {
  it('reports coincidence when the pin and the focus name one node', () => {
    expect(isCoincident({ node: 3, origin: 'source' }, { node: 3, claim: 'exact' })).toBe(true)
  })

  it('does not report coincidence when they name different nodes', () => {
    expect(isCoincident({ node: 3, origin: 'source' }, { node: 4, claim: 'exact' })).toBe(false)
  })

  it('does not report coincidence when only the pin is set', () => {
    expect(isCoincident({ node: 3, origin: 'source' }, null)).toBe(false)
  })

  it('does not report coincidence when only the focus is set', () => {
    expect(isCoincident(null, { node: 3, claim: 'exact' })).toBe(false)
  })

  it('reports coincidence for a Within claim too, since the pin IS inside it', () => {
    // A weaker claim is still a true one about the pinned construct. The renderer draws the pair
    // differently by reading `claim`; coincidence itself does not depend on which claim it is.
    expect(isCoincident({ node: 3, origin: 'source' }, { node: 3, claim: 'within' })).toBe(true)
  })
})
```

And to `web/tests/node/state-table.test.ts`:

```ts
describe('the running focus on the delta table', () => {
  it('marks the state row whose block owns the current step', () => {
    const rows = stateRows(program, { current: 4, focusNode: 3 })
    expect(rows.filter((r) => r.isFocus).map((r) => r.id)).toEqual([4])
  })

  it('marks no row when the focus names a node with no TM block', () => {
    // 50-82% TM coverage is the measured norm, so this is the common case and not an edge one.
    const rows = stateRows(program, { current: 4, focusNode: 99999 })
    expect(rows.some((r) => r.isFocus)).toBe(false)
  })
})
```

**Match `state-table.ts`'s real row-building signature** rather than the `stateRows(program, opts)` sketch above — read the file first. The assertions are the contract; the call shape is whatever that file already uses.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && pnpm test:node -- coincidence`
Expected: FAIL — `isCoincident` is not exported.

- [ ] **Step 3: Implement**

Add `isCoincident(pin, focus)` to `web/src/link.ts` as a pure function beside `runningFocus`.

The TM leg needs **no new Rust**: `TmState.source_node` shipped 2026-07-30 and resolves through `SourceMap::tm_owner`. `state-table.ts` gains an `isFocus` flag per row, `tm-pane.ts` paints it, and `style.css` gains `.state-row.is-focus` in both themes.

`link-status.ts` gains the focus's answer alongside the pin's.

**Note for the accessibility pass, which this slice does not do:** `#link-status` is still a plain `<div>` that announces nothing, and this task gives it a second live-updating job. Add it to the roadmap's deferred-a11y list as an aggravation of item 6 rather than fixing it here — 5c is not the a11y pass, and doing a piece of it here is exactly what that deferral decision exists to prevent.

- [ ] **Step 4: Run tests**

Run: `cd web && pnpm test:node`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src web/tests
git commit -m "feat(web): the TM leg's running focus, and coincidence

No new Rust — TmState.source_node shipped 2026-07-30 and resolves through
SourceMap::tm_owner. This is renderer work.

Coincidence — the pin and the focus naming one node — gets its own treatment
rather than two overlapping highlights. It is the state the app exists to
show."
```

---

### Task 12: The browser tier, and the eyeball gate

**Files:**
- Create: `web/tests/browser/running-focus.test.ts`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Write the browser tests**

A new file rather than cases in `app.test.ts`. That suite runs ~40 tests against one long-lived page and worker, and 5b/print-depth-cap both found that a program needing many steps degrades badly there against a fresh page. The isolation is needed either way.

Cover: the focus moves during a run; scrubbing backwards shows the **historical** answer rather than the current one; the pin and the focus coexist without either disappearing; a program whose steps are all untagged shows no focus and does not error.

- [ ] **Step 2: Run**

Run: `cd web && pnpm test:browser`
Expected: PASS.

- [ ] **Step 3: The eyeball gate — not optional, and not a measurement**

Run the real app (`cd web && pnpm dev`) and watch `while4` and `map_fold` actually run.

Judge: **is `Within`'s answer meaningful, or merely present?** M2 measured span *width*, which is a proxy for degeneration and not for legibility. This is the one question this project's usual discipline has no measurement for, and the spec says so.

**No doc-comment may claim the feature is legible on M1/M2 numbers alone.** If `Within` reads as noise, fall back to the status-line rendering per Task 8's verdict rule and record that in the roadmap — a negative result here is a result, not a failure.

- [ ] **Step 4: Write the roadmap entry**

Append a `#### PLAN 5c CLOSES` entry to the Plan 5 log at the end of the roadmap, carrying: M1 and M2's actual numbers, the eyeball gate's verdict in plain words, what the slice could not establish, and the two new colour-carried states added to the deferred-a11y list (§4.3's focus layers, plus `#link-status`'s second job from Task 11).

Follow the log's established voice: measurements over reasoning, corrections marked in place rather than rewritten, and anything unmeasured stated rather than smoothed over.

- [ ] **Step 5: Full gate, then commit**

```bash
cargo test -p redextape-core
scripts/check-all.sh --no-llvm
wasm-pack test --headless --chrome crates/redextape-wasm
cd web && pnpm test && pnpm run build
pre-commit run --all-files
```

All must be green.

```bash
git add web/tests/browser/running-focus.test.ts docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "test(browser): the running focus, in its own file — and 5c's roadmap entry

Its own file rather than cases in app.test.ts: that suite runs ~40 tests
against one long-lived page and worker, and two previous slices found that a
program needing many steps degrades badly there against a fresh page.

The eyeball gate's verdict is recorded in the roadmap in plain words. M2
measured span width, which proxies degeneration and not legibility, and
legibility was only ever decidable by watching the app run."
```
