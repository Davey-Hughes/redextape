//! `emit` then `run` is the oracle expressed as two shell commands: a program compiled all the way
//! to a Turing machine, written to a file, read back by a parser that shares no code with the
//! compiler, simulated, and decoded to the same value the tree-walker gives. Exercised through the
//! real binary, twice, because that is the whole point — nothing outside `redextape-core`'s own
//! tests has shown this before Task 4.

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

/// The same oracle, the second of the two artifact forms `run` executes (`.tm`'s, above, is the
/// first): `emit --lang asm` then `run` on the emitted `.asm` file, compiled to the register
/// machine rather than a Turing machine. Task 5 is what makes this pair expressible — before it,
/// `run` on a `.asm` file fell through to the `.rxt` lexer.
#[test]
fn emit_then_run_asm_reproduces_the_reference_answer() {
    let dir = redextape_test_support::ScratchDir::new("roundtrip-asm").unwrap();
    let src = dir.join("p.rxt");
    let art = dir.join("p.asm");
    std::fs::write(&src, "[1, 2, 3]").unwrap();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["emit", src.to_str().unwrap(), "--lang", "asm", "-o", art.to_str().unwrap()])
        .assert()
        .success();

    assert_cmd::Command::cargo_bin("redextape")
        .unwrap()
        .args(["run", art.to_str().unwrap()])
        .assert()
        .success()
        .stdout("[1, 2, 3]\n");
}
