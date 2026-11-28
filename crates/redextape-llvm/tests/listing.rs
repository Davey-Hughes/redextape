//! The LLVM IR listing over the snapshot corpus: its lines are the snapshot's built module, each function's
//! first line is its `define`, and every pc a line carries is an instruction of that function's subroutine.

// Test target: a failure IS the report, so panicking is deliberate, as in `redextape-clif`'s tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::path::PathBuf;

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{Program, lower_program, parse_rxm};
use redextape_llvm::{LlvmInput, llvm_listing};
use redextape_native::analysis::partition;

const SNAPSHOT_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../redextape-native/snapshots");
const BUILT: &str = ";; ==== built: O0 O1 O2 O3 ====\n";

/// Every `.ll` snapshot's key, program and built module, the program read back from its header as
/// `redextape-clif`'s tests read it.
fn corpus() -> Vec<(String, Program, String)> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(SNAPSHOT_DIR)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "ll"))
        .filter(|path| !path.to_string_lossy().ends_with(".opt.ll"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no .ll snapshots in {SNAPSHOT_DIR}");
    paths
        .iter()
        .map(|path| {
            let text = std::fs::read_to_string(path).unwrap();
            let mut lines = text.lines();
            let key = lines.next().and_then(|line| line.strip_prefix(";; ")).unwrap().to_string();
            assert_eq!(lines.next(), Some(";; source:"), "{key}: no source marker");
            let mut src = String::new();
            for line in lines.take_while(|line| !line.starts_with(";; ==== ")) {
                src.push_str(if line == ";;" { "" } else { line.strip_prefix(";;   ").unwrap() });
                src.push('\n');
            }
            let prog = if key.starts_with("rxm-") {
                parse_rxm(&src).0.unwrap()
            } else {
                lower_program(&desugar(&parse(&src).0.unwrap())).unwrap()
            };
            let at = text.find(BUILT).unwrap_or_else(|| panic!("{key}: no built section"));
            let built = &text[at + BUILT.len()..];
            let built = built.find("\n;; ==== ").map_or(built, |end| &built[..=end]);
            (key, prog, built.to_string())
        })
        .collect()
}

#[test]
fn every_listing_is_its_snapshots_built_module() {
    for (key, prog, built) in corpus() {
        let listing = llvm_listing(&prog).unwrap();
        let text: String = listing.lines.iter().map(|line| format!("{}\n", line.text)).collect();
        assert_eq!(text, built, "{key}");
    }
}

#[test]
fn each_function_starts_at_its_define_and_marks_only_its_own_pcs() {
    for (key, prog, _) in corpus() {
        let listing = llvm_listing(&prog).unwrap();
        let subs = partition(&prog).unwrap();
        assert_eq!(listing.functions.len(), subs.len(), "{key}");
        let mut marked = 0;
        for (k, (function, sub)) in listing.functions.iter().zip(&subs).enumerate() {
            assert_eq!(function.label, sub.name, "{key}");
            let first = function.first_line as usize;
            let define = &listing.lines[first].text;
            assert!(
                define.starts_with("define ") && define.contains(&format!("@{}(", function.name)),
                "{key}: {define}"
            );
            let end = listing.functions.get(k + 1).map_or(listing.lines.len(), |next| next.first_line as usize);
            for line in &listing.lines[first..end] {
                if let Some(pc) = line.pc {
                    assert!(sub.body.contains(&(pc as usize)), "{key}: pc {pc} is not in {}", sub.name);
                    marked += 1;
                }
            }
        }
        assert!(marked > 0, "{key}: no line carries a pc");
    }
}

/// The package takes the `clifInput()` value, of which it reads the program alone.
#[test]
fn an_input_is_read_for_its_program_alone() {
    let (_, prog, _) = corpus().into_iter().next().unwrap();
    let json = serde_json::json!({ "program": prog, "ty": "unary", "caps": null });
    let input: LlvmInput = serde_json::from_value(json).unwrap();
    assert_eq!(input.program, prog);
}
