//! `redextape fmt` — the canonical `print ∘ parse` formatter.
//!
//! Two rules this module exists to keep. **A file that does not parse is never written**, which is
//! `redextape_core::format`'s own contract and the only safe thing to do with source the printer
//! cannot round-trip. And **one bad input does not stop the others**: a repo-wide invocation that
//! aborts on the first broken file is useless, so every input is processed and the exit code reports
//! the worst outcome seen.

use crate::input::{Input, write_atomic};
use crate::report::render;

/// What a `fmt` run did.
///
/// **VARIANT ORDER IS LOAD-BEARING.** `Ord` is derived, and a derived `Ord` on a fieldless enum
/// ranks by DECLARATION order — so `a.max(b)` is exactly "the worse of the two" and there is no
/// hand-written rank table to fall out of step with the variants. Declare any new variant in
/// severity position, and see `the_variant_order_is_the_severity_order` below, which pins it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Outcome {
    /// Every input was already formatted.
    Clean,
    /// At least one file was rewritten, and nothing failed.
    Rewritten,
    /// `--check` only: at least one file would be rewritten.
    WouldChange,
    /// At least one input could not be read, or did not parse.
    Failed,
}

/// Format every input.
///
/// # Errors
///
/// Any `std::io::Error` from writing to `out` or `err`. A failure to read, write or parse an INPUT is
/// not an error here — it is reported and folded into the returned `Outcome`.
pub fn run(
    inputs: &[Input],
    check: bool,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let mut worst = Outcome::Clean;
    for input in inputs {
        worst = worst.max(one(input, check, out, err, color)?);
    }
    Ok(worst)
}

/// A unified diff from `before` to `after`, headed with the real path on both sides.
///
/// Both headers name the file the user passed, never the sibling temporary `write_atomic` uses — the
/// temporary is an implementation detail and a diff header is user-visible.
#[must_use]
pub fn diff(label: &str, before: &str, after: &str) -> String {
    let d = similar::TextDiff::from_lines(before, after);
    d.unified_diff().header(&format!("{label} (before)"), &format!("{label} (after)")).to_string()
}

fn one(
    input: &Input,
    check: bool,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let label = input.label();
    let src = match input.read() {
        Ok(s) => s,
        Err(e) => {
            writeln!(err, "{e}")?;
            return Ok(Outcome::Failed);
        }
    };
    let formatted = match redextape_core::format(&src) {
        Ok(f) => f,
        Err(ds) => {
            render(err, &label, &src, &ds, color)?;
            return Ok(Outcome::Failed);
        }
    };
    match input {
        // `--check` means the same thing on every input: print a unified diff of what would change,
        // write nothing, and say so via the returned `Outcome` — exactly what `cli::Command::Fmt`'s
        // own shipped help text for `check` promises ("Print a diff instead of rewriting; exit 1
        // if anything would change."). Stdin has no path of its own to head the diff with, but
        // `Input::label` already returns the literal `<stdin>` for it, so `diff` below produces
        // `<stdin> (before)` / `<stdin> (after)` headers for free — no special-casing needed here
        // beyond routing to `diff` instead of dumping `formatted` whole.
        Input::Stdin if check => {
            if formatted == src {
                return Ok(Outcome::Clean);
            }
            write!(out, "{}", diff(&label, &src, &formatted))?;
            Ok(Outcome::WouldChange)
        }
        // Without `--check`, stdin has nowhere to be written back to, so it always prints the
        // reformatted source whole — this is what makes `redextape fmt -` usable as a pipeline
        // filter (`fmt_stdin.rs`'s I3). This arm is untouched by the `--check` diff behaviour above:
        // plain `fmt -` must keep printing SOURCE, never a diff.
        Input::Stdin => {
            write!(out, "{formatted}")?;
            Ok(Outcome::Clean)
        }
        Input::Path(p) => {
            if formatted == src {
                return Ok(Outcome::Clean);
            }
            if check {
                write!(out, "{}", diff(&label, &src, &formatted))?;
                return Ok(Outcome::WouldChange);
            }
            // I5: resolve `p` to the real file before writing. `write_atomic` takes its path
            // literally (see its own doc) — handed a symlink, it would rename a fresh file onto the
            // LINK's own name, replacing the link with a plain file and leaving whatever it used to
            // point at unformatted and untouched. Canonicalizing here, at the one call site that
            // needs it, keeps `write_atomic` itself a simple "replace exactly this path" primitive
            // and follows any chain of symlinks down to the real file rustfmt-style tools rewrite.
            // A broken symlink cannot reach this point — `input.read()` above already follows the
            // same link to read `src`, so a missing target has already failed there as `Failed` —
            // but `canonicalize` can still race against a target removed between that read and this
            // write, and reports that the same way every other write failure below does.
            let target = match p.canonicalize() {
                Ok(t) => t,
                Err(e) => {
                    writeln!(err, "cannot write `{label}`: {e}")?;
                    return Ok(Outcome::Failed);
                }
            };
            // A failure here is the target file's problem, not `out`/`err`'s — it must be reported and
            // folded into the outcome like a read or parse failure, not propagated with `?`, or every
            // input after this one is silently skipped (that is the bug I1 exists to keep fixed).
            if let Err(e) = write_atomic(&target, &formatted) {
                writeln!(err, "cannot write `{label}`: {e}")?;
                return Ok(Outcome::Failed);
            }
            Ok(Outcome::Rewritten)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // M3: a fixed name under the system temp directory collides across concurrent runs — one run's
    // `remove_dir_all` can delete another's fixture mid-test, and a foreign-owned leftover makes
    // `create_dir_all(..).unwrap()` panic. Mixing in this process's id keeps every run's fixtures apart.
    // UNIQUE PER CALL, not merely per `name`, and the gap between those two is invisible to the gate.
    // `std::process::id()` alone is enough under nextest, which runs every test in its own process —
    // but `cargo test` runs them as threads in ONE process, so two tests passing the same `name` got
    // the SAME directory, and this function's own `remove_dir_all` then deleted one test's fixture out
    // from under the other while it was running. Not hypothetical: the two `--check`-on-a-clean-file
    // tests below both asked for "check-clean" and failed 4 of 15 `cargo test -p redextape-cli` runs,
    // while every `cargo nextest` run stayed green — so the gate could not see it and never will. The
    // counter makes a repeated label harmless rather than relying on nobody ever repeating one, which
    // is the property that survives the next test being added by copying an existing one.
    fn tmpdir(name: &str) -> std::path::PathBuf {
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("redextape-fmt-{name}-{}-{seq}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_file_that_needs_formatting_is_rewritten_in_place() {
        let d = tmpdir("rewrite");
        let p = d.join("a.rxt");
        std::fs::write(&p, "let   x=1;\nx+1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Rewritten), "got {got:?}");
        let after = std::fs::read_to_string(&p).unwrap();
        assert_eq!(after, redextape_core::format("let   x=1;\nx+1").unwrap());
        // I3: nothing stops the path arm from also dumping the formatted text to stdout, which would
        // make a repo-wide `fmt` unusable (and would silently double as a `cat` of every file touched).
        assert!(out.is_empty(), "formatting a path in place must not print to stdout: {out:?}");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn formatting_twice_changes_nothing_the_second_time() {
        let d = tmpdir("idempotent");
        let p = d.join("a.rxt");
        std::fs::write(&p, "let   x=1;\nx+1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        let once = std::fs::read_to_string(&p).unwrap();
        out.clear();
        let got = run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Clean), "the second run has nothing to do: {got:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), once);
        assert!(out.is_empty(), "a clean path input must not print to stdout: {out:?}");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn a_file_that_does_not_parse_is_left_exactly_as_it_was() {
        let d = tmpdir("broken");
        let p = d.join("bad.rxt");
        let original = "let x = ;";
        std::fs::write(&p, original).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "got {got:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), original, "THE FILE MUST NOT BE TOUCHED");
        // M2: `!err.is_empty()` also passes for a one-byte stderr; require the message name the file,
        // the way the missing-file diagnostic below already is required to.
        assert!(String::from_utf8(err).unwrap().contains("bad.rxt"), "the diagnostic must name the file");
        assert!(out.is_empty());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn one_bad_file_does_not_stop_the_others_and_the_worst_outcome_wins() {
        let d = tmpdir("multi");
        let bad = d.join("bad.rxt");
        let good = d.join("good.rxt");
        std::fs::write(&bad, "let x = ;").unwrap();
        std::fs::write(&good, "let   y=2;\ny+1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&bad), Input::from_arg(&good)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "the worst outcome wins: {got:?}");
        assert_eq!(std::fs::read_to_string(&good).unwrap(), redextape_core::format("let   y=2;\ny+1").unwrap());
        std::fs::remove_dir_all(&d).ok();
    }

    // M1: the case above only pins that an earlier worse outcome is not overwritten by a later better
    // one. The converse — a later worse outcome must not be shadowed by an earlier better one — needs
    // its own case, or "first non-`Clean` wins" would pass everything above too.
    #[test]
    fn the_worst_outcome_wins_even_when_the_bad_file_comes_second() {
        let d = tmpdir("multi-reversed");
        let good = d.join("good.rxt");
        let bad = d.join("bad.rxt");
        std::fs::write(&good, "let   y=2;\ny+1").unwrap();
        std::fs::write(&bad, "let x = ;").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&good), Input::from_arg(&bad)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "the worst outcome wins regardless of order: {got:?}");
        assert_eq!(std::fs::read_to_string(&good).unwrap(), redextape_core::format("let   y=2;\ny+1").unwrap());
        std::fs::remove_dir_all(&d).ok();
    }

    // I1 (the real bug): a write failure on one target must not abort the loop and skip every input
    // after it, the same way a read failure already does not. Lock the directory containing the first
    // file so `write_atomic`'s temporary cannot be created there, then confirm the second file — which
    // comes after it in the input list — is still formatted, and that the failure message names the
    // file that could not be written.
    //
    // NOT a `0o500` directory: that was this test's original mechanism, and CI runs as root
    // (`catthehacker/ubuntu:act-latest`). `CAP_DAC_OVERRIDE` makes root exempt from directory
    // permission checks, so as root the write SUCCEEDS, the outcome comes back `Rewritten`, and the
    // test fails — not because the product is wrong, but because the mechanism stopped inducing the
    // failure it exists to test. Reaching for `0o500` again is the obvious next move for a future
    // reader hitting the same "make a write fail" problem; it produces exactly the silently-vacuous
    // test this branch's roadmap entry spent eleven mutations learning to distrust — a run as any
    // non-root uid would still pass, and never expose that the assertion is no longer live under root.
    //
    // Instead, plant something at the exact path `write_atomic` will use for its sibling temporary —
    // `<file name>.redextape-tmp.<pid>`, per that function's own doc, and computable in advance from
    // inside this same test process, the same trick `input.rs`'s
    // `write_atomic_refuses_to_follow_a_symlink_planted_at_the_temp_path` already relies on. Its
    // `create_new` open then fails with `AlreadyExists`: an existence check, not a permission check,
    // so root is not exempt from it either.
    #[test]
    fn a_write_failure_on_one_file_does_not_stop_the_others() {
        let d = tmpdir("write-fails");
        let unwritable = d.join("a.rxt");
        std::fs::write(&unwritable, "let   x=1;\nx+1").unwrap();
        let blocked_tmp = d.join(format!("a.rxt.redextape-tmp.{}", std::process::id()));
        std::fs::create_dir_all(&blocked_tmp).unwrap();
        let good = d.join("good.rxt");
        std::fs::write(&good, "let   y=2;\ny+1").unwrap();

        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got =
            run(&[Input::from_arg(&unwritable), Input::from_arg(&good)], false, &mut out, &mut err, false).unwrap();

        assert!(matches!(got, Outcome::Failed), "got {got:?}");
        let err = String::from_utf8(err).unwrap();
        assert!(err.contains("a.rxt"), "the write-failure message must name the file it failed to write: {err}");
        // "cannot write", not "cannot read": confirms the READ of `unwritable` succeeded (it is an
        // ordinary file) and it was the WRITE that failed. Were the target unreadable instead — a
        // directory, say — `run` would still return `Failed` and still name the file, and this test
        // would pass for the wrong reason: the one bug I1 exists to catch (a write failure aborting
        // the loop) would go uncovered.
        assert!(err.contains("cannot write"), "must be a write failure, not a read failure: {err}");
        assert_eq!(
            std::fs::read_to_string(&good).unwrap(),
            redextape_core::format("let   y=2;\ny+1").unwrap(),
            "THE INPUT AFTER THE FAILING ONE MUST STILL BE FORMATTED"
        );
        std::fs::remove_dir_all(&d).ok();
    }

    // I2: nothing pins that `fmt` calls `write_atomic` rather than some plain `std::fs::write` — every
    // test above is satisfied by either (a plain write to an EXISTING path truncates the same inode in
    // place, so even permission bits survive it unchanged; only a rename swaps the inode). Pin the
    // mechanism itself: `write_atomic` replaces the directory entry via rename, so the inode after
    // formatting must differ from the inode before it.
    #[cfg(unix)]
    #[test]
    fn fmt_writes_through_write_atomic_rather_than_truncating_in_place() {
        use std::os::unix::fs::MetadataExt;

        let d = tmpdir("inode");
        let p = d.join("a.rxt");
        std::fs::write(&p, "let   x=1;\nx+1").unwrap();
        let before = std::fs::metadata(&p).unwrap().ino();

        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Rewritten), "got {got:?}");

        let after = std::fs::metadata(&p).unwrap().ino();
        assert_ne!(before, after, "fmt must write through write_atomic (rename), not truncate the file in place");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), redextape_core::format("let   x=1;\nx+1").unwrap());
        std::fs::remove_dir_all(&d).ok();
    }

    // I5: formatting a symlinked source must rewrite the REAL file and leave the link standing, not
    // replace the link with a plain file (which is what a `write_atomic` call given the link's own
    // path, unresolved, would do — see `fmt::one`'s own comment on the `canonicalize` call this pins).
    #[cfg(unix)]
    #[test]
    fn a_symlink_is_left_a_symlink_and_the_real_file_it_points_at_is_formatted() {
        let d = tmpdir("symlink-same-dir");
        let real = d.join("real.rxt");
        std::fs::write(&real, "let   x=1;\nx+1").unwrap();
        let link = d.join("link.rxt");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&link)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Rewritten), "got {got:?} (stderr: {})", String::from_utf8_lossy(&err));

        assert!(
            std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink(),
            "the link must survive AS A LINK, not be replaced by a plain file"
        );
        assert_eq!(std::fs::read_link(&link).unwrap(), real, "the link must still point at the same real path");
        let formatted = redextape_core::format("let   x=1;\nx+1").unwrap();
        assert_eq!(std::fs::read_to_string(&real).unwrap(), formatted, "the REAL file must be the one rewritten");
        assert_eq!(std::fs::read_to_string(&link).unwrap(), formatted, "reading through the link sees the same text");
        std::fs::remove_dir_all(&d).ok();
    }

    // The real file need not share the link's directory — canonicalizing must resolve to wherever the
    // link actually points, not assume it is a sibling.
    #[cfg(unix)]
    #[test]
    fn a_symlink_to_a_file_in_another_directory_still_formats_the_real_file() {
        let d = tmpdir("symlink-cross-dir");
        let real_dir = d.join("elsewhere");
        std::fs::create_dir_all(&real_dir).unwrap();
        let real = real_dir.join("real.rxt");
        std::fs::write(&real, "let   x=1;\nx+1").unwrap();
        let link_dir = d.join("here");
        std::fs::create_dir_all(&link_dir).unwrap();
        let link = link_dir.join("link.rxt");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&link)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Rewritten), "got {got:?} (stderr: {})", String::from_utf8_lossy(&err));

        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink(), "the link must survive");
        let formatted = redextape_core::format("let   x=1;\nx+1").unwrap();
        assert_eq!(std::fs::read_to_string(&real).unwrap(), formatted, "the file in the OTHER directory is rewritten");
        // Nothing must have been created in the link's own directory besides the link itself.
        let entries: Vec<_> = std::fs::read_dir(&link_dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("link.rxt")], "no stray file beside the link: {entries:?}");
        std::fs::remove_dir_all(&d).ok();
    }

    // A chain of links must resolve all the way down, not just one hop.
    #[cfg(unix)]
    #[test]
    fn a_chain_of_symlinks_resolves_to_the_real_file_at_the_end() {
        let d = tmpdir("symlink-chain");
        let real = d.join("real.rxt");
        std::fs::write(&real, "let   x=1;\nx+1").unwrap();
        let middle = d.join("middle.rxt");
        std::os::unix::fs::symlink(&real, &middle).unwrap();
        let link = d.join("link.rxt");
        std::os::unix::fs::symlink(&middle, &link).unwrap();

        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&link)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Rewritten), "got {got:?} (stderr: {})", String::from_utf8_lossy(&err));

        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink(), "the outer link must survive");
        assert!(std::fs::symlink_metadata(&middle).unwrap().file_type().is_symlink(), "the middle link must survive");
        let formatted = redextape_core::format("let   x=1;\nx+1").unwrap();
        assert_eq!(std::fs::read_to_string(&real).unwrap(), formatted, "the file at the end of the chain is rewritten");
        std::fs::remove_dir_all(&d).ok();
    }

    // A symlink pointing at nothing must be a clean `Failed`, not a panic — and in fact never reaches
    // the new `canonicalize` call at all: `input.read()` follows the same broken link first and fails
    // there, exactly like a missing plain path does.
    #[cfg(unix)]
    #[test]
    fn a_broken_symlink_is_a_clean_failure_not_a_panic() {
        let d = tmpdir("symlink-broken");
        let nowhere = d.join("does-not-exist.rxt");
        let link = d.join("link.rxt");
        std::os::unix::fs::symlink(&nowhere, &link).unwrap();

        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&link)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "got {got:?}");
        assert!(String::from_utf8(err).unwrap().contains("link.rxt"), "the failure must name the link the user passed");
        assert!(out.is_empty());
        std::fs::remove_dir_all(&d).ok();
    }

    // C1: `--check` had zero coverage — every existing test above passes `check = false`. These three
    // pin the file-input half of I4/C1; `fmt_stdin.rs` (an integration test, since `Input::Stdin` reads
    // the real process stdin) covers the stdin half.
    //
    // This test predates the unified diff (see `check_on_a_dirty_file_prints_a_diff_and_leaves_the_file_alone`
    // below, which now owns `out`'s content). What stays pinned HERE, and must never regress back to
    // false, is disk: `--check` writes nothing to the file no matter what it prints.
    #[test]
    fn check_reports_would_change_and_writes_nothing() {
        let d = tmpdir("check-dirty-disk");
        let p = d.join("a.rxt");
        let original = "let   x=1;\nx+1";
        std::fs::write(&p, original).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], true, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::WouldChange), "got {got:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), original, "--check must never write the file");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn check_reports_clean_when_the_file_is_already_formatted() {
        let d = tmpdir("check-clean");
        let p = d.join("a.rxt");
        let formatted = redextape_core::format("let   x=1;\nx+1").unwrap();
        std::fs::write(&p, &formatted).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], true, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Clean), "got {got:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), formatted);
        assert!(out.is_empty());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn check_does_not_change_the_worst_outcome_merge() {
        let d = tmpdir("check-multi");
        let would_change = d.join("a.rxt");
        let bad = d.join("bad.rxt");
        std::fs::write(&would_change, "let   x=1;\nx+1").unwrap();
        std::fs::write(&bad, "let x = ;").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got =
            run(&[Input::from_arg(&would_change), Input::from_arg(&bad)], true, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "Failed still outranks WouldChange: {got:?}");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn check_on_a_clean_file_says_nothing_and_writes_nothing() {
        let d = tmpdir("check-clean");
        let p = d.join("a.rxt");
        let clean = redextape_core::format("let x = 1;\nx + 1").unwrap();
        std::fs::write(&p, &clean).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], true, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Clean), "got {got:?}");
        assert!(out.is_empty() && err.is_empty(), "a clean --check is silent");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn check_on_a_dirty_file_prints_a_diff_and_leaves_the_file_alone() {
        let d = tmpdir("check-dirty");
        let p = d.join("a.rxt");
        let original = "let   x=1;\nx+1";
        std::fs::write(&p, original).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], true, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::WouldChange), "got {got:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), original, "--check writes NOTHING");
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains("--- "), "a unified diff has a before header: {text}");
        assert!(text.contains("+++ "), "and an after header: {text}");
        assert!(text.contains(&format!("{}", p.display())), "both headers name the real path: {text}");
        // F2: headers alone tell you a file WOULD change, not WHAT would change — a stub `diff` that
        // emits only the two header lines above satisfied every assertion in this test before this
        // one was added. Require an actual hunk, and the specific before/after line content in it, so
        // that stub fails here.
        assert!(text.contains("@@"), "a unified diff has a hunk header: {text}");
        assert!(text.contains("-let   x=1;"), "the diff must show the original line being removed: {text}");
        assert!(text.contains("+let x = 1;"), "the diff must show the formatted line being added: {text}");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn the_diff_names_the_real_path_and_never_the_temporary() {
        let d = tmpdir("check-names");
        let p = d.join("a.rxt");
        std::fs::write(&p, "let   x=1;\nx+1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        run(&[Input::from_arg(&p)], true, &mut out, &mut err, false).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(!text.contains(".redextape-tmp"), "the temporary file is an implementation detail: {text}");
        std::fs::remove_dir_all(&d).ok();
    }

    // M4: a relative path resolves against the test process's cwd, which is incidental and shared with
    // every other test. Use an absolute path under this test's own temp directory instead.
    #[test]
    fn a_missing_file_reports_and_does_not_panic() {
        let d = tmpdir("missing");
        let p = d.join("nope.rxt");
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], false, &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed));
        assert!(String::from_utf8(err).unwrap().contains("nope.rxt"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn the_variant_order_is_the_severity_order() {
        // `max` IS the merge rule, and it is correct only while the variants are declared worst-last.
        // Reordering the enum would silently invert every multi-file exit code, so it is pinned here
        // rather than left to the derive.
        assert!(Outcome::Clean < Outcome::Rewritten);
        assert!(Outcome::Rewritten < Outcome::WouldChange);
        assert!(Outcome::WouldChange < Outcome::Failed);
        assert_eq!(Outcome::Clean.max(Outcome::Failed), Outcome::Failed);
    }
}
