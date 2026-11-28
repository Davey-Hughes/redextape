#!/usr/bin/env bash
# Hold `LICENSE.md` to the words of `COPYING`, and each of them to GNU's text byte for byte.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` states and the nine sibling `check-*.sh` scripts already follow.
#
#   scripts/check-licence-editions.sh              # compare the two files, then check each one's hash
#   scripts/check-licence-editions.sh --self-test  # prove the comparison and the hash check still fire
#
# WHY THIS GATE EXISTS. The repository carries the GPLv3 twice: `LICENSE.md` is GNU's Markdown edition, which a
# forge renders, and `COPYING` is GNU's plain-text edition, which the licences page shows
# (`web/scripts/licences.ts`). They are one licence only while they say the same thing, and an edit to one file
# alone would leave the project offering two texts and no way to say which governs.
#
# WHAT COUNTS AS THE SAME. Markdown's marks are not the licence's words, so three kinds are taken out of
# `LICENSE.md`: a run of 1 to 6 `#` that is its line's first word, a `-` that is its line's first word, and a
# backslash before a punctuation character. What is left, split on whitespace, must be `COPYING`'s words in
# `COPYING`'s order. Line breaks and indentation may differ, since the two editions wrap and indent differently.
#
# NOTHING IS TAKEN OUT OF `COPYING`, so a `#` or `-` that began one of its lines would fail here, not pass unread.
#
# WHY EACH FILE'S HASH IS PINNED TOO. The words cannot see the same edit made to both files, nor a Markdown mark added
# to `LICENSE.md` or taken from it, which changes how a forge draws the licence and none of its words. Both files are
# GNU's editions byte for byte, so each is held to its SHA-256. The words are compared first because a failure there
# names the word; a hash failure can only name the file. A new edition from GNU is the one reason to change a hash.
set -euo pipefail
cd "$(dirname "$0")/.."

readonly MARKDOWN=LICENSE.md PLAIN=COPYING
readonly MARKDOWN_SHA256=cc5470feed66192387f06ae93aed0bd4fefae5a5fd7c1e54a4acf4ea64f1028b
readonly PLAIN_SHA256=3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986

fail() {
  echo "check-licence-editions: $*" >&2
  exit 1
}

# Print the word count when the Markdown file $1 holds the plain-text file $2's words; otherwise name the first
# word that differs, with its line in each file, and fail. Drives the real check AND the self-test, so the
# self-test cannot drift into agreeing with a broken check.
compare() {
  python3 -I - "$1" "$2" <<'PY'
import re, sys
md_path, txt_path = sys.argv[1:3]

# Bytes, and ASCII whitespace only: a no-break space is not a word break in either edition.
def words(path):
    with open(path, "rb") as f:
        lines = f.read().split(b"\n")
    return [(m.group(0), n, m.start() == len(line) - len(line.lstrip()))
            for n, line in enumerate(lines, 1) for m in re.finditer(rb"\S+", line)]

MARK = re.compile(rb"#{1,6}|-")
ESCAPE = re.compile(rb"\\([!-/:-@\[-`{-~])")
md = [(ESCAPE.sub(rb"\1", w), n) for w, n, first in words(md_path) if not (first and MARK.fullmatch(w))]
txt = [(w, n) for w, n, _ in words(txt_path)]

def bad(message):
    sys.exit(f"check-licence-editions: {message}")

show = lambda w: '"' + w.decode("utf-8", "backslashreplace") + '"'
for k, ((a, la), (b, lb)) in enumerate(zip(md, txt), 1):
    if a != b:
        bad(f"word {k} differs: {md_path} line {la} has {show(a)}, {txt_path} line {lb} has {show(b)}")
if len(md) != len(txt):
    (long_path, long), (short_path, short) = sorted(((md_path, md), (txt_path, txt)), key=lambda p: -len(p[1]))
    w, n = long[len(short)]
    bad(f"{short_path} ends after {len(short)} words: word {len(short) + 1} of {long_path}, on line {n}, is {show(w)}")
# Two empty files agree on every word, and a licence with no words is not one.
if not txt:
    bad(f"{md_path} and {txt_path} hold no words")
print(len(txt))
PY
}

# Print file $1's SHA-256. Python rather than `sha256sum`, which macOS does not ship, and `compare` needs Python already.
sha256() {
  python3 -I -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$1"
}

# Pass when file $1's SHA-256 is $2; otherwise name the file and both hashes, and fail.
pinned() {
  local actual
  actual="$(sha256 "$1")" || return 1
  [ "$actual" = "$2" ] || {
    echo "check-licence-editions: $1's SHA-256 is $actual, not GNU's $2" >&2
    return 1
  }
}

self_test() {
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:?}"' EXIT
  # One of each mark, a line wrapped differently in the two files, and the licence's own backtick quote, which
  # is a word's character and stays.
  local md txt variant
  md="$(printf '%s\n' '# Title' '' 'Some words here,' 'wrapped.' '' '-   a) first' '    item' '' \
    '### 1. Next' '' 'Type \`show w'"'"' now.')"
  txt="$(printf '%s\n' '        Title' '' 'Some words here, wrapped.' '' '    a) first' '    item' '' \
    '  1. Next' '' 'Type `show w'"'"' now.')"

  # Fail the self-test unless `compare` accepts the Markdown text $2 against the plain text $3.
  accepts() {
    local out
    printf '%s\n' "$2" >"$tmp/LICENSE.md"
    printf '%s\n' "$3" >"$tmp/COPYING"
    out="$(compare "$tmp/LICENSE.md" "$tmp/COPYING" 2>&1)" || fail "self-test: $1 was rejected: $out"
  }
  # Fail it unless `compare` rejects them with a message holding $4, so a case cannot pass on some other failure.
  rejects() {
    local out
    printf '%s\n' "$2" >"$tmp/LICENSE.md"
    printf '%s\n' "$3" >"$tmp/COPYING"
    if out="$(compare "$tmp/LICENSE.md" "$tmp/COPYING" 2>&1)"; then
      fail "self-test: $1 was accepted"
    fi
    case "$out" in
      *"$4"*) ;;
      *) fail "self-test: $1 was rejected, but not with '$4': $out" ;;
    esac
  }

  accepts "the same words under each kind of mark" "$md" "$txt"

  # A mark is not a word, so a file that loses one still holds the same words. Each variant is first shown to
  # differ from the original, or the case would pass on an edit that did nothing.
  variant="${md/'# Title'/Title}"
  [ "$variant" != "$md" ] || fail "self-test: the heading mark was not removed, so its case proves nothing"
  accepts "a heading that lost its mark" "$variant" "$txt"
  variant="${md/'-   a)'/a)}"
  [ "$variant" != "$md" ] || fail "self-test: the list marker was not removed, so its case proves nothing"
  accepts "a list item that lost its marker" "$variant" "$txt"

  rejects "a changed word" "${md/wrapped./wrapped}" "$txt" \
    "word 5 differs: $tmp/LICENSE.md line 4 has \"wrapped\", $tmp/COPYING line 3 has \"wrapped.\""
  rejects "a changed word in the plain text" "$md" "${txt/item/items}" \
    "word 8 differs: $tmp/LICENSE.md line 7 has \"item\", $tmp/COPYING line 6 has \"items\""
  rejects "a missing word" "${md/Some words/Some}" "$txt" "word 3 differs"
  rejects "a Markdown file that stops early" "${md/ now./}" "$txt" \
    "$tmp/LICENSE.md ends after 13 words: word 14 of $tmp/COPYING, on line 10, is \"now.\""
  rejects "a Markdown file that runs on" "$md extra" "$txt" \
    "$tmp/COPYING ends after 14 words: word 15 of $tmp/LICENSE.md, on line 11, is \"extra\""

  # Only a line's first word is a mark, and only a backslash before punctuation is an escape.
  rejects "a # inside a line" "${md/Some words/Some # words}" "$txt" "word 3 differs"
  rejects "a - inside a line" "${md/Some words/Some - words}" "$txt" "word 3 differs"
  rejects "a backslash before a letter" "${md/Type/\\Type}" "$txt" "word 11 differs"
  rejects "a list marker in the plain text" "$md" "${txt/'    a)'/-   a)}" "word 6 differs"

  rejects "two files with no words" "" "" "hold no words"

  # The hash check, on the same Markdown text: its own hash passes, and one byte changed fails with the file named.
  local hash out
  printf '%s\n' "$md" >"$tmp/LICENSE.md"
  hash="$(sha256 "$tmp/LICENSE.md")"
  out="$(pinned "$tmp/LICENSE.md" "$hash" 2>&1)" || fail "self-test: a file with its own hash was rejected: $out"
  printf '%s\n' "${md/Title/Titlf}" >"$tmp/LICENSE.md"
  if out="$(pinned "$tmp/LICENSE.md" "$hash" 2>&1)"; then
    fail "self-test: a file with one byte changed passed its hash"
  fi
  case "$out" in
    *"$tmp/LICENSE.md's SHA-256 is "*", not GNU's $hash"*) ;;
    *) fail "self-test: a file with one byte changed was rejected, but not for its hash: $out" ;;
  esac

  rm -f "$tmp/COPYING"
  if compare "$tmp/LICENSE.md" "$tmp/COPYING" >/dev/null 2>&1; then
    fail "self-test: a missing plain-text file was accepted"
  fi
  echo "check-licence-editions: self-test passed"
}

# AN UNRECOGNISED ARGUMENT IS AN ERROR, as in `check-text-bytes.sh`: a typo of `--self-test` must not fall
# through to the check and pass as the self-test.
case "$#:${1-}" in
  0:) ;;
  1:--self-test) self_test; exit 0 ;;
  *)
    printf 'error: unrecognised argument: %s\n' "$*" >&2
    cat >&2 <<'MSG'
usage: scripts/check-licence-editions.sh [--self-test]

  (no argument)   compare LICENSE.md's words with COPYING's, then each file's SHA-256 with GNU's edition's
  --self-test     prove the comparison and the hash check still fire, against planted differences
MSG
    exit 2
    ;;
esac

count="$(compare "$MARKDOWN" "$PLAIN")" ||
  fail "$MARKDOWN and $PLAIN no longer hold the same words." \
    "The GPL's text is not this project's to reword: restore the file that changed."
echo "check-licence-editions: $MARKDOWN and $PLAIN hold the same $count words in the same order"
# Both files are checked before failing, so a change to each names each.
hashes_ok=true
pinned "$MARKDOWN" "$MARKDOWN_SHA256" || hashes_ok=false
pinned "$PLAIN" "$PLAIN_SHA256" || hashes_ok=false
"$hashes_ok" ||
  fail "The GPL's text is not this project's to edit, by a word or a mark: restore the file that changed."
echo "check-licence-editions: $MARKDOWN and $PLAIN are GNU's editions byte for byte"
