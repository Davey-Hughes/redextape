# wasm32 Gate and the Dependency Rule — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `redextape-core`'s unenforced zero-dependency rule with a `cargo check --target wasm32-unknown-unknown -p redextape-core --lib` gate that runs in `check-all.sh` and CI.

**Architecture:** `check-all.sh` is table-driven — a `LEGS` array of `tier|kind|args` rows, validated by `check_legs()` and dispatched by `do_leg()`. The gate becomes one new row with one new kind, so it inherits the script's existing `--list`, tier-selection and self-validation machinery rather than growing a special case beside it. The target is made available by `setup-dev.sh` locally and by the two CI jobs that reach a base-tier leg — `rust`, which runs `check-all.sh --no-llvm` directly, and `rust-scoped`, whose `check-scoped.sh` escalates to the same command; all three fail loudly rather than skipping, matching how the script already treats a missing `cargo-nextest`.

**Tech Stack:** Bash (the gate scripts), Forgejo Actions YAML, Cargo.

This is **PR 1 of 3** from [`../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md`](../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md) §10. PRs 2 and 3 get their own plans; nothing here depends on them, and nothing here creates a crate, a dependency, or a behaviour change.

## Global Constraints

- **Rust edition 2024**; `rustfmt.toml` sets `max_width = 120`, `use_small_heuristics = "Max"`.
- **`redextape-core`'s `[dependencies]` stays empty in THIS PR.** The rule change is what makes a future dependency admissible; adding one is not this PR's job.
- **No panics on library paths** — `[workspace.lints.clippy]` warns `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`; CI's `-D warnings` makes them fatal.
- **`main` is linear and PR-only.** Work on a branch; squash-merge in the Forgejo web UI. Never push to `main`.
- **Annotate, do not rewrite.** The eight plan documents restating the old rule are historical records and MUST NOT be edited. Only `crates/redextape-core/Cargo.toml` (live config) and the roadmap (which records changes) are touched. Spec §2.3.
- **`scripts/check-all.sh` hard-fails on a missing tool; it never silently skips.** A gate that covers less than its name claims is the defect this script exists to catch — its own header says so.

## File Structure

| file | change | responsibility |
| --- | --- | --- |
| `scripts/check-all.sh` | modify | Adds the `wasm` leg kind, its `LEGS` row, its `check_legs` validation, and a preflight that hard-fails when the target is not installed. |
| `scripts/setup-dev.sh` | modify | Installs `wasm32-unknown-unknown` on a fresh clone, so the gate is runnable after the documented one-time setup. |
| `.forgejo/workflows/ci.yml` | modify | Adds the target to the two jobs that reach a base-tier leg — `rust`, and `rust-scoped` via check-scoped.sh's escalation. |
| `crates/redextape-core/Cargo.toml` | modify | Rewrites the `[dependencies]` comment from "empty by design" to "the gate decides". |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | modify | Records the rule change, its reasoning, and that the historical plan docs are deliberately left as written. |

Three tasks. Task 1 is the gate, Task 2 makes the target available everywhere the gate runs, Task 3 is the policy change. A reviewer could accept the gate and reject the policy — that is why Task 3 is separate.

---

### Task 1: The wasm32 leg in `check-all.sh`

**Files:**
- Modify: `scripts/check-all.sh` — `LEGS` array, `check_legs()` kind validation, `do_leg()` dispatch, and a new `ensure_wasm_target()` preflight

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a `base`-tier leg of kind `wasm` running `cargo check --target wasm32-unknown-unknown -p redextape-core --lib`. Selected by `--no-llvm` and by a bare invocation; NOT selected by `--llvm-only`. Task 2 relies on the target name `wasm32-unknown-unknown` exactly.

**Amended after the whole-branch review.** The preflight was split into its own `base|wasmprobe|` row leading the tier (mirroring `llvm|probe|`) so a missing target fails in seconds rather than after the workspace clippy and test legs have already run, and `ensure_wasm_target` gained a `command -v rustup` check so a rustup-less box gets an accurate message. The steps below describe the final design.

- [ ] **Step 1: Install the target locally so the gate can run**

Task 2 automates this for everyone else; you need it now to execute the later steps.

```bash
rustup target add wasm32-unknown-unknown
```

Expected: `info: downloading component 'rust-std' for 'wasm32-unknown-unknown'` (or `is up to date` if already present).

- [ ] **Step 2: Write the failing test — add the LEGS row with no supporting code**

The script validates its own table at startup. Adding a row tagged with a kind nothing dispatches on is exactly the defect `check_legs()` exists to catch, so this row IS the failing test.

In `scripts/check-all.sh`, add two rows to the `LEGS` array: a `base|wasmprobe|` row FIRST in the base tier, mirroring `llvm|probe|`'s position in the LLVM tier, so a missing target fails in seconds rather than after the rest of the tier — and a `base|wasm|` row where cost ordering puts it, after the whole-workspace pair that catches ordinary breakage first:

```bash
LEGS=(
  "both|fmt|"
  "base|wasmprobe|"
  "base|clippy|--workspace --all-targets"
  "base|test|--workspace"
  "base|wasm|"
  "base|build|-p redextape-native --no-default-features"
  "base|clippy|-p redextape-native --no-default-features --all-targets"
  "base|test|-p redextape-native --no-default-features"
  "llvm|probe|"
  "llvm|clippy|-p redextape-native --features llvm --all-targets"
  "llvm|test|-p redextape-native --features llvm"
  "llvm|clippy|-p redextape-native --no-default-features --features llvm --all-targets"
  "llvm|test|-p redextape-native --no-default-features --features llvm"
)
```

The args field is empty because the command is fixed — like `probe`, and unlike `clippy`/`test`, this leg takes no per-config arguments. There is exactly one thing to check for wasm32-cleanliness and it is `redextape-core`'s lib target.

- [ ] **Step 3: Run it to make sure it fails**

Run: `scripts/check-all.sh --list`

Expected: FAIL, before printing anything, with

```
error: leg tagged with unknown kind 'wasmprobe': base|wasmprobe|
```

`check_legs()` walks `LEGS` in order, and the `wasmprobe` row comes first — so that is the kind it trips on, not `wasm`. Exit status 1. This proves `check_legs()` bites — if it passes, the guard is broken and that is a bug to fix before continuing.

- [ ] **Step 4: Teach `check_legs()` the kind**

In `check_legs()`, add `wasmprobe` and `wasm` to the kind whitelist:

```bash
    case "$kind" in
      fmt|clippy|build|test|probe|wasmprobe|wasm) ;;
      *) echo "error: leg tagged with unknown kind '$kind': $row" >&2; exit 1 ;;
    esac
```

- [ ] **Step 5: Run `--list` to verify both rows are selected correctly**

Run: `scripts/check-all.sh --list`

Expected: PASS, and the output contains, in this order (tab-separated):

```
base	wasmprobe	
base	wasm	
```

`wasmprobe` appears first — it leads the base tier, right after `fmt` and before `clippy` — and `wasm` appears after the `--workspace` clippy/test pair, matching where each row sits in `LEGS`.

Run: `scripts/check-all.sh --llvm-only --list`

Expected: PASS, and the output does **not** contain a `wasmprobe` or `wasm` line. Both are base-tier, so `rust-llvm` (which invokes `--llvm-only`) will not run either and does not need the target.

- [ ] **Step 6: Add the preflight and the dispatch**

Add `ensure_wasm_target()` immediately after the `test_cfg()` definition and before `ensure_llvm_prefix()`. It follows the same hard-fail-with-instructions shape the `cargo nextest` check above it already uses:

```bash
# The wasm32 target is what makes `redextape-core`'s WASM-cleanliness a CHECK rather than a claim.
#
# A HARD FAILURE, not a skip. Before this leg existed the rule was "keep [dependencies] empty", which
# is checkable in one line but is a PROXY: it is sufficient for WASM-clean and not necessary (serde
# compiles to wasm32; a proc-macro dependency cannot break a wasm32 build at all). The proxy was worth
# keeping only while nothing checked the real property — and nothing did, since `rustup target add
# wasm32-unknown-unknown` appeared in ci.yml exactly once, inside the `web` job, which was gated off.
# A gate that silently skips when the target is missing would recreate that situation with extra steps.
#
# TWO FAILURE MODES, not one. `rustup target list --installed 2>/dev/null` swallows stderr, so a
# missing or broken `rustup` reported exactly the same "target is not installed" message as a present
# rustup missing the target — and pointed at `rustup target add`, a command that does not exist on a
# box without rustup. Distro-packaged Rust without rustup is a real configuration, so rustup's
# presence is checked first and reported honestly before the target is checked at all.
#
# CALLED FROM TWO ROWS ON PURPOSE, and the redundancy is the cheaper mistake. `base|wasmprobe|` runs it
# FIRST in its tier so a missing target fails in seconds rather than after the workspace clippy and test
# legs have already run — the same reason `llvm|probe|` leads the LLVM tier. The `wasm` leg then calls it
# again so the leg is correct on its own: a future edit that drops or reorders the probe row degrades the
# error message, where removing this call would let the leg run without its precondition and fail inside
# cargo instead. It is a `grep` against a list rustup already has in memory, so running it twice costs
# nothing worth saving. `ensure_llvm_prefix` is NOT called this way for a different reason: its own guard
# (`if [ -z "${LLVM_SYS_221_PREFIX:-}" ]`) memoizes the probe, so the exported variable persists for the
# rest of the process and a repeat call would add nothing but a duplicate log line. One call suffices —
# that is why one row calls it, not that a second call would cost something.
ensure_wasm_target() {
  if ! command -v rustup >/dev/null 2>&1; then
    echo "error: rustup not found, so this gate cannot check the wasm32 build." >&2
    echo "  this project's toolchain is managed by rustup (rust-toolchain.toml); install it from https://rustup.rs" >&2
    exit 1
  fi
  if ! rustup target list --installed | grep -qx wasm32-unknown-unknown; then
    echo "error: the wasm32-unknown-unknown target is not installed (this gate checks against it)." >&2
    echo "  install: rustup target add wasm32-unknown-unknown" >&2
    echo "  scripts/setup-dev.sh installs it too." >&2
    exit 1
  fi
}
```

This is the version that shipped after review: the redundant call from `base|wasmprobe|` (justified above) and the `command -v rustup` check (so a rustup-less box gets an accurate message instead of being told to run a command that does not exist there).

Then add the dispatch arms in `do_leg()`. They go after `probe`, in the order `wasmprobe` then `wasm`, matching the shipped file:

```bash
do_leg() {
  local kind="$1"; shift
  case "$kind" in
    fmt)    run cargo fmt --all --check ;;
    clippy) run cargo clippy "$@" -- -D warnings ;;
    build)  run cargo build "$@" ;;
    test)   test_cfg "$@" ;;
    probe)  ensure_llvm_prefix ;;
    wasmprobe) ensure_wasm_target ;;
    wasm)   ensure_wasm_target; run cargo check --target wasm32-unknown-unknown -p redextape-core --lib ;;
    *)      echo "error: unknown leg kind: $kind" >&2; exit 1 ;;
  esac
}
```

`--lib` is load-bearing and not a tidiness choice. `--all-targets` FAILS on wasm32 via `proptest`'s `wait-timeout` and `getrandom`, and did so before `mimalloc` existed — the core manifest records this. `--lib` is what a consumer builds, which is the claim the gate is making.

- [ ] **Step 7: Run the gate to verify it passes**

Run: `scripts/check-all.sh --no-llvm`

Expected: PASS. Among the `==>` lines, it prints:

```
==> cargo check --target wasm32-unknown-unknown -p redextape-core --lib
```

and the run ends with `base configs green — the LLVM configs were SKIPPED (--no-llvm)`.

- [ ] **Step 8: Prove the gate is not vacuous**

A gate that passes but would pass anything is worse than no gate. Temporarily break wasm32-cleanliness and confirm the leg catches it.

Edit `crates/redextape-core/Cargo.toml` and move `mimalloc` from dev-dependencies into `[dependencies]`:

```toml
[dependencies]
mimalloc = { version = "0.1", default-features = false }
```

Run: `scripts/check-all.sh --no-llvm`

Expected: FAIL at the wasm leg. The error names `libmimalloc-sys` failing to build — it is C, and there is no C toolchain targeting wasm32 here. This is the exact claim the manifest comment already asserts, now verified rather than trusted.

**Then revert the edit completely:**

```bash
git checkout crates/redextape-core/Cargo.toml
```

Run: `git diff --stat crates/redextape-core/Cargo.toml`

Expected: no output. The manifest must be byte-identical to `main` at this point — Task 3 is what changes it, and only its comment.

- [ ] **Step 9: Commit**

```bash
git add scripts/check-all.sh
git commit -m "ci(check-all): a wasm32 leg, because nothing checked the property the rule proxies

\`redextape-core\`'s empty [dependencies] is SUFFICIENT for WASM-clean, not
necessary — and nothing in CI verified the real property. \`rustup target add
wasm32-unknown-unknown\` appears in ci.yml exactly once, inside the \`web\` job,
which is gated off until web/package.json lands; check-all.sh did not mention
wasm at all. The invariant was enforced by a manifest comment and review.

One base-tier row, one kind, one preflight, so the leg inherits --list,
tier selection and check_legs' self-validation instead of sitting beside them.
Base-tier means --llvm-only does not select it, so rust-llvm needs no target.

--lib is deliberate: --all-targets fails on wasm32 via proptest's wait-timeout
and getrandom, and did so before mimalloc existed. --lib is what a consumer
builds, which is the claim being made.

Verified non-vacuous by moving mimalloc into [dependencies] and watching the
leg fail on libmimalloc-sys, then reverting."
```

---

### Task 2: Make the target available everywhere the gate runs

**Files:**
- Modify: `scripts/setup-dev.sh` — add the target install after the `cargo-nextest` block
- Modify: `.forgejo/workflows/ci.yml` — add the target to the toolchain step of both jobs that reach a base-tier leg, `rust` and `rust-scoped`

**Interfaces:**
- Consumes: Task 1's `ensure_wasm_target()`, which hard-fails when `rustup target list --installed` lacks `wasm32-unknown-unknown`.
- Produces: nothing later tasks call. This task is what stops Task 1's preflight from firing on a fresh clone or a CI runner.

- [ ] **Step 1: Add the target to `setup-dev.sh`**

Insert immediately after the `cargo-nextest` `if/elif/else` block and before the `pre-commit` block:

```bash
# The wasm32 target is what `scripts/check-all.sh`'s wasm leg checks against, and that gate HARD-FAILS
# without it — same reason cargo-nextest is installed above rather than left to the README: a fresh
# clone that cannot run the merge check is a fresh clone whose first gate run is a confusing error.
#
# `rustup target add` is idempotent, so this is safe to re-run; it prints "is up to date" on a second
# pass rather than redownloading.
if command -v rustup >/dev/null 2>&1; then
  rustup target add wasm32-unknown-unknown
  echo "==> rust target wasm32-unknown-unknown installed (scripts/check-all.sh's wasm leg needs it)"
else
  echo "==> rustup not found; skipping wasm32 target (scripts/check-all.sh's wasm leg will fail without it)" >&2
fi
```

The `command -v` guard matches how the `pre-commit` block below it handles a missing tool. Without it,
`set -euo pipefail` aborts setup here on a box with no rustup, and the pre-commit hooks never install —
a setup script that stops halfway is worse than one that reports what it skipped.

- [ ] **Step 2: Run it and verify the target is present**

Run: `scripts/setup-dev.sh`

Expected: completes with `setup complete. Before merging, run: scripts/check-all.sh`, and among the output:

```
==> rust target wasm32-unknown-unknown installed (scripts/check-all.sh's wasm leg needs it)
```

Run: `rustup target list --installed | grep wasm32-unknown-unknown`

Expected: `wasm32-unknown-unknown`

- [ ] **Step 3: Verify it is idempotent**

Run: `scripts/setup-dev.sh`

Expected: succeeds again, exit status 0. The script's header promises idempotence and this is the step that keeps that promise true.

- [ ] **Step 4: Add the target to the two CI jobs that reach a base-tier leg**

In `.forgejo/workflows/ci.yml`, find the `rust-scoped:` job's step named `Install Rust (respects rust-toolchain.toml)` and the `rust:` job's step named `Install Rust (respects rust-toolchain.toml) + coverage tooling`. Add one line after `rustup show` in each:

```yaml
      # rust-scoped job
      - name: Install Rust (respects rust-toolchain.toml)
        run: |
          curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain none
          . "$HOME/.cargo/env"
          echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"
          rustup show
          rustup target add wasm32-unknown-unknown   # check-scoped.sh escalates to check-all.sh, which has a base-tier wasm leg
```

```yaml
      # rust job
      - name: Install Rust (respects rust-toolchain.toml) + coverage tooling
        run: |
          curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain none
          . "$HOME/.cargo/env"
          echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"
          rustup show                        # installs the toolchain + rustfmt/clippy from rust-toolchain.toml
          rustup target add wasm32-unknown-unknown   # scripts/check-all.sh's wasm leg checks against it
          rustup component add llvm-tools-preview
          curl -fsSL https://github.com/taiki-e/cargo-llvm-cov/releases/download/v0.8.7/cargo-llvm-cov-x86_64-unknown-linux-gnu.tar.gz \
            | tar xzf - -C "$HOME/.cargo/bin"
```

**Two jobs, and the second is easy to miss.** `rust` runs `check-all.sh --no-llvm` directly. `rust-scoped` runs `check-scoped.sh`, whose default-deny arm ESCALATES to `./scripts/check-all.sh --no-llvm` — so it reaches the base-tier wasm leg too, and on Forgejo it always does, because `github.event.before` is empty and the script therefore classifies the whole branch diff. Being non-gating means it cannot block a merge; it does not mean it cannot go red. `rust-llvm` invokes `--llvm-only`, which selects no base-tier row, and `rust-slow` runs `check-slow.sh` — neither needs the target.

- [ ] **Step 5: Verify the YAML still parses and the step landed in the right jobs**

Run:

```bash
python3 -c "
import yaml, sys
d = yaml.safe_load(open('.forgejo/workflows/ci.yml'))
jobs = d['jobs']
for name in ('rust-scoped', 'rust', 'rust-llvm', 'rust-slow'):
    body = yaml.dump(jobs[name])
    print(name, 'wasm32' in body)
"
```

Expected exactly:

```
rust-scoped True
rust True
rust-llvm False
rust-slow False
```

If `pyyaml` is unavailable, install it with `pip install pyyaml` or fall back to `grep -c wasm32 .forgejo/workflows/ci.yml`, which should report `3` — `rust-scoped`, `rust`, and the pre-existing occurrence in the `web` job.

- [ ] **Step 6: Commit**

```bash
git add scripts/setup-dev.sh .forgejo/workflows/ci.yml
git commit -m "ci: install wasm32-unknown-unknown where the gate runs, and only there

check-all.sh's wasm leg hard-fails without the target, so a fresh clone and the
CI \`rust\` job both need it. setup-dev.sh already installs cargo-nextest for the
same reason and with the same justification.

Two jobs reach a base-tier leg: \`rust\`, which runs check-all.sh --no-llvm
directly, and \`rust-scoped\`, whose check-scoped.sh escalates to the same
script — always, on Forgejo, since github.event.before is empty. rust-llvm
invokes --llvm-only, which selects no base-tier row; rust-slow runs
check-slow.sh. Neither of those needs the target."
```

---

### Task 3: The rule becomes "the gate decides"

**Files:**
- Modify: `crates/redextape-core/Cargo.toml` — the `[dev-dependencies]` comment above `proptest`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` — a new entry

**Interfaces:**
- Consumes: Task 1's gate, which is what makes this policy change safe.
- Produces: the policy PR 2 relies on when it adds `serde` as an optional dependency of `redextape-core`.

- [ ] **Step 1: Rewrite the manifest comment**

In `crates/redextape-core/Cargo.toml`, replace the comment block above `proptest` in `[dev-dependencies]`. The current text says the dependency list is "empty by design"; that is no longer the rule.

Replace:

```toml
[dev-dependencies]
# Examples and tests only — NEVER a [dependencies] entry. `redextape-core`'s runtime
# dependency list is empty by design and WASM-clean, and `libmimalloc-sys` is C that does
# not build for wasm32. A library must not choose a global allocator anyway; that belongs
# to the final binary. See any probe's ALLOCATOR note for the measured reason it is here.
proptest = "1"
redextape-test-support = { path = "../redextape-test-support" }
```

with:

```toml
[dev-dependencies]
# Examples and tests only.
#
# THE RULE IS NOW THE GATE, NOT THE EMPTY LIST. `redextape-core` must build for wasm32 — that is what
# "WASM-clean" means and what the browser build depends on. Until 2026-08-05 this was enforced by
# keeping `[dependencies]` empty, which is SUFFICIENT for wasm32-cleanliness but not NECESSARY: serde
# builds for wasm32, and a proc-macro dependency cannot break a wasm32 build at all (it runs on the
# host). The empty list was worth keeping only while nothing checked the real property, and nothing
# did — `rustup target add wasm32-unknown-unknown` appeared in ci.yml once, inside the gated-off `web`
# job. `scripts/check-all.sh`'s `wasm` leg now runs `cargo check --target wasm32-unknown-unknown -p
# redextape-core --lib` on every gate run, so a dependency that breaks the browser build fails at the
# PR that adds it. Dependencies are admissible; the gate decides.
#
# WHAT THE GATE DOES NOT COVER, stated because the previous comment stated it honestly too: `--lib`,
# not `--all-targets`. The dev graph is NOT wasm32-clean — `--all-targets` fails on `wait-timeout` and
# `getrandom` via `proptest`, and failed identically before `mimalloc` existed. Nothing short of
# dropping `proptest` would fix that, and `--lib` is what a consumer builds.
#
# `mimalloc` stays a dev-dependency for two independent reasons, neither retired by the rule change:
# `libmimalloc-sys` is C that does not build for wasm32, and a library must not choose a global
# allocator at all — that belongs to the final binary. See any probe's ALLOCATOR note for the measured
# reason it is here.
proptest = "1"
redextape-test-support = { path = "../redextape-test-support" }
```

Leave the `[dependencies]` section itself empty. The `[target.'cfg(not(target_arch = "wasm32"))'.dev-dependencies]` header and its `mimalloc = { version = "0.1", default-features = false }` line are untouched by this step. The comment immediately above that block is a separate matter — a later review fix rewrote it to point at "the wasm32 gate described above" instead of standing alone, and that rewrite is not part of this step's diff.

- [ ] **Step 2: Verify nothing about the dependency graph moved**

Run: `cargo tree -p redextape-core --edges normal`

Expected: `redextape-core v0.0.0 (/home/davey/projects/redextape/crates/redextape-core)` and nothing else. This PR changes the policy, not the graph — and the one-line proof stays true, it just stops being the guarantee.

Run: `scripts/check-all.sh --no-llvm`

Expected: PASS, wasm leg included.

- [ ] **Step 3: Add the roadmap entry**

Append to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, at the end of the file:

```markdown
#### THE ZERO-DEPENDENCY RULE IS RETIRED AND REPLACED BY A GATE (2026-08-05)

Design: [`../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md`](../specs/2026-08-05-plan4-viewmodels-and-wasm-design.md) §2.

**`redextape-core`'s empty `[dependencies]` was a PROXY, and the thing it proxies was unchecked.**
Empty is *sufficient* for wasm32-cleanliness, not *necessary* — `serde` builds for wasm32, and a
proc-macro dependency cannot break a wasm32 build at all, since it runs on the host at build time. The
encoding-registry entry above shows the rule applied past its own justification: `strum` was rejected
because "a derive macro is still a dependency edge."

**Nothing in CI verified the real property.** `rustup target add wasm32-unknown-unknown` appeared in
`ci.yml` exactly once, inside the `web` job — gated off until `web/package.json` lands — and
`check-all.sh` did not mention wasm at all. The invariant was held up by a manifest comment and
reviewer attention. **The rule was still right while that was true**, for a reason that is not about
wasm: "is `[dependencies]` empty?" is checkable in one line forever, and "does the whole transitive
closure build for wasm32 under every future version resolution?" is an audit nobody keeps running.

**The replacement is `scripts/check-all.sh`'s `wasm` leg** — a base-tier row running `cargo check
--target wasm32-unknown-unknown -p redextape-core --lib`, which checks the actual property at the PR
that would break it. `setup-dev.sh` installs the target; so do the two CI jobs that reach a base-tier
leg — `rust`, which runs `check-all.sh --no-llvm` directly, and `rust-scoped`, whose `check-scoped.sh`
ESCALATES to the same command on any change its default-deny arm does not recognise. `rust-llvm` does
not need it, because `--llvm-only` selects no base-tier row, and `rust-slow` runs a different script.
That second job was missed on the first pass and caught in review: being non-gating means it cannot
block a merge, not that it cannot go red. **The rule is now: dependencies are admissible, and the gate
decides.**

**Verified non-vacuous rather than assumed.** `mimalloc` was moved into `[dependencies]`, the leg
failed on `libmimalloc-sys` (C, no wasm32 toolchain), and the edit was reverted. A gate that would
pass anything is worse than no gate.

**Scope of the claim, unchanged and still stated honestly:** `--lib`, not `--all-targets`. The dev
graph is not wasm32-clean — `proptest` drags `wait-timeout` and `getrandom` — and was not before
`mimalloc` existed. Nothing short of dropping `proptest` would fix it. `--lib` is what a consumer
builds.

**The one-line proof survives as a bonus, not as the guarantee.** `serde` enters core in PR 2 as an
*optional* dependency, default off, so `cargo tree -p redextape-core --edges normal` with default
features still lists only itself.

**EIGHT PLAN DOCUMENTS RESTATE THE RULE FOR `REDEXTAPE-CORE`** (the roadmap is excluded — this change
is recorded here) **AND ARE DELIBERATELY LEFT AS WRITTEN.** They are
records of what was true when written, and this repository annotates rather than rewrites — the
"ANNOTATION, not a rewrite" entry above is the precedent, as is `README.md` keeping four dead λ
designs on purpose. A reader who lands in
[`2026-07-29-encoding-registry-and-generator-dedup.md`](2026-07-29-encoding-registry-and-generator-dedup.md)'s
"MUST STAY EMPTY" and obeys it does something harmless and slightly out of date; a history edited to
agree with the present is worse, because nothing then records that the rule ever changed or why.

**What this unblocks, and what it does NOT.** It makes PR 2's optional `serde` admissible. It does
**not** license the three dependencies this thread rejected: `strum` is deferred to the next change to
the encoding registry (design §9.5); `smallvec` stays rejected because `reduce_step`'s
`path.insert(0, ..)` makes path construction O(d²) and smallvec fixes neither that nor anything
measured (§9.6); `bumpalo` is unchanged, since the dependency was obstacle 1 of 3 and the other two
are what make an arena a rewrite (§9.7).
```

- [ ] **Step 4: Verify the roadmap link resolves**

Run:

```bash
ls docs/superpowers/specs/2026-08-05-plan4-viewmodels-and-wasm-design.md \
   docs/superpowers/plans/2026-07-29-encoding-registry-and-generator-dedup.md
```

Expected: both paths listed with no `No such file` error. The roadmap's links are relative to `docs/superpowers/plans/`, so the spec link is `../specs/...` and the plan link is a bare filename.

- [ ] **Step 5: Confirm no historical plan document was modified**

Run: `git status --short docs/superpowers/plans/`

Expected: exactly one modified path,

```
 M docs/superpowers/plans/2026-07-19-redextape-roadmap.md
```

plus this plan file itself if it is not yet committed. **If any other plan document appears, revert it** — the annotate-don't-drift constraint is the one this task is most likely to violate by accident.

- [ ] **Step 6: Run the full gate**

Run: `scripts/check-all.sh --no-llvm`

Expected: PASS, ending with `base configs green — the LLVM configs were SKIPPED (--no-llvm)`.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/Cargo.toml docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "build(core): dependencies are admissible; the gate decides

Retires the zero-dependency rule now that check-all.sh checks the property it
was a proxy for. Empty [dependencies] is sufficient for wasm32-cleanliness, not
necessary — serde builds for wasm32, and a proc-macro edge cannot break a wasm32
build at all, which is what makes the strum rejection ('a derive macro is still
a dependency edge') the clearest case of the rule outrunning its reason.

[dependencies] is still empty in this commit. The change is policy, not graph:
cargo tree -p redextape-core --edges normal still lists only itself, and will
keep doing so after PR 2, since serde enters as an optional default-off feature.

The eight plan documents restating the old rule are deliberately untouched.
They record what was true when written, and this repo annotates rather than
rewrites; the roadmap entry is where the change is recorded."
```

---

## Self-Review

**Spec coverage.** PR 1's scope in spec §10 is: the wasm32 check in `check-all.sh` and CI, `Cargo.toml`'s comment rewritten, a roadmap entry added, and the historical plan documents left alone. Task 1 covers the script, Task 2 covers CI and local setup, Task 3 covers the manifest and the roadmap, and Task 3 Step 5 verifies the annotate-don't-drift constraint mechanically rather than trusting it. Spec §2.3's `--lib`-not-`--all-targets` caveat appears in the code comment (Task 1 Step 6), the manifest (Task 3 Step 1) and the roadmap entry (Task 3 Step 3). Nothing in PR 1's scope is unassigned.

**Deliberately out of scope**, and traceable to the spec rather than dropped: `viewmodel.rs`, `desugar_mapped`, `SourceMap::node_to_source`, `raise_cap`, `TmCursor<M>`, `print_lambda_capped` and the `serde` feature are all PR 2 (spec §3, §4). `crates/redextape-wasm`, `web/`, the pnpm migration and the `Dockerfile`/`ci.yml` web edits are PR 3 (spec §5, §6). The allocator reference-environment decision is recorded in the spec (§11.3) and needs no code here.

**Placeholder scan.** No "TBD", "TODO", "similar to Task N", or "add appropriate error handling". Every step that changes code shows the code in full, including the surrounding array and `case` arms so the edit is unambiguous when read out of order. Every command has an exact expected output.

**Type and name consistency.** The leg kind is `wasm` in all five places it appears — the `LEGS` row, `check_legs()`'s whitelist, `do_leg()`'s arm, the `--list` verification, and the commit message. The preflight is `ensure_wasm_target()` in both its definition and its call site, and it is named to match the existing `ensure_llvm_prefix()` it sits beside. The target triple is `wasm32-unknown-unknown` in all six places, matching what `ci.yml`'s `web` job already installs.

**One risk worth naming.** Task 1 Step 3 depends on `check_legs()` running before `--list` prints. It does — `check_legs` is invoked at the top level immediately after its definition, above the `if [ "$list_only" -eq 1 ]` block. If a future refactor moves it below, Step 3's expected failure would not fire and the step would look passed when the guard was gone.
