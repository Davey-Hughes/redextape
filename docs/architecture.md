# Status and architecture

## Status

**The compiler is built, and the thing you watch it run in now has three panes.** The front end
and three backends — λ, Turing machine, and native — all work, and each is checked against the others
on every commit. `crates/redextape-wasm` compiles the compiler to WASM through **ten exports** — the
tenth, `tapeNames()`, labels the five Turing-machine tape rows from the lowering's own constants
(`build.rs`) rather than a hand-copied list, so it can only speak for machines this compiler produced.
`web/` is a real app: a source pane with lint diagnostics and syntax highlighting driven by a committed
tree-sitter grammar — the same colourer the λ, TM and rxm copy editors take, whose grammar loads
asynchronously so only the first paint waits on it, while every reparse and rebuild after that runs
inside the same `ViewUpdate` as the keystroke that triggered it — a λ pane, and a
Turing-machine pane showing all five tapes, a status line, and — Plan 5a-ii — a virtualized δ-table
beside them: current state and the rule about to fire highlighted, following the machine by default and
a control to reattach it after a manual scroll detaches it, toggleable, and tested rendering only a
viewport's worth of rows — 24 of `map_fold`'s 25,852 at CI's window size, counting the overscan —
side by side, the first thing in this project a human can click. **All three legs — λ, Turing machine and
rxm — are steppable forward and backward** through a recorded, byte-budgeted history (◀ ▶ ⏵ ↺), with a caps
affordance (`[continue]`) for a run that outgrows its recording budget before it outgrows its answer.
**The λ pane has no structural tree, and that is a decision, not a gap**: Plan 5a-ii measured one and cut
it — a per-frame tree costs 850 MB against a 32 MB history ring, and most steps have no tree to draw at
any budget that is still affordable
(`docs/superpowers/specs/2026-08-08-plan5a-ii-state-table-design.md` §2). What the visualizer the
project is *for* still lacks: click-linking between the panes, dual-focus highlight while running,
editable λ/TM panes with detach-on-edit, and the λ pane's structural tree (deliberately, see above).
See [Development](development.md) to build and run it, or still `cargo run --example` for the raw backends
without a browser.

Design spec:
[`docs/superpowers/specs/2026-07-19-tm-lambda-visualizer-design.md`](superpowers/specs/2026-07-19-tm-lambda-visualizer-design.md).
The plan sequence, and the running log of what implementation falsified:
[`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`](superpowers/plans/2026-07-19-redextape-roadmap.md).

## Architecture

Ten crates under `crates/`.

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
- **TM backend** (`src/tm/`) — Core → rxm, a register-machine IR → a genuine multi-tape Turing machine,
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

**`redextape-cli`** is the `redextape` command — `fmt`, `lint`, `run` and `emit`.
**`redextape-wasm`** is the browser boundary the visualizer loads. **`redextape-grammar-check`**
holds the tree-sitter differential that checks each editor grammar against the front end span for
span. **These three went undescribed here while the count above still read "Four"**, which is the
same defect [Checks](development.md#checks) documents for test counts: a total and an enumeration that drift
apart, where either alone looks right.

**`redextape-lsp`** is the eighth, and the count above already included it before this paragraph
did — the same drift named just above, one crate later. It is a stdio language server — diagnostics
and formatting for all four text forms (`.rxt`, `.rxlambda`, `.tm`, `.rxm`), navigation for three
of them (`.tm`, `.rxm` and `.rxt`), served over the Language
Server Protocol to Neovim from the same `redextape-core` front ends the CLI and the web UI already
call. `lsp-server` (the transport) is confined to its `main.rs`; every other file in the crate is a
pure function of one client message to the messages that go back, which is what holds the crate to
the workspace's coverage floor and is checked mechanically —
`git grep -l lsp_server crates/redextape-lsp/src` names exactly that one file. Build it with
`cargo build --release -p redextape-lsp`; `plugin/redextape.lua` finds the binary there (or on
`PATH`) and registers it with `vim.lsp.enable` automatically, so a lazy.nvim spec of
`{ "Davey-Hughes/redextape", lazy = false }` needs no change to pick it up — no binary just means no
diagnostics or formatting, with a warning naming both remedies, and highlighting is unaffected
either way. For `conform.nvim` users who route formatting through it rather than
`vim.lsp.buf.format()` directly, `formatters_by_ft` is keyed by FILETYPE and this server serves four
of them, so opting in takes four entries rather than one — `redextape`, `redextape_rxm`,
`redextape_lambda` and `redextape_tm`, each `{ lsp_format = "fallback" }`, or conform's `["_"]`
catch-all. Not required either way.

**`redextape-lsp-wasm`** is the ninth, and it is named here in the same commit that moved the count
above — the drift this section documents twice already, not repeated a third time. It is the
`#[wasm_bindgen]` surface that lets the browser run the same server Neovim talks to: one exported
type, `LspServer`, whose `handle` takes one JSON-RPC message and returns the messages that go back as
a JSON array. It adds no behaviour to `redextape-lsp` at all — the split that crate's module doc
argues for is what made this possible, and the whole crate is marshalling. Unlike `redextape-wire` it
generates no TypeScript: LSP's types come from Microsoft's `MetaModel` via `gen-lsp-types`, so a
generated copy would describe a shape this project does not own, and the web client hand-writes the
handful of messages it actually sends instead.

**`redextape-wire`** is the tenth: the statuses and values `redextape-wasm` answers with beyond core's
types, with the TypeScript generated from them, the helpers that build them and the one serializer
they cross by, in a crate of their own so that a second wasm module shares them rather than copying
them.

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
  through a recorded history with a caps affordance for a run that exceeds it. Click-linking between
  the panes (Plan 5b, 2026-08-09), dual-focus highlight while running (Plan 5c plus region-path
  tagging, 2026-08-10), and editable λ / TM panes with detach-on-edit and recompile-from-source
  (through Plan 5d-iv, 2026-08-18) have all since shipped — an earlier version of this bullet still
  listed the three as missing after each had landed. What is left is Plan 5's own accessibility pass:
  deliberately deferred to one pass once the pane set stopped changing shape, and unblocked but not yet
  run now that 5d-iv has landed. **The λ pane's structural tree is a deliberate cut, not part of that
  remaining work** — Plan 5a-ii measured it and cut it rather than leaving it unscheduled: a per-frame
  tree costs 850 MB against `HISTORY_BYTES`' 32 MB ring, and most steps have no tree to draw at any
  budget that is still affordable
  (`docs/superpowers/specs/2026-08-08-plan5a-ii-state-table-design.md` §2).
- **LSP** — `crates/redextape-lsp` now serves diagnostics and formatting for all four text forms,
  plus **go-to-definition, find-references and document symbols for `.tm`, `.rxm` and `.rxt`**
  (Architecture, above); `.rxt`'s names are scoped, so its pass resolves against a binder rather
  than the flat lookup the other two share, and it landed in `binder`, not `analysis`. Still not
  built: navigation for `.rxlambda`, whose de Bruijn terms carry no source positions at all; hover;
  rename; and semantic tokens — the four tree-sitter
  grammars already highlight all four forms in Neovim, so tokens are not needed for that editor and
  stay deliberately out of this slice.

`crates/redextape-cli` is no longer on this list. All four subcommands work — `redextape fmt` /
`redextape lint` (Roadmap Plan 6's first half, 2026-08-19), `redextape run` / `emit` (Plan 6's second
half, 2026-08-23), and a reader for the register-machine listing (2026-08-25; `parse_rxm` since the IR
was renamed rxm) rounding out `emit`'s three text forms so all of them round-trip — and a
`redextape.toml` for four settings plus `--deny-warnings` close Plan 6's remaining two knobs; see that
crate's own README for the schema, discovery and precedence. `.rxlambda` is the one emitted form
`redextape run` still does not take — a bare λ term carries no result type to decode against.
`redextape fmt` has since grown the same two forms `run` already read — `.tm` and `.rxm` alongside
`.rxt` (Roadmap `cli-fmt-tm-asm`, 2026-09-05, from when rxm was called asm) — chosen by extension, by
`--form` where a caller needs to override it, or for stdin by asking the parsers themselves rather
than a pattern. `--width` stays a line budget the `.rxt` printer alone reads; an explicit `--width` on
a `.tm` or `.rxm` input is refused rather than silently ignored.

The CLI and the web visualizer are both usable today. The examples below remain the most direct way to
drive the raw backends, with no binary or browser involved:

    cargo run --example lambda_demo -p redextape-core     # compile to λ, reduce it step by step
    cargo run --example tm_demo     -p redextape-core     # compile to a TM, simulate, decode
    cargo run --example tm_emit     -p redextape-core     # write a self-describing .tm, run one back
    cargo run --example native_demo -p redextape-native   # compile to host machine code and run it
