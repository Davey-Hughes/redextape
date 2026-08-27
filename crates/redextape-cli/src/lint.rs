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
//!
//! One bad input does not stop the others, the same reason `fmt` gives for the same shape: a
//! repo-wide invocation that aborts on the first unreadable file is useless.

use crate::input::Input;
use crate::report::render;
use redextape_core::{Diagnostic, Severity};

/// What a `lint` run found.
///
/// **VARIANT ORDER IS LOAD-BEARING**, for the same reason `fmt::Outcome`'s is: derived `Ord` on a
/// fieldless enum ranks by DECLARATION order, so `a.max(b)` is "the worse of the two" with no rank
/// table to maintain. `the_variant_order_is_the_severity_order` below pins it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Outcome {
    /// No diagnostic at all.
    Clean,
    /// At least one warning, and no error.
    Warned,
    /// At least one error-severity diagnostic.
    Errored,
    /// At least one input could not be read.
    Failed,
}

/// Check every input.
///
/// # Errors
///
/// Any `std::io::Error` from writing to `out` or `err`. A failure to read an INPUT is not an error
/// here — it is reported and folded into the returned `Outcome`, the same contract `fmt::run` keeps.
pub fn run(
    inputs: &[Input],
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    // `lint` writes diagnostics to stderr only — stdout stays clean so `redextape lint a.rxt > /dev/null`
    // still shows you the findings. The parameter is kept so both commands share one call shape.
    let _ = out;
    let mut worst = Outcome::Clean;
    for input in inputs {
        let label = input.label();
        let src = match input.read() {
            Ok(s) => s,
            Err(e) => {
                writeln!(err, "{e}")?;
                worst = worst.max(Outcome::Failed);
                continue;
            }
        };
        let ds = redextape_core::analyze(&src).diagnostics;
        render(err, &label, &src, &ds, color)?;
        worst = worst.max(outcome_for(&ds));
    }
    Ok(worst)
}

/// The `Outcome` implied by one input's diagnostics, in isolation from every other input.
///
/// `Errored` if any diagnostic is error-severity, `Clean` if there are none at all, `Warned`
/// otherwise. `redextape_core::analyze` never hands back a list mixing the two — lints run only on a
/// program with no error-severity diagnostic already, so a broken program is never also nagged about
/// an unused binding — but that is a property of the CALLER, not of this function, and this function
/// is what a wrong severity check would actually break. Checked directly against synthetic
/// diagnostics below, since `analyze` itself cannot produce the mixed case to test through.
fn outcome_for(ds: &[Diagnostic]) -> Outcome {
    if ds.iter().any(|d| d.severity == Severity::Error) {
        Outcome::Errored
    } else if ds.is_empty() {
        Outcome::Clean
    } else {
        Outcome::Warned
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::Input;

    // Carries the same pid-plus-atomic-counter idiom `fmt::tests::tmpdir` does — see
    // `redextape_test_support::ScratchDir`'s doc for why (that crate now owns the implementation both
    // this and `fmt.rs`'s helper used to duplicate) and for the panicking()-gated cleanup a value this
    // returns provides once it goes out of scope.
    fn tmpdir(name: &str) -> redextape_test_support::ScratchDir {
        redextape_test_support::ScratchDir::new(&format!("lint-{name}")).unwrap()
    }

    // Returns the guard alongside the path it governs: the caller must keep `.0` alive for as long as
    // it uses `.1`, since the directory is removed (on a passing run) the moment the guard drops.
    fn write(name: &str, src: &str) -> (redextape_test_support::ScratchDir, std::path::PathBuf) {
        let d = tmpdir(name);
        let p = d.join("a.rxt");
        std::fs::write(&p, src).unwrap();
        (d, p)
    }

    #[test]
    fn a_clean_program_reports_nothing() {
        let (_d, p) = write("clean", "let x = 1;\nx + 1");
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Clean), "got {got:?}");
        assert!(err.is_empty(), "nothing to say: {:?}", String::from_utf8_lossy(&err));
        assert!(out.is_empty(), "lint never writes to stdout: {:?}", String::from_utf8_lossy(&out));
    }

    #[test]
    fn a_warning_is_reported_but_does_not_fail_the_run() {
        let (_d, p) = write("warn", "let mut x = 1;\nx + 1");
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Warned), "a warning is not a failure: {got:?}");
        let text = String::from_utf8(err).unwrap();
        assert!(text.contains("Warning"), "got {text}");
        // Task 2's lesson: a neutered lint pass still lets a run through green if nothing checks
        // that the RIGHT diagnostic came out the other end, not merely that some text did.
        assert!(text.contains("does not need to be mutable"), "the real diagnostic must reach stderr: {text}");
        assert!(out.is_empty(), "a warning must never reach stdout: {:?}", String::from_utf8_lossy(&out));
    }

    #[test]
    fn an_error_fails_the_run() {
        let (_d, p) = write("err", "let x = ;");
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Errored), "got {got:?}");
        let text = String::from_utf8(err).unwrap();
        assert!(text.contains("Error"), "the parse error must actually be rendered: {text}");
        assert!(out.is_empty(), "an error must never reach stdout: {:?}", String::from_utf8_lossy(&out));
    }

    // M4 (borrowed from fmt.rs): a relative path resolves against the test process's cwd, which is
    // incidental and shared with every other test in the binary. An absolute path under this test's
    // own temp directory is what makes "the file really is missing" deterministic.
    #[test]
    fn a_missing_file_reports_and_does_not_panic() {
        let d = tmpdir("missing");
        let p = d.join("nope.rxt");
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&p)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "got {got:?}");
        assert!(String::from_utf8(err).unwrap().contains("nope.rxt"), "the message must name the file");
        assert!(out.is_empty());
    }

    #[test]
    fn the_variant_order_is_the_severity_order() {
        // Same reason as `fmt::Outcome`'s test of the same name: `max` is the merge rule and the
        // declaration order is what makes it right.
        assert!(Outcome::Clean < Outcome::Warned);
        assert!(Outcome::Warned < Outcome::Errored);
        assert!(Outcome::Errored < Outcome::Failed);
        assert_eq!(Outcome::Clean.max(Outcome::Errored), Outcome::Errored);
    }

    // "THE ONE THING MOST LIKELY TO BE WRONG": the three-way decision itself, pinned directly against
    // synthetic diagnostics rather than through `analyze` — `analyze` structurally never produces the
    // mixed case (lints only run when there is no error already), so routing through it could never
    // catch a wrong-order rewrite of `outcome_for`'s branches.
    #[test]
    fn a_diagnostic_list_with_both_a_warning_and_an_error_is_errored() {
        use redextape_core::Span;
        let ds = vec![
            Diagnostic::warning(Span { start: 0, end: 1 }, "a warning"),
            Diagnostic::error(Span { start: 2, end: 3 }, "an error"),
        ];
        assert_eq!(outcome_for(&ds), Outcome::Errored, "an error outranks a warning even when both are present");
    }

    #[test]
    fn a_diagnostic_list_with_only_a_warning_is_warned_not_clean() {
        use redextape_core::Span;
        let ds = vec![Diagnostic::warning(Span { start: 0, end: 1 }, "a warning")];
        assert_eq!(outcome_for(&ds), Outcome::Warned, "a non-empty, error-free list must not read as Clean");
    }

    #[test]
    fn an_empty_diagnostic_list_is_clean() {
        assert_eq!(outcome_for(&[]), Outcome::Clean);
    }

    // The worst outcome wins across a whole run, exactly like `fmt::Outcome`'s merge — pinned in both
    // orders, since a "first non-Clean wins" bug (as opposed to `.max()`) would pass one order and
    // fail the other.
    #[test]
    fn a_warning_file_and_an_errored_file_together_merge_to_errored() {
        let d = tmpdir("merge-warn-then-error");
        let warn = d.join("warn.rxt");
        let error = d.join("error.rxt");
        std::fs::write(&warn, "let mut x = 1;\nx + 1").unwrap();
        std::fs::write(&error, "let x = ;").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&warn), Input::from_arg(&error)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Errored), "the worst outcome wins: {got:?}");
        assert!(out.is_empty());
    }

    #[test]
    fn the_worst_outcome_wins_even_when_the_error_comes_first() {
        let d = tmpdir("merge-error-then-warn");
        let error = d.join("error.rxt");
        let warn = d.join("warn.rxt");
        std::fs::write(&error, "let x = ;").unwrap();
        std::fs::write(&warn, "let mut x = 1;\nx + 1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&error), Input::from_arg(&warn)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Errored), "order must not matter: {got:?}");
        assert!(out.is_empty());
    }

    // I1 (Task 6's real bug, same loop shape): a per-file read failure must not `?`-propagate out of
    // the loop and skip every input after it. The `Outcome` alone can't catch a regression here —
    // `Failed` already outranks everything else `run` could report — so the second file must leave
    // its OWN diagnostic content in `err`, proving it was actually checked rather than skipped.
    #[test]
    fn a_read_failure_on_one_file_does_not_stop_the_next() {
        let d = tmpdir("continue");
        let missing = d.join("nope.rxt");
        let good = d.join("good.rxt");
        std::fs::write(&good, "let mut y = 1;\ny + 1").unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let got = run(&[Input::from_arg(&missing), Input::from_arg(&good)], &mut out, &mut err, false).unwrap();
        assert!(matches!(got, Outcome::Failed), "a missing file outranks a mere warning: {got:?}");
        let text = String::from_utf8(err).unwrap();
        assert!(text.contains("nope.rxt"), "the read failure must name the file it could not read: {text}");
        assert!(
            text.contains("does not need to be mutable"),
            "THE FILE AFTER THE FAILING ONE MUST STILL BE CHECKED, not skipped: {text}"
        );
        assert!(out.is_empty());
    }
}
