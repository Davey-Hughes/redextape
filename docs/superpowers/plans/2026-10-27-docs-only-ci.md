# Docs-only CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pull request (or push to `main`) whose every changed path is under `docs/` runs only `detect`, `linear-history` and `gate`, and `gate` passes.

**Architecture:** One bash classifier, `scripts/ci-docs-only.sh`, with a `--self-test`; `detect` runs both and publishes `docs_only`; the heavy jobs skip on it; `gate` validates it and stops requiring the heavy jobs when it is `true`. `push` drops `paths-ignore`.

**Tech Stack:** bash, git, Forgejo Actions YAML.

**Spec:** `docs/superpowers/specs/2026-10-27-docs-only-ci-design.md`

## Global Constraints

- Docs-only means every changed path is under `docs/`. Not `**/*.md`, not `LICENSE*`.
- Fail closed: anything the classifier cannot establish prints `false`.
- The classifier prints exactly `true` or `false` on stdout; diagnostics go to stderr.
- Repo script conventions (see `scripts/check-text-bytes.sh`): `set -euo pipefail`; an unrecognised argument is an error with usage, exit 2; the self-test calls the same function the real run calls; NUL-delimited path lists (`-z`).
- `check-scoped.sh` is not changed.
- Branch: `ir-views-groundwork-design` (PR #153). Commit message style: one descriptive sentence title, prose body, as in `git log`.

## Review Focus

- A rename from code into `docs/` (`crates/x.rs` → `docs/x.rs`): must be `false` — `--no-renames` lists the deletion. Test in Task 1.
- A path that only starts with the letters `docs` (`docsite/a`, `docs.md`): must be `false`. Test in Task 1.
- A PR branch behind a `main` that has since changed code: the PR's own changes are docs-only, so `true` — the merge-base diff excludes `main`'s changes. Test in Task 1.
- An unresolvable or all-zero base (first push, force push): `false`. Test in Task 1.
- A `v*` tag on a docs-only commit: must run the full workflow. Handled in Task 2 by not calling the classifier outside `pull_request` and pushes to `main`; checked by reading the `detect` step.

---

### Task 1: The classifier and its self-test

**Files:**
- Create: `scripts/ci-docs-only.sh` (mode 755)

**Interfaces:**
- Produces: `scripts/ci-docs-only.sh <base> <head>` → stdout `true`|`false`, exit 0; `scripts/ci-docs-only.sh --self-test` → exit 0 and `self-test passed: …` on success, exit 1 naming the failed case otherwise; any other arguments → usage on stderr, exit 2. Internal function `classify <base> <head>` used by both.

- [ ] **Step 1: Write the script with `self_test` and a stub `classify` that always prints `true`**

`self_test` makes a throwaway repo (`mktemp -d`, trap with `${dir:?}` as in `check-text-bytes.sh`), commits a base tree with `crates/x.rs`, `docs/a.md`, `README.md`, `LICENSE.md`, then asserts `classify` on these cases, each on its own commit or branch from the base:

| Case | Change | Expected |
|---|---|---|
| docs edit | modify `docs/a.md` | `true` |
| docs add + delete | add `docs/new.md`, delete `docs/a.md` | `true` |
| docs + code | modify `docs/a.md` and `crates/x.rs` | `false` |
| top-level markdown | modify `README.md` | `false` |
| licence | modify `LICENSE.md` | `false` |
| lookalike paths | add `docsite/a` and `docs.md` | `false` |
| rename into docs | `git mv crates/x.rs docs/x.rs` | `false` |
| path with a space | add `docs/with space.md` | `true` |
| no change | base vs itself | `false` |
| unresolvable base | `none` and `0000000000000000000000000000000000000000` as base | `false` |
| behind main | from base, branch A modifies `docs/a.md`; main gets a commit modifying `crates/x.rs`; classify (main tip, A tip) | `true` |

Each failure prints `self-test FAILED: <case>: expected <e>, got <g>` to stderr and exits 1.

- [ ] **Step 2: Run the self-test; expect failure**

Run: `scripts/ci-docs-only.sh --self-test`
Expected: exit 1, `self-test FAILED: docs + code: expected false, got true` (the first `false` case).

- [ ] **Step 3: Implement `classify`**

Resolve both arguments with `git rev-parse --verify --quiet "<x>^{commit}"`; if either fails, print `false`. Merge base via `git merge-base`; if none, `false`. List with `git diff --name-only --no-renames -z <mergebase> <head>`; empty → `false`; any path not matching `docs/*` → `false`; else `true`. Use `case "$path" in docs/*) ;; *) … esac`. Add the argument `case` with usage, as in `check-text-bytes.sh`. Header comment: what docs-only means and why (`LICENSE.md` feeds the licence check; the docs-reading scans live in `linear-history`), fail-closed, why `--no-renames`, why the merge-base diff, and that `check-scoped.sh` answers a different question.

- [ ] **Step 4: Run the self-test and shellcheck; expect pass**

Run: `scripts/ci-docs-only.sh --self-test && shellcheck scripts/ci-docs-only.sh`
Expected: `self-test passed: …`, shellcheck silent, exit 0.

Also: `scripts/ci-docs-only.sh --bogus; echo $?` prints usage and `2`; on this branch, `scripts/ci-docs-only.sh origin/main HEAD` prints `true` before Task 2 and `false` after it.

- [ ] **Step 5: Commit**

```bash
git add scripts/ci-docs-only.sh
git commit   # title: "scripts/ci-docs-only.sh says whether a range changes only paths under docs/, failing closed, with a self-test"
```

### Task 2: Wire it into the workflow

**Files:**
- Modify: `.forgejo/workflows/ci.yml` — `on:` (lines 15-43), `detect` (83-93), the `if:` of `rust-scoped` (315-318), `rust` (378-380), `rust-slow` (449-451), `rust-llvm` (489-491), `rust-browser` (607-609), `web` (764), `gate` (691-760); the header comment (1-6).

**Interfaces:**
- Consumes: Task 1's `scripts/ci-docs-only.sh`.
- Produces: `needs.detect.outputs.docs_only` ∈ {`true`, `false`}.

- [ ] **Step 1: `on:`** — delete `push.paths-ignore`. Replace the comment block under `pull_request` (lines 27-42) with one stating: no path filter on either event, because a filtered-out PR never posts `gate`; docs-only runs are decided by `detect` (`docs_only`) and accepted by `gate`; tags always run the full workflow. Keep the `edited` comment.

- [ ] **Step 2: `detect`** — checkout with `fetch-depth: 0`; add output `docs_only: ${{ steps.c.outputs.docs_only }}`; in step `c`, after the existing lines, with values passed through `env:` (not inline `${{ }}` in the script, as the `docker` job does): `EVENT`, `REF`, `PR_BASE: github.event.pull_request.base.sha`, `PR_HEAD: github.event.pull_request.head.sha`, `BEFORE: github.event.before`, `SHA: github.sha`. Run `scripts/ci-docs-only.sh --self-test` first. Then:

```bash
case "$EVENT:$REF" in
  pull_request:*)        docs_only=$(scripts/ci-docs-only.sh "$PR_BASE" "$PR_HEAD") ;;
  push:refs/heads/main)  docs_only=$(scripts/ci-docs-only.sh "${BEFORE:-none}" "$SHA") ;;
  *)                     docs_only=false ;;
esac
echo "docs_only=$docs_only" >> "$GITHUB_OUTPUT"
```

Comment: why tags and dispatches are never docs-only.

- [ ] **Step 3: Heavy jobs** — append `&& needs.detect.outputs.docs_only != 'true'` to the `if:` of `rust-scoped`, `rust`, `rust-slow`, `rust-llvm`, `rust-browser`, `web`. `!= 'true'` rather than `== 'false'`, so an unexpected value runs the jobs (and `gate` then fails on it).

- [ ] **Step 4: `gate`** — add env `DOCS_ONLY: ${{ needs.detect.outputs.docs_only }}`; echo it with the others; after `require detect` and `require linear-history`:

```bash
case "$DOCS_ONLY" in
  true|false) ;;
  *) echo "error: detect's docs_only is '$DOCS_ONLY', expected true or false" >&2; fail=1 ;;
esac
```

Then wrap the existing `HAS_RUST`/`HAS_WEB` blocks, unchanged inside, in `if [ "$DOCS_ONLY" = true ]; then echo "docs-only change (every path under docs/): the Rust and web tiers are not required"; else …; fi`. The final `fail` check is unchanged. Extend the job's comment: why trusting `docs_only` is sound (`detect` is required first, the classifier fails closed and is self-tested in the same step).

- [ ] **Step 5: Header comment** (lines 1-6) — one sentence that `detect` also decides docs-only runs.

- [ ] **Step 6: Validate**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.forgejo/workflows/ci.yml'))" && grep -c "docs_only != 'true'" .forgejo/workflows/ci.yml`
Expected: exit 0 and `6`.
Run: `grep -n "paths-ignore" .forgejo/workflows/ci.yml`
Expected: only comment lines, if any.

- [ ] **Step 7: Commit**

```bash
git add .forgejo/workflows/ci.yml
git commit   # title: "CI runs only detect, linear-history and gate when every changed path is under docs/, and gate accepts that; push drops paths-ignore, so a v* tag always runs and publishes"
```

### Task 3: Prove it on the forge

**Files:**
- Modify: `docs/superpowers/specs/2026-10-27-docs-only-ci-design.md` (append results)

- [ ] **Step 1: Push the branch and wait for PR #153's run.** It is not docs-only (it changes `ci.yml` and a script), so every job runs. Expected: `gate` green; `detect`'s log shows `self-test passed` and `docs_only=false`.

- [ ] **Step 2: Throwaway docs-only PR.** Branch `ci-docs-only-probe` from `ir-views-groundwork-design`, add one line to a file under `docs/`, push, open a non-draft PR with base `ir-views-groundwork-design`. Expected: `detect` logs `docs_only=true`; `rust`, `rust-slow`, `rust-llvm`, `rust-browser`, `web` skipped; `linear-history` ran; `gate` green and logs the docs-only line.

- [ ] **Step 3: Negative probe on the same PR.** Push a second commit touching `README.md`. Expected: `docs_only=false` and the full jobs run (cancel the run once `detect`'s output is confirmed, to save the runner).

- [ ] **Step 4: Close the probe PR unmerged and delete its branch** (`tea pr close`, `git push origin --delete ci-docs-only-probe`).

- [ ] **Step 5: Record and commit.** Append a `## Results` section to the spec: the run URLs and what each showed. Update PR #153's title and description to include the CI change. Commit and push.
