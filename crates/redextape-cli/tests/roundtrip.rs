//! `emit` then `run` is the oracle expressed as two shell commands: a program compiled all the way
//! to a Turing machine, written to a file, read back by a parser that shares no code with the
//! compiler, simulated, and decoded to the same value the tree-walker gives. Exercised through the
//! real binary, twice, because that is the whole point — nothing outside `redextape-core`'s own
//! tests has shown this before Task 4.

#[test]
fn emit_then_run_reproduces_the_reference_answer() {
    let dir = std::env::temp_dir().join("rxt-roundtrip");
    std::fs::create_dir_all(&dir).unwrap();
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
