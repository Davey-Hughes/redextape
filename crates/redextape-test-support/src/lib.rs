//! Test-only helpers shared across this workspace's crates.
//!
//! **A DEV-DEPENDENCY ONLY, and that is the reason this crate exists.** The natural home for
//! `arb_expr_over` would be a feature-gated module inside `redextape-core` — but that would put
//! `proptest` in core's `[dependencies]` as an optional entry, and core's `[dependencies]` is EMPTY by
//! design: the crate is deliberately WASM-clean. A separate crate keeps that invariant intact while
//! still letting `redextape-core` and `redextape-native` share one definition.

// Test code is exempt from `pedantic`, for the reason `clippy.toml` gives for the
// unwrap/expect/panic set: an assertion is a deliberate panic, and a probe that casts a `u64` step
// count to `f64` to print a ratio is not a defect. This crate has no inline `#[cfg(test)]` module of
// its own — it is itself a test-only helper library, consumed by other crates' tests, not a holder
// of tests — so there is no module-level attribute for `cfg_attr` to stand in for here; kept for
// consistency with the other crates in this workspace, which do have inline test modules.
#![cfg_attr(test, allow(clippy::pedantic))]

use proptest::prelude::*;

/// The first-order expression-generator shape shared by four call sites, parameterised by its LEAF
/// strategy. (`arb_wide_ranging_expr` in `redextape-core`'s `tm_width_equivalence.rs` is a separate,
/// DELIBERATELY DIFFERENT generator with the same `prop_recursive(3, 8, 3, …)` parameters but a
/// different four-arm set, whose leaves deliberately cross `MAX_FIELD_WIDTH` to exercise the TM
/// auto-fit retry path and its `Overflow` outcome — not sharing this function there is correct, not an
/// oversight.)
///
/// Every one of the four callers shares this shape — `prop_recursive(3, 8, 3, …)` over five arms: `+`,
/// `-`, a `>` comparison, an `==` comparison, and a three-argument `if`. Callers differ ONLY in what a
/// leaf is: a wide range, a narrow one, or a mix. That is deliberate. Several tests compare results
/// across backends and encodings, and those comparisons only mean something if the programs are drawn
/// from the same distribution shape — four copies of this that could drift independently made a claim
/// nothing enforced.
///
/// DO NOT change the recursion parameters or the arm set without re-measuring every caller that
/// records a rate or a fire count against them. `binary_tm_agrees_while_unary_tm_is_never_wrong_on_
/// random_programs` (in `redextape-native`) documents a measured 60.4% unary fire rate that is a
/// property of THIS shape combined with its leaf strategy. The stronger stake is `redextape-core`'s
/// `three_way_oracle.rs` (`arb_tm_safe_expr`'s doc): its whole `MAX_FIELD_WIDTH`-safety argument — every
/// generated value staying under the TM's fixed-width unary fields — rests on `depth=3` (this
/// function's `prop_recursive` first argument, not `desired_size`) bounding the worst case, measured at
/// a max of 27 over 2M samples. Raising the depth here silently raises that worst case too.
pub fn arb_expr_over(leaf: impl Strategy<Value = String> + 'static) -> impl Strategy<Value = String> {
    leaf.prop_recursive(3, 8, 3, |inner| {
        prop_oneof![
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} + {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} - {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} > {b} {{ 1 }} else {{ 0 }}")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} == {b} {{ 1 }} else {{ 0 }}")),
            (inner.clone(), inner.clone(), inner).prop_map(|(c, a, b)| format!("if {c} > 0 {{ {a} }} else {{ {b} }}")),
        ]
    })
}
