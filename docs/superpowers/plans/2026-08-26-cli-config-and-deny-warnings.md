# `redextape.toml` and `--deny-warnings` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-level `redextape.toml` that sets defaults for four settings, a `--deny-warnings`
flag that makes a warning fail `lint`, and a CLI flag for every config key so precedence is uniform.

**Architecture:** A new `crates/redextape-cli/src/config.rs` owns discovery, parsing and validation
and produces a plain `Config`. `main` resolves flag > config > default into plain values and hands
those to the command modules, which never learn a config file exists. Two additive `redextape-core`
entry points supply what the CLI cannot express today: a width for the printer, and a single-attempt
variant of the TM fitting search.

**Tech Stack:** Rust 2024, `clap` 4 (derive), `toml` + `serde` (new to `redextape-cli`), `nextest`,
`trycmd`, `assert_cmd`.

**Design:** [`../specs/2026-08-26-cli-config-and-deny-warnings-design.md`](../specs/2026-08-26-cli-config-and-deny-warnings-design.md),
committed at `32a4afc` and amended at `af9b525`. Branch: `cli-config-and-deny-warnings`.

## Global Constraints

- **THE PRE-COMMIT GATE MAKES THE CLASSIC TDD COMMIT SPLIT INFEASIBLE, AND THIS PLAN COLLAPSES IT
  DELIBERATELY.** `.pre-commit-config.yaml` runs `cargo clippy --workspace --all-targets -- -D
  warnings` on any staged `.rs` file. A commit containing a test that names a function which does not
  exist yet does not compile, so clippy fails and the commit is refused. **The test-first cycle still
  applies** — write the test, run it, watch it fail, implement, watch it pass — but the commit happens
  once at the end of the cycle and contains both. **Never `--no-verify`.**
- `redextape-core` keeps exactly one dependency, `serde`, optional and default-off. `toml` and a
  direct `serde` go in `redextape-cli` only. Re-derive with
  `cargo tree -p redextape-core --edges normal` rather than asserting it.
- Workspace clippy runs `pedantic` as written plus denied `unwrap_used`, `expect_used`, `panic`,
  `todo`, `unimplemented`. `clippy.toml` exempts `unwrap`/`expect`/`panic` inside a `#[test]`
  function or a **bare** `#[cfg(test)]` module only. A free helper in a `tests/` or `examples/`
  target is in neither and needs a file-level `#![allow(...)]`.
- **No `redextape.toml` at the repository root** (design §10.1). This is what keeps all 29 existing
  `trycmd` cases from changing behaviour, and it holds regardless of Task 1's answer.
- Rust doc comments are `///`, never `/** */`.
- Commit messages are hard-wrapped. No `Co-Authored-By` and no generated-with attribution.
- **A roadmap entry is written before the PR is opened**, not after — Task 10.

---

### Task 1: Measure where `trycmd`'s sandbox actually runs

Design §10.1 records this as UNKNOWN and requires it measured rather than assumed. Discovery walks
*up* from the process's working directory; if `trycmd` sandboxes somewhere under the repository, a
future root `redextape.toml` would silently govern all 29 cases. Nothing later in this plan depends
on the answer — the mitigation is "add no root config" either way — but the answer belongs in the
tree instead of in someone's head.

**Files:**
- Create (temporarily, deleted in Step 4): `crates/redextape-cli/tests/cmd/_probe_cwd.toml`
- Modify: `docs/superpowers/specs/2026-08-26-cli-config-and-deny-warnings-design.md` (§10.1)

**Interfaces:**
- Consumes: nothing.
- Produces: a recorded absolute-path shape in §10.1. No code.

- [ ] **Step 1: Write a throwaway trycmd case that prints its working directory**

Create `crates/redextape-cli/tests/cmd/_probe_cwd.toml`:

```toml
bin.name = "redextape"
args = ["fmt", "does-not-exist.rxt"]
fs.sandbox = true
status.code = 2
```

The command fails on purpose. What is wanted is not its output but the path `trycmd` ran it in.

- [ ] **Step 2: Run it and capture the sandbox path**

Run:

```bash
cargo nextest run -p redextape-cli --test cli 2>&1 | tee target/rxt-probe.log
```

**`target/`, not `/tmp`.** `/tmp` on this machine is a shared RAM tmpfs that parallel background
jobs write to; a fixed filename there is one another job can clobber mid-read.

Expected: the case fails on an unmatched golden, and `trycmd`'s failure report prints the sandbox
directory it created. If the report does not name it, get the path directly instead:

```bash
find "$(cargo metadata --format-version 1 --no-deps | jq -r .target_directory)" \
  -maxdepth 4 -type d -name '*_probe_cwd*' 2>/dev/null
ls -d /tmp/*trycmd* /tmp/.tmp* 2>/dev/null | head
```

Record the absolute path shape. The single question to answer: **is it inside the repository working
tree, or outside it (under `/tmp` or another temp root)?**

- [ ] **Step 3: Write the answer into the design's §10.1**

Replace §10.1's "UNKNOWN and must be measured" paragraph with the measurement. Keep the mitigation
sentence unchanged — it holds either way. State the path shape and the date, name the command that
produced it, and say plainly which of the two cases it is. If the sandbox turns out to be **inside**
the working tree, add one sentence: a root `redextape.toml` would be found by every case's discovery
walk, so adding one later requires `--no-config` on all 29 cases or a `.git`-bounded sandbox.

- [ ] **Step 4: Delete the probe case**

```bash
rm crates/redextape-cli/tests/cmd/_probe_cwd.toml
```

- [ ] **Step 5: Verify the tree is clean and the suite is green**

```bash
git status --short
cargo nextest run -p redextape-cli
```

Expected: `git status --short` shows only the modified design document; the CLI suite passes with the
same counts as before the probe.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-26-cli-config-and-deny-warnings-design.md
git commit -m "design: §10.1's unknown is measured — trycmd's sandbox root, named rather than assumed"
```

---

### Task 2: `config.rs` — schema, parsing, and validation

Discovery is Task 3. This task produces a module that turns a TOML string into a validated `Config`
or a refusal, unit-tested, wired to nothing.

**Files:**
- Create: `crates/redextape-cli/src/config.rs`
- Modify: `crates/redextape-cli/Cargo.toml`
- Modify: `crates/redextape-cli/src/main.rs` (add `mod config;` only)
- Modify: `crates/redextape-cli/src/emit.rs` (derive `Deserialize` on `EncodingArg`)

**Interfaces:**
- Consumes: `crate::emit::EncodingArg`.
- Produces:
  - `pub const FILE_NAME: &str = "redextape.toml"`
  - `pub const WIDTH_RANGE: RangeInclusive<usize>`
  - `pub struct Config { pub lint: Lint, pub fmt: Fmt, pub emit: Emit }` — all `pub`, `Default`
  - `pub struct Lint { pub deny_warnings: bool }`
  - `pub struct Fmt { pub width: usize }`
  - `pub struct Emit { pub encoding: EncodingArg, pub field_width: usize }`
  - `pub enum Error` implementing `std::fmt::Display` and `std::error::Error`
  - `pub fn parse(text: &str, path: &Path) -> Result<Config, Error>`

- [ ] **Step 1: Add the two dependencies**

Run:

```bash
cargo add toml --package redextape-cli
cargo add serde --features derive --package redextape-cli
```

**Use `cargo add`, do not hand-write a version.** A guessed pin is how this repository once pinned a
`tree-sitter` version that had never been published. Record the versions `cargo add` chose — they go
in Task 10's roadmap entry.

- [ ] **Step 2: Confirm `redextape-core` gained nothing**

Run:

```bash
cargo tree -p redextape-core --edges normal
```

Expected: `redextape-core v0.0.0` and nothing else. If `toml` or `serde` appears here, the `--package`
flag was dropped from Step 1 and the change must be reverted.

- [ ] **Step 3: Make `EncodingArg` deserializable**

In `crates/redextape-cli/src/emit.rs`, extend the derive on `EncodingArg` and add the rename:

```rust
/// Tape encoding for `--lang tm`. `Default` is what an omitted `--encoding` means; the flag itself
/// is an `Option` so that passing `--encoding unary` off the `tm` target is still an error.
///
/// `Deserialize` is what lets `redextape.toml`'s `emit.encoding` name the same two values the flag
/// does. `rename_all` makes the TOML spellings `"unary"` and `"binary"`, matching what `clap` prints
/// in `--help`: one set of names for a user to learn, not two.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum, serde::Deserialize)]
#[serde(rename_all = "lowercase", deny_unknown_fields)]
pub enum EncodingArg {
```

Leave the two variants and their doc comments exactly as they are.

- [ ] **Step 4: Write `config.rs` with its schema and validation**

Create `crates/redextape-cli/src/config.rs`:

```rust
//! `redextape.toml` — the schema, its parser, and its refusals. Discovery lives beside it.
//!
//! **THIS MODULE NEVER READS THE PROCESS'S WORKING DIRECTORY.** `discover` takes the directory to
//! start from and `main` is what passes `std::env::current_dir()`. `cwd` is process-global, and
//! under `cargo test` every test in a binary shares one process — the hazard `lint.rs`'s `tmpdir`
//! helper already documents for process ids — so a `set_current_dir` here would be a race that
//! `nextest` hides by giving each test its own process and `cargo test` does not.
//!
//! **A FILE THAT CANNOT BE UNDERSTOOD STOPS THE RUN.** Unknown key, unknown table, wrong type and
//! out-of-range value are all refusals at exit 2, never a fallback to a default. The config's most
//! important key is a CI gate, and a typo that silently disarms a gate is worse than no config file
//! at all. `emit`'s `--encoding` guard makes the same trade one level down.

use crate::emit::EncodingArg;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// The file name `discover` looks for in each directory it walks.
pub const FILE_NAME: &str = "redextape.toml";

/// What `fmt.width` may be.
///
/// **THE FLOOR IS A JUDGEMENT AND THE DESIGN SAYS SO** (§3). Below about 20 columns the printer's
/// three documented over-budget constructs stop being exceptions: four columns of indent per nesting
/// level plus a short binding is most of the line, so a large fraction of any real program overruns
/// and the setting names a width the output does not resemble. The ceiling is a sanity bound — a
/// width no terminal has is not a formatting request, it is a typo.
pub const WIDTH_RANGE: std::ops::RangeInclusive<usize> = 20..=1000;

/// Every setting `redextape.toml` may carry.
///
/// `deny_unknown_fields` is what produces the unknown-TABLE refusal; each nested struct carries it
/// for its own keys. `rename_all` is what makes the TOML spelling `deny-warnings` while the Rust
/// field stays `deny_warnings`.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields, rename_all = "kebab-case")]
pub struct Config {
    pub lint: Lint,
    pub fmt: Fmt,
    pub emit: Emit,
}

/// `[lint]`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields, rename_all = "kebab-case")]
pub struct Lint {
    /// Make a warning fail the run. `false` is today's behaviour and stays the default.
    pub deny_warnings: bool,
}

/// `[fmt]`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields, rename_all = "kebab-case")]
pub struct Fmt {
    /// The printer's line budget. **A BUDGET, NOT A BOUND** — three constructs already overrun it
    /// and `redextape-core`'s `format_properties.rs` asserts that they do. Narrower widths make all
    /// three bite more often.
    pub width: usize,
}

impl Default for Fmt {
    fn default() -> Self {
        Fmt { width: redextape_core::printer::MAX_WIDTH }
    }
}

/// `[emit]`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields, rename_all = "kebab-case")]
pub struct Emit {
    /// Tape encoding. Applies to `--lang tm` and is ignored for every other target — a config file
    /// must never make a previously-working command line fail.
    pub encoding: EncodingArg,
    /// TM tape field width in cells. **`0` MEANS AUTO-FIT**, which is today's behaviour: the fitting
    /// search starts at `MIN_FIELD_WIDTH` and doubles. Any other value pins the width and skips the
    /// search. The sentinel exists so this struct holds no `Option` — `emit`'s flag is the only
    /// `Option` in the merge, which is what keeps its flag-presence guard readable.
    pub field_width: usize,
}

/// Why a config file was refused. `Display` is the message the user sees on stderr.
///
/// **`Display` CARRIES THE `error: ` PREFIX ITSELF** because `main`'s handler renders these with a
/// bare `writeln!(err, "{e}")` and adds nothing. `InputError` in `input.rs` makes the opposite
/// choice and is left alone; matching it here would print a refusal that does not read as one.
#[derive(Debug)]
pub enum Error {
    /// The file was named by `--config` and could not be read.
    Read { path: PathBuf, source: std::io::Error },
    /// The file is not valid TOML, or carries a key or type the schema does not admit.
    Parse { path: PathBuf, message: String },
    /// The file parsed and a value is out of range.
    Invalid { path: PathBuf, message: String },
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Read { path, source } => {
                write!(f, "error: cannot read `{}`: {source}", path.display())
            }
            Error::Parse { path, message } | Error::Invalid { path, message } => {
                write!(f, "error: {}: {message}", path.display())
            }
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Error::Read { source, .. } => Some(source),
            Error::Parse { .. } | Error::Invalid { .. } => None,
        }
    }
}

/// Parse `text` as a config file, then validate every range.
///
/// `path` is carried for the message only — nothing is read from disk here, which is what lets every
/// schema and range test below be a pure string test with no filesystem at all.
///
/// # Errors
///
/// `Error::Parse` for anything `serde` refuses, which includes an unknown key, an unknown table and
/// a wrong type. `Error::Invalid` for a value that parsed and is out of range.
pub fn parse(text: &str, path: &Path) -> Result<Config, Error> {
    let config: Config = toml::from_str(text).map_err(|e| Error::Parse {
        path: path.to_path_buf(),
        // `toml`'s own message names the offending key and what was expected instead, which is the
        // "did you mean" the design asked for without a second suggestion mechanism to maintain.
        // Its multi-line span rendering is collapsed to one line so a `trycmd` golden stays legible.
        message: e.message().replace('\n', "; "),
    })?;
    validate(&config, path)?;
    Ok(config)
}

/// Every range check, in one place so a caller cannot get a `Config` that skipped one.
fn validate(config: &Config, path: &Path) -> Result<(), Error> {
    let invalid = |message: String| Error::Invalid { path: path.to_path_buf(), message };

    if !WIDTH_RANGE.contains(&config.fmt.width) {
        return Err(invalid(format!(
            "`fmt.width` must be in {}..={}, got {}",
            WIDTH_RANGE.start(),
            WIDTH_RANGE.end(),
            config.fmt.width
        )));
    }

    // 0 is the auto-fit sentinel and is always legal. Any other value is a pinned width and must be
    // one the encodings can actually build, so the bound is read from core's own constants rather
    // than written out here — a copy would drift the first time either constant moved.
    let fw = config.emit.field_width;
    let (lo, hi) = (redextape_core::tm::MIN_FIELD_WIDTH, redextape_core::tm::MAX_FIELD_WIDTH);
    if fw != 0 && !(lo..=hi).contains(&fw) {
        return Err(invalid(format!(
            "`emit.field-width` must be 0 (auto-fit) or in {lo}..={hi}, got {fw}"
        )));
    }

    Ok(())
}
```

**If `redextape_core::tm::MIN_FIELD_WIDTH` or `MAX_FIELD_WIDTH` is not re-exported at that path**,
find the real one with `grep -rn 'pub use.*FIELD_WIDTH\|pub const M.._FIELD_WIDTH' crates/redextape-core/src/`
and use it. They are declared in `crates/redextape-core/src/tm/build.rs` at lines 54 and 72; if
`tm/build.rs` is private, add a `pub use` in `crates/redextape-core/src/tm.rs` beside the existing
re-exports and say so in the commit message.

- [ ] **Step 5: Register the module**

In `crates/redextape-cli/src/main.rs`, add `mod config;` to the module list, keeping it alphabetical:

```rust
mod cli;
mod config;
mod emit;
mod fmt;
mod input;
mod lint;
mod report;
mod run;
```

- [ ] **Step 6: Write the failing tests**

Append to `crates/redextape-cli/src/config.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// Every test here is a pure string test: `parse` reads nothing from disk, so the path is a
    /// label and no fixture is needed.
    fn p() -> &'static Path {
        Path::new("/repo/redextape.toml")
    }

    #[test]
    fn an_empty_file_is_every_default() {
        let got = parse("", p()).unwrap();
        assert_eq!(got, Config::default());
        assert!(!got.lint.deny_warnings, "warnings are not denied by default");
        assert_eq!(got.fmt.width, redextape_core::printer::MAX_WIDTH, "the default IS the constant");
        assert_eq!(got.emit.field_width, 0, "0 is auto-fit, which is today's behaviour");
    }

    #[test]
    fn a_partial_file_defaults_every_table_it_omits() {
        // The case a `deny_unknown_fields` schema gets wrong if `#[serde(default)]` is missing from
        // a container: a present `[lint]` with no keys, and two absent tables.
        let got = parse("[lint]\n", p()).unwrap();
        assert_eq!(got, Config::default());
    }

    #[test]
    fn every_key_round_trips_from_its_toml_spelling() {
        let got = parse(
            "[lint]\ndeny-warnings = true\n\n[fmt]\nwidth = 100\n\n[emit]\nencoding = \"binary\"\nfield-width = 32\n",
            p(),
        )
        .unwrap();
        assert!(got.lint.deny_warnings);
        assert_eq!(got.fmt.width, 100);
        assert_eq!(got.emit.encoding, EncodingArg::Binary);
        assert_eq!(got.emit.field_width, 32);
    }

    // THE ONE THING MOST LIKELY TO BE WRONG: the kebab-case rename. A snake_case key is the typo a
    // user actually makes, and if `rename_all` were dropped this test would pass while
    // `every_key_round_trips_from_its_toml_spelling` failed — so both spellings are pinned, in
    // opposite directions, rather than trusting one.
    #[test]
    fn the_snake_case_spelling_of_a_key_is_refused_and_the_message_names_it() {
        let err = parse("[lint]\ndeny_warnings = true\n", p()).unwrap_err();
        let text = err.to_string();
        assert!(matches!(err, Error::Parse { .. }), "got {err:?}");
        assert!(text.contains("deny_warnings"), "the message must name the key it got: {text}");
        assert!(text.contains("deny-warnings"), "and the one it expected: {text}");
        assert!(text.contains("/repo/redextape.toml"), "and the file: {text}");
    }

    #[test]
    fn an_unknown_table_is_refused() {
        let err = parse("[lnt]\ndeny-warnings = true\n", p()).unwrap_err();
        assert!(matches!(err, Error::Parse { .. }), "got {err:?}");
        assert!(err.to_string().contains("lnt"), "the message must name the table: {err}");
    }

    #[test]
    fn a_wrong_type_is_refused() {
        let err = parse("[fmt]\nwidth = \"wide\"\n", p()).unwrap_err();
        assert!(matches!(err, Error::Parse { .. }), "got {err:?}");
    }

    #[test]
    fn an_unknown_encoding_is_refused() {
        let err = parse("[emit]\nencoding = \"ternary\"\n", p()).unwrap_err();
        assert!(matches!(err, Error::Parse { .. }), "got {err:?}");
        assert!(err.to_string().contains("ternary"), "the message must name the value: {err}");
    }

    // Both ends of the range, and both are refusals rather than clamps. A clamp would format at a
    // width nobody asked for, which is the failure this schema exists to prevent.
    #[test]
    fn a_width_below_the_floor_is_refused_not_clamped() {
        let err = parse("[fmt]\nwidth = 4\n", p()).unwrap_err();
        assert!(matches!(err, Error::Invalid { .. }), "got {err:?}");
        let text = err.to_string();
        assert!(text.contains("fmt.width"), "the message must name the key: {text}");
        assert!(text.contains('4'), "and the value it got: {text}");
        assert!(text.contains("20"), "and the bound it broke: {text}");
    }

    #[test]
    fn a_width_above_the_ceiling_is_refused() {
        let err = parse("[fmt]\nwidth = 100000\n", p()).unwrap_err();
        assert!(matches!(err, Error::Invalid { .. }), "got {err:?}");
    }

    #[test]
    fn the_width_bounds_themselves_are_accepted() {
        // An exclusive-vs-inclusive slip in `WIDTH_RANGE.contains` fails here and nowhere else.
        assert_eq!(parse("[fmt]\nwidth = 20\n", p()).unwrap().fmt.width, 20);
        assert_eq!(parse("[fmt]\nwidth = 1000\n", p()).unwrap().fmt.width, 1000);
    }

    #[test]
    fn field_width_zero_is_auto_fit_and_is_accepted() {
        assert_eq!(parse("[emit]\nfield-width = 0\n", p()).unwrap().emit.field_width, 0);
    }

    #[test]
    fn a_field_width_between_zero_and_the_floor_is_refused() {
        // 2 is the interesting value: non-zero, so not the sentinel, and below MIN_FIELD_WIDTH's 4.
        let err = parse("[emit]\nfield-width = 2\n", p()).unwrap_err();
        assert!(matches!(err, Error::Invalid { .. }), "got {err:?}");
        assert!(err.to_string().contains("emit.field-width"), "must name the key: {err}");
    }

    #[test]
    fn a_field_width_above_max_field_width_is_refused() {
        let err = parse("[emit]\nfield-width = 65\n", p()).unwrap_err();
        assert!(matches!(err, Error::Invalid { .. }), "got {err:?}");
    }

    #[test]
    fn the_field_width_bounds_themselves_are_accepted() {
        assert_eq!(parse("[emit]\nfield-width = 4\n", p()).unwrap().emit.field_width, 4);
        assert_eq!(parse("[emit]\nfield-width = 64\n", p()).unwrap().emit.field_width, 64);
    }

    #[test]
    fn malformed_toml_is_refused() {
        let err = parse("[lint\n", p()).unwrap_err();
        assert!(matches!(err, Error::Parse { .. }), "got {err:?}");
    }
}
```

- [ ] **Step 7: Run the tests and watch them fail, then pass**

Run:

```bash
cargo nextest run -p redextape-cli config::
```

Expected on a first run against an incomplete `config.rs`: compile errors naming the missing items.
Once Steps 3–6 are complete: **15 tests run, 15 passed.**

If `the_snake_case_spelling_of_a_key_is_refused_and_the_message_names_it` fails on the
`contains("deny-warnings")` assertion, `toml`'s message does not list expected fields the way the
design assumed. **Do not weaken the assertion.** Print the real message
(`cargo nextest run -p redextape-cli the_snake_case --no-capture`), then either keep the assertion
and build the expected-field list into `Error::Parse`'s message, or drop that one assertion and
record in the design's §8 that serde's message names the offending field only. §8 says this is to be
verified rather than assumed; this is where that happens.

- [ ] **Step 8: Check formatting and lints**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: both clean. `Error` has no `unwrap` outside tests; if clippy asks for `#[must_use]` on
`parse`, add it.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-cli/Cargo.toml Cargo.lock crates/redextape-cli/src/config.rs \
        crates/redextape-cli/src/main.rs crates/redextape-cli/src/emit.rs
git commit -m "config: the schema and its refusals, with the kebab-case rename pinned from both directions"
```

---

### Task 3: `config.rs` — discovery and `load`

**Files:**
- Modify: `crates/redextape-cli/src/config.rs`

**Interfaces:**
- Consumes: `parse`, `Config`, `Error`, `FILE_NAME` from Task 2.
- Produces:
  - `pub enum Source { Discover { from: PathBuf }, Explicit(PathBuf), Defaults }`
  - `pub fn load(source: &Source) -> Result<Config, Error>`
  - `pub fn discover(from: &Path) -> Option<PathBuf>`

- [ ] **Step 1: Write discovery and `load`**

Insert into `crates/redextape-cli/src/config.rs`, above the `#[cfg(test)]` module:

```rust
/// Where `load` gets its config from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Source {
    /// Walk up from this directory. Finding nothing is normal and yields defaults.
    Discover { from: PathBuf },
    /// Use exactly this file. A missing file here IS an error — naming a file that is not there is
    /// a mistake, where having no config file at all is not.
    Explicit(PathBuf),
    /// `--no-config`: skip the filesystem entirely.
    Defaults,
}

/// The nearest `redextape.toml` at or above `from`, if there is one.
///
/// **THE CONFIG FILE IS CHECKED BEFORE THE `.git` STOP, IN EACH DIRECTORY.** A repository root
/// normally holds both, so checking `.git` first would stop one directory short of the file this
/// walk exists to find.
///
/// **`.git` IS TESTED WITH `exists()`, NOT `is_dir()`.** A worktree and a submodule both write
/// `.git` as a FILE. This repository uses worktrees, so the wrong predicate would fail exactly where
/// it is most likely to be exercised.
///
/// Takes the directory to start from and never reads the process's working directory — see this
/// module's own doc comment for why that is load-bearing rather than stylistic.
#[must_use]
pub fn discover(from: &Path) -> Option<PathBuf> {
    for dir in from.ancestors() {
        let candidate = dir.join(FILE_NAME);
        if candidate.is_file() {
            return Some(candidate);
        }
        if dir.join(".git").exists() {
            return None;
        }
    }
    None
}

/// Resolve `source` to a validated `Config`.
///
/// # Errors
///
/// `Error::Read` when `Explicit` names a file that cannot be read, and whatever `parse` returns for
/// a file that was read. `Discover` finding nothing returns `Ok(Config::default())` — an absent
/// config file is the normal case and is not a failure.
pub fn load(source: &Source) -> Result<Config, Error> {
    let path = match source {
        Source::Defaults => return Ok(Config::default()),
        Source::Discover { from } => match discover(from) {
            Some(p) => p,
            None => return Ok(Config::default()),
        },
        Source::Explicit(p) => p.clone(),
    };
    let text = std::fs::read_to_string(&path)
        .map_err(|source| Error::Read { path: path.clone(), source })?;
    parse(&text, &path)
}
```

- [ ] **Step 2: Write the failing discovery tests**

Append inside `config.rs`'s existing `mod tests`:

```rust
    /// A hermetic tree root for one discovery test.
    ///
    /// **EVERY DISCOVERY TEST PLANTS A `.git` MARKER AT ITS OWN ROOT, AND THAT IS NOT DECORATION.**
    /// `/tmp` on the development machine is a shared RAM tmpfs that parallel jobs write to, and an
    /// unbounded walk from a temp directory reaches `/tmp` itself, where another job's stray
    /// `redextape.toml` would satisfy it. The marker bounds the walk, makes the test hermetic, and
    /// exercises the `.git` stop rule in the same breath.
    ///
    /// Mixes the process id AND a per-call counter into the name, for the reason `fmt::tests::tmpdir`
    /// and `lint::tests::tmpdir` both give: under `cargo test` every test in this binary shares one
    /// process id, so a repeated label hands two tests the same directory.
    fn tree(name: &str) -> std::path::PathBuf {
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root =
            std::env::temp_dir().join(format!("redextape-config-{name}-{}-{seq}", std::process::id()));
        std::fs::remove_dir_all(&root).ok();
        std::fs::create_dir_all(root.join("a/b/c")).unwrap();
        std::fs::write(root.join(".git"), "gitdir: elsewhere\n").unwrap();
        root
    }

    #[test]
    fn discovery_finds_a_config_in_the_start_directory() {
        let root = tree("here");
        let cfg = root.join("a/b/c").join(FILE_NAME);
        std::fs::write(&cfg, "[fmt]\nwidth = 90\n").unwrap();
        assert_eq!(discover(&root.join("a/b/c")), Some(cfg));
    }

    #[test]
    fn discovery_walks_up_to_a_parent() {
        let root = tree("up");
        let cfg = root.join(FILE_NAME);
        std::fs::write(&cfg, "[fmt]\nwidth = 90\n").unwrap();
        assert_eq!(discover(&root.join("a/b/c")), Some(cfg), "three levels up must be found");
    }

    #[test]
    fn discovery_takes_the_nearest_of_two() {
        let root = tree("nearest");
        std::fs::write(root.join(FILE_NAME), "[fmt]\nwidth = 90\n").unwrap();
        let near = root.join("a").join(FILE_NAME);
        std::fs::write(&near, "[fmt]\nwidth = 80\n").unwrap();
        assert_eq!(discover(&root.join("a/b/c")), Some(near), "the nearest wins, not the outermost");
    }

    // THE ORDER OF THE TWO CHECKS INSIDE ONE DIRECTORY, pinned. A `.git`-before-file walk returns
    // None here and passes every other test in this file.
    #[test]
    fn a_config_beside_dot_git_is_found_rather_than_stopped_at() {
        let root = tree("beside");
        let cfg = root.join(FILE_NAME);
        std::fs::write(&cfg, "[fmt]\nwidth = 90\n").unwrap();
        assert_eq!(
            discover(&root.join("a/b/c")),
            Some(cfg),
            "the repository root holds both; the file must be checked BEFORE the stop"
        );
    }

    #[test]
    fn the_dot_git_stop_prevents_climbing_out_of_the_repository() {
        let root = tree("stop");
        // A config ABOVE the marker, which a correct walk must never reach.
        let outside = root.parent().unwrap().join(FILE_NAME);
        std::fs::write(&outside, "[fmt]\nwidth = 90\n").unwrap();
        let got = discover(&root.join("a/b/c"));
        std::fs::remove_file(&outside).ok();
        assert_eq!(got, None, "the walk must stop at `.git` rather than reaching {outside:?}");
    }

    // `.git` is a FILE in every tree this helper builds, which is the worktree and submodule shape.
    // An `is_dir()` predicate fails `the_dot_git_stop_...` above; this pins the reason explicitly.
    #[test]
    fn a_dot_git_file_stops_the_walk_the_same_as_a_directory() {
        let root = tree("gitfile");
        assert!(root.join(".git").is_file(), "the fixture must really be a file, not a directory");
        assert_eq!(discover(&root.join("a/b/c")), None);
    }

    #[test]
    fn discovery_finding_nothing_is_not_an_error() {
        let root = tree("none");
        let got = load(&Source::Discover { from: root.join("a/b/c") }).unwrap();
        assert_eq!(got, Config::default(), "an absent config file is the normal case");
    }

    #[test]
    fn an_explicit_path_skips_discovery_entirely() {
        let root = tree("explicit");
        // A discoverable config that must NOT be used, and a named one that must.
        std::fs::write(root.join(FILE_NAME), "[fmt]\nwidth = 90\n").unwrap();
        let named = root.join("other.toml");
        std::fs::write(&named, "[fmt]\nwidth = 80\n").unwrap();
        assert_eq!(load(&Source::Explicit(named)).unwrap().fmt.width, 80);
    }

    #[test]
    fn an_explicit_path_that_is_missing_is_an_error() {
        let root = tree("explicit-missing");
        let named = root.join("nope.toml");
        let err = load(&Source::Explicit(named)).unwrap_err();
        assert!(matches!(err, Error::Read { .. }), "got {err:?}");
        assert!(err.to_string().contains("nope.toml"), "the message must name the file: {err}");
    }

    #[test]
    fn defaults_reads_nothing_even_with_a_config_in_reach() {
        let root = tree("defaults");
        std::fs::write(root.join(FILE_NAME), "[fmt]\nwidth = 90\n").unwrap();
        assert_eq!(load(&Source::Defaults).unwrap(), Config::default());
    }
```

- [ ] **Step 3: Run the tests**

```bash
cargo nextest run -p redextape-cli config::
```

Expected: **25 tests run, 25 passed** (15 from Task 2, 10 here).

- [ ] **Step 4: Prove the `.git` stop test can actually fail**

Sabotage check — this test is the only one that catches an unbounded walk, so it must be shown
capable of failing. Temporarily delete the `.git` stop from `discover`:

```bash
cargo nextest run -p redextape-cli the_dot_git_stop_prevents_climbing_out_of_the_repository
```

Expected with the stop removed: **FAIL**, because the walk reaches the config planted above the
marker. Restore the stop and confirm it passes again. Do not commit the sabotaged version.

- [ ] **Step 5: Lints and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src/config.rs
git commit -m "config: discovery walks up and stops at .git, with the two-checks-per-directory order pinned"
```

---

### Task 4: `redextape-core` — a width for the printer

**Files:**
- Modify: `crates/redextape-core/src/printer.rs` (lines 30, 121-136, 184, 545, 593, 989-993)
- Modify: `crates/redextape-core/src/lib.rs:105-113`
- Modify: `crates/redextape-core/tests/format_properties.rs:127`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `printer::print_with_width(parsed: &Parsed<'_>, width: usize) -> String`
  - `redextape_core::format_with_width(src: &str, width: usize) -> Result<String, Vec<Diagnostic>>`
  - `printer::MAX_WIDTH` unchanged at `120`, with a corrected doc comment.

- [ ] **Step 1: Correct `MAX_WIDTH`'s doc comment**

In `crates/redextape-core/src/printer.rs`, append to the existing doc comment above
`pub const MAX_WIDTH: usize = 120;`, keeping every line already there:

```rust
/// **THIS IS THE DEFAULT, NOT THE RULE, AND IT IS BOTH OF THOSE WORDS THAT MATTER.** A caller may
/// choose another width through `print_with_width`, so a reader who meets this constant learns what
/// an un-parameterized `print` uses and nothing about what any given output is bounded by. It is
/// also not a bound at the default: `tests/format_properties.rs`'s
/// `no_line_exceeds_the_budget_except_the_three_documented_constructs` enumerates three constructs
/// that overrun it and pins each with an input that does.
pub const MAX_WIDTH: usize = 120;
```

- [ ] **Step 2: Give `Printer` the field**

Add to the `Printer<'a>` struct, after `level`:

```rust
    /// The line budget this printer is working to. `MAX_WIDTH` unless a caller chose otherwise —
    /// see that constant's doc for why it is a budget rather than a bound at any value.
    width: usize,
```

Change `Printer::new` to take it, and add a defaulted constructor so no existing call site changes
shape more than it must:

```rust
    fn new(src: &'a str, comments: &'a [Comment]) -> Self {
        Printer::with_width(src, comments, MAX_WIDTH)
    }

    fn with_width(src: &'a str, comments: &'a [Comment], width: usize) -> Self {
        Printer {
            src,
            comments,
            next: 0,
            out: String::new(),
            line_start: 0,
            level: 0,
            last_end: 0,
            speculating: 0,
            width,
            #[cfg(test)]
            prints: 0,
            #[cfg(test)]
            visited: Vec::new(),
        }
    }
```

- [ ] **Step 3: Change all three reads**

There are exactly three, and **all three must change or Step 6's test fails** — which is the point of
writing that test this way.

`printer.rs:184`, in `fits_inline_since`:

```rust
        self.col() <= self.width && self.line_start <= mark.out_len
```

`printer.rs:545`, in the bracketed-close check:

```rust
                if self.col() <= self.width {
```

`printer.rs:593`, in `fill_rows`:

```rust
                if self.col().saturating_add(width_of(item)).saturating_add(3) > self.width {
```

Verify none was missed:

```bash
grep -n 'MAX_WIDTH' crates/redextape-core/src/printer.rs
```

Expected: the declaration and doc at the top, the two doc-comment mentions at what were lines 138 and
581, and **no comparison in a method body**. Test-module mentions further down are fine.

- [ ] **Step 4: Add the public entry point**

Beside the existing `print`:

```rust
/// Print `parsed` to a chosen line budget.
///
/// `print` is this at `MAX_WIDTH`. **`width` IS NOT VALIDATED HERE**: core prints to whatever it is
/// given, and what a human may write in a config file is a CLI policy that lives in
/// `redextape-cli`'s `config::WIDTH_RANGE`. Keeping the range in one place is what stops two
/// definitions of "a legal width" drifting apart.
#[must_use]
pub fn print_with_width(parsed: &Parsed<'_>, width: usize) -> String {
    let mut p = Printer::with_width(parsed.src, &parsed.comments, width);
    p.program(&parsed.program);
    p.out
}
```

- [ ] **Step 5: Add `format_with_width`**

In `crates/redextape-core/src/lib.rs`, beside `format`:

```rust
/// `format`, to a chosen line budget.
///
/// # Errors
///
/// The parse diagnostics when `src` does not parse — identical to `format`, which is this at
/// `printer::MAX_WIDTH`.
pub fn format_with_width(src: &str, width: usize) -> Result<String, Vec<Diagnostic>> {
    let (parsed, diagnostics) = parser::parse_full(src);
    match parsed {
        Some(p) => Ok(printer::print_with_width(&p, width)),
        None => Err(diagnostics),
    }
}
```

Then make `format` delegate, so there is one body rather than two:

```rust
pub fn format(src: &str) -> Result<String, Vec<Diagnostic>> {
    format_with_width(src, printer::MAX_WIDTH)
}
```

- [ ] **Step 6: Write the width-parameterized property test**

In `crates/redextape-core/tests/format_properties.rs`, **add** this beside the existing
`no_line_exceeds_the_budget_except_the_three_documented_constructs`, leaving that test in place —
it pins the default and this pins the parameter.

```rust
/// The budget holds at widths other than the default, and the three documented exceptions stay
/// exceptions at every one of them.
///
/// **THIS IS THE SABOTAGE CHECK FOR THE WIDTH PARAMETER AND THAT IS WHY IT IS WRITTEN THIS WAY.**
/// Three sites in `printer.rs` compare against the budget. Wire only two of them to `self.width` and
/// the fixed-120 test above still passes, because at 120 the un-wired site reads the same number.
/// This test fails, because at 60 it does not.
///
/// The widths are NAMED rather than generated: a seed nobody records is a coverage claim nobody can
/// re-run, and a generator that happened to draw only values near 120 would not exercise the
/// exceptions at all.
#[test]
fn the_budget_holds_at_widths_other_than_the_default() {
    let breakable = "fn wide(a) { a } wide([1, 2, 3])";
    for width in [40usize, 60, 80, 200] {
        for line in format_with_width(breakable, width).unwrap().lines() {
            assert!(line.len() <= width, "over budget at width {width}: {line:?}");
        }
    }
}

#[test]
fn the_three_documented_exceptions_are_still_exceptions_at_a_narrow_width() {
    let width = 60;

    // §6.6: binary expressions never break.
    let binary = format_with_width(&vec!["1"; 200].join(" + "), width).unwrap();
    assert!(
        binary.lines().any(|l| l.len() > width),
        "a long binary chain is a DOCUMENTED exception at every width, not only at 120"
    );

    // §17, first divergence: parameter lists have no width handling at all.
    let params = (0..30).map(|i| format!("param_number_{i}")).collect::<Vec<_>>().join(", ");
    let out = format_with_width(&format!("fn wide({params}) {{ 1 }}\n0"), width).unwrap();
    assert!(out.lines().any(|l| l.len() > width), "a parameter list is a DOCUMENTED exception: {out}");

    // §17, second divergence: indentation is 4 columns per level with no fill rule, so a narrower
    // budget reaches the exception with LESS nesting than the default does.
    let mut deep = String::from("[aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa, bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb]");
    for _ in 0..40 {
        deep = format!("[{deep}]");
    }
    let out = format_with_width(&deep, width).unwrap();
    assert!(out.lines().any(|l| l.len() > width), "deep nesting is a DOCUMENTED exception");
}

/// `format` and `format_with_width(.., MAX_WIDTH)` are the same function.
#[test]
fn the_default_entry_point_agrees_with_the_parameterized_one_at_the_default() {
    for src in ["let x = 1;\nx + 1", "fn wide(a) { a } wide([1, 2, 3])"] {
        assert_eq!(format(src).unwrap(), format_with_width(src, MAX_WIDTH).unwrap());
    }
}
```

Add `format_with_width` to that file's `use redextape_core::{...}` list.

- [ ] **Step 7: Run the property tests, then prove the sabotage check bites**

```bash
cargo nextest run -p redextape-core --test format_properties
```

Expected: all pass, including the three new tests.

Now sabotage — revert **only** `printer.rs:593` (`fill_rows`) to `MAX_WIDTH` and re-run:

```bash
cargo nextest run -p redextape-core --test format_properties
```

Expected: `no_line_exceeds_the_budget_except_the_three_documented_constructs` still **PASSES** (it
tests only 120) and `the_budget_holds_at_widths_other_than_the_default` **FAILS**. That contrast is
the reason the new test exists. Restore `self.width` and confirm green. Do not commit the sabotaged
version.

- [ ] **Step 8: Confirm no printed byte moved at the default**

```bash
cargo nextest run -p redextape-core
```

Expected: every pre-existing golden, round-trip and fixture passes unchanged. If any printer golden
moved, `with_width` was not wired to `MAX_WIDTH` in `new`.

- [ ] **Step 9: Lints and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-core/src/printer.rs crates/redextape-core/src/lib.rs \
        crates/redextape-core/tests/format_properties.rs
git commit -m "core: the printer takes a width, and the fixed-120 property could not have caught two of the three sites"
```

---

### Task 5: `redextape-core` — `run_tm_described_at`

**Files:**
- Modify: `crates/redextape-core/src/tm.rs:296-314`

**Interfaces:**
- Consumes: nothing.
- Produces: `tm::run_tm_described_at(core: &Core, kind: EncodingKind, result: Ty, caps: TmCaps, width: usize) -> Result<DescribedRun, TmRun>`

- [ ] **Step 1: Factor the single attempt out of the search**

In `crates/redextape-core/src/tm.rs`, replace the body of `run_tm_described` with a call to a shared
private helper, and add the pinned variant beside it. Keep `run_tm_described`'s existing doc comment
exactly as it is and add the two new doc comments shown:

```rust
/// One lowering, one machine at `width`, one run, one header. No search.
///
/// The single place either public entry point builds a `DescribedRun`, so the pinned path cannot
/// drift from the fitted one.
fn describe_at(
    prog: &Program,
    n_slots: usize,
    kind: EncodingKind,
    result: Ty,
    caps: TmCaps,
    width: usize,
) -> Option<DescribedRun> {
    let fitted = kind.at(width);
    let (run, machine, init, steps) = attempt(prog, &*fitted, n_slots, caps)?;
    let tapes = init.into_iter().enumerate().collect();
    let header = TmHeader::new(kind, width, n_slots, result, tapes);
    Some(DescribedRun { run, machine, header, steps })
}

pub fn run_tm_described(core: &Core, kind: EncodingKind, result: Ty, caps: TmCaps) -> Result<DescribedRun, TmRun> {
    let (prog, sm) = lower_and_size(core)?;
    let n_slots = sm.n_slots();
    let mut width = MIN_FIELD_WIDTH;
    loop {
        let described = describe_at(&prog, n_slots, kind, result.clone(), caps, width)
            .ok_or(TmRun::TooLarge)?;
        match described.run {
            TmRun::Overflow if width < MAX_FIELD_WIDTH => width = (width * 2).min(MAX_FIELD_WIDTH),
            _ => return Ok(described),
        }
    }
}

/// `run_tm_described` at a width the caller chose, with the fitting search skipped.
///
/// **THIS CAN REFUSE A PROGRAM THE SEARCH WOULD HAVE ACCEPTED, AND THAT IS THE POINT OF ASKING FOR
/// IT.** `run_tm_described` starts at `MIN_FIELD_WIDTH` and doubles until the values fit; pinning a
/// width means the values fit there or they do not.
///
/// **`TmRun::Overflow` COMES BACK AS `Ok`, exactly as it does from `run_tm_described`** — a run that
/// started still has a configuration to describe, and the caller decides what an overflow means. It
/// is `emit`'s existing "a value does not fit this encoding's widest tape field" refusal that reads
/// it, unchanged by this function existing.
///
/// # Errors
///
/// The same two as `run_tm_described`: `Err(TmRun::LowerError(_))` when `core` has no asm lowering,
/// and `Err(TmRun::TooLarge)` when `lower_tm` refuses to build a machine at all.
pub fn run_tm_described_at(
    core: &Core,
    kind: EncodingKind,
    result: Ty,
    caps: TmCaps,
    width: usize,
) -> Result<DescribedRun, TmRun> {
    let (prog, sm) = lower_and_size(core)?;
    describe_at(&prog, sm.n_slots(), kind, result, caps, width).ok_or(TmRun::TooLarge)
}
```

**`result.clone()` inside the loop is required** because `TmHeader::new` takes `Ty` by value and the
loop may build more than one header. If `Ty` is `Copy`, drop the `.clone()`; check with
`grep -n 'pub enum Ty' -A2 crates/redextape-core/src/ty.rs` and follow what the type actually is
rather than either assumption here.

- [ ] **Step 2: Write the failing tests**

Append to `tm.rs`'s existing `#[cfg(test)] mod run_tm_tests`:

```rust
    /// The fitted and pinned paths agree when the pinned width is the one fitting would have chosen.
    ///
    /// This is the test that catches `describe_at` being wired into only one of the two entry
    /// points, or the two disagreeing about how a header is built.
    #[test]
    fn the_pinned_path_agrees_with_the_fitted_one_at_the_width_fitting_chose() {
        let core = desugar(&crate::parser::parse("1 + 2").0.unwrap());
        let ty = crate::ty::Ty::Nat;
        let fitted = run_tm_described(&core, EncodingKind::Unary, ty.clone(), TM_DEFAULT_CAPS).unwrap();
        let width = fitted.header.width;
        let pinned =
            run_tm_described_at(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS, width).unwrap();
        assert_eq!(pinned.header.width, fitted.header.width);
        assert_eq!(pinned.steps, fitted.steps, "the same machine must take the same number of steps");
    }

    /// A width too narrow for the program's values comes back as `Ok` carrying `Overflow`, NOT as an
    /// `Err`. `emit`'s refusal reads that variant, so turning it into an error here would change a
    /// user-visible message in a different crate.
    #[test]
    fn a_pinned_width_that_is_too_narrow_returns_ok_with_overflow() {
        // A value needing more than MIN_FIELD_WIDTH cells under unary, pinned at MIN_FIELD_WIDTH.
        let core = desugar(&crate::parser::parse("40 + 2").0.unwrap());
        let got = run_tm_described_at(
            &core,
            EncodingKind::Unary,
            crate::ty::Ty::Nat,
            TM_DEFAULT_CAPS,
            MIN_FIELD_WIDTH,
        )
        .unwrap();
        assert!(matches!(got.run, TmRun::Overflow), "got {:?}", got.run);
        assert_eq!(got.header.width, MIN_FIELD_WIDTH, "the header records the width it was pinned to");
    }

    /// The same program the pinned narrow width overflows on is accepted by the search, which is the
    /// difference the flag exists to express.
    #[test]
    fn the_search_accepts_what_a_narrow_pin_refuses() {
        let core = desugar(&crate::parser::parse("40 + 2").0.unwrap());
        let fitted =
            run_tm_described(&core, EncodingKind::Unary, crate::ty::Ty::Nat, TM_DEFAULT_CAPS).unwrap();
        assert!(!matches!(fitted.run, TmRun::Overflow), "the search must widen past the overflow");
        assert!(fitted.header.width > MIN_FIELD_WIDTH, "and must have actually widened");
    }
```

**If `DescribedRun.header`'s width is not reachable as `header.width`**, find the accessor with
`grep -n 'width' crates/redextape-core/src/tm/header.rs | head` and use the real one. If `Ty::Nat` is
spelled differently, `grep -n 'pub enum Ty' -A8 crates/redextape-core/src/ty.rs` gives the variants.

- [ ] **Step 3: Run the tests**

```bash
cargo nextest run -p redextape-core run_tm_tests
```

Expected: all pass, including the three new ones.

- [ ] **Step 4: Confirm the refactor moved no existing number**

```bash
cargo nextest run -p redextape-core
```

Expected: every step-count golden and TM fixture passes unchanged. `run_tm_described`'s behaviour is
identical — only its body moved.

- [ ] **Step 5: Lints and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-core/src/tm.rs
git commit -m "core: run_tm_described_at pins a field width, sharing one describe_at so the two paths cannot drift"
```

---

### Task 6: The global flags, the resolution point in `main`, and `lint --deny-warnings`

Config resolution and its first consumer land together. **These were two tasks in an earlier draft and
were merged deliberately:** splitting them left `cfg` resolved with nothing reading it, which meant
writing a `let _ = &cfg;` binding to get past `-D warnings` and deleting it one task later. A dead
binding that exists to satisfy a lint is worse than one slightly larger task.

**Files:**
- Modify: `crates/redextape-cli/src/cli.rs`
- Modify: `crates/redextape-cli/src/main.rs`
- Modify: `crates/redextape-cli/src/lint.rs` (module doc only)
- Create: `crates/redextape-cli/tests/config_cli.rs`

**Interfaces:**
- Consumes: `config::{load, Source, Config, Error}` from Tasks 2–3.
- Produces:
  - `Cli { config: Option<PathBuf>, no_config: bool, command: Command }`
  - `Command::Lint { paths, deny_warnings: bool, no_deny_warnings: bool }`
  - a resolved `Config` bound as `cfg` in `main` before dispatch
  - `lint::run`'s signature **unchanged** — the flag changes `main`'s mapping, not the module.

- [ ] **Step 1: Add the global flags**

In `crates/redextape-cli/src/cli.rs`, extend the `Cli` struct:

```rust
#[derive(Parser)]
#[command(name = "redextape", version, about = "The redextape mini-language toolchain")]
pub struct Cli {
    /// Read settings from this file instead of searching for one. Naming a file that does not exist
    /// is an error, where finding no file during the search is not.
    #[arg(long, global = true, conflicts_with = "no_config", value_name = "PATH")]
    pub config: Option<PathBuf>,
    /// Ignore any `redextape.toml` and use built-in defaults.
    #[arg(long, global = true)]
    pub no_config: bool,
    #[command(subcommand)]
    pub command: Command,
}
```

- [ ] **Step 2: Add the `lint` flag pair**

In the same file, the `Lint` variant:

```rust
    /// Report parse, type and lint diagnostics.
    Lint {
        /// Files to check. `-` reads standard input.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Make a warning fail the run: exit 1 rather than 0. Overrides `lint.deny-warnings` in
        /// `redextape.toml`.
        #[arg(long)]
        deny_warnings: bool,
        /// Report warnings without failing, overriding `lint.deny-warnings` in `redextape.toml`.
        #[arg(long, overrides_with = "deny_warnings")]
        no_deny_warnings: bool,
    },
```

**`overrides_with` on the second of the pair is what makes last-one-wins work**, and it is what lets
`--deny-warnings --no-deny-warnings` be legal rather than a conflict.

- [ ] **Step 3: Resolve the config before dispatch**

In `crates/redextape-cli/src/main.rs`, between `let args = cli::Cli::parse();` and the `match`:

```rust
fn main() -> ExitCode {
    let args = cli::Cli::parse();
    let color = report::should_color();
    let (mut out, mut err) = (std::io::stdout(), std::io::stderr());

    // **RESOLVED ONCE, HERE, AND THE COMMAND MODULES NEVER SEE IT.** Each module takes the plain
    // values it needs, so precedence — flag > config file > built-in default — lives in exactly one
    // function and the modules' unit tests keep passing a number or a bool rather than a fixture.
    let source = if args.no_config {
        config::Source::Defaults
    } else if let Some(path) = args.config {
        config::Source::Explicit(path)
    } else {
        match std::env::current_dir() {
            Ok(from) => config::Source::Discover { from },
            // A process with no readable working directory cannot discover anything. Defaults are
            // the honest answer and are not a failure: an absent config file is the normal case.
            Err(_) => config::Source::Defaults,
        }
    };
    let cfg = match config::load(&source) {
        Ok(c) => c,
        Err(e) => {
            let _ = writeln!(err, "{e}");
            return ExitCode::from(2);
        }
    };

    match args.command {
```

Add `mod config;` to the module list if Task 2 did not already, keeping it alphabetical.

- [ ] **Step 4: Correct `lint.rs`'s module doc**

`lint.rs`'s first lines currently say the flag does not exist. Replace that paragraph, leaving the
rest of the module doc and **every line of code in the file** untouched:

```rust
//! `redextape lint` — every static diagnostic `analyze` produces, rendered.
//!
//! A STATIC CHECKER, NOT A RUNNER: `Analysis::core` is ignored entirely. A warning is reported and,
//! by default, does not fail the run; `--deny-warnings` (or `lint.deny-warnings` in
//! `redextape.toml`) makes it exit 1 instead.
//!
//! **`Outcome::Warned` STAYS A DISTINCT VARIANT UNDER DENIAL, AND THE MAPPING IS `main`'s JOB.**
//! Collapsing it into `Errored` would lose the declaration order
//! `the_variant_order_is_the_severity_order` pins — the order that makes `.max()` the merge rule with
//! no rank table — and would print "Error" for a warning. The severity a user reads and the exit code
//! a script reads are different questions, and this flag answers only the second. It is also why
//! `run` gains no parameter: what was found does not change, only what an exit code makes of it.
```

- [ ] **Step 5: Map the `Lint` outcome in `main`**

Replace the `Lint` arm:

```rust
        cli::Command::Lint { paths, deny_warnings, no_deny_warnings } => {
            // flag > config > default, with the pair's last-one-wins already resolved by clap's
            // `overrides_with`: at most one of the two booleans is true here.
            let deny = if deny_warnings {
                true
            } else if no_deny_warnings {
                false
            } else {
                cfg.lint.deny_warnings
            };
            let inputs: Vec<Input> = paths.iter().map(|p| Input::from_arg(p)).collect();
            match lint::run(&inputs, &mut out, &mut err, color) {
                Ok(lint::Outcome::Clean) => ExitCode::SUCCESS,
                Ok(lint::Outcome::Warned) => {
                    if deny { ExitCode::from(1) } else { ExitCode::SUCCESS }
                }
                Ok(lint::Outcome::Errored) => ExitCode::from(1),
                Ok(lint::Outcome::Failed) => ExitCode::from(2),
                Err(e) => {
                    let _ = writeln!(err, "{e}");
                    ExitCode::from(2)
                }
            }
        }
```

Every other arm is unchanged in this task.

- [ ] **Step 6: Write the failing tests**

Create `crates/redextape-cli/tests/config_cli.rs`:

```rust
//! `--config`, `--no-config` and `--deny-warnings`, driven through the real binary.
//!
//! `#![allow(clippy::unwrap_used)]` at file level rather than per test: a `tests/` target is neither
//! a `#[test]` function's body nor a bare `#[cfg(test)]` module, so `clippy.toml`'s three
//! in-tests exemptions do not reach a free helper here. `clippy.toml` says so directly.
#![allow(clippy::unwrap_used)]

use assert_cmd::Command;

/// A directory holding one config file, bounded by a `.git` marker so discovery cannot climb out of
/// it into a shared `/tmp` another job is writing to.
fn tree(name: &str, config: &str) -> std::path::PathBuf {
    static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!("redextape-cfgcli-{name}-{}-{seq}", std::process::id()));
    std::fs::remove_dir_all(&root).ok();
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join(".git"), "gitdir: elsewhere\n").unwrap();
    std::fs::write(root.join("redextape.toml"), config).unwrap();
    std::fs::write(root.join("a.rxt"), "let x = 1;\nx + 1\n").unwrap();
    root
}

#[test]
fn a_malformed_config_refuses_at_exit_2_and_names_the_file() {
    let root = tree("malformed", "[lint]\ndeny_warnings = true\n");
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["lint", "a.rxt"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2), "a config that cannot be understood stops the run");
    let text = String::from_utf8(out.stderr).unwrap();
    assert!(text.contains("redextape.toml"), "the message must name the file: {text}");
    assert!(text.contains("deny_warnings"), "and the key: {text}");
}

#[test]
fn no_config_ignores_a_malformed_file_entirely() {
    let root = tree("no-config", "[lint]\ndeny_warnings = true\n");
    Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["--no-config", "lint", "a.rxt"])
        .assert()
        .success();
}

#[test]
fn an_explicit_config_that_is_missing_refuses() {
    let root = tree("explicit-missing", "");
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["--config", "nope.toml", "lint", "a.rxt"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8(out.stderr).unwrap().contains("nope.toml"));
}

#[test]
fn config_and_no_config_together_are_a_clap_error() {
    let root = tree("conflict", "");
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["--config", "redextape.toml", "--no-config", "lint", "a.rxt"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2), "clap's own code for a bad argument list");
}

/// A warning that is not denied still exits 0, and the diagnostic still reaches stderr.
///
/// **THE MESSAGE ASSERTION IS NOT PADDING.** Plan 6's first half found eleven mutations surviving a
/// full suite, four of them because their tests asserted a diagnostic's count and span and never its
/// message. A `--deny-warnings` implementation that swallowed the warning would pass a code-only
/// test in both directions.
#[test]
fn a_warning_exits_0_by_default_and_still_prints() {
    let root = tree("warn-default", "");
    std::fs::write(root.join("w.rxt"), "let mut x = 1;\nx + 1\n").unwrap();
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["lint", "w.rxt"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    let text = String::from_utf8(out.stderr).unwrap();
    assert!(text.contains("does not need to be mutable"), "the diagnostic must still print: {text}");
}

#[test]
fn the_flag_makes_a_warning_exit_1_and_the_message_still_prints() {
    let root = tree("warn-flag", "");
    std::fs::write(root.join("w.rxt"), "let mut x = 1;\nx + 1\n").unwrap();
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["lint", "--deny-warnings", "w.rxt"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    let text = String::from_utf8(out.stderr).unwrap();
    assert!(text.contains("does not need to be mutable"), "denying must not swallow it: {text}");
    assert!(text.contains("Warning"), "and it is still a WARNING, not relabelled an error: {text}");
}

#[test]
fn the_config_key_makes_a_warning_exit_1() {
    let root = tree("warn-config", "[lint]\ndeny-warnings = true\n");
    std::fs::write(root.join("w.rxt"), "let mut x = 1;\nx + 1\n").unwrap();
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["lint", "w.rxt"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1), "the config alone must be enough");
}

/// The case the whole flag pair exists for.
#[test]
fn the_negation_flag_beats_a_config_that_denies() {
    let root = tree("warn-negate", "[lint]\ndeny-warnings = true\n");
    std::fs::write(root.join("w.rxt"), "let mut x = 1;\nx + 1\n").unwrap();
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["lint", "--no-deny-warnings", "w.rxt"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "flag beats config, in the off direction too");
}

/// A clean file is unaffected by denial, and an error is exit 1 either way — so a passing
/// `the_flag_makes_a_warning_exit_1` cannot be an implementation that returns 1 unconditionally.
#[test]
fn denial_changes_nothing_for_a_clean_file_or_an_errored_one() {
    let root = tree("warn-bounds", "[lint]\ndeny-warnings = true\n");
    std::fs::write(root.join("clean.rxt"), "let x = 1;\nx + 1\n").unwrap();
    std::fs::write(root.join("bad.rxt"), "let x = ;\n").unwrap();
    for (file, code) in [("clean.rxt", 0), ("bad.rxt", 1)] {
        let out = Command::cargo_bin("redextape")
            .unwrap()
            .current_dir(&root)
            .args(["lint", file])
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(code), "{file} must exit {code} under denial");
    }
}
```

- [ ] **Step 7: Run them**

```bash
cargo nextest run -p redextape-cli --test config_cli
```

Expected: **9 tests run, 9 passed.**

- [ ] **Step 8: Confirm `lint.rs`'s own unit tests are untouched**

```bash
cargo nextest run -p redextape-cli lint::
```

Expected: all 7 pass, **with no edit to any of them**. `lint::run` gained no parameter, which is why
they did not have to change — verify that is actually true rather than assuming it, by checking that
`git diff crates/redextape-cli/src/lint.rs` shows only the module doc comment.

- [ ] **Step 9: Confirm which trycmd cases now fail, and leave them failing**

```bash
cargo nextest run -p redextape-cli --test cli
```

Expected: the five `*_help*` cases **FAIL** on unmatched goldens, because `--config`, `--no-config`,
`--deny-warnings` and `--no-deny-warnings` now appear in help output. Every other case passes.

**Do not regenerate the goldens here.** Task 9 owns every golden change, in one place, so a reviewer
sees all of them in one diff rather than four partial regenerations across four tasks. Record which
five failed, by name, in the task report.

- [ ] **Step 10: Lints and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src/cli.rs crates/redextape-cli/src/main.rs \
        crates/redextape-cli/src/lint.rs crates/redextape-cli/tests/config_cli.rs
git commit -m "cli: the config resolves once in main and --deny-warnings is one mapping, with Warned still a distinct variant"
```

**The commit lands with five knowingly-failing help goldens.** Say so in the commit body: Task 9
fixes them, and this is a recorded intermediate state rather than a red suite nobody mentioned.
---

### Task 7: `fmt --width`

**Files:**
- Modify: `crates/redextape-cli/src/cli.rs`
- Modify: `crates/redextape-cli/src/fmt.rs` (`run` and `one`)
- Modify: `crates/redextape-cli/src/main.rs`

**Interfaces:**
- Consumes: `redextape_core::format_with_width` (Task 4), `config::Config`.
- Produces: `fmt::run(inputs, check, width, out, err, color) -> io::Result<Outcome>`.

- [ ] **Step 1: Add the flag**

In `cli.rs`, the `Fmt` variant:

```rust
    /// Format source files in place.
    Fmt {
        /// Files to format. `-` reads standard input and writes standard output.
        #[arg(required = true)]
        paths: Vec<PathBuf>,
        /// Print a diff instead of rewriting; exit 1 if anything would change.
        #[arg(long)]
        check: bool,
        /// Line budget, overriding `fmt.width` in `redextape.toml`. A BUDGET, not a bound: binary
        /// chains, parameter lists and deep indentation can each exceed it, and do so more often the
        /// narrower it is.
        #[arg(long, value_name = "COLUMNS")]
        width: Option<usize>,
    },
```

**`Option<usize>`, not a `default_value_t`.** A default filled in by clap is indistinguishable from
an omitted flag, and that is precisely what breaks precedence — the flag must be able to say "I was
not passed" so the config value can win. `emit.rs:76`'s comment records the same lesson for
`--encoding`.

- [ ] **Step 2: Thread the width through `fmt`**

In `fmt.rs`, add the parameter to `run` and pass it to `one`:

```rust
pub fn run(
    inputs: &[Input],
    check: bool,
    width: usize,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let mut worst = Outcome::Clean;
    for input in inputs {
        worst = worst.max(one(input, check, width, out, err, color)?);
    }
    Ok(worst)
}
```

and in `one`, add `width: usize` after `check: bool` and change the format call:

```rust
    let formatted = match redextape_core::format_with_width(&src, width) {
```

- [ ] **Step 3: Resolve it in `main`**

```rust
        cli::Command::Fmt { paths, check, width } => {
            let width = width.unwrap_or(cfg.fmt.width);
            let inputs: Vec<Input> = paths.iter().map(|p| Input::from_arg(p)).collect();
            match fmt::run(&inputs, check, width, &mut out, &mut err, color) {
```

The rest of the arm is unchanged.

- [ ] **Step 4: Fix the 19 unit-test call sites**

Every `run(&[...], check, &mut out, &mut err, false)` in `fmt.rs`'s test module gains
`redextape_core::printer::MAX_WIDTH` in the new position. Find them:

```bash
grep -n 'run(&\[' crates/redextape-cli/src/fmt.rs
```

Passing the constant rather than a literal `120` is the point: these tests are about formatting
behaviour, not about the width, and a literal would be a second place the default lives.

- [ ] **Step 5: Add the width tests**

Append to `crates/redextape-cli/tests/config_cli.rs`:

```rust
/// A narrower width really does change the output, and the flag beats the config.
#[test]
fn the_width_flag_beats_the_config_and_both_beat_the_default() {
    let root = tree("width", "[fmt]\nwidth = 40\n");
    // Long enough that 40 and 120 disagree about whether it fits on one line.
    let src = "fn f(a) { a }\nf([100000, 200000, 300000, 400000, 500000, 600000, 700000])\n";
    std::fs::write(root.join("w.rxt"), src).unwrap();

    let at = |args: &[&str]| {
        let out = Command::cargo_bin("redextape")
            .unwrap()
            .current_dir(&root)
            .args(args)
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(0), "stderr: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8(out.stdout).unwrap()
    };

    let from_config = at(&["fmt", "--check", "w.rxt"]);
    let from_flag = at(&["fmt", "--check", "--width", "120", "w.rxt"]);
    let from_default = at(&["--no-config", "fmt", "--check", "w.rxt"]);

    assert_ne!(from_config, from_flag, "the flag must override the config's 40");
    assert_eq!(from_flag, from_default, "and 120 IS the default, so these two must agree");
}

/// An out-of-range width in the config refuses before any file is touched.
#[test]
fn an_out_of_range_config_width_refuses_and_names_the_bound() {
    let root = tree("width-bad", "[fmt]\nwidth = 4\n");
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["fmt", "--check", "a.rxt"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    let text = String::from_utf8(out.stderr).unwrap();
    assert!(text.contains("fmt.width"), "must name the key: {text}");
    assert!(text.contains("20"), "and the bound: {text}");
}
```

**If `from_config` and `from_flag` come out equal**, the chosen source does not straddle the two
widths. Do not delete the assertion — widen the input until it does, and record the input used. A
test that cannot tell 40 from 120 is not testing the width.

- [ ] **Step 6: Run everything for this crate**

```bash
cargo nextest run -p redextape-cli --test config_cli
cargo nextest run -p redextape-cli fmt::
```

Expected: 11 config-CLI tests pass; all 19 `fmt::` unit tests pass with their new argument.

- [ ] **Step 7: Lints and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src/cli.rs crates/redextape-cli/src/fmt.rs \
        crates/redextape-cli/src/main.rs crates/redextape-cli/tests/config_cli.rs
git commit -m "fmt: --width is Option so the config can win, and the 19 unit sites pass the constant not a literal"
```

---

### Task 8: `emit --field-width`, and the flag-presence guard

This is design §7. **Read it before writing any code in this task.**

**Files:**
- Modify: `crates/redextape-cli/src/cli.rs`
- Modify: `crates/redextape-cli/src/emit.rs` (`run`, `emit_tm`)
- Modify: `crates/redextape-cli/src/main.rs`

**Interfaces:**
- Consumes: `tm::run_tm_described_at` (Task 5), `config::Config`.
- Produces: `emit::Options`, `emit::Defaults`, and
  `emit::run(input, lang, opts: Options, dest, out, err, color)` — **seven parameters**, because
  `clippy::too_many_arguments` denies at eight and `run` already had seven.

- [ ] **Step 1: Add the flag**

In `cli.rs`, the `Emit` variant gains, after `encoding`:

```rust
        /// TM tape field width in cells, overriding `emit.field-width` in `redextape.toml`. Omitted
        /// means auto-fit, which starts narrow and widens until the values fit. `--lang tm` only:
        /// passing it with any other target is an error rather than a silent no-op.
        #[arg(long, value_name = "CELLS")]
        field_width: Option<usize>,
```

- [ ] **Step 2: Add the two option types, then apply the guard rule**

**`run` MUST NOT EXCEED SEVEN PARAMETERS.** `clippy::too_many_arguments` denies at eight — the tree
says so at `crates/redextape-core/src/lambda/syntax.rs:351` — and `run` already has seven. Adding
`field_width` and a defaults value directly would make nine and fail this plan's own Global
Constraints. The two flags and the two config defaults therefore travel as one value.

Add above `run`:

```rust
/// The `[emit]` defaults a flag may override. Two values rather than a `&Config` so this module
/// still knows nothing about the config file's shape or how it was discovered.
#[derive(Clone, Copy, Debug, Default)]
pub struct Defaults {
    pub encoding: EncodingArg,
    pub field_width: usize,
}

/// What `emit` was asked for: the flags as the user typed them, and the defaults to fall back on.
///
/// **THE FLAGS STAY `Option` AND THE DEFAULTS ARE PLAIN VALUES, AND THAT SEPARATION IS THE WHOLE
/// POINT OF THIS STRUCT.** `run`'s guard has to distinguish "the user typed `--encoding`" from "a
/// value is in effect", and merging the two before the guard is the bug design §7 is about. Keeping
/// them in different fields makes the wrong version hard to write by accident.
#[derive(Clone, Copy, Debug, Default)]
pub struct Options {
    /// `--encoding`, or `None` when it was not passed.
    pub encoding: Option<EncodingArg>,
    /// `--field-width`, or `None` when it was not passed.
    pub field_width: Option<usize>,
    /// `[emit]` from `redextape.toml`, or `Defaults::default()` under `--no-config`.
    pub defaults: Defaults,
}
```

Then replace the guard block. **Both `is_some()` checks read the FLAGS, and the defaults are merged
only afterwards.**

```rust
pub fn run(
    input: &Input,
    lang: Lang,
    opts: Options,
    dest: Option<&Path>,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    // **`Option`, NOT A `default_value_t`, AND THAT IS THE WHOLE POINT.** Once clap fills a default
    // in, an explicitly passed `--encoding unary` and an omitted flag arrive here as the same value,
    // so the guard below used to read `encoding != EncodingArg::default()` and let
    // `--lang lambda --encoding unary` through at exit 0 while the README promised a 2.
    //
    // **THE CONFIG LAYER CAN RE-ENTER THAT SAME BUG ONE LEVEL UP, AND THIS IS WHERE IT DOES NOT.**
    // Both guards test whether the FLAG was typed. A config-set value merged in before them would
    // make `emit --lang lambda` exit 2 for every user whose repository configures an encoding — a
    // config file must never make a previously-working command line fail. Design §7.
    if lang != Lang::Tm {
        if opts.encoding.is_some() {
            writeln!(err, "error: `--encoding` applies to `--lang tm` only")?;
            return Ok(Outcome::ToolFailed);
        }
        if opts.field_width.is_some() {
            writeln!(err, "error: `--field-width` applies to `--lang tm` only")?;
            return Ok(Outcome::ToolFailed);
        }
    }
    // AFTER the guard, never before. See the comment above and design §7.
    let encoding = opts.encoding.unwrap_or(opts.defaults.encoding);
    let field_width = opts.field_width.unwrap_or(opts.defaults.field_width);
```

The rest of `run`'s body is unchanged: it already reads a plain `encoding` from this point on, and
`field_width` is new only to the `emit_tm` call in Step 3.

**Check the parameter count before moving on:**

```bash
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: clean. If `too_many_arguments` fires anyway, `run` is at eight or more and something was
added that this step did not account for — fold it into `Options` rather than reaching for an
`#[allow]`. The tree's nine existing `#[allow(clippy::too_many_arguments)]` sites are all signatures
that cannot be reduced (they mirror a trait's three-address shape); this one can be, so an allow here
would be covering a choice rather than a constraint.

- [ ] **Step 3: Route the width into `emit_tm`**

Change `emit_tm`'s signature to take `field_width: usize` and pick the entry point:

```rust
fn emit_tm(
    core: &redextape_core::core::Core,
    ty: redextape_core::ty::Ty,
    encoding: EncodingArg,
    field_width: usize,
    err: &mut impl std::io::Write,
) -> std::io::Result<Option<String>> {
    // 0 is the auto-fit sentinel: the fitting search, which is what this command has always done.
    // Any other value pins the width and skips the search, which can refuse a program the search
    // would have accepted — the whole reason to ask for it.
    let described = if field_width == 0 {
        redextape_core::tm::run_tm_described(core, encoding.into(), ty, redextape_core::tm::TM_DEFAULT_CAPS)
    } else {
        redextape_core::tm::run_tm_described_at(
            core,
            encoding.into(),
            ty,
            redextape_core::tm::TM_DEFAULT_CAPS,
            field_width,
        )
    };
    match described {
        Ok(d) => emit_described(&d, encoding, err),
```

Every other arm of the existing `match` is unchanged — including the `TmRun::Overflow` handling in
`emit_described`, which is what produces the "a value does not fit" refusal on a pinned width that is
too narrow.

- [ ] **Step 4: Resolve in `main`**

```rust
        cli::Command::Emit { path, lang, encoding, field_width, out: dest } => {
            // The two flags stay `Option` here — `run`'s guard is what reads them — and the config
            // values ride alongside as `defaults` rather than being merged in. Design §7.
            let opts = emit::Options {
                encoding,
                field_width,
                defaults: emit::Defaults {
                    encoding: cfg.emit.encoding,
                    field_width: cfg.emit.field_width,
                },
            };
            let input = Input::from_arg(&path);
            match emit::run(&input, lang, opts, dest.as_deref(), &mut out, &mut err, color) {
```

- [ ] **Step 5: Write the tests — the guard case FIRST**

Append to `crates/redextape-cli/tests/config_cli.rs`:

```rust
/// **THE REGRESSION TEST FOR DESIGN §7, AND THE MOST IMPORTANT TEST IN THIS FILE.** A config that
/// sets an encoding must not make a non-`tm` emit start failing. The wrong implementation — merging
/// the config into the flag's `Option` before the guard — exits 2 here and passes every other test
/// in this file.
#[test]
fn a_configured_encoding_does_not_break_a_lambda_emit() {
    let root = tree("emit-guard", "[emit]\nencoding = \"binary\"\nfield-width = 32\n");
    std::fs::write(root.join("p.rxt"), "1 + 2\n").unwrap();
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["emit", "p.rxt", "--lang", "lambda"])
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "a config file must never make a working command line fail; stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(!String::from_utf8(out.stdout).unwrap().is_empty(), "and it must still emit the term");
}

/// The flag on a non-`tm` target is still an error — the guard must not have been loosened to make
/// the test above pass.
#[test]
fn the_flags_on_a_non_tm_target_are_still_errors() {
    let root = tree("emit-guard-flag", "");
    std::fs::write(root.join("p.rxt"), "1 + 2\n").unwrap();
    for flag in [["--encoding", "binary"], ["--field-width", "32"]] {
        let out = Command::cargo_bin("redextape")
            .unwrap()
            .current_dir(&root)
            .args(["emit", "p.rxt", "--lang", "lambda", flag[0], flag[1]])
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(2), "{} off the tm target must exit 2", flag[0]);
    }
}

/// A configured encoding IS applied on the target it belongs to.
#[test]
fn a_configured_encoding_applies_to_a_tm_emit() {
    let root = tree("emit-encoding", "[emit]\nencoding = \"binary\"\n");
    std::fs::write(root.join("p.rxt"), "1 + 2\n").unwrap();
    let with_config = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["emit", "p.rxt", "--lang", "tm"])
        .output()
        .unwrap();
    let with_defaults = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["--no-config", "emit", "p.rxt", "--lang", "tm"])
        .output()
        .unwrap();
    assert_eq!(with_config.status.code(), Some(0));
    assert_eq!(with_defaults.status.code(), Some(0));
    assert_ne!(
        with_config.stdout, with_defaults.stdout,
        "binary and unary must not produce the same machine"
    );
}

/// A pinned width too narrow for the program is refused, and auto-fit accepts the same program —
/// which is the difference the setting exists to express.
#[test]
fn a_pinned_field_width_can_refuse_what_auto_fit_accepts() {
    let root = tree("emit-fw", "");
    std::fs::write(root.join("p.rxt"), "40 + 2\n").unwrap();
    let pinned = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["emit", "p.rxt", "--lang", "tm", "--field-width", "4"])
        .output()
        .unwrap();
    assert_eq!(pinned.status.code(), Some(2), "a value that does not fit is a refusal");
    let fitted = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["emit", "p.rxt", "--lang", "tm"])
        .output()
        .unwrap();
    assert_eq!(fitted.status.code(), Some(0), "auto-fit widens and succeeds on the same program");
}
```

- [ ] **Step 6: Prove the guard test bites**

Sabotage — temporarily change `emit.rs`'s guard to merge the config first:

```rust
    let encoding = Some(opts.encoding.unwrap_or(opts.defaults.encoding));
    if lang != Lang::Tm && encoding.is_some() { /* … */ }
```

Run:

```bash
cargo nextest run -p redextape-cli a_configured_encoding_does_not_break_a_lambda_emit
```

Expected: **FAIL** with exit 2 where 0 was required. Restore the correct order and confirm it passes.
Do not commit the sabotaged version. **This is the one sabotage check in this plan that reproduces a
bug the tree has already had once**, one level down, and it is why §7 exists.

- [ ] **Step 7: Run everything**

```bash
cargo nextest run -p redextape-cli
```

Expected: every test passes **except** the five `*_help*` trycmd cases, which Task 9 fixes.

- [ ] **Step 8: Lints and commit**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
git add crates/redextape-cli/src/cli.rs crates/redextape-cli/src/emit.rs \
        crates/redextape-cli/src/main.rs crates/redextape-cli/tests/config_cli.rs
git commit -m "emit: the guard reads the flag and the config merges after it, which is emit.rs:76's own lesson one level up"
```

---

### Task 9: `trycmd` goldens and the config refusal cases

**Files:**
- Modify: the five `*_help*` goldens under `crates/redextape-cli/tests/cmd/`
- Create: `crates/redextape-cli/tests/cmd/config_unknown_key.{toml,in,stdout,stderr}`
- Create: `crates/redextape-cli/tests/cmd/config_bad_width.{toml,in,stdout,stderr}`

**Interfaces:**
- Consumes: everything from Tasks 6–8.
- Produces: a green `cargo nextest run -p redextape-cli --test cli`.

- [ ] **Step 1: Regenerate the five help goldens**

```bash
TRYCMD=overwrite cargo nextest run -p redextape-cli --test cli
```

- [ ] **Step 2: READ the diff before staging it**

```bash
git diff crates/redextape-cli/tests/cmd/
```

Expected, and check each: `--config <PATH>` and `--no-config` appear in all five; `--width <COLUMNS>`
in `fmt_help` only; `--deny-warnings` and `--no-deny-warnings` in `lint_help` only; `--field-width
<CELLS>` in `emit_help` only. **Nothing else may have moved.** `TRYCMD=overwrite` rewrites whatever
does not match, so a golden that changed for an unrelated reason would be silently accepted here —
this step is the only thing standing between that and the branch.

- [ ] **Step 3: Add the two refusal cases**

`crates/redextape-cli/tests/cmd/config_unknown_key.toml`:

```toml
bin.name = "redextape"
args = ["lint", "a.rxt"]
fs.sandbox = true
status.code = 2
```

`config_unknown_key.in/redextape.toml`:

```toml
[lint]
deny_warnings = true
```

`config_unknown_key.in/.git` — a file containing `gitdir: elsewhere`, bounding the walk so the case
cannot reach anything above its own sandbox.

`config_unknown_key.in/a.rxt`:

```
let x = 1;
x + 1
```

`config_bad_width.toml` is the same shape with `args = ["fmt", "--check", "a.rxt"]` and an `.in`
holding `[fmt]\nwidth = 4\n`.

- [ ] **Step 4: Generate the two new cases' goldens, then read them**

```bash
TRYCMD=dump cargo nextest run -p redextape-cli --test cli
```

Copy the produced `.stdout` / `.stderr` into place, then **read them**: the stderr must name the file
path and the key. If the path in the golden is an absolute sandbox path, it will not reproduce on
another machine — replace the varying prefix with `[..]`, which is `trycmd`'s own wildcard, and note
in the case's `.toml` why.

- [ ] **Step 5: Full CLI suite green**

```bash
cargo nextest run -p redextape-cli
```

Expected: all pass, 31 `trycmd` cases including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-cli/tests/cmd/
git commit -m "cli tests: five help goldens regenerated and read, plus two config-refusal cases bounded by their own .git"
```

---

### Task 10: Documentation and the roadmap entry

**Files:**
- Modify: `crates/redextape-cli/README.md:35` and the `emit` section
- Modify: `README.md:145-170`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:**
- Consumes: every measurement from Tasks 1–9.
- Produces: the entry the PR is opened against.

- [ ] **Step 1: Correct the CLI README**

`crates/redextape-cli/README.md:35` currently ends *"and there is no `--deny-warnings` yet."*
Replace that clause, add `redextape.toml` to the command summary at the top, and document the four
keys, discovery, precedence and the strict refusal. State plainly that `fmt.width` is a budget rather
than a bound and name the three constructs that exceed it.

- [ ] **Step 2: Correct the root README**

`README.md:168` says *"Still unbuilt: `--deny-warnings` and a config file."* Both are now built.
**While in this bullet, check the whole "Not built yet" section against the tree** — the survey done
while planning this slice found the visualizer bullet at `README.md:154-157` still listing
click-linking (shipped in 5b, 2026-08-09), dual-focus highlight as *blocked* (shipped in 5c plus
region-path tagging, 2026-08-10), and editable λ/TM panes with detach (shipped through 5d-iv,
2026-08-18) as missing. PR #61 corrected four other errors in this file and walked past these three.
Fix them here or file them; do not leave them unmentioned a second time.

- [ ] **Step 3: Write the roadmap entry**

Append a `#### PLAN 6'S LAST TWO KNOBS CLOSE — …` entry in the established shape: what closed, the
design and plan links, the decisions and what forced them, what was found that the design got wrong,
and a VERIFICATION block. **Each figure in that block names the command that produced it and is run
before the commit that contains it.** At minimum:

```
cargo nextest run --workspace
cargo nextest run -p redextape-cli
cargo clippy --workspace --all-targets -- -D warnings
cargo tree -p redextape-core --edges normal
scripts/check-citations.sh
scripts/check-doc-figures.sh
scripts/check-all.sh --no-llvm --no-browser
pre-commit run --all-files
```

Facts this entry must carry, because each was found rather than planned:

- **§2's "One core change" was wrong** and was amended at `af9b525` before the plan was written:
  `run_tm_described` hard-codes the fitting search and `attempt`/`lower_and_size` are private, so
  `emit.field-width` needs a second core entry point.
- **Task 1's measurement** of where `trycmd`'s sandbox runs, which the design filed as unknown.
- **The fixed-120 property test could not have caught two of the three printer sites**, which is what
  the width-parameterized test was written to fix, and the sabotage run in Task 4 Step 7 that proved
  it.
- **The guard-order sabotage in Task 8 Step 6**, reproducing `emit.rs:76`'s bug one level up.
- **The `toml` and `serde` versions `cargo add` chose** (Task 2 Step 1), quoted rather than pinned
  from memory.
- Whatever Step 2 found about the root README.

- [ ] **Step 4: Run the whole gate**

```bash
cargo nextest run --workspace
scripts/check-all.sh --no-llvm --no-browser
pre-commit run --all-files
```

**Quote `check-all.sh`'s own final line rather than calling the run green** — it reports a PARTIAL
run when tiers are skipped, and this file's convention is to repeat what a tool said rather than
summarise it.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-cli/README.md README.md docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs: the two knobs are built, the roadmap entry records what the design got wrong, and the root README was stale by three more slices"
```

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin cli-config-and-deny-warnings
```

Open the PR against `main`. **The body is one long line per paragraph, never hard-wrapped** — Forgejo
renders bodies with GFM `breaks: true`, so a hard-wrapped paragraph shows as forced line breaks. This
is the opposite of the commit-message rule used throughout this plan.

Then, per this repository's convention, read CI's result from the pull request's own `head.sha`
rather than assuming it from the branch, using the gitea MCP — `tea api get` 404s everything and
exits 0. There is no rerun endpoint; editing the PR body is what retriggers.

---

## Self-Review

**Spec coverage.** §2's five bullets → Tasks 2–8. §3's schema and bounds → Task 2. §4's discovery and
precedence → Tasks 3 and 6. §5's one branch → Task 6. §6's printer → Task 4. §7's guard → Task 8,
with Step 6 as its regression proof. §8's strict refusal → Task 2 Steps 6–7 and Task 9 Step 3.
§9's three test layers → Tasks 2/3 (unit), 4 (property), 9 (`trycmd`); §9's message assertion →
Task 6 Step 6. §10's two hazards → Task 1 and the `tree` helpers in Tasks 3 and 6. §11 and §12 need
no task.

**One spec item deliberately without a task:** §12's open question about `--config -`. It is recorded
as assumed-no and nothing depends on it.

**Type consistency, checked across tasks.** `config::Config`/`Lint`/`Fmt`/`Emit` field names are
`deny_warnings`, `width`, `encoding`, `field_width` in Tasks 2, 6, 7 and 8 alike.
`config::Source`'s three variants are spelled the same in Tasks 3 and 6. `emit::Options` and `emit::Defaults` are
introduced in Task 8 Step 2 and used in Step 4 with the same fields. `print_with_width` /
`format_with_width` are defined in Task 4 and consumed in Tasks 2 (as `MAX_WIDTH` only) and 7.
`run_tm_described_at`'s five parameters are the same in Task 5's definition and Task 8's call.

**Two places the plan tells the implementer to verify rather than trust this document**, because both
were reasoned about and not run: `redextape_core::tm::MIN_FIELD_WIDTH`'s re-export path (Task 2 Step
4) and `DescribedRun.header.width`'s accessor (Task 5 Step 2). Each names the grep that settles it.
