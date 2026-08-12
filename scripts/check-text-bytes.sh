#!/usr/bin/env bash
# Reject C0 control bytes in tracked text files.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` already states.
#
#   scripts/check-text-bytes.sh              # scan the tracked tree
#   scripts/check-text-bytes.sh --self-test  # prove the detector still detects
#
# **WHY THIS GATE EXISTS, since the defect it catches is invisible by construction.**
# `web/src/pane-chrome.ts` carried a literal NUL (0x00) and SOH (0x01) as delimiters in
# `bindingSelect`'s cache key. One NUL byte makes the WHOLE FILE binary to every search tool:
# `rg` skips it and reports no match with exit 1 — silently, no warning — and `grep` says
# "Binary file matches" and prints nothing. So every search across `web/src/` quietly omitted a
# file holding four heavily-argued doc comments, and one of those had gone stale and was found
# only because a reviewer read the file rather than searching it.
#
# Nothing announces that state. Without a gate it can return and no one would notice, which is
# the whole argument for checking it rather than fixing it once.
#
# THE FIX IS ALWAYS AN ESCAPE, NEVER A DIFFERENT DELIMITER. `\x00` and `\x01` produce the
# identical string at runtime; the escape is for the source file, not for the value.
set -euo pipefail

# TAB (0x09), LF (0x0a) and CR (0x0d) are legitimate in text and are the only C0 bytes allowed.
# Everything else below 0x20 — plus DEL (0x7f) — is rejected.
readonly ALLOWED='\011\012\015\040-\176\200-\377'

# BINARY FILES ARE SKIPPED BY EXTENSION rather than by sniffing, because sniffing is the very
# thing this gate exists to distrust: a heuristic that calls a file binary is how the original
# defect hid. An extension list is dumb, visible, and wrong in ways a reader can see — a new
# binary format fails this gate until someone adds it here, which is the loud direction to be
# wrong in.
readonly BINARY_RE='\.(png|jpg|jpeg|gif|ico|webp|pdf|wasm|woff2?|ttf|otf|zip|gz|tar|bin|snap)$'

# How many disallowed bytes are in $1. **THE ONE DETECTION IMPLEMENTATION** — the scan below and
# `--self-test` both call this, so the self-test exercises the real thing rather than a paraphrase
# of it that could drift into agreeing with a broken scan.
#
# `tr -d` deletes every ALLOWED byte, so whatever survives is a violation.
#
# **THE COUNT CROSSES AS A NUMBER, NEVER THE BYTES THEMSELVES, AND THAT IS THE WHOLE TRICK.** The
# first version of this script piped the surviving bytes through `$(...)` and silently found
# nothing: bash strips NUL from command substitution ("warning: command substitution: ignored null
# byte in input"), so the one byte this gate exists to catch was the one byte it could not see. It
# had the same shape of defect as the bug it guards, and only a by-hand test against a planted NUL
# found it — which is the entire reason `--self-test` exists.
violations_in() {
  LC_ALL=C tr -d "$ALLOWED" < "$1" | wc -c | tr -d '[:space:]'
}

# The offending bytes as hex, for the error message. `od` emits ASCII, so this survives `$(...)`.
violation_codes() {
  LC_ALL=C tr -d "$ALLOWED" < "$1" | LC_ALL=C od -An -tx1 | tr -s ' \n' ' ' | sed 's/^ //;s/ $//'
}

# Prove the detector still detects. **A GATE THAT ONLY EVER RUNS AGAINST A PASSING TREE CANNOT TELL
# YOU IT STILL WORKS** — which is this repo's own "a test that cannot fail is a defect" rule turned
# on the checker itself. Both directions are asserted: a planted NUL must be caught, and a clean
# file must not be flagged, because a detector that fires on everything is equally useless.
self_test() {
  local dir dirty clean n
  dir=$(mktemp -d)
  # shellcheck disable=SC2064
  trap "rm -rf '$dir'" EXIT
  dirty="$dir/dirty.ts"
  clean="$dir/clean.ts"
  printf 'let k = "a\000b"\n' > "$dirty"
  printf 'let k = "a\\x00b"\n' > "$clean"

  n=$(violations_in "$dirty")
  if [ "$n" -eq 0 ]; then
    echo "self-test FAILED: a planted NUL was not detected — this gate is not working" >&2
    exit 1
  fi

  n=$(violations_in "$clean")
  if [ "$n" -ne 0 ]; then
    echo "self-test FAILED: an escaped \\x00 was flagged — this gate rejects valid source" >&2
    exit 1
  fi

  echo "self-test passed: a planted NUL is detected, an escaped one is not"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi

cd "$(git rev-parse --show-toplevel)"

bad=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  printf '%s\n' "$f" | grep -qiE "$BINARY_RE" && continue
  n=$(violations_in "$f")
  if [ "$n" -ne 0 ]; then
    printf 'error: %s contains %s control byte(s): %s\n' "$f" "$n" "$(violation_codes "$f")" >&2
    bad=1
  fi
done < <(git ls-files)

if [ "$bad" -ne 0 ]; then
  cat >&2 <<'MSG'

A control byte in a tracked text file makes that file BINARY to rg and grep, which then skip it
silently — searches over the tree return nothing rather than reporting a problem.

Write the byte as an escape instead (`\x00`, `\x01`, …). The runtime string is identical; the
escape exists so the source file stays searchable.
MSG
  exit 1
fi

echo "no control bytes in tracked text files"
