//! Helpers the native crate's integration tests share.

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;

/// Parse + desugar `src` to Core, panicking on a parse error (every demo string its
/// callers pass is known-good).
pub fn core_of(src: &str) -> Core {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for `{src}`: {ds:?}");
    desugar(&prog.unwrap())
}
