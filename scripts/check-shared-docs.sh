#!/usr/bin/env bash
# Keep the prose that appears in more than one document identical to its single source.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` states and the four sibling `check-*.sh` scripts already follow.
#
#   scripts/check-shared-docs.sh              # scan every marked region
#   scripts/check-shared-docs.sh --self-test  # prove the detector still detects
#   scripts/check-shared-docs.sh --fix        # rewrite every marked region from its source
#
# **WHY THIS EXISTS, AND IT IS NOT A STYLE PREFERENCE.** The branch that gave Neovim a one-line install
# wrote the same install prose into all four grammar READMEs. A review flagged the duplication; the
# measurement that followed found **184 identical lines across the four**, and — the part that settles
# it — one of the three shared blocks had ALREADY drifted into three different wordings. The `main`
# versus `master` paragraph reads one way in the mini-language README, is re-wrapped in λ's, and in the
# asm and TM copies has lost the clause *"Pick the one you have installed — the `install_info` field
# sets are different"* entirely. Nobody decided that. Four copies of a paragraph edited over four
# branches is all it takes, and no gate in this repository could see it: `check-doc-figures.sh` derives
# NUMBERS from the tree and has no opinion about prose.
#
# **THE COPIES STAY IN THE READMEs RATHER THAN BECOMING A LINK, DELIBERATELY.** Each grammar README is
# a document someone lands on from its own directory and reads end to end; sending them elsewhere for
# the install steps would cost more than the duplication does. So the bytes are repeated and the
# repetition is made unbreakable instead: one source, marked regions, and `--fix` so bringing a copy
# back into line is never a manual edit.
#
# A region is delimited in the consuming file by
#
#     <!-- BEGIN shared: <name> -->
#     ...content, byte-identical to grammars/shared/<name>.md...
#     <!-- END shared: <name> -->
#
# and the source of truth is `grammars/shared/<name>.md`. Editing a copy is the error this catches;
# editing the source and running `--fix` is the workflow.
set -euo pipefail
cd "$(dirname "$0")/.."

SHARED_DIR="grammars/shared"

fail() {
  echo "check-shared-docs: $*" >&2
  exit 1
}

# Every tracked file that carries at least one BEGIN marker. Discovered rather than listed, so a fifth
# grammar — or a README somewhere else entirely — is covered the moment it uses a marker, with nothing
# to remember to update. That is the same reasoning the sibling gates give for walking `git ls-files`
# instead of enumerating paths.
consumers() {
  git ls-files '*.md' -z | xargs -0 grep -l '^<!-- BEGIN shared: ' 2>/dev/null || true
}

# Rewrite or verify one file. `mode` is "check" or "fix"; prints one line per region on a mismatch.
process_file() {
  local file="$1" mode="$2" shared="${3:-$SHARED_DIR}"
  python3 - "$file" "$mode" "$shared" <<'PY'
import pathlib, re, sys
path, mode, shared_dir = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3])
text = path.read_text()
pattern = re.compile(
    r'(?P<begin><!-- BEGIN shared: (?P<name>[a-z0-9-]+) -->\n)'
    r'(?P<body>.*?)'
    r'(?P<end><!-- END shared: (?P=name) -->)',
    re.DOTALL)

seen, bad, out, last = set(), [], [], 0
for m in pattern.finditer(text):
    name = m.group('name')
    seen.add(name)
    src = shared_dir / f'{name}.md'
    if not src.exists():
        bad.append(f'{path}: region {name!r} has no source at {src}')
        continue
    canon = src.read_text().rstrip('\n') + '\n'
    if m.group('body') != canon:
        bad.append(f'{path}: region {name!r} differs from {src}')
    out.append(text[last:m.start('body')])
    out.append(canon)
    last = m.start('end')
out.append(text[last:])

# An unterminated BEGIN would otherwise be skipped in silence, which is the one way a region could
# leave the gate's sight without anybody editing it.
opens = re.findall(r'^<!-- BEGIN shared: ([a-z0-9-]+) -->$', text, re.M)
closes = re.findall(r'^<!-- END shared: ([a-z0-9-]+) -->$', text, re.M)
if sorted(opens) != sorted(closes) or len(opens) != len(seen):
    bad.append(f'{path}: unbalanced or malformed shared markers (BEGIN {opens}, END {closes})')

if mode == 'fix' and not any('unbalanced' in b or 'no source' in b for b in bad):
    path.write_text(''.join(out))
    sys.exit(0)
for b in bad:
    print(b)
sys.exit(1 if bad else 0)
PY
}

# ---------------------------------------------------------------------------- self-test
if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:?}"' EXIT
  mkdir -p "$tmp/shared"
  printf 'alpha\nbeta\n' >"$tmp/shared/thing.md"

  ok_doc="$tmp/ok.md"
  printf 'intro\n<!-- BEGIN shared: thing -->\nalpha\nbeta\n<!-- END shared: thing -->\ntail\n' >"$ok_doc"
  if ! out="$(process_file "$ok_doc" check "$tmp/shared" 2>&1)"; then
    fail "self-test: a matching region was reported as differing: $out"
  fi

  drift_doc="$tmp/drift.md"
  printf 'intro\n<!-- BEGIN shared: thing -->\nalpha\nBETA\n<!-- END shared: thing -->\ntail\n' >"$drift_doc"
  if process_file "$drift_doc" check "$tmp/shared" >/dev/null 2>&1; then
    fail "self-test: a drifted region was accepted"
  fi

  # ...and --fix must repair exactly that, rather than merely reporting it.
  process_file "$drift_doc" fix "$tmp/shared" >/dev/null 2>&1 || true
  if ! process_file "$drift_doc" check "$tmp/shared" >/dev/null 2>&1; then
    fail "self-test: --fix did not repair a drifted region"
  fi
  if ! diff -q "$ok_doc" "$drift_doc" >/dev/null; then
    fail "self-test: --fix produced something other than the source text"
  fi

  missing_doc="$tmp/missing.md"
  printf '<!-- BEGIN shared: nosuch -->\nx\n<!-- END shared: nosuch -->\n' >"$missing_doc"
  if process_file "$missing_doc" check "$tmp/shared" >/dev/null 2>&1; then
    fail "self-test: a region naming a source that does not exist was accepted"
  fi

  unterminated="$tmp/open.md"
  printf '<!-- BEGIN shared: thing -->\nalpha\nbeta\n' >"$unterminated"
  if process_file "$unterminated" check "$tmp/shared" >/dev/null 2>&1; then
    fail "self-test: an unterminated BEGIN marker was accepted"
  fi

  echo "self-test passed: drift is caught, --fix repairs it exactly, and a missing source or an unterminated marker is refused"
  exit 0
fi

# ---------------------------------------------------------------------------- sources exist
shopt -s nullglob
sources=("$SHARED_DIR"/*.md)
shopt -u nullglob
[ "${#sources[@]}" -gt 0 ] || fail "no shared sources under $SHARED_DIR/"

# ---------------------------------------------------------------------------- scan or fix
mode="check"
[ "${1:-}" = "--fix" ] && mode="fix"

files=()
while IFS= read -r f; do [ -n "$f" ] && files+=("$f"); done < <(consumers)
[ "${#files[@]}" -gt 0 ] || fail "no file carries a 'BEGIN shared:' marker — has the convention been renamed?"

regions=0
status=0
for f in "${files[@]}"; do
  regions=$((regions + $(grep -c '^<!-- BEGIN shared: ' "$f")))
  if ! process_file "$f" "$mode"; then
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "check-shared-docs: run 'scripts/check-shared-docs.sh --fix' to bring the copies back into line," >&2
  echo "  or edit $SHARED_DIR/<name>.md if the SOURCE is what should change." >&2
  exit 1
fi

# Every source should be used by something. An orphan is either a deleted consumer nobody noticed or a
# typo'd region name, and both are worth a failure rather than a shrug.
for src in "${sources[@]}"; do
  name="$(basename "$src" .md)"
  grep -q "^<!-- BEGIN shared: $name -->" "${files[@]}" || fail "$src is not used by any document"
done

if [ "$mode" = "fix" ]; then
  echo "check-shared-docs: rewrote $regions region(s) in ${#files[@]} file(s) from ${#sources[@]} source(s)."
else
  echo "check-shared-docs: $regions shared region(s) in ${#files[@]} file(s) match their ${#sources[@]} source(s)."
fi
