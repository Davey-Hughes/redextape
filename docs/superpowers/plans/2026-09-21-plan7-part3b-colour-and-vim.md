# Plan 7 part 3b — colour and vim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all four languages tree-sitter colouring in every editor, commit the four grammar `.wasm` behind a two-hash freshness gate, and add a vim keymap the settings menu switches — deleting `classify_source`'s decoration path in `web/` as the same change.

**Architecture:** The four `.wasm` are committed artefacts gated by `grammars/wasm-manifest.json`, which records both the `parser.c` that produced each one and the artefact's own bytes. The capture-name → `TokenClass` tables move from `redextape-grammar-check` into `redextape-core` and cross the existing `pkg/` wasm boundary, so `web/` holds no copy of a map that disagrees per language. `web/src/colour.ts` is one CodeMirror `ViewPlugin` per editor: it parses the document incrementally on a document change and rebuilds decorations from the existing tree on a viewport change, which are two different clocks. vim is the app's first `Compartment`.

**Tech Stack:** Rust (`redextape-core`, `redextape-grammar-check`, `redextape-wasm`), TypeScript, CodeMirror 6, `web-tree-sitter` 0.27.0, `@replit/codemirror-vim` 6.4.0, Vite 8.2.1, Vitest 4.1.10, bash + python3 for the gate.

**Design:** [`2026-09-20-plan7-part3-editor-intelligence-design.md`](../specs/2026-09-20-plan7-part3-editor-intelligence-design.md), as amended at `4ef3de1` and `54acbcf`. §6, §7, §9, §10, §11.1–§11.5. **§8 is not this PR** — hover is 3c.

**Branch:** `plan7-part3b-colour-and-vim`, off `79b0f14` (3a's squash merge).

---

## What the pre-flight already proved, and what it did not

Everything in this section was run on this branch before the plan was written. **Do not re-measure it.
Do not treat anything outside it as settled.**

**Proved:**

- **The four `.wasm` build and reproduce §14's sizes to the byte** — 16,684 / 2,514 / 17,079 / 8,081,
  totalling 44,358 — from `.tools/tree-sitter build --wasm --docker`, CLI 0.25.10, image
  `emscripten/emsdk:4.0.4` already in the local docker store. They are **on disk in the working tree
  already**, still `.gitignore`d.
- **The build is byte-reproducible.** `tree-sitter-redextape.wasm` hashed
  `33d9a74347ba77afbdd854a7f05c5a96a08c9dec4cb5fa19f4db09f1671eb35d` twice, the second time after
  deleting the artefact and writing to a different output filename. This is what §7's second hash
  column rests on.
- **web-tree-sitter 0.27.0 loads all four in Chromium**, under this repo's Vitest browser project:
  ABI 15 each, `hasError` false on real `redextape emit` output. Verified by inverting the assertion
  so the probe printed its own report — the first run went green in 20 ms with no output, which is
  not evidence.
- **Tree-sitter indices are UTF-16 code units, not bytes.** `(λx. λy. x)` is 11 units and 13 bytes and
  its root `endIndex` is 11. **So the colourer must NOT use `spans.ts`'s `byteToIndex`** — that
  conversion exists for `classify_source`'s byte offsets, and applying it here would mis-place every
  span after the first non-ASCII character.
- **Viewport scoping reproduces §6.2**: a 229,181-unit TM yields 82,464 whole-document captures and
  897 for a 60-line viewport. **This bullet read 420 and was wrong**, along with every other viewport
  figure this plan was written from — see the `QueryOptions` note below.
- **Incremental reparse is worth twenty times its complexity**, measured in Chromium on a
  103,028-unit TM: full 8.1 ms, incremental 0.4 ms, whole-document query 12.8 ms / 32,591 captures,
  viewport query below the browser's timer resolution / 293 captures (recorded as 88 before the
  doubling was found).
- **A `ViewPlugin` with an async grammar shows 0 decorations before the load and some after**, once an
  empty `view.dispatch({})` provokes a recompute.
- **A relative `?url` import escaping the Vite root works in dev, in the Vitest browser project and in
  a production build.** Vite emits it to `dist/assets/<name>-<hash>.wasm` and the bundle names it. No
  `public/` copy step is needed.
- **`web-tree-sitter@0.27.0` is already installed** as a `devDependency`; `web/package.json` and
  `web/pnpm-lock.yaml` are modified in the working tree.

**PROVED WRONG LATER, AND THE FIGURES ABOVE ARE THE CORRECTED ONES.** `QueryOptions.startIndex` and
`endIndex` in web-tree-sitter 0.27.0 are **2 × UTF-16 code units**, while `node.startIndex` on the
captures they return is plain code units. Every pre-flight probe passed a code-unit count straight
through, so every viewport figure measured half its labelled window, and the colourer written from
them queried half a viewport — the lower half of the screen would have rendered bare. Caught by a
review, not by a test, and the regression test that now exists was written after the fact.

**NOT proved, and each is a real risk this plan carries:**

- Nothing about `@replit/codemirror-vim` has been run. Only its `package.json` was read.
- No CodeMirror `ChangeSet` has been converted into a tree-sitter `Edit`. Task 3 does that first and
  Task 3's tests are where it is shown to work.
- The Docker image has not been built with `grammars/` in it.
- No coverage figure has been taken.

---

## Global Constraints

Copied from the design and from the tree. Every task's requirements implicitly include these.

- **`web-tree-sitter` is `0.27.0`, `@replit/codemirror-vim` is `6.4.0`.** Both confirmed current on
  crates/npm on 2026-09-21. `@replit/codemirror-vim` peer-depends on **five** CodeMirror packages;
  `@codemirror/language` and `@codemirror/search` are absent from `web/package.json` and must be added.
- **The pinned tree-sitter CLI is `0.25.10`, at `.tools/tree-sitter`.** `/usr/sbin/tree-sitter` reports
  0.28.0 and is Arch's `-git` build; it must never build these artefacts.
- **One colour is added, and no other.** This read *"No colour is added"* against seven palette tokens
  until a visual check of all six preset combinations found the λ editor drawing two colours for the
  three classes its grammar reaches — `--tok-ident` is `--fg` everywhere and `--tok-punct` is
  `--tok-neutral` in both dark variants — so `tok-binder` was added as an eighth token, in the same PR
  rather than deferred. Every capture must still land on one of the fourteen `.tok-*` classes
  `style.css` styles, now from eight palette tokens. `scripts/check-colours.sh` enforces this — and it
  scans `web/src/*.ts` **non-recursively**, so every new web file goes flat in `web/src/`, never in a
  subdirectory.
- **Rust style:** `///` doc comments, never `//!` inside an item. `file:line` is banned in tracked
  source and normal in `docs/`. TypeScript uses `/** */`.
- **Every commit runs the pre-commit gate**, which includes `cargo clippy --workspace --all-targets --
  -D warnings`. Never `--no-verify`. A commit that cannot pass clippy is a commit that must be merged
  into its neighbour.
- **`web/tsconfig.json` sets `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax` and `skipLibCheck`.** Indexing an array yields `T | undefined`; an optional
  field cannot be assigned an explicit `undefined`; type-only imports need `import type`.
- **`pnpm install --frozen-lockfile` runs in CI and in Docker**, so `web/pnpm-lock.yaml` is regenerated
  in the same commit as any dependency change.
- **Coverage floors are `{ lines: 97, functions: 97, branches: 89, statements: 95 }`** in
  `web/vite.config.ts`, merged across the node and browser projects. A new `web/src/*.ts` file counts
  at 0% until a test drives it, and **v8 cannot see code running inside a Worker** — which is why the
  colourer runs on the main thread.
- **Every figure written into prose is produced by a command run before the commit that writes it.**

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `grammars/wasm-manifest.json` | Per grammar, the SHA-256 of `src/parser.c` and of the `.wasm` built from it. Data only. |
| `scripts/check-grammar-wasm.sh` | Recomputes both hashes and refuses a mismatch. `--self-test`, `--rebuild`. |
| `crates/redextape-core/src/capture_map.rs` | The four capture-name → `TokenClass` tables and a lookup. Pure data; no tree-sitter. |
| `web/src/colour.ts` | The grammar registry and the colourer `ViewPlugin`. The only new `web/src` file. |
| `web/tests/node/colour.test.ts` | The colourer's pure parts: the class map, the ceiling, the failure path. |
| `web/tests/browser/colour.test.ts` | §11.2's colour row: one editor per language, class **and** computed colour. |
| `web/tests/browser/grammar-differential.test.ts` | §11.3: the browser's captures against Rust's golden fixture. |
| `grammars/capture-golden.json` | §11.3's authority, emitted and verified by a Rust test. |
| `web/tests/browser/vim-keymap.test.ts` | §9: the compartment switches, and vim owns keys in a focused editor. |

**Modified:**

| Path | Change |
|---|---|
| `.gitignore` | Four negations for the committed `.wasm`, with a comment. |
| `scripts/check-all.sh` | A `base\|grammarwasm\|` leg, a `do_leg` arm, a `check_legs` allowlist entry, and its stale hook count. |
| `.forgejo/workflows/ci.yml` | An eighth hygiene pair in `linear-history`, and its stale step count and enumeration. |
| `.pre-commit-config.yaml` | A twelfth hook. |
| `crates/redextape-core/src/lib.rs` | `pub mod capture_map;` |
| `crates/redextape-grammar-check/src/{mini,lambda,tm,asm}.rs` | Consume the tables from core instead of declaring them. |
| `crates/redextape-wasm/src/lib.rs` | A `captureClasses()` export; the `classifySource` export is deleted. |
| `web/src/highlight.ts` | `setSpans`, `build` and `highlighting` deleted; the three marks stay. |
| `web/src/main.ts` | The colourer and the vim compartment in the source editor; the `classifySource` path removed. |
| `web/src/scratch-editor.ts` | The colourer and the vim compartment; the "NO SYNTAX HIGHLIGHTING" doc rewritten. |
| `web/src/theme.ts` | Its stale count sentence. |
| `web/package.json`, `web/pnpm-lock.yaml` | `web-tree-sitter`, `@replit/codemirror-vim`, `@codemirror/language`, `@codemirror/search`. |
| `Dockerfile` | `COPY grammars/ /app/grammars/` in stage 2. |
| `web/tests/browser/app.test.ts` | Its synchronous-highlighting contract. |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | The entry, written before the PR is opened. |

---

## Task 1: The four `.wasm` become tracked, and a two-hash manifest gate holds them

**Files:**
- Create: `scripts/check-grammar-wasm.sh`
- Create: `grammars/wasm-manifest.json` (by running the script)
- Modify: `.gitignore`
- Modify: `scripts/check-all.sh`
- Modify: `.forgejo/workflows/ci.yml`
- Modify: `.pre-commit-config.yaml`
- Add: the four `grammars/tree-sitter-*/tree-sitter-*.wasm`

**Interfaces:**
- Produces: `scripts/check-grammar-wasm.sh`, taking no argument (scan), `--self-test`, or `--rebuild`.
  Exit 0 on agreement, 1 with a message on stderr otherwise. Nothing else in this plan calls it; CI,
  `check-all.sh` and the pre-commit hook do.
- Produces: the four committed `.wasm`, which Task 3 imports by `?url`.

- [ ] **Step 1: Write the gate, self-test first**

The self-test is the test, and it drives the same `verify` the real scan drives — the invariant every
sibling gate states. Create `scripts/check-grammar-wasm.sh`:

```bash
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
```

Then `chmod +x scripts/check-grammar-wasm.sh`.

- [ ] **Step 2: Run the self-test and read every line of its output**

Run: `bash scripts/check-grammar-wasm.sh --self-test`
Expected: exit 0 and exactly the line
`self-test passed: a stale .wasm, a tampered .wasm, a missing .wasm and an unlisted grammar are each refused, and a matching pair is not`

If it exits 0 without that line, the self-test did not run — investigate before continuing.

- [ ] **Step 3: Prove the self-test can fail**

Temporarily replace the `bad.append` for `wasm_sha256` with `pass` (in the `for field, what` loop),
re-run `--self-test`, and confirm it now exits 1 with
`self-test: a .wasm replaced by hand with parser.c untouched was accepted`. Restore the line and
re-run to confirm it passes again. **A self-test nobody has seen fail is a self-test nobody has
tested**, and this is the half that the design's first draft did not have at all.

- [ ] **Step 4: Un-ignore the four artefacts**

The four `.wasm` are already built and sitting in the working tree. In `.gitignore`, immediately after
the line `*.wasm`, add:

```gitignore
# ...except the four committed grammar parsers, which the web app loads through `web-tree-sitter` and
# which CI must not have to build: `tree-sitter build --wasm` needs emscripten or docker and the
# runner has neither. `scripts/check-grammar-wasm.sh` holds each one to the `src/parser.c` beside it
# and to its own recorded bytes. Negated one path at a time rather than by a directory glob, which
# would also admit a stray build output; the file's other negation, `!.env.example`, sits adjacent to
# what it negates and these cannot, which is why they carry this comment.
!grammars/tree-sitter-redextape/tree-sitter-redextape.wasm
!grammars/tree-sitter-redextape-lambda/tree-sitter-redextape-lambda.wasm
!grammars/tree-sitter-redextape-tm/tree-sitter-redextape-tm.wasm
!grammars/tree-sitter-redextape-asm/tree-sitter-redextape-asm.wasm
```

- [ ] **Step 5: Confirm the negations took, and that the sizes are the design's**

Run:
```bash
git status --porcelain --untracked-files=all -- grammars | grep '\.wasm$'
git add -n grammars/tree-sitter-redextape/tree-sitter-redextape.wasm
stat -c '%n %s' grammars/*/*.wasm
```
Expected: the four `.wasm` appear as untracked-but-addable (`??`), the dry-run `add` reports it would
add the file rather than refusing it, and the four sizes are `16684`, `2514`, `17079`, `8081`.

**Do NOT verify this with `git check-ignore`**, which was this step's first draft and tests the wrong
property. `check-ignore -v` exits **0 whenever a pattern MATCHES**, and a negation is a match — so an
ignored file and a successfully un-ignored one both exit 0, differing only in whether the printed
pattern starts with `!`. Worse, its answer flips on tracked state: git skips ignore processing
entirely for a tracked file, so the same command exits 0 before the commit and 1 after it, for a
`.gitignore` that never changed. `git status`/`git add -n` ask the question this step actually means.

- [ ] **Step 6: Write the manifest from what is on disk, and verify it**

Run:
```bash
bash scripts/check-grammar-wasm.sh --rebuild
cat grammars/wasm-manifest.json
bash scripts/check-grammar-wasm.sh
```
Expected: the rebuild prints `wrote 4 grammar(s)`, the manifest has four rows each with both hashes,
`tree-sitter-redextape`'s `wasm_sha256` is
`33d9a74347ba77afbdd854a7f05c5a96a08c9dec4cb5fa19f4db09f1671eb35d`, and the scan prints
`check-grammar-wasm: 4 grammar .wasm match their parser.c and their recorded bytes.`

If the hash differs, **stop**: the build is not reproducing and §7's second column is unfounded.

- [ ] **Step 7: Prove the real scan fails on a real tampered artefact**

Run:
```bash
printf 'x' >> grammars/tree-sitter-redextape-asm/tree-sitter-redextape-asm.wasm
bash scripts/check-grammar-wasm.sh; echo "exit=$?"
git checkout -- grammars/tree-sitter-redextape-asm/tree-sitter-redextape-asm.wasm 2>/dev/null \
  || bash scripts/check-grammar-wasm.sh --rebuild
bash scripts/check-grammar-wasm.sh
```
Expected: the middle run exits 1 naming `tree-sitter-redextape-asm/tree-sitter-redextape-asm.wasm` and
`wasm_sha256`, and the last run passes. (The file is not yet committed at this point, so `git checkout`
will not restore it — the `--rebuild` fallback is what does.)

- [ ] **Step 8: Wire the leg into `scripts/check-all.sh`**

Three edits, and omitting the third is a hard `exit 1` at script start.

In the `LEGS` table, after `"base|grammar|"`:
```
  "base|grammarwasm|"
```
In `check_legs`'s allowlist, change
`fmt|clippy|build|test|probe|wasmprobe|wasm|browserprobe|browser|grammar) ;;` to
`fmt|clippy|build|test|probe|wasmprobe|wasm|browserprobe|browser|grammar|grammarwasm) ;;`.
In `do_leg`, after the `grammar)` arm:
```bash
    # NOT a `cargo` leg, and unlike `grammar)` above it needs no tree-sitter CLI: it hashes four
    # `parser.c` and four `.wasm` and compares them to a manifest. Cheap enough to sit beside the
    # other grammar leg at the top of the tier.
    grammarwasm) run scripts/check-grammar-wasm.sh --self-test && run scripts/check-grammar-wasm.sh ;;
```

- [ ] **Step 9: Correct `check-all.sh`'s hook count, by counting**

Line 8 reads `# Nine hooks; this is the before-a-merge check.` It is **already wrong**: the tree has
eleven hooks before this task and twelve after. Count them rather than incrementing:

Run: `grep -c '^      - id: ' .pre-commit-config.yaml`
Then set the line to `# Twelve hooks; this is the before-a-merge check.` once Step 11 has added the
twelfth, and re-run the count to confirm it says `12`.

- [ ] **Step 10: Wire the pair into `.forgejo/workflows/ci.yml`, and correct its count by counting**

In the `linear-history` job, after the two colour steps and before
`- name: Install a Lua interpreter for the gate below`:

```yaml
      - name: Prove the grammar .wasm detector still detects
        run: scripts/check-grammar-wasm.sh --self-test
      - name: Reject a committed grammar .wasm that no longer matches its parser.c or its recorded bytes
        run: scripts/check-grammar-wasm.sh
```

The header comment above the job is wrong in two ways and both must be fixed. Count first:

Run:
```bash
awk '/^  linear-history:/{f=1} f && /^  [a-z-]+:$/ && !/linear-history/{exit} f' .forgejo/workflows/ci.yml \
  | grep -c '^      - name: Prove\|^      - name: Reject'
```
Before this task that reports **15** — seven self-test/scan pairs plus the merge-commit step — so the
hygiene pairs number **seven**, not the five the comment enumerates, and the steps number **fourteen**,
not ten. The comment omits the attribution pair and the colour pair entirely. Replace the first
sentence and its falsification note with:

```yaml
  # THE SIXTEEN HYGIENE STEPS BELOW ARE UNCONDITIONAL AND ARE THE REASON THIS JOB IS STILL A REQUIRED
  # CONTEXT ON PULL REQUESTS — two for control bytes, two for `file:line` citations, two for symbol
  # attributions, two for documented figures, two for shared doc regions, two for colour literals, two
  # for the tracked Lua and two for the committed grammar `.wasm`, each pair a self-test followed by a
  # scan. They are what a PR needs from this job; the merge check never was.
  # **THIS SENTENCE HAS NOW BEEN FALSIFIED SIX TIMES, AND THE SIXTH CORRECTION FOUND IT HAD BEEN WRONG
  # TWICE OVER ALREADY.** It said "the control-byte steps" until the citation branch's whole-branch
  # review, "FOUR" until the figure pair, "SIX" until the Lua pair and "EIGHT" until the shared-doc
  # pair — and then read "TEN" while the job in fact ran fourteen, because the attribution pair and the
  # colour pair had each been added without touching it and its enumeration listed neither. The count
  # above was taken by counting the steps, not by adding two to the last wrong number.
```

- [ ] **Step 11: Add the twelfth pre-commit hook**

In `.pre-commit-config.yaml`, after the `check-colours` hook:

```yaml
      # UNSCOPED, like every gate above it except `check-lua`, and for a reason this one can state
      # exactly: the file that goes stale is `grammars/<g>/<g>.wasm` and the file being committed is
      # `grammars/<g>/grammar.js` or `src/parser.c`. `check-lua` below is already scoped to
      # `^grammars/.*/src/parser\.c$` for its own reasons, which is the same input set seen from the
      # other side; this hook stays unscoped so that a hand-edited artefact is caught too, which is
      # the whole point of its second hash. Self-test first, then the scan.
      - id: check-grammar-wasm
        name: committed grammar .wasm match their parser.c
        entry: bash -c 'scripts/check-grammar-wasm.sh --self-test && scripts/check-grammar-wasm.sh'
        language: system
        always_run: true
        pass_filenames: false
```

- [ ] **Step 12: Run the whole leg the way CI will**

Run:
```bash
bash scripts/check-all.sh --list | grep grammarwasm
bash scripts/check-grammar-wasm.sh --self-test && bash scripts/check-grammar-wasm.sh
grep -c '^      - id: ' .pre-commit-config.yaml
```
Expected: the leg is listed, the gate passes both halves, and the hook count is `12`.

- [ ] **Step 13: Commit**

```bash
git add .gitignore grammars/wasm-manifest.json grammars/tree-sitter-*/tree-sitter-*.wasm \
        scripts/check-grammar-wasm.sh scripts/check-all.sh .forgejo/workflows/ci.yml .pre-commit-config.yaml
git commit
```
Message subject: `The four grammar .wasm become tracked artefacts, gated on their parser.c AND their own bytes`.
The body states the byte sizes, the reproducibility measurement, and that the CI comment's count was
already wrong by two pairs before this change touched it.

---

## Task 2: The capture tables move to `redextape-core` and cross the wasm boundary

**Files:**
- Create: `crates/redextape-core/src/capture_map.rs`
- Modify: `crates/redextape-core/src/lib.rs`
- Modify: `crates/redextape-grammar-check/src/mini.rs`, `lambda.rs`, `tm.rs`, `asm.rs`
- Modify: `crates/redextape-wasm/src/lib.rs`

**Interfaces:**
- Produces (Rust): `redextape_core::capture_map::{LanguageCaptures, CAPTURE_MAPS, capture_class}`.
  `CAPTURE_MAPS: &[LanguageCaptures]`, `LanguageCaptures { language_id: &'static str, rows: &'static [(&'static str, TokenClass)] }`,
  `capture_class(language_id: &str, capture: &str) -> Option<TokenClass>`.
- Produces (JS): `captureClasses()` from `../../pkg/redextape_wasm.js`, returning
  `[languageId: string, rows: [captureName: string, tokenClass: string][]][]`. Task 3 consumes it.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing test for the new core module**

Create `crates/redextape-core/src/capture_map.rs` containing **only** the tests, so the module fails to
compile for the right reason:

```rust
#[cfg(test)]
mod tests {
    use super::{CAPTURE_MAPS, capture_class};
    use crate::analysis::TokenClass;

    /// The four `languageId` strings, in the order the LSP client sends them.
    #[test]
    fn the_four_languages_are_present_and_named_as_the_protocol_names_them() {
        let ids: Vec<_> = CAPTURE_MAPS.iter().map(|m| m.language_id).collect();
        assert_eq!(ids, ["redextape", "redextape_lambda", "redextape_tm", "redextape_asm"]);
    }

    /// **THE THREE DISAGREEMENTS ARE THE REASON THERE ARE FOUR TABLES AND NOT ONE.** A merged table
    /// would have to pick a winner for each of these rows, and every choice mis-colours one language:
    /// an asm mnemonic would read as an identifier, or a λ binder would.
    #[test]
    fn the_tables_disagree_on_exactly_the_three_captures_that_must_disagree() {
        assert_eq!(capture_class("redextape", "function"), Some(TokenClass::Ident));
        assert_eq!(capture_class("redextape_asm", "function"), Some(TokenClass::Mnemonic));
        assert_eq!(capture_class("redextape", "variable.parameter"), Some(TokenClass::Ident));
        assert_eq!(capture_class("redextape_lambda", "variable.parameter"), Some(TokenClass::Binder));
        assert_eq!(capture_class("redextape_tm", "label.reference"), Some(TokenClass::StateName));
        assert_eq!(capture_class("redextape_asm", "label.reference"), Some(TokenClass::Label));
    }

    /// A duplicate key would make the table's meaning depend on lookup order.
    #[test]
    fn no_table_has_a_duplicate_capture_name() {
        for m in CAPTURE_MAPS {
            let mut names: Vec<_> = m.rows.iter().map(|(n, _)| *n).collect();
            names.sort_unstable();
            let before = names.len();
            names.dedup();
            assert_eq!(names.len(), before, "{} has a duplicate capture name", m.language_id);
        }
    }

    /// An unknown language or an unknown capture answers `None` rather than a default class, because a
    /// default would colour a capture nobody mapped and hide the omission.
    #[test]
    fn an_unknown_language_or_capture_answers_none() {
        assert_eq!(capture_class("redextape", "no.such.capture"), None);
        assert_eq!(capture_class("no_such_language", "keyword"), None);
    }

    /// The row counts, so a row deleted by accident is a failure rather than a quieter colouring.
    #[test]
    fn the_row_counts_are_eleven_five_eleven_and_nine() {
        let counts: Vec<_> = CAPTURE_MAPS.iter().map(|m| m.rows.len()).collect();
        assert_eq!(counts, [11, 5, 11, 9]);
    }
}
```

Add `pub mod capture_map;` to `crates/redextape-core/src/lib.rs`, in alphabetical position between
`pub mod binder;` and `pub mod core;`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core capture_map`
Expected: FAIL — `cannot find value CAPTURE_MAPS in this scope` and `cannot find function capture_class`.

- [ ] **Step 3: Write the module**

Above the `#[cfg(test)]` block in `crates/redextape-core/src/capture_map.rs`:

```rust
//! Tree-sitter capture names to `TokenClass`, one table per language.
//!
//! **HERE RATHER THAN IN `redextape-grammar-check`, WHICH IS WHERE THESE TABLES USED TO LIVE.** That
//! crate is test-only and links four generated `parser.c` through a `cc` build script, so nothing that
//! ships can depend on it and nothing in a browser can call it. The tables themselves are neither
//! test-only nor tree-sitter-shaped: they are `&[(&str, TokenClass)]`, pure data, and the web app needs
//! exactly them to colour an editor. Moving them here keeps this crate WASM-clean — no `tree-sitter`
//! dependency arrives with them — and lets `redextape-wasm` export them, so `web/` holds no hand copy.
//!
//! **THE ALTERNATIVE WAS A HAND-WRITTEN TYPESCRIPT MIRROR HELD EQUAL BY A DRIFT TEST, AND IT WAS
//! DECLINED.** A map that disagrees per language in three places is precisely the shape a hand copy
//! gets wrong, and a drift test over a copy is a weaker claim than having no copy. It is the same
//! argument `redextape-wasm`'s `token_classes` and `encodings` already make one layer up: a list of
//! names in another language is a second authoritative registry that not even the compiler is
//! watching.
//!
//! **WHAT STAYS IN `redextape-grammar-check` IS EVERYTHING THAT TIES A TABLE TO A QUERY.** Totality
//! over the shipped `highlights.scm`, and the rule that no row goes unused, need the queries and the
//! grammars; they are tests about a grammar, not facts about a naming map.

use crate::analysis::TokenClass;

/// One language's capture table, keyed by the `languageId` the LSP client sends.
///
/// **KEYED BY `languageId` AND NOT BY GRAMMAR DIRECTORY NAME.** The four ids are already the one name
/// the whole system uses for these languages — the client sends them, `Language::from_language_id`
/// matches them, and a test holds those two sets equal. A second spelling keyed off `grammars/`'s
/// directory names would be a third naming scheme for four things that already have two.
pub struct LanguageCaptures {
    pub language_id: &'static str,
    pub rows: &'static [(&'static str, TokenClass)],
}

/// The mini-language. `@function.call` and `@variable` both project to `Ident`, so the extra
/// granularity on the left is deliberately unchecked by the differential.
const REDEXTAPE: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("boolean", TokenClass::Bool),
    ("number", TokenClass::Nat),
    ("comment", TokenClass::Comment),
    ("operator", TokenClass::Operator),
    ("punctuation.bracket", TokenClass::Punct),
    ("punctuation.delimiter", TokenClass::Punct),
    ("function", TokenClass::Ident),
    ("function.call", TokenClass::Ident),
    ("variable", TokenClass::Ident),
    ("variable.parameter", TokenClass::Ident),
];

/// λ. `@variable.parameter` is a `Binder` here and an `Ident` in the mini-language, because
/// `print_lambda_mapped` folds the bound name into the binder and the mini-language's classifier calls
/// a parameter an identifier. Both are right for their own language.
const REDEXTAPE_LAMBDA: &[(&str, TokenClass)] = &[
    ("keyword.function", TokenClass::Binder),
    ("variable.parameter", TokenClass::Binder),
    ("variable", TokenClass::Ident),
    ("punctuation.delimiter", TokenClass::Punct),
    ("punctuation.bracket", TokenClass::Punct),
];

/// TM. `@label.reference` is a `StateName` here and a `Label` in asm, because TM keeps a state name's
/// defining and referencing positions apart and asm folds both label positions into one class.
const REDEXTAPE_TM: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("number", TokenClass::Nat),
    ("label", TokenClass::Label),
    ("label.reference", TokenClass::StateName),
    ("variable", TokenClass::Ident),
    ("type", TokenClass::Ident),
    ("character", TokenClass::TapeSymbol),
    ("constant.builtin", TokenClass::Move),
    ("comment", TokenClass::Comment),
    ("punctuation.bracket", TokenClass::Punct),
    ("punctuation.delimiter", TokenClass::Punct),
];

/// asm. `@function` is a `Mnemonic` here and an `Ident` in the mini-language — the single row that
/// most obviously breaks if the four tables are merged.
const REDEXTAPE_ASM: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("type", TokenClass::Ident),
    ("function", TokenClass::Mnemonic),
    ("variable.builtin", TokenClass::Register),
    ("number", TokenClass::Nat),
    ("label", TokenClass::Label),
    ("label.reference", TokenClass::Label),
    ("punctuation.delimiter", TokenClass::Punct),
    ("comment", TokenClass::Comment),
];

/// Every language's table, in the order the protocol lists the ids.
pub static CAPTURE_MAPS: &[LanguageCaptures] = &[
    LanguageCaptures { language_id: "redextape", rows: REDEXTAPE },
    LanguageCaptures { language_id: "redextape_lambda", rows: REDEXTAPE_LAMBDA },
    LanguageCaptures { language_id: "redextape_tm", rows: REDEXTAPE_TM },
    LanguageCaptures { language_id: "redextape_asm", rows: REDEXTAPE_ASM },
];

/// The class a capture projects to in one language, or `None`.
///
/// `None` rather than a fallback class, for both misses. A default would colour a capture nobody
/// mapped, which turns an omission into a quiet miscolouring instead of a visible gap.
#[must_use]
pub fn capture_class(language_id: &str, capture: &str) -> Option<TokenClass> {
    let table = CAPTURE_MAPS.iter().find(|m| m.language_id == language_id)?;
    table.rows.iter().find(|(n, _)| *n == capture).map(|(_, c)| *c)
}
```

- [ ] **Step 4: Run the core tests**

Run: `cargo test -p redextape-core capture_map`
Expected: PASS, 5 tests.

- [ ] **Step 5: Point `redextape-grammar-check` at the new home**

In each of `crates/redextape-grammar-check/src/{mini,lambda,tm,asm}.rs`, delete the local
`pub const CAPTURE_CLASSES: &[(&str, TokenClass)] = &[...]` and replace it with a re-export.

**THE DOC COMMENTS ON THOSE FOUR CONSTANTS ARE NOT BOILERPLATE AND MUST BE RELOCATED SENTENCE BY
SENTENCE, NOT REPLACED.** An earlier draft of this step said "keeping each file's existing doc comment
so no prose is lost" and then showed the generic template below — and in execution the template won,
deleting three substantive paragraphs from `asm.rs` and three from `tm.rs`, including the one naming
the test that holds asm's two `Label` rows apart and the one explaining TM's `@label` /
`@label.reference` pair, which is one of the three disagreements this whole task exists to preserve.
Showing a template beside an instruction to preserve prose is an instruction to template over it.

So: read each file's existing doc comment first, and place each of its sentences by what it is about.

- **A fact about the TABLE** — why two rows share a class, why a row exists, why a row is absent —
  goes on the matching `pub const` in `capture_map.rs`, where the data now is.
- **A fact about what HOLDS the table to a query** — which test enforces totality, which enforces the
  no-unused-row rule, which holds two same-class captures apart — stays here, on the re-export,
  because those tests need the grammars and stay in this crate.

Split a sentence that does both; do not duplicate it. The template below is what to add *alongside*
the relocated prose, not what to replace it with:

```rust
/// Where the two vocabularies meet, for this language.
///
/// **THE TABLE MOVED TO `redextape_core::capture_map` AND THIS IS THE SAME DATA, NOT A COPY.** It moved
/// because the web app needs it and cannot link this crate: `build.rs` compiles four generated
/// `parser.c` into this one, so there is no wasm build of it. What stays here is everything that ties
/// the table to a query — totality over `HIGHLIGHTS`, and the no-unused-row rule — because those are
/// tests about a grammar rather than facts about a naming map.
pub use redextape_core::capture_map::REDEXTAPE as CAPTURE_CLASSES;
```

This requires each table to be `pub` in core rather than private. Change the four `const` declarations
in `capture_map.rs` from `const NAME:` to `pub const NAME:`, keeping the `///` doc line each already
carries.

**Those docs are a house convention, not a lint.** The workspace enables `clippy::all` and
`clippy::pedantic` at `warn` with CI at `-D warnings`, plus five restriction lints
(`unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`); it enables **neither** `missing_docs`
nor `missing_docs_in_private_items`. So an undocumented `pub` item compiles clean and is caught by
review rather than by the toolchain. What `pedantic` *will* catch here is `doc_markdown` — a bare
`languageId` or `TokenClass` in a doc comment needs backticks — and `must_use_candidate` on
`capture_class`, which is why it carries `#[must_use]`.

- [ ] **Step 6: Run the grammar-check suite, which is the real test of the move**

Run: `cargo test -p redextape-grammar-check`
Expected: PASS. In particular `the_capture_map_is_total_over_the_queries`,
`every_map_row_is_used_by_a_query` and `the_capture_map_has_no_duplicate_keys` must still pass for all
four languages — they are what proves the moved tables are the same tables.

- [ ] **Step 7: Write the failing test for the wasm export**

In `crates/redextape-wasm/src/lib.rs`'s `#[cfg(test)] mod tests` (or the crate's existing test module),
add:

```rust
/// The boundary hands over every language and every row, and adds nothing.
#[test]
fn capture_classes_carries_all_four_tables_unchanged() {
    let want: Vec<(&str, usize)> =
        redextape_core::capture_map::CAPTURE_MAPS.iter().map(|m| (m.language_id, m.rows.len())).collect();
    assert_eq!(want, vec![("redextape", 11), ("redextape_lambda", 5), ("redextape_tm", 11), ("redextape_asm", 9)]);
}
```

- [ ] **Step 8: Add the export**

In `crates/redextape-wasm/src/lib.rs`, beside `token_classes`:

```rust
/// `captureClasses()` -> `[languageId, [captureName, TokenClass][]][]`.
///
/// EXPORTED RATHER THAN MIRRORED IN TYPESCRIPT, for the reason `tokenClasses()` gives directly above:
/// a table in another language is a second authoritative registry that not even the compiler is
/// watching. This one is worse than most, because the four tables **disagree** on three capture names
/// — `@function`, `@variable.parameter` and `@label.reference` — so a hand copy that merged them would
/// colour an asm mnemonic as an identifier and nothing in either language would notice.
///
/// AN ARRAY OF PAIRS RATHER THAN AN OBJECT, because `serde-wasm-bindgen` marshals a Rust map to a JS
/// `Map` rather than to a plain object: a consumer that wrote `tables[languageId]` against a `Map`
/// would read `undefined` and never be told why. An array of tuples cannot be mistaken for an index,
/// so the consumer builds whichever one it wants.
///
/// # Errors
///
/// Returns `Err` only if `to_value` cannot marshal the tables to a JS value; not expected for this
/// crate's own types. It crosses as a thrown JS exception like any other failure at this boundary.
#[wasm_bindgen(js_name = captureClasses)]
pub fn capture_classes() -> Result<JsValue, JsValue> {
    let tables: Vec<(&str, Vec<(&str, redextape_core::analysis::TokenClass)>)> =
        redextape_core::capture_map::CAPTURE_MAPS
            .iter()
            .map(|m| (m.language_id, m.rows.iter().map(|(n, c)| (*n, *c)).collect()))
            .collect();
    to_value(&tables)
}
```

- [ ] **Step 9: Run the Rust suite and the wasm target check**

Run:
```bash
cargo test -p redextape-core -p redextape-grammar-check -p redextape-wasm
cargo check --target wasm32-unknown-unknown -p redextape-core --lib
cargo check --target wasm32-unknown-unknown -p redextape-wasm --lib
cargo clippy --workspace --all-targets -- -D warnings
```
Expected: all PASS. The wasm32 checks are what prove the move did not drag a non-wasm dependency into
core.

- [ ] **Step 10: Rebuild the wasm and confirm the export is real**

Run:
```bash
cd web && pnpm run build:wasm && grep -c 'captureClasses' ../pkg/redextape_wasm.js
```
Expected: at least 1. **`grep`ping for the name you expect is a claim about the grep**, so also run
`node -e "import('../pkg/redextape_wasm.js').then(m => console.log(Object.keys(m).sort().join(' ')))"`
from `web/` and read the whole export list.

- [ ] **Step 11: Commit**

```bash
git add crates/redextape-core/src/capture_map.rs crates/redextape-core/src/lib.rs \
        crates/redextape-grammar-check/src crates/redextape-wasm/src/lib.rs
git commit
```
Subject: `The four capture tables move to core and cross the wasm boundary, so web/ holds no copy`.

---

## Task 3: `web/src/colour.ts` — the grammar registry and the viewport-scoped colourer

**Files:**
- Create: `web/src/colour.ts`
- Create: `web/tests/node/colour.test.ts`
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: `captureClasses()` from Task 2; the four committed `.wasm` from Task 1;
  `LanguageId` and `LANGUAGE_IDS` from `web/src/lsp-protocol.ts`; `tokenClassName` from
  `web/src/theme.ts`; `TokenClass` from `web/src/types.ts`.
- Produces: `classMapFrom(tables)`, `COLOUR_CEILING_UNITS`, `createGrammarRegistry(opts)` returning
  `{ load(id): Promise<LoadedGrammar | null> }`, and `treeSitterColour(opts): Extension`. Task 4
  installs `treeSitterColour` in both editors.

- [ ] **Step 1: Write the failing node test for the pure parts**

The registry and the plugin need a browser; the class map, the ceiling and the failure bookkeeping do
not, and they are where the logic errors live. Create `web/tests/node/colour.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { COLOUR_CEILING_UNITS, classMapFrom, overCeiling } from '../../src/colour'

describe('classMapFrom', () => {
  it('keeps the four tables apart, because three captures mean different things per language', () => {
    const map = classMapFrom([
      ['redextape', [['function', 'Ident']]],
      ['redextape_asm', [['function', 'Mnemonic']]],
    ])
    expect(map.get('redextape')?.get('function')).toBe('tok-ident')
    expect(map.get('redextape_asm')?.get('function')).toBe('tok-mnemonic')
  })

  it('answers undefined for a capture no table maps, rather than a default class', () => {
    // A default would paint a capture nobody mapped, turning an omission into a quiet miscolouring.
    const map = classMapFrom([['redextape', [['keyword', 'Keyword']]]])
    expect(map.get('redextape')?.get('no.such.capture')).toBeUndefined()
    expect(map.get('no_such_language')).toBeUndefined()
  })
})

describe('overCeiling', () => {
  it('is false at the ceiling and true one unit past it', () => {
    // The boundary in both directions: `>=` here would refuse a document that exactly fits.
    expect(overCeiling(COLOUR_CEILING_UNITS)).toBe(false)
    expect(overCeiling(COLOUR_CEILING_UNITS + 1)).toBe(true)
  })

  it('has a ceiling matching the session buffer ceiling, not a number of its own', () => {
    expect(COLOUR_CEILING_UNITS).toBe(6_100_000)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm vitest run --project node tests/node/colour.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/colour"`.

- [ ] **Step 3: Write `web/src/colour.ts`**

```ts
import { RangeSetBuilder } from '@codemirror/state'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { Language as TsLanguage, Query as TsQuery, Tree } from 'web-tree-sitter'
import { Edit, Language, Parser, Query } from 'web-tree-sitter'
import runtimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import asmHighlights from '../../grammars/tree-sitter-redextape-asm/queries/highlights.scm?raw'
import asmWasmUrl from '../../grammars/tree-sitter-redextape-asm/tree-sitter-redextape-asm.wasm?url'
import lambdaHighlights from '../../grammars/tree-sitter-redextape-lambda/queries/highlights.scm?raw'
import lambdaWasmUrl from '../../grammars/tree-sitter-redextape-lambda/tree-sitter-redextape-lambda.wasm?url'
import tmHighlights from '../../grammars/tree-sitter-redextape-tm/queries/highlights.scm?raw'
import tmWasmUrl from '../../grammars/tree-sitter-redextape-tm/tree-sitter-redextape-tm.wasm?url'
import redextapeHighlights from '../../grammars/tree-sitter-redextape/queries/highlights.scm?raw'
import redextapeWasmUrl from '../../grammars/tree-sitter-redextape/tree-sitter-redextape.wasm?url'
import type { LanguageId } from './lsp-protocol'
import { tokenClassName } from './theme'
import type { TokenClass } from './types'

/**
 * The colourer, over `web-tree-sitter` and the four committed grammar `.wasm`.
 *
 * **INDICES HERE ARE UTF-16 CODE UNITS, NOT BYTES, AND THAT IS MEASURED.** Parsing `(λx. λy. x)` — 11
 * UTF-16 units, 13 UTF-8 bytes — gives a root `endIndex` of 11. CodeMirror positions are UTF-16 code
 * units too, so a tree-sitter offset goes straight into a `Decoration` range. **`spans.ts`'s
 * `byteToIndex` must not be used here.** That conversion exists for `classify_source`, whose spans are
 * byte offsets, and applying it to these would mis-place every span after the first non-ASCII
 * character — which in this app means every λ document.
 *
 * **TWO CLOCKS, AND CONFLATING THEM IS THE OBVIOUS FIRST IMPLEMENTATION.** The tree is reparsed when
 * the document changes; the decorations are rebuilt when the document changes OR the viewport moves.
 * Measured in Chromium on a 103,028-unit TM: a full reparse is 8.1 ms and an incremental one is
 * 0.4 ms, so reparsing on every scroll would cost twenty times what it buys and would grow with the
 * document where the incremental path does not.
 *
 * **THE QUERY IS SCOPED TO THE VIEWPORT AND THAT IS A REQUIREMENT, NOT AN OPTIMISATION.** The same
 * document yields 32,591 captures whole and 293 for one viewport, and a 229,181-unit TM yields 82,464
 * against 897. Tens of thousands of decorations in one `RangeSet` is the problem `virtual-list.ts`
 * already exists to avoid on the δ table.
 */

/** The `TokenClass` names as they cross the wasm boundary, paired with their capture names. */
export type CaptureTable = readonly [languageId: string, rows: readonly (readonly [string, TokenClass])[]]

/** Per language, capture name to CSS class. Built once from `captureClasses()`. */
export function classMapFrom(tables: readonly CaptureTable[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const [languageId, rows] of tables) {
    const inner = new Map<string, string>()
    for (const [capture, cls] of rows) inner.set(capture, tokenClassName(cls))
    out.set(languageId, inner)
  }
  return out
}

/**
 * The document size past which an editor goes uncoloured, in UTF-16 code units.
 *
 * THE SESSION BUFFER CEILING'S NUMBER, NOT A NUMBER OF THIS MODULE'S OWN. A document the session will
 * not hold is not one worth parsing on the main thread: a full reparse extrapolates to about 480 ms
 * there, a visible stall on every keystroke.
 *
 * **THE UNITS DIFFER AND THE DIRECTION IS WHAT MAKES THAT SAFE.** `MAX_SCRATCH_TM_BYTES` counts UTF-8
 * bytes and `doc.length` counts UTF-16 code units, so these are not the same measurement of the same
 * document. UTF-16 units are never more than UTF-8 bytes for any text, so a document the session
 * accepted is always under this ceiling too: the mismatch can only ever make this gate more
 * permissive than the session's, never less. Reusing the number rather than converting is deliberate —
 * a conversion would need the whole document's bytes counted on every keystroke to answer a question
 * whose only job is to refuse the absurd.
 */
export const COLOUR_CEILING_UNITS = 6_100_000

/** Whether a document of this length goes uncoloured. At the ceiling exactly, it does not. */
export function overCeiling(units: number): boolean {
  return units > COLOUR_CEILING_UNITS
}

type GrammarSource = { readonly wasmUrl: string; readonly highlights: string }

const SOURCES: Record<LanguageId, GrammarSource> = {
  redextape: { wasmUrl: redextapeWasmUrl, highlights: redextapeHighlights },
  redextape_lambda: { wasmUrl: lambdaWasmUrl, highlights: lambdaHighlights },
  redextape_tm: { wasmUrl: tmWasmUrl, highlights: tmHighlights },
  redextape_asm: { wasmUrl: asmWasmUrl, highlights: asmHighlights },
}

export type LoadedGrammar = { readonly language: TsLanguage; readonly query: TsQuery }

export type GrammarRegistry = { load(id: LanguageId): Promise<LoadedGrammar | null> }

/**
 * Loads a grammar once per language and remembers the answer, including a failure.
 *
 * **A FAILED LOAD IS REMEMBERED AS A FAILURE.** Retrying per editor would multiply one broken fetch by
 * the number of views and produce one notice each. Design §10: that language shows uncoloured, one
 * notice, and the other three are unaffected because each grammar loads independently.
 */
export function createGrammarRegistry(opts: {
  onFailure: (id: LanguageId, reason: string) => void
  sources?: Partial<Record<LanguageId, GrammarSource>>
  locateRuntime?: () => string
}): GrammarRegistry {
  const cache = new Map<LanguageId, Promise<LoadedGrammar | null>>()
  let started: Promise<void> | null = null
  const init = () => {
    started ??= Parser.init({ locateFile: opts.locateRuntime ?? (() => runtimeWasmUrl) })
    return started
  }
  return {
    load(id) {
      const hit = cache.get(id)
      if (hit) return hit
      const source = opts.sources?.[id] ?? SOURCES[id]
      const p = (async () => {
        try {
          await init()
          const language = await Language.load(source.wasmUrl)
          return { language, query: new Query(language, source.highlights) }
        } catch (e) {
          opts.onFailure(id, e instanceof Error ? e.message : String(e))
          return null
        }
      })()
      cache.set(id, p)
      return p
    },
  }
}

/**
 * One CodeMirror change as one tree-sitter edit.
 *
 * **ONLY FOR A SINGLE-CHANGE TRANSACTION**, which is what typing produces and what the caller checks
 * before calling this. A multi-change transaction's `fromA`/`toA` are all in the old document while its
 * `fromB`/`toB` are all in the new one, so applying them one at a time to a tree feeds tree-sitter
 * coordinates that were never simultaneously true — and an imprecise edit gives a WRONG tree, not
 * merely a slower parse. The caller drops the tree and reparses instead, which measured 8.1 ms at
 * 103,028 units.
 */
function editFor(
  before: { lineAt(pos: number): { number: number; from: number } },
  after: { lineAt(pos: number): { number: number; from: number } },
  fromA: number,
  toA: number,
  toB: number,
): Edit {
  const point = (doc: { lineAt(pos: number): { number: number; from: number } }, pos: number) => {
    const line = doc.lineAt(pos)
    return { row: line.number - 1, column: pos - line.from }
  }
  // `new Edit(...)`, NOT an object literal: `Edit` is an exported CLASS in web-tree-sitter 0.27.0,
  // carrying `editPoint`/`editRange` methods alongside its six fields, so a structurally-equal object
  // fails to typecheck (TS2739). Its constructor is a plain field assignment and touches no wasm.
  return new Edit({
    startIndex: fromA,
    oldEndIndex: toA,
    newEndIndex: toB,
    startPosition: point(before, fromA),
    oldEndPosition: point(before, toA),
    newEndPosition: point(after, toB),
  })
}

/** The colourer for one editor, whose language never changes. */
export function treeSitterColour(opts: {
  languageId: LanguageId
  registry: GrammarRegistry
  classes: () => Map<string, Map<string, string>>
  onCeiling?: (id: LanguageId) => void
}) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      #grammar: LoadedGrammar | null = null
      #parser: Parser | null = null
      #tree: Tree | null = null
      #ceilingReported = false
      #dead = false

      constructor(view: EditorView) {
        void opts.registry.load(opts.languageId).then((g) => {
          if (this.#dead || !g) return
          this.#grammar = g
          this.#parser = new Parser()
          this.#parser.setLanguage(g.language)
          // The load is async and nothing else will provoke a recompute, so ask for one. An empty
          // transaction is the cheapest way; `update` below rebuilds from it.
          view.dispatch({})
        })
      }

      update(u: ViewUpdate) {
        if (u.docChanged) this.#reparse(u)
        if (u.docChanged || u.viewportChanged || this.#tree === null) this.#rebuild(u.view)
      }

      destroy() {
        this.#dead = true
        this.#tree?.delete()
        this.#parser?.delete()
        this.#tree = null
        this.#parser = null
      }

      #reparse(u: ViewUpdate) {
        const parser = this.#parser
        if (!parser || overCeiling(u.state.doc.length)) return
        const changes: { fromA: number; toA: number; toB: number }[] = []
        u.changes.iterChanges((fromA, toA, _fromB, toB) => changes.push({ fromA, toA, toB }))
        const only = changes.length === 1 ? changes[0] : undefined
        if (only && this.#tree) {
          this.#tree.edit(editFor(u.startState.doc, u.state.doc, only.fromA, only.toA, only.toB))
          this.#tree = parser.parse(u.state.doc.toString(), this.#tree)
          return
        }
        this.#tree?.delete()
        this.#tree = parser.parse(u.state.doc.toString())
      }

      #rebuild(view: EditorView) {
        const g = this.#grammar
        const parser = this.#parser
        if (!g || !parser) return
        if (overCeiling(view.state.doc.length)) {
          if (!this.#ceilingReported) {
            this.#ceilingReported = true
            opts.onCeiling?.(opts.languageId)
          }
          this.decorations = Decoration.none
          return
        }
        this.#tree ??= parser.parse(view.state.doc.toString())
        const tree = this.#tree
        if (!tree) return
        const byCapture = opts.classes().get(opts.languageId)
        if (!byCapture) return
        const b = new RangeSetBuilder<Decoration>()
        for (const { from, to } of view.visibleRanges) {
          for (const c of g.query.captures(tree.rootNode, { startIndex: from, endIndex: to })) {
            const cls = byCapture.get(c.name)
            // An empty range is not a decoration CodeMirror accepts, and a capture on a zero-width
            // node is what an error recovery produces.
            if (cls === undefined || c.node.startIndex >= c.node.endIndex) continue
            b.add(c.node.startIndex, c.node.endIndex, Decoration.mark({ class: cls }))
          }
        }
        this.decorations = b.finish()
      }
    },
    { decorations: (v) => v.decorations },
  )
}
```

- [ ] **Step 4: Run the node test**

Run: `cd web && pnpm vitest run --project node tests/node/colour.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the node test can fail**

Change `overCeiling` to `return units >= COLOUR_CEILING_UNITS` and re-run. Expected: the boundary test
fails at `expect(overCeiling(COLOUR_CEILING_UNITS)).toBe(false)`. Restore it.
Then change `classMapFrom` to build a single merged map across languages and re-run: the first test
must fail on `tok-mnemonic`. Restore it. **A test that has not been shown to fail has not been shown to
test anything**, and the merged-map sabotage is the one that matters — it is the defect the four tables
exist to prevent.

- [ ] **Step 6: Give the Docker image the grammars**

In `Dockerfile` stage 2, immediately after `COPY --from=wasm /app/pkg-lsp /app/pkg-lsp`:

```dockerfile
# **THE COMMITTED GRAMMAR `.wasm`, AND NOTHING IN CI CATCHES THEIR ABSENCE.** `web/src/colour.ts`
# imports them as `../../grammars/<g>/<g>.wasm?url`, so `build:app` below cannot resolve them without
# this line — and the `docker` job never runs on a PR, exactly as the note in stage 1 says of
# `pkg-lsp`. `/app/grammars` beside `/app/web` is what makes the relative import resolve, the same
# placement `/app/pkg` and `/app/pkg-lsp` already use. Stage 1 does not change: these are committed
# artefacts, not built ones.
COPY grammars/ /app/grammars/
```

- [ ] **Step 7: Prove the Dockerfile line is load-bearing rather than assuming it**

Run, from the repo root:
```bash
mv grammars /tmp/grammars-moved && (cd web && pnpm run build:app); echo "exit=$?"
mv /tmp/grammars-moved grammars && (cd web && pnpm run build:app); echo "exit=$?"
```
Expected: the first `build:app` exits non-zero with an unresolved import naming a grammar path, and the
second exits 0. This is the same proof 3a had to construct by hand for `pkg-lsp`, for the same reason:
no CI job builds the image.

(`colour.ts` is not yet imported by anything at this point, so if the first build succeeds, Vite has
tree-shaken the module out — re-run this step at the end of Task 4 instead and note that here.)

- [ ] **Step 8: Commit**

```bash
git add web/src/colour.ts web/tests/node/colour.test.ts Dockerfile web/package.json web/pnpm-lock.yaml
git commit
```
Subject: `The colourer: one ViewPlugin, two clocks, and UTF-16 offsets that need no conversion`.

---

## Task 4: Both editors take the colourer, and `classify_source`'s decoration path goes

**Files:**
- Modify: `web/src/scratch-editor.ts`
- Modify: `web/src/main.ts`
- Modify: `web/src/highlight.ts`
- Modify: `web/src/theme.ts`
- Modify: `crates/redextape-wasm/src/lib.rs`
- Modify: `web/tests/browser/app.test.ts`
- Create: `web/tests/browser/colour.test.ts`

**Interfaces:**
- Consumes: `treeSitterColour`, `createGrammarRegistry`, `classMapFrom` from Task 3;
  `captureClasses()` from Task 2.
- Produces: coloured editors. Task 5's differential and Task 6's vim both build on the two edited
  extension lists.

- [ ] **Step 1: Write the failing browser test for §11.2's colour row**

Create `web/tests/browser/colour.test.ts`. It asserts the class **and** the computed colour, because a
class no stylesheet styles would satisfy a class-only assertion while rendering as plain text:

```ts
import { expect, it } from 'vitest'
import { mountApp, until } from './harness'

it('colours the source editor from its grammar, with the palette not a default', async () => {
  const app = await mountApp()
  const kw = await until(() => app.root.querySelector('.cm-content .tok-keyword'))
  expect(kw?.textContent).toBe('fn')
  const painted = getComputedStyle(kw as Element).color
  const plain = getComputedStyle(app.root.querySelector('.cm-content') as Element).color
  // `.tok-keyword` resolving to the same colour as body text is what an unstyled class looks like.
  expect(painted).not.toBe(plain)
})
```

**Before writing the rest of this file, read `web/tests/browser/harness.ts` and an existing browser
test end to end** and match their mounting helper's real names — `mountApp`/`until` above are
placeholders for whatever that harness actually exports, and the existing suite is the authority. Add
one `it` per language: source, λ copy and TM copy, each asserting a class its own grammar produces and
no other grammar does (`tok-binder` for λ, `tok-tapesymbol` for TM).

**Use real timers.** The suite's usual template calls `vi.useFakeTimers()`, and a fake clock plus an
awaited wasm fetch is a deadlock.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm vitest run --project browser tests/browser/colour.test.ts`
Expected: FAIL — no `.tok-keyword` element, because nothing installs the colourer yet.

- [ ] **Step 3: Build the registry once, in `main.ts`**

One registry for the whole app, so a grammar loads once rather than once per view. Near where
`lspClient` is built — and **before** anything that constructs an editor, for the ordering reason 3a
recorded about `lspClient` — add:

```ts
const captureTables = classMapFrom(captureClasses() as CaptureTable[])
const grammars = createGrammarRegistry({
  onFailure: (id, reason) => notices.notify(`${LANGUAGE_LABEL[id]} is showing uncoloured: ${reason}`),
})
```

`LANGUAGE_LABEL` does not exist; use whatever the app already calls these languages in user-facing
copy, per the umbrella's rule that every user-visible word is the umbrella's. If there is no such map,
add one beside `EXTENSION_OF_LANGUAGE` in `lsp-protocol.ts` and cover it with that file's existing
`satisfies Record<LanguageId, string>` pattern.

- [ ] **Step 4: Install the colourer in the source editor**

In `main.ts`'s `EditorView` construction, replace the `highlighting` entry in the extension list with:

```ts
        treeSitterColour({ languageId: 'redextape', registry: grammars, classes: () => captureTables }),
```

`declineMark`, `linkMark` and `focusMark` stay exactly where they are — they are three other fields on
three other clocks and this task does not touch them.

- [ ] **Step 5: Install the colourer in `scratch-editor.ts`**

Add to the extension list, after `lintGutter()`:

```ts
          ...(config.colour ? [config.colour] : []),
```

and add `colour?: Extension | undefined` to `ScratchEditorConfig`, documented as the colourer the caller
installs for this editor's language. **Passing it in rather than building it here**, because the
registry belongs to the app and a `ScratchEditor` should not reach for a module-level singleton — the
same reason its `client` is a config field.

Then rewrite the class doc's `NO SYNTAX HIGHLIGHTING, AND THAT IS NOT AN OVERSIGHT` block. It argued
that a colouring computed from printed output is stale the instant the user types and that λ has no
parser for buffer text. The first half is still true and is why the λ **pane's** frame spans are
unchanged; the second half is what tree-sitter answers. The replacement must say both, and must not
delete the still-true half.

- [ ] **Step 6: Delete the `classify_source` decoration path**

- `web/src/highlight.ts`: delete `setSpans`, `build`, and the `highlighting` `StateField` with its doc
  comment. Keep `declineMark`, `linkMark`, `focusMark` and their effects. Remove `decorationRanges`
  from the `./spans` import and remove the `Classified` import; `RangeSetBuilder` and `DecorationSet`
  go too if nothing else in the file uses them.
- `web/src/main.ts`: remove `highlighting` and `setSpans` from the `./highlight` import, remove
  `classifySource` from the `../../pkg/redextape_wasm.js` import, and delete both dispatch sites — the
  per-keystroke one in the source editor's `updateListener` and the boot-time seed.
- `crates/redextape-wasm/src/lib.rs`: delete the `classifySource` export and its doc comment. It now
  has no JS caller. **Confirm before deleting** with
  `grep -rn 'classifySource' web/src web/tests` — and read the whole output, since comments mentioning
  it are prose to update, not callers.
- `web/src/theme.ts` and `web/src/spans.ts`: their docs describe `classify_source` as the producer.
  `spans.ts`'s `decorationRanges` is still live for the λ pane, so its doc keeps that role and loses
  any claim about the editors. `theme.ts`'s "classify_source reaches seven" sentence is about a
  producer that no longer feeds it.

- [ ] **Step 6b: Restore the export count this branch falsified twice, and put a gate behind it**

**Two prose claims count `redextape-wasm`'s exports, and nothing checks either.** `init` is
`#[wasm_bindgen(start)]` and is not counted, so on `main` there are nine — `compile`,
`lambdaScratch`, `lambdaScratchAt`, `tmScratch`, `classifySource`, `analyze`, `encodings`,
`tokenClasses`, `tapeNames` — and `tapeNames` is the ninth. Task 2 added `captureClasses`, making it
ten and `tapeNames` tenth; deleting `classifySource` in Step 6 above makes it nine and `tapeNames`
ninth again. **Both claims are therefore true again as of this step and were false in between**, and
`check-doc-figures.sh` has no `export` derivation, so no gate saw it.

The two sites:
- `crates/redextape-wasm/src/lib.rs` — `tape_names`' doc, "The NINTH export."
- `README.md`, around line 17 — "compiles the compiler to WASM through **nine exports** — the ninth,
  `tapeNames()`, ...".

Confirm both read nine after Step 6, by counting rather than by assuming:
```bash
grep -c '^#\[wasm_bindgen' crates/redextape-wasm/src/lib.rs
grep -n 'wasm_bindgen(start)' crates/redextape-wasm/src/lib.rs
```

Then **add an `exports` derivation to `scripts/check-doc-figures.sh`** covering the README claim, so
the number stops being prose nothing checks. An ordinal that moves whenever any export is added, with
no gate behind it, is the exact shape this repository keeps retracting — `.pre-commit-config.yaml`'s
hook comments and the `linear-history` CI header each carry their own retraction of one. Extend the
script's `--self-test` in the same edit, per its existing convention that a derivation is proven by
driving the real thing.

**The same README paragraph also says the source pane has "live syntax highlighting".** After Step 4
the colouring waits on a grammar fetch, so that word is no longer accurate; reword it to say what is
now true rather than deleting the clause.

- [ ] **Step 7: Fix the control test whose contract changed**

`web/tests/browser/app.test.ts`'s `highlights keywords synchronously and reports both legs` asserts
`.tok-keyword` appears in the same dispatch as the document. That is now false by design: the grammar
loads asynchronously. Change the test to await the class rather than assert it synchronously, and
**change its name**, because a test named for synchrony that awaits is a test whose name lies. Record
in its comment that the synchrony was real and was given up deliberately for one mechanism across four
languages.

- [ ] **Step 8: Run the browser suite**

Run:
```bash
cd web && pnpm run build:wasm && pnpm vitest run --project browser tests/browser/colour.test.ts tests/browser/app.test.ts
```
Expected: PASS.

- [ ] **Step 9: Prove the colour test can fail**

Make `classMapFrom` return an empty map and re-run `colour.test.ts`. Expected: every language's test
fails on a missing element. Restore. Then make `#rebuild` query `tree.rootNode` with no range options
and re-run: the tests still pass, which is the point — **the viewport scoping is a cost property, not a
correctness property, and no test in this file can see it.** Task 7 is where it gets measured. Record
that in the test file's doc rather than implying coverage it does not have.

- [ ] **Step 10: Run Task 3 Step 7's Docker proof, now that the import is reachable**

Run the `mv grammars` sequence from Task 3 Step 7. Expected: `build:app` now exits non-zero without
`grammars/` and 0 with it.

- [ ] **Step 11: Commit**

```bash
git add web/src crates/redextape-wasm/src/lib.rs web/tests/browser
git commit
```
Subject: `Both editors colour from their grammar, and the classifySource decoration path is deleted`.

---

## Task 5: The grammar differential — a Rust-emitted golden fixture the browser checks

**Files:**
- Create: `grammars/capture-golden.json`
- Create: `crates/redextape-grammar-check/tests/golden.rs`
- Create: `web/tests/browser/grammar-differential.test.ts`

**Interfaces:**
- Consumes: the committed `.wasm` from Task 1; `classMapFrom` from Task 3.
- Produces: `grammars/capture-golden.json`, shape
  `{ "<languageId>": { "<fixtureName>": { "src": string, "spans": [[start, end, "TokenClass"], ...] } } }`,
  with `start`/`end` as **UTF-16 code unit offsets**.

- [ ] **Step 1: Decide the unit, and write it down before writing either side**

Rust `Span` is byte offsets; tree-sitter in the browser gives UTF-16 code units. The fixture must state
one unit and one side must convert. **The fixture is written in UTF-16 code units**, converted on the
Rust side, because the browser side is the one whose correctness this test exists to check and a
conversion there would be a second thing that could be wrong. A λ fixture containing `λ` is mandatory —
without one, both units agree and the test proves nothing about the choice.

- [ ] **Step 2: Write the failing Rust test**

Create `crates/redextape-grammar-check/tests/golden.rs`. It emits when `REDEXTAPE_WRITE_GOLDEN=1` and
otherwise verifies, so CI fails on a stale fixture without writing anything:

```rust
//! The authority `web/tests/browser/grammar-differential.test.ts` compares against.
//!
//! **THIS CRATE CANNOT RUN IN A BROWSER**, which is why the comparison goes through a file. `build.rs`
//! compiles four generated `parser.c` into this crate through `cc`, so there is no wasm build of it and
//! no `Language::load`. Emitting what it computes and having the browser recompute the same thing from
//! the committed `.wasm` is what turns "the two agree" into something a test can hold.
//!
//! **OFFSETS ARE UTF-16 CODE UNITS, NOT BYTES.** `Span` is bytes here and tree-sitter hands the browser
//! UTF-16, so one side must convert and it is this one — the browser side is what this test exists to
//! check, and a conversion there would be a second thing that could be wrong. The λ fixture carries a
//! `λ`, which is the only reason the choice is observable at all.
```

with a test that, for each of the four languages and a handful of fixtures, computes
`Grammar::captures`, converts each `Span` to UTF-16 offsets against the fixture text, and either writes
or compares `grammars/capture-golden.json`.

**The fixtures must be real emitted output, not hand-written** — because emitted output cannot be
syntactically wrong, which is a stronger guarantee than care. (An earlier draft said hand-written TM and
asm "parse with `hasError` true". That is false: `redextape-grammar-check`'s hand-typed TM corpus parses
clean and its tests assert it. The claim generalised from two pre-flight fixtures whose syntax was
guessed at, which is a fact about the guesser, not about typing.) Use the existing tracked fixtures
under `crates/redextape-core/tests/fixtures/` and the mini-language corpus in `mini.rs`, and keep each
fixture small enough that the golden file stays reviewable.

- [ ] **Step 3: Run it to verify it fails, then emit**

Run: `cargo test -p redextape-grammar-check --test golden`
Expected: FAIL — the golden file does not exist.

Run: `REDEXTAPE_WRITE_GOLDEN=1 cargo test -p redextape-grammar-check --test golden`
Then re-run without the variable. Expected: PASS.

- [ ] **Step 4: Prove the verify half can fail**

Edit one span's end offset in `grammars/capture-golden.json` by one and re-run the test without the
env var. Expected: FAIL naming the language, the fixture and the offset. Restore with the emit run.
**A fixture that is only ever written is not a gate.**

- [ ] **Step 5: Write the browser side**

Create `web/tests/browser/grammar-differential.test.ts`, importing the golden file with `?raw` (or as
JSON) and, for each language and fixture, loading the committed `.wasm`, running the committed query,
and collapsing captures **the same way the Rust side does**: into a map keyed by `(start, end)`,
refusing two captures on one range that disagree, then offset-ordered. Assert equality against the
golden spans.

**The collapse is not optional.** `Grammar::captures` returns one entry per byte range with
disagreements rejected; a raw capture list is a different sequence and comparing it would be a
reconciliation dressed as an equality.

- [ ] **Step 6: Run it, then prove it can fail**

Run: `cd web && pnpm vitest run --project browser tests/browser/grammar-differential.test.ts`
Expected: PASS.

Then swap two grammars' `.wasm` URLs in the test's own table and re-run. Expected: FAIL. This is the
sabotage that shows the test is reading the artefact rather than the query.

- [ ] **Step 7: Commit**

```bash
git add grammars/capture-golden.json crates/redextape-grammar-check/tests/golden.rs \
        web/tests/browser/grammar-differential.test.ts
git commit
```
Subject: `The grammar differential crosses to the browser through a golden fixture Rust emits and verifies`.

---

## Task 6: The vim keymap, in the app's first `Compartment`

**Files:**
- Modify: `web/package.json`, `web/pnpm-lock.yaml`
- Modify: `web/src/scratch-editor.ts`, `web/src/main.ts`
- Modify: `web/src/editor-prefs.ts`
- Create: `web/tests/browser/vim-keymap.test.ts`

**Interfaces:**
- Consumes: the two extension lists Task 4 edited.
- Produces: `readKeymap()`/`writeKeymap()` in `editor-prefs.ts`, and a `keymapCompartment` each editor
  reconfigures.

- [ ] **Step 1: Add the three dependencies**

Run: `cd web && pnpm add -D @replit/codemirror-vim@6.4.0 @codemirror/language @codemirror/search`

`@codemirror/language` and `@codemirror/search` are peer dependencies of the vim package that this app
does not already have — §9 named one new dependency and it is three. Pin the two new CodeMirror
packages to the exact versions pnpm resolves, matching the four already pinned exactly in
`devDependencies`.

Run: `cd web && pnpm install --frozen-lockfile` to confirm the lockfile is consistent.

- [ ] **Step 2: Write the failing browser test**

Create `web/tests/browser/vim-keymap.test.ts` asserting, with the keymap set to *vim*:
1. an editor in normal mode moves the cursor on `j` rather than inserting a `j`;
2. `Esc` stays inside the editor — focus does not leave it — which is §9's rejected alternative and the
   property most likely to be implemented backwards;
3. with the keymap set to *default*, `j` inserts a `j`;
4. the setting survives a reload, read back from storage rather than from the control.

Point 4 matters because 3a shipped a sabotage that did not fire for exactly this: tests set a checkbox
and never read storage back, so the round trip carrying the setting across a page load was untested.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && pnpm vitest run --project browser tests/browser/vim-keymap.test.ts`
Expected: FAIL — there is no keymap setting.

- [ ] **Step 4: Add the preference**

In `web/src/editor-prefs.ts`, beside `readFormatOnBlur`/`writeFormatOnBlur`, add `readKeymap(): 'default' | 'vim'`
and `writeKeymap(v)`, defaulting to `'default'`, matching that file's existing storage key convention
and its handling of a storage read that throws.

- [ ] **Step 5: Add the compartment to both construction sites**

```ts
import { Compartment } from '@codemirror/state'
import { vim } from '@replit/codemirror-vim'

const keymapCompartment = new Compartment()
const keymapExtension = (mode: 'default' | 'vim') => (mode === 'vim' ? vim() : [])
```

In each extension list, `keymapCompartment.of(keymapExtension(readKeymap()))`, placed **before**
`keymap.of([...defaultKeymap, ...historyKeymap])` so vim's bindings win inside a focused editor, which
is §9's one rule. Reconfigure on a setting change with
`view.dispatch({ effects: keymapCompartment.reconfigure(keymapExtension(mode)) })`.

This is the first `Compartment` in the repository. Its doc comment should say what a compartment is for
and why the colourer is **not** in one: a compartment swaps an extension after the editor is built,
which a keymap setting needs and an async-loading `ViewPlugin` does not.

- [ ] **Step 6: Add the control**

Add *Keymap* — *default* | *vim* — to the settings menu part 2a built, beside *format on blur*, using
that menu's existing control pattern and accessible-name rules. The umbrella's class-level control test
walks every button in every preset and will cover it without a new test.

- [ ] **Step 7: Run the test and the control test**

Run: `cd web && pnpm vitest run --project browser tests/browser/vim-keymap.test.ts` and then the
class-level control test file.
Expected: PASS.

- [ ] **Step 8: Prove the storage round trip is tested**

Make `readKeymap` return `'default'` unconditionally and re-run. Expected: the reload test fails. If it
passes, the test is setting the control and never reading storage back — the exact sabotage that did
not fire in 3a. Restore.

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/src web/tests/browser/vim-keymap.test.ts
git commit
```
Subject: `The vim keymap, in the app's first Compartment, with the Esc rule the design chose`.

---

## Task 7: The whole-branch checks, the coverage floors, and the roadmap entry

**Files:**
- Modify: `web/vite.config.ts` (only if a floor legitimately moves)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Run everything `check-all.sh` covers**

Run: `bash scripts/check-all.sh`
Expected: exit 0, including the new `grammarwasm` leg.

- [ ] **Step 2: Run the four things `check-all.sh` does NOT cover**

`check-all.sh` is not all of CI. Run each and record its output:
```bash
cd web && pnpm run test:coverage          # the 95/89/97/97 floors
bash scripts/check-slow.sh
for s in check-text-bytes check-citations check-attributions check-doc-figures check-shared-docs check-colours check-grammar-wasm; do
  bash "scripts/$s.sh" --self-test && bash "scripts/$s.sh"
done
docker build -t redextape:3b . && docker run --rm -p 8080:80 -d --name rxt3b redextape:3b
```
Then confirm the image serves HTTP 200, reports `healthy`, and that
`/usr/share/nginx/html/assets/` contains **seven** `.wasm` — the two wasm-pack artefacts, the four
grammars, and `web-tree-sitter`'s own parser runtime, which `Parser.init({ locateFile })` fetches and
which this step counted as six until the image was actually built. No CI job builds this image.

- [ ] **Step 3: Move a coverage floor only if the measurement says to**

Read the four figures `test:coverage` prints. If any floor must move, edit it in the same diff with the
argument beside it, per that file's convention that a floor is `floor(measured) - 1` and that a PR
lowering one does it where a reviewer sees it. **Do not move a floor to make a number fit.**

- [ ] **Step 4: Measure what the roadmap entry will claim**

Every figure in the entry needs a command run before the entry is written. At minimum: the four
coverage figures, the seven `.wasm` in the image (this step read six eleven lines above, before Step 2
built the image and found the runtime), the gzipped size the four grammars add to `dist/`, the
test and test-file counts, and the viewport-versus-whole-document capture counts that justify §6.2 —
the last measured **in the built app**, not in Node, since no test in Task 4 can see it.

- [ ] **Step 5: Request a whole-branch review before writing the entry**

Per this repository's practice, a whole-branch review over the half no task-level review saw. Clean
per-task reviews are its precondition, not a reason to skip it.

- [ ] **Step 6: Write the roadmap entry**

Append an entry in the house style, above the deferred sections, covering: what 3b built; that the
capture tables disagree per language and why that shaped the design; the two-hash gate and what it
still cannot catch; what the pre-flight found that the spec had wrong; the defects found by something
other than a failing test; and what it costs. Anchor every claim to a value, not to a relationship, and
anchor to a SHA **last**, after the final code commit.

- [ ] **Step 7: Commit and open the PR**

The roadmap entry lands before the PR is opened. Fact-check the PR body against the tree before opening
it, and write each paragraph as one long line — Forgejo renders bodies with GFM `breaks: true`.

---

## Self-review

**Spec coverage.** §6.1 → Tasks 2, 3, 4. §6.2 (viewport scope, two clocks) → Task 3, measured in
Task 7 Step 4. §6.3 (failure surface) → Task 3's registry and Task 4's notice. §7 → Task 1. §9 → Task 6.
§10's grammar-load row → Task 3; its over-the-ceiling row → Task 3's `overCeiling`. §11.1 → Task 6
Step 6 (covered by the existing class-level test). §11.2's colour row → Task 4. §11.3 → Task 5. §11.4
is 3a's and unchanged. §11.5's manual visual check → Task 7. **§8 is 3c and is deliberately absent.**

**Gaps I am recording rather than hiding.** §10's row says a document over the ceiling gets no colour
**and no diagnostics** with one notice; this plan builds only the colour half, because 3a shipped no
diagnostics ceiling and adding one is not this PR's subject. Task 7's entry must say so.

**Placeholders.** Three steps deliberately defer to the tree rather than inventing names: Task 4
Step 1's harness helpers, Task 4 Step 3's user-facing language label, and Task 6 Step 6's settings-menu
control pattern. Each says to read the existing file and match it, and each names the file. Task 5
Steps 2 and 5 describe the fixture set rather than listing it, because the fixtures must be emitted
output and the emit command's output is the authority.

**Type consistency.** `classMapFrom` / `COLOUR_CEILING_UNITS` / `overCeiling` / `createGrammarRegistry`
/ `treeSitterColour` / `LoadedGrammar` / `GrammarRegistry` / `CaptureTable` are used with the same
names in Tasks 3, 4 and 5. `capture_class` / `CAPTURE_MAPS` / `LanguageCaptures` are consistent across
Task 2's steps and the wasm export. `captureClasses()` is the JS name in Tasks 2, 3 and 4.
