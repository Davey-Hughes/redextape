#!/usr/bin/env bash
# The SLOW test tier: exhaustive sweeps and long-running verification that are too expensive to run
# on every commit, but are the strongest evidence the project has.
#
# The tier is defined by `#[ignore = "slow tier: ..."]`. That marker was chosen over a cargo feature
# or an env-var check for one reason: `cargo test` PRINTS the ignored count, so a skipped slow test is
# visible in every default run rather than silently absent. An env-var guard that returns early would
# make a skipped sweep look like a passing one — the same class of defect as a gate that quietly
# covers less than its name claims.
#
#   scripts/check-slow.sh            # the slow tier ONLY (what CI's slow job runs)
#   scripts/check-slow.sh --all      # fast tier + slow tier, i.e. everything
#
# Slow tests rot if nothing runs them, so CI runs this on `main` (.forgejo/workflows/ci.yml, the
# `rust-slow` job) in its own job — a slow sweep must never delay the fast signal, the same reasoning
# the `rust-llvm` job already uses.
set -euo pipefail

run() { echo; echo "==> $*"; "$@"; }
usage() { echo "usage: scripts/check-slow.sh [--all]" >&2; exit 2; }

# Parse up front so a typo fails immediately rather than silently running the wrong tier.
mode=ignored
case "${1:-}" in
  "")     ;;
  --all)  mode=include-ignored ;;
  *)      echo "error: unknown argument: $1" >&2; usage ;;
esac
[ "$#" -le 1 ] || { echo "error: too many arguments" >&2; usage; }

# `--release` is not optional here: the sweeps simulate millions of TM steps, and a debug build makes
# the tier take hours rather than minutes. Correctness is identical — the simulator has no
# debug-only behaviour — so this trades nothing away.
if [ "$mode" = ignored ]; then
  echo "==> slow tier only (use --all to include the fast tier)"
  run cargo test --release --workspace -- --ignored --nocapture
else
  echo "==> fast tier + slow tier"
  run cargo test --release --workspace -- --include-ignored --nocapture
fi

echo; echo "slow tier green"
