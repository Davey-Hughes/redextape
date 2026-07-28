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

- **Binary-encoding follow-ups left on the table (2026-07-27).** The final whole-branch review found no
  defect that changes an answer, no totality hole, and no ladder rung whose assertions fail to bite on
  binary shapes. These are what it filed instead of blocking; each records why, so a future reader can
  weigh rather than rediscover.

  1. **DONE (15ed8dd). `Binary::arith`'s `Mul` has no lowering-size guard, and reaches an allocation abort from a ~1 KB
     source.** `Mul` is O(width²) STATES per instruction (`1.5w² + 26.5w + 13` for the gadget alone:
     143 at width 4, 7,853 at 64). Measured on `2 * 2 * … * 2` at width 64: 128 muls → 6.8M states,
     19.6M rules, **4.57 GB** peak RSS, where unary needs ~8 KB of source to reach comparable size.
     Unary is already quadratic in program length, so this is a ~35× worsening of an existing class
     rather than a new one — but "no input may crash any process" is the cardinal rule, and
     `lower_tm.rs` already establishes both the policy and the mechanism for exactly this
     (`MAX_SLOTS`/`MAX_FRAME_LOC` refuse BEFORE building, returning a degenerate halt machine).
     **Shipped:** `mul_count_unrepresentable` + `MAX_MUL_INSTRS` (32, cheap predicate: too many `Mul`
     instructions, checked unconditionally on encoding since unary reaches the same danger zone more
     slowly rather than never), refused before `lower_tm_all` builds anything, mirrored by `attribute`.
     A new `TmRun::TooLarge` reports it (and `MAX_SLOTS`'s existing refusal moved to it too, for
     consistency) rather than `HitCap`/`Overflow` — measured exactly two exhaustive `match` sites in the
     whole workspace that needed a new arm for the variant, both updated. Done together with item 1 of
     the "TM bank-safety" filing below (the same `run_tm`-mirrors-`lower_tm` story, in the same
     functions).

  2. **DONE (2026-07-27). `Binary`'s decode was width-strict; `Unary`'s is not — and the asymmetry
     was removable.** `decode_nat`/`parse_heap_cells` required a field to close exactly at `width`, so a
     tape fitted at 16 cells decoded to `None` under `Binary::default()` (64). Both now read from one
     delimiter to the next and never consult `self.width`, so any instance decodes any tape; shared
     `digit_run` (tied to `BITS`) and `word` (LSB-first, `None` past 2^64) replace the two inline loops.
     Structural is not permissive — a field must still be CLOSED by a `#`, so a run stopped by a foreign
     symbol, a run off the end of the tape, and a slot past the last field all still yield `None`.

     **The cost landed where the plan did not predict.** Giving up the width-length check was known and
     accepted; what was not written down is that this check was the RECORDED COMPENSATION for item 6's
     `heap_tape_is_well_formed` gap, so removing it would have left binary heap word length unverified
     anywhere. And the hole is invisible to every value assertion: digits are LSB-first, so a word
     truncated from its HIGH end when those digits are zero spells the SAME number (`@0#00` and `@00#00`
     both parse to `[(0, 0)]` at width 2). New `Encoding::heap_word_len` (`None` for unary, whose heap
     words are value-length mark runs; `Some(width)` for binary) moved the check into the checker in the
     same slice. REG needed no such move — `reg_bank_is_well_formed` already pins the skeleton at
     `1 + slots * (width + 1)` cells.

     Callers were NOT churned. `run_tm_fitted` + `at_width` is now redundant rather than required, and
     every site kept it with its doc corrected to say why it stays (the width names a failure, and it
     keeps `at_width` on the executed path). Removing it would delete coverage, not add clarity.

     **One more instance of the recurring pattern, caught by measuring instead of assuming.** The
     end-to-end test's first corpus (`1 + 2 * 3`, `[1, 2, 3]`, `head(tail([4,5,6]))`, `sum(4)`) fitted
     BINARY at 4 for every program — `MIN_FIELD_WIDTH`, the narrowest width there is — so the "read at a
     NARROWER width than the tape was written at" case never happened for the one encoding the test
     exists for; unary hid it by fitting at 8/16/32. Values in [16, 31] put unary at 32 and binary at 8
     simultaneously. Now asserted from both ends (`MIN_FIELD_WIDTH < width < MAX_FIELD_WIDTH`), and
     sabotage-verified that the narrow reader earns its place: a ONE-SIDED width dependence
     (`if n > self.width { return None }`) is accepted by the default reader AND the fitted reader, and
     caught only by `read at 4`.

  3. **DONE (8f49a06). `ripple_add`'s `c1 -> overflow` exit checked only REG's `SEP`** while `c0 -> fin` checks both
     tapes, and `ripple_sub`'s two exits both check both. Safe today by equal-width lockstep (and rule
     ordering cannot misfire — the four digit rules precede it and require an explicit digit on both
     tapes), but the asymmetry is unexplained in the file, and a future desync would be mislabelled
     "overflow" rather than surfacing as a stuck halt. One line.

  4. **DONE (8f49a06). `skip_cells` sat under the "HEAP tape sub-primitives" banner** though in
     `binary.rs`, with eleven call sites (3 HEAP, 8 BOX). Pure relocation into a shared-primitives
     region; work that greps by section banner could miss it.

  5. **DONE (8f49a06), and it was bigger than filed. `three_way_oracle.rs`'s `tm_val` was unary-only** — and it drove not one test but the
     ~14 metamorphic law proptests (arithmetic, list, mutation, closure, if, map_head, monus,
     distributivity) via `assert_equiv`, while its sibling `three_way_value` in the same file had been
     made four-way. Two value-oracle paths, one updated and one not: precisely the drift shape this
     branch kept finding. Now `tm_val_with(src, enc)`, checked under both encodings with the encoding
     named in every failure message, and verified to actually run by decoding the binary tape at
     `width + 4` and watching `arithmetic_laws` fail on `binary-TM violates the law (lhs): 0 + 0`.

  6. **Two checker limits. One FIXED (2026-07-27), one still documented-not-fixed.**
     `heap_tape_is_well_formed`'s missing word-LENGTH check is now **CLOSED** — item 2's structural
     decode deleted the compensation that made the gap tolerable, so the check moved into the checker
     via `Encoding::heap_word_len`. See item 2.

     Still open: `assert_delimiter_safe` infers "WORK is a fixed-width bank" from
     `!enc.init_work().is_empty()` — a proxy for a property the trait does not state, so a third encoding
     with a structured-yet-initially-empty WORK would be silently unchecked. It carries a `KNOWN LIMIT`
     block in `tests/common/mod.rs`, so a reader of the checker finds it rather than a reader of this
     roadmap. Deferred because inventing the trait predicate now means guessing what it should mean; the
     third encoding that would settle it does not exist yet.

- **Self-describing TM text form (optional header) — DONE (2026-07-28).** Spec:
  `docs/superpowers/specs/2026-07-27-tm-self-describing-header-design.md`; plan:
  `docs/superpowers/plans/2026-07-27-tm-self-describing-header.md`. A `.tm` file now records **both
  halves of a Turing machine**: δ and q₀ as before, plus the initial configuration — the literal initial
  tapes, so any simulator can run it, and the `encoding`/`width`/`slots`/`result` recipe needed to
  interpret the answer. `tests/tm_header.rs` turns a checked-in 463-line fixture into a `Value` with no
  `Core`, no `lower_tm` and no reference run; that test is the one that could not have been written if
  any part of the header were insufficient.

  **What it guarantees:** a foreign tool can RUN a `.tm` file. **What it cannot:** that tool cannot
  INTERPRET the result. Decoding needs the encoding's semantics, and a name cannot convey them. The
  asymmetry is inherent — running is universal, interpreting is not — so the header closes the gap it
  can close and names the gap it cannot.

  **Optionality is free and is pinned by four properties** (`tm/syntax.rs`), because a header adds no
  capability to the machine — it removes an INPUT requirement. Property 4 (a header-less file yields
  `None`, *not* a diagnostic) is the one that would regress silently, since a parser taught to
  recognize directives is a parser that can start requiring them. `Machine` gained no field, per the
  rule `lower_tm.rs` states twice; `tm/header.rs` does not even import `Machine`, so that rule holds at
  the import level rather than by convention. `print_tm`'s output is byte-identical to before the
  branch, pinned by the pre-existing listing golden.

  **The historical framing that motivated this slice was already stale when it started, and the
  correction is worth keeping.** The binary branch's width-STRICT decode — a tape fitted at 16 cells
  decoding to `None` under a 64-cell `Binary` — was cited as the concrete symptom. Structural decode
  removed that symptom before this slice began, but not the underlying gap: a file still recorded no
  initial tapes, no slot count and no result type. One consequence propagated all the way into the
  test design: **`width` is invisible to the end-to-end decode**, because `Binary::decode_nat` and
  `parse_heap_cells` each state outright that `self.width` is never consulted. It is visible only to
  the consistency check, where `init_reg` writes `width` cells per field. A sabotage aimed at the
  end-to-end test would have proved nothing.

  **Two findings the slice produced beyond its own scope.**

  1. *A totality hole, latent until this slice made it reachable.* `asm.rs`'s `decode_word_ty` recursed
     on the heap chain under a type that never shrinks for `List`, so a **cyclic heap overflowed the
     stack**. Unreachable while every heap came from the compiler — a cons cell's tail points only at an
     earlier cell, so compiled chains are acyclic — and reachable the moment a heap can come from a
     FILE. The spine is now a loop bounded by one step per cell, so a cycle decodes to `None`.

  2. *Seven instances of "the guard proves less than its name claims" — and **six originated in the
     PLAN**, not in the implementations.* Each was caught by a review instructed to hand-trace the
     claim rather than accept it:

     | where | claimed | actually asserted |
     |---|---|---|
     | long-list decode test | "must not change any acyclic answer" | length + nil terminator only; a reversed rebuild passed |
     | `print_tm` prefix-strip test | header lines removed | safe only by a one-character margin (`"tapes 1"` vs the `"tape "` prefix), undocumented |
     | malformed-header test | its own name says "spanned diagnostics" | `start <= end <= len`, which `{0,0}` satisfies |
     | range-check ordering | the check lives in `finish` *because* directives are order-independent | never tested with the lines reversed |
     | described-run test | "computes what an ordinary run computes" | `is_some()` |
     | tape-flip sabotage | flipping a literal tape cell reddens the end-to-end test | a DATA cell cannot — `lower_into` writes `Rr` unconditionally and the decoder reads only REG slot 0, so `Rr`'s data cells are structurally write-before-read |
     | WORK consistency equation | one of two load-bearing equations | vacuous under `Unary` (`init_work()` is empty, and empty tapes are dropped) |

     **The two most instructive were found by RUNNING the check, not reading it.** The tape-flip
     sabotage was discovered when an implementer ran it, watched it fail to fire, and root-caused it
     rather than adjusting the assertion until it passed. And the `{0,0}` span bug was living inside a
     test with the word "spanned" in its name. This is the same lesson the optimizer-tier and
     source-map branches recorded; what is new is *where* it was caught — six times in plan text,
     before it became a green test nobody would question again.

  **Deliberately not done, with reasons.** No format-version directive — it costs nothing now and a
  migration later, but it is speculative until a second version exists. No CLI or file-emitting entry
  point: `run_tm_described` + `print_tm_with` produce the text, and whether a binary should write it to
  disk is a separate question. **One new registration point:** a third encoding must be added to
  `EncodingKind` and its `parse`, which is inherent to a format that names its variants.

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

- **Machine-model reductions — a PIPELINE, of which single-tape is stage 1 (raised 2026-07-27, not yet
  planned).** The project varies two things today: the COMPILATION TARGET (reference / λ / TM / native)
  and the REPRESENTATION INSIDE a machine (unary / binary `Encoding`). It has never varied **the machine
  model itself**, and that is the axis where each step is a named theorem. The architectural principle
  is already stated for single-tape above and generalizes to all of these: a `Machine -> Machine`
  function plus a decode-unwrapper, touching NOTHING in Core, asm or `encoding`.

  **Tier 1 — three reductions that COMPOSE, and whose composition is the punchline.**

  | stage | theorem | cost |
  |---|---|---|
  | k tapes → 1 tape | multi-tape ≡ single-tape (2k-track interleaving) | quadratic |
  | arbitrary alphabet → `{0,1}` | alphabet reduction; each symbol becomes a k-bit block | ×k length, ×O(k) steps |
  | two-way tape → one-way | fold the tape at the origin onto two tracks | ~×2 |

  Apply all three and the result is the most austere machine in the textbook — **one tape, one head, two
  symbols, infinite in one direction only** — running a mini-language program, with each stage
  independently validated as its own oracle leg. The tape-folding stage is genuinely available: `sim.rs`'s
  `Tape` is a zipper with both ends growable, i.e. two-way infinite today.

  **Why this project in particular.** "Polynomial slowdown" is normally a hand-wave; here step counts are
  exact integers, so each reduction's real cost becomes a measured table on actual programs. That is the
  same move the binary-encoding slice just made, where a *predicted* slowdown turned out to be a 0.51×
  speedup once bank width was allowed to vary — the prediction was right about the mechanism and wrong
  about which effect dominates, and only measurement showed it.

  **Tier 2 — different machine MODELS (more striking, much more expensive; each needs its own simulator
  and decode, so these are not `Machine -> Machine`).**
  - *Universal TM.* Encode the machine as a tape string and run it on ONE fixed machine — the deepest
    theorem available. Direct synergy with the self-describing header slice above: a `.tm` file that
    carries its own initial configuration and result type is most of what a UTM needs as input.
  - *Two-counter (Minsky) machine.* Two integers plus increment/decrement/zero-test is Turing-complete;
    "your program, reduced to two numbers" is arresting. **Honest caveat:** the standard 2-stack →
    2-counter route uses Gödel encoding (`2^a · 3^b`), so the counters explode astronomically — realistically
    demonstrable only on trivial programs, with step counts to match.

  **Tier 3 — property-preserving variants.** A *reversible* TM (Bennett) — every step undoable, costing a
  history tape — connects computation to thermodynamics and the Landauer limit, which no other track here
  touches. An *oblivious* TM (head motion independent of input) is mainly a stepping stone to circuit
  constructions.

  **Two architectural notes, both worth settling BEFORE the first reduction ships.** (1) *Orthogonality.*
  `Encoding` varies representation WITHIN a machine; a reduction varies THE MACHINE. They must compose
  freely — binary × single-tape × 2-symbol should be a legal combination — which means the oracle's legs
  become a PRODUCT of the axes, not a sum. Decide early whether CI runs every combination or only a
  diagonal, because the cost is combinatorial and the exhaustive sweep is already the slow tier's
  dominant term. (2) *The header slice becomes load-bearing rather than a nicety.* With a family of
  machine shapes in play, "which shape is this and how do I read its tape back" stops being optional;
  a reduced machine whose initial configuration and result type travel with it is what makes a pipeline
  inspectable at each stage.

  **RECOMMENDATION: alphabet reduction to `{0,1}` is the best one to do after single-tape.** It is a pure
  `Machine -> Machine` function, it is the natural companion to the binary `Encoding` work just finished —
  and the contrast between the TWO SENSES OF "BINARY" (how a NUMBER is represented in a field, versus how
  a SYMBOL is represented in cells) is itself worth documenting, since conflating them is the obvious
  misreading — and composing the two reductions reaches the canonical machine, which is a satisfying
  place for this project to arrive.

- **Optimizing compiler — IR track, oracle-guarded.** Optimization passes over the IR. Motivation:
  (a) practical — TM step counts explode (unary arithmetic, STACK recursion, quadratic single-tape), and
  slot-count / register-width drive tape length, so shrinking the program shrinks the machine and its
  step count; (b) pedagogical — "optimization preserves semantics" is itself an oracle story
  (`optimized == unoptimized == reference`). The strong existing oracle auto-validates every pass on the
  demo corpus + proptest, making this project unusually SAFE to optimize.
  **Optimization lives at three tiers, and the earlier a pass sits, the more backends it helps:**
  - **Tier A — Core → Core (helps λ *and* TM *and* native).** Constant folding, DCE, CSE, inlining,
    copy/const propagation, algebraic identities, **closure specialization**. Backend-agnostic — optimize
    once on Core and a smaller Core yields a shorter λ term (fewer β-steps), a smaller/faster TM (fewer
    states + steps), *and* faster native. Highest leverage; `defunc` already proves the Core→Core pass shape.
    *Which* of these to build, and in what order, is no longer a guess — see **the ranked pass set** below.
  - **Tier B — asm → asm (helps TM + native, not λ — λ lowers Core→λ directly, bypassing asm).**
    Register allocation / slot minimization (shrinks the REG bank + tape length most), peephole,
    dead-store elimination, jump threading, strength reduction on the `Instr` stream. **The survey's
    #2 target — `Ret`'s frame-restore — lands here, not in Tier A**, which is the one place the measured
    ranking cuts across the tier order.
  - **Tier C — native codegen (native only): DONE** (merged 2026-07-24, `e7ca13b..451cbb4`; spec
    `docs/superpowers/specs/2026-07-24-tier-c-opt-measurement-design.md`, plan
    `.../plans/2026-07-24-tier-c-opt-measurement.md`). GVN, LICM, loop unrolling, vectorization, native
    regalloc — the LLVM/Cranelift internal passes. LLVM's arrived with native Phase 2; this slice added
    **Cranelift's opt levels, which had never been set** (so every native oracle leg had been validating
    unoptimized codegen), plus the instrumentation that makes the tier falsifiable: `measure`/`opt_report`
    (compile time, object bytes, end-to-end time per backend × level), a per-target-triple object-size
    regression gate, `scripts/check-all.sh`, and a Forgejo `rust-llvm` CI job invoking that same script.
    **Two findings worth remembering.** (1) `native_depth_cap`'s documented safety argument — "`O1+` only
    ever shrinks frames" — is **backwards for Cranelift**: optimized frames are ~3× *larger*, because
    live-range splitting spills more distinct values than there are asm registers. The margin survives
    (worst 2.94 words/register against the 4 that `BYTES_PER_VAR = 32` charges), so the constant was left
    alone — the right guard is a test that notices if the ratio moves, not a bigger constant. (2) The honest
    payoff is modest: Cranelift 0.7–1.8% smaller objects with compile time in the noise; LLVM 11–40% smaller
    for ~2.6× the compile time; and `Os`/`Oz` are byte-identical to `speed` on Cranelift, so six levels yield
    two distinct outputs there. **Tiers A and B now have a validated `-O3` reference point to measure
    against — and the TM's step-count goldens, not native wall-clock, are where their value will show.**
  **The ranked pass set — measured, not guessed.** The Core source map + step survey slice (merged
  2026-07-25, `07b5ee6`; spec `docs/superpowers/specs/2026-07-24-core-source-map-and-step-survey-design.md`)
  built the instrument that picks these passes, and **the evidence overturned the recommendation this
  roadmap previously implied**. Re-derive any number below with
  `cargo run --release --example step_survey -p redextape-core` — the survey is the source of truth and
  prints its own caveats; the ranking is transcribed here so choosing a pass does not require running it.
  **Caveat on that source of truth:** the survey's corpus (`step_survey.rs`'s own `FIRST_ORDER_DEMOS` /
  `LAMBDA_LIMITATION_DEMOS`) is a HAND-MAINTAINED copy of `tests/three_way_oracle.rs`'s arrays of the same
  names — an example is a separate binary crate and cannot `use` an integration test's module, so the
  strings are duplicated by hand — and it can silently drift out of sync with the oracle it claims to
  mirror. That is exactly what happened before this refresh: the copy sat 12 demos stale (28 vs 40) across
  two prior slices.
  Corpus: 44 oracle programs, 6,654,774 TM steps, shares step-weighted.
  1. **Closure specialization / known-callee devirtualization — 25.6%** (1,705,468 steps: `$applyN` dispatch
     12.6% + `ClosureScaffold`'s dispatch half 13.0%). *Tier A.* **The enabling pass — you cannot inline
     through `$apply1`**, so it must come first for the inliner to have anything to work on. Every closure at
     every call site in this corpus is statically known, so the opportunity is 100% present, not
     hypothetical. Measured ceilings: 86.7% on an isolated shape, 50.5% on `map` specialized to its known
     callback — both with the specialized function still *called*, so neither bundles the inliner.
     **This resync moved more than magnitudes — the raw ranking flipped.** Pre-resync this pass was both
     the recommended #1 *and* the survey's single largest bucket (27.5% > `Ret`'s 24.8%). Post-resync it
     stays #1 by recommendation but is **no longer the largest by raw step-share**: `Ret`'s frame-restore
     below now measures 27.6%, ahead of this pass's 25.6%. It keeps build-order #1 for the *structural*
     reason above — nothing can be inlined through `$apply1` until this runs — not because it is the
     biggest bucket; that argument no longer holds and this roadmap no longer makes it.
     **Prerequisite (DONE):** `defunc` used to *reject* functions both called by name and used as a
     value — the entire "direct call to a value-used function" case. Shipped 2026-07-25; see
     `docs/superpowers/plans/2026-07-25-defunc-both-called-and-value-used.md`. One exception remains:
     a cycle in the emitted binder graph (kept `fn`s and `$applyN` dispatchers) that returns to a BOTH
     function's own dispatcher is still `Unsupported` — reachable directly, through other kept `fn`s, or
     (the non-obvious path) through dispatchers of OTHER arities, e.g. `$apply1 -> f -> $apply2 -> h ->
     $apply1` when `f` and `h` are each BOTH at a different arity (see `defunc.rs`'s module doc for the
     worked counterexample). A dispatcher/callee `LetRecGroup` would lift it.
  2. **`Ret`'s frame-restore / live-`Loc`-bank reduction — 27.6%** (1,839,145 steps). The **largest single
     bucket in the survey — larger than any user construct kind, and, post-resync, larger than
     devirtualization's target above too** — and measured to grow **exactly quadratically** in locals live
     across a call (constant 2nd differences; 42× the ABI cost at K=8 versus K=0 for the *same one call*).
     *Tier B (asm→asm), not Tier A.* It is the one candidate with **no pass-ceiling probe**, because a
     hand-optimized form would have to be a different ABI rather than a different program; the scaling
     measurement is the evidence offered in place of a ceiling.
  3. **Inlining — 9.3%** (20.7% counting self-recursive calls, which it can only unroll). *Tier A.*
     Legitimate and it compounds with (1) — it also retires the `MachineScaffold` at the sites it removes —
     but its honest probe ceiling is **62.5–86.2%, not the 91.0%** the identity-callee shape reports, and its
     share is 0.36× devirtualization's.
  4. **Arithmetic passes (folding, algebraic identities, const-prop) — 7.0% step-weighted**, which looks
     negligible only under step-weighting *of this corpus*: program-averaged they are 16.1%, and on the 29
     first-order programs **25.5%, beating merged-`Apply`'s 25.0%**. Their Part B ceilings are the survey's
     highest (88.5–98.7%). *Tier A.*
  - **Adjacent, and excluded from (1) by the same bucketing rule** (*bucket by what a pass could do about
    it*): defunc's mutable-capture **boxing totals 1.2%** (79,784 steps). Devirtualization removes none of
    it; a different mutable-capture strategy removes all of it.
  - **The trap this survey exists to defuse.** A single merged `Apply` bucket (37.3%) names inlining the
    standout. It is not: that bucket is four populations with opposite optimizer implications, its largest
    slice (12.6% dispatch) is untouchable by an inliner, and another 3.3% is `cons`/`head`/`tail`/`is_empty`
    — **one asm instruction each, no frame, no `Call`, no `Ret`** — with nothing there to inline at all.
  - **The bound on all of the above, which must travel with the numbers.** This corpus is an oracle suite
    built for **backend feature coverage, not workload representativeness**. Fifteen higher-order demos
    carry **86.2% of the steps**; drop them and the headline inverts. The survey says where steps go *in
    these programs*. Choosing a pass on it means betting an intended workload resembles one of these
    populations — and that bet, not the table, is the decision.
  Two properties make this project special: the **oracle is the optimizer's test harness** (every pass must
  keep `reference == λ == TM (== native)` — a miscompiling pass is refuted instantly by whichever leg
  breaks), and the **TM makes savings measurable** (the step-count goldens quantify exactly what a pass
  saved: "DCE cut `sum(5)` from 178k steps to N"; λ shows β-step deltas; native shows wall-clock — three
  lenses on one optimization). **When:** its own plan(s), after the backends are complete, oracle green so a
  regression is unambiguous. The tier order (Tier A → Tier B → Tier C, the last now done) still says which
  tier *reaches* the most backends, but the **ranked pass set above says which pass to build**, and the two
  disagree once: the #2 target is Tier B — and, since this resync, is also the single largest bucket by raw
  step-share, ahead of the #1 pass. Build order still follows the dependency, not the share: `defunc` BOTH →
  devirtualization → frame-restore ABI → inlining. **Risk:**
  miscompilation — mitigated by the oracle; apply YAGNI hard (add a pass only if it helps demos fit under
  caps or reads more clearly).

- **Native code backend — backend track, the 4th oracle leg. v1 (Cranelift JIT) DONE** (merged, crate
  `redextape-native`; see the design spec `docs/superpowers/specs/2026-07-23-native-backend-design.md` and
  plan `docs/superpowers/plans/2026-07-23-native-backend-v1-cranelift.md`). `Core → asm → native machine code`,
  reusing `lower_asm` + `defunc` UNCHANGED (the register-asm is already conventional three-address code:
  registers, `Bin` ALU ops, `Jz`/`Jmp`/labels branches, `Call`/`Ret` with an explicit stack, `Cons`/`Box`
  heap ops). Emit via **Cranelift** (pure-Rust, fast compile, JIT-oriented, lighter opts — what v1 uses) or
  **LLVM/inkwell** (heavy dependency + toolchain, but the full −O3 pipeline — deepest native codegen). Both
  consume the *same* `Program` behind a `NativeCodegen` seam, so the native backend is the least locked-in
  decision in the system — v1 stood up on Cranelift and can swap to LLVM later without touching any front-end
  or optimizer pass. Needs only a tiny runtime (a bump allocator for cons/box cells + a result-decode routine
  mirroring `decode_asm`). Slots into the oracle as a new leg: `reference == λ == TM == native`, plus a
  `native == asm-interp` independent-codegen cross-check. **Honest bound (recalibrated during v1):** native
  runs real `u64`, so it extends the practical reach *beyond* the TM's `FIELD_WIDTH < 64` representability
  bound — but it does NOT *uniquely* escape it, because the asm INTERPRETER (`run_asm`) already runs `u64`
  (that bound is the TM's alone). Native's real payoff is the compiled-to-hardware milestone + the Tier-C
  prerequisite + the codegen cross-check. **When:** pairs with the optimizing-compiler track as its Tier C.
  **Phase 2 — LLVM behind the `Codegen` seam: DONE** (merged 2026-07-24, `782bc73..1fa29fe`; spec
  `docs/superpowers/specs/2026-07-24-native-llvm-phase2-design.md`, plan
  `docs/superpowers/plans/2026-07-24-native-llvm-phase2.md`). A second native backend on **inkwell 0.9 /
  LLVM 22.1.8** behind `--features llvm`, feature-gated so `redextape-core` stays WASM-clean and the default
  build needs no LLVM toolchain. `src/llvm.rs` is the asm→LLVM-IR walk (mirrors `codegen.rs` arm-for-arm);
  `src/shared.rs` holds the codegen-agnostic prep both backends now share (`reg_over_cap`, `param_count`,
  `native_depth_cap`); `Codegen { Cranelift, Llvm { opt } }` + `run_native_with` are the seam. **Real
  optimization:** `default<O1..O3>` IR pipelines (`O0` deliberately skips the pipeline) plus size levels
  `Os`/`Oz`. **Oracle:** `reference == cranelift == llvm` with a *direct* per-opt-level cross-backend
  comparison, faults/caps compared across backends, and a first-order proptest. `cargo run --example
  llvm_demo -p redextape-native --features llvm`.
  - **Two findings worth remembering.** (1) The `default<O_>` pipelines *delete unused function
    declarations*, so `FunctionValue` handles captured before optimizing dangle — mapping one onto the
    execution engine is UB. The fix is to re-fetch the `rt_*` imports **by name** from the post-pass module.
    (2) For `-Os`/`-Oz` the **pipeline string alone does nothing**: with the `optsize`/`minsize` function
    attributes suppressed, `Oz` comes out *larger* than `O3` (63 vs 61 IR instructions); with them, 32 vs 61.
    The attributes are the entire effect. Caveat: the size levels are near-inert on typical output from this
    front-end — every emitted callee is either recursive (the inliner declines) or single-call-site (inlined
    even at `Oz`), so loop unrolling is the only discriminating lever.
  **Phase 3 — AOT (a real runnable binary): DONE** (merged 2026-07-24, `9f173e8`; spec
  `docs/superpowers/specs/2026-07-23-native-aot-phase3-design.md`, plan
  `docs/superpowers/plans/2026-07-23-native-aot-phase3.md`). ADDITIVE — JIT and AOT coexist: both
  `JITModule` (`cranelift-jit`) and `ObjectModule` (`cranelift-object`) implement the same
  `cranelift-module::Module` trait, so the asm→CLIF walk is written once against `Module` and targets
  either. `emit_object` produces a real linkable `.o`; `link_executable` (a platform-aware `cc` link)
  produces a standalone binary that runs and prints its result. The `rt_*` host functions moved to a new
  no-Cranelift `redextape-native-rt` crate (rlib + staticlib); decode happens at the edge, driven by a
  serialized CONFIG blob. `cargo run --example aot_demo -p redextape-native` → `5050` from an actual binary.

  **Remaining phases / follow-ons (not yet planned; pursue after confirmation):**
  - **`run_asm` vs native `Loc`/`Rr` frame semantics — a real, pre-existing, backend-agnostic divergence.**
    `run_asm`'s `Call` clones the caller's locals into the saved frame and leaves `vm.locals` in place, so a
    callee **inherits** the caller's `Loc` values; both compiled backends give the callee a **zeroed** bank.
    The same class applies to `Rr` (a single global VM register in the interpreter, a per-function slot in
    both compilers): `$main: li rr,1; call g; halt` with `g: ret` gives `asm=1`, `cranelift=0`, `llvm=0`.
    Reachable through the public `compile_and_run` APIs with a hand-built `Program`, but **unreachable from
    `lower_asm`/`defunc` output** — verified by a definite-assignment dataflow check over 30 real programs
    (recursion, mutual list recursion, `while`, heap ops, `map`/`fold`, currying, immutable capture,
    mutable capture via boxing): 0 findings. (`Arg` is structurally immune: `partition` sets
    `arity = max_arg_read + 1`.) That is exactly why no oracle leg catches it. Fixing it means changing
    `redextape-core`'s `Call` semantics — a change to the *reference* oracle leg, so it deserves its own
    slice and a full re-validation, not a drive-by.
  - **AOT via LLVM.** Phase 3's object emit is Cranelift-only (`aot.rs` is `cranelift`-gated); Phase 2's
    LLVM backend is JIT-only. Emitting a `.o` through LLVM's `TargetMachine::write_to_memory_buffer` would
    give the AOT path the `-O3`/`-Os`/`-Oz` pipelines too, and would let the size levels be measured in
    **machine-code bytes** rather than IR instruction count (the honest observable for `-Oz`, which nothing
    currently measures).
  - **Pedagogical "show the native code" view — cheap, high demo value.** A `print`-style dump of the
    generated code for a program, sibling to `print_asm` / `print_tm` / `print_lambda`: the human-readable
    Cranelift IR (`Function::display()`, already available post-`define_function`) and/or a disassembly of the
    finalized machine bytes (via `cranelift-jit`'s emitted buffer or a `capstone`/`iced-x86` decode). Makes the
    demo show "here's the actual native code this program compiles to," completing the interpret / reduce /
    simulate / **compile-and-show** picture. Pure trace/artifact consumer — no codegen change, ~an afternoon.
  - **AOT-binary debuggability (tiered, convention-matching).** **Tier 0 (in Phase 3): named function
    symbols** kept in the emitted object by default (`$main`/`$sum`/`$applyN`/`rt_*`) so `nm`/`objdump`/
    backtraces are readable — matching `cc`/`ld`/`rustc` (symbols kept, opt-out `strip`). **Tier 1
    (optional follow-on): opt-in `-g` source-level debug info in each platform's NATIVE format** — DWARF
    (`gimli::write`) on ELF/Mach-O, CodeView/PDB on Windows (harder — no mature Rust PDB writer). Shared
    prerequisite: thread source spans `desugar→Core→lower_asm→codegen` + Cranelift `set_srcloc` (the asm
    IR carries none today). **Tier 2 (not planned):** variable/type info — post-lowering registers aren't
    user-meaningful. Value is marginal vs. the visualizer track for a mini-language; see the Phase-3 spec.
  **Risk:** the runtime (allocation + decode) was the only genuinely new surface; the codegen is a near-1:1
  walk of the asm. (v1's actual surprises: `lower_asm`'s inline fn layout forced a reachability partition, and
  deep fat-frame recursion forced a frame-size-aware depth cap — both resolved.)

- **Deforestation / supercompilation — optimizer track, Tier A, DECIDED 2026-07-27.** The
  zero-cost-abstraction question, asked directly: Rust fuses a chain of iterator adapters into one
  imperative loop, and the analogue here would fuse `map(f) ∘ map(g)` into `map(f∘g)` without building
  the intermediate list. **Rust's mechanism does not transfer.** Its adapters are monomorphized structs
  whose `next()` inlines, after which LLVM fuses the loop; here the builtins are only `nil`/`cons`/
  `head`/`tail`/`is_empty`, and `map`/`fold` are ORDINARY USER-DEFINED RECURSION over a cons list. So
  what is wanted is deforestation, not adapter fusion.

  **Route chosen: general deforestation, up to supercompilation. The two cheaper routes are rejected,
  and why is the point of recording this.** (a) *Pattern-rewriting the known shapes* — fires only on
  shapes someone anticipated, i.e. the optimizer that optimizes the benchmark; the exhaustive sweep and
  proptest generators exist precisely to catch that class, and an optimizer designed to need them is the
  wrong shape. (b) *Making `map`/`filter` builtins carrying fusion laws* — cheap and effective, and it
  **weakens the demonstration**: the interesting fact about this language is that `map` is DEFINABLE in
  it, not primitive to it, and a fusion law on a builtin proves nothing about the language.

  **Why this project suits supercompilation unusually well.** The hard parts in a real language —
  effects, exceptions, laziness, mutable aliasing — are largely absent; the one mutable construct
  (capture via BOX) is bounded and explicit. `defunc` already proves the Core→Core pass shape. And the
  payoff is measurable in the exact currency deforestation targets: an eliminated intermediate list is
  literally fewer `@` cons cells on the final HEAP tape and fewer HEAP walks, so "the intermediate
  structure is gone" is an OBSERVATION on the tape, not an inference from a benchmark. The oracle
  becomes `supercompiled == unoptimized == reference == λ == unary-TM == binary-TM`.

  **The two hard parts, both of which are totality problems in this project's terms.** (1) *Termination
  of the driving loop* — supercompilation drives the program symbolically and must decide when to fold a
  repeated configuration; without a whistle (a well-quasi-order such as homeomorphic embedding) forcing
  generalization, the COMPILER diverges. Totality is the cardinal rule, so the whistle is the same class
  of guard as `MAX_LOWER_DEPTH`/`MAX_DEFUNC_DEPTH`, not polish. (2) *Residual code blowup* — output can
  be exponentially larger, and on a TM that is directly visible as state count. `Mul`'s O(width²) states
  already shows state count is a real budget, so a size cap and an honest measurement of the trade are
  part of the slice, not a follow-up.

  **This REORGANIZES the ranked pass set above rather than adding to it.** Inlining, constant folding
  and closure specialization are all special cases of driving, so committing to supercompilation
  partly subsumes them. The measured #1 (closure devirtualization, 25.6%) stays first regardless — it
  is cheap, it is a special case worth having standalone, and nothing can be driven through `$apply1`
  until it runs. Ordering is therefore: devirtualize, then supercompile the first-order residue.

  **Success criteria, falsifiable:** intermediate cons cells eliminated (count `@` cells on the final
  HEAP tape, before vs after), step ratio per program, state count as the size cost, and the oracle
  green at every level. **Placement:** after the binary encoding branch and the self-describing header
  slice. Opt-in, default off, in the same discipline as `Unary::default()` remaining the default
  through the entire encoding branch — the DIFF is the artifact, not the optimized machine.

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

- **TM value encoding — the swappable `Encoding` seam, realized. Encoding track, items 1-3: DONE.**
  `tm/encoding.rs`'s `Encoding` trait was declared a "swappable seam" back in Part 2b-1 and had exactly
  one implementation (`Unary`) through all of Plan 3. Three slices closed the track out:
  1. **Per-program field-width sizing + the overflow guard — DONE** (merged 2026-07-26, `3613837..5cfd3b1`;
     spec `docs/superpowers/specs/2026-07-26-per-program-field-width-design.md`). `run_tm` now auto-fits
     the narrowest field width a program's values actually need (4 → 8 → 16 → 32 → 64, doubling) instead of
     always paying for a pinned 64-cell bank — measured **3.59× fewer steps** on the oracle corpus — and a
     value that overflows every width up to 64 now reports `TmRun::Overflow` instead of silently corrupting
     the bank (the pre-guard failure mode: a too-narrow run wrote past its field boundary and still returned
     an answer, sometimes the right one by coincidence — the dangerous case).
  2. **The bank-safety ladder — DONE** (same slice). A six-layer verification ladder for the register bank
     (write-site enumeration, guard-rule position, a per-step corpus/generated/EXHAUSTIVE — 198,928
     programs — tape invariant, a static per-rule non-termination check, HEAP/STACK final-tape structure),
     built to be reused rather than re-derived by whatever encoding came next.
  3. **`Binary`, a second `impl Encoding` — DONE** (branch `tm-binary-encoding`, 2026-07-27 onward from
     `8f076e0`; spec `docs/superpowers/specs/2026-07-26-tm-binary-encoding-design.md`, corrected in place —
     not left to drift — by this branch's own final slice). A base-2 encoding — a `w`-cell field is `w`
     LSB-first bits, holding `0..2^w` — proven against the SAME four-way oracle
     (`reference == λ == unary-TM == binary-TM`) and the SAME bank-safety ladder from item 2, generalized
     over both encodings by three new trait methods (`parse_heap_cells`, `field_symbols`, `init_work`).
     **Two predictions were made before the measurement existed; it went 1-for-2:**
     - *Binary banks are narrower — HELD.* Auto-fit settles binary at a smaller cell count for the same
       program (`let x = 40; x + 2` needs 8 cells where unary needs 64).
     - *Binary step counts are probably higher on this corpus — REFUTED IN AGGREGATE, HELD AT A FIXED
       WIDTH.* The reasoning (every demo value is under 64, precisely where a `k`-cell unary add beats a
       `w`-cell ripple carry) is correct when the width is held equal: same-width goldens
       (`tm_step_count_goldens_binary`/`_golden_higher_order_binary`, both pinned at 64 cells) show binary
       1.15-1.72× slower on three of four goldens and 10.2× slower on the one built on `Mul`. But
       `run_tm_fitted` fits each encoding to ITS OWN narrowest width, not a shared one, and the space
       saving dominates: over `width_report.rs`'s 18-program corpus binary totals **0.45×** unary's steps
       (270,369 → 122,972); over the full 50-program first-order oracle corpus (`step_survey.rs`'s Part D),
       **0.39×**. (This line first said 0.45× was 0.51×. That figure is the subtotal of a NINE-row hand
       check — which the artifact did reproduce exactly, program for program — mislabelled as the corpus
       total. Caught by the final whole-branch review, which re-ran the cited artifact.)
       The programs that DO lose are the controlled case: both encodings fit at width 4, so there is no
       bank-width advantage to hide the per-operation cost, and binary is 5-20% slower there — the number
       the refuted prediction was actually describing, isolated from the width effect it was conflated with.
     - **`Mul` costs materially more STATES than its unary counterpart**: `1.5w² + 26.5w + 13` (143 states
       at width 4, 821 at 16, 7,853 at 64) — the one gadget where shift-and-add is not a wash against
       unary's per-value chain.
     - **The design spec's own §3.3 WORK-tape estimate was wrong**: it predicted three scratch fields (for
       `mul`'s accumulator/multiplicand/multiplier). The shipped design needs **one** (`N_WORK_FIELDS = 1`)
       — `mul` shifts the ACCUMULATOR instead of the multiplicand (no multiplier register, no loop counter;
       the `w` iterations unroll at build time), and `eq`/`ne` park their intermediate in REG `rd` exactly
       as `Unary::eq_to_work` already does. Verified three times during the branch.
     - **Corrected two doc-comment claims this same branch had made false**, in `redextape-native`'s
       `native_oracle.rs`/`native_demo.rs`: "no `MAX_FIELD_WIDTH` ceiling, unlike the TM's fixed-width
       tape" was true of UNARY alone even before `Binary` existed — the phrase just never had to say so
       while unary was the only encoding. `Binary` at 64 cells covers the entire `u64` range, matching
       native's registers and the reference's own `Value::Nat(u64)` + saturating arithmetic — so the
       honest remaining gap (values `>= 2^64`) is not one this language can even express. The test
       (`native_runs_beyond_field_width`) was kept, not deleted: it still tests a real difference (native
       vs. unary), just a narrower one than advertised.
  **Honest bound, stated because every item above earns one:** all of it is measured on the oracle demo
  corpus (`FIRST_ORDER_DEMOS`/`LAMBDA_LIMITATION_DEMOS`), built for backend feature coverage, not workload
  representativeness — the step survey's own recurring caveat applies here too. **What stays open:**
  arbitrary-precision (variable-length) fields (every widening write would have to shift the bank,
  invalidating the fixed-window in-place-write invariant every gadget rests on — a large separate slice,
  deferred not rejected) and `Binary` as a fourth PARTICIPATING leg in the native oracle (its doc claims
  were corrected; the suite itself was not reparameterized to actually run both encodings).

- **TM bank-safety: the four items left on the table (2026-07-26).** The per-program field-width slice
  built a verification ladder for the register bank — enumeration of write sites, guard-rule position,
  a per-step tape invariant (corpus then generated then exhaustive over 198,928 length-2 asm programs),
  and a static per-rule check covering non-terminating runs. HEAP/STACK final-tape structure followed.
  These four were assessed and deliberately NOT done; each records why, so a future reader can weigh it
  rather than rediscover it.

  1. **DONE (15ed8dd). `run_tm` guards `MAX_SLOTS` but not `MAX_FRAME_LOC`** (small, real, PRE-EXISTING). `attribute`
     mirrors both refusals; `run_tm` mirrors only one, so a program whose `Loc` bank `lower_tm` refuses
     to lay out comes back as `TmRun::Ran` over tapes that decode to nothing, instead of a resource
     outcome. Already documented as a known asymmetry in `attribute.rs`'s `Attribution::unrepresentable`
     doc. **Shipped:** `run_tm_fitted`/`run_tm_at` now share one `lower_and_size` helper that calls
     `frame_bank_unrepresentable` (and the new `mul_count_unrepresentable`, see the binary-encoding
     follow-up item 1 above — done together, same fix in the same functions) and reports a new
     `TmRun::TooLarge`, not `HitCap`: a refused program never took a step, so `HitCap` ("hit a
     step/cell cap") would itself be a claim of more than is true.

  2. **Length-3 enumeration** (rung 2 stops at 2). Exhaustive length-3 is ~11.2M programs per width —
     infeasible — but a seeded sample is easy. **Why deferred:** length 2 is where store-then-read
     interaction first appears, which is the shape the bank invariant is about; the marginal defect
     class at length 3 is speculative rather than identified. Revisit if a defect ever escapes to a
     3-instruction shape.

  3. **The LENGTH half of the bank skeleton has no static cover.** Rung 3 proves delimiters are never
     overwritten, for every execution. It cannot see the head walking off the end of the bank and
     extending the tape, because that is a position property; that half rests on simulation. The
     informal argument is that with delimiters provably intact, `rewind_home`'s counted `#`-walk cannot
     run off — but that is an argument, not a check. Closing it needs the head-offset dataflow analysis
     rung 3 deliberately avoided, whose own soundness would become a new thing to trust.

  4. **`Encoding::at_width` on an unbounded encoding — CLOSED (2026-07-27).** This item predicted the
     branch would become testable free "the day `Binary` lands". **That prediction was wrong, and the
     binary slice recorded why:** `Binary` is bounded (a `w`-cell field holds `v < 2^w`), so it does
     not exercise `field_width() == None` either. What covers the branch is a test-only `Unbounded`
     mock in `tests/tm_encoding.rs` that delegates every gadget to `Unary` and differs only in what it
     reports. Cheap, but not free, and not a side effect of anything.

  Also settled, so nobody re-opens it: **rung 4 (mechanized proof) was assessed and rejected.** Bounded
  model checking (Kani) loses to plain enumeration on this property, because the input space is small
  enough to enumerate while executions are 10^4-10^5 steps and would have to be symbolically unwound. A
  proof assistant would verify a MODEL and leave the model-matches-`encoding.rs` gap unproven — the same
  objection raised against rung 3's analyzer, one level larger.
