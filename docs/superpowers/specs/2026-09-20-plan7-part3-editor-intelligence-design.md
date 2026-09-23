# Plan 7, part 3 — Editor intelligence: the LSP in the browser, colouring, hover, vim — design

Part 3 of [Plan 7](2026-09-17-frontend-overhaul-design.md). It brings `redextape-lsp` to the browser and
gives all four languages colour: diagnostics in every editor, format, outline, definition, references,
hover, web-tree-sitter highlighting, and a vim keymap.

It answers all five questions the umbrella's §6 left for this part, and **four of the five were measured
rather than decided** — §14 gives the command behind every figure. The measurements changed two answers
the umbrella guessed at and added one constraint it did not anticipate (§6.2).

Code facts below were read at `bc592b6` (#102, part 2b's squash merge).

**Amended 2026-09-21, at `79b0f14` (#103, 3a's squash merge), while pricing 3b's plan.** The amendment
splits hover out into its own PR (§1), corrects §6.1's account of the capture→colour map from one table
to the four that already exist, gives §7's manifest a second hash column, says how §11.3's browser
differential reaches a Rust authority that cannot be called from a browser, and prices two costs §9
understated. It also withdraws two claims this document made that are false against the tree: §7's
description of the `*.wasm` rule's comment, and §8's "its value in the other encodings" for a language
with no char literal. Every figure it adds is in §14.1, with the command behind it.

**Amended 2026-09-22, at `0bd07c5` (#104, 3b's squash merge), while designing 3c.** §8 named four
decisions it left to 3c's plan and stated a fifth as open. This amendment settles all five and adds a
sixth the design of the client raised, rewrites §8 around them, and adds the rows they produce to §13.
Two of the six are reversals of what §8 assumed: TM hover **never reads the machine**, so both TM rows
survive a broken file rather than only one; and hover's words live in **`redextape-core`**, not in
`redextape-lsp`, which leaves the LSP crate marshalling-only for hover as it is for everything else.
The amendment also records two things in the tree that §8 did not mention and that 3c must change:
the two tests that pin hover's absence, and the comment `prelude.rs` carries about its own constant.
Every figure it adds is in §14.4, with the command behind it.

## §1 Scope, and the three PRs

One design, three PRs, each with its own plan and roadmap entry. 3a is designed knowing what 3b and 3c
need, so no shape it ships has to change for either.

**3a — the LSP in the browser.** In: the `redextape-lsp-wasm` crate and its build (§3.1); the LSP worker
and its client (§3.2, §3.3); documents, language ids and positions (§4); and the five features the server
already serves today — diagnostics in every editor, format with opt-in format-on-blur, the outline panel,
definition and references (§5). The `analyze`-based lint path is deleted in the same change.

**3b — colour and vim.** In: web-tree-sitter over the four committed grammar `.wasm` (§6); the grammar
artefacts and their freshness gate (§7); the vim keymap compartment (§9). `classify_source`'s decoration
path in `web/` is deleted in the same change — the function itself stays, because it is the authority
`redextape-grammar-check` holds the grammars to (§11.3).

**3c — hover.** In: `textDocument/hover` in the server and a client for it (§8), for source, TM and asm.
The behaviour lands in `redextape-core` and the LSP crate marshals it, which §8.2 decides and argues.

**3a's split from the rest is "served today" against "new work".** Every feature in 3a was proven to run
in wasm unmodified before this spec was written (§2.3), so 3a carries no new Rust behaviour at all. 3b
carries no new Rust behaviour either — it is two new dependencies (`web-tree-sitter`,
`@replit/codemirror-vim`) and a gate. 3c is the only part of the whole of part 3 that adds new Rust
behaviour at all. **An earlier draft of this sentence put that behaviour in `redextape-lsp`; §8.2 puts
it in `redextape-core`**, leaving the LSP crate marshalling-only for hover exactly as it is for the five
features 3a shipped.

**Hover was 3b's until a pre-flight priced it, and this is the correction.** An earlier draft of this
section shipped hover inside 3b on the strength of §8's own sentence that it "can be deferred out of 3b
without touching anything else". That sentence is true and it is why the split is cheap; what it does not
say is how much hover costs. The pre-flight for 3b's plan found that `NameIndex` — the position→name
resolver `definition` and `references` already share — reaches four of §8's seven answers and none of the
other three, because **`Rule`, `State`, `Machine`, `Instr` and `Program` carry no spans at all** and a
source literal is not a name occurrence. So the three remaining answers each need a resolution path that
does not exist, plus an asm instruction table that has to be authored from doc comments (§8). Hover is the
largest of the four chunks, not the smallest, and putting it in 3b would have made that branch half again
the size of 3a's thirteen commits. §14 names the pre-flight behind each of those claims.

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

`session-worker.ts` stated the reason neither is in a worker: "`classifySource` and `analyze` are NOT
here: they are free functions, they are what the editor calls on every keystroke, and a round trip per
keystroke is exactly the lag this split exists to avoid."

**Past tense, because 3b deleted the sentence this section quotes.** That file now records that
"neither half survives" — `analyze` has had no web caller since 3a made diagnostics a push from the LSP
worker, and `classifySource` went with the decoration path it fed. The quotation stays because §6.1
below is an argument *against* that reasoning and needs it on the page; it is marked as what the file
said at `bc592b6` rather than as what a reader will find there now.
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
TM buffer ceiling the message crossing is a rounding error against the analysis. **The debounce these
were once measured against is gone** — part 3a deleted `lint.ts`, so the source editor sends a
`didChange` per keystroke and the λ and TM editors send on `compile.ts`'s 300 ms (§14). Every figure
above is under 15 ms and lands in a worker, except at the extreme — and the extreme is §5.1.1.

**Nothing regresses for the mini-language**, and that is provable rather than hoped: the server's source
diagnostics *are* `analyze`'s, asserted by a test in `language.rs`. What changes is the thread and the
position units, not the content.

**λ, TM and asm gain diagnostics they never had**, which is what the umbrella means by "closes the TM
gutter showing none". Each produces exactly one diagnostic on the broken fixtures in §2.3.

#### §5.1.1 The ceiling

`MAX_SCRATCH_TM_BYTES` is 6,100,000, and `didChange` → `publishDiagnostics` just past it costs
**135.2 ms** (§14.2). This section first put it at about 109 ms by scaling the 814,207-byte row
linearly, which came in 24% low. It is in a worker either way, so it lags rather than janks.
`textDocumentSync` is Full, so each keystroke re-analyses the whole document.

**ONE CEILING WAS PLANNED FOR BOTH AND ONLY COLOURING GOT ONE, WHICH §10 NOW STATES AS A DECISION
RATHER THAN A GAP.** Colour parses on the main thread, where a document this size stalls every
keystroke; diagnostics cost that 135.2 ms on another thread, and the main thread's whole share of them
is 0.238 ms. So `COLOUR_CEILING_UNITS` (§6.2) is a colour ceiling — a measured byte figure rather than
this extrapolation, taken **in a browser**, not in Node as every figure here was. Above it an editor
shows uncoloured with one notice saying so, and keeps its diagnostics.

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

**Capture names reach part 1's palette through `TokenClass`, and there are FOUR maps, not one.** An
earlier draft of this paragraph listed a single capture vocabulary — `@keyword`, `@boolean`, `@number`,
`@comment`, `@operator`, `@punctuation.bracket`, `@punctuation.delimiter`, `@variable`, `@function`,
`@function.call`, `@variable.parameter` — and waved at "λ's, TM's and asm's own". That is wrong in a way
that matters: the four maps already exist in Rust, as a `CAPTURE_CLASSES` table per language in
`redextape-grammar-check`, and **they disagree with each other on three capture names by design**.

| Capture | mini-language | λ | TM | asm |
|---|---|---|---|---|
| `@function` | `Ident` | — | — | **`Mnemonic`** |
| `@variable.parameter` | `Ident` | **`Binder`** | — | — |
| `@label.reference` | — | — | **`StateName`** | `Label` |

A single table would have had to pick a winner for each row and would have coloured an asm mnemonic as an
identifier. So the colourer carries the language's own table, keyed by the `languageId` the editor already
holds, and `TokenClass` is the shared vocabulary underneath — the same enum `analysis.rs` declares, whose
fourteen variants `theme.ts`'s `tokenClassName` already turns into the fourteen `.tok-*` classes
`style.css` already styles. This paragraph said *"from seven palette tokens. This part adds no colour of
its own"*, and part 3b added exactly one: `tok-binder`, an eighth token, because the λ table reaches
`Binder`, `Ident` and `Punct` and nothing else, and all three collapsed onto two colours: `Binder` drew
`--tok-neutral`, `Ident` drew `--tok-ident`, which is `--fg` in every variant, and `Punct` drew
`--tok-punct`, which is `--tok-neutral` in both dark variants. No capture gained a class and no class
gained a rule outside the palette, so the colour gate is still satisfied by construction.

**The four tables move to `redextape-core` and cross the wasm boundary, so `web/` holds no copy of them.**
They are pure `&[(&str, TokenClass)]` data with no tree-sitter dependency; `redextape-grammar-check` goes
on consuming them from their new home, and `redextape-wasm` exports them beside the `tokenClasses()` it
already exports for exactly this reason. A hand-written TS mirror was the alternative and is declined: a
map that disagrees per language in three places is precisely the shape a hand copy gets wrong, and a drift
test over a copy is a weaker claim than having no copy.

### §6.2 Viewport-scoped queries are a requirement, not an optimisation

This is the constraint the umbrella did not anticipate, and it is the reason §6.1 is not a small change.

Running a grammar's highlight query over a whole real TM document:

| TM document | parse | whole-document query | viewport query, 60 lines |
|---|---|---|---|
| 229,181 bytes | 37.1 ms | 67.5 ms, **82,464 captures** | 0.65 ms, 897 captures |
| 814,207 bytes | 130.0 ms | 221.8 ms, **292,547 captures** | 0.56 ms, 773 captures |

**The viewport column was wrong in every earlier draft, and the mechanism is the point.** It read 420
and 340, and both were measured over half the window they claimed. `QueryOptions.startIndex` and
`endIndex` in `web-tree-sitter` 0.27.0 are **2 × UTF-16 code units**, while `node.startIndex` on the
captures those options return is plain code units — an asymmetry inside one API. Every probe this
design was built on passed a code-unit count straight through, so each measured half the range it was
labelled with: the "60-line viewport" figure of 420 in fact spanned to unit 1,223, which is **line 35**.

Measured on pure ASCII so nothing else can explain it — a 9-unit document `(ab) (cd)` yields 3 of its
6 captures at `endIndex: 9` and all 6 at `endIndex: 18`, the latter identical to passing no range.

**The conclusion this section draws is unchanged**, which is why the correction is a figure and not a
redesign: 897 against 82,464 is still ninety-two times less work, and the whole-document counts were
never affected because they pass no range at all and reproduce exactly. The parse and query timings
above are re-taken in the same session as the corrected counts rather than carried over from the runs
that produced the wrong ones.

82,464 decorations in one `RangeSet` is the same class of problem the δ table already solved with
`virtual-list.ts`. So the colourer queries **only the ranges CodeMirror is about to draw**, from
`EditorView.viewport`, and rebuilds on viewport change as well as on document change. That is three
orders of magnitude less work, and it is measured on real `redextape emit --lang tm` output rather than
on a synthetic file.

The parse itself is not viewport-scoped and cannot be — tree-sitter parses the document to hold a tree
it can update incrementally. 130.0 ms at 814,207 bytes extrapolates to about 974 ms at the 6,100,000-byte
buffer ceiling (130.0 × 6,100,000 ÷ 814,207), which is §5.1.1's ceiling doing double duty. **This
paragraph read "80.9 ms … about 600 ms" two paragraphs below the table above having already been
re-taken to 130.0 ms** — the table was corrected and this sentence, quoting the same measurement, was
not. There is no third figure here: it is the same stale carry-over §14 also had, arithmetic included.

**"Incrementally" is load-bearing and was measured in a browser, not assumed.** A full reparse of a
103,028-unit TM in Chromium is 8.1 ms and an incremental one — `tree.edit` with the change, then
`parse(text, oldTree)` — is **0.4 ms**, twenty times less, for an edit placed near the end of the
document where the least of the old tree can be reused. A full reparse per keystroke extrapolates to
about 480 ms at the ceiling; the incremental path does not grow with the document at all. So **the parse
clock and the query clock are separate**: the tree is edited and reparsed on a document change, and the
decorations are rebuilt from the existing tree on a viewport change. Rebuilding the tree on viewport
change as well is the obvious first implementation and it is the one to avoid.

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

**This section priced the grammars and never priced the engine that runs them, which is the larger
number.** `web-tree-sitter` ships its own parser runtime as a fifth `.wasm`, fetched at
`Parser.init({ locateFile })`: **209,613 bytes raw**. So the built image carries **seven** `.wasm`, not
the six an earlier draft of the plan counted — the two wasm-pack artefacts, the four grammars, and the
runtime — and "the tree carries them cheaply" is a claim about the repository, not about the download.

**The wire figures are what the running server sends, because every other way of computing them gave a
different answer.** Four attempts at "the grammars, gzipped" produced 12,903, 13,997, 14,175 and
14,211, depending on whether the files were concatenated first and which `gzip` flags were used — and
none of them is the number a user pays, because `deploy/nginx.conf` sets `gzip on` with
`application/wasm` in `gzip_types` and compresses at its own level. Measured against the built image
with `curl -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}'`:

| | raw | what nginx sends |
|---|---|---|
| the four grammars | 44,358 | **15,052** |
| the `web-tree-sitter` runtime | 209,613 | **94,777** |
| colour, total | 253,971 | **109,829** |

The runtime is **6.3 times** the four grammars on the wire. A figure computed with `gzip -9` reads
82,848 for it — 12,000 bytes under what is actually served, and flattering in the direction that
matters.

**λ's is small enough that Vite inlined it, and the build config now stops that.** At 2,514 bytes it
falls under Vite's default `assetsInlineLimit` of 4096, so a production build turned it into a
`data:application/wasm;base64,` URI in the JS bundle while the other three were emitted as hashed
assets. The inlined form was measured working in Chromium — fetched, `application/wasm`,
`compileStreaming` fine — so this is a uniformity problem, not a breakage. It is fixed anyway, because
**the threshold flips behaviour with no signal**: a grammar that grows past 4 KB silently changes how
it loads in production. It also gave λ alone a different failure surface from its three siblings,
which contradicts §10's row that each grammar loads independently, and made dev and production differ
for one language only. `build.assetsInlineLimit` now declines to inline `.wasm` and leaves every other
asset type on Vite's default.

**This was missed by the pre-flight that was supposed to settle it**, and the mechanism is worth
recording: the probe that established "a relative `?url` escaping the Vite root is emitted into
`dist/`" used the mini-language and TM grammars, 16,684 and 17,079 bytes. Both are far over the
threshold, so neither could expose it. The boundary was verified on the two cases incapable of
showing it.

Building one needs `tree-sitter build --wasm`, which runs emscripten, which on a machine without it runs
`emscripten/emsdk:4.0.4` under docker. CI has neither, and docker-in-docker on the Forgejo runner is its
own project. Two build notes, both learned by doing it:

- The tree-sitter CLI **renames** its output into place, so `-o` must name a path on the same filesystem
  as the build. Pointing it at a scratch directory on a different mount fails with
  `failed to rename wasm output file: Invalid cross-device link`.
- The local `/usr/sbin/tree-sitter` reports 0.28.0 and is Arch's `-git` build; the pinned CLI is
  `.tools/tree-sitter` at 0.25.10, which is what `scripts/install-treesitter-ci.sh` installs and what
  must build these.

**The gate is a hash manifest, not a rebuild, and it records BOTH ends.** `grammars/wasm-manifest.json`
records, per grammar, the SHA-256 of the `src/parser.c` that produced its `.wasm` **and** the SHA-256 of
the `.wasm` itself. `scripts/check-grammar-wasm.sh` recomputes both and fails when either differs, on CI,
with no docker and no emscripten — `sha256sum` is all it needs. It takes `--self-test` like its siblings,
proving the detector still detects. A documented `--rebuild` path rebuilds all four and refreshes the
manifest, for developers who have docker.

**Recording the output hash is a correction to an earlier draft of this section, and the measurement is
what allowed it.** That draft recorded `parser.c` alone and then admitted the hole in the next paragraph:
it compared *inputs*, not outputs, so a committed `.wasm` corrupted or replaced by hand with `parser.c`
untouched would pass. The reason given for stopping at inputs was that CI cannot rebuild the artefact and
therefore cannot check it. That reason does not hold: checking an artefact's hash is not rebuilding it.
The build was then measured to be byte-reproducible — the same grammar, rebuilt after deleting the
artefact and written to a different output filename, produced an identical SHA-256 — so recording the
output hash costs one field per grammar and causes no churn, because a legitimate `--rebuild` writes the
same bytes back. §14 carries the hash and the command.

| Failure | `parser.c` hash | `.wasm` hash |
|---|---|---|
| grammar regenerated, `.wasm` left stale | caught | caught |
| `.wasm` replaced or corrupted by hand, `parser.c` untouched | missed | **caught** |
| both edited together so they agree | missed | missed |

The bottom row is the residue every hash manifest has and neither column closes it. The differential in
§11.3 is what stands behind the artefact's actual *behaviour*; this gate stands behind its *identity*.
Neither alone is enough and the pair is the claim.

`.gitignore` needs an exception: `*.wasm` is currently global, one line with no comment of its own, four
lines below the block comment that belongs to `/pkg/`. (An earlier draft of this paragraph said that rule
carried a comment about `grammars/*/parser.so`'s sibling artefacts. It does not — `grammars/*/parser.so`
is a separate rule at the foot of the file with its own unrelated comment about nvim-treesitter compiling
in place.) The four paths are negated explicitly, one line each, rather than by a directory glob that
would also admit a stray build output; the file's one existing negation, `!.env.example`, sits adjacent to
what it negates, and these four cannot, so they carry a comment saying what they are.

**The negations close a second hole as a side effect, which is worth stating because it is the more
interesting one.** `check_grammars` in `scripts/check-all.sh` already fails on an untracked file under
`grammars/`, and its own comment records that `--exclude-standard` honours `.gitignore` and that this is
"this check's own blind spot". While the four `.wasm` are ignored, that arm cannot see them at all. Once
they are negated and committed, it can.

## §8 Hover — PR 3c

New Rust behaviour — the only new Rust behaviour in the whole of part 3, and it lands in
`redextape-core` rather than in the LSP crate (§8.2) — plus a client. `initialize` gains
`hoverProvider: true` and `handle` gains a `textDocument/hover` arm, shaped exactly like the `definition`
arm beside it: `HoverParams` flattens the same `TextDocumentPositionParams`, and `HoverRequest`'s result
type is `Option<Hover>`, so "nothing to say" is a well-typed `null` rather than a new type.

**Three of four languages answer; λ answers nothing.**

| Language | What hover says | Resolves a position how |
|---|---|---|
| source | for a function name, its name and arity | `NameIndex` + the AST walk |
| source | for a builtin, its signature and one authored line | `NameIndex` + `prelude::type_env` |
| source | for a `Nat` literal, its value in the other bases; for a `Bool`, what it lowers to | the AST walk |
| TM | on a state name, how many rules it has | `NameIndex` + a line scan |
| TM | on a rule, what it does in words — what it reads, writes, which way it moves and where it goes | `rule_at`, a line re-parse |
| asm | on a label, where it is defined | `NameIndex` |
| asm | on an instruction, what it does and its operand roles | `instr_at` + `MNEMONIC_DOCS` |
| λ | nothing | — |

### §8.1 Why hover is its own PR

**Two of the seven answers are `NameIndex` alone; five need something it does not hold.** An earlier
draft of this section said four were nearly free and three were not, and its own bullets already
contradicted it: the bullet below puts arity outside `NameIndex`, and §8.3 puts a state's rule count
there too. The count is corrected rather than restated — what carries the argument is the list, not
the number in front of it.

`NameIndex` is the position→name resolver `definition` and `references` already share, it is cached per
document version, and a cursor one past the last byte of a name still resolves to that name. It indexes
name occurrences and nothing else. So:

- **`Rule`, `State`, `Machine`, `Instr` and `Program` carry no spans.** They are pure data models. A
  cursor inside `write [b]` or on an `li` mnemonic resolves to nothing, and the rule-level and
  instruction-level answers need a position→construct path that does not exist. `.tm` and `.asm` are both
  line-oriented and `outline.rs`'s `enclosing_line` is the precedent to follow rather than threading spans
  through the machine model.
- **A literal is not an occurrence either**, so the source literal row needs its own resolution, and
  **no decimal/hex/binary rendering helper exists anywhere in the Rust tree**. An earlier draft of this
  table said "its value in the other encodings"; the source language has `Nat` and `Bool` literals and no
  char literal at all, so the row now says *bases* and means it. `redextape_core::tm::Encoding` is a
  different sense of the word — a trait for laying arithmetic onto tape cells — and is not this.
- **No asm instruction description or operand-role table exists**, and the pieces that come closest are
  unreachable from outside `redextape_core::tm`: `asm_syntax.rs`'s `MNEMONICS` (24 spellings, the
  authoritative list) is a **bare `const`, private to `asm_syntax`**, while its `Shape` and `shape_of`
  and `asm.rs`'s `instr_parts` are `pub(super)`. An earlier draft of this sentence called all four
  `pub(super)`; `MNEMONICS`, the one the argument in §8.2 turns on, is the one that is not.
  The prose to transcribe is the doc
  comments on `asm.rs`'s `Instr` variants, which say what each instruction does but are compile-time
  comments with no runtime representation. §8.4 decides where the table lives and how much of it is
  authored.
- **Arity is not in `NameIndex` either.** `DefKind::Fn` is a bare discriminant. Arity is `params.len()` on
  `ast.rs`'s `Stmt::Fn`, so even the cheapest row needs the AST.

**Three mechanisms, not three paths, and the reduction is §8.2's first consequence.** The source rows for
arity and for a literal are answered by ONE walk of the same AST, so the seven answers need an AST walk,
a TM line re-parse and an asm line re-parse — three mechanisms serving five rows that `NameIndex` alone
cannot reach.

### §8.2 Where hover's knowledge lives: `redextape-core`

**The resolvers AND the words are core's; `redextape-lsp` only marshals them.** `Language::hover` becomes
the fourth one-call-into-core in `language.rs`, beside `diagnostics`, `format` and `nav`, and is a
four-arm match answering `None` for λ. Core returns a structured `HoverAnswer` — a title and lines,
carrying no markup — and the LSP crate renders it and attaches the range.

```
redextape-core                                  the new behaviour
  hover.rs            HoverAnswer, and the words, per language
  tm/syntax.rs        rule_at(src, offset)     — a public wrapper on parse_rule_line
  tm/asm_syntax.rs    MNEMONIC_DOCS[24] and its drift test; instr_at(src, offset)
redextape-lsp                                   marshalling only, as everywhere else
  language.rs         Language::hover
  lib.rs              the hover arm; hoverProvider; the negotiated markup kind
```

**The alternative was core exposing spans and `redextape-lsp` writing the sentences, and the drift test
is what decided it.** `MNEMONICS` is private to `asm_syntax`, so a 24-row table living in
`redextape-lsp` could only be held to it by widening that constant to `pub` and asserting across a
crate boundary — a weaker claim than
the sibling it copies, `asm_syntax.rs`'s own `table_agrees_with_the_printer`, which sits beside what it
checks. Two objections to prose in core do not survive the tree: **core already owns user-facing English**
— every `Diagnostic::message` is core's, `"bad move (expected L/R/S)"` among them — and the seam this
draws is exactly the protocol's, with core answering *what is here and what it means* and the LSP crate
answering *how LSP spells that*.

**It also costs one visibility change fewer than the alternative.** `parser.rs`'s `parse_for_nav` is
`pub(crate)`, and `hover.rs` is inside core, so the AST walk reaches it with no change at all. A hover
written in `redextape-lsp` would have needed `parse_for_nav`, `MNEMONICS`, `Shape` and `instr_parts` all
made `pub` — four widenings of core's surface, each one a parser internal.

### §8.3 TM hover never reads the machine

**Both TM rows resolve from text, so both survive a broken file.** §8 stated this as an open behavioural
decision and assumed the answer was no: `TmDocument::machine` is `None` whenever the file carries an
error diagnostic, so a TM hover built on the machine goes quiet on broken input — where `definition`
deliberately still answers, because `NameIndex` survives a failed parse by design and
`definition_in_a_broken_file_still_answers` holds it to that. That section said hover on a rule "cannot
[keep that property], without a second source for the rule's contents".

**That second source already exists and is one line of visibility away.** `syntax.rs`'s `parse_rule_line`
takes a line and a span, reads the rule's symbols, moves and goto target out of that line's own text, and
consults no `Machine` — it is what `parse_tm_nav`'s loop calls per line before any machine is assembled.
`rule_at` wraps it: take `enclosing_line`'s span for the offset, hand the line to `parse_rule_line`, and
describe what comes back. The state-name row is line-oriented for the same reason — a state's rule count
is the number of rule lines between its `state` line and the next one, which is a scan rather than a
lookup into `Machine::states`.

So there is **one** TM code path rather than a clean one and a broken one, `TmDocument::machine` appears
nowhere in hover, and the property `definition` has gets a hover sibling in §11.2. The residue is stated
rather than hidden: a rule line that is itself malformed answers nothing, which is correct — there is no
rule there to describe.

### §8.4 The 24-mnemonic table

**24 authored rows beside `MNEMONICS`, one per spelling, with the arity derived rather than authored.**
Each row carries a one-line description and its operand role names; the drift test asserts one row per
`MNEMONICS` spelling and back, and that each row's operand count equals `shape_of(mnemonic).kinds().len()`
— so a mnemonic added to one table and not the other is a failure, and a row whose roles disagree with
its `Shape` is a failure.

**The 9 arithmetic and comparison spellings must be authored individually, and `Instr`'s doc comments
cannot supply them.** 24 spellings fold into 16 `Instr` variants because `Instr::Bin` prints as one of
nine, and its single doc comment reads `rd <- ra op rb` for all nine of them. `add`, `sub`, `mul`,
`cmpeq`, `cmpne`, `cmplt`, `cmple`, `cmpgt` and `cmpge` therefore get nine sentences, not one — which is
the sharpest reason this table is authored rather than derived from the doc comments wholesale.

### §8.5 The source rows

**`Nat`: the three bases. `Bool`: what it lowers to.** The source language's numeric literals are
**decimal only** — `lexer.rs` reads digits with `is_ascii_digit` and there is no radix prefix in the
grammar — so the hex and binary renderings are informational and cannot be typed back. That is the row's
value rather than an objection to it: this app puts a source view and an asm or TM view side by side, and
the base a literal is written in is not the base the other two show it in.

A `Bool` has no bases, which is why §8's original row named it and then had nothing to give it. The fact
that belongs there is the crossing: `lower_asm.rs` lowers `Core::Bool(_, b)` to `Li(dst, u64::from(*b))`,
so `true` is **1** and `false` is **0** in a register. The hover says that and cites it.

**The builtin row is computed where it can be and authored where it cannot.** A builtin's signature comes
from `ty::show` over its scheme in `prelude::type_env` — the same table the typechecker reads, so the
signature cannot drift from what the builtin is, and `ty.rs` already round-trips `show` against
`parse_ty`. What a type cannot say is that `head` and `tail` fault on nil, so each of the five carries one
authored line beside its signature.

**The lookup goes through `type_env`, not through `BUILTIN_NAMES`, and that is deliberate.**
`prelude.rs`'s own comment records that "nothing in this workspace reads `BUILTIN_NAMES`" and rests a
paragraph about `$`-prefixed aliases on that. One lookup in `type_env` answers both *is this a builtin*
and *what is its scheme*, so the constant stays unread and the comment stays true. A hover that read
`BUILTIN_NAMES` would have to correct that comment in the same commit.

### §8.6 The client

`web/src/lsp-hover.ts`, wired at the two editor construction sites §9 names — `scratch-editor.ts` and
`main.ts`. **No new dependency:** `@codemirror/view` 6.43.8 is already in `web/package.json` and exports
both `hoverTooltip` and `activateHover`.

**Pointer and keyboard, because §12 claims part 3 adds no accessibility item.** `hoverTooltip` serves the
pointer; one F-key binding in `lsp-nav.ts`'s `navKeymap` calls `activateHover` at the caret and serves the
keyboard. A pointer-only language feature would be the item §12 says part 3 does not add, so this is the
cheapest way to keep that section true rather than amend it. The key is chosen under `navKeymap`'s own
rule — an F-key, which vim's normal mode does not bind — and the plan verifies the specific key is
reachable in Chromium before taking it (§14.4).

**The markup kind is negotiated, and the answer is authored once.** `initialize` reads
`capabilities.textDocument.hover.contentFormat` into a flag on `Server`, exactly as it already reads
`hierarchicalDocumentSymbolSupport` and `positionEncodings`; the LSP crate renders core's structured
`HoverAnswer` to markdown or to plaintext from that flag. The web client advertises plaintext, so `web/`
needs no markdown renderer for a tooltip and no hand-rolled subset of one; Neovim advertises markdown and
gets a fenced signature. Neither rendering is a second copy of the words.

`Hover.range` carries the resolved construct's span, converted through `doc.index.range` as
`documentSymbol` already converts its own.

### §8.7 Two tests in the tree pin hover's absence

Both must change, and the second is not a changed assertion:

- `initialize_advertises_full_sync_and_formatting` asserts `caps.hover_provider == None`.
- `an_unhandled_request_gets_method_not_found_and_an_unhandled_notification_gets_silence` uses
  `textDocument/hover` **as its example** of a method this server does not handle. It needs a different
  method — the test is about the `(_, Some(id))` arm, not about hover, and swapping the assertion would
  delete its subject.

**asm's rows are served but not reachable in the app until part 5**, for §5.1's reason: there is no asm
editor to hover in. They are written and tested at the server (§11.2) so part 5 inherits a proven language
rather than an untested one.

**λ's silence is a designed gap, not a defect, and the umbrella says so first.** `term.rs`'s `LambdaTerm`
carries a de Bruijn `Node`, a `maxfree` and a `depth`, and no span on any variant — the only provenance
anywhere is an `Option<NodeId>` on `App`, which points into the Core AST, not into the `.rxlambda` text.
So there is nothing to resolve a document position against. `language.rs` already records the same fact
for navigation and holds `Language::Lambda.nav` to answering `None`. It is recorded here so that a future
reader finds the reason rather than filing a bug, and so that the test suite asserts *empty* for λ hover
rather than omitting the case — a test that should be sabotage-verified, since a fixture that would
produce a hover under any fallback is the only way to show it can fail.

## §9 The vim keymap

`@replit/codemirror-vim` 6.4.0, in a CodeMirror `Compartment`, switched by a *keymap* setting —
*default* or *vim* — in the settings menu part 2a built. The umbrella's §5 calls vim "a keymap
compartment", and a compartment is exactly what lets the setting change without rebuilding the editor.
It exports `vim(options?: { status?: boolean }): Extension`, `Vim`, `getCM` and `CodeMirror`, and the
extension is the whole of what this part uses.

**Two costs this section understated, both found pricing 3b.** First, the package peer-depends on
**five** CodeMirror packages and `web/package.json` has three of them — `@codemirror/language` and
`@codemirror/search` are new, so the keymap adds three dependencies rather than one. Second, there is
**no `Compartment` anywhere in the repository today**, and there are **two editor construction sites**
rather than one: `scratch-editor.ts` builds the λ and TM copies, `main.ts` builds the source editor from
its own inline extension list. Both are bare array literals with no reconfiguration path. So "a keymap
compartment" is a change to both lists plus the first reconfiguration mechanism the app has had.

**The colourer does not share that compartment, and a draft of this paragraph said it should.** A
compartment exists to swap an extension *after* the editor is built, which is what a keymap setting
needs and what a colourer does not: §6's colourer is one `ViewPlugin` installed at construction whose
own state changes — it holds no decorations until its grammar resolves, and it recomputes them on every
viewport and document change thereafter. Reaching for a compartment there would be a reconfiguration
mechanism standing in for an async field. Both construction sites gain two entries; only one of them is
a compartment.

**vim owns keys inside a focused editor.** One rule, stated once:

- While an editor has focus and the keymap is *vim*, vim receives `Esc` and every normal-mode key.
- App shortcuts reachable inside an editor take a modifier, so they cannot collide with a normal-mode
  key. **This clause is true of the three bindings that exist and is NOT a general guarantee** — see
  below.
- Outside an editor, nothing changes — the app's keys behave as they do today in both keymaps.

**`vim()` contributes no keymap at all, and the placement this section implied would have been wrong.**
It yields four extension parts — two `PrecExtension`, a `ViewPlugin` carrying `domEventHandlers`, and a
`StateField` — and competes at the DOM-event-handler level rather than through the keymap facet. Its
`keydown` returns `undefined` and calls `preventDefault()` only when vim consumed the key, and
CodeMirror treats `defaultPrevented` as handled; so ORDER decides, and unmapped keys fall through. A
draft of this section said to place the compartment before `keymap.of([...defaultKeymap,
...historyKeymap])`, which is both the wrong mechanism and, because both editors open with
`navKeymap`, the wrong position — it would have sat below the first `keymap.of(...)`. The slot goes
above **every** `keymap.of(...)`.

**And that is what bounds the second clause.** Sitting above every keymap means vim wins any key it
maps, including modifier combinations it binds itself — `<C-c>`, `<C-r>`, `<C-o>` and others. The app's
three in-editor bindings survive because vim binds none of them, which was checked rather than assumed:
`F12` appears nowhere in the shipped package. So "a modifier cannot collide" holds for today's three and
would not hold for an arbitrary future `Mod-<letter>`. Anyone adding a fourth in-editor binding has to
check it against vim's own table, not against this sentence.

**The escape-hatch cost, measured from the server rather than from the build:** `vim()` is loaded
eagerly even when the setting is *default*. nginx sends the app's main chunk as **245,583 bytes** with
it and **194,446** with it stubbed out — **+51,137 on the wire, on every visit including every visit
that never uses vim**. A dynamic `import()` behind the setting would recover it. Not taken here,
recorded so the next reader does not have to measure it again.

**Those replace 205,915 / 162,487 / +43,428, for the reason §7 gives.** Those were the build's own
`gzip` on its own output; `deploy/nginx.conf` sets `gzip on` with no `gzip_comp_level`, so a user is
served level 1 and a larger file. The old delta was not wrong about the comparison — both sides used
one method — only about the size of what it compared. `gzip -1` is close enough to look like a
shortcut and is not one: on this chunk it reads 245,491 against nginx's 245,583, so both figures above
come from `curl` against the running image, and both sides were rebuilt from this tree so the
difference is the stub's alone (§14.3).

**Against what a visit actually pulls, that is 5%, not 26%.** A cold load fetches **1,008,253** bytes
of the app's own assets on the wire — **1,278,557** counting the five webfonts — and **646,564** of
that is the two Rust `.wasm`. The keymap is **5.1%** of the first. It is +26.3% of the main chunk, and
the main chunk is not what a user waits for.

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
| A document is over the colour ceiling | That document shows uncoloured, one notice saying which. **Diagnostics keep running**, deliberately — the paragraphs below say why. Editing, compiling and running are untouched. |
| `format` on an unparseable buffer | Nothing visible. `Language::format` returns `None`, which arrives as JSON `null`, and the client normalises it to no edits (§5.2). |
| A definition or reference in no open view | The notice line says the target is not open. No view is created. |

**The diagnostics half of that fourth row was designed, never built, and should not be.** This section
promised "no colour and no diagnostics"; part 3b shipped the colour half, and the notice it shows
already says only *"… is showing uncoloured: this document is too large to colour"*. The two halves do
not share a mechanism. Colour parses **on the main thread**, where §14.1's 8.1 ms at 103,028 units grows
into a per-keystroke stall, and that is the whole reason `colour.ts` has a `COLOUR_CEILING_UNITS` at
all. Diagnostics run **in the LSP worker**: on a 6,164,376-unit TM, just past the ceiling, `didChange` →
`publishDiagnostics` costs **135.2 ms**, and the main thread's entire share of that is the **0.238 ms**
`structuredClone` carrying the text into the worker (§14.2). Not even a string traversal is added —
both editors already call `doc.toString()` once per edit for the recompile and hand `changeDocument`
the same value. So a ceiling here would cap latency on another thread rather than a freeze. The
precedent is not exact, and saying so is the point: the twenty-three timeout ceilings `lsp-client.ts`
and `lsp-nav.ts` both cite could never fire at all, where this one could. What the two share is the
root — a guard sized from a cost that was reasoned about instead of measured.

**The case is reachable, which is why the row is corrected rather than deleted.** `MAX_SCRATCH_TM_BYTES`
guards `tm_scratch` in `crates/redextape-wasm/src/session.rs`, which is the session's scratch buffer;
nothing in `web/` limits the length of text typed or pasted into an editor, and `COLOUR_CEILING_UNITS`
reuses that number only to stop colouring. A document this size can reach an editor. What §14.2 settles
is what it costs when one does.

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
- **colour** — each of the three editors carries `.tok-*` classes from its own grammar, and the computed
  colour on one of them is the palette's, not a default (3b). Asserting the class alone would pass on a
  class no stylesheet styles.
- **hover** — source and TM answer, λ answers empty (3c). Two rows carry more than the feature: a **TM
  rule in a file carrying an error diagnostic still hovers**, which is §8.3's property and the hover
  sibling of `definition_in_a_broken_file_still_answers`; and λ's empty answer is **sabotage-verified**,
  per §8.7. The keyboard path gets its **own** row rather than leaning on §11.1: that gate walks buttons,
  and a keybinding is not one — `lsp-navigation.test.ts` presses `F12` itself, and the hover key follows
  that file's precedent rather than the class-level test's.

**asm is tested at the server, not in the app**, because it has no editor until part 5. A node test
drives `LspServer.handle` over asm text for diagnostics, format and hover, so part 5 inherits a proven
language rather than an untested one.

### §11.3 The grammar differential is what catches ABI and build drift

A browser fixture asserts that web-tree-sitter, loading the committed `.wasm`, produces the same
captures that `redextape-grammar-check` already holds the grammars to in Rust. That crate exists, it
reads raw query matches and projects them to `TokenClass`, and it is the authority this test borrows
rather than a second one.

**The authority cannot be called from a browser, and an earlier draft of this section did not say how it
would be reached.** `redextape-grammar-check` compiles the four `src/parser.c` into itself through a
`build.rs` and `cc`, and binds each grammar's raw `tree_sitter_*` symbol; there is no wasm build of it and
no `Language::load` in it. So the Rust side emits and the browser side compares: a Rust test writes a
tracked golden fixture holding, per language and per program, the offset-ordered `(span, TokenClass)`
sequence `captures` produces, and the browser test recomputes the same sequence from the committed `.wasm`
under web-tree-sitter and asserts equality. The same Rust test verifies the committed fixture rather than
only writing it, so CI fails on a stale one without needing to write anything.

**The shape both sides must produce is already fixed by the Rust one**, and it is not the raw capture
list: `captures` collects into a map keyed by byte range, requires two captures on one range to agree, and
returns one entry per range in offset order — the same shape and unit as `classify_source`, which is what
makes the existing Rust differential an equality rather than a reconciliation. The browser side collapses
its captures the same way or the comparison is not the one this section claims.

**This is the test that fails if the ABI moves**, if the pinned CLI is bumped, or if a committed
`.wasm` no longer matches its `grammar.js` — the last of which §7's manifest gate also catches, from the
other side. It does **not** stand behind the capture→`TokenClass` map, because after §6.1 there is no
second copy of that map to disagree with: `web/` reads the same four tables over the wasm boundary.

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
| How to ship part 3 | one spec, three PRs — 3a served-today, 3b colour and vim, 3c hover | one PR; two PRs with hover inside 3b; LSP whole including hover in 3a; colour first |
| Capture → colour | the four per-language `CAPTURE_CLASSES` tables move to core and cross the wasm boundary | one merged table; a hand-written TS mirror held equal by a drift test |
| §11.3's authority | a Rust test emits and verifies a tracked golden captures fixture the browser test reads | calling `redextape-grammar-check` from a browser, which its `cc` build makes impossible |
| Source colouring | tree-sitter replaces `classify_source` in `web/` | keeping `classify_source` for source; tree-sitter with `classify_source` as fallback |
| Source diagnostics | the LSP worker serves all four; `analyze` path deleted | keeping `analyze` synchronous for source; `analyze` as a first paint the LSP supersedes |
| Wasm layout | two artefacts, a new `redextape-lsp-wasm` crate | one combined artefact, saving 68 KB gzipped |
| Grammar `.wasm` | committed, gated on a `parser.c` hash **and** the artefact's own hash | built in CI; built at web build time; committed ungated; the `parser.c` hash alone; a rebuild-and-compare gate CI cannot run |
| Query scope | viewport ranges only | whole document; parsing only the viewport |
| Over the ceiling | uncoloured and undiagnosed, with one notice | parse in a worker; no ceiling |
| Hover | source, TM, asm; λ empty by design | source only; all four via printed-form spans; defer hover entirely |
| Where hover's knowledge lives | resolvers **and** words in `redextape-core`; `redextape-lsp` marshals | core exposes spans and the LSP crate writes the sentences; the asm table in core and the rest in the LSP crate |
| TM hover on a broken file | **never reads `TmDocument::machine`** — a rule re-parses its own line, a state counts its rule lines, so both rows answer | rule hover silent when the machine is `None`; machine first with a line fallback |
| The 24 mnemonics | authored rows beside `MNEMONICS`, arity derived from `Shape` | the table in `redextape-lsp` with `MNEMONICS` made `pub`; deriving all 24 from `Instr`'s doc comments, which give one sentence for nine spellings |
| A `Bool` literal's hover | its type and the `1`/`0` it lowers to | its type alone; dropping `Bool` from the row |
| A builtin's hover | signature computed from `type_env` via `ty::show`, plus one authored line | signature alone, which cannot say `head` faults on nil; authored prose alone, which leaves arity implicit |
| Hover's reach in the app | pointer **and** an F-key calling `activateHover` | pointer only, which would add the accessibility item §12 says part 3 does not |
| Hover markup | negotiate `contentFormat`, render one structured answer both ways | plaintext always; markdown always with a hand-rolled renderer in `web/` |
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
| 37.1 ms / 67.5 ms / 82,464 | parse, whole-document query, captures — TM, 229,181 bytes | the same probe, on `emit fact.rxt --lang tm` with `fact(3)`. **This row read 22.9 ms / 39.4 ms**, contradicting §6.2's own re-taken table two sections above it — the counts were never wrong (they pass no range), but these timings were carried over from the pre-doubling runs instead of being re-taken alongside the corrected counts. Reconciled to §6.2's table |
| 130.0 ms / 221.8 ms / 292,547 | the same — TM, 814,207 bytes | the same probe, on `emit --lang tm --encoding binary` with `fact(6)`. **This row read 80.9 ms / 159.8 ms**, the same stale-carry-over as the row above |
| 0.65 ms / 897, 0.56 ms / 773 | viewport query, first 60 lines of each | `query.captures(root, { startIndex: 0, endIndex: units * 2 })`. **The `* 2` is load-bearing and was absent from every earlier run of this probe**, which is why this row read 0.27 ms / 420 and 0.21 ms / 340 — half the window each time. §6.2 |
| about 974 ms | parse extrapolated to 6,100,000 bytes | 130.0 × 6,100,000 ÷ 814,207, linear. **This read "about 600 ms"**, computed from the same stale 80.9 ms this table's row above has now dropped — recomputed from the re-taken 130.0 ms |
| 6,100,000 | `MAX_SCRATCH_TM_BYTES` | `grep -rn 'MAX_SCRATCH_TM_BYTES' crates/redextape-wasm/src/session.rs` |
| 0 ms, 300 ms | what a `didChange` actually waits for — the source editor sends one per keystroke, the λ and TM editors send on the recompile's own timer | `main.ts`'s source `updateListener` calls `changeDocument` undebounced; `scratch-editor.ts`'s `#schedule` uses its injected `debounceMs`, which is `compile.ts`'s `DEBOUNCE_MS`. **This row read "100 ms, 300 ms — `lint.ts`'s lint delay"**, and part 3a deleted `lint.ts`: the 100 ms was `@codemirror/lint`'s PULL-side delay, and there is no pull any more |
| 0.15 / 0.05 / 0.06 / 4.57 / 14.58 ms | `didChange` → `publishDiagnostics`, five runs each, source / λ / asm / TM 229 KB / TM 814 KB | a Node probe driving `LspServer.handle` with the correct `languageId` |
| 135.2 ms | that, MEASURED just past the ceiling rather than extrapolated to it | §14.2, which also re-took the 814,207-byte row this one was scaled from. **This row read "about 109 ms"** — 14.58 × 6,100,000 ÷ 814,207, linear — and the path is mildly superlinear, so the extrapolation came in 24% low |
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

### §14.1 Figures added by 3b's pre-flight, 2026-09-21

Taken after 3a merged, while pricing 3b. Four of them changed a decision above; the rest are the counts
the plan's code has to be right about.

| Value | What | Produced by |
|---|---|---|
| 16,684 / 2,514 / 17,079 / 8,081, totalling 44,358 | the four `.wasm`, rebuilt independently of the build that first produced §14's row | `.tools/tree-sitter build --wasm --docker -o grammars/<g>/<g>.wasm grammars/<g>` for each, then `stat -c%s`. The figures reproduce to the byte |
| `33d9a74347ba77afbdd854a7f05c5a96a08c9dec4cb5fa19f4db09f1671eb35d` | the mini-language `.wasm`'s SHA-256, **identical across two builds**, the second after deleting the artefact and writing to a different output filename | `sha256sum` after each build. This is what §7's second hash column rests on |
| 82,464 / 897 | whole-document and 60-line-viewport captures, TM at 229,181 bytes | a Node probe: `Parser.init`, `Language.load`, `parser.parse`, `new Query`, `query.captures(root)` and `query.captures(root, { startIndex: 0, endIndex: units * 2 })`. This row read 420 until the doubling was found; the whole-document count passes no range and was never affected |
| 15 | `LANGUAGE_VERSION`, web-tree-sitter 0.27.0's newest supported ABI | the same probe. The grammars generate 15, so the pin and the runtime meet exactly, with no headroom in either direction |
| `hasError` false, four of four | a clean parse in every language | the same probe, over `redextape emit` output. A fixture here is emitted rather than typed, because emitted output **cannot** be syntactically wrong. An earlier draft of this row justified that by claiming hand-written TM and asm parse with `hasError` true; **that was an overgeneralisation from two fixtures whose syntax I had guessed at**. `redextape-grammar-check`'s own hand-typed TM corpus parses with `hasError` false, and its tests assert as much. The rule is right; the reason given for it was not |
| 11 / 5 / 11 / 9 | rows in `CAPTURE_CLASSES` for the mini-language, λ, TM and asm | `mini.rs`, `lambda.rs`, `tm.rs`, `asm.rs` in `crates/redextape-grammar-check/src/` |
| 3 | capture names the four tables disagree on — `@function`, `@variable.parameter`, `@label.reference` | comparing those four tables, row by row. §6.1's table |
| 14 / 14 / 8 | `TokenClass` variants, `.tok-*` classes in `style.css`, palette colour tokens | `analysis.rs`'s enum; `style.css`'s rule block; `palettes.ts`'s `COLOUR_TOKENS`. Seven of the fourteen classes collapse onto `--tok-neutral`. This row read 7 tokens and eight collapsing until part 3b gave `Binder` a token of its own: the λ grammar reaches `Binder`, `Ident` and `Punct` and nothing else, and with `--tok-ident` equal to `--fg` and `--tok-punct` equal to or beside `--tok-neutral`, a λ editor had two colours for three classes |
| 24 | asm mnemonic spellings hover must cover, against 16 `Instr` variants | `MNEMONICS` in `crates/redextape-core/src/tm/asm_syntax.rs` |
| 5 | builtin names, none carrying a description | `BUILTIN_NAMES` in `crates/redextape-core/src/prelude.rs` |
| 2 | CodeMirror peer packages `@replit/codemirror-vim` 6.4.0 needs that `web/package.json` does not have — `@codemirror/language`, `@codemirror/search` | its `peerDependencies` against `web/package.json`'s `devDependencies`. §9 named one new dependency; it is three |
| 4 | extension parts `vim()` yields — two `PrecExtension`, a `ViewPlugin` with `domEventHandlers`, a `StateField` | flattening `vim()`'s return in Node. **No keymap facet among them**, which is why §9's placement instruction was wrong |
| 4 | packages the keymap adds, not three — `@replit/codemirror-vim`, `@codemirror/language`, `@codemirror/search`, and `@replit/codemirror-vim-core` transitively | `pnpm add` plus the installed `package.json`'s `dependencies` |
| 205,915 / 162,487 / +43,428 | the app's main chunk under the BUILD's own `gzip` with `vim()`, with it stubbed out, and the difference | `pnpm build:app` twice, gzipped chunk size each time. **Superseded by §14.3**: nginx compresses at level 1, so what is served is 245,583 / 194,446 / **+51,137**, and the served delta is 18% larger than this one. The comparison these expressed was sound — one method on both sides — the quantity was not the one a user pays. §9 |
| 209,613 / 83,464 | `web-tree-sitter`'s own runtime `.wasm`, raw and gzipped — the FIFTH wasm colouring needs, and larger than all four grammars together | `stat -c%s` and `gzip -c \| wc -c` on `node_modules/web-tree-sitter/web-tree-sitter.wasm`. §7 |
| 7 | `.wasm` files in the built image under `/usr/share/nginx/html/assets/` — two wasm-pack artefacts, four grammars, one runtime | `docker build` then `docker run` and listing the directory. The plan said six; it forgot the runtime |
| 82,464 / 416 | whole-document captures against ONE REAL VIEWPORT'S, measured in a Chromium tab running the app rather than in Node — 198x | a temporary browser test mounting the app, forking a TM pane, pasting the 229,181-byte fixture, reading the editor's real `visibleRanges` (`[0, 1208]`, set by `.term-editor`'s `max-height: 8lh`) and querying through `colour.ts`'s own registry. **The whole-document count reproduces the Node figure exactly**, which is what says the grammar has not drifted |
| 0 | occurrences of `F12` in the shipped vim package | a grep of its `dist`, which is what makes §9's third clause true for today's three in-editor bindings rather than assumed |
| 2 | editor construction sites, not one — `scratch-editor.ts`'s and `main.ts`'s inline list | both are bare array literals; there is **no `Compartment` anywhere in the repo** today, so §9's is the first |
| UTF-16 code units | the unit of `node.startIndex` and of `QueryOptions`' `startIndex`/`endIndex` | a browser probe parsing `(λx. λy. x)` — 11 UTF-16 units, 13 UTF-8 bytes — whose root `endIndex` is **11**. So the tree-sitter path needs none of `spans.ts`'s `byteToIndex` conversion, which `classify_source`'s byte offsets do need. A conversion applied anyway would mis-place every span after the first non-ASCII character |
| 8.1 ms / 0.4 ms | full versus incremental reparse, 103,028-unit TM, Chromium, median of seven | a browser probe: `parser.parse(doc)` against `tree.edit(...)` then `parser.parse(edited, tree)`, the edit placed 40 units from the end. §6.2 |
| 12.8 ms / 32,591 | whole-document query and its captures, same document, same browser | the same probe, `query.captures(root)` |
| 293 | captures for that document's first viewport, 1,272 units at a 400 px editor height | the same probe. Its time is **below the browser's coarsened `performance.now()` resolution**, so no figure is quoted for it. **This row read 88**, half its window, until the `QueryOptions` doubling above was found; `web/src/colour.ts`'s header and the plan's own pre-flight both quote 293 and note the 88 explicitly, and this table — the authority both of them cite — was the one still carrying the halved figure |
| 0 → 293 | decorations in the DOM before and after the grammar resolves, under a `ViewPlugin` | a browser probe mounting a real `EditorView` over that fixture and dispatching an empty transaction when `Language.load` settles. **This row read 0 → 88**, the same halved figure as the row above |
| 3 of 4 | grammar `.wasm` a production build emits as hashed assets — **λ's is inlined as a `data:` URI instead** | a scratch Vite 8.2.1 build importing λ's and TM's with `?url`: TM landed at `dist/assets/tree-sitter-redextape-tm-CU9tyEhY.wasm`, λ did not appear as a file and `data:application/wasm;base64,` appears in the bundle. λ's grammar is 2,514 bytes, under Vite's default `assetsInlineLimit` of 4096; the other three are 16,684 / 17,079 / 8,081 and are over it |

### §14.2 The diagnostics ceiling, measured — 2026-09-22

§10 promised a ceiling on diagnostics as well as on colour, and part 3b built neither. This table is
what says not to build one. Node again, against a `wasm-pack --target nodejs` build of
`redextape-lsp-wasm`, so these are comparable to §14's rows and to nothing in a browser.

| Value | What | Produced by |
|---|---|---|
| 6,164,376 | the fixture, in bytes and in UTF-16 units alike — real emitted output, 1.05% past the 6,100,000 ceiling | a generated program of `fact` plus nine helpers, then `redextape emit <prog> --lang tm --encoding binary`. Emitted rather than synthesised because the fixture has to parse, and `redextape run` on it prints `49`. **The argument to `fact` does not size the output**: `fact(6)` and `fact(7)` both emit 814,207 bytes, so the fixture is grown by adding functions, not by counting higher |
| 16.0 ms | `didChange` → `publishDiagnostics` on the 814,207-byte TM, median of nine | a Node probe driving `LspServer.handle` — `initialize`, `didOpen`, then `didChange` carrying the full document text, which is the shape `lsp-client.ts`'s `changeDocument` sends. **This row is the instrument check**: §14's figure for the same document is 14.58 ms, so this probe agrees with the one that produced it |
| 135.2 ms | the same, at 6,164,376 units, median of nine (128.1 low, 158.2 high) | the same probe. 24% above §14's `about 109 ms` extrapolation, and 12% above a linear scaling of this table's own 16.0 ms |
| 127.6 ms | `didOpen` → `publishDiagnostics` at that size | the same probe, on its first message after `initialize` |
| 0.238 ms | `structuredClone` of the whole `didChange` message at that size, median of twenty | `node -e` over the message `changeDocument` builds. **This is the main thread's entire share of the diagnostics path**, and §14's 0.512 ms for a bare string of the same order agrees with it |
| 1, 0 | diagnostics reported for a broken 40-byte TM, and for that same text under `languageId: redextape_x` | the same probe, run as two controls before the timings. **The emitted fixtures report zero diagnostics, which is correct and is also exactly what a probe doing nothing reports** — §14's own footgun. Only these two controls separate the cases |
| 0 ms, 300 ms | what a `didChange` waits for, per editor | §14's corrected row above. `lint.ts`'s 100 ms is gone with the file |
| nothing | what stops a document this size reaching an editor | `MAX_SCRATCH_TM_BYTES` guards `tm_scratch` in `crates/redextape-wasm/src/session.rs` — the session's scratch buffer, not editor text. No length gate on typed or pasted text exists in `web/`, and `colour.ts`'s `COLOUR_CEILING_UNITS` reuses the number only to stop colouring |

### §14.3 The vim keymap on the wire — 2026-09-22

§14.1 priced the keymap with the build's own `gzip`. Every other cost figure on this branch is now what
nginx sends (§7), and that is a different number. Both sides below were built from the same tree into
the same image and served by the same nginx, so the difference is the stub's and nothing else's.

| Value | What | Produced by |
|---|---|---|
| 245,583 / 685,600 | the main chunk with `vim()`, served and raw | `docker build` from this tree, `docker run`, then `curl -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}'` against `/assets/index-<hash>.js`, and the same `curl` without the header |
| 194,446 / 546,895 | the same chunk with `vim()` stubbed — the import dropped and `keymapExtension` returning `[]` on both arms | the same three commands against an image built from the same tree with only that edit. The stubbed chunk holds **0** occurrences of vim's own mode strings (`normal-mode`, `visualBlock`, `vim-mode`) against the baseline's **54**, which is what says the stub removed the package rather than something else |
| +51,137 | what the keymap costs on the wire, on every visit including every visit that never uses vim | 245,583 − 194,446. §14.1's `+43,428` used the build's own `gzip` on both sides: a sound comparison of a quantity nobody is served, 18% under this one |
| 245,491 against 245,583; 245,343 against 245,430 | `gzip -1 -n -c` against what nginx sends, on this chunk and on the previously built image's | **`gzip -1` is NOT a faithful stand-in, and it was checked before being trusted rather than after.** `deploy/nginx.conf` sets `gzip on` with no `gzip_comp_level`, so nginx is at level 1 — and it still undershoots by 87 and 92 bytes. Every figure in this table comes from the server |
| 1,008,253 / 1,278,557 | what a cold load pulls on the wire — the app's own assets, then the same counting the five webfonts | one `curl` per asset over the set a real cold load fetches. That set comes from the browser: `performance.getEntriesByType('resource')` on the page, **plus the two `.wasm` the workers fetch, which the page's own timeline does not contain**. The keymap is 5.1% of the first figure |
| 646,564 | the two Rust `.wasm` inside that, served | the same per-asset `curl` — `redextape_wasm_bg` at 318,119 and `redextape_lsp_wasm_bg` at 328,445 |
| 245,583 and 94,777 | the browser's own `encodedBodySize` for the main chunk and for `web-tree-sitter.wasm` | the same `performance.getEntriesByType('resource')` call. **The instrument check**: the first reproduces this table's `curl` to the byte, and the second reproduces §7's 94,777 to the byte |
| 153 | wire bytes by which the image `redextape:3b` differs from this tree's main chunk | that image serves 245,430; `2d9a710` changed `palettes.ts` after it was built. Both sides above were re-taken from this tree rather than reusing that number, which is why neither is 245,430 |

### §14.4 Figures read while designing 3c — 2026-09-22

Read at `0bd07c5` (#104, 3b's squash merge). These are counts and facts about the tree, not timings:
nothing in 3c's design rests on a measurement yet, and the two that it will are named at the foot of
this table as the plan's to take.

| Value | What | Produced by |
|---|---|---|
| 24 / 9 / 16 | `MNEMONICS` rows, those marked `// Bin`, and `Instr` variants | `grep -c '^    ("' crates/redextape-core/src/tm/asm_syntax.rs`; `grep -c '// Bin$'` on the same file; the variant count in `asm.rs`'s `pub enum Instr`. **The nine are why §8.4's table is authored per spelling**: `Instr::Bin`'s one doc comment reads `rd <- ra op rb` for all nine |
| decimal only | the radix a source `Nat` literal can be written in | `lexer.rs` takes digits with `is_ascii_digit` and nothing else; `grep -n 'from_str_radix\|radix' crates/redextape-core/src/lexer.rs` is empty. So §8.5's hex and binary renderings are informational and cannot be typed back |
| `1` / `0` | what `true` and `false` become in a register | `Core::Bool(_, b) => ctx.emit(Instr::Li(dst, u64::from(*b)))` in `crates/redextape-core/src/tm/lower_asm.rs`. Read rather than assumed — the `Bool` row had nothing to say until this was looked up |
| `ty::show`, public | how a builtin's signature renders, with no new code | `crates/redextape-core/src/ty.rs`; `show` is `pub` and its own test round-trips it against `parse_ty`, so §8.5's signatures are held to the typechecker's table rather than to a copy |
| 0 | readers of `BUILTIN_NAMES` anywhere in `crates/` | `grep -rn 'BUILTIN_NAMES' crates/ --include='*.rs'` — four hits, all inside `prelude.rs` itself, three of them in a comment. §8.5 keeps it at zero by looking builtins up in `type_env` |
| private, not `pub(super)` | `MNEMONICS`'s actual visibility | `grep -n 'enum Shape\|^const MNEMONICS\|fn shape_of' crates/redextape-core/src/tm/asm_syntax.rs` — `Shape` and `shape_of` carry `pub(super)`, `MNEMONICS` carries no modifier at all. **§8.1 and §8.2 both said `pub(super)` and both were wrong**, caught by Task 1's reviewer checking a forward-looking doc claim against the tree. §8.2's argument is unaffected and slightly stronger: a private const is less reachable than a `pub(super)` one, so the table's placement is decided the same way |
| `pub(crate)` | `parse_for_nav`'s visibility, unchanged by 3c | `crates/redextape-core/src/parser.rs`. §8.2's placement is what makes this a non-change: a hover written in `redextape-lsp` would have needed this plus `MNEMONICS`, `Shape` and `instr_parts` made `pub` |
| private, machine-free | `parse_rule_line`'s visibility and what it reads | `crates/redextape-core/src/tm/syntax.rs` — it takes `(line, span)`, returns a `RawRule`, and names no `Machine`. This is §8.3's "second source", and it existed before §8 said there was none |
| 2 | tests that pin hover's absence and must change | `grep -rn hover crates/redextape-lsp/src/` — `initialize_advertises_full_sync_and_formatting`'s `hover_provider == None`, and `an_unhandled_request_gets_method_not_found_and_an_unhandled_notification_gets_silence`, which uses `textDocument/hover` **as its example** and so needs a different method rather than a different assertion (§8.7) |
| `hoverTooltip`, `activateHover` | both exported by `@codemirror/view` 6.43.8, already a dependency | the export list in `web/node_modules/@codemirror/view/dist/index.d.ts`, against `web/package.json`. **Hover adds no package to `web/`**, where §9 found the keymap added four |
| 2 | browser test files that press `F12` themselves | `grep -rln 'F12' web/tests/` — `lsp-navigation.test.ts` and `lsp-copy-diagnostics.test.ts`. §11.2 first said the hover key was covered by §11.1's class-level control gate; **that gate walks buttons, and a keybinding is not one**, so the row was corrected to follow these two files instead |

**Both figures §14.4 left open were taken before any code was written, and one of them was then
taken again against the code.** The plan's pre-flight measured the `.rxt` parse at 3.55 ms and chose
no cache; §14.5 re-measures the function that actually shipped and corrects what that figure covers.
The F-key probe pressed F1, F2, F4, F8 and F9 through `userEvent` and all five reached the editor,
with a positive control (`ArrowDown`) and a negative one (`F7`, never sent); `F2` was chosen because
Chromium binds nothing to it. **What that probe cannot show is written into the binding's own comment
rather than left implicit**: Playwright injects keys through CDP at the renderer, so browser-chrome
bindings never apply in a test, and the choice of key is what covers that half rather than the check.
`Document::nav`'s 33.25 ms — the figure that motivated caching it — was measured on a `.tm` and is the
reason that cache exists, not a number 3c reuses.

### §14.5 What `rxt` actually costs, measured against the code rather than modelled — 2026-09-22

§14.4 left the `.rxt` parse for the plan to measure, the plan measured `parse_for_nav` alone at
3.55 ms, and **that figure is right for one of hover's two source paths and 2.5x low for the other.**
Task 3's reviewer found the reason: `hover::rxt` calls `parse_for_nav` for its AST walk and then
`binder::nav_rxt`, which runs `parse_for_nav` a second time internally. A literal hover returns before
that second parse; a name hover pays both.

| Value | What | Produced by |
|---|---|---|
| 3.67 ms | `hover::rxt` at a LITERAL — one parse, returns before `nav_rxt` | a temporary `#[test]` in `hover.rs`, 8,500 `fn`s / 185,896 bytes, median of 9, release. **This is the instrument check**: §14.4's 3.55 ms for `parse_for_nav` alone reproduces here, which is what says the probe and the earlier one measure the same thing |
| 9.12 ms | `hover::rxt` at a NAME — `parse_for_nav`, then `nav_rxt`, which parses again | the same probe, at a call site in the same fixture. Both probe points assert `is_some()` first, so neither timing is the cost of returning `None` |

**The decision §14.4 recorded does not change, and that is the only reason this is a corrected figure
rather than a defect.** 9.12 ms native for a pointer-rest tooltip is imperceptible, and no cache is
warranted at either figure. What changes is what the design may claim: "the parse a hover adds" is
one parse for a literal and two for a name.

**The mechanism is worth recording because this project keeps meeting it.** The 3.55 ms probe measured
`parse_for_nav`, standing in for a `hover::rxt` that did not exist yet — an instrument modelling the
function it measures cannot notice that the function does something else. It took a reviewer reading
the shipped code to see the second parse, and a re-measurement of the real function to price it.

**A single-parse `rxt` is available and is NOT taken here.** `nav_rxt` is four lines over
`parse_for_nav` plus a `Binder` walk, so a `nav_from_program(&Program)` extraction would let `rxt`
parse once and would halve the name row. It is declined for the reason §14.4 declined the cache:
there is no user-facing problem at 9.12 ms, and an optimisation with no symptom is one this part does
not need. Recorded so the next reader does not have to re-derive it.

### §14.6 The second parse was priced against the wrong baseline — corrected at whole-branch review, 2026-09-22

**§14.5 priced the second parse against a single parse and never against a cache that already
existed one crate up, and that is what the whole-branch review corrected — not the 3.67 ms / 9.12 ms
figures themselves, which are right for what they measured.** Both numbers come from calling
`hover::rxt` directly, with nothing behind it: 3.67 ms for one `parse_for_nav` at a literal, 9.12 ms
for that same parse plus `nav_rxt`'s own internal second one at a name. §14.5's "no cache is
warranted at either figure" weighed that against the cost of adding a NEW cache. It did not weigh it
against the cache `redextape-lsp` already has: `document.rs`'s `Document::nav` — the index
`definition`, `references` and `document_symbol` all reach through `locate` — caches the identical
`NameIndex` `nav_rxt`/`parse_tm_nav`/`parse_asm_nav` build, once per document VERSION rather than
once per REQUEST, for a reason its own doc comment prices at 33.25 ms to rebuild against
`LineIndex::new`'s 0.26 ms on a real emitted machine. `hover::rxt`'s second parse was paying a
smaller version of exactly that cost, on every keystroke's worth of hover requests, for a document
that had already built the answer.

**The fix threads that cache through instead of adding a second one.** `Language::hover` gains a
third parameter, `nav: Option<&NameIndex>`; `lib.rs`'s `hover` passes `doc.nav.as_ref()` — the same
field `locate` reads — and `hover::rxt`, `hover::tm` and `hover::asm` all take the same parameter and
use it in place of calling `nav_rxt`, `parse_tm_nav` or `parse_asm_nav` themselves. `hover::rxt`
keeps its own `parse_for_nav` call: the literal and arity rows walk the AST directly (§8.1), and
`Document` caches no parsed `Program`, only the index built from one. What the fix removes is only
the parse `nav_rxt` was repeating on top of that.

**No answer changes, on any document this server ever had open — a claim checked rather than
assumed.** `locate` returns `None` exactly when `Document::nav` is `None`. `Language::nav` answers
`Some` unconditionally for `Tm` and `Asm`; it answers `None` only for `Lambda` (whose `Language::hover`
arm is already a hard-coded `None`, never reaching core) and for a `.rxt` document over `MAX_TOKENS`
(where `hover::rxt`'s own `parse_for_nav` call already hits `Completeness::Refused` and returns
`None` before the passed-in `nav` is ever read). So the cases where `nav` arrives as `None` are
exactly the cases hover already answered `None` in.

**What the fix removes, once a document is open and its cache is warm:**

| Form | Before, per hover request | After |
|---|---|---|
| `.tm` / `.asm`, name row | a full `parse_tm_nav`/`parse_asm_nav` — the same rebuild `Document::nav` prices at 33.25 ms on a large file | zero; `doc.nav` is read, not rebuilt |
| `.rxt`, name row | two parses of `src` — `hover::rxt`'s own, then `nav_rxt`'s internal one; 9.12 ms at §14.5's fixture | one parse — the same one the literal row always paid |
| `.rxt`, literal row | one parse | unchanged; this row never called `nav_rxt` |

§14.5's decision not to extract a single-parse `nav_from_program` stands: that was about collapsing
`hover::rxt`'s OWN two parses into one, which reuse makes unnecessary from a different direction —
the second parse is now a cache read, on every document this server tracks, not a rarer win for a
`.rxt` file specifically.

