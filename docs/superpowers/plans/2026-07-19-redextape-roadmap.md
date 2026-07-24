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

### Extension tracks (raised 2026-07-22, expanded 2026-07-23 — placement recorded, not yet planned)

Several directions on different tracks. **None is on the critical path**; all are post-Plan-3.
Suggested order for the compiler-shaped work: single-tape TM → optimizing compiler (+ native backend,
its Tier C) → tree-sitter; the alternative front-ends, self-application demos, and terminal
visualization are each independent and can slot in anywhere. Closures/higher-order (Plan 3b) is a
separate axis. The unifying architectural fact behind most of these tracks: **the Core AST is the
front-end hub and the register-asm (`Instr`) IR is the imperative-backend hub** — front-ends plug
*into* Core, backends plug *out of* Core (λ) or *out of* asm (TM, native), optimizations live at
whichever hub maximizes reach, and visualizers are pure *consumers* of the traces the backends already
produce. The oracle validates every combination.

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

- **Optimizing compiler — IR track, oracle-guarded.** Optimization passes over the IR. Motivation:
  (a) practical — TM step counts explode (unary arithmetic, STACK recursion, quadratic single-tape), and
  slot-count / register-width drive tape length, so shrinking the program shrinks the machine and its
  step count; (b) pedagogical — "optimization preserves semantics" is itself an oracle story
  (`optimized == unoptimized == reference`). The strong existing oracle auto-validates every pass on the
  demo corpus + proptest, making this project unusually SAFE to optimize.
  **Optimization lives at three tiers, and the earlier a pass sits, the more backends it helps:**
  - **Tier A — Core → Core (helps λ *and* TM *and* native).** Constant folding, DCE, CSE, inlining,
    copy/const propagation, algebraic identities. Backend-agnostic — optimize once on Core and a smaller
    Core yields a shorter λ term (fewer β-steps), a smaller/faster TM (fewer states + steps), *and* faster
    native. Highest leverage; `defunc` already proves the Core→Core pass shape.
  - **Tier B — asm → asm (helps TM + native, not λ — λ lowers Core→λ directly, bypassing asm).**
    Register allocation / slot minimization (shrinks the REG bank + tape length most), peephole,
    dead-store elimination, jump threading, strength reduction on the `Instr` stream.
  - **Tier C — native codegen (native only).** GVN, LICM, loop unrolling, vectorization, native regalloc —
    the LLVM/Cranelift internal passes, free once native IR is emitted (see the native-backend track).
  Two properties make this project special: the **oracle is the optimizer's test harness** (every pass must
  keep `reference == λ == TM (== native)` — a miscompiling pass is refuted instantly by whichever leg
  breaks), and the **TM makes savings measurable** (the step-count goldens quantify exactly what a pass
  saved: "DCE cut `sum(5)` from 178k steps to N"; λ shows β-step deltas; native shows wall-clock — three
  lenses on one optimization). **When:** its own plan(s), after the backends are complete, oracle green so a
  regression is unambiguous; sequence Tier A → Tier B → (Tier C with the native backend). **Risk:**
  miscompilation — mitigated by the oracle; apply YAGNI hard (add a pass only if it helps demos fit under
  caps or reads more clearly).

- **Native code backend — backend track, the 4th oracle leg.** `Core → asm → native machine code`, reusing
  `lower_asm` + `defunc` UNCHANGED (the register-asm is already conventional three-address code: registers,
  `Bin` ALU ops, `Jz`/`Jmp`/labels branches, `Call`/`Ret` with an explicit stack, `Cons`/`Box` heap ops).
  Emit via **Cranelift** (pure-Rust, fast compile, JIT-oriented, lighter opts — quickest to stand up) or
  **LLVM/inkwell** (heavy dependency + toolchain, but the full −O3 pipeline — deepest native codegen). Both
  consume the *same* `Program`, so the native backend is the least locked-in decision in the system — start
  with Cranelift and swap to LLVM later without touching any front-end or optimizer pass. Needs only a tiny
  runtime (a bump allocator for cons/box cells + a result-decode routine mirroring `decode_asm`). Slots into
  the oracle as a new leg: `reference == λ == TM == native`. **Nuance:** native uses real `u64`/bignum, so it
  *escapes* the TM's `FIELD_WIDTH < 64` representability bound — it runs *bigger* programs than the TM, so
  the honest oracle relation is "native agrees with the reference on the unbounded input set; the TM only on
  the bounded set." **When:** pairs with the optimizing-compiler track as its Tier C. **Risk:** the runtime
  (allocation + decode) is the only genuinely new surface; the codegen is a near-1:1 walk of the asm.

- **Alternative front-ends — frontend track, purely additive; the angle is *paradigm diversity*.** A new
  surface language compiling to the *same* Core needs only lexer → parser → typecheck → desugar-to-Core;
  everything downstream (`defunc`, λ, asm, TM, native, the entire oracle) is REUSED UNCHANGED — it operates on
  Core, not surface syntax, so front-ends are cheap and low-risk (the oracle validates each against every
  backend on the shared demo corpus). The compelling thing isn't more syntaxes — it's spanning *paradigms*,
  demonstrating the Church–Turing thesis at the level of syntax: wildly different surface languages are the
  same underlying computation, the same λ-term, the same TM. Candidates, by (easy × compelling):
  - **C-like (imperative)** — an *easier* fit than the Rust-like one: Core is already imperative-friendly
    (`let mut`/`Assign`/`While`/`Seq`), so mutable locals / loops / functions map cleanly (`for`/`break`
    desugar to `while`; `goto` maps to the asm's `Jmp` + labels). Core needs extension only for C-only
    features — pointers, arrays, structs (a memory model); raw pointer arithmetic has no clean λ encoding, so
    those programs run on `reference`/TM/native but not λ, landing in the `assert_tm_only` two-way bucket (the
    same pattern Plan 3b-2's mutable capture uses).
  - **Lisp / S-expressions (homoiconic)** — highest bang-for-buck: S-exprs are almost free to parse and map
    near-directly onto Core (it *is* Core in parens). The code-is-data angle pairs perfectly with the
    self-application track below.
  - **Concatenative / Forth-like (stack)** — `2 3 + 4 *`: a radically different surface (no variables, a data
    stack) with a tiny grammar, lowered by threading a *compile-time* stack of Core expressions. Striking
    precisely because it looks nothing like the others yet is the same computation. (The asm's STACK tape is
    the *call* stack; the concatenative data stack compiles away entirely.)
  - **Tiny ML (functional)** — `let`/`fun`/`if`/tuples/lists/`match`: the natural functional companion; Core
    is already functional-friendly, and pattern-matching is a satisfying desugar. This is also the front-end
    that most motivates growing Core toward **sum types**, the prerequisite for fuller self-hosting (below).

  Together with the Rust-like original that is four paradigms — imperative, functional, concatenative,
  homoiconic — one Core, one λ-term, one TM. **Skip:** Prolog/logic (unification + backtracking needs a large
  new runtime — high risk) and visual/blocks (only meaningful once the web UI exists). **When:** any is a
  self-contained plan whenever desired; independent of everything else.

- **Self-application & self-hosting — demo/theory track.** Two very different levels:
  - **Scoped self-application (feasible NOW, and the more on-theme demo):** write a small interpreter *in* the
    mini-language and run it three ways. The standout: a **λ-calculus reducer** — encode λ-terms as tagged
    cons-list ASTs (tag in the head: 0 = var as a de Bruijn `Nat`, 1 = `lam`, 2 = `app` — the *same* shape
    `defunc` uses for closures `cons(tag, env)`), then write a normal-order β-step as recursion over
    `cons`/`head`/`tail`/`if`. de Bruijn indices avoid fresh-name generation, so no strings/sum-types are
    needed (ASTs are numeric-tagged trees). Result: **a Turing machine simulating a λ-calculus reducer** — the
    Church–Turing equivalence made doubly literal and self-referential (the project's two backends, one
    implemented *inside* the other). The mirror — a TM-simulator written in the mini-language, run on the λ
    backend — is equally on-theme. Bounded by `FIELD_WIDTH < 64` on the TM leg (small terms); unbounded on
    `reference`/native.
  - **Full self-hosting (INFEASIBLE with today's language, and not close):** a real compiler needs *strings*
    (source text), *sum types + pattern matching* (an AST is a tagged union of many node kinds),
    *maps/environments*, error handling, and *I/O* (to read source). The mini-language has
    `Nat`/`Bool`/`List`/functions/closures and none of the rest. **What it would take:** add strings (a
    `String` type or a `List<Nat>` convention), add **sum types + `match`** (the tiny-ML front-end is the
    natural motivator), add records, and an input path. Even then, a realistic milestone is self-hosting a
    **small subset** (the mini-language compiling a stripped-down version of itself), not the whole toolchain —
    a large undertaking. Honest read: the language is too minimal to host its *compiler* but exactly rich
    enough to host a small *interpreter*, so pursue scoped self-application first and treat full self-hosting
    as a north star that the tiny-ML + sum-types work incrementally unlocks.

- **Terminal (TUI) visualization — view-surface track, mostly for fun; a cheap rehearsal of Plan 5.** The
  render model already exists — every viewer is a pure *consumer* of traces the backends already produce, so
  this needs ZERO backend changes: the TM's `simulate_trace` → `Trace` carries per-step
  `(state, tapes-with-head-index)`; the λ reducer's `reduce_trace` carries per-step term + the *redex path*;
  the asm interpreter (`run_asm`) exposes register/heap/box state; and `print_asm`/`print_lambda`
  pretty-print. All three backends are visualizable in the terminal:
  - **TM** — animate the (now 5) tapes as labelled rows with the head cell highlighted, current state name,
    the δ-rule just fired, step counter. *Tier 1:* a quick auto-play example (crossterm/ANSI + a screen-clear
    loop, ~100 lines — ships in an afternoon: watch `1 + 2 * 3` grind through 5,724 transitions). *Tier 2:* an
    interactive stepper (ratatui) — step / play-pause / **scrub-backward** (free: the whole `Trace` is in
    memory) / speed. **Constraint:** unary tapes are long (a 326-cell REG bank) and programs step-heavy, so
    render a **viewport window centered on the head** (scroll the tape under a fixed window — more faithful to
    a real head anyway) plus speed control; lean on small demos; cap Tier 2 to small programs or step
    `simulate` lazily to avoid materializing a 240k-step trace.
  - **λ** — scrub the β-reduction: show the term at each step with the **redex highlighted** (the reducer
    already tracks the redex path), via the existing `print_lambda`. Bonus: an ASCII tree / Tromp-style
    rendering of the term.
  - **asm** — a register table + heap/box cells alongside the current `Instr` as `run_asm` steps — a
    middle-ground view between source and the TM tape.

  **Tech:** ratatui + crossterm (Tier 2), plain crossterm/ANSI (Tier 1). **When:** Tier 1 anytime (it's
  `tm_demo` + a loop + a sleep); Tier 2 a small plan paired with the CLI (Plan 6). **Payoff:** a standalone
  fun artifact *and* it validates the view-model ergonomics before the web UI. This complements the passive
  "assembly pane / single-tape view" notes under v2 — the terminal is the fastest medium to prototype them.

- **tree-sitter grammar — frontend/tooling track, defer to the visualizer.** A CST for editor tooling:
  incremental parsing, error-tolerant highlighting, a live editing surface. It does NOT replace the
  hand-written front-end parser for the oracle (it produces a CST you'd still lower into the typed Core).
  **When:** only once the interactive visualizer (Plan 5) exists and wants in-browser editing; nothing on
  the compiler/oracle path depends on it. **Risk — dual-grammar drift:** pick a lane up front — either
  tree-sitter for *highlighting only* (hand-parser stays the semantic source of truth; drift is cosmetic)
  or tree-sitter as the *only* parser (lower CST→Core; couples the build to the tree-sitter toolchain).
  Never maintain two authoritative grammars.
