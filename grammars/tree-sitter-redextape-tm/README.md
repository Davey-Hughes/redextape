# tree-sitter-redextape-tm

A tree-sitter grammar for the **redextape TM text form** — the flat, line-oriented, human-readable
language a `Machine` prints to and `parse_tm` reads back. One of four grammars in this repository,
alongside `tree-sitter-redextape` (the mini-language), `tree-sitter-redextape-lambda` (the λ form), and
`tree-sitter-redextape-rxm` (the rxm form).

**It is for highlighting and it is not authoritative.** The hand-written parser in
`redextape_core::tm::syntax` is the semantic source of truth and owns the canonical printer. This
grammar produces a CST and never lowers it into anything.

It colours two kinds of editor. `web/src/colour.ts` loads its committed
`tree-sitter-redextape-tm.wasm` and `queries/highlights.scm` through `web-tree-sitter`, and the
editor in the web app's TM view, where a TM copy is edited, is coloured from them. External editors
take it as *Installing it in an editor* describes.

## The form, in one page

```
file       := line*
line       := blank | ';' ...            whole-line comment, after leading whitespace
            | 'tapes' NAT                1..=MAX_TAPES (64)
            | 'start' NAME
            | DIRECTIVE REST             version | encoding | width | slots | result | reduced | steps | tape
            | 'state' NAME ':' ['accept']
            | RULE
RULE       := '[' SYM* ']' '->' 'write' '[' SYM* ']' ',' 'move' '[' MOVE* ']' ',' 'goto' NAME
SYM        := '*' | <single char>        `_` is the blank, `*` the wildcard / unchanged marker
MOVE       := 'L' | 'R' | 'S'
```

Every line kind also accepts a trailing `;` comment: the parser splits each line at its **first** `;`
before doing anything else.

Four things about it shaped this grammar:

**1. State names are extremely permissive.** The rule for a name that round-trips is "no whitespace
or reserved `; * : [ ]`" (`syntax.rs`'s module doc), so `wl1s2.s.sk0` and `add4.a.c.cwb` are single
names — dots and digits are ordinary characters anywhere. That rule is the printer's, and this
grammar's `identifier` follows it; `parse_tm_full` is looser still, as the accept-less divergences
below show. Nothing like λ's `[_$A-Za-z][_$A-Za-z0-9]*` or the mini-language's identifier rule
applies. A grammar that reused either would reject most of every machine this compiler emits.

**2. There is really only one bare-word lexical class.** A state name, an encoding name (`unary`), a
result type (`List<Nat>`) and a packed tape run (`#0000#0000#`) all fall inside it. They are one
`identifier` token here, told apart by the **field** they sit in — which is what lets `state pc0:` be
a `@label` and `goto pc0` a `@label.reference` without two identically-patterned tokens fighting in
the lexer.

**3. A tape's cells are one lexeme; a rule's symbols are one lexeme each.** `write_header` pushes a
single span for a whole packed run (its own comment: *"a 120-cell bank would otherwise contribute 120
adjacent identical spans for no gain"*), while `write_syms` pushes one span per symbol inside `[..]`.
Same-looking text, two span shapes, so `cells` and `symbol` are two different nodes.

**4. There are two printers and they emit different class sets.** `print_tm_inner` is the one printer
and the header `Option` is the only difference between the entry points:

| printer | header | classes emitted |
|---|---|---|
| `print_tm_mapped` | `None` | 7 — `Keyword`, `Label`, `Move`, `Nat`, `Punct`, `StateName`, `TapeSymbol` |
| `print_tm_with_mapped` | `Some(h)` | 9 — those, plus `Comment` and `Ident` |

Measured on `1 + 2`: 3,163 spans header-less, as `tm::printed_machine` lowers it at `Unary::at(8)`,
and 3,177 headered, as `run_tm_described` prints it under its own `width 4` header.

**A reduced header's `fold` needs a token `identifier` cannot swallow.** `identifier` is
`[^\s;*:\[\]]+` — it admits `,` and stops only at whitespace, so a stage name survives exactly when
something other than the printer's `,` follows it. `single-tape 5` and `two-symbol _#` are followed by a
space, so `identifier` covers the name and no more; `fold` is followed straight by `,`, so `identifier`
covers `fold,` as one token and the rule ERRORs. `fold` is therefore written `/fold\r?/`. Measured, each
form regenerated and run on `reduced fold, single-tape 5`:

| `fold` token | in generated `ts_lex_keywords` | parse |
|---|---|---|
| `token('fold')` | yes, as `anon_sym_fold` | `ERROR` |
| `token(/fold/)` | yes, as `aux_sym_fold_token1` | `ERROR` |
| `token(/fold\r?/)` | no | parses |

Extraction tracks the outcome across all three: keeping the token out of that lexer is what fixes it,
and `/fold\r?/` stays out because it matches a string `identifier` cannot, so `word` does not subsume
it. A regex token is extracted under a generated `aux_sym_*` name, so `/fold/` reads as absent to a
grep for `anon_sym_fold`. Being all letters neither causes nor prevents extraction — this grammar's
keyword lexer holds `head_move`, which is `/[LRS]/`, and omits the all-letter `version`, `encoding`
and `result`. The cost is that this grammar admits a stage name ending in `\r` MID-line, which
`parse_tm_full` refuses: that parser strips a `\r` only from a line's end, so
`reduced fold\r, single-tape 5` reaches `parse_stages` as the item `fold\r` and is a diagnostic. It
is one of the five accept-more divergences `grammar.js`'s module doc lists, and like the others it is
unreachable from printed output.

## What it is NOT, and may never become

- **Not a second parser.** The roadmap forbids two authoritative grammars; its test for
  "authoritative" is lowering a CST into Core, and nothing here does that.
- **No `locals.scm`.** A state name resolves against the machine's own state table, which
  `parse_tm_full` already does and `Machine::validate()` already checks. A query-language
  reimplementation would be a semantic claim inside a lane defined as cosmetic.
- **No indents.** The tree-sitter grammars design
  (`docs/superpowers/specs/2026-08-20-tree-sitter-grammars-design.md` §12) left indents and folds
  out because nothing in the Rust tree had an opinion about either to check one against. That
  reason does not hold for this form: `redextape fmt` formats `.tm` files by reading them with
  `parse_tm_full` and writing them back through `print_tm_doc`, which shares `print_tm_inner` and
  indents each rule line by exactly two spaces and nothing else. No indent query has been written
  against that layout; §12 calls indents addable later if an editor user asks.
- **No injections and no folds.**

## How it is checked

A **span-for-span differential** in `crates/redextape-grammar-check`: parse the text, run
`queries/highlights.scm`, project every capture through `tm::CAPTURE_CLASSES`, and assert the result
equals the printer's own classification of the same text, byte range for byte range, in offset order.
The printer is the authority; a divergence is always a defect here.

**The queries must be TOTAL over this grammar's own tokens** — a constraint exactly one of the three
siblings shares. The rxm grammar does: its `queries/highlights.scm` header states the same
requirement, and `crates/redextape-grammar-check/tests/rxm.rs` carries an
`every_printed_token_is_captured` of its own. The mini-language and λ grammars do not. TM's printer
emits a span for every non-whitespace byte it writes — separators included — so there is no
unclassified text a query could legitimately miss, and a dropped pattern shows up as a length
mismatch rather than as a merely uncoloured character. `every_printed_token_is_captured` names that
property directly.

Three corpora, because the two printers reach different classes and a reduced header reaches tokens no
other file carries:

| corpus | printer | how it is built | size |
|---|---|---|---|
| generated | `print_tm_mapped` | `parse` → `desugar` → `lower_rxm` → `lower_tm` | 32 proptest cases |
| headered | `print_tm_with_mapped` | `parse` → `result_type` → `desugar` → `run_tm_described` | 5 fixed (program, encoding) pairs over 4 programs |
| reduced | `print_tm_with_mapped` | the headered path, then `reduce` | 4 fixed reductions of `3 - 5` |

**The reduced row reuses the headered printer** and is there for the text only a reduced header
carries: a `reduced` line's stage names, its tape counts, its commas and its symbols. One of the four
reductions lists two stages, so a comma is compared too.

**32 is a measurement, not a default.** A printed TM machine is large, and the leg prints its span
total on every run (`tm generated leg: … spans compared`, shown with `--no-capture`). The total
moves with the seed. Proptest's default of 256 cases would compare eight times as many on every run.

**The headered leg simulates, and that is bounded on purpose.** `run_tm_described` is the
production header path (`crates/redextape-core/examples/tm_emit.rs` and `examples/regen_fixtures.rs`
both call it, and the two fixtures `regen_fixtures.rs` writes, `tests/fixtures/list_1_2.tm` and
`list_1_2_binary.tm`, are its output), so its header is one the rest of the project already agrees
is correct. It is held to `TM_DEFAULT_CAPS`, a fixed hand-chosen program list, and small programs
only. `MAX_MACHINE_STATES` in `tm/build.rs` caps the states a lowering builds at 1,000,000;
`docs/superpowers/notes/2026-10-17-code-history-probes.md` (under `state_cost_probe.rs`) records
what an uncapped lowering cost.

**A browser leg checks the artefact `web/` loads.** This crate compiles `parser.c` through `cc` and
has no wasm build, so the two sides meet in a file: `tests/golden.rs` prints one headered fixture,
the program `1` lowered in unary through `printed_machine_with_header`, holds it to the printer's
classification, and holds `grammars/capture-golden.json` equal to the captures this crate computes
for it. `web/tests/browser/grammar-differential.test.ts` loads the committed
`tree-sitter-redextape-tm.wasm` under `web-tree-sitter`, collapses its captures with the app's own
`colourSpans`, and compares them with that file. Of the legs here, it is the only one that loads the
`.wasm`.

### What the differential does NOT reach

Three comment positions, and they rest on hand-written corpus entries checked by `tree-sitter test`
plus a `parse_tm` assertion — **weaker than the differential, because that pair checks that the text
parses under both descriptions, not that any capture agrees with a classification**:

1. **A whole-line `;` comment.** No printer emits one.
2. **A trailing `;` comment on a line that is not a named `tape` line.** `parse_tm_full` accepts one
   after every line kind; `write_header` writes one only after `tape <i>`.
3. **`; stack`, `; heap`, `; box`.** The printer *would* write these — `tape_name` names indices 2, 3
   and 4 — but those tapes start empty and `TmHeader::new` drops empty tapes, so nothing in the
   pipeline ever produces a `tape 2` line. Reachable in principle, unreachable in fact.

Closing these properly means a `classify_tm` over *authored* text, which is LSP-shaped work and
deferred.

### Divergences from `parse_tm_full`, stated

The inputs below were each run through both `parse_tm_full` and this grammar on 2026-11-15. They are
the divergences a probe found, not a proof that there are no others. The differential sees none of
them: `compare_classified` fails on any `ERROR` or `MISSING` node, so no corpus that passes holds
an accept-less spelling, and the accept-more ones are text the printer does not write.

**Accept-more: this grammar parses clean text `parse_tm_full` rejects.** Five are deliberate, the
five `grammar.js`'s module doc lists, and all are the right direction for an editor — where a
half-typed buffer is not an error worth underlining:

1. **One construct per line is not enforced.** The authority splits on `\n` and dispatches on the
   leading token; here the newline is in `extras`.
2. **Header directives are not required to precede the first `state`**, where `header_position`
   returns a diagnostic if they do not.
3. **A header is not required to be complete.** `HeaderParts::finish` answers *"incomplete header:
   missing …"* unless all four of `encoding`/`width`/`slots`/`result` are present once any of them is,
   and separately rejects a `tape <i>` whose index falls outside `0..n_tapes`. Both are whole-file
   properties, and a CST is the wrong place to check them.
4. **A `reduced` line's stages need not be strictly ascending**, which `header.rs`'s `is_stage_list`
   demands. `reduced fold, fold, fold` and `reduced single-tape 5, fold` both parse here and are
   diagnostics there.
5. **A stage name may end in a `\r` mid-line**, because `fold` is `/fold\r?/`. The authority strips a
   `\r` only from a line's end, so `reduced fold\r, single-tape 5` reaches `parse_stages` as the item
   `fold\r`, matches no stage name, and is a diagnostic.

The others are checks the authority makes on a directive's value or across the file, which this
grammar's rules do not make:

- a tape count outside `1..=64`, `tapes 0` or `tapes 65`: `` expected `tapes <1..=64>` ``.
- `version 7`: `` unsupported header version `7` (this build reads versions 1 and 2) ``.
- an encoding name other than `unary` or `binary`, such as `encoding banana`.
- a `result` type that is not a value type, such as `result Banana`.
- a directive given twice, such as a second `width`: `` duplicate `width` directive ``.
- a `goto` that names no state: `` unknown goto target `nowhere` ``.

**Accept-less: this grammar ERRORs on text `parse_tm_full` accepts with no diagnostic.** In each,
the authority reads more loosely than the printed form. They run against an editor's interest,
since a file the authority reads shows an `ERROR`, and `grammar.js`'s module doc calls this
direction a defect:

- a state name with a space or a `*` in it: `state foo bar: accept` with `start foo bar`, or
  `state a*b: accept` with `start a*b`. The authority takes a state's name as the trimmed text
  before its `:`, and `start`'s as the rest of the line; this grammar's `identifier` stops at
  whitespace and at `; * : [ ]`.
- spaces inside a type, `result List< Nat >`. `ty::parse_ty` trims inside each `List<…>`.
- whitespace other than space, tab, CR and LF, such as a form feed before a line or a no-break space
  after `tapes 1`, `state a:` or `state b: accept`. The authority trims with `str::trim_start` and
  `str::trim`, which take any Unicode whitespace; this grammar's `extras` are those four characters
  only. After a line that ends in an `identifier`, such as `start a` or `goto b`, a no-break space
  parses clean, because the `identifier` token takes it in.
- a comma after a `two-symbol` stage's symbols, `reduced two-symbol _#, fold`. `two-symbol` is
  always the last stage, so the authority reads the rest of the line, `_#, fold`, as its symbols.
  Here `symbols` is one `identifier`, which takes `_#,` and stops at the space, so what follows is
  an `ERROR` — an accident of the token, not a check.

Two shapes are deliberately **not** accepted, for the same reason in reverse: `<state 7>`
(`write_state_name`'s fallback for an out-of-range `next`, which `Machine::validate()` rejects) and
`result (Nat, Nat) -> Nat` (`show` can render a `Ty::Fun`, but the header parser requires a value
type). Widening the grammar to admit either would be shaping a rule around text no authority produces.

## Regenerating

```bash
cd grammars/tree-sitter-redextape-tm
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
which accepts ABI 13 to 15 — so the unit test `tm::tests::abi_version_is_pinned` in `src/tm.rs`
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

### `.tm` collides with Tcl

`tree-sitter.json` claims the `tm` extension, because that is what this project's architecture doc and
`crates/redextape-core/examples/tm_emit.rs` call these files. Stock Neovim already maps `.tm` to
`tcl`; Helix ships no mapping for it. **If your editor already knows `.tm`, you have to say which
wins** — with `vim.filetype.add` in Neovim, `file-types` in Helix, or `path_suffixes` in Zed, all
shown below. There is no way for this grammar to resolve that for you.

### The name is `redextape_tm`

Every editor loads the parser by looking up the C symbol `tree_sitter_<name>`, and this grammar
exports `tree_sitter_redextape_tm` (`grep -n 'TS_PUBLIC const TSLanguage' src/parser.c`). Its three
siblings in the same repository export `tree_sitter_redextape`, `tree_sitter_redextape_lambda`, and
`tree_sitter_redextape_rxm`. **All four install from the same clone at different subdirectories**, so
getting the name wrong loads a different language rather than failing to find one.

(**"clone" is loose for one of the three editors below.** Helix and Zed both really do clone this
repository. nvim-treesitter's `main` branch fetches a per-grammar tarball instead — see the Neovim
section. The point survives either way: one source repository, four subdirectories, four distinct
symbols.)

The snippets below are adapted from the sibling READMEs, where the non-obvious parts were verified
against upstream source. Re-checked 2026-08-21: nvim-treesitter `main`'s `install.lua` still joins
`install_info.queries` to the **clone root** while applying `location` only to the compile directory,
and Zed's `GrammarManifestEntry` still carries the undocumented `path` key with `commit` as a serde
alias for `rev`.

**Unlike the λ grammar, this form HAS comment syntax**, so the comment settings below are real rather
than omitted: `;` starts a line comment.

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
    require("nvim-treesitter.parsers").redextape_tm = {
      install_info = {
        url = "https://github.com/Davey-Hughes/redextape",
        location = "grammars/tree-sitter-redextape-tm",
        queries = "grammars/tree-sitter-redextape-tm/queries",
        -- revision = "<commit sha>",   -- optional; pins the grammar
      },
    }
  end,
})

vim.filetype.add({ extension = { tm = "redextape_tm" } })
```

Then `:TSInstall redextape_tm`.

**`queries` is resolved against the repository root, not against `location`** — `install.lua` joins it
to the clone directory while `location` is applied separately to the compile directory. Writing
`queries = "queries"` points at a `queries/` that does not exist at this repository's root, and the
failure is silent: highlights simply do not get installed.

That `vim.filetype.add` line is also what takes `.tm` from `tcl`, stock Neovim's mapping for it.

**`master` branch:**

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
parser_config.redextape_tm = {
  install_info = {
    url = "https://github.com/Davey-Hughes/redextape",
    files = { "src/parser.c" },
    location = "grammars/tree-sitter-redextape-tm",
    branch = "main",
  },
  filetype = "tm",
}

vim.filetype.add({ extension = { tm = "tm" } })
```

**`branch = "main"` is required.** Without it `master` asks GitHub for `archive/master.tar.gz`,
which GitHub redirects to `main`, and the install then fails because the archive has no
`redextape-master` directory to move.

`master` has no `queries` field and `:TSInstall` does not copy query files, so copy
`queries/highlights.scm` to `queries/redextape_tm/highlights.scm` somewhere on your `runtimepath`
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
name = "redextape_tm"
source = { git = "https://github.com/Davey-Hughes/redextape", rev = "<commit sha>", subpath = "grammars/tree-sitter-redextape-tm" }

[[language]]
name = "redextape_tm"
scope = "source.tm"
file-types = ["tm"]
comment-tokens = ";"
```

Then:

```bash
hx --grammar fetch && hx --grammar build
```

`grammar` is omitted from `[[language]]` on purpose — it defaults to `name`, and both are
`redextape_tm`. `comment-tokens` is the modern key; older Helix called it `comment-token`, singular.
No `indent` here. `redextape fmt` indents each rule line by two spaces (see *What it is NOT*), so
add `indent = { tab-width = 2, unit = "  " }` if you want Helix to agree with it.

Helix looks for queries in its runtime directory, so copy `queries/highlights.scm` to
`~/.config/helix/runtime/queries/redextape_tm/highlights.scm`. `hx --health redextape_tm` reports
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
uses two `path` values from one repository, which is exactly the shape this repository is in:
**four** grammars in one clone.

```
redextape-tm-zed/
├── extension.toml
└── languages/
    └── redextape_tm/
        ├── config.toml
        └── highlights.scm
```

`extension.toml`:

```toml
id = "redextape-tm"
name = "redextape TM"
description = "redextape TM text form support."
version = "0.1.0"
schema_version = 1
authors = ["davey"]
repository = "https://github.com/Davey-Hughes/redextape"

[grammars.redextape_tm]
repository = "https://github.com/Davey-Hughes/redextape"
commit = "<full 40-character commit sha>"
path = "grammars/tree-sitter-redextape-tm"
```

`languages/redextape_tm/config.toml`:

```toml
name = "redextape TM"
grammar = "redextape_tm"
path_suffixes = ["tm"]
line_comments = [";"]
```

Install it with `zed: install dev extension` from the command palette, pointed at that directory.

Three things worth knowing before taking the Zed route:

- **`commit` is an alias for `rev`, which takes a full 40-character commit SHA or a branch name,
  not a tag.** Zed runs `git fetch --depth 1 origin <rev>` and then `git checkout <rev>`; fetching a
  tag by name stores no tag ref, so the checkout fails. Fetching by SHA needs the server to serve an
  unadvertised object. If your host refuses, give a branch name.
- **The queries live in the extension, not in the grammar.** Zed reads
  `languages/redextape_tm/highlights.scm` from the *extension* repository, so this grammar's copy has
  to be duplicated across and will drift unless someone keeps it in step. Nothing in this
  repository's CI can see that copy.
- **Zed's capture vocabulary is not identical to the standard one.** Expect to adapt rather than paste
  — and note that once you do, it is no longer the file `crates/redextape-grammar-check` checks.

## What the grammar covers

`grammar.js` is **177 lines**, against the mini-language's **164**, rxm's **160** and λ's **77** — what
a fifteen-keyword, line-oriented form with three stage names costs, plus the comments recording what
`fold`'s own token admits. `queries/highlights.scm`
holds **15 patterns** over **11 capture names**, and `tm::CAPTURE_CLASSES` has **11 rows**, checked
total in both directions (`the_capture_map_is_total_over_the_queries`,
`every_map_row_is_used_by_a_query`) and each one exercised at least once over the corpus
(`every_tm_query_pattern_fires_over_the_corpus`). `src/parser.c` is **74,423 bytes** at ABI 15.
`test/corpus/` holds **17** `tree-sitter test` cases, the last three pinning divergences 4 and 5 — the
stage lists and the mid-line `\r` this grammar admits where `parse_tm_full` refuses them — so a change
in what it accepts there fails a test rather than only staling a sentence. The `\r` case carries a
literal CR, which `scripts/check-text-bytes.sh` allows: CR, TAB and LF are the C0 bytes on its list.

**Eleven capture names for nine classes**, and both duplicate pairs are deliberate. `@variable`
(`encoding`'s operand) and `@type` (`result`'s operand) both project to `Ident` — `write_header`'s own
comment says why the class is `Ident` for each, and splitting the *capture* is what gets
`result List<Nat>` coloured as a type in an editor. `@punctuation.bracket` and
`@punctuation.delimiter` both project to `Punct`, as in the mini-language and λ grammars. The rxm
grammar does not share this: its `CAPTURE_CLASSES` table has no `punctuation.bracket` row at all,
because the rxm form has no brackets.

**`@label` and `@label.reference` are the pair the design's capture vocabulary section exists for.**
`TokenClass` distinguishes `Label` (a state name where it is defined) from `StateName` (the same name
as a `start` or `goto` target), and the standard capture vocabulary has no clean pair for that. The
dotted name works because of a property of the consumers rather than of tree-sitter: nvim-treesitter
and Helix both fall back to a dotted capture's prefix when the theme has no rule for the full name, so
an editor with no opinion about `@label.reference` colours it as `@label` — correct, if less specific
— while the projection map still sees two distinct keys.

**Nothing in `queries/highlights.scm` overlaps**, which is a stronger position than the
mini-language's. There, a broad `(identifier) @variable` deliberately overlaps the role-specific
patterns and is sound only because every identifier role projects to `Ident`. Here they do not: the
same name is `Label` in one position and `StateName` in another, so a catch-all would ask for `Ident`
where the printer says something else. `a_conflicting_query_is_rejected` runs exactly that catch-all —
the edit a future reader is most likely to make — and asserts it is refused rather than silently
collapsed.

**Rules nest inside their state.** `parse_tm_full` attaches each rule line to `states.last_mut()`, so
nesting is what the authority already means, and it gives an editor something to fold. An `accept`
state carries no rules — `print_tm` drops them and `Machine::validate()` rejects any that survive — so
the choice between `accept` and a rule list is exclusive here too.

**The fields the queries read are load-bearing**, so renaming one means editing
`queries/highlights.scm` and rerunning the differential: `state` `name:`, `start`/`rule` `target:`,
`encoding` `name:`, `result` `type:`, `tape` `cells:` and `two_symbol` `symbols:`. Telling one
bare-word token apart by its field is the whole mechanism for those. Four more are spare, as in the
mini-language grammar: `tape`'s `index:` and `rule`'s `read:`, `write:` and `move:` are defined in
`grammar.js` and read by no query.
