# `rust-slow` investigation: where the time actually goes

**Status: investigation only. No behaviour changed.** `scripts/check-slow.sh` and
`.forgejo/workflows/ci.yml` are untouched. This document measures the job and prices
options; any option chosen earns its own spec and PR.

## 0. Why this exists

Tasks 1–8 of the CI scope-filters plan optimised `rust-llvm`, which finished FIRST on
every recent PR run before this branch existed. `rust-slow` finished LAST on two of the
last three runs the plan's authors looked at (task-9-brief.md):

```
run 57 (PR)  rust-slow 8.5m   rust  6.6m   rust-llvm 2.2m
run 56 (PR)  rust-slow 8.6m   rust  6.3m   rust-llvm 2.4m
run 53 (PR)  rust-slow 9.5m   rust 10.9m   rust-llvm 5.4m
```

Then this branch's own first CI run (run 62 — the branch's first run, so every job's
cache started from whatever `restore-keys`/exact-key matching gave it against `main`)
produced a very different picture, with `rust-slow` untouched by any commit on this
branch:

```
             run 62 (this branch)   PR baseline (runs 55-57)
rust             659s (11.0m)         6.3-6.6m      MUCH SLOWER
rust-slow        289s ( 4.8m)         8.5-8.6m      MUCH FASTER
rust-llvm        239s ( 4.0m)         2.2-2.4m      SLOWER
```

**`rust-slow`'s wall-clock is not a stable quantity.** Across runs 53–62 it has been
observed anywhere from 289s (4.8m) to 568s (9.5m) for a job no commit on this branch
touched. Any single number below is reported with the method and cache state that
produced it — not as "the" time this job takes.

## 1. What the job is actually made of

`check-slow.sh` (no args, which is what CI's `rust-slow` job runs) executes:

```sh
cargo test --release --workspace -- --ignored --nocapture
```

The brief's claim — three `#[ignore = "slow tier: ..."]` tests, all in
`redextape-core` — was checked rather than transcribed:

```
$ grep -rn '#\[ignore = "slow tier' crates --include='*.rs'
crates/redextape-core/tests/tm_exhaustive_bank_safety.rs:258:#[ignore = "slow tier: measures enumeration cost to size the exhaustive sweep; run via scripts/check-slow.sh"]
crates/redextape-core/tests/tm_exhaustive_bank_safety.rs:313:#[ignore = "slow tier: exhaustive over ~200k (program, encoding, width) triples, ~5 min release; run via scripts/check-slow.sh"]
crates/redextape-core/src/tm/asm.rs:1230:#[ignore = "slow tier: allocates ~MAX_DECODE_NODES values"]
```

Exact match to the brief: three tests, all three locations and line numbers correct.

One of the three (`every_two_instruction_program_keeps_the_bank_well_formed`,
`tm_exhaustive_bank_safety.rs:313`) already carries its own doc comment recording an
independent measurement: **"MEASURED DIRECTLY (2026-07-30): 305s in release, a little
over five minutes."** That number predates this task and turns out to matter a great
deal — see §2.

## 2. Splitting the wall-clock: build vs. sweep

**Hypothesis under test (from the brief): almost all of the job's wall-clock is the
release build, not the three sweeps.** This is a hypothesis, not a starting fact.

**Measured 2026-08-04** on the box this session ran on (32 cores, per `nproc`; not the
CI runner — CI's core count and per-core speed are unmeasured by this task, see §6).
`/usr/bin/time` is not installed on this box; timings use bash's builtin `time` with
`TIMEFORMAT`, same form as §2.2 of `docs/superpowers/specs/2026-08-04-ci-scope-filters-design.md`.
`CARGO_TARGET_DIR` was set to `/var/tmp/redextape-slow-target` — a real disk (`ext4`,
3.0T available), deliberately not `/tmp` (tmpfs on this box, only 7.3G available, which
would also have counted against the memory cap below). Registry cache
(`$CARGO_HOME/registry`, 2.8G) was already warm, so no network fetch was measured as
part of build cost. Every command ran under:

```sh
systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 \
  --working-directory=/home/davey/projects/redextape \
  -E PATH -E HOME -E CARGO_HOME -E RUSTUP_HOME -E CARGO_TARGET_DIR=/var/tmp/redextape-slow-target \
  -- bash -c '...'
```

`free -g` before starting: 60G total, 32G available, 18G swap already in use out of
66G (pre-existing, from unrelated work on the box). The 16G cap left comfortable
headroom under that.

**`BUILD-COLD` — 40.262s wall (2G memory peak, 212.7s CPU — a ~5.3x parallelism
speedup on 32 cores).** `cargo test --release --workspace --no-run` against a target
directory removed immediately before:

```sh
export CARGO_TARGET_DIR=/var/tmp/redextape-slow-target
rm -rf "${CARGO_TARGET_DIR:?}"
bash -c 'TIMEFORMAT="BUILD-COLD %R s"; time cargo test --release --workspace --no-run'
```

No LLVM/`inkwell` compiled — `redextape-native`'s default feature is `cranelift` (its
`Cargo.toml`'s `[features] default` line), and `check-slow.sh` passes no `--features`
flag, so this matches what CI's `rust-slow` job actually builds.

**`SWEEP` — 312.946s wall (1.8G memory peak, 312.7s CPU — essentially 1.0x, i.e.
single-threaded).** `cargo test --release --workspace -- --ignored --nocapture`, run
immediately after `BUILD-COLD` so the build was already warm (`Finished ... in 0.03s`,
zero `Compiling` lines in the output — confirmed by `grep -c Compiling`):

```sh
bash -c 'TIMEFORMAT="SWEEP %R s"; time cargo test --release --workspace -- --ignored --nocapture'
```

**`SWEEP-WARM` — 311.704s wall (1.8G memory peak, 311.5s CPU).** The same command
repeated on the now fully-warm tree. Within 1.2s of `SWEEP` — the sweep's cost does not
depend on build/cache state at all, because it is runtime computation, not compilation.

**Cross-check:** `SWEEP` and `SWEEP-WARM` (312.9s, 311.7s) are 1.2s (0.4%) apart — the
only comparison in this document actually entitled to the word "noise," since it's the
same command run back-to-back on the same box. They sit ~7-8s (about 2.6%) above the
pre-existing in-code measurement of the dominant test alone (305s, §1); close enough to
corroborate that figure, but it's an independent measurement from a different date, not
a repeat trial, so "consistent with" is the honest description, not "noise."

CI run 62's *entire* `rust-slow` job wall-clock is a different kind of comparison, and
the numbers say so: it is **289s — about 24s (7.7% of 312.9s) *below* `SWEEP`, not
"within the same noise band" of it.** A whole CI job (checkout, toolchain install, cache
restore, release build, *and* the sweep) finishing in less wall-clock than this box's
sweep took by itself is not noise around a match; it is a real gap, and read plainly it
says **CI completes this sweep — plus everything else the job does — faster than this
box completes the sweep alone.** §3 supplies the mechanism (a near-zero build leg on a
warm cache); the Verdict below corrects the assumption this observation contradicts.

**CPU-time detail (from `journalctl --user`, `Consumed ... CPU time over ... wall
clock time`), because it explains why more CI cores would not help the sweep:**

| leg | wall | CPU | peak RSS |
|---|---|---|---|
| BUILD-COLD | 40.263s | 3m32.695s (212.7s) | 2.0G |
| SWEEP | 5m12.947s (312.947s) | 5m12.737s (312.7s) | 1.8G |
| SWEEP-WARM | 5m11.705s (311.705s) | 5m11.502s (311.5s) | 1.8G |

The build's CPU time is ~5.3x its wall time (parallel across crates/codegen units). The
sweep's CPU time is ~1.0x its wall time — confirmed serial (no `rayon`, no
`thread::spawn`, no `par_iter` anywhere in `tm_exhaustive_bank_safety.rs`). A faster or
more-cored CI runner would shrink the build leg; it would not shrink the sweep leg.

**Memory:** peak observed was 1.8–2.0G, well inside the 16G cap and nowhere near the
60G/all-swap incident this repository has hit before on an unbounded measurement (see
`redextape-probe-memory-caps.md`). The ~200k-triple sweep is small-state TM simulation,
not something that visibly scales with corpus size the way that earlier incident did.

### Verdict: the hypothesis is FALSIFIED

The brief's premise was that almost all of the wall-clock is the release build. On this
box the split is **40s build (cold) vs. 313s sweep** — the sweep is the dominant cost by
roughly 8x even in the coldest local scenario, and by effectively infinity (build ≈ 0.03s
warm) in the common case. Scaling the build leg up generously for CI's unknown, probably
smaller/slower runner does not change the conclusion: the build would need to cost
roughly 7-8x its local figure — 280s or more — to become merely comparable to the sweep.

Whether the sweep itself costs *more* on CI does not need to stay speculation: run 62
answers it directly, and the answer is the opposite of the guess. Its *entire*
`rust-slow` job — checkout, toolchain install, cache restore, release build, and the
sweep together — finished in **289s**, below this box's sweep-alone figure of 312.9s
(Cross-check, above). CI is not slower here; it is faster, sweep included. That does not
soften the verdict, it sharpens it: a faster CI sweep sitting on top of a near-zero CI
build (§3) still leaves the sweep as effectively the whole job. The **sweep dominates
`rust-slow`'s wall-clock, not the build.** This falsifies the premise the task was
created on; it is recorded here rather than reframed.

## 3. What CI's cache actually gives this job

`.forgejo/workflows/ci.yml`, the `rust-slow` job's cache step:

```yaml
      - uses: https://code.forgejo.org/actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: cargo-slow-${{ hashFiles('**/Cargo.lock') }}
          restore-keys: cargo-slow-
```

**The cached path does cover the release build.** `path:` includes the bare `target`
directory, and `cargo`'s release artifacts land at `$CARGO_TARGET_DIR/release` — a
subdirectory of `target`, not a sibling of it. Confirmed directly against the local
reproduction: `/var/tmp/redextape-slow-target` contains only a `release/` subtree (452M)
after the runs above; nothing the job produces lives outside `target`. The brief
flagged "if the cache is not covering the release build, that is the finding" as the
cheap-fix scenario — **checked, and it is not what's happening.** The path is correct.

**A brief-listed candidate does not hold up: `rust-slow`'s release build has nothing
to "share" from `rust` or `rust-llvm`'s caches, because neither of those jobs ever
release-builds the default-feature workspace.**

- `rust` runs `check-all.sh --no-llvm`, whose `LEGS` table invokes `cargo nextest run`,
  `cargo test --doc`, `cargo clippy`, `cargo build` — none with `--release`. Its cache
  (`cargo-${{ hashFiles(...) }}`) is a `target/debug/*` cache.
- `rust-llvm` runs `check-all.sh --llvm-only` (same `LEGS` table, same non-release legs)
  plus one release step at the very end: `cargo run --release --example opt_report -p
  redextape-native --features llvm`. `check-all.sh`'s own comment above the `LEGS` table
  is explicit that `--features llvm` is *additive* to the default `cranelift` feature,
  not a distinct config — and this command passes no
  `--no-default-features`, so it genuinely builds the feature set `{cranelift, llvm}`,
  which **is** a superset of the `{cranelift}` set `rust-slow` needs. Superset feature
  set does not mean it warms `rust-slow`'s cache, though — the reason is narrower than
  "different features," and is three things this task did check: (1) it is `cargo run
  --example`, which builds one example binary, not `cargo test`'s test binaries — none
  of the test binaries `rust-slow` runs, including the three slow-tier tests, get built
  by this step at all, regardless of feature set; (2) it is scoped to `-p
  redextape-native`, not `--workspace`, so `redextape-test-support` — a dev-dependency
  needed only for tests (`crates/redextape-native/Cargo.toml`) — is never built here;
  and (3) even for `redextape-native` itself, the one crate genuinely common to both
  builds, Cargo fingerprints a compilation unit by its enabled feature set among other
  inputs, so the `{cranelift, llvm}` build of that crate's rlib is a distinct cached
  unit from the `{cranelift}`-only rlib `rust-slow`'s plain `cargo test --release
  --workspace` needs — additive feature set notwithstanding.

Verified directly: the local reproduction's target directory (built exactly as
`check-slow.sh` builds it) contains a `release/` subtree and **no** `debug/` subtree —
confirming `target/debug` and `target/release` are disjoint, so nothing built for `rust`
or `rust-llvm` populates what `rust-slow` needs. **`rust-slow` is the only CI job that
release-builds the default-feature workspace.** Its cache namespace cannot be warmed by
any other job's run — only by a previous `rust-slow` run, on this branch or on `main`.

**What this means for run 62's cache state.** `Cargo.lock` is byte-identical between
this branch and `main` (`git diff main HEAD -- Cargo.lock` — zero lines, verified) and
has been for this branch's entire history (`git log --oneline main..HEAD -- Cargo.lock`
— empty). Since `rust-slow`'s cache key is *only* `cargo-slow-${{ hashFiles('**/Cargo.lock') }}`,
an unchanged `Cargo.lock` produces the *same* key on this branch as on `main`. That is
consistent with — though this task could not directly confirm from CI logs (see below)
— run 62 having gotten a genuine **exact-key hit** against a cache `main`'s own
`rust-slow` runs had already populated, rather than merely a `restore-keys` prefix
fallback. That is the mechanism behind §2's resolution: if the build leg cost close to
zero, run 62's 289s is checkout/toolchain-install overhead plus a sweep that itself ran
faster on CI than the 312.9s it took on this box — not a coincidental near-match, an
actually faster sweep.

**Limitation, stated plainly:** this task tried to confirm cache hit/miss directly from
CI job logs via the available Gitea/Forgejo MCP tooling (`mcp__gitea__actions_run_read`,
methods `list_run_jobs`, `list_jobs`, `list_workflows`, `get_workflow`,
`get_job_log_preview`) and every job/log-level method returned HTTP 404 on this Forgejo
instance, while `list_runs`/`get_run` (run-level, no job detail) worked fine. `tea` CLI
and direct `curl` against the token were both blocked by the local permission classifier
before they could be tried. So the cache-hit reasoning above is inference from the
`ci.yml` key formula plus the `Cargo.lock` diff plus local reproduction — **not** a
confirmed read of an actual "Cache restored from key ..." log line. A follow-on task
with job-log access could confirm or refute this directly.

## 4. Options, priced

None of these are recommended without a number behind it; none were implemented.

**(a) Leave it exactly as it is.** Cost: $0. Given §2's verdict, the job's floor is
~5 minutes of single-threaded sweep regardless of cache state, plus checkout +
toolchain-install + whatever the build leg costs on that run. This is already close to
what the *best* observed run (289s) delivers. The worst observed run (568s) has roughly
257-290s unaccounted for by the sweep alone — that gap is the only thing left to buy
back, and it is bounded well under half the job's wall-clock even in the worst case.

**(b) Make `rust-slow`'s cache exact-key hit more reliable** — e.g. give it a
`restore-keys` fallback to a shared prefix, the way the `rust-scoped` job's cache step
already falls back to `cargo-`. This is a `ci.yml` edit and out of this task's scope to
make, but its ceiling is priced by §2: at most it recovers the `BUILD-COLD` leg, measured
locally at 40.3s (2G peak, ~5.3x parallel). Scaled generously for a slower/fewer-core CI
runner, call it a few dozen seconds to a couple of minutes — that range is this option's
whole ceiling, not a separate, larger estimate. It cannot touch the ~312s sweep floor.
Best case today (run 62, likely already near-warm per §3) it saves ~0; worst case (the
~568s baseline runs, if that gap actually is a cold/fallback build) it could save up to
that same few-dozen-seconds-to-a-couple-of-minutes ceiling — a bounded slice of the
unaccounted ~257-290s, not most of it — meaningful, but unconfirmed without the job logs
§3 could not reach.

**(c) "Split build from run so the build shares `rust`'s cache."** Priced at $0 benefit
— **checked and found not viable as stated**: `rust`'s cache is `target/debug`, disjoint
from the `target/release` `rust-slow` needs (§3). This candidate does not do what it
sounds like it does; it would need to be "share a *new*, release-mode build step common
to `rust-slow` and nothing else" — which is option (b) by another name, not actually
sharing an existing cache.

**(d) Run the slow tier on `main` only, not on every PR push.** Cost: $0 engineering, but
this is a real reduction in what the tier covers today, not a formalization of behaviour
already in place: `rust-slow` already runs on every non-draft PR push as well as on
`main` — its `if:` in `ci.yml` is the same one `rust` and `rust-llvm` use. `check-slow.sh`'s
own header says CI runs this tier "on `main`," but that undersells the tier's actual scope
rather than describing it; the header is stale on WHERE CI runs the tier and should not be
read as this option already being the status quo. The actual argument against (d) is
`ci.yml`'s comment on the `rust-slow` job, which separately repeats the slow-tests-rot-if-
nothing-runs-them reasoning for running it on every push. This is a scope/coverage trade,
not a performance one, and needs its own decision from whoever owns that trade-off, not a
default recommendation here.

**(e) Parallelize the sweep internally (rayon/threads inside the test).** Unpriced —
no implementation was attempted or measured. Given the sweep is currently ~1.0x
CPU/wall (§2), a naive N-way parallelization has a theoretical ceiling around Nx on an
otherwise-idle box, but `check-slow.sh`'s own header already documents that this
tier's memory profile under concurrency has never been measured, and this task's
16G-capped, ~1.8G-actual-peak single-threaded run says nothing about what N-way
concurrent execution would peak at. This is exactly the kind of change `check-slow.sh`'s
header says needs its own measurement — out of scope here.

## 5. Open hypothesis: runner contention (untested)

§0 is the actual puzzle this task exists to explain: `rust-slow` swings from 289s to
568s across runs 53-62, on a job no commit on this branch touched. Everything in §§1-4
above prices or explains a *given* wall-clock; none of it explains why the number
moves run to run. The checkout/toolchain-install cost named in §6 below is common to
`rust`, `rust-llvm`, and `rust-slow` alike, so it cannot be the answer by itself — it
would shift every job's floor equally, not single out `rust-slow`.

The leading candidate this task did not test is contention for the runner itself:

- CI runs on a **self-hosted runner**, not ephemeral hosted infrastructure (`ci.yml`'s
  top-of-file comment). The `docker` job's builder-name comment (currently gated off)
  records that the same runner is shared with `ws-sim`, and that an unconditional
  `docker rm -f` **would have** destroyed a concurrent build's builder — a collision
  that never fired only because the `docker` job is gated off. Contention on this
  runner is therefore a known *design* hazard, not an observed one. **This is the
  fifth instance of this branch's signature failure — a crisp, checkable claim that
  cites a file and says the opposite of it.**
- `rust`, `rust-llvm`, and `rust-slow` each declare only `needs: detect` (each job's
  `needs:` line in `ci.yml`). There is no ordering between the three of them, so on a
  single self-hosted runner they can, and do, execute concurrently.
- §2 established that the sweep is CPU-bound and effectively single-threaded (CPU time
  ~1.0x wall time) — it has no I/O wait to yield during, so it has nothing to give up
  for free to a busy neighbour. Every core-cycle a neighbour takes on the same box is a
  cycle the sweep does not get.
- `rust` is the obvious neighbour to suspect. It runs `check-all.sh`, whose own header
  records switching to `cargo-nextest` specifically because it schedules every test
  from every binary in one parallel pool rather than one binary at a time — measured at
  1.39x -> 2.51x parallelism on a 12-logical-CPU box (check-all.sh's nextest-runner
  comment). Whatever `rust`'s exact concurrency on CI's actual runner, it is the one
  job of the three built to use more than one core at a time; `rust-slow` is the one
  job built to use exactly one.

A single-threaded, CPU-bound job losing scheduler cycles to a neighbour saturating
multiple cores on the same box is precisely the mechanism that produces stable CPU time
with variable wall time — which is what runs 53-62 show. It is also the picture §2's
resolution points at: run 62, the *fastest* observed `rust-slow` run at 289s, is the one
where the sweep (plus the rest of the job) came in faster than this box's uncontended
sweep alone — consistent with an uncontended run. The slow end of the range (568s) is
the candidate for what a contended run looks like.

**This is a hypothesis, not a finding — it has not been measured.** Two things would
test it directly, neither attempted by this task:

1. Compare `rust-slow`'s wall-clock across runs 53-62 against whether `rust` (and/or
   `rust-llvm`) was still running or had already finished at the same points in time —
   feasible only if job-level start/end timestamps are reachable; §3's Limitation notes
   this task's Forgejo/Gitea tooling access could not get job-log detail, only run-level
   data, so this may need a follow-on task with different access.
2. Serialise the three jobs experimentally (e.g. temporarily add `needs: rust` to
   `rust-slow`) across a handful of pushes and compare the resulting `rust-slow`
   wall-clock distribution against the concurrent baseline.

Neither has been done. This section names the candidate; it does not confirm it.

## 6. What this task did NOT investigate

- CI's actual checkout + toolchain-install fixed cost (the `curl ... rustup-init.sh`
  step every one of `rust`/`rust-llvm`/`rust-slow` pays on every run, since none of them
  use a Rust-preinstalled image). This is common to all three jobs, so it doesn't
  explain why `rust-slow` specifically varies on its own — §5 names the candidate that
  does — but it is part of every job's wall-clock floor and this task did not isolate
  it.
- CI's actual core count / per-core speed, so §2's "generous scaling" reasoning about
  the build leg's CI cost is bounding, not measured.
- Direct confirmation of cache hit/miss from an actual CI job log — attempted, blocked
  by tooling access (§3).
- Whether internally parallelizing the sweep is safe under concurrency — explicitly
  `check-slow.sh`'s own open question, not this task's to answer.
- Whether `every_two_instruction_program_keeps_the_bank_well_formed`'s own algorithm
  could be made faster (e.g. skipping redundant pairs) — a correctness/design question
  about the test itself, not a CI-tier question.
