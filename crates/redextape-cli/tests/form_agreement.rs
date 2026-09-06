//! One classification, two commands, and a specified outcome for every cell.
//!
//! The structural half of this property is in the source: both `run` and `fmt` match exhaustively
//! on `Form` with no `_` arm, so a fourth form breaks both at compile time. This file is the other
//! half — that the two commands agree on WHAT a file is, while doing different things with it.
//!
//! **THE PROPERTY PINNED HERE IS NARROWER THAN "THEY BEHAVE THE SAME," AND THAT IS THE POINT.**
//! `run` refuses `--backend` on an artifact because a `.tm`/`.asm` file is already a machine or a
//! program with no backend to pick; `fmt` formats an artifact and refuses an explicit `--width` on
//! one because those two printers lay out from their own content. A test asserting the two commands
//! behave identically would be asserting something false — it would either fail immediately or, far
//! worse, get weakened until it asserted nothing. What is worth pinning instead: one shared answer
//! to "WHICH FORM is this", read through two different observable refusals.
//!
//! **THE FORM, NOT A BOOLEAN, AND THE DIFFERENCE IS WHAT THIS FILE IS FOR.** An earlier version
//! collapsed the table's second column to `*expected != "rxt"` before comparing, which made
//! `("p.asm", "asm")` and `("p.asm", "tm")` the same test: a defect mapping `.asm` onto `Form::Tm`
//! left every row green, because both forms are equally "an artifact". Both commands print a noun
//! that names the form outright — `run` says "a `.tm` file, which is already a machine" against "a
//! `.asm` file, which is already a program", `fmt` says "a `.tm` file, …" against "an `.asm` file,
//! …" — so the form is observable, and the column is compared against it rather than against a
//! boolean derived from it.
//!
//! Neither command prints its classification, so each helper below reads it out of a refusal.
//! `run_classifies` passes `--backend lambda` and parses the noun in the "`--backend` does not
//! apply" message `run.rs` prints; `fmt_classifies` passes `--width 40` and parses the noun in the
//! "`--width` does not apply" message `fmt.rs` prints. Both checks fire from the extension alone,
//! before either command parses a byte of the file — `run.rs`'s `form.is_artifact()` guard and
//! `fmt.rs`'s `explicit_width.is_some() && form.is_artifact()` guard both run ahead of any parsing,
//! and neither command consults a path's content — so the scratch files below are written empty;
//! the content is not part of the property under test.
#![allow(clippy::unwrap_used)]

use assert_cmd::Command;

/// The classification both commands must agree on. One table, read twice. The second column names
/// the FORM, and `"rxt"` is the one value that fires no refusal at all.
const CLASSIFICATION: &[(&str, &str)] =
    &[("p.tm", "tm"), ("M.TM", "tm"), ("p.asm", "asm"), ("P.AsM", "asm"), ("p.rxt", "rxt"), ("p.txt", "rxt")];

/// The form a refusal message names, or `None` when `refusal` never appears — which is how both
/// commands report `.rxt`: by not refusing.
///
/// The noun's first backtick-quoted token is the extension, and `refusal` is matched first so the
/// backticks around the flag's own name are behind us. An extension no form claims comes back as
/// itself rather than as a panic, so the assertion that compares it names what it found.
fn form_named_by(stderr: &str, refusal: &str) -> Option<String> {
    let noun = stderr.split_once(refusal)?.1;
    let extension = noun.split_once('`')?.1.split_once('`')?.0;
    Some(extension.trim_start_matches('.').to_string())
}

/// Which form `redextape run <filename> --backend lambda` says `filename` is — read off the
/// refusal, and `None` when it accepts the flag.
fn run_classifies(filename: &str) -> Option<String> {
    let dir = redextape_test_support::ScratchDir::new(&format!("form-agreement-run-{filename}")).unwrap();
    let path = dir.join(filename);
    std::fs::write(&path, "").unwrap();
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .args(["run", path.to_str().unwrap(), "--backend", "lambda"])
        .output()
        .unwrap();
    form_named_by(&String::from_utf8_lossy(&out.stderr), "`--backend` does not apply")
}

/// Which form `redextape fmt <filename> --width 40` says `filename` is — read off the refusal, and
/// `None` when it accepts the flag.
fn fmt_classifies(filename: &str) -> Option<String> {
    let dir = redextape_test_support::ScratchDir::new(&format!("form-agreement-fmt-{filename}")).unwrap();
    let path = dir.join(filename);
    std::fs::write(&path, "").unwrap();
    let out = Command::cargo_bin("redextape")
        .unwrap()
        .args(["fmt", path.to_str().unwrap(), "--width", "40"])
        .output()
        .unwrap();
    form_named_by(&String::from_utf8_lossy(&out.stderr), "`--width` does not apply")
}

#[test]
fn run_and_fmt_classify_every_filename_the_same_way() {
    // `run` reveals its classification by refusing `--backend` on an artifact and accepting it
    // otherwise; `fmt` reveals its by refusing an explicit `--width` on an artifact. Two different
    // observable behaviours over one shared answer — which is exactly the property worth pinning,
    // since asserting the behaviours matched would be asserting something false.
    for (filename, expected) in CLASSIFICATION {
        let expected: Option<String> = match *expected {
            // The source form is the absence of a refusal: there is no noun to name it.
            "rxt" => None,
            form => Some(form.to_string()),
        };
        assert_eq!(run_classifies(filename), expected, "run, {filename}");
        assert_eq!(fmt_classifies(filename), expected, "fmt, {filename}");
    }
}
