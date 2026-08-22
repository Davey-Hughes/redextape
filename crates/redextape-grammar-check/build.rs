//! Compiles the committed generated parsers into this crate.
//!
//! The C is a BUILD ARTIFACT CHECKED INTO GIT, which is the tree-sitter convention and the reason
//! `scripts/check-all.sh` carries a `grammar` leg: nothing here can tell whether `parser.c` was
//! generated from the `grammar.js` sitting beside it, so a separate gate regenerates and diffs.
//!
//! ONE `cc::Build` PER GRAMMAR, EACH WITH ITS OWN LIBRARY NAME. Two invocations that `.compile()` to
//! the same output name silently produce one library holding whichever grammar's object file won;
//! the other parser's `tree_sitter_*` symbol is simply absent, and that surfaces at link time as an
//! undefined reference in a downstream crate, not as a build-script error here.

use std::path::Path;

// The library name IS the grammar directory name — `cc::Build::compile` just needs a name to give
// the output archive, and there is no reason for that name to ever differ from the directory it was
// built from. A second parameter here could only ever drift from its twin, silently, so there is one.
fn compile_grammar(name: &str) {
    let dir = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../grammars")).join(name).join("src");
    cc::Build::new()
        .include(&dir)
        .file(dir.join("parser.c"))
        // The generated C is not ours to keep warning-clean, and its warnings would drown the
        // workspace's own under `-D warnings`.
        .warnings(false)
        .compile(name);
    println!("cargo:rerun-if-changed={}", dir.join("parser.c").display());
}

fn main() {
    // `env!("CARGO_MANIFEST_DIR")` over the relative `../../grammars/...` path the brief sketched:
    // cargo does run build scripts with the working directory set to the package root, so the
    // relative form would resolve too, but this is correct regardless of how the build is invoked
    // (a workspace-relative `-p`, a vendored path) rather than depending on that one guarantee. It
    // is a compile-time env lookup (cargo always sets it for a build script), not a runtime
    // `std::env::var` that could fail and need an `unwrap`/`expect` this crate's lints forbid.
    compile_grammar("tree-sitter-redextape");
    compile_grammar("tree-sitter-redextape-lambda");
}
