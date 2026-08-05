# CI scope filters — design

> **THE ORIGINAL PREMISE WAS NARROWED BY MEASUREMENT BEFORE ANY CODE WAS WRITTEN, AND THE
> NARROWING IS THE MOST USEFUL RESULT HERE.** The ask was "stop running the whole gauntlet when one
> test changes." The standard answer — path filters feeding job-level `if:` — was measured against
> this repository's actual commit shape and **fires on 3 of the last 40 commits**. It is not the
> lever. Two other levers are, and neither is a filter.
>
> **What is MEASURED in this document:** per-job CI durations (runs 53–58), the 40-commit change-class
> distribution, the Forgejo version and its supported `pull_request` event types, the absence of
> branch protection on `main` (true when measured, 2026-08-04 — superseded the same day; see §3.2's
> dated correction), the `cargo-nextest` filterset predicates, and the cost of the duplicated
> work identified in §2 (`T_llvm_repeat` = 50.1s warm / 65.3s cold, `T_cov_repeat` = 9.3s). Every
> number below is reproducible from a command printed next to it.
>
> **What is NOT measured and is called out as such at each site:** the CI wall-clock speedup §4.1
> produces once it lands. §2.2 measures the cost being duplicated today — that is now known. The
> reduction in wall-clock time that removing it delivers is still *expected*, not known, and §6 makes
> re-measuring the real run the last step of implementation rather than an assumption made now. No
> speedup is claimed in this document.

**Status: IMPLEMENTED, with dated corrections below where measurement or later work moved it past
what was approved (§1.3, §3.2, §4.4, §6).** Approved 2026-08-04 after two corrections during
brainstorming, both preserved below rather than edited out (§1.2, §2.1).

**Scope:** `.forgejo/workflows/ci.yml`, one new script, one new flag on `scripts/check-all.sh`.
Zero changes to any crate. Zero changes to `check-all.sh`'s existing behaviour — it remains the full
gauntlet, invoked exactly as it is today, and the new scoping lives in a separate script.

---

## 1. The premise, and what measurement did to it

### 1.1 The complaint

CI excludes pure-docs changes (`paths-ignore: ["docs/**", "**/*.md", "LICENSE*"]`) and nothing else.
Every other change runs `rust`, `rust-llvm` and `rust-slow` in full. Modifying a single test therefore
costs the same as rewriting the reducer.

Measured cost of a run — the three heavy jobs start within 5s of each other and run in parallel on the
self-hosted runner, so wall clock is the max, not the sum:

```
run 58 (push)  rust  4.8m   rust-slow 5.1m   rust-llvm 9.7m   ->  9.7m wall
run 57 (PR)    rust  6.6m   rust-slow 8.5m   rust-llvm 2.2m   ->  8.5m wall
run 56 (PR)    rust  6.3m   rust-slow 8.6m   rust-llvm 2.4m   ->  8.6m wall
run 55 (PR)    rust  5.5m   rust-slow 5.1m   rust-llvm 2.2m   ->  5.5m wall
run 53 (PR)    rust 10.9m   rust-slow 9.5m   rust-llvm 5.4m   -> 10.9m wall
```

Reproduce (`$TOK` = the PAT in `~/.config/tea/config.yml`):

```sh
curl -s -H "Authorization: token $TOK" \
  "https://forge.daveynet.xyz/api/v1/repos/davey/redextape/actions/tasks?limit=60" \
  | jq -r '.workflow_runs[] | [.run_number,.name,.run_started_at,.updated_at] | @tsv'
```

Rows before run ~53 carry a stale `updated_at` and report durations in the tens of thousands of
seconds. They are **not** usable and are excluded above rather than averaged in.

### 1.2 CORRECTION: the standard filter aims at the wrong unit

The mainstream Actions answer is `dorny/paths-filter` (or a `git diff` equivalent) computing booleans
in a gating job, with downstream jobs skipping on them. This repository already has the right shape
for it: the `detect` job exists and already publishes outputs consumed by `if:`.

It fires almost never. Classifying the last 40 commits by the narrowest scope that would be *sound*:

```
37  full          touches crates/*/src/ — nothing can be skipped
 2  LEAF-ONLY     crates/*/tests, crates/*/examples, docs only
 1  docs-only     already skipped by today's paths-ignore
```

Reproduce — buckets each commit's `git show --name-only` output on path prefix, "full" being the
absence of any narrower bucket:

```sh
git log --format=%H -40 | while read -r sha; do
  leaf=1; docs=1
  while read -r f; do
    [ -z "$f" ] && continue
    case "$f" in docs/*|*.md|LICENSE*) ;; *) docs=0 ;; esac
    case "$f" in
      crates/*/tests/*|crates/*/examples/*|crates/*/benches/*|docs/*|*.md|LICENSE*) ;;
      *) leaf=0 ;;
    esac
  done <<< "$(git show --pretty='' --name-only "$sha")"
  if   [ "$docs" = 1 ]; then echo docs-only
  elif [ "$leaf" = 1 ]; then echo LEAF-ONLY
  else echo full; fi
done | sort | uniq -c
```

Two facts compound to make this worse than the 5% headline:

1. **On a `pull_request` event, `paths` is evaluated against the whole `base...head` diff**, not
   against the push that just landed. A branch whose first commit touched `lambda/reduce.rs` runs the
   full gauntlet for every subsequent test-only push — which is the exact case the complaint names.
2. **`redextape-core` is 23k lines in a single crate**, and the other three crates all depend on it.

   > **CORRECTED 2026-08-04. This said 47k, and 47k is the WHOLE WORKSPACE.** The figure came from
   > `find crates -name '*.rs' -exec wc -l` — every crate, plus tests and examples — and was then
   > attributed to one crate, roughly doubling it. Measured properly:
   > `redextape-core/src` is **23,008** lines; the crate including its tests and examples is 40,039;
   > the four crates' `src` together are 28,668; the 47,277 total is that plus every test and example
   > in the workspace.
   >
   > **The argument is unaffected and that is worth stating explicitly, so the correction is not
   > mistaken for a retreat.** What makes `rdeps()` useless here is the *shape* of the graph — core
   > sits at the bottom and everything depends on it — not its size. `rdeps(redextape-core)` would be
   > the whole workspace at 2k lines. The number was rhetorical colour, and it was inflated 2x.
   >
   > Found by Task 4's implementer, which was asked to check the brief's factual claims rather than
   > transcribe them, after Task 3 shipped a comment stating a mechanism measurement had already
   > contradicted.
   Cargo's unit of dependency is the crate, so `cargo metadata`-driven selection, `nextest`'s
   `rdeps()`, and every crate-graph tool collapse to "run everything" the moment any file under
   `crates/redextape-core/src/` changes. That is 37 of the last 40 commits.

The unit that is genuinely test-only is **the push**, not the commit and not the branch. Scoping on the
push increment is *not sound as a merge gate* — an earlier push in the same branch may have had its run
cancelled (`concurrency.cancel-in-progress` is on, and runs 42, 48, 50 and 54 were in fact cancelled),
so coverage attributed to it may never have existed. It is entirely sound as a **non-gating fast
pre-check**, and §4 uses it only that way.

### 1.3 How work actually reaches `main`

Established because the first draft of §4 assumed `land.sh`, and that assumption was wrong.

Every pull request ever opened on this repository (#1–#7) was merged in the Forgejo web UI, and all
seven land in the last 12 commits. Interleaved with them are direct-to-`main` landings via
`scripts/land.sh` (`87bb35a`, `3602ea9`, and older). So:

- **PRs are the dominant recent path.** PR CI, not `land.sh`, is the gate that matters.
- **Direct landings still happen**, and they bypass PR CI entirely — the `push` trigger on `main` is
  their only coverage. The design preserves that trigger untouched.

`land.sh` running `check-all.sh` locally on the merged tree therefore cannot be relied on as *the* full
run. It is a real gate for the commits that use it and no gate at all for the seven that did not.

**2026-08-04, Task 10:** the mixed route this section describes is closed. `scripts/land.sh` is
deleted; pull requests are now the only way anything reaches `main`. This section stays as the
record of why that decision was made — it is not rewritten to describe the closed state as if it had
always been true.

---

## 2. What the gauntlet repeats

This fires on **100% of runs** and is independent of what changed. It is the larger of the two levers.

### 2.1 CORRECTION: two of the three apparent duplications are nearly free

An earlier reading of `ci.yml` counted `cargo fmt --all --check` and
`cargo clippy --workspace --all-targets` three times per run and called all three wasteful. Two of the
three are back-to-back invocations inside the `rust` job — the explicit `Format`/`Clippy` steps, then
the same commands again inside `scripts/check-all.sh --no-llvm` — against the **same** target
directory. Cargo no-ops the second. Removing them tidies the log; it does not buy time, and claiming
otherwise would have been this document overstating its own case.

### 2.2 The duplication that does cost

**(a) `rust-llvm` re-runs everything `rust` already ran.**

`scripts/check-all.sh` with no flag is, by construction, `--no-llvm` plus the LLVM configs: `fmt`,
`clippy --workspace`, `nextest --workspace` + doctests, and the two `redextape-native
--no-default-features` legs all execute again. Crucially the `rust-llvm` job restores a **different
cache** (`cargo-llvm-${{ hashFiles('**/Cargo.lock') }}`, versus `cargo-` for `rust`), so this is a
genuine recompile from that cache's state, not a warm no-op.

**(b) The `rust` job builds and runs the workspace suite twice.**

`check-all.sh --no-llvm` runs `cargo nextest run --workspace`; the job then runs `cargo llvm-cov
nextest --workspace --fail-under-lines 80`. Same test set. Different codegen flags
(`-C instrument-coverage`), hence a different fingerprint and a separate compilation of every test
target.

**Measured 2026-08-04** (LLVM 22.1.8, 32 cores; method: Task 1 of the implementation plan,
`docs/superpowers/plans/2026-08-04-ci-scope-filters.md`). That plan's timing method prints
`/usr/bin/time -f ...`, which is **not installed** on the box that produced these numbers; the commands
actually run — bash's builtin `time` with `TIMEFORMAT` set to match, run via `bash -c` — are printed
next to each figure below, so a reader on a box without GNU time is not stuck.

**(a) `T_llvm_repeat`, warm — 50.1s.** `check-all.sh --no-llvm`, timed on a target directory a prior
full `check-all.sh` run had already warmed. That is `rust-llvm`'s actual situation: its `cargo-llvm-*`
cache is populated by `rust-llvm`'s own previous run, which ran the full gauntlet, so its non-LLVM legs
start warm and what they cost is fingerprint-checking plus the test suite, not compilation. This is the
figure describing CI today.

> **CONFIRMED IN CI 2026-08-04 on a two-point sample, THEN FALSIFIED 2026-08-04 BY THE FULL SAMPLE —
> see §6.5.** Warm PR runs before the split: 135s, 141s, 135s (mean 137s). Warm PR runs after: 88s,
> 86s (mean 87s). **Δ ≈ 50s**, against the 50.1s measured locally here — for a few hours this read as
> two independent measurements agreeing to within a second.
>
> **This sentence was very nearly struck, and the near-miss is the lesson.** The final whole-branch
> review judged "buys back" dishonest — it contradicts this document's own "No speedup is claimed",
> and it asserted a local 32-core figure IS a CI figure when that transfer had never been measured.
> That judgement was correct **on the evidence available at the time**: the only post-change sample
> then was run 62's 4.0m against a 2.2–2.4m baseline, which leans the other way. Run 62 was a
> first-run-on-a-new-branch with every cache cold, and §6.5 records why no row of it means anything.
>
> **It was restored on that two-point sample, and the two-point sample was insufficient evidence.**
> The claim survived because the measurement arrived, not because the argument for striking it was
> wrong — but "the measurement" turned out to be 2 of the eventual 7 post-change runs, not the full
> population. That population is 86, 88, 129, 192, 238, 239, 248 (§6.5): runs 66–68 (129s, 192s,
> 248s) are docs-only commits against an unchanged `Cargo.lock` — exact-cache-key warm runs, not cold
> outliers, so no "warm-only" rule excludes them — and they contradict the 87s figure outright. The
> median moved 141s → 192s, worse, not better. §6.5 has the full accounting. Struck accordingly: the
> sentence this note was written to defend, "and it is what §4.1's split buys back" (above). What
> survives is `T_llvm_repeat` = 50.1s itself, a controlled local measurement never in question; what
> fails is the claim that CI's `rust-llvm` job is what cashes it in.

Reproduce (first warms `target/` with an untimed full run, then times the `--no-llvm` repeat against
that now-warm tree):

```sh
./scripts/check-all.sh   # untimed, warms target/; discard
bash -c 'unset CARGO_TARGET_DIR; TIMEFORMAT="NO-LLVM-WARM %R s (user %U s, sys %S s)"; time ./scripts/check-all.sh --no-llvm'
```

Cold, for context only — `rm -rf` the target directory before each timing, the brief's literal method:
`check-all.sh` full = 84.1s, `check-all.sh --no-llvm` = 65.3s (`T_llvm_repeat`, cold). This is what a
`Cargo.lock` change or a genuine cache miss costs, not CI's steady-state repeat, and it does not describe
`rust-llvm`. It was also measured on `/tmp`, which on the measuring box is RAM-backed tmpfs rather than a
real disk — so if anything it *understates* a disk-backed cold cost, meaning it undersells rather than
oversells the cold case.

Reproduce (cold — `rm -rf` a `CARGO_TARGET_DIR` deliberately off the project tree before each timing):

```sh
export CARGO_TARGET_DIR=/tmp/rt-llvmcache
rm -rf "${CARGO_TARGET_DIR:?}"; time ./scripts/check-all.sh           # FULL-COLD
rm -rf "${CARGO_TARGET_DIR:?}"; time ./scripts/check-all.sh --no-llvm # NO-LLVM-COLD
```

**(b) `T_cov_repeat` — 9.3s.** `cargo llvm-cov nextest --workspace --fail-under-lines 80` minus
`cargo nextest run --workspace`, both against a warm target directory: 50.6s − 41.3s. Cheap, well under
the ~45s materiality bar §6 set for this question: the `rust` job's cache `path:` in `ci.yml` is the
whole `target` directory, so on the unchanged-`Cargo.lock` push this design targets, the instrumented
build's own subdirectory (`target/llvm-cov-target`) is already warm too on CI, matching what was
measured locally — the 9.3s is compile-only, not compile-plus-link-plus-run. **(b) is left alone**: Task
3's step conditioned on this number ("apply the Task 1 decision on the doubled workspace suite") is
dropped rather than implemented, per its own instruction. §4.1's `--llvm-only` split is justified by (a)
alone.

Reproduce (both legs against an already-warm target directory):

```sh
bash -c '
  cargo nextest run --workspace >/dev/null 2>&1   # ensure warm; exit 0
  TIMEFORMAT="PLAIN-2ND %R s ..."; time cargo nextest run --workspace
  TIMEFORMAT="COV-1ST %R s ...";   time cargo llvm-cov nextest --workspace --fail-under-lines 80
'
```

---

## 3. Constraints discovered in the platform

Forgejo `15.0.5+gitea-1.22.0` (`GET /api/v1/version`). `cargo-nextest 0.9.140`.

### 3.1 There is no `ready_for_review` event

Forgejo Actions supports `opened`, `synchronize`, `reopened`, `closed`, `labeled`, `unlabeled`,
`assigned`, `unassigned`, `edited`. `ready_for_review` is a GitHub-only type and is not among them.
Forgejo's draft mechanism is a `WIP:` title prefix, and un-drafting therefore surfaces as `edited`.

The PR API does expose a `draft` boolean (verified on PR #7). §4 uses it.

**A `full-ci` label was considered and rejected.** A label is set once and does not follow the head
commit; push after labelling and the label still reads green while the full run describes an older
tree. That is precisely the "gate that quietly covers less than it claims" failure this repository
keeps finding. The `draft` boolean has no such state: full CI re-runs on every `synchronize` of a
non-draft PR, so it cannot go stale.

### 3.2 `main` has no branch protection

```sh
curl -s -H "Authorization: token $TOK" \
  https://forge.daveynet.xyz/api/v1/repos/davey/redextape/branch_protections
# -> []
```

No required status checks, no required approvals, no push restriction. Repository merge settings are
`allow_merge_commits: false`, `allow_rebase: false`, `default_merge_style: squash` — the shape is
enforced, but *whether CI passed* is not.

The gate today is a human reading a tick. `ci.yml` argues in two places that "a job permitted to fail
is not coverage"; the same reasoning says a check nothing requires is not a gate. §4.4 addresses it.

**2026-08-04, later the same day (§4.4):** this section's claim is superseded. `main` is now
branch-protected — `enable_push: false`, `enable_status_check: true`, `block_on_outdated_branch:
true`, `apply_to_admins: true` — with `ci / gate (pull_request)` as the sole required context. This
section stays as the record of the state that made §4.4's work necessary; it is not rewritten to
describe the protected state as if it had always been true.

### 3.3 The nextest predicates this design relies on

From `cargo nextest help filterset` (0.9.140):

- `package(m)` — tests in crates matching `m`
- `rdeps(m)` — tests in crates matching `m` **and every crate that transitively depends on `m`**
- `binary(m)` — tests in binary names matching `m`; for an integration test this is the file stem
- `binary_id(m)`, `kind(m)`, `test(m)`, set operators `&`, `|`, `-`, `!`

`binary()` is the one that matters. `rdeps()` is what §1.2 shows to be useless here; `binary()` is what
makes a test-only change cheap, because Cargo test and example targets are **leaves** — nothing in the
build graph depends on them, so a change confined to them provably cannot alter any other target's
result.

---

## 4. The design

### 4.1 `check-all.sh` gains `--llvm-only`

Default behaviour is unchanged: `scripts/check-all.sh` with no argument stays the full gauntlet and
`--no-llvm` stays exactly what it is. The new third mode runs only the LLVM legs — the prefix probe,
`clippy -p redextape-native --features llvm`, `test_cfg -p redextape-native --features llvm`, and the
same pair under `--no-default-features --features llvm`.

`ci.yml`'s `rust-llvm` job then calls `check-all.sh --llvm-only`.

**The invariant the script must assert, not merely document: `--no-llvm` ∪ `--llvm-only` ≡ full.**
Three hand-maintained lists would drift, and a mode that silently covers less than its name claims is
the defect this whole file guards against. Implementation is one config list with a mode tag per entry
and a filter over it, so the union is structural rather than remembered. The existing up-front argument
parsing (which already rejects `--no-llvmm` rather than falling through to a full run) extends to the
new flag.

### 4.2 `scripts/check-scoped.sh <range>` — new, and deliberately not the gauntlet

Takes an explicit git range. Prints the change classification and the exact command it derived. Its
banner states that it is **not** the merge gate; a scoped run that could be mistaken for a full one is
worse than no scoped run.

> **CORRECTED 2026-08-04, AND THIS IS THE ONE CORRECTION ON THIS BRANCH THAT COSTS THE DESIGN
> SOMETHING RATHER THAN JUST REPAIRING A CLAIM.**
>
> §1.2's central move was that "the unit that is genuinely test-only is **the push**". **CI cannot
> supply that unit.** Measured on PR #8 run 60 (§6.3):
>
> ```
> event_name = pull_request
> action     = synchronized          <- Forgejo's spelling; the `types: [synchronize]` filter matches it
> draft      = [true]
> before     = []                    <- EMPTY. There is no push increment in the payload.
> base.sha   = [a32e967]             <- the merge-base with main, i.e. the whole-branch diff
> ```
>
> So `rust-scoped` always hands this script an unresolvable range and it always takes the
> whole-branch fallback — which §1.2 measured as narrowing anything on **3 of the last 40 commits**.
> The narrow paths are real and tested; they are reachable by hand (`check-scoped.sh main..HEAD`)
> and unreachable from CI.
>
> **The wall-clock saving is LARGE — 3.2 to 4.7 minutes. A first version of this block said it was
> ~zero, and that was wrong.**
>
> ```
> DRAFT      rust-scoped alone     run 60   72s (1.2m)    run 59  163s (2.7m)
> NON-DRAFT  three jobs, wall      run 63  353s (5.9m)
> ```
>
> The wrong version argued: the jobs run in parallel, so wall = max, so a draft run ≈ a non-draft
> run. **The scheduling model was right and the cost model was an unmeasured guess** — it assumed
> `rust-scoped` costs about what `rust` costs. It does not. `rust` also runs
> `cargo llvm-cov nextest --workspace` on top of `check-all.sh --no-llvm`, and its 353s was measured
> WHILE CONTENDING with two other jobs. `rust-scoped`'s worst case — full escalation to `--no-llvm` —
> is 72s warm, which is 50.1s of `T_llvm_repeat` plus job overhead.
>
> **Capacity was not the mechanism in run 63, specifically** — its three heavy jobs span
> 19:59:35–20:05:28 together, so nothing queued there and the runner took ≥3 at once. That claim is
> scoped to run 63, not generalised: **run 65 queued twice.** Its `rust-slow` started 20:35:18, two
> seconds after run 64's `rust-llvm` ended at 20:35:16; its `rust-llvm` started 20:38:42, two seconds
> after run 64's `rust-slow` ended at 20:38:40. That puts the runner's concurrency limit at roughly
> four, so capacity IS a real constraint — just not the one operating in run 63, the only run this
> claim was entitled to describe. **This was a fresh unmeasured generalisation written inside a
> correction whose own subject was unmeasured generalisation**; see §6.5 for the corrected accounting
> of what run 63's *contention*, as opposed to capacity, does and does not explain. **Contention is**
> the mechanism in run 63 — a job with the box to itself is far cheaper than the same job sharing it,
> which is the same lever §6.5 credits for part of `rust-slow`'s PRE→POST shift (mean 442s → 298s) —
> though §6.5 also records a same-section counter-example that weakens the contention story too.
>
> **Caught by Davey**, who pointed out that a parallel-max model ignores limits on concurrent CI
> work. The specific limit he suspected — queueing — turns out not to apply here; the effect he
> suspected is real and larger than the correction it was aimed at.
>
> So the job buys **both**: ~6 CPU-minutes instead of ~12, and 3–5 wall-clock minutes on a draft
> push. What it does not buy is a narrower diff.
>
> **This correction is the sixth of its kind on this branch and the worst-sited**: an unmeasured
> guess written INSIDE a correction whose own subject was failing to derive things. `wall = max` is a
> statement about scheduling; it says nothing about what each job costs, and substituting one for the
> other is how a plausible model produces a confident wrong number.
>
> Restoring genuine per-push scoping would mean querying the previous run's head SHA from the Actions
> API. Considered and rejected: too much machinery, and a new network failure mode, for a job that is
> explicitly non-gating.

| Change set | Action |
|---|---|
| `docs/**`, `*.md`, `LICENSE*` only | nothing to do; exit 0 with the reason printed |
| only `crates/*/tests/**`, `crates/*/examples/**`, `crates/*/benches/**` | `fmt` + `clippy --workspace --all-targets` + `cargo nextest run -E 'binary(a) + binary(b)'` for exactly the touched test targets. Touched *examples* need no extra command: `clippy --all-targets` already builds them |
| `crates/<X>/src/**`, `crates/<X>/Cargo.toml`, `crates/<X>/build.rs` | `fmt` + `clippy --workspace --all-targets` + `cargo nextest run -E 'rdeps(<X>)'` + `cargo test --doc` for the same package set. Per §1.2 this degenerates to the whole workspace whenever `<X>` is `redextape-core`; it is a real reduction only for `redextape-native` and `redextape-native-rt` |
| workspace root (`Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `clippy.toml`, `rustfmt.toml`), `scripts/**`, `.forgejo/**`, `Dockerfile`, `deploy/**` | **refuse to scope** — print why and direct the caller to `check-all.sh` |

Unrecognised paths fall into the refuse-to-scope bucket. The default is always "run more", never "run
less": a path this script has not been taught about must not silently become a skip.

The script is usable standalone (`scripts/check-scoped.sh main..HEAD` on a dev box) and is the same
file CI invokes, so the two cannot drift — the property `check-all.sh` already has with respect to CI.

### 4.3 CI wiring

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
    paths-ignore: ["docs/**", "**/*.md", "LICENSE*"]
```

- **Draft PR** (`github.event.pull_request.draft == true`) → new `rust-scoped` job only, ranged on
  `github.event.before..HEAD`. Advisory, fast, explicitly non-gating.
- **Non-draft PR** → `rust`, `rust-llvm`, `rust-slow` exactly as today, on **every** push. This is why
  §3.1 chose the draft boolean over a label: there is no window in which the full result describes a
  tree other than the head commit.
- **Push to `main`** → unchanged. Covers the direct-to-`main` landings of §1.3.
- **`workflow_dispatch`** → unchanged, full.

The `docker` job's `needs` gating already fails closed: it requires `needs.<job>.result == 'success'`,
and a skipped job reports `skipped`, not `success`. It never runs on `pull_request` regardless. No
change needed, but the plan must confirm it rather than assume it.

### 4.4 Branch protection on `main`

**No longer separable from §4.1–§4.3 (2026-08-04, Task 10).** Task 10 retired `scripts/land.sh`, which
used to gate the merged tree before the commit existed and refuse to commit on failure. Pull requests
are now the only route to `main`, and a web-UI squash-merge inverts that ordering — the commit is built
from the PR head first, and CI's result describes that head, not a re-check of the merged tree.
Restoring an equivalent guarantee needs two settings together, not `enable_status_check` alone:

- **`enable_status_check`**, with the full jobs as required contexts. Commit statuses are SHA-scoped by
  construction, so a push after a green run leaves the requirement unfulfilled and the merge button
  stays disabled — the mechanical backstop §4.3's discipline currently lacks.
- **`block_on_outdated_branch`**, so a PR head that has fallen behind `main` cannot merge on the
  strength of a run against a tree `main` has since moved past. Without this, `enable_status_check`
  alone only proves the head was green at some point, not that it is green *as merged*.

Neither one alone suffices. Together they do not reproduce `land.sh`'s ordering — the merge commit is
still never tested before it exists — but they remove the two ways the gap actually bites: a red head,
and a stale base. The residual is a semantic conflict between two independently-green branches, which
`block_on_outdated_branch` converts from a silent landing into a forced rebase-and-re-run.

**ENABLED 2026-08-04, by the owner, directly rather than through this plan's Task 8.** Live settings,
read back from the API:

```
enable_push              false                       # PRs are the only route in
enable_status_check      true
status_check_contexts    ci / rust (pull_request)
                         ci / rust-llvm (pull_request)
                         ci / rust-slow (pull_request)
                         ci / linear-history (pull_request)
block_on_outdated_branch true
apply_to_admins          true
required_approvals       0                           # solo repo; the gate is CI, not review
```

Two of these were wrong on first creation and corrected the same day. Both are worth recording,
because both failed *open* and neither is obvious from the Forgejo UI:

- **`apply_to_admins` was `false`.** The repository owner is a site admin (`/api/v1/user` reports
  `is_admin: true`) and is the only account that merges, so the entire rule was advisory for the one
  account it needed to bind.
- **`block_on_outdated_branch` was `false`**, i.e. exactly the half this section argues is
  load-bearing.

**The contexts carry the event in the string.** `ci / rust (push)` and `ci / rust (pull_request)` are
distinct contexts; requiring the push form would make every pull request unmergeable. `detect`,
`docker` and `web` are excluded deliberately — `detect` only gates the others, `docker` never runs on
a PR by design, and `web` is skipped until `web/package.json` lands and must be added then. A glob
such as `ci / * (pull_request)` would sweep in `docker` and deadlock every PR.

> **CORRECTED 2026-08-04 (final review).** The previous sentence's mechanism for adding `web` —
> naming it in `status_check_contexts` once `web/package.json` lands — is exactly what this
> section's own measurement below shows to be unsound: a skipped job publishes `success` to the
> status API, so naming `web` there would not gate anything once `web` activates, for the same
> reason naming `rust`/`rust-llvm`/`rust-slow` did not. `web` is already in `gate`'s `needs`, guarded
> by `HAS_WEB` in exactly the shape the Rust tier uses (`.forgejo/workflows/ci.yml`, the `gate` job),
> and it must **never** be added to `status_check_contexts`.

**MEASURED 2026-08-04 ON PR #8, AND THE ANSWER INVALIDATES THIS SECTION'S REQUIRED-CONTEXT SET.**

**A skipped job reports `success`.** Uniformly — no exceptions across three commits and both event
types:

```
run 59, DRAFT PR #8 — rust / rust-llvm / rust-slow were SKIPPED by §4.3's draft gating
  ci / rust (pull_request)        success        <- never ran
  ci / rust-llvm (pull_request)   success        <- never ran
  ci / rust-slow (pull_request)   success        <- never ran
  ci / linear-history (...)       success        <- genuinely ran
  combined state:                 success
```

All four required contexts green on a pull request that ran only `detect`, `linear-history` and the
explicitly non-gating `rust-scoped`.

> **AN EARLIER DRAFT OF THIS PARAGRAPH SAID THE MAPPING WAS *INCONSISTENT* — that `web` reported
> `success` on one run and `pending` on another. THAT WAS WRONG, AND THE ERROR WAS IN THE
> MEASUREMENT, NOT THE PLATFORM.** `GET /commits/{sha}/statuses` returns the FULL HISTORY of status
> updates per context — every job posts `pending` on queue and again on start before its terminal
> status. The reading used `sort -u -k2`, which dedups on the context key and keeps whichever line
> sorts first, so it returned an arbitrary status per context and appeared to change between two
> reads of the same unchanged commit.
>
> Use `GET /commits/{sha}/status` (singular), whose `.statuses[]` is latest-per-context — that is
> also what branch protection evaluates. Re-read that way, `origin/main` and PR #7 report `success`
> for every skipped job too. The mapping was never inconsistent; the instrument was.

**Consequence: requiring `ci / rust`, `ci / rust-llvm` and `ci / rust-slow` does not do what it
appears to.** The mechanism cannot distinguish "ran and passed" from "did not run", for any job, on
any pull request. §4.3's draft gating is what exposed it, not what causes it — a `detect` that
emitted `has_rust=false` would produce three green required checks on a non-draft PR just as readily.

Only draft-ness currently prevents this being exploitable: Forgejo refuses to merge a WIP PR whatever
its checks say (`mergeable: false` on PR #8 with every context green).

**The fix is a `gate` job, and it turns on a distinction the status API lacks.** The `needs.<job>.result`
context DOES separate `skipped` from `success` — that is a different subsystem from the external
commit-status API, and `docker`'s existing `if:` already relies on it correctly. So a job that
`needs` the three, runs under `if: always()`, and fails unless all three report `success` publishes
one context that cannot be faked by a skip. `if: always()` is what stops `gate` itself from being
skipped-and-reported-green — without it the hole simply moves up one level.

**BUILT AND PROVEN 2026-08-04, run 60 — the same draft PR, one commit later.** The gate and the jobs
it guards published contradictory statuses about the same run, which is the whole point:

```
success  ci / rust (pull_request)        <- SKIPPED. The status API cannot say so.
success  ci / rust-llvm (pull_request)   <- SKIPPED.
success  ci / rust-slow (pull_request)   <- SKIPPED.
failure  ci / gate (pull_request)        <- read needs.<job>.result, saw `skipped`, refused
combined state:                failure
```

**Branch protection now requires exactly `ci / gate (pull_request)`** and nothing else. The three
jobs are no longer named as required contexts, because naming them was the defect. `linear-history`
is not named either — it is inside `gate`'s `needs` and `gate` requires it to have succeeded, so
requiring it separately would add a context without adding a check.

This also closes the wider hole rather than only the draft case. Any future skip of a gating job —
a `detect` regression, a mistyped `if:`, a dependency failure — turns `gate` red instead of quietly
green.

**Cost: about ten seconds per run.** `gate` compiles nothing; it reads five strings and exits.

---

## 5. Non-goals

1. **Splitting `redextape-core`.** Making `rdeps()` meaningful would need `tm` and `lambda` as separate
   crates. That is an architecture change wearing a CI costume, and it is not undertaken here.
2. **Coverage-based test-impact analysis** (`cargo-difftests` and similar). It is the only technique
   that gets below crate granularity soundly, and it is disproportionate machinery for a 47k-line
   workspace. (47k is right *here* — this is the whole tree, unlike §1.2's corrected per-crate figure.)
3. **Changing `check-all.sh`'s existing modes.** It stays the full gauntlet; §4.1 only adds a third
   filter over the config list it already has.
4. **Changing the slow tier's runner.** `check-slow.sh` stays on `cargo test` for the two reasons in
   its header — one measured (`--nocapture` implies `--test-threads 1` under nextest), one an
   explicitly unmeasured risk (the sweeps' memory profile under concurrency).
5. **`sccache` or cache-key rework.** Real levers, unrelated to scope, and they would confound §6's
   before/after measurement if landed in the same change.

---

## 6. How this gets verified

Ordered. Step 1 gates steps 2 and 3 — if the duplication turns out cheap, §4.1 and §2.2(b) shrink or
disappear, and this document is corrected rather than implemented as written.

1. **DONE (2026-08-04).** `T_llvm_repeat` = 50.1s warm (65.3s cold, context only — see §2.2 for why
   warm is the figure that matches CI). `T_cov_repeat` = 9.3s, under the ~45s materiality bar, so §2.2(b)
   is left alone and Task 3's step conditioned on it is dropped rather than implemented. §4.1's
   `--llvm-only` split goes ahead on the strength of §2.2(a) alone. Numbers, cache states, and the exact
   commands: §2.2 and `docs/superpowers/plans/2026-08-04-ci-scope-filters.md` Task 1.
2. **DONE (2026-08-04).** Prove the §4.1 invariant mechanically. `check-all.sh --list` plus
   `check_legs()` make the union checkable from outside rather than remembered; the verification
   command below is that check run from outside the script.
3. **DONE (2026-08-04), on the throwaway draft PR #8.** Verified the §3.1 payload assumptions before
   `ci.yml` depended on them: `github.event.pull_request.draft` IS populated (confirmed structurally
   — `rust`/`rust-llvm`/`rust-slow` could only have skipped, and `rust-scoped` could only have run,
   if Forgejo populated it), and un-drafting the PR did carry it to a full, non-scoped run. The
   `full-ci`-label fallback this step names as the alternative was never needed.
4. **DONE (2026-08-04).** Confirm `check-scoped.sh` escalates rather than skips (it is fail-safe, not
   permissive). Fed a path it has not been taught (a new top-level file); it refused to scope and
   escalated to `check-all.sh --no-llvm` rather than silently skipping. Re-confirmed during the final
   review on this same tree.
5. **Re-measure the run after landing**, same method as §1.1, and record before/after in the PR.
   **DONE 2026-08-04 — see §6.5 below.**

### 6.5 The after-figures

**CORRECTED 2026-08-04 — this section originally computed its headline `rust-slow` number from a
trimmed baseline.** This is the seventh instance of this branch's pattern (an unmeasured or
selectively-measured claim, corrected once the full data is pulled). What follows uses the full
populations: runs ≥53 only (older rows carry a stale `updated_at`, per §1.1), `updated_at −
run_started_at`, successes only. PRE = runs 53–58, the five pre-branch runs; POST = runs 62–68, the
seven runs since. Reproduce with §1.1's query, `limit` raised to cover through run 68.

**`rust-slow`: not the speedup claim this section originally made — a variance collapse instead.**

```
PRE   308 308 510 517 568          n=5  mean 442s  median 510s  range 308-568s
POST  289 290 290 290 293 295 338  n=7  mean 298s  median 290s  range 289-338s
```

Mean-to-mean: 442s → 298s, **33%**. Minimum-to-minimum: 308s → 289s, **6%**. The number this section
originally reported — "44% off" — came from comparing three trimmed PRE points (510s, 517s, 568s —
runs 57, 56, 53) against POST, discarding two PRE runs (55 and 58) that are both 308s and are printed
in §1.1's own table above. There is no selection rule that produces that triple and drops both 308s:
run 55 is one of the three "warm PR runs" this same section's `rust-llvm` table below uses for *its*
before-mean, and run 53 is the one that table discards as a cold outlier. The two tables selected
inversely. The honest figure is 33%, not 44%.

**What the full data actually shows is more interesting than a percentage: the range collapsed.**
PRE spans 260s (308–568). POST — seven consecutive runs — spans 49s (289–338). And the floor it now
sits at is essentially the sweep cost the `rust-slow` investigation measured independently, locally,
and by a different method entirely: **305–313s in release**
(`docs/superpowers/specs/2026-08-04-rust-slow-investigation.md` §2; the in-code figure at
`crates/redextape-core/tests/tm_exhaustive_bank_safety.rs:296`, "305s in release", dated 2026-07-30).
Post-change `rust-slow` is essentially *just the sweep*, with nothing left being stolen from it — two
independent measurements landing on the same number, in the same range, is why this is a finding and
not a coincidence, and it needs no trimming to make the case.

**`rust-llvm`: publish all twelve figures — the two-point "137s → 87s" did not survive the full
sample.**

```
PRE    135 135 141 325 581          n=5  mean 263s  median 141s  range 135-581s
POST    86  88 129 192 238 239 248  n=7  mean 174s  median 192s  range  86-248s
```

An earlier version of this section compared 3 warm PRE points (135s, 141s, 135s — runs 57, 56, 55;
mean 137s) against 2 warm POST points (88s, 86s — runs 63, 64; mean 87s) and called the ~50s
difference a reproduction of the local `T_llvm_repeat` measurement (§2.2). Those four numbers are
real, but they are 2 of the 7 POST runs, and the other 5 do not agree with them: **runs 66–68 (129s,
192s, 248s) were docs-only commits against an unchanged `Cargo.lock`** — exact-cache-key warm runs,
not cold outliers — so there is no "warm-only" rule that excludes them.

**`rust-llvm`'s MEDIAN went 141s → 192s. Worse.** The mean still improves (263s → 174s), but only
because a 581s cold-apt outlier sits in the PRE set (run 58, a push with a cold apt cache) — one
outlier doing the work a mean is supposed to resist.

`rust-llvm` also runs an unconditional apt install of LLVM 22 whose cost varies by hundreds of
seconds run to run (581s in run 58 alone), so this job's wall-clock is a noisy proxy for what
`check-all.sh --llvm-only` itself costs — the two are conflated in every figure above and this
instrument cannot separate them.

**Conclusion: there is no established `rust-llvm` improvement at the CI level, at this sample size
and with this instrument.** The local `T_llvm_repeat` = 50.1s (§2.2(a)) is unaffected by any of
this — it is a controlled, warm-target, single-box measurement and was never in question. What fails
is the transfer of that number to CI wall-clock: the sample that appeared to confirm it was 2 points,
and the full 7-point sample contradicts it. §2.2(a)'s "and it is what §4.1's split buys back" is
struck accordingly (see the note there for the full history: restored on the two-point sample,
struck again once the full sample arrived).

**Contention was named as the leading explanation for `rust-slow`'s improvement — and the same
dataset contains a direct counter-example.** The story: `rust-llvm` no longer duplicating a full
workspace build frees CPU on the shared self-hosted runner, and a single-threaded sweep is exactly
the workload that benefits most from a less-contended box. That was already hedged as "inferred from
co-occurrence, not demonstrated" (§5 of the `rust-slow` investigation), and it stays hedged, because
**run 62's `rust-slow` — 289s, the fastest ever observed — ran 18:48:46–18:53:35, entirely inside a
659s `rust` job and a 239s `rust-llvm` job on the same box.** Maximum contention among the sampled
runs, best result. Two PRE runs (both 308s) also completed with the heavy, duplicate-building
`rust-llvm` running alongside. Nothing here refutes contention as *a* contributor — the CPU-bound,
single-threaded profile §2 of the investigation measured is real — but a same-dataset counter-example
this direct means the contention story is weaker than earlier drafts of this section presented it,
and readers should weigh the variance-collapse finding above on its own two independent measurements,
not on the contention narrative.

**Capacity is a separate question from contention, and is addressed in §4.2's note, not here**: run
63 alone shows nothing queued (3 heavy jobs, ≥3 concurrent slots); run 65 shows the runner's
concurrency limit is closer to 4, by queuing twice. Both are true; neither was entitled to the
generalisation an earlier draft made from run 63 alone.

---

## 7. Risks

1. **A scoped run read as a gate.** Mitigated by the banner, by the job name (`rust-scoped`), and by
   §4.3 confining it to draft PRs. §4.4 makes it mechanical.
2. **`github.event.before` is unreliable on force-push.** A force-pushed draft branch can produce a
   range that does not describe the real change. `check-scoped.sh` must refuse to scope when the range
   endpoints are not both resolvable (`git cat-file -e`), the same defensive shape `linear-history`
   already uses for its own range computation.
3. **§4.1 drifting into partial coverage.** This is the failure mode the whole file is written against.
   §6.2 is the answer, and it is a hard gate, not a review note.
4. **A test target renamed without its filterset updating.** Not applicable — `binary()` targets are
   derived from the changed paths at run time, never hardcoded.
