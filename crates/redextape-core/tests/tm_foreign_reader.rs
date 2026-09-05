//! A FOREIGN reader: an independent simulator and an independent decoder, written from the
//! documentation rather than from the implementation.
//!
//! WHY THIS EXISTS. The header's whole claim is that a `.tm` file can be RUN by any simulator and,
//! given the encoding's semantics, INTERPRETED. Every other test in this tree checks that claim with
//! OUR simulator and OUR decoder, which share every assumption the writer had — so they can only show
//! that the code round-trips against itself.
//!
//! THE DISCIPLINE THIS TEST DEPENDS ON, stated because it is invisible in the finished code: the
//! simulator and decoder below were written from the DOC COMMENTS in `tm/syntax.rs`, `tm/machine.rs`
//! and `tm/encoding/unary.rs` — never by reading their bodies. A decoder copied from the
//! implementation would prove nothing about whether the format is documented well enough to
//! reimplement. If you change this file, hold that line. `tm/header.rs`'s module doc was also read (it
//! is cross-referenced BY `syntax.rs`'s own module doc: "see `tm::header`'s module doc for why that
//! lives on the side rather than on `Machine`"), but only its doc comments and public field/struct
//! docs — never `directive`'s parsing body. `sim.rs`, `unary.rs`'s gadget bodies (everything below its
//! module doc), and `decode.rs` were never opened.
//!
//! WHAT IT SHARPENS. The spec recorded the limit as "a foreign tool cannot INTERPRET its result."
//! What is actually true is narrower and more useful: the FILE does not carry the encoding's
//! semantics, so a reader needs the spec — and a decoder written from that spec works. This test is
//! that claim, made falsifiable.
//!
//! WHAT THE SPEC DID NOT COVER WHEN THIS WAS WRITTEN — the primary deliverable of this file. **All
//! three were closed by commit 51ab55a, immediately after; they are kept here because the record of
//! what a documentation test FOUND is the reason to keep running one.**
//!
//! 1. `unary.rs`'s module doc documented ONLY the scalar register-field encoding. It said nothing
//!    about how a compound value (this fixture's result is `List<Nat>`) is represented once it no
//!    longer fits one field — no heap tape, no cons-cell tag, no pointer convention. *Closed:*
//!    `unary.rs`'s module doc now covers the compound case (HEAP by index, 1-based pointers, `nil = 0`,
//!    `@ <head> # <tail>`, and that head/tail words are variable-length mark runs rather than
//!    fixed-width fields).
//! 2. Neither `unary.rs` nor `machine.rs` named the literal character for `MARK`, though `machine.rs`
//!    pins `BLANK` as `'_'`. *Closed:* `build.rs`'s symbol doc now names `MARK` as `1`, beside `BLANK`
//!    and `SEP`.
//! 3. `TmHeader::result`'s doc said "The type the final tape decodes to" — wrong for this very
//!    fixture, where `tapes 5` makes tape 4 the final one and the simulator below shows it never
//!    leaves its single blank cell. The result is REG (tape 0) field 0 read as a pointer, chased
//!    through tape 3. *Closed:* that doc now says so explicitly and no longer says "final tape".
//!
//! **THE RESIDUAL, WHICH THOSE FIXES DO NOT REMOVE AND WHICH THIS FILE MUST NOT BE READ AS CLOSING.**
//! `decode_unary_heap` below took its `@ head # tail` layout **from the out-of-band task instructions
//! given to whoever wrote it, not from a doc comment** — and the docs that now describe that layout
//! were written afterwards, partly informed by those same instructions. So no independent implementer
//! has re-derived the heap format from the corrected documentation, and **this test does not establish
//! that one could.** What it establishes today is narrower than its own title suggests: the SCALAR
//! register-field decode is doc-derivable (that half
//! was genuinely reconstructed from `unary.rs`'s original three lines), and the run semantics are
//! (tape count, head start, two-way growth, halt-on-no-rule, wildcards, first-match-wins). The
//! compound decode is *asserted* to be doc-derivable and *not yet demonstrated*. Re-deriving it from
//! HEAD's docs, by someone who never saw those original instructions, is a separate slice.
//!
//! What the docs DID cover cleanly, no gap: tape count/head start/two-way-infinite growth/halt-on-no-
//! rule (`syntax.rs`), rule matching/wildcards/first-match-wins/write-`None`-is-unchanged (`machine.rs`),
//! and the scalar register-field layout (`unary.rs`).
//!
//! Imports `parse_tm_full` (that is the FORMAT, not the simulation) and nothing else from
//! `redextape_core::tm` beyond the plain data it returns. No `simulate`, no `Tape`, no `Encoding`,
//! no `decode_tape_ty`.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::tm::{BLANK, Machine, Move, parse_tm_full};

/// Generous — this fixture halts in the low hundreds of steps; this cap exists only so a foreign
/// simulator whose doc-derived rules are subtly wrong fails loudly instead of hanging.
const STEP_CAP: usize = 1_000_000;

/// A multi-tape configuration: one growable window per tape plus one head per tape.
///
/// Built from `syntax.rs`'s module doc: "Each tape's head starts at cell 0 of its literal contents (an
/// omitted `tape` line means an empty tape, whose head is at its single blank cell)" and "Tapes are
/// TWO-WAY infinite. Moving left from cell 0 is legal and yields a blank; it does not halt or error."
struct Tapes {
    cells: Vec<Vec<char>>,
    heads: Vec<isize>,
}

impl Tapes {
    fn new(initial: Vec<Vec<char>>) -> Tapes {
        // An empty tape (no `tape` line) is a single blank cell, not zero cells.
        let cells: Vec<Vec<char>> = initial.into_iter().map(|c| if c.is_empty() { vec![BLANK] } else { c }).collect();
        let heads = vec![0isize; cells.len()];
        Tapes { cells, heads }
    }

    fn read(&self, tape: usize) -> char {
        self.cells[tape][self.heads[tape] as usize]
    }

    fn write(&mut self, tape: usize, sym: char) {
        let h = self.heads[tape] as usize;
        self.cells[tape][h] = sym;
    }

    /// Move one head. Growing a blank at either end is what makes the tape two-way infinite: moving
    /// left off the materialized window inserts a new blank cell at the front (the head lands on it,
    /// since the insertion shifts every existing index up by one); moving right off the end appends one.
    fn mv(&mut self, tape: usize, m: Move) {
        match m {
            Move::S => {}
            Move::L => {
                if self.heads[tape] == 0 {
                    self.cells[tape].insert(0, BLANK);
                } else {
                    self.heads[tape] -= 1;
                }
            }
            Move::R => {
                let h = self.heads[tape] as usize;
                if h + 1 == self.cells[tape].len() {
                    self.cells[tape].push(BLANK);
                }
                self.heads[tape] += 1;
            }
        }
    }
}

/// One step. `machine.rs`'s `Rule` doc: "`read[i] == None` matches any symbol under tape `i`'s head;
/// `write[i] == None` leaves it unchanged." `State`'s doc: "rules matched in order (first match wins)."
/// `syntax.rs`'s module doc: "A state with no rule matching the current symbols HALTS, and halting is
/// not failure — the final tapes are the result." Returns `false` on that halt.
fn step(m: &Machine, state: &mut u32, tapes: &mut Tapes) -> bool {
    let rules = &m.states[*state as usize].rules;
    for r in rules {
        let is_match = r.read.iter().enumerate().all(|(i, want)| match want {
            None => true,
            Some(sym) => tapes.read(i) == *sym,
        });
        if !is_match {
            continue;
        }
        for i in 0..m.tapes {
            if let Some(sym) = r.write[i] {
                tapes.write(i, sym);
            }
            tapes.mv(i, r.moves[i]);
        }
        *state = r.next;
        return true;
    }
    false
}

/// Run to a halt (no matching rule) or panic past the step cap.
fn run(m: &Machine, tapes: &mut Tapes) {
    let mut state = m.start;
    for _ in 0..STEP_CAP {
        if !step(m, &mut state, tapes) {
            return;
        }
    }
    panic!("foreign simulator did not halt within {STEP_CAP} steps");
}

/// Decode field `slot` (0-indexed) of a register-bank tape: walk to the `slot`-th `#` — the field's
/// opening delimiter, shared with the previous field's closing one — then count `MARK`s (`'1'`) up to
/// the next `#`. Per `unary.rs`'s module doc: "a value `v` is `v` `MARK`s, left-justified in a
/// `width`-cell field and padded with `BLANK`s."
fn decode_unary_nat(cells: &[char], slot: usize) -> usize {
    let mut hashes = cells.iter().enumerate().filter(|(_, c)| **c == '#').map(|(i, _)| i);
    let start = hashes.nth(slot).expect("missing opening `#` for this slot");
    cells[start + 1..].iter().take_while(|c| **c != '#').filter(|c| **c == '1').count()
}

/// Decode a heap tape into cons cells, 1-indexed by position: `cells[p - 1]` is the `p`-th cell.
/// EXPECTED LAYOUT — NOT sourced from `unary.rs`'s module doc (see the gap noted in the file header):
/// each cell is `@`, then `head` `MARK`s, then `#`, then `tail` `MARK`s, running up to the next `@` or
/// the end of the tape.
fn decode_unary_heap(cells: &[char]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < cells.len() {
        if cells[i] != '@' {
            i += 1;
            continue;
        }
        i += 1;
        let mut head = 0;
        while i < cells.len() && cells[i] != '#' {
            if cells[i] == '1' {
                head += 1;
            }
            i += 1;
        }
        i += 1; // past the `#`
        let mut tail = 0;
        while i < cells.len() && cells[i] != '@' {
            if cells[i] == '1' {
                tail += 1;
            }
            i += 1;
        }
        out.push((head, tail));
    }
    out
}

/// Walk a cons-cell pointer chain (1-based, `0` = nil — undocumented, verified against this fixture)
/// into a plain `Vec` of head values.
fn decode_list(heap: &[(usize, usize)], mut ptr: usize) -> Vec<usize> {
    let mut out = Vec::new();
    while ptr != 0 {
        let (head, tail) = heap[ptr - 1];
        out.push(head);
        ptr = tail;
    }
    out
}

#[test]
fn foreign_reader_decodes_list_1_2() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/list_1_2.tm");
    let src = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path:?}: {e}"));

    let doc = parse_tm_full(&src);
    assert!(doc.diagnostics.is_empty(), "unexpected diagnostics parsing the fixture: {:?}", doc.diagnostics);
    let m = doc.machine.expect("fixture must parse to a machine");
    let h = doc.header.expect("fixture must carry a header");

    // Build the initial configuration from the header's literal tapes (FORMAT, per parse_tm_full/
    // TmHeader — not simulation). Tapes not listed start empty (a single blank cell, per Tapes::new).
    let mut initial = vec![Vec::new(); m.tapes];
    for (i, c) in h.tapes() {
        initial[*i] = c.clone();
    }
    let mut tapes = Tapes::new(initial);

    run(&m, &mut tapes);

    // REG (tape 0) field 0 holds the result — a pointer when the header's result type is compound
    // (`List<Nat>` here), a value directly otherwise. Neither fact is documented; both were checked
    // against this fixture (see the file header's gap #3).
    let ptr = decode_unary_nat(&tapes.cells[0], 0);

    // The heap tape is identified by CONTENT (the one tape containing a cons-cell `@` tag), not by a
    // documented index — no doc names which physical tape is "the heap".
    let heap_tape = tapes.cells.iter().position(|c| c.contains(&'@')).expect("no tape contains a cons-cell `@` marker");
    let heap = decode_unary_heap(&tapes.cells[heap_tape]);

    let value = decode_list(&heap, ptr);
    assert_eq!(value, vec![1, 2], "foreign-decoded value must be the list [1, 2]");
}
