//! The machine code listing over the snapshot corpus, on each target the build has and both listings: its rows
//! cover each function's bytes, every byte decodes, every relocation is named on its row, and every pc a row
//! carries is one a clif row of the same listing carries.

// Test target: a failure IS the report, so panicking is deliberate, as in `redextape-clif`'s tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
#![cfg(any(feature = "x86", feature = "arm64"))]

use std::collections::BTreeSet;
use std::path::PathBuf;

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{Program, lower_program, parse_rxm};
use redextape_mc::{McListing, McRowKind, Target, machine_listing};
use redextape_native::{Listing, build_listing, machine_code};

const SNAPSHOT_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../redextape-native/snapshots");

/// Every snapshot's program with its key, read back from its header as `redextape-clif`'s tests read it.
fn corpus() -> Vec<(String, Program)> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(SNAPSHOT_DIR)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "clif"))
        .collect();
    paths.sort();
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
            (key, prog)
        })
        .collect()
}

const TARGETS: &[Target] = &[
    #[cfg(feature = "x86")]
    Target::X86_64,
    #[cfg(feature = "arm64")]
    Target::Arm64,
];
const LISTINGS: [Listing; 2] = [Listing::AsBuilt, Listing::Optimised];

fn each(mut check: impl FnMut(&str, &Program, Target, Listing, &McListing)) {
    for (key, prog) in corpus() {
        for &target in TARGETS {
            for listing in LISTINGS {
                let rows = machine_listing(&prog, listing, target).unwrap();
                check(&key, &prog, target, listing, &rows);
            }
        }
    }
}

#[test]
fn the_rows_cover_each_functions_bytes_in_order() {
    each(|key, prog, target, listing, rows| {
        let funcs = machine_code(prog, listing, target.triple()).unwrap();
        assert_eq!(rows.functions.len(), funcs.len(), "{key}");
        for (k, func) in funcs.iter().enumerate() {
            assert_eq!(rows.functions[k].size as usize, func.bytes.len(), "{key}");
            let insts: Vec<_> =
                rows.rows.iter().filter(|r| r.kind == McRowKind::Inst && r.function as usize == k).collect();
            let mut at = 0;
            let mut hex = String::new();
            for row in &insts {
                assert_eq!(row.offset, at, "{key} {target:?} {listing:?} u{k}: a gap or an overlap");
                at += u32::try_from(row.bytes.len() / 2).unwrap();
                hex.push_str(&row.bytes);
            }
            let want: String = func.bytes.iter().map(|b| format!("{b:02x}")).collect();
            assert_eq!(hex, want, "{key} {target:?} {listing:?} u{k}");
            let first = rows.functions[k].first_row as usize;
            assert_eq!(rows.rows[first].kind, McRowKind::Function, "{key}");
        }
    });
}

/// No row the decoder refused, and no zeros decoded as code, which no refusal shows since `00 00` decodes (x86-64's
/// `addb %al, (%rax)`): no instruction Cranelift emits for the corpus is all zeros.
#[test]
fn every_byte_of_the_corpus_decodes_and_no_zeros_read_as_code() {
    let mut wrong = Vec::new();
    each(|key, _, target, listing, rows| {
        for row in rows.rows.iter().filter(|r| r.kind == McRowKind::Inst) {
            let refused = row.text.starts_with(".byte") || row.text.starts_with(".inst");
            let zeros_as_code = !row.text.starts_with('.') && row.bytes.bytes().all(|b| b == b'0');
            if refused || zeros_as_code {
                wrong.push(format!("{key} {target:?} {listing:?} u{} {:04x}: {}", row.function, row.offset, row.text));
            }
        }
    });
    assert!(wrong.is_empty(), "{} rows:\n{}", wrong.len(), wrong.join("\n"));
}

#[test]
fn every_relocation_is_named_on_its_row_and_every_direct_call_has_one() {
    each(|key, prog, target, listing, rows| {
        let funcs = machine_code(prog, listing, target.triple()).unwrap();
        for (k, func) in funcs.iter().enumerate() {
            for reloc in &func.relocs {
                let row = rows
                    .rows
                    .iter()
                    .find(|r| {
                        r.kind == McRowKind::Inst
                            && r.function as usize == k
                            && r.offset <= reloc.offset
                            && reloc.offset < r.offset + u32::try_from(r.bytes.len() / 2).unwrap()
                    })
                    .unwrap();
                assert!(
                    row.callee.as_deref().is_some_and(|c| c.starts_with(&format!("u0:{} ", reloc.callee))),
                    "{key}"
                );
            }
        }
        for row in &rows.rows {
            let call = row.text.starts_with("callq ") || row.text.starts_with("bl ") || row.text.starts_with("blr ");
            assert!(!call || row.callee.is_some(), "{key} {target:?}: {} names nothing", row.text);
        }
    });
}

#[test]
fn every_pc_a_row_carries_is_a_clif_rows() {
    each(|key, prog, target, listing, rows| {
        let clif = build_listing(prog, listing).unwrap();
        for (k, func) in clif.iter().enumerate() {
            let pcs: BTreeSet<u32> = func
                .layout
                .blocks()
                .flat_map(|b| func.layout.block_insts(b))
                .map(|inst| func.srcloc(inst))
                .filter(|loc| !loc.is_default())
                .map(|loc| loc.bits())
                .collect();
            for row in rows.rows.iter().filter(|r| r.function as usize == k) {
                if let Some(pc) = row.pc {
                    assert!(pcs.contains(&pc), "{key} {target:?} {listing:?}: pc{pc} is on no clif row of u{k}");
                }
            }
        }
    });
}

#[test]
fn x86_rows_have_both_syntaxes_and_arm64_rows_one() {
    each(|key, _, target, _, rows| {
        for row in rows.rows.iter().filter(|r| r.kind == McRowKind::Inst) {
            assert_eq!(row.intel.is_some(), target.name() == "x86-64", "{key}: {}", row.text);
        }
    });
}

/// A listing's target serialises as the string its package's `target()` export returns, `Target::name`'s, so a page
/// can compare the two.
#[test]
fn a_listings_target_serialises_as_its_packages_target_export() {
    let (key, prog) = corpus().swap_remove(0);
    for &target in TARGETS {
        let rows = machine_listing(&prog, Listing::AsBuilt, target).unwrap();
        assert_eq!(serde_json::to_value(rows.target).unwrap(), serde_json::json!(target.name()), "{key}");
    }
}
