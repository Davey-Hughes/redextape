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

Two known limits, recorded rather than hidden. **The first is a refusal; the second is not, and that
is the whole difference between them.** The λ backend **declines** a handful of programs the other legs
run — a closure over a `let mut` binding — and
answers a `LowerError` rather than risk a silent miscompile; they live in
`LAMBDA_LIMITATION_DEMOS` and are asserted TM-only. Separately, **nested mutually recursive `fn`
groups** blow the λ term up exponentially through structural sharing, because `lower_group` clones the
whole group term once per member and the factor nests. 512 bytes of ordinary source reaches a β-step
that does not finish — a *later* step, not the first, which is cheap at every size the family reaches.
**It is open, and it is wider than that.** Two guards were designed against it and both were falsified
by measurement. A total-size bound refused a working 699-element list literal. Its successor,
`MAX_SHARED_LOGICAL_NODES` = 10,000 on the largest *shared* subterm, landed and was reverted: a
trivially-written program — `let xs = [0..500); let ys = [0..500); head(xs) + head(ys)`, 4,821 bytes,
no recursion — measures **4** against that bound of 10,000 and spends **19.0 s in its first β-step**.
The mechanism both guards named was wrong. `subst`'s `Var` arm is an `Rc` bump, so occurrences are
free; its `Abs` arm copies the whole argument once per binder in the body, whether the variable occurs
or not, so a step costs `|body| + Abs(body) × |arg|` — **neither factor a sharing property**.
`examples/blowup_probe.rs`, `examples/list_reduction_probe.rs` and `examples/guard_hole_probe.rs` are
the instruments; the record is
`docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md` §10, and the next design —
a per-redex work budget checked before each step rather than once at lowering — is in the roadmap.

Divergence is a separate matter and stays the step cap's job (`MAX_REDUCTION_STEPS`): the family does
not terminate at any level, which no guard on a step's cost would change.

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

    scripts/land.sh                    # land the current branch (opens an editor for the subject)
    scripts/land.sh -- --no-llvm       # same, skipping the LLVM configs

Arguments after `--` go to `scripts/check-all.sh`, so `land.sh` itself is the same file in every
repo that uses it and only the gate differs.

`land.sh` refuses a dirty tree, a `main` that differs from `origin/main`, and a branch that is behind
`main`. It then squash-merges, runs `scripts/check-all.sh` **on the merged tree before the commit
exists**, and commits only if that passes — which is what makes "every commit on `main` passes CI" a
property rather than a hope. It then deletes the branch, on **tree equality** with `main` rather than
on `git branch -d`'s reachability check, which always refuses a squash-merge; `--keep-branch` opts
out. The squashed commit is the record.

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
