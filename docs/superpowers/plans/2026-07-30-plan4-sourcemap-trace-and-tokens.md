# Plan 4 producer slice — source maps, delta step stream, token classification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data layer the web UI and CLI will render — `NodeId`-keyed source maps into both backends, a delta-shaped lazy step stream, and token classification for all four languages.

**Architecture:** Every map is a *returned artifact*, never a struct field: each mapped function returns its map alongside its existing output, and the existing unmapped function is reimplemented over it, so there is exactly one implementation and the two cannot drift. Paths accumulate leaf-to-root during lowering and are reversed once at the end, so composing them is linear rather than quadratic. The TM step delta is a rule *reference* — the machine is immutable during a run, so `(state, rule)` determines the writes and moves.

**Tech Stack:** Rust (edition 2024), `redextape-core` only. No new dependencies. `cargo-nextest` is the test runner (`cargo test` for doctests).

**Design spec:** `docs/superpowers/specs/2026-07-30-plan4-sourcemap-trace-and-tokens-design.md` (read for rationale).

## Global Constraints

- **No git attribution.** Never add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any similar trailer to commit messages or PR bodies.
- **`redextape-core` stays WASM-clean and dependency-free.** It has zero dependencies today — add none. No `serde`, no `smallvec`, no ANSI crate.
- **Rust edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- **Every mapped/unmapped pair has ONE implementation.** `lower` = `lower_mapped(..).map(|(t, _)| t)`, `print_asm` = `print_asm_mapped(..).0`, and likewise for every other pair. A second parallel implementation is a plan violation, not a style preference.
- **No signature changes to existing public functions**, and no field added to `Program`, `Machine`, or `LambdaTerm`. All three derive `PartialEq`, and `parse_tm(print_tm(m)) == m` is asserted — a side-table field would break it.
- **Totality (cardinal rule).** Total on any input. Keep every existing guard: `MAX_LOWER_DEPTH`, `MAX_DEFUNC_DEPTH`, `MAX_PARSE_DEPTH`, `MAX_TERM_DEPTH`, `MAX_REDUCTION_STEPS`, `Caps`. No `.unwrap()`/`.expect()`/panic on any library path; test and example code may panic deliberately.
- **This slice adds observation only.** No backend may compute a different result, and no printed output may change by even one byte. The existing suites are the regression evidence.
- **No ANSI or CSS in core.** Core emits classified spans; escape codes belong to consumers.
- **`cargo fmt --all --check` and `cargo clippy --workspace --all-targets -- -D warnings` must pass at every commit** (pre-commit hooks run both).

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `crates/redextape-core/src/lambda/lower.rs` | modify | Add `lower_mapped`; `lower` becomes a wrapper. Threads `(NodeId, Path)` pairs. |
| `crates/redextape-core/src/lambda.rs` | modify | Re-export `lower_mapped`. |
| `crates/redextape-core/src/sourcemap.rs` | create | `SourceMap`, its two builders, and the coverage invariant. |
| `crates/redextape-core/src/trace.rs` | create | `StepEvent`, `LambdaCursor`, `TmCursor`. |
| `crates/redextape-core/src/tm/sim.rs` | modify | `run` restructured over a resumable stepper; `Step` gains a rule index. |
| `crates/redextape-core/src/lambda/reduce.rs` | modify | `reduce_trace` reimplemented over `LambdaCursor`. |
| `crates/redextape-core/src/analysis.rs` | create | `TokenClass`, `classify_source`, and the highlight composition. |
| `crates/redextape-core/src/tm/asm.rs` | modify | Add `print_asm_mapped`; `print_asm` becomes a wrapper. |
| `crates/redextape-core/src/lambda/syntax.rs` | modify | Add `print_lambda_mapped`; `print_lambda` becomes a wrapper. |
| `crates/redextape-core/src/tm/syntax.rs` | modify | Add `print_tm_with_mapped`; `print_tm_with` becomes a wrapper. |
| `crates/redextape-core/src/lib.rs` | modify | Declare `sourcemap`, `trace`, `analysis`. |
| `crates/redextape-core/tests/sourcemap_coverage.rs` | create | §10.4 coverage across the demo corpus. |
| `crates/redextape-core/tests/trace_equivalence.rs` | create | Cursor-derived traces vs. today's output; non-`TAPES` machine. |
| `crates/redextape-core/tests/span_wellformed.rs` | create | Span invariants for all four classifiers. |

---

### Task 1: λ `lower_mapped` — `NodeId → Path`

**Files:**
- Modify: `crates/redextape-core/src/lambda/lower.rs` (`lower` at line 98)
- Modify: `crates/redextape-core/src/lambda.rs:13` (re-export)

**Interfaces:**
- Consumes: `Core::id() -> NodeId` (`core.rs:66`), `Path = Vec<Dir>`, `Dir::{AppL, AppR, AbsBody}` (`lambda/term.rs`).
- Produces: `lambda::lower_mapped(&Core) -> Result<(LambdaTerm, Vec<(NodeId, Path)>), LowerError>`. Paths are root-relative and forward-ordered. `lambda::lower` keeps its exact current signature.

**Why paths accumulate reversed.** Lowering builds terms bottom-up, so a subterm's position is only known once its parents wrap it. Each recorded path is therefore accumulated **leaf-to-root** (`push`, not `insert(0, ..)`) and reversed once at the end. Prefixing with `insert(0, ..)` at every level would be O(entries × depth) per level.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module at the end of `crates/redextape-core/src/lambda/lower.rs`:

```rust
#[test]
fn lower_mapped_agrees_with_lower_and_locates_the_root() {
    let (prog, ds) = crate::parser::parse("1 + 2");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = crate::desugar::desugar(&prog.unwrap());
    let (mapped, pairs) = lower_mapped(&core).expect("lowers");
    // One implementation: the wrapper must return exactly what the mapped form's first element is.
    assert_eq!(lower(&core).expect("lowers"), mapped);
    // The root Core node maps to the empty path — it IS the whole term.
    let root = pairs.iter().find(|(id, _)| *id == core.id()).expect("root node is mapped");
    assert_eq!(root.1, Vec::<Dir>::new(), "the root node's path must be empty");
    // Every recorded path must actually resolve to a subterm of the produced term.
    for (id, path) in &pairs {
        assert!(subterm_at(&mapped, path).is_some(), "node {id} path {path:?} does not resolve");
    }
}

/// Walk `path` from the root of `t`. Returns `None` if the path leaves the term.
fn subterm_at<'a>(t: &'a LambdaTerm, path: &[Dir]) -> Option<&'a LambdaTerm> {
    let mut cur = t;
    for d in path {
        cur = match (d, cur) {
            (Dir::AppL, LambdaTerm::App(f, _)) => f,
            (Dir::AppR, LambdaTerm::App(_, a)) => a,
            (Dir::AbsBody, LambdaTerm::Abs(_, b)) => b,
            _ => return None,
        };
    }
    Some(cur)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p redextape-core --lib lambda::lower::tests::lower_mapped_agrees -- --nocapture`
Expected: FAIL — `cannot find function 'lower_mapped' in this scope`.

- [ ] **Step 3: Add the recorder and thread it**

In `lambda/lower.rs`, add above `lower`:

```rust
/// Records `NodeId -> Path` while the term is built. Paths accumulate LEAF-TO-ROOT (`push`, never
/// `insert(0, ..)`) and are reversed once in `lower_mapped`; prefixing at every level would be
/// O(entries * depth) per level. `wrap` is called by each parent as it wraps its children.
#[derive(Default)]
struct Origins {
    pairs: Vec<(NodeId, Path)>,
}

impl Origins {
    /// Record that `id` produced the subterm currently at the accumulation root.
    fn at_root(&mut self, id: NodeId) {
        self.pairs.push((id, Vec::new()));
    }

    /// Every path recorded at or after `from` gains `d` — the parent just wrapped those subterms.
    fn wrap(&mut self, from: usize, d: Dir) {
        for (_, p) in &mut self.pairs[from..] {
            p.push(d);
        }
    }

    fn mark(&self) -> usize {
        self.pairs.len()
    }
}
```

Change `lower` into a wrapper and add the mapped entry point:

```rust
pub fn lower(core: &Core) -> Result<LambdaTerm, LowerError> {
    lower_mapped(core).map(|(t, _)| t)
}

/// `lower`, plus a `NodeId -> Path` map into the produced term. Paths are root-relative and
/// forward-ordered. Compilation is syntax-directed, so the map falls out of the traversal (§5.4).
pub fn lower_mapped(core: &Core) -> Result<(LambdaTerm, Vec<(NodeId, Path)>), LowerError> {
    let mut scope: Vec<String> = Vec::new();
    let mut origins = Origins::default();
    let term = lower_expr(core, &mut scope, None, &mut origins)?;
    for (_, p) in &mut origins.pairs {
        p.reverse();
    }
    Ok((term, origins.pairs))
}
```

Thread `origins: &mut Origins` through `lower_expr` and every helper it calls, adding a final parameter to each. At each `lower_expr` entry, take `let mark = origins.mark();` and `origins.at_root(core.id());`. Wherever the function combines lowered children into an `App` or `Abs`, call `origins.wrap(child_mark, Dir::…)` for that child's region with the direction that reaches it.

- [ ] **Step 4: Run the test**

Run: `cargo test -p redextape-core --lib lambda::lower::tests::lower_mapped_agrees`
Expected: PASS.

- [ ] **Step 5: Prove equivalence across the whole corpus**

Add to the same `tests` module:

Verified: there is **no shared corpus helper** — `redextape-test-support` exports only `arb_expr_over`, and `tm/attribute.rs` mentions a corpus in prose only. So the strings are inlined here, copied from `examples/tm_demo.rs`'s `first_order` array.

```rust
/// Copied from `examples/tm_demo.rs`'s `first_order` array. No shared corpus helper exists —
/// `redextape-test-support` exports only `arb_expr_over`.
const FIRST_ORDER: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "[1, 2, 3]",
    "head(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
];

#[test]
fn lower_mapped_agrees_with_lower_on_every_demo() {
    for src in FIRST_ORDER {
        let (prog, ds) = crate::parser::parse(src);
        assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
        let core = crate::desugar::desugar(&prog.unwrap());
        match (lower(&core), lower_mapped(&core)) {
            (Ok(plain), Ok((mapped, pairs))) => {
                assert_eq!(plain, mapped, "term differs for {src:?}");
                for (id, path) in &pairs {
                    assert!(subterm_at(&mapped, path).is_some(), "{src:?}: node {id} path {path:?} unresolvable");
                }
            }
            (Err(a), Err(b)) => assert_eq!(format!("{a:?}"), format!("{b:?}"), "error differs for {src:?}"),
            (a, b) => panic!("{src:?}: one form succeeded and the other did not: {a:?} vs {b:?}"),
        }
    }
}
```

The `(Err(a), Err(b))` arm compares `Debug` renderings rather than the errors themselves because `LowerError` does not derive `PartialEq`; if it does by the time this runs, compare directly.

- [ ] **Step 6: Re-export and verify the whole suite**

In `crates/redextape-core/src/lambda.rs:13`, change to:

```rust
pub use lower::{LowerError, lower, lower_mapped};
```

Run: `cargo nextest run -p redextape-core`
Expected: PASS, 572+ tests (570 existing plus the new ones), 0 failed.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/lambda/lower.rs crates/redextape-core/src/lambda.rs
git commit -m "feat(lambda): return a NodeId -> subterm-path map from lowering

lower_mapped records where each Core node landed in the produced term;
lower becomes a wrapper over it, so there is one implementation and the
two cannot drift.

Paths accumulate leaf-to-root and reverse once at the end. Prefixing with
insert(0, ..) as each parent wraps its children would be O(entries *
depth) at every level."
```

---

### Task 2: `sourcemap.rs` — both halves and the coverage invariant

**Files:**
- Create: `crates/redextape-core/src/sourcemap.rs`
- Modify: `crates/redextape-core/src/lib.rs` (add `pub mod sourcemap;`)
- Create: `crates/redextape-core/tests/sourcemap_coverage.rs`

**Interfaces:**
- Consumes: `lambda::lower_mapped` (Task 1); the shipped `tm::lower_asm_mapped(&Core) -> Result<(Program, Vec<NodeId>), LowerError>`, `tm::lower_tm_mapped(&Program, &dyn Encoding) -> (Machine, Vec<Option<usize>>)`, `tm::defunc_mapped(&Core) -> Result<(Core, BTreeSet<NodeId>), LowerError>`.
- Produces: `SourceMap { node_to_lambda: BTreeMap<NodeId, Path>, node_to_tm: BTreeMap<NodeId, Vec<StateId>> }`, `SourceMap::build(&Core, &dyn Encoding) -> SourceMap`, `SourceMap::lambda_path(&self, NodeId) -> Option<&Path>`, `SourceMap::tm_block(&self, NodeId) -> Option<&[StateId]>`.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/sourcemap_coverage.rs`:

```rust
//! §10.4: every Core node maps into BOTH backends. Two exclusions are principled, not convenience —
//! see the module doc of `sourcemap.rs`.

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::Unary;

/// First-order demos, copied from `examples/tm_demo.rs`'s `first_order` array. Both backends accept
/// all of these, so both halves of the map must cover them.
const BOTH_BACKENDS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "[1, 2, 3]",
    "head(cons(1, cons(2, nil)))",
];

fn core_of(src: &str) -> redextape_core::core::Core {
    let (p, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
    desugar(&p.unwrap())
}

/// Every `NodeId` appearing anywhere in the tree. Iterative on purpose — see the note below.
fn all_ids(core: &redextape_core::core::Core) -> Vec<u32> {
    let mut out = Vec::new();
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        out.push(n.id());
        n.for_each_child(&mut |c| stack.push(c));
    }
    out
}

#[test]
fn every_core_node_maps_into_both_backends() {
    for src in BOTH_BACKENDS {
        let core = core_of(src);
        let map = SourceMap::build(&core, &Unary::default());
        for id in all_ids(&core) {
            assert!(map.lambda_path(id).is_some(), "{src:?}: node {id} has no lambda path");
            let block = map.tm_block(id).unwrap_or(&[]);
            assert!(!block.is_empty(), "{src:?}: node {id} has an empty TM block");
        }
    }
}
```

**`Core::for_each_child` does not exist — add it in this task.** Verified: `core.rs` has only `id()` (line 66) plus the private, *destructive* `take_core_children` (line 104), which unlinks children with `mem::replace` to serve the iterative `Drop` and so cannot serve a read-only walk.

Add to `impl Core` in `core.rs`:

```rust
    /// Visit each direct child once. NON-RECURSIVE by contract: `Core` carries a hand-written
    /// iterative `Drop` precisely because a big list literal or long statement sequence desugars to a
    /// spine tens of thousands of nodes deep, and recursive traversal of that spine aborts the process
    /// with an uncatchable stack overflow. A caller walks the tree with its own explicit worklist (see
    /// `all_ids` in `tests/sourcemap_coverage.rs`); this method must never call itself.
    pub fn for_each_child<'a>(&'a self, f: &mut impl FnMut(&'a Core)) {
        match self {
            Core::Nat(..) | Core::Bool(..) | Core::Unit(..) | Core::Var(..) => {}
            Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
                f(a);
                f(b);
            }
            Core::If(_, c, t, e) => {
                f(c);
                f(t);
                f(e);
            }
            Core::Lambda(_, _, body) | Core::Assign(_, _, body) => f(body),
            Core::Apply(_, callee, args) => {
                f(callee);
                for a in args {
                    f(a);
                }
            }
            _ => self.for_each_child_named(f),
        }
    }
```

The `Let`/`LetRec`/`LetRecGroup` variants are struct-like and `LetRecGroup` holds a `Vec`; handle them in a small `for_each_child_named` helper rather than inflating the match. **Read `core.rs`'s enum definition (lines 20–63) and mirror its exact variant shapes** — the arms above are written from the `id()` match and must be checked against the real field lists before compiling.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo nextest run -p redextape-core -E 'test(every_core_node_maps)'`
Expected: FAIL — `unresolved import redextape_core::sourcemap`.

- [ ] **Step 3: Write `sourcemap.rs`**

```rust
//! The sync anchor (§5.4): `NodeId` -> λ-subterm path, and `NodeId` -> TM state block. Both maps are
//! keyed to Core node ids, which is what lets the UI light the same construct in three panes at once.
//!
//! THE TM HALF ADDS NO LOWERING. It inverts the chain the 2026-07-24 slice already shipped:
//! `lower_tm_mapped` gives `state -> code index`, `lower_asm_mapped` gives `code index -> NodeId`.
//! `attribute.rs` composes these forwards to attribute step counts; this inverts the same composition.
//!
//! TWO EXCLUSIONS ARE PRINCIPLED, NOT CONVENIENCE. Ids that `defunc` MINTED have no source construct
//! to point at — which is exactly why `defunc_mapped` returns that set — and are omitted rather than
//! mapped to a lie. Programs the λ backend DECLINES (it returns `LowerError` for a mutable capture
//! rather than risk a silent miscompile) simply have no λ half; `build` leaves `node_to_lambda` empty
//! for those instead of failing, so a TM-only program still gets a usable map.

use std::collections::{BTreeMap, BTreeSet};

use crate::core::{Core, NodeId};
use crate::lambda::{Path, lower_mapped};
use crate::tm::machine::StateId;
use crate::tm::{Encoding, defunc_mapped, lower_asm_mapped, lower_tm_mapped};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SourceMap {
    pub node_to_lambda: BTreeMap<NodeId, Path>,
    pub node_to_tm: BTreeMap<NodeId, Vec<StateId>>,
}

impl SourceMap {
    /// Build both halves. Total: a backend that declines this program contributes an empty half rather
    /// than aborting the build.
    pub fn build(core: &Core, enc: &dyn Encoding) -> SourceMap {
        SourceMap { node_to_lambda: lambda_half(core), node_to_tm: tm_half(core, enc) }
    }

    pub fn lambda_path(&self, id: NodeId) -> Option<&Path> {
        self.node_to_lambda.get(&id)
    }

    pub fn tm_block(&self, id: NodeId) -> Option<&[StateId]> {
        self.node_to_tm.get(&id).map(Vec::as_slice)
    }
}

fn lambda_half(core: &Core) -> BTreeMap<NodeId, Path> {
    // A node may be recorded more than once (a construct can appear in several lowered positions);
    // keep the FIRST, which is the leftmost-outermost occurrence and the one a reader expects.
    let mut out = BTreeMap::new();
    if let Ok((_, pairs)) = lower_mapped(core) {
        for (id, path) in pairs {
            out.entry(id).or_insert(path);
        }
    }
    out
}

fn tm_half(core: &Core, enc: &dyn Encoding) -> BTreeMap<NodeId, Vec<StateId>> {
    // Mirror `run_tm`: try first-order lowering, and defunctionalize only if it rejects the program.
    let (lowered, synthetic): (Core, BTreeSet<NodeId>) = match lower_asm_mapped(core) {
        Ok(_) => (core.clone(), BTreeSet::new()),
        Err(_) => match defunc_mapped(core) {
            Ok(pair) => pair,
            Err(_) => return BTreeMap::new(),
        },
    };
    let Ok((prog, origins)) = lower_asm_mapped(&lowered) else {
        return BTreeMap::new();
    };
    let (machine, state_origins) = lower_tm_mapped(&prog, enc);
    let mut out: BTreeMap<NodeId, Vec<StateId>> = BTreeMap::new();
    for state in 0..machine.states.len() {
        // `None` is machine scaffolding with no instruction behind it; skip rather than invent an owner.
        let Some(Some(code_index)) = state_origins.get(state) else {
            continue;
        };
        let Some(&node) = origins.get(*code_index) else {
            continue;
        };
        if synthetic.contains(&node) {
            continue;
        }
        out.entry(node).or_default().push(state as StateId);
    }
    out
}
```

- [ ] **Step 4: Declare the module**

In `crates/redextape-core/src/lib.rs`, add `pub mod sourcemap;` to the module list (alphabetical, after `prelude`).

- [ ] **Step 5: Run the coverage test**

Run: `cargo nextest run -p redextape-core -E 'test(every_core_node_maps)'`
Expected: PASS.

If it fails naming a specific unmapped node, that is a genuine coverage gap in the lowering, not a test bug — fix `lower_mapped`'s threading (Task 1) or `tm_half`'s composition so the node is covered, and record in the module doc why that node was initially missed.

- [ ] **Step 6: Sabotage-verify the coverage guard**

Temporarily make `lambda_half` return `BTreeMap::new()`. Run the test; it MUST fail naming an unmapped node. Restore. Then temporarily make `tm_half` skip its `synthetic.contains` filter and confirm the suite still passes (the filter only *removes* entries, so this direction should not break coverage — recording that asymmetry is the point).

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/sourcemap.rs crates/redextape-core/src/lib.rs \
        crates/redextape-core/tests/sourcemap_coverage.rs crates/redextape-core/src/core.rs
git commit -m "feat(core): add the NodeId source map into both backends

The TM half adds no lowering — it inverts the chain the 2026-07-24 slice
shipped. attribute.rs composes state -> code index -> NodeId forwards to
attribute step counts; this inverts the same composition.

Coverage is asserted per §10.4 and sabotage-verified. Two exclusions are
principled: defunc-minted ids have no source construct to point at, and a
program the lambda backend declines gets an empty lambda half rather than
a failed build."
```

---

### Task 3: `trace.rs` — `StepEvent` and the λ cursor

**Files:**
- Create: `crates/redextape-core/src/trace.rs`
- Modify: `crates/redextape-core/src/lambda/reduce.rs` (`reduce_trace` at line 124)
- Modify: `crates/redextape-core/src/lib.rs` (add `pub mod trace;`)

**Interfaces:**
- Consumes: `lambda::reduce::reduce_step(&LambdaTerm) -> Option<(LambdaTerm, Path)>`, `Path`, `MAX_REDUCTION_STEPS`, `MAX_TERM_DEPTH`.
- Produces: `trace::StepEvent` (variants `Beta { redex: Path }` and `Delta { state: StateId, rule: u32 }`), `trace::LambdaCursor::new(&LambdaTerm, u64) -> LambdaCursor`, with `impl Iterator<Item = StepEvent> for LambdaCursor` and `LambdaCursor::term(&self) -> &LambdaTerm`.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/src/trace.rs` with only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::lambda::{MAX_REDUCTION_STEPS, lower, reduce_trace};

    fn term_of(src: &str) -> crate::lambda::LambdaTerm {
        let (p, ds) = crate::parser::parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        lower(&crate::desugar::desugar(&p.unwrap())).expect("lowers")
    }

    #[test]
    fn lambda_cursor_emits_the_same_redex_paths_as_reduce_trace() {
        for src in ["1 + 2 * 3", "3 - 5", "let x = 1; let y = x + x; y * 3"] {
            let t = term_of(src);
            let expected: Vec<_> = reduce_trace(&t, MAX_REDUCTION_STEPS).steps.iter().map(|s| s.redex.clone()).collect();
            let got: Vec<_> = LambdaCursor::new(&t, MAX_REDUCTION_STEPS)
                .map(|e| match e {
                    StepEvent::Beta { redex } => redex,
                    other => panic!("lambda cursor emitted a non-Beta event: {other:?}"),
                })
                .collect();
            assert_eq!(got, expected, "redex paths differ for {src:?}");
        }
    }

    #[test]
    fn lambda_cursor_ends_on_the_same_normal_form() {
        let t = term_of("1 + 2 * 3");
        let expected = reduce_trace(&t, MAX_REDUCTION_STEPS).normal_form;
        let mut c = LambdaCursor::new(&t, MAX_REDUCTION_STEPS);
        while c.next().is_some() {}
        assert_eq!(*c.term(), expected);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p redextape-core --lib trace::tests 2>&1 | head -20`
Expected: FAIL — `cannot find type 'LambdaCursor'` / module not declared.

- [ ] **Step 3: Write `StepEvent` and `LambdaCursor`**

At the top of `crates/redextape-core/src/trace.rs`:

```rust
//! One step-event vocabulary over both backends (§9), stepped lazily so a renderer never holds the
//! whole run. Materializing is not viable: the pre-existing `sim::Step` copies every tape each step,
//! measured at 3,488 bytes/step and 592.9 MB for `sum(5)` — row 7 of the demo suite.
//!
//! THE TM DELTA IS A RULE REFERENCE, NOT A COPY OF ITS EFFECTS. The machine is immutable for the
//! duration of a run, so `(state, rule)` determines the writes and head moves — they are recoverable
//! as `m.states[state].rules[rule]`. That makes the variant 8 bytes with no allocation, and it carries
//! NO tape-count assumption: `TAPES` is the lowering's convention, but `Machine::tapes` is a runtime
//! field and `parse_tm` accepts a hand-written machine declaring any count, so a fixed-size
//! `[Option<Symbol>; TAPES]` array would silently mis-shape every such machine.
//!
//! The λ variant does allocate a small `Vec` (`Path`, measured maximum length 30). Accepted rather
//! than optimized: `Path` is what the reducer already produces, and an inline-capacity alternative
//! would need a dependency core is not allowed.

use crate::lambda::reduce::reduce_step;
use crate::lambda::{LambdaTerm, Path};
use crate::tm::machine::StateId;

/// One step of either backend. `Delta`'s `state` is the state BEFORE the transition, matching the
/// convention `sim::Step` and `lambda::reduce::Step` already use.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StepEvent {
    Beta { redex: Path },
    Delta { state: StateId, rule: u32 },
}

/// Lazy β-reduction. Holds one term, never a history — O(1) in the number of steps.
pub struct LambdaCursor {
    current: LambdaTerm,
    steps: u64,
    cap: u64,
    done: bool,
}

impl LambdaCursor {
    pub fn new(t: &LambdaTerm, cap: u64) -> LambdaCursor {
        LambdaCursor { current: t.clone(), steps: 0, cap, done: false }
    }

    /// The term as of the last emitted event (the initial term before the first `next`).
    pub fn term(&self) -> &LambdaTerm {
        &self.current
    }

    pub fn steps_taken(&self) -> u64 {
        self.steps
    }
}

impl Iterator for LambdaCursor {
    type Item = StepEvent;

    fn next(&mut self) -> Option<StepEvent> {
        if self.done || self.steps >= self.cap {
            return None;
        }
        match reduce_step(&self.current) {
            Some((next, redex)) => {
                self.current = next;
                self.steps += 1;
                Some(StepEvent::Beta { redex })
            }
            None => {
                self.done = true;
                None
            }
        }
    }
}
```

Add `pub mod trace;` to `lib.rs`.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p redextape-core --lib trace::tests`
Expected: PASS, 2 tests.

Note: the cursor deliberately omits `reduce_trace`'s `depth_exceeds` guard from the *hot loop*, because `reduce_trace` checks it per step. The next step reinstates it so behaviour is identical.

- [ ] **Step 5: Reimplement `reduce_trace` over the cursor**

The cursor must own the stepping loop, and `reduce_trace` must become a consumer of it. Two loops that both step β-reduction is exactly the drift the one-implementation constraint exists to prevent, and the spec is explicit: *"`reduce_trace` and `simulate_trace` are reimplemented over those cursors."*

First widen the guard's visibility in `lambda/reduce.rs` — change `fn depth_exceeds` to `pub(crate) fn depth_exceeds`. Do **not** add a wrapper; a `_pub`-suffixed alias is a second name for one function.

Then give `LambdaCursor` the guard and a terminal status, so it decides cap behaviour rather than duplicating the decision:

```rust
    fn next(&mut self) -> Option<StepEvent> {
        if self.status.is_some() {
            return None;
        }
        if self.steps >= self.cap {
            self.status = Some(Status::HitCap);
            return None;
        }
        if crate::lambda::reduce::depth_exceeds(&self.current, MAX_TERM_DEPTH) {
            self.status = Some(Status::HitCap);
            return None;
        }
        match reduce_step(&self.current) {
            Some((next, redex)) => {
                self.current = next;
                self.steps += 1;
                Some(StepEvent::Beta { redex })
            }
            None => {
                self.status = Some(Status::Normalized);
                None
            }
        }
    }
```

Replace `LambdaCursor`'s `done: bool` field with `status: Option<Status>` (importing `crate::lambda::Status`), and add `pub fn status(&self) -> Option<Status>` mirroring `TmCursor`'s. Update Task 3's earlier steps to match — the `done` flag was a placeholder for exactly this.

Now `reduce_trace` becomes a consumer. The cursor advances `current` before returning, so the pre-step term must be captured *before* each `next`:

```rust
/// Reduce to normal form (or the cap), recording every step and its redex path. Materializes a
/// snapshot per step BY CONTRACT — this is the API that promises the full history; `trace::LambdaCursor`
/// is the O(1) alternative for callers that only walk forward. The stepping itself lives in the cursor,
/// so there is one β-reduction loop in this crate rather than two that must be kept in agreement.
pub fn reduce_trace(t: &LambdaTerm, cap: u64) -> Trace {
    let mut cursor = crate::trace::LambdaCursor::new(t, cap);
    let mut steps = Vec::new();
    loop {
        // The term BEFORE this step — `next` replaces it, so it cannot be read afterwards.
        let before = cursor.term().clone();
        match cursor.next() {
            Some(crate::trace::StepEvent::Beta { redex }) => steps.push(Step { term: before, redex }),
            Some(other) => unreachable!("a lambda cursor cannot emit {other:?}"),
            None => break,
        }
    }
    let status = cursor.status().unwrap_or(Status::Normalized);
    Trace { steps, normal_form: cursor.term().clone(), status }
}
```

`unreachable!` is a panic on a library path, which the totality rule forbids. Replace it with `Some(_) => break` and a comment explaining that a `LambdaCursor` only ever emits `Beta`, so the arm is unreachable in practice but returns a well-formed partial trace rather than aborting if that ever changes.

- [ ] **Step 5a: Verify `reduce_trace` is unchanged in behaviour**

Run: `cargo nextest run -p redextape-core -E 'test(/lambda/)'`
Expected: PASS. Every existing λ test exercises `reduce_trace`; if the status or step list differs the cursor's cap handling does not match the original loop. Pay particular attention to any test asserting `Status::HitCap` — the original checked `depth_exceeds` *before* `reduce_step` and returned the term unreduced, and the cursor must do the same.

- [ ] **Step 6: Run the whole suite**

Run: `cargo nextest run -p redextape-core`
Expected: PASS, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/trace.rs crates/redextape-core/src/lambda/reduce.rs \
        crates/redextape-core/src/lib.rs
git commit -m "feat(core): add StepEvent and a lazy lambda cursor

The delta vocabulary both backends will share. LambdaCursor holds one term
and no history, so it is O(1) in the step count where reduce_trace is
O(steps) by contract.

The TM delta is a rule reference rather than a copy of its effects: the
machine is immutable during a run, so (state, rule) determines the writes
and moves in 8 bytes, and it assumes nothing about tape count."
```

---

### Task 4: `TmCursor` — restructure `sim::run` over a resumable stepper

**This is the riskiest task in the slice.** `run` is the single implementation behind `simulate`, `simulate_final`, `simulate_counts`, `simulate_trace` and `simulate_watched`. Its loop must become resumable without changing any of their observable behaviour.

**Files:**
- Modify: `crates/redextape-core/src/tm/sim.rs` (`run` at ~line 100, `Step` at line 82)
- Modify: `crates/redextape-core/src/trace.rs` (add `TmCursor`)
- Create: `crates/redextape-core/tests/trace_equivalence.rs`

**Interfaces:**
- Consumes: `Machine`, `State`, `Rule`, `Tape`, `Caps`, `Status`, `rule_matches`, `apply` (all in `tm/sim.rs` / `tm/machine.rs`).
- Produces: `trace::TmCursor::new(&Machine, &[Vec<Symbol>], Caps) -> TmCursor<'_>`, `impl Iterator<Item = StepEvent> for TmCursor<'_>`, `TmCursor::tapes(&self) -> &[Tape]`, `TmCursor::state(&self) -> StateId`, `TmCursor::status(&self) -> Option<Status>`.

- [ ] **Step 1: Write the failing equivalence test**

Create `crates/redextape-core/tests/trace_equivalence.rs`:

```rust
//! The cursor must agree with the shipped simulator step for step. If a replayed delta stream and a
//! direct simulation diverge, every consumer silently disagrees with the oracle while both traces
//! still look well-formed — so this is the crux test of the slice, not a nicety.

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{
    Encoding, REG, TAPES, TM_DEFAULT_CAPS, Unary, WORK, defunc, lower_asm, lower_tm, n_slots_of, parse_tm,
    simulate_trace,
};
use redextape_core::trace::{StepEvent, TmCursor};

const CORPUS: &[&str] = &["1 + 2 * 3", "3 - 5", "if 2 > 1 { 10 } else { 20 }", "[1, 2, 3]"];

fn machine_and_init(src: &str) -> (redextape_core::tm::Machine, Vec<Vec<char>>) {
    let (p, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
    let core = desugar(&p.unwrap());
    let prog = match lower_asm(&core) {
        Ok(p) => p,
        Err(_) => lower_asm(&defunc(&core).expect("defunc")).expect("lower"),
    };
    let enc = Unary::default();
    let m = lower_tm(&prog, &enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots_of(&prog));
    init[WORK] = enc.init_work();
    (m, init)
}

#[test]
fn the_cursor_visits_the_same_states_as_simulate_trace() {
    for src in CORPUS {
        let (m, init) = machine_and_init(src);
        let expected: Vec<u32> = simulate_trace(&m, &init, TM_DEFAULT_CAPS).steps.iter().map(|s| s.state).collect();
        let got: Vec<u32> = TmCursor::new(&m, &init, TM_DEFAULT_CAPS)
            .map(|e| match e {
                StepEvent::Delta { state, .. } => state,
                other => panic!("TM cursor emitted a non-Delta event: {other:?}"),
            })
            .collect();
        assert_eq!(got, expected, "state sequence differs for {src:?}");
    }
}

#[test]
fn replaying_the_delta_stream_reproduces_the_final_tapes() {
    for src in CORPUS {
        let (m, init) = machine_and_init(src);
        let expected = simulate_trace(&m, &init, TM_DEFAULT_CAPS).final_tapes;
        let mut c = TmCursor::new(&m, &init, TM_DEFAULT_CAPS);
        while c.next().is_some() {}
        let got: Vec<(Vec<char>, usize)> = c.tapes().iter().map(redextape_core::tm::Tape::snapshot).collect();
        assert_eq!(got, expected, "final tapes differ for {src:?}");
    }
}

/// A machine whose tape count is NOT `TAPES`. Nothing else in the suite exercises this, because every
/// machine the lowering builds has five tapes — so a design that quietly assumed five would pass
/// everything else. This is the regression guard for that class of bug.
#[test]
fn a_machine_with_a_non_default_tape_count_traces_end_to_end() {
    let src = "tapes 2\nstart s0\ntape 0 ab\ntape 1 __\n\nstate halt: accept\nstate s0:\n  [a *] -> write [b *], move [R S], goto halt\n";
    let (m, ds) = parse_tm(src);
    assert!(ds.is_empty(), "TM text did not parse: {ds:?}");
    let m = m.expect("machine parses");
    assert_eq!(m.tapes, 2, "the fixture must not have five tapes, or it guards nothing");
    let init = vec![vec!['a', 'b'], vec!['_', '_']];
    let expected: Vec<u32> = simulate_trace(&m, &init, TM_DEFAULT_CAPS).steps.iter().map(|s| s.state).collect();
    let got: Vec<u32> = TmCursor::new(&m, &init, TM_DEFAULT_CAPS)
        .map(|e| match e {
            StepEvent::Delta { state, .. } => state,
            other => panic!("unexpected event: {other:?}"),
        })
        .collect();
    assert_eq!(got, expected, "a two-tape machine must trace like any other");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo nextest run -p redextape-core -E 'binary(trace_equivalence)'`
Expected: FAIL — `unresolved import redextape_core::trace::TmCursor`.

If the two-tape fixture fails to *parse*, fix the fixture against `tm/syntax.rs`'s grammar (check `tests/fixtures/list_1_2.tm` for the exact header and rule syntax) before proceeding — a fixture that does not parse guards nothing.

- [ ] **Step 3: Change rule selection to yield an index**

In `tm/sim.rs`'s `run`, replace the `find` with a `position` so the index is available:

```rust
        let Some(rule_index) = state.rules.iter().position(|r| rule_matches(&r.read, &tapes)) else {
            return (tapes, cur, Status::Halted); // stuck == halt
        };
        let rule = &state.rules[rule_index];
```

- [ ] **Step 4: Write `TmCursor`**

Add to `trace.rs`:

```rust
/// Lazy δ-stepping. Borrows the machine and owns only the tapes — O(tape size), not O(steps).
pub struct TmCursor<'m> {
    machine: &'m Machine,
    tapes: Vec<Tape>,
    cur: StateId,
    steps: u64,
    caps: Caps,
    status: Option<Status>,
}

impl<'m> TmCursor<'m> {
    pub fn new(m: &'m Machine, init: &[Vec<Symbol>], caps: Caps) -> TmCursor<'m> {
        // Mirror `run`'s pre-allocation guard: a machine declaring an absurd tape count must hit the
        // cap rather than attempt that many allocations.
        if m.tapes as u64 > caps.cells {
            return TmCursor { machine: m, tapes: Vec::new(), cur: m.start, steps: 0, caps, status: Some(Status::HitCap) };
        }
        let tapes = (0..m.tapes).map(|i| Tape::new(init.get(i).map_or(&[][..], Vec::as_slice))).collect();
        TmCursor { machine: m, tapes, cur: m.start, steps: 0, caps, status: None }
    }

    pub fn tapes(&self) -> &[Tape] {
        &self.tapes
    }

    pub fn state(&self) -> StateId {
        self.cur
    }

    /// `Some` once the run has ended, carrying why. `None` while more steps remain.
    pub fn status(&self) -> Option<Status> {
        self.status
    }
}

impl Iterator for TmCursor<'_> {
    type Item = StepEvent;

    fn next(&mut self) -> Option<StepEvent> {
        if self.status.is_some() {
            return None;
        }
        let end = |s: &mut Self, st: Status| -> Option<StepEvent> {
            s.status = Some(st);
            None
        };
        let Some(state) = self.machine.states.get(self.cur as usize) else {
            return end(self, Status::Halted);
        };
        if state.accept {
            return end(self, Status::Halted);
        }
        if self.steps >= self.caps.steps {
            return end(self, Status::HitCap);
        }
        let total: usize = self.tapes.iter().map(Tape::cells).sum();
        if total as u64 > self.caps.cells {
            return end(self, Status::HitCap);
        }
        let Some(rule_index) = state.rules.iter().position(|r| rule_matches(&r.read, &self.tapes)) else {
            return end(self, Status::Halted); // stuck == halt
        };
        let rule = &state.rules[rule_index];
        if (rule.next as usize) >= self.machine.states.len()
            || rule.write.len() != self.machine.tapes
            || rule.moves.len() != self.machine.tapes
        {
            return end(self, Status::Halted); // defensive: malformed rule
        }
        let event = StepEvent::Delta { state: self.cur, rule: rule_index as u32 };
        apply(rule, &mut self.tapes);
        self.cur = rule.next;
        self.steps += 1;
        Some(event)
    }
}
```

`rule_matches`, `apply`, `Tape`, `Caps`, `Status`, `Symbol` and `Machine` must be reachable from `trace.rs`. Make `rule_matches` and `apply` `pub(crate)` in `tm/sim.rs` rather than duplicating them — a second copy of the matcher is exactly the drift this plan's constraints forbid.

- [ ] **Step 5: Run the equivalence tests**

Run: `cargo nextest run -p redextape-core -E 'binary(trace_equivalence)'`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the whole suite**

Run: `cargo nextest run -p redextape-core && cargo test -p redextape-core --doc`
Expected: PASS, 0 failed. The `.position()` change touches every simulator entry point, so a regression here means the restructure altered behaviour — investigate rather than re-blessing any golden.

- [ ] **Step 7: Sabotage-verify the crux test**

Temporarily make `TmCursor::next` emit `rule: 0` unconditionally. Run `replaying_the_delta_stream_reproduces_the_final_tapes` — it MUST fail for at least one corpus entry. Restore. This proves the test detects a wrong rule reference, which is the whole reason the delta is a reference rather than a copy.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/tm/sim.rs crates/redextape-core/src/trace.rs \
        crates/redextape-core/tests/trace_equivalence.rs
git commit -m "feat(tm): add a lazy TM cursor over the delta stream

Rule selection moves from find to position so the index is available; the
delta carries (state, rule) and resolves its effects through the machine,
which is immutable for the duration of a run.

Includes a machine whose tape count is not TAPES. Nothing else in the
suite covers that, because every machine the lowering builds has five
tapes — so a design quietly assuming five would pass everything else."
```

---

### Task 5: `analysis.rs` — `TokenClass` and `classify_source`

**Files:**
- Create: `crates/redextape-core/src/analysis.rs`
- Modify: `crates/redextape-core/src/lib.rs` (add `pub mod analysis;`)

**Interfaces:**
- Consumes: `lexer::lex(&str) -> (Vec<Token>, Vec<Diagnostic>)`, `token::{Token, TokenKind}`, `span::Span`.
- Produces: `analysis::TokenClass` (variants below), `analysis::Classified = Vec<(Span, TokenClass)>`, `analysis::classify_source(&str) -> Classified`.

- [ ] **Step 1: Write the failing test**

Add a `tests` module to `crates/redextape-core/src/analysis.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_source_labels_keywords_names_and_literals() {
        let src = "let mut x = 1 + y;";
        let got = classify_source(src);
        let slice = |s: Span| &src[s.start..s.end];
        let pairs: Vec<(&str, TokenClass)> = got.iter().map(|(s, c)| (slice(*s), *c)).collect();
        assert_eq!(
            pairs,
            vec![
                ("let", TokenClass::Keyword),
                ("mut", TokenClass::Keyword),
                ("x", TokenClass::Ident),
                ("=", TokenClass::Operator),
                ("1", TokenClass::Nat),
                ("+", TokenClass::Operator),
                ("y", TokenClass::Ident),
                (";", TokenClass::Punct),
            ]
        );
    }

    #[test]
    fn classify_source_omits_eof_and_stays_in_bounds() {
        let src = "1 + 2";
        for (span, _) in classify_source(src) {
            assert!(span.start <= span.end && span.end <= src.len(), "span out of bounds: {span:?}");
            assert!(span.start < span.end, "no zero-width spans: {span:?}");
        }
    }

    #[test]
    fn classify_source_is_total_on_malformed_input() {
        // Lexing a program with an illegal character must not panic; whatever tokens survive classify.
        let _ = classify_source("let x = @@@;");
        let _ = classify_source("");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p redextape-core --lib analysis::tests 2>&1 | head -20`
Expected: FAIL — module not declared / `TokenClass` not found.

- [ ] **Step 3: Write `analysis.rs`**

```rust
//! Token classification for every language in the project (§8, §9.4). One vocabulary spans all four,
//! so a renderer learns one enum rather than four.
//!
//! CORE EMITS CLASSES, NEVER COLOURS. No ANSI, no CSS, no theme — those belong to consumers (the CLI,
//! the web UI), which keeps this crate WASM-clean and matches the model/renderer split §9.1 locks in.
//!
//! WHY THE PRINTERS REPORT SPANS INSTEAD OF SOMETHING RE-LEXING THEIR OUTPUT. Only the source language
//! has a reusable lexer. λ's parser scans chars inline with no token type, TM's is line-oriented, and
//! asm has no parser at all — so "re-lex the printed text" would mean three new scanners recovering
//! structure the printer just discarded, each obliged to stay in step with its printer and nothing
//! forcing them to agree. That is the second-parallel-implementation failure this project's
//! conventions treat as a defect rather than a style choice.

use crate::lexer::lex;
use crate::span::Span;
use crate::token::TokenKind;

/// What a span of printed or authored text IS. Shared variants first, then form-specific ones.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenClass {
    Ident,
    Nat,
    Bool,
    Keyword,
    Operator,
    Punct,
    Comment,
    /// A λ binder: the `λ` and the name it binds.
    Binder,
    /// An asm mnemonic (`add`, `jz`, `cons`).
    Mnemonic,
    /// An asm register (`r0`, `a1`, `rr`).
    Register,
    /// An asm or TM label / state name in DEFINING position.
    Label,
    /// A TM state name in REFERENCE position (a `goto` target).
    StateName,
    /// A symbol on a TM tape, or a wildcard.
    TapeSymbol,
    /// A TM head move (`L`, `R`, `S`).
    Move,
}

pub type Classified = Vec<(Span, TokenClass)>;

/// Classify mini-language source. Reuses the existing lexer — no second scanner. Diagnostics are
/// discarded here on purpose: highlighting a file with errors is exactly when it matters most, so
/// whatever tokens the lexer recovered are classified and the errors are surfaced through `analyze`.
pub fn classify_source(src: &str) -> Classified {
    let (tokens, _diagnostics) = lex(src);
    tokens.iter().filter(|t| t.kind != TokenKind::Eof).map(|t| (t.span, class_of(t.kind))).collect()
}

fn class_of(k: TokenKind) -> TokenClass {
    match k {
        TokenKind::Nat(_) => TokenClass::Nat,
        TokenKind::Ident => TokenClass::Ident,
        TokenKind::True | TokenKind::False => TokenClass::Bool,
        TokenKind::Fn | TokenKind::Let | TokenKind::Mut | TokenKind::If | TokenKind::Else | TokenKind::While => {
            TokenClass::Keyword
        }
        TokenKind::Plus
        | TokenKind::Minus
        | TokenKind::Star
        | TokenKind::Eq
        | TokenKind::Ne
        | TokenKind::Lt
        | TokenKind::Le
        | TokenKind::Gt
        | TokenKind::Ge
        | TokenKind::Assign => TokenClass::Operator,
        TokenKind::LParen
        | TokenKind::RParen
        | TokenKind::LBrace
        | TokenKind::RBrace
        | TokenKind::LBracket
        | TokenKind::RBracket
        | TokenKind::Comma
        | TokenKind::Semi
        | TokenKind::Pipe
        | TokenKind::Dot => TokenClass::Punct,
        TokenKind::Eof => TokenClass::Punct,
    }
}
```

Note `class_of` is an exhaustive `match` with no `_` arm. That is deliberate: adding a `TokenKind` must fail to compile here rather than silently classify as punctuation.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p redextape-core --lib analysis::tests`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/analysis.rs crates/redextape-core/src/lib.rs
git commit -m "feat(core): classify source tokens over the existing lexer

One TokenClass vocabulary for all four languages; source classification
reuses lexer::lex rather than adding a second scanner.

class_of is an exhaustive match with no wildcard arm on purpose: adding a
TokenKind must fail to compile here instead of silently classifying as
punctuation. Core emits classes and never colours — ANSI and CSS belong
to consumers."
```

---

### Task 6: `print_asm_mapped` — the pattern, on the simplest printer

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs` (`instr_parts` at ~96, `print_asm` at ~131)
- Modify: `crates/redextape-core/src/tm.rs` (re-export)

**Interfaces:**
- Consumes: `analysis::{Classified, TokenClass}`, `Span`, `Program`, `instr_parts`.
- Produces: `tm::print_asm_mapped(&Program) -> (String, Classified)`. `print_asm(p)` = `print_asm_mapped(p).0`.

asm is done first because `instr_parts` already separates the mnemonic from its operands, so the span boundaries are largely computed.

- [ ] **Step 1: Write the failing test**

Add to `tm/asm.rs`'s `tests` module:

```rust
#[test]
fn print_asm_mapped_agrees_with_print_asm_and_classifies_every_piece() {
    use crate::analysis::TokenClass;
    let prog = Program {
        code: vec![Instr::Li(Reg::Loc(0), 5), Instr::Jz(Reg::Loc(0), "done".to_string()), Instr::Halt],
        labels: vec![("done".to_string(), 3)],
    };
    let (text, spans) = print_asm_mapped(&prog);
    assert_eq!(text, print_asm(&prog), "the wrapper must return the mapped form's text verbatim");
    for (s, _) in &spans {
        assert!(s.end <= text.len(), "span {s:?} out of bounds for {} bytes", text.len());
        assert!(s.start < s.end, "zero-width span {s:?}");
    }
    // Spans must be ordered and non-overlapping.
    for w in spans.windows(2) {
        assert!(w[0].0.end <= w[1].0.start, "spans overlap or are unordered: {:?} then {:?}", w[0], w[1]);
    }
    let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&text[s.start..s.end], *c)).collect();
    assert!(named.contains(&("li", TokenClass::Mnemonic)), "mnemonic not classified: {named:?}");
    assert!(named.contains(&("r0", TokenClass::Register)), "register not classified: {named:?}");
    assert!(named.contains(&("done", TokenClass::Label)), "label not classified: {named:?}");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p redextape-core --lib tm::asm::tests::print_asm_mapped_agrees`
Expected: FAIL — `cannot find function 'print_asm_mapped'`.

- [ ] **Step 3: Implement it**

In `tm/asm.rs`, make `print_asm` a wrapper and add the mapped form. Build the string and push spans as each piece is written, so the offsets are exact by construction rather than recomputed:

```rust
/// Render a `Program` as the readable assembly listing (labels at column 0, instructions indented).
pub fn print_asm(prog: &Program) -> String {
    print_asm_mapped(prog).0
}

/// `print_asm`, plus a class per span of the produced text. Spans are pushed as each piece is written,
/// so offsets are exact by construction — nothing re-scans the output.
pub fn print_asm_mapped(prog: &Program) -> (String, crate::analysis::Classified) {
    use crate::analysis::TokenClass as C;
    let mut out = String::new();
    let mut spans: crate::analysis::Classified = Vec::new();
    let mut push = |out: &mut String, text: &str, class: C, spans: &mut crate::analysis::Classified| {
        let start = out.len();
        out.push_str(text);
        spans.push((Span::new(start, out.len()), class));
    };
    let mut emit_label = |out: &mut String, name: &str, spans: &mut crate::analysis::Classified| {
        push(out, name, C::Label, spans);
        out.push_str(":\n");
    };
    for (idx, instr) in prog.code.iter().enumerate() {
        for (name, at) in &prog.labels {
            if *at == idx {
                emit_label(&mut out, name, &mut spans);
            }
        }
        out.push_str("    ");
        let (mnemonic, operands) = instr_parts(instr);
        push(&mut out, mnemonic, C::Mnemonic, &mut spans);
        for (i, operand) in operands.iter().enumerate() {
            out.push_str(if i == 0 { "\t" } else { ", " });
            push(&mut out, &operand_str(operand), operand.class(), &mut spans);
        }
        out.push('\n');
    }
    for (name, at) in &prog.labels {
        if *at == prog.code.len() {
            emit_label(&mut out, name, &mut spans);
        }
    }
    (out, spans)
}
```

Add `use crate::span::Span;` to `tm/asm.rs` if absent.

**`instr_parts` must return structured operands, not a joined string.** Classifying by spelling is wrong: a jump label named `retry` or `again` starts with `r`/`a` and would be reported as a register. The instruction already knows which operand is which, so read that instead of inferring it.

Replace the `instr_parts` introduced in commit `ddc1314` with:

```rust
/// One operand, classified by what it IS rather than how it prints — so a label named `retry` can
/// never be mistaken for a register, which any spelling-based rule would get wrong.
enum Operand<'a> {
    Reg(Reg),
    Imm(u64),
    Label(&'a str),
}

impl Operand<'_> {
    fn class(&self) -> crate::analysis::TokenClass {
        use crate::analysis::TokenClass as C;
        match self {
            Operand::Reg(_) => C::Register,
            Operand::Imm(_) => C::Nat,
            Operand::Label(_) => C::Label,
        }
    }
}

fn operand_str(o: &Operand<'_>) -> String {
    match o {
        Operand::Reg(r) => reg_str(*r),
        Operand::Imm(n) => format!("#{n}"),
        Operand::Label(l) => (*l).to_string(),
    }
}

/// The mnemonic and operands of one instruction. `instr_str` and `print_asm_mapped` are both written
/// over this, so the listing's separator and its classification cannot disagree about where an
/// operand starts.
fn instr_parts(i: &Instr) -> (&'static str, Vec<Operand<'_>>) {
    match i {
        Instr::Li(rd, n) => ("li", vec![Operand::Reg(*rd), Operand::Imm(*n)]),
        Instr::Mov(rd, rs) => ("mov", vec![Operand::Reg(*rd), Operand::Reg(*rs)]),
        Instr::Bin(op, rd, ra, rb) => {
            (bin_mnemonic(*op), vec![Operand::Reg(*rd), Operand::Reg(*ra), Operand::Reg(*rb)])
        }
        Instr::Jz(r, l) => ("jz", vec![Operand::Reg(*r), Operand::Label(l)]),
        Instr::Jmp(l) => ("jmp", vec![Operand::Label(l)]),
        Instr::Call(l) => ("call", vec![Operand::Label(l)]),
        Instr::Ret => ("ret", Vec::new()),
        Instr::Halt => ("halt", Vec::new()),
        Instr::Nil(rd) => ("nil", vec![Operand::Reg(*rd)]),
        Instr::Cons(rd, rh, rt) => ("cons", vec![Operand::Reg(*rd), Operand::Reg(*rh), Operand::Reg(*rt)]),
        Instr::Head(rd, rl) => ("head", vec![Operand::Reg(*rd), Operand::Reg(*rl)]),
        Instr::Tail(rd, rl) => ("tail", vec![Operand::Reg(*rd), Operand::Reg(*rl)]),
        Instr::IsEmpty(rd, rl) => ("isempty", vec![Operand::Reg(*rd), Operand::Reg(*rl)]),
        Instr::Box(rd, rv) => ("box", vec![Operand::Reg(*rd), Operand::Reg(*rv)]),
        Instr::BoxGet(rd, rb) => ("box_get", vec![Operand::Reg(*rd), Operand::Reg(*rb)]),
        Instr::BoxSet(rb, rv) => ("box_set", vec![Operand::Reg(*rb), Operand::Reg(*rv)]),
    }
}

fn instr_str(i: &Instr) -> String {
    let (mnemonic, operands) = instr_parts(i);
    if operands.is_empty() {
        return mnemonic.to_string();
    }
    let joined: Vec<String> = operands.iter().map(operand_str).collect();
    format!("{mnemonic}\t{}", joined.join(", "))
}
```

The separator rules are unchanged: a tab after the mnemonic, `, ` between operands, and nothing trailing for `ret`/`halt`. The two pre-existing goldens verify this — if either moves by one byte, the operand joining is wrong.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p redextape-core --lib tm::asm::tests`
Expected: PASS. In particular the two pre-existing goldens (`print_asm_is_a_stable_readable_listing`, `print_asm_golden_for_a_small_demo`) must pass **unchanged** — they are the proof that no printed byte moved.

- [ ] **Step 5: Re-export and commit**

In `crates/redextape-core/src/tm.rs`, add `print_asm_mapped` to the `pub use asm::{..}` list.

```bash
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): classify asm listing spans while printing

print_asm becomes a wrapper over print_asm_mapped, which pushes a span as
each piece is written — offsets are exact by construction and nothing
re-scans the output.

The two pre-existing goldens pass unchanged, which is the evidence that
no printed byte moved."
```

---

### Task 7: `print_lambda_mapped`

**Files:**
- Modify: `crates/redextape-core/src/lambda/syntax.rs` (`print_lambda` at ~186, `print_term`, `print_app_fn`, `print_atom`)
- Modify: `crates/redextape-core/src/lambda.rs` (re-export)

**Interfaces:**
- Consumes: `analysis::{Classified, TokenClass}`, `Span`.
- Produces: `lambda::print_lambda_mapped(&LambdaTerm) -> (String, Classified)`. `print_lambda(t)` = `print_lambda_mapped(t).0`.

The current printers return `String` and compose by `format!`, which loses offsets. Convert them to write into a shared `String` so offsets are known as text is appended.

- [ ] **Step 1: Write the failing test**

Add to `lambda/syntax.rs`'s `tests` module:

```rust
#[test]
fn print_lambda_mapped_agrees_and_classifies_binders_and_variables() {
    use crate::analysis::TokenClass;
    let t = abs("f", abs("x", app(var(1), var(0))));
    let (text, spans) = print_lambda_mapped(&t);
    assert_eq!(text, print_lambda(&t), "the wrapper must return the mapped form's text verbatim");
    assert_eq!(text, "λf. λx. f x");
    for w in spans.windows(2) {
        assert!(w[0].0.end <= w[1].0.start, "spans overlap or are unordered: {:?} then {:?}", w[0], w[1]);
    }
    let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&text[s.start..s.end], *c)).collect();
    // ASSERT THE WHOLE SEQUENCE, not "some span has this class". Task 6 found the weaker style
    // vacuous: `named.contains(&("done", Label))` passed even with every operand deliberately
    // misclassified, because `"done"` also occurs as its own label definition. Here `f` occurs twice —
    // once as a binder, once as a variable — so any per-text assertion is satisfied by the wrong
    // occurrence. Only the full ordered sequence pins which is which.
    assert_eq!(
        named,
        vec![
            ("λ", TokenClass::Binder),
            ("f", TokenClass::Binder),
            ("λ", TokenClass::Binder),
            ("x", TokenClass::Binder),
            ("f", TokenClass::Ident),
            ("x", TokenClass::Ident),
        ]
    );
}

#[test]
fn print_lambda_mapped_spans_stay_in_bounds_on_every_demo() {
    for src in ["1 + 2 * 3", "3 - 5", "let x = 1; let y = x + x; y * 3", "[1, 2, 3]"] {
        let (prog, ds) = crate::parser::parse(src);
        assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
        let term = crate::lambda::lower(&crate::desugar::desugar(&prog.unwrap())).expect("lowers");
        let (text, spans) = print_lambda_mapped(&term);
        assert_eq!(text, print_lambda(&term), "text differs for {src:?}");
        for (s, _) in &spans {
            assert!(s.end <= text.len() && s.start < s.end, "{src:?}: bad span {s:?}");
            assert!(text.is_char_boundary(s.start) && text.is_char_boundary(s.end), "{src:?}: {s:?} splits a char");
        }
    }
}
```

The char-boundary assertion matters specifically because `λ` is multi-byte — a span arithmetic error would slice inside it and panic on indexing.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p redextape-core --lib lambda::syntax::tests::print_lambda_mapped`
Expected: FAIL — `cannot find function 'print_lambda_mapped'`.

- [ ] **Step 3: Convert the printer to write-in-place**

Replace `print_lambda` / `print_term` / `print_app_fn` / `print_atom` in `lambda/syntax.rs`:

```rust
/// Print a term with readable names, freshening on shadow collision, minimal parens. Binders print as
/// `λ`, never `\` — see the module doc on why input accepts both and output picks one.
pub fn print_lambda(t: &LambdaTerm) -> String {
    print_lambda_mapped(t).0
}

/// `print_lambda`, plus a class per span. Spans are pushed as text is appended, so offsets are exact by
/// construction; `λ` is multi-byte, so nothing here may assume one byte per character.
pub fn print_lambda_mapped(t: &LambdaTerm) -> (String, crate::analysis::Classified) {
    let mut out = String::new();
    let mut spans: crate::analysis::Classified = Vec::new();
    let mut names: Vec<String> = Vec::new();
    write_term(t, &mut names, &mut out, &mut spans);
    (out, spans)
}

fn push_span(out: &mut String, text: &str, class: crate::analysis::TokenClass, spans: &mut crate::analysis::Classified) {
    let start = out.len();
    out.push_str(text);
    spans.push((Span::new(start, out.len()), class));
}

fn write_term(
    t: &LambdaTerm,
    names: &mut Vec<String>,
    out: &mut String,
    spans: &mut crate::analysis::Classified,
) {
    use crate::analysis::TokenClass as C;
    match t {
        LambdaTerm::Var(i) => {
            let idx = names.len().checked_sub(1 + *i as usize);
            let name = idx.and_then(|k| names.get(k)).cloned().unwrap_or_else(|| format!("?{i}"));
            push_span(out, &name, C::Ident, spans);
        }
        LambdaTerm::Abs(hint, body) => {
            let name = fresh(hint, names);
            push_span(out, "λ", C::Binder, spans);
            push_span(out, &name, C::Binder, spans);
            out.push_str(". ");
            names.push(name);
            write_term(body, names, out, spans);
            names.pop();
        }
        LambdaTerm::App(f, a) => {
            write_app_fn(f, names, out, spans);
            out.push(' ');
            write_atom(a, names, out, spans);
        }
    }
}

/// The function position of an application: an abstraction there needs parens.
fn write_app_fn(t: &LambdaTerm, names: &mut Vec<String>, out: &mut String, spans: &mut crate::analysis::Classified) {
    match t {
        LambdaTerm::Abs(..) => parenthesized(t, names, out, spans),
        _ => write_term(t, names, out, spans),
    }
}

/// An atom in argument position: abstractions and applications need parens.
fn write_atom(t: &LambdaTerm, names: &mut Vec<String>, out: &mut String, spans: &mut crate::analysis::Classified) {
    match t {
        LambdaTerm::Var(_) => write_term(t, names, out, spans),
        _ => parenthesized(t, names, out, spans),
    }
}

fn parenthesized(t: &LambdaTerm, names: &mut Vec<String>, out: &mut String, spans: &mut crate::analysis::Classified) {
    use crate::analysis::TokenClass as C;
    push_span(out, "(", C::Punct, spans);
    write_term(t, names, out, spans);
    push_span(out, ")", C::Punct, spans);
}
```

Keep `fresh` unchanged.

- [ ] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-core -E 'test(/lambda/)'`
Expected: PASS. Every existing λ printing test — round-trip, idempotency, the foreign-reader suite, and `prints_lambda_but_accepts_both_binder_spellings` — must pass **unchanged**. They are the evidence the rewrite moved no byte.

- [ ] **Step 5: Re-export and commit**

In `crates/redextape-core/src/lambda.rs:15`, change to `pub use syntax::{parse_lambda, print_lambda, print_lambda_mapped};`.

```bash
git add crates/redextape-core/src/lambda/syntax.rs crates/redextape-core/src/lambda.rs
git commit -m "feat(lambda): classify printed term spans while printing

The printer moves from returning composed Strings to writing into a shared
buffer, so span offsets are known as text is appended rather than
recomputed afterwards. print_lambda becomes a wrapper.

Tests assert char boundaries explicitly: λ is multi-byte, so a span
arithmetic slip would slice inside it and panic on indexing rather than
merely mis-colour."
```

---

### Task 8: `print_tm_with_mapped`

**Files:**
- Modify: `crates/redextape-core/src/tm/syntax.rs` (`print_tm_inner` at ~90 and its helpers `sym_str`, `syms_str`, `move_str`, `moves_str`, `state_name`)
- Modify: `crates/redextape-core/src/tm.rs` (re-export)

**Interfaces:**
- Consumes: `analysis::{Classified, TokenClass}`, `Span`, `Machine`, `TmHeader`.
- Produces: `tm::print_tm_with_mapped(&Machine, &TmHeader) -> (String, Classified)` and `tm::print_tm_mapped(&Machine) -> (String, Classified)`. `print_tm(m)` and `print_tm_with(m, h)` become wrappers.

- [ ] **Step 1: Write the failing test**

Add to `tm/syntax.rs`'s `tests` module (it already has an `increment()` machine helper and `a_header()`):

```rust
#[test]
fn print_tm_mapped_agrees_and_classifies_states_symbols_and_moves() {
    use crate::analysis::TokenClass;
    let m = increment();
    let (text, spans) = print_tm_mapped(&m);
    assert_eq!(text, print_tm(&m), "the wrapper must return the mapped form's text verbatim");
    for w in spans.windows(2) {
        assert!(w[0].0.end <= w[1].0.start, "spans overlap or are unordered: {:?} then {:?}", w[0], w[1]);
    }
    for (s, _) in &spans {
        assert!(s.end <= text.len() && s.start < s.end, "bad span {s:?}");
        assert!(text.is_char_boundary(s.start) && text.is_char_boundary(s.end), "{s:?} splits a char");
    }
    let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&text[s.start..s.end], *c)).collect();
    // These assertions must be PER-OCCURRENCE, not "some span somewhere has this class". Asserting
    // `named.iter().any(|(_, c)| *c == Label)` does not even look at the text — it passes while every
    // span is misclassified, as long as one `Label` survives anywhere. Task 6 hit exactly this.
    //
    // The discriminating property is that ONE state name carries DIFFERENT classes depending on
    // position: `Label` where it is defined (`state foo:`) and `StateName` where a rule jumps to it
    // (`goto foo`). Pick a state that is both defined and referenced, collect every span whose text is
    // that name, and assert the exact class sequence — a printer that classified all state names
    // identically would satisfy any per-text assertion but fail this one.
    let target = /* a state name that both appears as a definition and is a goto target */;
    let occurrences: Vec<TokenClass> = named.iter().filter(|(t, _)| *t == target).map(|(_, c)| *c).collect();
    assert!(occurrences.len() >= 2, "{target} must occur as both a definition and a target: {named:?}");
    assert_eq!(occurrences[0], TokenClass::Label, "the defining occurrence must be Label");
    assert!(
        occurrences[1..].iter().all(|c| *c == TokenClass::StateName),
        "every later occurrence of {target} is a goto target: {occurrences:?}"
    );
    // Moves and tape symbols: assert against the exact text, since `L`/`R`/`S` and the tape alphabet
    // are single characters that could collide with an identifier if classification were wrong.
    assert!(named.iter().any(|(t, c)| *c == TokenClass::Move && matches!(*t, "L" | "R" | "S")));
    assert!(named.iter().any(|(t, c)| *c == TokenClass::TapeSymbol && t.chars().count() == 1));
}

#[test]
fn print_tm_mapped_with_a_header_still_agrees() {
    let m = increment();
    let h = a_header();
    assert_eq!(print_tm_with_mapped(&m, &h).0, print_tm_with(&m, &h));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p redextape-core --lib tm::syntax::tests::print_tm_with_mapped`
Expected: FAIL — `cannot find function 'print_tm_mapped'`.

- [ ] **Step 3: Implement**

Restructure `print_tm_inner` to write into a shared `String` with a `push_span` helper (same shape as Tasks 6 and 7), classifying:

- a `state <name>:` name in defining position → `TokenClass::Label`
- a `goto <name>` target → `TokenClass::StateName`
- each symbol inside `[..]` read/write brackets, and `*` wildcards → `TokenClass::TapeSymbol`
- each `L`/`R`/`S` in a `move [..]` list → `TokenClass::Move`
- `tapes`, `start`, `version`, `encoding`, `width`, `slots`, `result`, `tape`, `state`, `accept`, `write`, `move`, `goto` → `TokenClass::Keyword`
- header numeric values → `TokenClass::Nat`
- `[`, `]`, `,`, `:`, `->` → `TokenClass::Punct`
- the `; reg` trailing tape comment → `TokenClass::Comment`

Keep `print_tm` and `print_tm_with` as one-line wrappers returning `.0`. The existing helpers (`sym_str`, `moves_str`, …) that build intermediate `String`s are replaced by write-in-place equivalents; delete the old ones rather than leaving both, per the one-implementation constraint.

- [ ] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-core`
Expected: PASS, 0 failed. `print_tm_is_a_stable_readable_listing`, `print_tm_with_inserts_the_header_after_start`, the `parse_tm(print_tm(m)) == m` round-trip, and both `.tm` fixtures must pass **unchanged**.

- [ ] **Step 5: Re-export and commit**

Add `print_tm_with_mapped` and `print_tm_mapped` to `tm.rs`'s `pub use syntax::{..}`.

```bash
git add crates/redextape-core/src/tm/syntax.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): classify printed machine spans while printing

print_tm and print_tm_with become wrappers over the mapped forms, which
write into a shared buffer and push spans as they go. Defining state names
classify as Label and goto targets as StateName, so a renderer can link a
reference to its definition without re-parsing.

The round-trip test and both .tm fixtures pass unchanged."
```

---

### Task 9: Highlight composition — spans crossed with source provenance

**Files:**
- Modify: `crates/redextape-core/src/analysis.rs` (add the composition)
- Create: `crates/redextape-core/tests/span_wellformed.rs`

**Interfaces:**
- Consumes: `SourceMap` (Task 2), `print_asm_mapped` (6), `print_lambda_mapped` (7), `print_tm_mapped` (8), `Classified`.
- Produces: `analysis::Attributed = Vec<(Span, TokenClass, Option<NodeId>)>`, `analysis::attribute_tm_spans(&Machine, &SourceMap, &Classified) -> Attributed`.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/span_wellformed.rs`:

```rust
//! Span invariants that must hold for every classifier, plus the highlight composition. A renderer
//! indexes the printed string with these spans, so a violation is a panic in the consumer, not a
//! cosmetic bug.

use redextape_core::analysis::{Attributed, classify_source};
use redextape_core::desugar::desugar;
use redextape_core::lambda::{lower, print_lambda_mapped};
use redextape_core::parser::parse;
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{Unary, defunc, lower_asm, lower_tm, print_asm_mapped, print_tm_mapped};

const CORPUS: &[&str] = &["1 + 2 * 3", "3 - 5", "let x = 1; let y = x + x; y * 3", "[1, 2, 3]"];

fn check(text: &str, spans: &[(redextape_core::Span, redextape_core::analysis::TokenClass)], what: &str) {
    for (s, _) in spans {
        assert!(s.start < s.end, "{what}: zero-width span {s:?}");
        assert!(s.end <= text.len(), "{what}: span {s:?} exceeds {} bytes", text.len());
        assert!(text.is_char_boundary(s.start) && text.is_char_boundary(s.end), "{what}: {s:?} splits a char");
    }
    for w in spans.windows(2) {
        assert!(w[0].0.end <= w[1].0.start, "{what}: spans overlap or unordered: {:?} then {:?}", w[0], w[1]);
    }
}

#[test]
fn every_classifier_produces_well_formed_spans() {
    for src in CORPUS {
        check(src, &classify_source(src), &format!("source {src:?}"));

        let (p, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
        let core = desugar(&p.unwrap());

        let term = lower(&core).expect("lowers");
        let (lt, ls) = print_lambda_mapped(&term);
        check(&lt, &ls, &format!("lambda {src:?}"));

        let prog = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => lower_asm(&defunc(&core).expect("defunc")).expect("lower"),
        };
        let (at, as_) = print_asm_mapped(&prog);
        check(&at, &as_, &format!("asm {src:?}"));

        let m = lower_tm(&prog, &Unary::default());
        let (mt, ms) = print_tm_mapped(&m);
        check(&mt, &ms, &format!("tm {src:?}"));
    }
}

#[test]
fn tm_spans_attribute_to_the_source_constructs_that_produced_them() {
    for src in CORPUS {
        let (p, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
        let core = desugar(&p.unwrap());
        let prog = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => lower_asm(&defunc(&core).expect("defunc")).expect("lower"),
        };
        let m = lower_tm(&prog, &Unary::default());
        let map = SourceMap::build(&core, &Unary::default());
        let (text, spans) = print_tm_mapped(&m);
        let attributed: Attributed = redextape_core::analysis::attribute_tm_spans(&text, &m, &map, &spans);
        assert_eq!(attributed.len(), spans.len(), "{src:?}: attribution must not add or drop spans");
        // At least one span must carry a real source origin, or the composition is doing nothing.
        assert!(
            attributed.iter().any(|(_, _, id)| id.is_some()),
            "{src:?}: no span attributed to any source construct; text was:\n{text}"
        );
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo nextest run -p redextape-core -E 'binary(span_wellformed)'`
Expected: FAIL — `cannot find function 'attribute_tm_spans'`.

- [ ] **Step 3: Implement the composition**

Add to `analysis.rs`:

```rust
/// A classified span plus the Core node it came from, when one is known. `None` covers machine
/// scaffolding and defunc-minted constructs, which have no source construct to point at — the same
/// asymmetry `tm::attribute`'s `StepBucket` already models.
pub type Attributed = Vec<(Span, TokenClass, Option<crate::core::NodeId>)>;

/// Cross printed TM spans with the source map: a span naming a state is attributed to whichever Core
/// node produced that state. This is what lets one construct light up in source, λ and TM at once.
///
/// Takes `text` because a `Span` carries offsets, not the bytes at those offsets — resolving a state
/// name means slicing the string the spans were produced against.
pub fn attribute_tm_spans(text: &str, m: &Machine, map: &SourceMap, spans: &Classified) -> Attributed {
    // state name -> the Core node that produced it, resolved once rather than per span.
    let mut owner: BTreeMap<&str, crate::core::NodeId> = BTreeMap::new();
    for (node, block) in &map.node_to_tm {
        for state in block {
            if let Some(s) = m.states.get(*state as usize) {
                owner.entry(s.name.as_str()).or_insert(*node);
            }
        }
    }
    spans
        .iter()
        .map(|(span, class)| {
            let node = matches!(class, TokenClass::Label | TokenClass::StateName)
                .then(|| owner.get(&text[span.start..span.end]).copied())
                .flatten();
            (*span, *class, node)
        })
        .collect()
}
```

`owner`'s key type must be `&str` borrowed from `m` while the lookup key borrows from `text`; both are `&str`, so the `BTreeMap<&str, NodeId>` lookup works without allocation.

- [ ] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-core -E 'binary(span_wellformed)'`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run everything and commit**

Run: `cargo nextest run -p redextape-core && cargo test -p redextape-core --doc`
Expected: PASS, 0 failed.

```bash
git add crates/redextape-core/src/analysis.rs crates/redextape-core/tests/span_wellformed.rs
git commit -m "feat(core): attribute printed TM spans to source constructs

Crossing the source map with classified spans gives (span, class, origin),
so a renderer can colour by token kind or by which source construct
emitted the state — the same construct lit in source, lambda and TM at
once.

Span well-formedness is asserted for all four classifiers: a renderer
indexes the printed string with these, so an overlap or a split char
boundary is a panic in the consumer, not a cosmetic bug."
```

---

### Task 10: Full gate and the roadmap status update

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (Plan 4 entry)

- [ ] **Step 1: Run the full feature matrix**

Run: `scripts/check-all.sh --no-llvm`
Expected: PASS for the default and `--no-default-features` configurations. This runs `cargo fmt` once, then clippy and tests per configuration. Pass `--no-llvm` only if no LLVM 22 toolchain is installed; otherwise run without it.

- [ ] **Step 2: Run the slow tier**

Run: `scripts/check-slow.sh`
Expected: PASS. The exhaustive sweeps are `#[ignore]`d by default; this slice touches the simulator, so they must be run explicitly before the branch is considered green.

- [ ] **Step 3: Confirm no new dependencies**

Run: `cargo tree -p redextape-core --edges normal`
Expected: `redextape-core v0.0.0` and nothing else. A dependency here is a constraint violation, not a trade-off.

- [ ] **Step 4: Update the roadmap's Plan 4 entry**

Mark the producer slice delivered, listing the interfaces it exposes (`SourceMap`, `StepEvent`, `LambdaCursor`, `TmCursor`, `TokenClass`, `classify_source`, the three `print_*_mapped`, `attribute_tm_spans`) and noting that the consumer slice (`viewmodel.rs`, `redextape-wasm`, serde) remains open. Record anything the implementation learned that contradicts the design doc — per this project's habit of correcting claims a branch falsified rather than leaving them.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs(roadmap): record Plan 4's producer slice as delivered

Lists the interfaces now exposed and leaves the consumer slice
(viewmodel.rs, redextape-wasm, serde) explicitly open."
```

---

## Self-Review

**Spec coverage.** Design §1 (`sourcemap.rs`) → Tasks 1–2. §2 (`trace.rs`) → Tasks 3–4. §3 (`analysis.rs`) → Tasks 5–8. §4 (highlight composition) → Task 9. §5 (error handling) → carried in Global Constraints and each task's totality requirements. §6 testing: item 1 equivalence → Tasks 1/6/7/8 Step 1s; item 2 span well-formedness → Task 9; item 3 trace equivalence → Task 4; item 4 delta resolution → Task 4 Step 1 and its sabotage in Step 7; item 5 non-`TAPES` machine → Task 4 Step 1; item 6 coverage → Task 2; item 7 sabotage → Tasks 2 and 4. §7 measurements → recorded in the spec and roadmap, nothing to build. §8 open questions → deliberately unresolved.

**Known gaps, stated rather than hidden.**

- **Two speculative references were checked and resolved before this plan was finalized.** `Core::for_each_child` does **not** exist — Task 2 now specifies it, with the non-recursion contract the iterative `Drop` implies. There is **no** shared corpus helper — `redextape-test-support` exports only `arb_expr_over`, so Task 1 inlines the demo strings.
- **`for_each_child`'s match arms are written from `id()`'s variant list and must be checked against `core.rs` lines 20–63 before compiling.** The struct-like `Let`/`LetRec`/`LetRecGroup` variants are deliberately deferred to a helper rather than guessed at here.
- **Task 8's implementation is described rather than fully written.** `print_tm_inner` has more shape than the other two printers (header, tape lines, rule lines), and the classification list plus the write-in-place pattern from Tasks 6 and 7 specify it completely. This is the one task where the implementer must transcribe a pattern rather than copy code — deliberate, to avoid a 200-line block that would drift from the actual current function.
- **Task 9's first draft had a wrong signature**, corrected inline in Step 3: a span cannot resolve its own text, so `attribute_tm_spans` takes the printed string. The test in Step 1 must be written against the four-argument form.
- **The four-argument form was itself wrong, and the branch's final review caught it.** Taking a `Machine` beside the `SourceMap` let a caller pair a map with a machine from a *different* lowering, which nothing checked: a map built at `Unary::at(6)` against text printed from `Binary::at(6)` resolved 223 distinct state names where the honest answer is 8, mis-attributing the great majority of state-naming spans in silence. `SourceMap` now records the state-name → `NodeId` association itself, in `tm_half`, where the right machine is already in hand (`tm_name_to_node`, read through `SourceMap::tm_owner`); `attribute_tm_spans` is `(text, map, spans)`. The shipped signature is the **three**-argument form — there is no second object to pass, hence no wrong one. `node_to_tm`/`tm_block` stay: a consumer may legitimately want the state ids.

**Type consistency.** `Classified = Vec<(Span, TokenClass)>` is used identically in Tasks 5–9. `Attributed` adds `Option<NodeId>`. `StepEvent::Delta { state: StateId, rule: u32 }` matches between Tasks 3 and 4 and the test in Task 4. `SourceMap`'s accessors (`lambda_path`, `tm_block`) are named the same in Tasks 2 and 9. `print_*_mapped` returns `(String, Classified)` in all three printer tasks.
