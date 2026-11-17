# Development

## Development & CI

- **Forgejo Actions** (`.forgejo/workflows/ci.yml`) — a `detect` job gates each build job on what
  exists in the tree. **Live:** `linear-history` (unconditional), `rust`
  (`scripts/check-all.sh --no-llvm --no-browser`, whose legs include fmt and clippy, then `cargo
  llvm-cov nextest` against a 90% line floor), `rust-llvm` (installs LLVM 23, runs
  `scripts/check-all.sh --llvm-only`, then an informational optimization report), `rust-slow` (the
  slow tier), `rust-scoped` (a draft PR's cheap path in place of the full jobs, scoped to the
  branch's whole diff against `main`), `rust-browser` (the wasm boundary under headless Chrome),
  `gate` (the required check — it fails loudly rather than letting a skipped tier pass quietly),
  `web` (biome, typecheck, both Vitest projects under a coverage gate, build) and the `docker`
  build-and-push to `forge.daveynet.xyz`. **Every push to `main` that
  changes anything outside `docs/` builds and pushes an image** once the jobs it needs pass; a
  docs-only push starts no run at all. There is no way to land `web/` changes without arming that
  job. The same build runs every Sunday and on a manual dispatch, because nothing else rebuilds
  `:latest` without a merge: on `main` it re-pushes `:latest` and main's `sha-` tag; a dispatch on a
  branch publishes a new `sha-` tag for that unmerged commit, and one on a `v*` tag re-pushes that
  tag's `sha-` and version tags.
- **Docker** — multi-stage `Dockerfile` (Rust→WASM → Vite bundle → nginx static image),
  `docker-compose.yml`, and `deploy/nginx.conf`. Buildable:
  stage 1 builds `crates/redextape-wasm` and `crates/redextape-lsp-wasm`, stage 2 builds `web/`.
- **Advisories** (`.forgejo/workflows/advisories.yml`) — `cargo deny check advisories` against
  `Cargo.lock`, configured by `deny.toml`, on pushes to `main`, a dispatch, Mondays 15:00 UTC, and PRs
  that touch `Cargo.lock`, a manifest or its config. A workflow of its own, outside `gate`, so a newly
  published advisory blocks no merge and no image. Its header says how to accept a finding, including the
  `ADVISORIES_MODE` switch for all of them at once.
- **Toolchain** — `rust-toolchain.toml` (stable), `rustfmt.toml` (`max_width = 120`),
  `.pre-commit-config.yaml`. `scripts/setup-dev.sh` is the once-per-clone setup — it installs
  cargo-nextest, the wasm32 target, `wasm-pack`, the pinned tree-sitter CLI, the pre-commit hooks,
  and the git config the [conventions](conventions.md) depend on.
- **Web toolchain** — `web/` is a pnpm project (`packageManager: pnpm@11.20.0` in
  `web/package.json`), not npm. On a fresh clone, `wasm-pack` has not run yet, so the repo-root
  `pkg/` and `pkg-lsp/` directories it writes to (gitignored, imported from `web/src/` as
  `../../pkg/redextape_wasm.js` and, by the LSP worker, `../../pkg-lsp/redextape_lsp_wasm.js`) do
  not exist — and `tsc` resolves those imports against `.d.ts` files `wasm-pack` has not produced
  yet either. Run once, in order, before anything else in `web/` works:

      cd web && pnpm install && pnpm run build:wasm && pnpm run build:lsp-wasm

  Only after that will `pnpm run dev`, `pnpm run typecheck`, or `pnpm test` succeed.

## Checks

`scripts/check-all.sh` runs the full feature matrix — `cargo fmt` once, then clippy *and* tests for
each configuration in its leg table, among them the workspace at default features (`cranelift`),
`redextape-native` at `--no-default-features`, `--features llvm` and `--no-default-features
--features llvm`, plus wasm32 builds, the grammars and a browser leg; `scripts/check-all.sh --list`
prints every leg. CI runs this same script. Pass `--no-llvm` to skip the LLVM configurations when no
LLVM 23 toolchain is installed, and `--no-browser` to skip the browser leg.

That gate covered **1,156 tests** at default features **when counted on 2026-08-24**
(`redextape-core` 890, `redextape-cli` 78, `redextape-wasm` 67, `redextape-native` 66,
`redextape-grammar-check` 44, `redextape-native-rt` 11; `redextape-test-support` carries none of its
own) — 8 are skipped, so 1,148 run — and `--features llvm` takes `redextape-native` higher, 104 when
last measured.

**These are dated observations rather than current facts, and the tense is deliberate.** Recovering
them costs `cargo nextest list --workspace`, which builds every test binary in the workspace, so no
gate holds them. The figures above read 841/716/48 until 2026-08-24, having drifted by 315 tests and
lost three crates from the breakdown entirely. Recount rather than trust them.

**Two tiers sit outside that count**, because neither runs under `cargo nextest`. The wasm boundary
has **36** browser tests (`wasm-pack test --headless --chrome crates/redextape-wasm`), run by CI's
`rust-browser` job. `web/` has tests of its own across two Vitest projects — Node for the pure
modules, real Chromium for the worker and the app end to end — run by CI's `web` job under the
coverage gate. Count them with `pnpm test`. `pnpm test:firefox` runs the browser tier in
Playwright's Firefox (install it once with `pnpm exec playwright install firefox`), where each test
that needs what only Chromium has is skipped with its reason. `pnpm test:firefox --reporter=verbose`
prints every reason, where the default reporter leaves some out. `pnpm test:firefox` runs two
Firefox projects, each in a Firefox of its own: `firefox-capture` runs the files on
`vite.config.ts`'s `CAPTURE_FILES` one at a time, since each takes a pointer capture through real
input and, in one Firefox, a capture takes the clicks of every other tab; `firefox` runs the rest in
one Firefox at 6 tabs, since that Firefox's one parent process synthesises every tab's real input,
and with more tabs on a loaded machine its clicks come late enough to time cases out
(`VITEST_MAX_WORKERS` sets another count). A file outside the list that takes a capture fails in
`firefox` with a message naming the list: add it to `CAPTURE_FILES`. The run still has known
failures, which later PRs fix, and nothing else runs it, CI included.

This section gives no count of the web tests because one went badly stale: it read **48** from PR 3c
while the suite grew fivefold underneath it. A test count in prose has no mechanism keeping it
honest unless `scripts/check-doc-figures.sh` holds it, as it holds the 34 above, so treat every
other figure here as a claim with a date rather than a fact.

The test runner is [`cargo-nextest`](https://nexte.st), not `cargo test`: `cargo test` runs the test
binaries one at a time and only shares threads within a binary, which on this suite left 12 cores
running at 1.39x. Same tests, same pass set, 231.7s → 135.2s. `scripts/check-all.sh` fails loudly if
nextest is missing rather than falling back, so the gate behaves the same everywhere;
`scripts/setup-dev.sh` installs it. Because nextest does not run doctests, the script pairs every
config with an explicit `cargo test --doc` at the same feature flags.

There are **fourteen** pre-commit hooks. A Rust change runs `cargo fmt` and `cargo clippy` and nothing
heavier; a `web/` change runs `biome ci` and `tsc --noEmit`; a Lua or `parser.c` change runs
`check-lua`, which parses the tracked Lua and asserts `plugin/redextape.lua`'s parser names still
equal the `tree_sitter_*` symbols the committed parsers export — a mismatch there loads the wrong
language in an editor rather than failing, so nothing else in this tree could see it. The other
nine — `check-text-bytes`, `check-citations`, `check-attributions`, `check-doc-figures`,
`check-shared-docs`, `check-colours`, `check-grammar-wasm`, `check-licences` and `check-comments` — are
unscoped and run on every commit whatever is staged: the first eight because they catch things that
arrive in a path nobody thought to list, the ninth because it reads the whole branch rather than the
staged set. The first three walk `git ls-files`, the fourth reads the files its table names, the
fifth holds every marked region in a document to the single copy under `grammars/shared/`, the
sixth scans tracked
`.css` and `.ts` files under `web/src/` for colour literals outside the palette, skipping
`palettes.ts` itself and the marked fallback block in `style.css`, and the seventh hashes each
grammar's `src/parser.c` and its `.wasm` against `grammars/wasm-manifest.json` — unscoped because the
file that goes stale is the `.wasm`, and the file being committed is `grammar.js` or `src/parser.c`,
on the other side of the same input set `check-lua`'s own scoping already names. The eighth
regenerates `web/src/third-party-licences.json`, the list the site's licences page draws, from the
installed npm packages, `cargo tree`, the repository's `LICENSE.md` and the toolchain and
colour-scheme texts under `web/scripts/toolchain-licences/` and `web/scripts/palette-licences/`,
and compares it with the committed copy — unscoped because what makes it stale is a lockfile, an
import or a dependency's own licence file, not the file being committed; it needs `web/node_modules`
in step with `web/pnpm-lock.yaml`, and `cargo`, and took 0.51-0.78 s with its self-test over five
runs (2026-10-08). The ninth, `check-comments`, fails a branch that adds history to a comment, grows
a comment block past 8 lines of text or raises an area's comment share above its budget; its three
rules are in `docs/superpowers/specs/2026-10-29-comment-guard-design.md`. The first two judge what
the branch adds since its merge base with `origin/main`, and the third each area's share across the
whole tree, which also fails as stale when a branch that removed comment lines leaves it more than
0.0050 below its budget. Its `--self-test` took 0.091-0.102 s and its scan 0.463-0.503 s over five
runs each (bash's `time` around `node scripts/check-comments.mjs --self-test`, then without the
flag; 2026-10-30, at a 1-minute load average of 13.92 on 32 cores). `check-comments` is the newest
of the nine and `check-attributions` the slowest, at ~3.2 s against the next slowest's ~1.25 s (each
hook's `--self-test` and scan, measured 2026-09-18), because it strips comments and string literals
out of every cited file rather than matching patterns line by line — the price of being able to tell
a file that OWNS a symbol from one that merely talks about it. All **fourteen** are fast enough for
every commit: measured interleaved in one session (2026-09-21, five rounds, alternating which set
went first, after one untimed warm-up of each), the unscoped six ran 5.867-5.955 s and the same six
plus `check-grammar-wasm` ran 6.042-6.084 s — the ranges do not overlap, so the ~0.09-0.22 s gap is
the seventh hook's own cost and not run-to-run noise. Run `scripts/check-all.sh` before merging.

`scripts/check-slow.sh` runs the **slow test tier**: exhaustive sweeps and other long-running tests
marked `#[ignore = "slow tier: ..."]`, which `cargo test` skips by default and CI
runs in its own job. The marker is deliberate: `cargo test` prints the ignored count, so a skipped
sweep stays visible rather than looking like a passing one.
