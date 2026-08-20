//! `fmt`'s stdin contract, exercised through the real binary because `Input::Stdin` reads the
//! process's actual standard input — there is no seam for feeding it fake bytes from a unit test.
//!
//! Two things are pinned here. **I3**: plain `fmt -` (no `--check`) must print the formatted text
//! whole — this is what makes it usable as a pipeline filter. **F1**: `--check -` must print a
//! unified diff and write nothing, exactly like `--check` on a path, matching `cli::Command::Fmt`'s
//! own shipped help text for `check` ("Print a diff instead of rewriting; exit 1 if anything would
//! change.") — and print nothing at all when stdin is already clean. (An earlier version of this
//! file claimed rustfmt/black/prettier/gofmt all dump the reformatted file under `--check`; that
//! claim was checked and is false — rustfmt prints a diff, black prints nothing and reports only via
//! the exit code, prettier prints a filename token. None of them dumps reformatted source, so there
//! was never a real precedent for `--check -` doing so here either.)

use assert_cmd::Command;

const UNFORMATTED: &str = "let   x=1;\nx+1";

#[test]
fn stdin_prints_the_formatted_text_and_exits_zero() {
    let out = Command::cargo_bin("redextape").unwrap().args(["fmt", "-"]).write_stdin(UNFORMATTED).output().unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(String::from_utf8(out.stdout).unwrap(), redextape_core::format(UNFORMATTED).unwrap());
}

#[test]
fn check_on_stdin_prints_a_diff_and_exits_one_when_it_would_change() {
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .args(["fmt", "--check", "-"])
        .write_stdin(UNFORMATTED)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.contains("<stdin> (before)"), "the before header must name stdin: {text}");
    assert!(text.contains("<stdin> (after)"), "the after header must name stdin: {text}");
    // F2: header lines alone tell you stdin would change, not what would change — a stub `diff` that
    // emits only the two header lines above satisfied a headers-only version of this assertion set.
    // Require an actual hunk, and the specific before/after line content in it, so that stub fails.
    assert!(text.contains("@@"), "a unified diff has a hunk header: {text}");
    assert!(text.contains("-let   x=1;"), "the diff must show the original line being removed: {text}");
    assert!(text.contains("+let x = 1;"), "the diff must show the formatted line being added: {text}");
}

#[test]
fn check_on_stdin_prints_nothing_and_exits_zero_when_the_input_is_already_clean() {
    let formatted = redextape_core::format(UNFORMATTED).unwrap();
    let out =
        Command::cargo_bin("redextape").unwrap().args(["fmt", "--check", "-"]).write_stdin(formatted).output().unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    assert!(out.stdout.is_empty(), "an already-clean --check must print nothing: {:?}", out.stdout);
}
