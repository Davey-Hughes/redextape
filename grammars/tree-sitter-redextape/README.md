# tree-sitter-redextape

A tree-sitter grammar for the redextape mini-language — the `.rxt` source form that
`crates/redextape-core` parses. Scope `source.rxt`, file extension `.rxt`.

## What this is for

**External editors, and only external editors.** Everywhere this project already highlights source, it
does so by calling `redextape_core::analysis::classify_source` — `web/` renders CodeMirror decorations
straight over that function's spans, which is why Plan 5 considered a grammar for its own panes and
chose not to. Neovim, Helix, Zed and Emacs cannot make that call at all, and `redextape-lsp` (deferred
to v2) does not yet serve them either. A grammar is the only thing that reaches them. That is the whole
motivation.

## What it is NOT, and may never become

**This grammar is not authoritative, and it may never lower a CST into Core.** The hand-written front
end in `crates/redextape-core` — lexer, Pratt parser, Hindley–Milner inference — stays the semantic
source of truth, and since 2026-08-19 it owns the canonical printer as well
(`redextape_core::format`, which `redextape fmt` calls). Any disagreement this grammar introduces is
therefore **cosmetic by construction**: it can produce a wrong colour and it cannot produce a wrong
program.

That constraint is the roadmap's, not this file's — *never maintain two authoritative grammars*. The
lane it fixes is highlighting. Deliberately absent, each for a stated reason
(`docs/superpowers/specs/2026-08-20-tree-sitter-grammars-design.md` §12):

- **no `locals.scm`** — a scope resolver is a semantic claim, and this project already has one in
  `typeck`. A second would be the closest thing here to the two authoritative grammars the roadmap
  forbids.
- **no `injections.scm`** — no form embeds another.
- **no folds, no indents** — nothing in the Rust tree has an opinion about either, so there would be
  nothing to check them against.
- **nothing in `web/`** — settled in the other direction by Plan 5 and not reopened.

"Cosmetic by construction" is a claim rather than a guarantee, which is why the next section exists.

## How it is checked

`crates/redextape-grammar-check` compiles the committed parser through `cc` and compares **every
highlight capture against `classify_source`, span for span**. The direction is fixed: `classify_source`
is the authority and the check has no opinion of its own, so a divergence is always a defect in
`grammar.js` or `queries/highlights.scm`.

```
cargo nextest run -p redextape-grammar-check
```

Three layers, none of which is the same evidence twice:

| layer | what it does |
|---|---|
| `tree-sitter test` | eight tree-shape cases under `test/corpus/`, for structure the differential cannot see |
| `CORPUS` in `src/lib.rs` | thirteen hand-written programs — `fn`, `while`, closures, UFCS chains, comments, `mut` — compared span for span |
| `tests/generated.rs` | proptest over `arb_expr_over`, 256 generated programs per run, same comparison |

Malformed input is refused before comparison rather than compared leniently: `compare()` fails on any
source whose tree contains an ERROR node. That guard is load-bearing and not tidiness. `classify_source`
recovers from garbage by dropping it, and a grammar that parks the same garbage in an ERROR node drops it
too — so on `let x = @@@;` the two sides agree on all four spans and a comparison without the guard
returns `Ok` on input that does not parse.

**One gap, stated rather than left to be discovered.** `@function.call` and `@variable` both project to
`TokenClass::Ident`, so the check asserts *that* a span is an identifier and never *which kind* — a
grammar capturing every identifier as a call would pass. The finer captures are what make highlighting
good in an editor, and they rest on `tree-sitter test` and on review. Design §6.1 prices the two ways to
close it and says why neither was taken.

## Regenerating

`src/parser.c`, `src/grammar.json` and `src/node-types.json` are **committed**, and
`scripts/check-all.sh` regenerates them on every run and fails if what is committed differs from what
`grammar.js` produces. So a `grammar.js` edit is not finished until the regenerated `src/` is staged
alongside it.

```bash
scripts/setup-dev.sh                      # installs the pinned CLI to .tools/ (git-ignored)
cd grammars/tree-sitter-redextape
../../.tools/tree-sitter generate
../../.tools/tree-sitter test
```

**The CLI version is pinned to v0.25.10 and the pin is load-bearing in three directions.**

- It is deliberately **not** the newest release. Binaries from 0.26.0 on need **GLIBC_2.39** and this
  project's CI runner has **2.35**; every published Linux asset for those releases is the same glibc
  build and no musl variant exists, so none of them can run there. Building 0.26 from source is not a
  way around it either — the CLI vendors QuickJS through `bindgen`, which needs libclang, also absent.
  v0.25.10 needs only GLIBC_2.34 and produces byte-identical `grammar.json` and `node-types.json` at
  ABI 15. **Do not bump this until the runner image has glibc 2.39+.**
- An earlier pin to "0.27.0" was read off a locally installed
  `tree-sitter-cli-git` build, which reports the version it is heading toward; no such release exists and
  CI would have failed to download it.
- **`tree-sitter.json` must be present.** Without it the released CLI prints a warning and *silently*
  generates ABI 14 instead of 15, which the `tree-sitter` Rust crate then refuses to load. The file is
  not decoration — it is what makes the pin reproducible.

`scripts/setup-dev.sh` installs the pinned binary into a repository-local `.tools/` rather than trusting
whatever `tree-sitter` is on `$PATH`, and `check-all.sh` prefers it and asserts `--version` reads
`0.25.10`. A different build regenerates different output and would redden the staleness
check while the work was in fact correct.

## Installing it in an editor

### Read this before any snippet: the repository is not anonymously clonable

Every snippet below makes the editor clone this repository, and **it cannot do so without credentials.**
Measured, 2026-08-21:

```
$ curl -sS -o /dev/null -w '%{http_code}\n' \
    https://forge.daveynet.xyz/davey/redextape/info/refs?service=git-upload-pack
401

$ curl -sS https://git.daveynet.xyz/davey/redextape/info/refs?service=git-upload-pack | wc -c
0
```

`forge.daveynet.xyz` is the HTTP git host and refuses anonymous access outright, which is the honest
failure. `git.daveynet.xyz` is the **SSH** clone host; over HTTPS it answers the ref advertisement with
**HTTP 200 and a zero-byte body**, which git reads as *a repository with no refs* — `git ls-remote` exits
`0` and prints nothing. **That is a silent empty, not an error**, and an editor pointed at the HTTPS
`git.` URL will report something unhelpful rather than "you are not authorized".

So: use `ssh://git@git.daveynet.xyz/davey/redextape.git` if you have a key on the instance, or an
authenticated `https://forge.daveynet.xyz/davey/redextape` if you have a token in a credential helper.
The snippets below are written with the plain HTTPS URL because that is the address recorded in
`tree-sitter.json`; substitute whichever of the two actually authenticates for you.

### Neovim — nvim-treesitter

nvim-treesitter has **two live branches that are incompatible plugins sharing a name.** `main` is the
current rewrite and needs Neovim 0.12+; `master` is frozen and works with Neovim ≤ 0.11. Pick the one you
have installed — the `install_info` field sets are different, and fields from one are silently ignored by
the other.

**`main` branch:**

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "TSUpdate",
  callback = function()
    require("nvim-treesitter.parsers").redextape = {
      install_info = {
        url = "https://git.daveynet.xyz/davey/redextape",
        location = "grammars/tree-sitter-redextape",
        queries = "grammars/tree-sitter-redextape/queries",
        -- revision = "<commit sha>",   -- optional; pins the grammar
      },
    }
  end,
})

vim.filetype.add({ extension = { rxt = "redextape" } })
```

Then `:TSInstall redextape`.

**`queries` is resolved against the repository root, not against `location`** — `install.lua` joins it to
the clone directory while `location` is applied separately to the compile directory. Writing
`queries = "queries"` therefore points at a `queries/` that does not exist at the root of this repository,
and the failure is that highlights simply do not get installed. Hence the full path above.

Naming the filetype `redextape`, the same as the parser, is what lets `vim.filetype.add` stand alone; a
different filetype name would need `vim.treesitter.language.register("redextape", "<filetype>")` as well.

**`master` branch:**

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
parser_config.redextape = {
  install_info = {
    url = "https://git.daveynet.xyz/davey/redextape",
    files = { "src/parser.c" },
    location = "grammars/tree-sitter-redextape",
  },
  filetype = "rxt",
}

vim.filetype.add({ extension = { rxt = "rxt" } })
```

`master` has no `queries` field and `:TSInstall` does not copy query files, so copy
`queries/highlights.scm` to `queries/redextape/highlights.scm` somewhere on your `runtimepath` yourself.

### Helix

In `~/.config/helix/languages.toml`, which merges over the shipped one:

```toml
[[grammar]]
name = "redextape"
source = { git = "https://git.daveynet.xyz/davey/redextape", rev = "<commit sha>", subpath = "grammars/tree-sitter-redextape" }

[[language]]
name = "redextape"
scope = "source.rxt"
file-types = ["rxt"]
comment-tokens = "//"
indent = { tab-width = 4, unit = "    " }
```

Then:

```bash
hx --grammar fetch && hx --grammar build
```

`grammar` is omitted from `[[language]]` on purpose — it defaults to `name`, and both are `redextape`.
`comment-tokens` is the current key; `comment-token` singular still works as a back-compat alias. The
four-space `indent` is not a preference: it is what `redextape fmt` emits, checked by running it rather
than read off the printer's source, so an editor configured this way and the canonical printer will not
fight each other.

Helix looks for queries in its runtime directory, so copy `queries/highlights.scm` to
`~/.config/helix/runtime/queries/redextape/highlights.scm`. `hx --health redextape` will tell you whether
it found both the grammar and the highlights.

### Zed

**Zed can install a grammar from a subdirectory. The key is `path`, and it is undocumented.** The design
for this slice flagged Zed's subdirectory support as unverified and named a mirror repository as the
fallback; that fallback is **not needed**. Verified 2026-08-21 by reading Zed's own source rather than its
docs, because its docs page for language extensions shows only `repository` and `rev` and does not mention
the key at all:

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

Zed has no equivalent of nvim's `install_info`: a grammar is installed by *an extension*, so this is a
small repository of its own rather than a config block.

```
redextape-zed/
├── extension.toml
└── languages/
    └── redextape/
        ├── config.toml
        └── highlights.scm
```

`extension.toml`:

```toml
id = "redextape"
name = "Redextape"
description = "Redextape mini-language support."
version = "0.1.0"
schema_version = 1
authors = ["davey"]
repository = "https://git.daveynet.xyz/davey/redextape"

[grammars.redextape]
repository = "https://git.daveynet.xyz/davey/redextape"
commit = "<full 40-character commit sha>"
path = "grammars/tree-sitter-redextape"
```

`languages/redextape/config.toml`:

```toml
name = "Redextape"
grammar = "redextape"
path_suffixes = ["rxt"]
line_comments = ["// "]
```

Install it with `zed: install dev extension` from the command palette, pointed at that directory.

Three things about the Zed route that are worth knowing before you take it:

- **`commit` is an alias for `rev`, and it must be a full 40-character SHA.** Zed fetches it with
  `git fetch --depth 1 origin <rev>`, which requires the server to serve an unadvertised object by SHA.
  If your host refuses, give a branch or tag name instead.
- **The queries live in the extension, not in the grammar.** Zed reads
  `languages/redextape/highlights.scm` from the *extension* repository, so
  `grammars/tree-sitter-redextape/queries/highlights.scm` has to be copied across — and it will drift
  from this one unless someone keeps it in step. Nothing in this repository's CI can see that copy.
- **Zed's capture vocabulary is not identical to the standard one.** Expect to adapt the copy rather than
  paste it verbatim, and note that when you do, it is no longer the file
  `crates/redextape-grammar-check` checks.

The grammar table key must be `snake_case`; `redextape` qualifies.

## What the grammar covers

`grammar.js` is 156 lines. Statements: `let` (with `mut`), `fn`, `while`, assignment, expression
statements, and blocks. Expressions: binary operators with the front end's precedence, calls, method
calls (UFCS chains), `if`/`else`, closures, list literals, parenthesized expressions, identifiers,
numbers, booleans. `//` line comments are `extras`, so they may appear anywhere.

`word: $ => $.identifier` is set, which is what keeps a keyword-prefixed name from lexing as a keyword —
`let iffy = 1; let letter = 2;` parses as two `let_statement`s with `identifier` names, checked with
`tree-sitter parse` rather than assumed.

A **bare block is a legal callee, receiver and while-condition** — `{ f }(1)`, `{ f }.m(1)` and
`while { a } { b }` all parse, because `parse_postfix` in the hand-written parser accepts them. An
earlier draft of this grammar excluded blocks from those positions and turned all three into ERROR
nodes; the differential's ERROR-node guard means such input never reaches a comparison at all, so the
restriction was invisible to every test and only fell out of reading `parser.rs`.

**Four field names are load-bearing for `queries/highlights.scm`**, so renaming one means editing both
files and rerunning the differential: `call_expression` `function:`, `method_call` `method:`,
`function_definition` `name:`, `parameters` `parameter:`. The grammar defines more fields than that —
`let_statement` `name:`/`value:`, `assignment` `target:`/`value:`, `while_statement`
`condition:`/`body:`, `if_expression` `condition:`/`consequence:`/`alternative:`, `method_call`
`receiver:`, `closure` `body:` — and no query reads them today. They exist for a consumer that walks the
tree rather than colours it, which is not one this repository ships.
