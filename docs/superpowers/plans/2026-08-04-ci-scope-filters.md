# CI Scope Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop CI from recompiling work it has already done, and give WIP pushes a fast scoped check without ever weakening the pre-merge gate.

**Architecture:** Three independent changes. `scripts/check-all.sh` gains a `--llvm-only` mode (and a `--list` mode that makes its coverage checkable from outside), so CI's `rust-llvm` job stops repeating every non-LLVM config the `rust` job already ran. A new `scripts/check-scoped.sh` bounds a check to what a git range touched, escalating to a fuller check on any path it does not recognise — fail-safe, not permissive. `ci.yml` runs the scoped script on **draft** PRs only; the moment a PR leaves draft, the full jobs run on every push.

**Tech Stack:** Bash (`set -euo pipefail`, POSIX-ish with bash arrays), `cargo-nextest 0.9.140` filtersets, Forgejo Actions (`15.0.5+gitea-1.22.0`).

**Spec:** [`docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md`](../specs/2026-08-04-ci-scope-filters-design.md)

## Global Constraints

- **`scripts/check-all.sh` with no argument must behave exactly as it does today** — same legs, same order, same output. It remains the full gauntlet. Verified mechanically in Task 2.
- **`--no-llvm` ∪ `--llvm-only` ≡ full.** Structural, not remembered. Verified mechanically in Task 2.
- **Scoping escalates; it is fail-safe, not permissive.** An unrecognised path escalates to `check-all.sh --no-llvm`. A path must never become a silent skip.
- **No claim of a speedup may be written into a comment, commit message, or doc until Task 1 has produced the number.** Task 1 gates Tasks 2 and 3; if the duplication turns out cheap, those tasks shrink or are dropped and the spec is corrected.
- **No new dependencies.** No `jq`, no marketplace actions beyond the two already pinned in `ci.yml`.
- Shell variables feeding recursive deletion use `"${VAR:?}"`. No such command appears in this plan; the rule stands if one is added.
- Commit messages carry no AI attribution.
- Branch: `ci/scope-filters` (already created; the spec is committed there as `25dbf97`).

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/check-all.sh` (modify) | The full gauntlet. Gains a leg table, `--llvm-only`, `--list`. Sole source of truth for what a full check covers. |
| `scripts/check-scoped.sh` (create) | Maps a git range to the narrowest sound check. Knows nothing about CI; takes a range, runs cargo. |
| `.forgejo/workflows/ci.yml` (modify) | Chooses *which* script runs based on the event and the PR's draft flag. Contains no scoping logic of its own. |
| `docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md` (modify) | Corrected in Task 1 with the measured numbers, and again in Task 7 with before/after. |

The split matters: `ci.yml` decides *when*, the scripts decide *what*. Putting path classification in YAML would make it untestable locally, which is the property `check-all.sh` already has and the reason it has not drifted from CI.

---

## Task 1: Measure the duplication

**This task gates Tasks 2 and 3.** The spec claims two duplications cost real time and explicitly does not claim how much. If §2.2(b) measures cheap, Task 3 Step 3 drops it and the spec is corrected rather than implemented.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md` (§2.2 and §6.1)

**Interfaces:**
- Produces: two numbers, recorded in the spec — `T_llvm_repeat` (what `rust-llvm` spends on legs `rust` already ran) and `T_cov_repeat` (what the second, instrumented workspace compile costs).

- [ ] **Step 1: Establish a warm cache, matching what CI restores**

CI restores a `target/` cache and then runs. A cold-cache number would overstate the saving, so measure warm.

```bash
cd /home/davey/projects/redextape
git checkout ci/scope-filters
./scripts/check-all.sh    # warm everything; discard this timing
```

If LLVM 22 is not installed locally, stop and run this task on a box that has it, or run it in a `workflow_dispatch` CI run. `--no-llvm` numbers alone cannot answer the question.

- [ ] **Step 2: Measure what `rust-llvm` currently repeats**

`check-all.sh` full = `--no-llvm` legs + LLVM legs. The repeat cost is the non-LLVM portion, measured on a cache that has *not* seen it — which is `rust-llvm`'s real situation, because it restores `cargo-llvm-*`, a different key from `rust`'s `cargo-*`.

```bash
export CARGO_TARGET_DIR=/tmp/rt-llvmcache
rm -rf "${CARGO_TARGET_DIR:?}"
/usr/bin/time -f 'FULL      %e s' ./scripts/check-all.sh          2>&1 | tail -1

rm -rf "${CARGO_TARGET_DIR:?}"
/usr/bin/time -f 'NO-LLVM   %e s' ./scripts/check-all.sh --no-llvm 2>&1 | tail -1
```

`T_llvm_repeat` ≈ the `NO-LLVM` figure. That is the wall-clock `rust-llvm` currently spends duplicating `rust`.

- [ ] **Step 3: Measure the doubled workspace suite**

```bash
unset CARGO_TARGET_DIR
cargo nextest run --workspace >/dev/null 2>&1          # ensure the plain build is warm
/usr/bin/time -f 'PLAIN-2ND %e s' cargo nextest run --workspace 2>&1 | tail -1
/usr/bin/time -f 'COV-1ST   %e s' cargo llvm-cov nextest --workspace --fail-under-lines 80 2>&1 | tail -1
```

`T_cov_repeat` = `COV-1ST` minus `PLAIN-2ND`. `PLAIN-2ND` is a no-op rebuild plus the test run, so subtracting it isolates the instrumented *compile*.

Cap the memory if the box is shared — the workspace build is parallel and this repository has burned 60 GiB before:

```bash
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 --  <the command>
```

- [ ] **Step 4: Record both numbers in the spec**

Replace the "NOT MEASURED" sentence at the end of §2.2 with the figures and the date, keeping the surrounding text. Update the §6.1 checklist item to say it is done and what it decided. If `T_cov_repeat` is under ~45s, write that Task 3 Step 3 is dropped and say why.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md
git commit -m "docs(ci): measure the duplication the scope-filter design assumed

T_llvm_repeat and T_cov_repeat, warm cache, method in the plan's Task 1.
The design deliberately claimed no speedup until these existed."
```

---

## Task 2: `check-all.sh` gains `--llvm-only` and `--list`

**Files:**
- Modify: `scripts/check-all.sh` (full restructure of the leg-running section; header and LLVM probe text preserved)

**Interfaces:**
- Produces: `scripts/check-all.sh --llvm-only` (runs only the LLVM legs), `scripts/check-all.sh --list` (prints selected legs as `tier<TAB>kind<TAB>args`, runs nothing, exits 0). Both combinable: `--llvm-only --list`.
- Consumes: nothing.

- [ ] **Step 1: Capture today's behaviour as the baseline to diff against**

Before changing anything, record the exact leg sequence the current script runs. `run()` prints every leg as `==> ...`, so the sequence is recoverable without executing cargo:

```bash
cd /home/davey/projects/redextape
git stash list   # ensure clean
sed 's|^"\$@"$|:|; s|^  "\$@"$|  :|' scripts/check-all.sh > /tmp/dryrun-old.sh
```

That edit is fragile. Do it instead by overriding `run` from the outside:

```bash
bash -c 'run() { echo "==> $*"; }; export -f run; source scripts/check-all.sh' 2>/dev/null \
  | grep '^==>' > /tmp/legs-old.txt || true
cat /tmp/legs-old.txt
```

If sourcing proves awkward (the script `exit`s on the `--no-llvm` path), fall back to transcribing the legs by hand from `scripts/check-all.sh` — there are ten. Expected content of `/tmp/legs-old.txt`, in order:

```
==> cargo fmt --all --check
==> cargo clippy --workspace --all-targets -- -D warnings
==> cargo nextest run --workspace
==> cargo test --workspace --doc
==> cargo build -p redextape-native --no-default-features
==> cargo clippy -p redextape-native --no-default-features --all-targets -- -D warnings
==> cargo nextest run -p redextape-native --no-default-features
==> cargo test -p redextape-native --no-default-features --doc
==> cargo clippy -p redextape-native --features llvm --all-targets -- -D warnings
==> cargo nextest run -p redextape-native --features llvm
==> cargo test -p redextape-native --features llvm --doc
==> cargo clippy -p redextape-native --no-default-features --features llvm --all-targets -- -D warnings
==> cargo nextest run -p redextape-native --no-default-features --features llvm
==> cargo test -p redextape-native --no-default-features --features llvm --doc
```

Save that list to `/tmp/legs-old.txt` by hand if the override trick fails. It is the contract for Step 5.

- [ ] **Step 2: Replace the argument parser and leg-running section**

Keep the file's existing header comment block, extending the usage lines. Keep `ensure_llvm_prefix`'s comment text verbatim — it documents measurements and a real bug, and rewording it would lose that.

Replace everything from `run() { echo; echo "==> $*"; "$@"; }` to the end of the file with:

```bash
run() { echo; echo "==> $*"; "$@"; }
usage() { echo "usage: scripts/check-all.sh [--no-llvm | --llvm-only] [--list]" >&2; exit 2; }

# Parsed up front so a typo (`--no-llvmm`) fails immediately rather than silently falling through to
# a full run — a flag that quietly does the opposite of what was asked is the same class of bug as a
# gate that quietly covers less than it claims.
mode=full
list_only=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-llvm)
      [ "$mode" = full ] || { echo "error: --no-llvm and --llvm-only are exclusive" >&2; usage; }
      mode=base; shift ;;
    --llvm-only)
      [ "$mode" = full ] || { echo "error: --no-llvm and --llvm-only are exclusive" >&2; usage; }
      mode=llvm; shift ;;
    --list)
      list_only=1; shift ;;
    *)
      echo "error: unknown argument: $1" >&2; usage ;;
  esac
done

# THE LEG TABLE — the single source of truth for what this gate covers.
#
# Each row is `tier|kind|cargo args`. `both` rows run in every mode, `base` rows are exactly what
# --no-llvm runs, `llvm` rows are exactly what --llvm-only runs. So
#
#     --no-llvm  ∪  --llvm-only  ≡  full
#
# holds BY CONSTRUCTION — the modes select {both,base} and {both,llvm}, whose union is the whole
# table — rather than by anyone remembering to keep three lists in step. Three hand-maintained lists
# drift, and a mode that quietly covers less than its name claims is the exact defect this gate
# exists to catch. `--list` makes the property checkable from outside the script; check_tiers()
# below catches a row tagged with a tier no mode selects.
#
# ROW ORDER IS RUN ORDER. Cheap always-first legs (fmt, clippy) stay at the top of their tier so a
# formatting slip fails in seconds rather than after a feature matrix.
LEGS=(
  "both|fmt|"
  "base|clippy|--workspace --all-targets"
  "base|test|--workspace"
  "base|build|-p redextape-native --no-default-features"
  "base|clippy|-p redextape-native --no-default-features --all-targets"
  "base|test|-p redextape-native --no-default-features"
  "llvm|probe|"
  "llvm|clippy|-p redextape-native --features llvm --all-targets"
  "llvm|test|-p redextape-native --features llvm"
  "llvm|clippy|-p redextape-native --no-default-features --features llvm --all-targets"
  "llvm|test|-p redextape-native --no-default-features --features llvm"
)

# A row tagged with a tier no mode selects would vanish from every run while still LOOKING covered.
# Empty tiers are the same defect one step earlier: --llvm-only that runs nothing still exits 0.
check_tiers() {
  local row tier n_base=0 n_llvm=0
  for row in "${LEGS[@]}"; do
    tier="${row%%|*}"
    case "$tier" in
      both) ;;
      base) n_base=$((n_base + 1)) ;;
      llvm) n_llvm=$((n_llvm + 1)) ;;
      *) echo "error: leg tagged with unknown tier '$tier': $row" >&2; exit 1 ;;
    esac
  done
  [ "$n_base" -gt 0 ] || { echo "error: no base-tier legs — --no-llvm would cover nothing" >&2; exit 1; }
  [ "$n_llvm" -gt 0 ] || { echo "error: no llvm-tier legs — --llvm-only would cover nothing" >&2; exit 1; }
}
check_tiers

selects() {
  case "$1" in
    both) return 0 ;;
    base) [ "$mode" = full ] || [ "$mode" = base ] ;;
    llvm) [ "$mode" = full ] || [ "$mode" = llvm ] ;;
    *)    return 1 ;;
  esac
}

if [ "$list_only" -eq 1 ]; then
  for row in "${LEGS[@]}"; do
    tier="${row%%|*}"; rest="${row#*|}"; kind="${rest%%|*}"; argstr="${rest#*|}"
    selects "$tier" || continue
    printf '%s\t%s\t%s\n' "$tier" "$kind" "$argstr"
  done
  exit 0
fi

# THE RUNNER IS cargo-nextest, not `cargo test`. `cargo test` runs the 22 test binaries ONE AT A TIME
# and shares threads only WITHIN a binary; nextest schedules every test from every binary in one
# parallel pool. Measured on this suite (2026-07-28, 12 logical CPUs): 231.7s -> 135.2s wall, the same
# 623 tests with the same pass set, parallelism 1.39x -> 2.51x. Nothing about any test changed.
#
# A hard failure, not a fallback to `cargo test`. A gate that silently runs a different runner
# depending on what happens to be installed is a gate whose behaviour nobody can predict — and the
# fallback would be the SLOW path, so the machine least likely to notice is the one that needed the
# speed most.
if ! cargo nextest --version >/dev/null 2>&1; then
  echo "error: cargo-nextest not found (the test runner this gate uses)." >&2
  echo "  install: cargo install cargo-nextest --locked   # or: brew install cargo-nextest" >&2
  echo "  scripts/setup-dev.sh installs it too." >&2
  exit 1
fi

# NEXTEST DOES NOT RUN DOCTESTS. `cargo test` ran them as a side effect, so swapping the runner would
# silently drop them — the exact "gate covers less than its name claims" defect this project keeps
# finding. Every `test` leg therefore pairs nextest with an explicit `cargo test --doc` AT THE SAME
# FEATURE FLAGS. Keep the pairing if a leg is ever added.
#
# There is one doctest in the tree today, `ty::show` (crates/redextape-core/src/ty.rs) — the paired
# run is what actually executes it, since nextest alone cannot. Its value only grows as more `///`
# examples land.
test_cfg() { run cargo nextest run "$@"; run cargo test "$@" --doc; }

do_leg() {
  local kind="$1"; shift
  case "$kind" in
    fmt)    run cargo fmt --all --check ;;
    clippy) run cargo clippy "$@" -- -D warnings ;;
    build)  run cargo build "$@" ;;
    test)   test_cfg "$@" ;;
    probe)  ensure_llvm_prefix ;;
    *)      echo "error: unknown leg kind: $kind" >&2; exit 1 ;;
  esac
}

for row in "${LEGS[@]}"; do
  tier="${row%%|*}"; rest="${row#*|}"; kind="${rest%%|*}"; argstr="${rest#*|}"
  selects "$tier" || continue
  read -r -a leg_args <<< "$argstr" || true
  # Guarded expansion: an empty array must expand to NO arguments, not to one empty string.
  do_leg "$kind" ${leg_args[@]+"${leg_args[@]}"}
done

echo
case "$mode" in
  full) echo "all configs green" ;;
  base) echo "base configs green — the LLVM configs were SKIPPED (--no-llvm)" ;;
  llvm) echo "llvm configs green — the base configs were SKIPPED (--llvm-only), so this is NOT a full gate" ;;
esac
```

- [ ] **Step 3: Lift the LLVM prefix probe into `ensure_llvm_prefix`**

Insert this above `do_leg`, carrying the existing comment block across **verbatim** — it records a measured platform difference and a real linker bug:

```bash
# llvm-sys locates LLVM via a version-specific variable. Honor an existing setting; otherwise probe
# the usual locations. If broadening the supported LLVM range later, derive the variable NAME from
# the selected inkwell feature rather than hardcoding 221.
#
# `/usr` is in the list because that is where most Linux distributions put LLVM (Arch, Fedora, and
# openSUSE all ship `/usr/bin/llvm-config`); without it this gate could not run its LLVM configs on
# those systems at all, and reported "no LLVM 22 found" on a machine with LLVM 22 installed.
#
# THE VERSION CHECK IS THE POINT, not decoration. Three of the four entries are UNVERSIONED
# (`/opt/homebrew/opt/llvm`, `/usr/local/opt/llvm`, `/usr`) — only `/usr/lib/llvm-22` names 22 in the
# path. Accepting an unversioned prefix on the strength of `llvm-config` merely EXISTING is how a box
# with, say, LLVM 18 at `/usr` gets handed to llvm-sys as if it were 22: the failure then surfaces as
# an llvm-sys build error naming a version nobody asked for, far from the line that chose it. Probing
# for the right LLVM and probing for any LLVM are different questions, and this asks the first.
ensure_llvm_prefix() {
  local llvm_probe_paths="/opt/homebrew/opt/llvm /usr/lib/llvm-22 /usr/local/opt/llvm /usr"
  # An explicit LLVM_SYS_221_PREFIX is deliberately NOT version-checked: setting it is a statement of
  # intent, and a wrong one already fails loudly in llvm-sys. The guard below is for the GUESS.
  if [ -z "${LLVM_SYS_221_PREFIX:-}" ]; then
    local p
    for p in $llvm_probe_paths; do
      [ -x "$p/bin/llvm-config" ] || continue
      [ "$("$p/bin/llvm-config" --version 2>/dev/null | cut -d. -f1)" = 22 ] || continue
      export LLVM_SYS_221_PREFIX="$p"; break
    done
  fi
  if [ -z "${LLVM_SYS_221_PREFIX:-}" ]; then
    echo "error: no LLVM 22 found; set LLVM_SYS_221_PREFIX or pass --no-llvm" >&2
    echo "  probed (needs bin/llvm-config reporting major version 22): $llvm_probe_paths" >&2
    exit 1
  fi
  echo "==> using LLVM at $LLVM_SYS_221_PREFIX"
}
```

- [ ] **Step 4: Update the header comment**

Replace the usage block near the top of the file with:

```bash
#   scripts/check-all.sh               # everything, including the LLVM configs
#   scripts/check-all.sh --no-llvm     # skip LLVM (no toolchain installed)
#   scripts/check-all.sh --llvm-only   # ONLY the LLVM configs — NOT a full gate on its own
#   scripts/check-all.sh --list        # print the legs the mode selects; run nothing
#
# --llvm-only exists because CI's `rust-llvm` job invoked this script with no flag, and no flag is
# `--no-llvm` PLUS the LLVM configs by construction — so that job recompiled every non-LLVM config
# the `rust` job had already run, from a different cache key. See
# docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md §2.2.
```

- [ ] **Step 5: Verify the full mode is byte-for-byte the same sequence**

```bash
./scripts/check-all.sh --list | cut -f2,3 > /tmp/legs-new.txt
cat /tmp/legs-new.txt
```

Expected — the leg table, in table order:

```
fmt
clippy	--workspace --all-targets
test	--workspace
build	-p redextape-native --no-default-features
clippy	-p redextape-native --no-default-features --all-targets
test	-p redextape-native --no-default-features
probe
clippy	-p redextape-native --features llvm --all-targets
test	-p redextape-native --features llvm
clippy	-p redextape-native --no-default-features --features llvm --all-targets
test	-p redextape-native --no-default-features --features llvm
```

Check by eye against `/tmp/legs-old.txt` from Step 1: each `clippy` row expands to `cargo clippy <args> -- -D warnings`, each `test` row to a `cargo nextest run <args>` followed by `cargo test <args> --doc`. Same commands, same order. **If any leg differs, stop and fix the table — this is the constraint the whole task rests on.**

- [ ] **Step 6: Verify the union invariant from outside**

```bash
diff <(cat <(./scripts/check-all.sh --no-llvm --list) \
           <(./scripts/check-all.sh --llvm-only --list) | sort -u) \
     <(./scripts/check-all.sh --list | sort -u) && echo "UNION OK"
```

Expected: `UNION OK`, no diff output. The `both`-tier `fmt` row appears in both modes and `sort -u` collapses it — that is exactly why the union, not a partition, is the invariant.

- [ ] **Step 7: Verify the failure modes**

```bash
./scripts/check-all.sh --no-llvmm       ; echo "exit=$?"   # expect: error + usage, exit=2
./scripts/check-all.sh --no-llvm --llvm-only ; echo "exit=$?" # expect: exclusive error, exit=2
./scripts/check-all.sh --llvm-only --list ; echo "exit=$?"  # expect: 5 llvm+both legs, exit=0
```

- [ ] **Step 8: Run the real thing once, both new modes**

```bash
./scripts/check-all.sh --llvm-only    # expect: green, and NO --workspace legs in the output
./scripts/check-all.sh --no-llvm      # expect: green, unchanged from before this task
```

- [ ] **Step 9: Commit**

```bash
git add scripts/check-all.sh
git commit -m "build(scripts): check-all.sh gains --llvm-only, from a leg table that cannot drift

CI's rust-llvm job invoked this script with no flag, and no flag is --no-llvm
PLUS the LLVM configs by construction — so it recompiled every non-LLVM config
the rust job had already run, from a different cache key.

The three modes are filters over ONE leg table rather than three lists, so
--no-llvm ∪ --llvm-only ≡ full holds structurally. --list prints the selected
legs and runs nothing, which makes that invariant checkable from outside the
script rather than asserted inside it; check_tiers() catches the one thing
--list cannot, a row tagged with a tier no mode selects.

Full mode's leg sequence is unchanged — same commands, same order."
```

---

## Task 3: Point CI's `rust-llvm` at `--llvm-only`

**Files:**
- Modify: `.forgejo/workflows/ci.yml` (the `rust-llvm` job's final steps; the `rust` job's steps)

**Interfaces:**
- Consumes: `scripts/check-all.sh --llvm-only` from Task 2.

- [ ] **Step 1: Switch the `rust-llvm` job**

Replace:

```yaml
      - name: Feature matrix (all configs, including LLVM)
        run: ./scripts/check-all.sh
```

with:

```yaml
      # --llvm-only, NOT the bare invocation this used to be. Bare `check-all.sh` is `--no-llvm` plus
      # the LLVM configs by construction, so this job recompiled every non-LLVM config the `rust` job
      # had already run — and from a different cache key (`cargo-llvm-*` vs `cargo-*`), so it was a
      # genuine rebuild rather than a warm no-op. The union invariant in check-all.sh is what makes
      # splitting the job safe: --no-llvm here plus --llvm-only there still covers every config.
      - name: Feature matrix (LLVM configs only — `rust` covers the rest)
        run: ./scripts/check-all.sh --llvm-only
```

- [ ] **Step 2: Drop the `rust` job's redundant `Format` and `Clippy` steps**

These run immediately before `check-all.sh --no-llvm`, which runs the same two commands against the same target directory. Cargo no-ops the second pair, so this buys log clarity rather than time — say so, and do not claim otherwise.

Delete:

```yaml
      - name: Format
        run: cargo fmt --all --check
      - name: Clippy
        run: cargo clippy --workspace --all-targets -- -D warnings
```

- [ ] **Step 3: Apply the Task 1 decision on the doubled workspace suite**

**If `T_cov_repeat` from Task 1 was material** (roughly: over 45s), add a `--skip-workspace-tests` capability. **If it was not**, skip this step entirely and note in the commit message that measurement said no.

Do not invent a third design here. If it is material, the minimal change is a `nocov` tier tag on the `base|test|--workspace` row plus a `--no-workspace-test` flag, and it needs its own union assertion — which means it needs its own task, not a step. Add it as Task 3b and re-run Task 2 Step 6.

- [ ] **Step 4: Validate the YAML parses**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.forgejo/workflows/ci.yml')); print('YAML OK')"
```

Expected: `YAML OK`.

- [ ] **Step 5: Commit**

```bash
git add .forgejo/workflows/ci.yml
git commit -m "ci: rust-llvm runs --llvm-only, and rust drops two no-op steps

rust-llvm's bare check-all.sh invocation repeated every non-LLVM config the
rust job had already run, from a different cache key. --llvm-only removes it;
check-all.sh's union invariant is what makes the split safe.

The rust job's separate Format and Clippy steps ran the same two commands
check-all.sh --no-llvm runs moments later against the same target dir, so cargo
no-opped them. Removing them buys log clarity, NOT time, and this message says
so rather than rounding it up."
```

---

## Task 4: `scripts/check-scoped.sh`

**Files:**
- Create: `scripts/check-scoped.sh`

**Interfaces:**
- Produces: `scripts/check-scoped.sh <git-range>` — exit 0 on green or on "nothing to check", non-zero on a failing check. Escalates to `./scripts/check-all.sh --no-llvm` for any path it does not recognise.
- Consumes: `cargo nextest` filtersets `binary()`, `package()`, `rdeps()` (0.9.140).

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Scope a check to what a diff range actually touched.
#
#   scripts/check-scoped.sh main..HEAD
#   scripts/check-scoped.sh "$BEFORE..$SHA"
#
# THIS IS NOT THE MERGE GATE. scripts/check-all.sh is. This exists so a WIP push that only touched a
# test does not pay for the whole feature matrix, and CI wires it to DRAFT pull requests only
# (.forgejo/workflows/ci.yml, the `rust-scoped` job). The moment a PR leaves draft, the full jobs run
# on every push. See docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md §4.2.
#
# WHY THIS IS NOT A PATH FILTER IN ci.yml: on a `pull_request` event, Actions evaluates `paths`
# against the whole base...head diff, so a branch whose first commit touched a src file runs
# everything for every later test-only push — the exact case this is for. Scoping on the PUSH
# increment is what helps, and that is only sound for a check nobody merges on.
#
# THE DEFAULT IS ALWAYS TO RUN MORE. A path this script has not been taught escalates to
# `check-all.sh --no-llvm`; it never becomes a skip. Permissive scoping — skipping instead of
# escalating — is how a gate ends up covering less than its name claims.
#
# WHY binary() AND NOT rdeps() FOR TESTS: Cargo test and example targets are LEAVES — nothing in the
# build graph depends on them — so a change confined to them provably cannot alter another target's
# result. rdeps() is the crate-graph answer and it buys almost nothing here: redextape-core is one
# 23k-line crate that all three others depend on, so rdeps(redextape-core) is the whole workspace.
set -euo pipefail

run() { echo; echo "==> $*"; "$@"; }
usage() { echo "usage: scripts/check-scoped.sh <git-range>   # e.g. main..HEAD" >&2; exit 2; }

[ "$#" -eq 1 ] || usage
range="$1"

cd "$(git rev-parse --show-toplevel)"

if ! cargo nextest --version >/dev/null 2>&1; then
  echo "error: cargo-nextest not found (the test runner this check uses)." >&2
  echo "  install: cargo install cargo-nextest --locked   # or: brew install cargo-nextest" >&2
  echo "  scripts/setup-dev.sh installs it too." >&2
  exit 1
fi

# A range whose endpoints do not both resolve describes nothing. Force-pushed branches produce these
# routinely — CI hands over a `before` SHA that the push destroyed — so fall back to the branch's
# whole diff rather than scoping on a range git cannot read. Falling back means checking MORE, which
# is the safe direction; silently scoping to an unreadable range would mean checking nothing.
base="${range%%..*}"
head="${range##*..}"
if [ "$base" = "$range" ] \
   || ! git cat-file -e "${base}^{commit}" 2>/dev/null \
   || ! git cat-file -e "${head}^{commit}" 2>/dev/null; then
  echo "==> range '$range' does not resolve — falling back to the whole branch diff"
  base="$(git merge-base origin/main HEAD 2>/dev/null || git merge-base main HEAD)"
  head=HEAD
fi
echo "==> scoping to ${base}..${head}"

files="$(git diff --name-only "$base" "$head")"
if [ -z "$files" ]; then
  echo "==> no files changed — nothing to check"
  exit 0
fi
echo "$files" | sed 's/^/    /'

force_full=""
need_lint=0
declare -a filterset=()
declare -a doc_pkgs=()

add_term() {
  local t
  for t in ${filterset[@]+"${filterset[@]}"}; do [ "$t" = "$1" ] && return 0; done
  filterset+=("$1")
}
add_doc_pkg() {
  local p
  for p in ${doc_pkgs[@]+"${doc_pkgs[@]}"}; do [ "$p" = "$1" ] && return 0; done
  doc_pkgs+=("$1")
}

# `case` globs match `/`, so `crates/*/tests/*.rs` also matches crates/x/tests/common/mod.rs. The
# arms below re-split the path and check for a further `/` rather than trusting the glob.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    docs/*|*.md|LICENSE*)
      ;;
    crates/*/tests/*)
      rest="${f#crates/}"; pkg="${rest%%/*}"; tail="${rest#*/tests/}"
      need_lint=1
      case "$tail" in
        # A helper module (tests/common/mod.rs) is included by an unknown set of binaries in that
        # crate, so it escalates to the package. Only a direct child of tests/ IS one binary.
        */*)   add_term "package($pkg)" ;;
        *.rs)  add_term "binary(${tail%.rs})" ;;
        *)     add_term "package($pkg)" ;;
      esac ;;
    crates/*/examples/*|crates/*/benches/*)
      # Nothing to RUN: `clippy --workspace --all-targets` below builds examples and benches.
      need_lint=1 ;;
    crates/*/src/*|crates/*/build.rs|crates/*/Cargo.toml)
      rest="${f#crates/}"; pkg="${rest%%/*}"
      need_lint=1; add_term "rdeps($pkg)"; add_doc_pkg "$pkg" ;;
    *)
      # Workspace root manifests, rust-toolchain.toml, clippy.toml, rustfmt.toml, scripts/, .forgejo/,
      # Dockerfile, deploy/, .cargo/ — and anything nobody has classified yet. Default-deny.
      force_full="$f"; break ;;
  esac
done <<< "$files"

if [ -n "$force_full" ]; then
  echo
  echo "==> CANNOT SCOPE: '$force_full' is not a path this script knows how to bound."
  echo "    Escalating to the fast full tier. This is the fail-safe, not a failure."
  run ./scripts/check-all.sh --no-llvm
  exit 0
fi

if [ "$need_lint" -eq 0 ]; then
  echo
  echo "==> only docs and markdown changed — nothing to check"
  exit 0
fi

run cargo fmt --all --check
run cargo clippy --workspace --all-targets -- -D warnings

if [ "${#filterset[@]}" -eq 0 ]; then
  echo
  echo "==> no test targets affected (examples/benches only) — clippy --all-targets built them"
else
  expr="$(printf '%s + ' "${filterset[@]}")"; expr="${expr% + }"
  run cargo nextest run -E "$expr"
fi

# Doctests are not something nextest can run at all, so a src change pairs its filterset with an
# explicit `cargo test --doc` for the same package — the pairing check-all.sh's test_cfg makes.
for p in ${doc_pkgs[@]+"${doc_pkgs[@]}"}; do
  run cargo test -p "$p" --doc
done

echo
echo "scoped check green for ${base}..${head}"
echo "NOT THE MERGE GATE — scripts/check-all.sh is. Take the PR out of draft to run it."
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/check-scoped.sh
ls -l scripts/check-scoped.sh
```

Expected: mode contains `x`, matching the other scripts.

- [ ] **Step 3: Verify it refuses to scope an unknown path (fail-open)**

```bash
touch NEW-TOPLEVEL-FILE.txt && git add NEW-TOPLEVEL-FILE.txt && git commit -qm "tmp: fail-open probe"
./scripts/check-scoped.sh HEAD~1..HEAD 2>&1 | head -20
```

Expected: `CANNOT SCOPE: 'NEW-TOPLEVEL-FILE.txt'` followed by `==> ./scripts/check-all.sh --no-llvm` starting. Interrupt it once the escalation line appears — the point is the decision, not the run.

```bash
git reset --hard HEAD~1 && rm -f NEW-TOPLEVEL-FILE.txt
```

- [ ] **Step 4: Verify test-only scoping picks the right binary**

```bash
printf '\n// scope probe\n' >> crates/redextape-core/tests/tm_header.rs
git add -A && git commit -qm "tmp: scope probe"
./scripts/check-scoped.sh HEAD~1..HEAD 2>&1 | grep -E '^==> cargo (nextest|test|fmt|clippy)'
```

Expected — exactly these, and **no `cargo test --doc`** (no src changed):

```
==> cargo fmt --all --check
==> cargo clippy --workspace --all-targets -- -D warnings
==> cargo nextest run -E binary(tm_header)
```

```bash
git reset --hard HEAD~1
```

- [ ] **Step 5: Verify the helper-module escalation**

```bash
printf '\n// scope probe\n' >> crates/redextape-core/tests/common/mod.rs
git add -A && git commit -qm "tmp: helper probe"
./scripts/check-scoped.sh HEAD~1..HEAD 2>&1 | grep -E '^==> cargo nextest'
```

Expected: `==> cargo nextest run -E package(redextape-core)` — **not** `binary(mod)`. This is the case a naive stem-extraction gets wrong.

```bash
git reset --hard HEAD~1
```

- [ ] **Step 6: Verify a docs-only range does nothing**

```bash
printf '\n' >> README.md && git add -A && git commit -qm "tmp: docs probe"
./scripts/check-scoped.sh HEAD~1..HEAD
git reset --hard HEAD~1
```

Expected: `==> only docs and markdown changed — nothing to check`, exit 0, no cargo invocation.

- [ ] **Step 7: Verify an unresolvable range falls back rather than scoping to nothing**

```bash
./scripts/check-scoped.sh 0000000000000000000000000000000000000000..HEAD 2>&1 | head -4
```

Expected: `==> range '...' does not resolve — falling back to the whole branch diff`, then a `scoping to <merge-base>..HEAD` line.

- [ ] **Step 8: Commit**

```bash
git add scripts/check-scoped.sh
git commit -m "build(scripts): check-scoped.sh — bound a check to what a range touched

Not the merge gate, and it says so in its banner and its closing line.
check-all.sh stays exactly what it was.

binary() rather than rdeps() is the whole point: cargo test and example targets
are build-graph leaves, so a change confined to them provably cannot alter
another target's result. rdeps() buys almost nothing here — redextape-core is
one 23k-line crate the other three depend on, so rdeps(redextape-core) is the
workspace.

Fail-safe by construction. An unclassified path escalates to check-all.sh
--no-llvm and an unresolvable range falls back to the whole branch diff; a
helper module under tests/ escalates to package() rather than guessing a binary
name from its stem."
```

---

## Task 5: CI wiring — draft PRs scoped, non-draft PRs full

**Files:**
- Modify: `.forgejo/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/check-scoped.sh` (Task 4), `check-all.sh --llvm-only` (Task 3).
- Produces: a `rust-scoped` job. It is deliberately **not** added to the `docker` job's `needs`.

- [ ] **Step 1: Add `edited` to the PR trigger**

```yaml
on:
  push:
    branches: [main]
    tags: ["v*"]
    paths-ignore: ["docs/**", "**/*.md", "LICENSE*"]
  pull_request:
    # `edited` is load-bearing, not decoration. Forgejo has NO `ready_for_review` event — its drafts
    # are a `WIP:` title prefix — so taking a PR out of draft surfaces as `edited`. Without it the
    # full jobs would not run until the next push, which is a window in which a draft-scoped PR could
    # be merged having never had a full run. The cost is that editing a non-draft PR's title or body
    # also re-runs the full jobs; that is the cheaper mistake.
    types: [opened, synchronize, reopened, edited]
    paths-ignore: ["docs/**", "**/*.md", "LICENSE*"]
  workflow_dispatch:
```

- [ ] **Step 2: Add the `rust-scoped` job**

Insert after the `linear-history` job:

```yaml
  # DRAFT pull requests only: a scoped check against the push increment, so a WIP push that touched
  # one test does not pay for the whole feature matrix. Explicitly NOT a gate — the moment the PR
  # leaves draft, `rust`/`rust-llvm`/`rust-slow` run on every push and this job stops.
  #
  # The DRAFT BOOLEAN, not a `full-ci` label, decides. A label does not follow the head commit: push
  # after labelling and it still reads green while the full run describes an older tree — the
  # covers-less-than-it-claims failure this repository keeps finding. `draft` cannot go stale,
  # because leaving draft makes the full jobs run on every subsequent push.
  rust-scoped:
    needs: detect
    if: >-
      needs.detect.outputs.has_rust == 'true'
      && github.event_name == 'pull_request'
      && github.event.pull_request.draft
    runs-on: docker
    steps:
      - uses: https://code.forgejo.org/actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
        with:
          fetch-depth: 0     # check-scoped.sh needs merge-base for its fallback
      - name: Install Rust (respects rust-toolchain.toml)
        run: |
          curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain none
          . "$HOME/.cargo/env"
          echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"
          rustup show
      - name: Install cargo-nextest (pinned + checksummed)
        run: ./scripts/install-nextest-ci.sh
      # Restores the `rust` job's cache as a fallback, so a scoped run on a fresh branch starts warm
      # rather than compiling the workspace from scratch to run one test binary.
      - uses: https://code.forgejo.org/actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: cargo-scoped-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: |
            cargo-scoped-
            cargo-
      - name: Scoped check (NOT the merge gate)
        env:
          BEFORE: ${{ github.event.before }}
          SHA: ${{ github.event.pull_request.head.sha }}
        run: |
          set -eu
          # An absent or zeroed `before` (first push, or a force-push that destroyed it) is handled
          # inside the script: it falls back to the whole branch diff, which checks MORE.
          ./scripts/check-scoped.sh "${BEFORE:-none}..${SHA}"
```

- [ ] **Step 3: Gate the three full jobs on non-draft**

Change the `if:` of **each** of `rust`, `rust-slow` and `rust-llvm` from:

```yaml
    if: needs.detect.outputs.has_rust == 'true'
```

to:

```yaml
    # Non-draft PRs, pushes and dispatches. A DRAFT PR gets `rust-scoped` instead — see that job for
    # why the draft boolean rather than a label decides. Note this runs on EVERY push to a non-draft
    # PR, so a green full run always describes the head commit.
    if: >-
      needs.detect.outputs.has_rust == 'true'
      && (github.event_name != 'pull_request' || !github.event.pull_request.draft)
```

- [ ] **Step 4: Confirm the `docker` job still fails closed**

Read the `docker` job's `if:`. It requires `needs.rust.result == 'success'` (and the same for `rust-llvm`, `rust-slow`, `web`), plus `github.event_name != 'pull_request'`. A skipped job reports `skipped`, not `success`, so a draft-PR run cannot reach it — and it never ran on PRs anyway. **Do not add `rust-scoped` to `docker`'s `needs`.** Confirm by reading; change nothing.

- [ ] **Step 5: Validate the YAML parses**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.forgejo/workflows/ci.yml')); print('YAML OK')"
```

Expected: `YAML OK`.

- [ ] **Step 6: Commit**

```bash
git add .forgejo/workflows/ci.yml
git commit -m "ci: draft PRs get a scoped check, non-draft PRs get everything

A path filter cannot fix this. On a pull_request event Actions evaluates paths
against the whole base...head diff, so a branch whose first commit touched a src
file runs the full matrix for every later test-only push. Measured on the last
40 commits, a sound path filter fires on 3 of them.

The unit that is genuinely test-only is the PUSH, and scoping on it is only
sound for a check nobody merges on — hence draft-only, hence not in docker's
needs, hence the banner in check-scoped.sh.

The draft boolean rather than a full-ci label decides, because a label does not
follow the head commit: push after labelling and it reads green for an older
tree. `edited` is in the trigger list because Forgejo has no ready_for_review
event and un-drafting surfaces as edited; the cost is that a title edit on a
non-draft PR re-runs the full jobs."
```

---

## Task 6: Verify the platform assumptions on a live PR

**This task must run before Task 5's wiring is trusted.** Two payload assumptions are unverified: that Forgejo populates `github.event.pull_request.draft`, and that un-drafting fires `edited`. If either is false, Task 5 needs the label fallback in §3.1 of the spec.

> **AMENDED 2026-08-04. A THIRD QUESTION WAS ADDED, AND IT OUTRANKS THE OTHER TWO.**
>
> **What status does Forgejo report for a SKIPPED job?** Measured on existing runs, it is
> uniformly `success` — MEASURED on PR #8, run 59, and it is the bad answer (an earlier note here
> called the mapping *inconsistent*; that was a bad `sort -u` on the status-history endpoint, not a
> property of Forgejo — see the design spec §4.4). Task 5 makes `rust`, `rust-llvm` and `rust-slow` skip on
> draft PRs, and Task 8 makes those the required status checks — so if "skipped" resolves to
> `success`, **a draft PR would show every required check green having run only the non-gating
> scoped pre-check.** That is the exact defect this branch exists to prevent, and it would make
> Task 5's design unsafe rather than merely imperfect.
>
> The draft PR this task opens is the instrument for answering it. Add to Step 3: read the commit
> statuses on the draft PR's head and record what `rust`, `rust-llvm` and `rust-slow` report while
> skipped.
>
> ```bash
> TOK=$(grep -m1 -o 'token: [A-Za-z0-9]*' ~/.config/tea/config.yml | cut -d' ' -f2)
> SHA=$(git rev-parse HEAD)
> curl -s -H "Authorization: token $TOK" \
>   "https://forge.daveynet.xyz/api/v1/repos/davey/redextape/commits/$SHA/statuses?limit=50" \
>   | jq -r '.[] | [.status, .context] | @tsv' | sort -u -k2
> ```
>
> **If they report `success` while skipped, STOP and report.** Task 5 then needs a different
> mechanism — the candidate is a job that RUNS on draft PRs and deliberately fails, so the required
> context is red rather than absent — and Task 8 must not create branch protection until it is in.
>
> **A FOURTH QUESTION, added by Task 5's implementer.** Is `github.event.before` populated on a
> `synchronize` event? `rust-scoped` passes `"${BEFORE:-none}..${SHA}"` to `check-scoped.sh`, and if
> `before` is empty the range becomes the literal `none..<sha>`, which fails endpoint validation and
> falls back to the whole-branch diff.
>
> **That failure is SAFE — it scopes to MORE, never less — but it makes the job pointless**, because
> the whole-branch diff is exactly what §1.2 measured as firing on 3 of 40 commits. A scoped job that
> silently always takes the fallback would look like it was working while buying nothing.
>
> Read the `rust-scoped` job's log on the draft PR's **second** push (the first has no meaningful
> `before`) and record which line it printed:
>
> - `==> scoping to <sha>..<sha>` — `before` is populated, the narrow path works
> - `==> range 'none..<sha>' does not resolve — falling back to the whole branch diff` — `before` is
>   empty, and the job is safe but worthless as written
>
> If it is the second, the fix is to derive the range in the workflow from
> `github.event.pull_request.base.sha` and the merge-base rather than from `before`, or to accept
> whole-branch scoping and say so in the job's comment rather than implying a narrower one.

**Files:**
- Modify: `.forgejo/workflows/ci.yml` (temporary debug step, removed in Step 5)

- [ ] **Step 1: Add a temporary payload dump to `rust-scoped`**

Insert as the job's first step, before `checkout`:

```yaml
      - name: TEMPORARY payload probe (removed before merge)
        run: |
          echo "event_name=${{ github.event_name }}"
          echo "action=${{ github.event.action }}"
          echo "draft=${{ github.event.pull_request.draft }}"
          echo "before=${{ github.event.before }}"
          echo "head.sha=${{ github.event.pull_request.head.sha }}"
```

Also temporarily relax the job's `if:` to `github.event_name == 'pull_request'` so it runs regardless of draft state and the probe is visible in both.

- [ ] **Step 2: Push the branch and open a DRAFT PR**

```bash
git push -u origin ci/scope-filters
```

Open the PR in the Forgejo web UI with a `WIP:` title prefix (that is how Forgejo marks drafts).

- [ ] **Step 3: Read the probe output**

```bash
TOK=$(grep -m1 -o 'token: [A-Za-z0-9]*' ~/.config/tea/config.yml | cut -d' ' -f2)
curl -s -H "Authorization: token $TOK" \
  "https://forge.daveynet.xyz/api/v1/repos/davey/redextape/actions/tasks?limit=10" \
  | grep -o '"name":"rust-scoped"[^}]*'
```

Then read the job in the web UI. Record:

- Is `draft=true`? **If it prints empty**, Forgejo does not populate the field: Task 5's conditions must switch to the label fallback (`types: [..., labeled]`, `if: github.event.label.name == 'full-ci'`, **plus** a step on `synchronize` that removes the label so it cannot go stale).
- Is `before` a real SHA or empty? If empty, the script's fallback handles it — confirm the fallback line appeared in `check-scoped.sh`'s output.

- [ ] **Step 4: Un-draft the PR and confirm an `edited` event fires**

Remove the `WIP:` prefix in the web UI. Then:

```bash
curl -s -H "Authorization: token $TOK" \
  "https://forge.daveynet.xyz/api/v1/repos/davey/redextape/actions/tasks?limit=10" \
  | grep -o '"run_number":[0-9]*,"event":"[a-z_]*"'
```

Expected: a new run appears. If no run appears, `edited` does not fire on un-draft, and Task 5 needs the label fallback.

- [ ] **Step 5: Remove the probe and restore the real `if:`**

Delete the `TEMPORARY payload probe` step and restore `rust-scoped`'s full `if:` from Task 5 Step 2.

- [ ] **Step 6: Commit**

```bash
git add .forgejo/workflows/ci.yml
git commit -m "ci: drop the payload probe — draft and edited both confirmed

Recorded in the spec §6.3. The probe existed because Forgejo has no
ready_for_review event and neither assumption had been checked against a live
payload."
```

Record the findings in the spec's §6.3 in the same commit.

---

## Task 7: Re-measure, and record what actually changed

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md` (§1.1 and §6.5)

- [ ] **Step 1: Take the branch out of draft and let the full jobs run**

The PR from Task 6 is already open. Push any pending commits and confirm `rust`, `rust-llvm` and `rust-slow` all run and go green.

- [ ] **Step 2: Pull the new durations, same method as §1.1**

```bash
TOK=$(grep -m1 -o 'token: [A-Za-z0-9]*' ~/.config/tea/config.yml | cut -d' ' -f2)
curl -s -H "Authorization: token $TOK" \
  "https://forge.daveynet.xyz/api/v1/repos/davey/redextape/actions/tasks?limit=20" \
 | jq -r '.workflow_runs[] | [.run_number,.name,
     ((.updated_at|sub("[+-][0-9]{2}:[0-9]{2}$";"Z")|fromdateiso8601)
    - (.run_started_at|sub("[+-][0-9]{2}:[0-9]{2}$";"Z")|fromdateiso8601))] | @tsv'
```

Compare `rust-llvm` against the 2.2–9.7m spread in §1.1. **One run is one sample.** If the new figure sits inside the old spread, say that it is not yet distinguishable from noise rather than reporting a ratio.

- [ ] **Step 3: Measure a scoped run's wall clock**

Push a test-only change to the branch while it is in draft, and time `rust-scoped` the same way. This is the number the whole exercise was for.

- [ ] **Step 4: Write both into the spec**

Add a `MEASURED AFTER` block to the top status section: before/after for `rust-llvm`, and the scoped-run figure with what it replaced. State the sample count. If a claim cannot be supported by the samples taken, write that instead of a ratio.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md
git commit -m "docs(ci): before/after for the scope-filter work

Sample counts stated. Where one run cannot distinguish a change from the old
spread, this says so rather than reporting a ratio off a single sample."
```

---

## Task 8: Branch protection on `main` (REQUIRES EXPLICIT GO-AHEAD)

> **AMENDED 2026-08-04 BY TASK 10.** This task was written as separable — "can land later or never."
> It is not separable any more. Task 10 deletes `scripts/land.sh`, which was carrying the guarantee
> that every commit on `main` passed the gate *before it existed*; branch protection with
> `enable_status_check` **and** `block_on_outdated_branch` is what replaces it. Until this lands,
> the property the README claims is weaker than it was.
>
> Two consequences for the steps below. **Step 3's lockout question is settled** — direct pushes to
> `main` are no longer a route anyone uses, so blocking them is the intent rather than a hazard; keep
> the verification, drop the "workflow decision for the user" framing. And **`block_on_outdated_branch`
> is now load-bearing, not a nicety** — required checks alone prove the PR head is green, not that it
> is green against current `main`.
>
> The go-ahead requirement stands: this still changes forge settings, and Step 2 still waits.

**This task changes the Forgejo repository's settings, not the working tree.** It is outward-facing and not reversible by `git`. **Do not run Step 2 without the user confirming in this session.**

**Files:** none. This is API state.

- [x] **Step 1: Learn the exact status-check context strings — DONE 2026-08-04 by the controller**

Read from the live API on `origin/main` (`a32e967`, a push run) and on PR #7's head (`57dedbc`, a
pull_request run):

```
                                    push run    PR run
ci / detect (<event>)               success     success
ci / linear-history (<event>)       success     success
ci / rust (<event>)                 success     success
ci / rust-llvm (<event>)            success     success
ci / rust-slow (<event>)            success     success
ci / web (<event>)                  pending     success     <- SKIPPED job, both runs
ci / docker (<event>)               pending     pending     <- SKIPPED job, both runs
```

Reproduce:

```bash
TOK=$(grep -m1 -o 'token: [A-Za-z0-9]*' ~/.config/tea/config.yml | cut -d' ' -f2)
SHA=$(git rev-parse origin/main)
curl -s -H "Authorization: token $TOK" \
  "https://forge.daveynet.xyz/api/v1/repos/davey/redextape/commits/$SHA/statuses?limit=50" \
  | jq -r '.[] | [.status, .context] | @tsv' | sort -u -k2
```

**The context format is `ci / <job> (<event>)` — the EVENT IS PART OF THE STRING.** `ci / rust (push)`
and `ci / rust (pull_request)` are different contexts. Requiring the `(push)` form would mean no pull
request could ever satisfy it. Since Task 10 makes PRs the only route to `main`, require the
`(pull_request)` forms.

**The set to require:**

```
ci / rust (pull_request)
ci / rust-llvm (pull_request)
ci / rust-slow (pull_request)
ci / linear-history (pull_request)
```

Excluded deliberately, each for its own reason:

- `detect` — only gates the others. If it fails they skip, and the required set is unsatisfied anyway.
- `docker` — never runs on a pull request by design (`github.event_name != 'pull_request'`).
- `web` — skipped until `web/package.json` lands. **Add it when that happens**; requiring it now would
  block every PR.
- `rust-scoped` (Task 5) — skipped on non-draft PRs, so requiring it would block every mergeable PR.
  It is explicitly non-gating.

**Do NOT use a glob.** `ci / * (pull_request)` looks tidy and would sweep in `docker` and
`rust-scoped`, deadlocking every PR.

- [ ] **Step 1b: SETTLE THE SKIPPED-JOB QUESTION BEFORE STEP 2. This decides whether Task 5's design is safe.**

The table above shows a skipped job reporting **`success` in one run and `pending` in another**:
`web` was skipped in both, and reported `success` on the PR run but `pending` on the push run. That
mapping is not cosmetic — it decides whether required status checks can be trusted at all here.
**ANSWERED 2026-08-04: skipped reports `success`, uniformly. The three-job required set does not
work and is replaced by a `gate` job. See the design spec §4.4.**

Task 5 makes `rust`, `rust-llvm` and `rust-slow` **skip on draft PRs**. So:

- If Forgejo records a skipped job as **pending** → a draft PR cannot satisfy the required set and
  cannot merge. Correct, and exactly what the design intends.
- If it records skipped as **success** → **a draft PR satisfies every required check having run only
  the non-gating scoped pre-check.** The merge button goes green on a PR that never ran the gauntlet.

The second outcome would defeat the whole design and is precisely the "gate quietly covers less than
it claims" defect this branch keeps finding.

**Task 6 is where this gets settled empirically** — it already opens a live draft PR, and this is now
the most important thing that PR is for. Do not create branch protection until Task 6 has answered it.
If skipped resolves to `success`, Task 5 needs a different mechanism (a job that runs on draft PRs and
deliberately FAILS, so the required context is red rather than absent) and this task waits on that.

- [ ] **Step 2: Create the protection — ONLY after the user confirms**

Show the user this exact command and the context strings from Step 1, and wait for a yes:

```bash
curl -s -X POST -H "Authorization: token $TOK" -H "Content-Type: application/json" \
  "https://forge.daveynet.xyz/api/v1/repos/davey/redextape/branch_protections" \
  -d '{
        "branch_name": "main",
        "enable_status_check": true,
        "status_check_contexts": ["<exact strings from Step 1>"],
        "block_on_outdated_branch": true
      }'
```

`block_on_outdated_branch` matters as much as the checks: without it a PR green against a stale base can merge into a `main` that has moved.

- [ ] **Step 3: Verify it took, and that it does not lock you out**

```bash
curl -s -H "Authorization: token $TOK" \
  "https://forge.daveynet.xyz/api/v1/repos/davey/redextape/branch_protections" \
  | grep -o '"branch_name":"[^"]*"\|"enable_status_check":[a-z]*'
```

Then confirm in the web UI that a direct `git push` to `main` — the route `scripts/land.sh` uses for the commits that do not go through a PR — still works. If protection blocks it, either add yourself to the push whitelist or accept that `land.sh` is retired in favour of PRs. **That is a workflow decision for the user, not the implementer.**

---

## Task 9: Investigate `rust-slow` — the job this plan optimised around

**ADDED MID-EXECUTION, 2026-08-04, by Davey's decision.** Asked whether Task 2 was still worth doing
at `T_llvm_repeat` = 50.1s, the answer was "yes, and look at `rust-slow` after."

**This task is an INVESTIGATION. It changes no behaviour.** It measures where the time goes and
prices the options. Any actual change earns its own spec and PR — `scripts/check-slow.sh`'s header
already records two reasons the tier stays on `cargo test` rather than nextest — one measured
(`--nocapture` implies `--test-threads 1`), one an explicitly unmeasured risk (the sweeps' memory
profile under concurrency) — and this is not a place to improvise past them.

**Why the plan missed it.** Tasks 1–8 optimise `rust-llvm`, which finished FIRST on every recent PR
run. `rust-slow` finished last:

```
run 57 (PR)  rust-slow 8.5m   rust  6.6m   rust-llvm 2.2m
run 56 (PR)  rust-slow 8.6m   rust  6.3m   rust-llvm 2.4m
run 53 (PR)  rust-slow 9.5m   rust 10.9m   rust-llvm 5.4m
```

It is the PR critical path, and nothing in Tasks 1–8 touches it.

**Files:**
- Create: `docs/superpowers/specs/2026-08-04-rust-slow-investigation.md`
- Read only: `scripts/check-slow.sh`, `.forgejo/workflows/ci.yml`

**Interfaces:**
- Produces: a findings document. No script or workflow changes.

- [ ] **Step 1: Establish what the job is actually made of**

`check-slow.sh` runs `cargo test --release --workspace -- --ignored --nocapture`. The whole workspace
is release-built to run **three** `#[ignore]` tests. Confirm that count and their locations:

```bash
cd /home/davey/projects/redextape
grep -rn '#\[ignore = "slow tier' crates --include='*.rs'
```

Expected — three, all in `redextape-core`:

```
crates/redextape-core/tests/tm_exhaustive_bank_safety.rs:258
crates/redextape-core/tests/tm_exhaustive_bank_safety.rs:313
crates/redextape-core/src/tm/asm.rs:1230
```

- [ ] **Step 2: Split the job's wall clock into build time and sweep time**

**This is the whole point of the task.** The hypothesis is that almost all of the 8.5m is the release
build rather than the sweeps — that is a HYPOTHESIS, and Step 4 must not repeat it as fact.

```bash
export CARGO_TARGET_DIR=/tmp/rt-slow
rm -rf "${CARGO_TARGET_DIR:?}"
bash -c 'TIMEFORMAT="BUILD-COLD %R s"; time cargo test --release --workspace --no-run'
bash -c 'TIMEFORMAT="SWEEP %R s";      time cargo test --release --workspace -- --ignored --nocapture'
```

`--no-run` builds every test binary without running anything, so `BUILD-COLD` is the build and
`SWEEP` is build-already-warm plus the three sweeps. Then repeat the second command on the now-warm
tree to get `SWEEP-WARM`, which is the sweeps close to alone.

Cap the memory. The exhaustive sweep enumerates ~200k `(program, encoding, width)` triples and this
repository has previously burned 60 GiB on an unbounded measurement:

```bash
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 -- <command>
```

- [ ] **Step 3: Check what CI's cache actually gives this job**

`rust-slow`'s cache key is `cargo-slow-${{ hashFiles('**/Cargo.lock') }}` with `restore-keys:
cargo-slow-`, and its `path:` includes the bare `target` directory. Read those lines in
`.forgejo/workflows/ci.yml` and record whether the release profile's artifacts are actually inside
the cached path, or whether the job rebuilds release from scratch every run despite the cache. **If
the cache is not covering the release build, that is the finding** — and it is a much cheaper fix
than anything touching the tier's contents.

- [ ] **Step 4: Write the findings document**

Create `docs/superpowers/specs/2026-08-04-rust-slow-investigation.md` recording:

- The three numbers from Step 2 (`BUILD-COLD`, `SWEEP`, `SWEEP-WARM`), with method and cache state,
  in the same shape §2.2 of the scope-filter design uses.
- Whether the hypothesis in Step 2 held. **If the sweeps turn out to dominate rather than the build,
  say so plainly** — that falsifies the premise this task was created on, and this repository's
  documents record falsified premises rather than quietly reframing them.
- The Step 3 cache finding.
- Options, priced, with none recommended without a number behind it. Candidates to consider, not a
  menu to pick from: making the release cache actually hit; splitting build from run so the build
  shares `rust`'s cache; running the tier on `main` only; leaving it exactly as it is.
- Explicitly: what this task did NOT investigate.

**Do not modify `scripts/check-slow.sh` or `ci.yml`.** Its header's two reasons for staying on
`cargo test` are measured claims; contradicting them requires its own measurement, which is not in
this task's scope.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-rust-slow-investigation.md
git commit -m "docs(ci): where rust-slow's 8.5 minutes actually go

The scope-filter plan optimised rust-llvm, which finished first on every
recent PR run. rust-slow finished last on two of the last three and is the
PR critical path. This measures it and prices the options; it changes
nothing."
```

---

## Task 10: Retire `scripts/land.sh` — PRs become the only route to `main`

**ADDED MID-EXECUTION, 2026-08-04, by Davey's decision:** *"I actually think we should remove land.sh
but ensure that we use PRs instead. I'd rather not land locally and we keep getting hung up on that."*

The plan anticipated this fork. Task 8 Step 3 said: "either add yourself to the push whitelist or
accept that `land.sh` is retired in favour of PRs. **That is a workflow decision for the user.**"
It is now made.

**Run this BEFORE Task 8.** Task 8's design changes as a result — see the amendment at its head.

### The two things this task must not lose

**1. `land.sh` was carrying a guarantee, and deleting it drops that guarantee unless Task 8 lands.**

`land.sh` ran the gate **on the merged tree, before the commit existed**, and refused to commit when
it failed. That is what made "every commit on `main` builds and passes CI by itself" a *property*
rather than a hope — the README says exactly that, in those words. A web-UI squash-merge inverts it:
the commit is created first and CI runs after.

The replacement is branch protection with **`enable_status_check`** *and*
**`block_on_outdated_branch`** together. Required checks make the PR head green; the outdated-branch
block makes that head current with `main`. Together they approximate "gated on the merged tree
before the commit exists" closely enough to keep the claim honest. Either one alone does not.

**So Task 8 stops being optional.** It was written as separable; it no longer is. This task's README
edit must not claim the property still holds until Task 8 has landed — write what is true at each
point, or land the two together.

**2. The reasoning record moves from the git object to the forge.**

`land.sh` prefilled the squash message with **every** branch commit message verbatim under a
`--- Squashed from N commits ---` marker. The README defends this: *"Losing the reasoning is not the
price of a tidy graph."*

Measured on this repository's actual history:

```
9a7db07  landed by land.sh        521 lines, 31,925 bytes   (every branch message, preserved)
a32e967  squash-merged PR #7       91 lines,  5,491 bytes   (a written PR body)
```

The PR body is the better *document*. But the intermediate commit messages are no longer in the git
object — they survive on the forge, on the PR page and under `refs/pull/N/head`. That is a real
dependency on `forge.daveynet.xyz` that the git history alone previously did not have.

**Say so in the README. Do not delete the sentence that promised otherwise and move on** — amend it
to describe what is now true, including the dependency. An honest downgrade beats a quiet one.

**Files:**
- Delete: `scripts/land.sh`
- Modify: `README.md` (the `## Conventions` section, roughly lines 187–215)
- Modify: `scripts/setup-dev.sh` (comment at :15, echo at :25)
- Modify: `docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md` (§1.3, §4.4)

**Do NOT modify:** `docs/superpowers/plans/2026-07-30-*.md`, `2026-07-31-*.md`, or any other dated
plan or spec that mentions `land.sh`. Those are historical records of what was done at the time.
Rewriting them would falsify history, which this repository does not do — it strikes and dates
claims instead.

- [ ] **Step 1: Confirm nothing else invokes it**

```bash
cd /home/davey/projects/redextape
grep -rn 'land\.sh' --exclude-dir=.git --exclude-dir=target --exclude-dir=.superpowers .
```

Expected live references: `README.md` (5), `scripts/setup-dev.sh` (2), `scripts/land.sh` itself.
Everything else is a dated plan doc and stays. **If a hook, workflow, or `Makefile` turns up, STOP
and report** — the plan's file list did not anticipate it.

- [ ] **Step 2: Delete the script**

```bash
git rm scripts/land.sh
```

Note in your report that this also removes the `--list` guard added in Task 2 (finding 7). That
guard was correct for a world where `land.sh` existed; it goes with the file, and no equivalent is
needed because nothing else forwards user arguments to the gate.

- [ ] **Step 3: Rewrite the README's `## Conventions` section**

Keep what is still true: `main` is linear, every commit is an atomic unit, feature branches land as
one squashed commit, and the three independent layers that enforce linearity
(`setup-dev.sh`'s `ff = only`, the remote's merge settings, CI's `linear-history` job). **The
three-layer paragraph survives intact — none of those layers was `land.sh`.**

Replace the `land.sh` mechanics with the PR flow: branch, push, open a PR, let CI run, merge with
squash in the web UI. Then address both points above explicitly:

- what makes "every commit on `main` passes CI by itself" true under this flow, and — until Task 8
  lands — that it is currently weaker than it was
- where the branch's reasoning now lives, and that this is a dependency on the forge

- [ ] **Step 4: Update `scripts/setup-dev.sh`**

Its `merge.ff = only` / `pull.ff = only` config **stays** — it still prevents a local merge commit
when updating a branch against `main`, which matters more under a PR flow, not less. Only the two
`land.sh` references change: the comment at :15 and the echo at :25.

- [ ] **Step 5: Update the design spec**

§1.3 documented the mixed workflow and is *historically* accurate — it describes what was true when
written. Add a dated note that the mixed route is closed, rather than rewriting the section.

§4.4 currently presents branch protection as "separable" and "recommended". Per point 1 above, it is
neither now. Update it, and remove the caveat about protection possibly blocking `land.sh`'s direct
pushes — that concern no longer exists.

- [ ] **Step 6: Verify**

```bash
bash -n scripts/setup-dev.sh && echo "setup-dev parses"
grep -rn 'land\.sh' --exclude-dir=.git --exclude-dir=target --exclude-dir=.superpowers . \
  | grep -v '^docs/superpowers/plans/2026-07-3'
```

Expected: the second command returns only the design spec's dated historical note, and nothing in
`README.md` or `scripts/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "build(scripts): retire land.sh — PRs are the only route to main

Landing locally and merging PRs were two routes to main with different
guarantees, and the difference kept surfacing: the scope-filter design had to
correct itself about which one was the real gate, Task 2 had to add a --list
guard so land.sh could not be tricked into landing unverified, and Task 8 had
to ask whether branch protection would lock the local route out. One route
removes all three questions.

TWO THINGS THIS COSTS, both now stated in the README rather than dropped:

land.sh ran the gate on the MERGED TREE BEFORE THE COMMIT EXISTED and refused
to commit on failure. A web-UI squash inverts that — commit first, CI after.
Branch protection with enable_status_check AND block_on_outdated_branch is what
restores it; until that lands, the property is weaker than the README claimed.

The squash message no longer carries every branch commit verbatim (521 lines on
9a7db07) — the PR body does the job in 91 (a32e967), better as prose, but the
intermediate messages now live on the forge rather than in the git object.

The three layers that keep main linear are untouched: none of them was land.sh."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1.1 measured durations | Task 1 (method), Task 7 (after) |
| §1.2 filter falsified | recorded in spec; motivates Task 4/5, no code |
| §1.3 how work reaches `main` | Task 8 Step 3 (the `land.sh` interaction) |
| §2.2(a) `rust-llvm` repeats `rust` | Tasks 2, 3 |
| §2.2(b) doubled workspace suite | Task 1 measures; Task 3 Step 3 acts or drops |
| §3.1 no `ready_for_review` | Task 5 Step 1, Task 6 |
| §3.2 no branch protection | Task 8 |
| §3.3 nextest predicates | Task 4 |
| §4.1 `--llvm-only` | Task 2 |
| §4.2 `check-scoped.sh` | Task 4 |
| §4.3 CI wiring | Task 5 |
| §4.4 branch protection | Task 8 |
| §6.1–§6.5 verification | Tasks 1, 2 (Steps 5–7), 4 (Steps 3–7), 6, 7 |
| §7.2 force-push range | Task 4 Step 7 |

No gaps.

**Placeholder scan:** Task 3 Step 3 is conditional on a measurement rather than specified — deliberately, and it names the exact threshold and says to make it Task 3b rather than improvising a design inside a step. Task 8 Step 2's `status_check_contexts` is filled from Step 1's output because the strings cannot be known before the API is read. Both are gated, not vague.

**Type consistency:** `check_tiers`, `selects`, `do_leg`, `test_cfg`, `ensure_llvm_prefix` are defined once in Task 2 and referenced with those names in Task 2 Step 2. `add_term` / `add_doc_pkg` / `filterset` / `doc_pkgs` / `need_lint` / `force_full` are defined and used only within Task 4's single script. Tier names `both|base|llvm` are consistent across the table, `check_tiers`, `selects` and Task 2 Step 6.
