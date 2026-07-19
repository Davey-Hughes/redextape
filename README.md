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

## License

[GNU General Public License v3.0](LICENSE.md)
