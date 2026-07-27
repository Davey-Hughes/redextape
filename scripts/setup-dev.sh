#!/usr/bin/env bash
# One-time local setup for a fresh clone. Idempotent — safe to re-run.
#
# Exists because some project conventions live in `.git/config`, which is NOT tracked and therefore
# does not survive a clone. Documenting them in the README is not enough: a convention that depends on
# every contributor remembering to configure it is a convention that silently stops holding.
#
#   scripts/setup-dev.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# LINEAR HISTORY. `main` has no merge commits and is kept that way: `ff = only` makes a
# non-fast-forward merge or pull FAIL rather than quietly creating one. Rebase a feature branch onto
# main before merging it.
#
# This is convenience, not enforcement — a local setting cannot bind anyone. The actual gate is CI's
# `linear-history` job, which rejects a merge commit on main regardless of how it got there.
git config merge.ff only
git config pull.ff only
echo "==> git: merge.ff=only, pull.ff=only (linear history)"

if command -v pre-commit >/dev/null 2>&1; then
  pre-commit install
  echo "==> pre-commit hooks installed (cargo fmt + clippy)"
else
  echo "==> pre-commit not found; skipping hook install (pip install pre-commit)" >&2
fi

echo
echo "setup complete. Before merging, run: scripts/check-all.sh"
