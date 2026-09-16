//! Shared helpers for the integration tests: the TM bank-safety checkers, `core_of`, and the two
//! program-to-machine builders `core_and_ty` and `build_machine`.
//!
//! Integration tests are separate binaries and cannot import one another, so these were originally
//! duplicated across `tm_bank_invariant.rs`, `tm_exhaustive_bank_safety.rs` and
//! `tm_static_delimiter_safety.rs`, with a test pinning the copies identical. `tests/common/mod.rs` is
//! the standard way to share code between integration tests, and one definition cannot drift from itself.
//!
//! Two oracle-leg helpers live here as well: `run_with_origins`, which locates each tape's origin after a
//! run, and `acyclic_machine`, a generator of small machines that always halt. `one_way_oracle.rs` defined
//! both; they moved here when `universal_oracle.rs` needed them too, so neither leg keeps a copy.
//!
//! Several checkers live here. Two of them establish DIFFERENT kinds of claim about the same property:
//!
//!   * `reg_bank_is_well_formed` inspects a tape at a moment in time. Used after every simulator step,
//!     it verifies the run that happened — and only that run, only as far as it got.
//!   * `unsafe_rules` inspects a machine's rules without running anything. It verifies every execution
//!     the machine could have, of any length, including ones that never terminate.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
#![allow(dead_code)] // each test binary uses a different subset

use proptest::prelude::{Strategy, any, prop};
use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::machine::{Move, Rule, State, StateId};
use redextape_core::tm::one_way::OriginSnapshot;
use redextape_core::tm::sim::{Caps, Status, simulate_origins};
use redextape_core::tm::{
    AT, BLANK, BOX, Encoding, EncodingKind, Machine, REG, SEP, Symbol, TM_DEFAULT_CAPS, TmRun, WORK, run_tm_described,
};
use redextape_core::ty::Ty;
use redextape_core::typeck::result_type;

/// Parse and desugar a fixture that must be clean, which is how every test here starts.
///
/// Panics on a diagnostic rather than returning it: a fixture that does not parse is a broken test,
/// not a case under test, and the only useful thing to do with it is stop and name it.
pub fn core_of(src: &str) -> Core {
    let (p, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
    desugar(&p.expect("a program with no diagnostics parses"))
}

/// Parse, typecheck and desugar `src`, returning its `Core` and its top-level type together, for a
/// fixture that must be clean. Panics on a diagnostic or a type error for the reason `core_of` gives.
///
/// **SHARED BECAUSE SEVERAL INTEGRATION TESTS CARRIED IT VERBATIM:** `single_tape_oracle.rs`,
/// `two_symbol_oracle.rs`, `one_way_oracle.rs` and `tm_header.rs`. `examples/regen_fixtures.rs` still
/// carries its own copy.
pub fn core_and_ty(src: &str) -> (Core, Ty) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let prog = prog.expect("a program");
    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
    (desugar(&prog), ty)
}

/// The lowered machine for `src` under `enc`, and the initial tapes it runs on — for a program the TM
/// backend must run to completion. `two_symbol_oracle.rs` and `one_way_oracle.rs` each carried this function
/// verbatim; `single_tape_oracle.rs` carried a unary-only variant, which its `ENCODING` constant now replaces.
pub fn build_machine(src: &str, enc: EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
    let (core, ty) = core_and_ty(src);
    let d = run_tm_described(&core, enc, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
    assert!(matches!(d.run, TmRun::Ran { .. }), "the source machine must complete for {src:?}");
    let init = d.header.init(d.machine.tapes);
    (d.machine, init)
}

/// The width every generic checker measures against. A bounded encoding reports its field width; an
/// unbounded one has no fixed skeleton to check, so the checkers refuse rather than guess.
fn width_of(enc: &dyn Encoding) -> usize {
    enc.field_width().expect("bank-shape checkers require a bounded encoding")
}

/// The REG bank's SKELETON: exactly `1 + slots * (width + 1)` cells, with a `#` at cell 0 and at every
/// `width + 1` cells thereafter, and only field content in between.
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
pub fn reg_bank_is_well_formed(cells: &[char], enc: &dyn Encoding, slots: usize) -> Result<(), String> {
    let width = width_of(enc);
    let content = enc.field_symbols();
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
        if let Some(bad) = cells[base..base + width].iter().find(|c| !content.contains(c)) {
            return Err(format!("field {s} holds `{bad}`, which is not field content for this encoding"));
        }
    }
    Ok(())
}

/// The BOX tape's skeleton: zero or more fields, each a `#` followed by exactly `width` cells holding
/// only field content, then a blank "top" running to the end. Unlike REG there is NO trailing `#` after
/// the last field, which is exactly why `box_overwrite_field` is a counted chain — a content-driven
/// overrun of the last field would have no delimiter to stop at.
///
/// A field's `width`-cell window is accepted as either FULLY WRITTEN (every cell is `content`) or
/// MID-APPEND: some PREFIX of `content`, then `BLANK` for the rest of the window. The second shape is
/// not a defect — it is what `box_append_field`/`box_append_field_bin` produce while writing a brand
/// new field, one cell per simulator step, onto virgin tape: the leading `#` is written FIRST (it sits
/// left of every content cell, and a tape head can only sweep one direction per pass), so for the
/// several steps it takes to write the rest of the field, the tape genuinely holds "some real content,
/// then not-yet-reached blank" — checked per-step, that is what is true at that step, not a corruption.
///
/// The predicate tolerates this shape in ANY window, not only the last field, and that is sound — but
/// for a reason outside the predicate itself, so it is worth naming: `box_overwrite_field`/
/// `box_overwrite_field_bin` never read a `BLANK` old value, so an already-written field can never
/// re-enter the mid-append shape. The check is gadget-behaviour-dependent here, not intrinsically
/// last-field-only, and a future gadget that overwrote a field blank-first would slip past it.
///
/// This was invisible under `Unary` only because `BLANK` is already part of `Unary::field_symbols()`
/// (a unary field IS "marks then blank padding", complete or not, so a partial append already looks like
/// ordinary field content and needed no special case). `Binary::field_symbols()` correctly excludes
/// `BLANK` — a binary field has no padding, every cell is a real digit once written — which is what
/// surfaces the mid-append shape as a THIRD case here rather than a subset of the first.
///
/// An EARLIER field can never be in the mid-append shape: every `box_*` gadget that writes an EXISTING
/// field (`box_overwrite_field`/`box_overwrite_field_bin`) reads and writes real content only, never a
/// virgin blank — only the CURRENTLY-GROWING (rightmost) field ever has one. Tolerating the shape
/// per-window rather than only for "the last field" is still sound: it requires the blank run to be an
/// unbroken SUFFIX of the window, so a foreign symbol, or real content resuming after a blank (which no
/// gadget ever produces, mid-append or otherwise), is still rejected.
pub fn box_tape_is_well_formed(cells: &[char], enc: &dyn Encoding) -> Result<(), String> {
    let width = width_of(enc);
    let content = enc.field_symbols();
    let mut i = 0usize;
    let mut field = 0usize;
    while i < cells.len() && cells[i] == SEP {
        let window = i + 1;
        let end = (window + width).min(cells.len());
        let win = &cells[window..end];
        if let Some(off) = win.iter().position(|c| !content.contains(c)) {
            let mid_append = win[off] == BLANK && win[off..].iter().all(|&c| c == BLANK);
            if !mid_append {
                return Err(format!("box field {field} cell {off} is `{}`, not field content", cells[window + off]));
            }
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
///   (b) it reads an explicit NON-`SEP` symbol there — ANY such symbol, not only ones the encoding
///       declares as field content — so it provably never fires with the head on a delimiter, or
///   (c) an EARLIER rule in the same state reads `Some(SEP)` there AND constrains no other tape, so by
///       first-match-wins it always shadows this one whenever the head is on a delimiter.
///
/// Clause (b) was originally `matches!(rule.read[tape], Some(MARK) | Some(BLANK))`, hardcoding the
/// UNARY alphabet: under `Binary` a digit-write rule that reads `Some(ZERO)` failed that clause and was
/// reported as unsafe, a FALSE POSITIVE on correct code (`write_literal`/`copy_field` enumerate both
/// `ZERO` and `MARK` explicitly — see `binary.rs`). The obvious repair — restrict clause (b) to
/// `enc.field_symbols()` instead of a hardcoded pair — turns out to be ANOTHER hardcoded alphabet one
/// level up, and it is caught by the very first binary machine run through it:
/// `box_append_field_bin` legitimately reads `Some(BLANK)` when appending a fresh BOX field onto virgin
/// tape (a BOX field's WIDTH is declared field content, but the growing TOP beyond the last field is
/// not — `BLANK` is deliberately excluded from `Binary::field_symbols()` because a binary field is never
/// blank-padded). Restricting to `field_symbols()` would reject that real, correct rule.
///
/// The actual invariant clause (b) needs has nothing to do with what an encoding calls "field content":
/// `SEP`, `BLANK`, `MARK`, `ZERO` and `AT` are five DISTINCT, globally-fixed symbols (see
/// `tm/build.rs`/`tm/machine.rs`), so a rule whose read is `Some(s)` for ANY `s != SEP` can only ever
/// fire with the tape cell literally holding `s` — which is provably not `#`. That holds regardless of
/// which encoding declared `s` as legal field content, so clause (b) does not need to consult the
/// encoding at all: it needs `SEP`, which every tape shares.
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
            if matches!(rule.read[tape], Some(s) if s != SEP) {
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

/// Assert delimiter safety on every FIXED-WIDTH tape. REG and BOX always; WORK only when the encoding
/// declares it structured by returning a non-empty `init_work` — under `Unary`, WORK is built up
/// on-the-fly and has no fixed skeleton to check; under `Binary` it is a `#`-delimited fixed-width bank
/// (`Binary::init_work` returns a one-field bank) whose delimiters are exactly as destructible as REG's
/// or BOX's. HEAP and STACK are excluded because they are variable-width and delimited by content, so
/// they have no fixed skeleton to destroy.
///
/// KNOWN LIMIT: `!init_work().is_empty()` is a PROXY for "this encoding gives WORK a fixed-width
/// skeleton", and the trait states no such property. It happens to be exact for both encodings in the
/// tree — `Unary` builds its scratch from an empty tape, `Binary` lays out a one-field bank — but a
/// third encoding whose WORK is structured yet STARTS empty would be silently skipped here, with no
/// test failing to say so. Closing it properly means an explicit trait predicate; that is deliberately
/// deferred until a third implementation exists, because inventing the predicate now would mean
/// guessing what it should mean. Recorded so the next implementor finds it rather than rediscovers it.
pub fn assert_delimiter_safe(m: &Machine, enc: &dyn Encoding, what: &str) {
    let mut tapes = vec![(REG, "REG"), (BOX, "BOX")];
    if !enc.init_work().is_empty() {
        tapes.push((WORK, "WORK"));
    }
    for (tape, name) in tapes {
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
pub fn heap_tape_is_well_formed(cells: &[char], enc: &dyn Encoding) -> Result<(), String> {
    let content = enc.field_symbols();
    // A word is "a run of field content", which covers both encodings and is why this stayed one loop.
    // Its LENGTH is checked only where the encoding fixes one (`Encoding::heap_word_len`): `None` under
    // `Unary`, whose words are bare mark runs whose length IS the value, and `Some(width)` under
    // `Binary`, whose words are always `width` digits.
    //
    // THAT ASYMMETRY IS THE POINT, and it used to be a recorded gap here. This rung checked no length
    // at all, which was the whole property for unary but covered strictly less of binary's heap
    // structure than binary admits. What compensated was `Binary::parse_heap_cells` being width-strict
    // — and making it STRUCTURAL removed that compensation, so the check moved here in the same change.
    // Without it, a binary word truncated by a clobbered high digit would now decode to the smaller
    // number its remaining digits spell, and nothing anywhere would notice.
    let word_len = enc.heap_word_len();
    let check_len = |cell: usize, what: &str, len: usize| -> Result<(), String> {
        match word_len {
            Some(w) if len != w => {
                Err(format!("cons cell {cell}'s {what} word is {len} cell(s), not the encoding's {w}"))
            }
            _ => Ok(()),
        }
    };
    let mut i = 0usize;
    while i < cells.len() && cells[i] == BLANK {
        i += 1;
    }
    let mut cell = 0usize;
    while i < cells.len() && cells[i] == AT {
        i += 1; // the `@`
        let head = i;
        while i < cells.len() && content.contains(&cells[i]) && cells[i] != BLANK {
            i += 1; // head word
        }
        // Separator BEFORE length: a cell with no `#` at all is a broken skeleton, and saying so is more
        // useful than complaining that the run leading up to the breakage was the wrong length.
        if i >= cells.len() || cells[i] != SEP {
            return Err(format!("cons cell {cell} has no `{SEP}` between head and tail (at index {i})"));
        }
        check_len(cell, "head", i - head)?;
        i += 1; // the `#`
        let tail = i;
        while i < cells.len() && content.contains(&cells[i]) && cells[i] != BLANK {
            i += 1; // tail word
        }
        check_len(cell, "tail", i - tail)?;
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

/// Run `m` and record where each tape's origin ends up in its final snapshot, from the count of left
/// growths `sim.rs`'s `simulate_origins` keeps.
///
/// **SOUND AS AN INSTRUMENT FOR THE FOLD, THOUGH THE LIBRARY COUNTS THE ORIGINS.** The fold's side of each
/// comparison finds its origin from the zig-zag layout, not from growth, so an origin count that went wrong
/// would disagree with it rather than agree.
pub fn run_with_origins(m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (Vec<OriginSnapshot>, StateId, Status, u64) {
    let (tapes, origins, state, status, steps) = simulate_origins(m, inits, caps);
    assert_eq!(tapes.len(), origins.len(), "one origin per tape");
    let snaps = tapes
        .iter()
        .zip(&origins)
        .map(|(t, &origin)| {
            let (cells, head) = t.snapshot();
            OriginSnapshot { cells, head, origin }
        })
        .collect();
    (snaps, state, status, steps)
}

/// Random machines of one to three tapes whose rules only ever target a higher-numbered state, so every
/// run halts within as many steps as there are states. Moves lean left, since the left half is what this
/// exists to reach.
pub fn acyclic_machine() -> impl Strategy<Value = (Machine, Vec<Vec<Symbol>>)> {
    (1usize..=3, 2usize..=12).prop_flat_map(|(tapes, n)| {
        let sym = prop::sample::select(vec!['a', 'b', BLANK]);
        let read = prop::option::of(sym.clone());
        let write = prop::option::of(sym.clone());
        let mv = prop::sample::select(vec![Move::L, Move::L, Move::R, Move::S]);
        let rule = (
            prop::collection::vec(read, tapes),
            prop::collection::vec(write, tapes),
            prop::collection::vec(mv, tapes),
            any::<prop::sample::Index>(),
        );
        let states = prop::collection::vec(prop::collection::vec(rule, 1..=3), n);
        let inits = prop::collection::vec(prop::collection::vec(sym, 0..4), tapes);
        (states, inits).prop_map(move |(states, inits)| {
            let mut built: Vec<State> = states
                .into_iter()
                .enumerate()
                .map(|(i, rules)| State {
                    name: format!("s{i}"),
                    accept: false,
                    rules: rules
                        .into_iter()
                        .map(|(read, write, moves, target)| Rule {
                            read,
                            write,
                            moves,
                            next: (i + 1 + target.index(n - i)) as StateId,
                        })
                        .collect(),
                })
                .collect();
            built.push(State { name: "done".into(), accept: true, rules: vec![] });
            (Machine { states: built, start: 0, tapes }, inits)
        })
    })
}
