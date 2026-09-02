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

use std::collections::BTreeSet;
use std::path::Path;

use redextape_core::analysis::TokenClass;
use redextape_core::diagnostic::{Diagnostic, Severity};
use redextape_core::lambda::{Cut, Owner};
use redextape_core::span::Span;
use redextape_core::tm::machine::Move;
use redextape_core::viewmodel::{LambdaState, RuleView, StateView, TmProgram, TmState};
use redextape_test_support::ts_derive_scan::{ts_deriving_type_names_in_crate, without_doc_comments};
use ts_rs::TS;

/// Every type in this crate carrying `#[ts(export)]`, paired with the file it generates.
fn generated() -> Vec<(&'static str, String)> {
    vec![
        ("Cut", Cut::export_to_string().unwrap()),
        ("Diagnostic", Diagnostic::export_to_string().unwrap()),
        ("LambdaState", LambdaState::export_to_string().unwrap()),
        ("Move", Move::export_to_string().unwrap()),
        ("Owner", Owner::export_to_string().unwrap()),
        ("RuleView", RuleView::export_to_string().unwrap()),
        ("Severity", Severity::export_to_string().unwrap()),
        ("Span", Span::export_to_string().unwrap()),
        ("StateView", StateView::export_to_string().unwrap()),
        ("TmProgram", TmProgram::export_to_string().unwrap()),
        ("TmState", TmState::export_to_string().unwrap()),
        ("TokenClass", TokenClass::export_to_string().unwrap()),
    ]
}

/// No generated type may carry `bigint`.
///
/// THE DEFAULT IS WRONG SILENTLY AND ONLY THE BROWSER TIER COULD OTHERWISE CATCH IT. `ts-rs` maps
/// `u64` to `bigint` unconditionally; `serde_wasm_bindgen` puts a `u64` on the wire as a JS number,
/// which `redextape-wasm`'s browser tests measure directly. A field of that class added without the
/// `#[ts(type = "number")]` override generates TypeScript that typechecks, ships, and is wrong at
/// runtime. This fails at the commit instead.
///
/// **IT DOES NOT CATCH EVERY WAY AN OVERRIDE CAN BE WRONG.** `ts(type = ...)` replaces the WHOLE
/// field type rather than the integer inside it, so `ts(type = "number")` on an `Option<u64>` field
/// would generate `field: number` — no `bigint`, so this gate passes, and the `| null` that `None`
/// puts on the wire is gone. None of this crate's fields are `Option<u64>` today; `redextape-wasm`'s
/// `TmStatus::total_steps` is where this actually happened, and that field's own doc records what does
/// catch it. Naming the hole here is the point: a gate that implied it covered the whole override class
/// would tell the next reader not to check.
///
/// THE SCAN SKIPS JSDOC. `export_to_string` reproduces Rust doc comments verbatim, so a doc comment
/// that merely discusses `bigint` in prose — as `viewmodel::TermNode`'s already does, for a type this
/// gate does not cover — would otherwise fail this test for a documentation reason having nothing to
/// do with the generated type. `without_doc_comments` removes exactly the JSDoc ts-rs emits before the
/// scan runs.
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
/// A COUNT IS NOT ENOUGH TO CATCH THAT. A commit that removes the derive from an already-listed type
/// and adds it to a different type leaves the COUNT unchanged while `generated()`'s stale entry keeps
/// compiling — `export_to_string` is a default trait method and does not require `#[ts(export)]` — so
/// the newly-attributed type's `bigint` fidelity is never checked and the test stays green. Comparing
/// the NAMES as sets catches both directions: a name present in the sources but not in `generated()`,
/// and a name present in `generated()` but no longer in the sources.
///
/// NOR IS TEXT-MATCHING ONE SPELLING OF THE ATTRIBUTE ENOUGH — FOUR REVIEW ROUNDS EACH COMPILED A
/// COUNTEREXAMPLE PAST THE PREVIOUS WORDING, EACH TIME BY FINDING ONE MORE SPELLING A BLACKLIST HAD NOT
/// NAMED YET. `ts(rename = "Foo", export)` carried the export flag without the substring `ts(export)`.
/// `derive(Default, ts_rs::TS)` carried the derive without the substring `derive(ts_rs::TS)`. `use
/// ts_rs::TS;` followed by bare `derive(TS)` carried it without the path `ts_rs::TS` appearing on the
/// derive line at all. And `use ts_rs as tsrs;` followed by `derive(tsrs::TS)` carried it under an
/// aliased crate name — the fourth round, found by the whole-branch review with `web/bindings/Rule.ts`
/// really written while both tests here stayed green. A fifth round found the scan itself scoped to
/// `src/` only, missing a derive routed through a file elsewhere in the crate — see
/// `ts_deriving_type_names_in_crate`'s doc for that construction. `ts_deriving_type_names_in_crate`
/// does not try to name a sixth banned spelling: it WHITELISTS the one canonical derive line and fails
/// on any OTHER line that so much as mentions `ts_rs`, so every spelling above — and every one nobody
/// has thought of yet — fails the same assertion, for the same reason, rather than needing its own ban
/// added after the fact. See `redextape_test_support::ts_derive_scan::ts_deriving_type_names_in_crate`'s
/// own doc for what this construction actually guarantees, and what remains outside it, named rather
/// than denied.
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
