# tree-sitter-redextape-rxm

A tree-sitter grammar for the redextape rxm text form — the flat, line-oriented listing
`redextape_core::tm::rxm_syntax`'s `parse_rxm_full` reads and `redextape_core::tm::print_rxm_mapped`
and `print_rxm_with_mapped` write and classify. One of four grammars in this repository, alongside
`tree-sitter-redextape` (the mini-language), `tree-sitter-redextape-lambda` (the λ form) and
`tree-sitter-redextape-tm` (the TM text form). Scope `source.rxm`, file extension `.rxm`.

**It is for highlighting and it is not authoritative.** `parse_rxm_full` is the parser. One printer,
`print_rxm_with_inner`, writes the text and classifies it in the same pass, and both mapped entry
points call it — there is no separate `classify_rxm`. This grammar produces a CST and never lowers
it into anything.

It colours external editors, which take it as *Installing it in an editor* describes. The web app
does not load it.

## The form, in one page

```
file        := line*
line        := blank | ';' ...            comment, to end of line, after leading whitespace
             | 'result' ' ' TYPE          the whole header; optional; before any label or instr
             | NAME ':'                   a label declaration, at column 0
             | MNEMONIC ['\t' OPERANDS]   an instruction, indented four spaces
OPERANDS    := OPERAND (', ' OPERAND)*
OPERAND     := REGISTER | IMMEDIATE | LABEL     — which one is fixed by the MNEMONIC, not by spelling
REGISTER    := 'rr' | 'r' NAT | 'a' NAT
IMMEDIATE   := '#' NAT
TYPE        := 'Nat' | 'Bool' | 'Unit' | 'List<' TYPE '>'      — `ty::show`, no spaces
NAME        := any non-empty run with no whitespace and no `;` `:` `,`
```

The box is the form as the printer writes it. `parse_rxm_full` reads a wider one: it trims each
line, so it also reads an instruction at column 0, an indented label, a space before a label's `:`
and a space in place of the tab, as this grammar does. *Divergences* lists the spellings it takes
that this grammar does not.

Every line kind also accepts a trailing `;` comment: `parse_rxm_full` splits each line at its **first**
`;` before doing anything else, exactly as `parse_tm_full` does.

Four things about it shaped this grammar:

**1. An operand's kind comes from its mnemonic and never from its spelling.** `Operand`'s own doc says
so — a label named `retry` can never be mistaken for a register — and `parse_instr` reads operands
positionally off `Shape::kinds`. A single generic `instruction` rule cannot express that without
guessing from spelling, which is the one thing both the printer and the parser refuse to do. So there
is **one rule per `Shape`, seven of them** (`nullary_instruction` / `reg_instruction` /
`reg_reg_instruction` / `reg_reg_reg_instruction` / `imm_instruction` / `branch_instruction` /
`jump_instruction`), a direct mirror of `MNEMONICS` rather than an invention.

**2. `#5` is one token, not `#` plus `5`.** `operand_str` formats an immediate as `format!("#{n}")` and
`print_rxm_mapped` pushes a single `Nat` span over the whole thing; a grammar that lexed `#` as its own
punctuation token would fail on span count at the first `li`.

**3. There are no brackets and no `Operator` class.** The only punctuation the printer ever emits is `:`
after a label name and `,` between operands, both `Punct`. So this grammar has **one** punctuation
capture where every other grammar in this repository has two, and a `@punctuation.bracket` or
`@operator` row would fail `every_capture_row_is_used`.

**4. A label may be spelled exactly like a mnemonic, and the authority checks that first.**
`parse_rxm_full` tests `strip_suffix(':')` **before** it dispatches on `result` or on a mnemonic, so
`add:` is a label, not a truncated `add` instruction. `word: $ => $.identifier` plus mnemonics written
as string literals would otherwise let tree-sitter's automatic keyword extraction claim `add`
everywhere the text `add` appears — including in label position, turning `add:` into an `ERROR` node.
`_label_name`'s alias list, covering all 24 mnemonics plus `result`, is what keeps that from happening;
see *Divergences* below.

**What the printers classify.** TWO PRINTER ENTRY POINTS, ONE PRINTER, as `src/rxm.rs`'s module doc
puts it. `print_rxm_mapped(prog)` and `print_rxm_with_mapped(prog, h)` both call
`print_rxm_with_inner`, and the header `Option` is the only difference between them, as with TM's
`print_tm_inner`. The header is written first, and the listing's bytes are identical either way:

| printer | header | classes emitted |
|---|---|---|
| `print_rxm_mapped` | none | 5 — `Label`, `Mnemonic`, `Nat`, `Punct`, `Register` |
| `print_rxm_with_mapped` | `RxmHeader` | 7 — those, plus `Keyword` and `Ident` |

**A header always adds exactly two spans.** Given a header, `print_rxm_with_inner` pushes one
`Keyword` span for `result` and one `Ident` span for the type that follows it, then writes the same
listing it writes without one — nothing else in the header carries a span. The fixed corpus below
is printed headered and the generated one header-less, so the figures quoted for them are not
comparable to each other; the "+2 spans" relationship holds only within one corpus printed both
ways.

## What it is NOT, and may never become

- **Not a second parser.** The roadmap forbids two authoritative grammars; its test for "authoritative"
  is lowering a CST into Core, and nothing here does that.
- **No `locals.scm`.** A label reference resolves against the program's own label table, which
  `parse_rxm` builds and `Program::validate()` checks. Name resolution has an owner and it is not this
  grammar.
- **No indents.** The asm-reader design (`docs/superpowers/specs/2026-08-24-asm-reader-design.md`,
  which calls the form "asm") keeps indents and folds out of scope by citing the
  tree-sitter grammars design's §12, whose reason was that nothing in the Rust tree had an opinion
  about either to check one against. That reason does not hold for this form: `redextape fmt`
  formats `.rxm` files by reading them with `parse_rxm_full` and writing them back through
  `print_rxm_doc`, which puts each instruction four spaces in with a tab before its operands. No
  indent query has been written against that layout; §12 calls indents addable later if an editor
  user asks.
- **No injections and no folds.**

## How it is checked

A **span-for-span differential** in `crates/redextape-grammar-check`: parse the text, run
`queries/highlights.scm`, project every capture through `rxm::CAPTURE_CLASSES`, and assert the result
equals `print_rxm_mapped`'s (or `print_rxm_with_mapped`'s) own classification of the same text, byte
range for byte range, in offset order. The printer is the authority; a divergence is always a defect
here.

```bash
cargo nextest run -p redextape-grammar-check
```

**This is the only DIFFERENTIAL in this tree that reaches all 24 mnemonics — every `Instr` variant
and every `BinOp`.** Not the only check: `rxm_syntax.rs` reaches the whole table by CONSTRUCTION three
times over — `table_agrees_with_the_printer` builds every `Instr` variant with every `BinOp`,
`every_table_mnemonic_builds_an_instruction` walks `MNEMONICS` row by row, and
`the_table_has_one_row_per_mnemonic_and_no_duplicates` asserts the table holds 24 of them. What is
unique here is the route: real mini-language programs, lowered and printed, then compared span for
span against a query result. `crates/redextape-core/tests/rxm_roundtrip.rs`'s own
`the_demo_corpus_covers_thirteen_of_the_sixteen_instr_variants` asserts 13 of 16 `Instr` variants over
its `DEMOS`, and that file is not changed by this grammar. The difference is how the corpus is built:
this crate's builders lower a mini-language program through `lower_program`, which tries
`lower_rxm` first and retries through `defunc` only when it answers `Unsupported`. That is what
reaches `box`, `box_get` and `box_set`. Those three `Instr` variants are only ever emitted by
`defunc`'s mutable-capture boxing rewrite.

**`redextape emit --lang rxm` cannot produce those three.** `crates/redextape-cli/src/emit.rs` calls
`lower_rxm` directly, with no `defunc` retry, so the CLI refuses exactly the mutable-capture programs
this corpus depends on to reach `box`/`box_get`/`box_set`. The corpus and the CLI do not cover the same
ground: this grammar's differential is checked against programs the shipped tool cannot itself emit.

Three corpora, because three different things need checking:

| corpus | used for | how it is built | size |
|---|---|---|---|
| `rxm::CORPUS` | query agreement, query-pattern coverage, freedom from `ERROR` nodes, acceptance by `parse_rxm_full`, and the comment residue — **not** the differential, and **not** `tree-sitter test`, which reads `test/corpus/*.txt` instead | hand-written text, each entry asserted to parse under `parse_rxm_full` | 12 entries |
| `rxm::FIXED_CORPUS`, headered | the differential, `print_rxm_with_mapped` | 12 of `rxm_roundtrip.rs`'s own `DEMOS`, plus a mutable-capture closure, plus four comparison programs, lowered through `lower_program` | 17 entries |
| generated, header-less | the differential, `print_rxm_mapped` | `arb_expr_over` through the same lowering | 256 proptest cases |

**17 is a measurement.** The fixed corpus prints 3,374 bytes and 810 spans over its 17 headered
listings, about 198 bytes and 48 spans each, and reaches all 24 mnemonics; `FIXED_CORPUS` is fixed
rather than generated because `arb_expr_over` is five arms over numeric leaves and reaches only
eight of them: `li`, `add`, `sub`, `cmpgt`, `cmpeq`, `jz`, `jmp` and `halt`.

**256 is a measurement too.** The leg prints its span total on every run
(`rxm generated leg: … spans compared`, shown with `--no-capture`), and the total moves with the
seed.

**A browser leg checks the committed `.wasm`.** This crate compiles `parser.c` through `cc` and
has no wasm build, so the two sides meet in a file: `tests/golden.rs` prints one headered fixture
through `printed_program_with_header`, holds it to the printer's classification, and holds
`grammars/capture-golden.json` equal to the captures this crate computes for it.
`web/tests/browser/grammar-differential.test.ts` loads the committed
`tree-sitter-redextape-rxm.wasm` under `web-tree-sitter`, collapses its captures with the app's own
`colourSpans`, and compares them with that file. Of the legs here, it is the only one that loads
the `.wasm`.

### What the differential does NOT reach

**The whole `Comment` class.** Neither `print_rxm_mapped` nor `print_rxm_with_mapped` ever writes a
`;`: both hand `print_rxm_with_inner` an empty comment list, so no *mapped* printer emits a comment.
`print_rxm_doc`, which `redextape fmt` uses, does write comments back, but it returns only the text,
so no classification of a comment exists to compare against. That is a wider gap than TM's, where
the headered printer does emit comments and only three comment *positions* sit outside the check. It
is not theoretical either: `redextape emit --lang rxm` prepends a preamble line — "; rxm listing,
read back by `parse_rxm` and run by `redextape run`." — to every file it writes, so the most
common `.rxm` file in existence opens with a token this differential structurally cannot check. This
rests on `tree-sitter test`'s `comments.txt` corpus plus `parse_rxm_accepts_every_corpus_entry`
instead — weaker than the differential, because that pair only proves the text parses, not that any
capture agrees with a classification.

**A `@label`/`@label.reference` swap.** Both project to `TokenClass::Label` here — unlike TM, where the
printer distinguishes `Label` from `StateName` and a swap fails the differential immediately — so
`compare_classified` cannot see one. `each_label_capture_lands_on_its_own_positions` closes it instead,
by reading the *shipped* `queries/highlights.scm` and asserting byte ranges per capture name. **This is
a genuinely weaker check than the differential, and it is load-bearing rather than a formality**: swapping
the two capture names in the shipped file makes exactly that one test fail (`each_label_capture_lands_on_its_own_positions`)
and every other test in this crate's rxm suite still passes.

## Divergences

The inputs below were each run through both `parse_rxm_full` and this grammar on 2026-11-15. They
are the divergences a probe found, not a proof that there are no others. The differential sees none
of them: `compare_classified` fails on any `ERROR` or `MISSING` node, so no corpus that passes
holds an accept-less spelling, and the accept-more ones are text the printer does not write.

**Accept-more: this grammar parses clean text `parse_rxm_full` rejects.** The main one is the line.
`parse_rxm_full` walks `src.split_inclusive('\n')` and decides each line's kind from its own text,
so a newline is structural to the authority; here it sits in `extras`, so this grammar accepts
`halt jmp foo` on one line where `parse_rxm_full` rejects the whole line
(`` `halt` takes 0 operand(s), found 1 `` — everything after the first mnemonic reads as one
operand list, comma-split). That is the right direction for an editor, where a half-typed buffer is
not an error worth underlining. The others are checks the authority makes on a line's place or a
token's value, which this grammar's rules do not make:

- `result` after an instruction: `` `result` must precede the first instruction or label
  (header directives come first) ``.
- a second `result`: `` duplicate `result` directive ``.
- a `result` type that is not a value type, such as `result Banana`:
  `` `result` must be a value type (Nat | Bool | Unit | List<T>), found `Banana` ``.
- an immediate or a register number too large for a `u64`: `#99999999999999999999999` is not an
  immediate, and `r99999999999999999999999` is not a register.

**Accept-less: this grammar puts an `ERROR` or `MISSING` node in text `parse_rxm_full` accepts with
no diagnostic.** In each, the authority reads more loosely than the printed form. They run against
an editor's interest, since a file the authority reads shows a parse error:

- a label name with a space or a comma in it, `foo bar:` or `a,b:`, and a jump to one,
  `jmp foo bar`. The authority takes whatever precedes a line's final `:` as the label, and an
  operand is whatever lies between commas, trimmed; this grammar's names stop at whitespace and `,`.
- a signed number, `mov r+1, r0` or `li r0, #+5`. `parse_reg` and `parse_imm` read the digits with
  `str::parse`, which takes a leading `+`.
- spaces inside a type, `result List< Nat >`. `ty::parse_ty` trims inside each `List<…>`.
- whitespace other than space, tab, CR and LF, such as a form feed before an instruction or a
  no-break space after one. The authority trims each line with `str::trim`, which takes any Unicode
  whitespace; this grammar's `extras` are those four characters only. The form feed gives an
  `ERROR`; a no-break space after `halt` gives a `MISSING ":"` instead, because the line parses as
  a label whose name is `halt` and the no-break space.

**Labels spelled like a reserved word are not among them.** Without `_label_name`'s aliases,
`word: $ => $.identifier` would make `add:` an `ERROR` node while `parse_rxm_full` accepts it,
since its `strip_suffix(':')` check deliberately runs before mnemonic dispatch. Aliasing every
reserved word (all 24 mnemonics plus `result`, 25 spellings) to `$.identifier` inside `_label_name`
closes it. Each of the 25 reserved spellings, written as `<word>:` followed by an instruction,
parses with no `ERROR` or `MISSING` node, and regenerating from `grammar.js` from scratch reproduces
the committed `src/parser.c` byte for byte with no LR-conflict warning from the 25-word alias list.

## Regenerating

```bash
cd grammars/tree-sitter-redextape-rxm
../../.tools/tree-sitter generate
../../.tools/tree-sitter test
```

**Use `.tools/tree-sitter`, not whatever is on `PATH`.** The pin is CLI **0.25.10**, generating at
language ABI **15**. `scripts/setup-dev.sh` installs it. The pin sits below the newest release
deliberately: 0.26+ Linux binaries need glibc 2.39 and CI's runner has 2.35, so a newer CLI cannot run
there at all. `scripts/check-all.sh`'s `grammar` leg regenerates every directory under `grammars/` and
fails on any diff, so a stale committed `parser.c` is caught rather than trusted.

`tree-sitter.json` is required. Without it the CLI warns and silently generates **ABI 14**. The
`tree-sitter` Rust crate would load that parser without complaint — `Cargo.lock` pins it at 0.27.1,
which accepts ABI 13 to 15 — so the unit test `rxm::tests::abi_version_is_pinned` in `src/rxm.rs`
asserts 15, and the drift fails by name.

## Installing it in an editor

<!-- BEGIN shared: mirror-preamble -->
### Read this before any snippet: use the public mirror, not the address in `tree-sitter.json`

`tree-sitter.json` records `https://git.daveynet.xyz/davey/redextape`, which is where this project
actually lives — and **no editor can fetch it.** Re-measured 2026-08-27, unchanged from when this
section was first written on 2026-08-21:

```
$ curl -sS -o /dev/null -w '%{http_code}\n' \
    'https://forge.daveynet.xyz/davey/redextape/info/refs?service=git-upload-pack'
401

$ curl -sS 'https://git.daveynet.xyz/davey/redextape/info/refs?service=git-upload-pack' | wc -c
0
```

`forge.daveynet.xyz` is the HTTP git host and refuses anonymous access outright, which is the honest
failure. `git.daveynet.xyz` is the **SSH** clone host; over HTTPS it answers the ref advertisement with
**HTTP 200 and a zero-byte body**, which git reads as *a repository with no refs* — `git ls-remote` exits
`0` and prints nothing. **That is a silent empty, not an error**, and an editor pointed at the HTTPS
`git.` URL reports something unhelpful rather than "you are not authorized".

**So every snippet below names the public GitHub mirror instead**, which needs no credentials at all:

```
$ curl -sS -L -o /dev/null -w '%{http_code}\n' \
    https://github.com/Davey-Hughes/redextape/archive/main.tar.gz
200
```

**The mirror is a mirror, and `tree-sitter.json` is not wrong to keep pointing past it.** Pull
requests, CI and the roadmap live on the Forgejo instance; GitHub carries a copy of the refs so that
an editor has something to fetch. If you have a key on the instance,
`ssh://git@git.daveynet.xyz/davey/redextape.git` is the same tree and works too.
<!-- END shared: mirror-preamble -->

### An uppercase `.RXM` runs but is not coloured

`tree-sitter.json` claims the `rxm` extension, because that is what `redextape emit --lang rxm` and
`redextape run` call these files. `run` picks the form by `Form::from_extension` in
`crates/redextape-cli/src/form.rs`, which folds the extension to ASCII lowercase first — the same
mechanism that `an_uppercase_tm_extension_is_still_an_artifact` in `run.rs` pins for `.TM` applies
unchanged to `.rxm` — so `P.RXM` is a file this project runs. Tree-sitter's own `file-types`
extension matching is not case-insensitive, so an uppercase `.RXM` file is one this
project executes and this grammar does not colour.

### The name is `redextape_rxm`

Every editor loads the parser by looking up the C symbol `tree_sitter_<name>`, and this grammar
exports `tree_sitter_redextape_rxm` (`grep -n 'TS_PUBLIC const TSLanguage' src/parser.c`). Its three
siblings in the same repository export `tree_sitter_redextape`, `tree_sitter_redextape_lambda` and
`tree_sitter_redextape_tm`. **All four install from the same clone at different subdirectories**, so
getting the name wrong loads a different language rather than failing to find one.

(**"clone" is loose for one of the three editors below.** Helix and Zed both really do clone this
repository. nvim-treesitter's `main` branch fetches a per-grammar tarball instead — see the Neovim
section. The point survives either way: one source repository, four subdirectories, four distinct
symbols.)

The snippets below are adapted from the sibling READMEs, where the non-obvious parts were verified
against upstream source. Re-checked 2026-08-26: nvim-treesitter `main`'s `install.lua` still joins
`install_info.queries` to the **clone root** while applying `location` only to the compile directory,
and Zed's `GrammarManifestEntry` still carries the undocumented `path` key with `commit` as a serde
alias for `rev`.

**This form HAS comment syntax, like TM and unlike λ**, so the comment settings below are real: `;`
starts a line comment.

<!-- BEGIN shared: neovim-intro -->
### Neovim — nvim-treesitter

**If you use lazy.nvim, the whole configuration is one line.** This repository ships its own
`plugin/redextape.lua`, and lazy sources `plugin/**/*.lua` from a plugin's root directory when it
loads that plugin:

```lua
{ "Davey-Hughes/redextape", lazy = false }
```

That registers all four grammars, claims the four extensions, **and starts the highlighter** — which
is a separate thing that nothing else does. Neovim auto-starts treesitter only for its own bundled
filetypes, and nvim-treesitter's `main` branch ships no `FileType` autocmd, so a parser can be
installed and a filetype set and the buffer still open with no colour at all.

It also starts the language server when it finds a `redextape-lsp` binary, in the checkout's
`target/release/` or on `PATH`. When it finds neither, it shows a warning at every startup naming
the commands that build one. Highlighting works either way.

`.rxt`, `.rxlambda` and `.rxm` are claimed by extension. `.tm` is claimed by **sniffing the
buffer**, because Neovim already maps it to `tcl`: a `.tm` file becomes `redextape_tm` when its text
looks like a TM machine or its path has a directory named `redextape`, and otherwise keeps the
filetype it had. `lazy = false` is required — filetype registration has to happen at
startup, and a lazy-loaded spec would not register this project's extensions until something had
already loaded it. Then, once:

```vim
:TSInstall redextape redextape_rxm redextape_lambda redextape_tm
```

**That one line requires nvim-treesitter's `main` branch**, and the next paragraph explains why that
is a real fork in the road rather than a version number. `plugin/redextape.lua` uses `main`'s
registration API and `main`'s `User TSUpdate` event, neither of which exists on `master`; on `master`
the autocmd never fires, no parser is registered, and the filetype mappings still apply — leaving the
four extensions claimed with nothing to parse them. **If you are on `master`, skip the one-liner and
use the hand-written block below.**

**Everything below is for everyone else** — `master`, a different plugin manager, or nvim-treesitter
driven by hand. It is close to what `plugin/redextape.lua` does but not the same, and the
differences worth knowing before you copy it are these: no block starts the highlighter or the
language server, the `master` blocks use filetype names of their own, and the TM grammar's blocks
claim `.tm` **unconditionally by extension**, which is simpler and takes every such file on your
machine away from `tcl`. If you want colour you need a `FileType` autocmd calling
`vim.treesitter.start()` as well — see the end of this section.

**nvim-treesitter's `main` branch does not clone.** Its installer strips a trailing `.git` from
`url`, builds `<url>/archive/<revision>.tar.gz`, and fetches that with `curl`, then expects the
archive to expand to a directory named `<repo>-<revision>`. GitHub's archive endpoint matches that
shape exactly — including stripping a leading `v` from a tag — which is why the snippets below work.
It also means each of the four grammars downloads the whole repository separately.

nvim-treesitter has **two live branches that are incompatible plugins sharing a name.** `main` is
the current rewrite and needs Neovim 0.12+; `master` is frozen and supports Neovim 0.10 and 0.11.
Pick the one you have installed — the `install_info` field sets are different, and fields from one
are silently ignored by the other.
<!-- END shared: neovim-intro -->

**`main` branch:**

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "TSUpdate",
  callback = function()
    require("nvim-treesitter.parsers").redextape_rxm = {
      install_info = {
        url = "https://github.com/Davey-Hughes/redextape",
        location = "grammars/tree-sitter-redextape-rxm",
        queries = "grammars/tree-sitter-redextape-rxm/queries",
        -- revision = "<commit sha>",   -- optional; pins the grammar
      },
    }
  end,
})

vim.filetype.add({ extension = { rxm = "redextape_rxm" } })
```

Then `:TSInstall redextape_rxm`.

**`queries` is resolved against the repository root, not against `location`** — `install.lua` joins it
to the clone directory while `location` is applied separately to the compile directory. Writing
`queries = "queries"` points at a `queries/` that does not exist at this repository's root, and the
failure is silent: highlights simply do not get installed.

**`master` branch:**

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
parser_config.redextape_rxm = {
  install_info = {
    url = "https://github.com/Davey-Hughes/redextape",
    files = { "src/parser.c" },
    location = "grammars/tree-sitter-redextape-rxm",
    branch = "main",
  },
  filetype = "rxm",
}

vim.filetype.add({ extension = { rxm = "rxm" } })
```

**`branch = "main"` is required.** Without it `master` asks GitHub for `archive/master.tar.gz`,
which GitHub redirects to `main`, and the install then fails because the archive has no
`redextape-master` directory to move.

`master` has no `queries` field and `:TSInstall` does not copy query files, so copy
`queries/highlights.scm` to `queries/redextape_rxm/highlights.scm` somewhere on your `runtimepath`
yourself.

<!-- BEGIN shared: filetype-autocmd -->
**One more step the snippets above do not include.** Installing a parser does not turn highlighting
on. Neovim auto-starts treesitter only for its own bundled filetypes — lua, markdown, help, query —
and nvim-treesitter's `main` branch ships no `FileType` autocmd of its own, so without something
like this the buffer opens with the right filetype, a working parser, and no colour. (`master` has
one, in its `highlight` module, which runs only once you enable that module.) The pattern names the
filetypes of both branches' blocks:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = {
    "redextape", "redextape_rxm", "redextape_lambda", "redextape_tm", -- the `main` blocks
    "rxt", "rxm", "rxlambda", "tm", -- the `master` blocks
  },
  callback = function(args) pcall(vim.treesitter.start, args.buf) end,
})
```

This was measured rather than assumed, by a check that does not supply this autocmd itself: a check
that does is testing the harness.
<!-- END shared: filetype-autocmd -->

### Helix

In `~/.config/helix/languages.toml`, which merges over the shipped one:

```toml
[[grammar]]
name = "redextape_rxm"
source = { git = "https://github.com/Davey-Hughes/redextape", rev = "<commit sha>", subpath = "grammars/tree-sitter-redextape-rxm" }

[[language]]
name = "redextape_rxm"
scope = "source.rxm"
file-types = ["rxm"]
comment-tokens = ";"
```

Then:

```bash
hx --grammar fetch && hx --grammar build
```

`grammar` is omitted from `[[language]]` on purpose — it defaults to `name`, and both are
`redextape_rxm`. `comment-tokens` is the modern key; older Helix called it `comment-token`, singular.
No `indent` here. `redextape fmt` puts each instruction four spaces in (see *What it is NOT*), so
add `indent = { tab-width = 4, unit = "    " }` if you want Helix to agree with it.

Helix looks for queries in its runtime directory, so copy `queries/highlights.scm` to
`~/.config/helix/runtime/queries/redextape_rxm/highlights.scm`. `hx --health redextape_rxm` reports
whether it found both the grammar and the highlights.

### Zed

**Zed can install a grammar from a subdirectory. The key is `path`, and it is undocumented** — its
docs page for language extensions shows only `repository` and `rev`. Verified by reading Zed's source:

```rust
// zed-industries/zed, crates/extension/src/extension_manifest.rs
pub struct GrammarManifestEntry {
    pub repository: String,
    #[serde(alias = "commit")]
    pub rev: String,
    #[serde(default)]
    pub path: Option<String>,
}
```

`extension_builder.rs` clones the repository and joins `path` before looking for `src/parser.c`. Two
shipped extensions rely on it: `zed-extensions/php` uses `path = "php"`, and `zed-extensions/ocaml`
uses two `path` values from one repository, which is the shape this repository is in: **four**
grammars in one clone.

```
redextape-rxm-zed/
├── extension.toml
└── languages/
    └── redextape_rxm/
        ├── config.toml
        └── highlights.scm
```

`extension.toml`:

```toml
id = "redextape-rxm"
name = "redextape rxm"
description = "redextape rxm text form support."
version = "0.1.0"
schema_version = 1
authors = ["davey"]
repository = "https://github.com/Davey-Hughes/redextape"

[grammars.redextape_rxm]
repository = "https://github.com/Davey-Hughes/redextape"
commit = "<full 40-character commit sha>"
path = "grammars/tree-sitter-redextape-rxm"
```

`languages/redextape_rxm/config.toml`:

```toml
name = "redextape rxm"
grammar = "redextape_rxm"
path_suffixes = ["rxm"]
line_comments = [";"]
```

Install it with `zed: install dev extension` from the command palette, pointed at that directory.

Three things worth knowing before taking the Zed route:

- **`commit` is an alias for `rev`, which takes a full 40-character commit SHA or a branch name,
  not a tag.** Zed runs `git fetch --depth 1 origin <rev>` and then `git checkout <rev>`; fetching a
  tag by name stores no tag ref, so the checkout fails. Fetching by SHA needs the server to serve an
  unadvertised object. If your host refuses, give a branch name.
- **The queries live in the extension, not in the grammar.** Zed reads
  `languages/redextape_rxm/highlights.scm` from the *extension* repository, so this grammar's copy has
  to be duplicated across and will drift unless someone keeps it in step. Nothing in this
  repository's CI can see that copy.
- **Zed's capture vocabulary is not identical to the standard one.** Expect to adapt rather than paste
  — and note that once you do, it is no longer the file `crates/redextape-grammar-check` checks.

## What the grammar covers

`grammar.js` is **160 lines** — just under the mini-language's 164, and just over twice λ's 77.
`queries/highlights.scm` holds **10 patterns** over **9 capture names**, and `rxm::CAPTURE_CLASSES` has
**9 rows**, projecting onto **8** distinct `TokenClass` values, checked total in both directions
(`the_capture_map_is_total_over_the_queries`, `every_map_row_is_used_by_a_query`) and each pattern
exercised at least once over the corpus (`every_rxm_query_pattern_fires_over_the_corpus`). `src/parser.c`
is **44,324 bytes** at ABI 15. `test/corpus/` holds **17** `tree-sitter test` cases.

**One row projects twice: `@label` and `@label.reference` both map to `TokenClass::Label`.** That is
the only pair in this grammar's table that collapses, which is why the row count above runs one ahead
of the class count. The two captures are kept apart in `queries/highlights.scm` anyway so an editor
can theme a label declaration differently from a reference; `capture_map_has_no_duplicate_keys` checks
the map is still a function, and `each_label_capture_lands_on_its_own_positions` (above) is what
actually holds the two apart, since the projection being many-to-one means `compare_classified`
cannot.

**`@comment` has no mapped printer**, unlike every other row in this table: `print_rxm_doc` writes
comments, but neither mapped entry point does. It is in the map only because
`queries/highlights.scm` uses it and `capture_map_is_total` requires a row for every capture a query
names. `TokenClass::Comment` never appears on the authority side of this grammar's differential.

**There is no `@punctuation.bracket` row and no `@operator` row.** This form has no brackets and its
printer never emits `TokenClass::Operator`, so either row would fail `every_capture_row_is_used` —
the same reason `[":" ","] @punctuation.delimiter` is the only punctuation pattern here, where every
other grammar in this repository carries two.

**Every field name is load-bearing**, so renaming one means editing `queries/highlights.scm` and
rerunning the differential: `result` `type:`, `label` `name:`, `branch_instruction` `target:`, and
`jump_instruction` `target:`. There are no spare fields here — unlike TM, whose `grammar.js` defines
`index`, `read`, `write` and `move` fields that its `highlights.scm` never reads, and unlike the
mini-language, which has seven of them.
