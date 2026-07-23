# Redextape v1 — Implementation Roadmap

> **Companion to** the design spec: [`docs/superpowers/specs/2026-07-19-tm-lambda-visualizer-design.md`](../specs/2026-07-19-tm-lambda-visualizer-design.md).
> This roadmap sequences v1 (§11 of the spec) into **six focused implementation plans**. Each
> plan produces working, testable software on its own. Only Plan 1 (Foundation) is written in
> full detail so far — see [`2026-07-19-foundation-frontend.md`](2026-07-19-foundation-frontend.md).
> The remaining plans are sketched here and get written out one at a time, on demand, once the
> interfaces they depend on actually exist (writing them earlier would detail code against
> interfaces that will still shift).

## Why a sequence, not one plan

v1 is a full compiler front end + two backends + two interpreters + source maps + WASM + a web
UI + a CLI + a formatter. That is many independent subsystems. Per the writing-plans skill, each
becomes its own plan that ends in an independently testable deliverable. They compose along one
spine: everything meets at the **Core AST** (the spec's synchronization anchor, §4.1).

## Global constraints (apply to every plan)

Copied verbatim from the spec / existing repo config:

- **Rust edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- Toolchain: `stable`, components `rustfmt` + `clippy` (`rust-toolchain.toml`).
- CI gates (`.forgejo/workflows/ci.yml`) that must stay green:
  - `cargo fmt --all --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`
  - Web job: `npx biome ci`, `npm run typecheck`, `npm test`, `npm run build`.
- CI auto-activates on the presence of a **root `Cargo.toml`** and **`web/package.json`** — the
  workspace manifest must live at the repo root.
- Planned crates: `redextape-core` (lib), `redextape-cli` (bin), `redextape-wasm` (cdylib),
  `redextape-lsp` (bin, v2); web app under `web/`.
- **Every Core-AST node carries a stable `NodeId`** — the source-map / sync anchor (§5.4, §9).
- **No panics on user input** — malformed source produces spanned `Diagnostic`s, never a panic
  (§9.4: parse-error diagnostics from day one).
- `Nat` is a non-negative integer with **truncated subtraction (monus)**: `3 - 5 == 0` (§3.4).
- **UFCS** `recv.m(args)` is pure sugar for `m(recv, args)` (§3.4) — reduced during desugar.

## The six plans

### Plan 1 — Foundation: front end + reference interpreter  ✅ *(detailed)*

- **Crate:** `crates/redextape-core` (new workspace).
- **Delivers:** `text → tokens → surface AST → typecheck → Core AST → Value`. Lexer, Pratt
  parser, Hindley–Milner typechecker, desugar to Core, and the **reference tree-walker**
  interpreter (the oracle for §10's three-way test). Spanned parse/type diagnostics surfaced
  through a public `analyze` / `run` API.
- **Depends on:** nothing.
- **Key interfaces exposed downstream:** `redextape_core::core::{Core, NodeId}`,
  `redextape_core::value::Value`, `analyze(&str) -> Analysis`, `run(&str) -> Result<Value, RunError>`.
- **Testable outcome:** run `count_down`, `map`/`fold` demo programs end-to-end and assert the
  resulting `Value`; malformed programs yield diagnostics with correct spans.
- **Detail:** [`2026-07-19-foundation-frontend.md`](2026-07-19-foundation-frontend.md).

### Plan 2 — Lambda backend + reducer + λ text form

- **Modules in `redextape-core`:** `lambda/term.rs` (de Bruijn terms — explicit binders from day
  one, §9.2), `lambda/lower.rs` (Core → term), `lambda/reduce.rs` (normal-order reducer tracking
  the redex), `lambda/encode.rs` (Church `Nat`, Scott `Bool`/`List`), `lambda/decode.rs`
  (normal form → `Value`), `lambda/syntax.rs` (parser + printer for the λ text form).
- **Delivers:** Core → λ-term (Church/Scott, `fix`/Y for recursion, store-passing for
  `mut`/`while`, §5.1); leftmost-outermost reducer; a human-readable λ text language with a
  round-tripping parser/printer (§7.2); the first oracle test — `reference == decoded λ normal form`.
- **Depends on:** Plan 1 (`Core`, `Value`).
- **Key interfaces exposed:** `LambdaTerm`, `lower(&Core) -> LambdaTerm`, `reduce_trace(...)`,
  `decode(&LambdaTerm) -> Option<Value>`, `parse_lambda`/`print_lambda`.
- **Testable outcome:** two-way oracle (reference vs λ) passes on the demo suite + proptest
  round-trips for encodings and `parse ∘ print`.

### Plan 3 — TM backend + simulator + register-assembly + TM text form

- **Modules in `redextape-core`:** `tm/asm.rs` (register-assembly IR + parser/printer),
  `tm/lower_asm.rs` (Core → assembly), `tm/defunc.rs` (defunctionalization — closures → tag +
  env, `apply` → jump table, §5.3), `tm/machine.rs` (multi-tape TM), `tm/lower_tm.rs`
  (assembly → TM), `tm/sim.rs` (simulator: state/head/tapes, binary + unary display, §5.2),
  `tm/decode.rs` (final tape → `Value`), `tm/syntax.rs` (TM text parser/printer).
- **Delivers:** the full TM path and the three-way oracle (`reference == λ == TM`, §10.1).
  Defunctionalization may itself be phased (first-order core first, closures second — §13.3).
- **Depends on:** Plan 1. Shares the demo suite + oracle harness with Plan 2.
- **Key interfaces exposed:** `Machine`, `lower_tm(&Core) -> Machine`, `simulate_trace(...)`,
  `decode_tape(...) -> Option<Value>`, `parse_tm`/`print_tm`, `parse_asm`/`print_asm`.
- **Testable outcome:** three-way oracle passes on the demo suite; proptest generates random
  valid programs and checks all three agree (§10.2); TM text round-trips.

### Plan 4 — Sync anchor + view models + step-trace + WASM

- **Modules:** `sourcemap.rs` (Core node → λ span, Core node → TM block, §5.4), `viewmodel.rs`
  (serde-serializable `LambdaState` / `TmState`, §9.1), `trace.rs` (step-event stream, §9.3),
  `analysis.rs` (symbols + semantic tokens on top of Plan 1's diagnostics, §8/§9.4);
  new crate `crates/redextape-wasm` (cdylib, `wasm-bindgen`).
- **Delivers:** the data contract the UI renders — structured view models, a scrubbable trace,
  and source maps with full node coverage (§10.4). No rendering yet.
- **Depends on:** Plans 1–3.
- **Key interfaces exposed:** `LambdaState`, `TmState`, `StepEvent`, `SourceMap`; WASM exports
  `compile`, `step`, `run_to_cap`.
- **Testable outcome:** source-map coverage test (every Core node → non-empty λ span **and** TM
  block); view models serialize/round-trip; `wasm-pack build` succeeds.

### Plan 5 — Web UI: editable panes, renderers, linking, detach, caps

- **New app:** `web/` (Vite + React + TypeScript + Biome). CodeMirror 6 panes for source / λ /
  TM (editable + runnable, §7.1); text/table/tape renderers (§6.1); static click-linking +
  dual-focus highlight (§6.2); detach-on-edit + recompile-from-source (§7.1); per-run step/size
  caps with the "still running — hit 50k steps" affordance (§6.4).
- **Depends on:** Plan 4 (WASM package).
- **Testable outcome:** Vitest component tests + a Playwright smoke test (load a program, run,
  see linked highlights, edit a derived pane → detached badge). `npm run build` green (activates
  the CI `web` + `docker` jobs).

### Plan 6 — CLI + formatter surface

- **New crate:** `crates/redextape-cli` (bin) — `redextape fmt` (the canonical `print ∘ parse`
  formatter, §8), `redextape lint` (parse/type diagnostics to the terminal), and subcommands to
  emit + run λ / TM artifacts.
- **Depends on:** Plans 1–3 (parsers, printers, interpreters).
- **Testable outcome:** `trycmd`/`assert_cmd` golden tests for `fmt` idempotency and `run` output.

## Deferred beyond v1 (tracked, not planned here)

- **v1.5:** reference-clock synchronized stepping (§6.3) — the deferred hard part (order mismatch,
  §13.1).
- **v2:** graphical renderers (TM flow/state diagram, Tromp diagrams), linter rule sets,
  `redextape-lsp`, visible assembly pane, single-tape TM view, signed integers (§11).
- **Research track:** bidirectional editing feasibility — report + prototype, not a feature (§7.3).

### Extension tracks (raised 2026-07-22 — placement recorded, not yet planned)

Three directions on three different tracks. **None is on the critical path** to finishing Plan 3
(list access → the N-way oracle); all are post-Plan-3. Suggested order once Plan 3 lands:
single-tape TM → optimizing compiler → tree-sitter. Closures/higher-order (Plan 3b) is a separate axis.

- **Single-tape TM — backend/theory track, highest thematic payoff.** Build it as a *transformation*
  on the finished `Machine`, NOT a separate compile target: multi-tape → single-tape via the textbook
  `2k`-track interleaving simulation (per tape: a content track + a head-marker track on one tape over a
  product alphabet; each multi-tape step becomes a scan-heads / apply-and-move sweep). This *executes*
  another theorem — multi-tape ≡ single-tape — extending "watch the Church–Turing thesis happen," and
  drops straight into the oracle as a new leg: `reference == λ == multitape-TM == singletape-TM`. It is a
  pure `Machine(k-tape) → Machine(1-tape)` fn + a decode that un-interleaves the tracks; touches nothing
  in Core/asm/encoding — one interface, one oracle test. **When:** right after 2b-2-iv, while the
  multi-tape oracle context is warm. **Risk:** quadratic slowdown → generous caps + a product-alphabet
  decode (keep the alphabet a tuple, not a blown-up power set). This *supersedes* the passive "single-tape
  TM view" listed under v2 above — the reduction is the interesting artifact; the view falls out of it.

- **Optimizing compiler — IR track, oracle-guarded.** An optimization pass over Core/asm. Motivation:
  (a) practical — TM step counts explode (unary arithmetic, STACK recursion, quadratic single-tape), and
  slot-count / register-width drive tape length, so shrinking the program shrinks the machine and its
  step count; (b) pedagogical — "optimization preserves semantics" is itself an oracle story
  (`optimized == unoptimized == reference`). The strong existing oracle auto-validates every pass on the
  demo corpus + proptest, making this project unusually SAFE to optimize. Highest-value first pass:
  register allocation / slot minimization (shrinks the REG bank + tape length most); then constant
  folding + DCE + copy propagation. **When:** its own plan, after the backends are complete, with the
  oracle already green so a regression is unambiguous. **Risk:** miscompilation — mitigated by the
  oracle; apply YAGNI hard (add a pass only if it helps demos fit under caps or reads more clearly).

- **tree-sitter grammar — frontend/tooling track, defer to the visualizer.** A CST for editor tooling:
  incremental parsing, error-tolerant highlighting, a live editing surface. It does NOT replace the
  hand-written front-end parser for the oracle (it produces a CST you'd still lower into the typed Core).
  **When:** only once the interactive visualizer (Plan 5) exists and wants in-browser editing; nothing on
  the compiler/oracle path depends on it. **Risk — dual-grammar drift:** pick a lane up front — either
  tree-sitter for *highlighting only* (hand-parser stays the semantic source of truth; drift is cosmetic)
  or tree-sitter as the *only* parser (lower CST→Core; couples the build to the tree-sitter toolchain).
  Never maintain two authoritative grammars.
