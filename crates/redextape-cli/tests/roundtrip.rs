//! `emit` then `run` is the oracle expressed as two shell commands: a program compiled all the way
//! to a Turing machine, written to a file, read back by a parser that shares no code with the
//! compiler, simulated, and decoded to the same value the tree-walker gives. Exercised through the
//! real binary, twice, because that is the whole point.

#[test]
fn emit_then_run_reproduces_the_reference_answer() {
    let dir = redextape_test_support::ScratchDir::new("roundtrip").unwrap();
    let src = dir.join("p.rxt");
    let art = dir.join("p.tm");
    std::fs::write(&src, "[1, 2, 3]").unwrap();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["emit", src.to_str().unwrap(), "--lang", "tm", "-o", art.to_str().unwrap()])
        .assert()
        .success();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["run", art.to_str().unwrap()])
        .assert()
        .success()
        .stdout("[1, 2, 3]\n");
}

/// `emit --lang tm --reduce <list>` on `5 - 3`, then `run` on the reduced file and `run --backend
/// reference` on the program, returning both answers. Its value is 2 rather than 0, for the reason
/// `reduced_tm_file.rs`'s corpus gives: a decode that goes wrong on a tape whose value is 0 reads 0
/// anyway. The file must be a reduced one: a `--reduce` that wrote a lowered file would give the
/// same answer, and nothing else here could tell.
#[allow(clippy::unwrap_used)]
fn reduced_and_reference_answers(case: &str, list: &str) -> (String, String) {
    let dir = redextape_test_support::ScratchDir::new(case).unwrap();
    let src = dir.join("p.rxt");
    let art = dir.join("p.tm");
    std::fs::write(&src, "5 - 3").unwrap();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["emit", src.to_str().unwrap(), "--lang", "tm", "--reduce", list, "-o", art.to_str().unwrap()])
        .assert()
        .success();
    let text = std::fs::read_to_string(&art).unwrap();
    assert!(text.contains("\nversion 2\n"), "`--reduce {list}` must write a version 2 file");
    assert!(text.lines().any(|l| l.starts_with("reduced ")), "`--reduce {list}` must write a `reduced` line");

    let run = |args: &[&str]| {
        let done = assert_cmd::Command::cargo_bin("redextape").unwrap().args(args).assert().success();
        String::from_utf8(done.get_output().stdout.clone()).unwrap()
    };
    (run(&["run", art.to_str().unwrap()]), run(&["run", src.to_str().unwrap(), "--backend", "reference"]))
}

#[test]
fn a_file_reduced_to_one_tape_runs_to_the_reference_answer() {
    let (reduced, reference) = reduced_and_reference_answers("roundtrip-single-tape", "single-tape");
    assert_eq!(reference, "2\n", "the reference answer for `5 - 3`");
    assert_eq!(reduced, reference);
}

#[test]
#[ignore = "slow tier: run via scripts/check-slow.sh"]
fn a_file_reduced_through_all_three_stages_runs_to_the_reference_answer() {
    let (reduced, reference) = reduced_and_reference_answers("roundtrip-all-three", "fold, single-tape, two-symbol");
    assert_eq!(reference, "2\n", "the reference answer for `5 - 3`");
    assert_eq!(reduced, reference);
}

/// The same oracle, the second of the two artifact forms `run` executes (`.tm`'s, above, is the
/// first): `emit --lang rxm` then `run` on the emitted `.rxm` file, compiled to the register
/// machine rather than a Turing machine.
#[test]
fn emit_then_run_rxm_reproduces_the_reference_answer() {
    let dir = redextape_test_support::ScratchDir::new("roundtrip-rxm").unwrap();
    let src = dir.join("p.rxt");
    let art = dir.join("p.rxm");
    std::fs::write(&src, "[1, 2, 3]").unwrap();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["emit", src.to_str().unwrap(), "--lang", "rxm", "-o", art.to_str().unwrap()])
        .assert()
        .success();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["run", art.to_str().unwrap()])
        .assert()
        .success()
        .stdout("[1, 2, 3]\n");
}

/// The rxm oracle on a higher-order program: a closure over `n` passed to `map` as a value.
/// `lower_rxm` alone refuses it, so it emits only because `emit --lang rxm` lowers through the
/// defunctionalising fallback `emit --lang tm` and `run --backend tm` use, and the file it writes must
/// still run to the answer the program itself gives.
#[test]
fn emit_then_run_rxm_of_a_higher_order_program_reproduces_the_reference_answer() {
    let dir = redextape_test_support::ScratchDir::new("roundtrip-rxm-higher-order").unwrap();
    let src = dir.join("p.rxt");
    let art = dir.join("p.rxm");
    std::fs::write(
        &src,
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
         let n = 2;\n\
         map([1, 2, 3], |x| x + n)\n",
    )
    .unwrap();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["emit", src.to_str().unwrap(), "--lang", "rxm", "-o", art.to_str().unwrap()])
        .assert()
        .success();

    let run = |path: &std::path::Path| {
        let done = assert_cmd::Command::cargo_bin("redextape")
            .unwrap()
            .args(["run", path.to_str().unwrap()])
            .assert()
            .success();
        String::from_utf8(done.get_output().stdout.clone()).unwrap()
    };
    let reference = run(&src);
    assert_eq!(reference, "[3, 4, 5]\n", "the reference answer");
    assert_eq!(run(&art), reference);
}
