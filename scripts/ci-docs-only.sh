#!/usr/bin/env bash
# Say whether a commit range changes only paths under docs/.
#
#   scripts/ci-docs-only.sh <base> <head>   # prints `true` or `false`, exit 0
#   scripts/ci-docs-only.sh --self-test     # prove the classifier still classifies
#
# CI's `detect` job (.forgejo/workflows/ci.yml) runs the self-test and then this, for a pull request into
# `main` only, and publishes the answer as `docs_only`: when it is `true` the Rust and web jobs are skipped
# and `gate` does not require them. A push to `main` is filtered by the workflow's `paths-ignore:
# ["docs/**"]` instead, the same definition. See docs/superpowers/specs/2026-10-27-docs-only-ci-design.md.
#
# **DOCS-ONLY MEANS EVERY CHANGED PATH IS UNDER docs/, AND NOTHING WIDER.** Nothing those jobs run reads
# docs/, and the checks that do read it (text bytes, citations, attributions, doc figures, shared docs)
# are in `linear-history`, which still runs. Markdown elsewhere is not docs here: `LICENSE.md` feeds the
# `web` job's licence check through `web/scripts/licences.ts`, and a README is no safer by its extension.
#
# **IT FAILS CLOSED.** Anything it cannot establish prints `false`, which runs everything: a base or head
# that does not resolve (a first push's all-zero `before`), no merge base, an empty diff. A wrong `false`
# costs one full run; a wrong `true` lets a code change merge untested.
#
# **THE DIFF IS FROM THE MERGE BASE**, so a pull request is judged by its own changes and not by what has
# landed on main since it branched. That is sound because what it skips is the merge base's code: a commit
# on `main`, whose tree passed CI as the pull request that made it (`block_on_outdated_branch` keeps a
# squash merge's tree the tree that PR tested) or, if that PR was docs-only, is its own merge base's tree
# plus docs. It holds only when the base is `main`, which is why `detect` asks about no other base.
#
# **`--no-renames`, BECAUSE A RENAME LISTS ONLY ITS DESTINATION OTHERWISE.** Moving `crates/x.rs` to
# `docs/x.rs` would read as one path under docs/ and pass, with the code gone.
#
# `check-scoped.sh` has its own `docs/*|*.md|LICENSE*` arm, and it answers a different question: which
# parts of the Rust tier a draft needs, where `LICENSE.md` really is irrelevant. Both stay.
set -euo pipefail

# **THE ONE CLASSIFIER.** The real run and `--self-test` both call this, so the self-test exercises it
# rather than a paraphrase that could drift into agreeing with a broken one.
classify() {
  local base head merge path list verdict=false
  if ! base=$(git rev-parse --verify --quiet "$1^{commit}") \
     || ! head=$(git rev-parse --verify --quiet "$2^{commit}") \
     || ! merge=$(git merge-base "$base" "$head" 2>/dev/null); then
    echo false
    return
  fi
  # NUL-delimited, as `check-text-bytes.sh` reads `git ls-files`: `--name-only` C-quotes an unusual path,
  # and a quoted `"docs/caf\303\251.md"` would not match `docs/*`. That direction is only a needless full
  # run, but `-z` makes the list exactly the paths.
  #
  # THE LIST GOES THROUGH A FILE SO `git diff`'S EXIT STATUS CAN BE READ: a process substitution drops it,
  # and a diff that failed partway must be `false`, not a judgement of whatever it printed first. A NUL
  # list cannot be held in a variable instead (bash drops NUL from `$(...)`).
  list=$(mktemp)
  if git diff --name-only --no-renames -z "$merge" "$head" > "$list" 2>/dev/null; then
    while IFS= read -r -d '' path; do
      case "$path" in
        docs/*) verdict=true ;;
        *) verdict=false; break ;;
      esac
    done < "$list"
  else
    echo "ci-docs-only.sh: git diff $merge $head failed, so the range is not docs-only" >&2
  fi
  rm -f "$list"
  echo "$verdict"
}

# Run `classify` on `$3..$4` in the current repository and fail the self-test unless it printed `$2`.
expect() {
  local name="$1" want="$2" range_base="$3" range_head="$4" got
  got=$(classify "$range_base" "$range_head")
  if [ "$got" != "$want" ]; then
    echo "self-test FAILED: $name: expected $want, got $got" >&2
    exit 1
  fi
}

# Commit, on a detached HEAD at `$1`, whatever the rest of the arguments do to the tree, and print the
# new commit. Each case starts from the same base, so no case sees another's change.
#
# **A CASE WHOSE CHANGE OR COMMIT FAILS MUST FAIL THE SELF-TEST, NOT PASS IT.** This runs inside `$(...)`,
# where bash does not apply `set -e`, so without the explicit checks a failed step would print `$from`
# itself, the case would compare the base with itself, and every case expecting `false` would pass without
# testing anything.
commit_from() {
  local from="$1" made
  shift
  git checkout -q --detach "$from" \
    && "$@" \
    && git add -A \
    && git commit -q -m case \
    && made=$(git rev-parse HEAD) \
    && [ "$made" != "$from" ] \
    || { echo "self-test FAILED: a case could not make its commit from $from: $*" >&2; return 1; }
  echo "$made"
}

self_test() {
  # As in `check-text-bytes.sh`: not `local`, so the trap can still expand it after this function
  # returns, and `${dir:?}` so a set-but-empty value aborts rather than deleting from the root.
  dir=$(mktemp -d)
  trap 'rm -rf "${dir:?}"' EXIT
  (
    cd "$dir"
    # The developer's own git settings stay out of the throwaway repository: a global `commit.gpgsign` or
    # hook path would make a case's commit fail, or behave unlike CI's.
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    export GIT_AUTHOR_NAME=self-test GIT_AUTHOR_EMAIL=self-test@invalid
    export GIT_COMMITTER_NAME=self-test GIT_COMMITTER_EMAIL=self-test@invalid
    git init -q .
    mkdir -p crates docs
    echo 'fn x() {}' > crates/x.rs
    echo a > docs/a.md
    echo readme > README.md
    echo licence > LICENSE.md
    git add -A
    git commit -q -m base
    local base c
    base=$(git rev-parse HEAD)

    c=$(commit_from "$base" sh -c 'echo b >> docs/a.md')
    expect "docs edit" true "$base" "$c"

    c=$(commit_from "$base" sh -c 'echo n > docs/new.md && rm docs/a.md')
    expect "docs add + delete" true "$base" "$c"

    c=$(commit_from "$base" sh -c 'echo b >> docs/a.md && echo "// y" >> crates/x.rs')
    expect "docs + code" false "$base" "$c"

    c=$(commit_from "$base" sh -c 'echo more >> README.md')
    expect "top-level markdown" false "$base" "$c"

    c=$(commit_from "$base" sh -c 'echo more >> LICENSE.md')
    expect "licence" false "$base" "$c"

    c=$(commit_from "$base" sh -c 'mkdir docsite && echo s > docsite/a && echo d > docs.md')
    expect "lookalike paths" false "$base" "$c"

    c=$(commit_from "$base" git mv crates/x.rs docs/x.rs)
    expect "rename into docs" false "$base" "$c"

    c=$(commit_from "$base" sh -c 'echo s > "docs/with space.md"')
    expect "path with a space" true "$base" "$c"

    expect "no change" false "$base" "$base"

    expect "unresolvable base (none)" false none "$base"
    expect "unresolvable base (all zeros)" false 0000000000000000000000000000000000000000 "$base"

    # A PR branch that only touches docs/, against a main that has since changed code: the PR's own
    # changes are what count, so the merge-base diff must leave main's change out.
    local pr main
    pr=$(commit_from "$base" sh -c 'echo b >> docs/a.md')
    main=$(commit_from "$base" sh -c 'echo "// z" >> crates/x.rs')
    expect "behind main" true "$main" "$pr"

    # A diff git cannot finish: both commits resolve, but the head's docs/ tree object is gone. Last,
    # because it leaves the repository broken.
    local broken tree
    broken=$(commit_from "$base" sh -c 'echo b >> docs/a.md')
    tree=$(git rev-parse "$broken:docs")
    rm -f ".git/objects/${tree:0:2}/${tree:2}"
    expect "a diff that fails" false "$base" "$broken"
  )
  echo "self-test passed: 13 cases; only ranges whose every changed path is under docs/ are true"
}

# AN UNRECOGNISED ARGUMENT IS AN ERROR, as in `check-text-bytes.sh`: a typo of `--self-test` must not
# fall through to a classification.
case "$#:${1-}" in
  1:--self-test) self_test; exit 0 ;;
  2:*) classify "$1" "$2" ;;
  *)
    printf 'error: unrecognised arguments: %s\n' "$*" >&2
    cat >&2 <<'MSG'
usage: scripts/ci-docs-only.sh <base> <head>
       scripts/ci-docs-only.sh --self-test

  <base> <head>   print `true` if every path the range changes is under docs/, else `false`
  --self-test     prove the classifier still classifies, in a throwaway repository
MSG
    exit 2
    ;;
esac
