# Redextape

> Watch the Church–Turing thesis happen.

Redextape transpiles a small imperative/functional programming language into **both** a
**Turing machine** and a **lambda-calculus term**, then lets you watch the *same program*
execute in both models side by side — source, λ-reduction, and TM tape/state kept in sync.

The two targets are the destination, not a means to an end: execution happens in a real
Turing-machine simulator and a real lambda reducer, so what you see is the genuine
computation — not a native run with a decorative overlay.

## Status

**The compiler is built; the thing you watch it in is not.** The front end and three backends — λ,
Turing machine, and native — all work, and each is checked against the others on every commit. What
does not exist yet is the visualizer the project is *for*: no WASM package, no web app, no
side-by-side panes, no CLI. Today the only way to see a run is `cargo run --example`.

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

- **WASM + web UI** — `crates/redextape-wasm` (cdylib) and `web/` (Vite + React + CodeMirror 6):
  editable, runnable source / λ / TM panes, click-linking, detach-on-edit, per-run caps. None of it
  exists. Roadmap Plans 4 (consumer slice) and 5.
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
  `scripts/check-all.sh --no-llvm`, then `cargo llvm-cov nextest` against an 80% line floor),
  `rust-llvm` (installs LLVM 22, runs the full `scripts/check-all.sh`, then an informational
  optimization report), and `rust-slow` (the exhaustive sweeps). **Still dormant:** `web` (biome,
  typecheck, unit tests, build) and the `docker` build-and-push to `forge.daveynet.xyz`, both
  waiting on `web/package.json`.
- **Docker** — multi-stage `Dockerfile` (Rust→WASM → Vite bundle → nginx static image),
  `docker-compose.yml` (with What's-Up-Docker auto-update labels), and `deploy/nginx.conf`. Not
  buildable yet: stage 1 builds `crates/redextape-wasm` and stage 2 builds `web/`.
- **Toolchain** — `rust-toolchain.toml` (stable), `rustfmt.toml` (`max_width = 120`),
  `.pre-commit-config.yaml`. `scripts/setup-dev.sh` is the once-per-clone setup — it installs
  cargo-nextest, the pre-commit hooks, and the git config the conventions below depend on.

## Checks

`scripts/check-all.sh` runs the full feature matrix — `cargo fmt` once, then clippy *and* tests for
each of the four configurations: the default (`cranelift`), `--no-default-features`, `--features
llvm`, and `--no-default-features --features llvm`. CI runs this same script. Pass `--no-llvm` to
skip the LLVM configurations when no LLVM 22 toolchain is installed.

That gate currently covers **719 tests** at default features (`redextape-core` 642,
`redextape-native` 66, `redextape-native-rt` 11), and `--features llvm` takes `redextape-native` to
104. Recount rather than trust those numbers: `cargo nextest list --workspace | wc -l`.

The test runner is [`cargo-nextest`](https://nexte.st), not `cargo test`: `cargo test` runs the test
binaries one at a time and only shares threads within a binary, which on this suite left 12 cores
running at 1.39x. Same tests, same pass set, 231.7s → 135.2s. `scripts/check-all.sh` fails loudly if
nextest is missing rather than falling back, so the gate behaves the same everywhere;
`scripts/setup-dev.sh` installs it. Because nextest does not run doctests, the script pairs every
config with an explicit `cargo test --doc` at the same feature flags.

The pre-commit hooks intentionally run only `cargo fmt` and `cargo clippy` on a Rust change — fast
enough for every commit. Run `scripts/check-all.sh` before merging.

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
