#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_grammar_check::MINI;
use redextape_grammar_check::mini::CORPUS;

/// Runs `Grammar::every_corpus_program_parses_without_error_nodes`, which reads nothing
/// grammar-specific beyond `self`. See `src/grammar.rs` for the shared implementation.
#[test]
fn every_corpus_program_parses_without_error_nodes() {
    if let Err(why) = MINI.every_corpus_program_parses_without_error_nodes(CORPUS) {
        panic!("{why}");
    }
}
