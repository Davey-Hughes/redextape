//! Parsing a `.tm` file takes time in proportion to its size, for the two line kinds whose duplicate
//! checks once compared each line with every line of its kind before it: `state` lines and header
//! `tape` lines.
//!
//! A timing test is only as good as its margin. Each test parses a file and one with four times the
//! lines, and allows the larger 10x as long, where linear growth gives about 4x. Against the parser at
//! `78ebea6`, which still compared each line with every earlier line of its kind, the same files
//! measured 23.08x for `state` lines and 17.17x for `tape` lines in a `--release` build.
//!
//! The two files of a pair are parsed in turn, small then large, for `ROUNDS` rounds, and each keeps
//! its fastest parse. Load on the machine that lasts long enough to slow every parse of one file
//! therefore also spans parses of the other.
//!
//! Slow tier: both tests are `#[ignore]`, and `scripts/check-slow.sh` runs them in `--release`.

// Test target: a generated file that does not parse as generated is the failure these tests report, so
// panicking is deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]`
// functions and `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::fmt::Write as _;
use std::time::{Duration, Instant};

use redextape_core::tm::{TmDocument, parse_tm_full};

/// How much longer the file with four times the lines may take to parse.
const MAX_RATIO: f64 = 10.0;
/// Lines in the smaller file of each pair.
const SMALL: usize = 16_000;
/// Lines in the larger file of each pair: four times `SMALL`.
const LARGE: usize = 64_000;
/// How many times each file of a pair is parsed, in turn with the other.
const ROUNDS: usize = 5;

/// A one-tape machine of `n` accept states named `s0` to `s{n-1}`. It parses with no diagnostics.
fn state_lines(n: usize) -> String {
    let mut src = String::from("tapes 1\nstart s0\n");
    for i in 0..n {
        writeln!(src, "state s{i}: accept").unwrap();
    }
    src
}

/// Every parse of a `state_lines` file is clean.
fn parses_clean(doc: &TmDocument, _lines: usize) {
    assert!(doc.diagnostics.is_empty(), "a `state` lines file did not parse clean: {:?}", doc.diagnostics.first());
}

/// A one-state machine whose header carries `n` `tape` lines, indices 1 to `n`. Every index is out of
/// range for `tapes 1`; `every_tape_line_reached_the_duplicate_check` says what that shows.
fn tape_lines(n: usize) -> String {
    let mut src = String::from("tapes 1\nstart s\nencoding unary\nwidth 4\nslots 1\nresult Nat\n");
    for i in 1..=n {
        writeln!(src, "tape {i} _1").unwrap();
    }
    src.push_str("state s: accept\n");
    src
}

/// Every line of a `tape_lines` file got past the duplicate check, so the time includes that check for
/// every line. A diagnostic count cannot show this: a `tape` line malformed before the check also yields
/// exactly one diagnostic. `out of range` can, because `HeaderParts::finish` reports it only for an index
/// `HeaderParts::directive` stored, and `directive` stores one only after the duplicate check.
fn every_tape_line_reached_the_duplicate_check(doc: &TmDocument, lines: usize) {
    assert_eq!(doc.diagnostics.len(), lines, "{lines} `tape` lines must yield one diagnostic each");
    if let Some(d) = doc.diagnostics.iter().find(|d| !d.message.contains("out of range")) {
        panic!("a `tape` line failed before the duplicate check, so this test does not time that check: {d:?}");
    }
}

/// Parse the `lines(SMALL)` and `lines(LARGE)` files in turn for `ROUNDS` rounds, pass every parse to
/// `check` with its file's line count, and hold the ratio of the two fastest parses under `MAX_RATIO`.
fn assert_linear(what: &str, lines: fn(usize) -> String, check: fn(&TmDocument, usize)) {
    let (small, large) = (lines(SMALL), lines(LARGE));
    let (mut small_time, mut large_time) = (Duration::MAX, Duration::MAX);
    for _ in 0..ROUNDS {
        for (src, n, fastest) in [(&small, SMALL, &mut small_time), (&large, LARGE, &mut large_time)] {
            let started = Instant::now();
            let doc = parse_tm_full(src);
            *fastest = (*fastest).min(started.elapsed());
            // After the clock stops, so the check is not part of the time.
            check(&doc, n);
        }
    }
    let ratio = large_time.as_secs_f64() / small_time.as_secs_f64();
    println!(
        "{what}: {SMALL} lines {small_time:.2?}, {LARGE} lines {large_time:.2?}, ratio {ratio:.2} (bound {MAX_RATIO})"
    );
    assert!(
        ratio < MAX_RATIO,
        "{what}: four times the lines took {ratio:.2}x as long ({small_time:?} -> {large_time:?})"
    );
}

#[test]
#[ignore = "slow tier: times real parses; run via scripts/check-slow.sh"]
fn parse_time_grows_linearly_with_state_lines() {
    assert_linear("state lines", state_lines, parses_clean);
}

#[test]
#[ignore = "slow tier: times real parses; run via scripts/check-slow.sh"]
fn parse_time_grows_linearly_with_tape_lines() {
    assert_linear("tape lines", tape_lines, every_tape_line_reached_the_duplicate_check);
}
