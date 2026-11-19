// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
//! The CLIF listing's rows: Cranelift's own text for each function, a row per line, with each srcloc moved
//! to a decimal pc column.

// Each test target uses its own part of the shared helpers.
#[allow(dead_code)]
mod common;

use common::corpus;
use cranelift_codegen::ir::{Function, Inst};
use redextape_clif::{ClifAt, ClifListing, ClifRow, ClifRowKind, listing};
use redextape_core::tm::Program;
use redextape_native::analysis::partition;
use redextape_native::{Listing, build_listing};

const LISTINGS: [Listing; 2] = [Listing::AsBuilt, Listing::Optimised];

/// `prog` built as `which`, and its listing under `partition`'s names.
fn built(prog: &Program, which: Listing) -> (Vec<Function>, ClifListing) {
    let funcs = build_listing(prog, which).unwrap();
    let names: Vec<String> = partition(prog).unwrap().into_iter().map(|sub| sub.name).collect();
    let rows = listing(&funcs, &names);
    (funcs, rows)
}

/// Function `i`'s rows: from its first row up to the next function's, or to the end.
fn rows_of(listing: &ClifListing, i: usize) -> &[ClifRow] {
    let end = listing.functions.get(i + 1).map_or(listing.rows.len(), |next| next.first_row);
    &listing.rows[listing.functions[i].first_row..end]
}

/// `rows` written back as Cranelift prints them: `indent` columns, the first six holding `@{pc:04x} ` where
/// `pc` is set, then the text and a newline.
fn restored(rows: &[ClifRow]) -> String {
    let mut out = String::new();
    for row in rows {
        let indent = usize::from(row.indent);
        match row.pc {
            Some(pc) => out.push_str(&format!("@{pc:04x} {:1$}", "", indent.saturating_sub(6))),
            None => out.push_str(&" ".repeat(indent)),
        }
        out.push_str(&row.text);
        out.push('\n');
    }
    out
}

#[test]
fn rows_restored_equal_the_display() {
    for (key, prog) in corpus() {
        for which in LISTINGS {
            let (funcs, listing) = built(&prog, which);
            assert_eq!(listing.functions.len(), funcs.len(), "{key} {}", which.name());
            assert_eq!(listing.functions[0].first_row, 0, "{key} {}", which.name());
            for (i, func) in funcs.iter().enumerate() {
                assert_eq!(
                    restored(rows_of(&listing, i)),
                    func.display().to_string(),
                    "{key} {} {}",
                    which.name(),
                    func.name
                );
            }
        }
    }
}

#[test]
fn every_instruction_has_one_row() {
    for (key, prog) in corpus() {
        for which in LISTINGS {
            let (funcs, listing) = built(&prog, which);
            for (i, func) in funcs.iter().enumerate() {
                let rows = rows_of(&listing, i);
                let insts: Vec<Option<ClifAt>> = func
                    .layout
                    .blocks()
                    .flat_map(|block| func.layout.block_insts(block))
                    .map(|inst| Some(ClifAt { function: i as u32, inst: inst.as_u32() }))
                    .collect();
                let shown: Vec<Option<ClifAt>> =
                    rows.iter().filter(|row| row.kind == ClifRowKind::Inst).map(|row| row.at).collect();
                assert_eq!(shown, insts, "{key} {} {}", which.name(), func.name);
                for row in rows {
                    let want = match row.at {
                        Some(at) => {
                            let loc = func.srcloc(Inst::from_u32(at.inst));
                            (!loc.is_default()).then(|| loc.bits())
                        }
                        None => None,
                    };
                    assert_eq!(row.pc, want, "{key} {} {}: {row:?}", which.name(), func.name);
                    assert_eq!(row.at.is_some(), row.kind == ClifRowKind::Inst, "{key} {}: {row:?}", which.name());
                }
            }
        }
    }
}

#[test]
fn sum_to_reads_as_its_snapshot() {
    use ClifRowKind::{Alias, Blank, Block, Close, Decl, Function, Inst};
    let (_, prog) = corpus().into_iter().find(|(key, _)| key == "example-sum-to").unwrap();
    let (_, listing) = built(&prog, Listing::AsBuilt);
    let functions: Vec<(&str, &str, usize)> =
        listing.functions.iter().map(|f| (f.name.as_str(), f.label.as_str(), f.first_row)).collect();
    assert_eq!(functions, [("u0:11", "$main", 0), ("u0:12", "sum_to.0", 63)]);
    let shown = |row: &ClifRow| (row.kind, row.indent, row.pc, row.text.clone());
    assert_eq!(shown(&listing.rows[0]), (Function, 0, None, "function u0:11(i64) -> i64 system_v {".to_string()));
    let at_20: Vec<usize> = (0..listing.rows.len()).filter(|&i| listing.rows[i].pc == Some(20)).collect();
    assert_eq!(at_20.len(), 2, "{at_20:?}");
    let around: Vec<_> = listing.rows[at_20[0] - 1..=at_20[1]].iter().map(shown).collect();
    assert_eq!(
        around,
        [
            (Block, 32, None, "block2:".to_string()),
            (Inst, 36, Some(20), "v4 = iconst.i64 5".to_string()),
            (Alias, 36, None, "v5 -> v4".to_string()),
            (Alias, 36, None, "v7 -> v4".to_string()),
            (Inst, 36, Some(20), "jump block3".to_string()),
        ]
    );
    assert_eq!(shown(&listing.rows[62]), (Close, 0, None, "}".to_string()));
    // The rows the lines above do not reach: the declarations, the blank lines, and a block parameter's
    // alias, which `decorate_function` writes itself.
    let tally: Vec<usize> = [Function, Decl, Blank, Block, Inst, Alias, Close]
        .into_iter()
        .map(|kind| listing.rows[..63].iter().filter(|row| row.kind == kind).count())
        .collect();
    assert_eq!(tally, [1, 26, 8, 8, 16, 3, 1]);
    let block0 = 63 + listing.rows[63..].iter().position(|row| row.text == "block0(v0: i64, v1: i64):").unwrap();
    assert_eq!(shown(&listing.rows[block0 + 1]), (Alias, 36, None, "v16 -> v1".to_string()));
}
