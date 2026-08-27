# `redextape.toml` and `--deny-warnings` — design

**Slice:** `cli-config-and-deny-warnings`. Plan 6's last two knobs, and the last buildable v1 work
outside Plan 5's accessibility pass.

**One-line statement of what this is:** a repo-level `redextape.toml` that sets defaults for four
settings, a `--deny-warnings` flag that makes a warning fail `lint`, and a CLI flag for every config
key so precedence is uniform rather than "some keys are overridable."

**Scope boundary, decided before anything else:** no new semantics, one core change. Every setting
below already exists as a constant or a parameter; this slice gives three of them a user-facing name
and adds one exit-code branch. The single change to `redextape-core` is threading a width through
`Printer` — additive, with both existing entry points keeping their signatures.

**Why now, and why this is not the roadmap's habitual refusal.** Both knobs have been recorded as
deferred with "no consumer has asked" since the `cli-fmt-and-lint` design's §10 (2026-08-19), and the
`cli-emit-and-run` design deferred `emit --width` *to* "the config-file question the roadmap already
tracks separately" (§7). This slice is that question being answered. The consumer is CI: a repo that
wants warnings fatal has no way to say so, and saying it on every command line is what a config file
exists to stop.

## §1 The tree as it stands — verified 2026-08-26 at `2f81985`

1. **`redextape-cli` has four subcommands and 61 lines of `clap` surface.** `cli.rs` is declarations
   only; every decision lives in a command module. `main.rs` does dispatch and exit-code mapping and
   nothing else.
2. **Warnings exist only in `lint`.** `run` and `emit` call `redextape_core::parser::parse` and
   `typeck::result_type` directly (`run.rs:326`, `emit.rs:93`) and never reach `analyze`, which is
   what produces the lint tier. So `--deny-warnings` is a `lint` concern and touches nothing else.
3. **`lint::Outcome::Warned` maps to `ExitCode::SUCCESS`** at `main.rs:44`. That is the whole of the
   current behaviour, and one branch is the whole of the change.
4. **`printer::MAX_WIDTH` is a `pub const` = 120** (`printer.rs:30`), read at exactly **three**
   non-test sites — `printer.rs:184`, `:545`, `:593` — all of them methods on `Printer<'a>`. The
   three other occurrences in the file are the declaration and two doc comments.
5. **`printer::print` has exactly one non-test caller outside its own file**, `lib.rs:108`, inside
   `format`. `format` has exactly one production caller, `fmt.rs:75`. Neither `web/` nor
   `redextape-wasm` formats anything.
6. **Width is already a budget rather than a bound, and the tree asserts it.**
   `crates/redextape-core/tests/format_properties.rs:127`
   (`no_line_exceeds_the_budget_except_the_three_documented_constructs`) enumerates three constructs
   that overrun `MAX_WIDTH` and pins each with an input that does: binary chains never break (§6.6 of
   the printer design), parameter lists are `Vec<String>` printed with `join(", ")` and no width
   handling at all (measured there at 509 and 511 columns), and indentation is 4 columns per nesting
   level with no fill rule.
7. **Tape field width is already a parameter.** `Unary { width }` and `Binary { width }` exist,
   `MIN_FIELD_WIDTH` = 4 and `MAX_FIELD_WIDTH` = 64 (`tm/build.rs:54`, `:72`), and `run_tm_fitted`
   auto-fits per program. Pinning a width is passing a number, not new machinery.
8. **`emit`'s `--encoding` guard tests whether the flag was TYPED, not what the value is.**
   `emit.rs:76` carries a comment saying so, and saying that a `default_value_t` was the bug it
   replaced. §7 below is entirely about not re-entering that bug one layer up.
9. **`redextape-core` has one dependency, `serde`, optional and default-off.** Nothing in this slice
   changes that: `toml` goes in `redextape-cli`, which already carries `clap`, `ariadne` and
   `similar`. `toml` is not currently in `Cargo.lock`; `serde` already is.
10. **The CLI's tests are three layers.** 26 unit-test calls to a command `run` with a buffer
    (`fmt.rs` 19, `lint.rs` 7); 29 `trycmd` cases under `tests/cmd/` (107 files, each case a `.toml`
    plus goldens plus an `.in` directory), **every one of them with `fs.sandbox = true`**; and
    `assert_cmd` transcripts in `tests/roundtrip.rs`, `fmt_stdin.rs`, `version.rs`. Five of the 29
    cases pin full `--help` output: `help`, `fmt_help`, `lint_help`, `run_help`, `emit_help`.

## §2 What ships

- `crates/redextape-cli/src/config.rs` — discovery, parse, validation, and a `Config` value.
- Four config keys: `lint.deny-warnings`, `fmt.width`, `emit.encoding`, `emit.field-width`.
- Four new flags plus two global ones: `--deny-warnings` / `--no-deny-warnings` on `lint`,
  `--width` on `fmt`, `--field-width` on `emit`, and global `--config PATH` / `--no-config`.
  (`emit --encoding` already exists.)
- **Two** core changes, both additive. `Printer` carries a width, with `printer::print_with_width`
  and `redextape_core::format_with_width` added beside the unchanged `print` and `format`; and
  `tm::run_tm_described_at` is added beside the unchanged `run_tm_described`, which §7 explains.
- One exit-code branch: `lint::Outcome::Warned` maps to `1` when warnings are denied.

**AMENDED 2026-08-26, before the plan was written and after this document was first committed at
`32a4afc`.** This bullet said "One core change" and named only the printer. `emit.field-width` needs
a second one, and the reason is that `run_tm_described` (`tm.rs:296`) hard-codes the fitting search —
it starts at `MIN_FIELD_WIDTH` and doubles — while the two functions a caller would need to pin a
width itself, `attempt` (`tm.rs:154`) and `lower_and_size` (`tm.rs:191`), are both private. The CLI
therefore cannot express "one attempt at width N" at all. Found by reading the function while writing
the plan's task list, which is the cheapest place this could have been found and later than it should
have been: §7 asserted that a pinned width "skips the fitting" without ever naming what would do the
skipping.

## §3 The config file and its schema

```toml
# redextape.toml
[lint]
deny-warnings = false     # default

[fmt]
width = 120               # default; the value printer::MAX_WIDTH still holds

[emit]
encoding = "unary"        # unary | binary; applies to --lang tm only
field-width = 0           # 0 = auto-fit (the default); otherwise 4..=64
```

**`emit.field-width`, not `emit.width`.** Two unrelated quantities would otherwise both be called
width: `fmt.width` is a line budget in text columns, `emit.field-width` is a TM tape field in cells.
The roadmap already records that "the three cap constants a user can now meet are still three
unrelated numbers"; naming both of these `width` would make a fourth confusion out of a naming
choice. `field_width()` and `MAX_FIELD_WIDTH` are what core already calls it.

**`0` is the auto-fit sentinel rather than an absent key.** Both spellings could work, but a sentinel
keeps `Emit` a plain struct with no `Option` whose `None` means something different from the flag's
`None` — and §7 is a section about exactly one `Option` whose `None` carries meaning. One such
`Option` in this slice is enough.

**Bounds are refused, never clamped** — `fmt.width` in `20..=1000`, `emit.field-width` `0` or
`4..=64`. A clamp silently formats at a width nobody asked for; §8 is the general rule and this is
its first instance. The `emit.field-width` range is core's own `MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH`
read from the constants rather than written out, so it cannot drift from them.

**`fmt.width` is a budget, not a bound, and the file's own documentation must say so.** §1.6's three
constructs already overrun 120 and are asserted to. A narrower configured width makes all three bite
more often, and the third — indentation at 4 columns per level — bites at ten levels deep with
nothing on the line but spaces. A user who sets `width = 40` and finds a 60-column line has met a
documented property, and the README and the key's own doc comment are where that gets said.

**Why `20` is the floor.** Below it the exceptions stop being exceptions: four columns of indent plus
a short binding is most of the line, so a large fraction of any real program overruns and the setting
reports a width the output does not resemble. It is a judgement rather than a measurement, and the
plan pins it with a test rather than leaving it to a constant nobody re-reads.

## §4 Discovery and precedence

```rust
pub enum Source { Discover { from: PathBuf }, Explicit(PathBuf), Defaults }
pub fn load(source: Source) -> Result<Config, Error>
pub struct Config { pub lint: Lint, pub fmt: Fmt, pub emit: Emit }
```

**Discovery walks up from a start directory, and `discover` never reads `cwd` itself.** `main` passes
`std::env::current_dir()`; every test passes a directory it made. This is not stylistic. `cwd` is
process-global, and `lint.rs:88` already carries a comment recording that under `cargo test` every
test in a binary shares one process. A `set_current_dir` in a unit test is a race that `nextest`
would hide by giving each test its own process and `cargo test` would not.

**The walk checks for the config file before the `.git` stop, in each directory.** The repo root
normally holds both; checking `.git` first would stop one directory short of the file the walk exists
to find. Stated as the loop:

```
for dir in start.ancestors():
    if dir/redextape.toml is a file:  return it
    if dir/.git exists:               return none      # do not climb out of the repo
return none
```

**`.git` is tested with `exists()`, not `is_dir()`.** A worktree and a submodule both write `.git` as
a *file*. This repository uses worktrees, so the wrong predicate would fail exactly where it is most
likely to be exercised.

**Precedence resolves once, in `main`: flag > config file > built-in default.** The command modules
take plain values and never learn that a config file exists — `fmt::run(&inputs, check, width, …)`,
`lint::run(&inputs, deny_warnings, …)`. Each gains exactly one parameter, and the 26 existing unit
tests that call a `run` with a buffer keep passing a number or a bool rather than building a fixture.
A `&Config` threaded into the modules would hold the signatures constant as keys grow, and would
couple every module and every one of those 26 tests to the config schema; a per-command options
struct is the right answer at three or four knobs and premature at one each.

**Every key has a flag, so precedence is uniform.** `--deny-warnings` / `--no-deny-warnings` is a
`clap` `overrides_with` pair, last-one-wins, which is how a config `true` gets turned off for one
invocation. Non-boolean keys need no pair: the value is the override.

**A missing file is an error only when you named it.** `--config nope.toml` exits 2; finding no
config during discovery is the normal case and is silent. `--no-config` skips discovery and uses
built-in defaults, and `conflicts_with` `--config`. Both are `global = true` on `Cli` rather than
repeated per-subcommand.

## §5 `--deny-warnings`

One branch. `lint::Outcome::Warned` maps to `ExitCode::from(1)` instead of `SUCCESS` when warnings
are denied.

**`Warned` stays a distinct variant.** Collapsing it into `Errored` would lose the ordering that
`the_variant_order_is_the_severity_order` pins — `Clean < Warned < Errored < Failed`, which is what
makes `.max()` the merge rule with no rank table — and would make the rendered severity wrong,
printing "Error" for a warning. The severity a user reads and the exit code a script reads are
different questions and this flag answers only the second.

**Nothing in `run`, `emit` or `fmt` changes.** Per §1.2 they never reach the lint tier, so there is no
`--deny-warnings` on them and passing one is a `clap` error, exit 2, for free.

## §6 `fmt.width` and the printer

`Printer<'a>` gains a `width: usize` field. The three reads at `printer.rs:184`, `:545` and `:593`
become `self.width`. Two additive entry points:

```rust
pub fn print(parsed: &Parsed<'_>) -> String                        // unchanged; MAX_WIDTH
pub fn print_with_width(parsed: &Parsed<'_>, width: usize) -> String
pub fn format(src: &str) -> Result<String, Vec<Diagnostic>>        // unchanged; MAX_WIDTH
pub fn format_with_width(src: &str, width: usize) -> Result<String, Vec<Diagnostic>>
```

**`MAX_WIDTH` stays `pub` and stays 120, and its doc comment has to change.** It becomes *the
default* rather than *the rule*. A reader who meets the constant and concludes that no line exceeds
120 was already wrong — §1.6 — and will now be wrong in a second way, because a caller can choose
otherwise. Both facts belong at the declaration.

**The width is not validated in core.** `print_with_width(p, 0)` is a caller error, and core's
contract is that it prints at whatever it was given. The `20..=1000` range is a *CLI* policy about
what a human may write in a config file, enforced in `config.rs`, and the plan does not push it down
into the printer where it would be a second place to keep the number.

## §7 `emit.encoding`, `emit.field-width`, and the flag-presence trap

`emit.rs:76` already carries a comment about this bug at one level:

> **`Option`, NOT A `default_value_t`, AND THAT IS THE WHOLE POINT.** Once clap fills a default in,
> an explicitly passed `--encoding unary` and an omitted flag arrive here as the same value, so the
> guard below used to read `encoding != EncodingArg::default()` and let `--lang lambda --encoding
> unary` through at exit 0 while the README promised a 2.

The guard is `if lang != Lang::Tm && encoding.is_some()`. It tests **whether the flag was typed**. A
config-set encoding folded into that `Option` before the guard makes `redextape emit p.rxt --lang
lambda` exit 2 for every user whose repo has an encoding in its config — the same bug, re-entered one
layer up, and reachable by a config file rather than a command line.

```rust
// WRONG — resurrects emit.rs:76's bug through the config layer:
let encoding = Some(flag.unwrap_or(config.emit.encoding));
if lang != Lang::Tm && encoding.is_some() { /* exit 2 */ }

// RIGHT — the guard tests what was TYPED; config supplies the default afterwards:
if lang != Lang::Tm && flag.is_some() { /* exit 2 */ }
let encoding = flag.unwrap_or(config.emit.encoding);
```

**`flag` is the only `Option` in that expression, and §3's sentinel is what keeps it so.** `Emit`
carries a plain `EncodingArg` and a plain `usize`, so `unwrap_or` is the whole merge and there is no
second `None` for a reader to confuse with the flag's. The wrong version above has to *manufacture*
an `Option` to reach the bug, which is the shape to watch for in review.

**The rule, stated once for both keys:** a config-set `emit` value applies to `--lang tm` and is
ignored for every other target. A flag-set value on a non-`tm` target exits 2. **A config file must
never be able to trip *this guard* on a command line that used to work** — the guard tests whether a
flag was typed, so a value arriving from a file can never reach it.

**That is scoped to the guard and is not an absolute about config files, and the next paragraph is
why.** `emit.field-width` pins a width, and a pinned width can refuse a program auto-fitting would
have accepted — so `[emit] field-width = 4` genuinely turns a working `emit --lang tm` into an exit 2
for a program whose values need five cells. That is the setting doing exactly what it exists to do, on
the one target it applies to, and the refusal names the key so the cause is visible. What must never
happen is a config value producing a refusal *about a flag nobody typed*.

**`emit.field-width` = 0 means auto-fit**, which is today's behaviour: `run_tm_described` starts at
`MIN_FIELD_WIDTH`, doubles on `TmRun::Overflow`, and stops at `MAX_FIELD_WIDTH`. A pinned width skips
that search and uses the number given, which can therefore refuse a program auto-fitting would have
accepted — the same `Overflow` condition and the same exit 2 `emit` already gives, **but not the same
message**, and the branch review is what settled that. On the pinned path `MAX_FIELD_WIDTH` was never
attempted, so naming it is false and suggesting `--encoding binary` points away from the cause; the
pinned refusal names the width that was tried and the setting — flag or config key — that chose it.

**A pinned width the encodings cannot build at is refused by the core entry point, not by the tape.**
`run_tm_described_at` checks `MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH` before lowering and answers
`Err(TmRun::TooLarge)` outside it: the search bounded `run_tm_described` for free, and taking the
width from a caller removed that bound. `--field-width` is range-checked in `main` for the same
reason, at the same `0 | MIN..=MAX` the config key already used — a flag that overrides a validated
key has to be validated too, or it writes a `.tm` whose own reader refuses the header it carries.

**Skipping the search needs a new core entry point, because nothing exported can express it.**
`attempt` and `lower_and_size` are private, so the CLI cannot build a machine at a chosen width and
assemble a `TmHeader` from the result. The addition is one function beside the existing one:

```rust
pub fn run_tm_described(core: &Core, kind: EncodingKind, result: Ty, caps: TmCaps)
    -> Result<DescribedRun, TmRun>                                    // unchanged: fits and doubles
pub fn run_tm_described_at(core: &Core, kind: EncodingKind, result: Ty, caps: TmCaps, width: usize)
    -> Result<DescribedRun, TmRun>                                    // one attempt, no search
```

Both delegate to one private helper that performs a single attempt at a given width, so the search
lives in exactly one function and the pinned path cannot drift from the fitted one. **`Overflow` stays
an `Ok` on both paths** — `run_tm_described`'s doc is explicit that a run which started, even one that
overflowed, still has a configuration to describe — so `emit`'s existing "a value does not fit" refusal
keeps working unchanged and this slice adds no new failure shape.

## §8 Errors: strict refusal

**A config file that cannot be understood stops the run before any work, exit 2, naming the file and
the key.** Unknown key, unknown table, wrong type, and out-of-range value are all refusals.

```
$ redextape lint a.rxt
error: /repo/redextape.toml: unknown field `deny_warnings`, expected `deny-warnings`
# exit 2

$ redextape fmt a.rxt
error: /repo/redextape.toml: `fmt.width` must be in 20..=1000, got 4
# exit 2
```

**Why strict rather than forward-compatible.** The config's most important key is a CI gate. A typo
that silently disarms a gate is the failure mode this repository keeps filing roadmap entries about,
and the CLI already has the matching precedent one level down: `--encoding` on the wrong `--lang`
exits 2 rather than being a silent no-op, for the same reason. Forward-compatibility — a config
written for a newer binary still loading on an older one — is the argument on the other side, and it
is worth little for a single binary with no plugin ecosystem and no published releases.

**`serde(deny_unknown_fields)` plus `serde(rename_all = "kebab-case")` produce the unknown-key
refusal and its suggestion for free**, because serde's own message names the field it got and the
field it expected. The plan verifies that the message actually reads that way rather than assuming
it, and pins it in a `trycmd` golden.

**Exit 2, not 1**, under the CLI's existing rule: 1 is "the program is at fault", 2 is "this tool
could not answer". A malformed config file is neither the program's fault nor a lint finding — the
tool could not determine how to run, which is what 2 means.

## §9 Testing

Three layers, matching what the CLI already does.

1. **`config.rs` unit tests.** Discovery found at each depth and not found at all; the `.git` stop;
   `Explicit` with a missing file; `Defaults`. Parse and each validation refusal, one test per
   refusal, each asserting the message names the file **and** the key. Precedence in both directions,
   with `--no-deny-warnings` beating a config `true` as the case that matters.
2. **A width-parameterized printer property**, generalizing
   `no_line_exceeds_the_budget_except_the_three_documented_constructs` from its fixed 120. **This is
   the sabotage check and it is the reason to write it:** if only two of §1.4's three sites get
   `self.width`, the existing 120-only test still passes and a parameterized one fails. The three
   documented exceptions stay enumerated rather than waived, at every width tested.
3. **`trycmd` transcripts.** Five help goldens change — global `--config` / `--no-config` touch all
   five, and `--width`, `--field-width`, `--deny-warnings` touch one each. New cases for each config
   refusal and for a denied warning.

**One assertion the roadmap's own history demands.** Plan 6's first half found eleven mutations
surviving a full suite, four of them because their tests assert a diagnostic's count and span and
never its **message**. The `--deny-warnings` test therefore asserts the exit code **and** that the
warning text still reaches stderr: a deny that swallowed the message would pass a code-only test.

## §10 Risks

1. **Measured 2026-08-26: the `trycmd` sandbox is OUTSIDE the repository working tree, under
   `/tmp`.** All 29 cases run `fs.sandbox = true`, which copies the case's `.in` directory somewhere
   and runs there; discovery walks *up* from that somewhere. The plan's Steps 1–2 said to add a
   `trycmd` case with no golden and read the sandbox path out of the resulting failure report; that
   produced nothing, because a case with no golden passes silently rather than failing, so no
   failure report exists to read. The plan's fallback commands — a `find` under the cargo target
   directory, and an `ls` of `/tmp/*trycmd*` — also returned nothing. The answer came from running a
   throwaway case (`crates/redextape-cli/tests/cmd/_probe_cwd.toml`, `args = ["fmt",
   "does-not-exist.rxt"]`, `status.code = 2`) under `strace -f -e trace=chdir,execve` against the
   compiled `redextape-cli` `cli` test binary (invoked from `crates/redextape-cli/` so `trycmd`'s
   `tests/cmd/*.toml` glob resolved), corroborated by reading the `trycmd`/`snapbox`/`tempfile`
   source. The spawned `redextape` subprocess's own syscall was
   `chdir("/tmp/.tmp0GpIWc")` immediately before its `execve`, and the process exited `2` as
   expected — a directly observed, literal sandbox path, one random-named directory directly under
   `/tmp`, not under this repository. This is a single sample of one path shape on one run, not a
   proof that the shape never varies. **This is corroborated, not merely assumed**, by reading the
   installed source: `trycmd` 1.2.1's `fs_context` (`src/runner.rs`) calls
   `snapbox::dir::DirRoot::mutable_temp()` for the default `Mode::Fail` (and for `Mode::Overwrite`;
   only `TRYCMD=dump:PATH` takes the other branch, `mutable_at`), and `snapbox` 1.2.2's
   `mutable_temp()` (`src/dir/root.rs`) calls `tempfile::tempdir()`, which (`tempfile` 3.27.0's
   `src/env.rs`) delegates to `std::env::temp_dir()` absent an override — `/tmp` on this machine,
   the same shared RAM tmpfs named in risk 2 below, and unrelated to the repository tree by
   construction rather than by chance of one measurement. `/tmp/.tmp0GpIWc` sits one directory level
   below `/tmp`, so a discovery walk starting inside any `trycmd` sandbox reaches `/tmp` itself on
   its first upward step — the shortest walk that can hit item 2's hazard below. Item 2 is written
   about a future discovery unit test; this measurement is direct evidence that the CLI's existing
   `trycmd` harness already sits at that same one-hop distance, which is what makes planting a
   `.git` marker in test fixtures load-bearing rather than belt-and-braces.

   **The mitigation does not depend on the answer: this slice adds no `redextape.toml` at the
   repository root.** With no such file, discovery from any sandbox finds nothing wherever the
   sandbox lands, and none of the 29 existing cases can change behaviour. Dogfooding the config on
   this repository becomes a separate and deliberate decision, taken with this hazard already
   written down rather than discovered by a golden that moved.

2. **`/tmp` is a shared RAM tmpfs on this machine and discovery walks into it.** A discovery test
   writing `redextape.toml` under `std::env::temp_dir()` has a walk that reaches `/tmp` itself, where
   a parallel job's stray file could satisfy it — and this repository runs parallel background jobs
   that share `/tmp`. **Every discovery test plants a `.git` marker at its own tmpdir root**, which
   bounds the walk, makes the test hermetic, and exercises the `.git` stop rule in the same breath.

3. **A width-parameterized property test could pass by testing only widths near 120.** The three
   documented exceptions are load-bearing and a narrow band would not exercise them. The plan names
   the widths tested rather than leaving the range to a generator whose seed nobody records.

4. **`toml` is a new dependency in a workspace that counts them.** It goes in `redextape-cli` only.
   `redextape-core`'s "one optional dependency" property is untouched and the plan re-derives it with
   `cargo tree -p redextape-core --edges normal` rather than asserting it.

## §11 What this does not close

- **Lint rule sets and suppression syntax.** A rule *set* is a later slice with its own design —
  which rules, what suppression looks like, and whether any are configurable. This slice adds no
  rules and no per-rule configuration; `deny-warnings` is all-or-nothing over the tier.
- **`run`'s caps in the config.** `interp`'s step budget, `MAX_REDUCTION_STEPS` and `TM_DEFAULT_CAPS`
  remain three unrelated constants a user cannot set. Unifying them is a separate question the
  roadmap already records, and configuring them before unifying them would fix the confusion in
  place.
- **`--trace`.** Unchanged from the `cli-emit-and-run` design's §7: separate design, own
  output-format questions.
- **Per-file discovery.** One config governs an invocation. A monorepo with different settings per
  subtree is `rustfmt`'s model and would mean `fmt a.rxt b.rxt` formatting two files at two widths in
  one command, with `--check`'s diff needing to say which config produced it.
- **Any config surface for `web/`.** The browser app has no filesystem and no relationship to this
  file.
- **A root `redextape.toml` for this repository.** §10.1.

## §12 Open questions

**One, and it is small.** Does `--config` accept `-` for standard input? Assumed no — a config read
from a pipe cannot be named in an error message, and every consumer named so far is a checked-in
file. Nothing here depends on the answer.

**Decided rather than left open, recorded because it is user-visible:** `--config` and `--no-config`
appear in every subcommand's `--help` because they are `global = true`. That is five goldens changed
for a flag most invocations never pass, and it is the right trade: a global flag that does not appear
under the subcommand a user is reading is a flag they will not find.
