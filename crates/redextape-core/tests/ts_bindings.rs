//! Fidelity gates on the generated TypeScript. Feature-gated whole: without `ts` there are no `TS`
//! impls to ask and this target compiles to nothing.
//!
//! THESE ASK THE TYPES, NOT `web/bindings/`. `ts-rs` emits one `export_bindings_*` test per type and
//! cargo orders tests arbitrarily, so a directory scan can run before generation and pass on an
//! empty directory. `export_to_string` returns what the exporter would write, in this process.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
#![cfg(feature = "ts")]

use std::path::Path;

use redextape_core::analysis::TokenClass;
use redextape_core::diagnostic::{Diagnostic, Severity};
use redextape_core::lambda::{Cut, Owner};
use redextape_core::span::Span;
use redextape_core::tm::machine::Move;
use redextape_core::trace::{RxmCap, WordTag};
use redextape_core::viewmodel::{
    LambdaState, RuleView, RxmBox, RxmCallFrame, RxmCell, RxmProgram, RxmState, RxmWindow, RxmWord, StateView,
    TmProgram, TmState,
};
use redextape_test_support::ts_derive_scan::{
    assert_generated_covers_every_derive_site, assert_no_generated_type_carries_bigint,
    assert_overrides_match_field_nullability,
};
use ts_rs::TS;

/// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
fn generated() -> Vec<(&'static str, String)> {
    // ts-rs's defaults, not `Config::from_env`, so a `TS_RS_LARGE_INT` in the environment cannot
    // make the bigint gate pass vacuously. The derived export tests call `from_env`.
    // `scripts/build-web-bindings.sh` and `scripts/check-all.sh` start cargo without each variable
    // ts-rs 12.0.1 reads but `TS_RS_EXPORT_DIR`; a cargo `[env]` table can still set any of them.
    let cfg = ts_rs::Config::new();
    vec![
        ("Cut", Cut::export_to_string(&cfg).unwrap()),
        ("Diagnostic", Diagnostic::export_to_string(&cfg).unwrap()),
        ("LambdaState", LambdaState::export_to_string(&cfg).unwrap()),
        ("Move", Move::export_to_string(&cfg).unwrap()),
        ("Owner", Owner::export_to_string(&cfg).unwrap()),
        ("RuleView", RuleView::export_to_string(&cfg).unwrap()),
        ("RxmBox", RxmBox::export_to_string(&cfg).unwrap()),
        ("RxmCallFrame", RxmCallFrame::export_to_string(&cfg).unwrap()),
        ("RxmCap", RxmCap::export_to_string(&cfg).unwrap()),
        ("RxmCell", RxmCell::export_to_string(&cfg).unwrap()),
        ("RxmProgram", RxmProgram::export_to_string(&cfg).unwrap()),
        ("RxmState", RxmState::export_to_string(&cfg).unwrap()),
        ("RxmWindow", RxmWindow::export_to_string(&cfg).unwrap()),
        ("RxmWord", RxmWord::export_to_string(&cfg).unwrap()),
        ("Severity", Severity::export_to_string(&cfg).unwrap()),
        ("Span", Span::export_to_string(&cfg).unwrap()),
        ("StateView", StateView::export_to_string(&cfg).unwrap()),
        ("TmProgram", TmProgram::export_to_string(&cfg).unwrap()),
        ("TmState", TmState::export_to_string(&cfg).unwrap()),
        ("TokenClass", TokenClass::export_to_string(&cfg).unwrap()),
        ("WordTag", WordTag::export_to_string(&cfg).unwrap()),
    ]
}

/// No generated type may carry `bigint`.
///
/// THE DEFAULT IS WRONG SILENTLY AND ONLY THE BROWSER TIER COULD OTHERWISE CATCH IT. `ts-rs` maps
/// `u64` to `bigint` by default; `serde_wasm_bindgen` puts a `u64` on the wire as a JS number,
/// which `redextape-wasm`'s browser tests measure directly. A field of that class added without the
/// `#[ts(type = "number")]` override generates TypeScript that typechecks, ships, and is wrong at
/// runtime. This fails at the commit instead.
///
/// **IT DOES NOT CATCH EVERY WAY AN OVERRIDE CAN BE WRONG.** `ts(type = ...)` replaces the WHOLE
/// field type rather than the integer inside it, so `ts(type = "number")` on an `Option<u64>` field
/// would generate `field: number` — no `bigint`, so this gate passes, and the `| null` that `None`
/// puts on the wire is gone. None of this crate's fields are `Option<u64>` today; `redextape-wire`'s
/// `TmStatus::total_steps` and `RxmStatus::total_steps` are. `no_override_misstates_a_field_s_nullability`
/// below catches that class in this crate, and its twin in `redextape-wire`'s `ts_bindings.rs` catches it
/// there. Naming the hole here is the point: a gate that implied it covered the whole override class
/// would tell the next reader not to check.
///
/// THE SCAN SKIPS JSDOC. `export_to_string` reproduces Rust doc comments verbatim, so a doc comment
/// that merely discusses `bigint` in prose would otherwise fail this test for a documentation reason
/// having nothing to do with the generated type. `without_doc_comments` removes exactly the JSDoc ts-rs
/// emits before the scan runs.
#[test]
fn no_generated_type_carries_bigint() {
    assert_no_generated_type_carries_bigint(&generated());
}

/// The list above covers every type in this crate that derives `ts_rs::TS` — by name, not merely by
/// count, and not by trusting one literal spelling of the attribute that carries it.
///
/// WITHOUT THIS, THE GATE ABOVE IS ONLY AS COMPLETE AS SOMEONE'S MEMORY. A type added with the derive
/// and not added to `generated()` would be unwatched, and the failure would be silence.
///
/// A COUNT IS NOT ENOUGH TO CATCH THAT. A commit that removes the derive from an already-listed type
/// and adds it to a different type leaves the COUNT unchanged while `generated()`'s stale entry keeps
/// compiling — `export_to_string` is a default trait method and does not require `#[ts(export)]` — so
/// the newly-attributed type's `bigint` fidelity is never checked and the test stays green. Comparing
/// the NAMES as sets catches both directions: a name present in the sources but not in `generated()`,
/// and a name present in `generated()` but no longer in the sources.
///
/// A BLACKLIST OF SPELLINGS OF THE ATTRIBUTE IS NOT ENOUGH. Each of these carries the derive past a
/// match on one spelling: `ts(rename = "Foo", export)` carries the export flag without the substring
/// `ts(export)`. `derive(Default, ts_rs::TS)` carries the derive without the substring
/// `derive(ts_rs::TS)`. `use ts_rs::TS;` followed by bare `derive(TS)` carries it without the path
/// `ts_rs::TS` appearing on the derive line at all. And `use ts_rs as tsrs;` followed by
/// `derive(tsrs::TS)` carries it under an aliased crate name. The scan covers the whole crate, not
/// `src/` only, which would miss a derive routed through a file elsewhere in the crate — see
/// `ts_deriving_type_names_in_crate`'s doc for that construction. `ts_deriving_type_names_in_crate`
/// does not try to name another banned spelling: it WHITELISTS the one canonical derive line and fails
/// on any OTHER line that so much as mentions `ts_rs`, so every spelling above — and every one nobody
/// has thought of yet — fails the same assertion, for the same reason, rather than needing its own ban
/// added after the fact. See
/// `redextape_test_support::ts_derive_scan::ts_deriving_type_names_in_crate`'s own doc for what this
/// construction actually guarantees, and what remains outside it, named rather than denied.
#[test]
fn the_gate_covers_every_exported_type() {
    assert_generated_covers_every_derive_site(Path::new(env!("CARGO_MANIFEST_DIR")), &generated());
}

/// No field override may misstate whether the field can be null.
///
/// **NEITHER TEST ABOVE CAN SEE THIS CLASS, WHICH IS WHY IT IS A THIRD TEST RATHER THAN A WIDENING
/// OF EITHER.** `ts(type = "number")` on an `Option<u64>` generates `number`: no `bigint` for the
/// gate above to find, and the type still carries the derive, so the coverage gate is satisfied too.
/// The `| null` that `None` puts on the wire is simply gone.
///
/// THE RULE AND ITS REASONING LIVE IN `redextape_test_support::ts_derive_scan` — read
/// `assert_overrides_match_field_nullability`'s own doc for why it parses with `syn`, the rule over the
/// keys that say anything about null, and what it names as outside its reach rather than closed.
/// One implementation with two callers is deliberate: a second copy drifts the moment one is widened and
/// the other is not.
#[test]
fn no_override_misstates_a_field_s_nullability() {
    assert_overrides_match_field_nullability(Path::new(env!("CARGO_MANIFEST_DIR")));
}
