# Grammars

Tree-sitter grammars for redextape's text formats, one per format. The site colours its source
editor with the first, and Neovim, Helix and Zed can use all four.

| Grammar | Extension | What a file holds |
|---|---|---|
| [tree-sitter-redextape](tree-sitter-redextape/) | `.rxt` | a program in the source language |
| [tree-sitter-redextape-lambda](tree-sitter-redextape-lambda/) | `.rxlambda` | a λ-term in redextape's λ notation |
| [tree-sitter-redextape-rxm](tree-sitter-redextape-rxm/) | `.rxm` | a program for rxm, the register machine `.rxt` compiles through |
| [tree-sitter-redextape-tm](tree-sitter-redextape-tm/) | `.tm` | a Turing machine: its tapes, states and rules |

The grammars are for colouring only. The parsers in `redextape-core` decide what a file means, and
nothing in the compiler reads a tree-sitter tree. Each grammar's README covers its format, what the
grammar leaves out, how it's checked and the full editor setup.

## Where they're used

On the site, `web/src/colour.ts` loads `tree-sitter-redextape`'s committed `.wasm` and
`queries/highlights.scm` through `web-tree-sitter`, and they colour the source editor. The λ, rxm
and TM grammars colour external editors only.

In other editors the grammars do all the colouring. The language server, `redextape-lsp`, sends no
semantic tokens, so where it runs as well the two don't compete. Of the setups below, only the
Neovim plugin starts it.

## Editor setup

Every setup below fetches from the GitHub mirror, `https://github.com/Davey-Hughes/redextape`,
because the project's own git host doesn't allow anonymous clones. Each grammar's README has
[the details](tree-sitter-redextape/README.md#installing-it-in-an-editor).

### Neovim

With lazy.nvim and nvim-treesitter's `main` branch, add the repository as a plugin:

```lua
{ "Davey-Hughes/redextape", lazy = false }
```

and install the parsers once:

```vim
:TSInstall redextape redextape_rxm redextape_lambda redextape_tm
```

The repository's `plugin/redextape.lua` registers the grammars, claims the extensions, starts the
highlighter and starts `redextape-lsp` if it finds a built binary. `.tm` is also Neovim's extension
for Tcl, so the plugin takes a `.tm` file only when its text looks like a Turing machine or its path
has a directory named `redextape`.

The plugin uses `main`'s API, so on nvim-treesitter's `master` branch it registers no parsers.
There, follow the hand-written setup in each grammar's
[editor section](tree-sitter-redextape/README.md#installing-it-in-an-editor) instead. Keep the
block's `branch = "main"`: without it `master` asks for an archive named after the wrong branch and
the install fails. For colour you also copy `highlights.scm` onto your `runtimepath` and add a
`FileType` autocmd, which the same section shows.

### Helix

Add a `[[grammar]]` and a `[[language]]` entry per grammar to `~/.config/helix/languages.toml`, run
`hx --grammar fetch && hx --grammar build`, and copy each grammar's `queries/highlights.scm` into
Helix's runtime directory. The entries are in each README:
[`.rxt`](tree-sitter-redextape/README.md#helix),
[`.rxlambda`](tree-sitter-redextape-lambda/README.md#helix),
[`.rxm`](tree-sitter-redextape-rxm/README.md#helix),
[`.tm`](tree-sitter-redextape-tm/README.md#helix).

### Zed

Zed installs a grammar through an extension, so you write a small one of your own for each
grammar: an `extension.toml` naming the grammar's path in this repository, a `config.toml` for the
language and a copy of its `highlights.scm`, installed with `zed: install dev extension`. Its `rev`
(or `commit`) has to be a branch name or a full 40-character commit SHA; a tag fails to check out.
The files are in each README:
[`.rxt`](tree-sitter-redextape/README.md#zed),
[`.rxlambda`](tree-sitter-redextape-lambda/README.md#zed),
[`.rxm`](tree-sitter-redextape-rxm/README.md#zed),
[`.tm`](tree-sitter-redextape-tm/README.md#zed).

## How they're checked

`scripts/check-all.sh` regenerates each grammar's `src/` with the pinned tree-sitter CLI (0.25.10,
which `scripts/setup-dev.sh` installs), fails if the result differs from what's committed, and runs
`tree-sitter test` on each grammar's corpus. `crates/redextape-grammar-check` compares every
highlight capture, span by span, with the Rust code in `redextape-core` that classifies or prints
that format, so a disagreement is the grammar's bug. A browser test loads the committed `.wasm`
files and holds their captures to `capture-golden.json`, which that crate writes and checks, and
`scripts/check-grammar-wasm.sh` checks each `.wasm` against the `parser.c` it was built from.
[Regenerating](tree-sitter-redextape/README.md#regenerating) has the commands and the reason for
the pin.

Some of the editor setup appears word for word in every grammar's README. The passages in
`shared/` are written once there and copied in between marker comments, and
`scripts/check-shared-docs.sh` fails when a copy differs: edit the file in `shared/` and run the
script with `--fix`. Text outside those markers is kept in step by hand.
