//! Calibrate the surface printer's break rules against real `rustfmt`.
//!
//! A PROBE, NOT A TEST. rustfmt's output changes between toolchain releases, so gating CI on it would
//! buy a flake in exchange for a property we only need to establish once. Run it by hand when the
//! layout rules change:
//!
//!     cargo run -p redextape-core --example rustfmt_calibration_probe
//!
//! For each case it prints our output beside rustfmt's output for the equivalent Rust, so the shapes
//! can be compared by eye. It asserts nothing — the report is the deliverable.
//!
//! **MEASURED 2026-08-19, rustfmt 1.9.0-stable (8bab26f4f6 2026-07-14):**
//!   1. long short-element array: filled  (agrees)
//!   2. switch point: 10  (`SHORT_ELEMENT` = 10 agrees — the "array at the short-element boundary (10)"
//!      / "array just past it (11)" pair above straddles it directly: width 10 fills, width 11 breaks
//!      one-per-line, on both sides)
//!   3. trailing comma: fill yes, vertical yes  (fill DIFFERED — printer had no trailing comma in fill
//!      mode; fixed in `fill_rows`)
//!   4. method chain: broke at every `.`  (agrees — the "method chain long enough to break" case above,
//!      matching the printer's own pinned unit test `a_long_method_chain_breaks_one_link_per_line`
//!      (`.filter(|a_long_parameter| a_long_parameter > 2)` x5), breaks at every link on both sides.
//!      The original "method chain" case above stays 105 columns wide at its `let _ = ` indent, under
//!      the 120 budget, so it never exercised the break rule; kept alongside the new case as a "stays
//!      inline" contrast.)
//!
//! A FIFTH finding, outside the four numbered questions but squarely inside the "long argument list"
//! case above: Task 6's `bracketed` rule was "rustfmt packs short elements in an array literal but
//! NEVER in an argument list" — the case's own rustfmt output filled the 11-argument call instead of
//! breaking it one-per-line, at the identical `SHORT_ELEMENT`-based 10/11 threshold as arrays (checked
//! directly, both boundary widths). That recollection was wrong for this project's
//! `use_small_heuristics = "Max"`, and is now DIFFERED and fixed: `bracketed` uses one fill rule for
//! both lists and argument lists, and `allow_fill` — no longer a real difference between the two
//! callers — is gone rather than kept as a vestige.
//!
//! Binary expressions are excluded from this probe's authority by design (see `printer.rs`'s
//! `binary_chain` doc) — rustfmt breaks long binary chains and this printer deliberately does not; no
//! case above exercises that shape.

// Probe target: a probe that cannot run its own subprocess has nothing to report, so panicking is the
// useful behaviour here. Matches every other `examples/*_probe.rs` in this crate.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::Write;
use std::process::{Command, Stdio};

use redextape_core::parser::parse_full;
use redextape_core::printer::print;

/// Each case is (label, mini-language source, equivalent Rust expression body).
///
/// The Rust side is written by hand rather than translated, because the point is to compare LAYOUT
/// DECISIONS on equivalent shapes, not to build a transpiler.
const CASES: &[(&str, &str, &str)] = &[
    ("short list", "[1, 2, 3]", "fn main() { let _ = [1, 2, 3]; }"),
    (
        "long list of short elements",
        "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40]",
        "fn main() { let _ = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40]; }",
    ),
    // Boundary pair for `SHORT_ELEMENT` (printer.rs's constant, currently 10): 12 identifiers of width
    // W, one repeated letter each (a..l). Inline length = 2 (brackets) + 12*W (elements) + 11*2 (", "
    // separators). At W=10: 2 + 120 + 22 = 144; at W=11: 2 + 132 + 22 = 156. Both exceed MAX_WIDTH
    // (120), so both must break — the boundary under test is only in HOW they break (fill vs
    // one-per-line), which is exactly the question the disclaimed reading needed answered.
    (
        "array at the short-element boundary (10)",
        "[aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, gggggggggg, hhhhhhhhhh, iiiiiiiiii, jjjjjjjjjj, kkkkkkkkkk, llllllllll]",
        "fn main() { let _ = [aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, gggggggggg, hhhhhhhhhh, iiiiiiiiii, jjjjjjjjjj, kkkkkkkkkk, llllllllll]; }",
    ),
    (
        "array just past it (11)",
        "[aaaaaaaaaaa, bbbbbbbbbbb, ccccccccccc, ddddddddddd, eeeeeeeeeee, fffffffffff, ggggggggggg, hhhhhhhhhhh, iiiiiiiiiii, jjjjjjjjjjj, kkkkkkkkkkk, lllllllllll]",
        "fn main() { let _ = [aaaaaaaaaaa, bbbbbbbbbbb, ccccccccccc, ddddddddddd, eeeeeeeeeee, fffffffffff, ggggggggggg, hhhhhhhhhhh, iiiiiiiiiii, jjjjjjjjjjj, kkkkkkkkkkk, lllllllllll]; }",
    ),
    (
        "list of wide elements",
        "[a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name]",
        "fn main() { let _ = [a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name, a_rather_long_name]; }",
    ),
    (
        "long argument list",
        "f(aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, gggggggggg, hhhhhhhhhh, iiiiiiiiii, jjjjjjjjjj, kkkkkkkkkk)",
        "fn main() { f(aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, gggggggggg, hhhhhhhhhh, iiiiiiiiii, jjjjjjjjjj, kkkkkkkkkk); }",
    ),
    (
        "method chain",
        "xs.map(|x| x + 1).filter(|x| x > 2).fold(0, |a, b| a + b).map(|x| x * 2).filter(|x| x > 100)",
        "fn main() { let _ = xs.map(|x| x + 1).filter(|x| x > 2).fold(0, |a, b| a + b).map(|x| x * 2).filter(|x| x > 100); }",
    ),
    // Same shape as the printer's pinned unit test `a_long_method_chain_breaks_one_link_per_line`:
    // `xs` (2) plus five copies of `.filter(|a_long_parameter| a_long_parameter > 2)` (48 columns
    // each) = 2 + 5*48 = 242 columns, roughly double MAX_WIDTH (120). Unlike the "method chain" case
    // above (105 columns, stays inline on both sides), this cannot fit inline either way, so it
    // actually exercises the break rule.
    (
        "method chain long enough to break",
        "xs.filter(|a_long_parameter| a_long_parameter > 2).filter(|a_long_parameter| a_long_parameter > 2).filter(|a_long_parameter| a_long_parameter > 2).filter(|a_long_parameter| a_long_parameter > 2).filter(|a_long_parameter| a_long_parameter > 2)",
        "fn main() { let _ = xs.filter(|a_long_parameter| a_long_parameter > 2).filter(|a_long_parameter| a_long_parameter > 2).filter(|a_long_parameter| a_long_parameter > 2).filter(|a_long_parameter| a_long_parameter > 2).filter(|a_long_parameter| a_long_parameter > 2); }",
    ),
    (
        "blank lines and comments",
        "// lead\nlet a = 1;\n\n\n// two blanks above collapse to one\nlet b = 2; // trailing\nb",
        "fn main() {\n// lead\nlet a = 1;\n\n\n// two blanks above collapse to one\nlet b = 2; // trailing\nb\n}",
    ),
];

fn rustfmt(src: &str) -> String {
    let mut child = Command::new("rustfmt")
        .args(["--edition", "2024", "--config", "max_width=120,use_small_heuristics=Max"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("rustfmt is on PATH (it is a rust-toolchain.toml component)");
    child.stdin.as_mut().expect("stdin").write_all(src.as_bytes()).expect("write");
    let out = child.wait_with_output().expect("rustfmt runs");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn main() {
    for (label, ours_src, rust_src) in CASES {
        println!("\n=== {label} ===");
        let (parsed, diags) = parse_full(ours_src);
        match parsed {
            Some(p) => println!("--- redextape ---\n{}", print(&p)),
            None => println!("--- redextape --- DID NOT PARSE: {diags:?}"),
        }
        println!("--- rustfmt ---\n{}", rustfmt(rust_src));
    }
    println!(
        "\nCompare the SHAPES, not the syntax. What to check:\n\
         1. does rustfmt fill the long short-element array, or break it one-per-line?\n\
         2. at what element width does it switch (SHORT_ELEMENT is set to 10)?\n\
         3. does it add a trailing comma in fill mode? in vertical mode?\n\
         4. does it break the method chain, and at which `.`?\n\
         Any disagreement is a change to printer.rs's rules, not to this probe."
    );
}
