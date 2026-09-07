//! `redextape-lsp` calls `redextape_core::tm::parse_tm_nav` and `redextape_core::tm::parse_asm_nav`
//! by those exact paths. `tm/syntax.rs` and `tm/asm_syntax.rs`'s own unit tests reach both through
//! `super::*`, which is true whether or not `tm.rs`'s `pub use` list names the function — so nothing
//! inside `redextape-core` can catch a missing re-export. An integration test, compiled as a
//! separate crate that can only see the crate's public surface, is what can.

#[test]
fn the_nav_entry_points_are_reachable_from_outside_the_crate() {
    let (_doc, nav) = redextape_core::tm::parse_tm_nav("tapes 1\nstart q0\nstate q0: accept\n");
    assert_eq!(nav.definitions().count(), 1);
    let (_doc, nav) = redextape_core::tm::parse_asm_nav("f:\n\tret\n");
    assert_eq!(nav.definitions().count(), 1);
}
