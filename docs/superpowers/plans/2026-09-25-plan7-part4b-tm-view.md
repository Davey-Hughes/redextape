
# Plan 7 part 4b — the TM view: the rule table as a grid sharing the view's height, and the state diagram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the TM view an accessible rule table that shares the view's height, tapes a screen reader can read, and a state diagram — a program level of one row per asm instruction with its jumps drawn as arcs or written as chips, and a local level of the states around the current one — the TM half of [Plan 7 part 4](../specs/2026-09-23-plan7-part4-views-design.md).

**Architecture:** The core keeps, beside each state's owner, the asm instruction it was built for, the program's listing and its labels (`SourceMap::tm_instr`, `tm_listing`, `tm_labels`); the session builds its map at the width the run fitted, since state names depend on the width (amendment 14), and puts the three on the wire as `StateView.instr`, `TmProgram.listing` and `TmProgram.labels`. The web groups a machine's states once per compile — by instruction, by the first segment of their names, or not at all (§7) — and draws the diagram from those groups: a virtualized grid for the program level with an arc gutter and a runtime column (*arcs*) or text chips (*chips*), and a small SVG graph for the local level. The rule table becomes an ARIA grid whose height is a share of the view's; the tapes become labelled groups.

**Tech Stack:** Rust (`redextape-core`, `redextape-wasm`, ts-rs bindings), TypeScript (vanilla DOM, SVG), Vitest (node and browser projects, Playwright Chromium).

## Global Constraints

- The spec is `docs/superpowers/specs/2026-09-23-plan7-part4-views-design.md` **as amended** — amendments 8 to 16 are 4b's. Where this plan and the spec disagree, stop and ask.
- Grouping has three tiers (§7): by instruction when any state carries `instr`, by the first dotted name segment when none does but a name has a dot, and none otherwise — then the diagram shows the local level only and *program* is disabled with its reason.
- The program level (§8, amendments 9 and 11): one row per instruction in listing order under its labels, a runtime routine in *arcs*' side column or under *chips*' `runtime` heading, a ⚠ for edges into `overflow`, no drawn fall-through. *Arcs* is the default. Rows are `ROW_HEIGHT` (24 px) and virtualize through `visibleWindow`.
- The local level (§8, amendment 10): the current state and every state within `REACH` = 2 rules, in columns −2 to +2 by signed distance; a state within reach both ways takes its forward distance.
- A TM view's open panels share its height (§9.1, amendment 12): rules 2, diagram 1, outline 1, each body at least five rows; the source view's outline keeps its `40vh` cap.
- The rule table is a grid (§9.2, amendment 13): one tab stop, one `gridcell` per row, an active row by index named by `aria-activedescendant`. The mark is *next rule* (`.is-next`), with `aria-current="step"` on the current state's row (§9.3). Nothing is announced per step.
- `TmDisplay` is `{ level: 'program' | 'local', edges: 'arcs' | 'chips' }`, default `{ level: 'program', edges: 'arcs' }`, kept per view in the workspace's `tmDisplay`; a stored workspace without it loads with none stored. `WORKSPACE_VERSION` does not change.
- The umbrella's §4 rules bind every control: a glyph-only control takes its tooltip as its accessible name; a control that cannot apply is removed, one that could but cannot now is disabled with its reason (`disabled`, and the reason as `aria-description` and tooltip).
- Doc comments are `///` in Rust and `/** */` in TypeScript. No `file:line` citations in tracked source (the pre-commit hook rejects them); they are normal in `docs/`. No plan task numbers in shipped code.
- The pre-commit hook runs `cargo fmt --check`, clippy with `-D warnings`, `biome ci --error-on-warnings`, `pnpm run typecheck` and seven hygiene scans on every commit. Never `--no-verify`.
- No colour literal outside the palette's fallback block in `web/src/style.css` (the colour gate). SVG strokes and fills are CSS, from palette tokens.
- Every native test and build runs under `systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0`. `wasm-pack test` needs `/usr/sbin` on `PATH` for Chrome and a chromedriver of Chrome's major version (`scripts/check-all.sh`'s `ensure_chromedriver`). A sabotage run uses `--no-fail-fast`.
- Every key test is sabotaged once before its task is committed, and the sabotage and its result go in the task report. A sabotage that does not fire is a finding, not a pass.

## How to use the code in this plan

**The code below is the prototype's, verbatim, and it was rebuilt from this document's own blocks before the plan was committed** (see Pre-flight status). Each task gives its **new files in full** and its **changes to existing files as a patch**:

- A new file: create it with exactly the content shown.
- A patch: save the block to a file **outside the repository** (the session scratchpad) and run `git apply <that file>` from the repository root. A patch that does not apply means the tree has drifted from the state this plan was built against — this plan's own commit plus the tasks before it. Stop and report; do not hand-merge.
- Each task's tests go in first — its new test files and the tests' half of its patch — so the red step can be observed; then the source.

**Stage before running a hygiene scan by hand.** `check-attributions` resolves a citation against *tracked* files, so a new file that is not yet `git add`ed reads as missing. The hook runs on the staged commit, where that cannot happen.

**Browser tests.** `cd web && pnpm exec vitest run --project browser <files>`. They drive the whole app in Playwright's Chromium; the TM cases set a tall viewport (`page.viewport(1280, 2400)`) because the sharing of the view's height is only visible above the panels' floors. **Run one browser suite at a time**: two started together on one machine hung, both idle, until killed. **Where `web/node_modules` is a symlink** — a worktree sharing the main checkout's — `fonts.test.ts`'s two cases fail, as they do on `main`; any other failure is real.

## Pre-flight status

**Every task was built, gated and sabotaged before this plan was written**, in a scratch worktree at `7a5c0ad`. The prototype was then rebuilt task by task from exactly the blocks in this document, on a fresh worktree at `0adcab7` — the commits between it and this plan's add only `docs/` — as an executor would: each task's tests' half applied and its red step run as written, then its source half, its tree staged and compared with the prototype's, `docs/` aside, its green step and gates run as written, and every sabotage in its table run again, one at a time. Trees: all six IDENTICAL. Every *Expected* line below is what that run printed, and every *Fails* column is what that sabotage failed there.

| Task | Tree against the prototype | Red step | Green step and gates | Sabotages fired |
|---|---|---|---|---|
| 1 | IDENTICAL | failed, as each task says | passed | 6 of 6 |
| 2 | IDENTICAL | failed, as each task says | passed | 6 of 6 |
| 3 | IDENTICAL | failed, as each task says | passed | 14 of 14 |
| 4 | IDENTICAL | failed, as each task says | passed | 12 of 12 |
| 5 | IDENTICAL | failed, as each task says | passed | 19 of 21 |
| 6 | IDENTICAL | failed, as each task says | passed but for `fonts.test.ts`'s two, a symlink artifact | 24 of 24 |

**83 sabotages were run in that replay, one at a time, each restored before the next; 81 fired.** The two that do not are Task 5's rows 16 and 21, recorded there with why. Each task lists its own.

**What the prototype found, all answered in the code below:**

1. **State names depend on the field width, and `tm_owner` had the hole `tm_instr` would have had** (spec amendment 14). The session built its map at `MIN_FIELD_WIDTH` (4) and ran the machine at the width it fitted; the app's own sample fits at 64 and 47 of its 123 states have names no width-4 machine has, so `tm_owner` resolved 74 of the 121 states billed to an instruction. The test meant to pin this, `the_source_node_resolves_at_the_width_the_run_fitted`, passed as soon as one state resolved. `compile` now runs first and builds the map at the fitted width, and the replacement test counts every billed state (Task 2).
2. **No one-line asm printer existed** (amendment 8). `print_asm_with_inner` wrote each instruction inline; `write_instr` is now the one place an instruction becomes text, and `print_instr` and `print_asm` both go through it (Task 1).
3. **A closed outline's list stayed on screen, on `main`.** `.outline { display: flex }` outranks the browser's `[hidden] { display: none }`, so `panel.ts` hiding a closed panel's body hid nothing — the source view's outline from the first draw. The 40vh cap hid how much it cost. `hidden.test.ts` now looks for the whole class across the app, and it then caught two instances the prototype itself added: the TM view's flex rule showing a hidden outline panel, and the diagram's body showing while its panel was closed (Tasks 3 and 5).
4. **A resize read as a user's scroll, and detached following.** Once the table's and the diagram's heights became the view's, a panel closing beside one grew it past its content, the browser clamped its scroll, and the clamp's `scroll` event read as the user taking control. `Follow.onResize` records a clamp seen by a resize observer; a scroll handler that finds its box's height changed since the last draw calls it too, because in the diagram the `scroll` came first (Task 5).
5. **Four tests passed for the wrong reason until a sabotage showed it:** a resize-redraw test that polled long enough for another draw to fill the rows (held to two frames, which replaying this plan showed was not enough: the first finding below); a sub-step de-duplication with no repeated sub-step in its fixture; a radio key that could not be seen to land on a disabled choice, since the stored level already equalled it; and a *show states* button handler that a click on its row made redundant (deleted).
6. **Grouping costs 1.4–1.8 ms for `fact(3)`'s 1,199 states, 8.3–13.7 ms for `list60`'s 33,699 and 38.5–39.9 ms for `list150`'s 197,265 at binary — the first call on each machine, over three page loads (the appendix's grouping probe) on the main thread**, once per compile, never per frame; building the map at the fitted width costs 4.3–5.5 ms for `list60` and 31–34 ms for `list150` at binary (the appendix's map probe) more than at width 4.
7. **Stepping to a mid-run state by 9,000 clicks timed out under a full suite's load**; the tests restart and step forward 1,732 steps to `cmpeq` instead.
8. **An independent review of the whole prototype, run in a browser, found six Important defects and nine Minor ones**, all fixed in the code below except three recorded in Task 7: the grid's active row drifting when the sub-steps row moved (Task 5); focus dropping to `<body>` from a rebuilt local node, a rebuilt runtime box and *show states* (Tasks 5 and 6); a closed diagram still laying out its local level, and laying it out for no width (Task 6); a copy's name groups ordered by appearance, 48 arcs for a copy of `fact(3)` where reach order draws 9 (Task 4, spec amendment 15); the local level with no non-visual equivalent (Task 6); and three tests green without testing their claim — a level switch asserted by attribute rather than computed `display`, following never made to scroll, and a clamp test whose scroll never moved (Tasks 5 and 6).
9. **The spec asks that the *arcs | chips* choice survive a reload (§11), and no test of the prototype reloaded.** One wrote the choice to storage and another parsed it back; nothing built a view from it. `tm-display-restore.test.ts` seeds a stored display before the app loads, as part 4a's `lambda-display-restore.test.ts` does (Task 6). Found by checking this plan against the spec, which also gained amendments 15 (name groups by reach, above) and 16 (the grid's index arithmetic is a browser test: it has no pure function).

**What replaying this plan found, before it was committed, and answered in it:**

1. **The rule table's resize test passed with its resize observer removed** — Task 3's sabotage of it did not fire in the replay, though it had in the prototype. Two things drew the rows in its place: the pane's other ways in to its draw (`render` from a copy's value run, `setLink` from the focus a panel's toggle moves), and, with those held, rows left over from the table's larger size that already covered the growth being checked. The test now holds the pane's three public callers of its draw while the shares change, and checks first that the rows were drawn for the smaller share; three runs clean passed and three with the observer removed failed, each at the growth. Its Task 5 form also said the table's scroll was clamped there; measured, nothing clamps, and it now says so.
2. **Two red steps could not show their own failure.** Task 2's `pnpm run typecheck` regenerates the bindings first, whose `cargo test` fails on the Rust red before `tsc` runs; Task 3's node and browser runs, joined by `&&`, never reached the browser half. Each is now a command of its own.
3. **The hand-written sabotage tables had drifted from what the sabotages fail** — Task 4's `tierOf` row said fifteen cases, and it fails 13 — so every *Fails* column is now written from the replay's own run.
4. **Two figures were from an earlier state of the code:** the name tier's arcs by appearance (33; measured, 48 — spec amendment 15), and grouping's cost (5.1, 20.9 and 71.5 ms, one call each; measured again for finding 6).

## File structure

**Created**

| File | Task | Responsibility |
|---|---|---|
| `web/tests/browser/tm-grid.test.ts` | 3 | the rule table as a grid, the tapes, and the panels' shares |
| `web/tests/browser/hidden.test.ts` | 3 | nothing `[hidden]` is on screen, across every panel and a copy of each view |
| `web/src/state-groups.ts` | 4 | the three grouping tiers, one group per row, edges between rows, the ⚠, sub-steps |
| `web/src/program-level.ts` | 4 | the program level's rows, *arcs*' arcs and lanes, *chips*' text |
| `web/tests/node/tm-machines.ts` | 4 | small machines shaped like compiled ones, for the diagram's pure modules |
| `web/tests/node/state-groups.test.ts`, `program-level.test.ts` | 4 | pure-module tests |
| `web/src/state-diagram.ts` | 5, 6 | `StateDiagram`: the panel's body — the program level, and from Task 6 the local level |
| `web/tests/browser/state-diagram.test.ts`, `tm-follow-clamp.test.ts` | 5 | the program level; a following table that grows |
| `web/src/local-level.ts` | 6 | the local level's nodes, columns, edges and labels |
| `web/tests/node/local-level.test.ts`, `web/tests/browser/state-diagram-local.test.ts` | 6 | the local level and the switch |
| `web/tests/browser/tm-display-restore.test.ts` | 6 | a stored display comes back on load, and not to a re-minted view |

**Modified:** `sourcemap.rs`, `tm.rs`, `tm/asm.rs`, `tm/asm_syntax.rs`, `viewmodel.rs`, `examples/frame_cost_probe.rs`, `examples/link_index_probe.rs`, `tests/sourcemap_coverage.rs`, `tests/span_wellformed.rs`, `tests/viewmodel_contract.rs` (core); `session.rs`, `tests/browser.rs` (wasm); and in `web/`: `tm-pane.ts`, `state-table.ts`, `tape.ts`, `view-header.ts`, `workspace.ts`, `pane-host.ts`, `pane-chrome.ts`, `main.ts`, `layout.ts`, `style.css`, plus the existing tests each task names.

---

### Task 1: The core keeps each state's instruction, the listing and the labels

**Files:**
- Modify: `crates/redextape-core/src/sourcemap.rs`
- Modify: `crates/redextape-core/src/tm.rs`
- Modify: `crates/redextape-core/src/tm/asm.rs`
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs`
- Modify: `crates/redextape-core/tests/sourcemap_coverage.rs`
- Modify: `crates/redextape-core/tests/span_wellformed.rs`

**Interfaces:**
- Produces: `redextape_core::tm::print_instr(&Instr) -> String` (one instruction as `print_asm` writes it, no indentation, no newline); `SourceMap::tm_instr(&self, name: &str) -> Option<usize>`; `SourceMap` fields `tm_name_to_instr: BTreeMap<String, usize>`, `tm_listing: Vec<String>`, `tm_labels: Vec<(String, usize)>`.
- `tm_instr` answers for the machine lowered at the width `SourceMap::build` was handed, and no other: state names depend on the width (`a_map_built_at_another_width_misses_the_states_only_this_width_names`).

**`name_to_instr` IS FILLED BEFORE THE `synthetic` SKIP**, not after it: a state built for a construct `defunc` minted has no owner to name, but it was still built for an instruction, and the program level groups it there. Sabotage 2 below holds it.

- [ ] **Step 1: Write the failing tests.** The tests' half is `sourcemap_coverage.rs`'s three new cases and `span_wellformed.rs`'s hand-built map, which now needs the struct-update form.

Apply the tests' half of the patch:

```diff apply=tests
diff --git a/crates/redextape-core/tests/sourcemap_coverage.rs b/crates/redextape-core/tests/sourcemap_coverage.rs
index fdd8bed..728714a 100644
--- a/crates/redextape-core/tests/sourcemap_coverage.rs
+++ b/crates/redextape-core/tests/sourcemap_coverage.rs
@@ -15,7 +15,9 @@
 
 use redextape_core::core::{Core, NodeId};
 use redextape_core::sourcemap::SourceMap;
-use redextape_core::tm::{Unary, lower_asm};
+use redextape_core::tm::{
+    EncodingKind, LowerError, MIN_FIELD_WIDTH, Program, Unary, defunc, lower_asm, lower_tm_mapped, print_asm,
+};
 
 mod common;
 use common::core_of;
@@ -636,3 +638,78 @@ fn node_id_allocation_order_is_pinned_for_every_mint_before_children_site() {
     assert_eq!(*while_id, 8, "Stmt::While's id");
     assert_eq!(*expr_lambda_id, 3, "Expr::Lambda (`|y| y + 1`)'s id");
 }
+
+/// The asm program `tm_half` lowers, reached by the OTHER road: `lower_asm` and `defunc` rather than their
+/// `_mapped` twins, retrying through `defunc` on `Unsupported` as `run_tm`'s own lowering does. The map's
+/// instruction indices are only worth checking against a program the map did not build.
+fn asm_of(core: &Core) -> Program {
+    match lower_asm(core) {
+        Ok(p) => p,
+        Err(LowerError::Unsupported { .. }) => lower_asm(&defunc(core).expect("defunc")).expect("lowers after defunc"),
+        Err(e) => panic!("the corpus lowers: {e:?}"),
+    }
+}
+
+/// `tm_instr` answers, for every state of the machine lowered at the map's own width, the instruction
+/// `lower_tm_mapped` billed it to — `None` exactly where the lowering billed none. Over both corpora, so
+/// the defunc branch is held too, at two encodings and two widths, since names depend on both.
+#[test]
+fn tm_instr_is_the_instruction_each_state_was_built_for() {
+    for src in BOTH_BACKENDS.iter().chain(HIGHER_ORDER) {
+        let core = core_of(src);
+        let prog = asm_of(&core);
+        for kind in [EncodingKind::Unary, EncodingKind::Binary] {
+            for width in [MIN_FIELD_WIDTH, 64] {
+                let enc = kind.at(width);
+                let map = SourceMap::build(&core, &*enc);
+                let (machine, origins) = lower_tm_mapped(&prog, &*enc).expect("the corpus lays out");
+                let mut billed = 0;
+                for (state, origin) in machine.states.iter().zip(&origins) {
+                    assert_eq!(map.tm_instr(&state.name), *origin, "{src:?} {kind:?} width {width}: {}", state.name);
+                    billed += usize::from(origin.is_some());
+                }
+                assert!(billed > 0, "{src:?}: a machine with no billed state pins nothing");
+            }
+        }
+    }
+}
+
+/// The listing is `print_asm`'s own instruction lines, in `prog.code` order, without their indentation; and
+/// the labels are the program's. A listing that dropped, reordered or re-spelled an instruction would put
+/// every state after it on the wrong line.
+#[test]
+fn the_listing_is_print_asm_line_for_line() {
+    for src in BOTH_BACKENDS.iter().chain(HIGHER_ORDER) {
+        let core = core_of(src);
+        let prog = asm_of(&core);
+        let map = SourceMap::build(&core, &Unary::default());
+        let printed = print_asm(&prog);
+        let lines: Vec<&str> = printed.lines().filter_map(|l| l.strip_prefix("    ")).collect();
+        assert_eq!(lines.len(), prog.code.len(), "{src:?}: one indented line per instruction");
+        assert_eq!(map.tm_listing, lines, "{src:?}");
+        assert_eq!(map.tm_labels, prog.labels, "{src:?}");
+    }
+}
+
+/// **NAMES DEPEND ON THE WIDTH, WHICH IS WHY `tm_instr` ANSWERS ONLY FOR THE WIDTH THE MAP WAS BUILT AT.**
+/// `let x = 40; x + 2` fits at width 64 under unary, and its width-64 machine has states whose names no
+/// width-4 machine has: a map built at width 4 resolves none of them, and one built at 64 resolves all.
+/// This is the premise that makes `compile` build its map at the width the run fitted (spec amendment 14).
+#[test]
+fn a_map_built_at_another_width_misses_the_states_only_this_width_names() {
+    let core = core_of("let x = 40; x + 2");
+    let prog = asm_of(&core);
+    let (machine, origins) = lower_tm_mapped(&prog, &*EncodingKind::Unary.at(64)).expect("lays out");
+    let narrow = SourceMap::build(&core, &*EncodingKind::Unary.at(MIN_FIELD_WIDTH));
+    let wide = SourceMap::build(&core, &*EncodingKind::Unary.at(64));
+    let billed: Vec<&str> =
+        machine.states.iter().zip(&origins).filter(|(_, o)| o.is_some()).map(|(s, _)| s.name.as_str()).collect();
+    let missed = billed.iter().filter(|n| narrow.tm_instr(n).is_none()).count();
+    assert!(missed > 0, "the width-64 machine must name states the width-4 one does not, or this pins nothing");
+    assert!(billed.iter().all(|n| wide.tm_instr(n).is_some()), "the map at the machine's own width resolves all");
+    assert!(
+        billed.iter().filter(|n| wide.tm_owner(n).is_some()).count()
+            > billed.iter().filter(|n| narrow.tm_owner(n).is_some()).count(),
+        "`tm_owner` has the same hole, and the same fix"
+    );
+}
diff --git a/crates/redextape-core/tests/span_wellformed.rs b/crates/redextape-core/tests/span_wellformed.rs
index 1d1befd..263bd5e 100644
--- a/crates/redextape-core/tests/span_wellformed.rs
+++ b/crates/redextape-core/tests/span_wellformed.rs
@@ -270,8 +270,7 @@ fn text_that_merely_looks_like_a_state_name_is_never_attributed() {
         })
         .collect();
     let tm_name_to_node = owner.iter().map(|(name, id)| ((*name).to_string(), *id)).collect();
-    let map =
-        SourceMap { node_to_lambda: BTreeMap::new(), node_to_tm, tm_name_to_node, node_to_source: BTreeMap::new() };
+    let map = SourceMap { node_to_tm, tm_name_to_node, ..SourceMap::default() };
 
     let (text, spans) = print_tm_mapped(&m);
     let attributed = attribute_tm_spans(&text, &map, &spans);
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'binary(sourcemap_coverage)'`
Expected: FAIL — the tests do not compile: `` error[E0599]: no method named `tm_instr` found for struct `SourceMap` in the current scope ``, `` error[E0609]: no field `tm_listing` on type `SourceMap` ``, `` error[E0609]: no field `tm_labels` on type `SourceMap` `` (`` error: could not compile `redextape-core` (test "sourcemap_coverage") due to 5 previous errors ``).

- [ ] **Step 3: Write the code.** The one-line printer and its differential test in `asm_syntax.rs`, then the map.

Apply the source half of the patch:

```diff apply=source
diff --git a/crates/redextape-core/src/sourcemap.rs b/crates/redextape-core/src/sourcemap.rs
index 257a4ff..b6b99ca 100644
--- a/crates/redextape-core/src/sourcemap.rs
+++ b/crates/redextape-core/src/sourcemap.rs
@@ -42,7 +42,7 @@ use crate::core::{Core, NodeId};
 use crate::lambda::{Path, lower_mapped};
 use crate::span::Span;
 use crate::tm::machine::StateId;
-use crate::tm::{Encoding, LowerError, defunc_mapped, lower_asm_mapped, lower_tm_mapped};
+use crate::tm::{Encoding, LowerError, defunc_mapped, lower_asm_mapped, lower_tm_mapped, print_instr};
 
 #[derive(Clone, Debug, Default, PartialEq, Eq)]
 pub struct SourceMap {
@@ -57,6 +57,16 @@ pub struct SourceMap {
     /// the field is `pub`, like the other two, so `map.node_to_source = other_spans` compiles and
     /// reintroduces the same mismatch a setter would.
     pub node_to_source: BTreeMap<NodeId, Span>,
+    /// The `prog.code` index each state was built for, keyed by the state's printed NAME as
+    /// `tm_name_to_node` is. A state with no instruction behind it — the shared return handler, the halt
+    /// and overflow states — is absent, so `tm_instr` answers `None` for it. Unlike `tm_name_to_node`,
+    /// states built for a construct `defunc` minted are present: they still belong to an instruction.
+    pub tm_name_to_instr: BTreeMap<String, usize>,
+    /// The asm program the TM half lowered, one line per `prog.code` index, each as `print_instr` writes
+    /// it. Empty when the TM half is. The indices `tm_name_to_instr` holds index this.
+    pub tm_listing: Vec<String>,
+    /// That program's labels, each with the `prog.code` index it precedes, in `prog.labels` order.
+    pub tm_labels: Vec<(String, usize)>,
 }
 
 impl SourceMap {
@@ -78,8 +88,16 @@ impl SourceMap {
     /// it. `build_is_total_on_a_core_too_deep_for_the_tm_lowering` pins it on an input past the depth at
     /// which the unguarded λ lowering used to abort.
     pub fn build(core: &Core, enc: &dyn Encoding) -> SourceMap {
-        let (node_to_tm, tm_name_to_node) = tm_half(core, enc);
-        SourceMap { node_to_lambda: lambda_half(core), node_to_tm, tm_name_to_node, node_to_source: BTreeMap::new() }
+        let tm = tm_half(core, enc);
+        SourceMap {
+            node_to_lambda: lambda_half(core),
+            node_to_tm: tm.node_to_tm,
+            tm_name_to_node: tm.name_to_node,
+            node_to_source: BTreeMap::new(),
+            tm_name_to_instr: tm.name_to_instr,
+            tm_listing: tm.listing,
+            tm_labels: tm.labels,
+        }
     }
 
     /// Both backend halves AND the source leg, from the one desugar that produced the `Core`.
@@ -121,6 +139,18 @@ impl SourceMap {
         self.tm_name_to_node.get(name).copied()
     }
 
+    /// The `prog.code` index — a line of `tm_listing` — whose gadgets built the state printed as `name`.
+    /// `None` for machine scaffolding and for any name this lowering never produced, with no fallback, as
+    /// `tm_owner`.
+    ///
+    /// **NAMES DEPEND ON THE FIELD WIDTH**, so this answers for the machine lowered at the width `build`
+    /// was handed and for no other: a wider machine has states no narrower one names. A caller asking
+    /// about a machine it ran builds the map at the width that run fitted.
+    #[must_use]
+    pub fn tm_instr(&self, name: &str) -> Option<usize> {
+        self.tm_name_to_instr.get(name).copied()
+    }
+
     /// The source text a Core node came from. `None` for a map built by `build`, which has no `Program`.
     #[must_use]
     pub fn source_span(&self, id: NodeId) -> Option<Span> {
@@ -140,7 +170,19 @@ fn lambda_half(core: &Core) -> BTreeMap<NodeId, Path> {
     out
 }
 
-fn tm_half(core: &Core, enc: &dyn Encoding) -> (BTreeMap<NodeId, Vec<StateId>>, BTreeMap<String, NodeId>) {
+/// Everything `tm_half` records about one lowering: the two owner indexes, the instruction index, and
+/// the listing and labels those instruction indices point into. `Default` is the empty half every
+/// refusal returns.
+#[derive(Default)]
+struct TmHalf {
+    node_to_tm: BTreeMap<NodeId, Vec<StateId>>,
+    name_to_node: BTreeMap<String, NodeId>,
+    name_to_instr: BTreeMap<String, usize>,
+    listing: Vec<String>,
+    labels: Vec<(String, usize)>,
+}
+
+fn tm_half(core: &Core, enc: &dyn Encoding) -> TmHalf {
     // `attribute.rs`'s `lower_mapped`, error discrimination included: try the program as first-order
     // Core FIRST, retry through `defunc` only on `Unsupported`, and give up on `TooDeep` immediately —
     // a looser `or_else` would swallow it and replay a deep Core through `defunc`'s own recursive
@@ -152,14 +194,14 @@ fn tm_half(core: &Core, enc: &dyn Encoding) -> (BTreeMap<NodeId, Vec<StateId>>,
         Ok((p, o)) => (p, o, BTreeSet::new()),
         Err(LowerError::Unsupported { .. }) => {
             let Ok((defunced, synthetic)) = defunc_mapped(core) else {
-                return (BTreeMap::new(), BTreeMap::new());
+                return TmHalf::default();
             };
             let Ok((p, o)) = lower_asm_mapped(&defunced) else {
-                return (BTreeMap::new(), BTreeMap::new());
+                return TmHalf::default();
             };
             (p, o, synthetic)
         }
-        Err(LowerError::TooDeep { .. }) => return (BTreeMap::new(), BTreeMap::new()),
+        Err(LowerError::TooDeep { .. }) => return TmHalf::default(),
     };
     // `None` is the state-ceiling refusal — one of `lower_tm_mapped`'s four layout refusals (`MAX_SLOTS`,
     // `MAX_FRAME_LOC`, `MAX_MUL_INSTRS`, `MAX_MACHINE_STATES`; see its doc). NONE of the four is
@@ -170,14 +212,20 @@ fn tm_half(core: &Core, enc: &dyn Encoding) -> (BTreeMap<NodeId, Vec<StateId>>,
     // as `TooDeep`/`Unsupported`-then-`defunc`-failure just above: a refused program built no machine,
     // so there is no state to own anything.
     let Some((machine, state_origins)) = lower_tm_mapped(&prog, enc) else {
-        return (BTreeMap::new(), BTreeMap::new());
+        return TmHalf::default();
     };
     let mut out: BTreeMap<NodeId, Vec<StateId>> = BTreeMap::new();
+    let mut name_to_instr: BTreeMap<String, usize> = BTreeMap::new();
     for state in 0..machine.states.len() {
         // `None` is machine scaffolding with no instruction behind it; skip rather than invent an owner.
         let Some(Some(code_index)) = state_origins.get(state) else {
             continue;
         };
+        // BEFORE THE `synthetic` SKIP BELOW: a state built for a construct `defunc` minted has no owner
+        // to name, but it was still built for this instruction.
+        if let Some(s) = machine.states.get(state) {
+            name_to_instr.entry(s.name.clone()).or_insert(*code_index);
+        }
         let Some(&node) = origins.get(*code_index) else {
             continue;
         };
@@ -211,7 +259,8 @@ fn tm_half(core: &Core, enc: &dyn Encoding) -> (BTreeMap<NodeId, Vec<StateId>>,
             }
         }
     }
-    (out, names)
+    let listing = prog.code.iter().map(print_instr).collect();
+    TmHalf { node_to_tm: out, name_to_node: names, name_to_instr, listing, labels: prog.labels }
 }
 
 #[cfg(test)]
diff --git a/crates/redextape-core/src/tm.rs b/crates/redextape-core/src/tm.rs
index 56b3add..d9148e7 100644
--- a/crates/redextape-core/src/tm.rs
+++ b/crates/redextape-core/src/tm.rs
@@ -28,7 +28,7 @@ pub mod universal;
 pub use asm::{
     AsmHeader, AsmOutcome, AsmRun, Caps, DEFAULT_CAPS, DecodeFailure, Instr, Program, Reg, decode_asm,
     decode_asm_reason, decode_asm_ty, decode_asm_ty_reason, print_asm, print_asm_doc, print_asm_mapped, print_asm_with,
-    print_asm_with_mapped, run_asm,
+    print_asm_with_mapped, print_instr, run_asm,
 };
 pub use asm_syntax::{AsmDocument, MnemonicDoc, instr_at, parse_asm, parse_asm_full, parse_asm_nav};
 pub use attribute::{Attribution, StepBucket, attribute, attribute_at, attribute_steps};
diff --git a/crates/redextape-core/src/tm/asm.rs b/crates/redextape-core/src/tm/asm.rs
index 89d5865..70cf4b1 100644
--- a/crates/redextape-core/src/tm/asm.rs
+++ b/crates/redextape-core/src/tm/asm.rs
@@ -227,9 +227,9 @@ fn operand_str(o: &Operand<'_>) -> String {
     }
 }
 
-/// The mnemonic and operands of one instruction. `print_asm_mapped` is the only place that joins
-/// them into text, so the listing's separator and its classification cannot disagree about where an
-/// operand starts.
+/// The mnemonic and operands of one instruction. `write_instr` is the only place that joins them into
+/// text, so the listing's separator and its classification cannot disagree about where an operand
+/// starts.
 pub(super) fn instr_parts(i: &Instr) -> (&'static str, Vec<Operand<'_>>) {
     match i {
         Instr::Li(rd, n) => ("li", vec![Operand::Reg(*rd), Operand::Imm(*n)]),
@@ -361,19 +361,7 @@ fn print_asm_with_inner(
         }
         cw.own_line(&mut out, &mut spans, AsmAnchor::Instr(idx), "    ");
         out.push_str("    ");
-        let (mnemonic, operands) = instr_parts(instr);
-        push_span(&mut out, &mut spans, mnemonic, C::Mnemonic);
-        for (i, operand) in operands.iter().enumerate() {
-            // The `\t` before the first operand and the space after each `,` are whitespace and belong
-            // to no span; the `,` itself is punctuation, classified as the TM printer already does.
-            if i == 0 {
-                out.push('\t');
-            } else {
-                push_span(&mut out, &mut spans, ",", C::Punct);
-                out.push(' ');
-            }
-            push_span(&mut out, &mut spans, &operand_str(operand), operand.class());
-        }
+        write_instr(&mut out, &mut spans, instr);
         cw.trailing(&mut out, &mut spans, AsmAnchor::Instr(idx));
         out.push('\n');
     }
@@ -385,6 +373,38 @@ fn print_asm_with_inner(
     (out, spans)
 }
 
+/// One instruction as `print_asm` writes it, without the line's indentation or its newline: `cmpeq\tr1, r2,
+/// r3`. The TM view's listing reads one of these per `prog.code` index.
+///
+/// **`print_asm` WRITES EVERY INSTRUCTION THROUGH `write_instr`, AND SO DOES THIS**, so this line and
+/// `print_asm`'s line for the same instruction cannot disagree about the separator after the mnemonic or
+/// between operands.
+#[must_use]
+pub fn print_instr(instr: &Instr) -> String {
+    let mut out = String::new();
+    write_instr(&mut out, &mut Vec::new(), instr);
+    out
+}
+
+/// Append one instruction to `out` and a class per span of it to `spans`: the mnemonic, a tab, then the
+/// operands separated by `, `. The one place an instruction becomes text.
+fn write_instr(out: &mut String, spans: &mut crate::analysis::Classified, instr: &Instr) {
+    use crate::analysis::TokenClass as C;
+    let (mnemonic, operands) = instr_parts(instr);
+    push_span(out, spans, mnemonic, C::Mnemonic);
+    for (i, operand) in operands.iter().enumerate() {
+        // The `\t` before the first operand and the space after each `,` are whitespace and belong
+        // to no span; the `,` itself is punctuation, classified as the TM printer already does.
+        if i == 0 {
+            out.push('\t');
+        } else {
+            push_span(out, spans, ",", C::Punct);
+            out.push(' ');
+        }
+        push_span(out, spans, &operand_str(operand), operand.class());
+    }
+}
+
 /// Render a document — program, header and comments — as `.asm` text.
 ///
 /// `None` when the document has no program, for the reason `print_tm_doc` states.
diff --git a/crates/redextape-core/src/tm/asm_syntax.rs b/crates/redextape-core/src/tm/asm_syntax.rs
index c508b71..8a00e6b 100644
--- a/crates/redextape-core/src/tm/asm_syntax.rs
+++ b/crates/redextape-core/src/tm/asm_syntax.rs
@@ -633,6 +633,19 @@ mod tests {
         }
     }
 
+    /// `print_instr` is `print_asm`'s line for the same instruction, indentation aside, for every variant —
+    /// what lets the TM view's listing stand in for the listing itself.
+    #[test]
+    fn print_instr_is_the_line_print_asm_writes() {
+        let prog = crate::tm::asm::Program { code: every_instr(), labels: Vec::new() };
+        let printed = crate::tm::asm::print_asm(&prog);
+        let lines: Vec<&str> = printed.lines().collect();
+        assert_eq!(lines.len(), prog.code.len(), "one line per instruction and no label lines");
+        for (instr, line) in prog.code.iter().zip(lines) {
+            assert_eq!(format!("    {}", crate::tm::asm::print_instr(instr)), line);
+        }
+    }
+
     #[test]
     fn the_table_has_one_row_per_mnemonic_and_no_duplicates() {
         let mut names: Vec<&str> = MNEMONICS.iter().map(|(m, _)| *m).collect();
```

- [ ] **Step 4: Run the tests.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(print_instr) | binary(sourcemap_coverage)'`
Expected: `15 tests run: 15 passed, 1288 skipped`.

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (the same `cargo nextest` run as Step 4):

| Sabotage | Fails |
|---|---|
| `sourcemap.rs`: `or_insert(*code_index)` in the `name_to_instr` block → `or_insert(*code_index + 1)` | `tm_instr_is_the_instruction_each_state_was_built_for` |
| `sourcemap.rs`: guard the `name_to_instr` insert with `&& !origins.get(*code_index).is_some_and(\|n\| synthetic.contains(n))` | `tm_instr_is_the_instruction_each_state_was_built_for` |
| `sourcemap.rs`: `prog.code.iter().map(print_instr)` → `prog.code.iter().map(\|i\| format!("{i:?}"))` | `the_listing_is_print_asm_line_for_line` |
| `asm.rs`: in `print_instr`, return `out.replacen(char::from(9), " ", 1)` | `print_instr_is_the_line_print_asm_writes`, `the_listing_is_print_asm_line_for_line` |
| `sourcemap.rs`: `labels: prog.labels` → `labels: Vec::new()` | `the_listing_is_print_asm_line_for_line` |
| `sourcemap_coverage.rs`: build `wide` at `MIN_FIELD_WIDTH` instead of 64 | `a_map_built_at_another_width_misses_the_states_only_this_width_names` |

- [ ] **Step 6: Run the gates.**

Run: `cargo fmt --check && systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy --workspace --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The core keeps each TM state's asm instruction, the listing and its labels

`SourceMap` records, beside each state's owner, the `prog.code` index its gadgets were built for
(`tm_instr`), the lowered program printed one instruction per line (`tm_listing`) and its labels
(`tm_labels`). `write_instr` becomes the one place an instruction turns into text: `print_asm` and the
new `print_instr` both go through it (spec amendment 8). The map answers by state name, and names
depend on the field width, so it answers for the width it was built at; a test pins that.
EOF
```

### Task 2: The session builds its map at the width the run fitted, and the wire carries each state's instruction

**Files:**
- Modify: `crates/redextape-core/examples/frame_cost_probe.rs`
- Modify: `crates/redextape-core/examples/link_index_probe.rs`
- Modify: `crates/redextape-core/src/viewmodel.rs`
- Modify: `crates/redextape-core/tests/viewmodel_contract.rs`
- Modify: `crates/redextape-wasm/src/session.rs`
- Modify: `crates/redextape-wasm/tests/browser.rs`
- Modify: `web/tests/browser/tm-pane-editor.test.ts`
- Modify: `web/tests/browser/tm-pane-follows-session.test.ts`
- Modify: `web/tests/node/protocol.test.ts`
- Modify: `web/tests/node/replies.test.ts`
- Modify: `web/tests/node/sessions.test.ts`
- Modify: `web/tests/node/state-table.test.ts`

**Interfaces:**
- Consumes: Task 1's `SourceMap::tm_instr`, `tm_listing`, `tm_labels`.
- Produces: `StateView.instr: Option<usize>` (`number | null` in `web/bindings/StateView.ts`); `TmProgram.listing: Vec<String>` and `TmProgram.labels: Vec<(String, usize)>` (`Array<string>`, `Array<[string, number]>`); `TmProgram::of(m: &Machine, width: usize, map: Option<&SourceMap>) -> TmProgram`. `build_tm_leg` and `tm_leg_at` take the map too; a scratch passes `None`.
- `Session::compile` runs `run_tm_described` first, over its own `desugar(&program)`, and then `SourceMap::build_from_program(&program, &*kind.at(width))` at the width the run fitted, or `MIN_FIELD_WIDTH` when no run started.

**THE RUN DESUGARS ON ITS OWN.** `build_from_program` is what pairs a `Core` with its spans, and it cannot be called until the width is known; `desugar` mints the same ids every time, and only the machine leaves the run, so the session's `core` is still the map's.

**THE REPLACED TEST WAS GREEN OVER THE HOLE.** `the_source_node_resolves_at_the_width_the_run_fitted` passed once one visited state resolved an owner; `every_billed_state_resolves_at_the_width_the_run_fitted` holds every state against `lower_tm_mapped` at the fitted width, over a program lowered by `lower_asm` rather than the `_mapped` twin the map uses — on both arms that yield a leg (`Ran`, and `HitCap` at a 10-step budget) and on a program that reaches the TM half only through `defunc`, where every owned state is billed and not every billed state is owned. The two probes mirroring `compile` (`frame_cost_probe.rs`, `link_index_probe.rs`) take the same order.

**A RUN THAT YIELDS NO LEG GETS A MAP AT `MIN_FIELD_WIDTH`**, the cheapest to lower: an `Overflow` decline fitted 64 for a machine nothing shows. **The map now costs a wider lowering**, measured natively in release, best of five, by a throwaway example timing `SourceMap::build_from_program` at width 4 and at the fitted width: `list60` at unary, fitted at 64, 11.75–11.97 ms at width 4 and 16.31–17.20 ms at 64; `list150` at binary, fitted at 8, 92.53–94.38 ms and 123.91–128.68 ms; `sample` and `fact(3)` under 0.5 ms at either width. Three runs of the appendix's map probe. Once per compile.

**THE BINDINGS ARE GENERATED, NOT TRACKED** (`scripts/build-web-bindings.sh`, which `pnpm run typecheck` runs), so the web fixtures that build a `StateView` or `TmProgram` by hand change in this commit: `instr: null`, `listing: []`, `labels: []`.

- [ ] **Step 1: Write the failing tests.** The tests' half is the core contract test (a 3-argument `TmProgram::of`, and coverage at the fitted width), the wasm browser test's marshalling of the new fields, and the web fixtures.

Apply the tests' half of the patch:

```diff apply=tests
diff --git a/crates/redextape-core/tests/viewmodel_contract.rs b/crates/redextape-core/tests/viewmodel_contract.rs
index a3684f6..5ce71fa 100644
--- a/crates/redextape-core/tests/viewmodel_contract.rs
+++ b/crates/redextape-core/tests/viewmodel_contract.rs
@@ -226,7 +226,7 @@ fn the_window_costs_the_same_regardless_of_how_large_the_tape_has_grown() {
 #[test]
 fn tm_program_projects_the_machine_and_agrees_with_its_alphabet() {
     let (machine, _) = tm_fixture("let x = 40; x + 2");
-    let p = TmProgram::of(&machine, 64);
+    let p = TmProgram::of(&machine, 64, None);
     assert_eq!(p.states.len(), machine.states.len());
     assert_eq!(p.tapes, machine.tapes);
     assert_eq!(p.width, 64);
@@ -285,7 +285,7 @@ fn a_tape_can_be_sliced_in_the_same_coordinates_the_window_reports() {
 #[test]
 fn tm_program_reports_the_machines_start_state() {
     let (machine, _) = tm_fixture("let x = 40; x + 2");
-    let p = TmProgram::of(&machine, 64);
+    let p = TmProgram::of(&machine, 64, None);
     assert_eq!(p.start, machine.start);
     assert!(p.states.get(p.start as usize).is_some(), "the entry state must name a state that exists");
 }
@@ -369,7 +369,7 @@ fn every_view_model_round_trips_through_json() {
     assert_eq!(ls, back);
 
     let (machine, init) = tm_fixture("let x = 40; x + 2");
-    let p = TmProgram::of(&machine, 64);
+    let p = TmProgram::of(&machine, 64, None);
     let back: TmProgram = serde_json::from_str(&serde_json::to_string(&p).expect("serialize")).expect("deserialize");
     assert_eq!(p, back);
 
@@ -500,24 +500,29 @@ fn rule_names_the_transition_the_next_step_actually_takes() {
 
 #[test]
 fn link_index_resolves_tm_owners_by_name_at_the_width_the_run_fitted() {
-    // THE TRAP THIS PINS. `SourceMap::build_from_program` lowers at `MIN_FIELD_WIDTH` purely to record
-    // ownership; `run_tm_described` re-lowers and auto-fits a possibly different width. `node_to_tm`'s
-    // StateIds therefore index a DIFFERENT machine from `TmProgram.states`. Only names agree, so
-    // `tm_owner` must be built by name — the same resolution `TmState::window` performs per step.
+    // THE TRAP THIS PINS. `run_tm_described` auto-fits the width, and state NAMES depend on the width: a
+    // map built at any other width resolves only the names both machines happen to share. So the map is
+    // built at the width the run fitted, as `compile` builds it, and `tm_owner` is built by name — the
+    // same resolution `TmState::window` performs per step. At width 4 this sample resolved 77 of its 110
+    // billed states under binary; at the fitted width every one resolves.
     let src = "let x = 40; x + 2";
     let (program, diags) = redextape_core::parser::parse(src);
     let program = program.expect("the sample must parse");
     assert!(diags.is_empty(), "diagnostics: {diags:?}");
     let ty = redextape_core::typeck::result_type(&program).expect("the sample must type");
     let kind = redextape_core::tm::EncodingKind::Binary;
-    let enc = kind.at(redextape_core::tm::MIN_FIELD_WIDTH);
-    let (core, map) = SourceMap::build_from_program(&program, &*enc);
-
-    let described = redextape_core::tm::run_tm_described(&core, kind, ty, redextape_core::tm::TM_DEFAULT_CAPS)
-        .expect("the sample must lower");
+    let described = redextape_core::tm::run_tm_described(
+        &redextape_core::desugar::desugar(&program),
+        kind,
+        ty,
+        redextape_core::tm::TM_DEFAULT_CAPS,
+    )
+    .expect("the sample must lower");
     let width = described.header.width;
+    assert!(width > redextape_core::tm::MIN_FIELD_WIDTH, "the run must widen, or the trap is not set");
+    let (core, map) = SourceMap::build_from_program(&program, &*kind.at(width));
     let machine = std::rc::Rc::new(described.machine);
-    let tm_program = TmProgram::of(&machine, width);
+    let tm_program = TmProgram::of(&machine, width, Some(&map));
 
     let term = redextape_core::lambda::lower(&core).expect("the sample must lower to lambda");
     let index = LinkIndex::build(Some(&term), Some(&tm_program), &map, 65_536, MAX_TERM_DEPTH);
@@ -531,7 +536,11 @@ fn link_index_resolves_tm_owners_by_name_at_the_width_the_run_fitted() {
             owned += 1;
         }
     }
-    assert!(owned > 0, "the sample must have at least one owned state, or this test proves nothing");
+    // A first-order program has no `defunc`-minted construct, so every state its run bills to an
+    // instruction has an owner. `owned > 0` alone passed with a third of them missing.
+    let billed = tm_program.states.iter().filter(|s| s.instr.is_some()).count();
+    assert!(billed > 100, "the sample bills {billed} states; it must bill enough to pin anything");
+    assert_eq!(owned, billed, "every billed state of the sample resolves an owner");
 
     // The lambda leg. The sample's every source-mapped node carries a path, and the term prints well
     // inside the budget, so every one of them must have a span.
@@ -576,7 +585,7 @@ fn link_index_is_total_when_only_the_lambda_leg_is_present() {
 #[test]
 fn link_index_is_total_when_only_the_tm_leg_is_present() {
     let (_, _, map, machine, _) = tm_fixture_with_map("let x = 40; x + 2");
-    let tm_program = TmProgram::of(&machine, 64);
+    let tm_program = TmProgram::of(&machine, 64, None);
     let index = LinkIndex::build(None, Some(&tm_program), &map, 65_536, MAX_TERM_DEPTH);
     assert_eq!(index.lambda_text, "", "no term means no lambda text, not one fabricated to match");
     assert!(index.lambda_nodes.is_empty());
diff --git a/crates/redextape-wasm/tests/browser.rs b/crates/redextape-wasm/tests/browser.rs
index f4789ee..7d9c96a 100644
--- a/crates/redextape-wasm/tests/browser.rs
+++ b/crates/redextape-wasm/tests/browser.rs
@@ -197,6 +197,16 @@ fn compile_step_and_read_both_legs() {
     assert_eq!(num(&program, "start"), 2.0);
     let states: Array = get(&program, "states").unchecked_into();
     assert_eq!(states.length(), 123, "the whole machine crosses once, and all of it arrives");
+    // Each state's instruction crosses as a number or as `null`, never `undefined`: 121 of the 123 are
+    // built for one of the sample's five instructions, and the halt and overflow states for none.
+    let instrs: Vec<JsValue> = states.iter().map(|s| get(&s, "instr")).collect();
+    assert!(instrs.iter().all(|i| i.is_null() || i.as_f64().is_some()), "`instr` is a number or null");
+    assert_eq!(instrs.iter().filter(|i| i.as_f64().is_some()).count(), 121, "every billed state carries it");
+    let listing: Array = get(&program, "listing").unchecked_into();
+    assert_eq!(listing.length(), 5, "one line per instruction");
+    assert_eq!(listing.get(0).as_string().as_deref(), Some("li\tr0, #40"), "`print_asm`'s text, tab and all");
+    let labels: Array = get(&program, "labels").unchecked_into();
+    assert_eq!(labels.length(), 0, "the sample has no label, and an empty list still crosses as an array");
 
     let mut delta = 0;
     while call(&session, "stepTm", &[]) == JsValue::TRUE {
diff --git a/web/tests/browser/tm-pane-editor.test.ts b/web/tests/browser/tm-pane-editor.test.ts
index d39b758..c24d175 100644
--- a/web/tests/browser/tm-pane-editor.test.ts
+++ b/web/tests/browser/tm-pane-editor.test.ts
@@ -47,11 +47,13 @@ const mountPane = (): { pane: TmPane; host: HTMLElement } => {
  * `PROGRAM` fixture — one state, one rule, one tape.
  */
 const PROGRAM: TmProgram = {
-  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }] }],
+  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }], instr: null }],
   alphabet: ['a', 'b'],
   tapes: 1,
   width: 8,
   start: 0,
+  listing: [],
+  labels: [],
 }
 
 /** One configuration over `PROGRAM`'s single tape, modelled on `tests/node/tape.test.ts`'s `state` helper. */
diff --git a/web/tests/browser/tm-pane-follows-session.test.ts b/web/tests/browser/tm-pane-follows-session.test.ts
index 497532e..8262a1c 100644
--- a/web/tests/browser/tm-pane-follows-session.test.ts
+++ b/web/tests/browser/tm-pane-follows-session.test.ts
@@ -40,11 +40,13 @@ import { SHELL, until } from './harness'
  */
 
 const PROGRAM: TmProgram = {
-  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }] }],
+  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }], instr: null }],
   alphabet: ['a', 'b'],
   tapes: 1,
   width: 8,
   start: 0,
+  listing: [],
+  labels: [],
 }
 
 const REDUCED: TmScratchStatus = {
diff --git a/web/tests/node/protocol.test.ts b/web/tests/node/protocol.test.ts
index f2176de..25f5366 100644
--- a/web/tests/node/protocol.test.ts
+++ b/web/tests/node/protocol.test.ts
@@ -123,11 +123,12 @@ function programOf(n: number): TmProgram {
     name: `q${i}`,
     accept: false,
     rules: [] as TmProgram['states'][number]['rules'],
+    instr: null,
   }))
   for (let i = 0; i < n; i++) {
     states[i % 10]?.rules.push({ read: [null], write: [null], moves: ['S'], next: 0 })
   }
-  return { states, alphabet: ['_'], tapes: 1, width: 4, start: 0 }
+  return { states, alphabet: ['_'], tapes: 1, width: 4, start: 0, listing: [], labels: [] }
 }
 
 describe('the fork cap', () => {
diff --git a/web/tests/node/replies.test.ts b/web/tests/node/replies.test.ts
index f8c6336..c54eac0 100644
--- a/web/tests/node/replies.test.ts
+++ b/web/tests/node/replies.test.ts
@@ -87,11 +87,13 @@ function sourceEntry(): SessionEntry {
 
 /** A machine small enough to compare by identity, with a state so a `StateIndex` over it is non-empty. */
 const PROGRAM: TmProgram = {
-  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }] }],
+  states: [{ name: 'pc0', accept: false, rules: [{ read: ['a'], write: ['b'], moves: ['R'], next: 0 }], instr: null }],
   alphabet: ['a', 'b'],
   tapes: 1,
   width: 8,
   start: 0,
+  listing: [],
+  labels: [],
 }
 
 const compiled = (tmProgram: TmProgram | null, tapeNames: string[]): RunReply => ({
@@ -188,7 +190,7 @@ describe('a session retains its last compiled machine', () => {
   it('holds the machine from the latest compile, not the first', () => {
     const entry = sourceEntry()
     const { replies } = driver(entry)
-    const second: TmProgram = { ...PROGRAM, states: [{ name: 'pc1', accept: true, rules: [] }] }
+    const second: TmProgram = { ...PROGRAM, states: [{ name: 'pc1', accept: true, rules: [], instr: null }] }
 
     replies.onReply(SOURCE, compiled(PROGRAM, ['TAPE']))
     replies.onReply(SOURCE, compiled(second, ['REG']))
diff --git a/web/tests/node/sessions.test.ts b/web/tests/node/sessions.test.ts
index d0b4a6c..58498b3 100644
--- a/web/tests/node/sessions.test.ts
+++ b/web/tests/node/sessions.test.ts
@@ -492,11 +492,13 @@ describe('PaneSlot', () => {
     const reg = new SessionRegistry()
     const source = entry('source', { label: 'source', tm: [0] })
     const program: TmProgram = {
-      states: [{ name: 'pc0', accept: false, rules: [] }],
+      states: [{ name: 'pc0', accept: false, rules: [], instr: null }],
       alphabet: ['a'],
       tapes: 1,
       width: 8,
       start: 0,
+      listing: [],
+      labels: [],
     }
     source.tmProgram = { program, tapeNames: ['TAPE'], tmText: 'tapes 1\nstart pc0\nstate pc0:\n' }
     reg.add(source)
diff --git a/web/tests/node/state-table.test.ts b/web/tests/node/state-table.test.ts
index 1c3a1db..b666fe5 100644
--- a/web/tests/node/state-table.test.ts
+++ b/web/tests/node/state-table.test.ts
@@ -21,6 +21,7 @@ const st = (name: string, rules: number, accept = false): StateView => ({
   name,
   accept,
   rules: Array.from({ length: rules }, (_, i) => rule(i)),
+  instr: null,
 })
 
 // 3 rules, then 0 (a `halt`-shaped state), then 2, then 1 => rows 0..9
@@ -34,6 +35,8 @@ const program = (): TmProgram => ({
   tapes: 5,
   width: 64,
   start: 0,
+  listing: [],
+  labels: [],
 })
 
 const frame = (over: Partial<TmState> = {}): TmState => ({
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --all-features --no-fail-fast -E 'binary(viewmodel_contract)'`
Expected: FAIL — the tests do not compile: `error[E0061]: this function takes 2 arguments but 3 arguments were supplied`, `` error[E0609]: no field `instr` on type `&&StateView` `` (`` error: could not compile `redextape-core` (test "viewmodel_contract") due to 6 previous errors ``).

Run: `cd web && pnpm exec tsc --noEmit`
Expected: FAIL — 8 errors in 6 test files: 6 × `TS2353: Object literal may only specify known properties, and 'instr' does not exist in type 'StateView'.`; 2 × `TS2353: Object literal may only specify known properties, and 'listing' does not exist in type 'TmProgram'.`.

Not `pnpm run typecheck`: its first step regenerates the bindings with `cargo test`, which compiles the core's tests and fails on the Rust red above before `tsc` runs. `tsc` alone checks the fixtures against the bindings Task 1's commit generated.

- [ ] **Step 3: Write the code.** The wire types, the session, and the two probes that mirror `compile`.

Apply the source half of the patch:

```diff apply=source
diff --git a/crates/redextape-core/examples/frame_cost_probe.rs b/crates/redextape-core/examples/frame_cost_probe.rs
index 6d9e7f2..48ea859 100644
--- a/crates/redextape-core/examples/frame_cost_probe.rs
+++ b/crates/redextape-core/examples/frame_cost_probe.rs
@@ -181,20 +181,19 @@ fn compile(src: &str, kind: EncodingKind) -> Option<Compiled> {
     }
     let ty = typeck::result_type(&program).ok()?;
 
-    let enc = kind.at(tm::MIN_FIELD_WIDTH);
-    let (core, map) = {
-        let (core, spans) = desugar_mapped(&program);
-        let mut map = SourceMap::build(&core, &*enc);
-        map.node_to_source = spans.into_iter().collect();
-        (core, map)
-    };
+    // The session's order: run first, then build the map at the width the run fitted, since the map keys
+    // on state names and names depend on the width (`Session::compile`'s doc).
+    let (core, spans) = desugar_mapped(&program);
+    let described = tm::run_tm_described(&core, kind, ty, tm::TM_DEFAULT_CAPS);
+    let width = described.as_ref().map_or(tm::MIN_FIELD_WIDTH, |d| d.header.width);
+    let mut map = SourceMap::build(&core, &*kind.at(width));
+    map.node_to_source = spans.into_iter().collect();
 
     let (lambda, lambda_decline) = match lambda::lower(&core) {
         Ok(t) => (Some(LambdaCursor::new(&t, MAX_REDUCTION_STEPS)), None),
         Err(e) => (None, Some(format!("{e:?}"))),
     };
 
-    let described = tm::run_tm_described(&core, kind, ty, tm::TM_DEFAULT_CAPS);
     let tm_total_steps = described.as_ref().ok().map(|d| d.steps);
     let (tm, tm_decline) = match described {
         Err(e) => (None, Some(format!("{e:?}"))),
@@ -203,7 +202,7 @@ fn compile(src: &str, kind: EncodingKind) -> Option<Compiled> {
                 let init = d.header.init(d.machine.tapes);
                 let width = d.header.width;
                 let machine = Rc::new(d.machine);
-                let program = TmProgram::of(&machine, width);
+                let program = TmProgram::of(&machine, width, Some(&map));
                 let cursor = TmCursor::new(Rc::clone(&machine), &init, tm::TM_DEFAULT_CAPS);
                 (Some((program, cursor)), None)
             }
diff --git a/crates/redextape-core/examples/link_index_probe.rs b/crates/redextape-core/examples/link_index_probe.rs
index b03f727..814892c 100644
--- a/crates/redextape-core/examples/link_index_probe.rs
+++ b/crates/redextape-core/examples/link_index_probe.rs
@@ -160,15 +160,16 @@ fn build(name: &str, src: &str) -> Option<Row> {
     }
     let ty = typeck::result_type(&program).ok()?;
     let kind = EncodingKind::Binary;
-    let enc = kind.at(tm::MIN_FIELD_WIDTH);
-    let (core, map) = SourceMap::build_from_program(&program, &*enc);
+    // The session's order: run first, then build the map at the width the run fitted, since the map keys
+    // on state names and names depend on the width (`Session::compile`'s doc). `own_st` read low while the
+    // map was built at `MIN_FIELD_WIDTH`.
+    let described = tm::run_tm_described(&redextape_core::desugar::desugar(&program), kind, ty, tm::TM_DEFAULT_CAPS);
+    let width = described.as_ref().map_or(tm::MIN_FIELD_WIDTH, |d| d.header.width);
+    let (core, map) = SourceMap::build_from_program(&program, &*kind.at(width));
 
-    let tm_program = match tm::run_tm_described(&core, kind, ty, tm::TM_DEFAULT_CAPS) {
+    let tm_program = match described {
         Ok(d) => match d.run {
-            TmRun::Ran { .. } | TmRun::HitCap => {
-                let width = d.header.width;
-                Some(TmProgram::of(&Rc::new(d.machine), width))
-            }
+            TmRun::Ran { .. } | TmRun::HitCap => Some(TmProgram::of(&Rc::new(d.machine), width, Some(&map))),
             _ => None,
         },
         Err(_) => None,
diff --git a/crates/redextape-core/src/viewmodel.rs b/crates/redextape-core/src/viewmodel.rs
index fe6fbf3..7fb49ab 100644
--- a/crates/redextape-core/src/viewmodel.rs
+++ b/crates/redextape-core/src/viewmodel.rs
@@ -137,6 +137,10 @@ pub struct StateView {
     pub name: String,
     pub accept: bool,
     pub rules: Vec<RuleView>,
+    /// The line of `TmProgram.listing` whose instruction built this state — `SourceMap::tm_instr` — or
+    /// `None` for machine scaffolding, and for every state of a machine with no map behind it: a copy, a
+    /// reduced file.
+    pub instr: Option<usize>,
 }
 
 /// One transition, projected for a renderer. `read`/`write` carry one entry PER TAPE and `None` is a
@@ -180,6 +184,11 @@ pub struct TmProgram {
     pub width: usize,
     /// The state the machine enters at step 0, as an index into `states`.
     pub start: StateId,
+    /// The asm program this machine was lowered from, one instruction per line as `print_instr` writes
+    /// it — `SourceMap::tm_listing`. Empty for a machine with no map behind it.
+    pub listing: Vec<String>,
+    /// That program's labels, each with the `listing` line it precedes — `SourceMap::tm_labels`.
+    pub labels: Vec<(String, usize)>,
 }
 
 /// `source_node` IS THE CORE NODE THAT PRODUCED THE CURRENT STATE, resolved through the `SourceMap`
@@ -308,14 +317,19 @@ impl TmProgram {
     /// Project `m` once (see the module doc: this is built per compile, never per step). `width` is
     /// the caller's field-width choice for the encoding that produced `m` — a fact about the encoding,
     /// not something a `Machine` carries, so it comes in as a parameter rather than a re-derivation.
+    ///
+    /// `map` supplies each state's instruction, the listing and the labels, and `None` leaves them empty:
+    /// a copy or a reduced file has no program behind it. **A MAP MUST HAVE BEEN BUILT AT `width`**, since
+    /// it answers by state name and names depend on the width (`SourceMap::tm_instr`).
     #[must_use]
-    pub fn of(m: &Machine, width: usize) -> TmProgram {
+    pub fn of(m: &Machine, width: usize, map: Option<&SourceMap>) -> TmProgram {
         let states = m
             .states
             .iter()
             .map(|s| StateView {
                 name: s.name.clone(),
                 accept: s.accept,
+                instr: map.and_then(|m| m.tm_instr(&s.name)),
                 rules: s
                     .rules
                     .iter()
@@ -331,7 +345,15 @@ impl TmProgram {
         // `m.alphabet()`, NOT a re-derivation: `Machine::alphabet` already walks every rule's read and
         // write symbols into a sorted set, and duplicating that here is exactly the second copy this
         // codebase's conventions treat as a defect (see `sourcemap.rs`'s module doc on the same point).
-        TmProgram { states, alphabet: m.alphabet(), tapes: m.tapes, width, start: m.start }
+        TmProgram {
+            states,
+            alphabet: m.alphabet(),
+            tapes: m.tapes,
+            width,
+            start: m.start,
+            listing: map.map(|m| m.tm_listing.clone()).unwrap_or_default(),
+            labels: map.map(|m| m.tm_labels.clone()).unwrap_or_default(),
+        }
     }
 }
 
@@ -448,12 +470,12 @@ pub struct LinkIndex {
     pub source_nodes: Vec<(Span, NodeId)>,
     /// `tm_owner[state_id]` is the Core node that produced that state, or `-1`.
     ///
-    /// **BUILT BY NAME, NOT BY FLATTENING `node_to_tm`.** `SourceMap::build_from_program` lowers at
-    /// `MIN_FIELD_WIDTH` only to record ownership, and `run_tm_described` re-lowers with its own
-    /// auto-fitted width — so `node_to_tm`'s `StateId`s index a different machine from the one
-    /// `TmProgram.states` indexes. The invariant that survives the width change is that `lower_tm`
-    /// derives state NAMES from the instruction stream, so the two lowerings agree on names. This is
-    /// the same resolution `TmState::window` performs per step, hoisted to once per compile.
+    /// **BUILT BY NAME, NOT BY FLATTENING `node_to_tm`.** `node_to_tm`'s `StateId`s index the machine the
+    /// map itself lowered, and nothing checks that it is the machine `TmProgram.states` projects; a
+    /// state's printed name is the association the map recorded where both were in hand. This is the
+    /// same resolution `TmState::window` performs per step, hoisted to once per compile. **NAMES AGREE AT
+    /// ONE WIDTH ONLY** — a wider machine has states no narrower one names — so a session builds its map
+    /// at the width its run fitted (`SourceMap::tm_instr`'s doc).
     ///
     /// `-1` RATHER THAN `Option<NodeId>` because this crosses to JavaScript as an `Int32Array`, and a
     /// dense typed array is the difference between 143 KB and 26,484 objects for `list60`.
@@ -560,14 +582,16 @@ mod tests {
             states: vec![
                 // `s0`'s "owner" is `NodeId::MAX` (`u32::MAX`) — unrepresentable in `i32`, and the one
                 // value whose wraparound lands exactly on the `-1` sentinel.
-                StateView { name: "s0".to_string(), accept: false, rules: Vec::new() },
+                StateView { name: "s0".to_string(), accept: false, rules: Vec::new(), instr: None },
                 // `s1` has a real absence: no entry in `tm_name_to_node` at all.
-                StateView { name: "s1".to_string(), accept: true, rules: Vec::new() },
+                StateView { name: "s1".to_string(), accept: true, rules: Vec::new(), instr: None },
             ],
             alphabet: Vec::new(),
             tapes: 1,
             width: 1,
             start: 0,
+            listing: Vec::new(),
+            labels: Vec::new(),
         };
         let map = SourceMap {
             tm_name_to_node: [("s0".to_string(), NodeId::MAX)].into_iter().collect(),
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index db1cff2..f1ee3bb 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -395,9 +395,17 @@ pub struct Session {
 /// spell. Widening would put decision 6's invented width and invented tapes one accidental `None`
 /// away from a compiled program. The shared part is factored into `tm_leg_at` instead, which knows
 /// nothing about headers.
-fn build_tm_leg(header: &tm::TmHeader, machine: Rc<Machine>, caps: tm::TmCaps) -> (TmProgram, TmCursor<Rc<Machine>>) {
+///
+/// `map` IS THE SESSION'S OWN, BUILT AT `header.width` — `compile`'s doc says why it has to be — and gives
+/// the projection each state's instruction and the listing. A scratch has none.
+fn build_tm_leg(
+    header: &tm::TmHeader,
+    machine: Rc<Machine>,
+    caps: tm::TmCaps,
+    map: Option<&SourceMap>,
+) -> (TmProgram, TmCursor<Rc<Machine>>) {
     let init = header.init(machine.tapes);
-    tm_leg_at(machine, header.width, &init, caps)
+    tm_leg_at(machine, header.width, &init, caps, map)
 }
 
 /// Project a machine and open a cursor on it at an explicit `width` and initial configuration — the
@@ -414,11 +422,12 @@ fn tm_leg_at(
     width: usize,
     init: &[Vec<Symbol>],
     caps: tm::TmCaps,
+    map: Option<&SourceMap>,
 ) -> (TmProgram, TmCursor<Rc<Machine>>) {
     // `TmProgram` is projected ONCE, here, and cached — never per step. The `map` demo is 3,203 states
     // over 344,999 steps; re-projecting per `tmState` is the cost the `TmProgram`/`TmState` split
     // exists to avoid.
-    let program = TmProgram::of(&machine, width);
+    let program = TmProgram::of(&machine, width, map);
     let cursor = TmCursor::new(machine, init, caps);
     (program, cursor)
 }
@@ -581,14 +590,14 @@ fn decoded_of(run: Result<redextape_core::value::Value, redextape_core::interp::
 impl Session {
     /// Parse, typecheck, and build whichever legs the backends accept.
     ///
-    /// THE WIDTH PASSED TO `build_from_program` IS NOT THE WIDTH THE MACHINE RUNS AT, and that is
-    /// deliberate rather than sloppy. `SourceMap::build_from_program` needs an `Encoding` only to lower
-    /// the Core far enough to record which states belong to which node, and `run_tm_described` then
-    /// auto-fits its own width by re-lowering from `MIN_FIELD_WIDTH` upward. The map keys on state
-    /// NAMES, which `lower_tm` derives from the instruction stream rather than the field width, so the
-    /// two agree on names regardless of which width either used — `tm_state_resolves_its_source_node_through_the_map`
-    /// in core pins that the names line up at all, and `the_source_node_resolves_at_the_width_the_run_fitted`
-    /// below pins that they still line up after the auto-fit has moved the width.
+    /// **THE MACHINE RUNS FIRST, AND THE MAP IS BUILT AT THE WIDTH IT FITTED.** The map keys the TM half
+    /// on state NAMES, and names depend on the field width: the sample, `let x = 40; x + 2`, fits at 64
+    /// under unary, and 47 of its 123 states have names no width-4 machine has. The map was once built at
+    /// `MIN_FIELD_WIDTH` before the run, and `tm_owner` then resolved 74 of the 121 states the run bills
+    /// to an instruction. `every_billed_state_resolves_at_the_width_the_run_fitted` below holds all of
+    /// them. The run desugars the program on its own, since the map's constructor is what pairs a `Core`
+    /// with its spans and it cannot be called until the width is known; `desugar` mints the same ids
+    /// every time, and only the machine leaves the run.
     pub fn compile(src: &str, kind: EncodingKind) -> Compiled {
         Session::compile_with_caps(src, kind, tm::TM_DEFAULT_CAPS)
     }
@@ -628,8 +637,15 @@ impl Session {
             }
         };
 
-        let enc = kind.at(tm::MIN_FIELD_WIDTH);
-        let (core, map) = SourceMap::build_from_program(&program, &*enc);
+        // A run that yields a leg — `Ran` or `HitCap` — fitted a width, and that is the width the map must be built
+        // at. Any other leaves no machine for the map to describe, so the narrowest width, the cheapest to lower, is
+        // as good as any: an `Overflow` decline fitted 64 for a machine nothing will show.
+        let described = tm::run_tm_described(&redextape_core::desugar::desugar(&program), kind, ty.clone(), caps);
+        let width = match &described {
+            Ok(d) if matches!(d.run, TmRun::Ran { .. } | TmRun::HitCap) => d.header.width,
+            _ => tm::MIN_FIELD_WIDTH,
+        };
+        let (core, map) = SourceMap::build_from_program(&program, &*kind.at(width));
 
         let (lambda, initial_lambda) = match lambda::lower(&core) {
             Ok(t) => (Ok(LambdaLeg::new(&t, lambda::MAX_REDUCTION_STEPS)), Some(t)),
@@ -644,7 +660,6 @@ impl Session {
         // reaching `MAX_FIELD_WIDTH` and still overflowing returns `Ok` with `run: TmRun::Overflow` and
         // a machine attached — so the decline for it is read off `d.run`, which is why this is two
         // matches and not one.
-        let described = tm::run_tm_described(&core, kind, ty.clone(), caps);
         // Read off the `Ok` BEFORE the match consumes it, so every run that STARTED reports its own
         // count — including `Overflow` and `TooLarge` arriving inside an `Ok`, which decline the leg
         // and still ran. See the field's doc for where a declined leg's length is withheld.
@@ -667,11 +682,11 @@ impl Session {
                 // a run that spent its budget is resumable through `raise_tm_cap`, so flattening it
                 // into a decline would throw away a session the user can still drive.
                 TmRun::Ran { tapes } => {
-                    let (p, c) = build_tm_leg(&d.header, Rc::new(d.machine), caps);
+                    let (p, c) = build_tm_leg(&d.header, Rc::new(d.machine), caps, Some(&map));
                     Ok(((p, c, d.header), Some(tapes)))
                 }
                 TmRun::HitCap => {
-                    let (p, c) = build_tm_leg(&d.header, Rc::new(d.machine), caps);
+                    let (p, c) = build_tm_leg(&d.header, Rc::new(d.machine), caps, Some(&map));
                     Ok(((p, c, d.header), None))
                 }
             },
@@ -1392,14 +1407,14 @@ fn tm_scratch_with_caps(src: &str, caps: tm::TmCaps) -> TmScratched {
             // The IDENTICAL function `compile` builds its leg with, not a copy of it — which is what
             // makes "a headered scratch matches the `Session` path" a property of one code path rather
             // than an agreement between two.
-            Some(h) => build_tm_leg(h, m, caps),
+            Some(h) => build_tm_leg(h, m, caps, None),
             // BLANK TAPES, SPELLED AS AN EMPTY `init` RATHER THAN AS `vec![Vec::new(); m.tapes]`.
             // `TmCursor::new` reads `init.get(i)` and falls back to an empty slice per tape, so the two
             // are the same configuration — and it is also exactly what `TmHeader::init`
             // (`tm/header.rs`) yields for a header carrying no `tape` directives, which is the sense in
             // which decision 6's default is not a new kind of configuration, only a new way to reach
             // one.
-            None => tm_leg_at(m, tm::MIN_FIELD_WIDTH, &[], caps),
+            None => tm_leg_at(m, tm::MIN_FIELD_WIDTH, &[], caps, None),
         };
         TmScratch { program, cursor, header }
     };
@@ -1603,6 +1618,17 @@ impl TmValueRun {
 #[cfg(test)]
 mod tests {
     use super::*;
+
+    /// `p` with every field a `SourceMap` supplies emptied — what a scratch of the same machine projects,
+    /// since a scratch has no map.
+    fn without_map(mut p: TmProgram) -> TmProgram {
+        for s in &mut p.states {
+            s.instr = None;
+        }
+        p.listing.clear();
+        p.labels.clear();
+        p
+    }
     use redextape_core::tm::EncodingKind;
 
     /// From `three_way_oracle.rs`'s `LAMBDA_LIMITATION_DEMOS` — the corpus of programs the λ backend
@@ -2552,9 +2578,11 @@ state halt: accept
     /// `print_tm_with` — rather than hand-written, so this also exercises the round trip a user
     /// actually performs: emit a file, paste it into a pane.
     ///
-    /// **`source_node` IS THE ONE FIELD ALLOWED TO DIFFER, AND THE STRUCT-UPDATE ASSERTION IS WHAT SAYS
-    /// SO.** That is T1's whole contract seen from the consumer side: the scratch passes `None` to
-    /// `TmState::window`, so it loses the sync anchor and nothing else. `core`'s
+    /// **WHAT A MAP SUPPLIES IS ALL THAT MAY DIFFER, AND THE TWO ASSERTIONS THAT STRIP IT ARE WHAT SAY SO:**
+    /// `source_node` on each state, and each state's `instr` with the `listing` and `labels` on the
+    /// projection. That is T1's whole contract seen from the consumer side: the scratch passes `None` to
+    /// `TmState::window` and to `TmProgram::of`, so it loses the sync anchor and the listing and nothing
+    /// else. `core`'s
     /// `an_absent_map_zeroes_the_source_node_and_leaves_every_other_field_alone` pins the same property
     /// at the builder; this pins that the boundary actually wired it that way.
     #[test]
@@ -2581,7 +2609,11 @@ state halt: accept
         assert_eq!(st.width, 64, "the width the auto-fit chose, not `MIN_FIELD_WIDTH`");
 
         let mut s = Session::compile(src, kind).session.expect("compiles");
-        assert_eq!(sc.tm_program(), s.tm_program().expect("TM available"), "same machine, same projection");
+        assert_eq!(
+            sc.tm_program(),
+            without_map(s.tm_program().expect("TM available")),
+            "same machine, same projection"
+        );
 
         // Driven in lockstep rather than compared only at step 0: a wrong `init` can still agree on an
         // empty tape at step 0 and diverge the moment the machine reads one.
@@ -2626,7 +2658,11 @@ state halt: accept
         let st = sc.tm_status();
         assert!(st.header, "the header survived `compile` and reached the printer");
         assert_eq!(st.width, 64, "the auto-fit width, not `MIN_FIELD_WIDTH`");
-        assert_eq!(sc.tm_program(), s.tm_program().expect("TM available"), "same machine, same projection");
+        assert_eq!(
+            sc.tm_program(),
+            without_map(s.tm_program().expect("TM available")),
+            "same machine, same projection"
+        );
 
         // Lockstep rather than a step-0 comparison: a wrong `init` can agree on an empty tape at step 0
         // and diverge the moment the machine reads one.
@@ -3178,37 +3214,75 @@ state halt: accept
         assert!(Session::compile("1 + true", EncodingKind::Unary).session.is_none());
     }
 
-    /// `compile` builds the map at `MIN_FIELD_WIDTH` and lets `run_tm_described` auto-fit the width the
-    /// machine actually runs at, so the two can differ. That is only sound because `lower_tm` derives
-    /// state NAMES from the instruction stream rather than the field width.
-    ///
-    /// PINNED RATHER THAN ASSUMED, because the failure would be silent: if a future encoding put the
-    /// width into a state name, `tm_owner` would stop matching and `source_node` would read `None`
-    /// everywhere — which is also what it honestly reads for scaffolding, so nothing downstream could
-    /// tell the difference. This test fails instead.
-    #[test]
-    fn the_source_node_resolves_at_the_width_the_run_fitted() {
-        use redextape_core::viewmodel::TmState;
-
-        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
-        let (program, mut c, _) = s.tm.expect("the TM leg runs this");
-        let fitted = program.width;
+    /// **EVERY STATE THE RUN BILLS TO AN INSTRUCTION RESOLVES — ITS INSTRUCTION, AND FOR A FIRST-ORDER
+    /// PROGRAM ITS OWNER.** State names depend on the field width, so this holds only because `compile`
+    /// builds its map at the width the run fitted (its doc has the numbers from when it did not).
+    ///
+    /// **THIS REPLACES A TEST THAT WAS GREEN OVER THE HOLE.** Its predecessor stepped the sample until ONE
+    /// state resolved an owner and passed — which the map built at `MIN_FIELD_WIDTH` did, with 47 of the
+    /// sample's 121 billed states unresolved. So this counts: the authority is `lower_tm_mapped` at the
+    /// fitted width, over a program lowered by `lower_asm` and `defunc` rather than their `_mapped` twins
+    /// the map uses, and every state must agree with it. Each fixture fits wider than `MIN_FIELD_WIDTH`,
+    /// or it could not tell the two widths apart.
+    ///
+    /// **BOTH ARMS THAT YIELD A LEG, AND THE DEFUNC ROAD.** A budget of 10 steps stops the sample in `HitCap` at the
+    /// narrowest width — the fitting loop retries only an overflow — so that case asks for no widening. A program
+    /// `lower_asm` refuses reaches the TM half only through `defunc`, whose minted constructs own nothing: there
+    /// every owned state is billed, and some billed states are not owned.
+    #[test]
+    fn every_billed_state_resolves_at_the_width_the_run_fitted() {
+        let list20 = format!("[{}]", (1..=20).map(|n| n.to_string()).collect::<Vec<_>>().join(", "));
+        let capped = tm::TmCaps { steps: 10, cells: tm::TM_DEFAULT_CAPS.cells };
+        let higher = "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)";
+        for (src, kind, caps, widens) in [
+            ("let x = 40; x + 2", EncodingKind::Unary, tm::TM_DEFAULT_CAPS, true),
+            ("let x = 40; x + 2", EncodingKind::Binary, tm::TM_DEFAULT_CAPS, true),
+            (list20.as_str(), EncodingKind::Unary, tm::TM_DEFAULT_CAPS, true),
+            ("let x = 40; x + 2", EncodingKind::Unary, capped, false),
+            (higher, EncodingKind::Unary, tm::TM_DEFAULT_CAPS, true),
+        ] {
+            let s = Session::compile_with_caps(src, kind, caps).session.expect("compiles");
+            let program = s.tm_program().expect("the TM leg runs this");
+            if widens {
+                assert!(program.width > tm::MIN_FIELD_WIDTH, "{src} {kind:?}: fits at the narrowest width");
+            }
 
-        let mut saw_some = false;
-        for _ in 0..200 {
-            if TmState::window(&c, Some(&s.map), 2).source_node.is_some() {
-                saw_some = true;
-                break;
+            let (asm, first_order) = match tm::lower_asm(&s.core) {
+                Ok(p) => (p, true),
+                Err(tm::LowerError::Unsupported { .. }) => {
+                    (tm::lower_asm(&tm::defunc(&s.core).expect("defunc")).expect("lowers after defunc"), false)
+                }
+                Err(e) => panic!("{src}: the fixture lowers: {e:?}"),
+            };
+            let (machine, origins) = tm::lower_tm_mapped(&asm, &*kind.at(program.width)).expect("the fixture lays out");
+            assert_eq!(machine.states.len(), program.states.len(), "{src} {kind:?}: the run's machine");
+            let (mut billed, mut owned) = (0, 0);
+            for (s_id, (state, origin)) in program.states.iter().zip(&origins).enumerate() {
+                assert_eq!(state.instr, *origin, "{src} {kind:?}: state {s_id} ({})", state.name);
+                let has_owner = s.map.tm_owner(&state.name).is_some();
+                assert!(
+                    !has_owner || origin.is_some(),
+                    "{src} {kind:?}: state {s_id} ({}) owned, unbilled",
+                    state.name
+                );
+                if first_order {
+                    assert_eq!(
+                        has_owner,
+                        origin.is_some(),
+                        "{src} {kind:?}: state {s_id} ({}) billed, unowned",
+                        state.name
+                    );
+                }
+                billed += usize::from(origin.is_some());
+                owned += usize::from(has_owner);
             }
-            if c.next().is_none() {
-                break;
+            assert!(billed > 100, "{src} {kind:?}: {billed} billed states is too few to pin anything");
+            if !first_order {
+                assert!(owned > 0 && owned < billed, "{src} {kind:?}: {owned} of {billed} owned through defunc");
             }
+            assert_eq!(program.listing, s.map.tm_listing, "{src} {kind:?}");
+            assert_eq!(program.listing.len(), asm.code.len(), "{src} {kind:?}: one line per instruction");
+            assert_eq!(program.labels, asm.labels, "{src} {kind:?}");
         }
-        assert!(
-            saw_some,
-            "no visited state resolved to a Core node at fitted width {fitted} — the map was built at \
-             {}, so state names have started depending on the width",
-            tm::MIN_FIELD_WIDTH
-        );
     }
 }
```

- [ ] **Step 4: Run the tests.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core -p redextape-wasm --all-features --no-fail-fast`
Expected: `1388 tests run: 1388 passed, 32 skipped`.

Run: `PATH="/usr/sbin:$PATH" systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 --setenv=PATH="/usr/sbin:$PATH" --setenv=CARGO_HOME="$CARGO_HOME" --setenv=RUSTUP_HOME="$RUSTUP_HOME" wasm-pack test --headless --chrome crates/redextape-wasm`
Expected: `test result: ok. 27 passed; 0 failed; 0 ignored; 0 filtered out`.

Run: `cd web && pnpm run build:wasm && pnpm run typecheck && pnpm exec vitest run --project node`
Expected: the package builds, `tsc` is clean, and `Test Files  48 passed (48)`, `Tests  640 passed (640)`.

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (`cargo nextest run -p redextape-wasm -p redextape-core --all-features --no-fail-fast -E 'test(every_billed_state)|test(headered_scratch)|test(tm_text_round_trips)|test(link_index_resolves_tm_owners)'`, and for the last row `wasm-pack test` as in Step 4):

| Sabotage | Fails |
|---|---|
| `session.rs`: build the map at `kind.at(tm::MIN_FIELD_WIDTH)` again | `every_billed_state_resolves_at_the_width_the_run_fitted` |
| `viewmodel.rs`: `instr: map.and_then(\|m\| m.tm_instr(&s.name))` → `instr: None` | `link_index_resolves_tm_owners_by_name_at_the_width_the_run_fitted`, `every_billed_state_resolves_at_the_width_the_run_fitted` |
| `viewmodel.rs`: `listing: map.map(…)…` → `listing: Vec::new()` | `every_billed_state_resolves_at_the_width_the_run_fitted` |
| `viewmodel_contract.rs`: build that test's map at `MIN_FIELD_WIDTH` | `link_index_resolves_tm_owners_by_name_at_the_width_the_run_fitted` — the width trap it is named for |
| `session.rs`: `without_map` stops clearing `instr` | `tm_text_round_trips_through_tm_scratch_to_the_same_machine`, `a_headered_scratch_matches_the_session_path_except_for_the_source_node` |
| `viewmodel.rs`: `instr: None` again, under `wasm-pack test` | `test result: FAILED. 26 passed; 1 failed; 0 ignored; 0 filtered out` — the one assertion that counts `instr` across the wire: 0 of the 121 billed states carry it |

- [ ] **Step 6: Run the gates.**

Run: `cargo fmt --check && systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy --workspace --all-targets --all-features -- -D warnings && cd web && pnpm exec biome ci --error-on-warnings`
Expected: all exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The session builds its map at the width the run fitted, and the wire carries each state's instruction

State names depend on the field width, and `compile` built its map at MIN_FIELD_WIDTH before the run
fitted its width, so `tm_owner` resolved 74 of the sample's 121 billed states (spec amendment 14).
`compile` now runs the machine first and builds the map at the width it fitted. `StateView.instr`,
`TmProgram.listing` and `TmProgram.labels` carry the map's instruction, listing and labels to the web;
a scratch has no map and carries none. The test that pinned names across widths passed once one state
resolved; its replacement counts every billed state.
EOF
```

### Task 3: The rule table: a grid with a share of the view's height, the next rule, and tapes a reader can hear

**Files:**
- Modify: `web/src/layout.ts`
- Modify: `web/src/state-table.ts`
- Modify: `web/src/style.css`
- Modify: `web/src/tape.ts`
- Modify: `web/src/tm-pane.ts`
- Modify: `web/tests/browser/app.test.ts`
- Create: `web/tests/browser/hidden.test.ts`
- Modify: `web/tests/browser/marks.test.ts`
- Modify: `web/tests/browser/pane-floor.test.ts`
- Modify: `web/tests/browser/setup.ts`
- Create: `web/tests/browser/tm-grid.test.ts`
- Modify: `web/tests/node/tape.test.ts`

**Interfaces:**
- Produces: `TmPane`'s table is `role="grid"` (the panel's body, labelled by its toggle), `aria-rowcount` the whole table's; each drawn row `role="row"` with `aria-rowindex` and one `role="gridcell"` (`.state-cell`, id `tm-grid-<n>-<row>`); the current state's row `aria-current="step"`; the next rule's row `.is-next` with `data-marks="fires next"` on its cell. `tape.ts`: `TapeRow.head`, `TapeRow.named`, `tapeLabel(row)`. CSS: the TM view is a flex column (`.pane[data-kind="tm"]`, `.tm-pane`) whose open rules and outline panels take 2 and 1 shares.
- The table redraws on a resize (a `ResizeObserver`), since its height is the view's now.

**`hidden` MUST STILL HIDE.** `.outline { display: flex }` defeated `[hidden]`, on `main`; `.outline[hidden]` restores it, and the TM view's flex rules carry `:not([hidden])` so they cannot show a hidden panel. `hidden.test.ts` holds the whole class, not the instance.

**THE RESIZE TEST HOLDS THE PANE'S OTHER DRAWS.** `render`, `setLink` and `setProgram` each draw the rows for whatever height the table has, and a copy's value run and a panel toggle's focus move call them on their own schedule; unheld, the test passed with no resize observer. It replaces the three on `TmPane.prototype` while the shares change and restores them in a `finally`, and it checks that the rows were drawn for the smaller share before it checks the growth, since rows left over from the larger share would already cover it.

The `40vh` comments in `tm-pane.ts`, `layout.ts`, `setup.ts`, `app.test.ts` and `pane-floor.test.ts` are rewritten for what bounds the table now; `layout.ts`'s `MIN_PANE_FRACTION` records its design question answered.

- [ ] **Step 1: Write the failing tests.** `tm-grid.test.ts` and `hidden.test.ts` are new; the rest of the tests' half renames `is-firing` and adds `tapeLabel`'s node cases.

Create `web/tests/browser/hidden.test.ts`:

```ts file=web/tests/browser/hidden.test.ts
import type { EditorView } from '@codemirror/view'
import { expect, it } from 'vitest'
import { SHELL, until } from './harness'

/**
 * **`hidden` HIDES.** The browser's own `[hidden] { display: none }` loses to any author rule that sets `display`,
 * so an element a view hides can stay on screen with nothing but a probe to notice. One did, on `main`: every
 * outline's list, since `.outline` is a flex column — the source view's from the first draw, before anyone opened
 * it. Plan 7 part 4's first prototype added a second, a TM view's outline panel laid out as a flex column while
 * hidden. So this looks for the whole class, not the two instances: every `[hidden]` element on the page, across
 * every panel opened and closed and every view forked to a copy.
 */

const shownWhileHidden = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('[hidden]')]
    .filter((e) => getComputedStyle(e).display !== 'none')
    .map((e) => `${e.tagName.toLowerCase()}.${e.className}`)

const toggles = () => [...document.querySelectorAll<HTMLButtonElement>('.panel-toggle')]

it('leaves nothing on screen that is hidden, through every panel and a copy of each view', async () => {
  document.body.innerHTML = SHELL
  const view: EditorView = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'fn f(x) { x + 1 }\nf(2)\n' } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
  const seen = new Set(shownWhileHidden())
  // Each panel opened and closed, before and after both views fork a copy — a copy is what shows a TM view's
  // outline, and what gives the λ view an editor.
  for (const round of ['as compiled', 'with copies']) {
    for (const toggle of toggles()) {
      toggle.click()
      for (const e of shownWhileHidden()) seen.add(`${e}, ${round}, one toggle on`)
      toggle.click()
      for (const e of shownWhileHidden()) seen.add(`${e}, ${round}, toggled back`)
    }
    if (round === 'as compiled') {
      for (const fork of document.querySelectorAll<HTMLButtonElement>('button.detach')) fork.click()
      await until(() => document.querySelectorAll('.term-editor').length >= 2, 'both copies to mount an editor')
    }
  }
  expect([...seen]).toEqual([])
})
```

Create `web/tests/browser/tm-grid.test.ts`:

```ts file=web/tests/browser/tm-grid.test.ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { OVERSCAN, ROW_HEIGHT, TmPane } from '../../src/tm-pane'
import { SHELL, until } from './harness'

/**
 * The rule table as a grid, and as a share of its view's height — Plan 7 part 4, spec §9.1 and §9.2
 * (accessibility items 3 and 4).
 *
 * THE SAMPLE'S TABLE IS TALLER THAN THE VIEW, which is what the key cases need: End has to move the active row
 * to a row the first draw did not render, so the window has to scroll to draw it.
 */

let view: EditorView

const SAMPLE = 'let x = 40; x + 2'

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const grid = () => pane().querySelector('.state-table') as HTMLElement
const rows = () => [...pane().querySelectorAll<HTMLElement>('.state-row')]
const rowCount = () => Number(grid().getAttribute('aria-rowcount'))
/** The row `aria-activedescendant` names, by its 0-based index over the whole table. */
const activeIndex = () => {
  const id = grid().getAttribute('aria-activedescendant')
  const cell = id === null ? null : document.getElementById(id)
  return cell === null ? null : Number(cell.closest('[role="row"]')?.getAttribute('aria-rowindex')) - 1
}
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const stepButton = (label: string) =>
  [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)

async function settled(src: string): Promise<void> {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
  await until(
    () =>
      document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle' &&
      (document.querySelector('#results')?.textContent ?? '') !== '',
    'the app to settle',
  )
  await until(() => rows().length > 0, 'the rule table to draw')
}

// ONE MOUNT FOR THE FILE, outside both blocks, so either runs alone under `-t`.
beforeAll(async () => {
  // TALL ENOUGH THAT THE TM VIEW HAS ROOM ABOVE ITS PANELS' FLOORS, EVEN WITH A COPY'S EDITOR OPEN: the sharing
  // is only visible there. At 1600 the copy's editor and five tapes left both panels on their floors.
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  await settled(SAMPLE)
})

describe('the rule table as a grid', () => {
  it('is one tab stop, counted over the whole table, with one cell per row', () => {
    expect(grid().getAttribute('role')).toBe('grid')
    expect(grid().tabIndex).toBe(0)
    // The count is the whole table's, not the drawn window's: the spacer carries the same number in pixels.
    const spacer = pane().querySelector('.state-spacer') as HTMLElement
    expect(rowCount() * ROW_HEIGHT).toBe(Number.parseFloat(spacer.style.height))
    expect(rows().length).toBeLessThan(rowCount())
    for (const row of rows()) {
      expect(row.getAttribute('role')).toBe('row')
      const cells = row.querySelectorAll('[role="gridcell"]')
      expect(cells).toHaveLength(1)
      // `aria-rowindex` is 1-based, and a cell's id ends in the row's 0-based index.
      expect(cells[0]?.id.endsWith(`-${Number(row.getAttribute('aria-rowindex')) - 1}`)).toBe(true)
    }
  })

  it('says which state is current and which rule fires next', async () => {
    // At the frontier the machine sits in `halt`, where no rule fires; one step back is the rule into it.
    stepButton('◀')?.click()
    await until(() => pane().querySelector('.state-row.is-next') !== null, 'a rule to be about to fire')
    const current = pane().querySelectorAll('[aria-current="step"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.classList.contains('is-current')).toBe(true)
    const next = pane().querySelector('.state-row.is-next > [role="gridcell"]') as HTMLElement
    expect(next.dataset.marks).toBe('fires next')
    // THE WORDS ARE READ, AND ARE NOT THE ROW'S TEXT: generated content carries them.
    expect(getComputedStyle(next, '::before').content).toBe('"fires next"')
    expect(next.textContent).not.toContain('fires next')
  })

  it('moves the active row by index, past the rows the table has drawn', async () => {
    grid().focus()
    await userEvent.keyboard('{End}')
    const last = rowCount() - 1
    expect(activeIndex()).toBe(last)
    // The window scrolled to draw it: the first row drawn is no longer the table's first.
    expect(Number(rows()[0]?.getAttribute('aria-rowindex'))).toBeGreaterThan(1)
    await userEvent.keyboard('{Home}')
    expect(activeIndex()).toBe(0)
    await userEvent.keyboard('{ArrowDown}')
    expect(activeIndex()).toBe(1)
    await userEvent.keyboard('{PageDown}')
    const paged = activeIndex() ?? 0
    expect(paged).toBeGreaterThan(2)
    await userEvent.keyboard('{PageUp}')
    expect(activeIndex()).toBe(1)
    // Keys that scrolled took the table off the machine: following is detached, and its control offered.
    const reattach = pane().querySelector('.table-reattach') as HTMLElement
    expect(reattach.hidden).toBe(false)
    // Following again scrolls the view back to the current state, near the table's top, and an active row left
    // at the far end comes with it: still named, so still a row the table has drawn.
    await userEvent.keyboard('{End}')
    reattach.click()
    const now = activeIndex()
    expect(now).not.toBeNull()
    expect(now).toBeLessThan(last)
  })

  it("links the active row's state on Enter, as a click does", async () => {
    // `pc0`, the first state the program owns: the table opens on `halt` and `overflow`, which belong to no
    // construct and so link nothing.
    grid().focus()
    await userEvent.keyboard('{Home}')
    const pc0 = rows().find((r) => r.textContent === 'pc0') as HTMLElement
    const at = Number(pc0.getAttribute('aria-rowindex')) - 1
    for (let i = 0; i < at; i += 1) await userEvent.keyboard('{ArrowDown}')
    expect(activeIndex()).toBe(at)
    expect(pane().querySelector('.state-row.is-linked')).toBeNull()
    await userEvent.keyboard('{Enter}')
    await until(() => pane().querySelector('.state-row.is-linked') !== null, 'the state to be linked')
    expect(
      pane()
        .querySelector(`[aria-rowindex="${at + 1}"]`)
        ?.classList.contains('is-linked'),
    ).toBe(true)
  })
})

describe('the tapes (spec §9.3)', () => {
  it('are labelled groups that say where each head is and what it reads', () => {
    const tapes = [...pane().querySelectorAll<HTMLElement>('.tape')]
    expect(tapes).toHaveLength(5)
    for (const tape of tapes) {
      expect(tape.getAttribute('role')).toBe('group')
      const name = tape.querySelector('.tape-label')?.textContent
      const head = tape.querySelector('.cell.head')?.textContent
      const said = head === '_' ? 'blank' : head
      expect(tape.getAttribute('aria-label')).toMatch(new RegExp(`^tape ${name}, head at cell \\d+, reading ${said}$`))
    }
  })
})

describe("the rule table's height is its view's (spec §9.1)", () => {
  it('fills the view, not a share of the window', () => {
    // No `max-height` of its own: the view's flex layout is what bounds it.
    expect(getComputedStyle(grid()).maxHeight).toBe('none')
    const panel = pane().querySelector('[data-panel="rules"]') as HTMLElement
    // The rules panel runs to the view's bottom edge, and the view does not scroll.
    expect(Math.abs(pane().getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom)).toBeLessThan(2)
    expect(pane().scrollHeight).toBeLessThanOrEqual(pane().clientHeight + 1)
    // And every row the table shows is drawn: the rows reach the table's own bottom edge.
    const drawn = rows().at(-1)?.getBoundingClientRect().bottom ?? 0
    expect(drawn).toBeGreaterThanOrEqual(grid().getBoundingClientRect().bottom - 1)
  })

  it('gives the rules two shares and the outline one, and redraws the rows when its share changes', async () => {
    pane().querySelector<HTMLButtonElement>('button.detach')?.click()
    await until(() => pane().querySelector('.term-editor') !== null, 'the copy to mount its editor')
    const outline = pane().querySelector('[data-panel="outline"]') as HTMLElement
    await until(() => !outline.hidden, 'the outline to appear with the editor')
    await until(() => rows().length > 0, 'the copy to draw its table')
    const tableBefore = grid().getBoundingClientRect().height
    const bottom = () => grid().getBoundingClientRect().bottom
    const lastRow = () => rows().at(-1)?.getBoundingClientRect().bottom ?? 0
    // **EVERY OTHER WAY IN TO THE TABLE'S DRAW IS HELD WHILE THE SHARES CHANGE** — `render`, `setLink` and
    // `setProgram`, the pane's public callers of it — so the rows can follow the table only through its resize
    // observer. A copy's value run renders the view on its own schedule, and a panel's toggle moves the focus
    // and with it the link; each drew the rows for whatever height the table had then, and this passed with no
    // observer at all, polled and then with `render` alone held.
    const { render, setLink, setProgram } = TmPane.prototype
    Object.assign(TmPane.prototype, { render: () => undefined, setLink: () => undefined, setProgram: () => undefined })
    try {
      outline.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click()
      await until(() => grid().getBoundingClientRect().height < tableBefore, 'the table to give up a share')
      await frame()
      await frame()
      const table = grid().getBoundingClientRect().height
      const list = (outline.querySelector('.outline') as HTMLElement).getBoundingClientRect().height
      // Two shares against one of the space the headers leave; the headers are why it is not exactly 2.
      expect(table / list).toBeGreaterThan(1.6)
      expect(table / list).toBeLessThan(2.4)
      // THE CHECK BELOW HOLDS ONLY IF THE ROWS DO NOT ALREADY COVER THE GROWTH. `visibleWindow` draws `OVERSCAN`
      // rows past the last row seen, so a window drawn for the smaller table ends less than `OVERSCAN + 2` rows
      // below its edge; rows left over from the larger table would reach past it, and no draw could be seen.
      expect(lastRow()).toBeLessThan(bottom() + (OVERSCAN + 2) * ROW_HEIGHT)
      // Closing the outline hands its share back, and the rows drawn follow the table down to its new bottom
      // edge within the frame that resized it — not polled, two frames on.
      outline.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click()
      await frame()
      await frame()
      expect(grid().getBoundingClientRect().height).toBeGreaterThan(table)
      expect(lastRow()).toBeGreaterThanOrEqual(bottom() - 1)
    } finally {
      Object.assign(TmPane.prototype, { render, setLink, setProgram })
    }
  })
})
```

Apply the tests' half of the patch:

```diff apply=tests
diff --git a/web/tests/browser/app.test.ts b/web/tests/browser/app.test.ts
index 771038e..fa074ae 100644
--- a/web/tests/browser/app.test.ts
+++ b/web/tests/browser/app.test.ts
@@ -947,7 +947,7 @@ describe('the app, end to end', () => {
       await until(() => spacer().style.height === BIG_SPACER)
       const rows = document.querySelectorAll('[data-leaf="tm-0"] .state-row')
       // THE SCROLL CONTAINER MUST ACTUALLY BE BOUNDED, and this asserts it rather than assuming it.
-      // `.state-table`'s `max-height: 40vh` is what bounds it, and Vitest serves its own tester HTML —
+      // The TM view's flex rules (spec §9.1) are what bound it, and Vitest serves its own tester HTML —
       // `tests/browser/setup.ts` is what gets `style.css` onto that page. If that setup ever breaks, the
       // box lays out at its full content height (measured: 271,968px for 11,332 rows), nothing bounds
       // `#drawTable`'s window computation, and every draw during recording renders every row. THERE IS
@@ -979,12 +979,12 @@ describe('the app, end to end', () => {
       await settled(view, 'let x = 40; x + 2')
       // By the time `settled` resolves, the TM leg is fully recorded and its head sits at the
       // frontier, which is `halt` — `frame.rule` is `null` there (`types.ts`'s doc: "at an accept
-      // state, at `halt`, or at a stuck configuration"), so `is-firing` would be empty at this exact
+      // state, at `halt`, or at a stuck configuration"), so `is-next` would be empty at this exact
       // frame. `◀` once steps back to the frame whose rule fires INTO halt, which is where a rule is
       // actually about to fire.
       click('tm', '◀')
       expect(document.querySelectorAll('[data-leaf="tm-0"] .state-row.is-current').length).toBe(1)
-      expect(document.querySelectorAll('[data-leaf="tm-0"] .state-row.is-firing').length).toBe(1)
+      expect(document.querySelectorAll('[data-leaf="tm-0"] .state-row.is-next').length).toBe(1)
     })
 
     it('moves the highlight as the machine steps', async () => {
@@ -1199,7 +1199,7 @@ describe('the app, end to end', () => {
       toggle.click()
       toggle.click()
       expect(document.querySelector('[data-leaf="tm-0"] .state-row.is-current')?.textContent).toBe(current)
-      expect(document.querySelectorAll('[data-leaf="tm-0"] .state-row.is-firing').length).toBe(1)
+      expect(document.querySelectorAll('[data-leaf="tm-0"] .state-row.is-next').length).toBe(1)
     })
   })
 })
diff --git a/web/tests/browser/marks.test.ts b/web/tests/browser/marks.test.ts
index dc1b60a..9bf3c6a 100644
--- a/web/tests/browser/marks.test.ts
+++ b/web/tests/browser/marks.test.ts
@@ -43,8 +43,8 @@ describe('rows mark position with the left edge and the outline', () => {
     expect(getComputedStyle(row).borderLeftStyle).toBe('dashed')
   })
 
-  it('keeps the outline on the firing row', () => {
-    const row = mount('<div class="state-row is-firing">q0</div>', '.state-row')
+  it('keeps the outline on the row of the rule that fires next', () => {
+    const row = mount('<div class="state-row is-next">q0</div>', '.state-row')
     expect(getComputedStyle(row).outlineStyle).toBe('solid')
   })
 })
diff --git a/web/tests/browser/pane-floor.test.ts b/web/tests/browser/pane-floor.test.ts
index bbf3bd1..d79e483 100644
--- a/web/tests/browser/pane-floor.test.ts
+++ b/web/tests/browser/pane-floor.test.ts
@@ -171,13 +171,12 @@ describe('a pane at the floor', () => {
 
       const tmAtHeightFloor = root.querySelector<HTMLElement>('[data-leaf="tm-0"]')
       const tmHeight = Math.round(tmAtHeightFloor?.getBoundingClientRect().height ?? 0)
-      // UNLIKE THE WIDTH CASE, THE OUTER `.pane`'S OWN OVERFLOW IS A GENUINE SIGNAL HERE. TM's
-      // `.state-table` caps itself at `max-height: 40vh` — the real tester VIEWPORT, not this
-      // squeezed pane — so at a small enough height floor the table (open by default, since
-      // `createPanel`'s `open` option defaults to `true`) can legitimately exceed the pane's own
-      // `clientHeight` and push the outer `.pane` (`overflow: auto` in its own right) into
-      // scrolling, which is exactly what `.cm-scroller`/`.cells` never let the outer element do on
-      // the width axis.
+      // UNLIKE THE WIDTH CASE, THE OUTER `.pane`'S OWN OVERFLOW IS A GENUINE SIGNAL HERE. A TM view's
+      // open panels shrink with the pane only down to their floors (spec §9.1), so at a small enough
+      // height floor the table (open by default, since `createPanel`'s `open` option defaults to `true`)
+      // can legitimately exceed the pane's own `clientHeight` and push the outer `.pane` (`overflow:
+      // auto` in its own right) into scrolling, which is exactly what `.cm-scroller`/`.cells` never let
+      // the outer element do on the width axis.
       const tmVerticalOverflow =
         tmAtHeightFloor === null || tmAtHeightFloor.clientHeight === 0
           ? 'n/a'
diff --git a/web/tests/browser/setup.ts b/web/tests/browser/setup.ts
index d55acfd..3b758ce 100644
--- a/web/tests/browser/setup.ts
+++ b/web/tests/browser/setup.ts
@@ -7,10 +7,10 @@
  * and the page does not flash unstyled). The consequence is that every browser test before this file
  * ran against a completely unstyled DOM.
  *
- * THAT IS NOT A COSMETIC DIFFERENCE FOR THE STATE TABLE. `.state-table`'s `max-height: 40vh` is what
- * bounds the scroll container; without it the box lays out at its full content height — measured at
+ * THAT IS NOT A COSMETIC DIFFERENCE FOR THE STATE TABLE. The TM view's flex rules are what bound
+ * the scroll container; without them the box lays out at its full content height — measured at
  * 271,968px for 11,332 rows — and a test asserting that virtualization renders few rows would be
- * exercising `TmPane`'s clamp fallback instead of the geometry the app actually ships.
+ * measuring a table that draws every row instead of the geometry the app actually ships.
  *
  * Importing the stylesheet here makes the browser tier test the real thing. It is a `setupFiles` entry
  * rather than an import in `main.ts` because the `<head>` link is the right production loading order
diff --git a/web/tests/node/tape.test.ts b/web/tests/node/tape.test.ts
index 3b453ae..b5a389e 100644
--- a/web/tests/node/tape.test.ts
+++ b/web/tests/node/tape.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest'
-import { tapeRows } from '../../src/tape'
+import { tapeLabel, tapeRows } from '../../src/tape'
 import type { TmState } from '../../src/types'
 
 const NAMES = ['REG', 'WORK', 'STACK', 'HEAP', 'BOX']
@@ -67,3 +67,26 @@ describe('tapeRows', () => {
     expect(tapeRows(state({ heads: [], window_start: [], window: [] }), NAMES)).toEqual([])
   })
 })
+
+describe('tapeLabel', () => {
+  it("says the tape, the head's cell on the whole tape, and what it reads", () => {
+    // The head is at cell 5 of the tape and index 2 of the window: the label says 5, and reads the window's 2.
+    const [row] = tapeRows(state(), NAMES)
+    expect(row === undefined ? '' : tapeLabel(row)).toBe('tape REG, head at cell 5, reading c')
+  })
+
+  it('says the blank symbol as a word', () => {
+    const [row] = tapeRows(state({ window: [['a', 'b', '_', 'd', 'e']] }), NAMES)
+    expect(row === undefined ? '' : tapeLabel(row)).toBe('tape REG, head at cell 5, reading blank')
+  })
+
+  it('says a head outside the window rather than reading a cell it is not on', () => {
+    const [row] = tapeRows(state({ heads: [99], window_start: [3] }), NAMES)
+    expect(row === undefined ? '' : tapeLabel(row)).toBe('tape REG, head at cell 99, outside the window')
+  })
+
+  it('names an unnamed tape once, not twice', () => {
+    const [row] = tapeRows(state(), [])
+    expect(row === undefined ? '' : tapeLabel(row)).toBe('tape 0, head at cell 5, reading c')
+  })
+})
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/tape.test.ts`
Expected: FAIL — `Tests  4 failed | 7 passed (11)` — `says the tape, the head's cell on the whole tape, and what it reads`, `says the blank symbol as a word`, `says a head outside the window rather than reading a cell it is not on`, `names an unnamed tape once, not twice`.

Run: `cd web && pnpm exec vitest run --project browser tests/browser/tm-grid.test.ts tests/browser/hidden.test.ts tests/browser/marks.test.ts`
Expected: FAIL — `Tests  9 failed | 8 passed (17)` — `leaves nothing on screen that is hidden, through every panel and a copy of each view`, `keeps the outline on the row of the rule that fires next`, `is one tab stop, counted over the whole table, with one cell per row`, `says which state is current and which rule fires next` and 5 more.

Two runs, not one joined by `&&`: the node run fails first, and the browser half would never be seen to fail.

- [ ] **Step 3: Write the code.** The grid and its keys in `tm-pane.ts`, the tape label in `tape.ts`, the CSS.

Apply the source half of the patch:

```diff apply=source
diff --git a/web/src/layout.ts b/web/src/layout.ts
index 708e333..a559b51 100644
--- a/web/src/layout.ts
+++ b/web/src/layout.ts
@@ -69,10 +69,10 @@ export type LayoutNode =
  * into a scratch buffer — a state this reading still does not exercise directly, so that half remains
  * inference by symmetry rather than a direct measurement.
  *
- * 0.1 DOES NOT STAND FOR TM's HEIGHT, AND THIS IS A FINDING, NOT A FIX. At every size TM's own content
- * is 6-11x taller than the box the drag left it — the `[data-leaf="tm-0"]` pane's `overflow: auto`
- * genuinely fires here (unlike the width case above), because `.state-table`'s `max-height: 40vh` is
- * relative to the BROWSER'S viewport, not to this pane. A divider drag does not resize the browser
+ * 0.1 DID NOT STAND FOR TM's HEIGHT WHEN THIS WAS MEASURED, AND THAT WAS A FINDING, NOT A FIX. At every
+ * size TM's own content was 6-11x taller than the box the drag left it — the `[data-leaf="tm-0"]` pane's
+ * `overflow: auto` genuinely fired here (unlike the width case above), because `.state-table`'s cap was
+ * then `max-height: 40vh`, relative to the BROWSER'S viewport, not to this pane. A divider drag does not resize the browser
  * window, so shrinking TM's allocated share of the split does nothing to that cap — the δ-table (open
  * by default, since `createPanel`'s `open` option defaults to `true`) stays whatever size the WINDOW
  * allows regardless of how little SPACE the pane itself was just given. This is a shape mismatch
@@ -81,6 +81,10 @@ export type LayoutNode =
  * design §9 this module does not become the place a pixel fix would live even if one were made; this
  * is flagged as a design question (does `.state-table`'s cap want to track the PANE rather than the
  * viewport?) rather than acted on here.
+ *
+ * **PLAN 7 PART 4's SPEC §9.1 ANSWERED IT: THE TABLE TRACKS THE VIEW.** A TM view's open panels now share its
+ * height through flex, each down to a floor, so a drag shrinks the table with the pane until the floors are
+ * reached, and the view scrolls only below them. The 6-11x figures above predate that and were not re-measured.
  */
 export const MIN_PANE_FRACTION = 0.1
 
diff --git a/web/src/state-table.ts b/web/src/state-table.ts
index dec417b..ccaa2e8 100644
--- a/web/src/state-table.ts
+++ b/web/src/state-table.ts
@@ -128,7 +128,7 @@ export function linkedRows(index: StateIndex, states: number[]): Set<number> {
  * animation frame while a leg plays — and repainting dozens of rule rows on every frame is a flicker nobody
  * asked for. The header
  * alone answers "which construct is the machine working on right now" without competing for attention
- * with `highlight()`'s `is-current`/`is-firing`, which already marks the single row the machine is
+ * with `highlight()`'s `is-current`/`is-next`, which already marks the single row the machine is
  * literally sitting on.
  *
  * EMPTY IS THE COMMON CASE, NOT AN EDGE ONE. Measured, the TM leg's coverage runs 50-82% of
diff --git a/web/src/style.css b/web/src/style.css
index a23a6eb..0fcfc67 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -1165,11 +1165,12 @@ button.view-title[aria-expanded="true"] {
   font-size: var(--step--2);
 }
 
-/* `.pane` is `overflow: auto` and NOT a flex column (its own rule above), so the table cannot size itself
-   with `flex: 1 1 auto` — it needs an explicit bound or it grows to its full 3,069,144px. */
+/* THE RULE TABLE TAKES A SHARE OF ITS VIEW'S HEIGHT (spec §9.1), not `40vh` of the window: the TM view's
+   panel rules (`.tm-pane > .panel`) give it two shares of whatever the tapes leave. Its height is still
+   bounded, and has to be — unbounded, it grows to its full 3,069,144px and every draw renders every row —
+   but by the view, which the layout sizes. */
 .state-table {
   overflow-y: auto;
-  max-height: 40vh;
   font-family: var(--font-mono);
   font-size: var(--step--2);
 }
@@ -1191,27 +1192,47 @@ button.view-title[aria-expanded="true"] {
 .state-row {
   height: 24px;
   line-height: 24px;
-  white-space: pre;
-  overflow: hidden;
-  text-overflow: ellipsis;
   padding-inline: 0.5rem;
   /* THE ROW MARKS SHARE ONE `box-shadow`, composed from a variable per state, so a row that is both the
      current state and in the running focus shows both cues rather than whichever rule came last (Plan 7
      part 1, spec §11). The transparent left border is the linked row's channel, reserved on every row so
-     marking one does not shift its text. */
+     marking one does not shift its text. The grid's active row is the third cue, drawn only while the grid
+     has the keyboard's focus, as the λ view's is. */
   --row-bar: 0 0 transparent;
   --row-edge: 0 0 transparent;
+  --row-active: 0 0 transparent;
   box-shadow:
     inset var(--row-bar),
-    inset var(--row-edge);
+    inset var(--row-edge),
+    inset var(--row-active);
   border-inline-start: 3px solid transparent;
 }
+/* A row's one grid cell holds its text, so the text's clipping lives here and not on the row. */
+.state-cell {
+  white-space: pre;
+  overflow: hidden;
+  text-overflow: ellipsis;
+}
+.state-table:focus-visible .state-row.is-active {
+  --row-active: 0 0 0 2px var(--focus-ring);
+}
+/* A mark's words for a screen reader — "fires next" — as generated content, so they are read and are not the
+   row's text; clipped away, so they are not seen. The λ view's marks do the same (`.term [data-marks]`). */
+.state-cell[data-marks]::before {
+  content: attr(data-marks);
+  position: absolute;
+  width: 1px;
+  height: 1px;
+  overflow: hidden;
+  clip-path: inset(50%);
+  white-space: nowrap;
+}
 
 .state-row.is-state {
   font-weight: 600;
 }
 
-.state-row.is-accept::after {
+.state-row.is-accept > .state-cell::after {
   content: " · accept";
   opacity: 0.6;
   font-weight: 400;
@@ -1222,7 +1243,7 @@ button.view-title[aria-expanded="true"] {
   opacity: 0.85;
 }
 
-/* A linked state block. Layered UNDER `.is-current` and `.is-firing` below, which are about the run
+/* A linked state block. Layered UNDER `.is-current` and `.is-next` below, which are about the run
    rather than about the selection — a row can legitimately be both, and equal specificity means
    SOURCE ORDER decides which background shows: this rule has to come first so those two, declared
    after it, are the ones that win. */
@@ -1237,10 +1258,10 @@ button.view-title[aria-expanded="true"] {
    SAME HUE AS `.is-focus-exact`/`.term .is-contractum` (`--tok-operator`) — all three panes' "what the
    current step is working on" read as one system rather than three independently invented ones.
 
-   LAYERED BETWEEN `.is-linked` AND `.is-current`/`.is-firing` BELOW, same reasoning as the comment on
+   LAYERED BETWEEN `.is-linked` AND `.is-current`/`.is-next` BELOW, same reasoning as the comment on
    `.is-linked` above: a row can legitimately be linked, focused, AND the machine's own current row all
    at once, and equal specificity means source order decides which background shows. `.is-current`/
-   `.is-firing` — the run's literal position — must still win, so they stay declared after this.
+   `.is-next` — the run's literal position — must still win, so they stay declared after this.
 
    ITS CUE IS THE BOTTOM EDGE, composed through `--row-edge` so it survives beside the current row's bar. */
 .state-row.is-focus {
@@ -1262,7 +1283,9 @@ button.view-title[aria-expanded="true"] {
   --row-bar: 3px 0 0 var(--accent);
 }
 
-.state-row.is-firing {
+/* THE NEXT RULE — `TmState.rule`, the rule about to fire. The mark was `.is-firing` until spec §9.3 named it for
+   what it marks. */
+.state-row.is-next {
   background: color-mix(in oklab, var(--accent) 24%, var(--bg));
   outline: 1px solid var(--accent);
   outline-offset: -1px;
@@ -1599,10 +1622,62 @@ main {
      a machine with far more. MEASURED in the built app at 1440×900: 1,199 rows make a panel 34,779px
      tall, which pushes a TM view's tapes and δ table that far down the page, and 50,000 rows make it
      1,450,008px. Building the rows is not the cost — 8ms at 1,199 and 334ms at 50,000 — the height
-     is. `40vh` is the ceiling `.state-table` already uses. */
+     is. `40vh` was the ceiling `.state-table` used then. In a TM view the outline now takes a share of
+     the view's height instead (the TM view's panel rules, spec §9.1), and this cap stays for the source
+     view's outline. */
   max-height: 40vh;
   overflow-y: auto;
 }
+/* A TM VIEW'S OPEN PANELS SHARE ITS HEIGHT (spec §9.1): the rules two shares, the outline one, each down to a
+   floor, and a closed panel keeps only its header. Everything else in the view — the text panel, the status
+   lines, the tapes — keeps its own height. The view is a flex column so the panels have a height to share,
+   which `.pane` alone is not; below the floors the view scrolls, as it did. `data-kind` is `pane-host.ts`'s. */
+.pane[data-kind="tm"] {
+  display: flex;
+  flex-direction: column;
+}
+.tm-pane {
+  flex: 1 0 auto;
+  display: flex;
+  flex-direction: column;
+}
+.tm-pane > * {
+  flex: none;
+}
+/* NOT A HIDDEN ONE: `tm-pane.ts` hides the outline panel while the view holds no copy, and a `display` here would
+   outrank the browser's `[hidden]` and show it anyway — `hidden.test.ts` found exactly that. */
+.tm-pane > .panel[data-panel="rules"][data-open="true"]:not([hidden]),
+.tm-pane > .panel[data-panel="outline"][data-open="true"]:not([hidden]) {
+  display: flex;
+  flex-direction: column;
+}
+.tm-pane > .panel[data-panel="rules"][data-open="true"] {
+  flex: 2 1 0;
+}
+.tm-pane > .panel[data-panel="outline"][data-open="true"] {
+  flex: 1 1 0;
+}
+/* THE FLOORS ARE THE BODIES', so a panel's own minimum is its header and a floor, whatever the header's height.
+   Five rows each: the table's are `ROW_HEIGHT`, the outline's a line of its own. */
+.tm-pane > .panel[data-open="true"] > .state-table,
+.tm-pane > .panel[data-open="true"] > .outline {
+  flex: 1 1 0;
+  max-height: none;
+}
+.tm-pane > .panel[data-open="true"] > .state-table {
+  min-height: calc(5 * 24px);
+}
+.tm-pane > .panel[data-open="true"] > .outline {
+  min-height: 5lh;
+}
+/* `hidden` MUST STILL HIDE WHAT A `display` RULE LAYS OUT. The browser's own `[hidden] { display: none }` loses to
+   any author rule that sets `display`, so every outline's list stayed on screen while its panel was closed — the
+   source view's from the first draw, since `panel.ts` hides a closed panel's body. `hidden.test.ts` looks for the
+   whole class across the app. */
+.outline[hidden] {
+  display: none;
+}
+
 .outline-row {
   text-align: left;
   font: inherit;
diff --git a/web/src/tape.ts b/web/src/tape.ts
index 7d0f3bc..ce3294a 100644
--- a/web/src/tape.ts
+++ b/web/src/tape.ts
@@ -6,6 +6,10 @@ export type TapeRow = {
   /** The head's index INTO `cells`. May fall outside `cells` — see `headInWindow`. */
   headIndex: number
   headInWindow: boolean
+  /** The head's cell on the whole tape — `heads[i]`, a materialized-tape coordinate. */
+  head: number
+  /** Whether `label` is the tape's own name, or the `tape i` stand-in for a tape the header did not name. */
+  named: boolean
 }
 
 /**
@@ -28,6 +32,24 @@ export function tapeRows(state: TmState, names: string[]): TapeRow[] {
       cells,
       headIndex,
       headInWindow: headIndex >= 0 && headIndex < cells.length,
+      head: state.heads[i] ?? 0,
+      named: names[i] !== undefined,
     }
   })
 }
+
+/**
+ * What a tape row says to a screen reader, where a sighted reader sees a bordered cell — accessibility item 4
+ * (spec §9.3): `tape reg, head at cell 12, reading 1`. The blank symbol is said as `blank`, since `_` is a
+ * glyph and not a word.
+ *
+ * **SAID ON DEMAND, NOT ANNOUNCED.** It is the row's label, read when a reader moves to the row; no live region
+ * repeats it per step, since at 5,000 steps a second that would be noise (spec §9.3).
+ *
+ * A HEAD OUTSIDE THE WINDOW IS SAID, NOT GUESSED AT, for `tapeRows`' reason: the pane draws no marker for it.
+ */
+export function tapeLabel(row: TapeRow): string {
+  const read = row.headInWindow ? row.cells[row.headIndex] : undefined
+  const reading = read === undefined ? 'outside the window' : `reading ${read === '_' ? 'blank' : read}`
+  return `${row.named ? `tape ${row.label}` : row.label}, head at cell ${row.head}, ${reading}`
+}
diff --git a/web/src/tm-pane.ts b/web/src/tm-pane.ts
index 46c460a..4f43afb 100644
--- a/web/src/tm-pane.ts
+++ b/web/src/tm-pane.ts
@@ -13,7 +13,7 @@ import { ScratchEditor } from './scratch-editor'
 import type { Binding, PaneOption } from './sessions'
 import { centredScrollTop, Follow, focusedRows, highlight, linkedRows, ROW_HEIGHT, StateIndex } from './state-table'
 import { stepControls } from './step-controls'
-import { tapeRows } from './tape'
+import { tapeLabel, tapeRows } from './tape'
 import type { TmProgram, TmScratchStatus, TmState, ValueReading } from './types'
 import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
 import { visibleWindow } from './virtual-list'
@@ -23,6 +23,9 @@ export { ROW_HEIGHT } from './state-table'
 /** Rows rendered beyond the viewport on each side, so a fast scroll does not show blank space. */
 export const OVERSCAN = 4
 
+/** Mints each pane's grid a prefix for its cells' ids, which `aria-activedescendant` names. */
+let gridsMinted = 0
+
 /**
  * The TM pane: a row per tape, a status line, a value line for a headered TM buffer, and the δ function as a
  * virtualized table.
@@ -201,6 +204,15 @@ export class TmPane implements EditablePane {
   #pendingScroll: number | null = null
   /** The DOM index of `this.#rows.children[0]`, within `#index`. See `#drawTable`'s doc. */
   #firstDrawn = 0
+  /**
+   * The grid's active row (spec §9.2), **AN INDEX INTO `#index`, NOT INTO THE DRAWN WINDOW** — accessibility
+   * item 3, which found a cursor designed against the rendered rows unable to move past them. The keys move it
+   * by index and scroll so it is drawn; a scroll the user or following makes carries it along instead, so
+   * `aria-activedescendant` always names a row that is in the DOM (`#drawTable`), as the λ view's does.
+   */
+  #active = 0
+  /** This pane's prefix for its cells' ids. */
+  #gridId = `tm-grid-${gridsMinted++}`
 
   /**
    * `panels` is the view's stored panel state (`workspace.ts`'s `Panels`), read once here; the rules panel
@@ -289,7 +301,8 @@ export class TmPane implements EditablePane {
 
     // CLICK A ROW, LIGHT ITS SOURCE. The table is 127,881 rows for `list60` and nothing in it says
     // what any row is FOR; this is the answer to that. Delegated from the container rather than bound
-    // per row, because rows are recreated on every draw.
+    // per row, because rows are recreated on every draw. The row clicked becomes the grid's active row,
+    // painted before the link's own draw so a pane with no `linkState` handler shows it too.
     this.#rows.addEventListener('click', (event) => {
       if (this.#index === null) return
       const target = event.target
@@ -300,6 +313,8 @@ export class TmPane implements EditablePane {
       if (i < 0) return
       const row = this.#index.row(this.#firstDrawn + i)
       if (row === null) return
+      this.#active = this.#firstDrawn + i
+      this.#drawTable()
       on.linkState?.(row.kind === 'state' ? row.id : row.stateId)
     })
 
@@ -326,6 +341,19 @@ export class TmPane implements EditablePane {
     })
     this.#rulesPanel.actions.append(this.#reattach)
 
+    // THE TABLE IS A GRID (spec §9.2, accessibility item 3): one tab stop, one `gridcell` per row, and a
+    // roving active row that `aria-activedescendant` names. `createPanel`, just above, made `#tableHost` a labelled
+    // region; it is the grid instead, still labelled by the panel's own toggle. The two wrappers between it and
+    // the rows are layout, so they say so to the accessibility tree.
+    this.#tableHost.setAttribute('role', 'grid')
+    this.#tableHost.tabIndex = 0
+    this.#spacer.setAttribute('role', 'none')
+    this.#rows.setAttribute('role', 'rowgroup')
+    this.#tableHost.addEventListener('keydown', (e) => this.#key(e, on.linkState))
+    // THE TABLE'S HEIGHT IS THE VIEW'S NOW, NOT THE VIEWPORT'S (spec §9.1): a divider drag, a panel opening
+    // beside it or a window resize changes it with no frame or scroll to redraw the window it draws.
+    new ResizeObserver(() => this.#drawTable()).observe(this.#tableHost)
+
     // **A TM VIEW'S OUTLINE IS ITS STATES** — measured against the real server, which answers a
     // `state` block per symbol at kind 5. Closed by default, like the source view's: a machine of
     // 1,199 states is the ordinary case, and a list of them above the tapes is not what a reader
@@ -373,6 +401,7 @@ export class TmPane implements EditablePane {
     // or may now name something else entirely.
     this.#linked = new Set()
     this.#focused = new Set()
+    this.#active = 0
     this.#follow.attach()
     // `onProgrammaticScroll` BEFORE the write, not after, and not omitted. Setting `scrollTop` fires a
     // `scroll` event; without a pending expectation `Follow` reads it as the user taking control and
@@ -791,6 +820,9 @@ export class TmPane implements EditablePane {
       ...tapeRows(frame, this.#names).map((row) => {
         const el = document.createElement('div')
         el.className = 'tape'
+        // A LABELLED GROUP (spec §9.3): where the head is and what it reads, said when a reader reaches the row.
+        el.setAttribute('role', 'group')
+        el.setAttribute('aria-label', tapeLabel(row))
         const label = document.createElement('span')
         label.className = 'tape-label'
         label.textContent = row.label
@@ -863,8 +895,11 @@ export class TmPane implements EditablePane {
     if (this.#index === null) {
       this.#rows.replaceChildren()
       this.#spacer.style.height = '0px'
+      this.#tableHost.removeAttribute('aria-rowcount')
+      this.#tableHost.removeAttribute('aria-activedescendant')
       return
     }
+    this.#tableHost.setAttribute('aria-rowcount', String(this.#index.rowCount))
 
     // THE SPACER CARRIES THE SCROLL RANGE, AND IT MUST STAY HONEST WHILE THE TABLE IS CLOSED. Setting
     // `scrollTop` CLAMPS to the element's current scroll height, so a spacer left at a previous
@@ -885,12 +920,12 @@ export class TmPane implements EditablePane {
     // all discarded on reopen, so this returns before the work as well as before the harm.
     if (!this.#rulesPanel.isOpen()) return
 
-    // `.state-table`'s `max-height: 40vh` is the ONLY thing bounding this box, and `clientHeight`
-    // reports what it actually laid out rather than what the stylesheet asked for. If the rule never
-    // reaches the page the box grows to its full content height — measured at 271,968px for 11,332
-    // rows — `spanned` covers the whole table, and every draw renders every row. The browser tier
-    // loads `style.css` (`tests/browser/setup.ts`) and asserts this box stays bounded, so that gap
-    // fails a test rather than silently costing O(rowCount) per frame.
+    // THE VIEW'S FLEX LAYOUT IS THE ONLY THING BOUNDING THIS BOX (`style.css`'s `.tm-pane > .panel` rules,
+    // spec §9.1), and `clientHeight` reports what it actually laid out rather than what the stylesheet asked
+    // for. If those rules never reach the page the box grows to its full content height — measured at
+    // 271,968px for 11,332 rows — `spanned` covers the whole table, and every draw renders every row. The
+    // browser tier loads `style.css` (`tests/browser/setup.ts`) and asserts this box stays bounded, so that
+    // gap fails a test rather than silently costing O(rowCount) per frame.
     const viewportHeight = this.#tableHost.clientHeight
     const marks = highlight(this.#index, this.#frame)
     // A PENDING LINK SCROLL WINS OVER THE FOLLOW TARGET FOR EXACTLY THIS DRAW, then is consumed —
@@ -919,6 +954,13 @@ export class TmPane implements EditablePane {
     }
 
     const w = visibleWindow(this.#index.rowCount, ROW_HEIGHT, viewportHeight, this.#tableHost.scrollTop, OVERSCAN)
+    // THE ACTIVE ROW COMES WITH THE VIEW: kept to the whole rows on screen, not the overscan, so whatever
+    // moved the view — following, a link, the user — leaves `aria-activedescendant` naming a drawn row.
+    if (viewportHeight > 0) {
+      const top = Math.ceil(this.#tableHost.scrollTop / ROW_HEIGHT)
+      const bottom = Math.max(top, Math.floor((this.#tableHost.scrollTop + viewportHeight) / ROW_HEIGHT) - 1)
+      this.#active = Math.min(Math.max(this.#active, top), bottom, this.#index.rowCount - 1)
+    }
     // THE VIRTUALIZATION OFFSET THE CLICK HANDLER NEEDS. `this.#rows.children[i]`'s row number is
     // `w.firstIndex + i`, not `i` — the rows array is windowed and `translateY`-offset, so recording
     // anything else here lights a plausible-looking but wrong block the moment the table is scrolled.
@@ -931,23 +973,100 @@ export class TmPane implements EditablePane {
       if (row === null) continue
       const el = document.createElement('div')
       el.className = 'state-row'
+      el.setAttribute('role', 'row')
+      // 1-BASED, as `aria-rowindex` is, and counted over the whole table: a screen reader says "row 40,213
+      // of 127,881" for a row that is one of forty in the DOM.
+      el.setAttribute('aria-rowindex', String(i + 1))
+      const text = document.createElement('div')
+      text.className = 'state-cell'
+      text.setAttribute('role', 'gridcell')
+      text.id = `${this.#gridId}-${i}`
       if (row.kind === 'state') {
         el.classList.add('is-state')
         if (row.accept) el.classList.add('is-accept')
-        el.textContent = row.name
+        text.textContent = row.name
       } else {
         el.classList.add('is-rule')
         const cell = (v: string | null) => v ?? '*'
-        el.textContent = `[${row.read.map(cell).join(' ')}] → [${row.write.map(cell).join(' ')}] ${row.moves.join(' ')} → ${
+        text.textContent = `[${row.read.map(cell).join(' ')}] → [${row.write.map(cell).join(' ')}] ${row.moves.join(' ')} → ${
           this.#program?.states[row.next]?.name ?? row.next
         }`
       }
-      if (marks !== null && i === marks.stateRow) el.classList.add('is-current')
-      if (marks !== null && i === marks.ruleRow) el.classList.add('is-firing')
+      el.append(text)
+      // THE CURRENT STATE IS SAID, NOT ONLY SHADED (spec §9.3, accessibility item 4); the next rule's words are
+      // generated content (`style.css`'s `.state-cell[data-marks]`), so they are read and are not the row's text.
+      if (marks !== null && i === marks.stateRow) {
+        el.classList.add('is-current')
+        el.setAttribute('aria-current', 'step')
+      }
+      if (marks !== null && i === marks.ruleRow) {
+        el.classList.add('is-next')
+        text.dataset.marks = 'fires next'
+      }
       if (this.#linked.has(i)) el.classList.add('is-linked')
       if (this.#focused.has(i)) el.classList.add('is-focus')
+      if (i === this.#active) el.classList.add('is-active')
       els.push(el)
     }
     this.#rows.replaceChildren(...els)
+    if (this.#active >= w.firstIndex && this.#active <= w.lastIndex) {
+      this.#tableHost.setAttribute('aria-activedescendant', `${this.#gridId}-${this.#active}`)
+    } else {
+      this.#tableHost.removeAttribute('aria-activedescendant')
+    }
+  }
+
+  /**
+   * The grid's keys (spec §9.2): ↑/↓, PgUp/PgDn and Home/End move the active row BY INDEX, and the table scrolls
+   * so it is drawn; Enter does what a click does.
+   *
+   * **A KEY THAT SCROLLS IS THE USER TAKING CONTROL**, so following is detached before the draw below — its
+   * `scroll` event comes a frame later, and a draw still following would put the view back on the current row
+   * and carry the active row with it. The λ view's keys do the same (`lambda-body.ts`).
+   */
+  #key(e: KeyboardEvent, linkState: ((state: number) => void) | undefined): void {
+    const index = this.#index
+    if (index === null || index.rowCount === 0) return
+    const page = Math.max(1, Math.floor(this.#tableHost.clientHeight / ROW_HEIGHT) - 1)
+    let next = this.#active
+    switch (e.key) {
+      case 'ArrowDown':
+        next += 1
+        break
+      case 'ArrowUp':
+        next -= 1
+        break
+      case 'PageDown':
+        next += page
+        break
+      case 'PageUp':
+        next -= page
+        break
+      case 'Home':
+        next = 0
+        break
+      case 'End':
+        next = index.rowCount - 1
+        break
+      case 'Enter': {
+        const row = index.row(this.#active)
+        if (row === null) return
+        e.preventDefault()
+        linkState?.(row.kind === 'state' ? row.id : row.stateId)
+        return
+      }
+      default:
+        return
+    }
+    e.preventDefault()
+    this.#active = Math.min(Math.max(next, 0), index.rowCount - 1)
+    const top = this.#active * ROW_HEIGHT
+    const from = this.#tableHost.scrollTop
+    const to = top < from ? top : Math.max(from, top + ROW_HEIGHT - this.#tableHost.clientHeight)
+    if (to !== from) {
+      this.#follow.detach()
+      this.#tableHost.scrollTop = to
+    }
+    this.#drawTable()
   }
 }
```

- [ ] **Step 4: Run the tests.**

Run: `cd web && pnpm exec vitest run --project node && pnpm exec vitest run --project browser tests/browser/tm-grid.test.ts tests/browser/hidden.test.ts tests/browser/marks.test.ts tests/browser/app.test.ts`
Expected: `Test Files  48 passed (48)`, `Tests  644 passed (644)`; then `Test Files  4 passed (4)`, `Tests  61 passed (61)`.

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (`pnpm exec vitest run --project browser tests/browser/tm-grid.test.ts tests/browser/hidden.test.ts` and, for `tape.ts`, the node file too):

| Sabotage | Fails |
|---|---|
| `tm-pane.ts`: `setAttribute('role', 'grid')` → `'region'` | `is one tab stop, counted over the whole table, with one cell per row` |
| `tm-pane.ts`: `aria-rowindex` `String(i + 1)` → `String(i)` | `is one tab stop, counted over the whole table, with one cell per row`, `moves the active row by index, past the rows the table has drawn`, `links the active row's state on Enter, as a click does` |
| `tm-pane.ts`: End's `rowCount - 1` → `rowCount - 2` | `moves the active row by index, past the rows the table has drawn` |
| `tm-pane.ts`: drop `this.#follow.detach()` from the key handler | `moves the active row by index, past the rows the table has drawn` |
| `tm-pane.ts`: drop the active row's clamp into the drawn window | `moves the active row by index, past the rows the table has drawn` — following again leaves it undrawn |
| `tm-pane.ts`: drop the `ResizeObserver` | `gives the rules two shares and the outline one, and redraws the rows when its share changes` |
| `style.css`: the rules panel's `flex: 2 1 0` → `flex: 1 1 0` | `gives the rules two shares and the outline one, and redraws the rows when its share changes` |
| `tm-pane.ts`: Enter returns without `linkState` | `links the active row's state on Enter, as a click does` |
| `tm-pane.ts`: drop `aria-current` | `says which state is current and which rule fires next` |
| `tm-pane.ts`: `data-marks` → `text.append(' fires next')` | `says which state is current and which rule fires next` |
| `tm-pane.ts`: drop the tape's `role="group"` | `are labelled groups that say where each head is and what it reads` |
| `tape.ts`: read `cells[headIndex + 1]` | 4 cases, among them `says the tape, the head's cell on the whole tape, and what it reads` |
| `style.css`: drop `.outline[hidden]` | `leaves nothing on screen that is hidden, through every panel and a copy of each view`, `gives the rules two shares and the outline one, and redraws the rows when its share changes` |
| `style.css`: drop `:not([hidden])` from the outline panel's flex rule | `leaves nothing on screen that is hidden, through every panel and a copy of each view` |

- [ ] **Step 6: Run the gates.**

Run: `cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings`
Expected: both exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The rule table is a grid sharing the view's height; the next rule is said, and the tapes are labelled

The TM view's open panels share its height through flex — rules two shares, outline one — so the
table's height is the view's and not 40vh of the window (spec §9.1). The table is an ARIA grid: one
tab stop, a gridcell per row, an active row by index that the keys move past the drawn window, Enter
to link (§9.2). The current state's row carries aria-current and the rule about to fire says so,
renamed from firing to next (§9.3); each tape is a group labelled with its head's cell and symbol.
`.outline { display: flex }` had defeated `hidden` on main, so a closed outline's list stayed on
screen; `hidden.test.ts` now looks for that class across the app.
EOF
```

### Task 4: The diagram's pure model: grouping, and the program level's rows, arcs and chips

**Files:**
- Create: `web/src/program-level.ts`
- Create: `web/src/state-groups.ts`
- Create: `web/tests/node/program-level.test.ts`
- Create: `web/tests/node/state-groups.test.ts`
- Create: `web/tests/node/tm-machines.ts`

**Interfaces:**
- Produces: `state-groups.ts` — `Tier = 'instr' | 'name' | 'none'`, `Group { name, instr, runtime, count, first, steps, overflow, targets, sources }`, `Groups { tier, groups, groupOf: Int32Array }`, `segmentOf`, `stepOf`, `tierOf(p)`, `groupStates(p)`; `program-level.ts` — `Edges = 'arcs' | 'chips'`, `ProgramRow` (`label` / `group` / `steps` / `heading`), `Arc { from, to, lane }`, `programRows(g, labels, edges, open)`, `arcsOf(g)`, `chipName(g, labels, group)`, `chipsOf(g, labels, group) -> { to, from }`.
- No consumer until Task 5.

**A FALL-THROUGH IS ONLY BETWEEN TWO ROWS ONE ABOVE THE OTHER.** The last instruction's row is not above the first runtime routine's — *arcs* draws the routines in a column, *chips* under a heading — so an edge from `halt`'s instruction into the `halt` state stays an edge. The first draft dropped it.

**NAME GROUPS ARE ORDERED BY FIRST REACH FROM THE START**, depth first, rules in order; groups the start never reaches follow in the order their first state appears. The lowering allocates every entry state (`pcN`) before any gadget, so ordered by appearance a copy of `fact(3)` put all 21 entries above all their gadgets and joined each to its own with a long arc: 48 arcs over 45 rows, where the instruction tier draws 5. Ordered by reach it is the same 45 rows and 9 arcs, each entry followed by its gadget (spec amendment 15, measured by §14.6's probe). `tm-machines.ts` allocates in the lowering's order for that reason — its first version did not, and could not see this.

**THE OVERFLOW GUARD IS NAMED `overflow`, HAS NO RULE, AND DOES NOT ACCEPT** — all three. A machine someone wrote may name a working state `overflow`, and that one is a row.

- [ ] **Step 1: Write the failing tests.** All three test files are new; `tm-machines.ts` is their shared fixture.

Create `web/tests/node/program-level.test.ts`:

```ts file=web/tests/node/program-level.test.ts
import { describe, expect, it } from 'vitest'
import { arcsOf, chipName, chipsOf, programRows } from '../../src/program-level'
import { groupStates } from '../../src/state-groups'
import type { TmProgram } from '../../src/types'
import { COMPILED, COPY, state } from './tm-machines'

const compiled = groupStates(COMPILED)
const LABELS = COMPILED.labels

/** A row as a word, so a whole layout reads as one line: `L:skip`, `pc3`, `steps:pc1`, `H:runtime`. */
const shown =
  (g = compiled) =>
  (r: ReturnType<typeof programRows>[number]) =>
    r.kind === 'label'
      ? `L:${r.name}`
      : r.kind === 'heading'
        ? `H:${r.name}`
        : r.kind === 'steps'
          ? `steps:${g.groups[r.group]?.name}`
          : (g.groups[r.group]?.name ?? '?')

describe('the rows', () => {
  it("puts a label above the instruction it names, and leaves the runtime routines to *arcs*' side column", () => {
    expect(programRows(compiled, LABELS, 'arcs', null).map(shown())).toEqual(['pc0', 'pc1', 'pc2', 'L:f', 'pc3'])
  })

  it('draws the runtime routines as rows under a heading in *chips*', () => {
    expect(programRows(compiled, LABELS, 'chips', null).map(shown())).toEqual([
      'pc0',
      'pc1',
      'pc2',
      'L:f',
      'pc3',
      'H:runtime',
      'halt',
      'ret',
      'rf9',
    ])
  })

  it('opens the current group onto a row of its sub-steps, under it', () => {
    expect(programRows(compiled, LABELS, 'arcs', 1).map(shown())).toEqual([
      'pc0',
      'pc1',
      'steps:pc1',
      'pc2',
      'L:f',
      'pc3',
    ])
  })

  it('prints a label one past the last instruction after it, as `print_asm` does', () => {
    const trailing = [['end', 4]] as const
    expect(programRows(compiled, trailing, 'arcs', null).map(shown()).at(-1)).toBe('L:end')
  })

  it('draws every name group as a row, in order, and no labels, without instructions to hang them on', () => {
    const copy = groupStates(COPY)
    expect(programRows(copy, [], 'arcs', null).map(shown(copy))).toEqual(copy.groups.map((g) => g.name))
  })
})

describe("*arcs*' lanes", () => {
  it('draws every edge between two listing rows, and none to a runtime routine', () => {
    // The call, pc1 -> pc3; pc2 -> halt and pc3 -> ret go to runtime routines, and pc0 -> pc1 falls through.
    expect(arcsOf(compiled)).toEqual([{ from: 1, to: 3, lane: 0 }])
  })

  /**
   * Four instructions: pc0 jumps to pc3, pc2 back to pc1, and pc3 halts — spans 0..3 and 1..2, which overlap.
   * States in the lowering's order: entries first.
   */
  const OVERLAPPING: TmProgram = {
    ...COMPILED,
    states: [
      state('halt', null),
      state('overflow', null),
      state('pc0', 0, 5),
      state('pc1', 1, 4),
      state('pc2', 2, 3),
      state('pc3', 3, 0),
    ],
  }

  it('gives the shortest span the innermost lane, and a lane to each overlapping span', () => {
    const arcs = arcsOf(groupStates(OVERLAPPING))
    expect(arcs.find((a) => a.from === 2)?.lane).toBe(0)
    expect(arcs.find((a) => a.from === 0)?.lane).toBe(1)
  })

  it('lets spans that do not overlap share a lane', () => {
    // Four instructions, each jumping back one: 1 -> 0 and 3 -> 2 are two arcs whose spans do not overlap.
    const p: TmProgram = {
      ...COMPILED,
      states: [
        state('halt', null),
        state('overflow', null),
        state('pc0', 0, 3),
        state('pc1', 1, 2),
        state('pc2', 2, 5),
        state('pc3', 3, 4),
      ],
    }
    const arcs = arcsOf(groupStates(p))
    expect(arcs.map((a) => [a.from, a.to, a.lane])).toEqual([
      [1, 0, 0],
      [3, 2, 0],
    ])
  })
})

describe("*chips*' text", () => {
  it('names a target by the label its jump names, and a source by its row', () => {
    // pc1's `call f` goes to pc3, which the label `f` names.
    expect(chipName(compiled, LABELS, 3)).toBe('f')
    expect(chipsOf(compiled, LABELS, 1)).toEqual({ to: '→ f', from: '' })
    expect(chipsOf(compiled, LABELS, 3)).toEqual({ to: '→ ret', from: '← pc1' })
  })

  it('says nothing for a row with no edge but a fall-through', () => {
    expect(chipsOf(compiled, LABELS, 0)).toEqual({ to: '', from: '' })
  })

  it('reads a runtime routine as a row like any other', () => {
    const ret = compiled.groups.findIndex((g) => g.name === 'ret')
    expect(chipsOf(compiled, LABELS, ret)).toEqual({ to: '→ rf9', from: '← pc3' })
  })
})
```

Create `web/tests/node/state-groups.test.ts`:

```ts file=web/tests/node/state-groups.test.ts
import { describe, expect, it } from 'vitest'
import { groupStates, segmentOf, stepOf, tierOf } from '../../src/state-groups'
import type { TmProgram } from '../../src/types'
import { COMPILED, COPY, go, state } from './tm-machines'

describe('names', () => {
  it('splits a state name into its group and its sub-step', () => {
    expect(segmentOf('cmp6.m1.c.c.cwb')).toBe('cmp6')
    expect(stepOf('cmp6.m1.c.c.cwb')).toBe('m1')
    expect(segmentOf('pc4')).toBe('pc4')
    expect(stepOf('pc4')).toBe('pc4')
  })
})

describe('the three tiers (spec §7)', () => {
  it('groups by instruction when any state carries one', () => {
    expect(tierOf(COMPILED)).toBe('instr')
  })

  it('groups by name when no state does but a name has a dot', () => {
    expect(tierOf(COPY)).toBe('name')
  })

  it('does not group a machine whose names carry no dots either', () => {
    const flat: TmProgram = { ...COPY, states: [state('q0', null, 1), state('q1', null)] }
    expect(tierOf(flat)).toBe('none')
    expect(groupStates(flat).groups).toEqual([])
  })
})

describe('by instruction', () => {
  const { groups, groupOf } = groupStates(COMPILED)
  const byName = (name: string) => groups.findIndex((g) => g.name === name)

  it('gives every instruction a row, in listing order, and the runtime routines rows after them', () => {
    expect(groups.map((g) => g.name)).toEqual(['pc0', 'pc1', 'pc2', 'pc3', 'halt', 'ret', 'rf9'])
    expect(groups.map((g) => g.instr)).toEqual([0, 1, 2, 3, null, null, null])
    expect(groups.map((g) => g.runtime)).toEqual([false, false, false, false, true, true, true])
  })

  it('counts states, keeps the first for linking, and lists the sub-steps in state order', () => {
    const mov = groups[0]
    expect(mov?.count).toBe(4)
    expect(mov?.first).toBe(2)
    expect(mov?.steps).toEqual(['pc0', 'c', 'd'])
  })

  it('makes the overflow guard a badge on the rows that reach it, not a row', () => {
    expect(groupOf[1]).toBe(-1)
    expect(groups.map((g) => g.overflow)).toEqual([true, false, false, false, false, false, false])
  })

  it('keeps a call and the runtime edges, and leaves a fall-through implied', () => {
    expect(groups[0]?.targets).toEqual([]) // mov falls through to the call
    expect(groups[1]?.targets).toEqual([3]) // the call
    expect(groups[2]?.targets).toEqual([byName('halt')]) // into a runtime routine: next in index, not in rows
    expect(groups[3]?.targets).toEqual([byName('ret')])
    // A runtime routine's edge to the next runtime row is kept: those rows are not one above the other.
    expect(groups[byName('ret')]?.targets).toEqual([byName('rf9')])
    expect(groups[byName('rf9')]?.targets).toEqual([2])
  })

  it('records every edge from both ends', () => {
    expect(groups[3]?.sources).toEqual([1])
    expect(groups[2]?.sources).toEqual([byName('rf9')])
    expect(groups[byName('halt')]?.sources).toEqual([2])
  })

  it('takes a state named overflow that has rules for a working state, not the guard', () => {
    // The guard has no rule and does not accept; a machine someone wrote may name a state `overflow` too.
    const named: TmProgram = { ...COPY, states: [state('a.x', null, 1), state('overflow', null, 0)], start: 0 }
    const g = groupStates(named)
    expect(g.groups.map((x) => x.name)).toEqual(['a', 'overflow'])
    expect(g.groups[0]?.overflow).toBe(false)
  })
})

describe('by name', () => {
  const { groups } = groupStates(COPY)

  it('orders the rows by first reach from the start, so each gadget follows the entry that falls into it', () => {
    // By appearance the entries would all come first — pc0 pc1 pc2 pc3 ret rf9 mv0s1 pf2 — each far from its gadget.
    expect(groups.map((g) => g.name)).toEqual(['pc0', 'mv0s1', 'pc1', 'pf2', 'pc3', 'ret', 'rf9', 'pc2', 'halt'])
    expect(groups.every((g) => !g.runtime && g.instr === null)).toBe(true)
  })

  it('leaves every edge to the next row implied — here every edge the copy has', () => {
    expect(groups.map((g) => g.targets)).toEqual(groups.map(() => []))
  })

  it('puts a group the start never reaches after the reached ones, in the order its first state appears', () => {
    const stray: TmProgram = {
      ...COPY,
      states: [...COPY.states, { ...state('zz.a', null), rules: [go(COPY.states.length)] }, state('yy.b', null)],
    }
    const names = groupStates(stray).groups.map((g) => g.name)
    expect(names.slice(-2)).toEqual(['zz', 'yy'])
  })
})
```

Create `web/tests/node/tm-machines.ts`:

```ts file=web/tests/node/tm-machines.ts
import type { RuleView, StateView, TmProgram } from '../../src/types'

/** Machines for the state diagram's pure modules: `state-groups.test.ts`, `program-level.test.ts`, `local-level.test.ts`. */

/** A rule that touches no tape and goes to state `next`. */
export const go = (next: number): RuleView => ({ read: [null], write: [null], moves: ['S'], next })

/** A state with one such rule per target, built for instruction `instr`. `halt` accepts; nothing else does. */
export const state = (name: string, instr: number | null, ...next: number[]): StateView => ({
  name,
  accept: name === 'halt',
  rules: next.map(go),
  instr,
})

/**
 * A program of four instructions — `pc0 mov`, `pc1 call f`, `pc2 halt`, and `f: pc3 ret` — **IN THE ORDER THE
 * LOWERING ALLOCATES STATES**: every instruction's entry state first, then the shared return handler and `halt`,
 * then the gadgets, each built for the instruction whose entry falls into it.
 *
 *  0 halt                                          runtime
 *  1 overflow                                      the guard: no rule, not accepting — a badge, not a row
 *  2 pc0          -> mv0s1.c                       mov's entry
 *  3 pc1          -> pf2.tag                       call's entry
 *  4 pc2          -> halt                          into a runtime routine
 *  5 pc3          -> ret                           f's `ret`, into the runtime handler
 *  6 ret          -> rf9.p1                        runtime: to the next runtime row, which is NOT a fall-through
 *  7 rf9.p1       -> pc2                           the return lands after the call
 *  8 mv0s1.c      -> mv0s1.d, overflow
 *  9 mv0s1.d      -> pc1                           a fall-through: 0 -> 1
 * 10 pf2.tag      -> pc3                           the call: an arc from 1 to 3
 * 11 mv0s1.c.back -> mv0s1.d                       a second state in sub-step `c`, which the sub-steps list once
 */
const NAMES = [
  'halt',
  'overflow',
  'pc0',
  'pc1',
  'pc2',
  'pc3',
  'ret',
  'rf9.p1',
  'mv0s1.c',
  'mv0s1.d',
  'pf2.tag',
  'mv0s1.c.back',
]
const at = (name: string) => NAMES.indexOf(name)
const built = (name: string, instr: number | null, ...next: string[]) => state(name, instr, ...next.map(at))

export const COMPILED: TmProgram = {
  states: [
    built('halt', null),
    built('overflow', null),
    built('pc0', 0, 'mv0s1.c'),
    built('pc1', 1, 'pf2.tag'),
    built('pc2', 2, 'halt'),
    built('pc3', 3, 'ret'),
    built('ret', null, 'rf9.p1'),
    built('rf9.p1', null, 'pc2'),
    built('mv0s1.c', 0, 'mv0s1.d', 'overflow'),
    built('mv0s1.d', 0, 'pc1'),
    built('pf2.tag', 1, 'pc3'),
    built('mv0s1.c.back', 0, 'mv0s1.d'),
  ],
  alphabet: [],
  tapes: 1,
  width: 4,
  start: at('pc0'),
  listing: ['mov\tr0, a0', 'call\tf', 'halt', 'ret'],
  labels: [['f', 3]],
}

/** The same machine as a copy would hold it: no map, so no `instr`, no listing. */
export const COPY: TmProgram = {
  ...COMPILED,
  states: COMPILED.states.map((s) => ({ ...s, instr: null })),
  listing: [],
  labels: [],
}
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/state-groups.test.ts tests/node/program-level.test.ts`
Expected: FAIL — `Test Files  2 failed (2)`, each on `Cannot find module` `../../src/program-level`, `../../src/state-groups`.

- [ ] **Step 3: Write the code.**

Create `web/src/program-level.ts`:

```ts file=web/src/program-level.ts
import type { Groups } from './state-groups'

/**
 * The state diagram's program level as data (Plan 7 part 4, spec §8 and amendments 9 and 11): which rows it
 * shows, which arcs *arcs* draws and in which lanes, and what *chips* says. Pure, so the DOM that draws it
 * (`state-diagram.ts`) holds no arithmetic a node test cannot reach.
 */

/** How the program level draws the edges between its rows: spec amendment 11's two renderings. */
export type Edges = 'arcs' | 'chips'

/** One row of the program level. Every row is `ROW_HEIGHT` tall, so the rows virtualize as the rule table's do. */
export type ProgramRow =
  /** A label from the asm listing, above the instruction it names (amendment 9). */
  | { readonly kind: 'label'; readonly name: string }
  /** One group: an instruction, a runtime routine, or a name group. */
  | { readonly kind: 'group'; readonly group: number }
  /** The current group's sub-steps, the row under it — spec §8's "opens to show its sub-steps". */
  | { readonly kind: 'steps'; readonly group: number }
  /** *Chips*' heading over the runtime routines, which *arcs* draws in a column of their own instead. */
  | { readonly kind: 'heading'; readonly name: string }

/** An arc in *arcs*' gutter: a jump or call between two rows of the listing, by group, and its lane. */
export type Arc = { readonly from: number; readonly to: number; readonly lane: number }

type Labels = readonly (readonly [string, number])[]

/**
 * The rows, in order, for `edges`, with `open`'s sub-steps under it.
 *
 * **AN INSTRUCTION'S LABELS COME FIRST**, in `labels` order, as `print_asm` prints them; a label one past the
 * last instruction is printed after it, and so drawn after it. **THE RUNTIME ROUTINES ARE ROWS ONLY IN *CHIPS*,**
 * under a `runtime` heading: *arcs* draws them in a side column, where their connectors can reach them.
 */
export function programRows(g: Groups, labels: Labels, edges: Edges, open: number | null): ProgramRow[] {
  const rows: ProgramRow[] = []
  const push = (group: number): void => {
    rows.push({ kind: 'group', group })
    if (group === open) rows.push({ kind: 'steps', group })
  }
  if (g.tier !== 'instr') {
    for (let i = 0; i < g.groups.length; i += 1) push(i)
    return rows
  }
  const at = new Map<number, string[]>()
  for (const [name, index] of labels) at.set(index, [...(at.get(index) ?? []), name])
  const listed = g.groups.filter((x) => !x.runtime).length
  for (let i = 0; i <= listed; i += 1) {
    for (const name of at.get(i) ?? []) rows.push({ kind: 'label', name })
    if (i < listed) push(i)
  }
  if (edges === 'chips' && listed < g.groups.length) {
    rows.push({ kind: 'heading', name: 'runtime' })
    for (let i = listed; i < g.groups.length; i += 1) push(i)
  }
  return rows
}

/**
 * The arcs *arcs* draws: every edge between two rows of the listing, each in the innermost lane its span leaves
 * free. A group's own `targets` already leave out fall-throughs and `overflow`, so every one of them is an arc.
 *
 * **SHORTEST SPANS TAKE THE INNERMOST LANES**, so a short jump sits beside its rows and a long call runs outside
 * it, and two arcs share a lane only where their spans do not overlap. Deterministic: ties break on the lower
 * row, then the source. The lanes are assigned once per machine, since the spans are the listing's, not the
 * run's. `map_fold`'s 107 instructions need 7 lanes (spec §14.1).
 */
export function arcsOf(g: Groups): Arc[] {
  const spans: { from: number; to: number; lo: number; hi: number }[] = []
  for (const [from, group] of g.groups.entries()) {
    if (group.runtime) continue
    for (const to of group.targets) {
      if (g.groups[to]?.runtime ?? true) continue
      spans.push({ from, to, lo: Math.min(from, to), hi: Math.max(from, to) })
    }
  }
  spans.sort((a, b) => a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo || a.from - b.from)
  const lanes: { lo: number; hi: number }[][] = []
  return spans.map(({ from, to, lo, hi }) => {
    let lane = 0
    while ((lanes[lane] ?? []).some((s) => !(hi < s.lo || lo > s.hi))) lane += 1
    const taken = lanes[lane] ?? []
    taken.push({ lo, hi })
    lanes[lane] = taken
    return { from, to, lane }
  })
}

/** What a chip calls `group`: an instruction by the first label that precedes it, when one does, else its name. */
export function chipName(g: Groups, labels: Labels, group: number): string {
  const x = g.groups[group]
  if (x === undefined) return ''
  const label = x.instr === null ? undefined : labels.find(([, index]) => index === x.instr)
  return label?.[0] ?? x.name
}

/**
 * *Chips*' text for one row: `→ skip1` for where its rules go and `← pc13 pc19` for where they come from.
 *
 * **A TARGET IS NAMED AS ITS JUMP NAMES IT** — by its label, which is what the instruction's operand says — and a
 * source by its row's own name, since nothing jumps *from* a label. In *arcs* the same text is the arcs' words
 * for a screen reader, visually hidden (amendment 11).
 */
export function chipsOf(g: Groups, labels: Labels, group: number): { readonly to: string; readonly from: string } {
  const x = g.groups[group]
  if (x === undefined) return { to: '', from: '' }
  const to = x.targets.map((t) => chipName(g, labels, t)).join(' ')
  const from = x.sources.map((s) => g.groups[s]?.name ?? '').join(' ')
  return { to: to === '' ? '' : `→ ${to}`, from: from === '' ? '' : `← ${from}` }
}
```

Create `web/src/state-groups.ts`:

```ts file=web/src/state-groups.ts
import type { TmProgram } from './types'

/**
 * How a machine's states group into the state diagram's program level (Plan 7 part 4, spec §7): by the asm
 * instruction each was built for, by the first segment of its name, or not at all.
 *
 * **CHOSEN PER MACHINE, BY WHAT THE MACHINE CARRIES.** A compiled program's states carry `instr`, from the map
 * the session built at the width its run fitted (spec amendment 14). A copy or a reduced file has no map, so its
 * states carry none — but a compiled machine's names are hierarchical (`cmp6.m1.c.c.cwb`), so the first segment
 * still groups one gadget's states. A machine with neither has no program level (`none`).
 */
export type Tier = 'instr' | 'name' | 'none'

/** One row of the program level: one instruction, one runtime routine, or one name group. */
export type Group = {
  /** `pc4` for an instruction — the name its entry state carries — and the first name segment otherwise. */
  readonly name: string
  /** The instruction's line of `TmProgram.listing`, or `null` for a runtime routine and for any name group. */
  readonly instr: number | null
  /**
   * A routine billed to no instruction — the shared return handler, `halt` — which *arcs* draws in a side column
   * and *chips* under a `runtime` heading. Only the `instr` tier has them: without instructions there is nothing
   * for a routine to be outside of.
   */
  readonly runtime: boolean
  /** How many states the group holds. */
  readonly count: number
  /** The group's lowest state id: what a click on its row links, as a click on that state's row would. */
  readonly first: number
  /** The second segments of its states' names, each once, in state order — the sub-steps (`m1 z1 pk …`). */
  readonly steps: readonly string[]
  /** Whether any of its rules goes to `overflow`: spec §8's ⚠ badge, drawn in place of an edge. */
  readonly overflow: boolean
  /** The groups its rules go to, by index, ascending — every edge but a fall-through and one into `overflow`. */
  readonly targets: readonly number[]
  /** The groups whose rules come to it, by index, ascending, under the same two exclusions. */
  readonly sources: readonly number[]
}

export type Groups = {
  readonly tier: Tier
  /**
   * In row order: the instructions in listing order and then the runtime routines; or the name groups in the order
   * the machine first reaches them from its start (`groupStates`' doc says why).
   */
  readonly groups: readonly Group[]
  /**
   * `groupOf[state]` is the state's group, or `-1` for the `overflow` state, which is a badge on the rows that
   * reach it rather than a row of its own.
   */
  readonly groupOf: Int32Array
}

/**
 * The overflow guard: the state `Builder::overflow` builds in the core — named `overflow`, with no rule, not
 * accepting. **ALL THREE, NOT THE NAME ALONE**: a machine someone wrote may name a working state `overflow`, and that
 * one is a row like any other.
 */
function isGuard(state: TmProgram['states'][number]): boolean {
  return state.name === 'overflow' && state.rules.length === 0 && !state.accept
}

/** A state's first name segment: `cmp6` for `cmp6.m1.c.c.cwb`, the whole name when it has no dot. */
export function segmentOf(name: string): string {
  const dot = name.indexOf('.')
  return dot < 0 ? name : name.slice(0, dot)
}

/** A state's sub-step: its second name segment, or the whole name when it has none (`pc4`, `halt`). */
export function stepOf(name: string): string {
  const parts = name.split('.')
  return parts[1] ?? name
}

/** Which tier `p` groups by: instructions if any state carries one, names if any name has a dot, else none. */
export function tierOf(p: TmProgram): Tier {
  if (p.states.some((s) => s.instr !== null)) return 'instr'
  if (p.states.some((s) => s.name.includes('.'))) return 'name'
  return 'none'
}

/**
 * Group `p`'s states into rows, and gather the edges between rows.
 *
 * **O(STATES + RULES), ONCE PER COMPILE.** `list150` under binary is 197,265 states (spec §14.1), and this runs
 * when a machine arrives, never per step: only the highlight moves per step.
 *
 * **AN INSTRUCTION ALWAYS HAS A ROW**, in listing order, so a row's index in the `instr` tier is its instruction's
 * line — which is what lets `listing[g]` and the arcs' spans be read straight off a group index. The runtime rows
 * follow them, in the order their first state appears.
 *
 * **A FALL-THROUGH IS NOT AN EDGE HERE**: a rule into the very next row is implied by row order (spec amendment
 * 11), in either tier. Neither is a rule into `overflow`, which sets its row's `overflow` badge instead.
 *
 * **NAME GROUPS ARE ORDERED BY FIRST REACH FROM THE START STATE**, depth first, rules in order, and any group the
 * start does not reach follows in the order its first state appears. The lowering allocates every instruction's
 * entry state (`pcN`) before any gadget, so ordered by appearance a copy of `fact(3)` put all 21 entries above all
 * their gadgets and joined each to its own with a long arc: 48 arcs over its 45 rows, where the instruction tier
 * draws 5. Ordered by reach, each gadget follows the entry that falls into it, that edge is a fall-through again,
 * and the same copy draws 9 (spec amendment 15).
 */
export function groupStates(p: TmProgram): Groups {
  const tier = tierOf(p)
  const groupOf = new Int32Array(p.states.length).fill(-1)
  if (tier === 'none') return { tier, groups: [], groupOf }

  const names: string[] = []
  const instrs: (number | null)[] = []
  const runtime: boolean[] = []
  const byKey = new Map<string, number>()
  if (tier === 'instr') {
    for (let i = 0; i < p.listing.length; i += 1) {
      names.push(`pc${i}`)
      instrs.push(i)
      runtime.push(false)
    }
  }
  for (const [s, state] of p.states.entries()) {
    if (isGuard(state)) continue
    if (tier === 'instr' && state.instr !== null && state.instr < p.listing.length) {
      groupOf[s] = state.instr
      continue
    }
    const key = segmentOf(state.name)
    let g = byKey.get(key)
    if (g === undefined) {
      g = names.length
      byKey.set(key, g)
      names.push(key)
      instrs.push(null)
      runtime.push(tier === 'instr')
    }
    groupOf[s] = g
  }
  if (tier === 'name') reorderByReach(p, names, groupOf)

  const n = names.length
  const count = new Array<number>(n).fill(0)
  const first = new Array<number>(n).fill(-1)
  const steps: string[][] = Array.from({ length: n }, () => [])
  const overflow = new Array<boolean>(n).fill(false)
  const targets: Set<number>[] = Array.from({ length: n }, () => new Set())
  const sources: Set<number>[] = Array.from({ length: n }, () => new Set())
  const overflowState = p.states.findIndex(isGuard)
  for (const [s, state] of p.states.entries()) {
    const g = groupOf[s] as number
    if (g < 0) continue
    count[g] = (count[g] as number) + 1
    if (first[g] === -1) first[g] = s
    const step = stepOf(state.name)
    const own = steps[g] as string[]
    if (!own.includes(step)) own.push(step)
    for (const rule of state.rules) {
      if (rule.next === overflowState) {
        overflow[g] = true
        continue
      }
      const h = groupOf[rule.next] ?? -1
      if (h < 0 || h === g) continue
      // A FALL-THROUGH ONLY BETWEEN ROWS THAT SIT ONE ABOVE THE OTHER: the last instruction's row is not above the
      // first runtime routine's — *arcs* draws the routines in a column of their own, *chips* under a heading.
      if (h === g + 1 && !(runtime[g] ?? false) && !(runtime[h] ?? false)) continue
      ;(targets[g] as Set<number>).add(h)
      ;(sources[h] as Set<number>).add(g)
    }
  }

  const ascending = (set: Set<number>) => [...set].sort((a, b) => a - b)
  const groups: Group[] = names.map((name, g) => ({
    name,
    instr: instrs[g] ?? null,
    runtime: runtime[g] ?? false,
    count: count[g] ?? 0,
    first: first[g] ?? -1,
    steps: steps[g] ?? [],
    overflow: overflow[g] ?? false,
    targets: ascending(targets[g] as Set<number>),
    sources: ascending(sources[g] as Set<number>),
  }))
  return { tier, groups, groupOf }
}

/**
 * Put `names` in the order the machine first reaches each group from `p.start`, depth first and rules in order, the
 * unreached after them as they were, and renumber `groupOf` to match. In place.
 */
function reorderByReach(p: TmProgram, names: string[], groupOf: Int32Array): void {
  const next: number[][] = names.map(() => [])
  for (const [s, state] of p.states.entries()) {
    const g = groupOf[s] ?? -1
    if (g < 0) continue
    for (const rule of state.rules) {
      const h = groupOf[rule.next] ?? -1
      if (h >= 0 && h !== g && !(next[g] as number[]).includes(h)) (next[g] as number[]).push(h)
    }
  }
  const order: number[] = []
  const seen = new Set<number>()
  const start = groupOf[p.start] ?? -1
  const stack = start < 0 ? [] : [start]
  while (stack.length > 0) {
    const g = stack.pop() as number
    if (seen.has(g)) continue
    seen.add(g)
    order.push(g)
    // Pushed in reverse, so the first rule's target is visited first.
    for (const h of [...(next[g] as number[])].reverse()) if (!seen.has(h)) stack.push(h)
  }
  for (let g = 0; g < names.length; g += 1) if (!seen.has(g)) order.push(g)
  const rank = new Int32Array(names.length)
  for (const [i, g] of order.entries()) rank[g] = i
  const renamed = order.map((g) => names[g] as string)
  names.splice(0, names.length, ...renamed)
  for (let s = 0; s < groupOf.length; s += 1) {
    const g = groupOf[s] as number
    if (g >= 0) groupOf[s] = rank[g] as number
  }
}
```

- [ ] **Step 4: Run the tests.**

Run: `cd web && pnpm exec vitest run --project node`
Expected: `Test Files  50 passed (50)`, `Tests  668 passed (668)`.

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (`pnpm exec vitest run --project node tests/node/state-groups.test.ts tests/node/program-level.test.ts`):

| Sabotage | Fails |
|---|---|
| `state-groups.ts`: test names before instructions in `tierOf` | 13 cases, among them `puts a label above the instruction it names, and leaves the runtime routines to *arcs*' side column` |
| `state-groups.ts`: `rule.next === overflowState` → `… && false` | `makes the overflow guard a badge on the rows that reach it, not a row` |
| `state-groups.ts`: drop the fall-through rule | 7 cases, among them `draws every edge between two listing rows, and none to a runtime routine` |
| `state-groups.ts`: a fall-through between any two adjacent indices, runtime or not | `reads a runtime routine as a row like any other`, `keeps a call and the runtime edges, and leaves a fall-through implied` |
| `state-groups.ts`: push every sub-step, repeats included | `counts states, keeps the first for linking, and lists the sub-steps in state order` |
| `program-level.ts`: a label after its instruction | `puts a label above the instruction it names, and leaves the runtime routines to *arcs*' side column`, `draws the runtime routines as rows under a heading in *chips*`, `opens the current group onto a row of its sub-steps, under it` |
| `program-level.ts`: runtime rows in *arcs* too | `puts a label above the instruction it names, and leaves the runtime routines to *arcs*' side column`, `opens the current group onto a row of its sub-steps, under it`, `` prints a label one past the last instruction after it, as `print_asm` does `` |
| `program-level.ts`: sort spans longest first | `gives the shortest span the innermost lane, and a lane to each overlapping span` |
| `program-level.ts`: never share a lane | `lets spans that do not overlap share a lane` |
| `program-level.ts`: `chipName` returns the row's name | `names a target by the label its jump names, and a source by its row` |
| `state-groups.ts`: skip `reorderByReach` | `orders the rows by first reach from the start, so each gadget follows the entry that falls into it`, `leaves every edge to the next row implied — here every edge the copy has` |
| `state-groups.ts`: `isGuard` checks the name alone | `takes a state named overflow that has rules for a working state, not the guard` |

- [ ] **Step 6: Run the gates.**

Run: `cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings`
Expected: both exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The state diagram's model: groups by instruction or by name, rows, arcs and chips

Pure modules, no view yet. A machine's states group by the instruction each was built for, by the
first segment of their names when none carries one, or not at all (spec §7). Each group is a row of
the program level with its count, its sub-steps and the edges to other rows; a rule into overflow is a
badge and a fall-through is implied (amendment 11). The rows put each label above the instruction it
names (amendment 9); arcs get the innermost free lane, shortest spans first.
EOF
```

### Task 5: The state diagram's program level: arcs and chips, following, linking, and nothing off the page

**Files:**
- Modify: `web/src/main.ts`
- Modify: `web/src/pane-chrome.ts`
- Modify: `web/src/pane-host.ts`
- Create: `web/src/state-diagram.ts`
- Modify: `web/src/state-table.ts`
- Modify: `web/src/style.css`
- Modify: `web/src/tm-pane.ts`
- Modify: `web/src/workspace.ts`
- Modify: `web/tests/browser/hidden-views.test.ts`
- Create: `web/tests/browser/state-diagram.test.ts`
- Create: `web/tests/browser/tm-follow-clamp.test.ts`
- Modify: `web/tests/browser/tm-grid.test.ts`
- Modify: `web/tests/node/state-table.test.ts`
- Modify: `web/tests/node/workspace.test.ts`

**Interfaces:**
- Consumes: Task 4's `groupStates`, `programRows`, `arcsOf`, `chipsOf`, `stepOf`.
- Produces: `StateDiagram` (`state-diagram.ts`): `el`, `following`, `setProgram(p)`, `setEdges(edges)`, `render(frame)`, `setLinked(states)`, `attach()`, `redraw()`; `DiagramEvents { link(state), moved?() }`. `Follow.onResize(top)` (`state-table.ts`). `workspace.ts`: `TmDisplay { edges }`, `DEFAULT_TM_DISPLAY`, `TmDisplays`, `withTmDisplay`, `Workspace.tmDisplay`; `PaneEvents.tmDisplay?`; `pane-host.ts`'s deps `tmDisplayOf`, `setTmDisplay`. `TmPane`'s constructor takes `panels.diagram` and a `TmDisplay`.
- The diagram is a panel named `diagram`, labelled *state diagram*, open by default, between the rules and the outline; its header carries *follow current state* (while detached) and *arcs | chips*. *Arcs*' runtime column is the program level's second tab stop, its boxes a roving group (↑/↓), rebuilt only with the machine or the rendering so a focused box keeps its focus.

**A CLAMP IS NOT A SCROLL, IN EITHER ORDER.** A panel closing beside the table or the diagram grows it past its content, and the browser clamps its scroll. When the resize observer runs first, `Follow.onResize` records the clamp as expected; when the `scroll` event comes first — the diagram's case, reproduced — the scroll handler sees its box's height changed since the last draw and calls `onResize` itself. **Each view proves one order, and keeps both paths.** Every clamp produced for the table ran the observer first (`tm-follow-clamp.test.ts` holds that path, and dropping the table's `onResize` fails it); every one produced for the diagram ran the `scroll` first (`stays following when a panel beside it closes…` holds it, and dropping the height check fails it). The other path in each view has no test that reaches it, and its sabotage is recorded as not firing: either order can occur in either view, and a view with only one path detaches in the other.

**THE ACTIVE ROW IS A ROW, NOT A PLACE.** The sub-steps row moves with the current group and shifts every row between its old place and its new one; `#layout` finds the active row again by what it is (`sameRow`). A first draft kept the index, and the cursor landed on a neighbour.

**A VIEW OFF THE PAGE GROUPS AND DRAWS NOTHING.** `draw()` skips a host that is not connected and `replies.ts` does not hand it a compile (Plan 7 part 4a), so the diagram's `setProgram` and `render` never run there; `hidden-views.test.ts` holds it.

- [ ] **Step 1: Write the failing tests.** `state-diagram.test.ts` and `tm-follow-clamp.test.ts` are new; the tests' half gives `tm-grid.test.ts` the diagram beside the rules, `Follow.onResize` its node cases, the workspace its TM display, and `hidden-views.test.ts` its diagram case.

Create `web/tests/browser/state-diagram.test.ts`:

```ts file=web/tests/browser/state-diagram.test.ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * The state diagram's program level (Plan 7 part 4, spec §8 and amendments 9 and 11), on `fact(3)`: 21 instructions,
 * four labels, and a shared return handler billed to none of them.
 *
 * THE RULES PANEL IS CLOSED, so the diagram takes the view's height and the whole listing is drawn: the arc count
 * below is the program's, not a window's.
 */

let view: EditorView

const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
/** `fact(3)`'s states, `grep -c '^state '` over its emitted machine (spec §14.1). */
const STATES = 1199

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const diagram = () => pane().querySelector('[data-panel="diagram"]') as HTMLElement
const grid = () => diagram().querySelector('.program-scroll') as HTMLElement
const rows = () => [...diagram().querySelectorAll<HTMLElement>('.program-row')]
const groupRows = () => rows().filter((r) => r.querySelector('.program-name') !== null)
const rowNamed = (name: string) => groupRows().find((r) => r.querySelector('.program-name')?.textContent === name)
const boxes = () => [...diagram().querySelectorAll<HTMLElement>('.program-box')]
const status = () => pane().querySelector('.tm-status')?.textContent ?? ''
const control = (label: string) =>
  [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
/**
 * From step 0 to the first step inside `cmpeq` — 1,732 steps forward, where stepping back from the frontier took
 * about 9,000, one redraw each, and ran past the test's time under a full suite's load.
 */
async function intoCmpeq(): Promise<void> {
  control('↺')?.click()
  for (let i = 0; i < 20_000 && !/^cmp/.test(status()); i += 1) control('▶')?.click()
  await until(() => /^cmp/.test(status()), 'the machine to be inside cmpeq')
}
const counted = (el: Element) => Number.parseInt(el.querySelector('.program-count')?.textContent ?? '0', 10)
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const rulesToggle = () =>
  pane().querySelector<HTMLButtonElement>('[data-panel="rules"] .panel-toggle') as HTMLButtonElement
/** Close the rules, so the diagram takes the view and draws the whole listing. */
async function wholeListing(): Promise<void> {
  if (rulesToggle().getAttribute('aria-expanded') === 'true') rulesToggle().click()
  await until(
    () => rows().length > 0 && rows().length === Number(grid().getAttribute('aria-rowcount')),
    'the diagram to draw the whole listing',
  )
}
const edgesChoice = (value: string) =>
  [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)

beforeAll(async () => {
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT3 } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
  // The diagram grows into the rules' share and redraws on the resize that follows: every row, once it has.
  await wholeListing()
})

describe('the program level, drawn as arcs', () => {
  it('lists the program: a row per instruction under its labels, and the runtime routines beside it', () => {
    expect(diagram().querySelector('.panel-toggle')?.getAttribute('aria-expanded')).toBe('true')
    expect(grid().getAttribute('role')).toBe('grid')
    expect(Number(grid().getAttribute('aria-rowcount'))).toBe(rows().length)
    expect(groupRows().map((r) => r.querySelector('.program-name')?.textContent)).toEqual(
      Array.from({ length: 21 }, (_, i) => `pc${i}`),
    )
    expect(
      rows()
        .filter((r) => r.classList.contains('is-label'))
        .map((r) => r.textContent),
    ).toEqual(['fact.0:', 'else2:', 'endif3:', 'skip1:'])
    // A label sits above the instruction it names: `fact.0` above the function's first, `pc1`.
    const at = rows().findIndex((r) => r.textContent === 'fact.0:')
    expect(rows()[at + 1]?.querySelector('.program-name')?.textContent).toBe('pc1')
    expect(rowNamed('pc4')?.querySelector('.program-text')?.textContent).toBe('cmpeq r1, r2, r3')
    expect(boxes().map((b) => b.firstElementChild?.textContent)).toEqual(['halt', 'ret', 'se23', 'rf24', 'dt25'])
    // At the frontier the machine is in `halt`, a routine with no row in *arcs*: its box is what is marked.
    expect(boxes()[0]?.getAttribute('aria-current')).toBe('step')
    expect(diagram().querySelector('.program-row[aria-current]')).toBeNull()
    // Every state is in exactly one row or box, but the overflow guard, which is a badge.
    const total = groupRows().reduce((n, r) => n + counted(r), 0) + boxes().reduce((n, b) => n + counted(b), 0)
    expect(total).toBe(STATES - 1)
  })

  it('draws each jump and call as an arc, and a rule into overflow as a ⚠', () => {
    // `jmp skip1`, `jz r1, else2`, `jmp endif3` and the two `call fact.0`s; every other edge falls through.
    expect(diagram().querySelectorAll('.program-arc')).toHaveLength(5)
    expect(rowNamed('pc0')?.querySelector('.program-warn')).toBeNull()
    const warn = rowNamed('pc4')?.querySelector('.program-warn')
    expect(warn?.getAttribute('aria-label')).toBe('reaches overflow')
  })

  it("keeps the arcs' words on each row for a screen reader, unseen", () => {
    const chips = rowNamed('pc0')?.querySelector('.program-chips') as HTMLElement
    expect(chips.textContent).toBe('→ skip1')
    expect(chips.classList.contains('visually-hidden')).toBe(true)
  })

  it('opens the current instruction onto its sub-steps, and follows the run', async () => {
    // A step inside `cmpeq`, the first instruction whose gadget has named sub-steps.
    await intoCmpeq()
    const current = diagram().querySelector('.program-row[aria-current="step"]')
    expect(current?.querySelector('.program-name')?.textContent).toBe('pc4')
    const steps = current?.nextElementSibling
    expect(steps?.classList.contains('is-steps')).toBe(true)
    const now = steps?.querySelector('.program-step.is-now')?.textContent
    // The sub-step marked is the current state's second name segment.
    expect(now).toBe(status().split(' ')[0]?.split('.')[1])
  })

  it("links a row's construct, as a click on the rule table does", async () => {
    rowNamed('pc4')?.click()
    await until(() => document.querySelector('.cm-editor .linked') !== null, 'the source to be linked')
    expect(rowNamed('pc4')?.classList.contains('is-linked')).toBe(true)
  })

  it("moves the grid's active row by key, and links on Enter", async () => {
    grid().focus()
    await userEvent.keyboard('{End}')
    const named = () => document.getElementById(grid().getAttribute('aria-activedescendant') ?? '')
    expect(named()?.closest('.program-row')?.querySelector('.program-name')?.textContent).toBe('pc20')
    await userEvent.keyboard('{Home}')
    expect(named()?.closest('.program-row')?.querySelector('.program-name')?.textContent).toBe('pc0')
    await userEvent.keyboard('{Enter}')
    await until(() => rowNamed('pc0')?.classList.contains('is-linked') === true, 'pc0 to be linked')
  })

  it('detaches following on a scroll, and its header action re-attaches it', async () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    // Still following after everything above — the rules closing, which grew the diagram and clamped its scroll,
    // and every step back: none of it was the user scrolling.
    expect(reattach.hidden).toBe(true)
    // The rules open again, so the listing is taller than the diagram and there is somewhere to scroll to. Two
    // frames on, the resize has been drawn — a user's scroll cannot land sooner — and was not read as a scroll.
    rulesToggle().click()
    await until(() => grid().scrollHeight > grid().clientHeight, 'the diagram to shrink under its listing')
    await frame()
    await frame()
    expect(reattach.hidden).toBe(true)
    grid().scrollTop = grid().scrollTop === 0 ? grid().scrollHeight : 0
    await until(() => !reattach.hidden, 'following to detach')
    reattach.click()
    expect(reattach.hidden).toBe(true)
  })
})

describe('the program level, drawn as chips', () => {
  it('writes each row its edges and gives the runtime routines rows of their own, and keeps the choice', async () => {
    await wholeListing()
    edgesChoice('chips')?.click()
    await wholeListing()
    expect(edgesChoice('chips')?.getAttribute('aria-checked')).toBe('true')
    expect(diagram().querySelector('.program-side')?.hasAttribute('hidden')).toBe(true)
    expect(diagram().querySelectorAll('.program-arc')).toHaveLength(0)
    const chips = rowNamed('pc0')?.querySelector('.program-chips') as HTMLElement
    expect(chips.classList.contains('visually-hidden')).toBe(false)
    expect(rows().some((r) => r.classList.contains('is-heading') && r.textContent === 'runtime')).toBe(true)
    // The return dispatch goes back to the instruction after each call, and only `ret` reaches it.
    const dt25 = [...(rowNamed('dt25')?.querySelectorAll('.program-chip') ?? [])].map((c) => c.textContent)
    expect(dt25).toEqual(['→ pc14 pc20', '← ret'])
    const stored = JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')
    expect(stored.tmDisplay?.['tm-0']).toEqual({ edges: 'chips' })
    edgesChoice('arcs')?.click()
    expect(diagram().querySelectorAll('.program-arc').length).toBeGreaterThan(0)
  })
})

describe('the program level through a moving run', () => {
  const named = () =>
    document
      .getElementById(grid().getAttribute('aria-activedescendant') ?? '')
      ?.closest('.program-row')
      ?.querySelector('.program-name')?.textContent
  async function stepUntil(pattern: RegExp): Promise<void> {
    for (let i = 0; i < 20_000 && !pattern.test(status()); i += 1) control('▶')?.click()
    await until(() => pattern.test(status()), `the machine to reach ${pattern}`)
  }

  it('keeps the active row on its row when the sub-steps row moves past it', async () => {
    await wholeListing()
    await intoCmpeq()
    grid().focus()
    await userEvent.keyboard('{Home}')
    for (let i = 0; i < 30 && named() !== 'pc10'; i += 1) await userEvent.keyboard('{ArrowDown}')
    expect(named()).toBe('pc10')
    // From pc4's gadget to pc11's: the sub-steps row moves from above pc10 to below it.
    await stepUntil(/^sub/)
    expect(diagram().querySelector('.program-row[aria-current="step"] .program-name')?.textContent).toBe('pc11')
    expect(named()).toBe('pc10')
  })

  it("keeps a runtime box's focus while the run moves, and the column is one tab stop", async () => {
    expect(boxes().filter((b) => b.tabIndex === 0)).toHaveLength(1)
    boxes()[0]?.focus()
    await userEvent.keyboard('{ArrowDown}')
    const box = document.activeElement
    expect(box).toBe(boxes()[1])
    const at = status()
    await stepUntil(/^mv|^mul|^pc/)
    expect(status()).not.toBe(at)
    expect(document.activeElement).toBe(box)
    expect(boxes().filter((b) => b.tabIndex === 0)).toEqual([box])
  })

  it('scrolls to follow the current row when the listing is taller than the diagram', async () => {
    rulesToggle().click()
    await until(() => grid().scrollHeight > grid().clientHeight, 'the diagram to shrink under its listing')
    control('↺')?.click()
    // The frame push of the call at pc19, near the listing's end.
    await stepUntil(/^pf21/)
    await frame()
    const row = diagram().querySelector('.program-row[aria-current="step"]') as HTMLElement
    expect(row.querySelector('.program-name')?.textContent).toBe('pc19')
    const box = grid().getBoundingClientRect()
    const at = row.getBoundingClientRect()
    expect(at.top).toBeGreaterThanOrEqual(box.top)
    expect(at.bottom).toBeLessThanOrEqual(box.bottom)
    expect(grid().scrollTop).toBeGreaterThan(0)
  })

  it('stays following when a panel beside it closes and its scroll is clamped', async () => {
    const reattach = diagram().querySelector('.diagram-reattach') as HTMLElement
    expect(reattach.hidden).toBe(true)
    const before = grid().scrollTop
    rulesToggle().click()
    await frame()
    await frame()
    // The diagram grew past its listing, so the browser clamped its scroll; that was not the user scrolling.
    expect(grid().scrollTop).toBeLessThan(before)
    expect(reattach.hidden).toBe(true)
  })
})
```

Create `web/tests/browser/tm-follow-clamp.test.ts`:

```ts file=web/tests/browser/tm-follow-clamp.test.ts
import { describe, expect, it, vi } from 'vitest'
import type { PaneEvents } from '../../src/pane-chrome'
import { TmPane } from '../../src/tm-pane'
import type { TmProgram, TmState } from '../../src/types'

/**
 * **A FOLLOWING TABLE THAT GROWS STAYS FOLLOWING** (Plan 7 part 4, spec §9.1). Its height is the view's now, so a
 * panel closing beside it grows it; a table following a row near its end then has its scroll clamped, and the
 * browser reports the clamp as a `scroll`. Here the resize observer's callback comes first, so it is
 * `Follow.onResize` there that holds following. The other order — the `scroll` first, which `TmPane`'s scroll
 * handler answers by comparing heights — was seen in the state diagram (`state-diagram.test.ts`) and could not be
 * produced for the table.
 */

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

const STATES = 200
/** A chain of states, each with one rule to the next — a table of 400 rows. */
const PROGRAM: TmProgram = {
  states: Array.from({ length: STATES }, (_, i) => ({
    name: `q${i}`,
    accept: i === STATES - 1,
    rules: i === STATES - 1 ? [] : [{ read: [null], write: [null], moves: ['S' as const], next: i + 1 }],
    instr: null,
  })),
  alphabet: ['_'],
  tapes: 1,
  width: 4,
  start: 0,
  listing: [],
  labels: [],
}

/** The last state: the row the table follows sits at its very end, where growing clamps the scroll. */
const FRAME: TmState = {
  state: STATES - 1,
  step: STATES - 1,
  heads: [0],
  window_start: [0],
  window: [['_']],
  source_node: null,
  rule: null,
}

const CONTROLS = {
  canRestart: true,
  canBack: true,
  canForward: false,
  canPlay: false,
  playing: false,
  stepText: `${STATES - 1}`,
  continueLabel: null,
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

describe('a following rule table that grows', () => {
  it('is still following once a panel beside it closes and its scroll is clamped', async () => {
    document.body.innerHTML = ''
    const host = document.createElement('section')
    host.className = 'pane'
    host.dataset.kind = 'tm'
    host.style.height = '600px'
    document.body.append(host)
    const pane = new TmPane(host, events())
    pane.setProgram(PROGRAM, ['t'])
    pane.render(FRAME, CONTROLS)
    await frame()
    await frame()
    const table = host.querySelector('.state-table') as HTMLElement
    const reattach = host.querySelector('.table-reattach') as HTMLElement
    // Following, and at the end: the scroll is as far down as the table goes.
    expect(reattach.hidden).toBe(true)
    expect(table.scrollTop + table.clientHeight).toBeGreaterThanOrEqual(table.scrollHeight - 1)
    const before = table.clientHeight
    host.querySelector<HTMLButtonElement>('[data-panel="diagram"] .panel-toggle')?.click()
    await frame()
    await frame()
    expect(table.clientHeight).toBeGreaterThan(before)
    expect(reattach.hidden).toBe(true)
  })
})
```

Apply the tests' half of the patch:

```diff apply=tests
diff --git a/web/tests/browser/hidden-views.test.ts b/web/tests/browser/hidden-views.test.ts
index e704f0f..f099d5d 100644
--- a/web/tests/browser/hidden-views.test.ts
+++ b/web/tests/browser/hidden-views.test.ts
@@ -2,6 +2,7 @@ import type { EditorView } from '@codemirror/view'
 import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
 import { LambdaTrees } from '../../src/lambda-trees'
 import { ruleCount } from '../../src/protocol'
+import { StateDiagram } from '../../src/state-diagram'
 import { TmPane } from '../../src/tm-pane'
 import { SHELL, until } from './harness'
 
@@ -95,6 +96,23 @@ describe('views off the page', () => {
     ).not.toBe(baselineRules)
   })
 
+  // THE STATE DIAGRAM (Plan 7 part 4b) RIDES THE SAME SEED: its states are grouped when its view is handed a machine
+  // and drawn when its view is painted, and a view off the page is neither — so it costs nothing either, per compile
+  // or per frame, until its tab is shown.
+  it('groups and draws no state diagram for a hidden TM view, and does both once it is shown', async () => {
+    tab('lambda-0')?.click()
+    await tick()
+    const group = vi.spyOn(StateDiagram.prototype, 'setProgram')
+    const paint = vi.spyOn(StateDiagram.prototype, 'render')
+    await compile('let z = 2; z + 3')
+    expect(group, 'no grouping off the page').not.toHaveBeenCalled()
+    expect(paint, 'no drawing off the page').not.toHaveBeenCalled()
+    tab('tm-0')?.click()
+    await until(() => group.mock.calls.length > 0, 'the shown view to group its states')
+    await until(() => document.querySelector('[data-leaf="tm-0"] .program-row') !== null, 'the diagram to draw')
+    expect(paint).toHaveBeenCalled()
+  })
+
   it('asks for no λ tree for a hidden λ view', async () => {
     tab('tm-0')?.click()
     const want = vi.spyOn(LambdaTrees.prototype, 'want')
diff --git a/web/tests/browser/tm-grid.test.ts b/web/tests/browser/tm-grid.test.ts
index 1d2561a..db523c4 100644
--- a/web/tests/browser/tm-grid.test.ts
+++ b/web/tests/browser/tm-grid.test.ts
@@ -72,7 +72,7 @@ describe('the rule table as a grid', () => {
     // At the frontier the machine sits in `halt`, where no rule fires; one step back is the rule into it.
     stepButton('◀')?.click()
     await until(() => pane().querySelector('.state-row.is-next') !== null, 'a rule to be about to fire')
-    const current = pane().querySelectorAll('[aria-current="step"]')
+    const current = grid().querySelectorAll('[aria-current="step"]')
     expect(current).toHaveLength(1)
     expect(current[0]?.classList.contains('is-current')).toBe(true)
     const next = pane().querySelector('.state-row.is-next > [role="gridcell"]') as HTMLElement
@@ -145,19 +145,27 @@ describe('the tapes (spec §9.3)', () => {
 })
 
 describe("the rule table's height is its view's (spec §9.1)", () => {
-  it('fills the view, not a share of the window', () => {
+  it('shares the view with the state diagram, two to one, and fills it', () => {
     // No `max-height` of its own: the view's flex layout is what bounds it.
     expect(getComputedStyle(grid()).maxHeight).toBe('none')
-    const panel = pane().querySelector('[data-panel="rules"]') as HTMLElement
-    // The rules panel runs to the view's bottom edge, and the view does not scroll.
-    expect(Math.abs(pane().getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom)).toBeLessThan(2)
+    const diagram = pane().querySelector('[data-panel="diagram"]') as HTMLElement
+    // The last open panel runs to the view's bottom edge, and the view does not scroll.
+    expect(Math.abs(pane().getBoundingClientRect().bottom - diagram.getBoundingClientRect().bottom)).toBeLessThan(2)
     expect(pane().scrollHeight).toBeLessThanOrEqual(pane().clientHeight + 1)
+    const ratio =
+      grid().getBoundingClientRect().height /
+      (diagram.querySelector('.state-diagram') as HTMLElement).getBoundingClientRect().height
+    expect(ratio).toBeGreaterThan(1.6)
+    expect(ratio).toBeLessThan(2.4)
     // And every row the table shows is drawn: the rows reach the table's own bottom edge.
     const drawn = rows().at(-1)?.getBoundingClientRect().bottom ?? 0
     expect(drawn).toBeGreaterThanOrEqual(grid().getBoundingClientRect().bottom - 1)
   })
 
-  it('gives the rules two shares and the outline one, and redraws the rows when its share changes', async () => {
+  it('gives the outline one share beside them, and redraws the rows when its share changes', async () => {
+    // Following, to begin with: the keys above took the table off the machine.
+    const reattach = pane().querySelector('.table-reattach') as HTMLElement
+    if (!reattach.hidden) reattach.click()
     pane().querySelector<HTMLButtonElement>('button.detach')?.click()
     await until(() => pane().querySelector('.term-editor') !== null, 'the copy to mount its editor')
     const outline = pane().querySelector('[data-panel="outline"]') as HTMLElement
@@ -197,5 +205,10 @@ describe("the rule table's height is its view's (spec §9.1)", () => {
     } finally {
       Object.assign(TmPane.prototype, { render, setLink, setProgram })
     }
+    // AND STILL FOLLOWING: the table grew, the draw moved its scroll to keep the current row centred, and that
+    // write's own `scroll` event is not the user taking control. Nothing clamps here, the rows running far past
+    // the table's end; `tm-follow-clamp.test.ts` holds a clamp.
+    await frame()
+    expect(reattach.hidden).toBe(true)
   })
 })
diff --git a/web/tests/node/state-table.test.ts b/web/tests/node/state-table.test.ts
index b666fe5..d6ef07a 100644
--- a/web/tests/node/state-table.test.ts
+++ b/web/tests/node/state-table.test.ts
@@ -234,6 +234,26 @@ describe('Follow', () => {
     expect(f.following).toBe(true)
   })
 
+  // A BOX THAT GROWS PAST ITS CONTENT HAS ITS SCROLL CLAMPED, and the browser reports the clamp as a scroll a frame
+  // later. Read as a user's, it detached a following view every time a panel beside it closed.
+  it('does not detach on the scroll a resize clamped', () => {
+    const f = new Follow()
+    f.onProgrammaticScroll(280)
+    f.onScroll(280)
+    f.onResize(0)
+    f.onScroll(0)
+    expect(f.following).toBe(true)
+  })
+
+  it('still detaches on a real scroll after a resize that moved nothing', () => {
+    const f = new Follow()
+    f.onProgrammaticScroll(280)
+    f.onScroll(280)
+    f.onResize(280)
+    f.onScroll(40)
+    expect(f.following).toBe(false)
+  })
+
   it('detaches on demand, and an echo still expected does not hold it', () => {
     const f = new Follow()
     f.onProgrammaticScroll(1000)
diff --git a/web/tests/node/workspace.test.ts b/web/tests/node/workspace.test.ts
index 871a713..f028acf 100644
--- a/web/tests/node/workspace.test.ts
+++ b/web/tests/node/workspace.test.ts
@@ -14,6 +14,7 @@ import {
   WORKSPACE_VERSION,
   withDisplay,
   withPanel,
+  withTmDisplay,
 } from '../../src/workspace'
 
 const SPLIT = splitLeaf(defaultLayout(), 'lambda-0', 'row', 'pane-1', 'tm')
@@ -71,6 +72,7 @@ describe('parseWorkspace', () => {
       panels: { 'tm-0': { rules: false } },
       inspector: false,
       display: { 'pane-1': { layout: 'outline' as const, vars: 'debruijn' as const, map: 'minimap' as const } },
+      tmDisplay: { 'tm-0': { edges: 'chips' as const } },
     }
     const raw = serializeWorkspace(ws)
     expect(JSON.parse(raw).version).toBe(WORKSPACE_VERSION)
@@ -171,6 +173,17 @@ describe('parseWorkspace', () => {
     }
   })
 
+  // **THE SAME FOR A TM VIEW'S DISPLAY**, which Plan 7 part 4b added after 4a's.
+  it('defaults a missing TM display to none stored, and refuses a malformed one', () => {
+    const base = { version: 2, tree: SPLIT, switches: PRESETS.explorer, speed: 8, focused: 'lambda-0', panels: {} }
+    expect(parseWorkspace(JSON.stringify(base))?.tmDisplay).toEqual({})
+    const good = { 'tm-0': { edges: 'chips' } }
+    expect(parseWorkspace(JSON.stringify({ ...base, tmDisplay: good }))?.tmDisplay).toEqual(good)
+    for (const bad of [{ 'tm-0': { edges: 'boxes' } }, { 'tm-0': {} }, { 'nowhere-9': { edges: 'arcs' } }, []]) {
+      expect(parseWorkspace(JSON.stringify({ ...base, tmDisplay: bad })), JSON.stringify(bad)).toBeNull()
+    }
+  })
+
   it('opens the inspector for a migrated version 1 layout', () => {
     expect(parseWorkspace(serializeLayout(SPLIT))?.inspector).toBe(true)
   })
@@ -184,10 +197,12 @@ describe('serializeWorkspace', () => {
       focused: 'pane-9',
       panels: { 'pane-9': { rules: false }, 'tm-0': { rules: false } },
       display: { 'pane-9': outline, 'lambda-0': outline },
+      tmDisplay: { 'pane-9': { edges: 'chips' as const }, 'tm-0': { edges: 'chips' as const } },
     }
     const back = JSON.parse(serializeWorkspace(ws))
     expect(back.panels).toEqual({ 'tm-0': { rules: false } })
     expect(back.display).toEqual({ 'lambda-0': outline })
+    expect(back.tmDisplay).toEqual({ 'tm-0': { edges: 'chips' } })
     expect(back.focused).toBe('lambda-0')
     expect(back.inspector).toBe(true)
     expect(JSON.parse(serializeWorkspace({ ...ws, inspector: false })).inspector).toBe(false)
@@ -202,6 +217,15 @@ describe('withDisplay', () => {
   })
 })
 
+describe('withTmDisplay', () => {
+  it('records one view’s display without touching the others', () => {
+    expect(withTmDisplay({ 'tm-0': { edges: 'arcs' } }, 'pane-1', { edges: 'chips' })).toEqual({
+      'tm-0': { edges: 'arcs' },
+      'pane-1': { edges: 'chips' },
+    })
+  })
+})
+
 describe('withPanel', () => {
   it('records one panel of one view without touching the others', () => {
     const next = withPanel({ 'tm-0': { rules: false } }, 'pane-1', 'rules', true)
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd web && pnpm run typecheck`
Expected: FAIL — 6 errors in 3 test files: 1 × `TS2307: Cannot find module '../../src/state-diagram' or its corresponding type declarations.`; 2 × `TS2339: Property 'onResize' does not exist on type 'Follow'.`; 1 × `TS2724: '"../../src/workspace"' has no exported member named 'withTmDisplay'. Did you mean 'withDisplay'?`; 2 × `TS2551: Property 'tmDisplay' does not exist on type 'Workspace'. Did you mean 'display'?`.

- [ ] **Step 3: Write the code.** The diagram, the pane's panel and switch, the display's persistence, and `Follow.onResize`.

Create `web/src/state-diagram.ts`:

```ts file=web/src/state-diagram.ts
import { type Arc, arcsOf, chipsOf, type Edges, type ProgramRow, programRows } from './program-level'
import { type Groups, groupStates, stepOf } from './state-groups'
import { Follow, ROW_HEIGHT } from './state-table'
import type { TmProgram, TmState } from './types'
import { visibleWindow } from './virtual-list'

/** Rows drawn beyond the viewport on each side — the rule table's `OVERSCAN`, for its reason. */
const OVERSCAN = 4
/** Pixels between two lanes of *arcs*' gutter, and the gutter's margin beside the rows. */
const LANE = 9
const GUTTER_PAD = 12
/** The runtime column's boxes: each one row tall, a row apart, and this wide. */
const BOX_WIDTH = 104
const SVG = 'http://www.w3.org/2000/svg'

let minted = 0

export type DiagramEvents = {
  /** Link `state`'s construct, as a click on its row of the rule table does (spec §8). */
  readonly link: (state: number) => void
  /** The view scrolled or its following changed: the pane redraws the header action that re-attaches it. */
  readonly moved?: () => void
}

/**
 * The state diagram's program level (Plan 7 part 4, spec §8): one row per instruction, or per name group, with
 * its state count and a ⚠ where it reaches `overflow`; the current row open onto its sub-steps; and the edges
 * between rows drawn as *arcs* — a gutter of lanes, the runtime routines in a column of their own — or as
 * *chips*, text on each row (amendment 11).
 *
 * **ONLY THE HIGHLIGHT MOVES PER FRAME.** The groups, the arcs and their lanes are built once per machine
 * (`setProgram`); the rows are rebuilt only when the current group changes, since it is the one that opens onto
 * its sub-steps; a frame otherwise redraws the window it shows and nothing else.
 *
 * **THE ROWS VIRTUALIZE AS THE RULE TABLE'S DO**, at `ROW_HEIGHT` each and through the same `visibleWindow`:
 * `list150` compiles to 302 instructions (spec §14.1). An arc whose ends are both off the window but whose span
 * crosses it is still drawn, clipped by the gutter's own box.
 *
 * **A GRID, AS THE RULE TABLE IS** (spec §9.2): one tab stop, one `gridcell` per row, and a roving active row by
 * index that `aria-activedescendant` names. In *arcs* each row keeps its chips' text, visually hidden: it is what
 * the arcs say to a screen reader. *Arcs*' runtime column is the program level's second tab stop, its boxes a roving
 * group, since the routines have no rows there.
 */
export class StateDiagram {
  /** The panel's body: the program level's scrolling grid, and in *arcs* the runtime column beside it. */
  readonly el: HTMLElement
  #on: DiagramEvents
  #id = `diagram-${minted++}`
  #scroll: HTMLElement
  #spacer: HTMLElement
  #rowsEl: HTMLElement
  #gutter: SVGSVGElement
  #side: HTMLElement
  #sideLinks: SVGSVGElement
  #boxes: HTMLElement

  #program: TmProgram | null = null
  #groups: Groups | null = null
  #arcs: Arc[] = []
  #lanes = 0
  #edges: Edges = 'arcs'
  #frame: TmState | null = null
  /** The current group, or `null` with no frame, and for the `overflow` state, which is a badge. */
  #current: number | null = null
  #rows: ProgramRow[] = []
  /** `#rowOf[group]` is the group's row in `#rows`, or `-1` when it has none (a runtime routine in *arcs*). */
  #rowOf: Int32Array = new Int32Array(0)
  #linked: Set<number> = new Set()
  #follow = new Follow()
  /** The scroll box's height at the last draw — how its `scroll` handler tells a clamp from a user's scroll. */
  #drawnHeight = 0
  #active = 0
  /** The runtime column's roving tab stop: the group whose box holds it, or `null` for the first box. */
  #activeBox: number | null = null

  constructor(on: DiagramEvents) {
    this.#on = on
    this.el = document.createElement('div')
    this.el.className = 'state-diagram'
    const program = document.createElement('div')
    program.className = 'program-level'

    this.#scroll = document.createElement('div')
    this.#scroll.className = 'program-scroll'
    this.#scroll.setAttribute('role', 'grid')
    this.#scroll.setAttribute('aria-label', 'program')
    this.#scroll.tabIndex = 0
    this.#spacer = document.createElement('div')
    this.#spacer.className = 'program-spacer'
    this.#spacer.setAttribute('role', 'none')
    this.#gutter = document.createElementNS(SVG, 'svg')
    this.#gutter.classList.add('program-gutter')
    this.#gutter.setAttribute('aria-hidden', 'true')
    this.#rowsEl = document.createElement('div')
    this.#rowsEl.className = 'program-rows'
    this.#rowsEl.setAttribute('role', 'rowgroup')
    this.#spacer.append(this.#gutter, this.#rowsEl)
    this.#scroll.append(this.#spacer)

    // THE RUNTIME COLUMN (*arcs* only): the routines billed to no instruction, and their connectors, which
    // are drawn against the view's own top rather than the list's, so they meet the rows where they are on
    // screen. Its boxes are buttons — the rows cannot hold them, since *arcs* gives the routines no rows.
    this.#side = document.createElement('div')
    this.#side.className = 'program-side'
    this.#sideLinks = document.createElementNS(SVG, 'svg')
    this.#sideLinks.classList.add('program-links')
    this.#sideLinks.setAttribute('aria-hidden', 'true')
    this.#boxes = document.createElement('div')
    this.#boxes.className = 'program-boxes'
    this.#boxes.setAttribute('role', 'group')
    this.#boxes.setAttribute('aria-label', 'runtime')
    this.#side.append(this.#sideLinks, this.#boxes)

    program.append(this.#scroll, this.#side)
    this.el.append(program)

    this.#scroll.addEventListener('scroll', () => {
      if (this.#scroll.clientHeight === 0) return
      // A BOX THAT CHANGED HEIGHT SINCE IT WAS DRAWN MAY HAVE HAD ITS SCROLL CLAMPED, and this event can come before
      // the resize observer's: a panel beside it that closed read the layout at once, in its own toggle.
      if (this.#scroll.clientHeight !== this.#drawnHeight) this.#follow.onResize(this.#scroll.scrollTop)
      this.#follow.onScroll(this.#scroll.scrollTop)
      this.#draw()
      this.#on.moved?.()
    })
    this.#rowsEl.addEventListener('click', (e) => {
      const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.program-row') : null
      if (el === null) return
      const i = Number(el.dataset.row)
      this.#active = i
      this.#draw()
      this.#linkRow(i)
    })
    this.#boxes.addEventListener('click', (e) => {
      const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.program-box') : null
      if (el === null) return
      this.#activeBox = Number(el.dataset.group)
      this.#paintBoxes()
      const first = this.#groups?.groups[Number(el.dataset.group)]?.first
      if (first !== undefined && first >= 0) this.#on.link(first)
    })
    this.#boxes.addEventListener('keydown', (e) => this.#boxKey(e))
    this.#scroll.addEventListener('keydown', (e) => this.#key(e))
    new ResizeObserver(() => {
      this.#follow.onResize(this.#scroll.scrollTop)
      this.#draw()
    }).observe(this.#scroll)
  }

  /** Whether the program level follows the running state; a user scroll or a key that scrolls detaches it. */
  get following(): boolean {
    return this.#follow.following
  }

  /** Group a new machine's states. Once per compile, like the rule table's `StateIndex`. */
  setProgram(p: TmProgram | null): void {
    this.#program = p
    this.#groups = p === null ? null : groupStates(p)
    this.#arcs = this.#groups === null ? [] : arcsOf(this.#groups)
    this.#lanes = this.#arcs.reduce((n, a) => Math.max(n, a.lane + 1), 0)
    this.#linked = new Set()
    this.#current = null
    this.#frame = null
    this.#active = 0
    this.#activeBox = null
    this.#follow.attach()
    this.#follow.onProgrammaticScroll(0)
    this.#scroll.scrollTop = 0
    this.#drawBoxes()
    this.#layout()
  }

  /** Show *arcs* or *chips*: the rows and the column change, the groups and the arcs do not. */
  setEdges(edges: Edges): void {
    if (edges === this.#edges) return
    this.#edges = edges
    this.#drawBoxes()
    this.#layout()
  }

  /** The machine's frame: which group is current, and which sub-step. */
  render(frame: TmState | null): void {
    this.#frame = frame
    const g = frame === null ? null : (this.#groups?.groupOf[frame.state] ?? -1)
    const current = g === null || g < 0 ? null : g
    if (current !== this.#current) {
      this.#current = current
      this.#layout()
    } else {
      this.#draw()
    }
  }

  /** Mark the groups holding any of `states` — a link's block, which the rule table marks too. */
  setLinked(states: readonly number[]): void {
    const groups = this.#groups
    this.#linked = new Set()
    if (groups !== null) {
      for (const s of states) {
        const g = groups.groupOf[s] ?? -1
        if (g >= 0) this.#linked.add(g)
      }
    }
    this.#draw()
  }

  /** Follow the running state again, and scroll to it now. */
  attach(): void {
    this.#follow.attach()
    this.#draw()
  }

  /** Redraw after the panel opens, or after anything else that changed its size without a scroll or a frame. */
  redraw(): void {
    this.#draw()
  }

  /** Rebuild the rows — a new machine, a new current group, or the other rendering — and draw them. */
  #layout(): void {
    const groups = this.#groups
    // THE ACTIVE ROW IS A ROW, NOT A PLACE: the sub-steps row moves with the current group and shifts every row
    // between its old place and its new one, so the active row is found again by what it is.
    const was = this.#rows[this.#active]
    this.#rows = groups === null ? [] : programRows(groups, this.#program?.labels ?? [], this.#edges, this.#current)
    if (was !== undefined) {
      const again = this.#rows.findIndex((r) => sameRow(r, was))
      if (again >= 0) this.#active = again
    }
    this.#rowOf = new Int32Array(groups?.groups.length ?? 0).fill(-1)
    for (const [i, row] of this.#rows.entries()) if (row.kind === 'group') this.#rowOf[row.group] = i
    this.#scroll.setAttribute('aria-rowcount', String(this.#rows.length))
    this.el.dataset.edges = this.#edges
    this.#draw()
  }

  /**
   * The runtime column's boxes, one per routine, in *arcs* only — built when the machine or the rendering changes,
   * never per frame, so a box holding the focus keeps it while the run moves; their marks are `#paintBoxes`'.
   */
  #drawBoxes(): void {
    const groups = this.#groups
    const runtime = this.#edges === 'arcs' && groups !== null ? groups.groups.filter((g) => g.runtime) : []
    this.#side.hidden = runtime.length === 0
    this.#boxes.replaceChildren(
      ...runtime.map((g, k) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'program-box'
        b.dataset.group = String(groups?.groups.indexOf(g) ?? -1)
        b.style.top = `${k * ROW_HEIGHT}px`
        const name = document.createElement('span')
        name.textContent = g.name
        const count = document.createElement('span')
        count.className = 'program-count'
        count.textContent = String(g.count)
        b.append(name, count)
        if (g.overflow) b.append(warning())
        return b
      }),
    )
    this.#paintBoxes()
  }

  /**
   * The boxes' marks — the current routine, the linked ones — and their roving tab stop: the column is one tab stop,
   * as the grid is, with ↑/↓ between its boxes (`#boxKey`).
   */
  #paintBoxes(): void {
    const boxes = [...this.#boxes.children].filter((b): b is HTMLElement => b instanceof HTMLElement)
    const stop = boxes.some((b) => Number(b.dataset.group) === this.#activeBox)
      ? this.#activeBox
      : Number(boxes[0]?.dataset.group)
    for (const box of boxes) {
      const g = Number(box.dataset.group)
      box.classList.toggle('is-current', g === this.#current)
      if (g === this.#current) box.setAttribute('aria-current', 'step')
      else box.removeAttribute('aria-current')
      box.classList.toggle('is-linked', this.#linked.has(g))
      box.tabIndex = g === stop ? 0 : -1
    }
  }

  /** ↑/↓ move the runtime column's tab stop between its boxes, and the focus with it; Enter is a button's own. */
  #boxKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const boxes = [...this.#boxes.querySelectorAll<HTMLElement>('.program-box')]
    const at = boxes.indexOf(document.activeElement as HTMLElement)
    const next = boxes[at + (e.key === 'ArrowDown' ? 1 : -1)]
    e.preventDefault()
    if (next === undefined) return
    this.#activeBox = Number(next.dataset.group)
    this.#paintBoxes()
    next.focus()
  }

  /**
   * Draw the rows in view, the arcs across them, and the runtime column's connectors. On every frame, scroll and
   * resize, so it stays O(visible) — as `TmPane`'s `#drawTable` does, and following the same way.
   */
  #draw(): void {
    const groups = this.#groups
    const viewport = this.#scroll.clientHeight
    this.#drawnHeight = viewport
    const total = this.#rows.length * ROW_HEIGHT
    this.#spacer.style.height = `${total}px`
    if (groups === null || viewport === 0) {
      if (groups === null) {
        this.#rowsEl.replaceChildren()
        this.#scroll.removeAttribute('aria-activedescendant')
      }
      return
    }
    const current = this.#current === null ? -1 : (this.#rowOf[this.#current] ?? -1)
    if (current >= 0) {
      const top = this.#follow.targetScrollTop(current, ROW_HEIGHT, viewport, total)
      if (top !== null && top !== this.#scroll.scrollTop) {
        this.#follow.onProgrammaticScroll(top)
        this.#scroll.scrollTop = top
      }
    }
    // THE ACTIVE ROW COMES WITH THE VIEW, as the rule table's does: `aria-activedescendant` names a drawn row.
    const topRow = Math.ceil(this.#scroll.scrollTop / ROW_HEIGHT)
    const bottomRow = Math.max(topRow, Math.floor((this.#scroll.scrollTop + viewport) / ROW_HEIGHT) - 1)
    this.#active = Math.max(0, Math.min(Math.max(this.#active, topRow), bottomRow, this.#rows.length - 1))

    const w = visibleWindow(this.#rows.length, ROW_HEIGHT, viewport, this.#scroll.scrollTop, OVERSCAN)
    const gutter = this.#edges === 'arcs' && this.#lanes > 0 ? this.#lanes * LANE + GUTTER_PAD : 0
    this.#rowsEl.style.transform = `translateY(${w.offsetY}px)`
    this.#rowsEl.style.left = `${gutter}px`
    const els: HTMLElement[] = []
    for (let i = w.firstIndex; i <= w.lastIndex; i += 1) els.push(this.#row(i, groups))
    const mine = this.#scroll.scrollTop
    this.#rowsEl.replaceChildren(...els)
    // A ROW LIST THAT SHRANK CLAMPS `scrollTop`, AND THE BROWSER REPORTS THE CLAMP AS A SCROLL — the λ view's
    // finding (`lambda-body.ts`): unrecorded, `Follow` reads it as the user scrolling away.
    if (this.#scroll.scrollTop !== mine) this.#follow.onProgrammaticScroll(this.#scroll.scrollTop)
    if (this.#active >= w.firstIndex && this.#active <= w.lastIndex) {
      this.#scroll.setAttribute('aria-activedescendant', `${this.#id}-${this.#active}`)
    } else {
      this.#scroll.removeAttribute('aria-activedescendant')
    }
    this.#drawArcs(w.firstIndex, w.lastIndex, w.offsetY, gutter)
    this.#drawLinks(groups)
    // THE RUNTIME COLUMN'S BOXES CARRY THE ROWS' MARKS: in *arcs* a routine has no row, so its box is where the
    // machine is when it is inside one, and where a link into one lands.
    this.#paintBoxes()
  }

  #row(i: number, groups: Groups): HTMLElement {
    const row = this.#rows[i] as ProgramRow
    const el = document.createElement('div')
    el.className = 'program-row'
    el.dataset.row = String(i)
    el.setAttribute('role', 'row')
    el.setAttribute('aria-rowindex', String(i + 1))
    const cell = document.createElement('div')
    cell.id = `${this.#id}-${i}`
    cell.className = 'program-cell'
    cell.setAttribute('role', row.kind === 'label' || row.kind === 'heading' ? 'rowheader' : 'gridcell')
    el.append(cell)
    if (i === this.#active) el.classList.add('is-active')
    switch (row.kind) {
      case 'label':
      case 'heading':
        el.classList.add(row.kind === 'label' ? 'is-label' : 'is-heading')
        cell.textContent = row.kind === 'label' ? `${row.name}:` : row.name
        return el
      case 'steps': {
        el.classList.add('is-steps')
        const now = this.#frame === null ? null : stepOf(this.#program?.states[this.#frame.state]?.name ?? '')
        for (const step of groups.groups[row.group]?.steps ?? []) {
          const s = document.createElement('span')
          s.className = step === now ? 'program-step is-now' : 'program-step'
          s.textContent = step
          cell.append(s)
        }
        return el
      }
      case 'group': {
        const g = groups.groups[row.group]
        if (g === undefined) return el
        if (row.group === this.#current) {
          el.classList.add('is-current')
          el.setAttribute('aria-current', 'step')
        }
        if (this.#linked.has(row.group)) el.classList.add('is-linked')
        const name = document.createElement('span')
        name.className = 'program-name'
        name.textContent = g.name
        cell.append(name)
        const line = g.instr === null ? undefined : this.#program?.listing[g.instr]
        if (line !== undefined) {
          const [mnemonic, operands] = line.split('\t')
          const text = document.createElement('span')
          text.className = 'program-text'
          const m = document.createElement('b')
          m.textContent = mnemonic ?? ''
          text.append(m)
          if (operands !== undefined) text.append(` ${operands}`)
          cell.append(text)
        }
        const chips = chipsOf(groups, this.#program?.labels ?? [], row.group)
        const said = [chips.to, chips.from].filter((c) => c !== '')
        if (said.length > 0) {
          const box = document.createElement('span')
          // IN *ARCS* THE CHIPS ARE THE ARCS' WORDS, PRESENT AND UNSEEN (amendment 11).
          box.className = this.#edges === 'chips' ? 'program-chips' : 'program-chips visually-hidden'
          for (const c of said) {
            const chip = document.createElement('span')
            chip.className = 'program-chip'
            chip.textContent = c
            box.append(chip)
          }
          cell.append(box)
        }
        if (g.overflow) cell.append(warning())
        const count = document.createElement('span')
        count.className = 'program-count'
        count.textContent = `${g.count} ${g.count === 1 ? 'state' : 'states'}`
        cell.append(count)
        return el
      }
    }
  }

  /** *Arcs*' gutter: every arc whose span crosses rows `first..last`, in the window's own coordinates. */
  #drawArcs(first: number, last: number, offsetY: number, width: number): void {
    const paths: SVGElement[] = []
    this.#gutter.style.top = `${offsetY}px`
    this.#gutter.setAttribute('width', String(width))
    this.#gutter.setAttribute('height', String((last - first + 1) * ROW_HEIGHT))
    if (width > 0) {
      for (const arc of this.#arcs) {
        const a = this.#rowOf[arc.from] ?? -1
        const b = this.#rowOf[arc.to] ?? -1
        if (a < 0 || b < 0 || Math.max(a, b) < first || Math.min(a, b) > last) continue
        const y = (row: number) => (row - first) * ROW_HEIGHT + ROW_HEIGHT / 2
        const x = width - GUTTER_PAD + 2 - (arc.lane + 1) * LANE
        const hot = arc.from === this.#current || arc.to === this.#current
        paths.push(
          svg('path', {
            d: `M${width} ${y(a)} H${x} V${y(b)} H${width - 3} M${width - 7} ${y(b) - 3} L${width - 3} ${y(b)} L${width - 7} ${y(b) + 3}`,
            class: hot ? 'program-arc is-hot' : 'program-arc',
          }),
        )
      }
    }
    this.#gutter.replaceChildren(...paths)
  }

  /**
   * The runtime column's connectors, against the view's own top: from each drawn row with an edge to or from a
   * routine, across to that routine's box, and between routines on the column's far side.
   */
  #drawLinks(groups: Groups): void {
    if (this.#side.hidden) return
    const height = this.#scroll.clientHeight
    this.#sideLinks.setAttribute('height', String(height))
    const boxOf = new Map<number, number>()
    let k = 0
    for (const [i, g] of groups.groups.entries()) if (g.runtime) boxOf.set(i, k++)
    const boxY = (g: number) => (boxOf.get(g) ?? 0) * ROW_HEIGHT + ROW_HEIGHT / 2
    const rowY = (g: number) => (this.#rowOf[g] ?? 0) * ROW_HEIGHT + ROW_HEIGHT / 2 - this.#scroll.scrollTop
    const left = 16 + boxOf.size * 6
    const paths: SVGElement[] = []
    const edge = (d: string) => paths.push(svg('path', { d, class: 'program-link' }))
    for (const [g, group] of groups.groups.entries()) {
      for (const h of group.targets) {
        const into = boxOf.get(h)
        const from = boxOf.get(g)
        if (from === undefined && into !== undefined) {
          const y = rowY(g)
          if (y < 0 || y > height) continue
          const x = 4 + into * 6
          edge(
            `M0 ${y} H${x} V${boxY(h)} H${left - 3} M${left - 7} ${boxY(h) - 3} L${left - 3} ${boxY(h)} L${left - 7} ${boxY(h) + 3}`,
          )
        } else if (from !== undefined && into === undefined) {
          const y = rowY(h)
          if (y < 0 || y > height) continue
          const x = 4 + from * 6
          edge(`M${left} ${boxY(g)} H${x} V${y} H3 M7 ${y - 3} L3 ${y} L7 ${y + 3}`)
        } else if (from !== undefined && into !== undefined) {
          const right = left + BOX_WIDTH
          const x = right + 6 + from * 5
          edge(`M${right} ${boxY(g)} H${x} V${boxY(h)} H${right + 3}`)
        }
      }
    }
    this.#sideLinks.replaceChildren(...paths)
    this.#boxes.style.left = `${left}px`
  }

  #linkRow(i: number): void {
    const row = this.#rows[i]
    if (row?.kind !== 'group') return
    const first = this.#groups?.groups[row.group]?.first ?? -1
    if (first >= 0) this.#on.link(first)
  }

  /**
   * The grid's keys, the rule table's (`TmPane`'s `#key`): ↑/↓, PgUp/PgDn and Home/End move the active row by
   * index, Enter links it, and a key that scrolls detaches following before the draw that would undo it.
   */
  #key(e: KeyboardEvent): void {
    const count = this.#rows.length
    if (count === 0) return
    const page = Math.max(1, Math.floor(this.#scroll.clientHeight / ROW_HEIGHT) - 1)
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
        next = count - 1
        break
      case 'Enter':
        e.preventDefault()
        this.#linkRow(this.#active)
        return
      default:
        return
    }
    e.preventDefault()
    this.#active = Math.min(Math.max(next, 0), count - 1)
    const top = this.#active * ROW_HEIGHT
    const from = this.#scroll.scrollTop
    const to = top < from ? top : Math.max(from, top + ROW_HEIGHT - this.#scroll.clientHeight)
    if (to !== from) {
      this.#follow.detach()
      this.#scroll.scrollTop = to
      this.#on.moved?.()
    }
    this.#draw()
  }
}

/** Spec §8's ⚠: a row whose rules reach `overflow`, said in words as well as drawn. */
function warning(): HTMLElement {
  const w = document.createElement('span')
  w.className = 'program-warn'
  w.setAttribute('role', 'img')
  w.setAttribute('aria-label', 'reaches overflow')
  w.title = 'a rule here reaches overflow'
  w.textContent = '⚠'
  return w
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

/** Whether two program rows are the same row: a label by its name, a group by its group, and each of the others. */
function sameRow(a: ProgramRow, b: ProgramRow): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'label' && b.kind === 'label') return a.name === b.name
  if (a.kind === 'group' && b.kind === 'group') return a.group === b.group
  return true
}
```

Apply the source half of the patch:

```diff apply=source
diff --git a/web/src/main.ts b/web/src/main.ts
index 4465122..787760d 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -76,9 +76,11 @@ import {
   type Speed,
   type Switches,
   serializeWorkspace,
+  type TmDisplay,
   type Workspace,
   withDisplay,
   withPanel,
+  withTmDisplay,
 } from './workspace'
 
 const SAMPLE = 'let x = 40; x + 2'
@@ -970,6 +972,7 @@ async function main(): Promise<EditorView> {
     panels: restored.panels,
     inspector: restored.inspector,
     display: restored.display,
+    tmDisplay: restored.tmDisplay,
   }
   /**
    * The focused view, repaired against the tree it names a leaf of.
@@ -990,7 +993,7 @@ async function main(): Promise<EditorView> {
    * comes back: close the TM view with its rules panel shut, then *reset preset*, and the new `tm-0`
    * would inherit the closed view's panel state — from memory, since the write had already dropped it.
    * The same clicks then behaved differently depending on whether the page had been reloaded in
-   * between. A λ view's display is kept per leaf beside its panels and is dropped here for the same
+   * between. A λ or TM view's display is kept per leaf beside its panels and is dropped here for the same
    * reason. `editor-custody.ts`'s `editorOwner` records the identical hazard for claims and answers it
    * the same way, in `applyLayout`'s creation pass.
    */
@@ -998,7 +1001,8 @@ async function main(): Promise<EditorView> {
     const live = new Set(leaves(tree).map((l) => l.id))
     const panels = Object.fromEntries(Object.entries(ws.panels).filter(([leaf]) => live.has(leaf)))
     const display = Object.fromEntries(Object.entries(ws.display).filter(([leaf]) => live.has(leaf)))
-    ws = { ...ws, focused: focusedLeaf(), panels, display }
+    const tmDisplay = Object.fromEntries(Object.entries(ws.tmDisplay).filter(([leaf]) => live.has(leaf)))
+    ws = { ...ws, focused: focusedLeaf(), panels, display, tmDisplay }
   }
 
   const persistWorkspace = (): void => {
@@ -1068,6 +1072,10 @@ async function main(): Promise<EditorView> {
     setDisplay: (leaf: LeafId, d: LambdaDisplay) => {
       ws = { ...ws, display: withDisplay(ws.display, leaf, d) }
     },
+    tmDisplayOf: (leaf: LeafId) => ws.tmDisplay[leaf],
+    setTmDisplay: (leaf: LeafId, d: TmDisplay) => {
+      ws = { ...ws, tmDisplay: withTmDisplay(ws.tmDisplay, leaf, d) }
+    },
     layoutChanged,
     draw: () => draw(),
     // THE ONE SESSION QUESTION `pane-host.ts` ASKS, ANSWERED HERE BECAUSE THIS FILE IS WHERE THE REGISTRY
diff --git a/web/src/pane-chrome.ts b/web/src/pane-chrome.ts
index bb8b39b..0025a21 100644
--- a/web/src/pane-chrome.ts
+++ b/web/src/pane-chrome.ts
@@ -3,7 +3,7 @@ import type { Leg } from './protocol'
 import type { ScratchEditorConfig } from './scratch-editor'
 import type { SessionId } from './session-client'
 import type { Binding, PaneOption } from './sessions'
-import type { LambdaDisplay, Speed } from './workspace'
+import type { LambdaDisplay, Speed, TmDisplay } from './workspace'
 
 export type PaneEvents = {
   /**
@@ -174,6 +174,8 @@ export type PaneEvents = {
   panel?: (name: string, open: boolean) => void
   /** A λ view's display settings changed — recorded per view, as `panel` is (Plan 7 part 4a). */
   display?: (d: LambdaDisplay) => void
+  /** A TM view's display settings changed — `display`'s twin (Plan 7 part 4b). */
+  tmDisplay?: (d: TmDisplay) => void
   /**
    * Fork this pane's MACHINE into a TM scratch buffer — 5d-iv design §4.3.
    *
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index c5b27a5..5dbcf2d 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -20,7 +20,7 @@ import type { SessionId } from './session-client'
 import { type Binding, PaneSlot, type TmCompiled, type TmScratchReading } from './sessions'
 import { TmPane } from './tm-pane'
 import { seedTm } from './tm-seed'
-import { DEFAULT_DISPLAY, type LambdaDisplay } from './workspace'
+import { DEFAULT_DISPLAY, DEFAULT_TM_DISPLAY, type LambdaDisplay, type TmDisplay } from './workspace'
 
 /**
  * THE PANE LIFECYCLE — which panes exist, what element each one lives in, and what its controls do —
@@ -197,6 +197,10 @@ export function createPaneHost(deps: {
   displayOf(leaf: LeafId): LambdaDisplay | undefined
   /** Record a λ view's display settings; `persist` is the caller's to make. */
   setDisplay(leaf: LeafId, d: LambdaDisplay): void
+  /** A TM view's stored display settings, or `undefined` for none (Plan 7 part 4b). */
+  tmDisplayOf(leaf: LeafId): TmDisplay | undefined
+  /** Record a TM view's display settings; `persist` is the caller's to make. */
+  setTmDisplay(leaf: LeafId, d: TmDisplay): void
   /** A view was added, closed, or switched to show something else — `main.ts` says it as a notice (spec §11). */
   layoutChanged(e: LayoutEvent): void
   draw(): void
@@ -262,6 +266,8 @@ export function createPaneHost(deps: {
     setPanel,
     displayOf,
     setDisplay,
+    tmDisplayOf,
+    setTmDisplay,
     layoutChanged,
     draw,
     tmProgramOf,
@@ -791,6 +797,10 @@ export function createPaneHost(deps: {
         setDisplay(id, d)
         persist()
       },
+      tmDisplay: (d: TmDisplay) => {
+        setTmDisplay(id, d)
+        persist()
+      },
     }
   }
 
@@ -1049,11 +1059,18 @@ export function createPaneHost(deps: {
         // closed every time. An entry is passed only when it is stored, so each panel keeps its own
         // default — `rules` opens, `outline` does not.
         const rules = panelOpen(l.id, 'rules')
+        const diagram = panelOpen(l.id, 'diagram')
         const outline = panelOpen(l.id, 'outline')
-        const pane = new TmPane(host, paneEvents(l.id, slot), {
-          ...(rules === undefined ? {} : { rules }),
-          ...(outline === undefined ? {} : { outline }),
-        })
+        const pane = new TmPane(
+          host,
+          paneEvents(l.id, slot),
+          {
+            ...(rules === undefined ? {} : { rules }),
+            ...(diagram === undefined ? {} : { diagram }),
+            ...(outline === undefined ? {} : { outline }),
+          },
+          tmDisplayOf(l.id) ?? DEFAULT_TM_DISPLAY,
+        )
         // **A NEW TM PANE IS SEEDED FROM ITS SESSION, BECAUSE THE REPLY THAT WOULD HAVE TOLD IT HAS
         // ALREADY BEEN AND GONE.** `TmPane.setProgram` was called from `replies.ts` and from nowhere
         // else, so a pane created after its session's last `compiled` reply rendered no tapes, no status
diff --git a/web/src/state-table.ts b/web/src/state-table.ts
index ccaa2e8..74ba97f 100644
--- a/web/src/state-table.ts
+++ b/web/src/state-table.ts
@@ -201,6 +201,8 @@ const ECHO_TOLERANCE = ROW_HEIGHT / 2
 export class Follow {
   #following = true
   #expected: number | null = null
+  /** Where the last `scroll` event or programmatic write left the box — what `onResize` compares against. */
+  #seen: number | null = null
 
   get following(): boolean {
     return this.#following
@@ -222,9 +224,11 @@ export class Follow {
   /** Record a scrollTop this code is about to write, so its echo is not read as user intent. */
   onProgrammaticScroll(top: number): void {
     this.#expected = top
+    this.#seen = top
   }
 
   onScroll(top: number): void {
+    this.#seen = top
     if (this.#expected !== null && Math.abs(top - this.#expected) <= ECHO_TOLERANCE) {
       return
     }
@@ -232,6 +236,18 @@ export class Follow {
     this.#following = false
   }
 
+  /**
+   * The box was resized, and `top` is where its scroll stands now. **A POSITION THAT MOVED SINCE THE LAST EVENT OR
+   * WRITE WAS THE BROWSER CLAMPING IT** — a box that grew past its content can no longer scroll as far — and the
+   * clamp's `scroll` event, which comes later, must not read as the user taking control. Plan 7 part 4b's state
+   * diagram detached exactly so when a panel beside it closed: it grew, its scroll was clamped from 280 to 0, and
+   * following stopped. A position that did not move leaves everything as it was.
+   */
+  onResize(top: number): void {
+    if (this.#seen !== null && top !== this.#seen) this.#expected = top
+    this.#seen = top
+  }
+
   /** Where to scroll so `stateRow` is centred, or `null` when not following. Clamped into the document. */
   targetScrollTop(stateRow: number, rowHeight: number, viewportHeight: number, totalHeight: number): number | null {
     if (!this.#following) return null
diff --git a/web/src/style.css b/web/src/style.css
index 0fcfc67..90a0b04 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -706,7 +706,8 @@ button.view-title[aria-expanded="true"] {
 /* THE CHECKED CHOICE (`view-header.ts`'s `radioGroup`), DRAWN WITHOUT RELYING ON COLOUR — the same cue
    `.view-menu-choice[aria-checked="true"]` uses: heavier than its sibling, plus a bar in `--accent`. A mode's
    button is otherwise every panel action's (`.panel-actions button`), which outranks a rule on its class. */
-.map-mode[aria-checked="true"] {
+.map-mode[aria-checked="true"],
+.diagram-mode[aria-checked="true"] {
   font-weight: 600;
   border-color: var(--accent);
   box-shadow: inset 0 -2px 0 var(--accent);
@@ -1628,8 +1629,197 @@ main {
   max-height: 40vh;
   overflow-y: auto;
 }
-/* A TM VIEW'S OPEN PANELS SHARE ITS HEIGHT (spec §9.1): the rules two shares, the outline one, each down to a
-   floor, and a closed panel keeps only its header. Everything else in the view — the text panel, the status
+.outline-row {
+  text-align: left;
+  font: inherit;
+  padding: 0.15em 0.6em;
+  padding-inline-start: calc(0.6em + var(--outline-depth, 0) * 1em);
+  border: 1px solid transparent;
+  border-radius: var(--radius);
+  background: transparent;
+  color: inherit;
+  cursor: pointer;
+}
+.outline-row[data-depth="1"] {
+  --outline-depth: 1;
+}
+.outline-row[data-depth="2"] {
+  --outline-depth: 2;
+}
+.outline-row:hover {
+  background: var(--bg-raised);
+}
+.outline-empty {
+  margin: 0;
+  padding: 0.15em 0.6em;
+  font-size: var(--step--2);
+  color: var(--fg-dim);
+}
+
+/* THE STATE DIAGRAM'S PROGRAM LEVEL (spec §8, `state-diagram.ts`): a grid of `ROW_HEIGHT` rows that virtualizes as
+   the rule table does, with *arcs*' gutter to its left and, in *arcs*, the runtime routines' column to its right.
+   The gutter and the column are drawn in SVG from the palette's own tokens; nothing here is a new colour. */
+.state-diagram {
+  display: flex;
+  flex-direction: column;
+  font-family: var(--font-mono);
+  font-size: var(--step--2);
+}
+.program-level {
+  display: flex;
+  flex: 1 1 0;
+  min-height: 0;
+}
+.program-scroll {
+  flex: 1 1 auto;
+  min-width: 0;
+  overflow-y: auto;
+}
+.program-spacer {
+  position: relative;
+}
+.program-rows {
+  position: absolute;
+  top: 0;
+  right: 0;
+  will-change: transform;
+}
+.program-gutter {
+  position: absolute;
+  left: 0;
+  overflow: hidden;
+}
+.program-row {
+  height: 24px;
+  line-height: 24px;
+  padding-inline: 0.5rem;
+  border-inline-start: 3px solid transparent;
+  cursor: pointer;
+}
+.program-cell {
+  display: flex;
+  gap: var(--space-2);
+  white-space: pre;
+  overflow: hidden;
+}
+.program-name {
+  flex: none;
+  min-width: 5ch;
+  color: var(--fg-dim);
+}
+.program-text {
+  flex: 1 1 auto;
+  overflow: hidden;
+  text-overflow: ellipsis;
+}
+.program-chips {
+  display: flex;
+  flex: none;
+  gap: var(--space-1);
+}
+.program-chip,
+.program-step {
+  padding: 0 0.4em;
+  border: 1px solid var(--rule);
+  border-radius: var(--radius);
+  color: var(--fg-dim);
+}
+.program-warn {
+  flex: none;
+  color: var(--warn);
+}
+.program-count {
+  flex: none;
+  color: var(--fg-dim);
+  margin-inline-start: auto;
+}
+.program-row.is-label,
+.program-row.is-heading {
+  color: var(--accent);
+  cursor: default;
+}
+.program-row.is-steps .program-cell {
+  padding-inline-start: 5ch;
+  gap: var(--space-1);
+}
+.program-step.is-now {
+  color: var(--fg);
+  border-color: var(--accent);
+  font-weight: 600;
+}
+.program-row.is-linked {
+  background: var(--link-bg);
+  border-inline-start-style: dashed;
+  border-inline-start-color: var(--link-edge);
+}
+.program-row.is-current {
+  background: color-mix(in oklab, var(--accent) 14%, var(--bg));
+  box-shadow: inset 3px 0 0 var(--accent);
+}
+.program-scroll:focus-visible .program-row.is-active {
+  outline: 2px solid var(--focus-ring);
+  outline-offset: -2px;
+}
+.program-arc,
+.program-link {
+  fill: none;
+  stroke: var(--fg-dim);
+  stroke-width: 1.3;
+}
+.program-arc.is-hot {
+  stroke: var(--accent);
+  stroke-width: 1.8;
+}
+.program-link {
+  stroke-dasharray: 3 2;
+}
+.program-side {
+  position: relative;
+  flex: none;
+  width: 11rem;
+  border-inline-start: 1px solid var(--rule);
+}
+.program-links {
+  position: absolute;
+  inset: 0;
+  width: 100%;
+  overflow: hidden;
+}
+.program-boxes {
+  position: absolute;
+  top: 0;
+}
+.program-box {
+  position: absolute;
+  display: flex;
+  gap: var(--space-2);
+  width: 104px;
+  height: 22px;
+  margin-top: 1px;
+  padding: 0 0.4em;
+  align-items: center;
+  font: inherit;
+  color: inherit;
+  background: var(--bg-raised);
+  border: 1px solid var(--rule);
+  border-radius: var(--radius);
+  cursor: pointer;
+}
+.program-side[hidden] {
+  display: none;
+}
+.program-box.is-linked {
+  background: var(--link-bg);
+  border-style: dashed;
+  border-color: var(--link-edge);
+}
+.program-box.is-current {
+  background: color-mix(in oklab, var(--accent) 14%, var(--bg));
+  box-shadow: inset 3px 0 0 var(--accent);
+}
+
+/* A TM VIEW'S OPEN PANELS SHARE ITS HEIGHT (spec §9.1): the rules two shares, the diagram and the outline one
+   each, each down to a floor, and a closed panel keeps only its header. Everything else in the view — the text panel, the status
    lines, the tapes — keeps its own height. The view is a flex column so the panels have a height to share,
    which `.pane` alone is not; below the floors the view scrolls, as it did. `data-kind` is `pane-host.ts`'s. */
 .pane[data-kind="tm"] {
@@ -1647,6 +1837,7 @@ main {
 /* NOT A HIDDEN ONE: `tm-pane.ts` hides the outline panel while the view holds no copy, and a `display` here would
    outrank the browser's `[hidden]` and show it anyway — `hidden.test.ts` found exactly that. */
 .tm-pane > .panel[data-panel="rules"][data-open="true"]:not([hidden]),
+.tm-pane > .panel[data-panel="diagram"][data-open="true"]:not([hidden]),
 .tm-pane > .panel[data-panel="outline"][data-open="true"]:not([hidden]) {
   display: flex;
   flex-direction: column;
@@ -1654,17 +1845,20 @@ main {
 .tm-pane > .panel[data-panel="rules"][data-open="true"] {
   flex: 2 1 0;
 }
+.tm-pane > .panel[data-panel="diagram"][data-open="true"],
 .tm-pane > .panel[data-panel="outline"][data-open="true"] {
   flex: 1 1 0;
 }
 /* THE FLOORS ARE THE BODIES', so a panel's own minimum is its header and a floor, whatever the header's height.
    Five rows each: the table's are `ROW_HEIGHT`, the outline's a line of its own. */
 .tm-pane > .panel[data-open="true"] > .state-table,
+.tm-pane > .panel[data-open="true"] > .state-diagram,
 .tm-pane > .panel[data-open="true"] > .outline {
   flex: 1 1 0;
   max-height: none;
 }
-.tm-pane > .panel[data-open="true"] > .state-table {
+.tm-pane > .panel[data-open="true"] > .state-table,
+.tm-pane > .panel[data-open="true"] > .state-diagram {
   min-height: calc(5 * 24px);
 }
 .tm-pane > .panel[data-open="true"] > .outline {
@@ -1672,35 +1866,9 @@ main {
 }
 /* `hidden` MUST STILL HIDE WHAT A `display` RULE LAYS OUT. The browser's own `[hidden] { display: none }` loses to
    any author rule that sets `display`, so every outline's list stayed on screen while its panel was closed — the
-   source view's from the first draw, since `panel.ts` hides a closed panel's body. `hidden.test.ts` looks for the
-   whole class across the app. */
-.outline[hidden] {
+   source view's from the first draw, since `panel.ts` hides a closed panel's body — and the state diagram's body
+   did the same until `hidden.test.ts`, which looks for the whole class across the app, found it. */
+.outline[hidden],
+.state-diagram[hidden] {
   display: none;
 }
-
-.outline-row {
-  text-align: left;
-  font: inherit;
-  padding: 0.15em 0.6em;
-  padding-inline-start: calc(0.6em + var(--outline-depth, 0) * 1em);
-  border: 1px solid transparent;
-  border-radius: var(--radius);
-  background: transparent;
-  color: inherit;
-  cursor: pointer;
-}
-.outline-row[data-depth="1"] {
-  --outline-depth: 1;
-}
-.outline-row[data-depth="2"] {
-  --outline-depth: 2;
-}
-.outline-row:hover {
-  background: var(--bg-raised);
-}
-.outline-empty {
-  margin: 0;
-  padding: 0.15em 0.6em;
-  font-size: var(--step--2);
-  color: var(--fg-dim);
-}
diff --git a/web/src/tm-pane.ts b/web/src/tm-pane.ts
index 4f43afb..e28b73c 100644
--- a/web/src/tm-pane.ts
+++ b/web/src/tm-pane.ts
@@ -11,12 +11,14 @@ import { valueLine } from './results'
 import type { ScratchEditorConfig } from './scratch-editor'
 import { ScratchEditor } from './scratch-editor'
 import type { Binding, PaneOption } from './sessions'
+import { StateDiagram } from './state-diagram'
 import { centredScrollTop, Follow, focusedRows, highlight, linkedRows, ROW_HEIGHT, StateIndex } from './state-table'
 import { stepControls } from './step-controls'
 import { tapeLabel, tapeRows } from './tape'
 import type { TmProgram, TmScratchStatus, TmState, ValueReading } from './types'
-import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
+import { radioGroup, type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
 import { visibleWindow } from './virtual-list'
+import type { TmDisplay } from './workspace'
 
 export { ROW_HEIGHT } from './state-table'
 
@@ -186,6 +188,14 @@ export class TmPane implements EditablePane {
   #rulesPanel: Panel
   /** This view's outline, present only while it holds an editable copy. */
   #outline: ReturnType<typeof createOutlinePanel>
+  /** The state diagram (spec §8) and its panel, whose header carries *arcs | chips* and its own re-attach. */
+  #diagram: StateDiagram
+  #diagramPanel: Panel
+  #diagramReattach: HTMLButtonElement
+  #edgesChoice: ReturnType<typeof radioGroup>
+  /** This view's display settings, and where a change to them is recorded — `LambdaPane`'s pair. */
+  #display: TmDisplay
+  #onDisplay: ((d: TmDisplay) => void) | undefined
   #reattach: HTMLButtonElement
   #index: StateIndex | null = null
   #follow = new Follow()
@@ -204,6 +214,8 @@ export class TmPane implements EditablePane {
   #pendingScroll: number | null = null
   /** The DOM index of `this.#rows.children[0]`, within `#index`. See `#drawTable`'s doc. */
   #firstDrawn = 0
+  /** The table's height at the last draw — how its `scroll` handler tells a clamp from a user's scroll. */
+  #drawnHeight = 0
   /**
    * The grid's active row (spec §9.2), **AN INDEX INTO `#index`, NOT INTO THE DRAWN WINDOW** — accessibility
    * item 3, which found a cursor designed against the rendered rows unable to move past them. The keys move it
@@ -215,14 +227,18 @@ export class TmPane implements EditablePane {
   #gridId = `tm-grid-${gridsMinted++}`
 
   /**
-   * `panels` is the view's stored panel state (`workspace.ts`'s `Panels`), read once here; the rules panel
-   * reports every later toggle through `on.panel`.
+   * `panels` is the view's stored panel state (`workspace.ts`'s `Panels`), read once here; each panel reports
+   * every later toggle through `on.panel`. `display` is its stored display settings, reported through
+   * `on.tmDisplay`.
    */
   constructor(
     host: HTMLElement,
     on: PaneEvents,
-    panels: { readonly rules?: boolean; readonly outline?: boolean } = {},
+    panels: { readonly rules?: boolean; readonly diagram?: boolean; readonly outline?: boolean } = {},
+    display: TmDisplay = { edges: 'arcs' },
   ) {
+    this.#display = display
+    this.#onDisplay = on.tmDisplay
     this.#header = viewHeader(on.rebind)
     this.#status = document.createElement('div')
     this.#status.className = 'tm-status'
@@ -295,6 +311,9 @@ export class TmPane implements EditablePane {
       // Chromium: step, close the rules panel, reopen it, and the table is detached with the current row
       // gone from the DOM. A hidden box cannot be scrolled by a person, so there is nothing here to honour.
       if (!this.#rulesPanel.isOpen()) return
+      // A TABLE THAT CHANGED HEIGHT SINCE IT WAS DRAWN MAY HAVE HAD ITS SCROLL CLAMPED (spec §9.1 made its height
+      // the view's), and this event can come before the resize observer's — `StateDiagram`'s handler says how.
+      if (this.#tableHost.clientHeight !== this.#drawnHeight) this.#follow.onResize(this.#tableHost.scrollTop)
       this.#follow.onScroll(this.#tableHost.scrollTop)
       this.#drawTable()
     })
@@ -352,7 +371,54 @@ export class TmPane implements EditablePane {
     this.#tableHost.addEventListener('keydown', (e) => this.#key(e, on.linkState))
     // THE TABLE'S HEIGHT IS THE VIEW'S NOW, NOT THE VIEWPORT'S (spec §9.1): a divider drag, a panel opening
     // beside it or a window resize changes it with no frame or scroll to redraw the window it draws.
-    new ResizeObserver(() => this.#drawTable()).observe(this.#tableHost)
+    new ResizeObserver(() => {
+      this.#follow.onResize(this.#tableHost.scrollTop)
+      this.#drawTable()
+    }).observe(this.#tableHost)
+
+    // THE STATE DIAGRAM (spec §8): a panel beside the rules, open by default since it is the view's map of the
+    // machine, with *arcs | chips* among its header actions (amendment 11) and a re-attach of its own, for the
+    // rule table's reason: following is per surface, and a scroll in one must not detach the other.
+    this.#diagram = new StateDiagram({
+      link: (state) => on.linkState?.(state),
+      moved: () => this.#syncDiagramReattach(),
+    })
+    this.#diagram.setEdges(display.edges)
+    this.#diagramReattach = document.createElement('button')
+    this.#diagramReattach.type = 'button'
+    this.#diagramReattach.className = 'diagram-reattach'
+    this.#diagramReattach.textContent = 'follow current state'
+    this.#diagramReattach.hidden = true
+    this.#diagramReattach.addEventListener('click', () => {
+      const had = document.activeElement === this.#diagramReattach
+      this.#diagram.attach()
+      this.#syncDiagramReattach()
+      if (had && this.#diagramReattach.hidden) this.#diagramPanel.toggle.focus()
+    })
+    this.#edgesChoice = radioGroup(
+      {
+        label: 'edges',
+        choices: [
+          { value: 'arcs', label: 'arcs' },
+          { value: 'chips', label: 'chips' },
+        ],
+        current: () => this.#display.edges,
+        pick: (v) => this.#setDisplay({ ...this.#display, edges: v === 'chips' ? 'chips' : 'arcs' }),
+      },
+      'diagram-mode',
+    )
+    this.#diagramPanel = createPanel({
+      name: 'diagram',
+      label: 'state diagram',
+      body: this.#diagram.el,
+      open: panels.diagram ?? true,
+      onToggle: (open) => {
+        this.#diagram.redraw()
+        this.#syncDiagramReattach()
+        on.panel?.('diagram', open)
+      },
+    })
+    this.#diagramPanel.actions.append(this.#diagramReattach, this.#edgesChoice.el)
 
     // **A TM VIEW'S OUTLINE IS ITS STATES** — measured against the real server, which answers a
     // `state` block per symbol at kind 5. Closed by default, like the source view's: a machine of
@@ -380,6 +446,7 @@ export class TmPane implements EditablePane {
       this.#value,
       this.#tapes,
       this.#rulesPanel.el,
+      this.#diagramPanel.el,
       this.#outline.panel.el,
     )
     this.#header.steps.append(this.#steps.el)
@@ -412,6 +479,24 @@ export class TmPane implements EditablePane {
     this.#tableHost.scrollTop = 0
     this.#frame = null
     this.#drawTable()
+    this.#diagram.setProgram(p)
+    this.#syncDiagramReattach()
+  }
+
+  /** Record a changed display, draw it, and report it for the workspace — `LambdaPane.#setDisplay`'s shape. */
+  #setDisplay(d: TmDisplay): void {
+    this.#display = d
+    this.#diagram.setEdges(d.edges)
+    this.#edgesChoice.sync()
+    this.#onDisplay?.(d)
+  }
+
+  /**
+   * The diagram's re-attach exists only while it does something, as the rules panel's does: hidden while the
+   * diagram follows, and while its panel is closed.
+   */
+  #syncDiagramReattach(): void {
+    this.#diagramReattach.hidden = this.#diagram.following || !this.#diagramPanel.isOpen()
   }
 
   /**
@@ -433,6 +518,7 @@ export class TmPane implements EditablePane {
    */
   setLink(states: number[], scrollTo: boolean): void {
     this.#linked = this.#index === null ? new Set() : linkedRows(this.#index, states)
+    this.#diagram.setLinked(states)
     if (scrollTo && this.#index !== null && this.#rulesPanel.isOpen()) {
       const first = [...this.#linked].sort((a, b) => a - b)[0]
       if (first !== undefined) {
@@ -807,6 +893,8 @@ export class TmPane implements EditablePane {
   render(frame: TmState | null, controls: ControlState): void {
     this.#frame = frame
     this.#steps.update(controls)
+    this.#diagram.render(this.#program === null ? null : frame)
+    this.#syncDiagramReattach()
     if (frame === null || this.#program === null) {
       this.#drawStatus()
       this.#tapes.replaceChildren()
@@ -927,6 +1015,7 @@ export class TmPane implements EditablePane {
     // browser tier loads `style.css` (`tests/browser/setup.ts`) and asserts this box stays bounded, so that
     // gap fails a test rather than silently costing O(rowCount) per frame.
     const viewportHeight = this.#tableHost.clientHeight
+    this.#drawnHeight = viewportHeight
     const marks = highlight(this.#index, this.#frame)
     // A PENDING LINK SCROLL WINS OVER THE FOLLOW TARGET FOR EXACTLY THIS DRAW, then is consumed —
     // design §5.1. Read and cleared together so a link recorded during THIS call is what the very next
diff --git a/web/src/workspace.ts b/web/src/workspace.ts
index 6c2f7c6..ca6834c 100644
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -70,6 +70,16 @@ export const DEFAULT_DISPLAY: LambdaDisplay = { layout: 'code', vars: 'names', m
 /** Each λ view's display settings, by leaf — a view with none stored draws with `DEFAULT_DISPLAY`. */
 export type Displays = Readonly<Record<LeafId, LambdaDisplay>>
 
+/** How a TM view draws its state diagram (Plan 7 part 4, spec §8 and amendment 11): its program level's edges. */
+export type TmDisplay = {
+  readonly edges: 'arcs' | 'chips'
+}
+
+export const DEFAULT_TM_DISPLAY: TmDisplay = { edges: 'arcs' }
+
+/** Each TM view's display settings, by leaf — a view with none stored draws with `DEFAULT_TM_DISPLAY`. */
+export type TmDisplays = Readonly<Record<LeafId, TmDisplay>>
+
 export type Workspace = {
   readonly tree: LayoutNode
   readonly switches: Switches
@@ -88,6 +98,11 @@ export type Workspace = {
   readonly inspector: boolean
   /** Each λ view's display settings (Plan 7 part 4a) — absent in a workspace stored before it. */
   readonly display: Displays
+  /**
+   * Each TM view's display settings (Plan 7 part 4b) — absent in a workspace stored before it. A field of its
+   * own rather than a second shape in `display`, so neither leg's parser has to tell the other's entries apart.
+   */
+  readonly tmDisplay: TmDisplays
 }
 
 export const WORKSPACE_VERSION = 2
@@ -111,6 +126,7 @@ export function defaultWorkspace(): Workspace {
     panels: {},
     inspector: true,
     display: {},
+    tmDisplay: {},
   }
 }
 
@@ -119,6 +135,11 @@ export function withDisplay(display: Displays, leaf: LeafId, d: LambdaDisplay):
   return { ...display, [leaf]: d }
 }
 
+/** `tmDisplay` with one TM view's settings recorded — `withDisplay`'s twin. */
+export function withTmDisplay(tmDisplay: TmDisplays, leaf: LeafId, d: TmDisplay): TmDisplays {
+  return { ...tmDisplay, [leaf]: d }
+}
+
 /** `panels` with one panel of one view recorded — a new object, as every operation in `layout.ts` returns. */
 export function withPanel(panels: Panels, leaf: LeafId, name: string, open: boolean): Panels {
   return { ...panels, [leaf]: { ...panels[leaf], [name]: open } }
@@ -138,6 +159,8 @@ export function serializeWorkspace(ws: Workspace): string {
   for (const [leaf, open] of Object.entries(ws.panels)) if (live.has(leaf)) panels[leaf] = { ...open }
   const display: Record<LeafId, LambdaDisplay> = {}
   for (const [leaf, d] of Object.entries(ws.display)) if (live.has(leaf)) display[leaf] = d
+  const tmDisplay: Record<LeafId, TmDisplay> = {}
+  for (const [leaf, d] of Object.entries(ws.tmDisplay)) if (live.has(leaf)) tmDisplay[leaf] = d
   return JSON.stringify({
     version: WORKSPACE_VERSION,
     tree: ws.tree,
@@ -147,6 +170,7 @@ export function serializeWorkspace(ws: Workspace): string {
     panels,
     inspector: ws.inspector,
     display,
+    tmDisplay,
   })
 }
 
@@ -185,6 +209,19 @@ function parseDisplay(v: unknown, ids: ReadonlySet<string>): Displays | null {
   return out
 }
 
+/** A stored `tmDisplay`, or `null` for a malformed one — absent is not malformed, for `parseDisplay`'s reason. */
+function parseTmDisplay(v: unknown, ids: ReadonlySet<string>): TmDisplays | null {
+  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
+  const out: Record<LeafId, TmDisplay> = {}
+  for (const [leaf, d] of Object.entries(v as Record<string, unknown>)) {
+    if (!ids.has(leaf) || typeof d !== 'object' || d === null) return null
+    const { edges } = d as Record<string, unknown>
+    if (edges !== 'arcs' && edges !== 'chips') return null
+    out[leaf] = { edges }
+  }
+  return out
+}
+
 function parsePanels(v: unknown, ids: ReadonlySet<string>): Panels | null {
   if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
   const out: Record<LeafId, Record<string, boolean>> = {}
@@ -231,6 +268,7 @@ export function parseWorkspace(raw: string | null): Workspace | null {
       panels: {},
       inspector: true,
       display: {},
+      tmDisplay: {},
     }
   }
   if (e.version !== WORKSPACE_VERSION) return null
@@ -251,5 +289,16 @@ export function parseWorkspace(raw: string | null): Workspace | null {
   if (e.inspector !== undefined && typeof e.inspector !== 'boolean') return null
   const display = e.display === undefined ? {} : parseDisplay(e.display, ids)
   if (display === null) return null
-  return { tree, switches, speed: e.speed, focused: e.focused, panels, inspector: e.inspector ?? true, display }
+  const tmDisplay = e.tmDisplay === undefined ? {} : parseTmDisplay(e.tmDisplay, ids)
+  if (tmDisplay === null) return null
+  return {
+    tree,
+    switches,
+    speed: e.speed,
+    focused: e.focused,
+    panels,
+    inspector: e.inspector ?? true,
+    display,
+    tmDisplay,
+  }
 }
```

- [ ] **Step 4: Run the tests.**

Run: `cd web && pnpm exec vitest run --project node && pnpm exec vitest run --project browser tests/browser/state-diagram.test.ts tests/browser/tm-follow-clamp.test.ts tests/browser/tm-grid.test.ts tests/browser/hidden.test.ts tests/browser/hidden-views.test.ts`
Expected: `Test Files  50 passed (50)`, `Tests  672 passed (672)`; then `Test Files  5 passed (5)`, `Tests  27 passed (27)`.

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (`pnpm exec vitest run tests/browser/state-diagram.test.ts tests/browser/tm-grid.test.ts tests/browser/tm-follow-clamp.test.ts tests/browser/hidden-views.test.ts tests/node/state-table.test.ts`):

| Sabotage | Fails |
|---|---|
| `state-diagram.ts`: chips always seen | `keeps the arcs' words on each row for a screen reader, unseen` |
| `state-diagram.ts`: `programRows(groups, [], …)` | `lists the program: a row per instruction under its labels, and the runtime routines beside it` |
| `state-diagram.ts`: drop the row's `aria-current` | `opens the current instruction onto its sub-steps, and follows the run`, `keeps the active row on its row when the sub-steps row moves past it`, `scrolls to follow the current row when the listing is taller than the diagram` |
| `state-diagram.ts`: no step marked `is-now` | `opens the current instruction onto its sub-steps, and follows the run` |
| `state-diagram.ts`: link `row.group` instead of the group's first state | `links a row's construct, as a click on the rule table does`, `moves the grid's active row by key, and links on Enter` |
| `state-diagram.ts`: drop the runtime box's `aria-current` | `lists the program: a row per instruction under its labels, and the runtime routines beside it` |
| `state-diagram.ts`: drop the scroll handler's height check | `detaches following on a scroll, and its header action re-attaches it`, `scrolls to follow the current row when the listing is taller than the diagram`, `stays following when a panel beside it closes and its scroll is clamped` |
| `state-table.ts`: `onResize` records nothing | 5 cases, among them `does not detach on the scroll a resize clamped` |
| `tm-pane.ts`: `#setDisplay` does not report the display | `writes each row its edges and gives the runtime routines rows of their own, and keeps the choice`, `keeps a runtime box's focus while the run moves, and the column is one tab stop` |
| `state-diagram.ts`: the runtime column in *chips* too | `writes each row its edges and gives the runtime routines rows of their own, and keeps the choice` |
| `state-diagram.ts`: the program level's resize observer does nothing — neither `onResize` nor a draw | `detaches following on a scroll, and its header action re-attaches it`, `writes each row its edges and gives the runtime routines rows of their own, and keeps the choice`, `keeps the active row on its row when the sub-steps row moves past it` |
| `tm-pane.ts`: drop the table's `onResize` in its resize observer | `is still following once a panel beside it closes and its scroll is clamped` |
| `state-diagram.ts`: no gutter | `draws each jump and call as an arc, and a rule into overflow as a ⚠`, `writes each row its edges and gives the runtime routines rows of their own, and keeps the choice` |
| `replies.ts`: hand a hidden TM view each compile | `does not hand a hidden TM view each compile, and seeds it when it is shown`, `groups and draws no state diagram for a hidden TM view, and does both once it is shown` |
| `draw.ts`: paint a view off the page | `does not hand a hidden TM view each compile, and seeds it when it is shown`, `groups and draws no state diagram for a hidden TM view, and does both once it is shown` |
| `tm-pane.ts`: drop the table's scroll-handler height check | **does not fire** — no test produces the scroll-first order for the table; recorded, not hidden |
| `state-diagram.ts`: keep the active row by index across `#layout` | `keeps the active row on its row when the sub-steps row moves past it` |
| `state-diagram.ts`: rebuild the runtime boxes in `#layout` | `keeps a runtime box's focus while the run moves, and the column is one tab stop` |
| `state-diagram.ts`: every runtime box a tab stop | `keeps a runtime box's focus while the run moves, and the column is one tab stop` |
| `state-diagram.ts`: never write the follow target | `scrolls to follow the current row when the listing is taller than the diagram`, `stays following when a panel beside it closes and its scroll is clamped` |
| `state-diagram.ts`: drop the diagram's resize observer's `onResize` | **does not fire** — in the diagram the `scroll` comes first, and the height check answers it; the table shows the other order (row 12) |

- [ ] **Step 6: Run the gates.**

Run: `cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings`
Expected: both exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The state diagram's program level: arcs and chips, following, linking

A panel beside the rules (spec §8): one row per instruction under its labels, with its state count and
a warning where it reaches overflow; the current instruction opens onto its sub-steps. The edges are
drawn as arcs in a gutter with the runtime routines in a column of their own, or written as chips on
each row, toggled in the panel's header and kept per view (amendment 11); in arcs the chips stay as
the arcs' words for a screen reader. It is a grid like the rule table, follows the run, links a row's
construct, and costs nothing off the page. A resize that clamps a following view's scroll no longer
reads as the user scrolling away (`Follow.onResize`).
EOF
```

### Task 6: The state diagram's local level, and the switch between the two

**Files:**
- Create: `web/src/local-level.ts`
- Modify: `web/src/state-diagram.ts`
- Modify: `web/src/style.css`
- Modify: `web/src/tm-pane.ts`
- Modify: `web/src/view-header.ts`
- Modify: `web/src/workspace.ts`
- Create: `web/tests/browser/state-diagram-local.test.ts`
- Modify: `web/tests/browser/state-diagram.test.ts`
- Create: `web/tests/browser/tm-display-restore.test.ts`
- Create: `web/tests/node/local-level.test.ts`
- Modify: `web/tests/node/workspace.test.ts`

**Interfaces:**
- Consumes: Task 5's `StateDiagram`, `TmDisplay`, `radioGroup`.
- Produces: `local-level.ts` — `REACH = 2`, `LocalNode { state, column }`, `LocalEdge { from, to, label, next }`, `Local`, `predecessors(p)`, `ruleLabel(rule, names)`, `localLevel(p, into, current, rule, names)`. `StateDiagram`: `Level = 'program' | 'local'`, `tier`, `shown`, `setLevel(level)`, `setProgram(p, names)`, and `DiagramEvents.showStates?`. `radioGroup`'s `DisplayGroup` gains `disabled?()` for the whole group and per choice. `TmDisplay` gains `level`.
- *program | local* sits in the diagram's header before *arcs | chips*; *arcs | chips* is disabled at the local level, and *program* is disabled for a machine with no program level, each with its reason.

**THE LOCAL LEVEL IS REBUILT WHEN THE STATE CHANGES, NOT EVERY FRAME**, only while it is shown, and only while it is drawn: a closed panel lays out nothing and marks the level stale, and a width it was not laid out for — reopening, a divider, the window — lays it out again. `predecessors` is built once per machine and is linear — `overflow` has a predecessor in nearly every gadget, and a search of its list per rule was quadratic in them.

**THE FOCUS SURVIVES THE LEVEL.** A node holding the focus is rebuilt on every state change, and the level it was in is hidden by a switch: both dropped the focus to `<body>` in the first draft. After a rebuild the active node takes it; after a switch, the shown level's tab stop. **Each node says what the hidden SVG draws** — its distance and its edges out, the next rule's marked — as its `aria-description`. *Show states* is its button's, first in its row so twenty sub-steps cannot clip it, or Enter's on the row; a click elsewhere on the row switches nothing.

- [ ] **Step 1: Write the failing tests.** `local-level.test.ts`, `state-diagram-local.test.ts` and `tm-display-restore.test.ts` are new; the tests' half adds `level` to the stored display the earlier cases expect.

Create `web/tests/browser/state-diagram-local.test.ts`:

```ts file=web/tests/browser/state-diagram-local.test.ts
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { SHELL, until } from './harness'

/**
 * The state diagram's local level and its switch (Plan 7 part 4, spec §7, §8 and amendment 10): the current state
 * and every state within two rules of it, in signed columns; *show states*; and a machine with no program level.
 */

let view: EditorView

const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
/** A machine whose names carry no dots and whose states no instruction built: §7's third tier. */
const FLAT = 'tapes 1\nstart q0\n\nstate q0:\n  [*] -> write [*], move [R], goto q1\nstate q1: accept\n'

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const diagram = () => pane().querySelector('[data-panel="diagram"]') as HTMLElement
const nodes = () => [...diagram().querySelectorAll<HTMLElement>('.local-node')]
const choice = (value: string) =>
  [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)
const status = () => pane().querySelector('.tm-status')?.textContent ?? ''
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
/** Whether an element is drawn: `hidden` is not enough, since an author `display` can outrank it. */
const drawn = (sel: string) => getComputedStyle(diagram().querySelector(sel) as HTMLElement).display !== 'none'
async function stepUntilStateChanges(): Promise<void> {
  const at = status()
  for (let i = 0; i < 200 && status() === at; i += 1) control('▶')?.click()
  await until(() => status() !== at, 'the state to change')
}
const control = (label: string) =>
  [...pane().querySelectorAll<HTMLButtonElement>('.controls button')].find((b) => b.textContent === label)
/**
 * From step 0 to the first step inside `cmpeq` — 1,732 steps forward, where stepping back from the frontier took
 * about 9,000, one redraw each, and ran past the test's time under a full suite's load.
 */
async function intoCmpeq(): Promise<void> {
  control('↺')?.click()
  for (let i = 0; i < 20_000 && !/^cmp/.test(status()); i += 1) control('▶')?.click()
  await until(() => /^cmp/.test(status()), 'the machine to be inside cmpeq')
}

beforeAll(async () => {
  await page.viewport(1280, 2400)
  document.body.innerHTML = SHELL
  view = await (await import('../../src/main')).ready
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: FACT3 } })
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the app to settle')
  pane().querySelector<HTMLButtonElement>('[data-panel="rules"] .panel-toggle')?.click()
  // Inside `cmpeq`, where the current instruction opens onto its sub-steps and its states run in a line.
  await intoCmpeq()
})

describe('the local level (spec §8)', () => {
  it("is what the current instruction's show states opens, and the focus goes with it", async () => {
    // The button comes first in its row, so a long list of sub-steps cannot push it past the row's clipped end.
    const show = diagram().querySelector<HTMLButtonElement>('.program-show') as HTMLButtonElement
    const cell = show.closest('.program-cell') as HTMLElement
    expect(show.getBoundingClientRect().right).toBeLessThanOrEqual(cell.getBoundingClientRect().right)
    // A click on a sub-step is a click on a row: it shows nothing and switches nothing.
    ;(cell.querySelector('.program-step') as HTMLElement).click()
    expect(drawn('.program-level')).toBe(true)
    expect(choice('program')?.getAttribute('aria-checked')).toBe('true')
    // From the keyboard: Enter on the sub-steps row, whose grid holds the focus.
    const grid = diagram().querySelector('.program-scroll') as HTMLElement
    grid.focus()
    const steps = show.closest('.program-row') as HTMLElement
    const index = Number(steps.getAttribute('aria-rowindex')) - 1
    await userEvent.keyboard('{Home}')
    for (let i = 0; i < index; i += 1) await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    await until(() => nodes().length > 0, 'the local level to draw')
    expect(drawn('.program-level')).toBe(false)
    expect(drawn('.local-level')).toBe(true)
    expect(choice('local')?.getAttribute('aria-checked')).toBe('true')
    // The grid it was in is hidden, so the focus is on the local level's tab stop rather than on the page.
    expect((document.activeElement as HTMLElement).classList.contains('local-node')).toBe(true)
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0)
    const stored = JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')
    expect(stored.tmDisplay?.['tm-0']).toEqual({ level: 'local', edges: 'arcs' })
  })

  it('draws the current state in column 0 and its neighbours at signed distances', () => {
    const current = nodes().filter((n) => n.getAttribute('aria-current') === 'step')
    expect(current).toHaveLength(1)
    expect(current[0]?.textContent).toBe(status().split(' ')[0])
    expect(current[0]?.dataset.column).toBe('0')
    const columns = new Set(nodes().map((n) => Number(n.dataset.column)))
    expect([...columns].every((c) => c >= -2 && c <= 2)).toBe(true)
    // A state inside a gadget has a way in and a way on.
    expect([...columns].some((c) => c < 0)).toBe(true)
    expect([...columns].some((c) => c > 0)).toBe(true)
  })

  it("labels its edges with the tapes their rules touch, and marks the next rule's", () => {
    const labels = [...diagram().querySelectorAll('.local-label')].map((l) => l.textContent ?? '')
    expect(labels.length).toBeGreaterThan(0)
    // Each label is a list of `tape:read…` or `*`, never a tape the rule leaves alone.
    for (const label of labels) {
      for (const part of label.split(', ')) expect(part).toMatch(/^(\*|([A-Z]+:\S+( [LR])?)( [A-Z]+:\S+( [LR])?)*)$/)
    }
    expect(diagram().querySelectorAll('.local-edge.is-next')).toHaveLength(1)
  })

  it("says each node's distance and edges, since the drawing of them is hidden from a reader", () => {
    const current = nodes().find((n) => n.getAttribute('aria-current') === 'step') as HTMLElement
    const said = current.getAttribute('aria-description') ?? ''
    expect(said).toMatch(/^the current state; to /)
    expect(said).toMatch(/, fires next/)
    const behind = nodes().find((n) => Number(n.dataset.column) === -1) as HTMLElement
    expect(behind.getAttribute('aria-description')).toMatch(/^1 rule behind/)
  })

  it('keeps the focus on a node while the run moves the level', async () => {
    nodes()
      .find((n) => n.tabIndex === 0)
      ?.focus()
    await stepUntilStateChanges()
    await frame()
    expect((document.activeElement as HTMLElement).classList.contains('local-node')).toBe(true)
  })

  it('lays out nothing while its panel is closed, and lays out for its width once it opens', async () => {
    const toggle = diagram().querySelector('.panel-toggle') as HTMLButtonElement
    toggle.click()
    let mutations = 0
    const watch = new MutationObserver((records) => {
      mutations += records.length
    })
    watch.observe(diagram().querySelector('.local-nodes') as HTMLElement, { childList: true, subtree: true })
    for (let i = 0; i < 3; i += 1) await stepUntilStateChanges()
    await frame()
    watch.disconnect()
    expect(mutations).toBe(0)
    toggle.click()
    await until(() => nodes().some((n) => n.textContent === status().split(' ')[0]), 'the level at the current state')
    const level = diagram().querySelector('.local-level') as HTMLElement
    const svg = diagram().querySelector('.local-edges') as SVGSVGElement
    expect(Number(svg.getAttribute('width'))).toBe(Math.max(level.clientWidth, 750))
  })

  it('lays out again for a width it was not laid out for, with the state unchanged', async () => {
    const level = diagram().querySelector('.local-level') as HTMLElement
    const svg = diagram().querySelector('.local-edges') as SVGSVGElement
    const before = Number(svg.getAttribute('width'))
    await page.viewport(1000, 2400)
    await until(() => level.clientWidth < before, 'the view to narrow')
    await frame()
    await frame()
    expect(Number(svg.getAttribute('width'))).toBe(Math.max(level.clientWidth, 750))
    expect(Number(svg.getAttribute('width'))).toBeLessThan(before)
    await page.viewport(1280, 2400)
  })

  it('is one tab stop whose arrows move between states, and links the one Enter is on', async () => {
    const stops = nodes().filter((n) => n.tabIndex === 0)
    expect(stops).toHaveLength(1)
    stops[0]?.focus()
    await userEvent.keyboard('{ArrowLeft}')
    const moved = document.activeElement as HTMLElement
    expect(moved.classList.contains('local-node')).toBe(true)
    expect(Number(moved.dataset.column)).toBeLessThan(0)
    expect(nodes().filter((n) => n.tabIndex === 0)).toEqual([moved])
    await userEvent.keyboard('{Enter}')
    await until(() => moved.classList.contains('is-linked'), 'the state to be linked')
  })

  it('disables arcs | chips there, and says why', () => {
    for (const value of ['arcs', 'chips']) {
      expect(choice(value)?.disabled).toBe(true)
      expect(choice(value)?.getAttribute('aria-description')).toBe('arcs and chips draw the program level')
    }
    choice('program')?.click()
    expect(drawn('.local-level')).toBe(false)
    expect(drawn('.program-level')).toBe(true)
    expect(choice('arcs')?.disabled).toBe(false)
  })
})

describe('a machine with no program level (spec §7)', () => {
  it('shows the local level alone, with program disabled and its reason stated', async () => {
    pane().querySelector<HTMLButtonElement>('button.detach')?.click()
    const editor = await (async () => {
      await until(() => pane().querySelector('.term-editor .cm-editor') !== null, 'the copy to mount its editor')
      return pane().querySelector('.term-editor .cm-content') as HTMLElement
    })()
    const copy = (await import('@codemirror/view')).EditorView.findFromDOM(editor)
    copy?.dispatch({ changes: { from: 0, to: copy.state.doc.length, insert: FLAT } })
    await until(() => nodes().some((n) => n.textContent === 'q0'), 'the copy to compile and draw q0')
    expect(choice('program')?.disabled).toBe(true)
    expect(choice('program')?.getAttribute('aria-description')).toMatch(/no program level/)
    expect(choice('local')?.getAttribute('aria-checked')).toBe('true')
    expect(drawn('.program-level')).toBe(false)
    // The keys pass over the choice that cannot be made: an arrow from `local` finds nothing to move to, and the
    // stored level is not changed behind the reader's back. Chosen first, so the level stored is `local` and a key
    // that landed on `program` would show.
    choice('local')?.click()
    const before = JSON.parse(localStorage.getItem('redextape.layout') ?? '{}').tmDisplay?.['tm-0']
    expect(before?.level).toBe('local')
    choice('local')?.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(choice('local'))
    expect(JSON.parse(localStorage.getItem('redextape.layout') ?? '{}').tmDisplay?.['tm-0']).toEqual(before)
  })
})
```

Create `web/tests/browser/tm-display-restore.test.ts`:

```ts file=web/tests/browser/tm-display-restore.test.ts
import { beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { LAYOUT_STORAGE_KEY } from '../../src/layout'
import { defaultWorkspace, serializeWorkspace } from '../../src/workspace'
import { SHELL, until } from './harness'

/**
 * **A TM VIEW IS BUILT WITH THE DISPLAY ITS WORKSPACE STORED** (Plan 7 part 4, spec §8 and §11). Seeded before
 * `main.ts` is imported, as `lambda-display-restore.test.ts` is, and for its reason: only the seed crosses all
 * three places the display does on its way back — `main.ts` restoring it into the workspace, `tmDisplayOf`
 * answering for the leaf, and `pane-host.ts` building the view with it. A click reads a display this page wrote a
 * moment earlier, never one it loaded.
 *
 * **BOTH FIELDS AWAY FROM THEIR DEFAULTS, AND ONE OF THEM DISABLED**: at the local level *arcs | chips* cannot
 * apply, so the stored *chips* is only seen once the level is switched back — and it must still be there.
 */
beforeAll(async () => {
  await page.viewport(1280, 2400)
  localStorage.setItem(
    LAYOUT_STORAGE_KEY,
    serializeWorkspace({ ...defaultWorkspace(), tmDisplay: { 'tm-0': { level: 'local', edges: 'chips' } } }),
  )
  document.body.innerHTML = SHELL
  await (await import('../../src/main')).ready
  await until(() => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle', 'the first compile')
})

const pane = () => document.querySelector('[data-leaf="tm-0"]') as HTMLElement
const diagram = () => pane().querySelector('[data-panel="diagram"]') as HTMLElement
const choice = (value: string) =>
  [...diagram().querySelectorAll<HTMLButtonElement>('.diagram-mode')].find((b) => b.dataset.value === value)
/** Whether an element is drawn: `hidden` is not enough, since an author `display` can outrank it. */
const drawn = (sel: string) => getComputedStyle(diagram().querySelector(sel) as HTMLElement).display !== 'none'

describe('a TM view restored from a stored workspace', () => {
  it('draws the level and the edges the workspace stored for it', async () => {
    await until(() => diagram().querySelectorAll('.local-node').length > 0, 'the local level to draw')
    expect(drawn('.local-level')).toBe(true)
    expect(drawn('.program-level')).toBe(false)
    expect(choice('local')?.getAttribute('aria-checked')).toBe('true')
    expect(choice('chips')?.getAttribute('aria-checked')).toBe('true')
    expect(choice('chips')?.disabled).toBe(true)
    // THE PROGRAM LEVEL IS KEPT CURRENT WHILE HIDDEN, and in *chips* it has no runtime column. Asked before the
    // switch, whose own `setEdges` would draw *chips* whether or not the view was built with it.
    expect(diagram().querySelector('.program-side')?.hasAttribute('hidden')).toBe(true)
    choice('program')?.click()
    await until(() => diagram().querySelectorAll('.program-row').length > 0, 'the program level to draw')
    expect(drawn('.program-level')).toBe(true)
    expect(diagram().querySelector('.program-side')?.hasAttribute('hidden')).toBe(true)
    expect(diagram().querySelectorAll('.program-arc')).toHaveLength(0)
    const chips = diagram().querySelector('.program-chips') as HTMLElement
    expect(chips.classList.contains('visually-hidden')).toBe(false)
  })

  /**
   * **A LEAF ID COMES BACK, AND ITS OLD DISPLAY MUST NOT COME WITH IT** — the rule `lambda-display-restore.test.ts`
   * holds for the λ view. `defaultLayout()` re-mints `tm-0`, so *reset preset* after closing the TM view hands its
   * id to a new view, which must be built with the defaults.
   */
  it('does not give a re-minted view the display of the one that closed', async () => {
    pane().querySelector<HTMLButtonElement>('button.view-close')?.click()
    await until(() => document.querySelector('[data-leaf="tm-0"]') === null, 'the TM view to close')
    document.querySelector<HTMLButtonElement>('#reset-preset')?.click()
    await until(
      () => document.querySelector('[data-leaf="tm-0"] [data-panel="diagram"] .program-row') !== null,
      'the re-minted view’s program level',
    )
    expect(choice('program')?.getAttribute('aria-checked')).toBe('true')
    expect(choice('arcs')?.getAttribute('aria-checked')).toBe('true')
    // The sample jumps nowhere, so *arcs* draws no arc: it is told by its runtime column and its unseen chips.
    expect(diagram().querySelector('.program-side')?.hasAttribute('hidden')).toBe(false)
    const chips = diagram().querySelector('.program-chips') as HTMLElement
    expect(chips.classList.contains('visually-hidden')).toBe(true)
  })
})
```

Create `web/tests/node/local-level.test.ts`:

```ts file=web/tests/node/local-level.test.ts
import { describe, expect, it } from 'vitest'
import { localLevel, predecessors, REACH, ruleLabel } from '../../src/local-level'
import type { RuleView, TmProgram } from '../../src/types'
import { COMPILED, state } from './tm-machines'

const rule = (over: Partial<RuleView>): RuleView => ({
  read: [null, null],
  write: [null, null],
  moves: ['S', 'S'],
  next: 0,
  ...over,
})

describe('a rule as an edge label (spec §8)', () => {
  it('names only the tapes the rule touches', () => {
    expect(ruleLabel(rule({ read: ['1', null], moves: ['L', 'S'] }), ['reg', 'work'])).toBe('reg:1 L')
    expect(ruleLabel(rule({ read: [null, '_'], write: [null, '1'] }), ['reg', 'work'])).toBe('work:_/1')
    expect(ruleLabel(rule({ moves: ['S', 'R'] }), ['reg', 'work'])).toBe('work:* R')
  })

  it('says `*` for a rule that touches no tape, and numbers a tape it has no name for', () => {
    expect(ruleLabel(rule({}), ['reg', 'work'])).toBe('*')
    expect(ruleLabel(rule({ read: ['1', null] }), [])).toBe('tape 0:1')
  })
})

/**
 * A line of states with one branch back: 0 -> 1 -> 2 -> 3 -> 4 -> 5, 2 -> 2 (a self-loop), and 4 -> 1.
 * From 2: ahead 3 (1) and 4 (2); behind 1 (1), and 0 and 4 (2) — so 4 is within reach both ways.
 */
const LINE: TmProgram = {
  ...COMPILED,
  states: [
    state('s0', null, 1),
    state('s1', null, 2),
    state('s2', null, 2, 3),
    state('s3', null, 4),
    state('s4', null, 5, 1),
    state('s5', null),
  ],
  listing: [],
  labels: [],
}

describe('the local level (spec §8, amendment 10)', () => {
  const into = predecessors(LINE)

  it('lists each predecessor once', () => {
    expect(into[2]).toEqual([1, 2])
    expect(into[1]).toEqual([0, 4])
  })

  it(`reaches ${REACH} rules each way, in signed columns, and a state reachable both ways takes its forward one`, () => {
    const { nodes } = localLevel(LINE, into, 2, null, [])
    expect(nodes.map((n) => [n.state, n.column])).toEqual([
      [0, -2],
      [1, -1],
      [2, 0],
      [3, 1],
      [4, 2],
    ])
  })

  it('draws the rules among them, a self-loop included, and none to a state beyond its reach', () => {
    const { edges } = localLevel(LINE, into, 2, null, [])
    const pairs = edges.map((e) => [e.from, e.to])
    expect(pairs).toEqual(
      expect.arrayContaining([
        [0, 1],
        [1, 2],
        [2, 2],
        [2, 3],
        [3, 4],
        [4, 1],
      ]),
    )
    expect(pairs).not.toContainEqual([4, 5])
    expect(edges).toHaveLength(6)
  })

  it('marks the edge of the rule about to fire, and only that one', () => {
    // State 2's rule 1 is `-> 3`.
    const { edges } = localLevel(LINE, into, 2, 1, [])
    expect(edges.filter((e) => e.next).map((e) => [e.from, e.to])).toEqual([[2, 3]])
  })

  it('joins the labels of several rules between the same two states, each once', () => {
    const twice: TmProgram = {
      ...LINE,
      states: [
        { ...state('a', null), rules: [rule({ read: ['1', null], next: 1 }), rule({ read: ['_', null], next: 1 })] },
        state('b', null),
      ],
    }
    const { edges } = localLevel(twice, predecessors(twice), 0, null, ['reg'])
    expect(edges).toEqual([{ from: 0, to: 1, label: 'reg:1, reg:_', next: false }])
  })
})
```

Apply the tests' half of the patch:

```diff apply=tests
diff --git a/web/tests/browser/state-diagram.test.ts b/web/tests/browser/state-diagram.test.ts
index 68e9b72..17f680a 100644
--- a/web/tests/browser/state-diagram.test.ts
+++ b/web/tests/browser/state-diagram.test.ts
@@ -164,7 +164,7 @@ describe('the program level, drawn as chips', () => {
     const dt25 = [...(rowNamed('dt25')?.querySelectorAll('.program-chip') ?? [])].map((c) => c.textContent)
     expect(dt25).toEqual(['→ pc14 pc20', '← ret'])
     const stored = JSON.parse(localStorage.getItem('redextape.layout') ?? '{}')
-    expect(stored.tmDisplay?.['tm-0']).toEqual({ edges: 'chips' })
+    expect(stored.tmDisplay?.['tm-0']).toEqual({ level: 'program', edges: 'chips' })
     edgesChoice('arcs')?.click()
     expect(diagram().querySelectorAll('.program-arc').length).toBeGreaterThan(0)
   })
diff --git a/web/tests/node/workspace.test.ts b/web/tests/node/workspace.test.ts
index f028acf..faa6c41 100644
--- a/web/tests/node/workspace.test.ts
+++ b/web/tests/node/workspace.test.ts
@@ -72,7 +72,7 @@ describe('parseWorkspace', () => {
       panels: { 'tm-0': { rules: false } },
       inspector: false,
       display: { 'pane-1': { layout: 'outline' as const, vars: 'debruijn' as const, map: 'minimap' as const } },
-      tmDisplay: { 'tm-0': { edges: 'chips' as const } },
+      tmDisplay: { 'tm-0': { level: 'local' as const, edges: 'chips' as const } },
     }
     const raw = serializeWorkspace(ws)
     expect(JSON.parse(raw).version).toBe(WORKSPACE_VERSION)
@@ -177,9 +177,15 @@ describe('parseWorkspace', () => {
   it('defaults a missing TM display to none stored, and refuses a malformed one', () => {
     const base = { version: 2, tree: SPLIT, switches: PRESETS.explorer, speed: 8, focused: 'lambda-0', panels: {} }
     expect(parseWorkspace(JSON.stringify(base))?.tmDisplay).toEqual({})
-    const good = { 'tm-0': { edges: 'chips' } }
+    const good = { 'tm-0': { level: 'local', edges: 'chips' } }
     expect(parseWorkspace(JSON.stringify({ ...base, tmDisplay: good }))?.tmDisplay).toEqual(good)
-    for (const bad of [{ 'tm-0': { edges: 'boxes' } }, { 'tm-0': {} }, { 'nowhere-9': { edges: 'arcs' } }, []]) {
+    for (const bad of [
+      { 'tm-0': { level: 'program', edges: 'boxes' } },
+      { 'tm-0': { level: 'states', edges: 'arcs' } },
+      { 'tm-0': { edges: 'arcs' } },
+      { 'nowhere-9': { level: 'program', edges: 'arcs' } },
+      [],
+    ]) {
       expect(parseWorkspace(JSON.stringify({ ...base, tmDisplay: bad })), JSON.stringify(bad)).toBeNull()
     }
   })
@@ -197,12 +203,15 @@ describe('serializeWorkspace', () => {
       focused: 'pane-9',
       panels: { 'pane-9': { rules: false }, 'tm-0': { rules: false } },
       display: { 'pane-9': outline, 'lambda-0': outline },
-      tmDisplay: { 'pane-9': { edges: 'chips' as const }, 'tm-0': { edges: 'chips' as const } },
+      tmDisplay: {
+        'pane-9': { level: 'program' as const, edges: 'chips' as const },
+        'tm-0': { level: 'program' as const, edges: 'chips' as const },
+      },
     }
     const back = JSON.parse(serializeWorkspace(ws))
     expect(back.panels).toEqual({ 'tm-0': { rules: false } })
     expect(back.display).toEqual({ 'lambda-0': outline })
-    expect(back.tmDisplay).toEqual({ 'tm-0': { edges: 'chips' } })
+    expect(back.tmDisplay).toEqual({ 'tm-0': { level: 'program', edges: 'chips' } })
     expect(back.focused).toBe('lambda-0')
     expect(back.inspector).toBe(true)
     expect(JSON.parse(serializeWorkspace({ ...ws, inspector: false })).inspector).toBe(false)
@@ -219,10 +228,9 @@ describe('withDisplay', () => {
 
 describe('withTmDisplay', () => {
   it('records one view’s display without touching the others', () => {
-    expect(withTmDisplay({ 'tm-0': { edges: 'arcs' } }, 'pane-1', { edges: 'chips' })).toEqual({
-      'tm-0': { edges: 'arcs' },
-      'pane-1': { edges: 'chips' },
-    })
+    const program = { level: 'program' as const, edges: 'arcs' as const }
+    const local = { level: 'local' as const, edges: 'chips' as const }
+    expect(withTmDisplay({ 'tm-0': program }, 'pane-1', local)).toEqual({ 'tm-0': program, 'pane-1': local })
   })
 })
 
```

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/local-level.test.ts tests/node/workspace.test.ts`
Expected: FAIL — `Tests  2 failed | 24 passed (26)` — `round-trips version 2`, `defaults a missing TM display to none stored, and refuses a malformed one`; and `Cannot find module` `../../src/local-level`.

- [ ] **Step 3: Write the code.** The model, the level in the diagram, the switch and its disabled reasons.

Create `web/src/local-level.ts`:

```ts file=web/src/local-level.ts
import type { RuleView, TmProgram } from './types'

/**
 * The state diagram's local level as data (Plan 7 part 4, spec §8 and amendment 10): the current state and every
 * state within `REACH` rules of it in either direction, in columns by signed distance, and the rules between them.
 *
 * **SMALL, SO IT IS REBUILT WHEN THE STATE CHANGES.** §2.3 measured a median of 5 states within 2 rules either way
 * on `fact3`, `map_fold` and `while4` alike; a state change re-lays it out, and a frame in the same state does not.
 */

/** How far the local level reaches, in rules, each way. */
export const REACH = 2

/**
 * A state on the local level, and its column: 0 for the current state, `+d` for one `d` rules ahead of it, `-d`
 * for one `d` rules behind it and not ahead of it too — a state reachable both ways takes its forward distance.
 */
export type LocalNode = { readonly state: number; readonly column: number }

/**
 * The rules from one state on the level to another, as one edge: its label names only the tapes those rules touch
 * (`reg:1 L`, "on `reg` read 1, move left"), each rule's own label once, and `next` is whether the rule about to
 * fire is among them.
 */
export type LocalEdge = { readonly from: number; readonly to: number; readonly label: string; readonly next: boolean }

export type Local = { readonly nodes: readonly LocalNode[]; readonly edges: readonly LocalEdge[] }

/**
 * Each state's predecessors — the states with a rule into it, each once. Once per machine, like the program level's
 * groups. **LINEAR**: states are visited in order, so a repeat can only be the last one pushed; `overflow` alone has
 * a predecessor in nearly every gadget, and a search of its list per rule would be quadratic in them.
 */
export function predecessors(p: TmProgram): number[][] {
  const into: number[][] = p.states.map(() => [])
  for (const [s, state] of p.states.entries()) {
    for (const rule of state.rules) {
      const list = into[rule.next]
      if (list !== undefined && list[list.length - 1] !== s) list.push(s)
    }
  }
  return into
}

/**
 * One rule's label: for each tape it touches — reads a symbol, writes one or moves — `name:read`, then `/write` if
 * it writes and the move if it moves. A tape it leaves alone is not named, so a gadget that works one tape of five
 * reads as that one tape. A rule that touches nothing at all is `*`.
 */
export function ruleLabel(rule: RuleView, names: readonly string[]): string {
  const parts: string[] = []
  for (let i = 0; i < rule.read.length; i += 1) {
    const read = rule.read[i] ?? null
    const write = rule.write[i] ?? null
    const move = rule.moves[i] ?? 'S'
    if (read === null && write === null && move === 'S') continue
    const name = names[i] ?? `tape ${i}`
    parts.push(`${name}:${read ?? '*'}${write === null ? '' : `/${write}`}${move === 'S' ? '' : ` ${move}`}`)
  }
  return parts.length === 0 ? '*' : parts.join(' ')
}

/** Breadth-first distances from `start` along `step`, up to `REACH`. */
function within(start: number, step: (s: number) => Iterable<number>): Map<number, number> {
  const dist = new Map<number, number>([[start, 0]])
  let frontier = [start]
  for (let d = 1; d <= REACH; d += 1) {
    const next: number[] = []
    for (const s of frontier) {
      for (const t of step(s)) {
        if (dist.has(t)) continue
        dist.set(t, d)
        next.push(t)
      }
    }
    frontier = next
  }
  return dist
}

/**
 * The local level around `current`. `rule` is the rule about to fire (`TmState.rule`), whose edge is marked.
 * Nodes come in column order and, within a column, by state id, so the same state always lays out the same way.
 */
export function localLevel(
  p: TmProgram,
  into: readonly (readonly number[])[],
  current: number,
  rule: number | null,
  names: readonly string[],
): Local {
  const ahead = within(current, (s) => p.states[s]?.rules.map((r) => r.next) ?? [])
  const behind = within(current, (s) => into[s] ?? [])
  const column = new Map<number, number>()
  for (const [s, d] of behind) column.set(s, -d)
  for (const [s, d] of ahead) column.set(s, d)
  const nodes = [...column.entries()]
    .map(([state, c]) => ({ state, column: c }))
    .sort((a, b) => a.column - b.column || a.state - b.state)

  const edges: LocalEdge[] = []
  for (const { state: from } of nodes) {
    const byTarget = new Map<number, { labels: string[]; next: boolean }>()
    for (const [i, r] of (p.states[from]?.rules ?? []).entries()) {
      if (!column.has(r.next)) continue
      const edge = byTarget.get(r.next) ?? { labels: [], next: false }
      const label = ruleLabel(r, names)
      if (!edge.labels.includes(label)) edge.labels.push(label)
      if (from === current && i === rule) edge.next = true
      byTarget.set(r.next, edge)
    }
    for (const [to, e] of byTarget) edges.push({ from, to, label: e.labels.join(', '), next: e.next })
  }
  return { nodes, edges }
}
```

Apply the source half of the patch:

```diff apply=source
diff --git a/web/src/state-diagram.ts b/web/src/state-diagram.ts
index a488c21..be51426 100644
--- a/web/src/state-diagram.ts
+++ b/web/src/state-diagram.ts
@@ -1,5 +1,6 @@
+import { type Local, localLevel, predecessors, REACH } from './local-level'
 import { type Arc, arcsOf, chipsOf, type Edges, type ProgramRow, programRows } from './program-level'
-import { type Groups, groupStates, stepOf } from './state-groups'
+import { type Groups, groupStates, stepOf, type Tier } from './state-groups'
 import { Follow, ROW_HEIGHT } from './state-table'
 import type { TmProgram, TmState } from './types'
 import { visibleWindow } from './virtual-list'
@@ -11,6 +12,17 @@ const LANE = 9
 const GUTTER_PAD = 12
 /** The runtime column's boxes: each one row tall, a row apart, and this wide. */
 const BOX_WIDTH = 104
+/**
+ * The local level's grid: a column per signed distance, at least `COLUMN_MIN` wide, its node `GAP` narrower so the
+ * edges between columns have room for their labels, and each node `NODE_STEP` below the last. `TOP` leaves room above
+ * the first row for a self-loop and its label.
+ */
+const COLUMN_MIN = 150
+const GAP = 64
+const NODE_STEP = 44
+const NODE_HEIGHT = 24
+const PAD = 8
+const TOP = 30
 const SVG = 'http://www.w3.org/2000/svg'
 
 let minted = 0
@@ -20,13 +32,23 @@ export type DiagramEvents = {
   readonly link: (state: number) => void
   /** The view scrolled or its following changed: the pane redraws the header action that re-attaches it. */
   readonly moved?: () => void
+  /** The current instruction's "show states" (spec §8): switch to the local level. */
+  readonly showStates?: () => void
 }
 
+/** Which level the diagram shows: spec §8's *program | local*. */
+export type Level = 'program' | 'local'
+
 /**
- * The state diagram's program level (Plan 7 part 4, spec §8): one row per instruction, or per name group, with
- * its state count and a ⚠ where it reaches `overflow`; the current row open onto its sub-steps; and the edges
- * between rows drawn as *arcs* — a gutter of lanes, the runtime routines in a column of their own — or as
- * *chips*, text on each row (amendment 11).
+ * The state diagram (Plan 7 part 4, spec §8), at either of its two levels.
+ *
+ * THE PROGRAM LEVEL is one row per instruction, or per name group, with its state count and a ⚠ where it reaches
+ * `overflow`; the current row open onto its sub-steps; and the edges between rows drawn as *arcs* — a gutter of
+ * lanes, the runtime routines in a column of their own — or as *chips*, text on each row (amendment 11).
+ *
+ * THE LOCAL LEVEL is the current state and every state within `REACH` rules of it, in columns by signed distance
+ * (amendment 10), the rules between them drawn and labelled with the tapes they touch. A machine with no program
+ * level — neither instructions nor dotted names (§7's third tier) — shows it alone.
  *
  * **ONLY THE HIGHLIGHT MOVES PER FRAME.** The groups, the arcs and their lanes are built once per machine
  * (`setProgram`); the rows are rebuilt only when the current group changes, since it is the one that opens onto
@@ -53,12 +75,29 @@ export class StateDiagram {
   #side: HTMLElement
   #sideLinks: SVGSVGElement
   #boxes: HTMLElement
+  #programEl: HTMLElement
+  #localEl: HTMLElement
+  #localEdges: SVGSVGElement
+  #localNodes: HTMLElement
 
   #program: TmProgram | null = null
   #groups: Groups | null = null
   #arcs: Arc[] = []
   #lanes = 0
   #edges: Edges = 'arcs'
+  #level: Level = 'program'
+  /** The tapes' names, for the local level's edge labels. */
+  #names: readonly string[] = []
+  /** Each state's predecessors, once per machine: the local level looks behind as well as ahead. */
+  #into: number[][] = []
+  #local: Local = { nodes: [], edges: [] }
+  /** The state the local level was laid out around, or `null` when it has not been. */
+  #localAround: number | null = null
+  /** The local level's roving cursor: the state whose node holds the one tab stop. */
+  #localActive: number | null = null
+  /** The width the local level was last laid out for. */
+  #localWidth = 0
+  #linkedStates: Set<number> = new Set()
   #frame: TmState | null = null
   /** The current group, or `null` with no frame, and for the `overflow` state, which is a badge. */
   #current: number | null = null
@@ -112,7 +151,36 @@ export class StateDiagram {
     this.#side.append(this.#sideLinks, this.#boxes)
 
     program.append(this.#scroll, this.#side)
-    this.el.append(program)
+    this.#programEl = program
+
+    // THE LOCAL LEVEL: nodes are buttons in one group, with a roving `tabindex`, so the level is one tab stop (spec
+    // §8) and arrows move between states; its edges are SVG under them.
+    this.#localEl = document.createElement('div')
+    this.#localEl.className = 'local-level'
+    this.#localEl.hidden = true
+    this.#localEdges = document.createElementNS(SVG, 'svg')
+    this.#localEdges.classList.add('local-edges')
+    this.#localEdges.setAttribute('aria-hidden', 'true')
+    this.#localNodes = document.createElement('div')
+    this.#localNodes.className = 'local-nodes'
+    this.#localNodes.setAttribute('role', 'group')
+    this.#localNodes.setAttribute('aria-label', `states within ${REACH} rules`)
+    this.#localEl.append(this.#localEdges, this.#localNodes)
+    this.#localNodes.addEventListener('click', (e) => {
+      const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.local-node') : null
+      if (el === null) return
+      this.#localActive = Number(el.dataset.state)
+      this.#on.link(Number(el.dataset.state))
+    })
+    this.#localNodes.addEventListener('keydown', (e) => this.#localKey(e))
+    // THE LOCAL LEVEL IS LAID OUT FOR A WIDTH, so a width it was not laid out for lays it out again: a panel that
+    // opens, a divider, a window.
+    new ResizeObserver(() => {
+      if (this.#localEl.clientWidth === this.#localWidth) return
+      this.#localAround = null
+      if (this.shown === 'local') this.#drawLocal()
+    }).observe(this.#localEl)
+    this.el.append(program, this.#localEl)
 
     this.#scroll.addEventListener('scroll', () => {
       if (this.#scroll.clientHeight === 0) return
@@ -124,12 +192,18 @@ export class StateDiagram {
       this.#on.moved?.()
     })
     this.#rowsEl.addEventListener('click', (e) => {
+      if (e.target instanceof HTMLElement && e.target.closest('.program-show') !== null) {
+        this.#on.showStates?.()
+        return
+      }
       const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.program-row') : null
       if (el === null) return
       const i = Number(el.dataset.row)
       this.#active = i
       this.#draw()
-      this.#linkRow(i)
+      // A CLICK LINKS A GROUP'S ROW AND DOES NOTHING ELSE: a click on a sub-step, or on a label, is only a click on
+      // a row. *Show states* is its button's, or Enter's on its row (`#linkRow`).
+      if (this.#rows[i]?.kind === 'group') this.#linkRow(i)
     })
     this.#boxes.addEventListener('click', (e) => {
       const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.program-box') : null
@@ -147,14 +221,32 @@ export class StateDiagram {
     }).observe(this.#scroll)
   }
 
-  /** Whether the program level follows the running state; a user scroll or a key that scrolls detaches it. */
+  /**
+   * Whether the program level follows the running state; a user scroll or a key that scrolls detaches it. The local
+   * level always follows — it is drawn around the current state — so it says so.
+   */
   get following(): boolean {
-    return this.#follow.following
+    return this.shown === 'local' || this.#follow.following
+  }
+
+  /** How this machine groups (§7), or `none` with no machine. */
+  get tier(): Tier {
+    return this.#groups?.tier ?? 'none'
+  }
+
+  /** The level on screen: the one chosen, unless the machine has no program level to show. */
+  get shown(): Level {
+    return this.#level === 'local' || this.tier === 'none' ? 'local' : 'program'
   }
 
   /** Group a new machine's states. Once per compile, like the rule table's `StateIndex`. */
-  setProgram(p: TmProgram | null): void {
+  setProgram(p: TmProgram | null, names: readonly string[] = []): void {
     this.#program = p
+    this.#names = names
+    this.#into = p === null ? [] : predecessors(p)
+    this.#localAround = null
+    this.#localActive = null
+    this.#linkedStates = new Set()
     this.#groups = p === null ? null : groupStates(p)
     this.#arcs = this.#groups === null ? [] : arcsOf(this.#groups)
     this.#lanes = this.#arcs.reduce((n, a) => Math.max(n, a.lane + 1), 0)
@@ -178,7 +270,18 @@ export class StateDiagram {
     this.#layout()
   }
 
-  /** The machine's frame: which group is current, and which sub-step. */
+  /** Show the program level or the local one. The program level is still kept current, so switching back is free. */
+  setLevel(level: Level): void {
+    if (level === this.#level) return
+    // THE FOCUS GOES WITH THE LEVEL. The level it was in is hidden now, and a hidden element's focus falls to the
+    // page: *show states* in the grid moved it to `<body>`. It moves to the shown level's own tab stop.
+    const had = this.el.contains(document.activeElement)
+    this.#level = level
+    this.#layout()
+    if (had) this.#focusShown()
+  }
+
+  /** The machine's frame: which group is current, and which sub-step — and, at the local level, which state. */
   render(frame: TmState | null): void {
     this.#frame = frame
     const g = frame === null ? null : (this.#groups?.groupOf[frame.state] ?? -1)
@@ -188,12 +291,15 @@ export class StateDiagram {
       this.#layout()
     } else {
       this.#draw()
+      if (this.shown === 'local') this.#drawLocal()
     }
   }
 
   /** Mark the groups holding any of `states` — a link's block, which the rule table marks too. */
   setLinked(states: readonly number[]): void {
     const groups = this.#groups
+    this.#linkedStates = new Set(states)
+    this.#paintLocal()
     this.#linked = new Set()
     if (groups !== null) {
       for (const s of states) {
@@ -213,6 +319,13 @@ export class StateDiagram {
   /** Redraw after the panel opens, or after anything else that changed its size without a scroll or a frame. */
   redraw(): void {
     this.#draw()
+    if (this.shown === 'local') this.#drawLocal()
+  }
+
+  /** Focus the shown level's tab stop: the grid, or the local level's active node. */
+  #focusShown(): void {
+    if (this.shown === 'program') this.#scroll.focus()
+    else this.#localNodes.querySelector<HTMLElement>('.local-node[tabindex="0"]')?.focus()
   }
 
   /** Rebuild the rows — a new machine, a new current group, or the other rendering — and draw them. */
@@ -230,7 +343,11 @@ export class StateDiagram {
     for (const [i, row] of this.#rows.entries()) if (row.kind === 'group') this.#rowOf[row.group] = i
     this.#scroll.setAttribute('aria-rowcount', String(this.#rows.length))
     this.el.dataset.edges = this.#edges
+    this.el.dataset.level = this.shown
+    this.#programEl.hidden = this.shown !== 'program'
+    this.#localEl.hidden = this.shown !== 'local'
     this.#draw()
+    if (this.shown === 'local') this.#drawLocal()
   }
 
   /**
@@ -367,6 +484,15 @@ export class StateDiagram {
         return el
       case 'steps': {
         el.classList.add('is-steps')
+        // "SHOW STATES" (spec §8): the local level, around the state this row's current sub-step is. Out of the tab
+        // order, since the grid is the level's one tab stop — Enter on the row does the same — and FIRST, so a
+        // gadget with twenty sub-steps cannot push it past the row's clipped end.
+        const show = document.createElement('button')
+        show.type = 'button'
+        show.className = 'program-show'
+        show.tabIndex = -1
+        show.textContent = 'show states'
+        cell.append(show)
         const now = this.#frame === null ? null : stepOf(this.#program?.states[this.#frame.state]?.name ?? '')
         for (const step of groups.groups[row.group]?.steps ?? []) {
           const s = document.createElement('span')
@@ -491,8 +617,187 @@ export class StateDiagram {
     this.#boxes.style.left = `${left}px`
   }
 
+  /**
+   * Lay the local level out around the current state — only when that state changed, since it is small but not
+   * free (spec §8) — and paint its marks.
+   */
+  #drawLocal(): void {
+    const p = this.#program
+    const current = this.#frame?.state ?? null
+    // NOTHING WHILE IT IS NOT DRAWN — a closed panel, a view off the page: a layout there would be for no width at
+    // all, and it is marked stale so the next one on screen lays it out.
+    if (this.#localEl.clientWidth === 0) {
+      this.#localAround = null
+      return
+    }
+    if (p === null || current === null) {
+      this.#localNodes.replaceChildren()
+      this.#localEdges.replaceChildren()
+      this.#localAround = null
+      return
+    }
+    if (current !== this.#localAround) {
+      this.#localAround = current
+      this.#local = localLevel(p, this.#into, current, this.#frame?.rule ?? null, this.#names)
+      if (this.#localActive === null || !this.#local.nodes.some((n) => n.state === this.#localActive)) {
+        this.#localActive = current
+      }
+      this.#layoutLocal(p)
+    }
+    this.#paintLocal()
+  }
+
+  /** Place the nodes in their columns and draw the edges between them. */
+  #layoutLocal(p: TmProgram): void {
+    // A NODE HOLDING THE FOCUS IS REBUILT BELOW, AND ITS FOCUS WOULD FALL TO THE PAGE: it goes to the active node.
+    const had = this.#localNodes.contains(document.activeElement)
+    this.#localWidth = this.#localEl.clientWidth
+    const width = Math.max(this.#localWidth, (2 * REACH + 1) * COLUMN_MIN)
+    const column = Math.floor(width / (2 * REACH + 1))
+    const nodeWidth = column - GAP
+    const at = new Map<number, { x: number; y: number }>()
+    const filled = new Map<number, number>()
+    for (const n of this.#local.nodes) {
+      const row = filled.get(n.column) ?? 0
+      filled.set(n.column, row + 1)
+      at.set(n.state, { x: (n.column + REACH) * column + PAD, y: TOP + row * NODE_STEP })
+    }
+    const height = TOP + PAD + Math.max(1, ...filled.values()) * NODE_STEP
+    this.#localNodes.style.height = `${height}px`
+    this.#localEdges.setAttribute('width', String(width))
+    this.#localEdges.setAttribute('height', String(height))
+    this.#localNodes.replaceChildren(
+      ...this.#local.nodes.map((n) => {
+        const b = document.createElement('button')
+        b.type = 'button'
+        b.className = 'local-node'
+        b.dataset.state = String(n.state)
+        b.dataset.column = String(n.column)
+        const place = at.get(n.state) ?? { x: 0, y: 0 }
+        b.style.left = `${place.x}px`
+        b.style.top = `${place.y}px`
+        b.style.width = `${nodeWidth}px`
+        b.textContent = p.states[n.state]?.name ?? String(n.state)
+        b.title = b.textContent
+        b.setAttribute('aria-description', this.#said(p, n.state, n.column))
+        return b
+      }),
+    )
+    if (had) {
+      this.#paintLocal()
+      this.#localNodes.querySelector<HTMLElement>('.local-node[tabindex="0"]')?.focus()
+    }
+    const mid = NODE_HEIGHT / 2
+    const drawn: SVGElement[] = []
+    for (const e of this.#local.edges) {
+      const a = at.get(e.from)
+      const b = at.get(e.to)
+      if (a === undefined || b === undefined) continue
+      let d: string
+      let lx: number
+      let ly: number
+      if (e.from === e.to) {
+        // A SELF-LOOP: out of the node's right edge, over it, and back into its top.
+        const x = a.x + nodeWidth
+        d = `M${x} ${a.y + 6} C${x + 22} ${a.y - 10} ${x - 12} ${a.y - 18} ${x - 20} ${a.y}`
+        lx = x - 30
+        ly = a.y - 8
+      } else if (b.x > a.x) {
+        const x1 = a.x + nodeWidth
+        d = `M${x1} ${a.y + mid} C${x1 + PAD} ${a.y + mid} ${b.x - PAD} ${b.y + mid} ${b.x} ${b.y + mid}`
+        lx = (x1 + b.x) / 2
+        ly = (a.y + b.y) / 2 + mid - 5
+      } else {
+        // BACK, OR ALONG A COLUMN: under the nodes, from the bottom of one to the bottom of the other.
+        const x1 = a.x + nodeWidth / 2
+        const x2 = b.x + nodeWidth / 2
+        const low = Math.max(a.y, b.y) + NODE_HEIGHT + 14
+        d = `M${x1} ${a.y + NODE_HEIGHT} C${x1} ${low} ${x2} ${low} ${x2} ${b.y + NODE_HEIGHT}`
+        lx = (x1 + x2) / 2
+        ly = low
+      }
+      drawn.push(svg('path', { d, class: e.next ? 'local-edge is-next' : 'local-edge' }))
+      const label = svg('text', { x: String(lx), y: String(ly), class: 'local-label', 'text-anchor': 'middle' })
+      label.textContent = e.label
+      drawn.push(label)
+    }
+    this.#localEdges.replaceChildren(...drawn)
+  }
+
+  /**
+   * What a node says beyond its name, for a reader who cannot see the level: its distance from the current state, and
+   * each edge out of it with its label, the next rule's marked — the SVG that draws them is `aria-hidden`.
+   */
+  #said(p: TmProgram, state: number, column: number): string {
+    const where =
+      column === 0
+        ? 'the current state'
+        : `${Math.abs(column)} ${Math.abs(column) === 1 ? 'rule' : 'rules'} ${column > 0 ? 'ahead' : 'behind'}`
+    const out = this.#local.edges
+      .filter((e) => e.from === state)
+      .map((e) => `to ${p.states[e.to]?.name ?? e.to} on ${e.label}${e.next ? ', fires next' : ''}`)
+    return out.length === 0 ? where : `${where}; ${out.join('; ')}`
+  }
+
+  /** The local level's marks and its roving tab stop: the current state, the linked ones, the active node. */
+  #paintLocal(): void {
+    const current = this.#frame?.state ?? null
+    for (const el of this.#localNodes.children) {
+      if (!(el instanceof HTMLElement)) continue
+      const state = Number(el.dataset.state)
+      el.classList.toggle('is-current', state === current)
+      if (state === current) el.setAttribute('aria-current', 'step')
+      else el.removeAttribute('aria-current')
+      el.classList.toggle('is-linked', this.#linkedStates.has(state))
+      el.tabIndex = state === this.#localActive ? 0 : -1
+    }
+  }
+
+  /**
+   * The local level's keys: ←/→ to the nearest node in the next column, ↑/↓ within a column, Enter or Space links —
+   * a button's own. The focus moves with the roving tab stop, so the level stays one tab stop.
+   */
+  #localKey(e: KeyboardEvent): void {
+    const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.local-node') : null
+    if (el === null) return
+    const nodes = [...this.#localNodes.querySelectorAll<HTMLElement>('.local-node')]
+    const column = (n: HTMLElement) => Number(n.dataset.column)
+    const inColumn = (c: number) => nodes.filter((n) => column(n) === c)
+    const mine = inColumn(column(el))
+    const row = mine.indexOf(el)
+    let next: HTMLElement | undefined
+    switch (e.key) {
+      case 'ArrowUp':
+        next = mine[row - 1]
+        break
+      case 'ArrowDown':
+        next = mine[row + 1]
+        break
+      case 'ArrowLeft':
+      case 'ArrowRight': {
+        const by = e.key === 'ArrowRight' ? 1 : -1
+        for (let c = column(el) + by; c >= -REACH && c <= REACH && next === undefined; c += by) {
+          const there = inColumn(c)
+          next = there[Math.min(row, there.length - 1)]
+        }
+        break
+      }
+      default:
+        return
+    }
+    e.preventDefault()
+    if (next === undefined) return
+    this.#localActive = Number(next.dataset.state)
+    this.#paintLocal()
+    next.focus()
+  }
+
   #linkRow(i: number): void {
     const row = this.#rows[i]
+    if (row?.kind === 'steps') {
+      this.#on.showStates?.()
+      return
+    }
     if (row?.kind !== 'group') return
     const first = this.#groups?.groups[row.group]?.first ?? -1
     if (first >= 0) this.#on.link(first)
diff --git a/web/src/style.css b/web/src/style.css
index 90a0b04..d83ff9f 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -706,6 +706,11 @@ button.view-title[aria-expanded="true"] {
 /* THE CHECKED CHOICE (`view-header.ts`'s `radioGroup`), DRAWN WITHOUT RELYING ON COLOUR — the same cue
    `.view-menu-choice[aria-checked="true"]` uses: heavier than its sibling, plus a bar in `--accent`. A mode's
    button is otherwise every panel action's (`.panel-actions button`), which outranks a rule on its class. */
+/* A choice that cannot be made now: dimmed, and its reason is its tooltip (`radioGroup`, umbrella rule 4). */
+.diagram-mode:disabled {
+  opacity: 0.45;
+  cursor: not-allowed;
+}
 .map-mode[aria-checked="true"],
 .diagram-mode[aria-checked="true"] {
   font-weight: 600;
@@ -1818,6 +1823,80 @@ main {
   box-shadow: inset 3px 0 0 var(--accent);
 }
 
+/* THE STATE DIAGRAM'S LOCAL LEVEL (spec §8): the current state and the states within two rules of it, in five
+   columns by signed distance, as buttons over their SVG edges. The rule about to fire is the thicker edge. */
+.local-level {
+  position: relative;
+  flex: 1 1 0;
+  min-height: 0;
+  overflow: auto;
+}
+.local-level[hidden],
+.program-level[hidden] {
+  display: none;
+}
+.local-nodes {
+  position: relative;
+}
+.local-edges {
+  position: absolute;
+  top: 0;
+  left: 0;
+  overflow: visible;
+}
+.local-node {
+  position: absolute;
+  height: 24px;
+  padding: 0 0.4em;
+  font: inherit;
+  color: inherit;
+  text-align: left;
+  white-space: nowrap;
+  overflow: hidden;
+  text-overflow: ellipsis;
+  background: var(--bg-raised);
+  border: 1px solid var(--rule);
+  border-radius: var(--radius);
+  cursor: pointer;
+}
+.local-node.is-linked {
+  background: var(--link-bg);
+  border-style: dashed;
+  border-color: var(--link-edge);
+}
+.local-node.is-current {
+  background: color-mix(in oklab, var(--accent) 14%, var(--bg));
+  box-shadow: inset 3px 0 0 var(--accent);
+  font-weight: 600;
+}
+.local-node:focus-visible {
+  outline: 2px solid var(--focus-ring);
+  outline-offset: 1px;
+}
+.local-edge {
+  fill: none;
+  stroke: var(--fg-dim);
+  stroke-width: 1.2;
+}
+.local-edge.is-next {
+  stroke: var(--accent);
+  stroke-width: 2.2;
+}
+.local-label {
+  font-size: 10px;
+  fill: var(--fg-dim);
+}
+.program-show {
+  margin-inline-start: auto;
+  padding: 0 0.5em;
+  font: inherit;
+  color: var(--accent);
+  background: transparent;
+  border: 1px solid var(--rule);
+  border-radius: var(--radius);
+  cursor: pointer;
+}
+
 /* A TM VIEW'S OPEN PANELS SHARE ITS HEIGHT (spec §9.1): the rules two shares, the diagram and the outline one
    each, each down to a floor, and a closed panel keeps only its header. Everything else in the view — the text panel, the status
    lines, the tapes — keeps its own height. The view is a flex column so the panels have a height to share,
diff --git a/web/src/tm-pane.ts b/web/src/tm-pane.ts
index e28b73c..27da74d 100644
--- a/web/src/tm-pane.ts
+++ b/web/src/tm-pane.ts
@@ -18,7 +18,7 @@ import { tapeLabel, tapeRows } from './tape'
 import type { TmProgram, TmScratchStatus, TmState, ValueReading } from './types'
 import { radioGroup, type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
 import { visibleWindow } from './virtual-list'
-import type { TmDisplay } from './workspace'
+import { DEFAULT_TM_DISPLAY, type TmDisplay } from './workspace'
 
 export { ROW_HEIGHT } from './state-table'
 
@@ -193,6 +193,7 @@ export class TmPane implements EditablePane {
   #diagramPanel: Panel
   #diagramReattach: HTMLButtonElement
   #edgesChoice: ReturnType<typeof radioGroup>
+  #levelChoice: ReturnType<typeof radioGroup>
   /** This view's display settings, and where a change to them is recorded — `LambdaPane`'s pair. */
   #display: TmDisplay
   #onDisplay: ((d: TmDisplay) => void) | undefined
@@ -235,7 +236,7 @@ export class TmPane implements EditablePane {
     host: HTMLElement,
     on: PaneEvents,
     panels: { readonly rules?: boolean; readonly diagram?: boolean; readonly outline?: boolean } = {},
-    display: TmDisplay = { edges: 'arcs' },
+    display: TmDisplay = DEFAULT_TM_DISPLAY,
   ) {
     this.#display = display
     this.#onDisplay = on.tmDisplay
@@ -382,8 +383,10 @@ export class TmPane implements EditablePane {
     this.#diagram = new StateDiagram({
       link: (state) => on.linkState?.(state),
       moved: () => this.#syncDiagramReattach(),
+      showStates: () => this.#setDisplay({ ...this.#display, level: 'local' }),
     })
     this.#diagram.setEdges(display.edges)
+    this.#diagram.setLevel(display.level)
     this.#diagramReattach = document.createElement('button')
     this.#diagramReattach.type = 'button'
     this.#diagramReattach.className = 'diagram-reattach'
@@ -395,6 +398,28 @@ export class TmPane implements EditablePane {
       this.#syncDiagramReattach()
       if (had && this.#diagramReattach.hidden) this.#diagramPanel.toggle.focus()
     })
+    // *PROGRAM | LOCAL* AND *ARCS | CHIPS*, EACH DISABLED WITH ITS REASON WHERE IT CANNOT APPLY (umbrella rule 4): a
+    // machine with neither instructions nor dotted names has no program level (§7's third tier), and the edges'
+    // two renderings are the program level's.
+    this.#levelChoice = radioGroup(
+      {
+        label: 'level',
+        choices: [
+          {
+            value: 'program',
+            label: 'program',
+            disabled: () =>
+              this.#diagram.tier === 'none' && this.#program !== null
+                ? 'this machine has no program level: its states carry no instruction and no dotted name to group by'
+                : null,
+          },
+          { value: 'local', label: 'local' },
+        ],
+        current: () => this.#diagram.shown,
+        pick: (v) => this.#setDisplay({ ...this.#display, level: v === 'local' ? 'local' : 'program' }),
+      },
+      'diagram-mode',
+    )
     this.#edgesChoice = radioGroup(
       {
         label: 'edges',
@@ -404,6 +429,7 @@ export class TmPane implements EditablePane {
         ],
         current: () => this.#display.edges,
         pick: (v) => this.#setDisplay({ ...this.#display, edges: v === 'chips' ? 'chips' : 'arcs' }),
+        disabled: () => (this.#diagram.shown === 'local' ? 'arcs and chips draw the program level' : null),
       },
       'diagram-mode',
     )
@@ -418,7 +444,7 @@ export class TmPane implements EditablePane {
         on.panel?.('diagram', open)
       },
     })
-    this.#diagramPanel.actions.append(this.#diagramReattach, this.#edgesChoice.el)
+    this.#diagramPanel.actions.append(this.#diagramReattach, this.#levelChoice.el, this.#edgesChoice.el)
 
     // **A TM VIEW'S OUTLINE IS ITS STATES** — measured against the real server, which answers a
     // `state` block per symbol at kind 5. Closed by default, like the source view's: a machine of
@@ -479,7 +505,9 @@ export class TmPane implements EditablePane {
     this.#tableHost.scrollTop = 0
     this.#frame = null
     this.#drawTable()
-    this.#diagram.setProgram(p)
+    this.#diagram.setProgram(p, names)
+    this.#levelChoice.sync()
+    this.#edgesChoice.sync()
     this.#syncDiagramReattach()
   }
 
@@ -487,7 +515,10 @@ export class TmPane implements EditablePane {
   #setDisplay(d: TmDisplay): void {
     this.#display = d
     this.#diagram.setEdges(d.edges)
+    this.#diagram.setLevel(d.level)
+    this.#levelChoice.sync()
     this.#edgesChoice.sync()
+    this.#syncDiagramReattach()
     this.#onDisplay?.(d)
   }
 
diff --git a/web/src/view-header.ts b/web/src/view-header.ts
index 1c090f3..e13aaac 100644
--- a/web/src/view-header.ts
+++ b/web/src/view-header.ts
@@ -258,9 +258,16 @@ export type ViewMenu = {
 /** One group of mutually exclusive settings in a view's `⋯` menu — `layout: code | outline`. */
 export type DisplayGroup = {
   readonly label: string
-  readonly choices: readonly { readonly value: string; readonly label: string }[]
+  readonly choices: readonly {
+    readonly value: string
+    readonly label: string
+    /** Why this choice cannot be made now, or `null` when it can — umbrella rule 4's disabled-with-its-reason. */
+    readonly disabled?: () => string | null
+  }[]
   readonly current: () => string
   readonly pick: (value: string) => void
+  /** Why no choice in the group can be made now — every choice disabled, with this reason — or `null`. */
+  readonly disabled?: () => string | null
 }
 
 /**
@@ -283,6 +290,9 @@ export type DisplayMenu = { readonly groups: readonly DisplayGroup[]; readonly r
  *
  * `sync` puts the choices in step with `current()`. A choice made here syncs itself; a caller whose
  * setting can change from elsewhere calls it before the group is next seen.
+ *
+ * **A CHOICE THAT CANNOT BE MADE NOW IS DISABLED WITH ITS REASON STATED** (the umbrella's rule 4), the way the view
+ * menu's *edit a copy* is: `disabled`, and the reason as its `aria-description` and its tooltip. The keys skip it.
  */
 export function radioGroup(
   g: DisplayGroup,
@@ -302,10 +312,20 @@ export function radioGroup(
   })
   const sync = (): void => {
     const now = g.current()
-    for (const b of radios) {
+    const whole = g.disabled?.() ?? null
+    for (const [i, b] of radios.entries()) {
       const on = b.dataset.value === now
       b.setAttribute('aria-checked', String(on))
       b.tabIndex = on ? 0 : -1
+      const reason = whole ?? g.choices[i]?.disabled?.() ?? null
+      b.disabled = reason !== null
+      if (reason === null) {
+        b.removeAttribute('aria-description')
+        b.removeAttribute('title')
+      } else {
+        b.setAttribute('aria-description', reason)
+        b.title = reason
+      }
     }
   }
   const choose = (b: HTMLButtonElement): void => {
@@ -318,7 +338,12 @@ export function radioGroup(
       if (e.altKey || e.ctrlKey || e.metaKey) return
       const by =
         e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
-      const next = by === 0 ? undefined : radios[(i + by + radios.length) % radios.length]
+      if (by === 0) return
+      let next: HTMLButtonElement | undefined
+      for (let k = 1; k < radios.length && next === undefined; k += 1) {
+        const candidate = radios[(i + by * k + radios.length * k) % radios.length]
+        if (candidate !== undefined && !candidate.disabled) next = candidate
+      }
       if (next === undefined) return
       e.preventDefault()
       next.focus()
diff --git a/web/src/workspace.ts b/web/src/workspace.ts
index ca6834c..eb6c3ad 100644
--- a/web/src/workspace.ts
+++ b/web/src/workspace.ts
@@ -70,12 +70,13 @@ export const DEFAULT_DISPLAY: LambdaDisplay = { layout: 'code', vars: 'names', m
 /** Each λ view's display settings, by leaf — a view with none stored draws with `DEFAULT_DISPLAY`. */
 export type Displays = Readonly<Record<LeafId, LambdaDisplay>>
 
-/** How a TM view draws its state diagram (Plan 7 part 4, spec §8 and amendment 11): its program level's edges. */
+/** How a TM view draws its state diagram (Plan 7 part 4, spec §8 and amendment 11): its level, and the edges. */
 export type TmDisplay = {
+  readonly level: 'program' | 'local'
   readonly edges: 'arcs' | 'chips'
 }
 
-export const DEFAULT_TM_DISPLAY: TmDisplay = { edges: 'arcs' }
+export const DEFAULT_TM_DISPLAY: TmDisplay = { level: 'program', edges: 'arcs' }
 
 /** Each TM view's display settings, by leaf — a view with none stored draws with `DEFAULT_TM_DISPLAY`. */
 export type TmDisplays = Readonly<Record<LeafId, TmDisplay>>
@@ -215,9 +216,10 @@ function parseTmDisplay(v: unknown, ids: ReadonlySet<string>): TmDisplays | null
   const out: Record<LeafId, TmDisplay> = {}
   for (const [leaf, d] of Object.entries(v as Record<string, unknown>)) {
     if (!ids.has(leaf) || typeof d !== 'object' || d === null) return null
-    const { edges } = d as Record<string, unknown>
+    const { level, edges } = d as Record<string, unknown>
+    if (level !== 'program' && level !== 'local') return null
     if (edges !== 'arcs' && edges !== 'chips') return null
-    out[leaf] = { edges }
+    out[leaf] = { level, edges }
   }
   return out
 }
```

- [ ] **Step 4: Run the tests.**

Run: `cd web && pnpm exec vitest run`
Expected: `Test Files  1 failed | 151 passed (152)`, `Tests  2 failed | 1308 passed (1310)` — both failures, `loads Hack`, `fetches only the Inter subset that covers λ`, are `fonts.test.ts`'s, measured in a worktree whose `web/node_modules` is a symlink (see *Browser tests* above); nothing else fails.

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (`pnpm exec vitest run tests/browser/state-diagram-local.test.ts tests/node/local-level.test.ts`, and for the last five rows `pnpm exec vitest run --project browser tests/browser/tm-display-restore.test.ts`):

| Sabotage | Fails |
|---|---|
| `local-level.ts`: a state behind at `+d` | 4 cases, among them `reaches 2 rules each way, in signed columns, and a state reachable both ways takes its forward one` |
| `local-level.ts`: never mark the next rule | `marks the edge of the rule about to fire, and only that one`, `labels its edges with the tapes their rules touch, and marks the next rule's`, `says each node's distance and edges, since the drawing of them is hidden from a reader` |
| `state-diagram.ts`: every node a tab stop | `is one tab stop whose arrows move between states, and links the one Enter is on` |
| `state-diagram.ts`: ← moves right | `is one tab stop whose arrows move between states, and links the one Enter is on` |
| `tm-pane.ts`: *arcs \| chips* never disabled | `disables arcs \| chips there, and says why` |
| `tm-pane.ts`: *program* never disabled | `shows the local level alone, with program disabled and its reason stated` |
| `state-diagram.ts`: `shown` ignores the tier | `shows the local level alone, with program disabled and its reason stated` |
| `state-diagram.ts`: Enter on the sub-steps row shows no states | 9 cases, among them `is what the current instruction's show states opens, and the focus goes with it` |
| `local-level.ts`: name every tape, touched or not | `names only the tapes the rule touches`, `` says `*` for a rule that touches no tape, and numbers a tape it has no name for ``, `joins the labels of several rules between the same two states, each once` |
| `tm-pane.ts`: `#setDisplay` does not report the display | `is what the current instruction's show states opens, and the focus goes with it`, `shows the local level alone, with program disabled and its reason stated` |
| `view-header.ts`: the keys land on a disabled choice | `shows the local level alone, with program disabled and its reason stated` — the stored level changes |
| `state-diagram.ts`: `setLevel` does not move the focus | `is what the current instruction's show states opens, and the focus goes with it` |
| `state-diagram.ts`: lay the level out while it is not drawn | `lays out nothing while its panel is closed, and lays out for its width once it opens`, `lays out again for a width it was not laid out for, with the state unchanged`, `is one tab stop whose arrows move between states, and links the one Enter is on` |
| `state-diagram.ts`: the local level's resize observer does nothing | `lays out again for a width it was not laid out for, with the state unchanged` |
| `state-diagram.ts`: no focus back after a rebuild | `keeps the focus on a node while the run moves the level` |
| `state-diagram.ts`: no `aria-description` on a node | `says each node's distance and edges, since the drawing of them is hidden from a reader` |
| `style.css`: drop `.program-level[hidden]` | `is what the current instruction's show states opens, and the focus goes with it`, `shows the local level alone, with program disabled and its reason stated` — computed `display`, not the attribute |
| `state-diagram.ts`: *show states* last in its row | 9 cases, among them `is what the current instruction's show states opens, and the focus goes with it` |
| `state-diagram.ts`: any click on a row links or shows states | `is what the current instruction's show states opens, and the focus goes with it` — a sub-step click switched the level |
| `main.ts`: restore no TM display | `draws the level and the edges the workspace stored for it` |
| `pane-host.ts`: build every TM view with `DEFAULT_TM_DISPLAY` | `draws the level and the edges the workspace stored for it` |
| `main.ts`: `normaliseWorkspace` keeps a closed view's `tmDisplay` | `does not give a re-minted view the display of the one that closed` |
| `tm-pane.ts`: drop the constructor's `setEdges(display.edges)` | `draws the level and the edges the workspace stored for it` — at the hidden program level, before the switch whose own `setEdges` would mask it |
| `tm-pane.ts`: drop the constructor's `setLevel(display.level)` | `draws the level and the edges the workspace stored for it` |

- [ ] **Step 6: Run the gates.**

Run: `cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings`
Expected: both exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The state diagram's local level, and program | local

The current state and every state within two rules of it, in columns from -2 to +2 by signed distance
(spec amendment 10), its edges labelled with only the tapes each rule touches and the rule about to
fire marked (§8). A switch in the diagram's header chooses the level; the current instruction's "show
states" chooses local. Arcs | chips is disabled at the local level, and program for a machine with no
instructions or dotted names to group by (§7), each with its reason stated; the radio keys pass over
a disabled choice.
EOF
```

### Task 7: Verification, the manual check, and the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the entry, appended at the end)

No code. Every figure the entry quotes is run for it, and its command named beside it.

- [ ] **Step 1: The gates CI runs, all of them.** `scripts/check-all.sh` does not cover everything CI gates on. Run each in a detached `systemd-run --user --unit=… -p MemoryMax=16G -p MemorySwapMax=0` unit with `--setenv` for `PATH` (both `/usr/sbin` and `$CARGO_HOME/bin`), `CARGO_HOME`, `RUSTUP_HOME` and `HOME`, logging to the scratchpad:
  - `scripts/check-all.sh` — with `TREE_SITTER=<repo>/.tools/tree-sitter`, since `/usr/sbin` holds a newer `tree-sitter` than the pin;
  - `scripts/check-slow.sh`;
  - `cargo llvm-cov nextest --workspace --fail-under-lines 90`;
  - the six hygiene scans, `scripts/check-{text-bytes,citations,attributions,doc-figures,shared-docs,lua}.sh`, each with `--self-test` and then alone;
  - the web CI sequence: `cd web && pnpm run build:wasm && pnpm exec biome ci --error-on-warnings && pnpm run typecheck && pnpm run test:coverage && pnpm run build:app`;
  - the Docker image, built and started: `docker build -t redextape-check .`, `docker run -d --name c -p 8099:80 redextape-check`, then `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8099/` answers `200` and `docker inspect --format '{{.State.Health.Status}}' c` answers `healthy`. No new build output is added by this plan, but no PR job builds the image.

  Expected: every one exits 0. A failure is a finding: report it with its log, do not retry it into green.

- [ ] **Step 2: The manual check.** Against `cd web && pnpm run dev`, with `fact(3)`, in all three presets and in light and dark: the rule table's keys move its active row past the drawn rows and Enter links; the tapes' labels (read one with the browser's accessibility inspector); the diagram's program level in *arcs* and in *chips*, following the run and opening the current instruction; *show states*; the local level's arrows and Enter; a TM copy of a machine with no dotted names, where *program* is disabled with its reason. Screenshots are kept outside the tree, and the entry lists what was checked.

- [ ] **Step 3: The roadmap entry.** Append the entry for this PR to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, in the form part 4a's entry takes: what 4b built, what the prototype and the task reviews found, the user's decisions with their dates, what this did not close, and a verification section in which every figure names its command. Among what it did not close, at least:
  - the two clamp paths no test reaches — the table's scroll-handler height check and the diagram's resize-observer `onResize` (Task 5);
  - the λ body's own scroll handler, which has the same clamp class on a window resize and is untouched here;
  - *arcs | chips* disabled at the local level has no tab stop, so a keyboard reader reaches its reason only by tooltip — the *edit a copy* precedent, kept deliberately;
  - a machine halted in the overflow guard is marked nowhere at the program level, since the guard is a badge and not a row; the status line names the state;
  - the leftovers part 4a's entry lists that this plan does not touch.

- [ ] **Step 4: Commit the entry.**

```sh
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: Plan 7 part 4b, the TM view"
```

- [ ] **Step 5: Finish the branch** with superpowers:finishing-a-development-branch. The user merges; push and open the PR only when asked.


## Appendix: the probes behind this plan's own figures

Both are throwaway, run against the prototype's last code task and deleted after; neither is committed by any task.

**The map probe**, `crates/redextape-core/examples/probe_4b_mapcost.rs`, run three times with `CARGO_TARGET_DIR` outside the repository: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo run -q --release -p redextape-core --example probe_4b_mapcost`.

```rust
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::pedantic)]
use std::time::Instant;
use redextape_core::parser;
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{self, EncodingKind};
use redextape_core::typeck;

fn main() {
    let list = |n: u32| format!("[{}]", (1..=n).map(|n| n.to_string()).collect::<Vec<_>>().join(", "));
    for (name, src, kind) in [
        ("sample", "let x = 40; x + 2".to_string(), EncodingKind::Unary),
        ("fact3", "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)".to_string(), EncodingKind::Unary),
        ("list60", list(60), EncodingKind::Unary),
        ("list150", list(150), EncodingKind::Binary),
    ] {
        let (p, _) = parser::parse(&src);
        let program = p.unwrap();
        let ty = typeck::result_type(&program).unwrap();
        let d = tm::run_tm_described(&redextape_core::desugar::desugar(&program), kind, ty, tm::TM_DEFAULT_CAPS).unwrap();
        let w = d.header.width;
        let time = |width: usize| {
            let mut best = f64::MAX;
            for _ in 0..5 {
                let t = Instant::now();
                let _ = SourceMap::build_from_program(&program, &*kind.at(width));
                best = best.min(t.elapsed().as_secs_f64() * 1e3);
            }
            best
        };
        println!("{name} {kind:?}: fitted width {w}; map at width 4 {:.2} ms, at width {w} {:.2} ms (best of 5)", time(tm::MIN_FIELD_WIDTH), time(w));
    }
}
```

**The grouping probe**, `web/tests/browser/zz-probe-group-cost.test.ts`, run three times, each a fresh page, against the release wasm package: `cd web && pnpm exec vitest run --project browser --reporter=verbose tests/browser/zz-probe-group-cost.test.ts`. The first call on each machine is the one a compile pays; the page's first machine is `fact(3)`, so `list60` and `list150` run warm code on a machine the page has not grouped before.

```ts
import { it } from 'vitest'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import { groupStates } from '../../src/state-groups'
import type { TmProgram } from '../../src/types'

const FACT3 = 'fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)'
const list = (n: number) => `[${Array.from({ length: n }, (_, i) => i + 1).join(', ')}]`

it('probe: what groupStates costs on the main thread, once per compile', { timeout: 300_000 }, async () => {
  await init()
  const machines = [
    ['fact3', FACT3, 'unary'],
    ['list60', list(60), 'unary'],
    ['list150', list(150), 'binary'],
  ] as const
  for (const [name, src, encoding] of machines) {
    const { session } = compile(src, encoding) as { session: { tmProgram(): TmProgram } }
    const p = session.tmProgram()
    const times: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const t = performance.now()
      groupStates(p)
      times.push(performance.now() - t)
    }
    const first = times[0]
    times.sort((a, b) => a - b)
    console.log(
      `PROBE ${name} ${encoding}: ${p.states.length} states, groupStates first ${first?.toFixed(1)} ms, best ${times[0]?.toFixed(1)} ms, median ${times[2]?.toFixed(1)} ms of 5`,
    )
  }
})
```

The name-order probe behind the 48 and 9 arcs of finding 8 and Task 4 is the spec's §14.6.
