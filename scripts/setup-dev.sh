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
# non-fast-forward merge or pull FAIL rather than quietly creating one.
#
# Feature branches land as ONE squashed commit via a PR, squash-merged in the Forgejo web UI —
# that is now the only route to main. `ff = only` does not conflict with that: it governs local
# merges/pulls, not the remote's squash-merge, and matters more here than before, since there is no
# local landing step left to refuse a stale main on your behalf.
#
# This is convenience, not enforcement — a local setting cannot bind anyone. Two things that do: the
# remote allows only squash and fast-forward merges, and CI's `linear-history` job rejects a merge
# commit on main regardless of how it got there.
git config merge.ff only
git config pull.ff only
echo "==> git: merge.ff=only, pull.ff=only (linear history; land via a squash-merged PR)"

# cargo-nextest is the test runner `scripts/check-all.sh` requires. Installed here rather than left to
# the README because that gate HARD-FAILS without it — deliberately, so the runner is the same
# everywhere — which makes a fresh clone unable to run the merge check until this has been done.
if cargo nextest --version >/dev/null 2>&1; then
  echo "==> cargo-nextest already installed ($(cargo nextest --version | head -1))"
elif command -v brew >/dev/null 2>&1; then
  brew install cargo-nextest
  echo "==> cargo-nextest installed (brew)"
else
  cargo install cargo-nextest --locked
  echo "==> cargo-nextest installed (cargo install)"
fi

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

# wasm-pack drives `scripts/check-all.sh`'s BROWSER tier, which hard-fails without it for the same
# reason as the two above. That tier is what proves the wasm boundary actually works — the wasm32
# rows only prove it builds — so a fresh clone should be able to run it.
#
# CHROME IS NOT INSTALLED HERE, and the asymmetry is deliberate. A test runner and a compilation
# target are development tooling; a web browser is a system application, and silently installing one
# is not a setup script's business. The gate names what it needs and how to skip it
# (`--no-browser`), which is the honest division: this script removes the friction it owns.
if command -v wasm-pack >/dev/null 2>&1; then
  echo "==> wasm-pack already installed ($(wasm-pack --version | head -1))"
elif command -v brew >/dev/null 2>&1; then
  brew install wasm-pack
  echo "==> wasm-pack installed (brew)"
else
  cargo install wasm-pack --locked
  echo "==> wasm-pack installed (cargo install)"
fi

# The tree-sitter CLI regenerates the committed parsers under `grammars/`, which is what
# `scripts/check-all.sh`'s grammar leg checks against, and that gate HARD-FAILS without it — same
# reason cargo-nextest and wasm-pack are installed above rather than left to the README.
#
# INSTALLED REPO-LOCAL (`.tools/`, git-ignored) RATHER THAN VIA `command -v`, and that is deliberate,
# not an inconsistency with the tools above. The grammars are generated at language ABI 15, which
# needs the pinned, released v0.25.10 CLI specifically — NOT the newest numbered release (see
# scripts/install-treesitter-ci.sh for why the pin sits below it, and
# docs/superpowers/specs/2026-08-20-tree-sitter-grammars-design.md §8.1 for the ABI measurement) — a
# `tree-sitter` already on this machine's `$PATH` is just as likely to be Arch's `tree-sitter-cli-git`,
# built off `master` and self-reporting "0.27.0", which regenerates a different `.minor_version` and
# reddens the grammar leg. `ensure_treesitter` in scripts/check-all.sh prefers this exact directory
# over `$PATH` for the same reason. Calling the same pinned installer CI uses (a checksummed download
# — see scripts/install-treesitter-ci.sh for why) means a developer regenerates with the identical
# binary CI checks against, not a coincidentally-similar one.
if .tools/tree-sitter --version 2>/dev/null | grep -q ' 0\.25\.10$'; then
  echo "==> tree-sitter already installed (.tools/tree-sitter, $(.tools/tree-sitter --version))"
else
  mkdir -p .tools
  scripts/install-treesitter-ci.sh .tools
fi

# The browser tier also needs a Chrome that wasm-pack can find. Reported, never installed — see above.
if [ -n "${CHROME_PATH:-}" ] || command -v google-chrome >/dev/null 2>&1 \
  || [ -x /usr/bin/google-chrome-stable ] || [ -x /usr/bin/chromium ] \
  || [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  echo "==> Chrome found (scripts/check-all.sh's browser tier can run)"
else
  echo "==> no Chrome found; scripts/check-all.sh's browser tier will fail — install Chrome, or pass --no-browser" >&2
fi

# The web tree imports generated TypeScript from `web/bindings/`, which is gitignored — so a fresh
# clone does not typecheck, and an editor's language server reports unresolved imports, until this has
# run once. `pnpm run typecheck` runs it too; doing it here means the tree is coherent before anyone
# opens it.
#
# GUARDED ON `pnpm`, NOT ON `web/node_modules`, and the difference is the whole point of the step. This
# script never runs `pnpm install`, so on the fresh clone this block exists to serve that directory does
# not exist — the guard would skip the block in exactly the case it was written for, and fire only on a
# re-run, after someone had already done the thing that made it unnecessary. `pnpm run build:bindings`
# does not read `node_modules` at all: it shells out to `cargo`, which the nextest block above has
# already established, so pnpm's presence is the real precondition and is what is tested. Same shape as
# every other optional block in this file.
#
# NON-FATAL, WHICH THE BLOCKS ABOVE ARE NOT. Those abort on a missing hard precondition of
# `scripts/check-all.sh` — no nextest, no wasm32 target, no pinned tree-sitter — and aborting is the
# honest answer to an environment that cannot run the gate. This one is a BUILD, and a build fails for
# reasons that are not the environment being wrong: no network on a first clone, `ts-rs` not yet in the
# cargo registry cache. Under `set -euo pipefail` that would kill the script before `pre-commit install`
# below, leaving a clone with no hooks because a download timed out. Reported loudly instead of
# swallowed: unresolved `../bindings/` imports are the symptom, and this names the cause.
if command -v pnpm >/dev/null 2>&1; then
  echo "==> generating wire-type bindings (web/bindings)"
  if (cd web && pnpm run build:bindings); then
    echo "==> wire-type bindings generated (web/bindings)"
  else
    echo "==> wire-type bindings FAILED to generate; web/ will not typecheck until 'cd web && pnpm run build:bindings' succeeds" >&2
  fi
else
  echo "==> pnpm not found; skipping wire-type bindings (web/ will not typecheck until 'cd web && pnpm run build:bindings' has run)" >&2
fi

if command -v pre-commit >/dev/null 2>&1; then
  pre-commit install
  echo "==> pre-commit hooks installed (9: control bytes, citations, doc figures, shared docs, lua, cargo fmt, clippy, biome, web typecheck)"
else
  echo "==> pre-commit not found; skipping hook install (pip install pre-commit)" >&2
fi

echo
echo "setup complete. Before merging, run: scripts/check-all.sh"
