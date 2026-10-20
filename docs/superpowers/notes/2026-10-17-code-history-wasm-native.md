# Code history moved out of comments

Text moved verbatim out of code comments when they were trimmed to their why. Each entry names the file and the line of code the comment sat above.

## `crates/redextape-native/examples/opt_report.rs`, above `// Example target: a demo that cannot build its own input has nothing to demonstrate, so a`

a separate, out-of-band experiment (a temporary split timer wrapped around just the call into JIT-compiled code, used to size `measure::CORPUS` and then discarded — see that constant's doc) put execution at roughly 15-30% of `compile+run` for the recursion-bound programs (`sum30000`/`list30000`/`map30000`), with codegen making up the rest, and near 100% for the counted loop (`loop1000000`). Those figures come from that instrumented run, NOT from anything derivable from the two columns printed below — see caveat 5.

## `crates/redextape-native/src/jit.rs`, above `agree(Program {`

The old wrapping `imul` gave 1, so this diverged before the fix.

## `crates/redextape-native/src/jit.rs`, above `agree(Program {`

The old wrapping `iadd` gave u64::MAX - 1, so this diverged before the fix.

## `crates/redextape-native/src/jit.rs`, above `const SRC: &str = "fn f(a,b){ let c = a + b; let d = a + b; let e = c * d; e + (a+b) } f(3`

Measured (aarch64, cranelift 0.134.2): 256 B at `O0` → 228 B at every optimized level, an 11% drop. The AOT test's `fn twice(x){ x + x } twice(21)` also differs here (148 → 144) but by only 4 bytes,

## `crates/redextape-native/src/llvm.rs`, above `#[test]`

Measured on the pinned LLVM 22.1: `O2` 61, `O3` 61, `Os` 38, `Oz` 32.

## `crates/redextape-native/src/llvm.rs`, above `const SIZE_FIXTURE: &str =`

Measured — a straight-line callee at two and at four call sites came out identical at all of `O2`/`O3`/`Os`/`Oz`.

## `crates/redextape-native/src/llvm.rs`, above `fn fat_recursive_countdown(fillers: u32, depth: u64) -> Program {`

was verified by a definite-assignment dataflow analysis over 30 real programs (recursion, mutual list recursion, `while` loops, heap `cons`/`head`/`tail`, higher-order `map`/`fold`, currying, immutable capture, mutable capture via boxing)

## `crates/redextape-native/src/measure.rs`, above `pub const CORPUS: [(&str, &str); 4] = [`

At the original sizes (100/100/50/a 3-element list) every program ran in low single-digit microseconds against a JIT compile of tens of microseconds to several milliseconds (worse at `-O3`/LLVM), so execution was under 1% of `compile_and_run` (measured directly with a temporary split timer around just the call into JIT-compiled code, then discarded — not part of this file): the old `run` field was really a second compile-time column wearing a misleading label. Scaled up here so each program's own execution

## `crates/redextape-native/src/shared.rs`, above `const BYTES_PER_VAR: u64 = 32;`

Measured the same way (aarch64, `objdump` over `llvm::object_bytes` output, the `countdown` prologue), 200 fillers unless noted:

```
| filler shape | `O0` | `O1`/`O2`/`O3`/`Os`/`Oz` |
| --- | ---: | ---: |
| independent (the shape `jit.rs`'s totality sweep ships) | 1680 B | **1712 B** (+1.9%) |
| dependent chain (the `llvm.rs` fixture) | 1680 B | 1648 B (−1.9%) |
| independent, 800 fillers | 6480 B | **6512 B** (+0.5%) |
```

An earlier revision of this doc asserted that LLVM's `O1+` is always *smaller* (`mem2reg`/SROA promoting the register banks into SSA) and concluded that `O0` was LLVM's binding case. The first row falsifies it: `O1+` is LARGER for the independent shape, and the shrink held only for the fixture `llvm.rs` happens to use.

(`sub sp` of `0x600` at `none`, `0x11d0` at `speed`, `0x49c0` at 800 fillers, each plus 96 B of saved-register pushes, i.e. the 1632 / 4656 / 18976 B rows above)

## `crates/redextape-native/tests/native_oracle.rs`, above `#[test]`

Before the mixed generator it was 0.6%, and the check asserted nothing on ~70% of runs.

## `crates/redextape-native/tests/native_oracle.rs`, above `#[test]`

MEASURED FIRE RATE (2026-07-29): with the old `arb_native_safe_expr` (pure `0..1000` leaves), unary's `Ran` branch fired on ~0.6% of cases (11 of 1920, over 30 independent 64-case runs, and silent on 21 of those 30 runs). Retargeted at `arb_tm_mixed_range_expr`, instrumented the same way (a temporary `eprintln!` on every `Ran`) and run 30 independent times (64 cases each, 1920 cases total, no fixed seed): 1159 `Ran` hits (~60.4% of cases), firing on all 30 of the 30 runs (every run saw between 29 and 45 hits; none saw zero). So: the unary half now exercises its assertion on a clear majority of cases, on every run, rather than being live only in aggregate.

## `crates/redextape-native/tests/native_oracle.rs`, above `#[test]`

which until the overflow guard existed was only a comment, because the TM leg could not be run on these at all: it would have corrupted its register bank and handed back a WRONG answer rather than refusing.

## `crates/redextape-native/tests/native_oracle.rs`, above `#[test]`

NOT deleted by Task 17 (`tm-binary-encoding`), even though the encoding it contrasts against (`Unary`) is no longer the TM backend's only option: this still tests a REAL difference, just a smaller one than the doc comments used to claim.

## `crates/redextape-native/tests/native_oracle.rs`, above `"fn nil(x) { x + 5 } fn ap(g, x) { g(x) } ap(nil, 0)",`

check used to short-circuit BEFORE its `tags` check — so a user `fn nil`, itself USED AS A VALUE, compiled to the empty list instead of `cons(tag, $nil)`, and the dispatcher's `$head($clos)` tag test then faulted on it.

## `crates/redextape-native/tests/size_baseline.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

```
| program | cranelift | llvm |
|---|---:|---:|
| `loop1000000` | 1112 vs 1104 = **+0.7%** | 1009 vs 873 = **+15.6%** |
| `sum30000` | 1304 vs 1296 = **+0.6%** | 1393 vs 1217 = **+14.5%** |
| `list30000` | 1384 vs 1360 = **+1.8%** | 1521 vs 1377 = **+10.5%** |
| `map30000` | 2440 vs 2400 = **+1.7%** | 3281 vs 2337 = **+40.4%** |
```

## `crates/redextape-wasm/src/lib.rs`, above `#[allow(clippy::cast_possible_truncation)]`

and `prog200`'s is 1.9 MB against ~689 KB.

## `crates/redextape-wasm/src/session.rs`, above `#[test]`

**THIS REPLACES A TEST THAT WAS GREEN OVER THE HOLE.** Its predecessor stepped the sample until ONE state resolved an owner and passed — which the map built at `MIN_FIELD_WIDTH` did, with 47 of the sample's 121 billed states unresolved.

## `crates/redextape-wasm/src/session.rs`, above `#[test]`

and before this fix both printed through the uncapped `format_value`

per this task's own safety note.

## `crates/redextape-wasm/src/session.rs`, above `#[test]`

THIS EXISTS BECAUSE THE MUTATION PROVED IT WAS MISSING.** Adding `total_steps: Some(0)` to the struct was caught by `tests/browser.rs`'s wire assertion and by NOTHING in the native suite — 894 tests green. The browser tier needs Chrome and is skippable; the trap this task's own plan flags as its biggest should not depend on a tier that can be skipped.

## `crates/redextape-wasm/src/session.rs`, above `#[test]`

taking that offer used to produce a UI showing a halted machine with no answer, permanently, because `final_tapes` is written once in `compile` and a capped compile writes `None`.

## `crates/redextape-wasm/src/session.rs`, above `let at = format!("\\x. x{}", " ".repeat(59));`

so a copy's text of record is no longer than it could be when every answer was a print.

## `crates/redextape-wasm/src/session.rs`, above `#[test]`

and until this test the two ✅ marks in `Decoded`'s own reachability table rested on argument alone — the state was asserted nowhere, for either producer.

## `crates/redextape-wasm/src/session.rs`, above `pub const MAX_SCRATCH_TM_BYTES: usize = 6_100_000;`

AT THE COMMIT THAT ADDED THE PROBE'S RUN STAMP** (`web/tests/browser/provided-context.d.ts`), on an AMD Ryzen 9 9950X3D, starting at a load average of 1.32.

It priced 65 reduced files from 28,140 to 15,451,499 bytes, taking each cost's median over seven passes and a file's total as the four medians' sum.

## `crates/redextape-wasm/src/session.rs`, above `pub struct TmScratch {`

WHICH IS WHY T1 HAPPENED.

## `crates/redextape-wasm/src/session.rs`, above `#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]`

The `tm` field's doc records at length what the last fabricated-status-for-an-unreachable-state cost this file; this type is that lesson applied before the fact.

## `crates/redextape-wasm/src/session.rs`, above `#[must_use]`

and answered with the print, an edit had whatever the printer spells differently replaced under the caret each time a build was answered — a space typed at the end was gone before the next letter, and a caret inside the text went to its start.

as every text was:

## `crates/redextape-wasm/src/session.rs`, above `pub const COPY_CAPS: tm::asm::Caps = tm::asm::Caps { heap: 2_000_000, mem: 12_000_000, ..t`

One run, on the machine above: 629.8 MiB for a million-word locals bank saved by every `call`, to the memory cap; 264.6 MiB for a `cons` a step, to the step cap; 136.6 MiB for a `box` a step; 18.4 MiB for bare recursion, to the stack cap. Under these caps the same cases read 133.1, 72.5, 40.4 and 18.4 MiB, and

## `crates/redextape-wasm/src/session.rs`, above `pub const MAX_SCRATCH_ASM_BYTES: usize = 5_200_000;`

ON AN AMD RYZEN 9 9950X3D, RELEASE BUILD, THIS CHECK OFF (`probe-asm-copy`). The ledger's three quiet-machine runs found `both` heaviest at medians 38.4, 36.1 and 38.8 ms against the loop's 32.1, 30.7 and 32.9, and with `both` added 5,200,038 bytes stayed under the 250 ms budget in all three (241.5, 243.9, 245.5 ms) while 5,400,000 was over it in two of them (254.3, 256.7 ms). This fix wave's own run agrees: `both` 39.0 ms against the loop's 31.6, 5,200,038 bytes under budget at 245.4 ms and 5,300,019 bytes, the next size up, over it at 250.2 ms.

## `crates/redextape-wasm/src/session.rs`, above `pub struct LambdaScratch {`

AND CHECKING WHY IS WHAT CORRECTED THE FIRST DRAFT OF THE DESIGN.

A first draft added it anyway "for the same `Rc`-bump reason as `Session`", which is a reason

## `crates/redextape-wasm/src/session.rs`, above `pub fn tm_value(&self) -> Result<Decoded, SessionError> {`

Reading `final_tapes` alone answered `Unfinished` forever for exactly the run `RunStatus::Capped` invites the caller to continue, so `tm_status().run` said `Ended` while this said `Unfinished` and both were reporting on the same machine.

is the exact function this branch memoized

## `crates/redextape-wasm/src/session.rs`, above `pub fn lambda_state(&self, byte_budget: usize) -> Result<LambdaState, SessionError> {`

PR 2 removed the map and redex PARAMETERS along with the `source_node` field they existed to compute. Still three arguments today:

## `crates/redextape-wasm/src/session.rs`, above `pub fn run_lambda(&mut self, budget: u64) -> Result<RunStatus, SessionError> {`

It used to end `self.lambda_status().run.unwrap_or(RunStatus::Running)` — `run` is `None` only for an absent leg, which the `?` above has already ruled out, so the `unwrap_or` was a branch no input could take, written that way only because unwrapping is a panic and a panic under wasm aborts the module.

## `crates/redextape-wasm/src/session.rs`, above `fn decoded_value(v: &redextape_core::value::Value) -> Decoded {`

is the exact function this branch made sharing-aware, and a `tails`-shaped program that used to be refused around the decode budget now decodes in ~192,000 nodes

## `crates/redextape-wasm/src/session.rs`, above `fn build_tm_leg(`

This function once took them as a third parameter and returned them untouched, purely to shape the return tuple — a parameter that could not affect the result, which reads as though it might.

## `crates/redextape-wasm/src/session.rs`, above `pub(crate) tm: Result<(TmProgram, TmCursor<Rc<Machine>>, tm::TmHeader), TmDecline>,`

only one the earlier shape, a `Result` beside an `Option`, could SPELL. Spelling it was not free. `tm_status` had to match on both fields, and the arm for the combination that cannot occur could not be an `unreachable!()` — a panic under wasm aborts the module — so it fabricated a user-facing status instead:

It also put TWO SOURCES UNDER ONE FACT. `tm_program` read availability off the `Option` while `tm_status` read it off the `Result`, two encodings of one boolean that only the constructor kept in step. One `Result` collapses both costs: the type now states what `compile` always guaranteed.

## `crates/redextape-wasm/src/session.rs`, above `#[cfg_attr(feature = "ts", ts(type = "number | null"))]`

**MEASURED, AT THE COMMIT THAT ADDED THESE DERIVES AND BEFORE `web/src/types.ts` CONSUMED THE GENERATED FILES: UNDER EXACTLY THIS SABOTAGE, BOTH RUST GATES PASSED AND `pnpm run typecheck` EXITED 0.** `TmStatus` was still hand-declared there, so nothing imported `web/bindings/TmStatus.ts` and `tsc` never opened it — the condition above did not hold, and there was nothing watching to catch it.

**MEASURED AGAIN, AT THE COMMIT THAT MAKES `web/src/types.ts` THE BARREL: UNDER THE SAME SABOTAGE, THE RUST GATES STILL PASSED AND `pnpm run typecheck` NOW EXITED 1.** With the override changed to `ts(type = "number")` and `pnpm run build:bindings` re-run, `cargo nextest run -p redextape-wasm --features ts -E 'binary(ts_bindings)'` still reported `2 tests run: 2 passed` — neither Rust gate moved — but `tsc` reported three `TS2322` errors, one per call site assigning a literal `null` to the now-narrowed field: `replies.test.ts`'s `compiled` fixture; the `declined` fixture in `results.test.ts`, under `'shows the TM reason and no width when that backend declines'`; and `session-client.test.ts`'s `compiled` fixture, each `Type 'null' is not assignable to type 'number'.` **THE MIDDLE ONE READ "the `TmLeg` fixture in `results.test.ts`" AND THAT FILE HOLDS FOUR OF THEM** — `tmOk` at module scope, two `capped` bindings in adjacent tests, and this `declined` one — so the definite article rested entirely on the test title trailing it, and a reader who stopped at the filename had three wrong fixtures to choose from. Restoring `ts(type = "number | null")` and re-running `build:bindings` returns `pnpm run typecheck` to exit 0. The condition named above holds, on this tree, on this measurement: with the barrel importing `TmStatus` from `../bindings/`, `tsc` does refuse the dropped `| null`.

## `crates/redextape-wasm/src/session.rs`, above `#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]`

AND THE FIX THAT ADDED IT IS THE WHOLE REASON THIS VARIANT EXISTS.

## `crates/redextape-wasm/src/session.rs`, above `pub const MAX_PRINT_DEPTH: u32 = 1_000;`

It is not the same quantity as 1,930, which this constant used to be justified against: 1,930 was measured with a fresh worker per sample, so every sample was that worker's FIRST print — and a worker's ceiling is not fixed. It drops after the first deep print, measured 2026-08-09 by driving one worker through repeated prints at fixed depths: at term depth 1,497, two prints in a row held but by the fourth or fifth it failed with a stack overflow, every time; at term depth 1,400 and below, the SAME worker held for 60 prints straight with no further degradation observed.

and 1,930 a number that was never a bound on that.

The data is five depths across four rep-counts, topping out at 60 repeated prints in one worker — enough to show the ceiling drops from ~1,930 toward the [1400, 1497) bracket without eroding further across that run, but not enough to tell

AND THE DIFFERENCE IS THE BUG THIS FIXES.** That constant is 3,000 and bounds the REDUCER against a native 8 MiB stack. The printer borrowed it, and 3,000 sits above every browser ceiling measured — so the guard could not fire, and past 3,000 it fires at 3,000 frames, which is already past the cliff. There is no input size at which the old arrangement saved the module.

## `crates/redextape-wasm/tests/browser.rs`, above `assert_eq!(text.as_string().as_deref(), Some("λy. y"));`

T1 found three of its five tests wrong this way before this note existed.

## `crates/redextape-wasm/tests/browser.rs`, above `#[wasm_bindgen_test]`

and `prog200`'s is 1.9 MB against ~689 KB.

## `crates/redextape-wasm/tests/browser.rs`, above `let expected = |v: &JsValue| {`

MEASURED IN THIS BROWSER, NOT ASSUMED, because PR 3c's renderer reads exactly this.

## `crates/redextape-wasm/tests/browser.rs`, above `#[wasm_bindgen_test]`

**IT COVERED `classifySource` TOO UNTIL PLAN 7 PART 3b, WHICH DELETED THAT EXPORT.** The web tier colours its editors from tree-sitter grammars now (`web/src/colour.ts`), so the export had no JS caller left and this was its last Rust one. What the deleted half asserted was that a file which does NOT analyze still classifies.

**NOTHING IN `redextape_core::analysis` HELD THAT PROPERTY WHEN THE ASSERTION WENT.** `classify_source_is_total_on_malformed_input` discarded `classify_source`'s return value (`let _ = classify_source(...)`), so it asserted only that classification does not panic — nothing there checked a malformed file still yields spans, and the assertion deleted from this test — `a file that does not analyze still has tokens` — was the whole of it. That test now asserts the property directly: a parse error still leaves tokens to classify, and the empty string classifies to nothing. That is where it lives.

**PLURAL AGAIN, DELIBERATELY.** Plan 7 part 3b's deletion of `classifySource` left this test exercising exactly one free export, which the name above says it does not do. `captureClasses` — new in this same branch (Task 2) and, until now, untested at the wasm boundary at all — closes it back up to two.

## `crates/redextape-wasm/tests/browser.rs`, above `#[wasm_bindgen_test]`

The design's load-bearing justification for this whole branch is a claim that was never run:

**This weakens this branch's stated justification** for the reason the design itself gives most weight to (§0's "now the load-bearing reason").

## `crates/redextape-wasm/tests/browser.rs`, above `#[wasm_bindgen_test]`

MEASURED IN THIS RUN, IN HEADLESS CHROME, NOT ASSUMED FROM AN EARLIER ONE: fourteen samples at 100-step spacing (thirteen mid-reduction, the fourteenth the normal form) — `[607, 707, 807, 907, 1007, 1107, 1207, 1307, 1407, 1507, 1607, 1707, 1803, 1803]` — peak depth **1803**.

The two consecutive 1803s at the end suggest the depth had already leveled off near the normal form by then, and an earlier, coarser 300-step run of this same program recorded 1805 — close enough to this run's 1803 to be consistent with a true peak in the low 1800s, but

## `crates/redextape-wasm/tests/browser.rs`, above `#[wasm_bindgen_test]`

and measured rather than assumed:

(the depth cannot be pushed further — the guards refuse first)

, not the 2.7x–4x a straight read of this bisection would give (the decision is unaffected either way — see the roadmap entry for the full derivation).

## `crates/redextape-wasm/tests/browser.rs`, above `// Test target: `wasm_bindgen_test` functions are not `#[test]` functions, so `clippy.toml`

**THIS PARAGRAPH NAMED `classify_source`/`classifySource` UNTIL PLAN 7 PART 3b, WHICH DELETED THAT EXPORT AND MADE IT FALSE.** The web tier colours its editors from tree-sitter grammars now (`web/src/colour.ts`), so the export had no JS caller left and this crate's own tests were its last one; see `the_free_exports_need_no_session`'s own doc for what the deletion took with it. The stale sentence kept reading true locally because `pkg/redextape_wasm.d.ts` is a gitignored build artefact `build:wasm` had not been re-run to regenerate, so it still listed `classifySource` — that is not evidence the export still exists, only that nothing had rebuilt the file this paragraph cites.

## `crates/redextape-wasm/tests/ts_bindings.rs`, above `#[test]`

— four revisions plus three more in review, each defeated by an ordinary spelling of the same attribute, ending in a whitelist rather than a fifth banned spelling.

## `crates/redextape-wasm/tests/ts_bindings.rs`, above `// Test target: a fixture that fails to build IS the failure this file reports, so panicki`

the seven revisions that shaped it,

## `crates/redextape-native-rt/src/lib.rs`, above `#[allow(clippy::doc_markdown)]`

Same corrupted-then-reverted literal as `rt_box_get`:

## `crates/redextape-native/src/analysis.rs`, above `assert!(main.internal_labels.iter().any(|(n, _)| n == "skip1"));`

(the misattribution the old slice hit)

## `crates/redextape-native/src/aot.rs`, above `#[cfg(all(test, feature = "cranelift"))]`

(Task 6, Step 1: written to fail first -- `selected_linker`, `LinkOptions`, `LinkerChoice` do not exist yet).

## `crates/redextape-native/src/jit.rs`, above `let prog = Program {`

I3: `f` (a `Call` target) contains a `Halt`, which under `run_asm` ends the whole program with rr==7. The old codegen lowered `Halt` as a plain `Ret`, resuming `main` and yielding the WRONG rr==99. The fix rejects a non-`$main` `Halt` at partition time → `LowerError` (never `Ran(99)`).

## `crates/redextape-wasm/src/session.rs`, above `#[test]`

`RunError::Runtime` is the one genuinely new failure shape this slice adds, and it must arrive as a message rather than as an abort.

## `crates/redextape-wasm/src/session.rs`, above `#[test]`

`decode_tape_ty` is the exact function this branch made sharing-aware

## `crates/redextape-wasm/src/session.rs`, above `let out = lambda_scratch_at("(\\x. x) (\\y. y)", 500, 65_536);`

(final whole-branch review, T1's mutation result)

## `crates/redextape-wasm/tests/browser.rs`, above `let mut chunks = 0;`

MEASURED, NOT THE ORIGINALLY DRAFTED `2_000`: this program normalizes in exactly 1,200 β-steps (confirmed via `lambdaState`'s `step` field in a headless-Chrome run), so a 100-step chunk gives roughly a dozen samples across the run rather than four (this run took fourteen, see below) — a spacing dense enough that the earlier 300-step version, which sampled the same run in only four places, could straddle the depth peak entirely.

## `crates/redextape-wasm/tests/browser.rs`, above `#[wasm_bindgen_test]`

measured before the arena landed, the `Box`-shaped `TermNode` did not trap at any depth the guards admit on the 8 MiB shadow stack.

## `crates/redextape-native/src/jit.rs`, above `fn fat_recursive_countdown(fillers: u32, depth: u64) -> Program {`

With the OLD `caps.stack` depth cap (100_000) and a 64 MiB thread, a deep run of this program overflows the native stack and aborts the process

All numbers below are the `countdown` prologue's `sp` adjustment in an `aot::emit_object` object (aarch64: the `stp .., [sp, #-0x10]!` pushes plus `sub sp, sp, #imm`), at 200 fillers:

```
| filler shape | `none` | `speed` / `speed_and_size` | ratio |
| --- | ---: | ---: | ---: |
| constants (`Li(Loc(i), 1)`) | 1632 B | **32 B** | 0.02x |
| dependent chain (`Arg(0) + Loc(i-1)`) | 1632 B | 1648 B | 1.01x |
| independent (SHIPPED) | 1632 B | **4656 B** | **2.85x** |
```

that is what the middle row is here to record.

1 pass gives 3232 B, 2 gives 4576 B, and it saturates at 4656 B from 4 passes on.

At 200 fillers the estimate charges `(200 + 3 + 1 + 8) * 32 + 2048 = 8832` B against 4656 B actual — 1.90x headroom, and this test is what would notice if that ratio ever moved.

## `crates/redextape-native/src/measure.rs`, above `pub const CORPUS: [(&str, &str); 4] = [`

(double digits of percent, sometimes the majority)

## `crates/redextape-native/tests/native_oracle.rs`, above `"let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n`

Confirmed non-vacuous by sabotage (reverting `tail1`'s emitted name to the bare `"tail"`): the TM diverges (`HitCap`) while reference and λ still agree.

## `crates/redextape-native/tests/native_oracle.rs`, above `#[test]`

Measured 2026-07-29: all four fit at width 16, including the heap list `[100, 200, 300]`.

## `crates/redextape-wasm/tests/browser.rs`, above `#[wasm_bindgen_test]`

n=2,900 rather than the investigation's 2,690, because THIS test runs on the page thread, whose ceiling is term depth 2,833. At 2,690 it would pass with or without the cap and pin nothing

## `crates/redextape-wasm/src/session.rs`, above `pub(crate) total_steps: Option<u64>,`

the runaway counter in `a_declined_tm_leg_reports_no_total_steps` reaches 740,183.
