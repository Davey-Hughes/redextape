# Conventions


`main` is **linear** — no merge commits — and every commit on it is an **atomic unit**: it builds and
passes the gate on its own. Work happens on a feature branch, which lands as **one squashed commit**.

Pull requests are the only route to `main` — there is no local landing script. Push the branch, open
a PR, and once CI has run, squash-merge it in the Forgejo web UI:

    git push -u origin my-branch
    # open a PR at forge.daveynet.xyz, squash-merge once CI is green

CI runs against the PR head on every push to a **non-draft** PR and whenever the PR's title or body
is edited, so its result is visible on the PR before anyone merges it: `rust`, `rust-llvm` and
`rust-browser` run `scripts/check-all.sh` (`--no-llvm --no-browser`, `--llvm-only` and
`--browser-only` respectively, which together cover every config), and `rust-slow` runs
`scripts/check-slow.sh`.

A **draft** PR gets `rust-scoped` instead: a fast check that escalates rather than skips; on CI it
always covers the whole branch diff — see the `rust-scoped` job header for what it actually buys.
It is explicitly non-gating — its own banner says so. `rust`, `rust-llvm`, `rust-browser` and
`rust-slow` do not run on a draft PR, and `gate` deliberately stays red until the PR leaves draft;
that is expected, not a failure to investigate. `ci / gate (pull_request)` is the single required
status check either way.

What a web-UI merge does **not** do by itself, the way the retired `scripts/land.sh` did, is check the
merged tree. `land.sh` ran the gate **on the merged tree, before the commit existed**, and refused to
commit on failure — that ordering is what made "every commit on `main` builds and passes CI by itself"
a *property*, not a hope. A squash-merge inverts it: the commit is built from the PR head, and merging
is a decision a person makes by reading CI's result, not a check the merge itself re-runs.

**`main` is branch-protected** (enabled 2026-08-04), which is what stands in for that ordering:

- direct pushes are off — a PR is the only way in
- `ci / gate (pull_request)` is the single required status check. Naming `rust`, `rust-llvm`,
  `rust-slow` or `linear-history` directly was tried and measured unsound: Forgejo reports a
  *skipped* job as `success` on the commit-status API, so a required context naming one of those
  jobs cannot tell "ran and passed" from "never ran." `gate` instead reads `needs.<job>.result` — a
  different subsystem that reports `skipped` as `skipped` — and fails unless every gating job
  actually succeeded.
- `block_on_outdated_branch` is on, so a PR green against a `main` that has since moved cannot merge
- `apply_to_admins` is on, so the rule binds the repository owner too — without it the whole rule is
  advisory for the only account that merges

Required checks keep the PR head green and the outdated-branch block keeps that head current with
`main`. That is not identical to gating the merged tree — the merge commit itself is still never
tested before it exists — but it removes the two ways the gap actually bites: a red head, and a stale
base. The residual is a semantic conflict between two green branches, which `block_on_outdated_branch`
forces you to rebase and re-run rather than discover afterwards.

A plain `git merge --squash` discards every commit message on the branch. `land.sh` used to work
around that by prefilling the squash message with every branch commit verbatim under a
`--- Squashed from N commits ---` marker; a PR's written body does that job now, and does it better as
prose. Measured on this repository: `9a7db07`, landed by `land.sh`, carries 521 lines and 31,925 bytes
of concatenated commit messages; `a32e967`, a squash-merged PR, carries 91 lines and 5,491 bytes of
written body. (The squash figure moved slightly on 2026-08-05, when `main`'s history was rewritten
to drop Forgejo's `Reviewed-on:` trailer, which was part of what was being measured — it read 93
lines and 5,556 bytes before. `9a7db07` predates the rewrite and is untouched. The comparison the
two support is unaffected, and a merge-message template now keeps the trailer off future commits.)
What moves is *where* the intermediate messages live: they are no longer inside the
commit object that lands on `main`. They still exist, on the PR page and under `refs/pull/N/head`, but
only on `forge.daveynet.xyz` — a dependency the git history alone did not previously have. Losing the
reasoning is still not the price of a tidy graph; keeping it now depends on the forge as well as on
git.

`SQUASH_TEMPLATE.md` deliberately stops at its first line, and the blank line after it is
load-bearing. Forgejo prefills the squash merge box with `GetSquashMergeCommitMessages()` **plus** the
template's body, and with `PopulateSquashCommentWithCommitMessages` off — the default — the first of
those already *is* the PR description. A body of `${PullRequestDescription}` therefore wrote it twice,
which is what `#13`–`#16` carried until their messages were rewritten on 2026-08-07. Deleting the
trailing blank line does not merely undo that: `expandDefaultMergeMessage` splits the template on its
first newline and falls back to the *default* body when there is no second part, so a one-line file
brings the `Reviewed-on:` trailer back. `MERGE_TEMPLATE.md` keeps `${PullRequestDescription}` because
the non-squash prefill does not prepend the description — it is unreachable while the remote has merge
commits disabled, and correct if they are ever re-enabled.

Three layers keep this true, none of which trusts the other two:

- `scripts/setup-dev.sh` (run once per clone) sets `merge.ff = only` and `pull.ff = only`, so a
  non-fast-forward merge fails rather than quietly creating a merge commit. Convenience only —
  `.git/config` is untracked and cannot bind anyone.
- The **remote** allows only squash and fast-forward merges; merge commits and rebase-merge are
  disabled, so a PR merged in the web UI cannot produce a shape CI rejects.
- CI's **`linear-history`** job rejects a merge commit on `main` however it arrived, unless the push
  changed only `docs/`, which starts no CI run. This is the gate.

Object-size baselines live in `crates/redextape-native/baselines/<target-triple>.txt` and gate the
`size_baseline` test with a 10% band. Regenerate after an intentional codegen change:

    cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline
