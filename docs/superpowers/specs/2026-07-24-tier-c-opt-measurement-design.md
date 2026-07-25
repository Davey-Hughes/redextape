# Optimizer Tier C — Cranelift opt levels, measurement, and regression gates

**Status:** design approved, ready for an implementation plan.
**Date:** 2026-07-24.
**Predecessors:** [native backend v1 (Cranelift)](2026-07-23-native-backend-design.md),
[Phase 3 AOT](2026-07-23-native-aot-phase3-design.md), [Phase 2 LLVM](2026-07-24-native-llvm-phase2-design.md).

## Why this slice exists

The roadmap defines Tier C as *"GVN, LICM, loop unrolling, vectorization, native regalloc — the
LLVM/Cranelift internal passes, free once native IR is emitted."* Phase 2 delivered exactly that **for
LLVM** (`default<O1..O3>` plus the size levels `Os`/`Oz`, oracle-validated at every level). Two gaps remain,
and this slice closes both.

**Gap 1 — Cranelift never got its opt levels.** `jit.rs` builds `JITBuilder::new(default_libcall_names())`
and `aot.rs` sets only `is_pic`; neither touches `opt_level`, so both run at Cranelift's default of `none`.
`Codegen::Cranelift` ignores the `OptLevel` it is handed. Consequently **every existing native oracle leg —
the four-way `reference == λ == TM == native`, the AOT end-to-end binary test, and `native == asm-interp` —
currently validates unoptimized codegen only.**

**Gap 2 — nothing measures anything.** The roadmap justifies the tier with *"native shows wall-clock,"* but
there is no benchmark and no size measurement. The one size-related test counts **LLVM IR instructions**, not
machine code. Tier C is therefore unfalsifiable today: we cannot say what `-O3` bought. This contrasts with
Tiers A/B, where the TM's step-count goldens quantify a pass exactly.

Scope was chosen deliberately over the alternative of skipping to Tier A (Core→Core). Tier A has higher
leverage — it helps λ *and* TM *and* native — but Tier C is nearly free and finishing it honestly gives Tier
A a validated `-O3` reference point to be measured against.

## Non-goals

- **No new optimization passes.** This slice turns on and measures passes the backends already have. Custom
  pass pipelines (as opposed to `default<O_>`) are out.
- **Not AOT-via-LLVM.** An LLVM object emitter is added for *measurement only* — no linking, no `rt_run`, no
  CONFIG blob. It incidentally seeds the roadmap's AOT-via-LLVM follow-on; it does not constitute it.
- **No wall-clock assertions,** in tests or in CI. Timings are reported for humans, never gated.
- **Tier A and Tier B remain untouched.**

---

## 1. Cranelift optimization levels

`Codegen::Cranelift` becomes `Codegen::Cranelift { opt: OptLevel }`, symmetric with the existing
`Llvm { opt: OptLevel }` and reusing the same enum so the oracle can sweep both backends in one loop.

`OptLevel` has six variants; Cranelift's `opt_level` setting has three. The collapse is deliberate and must
be documented at the mapping site:

| `OptLevel` | Cranelift `opt_level` |
|---|---|
| `O0` | `none` |
| `O1`, `O2`, `O3` | `speed` |
| `Os`, `Oz` | `speed_and_size` |

The mapping lives in **one** function, mirroring how `opt_level`/`pass_pipeline` are single-sourced in
`llvm.rs`. It is applied in **both** Cranelift paths:

- `jit.rs` — the `JITBuilder`'s ISA flags.
- `aot.rs` — the existing `settings::builder()` block that currently sets only `is_pic`.

`run_native(core, caps)` becomes `run_native_with(core, caps, Codegen::Cranelift { opt: OptLevel::O3 })`,
matching `OptLevel::default() == O3`. **This is a behavior change:** every existing oracle leg begins
exercising optimized Cranelift codegen. That is the point — it is a large free coverage gain — but it means
a latent Cranelift-optimizer disagreement on our IR would surface as previously-green tests going red.

### Totality consequence (the one real risk)

`shared::native_depth_cap`'s `BYTES_PER_VAR = 32` was calibrated against **unoptimized Cranelift** frames.
Enabling `speed` changes frame layout, exactly as LLVM's opt levels did. The fat-frame deep-recursion
totality test must therefore sweep **Cranelift's** levels as well as LLVM's.

If that test fails at any Cranelift level, it is a genuine totality bug — a potential stack-overflow abort,
violating the cardinal rule — and must be **reported, not tuned away**. Whether it blocks this slice or
becomes its own follow-up is the implementer's escalation, not a decision to make silently by loosening the
assertion.

## 2. Object-size measurement

To compare backends in the same unit, both must emit an object.

- **Cranelift** already can: `emit_object` (from the AOT phase) produces `.o` bytes.
- **LLVM** cannot today. Add `TargetMachine::write_to_memory_buffer(&module, FileType::Object)` using the
  `TargetMachine` that `build_and_run` already constructs — roughly five lines. Measurement-only, per the
  non-goals above.

**Size comparisons are within-backend only.** Comparing a Cranelift `.o` against an LLVM `.o` conflates
codegen quality with object-format and symbol-table overhead. The report must state this inline, because a
reader looking at the table will otherwise compare across backend rows.

**Ruled out as an observable:** `rt_tick` counts. `rt_tick` is an opaque external call, so unrolling
duplicates the calls and the count is unchanged — it is codegen-invariant and therefore useless here.

## 3. The report

A new `crates/redextape-native/examples/opt_report.rs`, sibling to `native_demo`/`aot_demo`/`llvm_demo`,
printing one table over a small curated corpus chosen to span the shapes where optimization behaves
differently:

- a counted loop (unrolling),
- `sum(100)` — self-recursion (inlining declines; the `rt_enter`/`rt_leave` structure dominates),
- a list-building program (heap `rt_*` calls, opaque to the optimizer),
- a defunc'd higher-order program (`map` — dispatch through `$applyN`).

Columns: **program × backend × opt level × compile time × object bytes × run time (median)**.

**Compile time is a first-class column, not an afterthought.** Cranelift's selling point is fast compilation
and LLVM's is better code; measuring both axes is what makes the report a story rather than a list. Run time
is median-of-N with a warmup, labeled indicative. Compile and run time are reported separately — conflating
them would flatter Cranelift on short programs and LLVM on long ones.

## 4. What the test suite asserts

Only properties that survive a toolchain bump:

1. **Agreement:** every `(backend, opt level)` pair still agrees with the reference — the existing oracle,
   extended to sweep Cranelift's levels alongside LLVM's.
2. **Optimization is live:** `O0` and `O3` produce *different* output for at least one backend, so a pass
   silently ceasing to fire is caught.
3. **Totality:** the fat-frame sweep of §1.

No byte counts and no timings appear in assertions.

## 5. The size baseline

A regression gate for §2's numbers, kept out of the test suite's fragile path.

- **Per target triple.** `crates/redextape-native/baselines/<target-triple>.toml`. Object bytes for
  `aarch64-apple-darwin` and `x86_64-unknown-linux-gnu` are entirely different numbers; one file cannot serve
  both. This slice lands the macOS baseline; the Linux one lands with CI (§7).
- Each file records the **Cranelift and LLVM versions** that produced it, so a mismatch is diagnosable rather
  than mysterious.
- **Tolerance band** (±10%) rather than exact bytes, so unrelated changes do not go red while a pass ceasing
  to fire still does.
- **On a triple with no baseline, the check prints a visible notice and skips.** It must never silently pass
  — a missing baseline masquerading as a green gate is worse than no gate.
- Regenerable by one documented command.

## 6. Local gate

The repo already has `.pre-commit-config.yaml`, described in its own header as *"mirroring the CI gates."* It
runs `cargo fmt --all --check` and `cargo clippy --workspace --all-targets -- -D warnings` — **default
features only**, so it covers none of the feature matrix.

- **Pre-commit hooks stay fast: fmt and clippy only.** A five-config sweep with two LLVM JIT compiles per
  oracle case is far too slow for something firing on every commit; burying it there is how `--no-verify`
  becomes habit.
- The matrix moves to **`scripts/check-all.sh`**, run before a merge. **CI invokes the same script**, so the
  local and CI gates cannot drift — a single source of truth for the command set.
- The script must work on macOS and Linux; `LLVM_SYS_221_PREFIX` resolves per-platform with an env override.

Configs covered: `--no-default-features`, default (`cranelift`), `--features llvm`, and
`--no-default-features --features llvm`. Note `--features llvm` ≡ `--features "cranelift llvm"` — `llvm` is
additive to the default `cranelift`, so those are not distinct builds.

## 7. Forgejo CI

`.forgejo/workflows/ci.yml` exists and is a real self-hosted-runner pipeline (checkout, Rust via
`rust-toolchain.toml`, cargo cache, fmt, clippy, `cargo llvm-cov --fail-under-lines 80`). Its header says
*"The project has no code yet"* and it gates on a `detect` job that auto-activates once `Cargo.toml` exists —
which it now does. With no `web/` directory, only `detect` + `rust` run today.

**Operational prerequisite, stated plainly: this pipeline has never run on any native-backend work.** It
triggers on push to `main`; the repo is currently **25 commits ahead of `origin/main`**. The coverage below
is worth nothing until commits are pushed.

Changes:

1. **Extend the existing `rust` job** to run the non-LLVM configs — `--no-default-features` build, clippy and
   tests — via `scripts/check-all.sh`. Keep fmt, clippy, and the coverage gate on default features.
2. **Add a separate `rust-llvm` job** that installs **LLVM 22** (apt.llvm.org's `llvm.sh`), caches
   `/usr/lib/llvm-22` and the cargo/target dirs independently, sets `LLVM_SYS_221_PREFIX`, and runs clippy +
   the full test suite for `--features llvm` and `--no-default-features --features llvm`, including
   `tests/llvm_oracle.rs`.
   - **A separate job, not extra steps in `rust`,** so the fast default-feature signal still arrives when the
     heavyweight toolchain install is cold or upstream-broken.
   - **Not `continue-on-error`.** A job permitted to fail is fake coverage.
   - **Version risk to resolve at implementation time, not by guessing:** inkwell's `llvm22-1` feature
     requires LLVM **22.1.x**. If apt.llvm.org's `llvm-22` package is 22.0.x, `llvm-sys` will reject it and
     the job needs a different install source. De-risk this **first**, before writing the rest of the job —
     the same toolchain-first ordering that worked in Phase 2.
3. **Run `opt_report` as a non-gating step** in `rust-llvm`, so every push leaves a record in the log of what
   optimization bought on a known machine.
4. **Generate the Linux size baseline** from the first successful `rust-llvm` run and commit it by hand. CI
   does not commit to the repo.
5. Add `rust-llvm` to the `docker` job's `needs`. That job is currently skipped (it requires `has_web`), but
   the dependency should be correct for when a `web/` directory lands.

**Known limitation, recorded deliberately:** coverage (`cargo llvm-cov --fail-under-lines 80`) stays on
default features, so `llvm.rs` — feature-gated out of that build — is never coverage-measured. Adding
`--features llvm` to the coverage run would inject ~1900 lines at once and destabilize the gate. Revisit
separately.

## Follow-on (recorded, NOT in this slice): broadening LLVM version support

Today the crate pins exactly one LLVM: inkwell's `llvm22-1` feature → `llvm-sys-221` → LLVM 22.1.x, located
via `LLVM_SYS_221_PREFIX`. A contributor or CI runner with LLVM 21 cannot build the `llvm` feature at all.
This is also the single riskiest item in §7 (apt.llvm.org may ship 22.0.x rather than 22.1.x).

**Why this is cheaper than it feels.** The crate's LLVM surface is a narrow, stable subset:
`build_int_{add,sub,mul}`, `build_int_compare`, `zext`, three intrinsics (`llvm.uadd.sat`, `llvm.usub.sat`,
`llvm.umul.with.overflow`), `run_passes` with `default<O_>` pipeline strings, MCJIT, function attributes, and
`TargetMachine`. Intrinsic names and pipeline strings have been stable for years. **The cost is build
plumbing and test matrix, not code churn.**

**What it takes:**

1. **Feature passthrough** (~15 lines of `Cargo.toml`). inkwell 0.9 exposes one feature per version —
   `llvm15-0` … `llvm21-1`, `llvm22-1` — each forwarding to a distinct `llvm-sys-NNN` crate:
   ```toml
   llvm      = ["llvm22-1"]                        # alias for the newest supported
   llvm22-1  = ["dep:inkwell", "inkwell/llvm22-1"]
   llvm21-1  = ["dep:inkwell", "inkwell/llvm21-1"]
   ```
   Mutual exclusivity is enforced upstream by inkwell's own `compile_error!` (it also errors when none is
   selected), so no local guard is strictly required — though a clearer crate-local message is worth adding.
2. **Derive the env var from the selected feature.** It is version-dependent (`LLVM_SYS_221_PREFIX` vs
   `LLVM_SYS_211_PREFIX`), so `scripts/check-all.sh` and CI must compute it rather than hardcode it.
3. **Extend the matrix** — one CI job per supported version, each with its own LLVM install and cache. Size
   baselines become per-(triple, **LLVM version**); §5 already records toolchain versions, so this extends
   naturally rather than needing a redesign.

**Hard floor: LLVM ≥ 17.** inkwell `compile_error!`s that opaque pointers are unsupported before 15 and that
typed pointers are gone from 17; this codegen is opaque-pointer (`ptr`), so 17 is the realistic bottom.

**Known dead end — do not attempt.** A `build.rs` that probes the host `llvm-config` and selects the matching
feature *cannot work*: Cargo resolves features before build scripts run, and a build script cannot enable a
feature. This is the intuitive approach and it is impossible; recorded here so nobody spends a day on it.

**Strategic alternative — textual IR instead of linking.** Emit LLVM IR as text and invoke whatever
`opt`/`llc` is on `PATH`, rather than linking LLVM at build time. Version breadth becomes nearly free (LLVM
auto-upgrades textual IR), `LLVM_SYS_*` and the build-time dependency disappear, and CI reduces to
`apt install llvm`. It would also yield the roadmap's "show the native code" view for free, and dovetails
with AOT-via-LLVM. Costs: no in-process JIT (needs AOT-and-exec or `dlopen`) and a process spawn per compile
— so realistically a *second* backend path alongside the linked one, not a replacement.

## Risks

| Risk | Mitigation |
|---|---|
| Cranelift `speed` breaks the fat-frame totality guarantee (stack-overflow abort) | Sweep Cranelift levels in the totality test; report rather than loosen. §1 |
| Cranelift `speed` surfaces a codegen disagreement in existing green oracle legs | That is the discovery this tier exists to make; the oracle localizes it |
| apt.llvm.org ships LLVM 22.0.x, not 22.1.x | De-risk as the first CI step; fall back to a prebuilt tarball |
| LLVM install makes CI slow | Separate job + independent cache of `/usr/lib/llvm-22` |
| Size baselines go red on toolchain upgrades | Tolerance band; recorded toolchain versions; documented regenerate command |
| Local and CI gates drift | CI invokes `scripts/check-all.sh` — one source of truth |

## Interfaces produced

- `redextape_native::Codegen::Cranelift { opt: OptLevel }` (was a unit variant).
- `redextape_native::run_native` — unchanged signature, now defaults to `O3`/`speed`.
- An LLVM object-emit function in `llvm.rs` returning `.o` bytes (measurement-only).
- `crates/redextape-native/examples/opt_report.rs`.
- `crates/redextape-native/baselines/<target-triple>.toml`.
- `scripts/check-all.sh`.
- `.forgejo/workflows/ci.yml` — extended `rust` job, new `rust-llvm` job.
