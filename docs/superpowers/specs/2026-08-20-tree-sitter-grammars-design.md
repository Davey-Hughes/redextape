# tree-sitter grammars for the three text forms — design

**Slice:** `tree-sitter-grammars`. The frontend/tooling track's grammar entry, opened deliberately
ahead of its own stated trigger — see §2.

**One-line statement of what this is:** three tree-sitter grammars — the mini-language, the λ text
form, the TM text form — for **external editors only**, each one held against the hand-written
front end by a span-for-span differential, so that any disagreement between the two descriptions
fails a test rather than shipping as a wrong colour.

**Scope boundary, decided before anything else:** highlighting. The grammars produce a CST and
never lower it into Core; the hand-written parser stays the semantic source of truth and keeps the
canonical printer. No LSP, no `locals.scm`, no folds, no indents, no editor extension packaging, and
nothing wired into `web/`. §12 names each exclusion with why.

---

## §1 The tree as it stands — verified at `ef4f130`, 2026-08-20

Every claim below was run, not recalled.

1. **Nothing tree-sitter exists anywhere in the tracked tree.** `git grep -il 'tree.sitter' -- .
   ':!docs'` returns exactly one file — `web/src/highlight.ts` — and that is a doc comment arguing
   against a Lezer grammar for the web panes, not a grammar. There is no `grammars/` directory.
2. **The workspace has six members**, none of which is a grammar or a grammar consumer:
   `redextape-cli`, `redextape-core`, `redextape-native`, `redextape-native-rt`,
   `redextape-test-support`, `redextape-wasm`.
3. **`TokenClass` has 14 variants** (`analysis.rs:23`), and `token_class_names()` already exports
   them in declaration order so a foreign copy can be checked rather than trusted. This slice adds a
   second foreign copy — the capture map of §5 — and inherits that mechanism.
4. **The mini-language has a classifier over authored text.** `classify_source(src) -> Classified`
   (`analysis.rs:137`) returns `Vec<(Span, TokenClass)>` over arbitrary input, including malformed
   input: `classify_source_is_total_on_malformed_input` pins that it does not panic on `let x = @@@;`
   or on the empty string.
5. **λ and TM do not.** Their classification comes from the *printers* —
   `print_lambda_mapped` (`lambda/syntax.rs:266`) and `print_tm_mapped` (`tm/syntax.rs:116`), each
   returning `(String, Classified)`. There is no `classify_lambda` and no `classify_tm`. This
   asymmetry is not incidental; it determines the corpus design of §7 and produces two of the three
   gaps in §6.
6. **The classes each form actually emits are far fewer than 14.** λ emits three — `Binder`,
   `Ident`, `Punct`. TM emits seven — `Keyword`, `Label`, `Move`, `Nat`, `Punct`, `StateName`,
   `TapeSymbol`. **`print_tm_mapped` emits no `Comment` at all**, though `;` comments are part of
   the TM text form the parser accepts; see §6.3.
7. **A generator for mini-language expressions already exists.** `arb_expr_over`
   (`redextape-test-support/src/lib.rs:41`) is a `prop_recursive(3, 8, 3, ..)` shape over five arms,
   shared by four call sites. Its doc comment forbids changing the recursion parameters or the arm
   set without re-measuring every caller that records a rate against them. **This slice is a new
   caller and records no rate**, so it adds no new constraint on that generator.
8. **`check-all.sh` already runs the whole workspace's tests** — the row `base|test|--workspace` in
   its `LEGS` table. A new workspace crate's tests are therefore covered by the existing `rust` CI
   job with no workflow edit and no new required context.
9. **The dependency rule is "admissible, and the gate decides"** (roadmap, 2026-08-05). The gate is
   `cargo check --target wasm32-unknown-unknown -p redextape-core --lib`, which a test-only crate
   outside core's lib graph never touches.

## §2 The gate this opens, and what stays binding

The roadmap's tree-sitter entry sets the trigger as *"when an external editor needs it — Neovim,
Helix, Zed, Emacs"*, and records that nothing serves that today. **That condition has not arrived.
This slice opens the gate anyway, and that is a decision rather than an oversight** — taken
2026-08-19, with the sequence CLI-first-then-tree-sitter, whose first half landed 2026-08-20 in PRs
#47 and #48.

What the entry says about *constraints* is unaffected by that, and all of it stays binding:

- **The lane is highlighting only.** The grammar may never lower CST into Core. The hand-written
  parser stays the semantic source of truth and, since 2026-08-19, owns the canonical printer too
  (`redextape_core::format`, which `redextape fmt` calls). Any drift a grammar introduces must be
  **cosmetic by construction** — which is a claim, and §4 is the machinery that makes it checkable.
- **Never two authoritative grammars.** The rejected lane was tree-sitter as the *only* parser,
  which would couple the build to the tree-sitter toolchain.
- **The consumer is an external editor, never `web/`.** Plan 5 considered a grammar for its own
  panes and rejected it: `web/src/highlight.ts` renders CodeMirror decorations over
  `classify_source`'s spans. Nothing in this slice touches `web/`, and the existing doc comment
  there needs no further correction — it was already corrected twice on the `cli-fmt-and-lint`
  branch and now argues from what is checkable rather than from authority.

## §3 What ships

```
grammars/
  tree-sitter-redextape/            # the mini-language, `.rxt`
  tree-sitter-redextape-lambda/     # the λ text form
  tree-sitter-redextape-tm/         # the TM text form
```

Each grammar directory holds:

| Path | Generated? | Committed? | Why |
|---|---|---|---|
| `grammar.js` | no | yes | the source you edit |
| `tree-sitter.json` | no | yes | grammar metadata; **required by the CLI to generate at ABI 15** (§8.1), and what editors read for file types and query paths |
| `src/grammar.json` | yes | yes | the grammar as data; the JS-free half of the pipeline |
| `src/parser.c`, `src/tree_sitter/*.h` | yes | yes | what editors and the Rust crate compile |
| `src/node-types.json` | yes | yes | consumed by editor tooling |
| `queries/highlights.scm` | no | yes | the actual deliverable |
| `test/corpus/*.txt` | no | yes | `tree-sitter test` cases over tree *shape* |
| `README.md` | no | yes | install snippets for nvim-treesitter, Helix, Zed |

Generated files are committed because that is what consumers expect: nvim-treesitter and Helix both
install from a checkout without running the CLI. The cost of committing a build artifact is that it
can go stale against its source, and §8.2 is the answer to that.

Plus one new workspace crate:

```
crates/redextape-grammar-check/     # test-only; holds the differential
  build.rs                          # compiles the three parser.c files via `cc`
  src/lib.rs                        # the capture -> TokenClass map, and the comparison
```

**It is a crate rather than a test module inside `redextape-core` for the same reason
`redextape-test-support` is a crate:** it would otherwise put `tree-sitter` and `cc` into core's
manifest. The gate of §1.9 would not fail on that — dev-dependencies are outside the `--lib` check —
but a C build-dependency in the crate whose whole identity is WASM-cleanliness is a confusing signal
to leave lying around for the next reader.

## §4 The drift check

One direction, three languages, three steps:

1. **Parse and query.** Parse the corpus text with tree-sitter, run `queries/highlights.scm`, collect
   `(byte_range, capture_name)` for every capture.
2. **Project.** Push each capture name through the single `capture -> TokenClass` map of §5.
3. **Compare.** Assert the projected sequence equals the authoritative classification, span for span
   and class for class, in offset order.

The comparison is on **byte** offsets throughout. tree-sitter's `Node::start_byte`/`end_byte` and
`redextape_core::Span` are already the same unit, so nothing converts and nothing can be
mis-converted — unlike the web boundary, where `classify_source`'s byte offsets meet CodeMirror's
UTF-16 indices and `spans.ts` exists to bridge them.

The authority differs per language:

| Language | Authority | Reaches authored text? |
|---|---|---|
| mini (`.rxt`) | `classify_source(src)` | yes |
| λ | `print_lambda_mapped(term)` | no — printed text only |
| TM | `print_tm_mapped(machine)` | no — printed text only |

**That the λ and TM authorities are printers rather than classifiers is the central constraint of
this design.** It means their corpora cannot be authored; they must be *produced* (§7), and it means
anything a user may legitimately type that the printer never emits is outside the differential's
reach (§6.2, §6.3).

## §5 The capture vocabulary and the projection map

The grammars capture **standard tree-sitter names**. Editors' themes are written against these;
inventing a private vocabulary would produce grammars that technically work and look wrong in every
editor that installs them.

`TokenClass` is coarser in places and *finer* in others (§5.2). The two vocabularies meet in `const`
tables in `redextape-grammar-check`, one per grammar, each a **function** and each total over the
capture names its own queries use.

### §5.1 The map

**ONE MAP PER GRAMMAR — corrected 2026-08-20, during PR 1's Task 3 review.** This section first said
*"one map, shared by all three languages: a capture name means the same `TokenClass` everywhere or the
table is not a function."* That is false, and the table below is what falsifies it: `@variable.parameter`
must be `Ident` in the mini-language, where `class_of` calls a function parameter an `Ident`, and
`Binder` in λ, where `print_lambda_mapped` classifies the name a binder binds as part of the binder.
Both are correct for their own language. The shared table could not hold both and would have collided
in PR 2.

**The three languages have genuinely different class vocabularies** — λ has `Binder` and the
mini-language has no such thing; TM has `TapeSymbol`, `Move` and `StateName` and neither of the others
does — so a single table was a simplification that did not survive contact with the class sets.

**And the shared table cost a check that per-grammar tables get back.** Reverse totality — no row that
no query uses — is untestable while one table serves three grammars, because rows for λ's and TM's
classes are legitimately unused until those grammars exist. Per grammar, each table's rows must all be
used by its own queries, and a stale row fails a test on the day it goes stale.

What the original argument got right is kept: the danger is the two VOCABULARIES drifting, and each
table is still pinned to its own queries in both directions.

| Capture | `TokenClass` | Grammar |
|---|---|---|
| `@keyword` | `Keyword` | mini (`fn`, `let`, `mut`, `if`, `else`, `while`), TM (`tapes`, `start`, `accept`, `tape`, header directives) |
| `@keyword.function` | `Binder` | λ — the `λ` or `\` token itself |
| `@variable.parameter` | `Ident` in mini, `Binder` in λ | mini — a function or closure parameter; λ — the name the binder binds. **The row that forced per-grammar tables.** |
| `@boolean` | `Bool` | mini — `true`, `false` |
| `@variable`, `@function`, `@function.call` | `Ident` | mini, λ |
| `@number` | `Nat` | mini, TM |
| `@operator` | `Operator` | mini |
| `@punctuation.bracket`, `@punctuation.delimiter` | `Punct` | all three |
| `@comment` | `Comment` | mini, TM (§6.3) |
| `@label` | `Label` | TM — a state name in DEFINING position |
| `@label.reference` | `StateName` | TM — a `goto` target |
| `@character` | `TapeSymbol` | TM — a tape symbol, the blank `_`, the wildcard `*` |
| `@constant.builtin` | `Move` | TM — `L`, `R`, `S` |

### §5.2 Where the standard vocabulary runs out, and why the fix is a dotted name

`TokenClass` distinguishes `Label` from `StateName` — a state name in defining position from the same
name as a `goto` target — and the standard capture vocabulary has no clean pair for that. **The
resolution is `@label` and `@label.reference`, and it works because of a property of the consumers
rather than of tree-sitter:** nvim-treesitter and Helix both resolve a dotted capture by falling back
to its prefix when the theme has no rule for the full name. So an editor with no opinion about
`@label.reference` colours it as `@label` — correct, if less specific — while the map above still
sees two distinct keys and can hold them to two distinct classes.

That is the general escape hatch for this whole section, and it is available precisely because the
grammars capture hierarchically. It is not free: a dotted name nobody themes is a distinction only
this repository can see.

### §5.3 Two properties asserted, not assumed

- **Totality, both directions.** A test walks a grammar's `highlights.scm` capture names and fails on
  one its map does not cover, so adding a capture without deciding its class fails rather than
  silently colouring something the differential then ignores. The reverse test fails on a map row no
  query uses, so a row left behind by a query edit fails on the day it goes stale.
- **The `true`/`false` trap is pinned by name.** `class_of` maps `TokenKind::True | TokenKind::False`
  to `TokenClass::Bool`, not `Keyword`, and a grammar author's instinct is to capture them as
  `@keyword`. The `@boolean` row is the correction; a corpus entry holding both a `let` and a `true`
  is what makes it fire.

## §6 What is not checked — three gaps, stated

A differential that quietly covers less than it appears to is worse than a narrower one that says so.

### §6.1 Finer captures are unchecked

`@function.call` and `@variable` both project to `Ident`, so the differential asserts *that* a span
is an identifier and never *which kind*. A grammar that captured every identifier as
`@function.call` would pass. The extra granularity is what makes the highlighting good in an editor
and it rests on `tree-sitter test` and on review, not on the differential.

**This was a deliberate choice against two alternatives**: capturing at exactly `TokenClass`
granularity would make the differential total at the cost of one colour for every identifier in
every editor; asserting the finer captures against the AST's own callee positions would close the
gap at the cost of a second comparison per language, times three. Named here so a later reader can
take the second one up knowing it was priced rather than missed.

### §6.2 λ's `\` alias is outside the corpus

`parse_lambda` accepts `\` and `λ` interchangeably; `print_lambda` emits only `λ`. Since the λ corpus
is printer-produced, **no generated corpus entry can ever contain a `\`**. The grammar must accept it
— it is what a keyboard types, and an editor is exactly where it will be typed — but the differential
has no authority to compare against for it.

Handled by a small hand-written corpus of `\`-spelled terms checked with `tree-sitter test` for tree
shape, plus the observation that `parse_lambda(text)` must succeed on each. That is weaker than the
differential and is why it is written down here rather than left implicit.

### §6.3 TM comments are outside the differential entirely

`print_tm_mapped` emits no `Comment` class (§1.6), because the printer never writes a comment. `;`
comments — whole-line and trailing — are nonetheless part of the form `parse_tm` accepts. Same
treatment as §6.2: hand-written corpus, `tree-sitter test`, no differential authority.

**This is the same shape of gap `TokenClass::Comment` had on the source path before 2026-08-19**, and
it is worth noticing that the fix there was to give the lexer somewhere to put comments. The
equivalent fix here would be a `classify_tm`/`classify_lambda` over authored text. That is a real
piece of work with a real consumer — it is what an LSP would need — and it is **not** in this slice.

## §7 Corpus generation — one generator, three corpora

The three corpora share a single source of randomness, which is the reason this composes:

```
arb_expr_over(leaf)  ->  mini source  ->  parse -> desugar -> Core
                                              |
              +-------------------------------+-------------------+
              |                                                   |
   lambda::lower(core)                              tm::lower_asm(core) -> lower_tm(prog, enc)
              |                                                   |
   print_lambda_mapped(term)                          print_tm_mapped(machine)
     -> (text, Classified)                              -> (text, Classified)
```

So one generated expression yields a mini-language corpus entry *and* a λ corpus entry *and* a TM
corpus entry, each paired with its own authoritative classification. Each language additionally
carries a small hand-written corpus for the constructs the generator does not reach (`fn`
declarations, `while`, closures, UFCS chains, comments) and for the two gap cases of §6.2 and §6.3.

Two constraints on this, both drawn from prior measurement rather than caution:

- **Nothing here reduces.** The corpus lowers and prints; it never calls `reduce_trace`. λ
  measurements that reduce have cost this project 60 GiB of RAM and all of swap, and no property in
  this slice needs a normal form. A reviewer should treat any `reduce` in this crate as a defect.
- **TM lowering can refuse, and that is fine.** Generated expressions can exceed `MAX_FIELD_WIDTH`
  and the TM lowering rejects them rather than corrupting them — this is why
  `three_way_oracle.rs` has its own `arb_tm_safe_expr`. The TM corpus **filters** on successful
  lowering rather than asserting it, and the filter's pass rate is logged so a silent collapse to
  near-zero corpus entries fails visibly instead of passing vacuously.

## §8 Toolchain and CI

### §8.1 Versions, and the mismatch that would look like something else

**CORRECTED 2026-08-21, during PR 1's Task 6.** This table first pinned the CLI at **0.27.0**, read
off `/usr/sbin/tree-sitter --version` on this machine. **No such release exists.** That binary is
Arch's `tree-sitter-cli-git`, built from tree-sitter's `master` at `0.26.12.r400.g43623ec9b`, and it
reports the *next* version rather than the one it descends from. Checked live: npm's `tree-sitter-cli`
and GitHub's numbered releases both top out at **v0.26.12**. A version read off a locally installed
binary is not evidence that the version exists, and pinning CI to it would have pinned CI to nothing.

**The released CLI needs `tree-sitter.json` to reach ABI 15**, and says so — without that file it
prints a warning and silently falls back to **ABI 14**, which the Rust crate would then refuse. That
is why the file is in §3's table: it is not decoration, it is what makes the pin reproducible.

| Component | Version | Note |
|---|---|---|
| `tree-sitter` CLI | **0.25.10** | NOT the newest — see "existing is not usable" below |
| `tree-sitter.json` | required | without it the CLI generates ABI 14 and warns |
| generated language ABI | **15** | with `tree-sitter.json` present |
| `tree-sitter` Rust crate | 0.26.12 | **loads ABI 15**. The CLI and the crate deliberately differ in version; **the ABI is the contract, the version number is not** |
| Node | **required** | the CLI shells out to `node` to evaluate `grammar.js`. Present on the CI runner |

#### §8.1.1 EXISTING IS NOT USABLE, and this section learned it three times

The pin was wrong three times, in three different ways, and only the first was about the version
number:

1. **`0.27.0` — never released.** Read off `/usr/sbin/tree-sitter --version`, which is Arch's
   `tree-sitter-cli-git` off `master` reporting the version it is heading toward. A version reported
   by an installed binary is not evidence the version was published.
2. **`0.26.12` — released, but will not RUN on the runner.** Its prebuilt binary needs **GLIBC_2.39**;
   `catthehacker/ubuntu:act-latest` has **2.35**. Every published Linux asset for that release is the
   same glibc build and there is no musl variant, so no download can work. Confirming a release exists
   is a different check from confirming it runs where it must.
3. **`0.26.12` from source — will not BUILD on the runner.** The CLI vendors QuickJS through
   `bindgen`, which needs libclang, also absent.

**`0.25.10` needs only GLIBC_2.34**, runs, and regenerates this grammar to byte-identical
`src/grammar.json` and `src/node-types.json` at ABI 15, with the corpus passing. `src/parser.c`
differs from the 0.26.12 output on exactly one line — the generator-version comment — and
`src/tree_sitter/array.h` is the CLI's vendored runtime header, which downgrades with it.

**Do not bump this pin until the runner image has glibc 2.39+.** The failure it reintroduces is a
download that succeeds and a binary that will not execute.

#### §8.1.2 A CORRECTION THIS SECTION MADE AND THEN HAD TO UNMAKE

This table twice said **Node is not required**, citing a measurement:
`env -i PATH=/usr/bin:/bin <cli> generate` exiting 0 and propagating an edit. **That measurement was
invalid, and it was made twice — once by the author of this section and once by a reviewer checking
it.** `/usr/bin/node` exists on that machine, so the "node-free" environment contained node. Under a
genuinely empty `PATH` both CLIs fail with `Failed to load grammar.js -- Failed to run 'node'`.

**A negative result is only evidence if the absence was itself verified.** The control has to remove
the thing it is controlling for, and `command -v node` under the exact env being tested is the one
line that would have caught this. Nothing downstream depended on the claim — the runner has node —
which is precisely why it survived two passes.

**Measured when the pin changed:** the released 0.26.12 and the `master` build produce `parser.c`
files of identical length differing on exactly **one line** — `.minor_version`. The parse tables are
byte-identical. So the pin change is a metadata change, not a re-derivation of the grammar.

**A pinned tool must also win locally, or the gate punishes correct work.** This machine has the
`master` build on `PATH`; regenerating with it would emit the other `.minor_version` and redden a leg
that is supposed to catch a stale `parser.c`. `setup-dev.sh` therefore installs the pinned binary into
a repository-local directory, `ensure_treesitter` prefers it over `PATH`, and it asserts the version
so the failure names the cause rather than showing a one-line diff in generated C.

A one-rule spike grammar was generated, compiled through `cc` from a `build.rs`, loaded from Rust,
and queried; `Language::abi_version()` reported 15, `Parser::set_language` succeeded, and the query
returned byte-ranged captures. **The CLI-version/crate-version pair is therefore known to work rather
than assumed to**, which matters because the failure mode is a bare `set_language` error that reads
like a build problem rather than a version problem. Both versions get pinned, and the check's failure
message names the ABI on both sides.

### §8.2 The regenerate leg

A new `base` row in `check-all.sh`'s `LEGS` table runs `tree-sitter generate` for each grammar and
fails if the result differs from what is committed.

**Without it the rest of this design is decorative.** The differential compiles `src/parser.c`; if
someone edits `grammar.js` and does not regenerate, every test passes against the previous grammar
while the file that claims to describe the language says something else. That is the same class of
defect the whole slice exists to prevent, moved up one level, and it is the class this project has
already been bitten by — a CI change that was "inert as first pushed, green the whole time"
(2026-08-20, `ci-cache-profile`).

Two properties the leg needs:

- **It must locate the CLI explicitly.** `/usr/sbin` is off the PATH under non-interactive shells on
  this machine; the same shape already cost this project a debugging session over Chrome and
  chromedriver. The leg resolves `tree-sitter` or fails with a message that says which and where —
  never a silent skip. `setup-dev.sh` gains the install step.
- **It must not be skippable.** A gate that goes green when its tool is missing is worse than no
  gate. If the CI runner cannot run `tree-sitter generate`, the leg is red and the fix is to install
  it on the runner, not to make the leg conditional.

### §8.3 No new CI job — which is not the same as no CI edit

The differential rides `base|test|--workspace` (§1.8) and the regenerate leg joins an existing script.

**CORRECTED 2026-08-21:** this section said *"`ci.yml` gains nothing"*, and that is false — it gained
two `Install tree-sitter CLI` steps, in the two jobs that reach a base-tier leg. The load-bearing half
is true and is what the section was for: **no new job**, `gate`'s `needs:` list unedited, and no new
required context to configure on the branch protection rule. A step is not a job; conflating them
overstated the claim.

## §9 Testing

Three layers, deliberately different in kind:

1. **`tree-sitter test`** over `test/corpus/*.txt` per grammar — checks tree *shape*, which the
   differential cannot see at all (it only ever looks at captured spans). This is also the layer a
   future grammar editor will actually read and extend.
2. **The differential** (§4) — checks agreement with the hand-written front end.
3. **Query totality** (§5) — checks that the map between the two vocabularies covers every capture
   the queries emit.

And one property that belongs to none of them: **the grammars must parse the corpus without ERROR
nodes**. That is asserted as part of layer 2's setup rather than separately, because a corpus entry
that fails to parse would otherwise produce an empty capture list and compare equal to nothing.

## §10 Phasing — three PRs

**PR 1 — harness plus the mini-language.** The whole novel half: `crates/redextape-grammar-check`
with its `build.rs`, the capture map and its totality test, the corpus generation of §7, the
regenerate leg and its `setup-dev.sh` entry, and `grammars/tree-sitter-redextape/` complete with
queries, corpus and README. This PR is where the design is either right or wrong.

**PR 2 — the λ grammar.** Three classes. Adds the `\` corpus of §6.2.

**PR 3 — the TM grammar.** Seven classes, line-oriented, plus the optional header block that
`parse_tm_full` reads and `parse_tm` discards. Adds the `;` comment corpus of §6.3. Largest of the
three grammars and the one most likely to want a second review pass.

Each PR closes with a roadmap entry, per the convention every slice since Plan 4 has followed.

## §11 Risks

1. **`parser.c` diff size.** Three committed generated files. The one-rule spike produced 8.5 KB;
   real grammars are substantially larger, and the mini-language's is measured in PR 1 rather than
   guessed. If it is unreasonable, that is a PR 1 finding with the whole design still in front of it,
   not a surprise discovered in PR 3.
2. **Zed's grammar packaging may not read a subdirectory.** nvim-treesitter takes `location =` and
   Helix takes `subpath =`; Zed's extension format is repo-plus-commit and needs checking. If it
   cannot, the answer is a generated mirror repo pushed from CI, and the README says so rather than
   the layout changing.
3. **The generator's constructs are narrow.** `arb_expr_over` produces `+`, `-`, `>`, `==` and `if`
   over leaves — no `fn`, no `while`, no closures, no UFCS. The hand-written corpus carries those,
   which means the *most* structurally interesting parts of the grammar rest on the weaker layer.
   Worth stating plainly: the generated corpus gives depth on a narrow shape, not breadth.
4. **ABI drift on a future toolchain bump.** Pinned today; a CLI upgrade that changes the default ABI
   past what the Rust crate reads breaks the differential, and §8.1 is why the message will say so.

## §12 Explicitly out of scope

- **`locals.scm`.** It is a scope resolver, and this project already has one in `typeck`. A second
  would be a semantic claim inside a lane defined as cosmetic — the nearest thing in this slice to
  the "two authoritative grammars" the roadmap forbids.
- **`injections.scm`.** Nothing to inject; no form embeds another.
- **Folds and indents.** Unchecked by construction — nothing in the Rust tree has an opinion about
  either to compare against. Addable later if an editor user asks.
- **Editor extension packaging.** READMEs with install snippets, not a Zed extension, a
  nvim-treesitter upstream PR, or an npm publish. Packaging follows a consumer; there is not one yet.
- **`redextape-lsp`.** Deferred to v2 and unaffected by this slice. It is, however, the consumer that
  would justify `classify_lambda`/`classify_tm` and thereby close §6.2 and §6.3.
- **Anything in `web/`.** Settled in the other direction by Plan 5 and unreopened here.
- **The asm text form.** Not one of the three, and it could not be one: `parse_asm` remains
  unclaimed, so the asm form prints and cannot be read back. A grammar for it would have no parser to
  be checked against — the differential of §4 has no authority to call.
