// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
//! The CLIF leg: its end found in chunks by a scout, its cursor stepped, paused and rewound, and its value
//! decoded as the rxm leg's is.

// Each test target uses its own part of the shared helpers.
#[allow(dead_code)]
mod common;

use common::{TIGHT, program_of};
use redextape_clif::{ClifInput, ClifLeg, ClifStatus, ClifWindow};
use redextape_core::tm::{Caps, DEFAULT_CAPS};
use redextape_core::trace::RxmCap;
use redextape_core::ty::Ty;
use redextape_native::Listing;
use redextape_native::measure::CORPUS;
use redextape_wire::{Decoded, RunStatus};

const LISTINGS: [Listing; 2] = [Listing::AsBuilt, Listing::Optimised];
const WINDOW: ClifWindow = ClifWindow { values: 0, frames: 0, cells: 0, boxes: 0 };
const FACT: &str = include_str!("../../../web/src/examples/fact.rxt");

/// The leg of `src`, a λ program typed `ty`, under `caps`, built as `listing`.
fn leg(src: &str, ty: Ty, caps: Caps, listing: Listing) -> ClifLeg {
    let input = ClifInput { program: program_of(src, src), ty, caps };
    ClifLeg::new(input, listing).unwrap()
}

/// `measure::CORPUS`'s `loop1000000`.
fn loop_src() -> &'static str {
    CORPUS.iter().find(|(name, _)| *name == "loop1000000").unwrap().1
}

/// Steps `leg`'s cursor until it stops: the steps it then stands at.
fn step_to_stop(leg: &mut ClifLeg) -> u64 {
    while leg.step() {}
    leg.state(WINDOW).step
}

#[test]
fn the_end_is_found_in_chunks() {
    for (listing, steps) in [(Listing::AsBuilt, 189), (Listing::Optimised, 131)] {
        let mut leg = leg(FACT, Ty::Nat, DEFAULT_CAPS, listing);
        assert!(!leg.find_end(100), "{}: the end is past 100 steps", listing.name());
        assert_eq!(
            leg.status(),
            ClifStatus { run: RunStatus::Running, cap: None, total_steps: None },
            "{}: no total before the scout ends",
            listing.name()
        );
        assert!(leg.find_end(100), "{}: the end is within 200 steps", listing.name());
        assert_eq!(
            leg.status(),
            ClifStatus { run: RunStatus::Running, cap: None, total_steps: Some(steps) },
            "{}",
            listing.name()
        );
    }
}

/// The length is known once the cursor ends, with no scout sent ahead, as a worker that reports the end when
/// the recording reaches it needs; a pause is not the end.
#[test]
fn a_cursor_that_ends_gives_the_length_without_the_scout() {
    for (listing, steps) in [(Listing::AsBuilt, 189), (Listing::Optimised, 131)] {
        let mut leg = leg(FACT, Ty::Nat, DEFAULT_CAPS, listing);
        assert_eq!(step_to_stop(&mut leg), steps, "{}", listing.name());
        assert_eq!(
            leg.status(),
            ClifStatus { run: RunStatus::Ended, cap: None, total_steps: Some(steps) },
            "{}: the cursor's end",
            listing.name()
        );
    }
    let mut paused = leg(loop_src(), Ty::Nat, TIGHT, Listing::AsBuilt);
    assert_eq!(step_to_stop(&mut paused), 1205);
    assert_eq!(
        paused.status(),
        ClifStatus { run: RunStatus::Capped, cap: Some(RxmCap::Steps), total_steps: None },
        "the cursor's pause"
    );
}

/// The listing's functions carry `partition`'s names, main's first.
#[test]
fn the_listing_names_each_function() {
    for listing in LISTINGS {
        let leg = leg(FACT, Ty::Nat, DEFAULT_CAPS, listing);
        let labels: Vec<&str> = leg.listing().functions.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(labels, ["$main", "fact.0"], "{}", listing.name());
    }
}

#[test]
fn stepping_to_the_end_reads_the_value() {
    let mut leg = leg(FACT, Ty::Nat, DEFAULT_CAPS, Listing::AsBuilt);
    assert_eq!(leg.value(), Decoded::Unfinished, "no end is known before a step");
    for i in 0..189 {
        assert!(leg.step(), "step {i}");
    }
    assert!(!leg.step(), "the 190th step");
    assert_eq!(leg.status().run, RunStatus::Ended);
    assert_eq!(leg.value(), Decoded::Value { text: "24".to_string() });
    assert_eq!(leg.state(WINDOW).step, 189);
}

#[test]
fn a_fault_names_the_call_that_faulted() {
    let fault = Decoded::Fault { message: "head of empty list at pc1".to_string() };
    for listing in LISTINGS {
        let mut scouted = leg("head(nil)", Ty::Nat, DEFAULT_CAPS, listing);
        assert!(scouted.find_end(u64::MAX));
        assert_eq!(scouted.value(), fault, "{}: the scout's end", listing.name());
        let mut stepped = leg("head(nil)", Ty::Nat, DEFAULT_CAPS, listing);
        step_to_stop(&mut stepped);
        assert_eq!(stepped.value(), fault, "{}: the cursor's end", listing.name());
    }
}

#[test]
fn a_word_past_two_to_the_53_decodes() {
    let mut leg = leg("18446744073709551615 + 1", Ty::Nat, DEFAULT_CAPS, Listing::AsBuilt);
    assert!(leg.find_end(u64::MAX));
    assert_eq!(leg.value(), Decoded::Value { text: "18446744073709551615".to_string() });
}

#[test]
fn a_function_value_is_undecodable() {
    let ty = Ty::Fun(vec![Ty::Nat], Box::new(Ty::Nat));
    let mut leg = leg("|x| x + 1", ty, DEFAULT_CAPS, Listing::AsBuilt);
    assert!(leg.find_end(u64::MAX));
    assert_eq!(leg.value(), Decoded::Undecodable);
}

#[test]
fn a_raised_step_cap_resumes_and_rewind_restores_the_caps() {
    let mut leg = leg(loop_src(), Ty::Nat, TIGHT, Listing::AsBuilt);
    assert!(leg.find_end(10_000));
    assert_eq!(leg.status().total_steps, Some(1205), "the scout's stop");
    assert_eq!(step_to_stop(&mut leg), 1205, "the cursor's stop");
    assert_eq!(leg.status(), ClifStatus { run: RunStatus::Capped, cap: Some(RxmCap::Steps), total_steps: Some(1205) });
    assert_eq!(leg.value(), Decoded::Unfinished, "a capped scout defers to the cursor, which is paused");
    leg.raise_cap(40);
    assert_eq!(leg.status().run, RunStatus::Running, "a raised step cap resumes a steps pause");
    let further = step_to_stop(&mut leg);
    assert!(further > 1205, "the next stop, {further}, is past the first");
    assert_eq!(leg.status().total_steps, Some(further), "past the scout's stop the total is the cursor's");
    leg.rewind();
    assert_eq!(step_to_stop(&mut leg), 1205, "a rewound cursor runs under the input's caps");
}

#[test]
fn a_capped_scout_defers_to_a_cursor_that_ends() {
    let src = "let mut i = 0; let mut acc = 0; while i < 10 { acc = acc + i; i = i + 1; } acc";
    let mut leg = leg(src, Ty::Nat, Caps { steps: 5, ..DEFAULT_CAPS }, Listing::AsBuilt);
    assert!(leg.find_end(u64::MAX));
    step_to_stop(&mut leg);
    assert_eq!(leg.status().cap, Some(RxmCap::Steps), "the scout and the cursor pause at the steps cap");
    leg.raise_cap(1000);
    let ended = step_to_stop(&mut leg);
    assert_eq!(leg.status(), ClifStatus { run: RunStatus::Ended, cap: None, total_steps: Some(ended) });
    assert_eq!(leg.value(), Decoded::Value { text: "45".to_string() });
}

#[test]
fn a_stack_cap_is_final_for_the_leg() {
    let src = "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)";
    let mut leg = leg(src, Ty::Nat, Caps { stack: 3, ..DEFAULT_CAPS }, Listing::AsBuilt);
    step_to_stop(&mut leg);
    assert_eq!(leg.status().cap, Some(RxmCap::Stack));
    leg.raise_cap(1000);
    assert_eq!(
        (leg.status().run, leg.status().cap),
        (RunStatus::Capped, Some(RxmCap::Stack)),
        "a raised step cap leaves a stack pause"
    );
    assert!(!leg.step(), "the stack pause holds");
}
