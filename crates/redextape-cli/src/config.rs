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
//!
//! **NOTHING HERE CARRIES A `dead_code` ALLOW, AND ONE CALL IN `main` IS WHAT KEEPS IT SO.**
//! `main.rs`'s dispatch calls `config::load` with a `Source` built from real CLI flags; from that
//! root `load` reaches `discover` and `parse`, `parse` reaches `validate`, and each reads the
//! constant and constructs the `Error` its own refusal needs. If a change ever makes one of these
//! unreachable from production code again, restore its allow with a reason naming what still calls
//! it only under `#[cfg(test)]` — measured at that time, not copied from here.
//!
//! **AND CLEAR SUCH ALLOWS FROM THE OUTSIDE IN, BECAUSE SHIELDING RUNS CALLER → CALLEE.** rustc
//! treats an item carrying `#[allow(dead_code)]` as a synthetic reachability root, so everything its
//! body reaches stops being reported while the allow stands — transitively, not one hop. Probed
//! directly with `rustc -D warnings` over three uncalled shapes: an allowed CALLER silences its
//! callee, and its callee's callee; an allowed CALLEE silences nothing above it, its caller still
//! reported. Read that against this module's own call graph and the outermost item is `load`: its
//! allow shielded `discover` and `parse`, and through `parse` everything `parse` reaches. `parse`'s
//! own allow reached only its subtree — `validate`, the range constant, and the two `Error` variants
//! those two construct — and never `load` above it. Removing the innermost first buys silence and
//! reads like progress.
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
        return Err(invalid(format!("`emit.field-width` must be 0 (auto-fit) or in {lo}..={hi}, got {fw}")));
    }

    Ok(())
}

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
    let text = std::fs::read_to_string(&path).map_err(|source| Error::Read { path: path.clone(), source })?;
    parse(&text, &path)
}

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

    /// A hermetic tree root for one discovery test.
    ///
    /// **EVERY DISCOVERY TEST PLANTS A `.git` MARKER AT ITS OWN ROOT, AND THAT IS NOT DECORATION.**
    /// `/tmp` on the development machine is a shared RAM tmpfs that parallel jobs write to, and an
    /// unbounded walk from a temp directory reaches `/tmp` itself, where another job's stray
    /// `redextape.toml` would satisfy it. The marker bounds the walk, makes the test hermetic, and
    /// exercises the `.git` stop rule in the same breath.
    ///
    /// Built on `redextape_test_support::ScratchDir` for the uniqueness and panicking()-gated cleanup
    /// its own doc explains — the reason `fmt::tests::tmpdir` and `lint::tests::tmpdir` used to give
    /// individually before they and this helper all deferred to that one implementation.
    fn tree(name: &str) -> redextape_test_support::ScratchDir {
        let root = redextape_test_support::ScratchDir::new(&format!("config-{name}")).unwrap();
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
        // One level deeper than `tree()`'s usual shape, and that is load-bearing: testing the stop
        // requires a config ABOVE the marker, so if `parent` itself is not private too, `outside`
        // below is the fixed global path `/tmp/redextape.toml` — shared with every concurrent process
        // on this machine, including any `trycmd` sandbox, measured one hop under `/tmp` with no
        // `.git` of its own, once `main.rs` wires discovery.
        //
        // Asserting AFTER the guard is constructed (rather than removing `parent` by hand right
        // before the assertion, as an earlier version of this test did) means a failure here leaves
        // `parent` on disk for inspection, the same as every other fixture in this module now does.
        let parent = redextape_test_support::ScratchDir::new("config-stop").unwrap();
        let root = parent.join("root");
        std::fs::create_dir_all(root.join("a/b/c")).unwrap();
        std::fs::write(root.join(".git"), "gitdir: elsewhere\n").unwrap();
        let outside = parent.join(FILE_NAME);
        std::fs::write(&outside, "[fmt]\nwidth = 90\n").unwrap();
        let got = discover(&root.join("a/b/c"));
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
}
