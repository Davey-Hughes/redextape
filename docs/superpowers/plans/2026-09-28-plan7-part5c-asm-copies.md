# Plan 7 part 5c — asm copies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user edit a copy of the asm program — *edit a copy* in the asm view's menu, or a blank one from the copies menu — in an editor that part 3's language server serves, run it as the program's asm leg runs, and keep it across a reload; the copies half of [Plan 7 part 5](../specs/2026-09-27-plan7-part5-asm-design.md), §7, as amendments 22–37 settle it.

**Architecture:** The core gains `asm_label_diagnostics`, `Program::validate`'s label checks with spans, which the language server adds to asm's diagnostics and a copy refuses to run past. The wasm session prints its asm as text and `asmScratch` builds an `AsmScratch` from text: the asm leg's six methods move onto `AsmLeg`, which the session and a copy both hold. The worker builds and records an asm copy as it does a TM copy, with its value in its build reply; a copy's leg is any `Leg`. The asm view holds a copy's editor as the TM view holds a TM copy's, and the copies menu offers a blank one. Two bounds come last, each measured by a probe: a byte ceiling on a copy's text, and caps that keep a copy's worker under 256 MiB.

**Tech Stack:** Rust (`redextape-core`, `redextape-lsp`, `redextape-wasm`, wasm-bindgen), TypeScript (vanilla DOM, CodeMirror), Vitest (node and browser projects, Playwright Chromium), bash (`scripts/check-all.sh`).

## Global Constraints

- The spec is `docs/superpowers/specs/2026-09-27-plan7-part5-asm-design.md` **as amended** — amendments 22 to 37 are 5c's. Where this plan and the spec disagree, stop and ask.
- A copy's leg is any `Leg`: `legs.ts`'s `CopyLeg` is deleted, and every switch over a copy's leg has an asm arm (amendment 20's widening). `BUFFERS_VERSION` stays 2 (amendment 23).
- A copy refuses what `redextape run` refuses — a parse error, and a label that names nothing, is defined twice or cannot be written back — and says why in the diagnostics its editor shows (amendment 22). A register at or over `MAX_REGISTERS` is not refused: the cursor faults at step 0.
- A copy's value comes with its build (amendment 26): decoded by its `result` header, or the raw `rr` word marked "(no result type)" without one. A copy's status is `AsmStatus` itself.
- A row in a copy — an asm instruction or a TM state — links nothing and says nothing (amendment 28).
- The umbrella's §4 rules bind every control: a control that cannot apply is removed, one that could but cannot now is disabled with its reason. Every mark has a non-colour cue.
- No library path may panic: no `unwrap`, `expect`, `panic!` or unchecked indexing outside tests.
- Doc comments are `///` in Rust and `/** */` in TypeScript. No `file:line` citations in tracked source (the pre-commit hook rejects them); they are normal in `docs/`. A possessive citation (`` `x.ts`'s `sym` ``) must name the file that declares the symbol. No plan task numbers in shipped code.
- The pre-commit hook runs `cargo fmt --check`, clippy with `-D warnings` (pedantic), `biome ci --error-on-warnings`, `pnpm run typecheck` and the hygiene scans on every commit. Never `--no-verify`.
- No colour literal outside the palette's fallback block in `web/src/style.css` (the colour gate).
- Every native test and build runs under `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0`. A Rust sabotage run uses `--no-fail-fast`, and its *Summary* line is read, not only its `FAIL` lines.
- **Run one browser suite at a time.** Two started together on one machine have hung, both idle, until killed, and a browser run under another's load has timed out a wait that passes alone. **Do not edit files a browser run is using**: Vite reloads the modules mid-run and the failures that follow are the edit's, not the code's.
- **A sabotage run can write files of its own.** A failing proptest writes a `*.proptest-regressions` seed, and a failing browser test a screenshot under `web/tests/browser/__screenshots__/` (gitignored). After every sabotage, `git status` must show only what the task changed.

## How to use the code in this plan

**The code below is the prototype's, verbatim, and it was rebuilt from this document's own blocks before the plan was committed** (see Pre-flight status). Every change is a patch:

- Save the block to a file **outside the repository** (the session scratchpad) and run `git apply <that file>` from the repository root. A patch that does not apply means the tree has drifted from the state this plan was built against — this plan's own commit plus the tasks before it. Stop and report; do not hand-merge.
- Each task's **tests' half** goes in first, so the red step can be observed; then its **source half**. A new file appears in its patch whole (`new file mode`). A Rust source file whose test module changed puts the module in the tests' half and the rest in the source half.
- The patches are fenced with four backticks, because some carry a doc comment's own three.

**Build the wasm before a web task's browser tests**, from `web/`: `pnpm run build:wasm` (the release build CI uses) and `pnpm run build:bindings`, which `pnpm run typecheck` and `pnpm test` also run. **The language server's package too, after Task 1**: `pnpm run build:lsp-wasm` builds `pkg-lsp/` from `redextape-lsp`, and the asm editor's label marks come from Task 1's change there — a `pkg-lsp/` built before it shows none. A fresh checkout or worktree needs `pkg-lsp/` once anyway, or `tsc` cannot find it. The red and green steps below that need a build carry it.

**Stage before running a hygiene scan by hand.** `check-attributions` resolves a citation against *tracked* files, so a new file that is not yet `git add`ed reads as missing. The hook runs on the staged commit, where that cannot happen.

**Use your own `CARGO_TARGET_DIR` in a worktree.** A scratch worktree building into the main checkout's `target/` has linked the other checkout's library before; give each checkout its own directory under `target/`.

**Where `web/node_modules` is a symlink** to another checkout's, no web font loads (Vite's allow-list), `fonts.test.ts` fails its two cases, and every text-geometry result differs from a real install's. Install the checkout's own (`pnpm install --frozen-lockfile`).

## Pre-flight status

**Every task was built, gated and sabotaged before this plan was written**, in a scratch worktree off `364f386`, the spec's amendments 22–30. It was then rebuilt task by task from this document's own code blocks on a fresh worktree at `0256926`, the spec's last amendment — which differs from `364f386` only in `docs/` — as an executor would. Each task's tests' half was applied and its red steps run as written, then its source half; the tree was staged and compared with the prototype's, `docs/` aside; its green steps were run as written and it was committed through the pre-commit hook; and every sabotage in its table was run, one at a time, restored after each. Every *Expected* block below is what that run printed, and every *Fails* column is what that sabotage failed there.

| Task | Tree against the prototype | Red step | Green steps and hook | Sabotages fired |
|---|---|---|---|---|
| 1 | IDENTICAL | failed to compile | passed | 7 of 7 |
| 2 | IDENTICAL | failed to compile | passed | 10 of 10 |
| 3 | IDENTICAL | 14 tests failed; 4 tests failed | passed | 17 of 17 |
| 4 | IDENTICAL | 1 test failed; 16 tests failed | passed | 17 of 17 |
| 5 | IDENTICAL | 7 tests failed; 4 tests failed | passed | 8 of 8 |
| 6 | IDENTICAL | failed to compile | passed | 7 of 7 |

**66 sabotages were run, one at a time; 66 fired on the test they were aimed at.** Each task lists its own.

**What replaying this plan found, before it was committed:**

1. **The reload test passed in Task 5's red step.** A reloaded asm copy needs Task 3's store and Task 4's gesture and nothing of Task 5's, so the test moved to Task 4, whose red step it fails.
2. **The probe's second run put the ceiling lower.** The replay's run of `test:probe:asm-copy` had 5,600,025 bytes over budget at 250.8 ms, where the prototype's had it under at 247.3 ms; 5,700,000, the ceiling the first run gave, would have been over. The ceiling is now the largest size under budget in both runs, 5,400,000 (spec amendment 36).
3. **Every replay's probe run kept 5,400,000 under budget.** Five runs of `test:probe:asm-copy`, one in each replay, put 5,400,000 bytes under the 250 ms; two of them put 5,600,025 bytes over it, at 250.8 and 251.8 ms, and the others had it, and once 5,800,050 bytes, under. Every run's memory figures were the same to the tenth of a MiB.
4. **Nothing tested hover in a copy's editor**, which the spec's §9 asks for beside diagnostics, format and outline — found checking the plan against the spec before committing it. Task 4 has the test now, and a sabotage that builds the copy's editor with no language server fails it (Task 4, sabotage 17).

**What the prototype found, all answered in the code below and the last seven in the spec's amendments 31–37:**

1. **Amendment 22 was wrong about names.** It said `validate`'s check of a name the printer cannot write back cannot come from parsed text; the parser reads `jmp\ttarget:` and `x,y:` as labels, and `asm_roundtrip.rs` already pinned such a case. The label check marks them too (amendment 31, Task 1).
2. **A TM copy's state rows linked the program's constructs, on `main`.** Amendment 28 left a check by a real click to the plan; a probe clicked a TM copy's `wl1s2` row and the source pinned `40`, and its `pc1` row pinned `x`, through the program's link index. Both views' row handlers return for a copy now (amendment 32, Task 4).
3. **A TM view moved off its copy and back had no editor, on `main`** — found writing the asm view's test for the same gesture, and then probed on the TM view: the same-leg rebind held the editor for a claim control only λ views offer. A TM or asm view destroys the editor it leaves (amendment 33, Task 4).
4. **A copy's `[continue]` needed a reply of its own**, since a copy gets no `result`: `asm-value` (amendment 34, Task 3).
5. **The value line needed the TM copy's rule**: the first draft wrote `value: fault: …` (amendment 35, Task 4's `endedLine`).
6. **The worst case for a copy's memory is the two caps together.** A heap filled to its cap and then a million-word locals bank saved by every `call` reached 168.4 MiB under the caps chosen; each alone fitted more easily. A `cons` a step under a loop hit the step cap before the heap cap, so the probe unrolls it a hundred to a jump (amendment 36, Task 6).
7. **The ceiling's first boundary test could not fail**: it built its over-the-ceiling text by prefixing a label mistake to the at-the-ceiling one, 13 bytes over, so a ceiling admitting one byte more passed. The boundary is `MAX_SCRATCH_ASM_BYTES + 1` exactly, and "refused unparsed" is its own assertion (Task 6, sabotage 3).
8. **Two sabotages could not fire, and neither is in a table.** A value clear in `AsmPane.setDetached`, the TM view's "second line", repeated a clear every route onto a session already makes through `seedAsm`, so it was removed. The drop pass's destroy of a closed asm view's editor is held by no test — nor is the TM view's: removing the TM one left 733 of 733 browser tests green. Its only effect is freeing the editor, whose language-server document the next editor on the copy reopens; it stays, as the TM view's does, and the roadmap entry says so.
9. **The asm view's CSS would have shown its hidden panels**: `.asm-pane > .panel[data-open="true"]` gave `display: flex` to the text and outline panels a view of the program hides, outranking `[hidden]`. The rules name their panels now, and `hidden.test.ts` — which copies each view — catches the outline's case (Task 4, sabotage 15).
10. **Every step count read "1 reductions" for one step**, not only asm's: `counted` serves the three legs (amendment 29, Task 5).
11. **Two hygiene gates refused three of the prototype's commits**, each over a claim the change had made stale: `check-doc-figures.sh` on the README's export and browser-test counts and `tapeNames`' ordinal (Task 2); `check-attributions.sh` on `draw.ts` citing `legs.ts`'s deleted `CopyLeg` (Task 3) and on `tm-blank-buffer-cap.test.ts` citing `buffer-list.ts`'s renamed `onNewTm` (Task 5).
12. **A copy in a half-height view puts its listing below the fold.** In the default tree at 1280×800 the text panel's editor takes the top of the asm view and the listing is reached by scrolling the view or collapsing the text panel — as a TM copy's tapes are. Seen by hand, not changed.

**Verified fixtures**, each measured by running it — every figure below is one a test in this plan asserts:

| Fixture | Where | Measured |
|---|---|---|
| `let x = 40; x + 2` | Tasks 2–4 | its asm text is `result Nat`, a blank line, and five instructions from `li r0, #40` to `halt`; a copy of it runs 5 instructions to 42 |
| `fn map(xs, f) { … } map([3, 1, 2], \|x\| x + 1)` and `let mut acc = 0; let bump = \|n\| { acc = acc + n; acc }; bump(1); acc` | Tasks 1, 2 | `lower_asm` refuses both and `defunc` rewrites them; with `asm_roundtrip.rs`'s `DEMOS` they reach all 16 instruction variants, and the text each prints reads back to it with nothing to mark |
| `\|x\| x + 1` | Task 2 | a function type: the program's value is `Undecodable`, its text has no header, and a copy's value is its raw word marked "(no result type)" |
| a 2,048-element list literal | Tasks 2, 3 | the asm lowering refuses it, so the session has no asm text |
| `\tli\tr1000000, #0\n\thalt\n` and the empty text | Task 2 | each parses with nothing to mark and faults at step 0: "register index exceeds MAX_REGISTERS at pc0", "ran past end of program at pc0" |
| `f:\n    li\tr999, #1\n    call\tf\n` | Task 6 | under `COPY_CAPS` its saved frames fill after 12,000 calls: 24,001 instructions, then the memory cap |
| a hundred `cons` a jump | Task 6 | under `COPY_CAPS` it stops heap-full at 2,000,000 cells |

## File structure

**Created**

| File | Task | Responsibility |
|---|---|---|
| `web/src/asm-seed.ts` | 4 | `seedAsm`: what an asm view is told of its session — the listing, whether it can be copied, a copy's value — from every route onto a session |
| `crates/redextape-wasm/src/probe.rs` | 6 | `asmScratchWithCaps`, compiled only under `probe-asm-copy` |
| `web/tests/browser/asm-copy-cost.test.ts`, `asm-copy-memory.test.ts`, `asm-copy-memory-worker.ts` | 6 | the two probes behind the ceiling and the copy caps, outside the default test set |

**Modified**

| File | Task | What changes |
|---|---|---|
| `crates/redextape-core/src/tm/asm_syntax.rs`, `tm/asm.rs`, `tm.rs`, `nav.rs` | 1 | `asm_label_diagnostics`; `label_name_representable` becomes `pub(crate)`; two docs that said asm never marks a label |
| `crates/redextape-lsp/src/language.rs`, `lib.rs` | 1 | asm's diagnostics are the parse's and the label marks |
| `crates/redextape-wasm/src/session.rs`, `lib.rs` | 2, 6 | the asm leg's methods on `AsmLeg`; `asm_text`; `AsmScratch` and `asm_scratch`; the ceiling and `COPY_CAPS` |
| `README.md`, `scripts/check-doc-figures.sh` | 2 | ten free exports, `tapeNames()` the tenth, 33 wasm browser tests |
| `web/src/{protocol,session-client,session-worker}.ts` | 3 | the `asm-scratch` request and its two replies; `compiled.asmText`; the worker builds and records an asm copy |
| `web/src/{legs,scratch,sessions,replies,buffers-store,buffer-list,main,pane-host,draw}.ts` | 3 | `CopyLeg` goes; each switch over a copy's leg gains an asm arm; `AsmCompiled`, `AsmScratchReading`; a failed build judged by the copy's own leg |
| `web/src/{asm-pane,pane-chrome,transport,pane-host,replies,draw,main,results,style,lsp-protocol,link-wiring,link-status}.ts` | 4 | the asm view holds a copy's editor; `detachAsm`; a copy's rows link nothing; a TM or asm view destroys the editor it leaves; `endedLine` |
| `web/src/{buffer-list,main,readout,draw,format,results}.ts` | 5 | *new asm copy*; the asm copy's readout line; `counted` |
| `crates/redextape-wasm/Cargo.toml`, `scripts/check-all.sh`, `web/package.json`, `web/vite.config.ts` | 6 | `probe-asm-copy`, its gate legs, `test:probe:asm-copy`, the two probes in `PROBE_FILES` |

---

### Task 1: asm marks a label that names nothing, is defined twice or cannot be written back, and the language server shows it

**Files:**
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs` (`asm_label_diagnostics`), `crates/redextape-core/src/tm/asm.rs` (`label_name_representable` becomes `pub(crate)`), `crates/redextape-core/src/tm.rs` (the re-export), `crates/redextape-core/src/nav.rs` (two docs)
- Modify: `crates/redextape-lsp/src/language.rs` (asm's diagnostics), `crates/redextape-lsp/src/lib.rs` (one test comment)
- Test: `crates/redextape-core/src/tm/asm_syntax.rs` (its test module), `crates/redextape-core/tests/asm_roundtrip.rs`, `crates/redextape-lsp/src/language.rs` (its test module)

**Interfaces:**
- Produces `redextape_core::tm::asm_label_diagnostics(nav: &NameIndex) -> Vec<Diagnostic>`: an error at every reference nothing defines ("undefined label `x`"), at every definition after a label's first ("label `f` is already defined, and every jump to it reaches the first"), and at every definition whose name the printer cannot write back ("a label name cannot contain whitespace, `:` or `,`"). Task 2's `asm_scratch` refuses text carrying any.

**THE PARSER ACCEPTS ALL THREE AND `Program::validate` REFUSES ALL THREE** (spec amendment 22): this is the same check, with spans, read off the `NameIndex` `parse_asm_nav` already builds. `parse_asm_full`'s contract is unchanged — its diagnostics are still exactly the reasons it has no program — and the parser's tests that hold it stay, their comments saying where the check now lives. A property test holds the count of marks to the count of `validate`'s complaints that are not a register's, over random files of lines that each parse alone.

**THE LANGUAGE SERVER ADDS THE MARKS TO THE PARSE'S DIAGNOSTICS**, and since the index outlives a parse that fails, a broken line and a jump to nothing are both reported. Neovim gains them with the web app.

**A ROUND TRIP OVER `lower_program`'s OUTPUT, `defunc` INCLUDED**, which nothing reached before: every program the web app runs prints to text that reads back to it with nothing to mark, so *edit a copy* never hands a user a copy that refuses to run. The two corpora reach all 16 instruction variants.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=1
diff --git a/crates/redextape-core/src/tm/asm_syntax.rs b/crates/redextape-core/src/tm/asm_syntax.rs
index 8a00e6b..8226eb1 100644
--- a/crates/redextape-core/src/tm/asm_syntax.rs
+++ b/crates/redextape-core/src/tm/asm_syntax.rs
@@ -1048,12 +1048,13 @@ mod tests {
 
     #[test]
     fn a_dangling_jump_target_is_a_reference_that_resolves_to_nothing() {
-        // Probed: this parses with `program: Some` and ZERO diagnostics. asm never checks jump
-        // targets, so this is a clean file carrying a reference to nothing — not an error.
+        // Probed: this parses with `program: Some` and ZERO diagnostics. The parser never checks
+        // jump targets, so to it this is a clean file carrying a reference to nothing — not an
+        // error. `asm_label_diagnostics` is where it becomes one.
         let src = "result Nat\nf:\n\tjmp\tnowhere\n\tret\n";
         let (doc, nav) = parse_asm_nav(src);
         assert!(doc.program.is_some());
-        assert_eq!(doc.diagnostics.len(), 0, "the premise: asm does not check jump targets");
+        assert_eq!(doc.diagnostics.len(), 0, "the premise: the parser does not check jump targets");
         let (i, _) = nav.at(src.find("nowhere").expect("fixture")).expect("still a reference");
         assert_eq!(nav.definition_of(i), None);
     }
@@ -1061,15 +1062,92 @@ mod tests {
     #[test]
     fn a_duplicate_label_is_listed_twice_and_the_first_one_is_linked() {
         // Probed: `labels` comes back [("f", 0), ("f", 0)] with ZERO diagnostics — unlike `.tm`,
-        // which diagnoses a duplicate state name. Both must appear in an outline.
+        // whose parser diagnoses a duplicate state name; `asm_label_diagnostics` marks this one.
+        // Both must appear in an outline.
         let src = "result Nat\nf:\nf:\n\tjmp\tf\n\tret\n";
         let (doc, nav) = parse_asm_nav(src);
-        assert_eq!(doc.diagnostics.len(), 0, "the premise: asm does not diagnose duplicates");
+        assert_eq!(doc.diagnostics.len(), 0, "the premise: the parser does not diagnose duplicates");
         assert_eq!(nav.definitions().count(), 2);
         let (i, _) = nav.at(src.rfind('f').expect("fixture")).expect("the jmp operand");
         assert_eq!(nav.definition_of(i), Some(0), "the FIRST `f:`");
     }
 
+    /// Each label mistake, at the name that makes it: the text each diagnostic's span covers, and its message.
+    /// Rows are one mistake each, plus a clean file and a register over the cap, which has no name to mark.
+    #[test]
+    fn a_label_mistake_is_marked_at_its_name() {
+        let marks = |src: &str| {
+            let (doc, nav) = parse_asm_nav(src);
+            assert!(doc.program.is_some(), "the premise: {src:?} parses");
+            asm_label_diagnostics(&nav)
+                .into_iter()
+                .map(|d| (src[d.span.start..d.span.end].to_string(), d.message))
+                .collect::<Vec<_>>()
+        };
+        assert_eq!(
+            marks("result Nat\nf:\n\tjmp\tnowhere\n\tret\n"),
+            [("nowhere".into(), "undefined label `nowhere`".into())]
+        );
+        assert_eq!(
+            marks("f:\n\tjz\tr0, g\nf:\n\tjmp\tf\n\thalt\ng:\n\thalt\n"),
+            [("f".into(), "label `f` is already defined, and every jump to it reaches the first".into())],
+        );
+        assert_eq!(
+            marks("jmp\ttarget:\n\thalt\n"),
+            [("jmp\ttarget".into(), "a label name cannot contain whitespace, `:` or `,`".into())],
+        );
+        assert_eq!(
+            marks("x,y:\n\thalt\n"),
+            [("x,y".into(), "a label name cannot contain whitespace, `:` or `,`".into())]
+        );
+        assert_eq!(marks(NAV_ASM), Vec::<(String, String)>::new(), "a clean file has nothing to mark");
+        assert_eq!(marks("\tli\tr1000000, #0\n\thalt\n"), Vec::<(String, String)>::new(), "a register has no name");
+        assert!(
+            !parse_asm_full("\tli\tr1000000, #0\n\thalt\n")
+                .program
+                .map(|p| p.validate())
+                .unwrap_or_default()
+                .is_empty()
+        );
+    }
+
+    mod label_diagnostics_are_validate_with_spans {
+        use proptest::prelude::*;
+
+        use super::super::{asm_label_diagnostics, parse_asm_nav};
+
+        /// Lines that each parse on their own, chosen so a file of them can make every mistake `validate` knows: a
+        /// label defined twice, one that cannot be written back, a jump to nothing, and a register over the cap.
+        const LINES: &[&str] = &[
+            "f:",
+            "g:",
+            "a b:",
+            "x,y:",
+            "\tjmp\tf",
+            "\tcall\tg",
+            "\tjz\tr0, h",
+            "\tjmp\tq",
+            "\thalt",
+            "\tret",
+            "\tli\tr1, #1",
+            "\tli\tr1000000, #0",
+        ];
+
+        proptest! {
+            /// A parsed file has as many label diagnostics as `validate` has complaints that are not a register's:
+            /// each check is one complaint per offending label or jump on both sides, so a count that differs is a
+            /// mistake one side sees and the other does not.
+            #[test]
+            fn label_diagnostics_count_what_validate_refuses_but_a_register(picks in prop::collection::vec(0..LINES.len(), 0..24)) {
+                let src: String = picks.iter().map(|&i| format!("{}\n", LINES[i])).collect();
+                let (doc, nav) = parse_asm_nav(&src);
+                let program = doc.program.expect("every line parses alone, and so does any file of them");
+                let refused = program.validate().into_iter().filter(|e| !e.contains("MAX_REGISTERS")).count();
+                prop_assert_eq!(asm_label_diagnostics(&nav).len(), refused, "{:?}", src);
+            }
+        }
+    }
+
     #[test]
     fn a_trailing_comment_does_not_shift_any_span() {
         // **A SPAN IS MEASURED FROM THE LINE'S START AND A COMMENT IS REMOVED FROM ITS END**, so
diff --git a/crates/redextape-core/tests/asm_roundtrip.rs b/crates/redextape-core/tests/asm_roundtrip.rs
index 7b449c7..1fd4b6c 100644
--- a/crates/redextape-core/tests/asm_roundtrip.rs
+++ b/crates/redextape-core/tests/asm_roundtrip.rs
@@ -15,7 +15,10 @@ use redextape_test_support::arb_expr_over;
 
 use redextape_core::desugar::desugar;
 use redextape_core::parser::parse;
-use redextape_core::tm::{AsmHeader, Instr, Program, lower_asm, parse_asm, parse_asm_full, print_asm, print_asm_with};
+use redextape_core::tm::{
+    AsmHeader, Instr, Program, asm_label_diagnostics, lower_asm, lower_program, parse_asm, parse_asm_full,
+    parse_asm_nav, print_asm, print_asm_with,
+};
 use redextape_core::ty::Ty;
 
 /// The programs P1 is held over, chosen for `Instr`-variant coverage — which is what P1's evidence
@@ -307,3 +310,42 @@ fn a_header_changes_the_program_not_at_all() {
         assert_eq!(bare, with, "the header must not perturb the program for {src}");
     }
 }
+
+// ---------------------------------------------------------------------------
+// The text a web copy starts from: the program `lower_program` returns, `defunc` included.
+// ---------------------------------------------------------------------------
+
+/// Two programs `lower_asm` refuses and `defunc` rewrites: a closure passed as a value, and a `let mut` a
+/// closure writes, which `defunc` boxes. Between them they emit the three box instructions no entry in
+/// `DEMOS` can reach.
+const DEFUNC_DEMOS: &[&str] = &[
+    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } map([3, 1, 2], |x| x + 1)",
+    "let mut acc = 0; let bump = |n| { acc = acc + n; acc }; bump(1); acc",
+];
+
+/// Every program the web app runs prints to text that reads back to it, with nothing for
+/// `asm_label_diagnostics` to mark — so *edit a copy* never hands the user a copy that refuses to run.
+///
+/// **OVER `lower_program`, WHICH NOTHING ABOVE REACHES.** The round trips above lower with `lower_asm`
+/// alone; the web session lowers through `lower_program`, which retries through `defunc`, and `defunc`
+/// mints the labels of the functions it builds. A minted name the printer could not write back, or two
+/// minted with one name, would reach a copy as a mark on text the user never wrote. The two corpora
+/// together reach all 16 instruction variants, which this test counts.
+#[test]
+fn every_program_the_web_app_runs_prints_to_text_a_copy_runs() {
+    let mut seen: Vec<&'static str> = Vec::new();
+    for src in DEMOS.iter().chain(DEFUNC_DEMOS) {
+        let (ast, ds) = parse(src);
+        assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
+        let prog = lower_program(&desugar(&ast.unwrap())).unwrap_or_else(|e| panic!("{src} did not lower: {e:?}"));
+        let text = print_asm_with(&prog, &AsmHeader { result: Ty::Nat });
+        let (doc, nav) = parse_asm_nav(&text);
+        assert!(doc.diagnostics.is_empty(), "diagnostics reading back {src}: {:?}", doc.diagnostics);
+        assert_eq!(asm_label_diagnostics(&nav), Vec::new(), "label marks on the text of {src}");
+        assert_eq!(doc.program.as_ref(), Some(&prog), "{src} did not read back to the program it printed");
+        seen.extend(prog.code.iter().map(variant_name));
+    }
+    seen.sort_unstable();
+    seen.dedup();
+    assert_eq!(seen.len(), 16, "the corpora reach {seen:?}");
+}
diff --git a/crates/redextape-lsp/src/language.rs b/crates/redextape-lsp/src/language.rs
index 892627d..5a70dac 100644
--- a/crates/redextape-lsp/src/language.rs
+++ b/crates/redextape-lsp/src/language.rs
@@ -192,6 +192,22 @@ mod tests {
         assert!(!Language::Asm.diagnostics(asm).is_empty());
     }
 
+    /// asm's label marks join the parse's own, and a parse that fails does not hide them: the one line
+    /// that does not parse and the jump to nothing are both reported, in that order.
+    #[test]
+    fn asm_reports_its_label_marks_beside_its_parse_errors() {
+        let marked = |src: &str| {
+            Language::Asm
+                .diagnostics(src)
+                .into_iter()
+                .map(|d| src[d.span.start..d.span.end].to_string())
+                .collect::<Vec<_>>()
+        };
+        assert_eq!(marked("f:\n\tjmp\tnowhere\n\thalt\n"), ["nowhere"]);
+        assert_eq!(marked("f:\n\tjmp\tnowhere\n\tbogus\n"), ["\tbogus", "nowhere"]);
+        assert_eq!(marked("f:\n\tjmp\tf\n\thalt\n"), Vec::<String>::new());
+    }
+
     /// Clean. 7 newlines, 116 bytes, so the document ends at line 7, character 0.
     const TM_COMMENTS: &str = "\
 ; a machine
diff --git a/crates/redextape-lsp/src/lib.rs b/crates/redextape-lsp/src/lib.rs
index bff74a0..4be155f 100644
--- a/crates/redextape-lsp/src/lib.rs
+++ b/crates/redextape-lsp/src/lib.rs
@@ -618,8 +618,9 @@ state q1: accept
 
     #[test]
     fn references_on_a_name_nothing_defines_lists_its_other_mentions() {
-        // Probed: this parses with `program: Some` and ZERO diagnostics — asm never checks jump
-        // targets — and records two dangling references to `nowhere`. This used to answer `null`,
+        // Probed: this parses with `program: Some` and no diagnostics of the parser's own — the
+        // parser never checks jump targets; `asm_label_diagnostics` marks both, and navigation
+        // answers anyway — and records two dangling references to `nowhere`. This used to answer `null`,
         // which tells someone hunting every jump still to fix that the name under their cursor is
         // not a name. `include_declaration` has nothing to include: with no binding, every
         // occurrence IS a reference, so both are listed either way.
````


- [ ] **Step 2: Run them and see them fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core -p redextape-lsp --no-fail-fast -E 'test(label) | binary(asm_roundtrip)'`

Expected: exit 101, printing:

```text
error[E0432]: unresolved import `super::super::asm_label_diagnostics`
error[E0425]: cannot find function `asm_label_diagnostics` in this scope
error[E0432]: unresolved import `redextape_core::tm::asm_label_diagnostics`
error: could not compile `redextape-core` (test "asm_roundtrip") due to 1 previous error
error: could not compile `redextape-core` (lib test) due to 2 previous errors
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=1
diff --git a/crates/redextape-core/src/nav.rs b/crates/redextape-core/src/nav.rs
index b4ad6b2..31693f6 100644
--- a/crates/redextape-core/src/nav.rs
+++ b/crates/redextape-core/src/nav.rs
@@ -92,7 +92,8 @@ pub enum Role {
     Reference {
         /// Index into the document's occurrences. `None` when nothing in this document defines
         /// the name — `parse_asm_full` accepts `jmp nowhere` with zero diagnostics, so a
-        /// dangling reference is an ordinary value rather than an error to report.
+        /// dangling reference is an ordinary value here. Whether it is an error is a language's
+        /// answer, not this module's: for asm, `asm_label_diagnostics` says it is.
         def: Option<usize>,
     },
 }
@@ -182,8 +183,9 @@ impl NameIndex {
         }
     }
 
-    /// Every definition, in source order. A name defined twice appears twice — `.asm` accepts
-    /// that with no diagnostic, and an outline should show the file that exists.
+    /// Every definition, in source order. A name defined twice appears twice — `.asm`'s parser
+    /// accepts that with no diagnostic (`asm_label_diagnostics` marks it), and an outline should
+    /// show the file that exists.
     pub fn definitions(&self) -> impl Iterator<Item = &Occurrence> {
         self.occurrences.iter().filter(|o| matches!(o.role, Role::Definition { .. }))
     }
diff --git a/crates/redextape-core/src/tm.rs b/crates/redextape-core/src/tm.rs
index a18037f..0f5481e 100644
--- a/crates/redextape-core/src/tm.rs
+++ b/crates/redextape-core/src/tm.rs
@@ -30,7 +30,9 @@ pub use asm::{
     decode_asm_reason, decode_asm_ty, decode_asm_ty_reason, print_asm, print_asm_doc, print_asm_mapped, print_asm_with,
     print_asm_with_mapped, print_instr, run_asm,
 };
-pub use asm_syntax::{AsmDocument, MnemonicDoc, instr_at, parse_asm, parse_asm_full, parse_asm_nav};
+pub use asm_syntax::{
+    AsmDocument, MnemonicDoc, asm_label_diagnostics, instr_at, parse_asm, parse_asm_full, parse_asm_nav,
+};
 pub use attribute::{Attribution, StepBucket, attribute, attribute_at, attribute_steps};
 pub use build::{
     AT, BOX, Builder, HEAP, MARK, MAX_FIELD_WIDTH, MAX_MACHINE_STATES, MAX_TAPES, MIN_FIELD_WIDTH, REG, RuleSpec, SEP,
diff --git a/crates/redextape-core/src/tm/asm.rs b/crates/redextape-core/src/tm/asm.rs
index 6c6bdfd..10b100d 100644
--- a/crates/redextape-core/src/tm/asm.rs
+++ b/crates/redextape-core/src/tm/asm.rs
@@ -149,7 +149,7 @@ impl Program {
 /// back as a label declaration, mnemonic included, silently and with no diagnostic (design §3.3).
 /// Rejecting the set uniformly anyway is deliberate: `validate` checks names, not occurrences — it
 /// has no way to know where a given label will be used.
-fn label_name_representable(name: &str) -> bool {
+pub(crate) fn label_name_representable(name: &str) -> bool {
     !name.is_empty() && !name.chars().any(|c| c.is_whitespace() || matches!(c, ';' | ':' | ','))
 }
 
diff --git a/crates/redextape-core/src/tm/asm_syntax.rs b/crates/redextape-core/src/tm/asm_syntax.rs
index 8226eb1..db7c997 100644
--- a/crates/redextape-core/src/tm/asm_syntax.rs
+++ b/crates/redextape-core/src/tm/asm_syntax.rs
@@ -10,8 +10,10 @@
 //! for the TM text form, and for the same reasons.
 
 use crate::core::BinOp;
-use crate::nav::{DefKind, NameIndex};
-use crate::tm::asm::{AsmHeader, Instr, OperandKind, Program, Reg};
+use std::collections::HashSet;
+
+use crate::nav::{DefKind, NameIndex, Role};
+use crate::tm::asm::{AsmHeader, Instr, OperandKind, Program, Reg, label_name_representable};
 use crate::tm::comments::{self, AnchoredComment, AsmAnchor};
 use crate::{Diagnostic, Span};
 
@@ -448,6 +450,49 @@ pub fn parse_asm(src: &str) -> (Option<Program>, Vec<Diagnostic>) {
     (d.program, d.diagnostics)
 }
 
+/// The labels a file names wrongly, as errors at the names: a jump or call to a label nothing defines, a
+/// label defined again, and a label name the printer cannot write back.
+///
+/// **THE PARSER ACCEPTS ALL THREE AND `Program::validate` REFUSES ALL THREE: THIS IS THE SAME CHECK, WITH
+/// SPANS.** `parse_asm_nav` reads `jmp nowhere` with no diagnostic, resolves a duplicate label to its first
+/// definition, and reads `jmp\ttarget:` as a label with a tab in its name — a line is read alone, and a
+/// name is known wrong only once the whole file has been. `validate` refuses each as a string with no
+/// position, and `redextape run` refuses the file it rejects; an editor needs the position, and the index
+/// has it for every label and every label operand. So a file that parses and has nothing here is one
+/// `validate` passes, but for a register at or over `MAX_REGISTERS`: it has no name to point at, and the
+/// cursor faults on it at step 0. `validate`'s last check, a label past the end of the code, cannot come
+/// from text. `label_diagnostics_are_validate_with_spans` holds the two to each other.
+///
+/// **SEPARATE FROM THE PARSE, NOT MORE OF ITS DIAGNOSTICS.** `parse_asm_full`'s diagnostics are exactly the
+/// reasons it has no program, and none of these takes the program away: `redextape fmt` still formats such
+/// a file, and navigation still answers in it. The language server reports both, and a web copy refuses to
+/// run a file with either.
+#[must_use]
+pub fn asm_label_diagnostics(nav: &NameIndex) -> Vec<Diagnostic> {
+    let mut defined: HashSet<&str> = HashSet::new();
+    let mut out = Vec::new();
+    for o in (0..).map_while(|i| nav.get(i)) {
+        match o.role {
+            Role::Definition { .. } => {
+                if !label_name_representable(&o.name) {
+                    out.push(Diagnostic::error(o.span, "a label name cannot contain whitespace, `:` or `,`"));
+                }
+                if !defined.insert(o.name.as_str()) {
+                    out.push(Diagnostic::error(
+                        o.span,
+                        format!("label `{}` is already defined, and every jump to it reaches the first", o.name),
+                    ));
+                }
+            }
+            Role::Reference { def: None } => {
+                out.push(Diagnostic::error(o.span, format!("undefined label `{}`", o.name)));
+            }
+            Role::Reference { def: Some(_) } => {}
+        }
+    }
+    out
+}
+
 /// One instruction line, already stripped of indentation and comments.
 ///
 /// `parse_instr_at`'s instruction half, the shape `parse_asm` and `parse_tm` already use for the
diff --git a/crates/redextape-lsp/src/language.rs b/crates/redextape-lsp/src/language.rs
index 5a70dac..7cbd7e5 100644
--- a/crates/redextape-lsp/src/language.rs
+++ b/crates/redextape-lsp/src/language.rs
@@ -47,13 +47,24 @@ impl Language {
     ///
     /// Slice 1 adds no analysis. All four of these are already written, already tested, and
     /// already consumed by the CLI and the web UI; each returns the same spanned `Diagnostic`.
+    ///
+    /// **`.asm` ADDS ITS LABEL MARKS TO THE PARSE'S DIAGNOSTICS**: a jump to a label nothing
+    /// defines, a label defined twice, a label name the printer cannot write. The parser accepts
+    /// all three and `Program::validate` refuses all three, so `redextape run` refuses the file
+    /// and a web copy will not run it; `asm_label_diagnostics` is the same check with spans, and
+    /// the index it reads outlives a parse that fails, so both kinds show together.
     #[must_use]
     pub fn diagnostics(self, src: &str) -> Vec<Diagnostic> {
         match self {
             Language::Redextape => redextape_core::analyze(src).diagnostics,
             Language::Lambda => redextape_core::lambda::parse_lambda(src).1,
             Language::Tm => redextape_core::tm::parse_tm_full(src).diagnostics,
-            Language::Asm => redextape_core::tm::parse_asm_full(src).diagnostics,
+            Language::Asm => {
+                let (doc, nav) = redextape_core::tm::parse_asm_nav(src);
+                let mut all = doc.diagnostics;
+                all.extend(redextape_core::tm::asm_label_diagnostics(&nav));
+                all
+            }
         }
     }
 
````


- [ ] **Step 4: Run them and see them pass.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core -p redextape-lsp --no-fail-fast -E 'test(label) | binary(asm_roundtrip)'`

Expected: exit 0, printing:

```text
Summary: 38 tests run: 38 passed, 1381 skipped
```

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core -p redextape-lsp --no-fail-fast`

Expected: exit 0, printing:

```text
Summary: 1387 tests run: 1387 passed, 32 skipped
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 7 of 7 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | a jump to nothing is not marked — `asm_syntax.rs`: `` out.push(Diagnostic::error(o.span, format!("undefined label `{}`", o.name))); `` → `let _ = &o.name;` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(label) | binary(asm_roundtrip)'` | `redextape-core tm::asm_syntax::tests::a_label_mistake_is_marked_at_its_name`, `redextape-core tm::asm_syntax::tests::label_diagnostics_are_validate_with_spans::label_diagnostics_count_what_validate_refuses_but_a_register` |
| 2 | a second definition is not marked — `asm_syntax.rs`: `if !defined.insert(o.name.as_str()) {` → `if !defined.insert(o.name.as_str()) && o.name.is_empty() {` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(label) | binary(asm_roundtrip)'` | `redextape-core tm::asm_syntax::tests::a_label_mistake_is_marked_at_its_name`, `redextape-core tm::asm_syntax::tests::label_diagnostics_are_validate_with_spans::label_diagnostics_count_what_validate_refuses_but_a_register` |
| 3 | a name the printer cannot write is not marked — `asm_syntax.rs`: `if !label_name_representable(&o.name) {` → `if !label_name_representable(&o.name) && o.name.is_empty() {` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(label) | binary(asm_roundtrip)'` | `redextape-core tm::asm_syntax::tests::label_diagnostics_are_validate_with_spans::label_diagnostics_count_what_validate_refuses_but_a_register`, `redextape-core tm::asm_syntax::tests::a_label_mistake_is_marked_at_its_name` |
| 4 | a resolved jump is marked too — `asm_syntax.rs`: `Role::Reference { def: Some(_) } => {}` → `Role::Reference { def: Some(_) } => out.push(Diagnostic::error(o.span, "x")),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(label) | binary(asm_roundtrip)'` | `redextape-core tm::asm_syntax::tests::a_label_mistake_is_marked_at_its_name`, `redextape-core::asm_roundtrip every_program_the_web_app_runs_prints_to_text_a_copy_runs`, `redextape-core tm::asm_syntax::tests::label_diagnostics_are_validate_with_spans::label_diagnostics_count_what_validate_refuses_but_a_register` |
| 5 | a minted name reads as unwritable — `asm.rs`: `matches!(c, ';' | ':' | ',')` → `matches!(c, ';' | ':' | ',' | '$')` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(label) | binary(asm_roundtrip)'` | `redextape-core::asm_roundtrip every_program_the_web_app_runs_prints_to_text_a_copy_runs` |
| 6 | the server reports the parse alone — `language.rs`: `all.extend(redextape_core::tm::asm_label_diagnostics(&nav));` → `let _ = &nav;` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-lsp --no-fail-fast` | `redextape-lsp language::tests::asm_reports_its_label_marks_beside_its_parse_errors` |
| 7 | a parse error hides the marks — `language.rs`: `all.extend(redextape_core::tm::asm_label_diagnostics(&nav));` → `if all.is_empty() { ⏎                     all.extend(redextape_core::tm::asm_label_diagnostics(&nav)); ⏎                 }` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-lsp --no-fail-fast` | `redextape-lsp language::tests::asm_reports_its_label_marks_beside_its_parse_errors` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
asm marks a label that names nothing, is defined twice or cannot be written back, and the language server shows it

The parser accepts all three on purpose and `Program::validate`
refuses all three, so `redextape run` refused a file its editor
called clean. `asm_label_diagnostics` is `validate`'s label checks
with spans, read off the name index the parser already builds; a
property test holds its count to `validate`'s, a register over the
cap aside, which has no name to mark and faults at step 0. The
language server adds the marks to asm's parse diagnostics, and a
round trip over `lower_program`'s output — `defunc` included, which
nothing reached before — finds nothing to mark in the text any
program the web app runs prints to.
````


---

### Task 2: The wasm session prints its asm as text, and `asmScratch` runs text as a copy with the asm leg's own methods

**Files:**
- Modify: `crates/redextape-wasm/src/session.rs` (`AsmLeg`'s methods, `Session::asm_text`, `AsmScratch`, `asm_scratch`), `crates/redextape-wasm/src/lib.rs` (the `AsmScratch` class, `asmScratch`, `Session.asmText`)
- Modify: `README.md` and `scripts/check-doc-figures.sh` — the free exports go from nine to ten, and `tapeNames()` from the ninth to the tenth; the wasm browser tests from 30 to 33
- Test: `crates/redextape-wasm/src/session.rs` (its test module), `crates/redextape-wasm/tests/browser.rs`

**Interfaces:**
- Consumes Task 1's `tm::asm_label_diagnostics`.
- Produces `session::asm_scratch(src) -> Scratched<AsmScratch>` and, for tests, `asm_scratch_with_caps(src, caps)`; `AsmScratch`'s `asm_status() -> AsmStatus`, `asm_program() -> AsmProgram`, `step_asm() -> bool`, `asm_state(AsmWindow) -> AsmState` (`source_node` always `None`), `raise_asm_cap(u64)`, `asm_value() -> Decoded`; and `Session::asm_text() -> Option<String>`.
- JavaScript: `asmScratch(src)` → `{ diagnostics, scratch: AsmScratch | null }`; `AsmScratch`'s `asmStatus`, `asmProgram`, `stepAsm`, `asmState(window)`, `raiseAsmCap(n)`, `asmValue`; `Session.asmText()` → `string | null`, `null` crossing as `null`.

**ONE IMPLEMENTATION OF THE ASM LEG FOR THE PROGRAM AND A COPY.** `build_asm_leg`'s run to the end moves into `AsmLeg::run`, and the six methods move onto `AsmLeg`; `Session` and `AsmScratch` each hold one and forward. A copy hands in no map and its header's type, so `source_node` is `None` and a copy with no header marks its raw word "(no result type)". Every field of `AsmStatus` is true of a copy, so a copy answers the same status type (amendment 26).

**THE TEXT IS THE PROGRAM THE CURSOR RUNS**, printed by `print_asm_with` under the program's type when a header can name it (`ty::parse_ty(&ty::show(ty))`, as `redextape emit --lang asm` reads it); a function-typed program prints with no header. A copy of the program's text runs as the program does, frame for frame but for the owner.

**A COPY REFUSES WHAT `redextape run` REFUSES**: text that does not parse, and Task 1's label marks. A register over the cap and an empty program are not refused: each faults at step 0 ("register index exceeds MAX_REGISTERS at pc0", "ran past end of program at pc0").

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=2
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index be1c94d..cc1905d 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -3011,6 +3011,130 @@ mod tests {
         assert!(owners.iter().all(|o| *o >= 0), "a first-order program owns every instruction: {owners:?}");
     }
 
+    // --- the asm copy -------------------------------------------------------------------------------
+
+    /// A higher-order program: `lower_asm` refuses it and `defunc` rewrites it, so its asm has labels
+    /// `defunc` minted.
+    const MAP: &str = "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
+                       map([3, 1, 2], |x| x + 1)";
+
+    /// Step a copy's cursor until it stops, and say how many steps it took.
+    fn run_copy_out(sc: &mut AsmScratch) -> u64 {
+        let mut steps = 0;
+        while sc.step_asm() {
+            steps += 1;
+        }
+        steps
+    }
+
+    /// A copy of the program's text runs as the program does: the same status before a step, the same listing,
+    /// the same value, and the same frame at every step but for its owner, which a copy has none of. Over a
+    /// first-order program, a recursive one, one that faults, one with a heap, and one `defunc` rewrote.
+    #[test]
+    fn a_copy_of_the_programs_text_runs_as_the_program_does() {
+        for src in ["let x = 40; x + 2", FACT3, "head([])", "[1, 2, 3]", MAP] {
+            let mut s = Session::compile(src, EncodingKind::Unary).session.expect("compiles");
+            let text = s.asm_text().expect("the asm leg is there");
+            let made = asm_scratch(&text);
+            assert_eq!(made.diagnostics, Vec::new(), "{src}");
+            let mut sc = made.scratch.expect("the program's text builds a copy");
+            assert_eq!(sc.asm_status(), s.asm_status(), "{src}");
+            assert_eq!(Ok(sc.asm_program()), s.asm_program(), "{src}");
+            assert_eq!(Ok(sc.asm_value()), s.asm_value(), "{src}");
+            loop {
+                let (mine, theirs) = (sc.asm_state(ASM_WHOLE), s.asm_state(ASM_WHOLE).expect("asm available"));
+                assert_eq!(mine.source_node, None, "{src}: a copy has no owners");
+                assert_eq!(mine, AsmState { source_node: None, ..theirs }, "{src}");
+                let (a, b) = (sc.step_asm(), s.step_asm().expect("asm available"));
+                assert_eq!(a, b, "{src}: the two stop together");
+                if !a {
+                    break;
+                }
+            }
+            assert_eq!(sc.asm_status(), s.asm_status(), "{src}: and end together");
+        }
+    }
+
+    /// The text carries the program's type as its header when a header can name it, and none when it cannot:
+    /// a function-typed program's copy has no type to decode by, so its value is the raw word, marked, where
+    /// the program's own is `Undecodable`.
+    #[test]
+    fn a_copy_decodes_by_its_header_and_marks_a_raw_word_without_one() {
+        let s = Session::compile("[1, 2, 3]", EncodingKind::Unary).session.expect("compiles");
+        let text = s.asm_text().expect("the asm leg is there");
+        assert!(text.starts_with("result List<Nat>\n"), "{text}");
+        assert_eq!(
+            asm_scratch(&text).scratch.expect("builds").asm_value(),
+            Decoded::Value { text: "[1, 2, 3]".into() }
+        );
+
+        let s = Session::compile("|x| x + 1", EncodingKind::Unary).session.expect("compiles");
+        let text = s.asm_text().expect("the asm leg is there");
+        assert!(!text.contains("result"), "a function type has no header: {text}");
+        let sc = asm_scratch(&text).scratch.expect("builds");
+        assert_eq!(s.asm_value(), Ok(Decoded::Undecodable), "the program's own value");
+        assert!(matches!(sc.asm_value(), Decoded::Value { text } if text.ends_with(" (no result type)")));
+
+        let sc = asm_scratch("\tli\trr, #42\n\thalt\n").scratch.expect("builds");
+        assert_eq!(sc.asm_value(), Decoded::Value { text: "42 (no result type)".into() });
+    }
+
+    /// No asm leg, no text.
+    #[test]
+    fn a_declined_asm_leg_has_no_text() {
+        let src = format!("[{}]", (0..2048).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
+        let s = Session::compile(&src, EncodingKind::Unary).session.expect("a declined leg is still a session");
+        assert!(!s.asm_status().available, "the premise");
+        assert_eq!(s.asm_text(), None);
+    }
+
+    /// A copy refuses what `redextape run` refuses, and says why in the diagnostics its editor shows: a line
+    /// that does not parse, a jump to nothing, a label defined twice.
+    #[test]
+    fn a_copy_refuses_a_parse_error_and_a_label_mistake() {
+        for (text, message) in [
+            ("\tbogus\n", "unknown mnemonic `bogus`"),
+            ("\tjmp\tnowhere\n", "undefined label `nowhere`"),
+            ("f:\nf:\n\thalt\n", "label `f` is already defined, and every jump to it reaches the first"),
+        ] {
+            let made = asm_scratch(text);
+            assert!(made.scratch.is_none(), "{text:?} builds nothing");
+            let said: Vec<_> = made.diagnostics.iter().map(|d| d.message.as_str()).collect();
+            assert_eq!(said, [message], "{text:?}");
+        }
+    }
+
+    /// What a copy cannot refuse by name ends its run at step 0 instead, and the value says where: a register
+    /// over the cap, and an empty program, whose first fetch runs past its end.
+    #[test]
+    fn a_register_over_the_cap_and_an_empty_program_fault_at_step_0() {
+        for (text, fault) in [
+            ("\tli\tr1000000, #0\n\thalt\n", "register index exceeds MAX_REGISTERS at pc0"),
+            ("", "ran past end of program at pc0"),
+        ] {
+            let mut sc = asm_scratch(text).scratch.expect("it parses and has no label to mark");
+            assert_eq!(sc.asm_status().total_steps, Some(0), "{text:?}");
+            assert_eq!(sc.asm_value(), Decoded::Fault { message: fault.into() }, "{text:?}");
+            assert_eq!(run_copy_out(&mut sc), 0, "{text:?}");
+            assert_eq!(sc.asm_status().run, Some(RunStatus::Ended), "{text:?}");
+        }
+    }
+
+    /// A copy the step cap stopped resumes under a raised cap to its value, read off the cursor.
+    #[test]
+    fn a_capped_copy_resumes_to_its_value() {
+        let s = Session::compile("[1, 2, 3]", EncodingKind::Unary).session.expect("compiles");
+        let text = s.asm_text().expect("the asm leg is there");
+        let caps = tm::asm::Caps { steps: 3, ..tm::asm::DEFAULT_CAPS };
+        let mut sc = asm_scratch_with_caps(&text, caps).scratch.expect("builds");
+        assert_eq!((sc.asm_status().total_steps, sc.asm_value()), (Some(3), Decoded::Unfinished));
+        assert_eq!(run_copy_out(&mut sc), 3);
+        assert_eq!(sc.asm_status().cap, Some(AsmCap::Steps));
+        sc.raise_asm_cap(1_000_000);
+        run_copy_out(&mut sc);
+        assert_eq!(sc.asm_value(), Decoded::Value { text: "[1, 2, 3]".into() });
+    }
+
     // --- the TM scratchpad -----------------------------------------------------------------------
 
     /// A hand-written unary incrementer with NO header — δ and a start state and nothing else, which is
diff --git a/crates/redextape-wasm/tests/browser.rs b/crates/redextape-wasm/tests/browser.rs
index 2a607c2..8c0cd9a 100644
--- a/crates/redextape-wasm/tests/browser.rs
+++ b/crates/redextape-wasm/tests/browser.rs
@@ -1337,6 +1337,13 @@ mod scratch_methods_that_must_not_exist {
         (s.tm_value(), s.source_span(0), s.link_index(0))
     }
     const _: fn(&redextape_wasm::TmScratch) -> (Absent, Absent, Absent) = tm_scratch_has_none_of_them;
+
+    /// An asm copy has no `SourceMap`, so no `sourceSpan` or `linkIndex`; its value is `asmValue`, the leg's
+    /// own, so neither of the other legs' value methods is on it either.
+    fn asm_scratch_has_none_of_them(s: &redextape_wasm::AsmScratch) -> (Absent, Absent, Absent, Absent) {
+        (s.lambda_value(), s.tm_value(), s.source_span(0), s.link_index(0))
+    }
+    const _: fn(&redextape_wasm::AsmScratch) -> (Absent, Absent, Absent, Absent) = asm_scratch_has_none_of_them;
 }
 
 /// An `AsmWindow` as a renderer builds one: a plain JS object with five named counts.
@@ -1459,3 +1466,60 @@ fn a_declined_asm_leg_reports_why_and_its_methods_throw() {
         assert!(Reflect::apply(&f, &session, &args).is_err(), "{method} must throw for an absent leg");
     }
 }
+
+/// A copy of the program's asm through the glue: `asmText` crosses as a string headed by the program's type,
+/// `asmScratch` builds a handle from it with no diagnostics, and every method a renderer calls answers as the
+/// session's does — the same status, listing and value — but for `source_node`, `null` on every frame of a
+/// copy. `raiseAsmCap` takes a plain number, as on the session.
+#[wasm_bindgen_test]
+fn an_asm_copy_crosses_the_boundary() {
+    let (_, session) = compile("let x = 40; x + 2");
+    let text = call(&session, "asmText", &[]).as_string().expect("asmText crosses as a string");
+    assert!(text.starts_with("result Nat\n"), "headed by the program's type: {text}");
+
+    let out = redextape_wasm::asm_scratch(&text).expect("asmScratch must not throw");
+    let diagnostics: Array = get(&out, "diagnostics").unchecked_into();
+    assert_eq!(diagnostics.length(), 0, "the program's own text has nothing to refuse");
+    let copy = get(&out, "scratch");
+    let json = |v: JsValue| JSON::stringify(&v).unwrap().as_string().unwrap();
+    for method in ["asmStatus", "asmProgram", "asmValue"] {
+        assert_eq!(json(call(&copy, method, &[])), json(call(&session, method, &[])), "{method}");
+    }
+    let window = asm_window(64, 16, 8, 16, 16);
+    let mut steps = 0;
+    loop {
+        let st = call(&copy, "asmState", std::slice::from_ref(&window));
+        assert!(get(&st, "source_node").is_null(), "a copy has no owners, and says so as null");
+        if call(&copy, "stepAsm", &[]) != JsValue::TRUE {
+            break;
+        }
+        steps += 1;
+        assert!(steps <= 100, "this program halts in 5 instructions");
+    }
+    assert_eq!(steps, 5);
+    call(&copy, "raiseAsmCap", &[JsValue::from_f64(1000.0)]);
+    let value = call(&copy, "asmValue", &[]);
+    assert_eq!(get(&get(&value, "Value"), "text").as_string().as_deref(), Some("42"), "got {value:?}");
+}
+
+/// Refused text crosses as diagnostics beside a `null` handle, as `tmScratch`'s does: here a jump to a label
+/// nothing defines, which parses and which `asm_label_diagnostics` refuses.
+#[wasm_bindgen_test]
+fn a_refused_asm_copy_crosses_as_diagnostics_and_a_null_handle() {
+    let out = redextape_wasm::asm_scratch("\tjmp\tnowhere\n").expect("asmScratch must not throw on bad input");
+    let diagnostics: Array = get(&out, "diagnostics").unchecked_into();
+    assert_eq!(diagnostics.length(), 1);
+    assert_eq!(get(&diagnostics.get(0), "message").as_string().as_deref(), Some("undefined label `nowhere`"));
+    assert_eq!(get(&out, "scratch"), JsValue::NULL, "no program, no handle — and `null`, not `undefined`");
+}
+
+/// A declined asm leg's `asmText` crosses as `null`, not `undefined` — `declined_tm_text_crosses_as_null_not
+/// _undefined`'s point, on the program `a_declined_asm_leg_reports_why_and_its_methods_throw` declines.
+#[wasm_bindgen_test]
+fn declined_asm_text_crosses_as_null_not_undefined() {
+    let src = format!("[{}]", (0..2048).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
+    let (_, session) = compile(&src);
+    assert_eq!(get(&call(&session, "asmStatus", &[]), "available"), JsValue::FALSE, "the premise");
+    let text = call(&session, "asmText", &[]);
+    assert!(text.is_null(), "a declined asm leg's asmText must cross as `null`, got {text:?}");
+}
````


- [ ] **Step 2: Run them and see them fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(copy) | test(asm) | test(step_0)'`

Expected: exit 101, printing:

```text
error[E0425]: cannot find type `AsmScratch` in this scope
error[E0599]: no method named `asm_text` found for struct `session::Session` in the current scope
error[E0425]: cannot find function `asm_scratch` in this scope
error[E0599]: no method named `asm_text` found for struct `session::Session` in the current scope
error[E0425]: cannot find function `asm_scratch` in this scope
error[E0599]: no method named `asm_text` found for struct `session::Session` in the current scope
error[E0425]: cannot find function `asm_scratch` in this scope
error[E0425]: cannot find function `asm_scratch` in this scope
error[E0599]: no method named `asm_text` found for struct `session::Session` in the current scope
error[E0425]: cannot find function `asm_scratch` in this scope
error[E0425]: cannot find function `asm_scratch` in this scope
error[E0599]: no method named `asm_text` found for struct `session::Session` in the current scope
error[E0425]: cannot find function `asm_scratch_with_caps` in this scope
error: could not compile `redextape-wasm` (lib test) due to 13 previous errors
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=2
diff --git a/README.md b/README.md
index dfc8a8c..2510ac0 100644
--- a/README.md
+++ b/README.md
@@ -14,8 +14,8 @@ computation — not a native run with a decorative overlay.
 
 **The compiler is built, and the thing you watch it run in now has three panes.** The front end
 and three backends — λ, Turing machine, and native — all work, and each is checked against the others
-on every commit. `crates/redextape-wasm` compiles the compiler to WASM through **nine exports** — the
-ninth, `tapeNames()`, labels the five Turing-machine tape rows from the lowering's own constants
+on every commit. `crates/redextape-wasm` compiles the compiler to WASM through **ten exports** — the
+tenth, `tapeNames()`, labels the five Turing-machine tape rows from the lowering's own constants
 (`build.rs`) rather than a hand-copied list, so it can only speak for machines this compiler produced.
 `web/` is a real app: a source pane with lint diagnostics and syntax highlighting driven by a committed
 tree-sitter grammar — the same colourer the λ and TM copy editors take, whose grammar loads
@@ -286,7 +286,7 @@ figures above read 841/716/48 until 2026-08-24, having drifted by 315 tests and
 from the breakdown entirely. Recount rather than trust them.
 
 **Two tiers sit outside that count**, because neither runs under `cargo nextest`. The wasm boundary
-has **30** browser tests (`wasm-pack test --headless --chrome crates/redextape-wasm`), run by CI's
+has **33** browser tests (`wasm-pack test --headless --chrome crates/redextape-wasm`), run by CI's
 `rust-browser` job. `web/` has **246** of its own across two Vitest projects — 187 in Node for the
 pure modules, 59 in real Chromium for the worker and the app end to end — run by CI's `web` job
 under the coverage gate. Recount with `pnpm test`.
diff --git a/crates/redextape-wasm/src/lib.rs b/crates/redextape-wasm/src/lib.rs
index 9153c7a..4238f5c 100644
--- a/crates/redextape-wasm/src/lib.rs
+++ b/crates/redextape-wasm/src/lib.rs
@@ -226,6 +226,41 @@ pub fn tm_scratch(src: &str) -> Result<JsValue, JsValue> {
     Ok(out.into())
 }
 
+/// An asm program typed or pasted into a copy, with no program behind it. Owns the listing, the cursor and
+/// the outcome of its own run.
+///
+/// **THE ASM LEG'S SIX METHODS, UNDER THE SESSION'S NAMES, AND NOTHING ELSE.** `asmStatus` answers the same
+/// `AsmStatus` a `Session` does — every field is true of a copy (`session::AsmScratch` says why). `sourceSpan`
+/// and `linkIndex` are absent, since a copy has no `SourceMap`; `tests/browser.rs` pins that at compile time.
+#[wasm_bindgen]
+pub struct AsmScratch(session::AsmScratch);
+
+/// `asmScratch(src)` -> `{ diagnostics: Diagnostic[], scratch: AsmScratch | null }`.
+///
+/// `scratch` is null for text that does not parse and for text with a label mistake, and the diagnostics
+/// say which — see `session::asm_scratch`. Assembled by hand for the reason `compile` and `lambdaScratch`
+/// give: a handle and plain data cross two different ways.
+///
+/// # Errors
+///
+/// Returns `Err` only if `to_value` cannot marshal the diagnostics, or if a `Reflect::set` on the freshly
+/// created object fails; neither is expected for this crate's own types. Text that is refused is NOT an
+/// error — it arrives as diagnostics beside a null `scratch`.
+#[wasm_bindgen(js_name = asmScratch)]
+pub fn asm_scratch(src: &str) -> Result<JsValue, JsValue> {
+    let made = session::asm_scratch(src);
+
+    let out = js_sys::Object::new();
+    let diagnostics = to_value(&made.diagnostics)?;
+    js_sys::Reflect::set(&out, &JsValue::from_str("diagnostics"), &diagnostics)?;
+    let handle = match made.scratch {
+        Some(s) => JsValue::from(AsmScratch(s)),
+        None => JsValue::NULL,
+    };
+    js_sys::Reflect::set(&out, &JsValue::from_str("scratch"), &handle)?;
+    Ok(out.into())
+}
+
 /// `analyze(src)` -> `Diagnostic[]`.
 ///
 /// THE LINT PATH, and the reason it is not `compile`: see `session::analyze`.
@@ -302,7 +337,7 @@ pub fn capture_classes() -> Result<JsValue, JsValue> {
     to_value(&tables)
 }
 
-/// The lowering's tape names, in tape order. The NINTH export.
+/// The lowering's tape names, in tape order. The TENTH export.
 ///
 /// EXPORTED RATHER THAN HARDCODED, for the reason `encodings()` gives one export up: a TypeScript
 /// array of names is a second authoritative registry that not even the compiler is watching. Five
@@ -631,6 +666,18 @@ impl Session {
         to_value(&self.0.asm_value().map_err(err)?)
     }
 
+    /// `asmText()` -> `string | null`. The asm program as `.asm` text, for a copy to seed an `AsmScratch` from;
+    /// `null` for a declined leg. `JsValue` rather than `Option<String>` for `tmText`'s reason: a bare `None`
+    /// would cross as `undefined`.
+    #[wasm_bindgen(js_name = asmText)]
+    #[must_use]
+    pub fn asm_text(&self) -> JsValue {
+        match self.0.asm_text() {
+            Some(s) => JsValue::from_str(&s),
+            None => JsValue::NULL,
+        }
+    }
+
     // --- the reference leg --------------------------------------------------------------------
 
     /// BLOCKS THE MAIN THREAD FOR UP TO 5,000,000 INTERPRETER STEPS, and cannot be chunked — see
@@ -924,6 +971,61 @@ impl TmScratch {
     }
 }
 
+/// The asm leg's methods on a copy. Four drop the `Result` `Session`'s carry, for the reason `TmScratch`'s
+/// impl records: `SessionError::AsmAbsent` is unreachable on a type that holds a leg rather than a `Result`.
+#[wasm_bindgen]
+impl AsmScratch {
+    /// # Errors
+    ///
+    /// Returns `Err` only if `to_value` cannot marshal the status; not expected for this crate's own types.
+    #[wasm_bindgen(js_name = asmStatus)]
+    pub fn asm_status(&self) -> Result<JsValue, JsValue> {
+        to_value(&self.0.asm_status())
+    }
+
+    /// # Errors
+    ///
+    /// Returns `Err` only if `to_value` cannot marshal the listing; not expected for this crate's own types.
+    #[wasm_bindgen(js_name = asmProgram)]
+    pub fn asm_program(&self) -> Result<JsValue, JsValue> {
+        to_value(&self.0.asm_program())
+    }
+
+    /// `false` once the run has halted, faulted or been capped — `asmStatus().run` and `.cap` say which.
+    #[wasm_bindgen(js_name = stepAsm)]
+    #[must_use]
+    pub fn step_asm(&mut self) -> bool {
+        self.0.step_asm()
+    }
+
+    /// `source_node` is always `null`: a copy has no lowering to have recorded an owner. `window` is read as
+    /// `Session::asmState` reads it.
+    ///
+    /// # Errors
+    ///
+    /// Returns `Err` when `window` is not an `AsmWindow`, with the deserializer's message.
+    #[wasm_bindgen(js_name = asmState)]
+    pub fn asm_state(&self, window: JsValue) -> Result<JsValue, JsValue> {
+        let window: redextape_core::viewmodel::AsmWindow = serde_wasm_bindgen::from_value(window)
+            .map_err(|e| JsValue::from_str(&format!("asmState: not an AsmWindow: {e}")))?;
+        to_value(&self.0.asm_state(window))
+    }
+
+    /// `u32` and widened, for the reason `Session::raiseLambdaCap` records.
+    #[wasm_bindgen(js_name = raiseAsmCap)]
+    pub fn raise_asm_cap(&mut self, extra_steps: u32) {
+        self.0.raise_asm_cap(u64::from(extra_steps));
+    }
+
+    /// # Errors
+    ///
+    /// Returns `Err` only if `to_value` cannot marshal the `Decoded`; not expected for this crate's own types.
+    #[wasm_bindgen(js_name = asmValue)]
+    pub fn asm_value(&self) -> Result<JsValue, JsValue> {
+        to_value(&self.0.asm_value())
+    }
+}
+
 #[cfg(test)]
 mod tests {
     /// The boundary hands over every language and every row, and adds nothing.
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index cc1905d..a027d69 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -557,18 +557,69 @@ enum AsmEnd {
 /// **THE WHOLE RUN HAPPENS HERE, ONCE** (spec amendment 13): the step total and the value both come from it,
 /// and a program that never halts spends the whole step cap here, before `compile` returns.
 fn build_asm_leg(core: &Core, caps: tm::asm::Caps) -> Result<AsmLeg, tm::LowerError> {
-    let program = Rc::new(tm::lower_program(core)?);
-    let mut run = AsmCursor::new(Rc::clone(&program), caps);
-    for _ in run.by_ref() {}
-    let total_steps = run.steps_taken();
-    let end = match run.status().cloned() {
-        Some(trace::AsmStatus::Halted) => AsmEnd::Halted(run.into_outcome()),
-        Some(trace::AsmStatus::Faulted(why)) => AsmEnd::Faulted { pc: run.pc(), why },
-        // `None` cannot be reached: a cursor stops only by latching a status. It answers as a cap, as
-        // `run_asm` does for the same arm, rather than panicking, since a panic under wasm aborts the module.
-        Some(trace::AsmStatus::Capped(_)) | None => AsmEnd::Capped,
-    };
-    Ok(AsmLeg { program: AsmProgram::of(&program), cursor: AsmCursor::new(program, caps), total_steps, end })
+    Ok(AsmLeg::run(Rc::new(tm::lower_program(core)?), caps))
+}
+
+/// The asm leg's six answers, **ONE IMPLEMENTATION FOR THE PROGRAM'S LEG AND A COPY'S.** `Session` and
+/// `AsmScratch` each hold an `AsmLeg` and forward to these; the two differ only in what they hand in — the
+/// session its `SourceMap` and the program's type, a copy no map and its header's type, if it has one.
+impl AsmLeg {
+    /// Run `program` to its end under `caps`, then open the cursor a view records: `build_asm_leg`'s whole
+    /// run, for a program from a lowering or from text alike.
+    fn run(program: Rc<Program>, caps: tm::asm::Caps) -> AsmLeg {
+        let mut run = AsmCursor::new(Rc::clone(&program), caps);
+        for _ in run.by_ref() {}
+        let total_steps = run.steps_taken();
+        let end = match run.status().cloned() {
+            Some(trace::AsmStatus::Halted) => AsmEnd::Halted(run.into_outcome()),
+            Some(trace::AsmStatus::Faulted(why)) => AsmEnd::Faulted { pc: run.pc(), why },
+            // `None` cannot be reached: a cursor stops only by latching a status. It answers as a cap, as
+            // `run_asm` does for the same arm, rather than panicking, since a panic under wasm aborts the module.
+            Some(trace::AsmStatus::Capped(_)) | None => AsmEnd::Capped,
+        };
+        AsmLeg { program: AsmProgram::of(&program), cursor: AsmCursor::new(program, caps), total_steps, end }
+    }
+
+    /// `Session::asm_status` for a leg that is there.
+    fn status(&self) -> AsmStatus {
+        let (run, cap) = match self.cursor.status() {
+            None => (RunStatus::Running, None),
+            Some(trace::AsmStatus::Halted | trace::AsmStatus::Faulted(_)) => (RunStatus::Ended, None),
+            Some(trace::AsmStatus::Capped(cap)) => (RunStatus::Capped, Some(*cap)),
+        };
+        AsmStatus { available: true, reason: String::new(), run: Some(run), cap, total_steps: Some(self.total_steps) }
+    }
+
+    /// Advance one instruction; `false` once the run has halted, faulted or been capped.
+    fn step(&mut self) -> bool {
+        self.cursor.next().is_some()
+    }
+
+    /// The cursor's machine cut to `window`; `map` resolves `source_node`, and a copy has none.
+    fn state(&self, map: Option<&SourceMap>, window: AsmWindow) -> AsmState {
+        AsmState::window(&self.cursor, map, window)
+    }
+
+    /// The run's answer: `rr` decoded by `ty` from the leg's own run, or from the cursor once a raised cap has
+    /// carried it further — `Session::asm_value` says why in that order. With no `ty`, the raw word, marked:
+    /// a copy with no `result` header has nothing to decode against.
+    fn value(&self, ty: Option<&redextape_core::ty::Ty>) -> Decoded {
+        let decode = |outcome: &AsmOutcome| match ty {
+            Some(ty) => decoded_or_undecodable(tm::decode_asm_ty(outcome, ty)),
+            None => Decoded::Value { text: format!("{} (no result type)", outcome.result) },
+        };
+        match &self.end {
+            AsmEnd::Halted(outcome) => decode(outcome),
+            AsmEnd::Faulted { pc, why } => asm_fault(*pc, why),
+            AsmEnd::Capped => match self.cursor.status() {
+                Some(trace::AsmStatus::Halted) => {
+                    decode(&AsmOutcome { result: self.cursor.rr(), heap: self.cursor.heap().to_vec() })
+                }
+                Some(trace::AsmStatus::Faulted(why)) => asm_fault(self.cursor.pc(), why),
+                None | Some(trace::AsmStatus::Capped(_)) => Decoded::Unfinished,
+            },
+        }
+    }
 }
 
 /// What `asm_status().reason` says for each way `tm::lower_program` refuses a program. One arm per variant,
@@ -1128,20 +1179,7 @@ impl Session {
     /// and `cap` are read off the CURSOR, and `total_steps` off `compile`'s run, the split `tm_status` makes.
     pub fn asm_status(&self) -> AsmStatus {
         match &self.asm {
-            Ok(leg) => {
-                let (run, cap) = match leg.cursor.status() {
-                    None => (RunStatus::Running, None),
-                    Some(trace::AsmStatus::Halted | trace::AsmStatus::Faulted(_)) => (RunStatus::Ended, None),
-                    Some(trace::AsmStatus::Capped(cap)) => (RunStatus::Capped, Some(*cap)),
-                };
-                AsmStatus {
-                    available: true,
-                    reason: String::new(),
-                    run: Some(run),
-                    cap,
-                    total_steps: Some(leg.total_steps),
-                }
-            }
+            Ok(leg) => leg.status(),
             Err(e) => {
                 AsmStatus { available: false, reason: asm_decline_reason(e), run: None, cap: None, total_steps: None }
             }
@@ -1159,14 +1197,14 @@ impl Session {
     /// and `.cap` say which, and are the only thing that can.
     pub fn step_asm(&mut self) -> Result<bool, SessionError> {
         let leg = self.asm.as_mut().map_err(|_| SessionError::AsmAbsent)?;
-        Ok(leg.cursor.next().is_some())
+        Ok(leg.step())
     }
 
     /// The cursor's machine cut to `window` — `AsmState::window` and nothing else, with the session's map, so
     /// `source_node` resolves (`build_asm_leg` says why this map indexes this cursor's program).
     pub fn asm_state(&self, window: AsmWindow) -> Result<AsmState, SessionError> {
         let leg = self.asm.as_ref().map_err(|_| SessionError::AsmAbsent)?;
-        Ok(AsmState::window(&leg.cursor, Some(&self.map), window))
+        Ok(leg.state(Some(&self.map), window))
     }
 
     /// Extend the step budget, additively and saturating. It resumes a run the STEP cap stopped and nothing
@@ -1202,17 +1240,27 @@ impl Session {
     /// succeeded and a value too large for `decoded_value`'s capped print. See `Decoded`'s table.
     pub fn asm_value(&self) -> Result<Decoded, SessionError> {
         let leg = self.asm.as_ref().map_err(|_| SessionError::AsmAbsent)?;
-        Ok(match &leg.end {
-            AsmEnd::Halted(outcome) => decoded_or_undecodable(tm::decode_asm_ty(outcome, &self.ty)),
-            AsmEnd::Faulted { pc, why } => asm_fault(*pc, why),
-            AsmEnd::Capped => match leg.cursor.status() {
-                Some(trace::AsmStatus::Halted) => {
-                    let outcome = AsmOutcome { result: leg.cursor.rr(), heap: leg.cursor.heap().to_vec() };
-                    decoded_or_undecodable(tm::decode_asm_ty(&outcome, &self.ty))
-                }
-                Some(trace::AsmStatus::Faulted(why)) => asm_fault(leg.cursor.pc(), why),
-                None | Some(trace::AsmStatus::Capped(_)) => Decoded::Unfinished,
-            },
+        Ok(leg.value(Some(&self.ty)))
+    }
+
+    /// This session's asm program as `.asm` text, headed by the program's result type, or `None` for a
+    /// declined leg — what *edit a copy* seeds an `AsmScratch` from.
+    ///
+    /// **THE PROGRAM THE CURSOR RUNS, `defunc` INCLUDED**, printed by `print_asm_with`, and read back by
+    /// `asm_scratch` to the same program: `asm_roundtrip.rs`'s
+    /// `every_program_the_web_app_runs_prints_to_text_a_copy_runs` holds both halves, and that
+    /// `asm_label_diagnostics` finds nothing to refuse in it.
+    ///
+    /// **THE HEADER IS THE TYPE ONLY WHEN THE TYPE IS ONE A HEADER CAN NAME** — `Nat`, `Bool`, `Unit` or a
+    /// list of them, read back through `ty::parse_ty` as `redextape emit --lang asm` reads it. A function-typed
+    /// program prints with no header, and its copy's value is the raw word, marked, where the program's is
+    /// `Undecodable`: there was never a value of its type to decode.
+    pub fn asm_text(&self) -> Option<String> {
+        let leg = self.asm.as_ref().ok()?;
+        let program = leg.cursor.program();
+        Some(match redextape_core::ty::parse_ty(&redextape_core::ty::show(&self.ty)) {
+            Some(result) => tm::print_asm_with(program, &tm::AsmHeader { result }),
+            None => tm::print_asm(program),
         })
     }
 
@@ -1356,6 +1404,85 @@ pub fn lambda_scratch(src: &str) -> Scratched<LambdaScratch> {
     Scratched { diagnostics, scratch }
 }
 
+/// An asm program typed or pasted into a copy: **an `AsmLeg` and the type its header names, and nothing else.**
+///
+/// **THE PROGRAM'S LEG, NOT A COPY'S VARIANT OF IT.** `asm_scratch` runs the parsed program to its end and
+/// opens a fresh cursor exactly as `compile` does for a lowered one, so `asm_status`, `asm_program`,
+/// `step_asm`, `asm_state`, `raise_asm_cap` and `asm_value` are `AsmLeg`'s, and every field of `AsmStatus`
+/// is true of a copy — which is why this answers `AsmStatus` where `TmScratch` needs a status of its own.
+///
+/// **NO `SourceMap`, SO NO `sourceSpan` OR `linkIndex`** — `LambdaScratch`'s reason, and `asm_state`'s
+/// `source_node` is `null` on every frame. A copy links to nothing.
+///
+/// **A HEADER'S TYPE, WHEN IT HAS ONE.** `.asm` text may carry `result <type>`, and a copy decodes its value
+/// by it; without one there is nothing to decode against, and `asm_value` is the raw `rr` word, marked as
+/// having no result type.
+pub struct AsmScratch {
+    leg: AsmLeg,
+    ty: Option<redextape_core::ty::Ty>,
+}
+
+/// Build an asm copy from `.asm` TEXT, or say why not.
+///
+/// **IT REFUSES WHAT `redextape run` REFUSES**: text that does not parse, and — through
+/// `asm_label_diagnostics` — a jump to a label nothing defines, a label defined twice, or a label name the
+/// printer cannot write back. The parser accepts those three and `Program::validate` refuses them; a copy's
+/// editor marks them, from the same function, so a refusal always has its reason on screen. `validate`'s one
+/// other check a text can fail, a register at or over `MAX_REGISTERS`, is not refused: it has no name to
+/// mark, and the cursor faults on it at step 0, which the view shows as the run's end.
+///
+/// **THE WHOLE RUN HAPPENS HERE, ONCE**, as in `compile` (spec amendment 26): the step total and the value
+/// come with the build.
+pub fn asm_scratch(src: &str) -> Scratched<AsmScratch> {
+    asm_scratch_with_caps(src, tm::DEFAULT_CAPS)
+}
+
+/// `asm_scratch` under `caps`, so a test can reach a cap without millions of steps.
+fn asm_scratch_with_caps(src: &str, caps: tm::asm::Caps) -> Scratched<AsmScratch> {
+    let (doc, nav) = tm::parse_asm_nav(src);
+    let mut diagnostics = doc.diagnostics;
+    diagnostics.extend(tm::asm_label_diagnostics(&nav));
+    let scratch = match doc.program {
+        Some(program) if diagnostics.is_empty() => {
+            Some(AsmScratch { leg: AsmLeg::run(Rc::new(program), caps), ty: doc.header.map(|h| h.result) })
+        }
+        _ => None,
+    };
+    Scratched { diagnostics, scratch }
+}
+
+impl AsmScratch {
+    /// See `Session::asm_status`; always `available`.
+    pub fn asm_status(&self) -> AsmStatus {
+        self.leg.status()
+    }
+
+    /// The listing and labels, projected once when the copy was built.
+    pub fn asm_program(&self) -> AsmProgram {
+        self.leg.program.clone()
+    }
+
+    /// See `Session::step_asm`.
+    pub fn step_asm(&mut self) -> bool {
+        self.leg.step()
+    }
+
+    /// The cursor's machine cut to `window`, with no map: `source_node` is `None` on every frame.
+    pub fn asm_state(&self, window: AsmWindow) -> AsmState {
+        self.leg.state(None, window)
+    }
+
+    /// See `Session::raise_asm_cap`.
+    pub fn raise_asm_cap(&mut self, extra_steps: u64) {
+        self.leg.cursor.raise_cap(extra_steps);
+    }
+
+    /// See `Session::asm_value`, decoded by the header's type; with no header, the raw word, marked.
+    pub fn asm_value(&self) -> Decoded {
+        self.leg.value(self.ty.as_ref())
+    }
+}
+
 /// A λ scratchpad forked from step `step` of `src`, **and the text that built it**.
 ///
 /// A THIRD FIELD RATHER THAN `Scratched<LambdaScratch>`, because the caller needs the string. Design
diff --git a/scripts/check-doc-figures.sh b/scripts/check-doc-figures.sh
index e6cb02a..e5dee4c 100755
--- a/scripts/check-doc-figures.sh
+++ b/scripts/check-doc-figures.sh
@@ -101,8 +101,8 @@
 #      breakdown before anyone noticed. A gate that cannot be cheap should not exist; a claim that
 #      cannot be gated should not be written in the present tense.
 # **ONE ROW'S DOCUMENT IS A SOURCE FILE, NOT A README, AND THAT IS A DELIBERATE WIDENING.**
-# `crates/redextape-wasm/src/lib.rs` calls `tapeNames()` "The NINTH export" in a doc comment, and
-# `README.md` states the same fact twice more — "nine exports" and "the ninth, `tapeNames()`". An
+# `crates/redextape-wasm/src/lib.rs` calls `tapeNames()` "The TENTH export" in a doc comment, and
+# `README.md` states the same fact twice more — "ten exports" and "the tenth, `tapeNames()`". An
 # ORDINAL that moves whenever any export is added, with no gate behind it, is the exact shape this
 # repository keeps retracting; `.pre-commit-config.yaml`'s hook comments and the `linear-history` CI
 # header each carry their own retraction of one. All three went false inside a single branch when Plan
@@ -116,7 +116,7 @@
 # deleting one export and appending another leaves the COUNT unchanged while moving the position, and a
 # single count-shaped derivation would report green through exactly that edit.
 #
-# **BOTH RETURN 9 AGAINST THE REAL TREE TODAY, SO THE REAL TREE CANNOT TELL THE TWO DERIVATIONS APART**
+# **BOTH RETURN 10 AGAINST THE REAL TREE TODAY, SO THE REAL TREE CANNOT TELL THE TWO DERIVATIONS APART**
 # — a position-shaped implementation that quietly became a count would still pass every check that
 # only ever runs against `wasm_export_names()`'s real output, because `tapeNames` happens to be last.
 # `--self-test` closes that hole with a SYNTHETIC export list carrying a name AFTER `tapeNames`, so the
@@ -286,7 +286,7 @@ derive_cmd() {
 # comparison loudly rather than silently reading as zero.
 #
 # **ORDINALS ARE HERE FOR THE `tapeNames()` ROWS, AND THEY READ AS THE POSITION THEY NAME.** Two
-# documents call that export "the ninth" and one of them capitalises it; there is no sentence in this
+# documents call that export "the tenth" and one of them capitalises it; there is no sentence in this
 # tree where an ordinal word means anything but its own number, so they share the table rather than
 # getting a second one. The row that uses them derives a POSITION — see this file's header.
 to_number() {
````


- [ ] **Step 4: Run them and see them pass.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast`

Expected: exit 0, printing:

```text
Summary: 112 tests run: 112 passed, 0 skipped
```

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env PATH=/usr/sbin:$PATH scripts/check-all.sh --browser-only`

Expected: exit 0, printing:

```text
test result: ok. 33 passed; 0 failed; 0 ignored; 0 filtered out
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 10 of 10 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | a copy runs text with a label mistake — `session.rs`: `diagnostics.extend(tm::asm_label_diagnostics(&nav)); ⏎     let scratch = match doc.program {` → `let _ = &nav; ⏎     let scratch = match doc.program {` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(copy) | test(asm) | test(step_0)'` | `redextape-wasm session::tests::a_copy_refuses_a_parse_error_and_a_label_mistake` |
| 2 | a refusal still builds a copy — `session.rs`: `Some(program) if diagnostics.is_empty() => {` → `Some(program) => {` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(copy) | test(asm) | test(step_0)'` | `redextape-wasm session::tests::a_copy_refuses_a_parse_error_and_a_label_mistake` |
| 3 | a headerless value is not marked — `session.rs`: `None => Decoded::Value { text: format!("{} (no result type)", outcome.result) },` → `None => Decoded::Value { text: format!("{}", outcome.result) },` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(copy) | test(asm) | test(step_0)'` | `redextape-wasm session::tests::a_copy_decodes_by_its_header_and_marks_a_raw_word_without_one` |
| 4 | a copy ignores its header — `session.rs`: `ty: doc.header.map(|h| h.result) })` → `ty: doc.header.and(None) })` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(copy) | test(asm) | test(step_0)'` | `redextape-wasm session::tests::a_capped_copy_resumes_to_its_value`, `redextape-wasm session::tests::a_copy_of_the_programs_text_runs_as_the_program_does`, `redextape-wasm session::tests::a_copy_decodes_by_its_header_and_marks_a_raw_word_without_one` |
| 5 | the text has no header — `session.rs`: `Some(result) => tm::print_asm_with(program, &tm::AsmHeader { result }),` → `Some(_) => tm::print_asm(program),` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(copy) | test(asm) | test(step_0)'` | `redextape-wasm session::tests::a_capped_copy_resumes_to_its_value`, `redextape-wasm session::tests::a_copy_of_the_programs_text_runs_as_the_program_does`, `redextape-wasm session::tests::a_copy_decodes_by_its_header_and_marks_a_raw_word_without_one` |
| 6 | the cursor fallback decodes with no type — `session.rs`: `decode(&AsmOutcome { result: self.cursor.rr(), heap: self.cursor.heap().to_vec() })` → `Decoded::Value { text: self.cursor.rr().to_string() }` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(copy) | test(asm) | test(step_0)'` | `redextape-wasm session::tests::a_capped_copy_resumes_to_its_value`, `redextape-wasm session::tests::a_raised_step_cap_carries_the_asm_cursor_to_a_value` |
| 7 | a copy ignores the caps it is given — `session.rs`: `AsmLeg::run(Rc::new(program), caps), ty:` → `AsmLeg::run(Rc::new(program), tm::DEFAULT_CAPS), ty:` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(copy) | test(asm) | test(step_0)'` | `redextape-wasm session::tests::a_capped_copy_resumes_to_its_value` |
| 8 | raising a copy's cap does nothing — `session.rs`: `` self.leg.cursor.raise_cap(extra_steps); ⏎     } ⏎  ⏎     /// See `Session::asm_value`, decoded `` → `` let _ = extra_steps; ⏎     } ⏎  ⏎     /// See `Session::asm_value`, decoded `` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(copy) | test(asm) | test(step_0)'` | `redextape-wasm session::tests::a_capped_copy_resumes_to_its_value` |
| 9 | a declined asmText crosses as undefined — `lib.rs`: `match self.0.asm_text() { ⏎             Some(s) => JsValue::from_str(&s), ⏎             None => JsValue::NULL,` → `match self.0.asm_text() { ⏎             Some(s) => JsValue::from_str(&s), ⏎             None => JsValue::UNDEFINED,` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env PATH=/usr/sbin:$PATH scripts/check-all.sh --browser-only` | `browser declined_asm_text_crosses_as_null_not_undefined` |
| 10 | a refused copy crosses as undefined — `lib.rs`: `Some(s) => JsValue::from(AsmScratch(s)), ⏎         None => JsValue::NULL,` → `Some(s) => JsValue::from(AsmScratch(s)), ⏎         None => JsValue::UNDEFINED,` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 env PATH=/usr/sbin:$PATH scripts/check-all.sh --browser-only` | `browser a_refused_asm_copy_crosses_as_diagnostics_and_a_null_handle` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The wasm session prints its asm as text, and `asmScratch` runs text as a copy with the asm leg's own methods

`Session.asmText()` prints the program the asm cursor runs, `defunc`
included, headed by the program's type when a header can name it.
`asmScratch(src)` refuses what `redextape run` refuses — a parse
error, or a label mistake `asm_label_diagnostics` marks — and runs
the rest to its end as `compile` does, so its status carries the
step total and its value comes with the build. The six asm methods
move onto `AsmLeg`, which the session and a copy both hold; a copy
passes no map, so `source_node` is null, and decodes by its header's
type, or marks the raw word when it has none. A register over the
cap and an empty program fault at step 0.
````


---

### Task 3: A copy can be made on the asm leg: the worker builds and records it, and its build carries its value

**Files:**
- Modify: `web/src/protocol.ts` (the `asm-scratch` request, the `asm-scratch-compiled` and `asm-value` replies, `compiled.asmText`), `web/src/session-client.ts` (`asmScratch`), `web/src/session-worker.ts` (`onAsmScratch`, the `asm-scratch` kind, the asm leg's recording and `[continue]` for a copy)
- Modify: `web/src/legs.ts` (`CopyLeg` is deleted), `web/src/scratch.ts` (the asm arms; `noSessionReply` reads the copy's own leg), `web/src/sessions.ts` (`AsmCompiled`, `AsmScratchReading`, the entry's `asmScratch`), `web/src/replies.ts` (the copy's three replies, and `compiled`'s text), `web/src/buffers-store.ts` (the leg check, read off `LEGS`), `web/src/buffer-list.ts`, `web/src/main.ts`, `web/src/pane-host.ts`, `web/src/draw.ts`
- Test: `web/tests/node/scratch.test.ts`, `web/tests/node/replies.test.ts`, `web/tests/node/buffers-store.test.ts`, `web/tests/node/session-client.test.ts`, `web/tests/browser/worker.test.ts`; and the fixtures every `SessionEntry` and `compiled` literal in `web/tests/` builds, which gain `asmScratch: null` and `asmText: null`

**Interfaces:**
- Consumes Task 2's `asmScratch` and `Session.asmText`.
- Produces `RunRequest` `{ kind: 'asm-scratch'; gen; src }`; `RunReply` `{ kind: 'asm-scratch-compiled'; gen; asm: AsmStatus; asmProgram: AsmProgram; value: Decoded }` and `{ kind: 'asm-value'; gen; value: Decoded }`; `compiled.asmText: string | null`; `SessionClient.asmScratch(gen, src)`.
- Produces `sessions.ts`'s `AsmCompiled = { program: AsmProgram; asmText: string | null }` — the entry's `asmProgram` is one now — and `AsmScratchReading = { status: AsmStatus; value: Decoded }`, the entry's `asmScratch`. `pane-host.ts`'s `asmProgramOf` answers an `AsmCompiled`.

**A COPY'S LEG IS ANY `Leg`** (amendment 20's widening): `CopyLeg` goes, and `tsc` names every switch over a copy's leg — `#spawn`, `#pendingLegs`, `recompile` and `copyTerm` — each of which gains an asm arm. `buffers-store.ts`'s leg check was two literals `tsc` could not see; it reads `LEGS` now, and a v2 store holding an asm copy is valid (amendment 23).

**THE WORKER BUILDS AN ASM COPY AS IT BUILDS A TM COPY**: the same prologue, `asmScratch`, `no-session` for refused text, and a live kind of its own, `asm-scratch`, which the asm leg's recording admits and the λ and TM legs' refuse. The build reply carries the value (amendment 26); a `[continue]` on a copy, which gets no `result`, posts `asm-value` after recording. `compiled` carries the program's text beside its listing, for Task 4's *edit a copy*.

**A FAILED BUILD IS JUDGED BY THE COPY'S OWN LEG** (amendment 27). `noSessionReply` read `legs.lambda` for every copy, so every unparseable edit to a TM copy that had built was reported as a failed build; it reads `legs[state.leg]`, and the TM copy's case is tested beside the asm one.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=3
diff --git a/web/tests/browser/editor-custody.test.ts b/web/tests/browser/editor-custody.test.ts
index c63048e..35d13b9 100644
--- a/web/tests/browser/editor-custody.test.ts
+++ b/web/tests/browser/editor-custody.test.ts
@@ -70,6 +70,7 @@ function lambdaSession(id: SessionId): SessionEntry {
     tmProgram: null,
     tmScratch: null,
     asmProgram: null,
+    asmScratch: null,
   }
 }
 
diff --git a/web/tests/browser/scratch-fork.test.ts b/web/tests/browser/scratch-fork.test.ts
index a0cd458..81c3aec 100644
--- a/web/tests/browser/scratch-fork.test.ts
+++ b/web/tests/browser/scratch-fork.test.ts
@@ -134,6 +134,7 @@ function sourceSession(pool: SessionPool, seen: RunReply[]): SessionEntry {
     tmProgram: null,
     tmScratch: null,
     asmProgram: null,
+    asmScratch: null,
   }
 }
 
diff --git a/web/tests/browser/view-title.test.ts b/web/tests/browser/view-title.test.ts
index 1d25a4c..f0af0b0 100644
--- a/web/tests/browser/view-title.test.ts
+++ b/web/tests/browser/view-title.test.ts
@@ -63,6 +63,7 @@ function lambdaSession(id: SessionId, label: string, text: string, detached: boo
     tmProgram: null,
     tmScratch: null,
     asmProgram: null,
+    asmScratch: null,
   }
 }
 
@@ -92,6 +93,7 @@ function bothLegs(id: SessionId, label: string, text: string): SessionEntry {
     tmProgram: null,
     tmScratch: null,
     asmProgram: null,
+    asmScratch: null,
   }
 }
 
diff --git a/web/tests/browser/worker.test.ts b/web/tests/browser/worker.test.ts
index 9b06581..eef98cf 100644
--- a/web/tests/browser/worker.test.ts
+++ b/web/tests/browser/worker.test.ts
@@ -259,3 +259,90 @@ describe('session-worker recording', () => {
     expect(replies.some((r) => r.kind === 'result')).toBe(true)
   })
 })
+
+/**
+ * Post `req` to a fresh worker and collect every reply until `last` says the answer is complete. `askAll` stops at a
+ * `result`, which a copy never gets; a copy's last reply is its frames' end.
+ */
+function askUntil(req: RunRequest, last: (r: RunReply) => boolean): Promise<{ replies: RunReply[]; worker: Worker }> {
+  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
+  return new Promise((resolve, reject) => {
+    const replies: RunReply[] = []
+    const timer = setTimeout(() => {
+      worker.terminate()
+      reject(new Error(`the worker did not finish in time; got ${replies.map((r) => r.kind).join(', ')}`))
+    }, 30_000)
+    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
+      replies.push(e.data)
+      if (last(e.data) || e.data.kind === 'worker-error') {
+        clearTimeout(timer)
+        resolve({ replies, worker })
+      }
+    })
+    worker.postMessage(req)
+  })
+}
+
+const recorded = (r: RunReply): boolean => (r.kind === 'asm-frames' && r.done !== null) || r.kind === 'no-session'
+
+describe('session-worker asm copies', () => {
+  const FORTY_TWO = 'result Nat\n\n    li\trr, #42\n    halt\n'
+
+  it('sends the program’s asm as text on compiled, headed by its type, and null with no asm leg', async () => {
+    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
+    worker.terminate()
+    const compiled = replies.find((r) => r.kind === 'compiled')
+    expect(compiled?.kind === 'compiled' && compiled.asmText).toBe(
+      'result Nat\n\n    li\tr0, #40\n    mov\tr1, r0\n    li\tr2, #2\n    add\trr, r1, r2\n    halt\n',
+    )
+
+    const list = `[${Array.from({ length: 2048 }, (_, i) => i).join(', ')}]`
+    const declined = await askAll(run(list))
+    declined.worker.terminate()
+    const second = declined.replies.find((r) => r.kind === 'compiled')
+    expect(second?.kind === 'compiled' && [second.asm.available, second.asmText]).toEqual([false, null])
+  })
+
+  it('builds an asm copy, answers with its status, listing and value, then records its frames', async () => {
+    const { replies, worker } = await askUntil({ kind: 'asm-scratch', gen: 1, src: FORTY_TWO }, recorded)
+    worker.terminate()
+    const [built, ...rest] = replies
+    expect(built?.kind).toBe('asm-scratch-compiled')
+    if (built?.kind !== 'asm-scratch-compiled') return
+    expect(built.asm).toEqual({ available: true, reason: '', run: 'Running', cap: null, total_steps: 2 })
+    expect(built.asmProgram).toEqual({ listing: ['li\trr, #42', 'halt'], labels: [] })
+    expect(built.value).toEqual({ Value: { text: '42' } })
+    const frames = rest.flatMap((r) => (r.kind === 'asm-frames' ? r.frames : []))
+    expect(frames.map((f) => [f.step, f.source_node])).toEqual([
+      [0, null],
+      [1, null],
+      [2, null],
+    ])
+    expect(rest.at(-1)).toMatchObject({ kind: 'asm-frames', done: 'ended' })
+  })
+
+  it('refuses text with a label mistake, and names it', async () => {
+    const { replies, worker } = await askUntil({ kind: 'asm-scratch', gen: 1, src: '\tjmp\tnowhere\n' }, recorded)
+    worker.terminate()
+    expect(replies.map((r) => r.kind)).toEqual(['no-session'])
+    expect(replies[0]?.kind === 'no-session' && replies[0].diagnostics.map((d) => d.message)).toEqual([
+      'undefined label `nowhere`',
+    ])
+  })
+
+  it('answers extend on an asm copy with its frames and its value, where a session gets a result', async () => {
+    const { worker } = await askUntil({ kind: 'asm-scratch', gen: 1, src: FORTY_TWO }, recorded)
+    const replies: RunReply[] = []
+    const done = new Promise<void>((resolve) => {
+      worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
+        replies.push(e.data)
+        if (e.data.kind === 'asm-value') resolve()
+      })
+    })
+    worker.postMessage({ kind: 'extend', gen: 1, leg: 'asm' })
+    await done
+    worker.terminate()
+    expect(replies.map((r) => r.kind)).toEqual(['asm-frames', 'asm-value'])
+    expect(replies.at(-1)).toEqual({ kind: 'asm-value', gen: 1, value: { Value: { text: '42' } } })
+  })
+})
diff --git a/web/tests/node/buffers-store.test.ts b/web/tests/node/buffers-store.test.ts
index a3dc5ee..e51497c 100644
--- a/web/tests/node/buffers-store.test.ts
+++ b/web/tests/node/buffers-store.test.ts
@@ -73,7 +73,7 @@ describe('parseBuffers', () => {
     expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], collapsed: 'yes' }] }))).toBeNull()
   })
 
-  it('answers null for a leg that is neither lambda nor tm', () => {
+  it('answers null for a leg that is not a leg', () => {
     expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], leg: 'source' }] }))).toBeNull()
   })
 
@@ -82,6 +82,13 @@ describe('parseBuffers', () => {
     expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], leg: 'tm' }] }))?.buffers[0]?.leg).toBe('tm')
   })
 
+  // AN ASM COPY IS STORED AT VERSION 2 (Plan 7 part 5 spec, amendment 23): the version did not move, so a store written
+  // before asm copies existed and one holding one read under the same version.
+  it('accepts an asm buffer, at the version it always was', () => {
+    expect(BUFFERS_VERSION).toBe(2)
+    expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], leg: 'asm' }] }))?.buffers[0]?.leg).toBe('asm')
+  })
+
   it('answers null for a binding naming no buffer in the same payload', () => {
     expect(parseBuffers(raw({ bindings: { 'lambda-0': 'scratch-7' } }))).toBeNull()
   })
diff --git a/web/tests/node/replies.test.ts b/web/tests/node/replies.test.ts
index 43e3855..a06fc9c 100644
--- a/web/tests/node/replies.test.ts
+++ b/web/tests/node/replies.test.ts
@@ -11,7 +11,17 @@ import type { ClientPort, PoolPort, SessionId } from '../../src/session-client'
 import { SessionClient, SessionPool } from '../../src/session-client'
 import type { LegState, SessionEntry } from '../../src/sessions'
 import { PaneSlot, SessionRegistry } from '../../src/sessions'
-import type { Diagnostic, LambdaState, TmProgram, TmScratchStatus, TmState } from '../../src/types'
+import type {
+  AsmProgram,
+  AsmStatus,
+  Decoded,
+  Diagnostic,
+  LambdaState,
+  TmProgram,
+  TmScratchStatus,
+  TmState,
+} from '../../src/types'
+import { frameOf } from './asm-fixtures'
 
 /**
  * **WHAT A SESSION KEEPS FROM ITS OWN `compiled` REPLY** — the retention a TM pane created later is
@@ -83,6 +93,7 @@ function sourceEntry(): SessionEntry {
     tmProgram: null,
     tmScratch: null,
     asmProgram: null,
+    asmScratch: null,
   }
 }
 
@@ -109,6 +120,7 @@ const compiled = (tmProgram: TmProgram | null, tapeNames: string[]): RunReply =>
   tapeNames,
   linkIndex: null,
   tmText: null,
+  asmText: null,
 })
 
 /** The switch under test, over a registry holding `entry`, with no pane in the collection. */
@@ -613,3 +625,74 @@ describe('a TM buffer retains what its panes were last told', () => {
     })
   })
 })
+
+/**
+ * An asm copy retains what its views were last told, as a TM copy does: its listing, its status and its value, all from
+ * the one build reply (Plan 7 part 5 spec, amendment 26), the value replaced by an `asm-value`, the frames recorded
+ * into its asm leg, and all of it written to storage with the build.
+ */
+describe('an asm copy retains what its views were last told', () => {
+  const STATUS: AsmStatus = { available: true, reason: '', run: 'Running', cap: null, total_steps: 1 }
+  const LISTING: AsmProgram = { listing: ['halt'], labels: [] }
+  const built = (value: Decoded): RunReply => ({
+    kind: 'asm-scratch-compiled',
+    gen: 1,
+    asm: STATUS,
+    asmProgram: LISTING,
+    value,
+  })
+
+  it('holds the listing, the status and the value its build reply carried, and persists the copy', () => {
+    const { buffers, reg, replies, persists } = scratchDriver()
+    const id = buffers.forkBlank('asm')
+    replies.onScratchReply(id, built({ Value: { text: '0 (no result type)' } }))
+    const entry = reg.entryOf(id)
+    expect(entry.asmProgram).toEqual({ program: LISTING, asmText: null })
+    expect(entry.asmScratch).toEqual({ status: STATUS, value: { Value: { text: '0 (no result type)' } } })
+    expect(entry.legs.asm?.status).toEqual({ available: true, reason: '' })
+    expect(persists()).toBe(1)
+  })
+
+  it('records its frames into its asm leg', () => {
+    const { buffers, reg, replies } = scratchDriver()
+    const id = buffers.forkBlank('asm')
+    replies.onScratchReply(id, built('Unfinished'))
+    replies.onScratchReply(id, { kind: 'asm-frames', gen: 1, frames: [frameOf(), frameOf({ step: 1 })], done: 'ended' })
+    const leg = reg.legOf({ session: id, leg: 'asm' })
+    expect(leg.hist.current?.step).toBe(1)
+    expect(leg.done).toBe('ended')
+  })
+
+  it('takes the value a [continue] brings in place of the build’s', () => {
+    const { buffers, reg, replies } = scratchDriver()
+    const id = buffers.forkBlank('asm')
+    replies.onScratchReply(id, built('Unfinished'))
+    replies.onScratchReply(id, { kind: 'asm-value', gen: 1, value: { Value: { text: '[1, 2, 3]' } } })
+    expect(reg.entryOf(id).asmScratch).toEqual({ status: STATUS, value: { Value: { text: '[1, 2, 3]' } } })
+  })
+
+  it('forgets its reading when its worker throws', () => {
+    const { buffers, reg, replies } = scratchDriver()
+    const id = buffers.forkBlank('asm')
+    replies.onScratchReply(id, built('Unfinished'))
+    replies.onScratchReply(id, { kind: 'worker-error', gen: 1, message: 'boom' })
+    expect(reg.entryOf(id).asmScratch).toBeNull()
+  })
+})
+
+/** The program's asm text rides `compiled` beside its listing, for *edit a copy* — `tmText`'s arrangement. */
+describe('a session retains its asm text beside its listing', () => {
+  const LISTING: AsmProgram = { listing: ['li\trr, #1', 'halt'], labels: [] }
+
+  it('holds the text a `compiled` reply carried, and nothing when it carried no listing', () => {
+    const entry = sourceEntry()
+    const { replies } = driver(entry)
+    const asm: AsmStatus = { available: true, reason: '', run: 'Running', cap: null, total_steps: 2 }
+    const text = 'result Nat\n\n    li\trr, #1\n    halt\n'
+    replies.onReply(SOURCE, { ...compiled(PROGRAM, ['TAPE']), asm, asmProgram: LISTING, asmText: text } as RunReply)
+    expect(entry.asmProgram).toEqual({ program: LISTING, asmText: text })
+
+    replies.onReply(SOURCE, compiled(PROGRAM, ['TAPE']))
+    expect(entry.asmProgram).toBeNull()
+  })
+})
diff --git a/web/tests/node/scratch.test.ts b/web/tests/node/scratch.test.ts
index 84dac98..c6b5d98 100644
--- a/web/tests/node/scratch.test.ts
+++ b/web/tests/node/scratch.test.ts
@@ -6,7 +6,8 @@ import type { ClientPort, PoolPort, SessionId } from '../../src/session-client'
 import { SessionClient, SessionPool } from '../../src/session-client'
 import type { LegState, SessionEntry } from '../../src/sessions'
 import { PaneSlot, SessionRegistry } from '../../src/sessions'
-import type { LambdaState } from '../../src/types'
+import type { LambdaState, TmState } from '../../src/types'
+import { frameOf } from './asm-fixtures'
 
 /**
  * **A FORK MINTS A BUFFER** — 5d-ii-c design decision 1, at the level where the rule is decided rather
@@ -158,6 +159,7 @@ function sourceEntry(text = 'from source'): SessionEntry {
     tmProgram: null,
     tmScratch: null,
     asmProgram: null,
+    asmScratch: null,
   }
 }
 
@@ -825,6 +827,45 @@ describe('ScratchBuffers.noSessionReply', () => {
   })
 })
 
+/**
+ * **A COPY'S FAILED BUILD IS JUDGED BY ITS OWN LEG** (Plan 7 part 5 spec, amendment 27). The discriminator — has this
+ * copy recorded a frame — used to read the λ leg for every copy, and a TM or asm copy has none: every unparseable edit to
+ * one that had built was answered as a failed build, which `replies.ts` says in a notice, where a λ copy's edit shows
+ * its diagnostics in the editor alone.
+ */
+describe('ScratchBuffers.noSessionReply, on the copy’s own leg', () => {
+  const tmFrame: TmState = {
+    state: 0,
+    step: 0,
+    heads: [0],
+    window_start: [0],
+    window: [['_']],
+    source_node: null,
+    rule: null,
+  }
+  const diagnostics = [{ span: { start: 0, end: 0 }, severity: 'Error' as const, message: 'unknown mnemonic `x`' }]
+
+  it('answers null for a TM copy that has built a frame, and the diagnostics for one that has not', () => {
+    const { reg, buffers } = harness()
+    const built = buffers.forkBlank('tm')
+    const never = buffers.forkBlank('tm')
+    reg.legOf({ session: built, leg: 'tm' }).hist.push(tmFrame, 1)
+
+    expect(buffers.noSessionReply(built, diagnostics)).toBe(null)
+    expect(buffers.noSessionReply(never, diagnostics)).toEqual(diagnostics)
+  })
+
+  it('answers null for an asm copy that has built a frame, and the diagnostics for one that has not', () => {
+    const { reg, buffers } = harness()
+    const built = buffers.forkBlank('asm')
+    const never = buffers.forkBlank('asm')
+    reg.legOf({ session: built, leg: 'asm' }).hist.push(frameOf(), 1)
+
+    expect(buffers.noSessionReply(built, diagnostics)).toBe(null)
+    expect(buffers.noSessionReply(never, diagnostics)).toEqual(diagnostics)
+  })
+})
+
 describe('ScratchBuffers.recompile', () => {
   /**
    * **5d-i §4.3's EDIT PATH, AND `recompile`'s OWN DOC IS THE CLAIM UNDER TEST: "IT IS `fork` WITH
@@ -1358,3 +1399,53 @@ describe('two legs, one collection', () => {
     expect(fresh.buffers.list()).toEqual([{ id, label: 'copy 1', warm: false, leg: 'tm' }])
   })
 })
+
+/** An asm copy is a copy on a third leg: the same collection, one seat, one id space, and its own request. */
+describe('asm copies', () => {
+  it('sends asm-scratch for an asm copy, whether forked or blank', () => {
+    const { buffers, slotOf, postedTo } = harness()
+    const forked = buffers.fork(slotOf(), 'result Nat\n\thalt\n', 0, 'asm')
+    const blank = buffers.forkBlank('asm')
+    expect(postedTo(forked)).toEqual([{ kind: 'asm-scratch', gen: 1, src: 'result Nat\n\thalt\n' }])
+    expect(postedTo(blank)).toEqual([{ kind: 'asm-scratch', gen: 1, src: '' }])
+  })
+
+  it('registers an asm copy detached, with one asm leg building and nothing retained yet', () => {
+    const { reg, buffers } = harness()
+    const id = buffers.forkBlank('asm')
+    const entry = reg.entryOf(id)
+    expect(entry.detached).toBe(true)
+    expect(Object.keys(entry.legs)).toEqual(['asm'])
+    expect(entry.legs.asm?.status).toEqual({ available: false, reason: 'building…' })
+    expect([entry.asmProgram, entry.asmScratch, entry.tmProgram, entry.tmScratch]).toEqual([null, null, null, null])
+    expect(buffers.nameOf(id)).toBe('asm copy 1')
+  })
+
+  it('recompile posts asm-scratch for an asm copy', () => {
+    const { buffers, postedTo } = harness()
+    const id = buffers.forkBlank('asm')
+    expect(buffers.recompile(id, '\thalt\n')).toBe(true)
+    expect(postedTo(id)).toEqual([
+      { kind: 'asm-scratch', gen: 1, src: '' },
+      { kind: 'asm-scratch', gen: 2, src: '\thalt\n' },
+    ])
+  })
+
+  it('warm re-spawns a cold asm copy with asm-scratch', () => {
+    const { buffers, postedTo } = harness()
+    const id = buffers.forkBlank('asm')
+    buffers.setText(id, '\thalt\n')
+    buffers.cool(id, SOURCE, [])
+    buffers.warm(id)
+    expect(postedTo(id)).toEqual([{ kind: 'asm-scratch', gen: 1, src: '\thalt\n' }])
+  })
+
+  it('round-trips an asm copy’s leg through snapshot and restore', () => {
+    const h = harness()
+    const id = h.buffers.forkBlank('asm')
+    h.buffers.setText(id, '\thalt\n')
+    const fresh = harness()
+    fresh.buffers.restore(h.buffers.snapshot({}))
+    expect(fresh.buffers.list()).toEqual([{ id, label: 'copy 1', warm: false, leg: 'asm' }])
+  })
+})
diff --git a/web/tests/node/session-client.test.ts b/web/tests/node/session-client.test.ts
index 12691a2..c654a0e 100644
--- a/web/tests/node/session-client.test.ts
+++ b/web/tests/node/session-client.test.ts
@@ -188,6 +188,7 @@ describe('SessionClient streaming', () => {
       tapeNames: [],
       linkIndex: null,
       tmText: null,
+      asmText: null,
     })
     deliver({ kind: 'lambda-frames', gen: 1, frames: [], done: null })
     deliver({ kind: 'lambda-frames', gen: 1, frames: [], done: 'ended' })
@@ -258,6 +259,7 @@ const compiled = (gen: number): RunReply => ({
   tapeNames: [],
   linkIndex: null,
   tmText: null,
+  asmText: null,
 })
 
 describe('tmScratch', () => {
@@ -285,6 +287,26 @@ describe('tmScratch', () => {
   })
 })
 
+describe('asmScratch', () => {
+  it('posts an asm-scratch request carrying only the text', () => {
+    const { port, sent } = fakePort()
+    const c = new SessionClient(port, () => {})
+    const gen = c.supersede()
+    c.asmScratch(gen, 'result Nat\n\thalt\n')
+    expect(sent).toEqual([{ kind: 'asm-scratch', gen, src: 'result Nat\n\thalt\n' }])
+  })
+
+  it('drops a request whose generation has been superseded', () => {
+    const { port, sent } = fakePort()
+    const c = new SessionClient(port, () => {})
+    const stale = c.supersede()
+    c.supersede()
+    sent.length = 0
+    c.asmScratch(stale, '\thalt\n')
+    expect(sent).toEqual([])
+  })
+})
+
 describe('SessionClient generation', () => {
   it('drops the previous generation as soon as supersede is called, before request posts', () => {
     const p = port()
diff --git a/web/tests/node/sessions.test.ts b/web/tests/node/sessions.test.ts
index 9bee1af..576e0d3 100644
--- a/web/tests/node/sessions.test.ts
+++ b/web/tests/node/sessions.test.ts
@@ -109,6 +109,7 @@ function entry(
     tmProgram: null,
     tmScratch: null,
     asmProgram: null,
+    asmScratch: null,
   }
 }
 
````


- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm run build:wasm && pnpm run build:lsp-wasm && pnpm exec vitest run --project node tests/node/scratch.test.ts tests/node/replies.test.ts tests/node/buffers-store.test.ts tests/node/session-client.test.ts`

Expected: exit 1, printing:

```text
Test Files  4 failed (4)
Tests  14 failed | 117 passed (131)
```

Run: `cd web && pnpm exec vitest run --project browser tests/browser/worker.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  4 failed | 15 passed (19)
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=3
diff --git a/web/src/buffer-list.ts b/web/src/buffer-list.ts
index c5ada4d..281bd39 100644
--- a/web/src/buffer-list.ts
+++ b/web/src/buffer-list.ts
@@ -1,4 +1,5 @@
-import { type CopyLeg, LEG_NAME } from './legs'
+import { LEG_NAME } from './legs'
+import type { Leg } from './protocol'
 import type { SessionId } from './session-client'
 
 /**
@@ -61,7 +62,7 @@ export type BufferRow = {
    */
   readonly warm: boolean
   /** The copy's leg, which its name is said with. */
-  readonly leg: CopyLeg
+  readonly leg: Leg
 }
 
 /**
diff --git a/web/src/buffers-store.ts b/web/src/buffers-store.ts
index 97dd446..73e111f 100644
--- a/web/src/buffers-store.ts
+++ b/web/src/buffers-store.ts
@@ -1,5 +1,6 @@
-import type { CopyLeg } from './legs'
+import { LEGS } from './legs'
 import type { LeafId } from './panes'
+import type { Leg } from './protocol'
 import type { SessionId } from './session-client'
 
 /**
@@ -46,7 +47,7 @@ export type PersistedBuffer = {
   label: string
   text: string
   collapsed: boolean
-  leg: CopyLeg
+  leg: Leg
 }
 
 /**
@@ -100,7 +101,9 @@ function validBuffer(node: unknown, ids: Set<string>): node is PersistedBuffer {
   if (typeof n.label !== 'string' || n.label.length === 0) return false
   if (typeof n.text !== 'string') return false
   if (typeof n.collapsed !== 'boolean') return false
-  if (n.leg !== 'lambda' && n.leg !== 'tm') return false
+  // ANY LEG A COPY CAN BE MADE ON, READ OFF `LEGS` rather than written out: a list here would refuse the next leg's
+  // copies, and with them every copy in the store, with nothing to say why.
+  if (!LEGS.some((leg) => leg === n.leg)) return false
   if (ids.has(n.id)) return false
   ids.add(n.id)
   return true
diff --git a/web/src/draw.ts b/web/src/draw.ts
index 710775b..b01e4ed 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -218,7 +218,7 @@ export function createDraw(deps: {
       const asmPane = p.slot.binding.leg === 'asm' ? (p.pane as AsmPane) : null
       const asmSeeded = asmPane !== null && unseen.has(asmPane)
       if (asmSeeded) {
-        asmPane.setProgram(sessions.entryOf(p.slot.binding.session).asmProgram)
+        asmPane.setProgram(sessions.entryOf(p.slot.binding.session).asmProgram?.program ?? null)
         unseen.delete(asmPane)
       }
       const leg = p.slot.resolve(sessions)
@@ -408,8 +408,7 @@ export function createDraw(deps: {
           })
           break
         case 'asm': {
-          // NO COPY HAS AN ASM LEG UNTIL PART 5c (`legs.ts`'s `CopyLeg`), so an asm view is always on the program and
-          // the branch above answers it. Were one on another session, this is what it would say: whose, and how far.
+          // AN ASM VIEW ON A COPY: whose, and how far.
           const parts = [name, `${n(leg.hist.newestStep)} instructions`]
           readout.show(null, { segments: () => [parts.join(' · ')], rows: () => copyRows(parts) })
           break
diff --git a/web/src/legs.ts b/web/src/legs.ts
index decf966..42f0c72 100644
--- a/web/src/legs.ts
+++ b/web/src/legs.ts
@@ -33,14 +33,6 @@ import type { Leg } from './protocol'
  */
 export const LEG_NAME: Readonly<Record<Leg, string>> = { lambda: 'λ', asm: 'asm', tm: 'TM' }
 
-/**
- * A leg a copy can be made on: λ and TM. **ASM IS LEFT OUT UNTIL PART 5c**, which adds asm copies and widens this
- * (Plan 7 part 5 spec §7). Every place a copy's leg is held — a copy's record, the copies menu, the store — takes
- * this rather than `Leg`, so the switches over a copy's leg have no asm arm to write, and 5c's widening makes `tsc`
- * name each one it has to fill.
- */
-export type CopyLeg = Exclude<Leg, 'asm'>
-
 /**
  * Every leg, in the order the app lists them — the title-selector's groups (`SessionRegistry.pairs`) and the
  * detachment clause's names (`link-status.ts`'s `detachedText`).
diff --git a/web/src/main.ts b/web/src/main.ts
index 43f9c02..963e545 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -28,7 +28,7 @@ import { History } from './history'
 import { icon } from './icons'
 import { LambdaTrees } from './lambda-trees'
 import { closeLeaf, defaultLayout, LAYOUT_STORAGE_KEY, type LayoutNode, leaves, SOURCE_LEAF } from './layout'
-import { type CopyLeg, LEG_NAME } from './legs'
+import { LEG_NAME } from './legs'
 import { createLinkWiring, type LinkWiring } from './link-wiring'
 import { LspClient } from './lsp-client'
 import { lspHover } from './lsp-hover'
@@ -42,7 +42,7 @@ import type { PaneChoice } from './pane-chrome'
 import { createPaneHost, type LayoutEvent } from './pane-host'
 import { createPanel } from './panel'
 import { type LeafId, legOfPane, PaneCollection } from './panes'
-import type { RunReply } from './protocol'
+import type { Leg, RunReply } from './protocol'
 import { HISTORY_BYTES } from './protocol'
 import { createReadout, type ProgramResult } from './readout'
 import { createReplies } from './replies'
@@ -656,6 +656,7 @@ async function main(): Promise<EditorView> {
     tmProgram: null,
     tmScratch: null,
     asmProgram: null,
+    asmScratch: null,
   })
   /** The λ trees the views draw (spec §4) — one cache, asked through each session's own client. */
   const trees = new LambdaTrees((id) => (sessions.has(id) ? sessions.entryOf(id).client : undefined))
@@ -1455,7 +1456,7 @@ async function main(): Promise<EditorView> {
    * which escaped the `beforetoggle` handler exactly the way a cold buffer's did before `term` below
    * branched on `warm`.
    */
-  const copyTerm = (session: SessionId, leg: CopyLeg): string | null => {
+  const copyTerm = (session: SessionId, leg: Leg): string | null => {
     switch (leg) {
       case 'lambda':
         return sessions.legOf({ session, leg: 'lambda' }).hist.current?.text ?? null
@@ -1465,6 +1466,9 @@ async function main(): Promise<EditorView> {
         // string to join for a TM row today; it reads `null` (`no term yet` in the row) rather than
         // inventing one.
         return null
+      case 'asm':
+        // NOR DOES `AsmState`, for the TM arm's reason: a frame is registers and a pc, not a term.
+        return null
     }
   }
 
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index 90a6c4a..2605750 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -19,10 +19,9 @@ import type { LeafId, PaneCollection, PaneKind } from './panes'
 import type { Leg } from './protocol'
 import type { Detachable } from './scratch'
 import type { SessionId } from './session-client'
-import { type Binding, PaneSlot, type TmCompiled, type TmScratchReading } from './sessions'
+import { type AsmCompiled, type Binding, PaneSlot, type TmCompiled, type TmScratchReading } from './sessions'
 import { TmPane } from './tm-pane'
 import { seedTm } from './tm-seed'
-import type { AsmProgram } from './types'
 import { DEFAULT_DISPLAY, DEFAULT_TM_DISPLAY, type LambdaDisplay, type TmDisplay } from './workspace'
 
 /**
@@ -264,7 +263,7 @@ export function createPaneHost(deps: {
    * The asm listing `session` last compiled, or `null` — `tmProgramOf`'s twin for an asm view, asked for its reason: a
    * view built after the `compiled` reply that told the others has to be told from what the session kept.
    */
-  asmProgramOf(session: SessionId): AsmProgram | null
+  asmProgramOf(session: SessionId): AsmCompiled | null
   /**
    * The text and collapse flag a λ pane newly bound to `session` should mount its editor from, or
    * `null` when `session` is not a warm scratch buffer — `mountScratchEditor` below is the one caller.
@@ -403,11 +402,11 @@ export function createPaneHost(deps: {
 
   /**
    * Tell an asm view the listing `session` holds, or that it holds none — `seedTmPane`'s twin, and for its reason: a
-   * view comes to show a session after the reply that told the others, by being built or by being moved. Only the
-   * program has an asm leg until part 5c, so today every asm view is seeded from it.
+   * view comes to show a session after the reply that told the others, by being built or by being moved. The program's
+   * session and an asm copy's both keep a listing — `compiled` and `asm-scratch-compiled` retain it.
    */
   const seedAsmPane = (pane: AsmPane, session: SessionId): void => {
-    pane.setProgram(asmProgramOf(session))
+    pane.setProgram(asmProgramOf(session)?.program ?? null)
   }
 
   /**
diff --git a/web/src/protocol.ts b/web/src/protocol.ts
index b8e7b5c..111486e 100644
--- a/web/src/protocol.ts
+++ b/web/src/protocol.ts
@@ -514,6 +514,11 @@ export type RunRequest =
    * the app a surface that can send it — 5d-iv's TM pane.
    */
   | { kind: 'tm-scratch'; gen: number; src: string }
+  /**
+   * Build an asm copy from `.asm` TEXT and run it — Plan 7 part 5 spec §7. `tm-scratch`'s shape and for its reasons: no
+   * `step`, since the text is the program, and no `encoding`, since a copy decodes by its own `result` header.
+   */
+  | { kind: 'asm-scratch'; gen: number; src: string }
   /**
    * Record further. For a `capped` leg the worker raises the cursor cap first; for a `budget` leg it
    * simply allows another `HISTORY_BYTES` and resumes.
@@ -608,6 +613,21 @@ export type RunReply =
    * `value` IS `Unfinished` WHILE `run.run` IS `Running`, so a consumer can render either field alone.
    */
   | { kind: 'tm-value'; gen: number; run: ValueRun; value: Decoded }
+  /**
+   * An asm copy was built: its status, its listing and its value — `tm-scratch-compiled`'s counterpart.
+   *
+   * **THE VALUE COMES WITH THE BUILD**, where a TM copy's streams in on `tm-value`: `asmScratch` runs the program to
+   * its end before it answers, as `compile` does (spec amendment 26). `asm` is the same `AsmStatus` `compiled`
+   * carries, since every field of it is true of a copy. No `text` echo, for `tm-scratch-compiled`'s reason: the main
+   * thread sent the text.
+   */
+  | { kind: 'asm-scratch-compiled'; gen: number; asm: AsmStatus; asmProgram: AsmProgram; value: Decoded }
+  /**
+   * An asm copy's value after `[continue]` carried its cursor further — where a compiled session's arrives in
+   * `result`, which a copy never gets. Only a step cap can be continued, so this changes a value only for a copy
+   * whose build that cap stopped.
+   */
+  | { kind: 'asm-value'; gen: number; value: Decoded }
   /**
    * A session exists. Sent BEFORE any recording, so the panes can mount and show their declines
    * while the legs are still being stepped.
@@ -661,6 +681,11 @@ export type RunReply =
        * the same object.
        */
       tmText: string | null
+      /**
+       * This session's asm program as `.asm` text, for *edit a copy*, or `null` when there is no asm leg — the role
+       * `tmText` plays for the TM view.
+       */
+      asmText: string | null
     }
   | { kind: 'lambda-frames'; gen: number; frames: LambdaState[]; done: RecordEnd | null }
   | { kind: 'tm-frames'; gen: number; frames: TmState[]; done: RecordEnd | null }
diff --git a/web/src/replies.ts b/web/src/replies.ts
index aaf90ce..c4ba539 100644
--- a/web/src/replies.ts
+++ b/web/src/replies.ts
@@ -11,9 +11,8 @@ import { asmFrameBytes, lambdaFrameBytes, type RunReply, ruleCount, tmFrameBytes
 import type { ProgramResult } from './readout'
 import type { ScratchBuffers } from './scratch'
 import type { SessionId } from './session-client'
-import { resetLegs, type SessionRegistry, type TmCompiled } from './sessions'
+import { type AsmCompiled, resetLegs, type SessionRegistry, type TmCompiled } from './sessions'
 import type { TmPane } from './tm-pane'
-import type { AsmProgram } from './types'
 
 /**
  * `onReply` AND `onScratchReply`, MOVED OUT OF `main.ts` WHOLE — the two reply switches, every inline
@@ -205,15 +204,15 @@ export function createReplies(deps: {
    * `storeAndSetProgram`'s rule: a view off the page goes in `unseen`, and `draw()` seeds it from the entry when it is
    * shown. One call, so the entry always agrees with what the views were told.
    */
-  const setAsmProgram = (session: SessionId, program: AsmProgram | null): void => {
-    sessions.entryOf(session).asmProgram = program
+  const setAsmProgram = (session: SessionId, compiled: AsmCompiled | null): void => {
+    sessions.entryOf(session).asmProgram = compiled
     for (const p of panes.ofSession('asm', session)) {
       const pane = p.pane as AsmPane
       if (!p.host.isConnected) {
         unseen.add(pane)
         continue
       }
-      pane.setProgram(program)
+      pane.setProgram(compiled?.program ?? null)
     }
   }
 
@@ -255,7 +254,7 @@ export function createReplies(deps: {
         return
       case 'compiled':
         resetLegs(legs, { lambda: reply.lambda, asm: reply.asm, tm: reply.tm })
-        setAsmProgram(session, reply.asmProgram)
+        setAsmProgram(session, reply.asmProgram === null ? null : { program: reply.asmProgram, asmText: reply.asmText })
         // THE ONE REPLY THAT CARRIES A MACHINE, RETAINED AS IT IS FANNED OUT. `tmProgram` is nullable on
         // the wire defensively rather than reachably (`protocol.ts`'s own doc), so a reply with no machine
         // in it leaves the session holding nothing rather than an envelope around a `null`.
@@ -340,6 +339,8 @@ export function createReplies(deps: {
       case 'scratch-compiled':
       case 'tm-scratch-compiled':
       case 'tm-value':
+      case 'asm-scratch-compiled':
+      case 'asm-value':
         return
       default:
         unhandled(reply)
@@ -525,6 +526,35 @@ export function createReplies(deps: {
           (p.pane as TmPane).setScratchValue(entry.tmScratch?.value ?? null)
         return
       }
+      case 'asm-scratch-compiled': {
+        // `tm-scratch-compiled`'s arm for an asm copy: one status, the listing stored and fanned out, and the copy's
+        // status and value retained on the entry for a view built after this reply. The value comes with the build
+        // (`protocol.ts`'s own doc on this reply). No `asmText`: a copy offers no copy of itself.
+        resetLegs(sessions.entryOf(session).legs, { asm: reply.asm })
+        sessions.entryOf(session).asmScratch = { status: reply.asm, value: reply.value }
+        setAsmProgram(session, { program: reply.asmProgram, asmText: null })
+        // INTO STORAGE UNCONDITIONALLY, for the reason `tm-scratch-compiled`'s arm gives: every arrival here follows an
+        // edit or a fork that has already written the buffer's text.
+        onBuffersPersist()
+        draw()
+        return
+      }
+      case 'asm-value': {
+        // A `[continue]` carried the copy's cursor past its build's cap. Retained over the build's value, which it
+        // replaces; a reading with no build before it cannot happen, for `tm-value`'s reason.
+        const entry = sessions.entryOf(session)
+        if (entry.asmScratch !== null) entry.asmScratch = { ...entry.asmScratch, value: reply.value }
+        draw()
+        return
+      }
+      case 'asm-frames': {
+        // The asm counterpart of `lambda-frames` below, unguarded for the identical reason.
+        const leg = sessions.legOf({ session, leg: 'asm' })
+        for (const f of reply.frames) leg.hist.push(f, asmFrameBytes(f))
+        leg.done = reply.done
+        draw()
+        return
+      }
       case 'lambda-frames': {
         // UNGUARDED FOR THE REASON THE `scratch-compiled` ARM ABOVE STATES: `legOf` throws for a session
         // the registry no longer holds, and a cooled buffer's worker cannot deliver a reply at all
@@ -662,6 +692,7 @@ export function createReplies(deps: {
         // otherwise go on reading `running` over a thread that will never answer again. Whole-branch review of the
         // reduced-files slice.
         sessions.entryOf(session).tmScratch = null
+        sessions.entryOf(session).asmScratch = null
         for (const p of panes.ofSession('tm', session)) {
           const pane = p.pane as TmPane
           pane.setScratchStatus(null)
@@ -683,12 +714,10 @@ export function createReplies(deps: {
         notify(`${scratchpad.nameOf(session) ?? 'a copy'} stopped — ${reply.message}`)
         draw()
         return
-      // THREE KINDS A COPY'S WORKER NEVER SENDS, WRITTEN OUT for the reason `onReply`'s three are: only `onRun`
-      // posts them, for the program's session. A copy has neither the `SourceMap` nor the `ty` `compiled` and `result`
-      // carry, and no copy has an asm leg to send `asm-frames` for until part 5c.
+      // TWO KINDS A COPY'S WORKER NEVER SENDS, WRITTEN OUT for the reason `onReply`'s are: only `onRun` posts them,
+      // for the program's session. A copy has neither the `SourceMap` nor the `ty` `compiled` and `result` carry.
       case 'compiled':
       case 'result':
-      case 'asm-frames':
         return
       default:
         unhandled(reply)
diff --git a/web/src/scratch.ts b/web/src/scratch.ts
index f58df83..b1c95ba 100644
--- a/web/src/scratch.ts
+++ b/web/src/scratch.ts
@@ -1,11 +1,11 @@
 import type { PersistedBuffers } from './buffers-store'
 import { History } from './history'
-import { type CopyLeg, LEG_NAME, unhandled } from './legs'
+import { LEG_NAME, unhandled } from './legs'
 import type { LeafId } from './panes'
-import type { RunReply } from './protocol'
+import type { Leg, RunReply } from './protocol'
 import type { SessionId, SessionPool } from './session-client'
 import { resetLegs, type SessionLegs, type SessionRegistry } from './sessions'
-import type { Diagnostic, LambdaState, TmState } from './types'
+import type { AsmState, Diagnostic, LambdaState, TmState } from './types'
 
 /**
  * What retiring a buffer needs from a pane slot: which session it is on, and the ability to move it
@@ -40,14 +40,14 @@ export type BufferInfo = {
   readonly id: SessionId
   readonly label: string
   readonly warm: boolean
-  readonly leg: CopyLeg
+  readonly leg: Leg
 }
 
 /** What undoing a delete needs to put a copy back: its id, name, leg, text and collapse flag. */
 export type BufferRecord = {
   readonly id: SessionId
   readonly label: string
-  readonly leg: CopyLeg
+  readonly leg: Leg
   readonly text: string
   readonly collapsed: boolean
 }
@@ -82,7 +82,7 @@ type BufferState = {
    * binding must agree with — `SessionRegistry.legOf` throws on a binding naming a leg its session
    * lacks, and this is the field that decides which leg the session was built with.
    */
-  readonly leg: CopyLeg
+  readonly leg: Leg
   text: string
   collapsed: boolean
   warm: boolean
@@ -517,7 +517,7 @@ export class ScratchBuffers {
    *
    * For what this doc used to claim and why it changed, see the history note under `fork`.
    */
-  fork(slot: Detachable, src: string, step: number, leg: CopyLeg): SessionId {
+  fork(slot: Detachable, src: string, step: number, leg: Leg): SessionId {
     // `'cannot make a copy — '` — THIS CALL IS THE ONE OF THE TWO CALLERS FOR WHICH THAT IS TRUE. See
     // `#refuseAtCap`'s own doc for why the prefix is a call-site argument rather than baked into the
     // shared message.
@@ -536,7 +536,7 @@ export class ScratchBuffers {
    * NO PREFIX ON THE REFUSAL — this is not a fork, so `#refuseAtCap`'s call-site prefix argument puts
    * it in the same class as `warm`.
    */
-  forkBlank(leg: CopyLeg): SessionId {
+  forkBlank(leg: Leg): SessionId {
     if (this.warmCount() >= MAX_WARM_BUFFERS) this.#refuseAtCap('')
     return this.#mint('', 0, leg, null)
   }
@@ -548,7 +548,7 @@ export class ScratchBuffers {
    * from a `Detachable` it must then rebind, `forkBlank` from nothing at all. `slot?.rebind(id)` below
    * is the whole of that fork — a `null` here is `forkBlank`'s own claim that no pane is owed a move.
    */
-  #mint(src: string, step: number, leg: CopyLeg, slot: Detachable | null): SessionId {
+  #mint(src: string, step: number, leg: Leg, slot: Detachable | null): SessionId {
     this.#minted += 1
     const id: SessionId = `scratch-${this.#minted}`
     // `copy N` — THE LEG IS SAID WHEREVER THE LABEL IS SHOWN (`nameOf`, `view-header.ts`'s `pairLabel`),
@@ -848,8 +848,10 @@ export class ScratchBuffers {
       // that is permanent.
       tmProgram: null,
       tmScratch: null,
-      // NO COPY HAS AN ASM LEG UNTIL PART 5c (`legs.ts`'s `CopyLeg`), so nothing will ever write here either.
+      // AN ASM COPY'S LISTING AND READING, written by `replies.ts`'s `asm-scratch-compiled` arm as a TM copy's machine
+      // is; `null` for good on a λ or TM copy, which has no asm leg.
       asmProgram: null,
+      asmScratch: null,
     })
     state.warm = true
     // SUPERSEDE THEN POST, the pattern `compile.ts`'s `schedule` uses and for the same reason
@@ -867,6 +869,10 @@ export class ScratchBuffers {
         // goes unread on the arm that has nothing to replay.
         client.tmScratch(gen, src)
         break
+      case 'asm':
+        // NO STEP, FOR THE TM ARM'S REASON: an asm copy's text is its program, run from its first instruction.
+        client.asmScratch(gen, src)
+        break
       default:
         unhandled(state.leg)
     }
@@ -879,13 +885,15 @@ export class ScratchBuffers {
    * changed is WHICH leg gets it. A session holds at most one leg per `Leg`, and this is where that is
    * decided for a buffer.
    */
-  #pendingLegs(leg: CopyLeg): SessionLegs {
+  #pendingLegs(leg: Leg): SessionLegs {
     const status = { available: false, reason: 'building…' }
     switch (leg) {
       case 'lambda':
         return { lambda: { hist: new History<LambdaState>(this.#bytes), status, done: null, playing: false } }
       case 'tm':
         return { tm: { hist: new History<TmState>(this.#bytes), status, done: null, playing: false } }
+      case 'asm':
+        return { asm: { hist: new History<AsmState>(this.#bytes), status, done: null, playing: false } }
     }
   }
 
@@ -1071,6 +1079,9 @@ export class ScratchBuffers {
       case 'tm':
         client.tmScratch(gen, src)
         break
+      case 'asm':
+        client.asmScratch(gen, src)
+        break
       default:
         unhandled(state.leg)
     }
@@ -1260,7 +1271,7 @@ export class ScratchBuffers {
   noSessionReply(id: SessionId, diagnostics: readonly Diagnostic[]): readonly Diagnostic[] | null {
     const state = this.#buffers.get(id)
     if (state === undefined || !state.warm) return null
-    const leg = this.#reg.entryOf(id).legs.lambda
+    const leg = this.#reg.entryOf(id).legs[state.leg]
     if (leg !== undefined && leg.hist.current !== undefined) return null
     return diagnostics
   }
diff --git a/web/src/session-client.ts b/web/src/session-client.ts
index 93b5d18..ba22ed4 100644
--- a/web/src/session-client.ts
+++ b/web/src/session-client.ts
@@ -133,6 +133,15 @@ export class SessionClient {
     this.#port.postMessage({ kind: 'tm-scratch', gen, src })
   }
 
+  /**
+   * Build an asm copy from `.asm` text and run it — Plan 7 part 5 spec §7. No `step`, for `tmScratch`'s reason: the
+   * text is the program, and a copy starts at its first instruction. The same generation guard as its siblings.
+   */
+  asmScratch(gen: number, src: string): void {
+    if (gen !== this.#gen) return
+    this.#port.postMessage({ kind: 'asm-scratch', gen, src })
+  }
+
   /**
    * Ask for more frames on one leg. ADDRESSES THE CURRENT GENERATION AND DOES NOT ADVANCE IT: this
    * continues the run already in the worker, and bumping the generation would abandon the very
diff --git a/web/src/session-worker.ts b/web/src/session-worker.ts
index a7706f0..4652b47 100644
--- a/web/src/session-worker.ts
+++ b/web/src/session-worker.ts
@@ -37,7 +37,7 @@
  * here. (It read "singleton" for the first of those until 5d-ii-c decision 1 made a fork mint a buffer
  * per call; what did not change is that this file has no opinion either way.)
  */
-import init, { compile, lambdaScratchAt, tapeNames, tmScratch } from '../../pkg/redextape_wasm.js'
+import init, { asmScratch, compile, lambdaScratchAt, tapeNames, tmScratch } from '../../pkg/redextape_wasm.js'
 import { LEGS, perLeg, unhandled } from './legs'
 import type { LinkIndexWire } from './link'
 import type { AsmLeg, LambdaLeg, LambdaTreeWire, Leg, RunReply, RunRequest, TmLeg } from './protocol'
@@ -107,6 +107,8 @@ type Session = {
    * `onRun` below reads it and passes it through unchanged, never through `??`.
    */
   tmText(): string | null
+  /** `null` for a program with no asm leg — `tmText`'s rule, read by `onRun` the same way. */
+  asmText(): string | null
   free(): void
 }
 
@@ -168,6 +170,21 @@ type TmValueRunHandle = {
   free(): void
 }
 
+/**
+ * The wasm-bindgen `AsmScratch`, described structurally for the reason `Session` above is: `Session`'s asm half, whole.
+ * A copy's asm leg answers every asm method a session's does (`session.rs`'s `AsmScratch`), so `ASM_RECORDING` and
+ * `onExtend`'s asm arm call it as they call a session. No `sourceSpan` or `linkIndex`: a copy has no `SourceMap`.
+ */
+type AsmScratchHandle = {
+  asmStatus(): AsmStatus
+  asmProgram(): AsmProgram
+  asmState(window: AsmWindow): AsmState
+  stepAsm(): boolean
+  raiseAsmCap(extraSteps: number): void
+  asmValue(): Decoded
+  free(): void
+}
+
 type CompileResult = { diagnostics: Diagnostic[]; session: Session | null }
 
 /**
@@ -190,6 +207,9 @@ type ForkedAtResult = { diagnostics: Diagnostic[]; scratch: LambdaScratchHandle
  */
 type TmScratchResult = { diagnostics: Diagnostic[]; scratch: TmScratchHandle | null; value: TmValueRunHandle | null }
 
+/** `asmScratch(src)`'s hand-built object: `null` for text that does not parse or has a label mistake, which the diagnostics name. */
+type AsmScratchResult = { diagnostics: Diagnostic[]; scratch: AsmScratchHandle | null }
+
 /**
  * Exactly what this worker uses of its global scope.
  *
@@ -237,6 +257,7 @@ type Live =
   | { gen: number; kind: 'session'; session: Session }
   | { gen: number; kind: 'lambda-scratch'; session: LambdaScratchHandle }
   | { gen: number; kind: 'tm-scratch'; session: TmScratchHandle; value: TmValueRunHandle | null }
+  | { gen: number; kind: 'asm-scratch'; session: AsmScratchHandle }
 
 let live: Live | null = null
 
@@ -352,8 +373,9 @@ const LAMBDA_RECORDING: RecordLeg<Session | LambdaScratchHandle, LambdaState> =
       case 'lambda-scratch':
         return live.session
       case 'tm-scratch':
-        // Deliberate silence, and a state no caller can currently reach: a `TmScratch` has no λ leg to record (§4.1 —
-        // one leg apiece), and each session has its own worker, so nothing posts a `run` and a `tm-scratch` to the SAME
+      case 'asm-scratch':
+        // Deliberate silence, and a state no caller can currently reach: a TM or asm copy has no λ leg to record (§4.1 —
+        // one leg apiece), and each session has its own worker, so nothing posts a `run` and a copy's build to the SAME
         // thread. Written as an arm for `TM_RECORDING`'s reason, stated there in full.
         return null
     }
@@ -386,7 +408,8 @@ const TM_RECORDING: RecordLeg<Session | TmScratchHandle, TmState> = {
       case 'tm-scratch':
         return live.session
       case 'lambda-scratch':
-        // Deliberate silence, and a state no caller can currently reach: a `LambdaScratch` has no TM leg to record
+      case 'asm-scratch':
+        // Deliberate silence, and a state no caller can currently reach: a λ or asm copy has no TM leg to record
         // (§4.1 — one leg apiece), and each session has its own worker, so nothing posts a `run` and a `lambda-scratch`
         // to the SAME thread. Written as an arm rather than an assertion because the one-live-session invariant is a
         // property of this file and must not become a property of who calls it: the day a caller does mix them, the
@@ -403,24 +426,23 @@ const TM_RECORDING: RecordLeg<Session | TmScratchHandle, TmState> = {
 }
 
 /**
- * The asm leg's pieces for `recordLeg`.
- *
- * **ONLY A `Session` HAS AN ASM LEG.** Neither copy kind carries one until part 5c, so its `handle` answers `null` for
- * both, and `onExtend`'s asm arm returns before recording for either.
+ * The asm leg's pieces for `recordLeg`: a `Session`'s asm leg or an asm copy's, which carry the same asm methods.
  *
  * **LIKE TM'S, A REPLAY OF A RUN WHOSE ANSWER IS KNOWN.** `compile` drove a cursor over the program to its end (spec
  * amendment 13), so exhausting this leg's allowance costs history, not the value. Its end is `asmRecordEnd`'s, which
  * names a full cap where `endOf` has none to name.
  */
-const ASM_RECORDING: RecordLeg<Session, AsmState> = {
+const ASM_RECORDING: RecordLeg<Session | AsmScratchHandle, AsmState> = {
   leg: 'asm',
   handle: (gen) => {
     if (live?.gen !== gen) return null
     switch (live.kind) {
       case 'session':
+      case 'asm-scratch':
         return live.session
       case 'lambda-scratch':
       case 'tm-scratch':
+        // A λ or TM copy has no asm leg, for `TM_RECORDING`'s reason.
         return null
     }
   },
@@ -531,6 +553,8 @@ async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
   // THE GATE, AND THE ONLY LOGIC IN THIS FILE THAT IS NOT A WASM CALL — `forkable` is imported from
   // `protocol.ts` precisely so it is not written here, where the coverage gate cannot see it.
   const tmText = forkable(tmProgram) ? session.tmText() : null
+  // `null` WHEN THERE IS NO ASM LEG, AS `asmText` ITSELF ANSWERS; guarded anyway for `asmProgram`'s reason above.
+  const asmText = asm.available ? session.asmText() : null
   ctx.postMessage(
     {
       kind: 'compiled',
@@ -544,6 +568,7 @@ async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
       tapeNames: tapeNames() as string[],
       linkIndex: index,
       tmText,
+      asmText,
     },
     // TRANSFERRED, NOT CLONED. `prog200`'s index is ~689 KB and the app rebuilds one on every 300 ms
     // typing pause; a structured clone would copy all of it. The buffers are dead on this side the
@@ -738,6 +763,44 @@ async function runValueLoop(gen: number): Promise<void> {
   }
 }
 
+/**
+ * Build an asm copy from `.asm` text and record its run — `onTmScratch`'s counterpart, arriving as `asm-scratch` (Plan 7
+ * part 5 spec §7). The same prologue as `onRun`, for the invariant `onLambdaScratch`'s doc states.
+ *
+ * **ITS VALUE RIDES THE BUILD REPLY.** `asmScratch` has already run the program to its end (spec amendment 26), so
+ * `asm-scratch-compiled` carries the value, and there is no value loop after the recording as a TM copy has.
+ */
+async function onAsmScratch(req: Extract<RunRequest, { kind: 'asm-scratch' }>): Promise<void> {
+  await ready
+  dropLive()
+  for (const leg of LEGS) {
+    recorded[leg] = 0
+    allowance[leg] = HISTORY_BYTES
+    recording[leg] = false
+  }
+
+  const { diagnostics, scratch } = asmScratch(req.src) as AsmScratchResult
+  if (scratch === null) {
+    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
+    return
+  }
+  // Deliberate silence: a newer request landed while `asmScratch` (uninterruptible) was in flight — `onTmScratch`'s case.
+  if (latest !== req.gen) {
+    scratch.free()
+    return
+  }
+  live = { gen: req.gen, kind: 'asm-scratch', session: scratch }
+
+  ctx.postMessage({
+    kind: 'asm-scratch-compiled',
+    gen: req.gen,
+    asm: scratch.asmStatus(),
+    asmProgram: scratch.asmProgram(),
+    value: scratch.asmValue(),
+  })
+  await recordAsm(req.gen, true)
+}
+
 async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<void> {
   // Deliberate silence: the generation being extended is not the live one anymore (superseded by a
   // later `run`, or there was never a session for it).
@@ -767,7 +830,7 @@ async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<v
       // tidier still, but the allowance write above is harmless for a leg that never records and hoisting
       // this check above it would put a `kind` test in front of the ordinary path — the same trade-off
       // the TM arm below already makes in the other direction.
-      if (live.kind === 'tm-scratch') return
+      if (live.kind === 'tm-scratch' || live.kind === 'asm-scratch') return
       const s = live.session
       // Raising a cap that was not hit is harmless — `raise_cap` is additive — but calling it on a
       // DEPTH-refused cursor is pointless by contract, and this arm is never reached for one:
@@ -781,15 +844,15 @@ async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<v
       // A `LambdaScratch` has no TM leg, so there is no cap to raise and nothing to record.
       // This guard excludes it from the TM arm, mirroring the λ arm's exclusion of
       // `TmScratch` above.
-      if (live.kind === 'lambda-scratch') return
+      if (live.kind === 'lambda-scratch' || live.kind === 'asm-scratch') return
       const s = live.session
       if (s.tmStatus().run === 'Capped') s.raiseTmCap(EXTEND_STEPS, EXTEND_CELLS)
       ran = await recordTm(req.gen, false)
       break
     }
     case 'asm': {
-      // ONLY A `Session` HAS AN ASM LEG (`ASM_RECORDING`'s doc), so a copy has no cap to raise and nothing to record.
-      if (live.kind !== 'session') return
+      // A λ or TM copy has no asm leg, so there is no cap to raise and nothing to record.
+      if (live.kind === 'lambda-scratch' || live.kind === 'tm-scratch') return
       const s = live.session
       // THE STEP CAP ONLY. A run the stack, heap or saved frames stopped cannot be continued, and `controls.ts` offers
       // no continue for one (`asmRecordEnd`'s ends), so this arm is never reached for it — and `raise_asm_cap` would not
@@ -818,7 +881,12 @@ async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<v
   // `tmLeg` reads `tmValue`; §3.3 puts both off the scratch types because decoding is type-directed
   // and a scratch has no `ty` to decode against. The frames this call just recorded, and their
   // `RecordEnd`, are its whole answer; a headered TM buffer's value arrives separately, as the
-  // `tm-value` replies `runValueLoop` posts, which `[continue]` neither starts nor extends.
+  // `tm-value` replies `runValueLoop` posts, which `[continue]` neither starts nor extends. An asm copy's value is read
+  // off its cursor once a raise has carried it past its build's cap, so it is posted again here, on its own.
+  if (live.kind === 'asm-scratch') {
+    ctx.postMessage({ kind: 'asm-value', gen: req.gen, value: live.session.asmValue() })
+    return
+  }
   if (live.kind !== 'session') return
   ctx.postMessage({
     kind: 'result',
@@ -845,7 +913,7 @@ async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<v
  * `ArrayBuffer`, which nothing here reads again.
  */
 function onLambdaTree(req: Extract<RunRequest, { kind: 'lambda-tree' }>): void {
-  if (live?.gen !== req.gen || live.kind === 'tm-scratch') return
+  if (live?.gen !== req.gen || live.kind === 'tm-scratch' || live.kind === 'asm-scratch') return
   if (live.kind === 'session' && !live.session.lambdaStatus().available) return
   const tree = live.session.lambdaTree(req.step, req.budget)
   ctx.postMessage({ kind: 'lambda-tree', gen: req.gen, tree }, [
@@ -883,6 +951,11 @@ ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
         latest = req.gen
         await onTmScratch(req)
         break
+      case 'asm-scratch':
+        // `latest` IS CLAIMED HERE TOO, FOR `lambda-scratch`'s OWN REASON.
+        latest = req.gen
+        await onAsmScratch(req)
+        break
       case 'extend':
         await onExtend(req)
         break
diff --git a/web/src/sessions.ts b/web/src/sessions.ts
index 0af9390..b7ec44d 100644
--- a/web/src/sessions.ts
+++ b/web/src/sessions.ts
@@ -9,7 +9,17 @@ import { LEGS } from './legs'
 import type { SplitChoices } from './pane-chrome'
 import type { Leg, RecordEnd } from './protocol'
 import type { SessionClient, SessionId } from './session-client'
-import type { AsmProgram, AsmState, LambdaState, TmProgram, TmScratchStatus, TmState, ValueReading } from './types'
+import type {
+  AsmProgram,
+  AsmState,
+  AsmStatus,
+  Decoded,
+  LambdaState,
+  TmProgram,
+  TmScratchStatus,
+  TmState,
+  ValueReading,
+} from './types'
 
 /**
  * One leg's live state on this side of the boundary: its history, how recording ended, and what the
@@ -97,6 +107,19 @@ export type SessionLegs = { [L in Leg]?: LegState<LegFrame[L]> }
  */
 export type TmCompiled = { readonly program: TmProgram; readonly tapeNames: string[]; readonly tmText: string | null }
 
+/**
+ * The asm listing a session compiled, and the text *edit a copy* seeds a copy from — `TmCompiled`'s shape for the asm
+ * leg, and for its reason: the view that offers a copy needs both, and a view built after the reply is seeded from
+ * here. `asmText` is `null` on a copy, which offers no copy of itself.
+ */
+export type AsmCompiled = { readonly program: AsmProgram; readonly asmText: string | null }
+
+/**
+ * What an asm copy's views were last told about its run: the status and value its build reply carried, the value
+ * replaced by any `asm-value` a `[continue]` brings. `null` on every session that is not an asm copy.
+ */
+export type AsmScratchReading = { readonly status: AsmStatus; readonly value: Decoded }
+
 /**
  * What a TM buffer's panes were last told about the FILE rather than the machine: its status, and its value run's
  * latest reading, or `null` before the first `tm-value` reply and for a file with no header.
@@ -187,11 +210,13 @@ export type SessionEntry = {
    */
   tmScratch: TmScratchReading | null
   /**
-   * The asm listing a session's last `compiled` reply carried, retained for `tmProgram`'s reason: an asm view created
-   * after that reply is seeded from here (`pane-host.ts`'s `seedAsmPane`). `null` for a session with no asm leg — a
-   * program that does not lower, and every copy, since no copy has an asm leg until part 5c.
+   * The asm listing a session's last `compiled` or `asm-scratch-compiled` reply carried, and the program's text,
+   * retained for `tmProgram`'s reason: an asm view created after that reply is seeded from here (`pane-host.ts`'s
+   * `seedAsmPane`). `null` for a session with no asm leg — a program that does not lower, and a λ or TM copy.
    */
-  asmProgram: AsmProgram | null
+  asmProgram: AsmCompiled | null
+  /** An asm copy's status and value, retained for `tmScratch`'s reason. `null` for every other session. */
+  asmScratch: AsmScratchReading | null
 }
 
 /**
````


- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  53 passed (53)
Tests  739 passed (739)
```

Run: `cd web && pnpm exec vitest run --project browser tests/browser/worker.test.ts`

Expected: exit 0, printing:

```text
Test Files  1 passed (1)
Tests  19 passed (19)
```

Run: `cd web && pnpm run typecheck`

Expected: exit 0, printing:

```text
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 973 filtered out
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 17 of 17 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | an asm copy is built as a TM copy — `scratch.ts`: `client.asmScratch(gen, src) ⏎         break ⏎       default: ⏎         unhandled(state.leg) ⏎     } ⏎   }` → `client.tmScratch(gen, src) ⏎         break ⏎       default: ⏎         unhandled(state.leg) ⏎     } ⏎   }` | `cd web && pnpm exec vitest run --project node tests/node/scratch.test.ts` | `tests/node/scratch.test.ts > asm copies > recompile posts asm-scratch for an asm copy`, `tests/node/scratch.test.ts > asm copies > sends asm-scratch for an asm copy, whether forked or blank`, `tests/node/scratch.test.ts > asm copies > warm re-spawns a cold asm copy with asm-scratch` |
| 2 | an asm copy gets a TM leg — `scratch.ts`: `return { asm: { hist: new History<AsmState>(this.#bytes), status, done: null, playing: false } }` → `return { tm: { hist: new History<TmState>(this.#bytes), status, done: null, playing: false } }` | `cd web && pnpm exec vitest run --project node tests/node/scratch.test.ts` | `tests/node/scratch.test.ts > ScratchBuffers.noSessionReply, on the copy’s own leg > answers null for an asm copy that has built a frame, and the diagnostics for one that has not`, `tests/node/scratch.test.ts > asm copies > registers an asm copy detached, with one asm leg building and nothing retained yet` |
| 3 | an asm copy's edit posts nothing — `scratch.ts`: `case 'asm': ⏎         client.asmScratch(gen, src) ⏎         break ⏎       default: ⏎         unhandled(state.leg) ⏎     } ⏎     return true` → `case 'asm': ⏎         break ⏎       default: ⏎         unhandled(state.leg) ⏎     } ⏎     return true` | `cd web && pnpm exec vitest run --project node tests/node/scratch.test.ts` | `tests/node/scratch.test.ts > asm copies > recompile posts asm-scratch for an asm copy` |
| 4 | a failed build is judged by the λ leg — `scratch.ts`: `const leg = this.#reg.entryOf(id).legs[state.leg]` → `const leg = this.#reg.entryOf(id).legs.lambda` | `cd web && pnpm exec vitest run --project node tests/node/scratch.test.ts` | `tests/node/scratch.test.ts > ScratchBuffers.noSessionReply, on the copy’s own leg > answers null for a TM copy that has built a frame, and the diagnostics for one that has not`, `tests/node/scratch.test.ts > ScratchBuffers.noSessionReply, on the copy’s own leg > answers null for an asm copy that has built a frame, and the diagnostics for one that has not` |
| 5 | the store refuses an asm copy — `buffers-store.ts`: `if (!LEGS.some((leg) => leg === n.leg)) return false` → `if (n.leg !== 'lambda' && n.leg !== 'tm') return false` | `cd web && pnpm exec vitest run --project node tests/node/buffers-store.test.ts` | `tests/node/buffers-store.test.ts > parseBuffers > accepts an asm buffer, at the version it always was` |
| 6 | an asm copy's build is not persisted — `replies.ts`: `` setAsmProgram(session, { program: reply.asmProgram, asmText: null }) ⏎         // INTO STORAGE UNCONDITIONALLY, for the reason `tm-scratch-compiled`'s arm gi… `` → `setAsmProgram(session, { program: reply.asmProgram, asmText: null })` | `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts` | `tests/node/replies.test.ts > an asm copy retains what its views were last told > holds the listing, the status and the value its build reply carried, and persists the copy` |
| 7 | an asm copy's reading is not kept — `replies.ts`: `sessions.entryOf(session).asmScratch = { status: reply.asm, value: reply.value }` → `(deleted)` | `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts` | `tests/node/replies.test.ts > an asm copy retains what its views were last told > holds the listing, the status and the value its build reply carried, and persists the copy`, `tests/node/replies.test.ts > an asm copy retains what its views were last told > takes the value a [continue] brings in place of the build’s` |
| 8 | a copy's asm frames are dropped — `replies.ts`: `for (const f of reply.frames) leg.hist.push(f, asmFrameBytes(f)) ⏎         leg.done = reply.done ⏎         draw() ⏎         return ⏎       } ⏎       case 'la…` → `leg.done = reply.done ⏎         draw() ⏎         return ⏎       } ⏎       case 'lambda-frames': { ⏎         // UNGUARDED` | `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts` | `tests/node/replies.test.ts > an asm copy retains what its views were last told > records its frames into its asm leg` |
| 9 | a [continue]'s value is dropped — `replies.ts`: `if (entry.asmScratch !== null) entry.asmScratch = { ...entry.asmScratch, value: reply.value }` → `(deleted)` | `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts` | `tests/node/replies.test.ts > an asm copy retains what its views were last told > takes the value a [continue] brings in place of the build’s` |
| 10 | a dead copy keeps its reading — `replies.ts`: `sessions.entryOf(session).asmScratch = null` → `(deleted)` | `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts` | `tests/node/replies.test.ts > an asm copy retains what its views were last told > forgets its reading when its worker throws` |
| 11 | compiled drops the asm text — `replies.ts`: `{ program: reply.asmProgram, asmText: reply.asmText }` → `{ program: reply.asmProgram, asmText: null }` | `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts` | `` tests/node/replies.test.ts > a session retains its asm text beside its listing > holds the text a `compiled` reply carried, and nothing when it carried no listing `` |
| 12 | a stale asmScratch still posts — `session-client.ts`: `asmScratch(gen: number, src: string): void { ⏎     if (gen !== this.#gen) return` → `asmScratch(gen: number, src: string): void {` | `cd web && pnpm exec vitest run --project node tests/node/session-client.test.ts` | `tests/node/session-client.test.ts > asmScratch > drops a request whose generation has been superseded` |
| 13 | an asm copy is not recorded — `session-worker.ts`: `case 'session': ⏎       case 'asm-scratch': ⏎         return live.session ⏎       case 'lambda-scratch': ⏎       case 'tm-scratch': ⏎         // A λ or TM co…` → `case 'session': ⏎         return live.session ⏎       case 'asm-scratch': ⏎       case 'lambda-scratch': ⏎       case 'tm-scratch': ⏎         // A λ or TM co…` | `cd web && pnpm exec vitest run --project browser tests/browser/worker.test.ts` | `tests/browser/worker.test.ts > session-worker asm copies > answers extend on an asm copy with its frames and its value, where a session gets a result`, `tests/browser/worker.test.ts > session-worker asm copies > builds an asm copy, answers with its status, listing and value, then records its frames` |
| 14 | an asm copy's build carries no value — `session-worker.ts`: `value: scratch.asmValue(), ⏎   }) ⏎   await recordAsm(req.gen, true)` → `value: 'Unfinished', ⏎   }) ⏎   await recordAsm(req.gen, true)` | `cd web && pnpm exec vitest run --project browser tests/browser/worker.test.ts` | `tests/browser/worker.test.ts > session-worker asm copies > builds an asm copy, answers with its status, listing and value, then records its frames` |
| 15 | extend on an asm copy posts no value — `session-worker.ts`: `if (live.kind === 'asm-scratch') { ⏎     ctx.postMessage({ kind: 'asm-value', gen: req.gen, value: live.session.asmValue() }) ⏎     return ⏎   }` → `if (live.kind === 'asm-scratch') return` | `cd web && pnpm exec vitest run --project browser tests/browser/worker.test.ts` | `tests/browser/worker.test.ts > session-worker asm copies > answers extend on an asm copy with its frames and its value, where a session gets a result` |
| 16 | compiled carries no asm text — `session-worker.ts`: `const asmText = asm.available ? session.asmText() : null` → `const asmText = null` | `cd web && pnpm exec vitest run --project browser tests/browser/worker.test.ts` | `tests/browser/worker.test.ts > session-worker asm copies > sends the program’s asm as text on compiled, headed by its type, and null with no asm leg` |
| 17 | the worker has no asm-scratch arm — `session-worker.ts`: `` case 'asm-scratch': ⏎         // `latest` IS CLAIMED HERE TOO, FOR `lambda-scratch`'s OWN REASON. ⏎         latest = req.gen ⏎         await onAsmScratch(req… `` → `(deleted)` | `cd web && pnpm exec tsc --noEmit` | `session-worker.ts(961,19): error TS2345: Argument of type '{ kind: "asm-scratch"; gen: number; src: ` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
A copy can be made on the asm leg: the worker builds and records it, and its build carries its value

`asm-scratch` builds an `AsmScratch` from text and records its run
through the asm leg's own recording, and `asm-scratch-compiled`
carries its status, listing and value; `[continue]` on a copy posts
`asm-value`, where a session gets `result`. `compiled` carries the
program's asm text beside its listing, for *edit a copy*. A copy's
leg is any `Leg` now (spec amendment 20's widening), so the copies
collection mints, rebuilds and warms an asm copy with its own
request, the store accepts one at version 2 (amendment 23), and the
entry keeps an asm copy's listing and reading. A failed build is
judged by the copy's own leg, not the λ leg every copy was read by,
which answered every unparseable edit to a TM copy that had built as
a failed build (amendment 27).
````


---

### Task 4: The asm view edits a copy of the program: *edit a copy* makes one, and the view holds its editor, value and outline

**Files:**
- Create: `web/src/asm-seed.ts` (`seedAsm`)
- Modify: `web/src/asm-pane.ts` (the editor, its text panel and outline, the value line, *format* and *edit a copy*), `web/src/pane-chrome.ts` (`PaneEvents.detachAsm`), `web/src/transport.ts` (`detachAsm`; a copy's rows link nothing), `web/src/pane-host.ts` (an asm view holds an editor; every seed through `seedAsm`; a TM or asm view destroys the editor it leaves), `web/src/replies.ts` (the fan-outs), `web/src/draw.ts`, `web/src/main.ts`, `web/src/results.ts` (`endedLine`), `web/src/style.css`, and three docs (`lsp-protocol.ts`, `link-wiring.ts`, `link-status.ts`)
- Test: `web/tests/browser/asm-copy.test.ts`, `web/tests/browser/asm-copy-restore.test.ts`, `web/tests/browser/asm-pane.test.ts`, `web/tests/node/replies.test.ts`

**Interfaces:**
- Consumes Task 3's `AsmCompiled`, `AsmScratchReading`, the entry's `asmScratch` and `compiled.asmText`.
- Produces `AsmPane implements EditablePane` (`setEditor`, `takeEditor`, `receiveEditor`, `holdsEditor`), `setScratch(reading: AsmScratchReading | null)`, `setForkAvailable(text: string | null, instructions: number)`; `AsmPanels` gains `outline`; `asm-seed.ts`'s `seedAsm(pane, compiled, reading)`; `results.ts`'s `endedLine(value: Decoded)`; `PaneEvents.detachAsm?(): void`; `pane-host.ts`'s dependency `asmScratchOf(session)`.

**THE VIEW HOLDS A COPY'S EDITOR AS THE TM VIEW HOLDS A TM COPY'S** (amendment 28): the text panel first, in `redextape_asm`, so part 3's diagnostics — Task 1's label marks among them — format, hover, outline and colour arrive unchanged; then the copy's value, `value: 7` or `fault: head of empty list at pc1` by `endedLine`, the TM value line's rule; the listing and the machine's panels; and the outline of the copy's labels last. The CSS names the panels that share the height rather than every open one: the text panel keeps its own height, and a `display` on a hidden panel would show it (`hidden.test.ts` catches the outline's case).

**`seedAsm` IS THE ONE WAY A VIEW IS TOLD WHAT ITS SESSION KEEPS** — the listing, whether it can be copied, and a copy's value — from every route that moves a view onto a session: creation, a pick, a cool or retire, a view shown after a compile it missed, and the replies themselves. *Edit a copy* is ready, disabled with its reason when the program's text was withheld (Task 6's ceiling), or absent on a copy and where there is no asm leg.

**A ROW IN A COPY LINKS NOTHING, IN EITHER VIEW.** The link index describes the program, so an instruction or state index read in a copy names whatever the program has there — and a TM copy's state rows did exactly that on `main`: probed, a click on a copy's `wl1s2` row pinned `40` in the source. `transport.ts` returns early for a detached session in both handlers.

**A TM OR ASM VIEW DESTROYS THE EDITOR IT LEAVES.** The same-leg rebind held it in custody for a claim control only λ views offer, and `mountScratchEditor` mounts nothing while custody has an editor — so on `main`, a TM view taken from its copy to the program and back had no editor, for good. The view that comes back now mounts a fresh one from the copy's text of record, as the drop pass already made a closed TM view's.

**A COPY MADE SO SURVIVES A RELOAD, ON ITS LEG, AT VERSION 2** (amendment 23), in the view that showed it, with the text last typed into it — what Task 3's store and this task's gesture make together.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=4
diff --git a/web/tests/browser/asm-copy-restore.test.ts b/web/tests/browser/asm-copy-restore.test.ts
new file mode 100644
index 0000000..fc31da2
--- /dev/null
+++ b/web/tests/browser/asm-copy-restore.test.ts
@@ -0,0 +1,55 @@
+import { EditorView } from '@codemirror/view'
+import { describe, expect, it } from 'vitest'
+import { BUFFERS_STORAGE_KEY, BUFFERS_VERSION, parseBuffers } from '../../src/buffers-store'
+import { SHELL, until } from './harness'
+
+/**
+ * An asm copy survives a reload (Plan 7 part 5 spec §7, amendment 23): stored at `BUFFERS_VERSION` 2 with its leg,
+ * and brought back on its own leg, in the view that showed it, with the text last typed into it.
+ *
+ * A RELOAD IS A FRESH `main` ON THE SAME STORE — `tm-buffer-restore.test.ts`'s mechanism: a cache-busting query
+ * string gives a genuinely new module instance, and `localStorage` is left as the first instance wrote it.
+ */
+
+let remountSeq = 0
+async function mount(): Promise<EditorView> {
+  const spec = remountSeq === 0 ? '../../src/main' : `../../src/main?remount=${remountSeq}`
+  remountSeq += 1
+  document.body.innerHTML = SHELL
+  return (await import(/* @vite-ignore */ spec)).ready
+}
+
+const asm = () => document.querySelector<HTMLElement>('.pane[data-leaf="asm-0"]') as HTMLElement
+const editorText = () => {
+  const el = asm().querySelector<HTMLElement>('.term-editor')
+  return el === null ? null : (EditorView.findFromDOM(el)?.state.doc.toString() ?? null)
+}
+const value = () => asm().querySelector('.asm-value')?.textContent ?? ''
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+
+describe('restoring an asm copy', () => {
+  it('stores it on its leg at version 2, and brings it back in its view with its text', async () => {
+    localStorage.clear()
+    const view = await mount()
+    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
+    await until(() => !idle(), 'the compile to start')
+    await until(idle, 'the compile to finish')
+    await until(() => asm().querySelector('.asm-row') !== null, 'the program’s listing')
+    asm().querySelector<HTMLButtonElement>('button.detach')?.click()
+    await until(() => editorText() !== null, 'the copy’s editor')
+    const typed = 'result Nat\n\n    li\trr, #9\n    halt\n'
+    const v = EditorView.findFromDOM(asm().querySelector<HTMLElement>('.term-editor') as HTMLElement) as EditorView
+    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: typed } })
+    await until(() => value() === 'value: 9', 'the edit to build')
+
+    const raw = localStorage.getItem(BUFFERS_STORAGE_KEY)
+    expect(JSON.parse(raw ?? '{}').version).toBe(BUFFERS_VERSION)
+    expect(BUFFERS_VERSION).toBe(2)
+    expect(parseBuffers(raw)?.buffers.map((b) => [b.leg, b.text])).toEqual([['asm', typed]])
+
+    await mount()
+    await until(() => editorText() === typed, 'the restored copy’s editor')
+    await until(() => value() === 'value: 9', 'the restored copy’s value')
+    expect(asm().textContent).toMatch(/copy · not linked/)
+  })
+})
diff --git a/web/tests/browser/asm-copy.test.ts b/web/tests/browser/asm-copy.test.ts
new file mode 100644
index 0000000..8fe133d
--- /dev/null
+++ b/web/tests/browser/asm-copy.test.ts
@@ -0,0 +1,257 @@
+import { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { page, userEvent } from 'vitest/browser'
+import { bindingKey } from '../../src/view-header'
+import { SHELL, until } from './harness'
+
+/**
+ * An asm copy, end to end through the app (Plan 7 part 5 spec §7): *edit a copy* in the asm view's `⋯` menu, the copy's
+ * editor in the view, a rebuild from what is typed, the language server's marks and outline and format on it, and a
+ * copy's rows linking nothing. Every gesture a user makes with the pointer is made with `userEvent`, which moves the
+ * browser's pointer, rather than `.click()` — 4b's lesson: a synthetic click passed where a real one was lost.
+ *
+ * ONE MOUNT FOR THE FILE, for the reason every sibling gives: `main()` runs once per page.
+ */
+
+const SAMPLE = 'let x = 40; x + 2'
+/** `SAMPLE`'s asm, as `Session.asmText` prints it: headed by its type, one instruction a line. */
+const SAMPLE_ASM = 'result Nat\n\n    li\tr0, #40\n    mov\tr1, r0\n    li\tr2, #2\n    add\trr, r1, r2\n    halt\n'
+
+let view: EditorView
+
+const host = (leaf: string) => document.querySelector<HTMLElement>(`.pane[data-leaf="${leaf}"]`) as HTMLElement
+const asm = () => host('asm-0')
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const editorOf = (pane: HTMLElement): EditorView | null => {
+  const el = pane.querySelector<HTMLElement>('.term-editor')
+  return el === null ? null : EditorView.findFromDOM(el)
+}
+const editorText = () => editorOf(asm())?.state.doc.toString() ?? null
+const type = (text: string) => {
+  const v = editorOf(asm())
+  if (v === null) throw new Error('no editor in the asm view')
+  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
+}
+const pcs = () => [...asm().querySelectorAll<HTMLElement>('.asm-row .asm-pc')].map((e) => e.textContent)
+const value = () => asm().querySelector('.asm-value')?.textContent ?? ''
+const notice = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const sourceLinked = () => document.querySelector('.cm-editor .linked')?.textContent ?? null
+const menuOf = (pane: HTMLElement): HTMLElement => {
+  const more = pane.querySelector<HTMLButtonElement>('button.view-more')
+  const menu = document.getElementById(more?.getAttribute('aria-controls') ?? '')
+  if (more === null || menu === null) throw new Error('no view menu')
+  return menu
+}
+const menuItem = (pane: HTMLElement, cls: string) => menuOf(pane).querySelector<HTMLButtonElement>(`button.${cls}`)
+
+/** Open `pane`'s `⋯` menu with the pointer and pick `cls`'s item with it, as a user does. */
+async function pick(pane: HTMLElement, cls: string): Promise<void> {
+  await userEvent.click(pane.querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement)
+  await until(() => menuOf(pane).matches(':popover-open'), 'the view menu to open')
+  const item = menuItem(pane, cls)
+  if (item === null) throw new Error(`the menu offers no ${cls}`)
+  await userEvent.click(item)
+}
+
+async function compile(src: string): Promise<void> {
+  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
+  await until(() => !idle(), 'the compile to start')
+  await until(idle, 'the compile to finish')
+}
+
+beforeAll(async () => {
+  await page.viewport(1280, 1600)
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  await compile(SAMPLE)
+  await until(() => pcs().length === 5, 'the program’s listing')
+})
+
+describe('an asm copy', () => {
+  it('is made from the asm view’s menu, holds the whole program, and is what the view then shows', async () => {
+    const item = menuItem(asm(), 'detach')
+    expect(item?.disabled).toBe(false)
+    expect(item?.querySelector('.view-menu-hint')?.textContent).toBe('the whole program')
+    expect(asm().querySelector('.term-editor')).toBeNull()
+
+    await pick(asm(), 'detach')
+
+    await until(() => editorText() !== null, 'the copy’s editor to mount')
+    expect(editorText()).toBe(SAMPLE_ASM)
+    expect(notice()).toBe('asm copy 1 created — this view shows it')
+    expect(asm().textContent).toMatch(/copy · not linked/)
+    await until(() => value() === 'value: 42', 'the copy’s value')
+    expect(pcs()).toEqual(['pc0', 'pc1', 'pc2', 'pc3', 'pc4'])
+    // A COPY OFFERS NO COPY OF ITSELF, AND A VIEW WITH AN EDITOR OFFERS FORMAT.
+    expect(menuItem(asm(), 'detach')).toBeNull()
+    expect(menuItem(asm(), 'format-doc')?.hidden ?? true).toBe(false)
+  })
+
+  it('rebuilds from what is typed into it', async () => {
+    type('result Nat\n\n    li\trr, #7\n    halt\n')
+    await until(() => value() === 'value: 7', 'the rebuilt copy’s value')
+    expect(pcs()).toEqual(['pc0', 'pc1'])
+  })
+
+  it('marks a label that names nothing where it is written, keeps its last run, and says nothing else', async () => {
+    const before = notice()
+    type('result Nat\n\n    jmp\tnowhere\n')
+    await until(() => asm().querySelector('.cm-editor .cm-lintRange-error') !== null, 'the editor to mark the label')
+    expect(asm().querySelector('.cm-editor .cm-lintRange-error')?.textContent).toBe('nowhere')
+    expect(value()).toBe('value: 7')
+    expect(pcs()).toEqual(['pc0', 'pc1'])
+    expect(notice()).toBe(before)
+  })
+
+  it('lists its labels in its outline', async () => {
+    type('result Nat\n\nstart:\n    li\trr, #1\n    halt\n')
+    await until(() => value() === 'value: 1', 'the copy to build')
+    const outline = asm().querySelector<HTMLElement>('.panel[data-panel="outline"]') as HTMLElement
+    expect(outline.hidden).toBe(false)
+    await userEvent.click(outline.querySelector<HTMLButtonElement>('.panel-toggle') as HTMLButtonElement)
+    await until(() => (outline.querySelector('.outline')?.textContent ?? '').includes('start'), 'the outline')
+  })
+
+  it('answers a hover on a label, from the language server part 3 built', async () => {
+    const v = editorOf(asm()) as EditorView
+    const at = v.state.doc.toString().indexOf('start')
+    expect(at).toBeGreaterThan(0)
+    v.dispatch({ selection: { anchor: at } })
+    v.focus()
+    await until(() => v.hasFocus, 'the copy’s editor to take focus')
+    // F2 ASKS AT THE CARET, AS `lsp-hover.test.ts` DOES; the first press can land before the server has the text, so
+    // it is repeated until a tooltip opens.
+    const answer = () => v.dom.querySelector('.cm-hover-answer')?.textContent ?? null
+    for (let i = 0; i < 20 && answer() === null; i++) {
+      await userEvent.keyboard('{F2}')
+      await new Promise((r) => setTimeout(r, 300))
+    }
+    expect(answer()).toContain('label start')
+    await userEvent.keyboard('{ArrowRight}')
+    await until(() => answer() === null, 'the tooltip to close once the caret moves')
+  })
+
+  it('formats its text from the menu', async () => {
+    type('result Nat\nli rr,#3\nhalt\n')
+    await until(() => value() === 'value: 3', 'the copy to build')
+    await pick(asm(), 'format-doc')
+    await until(() => editorText() === 'result Nat\n\n    li\trr, #3\n    halt\n', 'the formatted text')
+  })
+
+  it('links nothing from a row', async () => {
+    expect(sourceLinked()).toBeNull()
+    await userEvent.click(asm().querySelector<HTMLElement>('.asm-row') as HTMLElement)
+    expect(sourceLinked()).toBeNull()
+    expect(asm().querySelector('.asm-row.is-linked')).toBeNull()
+  })
+
+  it('shows the program again, and offers a copy again, once the view is moved back to it', async () => {
+    const title = asm().querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
+    await userEvent.click(title)
+    const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
+    await userEvent.click(
+      menu.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('asm', 'source')}"]`) as HTMLElement,
+    )
+    await until(() => pcs().length === 5, 'the program’s listing')
+    expect(asm().querySelector('.term-editor')).toBeNull()
+    expect(value()).toBe('')
+    expect(menuItem(asm(), 'detach')?.disabled).toBe(false)
+  })
+})
+
+describe('asm copies and the views that show them', () => {
+  /** Pick `session`'s asm pair in `pane`'s title menu with the pointer. */
+  async function show(pane: HTMLElement, session: string): Promise<void> {
+    const title = pane.querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
+    await userEvent.click(title)
+    const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
+    await userEvent.click(
+      menu.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('asm', session)}"]`) as HTMLElement,
+    )
+  }
+
+  it('moves its editor with the view from one copy to another', async () => {
+    await pick(asm(), 'detach')
+    await until(() => editorText() === SAMPLE_ASM, 'a second copy’s editor')
+    await show(asm(), 'scratch-1')
+    await until(() => editorText() === 'result Nat\n\n    li\trr, #3\n    halt\n', 'the first copy’s text')
+    await until(() => value() === 'value: 3', 'the first copy’s value')
+  })
+
+  it('shows a view split from a copy its listing and its value, and leaves the editor where it was', async () => {
+    // THE SPLIT THROUGH THE MENU'S OWN BUTTONS, AS `layout-app.test.ts`'s `splitVia` MAKES IT: what is under test is
+    // the view the split builds, not the menu.
+    const more = asm().querySelector<HTMLButtonElement>('button.view-more') as HTMLButtonElement
+    more.click()
+    const menu = menuOf(asm())
+    menu.querySelector<HTMLButtonElement>('button.view-split[data-dir="row"]')?.click()
+    menu.querySelector<HTMLButtonElement>('.view-menu-pairs button[data-same]')?.click()
+    const other = () =>
+      [...document.querySelectorAll<HTMLElement>('.pane[data-kind="asm"]')].find((e) => e.dataset.leaf !== 'asm-0')
+    await until(() => other() !== undefined, 'the split view')
+    const split = other() as HTMLElement
+    await until(() => split.querySelector('.asm-value')?.textContent === 'value: 3', 'the split view’s value')
+    expect(split.querySelectorAll('.asm-row .asm-pc').length).toBe(2)
+    expect(split.querySelector('.term-editor')).toBeNull()
+    expect(editorText()).not.toBeNull()
+  })
+
+  it('sends every view on a copy back to the program when the copy is paused', async () => {
+    const button = document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement
+    await userEvent.click(button)
+    const pause = await (async () => {
+      await until(() => document.querySelector('button[aria-label="pause asm copy 1"]') !== null, 'the copy’s row')
+      return document.querySelector<HTMLButtonElement>('button[aria-label="pause asm copy 1"]') as HTMLButtonElement
+    })()
+    await userEvent.click(pause)
+    const views = [...document.querySelectorAll<HTMLElement>('.pane[data-kind="asm"]')]
+    expect(views.length).toBe(2)
+    for (const v of views) {
+      await until(() => v.querySelectorAll('.asm-row .asm-pc').length === 5, `${v.dataset.leaf} to show the program`)
+      expect(v.querySelector('.asm-value')?.textContent).toBe('')
+      expect(v.querySelector('.term-editor')).toBeNull()
+    }
+    if (button.getAttribute('aria-expanded') === 'true') await userEvent.click(button)
+  })
+})
+
+describe('a TM copy', () => {
+  it('has its editor again in a view moved off it and back', async () => {
+    const tm = host('tm-0')
+    await until(() => tm.querySelectorAll('.state-row').length > 3, 'the program’s rules')
+    await pick(tm, 'detach')
+    await until(() => tm.querySelector('.cm-editor') !== null, 'the TM copy’s editor')
+    const copy = (tm.querySelector<HTMLButtonElement>('button.view-title')?.dataset.binding ?? '').split('\x00')
+    const pickPair = async (key: string) => {
+      const title = tm.querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
+      await userEvent.click(title)
+      const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
+      await userEvent.click(menu.querySelector<HTMLButtonElement>(`button[data-binding="${key}"]`) as HTMLElement)
+    }
+    const copyKey = tm.querySelector<HTMLButtonElement>('button.view-title')?.dataset.binding ?? ''
+    expect(copy.length).toBeGreaterThan(0)
+    await pickPair(bindingKey('tm', 'source'))
+    await until(() => tm.querySelector('.cm-editor') === null, 'the program, with no editor')
+    await pickPair(copyKey)
+    await until(() => tm.querySelector('.cm-editor') !== null, 'the copy’s editor, again')
+  })
+
+  it('links nothing from a state row either', async () => {
+    const tm = host('tm-0')
+    await until(() => /copy · not linked/.test(tm.textContent ?? ''), 'the TM view to show the copy')
+    await until(() => tm.querySelectorAll('.state-row').length > 3, 'the copy’s rules')
+    // THE ROW `let x = 40`'s CONSTRUCT OWNS IN THE PROGRAM — measured on `main`, where a click on it in the copy pinned
+    // `40` in the source through the program's index.
+    await userEvent.click(tm.querySelectorAll<HTMLElement>('.state-row')[3] as HTMLElement)
+    expect(sourceLinked()).toBeNull()
+    expect(tm.querySelector('.state-row.is-linked')).toBeNull()
+  })
+})
+
+describe('where the asm leg declines', () => {
+  it('offers no copy', async () => {
+    await compile('fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)')
+    await until(() => pcs().length === 0, 'the listing to clear')
+    expect(menuItem(asm(), 'detach')).toBeNull()
+  })
+})
diff --git a/web/tests/browser/asm-pane.test.ts b/web/tests/browser/asm-pane.test.ts
index a80ca04..b646f84 100644
--- a/web/tests/browser/asm-pane.test.ts
+++ b/web/tests/browser/asm-pane.test.ts
@@ -397,3 +397,26 @@ describe('at the width of a real view', () => {
     expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth)
   })
 })
+
+describe('edit a copy', () => {
+  const item = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button.detach')
+
+  it('is offered for the program, disabled with a reason where its text is withheld, and absent with nothing to copy', () => {
+    const { host, pane } = mount(FACT3, events({ detachAsm: vi.fn() }))
+    pane.setForkAvailable('result Nat\n\n    halt\n', 21)
+    expect(item(host)?.disabled).toBe(false)
+    // A PROGRAM WHOSE TEXT WAS WITHHELD HAS NO TEXT TO POST, AND THE REFUSAL SAYS HOW LARGE IT IS.
+    pane.setForkAvailable(null, 300_000)
+    expect(item(host)?.disabled).toBe(true)
+    expect(item(host)?.getAttribute('aria-description')).toBe('300,000 instructions — too large to open in an editor')
+    pane.setForkAvailable(null, 0)
+    expect(item(host)).toBeNull()
+  })
+
+  it('is withdrawn from a view on a copy', () => {
+    const { host, pane } = mount(FACT3, events({ detachAsm: vi.fn() }))
+    pane.setForkAvailable('result Nat\n\n    halt\n', 21)
+    pane.setDetached(true)
+    expect(item(host)).toBeNull()
+  })
+})
diff --git a/web/tests/node/replies.test.ts b/web/tests/node/replies.test.ts
index a06fc9c..f00e408 100644
--- a/web/tests/node/replies.test.ts
+++ b/web/tests/node/replies.test.ts
@@ -333,6 +333,7 @@ function scratchDriver() {
     buffers,
     ports,
     replies,
+    panes,
     slot,
     gutter,
     notified: () => notified,
@@ -671,6 +672,23 @@ describe('an asm copy retains what its views were last told', () => {
     expect(reg.entryOf(id).asmScratch).toEqual({ status: STATUS, value: { Value: { text: '[1, 2, 3]' } } })
   })
 
+  it('tells every view on the copy the value a [continue] brings, and the null a dead worker leaves', () => {
+    const { buffers, reg, replies, panes } = scratchDriver()
+    const id = buffers.forkBlank('asm')
+    const told: unknown[] = []
+    panes.add({
+      id: 'asm-0',
+      kind: 'asm',
+      slot: new PaneSlot('asm', id),
+      pane: { setScratch: (r: unknown) => told.push(r) } as unknown as PaneEntry<'asm'>['pane'],
+      host: {} as HTMLElement,
+    })
+    reg.entryOf(id).asmScratch = { status: STATUS, value: 'Unfinished' }
+    replies.onScratchReply(id, { kind: 'asm-value', gen: 1, value: { Value: { text: '6' } } })
+    replies.onScratchReply(id, { kind: 'worker-error', gen: 1, message: 'boom' })
+    expect(told).toEqual([{ status: STATUS, value: { Value: { text: '6' } } }, null])
+  })
+
   it('forgets its reading when its worker throws', () => {
     const { buffers, reg, replies } = scratchDriver()
     const id = buffers.forkBlank('asm')
````


- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  1 failed | 20 passed (21)
```

Run: `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts tests/browser/asm-copy-restore.test.ts tests/browser/asm-pane.test.ts`

Expected: exit 1, printing:

```text
Test Files  3 failed (3)
Tests  16 failed | 25 passed (41)
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=4
diff --git a/web/src/asm-pane.ts b/web/src/asm-pane.ts
index 8d4a2a2..510b548 100644
--- a/web/src/asm-pane.ts
+++ b/web/src/asm-pane.ts
@@ -13,12 +13,18 @@ import {
   wordText,
 } from './asm-view'
 import type { ControlState } from './controls'
+import type { EditablePane } from './editor-custody'
+import { EDITOR_DEBOUNCE_MS } from './editor-debounce'
 import { n } from './format'
 import type { Dir } from './layout'
-import type { PaneChoice, PaneEvents, SplitChoices } from './pane-chrome'
+import { createOutlinePanel } from './outline'
+import { type PaneChoice, type PaneEvents, type SplitChoices, textPanel } from './pane-chrome'
 import { createPanel, type Panel } from './panel'
 import type { Leg } from './protocol'
-import type { Binding, PaneOption } from './sessions'
+import { endedLine } from './results'
+import type { ScratchEditorConfig } from './scratch-editor'
+import { ScratchEditor } from './scratch-editor'
+import type { AsmScratchReading, Binding, PaneOption } from './sessions'
 import { stepControls } from './step-controls'
 import type { AsmProgram, AsmState } from './types'
 import { type ViewHeader, type ViewMenu, viewHeader, viewMenu } from './view-header'
@@ -33,6 +39,7 @@ export type AsmPanels = {
   readonly registers?: boolean
   readonly stack?: boolean
   readonly heap?: boolean
+  readonly outline?: boolean
 }
 
 /**
@@ -50,10 +57,15 @@ export type AsmPanels = {
  * arguments, 8 frames, 16 cells and 16 boxes, set in `protocol.ts`), so a frame's panels are at most a few hundred short
  * lines however long the run.
  *
+ * **ON A COPY IT HOLDS THE COPY'S EDITOR, AS THE TM VIEW HOLDS A TM COPY'S** (spec amendment 28): the text panel first,
+ * then the copy's value, the panels above, and the outline — its labels — last. The listing stays: it is the only
+ * place the instruction about to run is marked, since a copy's editor marks no running line (spec §10).
+ *
  * `AsmPane` SATISFIES `PaneView<AsmState>`, as the λ and TM views satisfy theirs, with no `implements` clause —
- * `sessions.ts`'s `PaneView` doc says why the parameterisation is the check.
+ * `sessions.ts`'s `PaneView` doc says why the parameterisation is the check. It implements `EditablePane`, as
+ * `TmPane` does, so custody can move a copy's editor onto it.
  */
-export class AsmPane {
+export class AsmPane implements EditablePane {
   #header: ViewHeader
   #steps: ReturnType<typeof stepControls>
   #menu: ViewMenu
@@ -81,6 +93,32 @@ export class AsmPane {
   #heapPanel: Panel
   #heap: HTMLElement
   #heapCount: HTMLElement
+  /** The copy's editor's host, in the DOM from construction and classless until an editor mounts — `TmPane`'s rule. */
+  #editorHost: HTMLElement
+  /** The mounted `ScratchEditor`, or `null` on a view of the program — `TmPane.#editor`'s contract. */
+  #editor: ScratchEditor | null = null
+  #onEdit: ((src: string) => void) | undefined
+  #lspDocument: (() => ScratchEditorConfig['document']) | undefined
+  #colour: (() => ScratchEditorConfig['colour']) | undefined
+  #keymap: ScratchEditorConfig['keymap']
+  /** The text panel around `#editorHost` — the λ and TM views' control of the same name. */
+  #collapse: ReturnType<typeof textPanel>
+  /** This view's outline, present only while it holds a copy's editor: a copy's labels, as the server lists them. */
+  #outline: ReturnType<typeof createOutlinePanel>
+  /**
+   * A copy's value, `value: 42`, from the reading its build and any `[continue]` carried; empty on a view of the
+   * program, whose value the readout says. A `status` region, like `TmPane.#value`, though it changes per build, not
+   * per step.
+   */
+  #value: HTMLElement
+  /**
+   * The last `setForkAvailable` call's facts, kept so `#refreshDetach` re-derives the control whenever `#detached` moves
+   * — `TmPane`'s pair and for its reason: a fork rebinds this view onto the copy it made, and nothing calls
+   * `setForkAvailable` again to say the copy has nothing to fork.
+   */
+  #asmText: string | null = null
+  #instructions = 0
+  #detached = false
 
   /**
    * `panels` is the view's stored panel state, read once here; each panel reports every later toggle through
@@ -89,15 +127,28 @@ export class AsmPane {
   constructor(host: HTMLElement, on: PaneEvents, panels: AsmPanels = {}) {
     this.#header = viewHeader(on.rebind)
     this.#steps = stepControls(on)
-    // NO `format` AND NO `edit a copy`: a view showing a running leg has no document to format, and a copy of the asm is
-    // part 5c's. Removed, not disabled — the umbrella's rule for a control that cannot apply here.
+    this.#editorHost = document.createElement('div')
+    this.#editorHost.className = ''
+    this.#onEdit = on.editScratch
+    this.#lspDocument = on.lspDocument
+    this.#colour = on.colour
+    this.#keymap = on.keymap
+    this.#value = document.createElement('div')
+    this.#value.className = 'asm-value'
+    this.#value.setAttribute('role', 'status')
+    // *FORMAT* IS REMOVED WHERE THERE IS NO EDITOR, AND *EDIT A COPY* WHERE THERE IS NO HANDLER OR NOTHING TO COPY —
+    // `TmPane`'s menu, and its reasons: a control that cannot apply is removed (`#syncEditorControls`, `#refreshDetach`).
+    const detachAsm = on.detachAsm
     this.#menu = viewMenu(this.#header.actions, {
+      format: () => void this.#editor?.format(),
       ...(on.splitRow !== undefined && on.splitColumn !== undefined
         ? { split: (dir: Dir, c: PaneChoice) => (dir === 'row' ? on.splitRow?.(c) : on.splitColumn?.(c)) }
         : {}),
       ...(on.close !== undefined ? { close: on.close } : {}),
+      ...(detachAsm !== undefined ? { editCopy: { run: detachAsm, what: 'the whole program' } } : {}),
       choices: () => this.#choices,
     })
+    this.#collapse = textPanel(this.#editorHost, (collapsed) => on.collapse?.(collapsed))
 
     // ADDED AND REMOVED, NEVER DISABLED — the rule table's `follow current rule`, for the same reason: a re-attach does
     // something only while the listing has stopped following. The grid's `beforeDraw` keeps `hidden` in step.
@@ -184,11 +235,32 @@ export class AsmPane {
     machine.className = 'asm-machine'
     machine.append(this.#registersPanel.el, this.#stackPanel.el)
 
+    // A COPY'S OUTLINE IS ITS LABELS, as the server lists an `.asm` document's. Closed by default, as the TM view's is.
+    this.#outline = createOutlinePanel({
+      open: panels.outline ?? false,
+      onToggle: (open) => on.panel?.('outline', open),
+      symbols: async () => {
+        const doc = this.#lspDocument?.()
+        return doc === undefined ? [] : doc.client.documentSymbols(doc.uri)
+      },
+      reveal: (range) => this.#editor?.reveal(range),
+    })
+
+    // THE TEXT PANEL FIRST, THE OUTLINE LAST — the TM view's order (spec amendment 28). On a view of the program both
+    // start hidden and take no room, so this order is invisible until a copy's editor mounts.
     this.#body = document.createElement('div')
     this.#body.className = 'asm-pane'
-    this.#body.append(this.#listingPanel.el, machine, this.#heapPanel.el)
+    this.#body.append(
+      this.#collapse.el,
+      this.#value,
+      this.#listingPanel.el,
+      machine,
+      this.#heapPanel.el,
+      this.#outline.panel.el,
+    )
     this.#header.steps.append(this.#steps.el)
     host.replaceChildren(this.#header.el, this.#body)
+    this.#syncEditorControls()
   }
 
   /**
@@ -232,9 +304,118 @@ export class AsmPane {
     this.#focused = new Set(instrs)
   }
 
-  /** `copy · not linked`, in the title. The asm leg has no copies until part 5c, so today it is always `false`. */
+  /**
+   * `copy · not linked`, in the title. A view moved off a copy gives up its editor, whichever route moved it —
+   * `TmPane.setDetached`'s rule — and *edit a copy* follows `#detached` on the same call.
+   *
+   * **THE COPY'S VALUE IS NOT CLEARED HERE, WHERE `TmPane` CLEARS ITS SCRATCH READING AS A SECOND LINE.** Every route
+   * that moves a view onto a session seeds it through `seedAsm`, which sets the value that session has — none, for
+   * the program — so a clear here would repeat one no route can skip, and nothing could tell whether it ran.
+   */
   setDetached(detached: boolean): void {
+    this.#detached = detached
     this.#header.setDetached(detached)
+    if (!detached && this.#editor !== null) this.setEditor(null)
+    this.#refreshDetach()
+  }
+
+  /**
+   * Mount a copy's editor over the view seeded with `text`, or unmount it with `null` — `TmPane.setEditor`'s contract.
+   * `collapsed` seeds the mount and only the mount.
+   */
+  setEditor(text: string | null, collapsed = false): void {
+    if (text === null) {
+      this.#editor?.destroy()
+      this.#editor = null
+      this.#editorHost.className = ''
+      this.#collapse.update(false)
+      this.#syncEditorControls()
+      return
+    }
+    if (this.#editor === null) {
+      const onEdit = this.#onEdit
+      this.#editorHost.className = 'term-editor'
+      this.#editor = new ScratchEditor({
+        host: this.#editorHost,
+        initial: text,
+        debounceMs: EDITOR_DEBOUNCE_MS,
+        onEdit: (src) => onEdit?.(src),
+        onServerUpdate: () => this.#outline.refresh(),
+        document: this.#lspDocument?.(),
+        colour: this.#colour?.(),
+        keymap: this.#keymap,
+      })
+      this.#collapse.update(true, collapsed)
+      this.#syncEditorControls()
+      return
+    }
+    this.#editor.setText(text)
+  }
+
+  /** Detach the mounted editor without destroying it, for a caller about to remount it — `TmPane.takeEditor`'s contract. */
+  takeEditor(): ScratchEditor | null {
+    const editor = this.#editor
+    if (editor === null) return null
+    this.#editor = null
+    editor.dom.remove()
+    this.#editorHost.className = ''
+    this.#collapse.update(false)
+    this.#syncEditorControls()
+    return editor
+  }
+
+  /** Mount an editor another view gave up; its edits follow this view — `TmPane.receiveEditor`'s contract. */
+  receiveEditor(editor: ScratchEditor, collapsed = false): void {
+    if (this.#editor !== null) throw new Error('an asm view was handed a second editor while still holding one')
+    this.#editorHost.className = 'term-editor'
+    this.#editorHost.append(editor.dom)
+    const onEdit = this.#onEdit
+    editor.onEdit = (src) => onEdit?.(src)
+    this.#editor = editor
+    this.#collapse.update(true, collapsed)
+    this.#syncEditorControls()
+  }
+
+  holdsEditor(): boolean {
+    return this.#editor !== null
+  }
+
+  /** *format* and the outline go with the editor: a view of the program has no document to format or outline. */
+  #syncEditorControls(): void {
+    this.#menu.setFormattable(this.#editor !== null)
+    this.#outline.panel.el.hidden = this.#editor === null
+    if (this.#editor !== null) this.#outline.refresh()
+  }
+
+  /** An asm copy's value, or `null` to clear it — set by its build, a `[continue]`, and a seed from what its session kept. */
+  setScratch(reading: AsmScratchReading | null): void {
+    this.#value.textContent = reading === null ? '' : endedLine(reading.value)
+  }
+
+  /**
+   * Whether this view can offer *edit a copy*: `text` is the program's asm, or `null` when there is none to copy; and
+   * `instructions` is how many instructions the program has, which words a refusal.
+   */
+  setForkAvailable(text: string | null, instructions: number): void {
+    this.#asmText = text
+    this.#instructions = instructions
+    this.#refreshDetach()
+  }
+
+  /**
+   * Absent on a copy, and where there is no program; disabled with its reason where the program's text was withheld;
+   * ready otherwise — `TmPane.#refreshDetach`'s three answers.
+   */
+  #refreshDetach(): void {
+    if (this.#detached || (this.#asmText === null && this.#instructions === 0)) {
+      this.#menu.setCopy(null)
+      return
+    }
+    this.#menu.setCopy(
+      this.#asmText === null
+        ? { reason: `${n(this.#instructions)} instructions — too large to open in an editor` }
+        : 'ready',
+    )
   }
 
   /** The `steps` switch, per `PaneView.setStepsShown` — the view's header owns the slot. */
diff --git a/web/src/asm-seed.ts b/web/src/asm-seed.ts
new file mode 100644
index 0000000..0e4bc4a
--- /dev/null
+++ b/web/src/asm-seed.ts
@@ -0,0 +1,14 @@
+import type { AsmPane } from './asm-pane'
+import type { AsmCompiled, AsmScratchReading } from './sessions'
+
+/**
+ * Tell an asm view what its session keeps: the listing, whether it can be copied, and a copy's value — `tm-seed.ts`'s
+ * `seedTm` for the asm view, and for its reason. A view comes to show a session after the replies that told the
+ * others: by being built, by a pick, by a cool or a retire moving it, or by being shown after a compile it missed.
+ * Every such route tells it here, so none can leave one of the three facts out.
+ */
+export function seedAsm(pane: AsmPane, compiled: AsmCompiled | null, reading: AsmScratchReading | null): void {
+  pane.setProgram(compiled?.program ?? null)
+  pane.setForkAvailable(compiled?.asmText ?? null, compiled?.program.listing.length ?? 0)
+  pane.setScratch(reading)
+}
diff --git a/web/src/draw.ts b/web/src/draw.ts
index b01e4ed..61b9484 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -1,5 +1,6 @@
 import type { EditorView } from '@codemirror/view'
 import type { AsmPane } from './asm-pane'
+import { seedAsm } from './asm-seed'
 import { n } from './format'
 import { setFocus } from './highlight'
 import type { LambdaPane } from './lambda-pane'
@@ -213,12 +214,13 @@ export function createDraw(deps: {
         seedTm(tmPane, entry.tmProgram, entry.tmScratch)
         unseen.delete(tmPane)
       }
-      // AN ASM VIEW THAT MISSED ITS SESSION'S LISTING, by being off the page when it came, is seeded from what the
-      // session kept — `seedTm`'s arrangement above, for the one fact an asm view is told once per compile.
+      // AN ASM VIEW THAT MISSED WHAT ITS SESSION WAS TOLD, by being off the page when it came, is seeded from what the
+      // session kept — `seedTm`'s arrangement above, one leg over.
       const asmPane = p.slot.binding.leg === 'asm' ? (p.pane as AsmPane) : null
       const asmSeeded = asmPane !== null && unseen.has(asmPane)
       if (asmSeeded) {
-        asmPane.setProgram(sessions.entryOf(p.slot.binding.session).asmProgram?.program ?? null)
+        const entry = sessions.entryOf(p.slot.binding.session)
+        seedAsm(asmPane, entry.asmProgram, entry.asmScratch)
         unseen.delete(asmPane)
       }
       const leg = p.slot.resolve(sessions)
diff --git a/web/src/link-status.ts b/web/src/link-status.ts
index 2e540f3..837233e 100644
--- a/web/src/link-status.ts
+++ b/web/src/link-status.ts
@@ -216,8 +216,7 @@ function detachedText(d: DetachedPanes): string {
  * at this step" describes a term that is not on screen; a detached TM pane renders
  * states whose `source_node` is `null` by construction (§3.1), so neither the coincidence nor the
  * emits-no-states absence is a claim about anything the user is looking at. The asm leg's two clauses,
- * its coincidence and its emits-no-instructions absence, go by the asm flag the same way, though no asm
- * view shows a copy until Plan 7 part 5c.
+ * its coincidence and its emits-no-instructions absence, go by the asm flag the same way.
  *
  * SUPPRESSION IS UNIFORM ACROSS `LambdaLinkState` RATHER THAN TRIAGED PER MEMBER. `'declined'` is the
  * one that could be argued to survive — it is a property of the program's lowering, not of the pane —
diff --git a/web/src/link-wiring.ts b/web/src/link-wiring.ts
index 0ee6e8f..6fbf4fc 100644
--- a/web/src/link-wiring.ts
+++ b/web/src/link-wiring.ts
@@ -114,8 +114,8 @@ export function createLinkWiring(deps: {
         // here" clause are about one view.
         return panes.active('tm')?.slot
       case 'asm':
-        // `active`, AS FOR TM: the asm view `draw()`'s asm running focus reads. No asm view shows a copy until
-        // part 5c, so today its clause is always "linked".
+        // `active`, AS FOR TM: the asm view `draw()`'s asm running focus reads, so its copy clause and "the asm run is
+        // here" are about one view.
         return panes.active('asm')?.slot
       default:
         // `unhandled` BECAUSE THIS `switch` RETURNS A VALUE THAT MAY BE `undefined`, which is the one kind
diff --git a/web/src/lsp-protocol.ts b/web/src/lsp-protocol.ts
index fbaf0c7..299ca13 100644
--- a/web/src/lsp-protocol.ts
+++ b/web/src/lsp-protocol.ts
@@ -84,8 +84,8 @@ export const LANGUAGE_IDS = ['redextape', 'redextape_lambda', 'redextape_tm', 'r
 export type LanguageId = (typeof LANGUAGE_IDS)[number]
 
 /**
- * The language each kind of view's editor holds. An asm view has no editor until part 5c's asm copies, whose editor
- * takes `redextape_asm` from here (Plan 7 part 5 spec §5.5).
+ * The language each kind of view's editor holds. An asm view's is an asm copy's, which takes `redextape_asm` from here
+ * (Plan 7 part 5 spec §5.5, §7).
  *
  * **KEYED BY `PaneKind`, WHERE IT USED TO SPELL `'source' | 'lambda' | 'tm'` OUT.** The spelled union was a
  * second copy of `PaneKind` that nothing held to the first, so a new pane kind would have left this map
diff --git a/web/src/main.ts b/web/src/main.ts
index 963e545..c5cc847 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1102,6 +1102,7 @@ async function main(): Promise<EditorView> {
     tmProgramOf: (session: SessionId) => sessions.entryOf(session).tmProgram,
     tmScratchOf: (session: SessionId) => sessions.entryOf(session).tmScratch,
     asmProgramOf: (session: SessionId) => sessions.entryOf(session).asmProgram,
+    asmScratchOf: (session: SessionId) => sessions.entryOf(session).asmScratch,
     // THE SECOND SESSION QUESTION `pane-host.ts` ASKS, ANSWERED HERE FOR THE SAME REASON AS THE FIRST —
     // this file is where `ScratchBuffers` is, and that module takes a function from a `SessionId` to one
     // value rather than the class itself. `editorSeed` answers `null` for everything that is not a warm
diff --git a/web/src/pane-chrome.ts b/web/src/pane-chrome.ts
index b51d2e6..014d62c 100644
--- a/web/src/pane-chrome.ts
+++ b/web/src/pane-chrome.ts
@@ -190,6 +190,11 @@ export type PaneEvents = {
    * the handler reports.
    */
   detachMachine?(): void
+  /**
+   * Copy this view's asm PROGRAM into an asm copy — Plan 7 part 5 spec §7. `detachMachine`'s shape and for its reason:
+   * the seed is the program's whole text, which the session keeps, so the handler needs nothing from the view.
+   */
+  detachAsm?(): void
   /** A state row was clicked. Absent on panes that have no table. */
   linkState?: (stateId: number) => void
   /** An instruction row in the asm view's listing was clicked, or Enter pressed on it; `pc` is its index. */
diff --git a/web/src/pane-host.ts b/web/src/pane-host.ts
index 2605750..566d4c9 100644
--- a/web/src/pane-host.ts
+++ b/web/src/pane-host.ts
@@ -1,4 +1,5 @@
 import { AsmPane } from './asm-pane'
+import { seedAsm } from './asm-seed'
 import type { EditablePane, EditorCustody } from './editor-custody'
 import { LambdaPane } from './lambda-pane'
 import {
@@ -19,7 +20,14 @@ import type { LeafId, PaneCollection, PaneKind } from './panes'
 import type { Leg } from './protocol'
 import type { Detachable } from './scratch'
 import type { SessionId } from './session-client'
-import { type AsmCompiled, type Binding, PaneSlot, type TmCompiled, type TmScratchReading } from './sessions'
+import {
+  type AsmCompiled,
+  type AsmScratchReading,
+  type Binding,
+  PaneSlot,
+  type TmCompiled,
+  type TmScratchReading,
+} from './sessions'
 import { TmPane } from './tm-pane'
 import { seedTm } from './tm-seed'
 import { DEFAULT_DISPLAY, DEFAULT_TM_DISPLAY, type LambdaDisplay, type TmDisplay } from './workspace'
@@ -184,8 +192,9 @@ function holdsEditor(kind: PaneKind): boolean {
     case 'lambda':
       return true
     case 'asm':
-      // AN ASM VIEW HAS NO EDITOR UNTIL PART 5c'S ASM COPIES, which are the only thing it could edit.
-      return false
+      // AN ASM VIEW HOLDS AN ASM COPY'S EDITOR (Plan 7 part 5 spec, amendment 28), and comes to show a blank one only
+      // through this arm, as a TM view does — the TM arm below has what leaving it out cost that leg.
+      return true
     case 'tm':
       // **`'tm'` TOO, WHERE THE CHECK USED TO BE `'lambda'` ALONE — 5d-iv T10.** A `ScratchBuffers.forkBlank`'d
       // TM buffer binds no pane at mint, so the ONLY way a TM pane ever comes to show one is the same-leg
@@ -264,6 +273,8 @@ export function createPaneHost(deps: {
    * view built after the `compiled` reply that told the others has to be told from what the session kept.
    */
   asmProgramOf(session: SessionId): AsmCompiled | null
+  /** An asm copy's retained reading, or `null` for any other session — `tmScratchOf`'s twin for an asm view. */
+  asmScratchOf(session: SessionId): AsmScratchReading | null
   /**
    * The text and collapse flag a λ pane newly bound to `session` should mount its editor from, or
    * `null` when `session` is not a warm scratch buffer — `mountScratchEditor` below is the one caller.
@@ -311,6 +322,7 @@ export function createPaneHost(deps: {
     tmProgramOf,
     tmScratchOf,
     asmProgramOf,
+    asmScratchOf,
     scratchSeedOf,
   } = deps
 
@@ -406,7 +418,7 @@ export function createPaneHost(deps: {
    * session and an asm copy's both keep a listing — `compiled` and `asm-scratch-compiled` retain it.
    */
   const seedAsmPane = (pane: AsmPane, session: SessionId): void => {
-    pane.setProgram(asmProgramOf(session)?.program ?? null)
+    seedAsm(pane, asmProgramOf(session), asmScratchOf(session))
   }
 
   /**
@@ -692,6 +704,18 @@ export function createPaneHost(deps: {
             },
           }
         : {}),
+      ...(slot.binding.leg === 'asm'
+        ? {
+            // THE FIRST-MOUNT HALF OF `editorOwner` FOR AN ASM COPY — the TM wrapper above, one leg over, and for its
+            // reason: a refused fork leaves the binding where it was, and claims nothing.
+            detachAsm: () => {
+              const before = slot.binding.session
+              base.detachAsm?.()
+              const after = slot.binding.session
+              if (after !== before) custody.claim(after, id)
+            },
+          }
+        : {}),
       // **THE PICK, SPLIT BY ITS LEG — and the cross-leg arm is what makes a pane able to change what
       // it shows at all.** The selector offers `pairs()`, every `(leg, session)` pair in the registry,
       // to every pane (`PaneSlot.render`), so a pick can name the leg this pane does not render. The
@@ -794,7 +818,16 @@ export function createPaneHost(deps: {
               : null
           if (moved !== null) {
             const held = moved.takeEditor()
-            if (held !== null) custody.hold(leaving, held)
+            // **HELD ONLY WHERE A VIEW CAN CLAIM IT BACK.** A λ view offers `move the editor here`, which is what
+            // custody's held editors wait for. A TM or asm view offers no such control, so an editor held from one
+            // waited in a map nothing reads, and — since `mountScratchEditor` mounts nothing while custody has an
+            // editor for the session — a view moved off a copy and back found no editor, for good: on `main`, a TM
+            // view taken to the program and back to its copy. Destroyed, as the drop pass destroys a closed TM or asm
+            // view's; the next view to show the copy mounts a fresh editor from its text of record.
+            if (held !== null) {
+              if (entry?.kind === 'lambda') custody.hold(leaving, held)
+              else held.destroy()
+            }
           }
           // **A TM OR ASM PANE IS RESEEDED FROM THE SESSION IT MOVES ONTO** — a TM pane whether or not it held the
           // editor, which `seedTmPane`'s doc has the finding for, and an asm pane for `seedAsmPane`'s twin reason.
@@ -1022,7 +1055,8 @@ export function createPaneHost(deps: {
           ;(p.pane as TmPane).takeEditor()?.destroy()
           break
         case 'asm':
-          // NOTHING TO HAND OVER: an asm view holds no editor (`holdsEditor`'s own arm).
+          // DESTROYED, NOT HELD, FOR THE TM ARM'S REASON: an asm view offers no `move the editor here` either.
+          ;(p.pane as AsmPane).takeEditor()?.destroy()
           break
         default:
           unhandled(p.slot.binding.leg)
@@ -1199,11 +1233,13 @@ export function createPaneHost(deps: {
           const registers = panelOpen(l.id, 'registers')
           const stack = panelOpen(l.id, 'stack')
           const heap = panelOpen(l.id, 'heap')
+          const outline = panelOpen(l.id, 'outline')
           const pane = new AsmPane(host, paneEvents(l.id, slot), {
             ...(listing === undefined ? {} : { listing }),
             ...(registers === undefined ? {} : { registers }),
             ...(stack === undefined ? {} : { stack }),
             ...(heap === undefined ? {} : { heap }),
+            ...(outline === undefined ? {} : { outline }),
           })
           // SEEDED FROM ITS SESSION, for the TM arm's reason just above: the `compiled` reply that told the other
           // asm views has already been and gone for a view built by a split, a pick or `reset preset`.
@@ -1337,8 +1373,7 @@ export function createPaneHost(deps: {
               seedTmPane(p.pane as unknown as TmPane, session)
               break
             case 'asm':
-              // NOTHING TO SEED YET: cool and retire move views off a copy, and no asm view shows a copy until part
-              // 5c's asm copies.
+              seedAsmPane(p.pane as unknown as AsmPane, session)
               break
             default:
               unhandled(p.kind)
@@ -1361,7 +1396,7 @@ export function createPaneHost(deps: {
             seedTmPane(p.pane as unknown as TmPane, to)
             break
           case 'asm':
-            // NOTHING TO SEED YET: the views a delete moved showed a copy, and no asm view shows one until part 5c.
+            seedAsmPane(p.pane as unknown as AsmPane, to)
             break
           default:
             unhandled(p.kind)
diff --git a/web/src/replies.ts b/web/src/replies.ts
index c4ba539..895447e 100644
--- a/web/src/replies.ts
+++ b/web/src/replies.ts
@@ -1,5 +1,6 @@
 import type { EditorView } from '@codemirror/view'
 import type { AsmPane } from './asm-pane'
+import { seedAsm } from './asm-seed'
 import type { EditablePane } from './editor-custody'
 import { setDecline, setLink } from './highlight'
 import type { LambdaTrees } from './lambda-trees'
@@ -205,14 +206,17 @@ export function createReplies(deps: {
    * shown. One call, so the entry always agrees with what the views were told.
    */
   const setAsmProgram = (session: SessionId, compiled: AsmCompiled | null): void => {
-    sessions.entryOf(session).asmProgram = compiled
+    const entry = sessions.entryOf(session)
+    entry.asmProgram = compiled
     for (const p of panes.ofSession('asm', session)) {
       const pane = p.pane as AsmPane
       if (!p.host.isConnected) {
         unseen.add(pane)
         continue
       }
-      pane.setProgram(compiled?.program ?? null)
+      // EVERYTHING THE SESSION KEEPS, THROUGH THE ONE SEED A VIEW BUILT LATER GETS: the listing, whether it can be
+      // copied, and a copy's value, which its build reply writes on the entry before this runs.
+      seedAsm(pane, compiled, entry.asmScratch)
     }
   }
 
@@ -533,6 +537,10 @@ export function createReplies(deps: {
         resetLegs(sessions.entryOf(session).legs, { asm: reply.asm })
         sessions.entryOf(session).asmScratch = { status: reply.asm, value: reply.value }
         setAsmProgram(session, { program: reply.asmProgram, asmText: null })
+        // THE EDITOR FROM THE BUFFER'S OWN TEXT OF RECORD, as `tm-scratch-compiled`'s arm mounts a TM copy's, and for
+        // its reason: a fork and an edit both write the text before posting the build.
+        const asmSeed = scratchpad.editorSeed(session)
+        if (asmSeed !== null) editorHome(session)?.setEditor(asmSeed.text, asmSeed.collapsed)
         // INTO STORAGE UNCONDITIONALLY, for the reason `tm-scratch-compiled`'s arm gives: every arrival here follows an
         // edit or a fork that has already written the buffer's text.
         onBuffersPersist()
@@ -544,6 +552,7 @@ export function createReplies(deps: {
         // replaces; a reading with no build before it cannot happen, for `tm-value`'s reason.
         const entry = sessions.entryOf(session)
         if (entry.asmScratch !== null) entry.asmScratch = { ...entry.asmScratch, value: reply.value }
+        for (const p of panes.ofSession('asm', session)) (p.pane as AsmPane).setScratch(entry.asmScratch)
         draw()
         return
       }
@@ -693,6 +702,7 @@ export function createReplies(deps: {
         // reduced-files slice.
         sessions.entryOf(session).tmScratch = null
         sessions.entryOf(session).asmScratch = null
+        for (const p of panes.ofSession('asm', session)) (p.pane as AsmPane).setScratch(null)
         for (const p of panes.ofSession('tm', session)) {
           const pane = p.pane as TmPane
           pane.setScratchStatus(null)
diff --git a/web/src/results.ts b/web/src/results.ts
index 19fda36..9f369b2 100644
--- a/web/src/results.ts
+++ b/web/src/results.ts
@@ -1,6 +1,6 @@
 import { n } from './format'
 import type { AsmLeg, LambdaLeg, TmLeg } from './protocol'
-import type { AsmCap, Diagnostic, RunStatus, ValueReading } from './types'
+import type { AsmCap, Decoded, Diagnostic, RunStatus, ValueReading } from './types'
 import { decodedText } from './types'
 
 export type Row = { leg: string; label: string; value: string; note?: string }
@@ -149,6 +149,14 @@ export function valueLine(reading: ValueReading | null): string | null {
   if (reading === null) return null
   const { run, value } = reading
   if (run.run === 'Running') return `value: running · ${n(run.steps)} of ${n(run.cap)} steps`
+  return endedLine(value)
+}
+
+/**
+ * The line an ended run's value shows, by `valueLine`'s rule: a real value takes the `value: ` prefix, and every other
+ * ending already says what it is. An asm copy's value line is this, since its value arrives ended, with its build.
+ */
+export function endedLine(value: Decoded): string {
   if (typeof value === 'object' && 'Value' in value) return `value: ${value.Value.text}`
   return decodedText(value)
 }
diff --git a/web/src/style.css b/web/src/style.css
index 4f613cb..b8fdfb4 100644
--- a/web/src/style.css
+++ b/web/src/style.css
@@ -737,7 +737,8 @@ button.view-title[aria-expanded="true"] {
 }
 
 .tm-status,
-.tm-value {
+.tm-value,
+.asm-value {
   font-family: var(--font-mono);
   font-size: var(--step--1);
   color: var(--fg-dim);
@@ -751,7 +752,8 @@ button.view-title[aria-expanded="true"] {
    NOT LOAD-BEARING IN TODAY'S LAYOUT, MEASURED. `.tm-pane` is a block box, so an empty line's margin collapses into
    `.tm-status`'s: in Chromium the status-to-tapes gap measured 8 px with this rule, 8 px without it, and 8 px with the
    line at `display: none`. `tm-pane-editor.test.ts` holds the gap itself, not the rule. */
-.tm-value:empty {
+.tm-value:empty,
+.asm-value:empty {
   margin-bottom: 0;
 }
 
@@ -1970,7 +1972,8 @@ main {
 /* THE ASM VIEW (Plan 7 part 5 spec §6.1): the TM view's mechanism, with its own shares. The listing takes two, the
    registers and call stack one between them, side by side, and the heap one; a closed panel keeps only its header, and
    each body keeps a floor of five rows. `.asm-machine` is the row the registers and the call stack share: it wraps, so
-   the two stack when the view is too narrow for both, and it takes no share of its own while both are closed. */
+   the two stack when the view is too narrow for both, and it takes no share of its own while both are closed. On a
+   copy the text panel keeps its own height above them all and the outline takes one share below, as in a TM view. */
 .pane[data-kind="asm"] {
   display: flex;
   flex-direction: column;
@@ -1983,7 +1986,12 @@ main {
 .asm-pane > * {
   flex: none;
 }
-.asm-pane > .panel[data-open="true"],
+/* NAMED, NOT EVERY OPEN PANEL: the text panel keeps its own height, and both it and the outline are `hidden` on a view of
+   the program — a `display` here would outrank the browser's `[hidden]` and show them, the trap `hidden.test.ts` found
+   in the TM view. */
+.asm-pane > .panel[data-panel="listing"][data-open="true"],
+.asm-pane > .panel[data-panel="heap"][data-open="true"],
+.asm-pane > .panel[data-panel="outline"][data-open="true"]:not([hidden]),
 .asm-machine > .panel[data-open="true"] {
   display: flex;
   flex-direction: column;
@@ -1992,9 +2000,15 @@ main {
   flex: 2 1 0;
 }
 .asm-pane > .panel[data-panel="heap"][data-open="true"],
+.asm-pane > .panel[data-panel="outline"][data-open="true"],
 .asm-pane > .asm-machine:has(> .panel[data-open="true"]) {
   flex: 1 1 0;
 }
+.asm-pane > .panel[data-open="true"] > .outline {
+  flex: 1 1 0;
+  max-height: none;
+  min-height: 5lh;
+}
 .asm-machine {
   display: flex;
   flex-wrap: wrap;
diff --git a/web/src/transport.ts b/web/src/transport.ts
index a605b81..1d0f720 100644
--- a/web/src/transport.ts
+++ b/web/src/transport.ts
@@ -458,13 +458,38 @@ export function createTransport(deps: {
     // decided from it at construction cannot go stale the way one decided from its session would.
     // THE ASM VIEW'S ROWS LINK THE SAME WAY, BY THE INSTRUCTION'S OWNER (Plan 7 part 5 spec §6.6) — an instruction
     // `defunc` minted has none, and `setLinkTo` says so on the status line rather than leaving it blank.
+    //
+    // **A ROW IN A COPY LINKS NOTHING AND SAYS NOTHING** (spec amendment 28), in either view that numbers its rows by
+    // the machine it shows. The link index describes the PROGRAM, so an instruction or state index read in a copy names
+    // whatever the program has at that index: an unedited copy lined up with the program and pinned its constructs,
+    // and an edited one pinned whatever the program happened to have there. `detached` is the session's own fact,
+    // read at click time since the view's binding moves.
     ...(slot.binding.leg === 'asm'
       ? {
           linkInstr: (pc: number) => {
             const wiring = linkWiring()
             if (!wiring.linkable || wiring.index === null) return
+            if (sessions.entryOf(slot.binding.session).detached) return
             wiring.setLinkTo(wiring.index.nodeForInstr(pc), 'asm')
           },
+          detachAsm: () => {
+            // `detachMachine`'s handler below, for an asm copy: the program's text, `null` only where the control is
+            // withdrawn or disabled (`AsmPane.#refreshDetach`), so reaching here with none is a wiring bug.
+            const text = sessions.entryOf(slot.binding.session).asmProgram?.asmText ?? null
+            if (text === null) throw new Error('detachAsm reached with no asm text')
+            let id: SessionId
+            try {
+              id = scratchpad.fork(slot, text, 0, 'asm')
+            } catch (e) {
+              if (!(e instanceof BufferCapReached)) throw e
+              notify(e.message)
+              draw()
+              return
+            }
+            notify(`${scratchpad.nameOf(id) ?? 'a copy'} created — this view shows it`)
+            onBuffersChanged()
+            draw()
+          },
         }
       : {}),
     ...(slot.binding.leg === 'tm'
@@ -472,6 +497,7 @@ export function createTransport(deps: {
           linkState: (stateId: number) => {
             const wiring = linkWiring()
             if (!wiring.linkable || wiring.index === null) return
+            if (sessions.entryOf(slot.binding.session).detached) return
             wiring.setLinkTo(wiring.index.nodeForState(stateId), 'tm')
           },
           // THE MACHINE FORK — design §4.3, `detach`'s counterpart for this leg. **NO STEP TO RESOLVE,
````


- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  53 passed (53)
Tests  740 passed (740)
```

Run: `cd web && pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  111 passed (111)
Tests  737 passed (737)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 17 of 17 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | an asm view holds no editor — `pane-host.ts`: `// through this arm, as a TM view does — the TM arm below has what leaving it out cost that leg. ⏎       return true` → `// through this arm, as a TM view does — the TM arm below has what leaving it out cost that leg. ⏎       return false` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > asm copies and the views that show them > moves its editor with the view from one copy to another` |
| 2 | a copy made from the asm view is not claimed — `pane-host.ts`: `base.detachAsm?.() ⏎               const after = slot.binding.session ⏎               if (after !== before) custody.claim(after, id)` → `base.detachAsm?.() ⏎               const after = slot.binding.session ⏎               if (after === before) custody.claim(after, id)` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > an asm copy > answers a hover on a label, from the language server part 3 built`, `tests/browser/asm-copy.test.ts > an asm copy > formats its text from the menu`, `tests/browser/asm-copy.test.ts > an asm copy > is made from the asm view’s menu, holds the whole program, and is what the view then shows`, `tests/browser/asm-copy.test.ts > an asm copy > lists its labels in its outline`, `tests/browser/asm-copy.test.ts > an asm copy > marks a label that names nothing where it is written, keeps its last run, and says nothing else`, `tests/browser/asm-copy.test.ts > an asm copy > rebuilds from what is typed into it`, `tests/browser/asm-copy.test.ts > asm copies and the views that show them > moves its editor with the view from one copy to another`, `tests/browser/asm-copy.test.ts > asm copies and the views that show them > sends every view on a copy back to the program when the copy is paused`, and 2 more |
| 3 | an asm copy's build mounts no editor — `replies.ts`: `if (asmSeed !== null) editorHome(session)?.setEditor(asmSeed.text, asmSeed.collapsed)` → `if (asmSeed === null) editorHome(session)?.setEditor('', false)` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > an asm copy > answers a hover on a label, from the language server part 3 built`, `tests/browser/asm-copy.test.ts > an asm copy > formats its text from the menu`, `tests/browser/asm-copy.test.ts > an asm copy > is made from the asm view’s menu, holds the whole program, and is what the view then shows`, `tests/browser/asm-copy.test.ts > an asm copy > lists its labels in its outline`, `tests/browser/asm-copy.test.ts > an asm copy > marks a label that names nothing where it is written, keeps its last run, and says nothing else`, `tests/browser/asm-copy.test.ts > an asm copy > rebuilds from what is typed into it`, `tests/browser/asm-copy.test.ts > asm copies and the views that show them > moves its editor with the view from one copy to another`, `tests/browser/asm-copy.test.ts > asm copies and the views that show them > sends every view on a copy back to the program when the copy is paused`, and 2 more |
| 4 | the outline never shows — `asm-pane.ts`: `this.#outline.panel.el.hidden = this.#editor === null` → `this.#outline.panel.el.hidden = true` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > an asm copy > lists its labels in its outline` |
| 5 | edit a copy is never offered — `asm-pane.ts`: `if (this.#detached || (this.#asmText === null && this.#instructions === 0)) {` → `if (this.#detached || this.#asmText !== null || this.#instructions === 0) {` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > a TM copy > links nothing from a state row either`, `tests/browser/asm-copy.test.ts > an asm copy > answers a hover on a label, from the language server part 3 built`, `tests/browser/asm-copy.test.ts > an asm copy > formats its text from the menu`, `tests/browser/asm-copy.test.ts > an asm copy > is made from the asm view’s menu, holds the whole program, and is what the view then shows`, `tests/browser/asm-copy.test.ts > an asm copy > links nothing from a row`, `tests/browser/asm-copy.test.ts > an asm copy > lists its labels in its outline`, `tests/browser/asm-copy.test.ts > an asm copy > marks a label that names nothing where it is written, keeps its last run, and says nothing else`, `tests/browser/asm-copy.test.ts > an asm copy > rebuilds from what is typed into it`, and 4 more |
| 6 | a copy offers a copy of itself — `asm-pane.ts`: `if (this.#detached || (this.#asmText === null && this.#instructions === 0)) {` → `if (this.#asmText === null && this.#instructions === 0) {` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > an asm copy > is made from the asm view’s menu, holds the whole program, and is what the view then shows` |
| 7 | a view moved off a copy keeps its editor — `asm-pane.ts`: `if (!detached && this.#editor !== null) this.setEditor(null)` → `(deleted)` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > asm copies and the views that show them > sends every view on a copy back to the program when the copy is paused` |
| 8 | a seeded view is not told a copy's value — `asm-seed.ts`: `pane.setScratch(reading)` → `pane.setScratch(null)` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > an asm copy > formats its text from the menu`, `tests/browser/asm-copy.test.ts > an asm copy > is made from the asm view’s menu, holds the whole program, and is what the view then shows`, `tests/browser/asm-copy.test.ts > an asm copy > lists its labels in its outline`, `tests/browser/asm-copy.test.ts > an asm copy > marks a label that names nothing where it is written, keeps its last run, and says nothing else`, `tests/browser/asm-copy.test.ts > an asm copy > rebuilds from what is typed into it`, `tests/browser/asm-copy.test.ts > asm copies and the views that show them > moves its editor with the view from one copy to another`, `tests/browser/asm-copy.test.ts > asm copies and the views that show them > shows a view split from a copy its listing and its value, and leaves the editor where it was` |
| 9 | a seeded view is not told it can copy — `asm-seed.ts`: `pane.setForkAvailable(compiled?.asmText ?? null, compiled?.program.listing.length ?? 0)` → `(deleted)` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > a TM copy > links nothing from a state row either`, `tests/browser/asm-copy.test.ts > an asm copy > answers a hover on a label, from the language server part 3 built`, `tests/browser/asm-copy.test.ts > an asm copy > formats its text from the menu`, `tests/browser/asm-copy.test.ts > an asm copy > is made from the asm view’s menu, holds the whole program, and is what the view then shows`, `tests/browser/asm-copy.test.ts > an asm copy > links nothing from a row`, `tests/browser/asm-copy.test.ts > an asm copy > lists its labels in its outline`, `tests/browser/asm-copy.test.ts > an asm copy > marks a label that names nothing where it is written, keeps its last run, and says nothing else`, `tests/browser/asm-copy.test.ts > an asm copy > rebuilds from what is typed into it`, and 4 more |
| 10 | a row in an asm copy links through the program — `transport.ts`: `if (sessions.entryOf(slot.binding.session).detached) return ⏎             wiring.setLinkTo(wiring.index.nodeForInstr(pc), 'asm')` → `wiring.setLinkTo(wiring.index.nodeForInstr(pc), 'asm')` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > a TM copy > links nothing from a state row either`, `tests/browser/asm-copy.test.ts > an asm copy > links nothing from a row` |
| 11 | a state in a TM copy links through the program — `transport.ts`: `if (sessions.entryOf(slot.binding.session).detached) return ⏎             wiring.setLinkTo(wiring.index.nodeForState(stateId), 'tm')` → `wiring.setLinkTo(wiring.index.nodeForState(stateId), 'tm')` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > a TM copy > links nothing from a state row either` |
| 12 | a TM or asm view holds the editor it leaves — `pane-host.ts`: `if (entry?.kind === 'lambda') custody.hold(leaving, held) ⏎               else held.destroy()` → `custody.hold(leaving, held)` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > a TM copy > has its editor again in a view moved off it and back`, `tests/browser/asm-copy.test.ts > asm copies and the views that show them > moves its editor with the view from one copy to another` |
| 13 | a [continue]'s value reaches no view — `replies.ts`: `for (const p of panes.ofSession('asm', session)) (p.pane as AsmPane).setScratch(entry.asmScratch)` → `(deleted)` | `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts` | `tests/node/replies.test.ts > an asm copy retains what its views were last told > tells every view on the copy the value a [continue] brings, and the null a dead worker leaves` |
| 14 | a dead copy's views keep its value — `replies.ts`: `for (const p of panes.ofSession('asm', session)) (p.pane as AsmPane).setScratch(null)` → `(deleted)` | `cd web && pnpm exec vitest run --project node tests/node/replies.test.ts` | `tests/node/replies.test.ts > an asm copy retains what its views were last told > tells every view on the copy the value a [continue] brings, and the null a dead worker leaves` |
| 15 | the outline shows while hidden — `style.css`: `.asm-pane > .panel[data-panel="outline"][data-open="true"]:not([hidden]),` → `.asm-pane > .panel[data-panel="outline"][data-open="true"],` | `cd web && pnpm exec vitest run --project browser tests/browser/hidden.test.ts tests/browser/asm-copy.test.ts` | `tests/browser/hidden.test.ts > leaves nothing on screen that is hidden, through every panel and a copy of each view` |
| 16 | a withheld program reads as ready — `asm-pane.ts`: `` this.#asmText === null ⏎         ? { reason: `${n(this.#instructions)} instructions — too large to open in an editor` } ⏎         : 'ready', `` → `'ready',` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-pane.test.ts` | `tests/browser/asm-pane.test.ts > edit a copy > is offered for the program, disabled with a reason where its text is withheld, and absent with nothing to copy` |
| 17 | the copy's editor has no language server — `asm-pane.ts`: `document: this.#lspDocument?.(),` → `document: undefined,` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-copy.test.ts` | `tests/browser/asm-copy.test.ts > an asm copy > answers a hover on a label, from the language server part 3 built`, `tests/browser/asm-copy.test.ts > an asm copy > formats its text from the menu`, `tests/browser/asm-copy.test.ts > an asm copy > lists its labels in its outline`, `tests/browser/asm-copy.test.ts > an asm copy > marks a label that names nothing where it is written, keeps its last run, and says nothing else`, `tests/browser/asm-copy.test.ts > asm copies and the views that show them > moves its editor with the view from one copy to another` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
The asm view edits a copy of the program: *edit a copy* makes one, and the view holds its editor, value and outline

*Edit a copy* in the asm view's `⋯` menu forks the program's asm text
into an asm copy, which the view then shows as the TM view shows a TM
copy: the text panel first, in `redextape_asm`, so diagnostics — the
label marks included — format, outline and colour come from part 3;
the copy's value above the listing; and the outline of its labels
last. Every route that moves a view onto a session seeds it through
one `seedAsm`, and a view closed on a copy destroys its editor. A
copy made so survives a reload, on its leg, at version 2 (spec
amendment 23).

Two things this found on `main`, fixed for TM and asm together. A row
in a copy linked through the program's index, so a TM copy's state
rows pinned the program's constructs; a copy's rows now link nothing
(spec amendment 28). And a TM view moved off a copy and back had no
editor: the one it left was held for a claim control only λ views
offer. A TM or asm view now destroys the editor it leaves, and the
view that comes back mounts a fresh one from the copy's text.
````


---

### Task 5: A blank asm copy from the copies menu, an asm copy's line in the readout, and a step count of one in the singular

**Files:**
- Modify: `web/src/buffer-list.ts` (one *new … copy* control per leg in `BLANK_COPY`), `web/src/main.ts` (`forkBlank(leg)`), `web/src/readout.ts` (`asmCopyParts`, `asmCopySegments`), `web/src/draw.ts` (the asm copy's readout through them), `web/src/format.ts` (`counted`), `web/src/results.ts` (the step counts through it)
- Modify (tests): `web/tests/browser/tm-blank-buffer-cap.test.ts` — two comments cited `buffer-list.ts`'s `onNewTm`, which is `onNew` now
- Test: `web/tests/node/readout.test.ts`, `web/tests/node/results.test.ts`, `web/tests/browser/asm-blank-copy.test.ts`

**Interfaces:**
- Produces `format.ts`'s `counted(x: number, noun: 'reduction' | 'transition' | 'instruction'): string`; `readout.ts`'s `AsmCopyLeg`, `asmCopyParts(name, reading: AsmScratchReading | null, leg: AsmCopyLeg)` and `asmCopySegments(...)`; `bufferList`'s fifth argument becomes `onNew: (leg: Leg) => void`.

**THE COPIES MENU OFFERS A BLANK COPY ON EVERY LEG WHOSE COPY IS A WHOLE PROGRAM** — *new asm copy* and *new TM copy*, in `LEGS`' order — and `main.ts` mints it on the leg asked for. A blank copy is an empty program, which parses; its first fetch runs past its end until something is typed (amendment 28), and an asm view's title offers it as it offers any copy.

**AN ASM COPY'S READOUT LINE IS `readout.ts`'s**, beside λ's and TM's, where 5b built it inline in `draw.ts`: its name, its instructions, why its recording stopped if a cap stopped it, and its value as its view reads it. **A STEP COUNT OF ONE READS IN THE SINGULAR, FOR EVERY LEG** (amendment 29): the result rows and the three copy lines all wrote `${n} <plural>`, and `counted` says "1 instruction", "1 reduction", "1 transition".

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=5
diff --git a/web/tests/browser/asm-blank-copy.test.ts b/web/tests/browser/asm-blank-copy.test.ts
new file mode 100644
index 0000000..5314b45
--- /dev/null
+++ b/web/tests/browser/asm-blank-copy.test.ts
@@ -0,0 +1,80 @@
+import { EditorView } from '@codemirror/view'
+import { beforeAll, describe, expect, it } from 'vitest'
+import { page, userEvent } from 'vitest/browser'
+import { bindingKey } from '../../src/view-header'
+import { SHELL, until } from './harness'
+
+/**
+ * A blank asm copy (Plan 7 part 5 spec §7): *new asm copy* in the copies menu makes one no view shows, an asm view's
+ * title then offers it, and what is typed into it runs. Its readout line counts its steps in the singular for one
+ * (amendment 29) and reads a fault as a fault. ONE MOUNT FOR THE FILE, for the reason every sibling gives.
+ */
+
+let view: EditorView
+
+const asm = () => document.querySelector<HTMLElement>('.pane[data-leaf="asm-0"]') as HTMLElement
+const idle = () => document.querySelector<HTMLElement>('#results')?.dataset.state === 'idle'
+const editor = (): EditorView | null => {
+  const el = asm().querySelector<HTMLElement>('.term-editor')
+  return el === null ? null : EditorView.findFromDOM(el)
+}
+const type = (text: string) => {
+  const v = editor()
+  if (v === null) throw new Error('no editor in the asm view')
+  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } })
+}
+const value = () => asm().querySelector('.asm-value')?.textContent ?? ''
+const notice = () => document.querySelector('#notice .notice-text')?.textContent ?? ''
+const strip = () => document.querySelector('#results')?.textContent ?? ''
+
+beforeAll(async () => {
+  await page.viewport(1280, 1600)
+  document.body.innerHTML = SHELL
+  view = await (await import('../../src/main')).ready
+  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'let x = 40; x + 2' } })
+  await until(() => !idle(), 'the compile to start')
+  await until(idle, 'the compile to finish')
+})
+
+describe('a blank asm copy', () => {
+  it('is made from the copies menu, and shows in no view until one picks it', async () => {
+    const button = document.querySelector<HTMLButtonElement>('#buffers') as HTMLButtonElement
+    await userEvent.click(button)
+    const offered = [...document.querySelectorAll<HTMLButtonElement>('.buffer-list > button')].map((b) => b.textContent)
+    expect(offered).toEqual(['new asm copy', 'new TM copy'])
+    await userEvent.click(document.querySelector<HTMLButtonElement>('.buffer-list button.new-asm') as HTMLElement)
+    await until(() => notice() === 'asm copy 1 created', 'the notice')
+    expect(asm().textContent).not.toMatch(/copy · not linked/)
+
+    const title = asm().querySelector<HTMLButtonElement>('button.view-title') as HTMLButtonElement
+    await userEvent.click(title)
+    const menu = document.getElementById(title.getAttribute('aria-controls') ?? '') as HTMLElement
+    await userEvent.click(
+      menu.querySelector<HTMLButtonElement>(`button[data-binding="${bindingKey('asm', 'scratch-1')}"]`) as HTMLElement,
+    )
+    await until(() => editor() !== null, 'the blank copy’s editor')
+    expect(editor()?.state.doc.toString()).toBe('')
+    // AN EMPTY PROGRAM PARSES, AND ITS FIRST FETCH RUNS PAST ITS END (spec amendment 28).
+    await until(() => value() === 'fault: ran past end of program at pc0', 'the empty program’s fault')
+    expect(asm().querySelectorAll('.asm-row').length).toBe(0)
+  })
+
+  it('runs what is typed into it', async () => {
+    type('result Nat\n\n    li\trr, #7\n    halt\n')
+    await until(() => value() === 'value: 7', 'the typed program’s value')
+    expect(asm().querySelectorAll('.asm-row .asm-pc').length).toBe(2)
+  })
+
+  it('says its one instruction in the singular, and its value, in the strip', async () => {
+    type('result Nat\n\n    halt\n')
+    await until(() => value() === 'value: 0', 'the one-instruction program')
+    await userEvent.click(asm().querySelector<HTMLElement>('.asm-row') as HTMLElement)
+    await until(() => strip() === 'asm copy 1 · 1 instruction · value: 0', 'the copy’s strip')
+  })
+
+  it('reads a fault as a fault, in its view and in the strip', async () => {
+    type('result Nat\n\n    li\tr0, #0\n    head\trr, r0\n    halt\n')
+    await until(() => value() === 'fault: head of empty list at pc1', 'the fault')
+    await until(() => strip() === 'asm copy 1 · 1 instruction · fault: head of empty list at pc1', 'the strip')
+  })
+})
diff --git a/web/tests/browser/tm-blank-buffer-cap.test.ts b/web/tests/browser/tm-blank-buffer-cap.test.ts
index 435ea32..e3788b9 100644
--- a/web/tests/browser/tm-blank-buffer-cap.test.ts
+++ b/web/tests/browser/tm-blank-buffer-cap.test.ts
@@ -7,8 +7,8 @@ import { SHELL, until } from './harness'
  * **THE BLANK-BUFFER GESTURE'S OWN CAP REFUSAL, ON THE SURFACE A USER READS IT FROM** — the mirror
  * `scratch-cap.test.ts`'s own file doc says the fork gesture needed and the blank-buffer gesture did
  * not yet have. That file drives the `catch (e) { if (!(e instanceof BufferCapReached)) throw e; … }`
- * arm in `main.ts`'s fork handler past `MAX_WARM_BUFFERS`; the sibling arm in `buffer-list.ts`'s `onNewTm`
- * handler (the fifth argument `bufferList` is constructed with) is reached from `ScratchBuffers.
+ * arm in `main.ts`'s fork handler past `MAX_WARM_BUFFERS`; the sibling arm in the `onNew`
+ * handler `bufferList` is constructed with, its fifth argument, is reached from `ScratchBuffers.
  * forkBlank` instead of `fork`, and nothing before this file drove it — the four lines inside it
  * (`if (!(e instanceof BufferCapReached)) throw e`, `linkWiring.setForkFailed(e.message)`, `draw()`,
  * `return`) had zero coverage.
@@ -96,7 +96,7 @@ describe('the buffer cap, from the blank-buffer control that hits it', () => {
       expect(buffersButton()?.textContent).toBe(`copies ${n} ▾`)
     }
 
-    // STAGE 2 — THE REFUSAL, AND IT IS ON SCREEN. Before `buffer-list.ts`'s `onNewTm` catch arm existed to
+    // STAGE 2 — THE REFUSAL, AND IT IS ON SCREEN. Before the `onNew` handler's catch arm existed to
     // render it, this would have thrown out of a click handler (`ScratchBuffers.forkBlank`'s own
     // `#refuseAtCap`) with nothing on the notice line to show for it — the same failure mode
     // `scratch-cap.test.ts`'s file doc records for the fork gesture, reached through the other door.
diff --git a/web/tests/node/readout.test.ts b/web/tests/node/readout.test.ts
index 6eb72f5..d870711 100644
--- a/web/tests/node/readout.test.ts
+++ b/web/tests/node/readout.test.ts
@@ -1,5 +1,7 @@
 import { describe, expect, it } from 'vitest'
 import {
+  asmCopyParts,
+  asmCopySegments,
   copyRows,
   lambdaCopyParts,
   lambdaCopySegments,
@@ -87,6 +89,58 @@ describe('tmCopySegments', () => {
   })
 })
 
+describe('asmCopySegments', () => {
+  const STATUS = { available: true, reason: '', run: 'Ended' as const, cap: null, total_steps: 3 }
+  const leg = (newestStep: number, done: 'ended' | 'capped' | 'stack-full' | null) => ({
+    newestStep,
+    done,
+    status: { available: true, reason: '' },
+  })
+
+  it('names the copy, counts its instructions, and reads its value as its view does', () => {
+    const reading = { status: STATUS, value: { Value: { text: '7' } } }
+    expect(asmCopySegments('asm copy 1', reading, leg(3, 'ended'))).toEqual(['asm copy 1 · 3 instructions · value: 7'])
+  })
+
+  it('says a count of one in the singular', () => {
+    const reading = { status: STATUS, value: { Value: { text: '0' } } }
+    expect(asmCopySegments('asm copy 1', reading, leg(1, 'ended'))).toEqual(['asm copy 1 · 1 instruction · value: 0'])
+  })
+
+  it('says why the recording stopped, and a fault as a fault', () => {
+    const fault = { status: STATUS, value: { Fault: { message: 'head of empty list at pc1' } } }
+    expect(asmCopyParts('asm copy 1', fault, leg(2, 'ended'))).toEqual([
+      'asm copy 1',
+      '2 instructions',
+      'fault: head of empty list at pc1',
+    ])
+    const full = { status: STATUS, value: 'Unfinished' as const }
+    expect(asmCopyParts('asm copy 1', full, leg(9, 'stack-full'))).toEqual([
+      'asm copy 1',
+      '9 instructions',
+      'the call stack is full',
+      'not finished',
+    ])
+  })
+
+  it('says only that it is building before its build lands', () => {
+    const building = { newestStep: 0, done: null, status: { available: false, reason: 'building…' } }
+    expect(asmCopySegments('asm copy 1', null, building)).toEqual(['asm copy 1 · building…'])
+  })
+})
+
+describe('a count of one, in every copy line', () => {
+  it('reads "1 reduction" and "1 transition"', () => {
+    expect(
+      lambdaCopyParts('λ copy 1', { newestStep: 1, done: 'ended', status: { available: true, reason: '' } }),
+    ).toEqual(['λ copy 1', '1 reduction'])
+    expect(tmCopyParts('TM copy 1', null, { newestStep: 1, status: { available: true, reason: '' } })).toEqual([
+      'TM copy 1',
+      '1 transition',
+    ])
+  })
+})
+
 describe('programRows', () => {
   // §9: "Every row on its own line, the normal-form text included" — which is exactly what the strip
   // leaves out, and the one difference between the two readouts' content.
diff --git a/web/tests/node/results.test.ts b/web/tests/node/results.test.ts
index 99eb72f..bcd5026 100644
--- a/web/tests/node/results.test.ts
+++ b/web/tests/node/results.test.ts
@@ -228,6 +228,33 @@ describe('valueLine', () => {
   })
 })
 
+describe('resultRows — a step count of one is singular, on every leg', () => {
+  it('reads one reduction, one transition and one instruction', () => {
+    const rows = resultRows(
+      { ...lambdaOk, state: { ...okState, step: 1 } },
+      { ...asmOk, status: { ...asmOk.status, total_steps: 1 } },
+      { ...tmOk, status: { ...tmOk.status, total_steps: 1 } },
+    )
+    expect([
+      find(rows, 'λ', 'steps')?.value,
+      find(rows, 'asm', 'steps')?.value,
+      find(rows, 'TM', 'steps')?.value,
+    ]).toEqual(['1 reduction', '1 instruction', '1 transition'])
+  })
+
+  it('and in a count that stopped', () => {
+    const rows = resultRows(
+      lambdaOk,
+      { status: { ...asmOk.status, total_steps: 1 }, value: 'Unfinished' },
+      { status: { ...tmOk.status, total_steps: 1 }, value: 'Unfinished' },
+    )
+    expect([find(rows, 'asm', 'steps')?.value, find(rows, 'TM', 'steps')?.value]).toEqual([
+      'stopped after 1 instruction at a cap',
+      'stopped after 1 transition at a cap',
+    ])
+  })
+})
+
 describe('resultRows — the asm leg', () => {
   const asm = (over: Partial<AsmLeg['status']>, value: AsmLeg['value']): AsmLeg => ({
     status: { ...asmOk.status, ...over },
````


- [ ] **Step 2: Run them and see them fail.**

Run: `cd web && pnpm exec vitest run --project node tests/node/readout.test.ts tests/node/results.test.ts`

Expected: exit 1, printing:

```text
Test Files  2 failed (2)
Tests  7 failed | 39 passed (46)
```

Run: `cd web && pnpm exec vitest run --project browser tests/browser/asm-blank-copy.test.ts`

Expected: exit 1, printing:

```text
Test Files  1 failed (1)
Tests  4 failed (4)
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=5
diff --git a/web/src/buffer-list.ts b/web/src/buffer-list.ts
index 281bd39..77950cc 100644
--- a/web/src/buffer-list.ts
+++ b/web/src/buffer-list.ts
@@ -1,4 +1,4 @@
-import { LEG_NAME } from './legs'
+import { LEG_NAME, LEGS } from './legs'
 import type { Leg } from './protocol'
 import type { SessionId } from './session-client'
 
@@ -234,6 +234,9 @@ const bufferRow = (
   return { id: row.id, el, retire, temperature }
 }
 
+/** Which legs the menu offers a blank copy on: asm and TM (spec §7), whose copy's text is the whole program. */
+const BLANK_COPY: Readonly<Record<Leg, boolean>> = { lambda: false, asm: true, tm: true }
+
 /**
  * The header bar's buffer list — the only surface that can reach a buffer no pane is showing.
  *
@@ -302,7 +305,7 @@ export function bufferList(
   rows: () => readonly BufferRow[],
   onRetire: (id: SessionId) => void,
   onTemperature: (id: SessionId, warm: boolean) => void,
-  onNewTm: () => void,
+  onNew: (leg: Leg) => void,
 ): { update(count: number): void } {
   const id = `buffer-list-${listSeq++}`
   const menu = document.createElement('div')
@@ -327,9 +330,10 @@ export function bufferList(
    * item to move focus back onto it after the rebuild — see `handleTemperature`'s own doc for why
    * (5d-ii-d review round 2, Finding 1).
    *
-   * **THE *new TM copy* CONTROL IS BUILT HERE TOO, FIRST, AHEAD OF EVERY ROW — 5d-iv T10, design §4.7.**
-   * "GIVE ME SOMEWHERE TO PASTE A `.tm` FILE" is a different intention from *edit a copy*, which detaches a view
-   * onto a copy of what it was showing — there is no view to seed a TM copy FROM (`ScratchBuffers.
+   * **THE *new asm copy* AND *new TM copy* CONTROLS ARE BUILT HERE TOO, FIRST, AHEAD OF EVERY ROW — 5d-iv T10,
+   * design §4.7, and Plan 7 part 5 spec §7 for asm.** "GIVE ME SOMEWHERE TO PASTE A `.tm` FILE" is a different
+   * intention from *edit a copy*, which detaches a view onto a copy of what it was showing — there is no view to seed
+   * a blank copy FROM (`ScratchBuffers.
    * forkBlank`'s own doc), and above the cap that gesture is unavailable where this one never is. It
    * lives here rather than in the app header because this menu is where copies are managed, and it is
    * what makes the menu non-empty at zero — which is why `main.ts`'s `refreshBuffers` no longer hides the
@@ -344,16 +348,21 @@ export function bufferList(
     retire: HTMLButtonElement
     temperature: HTMLButtonElement
   }[] => {
-    const newTm = document.createElement('button')
-    newTm.type = 'button'
-    newTm.className = 'new-tm'
-    newTm.textContent = 'new TM copy'
-    newTm.addEventListener('click', () => {
-      menu.hidePopover()
-      onNewTm()
+    // ONE PER LEG A BLANK COPY CAN BE MADE ON, IN `LEGS`' ORDER — asm and TM, whose text is a whole program or machine.
+    // A blank λ copy would be a term with nothing in it, and a λ copy is always made from a step of the program.
+    const news = LEGS.filter((leg) => BLANK_COPY[leg]).map((leg) => {
+      const b = document.createElement('button')
+      b.type = 'button'
+      b.className = `new-${leg}`
+      b.textContent = `new ${LEG_NAME[leg]} copy`
+      b.addEventListener('click', () => {
+        menu.hidePopover()
+        onNew(leg)
+      })
+      return b
     })
     const items = rows().map((row) => bufferRow(row, handleDelete, handleTemperature))
-    menu.replaceChildren(newTm, ...items.map((i) => i.el))
+    menu.replaceChildren(...news, ...items.map((i) => i.el))
     return items
   }
 
diff --git a/web/src/draw.ts b/web/src/draw.ts
index 61b9484..1b7f470 100644
--- a/web/src/draw.ts
+++ b/web/src/draw.ts
@@ -1,7 +1,6 @@
 import type { EditorView } from '@codemirror/view'
 import type { AsmPane } from './asm-pane'
 import { seedAsm } from './asm-seed'
-import { n } from './format'
 import { setFocus } from './highlight'
 import type { LambdaPane } from './lambda-pane'
 import type { LambdaTrees } from './lambda-trees'
@@ -11,6 +10,8 @@ import type { LambdaLinkState } from './link-status'
 import type { LinkWiring } from './link-wiring'
 import { type LeafId, onPage, type PaneCollection } from './panes'
 import {
+  asmCopyParts,
+  asmCopySegments,
   copyRows,
   type Lines,
   lambdaCopyParts,
@@ -395,6 +396,7 @@ export function createDraw(deps: {
       // value built inside one of them is a value the other cannot see.
       const lambdaLeg = { newestStep: leg.hist.newestStep, done: leg.done, status: leg.status }
       const tmLeg = { newestStep: leg.hist.newestStep, status: leg.status }
+      const asmLeg = { newestStep: leg.hist.newestStep, done: leg.done, status: leg.status }
       const reading = sessions.entryOf(session).tmScratch
       switch (entry.slot.binding.leg) {
         case 'lambda':
@@ -410,9 +412,11 @@ export function createDraw(deps: {
           })
           break
         case 'asm': {
-          // AN ASM VIEW ON A COPY: whose, and how far.
-          const parts = [name, `${n(leg.hist.newestStep)} instructions`]
-          readout.show(null, { segments: () => [parts.join(' · ')], rows: () => copyRows(parts) })
+          const asmReading = sessions.entryOf(session).asmScratch
+          readout.show(null, {
+            segments: () => asmCopySegments(name, asmReading, asmLeg),
+            rows: () => copyRows(asmCopyParts(name, asmReading, asmLeg)),
+          })
           break
         }
         default:
diff --git a/web/src/format.ts b/web/src/format.ts
index 9b39ddc..4991283 100644
--- a/web/src/format.ts
+++ b/web/src/format.ts
@@ -5,3 +5,11 @@
  * three copies of the same one-liner is still three places a locale choice can drift.
  */
 export const n = (x: number): string => x.toLocaleString('en-US')
+
+/**
+ * A count and its noun, singular for one — `1 instruction`, `55 instructions` — grouped as `n` groups it (Plan 7 part 5
+ * spec, amendment 29). Every leg wrote its step count as `${n} <plural>`, so one step read "1 reductions", "1
+ * transitions" or "1 instructions"; the nouns here are the three legs' words for a step, whose plurals all add `s`.
+ */
+export const counted = (x: number, noun: 'reduction' | 'transition' | 'instruction'): string =>
+  `${n(x)} ${noun}${x === 1 ? '' : 's'}`
diff --git a/web/src/main.ts b/web/src/main.ts
index c5cc847..b5c96a1 100644
--- a/web/src/main.ts
+++ b/web/src/main.ts
@@ -1614,17 +1614,15 @@ async function main(): Promise<EditorView> {
           `${name} paused${shown === 0 ? '' : ` · ${shown === 1 ? '1 view now shows' : `${shown} views now show`} the program`}`,
         )
     },
-    () => {
+    (leg: Leg) => {
       /**
        * **THE SECOND GESTURE — 5d-iv design §4.7.** `ScratchBuffers.fork` detaches a pane onto a copy of
        * what it was showing, and is unavailable above the fork cap; `forkBlank` mints a warm, empty
        * buffer on `leg` with no view to seed from and binds no pane, and is always available — "give me
-       * somewhere to paste a `.tm` file" is a different intention from a fork, not the same door
-       * narrowed. `'tm'` IS THE ONLY LEG THIS BUTTON EVER MINTS: the menu's own control is `buffer-list.
-       * ts`'s *new TM copy*, built for the TM pane specifically because a λ buffer already has a seed
-       * — the source's own step-0 term, through `fork` — and a TM buffer does not (`ScratchBuffers.
-       * forkBlank`'s own doc: the TM pane renders a δ-table projected from a compiled program, never the
-       * machine source that produced one).
+       * somewhere to paste a `.tm` or `.asm` file" is a different intention from a fork, not the same door
+       * narrowed. `leg` IS TM OR ASM: the menu offers a blank copy on the legs whose copy is a whole machine or
+       * program (`buffer-list.ts`'s `BLANK_COPY`), and never on λ, whose copy is always made from a step of the
+       * program, through `fork`.
        *
        * `BufferCapReached`, NOT A BARE `catch` — the same standard the retire and temperature handlers
        * above hold themselves to. The other throws `forkBlank` can reach are `SessionRegistry.add`'s and
@@ -1633,7 +1631,7 @@ async function main(): Promise<EditorView> {
        */
       let id: SessionId
       try {
-        id = scratchpad.forkBlank('tm')
+        id = scratchpad.forkBlank(leg)
       } catch (e) {
         if (!(e instanceof BufferCapReached)) throw e
         notices.notify(e.message)
diff --git a/web/src/readout.ts b/web/src/readout.ts
index 4d04af4..071fb83 100644
--- a/web/src/readout.ts
+++ b/web/src/readout.ts
@@ -1,9 +1,9 @@
 import { showWorkerError } from './banner'
-import { n } from './format'
+import { counted, n } from './format'
 import { LEG_NAME, LEGS } from './legs'
 import type { AsmLeg, LambdaLeg, RecordEnd, TmLeg } from './protocol'
-import { noSessionRows, resultRows, valueLine } from './results'
-import type { TmScratchReading } from './sessions'
+import { endedLine, noSessionRows, resultRows, valueLine } from './results'
+import type { AsmScratchReading, TmScratchReading } from './sessions'
 import type { Diagnostic } from './types'
 import type { ReadoutSwitch } from './workspace'
 
@@ -76,7 +76,7 @@ export type LambdaCopyLeg = {
 export function lambdaCopyParts(name: string, leg: LambdaCopyLeg): string[] {
   if (!leg.status.available) return [name, leg.status.reason]
   const why = leg.done === null ? '' : STOPPED[leg.done]
-  return [name, `${n(leg.newestStep)} reductions`, ...(why === '' ? [] : [why])]
+  return [name, counted(leg.newestStep, 'reduction'), ...(why === '' ? [] : [why])]
 }
 
 export function lambdaCopySegments(name: string, leg: LambdaCopyLeg): string[] {
@@ -101,7 +101,7 @@ export type TmCopyLeg = {
 /** A TM copy's facts, one per element, by `lambdaCopyParts`' rule. */
 export function tmCopyParts(name: string, reading: TmScratchReading | null, leg: TmCopyLeg): string[] {
   if (!leg.status.available) return [name, leg.status.reason]
-  const parts = [name, `${n(leg.newestStep)} transitions`]
+  const parts = [name, counted(leg.newestStep, 'transition')]
   const value = valueLine(reading?.value ?? null)
   if (value !== null) parts.push(value)
   const reduction = reading?.status.reduction ?? null
@@ -113,6 +113,32 @@ export function tmCopySegments(name: string, reading: TmScratchReading | null, l
   return [tmCopyParts(name, reading, leg).join(' · ')]
 }
 
+/** What an asm copy's line reads of its leg: how far its recording has got, and whether it has a status yet. */
+export type AsmCopyLeg = {
+  readonly newestStep: number
+  readonly done: RecordEnd | null
+  readonly status: { readonly available: boolean; readonly reason: string }
+}
+
+/**
+ * An asm copy's facts, by `lambdaCopyParts`' rule: its name, how far its recording has got, why it stopped if a cap
+ * stopped it, and its value, which came with its build (spec amendment 26) and reads as its view's value line reads.
+ */
+export function asmCopyParts(name: string, reading: AsmScratchReading | null, leg: AsmCopyLeg): string[] {
+  if (!leg.status.available) return [name, leg.status.reason]
+  const why = leg.done === null ? '' : STOPPED[leg.done]
+  return [
+    name,
+    counted(leg.newestStep, 'instruction'),
+    ...(why === '' ? [] : [why]),
+    ...(reading === null ? [] : [endedLine(reading.value)]),
+  ]
+}
+
+export function asmCopySegments(name: string, reading: AsmScratchReading | null, leg: AsmCopyLeg): string[] {
+  return [asmCopyParts(name, reading, leg).join(' · ')]
+}
+
 /**
  * One line of the inspector: what it is, and what it says.
  *
diff --git a/web/src/results.ts b/web/src/results.ts
index 9f369b2..6a43136 100644
--- a/web/src/results.ts
+++ b/web/src/results.ts
@@ -1,4 +1,4 @@
-import { n } from './format'
+import { counted, n } from './format'
 import type { AsmLeg, LambdaLeg, TmLeg } from './protocol'
 import type { AsmCap, Decoded, Diagnostic, RunStatus, ValueReading } from './types'
 import { decodedText } from './types'
@@ -48,7 +48,7 @@ function lambdaRows(l: LambdaLeg): Row[] {
     if (l.state.cut === 'Bytes') row.note = '… truncated at 64 KiB'
     if (l.state.cut === 'Depth') row.note = '… too deep to show in full'
     rows.push(row)
-    rows.push({ leg: 'λ', label: 'steps', value: `${n(l.state.step)} reductions` })
+    rows.push({ leg: 'λ', label: 'steps', value: counted(l.state.step, 'reduction') })
   }
   const note = runNote(l.status.run)
   if (note) rows.push({ leg: 'λ', label: 'run', value: note })
@@ -76,8 +76,8 @@ function tmRows(t: TmLeg): Row[] {
       leg: 'TM',
       label: 'steps',
       value: finished
-        ? `${n(t.status.total_steps)} transitions`
-        : `stopped after ${n(t.status.total_steps)} transitions at a cap`,
+        ? counted(t.status.total_steps, 'transition')
+        : `stopped after ${counted(t.status.total_steps, 'transition')} at a cap`,
     })
   }
 
@@ -106,17 +106,17 @@ function asmRows(a: AsmLeg): Row[] {
   if (!a.status.available) return [{ leg: 'asm', label: 'declined', value: a.status.reason }]
   const rows: Row[] = []
   if (a.status.total_steps !== null) {
-    const steps = n(a.status.total_steps)
+    const steps = counted(a.status.total_steps, 'instruction')
     const finished = a.value !== null && a.value !== 'Unfinished'
     const cap = a.status.run === 'Capped' ? a.status.cap : null
     rows.push({
       leg: 'asm',
       label: 'steps',
       value: finished
-        ? `${steps} instructions`
+        ? steps
         : cap === null || cap === 'Steps'
-          ? `stopped after ${steps} instructions at a cap`
-          : `stopped after ${steps} instructions — ${FULL[cap]}`,
+          ? `stopped after ${steps} at a cap`
+          : `stopped after ${steps} — ${FULL[cap]}`,
     })
   }
   if (a.value) rows.push({ leg: 'asm', label: 'value', value: decodedText(a.value) })
````


- [ ] **Step 4: Run them and see them pass.**

Run: `cd web && pnpm exec vitest run --project node`

Expected: exit 0, printing:

```text
Test Files  53 passed (53)
Tests  747 passed (747)
```

Run: `cd web && pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  112 passed (112)
Tests  741 passed (741)
```

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 8 of 8 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | no blank asm copy is offered — `buffer-list.ts`: `{ lambda: false, asm: true, tm: true }` → `{ lambda: false, asm: false, tm: true }` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-blank-copy.test.ts` | `tests/browser/asm-blank-copy.test.ts > a blank asm copy > is made from the copies menu, and shows in no view until one picks it`, `tests/browser/asm-blank-copy.test.ts > a blank asm copy > reads a fault as a fault, in its view and in the strip`, `tests/browser/asm-blank-copy.test.ts > a blank asm copy > runs what is typed into it`, `tests/browser/asm-blank-copy.test.ts > a blank asm copy > says its one instruction in the singular, and its value, in the strip` |
| 2 | every blank copy is a TM copy — `main.ts`: `id = scratchpad.forkBlank(leg)` → `id = scratchpad.forkBlank('tm')` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-blank-copy.test.ts` | `tests/browser/asm-blank-copy.test.ts > a blank asm copy > is made from the copies menu, and shows in no view until one picks it`, `tests/browser/asm-blank-copy.test.ts > a blank asm copy > reads a fault as a fault, in its view and in the strip`, `tests/browser/asm-blank-copy.test.ts > a blank asm copy > runs what is typed into it`, `tests/browser/asm-blank-copy.test.ts > a blank asm copy > says its one instruction in the singular, and its value, in the strip` |
| 3 | a count of one is plural — `format.ts`: `${x === 1 ? '' : 's'}` → `s` | `cd web && pnpm exec vitest run --project node tests/node/readout.test.ts tests/node/results.test.ts` | `tests/node/readout.test.ts > a count of one, in every copy line > reads "1 reduction" and "1 transition"`, `tests/node/readout.test.ts > asmCopySegments > says a count of one in the singular`, `tests/node/results.test.ts > resultRows — a step count of one is singular, on every leg > and in a count that stopped`, `tests/node/results.test.ts > resultRows — a step count of one is singular, on every leg > reads one reduction, one transition and one instruction` |
| 4 | an asm copy's line has no value — `readout.ts`: `...(reading === null ? [] : [endedLine(reading.value)]),` → `(deleted)` | `cd web && pnpm exec vitest run --project node tests/node/readout.test.ts tests/node/results.test.ts` | `tests/node/readout.test.ts > asmCopySegments > names the copy, counts its instructions, and reads its value as its view does`, `tests/node/readout.test.ts > asmCopySegments > says a count of one in the singular`, `tests/node/readout.test.ts > asmCopySegments > says why the recording stopped, and a fault as a fault` |
| 5 | an asm copy's line hides why it stopped — `readout.ts`: `const why = leg.done === null ? '' : STOPPED[leg.done] ⏎   return [ ⏎     name,` → `const why = '' ⏎   return [ ⏎     name,` | `cd web && pnpm exec vitest run --project node tests/node/readout.test.ts tests/node/results.test.ts` | `tests/node/readout.test.ts > asmCopySegments > says why the recording stopped, and a fault as a fault` |
| 6 | an ended value line drops its prefix — `results.ts`: `` if (typeof value === 'object' && 'Value' in value) return `value: ${value.Value.text}` ⏎   return decodedText(value) ⏎ } `` → `if (typeof value === 'object' && 'Value' in value) return value.Value.text ⏎   return decodedText(value) ⏎ }` | `cd web && pnpm exec vitest run --project node tests/node/readout.test.ts tests/node/results.test.ts` | `tests/node/readout.test.ts > asmCopySegments > names the copy, counts its instructions, and reads its value as its view does`, `tests/node/readout.test.ts > asmCopySegments > says a count of one in the singular`, `tests/node/readout.test.ts > copyRows > keeps a reduced-file sentence whole`, `tests/node/readout.test.ts > tmCopySegments > names the copy and carries its count, value line and reduced-file sentence`, `` tests/node/results.test.ts > valueLine > prefixes a value, and says every other ending in `decodedText`'s words `` |
| 7 | the strip reads an asm copy as a bare count — `draw.ts`: `segments: () => asmCopySegments(name, asmReading, asmLeg),` → `segments: () => [name],` | `cd web && pnpm exec vitest run --project browser tests/browser/asm-blank-copy.test.ts` | `tests/browser/asm-blank-copy.test.ts > a blank asm copy > reads a fault as a fault, in its view and in the strip`, `tests/browser/asm-blank-copy.test.ts > a blank asm copy > says its one instruction in the singular, and its value, in the strip` |
| 8 | the program's asm count is plural for one — `results.ts`: `const steps = counted(a.status.total_steps, 'instruction')` → `` const steps = `${n(a.status.total_steps)} instructions` `` | `cd web && pnpm exec vitest run --project node tests/node/readout.test.ts tests/node/results.test.ts` | `tests/node/results.test.ts > resultRows — a step count of one is singular, on every leg > and in a count that stopped`, `tests/node/results.test.ts > resultRows — a step count of one is singular, on every leg > reads one reduction, one transition and one instruction` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
A blank asm copy from the copies menu, an asm copy's line in the readout, and a step count of one in the singular

The copies menu offers *new asm copy* beside *new TM copy*, one control
per leg whose copy is a whole program; an asm view's title then offers
the copy, whose empty program faults on its first fetch until something
is typed. An asm copy's readout line moves into `readout.ts` beside
λ's and TM's: its name, its instructions, why its recording stopped,
and its value as its view reads it, a fault as a fault. Every leg's
step count reads in the singular for one, in the result rows and the
copy lines alike (spec amendment 29).
````


---

### Task 6: An asm copy's text is bounded at 5,400,000 bytes and its run by caps that keep its worker under 256 MiB, both measured

**Files:**
- Create: `crates/redextape-wasm/src/probe.rs` (`asmScratchWithCaps`, compiled only under `probe-asm-copy`)
- Modify: `crates/redextape-wasm/src/session.rs` (`MAX_SCRATCH_ASM_BYTES`, `COPY_CAPS`, the ceiling in `asm_scratch_with_caps`, `asm_text_within`), `crates/redextape-wasm/src/lib.rs` (the probe module), `crates/redextape-wasm/Cargo.toml` (`probe-asm-copy`), `scripts/check-all.sh` (its clippy and test legs), `web/package.json` (`test:probe:asm-copy`), `web/vite.config.ts` (the two probes in `PROBE_FILES`, and their run stamp), `web/src/sessions.ts` (a doc)
- Create (tests): `web/tests/browser/asm-copy-cost.test.ts`, `web/tests/browser/asm-copy-memory.test.ts`, `web/tests/browser/asm-copy-memory-worker.ts` — probes, outside the default set
- Modify (tests): `web/tests/browser/provided-context.d.ts` (`probeAsmCopyRun`)
- Test: `crates/redextape-wasm/src/session.rs` (its test module)

**Interfaces:**
- Produces `session::MAX_SCRATCH_ASM_BYTES: usize = 5_400_000` and `session::COPY_CAPS: tm::asm::Caps` — `DEFAULT_CAPS` with `heap: 2_000_000` and `mem: 12_000_000`. `asm_scratch` runs under `COPY_CAPS`; `Session::asm_text` answers `None` over the ceiling, which Task 4's *edit a copy* shows disabled with its reason.

**THE CEILING IS MEASURED AS `MAX_SCRATCH_TM_BYTES` WAS** (amendment 24): `asm-copy-cost.test.ts` prices a build's four costs by the size of its text — the clone to the worker, `asmScratch`, reading the reply off the handle, the clone back — with the longest run a copy can take, a loop to the step cap, added. Two runs put the crossing in different places — 5,600,025 bytes under at 247.3 ms and 5,800,050 over at 255.4 ms, then 5,400,000 under at 242.5 ms and 5,600,025 over at 250.8 ms — so the ceiling is the largest size under budget in both, and a band, as the TM ceiling is.

**THE CAPS ARE MEASURED AGAINST THE WORKER'S MEMORY** (amendment 25): `asm-copy-memory.test.ts` builds each worst case in a worker of its own — a wasm memory only grows — records it as the session worker does, and reads the worker's memory. Under `DEFAULT_CAPS` a million-word locals bank saved by every `call` reached 629.8 MiB; under `COPY_CAPS` the worst, a heap filled to its cap and then saved locals to theirs, reached 168.4 MiB, under the user's 256 MiB. The program's own session keeps `DEFAULT_CAPS`.

**BOTH PROBES RUN FROM ONE SCRIPT ON ONE BUILD**: `pnpm run test:probe:asm-copy` builds the crate with `probe-asm-copy` — which switches the ceiling off and adds `asmScratchWithCaps`, in a module of its own so no product build carries it and `check-doc-figures.sh`'s export count stays the product's — stamps the build, and runs both.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=6
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index a027d69..f1efc2b 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -3262,6 +3262,76 @@ mod tests {
         assert_eq!(sc.asm_value(), Decoded::Value { text: "[1, 2, 3]".into() });
     }
 
+    /// `.asm` text of exactly `bytes` bytes: one `halt`, and a comment to make up the rest.
+    fn asm_padded_to(bytes: usize) -> String {
+        let text = format!("    halt\n;{}\n", "x".repeat(bytes - "    halt\n;\n".len()));
+        assert_eq!(text.len(), bytes);
+        text
+    }
+
+    /// The ceiling admits a file of exactly its size and refuses one byte more, before parsing it, in words that name
+    /// both sizes.
+    #[cfg(not(feature = "probe-asm-copy"))]
+    #[test]
+    fn an_asm_copy_at_the_ceiling_builds_and_one_byte_more_is_refused_unparsed() {
+        let at = asm_scratch(&asm_padded_to(MAX_SCRATCH_ASM_BYTES));
+        assert!(at.diagnostics.is_empty() && at.scratch.is_some(), "{:?}", at.diagnostics);
+        let over = asm_scratch(&asm_padded_to(MAX_SCRATCH_ASM_BYTES + 1));
+        assert!(over.scratch.is_none());
+        let said: Vec<&str> = over.diagnostics.iter().map(|d| d.message.as_str()).collect();
+        assert_eq!(
+            said,
+            [format!(
+                "this file is {} bytes; an asm copy builds files up to {} bytes — `redextape run` has no such limit",
+                grouped(MAX_SCRATCH_ASM_BYTES as u64 + 1),
+                grouped(MAX_SCRATCH_ASM_BYTES as u64)
+            )]
+        );
+        // UNPARSED: a file too long and with a label mistake hears only about its size.
+        let both = asm_scratch(&format!("\tjmp\tnowhere\n{}", asm_padded_to(MAX_SCRATCH_ASM_BYTES)));
+        assert_eq!(both.diagnostics.len(), 1, "{:?}", both.diagnostics);
+        assert!(both.diagnostics[0].message.starts_with("this file is "), "{:?}", both.diagnostics);
+    }
+
+    /// The probe build parses what the product build refuses, so its probe can price both sides of the ceiling.
+    #[cfg(feature = "probe-asm-copy")]
+    #[test]
+    fn the_probe_build_parses_asm_text_over_the_ceiling() {
+        let over = asm_scratch(&asm_padded_to(MAX_SCRATCH_ASM_BYTES + 1));
+        assert!(over.diagnostics.is_empty() && over.scratch.is_some(), "{:?}", over.diagnostics);
+    }
+
+    /// A session hands out no text a copy would refuse.
+    #[test]
+    fn a_session_hands_out_no_asm_text_longer_than_the_limit() {
+        let s = Session::compile("let x = 40; x + 2", EncodingKind::Unary).session.expect("compiles");
+        let text = s.asm_text().expect("the asm leg is there");
+        assert_eq!(s.asm_text_within(text.len()), Some(text.clone()), "exactly the limit is handed out");
+        assert_eq!(s.asm_text_within(text.len() - 1), None, "one byte over is not");
+    }
+
+    /// A copy runs under `COPY_CAPS`, not `DEFAULT_CAPS`: a `cons` a step stops heap-full at `COPY_CAPS.heap` cells, where
+    /// `DEFAULT_CAPS` would run on to its step cap; and a thousand-word locals bank saved by every `call` stops with its
+    /// saved frames full after `COPY_CAPS.mem` / 1,000 calls. Each allocates about what its cap allows.
+    #[test]
+    fn a_copy_runs_under_copy_caps() {
+        let cons = format!("    nil\tr0\nloop:\n{}    jmp\tloop\n", "    cons\tr0, r1, r0\n".repeat(100));
+        let mut sc = asm_scratch(&cons).scratch.expect("builds");
+        run_copy_out(&mut sc);
+        let end = sc.asm_state(AsmWindow { locals: 0, args: 0, frames: 0, cells: 0, boxes: 0 });
+        assert_eq!((sc.asm_status().cap, end.heap_len), (Some(AsmCap::Heap), 2_000_000));
+
+        let saved = "f:\n    li\tr999, #1\n    call\tf\n";
+        let mut sc = asm_scratch(saved).scratch.expect("builds");
+        assert_eq!(
+            sc.asm_status().total_steps,
+            Some(2 * 12_000 + 1),
+            "12,000 calls, and the `li` before the refused one"
+        );
+        run_copy_out(&mut sc);
+        assert_eq!(sc.asm_status().cap, Some(AsmCap::Mem));
+    }
+
     // --- the TM scratchpad -----------------------------------------------------------------------
 
     /// A hand-written unary incrementer with NO header — δ and a start state and nothing else, which is
diff --git a/web/tests/browser/asm-copy-cost.test.ts b/web/tests/browser/asm-copy-cost.test.ts
new file mode 100644
index 0000000..b43e1c0
--- /dev/null
+++ b/web/tests/browser/asm-copy-cost.test.ts
@@ -0,0 +1,148 @@
+import { describe, expect, inject, it } from 'vitest'
+import type * as Wasm from '../../../pkg/redextape_wasm.js'
+import { ScratchEditor } from '../../src/scratch-editor'
+import type { AsmProgram, AsmStatus, Decoded, Diagnostic } from '../../src/types'
+
+/**
+ * **A PROBE, NOT A GATE** (`vite.config.ts`'s `PROBE_FILES`): what an asm copy's build costs before its first frame,
+ * by the size of its text, against the 250 ms an initiated gesture may take — `tm-buffer-cost.test.ts`'s pricing, for
+ * `MAX_SCRATCH_ASM_BYTES` (Plan 7 part 5 spec, amendment 24). Run by `pnpm run test:probe:asm-copy`, which builds the
+ * probe wasm with the ceiling off and stamps it; this refuses a build another run stamped.
+ *
+ * FOUR COSTS PER BUILD, AS FOR A TM COPY: the text's structured clone to the worker; `asmScratch`, which parses it,
+ * checks its labels, projects the listing and runs the program to its end; reading the reply's status, listing and
+ * value off the handle; and the reply's clone back. The corpus programs halt on their first instruction, so the run
+ * costs nothing here and the four costs are the text's. **THE RUN IS PRICED APART**, as the longest a copy can take —
+ * a loop to the step cap — since a program's run does not grow with its text; the ceiling is the size whose build,
+ * with that run added, stays under the budget.
+ *
+ * THE CORPUS IS GENERATED, one block a label, of the shape a hand-written file has: a label, three instructions, and a
+ * jump back to it, so the label check has a definition and a reference per block.
+ */
+
+type Copy = { asmStatus(): AsmStatus; asmProgram(): AsmProgram; asmValue(): Decoded; free(): void }
+type Made = { diagnostics: Diagnostic[]; scratch: Copy | null }
+
+const PROBE_WASM = import.meta.glob<typeof Wasm>('../../../target/probe-asm-copy-wasm/redextape_wasm.js')
+const RUN = import.meta.glob<string>('../../../target/probe-asm-copy-wasm/run.txt', {
+  query: '?raw',
+  import: 'default',
+})
+
+const BUDGET_MS = 250
+const REPS = 7
+const SIZES = [
+  250_000, 500_000, 1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 5_200_000, 5_400_000, 5_600_000, 5_800_000,
+  6_000_000, 8_000_000, 12_000_000,
+]
+
+/** An asm file of at least `bytes` bytes that halts on its first instruction. */
+function corpus(bytes: number): string {
+  const parts = ['result Nat\n\n    halt\n']
+  let size = parts[0]?.length ?? 0
+  for (let i = 0; size < bytes; i++) {
+    const block = `l${i}:\n    li\tr1, #${i}\n    add\tr2, r1, r1\n    jz\tr0, l${i}\n`
+    parts.push(block)
+    size += block.length
+  }
+  return parts.join('')
+}
+
+const cloneMs = (payload: unknown) =>
+  new Promise<number>((resolve) => {
+    const ch = new MessageChannel()
+    const start = performance.now()
+    ch.port2.onmessage = () => resolve(performance.now() - start)
+    ch.port1.postMessage(payload)
+  })
+const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN
+const ms = (x: number) => x.toFixed(1).padStart(7)
+
+describe('asm copy cost', () => {
+  it('prices a build by the size of its text, and the longest run a copy can take', async () => {
+    const run = inject('probeAsmCopyRun')
+    const built = await Object.values(RUN)[0]?.()
+    if (run === '' || built !== run) {
+      throw new Error(
+        `BLOCKED: this run's stamp is "${run}" and the build's "${built ?? 'absent'}"; run \`pnpm run test:probe:asm-copy\``,
+      )
+    }
+    const load = Object.values(PROBE_WASM)[0]
+    if (load === undefined) throw new Error('BLOCKED: no probe wasm build; run `pnpm run test:probe:asm-copy`')
+    const { default: init, asmScratch } = await load()
+    await init()
+    const build = (text: string): Copy => {
+      const made = asmScratch(text) as Made
+      if (made.scratch === null)
+        throw new Error(`BLOCKED: did not build: ${made.diagnostics.map((d) => d.message).join(' · ')}`)
+      return made.scratch
+    }
+
+    // THE LONGEST RUN: a loop to the step cap, from a text too short to cost anything else.
+    const runs: number[] = []
+    for (let r = 0; r < REPS; r++) {
+      const t0 = performance.now()
+      build('loop:\n    jmp\tloop\n').free()
+      runs.push(performance.now() - t0)
+    }
+    const worstRun = median(runs)
+    const rows = [
+      `RUN  loop to the step cap: median=${ms(worstRun)} spread=${ms(Math.min(...runs))}-${ms(Math.max(...runs)).trim()}`,
+    ]
+
+    for (let i = 0; i < 3; i++) build(corpus(10_000)).free()
+    const totals: { bytes: number; total: number }[] = []
+    for (const target of SIZES) {
+      const text = corpus(target)
+      const bytes = new TextEncoder().encode(text).length
+      const clone: number[] = []
+      const parse: number[] = []
+      const project: number[] = []
+      const back: number[] = []
+      let instructions = 0
+      for (let r = 0; r < REPS; r++) {
+        clone.push(await cloneMs({ kind: 'asm-scratch', gen: 1, src: text }))
+        const t1 = performance.now()
+        const copy = build(text)
+        parse.push(performance.now() - t1)
+        const t2 = performance.now()
+        const reply = {
+          kind: 'asm-scratch-compiled',
+          gen: 1,
+          asm: copy.asmStatus(),
+          asmProgram: copy.asmProgram(),
+          value: copy.asmValue(),
+        }
+        project.push(performance.now() - t2)
+        instructions = reply.asmProgram.listing.length
+        back.push(await cloneMs(reply))
+        copy.free()
+      }
+      const mounts: number[] = []
+      for (let r = 0; r < 3; r++) {
+        const host = document.createElement('div')
+        document.body.append(host)
+        const t3 = performance.now()
+        const editor = new ScratchEditor({ host, initial: text, debounceMs: 300, onEdit: () => {} })
+        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
+        mounts.push(performance.now() - t3)
+        editor.destroy()
+        host.remove()
+      }
+      const total = median(clone) + median(parse) + median(project) + median(back)
+      totals.push({ bytes, total })
+      rows.push(
+        `SIZE bytes=${String(bytes).padStart(9)} instructions=${String(instructions).padStart(7)} clone=${ms(median(clone))} ` +
+          `build=${ms(median(parse))} project=${ms(median(project))} back=${ms(median(back))} total=${ms(total)} ` +
+          `with_worst_run=${ms(total + worstRun)} mount=${ms(median(mounts))}`,
+      )
+    }
+    const under = totals.filter((t) => t.total + worstRun < BUDGET_MS).sort((a, b) => b.bytes - a.bytes)[0]
+    const over = totals.filter((t) => t.total + worstRun >= BUDGET_MS).sort((a, b) => a.bytes - b.bytes)[0]
+    const said = (t: (typeof totals)[number] | undefined) =>
+      t === undefined ? 'none' : `${t.bytes} bytes, ${(t.total + worstRun).toFixed(1)} ms with the worst run`
+    rows.push(`BRACKET largest under ${BUDGET_MS} ms: ${said(under)}; smallest at or over: ${said(over)}`)
+    console.log(`\n${rows.join('\n')}\n`)
+    expect(totals.length).toBe(SIZES.length)
+  }, 1_800_000)
+})
diff --git a/web/tests/browser/asm-copy-memory-worker.ts b/web/tests/browser/asm-copy-memory-worker.ts
new file mode 100644
index 0000000..69142a6
--- /dev/null
+++ b/web/tests/browser/asm-copy-memory-worker.ts
@@ -0,0 +1,46 @@
+// A worker that builds ONE asm copy under the caps it is sent, records it as the session worker would, and reports
+// how large its wasm memory has grown — for `asm-copy-memory.test.ts`. One copy per worker, because a wasm memory only
+// grows: a second build in the same worker would read the first one's peak.
+//
+// THE PROBE BUILD, BY GLOB, NOT `pkg/`: `asmScratchWithCaps` exists only under `probe-asm-copy`, and a glob that
+// matches nothing leaves `tsc` and every other run able to load this file's siblings without the build.
+import type * as Wasm from '../../../pkg/redextape_wasm.js'
+import { ASM_WINDOW, asmFrameBytes, HISTORY_BYTES } from '../../src/protocol'
+import type { AsmState, AsmStatus } from '../../src/types'
+
+const PROBE_WASM = import.meta.glob<typeof Wasm>('../../../target/probe-asm-copy-wasm/redextape_wasm.js')
+
+type Copy = { asmStatus(): AsmStatus; asmState(w: typeof ASM_WINDOW): AsmState; stepAsm(): boolean; free(): void }
+type ProbeWasm = typeof Wasm & {
+  asmScratchWithCaps(src: string, steps: number, stack: number, heap: number, mem: number): { scratch: Copy | null }
+}
+export type MemoryRequest = { src: string; caps: [number, number, number, number] }
+export type MemoryReply =
+  | { ok: true; mib: number; status: AsmStatus; frames: number; buildMs: number }
+  | { ok: false; message: string }
+
+self.addEventListener('message', async (e: MessageEvent<MemoryRequest>) => {
+  const post = (r: MemoryReply) => (self as unknown as Worker).postMessage(r)
+  try {
+    const load = Object.values(PROBE_WASM)[0]
+    if (load === undefined) throw new Error('BLOCKED: no probe wasm build; run `pnpm run test:probe:asm-copy`')
+    const wasm = (await load()) as ProbeWasm
+    const exports = (await wasm.default()) as { memory: WebAssembly.Memory }
+    const t0 = performance.now()
+    const { scratch } = wasm.asmScratchWithCaps(e.data.src, ...e.data.caps)
+    const buildMs = performance.now() - t0
+    if (scratch === null) throw new Error('the probe program did not build')
+    // THE RECORDING, AS `record-loop.ts` SPENDS IT: a frame per step until the leg stops or the history budget is spent.
+    let bytes = 0
+    let frames = 0
+    for (;;) {
+      const f = scratch.asmState(ASM_WINDOW)
+      bytes += asmFrameBytes(f)
+      frames += 1
+      if (bytes >= HISTORY_BYTES || !scratch.stepAsm()) break
+    }
+    post({ ok: true, mib: exports.memory.buffer.byteLength / 2 ** 20, status: scratch.asmStatus(), frames, buildMs })
+  } catch (err) {
+    post({ ok: false, message: err instanceof Error ? err.message : String(err) })
+  }
+})
diff --git a/web/tests/browser/asm-copy-memory.test.ts b/web/tests/browser/asm-copy-memory.test.ts
new file mode 100644
index 0000000..d9669d6
--- /dev/null
+++ b/web/tests/browser/asm-copy-memory.test.ts
@@ -0,0 +1,83 @@
+import { describe, expect, inject, it } from 'vitest'
+import type { MemoryReply, MemoryRequest } from './asm-copy-memory-worker'
+
+/**
+ * **A PROBE, NOT A GATE** (`vite.config.ts`'s `PROBE_FILES`): what an asm copy's worst cases cost its worker's memory,
+ * under `DEFAULT_CAPS` and under `COPY_CAPS` (Plan 7 part 5 spec, amendment 25). Run by `pnpm run test:probe:asm-copy`,
+ * which builds the probe wasm with `probe-asm-copy` and stamps it; this refuses a build another run stamped.
+ *
+ * EACH CASE IN A WORKER OF ITS OWN, since a wasm memory only grows: the figure is the memory after the build and the
+ * recording, which is the worker's peak. The worst cases are the two caps whose words a hand-written copy can fill:
+ *
+ * - **saved locals**: `r999999` grows the locals bank to a million words, and every `call` saves the bank, so the memory
+ *   cap's words are reached in `mem / 1,000,000` calls;
+ * - **the heap**: a `cons` a step, until the heap cap's cells are allocated.
+ *
+ * The caps are `[steps, stack, heap, mem]`, `DEFAULT_CAPS`' and the candidate `COPY_CAPS`' — kept in step with
+ * `session.rs` by hand, as a probe's inputs are, and printed so a run says what it measured.
+ */
+
+const DEFAULT_CAPS: MemoryRequest['caps'] = [5_000_000, 100_000, 5_000_000, 64_000_000]
+const COPY_CAPS: MemoryRequest['caps'] = [5_000_000, 100_000, 2_000_000, 12_000_000]
+
+const CASES: readonly { name: string; src: string }[] = [
+  { name: 'saved locals', src: 'f:\n    li\tr999999, #1\n    call\tf\n' },
+  { name: 'heap cells', src: `    nil\tr0\nloop:\n${'    cons\tr0, r1, r0\n'.repeat(100)}    jmp\tloop\n` },
+  { name: 'boxes', src: `loop:\n${'    box\tr0, r1\n'.repeat(100)}    jmp\tloop\n` },
+  { name: 'call frames', src: 'f:\n    call\tf\n' },
+]
+
+/**
+ * THE TWO TOGETHER: a heap filled to `cells`, a hundred cells a turn, and then the saved-locals recursion — the worst a
+ * copy can do, since the caps are separate and a run stops at the first one it meets.
+ */
+const both = (cells: number) => ({
+  name: 'both',
+  src:
+    `    nil\tr0\n    li\tr2, #${Math.floor(cells / 100) - 1}\n    li\tr3, #1\nfill:\n${'    cons\tr0, r1, r0\n'.repeat(100)}` +
+    '    sub\tr2, r2, r3\n    jz\tr2, deep\n    jmp\tfill\ndeep:\n    li\tr999999, #1\n    call\tdeep\n',
+})
+
+const RUN = import.meta.glob<string>('../../../target/probe-asm-copy-wasm/run.txt', {
+  query: '?raw',
+  import: 'default',
+})
+
+function measure(req: MemoryRequest): Promise<MemoryReply> {
+  const worker = new Worker(new URL('./asm-copy-memory-worker.ts', import.meta.url), { type: 'module' })
+  return new Promise((resolve) => {
+    worker.addEventListener('message', (e: MessageEvent<MemoryReply>) => {
+      worker.terminate()
+      resolve(e.data)
+    })
+    worker.postMessage(req)
+  })
+}
+
+describe('asm copy memory', () => {
+  it('prices each worst case under DEFAULT_CAPS and under COPY_CAPS', async () => {
+    const run = inject('probeAsmCopyRun')
+    const built = await Object.values(RUN)[0]?.()
+    if (run === '' || built !== run) {
+      throw new Error(
+        `BLOCKED: this run's stamp is "${run}" and the build's "${built ?? 'absent'}"; run \`pnpm run test:probe:asm-copy\``,
+      )
+    }
+    const rows: string[] = []
+    for (const [label, caps] of [
+      ['DEFAULT_CAPS', DEFAULT_CAPS],
+      ['COPY_CAPS', COPY_CAPS],
+    ] as const) {
+      for (const c of [...CASES, both(caps[2])]) {
+        const r = await measure({ src: c.src, caps })
+        if (!r.ok) throw new Error(`${c.name}: ${r.message}`)
+        rows.push(
+          `MEM ${label.padEnd(12)} ${c.name.padEnd(12)} caps=${caps.join('/')} MiB=${r.mib.toFixed(1).padStart(7)} ` +
+            `build_ms=${r.buildMs.toFixed(1).padStart(7)} steps=${r.status.total_steps} cap=${r.status.cap} frames=${r.frames}`,
+        )
+      }
+    }
+    console.log(`\n${rows.join('\n')}\n`)
+    expect(rows.length).toBe(2 * (CASES.length + 1))
+  }, 1_800_000)
+})
diff --git a/web/tests/browser/provided-context.d.ts b/web/tests/browser/provided-context.d.ts
index 3ee13f7..905c4a0 100644
--- a/web/tests/browser/provided-context.d.ts
+++ b/web/tests/browser/provided-context.d.ts
@@ -11,5 +11,7 @@ declare module 'vitest' {
      * empty. That file's doc says why a probe run refuses a stamp that is not its own.
      */
     probeTmBufferRun: string
+    /** `asm-copy-cost.test.ts`'s and `asm-copy-memory.test.ts`'s run stamp, set by `pnpm run test:probe:asm-copy`. */
+    probeAsmCopyRun: string
   }
 }
````


- [ ] **Step 2: Run them and see them fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(ceiling) | test(copy_caps) | test(asm_text)'`

Expected: exit 101, printing:

```text
error[E0425]: cannot find value `MAX_SCRATCH_ASM_BYTES` in this scope
error[E0425]: cannot find value `MAX_SCRATCH_ASM_BYTES` in this scope
error[E0425]: cannot find value `MAX_SCRATCH_ASM_BYTES` in this scope
error[E0425]: cannot find value `MAX_SCRATCH_ASM_BYTES` in this scope
error[E0425]: cannot find value `MAX_SCRATCH_ASM_BYTES` in this scope
error[E0599]: no method named `asm_text_within` found for struct `session::Session` in the current scope
error[E0599]: no method named `asm_text_within` found for struct `session::Session` in the current scope
error: could not compile `redextape-wasm` (lib test) due to 7 previous errors; 2 warnings emitted
```

- [ ] **Step 3: Write the code.**

````diff apply=source task=6
diff --git a/crates/redextape-wasm/Cargo.toml b/crates/redextape-wasm/Cargo.toml
index d0ddaf4..702822c 100644
--- a/crates/redextape-wasm/Cargo.toml
+++ b/crates/redextape-wasm/Cargo.toml
@@ -54,6 +54,13 @@ ts = ["dep:ts-rs", "redextape-core/ts"]
 # there holds what it does instead, and `scripts/check-all.sh` gives it a clippy and test leg of its own so that
 # test runs. No wasm build a gate or the app loads enables it.
 probe-no-tm-scratch-ceiling = []
+# `probe-no-tm-scratch-ceiling`'s twin for asm copies, and one thing more. It switches off the size check in
+# `asm_scratch_with_caps` (`src/session.rs`), so an asm copy parses text of any length, for
+# `web/tests/browser/asm-copy-cost.test.ts`, which prices a build on both sides of `MAX_SCRATCH_ASM_BYTES`; and it
+# exports `asmScratchWithCaps`, so `web/tests/browser/asm-copy-memory.test.ts` can build a copy under `DEFAULT_CAPS`
+# and under `COPY_CAPS` and read the worker's memory after each. Built by `web`'s `test:probe:asm-copy` script into
+# `target/probe-asm-copy-wasm/`, never into `pkg/`; `scripts/check-all.sh` gives it a clippy and test leg.
+probe-asm-copy = []
 
 [dev-dependencies]
 wasm-bindgen-test = "0.3.76"
diff --git a/crates/redextape-wasm/src/lib.rs b/crates/redextape-wasm/src/lib.rs
index 4238f5c..c777698 100644
--- a/crates/redextape-wasm/src/lib.rs
+++ b/crates/redextape-wasm/src/lib.rs
@@ -13,6 +13,8 @@
 // test-harness pass, so production warnings still surface from the other one.
 #![cfg_attr(test, allow(clippy::pedantic))]
 
+#[cfg(feature = "probe-asm-copy")]
+mod probe;
 mod session;
 
 /// The eight wire types this crate declares, re-exported for `tests/ts_bindings.rs`.
diff --git a/crates/redextape-wasm/src/probe.rs b/crates/redextape-wasm/src/probe.rs
new file mode 100644
index 0000000..6403d56
--- /dev/null
+++ b/crates/redextape-wasm/src/probe.rs
@@ -0,0 +1,35 @@
+//! What only the `probe-asm-copy` build exports: an asm copy built under caps the caller names.
+//!
+//! **A MODULE OF ITS OWN, COMPILED ONLY UNDER THE FEATURE**, so no product build carries an export no product caller
+//! has, and `scripts/check-doc-figures.sh`'s count of `lib.rs`'s free exports stays the product's.
+
+use wasm_bindgen::prelude::*;
+
+use crate::{AsmScratch, session, to_value};
+
+/// `asmScratchWithCaps(src, steps, stack, heap, mem)` -> `{ diagnostics, scratch }`, as `asmScratch` answers, with the
+/// copy run under these caps rather than `COPY_CAPS`. `web/tests/browser/asm-copy-memory.test.ts` builds a copy under
+/// `DEFAULT_CAPS` and under `COPY_CAPS` with it, to read what each costs the worker's memory. Each cap is a `u32`, which
+/// every one of `DEFAULT_CAPS`' four fits, so a caller passes plain numbers.
+///
+/// # Errors
+///
+/// As `asmScratch`'s: only if marshalling the diagnostics or assembling the object fails.
+#[wasm_bindgen(js_name = asmScratchWithCaps)]
+pub fn asm_scratch_with_caps(src: &str, steps: u32, stack: u32, heap: u32, mem: u32) -> Result<JsValue, JsValue> {
+    let caps = redextape_core::tm::asm::Caps {
+        steps: u64::from(steps),
+        stack: u64::from(stack),
+        heap: u64::from(heap),
+        mem: u64::from(mem),
+    };
+    let made = session::asm_scratch_with_caps(src, caps);
+    let out = js_sys::Object::new();
+    js_sys::Reflect::set(&out, &JsValue::from_str("diagnostics"), &to_value(&made.diagnostics)?)?;
+    let handle = match made.scratch {
+        Some(s) => JsValue::from(AsmScratch(s)),
+        None => JsValue::NULL,
+    };
+    js_sys::Reflect::set(&out, &JsValue::from_str("scratch"), &handle)?;
+    Ok(out.into())
+}
diff --git a/crates/redextape-wasm/src/session.rs b/crates/redextape-wasm/src/session.rs
index f1efc2b..d324583 100644
--- a/crates/redextape-wasm/src/session.rs
+++ b/crates/redextape-wasm/src/session.rs
@@ -1256,12 +1256,20 @@ impl Session {
     /// program prints with no header, and its copy's value is the raw word, marked, where the program's is
     /// `Undecodable`: there was never a value of its type to decode.
     pub fn asm_text(&self) -> Option<String> {
+        self.asm_text_within(MAX_SCRATCH_ASM_BYTES)
+    }
+
+    /// `asm_text`, `None` too when the text is longer than `limit` bytes: a copy could not build it, so *edit a copy*
+    /// is offered disabled with its reason rather than posted text a build refuses. A parameter so a test can reach
+    /// the refusal without a program that prints megabytes.
+    fn asm_text_within(&self, limit: usize) -> Option<String> {
         let leg = self.asm.as_ref().ok()?;
         let program = leg.cursor.program();
-        Some(match redextape_core::ty::parse_ty(&redextape_core::ty::show(&self.ty)) {
+        let text = match redextape_core::ty::parse_ty(&redextape_core::ty::show(&self.ty)) {
             Some(result) => tm::print_asm_with(program, &tm::AsmHeader { result }),
             None => tm::print_asm(program),
-        })
+        };
+        (text.len() <= limit).then_some(text)
     }
 
     // --- the reference leg --------------------------------------------------------------------
@@ -1434,11 +1442,58 @@ pub struct AsmScratch {
 /// **THE WHOLE RUN HAPPENS HERE, ONCE**, as in `compile` (spec amendment 26): the step total and the value
 /// come with the build.
 pub fn asm_scratch(src: &str) -> Scratched<AsmScratch> {
-    asm_scratch_with_caps(src, tm::DEFAULT_CAPS)
+    asm_scratch_with_caps(src, COPY_CAPS)
 }
 
-/// `asm_scratch` under `caps`, so a test can reach a cap without millions of steps.
-fn asm_scratch_with_caps(src: &str, caps: tm::asm::Caps) -> Scratched<AsmScratch> {
+/// The longest `.asm` text an asm copy builds, in bytes, and the longest `Session::asm_text` hands out for one (Plan 7
+/// part 5 spec, amendment 24).
+///
+/// **MEASURED, NOT CHOSEN, AGAINST THE 250 MS AN INITIATED GESTURE MAY TAKE** — `MAX_SCRATCH_TM_BYTES`' budget. A
+/// copy's build pays four costs before its first frame: the text's structured clone to the worker; `asm_scratch`,
+/// which parses it, checks its labels, projects the listing and runs the program to its end; reading the reply's
+/// status, listing and value off the handle; and the reply's clone back. `web/tests/browser/asm-copy-cost.test.ts`
+/// prices the four together (`cd web && pnpm run test:probe:asm-copy`), over generated files that halt on their first
+/// instruction, and prices the run apart — a loop to the step cap, about 31 ms, the median of seven — since a run does
+/// not grow with its text; a file's cost is the four medians' sum with that run added. Two runs of that command, on an
+/// AMD Ryzen 9 9950X3D with a release build and this check off (`probe-asm-copy`), put the crossing in different
+/// places: the first had 5,600,025 bytes under budget at 247.3 ms and 5,800,050 bytes over it at 255.4 ms, the second
+/// 5,400,000 bytes under at 242.5 ms and 5,600,025 bytes over at 250.8 ms. The ceiling is the largest size under budget
+/// in both, so it is a band, as `MAX_SCRATCH_TM_BYTES`' is.
+///
+/// ONE CONSTANT FOR BOTH DIRECTIONS (spec amendment 24): the text a copy parses, and the text *edit a copy* would post,
+/// since a text over it is one the copy would refuse.
+pub const MAX_SCRATCH_ASM_BYTES: usize = 5_400_000;
+
+/// The caps an asm copy runs under: `DEFAULT_CAPS` with fewer heap cells and fewer saved words (Plan 7 part 5 spec,
+/// amendment 25).
+///
+/// **SET SO A COPY'S WORKER STAYS UNDER 256 MIB, THE BUDGET THE USER SET, AND MEASURED THERE.** Each warm copy has a
+/// worker of its own, up to `MAX_WARM_BUFFERS` of them, and a wasm memory only grows, so a copy that once filled its
+/// caps holds that memory until its worker ends. Under `DEFAULT_CAPS` a hand-written copy can fill far more:
+/// `web/tests/browser/asm-copy-memory.test.ts` (`cd web && pnpm run test:probe:asm-copy`) builds each worst case in a
+/// worker of its own, records it as the session worker does, and reads the worker's wasm memory. One run, on the machine
+/// above: 629.8 MiB for a million-word locals bank saved by every `call`, to the memory cap; 264.6 MiB for a `cons` a
+/// step, to the step cap; 136.6 MiB for a `box` a step; 18.4 MiB for bare recursion, to the stack cap. Under these caps
+/// the same cases read 133.1, 72.5, 40.4 and 18.4 MiB, and a copy that fills the heap to its cap and then saves locals
+/// to theirs — the two together, since a run stops at the first cap it meets — reads 168.4 MiB.
+///
+/// A copy of the program therefore stops, heap-full or with its saved frames full, where the program's own session
+/// runs on: the session keeps `DEFAULT_CAPS`, and the step line names the cap that ended a copy.
+pub const COPY_CAPS: tm::asm::Caps = tm::asm::Caps { heap: 2_000_000, mem: 12_000_000, ..tm::DEFAULT_CAPS };
+
+/// `asm_scratch` under `caps`, so a test can reach a cap without millions of steps, and the memory probe can price
+/// `DEFAULT_CAPS` beside `COPY_CAPS` (`probe-asm-copy`).
+pub(crate) fn asm_scratch_with_caps(src: &str, caps: tm::asm::Caps) -> Scratched<AsmScratch> {
+    // BEFORE THE PARSE, FOR `tm_scratch_with_caps`' REASON: the parse is one of the costs the ceiling bounds. Off under
+    // `probe-asm-copy`, which prices both sides of it; `cfg!`, so the constant is read in every build.
+    if !cfg!(feature = "probe-asm-copy") && src.len() > MAX_SCRATCH_ASM_BYTES {
+        let message = format!(
+            "this file is {} bytes; an asm copy builds files up to {} bytes — `redextape run` has no such limit",
+            grouped(src.len() as u64),
+            grouped(MAX_SCRATCH_ASM_BYTES as u64)
+        );
+        return Scratched { diagnostics: vec![Diagnostic::error(Span { start: 0, end: 0 }, message)], scratch: None };
+    }
     let (doc, nav) = tm::parse_asm_nav(src);
     let mut diagnostics = doc.diagnostics;
     diagnostics.extend(tm::asm_label_diagnostics(&nav));
diff --git a/scripts/check-all.sh b/scripts/check-all.sh
index 9e9f220..8d5c8ec 100755
--- a/scripts/check-all.sh
+++ b/scripts/check-all.sh
@@ -165,6 +165,9 @@ LEGS=(
   # so it is a config like `ts`, and a config no leg builds is one whose tests never run.
   "base|clippy|-p redextape-wasm --features probe-no-tm-scratch-ceiling --all-targets"
   "base|test|-p redextape-wasm --features probe-no-tm-scratch-ceiling"
+  # `probe-asm-copy` does the same for `MAX_SCRATCH_ASM_BYTES`, and adds an export; the same reason for a leg of its own.
+  "base|clippy|-p redextape-wasm --features probe-asm-copy --all-targets"
+  "base|test|-p redextape-wasm --features probe-asm-copy"
   # `redextape-lsp-wasm` is a `cdylib` the browser loads, so "does it build for wasm32" is a
   # different question from the one the `--workspace` rows above answer, which build natively.
   #
diff --git a/web/package.json b/web/package.json
index 089b27f..3ee6204 100644
--- a/web/package.json
+++ b/web/package.json
@@ -19,6 +19,7 @@
     "test:probe": "REDEXTAPE_PROBE=1 vitest run --project browser tests/browser/buffer-affordability.test.ts",
     "test:probe:tm": "REDEXTAPE_PROBE=1 vitest run --project browser tests/browser/tm-fork-cost.test.ts",
     "test:probe:tm-buffer": "export REDEXTAPE_PROBE_TM_BUFFER_RUN=\"$(date +%s)-$$\" && bash ../scripts/emit-probe-reduced-files.sh && wasm-pack build ../crates/redextape-wasm --release --target web --out-dir ../../target/probe-tm-buffer-wasm -- --features probe-no-tm-scratch-ceiling && printf %s \"$REDEXTAPE_PROBE_TM_BUFFER_RUN\" > ../target/probe-tm-buffer-wasm/run.txt && REDEXTAPE_PROBE=1 vitest run --project browser --reporter=verbose tests/browser/tm-buffer-cost.test.ts",
+    "test:probe:asm-copy": "export REDEXTAPE_PROBE_ASM_COPY_RUN=\"$(date +%s)-$$\" && wasm-pack build ../crates/redextape-wasm --release --target web --out-dir ../../target/probe-asm-copy-wasm -- --features probe-asm-copy && printf %s \"$REDEXTAPE_PROBE_ASM_COPY_RUN\" > ../target/probe-asm-copy-wasm/run.txt && REDEXTAPE_PROBE=1 vitest run --project browser --reporter=verbose tests/browser/asm-copy-cost.test.ts tests/browser/asm-copy-memory.test.ts",
     "test:probe:floor": "REDEXTAPE_PROBE=1 vitest run --project browser tests/browser/pane-floor.test.ts",
     "test:probe:lambda-tree": "REDEXTAPE_PROBE=1 vitest run --project browser --reporter=verbose tests/browser/lambda-tree-cost.test.ts",
     "test:coverage": "vitest run --coverage"
diff --git a/web/src/sessions.ts b/web/src/sessions.ts
index b7ec44d..4ff7acc 100644
--- a/web/src/sessions.ts
+++ b/web/src/sessions.ts
@@ -110,7 +110,8 @@ export type TmCompiled = { readonly program: TmProgram; readonly tapeNames: stri
 /**
  * The asm listing a session compiled, and the text *edit a copy* seeds a copy from — `TmCompiled`'s shape for the asm
  * leg, and for its reason: the view that offers a copy needs both, and a view built after the reply is seeded from
- * here. `asmText` is `null` on a copy, which offers no copy of itself.
+ * here. `asmText` is `null` on a copy, which offers no copy of itself, and for a program whose text is longer than
+ * `session.rs`'s `MAX_SCRATCH_ASM_BYTES`, which no copy could build.
  */
 export type AsmCompiled = { readonly program: AsmProgram; readonly asmText: string | null }
 
diff --git a/web/vite.config.ts b/web/vite.config.ts
index 089bea1..5fe5239 100644
--- a/web/vite.config.ts
+++ b/web/vite.config.ts
@@ -67,6 +67,8 @@ const PROBE_FILES = [
   'tests/browser/pane-floor.test.ts',
   'tests/browser/tm-buffer-cost.test.ts',
   'tests/browser/lambda-tree-cost.test.ts',
+  'tests/browser/asm-copy-cost.test.ts',
+  'tests/browser/asm-copy-memory.test.ts',
 ]
 const PROBE_EXCLUDE = process.env.REDEXTAPE_PROBE === undefined ? PROBE_FILES : []
 
@@ -376,7 +378,10 @@ export default defineConfig({
           // `tm-buffer-cost.test.ts`'s run stamp, which `pnpm run test:probe:tm-buffer` sets and every other run
           // leaves empty. A browser test cannot read `process.env` (`PROBE_FILES`' doc says why), so the probe
           // learns its own run's stamp here, and refuses a corpus or a build under `target/` stamped by another.
-          provide: { probeTmBufferRun: process.env.REDEXTAPE_PROBE_TM_BUFFER_RUN ?? '' },
+          provide: {
+            probeTmBufferRun: process.env.REDEXTAPE_PROBE_TM_BUFFER_RUN ?? '',
+            probeAsmCopyRun: process.env.REDEXTAPE_PROBE_ASM_COPY_RUN ?? '',
+          },
           // Vitest serves its own tester HTML, so this project's `index.html` — and therefore its
           // `<link>` to `style.css` — never reaches the page. See `tests/browser/setup.ts`: without it
           // the state table's `max-height: 40vh` never applies and the browser tier measures a
````


- [ ] **Step 4: Run them and see them pass.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast`

Expected: exit 0, printing:

```text
Summary: 115 tests run: 115 passed, 0 skipped
```

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --features probe-asm-copy --no-fail-fast`

Expected: exit 0, printing:

```text
Summary: 115 tests run: 115 passed, 0 skipped
```

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy -p redextape-wasm --features probe-asm-copy --all-targets -- -D warnings`

Expected: exit 0

Run: `cd web && pnpm run build:wasm && pnpm exec vitest run --project browser`

Expected: exit 0, printing:

```text
Test Files  112 passed (112)
Tests  741 passed (741)
```

Run: `cd web && pnpm run test:probe:asm-copy`

Expected: exit 0, printing:

```text
MEM DEFAULT_CAPS saved locals caps=5000000/100000/5000000/64000000 MiB=  629.8 build_ms=  100.8 steps=129 cap=Mem frames=130
MEM DEFAULT_CAPS heap cells   caps=5000000/100000/5000000/64000000 MiB=  264.6 build_ms=   74.1 steps=5000000 cap=null frames=18315
MEM DEFAULT_CAPS boxes        caps=5000000/100000/5000000/64000000 MiB=  136.6 build_ms=   56.6 steps=5000000 cap=null frames=33529
MEM DEFAULT_CAPS call frames  caps=5000000/100000/5000000/64000000 MiB=   18.4 build_ms=    4.7 steps=100000 cap=Stack frames=100001
MEM DEFAULT_CAPS both         caps=5000000/100000/5000000/64000000 MiB=  264.6 build_ms=   75.6 steps=5000000 cap=null frames=16855
MEM COPY_CAPS    saved locals caps=5000000/100000/2000000/12000000 MiB=  133.1 build_ms=   14.8 steps=25 cap=Mem frames=26
MEM COPY_CAPS    heap cells   caps=5000000/100000/2000000/12000000 MiB=   72.5 build_ms=   28.3 steps=2020001 cap=null frames=18315
MEM COPY_CAPS    boxes        caps=5000000/100000/2000000/12000000 MiB=   40.4 build_ms=   23.9 steps=2020000 cap=null frames=33529
MEM COPY_CAPS    call frames  caps=5000000/100000/2000000/12000000 MiB=   18.4 build_ms=    5.0 steps=100000 cap=Stack frames=100001
MEM COPY_CAPS    both         caps=5000000/100000/2000000/12000000 MiB=  168.4 build_ms=   40.3 steps=2059924 cap=null frames=16855
BRACKET largest under 250 ms: 5400000 bytes, 241.4 ms with the worst run; smallest at or over: 5600025 bytes, 251.8 ms with the worst run
Test Files  2 passed (2)
Tests  2 passed (2)
```

The memory figures have been the same in every run; the timings, and so the `BRACKET` row, move from run to run — the probe prints every size it priced, and the ceiling is the largest size under budget in every run so far (above).

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (each row's Run command, under the memory cap; after each, `git status` shows only this task's changes). In the replay, 7 of 7 fired.

| # | Sabotage | Run | Fails |
|---|---|---|---|
| 1 | no ceiling — `session.rs`: `if !cfg!(feature = "probe-asm-copy") && src.len() > MAX_SCRATCH_ASM_BYTES {` → `if !cfg!(feature = "probe-asm-copy") && src.len() > usize::MAX - 1 {` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(ceiling) | test(copy_caps) | test(asm_text)'` | `redextape-wasm session::tests::an_asm_copy_at_the_ceiling_builds_and_one_byte_more_is_refused_unparsed` |
| 2 | the ceiling is off in the product build — `session.rs`: `if !cfg!(feature = "probe-asm-copy") && src.len() > MAX_SCRATCH_ASM_BYTES {` → `if cfg!(feature = "probe-asm-copy") && src.len() > MAX_SCRATCH_ASM_BYTES {` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(ceiling) | test(copy_caps) | test(asm_text)'` | `redextape-wasm session::tests::an_asm_copy_at_the_ceiling_builds_and_one_byte_more_is_refused_unparsed` |
| 3 | the ceiling admits one byte more — `session.rs`: `src.len() > MAX_SCRATCH_ASM_BYTES {` → `src.len() > MAX_SCRATCH_ASM_BYTES + 1 {` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(ceiling) | test(copy_caps) | test(asm_text)'` | `redextape-wasm session::tests::an_asm_copy_at_the_ceiling_builds_and_one_byte_more_is_refused_unparsed` |
| 4 | asmText ignores its limit — `session.rs`: `(text.len() <= limit).then_some(text)` → `let _ = limit; ⏎         Some(text)` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(ceiling) | test(copy_caps) | test(asm_text)'` | `redextape-wasm session::tests::a_session_hands_out_no_asm_text_longer_than_the_limit` |
| 5 | a copy runs under DEFAULT_CAPS — `session.rs`: `asm_scratch_with_caps(src, COPY_CAPS)` → `asm_scratch_with_caps(src, tm::DEFAULT_CAPS)` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(ceiling) | test(copy_caps) | test(asm_text)'` | `redextape-wasm session::tests::a_copy_runs_under_copy_caps` |
| 6 | the heap is not lowered — `session.rs`: `tm::asm::Caps { heap: 2_000_000, mem: 12_000_000, ..tm::DEFAULT_CAPS }` → `tm::asm::Caps { mem: 12_000_000, ..tm::DEFAULT_CAPS }` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(ceiling) | test(copy_caps) | test(asm_text)'` | `redextape-wasm session::tests::a_copy_runs_under_copy_caps` |
| 7 | saved frames are not lowered — `session.rs`: `tm::asm::Caps { heap: 2_000_000, mem: 12_000_000, ..tm::DEFAULT_CAPS }` → `tm::asm::Caps { heap: 2_000_000, ..tm::DEFAULT_CAPS }` | `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-wasm --no-fail-fast -E 'test(ceiling) | test(copy_caps) | test(asm_text)'` | `redextape-wasm session::tests::a_copy_runs_under_copy_caps` |

- [ ] **Step 6: Commit**, through the hook: `git add -A && git commit -F <this message>`

````text
An asm copy's text is bounded at 5,400,000 bytes and its run by caps that keep its worker under 256 MiB, both measured

`MAX_SCRATCH_ASM_BYTES` refuses longer text before parsing it, and
`Session.asmText` hands out none longer, so *edit a copy* is offered
disabled with its reason where a copy could not build (spec amendment
24). `asm-copy-cost.test.ts` prices a build's four costs by the size
of its text, with the longest run a copy can take added; the ceiling
is the largest size under budget in two runs, whose first sizes over
it were 5,800,050 and 5,600,025 bytes. `COPY_CAPS` lowers the heap
to 2,000,000 cells and saved frames to 12,000,000 words (amendment
25): `asm-copy-memory.test.ts` reads 629.8 MiB for a copy filling
`DEFAULT_CAPS`' saved frames, and 168.4 MiB for the worst a copy can
do under these. Both probes run from `test:probe:asm-copy`, on a
build with `probe-asm-copy`, which switches the ceiling off and
exports the caps as parameters.
````


---

### Task 7: Verification, the check by hand, and the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — the entry for this PR, appended at the end

**Nothing here changes code.** Every gate CI runs, the Docker image no PR job builds, a look at the app in the three presets, and the entry.

- [ ] **Step 1: Run every gate, one after another, in one detached unit** capped at 16G with no swap, with `PATH` (`/usr/sbin` and `$CARGO_HOME/bin` first), `CARGO_HOME`, `RUSTUP_HOME`, `HOME` and the checkout's own `CARGO_TARGET_DIR` set:
  - `TREE_SITTER=$PWD/.tools/tree-sitter scripts/check-all.sh` — expected last line `all configs green — base, LLVM and browser` (`.tools/` is untracked: in a worktree, point `TREE_SITTER` at the main checkout's);
  - `scripts/check-slow.sh` — expected `slow tier green`;
  - `cargo llvm-cov nextest --workspace --fail-under-lines 90`;
  - the six hygiene scans, each `--self-test` and then alone: `scripts/check-{text-bytes,citations,attributions,doc-figures,shared-docs,lua}.sh`;
  - the web CI sequence: `cd web && pnpm run build:wasm && pnpm run build:lsp-wasm && pnpm exec biome ci --error-on-warnings && pnpm run typecheck && pnpm run test:coverage && pnpm run build:app`, whose floors are statements 95, branches 89, functions 97, lines 97;
  - the Docker image, built and started: `docker build -t redextape-check .`, `docker run -d --name c -p 8099:80 redextape-check`, then `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8099/` answers `200` and `docker inspect --format '{{.State.Health.Status}}' c` answers `healthy`.

  Expected: every one exits 0. **The prototype's run of this step:** every one exited 0 on the prototype's tip before the hover test was added: `check-all.sh` ended `all configs green — base, LLVM and browser`; `check-slow.sh` `slow tier green`; `cargo llvm-cov` 95.67% of lines; the six hygiene scans, each `--self-test` and alone, twelve runs; the web sequence at statements 96.51, branches 89.95, functions 97.38, lines 98.07; and the image answered `200` and `healthy`. With the hover test in, the web sequence was run again: its first run stopped with exit 143 while Vite re-optimized its dependencies, before any test ran, and the second passed 1,488 tests at 96.53, 89.98, 97.38 and 98.07.

- [ ] **Step 2: Look at the app, by hand**, from `cd web && pnpm run dev`, at 1280×800, in each preset (Explorer, Debugger, Stage), light and dark, with `fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)` compiled: *edit a copy* from the asm view's `⋯` menu, and the copy's editor, value line, listing, machine panels and outline in the view; a label that names nothing typed into the copy, marked in its editor with the last run still on screen; *format* on unformatted text; the copies menu's *new asm copy*, picked through an asm view's title; the readout's line for the copy with the asm view focused; and the asm view moved back to the program. A browser that has used the app before keeps its stored layout, which may have no asm view: choose `reset preset` in the workspace menu first. Record what was looked at and anything that reads wrong; a finding goes to the whole-branch review, not into this task.

- [ ] **Step 3: Write the roadmap entry.** Append it at the end of the roadmap, as the entries before it are: a heading that says what the PR did and what its review found, what it built, what the prototype found, what the reviews found, what it did not close, and a VERIFICATION table in which every figure names the command that produced it — each run before the entry is committed. What it did not close includes, at least: the running instruction's line in a copy's editor (§10: `parse_asm_nav` pushes instructions with no position); the state diagram and the λ body moving onto `VirtualGrid` (5b's leftover, unchanged); the program's own session under `DEFAULT_CAPS`, which Task 6's probe prices at 629.8 MiB for saved locals no compiled program is known to reach; and the closed-view editor destroy that no test can see, a TM view's included.

- [ ] **Step 4: Commit the entry**, as the last commit before the PR opens:

````text
Roadmap: Plan 7 part 5c — asm copies
````
