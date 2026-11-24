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
`extras` list is **ASCII-only in tree-sitter's regex engine**: it *nearly* matches the mini-language's
ASCII-only lexer — the two differ on exactly one code point, U+000B VERTICAL TAB, which `/\s/`
accepts and `is_ascii_whitespace()` rejects — and it is wrong here regardless, where U+2009 THIN SPACE
separates two atoms as far as `parse_lambda` is concerned. `grammar.js`
therefore spells the class out — the exact 25 code points in 10 ranges that `char::is_whitespace()`
accepts.

**The mini-language grammar's `extras` matches its own lexer.** It spells out
`is_ascii_whitespace()`'s five code points instead of `/\s/`, and
`the_grammar_and_the_lexer_agree_on_every_ascii_whitespace_candidate` in `redextape-grammar-check`'s
`tests/captures.rs` pins it. That test asks `parser::parse` rather than comparing spans, because
`classify_source` skips a byte the lexer rejects and emits no span for it — so the span differential
returns the same spans whether or not the grammar accepts U+000B, and cannot see that mismatch.

**Do not "harmonise" the two grammars' `extras`.** Each is exactly right for its own authority, and
they answer to different ones — copying either class into the other would break it.

## What this is for

**External editors.** The web app does not load this grammar, and the term the λ pane displays is
not coloured by it: `web/src/lambda-body.ts` colours the tree the worker serves by token kind, as
`lambda-layout.ts` lays it out, and a frame's flat text through `spans.ts`'s `decorationRanges`,
over spans the worker's printer computed from the term it holds.

Neovim, Helix, Zed and Emacs cannot call a Rust function, and `redextape-lsp` — which serves
Neovim — advertises no semantic tokens, deliberately, for the reason the mini-language grammar's
README gives. For colour there, a grammar is still the only thing that reaches them.

Worth stating plainly, because it changes what "installing" means here: **the only `.rxlambda` files
committed to this repository are CLI test fixtures under `crates/redextape-cli/tests/cmd/`.** Any
other exists only when a user writes it, for instance with
`redextape emit p.rxt --lang lambda -o p.rxlambda`, and `redextape-lsp` serves such a file when an
editor opens it. Otherwise the λ form appears as web-pane text, as
`crates/redextape-core/examples/lambda_demo.rs` output, and as strings inside tests. The extension
is declared in `tree-sitter.json` so an editor has something to bind to when it opens one.

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

Nothing in that pipeline reduces, and no λ code in this crate may: it stops at `lower`, which builds
a term, and at the printer, which writes one. A λ measurement that reduces can take 60 GiB of RAM and
all of swap. Treat any λ reduction in this crate as a defect. The TM leg's
call to `redextape_core::tm::reduce` (`src/tm.rs`'s `printed_reduced`) is a different operation, on
a Turing machine rather than a λ term, and is there on purpose.

Four layers, none of which is the same evidence twice: `tree-sitter test`, which
`scripts/check-all.sh` runs, and three in this crate.

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

A fifth runs in a browser, against the committed `.wasm`. The crate above compiles `parser.c`
through `cc` and has no wasm build, so the two sides meet in a file: `tests/golden.rs` prints one λ
fixture through `lambda::printed_term`, holds it to `print_lambda_mapped`'s classification, and
holds `grammars/capture-golden.json` equal to the captures this crate computes for it (it rewrites
the file only under `REDEXTAPE_WRITE_GOLDEN=1`). `web/tests/browser/grammar-differential.test.ts`
loads the committed `tree-sitter-redextape-lambda.wasm` under `web-tree-sitter`, collapses its
captures with the app's own `colourSpans`, and compares them with that file. Of the five layers, it
is the only one that reads the `.wasm` itself.

Two guards sit under the comparison, each for something that slips past everything else:

- **`every_query_pattern_fires`** — `Query::pattern_count` against the set of pattern indices actually
  seen over a corpus. `(parenthesized_term (identifier) @variable)` gets **no coverage from the
  printed pipeline**: `print_lambda_mapped` can never emit `(x)` at all, since `parens` is reached
  only for an `Abs` in function position and for a non-`Var` atom. The pattern is *correct* and
  stays — an editor's user can type `(x)` — and the hand-written `lambda::CORPUS` entry `f (x)`
  exercises it, which this guard proves.
  The guard is on `Grammar`, so every grammar in this repository carries it, the TM and rxm grammars
  included.
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

**The three is a number so that a gate can hold it.** A gate can hold a number to the tree and cannot
hold the word "only" to anything: a claim that only one pair collapses would be wrong here, since TWO
pairs do, and nothing would notice. A row in `scripts/check-doc-figures.sh`'s table derives the
three from `lambda::CAPTURE_CLASSES` with `map_classes`: five rows over three classes, where a single
collapsing pair would leave four.

`@variable.parameter` (`Binder`) and `@variable` (`Ident`) are
genuinely distinguished by the comparison — which is exactly why the occurrence patterns in
`queries/highlights.scm` are scoped by position instead of being a single `(identifier) @variable`
catch-all. A catch-all would capture a binder's name as `Ident` *and* `Binder` at one byte range, and
`captures_with` rejects overlapping captures that disagree. `a_conflicting_query_is_rejected` pins
that.

## Regenerating

`src/parser.c`, `src/grammar.json` and `src/node-types.json` are **committed**, and
`scripts/check-all.sh` regenerates every grammar on every run and fails if what is committed differs
from what `grammar.js` produces — and runs `tree-sitter test` for each. So a `grammar.js` edit
is not finished until the regenerated `src/` is staged alongside it.

```bash
scripts/setup-dev.sh                             # installs the pinned CLI to .tools/ (git-ignored)
cd grammars/tree-sitter-redextape-lambda
../../.tools/tree-sitter generate
../../.tools/tree-sitter test
```

**The CLI version is pinned to v0.25.10, and it sits below the newest release on purpose.** Binaries
from v0.26.1, the first 0.26 release, on need **GLIBC_2.39** and this project's CI runner has
**2.35**; every published Linux asset for those releases is the same glibc build and no musl variant
exists. Building 0.26 from source is not a way around it either — the CLI vendors QuickJS through
`bindgen`, which needs libclang, also absent on the runner. v0.25.10 needs only GLIBC_2.34 and
generates this grammar at **ABI 15**. **Do not bump this until the runner image has glibc 2.39+.**
The rest of the pin's reasoning, including why a `tree-sitter-cli-git` build's reported version cannot
choose it, is in `grammars/tree-sitter-redextape/README.md` and design §8.1.

**`tree-sitter.json` must be present.** Without it the released CLI prints a warning and *silently*
generates ABI 14. The `tree-sitter` Rust crate would load that parser without complaint —
`Cargo.lock` pins it at 0.27.1, which accepts ABI 13 to 15 — so the unit test
`lambda::tests::abi_version_is_pinned` asserts 15, and the drift fails by name.

Do not use a `tree-sitter` from `$PATH`. On this machine that resolves to Arch's `tree-sitter-cli-git`,
a `master` build that reports a version number no release ever carried; regenerating with it emits
different metadata and reddens the very check that exists to catch a stale `parser.c`.
`check-all.sh` prefers `.tools/tree-sitter` and asserts `--version` reads `0.25.10`.

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

### The name is `redextape_lambda`, and it is not interchangeable with `redextape`

Every editor below loads the parser by looking up the C symbol `tree_sitter_<name>`, and the symbol
this grammar exports is `tree_sitter_redextape_lambda` — `grammar.js` declares
`name: 'redextape_lambda'`, and `grep -n 'TS_PUBLIC const TSLanguage' src/parser.c` shows the result.
The other grammars in this repository export `tree_sitter_redextape`, `tree_sitter_redextape_tm`, and
`tree_sitter_redextape_rxm`. **All four are installed from the same clone at different
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

What changes from the sibling's snippets is names — the language, the filetypes, the subdirectory,
the scope, the file extension and the Zed extension's metadata — plus two removals: **every comment
setting**, because the λ form has no comment syntax and an editor configured with one would comment
code out into a parse error, and Helix's `indent`, for the reason given under Helix.

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
    branch = "main",
  },
  filetype = "rxlambda",
}

vim.filetype.add({ extension = { rxlambda = "rxlambda" } })
```

**`branch = "main"` is required.** Without it `master` asks GitHub for `archive/master.tar.gz`,
which GitHub redirects to `main`, and the install then fails because the archive has no
`redextape-master` directory to move.

`master` has no `queries` field and `:TSInstall` does not copy query files, so copy
`queries/highlights.scm` to `queries/redextape_lambda/highlights.scm` somewhere on your `runtimepath`
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
name = "redextape λ"
description = "redextape λ text form support."
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
name = "redextape λ"
grammar = "redextape_lambda"
path_suffixes = ["rxlambda"]
```

No `line_comments` key, for the reason given under Helix.

Install it with `zed: install dev extension` from the command palette, pointed at that directory.

Three things about the Zed route that are worth knowing before you take it:

- **`commit` is an alias for `rev`, which takes a full 40-character commit SHA or a branch name,
  not a tag.** Zed runs `git fetch --depth 1 origin <rev>` and then `git checkout <rev>`; fetching a
  tag by name stores no tag ref, so the checkout fails. Fetching by SHA needs the server to serve an
  unadvertised object. If your host refuses, give a branch name.
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

`grammar.js` is **77 lines** — under half the mini-language's 164, which is what a four-token
language costs.
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
whose first arm on `\`/`λ` is `parse_abstraction`. Narrowing `argument` to `_atom`, which has no
`abstraction`, would turn that input into an ERROR node holding `f` next to a bare abstraction under
`source_file`. The printed corpus never contains the shape, because `print_lambda` always
parenthesizes an abstraction in argument position, and the differential compares spans and cannot
see tree shape. So only hand-written input catches it: `test/corpus/terms.txt` and `lambda::CORPUS`
both pin it and the follow-on shape `λx. x λy. y`.

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
