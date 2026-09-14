# Two-Way → One-Way Tape Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Machine -> Machine` fold onto tapes that are infinite in one direction only, a per-run certificate that no head stepped left of cell 0, a sixth oracle leg asserting `multitape-TM == one-way-TM`, and the certificate that stages 1 and 2 already never step left of cell 0.

**Architecture:** A new `tm/one_way.rs`. `zigzag` lays every tape out behind a `LEFT_END` marker — original cell `j ≥ 0` at physical cell `2j + 1`, original cell `-(j + 1)` at `2j + 2` — and `unzigzag` reads it back, returning `None` if any head ever stepped left of physical cell 0, which is the certificate failing. `to_one_way` copies every rule's reads and writes unchanged and replaces its moves with one to three physical steps, carrying each tape's side in the control state as `(original state, sides)` pairs emitted from a worklist. A new `tests/one_way_oracle.rs` holds leg 6 (compared relative to the ORIGIN through `OriginSnapshot::trimmed`), the deep excursions the lowered corpus never makes, the compositions with stages 1 and 2, and the slow tier. Nothing in `core`, `asm` or `encoding` changes.

**Tech Stack:** Rust 2024, `redextape-core`, `proptest`, `cargo nextest`.

**Spec:** [`docs/superpowers/specs/2026-09-13-one-way-fold-design.md`](../specs/2026-09-13-one-way-fold-design.md).

**Stages this stacks on:** stage 1 — [`tm/single_tape.rs`](../../../crates/redextape-core/src/tm/single_tape.rs), spec [`2026-09-10-single-tape-reduction-design.md`](../specs/2026-09-10-single-tape-reduction-design.md); stage 2 — [`tm/two_symbol.rs`](../../../crates/redextape-core/src/tm/two_symbol.rs), spec [`2026-09-10-alphabet-reduction-design.md`](../specs/2026-09-10-alphabet-reduction-design.md), plan [`2026-09-10-alphabet-reduction.md`](2026-09-10-alphabet-reduction.md).

## Global Constraints

- **Edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- **Every commit runs the pre-commit gate**: `cargo fmt`, `cargo clippy --workspace --all-targets -- -D warnings`, `scripts/check-citations.sh`, `scripts/check-attributions.sh`, `scripts/check-doc-figures.sh` and more. **A commit whose tree does not compile or lint cannot land**, so there is no "commit the failing test" step anywhere below. **Never `--no-verify`.**
- **`-D warnings` turns an unused `use` or an unread struct field into a failed commit.** That is why Task 1's `use` lines are narrower than Task 2's, and why Tasks 4 and 5 each add their own `use` lines to the oracle file. Copy the `use` lines the task gives, not the ones a later task's file has.
- **`clippy::pedantic` is denied in library code**, along with `unwrap_used`, `expect_used`, `panic`, `todo` and `unimplemented`. The exemption in `clippy.toml` reaches only code lexically inside `#[test]` or `#[cfg(test)]`; `tests/one_way_oracle.rs` carries a file-level `#![allow(...)]` for its free helpers, as `two_symbol_oracle.rs` does.
- **`file:line` citations are banned in tracked source** (`scripts/check-citations.sh`). Cite the symbol.
- **A citation of the form `` `file.rs`'s `symbol` `` must name a file that DECLARES the symbol at that commit** (`scripts/check-attributions.sh`). A doc comment therefore cannot cite a test a later task creates. The code below obeys this; do not add such a citation.
- `MAX_MACHINE_STATES = 1_000_000` (`tm/build.rs`).
- `Machine::validate()` returns `Vec<String>`, empty meaning valid: unique state names free of whitespace and `; * : [ ]`, concrete symbols outside `* ; [ ]`, and **accept states carrying no rules**.
- **The marker is `|` (`LEFT_END`). `_` is `BLANK`** (`tm/machine.rs`).
- **Scope a test run by TARGET, not by name.** `cargo nextest run -p redextape-core one_way` filters TEST NAMES: measured while planning, it ran all 12 unit tests but only 1 of the oracle file's 8, because only one oracle test has `one_way` in its name. Use `--lib tm::one_way` for the unit tests and `--test one_way_oracle` for the oracle file.
- **Sabotages are applied AFTER the task's commit**, so `git checkout -- <file>` restores exactly. A sabotage is never committed.
- **A sabotage that fails a proptest writes `crates/redextape-core/tests/one_way_oracle.proptest-regressions`. Delete it** after restoring. The repository tracks six `.proptest-regressions` files that record real failures; a seed from a deliberately broken construction is not one.
- **A sabotage that does not redden what this plan predicts is a finding. Report it; do not adjust the sabotage or the test until it does.**
- **Every code block below was compiled, formatted, linted and tested at the end state of its own task while planning** (the five end states, in a scratch worktree: `cargo fmt --check`, `cargo clippy -p redextape-core --all-targets -- -D warnings`, the task's `nextest` runs, `check-attributions.sh` and `check-citations.sh` all exit 0). Use the code verbatim. If it does not compile or a figure below does not reproduce, that is a finding to report, not something to repair silently.
- **No command in this plan takes more than a few seconds.** The slow tier measured under one second in release. If a command runs for minutes, stop and report rather than raising a cap.
- A roadmap entry is written **before** the PR, and every figure in it names the command that produced it.

## What changed from the spec while planning, and why

1. **Sabotage S1's evidence reaches leg 6's FIRST member only.** The spec predicted leg 6 "reddens on every corpus member". The leg loops over its corpus and stops at the first failed assertion, so S1 shows red on `3 - 5` (Unary)'s WORK tape, at the certificate, and shows nothing about the members after it. This plan records what the sabotage shows.
2. **Two sabotages are added, S4 and S5, and S4 is the sharpest result the planning run produced.** S4 loses a crossing's side flip whenever a later tape also moves in the same rule. **Leg 6, the depth-5 test and the toy test all stay GREEN under it**; only `two_tapes_crossing_the_origin_in_one_rule_agree`, the proptest, and the first assertion of `a_tape_with_no_left_move_is_never_on_the_left_half` redden. S5 flips every tape on every crossing, and is the sabotage that shows that test's SECOND assertion can fail — S4 stops at its first.
3. **The worklist saves nothing on the measured corpus.** Every `2^n` combination of sides is reachable: 4 of 4 for `1 + 2 * 3`, 8 of 8 for `cons(1, cons(2, nil))` and for `sum(5)`. The spec left this to measurement; on these machines the answer is none.
4. **The largest shipped demo cannot be folded under the state cap.** 49,135 states with four tapes carrying a `Move::L` rule fold to 7,363,253 states, ratio 149.857596, against `MAX_MACHINE_STATES` of 1,000,000. Recorded, not gated, as the spec said.
5. **The all-three composition compares a stage at a time**, not only its shape, halt and certificate as the spec described. An accept plus a certificate does not show the three stages compute the same tapes. Each comparison it makes sees tapes that start with a non-blank marker, so `normalize` keeps every head there.
6. **The all-three composition needs no left padding**: `interleave(&z, folded.tapes, 0, 1)` suffices, because a folded machine never visits a cell left of its marker.
7. **`STATE_CEILING` is 40.0**, above a measured maximum of 34.630197 (binary `sum(5)`); **the deep-excursion floor is a tenth** of 256 generated machines, below a measured 41.
8. **`OriginSnapshot::trimmed`'s doc cites the spec for its STACK measurement, not the oracle test that prints it**, because that file does not exist at Task 1's commit and `check-attributions.sh` would reject the citation.

## Verified during planning

Every row was produced by the command in its last column, on the end state of the task named there.

| figure | value | produced by |
| --- | --- | --- |
| states per original state: `1 + 2 * 3` U, B; `cons(1, cons(2, nil))` U, B; `sum(5)` U, B | 13.237762, 18.356115; 20.308219, 31.019900; 21.719966, 34.630197 | Task 2: `cargo nextest run -p redextape-core --lib tm::one_way --no-capture` |
| original → folded states, same rows | 143 → 1,893; 278 → 5,103; 146 → 2,965; 201 → 6,235; 1,182 → 25,673; 1,371 → 47,478 | same |
| reachable `sides`, same rows | 4 of 2^2; 4 of 2^2; 8 of 2^3; 8 of 2^3; 8 of 2^3; 8 of 2^3 | same |
| leg 6's left excursions | `3 - 5` U: work to -1 (ends blank) · `if 2 > 1 …` U: work to -1 · `cons(…)` U: work, heap to -1 · `fn add1(x) …` U: work to -1, stack to -1 (ends blank) · `cons(…)` B: heap to -1 | Task 3: `cargo nextest run -p redextape-core --test one_way_oracle --no-capture` |
| cost table: source → folded steps, ratio, longest tape | `1 + 2 * 3` U 1,020 → 2,041, 2.001x, 46 · B 613 → 1,208, 1.971x, 26 · `let x = 40; x + 2` U 2,870 → 5,893, 2.053x, 261 · B 405 → 838, 2.069x, 37 · `sum(5)` U 50,542 → 101,775, 2.014x, 188 · B 18,086 → 37,171, 2.055x, 302 | Task 3: `cargo nextest run --release -p redextape-core --test one_way_oracle --run-ignored only --no-capture` |
| generator reach | 128 of 256 reach cell -1; 41 reach cell -2 or beyond | Task 4: `cargo nextest run -p redextape-core --test one_way_oracle --no-capture` |
| fold then stage 2: folded → reduced steps, `k` | `3 - 5` 508 → 2,621, 2 · `if …` 1,263 → 6,578, 2 · `cons(…)` 861 → 6,990, 3 · `fn add1(x) …` 6,791 → 35,606, 2 | Task 5: `cargo nextest run -p redextape-core --test one_way_oracle --no-capture` |
| stages 1 then 2 on `3 - 5` | `k` 4, 2,158,491 steps, `code.pattern('<')` = `['_', '_', '1', '1']` | same |
| all three on `3 - 5` | folded 508 steps, stage 1 887,588, all three 7,088,578; `k` 4; 137,532 states | Task 5: `cargo nextest run --release -p redextape-core --test one_way_oracle --run-ignored only --no-capture` |
| largest shipped demo | 49,135 → 7,363,253 states, ratio 149.857596, four tapes with `Move::L`, 9.6 s to build in release | a scratch probe while planning (not committed): `run_tm_described_at(.., EncodingKind::Binary, .., MAX_FIELD_WIDTH)` on `single_tape.rs`'s `WORST_SHIPPED_DEMO` source, then `to_one_way` |

## File Structure

- **Create** `crates/redextape-core/src/tm/one_way.rs` — the fold: `LEFT_END`, `OriginSnapshot`, `zigzag`, `unzigzag`, `left_end_collision`, `states_per_original`, `to_one_way`. One responsibility: turning a machine and its tapes into a one-way machine and back.
- **Modify** `crates/redextape-core/src/tm.rs` — add `pub mod one_way;` between `pub mod machine;` and `pub mod sim;`.
- **Create** `crates/redextape-core/tests/one_way_oracle.rs` — leg 6, the deep excursions, the compositions, and the slow tier.
- **Modify, in Task 6** — `crates/redextape-core/tests/common/mod.rs` gains `core_and_ty` and `build_machine`; `single_tape_oracle.rs`, `two_symbol_oracle.rs`, `one_way_oracle.rs` and `tm_header.rs` drop their own copies and import them.
- **Modify, before the PR** — `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the entry and the pipeline bullet) and the spec (the corrections above).

---

### Task 1: The layout — `LEFT_END`, `OriginSnapshot`, `zigzag`, `unzigzag`

**Files:**
- Create: `crates/redextape-core/src/tm/one_way.rs`
- Modify: `crates/redextape-core/src/tm.rs`

**Interfaces:**
- Consumes: `redextape_core::tm::machine::{BLANK, Symbol}`, `redextape_core::tm::sim::Tape`; in tests, `tm::sim::{DEFAULT_CAPS, Status, simulate_final}` and `tm::single_tape::normalize`.
- Produces: `pub const LEFT_END: Symbol`, `pub struct OriginSnapshot { pub cells: Vec<Symbol>, pub head: usize, pub origin: usize }` (derives `Clone, Debug, PartialEq, Eq`), `OriginSnapshot::trimmed(&self) -> OriginSnapshot`, `pub fn zigzag(inits: &[Vec<Symbol>], tapes: usize) -> Option<Vec<Vec<Symbol>>>`, `pub fn unzigzag(tape: &Tape) -> Option<OriginSnapshot>`.

The doc comments below name `to_one_way` with intra-doc brackets before Task 2 creates it. No gate in this repository runs `rustdoc`, so this is harmless and resolves at Task 2.

- [ ] **Step 1: Register the module**

In `crates/redextape-core/src/tm.rs`, between `pub mod machine;` and `pub mod sim;`, add:

```rust
pub mod one_way;
```

- [ ] **Step 2: Create the module**

Create `crates/redextape-core/src/tm/one_way.rs`:

```rust
//! The two-way → one-way fold: a `Machine` whose tapes are infinite in both directions becomes a
//! `Machine` whose heads never visit a cell left of cell 0, by laying every tape out zig-zag behind a
//! marker and replacing each move with one to three physical steps.
//!
//! **THE LAYOUT.** Physical cell 0 holds [`LEFT_END`]; original cell `j ≥ 0` sits at physical cell
//! `2j + 1` and original cell `-(j + 1)` at physical cell `2j + 2`. An odd physical cell is on the right
//! half and an even one on the left, so [`unzigzag`] recovers a tape with no state from the run.
//!
//! **EACH TAPE'S SIDE LIVES IN THE CONTROL STATE, BECAUSE IT CANNOT LIVE ON THE TAPE.** A move right on
//! the left half is a move toward physical cell 0, so a move needs its tape's half. A cell no head has
//! visited reads `BLANK`, which says nothing about which half it is on, so a generated state stands for
//! a pair `(original state, sides)` instead. Pairs are emitted from a worklist starting at the preamble,
//! so a tape with no `Move::L` rule — which can never reach the left half — multiplies nothing.
//!
//! **RULES ARE COPIED, NOT REWRITTEN.** Reads and writes happen in place, so a pair carries its original
//! state's rules in order with identical reads and writes, and only the moves change. Nothing here
//! enumerates a symbol, which is what the roadmap's two-track fold would have had to do: `Symbol` is a
//! `char`, so a pair of symbols must be one `char`, and no rule can wildcard half of one.
//!
//! **ONE-WAYNESS IS CERTIFIED PER RUN, NOT ARGUED.** `sim.rs`'s `Tape` materializes cells lazily and
//! never discards one, so a head that ever stepped left of physical cell 0 leaves a `BLANK` at index 0
//! of every later snapshot — and this construction never writes [`LEFT_END`]. [`unzigzag`] returning
//! `Some` on a halted run is that proof.

use crate::tm::machine::{BLANK, Symbol};
use crate::tm::sim::Tape;

/// The marker at physical cell 0 of every folded tape.
///
/// **NOT NAMED `ORIGIN`.** The encodings' comments already use "origin" for a tape's cell 0 — a cell.
/// This is the symbol in one, and two meanings under one name is the drift
/// `scripts/check-attributions.sh` exists downstream of.
pub const LEFT_END: Symbol = '|';

/// One tape in ORIGINAL coordinates: its cells, the head's index into them, and the index of original
/// cell 0. `Tape::snapshot` returns the first two and cannot return the third, because a `Tape` does
/// not know where it started — which is exactly what a comparison needs once one side of it has been
/// folded.
///
/// Named fields rather than a tuple because `head` and `origin` are both `usize`, and a swap between
/// them type-checks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OriginSnapshot {
    pub cells: Vec<Symbol>,
    pub head: usize,
    pub origin: usize,
}

impl OriginSnapshot {
    /// Strip the blanks outside the window spanning every non-blank cell, the head AND the origin, and
    /// re-index both. Two trimmed snapshots are equal exactly when they hold the same symbols at the same
    /// offsets from the origin and put the head at the same offset.
    ///
    /// **THIS IS NOT `single_tape.rs`'s `normalize`, AND THE DIFFERENCE IS THE POINT.** `normalize`
    /// anchors on the non-blank cells alone, so on an all-blank tape it keeps no head position at all —
    /// and on every lowered demo machine `docs/superpowers/specs/2026-09-13-one-way-fold-design.md`
    /// measured, a STACK tape that reaches cell -1 ends all blank. A comparison built on `normalize`
    /// could not see the fold misplace a head on the tapes that exercise it.
    #[must_use]
    pub fn trimmed(&self) -> OriginSnapshot {
        let lo = self.head.min(self.origin);
        let hi = self.head.max(self.origin);
        let first = self.cells.iter().position(|c| *c != BLANK).map_or(lo, |p| p.min(lo));
        let last = self.cells.iter().rposition(|c| *c != BLANK).map_or(hi, |p| p.max(hi));
        let cells = (first..=last).map(|i| self.cells.get(i).copied().unwrap_or(BLANK)).collect();
        OriginSnapshot { cells, head: self.head - first, origin: self.origin - first }
    }
}

/// Lay `tapes` tapes out for a folded machine: [`LEFT_END`], then each initial tape's cells at the odd
/// physical cells, with a blank left-half cell between every two.
///
/// **EXACTLY `tapes` TAPES COME BACK, INCLUDING ANY `inits` DOES NOT NAME.** `trace.rs`'s `TmCursor::new`
/// gives a missing tape a plain `Tape::new(&[])`, which has no marker, and a folded machine's first
/// crossing on such a tape would walk off its left end.
///
/// `None` when an initial tape contains [`LEFT_END`] — `Machine::alphabet` cannot see initial contents,
/// so [`to_one_way`]'s own refusal cannot catch that pairing — or when `inits` holds more tapes than
/// `tapes`, which `single_tape.rs`'s `interleave` documents dropping silently.
#[must_use]
pub fn zigzag(inits: &[Vec<Symbol>], tapes: usize) -> Option<Vec<Vec<Symbol>>> {
    if inits.len() > tapes || inits.iter().flatten().any(|s| *s == LEFT_END) {
        return None;
    }
    let lay_out = |init: &[Symbol]| {
        let mut out = Vec::with_capacity(2 * init.len() + 1);
        out.push(LEFT_END);
        for (j, s) in init.iter().enumerate() {
            if j > 0 {
                out.push(BLANK);
            }
            out.push(*s);
        }
        out
    };
    Some((0..tapes).map(|i| lay_out(inits.get(i).map_or(&[][..], Vec::as_slice))).collect())
}

/// Recover one folded tape in original coordinates.
///
/// `None` when physical cell 0 is not [`LEFT_END`], when [`LEFT_END`] appears in any other materialized
/// cell, or when the head is ON physical cell 0.
///
/// **THE FIRST CONDITION IS THE ONE-WAY CERTIFICATE.** A `Tape` never discards a materialized cell, so a
/// head that ever stepped left of physical cell 0 leaves a `BLANK` at index 0 of every later snapshot,
/// and [`to_one_way`] never writes [`LEFT_END`]. The third condition never holds between original
/// steps — the preamble and every move end on physical cell 1 or beyond — but a run stopped by a cap can
/// leave a head there.
#[must_use]
pub fn unzigzag(tape: &Tape) -> Option<OriginSnapshot> {
    let (phys, head) = tape.snapshot();
    let (&marker, rest) = phys.split_first()?;
    if marker != LEFT_END || rest.contains(&LEFT_END) || head == 0 {
        return None;
    }
    // `rest[p - 1]` is physical cell `p`: odd `p` is original `(p - 1) / 2`, even `p` is `-(p / 2)`.
    let negatives = rest.len() / 2;
    let positives = rest.len() - negatives;
    let mut cells = Vec::with_capacity(rest.len());
    for n in (1..=negatives).rev() {
        cells.push(*rest.get(2 * n - 1)?);
    }
    for j in 0..positives {
        cells.push(*rest.get(2 * j)?);
    }
    let head = if head % 2 == 1 { negatives + (head - 1) / 2 } else { negatives - head / 2 };
    Some(OriginSnapshot { cells, head, origin: negatives })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::machine::{Machine, Move, Rule, State, StateId};
    use crate::tm::sim::{DEFAULT_CAPS, Status, simulate_final};
    use crate::tm::single_tape::normalize;

    fn rule1(read: Option<Symbol>, write: Option<Symbol>, mv: Move, next: StateId) -> Rule {
        Rule { read: vec![read], write: vec![write], moves: vec![mv], next }
    }

    fn accept(name: &str) -> State {
        State { name: name.into(), accept: true, rules: vec![] }
    }

    /// A one-tape machine taking `steps` in order — each a wildcard read, an optional write and a move —
    /// then accepting.
    fn walk(steps: &[(Option<Symbol>, Move)]) -> Machine {
        let mut states: Vec<State> = steps
            .iter()
            .enumerate()
            .map(|(k, (write, mv))| State {
                name: format!("s{k}"),
                accept: false,
                rules: vec![rule1(None, *write, *mv, StateId::try_from(k + 1).unwrap_or(0))],
            })
            .collect();
        states.push(accept("done"));
        Machine { states, start: 0, tapes: 1 }
    }

    #[test]
    fn zigzag_lays_out_both_halves_and_marks_every_tape() {
        assert_eq!(
            zigzag(&[vec!['a', 'b', 'c']], 2),
            Some(vec![vec![LEFT_END, 'a', BLANK, 'b', BLANK, 'c'], vec![LEFT_END]]),
            "a second tape `inits` does not name still gets its marker"
        );
    }

    #[test]
    fn zigzag_refuses_a_marker_in_the_data_and_a_tape_it_would_drop() {
        assert_eq!(zigzag(&[vec!['a', LEFT_END]], 1), None);
        assert_eq!(zigzag(&[vec![], vec![]], 1), None);
        assert!(zigzag(&[vec!['a']], 1).is_some(), "the refusals above must not be a refusal of everything");
    }

    #[test]
    fn unzigzag_reads_both_halves_back_in_original_order() {
        // One step right, from the marker onto physical cell 1 — what the preamble does, written by hand
        // so this test does not depend on `to_one_way`.
        let step = walk(&[(None, Move::R)]);
        let (tapes, _s, status, _n) = simulate_final(&step, &[vec![LEFT_END, 'a', 'x', 'b', 'y']], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(unzigzag(&tapes[0]), Some(OriginSnapshot { cells: vec!['y', 'x', 'a', 'b'], head: 2, origin: 2 }));
    }

    #[test]
    fn unzigzag_refuses_a_head_on_the_marker_a_missing_marker_and_a_second_marker() {
        assert_eq!(unzigzag(&Tape::new(&[LEFT_END, 'a'])), None, "head on physical cell 0");
        let step = walk(&[(None, Move::R)]);
        for (cells, accepted) in [
            (vec![LEFT_END, 'a', BLANK, 'b'], true),
            (vec!['x', 'a', BLANK, 'b'], false),
            (vec![LEFT_END, 'a', LEFT_END, 'b'], false),
        ] {
            let (tapes, _s, status, _n) = simulate_final(&step, std::slice::from_ref(&cells), DEFAULT_CAPS);
            assert_eq!(status, Status::Halted);
            assert_eq!(unzigzag(&tapes[0]).is_some(), accepted, "for {cells:?}");
        }
    }

    #[test]
    fn trimmed_keeps_the_head_where_normalize_discards_it() {
        let a = OriginSnapshot { cells: vec![BLANK; 5], head: 1, origin: 3 };
        let b = OriginSnapshot { cells: vec![BLANK; 5], head: 3, origin: 3 };
        assert_eq!(normalize(&a.cells, a.head), normalize(&b.cells, b.head), "the blind spot `trimmed` exists for");
        assert_ne!(a.trimmed(), b.trimmed());
        assert_eq!(a.trimmed(), OriginSnapshot { cells: vec![BLANK; 3], head: 0, origin: 2 });
    }
}
```

- [ ] **Step 3: Watch the layout tests fail against stubs**

Temporarily replace the body of `zigzag` with `let _ = (inits, tapes); None` and the body of `unzigzag` with `let _ = tape; None`.

Run: `cargo nextest run -p redextape-core --lib tm::one_way --no-fail-fast`
Expected: FAIL — 4 failed, 1 passed. The four are `zigzag_lays_out_both_halves_and_marks_every_tape`, `zigzag_refuses_a_marker_in_the_data_and_a_tape_it_would_drop` (its `is_some` assertion), `unzigzag_reads_both_halves_back_in_original_order` and `unzigzag_refuses_a_head_on_the_marker_a_missing_marker_and_a_second_marker` (its `accepted == true` case). `trimmed_keeps_the_head_where_normalize_discards_it` passes, because `trimmed` is not stubbed.

Restore both bodies exactly as Step 2 gives them.

- [ ] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-core --lib tm::one_way`
Expected: PASS, 5 tests.

- [ ] **Step 5: Format and lint**

Run: `cargo fmt -p redextape-core --check && cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: both exit 0 with no output from `fmt --check`.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/tm.rs crates/redextape-core/src/tm/one_way.rs
git commit -m "Lay a tape out zig-zag behind a left-end marker, and read it back

Physical cell 0 holds the marker `|`; original cell j >= 0 sits at 2j+1
and cell -(j+1) at 2j+2, so the half a cell is on is its parity and
unzigzag needs nothing from the run.

unzigzag is also the one-way certificate: a Tape never discards a
materialized cell, so a head that ever stepped left of the marker
leaves a blank at index 0, and unzigzag refuses that tape.

OriginSnapshot::trimmed exists because single_tape's normalize keeps no
head position on an all-blank tape, and on the lowered demo machines
the spec measured, a STACK tape that reaches cell -1 ends all blank."
```

---

### Task 2: The construction — `to_one_way`, its refusal, its ratio and its ceiling

**Files:**
- Modify: `crates/redextape-core/src/tm/one_way.rs` (replaced whole)

**Interfaces:**
- Consumes: Task 1's `LEFT_END`, `OriginSnapshot`, `zigzag`, `unzigzag`; `tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol}`.
- Produces: `pub fn to_one_way(m: &Machine) -> Machine`, `pub fn left_end_collision(m: &Machine) -> bool`, `pub fn states_per_original(m: &Machine) -> Option<f64>`. A refusal is a one-state, one-tape, non-accept machine named `left-end-collision`. Folded state names: the preamble is `pre`; a pair is `q{sid}.{sides}` with one `r`/`l` per tape; chain states carry further `.`-separated segments.

- [ ] **Step 1: Replace the module with the complete file**

Replace the whole of `crates/redextape-core/src/tm/one_way.rs` with the following. Everything above `left_end_collision` is Task 1's code with a wider `use` list; the test module drops its own `use crate::tm::machine::…` line, because `use super::*` now brings those names in, and adds `proptest`.

```rust
//! The two-way → one-way fold: a `Machine` whose tapes are infinite in both directions becomes a
//! `Machine` whose heads never visit a cell left of cell 0, by laying every tape out zig-zag behind a
//! marker and replacing each move with one to three physical steps.
//!
//! **THE LAYOUT.** Physical cell 0 holds [`LEFT_END`]; original cell `j ≥ 0` sits at physical cell
//! `2j + 1` and original cell `-(j + 1)` at physical cell `2j + 2`. An odd physical cell is on the right
//! half and an even one on the left, so [`unzigzag`] recovers a tape with no state from the run.
//!
//! **EACH TAPE'S SIDE LIVES IN THE CONTROL STATE, BECAUSE IT CANNOT LIVE ON THE TAPE.** A move right on
//! the left half is a move toward physical cell 0, so a move needs its tape's half. A cell no head has
//! visited reads `BLANK`, which says nothing about which half it is on, so a generated state stands for
//! a pair `(original state, sides)` instead. Pairs are emitted from a worklist starting at the preamble,
//! so a tape with no `Move::L` rule — which can never reach the left half — multiplies nothing.
//!
//! **RULES ARE COPIED, NOT REWRITTEN.** Reads and writes happen in place, so a pair carries its original
//! state's rules in order with identical reads and writes, and only the moves change. Nothing here
//! enumerates a symbol, which is what the roadmap's two-track fold would have had to do: `Symbol` is a
//! `char`, so a pair of symbols must be one `char`, and no rule can wildcard half of one.
//!
//! **ONE-WAYNESS IS CERTIFIED PER RUN, NOT ARGUED.** `sim.rs`'s `Tape` materializes cells lazily and
//! never discards one, so a head that ever stepped left of physical cell 0 leaves a `BLANK` at index 0
//! of every later snapshot — and this construction never writes [`LEFT_END`]. [`unzigzag`] returning
//! `Some` on a halted run is that proof.

use std::collections::{HashMap, VecDeque};

use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
use crate::tm::sim::Tape;

/// The marker at physical cell 0 of every folded tape.
///
/// **NOT NAMED `ORIGIN`.** The encodings' comments already use "origin" for a tape's cell 0 — a cell.
/// This is the symbol in one, and two meanings under one name is the drift
/// `scripts/check-attributions.sh` exists downstream of.
pub const LEFT_END: Symbol = '|';

/// One tape in ORIGINAL coordinates: its cells, the head's index into them, and the index of original
/// cell 0. `Tape::snapshot` returns the first two and cannot return the third, because a `Tape` does
/// not know where it started — which is exactly what a comparison needs once one side of it has been
/// folded.
///
/// Named fields rather than a tuple because `head` and `origin` are both `usize`, and a swap between
/// them type-checks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OriginSnapshot {
    pub cells: Vec<Symbol>,
    pub head: usize,
    pub origin: usize,
}

impl OriginSnapshot {
    /// Strip the blanks outside the window spanning every non-blank cell, the head AND the origin, and
    /// re-index both. Two trimmed snapshots are equal exactly when they hold the same symbols at the same
    /// offsets from the origin and put the head at the same offset.
    ///
    /// **THIS IS NOT `single_tape.rs`'s `normalize`, AND THE DIFFERENCE IS THE POINT.** `normalize`
    /// anchors on the non-blank cells alone, so on an all-blank tape it keeps no head position at all —
    /// and on every lowered demo machine `docs/superpowers/specs/2026-09-13-one-way-fold-design.md`
    /// measured, a STACK tape that reaches cell -1 ends all blank. A comparison built on `normalize`
    /// could not see the fold misplace a head on the tapes that exercise it.
    #[must_use]
    pub fn trimmed(&self) -> OriginSnapshot {
        let lo = self.head.min(self.origin);
        let hi = self.head.max(self.origin);
        let first = self.cells.iter().position(|c| *c != BLANK).map_or(lo, |p| p.min(lo));
        let last = self.cells.iter().rposition(|c| *c != BLANK).map_or(hi, |p| p.max(hi));
        let cells = (first..=last).map(|i| self.cells.get(i).copied().unwrap_or(BLANK)).collect();
        OriginSnapshot { cells, head: self.head - first, origin: self.origin - first }
    }
}

/// Lay `tapes` tapes out for a folded machine: [`LEFT_END`], then each initial tape's cells at the odd
/// physical cells, with a blank left-half cell between every two.
///
/// **EXACTLY `tapes` TAPES COME BACK, INCLUDING ANY `inits` DOES NOT NAME.** `trace.rs`'s `TmCursor::new`
/// gives a missing tape a plain `Tape::new(&[])`, which has no marker, and a folded machine's first
/// crossing on such a tape would walk off its left end.
///
/// `None` when an initial tape contains [`LEFT_END`] — `Machine::alphabet` cannot see initial contents,
/// so [`to_one_way`]'s own refusal cannot catch that pairing — or when `inits` holds more tapes than
/// `tapes`, which `single_tape.rs`'s `interleave` documents dropping silently.
#[must_use]
pub fn zigzag(inits: &[Vec<Symbol>], tapes: usize) -> Option<Vec<Vec<Symbol>>> {
    if inits.len() > tapes || inits.iter().flatten().any(|s| *s == LEFT_END) {
        return None;
    }
    let lay_out = |init: &[Symbol]| {
        let mut out = Vec::with_capacity(2 * init.len() + 1);
        out.push(LEFT_END);
        for (j, s) in init.iter().enumerate() {
            if j > 0 {
                out.push(BLANK);
            }
            out.push(*s);
        }
        out
    };
    Some((0..tapes).map(|i| lay_out(inits.get(i).map_or(&[][..], Vec::as_slice))).collect())
}

/// Recover one folded tape in original coordinates.
///
/// `None` when physical cell 0 is not [`LEFT_END`], when [`LEFT_END`] appears in any other materialized
/// cell, or when the head is ON physical cell 0.
///
/// **THE FIRST CONDITION IS THE ONE-WAY CERTIFICATE.** A `Tape` never discards a materialized cell, so a
/// head that ever stepped left of physical cell 0 leaves a `BLANK` at index 0 of every later snapshot,
/// and [`to_one_way`] never writes [`LEFT_END`]. The third condition never holds between original
/// steps — the preamble and every move end on physical cell 1 or beyond — but a run stopped by a cap can
/// leave a head there.
#[must_use]
pub fn unzigzag(tape: &Tape) -> Option<OriginSnapshot> {
    let (phys, head) = tape.snapshot();
    let (&marker, rest) = phys.split_first()?;
    if marker != LEFT_END || rest.contains(&LEFT_END) || head == 0 {
        return None;
    }
    // `rest[p - 1]` is physical cell `p`: odd `p` is original `(p - 1) / 2`, even `p` is `-(p / 2)`.
    let negatives = rest.len() / 2;
    let positives = rest.len() - negatives;
    let mut cells = Vec::with_capacity(rest.len());
    for n in (1..=negatives).rev() {
        cells.push(*rest.get(2 * n - 1)?);
    }
    for j in 0..positives {
        cells.push(*rest.get(2 * j)?);
    }
    let head = if head % 2 == 1 { negatives + (head - 1) / 2 } else { negatives - head / 2 };
    Some(OriginSnapshot { cells, head, origin: negatives })
}

/// Whether `m`'s rules name [`LEFT_END`] — the predicate [`to_one_way`]'s refusal is defined as. A rule
/// that wrote the marker could forge the certificate, and one that read it would match the marker as
/// data. Exported so a caller can check before building, rather than string-matching a refused
/// machine's name.
#[must_use]
pub fn left_end_collision(m: &Machine) -> bool {
    m.alphabet().contains(&LEFT_END)
}

/// Generated states per original state. `None` when [`to_one_way`] refuses `m`: a refusal is a
/// one-state machine, and dividing that by the original's state count would report a failure to build
/// as an excellent ratio — the lesson `two_symbol.rs`'s `states_per_original` records.
#[must_use]
pub fn states_per_original(m: &Machine) -> Option<f64> {
    if left_end_collision(m) {
        return None;
    }
    let folded = to_one_way(m);
    #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts, reported to 2 dp")]
    let ratio = folded.states.len() as f64 / m.states.len().max(1) as f64;
    Some(ratio)
}

/// Fold `m` onto one-way tapes over the layout [`zigzag`] builds. The tape count is preserved on a
/// machine this can build.
///
/// **REFUSES RATHER THAN BUILDING SOMETHING IT CANNOT CERTIFY.** When [`left_end_collision`] holds, this
/// returns a one-state, non-accept machine named `left-end-collision` — the shape `single_tape.rs`'s and
/// `two_symbol.rs`'s refusals take, including their fixed tape count of one.
///
/// **A PREAMBLE STARTS THE MACHINE**, stepping every head from [`LEFT_END`] onto physical cell 1, because
/// `Tape::new` starts every head on cell 0 and cell 0 is the marker. It is one state and one step.
#[must_use]
pub fn to_one_way(m: &Machine) -> Machine {
    if left_end_collision(m) {
        return refused("left-end-collision");
    }
    let mut b = Names::new(m.tapes);
    let mut queue = VecDeque::new();
    let pre = b.id("pre");
    let start = b.pair(m.start, &vec![Side::Right; m.tapes], &mut queue);
    let preamble =
        Rule { read: vec![None; m.tapes], write: vec![None; m.tapes], moves: vec![Move::R; m.tapes], next: start };
    b.push_rule(pre, preamble);
    while let Some((sid, sides)) = queue.pop_front() {
        b.emit_pair(m, sid, &sides, &mut queue);
    }
    Machine { states: b.states, start: pre, tapes: m.tapes }
}

/// The degenerate machine [`to_one_way`] returns for a refusal: one named, non-accept state.
fn refused(name: &str) -> Machine {
    Machine { states: vec![State { name: name.into(), accept: false, rules: vec![] }], start: 0, tapes: 1 }
}

/// Which half of a folded tape a head is on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    Right,
    Left,
}

impl Side {
    fn flipped(self) -> Side {
        match self {
            Side::Right => Side::Left,
            Side::Left => Side::Right,
        }
    }
}

/// `sides` spelled one letter per tape, `r` or `l`, for a state name.
fn spell(sides: &[Side]) -> String {
    sides.iter().map(|s| if *s == Side::Right { 'r' } else { 'l' }).collect()
}

/// `sides` with tape `i` on the other half.
fn with_flip(sides: &[Side], i: usize) -> Vec<Side> {
    let mut out = sides.to_vec();
    if let Some(s) = out.get_mut(i) {
        *s = s.flipped();
    }
    out
}

/// Tape `i`'s side, `Right` past the end of `sides`.
fn side_of(sides: &[Side], i: usize) -> Side {
    sides.get(i).copied().unwrap_or(Side::Right)
}

/// Tape `i`'s move in `rule`, `S` past the end of `rule.moves`. `Machine::validate` requires
/// `moves.len() == tapes`, so no valid machine reaches the default.
fn move_of(rule: &Rule, i: usize) -> Move {
    rule.moves.get(i).copied().unwrap_or(Move::S)
}

/// A move's first physical step. **It depends only on the move and the tape's side**, which is what lets
/// it ride along in the copied rule together with the write, instead of costing a state of its own.
fn first_step(side: Side, mv: Move) -> Move {
    match (side, mv) {
        (_, Move::S) => Move::S,
        (Side::Right, Move::R) | (Side::Left, Move::L) => Move::R,
        (Side::Right, Move::L) | (Side::Left, Move::R) => Move::L,
    }
}

type Queue = VecDeque<(StateId, Vec<Side>)>;

/// Assigns a `StateId` to every generated state name, so rules can name their targets before the target
/// is emitted. Names are the text form's identity and must be unique, non-empty and free of whitespace
/// and `; * : [ ]` (`Machine::validate`), which `.`-separated segments of letters and digits satisfy.
struct Names {
    ids: HashMap<String, StateId>,
    states: Vec<State>,
    tapes: usize,
}

impl Names {
    fn new(tapes: usize) -> Names {
        Names { ids: HashMap::new(), states: Vec::new(), tapes }
    }

    /// The id for `name`, minting the state on first mention.
    fn id(&mut self, name: &str) -> StateId {
        if let Some(id) = self.ids.get(name) {
            return *id;
        }
        let id = StateId::try_from(self.states.len()).unwrap_or(0);
        self.ids.insert(name.to_string(), id);
        self.states.push(State { name: name.to_string(), accept: false, rules: Vec::new() });
        id
    }

    fn push_rule(&mut self, at: StateId, rule: Rule) {
        if let Some(st) = self.states.get_mut(at as usize) {
            st.rules.push(rule);
        }
    }

    /// A rule touching only tape `i`: every other tape reads a wildcard, writes nothing and stays put.
    fn one(&self, i: usize, read: Option<Symbol>, mv: Move, next: StateId) -> Rule {
        let mut rule = Rule {
            read: vec![None; self.tapes],
            write: vec![None; self.tapes],
            moves: vec![Move::S; self.tapes],
            next,
        };
        if let Some(slot) = rule.read.get_mut(i) {
            *slot = read;
        }
        if let Some(slot) = rule.moves.get_mut(i) {
            *slot = mv;
        }
        rule
    }

    /// The state standing for original state `sid` with its tapes on `sides`, queued for emission the
    /// first time it is named. **The only place a pair's name is spelled**, so a rule targeting a pair
    /// and the pair's own emission cannot disagree about it.
    fn pair(&mut self, sid: StateId, sides: &[Side], queue: &mut Queue) -> StateId {
        let name = format!("q{sid}.{}", spell(sides));
        if !self.ids.contains_key(&name) {
            queue.push_back((sid, sides.to_vec()));
        }
        self.id(&name)
    }

    /// Emit the pair `(sid, sides)`: an accept stays an accept with no rules, and every other state
    /// carries a copy of each original rule, in order, with its moves replaced.
    ///
    /// A state with no rules gets none here either, so a stuck halt stays a stuck halt — the reduction
    /// must not invent an accept, which is what makes "the accept flags agree" an assertion. A `sid` past
    /// the end of `m.states` gets no rules for the same reason the simulator halts on one.
    fn emit_pair(&mut self, m: &Machine, sid: StateId, sides: &[Side], queue: &mut Queue) {
        let here = self.pair(sid, sides, queue);
        let Some(st) = m.states.get(sid as usize) else { return };
        if st.accept {
            if let Some(s) = self.states.get_mut(here as usize) {
                s.accept = true;
            }
            return;
        }
        let stem = format!("q{sid}.{}", spell(sides));
        for (c, rule) in st.rules.iter().enumerate() {
            let moving: Vec<usize> = (0..self.tapes).filter(|&i| move_of(rule, i) != Move::S).collect();
            let next = self.finish_moves(&format!("{stem}.c{c}"), rule, &moving, sides, queue);
            let copied = Rule {
                read: (0..self.tapes).map(|i| rule.read.get(i).copied().flatten()).collect(),
                write: (0..self.tapes).map(|i| rule.write.get(i).copied().flatten()).collect(),
                moves: (0..self.tapes).map(|i| first_step(side_of(sides, i), move_of(rule, i))).collect(),
                next,
            };
            self.push_rule(here, copied);
        }
    }

    /// Finish the moves of the tapes in `moving`, whose first physical step the copied rule has already
    /// taken, one tape at a time, and enter the pair for `rule.next`. `cur` is every tape's side so far.
    /// Returns the state to enter.
    ///
    /// | side, move | after step 1 | this emits | side flips |
    /// | --- | --- | --- | --- |
    /// | right, `R` | physical `2j + 2` | `R` | never |
    /// | left, `L` | physical `2j + 3` | `R` | never |
    /// | right, `L` | physical `2j` | reads [`LEFT_END`]? `R`, `R` : `L` | leaving cell 0 |
    /// | left, `R` | physical `2j + 1` | `L`, then reads [`LEFT_END`]? `R` : stay | leaving cell -1 |
    ///
    /// **NEITHER CROSSING STEPS LEFT OF PHYSICAL CELL 0.** From original cell 0 (physical 1) the first
    /// `L` lands on the marker; from original cell -1 (physical 2) the two `L`s do.
    ///
    /// A crossing check has two exits, so each later tape's chain is built once per exit. Every path
    /// through one rule's chain flips a different subset of `moving`, so no `(tape, cur)` is reached twice
    /// and no state is emitted twice.
    fn finish_moves(&mut self, stem: &str, rule: &Rule, moving: &[usize], cur: &[Side], queue: &mut Queue) -> StateId {
        let Some((&i, rest)) = moving.split_first() else {
            return self.pair(rule.next, cur, queue);
        };
        let base = format!("{stem}.t{i}.{}", spell(cur));
        let same = self.finish_moves(stem, rule, rest, cur, queue);
        match (side_of(cur, i), move_of(rule, i)) {
            // Unreachable: `moving` holds only tapes whose move is not `S`.
            (_, Move::S) => same,
            (Side::Right, Move::R) | (Side::Left, Move::L) => {
                let fin = self.id(&format!("{base}.fin"));
                let outward = self.one(i, None, Move::R, same);
                self.push_rule(fin, outward);
                fin
            }
            (Side::Right, Move::L) => {
                let crossed = self.finish_moves(stem, rule, rest, &with_flip(cur, i), queue);
                let chk = self.id(&format!("{base}.chk"));
                let over = self.id(&format!("{base}.over"));
                let on_marker = self.one(i, Some(LEFT_END), Move::R, over);
                self.push_rule(chk, on_marker);
                let inside = self.one(i, None, Move::L, same);
                self.push_rule(chk, inside);
                let onto_minus_one = self.one(i, None, Move::R, crossed);
                self.push_rule(over, onto_minus_one);
                chk
            }
            (Side::Left, Move::R) => {
                let crossed = self.finish_moves(stem, rule, rest, &with_flip(cur, i), queue);
                let inward = self.id(&format!("{base}.in"));
                let chk = self.id(&format!("{base}.chk"));
                let toward = self.one(i, None, Move::L, chk);
                self.push_rule(inward, toward);
                let on_marker = self.one(i, Some(LEFT_END), Move::R, crossed);
                self.push_rule(chk, on_marker);
                let inside = self.one(i, None, Move::S, same);
                self.push_rule(chk, inside);
                inward
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::sim::{DEFAULT_CAPS, Status, simulate_final};
    use crate::tm::single_tape::normalize;
    use proptest::prelude::*;

    fn rule1(read: Option<Symbol>, write: Option<Symbol>, mv: Move, next: StateId) -> Rule {
        Rule { read: vec![read], write: vec![write], moves: vec![mv], next }
    }

    fn accept(name: &str) -> State {
        State { name: name.into(), accept: true, rules: vec![] }
    }

    /// A one-tape machine taking `steps` in order — each a wildcard read, an optional write and a move —
    /// then accepting.
    fn walk(steps: &[(Option<Symbol>, Move)]) -> Machine {
        let mut states: Vec<State> = steps
            .iter()
            .enumerate()
            .map(|(k, (write, mv))| State {
                name: format!("s{k}"),
                accept: false,
                rules: vec![rule1(None, *write, *mv, StateId::try_from(k + 1).unwrap_or(0))],
            })
            .collect();
        states.push(accept("done"));
        Machine { states, start: 0, tapes: 1 }
    }

    /// Every pair state's `sides`, read back from its name `q{sid}.{sides}`. Chain states carry more
    /// dots and the preamble none, so exactly one dot picks out the pairs.
    fn pair_sides(folded: &Machine) -> Vec<String> {
        folded
            .states
            .iter()
            .filter(|s| s.name.starts_with('q') && s.name.matches('.').count() == 1)
            .filter_map(|s| s.name.split_once('.').map(|(_, sides)| sides.to_string()))
            .collect()
    }

    #[test]
    fn zigzag_lays_out_both_halves_and_marks_every_tape() {
        assert_eq!(
            zigzag(&[vec!['a', 'b', 'c']], 2),
            Some(vec![vec![LEFT_END, 'a', BLANK, 'b', BLANK, 'c'], vec![LEFT_END]]),
            "a second tape `inits` does not name still gets its marker"
        );
    }

    #[test]
    fn zigzag_refuses_a_marker_in_the_data_and_a_tape_it_would_drop() {
        assert_eq!(zigzag(&[vec!['a', LEFT_END]], 1), None);
        assert_eq!(zigzag(&[vec![], vec![]], 1), None);
        assert!(zigzag(&[vec!['a']], 1).is_some(), "the refusals above must not be a refusal of everything");
    }

    #[test]
    fn unzigzag_reads_both_halves_back_in_original_order() {
        // One step right, from the marker onto physical cell 1 — what the preamble does, written by hand
        // so this test does not depend on `to_one_way`.
        let step = walk(&[(None, Move::R)]);
        let (tapes, _s, status, _n) = simulate_final(&step, &[vec![LEFT_END, 'a', 'x', 'b', 'y']], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(unzigzag(&tapes[0]), Some(OriginSnapshot { cells: vec!['y', 'x', 'a', 'b'], head: 2, origin: 2 }));
    }

    #[test]
    fn unzigzag_refuses_a_head_on_the_marker_a_missing_marker_and_a_second_marker() {
        assert_eq!(unzigzag(&Tape::new(&[LEFT_END, 'a'])), None, "head on physical cell 0");
        let step = walk(&[(None, Move::R)]);
        for (cells, accepted) in [
            (vec![LEFT_END, 'a', BLANK, 'b'], true),
            (vec!['x', 'a', BLANK, 'b'], false),
            (vec![LEFT_END, 'a', LEFT_END, 'b'], false),
        ] {
            let (tapes, _s, status, _n) = simulate_final(&step, std::slice::from_ref(&cells), DEFAULT_CAPS);
            assert_eq!(status, Status::Halted);
            assert_eq!(unzigzag(&tapes[0]).is_some(), accepted, "for {cells:?}");
        }
    }

    #[test]
    fn trimmed_keeps_the_head_where_normalize_discards_it() {
        let a = OriginSnapshot { cells: vec![BLANK; 5], head: 1, origin: 3 };
        let b = OriginSnapshot { cells: vec![BLANK; 5], head: 3, origin: 3 };
        assert_eq!(normalize(&a.cells, a.head), normalize(&b.cells, b.head), "the blind spot `trimmed` exists for");
        assert_ne!(a.trimmed(), b.trimmed());
        assert_eq!(a.trimmed(), OriginSnapshot { cells: vec![BLANK; 3], head: 0, origin: 2 });
    }

    #[test]
    fn an_accepting_start_state_halts_after_the_preamble_alone() {
        let m = Machine { states: vec![accept("done")], start: 0, tapes: 1 };
        let folded = to_one_way(&m);
        assert_eq!(folded.validate(), Vec::<String>::new());
        let cells = zigzag(&[vec!['a', 'b']], 1).expect("no marker in the data");
        let (tapes, state, status, steps) = simulate_final(&folded, &cells, DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(steps, 1, "the preamble is the only step");
        assert!(folded.states[state as usize].accept, "halted in `{}`", folded.states[state as usize].name);
        let back = unzigzag(&tapes[0]).expect("the preamble leaves the head on physical cell 1");
        assert_eq!(back.trimmed(), OriginSnapshot { cells: vec!['a', 'b'], head: 0, origin: 0 });
    }

    #[test]
    fn a_stuck_original_stays_stuck_and_does_not_become_an_accept() {
        let m = Machine { states: vec![State { name: "s0".into(), accept: false, rules: vec![] }], start: 0, tapes: 1 };
        let folded = to_one_way(&m);
        assert_eq!(folded.validate(), Vec::<String>::new());
        let (_t, state, status, _n) = simulate_final(&folded, &[vec![LEFT_END]], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert!(!folded.states[state as usize].accept, "halted in an ACCEPT, but the original is stuck");
    }

    /// Every move row, both crossings and a left excursion three cells deep, against a final tape derived
    /// by hand — and the hand derivation checked against the unfolded run, so a wrong expectation cannot
    /// pass as a right construction.
    ///
    /// Write `x` walking left three cells from cell 0, then `y` walking right five: cells -3..=1 end `y`,
    /// the head ends on cell 2, and the original tape grew three cells on its left.
    #[test]
    fn a_toy_machine_matches_its_fold_cell_for_cell_across_the_origin() {
        let x = Some('x');
        let y = Some('y');
        let m = walk(&[
            (x, Move::L),
            (x, Move::L),
            (x, Move::L),
            (y, Move::R),
            (y, Move::R),
            (y, Move::R),
            (y, Move::R),
            (y, Move::R),
        ]);
        let inits = vec![vec!['a', 'b']];
        let expected = OriginSnapshot { cells: vec!['y', 'y', 'y', 'y', 'y', BLANK], head: 5, origin: 3 }.trimmed();

        let (want, _ws, want_status, _wn) = simulate_final(&m, &inits, DEFAULT_CAPS);
        assert_eq!(want_status, Status::Halted);
        let (w_cells, w_head) = want[0].snapshot();
        assert_eq!(
            OriginSnapshot { cells: w_cells, head: w_head, origin: 3 }.trimmed(),
            expected,
            "the hand derivation"
        );

        let folded = to_one_way(&m);
        assert_eq!(folded.validate(), Vec::<String>::new());
        let cells = zigzag(&inits, 1).expect("no marker in the data");
        let (got, state, status, _n) = simulate_final(&folded, &cells, DEFAULT_CAPS);
        let back = unzigzag(&got[0]).expect("the certificate: the fold never stepped left of physical cell 0");
        assert_eq!(status, Status::Halted);
        assert_eq!(back.trimmed(), expected);
        assert!(folded.states[state as usize].accept, "halted in `{}`", folded.states[state as usize].name);
    }

    #[test]
    fn a_machine_naming_the_marker_is_refused_and_has_no_ratio() {
        let m = walk(&[(Some(LEFT_END), Move::R)]);
        assert!(left_end_collision(&m));
        let folded = to_one_way(&m);
        assert_eq!(folded.states.len(), 1, "a refusal is the degenerate one-state machine, not a partial build");
        assert!(!folded.states[0].accept, "a refusal must not be an accept");
        assert_eq!(folded.states[0].name, "left-end-collision");
        assert_eq!(states_per_original(&m), None, "a refusal must not be reported as a ratio");
        assert!(states_per_original(&walk(&[(Some('a'), Move::R)])).is_some(), "and a clean machine has one");
    }

    /// Tape 0 crosses into the left half; tape 1 only ever moves right, so no reachable pair may put it on
    /// the left — the property that keeps the multiplier at `2^(tapes with a Move::L rule)` rather than
    /// `2^tapes`.
    #[test]
    fn a_tape_with_no_left_move_is_never_on_the_left_half() {
        let m = Machine {
            states: vec![
                State {
                    name: "s0".into(),
                    accept: false,
                    rules: vec![Rule {
                        read: vec![None, None],
                        write: vec![None, None],
                        moves: vec![Move::L, Move::R],
                        next: 1,
                    }],
                },
                accept("done"),
            ],
            start: 0,
            tapes: 2,
        };
        let sides = pair_sides(&to_one_way(&m));
        assert!(sides.iter().any(|s| s.starts_with('l')), "the fixture must put tape 0 on the left: {sides:?}");
        assert!(sides.iter().all(|s| s.chars().nth(1) == Some('r')), "tape 1 reached the left half: {sides:?}");
    }

    proptest! {
        /// The round trip through the real preamble: fold arbitrary tapes, run a machine that accepts at
        /// once, and every tape comes back. Compared trimmed, because `zigzag` materializes a blank
        /// left-half cell between every two content cells, so `unzigzag` alone reports an origin past 0.
        #[test]
        fn zigzag_then_the_preamble_then_unzigzag_gives_the_tapes_back(
            tapes in prop::collection::vec(prop::collection::vec(prop::sample::select(vec!['a', 'b', BLANK]), 0..6), 1..4)
        ) {
            let m = Machine { states: vec![accept("done")], start: 0, tapes: tapes.len() };
            let folded = to_one_way(&m);
            let cells = zigzag(&tapes, tapes.len()).expect("no marker in the data");
            let (got, _s, status, _n) = simulate_final(&folded, &cells, DEFAULT_CAPS);
            prop_assert_eq!(status, Status::Halted);
            for (i, tape) in tapes.iter().enumerate() {
                let back = unzigzag(&got[i]).expect("the preamble leaves every head on physical cell 1");
                prop_assert_eq!(back.trimmed(), OriginSnapshot { cells: tape.clone(), head: 0, origin: 0 }.trimmed());
            }
        }
    }

    fn demo_machine(src: &str, enc: crate::tm::EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
        let (prog, ds) = crate::parser::parse(src);
        assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
        let prog = prog.expect("a program");
        let ty = crate::typeck::result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
        let core = crate::desugar::desugar(&prog);
        let d = crate::tm::run_tm_described(&core, enc, ty, crate::tm::TM_DEFAULT_CAPS)
            .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
        let init = d.header.init(d.machine.tapes);
        (d.machine, init)
    }

    /// The ratio [`to_one_way`] may not exceed on the corpus below, as a PROPERTY rather than a restated
    /// measurement: an oracle leg can never redden for a cost regression, because a bloated-but-correct
    /// construction is still correct. Set above the highest ratio that corpus measured when this module
    /// was written, and each row prints its margin in STATES, because a percentage does not say whether
    /// the next generated state is the one that trips it.
    ///
    /// **NOT A CEILING EVERY SHIPPED MACHINE MEETS.** The largest shipped demo — `single_tape.rs`'s
    /// `the_worst_shipped_demo_measured_directly` builds it — has four tapes with a `Move::L` rule where
    /// this corpus has two or three, and folded to 7,363,253 states against `MAX_MACHINE_STATES` of
    /// 1,000,000 when measured on 2026-09-13. That is recorded in the roadmap entry, not gated here.
    const STATE_CEILING: f64 = 40.0;

    /// Also prints, per row, how many `sides` combinations the worklist reached against `2^n` for `n`
    /// tapes with a `Move::L` rule — whether emitting only reachable pairs saves anything is a
    /// measurement, not a promise.
    #[test]
    fn the_fold_stays_under_its_state_ceiling() {
        for src in
            ["1 + 2 * 3", "cons(1, cons(2, nil))", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"]
        {
            for enc in [crate::tm::EncodingKind::Unary, crate::tm::EncodingKind::Binary] {
                let (m, _inits) = demo_machine(src, enc);
                let ratio = states_per_original(&m).expect("no lowered machine names the marker");
                let folded = to_one_way(&m);
                let mut sides = pair_sides(&folded);
                sides.sort();
                sides.dedup();
                let lefty = (0..m.tapes)
                    .filter(|&i| m.states.iter().flat_map(|s| &s.rules).any(|r| move_of(r, i) == Move::L))
                    .count();
                #[expect(clippy::cast_precision_loss, reason = "a state count, in a states margin")]
                let margin = (STATE_CEILING - ratio) * m.states.len() as f64;
                println!(
                    "{src:60} {enc:?} states {} -> {} ratio {ratio:.6} sides {} of 2^{lefty} margin {margin:.0} states",
                    m.states.len(),
                    folded.states.len(),
                    sides.len()
                );
                assert!(ratio < STATE_CEILING, "{src} at {enc:?} measures {ratio:.6} against {STATE_CEILING}");
            }
        }
    }
}
```

- [ ] **Step 2: Run the tests, and read the ceiling table**

Run: `cargo nextest run -p redextape-core --lib tm::one_way --no-capture`
Expected: PASS, 12 tests. `the_fold_stays_under_its_state_ceiling` prints six rows matching the first three rows of *Verified during planning*; the tightest margin is `cons(1, cons(2, nil))` under `Binary`, at 1,805 states.

- [ ] **Step 3: Format and lint**

Run: `cargo fmt -p redextape-core --check && cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm/one_way.rs
git commit -m "Fold a machine onto one-way tapes

to_one_way copies every rule's reads and writes unchanged and replaces
only its moves: a move's first physical step depends on nothing but its
direction and the tape's side, so it rides in the copied rule, and the
rest of each tape's move follows in a chain. A move toward the origin
reads for the marker, and crossing it flips that tape's side, which the
control state carries as (original state, sides) pairs emitted from a
worklist.

Measured on the corpus the ceiling gates, the worklist saves nothing:
every 2^n combination of sides is reachable. The ratio peaks at
34.63 for binary sum(5), under a ceiling of 40. The largest shipped
demo folds to 7,363,253 states and cannot be built under the cap; that
is recorded, not gated."
```

- [ ] **Step 5: Sabotage the construction, one change at a time**

For each sabotage below: make the change in `crates/redextape-core/src/tm/one_way.rs`, run `cargo nextest run -p redextape-core --lib tm::one_way --no-fail-fast`, compare with the prediction, then `git checkout crates/redextape-core/src/tm/one_way.rs`. Report each result.

**S1 — the right half never looks for the marker.** Delete these two lines, from the `(Side::Right, Move::L)` arm of `finish_moves`:

```rust
                let on_marker = self.one(i, Some(LEFT_END), Move::R, over);
                self.push_rule(chk, on_marker);
```

Prediction (measured while planning): 1 failed, 11 passed. `a_toy_machine_matches_its_fold_cell_for_cell_across_the_origin` fails at its `expect("the certificate: the fold never stepped left of physical cell 0")` — the certificate, not the tape comparison.

**S2 — a left-half `L` strides one physical cell instead of two.** Replace:

```rust
            (_, Move::S) => same,
```

with:

```rust
            (_, Move::S) => same,
            (Side::Left, Move::L) => same,
```

Prediction (measured): 1 failed, 11 passed. The toy test fails at `assert_eq!(back.trimmed(), expected)` — it goes three cells deep, which is what lets it see a depth-2 defect.

**S4 — a crossing's flip is lost whenever a later tape also moves in the same rule.** Replace, in the `(Side::Right, Move::L)` arm:

```rust
                let crossed = self.finish_moves(stem, rule, rest, &with_flip(cur, i), queue);
                let chk = self.id(&format!("{base}.chk"));
```

with:

```rust
                let carried = if rest.is_empty() { with_flip(cur, i) } else { cur.to_vec() };
                let crossed = self.finish_moves(stem, rule, rest, &carried, queue);
                let chk = self.id(&format!("{base}.chk"));
```

Prediction (measured): 1 failed, 11 passed. `a_tape_with_no_left_move_is_never_on_the_left_half` fails at its FIRST assertion, `the fixture must put tape 0 on the left: ["rr", "rr"]`. The toy test stays green: it has one tape, so no later tape exists to lose the flip behind.

**S5 — a flip flips every tape.** Replace, in `with_flip`:

```rust
    if let Some(s) = out.get_mut(i) {
        *s = s.flipped();
    }
```

with:

```rust
    for s in &mut out {
        *s = s.flipped();
    }
    let _ = i;
```

Prediction (measured): 1 failed, 11 passed. `a_tape_with_no_left_move_is_never_on_the_left_half` fails at its SECOND assertion, `tape 1 reached the left half`. **S4 cannot show that assertion failing, because S4 stops at the first; S5 is what does.**

After the last one: `git status` shows a clean tree.

---

### Task 3: Leg 6, the origin watcher, and the cost table

**Files:**
- Create: `crates/redextape-core/tests/one_way_oracle.rs`

**Interfaces:**
- Consumes: Task 2's `to_one_way`; Task 1's `OriginSnapshot`, `zigzag`, `unzigzag`; `tm::sim::{simulate_final, simulate_watched, Tape}`; `tm::run_tm_described`.
- Produces, for Tasks 4 and 5: `fn build_machine(&str, EncodingKind) -> (Machine, Vec<Vec<Symbol>>)`, `fn run_with_origins(&Machine, &[Vec<Symbol>], Caps) -> (Vec<OriginSnapshot>, StateId, Status, u64)`, `struct Outcome { want: Vec<OriginSnapshot>, want_steps: u64, got_steps: u64, want_accept: bool, got_accept: bool }`, `fn assert_fold_agrees(&str, &Machine, &[Vec<Symbol>], Caps) -> Outcome`, `const CORPUS: &[&str]`, `fn walk(&[(Option<Symbol>, Move)]) -> Machine`.

- [ ] **Step 1: Confirm the corpus still belongs to `FIRST_ORDER_DEMOS`**

Run: `grep -cF -e '"3 - 5"' -e '"if 2 > 1 { 10 } else { 20 }"' -e '"cons(1, cons(2, nil))"' -e 'fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))' crates/redextape-native/tests/native_oracle.rs`
Expected: `4`. A member that is not in `FIRST_ORDER_DEMOS` gets no four-way chain for leg 6 to extend; if the count is lower, stop and report.

- [ ] **Step 2: Create the oracle file**

Create `crates/redextape-core/tests/one_way_oracle.rs`:

```rust
//! The sixth oracle leg: `multitape-TM == one-way-TM`, on programs whose earlier equalities
//! `native_oracle.rs`'s `FIRST_ORDER_DEMOS` suite already asserts. Compared per tape relative to the
//! ORIGIN, not with `single_tape.rs`'s `normalize`: the tapes that cross into the left half include
//! tapes that end all blank, where `normalize` keeps no head position.
//!
//! Also: the slow-tier cost table.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
use redextape_core::tm::one_way::{OriginSnapshot, to_one_way, unzigzag, zigzag};
use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final, simulate_watched};
use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, run_tm_described};
use redextape_core::ty::Ty;
use redextape_core::typeck::result_type;

fn core_and_ty(src: &str) -> (Core, Ty) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let prog = prog.expect("a program");
    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
    (desugar(&prog), ty)
}

fn build_machine(src: &str, enc: EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
    let (core, ty) = core_and_ty(src);
    let d = run_tm_described(&core, enc, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
    assert!(matches!(d.run, TmRun::Ran { .. }), "the source machine must complete for {src:?}");
    let init = d.header.init(d.machine.tapes);
    (d.machine, init)
}

/// Run `m` and record where each tape's origin ends up in its final snapshot.
///
/// **A TAPE GROWS ON ITS LEFT EXACTLY WHEN, AFTER A STEP, IT IS LONGER AND ITS HEAD IS AT INDEX 0.** A
/// step moves a head at most one cell, so a tape grows by at most one; growth on the right leaves the
/// head at index 1 or beyond. The count of left growths is the origin's index. `slice(0, usize::MAX)`
/// is the tape's length, O(tape) per step — affordable for machines that halt in thousands of steps,
/// which is every machine this file runs through it.
fn run_with_origins(m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (Vec<OriginSnapshot>, StateId, Status, u64) {
    let mut len: Vec<usize> = (0..m.tapes).map(|i| inits.get(i).map_or(1, |t| t.len().max(1))).collect();
    let mut grown = vec![0usize; m.tapes];
    let mut steps = 0u64;
    let (tapes, state, status) = {
        let mut watch = |tapes: &[Tape]| {
            steps += 1;
            for (i, t) in tapes.iter().enumerate() {
                let l = t.slice(0, usize::MAX).len();
                if l > len[i] && t.head_index() == 0 {
                    grown[i] += l - len[i];
                }
                len[i] = l;
            }
            true
        };
        simulate_watched(m, inits, caps, &mut watch)
    };
    let snaps = tapes
        .iter()
        .zip(&grown)
        .map(|(t, &origin)| {
            let (cells, head) = t.snapshot();
            OriginSnapshot { cells, head, origin }
        })
        .collect();
    (snaps, state, status, steps)
}

struct Outcome {
    want: Vec<OriginSnapshot>,
    want_steps: u64,
    got_steps: u64,
    want_accept: bool,
    got_accept: bool,
}

/// The leg, over any machine and its tapes. **The certificate is asserted before the status**, so a
/// construction that walks off the left end and then runs to a cap reports the certificate, not the cap.
fn assert_fold_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> Outcome {
    let (want, want_state, want_status, want_steps) = run_with_origins(m, inits, caps);
    assert_eq!(want_status, Status::Halted, "the source run must halt for {label}");

    let folded = to_one_way(m);
    assert_eq!(folded.validate(), Vec::<String>::new(), "the folded machine must be well formed for {label}");
    let cells = zigzag(inits, m.tapes).expect("no initial tape holds LEFT_END");
    let (got, got_state, got_status, got_steps) = simulate_final(&folded, &cells, caps);
    assert_eq!(got.len(), want.len(), "tape counts differ for {label}");
    let back: Vec<OriginSnapshot> = got
        .iter()
        .enumerate()
        .map(|(i, t)| {
            unzigzag(t)
                .unwrap_or_else(|| panic!("tape {i} of {label}: stepped left of cell 0, or is not a folded tape"))
        })
        .collect();
    assert_eq!(got_status, Status::Halted, "the folded run hit a cap for {label}");
    for (i, (w, g)) in want.iter().zip(&back).enumerate() {
        assert_eq!(g.trimmed(), w.trimmed(), "tape {i} differs for {label}");
    }
    Outcome {
        want_accept: m.states.get(want_state as usize).is_some_and(|s| s.accept),
        got_accept: folded.states.get(got_state as usize).is_some_and(|s| s.accept),
        want,
        want_steps,
        got_steps,
    }
}

const TAPE_NAMES: [&str; 5] = ["reg", "work", "stack", "heap", "box"];

/// Every member is a member of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`, whose four-way oracle supplies
/// the earlier equalities, and the same four programs `two_symbol_oracle.rs` runs.
const CORPUS: &[&str] = &[
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "cons(1, cons(2, nil))",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
];

#[test]
fn the_one_way_leg_agrees_on_small_programs() {
    let mut cases: Vec<(&str, EncodingKind)> = CORPUS.iter().map(|s| (*s, EncodingKind::Unary)).collect();
    cases.push(("cons(1, cons(2, nil))", EncodingKind::Binary));
    for (src, enc) in cases {
        let (m, inits) = build_machine(src, enc);
        assert_eq!(m.tapes, TAPE_NAMES.len(), "the tape names below would silently truncate");
        let label = format!("{src} ({enc:?})");
        let out = assert_fold_agrees(&label, &m, &inits, DEFAULT_CAPS);
        assert!(out.got_accept, "the folded run must halt in an accept for {label}");
        assert!(out.want_accept, "and so must the source run, for {label}");
        let left: Vec<String> = out
            .want
            .iter()
            .zip(TAPE_NAMES)
            .filter(|(s, _)| s.origin > 0)
            .map(|(s, name)| {
                let ends = if s.cells.iter().all(|c| *c == BLANK) { "ends blank" } else { "ends non-blank" };
                format!("{name} to -{} ({ends})", s.origin)
            })
            .collect();
        println!("{label:84} left of cell 0: {}", left.join(", "));
        assert!(!left.is_empty(), "no tape of {label} went left of cell 0, so this leg's crossings are vacuous for it");
    }
}

/// A one-tape machine taking `steps` in order — each a wildcard read, an optional write and a move — then
/// accepting.
fn walk(steps: &[(Option<Symbol>, Move)]) -> Machine {
    let mut states: Vec<State> = steps
        .iter()
        .enumerate()
        .map(|(k, (write, mv))| State {
            name: format!("s{k}"),
            accept: false,
            rules: vec![Rule { read: vec![None], write: vec![*write], moves: vec![*mv], next: (k + 1) as StateId }],
        })
        .collect();
    states.push(State { name: "done".into(), accept: true, rules: vec![] });
    Machine { states, start: 0, tapes: 1 }
}

#[test]
fn the_origin_watcher_counts_left_growth_and_nothing_else() {
    let lr = walk(&[
        (None, Move::L),
        (None, Move::L),
        (None, Move::L),
        (None, Move::R),
        (None, Move::R),
        (None, Move::R),
        (None, Move::R),
        (None, Move::R),
    ]);
    let (snaps, _s, status, steps) = run_with_origins(&lr, &[vec!['a', 'b']], DEFAULT_CAPS);
    assert_eq!((status, steps), (Status::Halted, 8));
    assert_eq!((snaps[0].origin, snaps[0].head), (3, 5), "three cells grown on the left; the head ends on cell 2");

    let r = walk(&[(None, Move::R), (None, Move::R), (None, Move::R)]);
    let (snaps, _s, status, _n) = run_with_origins(&r, &[vec!['a']], DEFAULT_CAPS);
    assert_eq!(status, Status::Halted);
    assert_eq!((snaps[0].origin, snaps[0].head), (0, 3), "growth on the right is not growth on the left");
}

/// The roadmap's point: "polynomial slowdown is normally a hand-wave; here step counts are exact
/// integers". **TWO PREDICTIONS THIS TESTS**, both from the spec: folded steps come to about twice the
/// source's, and the ratio does not grow with tape length, because the fold is local — no move costs more
/// than three physical steps — where stage 1's every step sweeps the whole tape. `longest tape` is printed
/// so the second prediction is read off the table rather than asserted in prose.
#[test]
#[ignore = "slow tier: run via cargo nextest run -p redextape-core --test one_way_oracle --run-ignored all"]
fn the_one_way_cost_table() {
    for src in ["1 + 2 * 3", "let x = 40; x + 2", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"] {
        for enc in [EncodingKind::Unary, EncodingKind::Binary] {
            let (m, inits) = build_machine(src, enc);
            let label = format!("{src} ({enc:?})");
            let out = assert_fold_agrees(&label, &m, &inits, DEFAULT_CAPS);
            let lefty = (0..m.tapes)
                .filter(|&i| m.states.iter().flat_map(|s| &s.rules).any(|r| r.moves.get(i) == Some(&Move::L)))
                .count();
            let longest = out.want.iter().map(|s| s.cells.len()).max().unwrap_or(0);
            let ratio = out.got_steps as f64 / out.want_steps as f64;
            println!(
                "{label:80} tapes with L {lefty}  longest tape {longest:>4}  source {:>7}  folded {:>8}  ratio {ratio:.3}x",
                out.want_steps, out.got_steps
            );
        }
    }
}
```

- [ ] **Step 3: Run the normal tier**

Run: `cargo nextest run -p redextape-core --test one_way_oracle --no-capture`
Expected: PASS — 2 tests run, 1 skipped. The leg prints one line per case, matching the *leg 6's left excursions* row of *Verified during planning*: `3 - 5 (Unary)`: `work to -1 (ends blank)`; `if 2 > 1 { 10 } else { 20 } (Unary)`: `work to -1 (ends non-blank)`; `cons(1, cons(2, nil)) (Unary)`: `work to -1 (ends non-blank), heap to -1 (ends non-blank)`; `fn add1(x) … (Unary)`: `work to -1 (ends non-blank), stack to -1 (ends blank)`; `cons(1, cons(2, nil)) (Binary)`: `heap to -1 (ends non-blank)`.

- [ ] **Step 4: Run the cost table**

Run: `cargo nextest run --release -p redextape-core --test one_way_oracle --run-ignored only --no-capture`
Expected: PASS — 1 test run. Six rows matching the *cost table* row of *Verified during planning*. Both predictions held while planning: every ratio sits between 1.971x and 2.069x, while the longest tape ranges from 26 to 302 cells.

- [ ] **Step 5: Format and lint**

Run: `cargo fmt -p redextape-core --check && cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/tests/one_way_oracle.rs
git commit -m "The sixth oracle leg: multi-tape == one-way, compared at the origin

Every corpus member is a FIRST_ORDER_DEMOS entry and every one crosses
into the left half on at least one tape, which the leg asserts per
program rather than claiming. It compares OriginSnapshots anchored at
the origin, not normalize, because the STACK tape of the fn program
reaches cell -1 and ends all blank, where normalize keeps no head.

The certificate is asserted before the run's status, so a fold that
walks off the left end and then spins reports the certificate.

The cost table tests the spec's two predictions: folded steps are
1.971x-2.069x the source's, flat across tapes from 26 to 302 cells."
```

- [ ] **Step 7: Sabotage the leg**

Apply each change from Task 2 Step 5 in turn to `crates/redextape-core/src/tm/one_way.rs`, run `cargo nextest run -p redextape-core --test one_way_oracle --no-fail-fast`, compare, then `git checkout crates/redextape-core/src/tm/one_way.rs`.

| sabotage | prediction (measured while planning) |
| --- | --- |
| S1 | `the_one_way_leg_agrees_on_small_programs` fails with `tape 1 of 3 - 5 (Unary): stepped left of cell 0, or is not a folded tape` — the certificate, on the FIRST member. **The loop stops there, so this shows nothing about the later members.** |
| S2 | **The leg stays GREEN.** No corpus tape goes below cell -1, so a left half that strides one cell instead of two is never exercised. Task 4 exists because of this. |
| S4 | **The leg stays GREEN.** Its lowered machines never lose a flip this way. Task 4's two-tape test exists because of this. |
| S5 | the leg fails with `tape 0 differs for cons(1, cons(2, nil)) (Unary)`. |

`the_origin_watcher_counts_left_growth_and_nothing_else` stays green under all four: it never runs a folded machine. After the last one: `git status` shows a clean tree.

---

### Task 4: The deep excursions the corpus cannot supply

**Files:**
- Modify: `crates/redextape-core/tests/one_way_oracle.rs`

**Interfaces:**
- Consumes: Task 3's `assert_fold_agrees`, `run_with_origins`, `walk`, `Outcome`.
- Produces: `fn acyclic_machine() -> impl Strategy<Value = (Machine, Vec<Vec<Symbol>>)>`.

- [ ] **Step 1: Update the module doc and add the proptest import**

In `one_way_oracle.rs`, replace:

```rust
//! Also: the slow-tier cost table.
```

with:

```rust
//! Also: the deep excursions no lowered demo machine makes, and the slow-tier cost table.
```

and replace:

```rust
use redextape_core::core::Core;
```

with:

```rust
use proptest::prelude::*;
use redextape_core::core::Core;
```

- [ ] **Step 2: Append the tests**

Append to the end of `one_way_oracle.rs`:

```rust

/// **NO LOWERED DEMO MACHINE GOES BELOW CELL -1**, so the corpus cannot tell a correct fold from one that
/// is right only one cell deep. Five cells left writing `x`, then eight right writing `y`, crossing the
/// origin in both directions.
#[test]
fn a_five_cell_excursion_left_and_back_agrees() {
    let x = Some('x');
    let y = Some('y');
    let mut steps = vec![(x, Move::L); 5];
    steps.extend(vec![(y, Move::R); 8]);
    let m = walk(&steps);
    let out = assert_fold_agrees("depth 5", &m, &[vec!['a', 'b']], DEFAULT_CAPS);
    assert_eq!(out.want[0].origin, 5, "the fixture must actually reach cell -5");
    assert!(out.want_accept && out.got_accept);
}

/// Both tapes cross the origin inside ONE rule, in both directions, so both side bits flip at once and the
/// chain has to carry the first flip into the second tape's move. Distinct writes on every step make a
/// misplaced head show up as a misplaced symbol.
#[test]
fn two_tapes_crossing_the_origin_in_one_rule_agree() {
    let step = |w0: Symbol, m0: Move, w1: Symbol, m1: Move, next: StateId| Rule {
        read: vec![None, None],
        write: vec![Some(w0), Some(w1)],
        moves: vec![m0, m1],
        next,
    };
    let state = |name: &str, rule: Rule| State { name: name.into(), accept: false, rules: vec![rule] };
    let m = Machine {
        states: vec![
            state("s0", step('a', Move::L, 'b', Move::L, 1)),
            state("s1", step('c', Move::R, 'd', Move::L, 2)),
            state("s2", step('e', Move::L, 'f', Move::R, 3)),
            state("s3", step('g', Move::R, 'h', Move::R, 4)),
            State { name: "done".into(), accept: true, rules: vec![] },
        ],
        start: 0,
        tapes: 2,
    };
    let out = assert_fold_agrees("two tapes crossing together", &m, &[vec!['p'], vec!['q']], DEFAULT_CAPS);
    assert_eq!((out.want[0].origin, out.want[1].origin), (1, 2), "the fixture must take tape 0 to -1 and tape 1 to -2");
    assert!(out.want_accept && out.got_accept);
}

/// Random machines whose rules only ever target a higher-numbered state, so every run halts within as
/// many steps as there are states. Moves lean left, since the left half is what this exists to reach.
fn acyclic_machine() -> impl Strategy<Value = (Machine, Vec<Vec<Symbol>>)> {
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

proptest! {
    #[test]
    fn random_acyclic_machines_agree_with_their_fold((m, inits) in acyclic_machine()) {
        let out = assert_fold_agrees("a random acyclic machine", &m, &inits, DEFAULT_CAPS);
        // NOT leg 6's accept requirement: a random machine can legitimately halt stuck.
        prop_assert_eq!(out.want_accept, out.got_accept);
    }
}

/// **A GREEN PROPTEST SAYS NOTHING ABOUT HOW DEEP IT WENT**, so the generator's reach is measured on a
/// fixed seed and held. The floor is a tenth of the cases reaching cell -2, set well under what the
/// generator measured when this was written, so it trips when the generator stops reaching depth rather
/// than on a small change in the mix; the printed line gives the live counts.
#[test]
fn the_acyclic_generator_reaches_deep_excursions() {
    use proptest::strategy::ValueTree;
    use proptest::test_runner::TestRunner;
    let mut runner = TestRunner::deterministic();
    let strategy = acyclic_machine();
    let (mut deep, mut crossed, total) = (0usize, 0usize, 256usize);
    for _ in 0..total {
        let (m, inits) = strategy.new_tree(&mut runner).unwrap().current();
        let (snaps, _s, _status, _n) = run_with_origins(&m, &inits, DEFAULT_CAPS);
        let depth = snaps.iter().map(|s| s.origin).max().unwrap_or(0);
        crossed += usize::from(depth >= 1);
        deep += usize::from(depth >= 2);
    }
    println!("of {total} generated machines: {crossed} reach cell -1, {deep} reach cell -2 or beyond");
    assert!(
        deep * 10 >= total,
        "only {deep} of {total} generated machines reach cell -2: the depth this proptest exists for is gone"
    );
}
```

- [ ] **Step 3: Run the normal tier**

Run: `cargo nextest run -p redextape-core --test one_way_oracle --no-capture`
Expected: PASS — 6 tests run, 1 skipped, including the line `of 256 generated machines: 128 reach cell -1, 41 reach cell -2 or beyond`.

- [ ] **Step 4: Format and lint**

Run: `cargo fmt -p redextape-core --check && cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/tests/one_way_oracle.rs
git commit -m "Deep excursions: the depth the lowered corpus never reaches

No lowered demo machine takes a head below cell -1, so leg 6 cannot tell
a correct fold from one that is right only one cell deep: a left half
that strides one cell instead of two leaves it green.

A five-cell excursion, two tapes crossing the origin inside one rule,
and a proptest over random acyclic machines cover what the corpus
cannot. The generator's reach is held on a fixed seed: 41 of 256
machines go to cell -2 or beyond, against a floor of a tenth."
```

- [ ] **Step 6: Sabotage the deep tests**

Apply each change in turn to `crates/redextape-core/src/tm/one_way.rs` (the text is in Task 2 Step 5), run `cargo nextest run -p redextape-core --test one_way_oracle --no-fail-fast`, compare, then `git checkout crates/redextape-core/src/tm/one_way.rs` **and** `rm -f crates/redextape-core/tests/one_way_oracle.proptest-regressions`.

| sabotage | prediction (measured while planning) |
| --- | --- |
| S2 | `a_five_cell_excursion_left_and_back_agrees` fails with `tape 0 differs for depth 5`; `two_tapes_crossing_the_origin_in_one_rule_agree` fails with `tape 1 of two tapes crossing together: stepped left of cell 0, or is not a folded tape`; `random_acyclic_machines_agree_with_their_fold` fails. **`the_one_way_leg_agrees_on_small_programs` stays green** — the result Task 3 Step 7 recorded, now with tests that see it. |
| S4 | `two_tapes_crossing_the_origin_in_one_rule_agree` fails with `tape 0 differs for two tapes crossing together`; `random_acyclic_machines_agree_with_their_fold` fails. **The depth-5 test and the leg stay green.** |

`the_acyclic_generator_reaches_deep_excursions` stays green under both: it never runs a folded machine. A proptest's failing message varies with its seed; only whether it fails is predicted. After the last one: `git status` shows a clean tree.

---

### Task 5: The compositions, and the certificate on stages 1 and 2

**Files:**
- Modify: `crates/redextape-core/tests/one_way_oracle.rs`

**Interfaces:**
- Consumes: Task 3's `build_machine`, `CORPUS`; `tm::one_way::LEFT_END`; `tm::single_tape::{LEFT, deinterleave, interleave, layout_collision, normalize, to_single_tape}`; `tm::two_symbol::{Code, bitify, to_two_symbol, unbitify}`.
- Produces: the certificate gate on stages 1 and 2, and the measured composition figures the roadmap entry quotes.

- [ ] **Step 1: Update the module doc and the imports**

In `one_way_oracle.rs`, replace:

```rust
//! Also: the deep excursions no lowered demo machine makes, and the slow-tier cost table.
```

with:

```rust
//! Also: the deep excursions no lowered demo machine makes, the fold composed with the alphabet
//! reduction, the certificate that stages 1 and 2 already never step left of cell 0, and the slow-tier
//! cost table.
```

Replace:

```rust
use redextape_core::tm::one_way::{OriginSnapshot, to_one_way, unzigzag, zigzag};
```

with:

```rust
use redextape_core::tm::one_way::{LEFT_END, OriginSnapshot, to_one_way, unzigzag, zigzag};
```

and replace:

```rust
use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final, simulate_watched};
```

with:

```rust
use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final, simulate_watched};
use redextape_core::tm::single_tape::{LEFT, deinterleave, interleave, layout_collision, normalize, to_single_tape};
use redextape_core::tm::two_symbol::{Code, bitify, to_two_symbol, unbitify};
```

- [ ] **Step 2: Append the tests**

Append to the end of `one_way_oracle.rs`:

```rust

/// **FOLD, THEN THE ALPHABET REDUCTION: MULTI-TAPE, TWO SYMBOLS, NEVER LEFT OF CELL 0.** Stage 2's leg
/// assertions over the folded machine — its tapes always hold `LEFT_END` at cell 0, so `normalize`'s
/// all-blank blind spot cannot arise here — and the certificate that every reduced tape still starts
/// with `LEFT_END`'s pattern. Sound because stage 2 moves in whole `k`-cell strides and neither stage
/// writes `LEFT_END`.
#[test]
fn the_fold_composes_with_the_alphabet_reduction_and_stays_right() {
    for src in CORPUS {
        let (m, inits) = build_machine(src, EncodingKind::Unary);
        let folded = to_one_way(&m);
        let cells = zigzag(&inits, m.tapes).expect("no initial tape holds LEFT_END");
        let code = Code::new(&folded, &cells);
        let reduced = to_two_symbol(&folded, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new(), "for {src:?}");
        assert_eq!(reduced.alphabet().len(), 2, "two symbols, for {src:?}");
        assert_eq!(reduced.tapes, m.tapes, "neither stage changes the tape count, for {src:?}");
        let bits = bitify(&cells, &code).expect("the code was built from these tapes");
        let (want, _ws, want_status, want_steps) = simulate_final(&folded, &cells, DEFAULT_CAPS);
        assert_eq!(want_status, Status::Halted, "the folded run must halt for {src:?}");
        let (got, got_state, got_status, got_steps) = simulate_final(&reduced, &bits, DEFAULT_CAPS);
        let pattern = code.pattern(LEFT_END).expect("the code covers the marker");
        for (i, t) in got.iter().enumerate() {
            assert_eq!(t.slice(0, code.bits()), pattern, "tape {i} of {src:?} stepped left of cell 0");
        }
        assert_eq!(got_status, Status::Halted, "the reduced run hit a cap for {src:?}");
        assert!(
            reduced.states[got_state as usize].accept,
            "halted in `{}` for {src:?}",
            reduced.states[got_state as usize].name
        );
        for (i, tape) in want.iter().enumerate() {
            let (back, head) = unbitify(&got[i], &code).unwrap_or_else(|| panic!("tape {i} misaligned for {src:?}"));
            let (w_cells, w_head) = tape.snapshot();
            assert_eq!(normalize(&back, head), normalize(&w_cells, w_head), "tape {i} differs for {src:?}");
        }
        println!("{src:72} k {} folded steps {want_steps:>8} reduced steps {got_steps:>9}", code.bits());
    }
}

/// Padding blocks for a stage 1 image, matching `two_symbol_oracle.rs`'s `PAD`.
const PAD: usize = 2;

/// **THE REGRESSION GATE ON THE FINDING THAT RESHAPED STAGE 3.** Stage 1's `<` sentinel already keeps
/// every head of the composed canonical machine at or right of cell 0; this holds it there. Sound
/// because stage 1 never writes `<` and stage 2 strides whole blocks, so a left excursion would put some
/// other block — or the all-zero block — at cell 0.
#[test]
fn stages_one_and_two_never_step_left_of_cell_zero() {
    const CAPS: Caps = Caps { steps: 2_000_000_000, cells: DEFAULT_CAPS.cells };
    let src = "3 - 5";
    let (m, inits) = build_machine(src, EncodingKind::Unary);
    assert_eq!(layout_collision(&m, &inits), None);
    let single = to_single_tape(&m);
    let cells = vec![interleave(&inits, m.tapes, PAD, PAD)];
    let code = Code::new(&single, &cells);
    let canonical = to_two_symbol(&single, &code);
    let bits = bitify(&cells, &code).expect("the code was built from these tapes");
    let (got, state, status, steps) = simulate_final(&canonical, &bits, CAPS);
    let pattern = code.pattern(LEFT).expect("the code covers the sentinel");
    assert_eq!(got[0].slice(0, code.bits()), pattern, "the canonical machine stepped left of cell 0");
    assert_eq!(status, Status::Halted);
    assert!(canonical.states[state as usize].accept, "halted in `{}`", canonical.states[state as usize].name);
    println!("{src}: k {} steps {steps} pattern(<) {pattern:?}", code.bits());
}

/// **ALL THREE STAGES: ONE TAPE, ONE HEAD, TWO SYMBOLS, ONE-WAY** — the roadmap's literal punchline.
///
/// **IN THIS ORDER STAGE 1 BOUNDS THE TAPE ANYWAY**, so this run shows the stages COMPOSE and is not
/// evidence the fold works: `the_one_way_leg_agrees_on_small_programs` (which covers this same program),
/// `a_five_cell_excursion_left_and_back_agrees` and `random_acyclic_machines_agree_with_their_fold` are.
/// The chain here is checked a stage at a time — folded run against stage 1's image, stage 1's image
/// against stage 2's — and each comparison can use `normalize` safely, because every tape it sees starts
/// with a non-blank marker (`LEFT_END` on a folded tape, `<` on stage 1's), so `normalize` always has an
/// anchor to keep the head against.
///
/// **NO LEFT PADDING, ON PURPOSE.** A folded machine never visits a cell left of its marker, so stage 1's
/// skeleton needs no block left of the one holding physical cell 0; one block on the right was measured to
/// suffice for this program.
#[test]
#[ignore = "slow tier: run via cargo nextest run -p redextape-core --test one_way_oracle --run-ignored all"]
fn all_three_stages_compose_into_one_tape_two_symbols_one_way() {
    const CAPS: Caps = Caps { steps: 100_000_000, cells: DEFAULT_CAPS.cells };
    let src = "3 - 5";
    let (m, inits) = build_machine(src, EncodingKind::Unary);
    let folded = to_one_way(&m);
    let z = zigzag(&inits, m.tapes).expect("no initial tape holds LEFT_END");
    assert_eq!(layout_collision(&folded, &z), None, "the fold's marker collides with stage 1's layout");
    let single = to_single_tape(&folded);
    let cells = vec![interleave(&z, folded.tapes, 0, 1)];
    let code = Code::new(&single, &cells);
    let canonical = to_two_symbol(&single, &code);
    assert_eq!(canonical.validate(), Vec::<String>::new());
    assert_eq!(canonical.tapes, 1, "one tape");
    assert_eq!(canonical.alphabet().len(), 2, "two symbols");
    let bits = bitify(&cells, &code).expect("the code was built from these tapes");

    let (got, state, status, steps) = simulate_final(&canonical, &bits, CAPS);
    let pattern = code.pattern(LEFT).expect("the code covers the sentinel");
    assert_eq!(got[0].slice(0, code.bits()), pattern, "the composed machine stepped left of cell 0");
    assert_eq!(status, Status::Halted, "the composed run hit a cap");
    assert!(canonical.states[state as usize].accept, "halted in `{}`", canonical.states[state as usize].name);

    let (folded_tapes, _fs, folded_status, folded_steps) = simulate_final(&folded, &z, CAPS);
    assert_eq!(folded_status, Status::Halted);
    let (single_tapes, single_state, single_status, single_steps) = simulate_final(&single, &cells, CAPS);
    assert_eq!(single_status, Status::Halted);
    assert!(
        single.states[single_state as usize].accept,
        "stage 1 halted in `{}`",
        single.states[single_state as usize].name
    );
    let out = deinterleave(&single_tapes[0], folded.tapes).expect("stage 1's image stays well formed");
    for (i, tape) in folded_tapes.iter().enumerate() {
        let (f_cells, f_head) = tape.snapshot();
        assert_eq!(normalize(&out[i].0, out[i].1), normalize(&f_cells, f_head), "stage 1 differs on tape {i}");
    }
    let (back, head) = unbitify(&got[0], &code).expect("stage 2's image stays aligned");
    let (s_cells, s_head) = single_tapes[0].snapshot();
    assert_eq!(normalize(&back, head), normalize(&s_cells, s_head), "stage 2 differs");
    println!(
        "{src}: folded {folded_steps} steps, stage 1 {single_steps}, all three {steps} (k {}, {} states)",
        code.bits(),
        canonical.states.len()
    );
}
```

- [ ] **Step 3: Run the normal tier**

Run: `cargo nextest run -p redextape-core --test one_way_oracle --no-capture`
Expected: PASS — 8 tests run, 2 skipped. The composition prints four rows and the certificate one line, all matching *Verified during planning*.

- [ ] **Step 4: Run the slow tier**

Run: `cargo nextest run --release -p redextape-core --test one_way_oracle --run-ignored only --no-capture`
Expected: PASS — 2 tests run, including `3 - 5: folded 508 steps, stage 1 887588, all three 7088578 (k 4, 137532 states)`.

- [ ] **Step 5: Format and lint**

Run: `cargo fmt -p redextape-core --check && cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/tests/one_way_oracle.rs
git commit -m "Compose the fold, and certify stages 1 and 2 never step left

Folded then reduced to two symbols, every corpus machine stays at or
right of cell 0 on every tape, and computes the same tapes as its fold.

Stages 1 and 2 needed no fold to get there: stage 1's < sentinel bounds
every leftward walk, and stage 2 strides whole blocks. The certificate
test holds that; nothing in the stage 1 or stage 2 oracles notices a
head stepping past < and coming back.

All three stages together make one tape, one head, two symbols,
one-way. In that order stage 1 bounds the tape anyway, so the run shows
the stages compose, checked a stage at a time, and says nothing about
whether the fold works."
```

- [ ] **Step 7: Sabotage the certificate**

**S3 — stage 1 steps one cell past `<` and comes back.** In `crates/redextape-core/src/tm/single_tape.rs`, in `emit_candidate`, replace:

```rust
        self.push_rule(&rew, Names::r(Some(LEFT), None, Move::R, applied));
```

with:

```rust
        let past = self.id(&format!("q{sid}.c{c}.rew.past"));
        let back = self.id(&format!("q{sid}.c{c}.rew.back"));
        self.push_rule(&rew, Names::r(Some(LEFT), None, Move::L, past));
        self.push_rule(&format!("q{sid}.c{c}.rew.past"), Names::r(None, None, Move::R, back));
        self.push_rule(&format!("q{sid}.c{c}.rew.back"), Names::r(None, None, Move::R, applied));
```

The machine still computes the right answer; it only visits a cell left of `<`.

Run, in turn:
- `cargo nextest run -p redextape-core --test one_way_oracle stages_one_and_two_never_step_left_of_cell_zero`
- `cargo nextest run -p redextape-core --test two_symbol_oracle`
- `cargo nextest run -p redextape-core --test single_tape_oracle`

Prediction (measured while planning): the first fails with `the canonical machine stepped left of cell 0`, at its first assertion. **The other two pass in full** (6 tests, and 1 test): neither stage's own oracle sees a head leave the left end, which is why this certificate is the gate.

Then: `git checkout crates/redextape-core/src/tm/single_tape.rs`

**S1 against the composition.** Apply S1 (Task 2 Step 5) to `one_way.rs` and run `cargo nextest run -p redextape-core --test one_way_oracle the_fold_composes_with_the_alphabet_reduction_and_stays_right`.

Prediction (measured): it fails with `tape 1 of "3 - 5" stepped left of cell 0` — the composition's own certificate.

Then: `git checkout crates/redextape-core/src/tm/one_way.rs` and `rm -f crates/redextape-core/tests/one_way_oracle.proptest-regressions`. `git status` shows a clean tree.

---

### Task 6: One copy of the program-to-machine builders, in `tests/common`

**Added after planning (2026-09-14), by decision, and verified the same way as Tasks 1–5**: the patch below was applied to Task 5's end state in a scratch worktree with its own target directory, and `cargo fmt --check`, `cargo clippy -p redextape-core --all-targets -- -D warnings` and both test commands in Step 4 exited 0 with the counts given there.

**Why.** `crates/redextape-core/tests/common/mod.rs` states its own threshold: *"Three copies is where that stops being cheaper than a shared module."* Once Task 3 lands, `core_and_ty` has four verbatim copies among the integration tests — `single_tape_oracle.rs`, `two_symbol_oracle.rs`, `one_way_oracle.rs` and `tm_header.rs` — and `build_machine` has three, in the three oracle files. **Two copies stay, each for a stated reason:** `examples/regen_fixtures.rs`'s `core_and_ty`, because an example target cannot declare `mod common`; and the unit-test helpers inside `one_way.rs` (`walk`, `demo_machine`, the count of tapes with a `Move::L` rule), because a module's `#[cfg(test)]` code cannot reach `tests/common` either.

**A leftover local copy cannot survive this task silently.** Each file now `use`s the shared function by name, so a local `fn` of the same name left behind is error E0255, "defined multiple times", not a shadow.

**Files:**
- Modify: `crates/redextape-core/tests/common/mod.rs`
- Modify: `crates/redextape-core/tests/single_tape_oracle.rs`
- Modify: `crates/redextape-core/tests/two_symbol_oracle.rs`
- Modify: `crates/redextape-core/tests/one_way_oracle.rs`
- Modify: `crates/redextape-core/tests/tm_header.rs`

**Interfaces:**
- Consumes: Task 5's `one_way_oracle.rs`, exactly as the plan gives it.
- Produces: `pub fn core_and_ty(src: &str) -> (Core, Ty)` and `pub fn build_machine(src: &str, enc: EncodingKind) -> (Machine, Vec<Vec<Symbol>>)` in `tests/common/mod.rs`. `single_tape_oracle.rs`, whose own builder was unary-only as `build_machine(src)`, calls the shared one through a file-level `const ENCODING: EncodingKind = EncodingKind::Unary;` that carries the rationale its doc comment gave.

- [ ] **Step 1: Confirm the base the patch was built against**

Run: `git diff --stat 22229fb -- crates/redextape-core/tests/common crates/redextape-core/tests/single_tape_oracle.rs crates/redextape-core/tests/two_symbol_oracle.rs crates/redextape-core/tests/tm_header.rs`
Expected: no output — those four files are unchanged since `main`. `one_way_oracle.rs` must be Task 5's end state; if Task 5's review changed it, stop and report, because the patch's last hunk was built against the plan's version.

- [ ] **Step 2: Apply the patch**

Save the diff below to a file and run `git apply --check <file>`, then `git apply <file>`.
Expected: both exit 0 with no output.

```diff
diff --git a/crates/redextape-core/tests/common/mod.rs b/crates/redextape-core/tests/common/mod.rs
index cdbe424..f0cb188 100644
--- a/crates/redextape-core/tests/common/mod.rs
+++ b/crates/redextape-core/tests/common/mod.rs
@@ -1,4 +1,5 @@
-//! Shared helpers for the integration tests: the TM bank-safety checkers, and `core_of`.
+//! Shared helpers for the integration tests: the TM bank-safety checkers, `core_of`, and the two
+//! program-to-machine builders `core_and_ty` and `build_machine`.
 //!
 //! Integration tests are separate binaries and cannot import one another, so these were originally
 //! duplicated across `tm_bank_invariant.rs`, `tm_exhaustive_bank_safety.rs` and
@@ -22,7 +23,11 @@
 use redextape_core::core::Core;
 use redextape_core::desugar::desugar;
 use redextape_core::parser::parse;
-use redextape_core::tm::{AT, BLANK, BOX, Encoding, Machine, REG, SEP, WORK};
+use redextape_core::tm::{
+    AT, BLANK, BOX, Encoding, EncodingKind, Machine, REG, SEP, Symbol, TM_DEFAULT_CAPS, TmRun, WORK, run_tm_described,
+};
+use redextape_core::ty::Ty;
+use redextape_core::typeck::result_type;
 
 /// Parse and desugar a fixture that must be clean, which is how every test here starts.
 ///
@@ -34,6 +39,30 @@ pub fn core_of(src: &str) -> Core {
     desugar(&p.expect("a program with no diagnostics parses"))
 }
 
+/// Parse, typecheck and desugar `src`, returning its `Core` and its top-level type together, for a
+/// fixture that must be clean. Panics on a diagnostic or a type error for the reason `core_of` gives.
+///
+/// **SHARED BECAUSE THE COPIES PASSED THIS MODULE'S OWN THRESHOLD.** `single_tape_oracle.rs`,
+/// `two_symbol_oracle.rs`, `one_way_oracle.rs` and `tm_header.rs` each carried this function verbatim.
+/// `examples/regen_fixtures.rs` still does: an example target cannot declare `mod common`.
+pub fn core_and_ty(src: &str) -> (Core, Ty) {
+    let (prog, ds) = parse(src);
+    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
+    let prog = prog.expect("a program");
+    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
+    (desugar(&prog), ty)
+}
+
+/// The lowered machine for `src` under `enc`, and the initial tapes it runs on — for a program the TM
+/// backend must run to completion. The three reduction oracles each carried this function verbatim.
+pub fn build_machine(src: &str, enc: EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
+    let (core, ty) = core_and_ty(src);
+    let d = run_tm_described(&core, enc, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
+    assert!(matches!(d.run, TmRun::Ran { .. }), "the source machine must complete for {src:?}");
+    let init = d.header.init(d.machine.tapes);
+    (d.machine, init)
+}
+
 /// The width every generic checker measures against. A bounded encoding reports its field width; an
 /// unbounded one has no fixed skeleton to check, so the checkers refuse rather than guess.
 fn width_of(enc: &dyn Encoding) -> usize {
diff --git a/crates/redextape-core/tests/single_tape_oracle.rs b/crates/redextape-core/tests/single_tape_oracle.rs
index 38f755c..ab19175 100644
--- a/crates/redextape-core/tests/single_tape_oracle.rs
+++ b/crates/redextape-core/tests/single_tape_oracle.rs
@@ -5,17 +5,14 @@
 
 #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
 
-use redextape_core::core::Core;
-use redextape_core::desugar::desugar;
-use redextape_core::parser::parse;
-use redextape_core::tm::machine::{Machine, Symbol};
+use redextape_core::tm::EncodingKind;
 use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, simulate_final};
 use redextape_core::tm::single_tape::{
     OVERFLOW, deinterleave, interleave, layout_collision, normalize, to_single_tape,
 };
-use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, run_tm_described};
-use redextape_core::ty::Ty;
-use redextape_core::typeck::result_type;
+
+mod common;
+use common::build_machine;
 
 /// Padding blocks on each side, measured against this corpus rather than guessed: `0` overflows,
 /// `1` suffices for every program below, and `2` is `1` plus one block of margin. Because a head that
@@ -28,24 +25,9 @@ use redextape_core::typeck::result_type;
 /// measured at is not a property of the reduction.
 const PAD: usize = 2;
 
-fn core_and_ty(src: &str) -> (Core, Ty) {
-    let (prog, ds) = parse(src);
-    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
-    let prog = prog.expect("a program");
-    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
-    (desugar(&prog), ty)
-}
-
-/// The multi-tape machine and the initial tapes it runs on. Unary because the reduction is
-/// indifferent to the encoding and unary is the cheaper of the two to build.
-fn build_machine(src: &str) -> (Machine, Vec<Vec<Symbol>>) {
-    let (core, ty) = core_and_ty(src);
-    let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS)
-        .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
-    assert!(matches!(d.run, TmRun::Ran { .. }), "the multi-tape run must complete for {src:?}");
-    let init = d.header.init(d.machine.tapes);
-    (d.machine, init)
-}
+/// Every machine here is built under `Unary`: the reduction is indifferent to the encoding, and unary is
+/// the cheaper of the two to build.
+const ENCODING: EncodingKind = EncodingKind::Unary;
 
 fn assert_single_tape_agrees(src: &str) {
     assert_single_tape_agrees_capped(src, DEFAULT_CAPS);
@@ -57,7 +39,7 @@ fn assert_single_tape_agrees(src: &str) {
 /// would loosen every other test in this file that relies on a runaway construction hitting its cap
 /// quickly.
 fn assert_single_tape_agrees_capped(src: &str, caps: Caps) {
-    let (m, inits) = build_machine(src);
+    let (m, inits) = build_machine(src, ENCODING);
     // THE LAYOUT'S OWN SYMBOLS MUST NOT APPEAR IN THE DATA, and `to_single_tape`'s own refusal cannot
     // see the whole question: it reads `Machine::alphabet()`, which collects only the symbols the
     // RULES mention, so a colliding symbol living solely in an initial tape is invisible to it and
@@ -111,7 +93,7 @@ fn the_single_tape_leg_agrees_on_small_programs() {
 /// doc comment is why that ratio alone is not comparable across runs: dividing it by `blocks` (which
 /// counts padding too) is what survives a change to `PAD`.
 fn step_counts(src: &str, caps: Caps) -> (u64, u64, usize) {
-    let (m, inits) = build_machine(src);
+    let (m, inits) = build_machine(src, ENCODING);
     let (_want, _ws, _wstatus, multi) = simulate_final(&m, &inits, caps);
     let single_m = to_single_tape(&m);
     let cells = interleave(&inits, m.tapes, PAD, PAD);
diff --git a/crates/redextape-core/tests/tm_header.rs b/crates/redextape-core/tests/tm_header.rs
index 399dd94..3b735f3 100644
--- a/crates/redextape-core/tests/tm_header.rs
+++ b/crates/redextape-core/tests/tm_header.rs
@@ -6,17 +6,15 @@
 // `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
 #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
 
-use redextape_core::core::Core;
-use redextape_core::desugar::desugar;
-use redextape_core::parser::parse;
 use redextape_core::tm::{
     DescribedRun, EncodingKind, TM_DEFAULT_CAPS, TmRun, TmStatus, decode_tape_ty, parse_tm_full, print_tm_with,
     run_tm_described, simulate,
 };
-use redextape_core::ty::Ty;
-use redextape_core::typeck::result_type;
 use redextape_core::value::Value;
 
+mod common;
+use common::core_and_ty;
+
 /// Programs small enough to print in full and varied enough to reach REG, WORK, HEAP and the stack.
 const CORPUS: &[&str] = &[
     "1 + 2 * 3",
@@ -25,17 +23,6 @@ const CORPUS: &[&str] = &[
     "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
 ];
 
-/// Parse, typecheck and desugar `src`, returning the `Core` and its top-level type together — the
-/// shared prelude every test below needs before it can call `run_tm_described` (which wants `Core`) or
-/// the reference interpreter (which also wants `Core`, but needs no type).
-fn core_and_ty(src: &str) -> (Core, Ty) {
-    let (prog, ds) = parse(src);
-    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
-    let prog = prog.expect("a program");
-    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
-    (desugar(&prog), ty)
-}
-
 fn described(src: &str, kind: EncodingKind) -> DescribedRun {
     let (core, ty) = core_and_ty(src);
     run_tm_described(&core, kind, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src} did not run: {r:?}"))
diff --git a/crates/redextape-core/tests/two_symbol_oracle.rs b/crates/redextape-core/tests/two_symbol_oracle.rs
index d70d41e..711fb1c 100644
--- a/crates/redextape-core/tests/two_symbol_oracle.rs
+++ b/crates/redextape-core/tests/two_symbol_oracle.rs
@@ -15,38 +15,20 @@
 
 #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
 
-use redextape_core::core::Core;
-use redextape_core::desugar::desugar;
-use redextape_core::parser::parse;
+use redextape_core::tm::EncodingKind;
 use redextape_core::tm::build::MAX_MACHINE_STATES;
 use redextape_core::tm::machine::{BLANK, Machine, Symbol};
 use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final};
 use redextape_core::tm::single_tape::{interleave, layout_collision, normalize, to_single_tape};
 use redextape_core::tm::two_symbol::{Code, bitify, to_two_symbol, unbitify};
-use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, run_tm_described};
-use redextape_core::ty::Ty;
-use redextape_core::typeck::result_type;
 use std::collections::BTreeSet;
 
+mod common;
+use common::build_machine;
+
 /// Padding blocks per side for the single-tape image, matching `single_tape_oracle.rs`'s `PAD`.
 const PAD: usize = 2;
 
-fn core_and_ty(src: &str) -> (Core, Ty) {
-    let (prog, ds) = parse(src);
-    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
-    let prog = prog.expect("a program");
-    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
-    (desugar(&prog), ty)
-}
-
-fn build_machine(src: &str, enc: EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
-    let (core, ty) = core_and_ty(src);
-    let d = run_tm_described(&core, enc, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
-    assert!(matches!(d.run, TmRun::Ran { .. }), "the source machine must complete for {src:?}");
-    let init = d.header.init(d.machine.tapes);
-    (d.machine, init)
-}
-
 /// The leg itself, over an arbitrary machine and its tapes, so Task 7 can point it at a single-tape
 /// image without a second copy of the assertions.
 fn assert_two_symbol_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (u64, u64) {
diff --git a/crates/redextape-core/tests/one_way_oracle.rs b/crates/redextape-core/tests/one_way_oracle.rs
--- a/crates/redextape-core/tests/one_way_oracle.rs
+++ b/crates/redextape-core/tests/one_way_oracle.rs
@@ -10,33 +10,15 @@
 #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
 
 use proptest::prelude::*;
-use redextape_core::core::Core;
-use redextape_core::desugar::desugar;
-use redextape_core::parser::parse;
+use redextape_core::tm::EncodingKind;
 use redextape_core::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
 use redextape_core::tm::one_way::{LEFT_END, OriginSnapshot, to_one_way, unzigzag, zigzag};
 use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, Tape, simulate_final, simulate_watched};
 use redextape_core::tm::single_tape::{LEFT, deinterleave, interleave, layout_collision, normalize, to_single_tape};
 use redextape_core::tm::two_symbol::{Code, bitify, to_two_symbol, unbitify};
-use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, run_tm_described};
-use redextape_core::ty::Ty;
-use redextape_core::typeck::result_type;
 
-fn core_and_ty(src: &str) -> (Core, Ty) {
-    let (prog, ds) = parse(src);
-    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
-    let prog = prog.expect("a program");
-    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
-    (desugar(&prog), ty)
-}
-
-fn build_machine(src: &str, enc: EncodingKind) -> (Machine, Vec<Vec<Symbol>>) {
-    let (core, ty) = core_and_ty(src);
-    let d = run_tm_described(&core, enc, ty, TM_DEFAULT_CAPS).unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
-    assert!(matches!(d.run, TmRun::Ran { .. }), "the source machine must complete for {src:?}");
-    let init = d.header.init(d.machine.tapes);
-    (d.machine, init)
-}
+mod common;
+use common::build_machine;
 
 /// Run `m` and record where each tape's origin ends up in its final snapshot.
 ///
```

- [ ] **Step 3: Format and lint**

Run: `cargo fmt -p redextape-core --check && cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: both exit 0.

- [ ] **Step 4: Run every test file that uses `tests/common`**

Run: `cargo nextest run -p redextape-core --test single_tape_oracle --test two_symbol_oracle --test one_way_oracle --test tm_header`
Expected: PASS — 27 tests run, 4 skipped.

Run: `cargo nextest run -p redextape-core --test tm_bank_invariant --test tm_heap_stack_shape --test tm_width_equivalence --test tm_static_delimiter_safety --test span_wellformed --test sourcemap_coverage --test tm_exhaustive_bank_safety`
Expected: PASS — 68 tests run, 2 skipped. These seven files do not use the new functions; they are run because they compile the module this task changed.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/tests/common/mod.rs crates/redextape-core/tests/single_tape_oracle.rs crates/redextape-core/tests/two_symbol_oracle.rs crates/redextape-core/tests/one_way_oracle.rs crates/redextape-core/tests/tm_header.rs
git commit -m "Share the program-to-machine builders through tests/common

core_and_ty had four verbatim copies among the integration tests and
build_machine three; tests/common/mod.rs already says three copies is
where a shared module becomes cheaper. The oracle files for stages 1, 2
and 3 and tm_header.rs now import them, so a leftover local copy is a
compile error rather than a shadow.

The single-tape oracle's unary-only builder becomes a call through a
file-level ENCODING constant that keeps its rationale.
examples/regen_fixtures.rs keeps its copy, because an example target
cannot declare mod common, and so do one_way.rs's unit-test helpers,
because a module's test code cannot reach tests/common either."
```

---

## Before the PR

- [ ] Run `cargo nextest run -p redextape-core` and `scripts/check-slow.sh`, and confirm the branch touches only `crates/redextape-core/src/tm.rs`, `crates/redextape-core/src/tm/one_way.rs`, `crates/redextape-core/tests/one_way_oracle.rs`, Task 6's `crates/redextape-core/tests/common/mod.rs`, `single_tape_oracle.rs`, `two_symbol_oracle.rs` and `tm_header.rs`, and `.md` files: `git diff --name-only main... | grep -v '\.md$'`.
- [ ] Correct the spec in a commit of its own, so each change is reviewable against its reason: S1's prediction narrowed to the first member; S4 and S5 added with their measured results; the all-three test's stage-by-stage comparison and its `(0, 1)` padding; the worklist measured to save nothing on the corpus; `STATE_CEILING` of 40.0.
- [ ] Write the roadmap entry in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, at the branch's **last code commit**, and update the *Machine-model reductions — a PIPELINE* bullet: mark stage 3 DONE, and correct its sentence that the tape-folding stage is "genuinely available: `sim.rs`'s `Tape` is a zipper with both ends growable" — true of the simulator, and not of anything stages 1 and 2 build.
- [ ] Record in the entry, every figure with its command: the finding that stages 1 and 2 already never step left, with the certificate that now holds it; the state-ratio table with reachable `sides` per row; the cost table and whether both predictions held; the composition figures; the largest shipped demo's 7,363,253 states, **sourced to this plan's planning measurement** unless re-derived; and the sabotage results **including every test that stayed green** — S2 and S4 leaving leg 6 green, and S3 leaving both earlier stages' oracles green.

---

## Corrections after execution (2026-09-14)

Recorded here rather than edited into the tasks above: every code block above is the code that was verified at its task's end state, and rewriting one would make that record false.

- **Task 6's "verbatim" claim about `build_machine` was wrong.** Its *Why* paragraph, the doc comment inside its patch and its commit message say the three reduction oracles each carried `build_machine` verbatim. Two did; `single_tape_oracle.rs` carried a unary-only variant with its own signature and panic message. The Task 6 review found it, and `a991076` corrected the comment in `tests/common/mod.rs`.
- **The certificate wording in Tasks 1 and 2 overstated.** The module doc and `unzigzag`'s doc said a head that stepped left of physical cell 0 "leaves a `BLANK` at index 0". The cell materializes as `BLANK`, but a broken fold could write another symbol there afterwards; the certificate rests on nothing ever writing `LEFT_END`. The final whole-branch review found it, and `8ae4070` corrected both comments.
- **Two comments outside the branch's diff went stale.** `two_symbol_oracle.rs` said only stage 3's one-way fold was missing, and `examples/regen_fixtures.rs` said its `core_and_ty` mirrors a helper in `tm_header.rs` that Task 6 moved. The final whole-branch review found both, and `8ae4070` corrected them.
- **The spec corrections listed in *Before the PR* were incomplete.** The final review added four more: the spec said no existing oracle file changes, when Task 6 changed two; that the two-tape test crosses the tapes in opposite directions, when it crosses both the same way within each rule; that `sides` holds a bit only for tapes with a `Move::L` rule, when the code keeps one for every tape; and its certificate paragraph carried the same overstatement as the comments. The spec correction commit makes all of them.
- **Task 6's reason for `examples/regen_fixtures.rs` keeping its copy was stronger than anything established.** It says an example target cannot declare `mod common`, which nothing here tested; `22b55d5` removed that reason from both comments that gave it.
