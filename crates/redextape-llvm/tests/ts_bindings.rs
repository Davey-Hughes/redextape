//! Fidelity gates on the generated TypeScript for the LLVM view's types, the sibling of `redextape-clif`'s
//! `tests/ts_bindings.rs`, whose doc says what they ask and why they ask the types.

// Test target: a fixture that fails to build IS the failure this file reports, as in `redextape-clif`'s.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
#![cfg(feature = "ts")]

use std::path::Path;

use redextape_llvm::{LlvmFunction, LlvmLine, LlvmListing};
use redextape_test_support::ts_derive_scan::{
    assert_generated_covers_every_derive_site, assert_no_generated_type_carries_bigint,
    assert_overrides_match_field_nullability,
};
use ts_rs::TS;

/// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
fn generated() -> Vec<(&'static str, String)> {
    let cfg = ts_rs::Config::new();
    vec![
        ("LlvmFunction", LlvmFunction::export_to_string(&cfg).unwrap()),
        ("LlvmLine", LlvmLine::export_to_string(&cfg).unwrap()),
        ("LlvmListing", LlvmListing::export_to_string(&cfg).unwrap()),
    ]
}

/// No generated type may carry `bigint`, for the reason `redextape-clif`'s gate gives.
#[test]
fn no_generated_type_carries_bigint() {
    assert_no_generated_type_carries_bigint(&generated());
}

/// `generated()` names every type in this crate that derives `ts_rs::TS`.
#[test]
fn the_gate_covers_every_exported_type() {
    assert_generated_covers_every_derive_site(Path::new(env!("CARGO_MANIFEST_DIR")), &generated());
}

/// No field override may misstate whether the field can be null.
#[test]
fn no_override_misstates_a_field_s_nullability() {
    assert_overrides_match_field_nullability(Path::new(env!("CARGO_MANIFEST_DIR")));
}
