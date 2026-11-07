# IR views groundwork PR 2: one lowering walk and one heap core — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec §6's PR 2 (`docs/superpowers/specs/2026-10-27-ir-views-groundwork-design.md`): §4.2's one
lowering walk with a Cranelift sink and an inkwell sink, CLIF generation off `dyn Module` with a `Module`-free
path proven byte-identical, and §4.3's one heap core in `redextape-core`, gated by §7.1 (generated code does not
change) and §7.2 (no hot path slows).

**Architecture:** Task 1 lands a snapshot test of the generated CLIF, machine code and LLVM IR for 70 programs on
fixed targets, so every later commit is shown byte-identical, except Task 8 (LLVM alloca names), Task 8b (LLVM
load names) and Task 9 (Cranelift source locations), whose diffs are checked to be exactly the named kind. The
walk (`lower.rs`) owns every per-instruction decision; each backend's sink owns spelling, block-creation order and
register storage. The heap core is generic over a tag recorder; the rxm interpreter records tags, native-rt
records nothing.

**Tech Stack:** Rust 2024, cranelift 0.137.1 (`codegen`, `frontend`, `module`, `object`, `jit`, `native`), inkwell
0.11.0 (`llvm23-1`) on llvm-sys 231.0.2, LLVM 23.1.4 locally (Arch `llvm 23.1.4-1`), cargo-nextest, the
`rxm-copy` browser probe for §7.2.

## Global constraints

- Work only in `~/temp/redextape-ir-lowering` (branch `ir-lowering`). The main checkout serves a dev server: never
  edit or build there. Build with `CARGO_TARGET_DIR=$HOME/.cache/redextape-ir-lowering-target`, and
  `LLVM_SYS_231_PREFIX=/usr` for any `--features llvm` build. The cargo registry is `~/.local/share/cargo`.
- A heavy run (a release `opt_report` build, coverage, `check-all.sh`, the CI-container run) goes under
  `flock ~/temp/redextape-heavy.lock`; a browser run under `flock ~/temp/redextape-browser.lock`. Another lane
  shares both.
- The pre-commit hook runs `cargo fmt`, `cargo clippy -D warnings`, the hygiene scans and the comment guard on
  every commit. Never `--no-verify`. If a planned commit cannot pass clippy alone (dead code), merge it with the
  next and say so in the message.
- No `file:line` citation in tracked source (fine in `docs/`). A code comment holds the why; no history and no
  measurement in comments; a comment block over 8 lines of text fails the guard (`//!` doc lines are exempt);
  each area's comment share may not rise above `scripts/comment-budget.json` (`crates/redextape-native` 0.3394,
  `crates/redextape-native-rt` 0.3592, `crates/redextape-core` 0.3078).
- Tests: decide a task is done with `cargo nextest run -p <crate> [features]`, never with a filtered `cargo test`.
  Read the COUNT a run reports, not the word `ok`. Every test this plan adds gets a sabotage that is run and seen
  to fail, in the task that writes it; restore by saved copy and `cmp`, not `git checkout`.
- Dependencies: the only new manifest entry is the `cranelift-codegen` dev-dependency of Task 1. No new crate.
- Nothing is pushed and no PR is opened without the user's word. Each task appends what it did, its SHAs and its
  measured counts to `~/temp/redextape-ir-lowering-record/progress.md`'s Log.
- §7.1 snapshot gate after every commit from Task 1 on (section "The snapshot gate"). §8's behaviour changes are
  the only generated-code changes: Task 8's, Task 8b's, Task 9's, and Task 1's import order (Decision D3).

---

## Spec §2 facts re-checked at `14621b1`

The spec's §2 was read at `dec47bb`, before #159 (the rxm rename) and #160 (the bumps). At `14621b1` every line
citation this plan relies on still points at its item: `codegen.rs` `declare_rt` 154, `declare_subroutines` 185,
`translate_subroutine` 290; native-rt `Runtime` 33, `rt_cons` 100, `rt_run` 467; `rxm_cursor.rs` `Vm` 101,
`cell` 173, `box_slot` 187, the heap cap checks 282 and 308; `tm/rxm.rs` `reg_str` 157-163; the four runtime
symbol lists (`codegen.rs` `declare_rt`, `jit.rs` `register_symbols`, `llvm.rs` `declare_rt` and `rt_symbols`).
No `set_srcloc` or `set_val_label` call exists in `crates/`. These do NOT hold, or hold only in part:

1. **§4.2, "numbers functions exactly as the `Module` path does (runtime imports first, then subroutines, in
   declaration order)".** The `FuncId`s are numbered so, but inside each function `translate_subroutine` imports
   the subroutines by iterating `decls.func_ids`, a `HashMap`, so the `fnN` ↔ `u0:M` pairing, the as-built and
   optimised CLIF text and the x86-64 vcode text change from build to build (fact V5). The machine-code bytes do
   not. Task 1 fixes the order first; until then there is no "Module path numbering" to match.
2. **§7.1, "the LLVM module as built (`print_to_string`, before the passes), once".** `build_module` attaches the
   `Os`/`Oz` size attributes before it returns, so there are three as-built modules: O0-O3 (equal), Os, Oz (V10).
3. **§7.1, "the `set_srcloc` commit, whose diff is the `@xxxx` source-location annotations in CLIF".** Also every
   instruction line's indentation: Cranelift's printer indents all instructions to 36 columns once any srcloc is
   set (V8). Machine code and vcode do not change.
4. **§7.1, the alloca rename "whose diff is value names only".** True in substance, but LLVM's name uniquifier
   renumbers other names too (`cont7` becomes `cont13`), and the `; preds` comment column after a label moves
   (V11). The check is "equal with every value and label name masked", not "only the allocas changed".
5. **§4.3, "`rt_run` (spawns a thread) is `cfg`'d out of wasm32 builds".** `redextape-native-rt` already passes
   `cargo check --target wasm32-unknown-unknown` at `14621b1` (V13): `std::thread` compiles there. The wasm32
   check is added (Task 11); the `cfg` is not needed for it (Decision D6).
6. **§4.2's split, "`clif` = `cranelift-codegen` (default features off)".** Not a stale fact but a gap: no
   Cranelift crate enables `cranelift-codegen`'s `host-arch`, so `cranelift` must re-enable today's defaults
   itself (V14).
7. **§4.3, "cells and boxes share it (the heap cap)".** They share the cap's VALUE, not a count: today each arena
   is checked alone, `cells.len() >= caps.heap` and `boxes.len() >= caps.heap`, in both heaps. The core keeps that.

## Verified facts

Measured 2026-11-02/03 on the x86-64 development machine, at `14621b1`, by a throwaway worktree and target dir
(both deleted). The probe's sources and logs are in `~/temp/redextape-ir-lowering-record/probes/` and
`probe-out/`. "Probe" below means `probes/zz_probe.rs` run as a `--lib` test with `--features llvm`, with the
toggles in `probes/probe-wt.diff`.

| # | Fact | How measured |
|---|---|---|
| V1 | `cranelift_codegen::isa::lookup_by_name("x86_64-unknown-linux-gnu")` and `("aarch64-unknown-linux-gnu")`, then `.finish(settings::Flags::new(b))` with `use_colocated_libcalls=false`, `is_pic=false`, `opt_level` ∈ `none`/`speed`/`speed_and_size`, build on this host when `[dev-dependencies] cranelift-codegen = { version = "0.137", features = ["x86", "arm64"] }` sits beside the optional normal dependency; Cargo unifies the features into the test build. | probe build and run |
| V2 | An `ObjectModule` (`ObjectBuilder::new(isa, name, default_libcall_names())`) over either fixed ISA drives today's `codegen::declare_rt`, `declare_subroutines`, `word_signature` and `translate_subroutine` unchanged; its `define_function` calls `ctx.compile`. | probe; `cranelift-object-0.137.1/src/backend.rs` `define_function_with_control_plane` |
| V3 | After `define_function`, `ctx.func.display()` is the optimised CLIF (`Context::optimize` rewrites `ctx.func` in place: unreachable code, constant phis and aliases at every level, the e-graph pass at `speed`/`speed_and_size`). `ctx.compiled_code().unwrap().vcode` is `Some` exactly when `ctx.set_disasm(true)` was called before; `code_buffer()` is the bytes. | `cranelift-codegen-0.137.1/src/context.rs`; probe |
| V4 | `set_disasm(true)` changes no machine-code byte and not the optimised CLIF: 24 of 24 configurations (4 programs × 2 targets × 3 levels). | probe, `run-s1.log` |
| V5 | Today's CLIF is not deterministic. Two builds in one process differ in as-built and optimised CLIF in 17 of 18 multi-subroutine configurations (3 programs × 6), in vcode text in 8 of the 9 x86-64 ones and none of the aarch64 ones, and in machine-code bytes in none. With the subroutine imports in declaration order, 0 of 18 differ, and two processes' dumps are byte-identical (`cmp`). | probe, `run-a1.log` and `run-s1.log`; `cmp clif-s1.txt clif-s2.txt` |
| V6 | As-built CLIF is the same for both targets and all three levels (4 programs). | probe output, compared by script |
| V7 | Function numbering: the 11 runtime imports are `u0:0`-`u0:10` in `declare_rt` order, the subroutines `u0:11`… in `partition` order, `colocated` exactly for the subroutines; every function imports all 11 runtime functions and every subroutine; a function is named `u0:<its FuncId>`. Neither `JITModule` nor `ObjectModule` overrides `Module::declare_func_in_func`, whose default does `import_signature`, `declare_imported_user_function(UserExternalName { namespace: 0, index })`, `import_function(ExtFuncData { colocated: decl.linkage.is_final(), patchable: false, .. })`. | probe output; `cranelift-module-0.137.1/src/module.rs` `declare_func_in_func` |
| V8 | `FunctionBuilder::set_srcloc(SourceLoc::new(idx))` before each body instruction: machine-code bytes and vcode text identical in 24 of 24; as-built and optimised CLIF identical in 48 of 48 once `@[0-9a-f]{4}` tokens are removed and whitespace runs collapsed. `cranelift-codegen`'s `write.rs` indents every instruction to 36 columns when the function has any srcloc. | probe, `run-sl.log` vs `run-s1.log`, compared by script |
| V9 | LLVM on a fixed target: `Target::initialize_x86(&InitializationConfig::default())`, `TargetTriple::create("x86_64-unknown-linux-gnu")`, `Target::from_triple`, `create_target_machine(&triple, "x86-64", "", opt_level(opt), RelocMode::Default, CodeModel::JITDefault)`, then today's `build_module` and `optimize`, with `Module::print_to_string()` before and after: equal across two builds in one process (24 of 24) and across processes (`cmp`). `inkwell::support::get_llvm_version()` returns `(23, 1, 4)` here. The printed module starts `; ModuleID = 'redextape'`, `source_filename = "redextape"`, then the fixed datalayout and triple. | probe, `run-a1.log`; `cmp llvm-a1.txt llvm-a2.txt` |
| V10 | As-built LLVM IR is equal for O0-O3 (12 of 12) and differs for Os and Oz (8 of 8): `apply_size_attributes` runs inside `build_module`. | probe, `run-a1.log` |
| V11 | Renaming the local allocas `l{i}` → `r{i}`: as-built and post-pass IR (24 + 24 prints) are equal once every `%name`, every label definition and whitespace runs are masked, with equal line counts; unmasked, other names move too (`cont7` → `cont13`). | probe, `run-rn.log` vs `run-s1.log`, compared by script |
| V12 | CLIF building with no ISA (`Function`, `FunctionBuilder`, `import_signature`, `declare_imported_user_function`, `import_function`, `set_srcloc`, `finalize(TargetFrontendConfig)`) passes `cargo check --target wasm32-unknown-unknown` with `cranelift-codegen = { version = "=0.137.1", default-features = false }` and `cranelift-frontend = "=0.137.1"` (default features, which turn on codegen's `std` and `unwind`). | out-of-tree crate, `probes/clifwasm-*` |
| V13 | `cargo check -p redextape-native-rt --target wasm32-unknown-unknown` exits 0 at `14621b1`. | probe worktree, `probe-out/rt-wasm.log` |
| V14 | `cranelift-codegen`'s `build.rs` adds the native target's ISA when no ISA feature is on OR `host-arch` is on; `cranelift-jit`, `-native`, `-module`, `-object` and `-frontend` all depend on it with `default-features = false` and never ask for `host-arch`. `TargetFrontendConfig`'s three fields (`default_call_conv`, `pointer_width`, `page_size_align_log2`) are `pub`, and `TargetIsa::frontend_config()` fills them from the ISA. | vendored `Cargo.toml`s and `build.rs`; `isa/mod.rs` |
| V15 | The corpus: `native_oracle.rs`'s five lists (46 + 4 + 4 + 3 + 2), the 7 `web/src/examples/*.rxt` and the 4 `measure::CORPUS` programs, 70 in all. Every one parses, lowers, partitions and compiles on both fixed Cranelift targets at all three levels and on the fixed LLVM target at all six. Their text, in the shape of "The snapshot gate", is about 6.06 MB: CLIF 3.43 MB, as-built LLVM ×3 1.74 MB, post-pass LLVM ×5 0.89 MB; the largest program, `FIRST_ORDER_DEMOS[37]`, about 294 KB. Dumping all of it took 3.22 s in a debug test build. No line contains a tab or another C0 byte. | probe `probe_corpus_size`, `probe-out/corpus.log`; `grep -P` over the dumps |
| V16 | Box builder `fn build(n) { if n == 0 { 0 } else { let mut v = n; let get = |x| v + x; v = v + 1; get(0) + build(n - 1) } } build(30000)` lowers with 1 `box`, 2 `box_get`, 1 `box_set`; the rxm interpreter allocates 30,000 boxes and 60,000 cells in 1,530,014 steps; Cranelift and LLVM at O0 and O3 return `450045000` under `DEFAULT_CAPS`; at `n = 10` all four decode to the reference's `65`. | probe `probe_box_builder`, `probe-out/box.log` |
| V17 | CI: the `rust` job runs `scripts/check-all.sh --no-llvm --no-browser`, `rust-llvm` runs `--llvm-only`; a LEGS row `base|wasm|<args>` runs `cargo check --target wasm32-unknown-unknown <args>`. | `.forgejo/workflows/ci.yml`; `scripts/check-all.sh` |

---

## Decisions

Questions for the user are D1-D5; the plan proceeds on each recommendation unless the user says otherwise.

- **D1 (user). LLVM drift.** CI's LLVM is apt.llvm.org's `release/23.x` snapshot of the day (23.1.5 on 2026-10-28;
  #160's "CI's LLVM" and its WHAT THIS DID NOT CLOSE), not the local 23.1.4. Recommended: as-built IR (`.ll`) is
  compared everywhere the LLVM half runs; post-pass IR (`.opt.ll`) is compared only when the running LLVM's
  `get_llvm_version()` equals `snapshots/llvm-version.txt`, and otherwise the test prints a `NOTE:` naming both
  versions and passes. So CI compares as-built IR only; the per-commit gate on the development machine compares
  both. The alternative, post-pass compared everywhere, fails CI whenever the apt snapshot moves.
  **Revised by the user on 2026-11-03**, after Task 1's container run found 23.1.5's post-pass IR byte-identical to
  23.1.4's for all 70 programs: `.opt.ll` is compared everywhere. On a release other than `llvm-version.txt`'s, a
  difference prints a `NOTE:` naming both releases and passes, and a match passes silently; on the recorded
  release a difference fails. A missing or orphan `.opt.ll` fails on every release.
- **D2 (user). Snapshot volume.** About 6.1 MB of text in about 210 files (V15). Recommended: keep all of it, as
  §7.1 asks; the cost is repository size, not CI time. Trimming to the O0 as-built LLVM module alone would save
  about 1.2 MB and leave the size attributes visible only in the version-gated post-pass files.
- **D3 (user). A further generated-code change.** Task 1 must make the in-function import order deterministic
  before any snapshot can be taken (fact 1 above). It changes CLIF and vcode text from "one of the orders a
  `HashMap` can produce" to declaration order, and no machine-code byte (V5). Recommended: accept it, and name it
  in the roadmap entry beside §8's others.
- **D4 (user). The box builder.** #160 left "No box builder in `measure::CORPUS`" to PR 2. Recommended: add
  `box30000` (V16) to `measure::CORPUS` in Task 2, rewrite the x86-64 size baseline (48 rows unchanged, 12 added)
  and refresh the Mac baseline on the MacBook as #160 did. Without the Mac row the size test fails on a Mac with
  "no baseline row"; if the Mac is unreachable, stop and ask.
- **D5 (user). A quiet machine for §7.2.** At this plan's writing the 1-minute load was 94 on 32 threads.
  Recommended: Task 13 runs only after the controller has asked the other sessions for a hold, as #160 did.
- **D6 (controller). `rt_run` on wasm32.** Not `cfg`'d out: the check passes without it (V13), and the spec gave
  the `cfg` only as the way to make the check pass.
- **D7 (controller). Where the harness lives.** A `#[cfg(test)]` module inside `redextape-native`
  (`src/codegen_snapshots.rs`), so it reaches `pub(crate)` items and drives the production functions, with the
  corpus shared with `native_oracle.rs` through one file, `tests/common/corpus.rs`.

---

## File structure

| File | Responsibility | Tasks |
|---|---|---|
| `crates/redextape-native/tests/common/corpus.rs` (new) | The five oracle lists, moved verbatim from `native_oracle.rs` | 1 |
| `crates/redextape-native/src/codegen_snapshots.rs` (new, `cfg(test)`) | Corpus enumeration, fixed targets, snapshot compare/write, determinism and Module-free equality tests | 1, 3, 7 |
| `crates/redextape-native/snapshots/` (new) | `<key>.clif`, `<key>.ll`, `<key>.opt.ll`, `llvm-version.txt` | 1, 2, 8, 8b, 9 |
| `crates/redextape-native/src/rt_imports.rs` (new) | The runtime import table: `RtFn`, names, word arity, return, address | 4 |
| `crates/redextape-native/src/lower.rs` (new) | `LowerSink` and `lower_subroutine`, the per-instruction decisions | 5 |
| `crates/redextape-native/src/codegen.rs` | `ClifSink`, `FuncImports`, the Module seam, the driver loop | 1, 3, 4, 5, 7, 9 |
| `crates/redextape-native/src/module_free.rs` (new, `clif`) | The `Module`-free imports and `build_clif` | 7 |
| `crates/redextape-native/src/llvm.rs` | `LlvmSink`, fixed-target machine split, alloca and load names | 1, 4, 6, 8, 8b |
| `crates/redextape-native/src/{jit,aot,lib,shared,measure}.rs`, `Cargo.toml` | Driver loop use, features, `cfg`s, box builder | 2, 3, 4, 7, 12 |
| `crates/redextape-core/src/heap.rs` (new) | `Heap<R>`, `HeapFault`, `HeapCapped`, the `Tags` recorder trait, `NoTags`, `VecTags<W>` | 10 |
| `crates/redextape-core/src/trace/rxm_cursor.rs` | `Vm` on the heap core with a tagging recorder | 10 |
| `crates/redextape-core/src/tm/rxm.rs` | `reg_str` exported | 8 |
| `crates/redextape-native-rt/src/lib.rs` | `Runtime` on the heap core; safe methods; thin `extern "C"` wrappers | 11 |
| `scripts/check-all.sh` (and `scripts/check-scoped.sh` if it lists legs) | `clif` clippy/test/wasm legs, native-rt wasm leg | 7, 11 |
| `crates/redextape-core/tests/three_way_oracle.rs` | The demo-copy path moves to `tests/common/corpus.rs` | 1 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | PR 2's entry | 14 |

---

## The snapshot gate

This section is the first place the format exists; Task 1 implements it.

**Corpus and keys.** In this order: `first-order-NN` for `FIRST_ORDER_DEMOS[NN]` (two digits), then
`lambda-limitation-NN`, `beyond-field-width-NN`, `saturation-NN`, `fault-NN`, then `example-<stem>` for each
`web/src/examples/<stem>.rxt` (read by `include_str!`; `corpus_holds_every_web_example` asserts the directory holds
exactly those seven stems, so a new example is a red test, not a silent gap), then `measure-<name>` for each
`measure::CORPUS` entry, then `rxm-<name>` for each `RXM_PROGRAMS` entry, hand-written rxm that `parse_rxm` reads (no
desugar or lowering). Each λ program goes `parse` (zero diagnostics) → `desugar` → `tm::lower_program` →
`analysis::partition`; each rxm program goes `parse_rxm` (zero diagnostics) → `analysis::partition`.

**Files**, in `crates/redextape-native/snapshots/`. Each starts `;; <key>`, then `;; source:` and the program's
source, one `;;   `-prefixed line per source line, then sections, each opened by one header line:

- `<key>.clif`: `;; ==== built ====` (every function's `Function::display()` in `partition` order, before
  definition); then for target `T` ∈ `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` and level `L` ∈
  `none`, `speed`, `speed_and_size`: `;; ==== T L: optimised ====` (every function's display after
  `define_function`) and `;; ==== T L: machine code ====` (per function a line `;; function u0:<id>: <n> bytes,
  fnv1a64 <16 hex digits>` over `code_buffer()`, then its `vcode`).
- `<key>.ll`: `;; ==== built: O0 O1 O2 O3 ====` (the test asserts the four are equal before writing one),
  `;; ==== built: Os ====`, `;; ==== built: Oz ====`.
- `<key>.opt.ll`: `;; ==== O1 ====` … `;; ==== Oz ====`, each `print_to_string()` after `optimize`.
- `llvm-version.txt`: `<major>.<minor>.<patch>` from `inkwell::support::get_llvm_version()` when written.

The flags are the JIT's (`jit::host_isa`'s three), never the host CPU's. The LLVM machine is V9's. The hash, which
exists nowhere yet (only the snapshot module uses it):

```rust
fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3))
}
```

**Tests** (in `codegen_snapshots`): `corpus_holds_every_web_example` under either backend;
`clif_matches_the_snapshots` and `every_build_prints_the_same_clif` under `cranelift`;
`built_llvm_ir_matches_the_snapshots` and `optimised_llvm_ir_matches_the_snapshots_on_the_recorded_llvm` under
`llvm`; from Task 7 `module_free_clif_equals_the_module_paths`, from Task 9
`each_instruction_carries_its_pc`, both under `cranelift`. A compare test reads
every file of its kind, collects every mismatch (key, file, first differing line number and the section header
above it) and fails once with the list and the regenerate command; it also fails on an orphan (a file of its kind
that no corpus key claims) and on a missing file. The Cranelift half owns `*.clif`; the LLVM half owns `*.ll`,
`*.opt.ll` and `llvm-version.txt`; neither touches the other's files.

**Regenerating.** `REDEXTAPE_WRITE_SNAPSHOTS=1` turns each compare test into a writer: it rewrites its own files,
deletes its own orphans and passes. Full regeneration (needs LLVM 23.1.x):

```
REDEXTAPE_WRITE_SNAPSHOTS=1 cargo nextest run -p redextape-native --features llvm --lib codegen_snapshots
```

**The per-commit gate**, from Task 1 on, with `CARGO_TARGET_DIR` and `LLVM_SYS_231_PREFIX` as in the constraints:

```
( set -e
  test "$("$LLVM_SYS_231_PREFIX/bin/llvm-config" --version)" = "$(cat crates/redextape-native/snapshots/llvm-version.txt)" \
    || { echo "GATE STOP: this LLVM is not llvm-version.txt's; .opt.ll differences only NOTE. Ask the controller."; exit 1; }
  cargo nextest run -p redextape-native --features llvm --lib codegen_snapshots       # 5 tests; 6 from Task 7, 7 from Task 9
  cargo nextest run -p redextape-native --no-default-features --features llvm --lib codegen_snapshots   # 3 tests
  test -z "$(git status --porcelain crates/redextape-native/snapshots)" \
    || { git status --porcelain crates/redextape-native/snapshots; echo "GATE STOP: snapshots/ is not clean."; exit 1; }
)
```

The block is one subshell under `set -e`: a STOP line or a failed run ends it with a non-zero status and nothing
after it runs, so the gate passed only when the block's own exit status is 0. The subshell keeps `set -e` out of the
shell it is pasted into. The `llvm-config` line is there because on any other LLVM release the optimised test passes on a difference and nextest
hides its `NOTE:`, so "5 passed" cannot show that post-pass IR went unchecked. A mismatch (a system upgrade
mid-PR, say) is the controller's to decide. A refactor task passes the gate unchanged. Task 2 adds three files and changes none. Tasks 8, 8b and 9 run the writer
and then their own check of the diff (in those tasks). Read the test counts: a run that reports 0 tests is a
filter that matched nothing.

**CI.** `cargo nextest run --workspace` in the `rust` job runs the Cranelift half; `rust-llvm`'s
`llvm|test|-p redextape-native --features llvm` and `--no-default-features --features llvm` legs run the LLVM
half. Under D1 as revised, CI compares all three kinds, but while its LLVM release differs from
`llvm-version.txt` a `.opt.ll` difference prints a `NOTE:` and passes. nextest hides a passing test's stdout, so
that `NOTE:` is not in CI logs: the roadmap entry must say that CI fails on post-pass IR only on the recorded
release.

**Reviewing a snapshot diff.** Never read snapshot files whole. Use `git diff --stat -- crates/redextape-native/snapshots`
and the task's check script; quote counts.

---

## Task 1: the §7.1 snapshot test

Three commits: A moves the corpus (tests only); B makes CLIF deterministic, test first; C adds the snapshots.

**Files:**
- Create: `crates/redextape-native/tests/common/corpus.rs`, `crates/redextape-native/src/codegen_snapshots.rs`,
  `crates/redextape-native/snapshots/*`
- Modify: `crates/redextape-native/tests/native_oracle.rs` (the five `const` lists and their doc comments move
  out; `#[path = "common/corpus.rs"] mod corpus;` and a `use` take their place),
  `crates/redextape-core/tests/three_way_oracle.rs` (`first_order_demos_stay_synced_across_every_copy`'s path
  `../redextape-native/tests/native_oracle.rs` becomes `../redextape-native/tests/common/corpus.rs`, label too),
  `crates/redextape-native/Cargo.toml` (`[dev-dependencies] cranelift-codegen = { version = "0.137",
  features = ["x86", "arm64"] }`, the form V1 measured), `crates/redextape-native/src/lib.rs`
  (`#[cfg(all(test, any(feature = "cranelift", feature = "llvm")))] mod codegen_snapshots;`),
  `crates/redextape-native/src/codegen.rs` (`translate_subroutine`'s subroutine imports),
  `crates/redextape-native/src/llvm.rs` (`build_module`, `optimize`, `opt_level` become `pub(crate)`;
  `host_target_machine` calls a new `target_machine(triple, cpu, features, opt)` with the host's three values)

**Interfaces:**
- Produces: `codegen_snapshots::corpus() -> Vec<(String, String)>` (key, source); a fixed-ISA builder
  `fixed_isa(target: &str, level: &str) -> OwnedTargetIsa`; `clif_dump(prog, isa) -> ClifDump` (as-built text,
  optimised text, per-function vcode/size/hash); `llvm::target_machine`; the snapshot files.

- [ ] **A1.** Move the five lists to `tests/common/corpus.rs` as `pub const` with their doc comments; include it
  from `native_oracle.rs` by `#[path]`; update the core sync test's path. Check: `cargo nextest run -p
  redextape-native` and `cargo nextest run -p redextape-core --test three_way_oracle` pass with the counts they
  had at `14621b1` (record both before and after). Sabotage: change one character of a demo in `corpus.rs` →
  `first_order_demos_stay_synced_across_every_copy` fails naming `corpus.rs`. Commit
  `native tests: move the oracle corpus to tests/common/corpus.rs`.
- [ ] **B1.** Create `codegen_snapshots.rs` with `corpus()` (keys as in "The snapshot gate", and
  `#[path = "../tests/common/corpus.rs"] mod corpus;`), `fixed_isa` (V1's flags, the JIT's values) and
  `clif_dump`, which drives `declare_rt`, `declare_subroutines` and, per subroutine, the same `make_context`,
  signature, name, `translate_subroutine`, `set_disasm(true)`, `define_function` sequence `jit::build_module`
  uses, over an `ObjectModule`. Add `every_build_prints_the_same_clif`: for each corpus program with at least 3
  subroutines, on both targets at `speed`, build 8 times and assert the 8 dumps equal; and in each as-built
  function the `colocated u0:M` import lines have `M` ascending.
- [ ] **B2.** Run it: `cargo nextest run -p redextape-native --lib codegen_snapshots`. Expected: FAIL (V5: 17
  of 18 configurations differed between just two builds).
- [ ] **B3.** In `translate_subroutine`, import the subroutines in declaration order (ascending `FuncId`; the
  rt imports keep `RtRefs::declare`'s order). Rerun: PASS. Then the oracles: `cargo nextest run -p
  redextape-native` (all pass, same count as A1's). Commit `codegen: import callees in declaration order, so
  CLIF is the same on every build`, the message naming D3.
- [ ] **C1.** Add the four compare/write tests and the LLVM half (V9's machine through `llvm::target_machine`;
  `Target::initialize_x86` first, so a non-x86 host can run it). Write the snapshots with the writer command.
  Check: 70 keys × 3 files + `llvm-version.txt` = 211 files (`ls | wc -l`); `llvm-version.txt` reads `23.1.4`;
  `du -sh` of the directory recorded (V15 predicts about 6 MB); the gate passes with 5 and 3 tests.
- [ ] **C2.** Sabotages, each run and seen red, then restored by saved copy and `cmp`:
  (a) `codegen::emit_bin`'s `Add` arm: `select(of, max, r)` → `select(of, r, max)` → `clif_matches_the_snapshots`
  fails on the `.clif` of every key with an `add`; (b) `llvm::emit_bin`'s `"sadd"` name → `"sadd2"` →
  `built_llvm_ir_matches_the_snapshots` fails; (c) `pass_pipeline`'s `O1` → `default<O2>` →
  `optimised_llvm_ir_…` fails and `built_…` passes; (d) edit `llvm-version.txt` to `23.1.3` → the optimised test
  passes and prints `NOTE:` with both versions (`--no-capture`); (e) add an empty `snapshots/zz-orphan.clif` →
  the Cranelift test fails naming it; (f) delete one `.ll` → the LLVM built test fails naming it.
- [ ] **C3.** Hygiene: the pre-commit hook's scans read the snapshot files (they are tracked text); stage with
  `git add -A` first and expect them clean (V15: no control bytes). Commit `native: snapshot the generated CLIF,
  machine code and LLVM IR on fixed targets (§7.1)`.
- [ ] **C4.** CI's LLVM, under the heavy lock: in a `node:22-bookworm` container, run the `rust-llvm` job's
  install step (`.forgejo/workflows/ci.yml`, "Install LLVM 23"), install the toolchain, and in a writable copy of
  the worktree at C3's commit run the writer command; then `diff -r` the copy's `snapshots/` against the
  committed one. Record in the ledger: the container's `llvm-config --version`, how many `.ll` and `.opt.ll`
  files differ. **If any `.ll` (as-built) file differs, stop and report**: D1's design assumes as-built IR is the
  same on CI's LLVM.

**Snapshots:** created at C1. No snapshot exists before B3; B3's change is D3.

## Task 2: a box builder in `measure::CORPUS` (the §7.2 base point)

**Files:** Modify `crates/redextape-native/src/measure.rs` (`CORPUS` becomes `[(&str, &str); 5]`, adding
`("box30000", <V16's source>)`); `crates/redextape-native/baselines/x86_64-unknown-linux-gnu.txt`;
`crates/redextape-native/baselines/aarch64-apple-darwin.txt` (D4); new `snapshots/measure-box30000.*`.

- [ ] Add the entry. `cargo nextest run -p redextape-native --features llvm measure` runs
  `every_corpus_program_compiles_and_runs_at_every_level` with the new program: PASS.
- [ ] Under the heavy lock: `cargo run --release --example opt_report -p redextape-native --features llvm --
  --write-baseline`. Check: `git diff` of the x86-64 file adds exactly 12 `box30000` rows and changes no other
  line. On the MacBook (memory `macbook-access`), the same at this commit for the Mac file; same check. Then
  `cargo nextest run -p redextape-native --features llvm --test size_baseline`: 1 passed.
- [ ] Run the snapshot writer. Check: `git status --porcelain crates/redextape-native/snapshots` lists exactly
  three new files, `measure-box30000.{clif,ll,opt.ll}`, and no modified file. The gate then passes.
- [ ] Record `box30000`'s LLVM margins, `(O0 − row) / row` for each optimised row, for the roadmap entry.
- [ ] Commit `measure: add a box builder to the corpus`. **This commit is §7.2's base.** Write its SHA in the
  ledger.

## Task 3: one Cranelift driver loop and one JIT flag set

`jit::build_module` and `aot::emit_object` each run declare-rt, declare-subroutines, then per subroutine
make-context, signature, name, translate, define, clear; `codegen_snapshots::clif_dump` is a third copy. After
this task all three call one function, so the snapshot sees the loop the JIT runs.

**Files:** Modify `codegen.rs` (new `pub(crate) fn define_all`, and `pub(crate) fn jit_flags(opt) ->
settings::Flags` holding `jit::host_isa`'s three settings), `jit.rs` (`build_module` and `host_isa` use them),
`aot.rs` (`emit_object` uses `define_all`; its own `is_pic=true` flags stay), `codegen_snapshots.rs` (`fixed_isa`
uses `jit_flags`, `clif_dump` uses `define_all`).

**Interfaces:** Produces `define_all(module: &mut dyn Module, prog, subs, fbctx, observe) -> Result<Decls,
DefineError>` where `observe` is called with each subroutine's `Context` after translation and before
`define_function` (the harness reads the as-built text and sets `set_disasm`) and again after it (the JIT adds
`code_info().total_size`; the harness reads optimised text and vcode). `DefineError` keeps the two failure kinds
apart (`Codegen(String)` from translation, `Module(ModuleError)` from declare/define), so `jit.rs` maps both to
`internal_error` and `aot.rs` to `AotError::Codegen`/`AotError::Object` exactly as today.

- [ ] Extract; keep the error strings each driver produces today.
- [ ] Gate: unchanged. `cargo nextest run -p redextape-native`: same count as Task 1; in particular
  `jit::tests::the_opt_level_reaches_the_jits_own_isa` and `aot::tests::the_opt_level_reaches_the_cranelift_isa`.
- [ ] Sabotage: make `jit_flags` set `opt_level` to `none` for every level → `clif_matches_the_snapshots` fails
  on the `speed` and `speed_and_size` sections AND `the_opt_level_reaches_the_jits_own_isa` fails, showing the
  snapshot now watches the JIT's own flags.
- [ ] Commit `codegen: one driver loop and one JIT flag set for the JIT, the AOT emitter and the snapshot test`.

## Task 4: the runtime import table, once

**Files:** Create `crates/redextape-native/src/rt_imports.rs` (`cfg(any(feature = "cranelift", feature =
"llvm"))` now, `any(clif, llvm)` from Task 7). Modify `codegen.rs` (`RtIds`/`RtRefs` become arrays indexed by
`RtFn`; `declare_rt` iterates the table), `jit.rs` (`register_symbols` iterates it), `llvm.rs` (`RtFns` likewise;
`declare_rt` builds each LLVM type from the entry's word arity and return; `rt_symbols`/`map_rt_symbols`
iterate it; the `use redextape_native_rt::{rt_box, …}` lists go), `lib.rs`.

**Interfaces:** Produces `pub(crate) enum RtFn { Cons, Head, Tail, IsEmpty, Box, BoxGet, BoxSet, Tick, Enter,
Leave, Faulted }` in exactly this order (it is `u0:0`-`u0:10` and LLVM's declaration order, both
snapshot-visible), and per entry: the symbol name (`rt_cons` … `rt_faulted`, `rt_box` for `Box`), the number of
word parameters after the runtime pointer (2, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0), whether it returns a word (all but
`BoxSet` and `Leave`), and its address (`fn address(self) -> *const u8`, `cfg(any(feature = "cranelift",
feature = "llvm"))`: under `clif` alone nothing reads it, and `-D warnings` would reject it as dead code). Cranelift spells the runtime pointer as
an `I64` parameter, LLVM as `ptr`; that stays in each backend.

- [ ] Replace the four lists. `llvm::tests::every_rt_import_is_mapped` now asserts every table entry is declared
  and mapped.
- [ ] Gate: unchanged. `cargo nextest run -p redextape-native --features llvm`: same count as before the task.
- [ ] Sabotage: swap `Tick` and `Enter` in the enum → every `.clif` and `.ll` file with a loop or call fails the
  gate (the declaration order moved). Restore.
- [ ] Commit `native: one runtime import table for both backends`.

## Task 5: the lowering walk and the Cranelift sink

**Files:** Create `crates/redextape-native/src/lower.rs`. Modify `codegen.rs` (`ClifSink`; `translate_subroutine`
sets up the builder and imports, then calls `lower_subroutine`), `lib.rs`.

**What the walk owns** (§4.2, each verified by reading both `translate_subroutine`s at `14621b1`): bank sizing
(`param_count`, `n_arg_vars`, `n_locals`), the label → index resolution, the arm for each `Instr`, the order of
operations inside an arm, `rt_tick` before a backward `Jz`/`Jmp` and before reading `Jz`'s register, `rt_enter`
before a call's argument reads, `rt_leave` after writing `rr`, an `rt_faulted` guard after `Cons`, `Head`,
`Tail`, `Box`, `BoxGet`, `BoxSet` and not after `IsEmpty`, `Halt` and `Ret` returning `rr`. **What a sink owns**:
creating and ordering blocks (Cranelift creates entry, banks, body blocks, exit and emits the exit's return last;
LLVM creates prologue, body blocks, exit first, emits the exit's `ret 0` inside the prologue, and appends `cont`
blocks at the end), register storage (`Variable`s vs `alloca`s), constants (`iconst` is an instruction, LLVM's
`const_int` is not), the out-of-bank read, value names, `Jz`'s spelling (`brif(cond, next, target)` vs `icmp eq 0`
+ `br`), saturating arithmetic.

**Draft trait** (the first place it exists; §10 leaves the method set to the builder provided the split above
holds; change it if a method set preserves both backends' emission order more simply):

```rust
pub(crate) struct Banks { pub n_params: u32, pub n_args: u32, pub n_locals: u32 }

pub(crate) trait LowerSink {
    type Value: Copy;
    type Error;
    fn prologue(&mut self, banks: Banks, body: &[usize], entry: usize) -> Result<(), Self::Error>;
    fn begin(&mut self, idx: usize) -> Result<(), Self::Error>;
    fn read(&mut self, r: Reg) -> Result<Self::Value, Self::Error>;
    fn write(&mut self, r: Reg, v: Self::Value) -> Result<(), Self::Error>;
    fn constant(&mut self, n: u64) -> Result<Self::Value, Self::Error>;
    fn bin(&mut self, op: BinOp, x: Self::Value, y: Self::Value) -> Result<Self::Value, Self::Error>;
    fn call_rt(&mut self, f: RtFn, words: &[Self::Value]) -> Result<Option<Self::Value>, Self::Error>;
    fn call_sub(&mut self, entry: usize, args: &[Self::Value]) -> Result<Self::Value, Self::Error>;
    fn guard(&mut self, f: RtFn) -> Result<(), Self::Error>;
    fn jump(&mut self, target: usize) -> Result<(), Self::Error>;
    fn jump_if_zero(&mut self, cond: Self::Value, target: usize, next: usize) -> Result<(), Self::Error>;
    fn ret(&mut self, v: Self::Value) -> Result<(), Self::Error>;
    fn finish(&mut self) -> Result<(), Self::Error>;
}

pub(crate) fn lower_subroutine<S: LowerSink>(sink: &mut S, prog: &Program, sub: &Subroutine, arity: &impl Fn(usize) -> Option<u32>)
    -> Result<(), LowerFault<S::Error>>;
```

`Nil` is `constant(0)` (both backends emit today exactly what `constant(0)` emits). The error messages a
malformed program produces today (`undefined label`, `no block for index`, `call to non-subroutine`, `unknown
callee arity`, `entry … not in body`) stay word for word; grep the tests for each before changing how it is made.

- [ ] Write the walk and `ClifSink`; delete the old arm-by-arm body.
- [ ] Gate: unchanged (`.clif` byte-identical; `.ll` untouched). `cargo nextest run -p redextape-native`: same
  count; the clippy legs `--all-targets` with default features and with `--no-default-features`.
- [ ] Sabotage: in the walk, emit the `Jz` tick guard after reading the register instead of before → the gate
  fails on every `.clif` with a backward `jz`, and passes `.ll` (the LLVM backend does not use the walk yet).
- [ ] Commit `native: one lowering walk; Cranelift is its first sink`.

## Task 6: the inkwell sink

**Files:** Modify `llvm.rs` (`LlvmSink`; `build_prologue` becomes its `prologue`; `translate_subroutine` calls
`lower_subroutine`).

- [ ] Write `LlvmSink`; delete the old arm-by-arm body. Keep every LLVM value name (`r`, `sadd`, `ssub`, `mulo`,
  `prod`, `ovf`, `smul`, `cmp`, `cmpw`, `jz`, `guard`, `trip`, `cont`, `call`, `leave`, `cons`, `head`, `tail`,
  `isempty`, `box`, `boxget`, `boxset`).
- [ ] Gate: unchanged, including `--no-default-features --features llvm` (the walk must build without Cranelift).
  `cargo nextest run -p redextape-native --features llvm` and `--no-default-features --features llvm`: same
  counts as before the task.
- [ ] Sabotage: in `LlvmSink::call_rt`, name the `head` call `hd` → the `.ll` of every key with a `head` fails.
- [ ] Commit `native: the LLVM backend is the walk's second sink`.

## Task 7: Cranelift off `dyn Module`, the `clif` feature and the `Module`-free path

**Files:** Modify `Cargo.toml` (features below), `lib.rs` (`cfg`s: `codegen` under `clif` with its
`cranelift_module` parts under `cranelift`; `lower`, `shared`, `rt_imports` under `any(feature = "clif", feature =
"llvm")`), `codegen.rs` (the seam), `codegen_snapshots.rs` (the equality test), `scripts/check-all.sh` LEGS (and
`scripts/check-scoped.sh` if it lists the native legs). Create `module_free.rs`.

**Features** (V14; the production build's `cranelift-codegen` feature set must not change):

```toml
clif = ["dep:cranelift-codegen", "dep:cranelift-frontend"]
cranelift = ["clif", "cranelift-codegen/host-arch", "cranelift-codegen/std", "cranelift-codegen/unwind",
             "cranelift-codegen/timing", "dep:cranelift-jit", "dep:cranelift-module", "dep:cranelift-object",
             "dep:cranelift-native"]
```

with `cranelift-codegen = { version = "0.137", optional = true, default-features = false }`. Check: `cargo tree
-e features -i cranelift-codegen -p redextape-native` (default features) prints the same feature set before and
after; save both outputs in the record.

**The seam** (draft, first place it exists): `translate_subroutine` takes `imports: &mut impl FuncImports`
instead of `&mut dyn Module`:

```rust
pub(crate) enum Callee { Rt(RtFn), Sub(usize) }
pub(crate) trait FuncImports {
    fn frontend_config(&self) -> TargetFrontendConfig;
    fn import(&mut self, func: &mut Function, callee: Callee) -> FuncRef;
}
```

The `Module` implementation wraps `&mut dyn Module` and `&Decls` and calls `declare_func_in_func`; `jit.rs`,
`aot.rs` and `define_all` use it. `word_signature` takes a `TargetFrontendConfig` (`Signature::new(
cfg.default_call_conv)` equals `module.make_signature()`, V14). The `Module`-free implementation numbers exactly as
V7: `Rt(f)` is index `f as u32`, `Sub` is `11 +` its position in `subs`; it imports as `declare_func_in_func`'s
default does (V7), `colocated` true for `Sub` only; it names each function `UserFuncName::user(0, index)`. It
exposes `pub fn build_clif(prog: &Program, cfg: TargetFrontendConfig) -> Result<Vec<Function>, LowerError>`
(partition, signatures, translate each), the API piece 1 builds on; which target and calling convention it shows
is piece 1's call.

**Legs:** `base|clippy|-p redextape-native --no-default-features --features clif --all-targets`,
`base|test|-p redextape-native --no-default-features --features clif`, `base|wasm|-p redextape-native --lib
--no-default-features --features clif`. Check with `scripts/check-all.sh --list`.

- [ ] Write `module_free_clif_equals_the_module_paths`: for every corpus program and both fixed targets, the
  as-built display of every function from `define_all` over an `ObjectModule` equals `build_clif(prog,
  isa.frontend_config())`'s, as one string per program. Run it before `build_clif` is complete → fails.
- [ ] Implement. Then: the equality test passes; the gate is unchanged; `cargo nextest run -p redextape-native`,
  `--features llvm`, `--no-default-features --features llvm` and `--no-default-features --features clif` pass;
  `cargo check --target wasm32-unknown-unknown -p redextape-native --lib --no-default-features --features clif`
  exits 0.
- [ ] Add a `clif`-only unit test in `module_free.rs` (runs in the new test leg): `build_clif` of
  `fn f(x) { x + 1 } f(2)` with `TargetFrontendConfig { default_call_conv: CallConv::SystemV, pointer_width:
  PointerWidth::U64, page_size_align_log2: 12 }` gives two functions named `u0:11` and `u0:12`, the first
  importing `u0:12` as `colocated`.
- [ ] Sabotages: `colocated` false for `Sub` → the equality test fails; subroutines numbered from 0 → fails.
- [ ] Commit `native: CLIF without a Module; a clif feature that builds for wasm32`.

## Task 8: LLVM allocas take the rxm register names (§4.2, §8)

**Files:** Modify `crates/redextape-core/src/tm/rxm.rs` (`reg_str` becomes `pub`, its doc names its readers
without the "`pub(crate)` for one other reader" history; re-export it beside the other `tm::rxm` items in
`tm/mod.rs`), `llvm.rs` (`LlvmSink::prologue` names each alloca `reg_str(Reg::Arg(i))`, `reg_str(Reg::Loc(i))`,
`reg_str(Reg::Rr)`).

- [ ] Test first, in `llvm.rs`'s tests: the as-built IR of `let x = 1; let y = x + x; y * 3` contains
  `%r0 = alloca i64` and no `%l0`. Run: FAIL. Implement: PASS.
- [ ] Run the snapshot writer. Check that the diff is names only: `git diff --name-only --
  crates/redextape-native/snapshots` lists only `.ll` and `.opt.ll` files; and for every changed file, the old
  (`git show HEAD:<path>`) and new texts are equal line for line after replacing `%[A-Za-z_.$][A-Za-z0-9_.$]*` by
  `%N` and a line-leading `[A-Za-z_.$][A-Za-z0-9_.$]*:` by `L:`, and collapsing whitespace runs (V11's
  measurement). Script it in the record; report the changed-file count.
- [ ] Commit, alone: `native: LLVM register slots take the rxm printer's names` (the snapshot updates in the
  same commit).

## Task 8b: LLVM loads take their register slot's name (§4.2, §8)

**Files:** Modify `llvm.rs` (`load_i64` takes the `Reg` whose slot it reads and names the load `reg_str(r)` plus
`.v`; `LlvmSink::read` passes it). No other name the code gives changes.

- [ ] Test first, `register_loads_take_their_slots_names` in `llvm.rs`'s tests: in the as-built IR of
  `fn twice(x){ let y = x + x; y + y } twice(21)`, no value but an `alloca` has a bare register name (`%r{n}`,
  `%a{n}`, `%rr`); every `load i64, ptr %S` is named `S.` plus a suffix; some slot is loaded twice; and the IR
  contains `%r0.v = load i64, ptr %r0`. Run: FAIL. Implement: PASS.
- [ ] Run the snapshot writer. Check the diff with Task 8's check plus a mapping count, scripted in the record:
  `git diff --name-only` lists only `.ll` and `.opt.ll` files; every changed file passes Task 8's masked
  line-for-line comparison and its one-to-one renaming per `define`; within each `define` every `alloca` keeps its
  name, every load from slot `S` is named `S.v` or `S.v<digits>`, and every other name changes at most in its digit
  runs (LLVM's per-function counter, which the load names feed); and no new-side value but an `alloca` has a bare
  register name. Prove the check fails on planted copies: a changed constant, a redirected `ptr` operand, a load
  named after another slot, and two slots swapped throughout a `define` (which Task 8's check alone passes).
- [ ] Commit, alone: `native: LLVM loads take their register slot's name` (the snapshot updates in the same
  commit).

## Task 9: Cranelift source locations (§4.2, §8)

**Files:** Modify `codegen.rs` (`ClifSink::begin` calls `set_srcloc(SourceLoc::new(pc))` with `pc =
u32::try_from(idx)`, leaving the default when it does not fit; `finish` resets to `SourceLoc::default()` before
the exit block, so the prologue and the shared exit carry no instruction's location).

- [ ] Test first, `codegen_snapshots::each_instruction_carries_its_pc`: for a corpus program with a loop, a call
  and a heap op, walk the as-built function's layout; every instruction in the block of body index `i`, and in the `cont` blocks a guard
  opened from it, has `func.srcloc(inst) == SourceLoc::new(i)`; every instruction of the entry and exit blocks has
  the default. Run: FAIL. Implement: PASS.
- [ ] Run the snapshot writer. Check: only `.clif` files change; in each, every `machine code` section is
  byte-identical to `HEAD`'s, and the `built` and `optimised` sections are equal to `HEAD`'s after deleting
  `@[0-9a-f]{4}` tokens and collapsing whitespace runs (V8). `.ll`/`.opt.ll` unchanged. Script it; report counts.
- [ ] Commit, alone: `codegen: each CLIF instruction carries its rxm pc as a source location`.

## Task 10: one heap core in `redextape-core`; the rxm interpreter on it

**Files:** Create `crates/redextape-core/src/heap.rs` (`pub mod heap;` in `lib.rs`; wasm-clean, no new
dependency). Modify `crates/redextape-core/src/trace/rxm_cursor.rs`.

**The core** (draft, first place it exists):

```rust
pub enum HeapFault { HeadOfEmpty, HeadOfInvalid, TailOfEmpty, TailOfInvalid,
                     BoxGetOfNull, BoxGetOfInvalid, BoxSetOfNull, BoxSetOfInvalid }   // Copy; Display = the message
pub struct HeapCapped;                                      // an allocation the cap refused
pub trait Tags {
    type Word: Copy;
    fn push_cell(&mut self, head: Self::Word, tail: Self::Word);
    fn cell(&self, i: usize) -> (Self::Word, Self::Word);   // default when absent
    fn push_box(&mut self, tag: Self::Word);
    fn box_tag(&self, i: usize) -> Self::Word;              // default when absent
    fn set_box(&mut self, i: usize, tag: Self::Word);       // grows, as `grow_set` does
}
pub struct NoTags;                                          // ZST, Word = ()
pub struct VecTags<W> { pub cells: Vec<(W, W)>, pub boxes: Vec<W> }   // a tag per word
pub struct Heap<R> { cells: Vec<(u64, u64)>, boxes: Vec<u64>, tags: R }   // the methods are on `impl<R: Tags>`
// cons(cap, (h, th), (t, tt)) -> Result<u64, HeapCapped>; head(p) / tail(p) -> Result<(u64, Word), HeapFault>;
// new_box(cap, (v, t)) -> Result<u64, HeapCapped>; box_get(p) -> Result<(u64, Word), HeapFault>;
// box_set(p, (v, t)) -> Result<(), HeapFault>; cells(), boxes(), tags(), into_cells().
pub const fn is_empty(p: u64) -> bool;                      // free, not a method: it looks nothing up
```

The messages are today's eight, verbatim: `head of empty list`, `head of invalid list pointer`, `tail of empty
list`, `tail of invalid list pointer`, `box_get of null handle`, `box_get of invalid handle`, `box_set of null
handle`, `box_set of invalid handle`. Pointers are 1-based, `0` is nil/null; the index is `usize::try_from(p -
1)`, a failure being the "invalid" fault. The cap check is `len >= cap` per arena. The heap decides; tags are read
after it and default when missing. Everything but the test-only `tags_mut` is `#[inline]`; `Heap` derives `Clone`,
`Debug`, `Default`.

The rxm interpreter's recorder is `VecTags<WordTag>`, whose vectors hold today's `heap_tags: Vec<(WordTag, WordTag)>`
and `box_tags: Vec<WordTag>`. `Vm`'s `heap`, `heap_tags`, `boxes`, `box_tags` become one `Heap<VecTags<WordTag>>`;
`cell` and `box_slot` go; `Cons`, `Head`, `Tail`, `IsEmpty`, `Box`, `BoxGet`, `BoxSet` call the core and map a
`HeapFault` `f` to `RxmStatus::Faulted(f.to_string())` and `HeapCapped` to `RxmStatus::Capped(RxmCap::Heap)`. Register
tags, `written`, frames and the mem cap stay in `Vm`. `RxmCursor::heap()`, `heap_tags()`, `boxes()`, `box_tags()` and
`into_outcome` keep their signatures. The tests that clear or overwrite `vm.heap_tags`/`vm.box_tags` directly reach the
recorder's vectors instead.

- [ ] Unit tests in `heap.rs` first: each of the eight faults' `Display`; a cap of 2 admits 2 cells AND 2 boxes
  and refuses the third of each; `p = u64::MAX` is "invalid", not a panic; tags pushed are read back and a
  missing tag reads as default; `box_set` past the tag vector's end grows it. Run them against a stub: FAIL.
- [ ] Implement the core; then move `Vm` onto it.
- [ ] Checks: `cargo nextest run -p redextape-core` and `-p redextape-wasm` (the session drives `RxmCursor`) pass
  with the counts they had before; `cargo nextest run -p redextape-native` (the oracles compare against `run_rxm`)
  passes; the snapshot gate is unchanged; `cargo check --target wasm32-unknown-unknown -p redextape-core --lib`
  exits 0.
- [ ] Sabotage: swap the `HeadOfEmpty` message to `head of nil` → the heap unit test and the rxm fault tests fail;
  make `cons`'s cap check `>` → the cap test fails.
- [ ] Commit `core: one heap core; the rxm interpreter uses it with a tagging recorder`.

## Task 11: native-rt on the heap core

**Files:** Modify `crates/redextape-native-rt/src/lib.rs`, `scripts/check-all.sh` (`base|wasm|-p
redextape-native-rt --lib`; `scripts/check-scoped.sh` too if it lists legs).

`Runtime`'s `pub heap` and `pub boxes` become one `heap: Heap<NoTags>` (no reader outside the crate: grep `crates/` for
`.heap`/`.boxes` on a `Runtime` before and after). Each `rt_*` body but `rt_is_empty`'s (it calls `heap::is_empty` and
reads no `Runtime`) becomes a safe `impl Runtime` method keeping today's order exactly: in the six heap methods,
`stopped()` first (returning `0`, or nothing from `box_set`), then the core, then `hit_cap = true` on `HeapCapped` and
`fault = Some(f.to_string())` on a `HeapFault` `f`; `rt_tick` and `rt_enter` check `stopped()` first too, returning `1`.
The other `extern "C"` functions become `unsafe { &mut *rt }.<method>(…)` (`&*rt` for `rt_faulted`) with their
`# Safety` docs. `stopped()`, `steps`, `depth`, `depth_cap`, `rt_tick`, `rt_enter`, `rt_leave`, `rt_faulted`, `rt_run`
and `into_outcome` stay native-rt's (D6: `rt_run` unchanged).

- [ ] Checks: `cargo nextest run -p redextape-native-rt` (its fault-string tests) and `-p redextape-native
  --features llvm` pass with their previous counts; the gate is unchanged; `cargo check --target
  wasm32-unknown-unknown -p redextape-native-rt --lib` exits 0 (it did before, V13; the new leg keeps it so).
- [ ] Per-call work (§7.2's last sentence): under the heavy lock, `cargo build --release -p redextape-native-rt`
  at Task 2's commit and at this task's (two scratch worktrees, own target dirs), then `objdump -d -C
  --no-show-raw-insn --disassemble=<sym>` over each `libredextape_native_rt.a` for the eleven `rt_*` symbols.
  Record each function's instruction count on both sides and diff the listings. An extra call, branch or memory
  access on a non-fault path is a finding to explain or remove before the task closes.
- [ ] Sabotage: in `Runtime::head`, skip the `stopped()` check → `native_oracle`'s fault tests or native-rt's
  latching tests fail (name which).
- [ ] Commit `native-rt: the runtime keeps its heap in the core; rt_* are thin wrappers`.

## Task 12: the native crate states what is not unified (§4.3)

**Files:** Modify `crates/redextape-native/src/lib.rs`'s `//!` crate doc (exempt from the 8-line cap; it counts
toward the area's comment share).

A short section, one item each with its why, from spec §2.2 (re-checked at `14621b1`): the rxm interpreter
charges a step per instruction, native ticks backward edges only (a call counts depth, not steps); only rxm has the
mem cap; both stop a call at `caps.stack`, rxm at `stack.len() >= caps.stack` before the push and native at `depth >
min(caps.stack, safe_depth)` after counting the call, so only native's `safe_depth` differs; an rxm callee sees its
caller's locals, a native callee's start at zero; a malformed program faults at run time in rxm and is a
`LowerError` natively; after a faulted callee returns, native runs on to its next guard. No history, no figures.

- [ ] `node scripts/check-comments.mjs` passes (guard base: the merge base with `origin/main`); if the area's
  share would rise above 0.3394, stop and ask (the user rules on budgets).
- [ ] Commit `native: the crate doc says what the two machines do differently, and why`.

## Task 13: §7.2, no hot path slows

Run by the controller or one dispatch that does nothing else, after D5's hold. Base = Task 2's commit; final =
Task 12's. Each side in a scratch worktree with its own `CARGO_TARGET_DIR`; scripts and logs in
`~/temp/redextape-ir-lowering-record/`.

- **M-native.** `cargo build --release --example opt_report -p redextape-native --features llvm` per side; copy
  each binary to the record and record its sha256 and the `libLLVM` it loads. Three interleaved pairs (base, then
  final), each `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- <binary>`, with `uptime` before
  and after each. Figures: every row's `compile` (native compile time over the corpus) and `compile+run` (the
  runtime-call-heavy rows are `list30000`, `map30000` and `box30000`, Cranelift and LLVM, at O0 and O3).
- **Object sizes must be EQUAL** base vs final in every one of the 60 rows: no task changes machine code (Tasks 8
  and 8b rename IR values; Task 9 adds CLIF metadata only). A row that differs is a finding.
- **M-browser.** `cd web && pnpm run test:probe:rxm-copy` per side (it builds that side's wasm; its corpus has a
  filled heap and filled boxes), three interleaved pairs under the browser lock.
- **The rule** (#160's, which the user accepted): per figure, the median of a side's three runs; flag a final
  median above base's by more than base's spread (largest less smallest); browser figures that must not vary
  (instruction counts, steps, caps, frames) must be equal across all six runs. Any flag → a repeat round and the
  pooled six-against-six; a figure flagged after pooling blocks the PR until explained or removed.
- Record in the roadmap entry under "THE §7.2 MEASUREMENTS": the machine, the time window, the load at each run,
  each command, each binary's sha256, the flagged figures with their ratios, and the median final/base ratio per
  backend and metric. Task 11's `rt_*` listing comparison goes beside it.

## Task 14: roadmap entry and the whole-branch gate

- [ ] The roadmap entry (last in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`), before any PR: what
  shipped per task with SHAs; §8's changes, D3's among them, each with its measured diff shape; the snapshot gate (where
  the files live, how to regenerate, that CI fails on post-pass IR only on the recorded release, D1 as revised);
  `box30000`'s margins; Task 1 C4's container result; §7.2; WHAT THIS DID NOT CLOSE (at least: on CI's LLVM a
  post-pass IR difference only prints a `NOTE:` nobody sees; the Mac size file
  if D4's refresh did not happen). Every figure names the command that produced it.
- [ ] Whole-branch gate, each under the heavy lock, logs to the record, exit status read from the file:
  `scripts/check-all.sh` (all tiers, with LLVM), `cargo llvm-cov nextest --workspace --fail-under-lines 90`,
  `scripts/check-slow.sh`, the eight scans and the comment guard (`--self-test`, then alone),
  `scripts/check-licences.sh` (no dependency was added, so it must pass unchanged), the browser tier, and
  `pnpm run test:coverage` in `web/` with the floors unchanged or raised (§7.3).
- [ ] A whole-branch review before the PR (memory `whole-branch-review-finds-what-task-reviews-cannot`).

---

## Spec coverage

| Spec | Task |
|---|---|
| §4.2 shape, walk generic and monomorphised, no step list materialised | 5, 6 |
| §4.2 runtime import table once | 4 |
| §4.2 register naming from one place; alloca rename and load rename, each in its own commit | 8, 8b |
| §4.2 `set_srcloc` per instruction | 9 |
| §4.2 off `dyn Module`; `Module`-free path; equality test; `clif` feature; wasm32 check | 7 |
| §4.3 heap core, faults once, 32-bit-safe index, recorder | 10 |
| §4.3 native-rt methods and wrappers; wasm32 check | 11 |
| §4.3 "not unified" section | 12 |
| §7.1 snapshot test, fixed targets, both halves, stays in the suite | 1 (and the gate in every later task) |
| §7.1 existing oracles unchanged | every task's nextest runs; 14 |
| §7.2 hot paths, box builder, no-op recorder's per-call work | 2, 11, 13 |
| §7.3 full checks | 14 |
| §8 | 1 (D3), 8, 8b, 9; recorded in 14 |
