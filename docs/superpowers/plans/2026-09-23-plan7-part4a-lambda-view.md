# Plan 7 part 4a — the λ view: a tree served on demand, two layouts, folding, chips, linking at every step, and the term map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the λ view's 512-byte flat print with a laid-out, foldable term built from a tree the session worker serves for the displayed step, and add the term map — the λ half of [Plan 7 part 4](../specs/2026-09-23-plan7-part4-views-design.md).

**Architecture:** The core gains `LambdaTree` (a pre-order columnar arena carrying display names, links, and the next-redex and contractum marks) and `LambdaCheckpoints` (a cursor clone every 256 steps, so any recorded step can be rebuilt by replay). The wasm session exposes `lambdaTree(step, nodeBudget)` as typed arrays; the worker answers a new `lambda-tree` request between record chunks; a main-thread `LambdaTrees` cache asks for the displayed step's tree once and hands it to the view on the next draw. Everything the view decides — the *code* and *outline* layouts, folding, chips, names or de Bruijn, marks, following, linking and the term map — is client-side over that one tree. Recorded frames, the 32 MiB ring and scrubbing do not change.

**Tech Stack:** Rust (`redextape-core`, `redextape-wasm`, wasm-bindgen + js-sys), TypeScript (vanilla DOM, canvas), Vitest (node and browser projects, Playwright Chromium).

## Global Constraints

- The spec is `docs/superpowers/specs/2026-09-23-plan7-part4-views-design.md` **as amended** (both "Amended" blocks at its head). Where this plan and the spec disagree, stop and ask.
- `LAMBDA_TREE_NODES = 20_000` (spec §4.5). `LAMBDA_CHECKPOINT_EVERY = 256` (spec §4.2). `AUTO_FOLD_NODES = 200` (spec §5.2).
- `FRAME_BYTES` (512), `HISTORY_BYTES` (32 MiB), the `lambda-frames` stream and the history ring are **unchanged**.
- Links: at step 0 a node at a `node_to_lambda` path carries that construct (smaller id first); at every step an `App` carries its owner tag; otherwise `NO_LINK = u32::MAX` (`0xffff_ffff` in TypeScript). The running focus does **not** mark the λ view by owner (spec amendment 2).
- Chips by **hint**, trailing digits ignored (spec amendment 4): `λf. λx. fⁿ x` with hints `f`, `x` is the numeral `n`; `λt. λf. t` / `λt. λf. f` with hints `t`, `f` are `true` / `false`. Anything else is a plain λ. A numeral's bar is CSS (`text-decoration: overline`), not a combining character.
- Folds reset from "reset folds", on a rebind to another session, and on a new build of the same session (spec §5.2 and amendment 5).
- The umbrella's §4 rules bind every control: `▸`/`▾` only disclose; `⋯` only opens the view menu; a glyph-only control takes its tooltip as its accessible name; a control that cannot apply is removed, one that could but cannot now is disabled with its reason.
- Doc comments are `///` in Rust and `/** */` in TypeScript. No `file:line` citations in tracked source (the pre-commit hook rejects them); they are normal in `docs/`. No plan task numbers in shipped code.
- The pre-commit hook runs `cargo fmt --check`, clippy with `-D warnings`, `biome ci --error-on-warnings`, `pnpm run typecheck` and seven hygiene scans on every commit. Never `--no-verify`. A Rust method and its only caller land in the same commit, or `dead_code` fails the hook — Task 2 is one commit for that reason.
- No colour literal outside the palette's fallback block in `web/src/style.css` (the colour gate). Canvas colours are read from CSS custom properties at draw time.
- Every native test and build runs under `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0`. Browser tests need `/usr/sbin` on `PATH` (Chrome). A sabotage run uses `--no-fail-fast`.
- Every key test is sabotaged once before its task is committed, and the sabotage and its result go in the task report. A sabotage that does not fire is a finding, not a pass.

## How to use the code in this plan

**The code below is the prototype's, verbatim, and it was rebuilt from this document's own blocks before the plan was committed** (see Pre-flight status). Each task gives its **new files in full** and its **changes to existing files as a patch**:

- A new file: create it with exactly the content shown.
- A patch: save the block to a file **outside the repository** (the session scratchpad) and run `git apply <that file>` from the repository root. A patch that does not apply means the tree has drifted from the state this plan was built against — `edcb6e8` plus the tasks before it. Stop and report; do not hand-merge.
- Where a task splits its patch into a *tests* part and a *source* part, apply them in that order: the tests go in first so the red step can be observed.

**Stage before running a hygiene scan by hand.** `check-attributions` resolves a citation against *tracked* files, so a new file that is not yet `git add`ed reads as missing and a deleted one that is still in the index reads as present. The hook runs on the staged commit, where neither can happen; a hand run on an unstaged tree can fail — or pass — wrongly.

## Pre-flight status

**Every task was built, gated and sabotaged before this plan was written**, in a scratch worktree at `edcb6e8`. The prototype was then rebuilt task by task from exactly the blocks in this document, staged as a commit would stage it, and checked at every task boundary. Its final tree is byte-identical to the prototype's (`git write-tree` → `c963ec71f0…` both ways).

| Task | At its end state |
|---|---|
| 1 | hook gates clean; `cargo test -p redextape-core --test lambda_tree` → 7 passed; `cargo clippy --workspace --all-targets -- -D warnings` clean |
| 2 | hook gates clean; `cargo test -p redextape-wasm --lib` → 93 passed; clippy clean |
| 3 | hook gates clean; `cargo nextest run -p redextape-core -p redextape-wasm --no-fail-fast` → 1,359 passed, 32 skipped; `scripts/check-all.sh --browser-only` → 27 passed; `frame_cost_probe` runs to completion (135 rows) under its documented 2G cap |
| 4 | hook gates clean; node tier → 612 passed |
| 5 | node tier → 618 |
| 6 | node tier → 629 |
| 7 | node tier → 635 |
| 8 | node tier → 635; `lambda-body`, `lambda-display`, `lambda-tree-app` → 19 passed |
| 9 | node tier → 616 (three test files deleted) |
| 10 | node tier → 618 |
| 11–13 | node tier → 625; every hook gate clean at each |
| final | `pnpm exec vitest run` → 1,162 passed of 1,165. The other three: `fonts.test.ts`'s two cases, which fail only in a scratch worktree whose `node_modules` is a symlink and pass on the main checkout; and `lsp-hover.test.ts`'s "pointer hover survives a move that stays within the same token" — see Task 14, Step 2 |

**55 sabotages were run against the finished prototype, one at a time, each restored before the next** — 44 in the web tiers, 9 in Rust, 1 in the wasm browser tier and 1 against the cost probe's clock. 54 fired; the one that cannot is recorded in Task 1. Each task lists its own.

**What the prototype found, all fixed in the code below:**

1. **A tree asked for during the 300 ms compile debounce was never answered.** `supersede()` moves the generation before the worker hears of it; the worker dropped the request and the view stayed on flat text for good. `LambdaTrees` asks nothing while the client awaits a run (Task 4).
2. **Chrome polluted `.term`'s text.** A width-measuring span, the gutter glyphs, the indentation and the screen-reader mark words were all text nodes, so every test reading the term read them too. The width is measured on a canvas; the glyph and the mark words are CSS generated content; indentation is padding (Task 8).
3. **A finished numeric run drew `λf x. f (f (f …` instead of its value**: the root was asked about before the chip. The chip test comes first (Task 7).
4. **A copy never showed a chip.** A copy re-parses printed text, so its hints are the printer's freshened names (`x0`). Trailing digits are ignored (Task 5; spec amendment 4).
5. **Folds leaked across a rebind, and across a new compile.** The rebind leak was fixed in the prototype, but no test caught it until this pre-flight's sabotage showed none could. The compile leak — which the spec had already ruled out — was found by the same pass and had not been fixed at all. Both are now tested at the pane and the app level (Tasks 4 and 8; spec amendment 5).
6. **A shrinking term's scroll clamp read as the user scrolling away**, so the view stopped following the redex. The clamp is detected after the rows are replaced (Task 8).
7. **The cost probe's first draft measured the harness's 20 ms poll**, not the app. It now reads two clocks inside the app, and a 10 ms stall injected into the worker moved its round trip by 10 ms (Task 13).
8. **The prototype left 34 stale references behind.** 30 were found by sweeping every symbol it deleted against the tree it left, and 4 more by reading what its changes made untrue — a class doc still calling the view "the term as text", and a check's doc naming a mis-colouring nothing can now cause. Examples from the sweep: a doc explaining itself "for the reason `to_tree` is" after `to_tree` was deleted; `renderLink` and `lambdaLinkWindow` still named in live comments; a refusal "stated explicitly below" with no code below; and plan task numbers in two doc comments, one of which would have shipped. Past-tense history that names a deleted thing was kept; every present-tense claim about one was rewritten, at the task that makes it stale.

## File structure

**Created**

| File | Task | Responsibility |
|---|---|---|
| `crates/redextape-core/src/viewmodel/tree.rs` | 1 | `LambdaTree` arena and `TreeAnswer` |
| `crates/redextape-core/tests/lambda_tree.rs` | 1 | the tree and checkpoints held to the reducer and printer at every step of seven programs |
| `web/src/lambda-trees.ts` | 4 | per-session request cache: asks once for the displayed step, stores replies, names the build |
| `web/src/lambda-tree.ts` | 5 | `Tree`: the wire plus parent, depth, size, path keys, links and chips |
| `web/src/lambda-layout.ts` | 6 | `codeLines` and `outlineLines`: a `Tree` to lines of tokens |
| `web/src/lambda-folds.ts` | 7 | `Folds`: the automatic policy and the user's overrides |
| `web/src/lambda-body.ts` | 8 | `LambdaBody`: the virtualized `.term` body — rows, marks, follow, keyboard, flat fallback |
| `web/src/term-map.ts` | 11 | `TermMap`: the icicle and minimap canvas |
| `web/src/tm-seed.ts` | 12 | `seedTm`: hands a TM view the compile it missed while hidden |
| `web/tests/node/tree-fixture.ts` | 5 | builds a `LambdaTreeWire` from λ text, for node and browser tests |
| `web/tests/browser/lambda-text.ts` | 8 | `lambdaSettled()` and `asShown()`: read the λ view once its tree is drawn |
| `web/tests/node/lambda-trees.test.ts`, `lambda-tree.test.ts`, `lambda-layout.test.ts`, `lambda-folds.test.ts`, `term-map.test.ts` | 4–7, 11 | pure-module tests |
| `web/tests/browser/lambda-body.test.ts`, `lambda-display.test.ts`, `lambda-tree-app.test.ts`, `term-map.test.ts`, `hidden-views.test.ts`, `lambda-tree-cost.test.ts` | 8, 11–13 | view, app and probe-tier tests |

**Deleted (Task 9):** `web/src/lambda-window.ts`, `web/tests/node/lambda-window.test.ts`, `web/tests/browser/link-truncated.test.ts`.

**Modified:** `trace.rs`, `lambda/syntax.rs`, `viewmodel.rs`, `examples/frame_cost_probe.rs`, `tests/viewmodel_contract.rs`, `tests/ts_bindings.rs` (core); `session.rs`, `lib.rs`, `tests/browser.rs` (wasm); and in `web/`: `protocol.ts`, `session-worker.ts`, `session-client.ts`, `replies.ts`, `draw.ts`, `main.ts`, `lambda-pane.ts`, `pane-chrome.ts`, `pane-host.ts`, `view-header.ts`, `workspace.ts`, `link.ts`, `link-status.ts`, `link-wiring.ts`, `spans.ts`, `sessions.ts`, `transport.ts`, `types.ts`, `style.css`, `vite.config.ts`, `package.json`, plus the existing tests each task names.

---

### Task 1: `LambdaTree` and `LambdaCheckpoints` in the core

**Files:**
- Create: `crates/redextape-core/src/viewmodel/tree.rs`
- Create: `crates/redextape-core/tests/lambda_tree.rs`
- Modify: `crates/redextape-core/src/trace.rs` (derive `Clone` on `LambdaCursor`; add `LambdaCheckpoints`)
- Modify: `crates/redextape-core/src/lambda/syntax.rs` (`fresh` becomes `pub(crate)` and generic over `AsRef<str>`)
- Modify: `crates/redextape-core/src/viewmodel.rs` (`pub mod tree;` and its re-export)

**Interfaces:**
- Produces: `redextape_core::viewmodel::{LambdaTree, TreeAnswer}`; `viewmodel::tree::{KIND_VAR: u8 = 0, KIND_ABS: u8 = 1, KIND_APP: u8 = 2, NO_LINK: u32 = u32::MAX}`; `LambdaTree::build(term: &LambdaTerm, contractum: Option<&Path>, links: &BTreeMap<NodeId, Path>, node_budget: usize) -> TreeAnswer`; `TreeAnswer::{Tree(LambdaTree), Refused { nodes: u64 }}`; `redextape_core::trace::LambdaCheckpoints::{new(start: &LambdaCursor, every: u64) -> Self, observe(&mut self, c: &LambdaCursor), saved_steps(&self) -> Vec<u64>, at(&self, step: u64) -> Option<LambdaCursor>}`; `LambdaCursor: Clone`.

- [ ] **Step 1: Write the failing test.** Create `crates/redextape-core/tests/lambda_tree.rs`:

````rust
//! `LambdaTree` and `LambdaCheckpoints`, held to the reducer and the printer at every step of a corpus.
//!
//! Each property is checked against an INDEPENDENT authority rather than against a second reading of
//! the builder: the next redex against the path the cursor's next step records, the contractum
//! against `last_redex`, the names against the printer's own output, the shape against the term, and
//! a replayed cursor against one stepped directly from step 0.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::BTreeMap;

use redextape_core::analysis::TokenClass;
use redextape_core::core::NodeId;
use redextape_core::lambda::term::logical_size;
use redextape_core::lambda::{self, Dir, LambdaTerm, MAX_REDUCTION_STEPS, Node, Path, print_lambda_mapped};
use redextape_core::parser;
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{EncodingKind, MIN_FIELD_WIDTH};
use redextape_core::trace::{LambdaCheckpoints, LambdaCursor};
use redextape_core::viewmodel::tree::{KIND_ABS, KIND_APP, KIND_VAR, NO_LINK};
use redextape_core::viewmodel::{LambdaTree, TreeAnswer};

/// Programs spread across the shapes that matter here: arithmetic on numerals, lists, a loop, direct
/// and mutual recursion, and higher-order functions.
const CORPUS: &[(&str, &str)] = &[
    ("sample", "let x = 40; x + 2"),
    ("list2", "[1, 2]"),
    ("while4", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
    ("sum5", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
    ("fact3", "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)"),
    (
        "is_even6",
        "fn is_even(n) { if n == 0 { true } else { is_odd(n - 1) } } \
         fn is_odd(n) { if n == 0 { false } else { is_even(n - 1) } } is_even(6)",
    ),
    (
        "map_fold",
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
         fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
         fn add(a, b) { a + b }\n\
         fn add1(x) { x + 1 }\n\
         fold([3, 1, 2].map(add1), 0, add)",
    ),
];

/// The lowered term and the map whose `node_to_lambda` paths are coordinates into it.
fn lowered(src: &str) -> (LambdaTerm, SourceMap) {
    let (program, diagnostics) = parser::parse(src);
    assert!(diagnostics.is_empty(), "{src}: {diagnostics:?}");
    let program = program.expect("a clean fixture parses");
    let (core, map) = SourceMap::build_from_program(&program, &*EncodingKind::Unary.at(MIN_FIELD_WIDTH));
    (lambda::lower(&core).expect("every corpus program lowers"), map)
}

fn tree_of(term: &LambdaTerm, contractum: Option<&Path>, links: &BTreeMap<NodeId, Path>) -> LambdaTree {
    match LambdaTree::build(term, contractum, links, usize::MAX) {
        TreeAnswer::Tree(t) => t,
        TreeAnswer::Refused { nodes } => panic!("an unreachable budget refused a {nodes}-node term"),
    }
}

/// The node a path names, following the tree's own columns.
fn resolve(tree: &LambdaTree, path: &Path) -> Option<u32> {
    let mut at = 0u32;
    for d in path {
        let kind = tree.kind[at as usize];
        at = match (d, kind) {
            (Dir::AppL, KIND_APP) | (Dir::AbsBody, KIND_ABS) => tree.left[at as usize],
            (Dir::AppR, KIND_APP) => tree.right[at as usize],
            _ => return None,
        };
    }
    Some(at)
}

/// Every step's cursor, from step 0 to the end of the run.
fn every_step(term: &LambdaTerm) -> Vec<LambdaCursor> {
    let mut c = LambdaCursor::new(term, MAX_REDUCTION_STEPS);
    let mut out = vec![c.clone()];
    while c.next().is_some() {
        out.push(c.clone());
    }
    out
}

#[test]
fn the_next_redex_is_the_one_the_next_step_contracts() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        let steps = every_step(&term);
        for (k, c) in steps.iter().enumerate() {
            let tree = tree_of(c.term(), c.last_redex(), &BTreeMap::new());
            let expected =
                steps.get(k + 1).map(|next| resolve(&tree, next.last_redex().expect("a step records its redex")));
            assert_eq!(
                tree.next_redex,
                expected.map(|n| n.expect("the next step's redex path resolves in this step's tree")),
                "{name} step {k}"
            );
        }
    }
}

#[test]
fn the_contractum_is_where_the_last_step_left_its_result() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        for (k, c) in every_step(&term).iter().enumerate() {
            let tree = tree_of(c.term(), c.last_redex(), &BTreeMap::new());
            let expected = c.last_redex().map(|p| resolve(&tree, p).expect("the contractum path resolves"));
            assert_eq!(tree.contractum, expected, "{name} step {k}");
            assert_eq!(tree.contractum.is_some(), k > 0, "{name} step {k}: a contractum exists exactly after a step");
        }
    }
}

/// The printer writes a binder's name, then its body; a function, then its argument — pre-order. So
/// the names it prints, in order, are the tree's `Abs` and `Var` names in index order.
#[test]
fn the_names_are_the_printers_names() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        for (k, c) in every_step(&term).iter().enumerate() {
            let tree = tree_of(c.term(), None, &BTreeMap::new());
            let (text, spans) = print_lambda_mapped(c.term());
            let printed: Vec<&str> = spans
                .iter()
                .filter(|(_, class)| matches!(class, TokenClass::Binder | TokenClass::Ident))
                .map(|(span, _)| &text[span.start..span.end])
                .filter(|s| *s != "\u{3bb}")
                .collect();
            let ours: Vec<&str> = (0..tree.kind.len())
                .filter(|&i| tree.kind[i] != KIND_APP)
                .map(|i| tree.names[tree.name[i] as usize].as_str())
                .collect();
            assert_eq!(ours, printed, "{name} step {k}");
        }
    }
}

/// One entry per occurrence, children after their parent, and the same shape as the term.
#[test]
fn the_tree_is_the_terms_shape_in_pre_order() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        for (k, c) in every_step(&term).iter().enumerate() {
            let tree = tree_of(c.term(), None, &BTreeMap::new());
            assert_eq!(tree.kind.len() as u64, logical_size(c.term()), "{name} step {k}: one entry per occurrence");
            let mut work: Vec<(u32, &LambdaTerm)> = vec![(0, c.term())];
            while let Some((i, t)) = work.pop() {
                let at = i as usize;
                match t.node() {
                    Node::Var(ix) => {
                        assert_eq!((tree.kind[at], tree.left[at]), (KIND_VAR, *ix), "{name} step {k} node {i}");
                    }
                    Node::Abs(hint, body) => {
                        assert_eq!(tree.kind[at], KIND_ABS, "{name} step {k} node {i}");
                        assert_eq!(tree.names[tree.hint[at] as usize], hint.as_ref(), "{name} step {k} node {i}");
                        assert!(tree.left[at] > i, "{name} step {k}: a body comes after its binder");
                        work.push((tree.left[at], body));
                    }
                    Node::App(f, a, _) => {
                        assert_eq!(tree.kind[at], KIND_APP, "{name} step {k} node {i}");
                        assert!(tree.left[at] > i && tree.right[at] > tree.left[at], "{name} step {k}: pre-order");
                        work.push((tree.left[at], f));
                        work.push((tree.right[at], a));
                    }
                }
            }
        }
    }
}

#[test]
fn a_replayed_cursor_is_the_cursor_stepped_directly() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        let steps = every_step(&term);
        // A small interval, so most steps are rebuilt by replay rather than read off a checkpoint.
        let mut live = LambdaCursor::new(&term, MAX_REDUCTION_STEPS);
        let mut marks = LambdaCheckpoints::new(&live, 7);
        while live.next().is_some() {
            marks.observe(&live);
        }
        for (k, direct) in steps.iter().enumerate() {
            let replayed = marks.at(k as u64).expect("a step the run reached can be rebuilt");
            assert_eq!(replayed.steps_taken(), k as u64, "{name} step {k}");
            assert!(replayed.term() == direct.term(), "{name} step {k}: the terms differ");
            assert_eq!(replayed.last_redex(), direct.last_redex(), "{name} step {k}");
        }
        assert!(marks.at(steps.len() as u64).is_none(), "{name}: a step past the end is not rebuilt");
    }
}

/// At step 0 a construct's `node_to_lambda` path carries its id — the smaller id where two share a
/// path — and every other `App` carries its own owner tag.
#[test]
fn step_zero_links_every_construct_the_map_places() {
    for (name, src) in CORPUS {
        let (term, map) = lowered(src);
        let tree = tree_of(&term, None, &map.node_to_lambda);
        let mut first: BTreeMap<&Path, NodeId> = BTreeMap::new();
        for (id, path) in &map.node_to_lambda {
            first.entry(path).or_insert(*id);
        }
        for (path, id) in &first {
            let at = resolve(&tree, path).expect("a map path resolves in the step-0 tree");
            assert_eq!(tree.link[at as usize], *id, "{name}: the node at {path:?}");
        }
        let without = tree_of(&term, None, &BTreeMap::new());
        let mut work: Vec<(u32, &LambdaTerm)> = vec![(0, &term)];
        while let Some((i, t)) = work.pop() {
            match t.node() {
                Node::Var(_) => assert_eq!(without.link[i as usize], NO_LINK, "{name}: a variable carries no tag"),
                Node::Abs(_, body) => {
                    assert_eq!(without.link[i as usize], NO_LINK, "{name}: an abstraction carries no tag");
                    work.push((without.left[i as usize], body));
                }
                Node::App(f, a, owner) => {
                    assert_eq!(without.link[i as usize], owner.unwrap_or(NO_LINK), "{name}: node {i}");
                    work.push((without.left[i as usize], f));
                    work.push((without.right[i as usize], a));
                }
            }
        }
    }
}

#[test]
fn the_budget_refuses_one_node_short_and_admits_exactly_enough() {
    let (term, _) = lowered("fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)");
    let size = logical_size(&term);
    let n = usize::try_from(size).unwrap();
    assert_eq!(LambdaTree::build(&term, None, &BTreeMap::new(), n - 1), TreeAnswer::Refused { nodes: size });
    assert!(matches!(LambdaTree::build(&term, None, &BTreeMap::new(), n), TreeAnswer::Tree(t) if t.kind.len() == n));
}
````

- [ ] **Step 2: Run it to verify it fails.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo test -p redextape-core --test lambda_tree`
Expected: FAIL to compile — the test imports `LambdaCheckpoints` and the `viewmodel::tree` items, and neither exists yet.

- [ ] **Step 3: Write the arena.** Create `crates/redextape-core/src/viewmodel/tree.rs`:

````rust
//! The λ term as a laid-out view needs it: every node, in pre-order, with the names the printer would
//! give it, the construct it links to, and where the next redex and the last contractum sit.
//!
//! **PRE-ORDER, NOT POST-ORDER.** `nodes[0]` is the root and a node's children come after it, which
//! is the order the printer writes a term in: a renderer walking indices upward walks the text left
//! to right. It is also the order in which the first `App` whose function is an `Abs` is the
//! leftmost-outermost redex, so the walk that builds the arena finds the next redex without a second
//! traversal (spec amendment 3).
//!
//! **COLUMNS, NOT A VEC OF ENUMS**, because this crosses the wasm boundary as typed arrays (the
//! `linkIndex` precedent in `redextape-wasm`'s `lib.rs`): one buffer per column, not one JS object
//! per node.

use std::collections::BTreeMap;

use crate::core::NodeId;
use crate::lambda::{Dir, LambdaTerm, Node, Path};

/// `kind[i]` for a variable.
pub const KIND_VAR: u8 = 0;
/// `kind[i]` for an abstraction.
pub const KIND_ABS: u8 = 1;
/// `kind[i]` for an application.
pub const KIND_APP: u8 = 2;
/// `link[i]` for a node that links to no construct. `NodeId` is bounded by `core::MAX_NODE_ID`, far
/// below this, so the sentinel cannot collide with a real id.
pub const NO_LINK: u32 = u32::MAX;

/// A term as parallel columns indexed by node, in pre-order. See the module doc.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LambdaTree {
    /// `KIND_VAR`, `KIND_ABS` or `KIND_APP`.
    pub kind: Vec<u8>,
    /// A `Var`'s de Bruijn index; an `Abs`'s body; an `App`'s function.
    pub left: Vec<u32>,
    /// An `App`'s argument; `0` for the other two kinds.
    pub right: Vec<u32>,
    /// An index into `names`: an `Abs`'s display name, or a `Var`'s — its binder's display name, or
    /// `?i` for a free variable, exactly as the printer writes it. `0` for an `App`.
    pub name: Vec<u32>,
    /// An index into `names`: an `Abs`'s raw hint, before freshening. `0` for the other two kinds.
    pub hint: Vec<u32>,
    /// The construct this node links to, or `NO_LINK`.
    pub link: Vec<u32>,
    /// Every distinct string `name` and `hint` index, each once.
    pub names: Vec<String>,
    /// The leftmost-outermost redex — the `App` the next step contracts — or `None` in normal form.
    pub next_redex: Option<u32>,
    /// The subterm the step that produced this term left at its redex's path, or `None` at step 0.
    pub contractum: Option<u32>,
}

/// What `LambdaTree::build` answers: a whole tree, or the term's size when it exceeds the budget.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TreeAnswer {
    Tree(LambdaTree),
    /// The term's logical size, one per occurrence — the number the budget was compared against.
    Refused {
        nodes: u64,
    },
}

/// One unit of the builder's explicit stack.
enum Work<'a> {
    /// Visit `t` as the child of `parent` in direction `dir`, at `depth` edges below the root.
    Enter { t: &'a LambdaTerm, parent: u32, dir: Option<Dir>, depth: usize },
    /// Leave an `Abs`: its binder's display name goes out of scope.
    Leave,
}

impl LambdaTree {
    /// Build the tree of `term`, or refuse when it has more than `node_budget` nodes.
    ///
    /// `contractum` is the path `LambdaCursor::last_redex` reports for this term. `links` maps a
    /// construct to a path into THIS term — `SourceMap::node_to_lambda`, and only at step 0, where its
    /// paths are coordinates into the term being built; any other step passes an empty map. A path
    /// named by two constructs links to the smaller id, `print_lambda_linked`'s rule.
    ///
    /// ITERATIVE, over an explicit stack: a term can be deeper than a native recursive walk survives.
    #[must_use]
    pub fn build(
        term: &LambdaTerm,
        contractum: Option<&Path>,
        links: &BTreeMap<NodeId, Path>,
        node_budget: usize,
    ) -> TreeAnswer {
        let mut by_path: BTreeMap<&Path, NodeId> = BTreeMap::new();
        for (id, path) in links {
            by_path.entry(path).or_insert(*id);
        }
        let mut b = Builder::default();
        let mut scope: Vec<u32> = Vec::new();
        let mut path: Path = Vec::new();
        let mut work = vec![Work::Enter { t: term, parent: u32::MAX, dir: None, depth: 0 }];
        while let Some(item) = work.pop() {
            let (t, parent, dir, depth) = match item {
                Work::Leave => {
                    scope.pop();
                    continue;
                }
                Work::Enter { t, parent, dir, depth } => (t, parent, dir, depth),
            };
            if b.tree.kind.len() >= node_budget {
                return TreeAnswer::Refused { nodes: crate::lambda::term::logical_size(term) };
            }
            path.truncate(depth.saturating_sub(1));
            if let Some(d) = dir {
                path.push(d);
            }
            let Ok(me) = u32::try_from(b.tree.kind.len()) else {
                return TreeAnswer::Refused { nodes: crate::lambda::term::logical_size(term) };
            };
            // `get_mut`, never `[]`: `parent` is always an index this walk already pushed, but a library
            // path does not index where it can ask.
            let column = match dir {
                Some(Dir::AppR) => Some(&mut b.tree.right),
                Some(Dir::AppL | Dir::AbsBody) => Some(&mut b.tree.left),
                None => None,
            };
            if let Some(slot) = column.and_then(|c| c.get_mut(parent as usize)) {
                *slot = me;
            }
            let tag = match t.node() {
                Node::App(_, _, owner) => *owner,
                _ => None,
            };
            b.tree.link.push(by_path.get(&path).copied().or(tag).unwrap_or(NO_LINK));
            if contractum.is_some_and(|c| *c == path) {
                b.tree.contractum = Some(me);
            }
            match t.node() {
                Node::Var(i) => {
                    let name = scope
                        .len()
                        .checked_sub(1 + *i as usize)
                        .and_then(|k| scope.get(k).copied())
                        .unwrap_or_else(|| b.intern(&format!("?{i}")));
                    b.push(KIND_VAR, *i, name, 0);
                }
                Node::Abs(hint, body) => {
                    let shown: Vec<&str> =
                        scope.iter().filter_map(|&n| b.tree.names.get(n as usize)).map(String::as_str).collect();
                    let display = crate::lambda::syntax::fresh(hint, &shown);
                    let name = b.intern(&display);
                    let raw = b.intern(hint);
                    b.push(KIND_ABS, 0, name, raw);
                    scope.push(name);
                    work.push(Work::Leave);
                    work.push(Work::Enter { t: body, parent: me, dir: Some(Dir::AbsBody), depth: depth + 1 });
                }
                Node::App(f, a, _) => {
                    if b.tree.next_redex.is_none() && matches!(f.node(), Node::Abs(..)) {
                        b.tree.next_redex = Some(me);
                    }
                    b.push(KIND_APP, 0, 0, 0);
                    work.push(Work::Enter { t: a, parent: me, dir: Some(Dir::AppR), depth: depth + 1 });
                    work.push(Work::Enter { t: f, parent: me, dir: Some(Dir::AppL), depth: depth + 1 });
                }
            }
        }
        TreeAnswer::Tree(b.tree)
    }
}

/// The tree under construction and the index of every string already interned.
#[derive(Default)]
struct Builder {
    tree: LambdaTree,
    interned: BTreeMap<String, u32>,
}

impl Builder {
    fn push(&mut self, kind: u8, left: u32, name: u32, hint: u32) {
        self.tree.kind.push(kind);
        self.tree.left.push(left);
        self.tree.right.push(0);
        self.tree.name.push(name);
        self.tree.hint.push(hint);
    }

    /// The index of `s` in `names`, adding it on first sight. Names are few — a term's distinct binder
    /// names — so the table stays small however large the term is.
    fn intern(&mut self, s: &str) -> u32 {
        if let Some(&i) = self.interned.get(s) {
            return i;
        }
        // `names` holds at most one entry per distinct string in a tree already under `node_budget`,
        // so it cannot outgrow `u32` before `kind` does; saturating keeps this total without a panic.
        let i = u32::try_from(self.tree.names.len()).unwrap_or(u32::MAX);
        self.tree.names.push(s.to_string());
        self.interned.insert(s.to_string(), i);
        i
    }
}
````

- [ ] **Step 4: Apply the core edits.** The patch derives `Clone` on `LambdaCursor`, adds `LambdaCheckpoints` after it, opens `fresh` to the crate, and registers the module:

````diff
diff --git a/crates/redextape-core/src/lambda/syntax.rs b/crates/redextape-core/src/lambda/syntax.rs
index 15fcd30..956c1b5 100644
--- a/crates/redextape-core/src/lambda/syntax.rs
+++ b/crates/redextape-core/src/lambda/syntax.rs
@@ -501,9 +501,9 @@ impl Printer<'_> {
     }
 }
 
-fn fresh(hint: &str, names: &[String]) -> String {
+pub(crate) fn fresh<S: AsRef<str>>(hint: &str, names: &[S]) -> String {
     let base = if hint.is_empty() { "v" } else { hint };
-    if !names.iter().any(|n| n == base) {
+    if !names.iter().any(|n| n.as_ref() == base) {
         return base.to_string();
     }
     // PIGEONHOLE, which is what lets this be a bounded loop rather than `0..` with an `unreachable!()`
@@ -515,7 +515,7 @@ fn fresh(hint: &str, names: &[String]) -> String {
     // no way to recover — for a case that cannot arise.
     for k in 0..=names.len() {
         let cand = format!("{base}{k}");
-        if !names.contains(&cand) {
+        if !names.iter().any(|n| n.as_ref() == cand) {
             return cand;
         }
     }
diff --git a/crates/redextape-core/src/trace.rs b/crates/redextape-core/src/trace.rs
index f367771..9900fd5 100644
--- a/crates/redextape-core/src/trace.rs
+++ b/crates/redextape-core/src/trace.rs
@@ -40,6 +40,11 @@ pub enum StepEvent {
 /// Lazy β-reduction. Holds one term, never a history — O(1) in the number of steps, where
 /// `lambda::reduce_trace` is O(steps) by contract. `reduce_trace` is written over this cursor, so the
 /// β-stepping loop exists once in the crate rather than twice.
+///
+/// **`Clone` IS A CHECKPOINT.** Every field is an `Rc`-backed term or a few words, so a clone costs a
+/// refcount bump and shares the whole term with the original; `LambdaCheckpoints` keeps one per
+/// interval and replays from it.
+#[derive(Clone)]
 pub struct LambdaCursor {
     current: LambdaTerm,
     steps: u64,
@@ -179,6 +184,64 @@ impl Iterator for LambdaCursor {
     }
 }
 
+/// Enough of a λ run's past to rebuild the cursor at any step it has reached, by replaying at most
+/// `every - 1` steps from the nearest saved one.
+///
+/// **A CLONE PER INTERVAL, NOT A TERM PER STEP.** Recording every step's term is what the frame ring
+/// cannot afford (a whole-term print of every `fact(4)` step is 99 MB); a cursor clone shares its term
+/// with every other, so memory grows with steps ÷ `every` and with the nodes reduction actually
+/// allocates, not with the size of each term.
+///
+/// THE INTERVAL IS THE CALLER'S. This module picks no renderer policy, the same rule `viewmodel.rs`
+/// states for budgets.
+pub struct LambdaCheckpoints {
+    every: u64,
+    /// Ascending by `steps_taken()`, starting with the cursor `new` was handed.
+    saved: Vec<LambdaCursor>,
+}
+
+impl LambdaCheckpoints {
+    /// Start from `start`, which is saved as the first checkpoint. An `every` of 0 is taken as 1.
+    #[must_use]
+    pub fn new(start: &LambdaCursor, every: u64) -> Self {
+        LambdaCheckpoints { every: every.max(1), saved: vec![start.clone()] }
+    }
+
+    /// Save `c` if it sits on an interval boundary past the last checkpoint. Call it after each step;
+    /// a step it misses costs replay, never correctness.
+    pub fn observe(&mut self, c: &LambdaCursor) {
+        let step = c.steps_taken();
+        let last = self.saved.last().map_or(0, LambdaCursor::steps_taken);
+        if step.is_multiple_of(self.every) && step > last {
+            self.saved.push(c.clone());
+        }
+    }
+
+    /// The steps a checkpoint sits at, ascending. A missed checkpoint costs replay and never changes
+    /// an answer, so no test that compares answers can see one; this is what a test reads instead.
+    #[must_use]
+    pub fn saved_steps(&self) -> Vec<u64> {
+        self.saved.iter().map(LambdaCursor::steps_taken).collect()
+    }
+
+    /// A cursor at exactly `step`, or `None` when the run ends before it. The caller clamps `step` to
+    /// its live cursor's position first; a step no run has reached is not a step to rebuild.
+    #[must_use]
+    pub fn at(&self, step: u64) -> Option<LambdaCursor> {
+        let i = self.saved.partition_point(|c| c.steps_taken() <= step).checked_sub(1)?;
+        let mut c = self.saved.get(i)?.clone();
+        // THE CLONE'S CAP IS LIFTED, because it is the cap the run had when the checkpoint was taken.
+        // A cap raised since then would otherwise strand every checkpoint below it, and the caller has
+        // already clamped `step` to a position its live cursor reached, so no cap has anything left to
+        // say about this replay. `raise_cap` leaves a depth-refused cursor latched, as it should.
+        c.raise_cap(u64::MAX);
+        while c.steps_taken() < step {
+            c.next()?;
+        }
+        Some(c)
+    }
+}
+
 /// Lazy δ-stepping, and THE δ-stepping loop in this crate. `sim::run` — the single implementation behind
 /// `simulate`, `simulate_final`, `simulate_watched`, `simulate_trace` and `simulate_counts` — is written
 /// over this cursor, so the guard sequence below exists once rather than once per backend. Borrowing the
diff --git a/crates/redextape-core/src/viewmodel.rs b/crates/redextape-core/src/viewmodel.rs
index fa1d604..b22b46c 100644
--- a/crates/redextape-core/src/viewmodel.rs
+++ b/crates/redextape-core/src/viewmodel.rs
@@ -22,6 +22,10 @@ use crate::span::Span;
 use crate::tm::machine::{Machine, Move, StateId, Symbol};
 use crate::trace::{LambdaCursor, TmCursor};
 
+pub mod tree;
+
+pub use tree::{LambdaTree, TreeAnswer};
+
 /// NO `redex` FIELD, DELIBERATELY. §4.2 lists one, and nothing in this PR can fill it: a redex is a
 /// `Path` INTO THE TERM, while highlighting it in `text` needs a byte SPAN, and correlating the two
 /// means the printer recording where a given path lands as it walks — real work in
````

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo test -p redextape-core --test lambda_tree`
Expected: `7 passed`.

Then: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy --workspace --all-targets -- -D warnings` → no warnings.

- [ ] **Step 6: Sabotage, one at a time, reverting after each.** Each was run against the finished prototype:

| Sabotage | Fails |
|---|---|
| `tree.rs`: `if b.tree.next_redex.is_none() && matches!` → `if matches!` (the LAST `App(Abs, _)` wins) | `the_next_redex_is_the_one_the_next_step_contracts` |
| `tree.rs`: `let display = crate::lambda::syntax::fresh(hint, &shown);` → `let display = { let _ = &shown; hint.to_string() };` | `the_names_are_the_printers_names` |
| `trace.rs`: `while c.steps_taken() < step {` → `while c.steps_taken() + 1 < step {` | `a_replayed_cursor_is_the_cursor_stepped_directly` |
| `tree.rs`: `if contractum.is_some_and(\|c\| *c == path) {` → `if contractum.is_some_and(\|c\| c.len() + 1 == path.len() && path.starts_with(c)) {` | `the_contractum_is_where_the_last_step_left_its_result` |
| `tree.rs`: `by_path.get(&path).copied().or(tag)` → `tag.or(by_path.get(&path).copied())` | **nothing — and nothing can.** On all seven corpus programs every `App` with a tag has a step-0 path link equal to that tag (0 disagreements), so the order is unobservable. The code keeps path-first and says why; no test claims to pin it. Record this in the report rather than writing a test that would pass either way. |

- [ ] **Step 7: Commit.**

```bash
git add crates/redextape-core/src/viewmodel/tree.rs crates/redextape-core/tests/lambda_tree.rs \
  crates/redextape-core/src/trace.rs crates/redextape-core/src/lambda/syntax.rs crates/redextape-core/src/viewmodel.rs
git commit -m "Core: LambdaTree lays a term out in pre-order with the printer's names, its links and both redex marks, and LambdaCheckpoints rebuilds any step by replay"
```

---

### Task 2: `lambdaTree` on the session, the scratch, and the wasm boundary

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs` (`LambdaLeg`, `TreeAt`, `LAMBDA_CHECKPOINT_EVERY`, `lambda_tree` on `Session` and `LambdaScratch`, eight tests)
- Modify: `crates/redextape-wasm/src/lib.rs` (`tree_to_js`, `lambdaTree` on both classes)

**Interfaces:**
- Consumes: Task 1's `LambdaTree`, `TreeAnswer`, `LambdaCheckpoints`.
- Produces: `session::LAMBDA_CHECKPOINT_EVERY: u64 = 256`; `session::TreeAt { step: u64, answer: TreeAnswer }`; `Session::lambda_tree(&self, step: u64, node_budget: usize) -> Result<TreeAt, SessionError>`; `LambdaScratch::lambda_tree(&self, step: u64, node_budget: usize) -> TreeAt`; JS `session.lambdaTree(step: number, nodeBudget: number)` and `scratch.lambdaTree(step, nodeBudget)` returning `{ step: number, refused: number | null, kind: Uint8Array, left: Uint32Array, right: Uint32Array, name: Uint32Array, hint: Uint32Array, link: Uint32Array, names: string[], nextRedex: number | null, contractum: number | null }`.

**ONE COMMIT, NOT TWO.** `lambda_tree` on the session has no caller until `lib.rs` exports it, and the pre-commit clippy run is `-D warnings`, so splitting the session from the export fails `dead_code` on the first commit.

**The λ cursor becomes a `LambdaLeg`.** `Session.lambda` changes from `Result<LambdaCursor, LowerError>` to `Result<LambdaLeg, LowerError>`, and `LambdaScratch.lambda` from `LambdaCursor` to `LambdaLeg`, so no path can advance a cursor without its checkpoints seeing it. Every existing λ method reads `leg.cursor` where it read `c`; `run_lambda_cursor` takes the leg. The session's tests live in the same file, so they come in with the code; in the prototype they were written first and failed to compile until the code existed.

- [ ] **Step 1: Apply the session change, its tests, and the boundary.**

````diff
diff --git a/crates/redextape-wasm/src/lib.rs b/crates/redextape-wasm/src/lib.rs
index ea5955d..4235df4 100644
--- a/crates/redextape-wasm/src/lib.rs
+++ b/crates/redextape-wasm/src/lib.rs
@@ -349,6 +349,46 @@ fn to_value<T: Serialize>(v: &T) -> Result<JsValue, JsValue> {
     Ok(v.serialize(&s)?)
 }
 
+/// A `TreeAt` as `{ step, refused, kind, left, right, name, hint, link, names, nextRedex, contractum }`.
+///
+/// **TYPED ARRAYS, BUILT BY HAND, FOR `linkIndex`'s REASON** (see that method's doc): a 20,000-node tree
+/// through `serde_wasm_bindgen` is 20,000 objects per column, where this is one buffer per column, and
+/// buffers transfer from the worker without a copy.
+///
+/// `refused` is the term's node count when it exceeded the budget, and every column is then empty;
+/// otherwise it is `null`. `nextRedex` and `contractum` are node indices or `null`.
+// `u64 as f64` IS EXACT HERE: a step count is bounded by `MAX_REDUCTION_STEPS` (5,000,000) and a
+// refusal's node count by what a budget can be compared against; both sit far below 2^53, where an
+// `f64` stops representing every integer.
+#[allow(clippy::cast_precision_loss)]
+fn tree_to_js(at: &session::TreeAt) -> Result<JsValue, JsValue> {
+    use redextape_core::viewmodel::{LambdaTree, TreeAnswer};
+    let empty = LambdaTree::default();
+    let (tree, refused) = match &at.answer {
+        TreeAnswer::Tree(t) => (t, JsValue::NULL),
+        TreeAnswer::Refused { nodes } => (&empty, JsValue::from_f64(*nodes as f64)),
+    };
+    let names = js_sys::Array::new();
+    for n in &tree.names {
+        names.push(&JsValue::from_str(n));
+    }
+    let index = |v: Option<u32>| v.map_or(JsValue::NULL, |n| JsValue::from_f64(f64::from(n)));
+    let out = js_sys::Object::new();
+    let set = |k: &str, v: &JsValue| js_sys::Reflect::set(&out, &JsValue::from_str(k), v);
+    set("step", &JsValue::from_f64(at.step as f64))?;
+    set("refused", &refused)?;
+    set("kind", &js_sys::Uint8Array::from(&tree.kind[..]))?;
+    set("left", &js_sys::Uint32Array::from(&tree.left[..]))?;
+    set("right", &js_sys::Uint32Array::from(&tree.right[..]))?;
+    set("name", &js_sys::Uint32Array::from(&tree.name[..]))?;
+    set("hint", &js_sys::Uint32Array::from(&tree.hint[..]))?;
+    set("link", &js_sys::Uint32Array::from(&tree.link[..]))?;
+    set("names", &names)?;
+    set("nextRedex", &index(tree.next_redex))?;
+    set("contractum", &index(tree.contractum))?;
+    Ok(out.into())
+}
+
 #[wasm_bindgen]
 impl Session {
     // --- the λ leg ----------------------------------------------------------------------------
@@ -392,6 +432,18 @@ impl Session {
         to_value(&self.0.lambda_ast(node_budget).map_err(err)?)
     }
 
+    /// `lambdaTree(step, nodeBudget)` -> the term at `step` (clamped to the run) as typed arrays; see
+    /// `tree_to_js` for the shape. `u32` and widened, for `raiseLambdaCap`'s reason.
+    ///
+    /// # Errors
+    ///
+    /// Returns `Err` when this session's λ leg is absent, or if assembling the object fails. A term over
+    /// `nodeBudget` is NOT an error: it answers with `refused` set.
+    #[wasm_bindgen(js_name = lambdaTree)]
+    pub fn lambda_tree(&self, step: u32, node_budget: usize) -> Result<JsValue, JsValue> {
+        tree_to_js(&self.0.lambda_tree(u64::from(step), node_budget).map_err(err)?)
+    }
+
     /// `u32` RATHER THAN THE `u64` THE CURSOR TAKES, widened here. wasm-bindgen maps `u64` to JS
     /// `bigint`, so a `u64` parameter would make §5.1's `raiseLambdaCap(extra: number)` a `bigint` at
     /// the call site and force every caller to write `BigInt(n)`. Nothing is lost: the raise is
@@ -705,6 +757,16 @@ impl LambdaScratch {
         to_value(&self.0.lambda_ast(node_budget))
     }
 
+    /// `lambdaTree(step, nodeBudget)`, as on `Session`; a scratch's trees carry no links.
+    ///
+    /// # Errors
+    ///
+    /// Returns `Err` only if assembling the object fails.
+    #[wasm_bindgen(js_name = lambdaTree)]
+    pub fn lambda_tree(&self, step: u32, node_budget: usize) -> Result<JsValue, JsValue> {
+        tree_to_js(&self.0.lambda_tree(u64::from(step), node_budget))
+    }
+
     /// `u32` and widened, for the reason `Session::raiseLambdaCap` records: wasm-bindgen maps `u64` to
     /// JS `bigint`, and the raise is additive, so a caller wanting more than 4.29e9 calls it twice.
     #[wasm_bindgen(js_name = raiseLambdaCap)]
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index 88d9c71..b33c282 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -5,6 +5,7 @@
 //! a browser while `cargo llvm-cov` instruments the native build, so any logic living in the shell is
 //! uncovered by construction and drags the workspace's 80% floor down with it.
 
+use std::collections::BTreeMap;
 use std::rc::Rc;
 
 use redextape_core::core::NodeId;
@@ -12,8 +13,8 @@ use redextape_core::lambda::{self, LambdaTerm, LowerError};
 use redextape_core::sourcemap::SourceMap;
 use redextape_core::tm::machine::Machine;
 use redextape_core::tm::{self, EncodingKind, Symbol, Tape, TmRun};
-use redextape_core::trace::{LambdaCursor, TmCursor};
-use redextape_core::viewmodel::{LambdaState, LinkIndex, TermTree, TmProgram, TmState};
+use redextape_core::trace::{LambdaCheckpoints, LambdaCursor, TmCursor};
+use redextape_core::viewmodel::{LambdaState, LambdaTree, LinkIndex, TermTree, TmProgram, TmState, TreeAnswer};
 use redextape_core::{Diagnostic, Severity, Span, lints, parser, typeck};
 
 /// The deepest term any print through the session may walk — the two big-budget prints
@@ -305,7 +306,7 @@ pub struct Session {
     /// `decode_tape_ty(&tapes, &ty, enc)`. `compile` computes it for `run_tm_described` and passed
     /// it away; decoding is type-directed, so a session that discarded it could not decode anything.
     pub(crate) ty: redextape_core::ty::Ty,
-    pub(crate) lambda: Result<LambdaCursor, LowerError>,
+    pub(crate) lambda: Result<LambdaLeg, LowerError>,
     /// The INITIAL lowered term, kept so `link_index` can print step 0 after the cursor has moved.
     ///
     /// ONE `Rc` BUMP, NOT A COPY. `LambdaTerm` is `Rc`-backed and persistent, so retaining the root
@@ -432,6 +433,61 @@ fn tm_leg_at(
 ///
 /// `depth_capped` is what separates the two: the cursor latches `HitCap` for both producers, and only
 /// the step cap can be raised out of.
+/// How many β-steps apart the λ leg's checkpoints sit: a tree for any past step is rebuilt by replaying
+/// at most this many minus one. Spec §4.2: a whole `fact(4)` run re-reduces in about 13 ms natively,
+/// so 255 steps of it cost well under a millisecond.
+pub const LAMBDA_CHECKPOINT_EVERY: u64 = 256;
+
+/// A λ cursor and the checkpoints that let a past step be rebuilt, TRAVELLING TOGETHER, for the reason
+/// the `tm` field's doc gives for pairing a cursor with its program: a cursor that moved without its
+/// checkpoints seeing it is a state this type cannot spell. `step` and `run` are the only ways the
+/// cursor advances.
+pub(crate) struct LambdaLeg {
+    pub(crate) cursor: LambdaCursor,
+    marks: LambdaCheckpoints,
+}
+
+/// A tree for the step a caller asked for, and the step it actually is.
+///
+/// **`step` IS AN ANSWER, NOT AN ECHO.** A request past the live cursor is clamped to where the run
+/// has reached, and the reply says so, so a view never draws one step's tree under another's number.
+#[derive(Debug)]
+pub struct TreeAt {
+    pub step: u64,
+    pub answer: TreeAnswer,
+}
+
+impl LambdaLeg {
+    pub(crate) fn new(term: &LambdaTerm, cap: u64) -> LambdaLeg {
+        let cursor = LambdaCursor::new(term, cap);
+        let marks = LambdaCheckpoints::new(&cursor, LAMBDA_CHECKPOINT_EVERY);
+        LambdaLeg { cursor, marks }
+    }
+
+    /// Advance one β-step; `false` once the run has ended.
+    pub(crate) fn step(&mut self) -> bool {
+        let stepped = self.cursor.next().is_some();
+        if stepped {
+            self.marks.observe(&self.cursor);
+        }
+        stepped
+    }
+
+    /// The tree at `step`, clamped to the live cursor. `links` is consulted only at step 0, where
+    /// `node_to_lambda`'s paths are coordinates into the term being built (spec §4.3).
+    pub(crate) fn tree(&self, step: u64, node_budget: usize, links: &BTreeMap<NodeId, lambda::Path>) -> TreeAt {
+        let live = self.cursor.steps_taken();
+        let wanted = step.min(live);
+        // `at` rebuilds any step up to `live`, so its `None` is unreachable here; the live cursor is
+        // the honest fallback, because `TreeAt` reports the step it answers rather than the one asked.
+        let cursor = if wanted == live { None } else { self.marks.at(wanted) };
+        let c = cursor.as_ref().unwrap_or(&self.cursor);
+        let empty = BTreeMap::new();
+        let links = if c.steps_taken() == 0 { links } else { &empty };
+        TreeAt { step: c.steps_taken(), answer: LambdaTree::build(c.term(), c.last_redex(), links, node_budget) }
+    }
+}
+
 fn lambda_run_status(c: &LambdaCursor) -> RunStatus {
     match c.status() {
         None => RunStatus::Running,
@@ -450,13 +506,13 @@ fn lambda_run_status(c: &LambdaCursor) -> RunStatus {
 /// cursor afterwards, and a cursor whose own cap is untouched reports `Running` however many chunks
 /// have been spent against it. Folding the two together is the defect `RunStatus` was introduced to
 /// prevent one layer in.
-fn run_lambda_cursor(c: &mut LambdaCursor, budget: u64) -> RunStatus {
+fn run_lambda_cursor(leg: &mut LambdaLeg, budget: u64) -> RunStatus {
     for _ in 0..budget {
-        if c.next().is_none() {
+        if !leg.step() {
             break;
         }
     }
-    lambda_run_status(c)
+    lambda_run_status(&leg.cursor)
 }
 
 /// A `Value` already in hand — decoded or freshly evaluated — printed through the CAPPED printer.
@@ -571,7 +627,7 @@ impl Session {
         let (core, map) = SourceMap::build_from_program(&program, &*enc);
 
         let (lambda, initial_lambda) = match lambda::lower(&core) {
-            Ok(t) => (Ok(LambdaCursor::new(&t, lambda::MAX_REDUCTION_STEPS)), Some(t)),
+            Ok(t) => (Ok(LambdaLeg::new(&t, lambda::MAX_REDUCTION_STEPS)), Some(t)),
             Err(e) => (Err(e), None),
         };
 
@@ -633,9 +689,12 @@ impl Session {
 
     pub fn lambda_status(&self) -> LambdaStatus {
         match &self.lambda {
-            Ok(c) => {
-                LambdaStatus { available: true, reason: String::new(), node: None, run: Some(lambda_run_status(c)) }
-            }
+            Ok(leg) => LambdaStatus {
+                available: true,
+                reason: String::new(),
+                node: None,
+                run: Some(lambda_run_status(&leg.cursor)),
+            },
             Err(e) => {
                 let (reason, node) = match e {
                     LowerError::StatefulClosure { node } => {
@@ -657,8 +716,8 @@ impl Session {
     /// **`false` DOES NOT SAY WHICH; `lambda_status().run` DOES.** Deciding whether to offer a
     /// "continue" affordance means telling `Capped` from the other two, and this return value cannot.
     pub fn step_lambda(&mut self) -> Result<bool, SessionError> {
-        let c = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
-        Ok(c.next().is_some())
+        let leg = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
+        Ok(leg.step())
     }
 
     /// Advance up to `budget` β-steps, then report how the run stands.
@@ -683,8 +742,8 @@ impl Session {
     /// was handed, so there is no `Option` to unwrap and no unreachable arm to justify. Same values,
     /// one fewer state spellable — the shape argument the `tm` field's own doc makes.
     pub fn run_lambda(&mut self, budget: u64) -> Result<RunStatus, SessionError> {
-        let c = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
-        Ok(run_lambda_cursor(c, budget))
+        let leg = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
+        Ok(run_lambda_cursor(leg, budget))
     }
 
     /// `LambdaState::render(cursor, byte_budget, depth_cap)` and nothing else — PR 2 removed the map and redex
@@ -692,8 +751,8 @@ impl Session {
     /// `redex`/`redex_span`/`owner` fields 5c added to the returned `LambdaState` are all read off the cursor
     /// inside `render`, so nothing had to come back in here.
     pub fn lambda_state(&self, byte_budget: usize) -> Result<LambdaState, SessionError> {
-        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
-        Ok(LambdaState::render(c, byte_budget, MAX_PRINT_DEPTH))
+        let leg = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
+        Ok(LambdaState::render(&leg.cursor, byte_budget, MAX_PRINT_DEPTH))
     }
 
     /// The term as a flat tree, or `None` when it exceeds `node_budget` — `None` rather than a partial
@@ -702,15 +761,23 @@ impl Session {
     /// The payload is an ARENA (`TermTree`), not a tree of boxes, so neither serializing it across the
     /// boundary nor dropping it afterwards recurses. See `viewmodel::TermTree`.
     pub fn lambda_ast(&self, node_budget: usize) -> Result<Option<TermTree>, SessionError> {
-        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
-        Ok(LambdaState::ast(c, node_budget))
+        let leg = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
+        Ok(LambdaState::ast(&leg.cursor, node_budget))
+    }
+
+    /// The term at `step` as a `LambdaTree`, or the term's size when it exceeds `node_budget` (spec
+    /// §4). At step 0 it carries `node_to_lambda`'s links, so every construct the map places is
+    /// reachable; at a later step, the owner tags.
+    pub fn lambda_tree(&self, step: u64, node_budget: usize) -> Result<TreeAt, SessionError> {
+        let leg = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
+        Ok(leg.tree(step, node_budget, &self.map.node_to_lambda))
     }
 
     /// Extend a capped run's budget. Additive and saturating; clears `HitCap` only when the STEP CAP
     /// produced it, never the depth guard — extending a budget cannot make a term shallower.
     pub fn raise_lambda_cap(&mut self, extra: u64) -> Result<(), SessionError> {
-        let c = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
-        c.raise_cap(extra);
+        let leg = self.lambda.as_mut().map_err(|_| SessionError::LambdaAbsent)?;
+        leg.cursor.raise_cap(extra);
         Ok(())
     }
 
@@ -729,11 +796,11 @@ impl Session {
     /// `Some(v)` — the decode succeeded — and only `decoded_value`'s capped print refused, because
     /// `v`'s logical size exceeds `MAX_PRINT_NODES`. See `Decoded`'s own doc.
     pub fn lambda_value(&self) -> Result<Decoded, SessionError> {
-        let c = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
+        let leg = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
         if self.lambda_status().run != Some(RunStatus::Ended) {
             return Ok(Decoded::Unfinished);
         }
-        Ok(decoded_or_undecodable(lambda::decode_lambda_ty(c.term(), &self.ty)))
+        Ok(decoded_or_undecodable(lambda::decode_lambda_ty(leg.cursor.term(), &self.ty)))
     }
 
     /// Rebuild the λ cursor with a small cap, so a test has something to raise from. TEST-ONLY: there
@@ -742,9 +809,9 @@ impl Session {
     /// silently discard progress on any other.
     #[cfg(test)]
     fn cap_lambda_at(&mut self, cap: u64) {
-        if let Ok(c) = &mut self.lambda {
-            let fresh = LambdaCursor::new(c.term(), cap);
-            *c = fresh;
+        if let Ok(leg) = &mut self.lambda {
+            let fresh = LambdaLeg::new(leg.cursor.term(), cap);
+            *leg = fresh;
         }
     }
 
@@ -996,7 +1063,7 @@ pub struct Scratched<T> {
 /// linking affordances 5b and 5c built, and neither exists here — see §4.5 for why that has to be said
 /// out loud in the UI rather than merely being true.
 pub struct LambdaScratch {
-    lambda: LambdaCursor,
+    lambda: LambdaLeg,
 }
 
 /// Build a λ scratchpad from λ TEXT — not from source, and not from a `Session`.
@@ -1013,7 +1080,7 @@ pub struct LambdaScratch {
 /// by a diagnostic, so this cannot produce a silent empty answer.
 pub fn lambda_scratch(src: &str) -> Scratched<LambdaScratch> {
     let (term, diagnostics) = lambda::parse_lambda(src);
-    let scratch = term.map(|t| LambdaScratch { lambda: LambdaCursor::new(&t, lambda::MAX_REDUCTION_STEPS) });
+    let scratch = term.map(|t| LambdaScratch { lambda: LambdaLeg::new(&t, lambda::MAX_REDUCTION_STEPS) });
     Scratched { diagnostics, scratch }
 }
 
@@ -1094,7 +1161,12 @@ impl LambdaScratch {
     /// The struct is shared with `Session` rather than narrowed so one renderer can read either kind of
     /// session's λ leg through one shape; `run` is the field it actually switches on.
     pub fn lambda_status(&self) -> LambdaStatus {
-        LambdaStatus { available: true, reason: String::new(), node: None, run: Some(lambda_run_status(&self.lambda)) }
+        LambdaStatus {
+            available: true,
+            reason: String::new(),
+            node: None,
+            run: Some(lambda_run_status(&self.lambda.cursor)),
+        }
     }
 
     /// Advance one β-step. `false` once the run has ended — `lambda_status().run` says which.
@@ -1106,7 +1178,7 @@ impl LambdaScratch {
     /// type is unchanged either way (`Result<bool, JsValue>` and `bool` both cross as `boolean`), so
     /// nothing on the TypeScript side pays for this.
     pub fn step_lambda(&mut self) -> bool {
-        self.lambda.next().is_some()
+        self.lambda.step()
     }
 
     /// Advance up to `budget` β-steps, then report how the run stands. Chunked for the reason
@@ -1122,18 +1194,24 @@ impl LambdaScratch {
     /// (see `MAX_PRINT_DEPTH`), and a scratch prints through the same worker; a scratch that printed
     /// deeper would poison the module the same way.
     pub fn lambda_state(&self, byte_budget: usize) -> LambdaState {
-        LambdaState::render(&self.lambda, byte_budget, MAX_PRINT_DEPTH)
+        LambdaState::render(&self.lambda.cursor, byte_budget, MAX_PRINT_DEPTH)
     }
 
     /// The term as a flat arena, or `None` over `node_budget` — never a partial tree.
     pub fn lambda_ast(&self, node_budget: usize) -> Option<TermTree> {
-        LambdaState::ast(&self.lambda, node_budget)
+        LambdaState::ast(&self.lambda.cursor, node_budget)
+    }
+
+    /// The term at `step` as a `LambdaTree`. A scratch has no `SourceMap`, so its trees carry owner
+    /// tags only — and a scratch's term was parsed from text, so it has none of those either.
+    pub fn lambda_tree(&self, step: u64, node_budget: usize) -> TreeAt {
+        self.lambda.tree(step, node_budget, &BTreeMap::new())
     }
 
     /// Extend a capped run's budget. Additive and saturating; clears `HitCap` only when the STEP CAP
     /// produced it, never the depth guard.
     pub fn raise_lambda_cap(&mut self, extra: u64) {
-        self.lambda.raise_cap(extra);
+        self.lambda.cursor.raise_cap(extra);
     }
 
     /// Rebuild the cursor with a small cap, so a test has something to raise from. TEST-ONLY, for the
@@ -1142,7 +1220,7 @@ impl LambdaScratch {
     /// five million β-steps on a divergent term.
     #[cfg(test)]
     fn cap_lambda_at(&mut self, cap: u64) {
-        self.lambda = LambdaCursor::new(self.lambda.term(), cap);
+        self.lambda = LambdaLeg::new(self.lambda.cursor.term(), cap);
     }
 }
 
@@ -1850,6 +1928,129 @@ mod tests {
         assert!(s.lambda_ast(usize::MAX).expect("λ available").is_some());
     }
 
+    const FACT3: &str = "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)";
+
+    fn tree(at: &TreeAt) -> &LambdaTree {
+        match &at.answer {
+            TreeAnswer::Tree(t) => t,
+            TreeAnswer::Refused { nodes } => panic!("refused a {nodes}-node term"),
+        }
+    }
+
+    /// A past step is rebuilt, not approximated: stepping 600 then asking for 300 answers exactly the
+    /// tree a session stepped straight to 300 answers — across a checkpoint boundary, so by replay.
+    #[test]
+    fn a_tree_for_a_past_step_is_the_tree_that_step_had() {
+        let mut far = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        for _ in 0..600 {
+            assert!(far.step_lambda().expect("λ available"));
+        }
+        let mut near = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        for _ in 0..300 {
+            assert!(near.step_lambda().expect("λ available"));
+        }
+        let past = far.lambda_tree(300, usize::MAX).expect("λ available");
+        let live = near.lambda_tree(300, usize::MAX).expect("λ available");
+        assert_eq!((past.step, &past.answer), (300, &live.answer));
+    }
+
+    /// `run_lambda` advances through the same checkpointed step as `step_lambda`, so a run driven in
+    /// chunks rebuilds its past steps too.
+    #[test]
+    fn a_chunked_run_rebuilds_its_past_steps_too() {
+        let mut chunked = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        assert_eq!(chunked.run_lambda(700).expect("λ available"), RunStatus::Running);
+        let mut stepped = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        for _ in 0..513 {
+            assert!(stepped.step_lambda().expect("λ available"));
+        }
+        assert_eq!(
+            chunked.lambda_tree(513, usize::MAX).expect("λ available").answer,
+            stepped.lambda_tree(513, usize::MAX).expect("λ available").answer
+        );
+    }
+
+    /// Both ways a λ leg advances take checkpoints — `step_lambda` one step at a time and `run_lambda`
+    /// in chunks — which no answer-comparing test can see, because a missed checkpoint only costs replay.
+    #[test]
+    fn both_advance_paths_take_checkpoints() {
+        let mut s = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        assert_eq!(s.run_lambda(300).expect("λ available"), RunStatus::Running);
+        for _ in 0..300 {
+            assert!(s.step_lambda().expect("λ available"));
+        }
+        let leg = s.lambda.as_ref().expect("λ available");
+        assert_eq!(leg.marks.saved_steps(), vec![0, 256, 512]);
+    }
+
+    /// A step the run has not reached is clamped to where it has, and the answer says which step it is.
+    #[test]
+    fn a_tree_past_the_live_step_answers_the_live_step() {
+        let mut s = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        for _ in 0..10 {
+            assert!(s.step_lambda().expect("λ available"));
+        }
+        assert_eq!(
+            s.lambda_tree(20, usize::MAX).expect("λ available").step,
+            10,
+            "a step inside the run, not yet reached"
+        );
+        assert_eq!(s.lambda_tree(1_000_000, usize::MAX).expect("λ available").step, 10, "a step past the run's end");
+    }
+
+    /// Step 0 carries `node_to_lambda`'s links; every later step carries exactly its owner tags — the tree
+    /// built with no links at all. Checked at every step of the run, because a step-0 path stops resolving
+    /// once the root redex is contracted, and a sabotage that leaked the links past step 0 shows only
+    /// at a step where some path still lands.
+    #[test]
+    fn only_step_zero_carries_the_path_links() {
+        let mut s = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        let zero = s.lambda_tree(0, usize::MAX).expect("λ available");
+        let placed: std::collections::BTreeSet<_> = s.map.node_to_lambda.keys().copied().collect();
+        let linked: std::collections::BTreeSet<_> = tree(&zero).link.iter().copied().collect();
+        assert!(placed.iter().all(|id| linked.contains(id)), "every construct the map places links at step 0");
+        let mut k = 0;
+        while s.step_lambda().expect("λ available") {
+            k += 1;
+            let leg = s.lambda.as_ref().expect("λ available");
+            let tags_only = LambdaTree::build(leg.cursor.term(), leg.cursor.last_redex(), &BTreeMap::new(), usize::MAX);
+            assert_eq!(s.lambda_tree(k, usize::MAX).expect("λ available").answer, tags_only, "step {k}");
+        }
+    }
+
+    /// A cap raised after a checkpoint was taken does not strand it: the replay lifts the clone's cap.
+    #[test]
+    fn a_raised_cap_does_not_strand_a_checkpoint() {
+        let mut s = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        s.cap_lambda_at(3);
+        while s.step_lambda().expect("λ available") {}
+        s.raise_lambda_cap(1_000_000).expect("λ available");
+        for _ in 0..20 {
+            assert!(s.step_lambda().expect("λ available"));
+        }
+        assert_eq!(s.lambda_tree(15, usize::MAX).expect("λ available").step, 15);
+    }
+
+    #[test]
+    fn a_tree_over_budget_is_refused_with_its_size() {
+        let s = Session::compile(FACT3, EncodingKind::Unary).session.expect("compiles");
+        let at = s.lambda_tree(0, 1).expect("λ available");
+        assert!(matches!(at.answer, TreeAnswer::Refused { nodes } if nodes > 1), "{:?}", at.answer);
+        assert_eq!(
+            Session::compile(LAMBDA_DECLINES, EncodingKind::Unary).session.expect("TM").lambda_tree(0, 1).err(),
+            Some(SessionError::LambdaAbsent)
+        );
+    }
+
+    #[test]
+    fn a_scratch_tree_clamps_and_carries_no_links() {
+        let mut sc = lambda_scratch("(\\x. x x) ((\\y. y) (\\z. z))").scratch.expect("parses");
+        assert!(sc.step_lambda());
+        let at = sc.lambda_tree(99, usize::MAX);
+        assert_eq!(at.step, 1);
+        assert!(tree(&at).link.iter().all(|&l| l == redextape_core::viewmodel::tree::NO_LINK));
+    }
+
     // --- the λ scratchpad ------------------------------------------------------------------------
 
     #[test]
````

- [ ] **Step 2: Run the tests.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo test -p redextape-wasm --lib`
Expected: `93 passed` (85 existing, 8 new).

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy --workspace --all-targets -- -D warnings` → no warnings.

- [ ] **Step 3: Sabotage, one at a time, reverting after each:**

| Sabotage | Fails |
|---|---|
| `session.rs`, `LambdaLeg::tree`: `let links = if c.steps_taken() == 0 { links } else { &empty };` → `… if c.steps_taken() < u64::MAX …` | `only_step_zero_carries_the_path_links` |
| `trace.rs`, `LambdaCheckpoints::at`: delete `c.raise_cap(u64::MAX);` | `a_raised_cap_does_not_strand_a_checkpoint` |
| `session.rs`, `LambdaLeg::step`: `self.marks.observe(&self.cursor);` → `let _ = &self.marks;` | `both_advance_paths_take_checkpoints` |
| `session.rs`, `LambdaLeg::tree`: `let wanted = step.min(live);` → `let wanted = step;` | `a_tree_past_the_live_step_answers_the_live_step` |

The first and last were first written weaker and did NOT fire: links were compared at step 0 and at one later step, and the clamp was checked only for a step past the run's end. Each now checks what its sabotage breaks — every step of the run, and a step inside the run that has not been reached yet.

- [ ] **Step 4: Commit.**

```bash
git add crates/redextape-wasm/src/session.rs crates/redextape-wasm/src/lib.rs
git commit -m "wasm: lambdaTree(step, nodeBudget) answers any recorded step's tree as typed arrays, rebuilt from checkpoints the λ leg takes on both advance paths"
```

---

### Task 3: Retire `lambdaAst` and `TermTree`

`lambdaTree` supersedes `lambdaAst` (spec §4.4). Nothing in `web/src` calls it; its callers are tests and one probe section, and each is carried over or retired with a recorded reason:

- **`tests/browser.rs`:** the `depth` helper reads the pre-order columns in one forward pass. `compile_step_and_read_both_legs` asserts the wire shape (one typed array per column, `null` marks, the root first). The absent-leg test, the depth tripwire (renamed `the_tree_tolerates_the_deepest_term_a_reduction_reaches`) and the λ-scratch test all move to `lambdaTree`.
- **`session.rs`:** `the_lambda_ast_refuses_…` is deleted, because Task 2's `a_tree_over_budget_is_refused_with_its_size` covers it. The scratch's budget test and the declined-leg assertion move to `lambda_tree`.
- **`viewmodel.rs`:** `TermTree`, `TermNode`, `LambdaState::ast`, `enum Work`, `to_tree`, `emit` and their unit tests go, and the three docs that named them are rewritten.
- **`viewmodel_contract.rs`:** the three arena tests and the `TermTree` half of the JSON round trip go. `tests/lambda_tree.rs` holds shape, count and budget at every step of seven programs, which is strictly more than they held for one. `LambdaTree` crosses as typed arrays, not serde, so it has no JSON round trip to keep.
- **`frame_cost_probe.rs`:** section F is retired, with the reason in the module doc.
- **`ts_bindings.rs`:** one doc sentence that cited `TermNode`'s doc as a live example is cut.

**Files:** Modify `crates/redextape-core/{src/viewmodel.rs, tests/viewmodel_contract.rs, tests/ts_bindings.rs, examples/frame_cost_probe.rs}` and `crates/redextape-wasm/{src/session.rs, src/lib.rs, tests/browser.rs}`.

**Interfaces:** Consumes Task 2's `lambdaTree`. Produces nothing new; removes `TermTree`, `TermNode`, `LambdaState::ast`, `lambdaAst`.

- [ ] **Step 1: Apply the patch.**

````diff
diff --git a/crates/redextape-core/examples/frame_cost_probe.rs b/crates/redextape-core/examples/frame_cost_probe.rs
index b383d64..6d9e7f2 100644
--- a/crates/redextape-core/examples/frame_cost_probe.rs
+++ b/crates/redextape-core/examples/frame_cost_probe.rs
@@ -22,6 +22,13 @@
 //! `--features serde` is optional. Without it the byte columns read `-`; the timing columns, which are
 //! what §11.1 is actually about, do not need it.
 //!
+//! # SECTION F IS RETIRED (Plan 7 part 4a)
+//!
+//! It priced a per-step `TermTree` recorder — one tree per history frame, the design this probe's
+//! measurements declined — and `TermTree` is gone with `lambdaAst`. Part 4a serves one tree for the
+//! displayed step, rebuilt from checkpoints (`redextape-wasm`'s `LambdaLeg`); its cost is measured by
+//! `web/tests/browser/lambda-tree-cost.test.ts`.
+//!
 //! # THE QUESTION
 //!
 //! PR 3c's worker drives λ with `runLambda(50_000)` — **one wasm call per 50,000 β-steps**. Recording
@@ -80,14 +87,6 @@ const BUDGET_SWEEP: &[usize] = &[512, 4_096, 16_384, 65_536];
 /// Tape window radii to sweep. The TM pane follows the head; the question is what a row costs.
 const RADIUS_SWEEP: &[usize] = &[10, 20, 40, 80];
 
-/// Candidate `LAMBDA_TREE_NODES` values, for §8's one remaining unmeasured constant.
-///
-/// The range is chosen from the one figure the design already has: this language lowers naturals to
-/// Church numerals, so `40` alone is ~83 nodes and `200` is ~403 (§4.3) — before anything else in the
-/// program. 1,024 is therefore near the floor of "can draw the app's own sample at all", and 524,288 is
-/// far past what a reader could look at, included so the refusal column has somewhere to bottom out.
-const NODE_BUDGET_SWEEP: &[usize] = &[1_024, 8_192, 65_536, 524_288];
-
 /// Per-program recording ceiling. NOT `MAX_REDUCTION_STEPS` (5,000,000): this probe measures a
 /// per-step cost, and a few thousand steps establishes it. A program that hits this is reported as
 /// hitting it, never silently truncated.
@@ -145,9 +144,9 @@ fn programs() -> Vec<(String, String)> {
     // falsified the logical-size guard. These two are far below that and still the largest terms here.
     v.push(("list20".to_string(), list20));
     v.push(("list60".to_string(), list60));
-    // Added for section F, and it defeats a DIFFERENT bound from the three above. Those attack frame
-    // SIZE with a large term; a per-frame tree history is bounded by size x STEP COUNT, and every
-    // program above runs in the hundreds of β-steps at most. `while4` is the same shape at n=4.
+    // Added for the per-frame tree section this probe no longer has (see the module doc's note on section
+    // F), and kept because it defeats a DIFFERENT bound from the three above: those attack frame SIZE with a
+    // large term, and this is the corpus's longest run in β-steps. `while4` is the same shape at n=4.
     v.push((
         "while40".to_string(),
         "let mut n = 40; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc".to_string(),
@@ -323,98 +322,6 @@ fn record_tm(c: &mut TmCursor<Rc<Machine>>, map: &SourceMap, radius: usize) -> L
     Legs { steps, step_total, render_total, max_bytes, sum_bytes, max_json, sum_json, truncated_at: None, stopped }
 }
 
-/// One λ leg's per-step `lambdaAst` measurement.
-///
-/// Separate from [`Legs`] because the question is different. `Legs` asks what a frame costs; this asks
-/// whether a frame can be BUILT at all, so `refused` is a first-class column rather than an error path.
-struct AstLegs {
-    steps: u64,
-    ast_total: Duration,
-    /// Steps where `ast` returned `None` — the node budget refusing, or the arena's `u32` index space
-    /// overflowing first. `LambdaState::ast`'s own doc says a consumer cannot tell the two apart, so
-    /// neither does this column.
-    refused: u64,
-    first_refused_at: Option<u64>,
-    max_nodes: usize,
-    sum_nodes: usize,
-    max_json: Option<usize>,
-    sum_json: Option<usize>,
-    stopped: &'static str,
-}
-
-/// Step-and-build-a-tree, exactly as a per-frame tree recorder would: `next()`, then `ast()` on the
-/// state that step produced.
-///
-/// **TREES ARE DROPPED EACH ITERATION AND NEVER ACCUMULATED.** Retaining one per step is the shape this
-/// file's module doc records as having taken 60 GiB, and the question here is a PER-STEP cost, which a
-/// proxy answers without paying it. What a whole history would cost is arithmetic on `sum_json`, and
-/// arithmetic does not need to be allocated to be believed.
-fn record_ast(c: &mut LambdaCursor, node_budget: usize) -> AstLegs {
-    let mut ast_total = Duration::ZERO;
-    let (mut max_nodes, mut sum_nodes) = (0usize, 0usize);
-    let (mut max_json, mut sum_json) = (Some(0usize), Some(0usize));
-    let (mut refused, mut first_refused_at) = (0u64, None);
-    let mut steps = 0u64;
-    let stopped = loop {
-        if c.next().is_none() {
-            break "ended";
-        }
-        steps += 1;
-
-        let t = Instant::now();
-        let tree = LambdaState::ast(c, node_budget);
-        ast_total += t.elapsed();
-
-        match tree {
-            None => {
-                refused += 1;
-                if first_refused_at.is_none() {
-                    first_refused_at = Some(steps);
-                }
-            }
-            Some(tree) => {
-                max_nodes = max_nodes.max(tree.nodes.len());
-                sum_nodes += tree.nodes.len();
-                if let (Some(m), Some(s), Some(j)) = (max_json.as_mut(), sum_json.as_mut(), json_len(&tree)) {
-                    *m = (*m).max(j);
-                    *s += j;
-                } else {
-                    max_json = None;
-                    sum_json = None;
-                }
-            }
-        }
-
-        if steps >= STEP_LIMIT {
-            break "step-limit";
-        }
-    };
-    AstLegs { steps, ast_total, refused, first_refused_at, max_nodes, sum_nodes, max_json, sum_json, stopped }
-}
-
-/// `hist_MB` is the decision column: what recording ONE TREE PER FRAME would cost for this program at
-/// this budget, over the steps actually run. Compare it against §3.2's ~10 KB text frame.
-fn ast_report(legs: &AstLegs) -> String {
-    let n = legs.steps.max(1) as f64;
-    let built = legs.steps.saturating_sub(legs.refused).max(1) as usize;
-    format!(
-        "{:>7} {:>10.2} {:>9} {:>9.1} {:>10} {:>10} {:>9} {:>9} {:>9.1}  {}",
-        legs.steps,
-        us(legs.ast_total) / n,
-        legs.refused,
-        100.0 * legs.refused as f64 / n,
-        legs.max_nodes,
-        legs.sum_nodes / built,
-        opt_b(legs.max_json),
-        opt_b(legs.sum_json.map(|s| s / built)),
-        legs.sum_json.map_or(f64::NAN, |s| s as f64 / 1e6),
-        legs.stopped,
-    )
-}
-
-const AST_HDR: &str =
-    "  steps    ast_us/  refused  refused%  max_nodes  avg_nodes  max_json  avg_json   hist_MB  stopped";
-
 fn report(legs: &Legs) -> String {
     let n = legs.steps.max(1) as f64;
     let ratio = if legs.step_total.is_zero() {
@@ -543,29 +450,6 @@ fn section_radius(progs: &[(String, String)]) {
     }
 }
 
-fn section_ast(progs: &[(String, String)]) {
-    head("F — lambdaAst: LAMBDA_TREE_NODES, §8's one remaining unmeasured constant (5a-ii)");
-    line("  `refused` is the column that decides the feature, not `ast_us`. A tree that refuses is a");
-    line("  pane saying \"too large to draw\" (§4.3), so refused% at a budget is the fraction of steps");
-    line("  where the structural view has nothing to show.");
-    line("  `hist_MB` is what recording one tree per frame would cost over the steps run — compare it");
-    line("  against §3.2's ~10 KB text frame and against HISTORY_BYTES' 32 MB per leg.");
-    line("  avg_nodes and avg_json average over the steps that BUILT a tree, not over all steps.");
-    line("");
-    line(&format!("{:<12}{:>9}{AST_HDR}", "program", "budget"));
-    for (name, src) in progs {
-        for &b in NODE_BUDGET_SWEEP {
-            let Some(mut c) = compile(src, EncodingKind::Unary) else { continue };
-            let Some(cur) = c.lambda.as_mut() else { continue };
-            let legs = record_ast(cur, b);
-            line(&format!("{:<12}{:>9}{}", name, b, ast_report(&legs)));
-            if let Some(at) = legs.first_refused_at {
-                line(&format!("{:<12}{:>9}   first refused at step {at}", "", ""));
-            }
-        }
-    }
-}
-
 fn main() {
     let args: Vec<String> = std::env::args().skip(1).collect();
     let want = |name: &str| args.is_empty() || args.iter().any(|a| a == name);
@@ -595,7 +479,4 @@ fn main() {
     if want("e") {
         section_radius(&progs);
     }
-    if want("f") {
-        section_ast(&progs);
-    }
 }
diff --git a/crates/redextape-core/src/viewmodel.rs b/crates/redextape-core/src/viewmodel.rs
index b22b46c..33c187b 100644
--- a/crates/redextape-core/src/viewmodel.rs
+++ b/crates/redextape-core/src/viewmodel.rs
@@ -16,7 +16,7 @@ use std::collections::BTreeMap;
 
 use crate::analysis::TokenClass;
 use crate::core::NodeId;
-use crate::lambda::{Cut, LambdaTerm, Node, Owner, Path, print_lambda_linked};
+use crate::lambda::{Cut, LambdaTerm, Owner, Path, print_lambda_linked};
 use crate::sourcemap::SourceMap;
 use crate::span::Span;
 use crate::tm::machine::{Machine, Move, StateId, Symbol};
@@ -92,8 +92,8 @@ pub struct LambdaState {
     /// to widen `Step` for exactly that reason ("a field with no reader"); the same rule applies here.
     ///
     /// **IT STAYS ON THE RUST TYPE RATHER THAN BEING DELETED**, because `redex_span` cannot replace it
-    /// for a STRUCTURAL consumer: a byte span is a coordinate into `text`, and `LambdaState::tree`'s
-    /// `TermTree` has no text to index into. The planned tree view needs the path itself. Skipping is
+    /// for a STRUCTURAL consumer: a byte span is a coordinate into `text`, and `LambdaTree` — which the tree
+    /// view reads — marks the contractum by node index, resolving this path Rust-side (`viewmodel::tree`). Skipping is
     /// what makes that a wire decision that can be reversed by deleting one attribute, rather than a
     /// deletion that has to be re-derived. `Option<Path>` is `Default`, so the `Deserialize` half of the
     /// derive is well-formed even though nothing in this tree deserializes a `LambdaState`.
@@ -244,54 +244,6 @@ pub struct TmState {
     pub rule: Option<usize>,
 }
 
-/// A λ term as a flat arena, so that NOTHING DERIVED ON IT RECURSES.
-///
-/// The obvious shape — `Abs(String, Box<TermNode>)` — gives the type two recursive paths, and both
-/// are linear in DEPTH rather than node count: serde's derived `Serialize` descends one frame per
-/// level, and the compiler's `drop_in_place` walks the `Box` chain the same way. A wasm trap does not
-/// unwind, so neither returns an error — both poison the module, and the `Drop` path fires where no
-/// caller can see it. `LambdaTerm`, the type this is built FROM, carries a hand-written iterative
-/// destructor (`term.rs`'s `impl Drop for LambdaTerm`) for exactly that hazard; indices are how this
-/// type avoids needing one.
-///
-/// `nodes` is in POST-ORDER — every child precedes its parent — because the walk that builds it
-/// completes children before parents. `root` is therefore always `nodes.len() - 1`, and is stored
-/// anyway so a consumer never encodes that convention.
-///
-/// `nodes` is never empty: a term has at least one node, and a zero budget refuses at the first one,
-/// so `root` always indexes a real element.
-///
-/// THAT POINTER READ `term.rs` line 482 UNTIL THIS COMMIT, AND IT HAD DRIFTED. It was
-/// `impl Drop for LambdaTerm`'s own opening line when the arena rewrite (#15) wrote it, and three
-/// commits moved it 166 lines down between them — static click-linking (#23) by 5, the dual-focus
-/// slice (#26) by 95, and `clippy::pedantic` (#31) by 66. This conversion found 482, as this file
-/// then stood, inside a comment in `subst`'s body, arguing why the `maxfree` check has to come
-/// BEFORE the `Abs` arm builds its shifted argument — a different function, and an argument about
-/// substitution COST rather than about teardown depth, so nothing near where it landed could be
-/// mistaken for the destructor. THIS COMMIT'S OWN ADDED LINES ELSEWHERE IN `term.rs` HAVE SINCE
-/// MOVED 482 AGAIN, off that landing too — the tightest demonstration available of why this note
-/// retires the coordinate rather than trusting it: even the sentence recording the drift did not
-/// outlive its own commit.
-#[derive(Clone, Debug, PartialEq, Eq)]
-#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
-pub struct TermTree {
-    pub nodes: Vec<TermNode>,
-    pub root: u32,
-}
-
-/// One node of a [`TermTree`]. Children are indices into that tree's `nodes`, never owned subtrees.
-///
-/// `u32` rather than `usize` is a BOUNDARY decision, not a memory one: wasm-bindgen maps `u64` to a
-/// JavaScript `bigint`, and `Var`'s de Bruijn index is already `u32`, so the payload stays uniformly
-/// numeric. On wasm32 `usize` is 32 bits, which makes the two exactly as wide as `node_budget` there.
-#[derive(Clone, Debug, PartialEq, Eq)]
-#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
-pub enum TermNode {
-    Var(u32),
-    Abs(String, u32),
-    App(u32, u32),
-}
-
 impl LambdaState {
     /// Render the term the cursor currently holds, bounded by `byte_budget` and `depth_cap`.
     ///
@@ -337,106 +289,6 @@ impl LambdaState {
             owner: c.last_owner(),
         }
     }
-
-    /// The term as a flat tree, or `None` if it exceeds `node_budget`. A second, independent cause
-    /// also yields `None`: the arena's own `u32` index space overflowing before the budget would have
-    /// refused first (see `emit`'s doc for why that is a refusal rather than a panic) -- a consumer
-    /// reading only this entry point could not otherwise tell the two apart.
-    ///
-    /// `None` RATHER THAN A PARTIAL TREE. Truncated text is visibly truncated; a truncated AST is a lie
-    /// about the term's shape, and a partial arena would be the same lie with an index on it. The count
-    /// happens during the walk for the same reason the printer's budget does — building the tree and
-    /// then measuring it defeats the purpose.
-    #[must_use]
-    pub fn ast(c: &LambdaCursor, node_budget: usize) -> Option<TermTree> {
-        let mut budget = node_budget;
-        to_tree(c.term(), &mut budget)
-    }
-}
-
-/// One `to_tree` work item: either a subterm still to visit, or a marker recording how many completed
-/// children to pop off `results` and how to combine them, once every item pushed after it is done.
-enum Work<'a> {
-    Enter(&'a LambdaTerm),
-    Abs(String),
-    App,
-}
-
-/// `LambdaState::ast`'s walk. ITERATIVE, OVER AN EXPLICIT STACK, deliberately: `LambdaTerm` is only
-/// guarded against unbounded depth from the SECOND step onward (`LambdaCursor::next`'s depth check),
-/// not at construction, so the very first term a cursor holds can already be deeper than a native
-/// recursive walk survives — the same hazard `term.rs`'s own `Drop` and `logical_sizes` are iterative
-/// to avoid.
-///
-/// IT BUILDS AN ARENA RATHER THAN A TREE OF `Box`ES, and that is what extends the same protection to
-/// everything that happens to the RESULT. This walk was always safe; the derived `Serialize` and
-/// derived `Drop` on the value it returned were not. See [`TermTree`].
-///
-/// THE BUDGET IS CHECKED BEFORE EACH NODE IS COUNTED AND BUILT, so a term that would exceed it returns
-/// `None` at the node that overshoots rather than after the whole tree is built and measured — an
-/// early `return` here abandons `work`, `nodes` and `results` without finishing them, which is fine
-/// because nothing downstream reads any of them once this function has returned.
-///
-/// A SHARED SUBTERM COSTS THE BUDGET ONCE PER OCCURRENCE, not once per allocation: the arena is
-/// unshared, so a DAG node reached through two parents becomes two distinct entries, and both must be
-/// paid for — exactly as `print_lambda_capped` pays per occurrence in the text it writes, not per
-/// underlying `Rc`.
-fn to_tree<'a>(t: &'a LambdaTerm, budget: &mut usize) -> Option<TermTree> {
-    let mut work: Vec<Work<'a>> = Vec::new();
-    let mut nodes: Vec<TermNode> = Vec::new();
-    let mut results: Vec<u32> = Vec::new();
-    work.push(Work::Enter(t));
-    while let Some(item) = work.pop() {
-        match item {
-            Work::Enter(term) => {
-                if *budget == 0 {
-                    return None;
-                }
-                *budget -= 1;
-                match term.node() {
-                    Node::Var(i) => emit(&mut nodes, &mut results, TermNode::Var(*i))?,
-                    Node::Abs(name, body) => {
-                        work.push(Work::Abs(name.to_string()));
-                        work.push(Work::Enter(body));
-                    }
-                    Node::App(f, a, _) => {
-                        work.push(Work::App);
-                        work.push(Work::Enter(a));
-                        work.push(Work::Enter(f));
-                    }
-                }
-            }
-            // `f` was pushed after `a` (see the `App` arm above), so it is popped from `work` — and
-            // therefore built — first. Its index lands in `results` first too, with `a`'s pushed on
-            // top once `a` finishes: `results` is itself a stack, so `a` comes off it FIRST and `f`
-            // comes off LAST.
-            Work::App => {
-                let a = results.pop()?;
-                let f = results.pop()?;
-                emit(&mut nodes, &mut results, TermNode::App(f, a))?;
-            }
-            Work::Abs(name) => {
-                let body = results.pop()?;
-                emit(&mut nodes, &mut results, TermNode::Abs(name, body))?;
-            }
-        }
-    }
-    let root = results.pop()?;
-    Some(TermTree { nodes, root })
-}
-
-/// Append `n` to the arena and push the index it landed at onto `results`.
-///
-/// `None` WHEN THE INDEX WOULD NOT FIT `u32`, refusing through the channel that already means "no
-/// tree" rather than panicking — a panic under wasm aborts the module, and `unreachable!` is ruled
-/// out for the same reason. 2^32 entries is on the order of 100 GB at `size_of::<TermNode>()`, so
-/// this cannot occur; it is written as a branch rather than an assumption because a branch that
-/// claims to be total and is not is the defect this project has corrected twice.
-fn emit(nodes: &mut Vec<TermNode>, results: &mut Vec<u32>, n: TermNode) -> Option<()> {
-    let idx = u32::try_from(nodes.len()).ok()?;
-    nodes.push(n);
-    results.push(idx);
-    Some(())
 }
 
 fn move_text(m: Move) -> &'static str {
@@ -605,7 +457,7 @@ pub struct LinkIndex {
     /// negative value otherwise, and either way becoming indistinguishable from (or worse, a wrong
     /// index next to) a state that genuinely has no owner. `build` refuses that cast with
     /// `i32::try_from` and empties the whole vec on failure — the same "no lie, just nothing" refusal
-    /// `emit` (above) makes for `TermTree`'s arena index.
+    /// `LambdaTree::build` makes when its arena index would not fit `u32`.
     ///
     /// **THAT REFUSAL IS NOW PROVABLY UNREACHABLE, AND IS KEPT ANYWAY.** It used to cite
     /// `core::NodeGen::fresh` as a bare counter that bounded nothing; `core::MAX_NODE_ID` bounds it
@@ -676,43 +528,6 @@ impl LinkIndex {
 mod tests {
     use super::*;
 
-    #[test]
-    fn to_tree_matches_the_term_shape_within_budget() {
-        // `App(Var(0), Var(1))` is the minimal discriminator: a transposed pop order builds
-        // `App(Var(1), Var(0))` instead, a difference `is_some()` cannot see. Built directly with the
-        // `lambda::term` constructors, not lowered from source, so the expected shape is unambiguous.
-        //
-        // THE ARENA IS ASSERTED IN FULL, INDICES AND ALL, not just its root. Post-order is what makes
-        // `root == nodes.len() - 1` true, and an implementation that emitted the right nodes in the
-        // wrong order would still satisfy a root-only assertion.
-        use crate::lambda::term::{app, var};
-
-        let flat = app(var(0), var(1));
-        let flat_ast = LambdaState::ast(&LambdaCursor::new(&flat, 1_000), usize::MAX);
-        assert_eq!(
-            flat_ast,
-            Some(TermTree { nodes: vec![TermNode::Var(0), TermNode::Var(1), TermNode::App(0, 1)], root: 2 })
-        );
-
-        // Nested one level, so a fix that only gets the outermost `App` right cannot pass: the
-        // function position is itself an `App`, and its two children must land in order too.
-        let nested = app(app(var(0), var(1)), var(2));
-        let nested_ast = LambdaState::ast(&LambdaCursor::new(&nested, 1_000), usize::MAX);
-        assert_eq!(
-            nested_ast,
-            Some(TermTree {
-                nodes: vec![
-                    TermNode::Var(0),
-                    TermNode::Var(1),
-                    TermNode::App(0, 1),
-                    TermNode::Var(2),
-                    TermNode::App(2, 3),
-                ],
-                root: 4,
-            })
-        );
-    }
-
     #[test]
     fn move_text_matches_the_text_forms_own_vocabulary() {
         assert_eq!(move_text(Move::L), "L");
diff --git a/crates/redextape-core/tests/ts_bindings.rs b/crates/redextape-core/tests/ts_bindings.rs
index b48fa75..855a3ab 100644
--- a/crates/redextape-core/tests/ts_bindings.rs
+++ b/crates/redextape-core/tests/ts_bindings.rs
@@ -60,9 +60,8 @@ fn generated() -> Vec<(&'static str, String)> {
 /// would tell the next reader not to check.
 ///
 /// THE SCAN SKIPS JSDOC. `export_to_string` reproduces Rust doc comments verbatim, so a doc comment
-/// that merely discusses `bigint` in prose — as `viewmodel::TermNode`'s already does, for a type this
-/// gate does not cover — would otherwise fail this test for a documentation reason having nothing to
-/// do with the generated type. `without_doc_comments` removes exactly the JSDoc ts-rs emits before the
+/// that merely discusses `bigint` in prose would otherwise fail this test for a documentation reason
+/// having nothing to do with the generated type. `without_doc_comments` removes exactly the JSDoc ts-rs emits before the
 /// scan runs.
 #[test]
 fn no_generated_type_carries_bigint() {
diff --git a/crates/redextape-core/tests/viewmodel_contract.rs b/crates/redextape-core/tests/viewmodel_contract.rs
index 0b89f4d..a3684f6 100644
--- a/crates/redextape-core/tests/viewmodel_contract.rs
+++ b/crates/redextape-core/tests/viewmodel_contract.rs
@@ -10,7 +10,7 @@ use std::sync::atomic::{AtomicUsize, Ordering};
 
 use redextape_core::lambda::reduce::MAX_TERM_DEPTH;
 use redextape_core::sourcemap::SourceMap;
-use redextape_core::viewmodel::{LambdaState, LinkIndex, TermNode, TermTree, TmProgram, TmState};
+use redextape_core::viewmodel::{LambdaState, LinkIndex, TmProgram, TmState};
 
 /// Counts bytes requested through the global allocator, so a test can measure what a call actually
 /// allocates instead of timing it. Scoped to this one integration test binary: each file under
@@ -357,142 +357,6 @@ fn an_absent_map_zeroes_the_source_node_and_leaves_every_other_field_alone() {
     );
 }
 
-#[test]
-fn the_ast_returns_none_over_budget_rather_than_a_partial_tree() {
-    let (term, map) = lambda_fixture(&big_list_program());
-    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
-    let _ = &map;
-    assert!(LambdaState::ast(&cursor, 4).is_none(), "a 4-node budget must refuse, not truncate");
-    assert!(LambdaState::ast(&cursor, usize::MAX).is_some(), "an unreachable budget must succeed");
-}
-
-/// The arena denotes the same tree the term does, on a real lowered program rather than on a term
-/// built by hand. `big_list_program()` is 200 elements — first-order, no recursion, and a logical size
-/// the existing budget test above already drives with `usize::MAX`.
-#[test]
-fn the_arena_denotes_the_same_tree_the_term_does() {
-    let (term, _map) = lambda_fixture(&big_list_program());
-    let cursor = redextape_core::trace::LambdaCursor::new(&term, 1_000);
-    let tree = LambdaState::ast(&cursor, usize::MAX).expect("an unreachable budget must succeed");
-
-    if let Err(msg) = arena_matches_term(&tree, &term) {
-        panic!("the arena and the term disagree on shape: {msg}");
-    }
-    assert_eq!(
-        tree.root as usize,
-        tree.nodes.len() - 1,
-        "the walk builds post-order, so the root is the last node emitted"
-    );
-
-    // POST-ORDER IS A PUBLISHED CONTRACT (`viewmodel.rs`'s `TermTree` doc: "every child precedes its
-    // parent"), and nothing above pins it. An arena that emitted a FORWARD index into a structurally
-    // identical node would still pass the lockstep walk above, the root-is-last assertion above, and
-    // the `logical_size` cross-check below -- none of those look at whether a child's index is
-    // actually less than its own parent's, only at what the child eventually resolves to. Checked
-    // here, iteratively, over every node.
-    for (i, node) in tree.nodes.iter().enumerate() {
-        match node {
-            TermNode::Var(_) => {}
-            TermNode::Abs(_, body) => {
-                assert!(
-                    (*body as usize) < i,
-                    "node {i} is Abs(.., {body}): child {body} does not precede its parent at {i}"
-                );
-            }
-            TermNode::App(f, a) => {
-                assert!(
-                    (*f as usize) < i,
-                    "node {i} is App({f}, {a}): fn-child {f} does not precede its parent at {i}"
-                );
-                assert!(
-                    (*a as usize) < i,
-                    "node {i} is App({f}, {a}): arg-child {a} does not precede its parent at {i}"
-                );
-            }
-        }
-    }
-
-    // `arena_matches_term` compares content per occurrence, so an arena that DEDUPLICATED a shared
-    // subterm -- pointing two parents at one index -- would still pass every comparison above, since
-    // both occurrences are structurally identical by construction. Nothing above checks index
-    // uniqueness or the total count. `logical_size` is an independently written occurrence count for
-    // the same term (walks BOTH children of every `App`, one unit per occurrence, never per
-    // allocation -- see its doc in `crates/redextape-core/src/lambda/term.rs`), so cross-checking the
-    // arena's length against it catches a dedup regression that the walk above cannot.
-    assert_eq!(
-        tree.nodes.len() as u64,
-        redextape_core::lambda::term::logical_size(&term),
-        "arena node count must equal the term's logical (denoted) size -- a mismatch means the arena \
-         is not costing one entry per occurrence"
-    );
-}
-
-/// Walk the arena and the term in lockstep, ITERATIVELY, reporting exactly where they diverge.
-///
-/// A RECURSIVE REBUILD WOULD REINTRODUCE THE EXACT HAZARD THE ARENA REMOVES, inside the test that
-/// certifies its removal — and it would pass on every shallow program while failing on the one shape
-/// that matters. This is the obvious way to write this test and it is the wrong one.
-///
-/// Subterms are pushed as BORROWS of the root term, which outlives the walk, so a shared DAG node is
-/// visited once per occurrence — matching the arena, which holds one entry per occurrence.
-///
-/// Returns `Err` naming the arena index and both sides' shapes at the FIRST point of disagreement,
-/// rather than `bool`: a static "disagree on shape" message gives a maintainer nothing to act on when
-/// this fires on a real regression -- for instance the `App` pop-order transposition this file's own
-/// `to_tree` doc warns about, in `crates/redextape-core/src/viewmodel.rs`.
-fn arena_matches_term(tree: &TermTree, term: &redextape_core::lambda::term::LambdaTerm) -> Result<(), String> {
-    use redextape_core::lambda::term::Node;
-
-    // A one-line, non-recursive tag for a node on either side: the variant and any scalar payload,
-    // never the subterms -- a mismatch on a 200-node fixture must not try to print the other 199.
-    fn describe_term_node(n: &Node) -> String {
-        match n {
-            Node::Var(i) => format!("Var({i})"),
-            Node::Abs(name, _) => format!("Abs({name:?}, ..)"),
-            Node::App(_, _, _) => "App(.., ..)".to_string(),
-        }
-    }
-    fn describe_arena_node(n: &TermNode) -> String {
-        match n {
-            TermNode::Var(i) => format!("Var({i})"),
-            TermNode::Abs(name, _) => format!("Abs({name:?}, ..)"),
-            TermNode::App(_, _) => "App(.., ..)".to_string(),
-        }
-    }
-
-    let mut work: Vec<(u32, &redextape_core::lambda::term::LambdaTerm)> = vec![(tree.root, term)];
-    while let Some((idx, t)) = work.pop() {
-        let Some(node) = tree.nodes.get(idx as usize) else {
-            return Err(format!("arena index {idx} is out of range (the arena has {} nodes)", tree.nodes.len()));
-        };
-        match (node, t.node()) {
-            (TermNode::Var(i), Node::Var(j)) => {
-                if i != j {
-                    return Err(format!("node {idx}: arena has Var({i}), term has Var({j})"));
-                }
-            }
-            (TermNode::Abs(name, body), Node::Abs(n2, b2)) => {
-                if **name != **n2 {
-                    return Err(format!("node {idx}: arena has Abs({name:?}, ..), term has Abs({n2:?}, ..)"));
-                }
-                work.push((*body, b2));
-            }
-            (TermNode::App(f, a), Node::App(f2, a2, _)) => {
-                work.push((*f, f2));
-                work.push((*a, a2));
-            }
-            (arena_node, term_node) => {
-                return Err(format!(
-                    "node {idx}: arena has {}, term has {}",
-                    describe_arena_node(arena_node),
-                    describe_term_node(term_node)
-                ));
-            }
-        }
-    }
-    Ok(())
-}
-
 /// §10.4's stated outcome: the view models serialize and round-trip. Feature-gated, because serde is
 /// optional and default-off — this test does not exist in a default build.
 #[cfg(feature = "serde")]
@@ -504,13 +368,6 @@ fn every_view_model_round_trips_through_json() {
     let back: LambdaState = serde_json::from_str(&serde_json::to_string(&ls).expect("serialize")).expect("deserialize");
     assert_eq!(ls, back);
 
-    // `TermTree` was not covered here before the arena, and the omission mattered: `serde_json`'s
-    // DESERIALIZER recurses per level too, so a `Box`-shaped `TermNode` had two recursive paths on the
-    // way out and a third on the way back in.
-    let tree = LambdaState::ast(&cursor, usize::MAX).expect("the fixture fits an unreachable budget");
-    let back: TermTree = serde_json::from_str(&serde_json::to_string(&tree).expect("serialize")).expect("deserialize");
-    assert_eq!(tree, back);
-
     let (machine, init) = tm_fixture("let x = 40; x + 2");
     let p = TmProgram::of(&machine, 64);
     let back: TmProgram = serde_json::from_str(&serde_json::to_string(&p).expect("serialize")).expect("deserialize");
diff --git a/crates/redextape-wasm/src/lib.rs b/crates/redextape-wasm/src/lib.rs
index 4235df4..a5aea85 100644
--- a/crates/redextape-wasm/src/lib.rs
+++ b/crates/redextape-wasm/src/lib.rs
@@ -340,9 +340,9 @@ fn err(e: session::SessionError) -> JsValue {
 ///
 /// `serde_wasm_bindgen`'s default renders `Option::None` as `undefined`, and §5.1's TypeScript writes
 /// every optional as `T | null` — a renderer testing `x === null` would get it wrong. Getting this
-/// right only for top-level returns (`lambdaAst`, `sourceSpan`) and leaving struct FIELDS on the
+/// right only for top-level returns (`sourceSpan`) and leaving struct FIELDS on the
 /// default was worse than either choice alone: `lambdaStatus().run` would have been `undefined` while
-/// `lambdaAst()` was `null`, so one boundary would need two rules in the renderer. One serializer,
+/// `sourceSpan()` was `null`, so one boundary would need two rules in the renderer. One serializer,
 /// one rule.
 fn to_value<T: Serialize>(v: &T) -> Result<JsValue, JsValue> {
     let s = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
@@ -422,16 +422,6 @@ impl Session {
         to_value(&st)
     }
 
-    /// # Errors
-    ///
-    /// Returns `Err` when this session's λ leg is absent — check `lambdaStatus().available` first. An
-    /// exhausted `node_budget` is NOT an error: the print refuses and the caller receives `null`
-    /// (`TermTree | null`), not a throw.
-    #[wasm_bindgen(js_name = lambdaAst)]
-    pub fn lambda_ast(&self, node_budget: usize) -> Result<JsValue, JsValue> {
-        to_value(&self.0.lambda_ast(node_budget).map_err(err)?)
-    }
-
     /// `lambdaTree(step, nodeBudget)` -> the term at `step` (clamped to the run) as typed arrays; see
     /// `tree_to_js` for the shape. `u32` and widened, for `raiseLambdaCap`'s reason.
     ///
@@ -707,7 +697,7 @@ impl Session {
 }
 
 /// **SIX METHODS, AND THE SEVENTH'S ABSENCE IS LOAD-BEARING.** §3.3's audit puts `lambdaStatus`,
-/// `stepLambda`, `lambdaState`, `lambdaAst`, `raiseLambdaCap` and `runLambda` on this type unchanged —
+/// `stepLambda`, `lambdaState`, `lambdaTree`, `raiseLambdaCap` and `runLambda` on this type unchanged —
 /// they read nothing but the cursor. `lambdaValue` reads `self.ty`, `sourceSpan` and `linkIndex` read
 /// `self.map`, and none of the three is declared below; `tests/browser.rs` pins that at compile time
 /// rather than in prose.
@@ -748,15 +738,6 @@ impl LambdaScratch {
         to_value(&self.0.lambda_state(byte_budget))
     }
 
-    /// # Errors
-    ///
-    /// Returns `Err` only if `to_value` cannot marshal the arena; not expected for this crate's own
-    /// types. An exhausted `node_budget` is NOT an error: the caller receives `null`.
-    #[wasm_bindgen(js_name = lambdaAst)]
-    pub fn lambda_ast(&self, node_budget: usize) -> Result<JsValue, JsValue> {
-        to_value(&self.0.lambda_ast(node_budget))
-    }
-
     /// `lambdaTree(step, nodeBudget)`, as on `Session`; a scratch's trees carry no links.
     ///
     /// # Errors
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index b33c282..e52553b 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -14,7 +14,7 @@ use redextape_core::sourcemap::SourceMap;
 use redextape_core::tm::machine::Machine;
 use redextape_core::tm::{self, EncodingKind, Symbol, Tape, TmRun};
 use redextape_core::trace::{LambdaCheckpoints, LambdaCursor, TmCursor};
-use redextape_core::viewmodel::{LambdaState, LambdaTree, LinkIndex, TermTree, TmProgram, TmState, TreeAnswer};
+use redextape_core::viewmodel::{LambdaState, LambdaTree, LinkIndex, TmProgram, TmState, TreeAnswer};
 use redextape_core::{Diagnostic, Severity, Span, lints, parser, typeck};
 
 /// The deepest term any print through the session may walk — the two big-budget prints
@@ -755,16 +755,6 @@ impl Session {
         Ok(LambdaState::render(&leg.cursor, byte_budget, MAX_PRINT_DEPTH))
     }
 
-    /// The term as a flat tree, or `None` when it exceeds `node_budget` — `None` rather than a partial
-    /// tree, because a truncated AST is a lie about the term's shape.
-    ///
-    /// The payload is an ARENA (`TermTree`), not a tree of boxes, so neither serializing it across the
-    /// boundary nor dropping it afterwards recurses. See `viewmodel::TermTree`.
-    pub fn lambda_ast(&self, node_budget: usize) -> Result<Option<TermTree>, SessionError> {
-        let leg = self.lambda.as_ref().map_err(|_| SessionError::LambdaAbsent)?;
-        Ok(LambdaState::ast(&leg.cursor, node_budget))
-    }
-
     /// The term at `step` as a `LambdaTree`, or the term's size when it exceeds `node_budget` (spec
     /// §4). At step 0 it carries `node_to_lambda`'s links, so every construct the map places is
     /// reachable; at a later step, the owner tags.
@@ -1197,11 +1187,6 @@ impl LambdaScratch {
         LambdaState::render(&self.lambda.cursor, byte_budget, MAX_PRINT_DEPTH)
     }
 
-    /// The term as a flat arena, or `None` over `node_budget` — never a partial tree.
-    pub fn lambda_ast(&self, node_budget: usize) -> Option<TermTree> {
-        LambdaState::ast(&self.lambda.cursor, node_budget)
-    }
-
     /// The term at `step` as a `LambdaTree`. A scratch has no `SourceMap`, so its trees carry owner
     /// tags only — and a scratch's term was parsed from text, so it has none of those either.
     pub fn lambda_tree(&self, step: u64, node_budget: usize) -> TreeAt {
@@ -1681,7 +1666,7 @@ mod tests {
         assert!(!s.lambda_status().reason.is_empty(), "the reason is the payload the UI needs");
         assert!(s.lambda_status().node.is_some(), "the refusal names a Core node for the source pane");
         assert_eq!(s.lambda_state(usize::MAX), Err(SessionError::LambdaAbsent), "no state without a leg");
-        assert_eq!(s.lambda_ast(usize::MAX), Err(SessionError::LambdaAbsent));
+        assert_eq!(s.lambda_tree(0, usize::MAX).err(), Some(SessionError::LambdaAbsent));
     }
 
     /// `step_lambda() == false` is the SAME answer for three different endings, and only one of them
@@ -1921,13 +1906,6 @@ mod tests {
         assert_eq!(s.run_lambda(10), Err(SessionError::LambdaAbsent));
     }
 
-    #[test]
-    fn the_lambda_ast_refuses_a_budget_it_cannot_meet_and_answers_one_it_can() {
-        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
-        assert!(s.lambda_ast(1).expect("λ available").is_none(), "a 1-node budget must refuse, not truncate");
-        assert!(s.lambda_ast(usize::MAX).expect("λ available").is_some());
-    }
-
     const FACT3: &str = "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)";
 
     fn tree(at: &TreeAt) -> &LambdaTree {
@@ -2142,10 +2120,10 @@ mod tests {
     }
 
     #[test]
-    fn the_lambda_ast_on_a_scratch_refuses_a_budget_it_cannot_meet() {
+    fn the_lambda_tree_on_a_scratch_refuses_a_budget_it_cannot_meet() {
         let sc = lambda_scratch("(\\x. x) (\\y. y)").scratch.expect("parses");
-        assert!(sc.lambda_ast(1).is_none(), "a 1-node budget must refuse, not truncate");
-        assert!(sc.lambda_ast(usize::MAX).is_some());
+        assert!(matches!(sc.lambda_tree(0, 1).answer, TreeAnswer::Refused { .. }), "a 1-node budget must refuse");
+        assert!(matches!(sc.lambda_tree(0, usize::MAX).answer, TreeAnswer::Tree(_)));
     }
 
     // --- the fork -------------------------------------------------------------------------------
diff --git a/crates/redextape-wasm/tests/browser.rs b/crates/redextape-wasm/tests/browser.rs
index 77fe437..63a7414 100644
--- a/crates/redextape-wasm/tests/browser.rs
+++ b/crates/redextape-wasm/tests/browser.rs
@@ -80,44 +80,28 @@ fn compile(src: &str) -> (Array, JsValue) {
     (diagnostics, get(&out, "session"))
 }
 
-/// The height of a `TermTree` arena (`ast`, a `lambdaAst` result), computed as a single linear pass
-/// over `nodes` rather than by recursing — this is the capability the flat, post-order arena exists to
-/// provide, and using it here is the same walk a real renderer would need to lay a term out without
-/// recursing in JavaScript. A nested `Box`-shaped payload would force that walk to recurse instead;
-/// this helper is a consumer-side demonstration that the arena shape avoids it.
+/// The height of a `lambdaTree` result, in edges from the root, in ONE FORWARD PASS over its columns.
 ///
-/// Post-order guarantees `child_index < parent_index` for every child, so by the time index `i` is
-/// reached, `depth[child]` has already been computed for every child `i` can name: no worklist, no
-/// stack, no recursion, one forward pass filling a growing `Vec`. `depth[i]` is `0` for `Var`, `1 +
-/// depth[body]` for `Abs`, and `1 + max(depth[f], depth[a])` for `App`; the tree's height is the
-/// maximum over all of them (which is always `depth[root]`, since a node's depth already folds in
-/// every depth beneath it — the max is taken explicitly anyway so this makes no assumption about which
-/// index the root is).
-fn depth(ast: &JsValue) -> u32 {
-    let nodes: Array = get(ast, "nodes").unchecked_into();
-    let len = nodes.length();
-    let mut depths: Vec<u32> = Vec::with_capacity(len as usize);
-    for i in 0..len {
-        let node = nodes.get(i);
-        let var = get(&node, "Var");
-        let d = if !var.is_undefined() {
-            0
-        } else {
-            let abs = get(&node, "Abs");
-            if !abs.is_undefined() {
-                let tuple: Array = abs.unchecked_into();
-                let body = tuple.get(1).as_f64().expect("Abs body index marshals as a number") as usize;
-                1 + depths[body]
-            } else {
-                let app: Array = get(&node, "App").unchecked_into();
-                let f = app.get(0).as_f64().expect("App fn index marshals as a number") as usize;
-                let a = app.get(1).as_f64().expect("App arg index marshals as a number") as usize;
-                1 + depths[f].max(depths[a])
-            }
-        };
-        depths.push(d);
+/// Pre-order puts every child after its parent, so a node's depth is known before its children are
+/// reached: no stack, no recursion — the walk a renderer does to lay a term out, which is the property
+/// the flat arena exists to give a JavaScript consumer.
+fn depth(tree: &JsValue) -> u32 {
+    let kind = get(tree, "kind").unchecked_into::<js_sys::Uint8Array>().to_vec();
+    let left = get(tree, "left").unchecked_into::<js_sys::Uint32Array>().to_vec();
+    let right = get(tree, "right").unchecked_into::<js_sys::Uint32Array>().to_vec();
+    let mut depths = vec![0u32; kind.len()];
+    let mut height = 0;
+    for i in 0..kind.len() {
+        let d = depths[i];
+        height = height.max(d);
+        if kind[i] != 0 {
+            depths[left[i] as usize] = d + 1;
+        }
+        if kind[i] == 2 {
+            depths[right[i] as usize] = d + 1;
+        }
     }
-    depths.into_iter().max().unwrap_or(0)
+    height
 }
 
 #[wasm_bindgen_test]
@@ -186,69 +170,25 @@ fn compile_step_and_read_both_legs() {
     // `redex` and `protocol.ts`'s `PATH_ENTRY_BYTES` term with it, and this is what says so.  check-attributions: allow
     assert!(get(&state, "redex").is_undefined(), "the redex path is skipped on the wire; only `redex_span` crosses");
 
-    let ast = call(&session, "lambdaAst", &[JsValue::from_f64(1_000_000.0)]);
-    assert!(!ast.is_null(), "an unreachable node budget yields a tree");
-
-    // THE WIRE SHAPE, MEASURED RATHER THAN DESIGNED — PR 3b's `Decoded` lesson, applied before the
-    // fact this time. `TermTree` is a struct, so it crosses as an object with `nodes` and `root`;
-    // `TermNode` is an EXTERNALLY TAGGED enum, so each node is `{ Var: n }`, `{ Abs: [name, body] }`
-    // or `{ App: [f, a] }`. A consumer branches on which key is present — there is no `kind` field.
-    let nodes: Array = get(&ast, "nodes").unchecked_into();
-    assert!(nodes.length() > 0, "a term has at least one node");
-    assert_eq!(
-        num(&ast, "root"),
-        f64::from(nodes.length() - 1),
-        "post-order puts the root last, and `root` says so explicitly"
-    );
+    let tree = call(&session, "lambdaTree", &[JsValue::from_f64(1_000_000.0), JsValue::from_f64(1_000_000.0)]);
+    assert!(get(&tree, "refused").is_null(), "an unreachable node budget yields a tree, and `refused` is null");
 
-    // The term here is Church 42 — `λf. λx. f (f ... x)` — so its root is an `Abs`.
-    let root_node = nodes.get(nodes.length() - 1);
-    let abs: Array = get(&root_node, "Abs").unchecked_into();
-    assert_eq!(abs.length(), 2, "`Abs(String, u32)` crosses as a two-element tuple");
-    assert!(abs.get(0).as_string().is_some(), "the binder name marshals as a string");
-    // THE LOAD-BEARING ASSERTION FOR `u32` OVER `usize`: an index must arrive as a JS number. A
-    // `usize` child would cross as a `bigint`, which `as_f64` cannot read and a renderer cannot index
-    // an array with.
-    assert!(abs.get(1).as_f64().is_some(), "the body index marshals as a number, not a bigint");
-
-    // `{Var:n}` and `{App:[f,a]}` ARE PUBLISHED AS MEASURED FACTS TOO (this file's own comment two
-    // blocks up), but until now only `Abs` was actually exercised above. Found by scanning the arena
-    // for a real occurrence of each rather than constructing one by hand: Church 42's body is an `App`
-    // spine of `f` applied to itself repeatedly, ending in `x`, so both variants exist in this tree.
-    let mut saw_var = false;
-    let mut saw_app = false;
-    for i in 0..nodes.length() {
-        let node = nodes.get(i);
-        let var = get(&node, "Var");
-        if !var.is_undefined() {
-            assert!(var.as_f64().is_some(), "node {i}: `Var(u32)` must cross as a bare number, got {var:?}");
-            saw_var = true;
-        }
-        let app = get(&node, "App");
-        if !app.is_undefined() {
-            let app_pair: Array = app.unchecked_into();
-            assert_eq!(app_pair.length(), 2, "node {i}: `App(u32, u32)` must cross as a two-element tuple");
-            assert!(
-                app_pair.get(0).as_f64().is_some(),
-                "node {i}: App's fn index must marshal as a number, not a bigint"
-            );
-            assert!(
-                app_pair.get(1).as_f64().is_some(),
-                "node {i}: App's arg index must marshal as a number, not a bigint"
-            );
-            saw_app = true;
-        }
-        if saw_var && saw_app {
-            break;
-        }
+    // THE WIRE SHAPE, MEASURED RATHER THAN DESIGNED: one typed array per column, marks as a number or null.
+    assert!(get(&tree, "kind").is_instance_of::<js_sys::Uint8Array>(), "kind crosses as a Uint8Array");
+    for column in ["left", "right", "name", "hint", "link"] {
+        assert!(get(&tree, column).is_instance_of::<js_sys::Uint32Array>(), "{column} crosses as a Uint32Array");
     }
-    assert!(saw_var, "Church 42's arena has no Var node to assert {{Var:n}} against -- fixture assumption broke");
-    assert!(saw_app, "Church 42's arena has no App node to assert {{App:[f,a]}} against -- fixture assumption broke");
-
-    // `None` must arrive as `null`, not `undefined` — §5.1 writes this `TermTree | null`.
-    let refused = call(&session, "lambdaAst", &[JsValue::from_f64(1.0)]);
-    assert!(refused.is_null(), "a 1-node budget refuses, and refusal marshals as null");
-    assert!(!refused.is_undefined(), "null, specifically — a renderer testing `=== null` must see it");
+    assert!(get(&tree, "names").is_instance_of::<Array>(), "names cross as an array");
+    // The term here is Church 42 — `λf. λx. f (f ... x)` — a normal form: pre-order puts its `Abs` root
+    // first, and it has no next redex, which crosses as `null` rather than `undefined`.
+    let kinds = get(&tree, "kind").unchecked_into::<js_sys::Uint8Array>().to_vec();
+    assert_eq!(kinds.first(), Some(&1), "the root comes first, and Church 42's root is an Abs");
+    assert!(get(&tree, "nextRedex").is_null(), "a normal form has no next redex");
+    assert!(num(&tree, "step") > 0.0, "the step it answers is a number, clamped to the run");
+
+    let refused = call(&session, "lambdaTree", &[JsValue::from_f64(0.0), JsValue::from_f64(1.0)]);
+    assert!(num(&refused, "refused") > 1.0, "a 1-node budget refuses with the term's size");
+    assert_eq!(get(&refused, "kind").unchecked_into::<js_sys::Uint8Array>().length(), 0, "and every column is empty");
 
     // --- the TM leg: 2,870 δ-steps on a 5-tape, 123-state machine fitted to width 64.
     let program = call(&session, "tmProgram", &[]);
@@ -463,10 +403,11 @@ fn a_lambda_limitation_program_reports_a_tm_only_session() {
     assert!(get(&lambda, "run").is_null(), "there is no λ run to have a status, got {:?}", get(&lambda, "run"));
 
     // Every λ method now throws rather than aborting the module.
-    for method in ["stepLambda", "lambdaState", "lambdaAst"] {
+    for method in ["stepLambda", "lambdaState", "lambdaTree"] {
         let f: Function = get(&session, method).unchecked_into();
         let args = Array::new();
         args.push(&JsValue::from_f64(1_000_000.0));
+        args.push(&JsValue::from_f64(1_000_000.0));
         assert!(Reflect::apply(&f, &session, &args).is_err(), "{method} must throw for an absent leg");
     }
 
@@ -575,7 +516,7 @@ fn a_deep_but_legal_program_needs_the_raised_shadow_stack() {
 /// NOT A REGRESSION TEST, and the distinction is recorded rather than glossed: measured before the
 /// arena landed, the `Box`-shaped `TermNode` did not trap at any depth the guards admit on the 8 MiB
 /// shadow stack. There is no crash here to pin. What this is instead is a TRIPWIRE: a future change
-/// that reintroduces per-level recursion into `lambdaAst`'s marshaling, or that lowers the shadow
+/// that reintroduces per-level recursion into `lambdaTree`'s marshaling, or that lowers the shadow
 /// stack, has nothing to trap on today — this case is what would first notice, by no longer being able
 /// to walk a term this deep without itself recursing into a stack it does not have.
 ///
@@ -595,14 +536,14 @@ fn a_deep_but_legal_program_needs_the_raised_shadow_stack() {
 /// maximum, only that a depth in that neighborhood was reached.
 ///
 /// THE HELPER ITSELF IS THE OTHER HALF OF THE POINT: `depth` is a consumer-side walk of the arena,
-/// computed with one linear pass and no recursion — the capability the flat, post-order shape exists to
+/// computed with one linear pass and no recursion — the capability the flat, pre-order shape exists to
 /// provide. A `Box`-shaped payload would force this exact walk to recurse in JavaScript instead.
 ///
 /// THE BUDGET IS DELIBERATELY UNREACHABLE: `usize` is 32 bits on wasm32, so 4,000,000,000 is a node
 /// budget no term can exhaust. A `null` would mean the BUDGET refused rather than the depth being
 /// tolerated, and the case would pass for the wrong reason.
 #[wasm_bindgen_test]
-fn the_ast_tolerates_the_deepest_term_a_reduction_reaches() {
+fn the_tree_tolerates_the_deepest_term_a_reduction_reaches() {
     let elems = vec!["0"; 600].join(", ");
     let (diagnostics, session) = compile(&format!("[{elems}]"));
     assert_eq!(diagnostics.length(), 0, "a 600-deep cons spine is inside every front-end guard");
@@ -616,8 +557,9 @@ fn the_ast_tolerates_the_deepest_term_a_reduction_reaches() {
     let mut chunks = 0;
     let mut depths: Vec<u32> = Vec::new();
     loop {
-        let ast = call(&session, "lambdaAst", &[JsValue::from_f64(4_000_000_000.0)]);
-        assert!(!ast.is_null(), "the arena crosses at chunk {chunks}");
+        let ast =
+            call(&session, "lambdaTree", &[JsValue::from_f64(4_000_000_000.0), JsValue::from_f64(4_000_000_000.0)]);
+        assert!(get(&ast, "refused").is_null(), "the arena crosses at chunk {chunks}");
         depths.push(depth(&ast));
         let status = call(&session, "runLambda", &[JsValue::from_f64(100.0)]);
         chunks += 1;
@@ -627,8 +569,8 @@ fn the_ast_tolerates_the_deepest_term_a_reduction_reaches() {
         }
     }
 
-    let ast = call(&session, "lambdaAst", &[JsValue::from_f64(4_000_000_000.0)]);
-    assert!(!ast.is_null(), "and on the normal form too");
+    let ast = call(&session, "lambdaTree", &[JsValue::from_f64(4_000_000_000.0), JsValue::from_f64(4_000_000_000.0)]);
+    assert!(get(&ast, "refused").is_null(), "and on the normal form too");
     depths.push(depth(&ast));
     assert!(chunks > 1, "the loop must have actually stepped — one chunk means the run never ran");
 
@@ -641,11 +583,10 @@ fn the_ast_tolerates_the_deepest_term_a_reduction_reaches() {
     assert!(peak > 1_500, "peak sampled depth was {peak}, expected > 1500; samples were {depths:?}");
 }
 
-/// MEASURES V8's OWN LIMITS on a nested plain JS object, independent of `TermTree`/`TermNode`
-/// entirely. The design's load-bearing justification for this whole branch is a claim that was never
+/// MEASURES V8's OWN LIMITS on a nested plain JS object, independent of any type this crate marshals. The design's load-bearing justification for this whole branch is a claim that was never
 /// run: *"a 3,000-deep nested object still traps a recursive JS walk or a `JSON.stringify`"*
 /// (`docs/superpowers/specs/2026-08-07-termnode-arena-design.md` §0). This project's own standard —
-/// applied to the Rust side just above, in `the_ast_tolerates_the_deepest_term_a_reduction_reaches` —
+/// applied to the Rust side just above, in `the_tree_tolerates_the_deepest_term_a_reduction_reaches` —
 /// is that a claim like this is not established until a program chosen to break it has actually been
 /// run. This test runs it, checking both the design's own quoted 3,000 and the smaller 1,805 this
 /// project's own reduction is independently measured to reach (a native run recorded in the roadmap;
@@ -1132,9 +1073,9 @@ fn a_lambda_scratch_crosses_as_a_handle_and_steps() {
     assert_eq!(get(&state, "text").as_string().as_deref(), Some("λy. y"), "the identity applied to the identity");
     assert_eq!(num(&state, "step"), 1.0);
 
-    let ast = call(&scratch, "lambdaAst", &[JsValue::from_f64(1_000_000.0)]);
-    assert!(!ast.is_null(), "an unreachable node budget yields a tree");
-    assert_eq!(depth(&ast), 1, "`λy. y` is one binder over one variable");
+    let tree = call(&scratch, "lambdaTree", &[JsValue::from_f64(1_000_000.0), JsValue::from_f64(1_000_000.0)]);
+    assert!(get(&tree, "refused").is_null(), "an unreachable node budget yields a tree");
+    assert_eq!(depth(&tree), 1, "`λy. y` is one binder over one variable");
 
     // `raiseLambdaCap` returns `void` rather than a `Result` — there is no absent leg for it to throw
     // about — and `runLambda` still answers a `RunStatus` string. Both are called so the glue is
````

- [ ] **Step 2: Prove nothing but history names the old arena.**

Run: `rg -n "TermTree|TermNode|lambdaAst|lambda_ast|LambdaState::ast" crates web/src web/tests`
Expected: exactly these six lines, each a past-tense record rather than a pointer to live code:

```
crates/redextape-wasm/tests/browser.rs:217:    // `rule` crosses as a number or null, never as a bigint — the failure `TermNode`'s `u32` note was
crates/redextape-wasm/tests/browser.rs:511:/// the version this replaces, it MEASURES depth rather than only checking `lambdaAst` came back
crates/redextape-wasm/tests/browser.rs:517:/// arena landed, the `Box`-shaped `TermNode` did not trap at any depth the guards admit on the 8 MiB
crates/redextape-core/src/viewmodel.rs:413:/// what makes it affordable where `LambdaState::ast` was not: a per-step tree cost 850 MB against a
crates/redextape-core/examples/frame_cost_probe.rs:27://! It priced a per-step `TermTree` recorder — one tree per history frame, the design this probe's
crates/redextape-core/examples/frame_cost_probe.rs:28://! measurements declined — and `TermTree` is gone with `lambdaAst`. Part 4a serves one tree for the
```

A seventh line means a live reference survived. Rewrite it rather than extending this list.

- [ ] **Step 3: Run every affected tier.**

```
systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core -p redextape-wasm --no-fail-fast
systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy --workspace --all-targets -- -D warnings
PATH=/usr/sbin:/home/davey/.local/share/cargo/bin:$PATH systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 scripts/check-all.sh --browser-only
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- cargo run --release -p redextape-core --features serde --example frame_cost_probe
```

Expected: `1359 passed, 32 skipped`; no clippy warnings; the browser tier `27 passed`; the probe runs to completion with no section F (135 lines of output in the prototype, under its own documented 2G cap).

- [ ] **Step 4: Sabotage the moved wire-shape test.** In `lib.rs`'s `tree_to_js`, emit `kind` as a `Uint32Array`: `set("kind", &js_sys::Uint8Array::from(&tree.kind[..]))?;` → `set("kind", &js_sys::Uint32Array::from(&tree.kind.iter().map(|&k| u32::from(k)).collect::<Vec<_>>()[..]))?;`. Re-run the browser tier. Expected: `compile_step_and_read_both_legs` panics with `kind crosses as a Uint8Array` (26 passed, 1 failed in the prototype). Revert.

- [ ] **Step 5: Commit.**

```bash
git add -A crates/
git commit -m "Retire lambdaAst and TermTree: lambdaTree supersedes them, and every test they had is carried onto the tree or covered more strongly by the core oracle"
```

---

### Task 4: The `lambda-tree` request, the worker's answer, and the main-thread cache

**Files:**
- Create: `web/src/lambda-trees.ts`, `web/tests/node/lambda-trees.test.ts`
- Modify: `web/src/protocol.ts` (`LAMBDA_TREE_NODES`, `LambdaTreeWire`, the request and reply variants)
- Modify: `web/src/session-worker.ts` (`lambdaTree` on both handle types, `onLambdaTree`, the listener branch)
- Modify: `web/src/session-client.ts` (`gen` getter, `tree()`, a tree reply does not end "running…")
- Modify: `web/src/replies.ts` (a `lambda-tree` arm in `onReply` and `onScratchReply`; a `trees` dependency)
- Modify: `web/src/main.ts` (build one `LambdaTrees`, hand it to `createReplies`)
- Test: `web/tests/node/session-client.test.ts` (two cases), and the three files that call `createReplies` by hand — `web/tests/node/replies.test.ts`, `web/tests/browser/scratch-fork.test.ts`, `web/tests/browser/tm-pane-follows-session.test.ts` — which fail `tsc` without the new `trees` dependency

**Interfaces:**
- Consumes: Task 2's JS `lambdaTree(step, nodeBudget)`.
- Produces: `LAMBDA_TREE_NODES = 20_000`; `type LambdaTreeWire` (the Task 2 object, typed); `RunRequest` `{ kind: 'lambda-tree'; gen: number; step: number; budget: number }`; `RunReply` `{ kind: 'lambda-tree'; gen: number; tree: LambdaTreeWire }`; `SessionClient.gen: number` and `SessionClient.tree(step: number, budget: number): void`; `type TreeFor = { kind: 'tree'; tree: LambdaTreeWire } | { kind: 'stale'; tree: LambdaTreeWire } | { kind: 'refused'; nodes: number } | { kind: 'none' }`; `type TreeRequester = { readonly gen: number; readonly awaitingRun: boolean; tree(step: number, budget: number): void }`; `class LambdaTrees { constructor(client: (s: SessionId) => TreeRequester | undefined); want(session, step): TreeFor; store(session, gen, tree): void; buildOf(session): number | null; prune(alive: (s: SessionId) => boolean): void }`; `createReplies({ …, trees: LambdaTrees })`.

**THE CACHE ASKS NOTHING WHILE THE CLIENT AWAITS A RUN, AND THAT GATE WAS FOUND BY RUNNING, NOT BY DESIGN.** `SessionClient.supersede` moves the generation forward the moment a keystroke schedules a compile; the worker learns of it only when the debounced `run` arrives 300 ms later. A tree asked for in that window names a generation the worker has not reached, the worker drops it, and an entry waiting on that answer never asked again — the view stayed on flat text for good after any recompile. Task 8's `draws the new program’s tree after a recompile` fails without the gate. `LambdaTrees`' doc records the mechanism; do not remove the gate as an optimisation.

**`buildOf` NAMES THE BUILD A VIEW'S TREES COME FROM** — the generation of the entry `want` answers from, which stays the OLD build while the client awaits a run, as the frames on screen do. Task 8's view starts its folds over when it changes (spec §5.2, amendment 5).

- [ ] **Step 1: Write the failing tests.** Create `web/tests/node/lambda-trees.test.ts`:

````ts
import { describe, expect, it, vi } from 'vitest'
import { LambdaTrees } from '../../src/lambda-trees'
import { LAMBDA_TREE_NODES, type LambdaTreeWire } from '../../src/protocol'

const wire = (step: number, refused: number | null = null): LambdaTreeWire => ({
  step,
  refused,
  kind: new Uint8Array([0]),
  left: new Uint32Array([0]),
  right: new Uint32Array([0]),
  name: new Uint32Array([0]),
  hint: new Uint32Array([0]),
  link: new Uint32Array([0xffff_ffff]),
  names: ['x'],
  nextRedex: null,
  contractum: null,
})

const client = (gen = 1) => ({ gen, awaitingRun: false, tree: vi.fn() })

describe('LambdaTrees', () => {
  it('asks once for a step and answers none until the tree arrives', () => {
    const c = client()
    const trees = new LambdaTrees(() => c)
    expect(trees.want('s', 5)).toEqual({ kind: 'none' })
    expect(trees.want('s', 5)).toEqual({ kind: 'none' })
    expect(c.tree).toHaveBeenCalledTimes(1)
    expect(c.tree).toHaveBeenCalledWith(5, LAMBDA_TREE_NODES)
    const t = wire(5)
    trees.store('s', 1, t)
    expect(trees.want('s', 5)).toEqual({ kind: 'tree', tree: t })
    expect(c.tree).toHaveBeenCalledTimes(1)
  })

  it('shows the last tree as stale while asking for a new step, one request in flight at a time', () => {
    const c = client()
    const trees = new LambdaTrees(() => c)
    trees.want('s', 5)
    const five = wire(5)
    trees.store('s', 1, five)
    expect(trees.want('s', 6)).toEqual({ kind: 'stale', tree: five })
    expect(trees.want('s', 7)).toEqual({ kind: 'stale', tree: five })
    expect(c.tree).toHaveBeenCalledTimes(2)
    expect(c.tree).toHaveBeenLastCalledWith(6, LAMBDA_TREE_NODES)
  })

  it('reports a refusal for the step it answers', () => {
    const c = client()
    const trees = new LambdaTrees(() => c)
    trees.want('s', 3)
    trees.store('s', 1, wire(3, 40_000))
    expect(trees.want('s', 3)).toEqual({ kind: 'refused', nodes: 40_000 })
  })

  it('takes a clamped answer as the answer to what it asked, so it does not ask again', () => {
    const c = client()
    const trees = new LambdaTrees(() => c)
    trees.want('s', 9)
    const clamped = wire(4)
    trees.store('s', 1, clamped)
    expect(trees.want('s', 9)).toEqual({ kind: 'tree', tree: clamped })
    expect(c.tree).toHaveBeenCalledTimes(1)
  })

  it('forgets everything when the session is rebuilt, and ignores a reply from the old build', () => {
    const c = client(1)
    const trees = new LambdaTrees(() => c)
    trees.want('s', 2)
    trees.store('s', 1, wire(2))
    c.gen = 2
    expect(trees.want('s', 2)).toEqual({ kind: 'none' })
    trees.store('s', 1, wire(2))
    expect(trees.want('s', 2)).toEqual({ kind: 'none' })
  })

  it('asks nothing while the client awaits a run, and keeps showing the tree it has', () => {
    const c = client(1)
    const trees = new LambdaTrees(() => c)
    trees.want('s', 2)
    const two = wire(2)
    trees.store('s', 1, two)
    c.gen = 2
    c.awaitingRun = true
    expect(trees.want('s', 2)).toEqual({ kind: 'tree', tree: two })
    expect(trees.want('s', 3)).toEqual({ kind: 'stale', tree: two })
    expect(c.tree).toHaveBeenCalledTimes(1)
    c.awaitingRun = false
    expect(trees.want('s', 0)).toEqual({ kind: 'none' })
    expect(c.tree).toHaveBeenLastCalledWith(0, LAMBDA_TREE_NODES)
  })

  it('names the build its trees come from, and keeps the old build while the client awaits a run', () => {
    const c = client(1)
    const trees = new LambdaTrees(() => c)
    expect(trees.buildOf('s')).toBeNull()
    trees.want('s', 0)
    expect(trees.buildOf('s')).toBe(1)
    c.gen = 2
    c.awaitingRun = true
    trees.want('s', 0)
    expect(trees.buildOf('s'), 'the frames on screen are still the old build’s').toBe(1)
    c.awaitingRun = false
    trees.want('s', 0)
    expect(trees.buildOf('s')).toBe(2)
  })

  it('answers none for a session with no client, and prunes sessions that are gone', () => {
    const c = client()
    const trees = new LambdaTrees((s) => (s === 's' ? c : undefined))
    expect(trees.want('gone', 0)).toEqual({ kind: 'none' })
    trees.want('s', 0)
    trees.store('s', 1, wire(0))
    trees.prune((s) => s !== 's')
    expect(trees.want('s', 0)).toEqual({ kind: 'none' })
  })
})
````

and apply the tests' half of the patch — the two `session-client` cases, and `trees` in each hand-built `createReplies`:

````diff
diff --git a/web/tests/browser/scratch-fork.test.ts b/web/tests/browser/scratch-fork.test.ts
index ae18b19..a17d2fc 100644
--- a/web/tests/browser/scratch-fork.test.ts
+++ b/web/tests/browser/scratch-fork.test.ts
@@ -3,6 +3,7 @@ import { beforeAll, describe, expect, it } from 'vitest'
 import { createEditorCustody } from '../../src/editor-custody'
 import { History } from '../../src/history'
 import { LambdaPane } from '../../src/lambda-pane'
+import { LambdaTrees } from '../../src/lambda-trees'
 import { createLinkWiring } from '../../src/link-wiring'
 import { PaneCollection } from '../../src/panes'
 import type { RunReply } from '../../src/protocol'
@@ -622,6 +623,7 @@ describe('the no-session report for a failed fork', () => {
       const notified: string[] = []
       const replies = createReplies({
         setProgram: () => undefined,
+        trees: new LambdaTrees(() => undefined),
         sessions: reg,
         scratchpad: pad,
         results,
diff --git a/web/tests/browser/tm-pane-follows-session.test.ts b/web/tests/browser/tm-pane-follows-session.test.ts
index 5a1c263..497532e 100644
--- a/web/tests/browser/tm-pane-follows-session.test.ts
+++ b/web/tests/browser/tm-pane-follows-session.test.ts
@@ -1,6 +1,7 @@
 import { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it, vi } from 'vitest'
 import FIXTURE from '../../../crates/redextape-core/tests/fixtures/five_minus_three_single_tape.tm?raw'
+import { LambdaTrees } from '../../src/lambda-trees'
 import type { LinkWiring } from '../../src/link-wiring'
 import type { PaneEvents } from '../../src/pane-chrome'
 import { PaneCollection } from '../../src/panes'
@@ -96,6 +97,7 @@ describe('a TM buffer whose worker died', () => {
     if (held === undefined || split === undefined) throw new Error('two panes were not made')
     const replies = createReplies({
       setProgram: () => undefined,
+      trees: new LambdaTrees(() => undefined),
       sessions: reg,
       scratchpad: buffers,
       results: document.createElement('section'),
diff --git a/web/tests/node/replies.test.ts b/web/tests/node/replies.test.ts
index 340ab80..f8c6336 100644
--- a/web/tests/node/replies.test.ts
+++ b/web/tests/node/replies.test.ts
@@ -1,6 +1,7 @@
 import type { EditorView } from '@codemirror/view'
 import { describe, expect, it } from 'vitest'
 import { History } from '../../src/history'
+import { LambdaTrees } from '../../src/lambda-trees'
 import type { LinkWiring } from '../../src/link-wiring'
 import { PaneCollection, type PaneEntry } from '../../src/panes'
 import type { RunReply, RunRequest } from '../../src/protocol'
@@ -116,6 +117,7 @@ function driver(entry: SessionEntry) {
   const links = { setIndex: (i: unknown) => indexed.push(i) } as unknown as LinkWiring
   const replies = createReplies({
     setProgram: () => undefined,
+    trees: new LambdaTrees(() => undefined),
     sessions: reg,
     scratchpad: undefined as unknown as ScratchBuffers,
     results: undefined as unknown as HTMLElement,
@@ -285,6 +287,7 @@ function scratchDriver() {
   })
   const replies = createReplies({
     setProgram: () => undefined,
+    trees: new LambdaTrees(() => undefined),
     sessions: reg,
     scratchpad: buffers,
     results: undefined as unknown as HTMLElement,
diff --git a/web/tests/node/session-client.test.ts b/web/tests/node/session-client.test.ts
index eb6d3e7..6c8d371 100644
--- a/web/tests/node/session-client.test.ts
+++ b/web/tests/node/session-client.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it, vi } from 'vitest'
-import type { LambdaLeg, RunReply, RunRequest, TmLeg } from '../../src/protocol'
+import type { LambdaLeg, LambdaTreeWire, RunReply, RunRequest, TmLeg } from '../../src/protocol'
 import type { ClientPort } from '../../src/session-client'
 import { SessionClient } from '../../src/session-client'
 import type { LambdaStatus, TmStatus } from '../../src/types'
@@ -18,7 +18,43 @@ function fakePort() {
 
 const reply = (gen: number): RunReply => ({ kind: 'no-session', gen, diagnostics: [] })
 
+/** A one-node `LambdaTreeWire` — what a `lambda-tree` reply carries. */
+const TREE: LambdaTreeWire = {
+  step: 0,
+  refused: null,
+  kind: new Uint8Array([0]),
+  left: new Uint32Array([0]),
+  right: new Uint32Array([0]),
+  name: new Uint32Array([0]),
+  hint: new Uint32Array([0]),
+  link: new Uint32Array([0xffff_ffff]),
+  names: ['x'],
+  nextRedex: null,
+  contractum: null,
+}
+
 describe('SessionClient', () => {
+  it('a tree reply does not end the wait for a run', () => {
+    const { port, deliver } = fakePort()
+    const c = new SessionClient(port, () => {})
+    const gen = c.supersede()
+    deliver({ kind: 'lambda-tree', gen, tree: TREE })
+    expect(c.awaitingRun).toBe(true)
+    deliver(reply(gen))
+    expect(c.awaitingRun).toBe(false)
+  })
+
+  it('asks for a tree at the live generation, and not before the first build', () => {
+    const { port, sent } = fakePort()
+    const c = new SessionClient(port, () => {})
+    c.tree(3, 100)
+    expect(sent).toEqual([])
+    const gen = c.supersede()
+    c.tree(3, 100)
+    expect(sent).toEqual([{ kind: 'lambda-tree', gen, step: 3, budget: 100 }])
+    expect(c.gen).toBe(gen)
+  })
+
   it('stamps each request with a fresh generation', () => {
     const { port, sent } = fakePort()
     const c = new SessionClient(port, () => {})
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd web && pnpm run typecheck`
Expected: FAIL, 17 errors — among them `Cannot find module '../../src/lambda-trees'`, `'trees' does not exist in type …` for each hand-built `createReplies`, and `Module '"../../src/protocol"' has no exported member 'LAMBDA_TREE_NODES'`.

Run: `pnpm exec vitest run --project node tests/node/lambda-trees.test.ts tests/node/session-client.test.ts tests/node/replies.test.ts`
Expected: FAIL — 3 files fail; of the tests that load, the two new `session-client` cases fail and 20 pass.

- [ ] **Step 3: Write the cache.** Create `web/src/lambda-trees.ts`:

````ts
import { LAMBDA_TREE_NODES, type LambdaTreeWire } from './protocol'
import type { SessionId } from './session-client'

/** What a view is told about the tree for the step it shows. */
export type TreeFor =
  /** The tree for exactly the step asked (or the step the worker clamped it to). */
  | { readonly kind: 'tree'; readonly tree: LambdaTreeWire }
  /** The last tree that came back, for another step — shown until the asked one arrives (spec §4.5). */
  | { readonly kind: 'stale'; readonly tree: LambdaTreeWire }
  /** The term at this step has `nodes` nodes, over `LAMBDA_TREE_NODES`. */
  | { readonly kind: 'refused'; readonly nodes: number }
  /** Nothing has come back yet. */
  | { readonly kind: 'none' }

/** The half of `SessionClient` this cache uses. */
export type TreeRequester = {
  readonly gen: number
  readonly awaitingRun: boolean
  tree(step: number, budget: number): void
}

type Entry = {
  gen: number
  latest: LambdaTreeWire | null
  /** The step `latest` was asked for — equal to `latest.step` unless the worker clamped it. */
  answered: number | null
  /** The step a request is in flight for, or `null`. At most one per session, so a fast play asks at
   * most once per reply rather than once per frame. */
  asked: number | null
}

/**
 * The λ trees the views are drawing, one per session, asked for on demand (spec §4.1).
 *
 * **ONE REQUEST IN FLIGHT PER SESSION.** `want` is called from `draw()`, once per frame per λ view; it
 * asks only when nothing is outstanding, and a reply's `draw()` asks for the then-current step. So a view
 * at rest asks once, and a view playing at 5,000 steps a second asks as fast as the worker answers — never
 * faster.
 *
 * **KEYED BY GENERATION.** A recompile makes a new session behind the same id; an entry from the old
 * generation is discarded on first sight, and a reply carrying it is ignored.
 *
 * **NOTHING IS ASKED WHILE THE CLIENT AWAITS A RUN.** `SessionClient.supersede` moves the generation
 * forward the moment a keystroke schedules a compile, and the worker learns it only when the debounced
 * `run` arrives. A tree asked for in between names a generation the worker has not reached, so the worker
 * drops it — and an entry waiting on an answer that will never come would never ask again. Until the new
 * build answers, the frames on screen are still the old build's, so the old build's tree is still theirs.
 */
export class LambdaTrees {
  #entries = new Map<SessionId, Entry>()
  #client: (session: SessionId) => TreeRequester | undefined

  constructor(client: (session: SessionId) => TreeRequester | undefined) {
    this.#client = client
  }

  want(session: SessionId, step: number): TreeFor {
    const client = this.#client(session)
    if (client === undefined) return { kind: 'none' }
    if (client.awaitingRun) return this.#held(this.#entries.get(session), step)
    let e = this.#entries.get(session)
    if (e === undefined || e.gen !== client.gen) {
      e = { gen: client.gen, latest: null, answered: null, asked: null }
      this.#entries.set(session, e)
    }
    const held = this.#held(e, step)
    if (held.kind === 'tree' || held.kind === 'refused') return held
    if (e.asked === null) {
      e.asked = step
      client.tree(step, LAMBDA_TREE_NODES)
    }
    return held
  }

  /** What `e` already holds for `step`, asking nothing. */
  #held(e: Entry | undefined, step: number): TreeFor {
    const latest = e?.latest ?? null
    if (latest === null) return { kind: 'none' }
    if (latest.step === step || e?.answered === step) {
      return latest.refused === null ? { kind: 'tree', tree: latest } : { kind: 'refused', nodes: latest.refused }
    }
    return latest.refused === null ? { kind: 'stale', tree: latest } : { kind: 'none' }
  }

  store(session: SessionId, gen: number, tree: LambdaTreeWire): void {
    const e = this.#entries.get(session)
    if (e === undefined || e.gen !== gen) return
    e.latest = tree
    e.answered = e.asked
    e.asked = null
  }

  /**
   * The build `session`'s trees come from — the generation of the entry `want` answers from — or `null`
   * before its first ask. While the client awaits a run this is still the OLD build, as the frames on
   * screen are; a view starts its folds over when it changes (spec §5.2).
   */
  buildOf(session: SessionId): number | null {
    return this.#entries.get(session)?.gen ?? null
  }

  /** Drop every session `alive` says is gone — a deleted copy's last tree is not worth keeping. */
  prune(alive: (session: SessionId) => boolean): void {
    for (const id of [...this.#entries.keys()]) if (!alive(id)) this.#entries.delete(id)
  }
}
````

- [ ] **Step 4: The protocol, the worker, the client, the replies and the app.** Apply the source half of the patch:

````diff
diff --git a/web/src/main.ts b/web/src/main.ts
index f17a7d2..f17f7f2 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -26,6 +26,7 @@ import { declineMark, focusMark, linkMark } from './highlight'
 import { History } from './history'
 import { icon } from './icons'
 import type { LambdaPane } from './lambda-pane'
+import { LambdaTrees } from './lambda-trees'
 import { closeLeaf, defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, leaves, SOURCE_LEAF } from './layout'
 import { createLinkWiring, type LinkWiring } from './link-wiring'
 import { LspClient } from './lsp-client'
@@ -640,6 +641,8 @@ async function main(): Promise<EditorView> {
     tmProgram: null,
     tmScratch: null,
   })
+  /** The λ trees the views draw (spec §4) — one cache, asked through each session's own client. */
+  const trees = new LambdaTrees((id) => (sessions.has(id) ? sessions.entryOf(id).client : undefined))
   /**
    * TRANSPORT, BEFORE EITHER PANE — its `events(...)` is what each pane is constructed with, so it has
    * to exist first. `scratchpad` is a real value (constructed above, and nothing later reassigns it);
@@ -1798,6 +1801,7 @@ async function main(): Promise<EditorView> {
     view: () => view,
     panes,
     links: linkWiring,
+    trees,
     draw,
     notify: (text: string) => notices.notify(text),
     setProgram: (r: ProgramResult) => {
diff --git a/web/src/protocol.ts b/web/src/protocol.ts
index 3b12d90..111f7cf 100644
--- a/web/src/protocol.ts
+++ b/web/src/protocol.ts
@@ -331,6 +331,35 @@ export function forkable(p: TmProgram | null): p is TmProgram {
   return p !== null && ruleCount(p) <= MAX_FORK_RULES
 }
 
+/**
+ * The most λ nodes a view asks the session worker to lay out (spec §4.5). `while4`'s peak, the largest
+ * in the spec's measured corpus, is 9,763; a term past this is drawn as its recorded frame text, with a
+ * notice naming its size.
+ */
+export const LAMBDA_TREE_NODES = 20_000
+
+/**
+ * `lambdaTree(step, nodeBudget)`'s object. `redextape-wasm`'s `tree_to_js` builds it by hand, so it has
+ * no generated binding and this is its one TypeScript description.
+ *
+ * COLUMNS, ONE TYPED ARRAY EACH, indexed by node in PRE-ORDER: node 0 is the root and a node's subtree
+ * is one index range. `refused` is the term's node count when it exceeded the budget, and every column is
+ * then empty. `step` is the step answered, which the worker clamps to what the run has reached.
+ */
+export type LambdaTreeWire = {
+  readonly step: number
+  readonly refused: number | null
+  readonly kind: Uint8Array
+  readonly left: Uint32Array
+  readonly right: Uint32Array
+  readonly name: Uint32Array
+  readonly hint: Uint32Array
+  readonly link: Uint32Array
+  readonly names: readonly string[]
+  readonly nextRedex: number | null
+  readonly contractum: number | null
+}
+
 export type RunRequest =
   | { kind: 'run'; gen: number; src: string; encoding: string }
   /**
@@ -384,6 +413,11 @@ export type RunRequest =
    * simply allows another `HISTORY_BYTES` and resumes.
    */
   | { kind: 'extend'; gen: number; leg: Leg }
+  /**
+   * The λ tree at `step` for the live session (spec §4.1). NOT A BUILD: it claims no generation and
+   * supersedes nothing, and the worker drops a request whose generation is no longer live.
+   */
+  | { kind: 'lambda-tree'; gen: number; step: number; budget: number }
 
 /**
  * `declinedSpan` IS RESOLVED IN THE WORKER, not on the main thread, because `sourceSpan` is a
@@ -523,6 +557,8 @@ export type RunReply =
    * from PR 3c so that module needs no edit.
    */
   | { kind: 'result'; gen: number; lambda: LambdaLeg; tm: TmLeg }
+  /** The answer to `lambda-tree`; `tree.step` is the step it answers, clamped to the run. */
+  | { kind: 'lambda-tree'; gen: number; tree: LambdaTreeWire }
   /**
    * The worker threw. EVERY `Session` method and every free export is fallible at the `lib.rs` layer
    * — `to_value` can fail even where `session.rs` cannot — and a throw inside an `async` message
diff --git a/web/src/replies.ts b/web/src/replies.ts
index 5aa44e0..f331106 100644
--- a/web/src/replies.ts
+++ b/web/src/replies.ts
@@ -1,6 +1,7 @@
 import type { EditorView } from '@codemirror/view'
 import type { EditablePane } from './editor-custody'
 import { setDecline, setLink } from './highlight'
+import type { LambdaTrees } from './lambda-trees'
 import { LinkIndex } from './link'
 import type { LinkWiring } from './link-wiring'
 import type { PaneCollection } from './panes'
@@ -75,6 +76,7 @@ export function createReplies(deps: {
   view: () => EditorView
   panes: PaneCollection
   links: LinkWiring
+  trees: LambdaTrees
   draw: () => void
   /**
    * The pane currently holding `session`'s editor, or `undefined` if none currently is — replaces a
@@ -123,6 +125,7 @@ export function createReplies(deps: {
     view,
     panes,
     links: linkWiring,
+    trees,
     draw,
     editorHome,
     onBuffersPersist,
@@ -196,6 +199,10 @@ export function createReplies(deps: {
   const onReply = (session: SessionId, reply: RunReply): void => {
     const { legs } = sessions.entryOf(session)
     switch (reply.kind) {
+      case 'lambda-tree':
+        trees.store(session, reply.gen, reply.tree)
+        draw()
+        return
       case 'no-session':
         results.dataset.state = 'idle'
         setProgram({ kind: 'no-session', diagnostics: reply.diagnostics })
@@ -322,6 +329,10 @@ export function createReplies(deps: {
    */
   const onScratchReply = (session: SessionId, reply: RunReply): void => {
     switch (reply.kind) {
+      case 'lambda-tree':
+        trees.store(session, reply.gen, reply.tree)
+        draw()
+        return
       case 'scratch-compiled':
         // ONE STATUS, AND THE `null` IS NOT A FABRICATION. `resetLegs` drops a status for a leg the
         // session does not have rather than writing one so the record is square — its own doc, and
diff --git a/web/src/session-client.ts b/web/src/session-client.ts
index 5b9348f..93b5d18 100644
--- a/web/src/session-client.ts
+++ b/web/src/session-client.ts
@@ -33,7 +33,9 @@ export class SessionClient {
         // repaint reading the flag while it was still set would paint the withdrawal one frame after
         // the window it describes had already closed. Idempotent after the first reply of a
         // generation, which is why it is unconditional rather than guarded.
-        this.#awaitingRun = false
+        // A TREE IS NOT A RUN'S ANSWER. It arrives between record chunks, often while the run is still
+        // in flight, and letting it clear the flag would end "running…" before the run said anything.
+        if (e.data.kind !== 'lambda-tree') this.#awaitingRun = false
         onReply(e.data)
       }
     })
@@ -140,6 +142,19 @@ export class SessionClient {
     if (this.#gen === 0) return
     this.#port.postMessage({ kind: 'extend', gen: this.#gen, leg })
   }
+  /** This client's generation — the one a `lambda-tree` request must carry to be answered. */
+  get gen(): number {
+    return this.#gen
+  }
+
+  /**
+   * Ask for the λ tree at `step` (spec §4.1). Not a supersede: it names the live generation and builds
+   * nothing, so it is posted as `extend` is, and never before the first build.
+   */
+  tree(step: number, budget: number): void {
+    if (this.#gen === 0) return
+    this.#port.postMessage({ kind: 'lambda-tree', gen: this.#gen, step, budget })
+  }
 }
 
 /**
diff --git a/web/src/session-worker.ts b/web/src/session-worker.ts
index 2730253..535e470 100644
--- a/web/src/session-worker.ts
+++ b/web/src/session-worker.ts
@@ -39,7 +39,7 @@
  */
 import init, { compile, lambdaScratchAt, tapeNames, tmScratch } from '../../pkg/redextape_wasm.js'
 import type { LinkIndexWire } from './link'
-import type { LambdaLeg, Leg, RecordEnd, RunReply, RunRequest, TmLeg } from './protocol'
+import type { LambdaLeg, LambdaTreeWire, Leg, RecordEnd, RunReply, RunRequest, TmLeg } from './protocol'
 import {
   EXTEND_CELLS,
   EXTEND_STEPS,
@@ -76,6 +76,7 @@ type Session = {
   lambdaState(byteBudget: number): LambdaState
   lambdaValue(): Decoded
   stepLambda(): boolean
+  lambdaTree(step: number, nodeBudget: number): LambdaTreeWire
   raiseLambdaCap(extra: number): void
   tmStatus(): TmStatus
   tmProgram(): TmProgram
@@ -114,6 +115,7 @@ type LambdaScratchHandle = {
   lambdaStatus(): LambdaStatus
   lambdaState(byteBudget: number): LambdaState
   stepLambda(): boolean
+  lambdaTree(step: number, nodeBudget: number): LambdaTreeWire
   raiseLambdaCap(extra: number): void
   free(): void
 }
@@ -820,6 +822,35 @@ async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<v
   ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
 }
 
+/**
+ * Answer one `lambda-tree` request, synchronously, between record chunks (spec §4.1).
+ *
+ * **NOT A CLAIM ON `latest`.** A tree is a question about what a `run` or `lambda-scratch` built, not a
+ * new build, so it supersedes nothing; a request for a generation that is no longer live is dropped, as a
+ * stale record loop's frames are.
+ *
+ * **A DECLINED λ LEG IS ASKED NOTHING.** `Session.lambdaTree` throws for an absent leg, and a throw here
+ * lands in the listener's `catch`, which drops the whole session — a λ view on a TM-only program would
+ * kill that program's TM leg. The view never asks for such a leg, since it has no frames; this guard is
+ * what makes that true rather than merely usual.
+ *
+ * THE COLUMNS ARE TRANSFERRED, not cloned: `tree_to_js` copies each out of wasm memory into its own
+ * `ArrayBuffer`, which nothing here reads again.
+ */
+function onLambdaTree(req: Extract<RunRequest, { kind: 'lambda-tree' }>): void {
+  if (live?.gen !== req.gen || live.kind === 'tm-scratch') return
+  if (live.kind === 'session' && !live.session.lambdaStatus().available) return
+  const tree = live.session.lambdaTree(req.step, req.budget)
+  ctx.postMessage({ kind: 'lambda-tree', gen: req.gen, tree }, [
+    tree.kind.buffer,
+    tree.left.buffer,
+    tree.right.buffer,
+    tree.name.buffer,
+    tree.hint.buffer,
+    tree.link.buffer,
+  ])
+}
+
 ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
   const req = e.data
   try {
@@ -840,6 +871,8 @@ ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
       await onTmScratch(req)
     } else if (req.kind === 'extend') {
       await onExtend(req)
+    } else if (req.kind === 'lambda-tree') {
+      onLambdaTree(req)
     }
   } catch (err) {
     // A THROWN SESSION CALL MUST NOT BECOME SILENCE. Every wasm entry point is fallible at the
````

The worker's `onLambdaTree` answers synchronously between record chunks, claims no generation, drops a request for one that is no longer live, asks a declined λ leg nothing (a throw there would drop the whole session), and transfers the six column buffers rather than cloning them.

- [ ] **Step 5: Run the tests.**

Run: `cd web && pnpm run typecheck && pnpm exec vitest run --project node`
Expected: typecheck exits 0; `612 passed` (`lambda-trees.test.ts` 8, `session-client.test.ts` 22).

- [ ] **Step 6: Sabotage, one at a time, reverting after each** (`pnpm exec vitest run --project node tests/node/lambda-trees.test.ts tests/node/session-client.test.ts`):

| Sabotage | Fails |
|---|---|
| `lambda-trees.ts`: `if (e.asked === null) {` → `if (true) {` (ask on every call) | `asks once for a step…`, `shows the last tree as stale…` |
| `session-client.ts`: `if (e.data.kind !== 'lambda-tree') this.#awaitingRun = false` → `this.#awaitingRun = false` | `a tree reply does not end the wait for a run` |
| `lambda-trees.ts`: delete `if (client.awaitingRun) return this.#held(this.#entries.get(session), step)` | `asks nothing while the client awaits a run…`, `names the build its trees come from…` |
| `lambda-trees.ts`: `if (e === undefined \|\| e.gen !== gen) return` → `if (e === undefined) return` | `forgets everything when the session is rebuilt…` |
| `lambda-trees.ts`: `e.answered = e.asked` → `e.answered = null` | `takes a clamped answer as the answer to what it asked…` |
| `lambda-trees.ts`: `return this.#entries.get(session)?.gen ?? null` → `return this.#client(session)?.gen ?? null` | `names the build its trees come from, and keeps the old build while the client awaits a run` |

- [ ] **Step 7: Commit.**

```bash
git add web/src/protocol.ts web/src/session-worker.ts web/src/session-client.ts web/src/lambda-trees.ts \
  web/src/replies.ts web/src/main.ts web/tests/node/lambda-trees.test.ts web/tests/node/session-client.test.ts \
  web/tests/node/replies.test.ts web/tests/browser/scratch-fork.test.ts web/tests/browser/tm-pane-follows-session.test.ts
git commit -m "Web: a lambda-tree request the worker answers between record chunks, and one cache that asks once per step, never ends a run's wait, and names the build its trees come from"
```

---

### Task 5: `Tree` — the wire plus what every consumer derives from it

**Files:**
- Create: `web/src/lambda-tree.ts`
- Create: `web/tests/node/tree-fixture.ts` (builds a `LambdaTreeWire` from λ text; the browser tests use it too)
- Test: `web/tests/node/lambda-tree.test.ts`

**Interfaces:**
- Consumes: `LambdaTreeWire` (Task 4).
- Produces: `KIND_VAR = 0`, `KIND_ABS = 1`, `KIND_APP = 2`, `NO_LINK = 0xffff_ffff`; `type Chip = { kind: 'numeral'; value: number } | { kind: 'bool'; value: boolean }`; `class Tree { readonly wire; count; parent: Int32Array; depth: Uint32Array; size: Uint32Array; maxDepth; kind(i); left(i); right(i); index(i); name(i); hint(i); link(i); contains(i, j): boolean; key(i): string; linkedAncestor(i): number | null; nodesLinkedTo(id): number[]; chip(i): Chip | null }`; test helper `wireOf(src, options?)`.

**A HINT'S TRAILING DIGITS ARE IGNORED** (spec amendment 4). Freshening is print-time only, so a lowered term's hints never carry them — but a copy is built by re-parsing printed text, and there the printed, freshened names (`x0`) are the hints. The prototype's `scratch-app` run found a copy's numeral that never read as a chip.

- [ ] **Step 1: The fixture builder.** Create `web/tests/node/tree-fixture.ts`:

````ts
import type { LambdaTreeWire } from '../../src/protocol'

type Ast = { k: 'var'; name: string } | { k: 'abs'; name: string; body: Ast } | { k: 'app'; f: Ast; a: Ast }

/** Parse `\x. x`-style λ text (`\` or `λ`, juxtaposition, parentheses) — the printer's grammar. Test-only. */
function parse(src: string): Ast {
  const toks = src.match(/λ|\\|\(|\)|\.|[A-Za-z_][A-Za-z0-9_']*/g) ?? []
  let i = 0
  const binder = () => toks[i] === 'λ' || toks[i] === '\\'
  const term = (): Ast => {
    if (binder()) {
      i += 1
      const name = toks[i] as string
      i += 2
      return { k: 'abs', name, body: term() }
    }
    let f = atom()
    while (i < toks.length && toks[i] !== ')') f = { k: 'app', f, a: binder() ? term() : atom() }
    return f
  }
  const atom = (): Ast => {
    if (toks[i] === '(') {
      i += 1
      const t = term()
      i += 1
      return t
    }
    const name = toks[i] as string
    i += 1
    return { k: 'var', name }
  }
  return term()
}

export type FixtureOptions = {
  readonly step?: number
  /** Defaults to the first `App` whose function is an `Abs`, in pre-order — the core's rule. */
  readonly nextRedex?: number | null
  readonly contractum?: number | null
  /** Node index -> the construct it links to. */
  readonly links?: Readonly<Record<number, number>>
}

/**
 * The `LambdaTreeWire` `tree_to_js` would send for `src`: pre-order, de Bruijn indices, one entry per
 * occurrence. Names are the text's own — no freshening — and double as hints, so a fixture chooses its
 * chips by choosing its binder names.
 */
export function wireOf(src: string, o: FixtureOptions = {}): LambdaTreeWire {
  const kind: number[] = []
  const left: number[] = []
  const right: number[] = []
  const name: number[] = []
  const link: number[] = []
  const names: string[] = []
  const intern = (s: string): number => {
    const at = names.indexOf(s)
    if (at >= 0) return at
    names.push(s)
    return names.length - 1
  }
  let redex: number | null = null
  const walk = (t: Ast, scope: readonly string[]): number => {
    const me = kind.length
    kind.push(0)
    left.push(0)
    right.push(0)
    name.push(0)
    link.push(o.links?.[me] ?? 0xffff_ffff)
    if (t.k === 'var') {
      const at = scope.lastIndexOf(t.name)
      left[me] = at < 0 ? scope.length : scope.length - 1 - at
      name[me] = intern(t.name)
    } else if (t.k === 'abs') {
      kind[me] = 1
      name[me] = intern(t.name)
      left[me] = walk(t.body, [...scope, t.name])
    } else {
      kind[me] = 2
      if (redex === null && t.f.k === 'abs') redex = me
      left[me] = walk(t.f, scope)
      right[me] = walk(t.a, scope)
    }
    return me
  }
  walk(parse(src), [])
  return {
    step: o.step ?? 0,
    refused: null,
    kind: Uint8Array.from(kind),
    left: Uint32Array.from(left),
    right: Uint32Array.from(right),
    name: Uint32Array.from(name),
    hint: Uint32Array.from(name),
    link: Uint32Array.from(link),
    names,
    nextRedex: o.nextRedex === undefined ? redex : o.nextRedex,
    contractum: o.contractum ?? null,
  }
}
````

- [ ] **Step 2: Write the failing test.** Create `web/tests/node/lambda-tree.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import { KIND_ABS, KIND_APP, KIND_VAR, Tree } from '../../src/lambda-tree'
import { wireOf } from './tree-fixture'

describe('Tree', () => {
  // `(\x. x) y` in pre-order: 0 App, 1 Abs x, 2 Var x, 3 Var y.
  const t = new Tree(wireOf('(\\x. x) y'))

  it('derives parent, depth and size, and a subtree is one index range', () => {
    expect([...t.parent]).toEqual([-1, 0, 1, 0])
    expect([...t.depth]).toEqual([0, 1, 2, 1])
    expect([...t.size]).toEqual([4, 2, 1, 1])
    expect(t.maxDepth).toBe(2)
    expect([t.kind(0), t.kind(1), t.kind(2)]).toEqual([KIND_APP, KIND_ABS, KIND_VAR])
    expect(t.contains(1, 2)).toBe(true)
    expect(t.contains(1, 3)).toBe(false)
    expect(t.contains(0, 3)).toBe(true)
  })

  it('keys a node by its path, in the core Dir letters', () => {
    expect(t.key(0)).toBe('')
    expect(t.key(2)).toBe('LB')
    expect(t.key(3)).toBe('R')
  })

  it('finds the nearest linked ancestor, and every node linked to a construct', () => {
    const linked = new Tree(wireOf('(\\x. x x) y', { links: { 0: 7, 3: 9 } }))
    expect(linked.linkedAncestor(2)).toBe(7)
    expect(linked.linkedAncestor(3)).toBe(9)
    expect(linked.nodesLinkedTo(7)).toEqual([0])
    expect(new Tree(wireOf('x')).linkedAncestor(0)).toBeNull()
  })

  it('reads numerals by structure and by their binders’ hints', () => {
    expect(new Tree(wireOf('\\f. \\x. f (f (f x))')).chip(0)).toEqual({ kind: 'numeral', value: 3 })
    expect(new Tree(wireOf('\\f. \\x. x')).chip(0)).toEqual({ kind: 'numeral', value: 0 })
    expect(new Tree(wireOf('\\a. \\b. a (a b)')).chip(0)).toBeNull()
    expect(new Tree(wireOf('\\f. \\x. f x x')).chip(0)).toBeNull()
    // A copy's hints are its printed names, freshened digits and all.
    expect(new Tree(wireOf('\\f0. \\x1. f0 x1')).chip(0)).toEqual({ kind: 'numeral', value: 1 })
    expect(new Tree(wireOf('\\t2. \\f0. f0')).chip(0)).toEqual({ kind: 'bool', value: false })
    expect(new Tree(wireOf('\\f. \\x. x f')).chip(0)).toBeNull()
  })

  it('reads booleans only under t and f binders — false and 0 are one term, told apart by hint', () => {
    expect(new Tree(wireOf('\\t. \\f. t')).chip(0)).toEqual({ kind: 'bool', value: true })
    expect(new Tree(wireOf('\\t. \\f. f')).chip(0)).toEqual({ kind: 'bool', value: false })
    expect(new Tree(wireOf('\\p. \\q. q')).chip(0)).toBeNull()
  })

  it('finds a chip inside a larger term', () => {
    const inner = new Tree(wireOf('g (\\f. \\x. f x)'))
    expect(inner.chip(2)).toEqual({ kind: 'numeral', value: 1 })
    expect(inner.chip(0)).toBeNull()
  })
})
````

- [ ] **Step 3: Run it to verify it fails.**

Run: `cd web && pnpm run typecheck && pnpm exec vitest run --project node tests/node/lambda-tree.test.ts`
Expected: FAIL — typecheck reports 1 error, `Cannot find module '../../src/lambda-tree'`; run alone, the test file fails to load and no test runs.

- [ ] **Step 4: Write the model.** Create `web/src/lambda-tree.ts`:

````ts
import type { LambdaTreeWire } from './protocol'

/** `LambdaTreeWire.kind`'s values — `redextape-core`'s `viewmodel::tree::KIND_*`. */
export const KIND_VAR = 0
export const KIND_ABS = 1
export const KIND_APP = 2
/** `LambdaTreeWire.link`'s "no construct" — `viewmodel::tree::NO_LINK`, `u32::MAX`. */
export const NO_LINK = 0xffff_ffff

/** A subterm the view draws abbreviated (spec §5.2). */
export type Chip =
  | { readonly kind: 'numeral'; readonly value: number }
  | { readonly kind: 'bool'; readonly value: boolean }

/**
 * A `LambdaTreeWire` plus what every consumer derives from it once: each node's parent, depth and
 * subtree size, all in two passes and neither recursive.
 *
 * **PRE-ORDER MAKES A SUBTREE ONE INDEX RANGE.** Node `i`'s subtree is exactly `[i, i + size[i])`, so
 * "is this token inside the redex" is two comparisons — which is how every mark in the view is drawn,
 * and how the icicle places a node.
 */
export class Tree {
  readonly wire: LambdaTreeWire
  readonly count: number
  readonly parent: Int32Array
  readonly depth: Uint32Array
  readonly size: Uint32Array
  readonly maxDepth: number
  #keys = new Map<number, string>()

  constructor(wire: LambdaTreeWire) {
    this.wire = wire
    const n = wire.kind.length
    this.count = n
    this.parent = new Int32Array(n).fill(-1)
    this.depth = new Uint32Array(n)
    this.size = new Uint32Array(n)
    let maxDepth = 0
    // FORWARD: a parent precedes its children, so its depth is final before they are reached.
    for (let i = 0; i < n; i += 1) {
      const k = wire.kind[i]
      if (k === KIND_VAR) continue
      const d = (this.depth[i] as number) + 1
      const l = wire.left[i] as number
      this.parent[l] = i
      this.depth[l] = d
      if (k === KIND_APP) {
        const r = wire.right[i] as number
        this.parent[r] = i
        this.depth[r] = d
      }
      if (d > maxDepth) maxDepth = d
    }
    // BACKWARD: children follow their parent, so their sizes are final before it is reached.
    for (let i = n - 1; i >= 0; i -= 1) {
      const k = wire.kind[i]
      let s = 1
      if (k !== KIND_VAR) s += this.size[wire.left[i] as number] as number
      if (k === KIND_APP) s += this.size[wire.right[i] as number] as number
      this.size[i] = s
    }
    this.maxDepth = maxDepth
  }

  kind(i: number): number {
    return this.wire.kind[i] as number
  }

  /** An `Abs`'s body or an `App`'s function. */
  left(i: number): number {
    return this.wire.left[i] as number
  }

  /** An `App`'s argument. */
  right(i: number): number {
    return this.wire.right[i] as number
  }

  /** A `Var`'s de Bruijn index. */
  index(i: number): number {
    return this.wire.left[i] as number
  }

  /** The name the printer writes: a binder's freshened name, or a variable's binder's. */
  name(i: number): string {
    return this.wire.names[this.wire.name[i] as number] ?? ''
  }

  /** A binder's raw hint, before freshening — what chips are read by. */
  hint(i: number): string {
    return this.wire.names[this.wire.hint[i] as number] ?? ''
  }

  link(i: number): number {
    return this.wire.link[i] as number
  }

  contains(i: number, j: number): boolean {
    return j >= i && j < i + (this.size[i] as number)
  }

  /**
   * The path from the root to `i`, one letter per edge — `L`, `R`, `B` for the core's `AppL`, `AppR`,
   * `AbsBody`. A fold is keyed by this, because a node's INDEX moves whenever anything before it in
   * pre-order changes size, and its path does not (spec §5.2).
   */
  key(i: number): string {
    const cached = this.#keys.get(i)
    if (cached !== undefined) return cached
    const dirs: string[] = []
    let at = i
    while (at > 0) {
      const p = this.parent[at] as number
      dirs.push(this.kind(p) === KIND_ABS ? 'B' : this.left(p) === at ? 'L' : 'R')
      at = p
    }
    const key = dirs.reverse().join('')
    this.#keys.set(i, key)
    return key
  }

  /** The construct `i` belongs to: its own link, or its nearest linked ancestor's — the innermost. */
  linkedAncestor(i: number): number | null {
    for (let at = i; at >= 0; at = this.parent[at] as number) {
      const l = this.link(at)
      if (l !== NO_LINK) return l
    }
    return null
  }

  /** Every node that carries construct `id`, ascending. */
  nodesLinkedTo(id: number): number[] {
    const out: number[] = []
    for (let i = 0; i < this.count; i += 1) if (this.wire.link[i] === id) out.push(i)
    return out
  }

  /**
   * The chip `i` is, if any: a Church numeral under binders hinted `f` and `x`, or a boolean under `t` and
   * `f` (spec §5.2). **THE HINT IS THE ONLY THING THAT TELLS `false` FROM `0`** — `λt. λf. f` and
   * `λf. λx. x` are one term — and lowering always writes each with its own pair.
   *
   * **A HINT'S TRAILING DIGITS ARE IGNORED.** Freshening is print-time only, so a lowered term's hints never
   * carry them — but a copy is built by re-parsing printed text, and there the printed, freshened names
   * (`x0`) ARE the hints. Without this a numeral in any copy whose printer had freshened its binders would
   * never read as a chip (found by the prototype's `scratch-app` run).
   */
  chip(i: number): Chip | null {
    if (this.kind(i) !== KIND_ABS) return null
    const inner = this.left(i)
    if (this.kind(inner) !== KIND_ABS) return null
    const outer = this.hint(i).replace(/\d+$/, '')
    const second = this.hint(inner).replace(/\d+$/, '')
    let body = this.left(inner)
    if (outer === 't' && second === 'f') {
      return this.kind(body) === KIND_VAR ? { kind: 'bool', value: this.index(body) === 1 } : null
    }
    if (outer !== 'f' || second !== 'x') return null
    let n = 0
    while (this.kind(body) === KIND_APP) {
      const fn = this.left(body)
      if (this.kind(fn) !== KIND_VAR || this.index(fn) !== 1) return null
      n += 1
      body = this.right(body)
    }
    return this.kind(body) === KIND_VAR && this.index(body) === 0 ? { kind: 'numeral', value: n } : null
  }
}
````

- [ ] **Step 5: Run the test.** `cd web && pnpm exec vitest run --project node tests/node/lambda-tree.test.ts` → `6 passed`; the node tier → `618 passed`.

- [ ] **Step 6: Sabotage, one at a time, reverting after each:**

| Sabotage | Fails |
|---|---|
| `if (outer === 't' && second === 'f') {` → `if (false) {` | `reads booleans only under t and f binders…`, `reads numerals by structure…` (`\t2. \f0. f0` stops being `false`) |
| `const outer = this.hint(i).replace(/\d+$/, '')` → `const outer = this.hint(i)` | `reads numerals by structure and by their binders’ hints` |
| in `key`: `this.left(p) === at ? 'L' : 'R'` → `… ? 'R' : 'L'` | `keys a node by its path, in the core Dir letters` |
| in `linkedAncestor`: `at >= 0` → `at === i` (look only at the node itself) | `finds the nearest linked ancestor, and every node linked to a construct` |

- [ ] **Step 7: Commit.**

```bash
git add web/src/lambda-tree.ts web/tests/node/tree-fixture.ts web/tests/node/lambda-tree.test.ts
git commit -m "Web: Tree derives parent, depth, size and path keys from the pre-order wire, and reads numeral and boolean chips by structure and hint"
```

---

### Task 6: The *code* and *outline* layouts

**Files:**
- Create: `web/src/lambda-layout.ts`
- Test: `web/tests/node/lambda-layout.test.ts`

**Interfaces:**
- Consumes: Task 5's `Tree`, `Chip`, `KIND_*`.
- Produces: `type Vars = 'names' | 'debruijn'`; `type TokenKind = 'binder' | 'ident' | 'punct' | 'keyword' | 'chip' | 'fold'`; `type Token = { text; kind; node }`; `type Line = { indent; level; tokens; disclose }`; `type LayoutOptions = { width; vars; open(node): boolean }`; `OUTLINE_INLINE = 48`; `shownChip(t, i, o): Chip | null`; `chipText(c): string`; `widths(t, o): Uint32Array`; `codeLines(t, o): Line[]`; `outlineLines(t, o): Line[]`; `lineText(line): string`; `lineOf(t, lines, node): number`.

**The layout recurses only through nodes that are open and too wide for one line.** Widths are computed backwards over the pre-order index without recursing, an application's spine is flattened by a loop, and a node that fits is written by `inline`, whose depth the line width bounds. Task 8's browser tripwire (a 600-element list at the depth its reduction reaches) holds this.

**A line carries the outermost node that starts on it.** When an application's head breaks, the head's first line is the application's first line, and its `▾` folds the application; the head is folded from its own binders' line only when it starts one.

- [ ] **Step 1: Write the failing test.** Create `web/tests/node/lambda-layout.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import {
  codeLines,
  type LayoutOptions,
  type Line,
  lineOf,
  lineText,
  outlineLines,
  widths,
} from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import { wireOf } from './tree-fixture'

const opts = (width: number, over: Partial<LayoutOptions> = {}): LayoutOptions => ({
  width,
  vars: 'names',
  open: () => true,
  ...over,
})
const texts = (lines: readonly Line[]) => lines.map(lineText)
const indents = (lines: readonly Line[]) => lines.map((l) => l.indent)

describe('codeLines', () => {
  it('writes a term that fits on one line exactly as the printer does', () => {
    expect(texts(codeLines(new Tree(wireOf('(\\x. x) y')), opts(80)))).toEqual(['(λx. x) y'])
    expect(texts(codeLines(new Tree(wireOf('f (g x) (\\y. y)')), opts(80)))).toEqual(['f (g x) (λy. y)'])
  })

  it('merges curried binders by name, and writes indices by de Bruijn', () => {
    const t = new Tree(wireOf('\\x. \\y. x'))
    expect(texts(codeLines(t, opts(80)))).toEqual(['λx y. x'])
    expect(texts(codeLines(t, opts(80, { vars: 'debruijn' })))).toEqual(['λ. λ. 1'])
  })

  it('measures every one-line term at exactly its written length', () => {
    for (const src of ['(\\x. x) y', 'f (g x) (\\y. y)', '\\x. \\y. x y', 'a (b (c d)) e', '(\\f. f f) (\\g. g)']) {
      const t = new Tree(wireOf(src))
      for (const vars of ['names', 'debruijn'] as const) {
        const [line] = codeLines(t, opts(1000, { vars }))
        expect(lineText(line as Line).length, `${src} (${vars})`).toBe(widths(t, opts(1000, { vars }))[0])
      }
    }
  })

  it('breaks a spine into its head and one argument per line', () => {
    const lines = codeLines(new Tree(wireOf('g (a b c d) (e f g h)')), opts(12))
    expect(texts(lines)).toEqual(['g', '(a b c d)', '(e f g h)'])
    expect(indents(lines)).toEqual([0, 2, 2])
    expect(lines.map((l) => l.disclose)).toEqual([0, -1, -1])
  })

  it('breaks an abstraction into its binders and its body', () => {
    const lines = codeLines(new Tree(wireOf('\\x. f x x x x')), opts(8))
    expect(texts(lines)).toEqual(['λx. ', 'f', 'x', 'x', 'x', 'x'])
    expect(indents(lines)).toEqual([0, 2, 4, 4, 4, 4])
  })

  it('keeps a broken head’s parentheses and gives the line to the outermost node', () => {
    const lines = codeLines(new Tree(wireOf('(\\x. x x x x) y')), opts(8))
    expect(texts(lines)).toEqual(['(λx. ', 'x', 'x', 'x', 'x)', 'y'])
    expect(indents(lines)).toEqual([0, 2, 4, 4, 4, 2])
    expect(lines[0]?.disclose).toBe(0)
  })

  it('folds a closed node to its binders and a count', () => {
    const lines = codeLines(new Tree(wireOf('\\x. f x x x x')), opts(8, { open: (i) => i !== 0 }))
    expect(texts(lines)).toEqual(['λx. … 10 nodes'])
    expect(lines[0]?.disclose).toBe(0)
  })

  it('draws a closed chip as its value and an open one as its λ', () => {
    const t = new Tree(wireOf('(\\f. \\x. f (f x)) (\\t. \\f. f)'))
    const closed = codeLines(t, opts(80, { open: () => false }))
    expect(texts(closed)).toEqual(['2 false'])
    expect(closed[0]?.tokens.filter((k) => k.kind === 'chip').map((k) => k.text)).toEqual(['2', 'false'])
    expect(texts(codeLines(t, opts(80)))).toEqual(['(λf x. f (f x)) (λt f. f)'])
  })

  it('finds the line showing a node, including the fold that hides it', () => {
    const t = new Tree(wireOf('g (a b c d) (e f g h)'))
    const lines = codeLines(t, opts(12))
    const second = t.right(0)
    expect(lineOf(t, lines, second)).toBe(2)
    const f = new Tree(wireOf('\\x. f x x x x'))
    expect(lineOf(f, codeLines(f, opts(8, { open: (i) => i !== 0 })), 5)).toBe(0)
  })
})

describe('outlineLines', () => {
  it('gives a wide spine one row for its head and one per argument, a level deeper', () => {
    const t = new Tree(wireOf('f aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk'))
    const lines = outlineLines(t, opts(80))
    expect(texts(lines)).toEqual(['apply f', ...'abcdefghijk'.split('').map((c) => c.repeat(4))])
    expect(lines.map((l) => l.level)).toEqual([1, ...Array(11).fill(2)])
    expect(lines[0]?.disclose).toBe(0)
  })

  it('writes a narrow subterm as one row', () => {
    expect(texts(outlineLines(new Tree(wireOf('(\\x. x) y')), opts(80)))).toEqual(['(λx. x) y'])
  })
})
````

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd web && pnpm run typecheck && pnpm exec vitest run --project node tests/node/lambda-layout.test.ts`
Expected: FAIL — typecheck reports 7 errors: `Cannot find module '../../src/lambda-layout'`, and six `implicitly has an 'any' type` on callbacks typed through it; run alone, the test file fails to load.

- [ ] **Step 3: Write the layouts.** Create `web/src/lambda-layout.ts`:

````ts
import { type Chip, KIND_ABS, KIND_APP, KIND_VAR, type Tree } from './lambda-tree'

/** How variables are written: by name, or by de Bruijn index (spec §5.1). */
export type Vars = 'names' | 'debruijn'

/** What a token is, which decides its colour and what a click on it does. */
export type TokenKind = 'binder' | 'ident' | 'punct' | 'keyword' | 'chip' | 'fold'

/** One run of text, and the node it belongs to — every mark and every click resolves through `node`. */
export type Token = { readonly text: string; readonly kind: TokenKind; readonly node: number }

/** One laid-out line. */
export type Line = {
  /** Leading indentation, in character cells. */
  readonly indent: number
  /** The line's depth in the outline, from 1 — `aria-level`. Always 1 in the code layout. */
  readonly level: number
  readonly tokens: readonly Token[]
  /** The node this line's `▸`/`▾` opens or folds, or -1 when it has none. */
  readonly disclose: number
}

export type LayoutOptions = {
  /** Characters per line. */
  readonly width: number
  readonly vars: Vars
  /** Whether a foldable node is open. A chip-shaped node is foldable too: closed, it is its chip. */
  readonly open: (node: number) => boolean
}

/** An outline row writes a subterm this narrow or narrower inline, rather than giving it rows of its own. */
export const OUTLINE_INLINE = 48

/** Where a node sits in its parent — the printer's `Role` in `lambda/syntax.rs`, which decides parentheses. */
type Role = 'term' | 'fn' | 'arg'

type MutLine = { indent: number; level: number; tokens: Token[]; disclose: number }

/** The chip `i` is drawn as, or `null` when it is drawn as its λ — a chip only while it is closed. */
export function shownChip(t: Tree, i: number, o: LayoutOptions): Chip | null {
  const chip = t.chip(i)
  return chip === null || o.open(i) ? null : chip
}

/** A chip's text. A numeral's bar is CSS (`.term-chip.tok-nat`), not a combining character. */
export function chipText(c: Chip): string {
  return String(c.value)
}

function varText(t: Tree, i: number, o: LayoutOptions): string {
  return o.vars === 'names' ? t.name(i) : String(t.index(i))
}

/** Whether an `Abs` body continues its parent's binder list — `λx y.` — which only names mode writes. */
function merges(t: Tree, body: number, o: LayoutOptions): boolean {
  return o.vars === 'names' && t.kind(body) === KIND_ABS && shownChip(t, body, o) === null
}

/** The printer's parenthesization: an abstraction anywhere but a term position, an application as an argument. */
function parens(t: Tree, i: number, role: Role, o: LayoutOptions): boolean {
  if (role === 'term' || shownChip(t, i, o) !== null) return false
  const k = t.kind(i)
  return k === KIND_ABS || (k === KIND_APP && role === 'arg')
}

/**
 * Every node's width written on one line in term position, children before parents — BACKWARDS over the
 * pre-order index, so no node is ever reached before its children and nothing recurses.
 */
export function widths(t: Tree, o: LayoutOptions): Uint32Array {
  const w = new Uint32Array(t.count)
  const as = (x: number, r: Role) => (w[x] as number) + (parens(t, x, r, o) ? 2 : 0)
  for (let i = t.count - 1; i >= 0; i -= 1) {
    const chip = shownChip(t, i, o)
    if (chip !== null) {
      w[i] = chipText(chip).length
      continue
    }
    const k = t.kind(i)
    if (k === KIND_VAR) {
      w[i] = varText(t, i, o).length
    } else if (k === KIND_ABS) {
      const b = t.left(i)
      if (o.vars === 'debruijn') w[i] = 3 + (w[b] as number)
      else if (merges(t, b, o)) w[i] = t.name(i).length + 1 + (w[b] as number)
      else w[i] = 3 + t.name(i).length + (w[b] as number)
    } else {
      w[i] = as(t.left(i), 'fn') + 1 + as(t.right(i), 'arg')
    }
  }
  return w
}

/** Write `i`'s binder list — `λx y. ` by name, `λ. ` by index — and return the body it binds. */
function binders(t: Tree, i: number, o: LayoutOptions, out: Token[]): number {
  let at = i
  out.push({ text: 'λ', kind: 'binder', node: at })
  if (o.vars === 'names') {
    out.push({ text: t.name(at), kind: 'binder', node: at })
    while (merges(t, t.left(at), o)) {
      at = t.left(at)
      out.push({ text: ' ', kind: 'punct', node: at }, { text: t.name(at), kind: 'binder', node: at })
    }
  }
  out.push({ text: '. ', kind: 'punct', node: at })
  return t.left(at)
}

/** Write `i` on one line in term position. Called only for a node that fits, so its depth is bounded by the width. */
function inline(t: Tree, i: number, o: LayoutOptions, out: Token[]): void {
  const chip = shownChip(t, i, o)
  if (chip !== null) {
    out.push({ text: chipText(chip), kind: 'chip', node: i })
    return
  }
  const k = t.kind(i)
  if (k === KIND_VAR) {
    out.push({ text: varText(t, i, o), kind: 'ident', node: i })
  } else if (k === KIND_ABS) {
    inline(t, binders(t, i, o, out), o, out)
  } else {
    wrapped(t, t.left(i), 'fn', o, out)
    out.push({ text: ' ', kind: 'punct', node: i })
    wrapped(t, t.right(i), 'arg', o, out)
  }
}

function wrapped(t: Tree, i: number, role: Role, o: LayoutOptions, out: Token[]): void {
  if (!parens(t, i, role, o)) {
    inline(t, i, o, out)
    return
  }
  out.push({ text: '(', kind: 'punct', node: i })
  inline(t, i, o, out)
  out.push({ text: ')', kind: 'punct', node: i })
}

/** A folded node's one line: its binders when it has them, then `… N nodes`. */
function folded(t: Tree, i: number, o: LayoutOptions, paren: boolean): Token[] {
  const out: Token[] = []
  if (paren) out.push({ text: '(', kind: 'punct', node: i })
  if (t.kind(i) === KIND_ABS) binders(t, i, o, out)
  out.push({ text: `… ${t.size[i]} nodes`, kind: 'fold', node: i })
  if (paren) out.push({ text: ')', kind: 'punct', node: i })
  return out
}

/** An application's spine: its head and its arguments in order — `f a b c` is one head and three arguments. */
function spine(t: Tree, i: number): { head: number; args: number[] } {
  const args: number[] = []
  let head = i
  while (t.kind(head) === KIND_APP) {
    args.push(t.right(head))
    head = t.left(head)
  }
  return { head, args: args.reverse() }
}

function close(lines: MutLine[], node: number): void {
  lines[lines.length - 1]?.tokens.push({ text: ')', kind: 'punct', node })
}

/**
 * The *code* layout (spec §5.1): a subterm that fits stays on one line; one that does not writes its head
 * on the first line and its arguments indented below, and an abstraction its binders then its body.
 *
 * **A LINE CARRIES THE OUTERMOST NODE THAT STARTS ON IT.** When an application's head is itself too wide
 * and breaks, the head's first line is the application's first line too; its `▾` folds the application.
 */
export function codeLines(t: Tree, o: LayoutOptions): Line[] {
  const w = widths(t, o)
  const lines: MutLine[] = []
  if (t.count > 0) code(t, o, w, 0, 0, 'term', lines)
  return lines
}

function code(
  t: Tree,
  o: LayoutOptions,
  w: Uint32Array,
  i: number,
  indent: number,
  role: Role,
  lines: MutLine[],
): void {
  const paren = parens(t, i, role, o)
  const k = t.kind(i)
  if (indent + (w[i] as number) + (paren ? 2 : 0) <= o.width || k === KIND_VAR || shownChip(t, i, o) !== null) {
    const tokens: Token[] = []
    wrapped(t, i, role, o, tokens)
    lines.push({ indent, level: 1, tokens, disclose: -1 })
    return
  }
  if (!o.open(i)) {
    lines.push({ indent, level: 1, tokens: folded(t, i, o, paren), disclose: i })
    return
  }
  if (k === KIND_ABS) {
    const head: Token[] = paren ? [{ text: '(', kind: 'punct', node: i }] : []
    const body = binders(t, i, o, head)
    lines.push({ indent, level: 1, tokens: head, disclose: i })
    code(t, o, w, body, indent + 2, 'term', lines)
    if (paren) close(lines, i)
    return
  }
  const { head, args } = spine(t, i)
  const inner = indent + (paren ? 1 : 0)
  const start = lines.length
  if (inner + (w[head] as number) + (parens(t, head, 'fn', o) ? 2 : 0) <= o.width) {
    const tokens: Token[] = []
    wrapped(t, head, 'fn', o, tokens)
    lines.push({ indent: inner, level: 1, tokens, disclose: -1 })
  } else {
    code(t, o, w, head, inner, 'fn', lines)
  }
  const first = lines[start] as MutLine
  first.indent = indent
  first.disclose = i
  if (paren) first.tokens.unshift({ text: '(', kind: 'punct', node: i })
  for (const a of args) code(t, o, w, a, indent + 2, 'arg', lines)
  if (paren) close(lines, i)
}

/**
 * The *outline* layout (spec §5.1): one row per node, children indented a level, an application's spine
 * flattened to `apply head` with its arguments as child rows. A subterm narrower than `OUTLINE_INLINE`
 * is one row, so the outline shows structure where there is structure to show.
 */
export function outlineLines(t: Tree, o: LayoutOptions): Line[] {
  const w = widths(t, o)
  const lines: MutLine[] = []
  if (t.count > 0) outline(t, o, w, 0, 1, lines)
  return lines
}

function outline(t: Tree, o: LayoutOptions, w: Uint32Array, i: number, level: number, lines: MutLine[]): void {
  const indent = (level - 1) * 2
  const k = t.kind(i)
  const width = w[i] as number
  if (k === KIND_VAR || shownChip(t, i, o) !== null || (width <= OUTLINE_INLINE && indent + width <= o.width)) {
    const tokens: Token[] = []
    inline(t, i, o, tokens)
    lines.push({ indent, level, tokens, disclose: -1 })
    return
  }
  if (!o.open(i)) {
    lines.push({ indent, level, tokens: folded(t, i, o, false), disclose: i })
    return
  }
  if (k === KIND_ABS) {
    const head: Token[] = []
    const body = binders(t, i, o, head)
    lines.push({ indent, level, tokens: head, disclose: i })
    outline(t, o, w, body, level + 1, lines)
    return
  }
  const { head, args } = spine(t, i)
  const row: Token[] = [{ text: 'apply', kind: 'keyword', node: i }]
  const headInline = (w[head] as number) <= OUTLINE_INLINE
  if (headInline) {
    row.push({ text: ' ', kind: 'punct', node: i })
    wrapped(t, head, 'fn', o, row)
  }
  lines.push({ indent, level, tokens: row, disclose: i })
  if (!headInline) outline(t, o, w, head, level + 1, lines)
  for (const a of args) outline(t, o, w, a, level + 1, lines)
}

/** A line's text, as a reader sees it. */
export function lineText(line: Line): string {
  return line.tokens.map((x) => x.text).join('')
}

/**
 * The first line showing `node`: one with a token inside its subtree, or the fold that hides it. -1 when
 * no line shows it.
 */
export function lineOf(t: Tree, lines: readonly Line[], node: number): number {
  for (const [l, line] of lines.entries()) {
    for (const tok of line.tokens) {
      if (t.contains(node, tok.node) || (tok.kind === 'fold' && t.contains(tok.node, node))) return l
    }
  }
  return -1
}
````

- [ ] **Step 4: Run the test.** `cd web && pnpm exec vitest run --project node tests/node/lambda-layout.test.ts` → `11 passed`; the node tier → `629 passed`.

- [ ] **Step 5: Sabotage, one at a time, reverting after each:**

| Sabotage | Fails |
|---|---|
| `w[i] = t.name(i).length + 1 + (w[b] as number)` → `+ 2 +` (a merged binder one column too wide) | `measures every one-line term at exactly its written length` |
| `return k === KIND_ABS \|\| (k === KIND_APP && role === 'arg')` → `return (k === KIND_ABS && role === 'arg') \|\| (k === KIND_APP && role === 'arg')` | four: `draws a closed chip as its value…`, `keeps a broken head’s parentheses…`, `writes a narrow subterm as one row`, `writes a term that fits on one line exactly as the printer does` |
| `first.disclose = i` → `first.disclose = first.disclose < 0 ? i : first.disclose` | `keeps a broken head’s parentheses and gives the line to the outermost node` |
| both `if (!o.open(i)) {` → `if (false && !o.open(i)) {` | `finds the line showing a node…`, `folds a closed node to its binders and a count` |
| delete ` \|\| (tok.kind === 'fold' && t.contains(tok.node, node))` | `finds the line showing a node, including the fold that hides it` |

- [ ] **Step 6: Commit.**

```bash
git add web/src/lambda-layout.ts web/tests/node/lambda-layout.test.ts
git commit -m "Web: the code and outline layouts turn a Tree into lines of tokens, writing one-line terms exactly as the printer does"
```

---

### Task 7: Folds — the automatic policy and the user's overrides

**Files:**
- Create: `web/src/lambda-folds.ts`
- Test: `web/tests/node/lambda-folds.test.ts`

**Interfaces:**
- Consumes: Task 5's `Tree`.
- Produces: `AUTO_FOLD_NODES = 200`; `autoOpen(t, i): boolean`; `class Folds { version; isOpen(t, i); toggle(t, i); advance(t); reset() }` (Task 11 adds `reveal`).

**THE CHIP TEST COMES FIRST.** The prototype asked about the root first, and every finished numeric run drew its answer as `λf x. f (f (f …` instead of its value. A chip can never hold the next redex — it is a normal form — so asking it first costs the redex rule nothing.

- [ ] **Step 1: Write the failing test.** Create `web/tests/node/lambda-folds.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import { AUTO_FOLD_NODES, autoOpen, Folds } from '../../src/lambda-folds'
import { Tree } from '../../src/lambda-tree'
import { wireOf } from './tree-fixture'

/** `f x x … x` with `n` arguments: an application spine of `2n + 1` nodes. */
const wide = (n: number) => `f ${Array(n).fill('x').join(' ')}`

describe('autoOpen', () => {
  it('opens the root, anything holding the next redex, and anything small; closes chips', () => {
    const big = wide(AUTO_FOLD_NODES)
    const t = new Tree(wireOf(`g (${big}) ((\\y. y) z) (\\f. \\x. f x)`))
    const bigNode = t.right(t.left(t.left(0)))
    expect(t.size[bigNode]).toBeGreaterThan(AUTO_FOLD_NODES)
    expect(autoOpen(t, 0)).toBe(true)
    expect(autoOpen(t, bigNode)).toBe(false)
    const redexArg = t.right(t.left(0))
    expect(t.wire.nextRedex).toBe(redexArg)
    expect(autoOpen(t, redexArg)).toBe(true)
    expect(autoOpen(t, t.right(0))).toBe(false)
  })

  it('closes a chip even at the root, so a finished run reads as its value', () => {
    expect(autoOpen(new Tree(wireOf('\\f. \\x. f (f x)')), 0)).toBe(false)
    expect(autoOpen(new Tree(wireOf('\\y. y')), 0)).toBe(true)
  })

  it('opens a large subterm when the next redex is inside it', () => {
    const t = new Tree(wireOf(`g (${wide(AUTO_FOLD_NODES)} ((\\y. y) z))`))
    const arg = t.right(0)
    expect(t.size[arg]).toBeGreaterThan(AUTO_FOLD_NODES)
    expect(autoOpen(t, arg)).toBe(true)
  })
})

describe('Folds', () => {
  it('toggles against the automatic policy and bumps its version', () => {
    const t = new Tree(wireOf('g (a b) (c d)'))
    const f = new Folds()
    const v = f.version
    expect(f.isOpen(t, 1)).toBe(true)
    f.toggle(t, 1)
    expect(f.isOpen(t, 1)).toBe(false)
    expect(f.version).toBeGreaterThan(v)
    f.reset()
    expect(f.isOpen(t, 1)).toBe(true)
  })

  it('keeps an override across a step outside the redex and drops one inside it', () => {
    // Step 1: `k (a b) ((\y. y) (c d))` — the redex is the second argument, at path R.
    const before = new Tree(wireOf('k (a b) ((\\y. y) (c d))', { step: 1 }))
    const f = new Folds()
    f.advance(before)
    const outside = before.right(before.left(0))
    const inside = before.right(before.right(0))
    f.toggle(before, outside)
    f.toggle(before, inside)
    // Step 2 contracts it: `k (a b) (c d)`, the contractum (node 6) at the path the redex had.
    const after = new Tree(wireOf('k (a b) (c d)', { step: 2, contractum: 6 }))
    expect(after.key(6)).toBe(before.key(before.right(0)))
    f.advance(after)
    expect(f.isOpen(after, after.right(after.left(0)))).toBe(false)
    expect(after.key(after.right(6))).toBe(before.key(inside))
    expect(f.isOpen(after, after.right(6))).toBe(true)
  })

  it('keeps every override across a jump, since it cannot know what the jump rewrote', () => {
    const t = new Tree(wireOf('k (a b) ((\\y. y) (c d))', { step: 1 }))
    const f = new Folds()
    f.advance(t)
    f.toggle(t, t.right(0))
    const later = new Tree(wireOf('k (a b) (c d)', { step: 9, contractum: 6 }))
    f.advance(later)
    expect(f.isOpen(later, 6)).toBe(false)
  })
})
````

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd web && pnpm run typecheck && pnpm exec vitest run --project node tests/node/lambda-folds.test.ts`
Expected: FAIL — typecheck reports 1 error, `Cannot find module '../../src/lambda-folds'`; run alone, the test file fails to load.

- [ ] **Step 3: Write the folds.** Create `web/src/lambda-folds.ts`:

````ts
import type { Tree } from './lambda-tree'

/** A subterm larger than this starts folded, unless the next redex is inside it (spec §5.2). */
export const AUTO_FOLD_NODES = 200

/**
 * Whether node `i` starts open: a chip never, so a numeral reads as its value — the root included, which
 * is what a finished run's `42` is; the root otherwise always; anything holding the next redex, so the path
 * to it is always drawn; anything else while it is small.
 *
 * **THE CHIP TEST COMES FIRST.** The prototype asked about the root first, and every finished numeric
 * run drew its answer as `λf x. f (f (f …` instead of its value. A chip can never hold the next redex —
 * it is a normal form — so asking it first costs the redex rule nothing.
 */
export function autoOpen(t: Tree, i: number): boolean {
  if (t.chip(i) !== null) return false
  if (i === 0) return true
  const r = t.wire.nextRedex
  if (r !== null && t.contains(i, r)) return true
  return (t.size[i] as number) <= AUTO_FOLD_NODES
}

/**
 * One view's folds: the automatic policy, and whatever the user opened or folded by hand.
 *
 * **AN OVERRIDE IS KEYED BY PATH, NOT BY NODE INDEX.** An index moves whenever anything earlier in
 * pre-order changes size; a path names the same position in the next step's term unless that step
 * rewrote it. A β-step rewrites only its redex's subtree, so stepping by one drops the overrides under
 * that step's contractum and keeps every other (spec §5.2). Across a jump of several steps the view does
 * not know the intermediate redexes and keeps any override whose path still resolves — the imprecision
 * the spec accepts rather than a replay it would pay for.
 */
export class Folds {
  #overrides = new Map<string, boolean>()
  #step: number | null = null
  #version = 0

  /** Bumped whenever the set of open nodes may have changed — a layout cache keys on it. */
  get version(): number {
    return this.#version
  }

  isOpen(t: Tree, i: number): boolean {
    return this.#overrides.get(t.key(i)) ?? autoOpen(t, i)
  }

  toggle(t: Tree, i: number): void {
    this.#overrides.set(t.key(i), !this.isOpen(t, i))
    this.#version += 1
  }

  /** Called with every tree the view draws. One step on from the last, it drops what that step rewrote. */
  advance(t: Tree): void {
    const step = t.wire.step
    if (step === this.#step) return
    const c = t.wire.contractum
    if (this.#step !== null && step === this.#step + 1 && c !== null) {
      const under = t.key(c)
      for (const k of [...this.#overrides.keys()]) if (k.startsWith(under)) this.#overrides.delete(k)
    }
    this.#step = step
    this.#version += 1
  }

  reset(): void {
    this.#overrides.clear()
    this.#version += 1
  }
}
````

- [ ] **Step 4: Run the test.** `cd web && pnpm exec vitest run --project node tests/node/lambda-folds.test.ts` → `6 passed`; the node tier → `635 passed`.

- [ ] **Step 5: Sabotage, one at a time, reverting after each:**

| Sabotage | Fails |
|---|---|
| `if (this.#step !== null && step === this.#step + 1 && c !== null) {` → `if (false) {` (never prune) | `keeps an override across a step outside the redex and drops one inside it` |
| delete ` && step === this.#step + 1` (prune on a jump too) | `keeps every override across a jump, since it cannot know what the jump rewrote` |
| `if (r !== null && t.contains(i, r)) return true` → `if (r !== null && r === i) return true` | `opens a large subterm when the next redex is inside it` |
| delete `if (t.chip(i) !== null) return false` | `closes a chip even at the root…`, `opens the root, anything holding the next redex, and anything small; closes chips` |
| swap the chip line and the `if (i === 0) return true` line | `closes a chip even at the root, so a finished run reads as its value` |

- [ ] **Step 6: Commit.**

```bash
git add web/src/lambda-folds.ts web/tests/node/lambda-folds.test.ts
git commit -m "Web: Folds keeps the path to the next redex open, folds the rest past 200 nodes, and keys overrides by path so a step keeps them"
```

---

### Task 8: The λ view draws the tree

**Files:**
- Create: `web/src/lambda-body.ts`
- Create: `web/tests/browser/lambda-text.ts` (test helper), `web/tests/browser/lambda-body.test.ts`, `web/tests/browser/lambda-display.test.ts`, `web/tests/browser/lambda-tree-app.test.ts`
- Modify: `web/src/lambda-pane.ts` (a `LambdaBody` replaces the `<pre>`; `renderTree`; layout through `codeLines` with a `Folds`; folds reset on a rebind and on a new build)
- Modify: `web/src/draw.ts` (the `trees` dependency; each connected view is given its build and its displayed step's tree)
- Modify: `web/src/main.ts` (pass `trees` to `createDraw`)
- Modify: `web/src/style.css` (the body's rules; `.is-redex` becomes `.is-contractum`; `.is-next-redex`)
- Modify the existing tests that read the λ view: `app`, `buffer-cool-warm`, `marks`, `scratch-app`, `scratch-buffers`, `scratch-edit`, `scratch-fork`, `step-bar`, `two-lambda-panes`, `view-title` (all under `web/tests/browser/`)

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces: `LINE_HEIGHT = 20`; `type BodyEvents = { toggle(node); link(node); scrolled?() }`; `flatText(frame, note): Node[]`; `class LambdaBody { el; columns(); following; visible: { first; last }; attach(); reveal(line); showTree(tree, lines, outline, linked, stale); showText(frame, note); showFlat(nodes) }`; `LambdaPane.renderTree(treeFor: TreeFor): void`; `LambdaPane.setBuild(build: number | null): void`; `createDraw({ …, trees: LambdaTrees })`; test helpers `lambdaSettled(leaf?, readout?)` and `asShown(printed)`.

**`.term` STAYS THE BODY'S ELEMENT, IN EVERY MODE, AND ITS TEXT IS ONLY THE TERM.** Most existing tests read the λ view as `.term`'s text. Before a step's tree arrives, and when one is refused, the body shows the frame's flat text exactly as today. Once the tree is drawn, `.term`'s text is the laid-out term and nothing else: the width is measured on a canvas, the gutter's `▸`/`▾` and the screen-reader mark words are CSS generated content, and indentation is padding. The prototype first had all four as text nodes, and every test reading the term read them. Only the element's role changes: `list` (code), `tree` (outline), `region` (flat).

**THE EXISTING TESTS CHANGE IN ONE OF THREE WAYS.** A test that reads the view waits for the displayed step's tree with `lambdaSettled()`, because a stale tree is shown while the new one is asked for. A test that compares with printer text compares with `asShown(printed)`, since the view merges binders and a chip reads as its value. And `.is-redex` becomes `.is-contractum` (the old class marked what the step produced, so the new name says so). `scratch-fork`'s truncated-frame test stops asserting `.truncated` on screen: the tree is the whole term, and the 512-byte frame shows only until it arrives.

**THE STEP-0 LINK WINDOW SURVIVES THIS TASK AND GOES IN TASK 9.** Until then, `LambdaPane` renders the window into the body with `showFlat`, and its `data-at` click listener moves from the `<pre>` to `body.el`. That keeps every link test green across this commit.

**FOLDS START OVER ON A NEW TERM.** `setBindings` resets them when the view is bound to another session, and `setBuild` — called by `draw()` every frame with `LambdaTrees.buildOf` — resets them when a new compile rebuilds the same session. A path in one term names nothing in another's. The prototype had the first without a test (a sabotage showed no test could see it) and did not have the second at all; `lambda-display.test.ts` and `lambda-tree-app.test.ts` now hold both.

- [ ] **Step 1: Write the failing tests.** Create `web/tests/browser/lambda-text.ts`:

````ts
import { codeLines, lineText } from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import { wireOf } from '../node/tree-fixture'
import { until } from './harness'

/**
 * Wait until the λ view in `leaf` draws the tree for the step its controls show — not the last step's
 * tree, which it keeps showing (marked stale) until this step's arrives, and not the flat frame it shows
 * before any tree has come back (Plan 7 part 4a). A test that reads the λ view right after stepping reads
 * a moment the view has not caught up with, one worker round trip long. `readout` is where the step is
 * shown — the view's own controls by default, the step bar's under a preset that moves them there.
 */
export async function lambdaSettled(
  leaf = 'lambda-0',
  readout = (): string => document.querySelector(`[data-leaf="${leaf}"] .step`)?.textContent ?? '',
): Promise<void> {
  await until(() => {
    const term = document.querySelector<HTMLElement>(`[data-leaf="${leaf}"] .term`)
    const step = readout()
      .match(/step ([\d,]+)/)?.[1]
      ?.replaceAll(',', '')
    return term?.dataset.stale === undefined && step !== undefined && term?.dataset.step === step
  }, `the λ view in ${leaf} to draw its own step's tree`)
}

/**
 * How the λ view writes `printed` — the printer's text for a term — on one line: binders merged, numerals
 * and booleans as chips. A test that compares the view with printed text (an editor's text of record, a
 * copy's seed) compares it with this.
 */
export function asShown(printed: string): string {
  const t = new Tree(wireOf(printed))
  return codeLines(t, { width: 100_000, vars: 'names', open: (i) => t.chip(i) === null })
    .map(lineText)
    .join('')
}
````

Create `web/tests/browser/lambda-body.test.ts`:

````ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaBody, LINE_HEIGHT } from '../../src/lambda-body'
import { codeLines, type LayoutOptions, outlineLines } from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import type { LambdaState } from '../../src/types'
import { wireOf } from '../node/tree-fixture'

const opts = (width: number): LayoutOptions => ({ width, vars: 'names', open: () => true })

function mount() {
  const toggle = vi.fn()
  const link = vi.fn()
  const body = new LambdaBody({ toggle, link })
  const host = document.createElement('section')
  host.className = 'pane lambda-body-fixture'
  host.style.width = '640px'
  host.append(body.el)
  document.body.append(host)
  return { body, toggle, link }
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .term-line')]
/** A row's text: its tokens — the gutter and the marks' words are CSS, not text. */
const shown = (row: HTMLElement) => row.textContent ?? ''

/** `f a0 a1 … a{n-1}`, then a redex last — a spine that breaks one argument per line at a narrow width. */
const long = (n: number) => `f ${Array.from({ length: n }, (_, i) => `a${i}`).join(' ')} ((\\y. y) z)`

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-body-fixture')) el.remove()
})

describe('LambdaBody', () => {
  it('draws each laid-out line as one row of the fixed line height, in a list', () => {
    const { body } = mount()
    const t = new Tree(wireOf('g (a b c d) (e f g h)'))
    body.showTree(t, codeLines(t, opts(12)), false, [], false)
    expect(rows().map(shown)).toEqual(['g', '(a b c d)', '(e f g h)'])
    expect(body.el.getAttribute('role')).toBe('list')
    for (const r of rows()) {
      expect(r.getBoundingClientRect().height).toBe(LINE_HEIGHT)
      expect(r.getAttribute('role')).toBe('listitem')
      expect(r.getAttribute('aria-setsize')).toBe('3')
    }
  })

  it('is a tree of levelled items in the outline', () => {
    const { body } = mount()
    const t = new Tree(wireOf('f aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk'))
    body.showTree(t, outlineLines(t, opts(80)), true, [], false)
    expect(body.el.getAttribute('role')).toBe('tree')
    expect(rows().map((r) => r.getAttribute('aria-level'))).toEqual(['1', ...Array(11).fill('2')])
    expect(rows()[0]?.getAttribute('aria-expanded')).toBe('true')
  })

  it('marks the next redex and the contractum each with its own shape, and says so to a screen reader', () => {
    const { body } = mount()
    // `k ((\y. y) z) (w v)`: the redex is node 3; say the last step produced node 7, `(w v)`.
    const t = new Tree(wireOf('k ((\\y. y) z) (w v)', { contractum: 7 }))
    body.showTree(t, codeLines(t, opts(80)), false, [], false)
    const redex = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .is-next-redex')]
    expect(redex.map((s) => s.textContent).join('')).toBe('((λy. y) z)')
    expect(getComputedStyle(redex[0] as HTMLElement).outlineStyle).toBe('dashed')
    const made = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .is-contractum')]
    expect(made.map((s) => s.textContent).join('')).toBe('(w v)')
    expect(getComputedStyle(made[0] as HTMLElement).boxShadow).toContain('inset')
    const labels = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture [data-marks]')].map(
      (l) => l.dataset.marks,
    )
    expect(labels).toEqual(['next redex: ', 'just produced: '])
    const said = getComputedStyle(
      document.querySelector('.lambda-body-fixture [data-marks]') as Element,
      '::before',
    ).content
    expect(said).toBe('"next redex: "')
    expect(body.el.textContent).not.toContain('next redex')
  })

  it('marks linked nodes', () => {
    const { body } = mount()
    const t = new Tree(wireOf('k (a b) (c d)'))
    body.showTree(t, codeLines(t, opts(80)), false, [6], false)
    const linked = [...document.querySelectorAll('.lambda-body-fixture .is-linked')].map((s) => s.textContent).join('')
    expect(linked).toBe('(c d)')
  })

  it('says a tree for another step is stale while it waits', () => {
    const { body } = mount()
    const t = new Tree(wireOf('x', { step: 4 }))
    body.showTree(t, codeLines(t, opts(80)), false, [], true)
    expect(body.el.dataset.stale).toBe('true')
    expect(body.el.getAttribute('aria-busy')).toBe('true')
    expect(body.el.dataset.step).toBe('4')
    body.showTree(t, codeLines(t, opts(80)), false, [], false)
    expect(body.el.dataset.stale).toBeUndefined()
    expect(body.el.hasAttribute('aria-busy')).toBe(false)
  })

  it('falls back to the frame’s flat text, with a note when there is one', () => {
    const { body } = mount()
    const frame: LambdaState = { text: 'λx. x', spans: [], cut: null, step: 3, redex_span: null, owner: 'None' }
    body.showText(frame, 'this step’s term has 40,000 nodes — shown as text')
    expect(body.el.getAttribute('role')).toBe('region')
    expect(rows()).toHaveLength(0)
    expect(body.el.querySelector('.term-flat')?.textContent).toContain('λx. x')
    expect(body.el.querySelector('.term-note')?.textContent).toContain('40,000 nodes')
  })

  it('marks a flat frame’s contractum by converting its byte span, not by slicing it as UTF-16', () => {
    const { body } = mount()
    // `λ` is two bytes and one UTF-16 unit, so a byte span sliced as UTF-16 lands one unit late per `λ`.
    const text = 'λf. (λx0. f (f x0))'
    const frame: LambdaState = {
      text,
      spans: [
        [{ start: 0, end: 2 }, 'Binder'],
        [{ start: 2, end: 3 }, 'Binder'],
        [{ start: 5, end: 6 }, 'Punct'],
        [{ start: 6, end: 8 }, 'Binder'],
        [{ start: 8, end: 10 }, 'Binder'],
        [{ start: 10, end: 11 }, 'Punct'],
        [{ start: 12, end: 13 }, 'Ident'],
        [{ start: 14, end: 15 }, 'Punct'],
        [{ start: 15, end: 16 }, 'Ident'],
        [{ start: 17, end: 19 }, 'Ident'],
        [{ start: 19, end: 21 }, 'Punct'],
      ],
      cut: null,
      step: 6,
      redex_span: { start: 5, end: 21 },
      owner: 'None',
    }
    body.showText(frame, null)
    const lit = [...body.el.querySelectorAll('.is-contractum')].map((e) => e.textContent).join('')
    expect(lit).toBe('(λx0.f(fx0))')
  })

  it('opens and folds from the gutter and a chip, and links from any other token', () => {
    const { body, toggle, link } = mount()
    const t = new Tree(wireOf('g (\\f. \\x. f x) (a b c d)'))
    body.showTree(t, codeLines(t, { width: 12, vars: 'names', open: (i) => t.chip(i) === null }), false, [], false)
    document.querySelector<HTMLElement>('.lambda-body-fixture .term-gutter[data-node]')?.click()
    expect(toggle).toHaveBeenLastCalledWith(0)
    document.querySelector<HTMLElement>('.lambda-body-fixture .term-chip')?.click()
    expect(toggle).toHaveBeenLastCalledWith(t.right(t.left(0)))
    const b = [...document.querySelectorAll<HTMLElement>('.lambda-body-fixture .tok-ident')].find(
      (s) => s.textContent === 'b',
    )
    b?.click()
    expect(link).toHaveBeenCalledWith(Number(b?.dataset.node))
  })

  it('moves one active row by keyboard, and folds and opens it with the arrows', () => {
    const { body, toggle, link } = mount()
    const t = new Tree(wireOf('g (a b c d) (e f g h)'))
    body.showTree(t, codeLines(t, opts(12)), false, [], false)
    body.el.focus()
    const active = () => body.el.getAttribute('aria-activedescendant')
    expect(active()).toBe(rows()[0]?.id)
    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(active()).toBe(rows()[1]?.id)
    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(toggle).toHaveBeenLastCalledWith(0)
    body.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(link).toHaveBeenCalledWith(2)
  })

  it('keeps following when a shorter term clamps the scroll position', () => {
    const { body } = mount()
    const t = new Tree(wireOf(long(400)))
    body.showTree(t, codeLines(t, opts(20)), false, [], false)
    expect(body.el.scrollTop).toBeGreaterThan(0)
    const short = new Tree(wireOf('\\f. \\x. f (f x)'))
    body.showTree(short, codeLines(short, opts(20)), false, [], false)
    body.el.dispatchEvent(new Event('scroll'))
    expect(body.following).toBe(true)
    body.showTree(t, codeLines(t, opts(20)), false, [], false)
    expect(body.el.scrollTop).toBeGreaterThan(0)
  })

  it('draws only the rows in view, and follows the next redex until the user scrolls away', () => {
    const { body } = mount()
    const t = new Tree(wireOf(long(400)))
    const lines = codeLines(t, opts(20))
    expect(lines.length).toBeGreaterThan(400)
    body.showTree(t, lines, false, [], false)
    expect(rows().length).toBeLessThan(lines.length)
    expect(body.el.scrollTop).toBeGreaterThan(0)
    expect(document.querySelector('.lambda-body-fixture .is-next-redex')).not.toBeNull()
    body.el.scrollTop = 0
    body.el.dispatchEvent(new Event('scroll'))
    expect(body.following).toBe(false)
    body.attach()
    expect(body.following).toBe(true)
    expect(body.el.scrollTop).toBeGreaterThan(0)
  })
})
````

Create `web/tests/browser/lambda-display.test.ts` (Task 10 grows it into the display settings' file):

````ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { PaneOption } from '../../src/sessions'
import type { LambdaState } from '../../src/types'
import { wireOf } from '../node/tree-fixture'

/**
 * How a λ view carries its folds from frame to frame (Plan 7 part 4a), and the reset a new binding makes.
 * Panes are built directly, as `lambda-pane-editor`'s are — nothing here needs `main()`.
 */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane lambda-display-fixture'
  el.style.width = '640px'
  document.body.append(el)
  return el
}

const events = (): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
})

const frame: LambdaState = { text: 'λx. λy. x', spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }
const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

const option = (id: string): PaneOption => ({ leg: 'lambda', id, label: id })
const WIDE = `g ${Array.from({ length: 40 }, (_, i) => `(a${i} b${i})`).join(' ')}`

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-display-fixture')) el.remove()
})

describe('a λ view’s folds across bindings', () => {
  /**
   * A NEW BINDING STARTS FROM THE AUTOMATIC FOLDS. Folds are keyed by path, and a path in one session's term
   * names nothing in another's — the prototype carried a copy's folds home onto the program's tree, and no
   * app-level test noticed. `setBindings` runs every frame, so the same binding must keep them.
   */
  it('keeps its folds while bound to one session, and starts another from the automatic policy', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    const bind = (session: string) => pane.setBindings([option('source'), option('copy')], { leg: 'lambda', session })
    bind('source')
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const lines = () => el.querySelectorAll('.term-line').length
    const open = lines()
    expect(open).toBeGreaterThan(1)
    el.querySelector<HTMLElement>('.term-gutter[data-node="0"]')?.click()
    expect(lines()).toBe(1)

    bind('source')
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'the same binding, one frame later').toBe(1)

    bind('copy')
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'another session’s term').toBe(open)
  })

  it('keeps its folds through one build, and starts a new build of the same session from the automatic policy', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.setBuild(1)
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const lines = () => el.querySelectorAll('.term-line').length
    const open = lines()
    el.querySelector<HTMLElement>('.term-gutter[data-node="0"]')?.click()
    expect(lines()).toBe(1)

    pane.setBuild(1)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'the same build, one frame later').toBe(1)

    pane.setBuild(2)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'a new build').toBe(open)
  })
})
````

Create `web/tests/browser/lambda-tree-app.test.ts`:

````ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * The λ view drawing the worker's tree end to end: the real worker, the real wasm, `draw()` asking
 * `LambdaTrees` for the displayed step (Plan 7 part 4a).
 */
const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)'

let view: EditorView

const term = () => document.querySelector<HTMLElement>('[data-leaf="lambda-0"] .term')
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-leaf="lambda-0"] .term-line')]
const stepText = () => document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? ''
const stepNumber = () => Number((stepText().match(/step ([\d,]+)/)?.[1] ?? '').replaceAll(',', ''))
const click = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
    .find((b) => b.textContent === label)
    ?.click()

async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the compile to settle')
  await until(() => !stepText().includes('not run'), 'the λ leg to record')
}

describe('the λ view draws the tree for the step it shows', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('lays out the displayed step’s tree, and the tree it shows is that step’s', async () => {
    await settled(FACT3)
    await until(() => rows().length > 0 && term()?.dataset.stale === undefined, 'a tree for the displayed step')
    expect(Number(term()?.dataset.step)).toBe(stepNumber())
    expect(term()?.getAttribute('role')).toBe('list')
  })

  it('draws step 0 when the play head returns there, with the next redex marked', async () => {
    click('↺')
    await until(() => term()?.dataset.step === '0' && term()?.dataset.stale === undefined, 'step 0’s tree')
    expect(stepNumber()).toBe(0)
    expect(document.querySelector('[data-leaf="lambda-0"] .term .is-next-redex')).not.toBeNull()
    expect(document.querySelector('[data-leaf="lambda-0"] .term .is-contractum')).toBeNull()
  })

  it('marks the contractum once a step has been taken', async () => {
    click('▶')
    await until(() => term()?.dataset.step === '1' && term()?.dataset.stale === undefined, 'step 1’s tree')
    expect(document.querySelector('[data-leaf="lambda-0"] .term .is-contractum')).not.toBeNull()
  })

  /**
   * A RECOMPILE DOES NOT STRAND THE VIEW. `supersede()` moves the client's generation the moment a
   * keystroke schedules a compile, 300 ms before the worker hears of it; a tree asked for in that window
   * was dropped by the worker and waited on forever, so the view stayed on flat text for good. Found by
   * the tripwire below, which is the second program this file compiles; this names the mechanism.
   */
  it('draws the new program’s tree after a recompile', async () => {
    await settled('let x = 40; x + 2')
    await until(
      () => rows().length > 0 && Number(term()?.dataset.step) === stepNumber() && term()?.dataset.stale === undefined,
      'the new program’s tree',
    )
  })

  /**
   * A NEW COMPILE STARTS FROM THE AUTOMATIC FOLDS (spec §5.2). The program is rebuilt behind the same
   * session, so only the build changes. `1`'s chip opened by hand reads as its λ; the next program's `42`
   * must read as its chip again rather than inherit the opened root.
   */
  it('starts a new compile from the automatic folds', async () => {
    const chip = () => term()?.querySelector<HTMLElement>('.term-chip[data-node="0"]') ?? null
    const drawn = () =>
      rows().length > 0 && Number(term()?.dataset.step) === stepNumber() && term()?.dataset.stale === undefined
    await settled('let y = 1; y')
    await until(() => drawn() && chip()?.textContent === '1', 'the chip 1')
    chip()?.click()
    await until(() => chip() === null, 'the chip opened by hand')
    await settled('let x = 40; x + 2')
    await until(() => drawn() && chip()?.textContent === '42', 'the next program’s chip, closed again')
  })

  /**
   * THE DEPTH TRIPWIRE. A 600-element list reaches a term depth past 1,500 mid-reduction (the wasm
   * browser tier measured 1,803); the layout recurses only through OPEN nodes, and the automatic policy
   * folds everything off the redex's path past 200 nodes, so this must lay out rather than overflow.
   */
  it('lays out the deepest term a 600-element list reaches', async () => {
    const elems = Array(600).fill('0').join(', ')
    await settled(`[${elems}]`)
    await until(() => rows().length > 0, 'a tree for the frontier')
    expect(document.querySelector('.banner')).toBeNull()
  }, 60_000)
})
````

Apply the tests' half of the patch — the existing tests this task moves:

````diff
diff --git a/web/tests/browser/app.test.ts b/web/tests/browser/app.test.ts
index 2a3d7f9..8fa6359 100644
--- a/web/tests/browser/app.test.ts
+++ b/web/tests/browser/app.test.ts
@@ -3,6 +3,7 @@ import { beforeAll, describe, expect, it } from 'vitest'
 import { STORAGE_KEY } from '../../src/appearance'
 import { OVERSCAN, ROW_HEIGHT } from '../../src/tm-pane'
 import { SHELL, until } from './harness'
+import { lambdaSettled } from './lambda-text'
 
 const LAMBDA_DECLINES = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
 
@@ -114,7 +115,12 @@ describe('the app, end to end', () => {
   // inside `[data-leaf="lambda-0"]`, so 114 tests and six eye checks all missed it.
   it('renders the λ pane’s first binder span as exactly "λ", not "λ" plus its name', async () => {
     await until(() => resultsText().includes('reductions'))
-    await until(() => document.querySelector('[data-leaf="lambda-0"] .tok-binder') !== null)
+    // STEP 0, WHERE THE TERM HAS BINDERS TO SHOW: the frontier is a normal form the λ view draws as the
+    // chip `42` (Plan 7 part 4a), which has none.
+    ;[...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
+      .find((b) => b.textContent === '↺')
+      ?.click()
+    await lambdaSettled()
     const first = document.querySelector('[data-leaf="lambda-0"] .tok-binder')
     expect(first?.textContent).toBe('λ')
   })
@@ -453,11 +459,16 @@ describe('the app, end to end', () => {
       await settled(view, 'let x = 40; x + 2')
       // Recording finished, so the head sits on step 7.
       expect(stepText('lambda')).toContain('step 7')
+      // EVERY READ WAITS FOR THE STEP'S OWN TREE: the view draws the last step's tree, marked stale, for the
+      // one worker round trip until this step's arrives (Plan 7 part 4a's `lambdaSettled`).
+      await lambdaSettled()
       const atSeven = paneText('lambda')
       click('lambda', '◀')
+      await lambdaSettled()
       const atSix = paneText('lambda')
       expect(atSix).not.toBe(atSeven)
       click('lambda', '▶')
+      await lambdaSettled()
       expect(paneText('lambda')).toBe(atSeven)
 
       // A `forward()` that always jumped to the NEWEST recorded frame, instead of incrementing the
@@ -467,74 +478,68 @@ describe('the app, end to end', () => {
       // first `▶` below instead of `atFive`, and the step readout would jump straight to 7 instead of
       // counting 5, 6, 7.
       click('lambda', '◀')
+      await lambdaSettled()
       const atSixAgain = paneText('lambda')
       click('lambda', '◀')
+      await lambdaSettled()
       const atFive = paneText('lambda')
       click('lambda', '◀')
+      await lambdaSettled()
       const atFour = paneText('lambda')
       expect(atFour).not.toBe(atFive)
       expect(stepText('lambda')).toContain('step 4')
 
       click('lambda', '▶')
+      await lambdaSettled()
       expect(paneText('lambda')).toBe(atFive)
       expect(stepText('lambda')).toContain('step 5')
       click('lambda', '▶')
+      await lambdaSettled()
       expect(paneText('lambda')).toBe(atSixAgain)
       expect(stepText('lambda')).toContain('step 6')
       click('lambda', '▶')
+      await lambdaSettled()
       expect(paneText('lambda')).toBe(atSeven)
       expect(stepText('lambda')).toContain('step 7')
     })
 
-    // THE LAYER 5b's WORST BUG LIVED IN, ON THE ONE FEATURE THAT HAD NO TEST HERE. `lambda-pane.ts`'s
-    // `#redraw` converts `frame.redex_span` — BYTE offsets, like every span crossing the wasm boundary
-    // — through `byteToIndex`/`byteIndexAt` before deciding which tokens get `is-redex`. Nothing
-    // exercised that conversion: the node tier cannot (it has no DOM), the Rust tier stops at the
-    // span's value, and the sibling `is-linked` path is the only one this file was checking.
+    // THE CONTRACTUM, MARKED BY NODE. At step 6 of this program the view marks `(λx0. f (f x0))` — the
+    // subterm standing at the last redex's path in THIS step's term, parens included. That is an `Abs`,
+    // so it is plainly not the redex itself: the path named a redex `App` in the PRE-step term and β
+    // replaced it with this, its CONTRACTUM (`viewmodel.rs`'s `redex_span` doc).
     //
-    // THE FIXTURE IS CHOSEN SO THE TWO READINGS DISAGREE, which most would not. At step 6 of this
-    // program the frame text is `λf. λx. f (f ( … ((λx0. f (f x0)) x)) … )` and the redex span is bytes
-    // [130, 146]. Two `λ` (in `λf.` and `λx.`) precede byte 130 and a third precedes byte 146, and `λ`
-    // is 2 bytes but 1 UTF-16 code unit — so the correct UTF-16 range is [128, 143] and the span sits
-    // AFTER binders rather than at the root, which is what makes the displacement possible at all.
-    // Converted, the lit text is `(λx0. f (f x0))` — the subterm standing at the redex's path in THIS
-    // frame's term, parens included. That is an `Abs`, so it is plainly not the redex itself: the path
-    // named a redex `App` in the PRE-step term and β replaced it with this, its CONTRACTUM. See
-    // `viewmodel.rs`'s `redex_span` doc; the conversion under test is the same either way.
-    // Sliced as UTF-16 without converting, [130, 146] reads `x0. f (f x0)) x)` — a window shifted off
-    // the front of the subterm and past its end, lighting a different token set entirely. A root-path
-    // span (`[]`, byte 0) or an ASCII-only fixture would score both readings identical and prove
-    // nothing; this one cannot.
-    it('paints its own redex by converting the byte span, not by slicing it as UTF-16', async () => {
+    // THE FIXTURE WAS CHOSEN FOR LAYER 5b's WORST BUG, a byte span sliced as UTF-16: three `λ` precede
+    // this redex's span, so the two readings disagree. The tree marks by node and has no span to slice,
+    // so that conversion now happens only in the flat text a step shows before its tree arrives, and
+    // `lambda-body.test.ts` holds it there.
+    it('marks the contractum the step produced, and nothing at step 0', async () => {
       await settled(view, 'let x = 40; x + 2')
-      // `settled` resolves on the RESULTS pane, which is not the same event as the λ pane holding
-      // frames — the same race the restart test above documents.
       await until(() => !stepText('lambda').includes('not run'))
       expect(stepText('lambda')).toContain('step 7')
 
-      // Step 6, one back from the frontier. Synchronous, like the stepping test above: `#redraw` runs
-      // in the click handler, so an `await` here would be waiting for nothing.
+      // Step 6, one back from the frontier, once the view has that step's tree.
       click('lambda', '◀')
       expect(stepText('lambda')).toContain('step 6')
+      await lambdaSettled()
 
-      const lit = [...document.querySelectorAll('[data-leaf="lambda-0"] .term .is-redex')]
-      // Non-empty first, and separately: a `join('')` over an empty list is `''`, which would compare
-      // equal to nothing useful and hide a feature that paints no token at all.
+      const lit = [...document.querySelectorAll('[data-leaf="lambda-0"] .term .is-contractum')]
       expect(lit.length).toBeGreaterThan(0)
-      // Whitespace between tokens is a text node rather than part of any token's span, so the joined
-      // token text is the subterm with its spaces squeezed out.
-      expect(lit.map((e) => e.textContent).join('')).toBe('(λx0.f(fx0))')
-      // The redex starts at its own opening paren and the binder is inside it — the two facts a
-      // displaced window loses first.
+      // Whitespace squeezed out, as it was when this read the flat text: the contractum may break across
+      // lines at the view's width, and a line break is not a space in the DOM.
+      expect(
+        lit
+          .map((e) => e.textContent)
+          .join('')
+          .replace(/\s/g, ''),
+      ).toBe('(λx0.f(fx0))')
       expect(lit[0]?.textContent).toBe('(')
       expect(lit.some((e) => e.classList.contains('tok-binder'))).toBe(true)
 
-      // Step 0 has no redex at all (`LambdaState.redex_span` is `null` there), so nothing may be lit.
-      // Without this the assertions above would also pass against a pane that painted `is-redex` on
-      // every token of every frame.
+      // Step 0 has no contractum at all, so nothing may be marked.
       click('lambda', '↺')
       expect(stepText('lambda')).toContain('step 0')
-      expect(document.querySelector('[data-leaf="lambda-0"] .term .is-redex')).toBeNull()
+      await lambdaSettled()
+      expect(document.querySelector('[data-leaf="lambda-0"] .term .is-contractum')).toBeNull()
     })
 
     it('shows five labelled tape rows with the head inside the window', async () => {
diff --git a/web/tests/browser/buffer-cool-warm.test.ts b/web/tests/browser/buffer-cool-warm.test.ts
index 24cbdb2..967e610 100644
--- a/web/tests/browser/buffer-cool-warm.test.ts
+++ b/web/tests/browser/buffer-cool-warm.test.ts
@@ -2,6 +2,7 @@ import { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it } from 'vitest'
 import { bindingKey } from '../../src/view-header'
 import { SHELL, until } from './harness'
+import { asShown } from './lambda-text'
 
 /**
  * **THE COOL → WARM → BIND ROUND TRIP, AND THE DEFECT IT USED TO END IN** — design §4.5's stated flow
@@ -192,7 +193,7 @@ describe('a cooled buffer warmed and bound to a pane again', () => {
     // 0, which is already a normal form here, so the pane ends up showing exactly the string the editor
     // is holding. Without this wait the `term() !== beforeEdit` below would fire on the REBUILD rather
     // than on the keystroke, and the edit would go unmeasured.
-    await until(() => term() === forked, "the warmed buffer's own rebuild to reach its newly bound pane")
+    await until(() => term() === asShown(forked), "the warmed buffer's own rebuild to reach its newly bound pane")
     const beforeEdit = term()
     typeIntoScratchEditor('(λa. a a) (λb. b)')
     await until(() => term() !== beforeEdit, 'the re-bound buffer to recompile from a keystroke')
diff --git a/web/tests/browser/marks.test.ts b/web/tests/browser/marks.test.ts
index 781a4a6..dc1b60a 100644
--- a/web/tests/browser/marks.test.ts
+++ b/web/tests/browser/marks.test.ts
@@ -57,8 +57,16 @@ describe('spans mark what you pinned with a box and where the machine is with an
     expect(hasBottomEdge(s.boxShadow), s.boxShadow).toBe(false)
   })
 
+  it('outlines the next λ redex dashed, a shape neither the contractum nor a link uses', () => {
+    const next = getComputedStyle(
+      mount('<div class="term"><span class="is-next-redex">x</span></div>', '.is-next-redex'),
+    )
+    expect(next.outlineStyle).toBe('dashed')
+    expect(hasBottomEdge(next.boxShadow), next.boxShadow).toBe(false)
+  })
+
   it('boxes a linked λ span the same way', () => {
-    const s = getComputedStyle(mount('<pre class="term"><span class="is-linked">x</span></pre>', '.is-linked'))
+    const s = getComputedStyle(mount('<div class="term"><span class="is-linked">x</span></div>', '.is-linked'))
     expect(s.boxShadow).toContain('0px 0px 0px 1px inset')
   })
 
@@ -72,10 +80,12 @@ describe('spans mark what you pinned with a box and where the machine is with an
   })
 
   it('leaves the λ contractum as the one underlined mark in the λ view', () => {
-    const redex = getComputedStyle(mount('<pre class="term"><span class="is-redex">x</span></pre>', '.is-redex'))
+    const redex = getComputedStyle(
+      mount('<div class="term"><span class="is-contractum">x</span></div>', '.is-contractum'),
+    )
     expect(redex.boxShadow).toContain('0px -2px 0px 0px inset')
     expect(hasBottomEdge(redex.boxShadow), redex.boxShadow).toBe(true)
-    const linked = getComputedStyle(mount('<pre class="term"><span class="is-linked">x</span></pre>', '.is-linked'))
+    const linked = getComputedStyle(mount('<div class="term"><span class="is-linked">x</span></div>', '.is-linked'))
     expect(linked.textDecorationLine).not.toContain('underline')
     expect(hasBottomEdge(linked.boxShadow), linked.boxShadow).toBe(false)
   })
diff --git a/web/tests/browser/scratch-app.test.ts b/web/tests/browser/scratch-app.test.ts
index 882d16c..afc1def 100644
--- a/web/tests/browser/scratch-app.test.ts
+++ b/web/tests/browser/scratch-app.test.ts
@@ -2,6 +2,7 @@ import type { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it } from 'vitest'
 import { bindingKey } from '../../src/view-header'
 import { SHELL, until } from './harness'
+import { lambdaSettled } from './lambda-text'
 
 /**
  * **THE FORK, DRIVEN THROUGH THE APP** — design §4.3's detach, plan T8, from the control a user
@@ -163,11 +164,17 @@ function alphaCanonical(printedTerm: string): string {
   const scope: Frame[] = []
   let depth = 0
   let declaring = false
-  return printedTerm.replace(/λ|[a-zA-Z][a-zA-Z0-9]*|[()]/g, (tok) => {
+  return printedTerm.replace(/λ|[a-zA-Z][a-zA-Z0-9]*|[().]/g, (tok) => {
     if (tok === 'λ') {
       declaring = true
       return tok
     }
+    // THE `.` ENDS A BINDER LIST, NOT THE FIRST NAME AFTER `λ`: the λ view writes curried binders merged,
+    // `λa b c.` (Plan 7 part 4a), and every name in that list is a declaration.
+    if (tok === '.') {
+      declaring = false
+      return tok
+    }
     if (tok === '(') {
       depth += 1
       return tok
@@ -181,7 +188,6 @@ function alphaCanonical(printedTerm: string): string {
     }
     // An identifier: a fresh declaration right after `λ`, or a use to resolve against the scope stack.
     if (declaring) {
-      declaring = false
       const canon = `v${scope.length}`
       scope.push({ name: tok, canon, openDepth: depth })
       return canon
@@ -249,6 +255,7 @@ describe('the fork control, end to end', () => {
     clickLambda('↺')
     clickLambda('▶')
     clickLambda('▶')
+    await lambdaSettled()
     const seed = term()
     expect(step()).toContain('step 2 of')
     expect(seed).not.toBe('')
@@ -316,7 +323,10 @@ describe('the fork control, end to end', () => {
     // on.
     clickLambda('↺')
     expect(step()).toBe('step 0 of 5')
-    expect(alphaCanonical(term())).toBe(alphaCanonical(seed))
+    await lambdaSettled()
+    // WHITESPACE SQUEEZED OUT: the copy's names can be longer (`x0` where the program printed `x`), so the
+    // same term can break across lines where the program's did not, and a line break is not a space.
+    expect(alphaCanonical(term()).replace(/\s/g, '')).toBe(alphaCanonical(seed).replace(/\s/g, ''))
 
     // STAGE 4 — A RECOMPILE FROM SOURCE LEAVES THE BUFFER ALONE, AND THIS STAGE USED TO ASSERT THE
     // EXACT OPPOSITE. It read "recompile from source retires it. Synchronous on the keystroke", and
diff --git a/web/tests/browser/scratch-buffers.test.ts b/web/tests/browser/scratch-buffers.test.ts
index 75bc603..1f87812 100644
--- a/web/tests/browser/scratch-buffers.test.ts
+++ b/web/tests/browser/scratch-buffers.test.ts
@@ -2,6 +2,7 @@ import { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it } from 'vitest'
 import { bindingKey } from '../../src/view-header'
 import { SHELL, until } from './harness'
+import { lambdaSettled } from './lambda-text'
 
 /**
  * **WHAT ENDS A BUFFER, DRIVEN THROUGH THE APP** — design §4.3's table, and the row this task changes:
@@ -183,9 +184,11 @@ describe('a scratch buffer across a recompile of the source', () => {
     // assertion after the recompile mean "the buffer's own work is still there" rather than "a λ
     // session is still bound": `(λa. a a) (λb. b)` is the user's text, reduced on the buffer's own
     // thread, and it is neither the source's old program nor its new one.
+    await lambdaSettled()
     const seeded = term()
     typeIntoBufferEditor('(λa. a a) (λb. b)')
     await until(() => term() !== seeded, 'the edited buffer to recompile')
+    await lambdaSettled()
     const edited = term()
     expect(edited).not.toBe('')
     expect(edited).toContain('λ')
diff --git a/web/tests/browser/scratch-edit.test.ts b/web/tests/browser/scratch-edit.test.ts
index 34e695d..fe8314a 100644
--- a/web/tests/browser/scratch-edit.test.ts
+++ b/web/tests/browser/scratch-edit.test.ts
@@ -1,6 +1,7 @@
 import { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it } from 'vitest'
 import { SHELL, until } from './harness'
+import { lambdaSettled } from './lambda-text'
 
 /**
  * **THE SECOND EDIT GESTURE, DRIVEN THROUGH THE APP** — design §4.3's `editScratch`, plan T8's last
@@ -78,6 +79,7 @@ describe('editing the scratch, through the app', () => {
     expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('copy · not linked')
     await until(() => editorHost() !== null, 'the editor to mount')
     await until(() => term() !== '', 'the scratchpad to produce its first frame')
+    await lambdaSettled()
 
     // STAGE 2 — a genuine edit changes the frames region, and the SOURCE's own result is untouched.
     // `onScratchReply` never writes `#results` (its own doc: "never touches `results.dataset.state`
@@ -86,6 +88,7 @@ describe('editing the scratch, through the app', () => {
     const beforeEdit = term()
     typeIntoScratchEditor('(λa. a a) (λb. b)')
     await until(() => term() !== beforeEdit, 'the edited scratch to recompile')
+    await lambdaSettled()
     expect(term()).toContain('b')
     focusProgram()
     expect(resultsText()).toBe(resultsBefore)
@@ -94,6 +97,7 @@ describe('editing the scratch, through the app', () => {
     // good run and puts the diagnostics in the gutter" — the opposite of what a broken SOURCE program
     // does to its own panes (`onReply`'s `no-session`: "stale frames must not survive a broken
     // program"), and deliberately so: a scratch mid-edit still has the term it had a keystroke ago.
+    await lambdaSettled()
     const lastGood = term()
     typeIntoScratchEditor('(λa.')
     await until(
@@ -131,6 +135,7 @@ describe('editing the scratch, through the app', () => {
     // moving to the new term is that worker replying after the source recompile that used to kill it.
     typeIntoScratchEditor('(λm. m) (λn. n)')
     await until(() => term() !== lastGood, 'the buffer to recompile after the source did')
+    await lambdaSettled()
     expect(term()).toContain('n')
     expect(document.querySelector('[data-leaf="lambda-0"] h2')?.textContent).toContain('copy · not linked')
   })
diff --git a/web/tests/browser/scratch-fork.test.ts b/web/tests/browser/scratch-fork.test.ts
index a17d2fc..0eeed63 100644
--- a/web/tests/browser/scratch-fork.test.ts
+++ b/web/tests/browser/scratch-fork.test.ts
@@ -16,6 +16,7 @@ import type { LegState, SessionEntry } from '../../src/sessions'
 import { PaneSlot, SessionRegistry } from '../../src/sessions'
 import type { LambdaState, TmState } from '../../src/types'
 import { SHELL, until } from './harness'
+import { lambdaSettled } from './lambda-text'
 
 /**
  * **THE TWO CLAIMS PLAN T8 MAKES THAT A FAKE PORT CANNOT ANSWER** — design §4.3, over real
@@ -785,7 +786,13 @@ describe('the fork control forks a truncated frame, through the app', () => {
     // THE CAPABILITY THIS SLICE EXISTS FOR. Before T8's fix to `#refreshDetach`, a frame this
     // truncated hid the fork control outright — `lambda-pane.ts`'s own module doc calls this shape
     // "most non-trivial terms".
-    expect(document.querySelector('[data-leaf="lambda-0"] .truncated')).not.toBeNull()
+    //
+    // **THE TRUNCATION IS NO LONGER ON SCREEN, AND THIS NO LONGER ASSERTS IT THERE.** This line read
+    // `.truncated` off the flat frame; the λ view now draws the step's tree (Plan 7 part 4a), which is the
+    // whole term, and shows the 512-byte frame only until the tree arrives. `WHILE4`'s step-2 frame is
+    // still cut at `FRAME_BYTES` — this test's own `beforeAll` picked the program for it — and the fork
+    // still starts from that frame's step, which is what the assertions below hold.
+    await lambdaSettled()
     const fork = document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] button.detach')
     expect(fork).not.toBeNull()
 
diff --git a/web/tests/browser/step-bar.test.ts b/web/tests/browser/step-bar.test.ts
index 5b0ba97..8460158 100644
--- a/web/tests/browser/step-bar.test.ts
+++ b/web/tests/browser/step-bar.test.ts
@@ -1,6 +1,7 @@
 import type { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it } from 'vitest'
 import { SHELL, until } from './harness'
+import { lambdaSettled } from './lambda-text'
 
 const menu = (): HTMLElement => {
   document.querySelector<HTMLButtonElement>('#workspace')?.click()
@@ -59,14 +60,16 @@ describe('the step bar', () => {
   // frontier, where `▶` means "record one more" and the readout does not move. Stepping back from the
   // frontier is the unambiguous gesture, and it is still evidence the bar drives the view it names —
   // the readout it moves is the one the title belongs to.
-  it('steps the view it names', () => {
+  it('steps the view it names', async () => {
     focusView('lambda-0')
     const before = barStep()
     expect(before).toContain('step ')
+    await lambdaSettled('lambda-0', barStep)
     const termBefore = document.querySelector('[data-leaf="lambda-0"] .term')?.textContent ?? ''
     expect(termBefore, 'the λ view renders no term, so a change in it would prove nothing').not.toBe('')
     bar().querySelector<HTMLButtonElement>('button[aria-label="one step back"]')?.click()
     expect(barStep()).not.toBe(before)
+    await lambdaSettled('lambda-0', barStep)
     // **THE VIEW ITSELF MOVED, WHICH IS THE HALF THE BAR'S OWN READOUT CANNOT SHOW.** This line used to
     // assert the λ leaf merely exists, which every other case already relies on — it said nothing about
     // the bar driving the view its title names.
diff --git a/web/tests/browser/two-lambda-panes.test.ts b/web/tests/browser/two-lambda-panes.test.ts
index e2182b1..6af92fe 100644
--- a/web/tests/browser/two-lambda-panes.test.ts
+++ b/web/tests/browser/two-lambda-panes.test.ts
@@ -4,6 +4,7 @@ import { defaultLayout, LAYOUT_STORAGE_KEY, leaves } from '../../src/layout'
 import { bindingKey } from '../../src/view-header'
 import { parseWorkspace } from '../../src/workspace'
 import { SHELL, until } from './harness'
+import { lambdaSettled } from './lambda-text'
 
 /**
  * TWO λ PANES ON TWO λ SESSIONS, THROUGH THE APP — the claim 5d-i could assert only with hand-built
@@ -359,9 +360,12 @@ describe('two λ panes on two λ sessions', () => {
     // false one in the race above. The split pane being non-empty keeps a mid-rebind empty render from passing,
     // which would race the source-pane assertion below the same way. Text rather than the fork control the
     // other rebinds in this file wait for, because what the snapshot needs settled is the TERM.
-    await until(
-      () => textOf(first ?? '') !== '' && textOf(second ?? '') !== '' && textOf(second ?? '') !== textOf(first ?? ''),
-    )
+    // BOTH NON-EMPTY, AND NOT YET DIFFERENT. The copy is forked from the program's frontier, so before the edit
+    // both views show one term — and since Plan 7 part 4a both draw it the same way, as the chip `42`, where
+    // the flat views used to differ. The edit below is what makes the two sessions' terms differ.
+    await lambdaSettled(first ?? '')
+    await lambdaSettled(second ?? '')
+    await until(() => textOf(first ?? '') !== '' && textOf(second ?? '') !== '')
 
     // 4. Edit the scratch so the two sessions genuinely differ — `typeInto`, a REAL CodeMirror
     // transaction through `EditorView.findFromDOM`. Its own doc carries the argument this comment
diff --git a/web/tests/browser/view-title.test.ts b/web/tests/browser/view-title.test.ts
index 4d09357..9340960 100644
--- a/web/tests/browser/view-title.test.ts
+++ b/web/tests/browser/view-title.test.ts
@@ -97,7 +97,7 @@ const paint = (reg: SessionRegistry, slot: PaneSlot<'lambda'>, pane: LambdaPane)
   slot.render(reg, pane, slot.resolve(reg))
 
 /** The term the pane is showing, read the way a user reads it. */
-const term = (pane: HTMLElement) => pane.querySelector('pre.term')?.textContent ?? ''
+const term = (pane: HTMLElement) => pane.querySelector('.term')?.textContent ?? ''
 
 /** The title-selector of the view in `pane` — the pair in force is its `data-binding`. */
 const titleOf = (pane: HTMLElement) => pane.querySelector<HTMLButtonElement>('button.view-title')
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd web && pnpm run typecheck`
Expected: FAIL, 10 errors — among them `Cannot find module '../../src/lambda-body'`, `Property 'renderTree' does not exist on type 'LambdaPane'` and `Property 'setBuild' does not exist on type 'LambdaPane'`. The browser files cannot load until the module exists, so the typecheck is the red step here.

- [ ] **Step 3: Write the body.** Create `web/src/lambda-body.ts`:

````ts
import { type Line, lineOf, type Token } from './lambda-layout'
import type { Tree } from './lambda-tree'
import { byteIndexAt, byteToIndex, decorationRanges } from './spans'
import { Follow } from './state-table'
import { tokenClassName } from './theme'
import type { LambdaState } from './types'
import { visibleWindow } from './virtual-list'

/** One laid-out line's height, in CSS pixels — `.term-line`'s `height` in `style.css` says the same. */
export const LINE_HEIGHT = 20
/** Rows drawn past each edge of the viewport, so a short scroll never shows an empty band. */
const OVERSCAN = 6

/** What the λ view asks of its owner when a row is used. */
export type BodyEvents = {
  /** Open or fold `node` — a gutter `▸`/`▾`, a chip, or a `… N nodes` fold was clicked or keyed. */
  readonly toggle: (node: number) => void
  /** Link from `node` — any other token was clicked, or a row was entered. */
  readonly link: (node: number) => void
}

/**
 * The class a mark adds, and the words a screen reader hears where it starts.
 *
 * **THE WORDS ARE CSS GENERATED CONTENT, NOT TEXT NODES** (`[data-marks]::before { content: attr(…) }`,
 * visually hidden). Generated content is part of what a screen reader reads, and it is not part of
 * `textContent` — which every reader of `.term` reads. The prototype put them in hidden spans, and every
 * comparison of the λ view's text then depended on which marks were showing at that moment.
 */
const MARKS = {
  'is-next-redex': 'next redex:',
  'is-contractum': 'just produced:',
  'is-linked': 'linked:',
} as const
type Mark = keyof typeof MARKS

function tokenClass(tok: Token): string {
  switch (tok.kind) {
    case 'binder':
      return tokenClassName('Binder')
    case 'ident':
      return tokenClassName('Ident')
    case 'keyword':
      return tokenClassName('Keyword')
    case 'chip':
      return `term-chip ${tokenClassName(/^\d+$/.test(tok.text) ? 'Nat' : 'Bool')}`
    case 'fold':
      return 'term-fold'
    default:
      return tokenClassName('Punct')
  }
}

/**
 * A frame's recorded text as today's λ view drew it: token spans, the contractum marked, and the cut.
 * What the body shows before a step's tree arrives, and when the tree was refused.
 */
export function flatText(frame: LambdaState | null, note: string | null): Node[] {
  if (frame === null) return note === null ? [] : [document.createTextNode(note)]
  const ranges = decorationRanges(frame.spans, frame.text)
  let from = -1
  let to = -1
  if (frame.redex_span !== null) {
    const map = byteToIndex(frame.text)
    from = byteIndexAt(map, frame.redex_span.start)
    to = byteIndexAt(map, frame.redex_span.end)
  }
  const out: Node[] = []
  let at = 0
  for (const r of ranges) {
    if (r.from < at) continue
    if (r.from > at) out.push(document.createTextNode(frame.text.slice(at, r.from)))
    const el = document.createElement('span')
    el.className = to > from && r.from >= from && r.to <= to ? `${r.className} is-contractum` : r.className
    el.textContent = frame.text.slice(r.from, r.to)
    out.push(el)
    at = r.to
  }
  if (at < frame.text.length) out.push(document.createTextNode(frame.text.slice(at)))
  if (frame.cut !== null) {
    const more = document.createElement('span')
    more.className = 'truncated'
    more.textContent = frame.cut === 'Depth' ? ' … too deep' : ' … truncated'
    out.push(more)
  }
  if (note !== null) {
    const n = document.createElement('p')
    n.className = 'term-note'
    n.textContent = note
    out.push(n)
  }
  return out
}

let seq = 0

let canvas: CanvasRenderingContext2D | null | undefined
/** One 2D context for every body's width measurement, made on first use. */
function measurer(): CanvasRenderingContext2D | null {
  if (canvas === undefined) canvas = document.createElement('canvas').getContext('2d')
  return canvas
}

/**
 * The λ view's body: a laid-out term, virtualized by line, or a frame's flat text (spec §5).
 *
 * **ONE ELEMENT, `.term`, IN BOTH MODES.** Every test and every stylesheet rule that reads the λ term
 * reads `.term`; what changes between modes is what is inside it and which role it carries — `tree` for
 * the outline, `list` for the code layout, `region` for flat text.
 *
 * **ONE TAB STOP.** The body is focusable and holds a roving active row (`aria-activedescendant`), so a
 * term of three thousand lines is not three thousand tab stops.
 *
 * **FOLLOWING IS `state-table.ts`'s `Follow`, REUSED.** The body keeps the next redex in view until a user
 * scroll detaches it; its own writes to `scrollTop` are recorded so their echoes are not read as intent.
 */
export class LambdaBody {
  readonly el: HTMLElement
  #spacer: HTMLElement
  #rows: HTMLElement
  #flat: HTMLElement
  #follow = new Follow()
  #on: BodyEvents
  #id = seq++
  #tree: Tree | null = null
  #lines: readonly Line[] = []
  #linked: readonly number[] = []
  #outline = false
  #active = 0
  #painted = ''

  constructor(on: BodyEvents) {
    this.#on = on
    this.el = document.createElement('div')
    this.el.className = 'term'
    this.el.tabIndex = 0
    this.el.setAttribute('aria-label', 'λ term')
    this.#flat = document.createElement('div')
    this.#flat.className = 'term-flat'
    this.#spacer = document.createElement('div')
    this.#spacer.className = 'term-spacer'
    this.#rows = document.createElement('div')
    this.#rows.className = 'term-rows'
    this.#spacer.append(this.#rows)
    this.el.append(this.#flat, this.#spacer)
    this.el.addEventListener('scroll', () => {
      this.#follow.onScroll(this.el.scrollTop)
      this.#paint()
    })
    this.el.addEventListener('click', (e) => this.#click(e))
    this.el.addEventListener('keydown', (e) => this.#key(e))
  }

  /**
   * Characters that fit one line at the body's current width — the layout's `width`.
   *
   * **MEASURED ON A CANVAS, NOT WITH A SPAN IN THE BODY.** A measuring span is text inside `.term`, and
   * every reader of the λ view reads `.term`'s text; the prototype's span put `0000000000` at the head of
   * every term it drew.
   */
  columns(): number {
    const ctx = measurer()
    if (ctx === null || this.el.clientWidth === 0) return 80
    ctx.font = getComputedStyle(this.el).font
    const ch = ctx.measureText('0000000000').width / 10
    if (!(ch > 0)) return 80
    return Math.max(24, Math.floor(this.el.clientWidth / ch) - 4)
  }

  get following(): boolean {
    return this.#follow.following
  }

  /** The lines on screen, first and last — what the term map outlines. */
  get visible(): { first: number; last: number } {
    const w = visibleWindow(this.#lines.length, LINE_HEIGHT, this.el.clientHeight, this.el.scrollTop, 0)
    return { first: w.firstIndex, last: w.lastIndex }
  }

  /** Follow the next redex again, and scroll to it now. */
  attach(): void {
    this.#follow.attach()
    this.#painted = ''
    this.#paint()
  }

  /** Scroll so `line` is centred, as a user would — which detaches following. */
  reveal(line: number): void {
    this.el.scrollTop = Math.max(0, line * LINE_HEIGHT - this.el.clientHeight / 2)
  }

  /** Show `lines` of `tree`. `stale` says the tree belongs to a step other than the one on display. */
  showTree(tree: Tree, lines: readonly Line[], outline: boolean, linked: readonly number[], stale: boolean): void {
    const same =
      tree === this.#tree && lines === this.#lines && outline === this.#outline && sameList(linked, this.#linked)
    this.#flat.hidden = true
    this.#spacer.hidden = false
    if (!same) {
      this.#flat.replaceChildren()
      this.#tree = tree
      this.#lines = lines
      this.#linked = linked
      this.#outline = outline
      this.#active = Math.min(this.#active, Math.max(0, lines.length - 1))
      this.#painted = ''
    }
    this.el.setAttribute('role', outline ? 'tree' : 'list')
    this.el.dataset.step = String(tree.wire.step)
    if (stale) {
      this.el.dataset.stale = 'true'
      this.el.setAttribute('aria-busy', 'true')
    } else {
      delete this.el.dataset.stale
      this.el.removeAttribute('aria-busy')
    }
    this.#paint()
  }

  /** Show a frame's recorded text — before a step's tree arrives, or with `note` when it was refused. */
  showText(frame: LambdaState | null, note: string | null): void {
    this.showFlat(flatText(frame, note))
  }

  /** Show `nodes` as flat text in place of any tree. */
  showFlat(nodes: readonly Node[]): void {
    this.#tree = null
    this.#lines = []
    this.#painted = ''
    this.#rows.replaceChildren()
    this.#spacer.style.height = '0px'
    this.#spacer.hidden = true
    this.#flat.hidden = false
    this.el.setAttribute('role', 'region')
    this.el.removeAttribute('aria-activedescendant')
    delete this.el.dataset.step
    delete this.el.dataset.stale
    this.el.removeAttribute('aria-busy')
    this.#flat.replaceChildren(...nodes)
  }

  #rowId(i: number): string {
    return `term-${this.#id}-row-${i}`
  }

  #marks(tree: Tree, node: number): Mark[] {
    const out: Mark[] = []
    const r = tree.wire.nextRedex
    if (r !== null && tree.contains(r, node)) out.push('is-next-redex')
    const c = tree.wire.contractum
    if (c !== null && tree.contains(c, node)) out.push('is-contractum')
    if (this.#linked.some((l) => tree.contains(l, node))) out.push('is-linked')
    return out
  }

  #paint(): void {
    const tree = this.#tree
    if (tree === null) return
    const total = this.#lines.length * LINE_HEIGHT
    this.#spacer.style.height = `${total}px`
    // READ AFTER THE RESIZE: `.term`'s height follows its content up to its cap.
    const viewport = this.el.clientHeight
    const redex = tree.wire.nextRedex
    if (redex !== null) {
      const at = lineOf(tree, this.#lines, redex)
      const top = at < 0 ? null : this.#follow.targetScrollTop(at, LINE_HEIGHT, viewport, total)
      if (top !== null && top !== this.el.scrollTop) {
        this.#follow.onProgrammaticScroll(top)
        this.el.scrollTop = top
      }
    }
    const w = visibleWindow(this.#lines.length, LINE_HEIGHT, viewport, this.el.scrollTop, OVERSCAN)
    const key = `${w.firstIndex}:${w.lastIndex}:${this.#active}`
    if (key === this.#painted) return
    this.#painted = key
    const mine = this.el.scrollTop
    this.#rows.style.transform = `translateY(${w.offsetY}px)`
    const rows: HTMLElement[] = []
    for (let i = w.firstIndex; i <= w.lastIndex; i += 1) rows.push(this.#row(tree, i))
    this.#rows.replaceChildren(...rows)
    // A SHRINKING TERM CLAMPS `scrollTop` ONLY ONCE ITS OLD ROWS ARE GONE — they sit absolutely positioned
    // far down and hold the scroll height up until this replacement — AND THE BROWSER REPORTS THE CLAMP AS A
    // SCROLL. Unrecorded, `Follow` reads it as the user scrolling away and stops following: found in the
    // prototype when a run's last step, a one-line chip, detached the view, and stepping back then left the
    // redex below the drawn window. Reading `scrollTop` here forces the layout that applies the clamp.
    if (this.el.scrollTop !== mine) this.#follow.onProgrammaticScroll(this.el.scrollTop)
    if (this.#active >= w.firstIndex && this.#active <= w.lastIndex) {
      this.el.setAttribute('aria-activedescendant', this.#rowId(this.#active))
    } else {
      this.el.removeAttribute('aria-activedescendant')
    }
  }

  #row(tree: Tree, i: number): HTMLElement {
    const line = this.#lines[i] as Line
    const el = document.createElement('div')
    el.className = i === this.#active ? 'term-line is-active' : 'term-line'
    el.id = this.#rowId(i)
    el.dataset.line = String(i)
    el.setAttribute('role', this.#outline ? 'treeitem' : 'listitem')
    el.setAttribute('aria-setsize', String(this.#lines.length))
    el.setAttribute('aria-posinset', String(i + 1))
    if (this.#outline) el.setAttribute('aria-level', String(line.level))
    const gutter = document.createElement('span')
    gutter.className = 'term-gutter'
    gutter.setAttribute('aria-hidden', 'true')
    // THE GLYPH IS CSS (`.term-gutter[data-open]::before`), NOT TEXT, and so is the indentation — a
    // reader of `.term`'s text reads the term, not the chrome drawn around it.
    if (line.disclose >= 0) {
      const open = !line.tokens.some((t) => t.kind === 'fold')
      gutter.dataset.open = String(open)
      gutter.dataset.node = String(line.disclose)
      el.setAttribute('aria-expanded', String(open))
    }
    el.style.paddingInlineStart = `calc(2ch + ${line.indent}ch)`
    el.append(gutter)
    let before: Mark[] = []
    for (const tok of line.tokens) {
      const marks = this.#marks(tree, tok.node)
      const starting = marks.filter((m) => !before.includes(m)).map((m) => MARKS[m])
      before = marks
      const span = document.createElement('span')
      span.className = [tokenClass(tok), ...marks].join(' ')
      span.dataset.node = String(tok.node)
      if (starting.length > 0) span.dataset.marks = `${starting.join(' ')} `
      span.textContent = tok.text
      el.append(span)
    }
    return el
  }

  #click(e: MouseEvent): void {
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    const row = target.closest<HTMLElement>('.term-line')
    if (row !== null) this.#active = Number(row.dataset.line)
    const node = Number.parseInt(target.dataset.node ?? '', 10)
    if (Number.isNaN(node)) return
    const opens = ['term-gutter', 'term-chip', 'term-fold'].some((c) => target.classList.contains(c))
    if (opens) this.#on.toggle(node)
    else this.#on.link(node)
  }

  #key(e: KeyboardEvent): void {
    if (this.#tree === null || this.#lines.length === 0) return
    const line = this.#lines[this.#active]
    const page = Math.max(1, Math.floor(this.el.clientHeight / LINE_HEIGHT) - 1)
    let next = this.#active
    switch (e.key) {
      case 'ArrowDown':
        next += 1
        break
      case 'ArrowUp':
        next -= 1
        break
      case 'PageDown':
        next += page
        break
      case 'PageUp':
        next -= page
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = this.#lines.length - 1
        break
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (line === undefined || line.disclose < 0) return
        const open = !line.tokens.some((t) => t.kind === 'fold')
        if (open === (e.key === 'ArrowRight')) return
        e.preventDefault()
        this.#on.toggle(line.disclose)
        return
      }
      case 'Enter': {
        const first = line?.tokens[0]
        if (first === undefined) return
        e.preventDefault()
        this.#on.link(first.node)
        return
      }
      default:
        return
    }
    e.preventDefault()
    this.#active = Math.min(Math.max(next, 0), this.#lines.length - 1)
    const top = this.#active * LINE_HEIGHT
    if (top < this.el.scrollTop) this.el.scrollTop = top
    else if (top + LINE_HEIGHT > this.el.scrollTop + this.el.clientHeight)
      this.el.scrollTop = top + LINE_HEIGHT - this.el.clientHeight
    this.#painted = ''
    this.#paint()
  }
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
````

- [ ] **Step 4: The pane, `draw()`, the app and the stylesheet.** Apply the source half of the patch:

````diff
diff --git a/web/src/draw.ts b/web/src/draw.ts
index aacd166..9dd37b2 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -1,6 +1,7 @@
 import type { EditorView } from '@codemirror/view'
 import { setFocus } from './highlight'
 import type { LambdaPane } from './lambda-pane'
+import type { LambdaTrees } from './lambda-trees'
 import { isCoincident, type Link, runningFocus, sourceNodeOwner } from './link'
 import type { LinkWiring } from './link-wiring'
 import type { LeafId, PaneCollection } from './panes'
@@ -64,6 +65,8 @@ export function createDraw(deps: {
   sessions: SessionRegistry
   panes: PaneCollection
   links: LinkWiring
+  /** The λ trees the views draw — asked here for each connected view's displayed step (spec §4). */
+  trees: LambdaTrees
   leaves: () => number
   sourceAvailable: () => boolean
   hasEditor: (session: SessionId) => boolean
@@ -90,6 +93,7 @@ export function createDraw(deps: {
     sessions,
     panes,
     links: linkWiring,
+    trees,
     leaves,
     sourceAvailable,
     hasEditor,
@@ -229,12 +233,18 @@ export function createDraw(deps: {
     // every way: that call is leg-agnostic (`PaneView`), and an editor-availability setter on `TmPane`
     // would be a method that could only ever be ignored. The loop above is the render pass for BOTH
     // legs; this one is already the place where "λ panes, and only λ panes" is said.
+    trees.prune((id) => sessions.has(id))
     for (const p of panes.of('lambda')) {
-      // THE SAME SKIP THE MAIN LOOP TAKES, for the same reason (spec §5).
+      // THE SAME SKIP THE MAIN LOOP TAKES, for the same reason (spec §5) — and a hidden view therefore asks
+      // the worker for no tree until its tab is next selected (part 4's spec §5.5).
       if (!p.host.isConnected) continue
       const pane = p.pane as LambdaPane
+      const session = p.slot.binding.session
+      const leg = p.slot.resolve(sessions)
+      pane.setBuild(trees.buildOf(session))
+      pane.renderTree(leg.hist.current === undefined ? { kind: 'none' } : trees.want(session, leg.hist.currentStep))
       pane.renderLink(lambdaWin)
-      pane.setEditorAvailable(hasEditor(p.slot.binding.session))
+      pane.setEditorAvailable(hasEditor(session))
     }
 
     // THE RUNNING FOCUS: a SECOND, INDEPENDENT layer from `l`/`link` above, computed here rather than
diff --git a/web/src/lambda-pane.ts b/web/src/lambda-pane.ts
index 11c8347..81ce673 100644
--- a/web/src/lambda-pane.ts
+++ b/web/src/lambda-pane.ts
@@ -1,10 +1,15 @@
 import type { ControlState } from './controls'
 import type { EditablePane } from './editor-custody'
 import { EDITOR_DEBOUNCE_MS } from './editor-debounce'
+import { LambdaBody } from './lambda-body'
+import { Folds } from './lambda-folds'
+import { codeLines, type Line } from './lambda-layout'
+import { Tree } from './lambda-tree'
+import type { TreeFor } from './lambda-trees'
 import type { LambdaWindow } from './lambda-window'
 import type { Dir } from './layout'
 import { type PaneChoice, type PaneEvents, type SplitChoices, textPanel } from './pane-chrome'
-import type { Leg } from './protocol'
+import type { LambdaTreeWire, Leg } from './protocol'
 import type { ScratchEditorConfig } from './scratch-editor'
 import { ScratchEditor } from './scratch-editor'
 import type { Binding, PaneOption } from './sessions'
@@ -23,17 +28,31 @@ function ellipsis(): HTMLElement {
 }
 
 /**
- * The λ pane: the term as text, syntax-coloured by the same token classes the source pane uses.
+ * The λ pane: the displayed step's term, laid out from the tree the worker serves for it (Plan 7 part 4a)
+ * — or, before that tree arrives and when it is refused, the frame's own text, syntax-coloured by the
+ * same token classes the source pane uses.
  *
- * TRUNCATION IS SHOWN, NOT HIDDEN. `frame_cost_probe` measured a history frame's budget at 512
- * bytes, two orders below the readout's, so most non-trivial terms WILL truncate here. A BYTE cut's
- * text is a prefix of the real term; a DEPTH cut's is not — see `results.ts`'s note on `Cut` for why —
- * but showing either beats hiding it, which is why both are marked the same way here (`… truncated` /
- * `… too deep`) rather than one being suppressed. `results.ts` still prints the full normal form at
- * 64 KiB.
+ * TRUNCATION IS SHOWN, NOT HIDDEN, in that flat text. `frame_cost_probe` measured a history frame's
+ * budget at 512 bytes, two orders below the readout's, so most non-trivial frames WILL truncate. A BYTE
+ * cut's text is a prefix of the real term; a DEPTH cut's is not — see `results.ts`'s note on `Cut` for
+ * why — but showing either beats hiding it, which is why both are marked the same way (`… truncated` /
+ * `… too deep`, `lambda-body.ts`'s `flatText`) rather than one being suppressed. The tree is the whole
+ * term, and `results.ts` still prints the full normal form at 64 KiB.
  */
 export class LambdaPane implements EditablePane {
-  #text: HTMLElement
+  /** The body — a laid-out tree, or a frame's flat text (`lambda-body.ts`). */
+  #body: LambdaBody
+  /** What `draw()` last said about the tree for the displayed step. */
+  #treeFor: TreeFor = { kind: 'none' }
+  /** One `Tree` per wire, so a redraw of the same step derives nothing twice. */
+  #trees = new WeakMap<LambdaTreeWire, Tree>()
+  #folds = new Folds()
+  /** The session this view last drew — see `setBindings`. */
+  #bound: string | null = null
+  /** The build this view's trees last came from — see `setBuild`. */
+  #build: number | null = null
+  /** The last layout and what produced it — a redraw with the same inputs reuses the lines. */
+  #laidOut: { key: string; tree: Tree; lines: Line[] } | null = null
   #steps: ReturnType<typeof stepControls>
   /**
    * The view's header (`view-header.ts`'s `viewHeader`): the title that is the selector, the
@@ -90,6 +109,8 @@ export class LambdaPane implements EditablePane {
    * invisible" split `PaneEvents.detach`'s doc draws for the fork button.
    */
   #onEdit: ((src: string) => void) | undefined
+  /** Link from a construct's id. Not yet wired to `PaneEvents.linkLambda`, so it goes nowhere. */
+  #onLinkNode: ((node: number) => void) | undefined
   /** Resolves this pane's current binding to an LSP document — see `PaneEvents.lspDocument`. */
   #lspDocument: (() => ScratchEditorConfig['document']) | undefined
   /** Resolves this pane's language to its colourer — see `PaneEvents.colour`. */
@@ -143,8 +164,10 @@ export class LambdaPane implements EditablePane {
     // THE HEADER CARRIES THE TITLE-SELECTOR AND THE STATUS — `view-header.ts`'s own doc has why the title
     // is the selector and why the status sits inside the heading.
     this.#header = viewHeader(on.rebind)
-    this.#text = document.createElement('pre')
-    this.#text.className = 'term'
+    this.#body = new LambdaBody({
+      toggle: (node) => this.#toggle(node),
+      link: (node) => this.#linkFrom(node),
+    })
     this.#steps = stepControls(on)
     // THE FRAME'S STEP, NOT THE WINDOW'S, for `edit a copy`. The run closure supplies the step of the
     // frame this leg is actually at, which is what design §4.1's replay reduces to.
@@ -184,7 +207,7 @@ export class LambdaPane implements EditablePane {
     // the buffer, not the pane).
     this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
     this.#header.steps.append(this.#steps.el)
-    host.replaceChildren(this.#header.el, this.#collapse.el, this.#text)
+    host.replaceChildren(this.#header.el, this.#collapse.el, this.#body.el)
 
     // λ TEXT -> SOURCE, the third direction. Delegated from the `<pre>` rather than bound per token,
     // because tokens are recreated on every draw. `data-at` carries the token's byte offset in the
@@ -193,7 +216,7 @@ export class LambdaPane implements EditablePane {
     // ONLY THE WINDOW IS CLICKABLE. A frame view has no `data-at` on anything — its text is printed at
     // `FRAME_BYTES` from a term the index's coordinates do not describe — so a click there finds no
     // attribute and does nothing, which is the correct answer rather than a guard.
-    this.#text.addEventListener('click', (event) => {
+    this.#body.el.addEventListener('click', (event) => {
       const target = event.target
       if (!(target instanceof HTMLElement)) return
       const at = target.dataset.at
@@ -204,6 +227,51 @@ export class LambdaPane implements EditablePane {
     })
   }
 
+  /**
+   * What `draw()` knows about the tree for the displayed step (spec §4). Called every frame, after `render`;
+   * the layout is reused while its inputs are unchanged.
+   */
+  renderTree(treeFor: TreeFor): void {
+    this.#treeFor = treeFor
+    this.#redraw()
+  }
+
+  #treeOf(wire: LambdaTreeWire): Tree {
+    let tree = this.#trees.get(wire)
+    if (tree === undefined) {
+      tree = new Tree(wire)
+      this.#trees.set(wire, tree)
+    }
+    return tree
+  }
+
+  #lines(tree: Tree): Line[] {
+    const width = this.#body.columns()
+    const key = `${width}:${this.#folds.version}`
+    if (this.#laidOut !== null && this.#laidOut.tree === tree && this.#laidOut.key === key) return this.#laidOut.lines
+    const lines = codeLines(tree, { width, vars: 'names', open: (i) => this.#folds.isOpen(tree, i) })
+    this.#laidOut = { key, tree, lines }
+    return lines
+  }
+
+  #shownTree(): Tree | null {
+    const t = this.#treeFor
+    return t.kind === 'tree' || t.kind === 'stale' ? this.#treeOf(t.tree) : null
+  }
+
+  #toggle(node: number): void {
+    const tree = this.#shownTree()
+    if (tree === null) return
+    this.#folds.toggle(tree, node)
+    this.#redraw()
+  }
+
+  #linkFrom(node: number): void {
+    const tree = this.#shownTree()
+    const id = tree?.linkedAncestor(node) ?? null
+    if (id !== null) this.#onLinkNode?.(id)
+  }
+
   render(frame: LambdaState | null, controls: ControlState): void {
     this.#steps.update(controls)
     this.#frame = frame
@@ -456,6 +524,28 @@ export class LambdaPane implements EditablePane {
    */
   setBindings(options: PaneOption[], current: Binding<Leg>): void {
     this.#header.setBindings(options, current)
+    // A NEW BINDING IS A DIFFERENT TERM. Folds are keyed by path, and a path in one session's term names
+    // nothing in another's — the prototype carried a copy's folds home onto the program's tree. Called
+    // every frame, so it acts only when the binding actually changed.
+    if (current.session !== this.#bound) {
+      this.#bound = current.session
+      this.#folds.reset()
+      this.#laidOut = null
+      this.#body.attach()
+    }
+  }
+
+  /**
+   * The build this view's trees come from (`LambdaTrees.buildOf`). A new build is a new program behind the
+   * same session, so `setBindings` sees nothing change — and a path in the old program's term names nothing
+   * in the new one's, so the folds start over (spec §5.2's "and so does a new compile"). Called every
+   * frame, before `renderTree`; it acts only when the build changed.
+   */
+  setBuild(build: number | null): void {
+    if (build === this.#build) return
+    this.#build = build
+    this.#folds.reset()
+    this.#laidOut = null
   }
 
   /**
@@ -644,8 +734,6 @@ export class LambdaPane implements EditablePane {
       const w = this.#link
       const ranges = decorationRanges(w.spans, w.text)
       const map = byteToIndex(w.text)
-      // The INVERSE map, built once per render rather than per token. Encoding `text.slice(0, i)` per
-      // token would be O(n^2) over a window that can be tens of kilobytes.
       const back = indexToByte(w.text)
       const targetFrom = byteIndexAt(map, w.target.start)
       const targetTo = byteIndexAt(map, w.target.end)
@@ -656,14 +744,7 @@ export class LambdaPane implements EditablePane {
         if (r.from < at) continue
         if (r.from > at) out.push(document.createTextNode(w.text.slice(at, r.from)))
         const el = document.createElement('span')
-        // FLAT, NOT NESTED. Every token inside the target range also carries `is-linked`; a wrapper
-        // element would have to handle spans straddling the target's edges, and there is no need —
-        // the edges are token boundaries by construction (see `lambdaWindow`).
         el.className = r.from >= targetFrom && r.to <= targetTo ? `${r.className} is-linked` : r.className
-        // THE THIRD DIRECTION'S ONLY REQUIREMENT. `nodeAtLambda` speaks BYTE offsets into the full
-        // `lambdaText`, and a click gives a DOM element — so each token carries the byte offset it
-        // began at, in whole-text coordinates. Computed here rather than derived from the DOM at click
-        // time, because the window is a slice and the offsets are not the ones on screen.
         el.dataset.at = String(w.origin + (back[r.from] ?? 0))
         el.textContent = w.text.slice(r.from, r.to)
         out.push(el)
@@ -671,60 +752,17 @@ export class LambdaPane implements EditablePane {
       }
       if (at < w.text.length) out.push(document.createTextNode(w.text.slice(at)))
       if (w.clippedTail) out.push(ellipsis())
-      this.#text.replaceChildren(...out)
+      this.#body.showFlat(out)
       return
     }
-
-    const frame = this.#frame
-    if (frame === null) {
-      this.#text.replaceChildren()
+    const t = this.#treeFor
+    if (t.kind === 'tree' || t.kind === 'stale') {
+      const tree = this.#treeOf(t.tree)
+      this.#folds.advance(tree)
+      this.#body.showTree(tree, this.#lines(tree), false, [], t.kind === 'stale')
       return
     }
-    // Spans arrive as byte offsets into THIS frame's own text, so nothing here can be a keystroke
-    // behind the way the source pane's can be — but `decorationRanges` sorts, clamps, and converts
-    // byte offsets to UTF-16 indices anyway, and reusing it means one implementation of those rules
-    // rather than two. `λ` is 2 bytes and 1 UTF-16 code unit, so the conversion is not optional here:
-    // it fires on every term with a binder, not only on non-ASCII source.
-    const ranges = decorationRanges(frame.spans, frame.text)
-    // THE REDEX THIS FRAME'S OWN STEP CONTRACTED, resolved through the SAME byte-to-UTF-16 map as
-    // `ranges` above — and the range it produces stands on the CONTRACTUM, not on the redex: the path
-    // behind `redex_span` named the redex `App` in the PRE-step term, β consumed it, and what occupies
-    // that path in the term this frame prints is the subterm the step produced (see `types.ts`'s
-    // `redex_span` doc). So `.is-redex` marks up "what just changed", which is what the pane wants.
-    // `frame.redex_span` is bytes, exactly like `frame.spans`, so converting it any other way (or not
-    // at all) is the identical mistake `decorationRanges` exists to rule out here.
-    // Built only when there is a span to convert: most frames at step 0 or past the truncation cut
-    // carry `null`, and `byteToIndex` walking the text for nothing would be wasted on every one of them.
-    let redexFrom = -1
-    let redexTo = -1
-    if (frame.redex_span !== null) {
-      const map = byteToIndex(frame.text)
-      redexFrom = byteIndexAt(map, frame.redex_span.start)
-      redexTo = byteIndexAt(map, frame.redex_span.end)
-    }
-    const out: Node[] = []
-    let at = 0
-    for (const r of ranges) {
-      if (r.from < at) continue
-      if (r.from > at) out.push(document.createTextNode(frame.text.slice(at, r.from)))
-      const el = document.createElement('span')
-      // FLAT, NOT NESTED — the same reason `renderLink`'s `is-linked` is flat: every token inside the
-      // redex also carries `is-redex`, rather than a wrapper element that would have to handle a token
-      // straddling the redex's edges. `redexTo > redexFrom` guards the degenerate `redexFrom === redexTo`
-      // case the same way `decorationRanges` itself does for a zero-width span.
-      el.className =
-        redexTo > redexFrom && r.from >= redexFrom && r.to <= redexTo ? `${r.className} is-redex` : r.className
-      el.textContent = frame.text.slice(r.from, r.to)
-      out.push(el)
-      at = r.to
-    }
-    if (at < frame.text.length) out.push(document.createTextNode(frame.text.slice(at)))
-    if (frame.cut !== null) {
-      const more = document.createElement('span')
-      more.className = 'truncated'
-      more.textContent = frame.cut === 'Depth' ? ' … too deep' : ' … truncated'
-      out.push(more)
-    }
-    this.#text.replaceChildren(...out)
+    const note = t.kind === 'refused' ? `this step’s term has ${t.nodes.toLocaleString()} nodes — shown as text` : null
+    this.#body.showText(this.#frame, note)
   }
 }
diff --git a/web/src/main.ts b/web/src/main.ts
index f17f7f2..2b2389b 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1728,6 +1728,7 @@ async function main(): Promise<EditorView> {
     sessions,
     panes,
     links: linkWiring,
+    trees,
     leaves: () => leaves(tree).length,
     sourceAvailable: () => !leaves(tree).some((l) => l.pane === 'source'),
     // WRAPPED RATHER THAN PASSED AS `custody.hasEditor`, the same shape `editorHome` below uses for
diff --git a/web/src/scratch-editor.ts b/web/src/scratch-editor.ts
index 15723e8..33cfb4e 100644
--- a/web/src/scratch-editor.ts
+++ b/web/src/scratch-editor.ts
@@ -116,9 +116,9 @@ export type ScratchEditorConfig = {
  * gate can see it, which `session-worker.ts` is not.
  *
  * **TWO COLOURING PATHS ON ONE PANE, ON DIFFERENT CLOCKS, AND THE OLDER ARGUMENT IS STILL HALF TRUE.**
- * The pane's `<pre>` colours tokens from `spans`, which the worker computes per frame from a term it
- * holds, and **that path is unchanged** — its frame is a printed term, so its colouring is a fact about
- * what the worker last sent. What this class used to carry was the conclusion drawn from that: an
+ * The λ view's flat text colours tokens from `spans`, which the worker computes per frame from a term
+ * it holds, and **that path is unchanged** — its frame is a printed term, so its colouring is a fact about
+ * what the worker last sent. (A drawn tree colours by token kind instead; `lambda-body.ts`.) What this class used to carry was the conclusion drawn from that: an
  * editor's buffer is text the user is halfway through typing, there is no frame for it, and a colouring
  * computed from printed output is stale the instant the user types. That half still holds, and it is
  * exactly why the frame's spans are not reused here.
diff --git a/web/src/spans.ts b/web/src/spans.ts
index fd818ee..c7b2c44 100644
--- a/web/src/spans.ts
+++ b/web/src/spans.ts
@@ -56,8 +56,9 @@ export function byteIndexAt(map: Uint32Array, byteOffset: number): number {
  * **THE λ PANE'S RENDERED FRAME IS THE CALLER, AND SINCE PLAN 7 PART 3b IT IS THE ONLY ONE.** This used
  * to colour the SOURCE EDITOR too, from `classify_source`'s spans, through a state field that no longer
  * exists in `highlight.ts`; both are gone — the three editors take `colour.ts`'s `treeSitterColour`,
- * whose offsets are already UTF-16 code units and must NOT come through here. What is left is the
- * pane's `<pre>`, whose spans the worker computes per frame from a term it holds, in bytes.
+ * whose offsets are already UTF-16 code units and must NOT come through here. What is left is the λ
+ * view's flat text (`lambda-body.ts`'s `flatText`, shown until a step's tree arrives), whose spans the
+ * worker computes per frame from a term it holds, in bytes.
  *
  * TWO RULES THAT LOOK LIKE PARANOIA AND ARE NOT. `RangeSetBuilder` throws on an out-of-order add, and
  * the lexer's ordering is an assumption this module cannot verify — so it sorts. And the document the
diff --git a/web/src/style.css b/web/src/style.css
index 08aaed8..7e22835 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -618,13 +618,87 @@ button.view-title[aria-expanded="true"] {
   border-color: var(--fg-dim);
 }
 
+/* THE λ VIEW'S BODY (Plan 7 part 4a): a laid-out term virtualized by line, or a frame's flat text.
+   `.pane` is not a flex column, so the body takes an explicit bound for the reason `.state-table` does:
+   unbounded, its spacer would grow to every line's height. */
 .term {
+  position: relative;
   font-family: var(--font-mono);
   font-size: var(--step--1);
-  white-space: pre-wrap;
-  overflow-wrap: anywhere;
   margin: 0;
   min-height: 6lh;
+  max-height: 60vh;
+  overflow: auto;
+}
+.term-flat {
+  white-space: pre-wrap;
+  overflow-wrap: anywhere;
+}
+.term-spacer {
+  position: relative;
+}
+.term-rows {
+  position: absolute;
+  inset-inline: 0;
+  top: 0;
+}
+/* `LINE_HEIGHT` in `lambda-body.ts` is this height; the virtual window's arithmetic assumes it. */
+.term-line {
+  height: 20px;
+  line-height: 20px;
+  white-space: pre;
+  padding-inline-start: 2ch;
+}
+/* THE GUTTER SITS IN THE LINE'S PADDING, pulled back by its own width, so indentation stays the line's
+   `padding-inline-start` and neither the glyph nor the indent is text a reader of `.term` would read. */
+.term-gutter {
+  display: inline-block;
+  width: 2ch;
+  margin-inline-start: -2ch;
+  color: var(--fg-dim);
+  cursor: pointer;
+  user-select: none;
+}
+.term-gutter[data-open="true"]::before {
+  content: "▾";
+}
+.term-gutter[data-open="false"]::before {
+  content: "▸";
+}
+.term:focus-visible .term-line.is-active {
+  box-shadow: inset 2px 0 0 var(--focus-ring);
+}
+.term-chip,
+.term-fold {
+  cursor: pointer;
+}
+/* A Church numeral's bar, drawn by CSS rather than a combining character (Plan 7 part 1's spec). */
+.term-chip.tok-nat {
+  text-decoration: overline;
+}
+.term-fold {
+  color: var(--fg-dim);
+  font-style: italic;
+}
+/* A mark's words for a screen reader, where the mark starts: generated content, so they are read aloud
+   and are not part of `.term`'s text; clipped away, so they are not seen. `lambda-body.ts`'s `MARKS`. */
+.term [data-marks]::before {
+  content: attr(data-marks);
+  position: absolute;
+  width: 1px;
+  height: 1px;
+  overflow: hidden;
+  clip-path: inset(50%);
+  white-space: nowrap;
+}
+/* A tree for another step, shown until this step's arrives — dimmed, and `aria-busy` says why. */
+.term[data-stale] .term-rows {
+  opacity: 0.7;
+}
+.term-note {
+  color: var(--fg-dim);
+  font-style: italic;
+  margin: var(--space-1) 0 0;
 }
 
 /* Design §4.2's upper region — the editor scrolls rather than pushing the term off the pane. */
@@ -1136,7 +1210,7 @@ button.view-title[aria-expanded="true"] {
 
 /* The RUNNING FOCUS on the delta table: the state header `state-table.ts`'s `focusedRows` marks for
    whichever construct `TmState.source_node` names as the CURRENT δ-step's own (`main.ts`'s `draw()`).
-   SAME HUE AS `.is-focus-exact`/`.term .is-redex` (`--tok-operator`) — all three panes' "what the
+   SAME HUE AS `.is-focus-exact`/`.term .is-contractum` (`--tok-operator`) — all three panes' "what the
    current step is working on" read as one system rather than three independently invented ones.
 
    LAYERED BETWEEN `.is-linked` AND `.is-current`/`.is-firing` BELOW, same reasoning as the comment on
@@ -1250,20 +1324,20 @@ button.view-title[aria-expanded="true"] {
   -webkit-box-decoration-break: clone;
 }
 
-/* The redex THIS FRAME'S OWN STEP CONTRACTED, in the λ pane's FRAME view (not the link window above,
-   which is a different coordinate system — see `lambda-pane.ts`'s `#redraw`). Same hue as `.is-focus-
-   exact` (`--tok-operator`): both are "what the current step just did", one in the source pane and one
-   here, and sharing a colour reads as one running-focus system across the two panes rather than two
-   independently-invented ones.
-
-   THE CLASS IS NAMED FOR THE REDEX AND THE TEXT UNDER IT IS THE CONTRACTUM. `redex_span` is the
-   REDEX'S path resolved against this frame's POST-step term (see `types.ts`'s field doc), and β
-   consumed the redex `App` — so what actually lights up here is the subterm the step PRODUCED. That is
-   why the hue matches `.is-focus-exact` rather than sitting apart: both say "what just changed". */
-.term .is-redex {
+/* THE TWO REDEX MARKS, ONE SHAPE EACH, so neither is carried by colour alone (Plan 7 part 1's rule).
+   The CONTRACTUM — what the step just produced, which the frame's `redex_span` has always marked — keeps
+   the wash and underline it had as `.is-redex`, in the same hue as `.is-focus-exact`: both say "what the
+   current step just did". The NEXT REDEX — what the next step contracts, which only the tree knows — is
+   a dashed outline: an `outline`, not a `box-shadow`, so it composes with the other two marks' shadows
+   instead of replacing them. */
+.term .is-contractum {
   background: color-mix(in oklab, var(--tok-operator) 22%, transparent);
   box-shadow: inset 0 -2px 0 var(--tok-operator);
 }
+.term .is-next-redex {
+  outline: 1px dashed var(--tok-operator);
+  outline-offset: -1px;
+}
 
 /* The layout tree's containers and dividers.
 
````

- [ ] **Step 5: Run the whole web suite.**

Run: `cd web && pnpm run typecheck && PATH=/usr/sbin:$PATH systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 pnpm exec vitest run`
Expected: every file passes. The three new browser files: `lambda-body` 11, `lambda-display` 2, `lambda-tree-app` 6; the node tier 635. The app file takes about a minute (its tripwire compiles a 600-element list).

- [ ] **Step 6: Sabotage, one at a time, reverting after each.** Browser runs: `PATH=/usr/sbin:$PATH pnpm exec vitest run --project browser <file>`.

| Sabotage | File run | Fails |
|---|---|---|
| `lambda-trees.ts`: delete `if (client.awaitingRun) return this.#held(this.#entries.get(session), step)` | `lambda-tree-app` | `draws the new program’s tree after a recompile`, `lays out the deepest term…`, `starts a new compile from the automatic folds` |
| `lambda-body.ts`: `const top = at < 0 ? null : this.#follow.targetScrollTop(…)` → `const top = null as number \| null` | `lambda-body` | `draws only the rows in view, and follows the next redex…`, `keeps following when a shorter term clamps…` |
| `lambda-body.ts`: delete ``if (starting.length > 0) span.dataset.marks = `${starting.join(' ')} ` `` | `lambda-body` | `marks the next redex and the contractum each with its own shape, and says so to a screen reader` |
| `lambda-body.ts`: `const OVERSCAN = 6` → `const OVERSCAN = 100000` | `lambda-body` | `draws only the rows in view…` |
| `lambda-body.ts`: `if (this.el.scrollTop !== mine) this.#follow.onProgrammaticScroll(this.el.scrollTop)` → `void mine` | `lambda-body` | `keeps following when a shorter term clamps the scroll position` |
| `lambda-body.ts`: delete `this.el.dataset.stale = 'true'` | `lambda-body` | `says a tree for another step is stale while it waits` |
| `lambda-pane.ts`, `setBindings`: delete `this.#folds.reset()` | `lambda-display` | `keeps its folds while bound to one session…` |
| `lambda-pane.ts`, `setBindings`: `if (current.session !== this.#bound) {` → `if (true) {` | `lambda-display` | `keeps its folds while bound to one session…` |
| `draw.ts`: delete `pane.setBuild(trees.buildOf(session))` | `lambda-tree-app` | `starts a new compile from the automatic folds` |
| `lambda-pane.ts`, `setBuild`: delete `this.#folds.reset()` | `lambda-display`, `lambda-tree-app` | `keeps its folds through one build…`, `starts a new compile from the automatic folds` |

**THE SCROLL CLAMP WAS FOUND BY RUNNING, AND ITS FIX MOVED TWICE.** A shrinking term clamps `scrollTop`, and the browser reports the clamp as a scroll, which `Follow` read as the user scrolling away. The old rows are absolutely positioned far down and hold the scroll height up until they are replaced, so the clamp happens only after the replacement — detecting it before, or reading the viewport before the spacer's resize, both missed it.

- [ ] **Step 7: Look at it.** `pnpm run dev`, load `fact(3)`, and step through a few reductions in each of the three presets, light and dark. Check:
  - the next redex's dashed outline and the contractum's underline are both visible and distinct;
  - folded lines read `… N nodes`;
  - a finished numeric run reads as its value;
  - the view follows the redex while playing.

  Screenshot one step per preset for the task report. `textContent` passing says nothing about what the letters look like (the repository's `λ`→`Λ` lesson).

- [ ] **Step 8: Commit.**

```bash
git add web/src web/tests
git commit -m "Web: the λ view lays out the tree for the step it shows, marks the next redex and the contractum each with its own shape, follows the redex, and starts its folds over on a new term"
```

---

### Task 9: Linking at every step, and the link window goes

**Files:**
- Delete: `web/src/lambda-window.ts`, `web/tests/node/lambda-window.test.ts`, `web/tests/browser/link-truncated.test.ts`
- Modify: `web/src/lambda-pane.ts` (`renderTree(treeFor, pin)`, `linkState()`; the window mode and `renderLink` go; `PaneEvents.linkLambda` is wired)
- Modify: `web/src/draw.ts` (hands each λ view the pin; the λ half of the status comes from the view that drew the tree)
- Modify: `web/src/link-status.ts` (`LambdaLinkState` becomes `'shown' | 'none-here' | 'too-large' | 'waiting' | 'declined' | 'absent'`)
- Modify: `web/src/link-wiring.ts` (`drawLink` takes the λ state; `lambdaLinkWindow` and the λ state it derived go)
- Modify: `web/src/link.ts` (`Link` is `{ source; states }`; `nodeAtLambda` and `lambdaSpans` go)
- Modify: `web/src/spans.ts` (`indexToByte` goes)
- Modify: `web/src/main.ts`, `pane-chrome.ts` (`linkLambda?: (node: number) => void`), `sessions.ts`, `transport.ts`, `types.ts`
- Test: `web/tests/browser/app.test.ts` (the link tests move to the tree), `lambda-pane-editor.test.ts` (the window's fork refusal goes with the window), `running-focus.test.ts` (a comment), `web/tests/node/link-status.test.ts`, `link.test.ts`, `spans.test.ts` (tests of deleted functions go)

**Interfaces:**
- Consumes: Task 5's `Tree.nodesLinkedTo` and `Tree.linkedAncestor`; Task 8's `renderTree`.
- Produces: `LambdaPane.renderTree(treeFor: TreeFor, pin: number | null = null): void`; `LambdaPane.linkState(): LambdaLinkState`; `LinkWiring.drawLink(l: Link | null, focusCoincident: boolean, lambda: LambdaLinkState)`; `type Link = { source: Span | null; states: number[] }`; `PaneEvents.linkLambda?: (node: number) => void`. Removes `lambdaWindow`, `LambdaWindow`, `LinkIndex.nodeAtLambda`, `LinkIndex.lambdaSpans`, `indexToByte`, `LambdaPane.renderLink`, `LinkWiring.lambdaLinkWindow`.

Every node carries a link or none (spec §5.4): a source click marks **every node that carries that construct at the current step**, and scrolls to the first once, if it is off screen. A click on a λ token links from its nearest linked ancestor-or-self. A construct with no node at the displayed step reads "this construct has no node in the λ term at this step". A copy is not linked, so `draw()` hands a detached view no pin. The keystroke path in `main.ts` needs no λ call: `compile.schedule` claims its generation synchronously, and the pool's `onSupersede` repaints through `draw()`, which hands each λ view the pin `clearLink` has just dropped.

- [ ] **Step 1: Write the failing tests.** Apply the tests' half of the patch:

````diff
diff --git a/web/tests/browser/app.test.ts b/web/tests/browser/app.test.ts
index 8fa6359..1ccb46c 100644
--- a/web/tests/browser/app.test.ts
+++ b/web/tests/browser/app.test.ts
@@ -577,12 +577,11 @@ describe('the app, end to end', () => {
       expect(click('lambda', '◀')?.disabled).toBe(false)
     })
 
-    // `lambdaLinkState`'S `'declined'` BRANCH, NEVER EXERCISED END TO END BEFORE THIS.
+    // THE `'declined'` λ LINK STATE, NEVER EXERCISED END TO END BEFORE THIS.
     // `link-status.test.ts` drives `linkStatus` directly with an ALREADY-DECIDED state, and every other
     // link test in this file clicks a construct under a program whose λ leg is available — so the
-    // "ORDERED MOST-GLOBAL FIRST" branch order `link-wiring.ts`'s `lambdaLinkState` doc claims (`declined`
-    // checked before the play head, before the span, before truncation) was verified only by
-    // inspection. `LAMBDA_DECLINES` is this file's own λ-declining fixture, reused rather than invented
+    // order `draw.ts`'s `createDraw` asks in (no view, then a declined program, then the view's own
+    // answer) was verified only by inspection. `LAMBDA_DECLINES` is this file's own λ-declining fixture, reused rather than invented
     // — its λ backend refuses the whole PROGRAM, so whatever source construct is clicked must report
     // `'declined'`, not merely "no link" or one of the narrower absences.
     it('reports the declined state when linking a construct under a λ-declining program', async () => {
@@ -594,7 +593,8 @@ describe('the app, end to end', () => {
       await settled(view, 'let x = 40; x + 2')
     })
 
-    // `lambdaLinkState`'S `'truncated'` BRANCH IS NOT COVERED END TO END HERE — TRIED, AND SKIPPED.
+    // THE `'too-large'` λ LINK STATE IS NOT COVERED END TO END HERE, AND NEITHER WAS `'truncated'`, THE
+    // STATE IT REPLACED (Plan 7 part 4a) — TRIED, AND SKIPPED, on the one program shape that reaches either.
     // `let x = 20000; x + 1` was the candidate (this language lowers naturals to unary Church numerals,
     // so one literal is O(n) bytes of printed λ text): verified directly against `LinkIndex::build`
     // (`redextape-core`) and against `redextape-wasm`'s own `Session`, natively, that this exact program
@@ -689,30 +689,26 @@ describe('the app, end to end', () => {
       expect(stepText('lambda')).toContain('step 1')
     })
 
-    // `drawLink()` USED TO RUN ONLY FROM `setLinkTo` AND FROM `onReply`'S ARMS, NEVER FROM `draw()` —
-    // so a link made at step 0 kept reporting step 0 forever, through every `back`/`forward`/`play`/
-    // `restart` click, because none of those call `drawLink()` on their own. `link-status.ts`'s
-    // `not-step-0` message exists specifically to say "you moved off step 0"; wired that way, it could
-    // never fire from stepping alone.
-    it('reports the step-0 restriction once the play head leaves it, not only at link time', async () => {
+    // LINKING AT EVERY STEP (Plan 7 part 4a). This test pinned the sentence that said the λ link was
+    // defined at step 0 only; the tree carries the constructs an `App` still owns at any step, so a later
+    // step links what reduction has not yet rewritten away — and says so, per step, for what it has.
+    // `drawLink()` runs from `draw()`, so the sentence follows the play head without a click.
+    it('links a construct at a later step while the term still carries it, and says when it no longer does', async () => {
       await settled(view, 'let x = 40; x + 2')
-      // Recording follows to the frontier (step 7 — see the first test in this block); the λ link is
-      // only ever defined at step 0, so land there before linking anything.
       click('lambda', '↺')
-      expect(stepText('lambda')).toContain('step 0')
-
-      // The second `x` in `x + 2`, a `Var` reference — any construct works here, since `lambdaLinkState`
-      // checks the play head BEFORE it ever asks whether this particular node has a λ span (`link-wiring.ts`'s
-      // ordering comment: "ORDERED MOST-GLOBAL FIRST").
-      linkAt(view, 'let x = 40; x + 2'.indexOf('x + 2'))
-      // Resolved to a real node, not a click that landed on nothing — the concrete, pane-independent
-      // signal `linkMark` leaves in the source.
-      expect(document.querySelector('.cm-editor .linked')).not.toBeNull()
-      expect(linkStatusText()).not.toContain('only defined at step 0')
-
       click('lambda', '▶')
       expect(stepText('lambda')).toContain('step 1')
-      expect(linkStatusText()).toContain('the λ link is only defined at step 0')
+      await lambdaSettled()
+      linkAt(view, 'let x = 40; x + 2'.indexOf('+'))
+      await until(() => document.querySelector('[data-leaf="lambda-0"] .term .is-linked') !== null, 'x + 2 at step 1')
+      expect(linkStatusText()).not.toContain('no node in the λ term')
+
+      // THE FRONTIER IS THE NORMAL FORM — the chip `42` — and nothing the source wrote survives into it.
+      for (let s = 1; s < 7; s += 1) click('lambda', '▶')
+      expect(stepText('lambda')).toContain('step 7')
+      await lambdaSettled()
+      expect(document.querySelector('[data-leaf="lambda-0"] .term .is-linked')).toBeNull()
+      expect(linkStatusText()).toContain('this construct has no node in the λ term at this step')
     })
 
     // FIX 2's PRIMARY-DIRECTION PROOF: design decision 3's "source -> both", the primary direction of
@@ -722,12 +718,13 @@ describe('the app, end to end', () => {
     // OUT without ever asserting any exist — its own `tokens.length > 0` would pass even if `.is-linked`
     // were never applied to anything. Nothing anywhere asserted that a SOURCE-originated link actually
     // paints the λ window and the δ table, not only the source echo.
-    it('a source-originated link lights both the λ window and the δ table', async () => {
+    it('a source-originated link lights both the λ view and the δ table', async () => {
       await settled(view, 'let x = 40; x + 2')
-      // The λ window only ever renders at step 0 (`lambdaLinkWindow`'s gate) — `settled` leaves the
-      // head at the frontier (step 7), so restart before linking anything.
+      // STEP 0, WHERE EVERY CONSTRUCT HAS A NODE: `settled` leaves the head at the frontier, the chip `42`,
+      // which carries none.
       click('lambda', '↺')
       expect(stepText('lambda')).toContain('step 0')
+      await lambdaSettled()
 
       // The second `x` in `x + 2`, a `Var` reference that reads the let-bound value — verified directly
       // against the running app to own both a λ span and at least one machine state.
@@ -750,9 +747,10 @@ describe('the app, end to end', () => {
     // did: a version that needed one would be proving the wrong thing.
     it('clears all three panes on an edit, not only the source echo, and says linking will resume', async () => {
       await settled(view, 'let x = 40; x + 2')
-      // The λ window only ever renders at step 0 — restart so this test can prove the λ pane was
-      // actually painted before the edit, not merely that it stayed absent the whole time.
+      // Step 0, so this test can prove the λ view was actually painted before the edit, not merely that
+      // it stayed unmarked the whole time.
       click('lambda', '↺')
+      await lambdaSettled()
       linkAt(view, 'let x = 40; x + 2'.indexOf('x + 2'))
       await until(() => linkedSource() !== '')
       await until(() => document.querySelector('.term .is-linked') !== null)
@@ -769,32 +767,28 @@ describe('the app, end to end', () => {
       await settled(view, 'let x = 40; x + 2')
     })
 
-    // TASK 11's PROOF: the third link direction, λ token -> source. The λ window only ever renders at
-    // step 0 (`lambdaLinkWindow`'s gate, same as the test above), so the head is parked there first.
-    it('clicking a token in the lambda window lights the specific source construct it names', async () => {
+    // THE THIRD LINK DIRECTION, λ -> SOURCE: a click on a token links the construct its node belongs to —
+    // its own link, or its nearest ancestor's (`Tree.linkedAncestor`, the innermost, as `nodeAtLambda`
+    // answered for the step-0 window this replaced).
+    it('clicking a λ token lights the specific source construct its node belongs to', async () => {
       await settled(view, 'let x = 40; x + 2')
       click('lambda', '↺')
-      expect(stepText('lambda')).toContain('step 0')
+      await lambdaSettled()
 
       linkAt(view, 12)
-      await until(() => document.querySelector('.term [data-at]') !== null)
+      await until(() => document.querySelector('[data-leaf="lambda-0"] .term .is-linked') !== null)
+      const first = linkedSource()
 
-      // Pick a token that is NOT the current target, so the assertion is that the click moved the link
-      // rather than that it left it alone.
-      const tokens = [...document.querySelectorAll<HTMLElement>('.term [data-at]')].filter(
-        (el) => !el.classList.contains('is-linked'),
+      // The first token of the first line — a node the target does not contain, so the assertion is that
+      // the click moved the link rather than that it left it alone.
+      const token = document.querySelector<HTMLElement>(
+        '[data-leaf="lambda-0"] .term-line [data-node]:not(.term-gutter)',
       )
-      expect(tokens.length, 'the window must show more than the target alone').toBeGreaterThan(0)
-      tokens[0]?.click()
-      await until(() => linkedSource() !== '')
-
-      // THE SPECIFIC CONSTRUCT, NOT MERELY "IT CHANGED". The previous version of this test only checked
-      // `linkedSource() !== first` (the target's own source, `"x"`) — satisfied by ANY resolution that
-      // differs from the original target, including a wrong one. `tokens[0]` is the window's very first
-      // token, `(` at byte offset 0 of `lambdaText`; resolving it against `main.ts`'s
-      // `let x = 40; x + 2` names the enclosing `let` binding — verified directly against the running
-      // app. A regression in `nodeAtLambda`/`data-at` resolution now has to reproduce this exact string
-      // to keep passing, not merely produce something other than `"x"`.
+      expect(token?.classList.contains('is-linked')).toBe(false)
+      token?.click()
+      await until(() => linkedSource() !== first)
+      // THE SPECIFIC CONSTRUCT, measured against the running app: the first token is the root application's
+      // head, the `let`'s own lowering — the same answer the step-0 window gave for its first token.
       expect(linkedSource()).toBe('let x = 40;')
       expect(view.state.doc.toString()).toContain(linkedSource())
     })
diff --git a/web/tests/browser/lambda-pane-editor.test.ts b/web/tests/browser/lambda-pane-editor.test.ts
index 6525bd2..41121e3 100644
--- a/web/tests/browser/lambda-pane-editor.test.ts
+++ b/web/tests/browser/lambda-pane-editor.test.ts
@@ -4,12 +4,11 @@ import type { PaneEvents } from '../../src/pane-chrome'
 import type { LambdaState } from '../../src/types'
 
 /**
- * Design §4.2's split body: the editor mounted (or not) above the existing frame renderer, and §4.1's
- * new refusal — a pane showing a link window must not offer a fork, now that `detach` carries a step
- * rather than the pane's own body text (`lambda-pane.ts`'s `#refreshDetach` doc).
+ * Design §4.2's split body: the editor mounted (or not) above the existing frame renderer, and when
+ * the fork control is offered (`lambda-pane.ts`'s `#refreshDetach` doc).
  *
  * PANES ARE CONSTRUCTED DIRECTLY, matching `view-status.test.ts`'s idiom: this is chrome and body
- * wiring built in the constructor and moved by `setEditor`/`render`/`renderLink` directly, with
+ * wiring built in the constructor and moved by `setEditor`/`render` directly, with
  * nothing on the path to it that needs `main()`.
  */
 const host = (): HTMLElement => {
@@ -101,20 +100,13 @@ describe('LambdaPane editor region', () => {
     expect(el.querySelector('[data-panel="text"] .panel-toggle')?.getAttribute('aria-expanded')).toBe('true')
   })
 
-  it('offers no fork while a link window is showing', () => {
-    // The guard that used to hold for free, before `detach` carried a step (T5).
+  // THE REFUSAL THIS FILE USED TO PIN IS GONE WITH THE LINK WINDOW (Plan 7 part 4a): the view shows the
+  // frame's own step, as a tree or as text, and there is no second body a fork could be taken from.
+  it('offers a fork once a frame is on screen, and not before', () => {
     const el = host()
     const pane = new LambdaPane(el, events())
+    expect(el.querySelector('button.detach')).toBeNull()
     pane.render(lambdaState(), CONTROLS)
     expect(el.querySelector('button.detach')).not.toBeNull()
-    pane.renderLink({
-      text: '\\x. x',
-      spans: [],
-      target: { start: 0, end: 1 },
-      origin: 0,
-      clippedHead: false,
-      clippedTail: false,
-    })
-    expect(el.querySelector('button.detach')).toBeNull()
   })
 })
diff --git a/web/tests/browser/running-focus.test.ts b/web/tests/browser/running-focus.test.ts
index e499f87..4b0a89e 100644
--- a/web/tests/browser/running-focus.test.ts
+++ b/web/tests/browser/running-focus.test.ts
@@ -182,9 +182,8 @@ describe('the running focus', () => {
   // FILE its own page and worker; `app.test.ts` runs ~40 tests against one long-lived pair, and two
   // previous slices (5b, and the print-depth cap) each found that a program needing many steps
   // degrades badly there against a fresh page — a worker's print stack ceiling settles lower after its
-  // first deep print, so which program settles depends on run order within the worker. See
-  // `link-truncated.test.ts`'s own file comment for the full account. These tests walk two programs to
-  // their frontier and back, several times each.
+  // first deep print, so which program settles depends on run order within the worker. These tests
+  // walk two programs to their frontier and back, several times each.
   beforeAll(async () => {
     window.addEventListener('error', (e) => pageErrors.push(`error: ${e.message}`))
     window.addEventListener('unhandledrejection', (e) => pageErrors.push(`rejection: ${String(e.reason)}`))
diff --git a/web/tests/node/link-status.test.ts b/web/tests/node/link-status.test.ts
index d77b16c..09e4734 100644
--- a/web/tests/node/link-status.test.ts
+++ b/web/tests/node/link-status.test.ts
@@ -12,19 +12,15 @@ describe('linkStatus', () => {
     )
   })
 
-  it('distinguishes the four reasons the lambda pane shows no link', () => {
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'truncated', focus: false })).toBe(
-      'the λ term is truncated before this construct',
+  it('distinguishes the reasons the λ view shows no link', () => {
+    expect(linkStatus({ state: 'linked', tm: true, lambda: 'none-here', focus: false })).toBe(
+      'this construct has no node in the λ term at this step',
     )
-    // `'unmapped'` IS WORDED DIFFERENTLY FROM `'truncated'` ON PURPOSE — see `LambdaLinkState`'s own
-    // doc. Reporting a truncation frontier that is not there ("truncated before this construct") when
-    // the real cause is that the node was never mapped at all would be checkably false.
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'unmapped', focus: false })).toBe(
-      'this construct has no recorded position in the λ term',
-    )
-    expect(linkStatus({ state: 'linked', tm: true, lambda: 'not-step-0', focus: false })).toBe(
-      'the λ link is only defined at step 0 — restart the λ view to see it',
+    expect(linkStatus({ state: 'linked', tm: true, lambda: 'too-large', focus: false })).toBe(
+      'the λ term at this step is too large to lay out',
     )
+    // `'waiting'` SAYS NOTHING: a tree one round trip away is a moment, not a state to explain.
+    expect(linkStatus({ state: 'linked', tm: true, lambda: 'waiting', focus: false })).toBe('')
     expect(linkStatus({ state: 'linked', tm: true, lambda: 'declined', focus: false })).toBe(
       'this program has no λ lowering, so no construct has a λ link',
     )
@@ -117,8 +113,7 @@ describe('linkStatus · detachment', () => {
     )
   })
 
-  // ORDERED MOST-GLOBAL FIRST, the rule `link-wiring.ts`'s `lambdaLinkState` states for its own three-way
-  // choice: a pane being outside the correspondence entirely is a bigger fact than anything about
+  // ORDERED MOST-GLOBAL FIRST, the rule `draw.ts`'s `createDraw` follows for the λ state: a pane being outside the correspondence entirely is a bigger fact than anything about
   // what resolved inside it, and every clause after it is about the panes still inside.
   it('reports detachment ahead of the pin narration', () => {
     expect(linkStatus({ state: 'stale', detached: { lambda: true, tm: false } })).toBe(
@@ -128,14 +123,14 @@ describe('linkStatus · detachment', () => {
 
   // §4.5's standard, applied to the clauses themselves: "a thing that provably cannot work should not
   // be presented as though it might". A detached λ pane is showing a scratch term, so
-  // `LAMBDA_TEXT['truncated']` would describe a truncation in a term that is not on screen — while
+  // `LAMBDA_TEXT['none-here']` would describe a term that is not on screen — while
   // the TM clause, whose pane is still bound to the source session, stays.
   it('suppresses the λ clause for a detached λ pane and keeps the TM one', () => {
     expect(
       linkStatus({
         state: 'linked',
         tm: false,
-        lambda: 'truncated',
+        lambda: 'none-here',
         focus: false,
         detached: { lambda: true, tm: false },
       }),
@@ -150,11 +145,11 @@ describe('linkStatus · detachment', () => {
       linkStatus({
         state: 'linked',
         tm: false,
-        lambda: 'truncated',
+        lambda: 'none-here',
         focus: true,
         detached: { lambda: false, tm: true },
       }),
-    ).toBe('TM view shows a copy — not linked to the program · the λ term is truncated before this construct')
+    ).toBe('TM view shows a copy — not linked to the program · this construct has no node in the λ term at this step')
   })
 
   it('leaves only the detachment clause when both panes are detached', () => {
diff --git a/web/tests/node/link.test.ts b/web/tests/node/link.test.ts
index 89ea8a3..14c115b 100644
--- a/web/tests/node/link.test.ts
+++ b/web/tests/node/link.test.ts
@@ -66,15 +66,6 @@ describe('LinkIndex.nodeAtSource', () => {
   })
 })
 
-describe('LinkIndex.nodeAtLambda', () => {
-  it('the innermost containing span wins', () => {
-    const ix = new LinkIndex(wire())
-    expect(ix.nodeAtLambda(6)).toBe(102)
-    expect(ix.nodeAtLambda(2)).toBe(101)
-    expect(ix.nodeAtLambda(9)).toBe(100)
-  })
-})
-
 describe('LinkIndex.nodeForState', () => {
   it('resolves an owner and reports -1 as null', () => {
     const ix = new LinkIndex(wire())
@@ -95,7 +86,6 @@ describe('LinkIndex.linkFor', () => {
     const ix = new LinkIndex(wire())
     expect(ix.linkFor(100)).toEqual({
       source: { start: 0, end: 17 },
-      lambda: { start: 0, end: 10 },
       states: [1, 3],
     })
   })
@@ -106,38 +96,7 @@ describe('LinkIndex.linkFor', () => {
     expect(ix.linkFor(102).states).toEqual([])
     expect(ix.linkFor(102).source).toEqual({ start: 12, end: 17 })
     // A node nobody has heard of.
-    expect(ix.linkFor(999)).toEqual({ source: null, lambda: null, states: [] })
-  })
-
-  it('a node whose lambda subterm fell past the cut has a source span and no lambda span', () => {
-    const ix = new LinkIndex(
-      wire({
-        lambdaCut: 'Bytes',
-        lambdaNodeStart: new Uint32Array([0]),
-        lambdaNodeEnd: new Uint32Array([10]),
-        lambdaNodeId: new Uint32Array([100]),
-      }),
-    )
-    expect(ix.linkFor(101).lambda).toBeNull()
-    expect(ix.linkFor(101).source).toEqual({ start: 4, end: 5 })
-  })
-})
-
-describe('LinkIndex.lambdaSpans', () => {
-  it('rehydrates class discriminants into TokenClass names', () => {
-    const ix = new LinkIndex(wire())
-    expect(ix.lambdaSpans[0]).toEqual([{ start: 0, end: 1 }, 'Punct'])
-    expect(ix.lambdaSpans[1]).toEqual([{ start: 1, end: 3 }, 'Binder'])
-    expect(ix.lambdaSpans[3]).toEqual([{ start: 5, end: 6 }, 'Ident'])
-  })
-
-  // LAZY AND CACHED, NOT REBUILT ON EVERY READ. A getter that rehydrated the wire on every access would
-  // still pass the test above but would reintroduce the per-read allocation the laziness exists to
-  // avoid; reference equality across two reads is what distinguishes "built once, cached" from "built
-  // fresh every time this property is read".
-  it('caches the rehydrated array rather than rebuilding it on every read', () => {
-    const ix = new LinkIndex(wire())
-    expect(ix.lambdaSpans).toBe(ix.lambdaSpans)
+    expect(ix.linkFor(999)).toEqual({ source: null, states: [] })
   })
 })
 
diff --git a/web/tests/node/spans.test.ts b/web/tests/node/spans.test.ts
index cae5e5c..f7a35a4 100644
--- a/web/tests/node/spans.test.ts
+++ b/web/tests/node/spans.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest'
-import { byteToIndex, decorationRanges, indexToByte } from '../../src/spans'
+import { byteToIndex, decorationRanges } from '../../src/spans'
 import type { Classified } from '../../src/types'
 
 const at = (start: number, end: number, cls: Classified[number][1]): Classified[number] => [{ start, end }, cls]
@@ -164,53 +164,3 @@ describe('byteToIndex', () => {
     expect(Array.from(map)).toEqual([0, 1, 1, 1, 2, 3])
   })
 })
-
-describe('indexToByte', () => {
-  it('round-trips with byteToIndex on a term with binders', () => {
-    // `λ` is 2 bytes and 1 UTF-16 unit, which is the case that makes this non-trivial.
-    const text = '(λx. λy. x y) z'
-    const fwd = byteToIndex(text)
-    const back = indexToByte(text)
-    for (let i = 0; i <= text.length; i += 1) {
-      expect(fwd[back[i] as number]).toBe(i)
-    }
-    expect(back[back.length - 1]).toBe(new TextEncoder().encode(text).length)
-  })
-
-  // A ROUND TRIP AGAINST `byteToIndex` IS NOT ENOUGH ON ITS OWN: a converter that made the same
-  // mistake in both directions (e.g. treating every character as 1 byte) would still round-trip. This
-  // pins `indexToByte` against byte offsets counted BY HAND for a real λ-printer term, independent of
-  // `byteToIndex`'s own implementation.
-  it('matches a hand-counted byte offset for every UTF-16 index of a λ term', () => {
-    // '(λx. λy. x y) z' — 15 UTF-16 units (λ is 1 unit each). Byte lengths: '(' 1, 'λ' 2, everything
-    // else ASCII at 1 byte. Cumulative byte offset at the START of each character:
-    //   ( λ x  .  _  λ  y  .  _  x  _  y  )  _  z  <end>
-    //   0 1 3  4  5  6  8  9 10 11 12 13 14 15 16  17
-    const text = '(λx. λy. x y) z'
-    expect(text.length).toBe(15)
-    const back = indexToByte(text)
-    expect([...back]).toEqual([0, 1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
-  })
-
-  it('maps both units of a surrogate pair to the character start', () => {
-    const text = 'a\u{1F600}b'
-    const back = indexToByte(text)
-    expect([...back]).toEqual([0, 1, 1, 5, 6])
-  })
-
-  // THE ROUND TRIP ABOVE DOES NOT HOLD HERE, AND THIS PINS THE ACTUAL BEHAVIOUR RATHER THAN ASSERTING A
-  // ROUND TRIP THAT DOES NOT EXIST — see `indexToByte`'s doc. UTF-16 index 2 is the LOW half of
-  // `'a\u{1F600}b'`'s surrogate pair; `indexToByte` reports the astral character's own start byte for
-  // it (1, matching `byteToIndex`'s mid-character convention), but running that byte back through
-  // `byteToIndex` resolves to index 1 — the pair's HIGH half — not 2. Unreachable through the app's only
-  // caller (`lambda-pane.ts`'s `#redraw` only ever looks up a token's start byte, never a byte that
-  // lands mid-character), but a real fact about this function that a future change should have to break
-  // on purpose, visibly, rather than by accident.
-  it('does not round-trip a surrogate pair’s low half — pinned as-is, not asserted as a round trip', () => {
-    const text = 'a\u{1F600}b'
-    const fwd = byteToIndex(text)
-    const back = indexToByte(text)
-    expect(back[2]).toBe(1)
-    expect(fwd[back[2] as number]).toBe(1)
-  })
-})
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd web && pnpm run typecheck`
Expected: FAIL, 5 errors, all in `link-status.test.ts`: `Type '"none-here"' is not assignable to type 'LambdaLinkState'`, and the same for `"too-large"` and `"waiting"`.

Run: `pnpm exec vitest run --project node tests/node/link-status.test.ts tests/node/link.test.ts tests/node/spans.test.ts`
Expected: FAIL — 2 of the 3 files fail, 4 tests failed, 49 passed.

- [ ] **Step 3: Delete the window.**

```bash
git rm web/src/lambda-window.ts web/tests/node/lambda-window.test.ts web/tests/browser/link-truncated.test.ts
```

- [ ] **Step 4: Link through the tree.** Apply the source half of the patch:

````diff
diff --git a/web/src/draw.ts b/web/src/draw.ts
index 9dd37b2..4e8b775 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -3,6 +3,7 @@ import { setFocus } from './highlight'
 import type { LambdaPane } from './lambda-pane'
 import type { LambdaTrees } from './lambda-trees'
 import { isCoincident, type Link, runningFocus, sourceNodeOwner } from './link'
+import type { LambdaLinkState } from './link-status'
 import type { LinkWiring } from './link-wiring'
 import type { LeafId, PaneCollection } from './panes'
 import {
@@ -57,7 +58,7 @@ import type { TmPane } from './tm-pane'
  * `hasEditor: (session) => boolean` IS THE SAME SHAPE AGAIN, over the OTHER thing `main.ts` owns and
  * this module has no other route to: `editor-custody.ts`'s two maps. A λ pane cannot work out whether
  * its session has an editor anywhere — that is a fact about other panes and about the editors waiting
- * between them — so `LambdaPane.setEditorAvailable` is fed from here, per frame, alongside `renderLink`.
+ * between them — so `LambdaPane.setEditorAvailable` is fed from here, per frame, alongside `renderTree`.
  * A thunk for the same reason as its two siblings: custody moves under a `draw()` that did not cause it.
  */
 export function createDraw(deps: {
@@ -210,21 +211,18 @@ export function createDraw(deps: {
       p.pane.setStepsShown(stepsInView())
     }
 
-    // RESOLVED ONCE, HERE, AND SHARED BY BOTH CONSUMERS BELOW. `draw()` runs on every recorded frame
-    // during playback, and `index.linkFor` walks `#spanOf`/`#statesOf` over the wire's parallel
-    // arrays — not free. `drawLink` wants `states.length > 0` and the λ span (to tell `truncated` from
-    // `shown`); `lambdaLinkWindow` wants only the λ span. A separate `index.linkFor(link.node)` call in
-    // each would resolve the SAME node twice on every tick.
+    // RESOLVED ONCE, HERE, FOR `drawLink` AT THE END. `draw()` runs on every recorded frame during
+    // playback, and `index.linkFor` walks `#spanOf`/`#statesOf` over the wire's parallel arrays — not
+    // free. The λ views need none of it: each marks the pinned construct's nodes in the tree it draws.
     const l: Link | null =
       linkWiring.linkable && linkWiring.link !== null && linkWiring.index !== null
         ? linkWiring.index.linkFor(linkWiring.link.node)
         : null
-    // PER-LEG, NOT PER-PANE — every λ pane follows the same link window, resolved once and fanned out.
-    // SAME REASON AS `drawLink()` BELOW, AND NOT ONLY IN `setLinkTo`: scrubbing the λ history must
-    // withdraw the window without a click, and every stepping control routes through `draw()` rather
-    // than through `setLinkTo`.
-    const lambdaWin = linkWiring.lambdaLinkWindow(l)
-    // THE λ-ONLY PER-FRAME PASS, AND IT CARRIES TWO FACTS NOW. `renderLink` is per-leg (one window,
+    // PER-LEG, NOT PER-PANE — every λ view marks the same pinned construct, read once and fanned out.
+    // SAME REASON AS `drawLink()` BELOW, AND NOT ONLY IN `setLinkTo`: each step's tree must be marked as
+    // it arrives, and every stepping control routes through `draw()` rather than through `setLinkTo`.
+    const pin = linkWiring.linkable && linkWiring.link !== null ? linkWiring.link.node : null
+    // THE λ-ONLY PER-FRAME PASS, AND IT CARRIES TWO FACTS NOW. The pin is per-leg (one construct,
     // fanned out); `setEditorAvailable` is PER PANE, because it is a question about each pane's own
     // binding — two λ panes on two different buffers get two different answers, and two on the SAME
     // buffer get the same one, which is exactly the state the control exists to resolve.
@@ -242,8 +240,12 @@ export function createDraw(deps: {
       const session = p.slot.binding.session
       const leg = p.slot.resolve(sessions)
       pane.setBuild(trees.buildOf(session))
-      pane.renderTree(leg.hist.current === undefined ? { kind: 'none' } : trees.want(session, leg.hist.currentStep))
-      pane.renderLink(lambdaWin)
+      // A COPY IS NOT LINKED (§4.5), so it marks nothing whatever is pinned.
+      const pinned = sessions.entryOf(session).detached ? null : pin
+      pane.renderTree(
+        leg.hist.current === undefined ? { kind: 'none' } : trees.want(session, leg.hist.currentStep),
+        pinned,
+      )
       pane.setEditorAvailable(hasEditor(session))
     }
 
@@ -282,7 +284,16 @@ export function createDraw(deps: {
     // SECOND job needs `tmFocus` (resolved above the render loop) to answer whether it coincides with
     // the pin. Still "at the end" in the sense the original comment meant: everything above it is a
     // `history`/`index` read, nothing below reads `drawLink`'s output.
-    linkWiring.drawLink(l, isCoincident(linkWiring.link, tmFocus))
+    // THE λ HALF OF THE STATUS COMES FROM THE VIEW THAT DREW THE TREE (spec §5.4), after the loop above
+    // has handed it this frame's pin.
+    const activeLambda = panes.active('lambda')
+    const lambdaLink: LambdaLinkState =
+      activeLambda === undefined
+        ? 'absent'
+        : linkWiring.index === null || linkWiring.index.lambdaText === ''
+          ? 'declined'
+          : (activeLambda.pane as LambdaPane).linkState()
+    linkWiring.drawLink(l, isCoincident(linkWiring.link, tmFocus), lambdaLink)
 
     // THE READOUT (spec §9): the focused view's session. A focused source view has no pane entry
     // (`panes.get('source')` is `undefined`) and shows the program, as does any view bound to it.
diff --git a/web/src/lambda-pane.ts b/web/src/lambda-pane.ts
index 81ce673..367180e 100644
--- a/web/src/lambda-pane.ts
+++ b/web/src/lambda-pane.ts
@@ -3,30 +3,22 @@ import type { EditablePane } from './editor-custody'
 import { EDITOR_DEBOUNCE_MS } from './editor-debounce'
 import { LambdaBody } from './lambda-body'
 import { Folds } from './lambda-folds'
-import { codeLines, type Line } from './lambda-layout'
+import { codeLines, type Line, lineOf } from './lambda-layout'
 import { Tree } from './lambda-tree'
 import type { TreeFor } from './lambda-trees'
-import type { LambdaWindow } from './lambda-window'
 import type { Dir } from './layout'
+import type { LambdaLinkState } from './link-status'
 import { type PaneChoice, type PaneEvents, type SplitChoices, textPanel } from './pane-chrome'
 import type { LambdaTreeWire, Leg } from './protocol'
 import type { ScratchEditorConfig } from './scratch-editor'
 import { ScratchEditor } from './scratch-editor'
 import type { Binding, PaneOption } from './sessions'
-import { byteIndexAt, byteToIndex, decorationRanges, indexToByte } from './spans'
 import { stepControls } from './step-controls'
 import type { LambdaState } from './types'
 import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
 
 export type { PaneEvents }
 
-function ellipsis(): HTMLElement {
-  const el = document.createElement('span')
-  el.className = 'truncated'
-  el.textContent = ' … '
-  return el
-}
-
 /**
  * The λ pane: the displayed step's term, laid out from the tree the worker serves for it (Plan 7 part 4a)
  * — or, before that tree arrives and when it is refused, the frame's own text, syntax-coloured by the
@@ -71,7 +63,6 @@ export class LambdaPane implements EditablePane {
    */
   #menu: ViewMenu
   #frame: LambdaState | null = null
-  #link: LambdaWindow | null = null
   /**
    * The upper half of design §4.2's split body — a stable parent that outlives any editor mounted or
    * unmounted inside it, so `setEditor` can do both without touching the pane's own child order.
@@ -109,8 +100,12 @@ export class LambdaPane implements EditablePane {
    * invisible" split `PaneEvents.detach`'s doc draws for the fork button.
    */
   #onEdit: ((src: string) => void) | undefined
-  /** Link from a construct's id. Not yet wired to `PaneEvents.linkLambda`, so it goes nowhere. */
+  /** `PaneEvents.linkLambda`: link from a construct's id. Absent, a click on the term links nothing. */
   #onLinkNode: ((node: number) => void) | undefined
+  /** The construct `draw()` says is pinned, or `null` — this view marks every node that carries it. */
+  #pin: number | null = null
+  /** The pin the view last scrolled to, so a new pin scrolls once and a held one does not keep scrolling. */
+  #revealed: number | null = null
   /** Resolves this pane's current binding to an LSP document — see `PaneEvents.lspDocument`. */
   #lspDocument: (() => ScratchEditorConfig['document']) | undefined
   /** Resolves this pane's language to its colourer — see `PaneEvents.colour`. */
@@ -169,15 +164,10 @@ export class LambdaPane implements EditablePane {
       link: (node) => this.#linkFrom(node),
     })
     this.#steps = stepControls(on)
-    // THE FRAME'S STEP, NOT THE WINDOW'S, for `edit a copy`. The run closure supplies the step of the
-    // frame this leg is actually at, which is what design §4.1's replay reduces to.
-    //
-    // **A VIEW SHOWING A LINK WINDOW MUST NOT FORK, AND `#refreshDetach` ENFORCES IT.** A step says
-    // nothing about which of the two bodies is on screen, so the guard is an explicit condition in
-    // `#refreshDetach`, which checks `#link` alongside `#detached` and the presence of a frame. It does
-    // NOT check the frame's cut: §4.1a moved that refusal to the worker, which answers a diagnostic while
-    // this control stays offered. `pane-chrome.ts`'s `detach` doc and `#refreshDetach`'s own doc both
-    // carry the full argument.
+    // THE FRAME'S STEP for `edit a copy`. The run closure supplies the step of the frame this leg is
+    // actually at, which is what design §4.1's replay reduces to. `#refreshDetach` does NOT check the
+    // frame's cut: §4.1a moved that refusal to the worker, which answers a diagnostic while this control
+    // stays offered.
     const detach = on.detach
     this.#menu = viewMenu(this.#header.actions, {
       // REMOVED WHERE THERE IS NO EDITOR, not disabled: a view showing a running leg has no
@@ -209,33 +199,33 @@ export class LambdaPane implements EditablePane {
     this.#header.steps.append(this.#steps.el)
     host.replaceChildren(this.#header.el, this.#collapse.el, this.#body.el)
 
-    // λ TEXT -> SOURCE, the third direction. Delegated from the `<pre>` rather than bound per token,
-    // because tokens are recreated on every draw. `data-at` carries the token's byte offset in the
-    // FULL `lambdaText` (see `#redraw`), so the handler needs no knowledge of the window's slice.
-    //
-    // ONLY THE WINDOW IS CLICKABLE. A frame view has no `data-at` on anything — its text is printed at
-    // `FRAME_BYTES` from a term the index's coordinates do not describe — so a click there finds no
-    // attribute and does nothing, which is the correct answer rather than a guard.
-    this.#body.el.addEventListener('click', (event) => {
-      const target = event.target
-      if (!(target instanceof HTMLElement)) return
-      const at = target.dataset.at
-      if (at === undefined) return
-      const byteOffset = Number.parseInt(at, 10)
-      if (Number.isNaN(byteOffset)) return
-      on.linkLambda?.(byteOffset)
-    })
+    // λ -> SOURCE, the third direction: a click on any token links from the construct its node belongs to
+    // (`LambdaBody`'s `link` event, `#linkFrom`), at whatever step is on screen (Plan 7 part 4a).
+    this.#onLinkNode = on.linkLambda
   }
 
   /**
    * What `draw()` knows about the tree for the displayed step (spec §4). Called every frame, after `render`;
    * the layout is reused while its inputs are unchanged.
    */
-  renderTree(treeFor: TreeFor): void {
+  renderTree(treeFor: TreeFor, pin: number | null = null): void {
     this.#treeFor = treeFor
+    this.#pin = pin
     this.#redraw()
   }
 
+  /**
+   * What the λ half of the link status says about the pinned construct (spec §5.4): shown when a node
+   * at this step carries it, `none-here` when none does, and why there is no tree when there is none.
+   */
+  linkState(): LambdaLinkState {
+    const t = this.#treeFor
+    if (t.kind === 'refused') return 'too-large'
+    if (t.kind === 'none') return 'waiting'
+    if (this.#pin === null) return 'shown'
+    return this.#treeOf(t.tree).nodesLinkedTo(this.#pin).length > 0 ? 'shown' : 'none-here'
+  }
+
   #treeOf(wire: LambdaTreeWire): Tree {
     let tree = this.#trees.get(wire)
     if (tree === undefined) {
@@ -569,15 +559,15 @@ export class LambdaPane implements EditablePane {
    * Show or hide the `copy · not linked` status — design §4.5's second surface, paired with the sentence
    * `link-status.ts` puts in `#link-status`.
    *
-   * `setDetached`, NOT `renderDetached`, THOUGH §4.5 CALLS IT "analogous to `renderLink`". The
-   * analogy is about the shape of the call, not about what it does: `renderLink` swaps the pane's
-   * BODY between two texts in two different coordinate systems, and a `render*` name here would
-   * suggest this participates in that redraw. It does not touch `#redraw` at all — the badge is
+   * `setDetached`, NOT `renderDetached`, THOUGH §4.5 CALLS IT "analogous to `renderLink`" (the link
+   * window's setter, which Plan 7 part 4a folded into `renderTree`). The analogy is about the shape of
+   * the call, not about what it does: a `render*` name here would suggest this participates in the
+   * body's redraw. It does not touch `#redraw` at all — the badge is
    * chrome, it lives on the `<h2>`, and it is unaffected by which text the body is showing. `TmPane`
    * spells its chrome-and-highlight setters `setLink`/`setFocus`/`setProgram` for the same reason,
    * and this pane's counterpart is named to match across the two.
    *
-   * A PURE SETTER, LIKE `TmPane.setFocus` AND UNLIKE `renderLink`: nothing here needs a redraw,
+   * A PURE SETTER, LIKE `TmPane.setFocus` AND UNLIKE `renderTree`: nothing here needs a redraw,
    * because the view header repaints its heading itself and the body is the caller's separate
    * decision — a detached λ pane shows its scratch's own term, which arrives through `render` like
    * any other frame.
@@ -693,73 +683,31 @@ export class LambdaPane implements EditablePane {
    * at all to report a step against. Reading `ControlState` for the second of those would be a second
    * source for the same fact.
    *
-   * **AND IT STILL REFUSES WHILE A LINK WINDOW IS SHOWING, WHICH IS A RULE RATHER THAN A
-   * CONSEQUENCE.** The window's body is a slice of the SOURCE COMPILE's step-0 term in a different
-   * coordinate system; forking used to be safe here because the handler passed `#frame`'s text rather
-   * than the window's, and design §4.1 replaced that text with a step. A step says nothing about
-   * which of the pane's two bodies is on screen, so the refusal is stated explicitly below rather
-   * than inherited for free — this one `frame.cut` never covered and does not touch.
+   * **THE LINK WINDOW'S REFUSAL WENT WITH THE WINDOW (Plan 7 part 4a).** This also withheld the
+   * control while the step-0 link window was showing, since that body was not the step's term. The view
+   * now shows only its own step, as a tree or as text, so there is nothing left for that rule to refuse.
    */
   #refreshDetach(): void {
-    this.#menu.setCopy(!this.#detached && this.#link === null && this.#frame !== null ? 'ready' : null)
-  }
-
-  /**
-   * Show a window onto the step-0 term around a linked construct, or `null` to go back to the frame.
-   *
-   * THE LINK VIEW REPLACES THE FRAME VIEW RATHER THAN OVERLAYING IT, because they are two different
-   * texts: a frame is printed at `FRAME_BYTES` (512) and this at `LAMBDA_BYTE_BUDGET` (65,536). A
-   * highlight computed against one and drawn on the other would land on arbitrary characters.
-   */
-  renderLink(win: LambdaWindow | null): void {
-    /**
-     * GUARDS THE NO-OP CASE: when no link was active and none becomes active, both the state
-     * assignment and the redraw are unnecessary. This skips the redundant per-frame rebuild that
-     * occurs on every playback tick (because `draw()` calls both `render()` and `renderLink()`,
-     * each of which rebuilds the DOM). The remaining duplicate rebuild happens once per click,
-     * when a link IS set and then cleared, and is left for a future API revision that merges the
-     * two methods.
-     */
-    if (win === null && this.#link === null) return
-    this.#link = win
-    this.#redraw()
-    // THE FORK CONTROL IS THE OTHER THING THAT MOVES WHEN `#link` DOES — see `#refreshDetach`'s "AND
-    // IT REFUSES WHILE A LINK WINDOW IS SHOWING" arm. Skipped on the no-op path above along with the
-    // redraw, since neither `#link` nor the fork control's answer changed there.
-    this.#refreshDetach()
+    this.#menu.setCopy(!this.#detached && this.#frame !== null ? 'ready' : null)
   }
 
   #redraw(): void {
-    if (this.#link !== null) {
-      const w = this.#link
-      const ranges = decorationRanges(w.spans, w.text)
-      const map = byteToIndex(w.text)
-      const back = indexToByte(w.text)
-      const targetFrom = byteIndexAt(map, w.target.start)
-      const targetTo = byteIndexAt(map, w.target.end)
-      const out: Node[] = []
-      if (w.clippedHead) out.push(ellipsis())
-      let at = 0
-      for (const r of ranges) {
-        if (r.from < at) continue
-        if (r.from > at) out.push(document.createTextNode(w.text.slice(at, r.from)))
-        const el = document.createElement('span')
-        el.className = r.from >= targetFrom && r.to <= targetTo ? `${r.className} is-linked` : r.className
-        el.dataset.at = String(w.origin + (back[r.from] ?? 0))
-        el.textContent = w.text.slice(r.from, r.to)
-        out.push(el)
-        at = r.to
-      }
-      if (at < w.text.length) out.push(document.createTextNode(w.text.slice(at)))
-      if (w.clippedTail) out.push(ellipsis())
-      this.#body.showFlat(out)
-      return
-    }
     const t = this.#treeFor
     if (t.kind === 'tree' || t.kind === 'stale') {
       const tree = this.#treeOf(t.tree)
       this.#folds.advance(tree)
-      this.#body.showTree(tree, this.#lines(tree), false, [], t.kind === 'stale')
+      const lines = this.#lines(tree)
+      const linked = this.#pin === null ? [] : tree.nodesLinkedTo(this.#pin)
+      this.#body.showTree(tree, lines, false, linked, t.kind === 'stale')
+      // A NEW PIN IS SCROLLED TO ONCE, and only when its first node is off screen — a click in this view
+      // pins what is under the pointer, so it never moves; a source click brings the construct in.
+      if (this.#pin !== this.#revealed) {
+        this.#revealed = this.#pin
+        const first = linked[0]
+        const at = first === undefined ? -1 : lineOf(tree, lines, first)
+        const { first: top, last } = this.#body.visible
+        if (at >= 0 && (at < top || at > last)) this.#body.reveal(at)
+      }
       return
     }
     const note = t.kind === 'refused' ? `this step’s term has ${t.nodes.toLocaleString()} nodes — shown as text` : null
diff --git a/web/src/link-status.ts b/web/src/link-status.ts
index dfa9e46..251987f 100644
--- a/web/src/link-status.ts
+++ b/web/src/link-status.ts
@@ -14,21 +14,18 @@
  * there is no λ pane on screen to say anything about. Its own doc has the argument.
  */
 export type LambdaLinkState =
-  /** Shown: the play head is at step 0, the term reaches this construct, and the backend lowered it. */
+  /** Shown: a node of the term on screen carries this construct. */
   | 'shown'
-  /** The λ text stopped before reaching this construct — either the byte budget or the depth cap fired first. */
-  | 'truncated'
   /**
-   * The construct has no recorded λ position at all — DIFFERENT FROM `'truncated'`, which is a
-   * definite frontier (a byte or depth cut the walk actually hit) this is not. `LinkIndex.lambdaCut`
-   * is what tells the two apart; before this variant existed, an absent span was ASSUMED to mean
-   * truncation regardless of that flag, which reported a frontier that was not there whenever the
-   * true cause was something else (e.g. `LinkIndex.lambda_nodes` dropped the containing subterm for a
-   * reason other than the cut).
+   * No node of the term at this step carries it (Plan 7 part 4a). At step 0 every construct the map
+   * places has a node; a later step keeps only the ones an `App` still carries as its owner, since
+   * reduction rewrites the rest away.
    */
-  | 'unmapped'
-  /** The λ leg's play head has moved off step 0, where the path coordinates stop meaning anything. */
-  | 'not-step-0'
+  | 'none-here'
+  /** The term at this step is past the tree's node budget, so the view shows its flat text and marks nothing. */
+  | 'too-large'
+  /** This step's tree has not come back yet — a moment, not a state to explain. */
+  | 'waiting'
   /** The λ backend declined this PROGRAM, so no construct has a λ link. */
   | 'declined'
   /**
@@ -135,9 +132,9 @@ export type LinkStatus = {
 
 const LAMBDA_TEXT: Record<LambdaLinkState, string> = {
   shown: '',
-  truncated: 'the λ term is truncated before this construct',
-  unmapped: 'this construct has no recorded position in the λ term',
-  'not-step-0': 'the λ link is only defined at step 0 — restart the λ view to see it',
+  'none-here': 'this construct has no node in the λ term at this step',
+  'too-large': 'the λ term at this step is too large to lay out',
+  waiting: '',
   declined: 'this program has no λ lowering, so no construct has a λ link',
   absent: '',
 }
@@ -172,13 +169,14 @@ function detachedText(d: DetachedPanes): string {
  * to speaking, which is exactly §4.5's obligation.
  *
  * DETACHMENT LEADS, ahead of the coincidence that used to lead. Ordered most-global first — the rule
- * `link-wiring.ts`'s `lambdaLinkState` states for its own three-way choice — because "this pane is not part
+ * `draw.ts`'s `createDraw` follows for the λ state (no view, then a declined program, then the view's own
+ * answer) — because "this pane is not part
  * of the correspondence" scopes every clause after it: those are about the panes still inside.
  *
  * A DETACHED PANE'S OWN CLAUSES ARE SUPPRESSED, NOT MERELY PRECEDED. §4.5's standard is the one that
  * deleted `node_to_lambda`: a thing that provably cannot work should not be presented as though it
- * might. A detached λ pane is showing a scratch term, so "the λ term is truncated before this
- * construct" describes a truncation in a term that is not on screen; a detached TM pane renders
+ * might. A detached λ pane is showing a scratch term, so "this construct has no node in the λ term
+ * at this step" describes a term that is not on screen; a detached TM pane renders
  * states whose `source_node` is `null` by construction (§3.1), so neither the coincidence nor the
  * emits-no-states absence is a claim about anything the user is looking at.
  *
diff --git a/web/src/link-wiring.ts b/web/src/link-wiring.ts
index 9ffbdba..1879c8c 100644
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -1,12 +1,10 @@
 import type { EditorView } from '@codemirror/view'
 import { setLink } from './highlight'
-import { type LambdaWindow, LINK_CONTEXT, lambdaWindow } from './lambda-window'
 import type { Link, LinkIndex, Pin } from './link'
 import { type DetachedPanes, type LambdaLinkState, linkStatus } from './link-status'
 import type { PaneCollection } from './panes'
 import type { PaneSlot, SessionRegistry } from './sessions'
 import type { TmPane } from './tm-pane'
-import type { Span } from './types'
 
 /**
  * THE LINK STATE AND EVERYTHING THAT READS IT — the cluster `main.ts` held as four `let`s visible to a
@@ -31,7 +29,7 @@ export type LinkWiring = {
    * THE ONE STATE FIELD WITH A READ ACCESSOR AS WELL AS A WRITER, unlike `linkable`/`link`
    * below, which are only ever read through the narrower questions the other accessors answer.
    * `draw.ts` and the click handlers `transport.ts`'s `events(...)` builds resolve nodes straight
-   * through the index (`index.linkFor`, `index.nodeForState`, `index.nodeAtLambda`, `index.lambdaText`)
+   * through the index (`index.linkFor`, `index.nodeForState`, `index.lambdaText`)
    * for the same per-frame cost reasons `draw()`'s own comments give for resolving a `Link` once and
    * sharing it — wrapping every one of those call sites in a forwarding method here would be a second
    * name for the same call, not an encapsulation of it.
@@ -41,9 +39,9 @@ export type LinkWiring = {
    * `draw()` and the click handlers" — an argument that dissolved the moment `draw` and `events` moved
    * into modules of their own, without the conclusion changing at all. The real reason is that
    * `LinkIndex` (`link.ts`) exposes NOTHING that can change it: `lambdaText` and `lambdaCut` are
-   * `readonly`, every method (`nodeAtSource`, `nodeAtLambda`, `nodeForState`, `linkFor`) is a pure read,
-   * and the wire arrays it reads them out of are `#`-private. The one write anywhere in the class is
-   * `lambdaSpans`' own memo of a value it just derived — a cache, not a state a caller can set. So a
+   * `readonly`, every method (`nodeAtSource`, `nodeForState`, `linkFor`) is a pure read, and the wire
+   * arrays it reads them out of are `#`-private. The one write anywhere in the class is `#statesOf`'s
+   * own memo of a value it just derived — a cache, not a state a caller can set. So a
    * holder of this reference can ask it questions and nothing else, whoever they are and wherever they
    * live. WRITES to the FIELD stay confined to this module (`setIndex` is the only one); this getter is
    * what keeps reads legitimate everywhere else.
@@ -52,9 +50,7 @@ export type LinkWiring = {
   get linkable(): boolean
   get link(): Pin | null
   clearLink(): void
-  lambdaLinkState(lambdaSpan: Span | null): LambdaLinkState
-  lambdaLinkWindow(l: Link | null): LambdaWindow | null
-  drawLink(l: Link | null, focusCoincident: boolean): void
+  drawLink(l: Link | null, focusCoincident: boolean, lambda: LambdaLinkState): void
   setLinkTo(node: number | null, origin: 'source' | 'lambda' | 'tm'): void
   linkAtSourceOffset(byteOffset: number): void
 }
@@ -91,8 +87,8 @@ export function createLinkWiring(deps: {
    * none is marked or the mark no longer resolves (5d-ii-b) — and its own doc has the argument for why
    * all four consumers were once carrying a private copy of the same expired invariant.
    *
-   * THE THREE READERS BELOW GIVE HONEST ANSWERS FOR ABSENCE RATHER THAN PROPAGATING IT: a pane that
-   * does not exist is not detached, has no link window, and contributes no λ link state.
+   * `detachedPanes` BELOW GIVES AN HONEST ANSWER FOR ABSENCE RATHER THAN PROPAGATING IT: a pane that
+   * does not exist is not detached. `draw()` gives the λ link state the same kind of answer, `'absent'`.
    */
   const theLambdaSlot = (): PaneSlot<'lambda'> | undefined => panes.active('lambda')?.slot
   const theTmSlot = (): PaneSlot<'tm'> | undefined => panes.active('tm')?.slot
@@ -142,46 +138,12 @@ export function createLinkWiring(deps: {
   let linkable = false
   let link: Pin | null = null
 
-  /**
-   * Which λ state the link is in — the three-way distinction `link-status.ts` exists to keep apart.
-   *
-   * ORDERED MOST-GLOBAL FIRST. A declined backend makes the other two questions meaningless, and a
-   * play head off step 0 makes truncation irrelevant, so asking in this order never reports a
-   * narrower reason than the true one.
-   *
-   * `lambdaSpan` IS PASSED IN RATHER THAN RE-DERIVED. The caller (`drawLink`) is itself handed the
-   * already-resolved `Link` that `draw()` computed once and shares with `lambdaLinkWindow` too — see
-   * `draw()`'s doc. Re-deriving it here would walk `#spanOf`/`#statesOf` over the wire's parallel
-   * arrays again, on every recorded frame during playback.
-   *
-   * AN ABSENT SPAN IS ONLY `'truncated'` WHEN `index.lambdaCut` SAYS SO. `lambdaSpan === null`
-   * is ambiguous by itself — it also fires for a node `LinkIndex.lambda_nodes` never carried a span
-   * for at all, which is not a byte-budget frontier — so reporting `'truncated'` unconditionally would
-   * be checkably false whenever the absence has some other cause. `'unmapped'` is the honest answer
-   * for that other case.
-   *
-   * `'absent'` LEADS, AHEAD OF `'declined'`, AND THE "most-global first" RULE ABOVE DOES NOT SETTLE
-   * THAT BY ITSELF — `'declined'` is a fact about the PROGRAM and is therefore the more global of the
-   * two. It is ordered this way on `link-status.ts`'s own uniform-suppression argument instead: every
-   * member of this union, `'declined'` included, is read as an explanation of the λ term on screen,
-   * and with no λ pane there is no term on screen for any of them to explain. The same standard that
-   * suppresses all five under a DETACHED λ pane, applied one step earlier.
-   */
-  const lambdaLinkState = (lambdaSpan: Span | null): LambdaLinkState => {
-    const slot = theLambdaSlot()
-    if (slot === undefined) return 'absent'
-    if (index === null || index.lambdaText === '') return 'declined'
-    if (slot.resolve(sessions).hist.currentStep !== 0) return 'not-step-0'
-    if (lambdaSpan !== null) return 'shown'
-    return index.lambdaCut !== null ? 'truncated' : 'unmapped'
-  }
-
   /**
    * Paint the link status line from `draw()`'s already-resolved link, or `null` when there is nothing
    * to resolve.
    *
-   * `l` IS A PARAMETER, NOT A CALL TO `index.linkFor` HERE — `draw()` resolves it once per tick and
-   * shares it with `lambdaLinkWindow` too; see `draw()`'s doc. `l === null` covers both "nothing is
+   * `l` IS A PARAMETER, NOT A CALL TO `index.linkFor` HERE — `draw()` resolves it once per tick; see
+   * `draw()`'s doc. `l === null` covers both "nothing is
    * linked" and "linking is stale", but those still report DIFFERENT statuses (`none` vs `stale`), so
    * `linkable` is consulted directly rather than folded into what made `l` null.
    *
@@ -195,7 +157,7 @@ export function createLinkWiring(deps: {
    * blank to speaking. `linkStatus` is the one function that reads the field and it suppresses a
    * detached pane's own clauses itself, so nothing here has to know which clauses those are.
    */
-  const drawLink = (l: Link | null, focusCoincident: boolean) => {
+  const drawLink = (l: Link | null, focusCoincident: boolean, lambda: LambdaLinkState) => {
     const detached = detachedPanes()
     if (!linkable) {
       linkStatusHost.textContent = linkStatus({ state: 'stale', detached })
@@ -208,48 +170,12 @@ export function createLinkWiring(deps: {
     linkStatusHost.textContent = linkStatus({
       state: 'linked',
       tm: l.states.length > 0,
-      lambda: lambdaLinkState(l.lambda),
+      lambda,
       focus: focusCoincident,
       detached,
     })
   }
 
-  /**
-   * The λ pane's link view, or `null` when there is nothing to show.
-   *
-   * GATED ON THE λ PANE'S OWN LEG BEING AT STEP 0, and only on that leg's head — resolved through the
-   * λ slot for the same reason `draw()` does. A session holds two independent histories with two
-   * heads; the TM leg runs at wildly different step counts (the `map` demo is 344,999 δ-steps against
-   * a few hundred β-steps), so gating on a shared condition would make the λ link vanish almost
-   * immediately for reasons that have nothing to do with λ.
-   *
-   * AND GATED ON THE PANE BEING ATTACHED, which is the same standard §5 applies to the status line's
-   * clauses, applied to the pane BODY where it bites harder. `index` describes the SOURCE session's
-   * step-0 term; a detached λ pane is showing a scratch's term, so painting this window would replace
-   * what the user is looking at with a different program's text and highlight a construct inside it.
-   * `linkStatus` suppresses the sentence about a term that is not on screen; this suppresses putting
-   * that term on screen.
-   *
-   * `l` IS `draw()`'S RESOLUTION, PASSED IN — the same one `drawLink` got. A second
-   * `index.linkFor(link.node)` call here for the same node in the same tick is exactly the double
-   * resolution `draw()`'s doc describes fixing; `index` is still read directly below for `lambdaText`/
-   * `lambdaSpans`, which are not part of `Link` and were never duplicated.
-   */
-  const lambdaLinkWindow = (l: Link | null): LambdaWindow | null => {
-    if (l === null || index === null) return null
-    // NO λ PANE MEANS NO WINDOW, and there is nothing weaker to say: this value is handed to
-    // `LambdaPane.renderLink` by `draw()`'s own fan-out over `panes.of('lambda')`, which iterates
-    // nothing when the leg is empty. RESOLVED ONCE INTO A LOCAL rather than called for each of the two
-    // guards below, which is what the two `theLambdaSlot()` calls this replaced were doing.
-    const slot = theLambdaSlot()
-    if (slot === undefined) return null
-    if (sessions.entryOf(slot.binding.session).detached) return null
-    if (slot.resolve(sessions).hist.currentStep !== 0) return null
-    const span = l.lambda
-    if (span === null) return null
-    return lambdaWindow(index.lambdaText, index.lambdaSpans, span, LINK_CONTEXT)
-  }
-
   /**
    * Resolve a link and paint all three panes.
    *
@@ -326,8 +252,6 @@ export function createLinkWiring(deps: {
       linkable = false
       link = null
     },
-    lambdaLinkState,
-    lambdaLinkWindow,
     drawLink,
     setLinkTo,
     linkAtSourceOffset,
diff --git a/web/src/link.ts b/web/src/link.ts
index c15e73c..0702af6 100644
--- a/web/src/link.ts
+++ b/web/src/link.ts
@@ -9,8 +9,8 @@
 // eight programs was 29.4% — nowhere close. One program crossing is not "more than one", so
 // the gate did not trip: `WITHIN` RENDERS AS A HIGHLIGHT, same as `Exact`, just visibly weaker — see
 // `main.ts`'s `draw()` for the wiring and `style.css`'s `.is-focus-within` for the weaker treatment.
-import type { Classified, Cut, Owner, Span } from './types'
-import { ownerNode, TOKEN_CLASSES } from './types'
+import type { Cut, Owner, Span } from './types'
+import { ownerNode } from './types'
 
 /**
  * `linkIndex(byteBudget)`'s wire shape: one string, one nullable cut, and ten typed arrays.
@@ -34,8 +34,12 @@ export type LinkIndexWire = {
   tmOwner: Int32Array
 }
 
-/** Where one Core node shows up in each pane. Any leg may be absent, and each for its own reason. */
-export type Link = { source: Span | null; lambda: Span | null; states: number[] }
+/**
+ * Where one Core node shows up: its source span and its machine states. Either may be absent, each for its
+ * own reason. **NO λ LEG SINCE PLAN 7 PART 4A** — the λ view finds a construct's nodes in the tree it draws
+ * (`Tree.nodesLinkedTo`), at whatever step is on screen, where this index knew only step 0's text.
+ */
+export type Link = { source: Span | null; states: number[] }
 
 /**
  * The smallest span containing `byteOffset`, as an index into the three parallel arrays, or `-1`.
@@ -85,8 +89,6 @@ export class LinkIndex {
   #w: LinkIndexWire
   /** `node -> its ascending state ids`, derived on first ask and cached. */
   #states = new Map<number, number[]>()
-  /** `lambdaSpans`'s cache — `undefined` until first asked, then never recomputed. See its getter's doc. */
-  #lambdaSpans: Classified | undefined
 
   constructor(wire: LinkIndexWire) {
     this.#w = wire
@@ -94,44 +96,12 @@ export class LinkIndex {
     this.lambdaCut = wire.lambdaCut
   }
 
-  /**
-   * The λ text's token spans, rehydrated from the wire's columnar arrays into `Classified`'s
-   * array-of-pairs shape.
-   *
-   * LAZY AND CACHED, NOT BUILT IN THE CONSTRUCTOR. `LinkIndex` is rebuilt on every 300 ms typing
-   * pause, and `lambdaSpans` has exactly one reader (`lambdaLinkWindow`, only when a link is active at
-   * step 0) — so an eager build paid the allocation on every compile whether or not anything was ever
-   * linked. `prog200` is 48,332 spans; rehydrating that on the main thread on every keystroke pause is
-   * the same columnar-vs-object-array cost `LinkIndexWire`'s own doc measures, paid for free on the
-   * common case of nobody clicking. Built once, on first ask, and kept for the life of this index —
-   * `#w`'s arrays never change underneath it.
-   */
-  get lambdaSpans(): Classified {
-    if (this.#lambdaSpans !== undefined) return this.#lambdaSpans
-    const spans: Classified = []
-    for (let i = 0; i < this.#w.lambdaSpanStart.length; i += 1) {
-      // A discriminant out of range would be a Rust/TypeScript drift, which `assertTokenClasses`
-      // fails at startup — so this cannot be reached in a running app. Falling back to `Ident` rather
-      // than throwing keeps a renderer alive if it ever is: an unstyled span beats a blank pane.
-      const cls = TOKEN_CLASSES[this.#w.lambdaSpanClass[i] as number] ?? 'Ident'
-      spans.push([{ start: this.#w.lambdaSpanStart[i] as number, end: this.#w.lambdaSpanEnd[i] as number }, cls])
-    }
-    this.#lambdaSpans = spans
-    return spans
-  }
-
   /** The innermost source construct containing `byteOffset`, or `null`. No outward walk — see `linkFor`. */
   nodeAtSource(byteOffset: number): number | null {
     const i = innermost(this.#w.sourceNodeStart, this.#w.sourceNodeEnd, byteOffset)
     return i < 0 ? null : (this.#w.sourceNodeId[i] as number)
   }
 
-  /** The innermost lambda subterm containing `byteOffset` in `lambdaText`, or `null`. */
-  nodeAtLambda(byteOffset: number): number | null {
-    const i = innermost(this.#w.lambdaNodeStart, this.#w.lambdaNodeEnd, byteOffset)
-    return i < 0 ? null : (this.#w.lambdaNodeId[i] as number)
-  }
-
   /** The Core node that produced state `stateId`, or `null` for scaffolding and out-of-range ids. */
   nodeForState(stateId: number): number | null {
     if (stateId < 0 || stateId >= this.#w.tmOwner.length) return null
@@ -149,13 +119,13 @@ export class LinkIndex {
    * must say so rather than show nothing.
    */
   linkFor(node: number): Link {
-    return { source: this.#spanOf('source', node), lambda: this.#spanOf('lambda', node), states: this.#statesOf(node) }
+    return { source: this.#spanOf(node), states: this.#statesOf(node) }
   }
 
-  #spanOf(leg: 'source' | 'lambda', node: number): Span | null {
-    const ids = leg === 'source' ? this.#w.sourceNodeId : this.#w.lambdaNodeId
-    const start = leg === 'source' ? this.#w.sourceNodeStart : this.#w.lambdaNodeStart
-    const end = leg === 'source' ? this.#w.sourceNodeEnd : this.#w.lambdaNodeEnd
+  #spanOf(node: number): Span | null {
+    const ids = this.#w.sourceNodeId
+    const start = this.#w.sourceNodeStart
+    const end = this.#w.sourceNodeEnd
     for (let i = 0; i < ids.length; i += 1) {
       if (ids[i] === node) return { start: start[i] as number, end: end[i] as number }
     }
diff --git a/web/src/main.ts b/web/src/main.ts
index 2b2389b..64781b0 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -25,7 +25,6 @@ import { KEYMAP_LABEL, KEYMAP_MODES, parseKeymapMode, readFormatOnBlur, writeFor
 import { declineMark, focusMark, linkMark } from './highlight'
 import { History } from './history'
 import { icon } from './icons'
-import type { LambdaPane } from './lambda-pane'
 import { LambdaTrees } from './lambda-trees'
 import { closeLeaf, defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, leaves, SOURCE_LEAF } from './layout'
 import { createLinkWiring, type LinkWiring } from './link-wiring'
@@ -1923,15 +1922,19 @@ async function main(): Promise<EditorView> {
           // next `compiled` reply landed — up to `DEBOUNCE_MS` plus a compile, seconds on a larger
           // program — while the status line already said "linking resumes when this compiles".
           //
-          // A SECOND `drawLink()`/`renderLink()`/`setLink()` CALL SITE, DELIBERATELY — none of this is
+          // A SECOND `drawLink()`/`setLink()` CALL SITE, DELIBERATELY — none of this is
           // redundant with `draw()`'s. Nothing here calls `draw()`: `lam.hist`/`tm.hist` have not
           // changed, so repainting both panes on every keystroke would be pure waste. But all three
           // panes still have to go stale THIS keystroke, not 300 ms from now when `compile.schedule`'s
           // debounce finally lands a `compiled`/`no-session` reply — so each gets its own direct, targeted call
           // rather than waiting for `draw()` to earn one. Passed `null`/`[]`/`false` rather than
           // resolving anything: `linkable` is already false on the line above, and every one of these
-          // reads that (`drawLink` directly; `renderLink`/`setLink`/`setFocus` take the already-cleared
-          // view) before it would ever look at what is linked or focused.
+          // reads that (`drawLink` directly; `setLink`/`setFocus` take the already-cleared view) before
+          // it would ever look at what is linked or focused.
+          //
+          // THE λ VIEWS HAVE NO CALL HERE, AND NEED NONE: `compile.schedule` below claims its generation
+          // synchronously, and the pool's `onSupersede` repaints through `draw()` — the one repaint a
+          // keystroke does cause — which hands each λ view the pin `clearLink` has just dropped.
           //
           // `setFocus([])` TOO, NOT ONLY `setLink` — the running focus is the δ-table's own second
           // highlight layer (`TmPane`'s own doc) and goes stale on this same keystroke, for the same
@@ -1951,8 +1954,7 @@ async function main(): Promise<EditorView> {
           // every pane from the tree's leaves, so a leg can now hold more than one, and the collection
           // is the one route every consumer of this rule shares.
           linkWiring.clearLink()
-          linkWiring.drawLink(null, false)
-          for (const p of panes.of('lambda')) (p.pane as LambdaPane).renderLink(null)
+          linkWiring.drawLink(null, false, 'shown')
           for (const p of panes.of('tm')) {
             const pane = p.pane as TmPane
             pane.setFocus([])
diff --git a/web/src/pane-chrome.ts b/web/src/pane-chrome.ts
index ea71622..48cf8f7 100644
--- a/web/src/pane-chrome.ts
+++ b/web/src/pane-chrome.ts
@@ -62,7 +62,7 @@ export type PaneEvents = {
    *
    * REQUIRED, UNLIKE THE TWO OPTIONAL MEMBERS BELOW, and the difference is not stylistic. Those two
    * are absent on a pane that genuinely lacks the affordance — the λ pane has no δ-table to click, the
-   * TM pane has no λ window — whereas every pane occupies a slot and every slot has a binding
+   * TM pane has no λ term — whereas every pane occupies a slot and every slot has a binding
    * (design §3.2b, decision 1). A pane whose rebind did nothing would be a pane whose selector lies.
    *
    * **IT TAKES THE WHOLE `(leg, session)` PAIR, AND THAT REVERSES WHAT THIS COMMENT USED TO SAY.** It
@@ -110,11 +110,9 @@ export type PaneEvents = {
    * **THE HALF OF THE OLD RULE THAT SURVIVES IS THE IMPORTANT HALF:** the pane does not go looking for
    * a term. What changed is which fact is the small one.
    *
-   * **A PANE SHOWING A LINK WINDOW MUST STILL DECLINE TO FORK, AND THAT IS NOW A RULE RATHER THAN A
-   * CONSEQUENCE.** It used to hold for free — the pane passed its own body text, and `LambdaPane`'s
-   * handler chose the frame's text over the window's for the reason recorded there. A step carries no
-   * such distinction, so `LambdaPane.#refreshDetach` checks `#link` directly, and
-   * `lambda-pane-editor.test.ts`'s "offers no fork while a link window is showing" pins it.
+   * **THE LINK WINDOW'S REFUSAL WENT WITH THE WINDOW (Plan 7 part 4a).** A pane showing the step-0
+   * link window used to decline to fork, since its body was not the step's term. The view now shows only
+   * its own step, as a tree or as text, so there is no second body a fork could be taken from.
    */
   detach?: (step: number) => void
   /**
@@ -190,8 +188,8 @@ export type PaneEvents = {
   detachMachine?(): void
   /** A state row was clicked. Absent on panes that have no table. */
   linkState?: (stateId: number) => void
-  /** A token in the λ link window was clicked, at this byte offset into the full `lambdaText`. */
-  linkLambda?: (byteOffset: number) => void
+  /** A token in the λ view was clicked; `node` is the construct its node belongs to (Plan 7 part 4a). */
+  linkLambda?: (node: number) => void
   /**
    * This pane's split and close gestures — 5d-ii-a.
    *
diff --git a/web/src/sessions.ts b/web/src/sessions.ts
index 5526b20..4d3da34 100644
--- a/web/src/sessions.ts
+++ b/web/src/sessions.ts
@@ -674,8 +674,8 @@ export class PaneSlot<K extends Leg> {
    * binding and of the registry, and the registry changes under a slot that did not move — a session
    * added or retired elsewhere changes what this pane may be pointed at. Driving them from the one
    * per-frame call means there is no second path that could leave a selector listing a session that no
-   * longer exists; both setters are no-ops when nothing changed, which is the same guard
-   * `LambdaPane.renderLink` and `viewHeader`'s setters already state for the same path.
+   * longer exists; both setters are no-ops when nothing changed, which is the same guard `viewHeader`'s
+   * setters already state for the same path.
    */
   render(reg: SessionRegistry, pane: PaneView<LegFrame[K]>, leg: LegState<LegFrame[K]>): void {
     const b = this.#binding
diff --git a/web/src/spans.ts b/web/src/spans.ts
index c7b2c44..4eca079 100644
--- a/web/src/spans.ts
+++ b/web/src/spans.ts
@@ -36,8 +36,8 @@ export function byteToIndex(text: string): Uint32Array {
 /**
  * A single byte offset, looked up in a `byteToIndex` map and clamped into it.
  *
- * ONE HOME, FOR EVERY CALLER. `decorationRanges` below, `highlight.ts`'s marks, `lambda-pane.ts`'s
- * frame rendering and `lambda-window.ts` each need exactly this — a byte offset can come in negative,
+ * ONE HOME, FOR EVERY CALLER. `decorationRanges` below, `highlight.ts`'s marks and `lambda-body.ts`'s
+ * flat frame all need exactly this — a byte offset can come in negative,
  * past the map's end, or (its intended case) mid-character, and all of them must resolve it the same
  * way rather than risk drifting apart one clamp expression at a time.
  *
@@ -78,43 +78,3 @@ export function decorationRanges(spans: Classified, text: string): DecorationRan
   out.sort((a, b) => a.from - b.from || a.to - b.to)
   return out
 }
-
-/**
- * `map[i]` is the byte offset of the character that STARTS AT (or contains) UTF-16 index `i`, for
- * every `i` in `0..=text.length`.
- *
- * NOT A TRUE INVERSE OF `byteToIndex` AT ONE NAMED INPUT: `byteToIndex(text)[indexToByte(text)[i]] ===
- * i` holds for every `i` that is a character's OWN starting index — every BMP character, and the HIGH
- * half of a surrogate pair — but NOT when `i` is the LOW half of a surrogate pair. For that `i`, this
- * function reports the astral character's start byte (matching `byteToIndex`'s own mid-character
- * convention, the same way a byte landing mid-character resolves to that character's start rather than
- * splitting it), and running that byte back through `byteToIndex` resolves to the pair's HIGH half —
- * the character's own start index — not `i`. `'a\u{1F600}b'` is the minimal case; see this function's
- * test in `spans.test.ts` for the exact numbers.
- *
- * OUT OF CONTRACT FOR THAT ONE INPUT, NOT A DEFECT TO FIX HERE: the only caller (`lambda-pane.ts`'s
- * `#redraw`) looks this map up only at a DECORATION RANGE'S `from`, which `decorationRanges` derives
- * from a token's own START byte offset via the lexer's spans — never a byte that lands mid-character,
- * and so never a low surrogate's UTF-16 index. A future caller resolving an arbitrary UTF-16 index
- * (say, a raw click position rather than a token boundary) would need to know this before trusting the
- * result at a low surrogate.
- *
- * NEEDED BY THE λ→SOURCE DIRECTION AND NOTHING ELSE SO FAR. A click gives a DOM position, which is a
- * UTF-16 index; `LinkIndex.nodeAtLambda` speaks bytes, like every `Span` in this app. Encoding a
- * prefix per lookup would be O(n²) over a window that can be tens of kilobytes, so the map is built
- * once and read many times — the same trade `byteToIndex` already makes in the other direction.
- */
-export function indexToByte(text: string): Uint32Array {
-  const map: number[] = []
-  let byte = 0
-  for (const ch of text) {
-    const codePoint = ch.codePointAt(0) ?? 0
-    const byteLen = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
-    // `ch.length` is 1 for a BMP character and 2 for a surrogate pair. Both units of the pair map to
-    // the character's own starting byte, matching `byteToIndex`'s treatment of a mid-character byte.
-    for (let i = 0; i < ch.length; i += 1) map.push(byte)
-    byte += byteLen
-  }
-  map.push(byte)
-  return new Uint32Array(map)
-}
diff --git a/web/src/transport.ts b/web/src/transport.ts
index c157a3b..a3d9bca 100644
--- a/web/src/transport.ts
+++ b/web/src/transport.ts
@@ -295,7 +295,7 @@ export function createTransport(deps: {
     // taken mid-run, and `null` outright for a declined leg. `index.lambdaText` is the SOURCE
     // compile's step-0 term printed at `LAMBDA_BYTE_BUDGET` (`session-worker.ts`'s `onRun`:
     // `session.linkIndex(LAMBDA_BYTE_BUDGET)`, built for every session that exists, decline or not),
-    // and it is already what `link-wiring.ts`'s `lambdaLinkWindow` reads for the very same reason — a
+    // and it is already what `draw.ts`'s `createDraw` reads to tell a declined λ leg from a live one — a
     // second name for the one string this file already holds, not a second lookup.
     //
     // `index === null || index.lambdaText === ''` COVERS EVERY CASE A FORK CAN BE CLICKED FROM AND
@@ -303,7 +303,7 @@ export function createTransport(deps: {
     // for an uncompiled page — but `#refreshDetach` already hides this control whenever the pane's
     // frame is `null`, which a `no-session`/pre-compile leg always is, so this guard is defence
     // against a call this file's own chrome should never produce, not a path a user can reach.
-    // `lambdaText === ''` is `link-wiring.ts`'s `lambdaLinkState` spelling "declined" — a declined leg
+    // `lambdaText === ''` is how `draw.ts`'s `createDraw` spells "declined" — a declined leg
     // also renders no frame, so the same defence applies. NEITHER READS THE SLOT'S SESSION: a
     // detached pane's own `#refreshDetach` already refuses (`!this.#detached`), and the only session
     // that is ever NOT detached is `SOURCE_SESSION` — the one `index` describes — so whenever this
@@ -515,10 +515,10 @@ export function createTransport(deps: {
     // optional under `exactOptionalPropertyTypes`, and the TM pane has no λ window to click.
     ...(slot.binding.leg === 'lambda'
       ? {
-          linkLambda: (byteOffset: number) => {
+          linkLambda: (node: number) => {
             const wiring = linkWiring()
-            if (!wiring.linkable || wiring.index === null) return
-            wiring.setLinkTo(wiring.index.nodeAtLambda(byteOffset), 'lambda')
+            if (!wiring.linkable) return
+            wiring.setLinkTo(node, 'lambda')
           },
         }
       : {}),
diff --git a/web/src/types.ts b/web/src/types.ts
index 0ae5819..5962035 100644
--- a/web/src/types.ts
+++ b/web/src/types.ts
@@ -54,8 +54,9 @@ export type { Decoded, Owner, Span, TokenClass, ValueRun }
  * `(typeof TOKEN_CLASSES)[number]`, so a name missing from the array could not be used anywhere in the
  * app — the array was the source. `TokenClass` is now generated from the Rust enum
  * (`../bindings/TokenClass`), and this array is an independent runtime value: a generated *type*
- * cannot supply an array, and this one is read in `link.ts`'s `lambdaSpans` getter to turn a
- * `Uint8Array` discriminant into a class name. Written as a standalone array with a separately-sourced union
+ * cannot supply an array. Until Plan 7 part 4a this one turned the step-0 link window's `Uint8Array`
+ * discriminants into class names; nothing reads a discriminant that way now, and it stays for
+ * `assertTokenClasses` below. Written as a standalone array with a separately-sourced union
  * beside it, the two drift the moment a variant is added on the Rust side and not here — which is
  * exactly the shape the pin below exists to close, now that neither derives from the other.
  *
@@ -153,9 +154,10 @@ export function decodedText(d: Decoded): string {
  * THIS IS THE CHECK THAT CATCHES A REORDER, NOT THE PIN ABOVE. It joins both arrays into strings and
  * compares them (`ours !== theirs`, below), so it is sensitive to ORDER — unlike the compile-time pin
  * above `TOKEN_CLASSES`, which is set-based (`Exclude<...>`) and typechecks clean if two names swap
- * places. That matters more from Plan 5b on than it did before: `LinkIndex` ships span classes as a
- * `Uint8Array` of DISCRIMINANTS, so a reordering here mis-colours silently rather than producing an
- * unrecognised string, and this runtime check is what stands between that and shipping.
+ * places. It mattered from Plan 5b until Plan 7 part 4a, while the step-0 link window read `LinkIndex`'s
+ * span classes — a `Uint8Array` of DISCRIMINANTS — through this array, where a reordering mis-coloured
+ * silently. NOTHING READS A DISCRIMINANT THAT WAY NOW, so this check guards no reader today; it stays so
+ * the next one inherits it rather than rediscovering the drift.
  */
 export function assertTokenClasses(fromWasm: string[]): void {
   const ours = TOKEN_CLASSES.join(',')
````

- [ ] **Step 5: Run the suite.** `cd web && pnpm run typecheck && pnpm exec vitest run --project node` → `616 passed`; then the browser tier (`PATH=/usr/sbin:$PATH pnpm exec vitest run --project browser`) → every file passes.

- [ ] **Step 6: Sabotage, one at a time, reverting after each** (`app.test.ts`, filtered with `-t "links a construct at a later step"`):

| Sabotage | Fails |
|---|---|
| `lambda-pane.ts`, `linkState`: `return this.#treeOf(t.tree).nodesLinkedTo(this.#pin).length > 0 ? 'shown' : 'none-here'` → `return 'shown'` | `links a construct at a later step while the term still carries it, and says when it no longer does` |
| `lambda-pane.ts`, `#redraw`: `const linked = this.#pin === null ? [] : tree.nodesLinkedTo(this.#pin)` → `const linked = this.#pin === null \|\| tree.wire.step > 0 ? [] : tree.nodesLinkedTo(this.#pin)` | the same test |

Task 5's `linkedAncestor` sabotage covers the λ → source direction's resolution.

- [ ] **Step 7: Commit.**

```bash
git add -A web/src web/tests
git commit -m "Web: a source click marks every node that carries the construct at the displayed step, a λ click links from its node, and the step-0 link window goes"
```

---

### Task 10: Display settings — layout, variables, and "reset folds"

**Files:**
- Modify: `web/src/workspace.ts` (`LambdaDisplay`, `DEFAULT_DISPLAY`, `Displays`, `withDisplay`; `Workspace.display`, parsed tolerantly — absent is none stored, malformed is refused)
- Modify: `web/src/view-header.ts` (`DisplayGroup`, `DisplayMenu`: `aria-pressed` choice buttons in a `role="group"`, and `button.reset-folds`)
- Modify: `web/src/lambda-pane.ts` (constructor `opts.display`; the outline layout and de Bruijn variables; `#setDisplay` reports through `PaneEvents.display`)
- Modify: `web/src/pane-chrome.ts` (`display?: (d: LambdaDisplay) => void`), `web/src/pane-host.ts` (a view is built with its stored display), `web/src/main.ts` (stores a changed display)
- Test: `web/tests/browser/lambda-display.test.ts` (four display cases join Task 8's two), `web/tests/browser/lambda-tree-app.test.ts` (the display is stored), `web/tests/node/workspace.test.ts` (three cases)

**Interfaces:**
- Consumes: Task 6's `outlineLines` and `Vars`; Task 8's pane.
- Produces: `type LambdaDisplay = { layout: 'code' | 'outline'; vars: 'names' | 'debruijn'; map: 'icicle' | 'minimap' }`; `DEFAULT_DISPLAY = { layout: 'code', vars: 'names', map: 'icicle' }`; `type Displays = Readonly<Record<LeafId, LambdaDisplay>>`; `withDisplay(display, leaf, d): Displays`; `Workspace.display: Displays`; `PaneEvents.display?`; `type DisplayGroup = { label; choices; current(); pick(value) }`; `type DisplayMenu = { groups; reset() }`; `new LambdaPane(host, on, opts: { display?: LambdaDisplay } = {})`.

**NO WORKSPACE VERSION BUMP.** A stored workspace without `display` parses as none stored, so every existing saved layout keeps working. `map` is part of the display from here, stored and restored; Task 11 is what draws it.

- [ ] **Step 1: Write the failing tests.** Replace `web/tests/browser/lambda-display.test.ts` with:

````ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import type { PaneEvents } from '../../src/pane-chrome'
import type { PaneOption } from '../../src/sessions'
import type { LambdaState } from '../../src/types'
import { DEFAULT_DISPLAY } from '../../src/workspace'
import { wireOf } from '../node/tree-fixture'

/**
 * A λ view's display settings (Plan 7 part 4a): the layout and the variables, chosen from its `⋯` menu,
 * reported so the app can keep them, "reset folds", and the reset a new binding makes. Panes are built
 * directly, as `lambda-pane-editor`'s are — nothing here needs `main()`.
 */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane lambda-display-fixture'
  el.style.width = '640px'
  document.body.append(el)
  return el
}

const events = (display = vi.fn()): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  display,
})

const frame: LambdaState = { text: 'λx. λy. x', spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }
const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

const option = (id: string): PaneOption => ({ leg: 'lambda', id, label: id })
const WIDE = `g ${Array.from({ length: 40 }, (_, i) => `(a${i} b${i})`).join(' ')}`

const choice = (el: HTMLElement, value: string) =>
  el.querySelector<HTMLButtonElement>(`.view-menu-choice[data-value="${value}"]`)

afterEach(() => {
  for (const el of document.querySelectorAll('.lambda-display-fixture')) el.remove()
})

describe('a λ view’s display settings', () => {
  it('offers layout and variables in its menu, pressed to match what it draws', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.render(frame, CONTROLS)
    const layout = el.querySelector('.view-menu-group[aria-label="layout"]')
    expect(layout).not.toBeNull()
    expect(el.querySelector('.view-menu-group[aria-label="variables"]')).not.toBeNull()
    expect(choice(el, 'code')?.getAttribute('aria-pressed')).toBe('true')
    expect(choice(el, 'outline')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('draws the outline and de Bruijn indices when they are picked, and reports each change', () => {
    const el = host()
    const display = vi.fn()
    const pane = new LambdaPane(el, events(display))
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf('\\x. \\y. x') })
    const term = () => el.querySelector<HTMLElement>('.term')
    expect(term()?.getAttribute('role')).toBe('list')
    expect(term()?.textContent).toBe('λx y. x')

    choice(el, 'outline')?.click()
    expect(display).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY, layout: 'outline' })
    expect(term()?.getAttribute('role')).toBe('tree')
    expect(choice(el, 'outline')?.getAttribute('aria-pressed')).toBe('true')

    choice(el, 'debruijn')?.click()
    expect(display).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY, layout: 'outline', vars: 'debruijn' })
    expect(term()?.textContent).toBe('λ. λ. 1')
  })

  it('starts from the display it is given', () => {
    const el = host()
    const pane = new LambdaPane(el, events(), { display: { ...DEFAULT_DISPLAY, vars: 'debruijn' } })
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf('\\x. \\y. x') })
    expect(el.querySelector('.term')?.textContent).toBe('λ. λ. 1')
    expect(choice(el, 'debruijn')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('resets folds to the automatic policy', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const lines = () => el.querySelectorAll('.term-line').length
    const open = lines()
    expect(open).toBeGreaterThan(1)
    el.querySelector<HTMLElement>('.term-gutter[data-node="0"]')?.click()
    expect(lines()).toBe(1)
    el.querySelector<HTMLButtonElement>('button.reset-folds')?.click()
    expect(lines()).toBe(open)
  })
})

describe('a λ view’s folds across bindings', () => {
  /**
   * A NEW BINDING STARTS FROM THE AUTOMATIC FOLDS. Folds are keyed by path, and a path in one session's term
   * names nothing in another's — the prototype carried a copy's folds home onto the program's tree, and no
   * app-level test noticed. `setBindings` runs every frame, so the same binding must keep them.
   */
  it('keeps its folds while bound to one session, and starts another from the automatic policy', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    const bind = (session: string) => pane.setBindings([option('source'), option('copy')], { leg: 'lambda', session })
    bind('source')
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const lines = () => el.querySelectorAll('.term-line').length
    const open = lines()
    expect(open).toBeGreaterThan(1)
    el.querySelector<HTMLElement>('.term-gutter[data-node="0"]')?.click()
    expect(lines()).toBe(1)

    bind('source')
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'the same binding, one frame later').toBe(1)

    bind('copy')
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'another session’s term').toBe(open)
  })

  it('keeps its folds through one build, and starts a new build of the same session from the automatic policy', () => {
    const el = host()
    const pane = new LambdaPane(el, events())
    pane.setBuild(1)
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const lines = () => el.querySelectorAll('.term-line').length
    const open = lines()
    el.querySelector<HTMLElement>('.term-gutter[data-node="0"]')?.click()
    expect(lines()).toBe(1)

    pane.setBuild(1)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'the same build, one frame later').toBe(1)

    pane.setBuild(2)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    expect(lines(), 'a new build').toBe(open)
  })
})
````

and apply the other two test files' changes:

````diff
diff --git a/web/tests/browser/lambda-tree-app.test.ts b/web/tests/browser/lambda-tree-app.test.ts
index 36eefe7..a2c8415 100644
--- a/web/tests/browser/lambda-tree-app.test.ts
+++ b/web/tests/browser/lambda-tree-app.test.ts
@@ -1,5 +1,6 @@
 import type { EditorView } from '@codemirror/view'
 import { beforeAll, describe, expect, it } from 'vitest'
+import { LAYOUT_STORAGE_KEY } from '../../src/layout'
 import { SHELL, until } from './harness'
 
 /**
@@ -52,6 +53,15 @@ describe('the λ view draws the tree for the step it shows', () => {
     expect(document.querySelector('[data-leaf="lambda-0"] .term .is-contractum')).not.toBeNull()
   })
 
+  it('keeps a view’s display in the stored workspace', async () => {
+    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .view-menu-choice[data-value="outline"]')?.click()
+    await until(() => term()?.getAttribute('role') === 'tree', 'the outline')
+    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
+    expect(stored.display?.['lambda-0']?.layout).toBe('outline')
+    document.querySelector<HTMLButtonElement>('[data-leaf="lambda-0"] .view-menu-choice[data-value="code"]')?.click()
+    await until(() => term()?.getAttribute('role') === 'list', 'the code layout again')
+  })
+
   /**
    * A RECOMPILE DOES NOT STRAND THE VIEW. `supersede()` moves the client's generation the moment a
    * keystroke schedules a compile, 300 ms before the worker hears of it; a tree asked for in that window
diff --git a/web/tests/node/workspace.test.ts b/web/tests/node/workspace.test.ts
index 8b8f11e..e03e55e 100644
--- a/web/tests/node/workspace.test.ts
+++ b/web/tests/node/workspace.test.ts
@@ -12,6 +12,7 @@ import {
   type Switches,
   serializeWorkspace,
   WORKSPACE_VERSION,
+  withDisplay,
   withPanel,
 } from '../../src/workspace'
 
@@ -69,6 +70,7 @@ describe('parseWorkspace', () => {
       focused: 'pane-1',
       panels: { 'tm-0': { rules: false } },
       inspector: false,
+      display: { 'pane-1': { layout: 'outline' as const, vars: 'debruijn' as const, map: 'minimap' as const } },
     }
     const raw = serializeWorkspace(ws)
     expect(JSON.parse(raw).version).toBe(WORKSPACE_VERSION)
@@ -150,6 +152,23 @@ describe('parseWorkspace', () => {
     expect(parseWorkspace(JSON.stringify({ ...base, inspector: 'yes' }))).toBeNull()
   })
 
+  // **A FIELD 2b DID NOT WRITE IS NOT AN INVALID FIELD**, for `inspector`'s reason: a workspace stored
+  // before Plan 7 part 4a has no `display`, and refusing it would reset every upgrading user's layout.
+  it('defaults a missing display to none stored, and refuses a malformed one', () => {
+    const base = { version: 2, tree: SPLIT, switches: PRESETS.explorer, speed: 8, focused: 'lambda-0', panels: {} }
+    expect(parseWorkspace(JSON.stringify(base))?.display).toEqual({})
+    const good = { 'lambda-0': { layout: 'outline', vars: 'names', map: 'icicle' } }
+    expect(parseWorkspace(JSON.stringify({ ...base, display: good }))?.display).toEqual(good)
+    for (const bad of [
+      { 'lambda-0': { layout: 'boxes', vars: 'names', map: 'icicle' } },
+      { 'lambda-0': { layout: 'code', vars: 'names' } },
+      { 'nowhere-9': { layout: 'code', vars: 'names', map: 'icicle' } },
+      [],
+    ]) {
+      expect(parseWorkspace(JSON.stringify({ ...base, display: bad })), JSON.stringify(bad)).toBeNull()
+    }
+  })
+
   it('opens the inspector for a migrated version 1 layout', () => {
     expect(parseWorkspace(serializeLayout(SPLIT))?.inspector).toBe(true)
   })
@@ -170,6 +189,14 @@ describe('serializeWorkspace', () => {
   })
 })
 
+describe('withDisplay', () => {
+  it('records one view’s display without touching the others', () => {
+    const a = { layout: 'code' as const, vars: 'names' as const, map: 'icicle' as const }
+    const b = { layout: 'outline' as const, vars: 'debruijn' as const, map: 'minimap' as const }
+    expect(withDisplay({ 'lambda-0': a }, 'pane-1', b)).toEqual({ 'lambda-0': a, 'pane-1': b })
+  })
+})
+
 describe('withPanel', () => {
   it('records one panel of one view without touching the others', () => {
     const next = withPanel({ 'tm-0': { rules: false } }, 'pane-1', 'rules', true)
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd web && pnpm run typecheck`
Expected: FAIL, 6 errors: `has no exported member 'DEFAULT_DISPLAY'`, `'display' does not exist in type 'PaneEvents'`, `Expected 2 arguments, but got 3`, `has no exported member 'withDisplay'`, and `Property 'display' does not exist on type 'Workspace'` twice.

Run: `pnpm exec vitest run --project node tests/node/workspace.test.ts`
Expected: FAIL — 3 failed, 21 passed.

- [ ] **Step 3: The settings.** Apply the source half of the patch:

````diff
diff --git a/web/src/lambda-pane.ts b/web/src/lambda-pane.ts
index 367180e..d86aa22 100644
--- a/web/src/lambda-pane.ts
+++ b/web/src/lambda-pane.ts
@@ -3,7 +3,7 @@ import type { EditablePane } from './editor-custody'
 import { EDITOR_DEBOUNCE_MS } from './editor-debounce'
 import { LambdaBody } from './lambda-body'
 import { Folds } from './lambda-folds'
-import { codeLines, type Line, lineOf } from './lambda-layout'
+import { codeLines, type Line, lineOf, outlineLines } from './lambda-layout'
 import { Tree } from './lambda-tree'
 import type { TreeFor } from './lambda-trees'
 import type { Dir } from './layout'
@@ -16,6 +16,7 @@ import type { Binding, PaneOption } from './sessions'
 import { stepControls } from './step-controls'
 import type { LambdaState } from './types'
 import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
+import { DEFAULT_DISPLAY, type LambdaDisplay } from './workspace'
 
 export type { PaneEvents }
 
@@ -39,6 +40,10 @@ export class LambdaPane implements EditablePane {
   /** One `Tree` per wire, so a redraw of the same step derives nothing twice. */
   #trees = new WeakMap<LambdaTreeWire, Tree>()
   #folds = new Folds()
+  /** How this view draws its term: its layout, its variables, and its term map's mode (spec §5.1). */
+  #display: LambdaDisplay
+  /** `PaneEvents.display`: record a changed display for this view, so a reload keeps it. */
+  #onDisplay: ((d: LambdaDisplay) => void) | undefined
   /** The session this view last drew — see `setBindings`. */
   #bound: string | null = null
   /** The build this view's trees last came from — see `setBuild`. */
@@ -155,7 +160,9 @@ export class LambdaPane implements EditablePane {
    */
   #editorAvailable = false
 
-  constructor(host: HTMLElement, on: PaneEvents) {
+  constructor(host: HTMLElement, on: PaneEvents, opts: { readonly display?: LambdaDisplay } = {}) {
+    this.#display = opts.display ?? DEFAULT_DISPLAY
+    this.#onDisplay = on.display
     // THE HEADER CARRIES THE TITLE-SELECTOR AND THE STATUS — `view-header.ts`'s own doc has why the title
     // is the selector and why the status sits inside the heading.
     this.#header = viewHeader(on.rebind)
@@ -181,6 +188,32 @@ export class LambdaPane implements EditablePane {
         ? { editCopy: { run: () => detach(this.#frame?.step ?? 0), what: 'the term at this step' } }
         : {}),
       ...(on.showEditor !== undefined ? { claim: on.showEditor } : {}),
+      display: {
+        groups: [
+          {
+            label: 'layout',
+            choices: [
+              { value: 'code', label: 'code' },
+              { value: 'outline', label: 'outline' },
+            ],
+            current: () => this.#display.layout,
+            pick: (v) => this.#setDisplay({ ...this.#display, layout: v === 'outline' ? 'outline' : 'code' }),
+          },
+          {
+            label: 'variables',
+            choices: [
+              { value: 'names', label: 'names' },
+              { value: 'debruijn', label: 'de Bruijn' },
+            ],
+            current: () => this.#display.vars,
+            pick: (v) => this.#setDisplay({ ...this.#display, vars: v === 'debruijn' ? 'debruijn' : 'names' }),
+          },
+        ],
+        reset: () => {
+          this.#folds.reset()
+          this.#redraw()
+        },
+      },
       choices: () => this.#choices,
     })
     // THE HOST IS IN THE DOM FROM CONSTRUCTION AND CARRIES NO CLASS UNTIL AN EDITOR IS MOUNTED.
@@ -235,11 +268,19 @@ export class LambdaPane implements EditablePane {
     return tree
   }
 
+  #setDisplay(d: LambdaDisplay): void {
+    this.#display = d
+    this.#redraw()
+    this.#onDisplay?.(d)
+  }
+
   #lines(tree: Tree): Line[] {
     const width = this.#body.columns()
-    const key = `${width}:${this.#folds.version}`
+    const { layout, vars } = this.#display
+    const key = `${width}:${this.#folds.version}:${layout}:${vars}`
     if (this.#laidOut !== null && this.#laidOut.tree === tree && this.#laidOut.key === key) return this.#laidOut.lines
-    const lines = codeLines(tree, { width, vars: 'names', open: (i) => this.#folds.isOpen(tree, i) })
+    const lay = layout === 'outline' ? outlineLines : codeLines
+    const lines = lay(tree, { width, vars, open: (i) => this.#folds.isOpen(tree, i) })
     this.#laidOut = { key, tree, lines }
     return lines
   }
@@ -698,7 +739,7 @@ export class LambdaPane implements EditablePane {
       this.#folds.advance(tree)
       const lines = this.#lines(tree)
       const linked = this.#pin === null ? [] : tree.nodesLinkedTo(this.#pin)
-      this.#body.showTree(tree, lines, false, linked, t.kind === 'stale')
+      this.#body.showTree(tree, lines, this.#display.layout === 'outline', linked, t.kind === 'stale')
       // A NEW PIN IS SCROLLED TO ONCE, and only when its first node is off screen — a click in this view
       // pins what is under the pointer, so it never moves; a source click brings the construct in.
       if (this.#pin !== this.#revealed) {
diff --git a/web/src/main.ts b/web/src/main.ts
index 64781b0..bda2a7d 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -68,6 +68,7 @@ import { pairLabel, sourceViewHeader, viewMenu } from './view-header'
 import {
   defaultFocus,
   defaultWorkspace,
+  type LambdaDisplay,
   PRESETS,
   parseSwitches,
   parseWorkspace,
@@ -76,6 +77,7 @@ import {
   type Switches,
   serializeWorkspace,
   type Workspace,
+  withDisplay,
   withPanel,
 } from './workspace'
 
@@ -965,6 +967,7 @@ async function main(): Promise<EditorView> {
     focused: restored.focused,
     panels: restored.panels,
     inspector: restored.inspector,
+    display: restored.display,
   }
   /**
    * The focused view, repaired against the tree it names a leaf of.
@@ -1056,6 +1059,10 @@ async function main(): Promise<EditorView> {
     setPanel: (leaf: LeafId, name: string, open: boolean) => {
       ws = { ...ws, panels: withPanel(ws.panels, leaf, name, open) }
     },
+    displayOf: (leaf: LeafId) => ws.display[leaf],
+    setDisplay: (leaf: LeafId, d: LambdaDisplay) => {
+      ws = { ...ws, display: withDisplay(ws.display, leaf, d) }
+    },
     layoutChanged,
     draw: () => draw(),
     // THE ONE SESSION QUESTION `pane-host.ts` ASKS, ANSWERED HERE BECAUSE THIS FILE IS WHERE THE REGISTRY
diff --git a/web/src/pane-chrome.ts b/web/src/pane-chrome.ts
index 48cf8f7..bb8b39b 100644
--- a/web/src/pane-chrome.ts
+++ b/web/src/pane-chrome.ts
@@ -3,7 +3,7 @@ import type { Leg } from './protocol'
 import type { ScratchEditorConfig } from './scratch-editor'
 import type { SessionId } from './session-client'
 import type { Binding, PaneOption } from './sessions'
-import type { Speed } from './workspace'
+import type { LambdaDisplay, Speed } from './workspace'
 
 export type PaneEvents = {
   /**
@@ -172,6 +172,8 @@ export type PaneEvents = {
    * and the text panel reports through `collapse` instead, because its state belongs to the copy.
    */
   panel?: (name: string, open: boolean) => void
+  /** A λ view's display settings changed — recorded per view, as `panel` is (Plan 7 part 4a). */
+  display?: (d: LambdaDisplay) => void
   /**
    * Fork this pane's MACHINE into a TM scratch buffer — 5d-iv design §4.3.
    *
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index 69e73a3..95180c4 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -19,6 +19,7 @@ import type { Detachable } from './scratch'
 import type { SessionId } from './session-client'
 import { type Binding, PaneSlot, type TmCompiled, type TmScratchReading } from './sessions'
 import { TmPane } from './tm-pane'
+import { DEFAULT_DISPLAY, type LambdaDisplay } from './workspace'
 
 /**
  * THE PANE LIFECYCLE — which panes exist, what element each one lives in, and what its controls do —
@@ -188,6 +189,10 @@ export function createPaneHost(deps: {
   panelOpen(leaf: LeafId, name: string): boolean | undefined
   /** Record a view's panel state; `persist` is the caller's to make. */
   setPanel(leaf: LeafId, name: string, open: boolean): void
+  /** A λ view's stored display settings, or `undefined` for none (Plan 7 part 4a). */
+  displayOf(leaf: LeafId): LambdaDisplay | undefined
+  /** Record a λ view's display settings; `persist` is the caller's to make. */
+  setDisplay(leaf: LeafId, d: LambdaDisplay): void
   /** A view was added, closed, or switched to show something else — `main.ts` says it as a notice (spec §11). */
   layoutChanged(e: LayoutEvent): void
   draw(): void
@@ -251,6 +256,8 @@ export function createPaneHost(deps: {
     setFocused,
     panelOpen,
     setPanel,
+    displayOf,
+    setDisplay,
     layoutChanged,
     draw,
     tmProgramOf,
@@ -781,6 +788,10 @@ export function createPaneHost(deps: {
         setPanel(id, name, open)
         persist()
       },
+      display: (d: LambdaDisplay) => {
+        setDisplay(id, d)
+        persist()
+      },
     }
   }
 
@@ -1009,7 +1020,8 @@ export function createPaneHost(deps: {
       pendingBinding.delete(l.id)
       if (l.pane === 'lambda') {
         const slot = new PaneSlot('lambda', session)
-        const pane = new LambdaPane(host, paneEvents(l.id, slot))
+        // ITS DISPLAY IS READ BACK LIKE A TM VIEW'S PANELS BELOW — stored per leaf, defaulted when absent.
+        const pane = new LambdaPane(host, paneEvents(l.id, slot), { display: displayOf(l.id) ?? DEFAULT_DISPLAY })
         // **A NEW λ PANE IS SEEDED FROM ITS SESSION FOR THE IDENTICAL REASON THE TM BRANCH BELOW IS**,
         // and this line is the λ half of a repair that shipped with only its TM half. `scratch-compiled`
         // is the reply that mounts a scratch editor and it fires once per build, so a pane created after
diff --git a/web/src/view-header.ts b/web/src/view-header.ts
index 2123426..4e8477a 100644
--- a/web/src/view-header.ts
+++ b/web/src/view-header.ts
@@ -255,6 +255,23 @@ export type ViewMenu = {
   setFormattable(available: boolean): void
 }
 
+/** One group of mutually exclusive settings in a view's `⋯` menu — `layout: code | outline`. */
+export type DisplayGroup = {
+  readonly label: string
+  readonly choices: readonly { readonly value: string; readonly label: string }[]
+  readonly current: () => string
+  readonly pick: (value: string) => void
+}
+
+/**
+ * A λ view's display settings in its `⋯` menu (Plan 7 part 4a): its groups, and "reset folds".
+ *
+ * **PRESSED BUTTONS IN A LABELLED GROUP, NOT `menuitemradio`.** This popover is not a `role="menu"` —
+ * none of its other items is a `menuitem` either — and a radio item outside a menu is not valid ARIA.
+ * `aria-pressed` says the same thing, in a shape that stands on its own.
+ */
+export type DisplayMenu = { readonly groups: readonly DisplayGroup[]; readonly reset: () => void }
+
 export type ViewMenuOptions = {
   readonly split?: (dir: Dir, choice: PaneChoice) => void
   readonly close?: () => void
@@ -269,6 +286,8 @@ export type ViewMenuOptions = {
    * half-typed buffer does nothing visible. That is what makes *format on blur* safe to leave on.
    */
   readonly format?: () => void
+  /** A λ view's display settings — present only on a λ view (Plan 7 part 4a). */
+  readonly display?: DisplayMenu
   readonly choices?: () => SplitChoices
 }
 
@@ -435,9 +454,51 @@ export function viewMenu(actions: HTMLElement, opts: ViewMenuOptions): ViewMenu
     })
   }
 
+  const displayItems: HTMLElement[] = []
+  const pressed: { readonly el: HTMLButtonElement; readonly group: DisplayGroup; readonly value: string }[] = []
+  const syncPressed = (): void => {
+    for (const p of pressed) p.el.setAttribute('aria-pressed', String(p.group.current() === p.value))
+  }
+  if (opts.display !== undefined) {
+    const display = opts.display
+    for (const g of display.groups) {
+      const box = document.createElement('div')
+      box.className = 'view-menu-group'
+      box.setAttribute('role', 'group')
+      box.setAttribute('aria-label', g.label)
+      const title = document.createElement('span')
+      title.className = 'view-menu-group-label'
+      title.setAttribute('aria-hidden', 'true')
+      title.textContent = g.label
+      box.append(title)
+      for (const c of g.choices) {
+        const b = document.createElement('button')
+        b.type = 'button'
+        b.className = 'view-menu-choice'
+        b.dataset.value = c.value
+        b.textContent = c.label
+        b.addEventListener('click', () => {
+          g.pick(c.value)
+          syncPressed()
+        })
+        pressed.push({ el: b, group: g, value: c.value })
+        box.append(b)
+      }
+      displayItems.push(box)
+    }
+    const reset = item('reset-folds', 'reset folds')
+    reset.addEventListener('click', () => {
+      shut()
+      display.reset()
+    })
+    displayItems.push(reset)
+    syncPressed()
+  }
+
   menu.addEventListener('beforetoggle', (e) => {
     const open = e.newState === 'open'
     more.setAttribute('aria-expanded', String(open))
+    if (open) syncPressed()
     if (open) {
       const first = main.querySelector<HTMLButtonElement>('button:not([disabled])')
       if (first !== null) first.autofocus = true
@@ -455,7 +516,7 @@ export function viewMenu(actions: HTMLElement, opts: ViewMenuOptions): ViewMenu
   const what = opts.editCopy?.what ?? ''
 
   const sync = (): void => {
-    const wanted: HTMLButtonElement[] = []
+    const wanted: HTMLElement[] = []
     if (canSplit) wanted.push(...splitItems)
     if (edit !== null && copy !== null) {
       // THE HINT LINE AND THE NAME MOVE TOGETHER — see `item`'s own note on why the name is written down.
@@ -474,12 +535,13 @@ export function viewMenu(actions: HTMLElement, opts: ViewMenuOptions): ViewMenu
     }
     if (claim !== null && claimable) wanted.push(claim)
     if (fmt !== null && formattable) wanted.push(fmt)
+    wanted.push(...displayItems)
     // RECONCILED, NOT REPLACED, FOR `paint`'s REASON ONE LEVEL OUT: `replaceChildren` takes every item
     // out of the document, and an item holding the focus does not get it back. Reachable while the menu
     // is open and a frame changes what applies — a copy created elsewhere, a recording ending.
     const same = wanted.length === main.children.length && wanted.every((b, i) => main.children[i] === b)
     if (!same) {
-      const going = [...main.children].filter((child) => !wanted.includes(child as HTMLButtonElement))
+      const going = [...main.children].filter((child) => !wanted.includes(child as HTMLElement))
       // A CONTROL REMOVED BY A STATE CHANGE MUST NOT TAKE THE FOCUS WITH IT — spec §11's fourth rule, at
       // the instance the spec names by hand: the split items when Stage is chosen. It is reachable with
       // the menu OPEN, which is the only way a user can be standing on one of these when the state
diff --git a/web/src/workspace.ts b/web/src/workspace.ts
index 37414d8..37fb426 100644
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -58,6 +58,18 @@ export function presetOf(s: Switches): Preset | null {
 /** Per view, per panel name, whether the panel is open. Only a view's own panels live here — spec §3. */
 export type Panels = Readonly<Record<LeafId, Readonly<Record<string, boolean>>>>
 
+/** How a λ view draws its term (Plan 7 part 4, spec §5.1 and §6): its layout, its variables, its term map. */
+export type LambdaDisplay = {
+  readonly layout: 'code' | 'outline'
+  readonly vars: 'names' | 'debruijn'
+  readonly map: 'icicle' | 'minimap'
+}
+
+export const DEFAULT_DISPLAY: LambdaDisplay = { layout: 'code', vars: 'names', map: 'icicle' }
+
+/** Each λ view's display settings, by leaf — a view with none stored draws with `DEFAULT_DISPLAY`. */
+export type Displays = Readonly<Record<LeafId, LambdaDisplay>>
+
 export type Workspace = {
   readonly tree: LayoutNode
   readonly switches: Switches
@@ -74,6 +86,8 @@ export type Workspace = {
    * re-open it as the focus moved between views. The spec was corrected to say so.
    */
   readonly inspector: boolean
+  /** Each λ view's display settings (Plan 7 part 4a) — absent in a workspace stored before it. */
+  readonly display: Displays
 }
 
 export const WORKSPACE_VERSION = 2
@@ -96,9 +110,15 @@ export function defaultWorkspace(): Workspace {
     focused: defaultFocus(tree),
     panels: {},
     inspector: true,
+    display: {},
   }
 }
 
+/** `display` with one λ view's settings recorded — a new object, as `withPanel` returns. */
+export function withDisplay(display: Displays, leaf: LeafId, d: LambdaDisplay): Displays {
+  return { ...display, [leaf]: d }
+}
+
 /** `panels` with one panel of one view recorded — a new object, as every operation in `layout.ts` returns. */
 export function withPanel(panels: Panels, leaf: LeafId, name: string, open: boolean): Panels {
   return { ...panels, [leaf]: { ...panels[leaf], [name]: open } }
@@ -116,6 +136,8 @@ export function serializeWorkspace(ws: Workspace): string {
   const live = new Set(leaves(ws.tree).map((l) => l.id))
   const panels: Record<LeafId, Record<string, boolean>> = {}
   for (const [leaf, open] of Object.entries(ws.panels)) if (live.has(leaf)) panels[leaf] = { ...open }
+  const display: Record<LeafId, LambdaDisplay> = {}
+  for (const [leaf, d] of Object.entries(ws.display)) if (live.has(leaf)) display[leaf] = d
   return JSON.stringify({
     version: WORKSPACE_VERSION,
     tree: ws.tree,
@@ -124,6 +146,7 @@ export function serializeWorkspace(ws: Workspace): string {
     focused: live.has(ws.focused) ? ws.focused : defaultFocus(ws.tree),
     panels,
     inspector: ws.inspector,
+    display,
   })
 }
 
@@ -143,6 +166,25 @@ export function parseSwitches(v: unknown): Switches | null {
   return { steps: s.steps, views: s.views, readout: s.readout }
 }
 
+/**
+ * A stored `display`, or `null` for a malformed one. **ABSENT IS NOT MALFORMED**, for `inspector`'s reason:
+ * a workspace stored before Plan 7 part 4a has none, and refusing it would reset the upgrading user's
+ * layout; `parseWorkspace` maps absence to `{}`.
+ */
+function parseDisplay(v: unknown, ids: ReadonlySet<string>): Displays | null {
+  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
+  const out: Record<LeafId, LambdaDisplay> = {}
+  for (const [leaf, d] of Object.entries(v as Record<string, unknown>)) {
+    if (!ids.has(leaf) || typeof d !== 'object' || d === null) return null
+    const { layout, vars, map } = d as Record<string, unknown>
+    if (layout !== 'code' && layout !== 'outline') return null
+    if (vars !== 'names' && vars !== 'debruijn') return null
+    if (map !== 'icicle' && map !== 'minimap') return null
+    out[leaf] = { layout, vars, map }
+  }
+  return out
+}
+
 function parsePanels(v: unknown, ids: ReadonlySet<string>): Panels | null {
   if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
   const out: Record<LeafId, Record<string, boolean>> = {}
@@ -188,6 +230,7 @@ export function parseWorkspace(raw: string | null): Workspace | null {
       focused: defaultFocus(tree),
       panels: {},
       inspector: true,
+      display: {},
     }
   }
   if (e.version !== WORKSPACE_VERSION) return null
@@ -206,5 +249,7 @@ export function parseWorkspace(raw: string | null): Workspace | null {
   // users the version 2 envelope was built to carry across. A field that IS there and is not a boolean is
   // held to the standard above like every other (spec §3).
   if (e.inspector !== undefined && typeof e.inspector !== 'boolean') return null
-  return { tree, switches, speed: e.speed, focused: e.focused, panels, inspector: e.inspector ?? true }
+  const display = e.display === undefined ? {} : parseDisplay(e.display, ids)
+  if (display === null) return null
+  return { tree, switches, speed: e.speed, focused: e.focused, panels, inspector: e.inspector ?? true, display }
 }
````

- [ ] **Step 4: Run the tests.** Node tier → `618 passed` (`workspace.test.ts` 24); `lambda-display` → 6 passed; `lambda-tree-app` → 7 passed.

- [ ] **Step 5: Sabotage, one at a time, reverting after each:**

| Sabotage | File run | Fails |
|---|---|---|
| `lambda-pane.ts`, `#setDisplay`: delete `this.#onDisplay?.(d)` | `lambda-display` | `draws the outline and de Bruijn indices when they are picked, and reports each change` |
| `workspace.ts`: `if (layout !== 'code' && layout !== 'outline') return null` → `if (typeof layout !== 'string') return null` | `workspace` (node) | `defaults a missing display to none stored, and refuses a malformed one` |
| `lambda-pane.ts`, the menu's `reset`: delete `this.#folds.reset()` | `lambda-display` | `resets folds to the automatic policy` |
| `main.ts`: `ws = { ...ws, display: withDisplay(ws.display, leaf, d) }` → `void d` | `lambda-tree-app`, `-t "keeps a view"` | `keeps a view’s display in the stored workspace` |

- [ ] **Step 6: Commit.**

```bash
git add web/src web/tests
git commit -m "Web: a λ view picks its layout and its variables from its menu, keeps them in the stored workspace, and resets its folds on request"
```

---

### Task 11: The term map

**Files:**
- Create: `web/src/term-map.ts`, `web/tests/node/term-map.test.ts`, `web/tests/browser/term-map.test.ts`
- Modify: `web/src/lambda-pane.ts` (the map panel, its icicle/minimap buttons, `#drawMap`, `#pick`), `web/src/lambda-body.ts` (`BodyEvents.scrolled`, so the map follows the body's scroll), `web/src/lambda-folds.ts` (`reveal`), `web/src/pane-host.ts` (the panel's stored open state), `web/src/style.css`
- Test: `web/tests/node/lambda-folds.test.ts` (one case for `reveal`)

**Interfaces:**
- Consumes: Tasks 5–10.
- Produces: `type MapMode = 'icicle' | 'minimap'`; `type Rect`; `icicleRect(t, i): Rect`; `nodeAtIcicle(t, fx, fy): number`; `visibleNodes(t, lines, first, last): { lo; hi } | null`; `lineAtMinimap(lineCount, fy): number`; `type MapState`; `type MapPick = { node } | { line }`; `class TermMap { el: HTMLCanvasElement; constructor(onPick); draw(state) }`; `Folds.reveal(t, i)`; `LambdaPane` constructor `opts.map?: boolean`.

**PRE-ORDER MAKES THE ICICLE ARITHMETIC.** Node `i`'s subtree is the index range `[i, i + size[i])`, so its horizontal extent is that range over the node count — no layout pass, and every subtree nests inside its parent's by construction. **EVERY COLOUR IS A PALETTE TOKEN** read from the canvas's computed style at draw time; the colour gate holds `style.css` to its palette, and a hard-coded canvas colour would be the one surface it could not reach.

- [ ] **Step 1: Write the failing tests.** Create `web/tests/node/term-map.test.ts`:

````ts
import { describe, expect, it } from 'vitest'
import { codeLines } from '../../src/lambda-layout'
import { Tree } from '../../src/lambda-tree'
import { icicleRect, lineAtMinimap, nodeAtIcicle, visibleNodes } from '../../src/term-map'
import { wireOf } from './tree-fixture'

// `(\x. x) y` in pre-order: 0 App, 1 Abs x, 2 Var x, 3 Var y — depths 0, 1, 2, 1.
const t = new Tree(wireOf('(\\x. x) y'))

describe('icicleRect', () => {
  it('gives each node a row by depth and a width by subtree size', () => {
    expect(icicleRect(t, 0)).toEqual({ x: 0, y: 0, w: 1, h: 1 / 3 })
    expect(icicleRect(t, 1)).toEqual({ x: 0.25, y: 1 / 3, w: 0.5, h: 1 / 3 })
    expect(icicleRect(t, 3)).toEqual({ x: 0.75, y: 1 / 3, w: 0.25, h: 1 / 3 })
  })

  it('nests every child inside its parent', () => {
    const big = new Tree(wireOf('f (\\a. a (b c)) (d (e g) h)'))
    for (let i = 1; i < big.count; i += 1) {
      const c = icicleRect(big, i)
      const p = icicleRect(big, big.parent[i] as number)
      expect(c.x).toBeGreaterThanOrEqual(p.x)
      expect(c.x + c.w).toBeLessThanOrEqual(p.x + p.w + 1e-9)
      expect(c.y).toBeGreaterThan(p.y)
    }
  })
})

describe('nodeAtIcicle', () => {
  it('names the node whose rectangle holds the point', () => {
    for (let i = 0; i < t.count; i += 1) {
      const r = icicleRect(t, i)
      expect(nodeAtIcicle(t, r.x + r.w / 2, r.y + r.h / 2), `node ${i}`).toBe(i)
    }
  })

  it('names the deepest node where a column ends above the row clicked', () => {
    // Below `y` (node 3, depth 1) there is nothing at depth 2, so a click there names `y` itself.
    expect(nodeAtIcicle(t, 0.8, 0.9)).toBe(3)
  })
})

describe('visibleNodes', () => {
  it('spans the nodes the given lines show, a fold covering its whole subtree', () => {
    const w = new Tree(wireOf('g (a b c d) (e f g h)'))
    const lines = codeLines(w, { width: 12, vars: 'names', open: () => true })
    expect(visibleNodes(w, lines, 1, 1)).toEqual({ lo: w.right(w.left(0)), hi: w.right(w.left(0)) + 7 })
    const folded = codeLines(w, { width: 12, vars: 'names', open: (i) => i !== 0 })
    expect(visibleNodes(w, folded, 0, 0)).toEqual({ lo: 0, hi: w.count })
    expect(visibleNodes(w, lines, 5, 9)).toBeNull()
  })
})

describe('lineAtMinimap', () => {
  it('maps a fraction of the height to a line, clamped', () => {
    expect(lineAtMinimap(10, 0)).toBe(0)
    expect(lineAtMinimap(10, 0.55)).toBe(5)
    expect(lineAtMinimap(10, 1)).toBe(9)
    expect(lineAtMinimap(0, 0.5)).toBe(0)
  })
})
````

Create `web/tests/browser/term-map.test.ts`:

````ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import { Tree } from '../../src/lambda-tree'
import type { PaneEvents } from '../../src/pane-chrome'
import { icicleRect } from '../../src/term-map'
import type { LambdaState } from '../../src/types'
import { DEFAULT_DISPLAY } from '../../src/workspace'
import { wireOf } from '../node/tree-fixture'

/** The term map panel on a λ view built directly (Plan 7 part 4a, spec §6). */
const host = (): HTMLElement => {
  const el = document.createElement('section')
  el.className = 'pane term-map-fixture'
  el.style.width = '640px'
  document.body.append(el)
  return el
}

const events = (over: Partial<PaneEvents> = {}): PaneEvents => ({
  back: vi.fn(),
  forward: vi.fn(),
  play: vi.fn(),
  restart: vi.fn(),
  extend: vi.fn(),
  speed: () => 8,
  setSpeed: vi.fn(),
  rebind: vi.fn(),
  ...over,
})

const frame: LambdaState = { text: 'x', spans: [], cut: null, step: 0, redex_span: null, owner: 'None' }
const CONTROLS = {
  canRestart: true,
  canBack: false,
  canForward: true,
  canPlay: true,
  playing: false,
  stepText: '0',
  continueLabel: null,
}

/** 300 wide arguments, each its own folded subterm past the automatic threshold's reach once opened. */
const WIDE = `g ${Array.from({ length: 300 }, (_, i) => `(a${i} b${i})`).join(' ')}`

afterEach(() => {
  for (const el of document.querySelectorAll('.term-map-fixture')) el.remove()
})

describe('the term map', () => {
  it('is a closed panel until opened, and reports the toggle', () => {
    const el = host()
    const panel = vi.fn()
    const pane = new LambdaPane(el, events({ panel }))
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const toggle = el.querySelector<HTMLButtonElement>('[data-panel="map"] .panel-toggle')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    toggle?.click()
    expect(panel).toHaveBeenCalledWith('map', true)
    const canvas = el.querySelector<HTMLCanvasElement>('.term-map')
    expect(canvas?.width).toBeGreaterThan(0)
    expect(canvas?.getAttribute('aria-label')).toMatch(/term map: \d+ nodes by depth/)
  })

  it('switches between icicle and minimap from its header, and reports the display', () => {
    const el = host()
    const display = vi.fn()
    const pane = new LambdaPane(el, events({ display }), { map: true })
    pane.render(frame, CONTROLS)
    pane.renderTree({ kind: 'tree', tree: wireOf(WIDE) })
    const mode = (m: string) => el.querySelector<HTMLButtonElement>(`.map-mode[data-mode="${m}"]`)
    expect(mode('icicle')?.getAttribute('aria-pressed')).toBe('true')
    mode('minimap')?.click()
    expect(mode('minimap')?.getAttribute('aria-pressed')).toBe('true')
    expect(display).toHaveBeenLastCalledWith({ ...DEFAULT_DISPLAY, map: 'minimap' })
    expect(el.querySelector('.term-map')?.getAttribute('aria-label')).toMatch(/term map: \d+ lines/)
  })

  it('scrolls the view to a node picked on the icicle', () => {
    const el = host()
    const pane = new LambdaPane(el, events(), { map: true })
    pane.render(frame, CONTROLS)
    const wire = wireOf(WIDE, { nextRedex: null })
    pane.renderTree({ kind: 'tree', tree: wire })
    const body = el.querySelector<HTMLElement>('.term') as HTMLElement
    body.scrollTop = 0
    body.dispatchEvent(new Event('scroll'))
    const canvas = el.querySelector<HTMLCanvasElement>('.term-map') as HTMLCanvasElement
    const last = new Tree(wire).right(0)
    const r = icicleRect(new Tree(wire), last)
    const box = canvas.getBoundingClientRect()
    canvas.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: box.left + (r.x + r.w / 2) * box.width,
        clientY: box.top + (r.y + r.h / 2) * box.height,
      }),
    )
    expect(body.scrollTop).toBeGreaterThan(0)
  })
})
````

Apply the folds test's new case:

````diff
diff --git a/web/tests/node/lambda-folds.test.ts b/web/tests/node/lambda-folds.test.ts
index 402762f..fbf0ddb 100644
--- a/web/tests/node/lambda-folds.test.ts
+++ b/web/tests/node/lambda-folds.test.ts
@@ -64,6 +64,21 @@ describe('Folds', () => {
     expect(f.isOpen(after, after.right(6))).toBe(true)
   })
 
+  it('reveals a node by opening every closed ancestor, and nothing else', () => {
+    const t = new Tree(wireOf('g (a (b (c d))) e'))
+    const f = new Folds()
+    const c = t.left(t.right(t.right(t.right(t.left(0)))))
+    f.toggle(t, t.right(t.left(0)))
+    f.toggle(t, t.right(t.right(t.left(0))))
+    expect(f.isOpen(t, t.right(t.left(0)))).toBe(false)
+    const v = f.version
+    f.reveal(t, c)
+    for (let at = t.parent[c] as number; at >= 0; at = t.parent[at] as number) expect(f.isOpen(t, at)).toBe(true)
+    expect(f.version).toBeGreaterThan(v)
+    f.reveal(t, c)
+    expect(f.version).toBe(v + 1)
+  })
+
   it('keeps every override across a jump, since it cannot know what the jump rewrote', () => {
     const t = new Tree(wireOf('k (a b) ((\\y. y) (c d))', { step: 1 }))
     const f = new Folds()
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd web && pnpm run typecheck`
Expected: FAIL, 6 errors: `Cannot find module '../../src/term-map'` in both new tests, `'map' does not exist in type …` twice, and `Property 'reveal' does not exist on type 'Folds'` twice.

Run: `pnpm exec vitest run --project node tests/node/term-map.test.ts tests/node/lambda-folds.test.ts`
Expected: FAIL — both files fail; of the tests that load, `reveals a node…` fails and 6 pass.

- [ ] **Step 3: The map.** Create `web/src/term-map.ts`:

````ts
import { type Line, lineText } from './lambda-layout'
import { KIND_ABS, type Tree } from './lambda-tree'

/** The term map's two views of one term (spec §6). */
export type MapMode = 'icicle' | 'minimap'

/** A rectangle in fractions of the map, `0..1` on both axes. */
export type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/**
 * Node `i`'s icicle rectangle: one row per depth, and as wide as its subtree.
 *
 * **PRE-ORDER MAKES THIS ARITHMETIC.** Node `i`'s subtree is the index range `[i, i + size[i])`, so its
 * horizontal extent is that range over the node count — no layout pass, and every subtree nests inside
 * its parent's extent by construction.
 */
export function icicleRect(t: Tree, i: number): Rect {
  const rows = t.maxDepth + 1
  return { x: i / t.count, y: (t.depth[i] as number) / rows, w: (t.size[i] as number) / t.count, h: 1 / rows }
}

/**
 * The node an icicle click at fractions `(fx, fy)` names: the node at that row whose extent covers `fx` —
 * or, where the column ends above that row, the deepest node there.
 */
export function nodeAtIcicle(t: Tree, fx: number, fy: number): number {
  const row = Math.min(t.maxDepth, Math.max(0, Math.floor(fy * (t.maxDepth + 1))))
  let at = Math.min(t.count - 1, Math.max(0, Math.floor(fx * t.count)))
  while (at > 0 && (t.depth[at] as number) > row) at = t.parent[at] as number
  return at
}

/**
 * The node range the lines `first..last` show, as `[lo, hi)` in pre-order — the icicle's viewport box.
 * `null` when those lines show no node.
 */
export function visibleNodes(
  t: Tree,
  lines: readonly Line[],
  first: number,
  last: number,
): { lo: number; hi: number } | null {
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let l = Math.max(0, first); l <= last && l < lines.length; l += 1) {
    for (const tok of (lines[l] as Line).tokens) {
      lo = Math.min(lo, tok.node)
      hi = Math.max(hi, tok.node + (tok.kind === 'fold' ? (t.size[tok.node] as number) : 1))
    }
  }
  return lo === Number.POSITIVE_INFINITY ? null : { lo, hi }
}

/** The line a minimap click at fraction `fy` names. */
export function lineAtMinimap(lineCount: number, fy: number): number {
  return Math.min(Math.max(0, lineCount - 1), Math.max(0, Math.floor(fy * lineCount)))
}

/** What the map draws, and marks. */
export type MapState = {
  readonly tree: Tree
  readonly lines: readonly Line[]
  readonly mode: MapMode
  /** The lines the body shows, first and last. */
  readonly first: number
  readonly last: number
  /** Linked nodes, by index. */
  readonly linked: readonly number[]
}

/** What a click on the map names: a node (icicle) or a line (minimap). */
export type MapPick = { readonly node: number } | { readonly line: number }

const HEIGHT = 120

/**
 * The term map: one canvas, drawn as an icicle or as a minimap (spec §6).
 *
 * **EVERY COLOUR IS A PALETTE TOKEN**, read from the canvas's computed style at draw time — the colour gate
 * holds `style.css` to its palette, and a canvas that hard-coded a colour would be the one surface the
 * palette could not reach.
 */
export class TermMap {
  readonly el: HTMLCanvasElement
  #state: MapState | null = null
  /** What the canvas last drew, so a frame that changes none of it redraws nothing. */
  #drawn: { sig: string; tree: Tree; lines: readonly Line[] } | null = null

  constructor(onPick: (pick: MapPick) => void) {
    this.el = document.createElement('canvas')
    this.el.className = 'term-map'
    this.el.setAttribute('role', 'img')
    this.el.addEventListener('click', (e) => {
      const s = this.#state
      if (s === null || this.el.clientWidth === 0 || this.el.clientHeight === 0) return
      const fx = e.offsetX / this.el.clientWidth
      const fy = e.offsetY / this.el.clientHeight
      onPick(s.mode === 'icicle' ? { node: nodeAtIcicle(s.tree, fx, fy) } : { line: lineAtMinimap(s.lines.length, fy) })
    })
  }

  draw(state: MapState): void {
    this.#state = state
    const w = this.el.clientWidth
    const ratio = window.devicePixelRatio || 1
    const sig = `${state.mode}:${state.first}:${state.last}:${state.linked.join(',')}:${w}:${ratio}`
    const d = this.#drawn
    if (d !== null && d.sig === sig && d.tree === state.tree && d.lines === state.lines) return
    this.#drawn = { sig, tree: state.tree, lines: state.lines }
    this.el.setAttribute(
      'aria-label',
      state.mode === 'icicle'
        ? `term map: ${state.tree.count} nodes by depth`
        : `term map: ${state.lines.length} lines`,
    )
    this.el.width = Math.max(1, Math.round(w * ratio))
    this.el.height = Math.round(HEIGHT * ratio)
    const ctx = this.el.getContext('2d')
    if (ctx === null) return
    const css = getComputedStyle(this.el)
    const colour = (name: string) => css.getPropertyValue(name).trim()
    const W = this.el.width
    const H = this.el.height
    ctx.clearRect(0, 0, W, H)
    if (state.mode === 'icicle') this.#icicle(ctx, state, W, H, colour)
    else this.#minimap(ctx, state, W, H, colour)
  }

  #icicle(ctx: CanvasRenderingContext2D, s: MapState, W: number, H: number, colour: (n: string) => string): void {
    const t = s.tree
    const rule = colour('--rule')
    const binder = colour('--tok-binder')
    const nat = colour('--tok-nat')
    ctx.globalAlpha = 0.6
    for (let i = 0; i < t.count; i += 1) {
      const r = icicleRect(t, i)
      ctx.fillStyle = t.chip(i)?.kind === 'numeral' ? nat : t.kind(i) === KIND_ABS ? binder : rule
      ctx.fillRect(r.x * W, r.y * H, Math.max(r.w * W, 0.5), r.h * H - 0.5)
    }
    ctx.globalAlpha = 1
    const column = (i: number, stroke: string, fill: boolean) => {
      const r = icicleRect(t, i)
      const x = r.x * W
      const y = r.y * H
      const w = Math.max(r.w * W, 1)
      if (fill) {
        ctx.globalAlpha = 0.25
        ctx.fillStyle = stroke
        ctx.fillRect(x, y, w, H - y)
        ctx.globalAlpha = 1
      }
      ctx.strokeStyle = stroke
      ctx.lineWidth = 1.5
      ctx.strokeRect(x, y, w, H - y)
    }
    const op = colour('--tok-operator')
    if (t.wire.contractum !== null) column(t.wire.contractum, op, true)
    if (t.wire.nextRedex !== null) column(t.wire.nextRedex, op, false)
    for (const l of s.linked) column(l, colour('--link-edge'), false)
    const seen = visibleNodes(t, s.lines, s.first, s.last)
    if (seen !== null) {
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = colour('--accent')
      ctx.lineWidth = 2
      ctx.strokeRect((seen.lo / t.count) * W, 1, Math.max(((seen.hi - seen.lo) / t.count) * W, 2), H - 2)
      ctx.setLineDash([])
    }
  }

  #minimap(ctx: CanvasRenderingContext2D, s: MapState, W: number, H: number, colour: (n: string) => string): void {
    const t = s.tree
    const n = Math.max(1, s.lines.length)
    const lh = H / n
    let cols = 1
    for (const line of s.lines) cols = Math.max(cols, line.indent + lineText(line).length)
    const cw = W / cols
    const redex = t.wire.nextRedex
    const rule = colour('--rule')
    const op = colour('--tok-operator')
    const link = colour('--link-edge')
    for (const [l, line] of s.lines.entries()) {
      const nodes = line.tokens.map((k) => k.node)
      const marked = redex !== null && nodes.some((x) => t.contains(redex, x))
      const linked = s.linked.some((a) => nodes.some((x) => t.contains(a, x)))
      ctx.fillStyle = marked ? op : linked ? link : rule
      ctx.fillRect(line.indent * cw, l * lh, Math.max(lineText(line).length * cw, 1), Math.max(lh - 0.3, 0.5))
    }
    ctx.setLineDash([4, 3])
    ctx.strokeStyle = colour('--accent')
    ctx.lineWidth = 2
    ctx.strokeRect(1, s.first * lh, W - 2, Math.max((s.last - s.first + 1) * lh, 2))
    ctx.setLineDash([])
  }
}
````

and apply the source half of the patch:

````diff
diff --git a/web/src/lambda-body.ts b/web/src/lambda-body.ts
index 431a20d..a4cd5b2 100644
--- a/web/src/lambda-body.ts
+++ b/web/src/lambda-body.ts
@@ -17,6 +17,8 @@ export type BodyEvents = {
   readonly toggle: (node: number) => void
   /** Link from `node` — any other token was clicked, or a row was entered. */
   readonly link: (node: number) => void
+  /** The body scrolled — the term map's viewport box moves with it. */
+  readonly scrolled?: () => void
 }
 
 /**
@@ -146,6 +148,7 @@ export class LambdaBody {
     this.el.addEventListener('scroll', () => {
       this.#follow.onScroll(this.el.scrollTop)
       this.#paint()
+      this.#on.scrolled?.()
     })
     this.el.addEventListener('click', (e) => this.#click(e))
     this.el.addEventListener('keydown', (e) => this.#key(e))
diff --git a/web/src/lambda-folds.ts b/web/src/lambda-folds.ts
index e219e32..4957893 100644
--- a/web/src/lambda-folds.ts
+++ b/web/src/lambda-folds.ts
@@ -62,6 +62,18 @@ export class Folds {
     this.#version += 1
   }
 
+  /** Open every closed ancestor of `i`, so a line shows it — what a term-map click asks for. */
+  reveal(t: Tree, i: number): void {
+    let changed = false
+    for (let at = t.parent[i] as number; at >= 0; at = t.parent[at] as number) {
+      if (!this.isOpen(t, at)) {
+        this.#overrides.set(t.key(at), true)
+        changed = true
+      }
+    }
+    if (changed) this.#version += 1
+  }
+
   reset(): void {
     this.#overrides.clear()
     this.#version += 1
diff --git a/web/src/lambda-pane.ts b/web/src/lambda-pane.ts
index d86aa22..7e86eb9 100644
--- a/web/src/lambda-pane.ts
+++ b/web/src/lambda-pane.ts
@@ -9,11 +9,13 @@ import type { TreeFor } from './lambda-trees'
 import type { Dir } from './layout'
 import type { LambdaLinkState } from './link-status'
 import { type PaneChoice, type PaneEvents, type SplitChoices, textPanel } from './pane-chrome'
+import { createPanel, type Panel } from './panel'
 import type { LambdaTreeWire, Leg } from './protocol'
 import type { ScratchEditorConfig } from './scratch-editor'
 import { ScratchEditor } from './scratch-editor'
 import type { Binding, PaneOption } from './sessions'
 import { stepControls } from './step-controls'
+import { type MapPick, TermMap } from './term-map'
 import type { LambdaState } from './types'
 import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
 import { DEFAULT_DISPLAY, type LambdaDisplay } from './workspace'
@@ -40,6 +42,12 @@ export class LambdaPane implements EditablePane {
   /** One `Tree` per wire, so a redraw of the same step derives nothing twice. */
   #trees = new WeakMap<LambdaTreeWire, Tree>()
   #folds = new Folds()
+  #map: TermMap
+  #mapPanel: Panel
+  /** The mode buttons in the map panel's header, pressed to match `#display.map`. */
+  #mapModes: HTMLButtonElement[] = []
+  /** The lines the view last drew, for the map to draw beside them. */
+  #shownLines: readonly Line[] = []
   /** How this view draws its term: its layout, its variables, and its term map's mode (spec §5.1). */
   #display: LambdaDisplay
   /** `PaneEvents.display`: record a changed display for this view, so a reload keeps it. */
@@ -160,7 +168,11 @@ export class LambdaPane implements EditablePane {
    */
   #editorAvailable = false
 
-  constructor(host: HTMLElement, on: PaneEvents, opts: { readonly display?: LambdaDisplay } = {}) {
+  constructor(
+    host: HTMLElement,
+    on: PaneEvents,
+    opts: { readonly display?: LambdaDisplay; readonly map?: boolean } = {},
+  ) {
     this.#display = opts.display ?? DEFAULT_DISPLAY
     this.#onDisplay = on.display
     // THE HEADER CARRIES THE TITLE-SELECTOR AND THE STATUS — `view-header.ts`'s own doc has why the title
@@ -169,7 +181,33 @@ export class LambdaPane implements EditablePane {
     this.#body = new LambdaBody({
       toggle: (node) => this.#toggle(node),
       link: (node) => this.#linkFrom(node),
+      scrolled: () => this.#drawMap(),
     })
+    // THE TERM MAP (spec §6): a panel, closed until opened, its mode a pair of pressed buttons in its header.
+    this.#map = new TermMap((pick) => this.#pick(pick))
+    const mapHost = document.createElement('div')
+    mapHost.className = 'term-map-host'
+    mapHost.append(this.#map.el)
+    this.#mapPanel = createPanel({
+      name: 'map',
+      label: 'term map',
+      body: mapHost,
+      open: opts.map ?? false,
+      onToggle: (open) => {
+        on.panel?.('map', open)
+        this.#drawMap()
+      },
+    })
+    for (const mode of ['icicle', 'minimap'] as const) {
+      const b = document.createElement('button')
+      b.type = 'button'
+      b.className = 'map-mode'
+      b.dataset.mode = mode
+      b.textContent = mode
+      b.addEventListener('click', () => this.#setDisplay({ ...this.#display, map: mode }))
+      this.#mapPanel.actions.append(b)
+      this.#mapModes.push(b)
+    }
     this.#steps = stepControls(on)
     // THE FRAME'S STEP for `edit a copy`. The run closure supplies the step of the frame this leg is
     // actually at, which is what design §4.1's replay reduces to. `#refreshDetach` does NOT check the
@@ -230,7 +268,8 @@ export class LambdaPane implements EditablePane {
     // the buffer, not the pane).
     this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
     this.#header.steps.append(this.#steps.el)
-    host.replaceChildren(this.#header.el, this.#collapse.el, this.#body.el)
+    host.replaceChildren(this.#header.el, this.#collapse.el, this.#body.el, this.#mapPanel.el)
+    this.#syncMapModes()
 
     // λ -> SOURCE, the third direction: a click on any token links from the construct its node belongs to
     // (`LambdaBody`'s `link` event, `#linkFrom`), at whatever step is on screen (Plan 7 part 4a).
@@ -270,10 +309,38 @@ export class LambdaPane implements EditablePane {
 
   #setDisplay(d: LambdaDisplay): void {
     this.#display = d
+    this.#syncMapModes()
     this.#redraw()
     this.#onDisplay?.(d)
   }
 
+  #syncMapModes(): void {
+    for (const b of this.#mapModes) b.setAttribute('aria-pressed', String(b.dataset.mode === this.#display.map))
+  }
+
+  /** Draw the term map over what the body shows — only while its panel is open and there is a tree. */
+  #drawMap(): void {
+    const tree = this.#shownTree()
+    if (tree === null || !this.#mapPanel.isOpen()) return
+    const { first, last } = this.#body.visible
+    const linked = this.#pin === null ? [] : tree.nodesLinkedTo(this.#pin)
+    this.#map.draw({ tree, lines: this.#shownLines, mode: this.#display.map, first, last, linked })
+  }
+
+  /** A click on the map: open whatever hides the node it names, then scroll the body to it. */
+  #pick(pick: MapPick): void {
+    const tree = this.#shownTree()
+    if (tree === null) return
+    if ('line' in pick) {
+      this.#body.reveal(pick.line)
+      return
+    }
+    this.#folds.reveal(tree, pick.node)
+    this.#redraw()
+    const at = lineOf(tree, this.#shownLines, pick.node)
+    if (at >= 0) this.#body.reveal(at)
+  }
+
   #lines(tree: Tree): Line[] {
     const width = this.#body.columns()
     const { layout, vars } = this.#display
@@ -739,6 +806,7 @@ export class LambdaPane implements EditablePane {
       this.#folds.advance(tree)
       const lines = this.#lines(tree)
       const linked = this.#pin === null ? [] : tree.nodesLinkedTo(this.#pin)
+      this.#shownLines = lines
       this.#body.showTree(tree, lines, this.#display.layout === 'outline', linked, t.kind === 'stale')
       // A NEW PIN IS SCROLLED TO ONCE, and only when its first node is off screen — a click in this view
       // pins what is under the pointer, so it never moves; a source click brings the construct in.
@@ -749,6 +817,7 @@ export class LambdaPane implements EditablePane {
         const { first: top, last } = this.#body.visible
         if (at >= 0 && (at < top || at > last)) this.#body.reveal(at)
       }
+      this.#drawMap()
       return
     }
     const note = t.kind === 'refused' ? `this step’s term has ${t.nodes.toLocaleString()} nodes — shown as text` : null
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index 95180c4..281d1d4 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1021,7 +1021,11 @@ export function createPaneHost(deps: {
       if (l.pane === 'lambda') {
         const slot = new PaneSlot('lambda', session)
         // ITS DISPLAY IS READ BACK LIKE A TM VIEW'S PANELS BELOW — stored per leaf, defaulted when absent.
-        const pane = new LambdaPane(host, paneEvents(l.id, slot), { display: displayOf(l.id) ?? DEFAULT_DISPLAY })
+        const map = panelOpen(l.id, 'map')
+        const pane = new LambdaPane(host, paneEvents(l.id, slot), {
+          display: displayOf(l.id) ?? DEFAULT_DISPLAY,
+          ...(map === undefined ? {} : { map }),
+        })
         // **A NEW λ PANE IS SEEDED FROM ITS SESSION FOR THE IDENTICAL REASON THE TM BRANCH BELOW IS**,
         // and this line is the λ half of a repair that shipped with only its TM half. `scratch-compiled`
         // is the reply that mounts a scratch editor and it fires once per build, so a pane created after
diff --git a/web/src/style.css b/web/src/style.css
index 7e22835..aba9f83 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -695,6 +695,27 @@ button.view-title[aria-expanded="true"] {
 .term[data-stale] .term-rows {
   opacity: 0.7;
 }
+/* THE TERM MAP (spec §6): one canvas, as wide as the view and a fixed height; its colours come from the
+   palette tokens it reads at draw time (`term-map.ts`). */
+.term-map {
+  display: block;
+  width: 100%;
+  height: 120px;
+  cursor: crosshair;
+}
+.map-mode {
+  padding: 0 0.4em;
+  border: 1px solid var(--rule);
+  border-radius: var(--radius);
+  background: transparent;
+  color: inherit;
+  font: inherit;
+  cursor: pointer;
+}
+.map-mode[aria-pressed="true"] {
+  border-color: var(--accent);
+  box-shadow: inset 0 -2px 0 var(--accent);
+}
 .term-note {
   color: var(--fg-dim);
   font-style: italic;
````

- [ ] **Step 4: Run the tests.** Node tier → `625 passed` (`term-map` 6, `lambda-folds` 7); `term-map` browser → 3 passed. Run the colour gate: `scripts/check-colours.sh --self-test && scripts/check-colours.sh` → clean.

- [ ] **Step 5: Sabotage, one at a time, reverting after each:**

| Sabotage | File run | Fails |
|---|---|---|
| `lambda-pane.ts`, `#pick`: `if (at >= 0) this.#body.reveal(at)` → `void at` | `term-map` (browser) | `scrolls the view to a node picked on the icicle` |
| `lambda-pane.ts`: `open: opts.map ?? false,` → `open: opts.map ?? true,` | `term-map` (browser) | `is a closed panel until opened, and reports the toggle` |
| `lambda-pane.ts`: the mode button's `() => this.#setDisplay({ ...this.#display, map: mode })` → `() => void mode` | `term-map` (browser) | `switches between icicle and minimap from its header, and reports the display` |
| `term-map.ts`, `nodeAtIcicle`: delete the `while (at > 0 && …) at = t.parent[at]` walk (a click names the column's deepest node, not the one at the clicked row) | `term-map` (node) | `names the node whose rectangle holds the point` |
| `lambda-folds.ts`, `reveal`: delete `this.#overrides.set(t.key(at), true)` | `lambda-folds` (node) | `reveals a node by opening every closed ancestor, and nothing else` |

The fourth sabotage does not fail `names the deepest node where a column ends above the row clicked`. Below a column's end, index arithmetic already lands on the deepest node there. The walk matters for a click *above* a deep node, and the first test is the one that makes such a click.

- [ ] **Step 6: Commit.**

```bash
git add web/src web/tests
git commit -m "Web: the term map draws the term as an icicle or a minimap in palette colours, marks the redexes, links and the visible window, and scrolls the view to what is picked"
```

---

### Task 12: Views off the page cost nothing

**Files:**
- Create: `web/src/tm-seed.ts`, `web/tests/browser/hidden-views.test.ts`
- Modify: `web/src/replies.ts` (a disconnected TM view is not handed each compile; it is remembered in an `unseen` set), `web/src/draw.ts` (a TM view seen again is seeded with `seedTm`), `web/src/main.ts` (one `unseen` set shared by both), `web/src/pane-host.ts` (`seedTmPane` delegates to `seedTm`, so a new view and a view seen again are seeded by one function)

**Interfaces:**
- Consumes: Task 8's `draw()` λ loop, which already skips a disconnected view and so asks for no tree.
- Produces: `seedTm(pane: TmPane, compiled: TmCompiled | null, reading: TmScratchReading | null): void`; `createReplies({ …, unseen?: WeakSet<TmPane> })`; `createDraw({ …, unseen: WeakSet<TmPane> })`.

This closes part 2b's "`replies.ts` paints disconnected panes" (spec §5.5). The λ half needed no new code — Task 8's loop already skips a hidden view — so its test is a guard. It passes before this task, and its sabotage fires.

- [ ] **Step 1: Write the test.** Create `web/tests/browser/hidden-views.test.ts`:

````ts
import type { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { LambdaTrees } from '../../src/lambda-trees'
import { TmPane } from '../../src/tm-pane'
import { SHELL, until } from './harness'

/**
 * A view off the page costs nothing (Plan 7 part 4a, closing part 2b's "`replies.ts` paints disconnected
 * panes"): a hidden TM view is not handed each compile's machine, and a hidden λ view asks the worker for no
 * tree. In the Stage preset every view but the shown one is off the page.
 */
let view: EditorView

const pick = (sel: string): void => {
  document.querySelector<HTMLButtonElement>('#workspace')?.click()
  document.querySelector<HTMLButtonElement>(`#workspace-menu ${sel}`)?.click()
  const m = document.querySelector<HTMLElement>('#workspace-menu')
  if (m?.matches(':popover-open')) m.hidePopover()
}
const tab = (leaf: string) => document.querySelector<HTMLElement>(`#views [role="tab"][data-leaf="${leaf}"]`)
const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'

async function compile(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(() => !idle(), 'the compile to start')
  await until(idle, 'the compile to finish')
}

describe('views off the page', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
    await compile('let x = 40; x + 2')
    pick('[data-preset="stage"]')
    tab('lambda-0')?.click()
  })

  afterEach(() => vi.restoreAllMocks())

  it('does not hand a hidden TM view each compile, and seeds it when it is shown', async () => {
    const setProgram = vi.spyOn(TmPane.prototype, 'setProgram')
    await compile('let y = 1; y + 1')
    expect(setProgram, 'the TM view is off the page').not.toHaveBeenCalled()
    tab('tm-0')?.click()
    await until(() => setProgram.mock.calls.length > 0, 'the shown TM view to be seeded')
    expect(document.querySelector('[data-leaf="tm-0"] .state-row')).not.toBeNull()
  })

  it('asks for no λ tree for a hidden λ view', async () => {
    tab('tm-0')?.click()
    const want = vi.spyOn(LambdaTrees.prototype, 'want')
    await compile('let z = 2; z + 2')
    expect(want, 'the λ view is off the page').not.toHaveBeenCalled()
    tab('lambda-0')?.click()
    await until(() => want.mock.calls.length > 0, 'the shown λ view to ask for its tree')
  })
})
````

- [ ] **Step 2: Run it to verify the TM half fails.**

The test uses only existing API, so `pnpm run typecheck` passes; the red step is in the browser.

Run: `cd web && PATH=/usr/sbin:$PATH pnpm exec vitest run --project browser tests/browser/hidden-views.test.ts`
Expected: 1 failed, 1 passed. `does not hand a hidden TM view each compile, and seeds it when it is shown` fails with `the TM view is off the page: expected "setProgram" to not be called at all, but actually been called 1 times`. `asks for no λ tree for a hidden λ view` already passes: it is Step 5's guard on Task 8's skip.

- [ ] **Step 3: Seed a TM view when it is seen.** Create `web/src/tm-seed.ts`:

````ts
import { ruleCount } from './protocol'
import type { TmCompiled, TmScratchReading } from './sessions'
import type { TmPane } from './tm-pane'

/**
 * Tell a TM view everything its session holds — the machine, whether it may be forked, a copy's status and
 * value reading — and that it holds nothing where it does not.
 *
 * **ONE FUNCTION FOR EVERY MOMENT A VIEW NEEDS IT**: created or rebound (`pane-host.ts`'s `seedTmPane`, whose
 * doc has why each fact is pushed, `null`s included), and shown after compiles it missed while it was off the
 * page (`draw.ts`, Plan 7 part 4a). Two copies of these four calls would be two chances for one to forget a fact.
 */
export function seedTm(pane: TmPane, compiled: TmCompiled | null, reading: TmScratchReading | null): void {
  pane.setProgram(compiled?.program ?? null, compiled?.tapeNames ?? [])
  pane.setForkAvailable(compiled?.tmText ?? null, compiled === null ? 0 : ruleCount(compiled.program))
  pane.setScratchStatus(reading?.status ?? null)
  pane.setScratchValue(reading?.value ?? null)
}
````

and apply:

````diff
diff --git a/web/src/draw.ts b/web/src/draw.ts
index 4e8b775..8980d68 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -20,6 +20,7 @@ import {
 import type { SessionId } from './session-client'
 import type { SessionRegistry } from './sessions'
 import type { TmPane } from './tm-pane'
+import { seedTm } from './tm-seed'
 
 /**
  * ONE FRAME, PAINTED ONCE — the per-frame pass that runs on every recorded frame during playback.
@@ -68,6 +69,8 @@ export function createDraw(deps: {
   links: LinkWiring
   /** The λ trees the views draw — asked here for each connected view's displayed step (spec §4). */
   trees: LambdaTrees
+  /** TM views a machine reached while they were off the page (`replies.ts`); each is seeded when next shown. */
+  unseen: WeakSet<TmPane>
   leaves: () => number
   sourceAvailable: () => boolean
   hasEditor: (session: SessionId) => boolean
@@ -95,6 +98,7 @@ export function createDraw(deps: {
     panes,
     links: linkWiring,
     trees,
+    unseen,
     leaves,
     sourceAvailable,
     hasEditor,
@@ -179,6 +183,11 @@ export function createDraw(deps: {
       // only observer is the next `innerHTML` read. Selecting a tab re-attaches the host and ends in a
       // `draw()`, so nothing comes back stale.
       if (!p.host.isConnected) continue
+      if (p.slot.binding.leg === 'tm' && unseen.has(p.pane as TmPane)) {
+        const entry = sessions.entryOf(p.slot.binding.session)
+        seedTm(p.pane as TmPane, entry.tmProgram, entry.tmScratch)
+        unseen.delete(p.pane as TmPane)
+      }
       const leg = p.slot.resolve(sessions)
       if (p.slot.binding.leg === 'tm') (p.pane as TmPane).setFocus(tmFocusLink?.states ?? [])
       p.slot.render(sessions, p.pane, leg)
diff --git a/web/src/main.ts b/web/src/main.ts
index bda2a7d..d17e1be 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -644,6 +644,8 @@ async function main(): Promise<EditorView> {
   })
   /** The λ trees the views draw (spec §4) — one cache, asked through each session's own client. */
   const trees = new LambdaTrees((id) => (sessions.has(id) ? sessions.entryOf(id).client : undefined))
+  /** TM views a machine reached while they were off the page — `replies.ts` adds, `draw()` seeds and removes. */
+  const unseenTm = new WeakSet<TmPane>()
   /**
    * TRANSPORT, BEFORE EITHER PANE — its `events(...)` is what each pane is constructed with, so it has
    * to exist first. `scratchpad` is a real value (constructed above, and nothing later reassigns it);
@@ -1735,6 +1737,7 @@ async function main(): Promise<EditorView> {
     panes,
     links: linkWiring,
     trees,
+    unseen: unseenTm,
     leaves: () => leaves(tree).length,
     sourceAvailable: () => !leaves(tree).some((l) => l.pane === 'source'),
     // WRAPPED RATHER THAN PASSED AS `custody.hasEditor`, the same shape `editorHome` below uses for
@@ -1809,6 +1812,7 @@ async function main(): Promise<EditorView> {
     panes,
     links: linkWiring,
     trees,
+    unseen: unseenTm,
     draw,
     notify: (text: string) => notices.notify(text),
     setProgram: (r: ProgramResult) => {
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index 281d1d4..ea679b1 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -14,11 +14,12 @@ import {
 import { renderLayout, renderStage, syncSizes } from './layout-view'
 import type { PaneChoice, PaneEvents } from './pane-chrome'
 import type { LeafId, PaneCollection, PaneKind } from './panes'
-import { type Leg, ruleCount } from './protocol'
+import type { Leg } from './protocol'
 import type { Detachable } from './scratch'
 import type { SessionId } from './session-client'
 import { type Binding, PaneSlot, type TmCompiled, type TmScratchReading } from './sessions'
 import { TmPane } from './tm-pane'
+import { seedTm } from './tm-seed'
 import { DEFAULT_DISPLAY, type LambdaDisplay } from './workspace'
 
 /**
@@ -348,12 +349,7 @@ export function createPaneHost(deps: {
    * also has `tmText: null`, and that is a question this module does not ask of a session.
    */
   const seedTmPane = (pane: TmPane, session: SessionId): void => {
-    const compiled = tmProgramOf(session)
-    pane.setProgram(compiled?.program ?? null, compiled?.tapeNames ?? [])
-    pane.setForkAvailable(compiled?.tmText ?? null, compiled === null ? 0 : ruleCount(compiled.program))
-    const reading = tmScratchOf(session)
-    pane.setScratchStatus(reading?.status ?? null)
-    pane.setScratchValue(reading?.value ?? null)
+    seedTm(pane, tmProgramOf(session), tmScratchOf(session))
   }
 
   /**
diff --git a/web/src/replies.ts b/web/src/replies.ts
index f331106..82efc87 100644
--- a/web/src/replies.ts
+++ b/web/src/replies.ts
@@ -77,6 +77,11 @@ export function createReplies(deps: {
   panes: PaneCollection
   links: LinkWiring
   trees: LambdaTrees
+  /**
+   * TM views a machine reached while they were off the page — `draw()` seeds each when it is next shown. Optional:
+   * a caller that never hides a view (every direct test of this module) needs none, and gets a set nothing reads.
+   */
+  unseen?: WeakSet<TmPane>
   draw: () => void
   /**
    * The pane currently holding `session`'s editor, or `undefined` if none currently is — replaces a
@@ -126,6 +131,7 @@ export function createReplies(deps: {
     panes,
     links: linkWiring,
     trees,
+    unseen = new WeakSet<TmPane>(),
     draw,
     editorHome,
     onBuffersPersist,
@@ -155,6 +161,13 @@ export function createReplies(deps: {
     const rules = compiled === null ? 0 : ruleCount(compiled.program)
     for (const p of panes.ofSession('tm', session)) {
       const pane = p.pane as TmPane
+      // **A VIEW OFF THE PAGE IS NOT TOLD NOW** (Plan 7 part 4a, closing 2b's "`replies.ts` paints disconnected
+      // panes"): the session keeps what it was told, above, and `draw()` seeds the view from it when its tab
+      // is next shown. Building a hidden view's δ table on every compile is the cost this skips.
+      if (!p.host.isConnected) {
+        unseen.add(pane)
+        continue
+      }
       pane.setProgram(compiled?.program ?? null, compiled?.tapeNames ?? [])
       then?.(pane, rules)
     }
````

- [ ] **Step 4: Run it.** `hidden-views` → 2 passed; `tm-pane-follows-session` and the node tier (`625 passed`) unchanged.

- [ ] **Step 5: Sabotage, one at a time, reverting after each** (`hidden-views`):

| Sabotage | Fails |
|---|---|
| `replies.ts`: delete the `if (!p.host.isConnected) { unseen.add(pane); continue }` block | `does not hand a hidden TM view each compile, and seeds it when it is shown` |
| `draw.ts`, the λ loop: delete `if (!p.host.isConnected) continue` | `asks for no λ tree for a hidden λ view` |
| `draw.ts`: delete `seedTm(p.pane as TmPane, entry.tmProgram, entry.tmScratch)` | `does not hand a hidden TM view each compile, and seeds it when it is shown` |

- [ ] **Step 6: Commit.**

```bash
git add web/src web/tests
git commit -m "Web: a view off the page costs nothing — a hidden TM view is seeded when shown rather than painted on every compile, and a hidden λ view asks for no tree"
```

---

### Task 13: What a tree costs, end to end — a probe, not a gate

**Files:**
- Create: `web/tests/browser/lambda-tree-cost.test.ts`
- Modify: `web/vite.config.ts` (the file joins `PROBE_FILES`, so the default run excludes it), `web/package.json` (`test:probe:lambda-tree`)

**TWO CLOCKS, BOTH INSIDE THE APP, because the obvious one lies.** Timing a `◀` click to `lambdaSettled()` measured the harness's 20 ms poll: every program came out at 21.6 to 22.1 ms median in the first draft. `round trip` is a `SessionClient.tree` request to the `LambdaTrees.store` of its answer. `draw` is the first `LambdaPane.renderTree` call to receive each tree.

- [ ] **Step 1: The probe.** Create `web/tests/browser/lambda-tree-cost.test.ts`:

````ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LambdaPane } from '../../src/lambda-pane'
import { LambdaTrees } from '../../src/lambda-trees'
import type { LambdaTreeWire } from '../../src/protocol'
import { SessionClient } from '../../src/session-client'
import { SHELL, until } from './harness'
import { lambdaSettled } from './lambda-text'

/**
 * WHAT A TREE FOR THE DISPLAYED STEP COSTS, END TO END (Plan 7 part 4a, spec §11 item 5). A PROBE, NOT A
 * GATE: `pnpm test:probe:lambda-tree`, excluded from the default run by `vite.config.ts`'s `PROBE_FILES`.
 *
 * TWO CLOCKS, BOTH INSIDE THE APP, because the obvious one lies: timing a `◀` click to `lambdaSettled()`
 * measured the harness's 20 ms poll — every program came out at 21.6 to 22.1 ms median in the first draft of
 * this file. So: `round trip` is a `SessionClient.tree` request to the `LambdaTrees.store` of its answer (the
 * worker's replay from its nearest checkpoint, the arena, the transfer), and `draw` is the first
 * `LambdaPane.renderTree` call to receive each tree (the layout and the paint; later frames reuse the layout). The numbers go to the console
 * for the roadmap entry; the only assertion is that every step was answered at all.
 */
const PROGRAMS: readonly (readonly [string, string])[] = [
  ['fact3', 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(3)'],
  ['fact4', 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } }\nfact(4)'],
  ['while4', 'let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc'],
]
/** Steps back from the frontier per program — enough to cross a checkpoint boundary at least once. */
const SAMPLES = 300

let view: EditorView

const stepText = () => document.querySelector('[data-leaf="lambda-0"] .step')?.textContent ?? ''
const back = () =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-leaf="lambda-0"] .controls button')]
    .find((b) => b.textContent === '◀')
    ?.click()

function stats(xs: number[]): string {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => (s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0).toFixed(2)
  return `n=${s.length} median=${at(0.5)}ms p90=${at(0.9)}ms max=${at(1)}ms`
}

describe('the cost of the λ tree', () => {
  beforeAll(async () => {
    document.body.innerHTML = SHELL
    view = await (await import('../../src/main')).ready
  })

  it('times the round trip from a step to its drawn tree', async () => {
    for (const [name, src] of PROGRAMS) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
      await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', `${name} to compile`)
      await until(() => /ended|history is full/.test(stepText()) || !stepText().endsWith('…'), `${name} to record`)
      await lambdaSettled()
      const asked = new Map<number, number>()
      const trips: number[] = []
      const draws: number[] = []
      const tree = SessionClient.prototype.tree
      const store = LambdaTrees.prototype.store
      const render = LambdaPane.prototype.renderTree
      vi.spyOn(SessionClient.prototype, 'tree').mockImplementation(function (this: SessionClient, step, budget) {
        asked.set(step, performance.now())
        tree.call(this, step, budget)
      })
      vi.spyOn(LambdaTrees.prototype, 'store').mockImplementation(function (
        this: LambdaTrees,
        session,
        gen,
        wire: LambdaTreeWire,
      ) {
        const t0 = asked.get(wire.step)
        if (t0 !== undefined) trips.push(performance.now() - t0)
        store.call(this, session, gen, wire)
      })
      const drawn = new WeakSet<LambdaTreeWire>()
      vi.spyOn(LambdaPane.prototype, 'renderTree').mockImplementation(function (this: LambdaPane, treeFor, pin) {
        const t0 = performance.now()
        render.call(this, treeFor, pin)
        // THE FIRST DRAW OF EACH TREE ONLY: later frames of the same step reuse its layout, and counting them
        // would report the cache.
        if (treeFor.kind === 'tree' && !drawn.has(treeFor.tree)) {
          drawn.add(treeFor.tree)
          draws.push(performance.now() - t0)
        }
      })
      for (let i = 0; i < SAMPLES; i += 1) {
        back()
        await lambdaSettled()
      }
      vi.restoreAllMocks()
      console.log(`lambda-tree-cost ${name}: round trip ${stats(trips)}; draw ${stats(draws)}`)
      expect(trips.length).toBeGreaterThanOrEqual(SAMPLES)
    }
  }, 600_000)
})
````

and apply:

````diff
diff --git a/web/package.json b/web/package.json
index 746b64a..089b27f 100644
--- a/web/package.json
+++ b/web/package.json
@@ -20,6 +20,7 @@
     "test:probe:tm": "REDEXTAPE_PROBE=1 vitest run --project browser tests/browser/tm-fork-cost.test.ts",
     "test:probe:tm-buffer": "export REDEXTAPE_PROBE_TM_BUFFER_RUN=\"$(date +%s)-$$\" && bash ../scripts/emit-probe-reduced-files.sh && wasm-pack build ../crates/redextape-wasm --release --target web --out-dir ../../target/probe-tm-buffer-wasm -- --features probe-no-tm-scratch-ceiling && printf %s \"$REDEXTAPE_PROBE_TM_BUFFER_RUN\" > ../target/probe-tm-buffer-wasm/run.txt && REDEXTAPE_PROBE=1 vitest run --project browser --reporter=verbose tests/browser/tm-buffer-cost.test.ts",
     "test:probe:floor": "REDEXTAPE_PROBE=1 vitest run --project browser tests/browser/pane-floor.test.ts",
+    "test:probe:lambda-tree": "REDEXTAPE_PROBE=1 vitest run --project browser --reporter=verbose tests/browser/lambda-tree-cost.test.ts",
     "test:coverage": "vitest run --coverage"
   },
   "devDependencies": {
diff --git a/web/vite.config.ts b/web/vite.config.ts
index a14ce53..089bea1 100644
--- a/web/vite.config.ts
+++ b/web/vite.config.ts
@@ -66,6 +66,7 @@ const PROBE_FILES = [
   'tests/browser/tm-fork-cost.test.ts',
   'tests/browser/pane-floor.test.ts',
   'tests/browser/tm-buffer-cost.test.ts',
+  'tests/browser/lambda-tree-cost.test.ts',
 ]
 const PROBE_EXCLUDE = process.env.REDEXTAPE_PROBE === undefined ? PROBE_FILES : []
 
````

- [ ] **Step 2: Confirm the default run excludes it.**

Run, without `REDEXTAPE_PROBE`: `cd web && PATH=/usr/sbin:$PATH pnpm exec vitest run --project browser tests/browser/lambda-tree-cost.test.ts`
Expected: `No test files found, exiting with code 1`, with `tests/browser/lambda-tree-cost.test.ts` in the printed `exclude:` list — the default run and CI never pay for it.

- [ ] **Step 3: Run the probe.** `cd web && PATH=/usr/sbin:$PATH systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 pnpm test:probe:lambda-tree`, with nothing else running. It prints one line per program. The prototype measured:

```
lambda-tree-cost fact3: round trip n=300 median=0.80ms p90=2.00ms max=3.00ms; draw n=300 median=1.70ms p90=1.90ms max=2.90ms
lambda-tree-cost fact4: round trip n=300 median=1.00ms p90=2.20ms max=5.90ms; draw n=300 median=1.90ms p90=2.20ms max=3.10ms
lambda-tree-cost while4: round trip n=300 median=0.70ms p90=1.90ms max=2.80ms; draw n=300 median=1.70ms p90=2.20ms max=3.00ms
```

Record the three lines you get in the task report; Task 14 quotes them.

- [ ] **Step 4: Check the clock can see the worker.** In `session-worker.ts`'s `onLambdaTree`, stall 10 ms before building the tree: add `const stall = performance.now() + 10` and `while (performance.now() < stall) {}` before `const tree = live.session.lambdaTree(req.step, req.budget)`. Re-run the probe. Expected: every round-trip median rises by about 10 ms (the prototype: 10.4–10.8 ms), and the draw medians do not move. Revert.

- [ ] **Step 5: Commit.**

```bash
git add web/tests/browser/lambda-tree-cost.test.ts web/vite.config.ts web/package.json
git commit -m "Web: a probe-tier measurement of what the displayed step's tree costs, from the request to its first draw"
```

---

### Task 14: Verify the branch whole, and write its roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (one new entry)

This task writes no product code unless Step 1 or Step 2 finds something. If either does, fix it in its own commit, with its own test and sabotage, before going on — findings are fixed on the branch, not deferred to a follow-up.

- [ ] **Step 1: The whole-branch review.** Run the subagent-driven-development skill's final review over `edcb6e8..HEAD`, after every task's own review has come back clean. Clean task reviews are its precondition, not a reason to skip it: this plan's own pre-flight found 34 stale references and two untested behaviours that no single task's diff showed. Give the reviewer these three questions as well as its own:
  - Does any comment, doc or test name a thing this branch deleted, or describe behaviour it changed, in the present tense?
  - Does any claim in the code about the λ view, the link window or `LinkIndex` still hold after Task 9?
  - Does every fold reset the spec names (§5.2 and amendment 5) have a test that fails without it?

- [ ] **Step 2: Measure `lsp-hover`'s move case under load, against `main`.** `lsp-hover.test.ts`'s "pointer hover survives a move that stays within the same token" failed twice in the prototype's full-suite runs, in two separate sessions, timing out at 15 s. It has not failed anywhere else:
  - two full-suite runs at `edcb6e8`;
  - three runs of the file alone;
  - three runs alone with every tree reply delayed 800 ms;
  - five paired runs, branch and base, of the file beside `app`, `two-lambda-panes` and `scratch-app`.

  The test documents a pre-existing CodeMirror race (`HoverPlugin.update` clears a tooltip on a geometry-only update) and retries around it. This branch adds one plausible new cause: the λ view's layout can now change after a compile settles.

  Run the full suite 5 times on the branch and 5 times on `main`, sequentially, with nothing else running. Record this case's result each time.
  - If the branch fails it more often, find the mechanism and fix it before the PR.
  - If both fail it alike, it predates this branch: record both rates in the roadmap entry's "did not close" section.

  Either way, quote the ten results.

- [ ] **Step 3: Everything CI runs, and the image no job builds.** Run each in a detached unit, logging to the scratchpad:

```
systemd-run --user --unit=p4a-verify -p MemoryMax=16G -p MemorySwapMax=0 \
  --setenv=PATH=/usr/sbin:/home/davey/.local/share/cargo/bin:/usr/bin:/bin \
  --setenv=CARGO_HOME=/home/davey/.local/share/cargo --setenv=RUSTUP_HOME=/home/davey/.local/share/rustup \
  --setenv=HOME=/home/davey --working-directory="$PWD" bash -c '<command> > <scratchpad>/<name>.log 2>&1'
```

  | Command | Expect |
  |---|---|
  | `scripts/check-all.sh` | base, LLVM and browser tiers all green (grep the log for `not found` before believing a failure) |
  | `cargo llvm-cov nextest --workspace --fail-under-lines 90` | exits 0; quote the line coverage |
  | `scripts/check-slow.sh` | exits 0 |
  | `scripts/check-{text-bytes,citations,attributions,doc-figures,shared-docs,lua}.sh`, each `--self-test` then alone | all exit 0 |
  | in `web/`: `pnpm run build:wasm && pnpm exec biome ci --error-on-warnings && pnpm run typecheck && pnpm run test:coverage && pnpm run build:app` | all exit 0 |

  Then build and start the image, which no PR job builds. This branch adds no new build output the app imports, so it should be unaffected — but only a built image shows that:

```
docker build -t redextape-check .                                   # /usr/sbin/docker
docker run -d --name p4a-check -p 8099:80 redextape-check
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8099/        # 200
docker inspect --format '{{.State.Health.Status}}' p4a-check        # healthy
docker exec p4a-check ls /usr/share/nginx/html/assets/ | grep wasm  # every wasm the app loads, both crates and the grammars
docker rm -f p4a-check
```

- [ ] **Step 4: The manual check the umbrella requires.** `pnpm run dev`; for each of the three presets, in light and in dark, load `fact(3)` and check:
  - the laid-out term and a finished run's chip;
  - both redex marks;
  - a fold and a chip opened by hand;
  - the outline layout and de Bruijn variables;
  - the term map as icicle and minimap, with a pick scrolling the view;
  - a source click marking every node that carries the construct at a later step.

  Screenshot each preset and theme (six shots) for the entry. Re-shoot anything a step here fixed.

- [ ] **Step 5: Write the roadmap entry.** Add it at the end of `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, in the shape the entries before it use:
  - **Heading:** `#### PLAN 7 PART 4a, THE λ VIEW: … (YYYY-MM-DD, branch \`…\`, \`edcb6e8..<last code commit>\`, N commits, plus this entry)`. The range excludes the entry's own commit; "plus this entry" covers it. Close the range — no placeholders.
  - **`#####` sections in the entry's own voice:** what 4a built; the defects the prototype found (Pre-flight status above); what the whole-branch review found; and Step 2's result.
  - **`##### WHAT THIS DID NOT CLOSE`, at least:**
    - the core `LinkIndex` still builds its λ span and node columns (`lambda_spans`, `lambda_nodes`), and the worker still ships them, but since Task 9 nothing in the web reads them — `viewmodel_contract.rs` and `examples/link_index_probe.rs` are their only readers (`lambda_text` is still read, by `draw()`'s declined check);
    - `assertTokenClasses` now guards no reader (`types.ts` says why it stays);
    - the `'too-large'` λ link state is not covered end to end (`app.test.ts` records why its predecessor was not either);
    - the worker's declined-leg guard in `onLambdaTree` is unreachable through the view, which never asks for a declined leg's tree, so no test drives it;
    - the owner-tag versus path-link order is unobservable on the corpus (Task 1);
    - the nested-box layout the spec keeps as a note;
    - 4b, the TM view, which gets its own plan.
  - **`##### VERIFICATION`**, ending with **"Every count this entry quotes, with what produces it"**: one row per figure — its value, a label and the command that produces it. Among them: every Step 3 result; Task 13's three probe lines; the node-tier and full-suite counts; the ten Step 2 results.

  **Run every one of those commands before committing the entry, not after.** Figures in `docs/` are dated observations; never "correct" an older entry's figures to today's tree.

- [ ] **Step 6: Commit.**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: Plan 7 part 4a — the λ view draws a tree served for the displayed step, in two layouts with folds, chips, linking at every step and a term map"
```

- [ ] **Step 7: Report.** Give the user the branch, its commit count, and Step 2's outcome in one line each. Push and open the PR only when they ask; the PR body is one long line per paragraph (Forgejo renders hard breaks).
