# Redextape

> Watch the Church–Turing thesis happen.

Redextape transpiles a small imperative/functional programming language into **both** a
**Turing machine** and a **lambda-calculus term**, then lets you watch the *same program*
execute in both models side by side — source, λ-reduction, and TM tape/state kept in sync.

The two targets are the destination, not a means to an end: execution happens in a real
Turing-machine simulator and a real lambda reducer, so what you see is the genuine
computation — not a native run with a decorative overlay.

## Status

**The compiler is built, and the thing you watch it run in now has three panes.** The front end
and three backends — λ, Turing machine, and native — all work, and each is checked against the others
on every commit. `crates/redextape-wasm` compiles the compiler to WASM through **nine exports** — the
ninth, `tapeNames()`, labels the five Turing-machine tape rows from the lowering's own constants
(`build.rs`) rather than a hand-copied list, so it can only speak for machines this compiler produced.
`web/` is a real app: a source pane with live syntax highlighting and lint diagnostics, a λ pane, and a
Turing-machine pane showing all five tapes, a status line, and — Plan 5a-ii — a virtualized δ-table
beside them: current state and the rule about to fire highlighted, following the machine by default and
a control to reattach it after a manual scroll detaches it, toggleable, and tested rendering only a
viewport's worth of rows — 24 of `map_fold`'s 25,852 at CI's window size, counting the overscan —
side by side, the first thing in this project a human can click. **Both legs are steppable
forward and backward** through a recorded, byte-budgeted history (◀ ▶ ⏵ ↺), with a caps
affordance (`[continue]`) for a run that outgrows its recording budget before it outgrows its answer.
**The λ pane has no structural tree, and that is a decision, not a gap**: Plan 5a-ii measured one and cut
it — a per-frame tree costs 850 MB against a 32 MB history ring, and most steps have no tree to draw at
any budget that is still affordable
(`docs/superpowers/specs/2026-08-08-plan5a-ii-state-table-design.md` §2). What the visualizer the
project is *for* still lacks: click-linking between the panes, dual-focus highlight while running,
editable λ/TM panes with detach-on-edit, the λ pane's structural tree (deliberately, see above), and a
CLI.
See "Development & CI" below to build and run it, or still `cargo run --example` for the raw backends
without a browser.

Design spec:
[`docs/superpowers/specs/2026-07-19-tm-lambda-visualizer-design.md`](docs/superpowers/specs/2026-07-19-tm-lambda-visualizer-design.md).
The plan sequence, and the running log of what implementation falsified:
[`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`](docs/superpowers/plans/2026-07-19-redextape-roadmap.md).

## Architecture

Four crates under `crates/`.

**`redextape-core`** — the whole language, with **no dependencies** (`cargo tree -p redextape-core
--edges normal` lists only itself), which is what keeps it WASM-clean:

- **Front end:** lexer → hand-written Pratt parser → Hindley–Milner inference (Algorithm W) →
  desugar to the **Core AST** → a reference tree-walking interpreter. Every Core node carries a
  stable `NodeId`, and that id is the anchor everything downstream maps back to. Malformed input
  produces spanned `Diagnostic`s rather than a panic, and the rule is mechanical rather than
  documentary: `[workspace.lints.clippy]` warns on `unwrap`/`expect`/`panic`/`todo`/
  `unimplemented`, which CI's `-D warnings` makes fatal.
- **λ backend** (`src/lambda/`) — Core → de Bruijn terms (Church `Nat`, Scott `Bool`/`List`, the
  call-by-name Y for recursion, store-passing for `mut`/`while`), a normal-order reducer that
  reports the redex path at each step, type-directed decode back to a `Value`, and a round-tripping
  λ text form.
- **TM backend** (`src/tm/`) — Core → a register-assembly IR → a genuine multi-tape Turing machine,
  with defunctionalization for higher-order programs, two interchangeable numeric encodings
  (`Unary` and `Binary`), a simulator, and a **self-describing** `.tm` text form whose optional
  header records the initial tapes, so a foreign simulator can run the file knowing nothing about
  this project.
- **Shared layers:** `sourcemap` (`NodeId` → λ-subterm path, `NodeId` → TM state block), `trace`
  (one step-event vocabulary over both backends, stepped lazily — a renderer never holds the whole
  run), and `analysis` (token classification for all four languages; classes only, never colours).

**`redextape-native`** — a third backend, and the oracle leg that is neither model: a **Cranelift**
JIT, **AOT object emission** with a linker driver that produces a real standalone executable, and an
**LLVM** JIT (inkwell, behind the `llvm` feature) as a second codegen behind the same `Codegen`
seam. **`redextape-native-rt`** is its runtime — the `rt_*` heap/box/cap host functions — split out
as `rlib` + `staticlib` so an AOT binary can link them without dragging Cranelift along.
**`redextape-test-support`** holds the shared proptest generators.

### The oracle

Every backend is checked against every other on a shared 46-program corpus, which is what makes
"the same program" a property rather than a claim:

- `redextape-core`'s `tests/three_way_oracle.rs` — **`reference == λ == unary-TM == binary-TM`**.
  The two TM legs are *different machines* compiled from the same Core, not one machine read twice.
- `redextape-native`'s `tests/native_oracle.rs` adds native as a fifth leg; `tests/llvm_oracle.rs`
  pins `cranelift == llvm` at every optimization level; `tests/aot_oracle.rs` links a standalone
  binary and runs it as a subprocess.
- Both text forms have a **foreign reader** (`tests/lambda_foreign_reader.rs`,
  `tests/tm_foreign_reader.rs`) — an independent parser / reducer / simulator / decoder written from
  the doc comments alone. It is the only check that the printed formats are documented well enough
  to reimplement.

Two known limits, recorded rather than hidden. **The first is a refusal and stands; the second was a
hang and is closed — the difference between them is the whole point, and the history is kept because
four designs died against the second.** The λ backend **declines** a handful of programs the other legs
run — a closure over a `let mut` binding — and
answers a `LowerError` rather than risk a silent miscompile; they live in
`LAMBDA_LIMITATION_DEMOS` and are asserted TM-only. Separately, **nested mutually recursive `fn`
groups** blow the λ term up exponentially through structural sharing, because `lower_group` clones the
whole group term once per member and the factor nests. 512 bytes of ordinary source used to reach a
β-step that did not finish. **CLOSED 2026-08-01, at the root rather than by refusing anything** — that
program now reduces in 7.48 s, and the two-list counterexample below went from 19.0 s in its first
β-step to under a millisecond.

**Nothing guards it, and nothing needs to.** `term.rs`'s `shift` rebuilt every node it visited
unconditionally, so it was Θ(*logical*) *and* it destroyed sharing on every β-step; `reduce.rs`'s
`depth_exceeds` walked the logical expansion once per step and was 96% of what remained after that was
fixed. Both now read `u32`s the three constructors maintain in O(1) — `maxfree` (highest free index + 1;
`0` means closed) and `depth` — so `shift` and `subst` return their argument's *allocation* when it
cannot be affected, and the depth guard is a comparison.

**Four designs aimed at this hazard are dead, and the record keeps all four on purpose.** Two guards
were falsified by counterexample: a total-size bound refused a working 699-element list literal, and
`MAX_SHARED_LOGICAL_NODES` = 10,000 on the largest *shared* subterm landed and was reverted after a
trivially-written program — `let xs = [0..500); let ys = [0..500); head(xs) + head(ys)`, 4,821 bytes,
no recursion — measured **4** against it while spending 19.0 s in one step. A third, a per-redex work
budget, was never built: not falsified, made unnecessary. The fourth was a performance rewrite carrying
`subst`'s per-binder re-shift down as one `shift(d, 0, ·)`; **falsified 2026-08-02**, and on the family
it was most likely to help it is a 0.99x regression.

**The cost model those first three were argued from is also gone, and it is the interesting part.**
`|body| + Abs(body) × |arg|` was true of a `subst` whose `Abs` arm copied the argument once per binder
*whether or not the variable occurred below it*. The `maxfree` short-circuit means it no longer does —
`subst` descends only along paths to an occurrence, and `shift(1, 0, arg)` is a refcount bump for the
88.4% of β-steps whose argument is closed. Measured, the model over-reports the cost it names by
~1,584x. The probe that carried it could not detect this on its own, because its counters *modelled* the
functions instead of measuring them; that is repaired, and it is the lesson the record is built around.

`examples/shift_cost_probe.rs` is the instrument (it carries its own memory-cap rules — read them
first), with `examples/lambda_sharing_probe.rs`, `examples/blowup_probe.rs`,
`examples/list_reduction_probe.rs` and `examples/guard_hole_probe.rs` alongside; the falsified
counterexamples run in CI as `tests/guard_counterexamples.rs`. Start from the λ section of
`docs/superpowers/plans/2026-07-19-redextape-roadmap.md` rather than the specs, two of which are
withdrawn designs retained deliberately.

**Divergence is a separate matter and is untouched** — the family has no base case, so "terminates"
means it reaches a cap in bounded time. The cap it reaches is **`MAX_TERM_DEPTH`, not
`MAX_REDUCTION_STEPS`** (105,607 steps against a step cap of 5,000,000), because the family grows deep
as it diverges. Both are reachable only because control now returns from each β-step.

### Not built yet

- **The full visualizer** — `crates/redextape-wasm` (cdylib) and `web/` (Vite + CodeMirror 6, no
  framework) now ship three panes (Roadmap Plan 5a-i) plus a virtualized δ-table in the TM pane (Plan
  5a-ii): an editable source pane with live syntax highlighting and lint diagnostics, a λ pane, and a
  Turing-machine pane with all five tapes, a status line, and a state table that follows the machine,
  highlights the current state and the rule about to fire, and renders only the rows on screen — tested
  against a viewport-derived bound, which is 24 rows of `map_fold`'s 25,852 at CI's window size, and a
  flat ceiling of 200 that a whole-table renderer would miss by two orders of magnitude — both legs
  independently steppable forward and backward
  through a recorded history with a caps affordance for a run that exceeds it. Still missing:
  click-linking between the panes, dual-focus highlight while running (blocked — see the roadmap's Plan
  5 entry), and editable λ / TM panes with detach-on-edit and recompile-from-source. **The λ pane's
  structural tree is not one of these** — Plan 5a-ii measured it and cut it rather than leaving it
  unscheduled: a per-frame tree costs 850 MB against `HISTORY_BYTES`' 32 MB ring, and most steps have no
  tree to draw at any budget that is still affordable
  (`docs/superpowers/specs/2026-08-08-plan5a-ii-state-table-design.md` §2).
- **CLI** — `crates/redextape-cli`: `redextape fmt` / `lint`, plus subcommands to emit and run λ /
  TM artifacts. Roadmap Plan 6. `fmt` is blocked on a decision nobody has made yet — the lexer
  discards `//` comments, so a `print ∘ parse` formatter over that AST would delete every one.
- **LSP** — `crates/redextape-lsp`, deferred to v2.

Until those land, the examples are the interface:

    cargo run --example lambda_demo -p redextape-core     # compile to λ, reduce it step by step
    cargo run --example tm_demo     -p redextape-core     # compile to a TM, simulate, decode
    cargo run --example tm_emit     -p redextape-core     # write a self-describing .tm, run one back
    cargo run --example native_demo -p redextape-native   # compile to host machine code and run it

## The name

**Redextape** = `redex` (a *reducible expression* — the atom of lambda-calculus reduction)
+ `tape` (the Turing-machine tape), read aloud as *"red tape."* Both computational models
are literally in the name. Alternates once in the running: *Turnstile*, *Betamax*.

## Development & CI

- **Forgejo Actions** (`.forgejo/workflows/ci.yml`) — a `detect` job gates each build job on what
  exists in the tree. **Live:** `linear-history` (unconditional), `rust` (fmt, clippy,
  `scripts/check-all.sh --no-llvm`, then `cargo llvm-cov nextest` against a 90% line floor),
  `rust-llvm` (installs LLVM 22, runs the full `scripts/check-all.sh`, then an informational
  optimization report), `rust-slow` (the exhaustive sweeps), `rust-scoped` (the cheap path for a
  change that touches one crate), `rust-browser` (the wasm boundary under headless Chrome), `gate`
  (the required check — it fails loudly rather than letting a skipped tier pass quietly), and — now
  that `web/package.json` has landed — `web` (biome, typecheck, both Vitest projects under a
  coverage gate, build) and the `docker` build-and-push to `forge.daveynet.xyz`. **Every push to
  `main` now builds and pushes an image**; there is no way to land `web/` changes without arming
  that job.
- **Docker** — multi-stage `Dockerfile` (Rust→WASM → Vite bundle → nginx static image),
  `docker-compose.yml`, and `deploy/nginx.conf`. Buildable:
  stage 1 builds `crates/redextape-wasm`, stage 2 builds `web/`.
- **Toolchain** — `rust-toolchain.toml` (stable), `rustfmt.toml` (`max_width = 120`),
  `.pre-commit-config.yaml`. `scripts/setup-dev.sh` is the once-per-clone setup — it installs
  cargo-nextest, the pre-commit hooks, and the git config the conventions below depend on.
- **Web toolchain** — `web/` is a pnpm project (`packageManager: pnpm@11.20.0` in
  `web/package.json`), not npm. On a fresh clone, `wasm-pack` has not run yet, so the repo-root `pkg/`
  directory it writes to (gitignored, imported from `web/src/` as `../pkg/redextape_wasm.js`) does not
  exist — and `tsc` resolves that import against a `.d.ts` `wasm-pack` has not produced yet either. Run
  once, in order, before anything else in `web/` works:

      cd web && pnpm install && pnpm run build:wasm

  Only after that will `pnpm run dev`, `pnpm run typecheck`, or `pnpm test` succeed.

## Checks

`scripts/check-all.sh` runs the full feature matrix — `cargo fmt` once, then clippy *and* tests for
each of the four configurations: the default (`cranelift`), `--no-default-features`, `--features
llvm`, and `--no-default-features --features llvm`. CI runs this same script. Pass `--no-llvm` to
skip the LLVM configurations when no LLVM 22 toolchain is installed.

That gate currently covers **841 tests** at default features (`redextape-core` 716,
`redextape-wasm` 48, `redextape-native` 66, `redextape-native-rt` 11) — 3 are skipped, so 838 run —
and `--features llvm` takes `redextape-native` to 104. Recount rather than trust those numbers:
`cargo nextest list --workspace`.

**Two tiers sit outside that count**, because neither runs under `cargo nextest`. The wasm boundary
has **15** browser tests (`wasm-pack test --headless --chrome crates/redextape-wasm`), run by CI's
`rust-browser` job. `web/` has **246** of its own across two Vitest projects — 187 in Node for the
pure modules, 59 in real Chromium for the worker and the app end to end — run by CI's `web` job
under the coverage gate. Recount with `pnpm test`.

All three numbers in the last two paragraphs were stale when measured on 2026-08-09, and the web one
badly: it read **48** from PR 3c while the suite grew fivefold underneath it. That is what the
recount instructions are for — a test count in prose has no mechanism keeping it honest, so treat
every figure here as a claim with a date rather than a fact.

The test runner is [`cargo-nextest`](https://nexte.st), not `cargo test`: `cargo test` runs the test
binaries one at a time and only shares threads within a binary, which on this suite left 12 cores
running at 1.39x. Same tests, same pass set, 231.7s → 135.2s. `scripts/check-all.sh` fails loudly if
nextest is missing rather than falling back, so the gate behaves the same everywhere;
`scripts/setup-dev.sh` installs it. Because nextest does not run doctests, the script pairs every
config with an explicit `cargo test --doc` at the same feature flags.

There are **six** pre-commit hooks. A Rust change runs `cargo fmt` and `cargo clippy` and nothing
heavier; a `web/` change runs `biome ci` and `tsc --noEmit`. The other two — `check-text-bytes` and
`check-citations` — are unscoped and walk `git ls-files` on every commit whatever is staged, because
both catch things that arrive in a path nobody thought to list. All six are fast enough for every
commit. Run `scripts/check-all.sh` before merging.

`scripts/check-slow.sh` runs the **slow test tier**: exhaustive sweeps marked
`#[ignore = "slow tier: ..."]` — three of them today — which `cargo test` skips by default and CI
runs in its own job. The marker is deliberate: `cargo test` prints the ignored count, so a skipped
sweep stays visible rather than looking like a passing one.

## Conventions

`main` is **linear** — no merge commits — and every commit on it is an **atomic unit**: it builds and
passes the gate on its own. Work happens on a feature branch, which lands as **one squashed commit**.

Pull requests are the only route to `main` — there is no local landing script. Push the branch, open
a PR, and once CI has run, squash-merge it in the Forgejo web UI:

    git push -u origin my-branch
    # open a PR at forge.daveynet.xyz, squash-merge once CI is green

CI runs against the PR head on every push to a **non-draft** PR, so its result is visible on the PR
before anyone merges it: `rust` and `rust-llvm` run `scripts/check-all.sh` (`--no-llvm` and
`--llvm-only` respectively, which together cover every config), and `rust-slow` runs
`scripts/check-slow.sh`.

A **draft** PR gets `rust-scoped` instead: a fast check that escalates rather than skips; on CI it
always covers the whole branch diff — see the `rust-scoped` job header for what it actually buys.
It is explicitly non-gating — its own banner says so. `rust`, `rust-llvm` and `rust-slow` do not run on a
draft PR, and `gate` deliberately stays red until the PR leaves draft; that is expected, not a
failure to investigate. `ci / gate (pull_request)` is the single required status check either way.

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
- CI's **`linear-history`** job rejects a merge commit on `main` however it arrived. This is the gate.

Object-size baselines live in `crates/redextape-native/baselines/<target-triple>.txt` and gate the
`size_baseline` test with a 10% band. Regenerate after an intentional codegen change:

    cargo run --release --example opt_report -p redextape-native --features llvm -- --write-baseline

## License

[GNU General Public License v3.0](LICENSE.md)
