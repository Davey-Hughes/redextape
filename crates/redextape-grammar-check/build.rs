//! Compiles the committed generated parsers into this crate.
//!
//! The C is a BUILD ARTIFACT CHECKED INTO GIT, which is the tree-sitter convention and the reason
//! `scripts/check-all.sh` carries a `grammar` leg: nothing here can tell whether `parser.c` was
//! generated from the `grammar.js` sitting beside it, so a separate gate regenerates and diffs.

use std::path::Path;

fn main() {
    // `env!("CARGO_MANIFEST_DIR")` over the relative `../../grammars/...` path the brief sketched:
    // cargo does run build scripts with the working directory set to the package root, so the
    // relative form would resolve too, but this is correct regardless of how the build is invoked
    // (a workspace-relative `-p`, a vendored path) rather than depending on that one guarantee. It
    // is a compile-time env lookup (cargo always sets it for a build script), not a runtime
    // `std::env::var` that could fail and need an `unwrap`/`expect` this crate's lints forbid.
    let dir = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../grammars/tree-sitter-redextape/src"));
    cc::Build::new()
        .include(dir)
        .file(dir.join("parser.c"))
        // The generated C is not ours to keep warning-clean, and its warnings would drown the
        // workspace's own under `-D warnings`.
        .warnings(false)
        .compile("tree-sitter-redextape");
    println!("cargo:rerun-if-changed={}", dir.join("parser.c").display());
}
