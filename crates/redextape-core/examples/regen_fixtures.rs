//! Regenerates the checked-in `.tm` fixtures `tests/tm_header.rs` pins against.
//!
//! This used to be `#[ignore]`d test `regenerate_fixture` inside `tests/tm_header.rs` itself. That was
//! miscategorised: `scripts/check-slow.sh` runs `cargo test --release --workspace -- --ignored`, which
//! selects *every* ignored test regardless of its reason string, so the "slow tier" job — whose whole
//! purpose is verification — silently rewrote a checked-in source file on every run. Under `--all` it
//! was worse: the regenerator and the drift check (`the_fixture_is_what_the_compiler_emits_today`)
//! shared a binary, so if the regenerator ran first the drift check compared the fixture against a file
//! it had just written and passed unconditionally. A function that asserts nothing and writes to the
//! source tree is not a test, so it lives here instead, run only when a developer deliberately asks:
//!
//!     cargo run --example regen_fixtures -p redextape-core
//!
//! Regenerates BOTH fixtures — do not add a second `#[ignore]`d writer for a new one; extend the list
//! below instead.

// Example target: a demo that cannot build its own input has nothing to demonstrate, so aborting is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` do not reach example targets at all.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{DescribedRun, EncodingKind, TM_DEFAULT_CAPS, print_tm_with, run_tm_described};
use redextape_core::ty::Ty;
use redextape_core::typeck::result_type;

/// Parse, typecheck and desugar `src`, returning the `Core` and its top-level type together — mirrors
/// the identical helper in `tests/tm_header.rs`.
fn core_and_ty(src: &str) -> (Core, Ty) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let prog = prog.expect("a program");
    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
    (desugar(&prog), ty)
}

fn described(src: &str, kind: EncodingKind) -> DescribedRun {
    let (core, ty) = core_and_ty(src);
    run_tm_described(&core, kind, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src} did not run: {r:?}"))
}

/// Compile `src` under `kind` and write the self-describing text to `relative_path` (under this
/// crate's manifest directory), printing the path so the developer sees what changed.
fn write_fixture(src: &str, kind: EncodingKind, relative_path: &str) {
    let d = described(src, kind);
    let path = format!("{}/{relative_path}", env!("CARGO_MANIFEST_DIR"));
    std::fs::write(&path, print_tm_with(&d.machine, &d.header)).unwrap_or_else(|e| panic!("write {path}: {e}"));
    println!("wrote {path}");
}

fn main() {
    // The unary fixture: `Unary::init_work()` is empty, so this one carries no `tape 1` line.
    write_fixture("cons(1, cons(2, nil))", EncodingKind::Unary, "tests/fixtures/list_1_2.tm");
    // The binary fixture: `Binary::init_work()` lays out a real `#`-delimited bank, so this is the one
    // that exercises a `tape 1` line round-tripping through an actual file.
    write_fixture("cons(1, cons(2, nil))", EncodingKind::Binary, "tests/fixtures/list_1_2_binary.tm");
}
