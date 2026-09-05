# `redextape-lsp` — a language server for all four text forms — design

**Slice 1 of the LSP track.** Diagnostics and formatting for `.rxt`, `.rxlambda`, `.tm` and `.asm`,
served to an external editor over the Language Server Protocol, plus the comment retention in
`redextape-core` that makes formatting safe on hand-written files.

The consumer this is built for is **Neovim**. The web UI is a later phase and is served only
indirectly, by a crate layout that keeps the request handling free of transport.

Two PRs:

| PR | what | touches |
|---|---|---|
| A | Comment retention for the TM and asm text forms | `redextape-core` |
| B | The `redextape-lsp` crate and its Neovim wiring | new crate, `plugin/redextape.lua` |

PR A goes first: PR B's formatting handler is one call into whatever PR A lands, and a change to
`redextape-core` reviewed on its own is a change reviewed.

---

## §1 What is missing, verified against the tree — as of `ebb1970`

**Nothing serves an external editor anything but colour.** The four tree-sitter grammars under
`grammars/` and `plugin/redextape.lua` give Neovim highlighting and filetype detection for all four
forms. That is the whole of it: no diagnostics, no formatting, no navigation.

**The analysis to serve already exists, and it is uniform.** All four front ends return the same
spanned `Diagnostic` type:

| form | entry point | returns |
|---|---|---|
| `.rxt` | `analyze` | `Analysis` |
| `.rxlambda` | `parse_lambda` | `(Option<LambdaTerm>, Vec<Diagnostic>)` |
| `.tm` | `parse_tm_full` | `(Option<Machine>, Option<TmHeader>, Vec<Diagnostic>)` |
| `.asm` | `parse_asm_full` | `(Option<Program>, Option<AsmHeader>, Vec<Diagnostic>)` |

`Diagnostic` carries a `Span`, a `Severity` and a message. `Span` is a half-open byte range into the
source. Every printer needed for formatting exists too, and each has a header-preserving form:
`format`, `print_lambda`, `print_tm_with`, `print_asm_with`.

**So slice 1 adds no analysis.** It is a transport over functions that are already written, already
tested, and already consumed by the CLI and the web UI.

### §1.1 The one thing that is not safe today, and it is the reason PR A exists

**Formatting a hand-written `.tm` or `.asm` file destroys every comment in it.**

`lex` collects `.rxt`'s line comments into a `Vec<Comment>` rather than discarding them, and says
why at the site: a `print ∘ parse` formatter over an AST that never saw them would delete every
comment in the file. That reasoning was applied to one of the four front ends.

The TM and asm parsers strip theirs. `Machine` has nowhere to hold a comment and neither does
`Program`, so `print_tm_with(parse_tm_full(src))` returns text with the comments gone. The round-trip
guarantee stated in `tm::syntax`'s module docs is `parse_tm(print_tm(m)) == (Some(m), [])` — it is
**printer-first**, and it says nothing whatever about authored text. Nothing in the tree is wrong;
the guarantee simply does not cover the direction a formatter runs in.

This lands hardest exactly where hand-writing is most plausible. A machine listing is unreadable
without comments, and `tests/tm_header.rs` already turns a checked-in 464-line fixture into a
`Value` — that file is the size of thing a person would annotate.

### §1.2 λ needs no comment work, and this was checked rather than assumed

`parse_lambda`'s module docs enumerate the characters that terminate an identifier — `\`, `λ`, `.`,
`(`, `)` — and name no comment marker. `grammars/tree-sitter-redextape-lambda/grammar.js` has no
comment rule, where the other three grammars each have several.

**The λ text form has no comment syntax.** There is nothing to retain, so PR A covers two forms and
not three.

---

## §2 PR A — comment retention for the TM and asm text forms

### §2.1 The constraint that shapes everything: `Machine` and `Program` gain no field

Three independent reasons, and they agree.

1. **The rule is already stated and already held structurally.** `lower_tm` states that `Machine`
   gains no field for the header, twice; `tm::header` does not import `Machine` at all, so the rule
   holds at the import level rather than by convention. A comment field would be the first breach.
2. **`print_tm`'s output is pinned byte-identical** by the pre-existing listing golden. A machine
   that came out of `lower_tm` has no comments and must print exactly as it does today. Comments must
   not enter the compiler's output path.
3. **`.rxt` already solved this, as a side channel.** `lex` returns comments as a third tuple
   element beside the tokens and the diagnostics — not as AST nodes. PR A is that decision applied to
   the two front ends that did not get it.

### §2.2 A document type per form

```rust
/// A .tm file as authored: the machine, its optional header, and the comments that
/// travel with neither.
pub struct TmDocument {
    /// `None` exactly when an error-severity diagnostic was reported, matching what
    /// the tuple this replaces already returned.
    pub machine: Option<Machine>,
    pub header: Option<TmHeader>,
    pub comments: Vec<AnchoredComment<TmAnchor>>,
    pub diagnostics: Vec<Diagnostic>,
}

/// A comment recovered from authored text, positioned by what it sits against rather
/// than by where it was.
pub struct AnchoredComment<A> {
    /// Owned, so a document prints without the source it came from.
    pub text: String,
    pub anchor: A,
    /// True when only whitespace separates the comment from the previous newline.
    /// Decided at parse time, where the backward scan is already in reach — the reason
    /// `token::Comment` gives for deciding it there, applied to a second front end
    /// rather than restated.
    pub own_line: bool,
}

/// Where a TM comment attaches. Every variant names a line `print_tm_inner` emits,
/// which is what makes the set total and the round trip possible.
pub enum TmAnchor {
    Tapes,
    Start,
    Directive(TmDirective),
    State(StateId),
    Rule { state: StateId, index: usize },
    Eof,
}

/// One variant per line `write_header` emits, in the order it emits them.
pub enum TmDirective { Version, Encoding, Width, Slots, Result, Tape(usize) }
```

**This enum gained `Tapes` and `Directive` after the design was first written**, by reading
`print_tm_inner` and `write_header` line by line instead of describing them. A single `Header`
variant cannot carry a comment trailing one directive among six, and the leading `tapes <n>` line is
not a header directive at all — it is the one line every `.tm` file has.

`AsmDocument` and `AsmAnchor` are the same shape over asm's line kinds: `Result`, `Label(usize)`,
`Instr(usize)` and `Eof`, indexed by position in `Program::labels` and `Program::code`. See §10 for
why that set is total and why `Label` is indexed rather than named.

**The anchor is structural, not positional, and that is the whole design.** `token::Comment` holds a
`Span` because `.rxt`'s formatter walks tokens and can order a comment against them. The TM printer
walks a `Machine` — it never sees a token — so a byte offset into the *old* text cannot tell it where
to write in the *new* text. Naming the line the comment belongs to is what survives reformatting.

**The text is owned rather than borrowed.** A document that needs its original source in hand to
print is not a document, and the LSP's formatting handler is `print(parse(text))` with nothing else
in scope.

### §2.3 What changes and what does not

**Unchanged, with their call sites untouched:** `print_tm`, `print_tm_with`, `print_asm`,
`print_asm_with`, `parse_tm`, `parse_asm`. Measured at `ebb1970`, that is 44 call sites on the two
narrow parsers and 62 on the four printers that do not move, and it is what keeps the byte-identical
golden green.

**Changed:** `parse_tm_full` and `parse_asm_full` return `TmDocument` and `AsmDocument` instead of a
3-tuple — 33 and 16 call sites respectively, measured, and predominantly tests.

**Added:** `print_tm_doc(&TmDocument) -> Option<String>` and
`print_asm_doc(&AsmDocument) -> Option<String>`. `None` exactly when the document has no machine or
program, which is exactly when it carried an error — a formatter has nothing to write for a file
that does not parse, and saying so with `None` is what lets a caller leave the buffer alone rather
than replace it with something. It is also the shape `LanguageSupport::format` wants in §3.2.

A struct rather than a wider tuple, for a reason this slice can already name: the round after this
one adds navigation, and a struct's next field costs no call site at all where a fifth tuple element
costs all 49 again.

### §2.4 The guarantee this adds

Today: `parse_tm(print_tm(m)) == (Some(m), [])`, for every machine `validate()` accepts that also
declares `tapes <= MAX_TAPES`.

Added: `print_tm_doc(parse_tm_full(print_tm_doc(parse_tm_full(x))))` equals
`print_tm_doc(parse_tm_full(x))` — **formatting is idempotent**. Formatting a file once may change
it; formatting it again changes nothing.

**THIS WAS `parse_tm_full(print_tm_doc(d)) == d` UNTIL A PROPTEST DISPROVED IT, AND THE DISPROOF IS
THE MOST USEFUL THING IN THIS SECTION.** The strict round trip is false, and it is false for exactly
the files this PR exists to serve. `write_header` labels tapes 0-4 via `tape_name` — `; reg`,
`; work`, `; stack`, `; heap`, `; box` — emitting one whenever that anchor carries no authored
trailing comment. So a document parsed from hand-written text with no comment on its `tape 0` line
prints **with** `; reg`, and reparsing that output yields an
`AnchoredComment { text: "reg", anchor: Directive(Tape(0)), own_line: false }` that was never in the
original. `d` and its round trip differ by a comment the printer invented.

**Nothing in the tree could have caught this, and the reason is worth keeping.** The header tests pin
printed bytes and never reparse; the first version of the round-trip property used a header-less
skeleton and generated comments that all landed on `Eof`, so it exercised roughly one of a dozen
(anchor, `own_line`) combinations and never met a `tape` line at all. The property was strengthened
to range densely over every anchor and both `own_line` values **because a review said it was weak**,
and it went red on the first run of the strengthened form. A property that cannot reach a construct
proves nothing about that construct, however many cases it runs.

**Why idempotence is the right statement rather than a retreat.** After the first print the label is
in the text; reparsing records it as an authored trailing comment; on the next print the displacement
rule above suppresses the generated label and writes the authored one — the same bytes. The generated
path and the authored path converge, which is what makes the second print stable. That convergence is
a property of the displacement rule, so the two rules in this section hold each other up rather than
sitting side by side.

**And idempotence is what a formatter actually needs.** "Running the formatter twice differs from
running it once" is the defect a user meets; "a hand-authored document is not a fixed point of the
printer" is ordinary — every formatter changes a file the first time it touches one.

**What the property also asserts, and what it must not.** The `machine` and the `header` survive a
print-and-reparse: `parse_tm_full(print_tm_doc(d))` agrees with `d` on both. **The comments survive
too, and the guarantee about them is one-directional rather than absent.** Every comment in `d`
reappears in the reparse — as a sub-multiset, so two identical comments cannot collapse into one. What
fails is only the converse: the reparse may hold a `; reg` label the first print fabricated and `d`
never carried, so *equality* is false where *survival* is not.

**This paragraph read "the comments do not [survive]" for one round**, which says comments may be
lost — the opposite of what this whole PR guarantees — and it was written in the round that corrected
the previous wrong sentence in the same section. The distinction that was missing is the direction:
excluding `comments` from the comparison entirely left the property unable to see a printer that
stably dropped every one of them, measured as passing on 400,000 of 400,000 clean documents. The
one-directional assertion closes that and is true on every one of them.

**That distinction was itself once written here as a tautology.** This paragraph read: *"the document
round trip does hold from the first print onward: `parse_tm_full` of the once-printed text and of the
twice-printed text agree in `machine`, `header` and `comments`."* Once byte-level idempotence holds,
those two texts are the same string and `parse_tm_full` is a pure function, so that comparison cannot
fail — and the tests stating it compared a value with itself. Nothing then related the printed output
to the original parse at all, so a printer that stably dropped every comment, or the whole header,
would have satisfied the property. The assertions that replaced it are each shown able to
fail, by **three different sabotages** — and saying so took a correction, because this sentence first
credited one sabotage with all three.

Removing `write_header`'s call reddens the **header** assertion and nothing else: the case aborts
there, and the machine is built from `tapes`, `start` and the states, which still print. No-op'ing
`CommentWriter`'s emission reddens the **survival** assertion **while byte-level idempotence stays
green** — a stable loss prints the same bytes twice. Dropping the `accept` keyword reddens the
**machine** assertion while idempotence is likewise blind, on every one of 196,068 documents carrying
an accept state.

**A sabotage that reddens an assertion proves less than a sabotage that reddens one assertion while
leaving another green.** The first shows a test can fail. The second shows which test carries the
weight, and that its neighbours are not carrying it for it — which is the question this section got
wrong twice.

The clean-parse clause is load-bearing rather than tidy, **and the reason first written here was the
wrong one.** It argued that a document carrying diagnostics reprints to text that parses clean, so its
round trip returns a document with an empty `diagnostics` and fails equality — an argument from a
`diagnostics` comparison the restated property does not perform. The real reason is stronger: **every
diagnostic under `crates/redextape-core/src/tm/` is `Severity::Error`** (there is no `Severity::Warning`
anywhere in that module), so any diagnostic at all leaves `machine: None`, `print_tm_doc` returns
`None`, and there is nothing to print twice. The clause does not exclude documents that would compare
unequal; it excludes documents that cannot be printed at all.

**A second exclusion is not a clause but a diagnostic, added because the guarantee was false without
it.** A duplicate `tapes` or `start` line used to parse clean while attaching a second *trailing*
comment to the same anchor — `TmAnchor::Tapes` and `TmAnchor::Start` are each named from a family of
lines rather than from one line — and `CommentWriter::trailing` joins several trailing comments with
`" ; "`, a join that is not a fixed point when a body is empty. `print_once` and `print_twice` then
differ, and the sequence then holds that second value forever — there is no third. (An earlier
version of this paragraph said "stabilising only from the third print", counting the first print that
equals its predecessor rather than the number of distinct values; reconstructing the case by hand
yields exactly two, for `Start` as well as `Tapes` and for any number of empty trailing comments.) `parse_tm_full` now
reports `duplicate \`tapes\` line`
and `duplicate \`start\` line`, on the rule `HeaderParts::directive` already stated for
`duplicate tape {i}`. That also closes a defect older than this branch: `tapes 1` followed by `tapes 5`
silently yielded a five-tape machine, and `start q0` followed by `start q1` silently started at `q1`.

**This is the property the formatter's safety rests on.** It is stated as a proptest over generated
documents, plus a deterministic test that exercises every anchor and both `own_line` values, because
a proptest whose strategy a reader has to trust and a deterministic test that demonstrably covers the
space are worth more together than either alone.

**CORRECTED WHILE WRITING PR A'S PLAN — this paragraph asked for a diagnostic that has nothing to
report.** It read: *"Comments that cannot be anchored are a diagnostic, never a silent drop. A `;`
comment in a position the printer has no line for is reported at its span."* Reading the two parse
loops dissolved the case. Comments are recovered **only from lines that parse**, so every recovered
body is by construction the rest of a line after `;` — it cannot contain a newline, and `;` runs to
end of line so it cannot reopen the line it sits on. There is no unanchorable comment for a
diagnostic to name.

**What replaces it is the rule that makes the case impossible.** A file carrying an error yields no
machine, so nothing will print it, and a partial recovery from a half-parsed file would be a value
nothing can be right or wrong about — as well as the one shape in which an anchor could name a line
the printer never emits. Comments ride with a machine or not at all, pinned by
`a_file_with_an_error_recovers_no_comments` in each form's test file.

**The printer already writes comments of its own, and that collision is real rather than
theoretical.** `write_header` labels tape 0 `; reg` and tape 1 `; work` via `tape_name`, and the
checked-in fixture `crates/redextape-core/tests/fixtures/list_1_2.tm` carries `; reg` on its `tape 0`
line today. Two comments on one line reparse as one — `; reg  ; mine` yields a single body
`reg  ; mine` — so an authored trailing comment on a `tape` line **displaces** the generated label
rather than joining it. The author's line wins: a generated label is a convenience, and somebody who
wrote their own has said what they want the line to say. The roadmap's note that these labels are
unreachable is true of `; stack`, `; heap` and `; box` and false of the two that matter — **and this
PR narrows even that remaining truth to compiler-produced text.** The note's premise was that STACK,
HEAP and BOX always start empty and `TmHeader::new` drops empty tapes, which holds while
`print_tm_with` over a compiler-built header is the only producer of `.tm` text. `print_tm_doc` over
`parse_tm_full` is a second producer, and its header comes from whatever an author wrote: a parsed
`tape 2` (or `tape 3`, `tape 4`) line with non-empty cells survives `TmHeader::new`'s empty filter,
so it reprints with `; stack` (or `; heap`, `; box`) exactly as `; reg` and `; work` do. All five
labels are reachable from authored text; the roadmap's note stays true only of the compiler-produced
`.tm` text the tree-sitter differential corpus consists of.

---

## §3 PR B — the `redextape-lsp` crate

### §3.1 Layout

```
crates/redextape-lsp/
  Cargo.toml       lsp-server, gen-lsp-types, serde, serde_json, redextape-core
  src/main.rs      stdio, the initialize handshake, hand off     — thin, uncovered
  src/lib.rs       Server::handle(&mut self, Request) -> Response — pure, covered
  src/document.rs  open documents, one LineIndex per version
  src/position.rs  Span <-> Position under both encodings
  src/language.rs  Language, LanguageSupport, four impls
```

**The split is not stylistic.** It is what makes the workspace's 90% line-coverage merge gate
reachable with a new crate in the tree, and it is what lets the web phase reuse the handler: a pure
`Request -> Response` needs no stdio, no threads and no channels, so a wasm caller can drive the
identical code. `lsp-server` appears in `main.rs` and nowhere else.

### §3.2 Language dispatch

```rust
trait LanguageSupport {
    fn diagnostics(&self, src: &str) -> Vec<Diagnostic>;
    fn format(&self, src: &str) -> Option<String>;
}
```

Four implementations, resolved from the LSP `languageId`.

**The `languageId` is already the filetype, and the filetype is already this repository's.**
`plugin/redextape.lua` registers exactly `redextape`, `redextape_asm`, `redextape_lambda` and
`redextape_tm`, and Neovim sends the buffer's filetype as `languageId`. So dispatch is a four-arm
match on strings the repository already owns — no extension sniffing in the server, and no second
place where "which language is this" gets decided.

An unrecognised `languageId` is answered, not assumed: the document is tracked and every
language-specific request returns empty rather than guessing a front end.

### §3.3 Capabilities in slice 1

| capability | value | why |
|---|---|---|
| `textDocumentSync` | `FULL` | These files are small. Incremental sync is an optimization that buys a class of bugs before it buys anything else. |
| `documentFormattingProvider` | `true` | All four forms, once PR A lands. |
| diagnostics | push (`publishDiagnostics`) | Universally supported; pull diagnostics are a 3.17 addition this slice does not need. |
| `positionEncoding` | negotiated | §4. |

### §3.4 Dependencies, and why these

`lsp-server` for transport. Its entire dependency list is `crossbeam-channel`, `log`, `serde`,
`serde_derive`, `serde_json` — and notably no LSP types crate, since it hands over
`Request { id, method, params: serde_json::Value }` and lets the caller choose the type layer. Three
reasons it fits here: the workspace contains no async at all and the work being served is a
synchronous pure function; a synchronous handler is far easier to hold at the coverage floor than an
async one; and `crossbeam-deque`, `-epoch` and `-utils` are already in `Cargo.lock`.

`gen-lsp-types` for the message types, generated from Microsoft's official LSP MetaModel.
**rust-analyzer merged the switch to it from `lsp-types` on 2026-06-24**, citing missing `Eq` and
`Hash` derives, incomplete enum variants and URI interop bugs in the hand-written crate. That
argument is this repository's own convention about a hand-maintained second copy of a shape defined
elsewhere, arriving from outside. It is edition 2024, matching the workspace, and its non-optional
dependencies are `serde` and `serde_json`, both already present.

`tower-lsp` was not considered past the version check: last release 2023-08-11.

---

## §4 Position encoding

`Span` is a byte offset. LSP positions are `(line, character)`, and `character` is counted in UTF-16
code units unless the client and server agree otherwise.

**Negotiation, not a fixed choice.** The server reads
`InitializeParams.capabilities.general.positionEncodings`, prefers `utf-8` when offered, falls back
to `utf-16`, and echoes the result in `ServerCapabilities.positionEncoding`. A client that sends no
list gets `utf-16`, which is the protocol's default and therefore the only correct fallback.

Measured on the target editor rather than assumed: Neovim advertises
`{ "utf-8", "utf-16", "utf-32" }`. So the intended consumer takes the path where a byte column *is*
the character column and no re-encoding happens at all.

A `LineIndex` is built per document version — line-start byte offsets, binary-searched to turn a byte
offset into a line and a byte column. Under `utf-8` the work stops there. Under `utf-16` it counts
code units across the line prefix.

**The test that earns its place uses `λ`.** It is two bytes, one UTF-16 code unit and one codepoint:
three different numbers for one character, in the form named after it. A diagnostic anchored past a
`λ` on its own line must yield *different* columns under the two encodings, and a test asserting both
numbers from one source is what shows the encoder is doing something. A test asserting one number
shows nothing — the shape of assertion this repository has already been caught by, where a
budget-based check was blind to a pass that spent no budget.

---

## §5 Neovim wiring

Added to `plugin/redextape.lua`, beside the filetype registration it already carries:

```lua
vim.lsp.config("redextape", {
  cmd = { server_cmd() },
  filetypes = FILETYPES,
  root_markers = { "redextape.toml", ".git" },
})
vim.lsp.enable("redextape")
```

- **`filetypes = FILETYPES` reuses the table already in that file.** One list. The same discipline
  `check-lua.sh` enforces between the parser names and the C symbols they must match.
- `server_cmd()` resolves `<ROOT>/target/release/redextape-lsp` first, then the name on `PATH`. When
  neither exists it skips `vim.lsp.enable` and warns once, naming both remedies — the shape the
  missing-parser `vim.notify` in that file already uses, so this is consistency rather than a new
  idea.
- **A user's configuration needs no change.** `{ "Davey-Hughes/redextape", lazy = false }` remains
  the whole of it, which is the property the file's own header states as its reason for existing.
- Format-on-save through `conform.nvim`, for those who route formatting there, is one entry:
  `redextape = { lsp_format = "fallback" }`. Not required — `vim.lsp.buf.format()` works without it.
- `ROOT` is already resolved in that file from the script's own path, so nothing is hardcoded and a
  lazy.nvim clone, a manual clone and a development checkout all work without knowing which they are.

---

## §6 Tests

**Handlers are called directly.** `Server::handle` takes a constructed `Request` and returns a
`Response`; the tests assert on that. No process spawn, no stdio, no sleeping, no timing. This is
what holds the workspace coverage gate — `cargo llvm-cov nextest --workspace --fail-under-lines 90`,
measuring ~95% at `ebb1970` — with a new crate present.

**And exactly one test does spawn the binary.** A test that only calls `Server::handle` never
exercises `main.rs`, and would pass with the JSON-RPC framing broken. This repository has paid that
bill in the adjacent file: every early check of the Neovim plugin supplied the `FileType` autocmd the
plugin itself lacked, and three green verifications produced no colour. So one integration test runs
the real binary over pipes — `initialize`, `didOpen`, assert a `publishDiagnostics` notification
arrives with the expected span — and it is the only test permitted to know that stdio exists.

Named tests:

- **`format_preserves_every_comment`** — a `.tm` and an `.asm` fixture, each with an own-line comment,
  a trailing comment, and a comment against every anchor variant. Formats, and asserts each survives
  against the right line. Sabotage: drop one anchor arm from the printer and confirm the test reddens.
- **`round_trip_over_documents`** — proptest for §2.4.
- **`printer_output_is_unchanged`** — the existing listing golden, run unmodified. PR A must not move
  it.
- **`positions_differ_by_encoding`** — §4's `λ` test, both numbers, one source.
- **`a_file_with_an_error_recovers_no_comments`** — §2.4's rule, replacing the
  `unanchorable_comment_is_a_diagnostic` this spec first asked for.
- **`an_authored_comment_takes_the_tape_line_over_the_generated_name`** — §2.4's displacement rule,
  over the checked-in fixture that carries a generated label.
- **`server_binary_speaks_the_protocol`** — the one spawning test above.
- **`unknown_language_id_is_answered`** — §3.2's fallback, asserted rather than assumed.

---

## §7 Rejected approaches

**`tower-lsp-server` or `async-lsp`.** Both are maintained and both are reasonable libraries. Both
bring an async runtime into a workspace that contains no async, to serialize access to a synchronous
pure function. The concurrency is not needed and the coverage cost is real.

**`lsp-types`.** 34M downloads and no release since 2024-06-04, covering LSP 3.16 with 3.17 behind a
feature flag. The crate rust-analyzer just left, for reasons that apply here unchanged.

**Hand-rolled JSON-RPC.** The framing, the shutdown protocol and cancellation are boring and easy to
get subtly wrong, and getting them wrong presents as an editor that silently stops responding.

**A `redextape lsp` subcommand rather than a second binary.** One binary to install is a real
advantage, and it was rejected because it puts a transport's dependency tree into the CLI, which is
the crate a user installs to compile a program. The roadmap has named the binary `redextape-lsp`
since Plan 1.

**Comment fields on `Machine` and `Program`.** §2.1.

**Formatting the three lossy forms anyway, documented.** Silent destruction of hand-written content,
in the files the feature exists to help hand-write.

**Semantic tokens in slice 1.** The four grammars already highlight all four forms in the target
editor, so the server would be a second, competing answer to a solved question. It becomes worth
doing when the web UI wants the server — see §9.

---

## §8 What this slice does not close

- **`classify_lambda` and `classify_tm` over *authored* text still do not exist.** The roadmap names
  both as the LSP-shaped work behind two gaps the tree-sitter differential cannot reach: the `\`
  binder alias, which no printer emits and no comparison entry can contain, and three TM comment
  positions with no differential authority. This slice does not need them, because it advertises no
  semantic tokens, and does not provide them.
- **`analysis` still drops resolved symbols.** Every navigation feature for `.rxt` — go-to-definition,
  references, hover, signature help, workspace symbols — waits on that. It is untouched here.
- **No navigation for any form**, including the parts that are nearly free. Go-to-definition on a TM
  state name is `SourceMap::tm_owner` followed by `SourceMap::source_span`, both of which already
  exist and both of which cross from a machine back to the source construct that generated it. It is
  a slice of its own, not a rider on this one.
- **`web/` is not a consumer.** §9 is why that is a layout decision rather than a promise.
- **Incremental text sync**, deliberately, per §3.3.
- **The λ text form has no comments and gains none.** Not a gap; a property, recorded in §1.2 so it
  is not rediscovered.

---

## §9 The web phase, and what this slice owes it

The web UI does not use this server and this slice does not make it. What it does is keep the option
open at no cost: `Server::handle` is a pure function over `gen-lsp-types` structs, which are plain
serde types, so `web/src/session-worker.ts` could drive the identical handler through wasm with no
transport in the picture. `lsp-server`'s threads and channels — the part that cannot compile to
wasm — live only in `main.rs`.

Whether that is worth doing is a question for a later slice with its own measurement. `highlight.ts`
already renders CodeMirror decorations over `classify_source`'s spans and its own doc comment records
why it chose that over a grammar; a server would be a third answer to a question the web has already
answered twice, and would need to earn it. What this slice must not do is make the choice
impossible — and the layout in §3.1 is chosen so it does not.

---

## §10 Open questions

- ~~**Does the `.asm` text form have an anchor position for a comment following the final
  instruction of a non-final label block?**~~ **ANSWERED while writing PR A's plan, by reading
  `print_asm_mapped` rather than by reasoning about it.** Such a comment is either a trailing comment
  on `Instr(i)` or an own-line comment before `Label(j)`; `Result`, `Label`, `Instr` and `Eof` are
  total over that printer's output and `AsmAnchor` needs no fourth case. `Label` is indexed by
  position in `Program::labels` rather than by name, because several labels may sit at one
  instruction index and the printer reproduces that list's order. The answer lives in `AsmAnchor`'s
  own doc; it is recorded here because this is where the question was asked.
- **Whether `redextape fmt` should grow `.tm` and `.asm` support** now that PR A makes it lossless.
  The CLI's `fmt` currently formats the source form. It is a natural follow-on and it is not in
  either PR.
