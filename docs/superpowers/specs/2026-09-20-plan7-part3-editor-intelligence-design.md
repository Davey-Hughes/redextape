# Plan 7, part 3 — Editor intelligence: the LSP in the browser, colouring, hover, vim — design

Part 3 of [Plan 7](2026-09-17-frontend-overhaul-design.md). It brings `redextape-lsp` to the browser and
gives all four languages colour: diagnostics in every editor, format, outline, definition, references,
hover, web-tree-sitter highlighting, and a vim keymap.

It answers all five questions the umbrella's §6 left for this part, and **four of the five were measured
rather than decided** — §14 gives the command behind every figure. The measurements changed two answers
the umbrella guessed at and added one constraint it did not anticipate (§6.2).

Code facts below were read at `bc592b6` (#102, part 2b's squash merge).

## §1 Scope, and the two PRs

One design, two PRs, each with its own plan and roadmap entry. 3a is designed knowing what 3b needs, so
no shape it ships has to change for 3b.

**3a — the LSP in the browser.** In: the `redextape-lsp-wasm` crate and its build (§3.1); the LSP worker
and its client (§3.2, §3.3); documents, language ids and positions (§4); and the five features the server
already serves today — diagnostics in every editor, format with opt-in format-on-blur, the outline panel,
definition and references (§5). The `analyze`-based lint path is deleted in the same change.

**3b — colour, hover and vim.** In: web-tree-sitter over the four committed grammar `.wasm` (§6); the
grammar artefacts and their drift gate (§7); hover in the server and the client (§8); the vim keymap
compartment (§9). `classify_source`'s decoration path is deleted in the same change.

**The split is "served today" against "new work".** Every feature in 3a was proven to run in wasm
unmodified before this spec was written (§2.3), so 3a carries no new Rust behaviour at all. Every
feature in 3b is either new Rust (hover) or a new dependency (web-tree-sitter, `@replit/codemirror-vim`).

**Out, and where it goes:** the λ layout, folding and term map, and the TM rule table and state diagram,
which decide what those views *draw* (part 4); asm stepping and the registers panel (part 5); a
per-token colour editor, which the umbrella's §2 row 4 declined outright; base16 palette import
(part 6); semantic tokens from the server, which the roadmap's tree-sitter entry rules out on the record
and this part does not reopen.

## §2 What exists

### §2.1 The server

`redextape-lsp` is already split so that its pure half has no transport. `Server::handle` takes one
`RequestObject` and returns `Vec<Outgoing>`, and the crate's own module doc states that keeping
`lsp-server`'s threads and channels in `main.rs` is what "keeps the web phase possible at no cost to
this slice". This part is that web phase, and it takes the crate up on it.

It serves four languages, selected by **`languageId`, not by URI extension** — `Language::from_language_id`
maps `redextape`, `redextape_lambda`, `redextape_tm`, `redextape_asm`, and answers `None` for anything
else, after which every language-specific request returns empty. Each language's diagnostics come
straight from the front end the CLI and the web app already use; for the mini-language
`Language::diagnostics` is literally `redextape_core::analyze(src).diagnostics`, and `language.rs` holds
a test asserting that equality.

`initialize` advertises `definitionProvider`, `documentFormattingProvider`, `documentSymbolProvider`,
`referencesProvider`, `positionEncoding: utf-16` and `textDocumentSync: 1` (Full). Diagnostics are
pushed through `publishDiagnostics`, which needs no capability entry. There is no `hoverProvider` — §8
adds one. There are deliberately no semantic tokens.

### §2.2 The editors

Each editable view mounts a CodeMirror 6 editor built in `scratch-editor.ts`, whose extension list is
`defaultKeymap`, `historyKeymap`, `history`, `lintGutter` and an update listener.

Two language services run **synchronously, on the main thread**, and both are deliberate:

- `highlight.ts` renders CodeMirror *decorations* over `classify_source`'s byte spans. Its doc records
  that a Lezer grammar was considered and declined as redundant, and that the roadmap's tree-sitter
  entry does not forbid it.
- `lint.ts` feeds `@codemirror/lint` from `analyze`, at `delay: 100` rather than the library's 750 ms
  default, so a marker lands before `compile.ts`'s 300 ms debounce paints "not compiled".

`session-worker.ts` states the reason neither is in a worker: "`classifySource` and `analyze` are NOT
here: they are free functions, they are what the editor calls on every keystroke, and a round trip per
keystroke is exactly the lag this split exists to avoid."

**§6.1 and §5.1 reverse both of those decisions, and the reversal is measured, not asserted.** The
reasoning above is about the *session* worker, which owns a `Session` handle and is busy running
reductions. The LSP worker owns a `Server` and is idle between keystrokes, and the grammar-driven
colourer is a different mechanism from the one `highlight.ts` weighed. Neither reversal rests on that
distinction alone — §5.1 and §6.2 each carry the measurement.

### §2.3 What was proven before this spec was written

A throwaway `cdylib` wrapping `redextape_lsp::Server`, built with `wasm-pack --target nodejs` and driven
from Node, answered every one of 3a's features correctly **with no change to `redextape-lsp`**:
`initialize` returned the capability set above; `didOpen` on a clean program returned zero diagnostics
and on `let x = ;` returned `expected an expression` at the right range; `formatting` returned real
reformatted text; `documentSymbol` returned `fact`; `definition` and `references` returned correct
ranges, three references among them. Broken input in each of the four languages returned exactly one
diagnostic each — `expected an expression`, ``expected `)` ``, ``duplicate `tapes` line``, `` `` is not
a register``.

So 3a's risk is not whether the server works in wasm. It is the worker, the client and the deletions.

## §3 The LSP in the browser

### §3.1 `crates/redextape-lsp-wasm`

A new crate, `cdylib` + `rlib`, mirroring `redextape-wasm`'s shape: **marshalling only**, with no
decision in it. It exports one type.

```rust
#[wasm_bindgen]
pub struct LspServer(redextape_lsp::Server);

#[wasm_bindgen]
impl LspServer {
    #[wasm_bindgen(constructor)] pub fn new() -> Self;
    /// One client message as JSON in, the server's messages as a JSON array out.
    pub fn handle(&mut self, msg: &str) -> String;
}
```

**JSON strings across the boundary, not `serde-wasm-bindgen` and not `ts-rs`.** This is the one place
the project's wire-type convention does not apply, and the reason is ownership: LSP's types are defined
by Microsoft's MetaModel and generated into `gen-lsp-types`, so generating a TypeScript copy from our
Rust declarations would be generating a second description of a shape we do not own. The client instead
hand-writes the narrow subset of LSP it actually sends and receives — the handful of message types this
part uses, not the protocol — and `handle`'s contract is a JSON string in and a JSON array out, which is
what JSON-RPC already is.

`rlib` alongside `cdylib` for the same reason `redextape-wasm` gives: so `cargo test` and `cargo
llvm-cov` can reach the crate natively rather than only in a browser.

**Two artefacts, not one, and the cost is stated at the profile the tree actually builds with.**

| | raw | gzipped |
|---|---|---|
| `pkg/redextape_wasm_bg.wasm`, as the tree builds it | 776,988 | 271,498 |
| `pkg-lsp/redextape_lsp_wasm_bg.wasm`, the same way | 825,451 | 283,076 |
| **two artefacts, together** | | **554,574** |

The workspace sets no `[profile.release]`, so both are plain `wasm-pack --release` after `wasm-opt`.
**Under a profile with `opt-level = "s"` and `lto = true` the same three builds measure 196,241 /
211,063 gzipped, and both surfaces in one crate measure 339,337** — so combining would save 67,967
against the two-artefact sum *at that profile*. Two is chosen anyway: the boundaries stay independent —
separate wire types, separate `ts-rs` generation, separate coverage stories — and `redextape-wasm`'s
`lib.rs` stays the marshalling-only surface its own doc insists on rather than growing a second protocol
beside the session one. The LSP artefact can also be fetched when an editor first opens rather than at
startup.

**The 68 KB figure and the 554,574 figure are not comparable, and the difference is the profile, not the
layout.** The saving was measured at `opt-level = "s"` + `lto`; the shipping sizes are at cargo's release
defaults. The same profile change would take the session artefact alone from 271,498 to 196,241 — about
75 KB gzipped for a four-line manifest edit, on a crate part 3 does not otherwise touch. **That is a
separate finding and part 3 does not act on it**, because a profile change alters every wasm build in
the tree and belongs in a change whose reviewers are looking at exactly that.

Built by a new `build:lsp-wasm` script into `pkg-lsp/`, beside `pkg/`, and added to `.gitignore` the
same way. `check-all.sh` gains a wasm32 leg for the new crate, matching the one `redextape-core`
already has.

### §3.2 `web/src/lsp-worker.ts`

Owns the `LspServer` handle. **The handle cannot leave this thread** — the same rule `session-worker.ts`
states for `Session`, and for the same reason: it is an opaque wasm-bindgen object with no serialized
form.

It is a thin loop: receive a message, call `handle`, post back whatever comes out. All policy — which
document is open, when to format, what to do with a dead worker — lives in the client, for the reason
`session-worker.ts` records about itself: **logic put in a worker is invisible to the coverage gate**,
because `vite.config.ts` excludes worker modules from `coverage.include` for a measured instrumentation
reason. This worker gets the same exclusion and the same discipline.

### §3.3 `web/src/lsp-client.ts`

The main-thread half, and where every decision lives.

- **Request correlation.** Monotonic integer ids; a map from id to its pending promise. A response
  with an unknown id is dropped with a console warning rather than thrown, because a restarted worker
  can answer a request the previous instance was sent.
- **Notification dispatch.** `publishDiagnostics` is the only server-to-client notification today; it
  routes by URI to the view holding that document.
- **Lifecycle.** `initialize` on first open, `initialized`, then documents. On worker death: restart
  once, replay `initialize` and every open document, and re-request nothing — diagnostics arrive on
  their own from the replayed `didOpen`. A second death leaves language features off with one notice
  (§10), per the umbrella's §7.

## §4 Documents, languages and positions

**One editor is one document**, as the umbrella's §5 says. A view's editor opens a document when it
mounts and closes it when the view closes or the editor moves.

**URIs are synthetic and per-view**: `redextape:///view/<viewId>.<ext>`, with the extension matching the
language. They are never fetched and never parsed — the server keys documents by URI string and never
parses one, which is exactly why `gen-lsp-types` is taken with default features and `Uri` is a newtype
over `String`. A per-view URI rather than a per-language one is what lets two views on the same language
hold different text, which copies make routine.

**`languageId` is what selects the front end**, and the four values are `redextape`,
`redextape_lambda`, `redextape_tm`, `redextape_asm`. This is the part's sharpest footgun: a wrong or
absent id is not an error, it is silence — `from_language_id` returns `None`, every request returns
empty, and the editor shows no diagnostics while looking exactly like a clean file. It cost this
design's own probe a full round of wrong measurements (§14). **A node test asserts the four ids the
client sends are the four the server matches**, so the two cannot drift apart silently.

**Positions are UTF-16 line/character**, which the server negotiates at `initialize` and which is what
CodeMirror already uses. This deletes work rather than adding it: `diagnostics.ts`'s byte-offset
conversion, its zero-width widening and its surrogate-pair clamp all exist because `analyze` returns
Rust byte offsets, and none of it is needed for LSP ranges. The module shrinks to whatever `link.ts`
still needs from it.

## §5 The five features served today

### §5.1 Diagnostics in every editor

The LSP worker serves diagnostics through `@codemirror/lint`'s async source. `lint.ts`'s `analyze` path
and `lintFromAnalyze` are deleted.

**The server serves four languages; the app has three editors.** `PaneKind` is `'source' | 'lambda' |
'tm'`, and no asm editor exists until part 5 brings the asm view. So part 3 wires three, and the
server's asm support is served-but-unconsumed until part 5 mounts an editor on it — which is the
cheapest possible shape for part 5 to inherit, since nothing about asm's language support will be left
to do. Every table below that names four languages is describing the server; every one that names three
is describing the app.

The three editors are also three different surfaces today, and the work differs for each:

| Editor | Diagnostics today | After 3a |
|---|---|---|
| source (`main.ts`) | `lintFromAnalyze`, pulled synchronously from `analyze` | pushed from the LSP worker |
| λ copy (`ScratchEditor` via `lambda-pane.ts`) | pushed from the session worker's run reply | pushed from the LSP worker |
| TM copy (`ScratchEditor` via `tm-pane.ts`) | **none** — `tm-pane.ts` never calls `setDiagnostics` | pushed from the LSP worker |

That last row is what the umbrella means by "closes the TM gutter showing none", and it is literal:
`setDiagnostics` has callers in `lambda-pane.ts` and nowhere else.

**This reverses `session-worker.ts`'s recorded reasoning, and the measurement is why.** Time from a
full-document `didChange` to its `publishDiagnostics`, in wasm, five runs each:

| document | per keystroke |
|---|---|
| source, 64 bytes | 0.15 ms |
| λ, 541 bytes | 0.05 ms |
| asm, 439 bytes | 0.06 ms |
| TM, 229,181 bytes | 4.57 ms |
| TM, 814,207 bytes | 14.58 ms |

The transport is not the cost: `structuredClone` of a 6,100,000-byte string is 0.512 ms, so even at the
TM buffer ceiling the message crossing is a rounding error against the analysis. Every figure above is
inside the 100 ms debounce `lint.ts` already imposes, except at the extreme — and the extreme is §5.1.1.

**Nothing regresses for the mini-language**, and that is provable rather than hoped: the server's source
diagnostics *are* `analyze`'s, asserted by a test in `language.rs`. What changes is the thread and the
position units, not the content.

**λ, TM and asm gain diagnostics they never had**, which is what the umbrella means by "closes the TM
gutter showing none". Each produces exactly one diagnostic on the broken fixtures in §2.3.

#### §5.1.1 The ceiling

`MAX_SCRATCH_TM_BYTES` is 6,100,000, and 14.58 ms at 814,207 bytes extrapolates linearly to about
109 ms there — past the debounce, though in a worker, so it lags rather than janks. `textDocumentSync`
is Full, so each keystroke re-analyses the whole document.

**One ceiling covers diagnostics and colouring both** (§6.2), it is a measured byte figure rather than
this extrapolation, and the plan's pre-flight measures it **in a browser**, not in Node as every figure
here was taken. Above it, an editor shows no diagnostics and no colour, with one notice saying so.

### §5.2 Format

`textDocument/formatting`, reached from the `⋯` menu's *format* item — the slot part 2a left for it —
and from an opt-in *format on blur* setting in the settings menu, also already built.

`Language::format` returns `None` when the text does not parse, and the crate's doc is emphatic that
this is the answer rather than an error path: a file that does not parse has nothing to print from.
**That `None` reaches the client as JSON `null`, not as `[]`**, because `formatting` hands an
`Option<Vec<TextEdit>>` straight to `from_success` — a distinction this spec got wrong until a test
in `redextape-lsp-wasm` caught it, and one that matters because a client mapping over the result
would throw on the likeliest buffer there is. `lsp-client.ts` normalises `null` and `[]` to the same
answer, and *format* on an unparseable buffer does nothing
visible. Format-on-blur does nothing visible for the same reason, which is the behaviour that makes it
safe to leave on.

### §5.3 The outline

`textDocument/documentSymbol`, rendered as a `panel.ts` panel in the view — the umbrella's §5 names the
outline as one of the panel primitive's consumers, so this adds a consumer, not a mechanism.

The client sets `hierarchicalDocumentSymbolSupport: true` at `initialize`, which the server already
reads into `hierarchical_symbols` and which is the protocol's precondition for the nested
`DocumentSymbol[]` rather than the flat `SymbolInformation[]`. The panel renders the tree.

`.rxlambda` answers no symbols, by design — the term type carries no source positions. The panel is
*removed* rather than *disabled* for λ views, which is the umbrella's §4 rule 4: removed where it can
never apply.

### §5.4 Definition and references

`textDocument/definition` and `textDocument/references`, both already served over
`redextape_core::nav::NameIndex`.

A result inside the same document scrolls and selects. **A result in another document jumps across
views**: the client finds the view holding that URI, focuses it, and scrolls it. If no view holds it,
the notice line says so rather than opening one — part 3 does not get to create views, and silently
opening one would be a layout change the user did not ask for.

Both are reachable from the keyboard, and the jump announces itself through part 2a's live region,
which is the umbrella's §4 rule 5.

## §6 Colouring

### §6.1 web-tree-sitter over the four grammars

`web-tree-sitter` 0.27.0 loads the four committed grammar `.wasm` and colours **editors** from each
grammar's own `queries/highlights.scm`. `highlight.ts`'s `classify_source` decoration path is deleted.

**Editors, not rendered panes, and the distinction is load-bearing.** There are two colour surfaces in
the app today and only one of them is text:

| Surface | Colour today | After 3b |
|---|---|---|
| source editor | `classify_source` byte spans as CodeMirror decorations | tree-sitter |
| λ copy editor | none — `ScratchEditor`'s doc calls this deliberate | tree-sitter |
| TM copy editor | none, same doc, same reason | tree-sitter |
| λ pane's rendered frame | `frame.spans`, computed by the worker from the term it holds | **unchanged** |
| TM pane's tapes and δ table | its own renderers | **unchanged** |

The λ pane's frame spans are not replaced and must not be. They are computed from a `Term` the worker
owns, so they are authoritative about the reduction in a way that parsing printed text cannot be, and
`ScratchEditor`'s doc already records the converse: a colouring computed from printed output is stale
the instant the user types, which is exactly why the *editors* went uncoloured rather than borrowing
that path. Tree-sitter fills the editors because an editor's text is the one thing no worker holds a
term for. What the panes *draw* is part 4's subject, not part 3's.

**The ABI question is answered by loading a built grammar, which is what the umbrella asked for.** All
four grammars generate ABI 15, and `web-tree-sitter` 0.27.0 loads all four, reports `abiVersion` 15,
and parses real emitted `fact(3)` text in every language with `hasError` false while running each
grammar's committed query. The 0.25.10 CLI pin and the 0.27.0 runtime are compatible, measured.

**Capture names map to part 1's palette tokens.** The queries' vocabulary is already fixed and already
held by a Rust differential (§11.3): `@keyword`, `@boolean`, `@number`, `@comment`, `@operator`,
`@punctuation.bracket`, `@punctuation.delimiter`, `@variable`, `@function`, `@function.call`,
`@variable.parameter`, and λ's, TM's and asm's own. Part 1 made every colour a palette token; this maps
capture name to token and adds no colour of its own, so the colour gate stays satisfied by construction.

### §6.2 Viewport-scoped queries are a requirement, not an optimisation

This is the constraint the umbrella did not anticipate, and it is the reason §6.1 is not a small change.

Running a grammar's highlight query over a whole real TM document:

| TM document | parse | whole-document query | viewport query, 60 lines |
|---|---|---|---|
| 229,181 bytes | 22.9 ms | 39.4 ms, **82,464 captures** | 0.27 ms, 420 captures |
| 814,207 bytes | 80.9 ms | 159.8 ms, **292,547 captures** | 0.21 ms, 340 captures |

82,464 decorations in one `RangeSet` is the same class of problem the δ table already solved with
`virtual-list.ts`. So the colourer queries **only the ranges CodeMirror is about to draw**, from
`EditorView.viewport`, and rebuilds on viewport change as well as on document change. That is three
orders of magnitude less work, and it is measured on real `redextape emit --lang tm` output rather than
on a synthetic file.

The parse itself is not viewport-scoped and cannot be — tree-sitter parses the document to hold a tree
it can update incrementally. 80.9 ms at 814,207 bytes extrapolates to about 600 ms at the 6,100,000-byte
buffer ceiling, which is §5.1.1's ceiling doing double duty.

### §6.3 What colour costs when it fails

Deleting `classify_source`'s path means the mini-language's colour now depends on a wasm grammar load
that can fail, where today it depends on a function that cannot. **This is a real regression in failure
surface and it is accepted deliberately**, for the umbrella's §2 row 10 reason — one mechanism for four
languages beats two mechanisms for one and three. §10 says what a failed load looks like: that language
uncoloured, one notice, everything else working.

## §7 The grammar `.wasm` artefacts, and the gate that holds them

**The four `.wasm` are committed.** They total 44,358 bytes — 16,684 for the mini-language, 2,514 for
λ, 17,079 for TM and 8,081 for asm — so the tree carries them cheaply, and CI needs neither emscripten
nor docker to build the web app.

Building one needs `tree-sitter build --wasm`, which runs emscripten, which on a machine without it runs
`emscripten/emsdk:4.0.4` under docker. CI has neither, and docker-in-docker on the Forgejo runner is its
own project. Two build notes, both learned by doing it:

- The tree-sitter CLI **renames** its output into place, so `-o` must name a path on the same filesystem
  as the build. Pointing it at a scratch directory on a different mount fails with
  `failed to rename wasm output file: Invalid cross-device link`.
- The local `/usr/sbin/tree-sitter` reports 0.28.0 and is Arch's `-git` build; the pinned CLI is
  `.tools/tree-sitter` at 0.25.10, which is what `scripts/install-treesitter-ci.sh` installs and what
  must build these.

**The gate is a source-hash manifest, not a rebuild.** `grammars/wasm-manifest.json` records, per
grammar, the SHA-256 of the `src/parser.c` that produced its `.wasm`. `scripts/check-grammar-wasm.sh`
recomputes those hashes and fails when one differs — so a grammar edited and regenerated without its
`.wasm` rebuilt is caught, on CI, with no docker. It takes `--self-test` like its siblings, proving the
detector still detects. A documented `--rebuild` path rebuilds all four and refreshes the manifest, for
developers who have docker.

**What this gate does not catch, stated because a gate that only advertises its coverage is half an
argument:** it compares *inputs*, not outputs. A committed `.wasm` corrupted or replaced by hand, with
`parser.c` untouched, passes. The differential in §11.3 is what stands behind the artefact's actual
behaviour; this gate stands behind its freshness. Neither alone is enough and the pair is the claim.

`.gitignore` needs an exception: `*.wasm` is currently global, with a comment explaining it covers
`grammars/*/parser.so`'s sibling artefacts. The four paths are negated explicitly, one line each, rather
than by a directory glob that would also admit a stray build output.

## §8 Hover

New server work — the only new Rust behaviour in part 3 — plus a client. `initialize` gains
`hoverProvider: true` and `handle` gains a `textDocument/hover` arm.

**Three of four languages answer; λ answers nothing.**

| Language | What hover says |
|---|---|
| source | for a function name, its name and arity; for a builtin, its one-line description; for a literal, its value in the other encodings |
| TM | on a state name, how many rules it has; on a rule, what it does in words — what it reads, writes, which way it moves and where it goes |
| asm | what the instruction does, and its operand roles |
| λ | nothing |

**asm's row is served but not reachable in the app until part 5**, for §5.1's reason: there is no asm
editor to hover in. It is written and tested at the server (§11.2) so part 5 inherits it finished.

**λ's silence is a designed gap, not a defect, and the umbrella says so first.** The λ term type carries
no source positions, so there is nothing to resolve a document position against. It is recorded here so
that a future reader finds the reason rather than filing a bug, and so that the test suite asserts
*empty* for λ hover rather than omitting the case.

Hover is the one feature that can be deferred out of 3b without touching anything else, which is why it
is grouped with the new-dependency work rather than with 3a.

## §9 The vim keymap

`@replit/codemirror-vim` 6.4.0, in a CodeMirror `Compartment`, switched by a *keymap* setting —
*default* or *vim* — in the settings menu part 2a built. The umbrella's §5 calls vim "a keymap
compartment", and a compartment is exactly what lets the setting change without rebuilding the editor.

**vim owns keys inside a focused editor.** One rule, stated once:

- While an editor has focus and the keymap is *vim*, vim receives `Esc` and every normal-mode key.
- App shortcuts reachable inside an editor take a modifier, so they cannot collide with a normal-mode
  key.
- Outside an editor, nothing changes — the app's keys behave as they do today in both keymaps.

The rejected alternative was `Esc` in normal mode moving focus out of the editor. It is convenient and
it is what the umbrella's §4 rule 2 forbids for glyphs, applied to a key: one `Esc`, two meanings,
told apart only by a mode the user may not be tracking.

`lintGutter` and the outline panel are unaffected by the keymap. The format shortcut takes a modifier,
per the rule above.

## §10 When things fail

Each failure leaves a working editor and one notice, through part 2a's notice line and live region.
None blocks editing or compiling.

| Failure | What happens |
|---|---|
| The LSP worker dies | Editors keep working without language features. The client restarts it once and replays `initialize` and every open document; a second death leaves features off with one notice. |
| The LSP wasm fails to fetch | Same as a dead worker, without the restart — the notice says language features are unavailable. |
| A grammar fails to load | That language shows uncoloured, one notice. The other three are unaffected, because each grammar loads independently. |
| A document is over the ceiling | No colour and no diagnostics for that document, one notice saying which. Editing, compiling and running are untouched. |
| `format` on an unparseable buffer | Nothing visible. `Language::format` returns `None`, which arrives as JSON `null`, and the client normalises it to no edits (§5.2). |
| A definition or reference in no open view | The notice line says the target is not open. No view is created. |

## §11 Tests

### §11.1 The class-level control test still holds

The umbrella's §8.1 walks every button in every preset asserting an accessible name that is not a bare
glyph, and keyboard reach. Part 3 adds controls — the outline panel's disclosure, the format item, the
keymap setting — and they are covered by that existing test rather than by new ones, which is the point
of a class-level gate.

### §11.2 Per-language browser tests

Per the umbrella's §8.5, and one file per feature rather than one per language, so a language missing
from a feature is a visible hole in a table rather than an absent file:

- **diagnostics** — each of the three editors shows its one diagnostic from §2.3's broken fixtures, in
  the gutter, at the right line. The TM row is the one that shows something where nothing was shown
  before.
- **format** — each of the three reformats; an unparseable buffer in each is unchanged.
- **definition and references** — within a document, and across two views.
- **outline** — the panel lists `fact` for source; the panel is absent for λ.
- **hover** — source and TM answer, λ answers empty (3b).

**asm is tested at the server, not in the app**, because it has no editor until part 5. A node test
drives `LspServer.handle` over asm text for diagnostics, format and hover, so part 5 inherits a proven
language rather than an untested one.

### §11.3 The grammar differential is what catches ABI and build drift

A browser fixture asserts that web-tree-sitter, loading the committed `.wasm`, produces the same
captures that `redextape-grammar-check` already holds the grammars to in Rust. That crate exists, it
reads raw query matches and projects them to `TokenClass`, and it is the authority this test borrows
rather than a second one.

**This is the test that fails if the ABI moves**, if the pinned CLI is bumped, or if a committed
`.wasm` no longer matches its `grammar.js` — the last of which §7's manifest gate also catches, from the
other side.

### §11.4 The language-id test

A node test asserts the four `languageId` strings the client sends are exactly the four
`Language::from_language_id` matches. §4 says why: a wrong id fails silently and looks like a clean
file, and it already cost this design a round of wrong measurements.

### §11.5 What the tests are not

**No pixel baselines**, per the umbrella's §8 — across three styles and six palettes they break on every
token change. Each PR's roadmap entry records a manual visual check across the three presets in light
and dark, and 3b's records one per language with colour on.

## §12 The accessibility list

Item 16 — *neither editable text region carries an accessible name* — is part 3's, per the umbrella's
§9 table, and 3a closes it: each editor gets an accessible name naming its view and language.

Part 3 adds no item to the list. Every control it introduces is built to the umbrella's §4 rules, which
is what §9 of the umbrella means by parts 1–6 stopping the list from growing.

## §13 Decisions made while designing

| Question | Chosen | Declined |
|---|---|---|
| How to ship part 3 | one spec, two PRs — 3a served-today, 3b new work | one PR; LSP whole including hover in 3a; colour first |
| Source colouring | tree-sitter replaces `classify_source` in `web/` | keeping `classify_source` for source; tree-sitter with `classify_source` as fallback |
| Source diagnostics | the LSP worker serves all four; `analyze` path deleted | keeping `analyze` synchronous for source; `analyze` as a first paint the LSP supersedes |
| Wasm layout | two artefacts, a new `redextape-lsp-wasm` crate | one combined artefact, saving 68 KB gzipped |
| Grammar `.wasm` | committed, gated on a `parser.c` source hash | built in CI; built at web build time; committed ungated; a rebuild-and-compare gate CI cannot run |
| Query scope | viewport ranges only | whole document; parsing only the viewport |
| Over the ceiling | uncoloured and undiagnosed, with one notice | parse in a worker; no ceiling |
| Hover | source, TM, asm; λ empty by design | source only; all four via printed-form spans; defer hover entirely |
| vim keys | vim owns keys inside a focused editor | app shortcuts always win; `Esc` escapes the editor in normal mode |
| LSP boundary types | JSON strings, client hand-writes the subset it uses | `serde-wasm-bindgen`; `ts-rs` generation over `gen-lsp-types` |

## §14 Figures, and what produced them

Every timing below was taken **in Node**, against `wasm-pack --target nodejs` builds, on this machine.
They size the design; they are not browser figures, and §5.1.1's ceiling is measured in a browser during
the plan's pre-flight rather than taken from here.

| Value | What | Produced by |
|---|---|---|
| 15 | grammar ABI, all four | `grep -h -m1 LANGUAGE_VERSION grammars/*/src/parser.c \| sort -u` |
| 0.25.10 | pinned tree-sitter CLI | `TREESITTER_VERSION` in `scripts/install-treesitter-ci.sh`; `.tools/tree-sitter --version` |
| 0.28.0 | the CLI on `PATH`, which is *not* the pin | `/usr/sbin/tree-sitter --version` — Arch's `-git` build |
| 0.27.0 | `web-tree-sitter` | `pnpm view web-tree-sitter version`, 2026-09-20 |
| 6.4.0 | `@replit/codemirror-vim` | `pnpm view @replit/codemirror-vim version`, 2026-09-20 |
| `emscripten/emsdk:4.0.4` | image `tree-sitter build --wasm --docker` pulls | the pull's own output, running it at 0.25.10 |
| 16,684 / 2,514 / 17,079 / 8,081, totalling 44,358 | the four grammar `.wasm` — mini-language, λ, TM, asm | `.tools/tree-sitter build --wasm --docker -o <out> grammars/<g>` for each, then `stat -c%s` |
| 15, 15, 15, 15 / `hasError` false | ABI reported, and a clean parse, loading each `.wasm` under `web-tree-sitter` 0.27.0 | a Node probe: `Language.load`, `parser.parse`, `new Query(lang, highlights.scm)`, over `redextape emit` output in each language |
| 22.9 ms / 39.4 ms / 82,464 | parse, whole-document query, captures — TM, 229,181 bytes | the same probe, on `emit fact.rxt --lang tm` with `fact(3)` |
| 80.9 ms / 159.8 ms / 292,547 | the same — TM, 814,207 bytes | the same probe, on `emit --lang tm --encoding binary` with `fact(6)` |
| 0.27 ms / 420, 0.21 ms / 340 | viewport query, first 60 lines of each | `query.captures(root, { startIndex: 0, endIndex })` in the same probe |
| about 600 ms | parse extrapolated to 6,100,000 bytes | 80.9 × 6,100,000 ÷ 814,207, linear |
| 6,100,000 | `MAX_SCRATCH_TM_BYTES` | `grep -rn 'MAX_SCRATCH_TM_BYTES' crates/redextape-wasm/src/session.rs` |
| 100 ms, 300 ms | `lint.ts`'s lint delay, `compile.ts`'s `DEBOUNCE_MS` | `grep -n 'delay:' web/src/lint.ts`; `grep -rn 'DEBOUNCE_MS' web/src/compile.ts` |
| 0.15 / 0.05 / 0.06 / 4.57 / 14.58 ms | `didChange` → `publishDiagnostics`, five runs each, source / λ / asm / TM 229 KB / TM 814 KB | a Node probe driving `LspServer.handle` with the correct `languageId` |
| about 109 ms | that, extrapolated to 6,100,000 bytes | 14.58 × 6,100,000 ÷ 814,207, linear |
| 0.512 ms | `structuredClone` of a 6,100,000-byte string, 20 runs | `node -e` over `"x".repeat(n)` |
| 776,988 / 271,498 | session wasm **as the tree builds it**, raw and gzipped | `wasm-pack build crates/redextape-wasm --release --target web`, then `stat -c%s` and `gzip -c \| wc -c`. Rebuilt before measuring: the `pkg/` on disk predated its own crate's last commit |
| 825,451 / 283,076 | LSP wasm the same way | `wasm-pack build crates/redextape-lsp-wasm --release --target web --out-dir ../../pkg-lsp`, same two commands |
| 554,574 | both artefacts, gzipped | 271,498 + 283,076 |
| 526,709 / 196,241 | session-only wasm at `opt-level = "s"` + `lto` | a probe crate re-exporting `redextape_wasm`, that profile, after `wasm-opt` |
| 586,983 / 211,063 | LSP-only wasm, same profile | the `LspServer` probe crate, identical profile |
| 935,444 / 339,337 | both surfaces in one crate, same profile | a probe crate holding both, identical profile |
| 67,967 | gzipped bytes combining would save **at that profile** | 196,241 + 211,063 − 339,337 |
| about 75 KB | gzipped the session artefact alone would lose to that profile change | 271,498 − 196,241 = 75,257. A separate finding; §3.1 says why part 3 does not act on it |

**One measurement in this design was wrong before it was right, and the mechanism is worth recording.**
The diagnostics timings were first taken with `languageId: 'x'`, which `from_language_id` answers `None`
to, so the server did no analysis at all and the numbers came back 0.02–1.64 ms — about nine times too
low, and low in the direction that would have made §5.1's reversal look free. It was caught not by a
failure but by a *zero*: every language returned zero diagnostics on input written to be broken, and a
probe reporting an absence is a claim about the probe. §4 and §11.4 are both consequences.
