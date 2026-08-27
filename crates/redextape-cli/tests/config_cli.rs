//! `--config`, `--no-config` and `--deny-warnings`, driven through the real binary.
//!
//! `#![allow(clippy::unwrap_used)]` at file level rather than per test: a `tests/` target is neither
//! a `#[test]` function's body nor a bare `#[cfg(test)]` module, so `clippy.toml`'s three
//! in-tests exemptions do not reach a free helper here. `clippy.toml` says so directly.
#![allow(clippy::unwrap_used)]

use assert_cmd::Command;

/// A directory holding one config file, bounded by a `.git` marker so discovery cannot climb out of
/// it into a shared `/tmp` another job is writing to.
///
/// Built on `redextape_test_support::ScratchDir`, which removes this directory once it goes out of
/// scope in the caller — but only when the calling test passed; see that type's own doc.
fn tree(name: &str, config: &str) -> redextape_test_support::ScratchDir {
    let root = redextape_test_support::ScratchDir::new(&format!("cfgcli-{name}")).unwrap();
    std::fs::write(root.join(".git"), "gitdir: elsewhere\n").unwrap();
    std::fs::write(root.join("redextape.toml"), config).unwrap();
    std::fs::write(root.join("a.rxt"), "let x = 1;\nx + 1\n").unwrap();
    root
}

#[test]
fn a_malformed_config_refuses_at_exit_2_and_names_the_file() {
    let root = tree("malformed", "[lint]\ndeny_warnings = true\n");
    let out = Command::cargo_bin("redextape").unwrap().current_dir(&root).args(["lint", "a.rxt"]).output().unwrap();
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
    let out = Command::cargo_bin("redextape").unwrap().current_dir(&root).args(["lint", "w.rxt"]).output().unwrap();
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
    let out = Command::cargo_bin("redextape").unwrap().current_dir(&root).args(["lint", "w.rxt"]).output().unwrap();
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
        let out = Command::cargo_bin("redextape").unwrap().current_dir(&root).args(["lint", file]).output().unwrap();
        assert_eq!(out.status.code(), Some(code), "{file} must exit {code} under denial");
    }
}

/// A narrower width really does change the output, and the flag beats the config.
///
/// **THE SOURCE IS ALREADY `w.rxt`'s OWN WIDTH-120 CANONICAL FORM**, not the brief's literal
/// `"fn f(a) { a }\n..."` one-liner — that fixture never reaches `--check` exit 0 at ANY width,
/// because `printer::braced` always breaks a function body onto its own lines regardless of the
/// budget (see `printer.rs`'s own comment on `braced`: "A block ALWAYS breaks"), so
/// `fn f(a) { a }` differs from its canonical form no matter what `width` is. Writing the fixture
/// pre-broken removes that width-independent noise, so the ONLY difference between widths is the
/// call's argument list — confirmed directly: `format_with_width(SRC, 120) == SRC` (clean) and
/// `format_with_width(SRC, 40)` wraps the list onto its own lines (dirty). See the task report for
/// both outputs side by side.
const SRC: &str = "fn f(a) {\n    a\n}\nf([100000, 200000, 300000, 400000, 500000, 600000, 700000])\n";

#[test]
fn the_width_flag_beats_the_config_and_both_beat_the_default() {
    let root = tree("width", "[fmt]\nwidth = 40\n");
    std::fs::write(root.join("w.rxt"), SRC).unwrap();

    // **THE EXPECTED EXIT CODE IS PASSED IN PER CALL, NOT ACCEPTED AS A SET, AND THAT IS THE WHOLE
    // POINT OF THIS HELPER'S SHAPE.** An earlier draft asserted `Some(0)` on every invocation, which
    // cannot hold: `fmt --check` returns `Clean` — and exits 0 — BEFORE writing anything to stdout,
    // so demanding 0 from both widths forces both diffs empty, contradicting the `assert_ne!` below
    // that this test exists for. The obvious repair, accepting `Some(0 | 1)` everywhere, is weaker
    // than it looks: deleting `fmt::one`'s clean short-circuit turns a genuinely clean file into
    // `WouldChange`, and a set-valued assertion cannot see that. This test knows which call should
    // be clean and which should change, so it says so.
    let at = |args: &[&str], want: i32| {
        let out = Command::cargo_bin("redextape").unwrap().current_dir(&root).args(args).output().unwrap();
        assert_eq!(
            out.status.code(),
            Some(want),
            "`{}` must exit {want}; stderr: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    };

    // 40 is narrower than this fixture's canonical form, so the file WOULD be rewritten: exit 1.
    let from_config = at(&["fmt", "--check", "w.rxt"], 1);
    // 120 is the width the fixture is already canonical at, so nothing changes: exit 0.
    let from_flag = at(&["fmt", "--check", "--width", "120", "w.rxt"], 0);
    let from_default = at(&["--no-config", "fmt", "--check", "w.rxt"], 0);

    assert_ne!(from_config, from_flag, "the flag must override the config's 40");
    assert_eq!(from_flag, from_default, "and 120 IS the default, so these two must agree");
}

/// An out-of-range width in the config refuses before any file is touched.
#[test]
fn an_out_of_range_config_width_refuses_and_names_the_bound() {
    let root = tree("width-bad", "[fmt]\nwidth = 4\n");
    let out =
        Command::cargo_bin("redextape").unwrap().current_dir(&root).args(["fmt", "--check", "a.rxt"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    let text = String::from_utf8(out.stderr).unwrap();
    assert!(text.contains("fmt.width"), "must name the key: {text}");
    assert!(text.contains("20"), "and the bound: {text}");
}

/// **THE REGRESSION TEST FOR DESIGN §7, AND THE MOST IMPORTANT TEST IN THIS FILE.** A config that
/// sets an encoding must not make a non-`tm` emit start failing. The wrong implementation — merging
/// the config into the flag's `Option` before the guard — exits 2 here and passes every other test
/// in this file.
#[test]
fn a_configured_encoding_does_not_break_a_lambda_emit() {
    let root = tree("emit-guard", "[emit]\nencoding = \"binary\"\nfield-width = 32\n");
    std::fs::write(root.join("p.rxt"), "1 + 2\n").unwrap();
    // **BOTH NON-`tm` TARGETS, NOT JUST LAMBDA.** The guard is `lang != Lang::Tm`, so `asm` is
    // covered by the same branch — but "covered by the same branch" is a claim about today's code,
    // and the design's rule is stated for ANY non-`tm` target. An earlier version of this test
    // checked only `lambda`, which would have left a third of the rule resting on a reading of the
    // source rather than on anything that runs.
    for lang in ["lambda", "asm"] {
        let out = Command::cargo_bin("redextape")
            .unwrap()
            .current_dir(&root)
            .args(["emit", "p.rxt", "--lang", lang])
            .output()
            .unwrap();
        assert_eq!(
            out.status.code(),
            Some(0),
            "a config file must never make a working `--lang {lang}` fail; stderr: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(!String::from_utf8(out.stdout).unwrap().is_empty(), "and `--lang {lang}` must still emit something");
    }
}

/// The flag on a non-`tm` target is still an error — the guard must not have been loosened to make
/// the test above pass.
#[test]
fn the_flags_on_a_non_tm_target_are_still_errors() {
    let root = tree("emit-guard-flag", "");
    std::fs::write(root.join("p.rxt"), "1 + 2\n").unwrap();
    // Both flags against both non-`tm` targets: four cases, not two. `asm` is refused by the same
    // `lang != Lang::Tm` branch as `lambda`, and pinning that here is what keeps it a tested fact
    // rather than an inference from reading the condition.
    for lang in ["lambda", "asm"] {
        for flag in [["--encoding", "binary"], ["--field-width", "32"]] {
            let out = Command::cargo_bin("redextape")
                .unwrap()
                .current_dir(&root)
                .args(["emit", "p.rxt", "--lang", lang, flag[0], flag[1]])
                .output()
                .unwrap();
            assert_eq!(out.status.code(), Some(2), "{} off the tm target must exit 2", flag[0]);
            let text = String::from_utf8(out.stderr).unwrap();
            assert!(
                text.contains(flag[0]),
                "the message must name which flag was refused on `--lang {lang}`, got: {text}"
            );
        }
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
    assert_ne!(with_config.stdout, with_defaults.stdout, "binary and unary must not produce the same machine");
}

/// **`emit.field-width` WAS THE ONE CONFIG KEY WHOSE EFFECT NO TEST COULD FAIL ON.** Measured before
/// this existed: replacing `emit.rs`'s `opts.field_width.unwrap_or(opts.defaults.field_width)` with
/// `unwrap_or(0)` — discarding the configured value outright — left the whole workspace passing. The
/// other three keys each had a takes-effect test; this one had only refusal tests, and a sabotage
/// that reads the key, validates it and then ignores it passes every refusal test there is.
///
/// **THE HEADER IS WHAT IS ASSERTED, NOT THE EXIT CODE.** `width 8` is the configured value arriving
/// in the artifact, which is the only thing the key is for. A `--no-config` run of the same program
/// is checked to NOT say `width 8`, so the assertion is about the config rather than about a
/// coincidence of what auto-fit happens to pick for `1 + 2`.
#[test]
fn a_configured_field_width_reaches_the_emitted_header_and_the_flag_beats_it() {
    let root = tree("emit-fw-config", "[emit]\nfield-width = 8\n");
    std::fs::write(root.join("p.rxt"), "1 + 2\n").unwrap();
    let emit = |args: &[&str]| {
        let out = Command::cargo_bin("redextape").unwrap().current_dir(&root).args(args).output().unwrap();
        assert_eq!(
            out.status.code(),
            Some(0),
            "`{}` must emit; stderr: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    };

    let from_config = emit(&["emit", "p.rxt", "--lang", "tm"]);
    assert!(from_config.contains("\nwidth 8\n"), "the configured width must reach the header:\n{from_config}");

    let from_default = emit(&["--no-config", "emit", "p.rxt", "--lang", "tm"]);
    assert!(!from_default.contains("\nwidth 8\n"), "auto-fit must not happen to pick 8 here:\n{from_default}");

    let from_flag = emit(&["emit", "p.rxt", "--lang", "tm", "--field-width", "16"]);
    assert!(from_flag.contains("\nwidth 16\n"), "the flag must beat the configured 8:\n{from_flag}");
}

/// **THE FLAG THAT OVERRIDES A VALIDATED KEY IS VALIDATED TOO, AND FOR TWO SLICES IT WAS NOT.**
/// `config::validate` has always refused `emit.field-width` outside `0` or `4..=64` at exit 2;
/// `--field-width` checked nothing, so `65` wrote a `.tm` carrying `width 65` at exit 0 — a header
/// this tool's own `parse_tm_full` then refuses, so the mistake outlived the invocation as a file on
/// disk — and `usize::MAX` reached `Unary::init_reg` and aborted the process on a capacity overflow.
///
/// **`-o` IS PASSED ON EVERY REFUSED CASE ON PURPOSE.** Exit 2 alone does not say the artifact was
/// not written, and "writes a file its own reader refuses" is the half of this bug that exit codes
/// cannot see; asserting the destination does not exist is what pins it.
#[test]
fn an_out_of_range_field_width_flag_is_refused_and_writes_nothing() {
    let root = tree("emit-fw-range", "");
    std::fs::write(root.join("p.rxt"), "1 + 2\n").unwrap();
    // Below the floor, above the ceiling, and the value that actually panicked.
    for bad in ["3", "65", "18446744073709551615"] {
        let dest = root.join(format!("p-{bad}.tm"));
        let out = Command::cargo_bin("redextape")
            .unwrap()
            .current_dir(&root)
            .args(["emit", "p.rxt", "--lang", "tm", "--field-width", bad, "-o"])
            .arg(&dest)
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(2), "`--field-width {bad}` must exit 2, never 0 and never 101");
        let text = String::from_utf8(out.stderr).unwrap();
        assert!(text.contains("--field-width"), "the message must name the flag: {text}");
        assert!(text.contains("4..=64"), "and the bounds it broke: {text}");
        assert!(text.contains(bad), "and the value it got: {text}");
        assert!(!dest.exists(), "`--field-width {bad}` must leave no file behind");
    }
    // The sentinel and both bounds still work, and the file each writes still reads back — the
    // property `65` broke. A guard that refused these would pass the loop above and be useless.
    for good in ["0", "4", "64"] {
        let dest = root.join(format!("ok-{good}.tm"));
        let out = Command::cargo_bin("redextape")
            .unwrap()
            .current_dir(&root)
            .args(["emit", "p.rxt", "--lang", "tm", "--field-width", good, "-o"])
            .arg(&dest)
            .output()
            .unwrap();
        assert_eq!(
            out.status.code(),
            Some(0),
            "`--field-width {good}` must still be accepted; stderr: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let back = Command::cargo_bin("redextape").unwrap().current_dir(&root).arg("run").arg(&dest).output().unwrap();
        assert_eq!(
            back.status.code(),
            Some(0),
            "what `--field-width {good}` writes must read back; stderr: {}",
            String::from_utf8_lossy(&back.stderr)
        );
        assert_eq!(String::from_utf8(back.stdout).unwrap().trim(), "3");
    }
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
    // **EXIT 2 ALONE CANNOT TELL THE TWO REFUSALS APART, AND THAT IS WHY THIS ASSERTION EXISTS.**
    // `emit_tm` has an `Overflow` arm ("a value does not fit this encoding's widest tape field")
    // and a `TooLarge` arm ("this program lowers to more than N TM states"), and both exit 2. A
    // regression routing the pinned path through `TooLarge` would keep the code and swap the
    // message, and a code-only test would never see it — the shape that once let eleven mutations
    // survive a full suite in this repository.
    //
    // **AND THE MESSAGE MUST BE THE PINNED PATH'S OWN, NOT THE AUTO-FIT PATH'S.** It read "a value
    // does not fit this encoding's widest tape field (64 cells, `MAX_FIELD_WIDTH`)" here, where 64
    // was never attempted — the field was 4 — and then suggested `--encoding binary`, which does not
    // lift a pin (`--encoding binary --field-width 4` refuses this same program; `8` emits). So the
    // width tried and the setting that pinned it are what is asserted.
    let text = String::from_utf8(pinned.stderr).unwrap();
    assert!(
        text.contains("a value does not fit a 4-cell tape field"),
        "the pinned refusal must be the OVERFLOW one, not `TooLarge`, and must name the width it tried: {text}"
    );
    assert!(text.contains("`--field-width 4` pinned it"), "and the setting that chose that width: {text}");
    assert!(!text.contains("widest tape field"), "64 was never attempted here: {text}");
    let fitted = Command::cargo_bin("redextape")
        .unwrap()
        .current_dir(&root)
        .args(["emit", "p.rxt", "--lang", "tm"])
        .output()
        .unwrap();
    assert_eq!(fitted.status.code(), Some(0), "auto-fit widens and succeeds on the same program");
}

/// Item 2 (filed during the branch): nothing exercised `main`'s `Err(_) => Source::Defaults`
/// fallback, taken when `std::env::current_dir()` fails.
///
/// **THE MECHANISM.** A process whose working directory has been removed out from under it gets
/// `getcwd() -> -1 ENOENT` on Linux — confirmed directly before writing this test. `sh -c`
/// reproduces that deterministically: `cd` into a directory, `rmdir` that SAME directory (which only
/// succeeds because it holds nothing else), then `exec` the real binary so it STARTS with an
/// already-gone cwd, rather than merely `chdir`-ing away from a still-valid one partway through.
/// Both the binary's own path and the file to lint are passed in absolute — a relative path cannot
/// resolve against a cwd that no longer exists, which is exactly the condition under test.
///
/// **THE TRAP THAT DISTINGUISHES "THE FALLBACK RAN" FROM "SOME OTHER CODE PATH ALSO HAPPENED NOT TO
/// CRASH."** `root/redextape.toml` sets `deny-warnings = true`, and `root` is `w.rxt`'s own parent —
/// exactly where a NORMAL (cwd-intact) discovery walk starting from `root` would find it. `leaf/`,
/// the directory that actually gets removed, is a SUBDIRECTORY of `root`, not `root` itself, so
/// `root` and the config in it survive the whole exercise untouched on disk. `Source::Defaults`
/// skips discovery entirely, so this config is never consulted when the fallback fires correctly:
/// `w.rxt`'s warning is reported but not denied, exit 0. The control run at the end proves the trap
/// is live — the same config, given a chance to run through `Source::Discover` from an intact cwd,
/// DOES deny the same warning at exit 1 — so exit 0 in the deleted-cwd run is not merely "nothing
/// happened", it specifically means "no config was consulted", which is `Source::Defaults`'s
/// signature and not, say, a config search that silently swallowed an error partway through.
#[test]
fn a_deleted_working_directory_falls_back_to_defaults_rather_than_crashing() {
    let root = redextape_test_support::ScratchDir::new("cwd-gone").unwrap();
    std::fs::write(root.join("redextape.toml"), "[lint]\ndeny-warnings = true\n").unwrap();
    let w = root.join("w.rxt");
    std::fs::write(&w, "let mut x = 1;\nx + 1\n").unwrap();
    let leaf = root.join("leaf");
    std::fs::create_dir_all(&leaf).unwrap();

    let bin = assert_cmd::cargo::cargo_bin("redextape");
    let script =
        format!("cd {} && rmdir {} && exec {} lint {}", leaf.display(), leaf.display(), bin.display(), w.display());
    let out = std::process::Command::new("sh").arg("-c").arg(&script).output().unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "a process whose cwd vanished must fall back to defaults, not crash or exit non-zero; stderr: {}\nscript: {script}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8(out.stderr).unwrap();
    assert!(text.contains("does not need to be mutable"), "the fallback must still actually lint the file: {text}");

    // Control: the identical config and file, reached NORMALLY (cwd intact), does deny the warning —
    // proving the config planted above is live rather than inert, so exit 0 above really is evidence
    // that no config was consulted, not evidence that this config never does anything.
    let control = std::process::Command::new(&bin).current_dir(&root).args(["lint", "w.rxt"]).output().unwrap();
    assert_eq!(control.status.code(), Some(1), "the same config, reached normally, must deny the same warning");
}
