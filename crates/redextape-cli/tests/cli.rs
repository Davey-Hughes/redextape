//! End-to-end transcripts: argv in, stdout/stderr/exit-code out.
//!
//! The unit tests in each command module call `run` directly with a buffer. These run the real
//! binary, which is the only place `main`'s exit-code mapping and `clap`'s own errors are exercised.
//!
//! **EACH CASE IS A SET OF FILES IN `tests/cmd/`, AND THIS HARNESS READS THEM.** `<name>.toml` gives
//! the binary (`bin.name`), the argv (`args`), any standard input (`stdin`), whether the case runs in
//! a sandbox (`fs.sandbox`) and its exit code (`status.code`, absent for 0). A case with no `stdin`
//! key reads the bytes of `<name>.stdin` as its input when that file exists; a case with both fails,
//! since the harness cannot tell which input its goldens were written for. `<name>.stdout` and
//! `<name>.stderr` are its goldens, and a case missing either golden fails. A sandbox is a fresh temp
//! directory holding a copy of `<name>.in/`, and it is the working directory; after the run, every
//! file under `<name>.out/` must match the sandbox's file at the same path. A case without a sandbox
//! runs in this crate's directory, and may have neither `.in/` nor `.out/`. Every table in a `.toml`
//! refuses a key it does not declare, so a key this harness would not act on fails the case instead of
//! being skipped. Any other entry in `tests/cmd/`, one that is not `<name>.toml` or one of the parts
//! above beside it, fails the run before a case runs, naming it: a `.trycmd` or `.md` case, a format
//! this harness does not read, or a golden or `.in/` whose `.toml` is missing would otherwise never
//! run, and nothing would say so. Adding a case is adding its files: nothing here names one.
//!
//! **TO REGENERATE GOLDENS:** `SNAPSHOTS=overwrite cargo test -p redextape-cli --test cli` rewrites
//! every `.stdout`, `.stderr` and `.out/` file whose content differs from what the binary did, then
//! review the diff. It never writes a `.toml`: an exit code that changed is a failure until
//! `status.code` is edited by hand. Every other `.out/` difference also stays a failure and is never
//! handed to snapbox's overwrite, because in snapbox 1.2.2 that call fixes only a content difference,
//! by rewriting the golden. For an `.out/` file the binary did not make it copies the golden into the
//! sandbox, and for a path it could not read it does nothing; both return `Ok` with the golden as it
//! was, so counting them fixed would pass a run that the next plain run fails. For an entry the binary
//! made as another kind, or a symlink to another target, it returns an error, for some kinds after
//! deleting the golden. `SNAPSHOTS` takes no value but `overwrite`, and any other fails the run before
//! a case runs: snapbox reads `skip` and `ignore` as "pass every stream whatever it holds", which a
//! variable left set for another project would do here.
//!
//! A golden is a snapbox pattern: `[..]` within a line and `...` alone on a line are wildcards, and
//! `[CWD]`, `[ROOT]` and `[EXE]` stand for the case's working directory, its sandbox and the
//! platform's executable suffix, so a golden naming a sandbox path is the same on every run.
//!
//! **The `/` in `fmt_check_dirty.stdout`'s "no newline" trailer is not a redextape defect and not
//! literally what the binary prints.** The real binary ends that line with a backslash —
//! `\ No newline at end of file`, which is `similar`'s own unified-diff format — never a forward
//! slash. snapbox's `FilterPaths` rewrites every literal `\` to `/` (meant for Windows path
//! separators, applied with no context check), and it runs on BOTH the captured output (inside
//! `Assert`) and the loaded golden (explicitly, in `run_case`), so the comparison stays
//! self-consistent. Turning it off on both sides (`Assert::normalize_paths(false)` and no
//! `FilterPaths` on the golden) would need that golden to hold the real `\`. Do not "fix" the binary
//! to emit `/`; there is nothing there to fix.
//!
//! **EVERY SANDBOX GETS A `.git` MARKER IN ITS ROOT.** `config::discover` walks upward from the
//! working directory for a `redextape.toml`, stopping at whichever comes first in a directory: the
//! config file, or a `.git`. A sandbox sits in the system temp directory, which other processes
//! write to, so a case with no config of its own would walk out of its sandbox and pick up whatever
//! a stray `redextape.toml` above it holds, silently changing what the case tests. The marker ends
//! the walk at the sandbox root. Git refuses to track any path component named `.git`, so it cannot
//! be a fixture in `.in/` like `a.rxt` or `redextape.toml`; it is written into the sandbox after the
//! copy, which leaves the working tree untouched. In `config_unknown_key.in` and
//! `config_bad_width.in` the `redextape.toml` sits in the sandbox root, and `discover` checks for the
//! config file before `.git` in the same directory (the order its own doc comment calls out), so
//! there the marker is inert. It goes into every sandbox anyway, so a future case with no config of
//! its own is bounded without anyone remembering to add a marker for it.
//!
//! No `allow` here: the helpers return `Result` and never `unwrap`, `expect` or `panic`, and the
//! `#[test]` fns are inside `clippy.toml`'s in-tests exemption. If a change makes clippy fail, add the
//! narrowest allow that fixes it, and confirm it is load-bearing by deleting it and re-running.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use redextape_test_support::ScratchDir;
use snapbox::assert::Action;
use snapbox::cmd::{Command, cargo_bin};
use snapbox::data::DataFormat;
use snapbox::dir::{DirRoot, PathDiff};
use snapbox::filter::{Filter as _, FilterPaths};
use snapbox::report::Palette;
use snapbox::{Assert, Data};

/// One `tests/cmd/<name>.toml`.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    bin: Bin,
    args: Vec<String>,
    stdin: Option<String>,
    #[serde(default)]
    fs: Fs,
    #[serde(default)]
    status: Status,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Bin {
    name: String,
}

#[derive(Default, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Fs {
    #[serde(default)]
    sandbox: bool,
}

#[derive(Default, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Status {
    code: Option<i32>,
}

/// Refuses a `SNAPSHOTS` value other than `overwrite`, for the reason the module doc gives.
fn check_snapshots_var(value: Option<&OsStr>) -> Result<(), String> {
    match value {
        None => Ok(()),
        Some(value) if value == "overwrite" => Ok(()),
        Some(value) => Err(format!(
            "SNAPSHOTS is \"{}\"; this harness takes only `overwrite`, or SNAPSHOTS unset",
            value.display()
        )),
    }
}

/// A fresh temp directory holding a copy of `template` (when it exists) and the `.git` marker the
/// module doc explains.
fn sandbox_from(template: &Path) -> Result<DirRoot, String> {
    let mut root = DirRoot::mutable_temp().map_err(|e| format!("creating the sandbox: {e}"))?;
    if template.exists() {
        root = root
            .with_template(template)
            .map_err(|e| format!("copying {} into the sandbox: {e}", template.display()))?;
    }
    let path = root.path().ok_or("the sandbox has no path")?;
    std::fs::write(path.join(".git"), "gitdir: elsewhere\n").map_err(|e| format!("planting the .git marker: {e}"))?;
    Ok(root)
}

/// What a case `<name>.toml` may have beside it, each named `<name>.<extension>`.
const CASE_PARTS: [&str; 6] = ["toml", "stdin", "stdout", "stderr", "in", "out"];

/// The `.toml` cases in `dir`, sorted. The `Err` names every entry that is not one of a case's
/// parts, for the reason the module doc gives.
fn read_cases(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| format!("reading {}: {e}", dir.display()))? {
        entries.push(entry.map_err(|e| format!("reading an entry of {}: {e}", dir.display()))?.path());
    }
    entries.sort();
    let is_part = |path: &PathBuf| {
        path.extension().is_some_and(|ext| CASE_PARTS.iter().any(|part| ext == *part))
            && path.with_extension("toml").is_file()
    };
    let strays: Vec<String> =
        entries.iter().filter(|path| !is_part(path)).map(|path| path.display().to_string()).collect();
    if !strays.is_empty() {
        return Err(format!("not part of any `.toml` case, so never run: {}", strays.join(", ")));
    }
    Ok(entries.into_iter().filter(|path| path.extension().is_some_and(|ext| ext == "toml")).collect())
}

/// Runs the case `case_file` describes and checks it against its goldens. The `Err` names every way
/// the run differed, not only the first.
fn run_case(case_file: &Path, snapshots: &Assert) -> Result<(), String> {
    let text = std::fs::read_to_string(case_file).map_err(|e| format!("reading the case: {e}"))?;
    let case: Case = toml::from_str(&text).map_err(|e| format!("parsing the case: {e}"))?;
    if case.bin.name != "redextape" {
        return Err(format!("`bin.name` is {:?}; the only binary here is \"redextape\"", case.bin.name));
    }
    let stdin_file = case_file.with_extension("stdin");
    let stdin = match (case.stdin, stdin_file.exists()) {
        (Some(_), true) => return Err(format!("it has a `stdin` key and {}, two inputs", stdin_file.display())),
        (Some(text), false) => Some(Data::text(text)),
        (None, true) => {
            let bytes = std::fs::read(&stdin_file).map_err(|e| format!("reading {}: {e}", stdin_file.display()))?;
            Some(Data::binary(bytes))
        }
        (None, false) => None,
    };
    let template = case_file.with_extension("in");
    let fixture = case_file.with_extension("out");
    let sandbox = if case.fs.sandbox {
        Some(sandbox_from(&template)?)
    } else if template.exists() || fixture.exists() {
        return Err("it has a `.in` or `.out` directory but not `fs.sandbox = true`".into());
    } else {
        None
    };
    let root = sandbox.as_ref().and_then(DirRoot::path).map(Path::to_path_buf);
    let cwd = match &root {
        Some(root) => root.clone(),
        None => std::env::current_dir().map_err(|e| format!("reading the working directory: {e}"))?,
    };

    let mut redactions = snapshots.redactions().clone();
    if let Some(root) = &root {
        redactions.insert("[ROOT]", root.clone()).map_err(|e| format!("redacting [ROOT]: {e}"))?;
    }
    redactions.insert("[CWD]", cwd.clone()).map_err(|e| format!("redacting [CWD]: {e}"))?;
    let snapshots = snapshots.clone().redact_with(redactions);

    let mut command = Command::new(cargo_bin!("redextape")).args(&case.args).current_dir(&cwd);
    if let Some(stdin) = stdin {
        command = command.stdin(stdin);
    }
    let output = command.output().map_err(|e| format!("running the binary: {e}"))?;

    let mut failures = Vec::new();
    let expected_code = case.status.code.unwrap_or(0);
    if output.status.code() != Some(expected_code) {
        failures.push(format!("exit status: expected code {expected_code}, got {}", output.status));
    }
    for (stream, actual) in [("stdout", output.stdout), ("stderr", output.stderr)] {
        let golden = case_file.with_extension(stream);
        let expected = FilterPaths.filter(Data::read_from(&golden, Some(DataFormat::Text)));
        if let Err(e) = snapshots.try_eq(Some(&stream), Data::binary(actual), expected) {
            failures.push(format!("{stream}: {e}"));
        }
    }
    if let (Some(sandbox), Some(root)) = (sandbox, &root) {
        if fixture.exists() {
            let overwrite = matches!(snapshots.selected_action(), Action::Overwrite);
            for check in PathDiff::subset_matches_iter(&fixture, root, snapshots.redactions()) {
                let Err(diff) = check else { continue };
                // Only a content difference is handed to snapbox's overwrite, the one difference that
                // call fixes. For the others it returns `Ok` with the golden unchanged, or fails, for
                // some kinds after deleting the golden; the module doc says which does which.
                if overwrite && matches!(diff, PathDiff::ContentMismatch { .. }) && diff.overwrite().is_ok() {
                    continue;
                }
                let mut report = String::new();
                diff.write(&mut report, Palette::color()).map_err(|e| format!("reporting a file difference: {e}"))?;
                failures.push(report);
            }
        }
        if let Err(e) = sandbox.close() {
            failures.push(format!("removing the sandbox: {e}"));
        }
    }
    if failures.is_empty() { Ok(()) } else { Err(failures.join("\n")) }
}

#[test]
fn cli_transcripts() {
    if let Err(why) = check_snapshots_var(std::env::var_os("SNAPSHOTS").as_deref()) {
        panic!("{why}");
    }
    let snapshots = Assert::new().action_env("SNAPSHOTS");
    let cases = match read_cases(Path::new("tests/cmd")) {
        Ok(cases) => cases,
        Err(why) => panic!("{why}"),
    };
    assert!(!cases.is_empty(), "no `.toml` case in tests/cmd");
    let mut failures = Vec::new();
    for case in &cases {
        match run_case(case, &snapshots) {
            Ok(()) => eprintln!("{} ... ok", case.display()),
            Err(why) => {
                eprintln!("{} ... FAILED", case.display());
                failures.push(format!("{}:\n{why}", case.display()));
            }
        }
    }
    assert!(failures.is_empty(), "{} of {} cases failed\n\n{}", failures.len(), cases.len(), failures.join("\n\n"));
}

/// Writes each `(path, contents)` under `dir`, making parent directories, and returns
/// `<dir>/case.toml`: a case the tests below build from parts, outside `tests/cmd/`.
fn write_case(dir: &Path, files: &[(&str, &str)]) -> std::io::Result<PathBuf> {
    for (name, contents) in files {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, contents)?;
    }
    Ok(dir.join("case.toml"))
}

/// `tests/cmd/fmt_stdin`'s case file, its `stdin` key and its two goldens: a case known to pass,
/// which the tests below vary one part of.
fn fmt_stdin() -> Result<[String; 4], String> {
    let read = |ext: &str| {
        std::fs::read_to_string(Path::new("tests/cmd/fmt_stdin").with_extension(ext))
            .map_err(|e| format!("reading fmt_stdin.{ext}: {e}"))
    };
    let toml = read("toml")?;
    let case: Case = toml::from_str(&toml).map_err(|e| format!("parsing fmt_stdin.toml: {e}"))?;
    let input = case.stdin.ok_or("fmt_stdin.toml has no `stdin` key")?;
    Ok([toml, input, read("stdout")?, read("stderr")?])
}

const FMT_STDIN_WITHOUT_STDIN_KEY: &str = "bin.name = \"redextape\"\nargs = [\"fmt\", \"-\"]\n";

#[test]
fn snapshots_takes_only_overwrite_or_unset() {
    assert_eq!(check_snapshots_var(None), Ok(()));
    assert_eq!(check_snapshots_var(Some(OsStr::new("overwrite"))), Ok(()));
    for value in ["skip", "ignore", "verify", "", "Overwrite"] {
        let why = check_snapshots_var(Some(OsStr::new(value))).expect_err(value);
        assert!(why.contains(&format!("{value:?}")), "{why}");
    }
}

#[test]
fn snapshots_ignore_fails_the_run() {
    let run = std::process::Command::new(std::env::current_exe().expect("finding the test binary"))
        .args(["cli_transcripts", "--exact"])
        .env("SNAPSHOTS", "ignore")
        .output()
        .expect("running the test binary");
    let printed = format!("{}{}", String::from_utf8_lossy(&run.stdout), String::from_utf8_lossy(&run.stderr));
    assert!(!run.status.success(), "the run passed under SNAPSHOTS=ignore:\n{printed}");
    assert!(printed.contains("SNAPSHOTS is \"ignore\""), "{printed}");
}

#[test]
fn a_file_that_is_not_part_of_a_toml_case_is_named_and_refused() {
    let [toml, _, stdout, stderr] = fmt_stdin().expect("reading fmt_stdin");
    let dir = ScratchDir::new("cli-stray-files").expect("making a scratch dir");
    let case = write_case(dir.path(), &[("case.toml", &toml), ("case.stdout", &stdout), ("case.stderr", &stderr)])
        .expect("writing the case");
    assert_eq!(read_cases(dir.path()), Ok(vec![case]));
    let strays = ["steps.trycmd", "steps.md", "orphan.stdout", "orphan.in/a.rxt", "case.txt"];
    write_case(dir.path(), &strays.map(|name| (name, "stray\n"))).expect("writing the strays");
    let why = read_cases(dir.path()).expect_err("a stray file passed");
    for named in ["steps.trycmd", "steps.md", "orphan.stdout", "orphan.in", "case.txt"] {
        assert!(why.contains(named), "{named} is not named: {why}");
    }
    assert!(!why.contains("case.toml") && !why.contains("case.stdout") && !why.contains("case.stderr"), "{why}");
}

#[test]
fn a_stray_file_in_tests_cmd_fails_the_run() {
    let [toml, _, stdout, stderr] = fmt_stdin().expect("reading fmt_stdin");
    let dir = ScratchDir::new("cli-stray-run").expect("making a scratch dir");
    write_case(
        &dir.path().join("tests/cmd"),
        &[("case.toml", &toml), ("case.stdout", &stdout), ("case.stderr", &stderr), ("steps.md", "stray\n")],
    )
    .expect("writing the case");
    let run = std::process::Command::new(std::env::current_exe().expect("finding the test binary"))
        .args(["cli_transcripts", "--exact"])
        .current_dir(dir.path())
        .output()
        .expect("running the test binary");
    let printed = format!("{}{}", String::from_utf8_lossy(&run.stdout), String::from_utf8_lossy(&run.stderr));
    assert!(!run.status.success(), "the run passed with tests/cmd/steps.md in it:\n{printed}");
    assert!(printed.contains("steps.md"), "{printed}");
}

#[test]
fn a_stdin_file_is_the_input_of_a_case_without_a_stdin_key() {
    let [_, input, stdout, stderr] = fmt_stdin().expect("reading fmt_stdin");
    let dir = ScratchDir::new("cli-stdin-file").expect("making a scratch dir");
    let case = write_case(
        dir.path(),
        &[
            ("case.toml", FMT_STDIN_WITHOUT_STDIN_KEY),
            ("case.stdin", &input),
            ("case.stdout", &stdout),
            ("case.stderr", &stderr),
        ],
    )
    .expect("writing the case");
    assert_eq!(run_case(&case, &Assert::new()), Ok(()));
}

#[test]
fn a_case_with_a_stdin_key_and_a_stdin_file_fails() {
    let [toml, input, stdout, stderr] = fmt_stdin().expect("reading fmt_stdin");
    let dir = ScratchDir::new("cli-two-inputs").expect("making a scratch dir");
    let case = write_case(
        dir.path(),
        &[("case.toml", &toml), ("case.stdin", &input), ("case.stdout", &stdout), ("case.stderr", &stderr)],
    )
    .expect("writing the case");
    let why = run_case(&case, &Assert::new()).expect_err("a case with two inputs passed");
    assert!(why.contains("two inputs"), "{why}");
}

#[test]
fn a_case_missing_either_golden_fails() {
    let [toml, _, stdout, stderr] = fmt_stdin().expect("reading fmt_stdin");
    for (missing, kept, golden) in [("stdout", "case.stderr", &stderr), ("stderr", "case.stdout", &stdout)] {
        let dir = ScratchDir::new("cli-missing-golden").expect("making a scratch dir");
        let case = write_case(dir.path(), &[("case.toml", &toml), (kept, golden)]).expect("writing the case");
        let why = run_case(&case, &Assert::new()).expect_err(missing);
        assert!(why.contains(&format!("case.{missing}")), "{why}");
    }
}

#[test]
fn overwrite_rewrites_a_differing_out_file_and_fails_on_one_the_binary_did_not_make() {
    let [toml, _, stdout, stderr] = fmt_stdin().expect("reading fmt_stdin");
    let dir = ScratchDir::new("cli-overwrite-out").expect("making a scratch dir");
    let case = write_case(
        dir.path(),
        &[
            ("case.toml", &format!("{toml}\nfs.sandbox = true\n")),
            ("case.stdout", &stdout),
            ("case.stderr", &stderr),
            ("case.in/kept.txt", "in the sandbox\n"),
            ("case.out/kept.txt", "stale\n"),
            ("case.out/never.txt", "never made\n"),
        ],
    )
    .expect("writing the case");
    let why = run_case(&case, &Assert::new().action(Action::Overwrite)).expect_err("overwrite passed a missing file");
    assert!(why.contains("never.txt") && !why.contains("kept.txt"), "{why}");
    let golden =
        |name: &str| std::fs::read_to_string(dir.path().join("case.out").join(name)).expect("reading a golden");
    assert_eq!(golden("kept.txt"), "in the sandbox\n");
    assert_eq!(golden("never.txt"), "never made\n");
}
