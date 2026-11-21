//! Fidelity gates on the generated TypeScript for the types THIS crate declares, the sibling of
//! `redextape-core`'s and `redextape-wire`'s `tests/ts_bindings.rs` over the CLIF view's types. All three
//! call `redextape_test_support::ts_derive_scan`, whose doc says what its coverage scan guarantees and
//! what it leaves open. Feature-gated whole: without `ts` there are no `TS` impls to ask and this target
//! compiles to nothing.
//!
//! THESE ASK THE TYPES, NOT `web/bindings/`. `ts-rs` emits one `export_bindings_*` test per type and
//! cargo orders tests arbitrarily, so a directory scan can run before generation and pass on an empty
//! directory. `export_to_string` returns what the exporter would write, in this process.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
#![cfg(feature = "ts")]

use std::path::Path;

use redextape_clif::{
    ClifAt, ClifFunction, ClifListing, ClifRow, ClifRowKind, ClifState, ClifStatus, ClifValue, ClifWindow,
};
use redextape_test_support::ts_derive_scan::{
    assert_generated_covers_every_derive_site, assert_no_generated_type_carries_bigint,
    assert_overrides_match_field_nullability,
};
use ts_rs::TS;

/// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates. Core's and
/// wire's types these name, `RxmWord` or `RunStatus`, are their own crates' gates' to cover.
fn generated() -> Vec<(&'static str, String)> {
    // ts-rs's defaults, not `from_env`, for the reason core's `ts_bindings.rs` gives.
    let cfg = ts_rs::Config::new();
    vec![
        ("ClifAt", ClifAt::export_to_string(&cfg).unwrap()),
        ("ClifFunction", ClifFunction::export_to_string(&cfg).unwrap()),
        ("ClifListing", ClifListing::export_to_string(&cfg).unwrap()),
        ("ClifRow", ClifRow::export_to_string(&cfg).unwrap()),
        ("ClifRowKind", ClifRowKind::export_to_string(&cfg).unwrap()),
        ("ClifState", ClifState::export_to_string(&cfg).unwrap()),
        ("ClifStatus", ClifStatus::export_to_string(&cfg).unwrap()),
        ("ClifValue", ClifValue::export_to_string(&cfg).unwrap()),
        ("ClifWindow", ClifWindow::export_to_string(&cfg).unwrap()),
    ]
}

/// No generated type may carry `bigint`: `ts-rs` maps `u64` to it, while `serde_wasm_bindgen` puts a
/// `u64` on the wire as a JS number, so a `u64` field without an override generates TypeScript that
/// typechecks and is wrong at runtime.
#[test]
fn no_generated_type_carries_bigint() {
    assert_no_generated_type_carries_bigint(&generated());
}

/// `generated()` names every type in this crate that derives `ts_rs::TS`, compared as sets of names, so
/// a type that gains the derive without an entry fails here rather than going unwatched.
#[test]
fn the_gate_covers_every_exported_type() {
    assert_generated_covers_every_derive_site(Path::new(env!("CARGO_MANIFEST_DIR")), &generated());
}

/// No field override may misstate whether the field can be null: `ts(type = "number")` on an
/// `Option<u64>` carries no `bigint` and keeps the derive, so neither test above sees the `| null` gone.
#[test]
fn no_override_misstates_a_field_s_nullability() {
    assert_overrides_match_field_nullability(Path::new(env!("CARGO_MANIFEST_DIR")));
}
