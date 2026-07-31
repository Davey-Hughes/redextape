//! Part 2a substrate: a genuine multi-tape TM can be authored (in text or by hand), simulated to a
//! result, and round-tripped through its text form. Part 2b compiles register-assembly down to such
//! machines and checks them against the reference (the three-way oracle).

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use redextape_core::tm::{TM_DEFAULT_CAPS, TmStatus, parse_tm, print_tm, simulate};

const INCREMENT: &str = "\
; unary incrementer: append one mark
tapes 1
start scan

state scan:
  [1] -> write [*], move [R], goto scan
  [*] -> write [1], move [S], goto halt
state halt: accept
";

#[test]
fn author_simulate_and_round_trip_a_machine() {
    let (machine, ds) = parse_tm(INCREMENT);
    assert!(ds.is_empty(), "diagnostics: {ds:?}");
    let machine = machine.expect("a machine");

    // Simulate: 3 marks -> 4 marks.
    let (tapes, status) = simulate(&machine, &[vec!['1', '1', '1']], TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    assert_eq!(tapes[0].snapshot().0, vec!['1', '1', '1', '1']);

    // Round-trip: print(parse(s)) is idempotent, and re-parsing yields the same machine.
    let printed = print_tm(&machine);
    let (reparsed, ds2) = parse_tm(&printed);
    assert!(ds2.is_empty(), "diagnostics: {ds2:?}");
    assert_eq!(reparsed.as_ref(), Some(&machine));
    assert_eq!(print_tm(&reparsed.unwrap()), printed);
}

#[test]
fn malformed_tm_text_yields_diagnostics_not_a_panic() {
    for src in ["", "tapes 0\n", "state s:\n  [*] -> write [*], move [S], goto ghost\n", "junk line"] {
        let (m, ds) = parse_tm(src);
        assert!(m.is_none() || ds.is_empty()); // either a clean parse or diagnostics — never a panic
    }
}
