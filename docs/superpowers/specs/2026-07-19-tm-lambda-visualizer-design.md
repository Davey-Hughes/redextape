# Turing Machine + Lambda Calculus Visualizer — Design

**Date:** 2026-07-19
**Status:** Approved design (pre-implementation); amended 2026-07-19 with editable
representations (§7) + language tooling (§8).
**Name:** **Redextape** (`redex` + `tape` → "red tape") — primary. Alternates kept in
contention: **Turnstile** (Turing + the ⊢ judgment symbol + a step-through gate),
**Betamax** (β-reduction + a tape format; cheeky, trademarked). Repo:
`~/projects/redextape` (remote `git.daveynet.xyz/davey/redextape`).
Tagline: *"watch the Church–Turing thesis happen."*

## 1. Overview

A tool that transpiles a small "regular-feeling" programming language into **two**
target representations — a **Turing machine** and a **lambda-calculus term** — and lets
the user **watch the same program execute** in both models, with the source, the lambda
reduction, and the Turing-machine tape/state linked together.

The targets are the *destination artifacts*: execution happens *in* the TM simulator and
the lambda reducer (real interpreters), so the visualization shows the genuine
computation, not a native run with a decorative overlay.

The three representations (source, lambda, TM) are **first-class, editable, human-readable
languages** — not read-only outputs. Each has a concrete text syntax, a parser, a printer,
and an interpreter, so any of them can be authored and run directly (§7). Shared tooling
(formatter, linter, LSP) sits over all of them (§8).

## 2. Priorities

In order:

1. **Legibility** — someone can watch a familiar program become a TM and a lambda term
   and actually follow the computation. This is the north star; other choices bend to it.
2. **Breadth / correctness** — a genuinely capable transpiler over a real (if small)
   language, provably faithful (three-way oracle testing).
3. **Tech-demo wow** — a shareable, self-contained artifact.

Personal-learning value is a throughline (building it teaches TMs, lambda calculus,
and compilation) but is not a separate deliverable.

## 3. Source language (the "mini-language")

A small **expression-oriented, hybrid imperative/functional** language with a
"mini-Rust / mini-ML" feel. The hybrid nature is deliberate and pedagogical: imperative
constructs shine in the TM view, functional constructs shine in the lambda view, and the
same computation can often be written both ways.

### 3.1 Feel

```rust
fn count_down(n) {
    let mut acc = 0;
    while n > 0 { acc = acc + 1; n = n - 1; }   // imperative view -> shines in TM
    acc
}

let add1 = |x| x + 1;                            // closure -> defunctionalized for TM
[3, 1, 2].map(add1).fold(0, add)                 // UFCS chaining; shines in lambda
```

### 3.2 Types (v1 — four, kept tiny on purpose)

1. `Nat` — non-negative integers
2. `Bool`
3. `List` — cons-lists (needed so `map`/`fold` closure demos are real)
4. Functions — named + closures

### 3.3 Features (v1)

1. `let` / `let mut`, assignment
2. `if/else` and blocks as expressions
3. `while` loops **and** recursion
4. First-class functions + closures (flattened for the TM via defunctionalization)
5. `map` / `fold` written **in** the language (library, not built-ins)
6. **UFCS method chaining** — `recv.m(args)` desugars to `m(recv, args)`

### 3.4 Semantic decisions

- **`Nat` with truncated subtraction (monus):** `3 - 5 == 0`. Keeps both encodings clean
  and legible (Church numerals in lambda; unary/binary on tape) with no negative-number
  machinery. Signed integers are a v2 upgrade.
- **UFCS, not OOP dispatch:** method syntax is pure sugar for free-function calls with the
  receiver as the first argument. No `self`, structs, vtables, or dynamic dispatch — those
  would be a large lift and would fight legibility.

### 3.5 Explicitly out of v1 (deferred)

Signed ints, strings, floats, structs/records, generics, pattern matching, real I/O.

## 4. Architecture (the spine)

All compilation lives in the Rust core (compiled to WASM; also a native CLI). Each editable
language (source, lambda, TM, and the register assembly) has **both a printer and a parser**,
and they share one **analysis layer** (diagnostics, symbols, semantic tokens) that the
tooling in §8 consumes.

```
Parse + typecheck ─► AST
                       │
                   Desugar ─► Core AST         (minimal core; sugar reduced)
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
   Lambda backend                 TM backend
   (Core AST -> lambda-term       (Core AST -> register "assembly"
    directly, functional-native)   -> multi-tape Turing machine)
        │                              │
        ▼                              ▼
   Lambda reducer                 TM simulator
   (normal-order,                 (tracks state / head / tapes)
    tracks redex)
        │                              │
        └──────────────┬───────────────┘
                       ▼
              Synchronized UI (highlights by Core-AST node id)
```

### 4.1 The divergence principle

The lambda path and the TM path **diverge on purpose** and meet only at the **Core AST**,
which is the synchronization anchor. Everything below the anchor is a target-specific
internal lowering:

- The **lambda backend reads the Core AST directly** — no shared low-level imperative IR —
  so the lambda output stays in its most natural, elegant form.
- The **TM backend goes through a register-machine "assembly"** — the textbook-legible
  path to a Turing machine.

This is the key decision that keeps *both* outputs legible. Forcing both targets through a
single shared imperative IR would be fine for the TM (a TM basically *is* a register
machine) but would tax the lambda term with mechanical store-passing plumbing.

## 5. Backends

Each backend's **printer** (Core → text) is paired with a **parser** (text → the language's
own AST) so the produced language is also directly authorable (§7). Printer and parser must
round-trip (see §10).

### 5.1 Lambda backend (Core AST → lambda-term, directly)

- `Nat` → **Church numerals**
- `Bool` / `List` → **Scott encoding** (makes `if` and list `match` clean)
- Closures → **native lambda-abstractions** (no defunctionalization needed — lambda has
  first-class functions natively)
- Recursion → **`fix` / Y combinator**
- `let mut` + `while` → **store-passing** (state threaded as an argument)
- Reducer: **normal-order** (leftmost-outermost) — always finds a normal form if one
  exists; the right default for watching reduction.

Note: an imperative-style program yields a less-elegant (store-passing) lambda term
*inherently* — that is a property of representing imperative code in lambda at all, not a
cost of synchronization. Functional-style programs yield direct, elegant lambda terms.
This contrast is itself pedagogically valuable ("this is why functional code is
lambda-native").

### 5.2 TM backend (Core AST → register assembly → multi-tape TM)

- **Register "assembly"** — a tiny instruction set: `load / store / add / sub / jz / jmp /
  call / ret / apply`; registers and a call stack live on tapes.
- **Multi-tape** Turing machine (e.g. register tape, work tape, stack tape) — far more
  legible than single-tape.
- `Nat` on tape → **binary by default**, with a **unary display toggle** for small numbers
  (iconic "watch the 1s").
- `let mut` → tape cells; `while` → a state loop.

### 5.3 Defunctionalization (TM-only pass)

Closures cannot be first-class on a tape, so the TM backend **defunctionalizes** them: a
closure becomes a **tag** (small integer) plus its **captured environment** stored on a
tape, and `apply` becomes a **jump table** keyed on the tag. This is highly watchable
(`Closure#3 env[x=5]`). Defunctionalization lives *inside the TM backend*, below the sync
anchor — the lambda backend never sees it.

### 5.4 Source maps (the sync anchor)

Both backends emit **source maps keyed to Core-AST node ids**:

- `node → lambda-subterm span`
- `node → TM state-block`

Compilation is **syntax-directed / compositional**, so these maps fall out for free —
each source subtree compiles to its own lambda subterm and its own TM gadget. Synchronized
highlighting operates at this Core-node granularity ("this source construct ↔ this lambda
subterm ↔ this TM block"). Sub-steps below a construct (individual beta-reductions, tape
moves) are drill-into-able, not part of top-level sync. These same maps also carry
**provenance** for the bidirectional-editing research track (§7.3).

## 6. Execution + UI

### 6.1 Layout (web)

```
┌─ Source ────────────┐  ┌─ Lambda ─────────────┐
│ fn count_down(n){   │  │ (λn. ... ) applied    │
│   while n>0 {..}    │  │ current redex ►hi◄     │
│ }        ◄line hi►  │  │ [◀ ▶ ⏵ speed] step 812 │
├─ Turing machine ────┴──┴───────────────────────┤
│ state q7  head▼                                │
│ tape … 1 0 1 [1] 0 1 …    state diagram/table  │
│ [◀ ▶ ⏵ speed] step 3,104   [binary|unary]      │
└────────────────────────────────────────────────┘
```

Every pane is a real editor (§7), not a read-only view.

### 6.2 Linking — always on, build first

1. **Click a source construct** → highlights its lambda-subterm span and its TM state-block.
   No execution required.
2. **Dual focus highlight** while running — each interpreter reports the Core-node it is
   currently working on, so the source shows both "lambda is here" and "TM is there" at once.

### 6.3 Synchronized stepping — the magic, phased

- A **reference tree-walker** over the Core AST defines canonical evaluation order and acts
  as the **logical clock**.
- **One logical step = one source construct.** Both views fast-forward their own
  fine-grained steps to the point that completes that construct, then highlight together.
- **Known hard part:** normal-order lambda reduction can visit constructs in a different
  order than strict evaluation, so "fast-forward lambda to construct X" is not always
  well-defined. This is why synchronized stepping is deferred to **v1.5**; v1 ships the two
  always-on links (6.2) which are coherent and cheap.

### 6.4 Execution safety (both targets can blow up)

1. Per-run **step cap** and **tape/term-size cap**.
2. On cap hit: pause, show `still running — hit 50k steps`, offer "continue".

## 7. Editable representations & propagation

The source, lambda, and TM panes are **peer editable languages**. Each needs, beyond the
printer already required for the view, a **parser** into its own AST and an interpreter.
The text forms are designed to be **human-readable** (named TM states, readable lambda with
named-or-de-Bruijn display, comments where the grammar allows) — authorable, not machine
dumps.

### 7.1 Editing model — independent + detach (v1)

- **Forward compile:** source → lambda + TM (the §4 pipeline).
- **Independent editing + run:** edit the lambda or TM text, parse it, and run it on its own
  interpreter (lambda reducer / TM simulator) — a standalone scratchpad for each language.
- **Detach semantics:** hand-editing a *derived* pane marks it **detached from source**
  (diverged). A detached pane runs standalone; "recompile from source" discards the edits
  and re-links. The UI shows detachment clearly so the user always knows which panes are
  still in sync with the source.

### 7.2 Round-trip requirement

Printer and parser for each language must round-trip: `parse(print(x))` is equal to `x`, and
`print(parse(t))` is stable (idempotent). The formatter (§8) is exactly `print ∘ parse`.

### 7.3 Bidirectional editing — a planned research track (NOT a v1 promise)

The dream is "edit the lambda or TM, and the source updates." In general this is
**decompilation** and infeasible: an arbitrary lambda term or Turing machine corresponds to
*no* mini-language program. The research track investigates where it *is* tractable and
delivers a **report + prototype on the feasible subset**, not a guarantee:

1. **Round-trippable subset** — compiler-produced artifacts carry provenance via the source
   maps (§5.4); a *local* edit that stays within a construct's image may be liftable back.
2. **Bidirectional lenses / a constrained edit vocabulary** — offer a fixed set of edits
   known to have a well-defined back-propagation, rather than free-form text edits.
3. **Lambda ↔ TM sync** — keeping the two *derived* views consistent with each other may be
   more tractable than lifting either back to source; explored as a fallback win.

## 8. Language tooling (formatter / linter / LSP)

**One analysis core, many frontends** (the rust-analyzer model). A single Rust analysis
layer over each editable language exposes parse trees, resolved symbols, spanned
diagnostics, and semantic tokens. Three frontends consume it:

- **Web (WASM):** in-browser editor features (diagnostics, formatting, hover, completion)
  driving the CodeMirror/Monaco panes.
- **Native `redextape-lsp` binary:** an LSP server for **nvim** + VS Code, reusing the same
  core.
- **CLI:** `redextape fmt` and `redextape lint`.

Phasing of the tooling itself:

- **Formatter — early.** It is the canonical printer (`print ∘ parse`, §7.2); ships with the
  parsers.
- **Linter — phased.** Per-language rule sets:
  - *mini-lang:* unbound / unused variables, shadowing, dead code, obvious non-termination.
  - *lambda:* free variables, unused bindings, non-normalizing warnings.
  - *TM:* unreachable states, non-total or nondeterministic transitions, dead states.
- **LSP — phased.** Diagnostics, hover, go-to-def, completion, rename, semantic
  highlighting. Prioritize the mini-language (most authored), then lambda / TM.

Design-for-it-now: the analysis core's diagnostics + symbol + semantic-token outputs are
baked into v1 (parse-error diagnostics surface inline from day 1), so formatter, linter, and
LSP are *frontends over the core*, not rewrites — the same philosophy as the renderer split
(§9).

## 9. Extensibility (baked into v1 so richer graphics AND tooling are frontend swaps, not rewrites)

Later work — richer graphical views (**TM tape + flow/state diagram**, **Tromp diagrams**)
and the tooling of §8 — must be viable with no architectural change, because they are
*frontends over data the core already produces*.

Requirements locked into v1 to guarantee this:

1. **Model/renderer split.** The WASM core exposes structured, serde-serializable **view
   models**; renderers are pure `viewModel → pixels`.
   - `LambdaState { term_ast, redex_path, step, source_node }`
   - `TmState { machine (states + transitions + alphabet), current_state, head, tapes, source_node }`
2. **Explicit lambda binders (de Bruijn) from day 1** — Tromp diagrams are a pure function
   of the lambda-term AST with binding structure; keeping binders explicit is cheap now and
   expensive to retrofit. This is the one "do it now or regret it" item.
3. **Step-trace event stream** — the core emits a trace of steps (not just final state) so
   any renderer can scrub/animate.
4. **Analysis-core outputs** — parse trees, spanned diagnostics, resolved symbols, and
   semantic tokens are first-class core outputs, so the formatter, linter, and LSP (§8) are
   frontends over the core rather than rewrites.

Future frontends consume the **same** core outputs:

- **TM flow/state diagram** — the transition table drawn as a node-link graph with the
  current state lit (alongside the tape strip). Same data as the v1 table view.
- **Tromp diagrams** — the lambda-term AST rendered in Tromp notation; animated
  beta-reduction re-renders after each step.
- **Formatter / linter / LSP** — over the analysis-core outputs (§8).

No core change is required for any of these upgrades.

## 10. Testing (correctness is priority #2 — this is the backbone)

1. **Three-way oracle test** (the primary guarantee): for every program,
   `reference tree-walker result == decoded lambda normal form == decoded TM final tape`.
   All three implementations must agree.
2. **Property-based** (proptest): generate random valid programs, run the three-way check.
3. **Encoding round-trips:** `Nat/Bool/List` ↔ Church/Scott ↔ tape encodings.
4. **Source-map coverage:** every Core node maps to a non-empty lambda span, and every node *of a kind
   that emits code* maps to a non-empty TM block. **Corrected 2026-07-30 — as originally written this
   said every node maps to both, and that is false of the shipped `lower_asm`:** `Lambda`, `Seq`, a
   `Let` whose value is not a `Lambda`, and an `Apply`'s callee `Var` emit no instructions at all, so
   they map to `None`. The map says nothing where the lowering said nothing; a companion test names the
   instruction-free kinds and asserts they are `None`, so the discovery is a regression guard rather
   than an erasure. Full reasoning in
   [`2026-07-30-plan4-sourcemap-trace-and-tokens-design.md`](2026-07-30-plan4-sourcemap-trace-and-tokens-design.md) §1.
5. **Golden tests:** sample programs → expected lambda term and TM step count.
6. **Per-pass unit tests:** parse, desugar, each lowering.
7. **Print ↔ parse round-trips** (§7.2): for each editable language, `parse(print(x)) == x`
   and `print(parse(t))` idempotent.
8. **Detach semantics:** editing a derived pane flags detachment; a standalone run of an
   edited lambda/TM matches its own interpreter.

## 11. Phasing

- **v1 (MVP):** mini-language (nats, bool, list, closures, UFCS chaining) · both backends ·
  real lambda reducer + multi-tape TM simulator · **every pane readable, editable, and
  runnable** (parser + printer + interpreter per language) with **detach-on-edit** and inline
  **parse-error diagnostics** · **formatter** · web UI with text/table/tape renderers ·
  static click-linking + dual-focus highlight · step/size caps · native CLI.
- **v1.5:** reference-clock **synchronized stepping** ("step both to next source construct").
- **v2:** **graphical renderers** — TM flow/state diagram + Tromp diagrams · **linter** rule
  sets · **`redextape-lsp`** (nvim / VS Code) · optional visible assembly pane · single-tape
  TM view (multi→single simulation) · signed integers.
- **Research track (parallel, ongoing):** bidirectional-editing feasibility (§7.3) — lenses /
  round-trippable subset / lambda↔TM sync; deliverable is a report + prototype, not a
  guaranteed feature.

## 12. Tech stack

- **Core (Rust):** lexer/parser for the mini-language; **parsers + printers** for the lambda,
  TM, and register-assembly text forms; typechecker, desugar, both backends, reference
  interpreter, lambda reducer, TM simulator; **analysis layer** (diagnostics, symbols,
  semantic tokens); **formatter**; view-model serialization.
- **WASM:** core compiled to WebAssembly, exposed to the web UI.
- **Web UI:** thin layer (React/Canvas/SVG) with pluggable renderers and a real code-editor
  component (CodeMirror 6 or Monaco) for the editable panes; runs client-side, shareable by
  URL, deployable as a static site.
- **LSP:** `redextape-lsp` native binary (e.g. `tower-lsp`) reusing the core, for nvim +
  VS Code.
- **CLI:** native binary reusing the same core (`redextape fmt` / `lint`, emit + run
  lambda/TM artifacts).

## 13. Risks / open questions

1. **Synchronized-stepping order mismatch** (6.3) — the main technical risk; contained by
   deferring to v1.5 and shipping coherent always-on links in v1.
2. **TM legibility at scale** — even small programs produce large TMs. Mitigations: small
   language, `Nat` monus, binary tape, multi-tape, step caps, source-construct granularity.
   Programs for the flagship demos should be chosen to stay watchable.
3. **Defunctionalization complexity** — the biggest single implementation cost on the TM
   side; may itself be phased (first-order core first, closures second) during
   implementation planning.
4. **Bidirectional editing is decompilation** (§7.3) — generally infeasible; scoped as a
   research track with a report deliverable, not a v1 feature. The UI must not over-promise
   it (detach semantics keep expectations honest).
5. **Tooling scope creep** — a formatter, linter, and LSP across three-to-four languages is
   large. Mitigated by the shared analysis core (§8) and strict phasing (formatter first,
   LSP later; mini-language before lambda/TM).
6. **Project name** — **Redextape** chosen as primary; **Turnstile** and **Betamax**
   kept as alternates. Canonical repo is now `~/projects/redextape`; the earlier
   `/home/davey/temp/tm-lambda-viz/` scratch copy is superseded.
