//! Optionality property 2 over GENERATED machines and headers, alongside the existing
//! `tm_bank_invariant` and `tm_width_equivalence` proptests.
//!
//! The generator must produce headers in the normal form `TmHeader::new` maintains — empty tapes
//! dropped, indices ascending, no duplicates — because a header outside that form is not a value the
//! type can hold, and asserting a round-trip over one would be asserting a property `TmHeader` does
//! not have.

use proptest::prelude::*;
use redextape_core::tm::{
    EncodingKind, MAX_FIELD_WIDTH, MIN_FIELD_WIDTH, Machine, Move, Rule, State, StateId, TmHeader, parse_tm_full,
    print_tm_with,
};
use redextape_core::ty::Ty;

/// The tape alphabet `['_', '#', '1', '0', '@']` (spec D4 / this project's own encodings), also used
/// for rule read/write symbols: every member is representable (never `* ; [ ]` or whitespace), so a
/// machine built from it always clears `Machine::validate()`.
fn arb_symbol() -> impl Strategy<Value = char> {
    prop_oneof![Just('_'), Just('#'), Just('1'), Just('0'), Just('@')]
}

fn arb_move() -> impl Strategy<Value = Move> {
    prop_oneof![Just(Move::L), Just(Move::R), Just(Move::S)]
}

/// One rule at a fixed tape `arity`, with `next` in range for a machine of `n_states` states. Reads and
/// writes are sometimes the wildcard (`None`), otherwise a representable symbol — both print/parse
/// cleanly, so every generated machine clears `Machine::validate()`.
fn arb_rule(arity: usize, n_states: u32) -> impl Strategy<Value = Rule> {
    (
        prop::collection::vec(prop::option::of(arb_symbol()), arity),
        prop::collection::vec(prop::option::of(arb_symbol()), arity),
        prop::collection::vec(arb_move(), arity),
        0..n_states,
    )
        .prop_map(|(read, write, moves, next)| Rule { read, write, moves, next })
}

/// A state's shape (accept flag + rules), WITHOUT a name — `arb_machine` assigns names by position so
/// every generated machine has unique, validate()-clean state names by construction. An accept state
/// carries no rules (`Machine::validate()` requires this); otherwise 0..3 rules at the machine's arity.
fn arb_state_shape(arity: usize, n_states: u32) -> impl Strategy<Value = (bool, Vec<Rule>)> {
    prop_oneof![
        Just((true, Vec::new())),
        prop::collection::vec(arb_rule(arity, n_states), 0..3).prop_map(|rules| (false, rules)),
    ]
}

/// A validate()-clean machine: 1..3 tapes, 1..4 states, every rule's arity == tapes, every `next` and
/// `start` in range, unique identifier-ish state names (`s0`, `s1`, ...).
fn arb_machine(tapes: usize, n_states: u32) -> impl Strategy<Value = Machine> {
    (0..n_states, prop::collection::vec(arb_state_shape(tapes, n_states), n_states as usize)).prop_map(
        move |(start, shapes)| {
            let states = shapes
                .into_iter()
                .enumerate()
                .map(|(i, (accept, rules))| State { name: format!("s{i}"), accept, rules })
                .collect();
            Machine { states, start: start as StateId, tapes }
        },
    )
}

fn arb_encoding() -> impl Strategy<Value = EncodingKind> {
    prop_oneof![Just(EncodingKind::Unary), Just(EncodingKind::Binary)]
}

fn arb_result_ty() -> impl Strategy<Value = Ty> {
    prop_oneof![Just(Ty::Nat), Just(Ty::Bool), Just(Ty::Unit), Just(Ty::List(Box::new(Ty::Nat)))]
}

/// A non-empty cell run over the tape alphabet — empty runs are excluded on purpose, since
/// `TmHeader::new` drops an empty entry and a generator that produced one would be exercising the
/// "no tape line at all" case rather than the "a tape line survives" case the indices strategy already
/// covers by sometimes choosing zero entries.
fn arb_tape_cells() -> impl Strategy<Value = Vec<char>> {
    prop::collection::vec(arb_symbol(), 1..8)
}

/// 0..3 DISTINCT tape indices, all `< tapes`, in ASCENDING order — exactly the normal form
/// `TmHeader::new` maintains, so the header this produces is already in the one shape a round-trip can
/// hold. Generating an out-of-order or duplicate-laden `Vec` and asserting the round-trip over it would
/// be asserting a property `TmHeader` does not have (see the module doc).
fn arb_tape_indices(tapes: usize) -> impl Strategy<Value = Vec<usize>> {
    prop::collection::vec(0..tapes, 0..=3usize.min(tapes)).prop_map(|mut v| {
        v.sort_unstable();
        v.dedup();
        v
    })
}

/// A `(Machine, TmHeader)` pair whose header's tape indices are always `< machine.tapes` — the
/// constraint `TmHeader::finish`'s out-of-range check enforces on a real file, and without which the
/// generated header could never legitimately describe the generated machine.
fn arb_machine_and_header() -> impl Strategy<Value = (Machine, TmHeader)> {
    (1usize..=3, 1u32..=4).prop_flat_map(|(tapes, n_states)| {
        (
            arb_machine(tapes, n_states),
            arb_encoding(),
            MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH,
            0u32..8,
            arb_result_ty(),
            arb_tape_indices(tapes),
        )
            .prop_flat_map(move |(machine, encoding, width, slots, result, indices)| {
                let n = indices.len();
                prop::collection::vec(arb_tape_cells(), n).prop_map(move |cells| {
                    let tape_entries: Vec<(usize, Vec<char>)> = indices.iter().copied().zip(cells).collect();
                    let header = TmHeader::new(encoding, width, slots, result.clone(), tape_entries);
                    (machine.clone(), header)
                })
            })
    })
}

proptest! {
    /// PROPERTY 2, over generated machines and headers rather than the hand-built/corpus ones
    /// `tests/tm_header.rs` and `tm/syntax.rs` already pin: a header printed alongside its machine is a
    /// header (and machine) parsed back, equal, with no diagnostics.
    #[test]
    fn a_generated_header_round_trips_through_the_text_form((m, h) in arb_machine_and_header()) {
        prop_assert!(m.validate().is_empty(), "generated machine must be validate()-clean: {:?}", m.validate());
        let text = print_tm_with(&m, &h);
        let (pm, ph, ds) = parse_tm_full(&text);
        prop_assert_eq!((pm, ph, ds), (Some(m), Some(h), Vec::new()), "round-trip over:\n{}", text);
    }
}
