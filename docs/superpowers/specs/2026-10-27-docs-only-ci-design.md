# Docs-only CI — design

A short design. The user's request (2026-10-27): a pull request that changes only docs should not run the whole
gauntlet. `.forgejo/workflows/ci.yml`'s own comment (`on.pull_request`) names this fix and why it was deferred:
a `detect` output that path-gates the heavy jobs, which needs `gate` to tell "legitimately not required" from
"skipped". This design takes that judgement.

## Why a PR cannot simply use `paths-ignore`

On `pull_request`, a path filter that matches the whole diff means the workflow never runs, so the one required
status, `ci / gate (pull_request)`, is never posted, and the PR can never merge (`enable_push` is off). That is
why `pull_request` has no filter today and docs-only PRs pay a full run.

## The design

- **Docs-only means every changed path is under `docs/`.** The user's decision. Not `**/*.md` and not
  `LICENSE*`: `web/scripts/licences.ts` reads `LICENSE.md`, so the `web` job's licence check depends on it. The
  checks that read docs (text bytes, citations, attributions, doc figures, shared docs) are in
  `linear-history`, which still runs. Nothing in the heavy jobs reads `docs/` (checked 2026-10-27: no Rust
  `include_str!` or file read, no web code, test, config or build script, no script those jobs run; the
  Docker build ignores `docs/` in `.dockerignore`).
- **One classifier, `scripts/ci-docs-only.sh <base> <head>`**, prints `true` or `false` and nothing else on
  stdout. `true` only when the diff from the merge base of `<base>` and `<head>` to `<head>` is non-empty and
  every path in it, listed with `--no-renames` so a rename shows both its sides, is under `docs/`. Anything it
  cannot establish — a range that does not resolve, an empty diff — is `false`: fail closed. `--self-test`
  proves it in a throwaway repository. It answers a different question from `check-scoped.sh`'s
  `docs/*|*.md|LICENSE*` arm (which tiers of Rust a draft needs), so that arm stays.
- **`detect`** checks out full history, runs `--self-test`, then the classifier, for a pull request **into
  `main`** only, over the PR's base and head SHAs. Every other run outputs `false` without asking: a PR into
  another base (a green `gate` is stored on the head commit, not the base, so a head docs-only against a branch
  holding untested code must not read green); a push (see below); a dispatch. Output `docs_only`.
- **Heavy jobs** — `rust-scoped`, `rust`, `rust-slow`, `rust-llvm`, `rust-browser`, `web` — add
  `needs.detect.outputs.docs_only != 'true'` to their `if:`.
- **`gate`** reads `docs_only`; anything but exactly `true` or `false` fails it. When `true`, it requires
  `detect` and `linear-history` and says the Rust and web tiers were not required; otherwise it is unchanged.
- **`push` keeps a `paths-ignore`, narrowed to `["docs/**"]`**, the classifier's definition (it was
  `["docs/**", "**/*.md", "LICENSE*"]`, so a `LICENSE.md` change on `main` now runs the licence check). A
  docs-only push to `main` must start no run rather than a short one: a run would join the workflow's
  `concurrency` group, cancel a code merge's run still in progress, and, being docs-only, skip the jobs and
  the image that run was for. A `v*` tag is not affected: Forgejo's `matchPushEvent` counts `paths` and
  `paths-ignore` as matched for any tag push, so the "tag gap" the old comment recorded did not exist.
  `docker` is unchanged.

## Approaches

| Approach | Verdict |
|---|---|
| `paths-ignore` on `pull_request` | Rejected: `gate` never posts, the PR can never merge |
| A second workflow for docs-only PRs posting the same context | Rejected: two producers of one required status; a second path |
| `detect` classifies, `gate` reads it | **Chosen** |

## Verification

The classifier's self-test, run in `detect` on every run. `actionlint`-free checks: the workflow parses as YAML
and `shellcheck` passes on the script. This PR is not docs-only, so it runs the full jobs and must be green.
Then a throwaway PR whose diff against this branch is docs-only must run only `detect`, `linear-history` and
`gate`, with `gate` green, and is closed unmerged.

## Review

The whole-branch review found two defects in the first version, fixed before merge:

- **Critical: a docs-only merge to `main` cancelled the code merge's run before it.** That version dropped
  `push.paths-ignore` to close the tag gap (which, per Forgejo's source, was never real) and classified pushes
  too. A docs-only push then started a run in the same `concurrency` group, which cancels the run in progress,
  and skipped `docker`. Fixed by the narrowed `paths-ignore` above; pushes are never classified.
- **Important: docs-only was granted on a PR into any base.** Fixed by classifying only PRs into `main`.

Both are pinned by a harness that runs `detect`'s and `gate`'s run blocks outside CI (15 cases; it failed 4
before the fix, for exactly these two findings, and passes after). The forge probe below ran against the
first version, into a feature branch; under the fix that probe would be a full run, so the docs-only path
into `main` is first seen on the forge by the next docs-only PR after this merges.

Three of its minor findings were fixed in the same PR:

- **The self-test could pass without checking anything.** A case whose change or commit failed compared the
  base with itself and read `false`, so every `false` case passed vacuously (a sabotage that made the rename
  case's change fail still printed `passed`). `commit_from` now fails the self-test when a step fails or no
  new commit results, and the throwaway repository ignores the developer's global and system git config.
- **`git diff`'s exit status was not read.** The list now goes through a file, a failed diff is `false`
  with a one-line reason on stderr, and a case with a deleted tree object holds it. That case passes with or
  without the check, because git prints nothing before it fails; the check is for a git that would.
- **`gate`'s "A draft PR is EXPECTED to fail here"** and the `rust-scoped` comment now except a docs-only
  draft into `main`, which `gate` passes (Forgejo's `WIP:` title still blocks its merge).

## Results

Run on the forge on 2026-10-27, `https://forge.daveynet.xyz/davey/redextape/actions/runs/<n>`:

| Run | Commit | Change | What ran | `gate` |
|---|---|---|---|---|
| 594 | `b2995d4`, #153 | the workflow and `scripts/ci-docs-only.sh` | all eight jobs | success |
| 595 | `7a37635`, probe #154 | one line under `docs/` | `detect`, `linear-history`, `gate`; the six heavy jobs and `docker` posted `skipped` | success |
| 596 | `6210eb1`, probe #154 | plus one line in `README.md` | the full jobs started; cancelled by the next push | — |
| 599 | `c2a1861`, probe #154 | `README.md` change dropped, one line under `docs/` | `detect`, `linear-history`, `gate` | success |

The probe, #154, based on this branch, was closed unmerged and its branch deleted. The job logs need a browser
session, so `gate`'s docs-only line was not read; `gate` passing with every heavy job `skipped` is the evidence,
since its run block, run outside CI under each case, passes that combination only when `docs_only` is `true`.
A push of a commit that already has a run starts no new run, so cancelling 596 took a new commit.
