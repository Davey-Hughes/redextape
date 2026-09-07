# Navigation for the language server — `definition`, `references`, `documentSymbol` — design

**Slice 2 of the LSP track.** Slice 1 shipped diagnostics and formatting for all four text forms
(PRs #77 and #78) and deliberately shipped no navigation. This slice adds it, for the forms whose
names a parser can already see.

The consumer is still **Neovim**. `web/` remains a non-consumer, served only by a layout that does
not foreclose it.

Two PRs:

| PR | what | touches |
|---|---|---|
| A | Name-span index for `.tm` and `.asm`, and the whole LSP surface over it | `redextape-core`, `redextape-lsp` |
| B | The same three requests for `.rxt`, on a binder-resolution pass | `redextape-core` (`parser`, `analysis`), one dispatch arm |

PR A goes first. It ships the complete server-side surface — three capabilities, three dispatch
arms, and the position arithmetic all of them need — against the two forms whose name resolution is
a flat lookup. PR B then adds a resolution *pass* and a fourth arm to plumbing that is already built
and already tested. The reverse order would settle the LSP-side design against the hardest case and
ship the cheap win last.

This is the shape slice 1 used, and for the same stated reason: the `redextape-core` change is
reviewable on its own.

---

## §1 What is missing, verified against the tree — as of `64c1164`

**The server answers no navigation request, and the capability entries say so.** `Server::initialize`
sets `text_document_sync` and `document_formatting_provider` and leaves the rest at
`ServerCapabilities::default()`. `redextape-lsp`'s own `initialize_advertises_full_sync_and_formatting`
asserts `semantic_tokens_provider`, `hover_provider` and `definition_provider` are each `None`, with a
comment saying the assertion exists "so that adding one is a deliberate edit to this line" — so
navigation's absence is currently a *tested property*, and this slice is that deliberate edit.

**The blocker is not the protocol half. It is that the parsers do not retain name spans.**

| form | reference spans today | definition spans today |
|---|---|---|
| `.tm` | ✗ — `RawRule` holds `goto: String` and the span of the **whole rule line** | ✗ — the `state <name>:` branch has the line's span, never the name's |
| `.asm` | ✗ — `Instr::Jmp` holds a bare `String` | ✗ — `Program::labels` is `Vec<(String, usize)>`, name and instruction index, no span |
| `.rxt` | ✓ — `ast::Expr::Var` carries `name` **and** its own `span`, which is exactly the occurrence | ✗ — `ast::Stmt::Let`/`Fn`/`Assign` carry a *statement* span; `Fn::params` and `Expr::Lambda::params` are bare `Vec<String>` with no spans at all |

So every form needs span plumbing in its parser. `.rxt` needs one thing more, and §7 is about that.

**`TmDocument` already predicts this slice.** Its doc comment says the struct exists rather than a
wider tuple "because the next field this grows — navigation wants one — costs no call site here and
would cost all of them there." That prediction is discharged here, though not in the shape it
guessed; §2.2 says why the index is not a field.

**And `analysis.rs` dropping resolved symbols was a recorded decision, not an oversight.** The
roadmap's Plan 4 entry reads: *"`analysis.rs` ships semantic tokens only; resolved symbols are
dropped. The LSP is v2 and nothing in v1 consumes symbols. YAGNI."* PR B is the consumer that
discharges that YAGNI. It is cited here because a reader finding `analysis` symbol-less should find
the decision rather than assume a gap.

---

## §2 The index

### §2.1 It mirrors the printer, which already does exactly this

`tm/syntax.rs` contains this pair today:

```rust
pub fn print_tm(m: &Machine) -> String { print_tm_mapped(m).0 }
pub fn print_tm_mapped(m: &Machine) -> (String, Classified)
```

`print_tm_inner` is the one printer; spans are pushed as each piece is appended, "so an offset is
exact by construction and nothing re-scans the output." **`print_tm` therefore builds a `Classified`
on every call and discards it.** The cost of carrying span data alongside the primary output is
already paid, already accepted, and already documented in the file this slice edits.

The parser gets the mirror image:

```rust
pub fn parse_tm_full(src: &str) -> TmDocument { parse_tm_nav(src).0 }
pub fn parse_tm_nav(src: &str) -> (TmDocument, NameIndex)
```

and the same for `parse_asm_full` / `parse_asm_nav`. One parse loop, spans pushed as each line is
scanned, no second scan and — the point — **no second definition of where a name begins**. This is
#79's sniffer decision applied one layer down: the parser is the definition of the language, so
anything that needs to know what a name is asks the parser rather than keeping an agreeing copy.

### §2.2 Why a return value and not a field on `TmDocument`

A field would be the smaller diff and would match the doc comment quoted in §1 word for word. It is
rejected for one reason that is decisive and one that is not.

**Decisive: the index must outlive a failed parse, and the documents must not.** `parse_tm_full`
returns `TmDocument { machine: None, header: None, comments: Vec::new(), .. }` the moment any
error-severity diagnostic exists, and `parse_asm_full` does the same. §4 explains why navigation
takes the opposite rule. An index field on a struct whose every other field is emptied on error
would be a field with a contract opposite to its container's — reachable, but a shape a reader has
to be told about rather than one they can see.

**Secondary: one type, two forms.** `.tm` and `.asm` have the same flat name space and want the same
queries, so one `NameIndex` serves both and PR B reuses it. Two document structs would grow two
fields of one type, which is not wrong, only redundant.

### §2.3 `crates/redextape-core/src/nav.rs`

```rust
/// Every name occurrence in one document, in source order.
pub struct NameIndex {
    occurrences: Vec<Occurrence>,
}

pub struct Occurrence {
    /// The name as written. Not a slice of the source: the index outlives the borrow.
    pub name: String,
    /// The span of the NAME, not of the line or statement that contains it.
    pub span: Span,
    pub role: Role,
}

pub enum Role {
    Definition,
    Reference {
        /// Index into `occurrences`. `None` when nothing in this document defines the
        /// name — see §3.3: `.asm` never checks jump targets, so `jmp nowhere` is a
        /// clean parse carrying a dangling reference.
        def: Option<usize>,
    },
}
```

Queries, all total and all `O(n)` or better over a document a human wrote:

| method | answers |
|---|---|
| `at(offset) -> Option<(usize, &Occurrence)>` | the occurrence whose span contains a byte offset, **and its index** |
| `get(i) -> Option<&Occurrence>` | the occurrence at an index |
| `definitions() -> impl Iterator<Item = &Occurrence>` | `documentSymbol` |
| `definition_of(i) -> Option<usize>` | the definition occurrence `i` names — itself when `i` is a definition, its link when `i` is a reference, `None` when the reference dangles |
| `references_to(def: usize) -> impl Iterator<Item = &Occurrence>` | every reference whose `def` is that index |

**CORRECTED AGAINST THE SHIPPED CODE.** This table first read `at(offset) -> Option<&Occurrence>` and
carried a `resolve(&Occurrence) -> Option<&Occurrence>` that was never built. The queries are keyed by
INDEX rather than by occurrence reference, because `references_to` needs a definition's index and
comparing occurrences by identity to recover one is a worse API than returning it from `at`. So
`resolve` became `definition_of` plus `get`.

### §2.4 The `def` link is designed one PR ahead of its need, deliberately

For `.tm` and `.asm` the name space is flat, so `references_to` could match on `name` and the link
would buy nothing measurable. It is built anyway because **`.rxt` has shadowing and name-matching is
not merely slower there, it is wrong**: in `let x = 1; let x = x + 1;` the `x` on the right-hand side
is bound by the *first* `let`, and a name-keyed index answers "both" to a question that has one
answer.

The cost in PR A is three passes over the occurrences in `NameIndex::link` — build the map, collect the links, apply them — the split being what keeps the borrow checker satisfied without cloning.

**CORRECTED AGAINST THE SHIPPED CODE.** This paragraph first said the linking "reuses" the
`ids: HashMap<String, StateId>` that `parse_tm_full` already builds to resolve `goto` targets. It does
not, and should not: `ids` exists only in the `.tm` parser, and `.asm` has no equivalent, so reusing it
would have given the two forms two different linking mechanisms. `link` builds its own map over the
occurrences and serves both. The benefit is that PR
B extends `nav.rs` rather than changing a published type. This is the one place in the design that
looks past PR A's own need, and it is called out rather than smuggled.

**What PR B will still have to add, so it is not read as already handled:** `Role::Definition` carries
no kind. `.tm` and `.asm` need none — the form determines it (§5.3) — but `.rxt` definitions are
`fn`s, `let`s and parameters, which are three different `SymbolKind`s that the language alone cannot
distinguish. PR B adds that discriminant. It is not pre-built here because PR A cannot test it.

---

## §3 What counts as a definition and a reference

### §3.1 `.tm`

| construct | role |
|---|---|
| `state <name>:` | definition |
| `start <name>` | reference |
| `goto <name>` in a rule line | reference |

Duplicate state names are already an error — `parse_tm_full` pushes ``duplicate state name `{name}` ``
— but the index records **both** definitions regardless, because §4's rule is per-line and an error
elsewhere does not unmake a `state` line that parsed. `definition` on a reference then answers the
first, and `documentSymbol` lists both, which is what an editor should show for a file that really
does contain two.

### §3.2 `.asm`

| construct | role |
|---|---|
| `<name>:` | definition |
| the `Label` operand of any instruction | reference |

**The label operand is found through `Shape::kinds()`, not through a list of mnemonics.** `MNEMONICS`
maps each mnemonic to a `Shape`, and `Shape::kinds()` returns the operand kinds in order —
`OperandKind::Label` marks the position. Today that is `jz` (`Shape::RL`, second operand), `jmp` and
`call` (both `Shape::L`, first). Writing those three into `nav.rs` would create a second table to
keep in agreement with `MNEMONICS` by hand; deriving from `kinds()` means a fourth label-taking
mnemonic is navigable the day it is added, with no edit here.

`result` is a directive and not a label. `parse_asm_full` already draws that line, and does it in an
order that matters — the label check runs first so that a label legitimately named `result` is not
swallowed by the directive branch — with `resultset` as a checked-in regression. The index inherits
that decision by being built inside the same branch rather than beside it.

### §3.3 `.asm` references can dangle, and that is not an error state

`parse_asm_full` validates mnemonics and operand arity. It does **not** check that a label operand
names a label that exists — `Instr::Jmp` keeps the name as a `String` and resolution happens later,
in lowering. So `jmp nowhere` parses with no diagnostic at all.

`Role::Reference { def: None }` is therefore an ordinary value, not a failure. `textDocument/definition`
on it answers **`null`**, which LSP defines and which an editor renders as "no definition found".

**CORRECTED AGAINST THE SHIPPED CODE**, which says `null` here and in §5.1, which first read
"answer empty" in two places — and the first pass at this correction changed only one of them, in a
paragraph asserting it had covered §5.1. An incomplete correction claiming its own completeness is
the same defect one layer up, and it is recorded rather than quietly finished. The two are not interchangeable for `documentSymbol`, where an empty array is a
positive claim that the document defines nothing; `null` is the absence of an answer. Answering all
three requests the same way is what keeps the distinction legible. Reporting an error here would be this slice inventing a diagnostic the asm front end has
chosen not to emit.

`.tm` differs: an unresolvable `goto` **is** diagnosed, as ``unknown goto target `{name}` ``. The
index shape is the same in both forms anyway, because §4 lets a `goto` be recorded before the state
it names has been read.

---

## §4 Per-line recovery, and the precedent it does *not* follow

**The rule.** A line that parses contributes its occurrences to the index. A line that does not
contributes nothing. The index is returned regardless of what is in `diagnostics`.

**The consequence, stated rather than worked around.** `parse_rule_line` reads a rule's pieces left
to right and reaches `goto` last, so a rule line that fails on its moves loses its `goto` occurrence
even though the name is plainly there in the text. That follows from the rule; the alternative is a
salvage path that guesses at the structure of a line the parser has just rejected, which is a second
grammar again.

**This diverges from how `comments` behaves, and the divergence is the design.** Comment recovery is
all-or-nothing across the whole document: both parsers discard every recovered comment if any
diagnostic exists anywhere, and `asm_syntax`'s own comment says so — "whether `comments` survives at
all is decided in exactly one place: this check."

That is right for comments and wrong for navigation, because the two feed different consumers:

- **Comments feed the printer.** A `TmDocument` with `machine: None` is never printed, so a partial
  comment recovery would be a value nothing can be right or wrong about — and, as that same comment
  notes, could name an anchor the printer never emits.
- **The index feeds navigation.** A jump from a `goto` to its `state` is correct on its own terms.
  Nothing else in the file has to be true for it to be the right answer.

And the moment navigation is worth most is the moment the file is broken, because that is what a
file under active editing is. A clean-parse-only index would mean one unbalanced bracket anywhere
disables go-to-definition for the whole buffer.

---

## §5 The LSP surface

### §5.1 Capabilities and dispatch

`Server::initialize` gains three entries: `definition_provider`, `references_provider`,
`document_symbol_provider`. `Server::handle` gains three arms, each a request (never a
notification), so each returns exactly one response:

```
textDocument/definition      -> Option<Location>
textDocument/references      -> Vec<Location>
textDocument/documentSymbol  -> Vec<DocumentSymbol>
```

**Exactly one line of `initialize_advertises_full_sync_and_formatting` changes.** That test asserts
three providers are `None`; only `definition_provider` is one of this slice's three. Its two
neighbours — `semantic_tokens_provider` and `hover_provider` — stay `None` and stay asserted, which
is the whole point of the comment quoted in §1. `references_provider` and `document_symbol_provider`
are not asserted there today and gain assertions here.

**`references` reads `context.include_declaration`.** LSP makes the declaration's own inclusion the
client's choice, not the server's; answering the same list either way would be ignoring a parameter
rather than implementing it.

An unrecognised `languageId` continues to answer `null`, on the rule `Language::from_language_id`
already states. `.rxt` and `.rxlambda` answer `null` too in PR A — see §7 and §9, and §3.3 for why `null` rather than empty.

### §5.2 The one piece that is not free: `Position` → offset

`position.rs` converts **offset → `Position`** (`LineIndex::position`) and nothing else. Every
request in this slice needs the **inverse**: the client sends a cursor as `(line, character)` and the
index is keyed by byte offset.

`LineIndex::offset(&self, text, Position, Encoding) -> usize` is new code, and it inherits
`position`'s contract exactly:

- **Total.** A line past the end clamps to the end of the text; a character past the end of its line
  clamps to that line's end. Never a panic, for the reason `position`'s doc already gives — slicing
  a `str` off a boundary is a panic no clippy lint in this workspace can see, and it would take the
  editor's server down rather than misplace one jump.
- **Encoding-aware.** Under `Utf8` the character column *is* the byte column and nothing is
  re-encoded. Under `Utf16` it means walking the line's chars accumulating `len_utf16` until the
  target is reached, and a column landing inside a surrogate pair resolves to that character's start.

The round trip `offset(position(o)) == o` holds for every `o` on a character boundary, and that is
the property PR A tests rather than a table of hand-computed columns.

### §5.3 `SymbolKind` is the LSP's choice, not `nav.rs`'s

`nav.rs` stays language-agnostic: it knows definitions and references, not what a `.tm` state *is*.
The server already knows the document's `Language`, so it maps — a TM state and an asm label to
their respective kinds — at the one place that has both facts. This is also why §2.4's missing
discriminant is PR B's problem and not a hole in PR A: for the two flat forms the language settles
it.

`documentSymbol` returns a **flat** list, not a hierarchy. Rules could nest under states, but the
demo suite contains a machine of **7,353 states carrying 18,499 rules** — nesting the second under the first is not an outline a human uses. **CORRECTED:** this first read "25,852 states", which is `map_fold`'s ROW count, the two added together. Every pre-existing citation in the tree says *rows*; quoting their sum to argue about nesting one inside the other names neither quantity at issue and inflates the state count 3.5x.

### §5.4 No plugin change is expected

`plugin/redextape.lua` registers filetypes and starts the server; Neovim's `vim.lsp.buf.definition`,
`references` and `document_symbol` dispatch off the capabilities the server advertises at
`initialize`. PR A should confirm this in a real headless Neovim rather than assume it — slice 1's
plan recorded a verification command that silently tested the wrong thing, and the correction was to
open the probe file with `-c 'edit <path>'` after sourcing the plugin.

---

## §6 Testing

**Core, `nav.rs`.** Definitions and references for both forms; the `def` link resolving to the right
occurrence; a broken line contributing nothing; duplicate `.asm` labels both recorded; a dangling
`jmp` yielding `def: None`; an index returned from a document whose `machine` is `None`.

**Core, the derivation in §3.2.** A test that reads the label position out of `Shape::kinds()` for
every entry in `MNEMONICS` rather than asserting the three mnemonics by name — the point of deriving
is lost if the test hardcodes what the code refuses to.

**LSP.** The three requests through `Server::handle`, which is a pure function and needs no process.
`LineIndex::offset` in both encodings, including the `λ` case slice 1 already uses — two bytes, one
UTF-16 code unit, one codepoint.

**Every test gets a sabotage run.** Break the thing the test exists to catch and confirm it goes red.
This is not a formality here: this file's own track has four recorded cases of a green test that
structurally could not reach the case that would have falsified it, and three more that were plan-
authored code no one had compiled. The specific traps to check for in this slice:

- An index assertion that passes because *some* occurrence matched, when the test names a specific one.
- A `definition` test whose fixture has one state, so a link to the wrong definition is unobservable.
- A round-trip position test run only under `Utf8`, where the conversion is the identity.

---

## §7 PR B — `.rxt`, and why it is a different mechanism

`.rxt` needs everything above **plus** a pass that `.tm` and `.asm` do not need at all.

**Span plumbing.** `ast::Expr::Var` already carries the occurrence span, so references are free.
Definitions are not: `Stmt::Let`, `Stmt::Fn` and `Stmt::Assign` carry the span of the statement, and
`Fn::params` and `Expr::Lambda::params` are `Vec<String>` with no span anywhere. The AST grows name
spans, and every construction site in `parser.rs` supplies them.

**Binder resolution, which is the actual work.** Names in `.rxt` are scoped, so an occurrence
resolves to a *binding*, not to a name. Shadowing (`let x = 1; let x = x + 1;`), parameter scope,
block scope and `while` bodies all mean the answer depends on position, and the existing
`analysis.rs` computes none of it — it classifies tokens and drops symbols, by the recorded decision
quoted in §1. This pass is what "teach `analysis` to keep resolved symbols" means, and it is the
reason PR B is its own PR rather than a fourth arm added to PR A.

**Reuse.** The `NameIndex` type, `LineIndex::offset`, the three dispatch arms and the three
capability entries all already exist by then. PR B fills `Role::Definition`'s new kind discriminant
(§2.4), adds `nav_rxt`, and adds one arm to the `Language` match.

---

## §8 What this slice deliberately does not do

- **No `.rxlambda` navigation, in either PR.** `LambdaTerm` is de Bruijn: `Var(u32)` and an `Abs`
  name hint the module doc marks *print-only*. There are no source positions in the term at all, and
  adding them means threading spans through an `Rc`-shared type used by `lower`, `decode`, `encode`,
  `syntax` and `reduce`. Go-to-binder for `.rxlambda` is a real feature and a separate slice.
- **No cross-file or cross-form navigation.** Jumping from a state name in a generated `.tm` to the
  `.rxt` line that produced it is a genuinely different feature, and it is *not* the free rider it
  appears to be: `SourceMap::tm_owner` returns `None` for "any name THIS lowering never produced —
  including every name belonging to some other lowering of the same program", and `SourceMap::source_span`
  returns `None` for a map built by `build` rather than `build_from_program`. An authored `.tm`
  buffer therefore yields nothing unless the server also knows which `.rxt` produced it and at which
  encoding. That is a design question, not a coding task.
- **No rename.** Every occurrence is known once the index exists, so intra-file rename is reachable —
  but it mutates the buffer, needs `prepareRename`, name validity and collision handling, and is the
  first thing in this crate that writes rather than answers.
- **No `documentHighlight`.** Same data as `references`, near-free, and left out only to keep the
  capability count matched to what was asked for. It is the cheapest follow-on named here.
- **No hover, no semantic tokens.** Semantic tokens stay excluded on slice 1's stated ground: four
  tree-sitter grammars already highlight all four forms in the target editor, and the server would be
  a second competing answer.
- **Incremental sync stays `FULL`.** Unchanged and for the reason already recorded.
- **The transport boundary is unchanged and stays gated.** `lsp-server` is named in `main.rs` and
  nowhere else; `git grep -l "use lsp_server\|lsp_server::" crates/redextape-lsp/src` must still
  answer `1`. Nothing in this slice touches transport, and the check is named here so that a review
  can confirm rather than assume it.
