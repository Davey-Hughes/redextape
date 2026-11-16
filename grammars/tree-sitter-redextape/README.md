# tree-sitter-redextape

A tree-sitter grammar for the redextape mini-language — the `.rxt` source form that
`crates/redextape-core` parses. Scope `source.rxt`, file extension `.rxt`.

## What this is for

**The web app's source editor, and external editors.** `web/src/colour.ts` loads this grammar's
committed `tree-sitter-redextape.wasm` and `queries/highlights.scm` through `web-tree-sitter`, and
the source editor is coloured from them. The Plan 7 part 3 design
(`docs/superpowers/specs/2026-09-20-plan7-part3-editor-intelligence-design.md` §6.1) gives the
reasons. `redextape_core::analysis::classify_source` colours nothing in `web/`; it stays the
authority the differential below holds this grammar to.

Neovim, Helix, Zed and Emacs cannot call into `redextape-core` at all. `redextape-lsp` reaches
Neovim over those same front ends — but with diagnostics, formatting, hover and navigation, and it
advertises **no semantic tokens**, deliberately: these grammars already colour all four forms there,
and a server answering the same question would compete with them rather than complete them. So
colour in an external editor is still a grammar or nothing.

## What it is NOT, and may never become

**This grammar is not authoritative, and it may never lower a CST into Core.** The hand-written front
end in `crates/redextape-core` — lexer, Pratt parser, Hindley–Milner inference — stays the semantic
source of truth, and since 2026-08-19 it owns the canonical printer as well
(`redextape_core::format` and `format_with_width`; `redextape fmt` calls the second). Any
disagreement this grammar introduces is therefore **cosmetic by construction**: it can produce a
wrong colour and it cannot produce a wrong program.

That constraint is the roadmap's, not this file's — *never maintain two authoritative grammars*. The
lane it fixes is highlighting. Deliberately absent, each for a stated reason
(`docs/superpowers/specs/2026-08-20-tree-sitter-grammars-design.md` §12):

- **no `locals.scm`** — a scope resolver is a semantic claim, and this project already has one in
  `typeck`. A second would be the closest thing here to the two authoritative grammars the roadmap
  forbids.
- **no `injections.scm`** — no form embeds another.
- **no folds, no indents** — §12's reason is that nothing in the Rust tree has an opinion about
  either to check one against. That reason does not hold for indents: `redextape fmt` indents a
  block's body four spaces (see the Helix section). No indent query has been written against that
  layout; §12 calls indents addable later if an editor user asks.

"Cosmetic by construction" is a claim rather than a guarantee, which is why the next section exists.

## How it is checked

`crates/redextape-grammar-check` compiles the committed parser through `cc` and compares **every
highlight capture against `classify_source`, span for span**. The direction is fixed: `classify_source`
is the authority and the check has no opinion of its own, so a divergence is always a defect in
`grammar.js` or `queries/highlights.scm`.

```
cargo nextest run -p redextape-grammar-check
```

Three layers, none of which is the same evidence twice: `tree-sitter test`, which
`scripts/check-all.sh` runs, and two in this crate.

| layer | what it does |
|---|---|
| `tree-sitter test` | eight tree-shape cases under `test/corpus/`, for structure the differential cannot see |
| `mini::CORPUS` in `src/mini.rs` | thirteen hand-written programs — `fn`, `while`, closures, UFCS chains, comments, `mut` — compared span for span |
| `tests/generated.rs` | proptest over `arb_expr_over`, 256 generated programs per run, same comparison |

A fourth runs in a browser, against the artefact `web/` loads. The crate above compiles `parser.c`
through `cc` and has no wasm build, so the two sides meet in a file: `tests/golden.rs` checks this
grammar's fixtures against `classify_source`, and holds `grammars/capture-golden.json` equal to the
captures this crate computes for them (it rewrites the file only under `REDEXTAPE_WRITE_GOLDEN=1`).
`web/tests/browser/grammar-differential.test.ts` loads the committed `tree-sitter-redextape.wasm`
under `web-tree-sitter`, collapses its captures with the app's own `colourSpans`, and compares them
with that file. Of the four layers, it is the only one that reads the `.wasm` itself.

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

- It is deliberately **not** the newest release. Binaries from v0.26.1, the first 0.26 release, on
  need **GLIBC_2.39** and this project's CI runner has **2.35**; every published Linux asset for
  those releases is the same glibc build and no musl variant exists, so none of them can run there.
  Building 0.26 from source is not a way around it either — the CLI vendors QuickJS through
  `bindgen`, which needs libclang, also absent. v0.25.10 needs only GLIBC_2.34 and produces
  byte-identical `grammar.json` and `node-types.json` at ABI 15. **Do not bump this until the runner
  image has glibc 2.39+.**
- It is not read off a locally installed `tree-sitter-cli-git` build, which reports the version it is
  heading toward rather than a released one; CI downloads a released binary, so a version with no
  release yet would fail there.
- **`tree-sitter.json` must be present.** Without it the released CLI prints a warning and *silently*
  generates ABI 14 instead of 15. The `tree-sitter` Rust crate would still load that parser —
  `Cargo.lock` pins it at 0.27.1, which accepts ABI 13 to 15 — so what fails is the unit test
  `mini::tests::abi_version_is_pinned`, which asserts 15 and says ABI 14 means `tree-sitter.json`
  was not picked up. The file is not decoration — it is what makes the pin reproducible.

`scripts/setup-dev.sh` installs the pinned binary into a repository-local `.tools/` rather than trusting
whatever `tree-sitter` is on `$PATH`, and `check-all.sh` prefers it and asserts `--version` reads
`0.25.10`. A different build regenerates different output and would redden the staleness
check while the work was in fact correct.

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
    require("nvim-treesitter.parsers").redextape = {
      install_info = {
        url = "https://github.com/Davey-Hughes/redextape",
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
    url = "https://github.com/Davey-Hughes/redextape",
    files = { "src/parser.c" },
    location = "grammars/tree-sitter-redextape",
    branch = "main",
  },
  filetype = "rxt",
}

vim.filetype.add({ extension = { rxt = "rxt" } })
```

**`branch = "main"` is required.** Without it `master` asks GitHub for `archive/master.tar.gz`,
which GitHub redirects to `main`, and the install then fails because the archive has no
`redextape-master` directory to move.

`master` has no `queries` field and `:TSInstall` does not copy query files, so copy
`queries/highlights.scm` to `queries/redextape/highlights.scm` somewhere on your `runtimepath` yourself.

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
name = "redextape"
source = { git = "https://github.com/Davey-Hughes/redextape", rev = "<commit sha>", subpath = "grammars/tree-sitter-redextape" }

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
name = "redextape"
description = "redextape mini-language support."
version = "0.1.0"
schema_version = 1
authors = ["davey"]
repository = "https://github.com/Davey-Hughes/redextape"

[grammars.redextape]
repository = "https://github.com/Davey-Hughes/redextape"
commit = "<full 40-character commit sha>"
path = "grammars/tree-sitter-redextape"
```

`languages/redextape/config.toml`:

```toml
name = "redextape"
grammar = "redextape"
path_suffixes = ["rxt"]
line_comments = ["// "]
```

Install it with `zed: install dev extension` from the command palette, pointed at that directory.

Three things about the Zed route that are worth knowing before you take it:

- **`commit` is an alias for `rev`, which takes a full 40-character commit SHA or a branch name,
  not a tag.** Zed runs `git fetch --depth 1 origin <rev>` and then `git checkout <rev>`; fetching a
  tag by name stores no tag ref, so the checkout fails. Fetching by SHA needs the server to serve an
  unadvertised object. If your host refuses, give a branch name.
- **The queries live in the extension, not in the grammar.** Zed reads
  `languages/redextape/highlights.scm` from the *extension* repository, so
  `grammars/tree-sitter-redextape/queries/highlights.scm` has to be copied across — and it will drift
  from this one unless someone keeps it in step. Nothing in this repository's CI can see that copy.
- **Zed's capture vocabulary is not identical to the standard one.** Expect to adapt the copy rather than
  paste it verbatim, and note that when you do, it is no longer the file
  `crates/redextape-grammar-check` checks.

The grammar table key must be `snake_case`; `redextape` qualifies.

## What the grammar covers

`grammar.js` is 164 lines. Statements: `let` (with `mut`), `fn`, `while`, assignment, expression
statements, and blocks. Expressions: binary operators with the front end's precedence, calls, method
calls (UFCS chains), `if`/`else`, closures, list literals, parenthesized expressions, identifiers,
numbers, booleans. `//` line comments are `extras`, so they may appear anywhere.

`word: $ => $.identifier` is set, which is what keeps a keyword-prefixed name from lexing as a keyword —
`let iffy = 1; let letter = 2;` parses as two `let_statement`s with `identifier` names, checked with
`tree-sitter parse` rather than assumed.

A **bare block is a legal callee, receiver and while-condition** — `{ f }(1)`, `{ f }.m(1)` and
`while { a } { b }` all parse, because `parse_postfix` in the hand-written parser accepts them.
Excluding blocks from those positions would turn all three into ERROR nodes, and the differential
would not see it, because no program in `mini::CORPUS` puts a block in those positions.
`test/corpus/expressions.txt` pins all three.

**Four field names are load-bearing for `queries/highlights.scm`**, so renaming one means editing both
files and rerunning the differential: `call_expression` `function:`, `method_call` `method:`,
`function_definition` `name:`, `parameters` `parameter:`. The grammar defines more fields than that —
`let_statement` `name:`/`value:`, `function_definition` `body:`, `assignment` `target:`/`value:`,
`while_statement` `condition:`/`body:`, `if_expression` `condition:`/`consequence:`/`alternative:`,
`method_call` `receiver:`, `closure` `body:` — and no query reads them today. They exist for a
consumer that walks the tree rather than colours it, which is not one this repository ships.
