# `redextape-cli` — `fmt` and `lint` — design

**Slice:** `cli-fmt-and-lint`, the first half of Plan 6. Filed against the roadmap's own closing note on
the branch immediately before it: *"`crates/redextape-cli` is still unbuilt. `redextape fmt` has an
engine to call and no command that calls it."*

**One-line statement of what this is:** the workspace gets its first binary — `redextape fmt` and
`redextape lint` — and `Severity::Warning` gets a producer, which is the same shape of gap
`TokenClass::Comment` was before the slice before this one closed it.

**Scope boundary, decided before anything else:** `fmt` and `lint` only. No `run`, no `emit`, no native
backend front end, and no terminal syntax highlighting. Each is named in §10 with why.

---

## §1 What is missing, verified against the tree — as of `02eca34`

Every claim here was checked rather than recalled. The branch before this one closed with three
falsified rationales, and its own lesson is the reason this section exists.

**DATED AFTER THE FACT, 2026-08-19.** This section was written in the present tense with no date on it,
and it is a survey of the tree **at `02eca34`**, this branch's own starting point. Every citation in it
still resolves exactly there, and §1.3, §1.5 and §1.6 still hold at HEAD. **§1.1, §1.2 and §1.4 are
false today *by design* — this slice is what falsified them:** `crates/redextape-cli` exists, `clap` is
a dependency of it, and `Severity::Warning` has two producers in the new `redextape-core/src/lints.rs`.
A survey is allowed to describe a tree that no longer exists; it is not allowed to leave the reader
guessing which tree, which is why the heading now carries the commit and this paragraph exists at all.

1. **There is no CLI crate.** `Cargo.toml`'s `[workspace] members` lists five crates; none is a binary.
   `crates/redextape-cli` does not exist.
2. **There is no argument-parsing dependency anywhere.** No `clap`, `argh`, `lexopt` or `pico-args` in
   any manifest. `examples/tm_emit.rs:37` hand-rolls `std::env::args().skip(1)`.
3. **There is no byte-offset → line/column conversion anywhere in the tree.** The web never needed one:
   CodeMirror consumes byte offsets directly through `web/src/spans.ts`. Any terminal diagnostic that
   names a line and column is new code.
4. **`Severity::Warning` is never constructed.** `grep -rn "Severity::Warning" crates/` returns **zero**
   occurrences outside the enum declaration at `diagnostic.rs:11`. `Diagnostic::error`
   (`diagnostic.rs:25`) is the only constructor in the crate. The variant is declared, matched, and
   unreachable.
5. **The engine `fmt` needs already exists.** `redextape_core::format` (`lib.rs:97`) is
   `Result<String, Vec<Diagnostic>>` over `parse_full` + `printer::print`, shipped 2026-08-19.
6. **The engine `lint` needs already exists.** `redextape_core::analyze` (`lib.rs:54`) returns
   `Analysis { diagnostics, core }`, with `core: Some` only when no error-severity diagnostic is
   present.

## §2 Crate layout

Package `redextape-cli`, binary name `redextape`. Three dependencies: `clap` (derive), `ariadne`,
`similar`, plus the `redextape-core` path dependency. **Not** `serde` — `fmt` and `lint` consume
`format` and `analyze`, neither of which involves a view model.

```
crates/redextape-cli/
  Cargo.toml
  src/main.rs         dispatch only; maps an outcome to an ExitCode
  src/cli.rs          clap derive structs
  src/fmt.rs          the fmt command
  src/lint.rs         the lint command
  src/report.rs       Diagnostic -> ariadne Report      <- the shared seam
  src/input.rs        path vs "-" (stdin), reading, and write-back
  tests/cli.rs        trycmd entry point
  tests/cmd/          golden transcripts
  tests/fmt_stdin.rs  OMITTED HERE, ADDED 2026-08-19 — assert_cmd; fmt's stdin contract (see §8)
  tests/version.rs    OMITTED HERE, ADDED 2026-08-19 — assert_cmd; the binary's name and --version
```

**The two `assert_cmd` targets were missing from this map and are added above.** They are not stray
extras: §8 names `assert_cmd` as a deliberate second harness, and these two files are the whole of it.
A file map that lists only what the designer remembered writing is the same class of record as a
survey with no date on it.

**`report.rs` is the load-bearing boundary.** `fmt`'s parse errors and `lint`'s analysis diagnostics
render through one function, so the two commands cannot drift into two diagnostic looks. It is the only
module that knows ariadne exists.

**The wasm32 gate does not reach this crate.** ~~`scripts/check-all.sh`'s wasm leg runs
`cargo check --target wasm32-unknown-unknown -p redextape-core --lib`.~~ **STALE QUOTE, corrected
2026-08-19 — and the conclusion is unaffected.** That single-row form was retired before this branch
began. `check-all.sh`'s `LEGS` table now carries **three** `wasm` rows: `-p redextape-core --lib`,
`-p redextape-core --lib --features serde`, and `-p redextape-wasm --lib`. A host-only binary is
outside all three, so none of these dependencies can break the browser build — the claim this
paragraph exists to make survives its own citation going stale, which is worth saying rather than
quietly repairing.

**The no-panic rule applies.** `[lints] workspace = true`, so `unwrap_used`, `expect_used`, `panic`,
`todo` and `unimplemented` are denied under CI's `-D warnings`. This is production code, not an example,
so it threads typed errors rather than carrying `tm_emit.rs:19`'s file-level `#![allow(...)]`.

## §3 Command surface

The source extension is **`.rxt`**. It is convention only — both commands take paths and never infer
from the extension — but it is what every fixture, doc and test uses from here on.

### §3.1 `fmt`, rustfmt-style

```
redextape fmt foo.rxt            rewrites foo.rxt in place
redextape fmt src/*.rxt          several files, all in place
redextape fmt --check foo.rxt    writes nothing; unified diff + exit 1 if it would change
redextape fmt -                  stdin -> stdout
```

In-place is the default because the printer was calibrated against rustfmt
(`examples/rustfmt_calibration_probe.rs`) and matching its CLI conventions is the coherent choice.

`--check` emits a **real unified diff** via `similar`, not a list of filenames, so a CI failure explains
itself instead of sending the reader back to run `fmt` locally to find out what it wanted.

**A file that does not parse is never written.** `format` returns `Err(Vec<Diagnostic>)` and the original
bytes stay on disk. This is `lib.rs:97`'s own documented contract — *"a file that does not parse is
returned untouched to the caller, which is the only safe thing to do with it"* — and the CLI does not
weaken it.

**Write-back is atomic**: write to a temporary file in the same directory, then rename. A formatter
interrupted mid-write must not leave a truncated source file.

### §3.2 `lint`

```
redextape lint foo.rxt           diagnostics to stderr; exit 1 if any error
redextape lint src/*.rxt         several files
redextape lint -                 stdin
```

`lint` calls `analyze` and renders `Analysis.diagnostics`. It ignores `Analysis.core` entirely — it is a
static checker, not a runner.

## §4 Diagnostic rendering

ariadne, configured `IndexType::Byte` so labels line up with `Span`'s byte offsets. This is the one
ariadne footgun that matters here: its default is character indexing, and `Span` is bytes throughout the
tree (`web/src/highlight.ts:30` records the same unit hazard on the other side of the WASM boundary).

`Config::with_color(false)` plus `Report::write(source, &mut buffer)` gives deterministic bytes for
golden tests. Colour is enabled for a terminal and disabled otherwise, honouring `NO_COLOR`.

**ariadne also supplies the line/column arithmetic** §1.3 records as missing. `ariadne::Source` builds
the line index. No line-index code is added to `redextape-core`.

## §5 The warning tier

`Severity::Warning` gets two producers. **They go in `redextape-core`, not in the CLI**, because
`analyze` is what emits diagnostics and the CLI is one of its two consumers.

1. **`unused_mut`** — a `let mut x` whose `x` is never the target of an `Assign`. This is the exact
   mirror of a check that already exists: `typeck.rs:355` errors on assigning to an *immutable* binding,
   ~~so `Binding.mutable` (`typeck.rs:48`) is already live, tracked information.~~ **FALSE AS SHIPPED,
   2026-08-19.** `lints.rs` never consults typeck's `Binding` at all. `Lints::stmt` reads mutability
   straight off the surface AST's own `Stmt::Let { mutable, .. }` field and stores it in its own
   `Local`. `typeck.rs:355` is a precedent for the *rule*; it was never a source of *data* for it, and
   saying otherwise made the new pass sound like a read of existing state when it is a second walk.
2. **`unused_variable`** — a `let` binding never read by an `Expr::Var`. ~~(That is the whole read
   set.)~~ **NARROWER THAN WHAT SHIPPED, 2026-08-19:** `Expr::Method { recv, name, args, .. }` also
   credits its **method name** as a use, because this grammar resolves a UFCS call `x.f()` against an
   enclosing `let f = ...` — so `let f = |v| v; 1.f()` reads `f` and must not warn. Names beginning `_`
   are exempt. The lexer already accepts a leading underscore (`lexer.rs:58`), so the convention needs
   no lexer change.

~~Both ride `TyEnv`'s existing `mark`/`truncate` scope discipline (`typeck.rs:70`, `typeck.rs:74`), which
already models shadowing correctly.~~ **FALSE — AND FALSE EXACTLY WHERE THIS BRANCH'S SURVIVING
MUTATIONS LIVE, 2026-08-19.** `lints.rs` does not use `TyEnv` and never touches it. It declares its own
`struct Lints { scope: Vec<Local>, out: Vec<Diagnostic> }` and its own `mark`/`close` pair, and it
**MIRRORS** typeck's discipline rather than riding it — down to re-deriving `infer_block_inner`'s rule
that a maximal run of consecutive `Stmt::Fn`s scopes as a single unit (`Lints::fn_run`).

**The distinction is the whole point, not a pedantic correction.** *Riding* a mechanism means there is
one thing to get right and one set of tests holding it right. *Mirroring* one means there are two things
that can drift apart, and the mirror needs tests of its own because the original's tests do not reach it.
**Three of the six mutations the final whole-branch review found still surviving a full suite are
precisely that drift going untested** — deleting `fn_run`'s `close`, deleting `Expr::Lambda`'s `close`,
and pushing `Stmt::Let`'s binding onto `scope` *before* walking its value rather than after. Each turns a
correctly-scoped program into a **false positive** in the browser's lint gutter. The roadmap's closing
entry for this branch records all six and what pinned them.

**Neither blocks compilation.** `analyze` sets `core: Some` when no *error*-severity diagnostic is
present (`lib.rs:60`), so a program with warnings still desugars, still runs, and still compiles to λ and
TM. That behaviour is already correct and needs no change.

### §5.1 The web inherits these for free, and that is verified

`web/src/types.ts:46` already declares `Severity = 'Error' | 'Warning'`, and `web/src/diagnostics.ts:42`
already maps a non-error severity to `@codemirror/lint`'s `'warning'`. **Warnings will render as
CodeMirror lint warnings in the browser with no change to `web/` at all.** The seam was built and never
exercised — the same shape as `TokenClass::Comment`, one layer up.

### §5.2 The blast radius is measured, not guessed

> **THE PREDICTION IN THIS SECTION WAS FALSIFIED, AND SO WAS THE FIRST EXPLANATION OF THE FALSIFICATION.
> Corrected 2026-08-19 — the full account is in the roadmap's closing entry for branch
> `cli-fmt-and-lint`, under *"THE DESIGN PREDICTED FIXTURE FALLOUT AND GOT ZERO, TWICE"*.** Actual
> fallout was **zero**, twice: zero for `unused_mut`, and zero again for `unused_variable`, which fires
> on a far more common shape. The section is kept as written below because a prediction is only worth
> anything if it is still legible after it fails.
>
> **The reason for the zero is not the one you would reach for, and this is the transferable part.**
> Five tree programs *do* declare a `let` that nothing reads, and warn today — two in
> `lambda/lower.rs`, one in `typeck.rs`, one in `desugar.rs`, and the program in
> `examples/step_survey.rs`. None of the five fails, and **not** because the fixtures were careful. It
> is the **shape of the assertions**: none of those five routes through an assertion on `analyze`'s
> diagnostics at all. They call `parse` / `desugar` / `lower` directly, or they call `crate::run`, which
> discards `analysis.diagnostics` on the `Ok` path, or they are an example binary that asserts nothing.
> The 19 assertions counted below are real; they simply do not sit downstream of any program that would
> have tripped these rules.
>
> **What this leaves behind is a liability, not a clean bill of health.** A later task that starts
> asserting `analyze`'s diagnostics on any of those five inherits the migration this section budgeted
> for and this branch did not pay. The roadmap entry names all five by test, file and binding so that
> task does not have to rediscover them.

**19 assertions** across the tree assert that a program's diagnostics are empty — in `typeck.rs`,
`lib.rs` and `redextape-wasm/src/session.rs`. ~~Any test program carrying an unused binding or an unused
`mut` starts failing the moment these rules land.~~ The **count** is accurate and still is; the
**inference** drawn from it is the part that failed. Counting the assertions was measurement; assuming
any of them sat downstream of a program these rules would fire on was not.

~~This is a known, bounded migration and the plan budgets a task for it.~~ It was neither known nor a
migration — there turned out to be nothing to migrate, and the budgeted task had no work in it. Each
failure is triaged one of two ways, and **which way is itself a finding**: either the test program
genuinely has an unused binding, in which case the rule is right and the fixture changes; or the rule
fired where it should not, in which case the rule is wrong. A blanket fixture rewrite that does not
distinguish these would convert a real defect into a passing test. **That triage rule is the half of
this section that survived** — it is right, it is worth carrying forward, and it simply never had to
run.

## §6 Error handling and exit codes

```
0   success
1   the check failed      (fmt --check would rewrite; lint found an error-severity diagnostic)
2   could not do the work (parse error, I/O error, bad arguments)
```

**THIS TABLE IS AMBIGUOUS ON ITS OWN MOST COMMON CASE, AND THE AMBIGUITY WAS RESOLVED AGAINST IT —
2026-08-19.** ~~A parse error is code 2.~~ A **`lint`** parse error satisfies *both* rows as written: it
is an error-severity diagnostic (row 1) and it is a parse error (row 2). The table gives no rule for
choosing, and two commands with opposite instincts read it.

**Resolved: `lint` reports a parse failure as a diagnostic and exits `1`.** That is what the code does,
it is what `tests/cmd/lint_error.toml` pins (`status.code = 1`), and `crates/redextape-cli/README.md`
already states the resolved rule in prose. `fmt` keeps `2` on a file it cannot parse, and the reason the
two differ is not arbitrary: **`lint`'s job is to report what is wrong with a program, so a parse error
is a finding and the run succeeded at finding it; `fmt`'s job is to produce formatted text, so a parse
error means the command could not do the work.** Row 2's parenthetical should be read as *"`fmt` parse
error, I/O error, bad arguments"*.

Code 2 for bad arguments is clap's own default, so the three-code scheme costs no override.

**Warnings do not fail `lint`.** A file with warnings and no errors exits 0. Making warnings fatal is a
`--deny-warnings` flag, and it is not in this slice — §10.

**Every command is total over its argument list.** A missing file, a directory passed where a file was
expected, and non-UTF-8 bytes each produce a diagnostic on stderr and exit 2, never a panic.

**Multiple files do not short-circuit.** `fmt a.rxt b.rxt` with a broken `a.rxt` still processes
`b.rxt`; the exit code reflects the worst outcome across all inputs. A formatter that stops at the first
bad file makes a repo-wide invocation useless.

## §7 Interfaces

**NOT ONE OF THESE THREE SIGNATURES IS WHAT SHIPPED — corrected 2026-08-19.** Markdown cannot strike
through a fenced block, so the designed shapes are labelled rather than struck, and the shipped shapes
follow verbatim. The block is kept because *how* it was wrong is the finding.

```rust
// AS DESIGNED — superseded in every line below.
// report.rs — the only module that knows ariadne exists.
pub fn render(w: &mut impl std::io::Write, path: &str, src: &str, ds: &[Diagnostic]) -> std::io::Result<()>;

// fmt.rs
pub enum FmtOutcome { Unchanged, Rewritten, WouldChange, Failed }
pub fn run(inputs: &[Input], check: bool, w: &mut impl Write) -> std::io::Result<FmtOutcome>;

// lint.rs
pub enum LintOutcome { Clean, Warned, Errored, Failed }
pub fn run(inputs: &[Input], w: &mut impl Write) -> std::io::Result<LintOutcome>;
```

```rust
// AS SHIPPED.
// report.rs — still the only module that knows ariadne exists.
pub fn render(
    w: &mut impl std::io::Write,
    label: &str,
    src: &str,
    ds: &[Diagnostic],
    color: bool,
) -> std::io::Result<()>;

// fmt.rs
pub enum Outcome { Clean, Rewritten, WouldChange, Failed }
pub fn run(
    inputs: &[Input],
    check: bool,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome>;

// lint.rs
pub enum Outcome { Clean, Warned, Errored, Failed }
pub fn run(
    inputs: &[Input],
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome>;
```

Name by name: **`FmtOutcome` and `LintOutcome` are both just `Outcome`**, one per module, so the module
path does the disambiguating that a prefix was doing. **`fmt`'s `Unchanged` is `Clean`** — `lint` already
called that state `Clean`, and two spellings of one idea across two enums that `main` matches side by
side is exactly the drift `report.rs` exists to prevent one layer down. **`render`'s `path` is `label`**,
because `-` is not a path: the parameter names what the snippet header prints, not where the bytes came
from. And all three gained a **`color`** parameter, because colour is decided once by
`report::should_color` and threaded, never re-read per call.

~~Both commands write through an injected `impl Write` rather than calling `println!`, so the golden tests
capture output without a subprocess where a subprocess adds nothing.~~ **HALF-TRUE, AND THE MISSING HALF
IS THE INTERESTING ONE — 2026-08-19.** The injected-writer half held: neither command calls `println!`,
and the golden tests do capture output without a subprocess. But there are **TWO** writers, `out` and
`err`, and the split between them is user-visible on every single invocation. `fmt` sends formatted text
and diffs to `out` and diagnostics to `err`, which is what makes `redextape fmt - > out.rxt` produce a
clean file. `lint` sends diagnostics to `err` and **ignores `out` entirely** — its body opens
`let _ = out;`, keeping the parameter only so both commands share one call shape.

**The single-writer shape in this design is what made the stdout/stderr split invisible.** One `w` cannot
express *"diagnostics go to the other stream"*, so a decision that governs whether the tool is usable in
a pipeline was never stated here, never argued, and never tested at design time; it arrived during
implementation as something that had to be true rather than something that had been chosen. An interface
sketch that collapses two streams into one does not merely under-specify — it deletes the question.

## §8 Tests

**`trycmd`** for the CLI surface: stdout, stderr and exit code in one golden transcript, with its
filesystem sandbox covering the in-place-write cases. ~~**`assert_cmd`** only where trycmd's sandbox is
awkward — the atomic-rename check in particular.~~ **WRONG ON BOTH HALVES, corrected 2026-08-19.** The
atomic-rename checks are **in-process unit tests** in `input.rs`'s own `mod tests` — they compare inode
identity across a write, which needs no process at all and which a transcript cannot see. trycmd's
sandbox was never awkward for them because they never wanted it.

**The real reason `assert_cmd` is in the manifest is that stdin has no seam.** `Input::Stdin` reads the
process's actual standard input, so there is nowhere to inject fake bytes from a unit test and no way to
write a transcript that supplies them — `tests/fmt_stdin.rs` says exactly this in its own module doc and
is the whole of the justification. `tests/version.rs` is the second and last `assert_cmd` target, and it
is there for the smaller reason that `--version` is a property of the built binary.

Cases, each one a shape that has a way to go wrong:

- stdin round-trip (`-`), single file, several files
- `--check` on already-formatted input (exit 0, no diff) and on dirty input (exit 1, diff)
- ~~**`fmt` is idempotent through the CLI**~~ — **not through the CLI, corrected 2026-08-19.**
  Idempotence is pinned by an in-process unit test in `fmt.rs`'s own `mod tests` (`tmpdir("idempotent")`),
  which formats a real file on disk twice and compares. It is a genuine on-disk check; it is not a
  transcript, and no golden exercises it.
- a file that does not parse: diagnostic rendered, **file unmodified on disk**, exit 2 — **this case is
  now `tests/cmd/fmt_error.toml`**, added 2026-08-19 after the final review found that nothing in the
  suite ever ran `fmt` on an unparseable *path* against a real process. Changing `main`'s
  `Ok(fmt::Outcome::Failed) => ExitCode::from(2)` to `from(0)` had left the whole suite green.
- a missing file, a directory, and non-UTF-8 bytes
- several files where one fails: the others are still processed, exit code reflects the worst
- `lint` on a clean program (exit 0), a warning-only program (exit 0), an error program (exit 1)
- both warning rules fire where they should, and `_x` suppresses `unused_variable`

**Unit tests for the two lint rules live in `redextape-core`**, next to the typechecker they extend, not
in the CLI. The CLI tests that warnings *render*; core tests that they are *correct*.

## §9 Rejected approaches

- **Hand-rolled argument parsing**, matching `tm_emit.rs`. Rejected: help text, subcommand dispatch and
  arg validation are solved problems, and the binary is host-only so clap's tree costs nothing the wasm
  gate can see.
- **One-line `file:12:5: error: msg` diagnostics.** Rejected: cheaper, but the tree has no line index to
  build it on, so the saving is smaller than it looks, and ariadne's snippet is what makes a span useful.
- **`codespan-reporting` instead of ariadne.** Byte offsets natively, so no `IndexType` footgun. Rejected
  on output quality for a project whose subject is visualization; the footgun is one config line.
- **A tree-sitter grammar for highlighting, in this slice.** Rejected on sequencing, not on merit — see
  §10.
- **Deleting `Severity::Warning`** instead of giving it a producer. Rejected: the seam is already wired
  through the WASM boundary and the web (§5.1); the gap was the producer, not the type.

## §10 What this slice does not close

- **`redextape run` and the emit subcommands.** Plan 6's other half. `value.rs`'s `format_value` and the
  four existing examples already do most of the work; nothing here blocks them.
- **Terminal syntax highlighting.** Explicitly deferred to a **tree-sitter grammar slice, sequenced
  immediately after this one**. The roadmap's tree-sitter entry (line 2643) files it under *"defer to
  the visualizer … only once the interactive visualizer (Plan 5) exists and wants in-browser editing"* —
  **that trigger is overtaken.** Plan 5 exists and decided it did not want a grammar:
  `web/src/highlight.ts:19` renders highlights as CodeMirror decorations over `classify_source` spans and
  records why. The real driver is **external editors** — Neovim, Helix, Zed, Emacs — which cannot call
  `classify_source` and which `redextape-lsp` (v2) does not yet serve. ~~The roadmap entry should be
  corrected to say so, and the lane fixed as **highlighting-only** with the hand-written parser staying
  authoritative, which is the lane its own risk note already permits.~~ **DONE, NOT DEFERRED — commit
  `107c2c7` on this branch.** The tree-sitter entry's `When:` clause is struck and corrected in place,
  and its risk note now fixes the lane as highlighting-only. Only the *grammar itself* is still open.
- ~~**`highlight.ts:19`'s wording overstates the rule.** It says a grammar is *"forbidden outright"*; the
  roadmap forbids two *authoritative* grammars and explicitly permits the highlighting-only lane. Worth
  correcting when the grammar slice lands, so the next reader is not stopped by a rule that does not say
  what they were told it says.~~ **ALSO DONE ON THIS BRANCH, in the same commit `107c2c7` — and the
  replacement needed a second pass.** The new wording claimed a Lezer grammar would be *"a second
  AUTHORITATIVE grammar … which the roadmap's tree-sitter entry rules out"*. The roadmap entry names
  neither Lezer nor CodeMirror, and its criterion for *authoritative* is **lowering** — *"a grammar here
  may never lower CST→Core"*. A Lezer grammar that drives highlighting lowers nothing, so by the
  roadmap's own test it falls **inside** the permitted lane, not outside it. One overstatement had been
  swapped for a narrower one. The doc comment now argues from what is actually true — `classify_source`
  already ships the spans, and incremental re-parse, bracket matching and structural folding are out of
  v1 scope — and attributes nothing to the roadmap that the roadmap does not say.
- **`--deny-warnings`.** No consumer yet. It is one flag and one exit-code branch when CI wants it.
- **A config file.** No `redextape.toml`, no width option. `MAX_WIDTH` stays the printer's constant.
- **`parse_asm`.** Unclaimed exactly where Plan 6's survey left it.
- **More lint rules.** Two rules give the tier a producer. A rule *set* is a later slice with its own
  design — which rules, suppression syntax, and whether any are configurable.

## §11 Open questions

**One, and it is genuinely open.** Does `lint` deduplicate identical diagnostics across files? Assumed
no — each file reports its own — but no consumer has asked, and nothing here depends on the answer.

**Decided rather than left open, recorded because a diff header is user-visible:** `--check`'s unified
diff names the real path on both sides, marked `before` / `after`. It never shows the temporary file
§3.1's atomic write-back uses.
