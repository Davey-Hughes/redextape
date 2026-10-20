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
# Slow tests rot if nothing runs them, so CI runs this (.forgejo/workflows/ci.yml, the `rust-slow`
# job) on every push to `main`, every `v*` tag, `workflow_dispatch`, AND every push to a non-draft pull
# request (its `if:` includes `github.event_name != 'pull_request' || !github.event.pull_request.draft`)
# — so a green PR always describes the head commit before merge. A draft PR gets `rust-scoped` instead.
# It runs in its own job — a slow sweep must never delay the fast signal, the same reasoning the
# `rust-llvm` job already uses.
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
#
# `cargo test`, NOT cargo-nextest AS THE FAST TIER USES, DELIBERATELY. Two reasons, and neither is
# inertia. First, `--nocapture` is load-bearing here: a sweep that prints progress is the difference
# between a long job and a silent one, and nextest's `--no-capture` implies `--test-threads 1`, so
# adopting it would serialise the very thing nextest parallelises. Second, these sweeps' peak memory is
# known only under a serial runner, and running them concurrently changes it in a way nobody has
# measured. Converting this tier starts with that measurement.
if [ "$mode" = ignored ]; then
  echo "==> slow tier only (use --all to include the fast tier)"
  run cargo test --release --workspace -- --ignored --nocapture
else
  echo "==> fast tier + slow tier"
  run cargo test --release --workspace -- --include-ignored --nocapture
fi

echo; echo "slow tier green"
