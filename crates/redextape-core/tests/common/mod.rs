//! Shared checkers for the TM bank-safety test suite.
//!
//! Integration tests are separate binaries and cannot import one another, so these were originally
//! duplicated across `tm_bank_invariant.rs`, `tm_exhaustive_bank_safety.rs` and
//! `tm_static_delimiter_safety.rs`, with a test pinning the copies identical. Three copies is where
//! that stops being cheaper than a shared module: `tests/common/mod.rs` is the standard way to share
//! code between integration tests, and one definition cannot drift from itself.
//!
//! Two checkers live here, and they establish DIFFERENT kinds of claim about the same property:
//!
//!   * `reg_bank_is_well_formed` inspects a tape at a moment in time. Used after every simulator step,
//!     it verifies the run that happened — and only that run, only as far as it got.
//!   * `unsafe_rules` inspects a machine's rules without running anything. It verifies every execution
//!     the machine could have, of any length, including ones that never terminate.

#![allow(dead_code)] // each test binary uses a different subset

use redextape_core::tm::{AT, BLANK, MARK, Machine, SEP};

/// The REG bank's SKELETON: exactly `1 + slots * (width + 1)` cells, with a `#` at cell 0 and at every
/// `width + 1` cells thereafter, and only marks or blanks in between.
///
/// Deliberately NOT "each field is marks-then-blanks". That is a BETWEEN-GADGET invariant, not a
/// per-step one, and the suite found the difference the hard way: `append_work_to_field` and
/// `write_literal` both blank their window left-to-right before rewriting it, so mid-gadget a field
/// legitimately reads blanks-then-marks. An invariant checked after EVERY step can only assert what is
/// true after every step.
///
/// The skeleton is the right property anyway, because it is exactly what an overflow destroys: a value
/// written past the end of its window overwrites the field's trailing `#` with a MARK, merging two
/// fields and desynchronizing `rewind_home`'s `#`-counting walk.
pub fn reg_bank_is_well_formed(cells: &[char], width: usize, slots: usize) -> Result<(), String> {
    let expected = 1 + slots * (width + 1);
    if cells.len() != expected {
        return Err(format!("bank is {} cells, expected {expected}", cells.len()));
    }
    if cells[0] != SEP {
        return Err(format!("bank must start with `{SEP}`, got `{}`", cells[0]));
    }
    for s in 0..slots {
        let base = 1 + s * (width + 1);
        if cells[base + width] != SEP {
            return Err(format!("field {s} is not closed by `{SEP}`, got `{}`", cells[base + width]));
        }
        if let Some(bad) = cells[base..base + width].iter().find(|&&c| c != MARK && c != BLANK) {
            return Err(format!("field {s} holds `{bad}`, which is neither a mark nor a blank"));
        }
    }
    Ok(())
}

/// The BOX tape's skeleton: zero or more fields, each a `#` followed by exactly `width` cells holding
/// only marks or blanks, then a blank "top" running to the end. Unlike REG there is NO trailing `#`
/// after the last field, which is exactly why `box_overwrite_field` is a counted chain — a
/// content-driven overrun of the last field would have no delimiter to stop at.
pub fn box_tape_is_well_formed(cells: &[char], width: usize) -> Result<(), String> {
    let mut i = 0usize;
    let mut field = 0usize;
    while i < cells.len() && cells[i] == SEP {
        let window = i + 1;
        let end = (window + width).min(cells.len());
        if let Some(off) = cells[window..end].iter().position(|&c| c != MARK && c != BLANK) {
            return Err(format!("box field {field} cell {off} is `{}`, not a mark or blank", cells[window + off]));
        }
        i = window + width;
        field += 1;
    }
    if let Some(bad) = cells[i.min(cells.len())..].iter().position(|&c| c != BLANK) {
        return Err(format!(
            "after {field} field(s) cell {} is `{}`, but the top must be blank",
            i + bad,
            cells[i + bad]
        ));
    }
    Ok(())
}

/// Every rule of `m` that could write a non-`#` symbol onto a `#` on tape `tape` — i.e. every rule that
/// could destroy a delimiter. An empty result is a proof, for this machine, that no execution of any
/// length can do so.
///
/// A rule is SAFE on `tape` if either:
///   (a) it does not write `tape`, or writes `SEP` itself (the write lands under the head, so a
///       delimiter write cannot destroy a delimiter), or
///   (b) it reads an explicit non-`SEP` symbol there, so it provably never fires with the head on a
///       delimiter, or
///   (c) an EARLIER rule in the same state reads `Some(SEP)` there AND constrains no other tape, so by
///       first-match-wins it always shadows this one whenever the head is on a delimiter.
///
/// (c) is what the overflow guard provides for the content-driven loops, and it is why the guard must
/// be the FIRST rule in its state. A guard that also constrained another tape would not fire on every
/// `#`, so it would not shadow totally — that case is rejected, and pinned by a test.
pub fn unsafe_rules(m: &Machine, tape: usize) -> Vec<String> {
    let mut out = Vec::new();
    for (sid, state) in m.states.iter().enumerate() {
        for (ri, rule) in state.rules.iter().enumerate() {
            let Some(written) = rule.write[tape] else { continue };
            if written == SEP {
                continue; // (a)
            }
            if matches!(rule.read[tape], Some(MARK) | Some(BLANK)) {
                continue; // (b)
            }
            let shadowed = state.rules[..ri]
                .iter()
                .any(|g| g.read[tape] == Some(SEP) && g.read.iter().enumerate().all(|(i, r)| i == tape || r.is_none()));
            if !shadowed {
                out.push(format!(
                    "state {sid} `{}` rule {ri}: writes {written:?} reading {:?} — neither an explicit \
                     non-`#` read nor shadowed by a preceding `#` guard",
                    state.name, rule.read[tape]
                ));
            }
        }
    }
    out
}

/// Assert delimiter safety on both fixed-width tapes. HEAP and STACK are excluded because they are
/// variable-width and delimited by content, so they have no fixed skeleton to destroy.
pub fn assert_delimiter_safe(m: &Machine, what: &str) {
    for (tape, name) in [(redextape_core::tm::REG, "REG"), (redextape_core::tm::BOX, "BOX")] {
        let bad = unsafe_rules(m, tape);
        assert!(
            bad.is_empty(),
            "{what}: {} rule(s) on {name} could write over a delimiter:\n  {}",
            bad.len(),
            bad.join("\n  ")
        );
    }
}

/// The HEAP tape's shape at a quiescent point: an optional leading blank (cell 0, where the head
/// starts and which is never written), then a sequence of cons cells, then blanks to the end. Each
/// cell is `@ <head marks> # <tail marks>`.
///
/// Checked on the FINAL tape rather than after every step, and that is forced rather than chosen:
/// HEAP is variable-width and its delimiters are DATA, created by `cons` as the structure grows. Mid
/// gadget a cell is half-written, so there is no per-step skeleton — unlike REG and BOX, whose
/// delimiters are fixed for the whole run. For the same reason the static rung-3 check does not apply
/// here either: a rule that writes a mark over a `@` is not automatically a defect on this tape.
pub fn heap_tape_is_well_formed(cells: &[char]) -> Result<(), String> {
    let mut i = 0usize;
    while i < cells.len() && cells[i] == BLANK {
        i += 1;
    }
    let mut cell = 0usize;
    while i < cells.len() && cells[i] == AT {
        i += 1; // the `@`
        while i < cells.len() && cells[i] == MARK {
            i += 1; // head marks
        }
        if i >= cells.len() || cells[i] != SEP {
            return Err(format!("cons cell {cell} has no `{SEP}` between head and tail (at index {i})"));
        }
        i += 1; // the `#`
        while i < cells.len() && cells[i] == MARK {
            i += 1; // tail marks
        }
        cell += 1;
    }
    if let Some(off) = cells[i.min(cells.len())..].iter().position(|&c| c != BLANK) {
        return Err(format!(
            "after {cell} cons cell(s), cell {} is `{}` but the heap must be blank to the end",
            i + off,
            cells[i + off]
        ));
    }
    Ok(())
}

/// The STACK must be entirely blank when a program halts with a value.
///
/// A frame is pushed by `Call` and erased by `Ret`'s `pop_frame_restore` + `dispatch_tag`, so residue
/// on a completed run means calls and returns did not balance — a leaked frame, or a pop that erased
/// the wrong number of fields. Nothing else in the suite checks that: the value oracle would only
/// notice if the imbalance happened to change an answer.
///
/// Only meaningful for a run that produced a VALUE. A run that hit a cap or halted in the overflow
/// guard can stop anywhere, including mid-call, and a non-empty stack then is correct.
pub fn stack_is_empty(cells: &[char]) -> Result<(), String> {
    match cells.iter().position(|&c| c != BLANK) {
        None => Ok(()),
        Some(i) => Err(format!(
            "stack cell {i} is `{}`, but a completed run must have popped every frame (residue: {})",
            cells[i],
            cells.iter().collect::<String>()
        )),
    }
}
