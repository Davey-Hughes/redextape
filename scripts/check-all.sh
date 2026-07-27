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

# Every config gets clippy AND tests; a config that is built but never tested is a blind spot. The
# default (`cranelift`) config is covered by the --workspace pair.
#
# `--features llvm` is additive to the default `cranelift`, so it is NOT a distinct build from
# `--features "cranelift llvm"`; the genuinely LLVM-only config is --no-default-features --features llvm.
run cargo fmt --all --check
run cargo clippy --workspace --all-targets -- -D warnings
run cargo test --workspace
run cargo build -p redextape-native --no-default-features
run cargo clippy -p redextape-native --no-default-features --all-targets -- -D warnings
run cargo test -p redextape-native --no-default-features

if [ "$no_llvm" -eq 1 ]; then
  echo; echo "==> skipping the LLVM configs (--no-llvm)"; exit 0
fi

# llvm-sys locates LLVM via a version-specific variable. Honor an existing setting; otherwise probe
# the usual locations. If broadening the supported LLVM range later, derive the variable NAME from
# the selected inkwell feature rather than hardcoding 221.
if [ -z "${LLVM_SYS_221_PREFIX:-}" ]; then
  for p in /opt/homebrew/opt/llvm /usr/lib/llvm-22 /usr/local/opt/llvm; do
    if [ -x "$p/bin/llvm-config" ]; then export LLVM_SYS_221_PREFIX="$p"; break; fi
  done
fi
if [ -z "${LLVM_SYS_221_PREFIX:-}" ]; then
  echo "error: no LLVM 22 found; set LLVM_SYS_221_PREFIX or pass --no-llvm" >&2; exit 1
fi
echo "==> using LLVM at $LLVM_SYS_221_PREFIX"

run cargo clippy -p redextape-native --features llvm --all-targets -- -D warnings
run cargo test -p redextape-native --features llvm
run cargo clippy -p redextape-native --no-default-features --features llvm --all-targets -- -D warnings
run cargo test -p redextape-native --no-default-features --features llvm

echo; echo "all configs green"
