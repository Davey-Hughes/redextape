//! The binary exists, is named `redextape`, and reports the workspace version.

use assert_cmd::Command;

#[test]
fn the_binary_is_named_redextape_and_reports_a_version() {
    let out = Command::cargo_bin("redextape").unwrap().arg("--version").output().unwrap();
    assert!(out.status.success(), "--version must exit 0");
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.starts_with("redextape "), "expected `redextape <version>`, got {text:?}");
}

#[test]
fn a_subcommand_is_required() {
    let out = Command::cargo_bin("redextape").unwrap().output().unwrap();
    assert_eq!(out.status.code(), Some(2), "clap reports a missing subcommand as exit 2");
}
