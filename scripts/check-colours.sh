#!/usr/bin/env bash
# Reject colour literals outside the palette.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` already states.
#
#   scripts/check-colours.sh              # scan the tracked web sources
#   scripts/check-colours.sh --self-test  # prove the detector still detects
#
# WHY THIS GATE EXISTS. Plan 7 part 1 made the palette data: `web/src/palettes.ts` holds every colour the
# app draws with, and `web/src/style.css` keeps one copy of the default palette, between two marker
# comments, as the first-paint fallback. A colour written anywhere else is one no palette can change and
# no contrast test checks — a skin that half-applies. The tree had none when this gate landed, so it
# enforces an invariant that already held rather than one that had to be reached.
#
# THE MARKED BLOCK IS EXEMPT IN `web/src/style.css` ONLY, AND ONLY ONCE. `palettes.test.ts` holds only
# the first block in that file equal to `palettes.ts`, so a second block, or one in any other file, would
# be colour no test checks. The scan fails on a begin marker anywhere else, or on a second one there, and
# reads the literals inside either.
#
# WHAT COUNTS. A hex colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or a CSS colour function (`rgb`,
# `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color`), in any tracked `.css` or `.ts`
# file under `web/src/` except `palettes.ts`, after comments are stripped. `transparent`, `currentColor`
# and `inherit` are keywords, not literals.
#
# WHAT IT DOES NOT SEE, AS A DECISION: CSS named colours (`red`, `white`, …). Telling `white` the colour
# from `white-space` the property needs a value-position parser, and there were none in the tree. The
# self-test asserts the blind spot, so it stays visible rather than accidental.
#
# WHAT ELSE IT DOES NOT SEE, AS A DECISION: in TypeScript, a colour literal that shares a line with a
# `//` sitting inside an earlier string, e.g. `const u = 'https://x'; const c = '#aabbcc'`. The
# line-comment strip (`s{//[^\n]*}{}g`) cannot tell that `//` from a real comment's, so it blanks the
# rest of the line, hex literal included. Telling the two apart needs a string-aware scanner, and there
# were none in the tree. The self-test asserts this blind spot too.
#
# WHAT IT SEES THAT IT SHOULD NOT, ALSO AS A DECISION: a TypeScript private member named only in hex
# letters (`#add`, `#feed`, `#decade`) reads as a hex colour. There were none in the tree; rename one
# rather than weaken the pattern. The self-test asserts this too.

set -euo pipefail

readonly COLOUR_RE='#[0-9A-Fa-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\('

readonly FALLBACK_HOME=web/src/style.css
readonly BEGIN_MARKER='/* palette:fallback:begin */'

# The ROLE $1 gets from the scan: `fallback` for `$FALLBACK_HOME` alone, empty for every other path.
# **THE ONE MAPPING IMPLEMENTATION** — the scan and the self-test's `expect_role` checks both call this,
# so a wrong mapping (e.g. every file reading as `fallback`, which leaves the scan green) fails the
# self-test.
role_of() {
  if [ "$1" = "$FALLBACK_HOME" ]; then
    echo fallback
  else
    echo
  fi
}

# The text of $1 with everything the gate must not read replaced by blank lines: every comment, and — in a
# style sheet, only when $2 is `fallback`, which the scan passes for `$FALLBACK_HOME` alone — the FIRST
# marked fallback block, stripped before the comments. Newlines are kept, so the line numbers `hits_in`
# reports are the file's own. **THE ONE STRIPPING IMPLEMENTATION** — the scan and `--self-test` both
# reach files through `hits_in`, which calls this, so the self-test exercises the real thing.
stripped() {
  case "$1" in
    *.css)
      FALLBACK="${2-}" perl -0777 -pe 's{/\* palette:fallback:begin \*/.*?/\* palette:fallback:end \*/}{"\n" x (() = $& =~ /\n/g)}se if $ENV{FALLBACK} eq "fallback"; s{/\*.*?\*/}{"\n" x (() = $& =~ /\n/g)}gse' -- "$1"
      ;;
    *.ts)
      perl -0777 -pe 's{/\*.*?\*/}{"\n" x (() = $& =~ /\n/g)}gse; s{//[^\n]*}{}g' -- "$1"
      ;;
  esac
}

# Every colour literal left in $1, as `line:text`, with $2 passed to `stripped`. Empty when there are none.
hits_in() {
  stripped "$1" "${2-}" | grep -nE "$COLOUR_RE" || true
}

# What is wrong with the fallback markers in $1, one line per problem; $2 as for `stripped`. Empty when
# nothing is: at most one begin marker in the fallback's home, none anywhere else.
marker_problems_in() {
  local n
  n=$(grep -oF -e "$BEGIN_MARKER" -- "$1" | grep -c '' || true)
  if [ "${2-}" = fallback ]; then
    [ "$n" -le 1 ] || echo "$n fallback blocks; only the first is exempt, and only it is checked against palettes.ts"
  else
    [ "$n" -eq 0 ] || echo "a fallback block outside $FALLBACK_HOME, which is not exempt"
  fi
}

# expect_hits FILE ROLE COUNT WHAT — ROLE is `stripped`'s $2.
expect_hits() {
  local n
  n=$(hits_in "$1" "$2" | grep -c '' || true)
  if [ "$n" -ne "$3" ]; then
    printf 'self-test FAILED: %s: expected %s hit(s), got %s\n' "$4" "$3" "$n" >&2
    exit 1
  fi
}

# expect_marker_problems FILE ROLE COUNT WHAT
expect_marker_problems() {
  local n
  n=$(marker_problems_in "$1" "$2" | grep -c '' || true)
  if [ "$n" -ne "$3" ]; then
    printf 'self-test FAILED: %s: expected %s marker problem(s), got %s\n' "$4" "$3" "$n" >&2
    exit 1
  fi
}

# expect_role FILE ROLE WHAT
expect_role() {
  local got
  got=$(role_of "$1")
  if [ "$got" != "$2" ]; then
    printf "self-test FAILED: %s: expected role '%s', got '%s'\n" "$3" "$2" "$got" >&2
    exit 1
  fi
}

# Prove the detector still detects. A gate that only ever runs against a passing tree cannot tell you it
# still works. `dir` is global and the trap single-quoted with `${dir:?}`, for the reasons
# `scripts/check-text-bytes.sh` gives at the same spot.
self_test() {
  dir=$(mktemp -d)
  trap 'rm -rf "${dir:?}"' EXIT

  expect_role "$FALLBACK_HOME" fallback "the fallback file's own path"
  expect_role web/src/fonts.css '' "another tracked style sheet"
  expect_role web/src/x/style.css '' "a same-named style sheet elsewhere"
  expect_role web/src/icons.ts '' "a tracked TypeScript path"

  cat >"$dir/dirty.css" <<'CSS'
a { color: #abc; }
a { color: #abcd; }
a { color: #aabbcc; }
a { color: #aabbccdd; }
a { color: rgb(0 0 0); }
a { color: rgba(0, 0, 0, 0.5); }
a { color: hsl(0 0% 0%); }
a { color: hsla(0, 0%, 0%, 1); }
a { color: hwb(0 0% 0%); }
a { color: lab(0% 0 0); }
a { color: lch(0% 0 0); }
a { color: oklab(0 0 0); }
a { color: oklch(0 0 0); }
a { color: color(srgb 0 0 0); }
CSS
  expect_hits "$dir/dirty.css" '' 14 'every literal form in a style sheet'

  cat >"$dir/clean.css" <<'CSS'
:root {
  /* palette:fallback:begin */
  --bg: light-dark(#ffffff, #000000);
  /* palette:fallback:end */
}
/* a comment may say #aabbcc
   or rgb( across lines */
a { color: transparent; border-color: currentColor; background: inherit; }
a { color: red; }
CSS
  expect_hits "$dir/clean.css" fallback 0 "the fallback block in the fallback's home, comments, keywords, and a named colour (the stated blind spot)"
  expect_marker_problems "$dir/clean.css" fallback 0 "one fallback block in the fallback's home"

  # The same block in any other style sheet is not exempt: its literal is read and its marker flagged.
  expect_hits "$dir/clean.css" '' 1 'a fallback block outside the fallback home, read like any other text'
  expect_marker_problems "$dir/clean.css" '' 1 'a fallback marker outside the fallback home'

  cat >"$dir/twice.css" <<'CSS'
:root {
  /* palette:fallback:begin */
  --bg: light-dark(#ffffff, #000000);
  /* palette:fallback:end */
  /* palette:fallback:begin */
  --fg: light-dark(#000000, #ffffff);
  /* palette:fallback:end */
}
CSS
  expect_hits "$dir/twice.css" fallback 1 "a second fallback block in the fallback's home, read like any other text"
  expect_marker_problems "$dir/twice.css" fallback 1 "a second fallback marker in the fallback's home"

  printf "const c = '#aabbcc'\n" >"$dir/dirty.ts"
  expect_hits "$dir/dirty.ts" '' 1 'a hex string in TypeScript'

  printf "// '#aabbcc'\n/* rgb(\n */\nconst id = '#editor'\n" >"$dir/clean.ts"
  expect_hits "$dir/clean.ts" '' 0 'comments and an id selector in TypeScript'

  printf "const u = 'https://example.com'; const c = '#aabbcc'\n" >"$dir/urlblind.ts"
  expect_hits "$dir/urlblind.ts" '' 0 "a URL string's // read as a line comment, hiding a hex literal later on the same line (the stated blind spot)"

  printf 'class A { #add() {} }\n' >"$dir/hexname.ts"
  expect_hits "$dir/hexname.ts" '' 1 'a private member named only in hex letters (the stated false positive)'

  printf '/* one\ntwo */\na { color: #abc; }\n' >"$dir/lines.css"
  if [ "$(hits_in "$dir/lines.css" | cut -d: -f1)" != 3 ]; then
    echo 'self-test FAILED: stripping a comment moved the reported line number' >&2
    exit 1
  fi

  echo "self-test passed: role_of gives the fallback role to $FALLBACK_HOME alone, not to another style sheet, a same-named one elsewhere or a TypeScript path; every literal form is caught; the first fallback block in the fallback's home, comments, keywords, named colours and a same-line URL's // are not; a fallback block anywhere else, or a second one there, is read and its marker flagged; a hex-lettered private name is flagged; line numbers survive"
}

case "$#:${1-}" in
  0:) ;;
  1:--self-test) self_test; exit 0 ;;
  *)
    printf 'error: unrecognised argument: %s\n' "$*" >&2
    cat >&2 <<'MSG'
usage: scripts/check-colours.sh [--self-test]

  (no argument)   scan tracked web sources for colour literals outside the palette
  --self-test     prove the detector still detects
MSG
    exit 2
    ;;
esac

cd "$(git rev-parse --show-toplevel)"

bad=0
while IFS= read -r -d '' f; do
  [ "$f" = web/src/palettes.ts ] && continue
  [ -f "$f" ] || continue
  role=$(role_of "$f")
  out=$(marker_problems_in "$f" "$role")
  if [ -n "$out" ]; then
    printf '%s\n' "$out" | sed "s|^|error: $f: |" >&2
    bad=1
  fi
  out=$(hits_in "$f" "$role")
  if [ -n "$out" ]; then
    printf '%s\n' "$out" | sed "s|^|error: $f:|" >&2
    bad=1
  fi
done < <(git ls-files -z -- 'web/src/*.css' 'web/src/*.ts')

if [ "$bad" -ne 0 ]; then
  cat >&2 <<'MSG'

A colour written outside the palette is one no palette can change and no contrast test checks. Add a
token to `COLOUR_TOKENS` in web/src/palettes.ts, give it a value in every palette, and read it with
`var(--token)` — or mix existing tokens with `color-mix()`. The marked fallback block belongs in
web/src/style.css alone, once.
MSG
  exit 1
fi

echo "no colour literals outside the palette"
