# Redextape

> Watch the Church–Turing thesis happen.

Redextape transpiles a small imperative/functional programming language into **both** a
**Turing machine** and a **lambda-calculus term**, then lets you watch the *same program*
execute in both models side by side — source, λ-reduction, and TM tape/state kept in sync.

The two targets are the destination, not a means to an end: execution happens in a real
Turing-machine simulator and a real lambda reducer, so what you see is the genuine
computation — not a native run with a decorative overlay.

## Status

**Design approved; implementation not started.** Full design spec:
[`docs/superpowers/specs/2026-07-19-tm-lambda-visualizer-design.md`](docs/superpowers/specs/2026-07-19-tm-lambda-visualizer-design.md)

## Planned architecture

- **Core (Rust):** the mini-language front end plus parsers + printers for the λ / TM text
  forms, typechecker, desugar, λ + Turing-machine backends, reference interpreter, λ reducer,
  TM simulator, a shared analysis layer (diagnostics, symbols), and a formatter.
- **WASM + web UI:** runs client-side, shareable by URL. Every pane (source / λ / TM) is an
  editable, runnable editor, with pluggable renderers (text/tape now; TM flow diagrams and
  Tromp diagrams later).
- **LSP:** a native `redextape-lsp` binary reusing the core — formatting, diagnostics, and
  editor features in nvim / VS Code.
- **CLI:** native binary reusing the same core (`redextape fmt` / `lint`, run λ/TM artifacts).

## The name

**Redextape** = `redex` (a *reducible expression* — the atom of lambda-calculus reduction)
+ `tape` (the Turing-machine tape), read aloud as *"red tape."* Both computational models
are literally in the name. Alternates once in the running: *Turnstile*, *Betamax*.

## Development & CI

Infrastructure is in place ahead of the code (config-only until v1 implementation begins):

- **Forgejo Actions** (`.forgejo/workflows/ci.yml`) — a `detect` job gates `rust` (fmt, clippy,
  `cargo-llvm-cov` coverage), `web` (biome, typecheck, build), and a `docker` build-and-push to
  `forge.daveynet.xyz`. It stays green and skips until the crates / web app exist, then activates
  automatically.
- **Docker** — multi-stage `Dockerfile` (Rust→WASM → Vite bundle → nginx static image),
  `docker-compose.yml` (with What's-Up-Docker auto-update labels), and `deploy/nginx.conf`.
- **Toolchain** — `rust-toolchain.toml`, `rustfmt.toml`, `.pre-commit-config.yaml`.

Planned crate layout: `redextape-core` (lib), `redextape-cli` (bin), `redextape-wasm` (cdylib),
`redextape-lsp` (bin); web app under `web/`.

## Checks

`scripts/check-all.sh` runs the full feature matrix — `cargo fmt` once, then clippy *and* tests for
each of the four configurations: the default (`cranelift`), `--no-default-features`, `--features
llvm`, and `--no-default-features --features llvm`. CI runs this same script. Pass `--no-llvm` to
skip the LLVM configurations when no LLVM 22 toolchain is installed.

The test runner is [`cargo-nextest`](https://nexte.st), not `cargo test`: `cargo test` runs the test
binaries one at a time and only shares threads within a binary, which on this suite left 12 cores
running at 1.39x. Same tests, same pass set, 231.7s → 135.2s. `scripts/check-all.sh` fails loudly if
nextest is missing rather than falling back, so the gate behaves the same everywhere;
`scripts/setup-dev.sh` installs it. Because nextest does not run doctests, the script pairs every
config with an explicit `cargo test --doc` at the same feature flags.

The pre-commit hooks intentionally run only `cargo fmt` and `cargo clippy` — fast enough for every
commit. Run `scripts/check-all.sh` before merging.

`scripts/check-slow.sh` runs the **slow test tier**: exhaustive sweeps marked
`#[ignore = "slow tier: ..."]`, which `cargo test` skips by default and CI runs in its own job. The
marker is deliberate — `cargo test` prints the ignored count, so a skipped sweep stays visible rather
than looking like a passing one.

## Conventions

`main` is **linear** — no merge commits — and every commit on it is an **atomic unit**: it builds and
passes the gate on its own. Work happens on a feature branch, which lands as **one squashed commit**.

    scripts/land.sh                    # land the current branch (opens an editor for the subject)
    scripts/land.sh -- --no-llvm       # same, skipping the LLVM configs

Arguments after `--` go to `scripts/check-all.sh`, so `land.sh` itself is the same file in every
repo that uses it and only the gate differs.

`land.sh` refuses a dirty tree, a `main` that differs from `origin/main`, and a branch that is behind
`main`. It then squash-merges, runs `scripts/check-all.sh` **on the merged tree before the commit
exists**, and commits only if that passes — which is what makes "every commit on `main` passes CI" a
property rather than a hope. Delete the branch after landing; the squashed commit is the record.

A plain `git merge --squash` discards every commit message on the branch, so `land.sh` prefills the
message with all of them under a `--- Squashed from N commits ---` marker. Delete what you do not
want; what is left is kept verbatim. Losing the reasoning is not the price of a tidy graph.

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
