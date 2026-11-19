# CLIF view PR 1: the package, no UI — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the CLIF view design's PR 1 (§7.1): Cranelift 0.137.2, value labels, the ISA-free optimised listing, a
generic `Runtime`, a stepper over Cranelift's interpreter that ends where the JIT ends, the CLIF leg, the `Program`
export from `pkg/` and a new wasm package `pkg-clif/`, wired into the build, CI and the licences, with no UI and no change
to what any view shows.

**Architecture:** `redextape-native` gains value labels and `build_listing` (as built, or optimised with
`Context::optimize`'s steps under plain `Flags`). `redextape-native-rt`'s `Runtime` becomes generic over core's heap
`Tags` with its methods public. A new rlib, `redextape-clif`, steps one CLIF instruction at a time with
`cranelift_interpreter::step::step`, answers the 11 runtime imports through `Runtime<VecTags<WordTag>>`, and serves a leg
shaped like `RxmLeg`. A cdylib, `redextape-clif-wasm`, exports it into `pkg-clif/`.

**Tech Stack:** Rust 1.100 (stable), cranelift-codegen/-frontend/-interpreter 0.137.2, wasm-bindgen 0.2.130,
serde-wasm-bindgen 0.6.5, self_cell 1.3.0, cargo-nextest, wasm-pack 0.15.1, Vitest 4 (node tier), node 26.

**Spec:** `docs/superpowers/specs/2026-11-18-clif-view-design.md` (§5, §5.6, §6's build wiring list, §7.1, §8). Decisions
and task order: `$R/plan-brief.md`. Evidence: `$R/probe/` (README, `worktree.diff`, `clif-probe/`, `logs/`) and the
measurements in **Verified facts**, taken 2026-11-19 in the probe worktree.

## Global Constraints

- **Paths.** `W=/home/davey/temp/redextape-clif-view` (branch `clif-view`, base `2cf0de1`),
  `R=/home/davey/temp/redextape-clif-view-record`, `P=/home/davey/temp/redextape-clif-probe` (the probe worktree, read only;
  its `crates/clif-probe/src/lib.rs` is the reference for `optimise` and the step loop). Commands run from `$W` unless they
  say otherwise. Line references are at `2cf0de1`; after an earlier task edits a file, find the place by name.
- **Cargo.** Every cargo and wasm-pack run sets `CARGO_TARGET_DIR=/home/davey/.cache/redextape-clif-view-target` (`$T`
  below). LLVM legs also set `LLVM_SYS_231_PREFIX=/usr`.
- **Logs.** Every build and test run writes `>| $R/logs/<task>-<what>.log 2>&1`, then `print $?`; summaries are read from
  the log (`rg 'Summary|test result|^error' <log>`). Piping a gate through `tail` hides its exit status. The shell is zsh
  with `noclobber`: always `>|`, and `${=args}` where one variable holds several arguments.
- **Sabotage.** `cp <file> $R/sab/<name>`, make the one change named, run the named tests with
  `cargo nextest run --no-fail-fast` into a log, read its `Summary` line, `cp $R/sab/<name> <file>`, then
  `cmp $R/sab/<name> <file>`. Never `git checkout` to restore. Record each in `$R/sabotage.md` (change, tests red, Summary
  line). **A sabotage that does not fire is a finding: stop and report it.** A test whose assertions are each
  load-bearing is sabotaged once per assertion, or its report says only the first is evidenced.
- **Clippy configs.** Each task's **Gate** names the configs it must pass, all with `-- -D warnings`:
  - **P** (the pre-commit hook): `cargo fmt --all --check`; `cargo clippy --workspace --all-targets`.
  - **D**: `cargo clippy -p redextape-native --no-default-features --all-targets`. Its manifest warning
    `unused dependency redextape-native-rt` is on `2cf0de1` too (checked 2026-11-19) and does not fail the leg.
  - **C**: `cargo clippy -p redextape-native --no-default-features --features clif --all-targets`.
  - **L**: `cargo clippy -p redextape-native --features llvm --all-targets`, and with `--no-default-features --features llvm`.
  - **S**: `cargo clippy -p redextape-core --features serde --all-targets`, and with `--features ts`.
  - **X**: `cargo clippy -p redextape-wasm --features probe-no-tm-scratch-ceiling --all-targets`, and with `--features probe-rxm-copy`.
  - **W** (wasm32, `cargo check --target wasm32-unknown-unknown`): `-p redextape-native --lib --no-default-features --features clif`,
    `-p redextape-native-rt --lib`, `-p redextape-core --lib --features serde`, `-p redextape-wasm --lib`; from Task 5 also
    `-p redextape-clif --lib`, from Task 11 `-p redextape-clif-wasm --lib`.

  `scripts/check-all.sh --list` prints every leg; Task 13 runs them all.
- **Commit protocol.** The task's tests and Gate pass, then `git commit` through the pre-commit hook. Never `--no-verify`,
  never `--amend` (auto mode refuses it): a fix is a new commit. A commit the hook refuses for `dead_code` folds into the
  next step's commit, and the message says so.
- **Comment budget.** The hook runs `node scripts/check-comments.mjs` on every commit, and judges a new crate from its first
  commit: Tasks 5 and 11 add `crates/redextape-clif` and `crates/redextape-clif-wasm` to `scripts/comment-budget.json`
  with the share the hook prints. When it refuses on Rule 3, in either direction, write the value it prints in that same
  commit. Task 13 writes the final values.
- **Comments say why** (`$W/CLAUDE.md`): the reason, the invariant, what breaks. No history, no measurements (those go in
  the roadmap entry), no `file:line` in tracked source (`scripts/check-citations.sh`). Before writing
  "`file.rs`'s `symbol`", grep for the symbol's definition. Rust docs are `///`, TypeScript `/** */`.
- **No panics in library code** (workspace lints): no `unwrap`, `expect`, `panic!`, panicking index, or `Frame::get` on a
  value the stepper has not seen set. Integration test files open with
  `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]` as `tests/native_oracle.rs` does.
- **The anti-goals are constraints.** `pkg/` gains no `cranelift-*` crate and grows by the §5.6 export alone. The JIT's,
  AOT's and LLVM's generated code does not change after Task 1: the snapshot gate passes unchanged after Tasks 2, 3 and 4.
  No second copy of the runtime's rules: the stepper calls `Runtime`'s methods, and which import is which comes from
  `RtFn::ALL`, never a second index table. The `rt_*` bodies in native-rt's staticlib stay identical (Task 4).
- **Dependencies** take the latest release; check with `cargo info <crate>` before adding. On 2026-11-19: cranelift 0.137.2
  (0.138.0-rc.1 is a pre-release), self_cell 1.3.0 (Apache-2.0 OR GPL-2.0-only), target-lexicon 0.13.6 (the lock has 0.13.5).
- **Memory.** The slow tier and Task 13's gate run under `systemd-run --user --scope -q -p MemoryMax=16G -p MemorySwapMax=0`.
  The stepper holds up to 113 MB of frames on `measure-box30000` (Verified facts).

## Review Focus

Failure modes the design implies that no task's main test reaches, most likely first. Each has its test in the task named.

1. **A literal above 2^53 crossing from `pkg/` to `pkg-clif/`.** serde-wasm-bindgen refuses a `u64` past
   `Number.MAX_SAFE_INTEGER` as a number, and `18446744073709551615 + 1` lowers to an `li` of that word. Task 11.
2. **`[continue]` must not count the tripping call twice.** A resumed run reaches the same end at the same step as a fresh
   run under the raised caps, for each trip kind and for the frame-memory stop. Task 7.
3. **A fault names the call that faulted.** Native code runs on past a faulting `rt_head` to its exit block, so the value
   reads `head of empty list at pc1` for `head(nil)`, the rxm leg's text, not the exit's position. Task 9.
4. **The values panel never reads an unset value.** `Frame::get` panics on one, and a panic aborts the wasm module. The
   state is built after every step of every fast-tier corpus program, both listings. Task 6.
5. **A rewind after a raised cap returns to the compile's caps**, as `RxmLeg::rewind` does. Task 9.

## Departures from the brief

| Brief says | This plan does | Evidence |
|---|---|---|
| `raise_cap(&mut self, caps, tripped: RtFn)` | `raise_cap(&mut self, caps: Caps, tripped: Tripped)`, with native-rt's own `pub enum Tripped { Tick, Enter, Alloc }`; the stepper maps `RtFn` to it | `RtFn` lives in `redextape-native`, which depends on native-rt, so native-rt cannot name it |
| the methods the `rt_*` wrap become pub, with tags | `cons`, `new_box` and `box_set` take `(u64, T::Word)` pairs; `head`, `tail` and `box_get` keep returning the bare word, and the stepper reads a read's tag from `Runtime::heap()` | Probe, 2026-11-19: reads returning `(u64, T::Word)` changed the compiled bodies of `rt_head`, `rt_tail` and `rt_box_get`; bare-word reads left all 12 `rt_*` bodies identical |
| frame memory "32 B x num_values per frame" | `size_of::<Option<DataValue>>() + size_of::<Option<WordTag>>()`, 33 B per value; only frames a call pushed count, never main's | The stepper keeps a tag-or-unset byte per value (Task 6). rxm's `caps.mem` counts saved frames, not the running one (the `Instr::Call` arm of `rxm_cursor.rs`) |
| JIT agreement at default caps over every corpus program | The five `measure-*` programs run at default caps in the slow tier (`#[ignore]`, release, `scripts/check-slow.sh`); the rest in the fast tier | Dev profile, probe: the default-caps tally took 58.0 s, `measure-loop1000000` 41.5 s of it |
| state (T6) before rows (T8) | Kept. The state names an instruction by `ClifAt { function, inst }` and T8's rows carry the same key, so neither task edits the other's types | — |

## Decisions for the user

Answered 2026-11-19: Q1 **bytes**; execution subagent-driven, in a fresh session.

| | Question | This plan assumes | If answered otherwise |
|---|---|---|---|
| Q1 | The rxm cursor's `caps.mem` counts words. Does the stepper compare frame **bytes** (brief) or **words** (bytes / 8, rounded up) against it? | **Bytes.** At default caps `measure-box30000` stops at the memory cap in both listings; `measure-map30000` optimised peaks at 60,392,013 B, 94% of 64,000,000 | **Words:** each frame's bytes divide by 8, rounding up; Task 7's boundaries become 870 and 910 words (each frame rounded up), and the slow tier's frame-memory list is empty (largest peak 14.11 M words) |

## Verified facts

| Fact | Value | Source |
|---|---|---|
| 0.137.2 against 0.137.1 | src of all 16 cranelift crates byte-identical; snapshots unchanged; the size baseline changes only its `# cranelift:` line; the lock moves 16 `cranelift-*` to 0.137.2 and `wasmtime-internal-core`, `wasmtime-internal-jit-icache-coherence` 50.0.1 to 50.0.2 | `$R/probe/logs/q1-*`, `worktree.diff` |
| Interpreter API, 0.137.2 | `pub fn step<'a, I: InstructionContext>(state: &mut dyn State<'a>, inst_context: I) -> Result<ControlFlow<'a>, StepError>` (step.rs:63); `ControlFlow` (step.rs:1340) is `Assign`, `Continue`, `ContinueAt`, `Call`, `ReturnCall`, `Return`, `Trap`; `Frame::get` resolves aliases and panics on an unset slot; `Frame::entries_mut` needs `&mut`; a `call` of `u0:0` to `u0:10` is `StepError::UnknownFunction`, so the stepper answers it before `step` | registry source; probe README |
| ISA-free optimise | plain `Flags` (only `opt_level` set) give each snapshot's optimised section, 72/72 at none, speed and speed_and_size, both targets. `TargetFrontendConfig { default_call_conv: SystemV, pointer_width: PointerWidth::U64, page_size_align_log2: 12 }` gives every `built` section. The egraph skipped: 0/72 | `q3.log`, `q3-sabotage.log` |
| Stepper against the JIT, `jit::compile_and_run(prog, caps, OptLevel::O0)` | Default caps: 72/72 both listings; 70 Ran, 2 Fault. Tight caps (steps 40, stack 6, heap 4, mem default): 72/72; 56 Ran, 2 Fault, 14 HitCap: Heap 6 (`example-map-fold`, `first-order-24`, `-25`, `-26`, `-37`, `measure-box30000`), Stack 7 (`beyond-field-width-02`, `example-fact-12`, `example-is-even`, `first-order-36`, `measure-list30000`, `measure-map30000`, `measure-sum30000`), Steps 1 (`measure-loop1000000`), alike in both listings. `rt_head` and `rt_tail` swapped: 51/72 | `q4-tally.log`, `q4-tally-sabotage.log`, probe 2026-11-19 |
| The JIT's depth cap | `Runtime::with_depth_cap(caps, native_depth_cap(prog, subs, caps))` (jit.rs:151). The corpus's largest locals plus args is 26, so `frame_bytes` ≤ 3,136 and `safe_depth` ≥ 168,521 > 100,000: `native_depth_cap == caps.stack` at default and tight caps for every corpus program, and no `Runtime::new(caps)` JIT path is needed. Task 5 pins it | probe; `shared.rs` |
| Steps: instructions completed, runtime calls and main's `return` included | `example-sum-to` 183 built, 134 optimised; `example-fact` 189, 131; `measure-loop1000000` 29,000,030, 24,000,016; at tight caps it pauses at its tripping `rt_tick` after 1,205 and 985 | `q4-smoke.log`, probe |
| Speed | native release 4.4 to 23.1 M steps/s (`loop1000000` built: 1.29 s); dev profile about 0.7 M steps/s | `q4-smoke.log`, `q5-probe-all.log`, probe |
| Slots | `size_of::<Option<DataValue>>()` is 32 on x86_64 and on wasm32 (a const assert under `cargo check --target wasm32-unknown-unknown`) | probe |
| `num_values` | `example-fact` u0:11: 11 built, 11 optimised; u0:12: 42, 44. Optimising can grow a function's value count | probe |
| Peak slots of pushed frames, default caps, built / optimised | `measure-box30000` 3,150,105 / 3,420,114; `measure-map30000` 1,800,060 / 1,830,061; `measure-sum30000` 1,260,042 / 1,320,044; `measure-list30000` 1,230,041 / 1,290,043; every other program under 4,500 | probe |
| Labels on defined values (block params and results in layout), probe placement | `example-fact` built: u0:11 5 values, `{a0, r0, rr}`; u0:12 19 values, `{a0, r0, r1, r2, r3, r4, r5, r6, r7, r8, rr}`. Optimised: u0:11 3, `{a0, r0, rr}`; u0:12 7, `{a0, r0, r6, r8, rr}` | probe |
| Subroutine names | `partition` names main `$main` and each fn by its label: `example-fact`'s u0:12 is `fact.0` (entry pc 1) | probe; `analysis.rs` |
| `fault-00`, `head(nil)` | its `call fn1` (`rt_head`) carries `@0001`; the rxm leg's value is `head of empty list at pc1` | `snapshots/fault-00.clif` |
| `example-sum-to` built u0:11 | 63 lines in `func.display()`; `@0014` (pc 20) `v4 = iconst.i64 5`, then aliases `v5 -> v4` and `v7 -> v4`, then `@0014` `jump block3`; instructions indent 36, block headers 32 | `snapshots/example-sum-to.clif` |
| `rt_*` disassembly | Task 4's command gives 12 symbols (11 imports and `rt_run`), 949 lines; identical before and after a generic `Runtime` with bare-word reads | probe |
| Wasm size | unoptimised wasm32 cdylib holding parse, lower, clif, stepper and printer: 1.8 MB raw, 459,619 B gzip -9 | brief |
| Tools | GNU objdump 2.47, twiggy, wasm-opt, node v26.13.1, rustc 1.100.0; no wasm-objdump | `which` |

## File structure

| File | Responsibility | Task |
|---|---|---|
| `crates/redextape-native/Cargo.toml`, `baselines/x86_64-unknown-linux-gnu.txt`, `Cargo.lock` | 0.137.2; `target-lexicon` under `clif` | 1, 3 |
| `crates/redextape-core/src/tm/rxm.rs` | `reg_label` and `label_reg` beside `reg_str` | 2 |
| `crates/redextape-native/src/{codegen,module_free,lib,rt_imports}.rs` | labels; `isa_free_config`, `Listing`, `build_listing`; `RtFn` public | 2, 3, 5 |
| `crates/redextape-native/src/codegen_snapshots.rs` | label, optimise and depth-cap tests over the corpus | 2, 3, 5 |
| `crates/redextape-native-rt/src/lib.rs` | `Runtime<T: Tags = NoTags>`, `Tripped`, `raise_cap`, `heap` | 4 |
| `crates/redextape-core/src/viewmodel.rs` | `heap_cells` and `heap_boxes` out of `RxmState::window` | 6 |
| `crates/redextape-clif/` (new): `src/{lib,stepper,state,listing,leg}.rs`, `tests/{common/mod,agreement,state,listing,leg}.rs` | the stepper, tags, frames, rows and the leg | 5 to 9 |
| `crates/redextape-core/src/ty.rs`, `crates/redextape-wasm/src/{session,lib}.rs` | `Ty`'s serde derive; `clifInput()` | 10 |
| `crates/redextape-clif-wasm/` (new), `web/tests/node/clif-package.test.ts` (new) | the exports; the end-to-end test | 11 |
| `Cargo.toml`, `.gitignore`, `Dockerfile`, `.forgejo/workflows/ci.yml`, `scripts/{check-all.sh,comment-budget.json}`, `.pre-commit-config.yaml`, `web/{package.json,scripts/licences.ts,src/third-party-licences.json,tests/node/licences-scan.test.ts}`, `docs/{development,architecture}.md` | build, CI and licence wiring | 5, 11 |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the entry | 13 |

---

### Before Task 1: set up (no commit)

- [ ] **Step 1.** `mkdir -p $R/logs $R/sab $R/gate`. From `$W/web`: `pnpm install --frozen-lockfile`, `pnpm run build:wasm`,
  `pnpm run build:lsp-wasm`, `pnpm run build:bindings`, into `$R/logs/setup.log`. Expected: exit 0, and `$W/pkg/` and
  `$W/pkg-lsp/` each hold a `_bg.wasm`. Real directories, not symlinks.
- [ ] **Step 2.** For Task 12: `git -C $W worktree add --detach /home/davey/temp/redextape-clif-view-base 2cf0de1`. It
  builds with `CARGO_TARGET_DIR=/home/davey/.cache/redextape-clif-view-base-target`, never `$T`.
- [ ] **Step 3.** `cargo nextest run --workspace --no-fail-fast` into `$R/logs/setup-tests.log`. Expected: exit 0. Copy its
  Summary line to `$R/baseline.md`.

### Task 1: Cranelift 0.137.2

Spec §5.1. The interpreter is published at 0.137.2 and must step codegen's own `Function` type.

**Files:** Modify `crates/redextape-native/Cargo.toml:20-25` and `:29` (the dev-dependency), `Cargo.lock`,
`crates/redextape-native/baselines/x86_64-unknown-linux-gnu.txt:3`.

- [ ] **Step 1: Bump.** Every `cranelift-*` requirement becomes `"0.137.2"`. Build; the lock moves as Verified facts says.
- [ ] **Step 2: Snapshot gate.** `REDEXTAPE_WRITE_SNAPSHOTS=1 cargo nextest run -p redextape-native --features llvm --lib codegen_snapshots`,
  then `git status --short -- crates/redextape-native/snapshots`. Expected: empty. If any snapshot moved, stop: the bump
  goes back to the user with the diff (§5.1).
- [ ] **Step 3: Size baseline.** `cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline`,
  then `git diff -U0 -- crates/redextape-native/baselines`. Expected: only `-# cranelift: 0.137.1` / `+# cranelift: 0.137.2`.
  Any other line: stop and report.
- [ ] **Step 4: Tests.** `cargo nextest run -p redextape-native --features llvm --no-fail-fast` and
  `cargo nextest run --workspace --no-fail-fast`. Expected: exit 0.
- [ ] **Gate:** P, D, C, L, W.
- [ ] **Commit:** `Cranelift moves to 0.137.2, the version its interpreter is published at; no generated code changes`.

### Task 2: Value labels name the rxm register

Spec §5.2. Brief: the encoding lives beside `tm::reg_str`.

**Files:**
- Modify: `crates/redextape-core/src/tm/rxm.rs:163` (after `reg_str`) and its `mod tests` (:988);
  `crates/redextape-native/src/codegen.rs:236-266` (`read_reg`, `write_reg`) and `:366-383` (the prologue's banks);
  `crates/redextape-native/src/module_free.rs:70-75` (`build_clif`'s loop); `crates/redextape-native/src/codegen_snapshots.rs`.

**Interfaces:**
- Produces, in `redextape_core::tm` (exported as `reg_str` is): `pub fn reg_label(r: Reg) -> Option<u32>` with `Rr` 0,
  `Arg(n)` 1 + 2n, `Loc(n)` 2 + 2n, `None` when that overflows `u32`; `pub fn label_reg(label: u32) -> Reg`, its inverse,
  total over `u32`.
- `build_clif`'s functions carry `dfg.values_labels`; `define_all`'s do not.

- [ ] **Step 1: Failing tests.**
  - core, `registers_round_trip_through_their_labels`: `reg_label(Reg::Rr) == Some(0)`, `reg_label(Reg::Arg(0)) == Some(1)`,
    `reg_label(Reg::Loc(0)) == Some(2)`, `reg_label(Reg::Arg(2_147_483_647)) == Some(u32::MAX)`,
    `reg_label(Reg::Arg(2_147_483_648)) == None`, `reg_label(Reg::Loc(2_147_483_646)) == Some(4_294_967_294)`,
    `reg_label(Reg::Loc(2_147_483_647)) == None`; `label_reg(reg_label(r).unwrap()) == r` for `Rr`, `Arg` and `Loc` at
    0, 1, 7 and 1,000,000; and `label_reg(l)` then `reg_label` gives `Some(l)` for `l` in `0..=1_000` and `u32::MAX - 1`, `u32::MAX`.
  - `module_free.rs` tests, `build_clif_labels_each_value_with_its_register`: build `web/src/examples/fact.rxt` (via
    `include_str!("../../../web/src/examples/fact.rxt")`, as `codegen_snapshots.rs` does). Over each function's defined
    values (block params and instruction results in layout order) that carry a `ValueLabelAssignments::Starts`: u0:11 has
    5, decoding (`label_reg` then `reg_str`) to `{"a0", "r0", "rr"}`; u0:12 has 19, decoding to
    `{"a0", "r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "rr"}`.
  - `codegen_snapshots.rs`, `the_module_paths_collect_no_labels`: for every corpus program, in `define_all`'s
    `Stage::Built` callback, `ctx.func.dfg.values_labels.is_none()`.
- [ ] **Step 2: Run.** Expected: the core test and the label test fail to compile or fail; `the_module_paths_collect_no_labels`
  passes (it holds what must not change).
- [ ] **Step 3: Implement.** Labels are set with `FunctionBuilder::set_val_label(value, ValueLabel::from_u32(label))`
  exactly where the probe set them (`$R/probe/worktree.diff`): in `read_reg` on the `use_var` result (not on the `iconst 0`
  for a missing register), in `write_reg` after each `def_var`, and in the prologue on each argument's initial value, each
  local's zero and `rr`'s zero. A `None` label sets nothing (`build_clif` refuses such a register earlier, through
  `reg_over_cap`). `build_clif` alone calls `func.collect_debug_info()` before translating each function.
- [ ] **Step 4: Run** the three tests, then the snapshot gate as in Task 1 Step 2. Expected: PASS; no snapshot moves.
- [ ] **Step 5: Sabotage.**

| Change | Must fail |
|---|---|
| `Arg(n)` encodes as `2 + 2n` | `registers_round_trip_through_their_labels` |
| drop the label in `write_reg`'s `Loc` arm | `build_clif_labels_each_value_with_its_register` (u0:12's count) |
| `collect_debug_info` moves into `translate_subroutine` | `the_module_paths_collect_no_labels` |
| `build_clif` skips `collect_debug_info` | `build_clif_labels_each_value_with_its_register` |

- [ ] **Gate:** P, D, C, L, S, W.
- [ ] **Commit:** `CLIF built for the browser labels each value with the rxm register it belongs to`.

### Task 3: The optimised listing without an ISA

Spec §5.3. Brief: `Listing` in `module_free`, beside `build_clif`.

**Files:**
- Modify: `crates/redextape-native/Cargo.toml` (`target-lexicon = { version = "0.13.6", optional = true }`, enabled by
  `clif`), `src/module_free.rs`, `src/lib.rs:79-80` (re-exports), `src/codegen_snapshots.rs`.

**Interfaces:** produces, re-exported from `redextape_native` under `clif`:
- `pub fn isa_free_config() -> TargetFrontendConfig`: `SystemV`, `PointerWidth::U64`, `page_size_align_log2: 12`.
- `pub enum Listing { AsBuilt, Optimised }` (`Clone, Copy, Debug, PartialEq, Eq`) with `pub fn parse(name: &str) -> Option<Listing>`
  and `pub fn name(self) -> &'static str`, the names `"as-built"` and `"optimised"`.
- `pub fn build_listing(prog: &Program, listing: Listing) -> Result<Vec<Function>, LowerError>`: `build_clif(prog,
  isa_free_config())`, then for `Optimised` each function through a private `optimise` that runs `Context::optimize`'s steps
  with `Flags` built from `settings::builder()` with only `opt_level = speed` (the probe's `optimise` and `plain_flags`).
  A `CodegenError` maps to `LowerError::Unsupported` as `build_clif` maps a translate error.

- [ ] **Step 1: Failing tests.**
  - `codegen_snapshots.rs`, `the_isa_free_listings_equal_the_snapshot_sections`: for every corpus program, the functions of
    `build_listing(p, AsBuilt)`, displayed and joined as `push_section` joins them, equal the on-disk `built` section, and
    those of `build_listing(p, Optimised)` equal both the `x86_64-unknown-linux-gnu speed: optimised` and the
    `aarch64-unknown-linux-gnu speed: optimised` sections. A section is the text after its `;; ==== <title> ====` line up
    to the next `\n;; ==== ` or the end of the file; equality, never `contains`, since a prefix would pass.
  - `module_free.rs` tests, `labels_survive_on_the_values_the_optimiser_keeps`: `fact.rxt` optimised: u0:11 3 labelled
    values decoding to `{"a0", "r0", "rr"}`; u0:12 7, to `{"a0", "r0", "r6", "r8", "rr"}`. And `Listing::parse` of each
    `name()` round-trips, `Listing::parse("optimized") == None`.
- [ ] **Step 2: Run.** Expected: FAIL to compile (`build_listing` does not exist).
- [ ] **Step 3: Implement** as Interfaces says. If the equality cannot be made to hold, stop: §5.3 sends it back to the user.
- [ ] **Step 4: Run** both tests, the snapshot gate, and `cargo nextest run -p redextape-native --no-default-features --features clif`.
  Expected: PASS; no snapshot moves.
- [ ] **Step 5: Sabotage.**

| Change | Must fail |
|---|---|
| `optimise` uses `opt_level = none` (egraph skipped) | the optimised half of `the_isa_free_listings_equal_the_snapshot_sections` (probe: 0/72) |
| `build_listing(p, AsBuilt)` optimises too | its built half |

- [ ] **Gate:** P, D, C, L, W.
- [ ] **Commit:** `The optimised CLIF listing is built without an ISA and equals Cranelift's speed output for both targets`.

### Task 4: One runtime, generic over the heap's tags

Spec §5.4. Brief: no new field in `Runtime`; `rt_*` bodies identical, checked by disassembly.

**Files:** Modify `crates/redextape-native-rt/src/lib.rs:23-196` and its `mod tests` (:493).

**Interfaces:** produces, in `redextape_native_rt`:
- `pub struct Runtime<T: Tags = NoTags>`, its private `heap: Heap<T>` the only changed field. `new` and `with_depth_cap` move to
  `impl<T: Tags + Default> Runtime<T>`; a call site that does not pin `T` writes `Runtime::<NoTags>`.
- Public, same bodies as today's private methods: `cons(&mut self, h: (u64, T::Word), t: (u64, T::Word)) -> u64`,
  `head(&mut self, p: u64) -> u64`, `tail(&mut self, p: u64) -> u64`, `new_box(&mut self, v: (u64, T::Word)) -> u64`,
  `box_get(&mut self, p: u64) -> u64`, `box_set(&mut self, p: u64, v: (u64, T::Word))`, `tick`, `enter`, `leave`,
  `faulted`. The reads keep returning the bare word: a read's tag is `heap().head(p)`'s (and `tail`'s, `box_get`'s).
- `pub fn heap(&self) -> &Heap<T>`.
- `pub enum Tripped { Tick, Enter, Alloc }` and `pub fn raise_cap(&mut self, caps: Caps, tripped: Tripped)`: when `hit_cap`
  is set, undo the tripping call's own count (`Tick`: `steps -= 1`; `Enter`: `depth -= 1`; `Alloc`: nothing, a refused
  allocation allocated nothing) and clear `hit_cap`; in every case install `caps` and `depth_cap = caps.stack` (a runtime
  made by `new`). `fault` is never touched.
- The `rt_*` wrappers pass `((h, ()), (t, ()))` and `(v, ())`; their `*mut Runtime` is `Runtime<NoTags>`.

- [ ] **Step 1: The "before" disassembly**, at HEAD before any edit. Write `$R/rtdis.zsh`:

```zsh
for s in rt_cons rt_head rt_tail rt_is_empty rt_box rt_box_get rt_box_set rt_tick rt_enter rt_leave rt_faulted rt_run; do
  objdump -d --no-show-raw-insn --no-addresses -r --disassemble=$s $1 | sed -n "/^<$s>:/,/^\$/p" |
    sed -E 's/\.Lanon\.[0-9a-f]+\.[0-9]+/.Lanon/g'
done
```

  Then `cargo build --release -p redextape-native-rt` and `zsh $R/rtdis.zsh $T/release/libredextape_native_rt.a >| $R/rt-before.txt`.
  Expected: `grep -c '^<rt_' $R/rt-before.txt` prints 12.
- [ ] **Step 2: Failing tests** in `mod tests`:
  - `a_raised_step_cap_repeats_the_tick_that_tripped`: `Caps { steps: 3, ..DEFAULT_CAPS }`; three `tick()` return 0, the
    fourth 1; `raise_cap(Caps { steps: 4, ..DEFAULT_CAPS }, Tripped::Tick)` leaves `steps == 3`, `!hit_cap`; `tick()` returns 0
    (`steps == 4`), the next 1.
  - `a_raised_stack_cap_repeats_the_enter_that_tripped`: `stack: 2`; `enter()` 0, 0, then 1 (`depth == 3`);
    `raise_cap(Caps { stack: 3, .. }, Tripped::Enter)` gives `depth == 2`, `depth_cap == 3`; `enter()` 0, then 1.
  - `a_raised_heap_cap_repeats_the_refused_allocation`: `heap: 1`; `cons((7, ()), (0, ()))` 1, the next 0 and `hit_cap`;
    `raise_cap(Caps { heap: 2, .. }, Tripped::Alloc)`; `heap().cells().len() == 1`; `cons((8, ()), (0, ()))` returns 2.
  - `raising_a_cap_that_did_not_trip_undoes_nothing`: two `tick()`; `raise_cap(DEFAULT_CAPS, Tripped::Tick)`; `steps == 2`.
    And on a runtime with a latched fault: `raise_cap(..)` leaves `fault == Some("head of empty list")`.
  - `a_tagged_heap_keeps_each_words_tag`: `Runtime::<VecTags<WordTag>>::new(DEFAULT_CAPS)`; `cons((7, WordTag::Value), (0, WordTag::List))`
    is 1 and `heap().tags().cells == [(Value, List)]`; `new_box((1, WordTag::List))` then `box_set(1, (5, WordTag::Value))`:
    `heap().tags().boxes == [Value]`; `head(1) == 7` and `heap().head(1) == Ok((7, Value))`.
- [ ] **Step 3: Run.** Expected: FAIL to compile.
- [ ] **Step 4: Implement** as Interfaces says. The tests import `WordTag` from `redextape_core::trace` and `VecTags` from
  `redextape_core::heap`. Every `Caps { .. }` above is completed with `..DEFAULT_CAPS`.
- [ ] **Step 5: Run** native-rt's tests, `cargo nextest run -p redextape-native --features llvm --no-fail-fast` (the JIT, AOT
  and LLVM oracles), and the snapshot gate. Expected: PASS; no snapshot moves; `git diff` of native-rt's existing tests is
  empty apart from a `Runtime::<NoTags>` where inference needs it.
- [ ] **Step 6: The "after" disassembly.** Rebuild as Step 1 into `$R/rt-after.txt`; `diff $R/rt-before.txt $R/rt-after.txt`.
  Expected: exit 0, no output. Any difference stops the task and goes back to the controller with the diff.
- [ ] **Step 7: Sabotage.**

| Change | Must fail |
|---|---|
| `raise_cap` does not undo `Tick` | `a_raised_step_cap_repeats_the_tick_that_tripped` |
| `raise_cap` does not undo `Enter` | `a_raised_stack_cap_repeats_the_enter_that_tripped` |
| `raise_cap` leaves `hit_cap` set | `a_raised_heap_cap_repeats_the_refused_allocation` |
| `raise_cap` undoes without checking `hit_cap` | `raising_a_cap_that_did_not_trip_undoes_nothing` |
| `cons` records the tail's tag for both words | `a_tagged_heap_keeps_each_words_tag` |
| `head` returns `(u64, T::Word)` and `rt_head` takes `.0` | Step 6's diff (probe: `rt_head` changes) |

- [ ] **Gate:** P, D, C, L, W.
- [ ] **Commit:** `native-rt's Runtime is generic over the heap's tags, with its methods public and a cap that can be raised past the call that tripped it`.

### Task 5: `redextape-clif`: the stepper ends where the JIT ends

Spec §5.5 (the stepper), §8 "Native rules". Brief: an rlib, natively testable; the JIT comparison over the snapshot and
oracle corpora, both listings, default and tight caps. The oracle's five lists (`tests/common/corpus.rs`) are 59 of the
snapshot corpus's 72 programs; the oracle's random programs (`arb_expr_below(1000)`, 64 cases) are this task's proptest.

**Files:**
- Create: `crates/redextape-clif/Cargo.toml`, `src/lib.rs`, `src/stepper.rs`, `tests/common/mod.rs`, `tests/agreement.rs`.
- Modify: `Cargo.toml:4-15` (members), `crates/redextape-native/src/rt_imports.rs:16`, `:22`, `:60`, `:69` and `src/lib.rs:72-80`
  (`RtFn`, `RtFn::ALL`, `word_params`, `returns_word` become `pub`, re-exported under `clif`), `src/codegen_snapshots.rs`,
  `scripts/check-all.sh:189` (`"base|wasm|-p redextape-clif --lib"` after native-rt's wasm row), `scripts/comment-budget.json`.

**Manifest:** `publish = false`, `[lints] workspace = true`. Dependencies: `redextape-core` (path, `features = ["serde"]`),
`redextape-native` (path, `default-features = false, features = ["clif"]`), `redextape-native-rt` (path),
`cranelift-codegen = { version = "0.137.2", default-features = false }`, `cranelift-interpreter = "0.137.2"`.
Dev-dependencies: `redextape-native` (path, default features, for `jit`), `redextape-test-support` (path), `proptest = "1"`.

**Interfaces:** produces, in `redextape_clif`:

```rust
pub enum ClifEnd { Ran(RxmOutcome), Fault { pc: Option<u32>, why: String }, Capped(RxmCap), Trap(String), Broken(String) }
pub struct Stepper<'f> { /* InterpreterState<'f>, a pc stack, Runtime<VecTags<WordTag>>, steps, end */ }
impl<'f> Stepper<'f> {
    pub fn new(funcs: &'f [Function], caps: Caps) -> Stepper<'f>; // funcs[0] is main, u0:11
    pub fn step(&mut self) -> bool;           // true when an instruction completed
    pub fn run(&mut self, budget: u64) -> u64; // steps completed, at most budget; stops at an end
    pub fn status(&self) -> Option<&ClifEnd>; // None while it can step
    pub fn steps_taken(&self) -> u64;
    pub fn runtime(&self) -> &Runtime<VecTags<WordTag>>;
}
```

**Rules the step loop keeps** (the probe's `run` is the reference; these are where it is silent):
- Main's entry parameter (the runtime pointer) is `DataValue::I64(0)`. A `call` whose callee's `UserExternalName::index` is
  below `RtFn::ALL.len()` is answered by `Runtime` through `RtFn::ALL.get(index)`, matched with no wildcard, on the call's
  arguments after the first; `IsEmpty` is `redextape_core::heap::is_empty`. Anything else goes to `step`, with
  `Interpreter::block`'s bookkeeping: results, block parameters, frame push and pop.
- A step is one instruction completed, runtime calls and main's `return` included.
- A runtime call that sets `hit_cap` does not complete: no result is written, the pc stays on it, it is not counted, and
  the end is `Capped(Steps)` for `Tick`, `Capped(Stack)` for `Enter`, `Capped(Heap)` for `Cons` or `Box`.
- The first runtime call after which `fault` is set records its srcloc (`None` for the default one), and the run goes on,
  as the compiled code does, until main returns: `Fault { pc, why }`. Otherwise main's return is
  `Ran(RxmOutcome { result, heap: cells.to_vec() })`.
- `ControlFlow::Trap(t)` ends with `Trap(t.to_string())`; a `StepError`, `ReturnCall`, or a word that is not
  `DataValue::I64` ends with `Broken(<text>)`. Nothing panics. After an end, `step` returns `false` and changes nothing.

- [ ] **Step 1: Failing tests.**
  - `tests/common/mod.rs`: `pub fn corpus() -> Vec<(String, Program)>` reads each `../redextape-native/snapshots/*.clif`
    (sorted) header: `;; <key>`, `;; source:`, then `;;   <line>` until `;; ==== `; an `rxm-` key parses with `parse_rxm`,
    the rest with `parse`, `desugar`, `lower_program` (the probe's `corpus` and `program_of`). Also `pub const TIGHT: Caps =
    Caps { steps: 40, stack: 6, heap: 4, mem: DEFAULT_CAPS.mem }` and `pub fn agrees(end: &ClifEnd, jit: &NativeRun) -> bool`:
    `Ran` equals `Ran`, `Fault`'s `why` equals `Fault`'s text, `Capped` of `Steps`, `Stack` or `Heap` equals `HitCap`.
  - `agreement.rs`, each over both listings against `jit::compile_and_run(&prog, caps, OptLevel::O0)`:
    - `the_corpus_is_the_snapshot_corpus`: 72 programs, and each one's `build_listing(.., AsBuilt)`, joined as
      `push_section` joins, equals its file's `built` section (a misread header cannot pass).
    - `the_stepper_ends_where_the_jit_does_at_tight_caps`: all 72 agree; the JIT's outcomes count 56 `Ran`, 2 `Fault`,
      14 `HitCap`; the stepper's `Capped` keys, per listing, are the 6 Heap, 7 Stack and 1 Steps names of Verified facts.
    - `the_stepper_ends_where_the_jit_does_at_default_caps`: the 67 programs whose key does not start `measure-` agree;
      65 `Ran`, 2 `Fault`.
    - `#[ignore]` `the_measure_programs_end_where_the_jit_does_at_default_caps`: the five `measure-` programs agree
      (Task 7 adds the frame-memory list).
    - proptest, 64 cases, `the_stepper_ends_where_the_jit_does_on_random_programs`: `arb_expr_below(1000)` at default caps,
      inputs filtered as `native_agrees_with_reference_and_rxm_on_random_programs` filters them.
    - `a_trap_ends_the_run_with_its_name`: a one-block `(i64) -> i64` function holding `trap int_ovf` (built with
      `FuncCursor` and `InstBuilder::trap(TrapCode::INTEGER_OVERFLOW)`) ends `Trap("user code: int_ovf")` after 0 steps.
    - `steps_count_every_instruction`: `example-sum-to` ends after 183 (built) and 134 (optimised) steps,
      `example-fact` after 189 and 131, and `measure-loop1000000` at `TIGHT` ends `Capped(Steps)` after 1,205 and 985.
  - `codegen_snapshots.rs`, `the_jit_depth_cap_is_the_stack_cap_on_every_corpus_program`: for every corpus program,
    `native_depth_cap(&prog, &partition(&prog).unwrap(), caps) == caps.stack` at `DEFAULT_CAPS` and at the tight caps.
    It is what makes the comparison exact without a `Runtime::new(caps)` JIT.
- [ ] **Step 2: Run.** Expected: FAIL to compile.
- [ ] **Step 3: Implement** the Interfaces and Rules. Add the crate to the workspace members, the check-all row, and its
  comment budget with the share the hook prints.
- [ ] **Step 4: Run** `cargo nextest run -p redextape-clif --no-fail-fast`, then
  `cargo nextest run --release -p redextape-clif --run-ignored only` under the Memory cap, and the depth test. Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Change | Must fail |
|---|---|
| swap the `Head` and `Tail` arms | both agreement tests (probe: 21 programs disagree) |
| answer `Enter` with `tick()` | the tight-caps test (the Stack names) |
| count a tripping call as a step | `steps_count_every_instruction` (1,206) |
| set no block parameters on `ContinueAt` | both agreement tests |
| `BYTES_PER_VAR` in `shared.rs` set to 100,000 | `the_jit_depth_cap_is_the_stack_cap_on_every_corpus_program` |

- [ ] **Gate:** P, D, C, L, W (with the new row).
- [ ] **Commit:** `redextape-clif steps CLIF one instruction at a time under native-rt's runtime and ends where the JIT ends`.

### Task 6: The frame a view reads: values, tags, call stack, heap

Spec §4 (values, call stack, heap panels), §5.4 (tags). Brief: tags from runtime calls only; constants and arithmetic
are plain numbers; `nil` reads 0.

**Files:**
- Create: `crates/redextape-clif/src/state.rs`, `tests/state.rs`.
- Modify: `src/stepper.rs` (a tag per value), `crates/redextape-clif/Cargo.toml` (`serde = { version = "1", features =
  ["derive"] }`), `crates/redextape-core/src/viewmodel.rs:797-818` (the cells and boxes of `RxmState::window` move into
  two public functions).

**Interfaces:**
- `redextape_core::viewmodel`: `pub fn heap_cells(cells: &[(u64, u64)], tags: &[(WordTag, WordTag)], newest: usize,
  named: impl IntoIterator<Item = u64>) -> Vec<RxmCell>` and `pub fn heap_boxes(boxes: &[u64], tags: &[WordTag], newest:
  usize, named: impl IntoIterator<Item = u64>) -> Vec<RxmBox>`: the `newest` entries plus every one `named`, newest first.
  `RxmState::window` calls them; its tests do not change.
- `redextape_clif`, all `#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]` unless noted:

```rust
#[derive(Clone, Copy, ..)] pub struct ClifAt { pub function: u32, pub inst: u32 } // funcs index, Inst index
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct ClifWindow { pub values: usize, pub frames: usize, pub cells: usize, pub boxes: usize }
pub struct ClifValue { pub value: u32, pub word: RxmWord, pub regs: Vec<String> }
pub struct ClifState {
    pub step: u64, pub at: ClifAt, pub next: Option<ClifAt>, pub pc: Option<u32>,
    pub values: Vec<ClifValue>, pub values_len: usize,
    pub depth: usize, pub frames: Vec<ClifAt>, // top first: each frame's current instruction or pending call
    pub heap_len: usize, pub cells: Vec<RxmCell>, pub box_len: usize, pub boxes: Vec<RxmBox>,
}
impl Stepper<'_> { pub fn state(&self, window: ClifWindow) -> ClifState; pub fn at(&self) -> ClifAt; }
```

  `at` is the instruction about to run, or the one that ended the run (main's `return`, kept with main's frame), and
  `next` is `Some(at)` while the run can go on (paused at a cap included) and `None` once it has ended, as
  `RxmState::next`. `values` are the current frame's set slots in value order, the first `window.values`; `regs` are that
  value's `values_labels` starts, decoded by `label_reg` and `reg_str`, in first-seen order without repeats.
- **The tag rule, written once in `stepper.rs`:** each frame keeps a `Vec<Option<WordTag>>` beside its slots, `None` for a
  value not yet set (the state reads only `Some` slots, never `Frame::get` on an unset one). `step`'s `Assign` results
  are `Value`. A block parameter takes the tag of the branch's argument to that block (its `BlockCall`'s values); a
  callee's parameters take the call's argument tags; a call's results take the returned values' tags. `Cons` returns
  `List` and stores its two arguments' tags; `Box` returns `Box` and stores its argument's; `BoxSet` stores its value's;
  `Head`, `Tail` and `BoxGet` return the tag `Runtime::heap()` holds for the word read, or `Value` when the call stopped
  the run; `IsEmpty`, `Tick`, `Enter` and `Faulted` return `Value`.

- [ ] **Step 1: Failing tests** in `tests/state.rs` (window `{ values: 64, frames: 8, cells: 16, boxes: 16 }` unless said):
  - `tags_follow_the_runtime_calls`: `head(cons(cons(7, nil), nil))`, both listings, run to the end: `cells ==
    [cell 2: head (1, List), tail (0, Value); cell 1: head (7, Value), tail (0, Value)]` (`RxmCell`s, newest first) and
    some value reads `RxmWord::of(1, WordTag::List)` (the `rt_head` result).
  - `tags_cross_block_parameters`, as built: `let xs = if 1 == 1 { cons(7, nil) } else { nil }; head(cons(xs, nil))`:
    cell 2's head reads `(1, List)`.
  - `frames_read_top_first`: `fact.rxt` as built, stepped until `depth == 3`: `frames.len() == 3`, `frames[0] == at`,
    `frames[1].function == 1`, `frames[2].function == 0`.
  - `values_carry_their_registers`: `fact.rxt` as built, at the first step with `at.function == 1`: some value has
    `regs` containing `"a0"` and word `"4"`; at step 0, `values` is main's one parameter, `next == Some(at)`.
  - `the_state_reads_only_set_values_at_every_step`: every program not keyed `measure-`, both listings, at `TIGHT`: the
    state after every step builds; `values` ascend by `value` and hold at most `window.values`; `frames.len() ==
    depth.min(window.frames)`; at the end `next == None` (or `Some(at)` when the end is `Capped`).
- [ ] **Step 2: Run.** Expected: FAIL to compile.
- [ ] **Step 3: Implement.** Then run core's tests with `--features serde` and `--features ts` (the `RxmState` tests prove
  the move) and `tests/state.rs`. Expected: PASS, and `git diff` shows no test of `viewmodel.rs` changed.
- [ ] **Step 4: Sabotage.**

| Change | Must fail |
|---|---|
| `Head`'s result tagged `Value` | `tags_follow_the_runtime_calls` |
| `Cons` stores `List` for both words | `tags_follow_the_runtime_calls` (cell 1) |
| block parameters tagged `Value` | `tags_cross_block_parameters` |
| `frames` bottom first | `frames_read_top_first` |
| the state reads every slot with `Frame::get` | `the_state_reads_only_set_values_at_every_step` (panics) |

- [ ] **Gate:** P, S, W.
- [ ] **Commit:** `The CLIF stepper's frame shows its values with their registers and tags, the call stack and the heap`.

### Task 7: Frame memory, and a cap that pauses and continues

Spec §5.4 (pause at the tripping call), §5.5 (frame memory), §8 (`[continue]`). Brief: frame bytes against `caps.mem` (Q1).

**Files:** Modify `crates/redextape-clif/src/stepper.rs`, `tests/agreement.rs`. Create `tests/caps.rs`.

**Interfaces:**
- `pub const FRAME_BYTES_PER_VALUE: usize = size_of::<Option<DataValue>>() + size_of::<Option<WordTag>>();`
- Before a subroutine call pushes a frame: when the bytes of the frames calls have pushed (main's is not counted) plus
  `callee.dfg.num_values() * FRAME_BYTES_PER_VALUE` exceed `caps.mem`, the call does not complete and the end is
  `Capped(RxmCap::Mem)`.
- `pub fn raise_caps(&mut self, caps: Caps)`: installs `caps`; at a `Steps`, `Stack` or `Heap` pause it calls
  `Runtime::raise_cap(caps, tripped)` with the paused call's `Tripped`, at a `Mem` pause only the caps; clears the end,
  so the paused call runs again on the next `step`. At any other end it changes nothing but the caps.

- [ ] **Step 1: Failing tests** in `tests/caps.rs`, with `DOUBLE = Caps { steps: 80, stack: 12, heap: 8, mem: DEFAULT_CAPS.mem }`:
  - `frame_bytes_per_value_is_measured`: `FRAME_BYTES_PER_VALUE == 33`.
  - `the_frame_memory_cap_stops_a_call_before_it_pushes`: `fact.rxt` as built under `Caps { mem: 6930, ..DEFAULT_CAPS }`
    ends `Ran` (result 24) after 189 steps; under `mem: 6929` it ends `Capped(Mem)` with `state(..).depth == 5` and
    `step() == false`. Optimised: 7260 runs, 7259 stops. (Five `fact` frames of 42 and 44 values at 33 bytes.)
  - `a_pause_stands_at_the_call_that_tripped`: `measure-loop1000000` at `TIGHT`: `at()` is a `call` whose callee's user
    name index is `RtFn::Tick as u32` (7), both listings.
  - `continuing_from_a_pause_reaches_where_a_fresh_run_does`: for the 14 programs `TIGHT` caps stop, both listings: run to the
    pause, `raise_caps(DOUBLE)`, run on; a fresh stepper at `DOUBLE` run to its end; `(status, steps_taken)` equal. And
    `fact.rxt` as built paused at `mem: 6929`, raised to `6930`: `Ran` after 189 steps, as fresh.
  - `#[ignore]` `continuing_from_tight_caps_reaches_the_jits_default_end`: the same 14, raised to `DEFAULT_CAPS`, agree
    with the JIT at `DEFAULT_CAPS`, except the frame-memory list.
  - In `agreement.rs`, the slow test gains `const FRAME_MEMORY_LIST: [&str; 1] = ["measure-box30000"]`: those programs
    end `Capped(Mem)` in both listings; the other four `measure-` programs agree with the JIT.
- [ ] **Step 2: Run.** Expected: FAIL (no `raise_caps`, no `Mem` end).
- [ ] **Step 3: Implement.** Then the fast tests, and both `#[ignore]` tests in release under the Memory cap. Expected: PASS.
- [ ] **Step 4: Sabotage.**

| Change | Must fail |
|---|---|
| `raise_caps` passes `Tripped::Alloc` for a `Tick` pause | `continuing_from_a_pause…` (`measure-loop1000000`) |
| `raise_caps` passes `Tripped::Alloc` for an `Enter` pause | `continuing_from_a_pause…` (the Stack names) |
| `raise_caps` leaves the end set | `continuing_from_a_pause…` |
| main's frame counted | `the_frame_memory_cap_stops…` (6930 stops) |
| `>=` for `>` | `the_frame_memory_cap_stops…` (6930 stops) |
| `FRAME_BYTES_PER_VALUE` is the slot alone | `frame_bytes_per_value_is_measured`, `the_frame_memory_cap_stops…` |
| `FRAME_MEMORY_LIST` empty | the slow test, in release (`measure-box30000`) |

- [ ] **Gate:** P, W.
- [ ] **Commit:** `A CLIF run pauses at the runtime call a cap refused, continues under a raised cap, and bounds its frames by caps.mem`.

### Task 8: Listing rows from Cranelift's writer

Spec §4 (listing), §5.5 (rows), §8 "Listing text". Brief: a `FuncWriter` delegating to `PlainWriter`; the srcloc moves to a
decimal pc column.

**Files:** Create `crates/redextape-clif/src/listing.rs`, `tests/listing.rs`.

**Interfaces:**

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub enum ClifRowKind { Function, Decl, Blank, Block, Inst, Alias, Close }
pub struct ClifRow { pub kind: ClifRowKind, pub indent: u8, pub pc: Option<u32>, pub at: Option<ClifAt>, pub text: String }
pub struct ClifFunction { pub name: String, pub label: String, pub first_row: usize } // "u0:12", "fact.0"
pub struct ClifListing { pub functions: Vec<ClifFunction>, pub rows: Vec<ClifRow> }
pub fn listing(funcs: &[Function], names: &[String]) -> ClifListing; // names: partition's, in order
```

  `text` is the printed line without its leading columns and newline; `indent` counts those columns, a srcloc's counted as
  spaces; `pc` is an `Inst` row's non-default srcloc; `at` is set on `Inst` rows alone. Rows follow `funcs`' order with no
  row between functions. A `FuncWriter` whose `write_instruction` and `write_block_header` delegate to `PlainWriter` writes
  through `decorate_function`; the lines no `FuncWriter` method writes (the function line, blank lines, block-parameter
  aliases, the closing brace) are classified from the decorated text.

- [ ] **Step 1: Failing tests:**
  - `rows_restored_equal_the_display`: every corpus program, both listings, each function: writing each row as `indent`
    spaces, with `@{pc:04x} ` over the first six when `pc` is set, then `text` and `\n`, gives `func.display().to_string()`.
  - `every_instruction_has_one_row`: per function, the `at` of its `Inst` rows are its layout's instructions, in order;
    each row's `pc` is `func.srcloc(inst)`'s bits, or `None` for the default.
  - `sum_to_reads_as_its_snapshot`: `example-sum-to` as built: `functions == [("u0:11", "$main", 0), ("u0:12", "sum_to.0", 63)]`;
    row 0 is `Function` `function u0:11(i64) -> i64 system_v {`; the rows with `pc == Some(20)` are `Inst`
    `v4 = iconst.i64 5` and `Inst` `jump block3`, with `Alias` `v5 -> v4` and `v7 -> v4` (indent 36) between; `block2:` is
    `Block` at indent 32; row 62 is `Close` `}` at indent 0.
- [ ] **Step 2: Run.** Expected: FAIL to compile. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Change | Must fail |
|---|---|
| keep `@xxxx ` in `text` | `rows_restored_equal_the_display` |
| `pc` is the srcloc plus one | `sum_to_reads_as_its_snapshot`, `every_instruction_has_one_row` |
| drop `Alias` rows | `rows_restored_equal_the_display` |
| a block parameter's alias row is an `Inst` | `every_instruction_has_one_row` |

- [ ] **Gate:** P, W.
- [ ] **Commit:** `The CLIF listing's rows come from Cranelift's writer, with each srcloc as a decimal pc`.

### Task 9: The CLIF leg

Spec §5.5 (a leg with `RxmLeg`'s shape). Brief: incremental end-finding by a scout the caller advances; mirror `RxmLeg`'s
`status`, `rewind`, `step`, `state`, `value`, `raise_cap`.

**Files:** Create `crates/redextape-clif/src/leg.rs`, `tests/leg.rs`. Modify `Cargo.toml` (`redextape-wire` path,
`self_cell = "1.3.0"`). The subroutine names come from `redextape_native::analysis::partition`.

**Interfaces:**

```rust
#[derive(Clone, Debug, serde::Deserialize)]
pub struct ClifInput { pub program: Program, pub ty: Ty, pub caps: Caps } // Task 10 serialises the same three fields
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ClifStatus { pub run: RunStatus, pub cap: Option<RxmCap>, pub total_steps: Option<u64> }
pub struct ClifLeg; // owns the functions and listing and, through self_cell!, a cursor and a scout borrowing them
impl ClifLeg {
    pub fn new(input: ClifInput, listing: Listing) -> Result<ClifLeg, LowerError>;
    pub fn listing(&self) -> &ClifListing;
    pub fn find_end(&mut self, budget: u64) -> bool; // true once the scout has ended; drops the scout
    pub fn status(&self) -> ClifStatus;
    pub fn rewind(&mut self);                        // a fresh cursor under input.caps
    pub fn step(&mut self) -> bool;
    pub fn state(&self, window: ClifWindow) -> ClifState;
    pub fn value(&self) -> Decoded;
    pub fn raise_cap(&mut self, extra_steps: u64);   // the cursor's steps cap, saturating; resumes a Steps pause only
}
```

- `status`: `run` is the cursor's (`Running` while it can step, `Ended` for any end but `Capped`, `Capped`); `cap` is set
  exactly when `run` is `Capped`; `total_steps` is `None` until `find_end` has returned `true`, then the scout's steps,
  or for a scout that ended `Capped` the larger of the scout's and the cursor's (`RxmLeg::status`'s rule).
- `value`: from the scout's end, else the cursor's once it has ended, else `Unfinished`; a `Capped` scout end defers to
  the cursor. `Ran` decodes with `decoded_or_undecodable(tm::decode_rxm_ty(&outcome, &ty))`; `Fault` with a pc is
  `redextape_wire::rxm_fault(pc, why)`, without one `Decoded::Fault { message: why }`; `Trap` and `Broken` are
  `Decoded::Fault` with their text.

- [ ] **Step 1: Failing tests** in `tests/leg.rs` (`ty` given by hand; `loop` is `measure::CORPUS`'s `loop1000000` source):
  - `the_end_is_found_in_chunks`: `fact.rxt` (`Ty::Nat`): `find_end(100) == false`, then `true`; `status() == ClifStatus {
    run: Running, cap: None, total_steps: Some(189) }`; optimised `Some(131)`.
  - `stepping_to_the_end_reads_the_value`: 189 `step()` return true, the 190th false; `run == Ended`;
    `value() == Decoded::Value { text: "24" }`; `state(..).step == 189`.
  - `a_fault_names_the_call_that_faulted`: `head(nil)`, both listings: `Decoded::Fault { message: "head of empty list at pc1" }`.
  - `a_word_past_two_to_the_53_decodes`: `18446744073709551615 + 1`: `Value { text: "18446744073709551615" }`.
  - `a_function_value_is_undecodable`: `|x| x + 1` with `Ty::Fun(vec![Ty::Nat], Box::new(Ty::Nat))`: `Undecodable`.
  - `a_raised_step_cap_resumes_and_rewind_restores_the_caps`: `loop` at `TIGHT`, as built: `find_end(10_000)` is `true` with
    `total_steps == Some(1205)`; stepped to its stop: `ClifStatus { run: Capped, cap: Some(Steps), total_steps: Some(1205) }`
    and `value() == Unfinished`; `raise_cap(40)`: `run == Running`; stepped to the next stop, `total_steps` equals the
    cursor's steps, above 1,205; `rewind()`, stepped to the stop again: 1,205 steps.
  - `a_stack_cap_is_final_for_the_leg`: `fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)` under
    `Caps { stack: 3, ..DEFAULT_CAPS }`: stepped to the stop, `cap == Some(Stack)`; after `raise_cap(1000)`, `step() == false`.
- [ ] **Step 2: Run.** Expected: FAIL to compile. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Change | Must fail |
|---|---|
| `rewind` keeps the raised caps | `a_raised_step_cap_resumes…` (second stop past 1,205) |
| a fault's pc taken at the instruction that ends the run | `a_fault_names_the_call_that_faulted` |
| `find_end` ignores `budget` | `the_end_is_found_in_chunks` |
| `raise_cap` resumes a `Stack` pause | `a_stack_cap_is_final_for_the_leg` |
| `total_steps` set before the scout ends | `the_end_is_found_in_chunks` |

- [ ] **Gate:** P, W.
- [ ] **Commit:** `The CLIF leg finds its end in chunks and serves status, steps, frames and the value as the rxm leg does`.

### Task 10: `pkg/` exports the `Program` and its type

Spec §5.6. Brief: serde derive on `Ty`; the end value decoded with the rxm leg's decoder (already shared: `tm::decode_rxm_ty`
in core and `decoded_or_undecodable`, `rxm_fault` in `redextape-wire`, which Task 9 calls; nothing moves).

**Files:** Modify `crates/redextape-core/src/ty.rs:5` and its tests, `crates/redextape-wasm/src/session.rs` (beside
`rxm_value`, :1092; tests in its `mod tests`), `crates/redextape-wasm/src/lib.rs` (beside `rxmValue`, :703).

**Interfaces:**
- `#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]` on `Ty`.
- `session.rs`: `#[derive(serde::Serialize)] pub struct ClifInputRef<'a> { pub program: &'a Program, pub ty: &'a Ty, pub caps:
  tm::rxm::Caps }` and `pub fn clif_input(&self) -> Option<ClifInputRef<'_>>`: `None` when the rxm leg is absent; otherwise
  the leg's `source` (the program its cursor runs), the session's `ty` and the leg's `caps`. The field names are
  `ClifInput`'s (Task 9); Task 11's node test is the contract between the two.
- `lib.rs`: `#[wasm_bindgen(js_name = clifInput)] pub fn clif_input(&self) -> Result<JsValue, JsValue>`, `null` for `None`,
  otherwise serialised by `serde_wasm_bindgen::Serializer::new().serialize_large_number_types_as_bigints(true)` (Review
  Focus 1), not `redextape_wire::to_value`, whose serializer refuses a `u64` past 2^53.

- [ ] **Step 1: Failing tests.**
  - core (runs under `--features serde`): `a_type_round_trips_through_serde`: `serde_json` round trip of
    `Ty::Fun(vec![Ty::List(Box::new(Ty::Nat)), Ty::Bool], Box::new(Ty::Var(3)))` and of `Ty::Unit`.
  - `session.rs`: `the_clif_input_is_the_program_the_rxm_leg_runs`: `fact.rxt` gives `Some` with `*program` equal to the rxm
    leg's `source`, `*ty == Ty::Nat` and caps fields equal to `DEFAULT_CAPS`'s; `[1, 2, 3]` gives `ty == List(Nat)`;
    `compile_with_caps` with `rxm_caps = Caps { steps: 77, ..DEFAULT_CAPS }` gives `caps.steps == 77`; the 2,048-element list
    of `a_program_that_does_not_lower_declines_the_rxm_leg_and_refuses_its_methods` gives `None`.
- [ ] **Step 2: Run.** Expected: FAIL to compile. **Step 3: Implement.** **Step 4: Run** core with `--features serde` and
  `--features ts`, `cargo nextest run -p redextape-wasm --no-fail-fast`, and `pnpm run build:wasm`. Expected: PASS.
- [ ] **Step 5: Sabotage.**

| Change | Must fail |
|---|---|
| `clif_input` answers `ty: &Ty::Nat` | `the_clif_input_is…` (the list case) |
| `clif_input` answers `DEFAULT_CAPS` | `the_clif_input_is…` (77) |
| `Ty::Var` given `#[serde(skip)]` | `a_type_round_trips_through_serde` |

- [ ] **Gate:** P, S, X, W.
- [ ] **Commit:** `A compiled session exports its rxm program and type for the CLIF package`.

### Task 11: `redextape-clif-wasm` and `pkg-clif/`, wired in

Spec §5.5 (the package), §6 "Build wiring" and licences, §7.1. Brief: built to `pkg-clif/` as `redextape-lsp-wasm` is to
`pkg-lsp/`; a node-tier test through the real `pkg/` export and `pkg-clif/`.

**Files:**
- Create: `crates/redextape-clif-wasm/{Cargo.toml,src/lib.rs}`, `web/tests/node/clif-package.test.ts`.
- Modify, each where `pkg-lsp` or `redextape-lsp-wasm` already is (`git grep -n 'pkg-lsp\|lsp-wasm'` lists them): `Cargo.toml`
  members; `.gitignore:11` (`/pkg-clif/`); `web/package.json:9,12` (`build:clif-wasm`, `wasm-pack build ../crates/redextape-clif-wasm
  --release --target web --out-dir ../../pkg-clif`, and in `build` after `build:lsp-wasm`); `Dockerfile:28,41` (build and
  copy `/app/pkg-clif`); `.forgejo/workflows/ci.yml:931-932` (a step after it, before typecheck, which now resolves
  `../../../pkg-clif`); `scripts/check-all.sh:181` (`"base|wasm|-p redextape-clif-wasm --lib"`); `scripts/comment-budget.json`;
  `.pre-commit-config.yaml:5-6` and `docs/development.md:23,35-40` (the fresh-clone line gains `pnpm run build:clif-wasm`);
  `docs/architecture.md:35` ("Ten crates" becomes twelve, with a paragraph for each new crate beside `redextape-lsp-wasm`'s
  at :97); `web/scripts/licences.ts:44` (`WASM_CRATES`) and its docs' counts of builds (`rg -n 'two .\.wasm|both .\.wasm|both builds'
  web/scripts/licences.ts web/tests/node/licences-scan.test.ts`); `web/tests/node/licences-scan.test.ts:102` (`builds` gains
  `pkg-clif/redextape_clif_wasm_bg.wasm`); `web/src/third-party-licences.json` (regenerated by `node scripts/licences.ts`,
  never edited).

**Manifest:** as `redextape-lsp-wasm`'s: `crate-type = ["cdylib", "rlib"]`, `[lints] workspace = true`; dependencies
`redextape-clif`, `redextape-native` (`default-features = false, features = ["clif"]`, for `Listing`), `redextape-wire`,
`wasm-bindgen = "0.2.130"`, `serde-wasm-bindgen = "0.6.5"`, `console_error_panic_hook = "0.1.7"`.

**Interfaces** (marshalling only; `redextape-wasm`'s `lib.rs` is the pattern):

```rust
#[wasm_bindgen] pub struct ClifSession(ClifLeg);
#[wasm_bindgen] impl ClifSession {
    #[wasm_bindgen(constructor)] pub fn new(input: JsValue, listing: &str) -> Result<ClifSession, JsValue>;
    pub fn listing(&self) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = findEnd)] pub fn find_end(&mut self, budget: u32) -> bool;
    pub fn status(&self) -> Result<JsValue, JsValue>;
    pub fn rewind(&mut self);
    pub fn step(&mut self) -> bool;
    pub fn state(&self, window: JsValue) -> Result<JsValue, JsValue>; // a ClifWindow, read with from_value
    pub fn value(&self) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = raiseCap)] pub fn raise_cap(&mut self, extra_steps: u32);
}
```

  `new` throws `unknown listing "<name>"` for a name `Listing::parse` refuses, and `ClifSession: not a clifInput(): <error>`
  when `input` does not deserialise. Answers go through `redextape_wire::to_value`.

- [ ] **Step 1: The failing node test** `web/tests/node/clif-package.test.ts`. Load both modules with `initSync({ module:
  readFileSync(<repo>/pkg/redextape_wasm_bg.wasm) })` and the `pkg-clif` equivalent. For each case, `compile(src, 'unary')`,
  `new ClifSession(session.clifInput(), listing)`, `findEnd(1_000_000)` until true, then:
  - `web/src/examples/fact.rxt`: `status().total_steps` 189 as built and 131 optimised; `value()` equal to
    `session.rxmValue()`, which is `{ Value: { text: '24' } }`.
  - `head(nil)`: `value()` equal to `session.rxmValue()`, `{ Fault: { message: 'head of empty list at pc1' } }`.
  - `18446744073709551615 + 1` (Review Focus 1): `value()` equal to `session.rxmValue()`, the text `'18446744073709551615'`.
  - `new ClifSession(input, 'sideways')` throws `unknown listing "sideways"`; the 2,048-element list's `clifInput()` is `null`.
- [ ] **Step 2: Run** `pnpm exec vitest run --project node tests/node/clif-package.test.ts`. Expected: FAIL (no `pkg-clif/`).
- [ ] **Step 3: Implement** the crate and every wiring site above, then `pnpm run build:wasm && pnpm run build:clif-wasm` and
  `node scripts/licences.ts`.
- [ ] **Step 4: Run** the node test, the whole node tier (`pnpm exec vitest run --project node`),
  `pnpm exec biome ci --error-on-warnings`, `pnpm run typecheck`, `../scripts/check-licences.sh --self-test` and
  `../scripts/check-licences.sh` (from `web/`), and `scripts/check-all.sh --list | rg clif` (two rows). Expected: all exit 0.
- [ ] **Step 5: Sabotage.**

| Change | Must fail |
|---|---|
| `clifInput` serialises with `redextape_wire::to_value` | the `18446744073709551615 + 1` case |
| `ClifSession::new` ignores `listing` | the fact case (131) |
| `ClifInput`'s field `ty` renamed `type` in `redextape-clif` | every case (the contract) |

- [ ] **Gate:** P, W (with `-p redextape-clif-wasm --lib`), and Step 4's web commands.
- [ ] **Commit:** `pkg-clif/ packages the CLIF leg for the browser, built and licensed beside pkg-lsp/`.

### Task 12: Measurements (no commit)

Spec §5.5 "Speed", §7.1, §8 "Size". Brief: wasm steps/s, `pkg-clif`'s gzipped size after wasm-opt, `pkg/`'s growth;
contributors named if `pkg-clif` is far over the spike's ~150 KB. Everything goes in `$R/measurements.md` with its command.

- [ ] **Step 1: `pkg-clif`.** `pnpm run build:clif-wasm`, then `stat -c %s $W/pkg-clif/redextape_clif_wasm_bg.wasm` and
  `gzip -9 -c $W/pkg-clif/redextape_clif_wasm_bg.wasm | wc -c`.
- [ ] **Step 2: `pkg/`'s growth.** In the base worktree (its own target dir), `cd web && pnpm install --frozen-lockfile &&
  pnpm run build:wasm`; the same two sizes for both `pkg/redextape_wasm_bg.wasm`. The growth is §5.6's export alone.
- [ ] **Step 3: No Cranelift in `pkg/`.** `cargo tree -p redextape-wasm --target wasm32-unknown-unknown -e normal --prefix none |
  rg '^cranelift' | wc -l`. Expected: 0.
- [ ] **Step 4: Speed.** A scratch script `$R/clif-speed.mjs` (not in the tree) loads both packages as the node test does,
  compiles `measure::CORPUS`'s `loop1000000`, `sum30000` and `map30000` sources, and times `findEnd(1_000_000)` to the end,
  three runs per listing; steps/s is `total_steps` over seconds, median of three. Natively, the same three through
  `Stepper::run` in a scratch cargo project `$R/clif-speed/` (path dependencies on `$W/crates`, `Cargo.lock` copied from
  `$W`, its own `CARGO_TARGET_DIR=/home/davey/.cache/redextape-clif-speed-target`, `--release`). Run both on a quiet machine.
- [ ] **Step 5: Contributors**, if Step 1's gzip is over 300 KB: `twiggy top -n 20` and `twiggy dominators -d 2` on the
  `pkg-clif` wasm, into `$R/twiggy.txt`; name the top five by retained size.

### Task 13: Comment budget, the full gate, the roadmap entry

**Files:** `scripts/comment-budget.json`; `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (appended).

- [ ] **Step 1: Budget.** `node scripts/check-comments.mjs --base 2cf0de1`; write each value it asks for. Commit
  `The comment budget records the CLIF crates` if anything changed; this is the last code commit.
- [ ] **Step 2: The gate**, each command from `$W` under the Memory cap with `--setenv` for `PATH` (with
  `/home/davey/.local/share/cargo/bin`), `HOME`, `CARGO_HOME`, `RUSTUP_HOME`, the `XDG_*` directories, `PNPM_HOME` and
  `CARGO_TARGET_DIR`, each log in `$R/gate/` ending in its exit status. `rustup check` first (a new stable reddens clippy
  on unchanged code):
  1. tree-sitter 0.25.10 in `.tools/` as `scripts/setup-dev.sh` installs it; `LLVM_SYS_231_PREFIX=/usr scripts/check-all.sh`:
     exit 0 and "all configs green — base, LLVM and browser".
  2. `cargo llvm-cov nextest --workspace --fail-under-lines 90`.
  3. `scripts/check-slow.sh` (it runs Tasks 5 and 7's `#[ignore]` tests in release).
  4. Each of `check-text-bytes`, `check-citations`, `check-attributions`, `check-doc-figures`, `check-shared-docs`,
     `check-colours`, `check-grammar-wasm`, `check-lua` (`scripts/check-*.sh`) with `--self-test`, then alone;
     `node scripts/check-comments.mjs --self-test`, then `--base 2cf0de1`.
  5. From `web/`: `../scripts/check-licences.sh --self-test`, then alone.
  6. CI's `web` job, from `web/`: `pnpm run build:wasm`, `build:lsp-wasm`, `build:clif-wasm`, `build:bindings`,
     `pnpm exec biome ci --error-on-warnings`, `pnpm run typecheck`, `pnpm run test:coverage` (at or above
     `web/vite.config.ts`'s floors), `pnpm run build:app`.
  7. The image, which no PR job builds: `docker build -t redextape-clif-view $W`, run it on port 8099, `curl` gives 200 and
     the health check `healthy`; `docker build --target wasm -t redextape-clif-view-wasm $W` then
     `docker run --rm redextape-clif-view-wasm ls /app/pkg-clif` lists `redextape_clif_wasm_bg.wasm`.

  Expected: every one exits 0. A failure stops the task and goes back to the controller.
- [ ] **Step 3: The entry**, headed as the entries above it are, titled *CLIF view PR 1: the package, no UI*, with the
  date, branch `clif-view`, the range `2cf0de1..<Step 1's SHA>`, the commit count and *plus this entry*. Sections: what Tasks 1-11 changed; the departures
  from the brief and Q1's answer; Task 12's figures (wasm and native steps/s per program and listing, `pkg-clif` raw and
  gzip, `pkg/`'s growth, the `cargo tree` count, contributors if named) and the frame-memory list;
  `##### WHAT THIS DID NOT CLOSE`: all of §6 (PR 2), TypeScript bindings for the CLIF types, whether the leg reports its
  end at compile or when reached (now decidable from the speed), the `unused dependency` manifest warning under D (it
  predates this branch); `##### VERIFICATION`: Step 2's results, ending with **Every count this entry quotes, with what
  produces it** (value, what it counts, command). Run every command before committing; correct the entry to what they print.
- [ ] **Step 4: Commit** `The roadmap records the CLIF view's package`, the diff touching this file alone.

## Spec coverage

| Design | Tasks |
|---|---|
| §5.1 0.137.2, snapshot gate, baseline, interpreter API confirmed | 1 (API: Verified facts) |
| §5.2 value labels, one encoding beside `reg_str`, module paths unlabelled | 2 |
| §5.3 optimise without an ISA, equality over the corpus | 3 |
| §5.4 generic `Runtime`, heap accessor, tags rule, pause and continue, `rt_*` bodies identical | 4, 6, 7 |
| §5.5 stepper, traps, frame memory, listing rows, the leg, speed | 5, 7, 8, 9, 12 |
| §5.6 `Program` and type export, shared decoder, `pkg/` growth measured | 10, 9, 12 |
| §6 build wiring and licences | 11 |
| §7.1 tests in Rust native and wasm32, roadmap entry with speed and size | 5-11 (W legs), 12, 13 |
| §8 generated code, optimised listing, native rules, listing text, runtime, size | 1-4, 3, 5 and 7, 8, 4, 12 |
| §8 no fetch without intent, recording, links, hot paths; §6 apart from build wiring | PR 2 |
