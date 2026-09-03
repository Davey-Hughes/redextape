//! Fidelity gates on the generated TypeScript for the types THIS crate declares. Feature-gated
//! whole: without `ts` there are no `TS` impls to ask and this target compiles to nothing.
//!
//! **THE SIBLING OF `crates/redextape-core/tests/ts_bindings.rs`, OVER A DIFFERENT SET OF TYPES.**
//! Both run the same two gates and both call the same scanner —
//! `redextape_test_support::ts_derive_scan` — which is why that scanner lives in a shared crate
//! rather than in either test file. Read its doc for what the coverage scan guarantees, the seven
//! revisions that shaped it, and the three routes it names as outside its reach rather than closed.
//! What is local to this file is the list below and the reason each entry is on it.
//!
//! THESE ASK THE TYPES, NOT `web/bindings/`. `ts-rs` emits one `export_bindings_*` test per type and
//! cargo orders tests arbitrarily, so a directory scan can run before generation and pass on an empty
//! directory. `export_to_string` returns what the exporter would write, in this process.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
#![cfg(feature = "ts")]

use std::collections::BTreeSet;
use std::path::Path;

use redextape_test_support::ts_derive_scan::{
    assert_overrides_match_field_nullability, ts_deriving_type_names_in_crate, without_doc_comments,
};
use redextape_wasm::{Decoded, LambdaStatus, RunStatus, TmScratchStatus, TmStatus};
use ts_rs::TS;

/// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
///
/// **FIVE, AND `redextape-core`'s TWELVE ARE NOT AMONG THEM.** Each crate's gate covers its own
/// derive sites, because `ts_deriving_type_names_in_crate` scans one crate root and a type declared
/// in the other one is invisible to it from here. That is the correct division: a core type added
/// without an entry in core's `generated()` fails core's gate, not this one.
fn generated() -> Vec<(&'static str, String)> {
    vec![
        ("Decoded", Decoded::export_to_string().unwrap()),
        ("LambdaStatus", LambdaStatus::export_to_string().unwrap()),
        ("RunStatus", RunStatus::export_to_string().unwrap()),
        ("TmScratchStatus", TmScratchStatus::export_to_string().unwrap()),
        ("TmStatus", TmStatus::export_to_string().unwrap()),
    ]
}

/// No generated type may carry `bigint`.
///
/// THE DEFAULT IS WRONG SILENTLY AND ONLY THE BROWSER TIER COULD OTHERWISE CATCH IT. `ts-rs` maps
/// `u64` to `bigint` unconditionally; `serde_wasm_bindgen` puts a `u64` on the wire as a JS number,
/// which `browser.rs` measures directly in this very crate. A field of that class added without an
/// override generates TypeScript that typechecks, ships, and is wrong at runtime. This fails at the
/// commit instead.
///
/// **IT DOES NOT CATCH EVERY WAY AN OVERRIDE CAN BE WRONG, AND `TmStatus::total_steps` IS THE
/// STANDING EXAMPLE.** `ts(type = "number")` on that `Option<u64>` field generates `total_steps:
/// number` — no `bigint`, so this gate passes, and the `| null` that `None` puts on the wire is gone.
/// See that field's own doc for what does catch it. Naming the hole here is the point: a gate that
/// implied it covered the whole override class would tell the next reader not to check.
///
/// THE SCAN SKIPS JSDOC. `export_to_string` reproduces Rust doc comments verbatim, so a doc comment
/// that merely discusses `bigint` in prose would otherwise fail this test for a documentation reason
/// having nothing to do with the generated type.
#[test]
fn no_generated_type_carries_bigint() {
    for (name, ts) in generated() {
        assert!(
            !without_doc_comments(&ts).contains("bigint"),
            "{name} generates `bigint`. A `u64`/`i64` field crosses this boundary as a JS number, so \
             it needs an override — `#[cfg_attr(feature = \"ts\", ts(type = \"number\"))]` for a bare \
             field, or `ts(type = \"number | null\")` for one behind an `Option`, because \
             `ts(type = ...)` replaces the WHOLE field type rather than the integer inside it. \
             Generated:\n{ts}"
        );
    }
}

/// The list above covers every type in this crate that derives `ts_rs::TS` — by name, not merely by
/// count, and not by trusting one literal spelling of the attribute that carries it.
///
/// WITHOUT THIS, THE GATE ABOVE IS ONLY AS COMPLETE AS SOMEONE'S MEMORY. A type added with the derive
/// and not added to `generated()` would be unwatched, and the failure would be silence.
///
/// A COUNT IS NOT ENOUGH TO CATCH THAT: a commit that removes the derive from a listed type and adds
/// it to a different one leaves the count unchanged while `generated()`'s stale entry keeps compiling,
/// because `export_to_string` is a default trait method and does not require `#[ts(export)]`.
/// Comparing NAMES as sets catches both directions.
///
/// **THE SCAN ITSELF IS `redextape_test_support::ts_derive_scan`'s, AND ITS DOC IS WHERE THE
/// REASONING LIVES** — four revisions plus three more in review, each defeated by an ordinary
/// spelling of the same attribute, ending in a whitelist rather than a fifth banned spelling. Read it
/// before assuming this gate is stronger or weaker than it is; it names three routes it does not
/// close rather than denying them.
#[test]
fn the_gate_covers_every_exported_type() {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let in_src = ts_deriving_type_names_in_crate(crate_root, &crate_root.join("tests").join("ts_bindings.rs"));
    let in_gate: BTreeSet<String> = generated().into_iter().map(|(name, _)| name.to_string()).collect();

    let missing_from_gate: Vec<&String> = in_src.difference(&in_gate).collect();
    let stale_in_gate: Vec<&String> = in_gate.difference(&in_src).collect();

    assert!(
        missing_from_gate.is_empty() && stale_in_gate.is_empty(),
        "`generated()` and this crate's `ts_rs::TS` derive sites disagree. Carry the derive but are \
         missing from `generated()`: {missing_from_gate:?}. Listed in `generated()` but no longer carry \
         the derive: {stale_in_gate:?}. Add the new type to `generated()`, or remove the stale entry — \
         or, if the derive was written in some other form, make the two agree."
    );
}

/// No field override may misstate whether the field can be null.
///
/// **NEITHER TEST ABOVE CAN SEE THIS CLASS, WHICH IS WHY IT IS A THIRD TEST RATHER THAN A WIDENING
/// OF EITHER.** `ts(type = "number")` on an `Option<u64>` generates `number`: no `bigint` for the
/// gate above to find, and the type still carries the derive, so the coverage gate is satisfied too.
/// The `| null` that `None` puts on the wire is simply gone. `TmStatus::total_steps` in this crate is
/// the field that class was measured on.
///
/// THE RULE AND ITS REASONING LIVE IN `redextape_test_support::ts_derive_scan` — read
/// `assert_overrides_match_field_nullability`'s own doc for the anchor, the forward resolution, and
/// the two things it names as outside its reach rather than closed. One implementation with two
/// callers is deliberate: a second copy drifts the moment one is widened and the other is not.
#[test]
fn no_override_misstates_a_field_s_nullability() {
    let crate_root = Path::new(env!("CARGO_MANIFEST_DIR"));
    assert_overrides_match_field_nullability(crate_root, &crate_root.join("tests").join("ts_bindings.rs"));
}
