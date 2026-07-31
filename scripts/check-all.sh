#!/usr/bin/env bash
# The full feature-matrix gate: every config the crate supports, in one command.
#
# CI invokes this same script (.forgejo/workflows/ci.yml), so the local and CI gates cannot drift.
# The pre-commit hooks deliberately do NOT run it — they stay fast (fmt + clippy); this is the
# before-a-merge check.
#
#   scripts/check-all.sh              # everything, including the LLVM configs
#   scripts/check-all.sh --no-llvm    # skip LLVM (no toolchain installed)
#
# This gate runs the FAST test tier only. The slow tier (exhaustive sweeps, marked
# `#[ignore = "slow tier: ..."]`) has its own script and its own CI job: scripts/check-slow.sh.
# Kept separate deliberately — a merge gate that takes minutes stops being run before merges.
set -euo pipefail

run() { echo; echo "==> $*"; "$@"; }
usage() { echo "usage: scripts/check-all.sh [--no-llvm]" >&2; exit 2; }

# Parse up front so a typo (`--no-llvmm`) fails immediately rather than silently falling through to
# a full run — a flag that quietly does the opposite of what was asked is the same class of bug as a
# gate that quietly covers less than it claims.
no_llvm=0
case "${1:-}" in
  "")        ;;
  --no-llvm) no_llvm=1 ;;
  *)         echo "error: unknown argument: $1" >&2; usage ;;
esac
[ "$#" -le 1 ] || { echo "error: too many arguments" >&2; usage; }

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
# finding. Every config below therefore pairs nextest with an explicit `cargo test --doc` AT THE SAME
# FEATURE FLAGS. Keep the pairing if a config is ever added.
#
# There is one doctest in the tree today, `ty::show` (crates/redextape-core/src/ty.rs) — the paired
# run is what actually executes it, since nextest alone cannot. Its value only grows as more `///`
# examples land.
test_cfg() { run cargo nextest run "$@"; run cargo test "$@" --doc; }

# Every config gets clippy AND tests; a config that is built but never tested is a blind spot. The
# default (`cranelift`) config is covered by the --workspace pair.
#
# `--features llvm` is additive to the default `cranelift`, so it is NOT a distinct build from
# `--features "cranelift llvm"`; the genuinely LLVM-only config is --no-default-features --features llvm.
run cargo fmt --all --check
run cargo clippy --workspace --all-targets -- -D warnings
test_cfg --workspace
run cargo build -p redextape-native --no-default-features
run cargo clippy -p redextape-native --no-default-features --all-targets -- -D warnings
test_cfg -p redextape-native --no-default-features

if [ "$no_llvm" -eq 1 ]; then
  echo; echo "==> skipping the LLVM configs (--no-llvm)"; exit 0
fi

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
llvm_probe_paths="/opt/homebrew/opt/llvm /usr/lib/llvm-22 /usr/local/opt/llvm /usr"
# An explicit LLVM_SYS_221_PREFIX is deliberately NOT version-checked: setting it is a statement of
# intent, and a wrong one already fails loudly in llvm-sys. The guard below is for the GUESS.
if [ -z "${LLVM_SYS_221_PREFIX:-}" ]; then
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

run cargo clippy -p redextape-native --features llvm --all-targets -- -D warnings
test_cfg -p redextape-native --features llvm
run cargo clippy -p redextape-native --no-default-features --features llvm --all-targets -- -D warnings
test_cfg -p redextape-native --no-default-features --features llvm

echo; echo "all configs green"
