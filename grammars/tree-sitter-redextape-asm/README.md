# tree-sitter-redextape-asm

A tree-sitter grammar for the Redextape register-assembly text form — the flat, line-oriented listing
`redextape_core::tm::asm_syntax`'s `parse_asm_full` reads and `redextape_core::tm::print_asm_mapped`
(through `print_asm_with_mapped`) writes and classifies. One of four grammars in this repository,
alongside `tree-sitter-redextape` (the mini-language), `tree-sitter-redextape-lambda` (the λ form) and
`tree-sitter-redextape-tm` (the TM text form). Scope `source.asm`, file extension `.asm`.

**It is for highlighting in external editors and it is not authoritative.** `parse_asm_full` is the
parser; `print_asm_mapped` is the printer AND the classifier, in one function — there is no separate
`classify_asm`. This grammar produces a CST and never lowers it into anything.

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

Every line kind also accepts a trailing `;` comment: `parse_asm_full` splits each line at its **first**
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
`print_asm_mapped` pushes a single `Nat` span over the whole thing; a grammar that lexed `#` as its own
punctuation token would fail on span count at the first `li`.

**3. There are no brackets and no `Operator` class.** The only punctuation the printer ever emits is `:`
after a label name and `,` between operands, both `Punct`. So this grammar has **one** punctuation
capture where every other grammar in this repository has two, and a `@punctuation.bracket` or
`@operator` row would fail `every_capture_row_is_used`.

**4. A label may be spelled exactly like a mnemonic, and the authority checks that first.**
`parse_asm_full` tests `strip_suffix(':')` **before** it dispatches on `result` or on a mnemonic, so
`add:` is a label, not a truncated `add` instruction. `word: $ => $.identifier` plus mnemonics written
as string literals would otherwise let tree-sitter's automatic keyword extraction claim `add`
everywhere the text `add` appears — including in label position, turning `add:` into an `ERROR` node.
`_label_name`'s alias list, covering all 24 mnemonics plus `result`, is what keeps that from happening;
see *Divergences* below.

**What the printers classify.** TWO PRINTER ENTRY POINTS, ONE PRINTER, as `src/asm.rs`'s module doc
puts it. There is no `Option` on either: `print_asm_mapped(prog)` writes the listing, and
`print_asm_with_mapped(prog, h)` writes the header, calls `print_asm_mapped` and shifts its spans by
the header's byte length — so the listing's bytes are identical either way:

| printer | header | classes emitted |
|---|---|---|
| `print_asm_mapped` | none | 5 — `Label`, `Mnemonic`, `Nat`, `Punct`, `Register` |
| `print_asm_with_mapped` | `AsmHeader` | 7 — those, plus `Keyword` and `Ident` |

**A header always adds exactly two spans.** `print_asm_with_mapped`'s own code pushes one `Keyword`
span for `result` and one `Ident` span for the type that follows it, then appends the header-less
listing shifted by the header's byte length — nothing else in the header carries a span. The two
generated-corpus and fixed-corpus averages quoted below are for two *different* corpora (one
proptest-generated and header-less, one hand-picked and headered), so they are not directly
comparable to each other; the "+2 spans" relationship holds only within one corpus printed both ways.

## What it is NOT, and may never become

- **Not a second parser.** The roadmap forbids two authoritative grammars; its test for "authoritative"
  is lowering a CST into Core, and nothing here does that.
- **No `locals.scm`.** A label reference resolves against the program's own label table, which
  `parse_asm` builds and `Program::validate()` checks. Name resolution has an owner and it is not this
  grammar.
- **No indents.** There is no `redextape fmt` for this form — design §12 puts folds and indents
  explicitly out of scope for every grammar in this slice, for the same reason each time: nothing in
  the Rust tree has an opinion about either to check one against.
- **No injections, no folds, no editor-extension packaging, and nothing in `web/`.**

## How it is checked

A **span-for-span differential** in `crates/redextape-grammar-check`: parse the text, run
`queries/highlights.scm`, project every capture through `asm::CAPTURE_CLASSES`, and assert the result
equals `print_asm_mapped`'s (or `print_asm_with_mapped`'s) own classification of the same text, byte
range for byte range, in offset order. The printer is the authority; a divergence is always a defect
here.

```bash
cargo nextest run -p redextape-grammar-check
```

**This is the only DIFFERENTIAL in this tree that reaches all 24 mnemonics — every `Instr` variant
and every `BinOp`.** Not the only check: `asm_syntax.rs` reaches the whole table by CONSTRUCTION three
times over — `table_agrees_with_the_printer` builds every `Instr` variant with every `BinOp`,
`every_table_mnemonic_builds_an_instruction` walks `MNEMONICS` row by row, and
`the_table_has_one_row_per_mnemonic_and_no_duplicates` asserts the table holds 24 of them. What is
unique here is the route: real mini-language programs, lowered and printed, then compared span for
span against a query result. `crates/redextape-core/tests/asm_roundtrip.rs`'s own
`the_demo_corpus_covers_thirteen_of_the_sixteen_instr_variants` asserts 13 of 16 `Instr` variants over
its `DEMOS`, and that file is not changed by this grammar. The difference is how the corpus is built:
this crate's builders lower a mini-language program through `lower_program`'s own template — try
`lower_asm` first, and retry through `defunc` only when it answers `Unsupported` — which is what
reaches `box`, `box_get` and `box_set`. Those three `Instr` variants are only ever emitted by
`defunc`'s mutable-capture boxing rewrite.

**`redextape emit --lang asm` cannot produce those three.** `crates/redextape-cli/src/emit.rs` calls
`lower_asm` directly, with no `defunc` retry, so the CLI refuses exactly the mutable-capture programs
this corpus depends on to reach `box`/`box_get`/`box_set`. The corpus and the CLI do not cover the same
ground: this grammar's differential is checked against programs the shipped tool cannot itself emit.

Three corpora, because three different things need checking:

| corpus | used for | how it is built | size |
|---|---|---|---|
| `asm::CORPUS` | query agreement, query-pattern coverage, freedom from `ERROR` nodes, acceptance by `parse_asm_full`, and the comment residue — **not** the differential, and **not** `tree-sitter test`, which reads `test/corpus/*.txt` instead | hand-written text, each entry asserted to parse under `parse_asm_full` | 12 entries |
| `asm::FIXED_CORPUS`, headered | the differential, `print_asm_with_mapped` | 12 of `asm_roundtrip.rs`'s own `DEMOS`, plus a mutable-capture closure, plus four comparison programs, lowered through `lower_program`'s template | 17 entries |
| generated, header-less | the differential, `print_asm_mapped` | `arb_expr_over` through the same lowering template | 256 proptest cases |

**17 is a measurement.** The fixed corpus averages 198 bytes and 47 spans per headered listing —
3,374 bytes and 810 spans in total — and reaches all 24 mnemonics; `FIXED_CORPUS` is fixed rather than
generated because `arb_expr_over` is five arms over numeric leaves and reaches only nine of them.

**256 is a measurement too.** A header-less listing averages 146 bytes and 36 spans, and both are
FLOORS of a measured 256-case total rather than figures a total can be derived from — multiplying
either out undercounts, so no total is computed from them here. The span total is quoted from runs
instead: roughly 9,000, and it moves with the seed, with fifteen runs observed on 2026-08-26 ranging
from 8,384 to 9,620. The leg prints its own live total on every run. Even at the top of that range it
is the cheapest of the four corpora across all four grammars in this repository, against λ's 256-case
leg (163K spans) and TM's 32-case leg (282,006 spans). An earlier figure of 297 bytes / 73 spans for
this same average came from a probe that hand-rolled a generator approximating `arb_expr_over` and
ignored `prop_recursive`'s own `desired_size = 8`; the corrected numbers above are what
`tests/asm.rs`'s doc comment on the generated leg actually measures.

### What the differential does NOT reach

**The whole `Comment` class.** Neither `print_asm_mapped` nor `print_asm_with_mapped` ever writes a
`;` — `TokenClass::Comment` has no printer at all for this form. That is a wider gap than TM's, where
the headered printer does emit comments and only three comment *positions* sit outside the check. It
is not theoretical either: `redextape emit --lang asm` prepends a preamble line — "; Register-assembly
listing, read back by `parse_asm` and run by `redextape run`." — to every file it writes, so the most
common `.asm` file in existence opens with a token this differential structurally cannot check. This
rests on `tree-sitter test`'s `comments.txt` corpus plus `parse_asm_accepts_every_corpus_entry`
instead — weaker than the differential, because that pair only proves the text parses, not that any
capture agrees with a classification.

**A `@label`/`@label.reference` swap.** Both project to `TokenClass::Label` here — unlike TM, where the
printer distinguishes `Label` from `StateName` and a swap fails the differential immediately — so
`compare_classified` cannot see one. `each_label_capture_lands_on_its_own_positions` closes it instead,
by reading the *shipped* `queries/highlights.scm` and asserting byte ranges per capture name. **This is
a genuinely weaker check than the differential, and it is load-bearing rather than a formality**: swapping
the two capture names in the shipped file makes exactly that one test fail (`each_label_capture_lands_on_its_own_positions`)
and every other test in this crate's asm suite still passes.

## Divergences

**One accept-more divergence.** `parse_asm_full` walks `src.split_inclusive('\n')` and decides each
line's kind from its own text, so a newline is structural to the authority; here it sits in `extras`,
so this grammar accepts `halt jmp foo` on one line where `parse_asm_full` rejects the whole line
(`` `halt` takes 0 operand(s), found 1 `` — everything after the first mnemonic reads as one operand
list, comma-split). That is the right direction for an editor, where a half-typed buffer is not an
error worth underlining, and it is unreachable by the differential, whose corpus is always printed
output — one construct per line, by construction.

**No accept-less divergence.** Without `_label_name`'s aliases, `word: $ => $.identifier` would make
`add:` an `ERROR` node while `parse_asm_full` accepts it, since its `strip_suffix(':')` check
deliberately runs before mnemonic dispatch. Aliasing every reserved word (all 24 mnemonics plus
`result`, 25 spellings) to `$.identifier` inside `_label_name` closes it. Verified directly rather than
assumed: every one of the 25 reserved spellings, written as `<word>:` followed by an instruction, parses
with no `ERROR` or `MISSING` node under the pinned CLI, and regenerating from `grammar.js` from scratch
reproduces the committed `src/parser.c` byte for byte with no LR-conflict warning from the 25-word alias
list.

## Regenerating

```bash
cd grammars/tree-sitter-redextape-asm
../../.tools/tree-sitter generate
../../.tools/tree-sitter test
```

**Use `.tools/tree-sitter`, not whatever is on `PATH`.** The pin is CLI **0.25.10**, generating at
language ABI **15**. `scripts/setup-dev.sh` installs it. The pin sits below the newest release
deliberately: 0.26+ Linux binaries need glibc 2.39 and CI's runner has 2.35, so a newer CLI cannot run
there at all. `scripts/check-all.sh`'s `grammar` leg regenerates every directory under `grammars/` and
fails on any diff, so a stale committed `parser.c` is caught rather than trusted.

`tree-sitter.json` is required. Without it the CLI warns and silently generates **ABI 14**, which the
Rust crate refuses to load — `abi_version_is_pinned` in `src/asm.rs` is what turns that into a message
naming the real cause rather than an opaque `set_language` failure.

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

### `.asm` collides with essentially every assembler in existence

`tree-sitter.json` claims the `asm` extension, because that is what `redextape emit --lang asm` and
`redextape run` call these files. It is also the default extension for NASM, MASM, GAS and effectively
every other assembly dialect, so **if your editor already has an opinion about `.asm`, you have to say
which wins** — with `vim.filetype.add` in Neovim, `file-types` in Helix, or `path_suffixes` in Zed, all
shown below. There is no way for this grammar to resolve that for you.

**One more collision, in the other direction.** `crates/redextape-cli/src/run.rs` dispatches on a
file's extension ASCII-case-insensitively — the same mechanism that `an_uppercase_tm_extension_is_still_an_artifact`
pins for `.TM` applies unchanged to `.asm` — so `P.ASM` is a file this project runs. Tree-sitter's own
`file-types` extension matching is not case-insensitive, so an uppercase `.ASM` file is one this
project executes and this grammar does not colour.

### The name is `redextape_asm`

Every editor loads the parser by looking up the C symbol `tree_sitter_<name>`, and this grammar
exports `tree_sitter_redextape_asm` (`grep -n 'TS_PUBLIC const TSLanguage' src/parser.c`). Its three
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
filetypes, and nvim-treesitter ships no `FileType` autocmd, so a parser can be installed and a
filetype set and the buffer still open with no colour at all.

`.rxt` and `.rxlambda` are claimed by extension. `.asm` and `.tm` are claimed by **sniffing the
buffer**, because Neovim already maps them to `asm` and `tcl`: a listing that is not this project's
keeps the filetype it had. `lazy = false` is required — filetype registration has to happen at
startup, and a lazy-loaded spec would not register this project's extensions until something had
already loaded it. Then, once:

```vim
:TSInstall redextape redextape_asm redextape_lambda redextape_tm
```

**That one line requires nvim-treesitter's `main` branch**, and the next paragraph explains why that
is a real fork in the road rather than a version number. `plugin/redextape.lua` uses `main`'s
registration API and `main`'s `User TSUpdate` event, neither of which exists on `master`; on `master`
the autocmd never fires, no parser is registered, and the filetype mappings still apply — leaving the
four extensions claimed with nothing to parse them. **If you are on `master`, skip the one-liner and
use the hand-written block below.**

**Everything below is for everyone else** — `master`, a different plugin manager, or nvim-treesitter
driven by hand. It is close to what `plugin/redextape.lua` does, with two deliberate differences
worth knowing before you copy it: the blocks below claim `.asm` and `.tm` **unconditionally by
extension**, which is simpler and takes every such file on your machine away from `asm` and `tcl`,
and they do not start the highlighter. If you want colour you need a `FileType` autocmd calling
`vim.treesitter.start()` as well — see the end of this section.

**nvim-treesitter's `main` branch does not clone.** Its installer strips a trailing `.git` from
`url`, builds `<url>/archive/<revision>.tar.gz`, and fetches that with `curl`, then expects the
archive to expand to a directory named `<repo>-<revision>`. GitHub's archive endpoint matches that
shape exactly — including stripping a leading `v` from a tag — which is why the snippets below work.
It also means each of the four grammars downloads the whole repository separately.

nvim-treesitter has **two live branches that are incompatible plugins sharing a name.** `main` is the
current rewrite and needs Neovim 0.12+; `master` is frozen and works with Neovim ≤ 0.11. Pick the one you
have installed — the `install_info` field sets are different, and fields from one are silently ignored by
the other.
<!-- END shared: neovim-intro -->

**`main` branch:**

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "TSUpdate",
  callback = function()
    require("nvim-treesitter.parsers").redextape_asm = {
      install_info = {
        url = "https://github.com/Davey-Hughes/redextape",
        location = "grammars/tree-sitter-redextape-asm",
        queries = "grammars/tree-sitter-redextape-asm/queries",
        -- revision = "<commit sha>",   -- optional; pins the grammar
      },
    }
  end,
})

vim.filetype.add({ extension = { asm = "redextape_asm" } })
```

Then `:TSInstall redextape_asm`.

**`queries` is resolved against the repository root, not against `location`** — `install.lua` joins it
to the clone directory while `location` is applied separately to the compile directory. Writing
`queries = "queries"` points at a `queries/` that does not exist at this repository's root, and the
failure is silent: highlights simply do not get installed.

That `vim.filetype.add` line is also what takes `.asm` from whatever assembler filetype plugin you have
installed, if any.

**`master` branch:**

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
parser_config.redextape_asm = {
  install_info = {
    url = "https://github.com/Davey-Hughes/redextape",
    files = { "src/parser.c" },
    location = "grammars/tree-sitter-redextape-asm",
  },
  filetype = "asm",
}

vim.filetype.add({ extension = { asm = "asm" } })
```

`master` has no `queries` field and `:TSInstall` does not copy query files, so copy
`queries/highlights.scm` to `queries/redextape_asm/highlights.scm` somewhere on your `runtimepath`
yourself.

<!-- BEGIN shared: filetype-autocmd -->
**One more step the snippets above do not include.** Installing a parser does not turn highlighting
on. Neovim auto-starts treesitter only for its own bundled filetypes — lua, markdown, help, query —
and nvim-treesitter ships no `FileType` autocmd of its own, so without something like this the buffer
opens with the right filetype, a working parser, and no colour:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "redextape", "redextape_asm", "redextape_lambda", "redextape_tm" },
  callback = function(args) pcall(vim.treesitter.start, args.buf) end,
})
```

This was measured rather than assumed, and it was measured only after a review pointed out that every
earlier check had supplied this autocmd itself and was therefore testing the harness.
<!-- END shared: filetype-autocmd -->

### Helix

In `~/.config/helix/languages.toml`, which merges over the shipped one:

```toml
[[grammar]]
name = "redextape_asm"
source = { git = "https://github.com/Davey-Hughes/redextape", rev = "<commit sha>", subpath = "grammars/tree-sitter-redextape-asm" }

[[language]]
name = "redextape_asm"
scope = "source.asm"
file-types = ["asm"]
comment-tokens = ";"
```

Then:

```bash
hx --grammar fetch && hx --grammar build
```

`grammar` is omitted from `[[language]]` on purpose — it defaults to `name`, and both are
`redextape_asm`. `comment-tokens` is the modern key; older Helix called it `comment-token`, singular.
No `indent` here, for the reason given under *What it is NOT*.

Helix looks for queries in its runtime directory, so copy `queries/highlights.scm` to
`~/.config/helix/runtime/queries/redextape_asm/highlights.scm`. `hx --health redextape_asm` reports
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
shipped extensions rely on it; `zed-extensions/ocaml` uses two `path` values from one repository,
which is the shape this repository is in — now with **four** grammars in one clone.

```
redextape-asm-zed/
├── extension.toml
└── languages/
    └── redextape_asm/
        ├── config.toml
        └── highlights.scm
```

`extension.toml`:

```toml
id = "redextape-asm"
name = "Redextape asm"
description = "Redextape register-assembly text form support."
version = "0.1.0"
schema_version = 1
authors = ["davey"]
repository = "https://github.com/Davey-Hughes/redextape"

[grammars.redextape_asm]
repository = "https://github.com/Davey-Hughes/redextape"
commit = "<full 40-character commit sha>"
path = "grammars/tree-sitter-redextape-asm"
```

`languages/redextape_asm/config.toml`:

```toml
name = "Redextape asm"
grammar = "redextape_asm"
path_suffixes = ["asm"]
line_comments = [";"]
```

Install it with `zed: install dev extension` from the command palette, pointed at that directory.

Three things worth knowing before taking the Zed route:

- **`commit` is an alias for `rev`, and it must be a full 40-character SHA.** Zed fetches it with
  `git fetch --depth 1 origin <rev>`, which needs the server to serve an unadvertised object by SHA.
  If your host refuses, give a branch or tag name instead.
- **The queries live in the extension, not in the grammar.** Zed reads
  `languages/redextape_asm/highlights.scm` from the *extension* repository, so this grammar's copy has
  to be duplicated across and will drift unless someone keeps it in step. Nothing in this
  repository's CI can see that copy.
- **Zed's capture vocabulary is not identical to the standard one.** Expect to adapt rather than paste
  — and note that once you do, it is no longer the file `crates/redextape-grammar-check` checks.

## What the grammar covers

`grammar.js` is **165 lines** — just under the mini-language's 171, and just over twice λ's 78.
`queries/highlights.scm` holds **10 patterns** over **9 capture names**, and `asm::CAPTURE_CLASSES` has
**9 rows**, projecting onto **8** distinct `TokenClass` values, checked total in both directions
(`the_capture_map_is_total_over_the_queries`, `every_map_row_is_used_by_a_query`) and each pattern
exercised at least once over the corpus (`every_asm_query_pattern_fires_over_the_corpus`). `src/parser.c`
is **44,324 bytes** at ABI 15. `test/corpus/` holds **17** `tree-sitter test` cases.

**One row projects twice: `@label` and `@label.reference` both map to `TokenClass::Label`.** That is
the only pair in this grammar's table that collapses, which is why the row count above runs one ahead
of the class count. The two captures are kept apart in `queries/highlights.scm` anyway so an editor
can theme a label declaration differently from a reference; `capture_map_has_no_duplicate_keys` checks
the map is still a function, and `each_label_capture_lands_on_its_own_positions` (above) is what
actually holds the two apart, since the projection being many-to-one means `compare_classified`
cannot.

**`@comment` has no printer at all**, unlike every other row in this table: it is in the map only
because `queries/highlights.scm` uses it and `capture_map_is_total` requires a row for every capture a
query names. `TokenClass::Comment` never appears on the authority side of this grammar's differential.

**There is no `@punctuation.bracket` row and no `@operator` row.** This form has no brackets and its
printer never emits `TokenClass::Operator`, so either row would fail `every_capture_row_is_used` —
the same reason `[":" ","] @punctuation.delimiter` is the only punctuation pattern here, where every
other grammar in this repository carries two.

**Every field name is load-bearing**, so renaming one means editing `queries/highlights.scm` and
rerunning the differential: `result` `type:`, `label` `name:`, `branch_instruction` `target:`, and
`jump_instruction` `target:`. There are no spare fields here — unlike TM, whose `grammar.js` defines
`index`, `read`, `write` and `move` fields that its `highlights.scm` never reads, and unlike the
mini-language, which has seven of them.
