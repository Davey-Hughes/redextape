//! Holds the tree-sitter grammars to the hand-written front end.
//!
//! **A TEST-ONLY CRATE, and that is why it is a crate.** The natural home for this would be a module
//! inside `redextape-core`, but that would put `tree-sitter` and a C `build-dependency` in the
//! manifest of the crate whose whole identity is being WASM-clean. `redextape-test-support` exists
//! for the same reason and states it the same way.
//!
//! **NOTHING HERE MAY LOWER A CST.** The roadmap's tree-sitter entry permits a highlighting-only
//! lane and forbids a second authoritative grammar; its test for "authoritative" is lowering. A
//! tree-sitter node reaching a `redextape_core` AST type is the line this crate must not cross.

pub mod grammar;
pub mod lambda;
pub mod mini;

pub use grammar::{Grammar, compare_classified};
pub use lambda::LAMBDA;
pub use mini::MINI;
