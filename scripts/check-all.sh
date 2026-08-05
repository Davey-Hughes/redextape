#!/usr/bin/env bash
# The full feature-matrix gate: every config the crate supports, in one command.
#
# CI invokes this same script (.forgejo/workflows/ci.yml), so the local and CI gates cannot drift.
# The pre-commit hooks deliberately do NOT run it — they stay fast (fmt + clippy); this is the
# before-a-merge check.
#
#   scripts/check-all.sh               # everything, including the LLVM configs
#   scripts/check-all.sh --no-llvm     # skip LLVM (no toolchain installed)
#   scripts/check-all.sh --llvm-only   # ONLY the LLVM configs — NOT a full gate on its own
#   scripts/check-all.sh --list        # print the legs the mode selects; run nothing
#
# --llvm-only exists because CI's `rust-llvm` job invoked this script with no flag, and no flag is
# `--no-llvm` PLUS the LLVM configs by construction — so that job recompiled every non-LLVM config
# the `rust` job had already run, from a different cache key. See
# docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md §2.2.
#
# This gate runs the FAST test tier only. The slow tier (exhaustive sweeps, marked
# `#[ignore = "slow tier: ..."]`) has its own script and its own CI job: scripts/check-slow.sh.
# Kept separate deliberately — a merge gate that takes minutes stops being run before merges.
set -euo pipefail

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
      [ "$mode" = full ] || [ "$mode" = base ] \
        || { echo "error: --no-llvm and --llvm-only are exclusive" >&2; usage; }
      mode=base; shift ;;
    --llvm-only)
      [ "$mode" = full ] || [ "$mode" = llvm ] \
        || { echo "error: --no-llvm and --llvm-only are exclusive" >&2; usage; }
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
# exists to catch. `--list` makes the property checkable from outside the script; check_legs() below
# catches the two things --list cannot: a row tagged with a tier no mode selects, and a row tagged
# with a kind do_leg does not dispatch on.
#
# ROW ORDER IS RUN ORDER. Cheap always-first legs (fmt, clippy) stay at the top of their tier so a
# formatting slip fails in seconds rather than after a feature matrix.
#
# Every config gets clippy AND tests; a config that is built but never tested is a blind spot. The
# default (`cranelift`) config is covered by the --workspace pair.
#
# `--features llvm` is additive to the default `cranelift`, so it is NOT a distinct build from
# `--features "cranelift llvm"`; the genuinely LLVM-only config is --no-default-features --features llvm.
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

# A row tagged with a tier no mode selects would vanish from every run while still LOOKING covered.
# Empty tiers are the same defect one step earlier: --llvm-only that runs nothing still exits 0.
#
# A row tagged with a kind do_leg does not dispatch on passes --list and lets whichever mode does
# NOT include that row finish green; the typo only fails when the other mode reaches the row, after
# everything before it has already run. Validated against the same set do_leg dispatches on.
check_legs() {
  local row tier kind n_base=0 n_llvm=0
  for row in "${LEGS[@]}"; do
    tier="${row%%|*}"; kind="${row#*|}"; kind="${kind%%|*}"
    case "$tier" in
      both) ;;
      base) n_base=$((n_base + 1)) ;;
      llvm) n_llvm=$((n_llvm + 1)) ;;
      *) echo "error: leg tagged with unknown tier '$tier': $row" >&2; exit 1 ;;
    esac
    case "$kind" in
      fmt|clippy|build|test|probe|wasmprobe|wasm) ;;
      *) echo "error: leg tagged with unknown kind '$kind': $row" >&2; exit 1 ;;
    esac
  done
  [ "$n_base" -gt 0 ] || { echo "error: no base-tier legs — --no-llvm would cover nothing" >&2; exit 1; }
  [ "$n_llvm" -gt 0 ] || { echo "error: no llvm-tier legs — --llvm-only would cover nothing" >&2; exit 1; }
}
check_legs

selects() {
  case "$1" in
    both) return 0 ;;
    base) [ "$mode" = full ] || [ "$mode" = base ] ;;
    llvm) [ "$mode" = full ] || [ "$mode" = llvm ] ;;
    *)    echo "error: leg tagged with unknown tier '$1'" >&2; exit 1 ;;
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

for row in "${LEGS[@]}"; do
  tier="${row%%|*}"; rest="${row#*|}"; kind="${rest%%|*}"; argstr="${rest#*|}"
  selects "$tier" || continue
  read -r -a leg_args <<< "$argstr"
  # Guarded expansion: with `set -u`, "${leg_args[@]}" on an empty array aborts as an unbound
  # variable on bash < 4.4 — that boundary is a documented bash fact (bash's own changelog), not a
  # guess. What is untested is not the version number but whether this script actually runs, let
  # alone is supported, under bash that old: this is an inference from the LLVM probe's
  # /opt/homebrew/opt/llvm entry above (which suggests a macOS/Homebrew, bash-3.2-vintage target),
  # and "older bash" below names that untested support claim, not the 4.4 boundary itself.
  do_leg "$kind" ${leg_args[@]+"${leg_args[@]}"}
done

echo
case "$mode" in
  full) echo "all configs green" ;;
  base) echo "base configs green — the LLVM configs were SKIPPED (--no-llvm)" ;;
  llvm) echo "llvm configs green — the base configs were SKIPPED (--llvm-only), so this is NOT a full gate" ;;
esac
