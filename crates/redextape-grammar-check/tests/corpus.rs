#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_grammar_check::MINI;
use redextape_grammar_check::mini::CORPUS;

/// PROMOTED to `Grammar::every_corpus_program_parses_without_error_nodes` — this test and λ's
/// identically-named one in `tests/lambda.rs` were duplicated verbatim, and neither reads anything
/// grammar-specific beyond `self`. See `src/grammar.rs` for the shared implementation.
#[test]
fn every_corpus_program_parses_without_error_nodes() {
    if let Err(why) = MINI.every_corpus_program_parses_without_error_nodes(CORPUS) {
        panic!("{why}");
    }
}
