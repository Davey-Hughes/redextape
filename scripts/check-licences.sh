#!/usr/bin/env bash
# Reject a third-party licence file that no longer matches what the site ships.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` already states.
#
#   scripts/check-licences.sh              # regenerate into a temporary file and compare
#   scripts/check-licences.sh --self-test  # prove the comparison still fires
#
# WHY THIS GATE EXISTS. The licences page (`web/licences.html`) renders `web/src/third-party-licences.json`,
# which `web/scripts/licences.ts` writes from the installed npm packages, `cargo tree` for each wasm build and the
# toolchain texts under `web/scripts/toolchain-licences/` — every package whose code or font reaches the browser,
# with the licence texts it carries (about pages design §8). The file
# is committed so a dependency bump shows up as a reviewable diff and the Docker build needs no cargo; the
# price is that it can go stale, and a stale one names licences the site no longer ships, or misses one it
# does. This regenerates it and fails on any difference.
#
# IT NEEDS WHAT THE GENERATOR NEEDS: `web/node_modules` installed from `web/pnpm-lock.yaml`, which `installed`
# checks first, and `cargo` able to read the lockfile; `cargo tree` and `cargo metadata` run `--locked`.
#
# THE FIX IS ALWAYS TO REGENERATE, NEVER TO EDIT THE JSON: `cd web && node scripts/licences.ts`.

set -euo pipefail
cd "$(dirname "$0")/.."

readonly COMMITTED=web/src/third-party-licences.json

fail() {
  echo "check-licences: $*" >&2
  exit 1
}

# Succeed when $1 and $2 are byte-identical; otherwise print what differs and fail. Drives the real check AND
# the self-test, so the self-test cannot drift into agreeing with a broken check.
compare() {
  local committed="$1" generated="$2"
  [ -f "$committed" ] || {
    echo "$committed: does not exist" >&2
    return 1
  }
  cmp -s "$committed" "$generated" && return 0
  # CUT TO 200 COLUMNS: each licence text is one JSON line, some of them 35 KB long.
  diff -u "$committed" "$generated" | cut -c1-200 | head -40 >&2 || true
  return 1
}

# A STALE INSTALL IS NOT A STALE FILE. After a branch switch prunes `web/node_modules`, regenerating would write the
# install's versions, which CI's frozen lockfile then rejects; pnpm keeps a copy of the lockfile it installed from.
installed() {
  cmp -s web/pnpm-lock.yaml web/node_modules/.pnpm/lock.yaml ||
    fail "web/node_modules is not what web/pnpm-lock.yaml names; run \`cd web && pnpm install\` first"
}

generate() {
  (cd web && node scripts/licences.ts --stdout) >"$1" || fail "web/scripts/licences.ts failed"
}

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp:?}"' EXIT

# ---------------------------------------------------------------------------- self-test
if [ "${1:-}" = "--self-test" ]; then
  good="$tmp/good.json"
  generate "$good"
  compare "$good" "$good" 2>/dev/null || fail "self-test: a file was reported as differing from itself"

  # Each case below rewrites the file through Python, so first the control: a rewrite that changes nothing must be
  # byte-identical, or every case would fire on the rewrite alone and prove nothing.
  rewrite() {
    python3 -I - "$good" "$1" "$2" <<'PY'
import json, sys
src, dst, case = sys.argv[1:4]
d = json.load(open(src, encoding="utf-8"))
if case == "drop":
    assert d["packages"], "no packages to drop"
    d["packages"] = d["packages"][1:]
elif case == "edit":
    key = next(k for k, t in d["texts"].items() if "Permission is hereby granted" in t)
    d["texts"][key] = d["texts"][key].replace("Permission is hereby granted", "Permission is hereby GRANTED", 1)
open(dst, "w", encoding="utf-8").write(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
PY
  }
  rewrite "$tmp/same.json" none
  compare "$tmp/same.json" "$good" 2>/dev/null || fail "self-test: a rewrite that changed nothing differs, so the cases below prove nothing"

  # The committed file missing a package the site ships: the first package's whole entry gone from it.
  rewrite "$tmp/dropped.json" drop
  if compare "$tmp/dropped.json" "$good" 2>/dev/null; then
    fail "self-test: a committed file missing a package was accepted"
  fi

  # A licence text changed upstream, one character of it.
  rewrite "$tmp/edited.json" edit
  cmp -s "$tmp/edited.json" "$good" && fail "self-test: the edit did not change the copy, so it proves nothing"
  if compare "$tmp/edited.json" "$good" 2>/dev/null; then
    fail "self-test: a committed file with a changed licence text was accepted"
  fi

  if compare "$tmp/absent.json" "$good" 2>/dev/null; then
    fail "self-test: a missing committed file was accepted"
  fi
  echo "check-licences: self-test passed"
  exit 0
fi

# ---------------------------------------------------------------------------- check
installed
generate "$tmp/generated.json"
compare "$COMMITTED" "$tmp/generated.json" ||
  fail "$COMMITTED is stale; regenerate it with \`cd web && node scripts/licences.ts\` and commit the result"
echo "check-licences: $COMMITTED matches what the site ships"
