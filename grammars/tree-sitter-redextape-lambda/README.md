# tree-sitter-redextape-lambda

A tree-sitter grammar for the redextape **λ text form** — the runnable lambda-calculus notation that
`crates/redextape-core/src/lambda/syntax.rs` parses and prints. Scope `source.rxlambda`, file
extension `.rxlambda`.

This is the sibling of `grammars/tree-sitter-redextape/`, which covers the `.rxt` mini-language.
**Read that README too.** The toolchain pin, the regeneration rule and the clone problem are shared
between the two and their reasoning is written out in full there; this file states the conclusions and
says only what is different. What *is* different is the authority: λ's is a **printer**, not a
classifier, and almost everything below follows from that.

## The form, in four token shapes

Read from `syntax.rs` — `parse_lambda`, `parse_application`, `parse_atom`, `parse_abstraction`,
`is_ident_start`, `is_ident_continue`, and the printer's `push_span` calls.

```
term        := atom+                          application by juxtaposition, LEFT-associative
atom        := abstraction | '(' term ')' | ident
abstraction := ('\' | 'λ') ident '.' term
ident       := [_$A-Za-z][_$A-Za-z0-9]*
```

**There are no comments and no literals.** Four token shapes: a binder head, an identifier, `.`, and
parentheses. No `//`, no numbers, no booleans, no operators — so this grammar's entire capture
vocabulary is **five names**, against the mini-language's eleven, and there is no `@comment` gap of the
kind design §6.3 records for TM because there is nothing to comment with.

**`\` and `λ` are interchangeable to the parser; the printer emits only `λ`.** That asymmetry is
upstream and deliberate: `parse_lambda` takes either, `print_lambda` writes `λ`. So `λ` is the
canonical form — what a golden file, a demo or a CLI dump shows — and `\` is a **permanent input
alias**, kept because it is what a keyboard types. This grammar must accept both, and an editor is
exactly where the `\` gets typed. It is also the one thing the differential structurally cannot check;
see *How it is checked* below.

**`$` is a legal identifier character, including in start position.** `lower.rs` names its
store-passing binder `$store`, and `$` is this project's marker for a compiler-generated name that the
surface syntax cannot forge, so a printed lowering never collides with a source identifier. A grammar
whose `identifier` rule started at `[_A-Za-z]` would ERROR on the output of the project's own lowering.

**`?<index>` is deliberately *not* accepted, and that is agreement rather than a gap.** A free
variable has no name to print and comes out as `?0`, which is not a valid identifier — on purpose, so
that an open term **fails to reparse loudly rather than silently rebinding**. `parse_lambda` rejects
it; this grammar rejects it; the two agree. Everything the backend produces is closed, so nothing
legitimate is being refused here.

**Whitespace is Unicode, not ASCII, and that is the one place this grammar's `extras` is deliberately
wider than its sibling's.** λ's `skip_ws` tests `char::is_whitespace()` — the Unicode `White_Space`
property — while the mini-language's lexer tests `is_ascii_whitespace()`. The natural `/\s/` in an
`extras` list is **ASCII-only in tree-sitter's regex engine**: it *nearly* matched the mini-language's
ASCII-only lexer — the two diverged on exactly one code point, U+000B VERTICAL TAB, which `/\s/`
accepts and `is_ascii_whitespace()` rejects — and it is wrong here regardless, where U+2009 THIN SPACE
separates two atoms as far as `parse_lambda` is concerned. `grammar.js`
therefore spells the class out — the exact 25 code points in 10 ranges that `char::is_whitespace()`
accepts.

**The mini-language's own gap is CLOSED.** Its `extras` now spells out `is_ascii_whitespace()`'s five
code points instead of `/\s/`, and `the_grammar_and_the_lexer_agree_on_every_ascii_whitespace_candidate`
in `redextape-grammar-check`'s `tests/captures.rs` pins it. That test asks `parser::parse` rather than
comparing spans, because `classify_source` skips a byte the lexer rejects and emits no span for it — so
the span differential returned the same answer either way and could not see the defect at all.

**Do not "harmonise" the two grammars' `extras`.** Each is now exactly right for its own authority, and
they answer to different ones — copying either class into the other would break it.

## What this is for

**External editors, and only external editors** — the same lane the mini-language grammar occupies,
for the same reason. Inside this project, λ text is already coloured without a grammar:
`web/src/lambda-pane.ts` takes `print_lambda_mapped`'s spans straight through `spans.ts`'s
`decorationRanges`, so the web λ pane draws over the printer's own classification and has no use for a
CST. Neovim, Helix, Zed and Emacs cannot call a Rust function, and `redextape-lsp` is deferred to v2.
A grammar is the only thing that reaches them.

Worth stating plainly, because it changes what "installing" means here: **no file in this repository
has a `.rxlambda` extension**, and nothing writes one. The λ form appears as web-pane text, as
`examples/lambda_demo.rs` output, and as strings inside tests. The extension is declared in
`tree-sitter.json` so an editor has something to bind to when a user *does* save a term to a file,
which is the case this grammar exists to serve.

## What it is NOT, and may never become

**This grammar is not authoritative, and it may never lower a CST into a term.**
`crates/redextape-core/src/lambda/syntax.rs` is the semantic source of truth for both directions —
`parse_lambda` reads, `print_lambda_mapped` writes — and stays so. Any disagreement this grammar
introduces is therefore **cosmetic by construction**: it can produce a wrong colour and it cannot
produce a wrong term.

That constraint is the roadmap's, not this file's — *never maintain two authoritative grammars*.
Deliberately absent, each for a stated reason
(`docs/superpowers/specs/2026-08-20-tree-sitter-grammars-design.md` §12):

- **no `locals.scm`** — a scope resolver is a semantic claim, and λ already has one: `parse_lambda`
  resolves names to de Bruijn indices, and `print_lambda`'s freshening guarantees no binder shares a
  name with any binder enclosing it. A query-language reimplementation of that would be the closest
  thing here to the two authoritative grammars the roadmap forbids.
- **no `injections.scm`** — no form embeds another.
- **no folds, no indents** — `print_lambda_mapped` emits a **single line**; there is no `redextape fmt`
  for this form and nothing in the Rust tree has an opinion about either, so there would be nothing to
  check an opinion against.
- **nothing in `web/`** — settled in the other direction above, and not reopened.

## How it is checked

`crates/redextape-grammar-check` compiles the committed parser through `cc` and compares **every
highlight capture against `print_lambda_mapped`, span for span**. The direction is fixed: the printer
is the authority and the check has no opinion of its own, so a divergence is always a defect in
`grammar.js` or `queries/highlights.scm`.

```
cargo nextest run -p redextape-grammar-check
```

**THE CORPUS IS PRODUCED, NOT AUTHORED, AND THAT IS THE CENTRAL DIFFERENCE FROM THE SIBLING GRAMMAR.**
The mini-language has `classify_source`, a function *from text to spans*, so its differential can
classify any string a human types. λ has no such function. Its only authority is
`print_lambda_mapped`, which produces text and spans **together** and accepts neither independently.
So a λ comparison entry cannot be hand-typed and then classified — it has to come out of the pipeline
`parser::parse → desugar::desugar → lambda::lower → print_lambda_mapped`, which is what
`lambda::printed_term` is.

Nothing in that pipeline reduces, and nothing in this crate may: it stops at `lower`, which builds a
term, and at the printer, which writes one. A λ measurement that reduces has previously cost this
machine 60 GiB of RAM and all of swap. Treat any `reduce` in this crate as a defect.

Four layers, none of which is the same evidence twice:

| layer | what it does |
|---|---|
| `tree-sitter test` | **six** tree-shape cases under `test/corpus/`, for structure the differential cannot see — including the `\` alias, which nothing else can reach |
| `lambda::CORPUS` in `src/lambda.rs` | **ten** hand-typed λ terms, used for the guards below rather than for the differential: they are the strings an editor's user might type, including shapes the printer never writes |
| `mini::CORPUS`, lowered and printed | **12 of 13** mini-language programs lower to λ, printed and compared span for span — **1270 spans** in total |
| `tests/lambda.rs`'s generated leg | proptest over `arb_expr_over`, **256/256** generated programs lowered and compared, same comparison |

Every one of those figures is measured rather than assumed, and each is reproducible — the commands
are in the roadmap entry for this branch (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`).
The `12` and the `1270` matter together: the smallest entry contributes **7** spans, so no comparison
here can pass by being handed an empty expectation.

Two guards sit under the comparison, and both were added because something had slipped past
everything else:

- **`every_query_pattern_fires`** — `Query::pattern_count` against the set of pattern indices actually
  seen over a corpus. `(parenthesized_term (identifier) @variable)` had **zero coverage anywhere in
  the pipeline**: no corpus entry reached it, and `print_lambda_mapped` can never emit `(x)` at all,
  since `parens` is reached only for an `Abs` in function position and for a non-`Var` atom. The
  pattern is *correct* and stays — an editor's user can type `(x)` — and what was missing was proof
  that anything exercised it. The guard is on `Grammar`, so every grammar in this repository carries
  it — the TM and asm grammars inherited it when they arrived.
- **`every_corpus_program_parses_without_error_nodes`** — `Grammar::parse` **succeeds on a syntax
  error**, returning a tree that contains `ERROR`/`MISSING` nodes, and `captures` never inspects them.
  Without this, a corpus entry that stopped parsing cleanly would still pass every capture test with a
  short-but-consistent list.

**One gap, stated rather than left to be discovered** (design §6.2). Since the corpus is
printer-produced and the printer emits only `λ`, **no comparison entry can ever contain a `\`**. The
grammar accepts it, and the differential has no authority to compare it against. That arm rests on the
`tree-sitter test` case `the backslash alias parses identically` plus a test in `tests/lambda.rs`
asserting `parse_lambda` succeeds on the same string. That is weaker than the differential, which is
why it is written here instead of left implicit.

Design §6.1's other gap does *not* bite as hard here as it does next door: with five capture names and
no `@function.call`, those five names project onto three `TokenClass` values — `@keyword.function`
and `@variable.parameter` are both `Binder`, and `@punctuation.bracket` and `@punctuation.delimiter`
are both `Punct`.

**This sentence read *"the only names that collapse to one `TokenClass` are `@punctuation.bracket`
and `@punctuation.delimiter`"* until the branch that added `scripts/check-doc-figures.sh`, and it was
wrong: `@keyword.function` and `@variable.parameter` project to `Binder` together, so TWO pairs
collapse rather than one.** Found by that gate's `map_classes` derivation rather than by reading —
five rows over three classes, where a single collapsing pair would have left four. The claim was
UNQUANTIFIED, which is exactly why nothing could check it: a gate can hold a number to the tree and
cannot hold the word "only" to anything. It now names a number, and a row in that script's table
holds that number to `lambda::CAPTURE_CLASSES`.

`@variable.parameter` (`Binder`) and `@variable` (`Ident`) are
genuinely distinguished by the comparison — which is exactly why the occurrence patterns in
`queries/highlights.scm` are scoped by position instead of being a single `(identifier) @variable`
catch-all. A catch-all would capture a binder's name as `Ident` *and* `Binder` at one byte range, and
`captures_with` rejects overlapping captures that disagree. `a_conflicting_query_is_rejected` pins
that.

## Regenerating

`src/parser.c`, `src/grammar.json` and `src/node-types.json` are **committed**, and
`scripts/check-all.sh` regenerates every grammar on every run and fails if what is committed differs
from what `grammar.js` produces — and now also runs `tree-sitter test` for each. So a `grammar.js` edit
is not finished until the regenerated `src/` is staged alongside it.

```bash
scripts/setup-dev.sh                             # installs the pinned CLI to .tools/ (git-ignored)
cd grammars/tree-sitter-redextape-lambda
../../.tools/tree-sitter generate
../../.tools/tree-sitter test
```

**The CLI version is pinned to v0.25.10, and it sits below the newest release on purpose.** Binaries
from 0.26.0 on need **GLIBC_2.39** and this project's CI runner has **2.35**; every published Linux
asset for those releases is the same glibc build and no musl variant exists. Building 0.26 from source
is not a way around it either — the CLI vendors QuickJS through `bindgen`, which needs libclang, also
absent on the runner. v0.25.10 needs only GLIBC_2.34 and generates this grammar at **ABI 15**. **Do
not bump this until the runner image has glibc 2.39+.** The full story, including the version that was
pinned first and never existed, is in `grammars/tree-sitter-redextape/README.md` and design §8.1.

**`tree-sitter.json` must be present.** Without it the released CLI prints a warning and *silently*
generates ABI 14, which the `tree-sitter` Rust crate then refuses to load. `lambda::abi_version_is_pinned`
asserts 15 on load so that failure names its cause instead of surfacing as an opaque `set_language`
error.

Do not use a `tree-sitter` from `$PATH`. On this machine that resolves to Arch's `tree-sitter-cli-git`,
a `master` build that reports a version number no release ever carried; regenerating with it emits
different metadata and reddens the very check that exists to catch a stale `parser.c`.
`check-all.sh` prefers `.tools/tree-sitter` and asserts `--version` reads `0.25.10`.

## Installing it in an editor

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

### The name is `redextape_lambda`, and it is not interchangeable with `redextape`

Every editor below loads the parser by looking up the C symbol `tree_sitter_<name>`, and the symbol
this grammar exports is `tree_sitter_redextape_lambda` — `grammar.js` declares
`name: 'redextape_lambda'`, and `grep -n 'TS_PUBLIC const TSLanguage' src/parser.c` shows the result.
The other grammars in this repository export `tree_sitter_redextape`, `tree_sitter_redextape_tm`, and
`tree_sitter_redextape_asm`. **All four are installed from the same clone at different
subdirectories**, so getting the name wrong loads the wrong language rather than failing to find one —
they live side by side and none shadows another.

(**"clone" is loose for one of the three editors below.** Helix and Zed both really do clone this
repository. nvim-treesitter's `main` branch fetches a per-grammar tarball instead — see the Neovim
section. The point survives either way: one source repository, four subdirectories, four distinct
symbols.)

The install snippets are otherwise adapted from `grammars/tree-sitter-redextape/README.md`, where the
non-obvious parts (nvim-treesitter's two incompatible branches, Zed's undocumented `path` key,
Helix's `comment-tokens` rename) were verified against upstream source. Re-checked against upstream on
2026-08-21 for this grammar: nvim-treesitter `main`'s `install.lua` still joins `install_info.queries`
to the **clone root** while applying `location` only to the compile directory, and Zed's
`GrammarManifestEntry` still carries `path` with `commit` as a serde alias for `rev`.

Values that change from the sibling's snippets, and nothing else does: the language name, the
subdirectory, the scope, the file extension, and **the removal of every comment setting** — the λ form
has no comment syntax, so an editor configured with one would comment code out into a parse error.

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
current rewrite and needs Neovim 0.12+; `master` is frozen and works with Neovim ≤ 0.11. Pick the one
you have installed — the `install_info` field sets are different, and fields from one are silently
ignored by the other.

**`main` branch:**

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "TSUpdate",
  callback = function()
    require("nvim-treesitter.parsers").redextape_lambda = {
      install_info = {
        url = "https://github.com/Davey-Hughes/redextape",
        location = "grammars/tree-sitter-redextape-lambda",
        queries = "grammars/tree-sitter-redextape-lambda/queries",
        -- revision = "<commit sha>",   -- optional; pins the grammar
      },
    }
  end,
})

vim.filetype.add({ extension = { rxlambda = "redextape_lambda" } })
```

Then `:TSInstall redextape_lambda`.

**`queries` is resolved against the repository root, not against `location`** — `install.lua` joins it
to the clone directory while `location` is applied separately to the compile directory. Writing
`queries = "queries"` therefore points at a `queries/` that does not exist at the root of this
repository, and the failure is that highlights simply do not get installed. Hence the full path above.

Naming the filetype `redextape_lambda`, the same as the parser, is what lets `vim.filetype.add` stand
alone; a different filetype name would need
`vim.treesitter.language.register("redextape_lambda", "<filetype>")` as well.

**`master` branch:**

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
parser_config.redextape_lambda = {
  install_info = {
    url = "https://github.com/Davey-Hughes/redextape",
    files = { "src/parser.c" },
    location = "grammars/tree-sitter-redextape-lambda",
  },
  filetype = "rxlambda",
}

vim.filetype.add({ extension = { rxlambda = "rxlambda" } })
```

`master` has no `queries` field and `:TSInstall` does not copy query files, so copy
`queries/highlights.scm` to `queries/redextape_lambda/highlights.scm` somewhere on your `runtimepath`
yourself.

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

### Helix

In `~/.config/helix/languages.toml`, which merges over the shipped one:

```toml
[[grammar]]
name = "redextape_lambda"
source = { git = "https://github.com/Davey-Hughes/redextape", rev = "<commit sha>", subpath = "grammars/tree-sitter-redextape-lambda" }

[[language]]
name = "redextape_lambda"
scope = "source.rxlambda"
file-types = ["rxlambda"]
```

Then:

```bash
hx --grammar fetch && hx --grammar build
```

`grammar` is omitted from `[[language]]` on purpose — it defaults to `name`, and both are
`redextape_lambda`.

**No `comment-tokens` and no `indent` here, unlike the sibling's block, and both omissions are
deliberate.** The λ form has no comment syntax at all, so there is no token to give; and
`print_lambda_mapped` writes a single line with no indentation, so any `indent` setting would be an
opinion with nothing in the Rust tree to check it against.

Helix looks for queries in its runtime directory, so copy `queries/highlights.scm` to
`~/.config/helix/runtime/queries/redextape_lambda/highlights.scm`. `hx --health redextape_lambda` will
tell you whether it found both the grammar and the highlights.

### Zed

**Zed can install a grammar from a subdirectory. The key is `path`, and it is undocumented.** Verified
by reading Zed's own source rather than its docs, because its docs page for language extensions shows
only `repository` and `rev` and does not mention the key at all:

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

`extension_builder.rs` clones the repository and then joins `path` before looking for `src/parser.c`.
Two shipped extensions rely on it — `zed-extensions/ocaml` uses `path = "grammars/ocaml"` and
`path = "grammars/interface"` from a single repository, and `zed-extensions/php` uses `path = "php"`.
The OCaml case is the shape this repository is in, just with more of it: **four grammars, one
clone.**

Zed has no equivalent of nvim's `install_info`: a grammar is installed by *an extension*, so this is a
small repository of its own rather than a config block.

```
redextape-lambda-zed/
├── extension.toml
└── languages/
    └── redextape_lambda/
        ├── config.toml
        └── highlights.scm
```

`extension.toml`:

```toml
id = "redextape-lambda"
name = "Redextape λ"
description = "Redextape λ text form support."
version = "0.1.0"
schema_version = 1
authors = ["davey"]
repository = "https://github.com/Davey-Hughes/redextape"

[grammars.redextape_lambda]
repository = "https://github.com/Davey-Hughes/redextape"
commit = "<full 40-character commit sha>"
path = "grammars/tree-sitter-redextape-lambda"
```

`languages/redextape_lambda/config.toml`:

```toml
name = "Redextape λ"
grammar = "redextape_lambda"
path_suffixes = ["rxlambda"]
```

No `line_comments` key, for the reason given under Helix.

Install it with `zed: install dev extension` from the command palette, pointed at that directory.

Three things about the Zed route that are worth knowing before you take it:

- **`commit` is an alias for `rev`, and it must be a full 40-character SHA.** Zed fetches it with
  `git fetch --depth 1 origin <rev>`, which requires the server to serve an unadvertised object by SHA.
  If your host refuses, give a branch or tag name instead.
- **The queries live in the extension, not in the grammar.** Zed reads
  `languages/redextape_lambda/highlights.scm` from the *extension* repository, so
  `grammars/tree-sitter-redextape-lambda/queries/highlights.scm` has to be copied across — and it will
  drift from this one unless someone keeps it in step. Nothing in this repository's CI can see that
  copy.
- **Zed's capture vocabulary is not identical to the standard one.** Expect to adapt the copy rather
  than paste it verbatim, and note that when you do, it is no longer the file
  `crates/redextape-grammar-check` checks.

The grammar table key must be `snake_case`; `redextape_lambda` qualifies.

## What the grammar covers

`grammar.js` is **78 lines** — under half the mini-language's 171, which is what a four-token
language costs. (Both figures grew by a comment in PR 3, which closed the U+000B item this file
describes above; they read 75 and 156 before that.)
`queries/highlights.scm` holds **nine patterns** over **five capture names**, and
`lambda::CAPTURE_CLASSES` has **five rows**, one per name, checked total in both directions
(`the_capture_map_is_total_over_the_queries`, `every_map_row_is_used_by_a_query`).

**`source_file` accepts empty and whitespace-only input; the authority does not.** `parse_lambda`
errors *"expected a term"* on both. That is deliberate rather than a divergence: `optional(...)` at
`source_file` is the tree-sitter convention and it is the right one for an editor, where an empty or
still-being-typed buffer is not an error worth underlining. Do not "fix" this into matching the
authority — it would make every new file open red.

**The two precedences are load-bearing and they say two different things.** `abstraction` is
`prec.right`, so a binder's body runs as far right as it can — `λx. f x` is `λx. (f x)`, never
`(λx. f) x` — which is what `parse_abstraction` calling `parse_term` (not `parse_atom`) produces.
`application` is `prec.left(1)`, above `abstraction`'s implicit 0, so at the shift/reduce choice
between taking another argument and closing an enclosing abstraction body early, application keeps
shifting: `f λx. x y` is `f (λx. x y)`.

**A bare abstraction is a legal argument** — `f λx. x` parses as `f (λx. x)`, because
`parse_application`'s loop tests for `'\\' | 'λ' | '(' | is_ident_start` before calling `parse_atom`,
whose first arm on `\`/`λ` is `parse_abstraction`. An earlier draft of this grammar excluded
`abstraction` from `_atom` and from `argument`, which turned that input into an ERROR node **and
mis-parented the abstraction as a sibling of `source_file`**. Nothing downstream could have caught it:
`print_lambda` always parenthesizes an abstraction in argument position, so the printed corpus never
contains the shape, and the differential compares spans and is blind to tree shape regardless. It was
found by reading `parse_application` and `parse_atom` *together*. `test/corpus/terms.txt` now pins
both it and the follow-on shape `λx. x λy. y`.

`function` stays `choice($.application, $._atom)` — deliberately **not** widened the same way. An
unparenthesized abstraction always swallows everything to its right, so it can never be a function
subterm unless parenthesized, and adding it there would describe a shape the authority cannot produce.

**All four field names are load-bearing for `queries/highlights.scm`**, so renaming one means editing
both files and rerunning the differential: `abstraction` `parameter:`/`body:` and `application`
`function:`/`argument:`. Unlike the sibling grammar, which defines several fields no query reads,
there are no spare fields here — every one is referenced, because scoping the occurrence patterns by
position is what keeps `@variable` from colliding with `@variable.parameter` on a binder's name.

The occurrence positions are **exhaustive against `grammar.js`**, traced rather than sampled:
`identifier` is reachable only through the hidden `_atom` rule, `_atom` appears in exactly three
places (`application`'s `function` and `argument` fields, and the hidden `_term`), and `_term` appears
in exactly three (`source_file`, `abstraction`'s `body`, and inside `parenthesized_term`). Five
positions, five patterns, and the parameter field is not among them — it is typed `$.identifier`
directly and never reached through `_atom`.
