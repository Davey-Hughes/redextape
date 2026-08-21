#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_grammar_check::{CORPUS, error_nodes, parse};

#[test]
fn every_corpus_program_parses_without_error_nodes() {
    for (name, src) in CORPUS {
        let tree = parse(src).expect("the pinned ABI must load");
        let errors = error_nodes(&tree);
        assert!(errors.is_empty(), "`{name}` produced ERROR/MISSING nodes at {errors:?}");
    }
}
