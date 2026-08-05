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
# everything for every later test-only push. Scoping on the PUSH increment is what would help, and
# that is only sound for a check nobody merges on.
#
# BUT CI CANNOT GIVE THIS SCRIPT A PUSH INCREMENT, measured 2026-08-04 on PR #8 run 60:
# `github.event.before` is EMPTY on Forgejo's synchronize event, and `base.sha` is the merge-base
# with `main`. So the `rust-scoped` job always passes an unresolvable range and this script always
# takes the whole-branch fallback below. Run it by hand with a real range (`main..HEAD`, or any two
# resolvable commits) and the narrow paths do work — they are exercised by the local case, not the
# CI one. See the `rust-scoped` job's header for what that leaves the job buying.
#
# THE DEFAULT IS ALWAYS TO RUN MORE. A path this script has not been taught escalates to
# `check-all.sh --no-llvm`; it never becomes a skip. Permissive scoping — skipping instead of
# escalating — is how a gate ends up covering less than its name claims.
#
# WHY binary() AND NOT rdeps() FOR TESTS: Cargo test and example targets are LEAVES — nothing in the
# build graph depends on them — so a change confined to them provably cannot alter another target's
# result. rdeps() is the crate-graph answer and it buys almost nothing here: redextape-core is one
# 23k-line crate that all three others depend on, so rdeps(redextape-core) is the whole workspace.
#
# A PUSH THAT ONLY DELETES A TEST FILE is a known spurious-red case, not a bug. The deleted path
# still matches the `crates/*/tests/*` case below and still produces a `binary(=<stem>)` term, but
# the binary itself no longer exists to build, so the filterset selects zero tests. cargo-nextest
# 0.9.140's `--no-tests` flag defaults to `auto`, which fails a run that selects nothing rather than
# passing it silently — so a test-file deletion exits this script non-zero. That is fail-safe (an
# unexpectedly empty run should not read as an unexamined pass) and is accepted as the cost of that
# safety, not something this script tries to special-case.
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
# NOTE ON `...`: the split above reduces `a...b` to the same base/head as `a..b`, and the `git diff`
# below is then a DIRECT two-tree diff — not the merge-base diff `...` normally means. On a divergent
# `main` that shows extra files rather than missing ones, so it errs toward checking more, which is
# this script's whole disposition. CI passes a two-dot range (`github.event.before..HEAD`), so the
# case only arises when someone types `...` by hand on a dev box.
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
#
# `pkg` below is the crate's DIRECTORY name under `crates/`, used directly as its cargo package
# name for `package(=$pkg)` / `rdeps(=$pkg)`. Holds for all four crates today (each `[package].name`
# in Cargo.toml matches its directory) but is not something Cargo enforces — undocumented until now.
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
        */*)   add_term "package(=$pkg)" ;;
        *.rs)  add_term "binary(=${tail%.rs})" ;;
        *)     add_term "package(=$pkg)" ;;
      esac ;;
    crates/*/examples/*|crates/*/benches/*)
      # Nothing to RUN: `clippy --workspace --all-targets` below builds examples and benches.
      need_lint=1 ;;
    crates/*/src/*|crates/*/build.rs|crates/*/Cargo.toml)
      rest="${f#crates/}"; pkg="${rest%%/*}"
      need_lint=1; add_term "rdeps(=$pkg)"; add_doc_pkg "$pkg" ;;
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

# `${#filterset[@]}` is a length expansion, not a value expansion — it is safe under `set -u` on
# any bash, and it is what guards the `"${filterset[@]}"` value expansion in the branch below.
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
