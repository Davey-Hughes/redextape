# Plan 7 part 5a — asm in the core: a stepping cursor, display tags, and each instruction's owner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the core a stepping asm interpreter that `run_asm` becomes a loop over, tag every word it holds by the instruction that made it, hold it to the TM step for step, and keep each instruction's source construct in the source map and link index — the core half of [Plan 7 part 5](../specs/2026-09-27-plan7-part5-asm-design.md), §4.

**Architecture:** The register machine's state moves out of `run_asm` into `trace::AsmCursor` (in `trace/asm_cursor.rs`), which yields one `AsmStep` per executed instruction and latches an `AsmStatus` naming why it stopped; `run_asm` drives it to the end. Each word carries a display `WordTag` and each local a written bit, which nothing reads to run an instruction. The three-way oracle holds the cursor's instruction sequence to the `pc{i}` entry states the TM passes through. `SourceMap` gains an asm half, built before and apart from the machine, whose `asm_owner` the TM half composes through and `LinkIndex` carries.

**Tech Stack:** Rust (`redextape-core`; doc-only changes in `redextape-native` and `redextape-native-rt`), `cargo nextest`, proptest (existing suites only).

## Global Constraints

- The spec is `docs/superpowers/specs/2026-09-27-plan7-part5-asm-design.md` **as amended** — amendments 1 to 4 are this plan's. Where this plan and the spec disagree, stop and ask.
- `run_asm`'s signature, its `AsmRun` results, its caps and its `MAX_REGISTERS` guard do not change (§4.2). Every existing test and golden passes unchanged.
- Tags and written bits are display state: no instruction reads either to decide what it does (§4.3).
- `StepEvent` is untouched. The asm cursor yields its own `AsmStep` (amendment 4).
- No library path may panic: no `unwrap`, `expect`, `panic!` or unchecked indexing outside tests (the workspace's clippy lints and the crate's rule).
- Doc comments are `///`. No `file:line` citations in tracked source (the pre-commit hook rejects them); they are normal in `docs/`. A possessive citation of a file (`` `x.rs`'s `sym` ``) must name the file that declares the symbol. No plan task numbers in shipped code.
- The pre-commit hook runs `cargo fmt --check`, clippy with `-D warnings` (pedantic) and seven hygiene scans on every commit. Never `--no-verify`.
- Every test and build runs under `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0`. A sabotage run uses `--no-fail-fast`, and its *Summary* line is read, not only its `FAIL` lines.
- **A sabotage run can write files of its own.** A proptest that fails writes a `*.proptest-regressions` seed into `crates/redextape-core/tests/`. After every sabotage, `git status` must show only what the task changed: restore a tracked seed file with `git checkout --`, delete an untracked one. The prototype committed one by accident; see *What the prototype found*.

## How to use the code in this plan

**The code below is the prototype's, verbatim, and it was rebuilt from this document's own blocks before the plan was committed** (see Pre-flight status). Every change is a patch:

- Save the block to a file **outside the repository** (the session scratchpad) and run `git apply <that file>` from the repository root. A patch that does not apply means the tree has drifted from the state this plan was built against — this plan's own commit plus the tasks before it. Stop and report; do not hand-merge.
- Each task's **tests' half** goes in first, so the red step can be observed; then its **source half**. In Rust the red step is a compile failure: the tests name what the source half adds.
- A new file appears in its patch whole (`new file mode`).
- The patches are fenced with four backticks, because a context line in Task 1's carries a doc comment's own three.

**Stage before running a hygiene scan by hand.** `check-attributions` resolves a citation against *tracked* files, so a new file that is not yet `git add`ed reads as missing. The hook runs on the staged commit, where that cannot happen.

**Use your own `CARGO_TARGET_DIR` in a worktree.** A scratch worktree building into the main checkout's `target/` has linked the other checkout's library before; give each checkout its own directory under `target/`.

## Pre-flight status

**Every task was built, gated and sabotaged before this plan was written**, in a scratch worktree off `26db520`. It was then rebuilt task by task from this document's own code blocks on a fresh worktree at `76c3687`, the spec's last amendment — which differs from `26db520` only in `docs/` — as an executor would. Each task's tests' half was applied and its red step run as written, then its source half; the tree was staged and compared with the prototype's, `docs/` aside; its green steps and gates were run as written and it was committed through the pre-commit hook; and every sabotage in its table was run, one at a time, against the whole `redextape-core` suite with `--no-fail-fast`, restored after each. Every *Expected* line below is what that run printed, and every *Fails* column is what that sabotage failed there.

| Task | Tree against the prototype | Red step | Green steps, gates and hook | Sabotages fired |
|---|---|---|---|---|
| 1 | IDENTICAL | failed to compile, as the task says | passed | 8 of 8 |
| 2 | IDENTICAL | failed to compile, as the task says | passed | 10 of 10 |
| 3 | IDENTICAL | failed to compile, as the task says | passed | 5 of 5 |
| 4 | IDENTICAL | failed to compile, as the task says | passed | 7 of 7 |

**30 sabotages were run, one at a time; 30 fired on the test they were aimed at.** Each task lists its own.

**What the prototype found, all answered in the code below:**

1. **The umbrella's asm oracle could not fail** (spec §4.4). "Stepping to the end matches `run_asm`" compares the cursor with its own loop. The replacement reads the instruction sequence off the TM's `pc{i}` entry states, a second implementation that shares no code with the cursor. It holds on all 100 runs: the 46 programs of `FIRST_ORDER_DEMOS` and the 4 latent traps, each under unary and binary (spec amendment 2). Two of Task 3's sabotages change no program's result — a `jmp` step named by its target, and a `cons` into `rr` tagged as a value — and only the new oracles see them.
2. **The spec's tag table contradicted its own rule** (amendment 1). It put `tail` beside `cons` and `nil` as making a list, while stating that a tag records how a word was made and storing each cell's tail tag. `tail` copies that stored tag, as `head` does; Task 2's table test holds a hand-built cell with a value in its tail, which is the only place the two readings part.
3. **`run_asm` is slower on the cursor** (amendment 3). The per-step status and cap checks cost 3.9 ms → 6.8 ms on the 1,400,009-step loop; `#[inline]` on `Vm::exec` brought that to 5.7 ms, and boxing the error type changed nothing (5.65 ms); the tags then took it to 6.2 ms, and `sum(1000)` from 0.059 to 0.119 ms and `upto(200)` from 0.013 to 0.028 ms — the plan's final state, two rounds of 15 runs each against `main`. The appendix's `asmbench` measured each.
4. **The move stranded doc references to code that no longer lived where they said.** `redextape-native-rt` said it mirrored "`run_asm`'s `Instr::Cons` arm", `run_asm`'s `Vm` and `Vec<Frame>`, and quoted `vm.heap.len() as u64 >= vm.caps.heap`; `redextape-native` cited `run_asm`'s `eval_bin`. A sweep for every symbol `tm/asm.rs` lost (`Frame`, `Vm`, `grow_set`, `eval_bin`) and every quoted `vm.` expression found them; Task 1 repoints each at the cursor. Sentences describing what `run_asm` *does* — that a `call` leaves the caller's locals in place — are still true and stay.
5. **A sabotage's failing proptest left a regression seed that the task's commit picked up.** Task 1's inverted-`jz` sabotage made `asm_oracle.rs`'s proptest fail, which wrote `asm_oracle.proptest-regressions`; restoring the sabotaged file did not remove it, and `git add -A` committed it. The global constraint above is the answer.
6. **A reversed `asm_owner` passed every other owner test.** One owner per instruction, every owner with source, an exact inverse and the link column all hold for a permutation. Task 4's `each_instruction_is_owned_by_the_construct_that_emitted_it` reads five instructions' owners back as source text, measured from `fact(3)`'s listing; of the crate's 1,288 tests, it is the one that sabotage fails (Task 4, row 2).
7. **The asm half has to be built apart from the machine.** `tm_half` lowered and then laid out, returning nothing on either refusal; a program the TM refuses to lay out — 33 multiplications, one past `MAX_MUL_INSTRS` — still lowers to 68 instructions. `asm_half` lowers once, the TM half composes through it, and the owners survive the machine's refusal.

**What replaying this plan found, before it was committed, and answered in it:**

1. **The first replay from the document could not apply Task 1's source half.** A context line in it is an existing doc comment's own `` /// ``` ``, which closed the block's three-backtick fence early — for a reader as much as for the replay. Every patch is now fenced with four.
2. **Two doc comments were wrong at an edge.** `AsmStatus::Faulted` and `pc()` said `pc` names the faulting instruction; a run that falls off the end of `code` leaves it one past the last. And `wrote()` claimed the last *completed* step's register while `exec` clears it on a refused instruction. The first is now stated; for the second, putting the register back was built and measured (6.3 → 7.5 ms on the loop), so the doc was made true instead and a test holds it (Task 2).

**Verified fixtures**, each measured by running it, not reasoned:

| Fixture | Where | Measured |
|---|---|---|
| `branch()`: `if 1 == 2 { rr = 10 } else { rr = 20 }` | Task 1 | steps `[0, 1, 2, 3, 6, 7]`, 6 steps, `rr` 20, halts with `pc` 7 |
| `sum5()`: `sum(5)` by recursion | Task 1 | deepest stack: returns `[2, 12, 12, 12, 12, 12]`, saved `r0` `[—, 5, 4, 3, 2, 1]`; result 15 |
| `wide`, `call` with `r1000` written, `mem: 5000` | Task 1 | 4 calls fit (1,001 words each), the 5th is refused: 5 steps, `pc` 1 |
| the tag table's program | Task 2 | locals' tags `V L L L L V V L L V V B L`, cells `(V, L) (L, V)`, one box `V`, `rr` 7 `V` |
| `fact(3)`'s owners | Task 4 | `cmpeq` ← `n == 0`, `sub` ← `n - 1`, `mul` ← `n * fact(n - 1)`, `li r0, #3` ← `3`, `call fact.0` ← `fact(3)` |
| `map` over `[3, 1, 2]` with a closure | Task 4 | 54 instructions, 17 minted by `defunc`; every owned one has source |
| 33 multiplications | Task 4 | the TM maps empty; 68 instructions, all owned |

## File structure

**Created**

| File | Task | Responsibility |
|---|---|---|
| `crates/redextape-core/src/trace/asm_cursor.rs` | 1, 2 | `AsmCursor`, the one asm interpreter: its machine state, its step, its status, and from Task 2 its tags and written bits |

**Modified**

| File | Task | What changes |
|---|---|---|
| `crates/redextape-core/src/trace.rs` | 1, 2 | declares `asm_cursor` and re-exports its types |
| `crates/redextape-core/src/tm/asm.rs` | 1 | loses `Vm`, `Frame`, `grow_set` and `eval_bin` to the cursor; `run_asm` loops over it; `instr_reg_over_cap` becomes `pub(crate)` |
| `crates/redextape-native-rt/src/lib.rs`, `crates/redextape-native/src/{aot,codegen,jit,llvm,shared}.rs` | 1 | docs repointed at the cursor (finding 4) |
| `crates/redextape-core/src/tm.rs` | 3 | `lower_program` becomes public |
| `crates/redextape-core/tests/three_way_oracle.rs` | 3 | the TM-sequence and result-tag oracles |
| `crates/redextape-core/src/sourcemap.rs` | 4 | the asm half; `asm_owner`, `node_to_asm` and their accessors |
| `crates/redextape-core/src/viewmodel.rs`, `crates/redextape-core/tests/viewmodel_contract.rs` | 4 | `LinkIndex::asm_owner` and its tests |

---

### Task 1: The asm interpreter steps

**Files:**
- Create: `crates/redextape-core/src/trace/asm_cursor.rs`
- Modify: `crates/redextape-core/src/trace.rs`, `crates/redextape-core/src/tm/asm.rs`
- Modify (docs only): `crates/redextape-native-rt/src/lib.rs`, `crates/redextape-native/src/{aot,codegen,jit,llvm,shared}.rs`

**Interfaces:**
- Produces, re-exported from `redextape_core::trace`: `AsmCursor<P>` for `P: Borrow<Program>`, with `new(prog: P, caps: Caps)`, `program() -> &Program`, `pc() -> usize`, `rr() -> u64`, `locals() -> &[u64]`, `args() -> &[u64]`, `stack() -> &[AsmFrame]`, `heap() -> &[(u64, u64)]`, `boxes() -> &[u64]`, `steps_taken() -> u64`, `status() -> Option<&AsmStatus>`, `raise_cap(extra_steps: u64)`, `into_outcome(self) -> AsmOutcome`, and `Iterator<Item = AsmStep>`; `AsmStep { pc: usize }`; `AsmStatus::{Halted, Faulted(String), Capped(AsmCap)}`; `AsmCap::{Steps, Stack, Heap, Mem}`; `AsmFrame { ret_pc: usize, saved_locals: Vec<u64> }`.
- `run_asm` keeps its signature and gains `#[must_use]`, which pedantic clippy asks for once its body is a loop.

**THE STATE MOVES; IT IS NOT COPIED.** `Vm`, its `read`/`write`, `grow_set` and `eval_bin` leave `tm/asm.rs` for the cursor's module, and `run_asm`'s `match` becomes `Vm::exec`. Only an instruction that completes is a step, so a refused or faulting instruction leaves `pc` on itself and `steps_taken` where it was, and a run capped at exactly the steps it needs halts: `halt` is a step. `raise_cap` resumes only a step cap.

- [ ] **Step 1: Write the failing tests.** The tests' half creates `asm_cursor.rs` holding only its test module, declares the module in `trace.rs`, and carries the one swept doc line that sits inside `llvm.rs`'s own test module.

````diff apply=tests task=1
diff --git a/crates/redextape-core/src/trace.rs b/crates/redextape-core/src/trace.rs
index 9900fd5..50b318a 100644
--- a/crates/redextape-core/src/trace.rs
+++ b/crates/redextape-core/src/trace.rs
@@ -19,6 +19,7 @@ use crate::tm::machine::{Machine, StateId, Symbol};
 use crate::tm::sim::{Caps as TmCaps, Status as TmStatus, Tape, apply, rule_matches};
 use std::borrow::Borrow;
 
+mod asm_cursor;
 mod zipper;
 
 pub use zipper::ZipperCursor;
diff --git a/crates/redextape-core/src/trace/asm_cursor.rs b/crates/redextape-core/src/trace/asm_cursor.rs
new file mode 100644
index 0000000..94153bd
--- /dev/null
+++ b/crates/redextape-core/src/trace/asm_cursor.rs
@@ -0,0 +1,171 @@
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use crate::tm::asm::DEFAULT_CAPS;
+
+    fn label(name: &str) -> String {
+        name.to_string()
+    }
+
+    /// `if 1 == 2 { rr = 10 } else { rr = 20 }`: `jz` at 3 is taken to `else` at 6, then `halt` at 7.
+    fn branch() -> Program {
+        Program {
+            code: vec![
+                Instr::Li(Reg::Loc(0), 1),
+                Instr::Li(Reg::Loc(1), 2),
+                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
+                Instr::Jz(Reg::Loc(2), label("else")),
+                Instr::Li(Reg::Rr, 10),
+                Instr::Jmp(label("end")),
+                Instr::Li(Reg::Rr, 20),
+                Instr::Halt,
+            ],
+            labels: vec![(label("else"), 6), (label("end"), 7)],
+        }
+    }
+
+    /// `sum(5)` by recursion: `a0` carries the argument and each activation copies it to `r0`, a
+    /// frame-saved local. The first `call` returns to 2 and every recursive one to 12.
+    fn sum5() -> Program {
+        Program {
+            code: vec![
+                Instr::Li(Reg::Arg(0), 5),
+                Instr::Call(label("sum")),
+                Instr::Halt,
+                Instr::Mov(Reg::Loc(0), Reg::Arg(0)),
+                Instr::Li(Reg::Loc(1), 0),
+                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
+                Instr::Jz(Reg::Loc(2), label("rec")),
+                Instr::Li(Reg::Rr, 0),
+                Instr::Ret,
+                Instr::Li(Reg::Loc(3), 1),
+                Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Loc(0), Reg::Loc(3)),
+                Instr::Call(label("sum")),
+                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr),
+                Instr::Ret,
+            ],
+            labels: vec![(label("sum"), 3), (label("rec"), 9)],
+        }
+    }
+
+    #[test]
+    fn each_step_names_the_instruction_it_ran() {
+        let mut c = AsmCursor::new(branch(), DEFAULT_CAPS);
+        let pcs: Vec<usize> = c.by_ref().map(|s| s.pc).collect();
+        assert_eq!(pcs, [0, 1, 2, 3, 6, 7], "the taken `jz` skips 4 and 5");
+        assert_eq!(c.status(), Some(&AsmStatus::Halted));
+        assert_eq!(c.steps_taken(), 6, "`halt` is a step");
+        assert_eq!(c.rr(), 20);
+        assert_eq!(c.pc(), 7, "a halted run keeps `pc` on its `halt`");
+    }
+
+    /// At the deepest point of `sum(5)` six frames are saved: the top-level call's, returning to 2 with no
+    /// locals yet, and five recursive ones returning to 12, each holding its activation's `n` in `r0`.
+    #[test]
+    fn the_stack_holds_each_frames_return_and_saved_locals() {
+        let mut c = AsmCursor::new(sum5(), DEFAULT_CAPS);
+        let mut deepest: Vec<AsmFrame> = Vec::new();
+        while c.next().is_some() {
+            if c.stack().len() > deepest.len() {
+                deepest = c.stack().to_vec();
+            }
+        }
+        let rets: Vec<usize> = deepest.iter().map(|f| f.ret_pc).collect();
+        assert_eq!(rets, [2, 12, 12, 12, 12, 12]);
+        let saved_n: Vec<Option<u64>> = deepest.iter().map(|f| f.saved_locals.first().copied()).collect();
+        assert_eq!(saved_n, [None, Some(5), Some(4), Some(3), Some(2), Some(1)]);
+        assert_eq!(c.status(), Some(&AsmStatus::Halted));
+        assert_eq!(c.into_outcome().result, 15);
+    }
+
+    /// A budget spent exactly is not a budget exceeded: at the step count the run needs, it halts; one
+    /// fewer caps it on steps, and raising the cap by one finishes it with the same answer.
+    #[test]
+    fn a_run_capped_at_exactly_its_steps_halts() {
+        let exact = Caps { steps: 6, ..DEFAULT_CAPS };
+        let mut c = AsmCursor::new(branch(), exact);
+        c.by_ref().for_each(drop);
+        assert_eq!(c.status(), Some(&AsmStatus::Halted));
+
+        let mut short = AsmCursor::new(branch(), Caps { steps: 5, ..DEFAULT_CAPS });
+        short.by_ref().for_each(drop);
+        assert_eq!(short.status(), Some(&AsmStatus::Capped(AsmCap::Steps)));
+        assert_eq!((short.steps_taken(), short.pc()), (5, 7), "capped before `halt` ran");
+        short.raise_cap(1);
+        assert_eq!(short.status(), None, "a step cap is the one raising the cap resumes");
+        short.by_ref().for_each(drop);
+        assert_eq!((short.status(), short.rr()), (Some(&AsmStatus::Halted), 20));
+    }
+
+    /// Each cap is named, and only the step cap resumes: more steps cannot deepen a stack, grow a heap or
+    /// widen the memory for saved frames.
+    #[test]
+    fn each_cap_is_named_and_only_the_step_cap_resumes() {
+        let recurse = Program { code: vec![Instr::Call(label("f"))], labels: vec![(label("f"), 0)] };
+        let wide = Program {
+            code: vec![Instr::Li(Reg::Loc(1000), 1), Instr::Call(label("f"))],
+            labels: vec![(label("f"), 1)],
+        };
+        let conses = Program {
+            code: vec![
+                Instr::Nil(Reg::Loc(0)),
+                Instr::Cons(Reg::Loc(1), Reg::Loc(0), Reg::Loc(0)),
+                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(1)),
+                Instr::Halt,
+            ],
+            labels: vec![],
+        };
+        let boxes = Program {
+            code: vec![
+                Instr::Li(Reg::Loc(0), 1),
+                Instr::Box(Reg::Loc(1), Reg::Loc(0)),
+                Instr::Box(Reg::Loc(2), Reg::Loc(0)),
+                Instr::Halt,
+            ],
+            labels: vec![],
+        };
+        let spin = Program { code: vec![Instr::Jmp(label("l"))], labels: vec![(label("l"), 0)] };
+        let cases = [
+            (recurse, Caps { stack: 3, ..DEFAULT_CAPS }, AsmCap::Stack, 3, 0),
+            (wide, Caps { mem: 5000, ..DEFAULT_CAPS }, AsmCap::Mem, 5, 1),
+            (conses, Caps { heap: 1, ..DEFAULT_CAPS }, AsmCap::Heap, 2, 2),
+            (boxes, Caps { heap: 1, ..DEFAULT_CAPS }, AsmCap::Heap, 2, 2),
+            (spin, Caps { steps: 1000, ..DEFAULT_CAPS }, AsmCap::Steps, 1000, 0),
+        ];
+        for (prog, caps, cap, steps, pc) in cases {
+            let mut c = AsmCursor::new(prog, caps);
+            c.by_ref().for_each(drop);
+            assert_eq!(c.status(), Some(&AsmStatus::Capped(cap)));
+            assert_eq!((c.steps_taken(), c.pc()), (steps, pc), "{cap:?}: the refused instruction did not run");
+            c.raise_cap(10);
+            let resumed = c.status().is_none();
+            assert_eq!(resumed, cap == AsmCap::Steps, "{cap:?}: only a step cap resumes");
+        }
+    }
+
+    /// A fault ends the run on the instruction that faulted, which did not complete, with the text
+    /// `run_asm` reports; raising the cap cannot resume it.
+    #[test]
+    fn a_fault_stops_on_the_faulting_instruction() {
+        let prog = Program {
+            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
+            labels: vec![],
+        };
+        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
+        let pcs: Vec<usize> = c.by_ref().map(|s| s.pc).collect();
+        assert_eq!(pcs, [0]);
+        assert_eq!(c.status(), Some(&AsmStatus::Faulted("head of empty list".to_string())));
+        assert_eq!((c.steps_taken(), c.pc()), (1, 1));
+        c.raise_cap(10);
+        assert!(c.status().is_some(), "a fault is not a budget");
+    }
+
+    #[test]
+    fn an_over_cap_register_faults_before_any_step() {
+        let prog = Program { code: vec![Instr::Li(Reg::Loc(2_000_000), 1), Instr::Halt], labels: vec![] };
+        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
+        assert_eq!(c.next(), None);
+        assert_eq!(c.status(), Some(&AsmStatus::Faulted("register index exceeds MAX_REGISTERS".to_string())));
+        assert_eq!(c.steps_taken(), 0);
+    }
+}
diff --git a/crates/redextape-native/src/llvm.rs b/crates/redextape-native/src/llvm.rs
index 293b71c..24d0a78 100644
--- a/crates/redextape-native/src/llvm.rs
+++ b/crates/redextape-native/src/llvm.rs
@@ -1289,7 +1289,7 @@ mod tests {
     ///
     /// The chain is seeded from `Arg(0)` (not from `Loc(0)`'s own init-`0` value) so that no
     /// instruction here READS a `Loc` this body has not already written: `run_asm`'s `Call` clones
-    /// the caller's locals into the saved frame and leaves `vm.locals` in place, so a callee
+    /// the caller's locals into the saved frame and leaves the locals in place, so a callee
     /// INHERITS the caller's `Loc` values, whereas both native backends give the callee a zeroed
     /// bank. The same divergence class applies to `Rr`, not just `Loc`: `$main: li rr, 1; call g;
     /// halt` with `g: ret` (a callee that `Ret`s without ever writing `Rr`) yields `run_asm` → `1`
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(/asm_cursor/)'`
Expected: FAIL — the tests do not compile: `` error[E0425]: cannot find type `Program` in this scope ``, `` error[E0422]: cannot find struct, variant or union type `Program` in this scope ``, `` error[E0433]: cannot find type `Instr` in this scope ``, and 7 more distinct (`` error: could not compile `redextape-core` (lib test) due to 125 previous errors; 1 warning emitted ``).

- [ ] **Step 3: Write the code.** The cursor above its tests, the re-export, `run_asm` over it, and the doc sweep.

````diff apply=source task=1
diff --git a/crates/redextape-core/src/tm/asm.rs b/crates/redextape-core/src/tm/asm.rs
index 70cf4b1..df39372 100644
--- a/crates/redextape-core/src/tm/asm.rs
+++ b/crates/redextape-core/src/tm/asm.rs
@@ -7,6 +7,7 @@ use crate::analysis::push_span;
 use crate::core::BinOp;
 use crate::tm::asm_syntax::AsmDocument;
 use crate::tm::comments::{AnchoredComment, AsmAnchor, CommentWriter};
+use crate::trace::{AsmCursor, AsmStatus};
 use crate::ty::Ty;
 use crate::value::Value;
 use std::collections::HashMap;
@@ -451,65 +452,6 @@ pub enum AsmRun {
     Fault(String),
 }
 
-struct Frame {
-    ret_pc: usize,
-    saved_locals: Vec<u64>,
-}
-
-struct Vm {
-    locals: Vec<u64>,
-    args: Vec<u64>,
-    rr: u64,
-    heap: Vec<(u64, u64)>,
-    boxes: Vec<u64>,
-    stack: Vec<Frame>,
-    pc: usize,
-    steps: u64,
-    caps: Caps,
-    /// Running total of words held across all frames currently on `stack` (mirrors the sum of
-    /// `saved_locals.len()`), tracked incrementally so `Call`/`Ret` stay O(1).
-    saved_words: u64,
-}
-
-impl Vm {
-    fn read(&self, r: Reg) -> u64 {
-        match r {
-            Reg::Loc(n) => self.locals.get(n as usize).copied().unwrap_or(0),
-            Reg::Arg(n) => self.args.get(n as usize).copied().unwrap_or(0),
-            Reg::Rr => self.rr,
-        }
-    }
-
-    fn write(&mut self, r: Reg, v: u64) {
-        match r {
-            Reg::Loc(n) => grow_set(&mut self.locals, n as usize, v),
-            Reg::Arg(n) => grow_set(&mut self.args, n as usize, v),
-            Reg::Rr => self.rr = v,
-        }
-    }
-}
-
-fn grow_set(v: &mut Vec<u64>, i: usize, val: u64) {
-    if i >= v.len() {
-        v.resize(i + 1, 0);
-    }
-    v[i] = val;
-}
-
-fn eval_bin(op: BinOp, a: u64, b: u64) -> u64 {
-    match op {
-        BinOp::Add => a.saturating_add(b),
-        BinOp::Sub => a.saturating_sub(b), // monus
-        BinOp::Mul => a.saturating_mul(b),
-        BinOp::Eq => u64::from(a == b),
-        BinOp::Ne => u64::from(a != b),
-        BinOp::Lt => u64::from(a < b),
-        BinOp::Le => u64::from(a <= b),
-        BinOp::Gt => u64::from(a > b),
-        BinOp::Ge => u64::from(a >= b),
-    }
-}
-
 /// True if `r` is a bank register whose index reaches or exceeds `MAX_REGISTERS` (`Rr` never does).
 fn reg_over_cap(r: Reg) -> bool {
     match r {
@@ -519,7 +461,7 @@ fn reg_over_cap(r: Reg) -> bool {
 }
 
 /// True if any register operand of `i` reaches or exceeds `MAX_REGISTERS`.
-fn instr_reg_over_cap(i: &Instr) -> bool {
+pub(crate) fn instr_reg_over_cap(i: &Instr) -> bool {
     match i {
         Instr::Li(rd, _) | Instr::Jz(rd, _) | Instr::Nil(rd) => reg_over_cap(*rd),
         Instr::Mov(a, b)
@@ -536,183 +478,18 @@ fn instr_reg_over_cap(i: &Instr) -> bool {
 
 /// Execute `prog` starting at index 0, bounded by `caps`. Never panics, never hangs.
 ///
-/// `clippy::too_many_lines`: one `match instr` arm per `Instr` variant, executing the interpreter's
-/// fetch-decode-execute loop — the length tracks `Instr`'s variant count, not any one arm's
-/// complexity. Splitting the loop body out would separate the dispatch from the loop that drives it,
-/// the opposite of easier to follow.
-#[allow(clippy::too_many_lines)]
+/// A loop over `trace::AsmCursor`, which holds the interpreter: the cursor is the one place an
+/// instruction's meaning lives, and this is its run-to-the-end reading. A cursor stops only by latching a
+/// status, so the `None` arm below cannot be reached; it answers `HitCap` rather than panicking, because
+/// no library path may panic.
+#[must_use]
 pub fn run_asm(prog: &Program, caps: Caps) -> AsmRun {
-    // Guard against absurd register indices before running: an unbounded `Reg::Loc(n)`/`Reg::Arg(n)`
-    // would make `grow_set` attempt a multi-GB `Vec::resize`, whose allocation failure aborts the
-    // process. A one-time O(code) scan keeps `run_asm` safe on any `Program` at no per-step cost.
-    if prog.code.iter().any(instr_reg_over_cap) {
-        return AsmRun::Fault("register index exceeds MAX_REGISTERS".to_string());
-    }
-    let mut vm = Vm {
-        locals: Vec::new(),
-        args: Vec::new(),
-        rr: 0,
-        heap: Vec::new(),
-        boxes: Vec::new(),
-        stack: Vec::new(),
-        pc: 0,
-        steps: 0,
-        caps,
-        saved_words: 0,
-    };
-    loop {
-        if vm.steps >= vm.caps.steps {
-            return AsmRun::HitCap;
-        }
-        vm.steps += 1;
-        let Some(instr) = prog.code.get(vm.pc) else {
-            // Falling off the end without `halt`/`ret` is an internal lowering invariant violation;
-            // treat defensively as a fault rather than a panic.
-            return AsmRun::Fault("ran past end of program".to_string());
-        };
-        match instr {
-            Instr::Li(rd, n) => {
-                vm.write(*rd, *n);
-                vm.pc += 1;
-            }
-            Instr::Mov(rd, rs) => {
-                let v = vm.read(*rs);
-                vm.write(*rd, v);
-                vm.pc += 1;
-            }
-            Instr::Bin(op, rd, ra, rb) => {
-                let v = eval_bin(*op, vm.read(*ra), vm.read(*rb));
-                vm.write(*rd, v);
-                vm.pc += 1;
-            }
-            Instr::Jz(r, l) => {
-                if vm.read(*r) == 0 {
-                    match prog.label_index(l) {
-                        Some(i) => vm.pc = i,
-                        None => return AsmRun::Fault(format!("undefined label `{l}`")),
-                    }
-                } else {
-                    vm.pc += 1;
-                }
-            }
-            Instr::Jmp(l) => match prog.label_index(l) {
-                Some(i) => vm.pc = i,
-                None => return AsmRun::Fault(format!("undefined label `{l}`")),
-            },
-            Instr::Call(l) => {
-                if vm.stack.len() as u64 >= vm.caps.stack {
-                    return AsmRun::HitCap;
-                }
-                let Some(target) = prog.label_index(l) else {
-                    return AsmRun::Fault(format!("undefined label `{l}`"));
-                };
-                // Bound the cumulative words held across saved frames *before* cloning `locals`: a
-                // legal-but-large register bank (see `MAX_REGISTERS`) cloned on every self-recursive
-                // `Call` can accumulate tens of GB across frames well before the stack-count cap
-                // fires, and an allocation failure there aborts the process. Checking first means we
-                // never perform the clone that would have pushed us over.
-                let prospective = vm.saved_words + vm.locals.len() as u64;
-                if prospective > vm.caps.mem {
-                    return AsmRun::HitCap;
-                }
-                vm.stack.push(Frame { ret_pc: vm.pc + 1, saved_locals: vm.locals.clone() });
-                vm.saved_words = prospective;
-                vm.pc = target;
-            }
-            Instr::Ret => match vm.stack.pop() {
-                Some(frame) => {
-                    vm.saved_words -= frame.saved_locals.len() as u64;
-                    vm.locals = frame.saved_locals;
-                    vm.pc = frame.ret_pc;
-                }
-                // `ret` with an empty stack ends the program (equivalent to `halt`).
-                None => return AsmRun::Ran(AsmOutcome { result: vm.rr, heap: std::mem::take(&mut vm.heap) }),
-            },
-            Instr::Halt => return AsmRun::Ran(AsmOutcome { result: vm.rr, heap: std::mem::take(&mut vm.heap) }),
-            Instr::Nil(rd) => {
-                vm.write(*rd, 0);
-                vm.pc += 1;
-            }
-            Instr::Cons(rd, rh, rt) => {
-                if vm.heap.len() as u64 >= vm.caps.heap {
-                    return AsmRun::HitCap;
-                }
-                let (h, t) = (vm.read(*rh), vm.read(*rt));
-                vm.heap.push((h, t));
-                let ptr = vm.heap.len() as u64; // 1-based
-                vm.write(*rd, ptr);
-                vm.pc += 1;
-            }
-            Instr::Head(rd, rl) => {
-                let p = vm.read(*rl);
-                if p == 0 {
-                    return AsmRun::Fault("head of empty list".to_string());
-                }
-                // A non-null pointer past the heap end is a dangling pointer: fault, never index. `p`
-                // is a register value a program can set to any `u64` (an `Li` immediate, or arithmetic
-                // over one), so `p - 1` may not fit `usize` on a 32-bit target; `try_from` routes that
-                // case to the same fault as an in-range-but-past-the-end pointer, rather than
-                // truncating into a wrong, in-range index that would read the wrong heap cell.
-                let Some(&(h, _)) = usize::try_from(p - 1).ok().and_then(|idx| vm.heap.get(idx)) else {
-                    return AsmRun::Fault("head of invalid list pointer".to_string());
-                };
-                vm.write(*rd, h);
-                vm.pc += 1;
-            }
-            Instr::Tail(rd, rl) => {
-                let p = vm.read(*rl);
-                if p == 0 {
-                    return AsmRun::Fault("tail of empty list".to_string());
-                }
-                // Same truncation hazard as `Head` above, and the same fix: never let a `p` that does
-                // not fit `usize` alias into a small, in-range index.
-                let Some(&(_, t)) = usize::try_from(p - 1).ok().and_then(|idx| vm.heap.get(idx)) else {
-                    return AsmRun::Fault("tail of invalid list pointer".to_string());
-                };
-                vm.write(*rd, t);
-                vm.pc += 1;
-            }
-            Instr::IsEmpty(rd, rl) => {
-                let empty = u64::from(vm.read(*rl) == 0);
-                vm.write(*rd, empty);
-                vm.pc += 1;
-            }
-            Instr::Box(rd, rv) => {
-                if vm.boxes.len() as u64 >= vm.caps.heap {
-                    return AsmRun::HitCap;
-                }
-                let v = vm.read(*rv);
-                vm.boxes.push(v);
-                let ptr = vm.boxes.len() as u64; // 1-based
-                vm.write(*rd, ptr);
-                vm.pc += 1;
-            }
-            Instr::BoxGet(rd, rb) => {
-                let p = vm.read(*rb);
-                if p == 0 {
-                    return AsmRun::Fault("box_get of null handle".to_string());
-                }
-                // Same truncation hazard as `Head`/`Tail` above.
-                let Some(&v) = usize::try_from(p - 1).ok().and_then(|idx| vm.boxes.get(idx)) else {
-                    return AsmRun::Fault("box_get of invalid handle".to_string());
-                };
-                vm.write(*rd, v);
-                vm.pc += 1;
-            }
-            Instr::BoxSet(rb, rv) => {
-                let p = vm.read(*rb);
-                if p == 0 {
-                    return AsmRun::Fault("box_set of null handle".to_string());
-                }
-                let v = vm.read(*rv);
-                // Same truncation hazard as `Head`/`Tail`/`BoxGet` above.
-                let Some(slot) = usize::try_from(p - 1).ok().and_then(|idx| vm.boxes.get_mut(idx)) else {
-                    return AsmRun::Fault("box_set of invalid handle".to_string());
-                };
-                *slot = v;
-                vm.pc += 1;
-            }
-        }
+    let mut cursor = AsmCursor::new(prog, caps);
+    for _ in cursor.by_ref() {}
+    match cursor.status().cloned() {
+        Some(AsmStatus::Halted) => AsmRun::Ran(cursor.into_outcome()),
+        Some(AsmStatus::Faulted(why)) => AsmRun::Fault(why),
+        Some(AsmStatus::Capped(_)) | None => AsmRun::HitCap,
     }
 }
 
diff --git a/crates/redextape-core/src/trace.rs b/crates/redextape-core/src/trace.rs
index 50b318a..7cc3961 100644
--- a/crates/redextape-core/src/trace.rs
+++ b/crates/redextape-core/src/trace.rs
@@ -22,6 +22,7 @@ use std::borrow::Borrow;
 mod asm_cursor;
 mod zipper;
 
+pub use asm_cursor::{AsmCap, AsmCursor, AsmFrame, AsmStatus, AsmStep};
 pub use zipper::ZipperCursor;
 
 /// One step of either backend. `Delta`'s `state` is the state BEFORE the transition, matching the
diff --git a/crates/redextape-core/src/trace/asm_cursor.rs b/crates/redextape-core/src/trace/asm_cursor.rs
index 94153bd..8ffccbf 100644
--- a/crates/redextape-core/src/trace/asm_cursor.rs
+++ b/crates/redextape-core/src/trace/asm_cursor.rs
@@ -1,3 +1,386 @@
+//! Lazy asm stepping, and THE asm interpreter in this crate. `tm::asm::run_asm` is written over this
+//! cursor, so the fetch-decode-execute loop exists once — the arrangement `TmCursor` already has with
+//! the simulator. The machine state below is what `run_asm` held privately before it stepped; it moved
+//! here rather than being copied, so the two cannot disagree about what an instruction does.
+//!
+//! **AN ASM STEP IS NOT A `StepEvent`.** `StepEvent`'s consumers end their loops on a variant they do not
+//! recognise (its own test `every_step_event_variant_has_a_declared_producer` says why), and nothing
+//! consumes asm steps generically beside the other two legs. So this cursor yields its own `AsmStep`.
+//!
+//! **THE GUARD ORDER IS `run_asm`'S SEMANTICS.** Per step: a latched status ends the run; then the step
+//! cap; then fetching past the end of `code` faults; then the instruction runs, and its own cap or fault
+//! ends the run before it has changed anything. Only an instruction that completes counts as a step, so a
+//! run capped at exactly the steps it needs halts rather than capping — `halt` is itself a step.
+
+use crate::core::BinOp;
+use crate::tm::asm::{AsmOutcome, Caps, Instr, Program, Reg, instr_reg_over_cap};
+use std::borrow::Borrow;
+
+/// One executed instruction: its index in `Program::code`.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+pub struct AsmStep {
+    pub pc: usize,
+}
+
+/// Which cap stopped a run. A UI needs the distinction: raising the step cap resumes a run capped on
+/// steps and cannot help one capped on its stack, heap or saved-frame memory.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+pub enum AsmCap {
+    Steps,
+    Stack,
+    Heap,
+    Mem,
+}
+
+/// Why a run ended. `None` from `AsmCursor::status` means it has not.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub enum AsmStatus {
+    /// Ran `halt`, or `ret` with an empty call stack. The program's result is in `rr`.
+    Halted,
+    /// A runtime fault, with the text `AsmRun::Fault` carries. The faulting instruction did not
+    /// complete, so `pc` still names it — except for a run that fell off the end of `code`, where `pc` is
+    /// one past the last instruction.
+    Faulted(String),
+    /// A cap refused the instruction at `pc` before it changed anything.
+    Capped(AsmCap),
+}
+
+/// One saved call frame: where `ret` resumes, and the caller's locals as they were at the `call`.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub struct AsmFrame {
+    pub ret_pc: usize,
+    pub saved_locals: Vec<u64>,
+}
+
+/// The register machine's state. Kept apart from the program so a step can borrow the program and
+/// mutate the state at once.
+#[derive(Clone, Debug, Default)]
+struct Vm {
+    locals: Vec<u64>,
+    args: Vec<u64>,
+    rr: u64,
+    heap: Vec<(u64, u64)>,
+    boxes: Vec<u64>,
+    stack: Vec<AsmFrame>,
+    pc: usize,
+    steps: u64,
+    /// Running total of words held across all frames currently on `stack` (the sum of
+    /// `saved_locals.len()`), tracked incrementally so `call` and `ret` stay O(1).
+    saved_words: u64,
+}
+
+impl Vm {
+    fn read(&self, r: Reg) -> u64 {
+        match r {
+            Reg::Loc(n) => self.locals.get(n as usize).copied().unwrap_or(0),
+            Reg::Arg(n) => self.args.get(n as usize).copied().unwrap_or(0),
+            Reg::Rr => self.rr,
+        }
+    }
+
+    fn write(&mut self, r: Reg, v: u64) {
+        match r {
+            Reg::Loc(n) => grow_set(&mut self.locals, n as usize, v),
+            Reg::Arg(n) => grow_set(&mut self.args, n as usize, v),
+            Reg::Rr => self.rr = v,
+        }
+    }
+
+    /// Run the instruction at `pc`. `Ok(true)` when it ended the program, `Ok(false)` when the run goes
+    /// on, `Err` when a cap or fault refused it.
+    ///
+    /// `clippy::too_many_lines`: one arm per `Instr` variant — the length tracks the instruction set,
+    /// not any one arm's complexity.
+    ///
+    /// `#[inline]` because `next` is this function's only caller and `run_asm` calls `next` once per
+    /// instruction: on a 1,400,009-step loop `run_asm` measured 6.8 ms without the hint and 5.7 ms with
+    /// it, against 3.9 ms for the loop this cursor replaced.
+    #[allow(clippy::too_many_lines)]
+    #[inline]
+    fn exec(&mut self, prog: &Program, caps: &Caps) -> Result<bool, AsmStatus> {
+        let Some(instr) = prog.code.get(self.pc) else {
+            // Falling off the end without `halt`/`ret` is a lowering invariant violation; a fault rather
+            // than a panic.
+            return Err(AsmStatus::Faulted("ran past end of program".to_string()));
+        };
+        match instr {
+            Instr::Li(rd, n) => {
+                self.write(*rd, *n);
+                self.pc += 1;
+            }
+            Instr::Mov(rd, rs) => {
+                let v = self.read(*rs);
+                self.write(*rd, v);
+                self.pc += 1;
+            }
+            Instr::Bin(op, rd, ra, rb) => {
+                let v = eval_bin(*op, self.read(*ra), self.read(*rb));
+                self.write(*rd, v);
+                self.pc += 1;
+            }
+            Instr::Jz(r, l) => {
+                if self.read(*r) == 0 {
+                    self.pc = jump(prog, l)?;
+                } else {
+                    self.pc += 1;
+                }
+            }
+            Instr::Jmp(l) => self.pc = jump(prog, l)?,
+            Instr::Call(l) => {
+                if self.stack.len() as u64 >= caps.stack {
+                    return Err(AsmStatus::Capped(AsmCap::Stack));
+                }
+                let target = jump(prog, l)?;
+                // Bound the words held across saved frames BEFORE cloning `locals`: a wide register bank
+                // cloned on every self-recursive `call` can reach tens of GB well before the frame-count
+                // cap fires, and an allocation failure aborts the process. Checking first means the clone
+                // that would have crossed the cap is never made.
+                let prospective = self.saved_words + self.locals.len() as u64;
+                if prospective > caps.mem {
+                    return Err(AsmStatus::Capped(AsmCap::Mem));
+                }
+                self.stack.push(AsmFrame { ret_pc: self.pc + 1, saved_locals: self.locals.clone() });
+                self.saved_words = prospective;
+                self.pc = target;
+            }
+            Instr::Ret => match self.stack.pop() {
+                Some(frame) => {
+                    self.saved_words -= frame.saved_locals.len() as u64;
+                    self.locals = frame.saved_locals;
+                    self.pc = frame.ret_pc;
+                }
+                // `ret` with an empty stack ends the program, as `halt` does.
+                None => return Ok(true),
+            },
+            Instr::Halt => return Ok(true),
+            Instr::Nil(rd) => {
+                self.write(*rd, 0);
+                self.pc += 1;
+            }
+            Instr::Cons(rd, rh, rt) => {
+                if self.heap.len() as u64 >= caps.heap {
+                    return Err(AsmStatus::Capped(AsmCap::Heap));
+                }
+                let (h, t) = (self.read(*rh), self.read(*rt));
+                self.heap.push((h, t));
+                let ptr = self.heap.len() as u64; // 1-based
+                self.write(*rd, ptr);
+                self.pc += 1;
+            }
+            Instr::Head(rd, rl) => {
+                let (h, _) = cell(&self.heap, self.read(*rl), "head")?;
+                self.write(*rd, h);
+                self.pc += 1;
+            }
+            Instr::Tail(rd, rl) => {
+                let (_, t) = cell(&self.heap, self.read(*rl), "tail")?;
+                self.write(*rd, t);
+                self.pc += 1;
+            }
+            Instr::IsEmpty(rd, rl) => {
+                let empty = u64::from(self.read(*rl) == 0);
+                self.write(*rd, empty);
+                self.pc += 1;
+            }
+            Instr::Box(rd, rv) => {
+                if self.boxes.len() as u64 >= caps.heap {
+                    return Err(AsmStatus::Capped(AsmCap::Heap));
+                }
+                let v = self.read(*rv);
+                self.boxes.push(v);
+                let ptr = self.boxes.len() as u64; // 1-based
+                self.write(*rd, ptr);
+                self.pc += 1;
+            }
+            Instr::BoxGet(rd, rb) => {
+                let idx = box_index(&self.boxes, self.read(*rb), "box_get")?;
+                // `box_index` has just checked `idx` against `boxes`, so this `get` cannot miss.
+                let v = self.boxes.get(idx).copied().unwrap_or(0);
+                self.write(*rd, v);
+                self.pc += 1;
+            }
+            Instr::BoxSet(rb, rv) => {
+                let idx = box_index(&self.boxes, self.read(*rb), "box_set")?;
+                let v = self.read(*rv);
+                if let Some(slot) = self.boxes.get_mut(idx) {
+                    *slot = v;
+                }
+                self.pc += 1;
+            }
+        }
+        Ok(false)
+    }
+}
+
+fn grow_set(v: &mut Vec<u64>, i: usize, val: u64) {
+    if i >= v.len() {
+        v.resize(i + 1, 0);
+    }
+    v[i] = val;
+}
+
+fn eval_bin(op: BinOp, a: u64, b: u64) -> u64 {
+    match op {
+        BinOp::Add => a.saturating_add(b),
+        BinOp::Sub => a.saturating_sub(b), // monus
+        BinOp::Mul => a.saturating_mul(b),
+        BinOp::Eq => u64::from(a == b),
+        BinOp::Ne => u64::from(a != b),
+        BinOp::Lt => u64::from(a < b),
+        BinOp::Le => u64::from(a <= b),
+        BinOp::Gt => u64::from(a > b),
+        BinOp::Ge => u64::from(a >= b),
+    }
+}
+
+/// The index a jump or call lands on, or the fault `run_asm` has always reported for an undefined label.
+fn jump(prog: &Program, label: &str) -> Result<usize, AsmStatus> {
+    prog.label_index(label).ok_or_else(|| AsmStatus::Faulted(format!("undefined label `{label}`")))
+}
+
+/// The heap cell a list pointer names. Null faults as "`op` of empty list"; a pointer past the heap's end
+/// faults as "`op` of invalid list pointer", never an index. `p` is a register word a program can set to
+/// any `u64`, so `p - 1` may not fit `usize` on a 32-bit target; `try_from` routes that case to the same
+/// fault rather than truncating into a wrong, in-range index.
+fn cell(heap: &[(u64, u64)], p: u64, op: &str) -> Result<(u64, u64), AsmStatus> {
+    if p == 0 {
+        return Err(AsmStatus::Faulted(format!("{op} of empty list")));
+    }
+    usize::try_from(p - 1)
+        .ok()
+        .and_then(|idx| heap.get(idx).copied())
+        .ok_or_else(|| AsmStatus::Faulted(format!("{op} of invalid list pointer")))
+}
+
+/// The box a handle names, by the same rules as `cell`: null and dangling handles fault.
+fn box_index(boxes: &[u64], p: u64, op: &str) -> Result<usize, AsmStatus> {
+    if p == 0 {
+        return Err(AsmStatus::Faulted(format!("{op} of null handle")));
+    }
+    usize::try_from(p - 1)
+        .ok()
+        .filter(|idx| *idx < boxes.len())
+        .ok_or_else(|| AsmStatus::Faulted(format!("{op} of invalid handle")))
+}
+
+/// Lazy asm stepping over a borrowed or owned `Program`, one instruction per `next`.
+pub struct AsmCursor<P> {
+    prog: P,
+    vm: Vm,
+    caps: Caps,
+    status: Option<AsmStatus>,
+}
+
+impl<P: Borrow<Program>> AsmCursor<P> {
+    /// A cursor about to run `prog`'s instruction 0.
+    ///
+    /// A register index at or over `MAX_REGISTERS` anywhere in `prog` faults here, before any step: an
+    /// unbounded `Reg::Loc(n)` would make a write attempt a multi-GB `Vec::resize`, whose allocation
+    /// failure aborts. One O(code) scan up front costs nothing per step.
+    pub fn new(prog: P, caps: Caps) -> AsmCursor<P> {
+        let status = prog
+            .borrow()
+            .code
+            .iter()
+            .any(instr_reg_over_cap)
+            .then(|| AsmStatus::Faulted("register index exceeds MAX_REGISTERS".to_string()));
+        AsmCursor { prog, vm: Vm::default(), caps, status }
+    }
+
+    /// The program being stepped.
+    pub fn program(&self) -> &Program {
+        self.prog.borrow()
+    }
+
+    /// The instruction about to run — or, once the run has ended, the one that halted, faulted or was
+    /// capped. A run that fell off the end of `code` leaves it one past the last instruction.
+    pub fn pc(&self) -> usize {
+        self.vm.pc
+    }
+
+    pub fn rr(&self) -> u64 {
+        self.vm.rr
+    }
+
+    /// The local registers `r0…`, as far as the highest one written. A register past the end reads 0.
+    pub fn locals(&self) -> &[u64] {
+        &self.vm.locals
+    }
+
+    /// The argument registers `a0…`, as far as the highest one written.
+    pub fn args(&self) -> &[u64] {
+        &self.vm.args
+    }
+
+    /// The saved call frames, oldest first.
+    pub fn stack(&self) -> &[AsmFrame] {
+        &self.vm.stack
+    }
+
+    /// The cons cells, in allocation order; list pointer `p` names cell `p - 1`.
+    pub fn heap(&self) -> &[(u64, u64)] {
+        &self.vm.heap
+    }
+
+    /// The boxes, in allocation order; handle `p` names box `p - 1`.
+    pub fn boxes(&self) -> &[u64] {
+        &self.vm.boxes
+    }
+
+    /// Instructions completed. `halt` counts; a faulted or capped instruction does not.
+    pub fn steps_taken(&self) -> u64 {
+        self.vm.steps
+    }
+
+    /// `None` while the run may still advance; `Some` once it has ended, saying why.
+    pub fn status(&self) -> Option<&AsmStatus> {
+        self.status.as_ref()
+    }
+
+    /// Extend the step budget, additively and saturating, and resume a run the STEP cap stopped. A run
+    /// stopped by any other cap, halted or faulted stays stopped: more steps cannot give it a deeper stack,
+    /// a larger heap or a different answer.
+    pub fn raise_cap(&mut self, extra_steps: u64) {
+        self.caps.steps = self.caps.steps.saturating_add(extra_steps);
+        if self.status == Some(AsmStatus::Capped(AsmCap::Steps)) {
+            self.status = None;
+        }
+    }
+
+    /// The result word and the heap a decode needs, for a caller that has driven the run to its end.
+    pub fn into_outcome(self) -> AsmOutcome {
+        AsmOutcome { result: self.vm.rr, heap: self.vm.heap }
+    }
+}
+
+impl<P: Borrow<Program>> Iterator for AsmCursor<P> {
+    type Item = AsmStep;
+
+    fn next(&mut self) -> Option<AsmStep> {
+        if self.status.is_some() {
+            return None;
+        }
+        if self.vm.steps >= self.caps.steps {
+            self.status = Some(AsmStatus::Capped(AsmCap::Steps));
+            return None;
+        }
+        let pc = self.vm.pc;
+        match self.vm.exec(self.prog.borrow(), &self.caps) {
+            Ok(ended) => {
+                self.vm.steps += 1;
+                if ended {
+                    self.status = Some(AsmStatus::Halted);
+                }
+                Some(AsmStep { pc })
+            }
+            Err(stop) => {
+                self.status = Some(stop);
+                None
+            }
+        }
+    }
+}
+
 #[cfg(test)]
 mod tests {
     use super::*;
diff --git a/crates/redextape-native-rt/src/lib.rs b/crates/redextape-native-rt/src/lib.rs
index 3b34e46..da253e2 100644
--- a/crates/redextape-native-rt/src/lib.rs
+++ b/crates/redextape-native-rt/src/lib.rs
@@ -1,7 +1,7 @@
 //! `redextape-native-rt`: the native backend's runtime — heap/box arenas plus the `extern "C"`
 //! host functions that JIT-generated code (Task 4) calls for heap allocation, faults, and cap
-//! checks. Semantics mirror `redextape_core::tm::asm::run_asm`'s `Cons`/`Head`/`Tail`/`IsEmpty`/
-//! `Box`/`BoxGet`/`BoxSet` arms EXACTLY: 1-based heap/box pointers, `0` = nil, the same fault and
+//! checks. Semantics mirror the asm interpreter's `Cons`/`Head`/`Tail`/`IsEmpty`/`Box`/`BoxGet`/`BoxSet`
+//! arms (`redextape_core::trace::AsmCursor`, which `run_asm` loops over) EXACTLY: 1-based heap/box pointers, `0` = nil, the same fault and
 //! cap conditions. This is what lets the native backend reuse `decode_asm` and agree with the asm
 //! interpreter in the oracle.
 //!
@@ -26,9 +26,10 @@ use redextape_core::ty::Ty;
 /// The native backend's runtime state: heap/box arenas, step/depth counters, and fault/cap
 /// flags. JIT-generated code (Task 4) holds a `*mut Runtime` for the duration of a run and calls
 /// the `rt_*` host functions below for every heap/box operation and every cap check, mirroring
-/// `run_asm`'s `Vm` one-for-one (`heap`/`boxes`/`steps`/`caps` are the same fields; `depth` plays
-/// the role `Vm::stack.len()` plays for the stack cap, without needing the actual frame data —
-/// the JIT-generated code keeps locals on the native stack instead of a `Vec<Frame>`).
+/// the asm interpreter's machine state (`trace::AsmCursor`) one-for-one (`heap`/`boxes`/`steps`/`caps`
+/// are the same fields; `depth` plays the role the cursor's `stack().len()` plays for the stack cap,
+/// without needing the actual frame data — the JIT-generated code keeps locals on the native stack
+/// instead of a `Vec<AsmFrame>`).
 pub struct Runtime {
     pub heap: Vec<(u64, u64)>,
     pub boxes: Vec<u64>,
@@ -36,7 +37,7 @@ pub struct Runtime {
     pub depth: u64,
     pub caps: Caps,
     /// The recursion-depth limit `rt_enter` trips at. Distinct from `caps.stack` because native
-    /// keeps each frame's locals on the *real* OS call stack (not a `Vec<Frame>`), so the backend
+    /// keeps each frame's locals on the *real* OS call stack (not a `Vec<AsmFrame>`), so the backend
     /// derives a FRAME-SIZE-AWARE cap: `min(caps.stack, safe_depth)`, where `safe_depth` is how many
     /// worst-case frames fit in the run thread's reserved stack (see `redextape_native::codegen`).
     /// This guarantees the depth cap always trips *before* the native stack overflows, for any
@@ -81,15 +82,15 @@ impl Runtime {
     }
 
     /// Finish a run: pair the register-`rr` result word with the heap needed to decode it,
-    /// mirroring `run_asm`'s `AsmRun::Ran(AsmOutcome { result: vm.rr, heap: vm.heap })`.
+    /// mirroring `AsmCursor::into_outcome`, which `run_asm` answers `AsmRun::Ran` with.
     #[must_use]
     pub fn into_outcome(self, result: u64) -> AsmOutcome {
         AsmOutcome { result, heap: self.heap }
     }
 }
 
-/// `rd <- cons(rh, rt)`. Mirrors `run_asm`'s `Instr::Cons` arm: cap-checks `heap.len()` against
-/// `caps.heap` (matching `vm.heap.len() as u64 >= vm.caps.heap`), else pushes `(h, t)` and
+/// `rd <- cons(rh, rt)`. Mirrors the asm interpreter's `Instr::Cons` arm: cap-checks `heap.len()` against
+/// `caps.heap` (matching `self.heap.len() as u64 >= caps.heap`), else pushes `(h, t)` and
 /// returns the new 1-based pointer (`heap.len()` after the push).
 ///
 /// # Safety
@@ -109,7 +110,7 @@ pub unsafe extern "C" fn rt_cons(rt: *mut Runtime, h: u64, t: u64) -> u64 {
     rt.heap.len() as u64 // 1-based
 }
 
-/// `rd <- head(rl)`. Mirrors `run_asm`'s `Instr::Head` arm: `p == 0` faults ("head of empty
+/// `rd <- head(rl)`. Mirrors the asm interpreter's `Instr::Head` arm: `p == 0` faults ("head of empty
 /// list"); a non-null pointer past the heap end faults ("head of invalid list pointer") rather
 /// than indexing out of bounds; else returns the cell's head field.
 ///
@@ -137,7 +138,7 @@ pub unsafe extern "C" fn rt_head(rt: *mut Runtime, p: u64) -> u64 {
     }
 }
 
-/// `rd <- tail(rl)`. Mirrors `run_asm`'s `Instr::Tail` arm: `p == 0` faults ("tail of empty
+/// `rd <- tail(rl)`. Mirrors the asm interpreter's `Instr::Tail` arm: `p == 0` faults ("tail of empty
 /// list"); a dangling pointer faults ("tail of invalid list pointer"); else returns the cell's
 /// tail field.
 ///
@@ -163,7 +164,7 @@ pub unsafe extern "C" fn rt_tail(rt: *mut Runtime, p: u64) -> u64 {
     }
 }
 
-/// `rd <- is_empty(rl)`. Mirrors `run_asm`'s `Instr::IsEmpty` arm: `1` if `p == 0`, else `0`.
+/// `rd <- is_empty(rl)`. Mirrors the asm interpreter's `Instr::IsEmpty` arm: `1` if `p == 0`, else `0`.
 /// Never faults and never touches the heap, so it is not gated by `stopped` (there is nothing for
 /// it to corrupt).
 ///
@@ -174,9 +175,9 @@ pub unsafe extern "C" fn rt_is_empty(_rt: *mut Runtime, p: u64) -> u64 {
     u64::from(p == 0)
 }
 
-/// `rd <- box(rv)`. Mirrors `run_asm`'s `Instr::Box` arm: cap-checks `boxes.len()` against
-/// `caps.heap` (the box arena shares the heap cap, matching `vm.boxes.len() as u64 >=
-/// vm.caps.heap`), else pushes `v` and returns the new 1-based pointer.
+/// `rd <- box(rv)`. Mirrors the asm interpreter's `Instr::Box` arm: cap-checks `boxes.len()` against
+/// `caps.heap` (the box arena shares the heap cap, matching `self.boxes.len() as u64 >=
+/// caps.heap`), else pushes `v` and returns the new 1-based pointer.
 ///
 /// # Safety
 /// `rt` must be a valid, non-null, non-aliased `*mut Runtime` for the duration of the call.
@@ -194,7 +195,7 @@ pub unsafe extern "C" fn rt_box(rt: *mut Runtime, v: u64) -> u64 {
     rt.boxes.len() as u64 // 1-based
 }
 
-/// `rd <- box_get(rb)`. Mirrors `run_asm`'s `Instr::BoxGet` arm: `p == 0` faults ("box_get of
+/// `rd <- box_get(rb)`. Mirrors the asm interpreter's `Instr::BoxGet` arm: `p == 0` faults ("box_get of
 /// null handle"); a dangling handle faults ("box_get of invalid handle"); else returns the box's
 /// value.
 ///
@@ -226,7 +227,7 @@ pub unsafe extern "C" fn rt_box_get(rt: *mut Runtime, p: u64) -> u64 {
     }
 }
 
-/// `box_set(rb, rv)`. Mirrors `run_asm`'s `Instr::BoxSet` arm: `p == 0` faults ("box_set of null
+/// `box_set(rb, rv)`. Mirrors the asm interpreter's `Instr::BoxSet` arm: `p == 0` faults ("box_set of null
 /// handle"); a dangling handle faults ("box_set of invalid handle"); else overwrites the box in
 /// place.
 ///
@@ -253,8 +254,8 @@ pub unsafe extern "C" fn rt_box_set(rt: *mut Runtime, p: u64, v: u64) {
     }
 }
 
-/// Advance the step counter by one, mirroring `run_asm`'s per-instruction step-cap check
-/// (`vm.steps`/`vm.caps.steps`). Returns `1` (a trip signal for the generated code to branch on)
+/// Advance the step counter by one, mirroring the asm interpreter's per-instruction step-cap check
+/// (`steps`/`caps.steps`). Returns `1` (a trip signal for the generated code to branch on)
 /// once `steps` exceeds `caps.steps`, setting `hit_cap`; else `0`.
 ///
 /// # Safety
@@ -278,9 +279,9 @@ pub unsafe extern "C" fn rt_tick(rt: *mut Runtime) -> u64 {
     0
 }
 
-/// Enter a call frame, incrementing `depth`, mirroring `run_asm`'s `Instr::Call` stack-cap check
-/// (`vm.stack.len()`/`vm.caps.stack`) — the JIT-generated code keeps locals on the native call
-/// stack rather than a `Vec<Frame>`, so `depth` is the counter that stands in for `stack.len()`.
+/// Enter a call frame, incrementing `depth`, mirroring the asm interpreter's `Instr::Call` stack-cap check
+/// (`self.stack.len()`/`caps.stack`) — the JIT-generated code keeps locals on the native call
+/// stack rather than a `Vec<AsmFrame>`, so `depth` is the counter that stands in for `stack.len()`.
 /// Returns `1` (a trip signal) once `depth` exceeds `depth_cap`, setting `hit_cap`; else `0`.
 ///
 /// The cap is `depth_cap` (the frame-size-aware `min(caps.stack, safe_depth)` the backend supplied),
@@ -307,8 +308,8 @@ pub unsafe extern "C" fn rt_enter(rt: *mut Runtime) -> u64 {
     0
 }
 
-/// Leave a call frame, decrementing `depth`, mirroring `run_asm`'s `Instr::Ret` popping a frame
-/// off `vm.stack`. Uses `saturating_sub` so a spurious `rt_leave` (e.g. one emitted on a path the
+/// Leave a call frame, decrementing `depth`, mirroring the asm interpreter's `Instr::Ret` popping a frame
+/// off the cursor's call stack. Uses `saturating_sub` so a spurious `rt_leave` (e.g. one emitted on a path the
 /// matching `rt_enter` never reached) can never wrap `depth` around — defense in depth, not a case
 /// the generated code is expected to hit.
 ///
diff --git a/crates/redextape-native/src/aot.rs b/crates/redextape-native/src/aot.rs
index 3b4e6d1..69f5ef3 100644
--- a/crates/redextape-native/src/aot.rs
+++ b/crates/redextape-native/src/aot.rs
@@ -62,7 +62,7 @@ fn serialize_ty(ty: &Ty, out: &mut Vec<u8>) -> Result<(), AotError> {
 /// [32..)   Ty, tag-encoded (see `serialize_ty`)
 /// ```
 ///
-/// `caps.mem` is intentionally omitted: it bounds the reference interpreter's cloned-`Vec<Frame>`
+/// `caps.mem` is intentionally omitted: it bounds the reference interpreter's cloned-`Vec<AsmFrame>`
 /// words and has no native analog (native recursion is bounded by `depth_cap` instead — see
 /// `shared::native_depth_cap`).
 fn serialize_config(caps: Caps, depth_cap: u64, ty: &Ty) -> Result<Vec<u8>, AotError> {
diff --git a/crates/redextape-native/src/codegen.rs b/crates/redextape-native/src/codegen.rs
index 35bab4d..63713ce 100644
--- a/crates/redextape-native/src/codegen.rs
+++ b/crates/redextape-native/src/codegen.rs
@@ -237,7 +237,7 @@ fn emit_cmp(b: &mut FunctionBuilder, cc: IntCC, x: Value, y: Value) -> Value {
     b.ins().uextend(types::I64, c)
 }
 
-/// Emit `x op y` per `run_asm`'s `eval_bin`. All words are `u64`, so: `Add`/`Mul` SATURATE at
+/// Emit `x op y` per the asm interpreter's `eval_bin` (`trace::AsmCursor`). All words are `u64`, so: `Add`/`Mul` SATURATE at
 /// `u64::MAX` on overflow (matching `saturating_add`/`saturating_mul`); `Sub` is saturating monus
 /// `x - min(x, y)`; comparisons are UNSIGNED. Cranelift 0.134 has no scalar `*_sat` (those are SIMD
 /// lane ops that don't lower for i64), so we detect overflow and clamp: `uadd_overflow`/
diff --git a/crates/redextape-native/src/jit.rs b/crates/redextape-native/src/jit.rs
index 447d52f..65550e2 100644
--- a/crates/redextape-native/src/jit.rs
+++ b/crates/redextape-native/src/jit.rs
@@ -204,7 +204,7 @@ fn build_and_run(prog: &Program, subs: &[Subroutine], caps: Caps, opt: OptLevel)
     // `module` outlives this call, so the code stays mapped and executable.
     let main: extern "C" fn(*mut Runtime) -> u64 = unsafe { std::mem::transmute::<*const u8, _>(code) };
 
-    // `caps.mem` (the reference's cap on words held across cloned `Vec<Frame>` locals) has no native
+    // `caps.mem` (the reference's cap on words held across cloned `Vec<AsmFrame>` locals) has no native
     // analog: each subroutine's `Loc`/`Arg` are fixed-size `Variable`s on the real call stack, so a
     // `Call` clones nothing. Native recursion is instead bounded by the frame-size-aware
     // `native_depth_cap` (= `min(caps.stack, safe_depth)`) via `rt_enter`'s depth counter, checked
@@ -858,7 +858,7 @@ mod tests {
     ///
     /// Each `Loc(i)` is seeded by its own `Li` before being read, so no instruction here READS a
     /// `Loc` this body has not already written: `run_asm`'s `Call` leaves the caller's locals in
-    /// `vm.locals`, so a callee INHERITS them, whereas the native backends give each callee a zeroed
+    /// place, so a callee INHERITS them, whereas the native backends give each callee a zeroed
     /// bank. This helper's program is only ever asserted to `HitCap` (never compared against
     /// `run_asm`), but keeping it inside the definite-assignment contract every `lower_asm`/`defunc`
     /// output satisfies means it stays usable in an agreement test too.
diff --git a/crates/redextape-native/src/llvm.rs b/crates/redextape-native/src/llvm.rs
index 24d0a78..d0f2e49 100644
--- a/crates/redextape-native/src/llvm.rs
+++ b/crates/redextape-native/src/llvm.rs
@@ -355,7 +355,7 @@ fn map_rt_symbols(ee: &ExecutionEngine<'_>, module: &Module<'_>) {
     }
 }
 
-/// The intrinsics the SATURATING arithmetic arms lower to. `run_asm`'s `eval_bin` uses
+/// The intrinsics the SATURATING arithmetic arms lower to. The asm interpreter's `eval_bin` uses
 /// `saturating_add`/`saturating_mul` and monus, so plain `add`/`mul`/`sub` (which WRAP) would
 /// disagree with the reference on overflow — the exact bug the Cranelift backend shipped once and
 /// had to fix, so it is a known trap rather than a hypothetical.
@@ -518,7 +518,7 @@ fn emit_cmp<'ctx>(
     b.build_int_z_extend(bit, ctx.i64_type(), "cmpw").map_err(ir_err)
 }
 
-/// Emit `x op y` per `run_asm`'s `eval_bin`, mirroring `codegen::emit_bin` arm for arm. All words are
+/// Emit `x op y` per the asm interpreter's `eval_bin`, mirroring `codegen::emit_bin` arm for arm. All words are
 /// `u64`, so: `Add`/`Mul` SATURATE at `u64::MAX` on overflow; `Sub` is saturating monus; comparisons
 /// are UNSIGNED. The saturating arms are intrinsic calls (see `SatFns`), *never* plain `add`/`mul`.
 fn emit_bin<'ctx>(
diff --git a/crates/redextape-native/src/shared.rs b/crates/redextape-native/src/shared.rs
index a53e403..6036636 100644
--- a/crates/redextape-native/src/shared.rs
+++ b/crates/redextape-native/src/shared.rs
@@ -130,7 +130,7 @@ pub(crate) fn n_arg_vars(prog: &Program, sub: &Subroutine) -> u32 {
 /// The frame-size-aware recursion-depth cap: `min(caps.stack, safe_depth)`, where `safe_depth` is
 /// how many worst-case native frames fit in the reserved recursion budget.
 ///
-/// Native keeps each call frame's `Loc`/`Arg`/`Rr` on the REAL OS call stack (not a `Vec<Frame>`
+/// Native keeps each call frame's `Loc`/`Arg`/`Rr` on the REAL OS call stack (not a `Vec<AsmFrame>`
 /// like the reference) — as Cranelift `Variable`s, or as LLVM entry-block `alloca`s — so a program
 /// whose worst subroutine has many registers builds a fat native frame. If the plain depth cap
 /// (`caps.stack`) let such a program recurse that deep, it would overflow the run thread's stack —
````

- [ ] **Step 4: Run the tests** — the cursor's, then the whole workspace, which is spec §4.4's first check: every suite that holds `run_asm` against the reference interpreter, the TM and the native backends passes unchanged.

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(/asm_cursor/)'`
Expected: `6 tests run: 6 passed, 1303 skipped`

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run --workspace --no-fail-fast`
Expected: `1831 tests run: 1831 passed, 33 skipped`

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (`cargo nextest run -p redextape-core --no-fail-fast`, under the same cap; restore any regression seed a run writes):

| # | Sabotage | Fails |
|---|---|---|
| 1 | `asm_cursor.rs`, `Vm::exec`'s `Jz` arm: `if self.read(*r) == 0` → `!= 0` | `jz_and_jmp_branch`, `recursive_call_preserves_locals_across_the_call`, `a_binding_group_survives_defunctionalization`, `a_binding_group_lowers_and_runs_on_the_asm_interpreter`, `a_three_member_group_lowers_and_each_member_keeps_its_own_body`, `comparisons_and_if`, `count_down_with_a_call`, `each_call_in_a_group_reaches_the_member_it_names`, `recursion_via_fn`, `while_loop_and_mutation`, `a_run_capped_at_exactly_its_steps_halts`, `each_step_names_the_instruction_it_ran`, `the_stack_holds_each_frames_return_and_saved_locals`, `asm_agrees_with_reference_on_random_first_order_programs`, `asm_oracle_on_the_first_order_demo_suite`, `asm_interp_matches_tm_on_call_demos`, `asm_interp_matches_tm_on_control_flow_demos` |
| 2 | `asm_cursor.rs`, the `Call` arm: `ret_pc: self.pc + 1` → `ret_pc: self.pc` | `recursive_call_preserves_locals_across_the_call`, `a_binding_group_survives_defunctionalization`, `a_binding_group_lowers_and_runs_on_the_asm_interpreter`, `a_three_member_group_lowers_and_each_member_keeps_its_own_body`, `count_down_with_a_call`, `directly_applied_lambda_is_a_named_subroutine`, `each_call_in_a_group_reaches_the_member_it_names`, `multi_arg_call_with_a_nested_call_in_a_later_argument`, `recursion_via_fn`, `the_stack_holds_each_frames_return_and_saved_locals`, `asm_oracle_on_the_first_order_demo_suite`, `asm_oracle_on_the_latent_trap_programs`, `asm_interp_matches_tm_on_call_demos` |
| 3 | `asm_cursor.rs`, `next`: `self.vm.steps >= self.caps.steps` → `>` | `a_run_capped_at_exactly_its_steps_halts`, `each_cap_is_named_and_only_the_step_cap_resumes` |
| 4 | `asm_cursor.rs`, `raise_cap`: `self.status == Some(AsmStatus::Capped(AsmCap::Steps))` → `matches!(self.status, Some(AsmStatus::Capped(_)))` | `each_cap_is_named_and_only_the_step_cap_resumes` |
| 5 | `asm_cursor.rs`, the `Call` arm: `AsmStatus::Capped(AsmCap::Mem)` → `AsmStatus::Capped(AsmCap::Stack)` | `each_cap_is_named_and_only_the_step_cap_resumes` |
| 6 | `asm_cursor.rs`, `next`: move `self.vm.steps += 1;` from the `Ok` arm to just before `self.vm.exec(...)` | `a_fault_stops_on_the_faulting_instruction`, `each_cap_is_named_and_only_the_step_cap_resumes` |
| 7 | `asm_cursor.rs`, the `Head` arm: `self.pc += 1;` before the `cell` lookup and `self.pc -= 1;` after it | `a_fault_stops_on_the_faulting_instruction` |
| 8 | `asm_cursor.rs`, `AsmCursor::new`: `.any(instr_reg_over_cap)` → `.any(\|i\| instr_reg_over_cap(i) && false)` | `huge_register_index_faults_instead_of_aborting`, `an_over_cap_register_faults_before_any_step` |

- [ ] **Step 6: Run the gates.**

Run: `cargo fmt --all -- --check && systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy --workspace --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The asm interpreter steps: `AsmCursor` runs one instruction per `next`, and `run_asm` is a loop over it

The register machine's state moves out of `run_asm` into `trace::AsmCursor`, so an instruction's
meaning lives in one place and `run_asm` is its run-to-the-end reading. The cursor names which cap
stopped a run, so a caller can tell a step cap, which `raise_cap` resumes, from a stack, heap or
memory cap, which it cannot. Docs in `redextape-native` and `redextape-native-rt` that pointed at
`run_asm`'s arms and `Vm` now point at the cursor.
EOF
```

### Task 2: Each word is tagged by the instruction that made it, and each local says whether its frame wrote it

**Files:**
- Modify: `crates/redextape-core/src/trace/asm_cursor.rs`, `crates/redextape-core/src/trace.rs`

**Interfaces:**
- Consumes: Task 1's `AsmCursor`.
- Produces: `WordTag::{Value, List, Box}` (`Default` is `Value`), re-exported from `trace`; `AsmFrame` gains `saved_tags: Vec<WordTag>` and `saved_written: Vec<bool>`; `AsmCursor` gains `rr_tag() -> WordTag`, `local_tags() -> &[WordTag]`, `written() -> &[bool]`, `arg_tags() -> &[WordTag]`, `heap_tags() -> &[(WordTag, WordTag)]`, `box_tags() -> &[WordTag]` and `wrote() -> Option<Reg>`.

**The table** (spec §4.3 as amended): `li`, arithmetic, comparisons and `isempty` make a value; `cons` and `nil` a list; `box` a box; `mov`, `head`, `tail` and `box_get` copy the tag of the word they move — `head` and `tail` the one stored with that half of the cell. The tags live in vectors parallel to the words, so `into_outcome` still hands `run_asm` the heap without a copy and `mem` still counts words. `call` clears every written bit; `ret` restores the caller's. `exec` clears `wrote` before it runs, so after an instruction a fault or a stack, heap or memory cap refuses it is `None` — that instruction wrote nothing. Putting the last completed step's register back instead measured 6.3 → 7.5 ms on the 1,400,009-step loop, for a value only a caller reading the cursor after it stopped would see, and was not kept.

- [ ] **Step 1: Write the failing tests.** The table, row by row in one assertion; the written bits across a `call` and its `ret`; and `wrote` after an instruction a fault refuses.

````diff apply=tests task=2
diff --git a/crates/redextape-core/src/trace/asm_cursor.rs b/crates/redextape-core/src/trace/asm_cursor.rs
index 8ffccbf..bf70d9c 100644
--- a/crates/redextape-core/src/trace/asm_cursor.rs
+++ b/crates/redextape-core/src/trace/asm_cursor.rs
@@ -543,6 +543,96 @@ mod tests {
         assert!(c.status().is_some(), "a fault is not a budget");
     }
 
+    /// Every row of `WordTag`'s table, once. Cell 2 is hand-built with a VALUE in its tail, which no
+    /// compiled program makes: `tail` must copy that tag, not assume a list. `box_set` stores a value over
+    /// a list, so the `box_get` either side of it must disagree.
+    #[test]
+    fn every_instruction_tags_its_word_by_the_table() {
+        use WordTag::{Box as B, List as L, Value as V};
+        let prog = Program {
+            code: vec![
+                Instr::Li(Reg::Loc(0), 7),
+                Instr::Nil(Reg::Loc(1)),
+                Instr::Cons(Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
+                Instr::Cons(Reg::Loc(3), Reg::Loc(2), Reg::Loc(0)),
+                Instr::Head(Reg::Loc(4), Reg::Loc(3)),
+                Instr::Tail(Reg::Loc(5), Reg::Loc(3)),
+                Instr::Head(Reg::Loc(6), Reg::Loc(2)),
+                Instr::Tail(Reg::Loc(7), Reg::Loc(2)),
+                Instr::Mov(Reg::Loc(8), Reg::Loc(4)),
+                Instr::IsEmpty(Reg::Loc(9), Reg::Loc(1)),
+                Instr::Bin(BinOp::Eq, Reg::Loc(10), Reg::Loc(0), Reg::Loc(0)),
+                Instr::Box(Reg::Loc(11), Reg::Loc(1)),
+                Instr::BoxGet(Reg::Loc(12), Reg::Loc(11)),
+                Instr::BoxSet(Reg::Loc(11), Reg::Loc(0)),
+                Instr::BoxGet(Reg::Rr, Reg::Loc(11)),
+                Instr::Halt,
+            ],
+            labels: vec![],
+        };
+        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
+        c.by_ref().for_each(drop);
+        assert_eq!(c.status(), Some(&AsmStatus::Halted));
+        // One assertion over every tag, so a sabotage of any row reddens the same comparison.
+        assert_eq!(
+            (c.local_tags(), c.locals(), c.heap_tags(), c.box_tags(), c.rr(), c.rr_tag()),
+            (
+                &[V, L, L, L, L, V, V, L, L, V, V, B, L][..],
+                &[7, 0, 1, 2, 1, 7, 7, 0, 1, 1, 1, 1, 0][..],
+                &[(V, L), (L, V)][..],
+                &[V][..],
+                7,
+                V
+            ),
+        );
+    }
+
+    /// `call` clears every written bit and leaves the words — the callee sees its caller's registers as
+    /// left over — and `ret` brings the caller's bits back with its locals. `wrote` names the register
+    /// each step wrote and nothing for a step that wrote none.
+    #[test]
+    fn call_clears_written_bits_and_ret_restores_them() {
+        use WordTag::Value as V;
+        let prog = Program {
+            code: vec![
+                Instr::Li(Reg::Loc(0), 1),
+                Instr::Li(Reg::Loc(1), 2),
+                Instr::Call(label("f")),
+                Instr::Halt,
+                Instr::Li(Reg::Loc(1), 9),
+                Instr::Ret,
+            ],
+            labels: vec![(label("f"), 4)],
+        };
+        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
+        assert_eq!((c.written(), c.wrote()), (&[][..], None));
+        c.next();
+        assert_eq!(c.wrote(), Some(Reg::Loc(0)));
+        c.next();
+        c.next(); // call f
+        assert_eq!(c.wrote(), None, "`call` writes no register");
+        assert_eq!((c.locals(), c.written()), (&[1, 2][..], &[false, false][..]), "left over, none written");
+        let frame = &c.stack()[0];
+        assert_eq!((&frame.saved_written[..], &frame.saved_tags[..]), (&[true, true][..], &[V, V][..]));
+        c.next(); // li r1, #9
+        assert_eq!((c.wrote(), c.written()), (Some(Reg::Loc(1)), &[false, true][..]));
+        c.next(); // ret
+        assert_eq!((c.wrote(), c.locals(), c.written()), (None, &[1, 2][..], &[true, true][..]));
+    }
+
+    /// A refused instruction wrote nothing, and `wrote` says so, though the `nil` before it wrote `r0`.
+    #[test]
+    fn a_refused_instruction_wrote_nothing() {
+        let prog = Program {
+            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
+            labels: vec![],
+        };
+        let mut c = AsmCursor::new(prog, DEFAULT_CAPS);
+        c.by_ref().for_each(drop);
+        assert!(matches!(c.status(), Some(AsmStatus::Faulted(_))));
+        assert_eq!(c.wrote(), None);
+    }
+
     #[test]
     fn an_over_cap_register_faults_before_any_step() {
         let prog = Program { code: vec![Instr::Li(Reg::Loc(2_000_000), 1), Instr::Halt], labels: vec![] };
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(/asm_cursor/)'`
Expected: FAIL — the tests do not compile: `` error[E0432]: unresolved import `WordTag` ``, `` error[E0599]: no method named `local_tags` found for struct `asm_cursor::AsmCursor<P>` in the current scope ``, `` error[E0599]: no method named `heap_tags` found for struct `asm_cursor::AsmCursor<P>` in the current scope ``, and 6 more distinct (`` error: could not compile `redextape-core` (lib test) due to 18 previous errors ``).

- [ ] **Step 3: Write the code.**

````diff apply=source task=2
diff --git a/crates/redextape-core/src/trace.rs b/crates/redextape-core/src/trace.rs
index 7cc3961..9178380 100644
--- a/crates/redextape-core/src/trace.rs
+++ b/crates/redextape-core/src/trace.rs
@@ -22,7 +22,7 @@ use std::borrow::Borrow;
 mod asm_cursor;
 mod zipper;
 
-pub use asm_cursor::{AsmCap, AsmCursor, AsmFrame, AsmStatus, AsmStep};
+pub use asm_cursor::{AsmCap, AsmCursor, AsmFrame, AsmStatus, AsmStep, WordTag};
 pub use zipper::ZipperCursor;
 
 /// One step of either backend. `Delta`'s `state` is the state BEFORE the transition, matching the
diff --git a/crates/redextape-core/src/trace/asm_cursor.rs b/crates/redextape-core/src/trace/asm_cursor.rs
index bf70d9c..3d4cb18 100644
--- a/crates/redextape-core/src/trace/asm_cursor.rs
+++ b/crates/redextape-core/src/trace/asm_cursor.rs
@@ -11,6 +11,12 @@
 //! cap; then fetching past the end of `code` faults; then the instruction runs, and its own cap or fault
 //! ends the run before it has changed anything. Only an instruction that completes counts as a step, so a
 //! run capped at exactly the steps it needs halts rather than capping — `halt` is itself a step.
+//!
+//! **TAGS AND WRITTEN BITS ARE FOR DISPLAY.** Registers hold untyped words, so a list pointer `3`, the
+//! number `3` and a box handle `3` look the same. Each word here carries a `WordTag` saying which kind of
+//! instruction made it, copied along by everything that moves the word, and each local carries a bit
+//! saying whether the current frame has written it. Nothing reads either to decide what an instruction
+//! does, so `run_asm`'s results cannot depend on them.
 
 use crate::core::BinOp;
 use crate::tm::asm::{AsmOutcome, Caps, Instr, Program, Reg, instr_reg_over_cap};
@@ -45,22 +51,58 @@ pub enum AsmStatus {
     Capped(AsmCap),
 }
 
-/// One saved call frame: where `ret` resumes, and the caller's locals as they were at the `call`.
+/// Which kind of instruction made a word. `li`, arithmetic, comparisons and `isempty` make a value;
+/// `cons` and `nil` make a list pointer (`nil` is the list word 0); `box` makes a box handle. Everything
+/// else copies the tag of the word it moves: `mov` its source's, `head` and `tail` the tag stored with
+/// that half of the cell, `box_get` the tag stored in the box. A register never written reads as a value.
+///
+/// For a compiled program this is exact: every word starts at one making instruction and every other
+/// instruction copies. A hand-written program can use a value as a pointer; the tag then says value,
+/// which is true of how the word was made.
+#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
+pub enum WordTag {
+    #[default]
+    Value,
+    List,
+    Box,
+}
+
+/// One saved call frame: where `ret` resumes, and the caller's locals — with their tags and written bits
+/// — as they were at the `call`.
 #[derive(Clone, Debug, PartialEq, Eq)]
 pub struct AsmFrame {
     pub ret_pc: usize,
     pub saved_locals: Vec<u64>,
+    pub saved_tags: Vec<WordTag>,
+    pub saved_written: Vec<bool>,
 }
 
+/// A cons cell's head and tail, and their tags.
+type TaggedCell = ((u64, u64), (WordTag, WordTag));
+
 /// The register machine's state. Kept apart from the program so a step can borrow the program and
 /// mutate the state at once.
 #[derive(Clone, Debug, Default)]
 struct Vm {
     locals: Vec<u64>,
+    /// Parallel to `locals`, as `written` is: `write` grows all three together.
+    local_tags: Vec<WordTag>,
+    /// Whether the current frame has written each local. `call` clears them all; `ret` restores the
+    /// caller's.
+    written: Vec<bool>,
     args: Vec<u64>,
+    arg_tags: Vec<WordTag>,
     rr: u64,
+    rr_tag: WordTag,
     heap: Vec<(u64, u64)>,
+    /// Parallel to `heap`: the tags of each cell's head and tail. Only `cons` pushes, and it pushes both.
+    heap_tags: Vec<(WordTag, WordTag)>,
     boxes: Vec<u64>,
+    /// Parallel to `boxes`: `box` pushes both and `box_set` writes both.
+    box_tags: Vec<WordTag>,
+    /// The register the instruction `exec` last ran wrote. `exec` clears it first, so it is `None` after an
+    /// instruction that wrote no register and after one a fault or cap refused.
+    wrote: Option<Reg>,
     stack: Vec<AsmFrame>,
     pc: usize,
     steps: u64,
@@ -78,12 +120,57 @@ impl Vm {
         }
     }
 
-    fn write(&mut self, r: Reg, v: u64) {
+    fn tag(&self, r: Reg) -> WordTag {
         match r {
-            Reg::Loc(n) => grow_set(&mut self.locals, n as usize, v),
-            Reg::Arg(n) => grow_set(&mut self.args, n as usize, v),
-            Reg::Rr => self.rr = v,
+            Reg::Loc(n) => self.local_tags.get(n as usize).copied().unwrap_or_default(),
+            Reg::Arg(n) => self.arg_tags.get(n as usize).copied().unwrap_or_default(),
+            Reg::Rr => self.rr_tag,
+        }
+    }
+
+    fn write(&mut self, reg: Reg, word: u64, tag: WordTag) {
+        match reg {
+            Reg::Loc(n) => {
+                let at = n as usize;
+                grow_set(&mut self.locals, at, word);
+                grow_set(&mut self.local_tags, at, tag);
+                grow_set(&mut self.written, at, true);
+            }
+            Reg::Arg(n) => {
+                grow_set(&mut self.args, n as usize, word);
+                grow_set(&mut self.arg_tags, n as usize, tag);
+            }
+            Reg::Rr => {
+                self.rr = word;
+                self.rr_tag = tag;
+            }
         }
+        self.wrote = Some(reg);
+    }
+
+    /// The cell a list pointer names, with its tags. Null faults as "`op` of empty list"; a pointer past
+    /// the heap's end faults as "`op` of invalid list pointer", never an index. `p` is a register word a
+    /// program can set to any `u64`, so `p - 1` may not fit `usize` on a 32-bit target; `try_from` routes
+    /// that case to the same fault rather than truncating into a wrong, in-range index.
+    fn cell(&self, p: u64, op: &str) -> Result<TaggedCell, AsmStatus> {
+        if p == 0 {
+            return Err(AsmStatus::Faulted(format!("{op} of empty list")));
+        }
+        usize::try_from(p - 1)
+            .ok()
+            .and_then(|i| Some((*self.heap.get(i)?, *self.heap_tags.get(i)?)))
+            .ok_or_else(|| AsmStatus::Faulted(format!("{op} of invalid list pointer")))
+    }
+
+    /// The index of the box a handle names, by the same rules as `cell`: null and dangling handles fault.
+    fn box_index(&self, p: u64, op: &str) -> Result<usize, AsmStatus> {
+        if p == 0 {
+            return Err(AsmStatus::Faulted(format!("{op} of null handle")));
+        }
+        usize::try_from(p - 1)
+            .ok()
+            .filter(|i| *i < self.boxes.len() && *i < self.box_tags.len())
+            .ok_or_else(|| AsmStatus::Faulted(format!("{op} of invalid handle")))
     }
 
     /// Run the instruction at `pc`. `Ok(true)` when it ended the program, `Ok(false)` when the run goes
@@ -98,6 +185,7 @@ impl Vm {
     #[allow(clippy::too_many_lines)]
     #[inline]
     fn exec(&mut self, prog: &Program, caps: &Caps) -> Result<bool, AsmStatus> {
+        self.wrote = None;
         let Some(instr) = prog.code.get(self.pc) else {
             // Falling off the end without `halt`/`ret` is a lowering invariant violation; a fault rather
             // than a panic.
@@ -105,17 +193,17 @@ impl Vm {
         };
         match instr {
             Instr::Li(rd, n) => {
-                self.write(*rd, *n);
+                self.write(*rd, *n, WordTag::Value);
                 self.pc += 1;
             }
             Instr::Mov(rd, rs) => {
-                let v = self.read(*rs);
-                self.write(*rd, v);
+                let (v, t) = (self.read(*rs), self.tag(*rs));
+                self.write(*rd, v, t);
                 self.pc += 1;
             }
             Instr::Bin(op, rd, ra, rb) => {
                 let v = eval_bin(*op, self.read(*ra), self.read(*rb));
-                self.write(*rd, v);
+                self.write(*rd, v, WordTag::Value);
                 self.pc += 1;
             }
             Instr::Jz(r, l) => {
@@ -139,7 +227,15 @@ impl Vm {
                 if prospective > caps.mem {
                     return Err(AsmStatus::Capped(AsmCap::Mem));
                 }
-                self.stack.push(AsmFrame { ret_pc: self.pc + 1, saved_locals: self.locals.clone() });
+                self.stack.push(AsmFrame {
+                    ret_pc: self.pc + 1,
+                    saved_locals: self.locals.clone(),
+                    saved_tags: self.local_tags.clone(),
+                    saved_written: self.written.clone(),
+                });
+                // The callee starts with nothing written. Its registers still hold the caller's words —
+                // `call` does not clear them — which is what the view marks as left over.
+                self.written.fill(false);
                 self.saved_words = prospective;
                 self.pc = target;
             }
@@ -147,6 +243,8 @@ impl Vm {
                 Some(frame) => {
                     self.saved_words -= frame.saved_locals.len() as u64;
                     self.locals = frame.saved_locals;
+                    self.local_tags = frame.saved_tags;
+                    self.written = frame.saved_written;
                     self.pc = frame.ret_pc;
                 }
                 // `ret` with an empty stack ends the program, as `halt` does.
@@ -154,7 +252,7 @@ impl Vm {
             },
             Instr::Halt => return Ok(true),
             Instr::Nil(rd) => {
-                self.write(*rd, 0);
+                self.write(*rd, 0, WordTag::List);
                 self.pc += 1;
             }
             Instr::Cons(rd, rh, rt) => {
@@ -163,23 +261,24 @@ impl Vm {
                 }
                 let (h, t) = (self.read(*rh), self.read(*rt));
                 self.heap.push((h, t));
+                self.heap_tags.push((self.tag(*rh), self.tag(*rt)));
                 let ptr = self.heap.len() as u64; // 1-based
-                self.write(*rd, ptr);
+                self.write(*rd, ptr, WordTag::List);
                 self.pc += 1;
             }
             Instr::Head(rd, rl) => {
-                let (h, _) = cell(&self.heap, self.read(*rl), "head")?;
-                self.write(*rd, h);
+                let ((h, _), (th, _)) = self.cell(self.read(*rl), "head")?;
+                self.write(*rd, h, th);
                 self.pc += 1;
             }
             Instr::Tail(rd, rl) => {
-                let (_, t) = cell(&self.heap, self.read(*rl), "tail")?;
-                self.write(*rd, t);
+                let ((_, t), (_, tt)) = self.cell(self.read(*rl), "tail")?;
+                self.write(*rd, t, tt);
                 self.pc += 1;
             }
             Instr::IsEmpty(rd, rl) => {
                 let empty = u64::from(self.read(*rl) == 0);
-                self.write(*rd, empty);
+                self.write(*rd, empty, WordTag::Value);
                 self.pc += 1;
             }
             Instr::Box(rd, rv) => {
@@ -188,22 +287,25 @@ impl Vm {
                 }
                 let v = self.read(*rv);
                 self.boxes.push(v);
+                self.box_tags.push(self.tag(*rv));
                 let ptr = self.boxes.len() as u64; // 1-based
-                self.write(*rd, ptr);
+                self.write(*rd, ptr, WordTag::Box);
                 self.pc += 1;
             }
             Instr::BoxGet(rd, rb) => {
-                let idx = box_index(&self.boxes, self.read(*rb), "box_get")?;
-                // `box_index` has just checked `idx` against `boxes`, so this `get` cannot miss.
+                let idx = self.box_index(self.read(*rb), "box_get")?;
+                // `box_index` has just checked `idx` against both vectors, so neither `get` can miss.
                 let v = self.boxes.get(idx).copied().unwrap_or(0);
-                self.write(*rd, v);
+                let t = self.box_tags.get(idx).copied().unwrap_or_default();
+                self.write(*rd, v, t);
                 self.pc += 1;
             }
             Instr::BoxSet(rb, rv) => {
-                let idx = box_index(&self.boxes, self.read(*rb), "box_set")?;
-                let v = self.read(*rv);
-                if let Some(slot) = self.boxes.get_mut(idx) {
+                let idx = self.box_index(self.read(*rb), "box_set")?;
+                let (v, t) = (self.read(*rv), self.tag(*rv));
+                if let (Some(slot), Some(tag)) = (self.boxes.get_mut(idx), self.box_tags.get_mut(idx)) {
                     *slot = v;
+                    *tag = t;
                 }
                 self.pc += 1;
             }
@@ -212,11 +314,13 @@ impl Vm {
     }
 }
 
-fn grow_set(v: &mut Vec<u64>, i: usize, val: u64) {
+fn grow_set<T: Copy + Default>(v: &mut Vec<T>, i: usize, val: T) {
     if i >= v.len() {
-        v.resize(i + 1, 0);
+        v.resize(i + 1, T::default());
+    }
+    if let Some(slot) = v.get_mut(i) {
+        *slot = val;
     }
-    v[i] = val;
 }
 
 fn eval_bin(op: BinOp, a: u64, b: u64) -> u64 {
@@ -238,31 +342,6 @@ fn jump(prog: &Program, label: &str) -> Result<usize, AsmStatus> {
     prog.label_index(label).ok_or_else(|| AsmStatus::Faulted(format!("undefined label `{label}`")))
 }
 
-/// The heap cell a list pointer names. Null faults as "`op` of empty list"; a pointer past the heap's end
-/// faults as "`op` of invalid list pointer", never an index. `p` is a register word a program can set to
-/// any `u64`, so `p - 1` may not fit `usize` on a 32-bit target; `try_from` routes that case to the same
-/// fault rather than truncating into a wrong, in-range index.
-fn cell(heap: &[(u64, u64)], p: u64, op: &str) -> Result<(u64, u64), AsmStatus> {
-    if p == 0 {
-        return Err(AsmStatus::Faulted(format!("{op} of empty list")));
-    }
-    usize::try_from(p - 1)
-        .ok()
-        .and_then(|idx| heap.get(idx).copied())
-        .ok_or_else(|| AsmStatus::Faulted(format!("{op} of invalid list pointer")))
-}
-
-/// The box a handle names, by the same rules as `cell`: null and dangling handles fault.
-fn box_index(boxes: &[u64], p: u64, op: &str) -> Result<usize, AsmStatus> {
-    if p == 0 {
-        return Err(AsmStatus::Faulted(format!("{op} of null handle")));
-    }
-    usize::try_from(p - 1)
-        .ok()
-        .filter(|idx| *idx < boxes.len())
-        .ok_or_else(|| AsmStatus::Faulted(format!("{op} of invalid handle")))
-}
-
 /// Lazy asm stepping over a borrowed or owned `Program`, one instruction per `next`.
 pub struct AsmCursor<P> {
     prog: P,
@@ -302,16 +381,36 @@ impl<P: Borrow<Program>> AsmCursor<P> {
         self.vm.rr
     }
 
+    pub fn rr_tag(&self) -> WordTag {
+        self.vm.rr_tag
+    }
+
     /// The local registers `r0…`, as far as the highest one written. A register past the end reads 0.
     pub fn locals(&self) -> &[u64] {
         &self.vm.locals
     }
 
+    /// Parallel to `locals`.
+    pub fn local_tags(&self) -> &[WordTag] {
+        &self.vm.local_tags
+    }
+
+    /// Parallel to `locals`: whether the current frame has written each one. A local it has not written
+    /// still holds the word its caller left there.
+    pub fn written(&self) -> &[bool] {
+        &self.vm.written
+    }
+
     /// The argument registers `a0…`, as far as the highest one written.
     pub fn args(&self) -> &[u64] {
         &self.vm.args
     }
 
+    /// Parallel to `args`.
+    pub fn arg_tags(&self) -> &[WordTag] {
+        &self.vm.arg_tags
+    }
+
     /// The saved call frames, oldest first.
     pub fn stack(&self) -> &[AsmFrame] {
         &self.vm.stack
@@ -322,11 +421,29 @@ impl<P: Borrow<Program>> AsmCursor<P> {
         &self.vm.heap
     }
 
+    /// Parallel to `heap`: each cell's head and tail tags.
+    pub fn heap_tags(&self) -> &[(WordTag, WordTag)] {
+        &self.vm.heap_tags
+    }
+
     /// The boxes, in allocation order; handle `p` names box `p - 1`.
     pub fn boxes(&self) -> &[u64] {
         &self.vm.boxes
     }
 
+    /// Parallel to `boxes`.
+    pub fn box_tags(&self) -> &[WordTag] {
+        &self.vm.box_tags
+    }
+
+    /// The register the last step wrote: `None` before any step, after one that wrote no register (a jump,
+    /// `call`, `ret`, `halt` or `box_set`), and after an instruction a fault or a stack, heap or memory cap
+    /// refused, which wrote nothing. A step cap refuses before any instruction runs and leaves it as the
+    /// last step set it.
+    pub fn wrote(&self) -> Option<Reg> {
+        self.vm.wrote
+    }
+
     /// Instructions completed. `halt` counts; a faulted or capped instruction does not.
     pub fn steps_taken(&self) -> u64 {
         self.vm.steps
````

- [ ] **Step 4: Run the tests** — the cursor's, then the whole crate, since nothing may change what an instruction computes.

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(/asm_cursor/)'`
Expected: `9 tests run: 9 passed, 1303 skipped`

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast`
Expected: `1280 tests run: 1280 passed, 32 skipped`

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (`cargo nextest run -p redextape-core --no-fail-fast`):

| # | Sabotage | Fails |
|---|---|---|
| 1 | `asm_cursor.rs`, the `Head` arm: `self.write(*rd, h, th)` → `self.write(*rd, h, WordTag::List)` | `every_instruction_tags_its_word_by_the_table` |
| 2 | `asm_cursor.rs`, the `Tail` arm: `self.write(*rd, t, tt)` → `self.write(*rd, t, WordTag::List)` — spec §4.3's table before amendment 1 | `every_instruction_tags_its_word_by_the_table` |
| 3 | `asm_cursor.rs`, the `Mov` arm: write `WordTag::Value` instead of the source's tag `t` | `every_instruction_tags_its_word_by_the_table` |
| 4 | `asm_cursor.rs`, the `BoxSet` arm: delete `*tag = t;` | `every_instruction_tags_its_word_by_the_table` |
| 5 | `asm_cursor.rs`, the `Cons` arm: `(self.tag(*rh), self.tag(*rt))` → `(self.tag(*rt), self.tag(*rh))` | `every_instruction_tags_its_word_by_the_table` |
| 6 | `asm_cursor.rs`, the `BoxGet` arm: write `WordTag::Box` instead of the stored tag `t` | `every_instruction_tags_its_word_by_the_table` |
| 7 | `asm_cursor.rs`, the `Call` arm: delete `self.written.fill(false);` | `call_clears_written_bits_and_ret_restores_them` |
| 8 | `asm_cursor.rs`, the `Ret` arm: delete `self.written = frame.saved_written;` | `call_clears_written_bits_and_ret_restores_them` |
| 9 | `asm_cursor.rs`, `Vm::exec`: delete its first line, `self.wrote = None;` | `a_refused_instruction_wrote_nothing`, `call_clears_written_bits_and_ret_restores_them` |
| 10 | `asm_cursor.rs`, `Vm::write`: `grow_set(&mut self.written, at, true)` → `false` | `call_clears_written_bits_and_ret_restores_them` |

- [ ] **Step 6: Run the gates.**

Run: `cargo fmt --all -- --check && systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy --workspace --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The asm cursor tags each word by the instruction that made it, and marks the locals its frame has written

Registers hold untyped words, so the view cannot tell a list pointer from a number without help.
Each word carries a `WordTag` set by the instruction that makes it and copied by everything that
moves it; `tail` copies the tag stored with the cell's tail (spec amendment 1). `call` clears each
local's written bit and `ret` restores the caller's. Nothing reads either to run an instruction.
EOF
```

### Task 3: The oracle holds the cursor to the TM, instruction by instruction

**Files:**
- Modify: `crates/redextape-core/src/tm.rs`, `crates/redextape-core/tests/three_way_oracle.rs`

**Interfaces:**
- Consumes: Tasks 1 and 2 — `AsmCursor`, `AsmStatus`, `WordTag`, `rr_tag()`.
- Produces: `pub fn redextape_core::tm::lower_program(core: &Core) -> Result<Program, LowerError>`, the program every TM entry point lowers.

**THE ENTRY RULE.** `lower_tm` names one state `pc{i}` per instruction, meaning "about to execute instruction `i`", and names nothing else that way. An instruction is entered when the machine is in its `pc{i}` state on a step and was in a different state the step before — unary's gadgets loop on their own entry states (up to 69 such rules in one corpus machine), so counting every step spent there would count the loops. That rule would merge an instruction that jumps straight to itself, which only a program that never halts contains. The oracle runs `FIRST_ORDER_DEMOS` and `LAMBDA_LIMITATION_DEMOS`, the corpus programs the TM runs to a value; it is added to `three_way_oracle.rs`, which holds the canonical copy, so no eighth copy of the corpus is made.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=3
diff --git a/crates/redextape-core/tests/three_way_oracle.rs b/crates/redextape-core/tests/three_way_oracle.rs
index 118497f..560f186 100644
--- a/crates/redextape-core/tests/three_way_oracle.rs
+++ b/crates/redextape-core/tests/three_way_oracle.rs
@@ -50,9 +50,12 @@ use redextape_core::desugar::desugar;
 use redextape_core::lambda::{LambdaRun, MAX_REDUCTION_STEPS, decode, run_lambda};
 use redextape_core::parser::parse;
 use redextape_core::tm::{
-    Binary, Encoding, EncodingKind, MAX_FIELD_WIDTH, TM_DEFAULT_CAPS, TmCaps, TmRun, Unary, decode_tape, run_tm,
-    run_tm_fitted,
+    Binary, DEFAULT_CAPS as ASM_CAPS, Encoding, EncodingKind, MAX_FIELD_WIDTH, TM_DEFAULT_CAPS, TmCaps, TmRun, Unary,
+    decode_tape, lower_program, run_tm, run_tm_described, run_tm_fitted,
 };
+use redextape_core::trace::{AsmCursor, AsmStatus, StepEvent, TmCursor, WordTag};
+use redextape_core::ty::Ty;
+use redextape_core::typeck::result_type;
 use redextape_core::value::Value;
 use redextape_core::{RunError, run};
 use redextape_test_support::arb_expr_over;
@@ -509,6 +512,78 @@ fn first_order_demos_stay_synced_across_all_seven_copies() {
     assert_eq!(copies.len() + 1, 7, "a copy was added to or removed from the tree without updating this count");
 }
 
+/// The instructions the TM runs, in order, read off the states it enters. `lower_tm` builds one entry
+/// state `pc{i}` per instruction, meaning "about to execute instruction `i`", and names nothing else that
+/// way. An instruction is entered when the machine is in its `pc{i}` state on a step and was in a
+/// DIFFERENT state the step before: unary's gadgets loop on their own entry states, so counting every
+/// step spent in one would count those loops. That rule would merge an instruction that jumps straight
+/// to itself, which only a program that never halts contains.
+fn tm_instructions(src: &str, core: &redextape_core::core::Core, ty: &Ty, kind: EncodingKind) -> Vec<usize> {
+    let d = run_tm_described(core, kind, ty.clone(), TM_DEFAULT_CAPS)
+        .unwrap_or_else(|r| panic!("{src} did not run under {kind:?}: {r:?}"));
+    assert!(matches!(d.run, TmRun::Ran { .. }), "{src} must complete under {kind:?}");
+    let entry = |state: u32| {
+        let digits = d.machine.states[state as usize].name.strip_prefix("pc")?;
+        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
+            return None;
+        }
+        digits.parse::<usize>().ok()
+    };
+    let init = d.header.init(d.machine.tapes);
+    let mut entered = Vec::new();
+    let mut before: Option<u32> = None;
+    for event in TmCursor::new(&d.machine, &init, TM_DEFAULT_CAPS) {
+        let StepEvent::Delta { state, .. } = event else { panic!("a TM cursor emitted {event:?}") };
+        if before != Some(state) {
+            entered.extend(entry(state));
+        }
+        before = Some(state);
+    }
+    entered
+}
+
+/// The program `src` lowers to, its result type, and the instructions an asm cursor runs over it to `halt`.
+fn asm_run(src: &str) -> (redextape_core::core::Core, Ty, AsmCursor<redextape_core::tm::Program>) {
+    let (prog, ds) = parse(src);
+    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
+    let prog = prog.expect("a program with no diagnostics parses");
+    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors in {src:?}: {e:?}"));
+    let core = desugar(&prog);
+    let program = lower_program(&core).unwrap_or_else(|e| panic!("{src} did not lower: {e:?}"));
+    (core, ty, AsmCursor::new(program, ASM_CAPS))
+}
+
+/// THE ASM CURSOR RUNS THE INSTRUCTIONS THE TM RUNS, STEP FOR STEP, under both encodings. `run_asm` is a
+/// loop over `AsmCursor`, so checking one against the other could not fail; the TM is a second
+/// implementation of every instruction, sharing no code with the cursor, and it enters `pc{i}` exactly
+/// when it begins instruction `i`. Every corpus program the TM runs to a value is checked, which is
+/// `FIRST_ORDER_DEMOS` and the latent traps.
+#[test]
+fn asm_steps_are_the_instructions_the_tm_enters() {
+    for src in FIRST_ORDER_DEMOS.iter().chain(LAMBDA_LIMITATION_DEMOS) {
+        let (core, ty, mut cursor) = asm_run(src);
+        let asm: Vec<usize> = cursor.by_ref().map(|s| s.pc).collect();
+        assert_eq!(cursor.status(), Some(&AsmStatus::Halted), "{src} must halt on the asm cursor");
+        for kind in [EncodingKind::Unary, EncodingKind::Binary] {
+            assert_eq!(tm_instructions(src, &core, &ty, kind), asm, "asm and TM step apart for {src} under {kind:?}");
+        }
+    }
+}
+
+/// At `halt`, `rr` is tagged by the program's result type: a list pointer for `List<T>`, a value for
+/// everything else a program can return. Nothing in the cursor reads the type, so this is the tags
+/// agreeing with the typechecker from outside.
+#[test]
+fn the_result_register_is_tagged_by_the_result_type() {
+    for src in FIRST_ORDER_DEMOS.iter().chain(LAMBDA_LIMITATION_DEMOS) {
+        let (_, ty, mut cursor) = asm_run(src);
+        cursor.by_ref().for_each(drop);
+        assert_eq!(cursor.status(), Some(&AsmStatus::Halted), "{src} must halt on the asm cursor");
+        let want = if matches!(ty, Ty::List(_)) { WordTag::List } else { WordTag::Value };
+        assert_eq!(cursor.rr_tag(), want, "{src} returns {ty:?}");
+    }
+}
+
 #[test]
 fn three_way_faults_diverge_on_all_backends() {
     for src in FAULT_DEMOS {
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'binary(three_way_oracle)'`
Expected: FAIL — the tests do not compile: `` error[E0603]: function `lower_program` is private `` (`` error: could not compile `redextape-core` (test "three_way_oracle") due to 1 previous error ``).

- [ ] **Step 3: Write the code.**

````diff apply=source task=3
diff --git a/crates/redextape-core/src/tm.rs b/crates/redextape-core/src/tm.rs
index d9148e7..03679af 100644
--- a/crates/redextape-core/src/tm.rs
+++ b/crates/redextape-core/src/tm.rs
@@ -142,7 +142,17 @@ pub enum TmRun {
 /// recursive passes. `defunc` is now total on any depth (see `defunc::MAX_DEFUNC_DEPTH`), so this is no
 /// longer required for safety, but it stays narrow anyway: `TooDeep` is never a signal that
 /// defunctionalizing would help, so retrying it is redundant work at best.
-fn lower_program(core: &Core) -> Result<Program, LowerError> {
+///
+/// PUBLIC SO A CALLER CAN STEP THE PROGRAM THE MACHINE WAS BUILT FROM. Every TM entry point lowers
+/// through this function, so a `trace::AsmCursor` over its result runs the very instructions whose
+/// `pc{i}` entry states the machine passes through — which is what lets the three-way oracle hold the two
+/// step for step.
+///
+/// # Errors
+///
+/// `LowerError::Unsupported` when neither direct lowering nor `defunc` can express the program, and
+/// `LowerError::TooDeep` when `core` nests past the lowering's depth guard.
+pub fn lower_program(core: &Core) -> Result<Program, LowerError> {
     match lower_asm(core) {
         Ok(p) => return Ok(p),
         Err(LowerError::Unsupported { .. }) => {}
````

- [ ] **Step 4: Run the tests** — the two oracles, then the whole file they joined.

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(/tm_enters|tagged_by_the_result/)'`
Expected: `2 tests run: 2 passed, 1312 skipped`

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'binary(three_way_oracle)'`
Expected: `27 tests run: 27 passed, 0 skipped`

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (`cargo nextest run -p redextape-core --no-fail-fast`). Rows 3 and 4 change no program's result, which is why only these oracles can see them:

| # | Sabotage | Fails |
|---|---|---|
| 1 | `asm_cursor.rs`, `next`: `Some(AsmStep { pc })` → `Some(AsmStep { pc: self.vm.pc })` | `a_fault_stops_on_the_faulting_instruction`, `each_step_names_the_instruction_it_ran`, `asm_steps_are_the_instructions_the_tm_enters` |
| 2 | `asm_cursor.rs`, `next`: `return None;` after latching `AsmStatus::Halted` | `each_step_names_the_instruction_it_ran`, `asm_steps_are_the_instructions_the_tm_enters` |
| 3 | `asm_cursor.rs`, `next`: when the instruction at `pc` is a `Jmp`, answer `AsmStep { pc: self.vm.pc }` — its target | `asm_steps_are_the_instructions_the_tm_enters` |
| 4 | `asm_cursor.rs`, the `Cons` arm: write `WordTag::Value` when `rd` is `Reg::Rr` | `the_result_register_is_tagged_by_the_result_type` |
| 5 | `asm_cursor.rs`, the `Nil` arm: `WordTag::List` → `WordTag::Value` | `every_instruction_tags_its_word_by_the_table`, `the_result_register_is_tagged_by_the_result_type` |

- [ ] **Step 6: Run the gates.**

Run: `cargo fmt --all -- --check && systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy --workspace --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The three-way oracle holds the asm cursor to the TM instruction by instruction, and `rr`'s tag to the result type

Checking the cursor against `run_asm` could not fail, since `run_asm` is the cursor's loop (spec
§4.4). The TM shares no code with it and enters `pc{i}` when it begins instruction `i`, so the
sequence it enters is a second reading of every step. `tm::lower_program` becomes public so the test
steps exactly the program the machine was built from.
EOF
```

### Task 4: The source map and link index keep each instruction's owner, apart from the machine

**Files:**
- Modify: `crates/redextape-core/src/sourcemap.rs`, `crates/redextape-core/src/viewmodel.rs`, `crates/redextape-core/tests/viewmodel_contract.rs`

**Interfaces:**
- Consumes: Task 3's `tm::lower_program`, in the tests.
- Produces: `SourceMap.asm_owner: Vec<Option<NodeId>>` and `SourceMap.node_to_asm: BTreeMap<NodeId, Vec<usize>>`; `SourceMap::asm_owner(&self, i: usize) -> Option<NodeId>` and `SourceMap::asm_block(&self, id: NodeId) -> Option<&[usize]>`; `LinkIndex.asm_owner: Vec<i32>`, `-1` for no owner, emptied whole if an id would not fit `i32`, and built without a `TmProgram`.

**THE ASM HALF COMES FIRST.** `asm_half` is `tm::lower_program` keeping its origins — direct lowering, `defunc` only on `Unsupported`, nothing on `TooDeep` — and `tm_half` now takes it rather than lowering again. An instruction a `defunc`-minted node emitted has no owner, the rule `tm_half` already applied to states.

- [ ] **Step 1: Write the failing tests.**

````diff apply=tests task=4
diff --git a/crates/redextape-core/src/sourcemap.rs b/crates/redextape-core/src/sourcemap.rs
index b6b99ca..2d9fb68 100644
--- a/crates/redextape-core/src/sourcemap.rs
+++ b/crates/redextape-core/src/sourcemap.rs
@@ -276,6 +276,96 @@ mod tests {
         desugar(&p.unwrap())
     }
 
+    fn map_of(src: &str) -> (Core, SourceMap) {
+        let (p, ds) = parse(src);
+        assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
+        SourceMap::build_from_program(&p.unwrap(), &Unary::default())
+    }
+
+    /// The asm half describes the program `tm::lower_program` returns — the one the TM runs and the asm
+    /// view will step — one owner per instruction, and the TM half's listing is that same program. In a
+    /// first-order program every instruction has an owner, and every owner is a construct with source.
+    #[test]
+    fn asm_owner_covers_the_program_lower_program_returns() {
+        let (core, map) = map_of("fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)");
+        let prog = crate::tm::lower_program(&core).expect("the sample lowers");
+        let listing: Vec<String> = prog.code.iter().map(print_instr).collect();
+        assert_eq!((map.asm_owner.len(), &map.tm_listing), (prog.code.len(), &listing));
+        for (i, owner) in map.asm_owner.iter().enumerate() {
+            let node = owner.unwrap_or_else(|| panic!("instruction {i} has no owner in a first-order program"));
+            assert!(map.source_span(node).is_some(), "instruction {i}'s owner {node} has no source");
+        }
+    }
+
+    /// Each instruction's owner is the construct that emitted it, read back as the source text of its
+    /// span. The rows are measured from this sample's listing; a permuted or shifted `asm_owner` still has
+    /// one owner per instruction and still inverts cleanly, and fails only here.
+    #[test]
+    fn each_instruction_is_owned_by_the_construct_that_emitted_it() {
+        let src = "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)";
+        let (core, map) = map_of(src);
+        let prog = crate::tm::lower_program(&core).expect("the sample lowers");
+        let row = |i: usize| {
+            let line = prog.code.get(i).map(print_instr);
+            let text = map.asm_owner(i).and_then(|n| map.source_span(n)).map(|s| &src[s.start..s.end]);
+            (line, text)
+        };
+        for (i, line, owner) in [
+            (4, "cmpeq\tr1, r2, r3", "n == 0"),
+            (11, "sub\tr6, r7, r8", "n - 1"),
+            (15, "mul\trr, r4, r5", "n * fact(n - 1)"),
+            (17, "li\tr0, #3", "3"),
+            (19, "call\tfact.0", "fact(3)"),
+        ] {
+            assert_eq!(row(i), (Some(line.to_string()), Some(owner)), "instruction {i}");
+        }
+    }
+
+    /// `defunc` mints constructs no one wrote; the instructions they emit have no owner, and every
+    /// instruction that does have one points at source. Measured on this sample: 17 of its 54 instructions
+    /// are minted.
+    #[test]
+    fn instructions_defunc_minted_have_no_owner() {
+        let src = "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
+                   map([3, 1, 2], |x| x + 1)";
+        let (_, map) = map_of(src);
+        let unowned = map.asm_owner.iter().filter(|o| o.is_none()).count();
+        assert!(unowned > 0, "the sample must go through `defunc`, or this pins nothing");
+        for (i, node) in map.asm_owner.iter().enumerate().filter_map(|(i, o)| Some((i, (*o)?))) {
+            assert!(map.source_span(node).is_some(), "instruction {i}'s owner {node} was minted");
+        }
+    }
+
+    /// `node_to_asm` holds exactly `asm_owner`'s claims, inverted, each block ascending — and `asm_block`
+    /// and `asm_owner` read them back.
+    #[test]
+    fn node_to_asm_inverts_asm_owner() {
+        let (_, map) = map_of("fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)");
+        let forward: BTreeSet<(NodeId, usize)> =
+            map.asm_owner.iter().enumerate().filter_map(|(i, o)| Some(((*o)?, i))).collect();
+        let inverted: Vec<(NodeId, usize)> =
+            map.node_to_asm.iter().flat_map(|(n, is)| is.iter().map(move |i| (*n, *i))).collect();
+        assert_eq!(inverted.len(), forward.len(), "an instruction claimed twice, or dropped");
+        assert_eq!(inverted.iter().copied().collect::<BTreeSet<_>>(), forward);
+        for (node, block) in &map.node_to_asm {
+            assert!(block.is_sorted(), "{node}'s block is not ascending");
+            assert_eq!(map.asm_block(*node), Some(&block[..]));
+            assert!(block.iter().all(|i| map.asm_owner(*i) == Some(*node)));
+        }
+    }
+
+    /// A program the TM refuses to lay out still lowers, so it keeps its asm half: 33 multiplications is
+    /// one past `MAX_MUL_INSTRS`, and the TM maps come back empty while every instruction is owned.
+    #[test]
+    fn the_asm_half_survives_a_machine_the_tm_refuses() {
+        let src = vec!["1"; 34].join(" * ");
+        let (core, map) = map_of(&src);
+        assert!(map.node_to_tm.is_empty() && map.tm_listing.is_empty(), "the TM must refuse this machine");
+        let prog = crate::tm::lower_program(&core).expect("the sample lowers");
+        assert_eq!(map.asm_owner.len(), prog.code.len());
+        assert!(map.asm_owner.iter().all(Option::is_some));
+    }
+
     #[test]
     fn build_is_total_on_a_program_the_lambda_backend_declines() {
         // A mutable captured by a closure: the λ backend refuses this (risk of a silent miscompile
diff --git a/crates/redextape-core/src/viewmodel.rs b/crates/redextape-core/src/viewmodel.rs
index 7fb49ab..1ce2815 100644
--- a/crates/redextape-core/src/viewmodel.rs
+++ b/crates/redextape-core/src/viewmodel.rs
@@ -576,6 +576,15 @@ mod tests {
     /// fixture by hand instead of parsing a program: reaching `u32::MAX` legitimately would need
     /// billions of source constructs, and the enforcement this pins must be checkable without paying
     /// that cost.
+    /// `asm_owner` refuses an id past `i32` the way `tm_owner` does, for the reason `tm_owner`'s own test
+    /// gives: `u32::MAX` would wrap onto `-1` and read as "no owner".
+    #[test]
+    fn asm_owner_declines_the_whole_leg_rather_than_wrap_an_id_into_the_no_owner_sentinel() {
+        let map = SourceMap { asm_owner: vec![Some(NodeId::MAX), None], ..SourceMap::default() };
+        let index = LinkIndex::build(None, None, &map, 0, 0);
+        assert!(index.asm_owner.is_empty(), "got {:?}", index.asm_owner);
+    }
+
     #[test]
     fn tm_owner_declines_the_whole_leg_rather_than_wrap_an_id_into_the_no_owner_sentinel() {
         let program = TmProgram {
diff --git a/crates/redextape-core/tests/viewmodel_contract.rs b/crates/redextape-core/tests/viewmodel_contract.rs
index 5ce71fa..22101a0 100644
--- a/crates/redextape-core/tests/viewmodel_contract.rs
+++ b/crates/redextape-core/tests/viewmodel_contract.rs
@@ -552,6 +552,18 @@ fn link_index_resolves_tm_owners_by_name_at_the_width_the_run_fitted() {
     }
 }
 
+/// The asm column carries `SourceMap::asm_owner` one slot per instruction, `-1` where there is no owner,
+/// and needs neither a term nor a machine: it is built with both legs absent.
+#[test]
+fn link_index_carries_each_instructions_owner_without_a_machine() {
+    let (program, _) = redextape_core::parser::parse("fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)");
+    let (_, map) = SourceMap::build_from_program(&program.expect("parsed"), &redextape_core::tm::Unary::default());
+    assert!(!map.asm_owner.is_empty(), "the sample lowers to asm");
+    let index = LinkIndex::build(None, None, &map, 65_536, MAX_TERM_DEPTH);
+    let expected: Vec<i32> = map.asm_owner.iter().map(|o| o.map_or(-1, |n| n as i32)).collect();
+    assert_eq!(index.asm_owner, expected);
+}
+
 #[test]
 fn link_index_is_total_over_a_declined_leg() {
     // Both halves are optional and neither absence may abort. A `None` term gives empty lambda legs;
@@ -565,6 +577,7 @@ fn link_index_is_total_over_a_declined_leg() {
     assert!(index.lambda_nodes.is_empty());
     assert!(index.source_nodes.is_empty());
     assert!(index.tm_owner.is_empty());
+    assert!(index.asm_owner.is_empty());
 }
 
 /// THE MIXED CASE THE TEST ABOVE CANNOT SEE: it only ever passes `None` for BOTH legs at once, which a
````

- [ ] **Step 2: Run them to verify they fail.**

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(/asm_owner|asm_half|node_to_asm|instructions_defunc|owned_by_the_construct|link_index/)'`
Expected: FAIL — the tests do not compile: `` error[E0609]: no field `asm_owner` on type `sourcemap::SourceMap` ``, `` error[E0609]: no field `asm_owner` on type `SourceMap` ``, `` error[E0609]: no field `asm_owner` on type `LinkIndex` ``, and 5 more distinct (`` error: could not compile `redextape-core` (test "viewmodel_contract") due to 4 previous errors ``; `` error: could not compile `redextape-core` (lib test) due to 15 previous errors ``).

- [ ] **Step 3: Write the code.**

````diff apply=source task=4
diff --git a/crates/redextape-core/src/sourcemap.rs b/crates/redextape-core/src/sourcemap.rs
index 2d9fb68..cf9a698 100644
--- a/crates/redextape-core/src/sourcemap.rs
+++ b/crates/redextape-core/src/sourcemap.rs
@@ -5,6 +5,11 @@
 //! `lower_tm_mapped` gives `state -> code index`, `lower_asm_mapped` gives `code index -> NodeId`.
 //! `attribute.rs` composes these forwards to attribute step counts; this inverts the same composition.
 //!
+//! THE ASM HALF IS THE CHAIN'S MIDDLE LINK, KEPT. `lower_asm_mapped`'s `code index -> NodeId` is what the
+//! TM half composes through; `asm_owner` records it on its own, because the asm view links instructions
+//! and a machine the TM refuses to lay out still has a program. So it is built before, and apart from,
+//! the machine.
+//!
 //! THE NAME INDEX IS NOT A THIRD HALF. `tm_name_to_node` is `node_to_tm` inverted through the very
 //! machine `tm_half` just lowered, kept because a state's identity in PRINTED text is its name, not its
 //! id. Deriving it outside would mean a caller holding a `Machine` next to a `SourceMap` with nothing
@@ -67,6 +72,13 @@ pub struct SourceMap {
     pub tm_listing: Vec<String>,
     /// That program's labels, each with the `prog.code` index it precedes, in `prog.labels` order.
     pub tm_labels: Vec<(String, usize)>,
+    /// `asm_owner[i]` is the Core node whose lowering emitted instruction `i` of the program
+    /// `tm::lower_program` returns, or `None` for a node `defunc` minted. Empty when the program does not
+    /// lower. Unlike the TM half it needs no machine, so a program whose machine the TM refuses to lay out
+    /// still has it.
+    pub asm_owner: Vec<Option<NodeId>>,
+    /// `asm_owner` inverted: each node's instructions, ascending. A node that owns none is absent.
+    pub node_to_asm: BTreeMap<NodeId, Vec<usize>>,
 }
 
 impl SourceMap {
@@ -88,7 +100,15 @@ impl SourceMap {
     /// it. `build_is_total_on_a_core_too_deep_for_the_tm_lowering` pins it on an input past the depth at
     /// which the unguarded λ lowering used to abort.
     pub fn build(core: &Core, enc: &dyn Encoding) -> SourceMap {
-        let tm = tm_half(core, enc);
+        let asm = asm_half(core);
+        let tm = asm.as_ref().map_or_else(TmHalf::default, |a| tm_half(a, enc));
+        let asm_owner: Vec<Option<NodeId>> = asm.map(|a| a.owners()).unwrap_or_default();
+        let mut node_to_asm: BTreeMap<NodeId, Vec<usize>> = BTreeMap::new();
+        for (i, owner) in asm_owner.iter().enumerate() {
+            if let Some(node) = owner {
+                node_to_asm.entry(*node).or_default().push(i);
+            }
+        }
         SourceMap {
             node_to_lambda: lambda_half(core),
             node_to_tm: tm.node_to_tm,
@@ -97,6 +117,8 @@ impl SourceMap {
             tm_name_to_instr: tm.name_to_instr,
             tm_listing: tm.listing,
             tm_labels: tm.labels,
+            asm_owner,
+            node_to_asm,
         }
     }
 
@@ -151,6 +173,19 @@ impl SourceMap {
         self.tm_name_to_instr.get(name).copied()
     }
 
+    /// The Core node whose lowering emitted instruction `i`. `None` for an instruction a `defunc`-minted
+    /// node emitted and for an index past the program's end.
+    #[must_use]
+    pub fn asm_owner(&self, i: usize) -> Option<NodeId> {
+        self.asm_owner.get(i).copied().flatten()
+    }
+
+    /// The instructions a Core node's lowering emitted, ascending. `None` for a node that emitted none.
+    #[must_use]
+    pub fn asm_block(&self, id: NodeId) -> Option<&[usize]> {
+        self.node_to_asm.get(&id).map(Vec::as_slice)
+    }
+
     /// The source text a Core node came from. `None` for a map built by `build`, which has no `Program`.
     #[must_use]
     pub fn source_span(&self, id: NodeId) -> Option<Span> {
@@ -170,6 +205,38 @@ fn lambda_half(core: &Core) -> BTreeMap<NodeId, Path> {
     out
 }
 
+/// One lowering to asm with its origins: `origins[i]` is the node that emitted `prog.code[i]`, and
+/// `synthetic` the ids `defunc` minted, which name no source construct.
+struct AsmHalf {
+    prog: crate::tm::Program,
+    origins: Vec<NodeId>,
+    synthetic: BTreeSet<NodeId>,
+}
+
+impl AsmHalf {
+    fn owners(&self) -> Vec<Option<NodeId>> {
+        self.origins.iter().map(|n| (!self.synthetic.contains(n)).then_some(*n)).collect()
+    }
+}
+
+/// `tm::lower_program`, keeping the origins: try the program as first-order Core FIRST, retry through
+/// `defunc` only on `Unsupported`, and give up on `TooDeep` immediately — a looser `or_else` would swallow
+/// it and replay a deep Core through `defunc`'s own recursive passes. The match is exhaustive rather than
+/// wildcarded so a future `LowerError` variant must decide here too. `build` is total, so a refusal is
+/// `None` rather than an error. The successful `lower_asm_mapped` is BOUND, not discarded: re-lowering a
+/// clone of the whole tree to get the pair back is pure waste on the common (first-order) path.
+fn asm_half(core: &Core) -> Option<AsmHalf> {
+    match lower_asm_mapped(core) {
+        Ok((prog, origins)) => Some(AsmHalf { prog, origins, synthetic: BTreeSet::new() }),
+        Err(LowerError::Unsupported { .. }) => {
+            let (defunced, synthetic) = defunc_mapped(core).ok()?;
+            let (prog, origins) = lower_asm_mapped(&defunced).ok()?;
+            Some(AsmHalf { prog, origins, synthetic })
+        }
+        Err(LowerError::TooDeep { .. }) => None,
+    }
+}
+
 /// Everything `tm_half` records about one lowering: the two owner indexes, the instruction index, and
 /// the listing and labels those instruction indices point into. `Default` is the empty half every
 /// refusal returns.
@@ -182,36 +249,17 @@ struct TmHalf {
     labels: Vec<(String, usize)>,
 }
 
-fn tm_half(core: &Core, enc: &dyn Encoding) -> TmHalf {
-    // `attribute.rs`'s `lower_mapped`, error discrimination included: try the program as first-order
-    // Core FIRST, retry through `defunc` only on `Unsupported`, and give up on `TooDeep` immediately —
-    // a looser `or_else` would swallow it and replay a deep Core through `defunc`'s own recursive
-    // passes. The match is exhaustive rather than wildcarded so a future `LowerError` variant must
-    // decide here too. `build` is total, so each refusal yields an empty half instead of propagating.
-    // The successful `lower_asm_mapped` is BOUND, not discarded: re-lowering a clone of the whole tree
-    // to get the pair back is pure waste on the common (first-order) path.
-    let (prog, origins, synthetic) = match lower_asm_mapped(core) {
-        Ok((p, o)) => (p, o, BTreeSet::new()),
-        Err(LowerError::Unsupported { .. }) => {
-            let Ok((defunced, synthetic)) = defunc_mapped(core) else {
-                return TmHalf::default();
-            };
-            let Ok((p, o)) = lower_asm_mapped(&defunced) else {
-                return TmHalf::default();
-            };
-            (p, o, synthetic)
-        }
-        Err(LowerError::TooDeep { .. }) => return TmHalf::default(),
-    };
+fn tm_half(asm: &AsmHalf, enc: &dyn Encoding) -> TmHalf {
+    let AsmHalf { prog, origins, synthetic } = asm;
     // `None` is the state-ceiling refusal — one of `lower_tm_mapped`'s four layout refusals (`MAX_SLOTS`,
     // `MAX_FRAME_LOC`, `MAX_MUL_INSTRS`, `MAX_MACHINE_STATES`; see its doc). NONE of the four is
-    // re-derived above: the match just above handles a different error entirely, `LowerError`'s
+    // re-derived here: `asm_half` handles a different error entirely, `LowerError`'s
     // `Unsupported`/`TooDeep` from `lower_asm_mapped`/`defunc_mapped`. All four layout refusals arrive
     // here, at this single `else`, deferred whole to `lower_tm_mapped`'s own `Option` — there is
-    // nothing here that could drift from what it checks. It takes the SAME "give back empty maps" path
-    // as `TooDeep`/`Unsupported`-then-`defunc`-failure just above: a refused program built no machine,
-    // so there is no state to own anything.
-    let Some((machine, state_origins)) = lower_tm_mapped(&prog, enc) else {
+    // nothing here that could drift from what it checks. It gives back empty TM maps, as `build` does when
+    // `asm_half` refuses: a refused program built no machine, so there is no state to own anything. The
+    // asm half is unaffected — the program still lowered.
+    let Some((machine, state_origins)) = lower_tm_mapped(prog, enc) else {
         return TmHalf::default();
     };
     let mut out: BTreeMap<NodeId, Vec<StateId>> = BTreeMap::new();
@@ -260,7 +308,7 @@ fn tm_half(core: &Core, enc: &dyn Encoding) -> TmHalf {
         }
     }
     let listing = prog.code.iter().map(print_instr).collect();
-    TmHalf { node_to_tm: out, name_to_node: names, name_to_instr, listing, labels: prog.labels }
+    TmHalf { node_to_tm: out, name_to_node: names, name_to_instr, listing, labels: prog.labels.clone() }
 }
 
 #[cfg(test)]
diff --git a/crates/redextape-core/src/viewmodel.rs b/crates/redextape-core/src/viewmodel.rs
index 1ce2815..c2fe4d2 100644
--- a/crates/redextape-core/src/viewmodel.rs
+++ b/crates/redextape-core/src/viewmodel.rs
@@ -504,6 +504,10 @@ pub struct LinkIndex {
     /// Rust-side, and nothing Rust-side reads this field. Declining the leg is the only option that
     /// does not tell the UI something false about a state it can click.
     pub tm_owner: Vec<i32>,
+    /// `asm_owner[i]` is the Core node whose lowering emitted instruction `i`, or `-1` — `SourceMap`'s
+    /// `asm_owner` in the form `tm_owner` crosses to JavaScript in, and refused whole by the same rule when
+    /// an id would not fit `i32`. It needs no `TmProgram`: the asm half is built apart from the machine.
+    pub asm_owner: Vec<i32>,
 }
 
 impl LinkIndex {
@@ -549,7 +553,16 @@ impl LinkIndex {
                     .collect::<Option<Vec<i32>>>()
             })
             .unwrap_or_default();
-        LinkIndex { lambda_text, lambda_spans, lambda_cut, lambda_nodes, source_nodes, tm_owner }
+        let asm_owner = map
+            .asm_owner
+            .iter()
+            .map(|owner| match owner {
+                None => Some(-1),
+                Some(n) => i32::try_from(*n).ok(),
+            })
+            .collect::<Option<Vec<i32>>>()
+            .unwrap_or_default();
+        LinkIndex { lambda_text, lambda_spans, lambda_cut, lambda_nodes, source_nodes, tm_owner, asm_owner }
     }
 }
 
````

- [ ] **Step 4: Run the tests** — this task's, then the whole workspace.

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run -p redextape-core --no-fail-fast -E 'test(/asm_owner|asm_half|node_to_asm|instructions_defunc|owned_by_the_construct|link_index/)'`
Expected: `11 tests run: 11 passed, 1310 skipped`

Run: `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo nextest run --workspace --no-fail-fast`
Expected: `1843 tests run: 1843 passed, 33 skipped`

- [ ] **Step 5: Sabotage, one at a time, restoring after each** (`cargo nextest run -p redextape-core --no-fail-fast`):

| # | Sabotage | Fails |
|---|---|---|
| 1 | `sourcemap.rs`, `AsmHalf::owners`: `(!self.synthetic.contains(n)).then_some(*n)` → `Some(*n)` | `instructions_defunc_minted_have_no_owner` |
| 2 | `sourcemap.rs`, `AsmHalf::owners`: `self.origins.iter()` → `self.origins.iter().rev()` | `each_instruction_is_owned_by_the_construct_that_emitted_it` |
| 3 | `sourcemap.rs`, `SourceMap::build`: record an owner in `node_to_asm` only when `i > 0` | `node_to_asm_inverts_asm_owner` |
| 4 | `sourcemap.rs`, `SourceMap::build`: `asm_owner` empty when `tm.listing` is | `the_asm_half_survives_a_machine_the_tm_refuses` |
| 5 | `viewmodel.rs`, `LinkIndex::build`: `.take(if program.is_some() { usize::MAX } else { 0 })` on the `asm_owner` iterator | `link_index_carries_each_instructions_owner_without_a_machine` |
| 6 | `viewmodel.rs`, `LinkIndex::build`: `i32::try_from(*n).ok()` → `Some(*n as i32)` for `asm_owner` | `asm_owner_declines_the_whole_leg_rather_than_wrap_an_id_into_the_no_owner_sentinel` |
| 7 | `viewmodel.rs`, `LinkIndex::build`: set `asm_owner` to `tm_owner.clone()` | `link_index_carries_each_instructions_owner_without_a_machine` |

- [ ] **Step 6: Run the gates.**

Run: `cargo fmt --all -- --check && systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0 cargo clippy --workspace --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 7: Commit.**

```sh
git add -A
git commit -F - <<'EOF'
The source map and link index keep each asm instruction's owner, apart from the machine

`SourceMap` records `asm_owner` and its inverse `node_to_asm` from the asm half of the lowering,
which the TM half now composes through rather than lowering again. A program whose machine the TM
refuses to lay out still lowered, so it keeps its owners. `LinkIndex` carries them as `asm_owner`,
`-1` for an instruction `defunc` minted.
EOF
```

### Task 5: Verification and the roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the entry, appended at the end)

No code. Every figure the entry quotes is run for it, and its command named beside it.

- [ ] **Step 1: The gates CI runs, all of them.** `scripts/check-all.sh` does not cover everything CI gates on. Run each in a detached `systemd-run --user --unit=… -p MemoryMax=16G -p MemorySwapMax=0` unit with `--setenv` for `PATH` (both `/usr/sbin` and `$CARGO_HOME/bin`), `CARGO_HOME`, `RUSTUP_HOME` and `HOME`, logging to the scratchpad:
  - `scripts/check-all.sh` — with `TREE_SITTER=<repo>/.tools/tree-sitter`, since `/usr/sbin` holds a newer `tree-sitter` (0.28.0) than the pin;
  - `scripts/check-slow.sh`;
  - `cargo llvm-cov nextest --workspace --fail-under-lines 90`;
  - the six hygiene scans, `scripts/check-{text-bytes,citations,attributions,doc-figures,shared-docs,lua}.sh`, each with `--self-test` and then alone;
  - the web CI sequence, since the web app links this crate through `redextape-wasm`: `cd web && pnpm run build:wasm && pnpm exec biome ci --error-on-warnings && pnpm run typecheck && pnpm run test:coverage && pnpm run build:app`;
  - the Docker image, built and started: `docker build -t redextape-check .`, `docker run -d --name c -p 8099:80 redextape-check`, then `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8099/` answers `200` and `docker inspect --format '{{.State.Health.Status}}' c` answers `healthy`. No PR job builds the image.

  Expected: every one exits 0. A failure is a finding: report it with its log, do not retry it into green.

- [ ] **Step 2: Measure `run_asm` once more**, with the appendix's `asmbench` built against `main` and against this branch's last code commit, each in its own `CARGO_TARGET_DIR` under `target/`, two rounds each, run alternately. The entry quotes these figures, not the plan's.

- [ ] **Step 3: The roadmap entry.** Append the entry for this PR to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` in the form part 4b's entry takes: what 5a built, what the prototype and the task reviews found, the user's decisions with their dates, what this did not close, and a verification section in which every figure names its command. Among what it did not close, at least:
  - `run_asm`'s cost, with Step 2's figures;
  - no wasm, protocol or view consumes any of this until 5b; `LinkIndex::asm_owner` is not yet marshalled to JavaScript;
  - the TM-sequence oracle's entry rule would merge an instruction that jumps straight to itself;
  - the program is still lowered more than once per compile (spec §4.5), now once by `SourceMap`'s asm half and once by `run_tm_described`.

- [ ] **Step 4: Commit the entry.**

```sh
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "Roadmap: Plan 7 part 5a, asm in the core"
```

- [ ] **Step 5: Finish the branch** with superpowers:finishing-a-development-branch. The user merges; push and open the PR only when asked.

## Appendix: the probe behind this plan's timings

`asmbench` is a scratch crate outside the repository, depending on `redextape-core` by path — once on `main`'s checkout and once on the branch's — each built with its own `CARGO_TARGET_DIR` under `target/` (`cargo build --release -q`), and the two binaries run alternately. It prints each program's median and minimum over 15 runs of `run_asm`.

```rust
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::asm::{AsmRun, DEFAULT_CAPS, run_asm};
use redextape_core::tm::{LowerError, defunc, lower_asm};
use std::time::Instant;
fn main() {
    let srcs = [
        "let mut n = 100000; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(1000)",
        "fn upto(n) { if n == 0 { nil } else { cons(n, upto(n - 1)) } } upto(200)",
    ];
    for src in srcs {
        let (p, _) = parse(src);
        let core = desugar(&p.unwrap());
        let prog = match lower_asm(&core) { Ok(p) => p, Err(LowerError::Unsupported { .. }) => lower_asm(&defunc(&core).unwrap()).unwrap(), Err(e) => panic!("{e:?}") };
        let mut times = Vec::new();
        for _ in 0..15 {
            let t = Instant::now();
            let r = run_asm(&prog, DEFAULT_CAPS);
            times.push(t.elapsed().as_secs_f64() * 1e3);
            assert!(matches!(r, AsmRun::Ran(_)));
        }
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("{:>8.3} ms median  {:>8.3} min  {:.40}", times[7], times[0], src);
    }
}
```

The spec's §A holds the two probes behind its own figures, `asmprobe` and `tmtrace`; Task 3's first oracle is `tmtrace` made a test.
