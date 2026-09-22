#!/usr/bin/env bash
# Keep each committed grammar `.wasm` in step with the `src/parser.c` it was built from, and keep the
# committed bytes the ones that build produced.
#
# CI invokes this same script (.forgejo/workflows/ci.yml) and so does the pre-commit hook
# (.pre-commit-config.yaml), so the local and CI gates cannot drift — the convention
# `scripts/check-all.sh` states and the seven sibling `check-*.sh` scripts already follow.
#
#   scripts/check-grammar-wasm.sh              # verify every grammar against the manifest
#   scripts/check-grammar-wasm.sh --self-test  # prove the detector still detects
#   scripts/check-grammar-wasm.sh --rebuild    # rebuild all four and refresh the manifest (needs docker)
#
# **WHY A HASH MANIFEST AND NOT A REBUILD.** Building one of these runs `tree-sitter build --wasm`,
# which runs emscripten, which on a machine without it runs `emscripten/emsdk:4.0.4` under docker. CI
# has neither, and docker-in-docker on the Forgejo runner is its own project. `sha256sum` is on every
# runner, so the gate compares hashes and the rebuild stays a developer action.
#
# **WHY BOTH HASHES.** `parser.c`'s hash catches a grammar regenerated without its `.wasm` rebuilt.
# It cannot catch a `.wasm` replaced or corrupted by hand with `parser.c` untouched, and the design's
# first draft accepted that hole on the grounds that CI cannot rebuild the artefact — which does not
# follow, because checking a hash is not rebuilding. The build was then measured byte-reproducible
# (the same grammar, rebuilt after deleting the artefact and written to a different output filename,
# hashes identically), so recording the artefact's own hash costs one field per grammar and causes no
# churn. What neither column catches is both files edited together to agree; that is every hash
# manifest's residue, and the browser differential in `web/tests/browser/grammar-differential.test.ts`
# is what stands behind the artefact's behaviour rather than its identity.
#
# **`-o` MUST NAME A PATH ON THE GRAMMAR'S OWN FILESYSTEM.** The CLI renames its output into place, so
# pointing `--rebuild` at a scratch directory on another mount fails with
# `failed to rename wasm output file: Invalid cross-device link`.
set -euo pipefail
cd "$(dirname "$0")/.."

GRAMMARS_DIR="grammars"
MANIFEST="grammars/wasm-manifest.json"
TREE_SITTER=".tools/tree-sitter"
PINNED_VERSION="0.25.10"

fail() {
  echo "check-grammar-wasm: $*" >&2
  exit 1
}

# Every directory under `grammars/` that is a grammar. Discovered by `tree-sitter.json` rather than by
# a `grammars/*/` glob, because `grammars/shared/` holds prose and is not one — the same selection
# `check_grammars` in scripts/check-all.sh makes, and for the same reason it records.
discover() {
  find "$GRAMMARS_DIR" -mindepth 2 -maxdepth 2 -name tree-sitter.json -printf '%h\n' | sort
}

# Verify, or rewrite, the manifest. `mode` is "check" or "write". Drives the real scan AND the
# self-test, so the self-test cannot drift into agreeing with a broken scan.
verify() {
  local root="$1" manifest="$2" mode="$3"
  python3 - "$root" "$manifest" "$mode" <<'PY'
import hashlib, json, pathlib, sys

root, manifest_path, mode = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]

def sha256(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

found = sorted(p.parent for p in root.glob('*/tree-sitter.json'))
if not found:
    print(f'{root}: no grammar directory carries a tree-sitter.json', file=sys.stderr)
    sys.exit(1)

built = {}
bad = []
for d in found:
    name = d.name
    parser_c, wasm = d / 'src' / 'parser.c', d / f'{name}.wasm'
    if not parser_c.exists():
        bad.append(f'{name}: no {parser_c}')
        continue
    if not wasm.exists():
        bad.append(f'{name}: no {wasm} — run scripts/check-grammar-wasm.sh --rebuild')
        continue
    built[name] = {'parser_c_sha256': sha256(parser_c), 'wasm_sha256': sha256(wasm)}

if mode == 'write':
    if bad:
        for b in bad:
            print(b, file=sys.stderr)
        sys.exit(1)
    manifest_path.write_text(json.dumps({'grammars': built}, indent=2, sort_keys=True) + '\n')
    print(f'check-grammar-wasm: wrote {len(built)} grammar(s) to {manifest_path}')
    sys.exit(0)

if not manifest_path.exists():
    print(f'{manifest_path}: does not exist', file=sys.stderr)
    sys.exit(1)
recorded = json.loads(manifest_path.read_text()).get('grammars', {})

# A grammar on disk with no manifest row is the case a per-row loop would pass in silence, so the key
# sets are compared before any hash is.
for name in sorted(set(built) - set(recorded)):
    bad.append(f'{name}: on disk but absent from {manifest_path}')
for name in sorted(set(recorded) - set(built)):
    bad.append(f'{name}: in {manifest_path} but not on disk')

for name in sorted(set(built) & set(recorded)):
    for field, what in (('parser_c_sha256', f'{name}/src/parser.c'), ('wasm_sha256', f'{name}/{name}.wasm')):
        if built[name][field] != recorded[name].get(field):
            bad.append(f'{what}: {field} is {built[name][field]}, manifest says {recorded[name].get(field)}')

for b in bad:
    print(b, file=sys.stderr)
sys.exit(1 if bad else 0)
PY
}

# ---------------------------------------------------------------------------- self-test
if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:?}"' EXIT
  g="$tmp/tree-sitter-fake"
  mkdir -p "$g/src"
  printf '{}\n' >"$g/tree-sitter.json"
  printf 'int parser(void) { return 1; }\n' >"$g/src/parser.c"
  printf '\0asm fake bytes\n' >"$g/tree-sitter-fake.wasm"
  m="$tmp/manifest.json"

  verify "$tmp" "$m" write >/dev/null || fail "self-test: could not write a manifest for a good tree"
  verify "$tmp" "$m" check >/dev/null 2>&1 || fail "self-test: a matching tree was reported as differing"

  printf 'int parser(void) { return 2; }\n' >"$g/src/parser.c"
  if verify "$tmp" "$m" check >/dev/null 2>&1; then
    fail "self-test: a regenerated parser.c with a stale .wasm was accepted"
  fi
  printf 'int parser(void) { return 1; }\n' >"$g/src/parser.c"

  printf '\0asm TAMPERED\n' >"$g/tree-sitter-fake.wasm"
  if verify "$tmp" "$m" check >/dev/null 2>&1; then
    fail "self-test: a .wasm replaced by hand with parser.c untouched was accepted"
  fi
  printf '\0asm fake bytes\n' >"$g/tree-sitter-fake.wasm"
  verify "$tmp" "$m" check >/dev/null 2>&1 || fail "self-test: restoring both files did not restore agreement"

  g2="$tmp/tree-sitter-second"
  mkdir -p "$g2/src"
  printf '{}\n' >"$g2/tree-sitter.json"
  printf 'int second(void) { return 1; }\n' >"$g2/src/parser.c"
  printf '\0asm second\n' >"$g2/tree-sitter-second.wasm"
  if verify "$tmp" "$m" check >/dev/null 2>&1; then
    fail "self-test: a grammar on disk with no manifest row was accepted"
  fi
  rm -rf "${g2:?}"

  rm -f "$g/tree-sitter-fake.wasm"
  if verify "$tmp" "$m" check >/dev/null 2>&1; then
    fail "self-test: a missing .wasm was accepted"
  fi

  echo "self-test passed: a stale .wasm, a tampered .wasm, a missing .wasm and an unlisted grammar are each refused, and a matching pair is not"
  exit 0
fi

# ---------------------------------------------------------------------------- rebuild
if [ "${1:-}" = "--rebuild" ]; then
  [ -x "$TREE_SITTER" ] || fail "$TREE_SITTER is missing — run scripts/install-treesitter-ci.sh"
  version="$("$TREE_SITTER" --version | awk '{print $2}')"
  # The CLI on PATH is Arch's `-git` build and reports a version no release carries; only the pin may
  # produce these artefacts, for the reason scripts/install-treesitter-ci.sh records at length.
  [ "$version" = "$PINNED_VERSION" ] || fail "$TREE_SITTER reports $version, expected $PINNED_VERSION"
  while IFS= read -r d; do
    name="$(basename "$d")"
    # `-o` inside the grammar's own directory: the CLI renames its output into place.
    "$TREE_SITTER" build --wasm --docker -o "$d/$name.wasm" "$d" || fail "$name: build failed"
  done < <(discover)
  verify "$GRAMMARS_DIR" "$MANIFEST" write
  exit 0
fi

# ---------------------------------------------------------------------------- scan
if ! verify "$GRAMMARS_DIR" "$MANIFEST" check; then
  echo "check-grammar-wasm: a committed grammar .wasm no longer matches the manifest." >&2
  echo "  If src/parser.c changed, rebuild with 'scripts/check-grammar-wasm.sh --rebuild' (needs docker)." >&2
  echo "  If only the .wasm changed, it was not produced by the committed parser.c — restore it." >&2
  exit 1
fi
count="$(discover | wc -l)"
echo "check-grammar-wasm: $count grammar .wasm match their parser.c and their recorded bytes."
