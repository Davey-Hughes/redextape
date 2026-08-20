//! End-to-end transcripts: argv in, stdout/stderr/exit-code out.
//!
//! The unit tests in each command module call `run` directly with a buffer. These run the real
//! binary, which is the only place `main`'s exit-code mapping and `clap`'s own errors are exercised.
//!
//! **The `/` in `fmt_check_dirty.stdout`'s "no newline" trailer is not a redextape defect and not
//! literally what the binary prints.** The real binary's diff output ends that line with a
//! backslash — `\ No newline at end of file`, which is `similar`'s own unified-diff format — never a
//! forward slash. The `/` in the checked-in golden comes from `trycmd`'s dependency `snapbox`: its
//! `FilterPaths` filter unconditionally rewrites every literal `\` byte to `/` (intended for
//! Windows path-separator normalization, applied with no context check to every captured stream).
//! That filter runs on BOTH the live captured output and the loaded golden file before they are
//! compared, so the comparison stays self-consistent and the test remains valid — but it means this
//! golden does not literally match what a real terminal shows. `trycmd::TestCases`'s public API has
//! no setting to disable it. Do not "fix" the binary to emit `/`; there is nothing here to fix.
//!
//! NO file-level `allow` here: `clippy.toml`'s in-tests exemption already covers a `#[test]` fn in an
//! integration target. If a free helper is added to this file and clippy then fails, add the narrowest
//! allow that fixes it — and confirm it is load-bearing by deleting it and re-running.

#[test]
fn cli_transcripts() {
    trycmd::TestCases::new().default_bin_name("redextape").case("tests/cmd/*.toml");
}
