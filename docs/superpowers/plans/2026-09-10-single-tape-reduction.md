# Single-Tape Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Machine(k-tape) -> Machine(1-tape)` reduction and a fourth oracle leg asserting `reference == λ == multitape-TM == singletape-TM`.

**Architecture:** A new `tm/single_tape.rs` holding a pure transformation plus a tape interleaving and its inverse. The single tape is `<`, a fixed number of `2k`-cell blocks, `>`; within a block each tape has a marker cell then a content cell, and the marker symbol carries the tape index so no walk ever counts offsets. A simulated step verifies against one candidate rule at a time rather than collecting the symbols under the heads, which is what removes the `|Γ|ᵏ` state factor. Nothing in `core`, `asm` or `encoding` changes.

**Tech Stack:** Rust 2024, `redextape-core`, `proptest`, `cargo nextest`.

**Spec:** [`docs/superpowers/specs/2026-09-10-single-tape-reduction-design.md`](../specs/2026-09-10-single-tape-reduction-design.md).

## Global Constraints

- **Edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- **Every commit runs the pre-commit gate**, which includes `cargo clippy --workspace --all-targets -- -D warnings`. **A commit whose tree does not compile cannot land.** So the classic TDD split of "commit the failing test, then commit the fix" is NOT available here: within a task, write the test AND the minimal implementation, run the test to see it fail against a stub, then fill the stub, then commit once. Every step below that says "commit" is at a compiling, clippy-clean tree.
- **Never `--no-verify`.**
- **`clippy::pedantic` is `warn` at workspace level and CI runs `-D warnings`, so pedantic is DENIED in library code**, along with `unwrap_used`, `expect_used`, `panic`, `todo` and `unimplemented` (`Cargo.toml`'s `[workspace.lints.clippy]`). The exemption in `clippy.toml` reaches code lexically inside a `#[test]` fn or a `#[cfg(test)]` module ONLY — a free helper in a `tests/` target is in neither, which is why `single_tape_oracle.rs` carries a file-level `#![allow(...)]`. Library code in `single_tape.rs` may not `unwrap`, `expect` or `panic!`.
- **`file:line` citations are banned in tracked source** (`scripts/check-citations.sh`). Cite the symbol.
- **A symbol citation must name the file the symbol is in** (`scripts/check-attributions.sh`). Both gates run on every commit.
- `MAX_MACHINE_STATES = 1_000_000` (`tm/build.rs`). The construction must stay under it for every machine the demo suite builds.
- `Machine::validate()` returns `Vec<String>`; empty means valid. It requires unique state names free of whitespace and `; * : [ ]`, concrete symbols outside `* ; [ ]` and non-whitespace, and **accept states carrying no rules**.
- A roadmap entry is written **before** the PR is opened, and every figure in it names the command that produced it.

## File Structure

- **Create** `crates/redextape-core/src/tm/single_tape.rs` — the whole reduction: layout constants, `interleave`, `deinterleave`, `normalize`, `to_single_tape`. One responsibility: turning a k-tape machine and its tapes into a 1-tape machine and back.
- **Modify** `crates/redextape-core/src/tm.rs` — add `pub mod single_tape;` to the existing module list.
- **Create** `crates/redextape-core/tests/single_tape_oracle.rs` — the fourth oracle leg and the slow-tier cost table.

---

### Task 1: Layout, interleaving, and its inverse

**Files:**
- Create: `crates/redextape-core/src/tm/single_tape.rs`
- Modify: `crates/redextape-core/src/tm.rs`

**Interfaces:**
- Consumes: `redextape_core::tm::machine::{BLANK, Symbol}`, `redextape_core::tm::sim::Tape`.
- Produces: `MAX_ENCODABLE_TAPES`, `head_here(i)`, `head_away(i)`, `LEFT`, `RIGHT`, `interleave(&[Vec<Symbol>], usize, usize, usize) -> Vec<Symbol>`, `deinterleave(&Tape, usize) -> Option<Vec<(Vec<Symbol>, usize)>>`, `normalize(&[Symbol], usize) -> (Vec<Symbol>, usize)`.

- [ ] **Step 1: Create the module with the layout and the two conversions**

```rust
//! The single-tape reduction: a `Machine` over `k` tapes becomes a `Machine` over one, by
//! interleaving the tapes into fixed-width blocks and simulating each k-tape step as a sweep.
//!
//! **THE MARKER SYMBOL CARRIES THE TAPE INDEX.** A block holds, for each tape `i`, a marker cell
//! then a content cell; the marker is `head_here(i)` or `head_away(i)`. A shared marker pair like
//! `^`/`.` would force every walk to count its offset within the block to learn which tape it is
//! looking at, and that counter is `k` states on every walk — it multiplies the construction by 5.
//! Reading the identity out of the symbol costs `2k + 2` symbols against an alphabet of 4, which is
//! the dimension that is not scarce.

use crate::tm::machine::{BLANK, Symbol};
use crate::tm::sim::Tape;

/// The left and right sentinels bounding the block skeleton.
pub const LEFT: Symbol = '<';
/// See [`LEFT`].
pub const RIGHT: Symbol = '>';

/// The most tapes this reduction can encode, bounded by the marker letters `A`-`Z` / `a`-`z`.
/// `TAPES` is 5, so this is slack rather than a live limit.
///
/// **NOT named `MAX_TAPES`**: `tm/syntax.rs` already has a cap by that name, on how many tapes a
/// parsed `.tm` file may declare. Two different limits under one name in one module tree is the
/// drift `scripts/check-attributions.sh` exists downstream of.
pub const MAX_ENCODABLE_TAPES: usize = 26;

/// Tape `i`'s marker when its head IS in this block.
#[must_use]
pub fn head_here(i: usize) -> Symbol {
    debug_assert!(i < MAX_ENCODABLE_TAPES);
    char::from(b'A' + u8::try_from(i).unwrap_or(0))
}

/// Tape `i`'s marker when its head is NOT in this block.
#[must_use]
pub fn head_away(i: usize) -> Symbol {
    debug_assert!(i < MAX_ENCODABLE_TAPES);
    char::from(b'a' + u8::try_from(i).unwrap_or(0))
}

/// Interleave `k` tapes into one. `left_pad` blocks precede cell 0 so a head can move left of its
/// origin; `right_pad` blocks follow the longest tape so a head can move right past its contents.
/// Every head starts in the block holding its own cell 0, which is block `left_pad`.
#[must_use]
pub fn interleave(inits: &[Vec<Symbol>], k: usize, left_pad: usize, right_pad: usize) -> Vec<Symbol> {
    let longest = inits.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let blocks = left_pad + longest + right_pad;
    let mut out = Vec::with_capacity(blocks * 2 * k + 2);
    out.push(LEFT);
    for j in 0..blocks {
        for i in 0..k {
            out.push(if j == left_pad { head_here(i) } else { head_away(i) });
            let cell = j.checked_sub(left_pad).and_then(|c| inits.get(i).and_then(|t| t.get(c)).copied());
            out.push(cell.unwrap_or(BLANK));
        }
    }
    out.push(RIGHT);
    out
}

/// Recover `k` tapes from a single tape, as `(contents, head index)` per tape — the same shape
/// `Tape::snapshot` returns, so the two are directly comparable.
///
/// `None` when the tape is not a well-formed skeleton: no sentinels, a region that is not a whole
/// number of blocks, or a tape with no head marker. That is a structural failure of the reduction
/// rather than a computation that went wrong, so it is not an `Err` with a reason — the caller has
/// nothing to do with it but fail.
#[must_use]
pub fn deinterleave(tape: &Tape, k: usize) -> Option<Vec<(Vec<Symbol>, usize)>> {
    let (cells, _head) = tape.snapshot();
    let start = cells.iter().position(|c| *c == LEFT)? + 1;
    let end = cells.iter().rposition(|c| *c == RIGHT)?;
    let region = cells.get(start..end)?;
    if k == 0 || region.len() % (2 * k) != 0 {
        return None;
    }
    let mut out: Vec<(Vec<Symbol>, usize)> = vec![(Vec::new(), usize::MAX); k];
    for (j, block) in region.chunks_exact(2 * k).enumerate() {
        for i in 0..k {
            let marker = *block.get(2 * i)?;
            let content = *block.get(2 * i + 1)?;
            out.get_mut(i)?.0.push(content);
            if marker == head_here(i) {
                out.get_mut(i)?.1 = j;
            }
        }
    }
    if out.iter().any(|(_, h)| *h == usize::MAX) { None } else { Some(out) }
}

/// Trim blanks from both ends of a tape snapshot, keeping the head cell and adjusting its index.
///
/// **THIS IS WHAT MAKES TAPE-IDENTITY COMPARABLE AT ALL.** A `Tape` materializes cells lazily, so a
/// multi-tape run's snapshot holds only the cells its head actually visited, while the interleaved
/// tape holds every block the skeleton was built with. The two describe the same tape and differ in
/// padding, so comparing them raw always fails.
#[must_use]
pub fn normalize(cells: &[Symbol], head: usize) -> (Vec<Symbol>, usize) {
    let first = cells.iter().position(|c| *c != BLANK).unwrap_or(head).min(head);
    let last = cells.iter().rposition(|c| *c != BLANK).unwrap_or(head).max(head);
    let slice = cells.get(first..=last).unwrap_or(&[BLANK]);
    (slice.to_vec(), head - first)
}
```

- [ ] **Step 2: Register the module**

In `crates/redextape-core/src/tm.rs`, add to the existing `pub mod` list, in alphabetical position:

```rust
pub mod single_tape;
```

- [ ] **Step 3: Write the round-trip tests**

Append to `crates/redextape-core/src/tm/single_tape.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn round_trip(inits: &[Vec<Symbol>], left_pad: usize, right_pad: usize) -> Vec<(Vec<Symbol>, usize)> {
        let k = inits.len();
        let cells = interleave(inits, k, left_pad, right_pad);
        let tape = Tape::new(&cells);
        deinterleave(&tape, k).expect("a freshly interleaved tape is well formed")
    }

    #[test]
    fn every_head_starts_at_its_own_cell_zero() {
        let inits = vec![vec!['1', '1'], vec!['#'], vec![]];
        let out = round_trip(&inits, 2, 3);
        for (i, (contents, head)) in out.iter().enumerate() {
            assert_eq!(*head, 2, "tape {i} head should sit at the origin block");
            assert_eq!(contents.len(), 2 + 2 + 3, "tape {i} spans left_pad + longest + right_pad blocks");
        }
    }

    #[test]
    fn contents_survive_the_round_trip_under_normalize() {
        let inits = vec![vec!['1', '_', '1'], vec!['#', '#']];
        let out = round_trip(&inits, 1, 1);
        for (i, (contents, head)) in out.iter().enumerate() {
            let (norm, nhead) = normalize(contents, *head);
            let (expect, ehead) = normalize(&inits[i], 0);
            assert_eq!((norm, nhead), (expect, ehead), "tape {i}");
        }
    }

    #[test]
    fn a_tape_with_no_sentinels_is_refused() {
        assert!(deinterleave(&Tape::new(&['1', '1']), 2).is_none());
    }

    #[test]
    fn a_region_that_is_not_whole_blocks_is_refused() {
        assert!(deinterleave(&Tape::new(&[LEFT, head_here(0), '1', RIGHT]), 2).is_none());
    }

    proptest! {
        #[test]
        fn deinterleave_inverts_interleave(
            tapes in prop::collection::vec(prop::collection::vec(prop::sample::select(vec!['1', '#', '@', BLANK]), 0..8), 1..5),
            left_pad in 0usize..3,
            right_pad in 0usize..3,
        ) {
            let out = round_trip(&tapes, left_pad, right_pad);
            prop_assert_eq!(out.len(), tapes.len());
            for (i, (contents, head)) in out.iter().enumerate() {
                prop_assert_eq!(*head, left_pad);
                let (got, gh) = normalize(contents, *head);
                let (want, wh) = normalize(&tapes[i], 0);
                prop_assert_eq!((got, gh), (want, wh));
            }
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-core single_tape`
Expected: all tests in `tm::single_tape::tests` PASS. If `normalize`'s blank handling is wrong, `contents_survive_the_round_trip_under_normalize` fails first with a mismatched head index.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/single_tape.rs crates/redextape-core/src/tm.rs
git commit -m "Interleave k tapes into one, and recover them"
```

---

### Task 2: The state skeleton — scan, rewind, and candidate fallthrough

**Files:**
- Modify: `crates/redextape-core/src/tm/single_tape.rs`

**Interfaces:**
- Consumes: Task 1's layout constants and `head_here`/`head_away`.
- Produces: `to_single_tape(&Machine) -> Machine`, and the state-name scheme every later task extends: `q{sid}.c{c}.scan`, `q{sid}.c{c}.chk{i}`, `q{sid}.c{c}.rew`, `q{sid}.c{c}.ap{i}`, `q{sid}.c{c}.rap{i}`, `q{sid}.halt`, `overflow`.

This task builds the machine for rules whose reads are **all wildcards** and whose writes and moves are all trivial, so the sweep structure can be tested before verification or mutation exist.

- [ ] **Step 1: Write the construction skeleton**

Add to `crates/redextape-core/src/tm/single_tape.rs`:

```rust
use crate::tm::machine::{Machine, Move, Rule, State, StateId};

/// The state a machine enters when a head would leave the block skeleton. **A NAMED HALT RATHER
/// THAN A WRONG ANSWER**: the block count is fixed at construction (a Turing machine has no return
/// address, so a block-materialising subroutine would be duplicated at every call site and cost more
/// states than the whole rest of the construction), so running out of tape has to be reported rather
/// than grown into. A caller distinguishes it from a real halt by the final state id.
pub const OVERFLOW: &str = "overflow";

/// Reduce a k-tape machine to a one-tape machine over the block layout this module documents. A head
/// that would leave halts in [`OVERFLOW`].
#[must_use]
pub fn to_single_tape(m: &Machine) -> Machine {
    let mut b = Names::new(m);
    for (sid, st) in m.states.iter().enumerate() {
        b.emit_state(m, StateId::try_from(sid).unwrap_or(0), st);
    }
    b.finish(m)
}
```

- [ ] **Step 2: Write the name table and emitter**

```rust
/// Assigns a `StateId` to every generated state name, so rules can name their targets before the
/// target is emitted. Names are the text form's identity and must be unique, non-empty and free of
/// whitespace and `; * : [ ]` (`Machine::validate`), which `.`-separated segments satisfy.
struct Names {
    ids: std::collections::HashMap<String, StateId>,
    states: Vec<State>,
    tapes: usize,
}

impl Names {
    fn new(m: &Machine) -> Names {
        Names { ids: std::collections::HashMap::new(), states: Vec::new(), tapes: m.tapes }
    }

    /// The id for `name`, minting the state on first mention. Every generated state is created here,
    /// so a target named by a rule always exists by the time `finish` runs.
    fn id(&mut self, name: &str) -> StateId {
        if let Some(id) = self.ids.get(name) {
            return *id;
        }
        let id = StateId::try_from(self.states.len()).unwrap_or(0);
        self.ids.insert(name.to_string(), id);
        self.states.push(State { name: name.to_string(), accept: false, rules: Vec::new() });
        id
    }

    /// The state a rule targeting original state `sid` must name.
    ///
    /// **ONE FUNCTION BECAUSE TWO SPELLINGS IS A BUG THAT TESTS GREEN.** An accept state is emitted
    /// as `q{sid}.halt` and a non-accept one as `q{sid}.c0.scan`. A rule that always named
    /// `q{sid}.c0.scan` would, for an accept target, mint an EMPTY state instead — and the machine
    /// would stop there, which `Status::Halted` reports exactly as it reports a real accept. The
    /// difference is only visible in the final state's name, so any test asserting the status alone
    /// passes over it.
    fn entry_name(m: &Machine, sid: StateId) -> String {
        let accept = m.states.get(sid as usize).is_some_and(|s| s.accept);
        if accept { format!("q{sid}.halt") } else { format!("q{sid}.c0.scan") }
    }

    fn push_rule(&mut self, at: &str, rule: Rule) {
        let id = self.id(at);
        if let Some(st) = self.states.get_mut(id as usize) {
            st.rules.push(rule);
        }
    }

    /// A one-tape rule: read `r`, write `w`, move `mv`, go to `next`.
    fn r(read: Option<Symbol>, write: Option<Symbol>, mv: Move, next: StateId) -> Rule {
        Rule { read: vec![read], write: vec![write], moves: vec![mv], next }
    }
}
```

- [ ] **Step 3: Emit the per-state sweep**

```rust
impl Names {
    fn emit_state(&mut self, m: &Machine, sid: StateId, st: &State) {
        if st.accept {
            let name = format!("q{sid}.halt");
            let id = self.id(&name);
            if let Some(s) = self.states.get_mut(id as usize) {
                s.accept = true;
                s.rules.clear();
            }
            return;
        }
        for (c, rule) in st.rules.iter().enumerate() {
            self.emit_candidate(m, sid, c, st.rules.len(), rule);
        }
        if st.rules.is_empty() {
            // A non-accept state with no rules is a stuck halt in the original, and stays one here:
            // the entry state exists, has no rules, and the simulator stops on it.
            let _ = self.id(&format!("q{sid}.c0.scan"));
        }
    }

    /// The scan state walks RIGHT looking for head markers. With all-wildcard reads there is nothing
    /// to check, so it walks to `>` and rewinds; Task 3 adds the checks and Task 4 the mutations.
    fn emit_candidate(&mut self, m: &Machine, sid: StateId, c: usize, n_rules: usize, rule: &Rule) {
        let scan = format!("q{sid}.c{c}.scan");
        let rew = format!("q{sid}.c{c}.rew");
        let next_entry = Names::entry_name(m, rule.next);
        let rew_id = self.id(&rew);
        // Walk right over anything that is not the right sentinel.
        self.push_rule(&scan, Names::r(Some(RIGHT), None, Move::S, rew_id));
        let scan_id = self.id(&scan);
        self.push_rule(&scan, Names::r(None, None, Move::R, scan_id));
        // Rewind: walk LEFT to the left sentinel, then step right and hand over.
        let target = self.id(&next_entry);
        self.push_rule(&rew, Names::r(Some(LEFT), None, Move::R, target));
        self.push_rule(&rew, Names::r(None, None, Move::L, rew_id));
        let _ = (m, n_rules);
    }

    fn finish(mut self, m: &Machine) -> Machine {
        let _ = self.id(OVERFLOW);
        let start = self.id(&Names::entry_name(m, m.start));
        Machine { states: self.states, start, tapes: 1 }
    }
}
```

- [ ] **Step 4: Write the test for a machine that only sweeps**

```rust
    /// A two-tape machine whose one rule reads nothing, writes nothing and moves nothing, then
    /// accepts. Its single-tape image must halt with both tapes unchanged.
    fn wildcard_only() -> Machine {
        Machine {
            tapes: 2,
            start: 0,
            states: vec![
                State {
                    name: "go".into(),
                    accept: false,
                    rules: vec![Rule {
                        read: vec![None, None],
                        write: vec![None, None],
                        moves: vec![Move::S, Move::S],
                        next: 1,
                    }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn the_reduced_machine_is_structurally_valid() {
        let single = to_single_tape(&wildcard_only());
        assert_eq!(single.tapes, 1);
        assert!(single.validate().is_empty(), "{:?}", single.validate());
    }

    #[test]
    fn a_sweep_only_machine_leaves_both_tapes_alone() {
        use crate::tm::sim::{DEFAULT_CAPS, Status};
        let m = wildcard_only();
        let inits = vec![vec!['1', '1'], vec!['#']];
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, 1, 1);
        let (tapes, fin, status, _steps) = crate::tm::sim::simulate_final(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        // NOT just "it halted": a stuck state halts too, and reports the same `Status`. Assert the
        // machine reached the state that stands for the original's ACCEPT.
        assert!(single.states[fin as usize].accept, "halted in {}, not an accept state", single.states[fin as usize].name);
        let out = deinterleave(&tapes[0], m.tapes).expect("well formed");
        for (i, (contents, head)) in out.iter().enumerate() {
            let (got, gh) = normalize(contents, *head);
            let (want, wh) = normalize(&inits[i], 0);
            assert_eq!((got, gh), (want, wh), "tape {i}");
        }
    }
```

- [ ] **Step 5: Run the tests**

Run: `cargo nextest run -p redextape-core single_tape`
Expected: PASS. `the_reduced_machine_is_structurally_valid` is the one that catches a name containing a reserved character or an accept state that kept rules.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/tm/single_tape.rs
git commit -m "Emit the sweep skeleton for the single-tape reduction"
```

---

### Task 3: Verify a candidate rule, and fall through to the next

**Files:**
- Modify: `crates/redextape-core/src/tm/single_tape.rs`

**Interfaces:**
- Consumes: Task 2's `Names`, state-name scheme, and `emit_candidate`.
- Produces: candidate fallthrough — a mismatched read sends the machine to `q{sid}.c{c+1}.scan`, and the last candidate's mismatch sends it to a stuck state `q{sid}.stuck` with no rules.

- [ ] **Step 1: Replace `emit_candidate`'s scan with a checking scan**

```rust
    fn emit_candidate(&mut self, m: &Machine, sid: StateId, c: usize, n_rules: usize, rule: &Rule) {
        let scan = format!("q{sid}.c{c}.scan");
        let rew = format!("q{sid}.c{c}.rew");
        let fail = format!("q{sid}.c{c}.fail");
        let scan_id = self.id(&scan);
        let rew_id = self.id(&rew);
        let fail_id = self.id(&fail);

        // Reaching `>` means every concrete read matched: rewind and apply.
        self.push_rule(&scan, Names::r(Some(RIGHT), None, Move::S, rew_id));
        // A head marker for a tape with a CONCRETE read hands over to that tape's check state, which
        // sits on the content cell one to the right. Wildcard reads emit nothing here, which is the
        // whole reason this construction fits: 81% of read positions are wildcards.
        for (i, want) in rule.read.iter().enumerate().take(m.tapes) {
            if let Some(sym) = want {
                let chk = format!("q{sid}.c{c}.chk{i}");
                let chk_id = self.id(&chk);
                self.push_rule(&scan, Names::r(Some(head_here(i)), None, Move::R, chk_id));
                // On the content cell: match continues the scan, anything else fails this candidate.
                self.push_rule(&chk, Names::r(Some(*sym), None, Move::R, scan_id));
                self.push_rule(&chk, Names::r(None, None, Move::S, fail_id));
            }
        }
        self.push_rule(&scan, Names::r(None, None, Move::R, scan_id));

        // Fail: rewind left to `<`, then start the next candidate — or stick if there is none.
        let after_fail = if c + 1 < n_rules {
            self.id(&format!("q{sid}.c{}.scan", c + 1))
        } else {
            self.id(&format!("q{sid}.stuck"))
        };
        self.push_rule(&fail, Names::r(Some(LEFT), None, Move::R, after_fail));
        self.push_rule(&fail, Names::r(None, None, Move::L, fail_id));

        // Rewind after a successful verify: Task 4 replaces this target with the apply chain.
        let next_entry = self.id(&Names::entry_name(m, rule.next));
        self.push_rule(&rew, Names::r(Some(LEFT), None, Move::R, next_entry));
        self.push_rule(&rew, Names::r(None, None, Move::L, rew_id));
    }
```

- [ ] **Step 2: Write the verification tests**

```rust
    /// Two candidates on one state: the first reads `1` on tape 0, the second is a wildcard. Which
    /// one fires is decided by tape 0's cell, and by rule ORDER when both could match.
    fn two_candidates() -> Machine {
        Machine {
            tapes: 2,
            start: 0,
            states: vec![
                State {
                    name: "pick".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1'), None], write: vec![None, None], moves: vec![Move::S, Move::S], next: 1 },
                        Rule { read: vec![None, None], write: vec![None, None], moves: vec![Move::S, Move::S], next: 2 },
                    ],
                },
                State { name: "took-first".into(), accept: true, rules: vec![] },
                State { name: "took-second".into(), accept: true, rules: vec![] },
            ],
        }
    }

    fn final_state_name(m: &Machine, inits: &[Vec<Symbol>]) -> String {
        use crate::tm::sim::{DEFAULT_CAPS, simulate_final};
        let single = to_single_tape(m);
        let cells = interleave(inits, m.tapes, 1, 1);
        let (_tapes, fin, _status, _steps) = simulate_final(&single, &[cells], DEFAULT_CAPS);
        single.states[fin as usize].name.clone()
    }

    #[test]
    fn a_concrete_read_that_matches_takes_the_first_candidate() {
        let name = final_state_name(&two_candidates(), &[vec!['1'], vec!['#']]);
        assert_eq!(name, "q1.halt");
    }

    #[test]
    fn a_concrete_read_that_misses_falls_through_to_the_next_candidate() {
        let name = final_state_name(&two_candidates(), &[vec!['@'], vec!['#']]);
        assert_eq!(name, "q2.halt");
    }
```

- [ ] **Step 3: Run the tests**

Run: `cargo nextest run -p redextape-core single_tape`
Expected: PASS. If the fallthrough is wired to the wrong candidate, `a_concrete_read_that_misses_falls_through_to_the_next_candidate` reports `q1.halt`.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm/single_tape.rs
git commit -m "Verify one candidate rule at a time, and fall through on a mismatch"
```

---

### Task 4: Apply — writes, moves, and the overflow halt

**Files:**
- Modify: `crates/redextape-core/src/tm/single_tape.rs`

**Interfaces:**
- Consumes: Task 3's verified-candidate rewind state `q{sid}.c{c}.rew`.
- Produces: an apply chain per ACTING tape (concrete write or non-`S` move), ending at `q{rule.next}.c0.scan`; `OVERFLOW` reached when a marker move finds a sentinel.

- [ ] **Step 1: Emit the apply chain**

Replace the rewind's target in `emit_candidate` with the first acting tape's apply state, and add:

```rust
    /// One pass per ACTING tape: a tape acts when it has a concrete write or a non-`S` move.
    /// Measured on three real lowered machines, that is 0.91-0.94 tapes per rule — essentially one —
    /// which is why a pass per acting tape costs what a single pass would.
    fn emit_apply(&mut self, m: &Machine, sid: StateId, c: usize, rule: &Rule) -> StateId {
        let acting: Vec<usize> = (0..m.tapes)
            .filter(|i| rule.write.get(*i).copied().flatten().is_some() || rule.moves.get(*i).copied() != Some(Move::S))
            .collect();
        let done = self.id(&Names::entry_name(m, rule.next));
        // Built back to front so each pass knows the state that follows it.
        let mut next = done;
        for i in acting.into_iter().rev() {
            next = self.emit_one_tape_pass(sid, c, i, rule, next);
        }
        next
    }

    /// Walk right to tape `i`'s head marker, write its content, move its marker, rewind, continue.
    fn emit_one_tape_pass(&mut self, sid: StateId, c: usize, i: usize, rule: &Rule, after: StateId) -> StateId {
        let ap = format!("q{sid}.c{c}.ap{i}");
        let wr = format!("q{sid}.c{c}.wr{i}");
        let mv = format!("q{sid}.c{c}.mv{i}");
        let rap = format!("q{sid}.c{c}.rap{i}");
        let ap_id = self.id(&ap);
        let wr_id = self.id(&wr);
        let mv_id = self.id(&mv);
        let rap_id = self.id(&rap);
        let over = self.id(OVERFLOW);

        // Find tape i's head marker; step right onto its content cell.
        self.push_rule(&ap, Names::r(Some(head_here(i)), None, Move::R, wr_id));
        self.push_rule(&ap, Names::r(None, None, Move::R, ap_id));

        // Write (or leave), then step back onto the marker.
        let write = rule.write.get(i).copied().flatten();
        self.push_rule(&wr, Names::r(None, write, Move::L, mv_id));

        // Move the marker. `S` is free; `L`/`R` clear it here and set it on the neighbouring block's
        // tape-i marker, which is the NEXT `h_i` in that direction because a tape has one head.
        match rule.moves.get(i).copied().unwrap_or(Move::S) {
            Move::S => self.push_rule(&mv, Names::r(None, None, Move::S, rap_id)),
            dir => {
                let step = if dir == Move::L { Move::L } else { Move::R };
                let seek = format!("q{sid}.c{c}.sk{i}");
                let seek_id = self.id(&seek);
                self.push_rule(&mv, Names::r(None, Some(head_away(i)), step, seek_id));
                // Landing on a sentinel means the head left the skeleton.
                self.push_rule(&seek, Names::r(Some(LEFT), None, Move::S, over));
                self.push_rule(&seek, Names::r(Some(RIGHT), None, Move::S, over));
                self.push_rule(&seek, Names::r(Some(head_away(i)), Some(head_here(i)), Move::S, rap_id));
                self.push_rule(&seek, Names::r(None, None, step, seek_id));
            }
        }

        // Rewind to `<` and hand on to the next acting tape, or to the next state's entry.
        self.push_rule(&rap, Names::r(Some(LEFT), None, Move::R, after));
        self.push_rule(&rap, Names::r(None, None, Move::L, rap_id));
        ap_id
    }
```

In `emit_candidate`, change the successful-verify rewind to target the apply chain:

```rust
        let applied = self.emit_apply(m, sid, c, rule);
        self.push_rule(&rew, Names::r(Some(LEFT), None, Move::R, applied));
        self.push_rule(&rew, Names::r(None, None, Move::L, rew_id));
```

- [ ] **Step 2: Write the mutation tests**

```rust
    /// Tape 0 walks right over `1`s writing `@`, and halts on the first blank. Exercises a concrete
    /// read, a concrete write and an `R` move in one machine.
    fn rewrite_ones() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "scan".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![Some('@')], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 1 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn writes_and_moves_reproduce_the_multitape_run() {
        use crate::tm::sim::{DEFAULT_CAPS, Status, simulate};
        let m = rewrite_ones();
        let inits = vec![vec!['1', '1', '1']];
        let (want, want_status) = simulate(&m, &inits, DEFAULT_CAPS);
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, 1, 4);
        let (got, got_status) = simulate(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(want_status, Status::Halted);
        assert_eq!(got_status, Status::Halted);
        let out = deinterleave(&got[0], m.tapes).expect("well formed");
        let (w_cells, w_head) = want[0].snapshot();
        assert_eq!(normalize(&out[0].0, out[0].1), normalize(&w_cells, w_head));
    }

    #[test]
    fn a_head_that_leaves_the_skeleton_halts_in_overflow() {
        let m = rewrite_ones();
        let inits = vec![vec!['1', '1', '1']];
        // No right padding: the third `R` move walks tape 0 off the end of the blocks.
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, 0, 0);
        use crate::tm::sim::{DEFAULT_CAPS, simulate_final};
        let (_t, fin, _s, _n) = simulate_final(&single, &[cells], DEFAULT_CAPS);
        assert_eq!(single.states[fin as usize].name, OVERFLOW);
    }
```

- [ ] **Step 3: Run the tests**

Run: `cargo nextest run -p redextape-core single_tape`
Expected: PASS. `a_head_that_leaves_the_skeleton_halts_in_overflow` is the one that proves the bound is enforced rather than silently wrapping.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm/single_tape.rs
git commit -m "Apply writes and head moves, and halt in overflow at the skeleton's edge"
```

---

### Task 5: Measure the state budget, and gate it

**Files:**
- Modify: `crates/redextape-core/src/tm/single_tape.rs`

**Interfaces:**
- Consumes: `to_single_tape`.
- Produces: `states_per_original(&Machine) -> f64` used by the gate test.

**Why this is its own task.** The spec projects 7.26-8.12 states per original state from `1 + reads/rule + acting/rule`. That formula counts the check and apply states and **not** the scan, rewind, fail and seek states around them, so the real ratio is higher and nobody knows by how much until the construction exists. `MAX_MACHINE_STATES / 49,135` = 20.4 is the ceiling. This task measures the true ratio and fails if it exceeds it, so the number is held by a gate rather than by a sentence.

- [ ] **Step 1: Add the ratio helper and the gate**

```rust
/// Generated states per original state — the ratio that decides whether the largest machine the
/// demo suite builds can be reduced at all.
#[must_use]
pub fn states_per_original(m: &Machine) -> f64 {
    let single = to_single_tape(m);
    #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts, reported to 2 dp")]
    let ratio = single.states.len() as f64 / m.states.len().max(1) as f64;
    ratio
}
```

```rust
    /// The largest machine the shipped demos build is 49,135 states (`state_cost_probe` section G),
    /// and `MAX_MACHINE_STATES` is 1,000,000, so the construction has 20.4 states per original state
    /// to spend. This asserts the PROPERTY rather than recording a figure that goes stale.
    #[test]
    fn the_construction_stays_inside_the_state_budget() {
        const WORST_SHIPPED_DEMO_STATES: f64 = 49_135.0;
        const CEILING: f64 = crate::tm::build::MAX_MACHINE_STATES as f64 / WORST_SHIPPED_DEMO_STATES;
        for m in [wildcard_only(), two_candidates(), rewrite_ones()] {
            let ratio = states_per_original(&m);
            assert!(ratio < CEILING, "{ratio:.2} states per original state exceeds the {CEILING:.1} budget");
        }
    }
```

- [ ] **Step 2: Run it and RECORD the real ratio**

Run: `cargo nextest run -p redextape-core the_construction_stays_inside_the_state_budget`
Expected: PASS. Then run it with the assertion inverted once, to read the actual ratios off the failure message, and write those numbers into the test's doc comment. **Do not skip this**: the point of the task is the measured number, not the passing test.

- [ ] **Step 3: Commit**

```bash
git add crates/redextape-core/src/tm/single_tape.rs
git commit -m "Gate the construction's state budget on the property, not a figure"
```

---

### Task 5b: Stop paying for a write that does not happen

**Files:**
- Modify: `crates/redextape-core/src/tm/single_tape.rs`

**Why this task exists, and it is not a speculative optimisation.** Task 5 measured the construction on real lowered machines and `sum(5)` costs **21.20** generated states per original state against a ceiling of `1_000_000 / 49_135` = **20.35**. The design spec estimated 7.75 for that same machine; the measured figure is 2.7x it.

**ONE PREMISE UNDER THAT IS UNMEASURED, AND THIS TASK MEASURES IT RATHER THAN INHERITING IT.** The ceiling is `MAX_MACHINE_STATES` divided by the largest machine the shipped demos build (49,135 states, `state_cost_probe` section G), so calling the construction "over budget" assumes `sum(5)`'s ratio transfers to THAT program. It is a different shape, not merely a bigger one — section G's worst case comes from the higher-order demos, which go through `defunc`, where `sum(5)` is first-order recursion. Nobody has measured its ratio. An earlier draft of this section asserted the product (49,135 x 21.20 = ~1.04M states) as though it were a measurement; it is an extrapolation, and Step 0 below replaces it with a number.

**Where the states go, and why this is the right cut.** Per rule the construction emits `scan`/`rew`/`fail` (3), one `chk{i}` per concrete read (measured 0.94 per rule), and five per acting tape — `ap{i}`, `wr{i}`, `mv{i}`, `sk{i}`, `rap{i}` — at 0.93 acting tapes per rule. That last term is most of the cost. But **writes are measured at 0.11 per rule against 0.93 acting tapes**: roughly 88% of apply passes have `write[i] == None` and still pay `wr{i}` plus the step right onto the content cell and the step back left onto the marker, to write nothing.

- [ ] **Step 0: Measure the actual worst shipped demo, before optimising anything**

`state_cost_probe`'s section G finds its 49,135-state worst case by lowering every entry of the shipped demo corpus under both encodings and taking the maximum. Do the same in a test: lower each demo, find the one with the most states, and measure `states_per_original` on THAT machine. Report its program text, its state count, and its ratio.

**This can change what this task is.** If the worst demo's ratio is comfortably under 20.35, the construction already fits and this task is an optimisation rather than a fix — say so, and finish it anyway, since the saving is real either way. If it is over, Step 3's target is that number rather than `sum(5)`'s.

- [ ] **Step 1: Split the no-write case out of `emit_one_tape_pass`**

When `rule.write.get(i)` is `None`, the pass has no reason to visit the content cell at all: it can move the marker directly from `ap{i}`. Emit `wr{i}` and the two steps ONLY when there is a concrete write. Keep the write case exactly as it is.

The states each case emits:

| case | states |
| --- | --- |
| concrete write | `ap{i}`, `wr{i}`, `mv{i}`, `rap{i}`, plus `sk{i}` when the move is not `S` |
| no write | `ap{i}`, `mv{i}`, `rap{i}`, plus `sk{i}` when the move is not `S` |

`ap{i}` must land on the marker cell in the no-write case rather than stepping right, because `mv{i}` acts on the marker.

- [ ] **Step 2: Prove behaviour did not change**

Every existing test in the module must still pass unchanged — in particular `writes_and_moves_reproduce_the_multitape_run_at_k_gt_1`, whose 3-tape machine has one tape that writes and moves, one that writes and moves the other way, and one that does neither. Add one more differential case: a rule where a tape **moves without writing** while another **writes without moving**, checked against `simulate` on the multi-tape machine, so the split's two arms are both exercised in one run.

- [ ] **Step 3: Re-measure, and record the new ratios beside the old ones**

Run the two budget tests. Report the ratio for every machine before and after, and write the new figures into the doc comments, replacing the old. **If the worst demo measured in Step 0 is still over 20.35, stop and report that** rather than adjusting the ceiling — the ceiling is derived from a measured memory cost per state and is not the free variable.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm/single_tape.rs
git commit -m "Skip the content-cell round trip when a rule writes nothing"
```

---

### Task 6: The fourth oracle leg

**Files:**
- Create: `crates/redextape-core/tests/single_tape_oracle.rs`

**Interfaces:**
- Consumes: `to_single_tape`, `interleave`, `deinterleave`, `normalize`, `OVERFLOW`.
- Produces: `assert_single_tape_agrees(src: &str)`, used by Task 7's slow tier.

- [ ] **Step 1: Write the leg**

```rust
//! The fourth oracle leg: `reference == λ == multitape-TM == singletape-TM`. The multi-tape legs are
//! `three_way_oracle.rs`'s subject; this file adds the fourth and asserts it against the third by
//! TAPE IDENTITY rather than by decoded value, which is strictly stronger and needs no second decode
//! path that could drift.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::tm::machine::Symbol;
use redextape_core::tm::sim::{DEFAULT_CAPS, Status, simulate_final};
use redextape_core::tm::single_tape::{OVERFLOW, deinterleave, interleave, normalize, to_single_tape};

/// Padding blocks on each side. Generous rather than computed: a head that leaves the skeleton halts
/// in `OVERFLOW`, which this function asserts against, so an under-sized pad fails loudly and names
/// itself rather than producing a quietly truncated tape.
const PAD: usize = 64;

fn assert_single_tape_agrees(src: &str) {
    let (m, inits) = build_machine(src);
    let (want, _want_state, want_status, want_steps) = simulate_final(&m, &inits, DEFAULT_CAPS);
    assert_eq!(want_status, Status::Halted, "the multi-tape run must halt for {src:?}");

    let single = to_single_tape(&m);
    let cells = interleave(&inits, m.tapes, PAD, PAD);
    let (got, got_state, got_status, got_steps) = simulate_final(&single, &[cells], DEFAULT_CAPS);
    assert_eq!(got_status, Status::Halted, "the single-tape run hit a cap for {src:?}");
    assert_ne!(
        single.states[got_state as usize].name, OVERFLOW,
        "a head left the {PAD}-block skeleton for {src:?}; raise PAD"
    );

    let out = deinterleave(&got[0], m.tapes).expect("the reduced tape stays well formed");
    for (i, tape) in want.iter().enumerate() {
        let (w_cells, w_head) = tape.snapshot();
        assert_eq!(
            normalize(&out[i].0, out[i].1),
            normalize(&w_cells, w_head),
            "tape {i} differs for {src:?}"
        );
    }
    assert!(got_steps > want_steps, "the reduction should cost more steps, not fewer");
}
```

- [ ] **Step 2: Write `build_machine` against the existing lowering path**

`run_tm_described` is the one entry point that hands back the machine AND the literal initial tapes it
was simulated with, which is exactly what this leg needs — `run_tm`/`run_tm_fitted` drop both. The
helper below is `tm_header.rs`'s `core_and_ty` plus one call; use those imports rather than inventing
a second lowering path.

Add to the top of `crates/redextape-core/tests/single_tape_oracle.rs`:

```rust
use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::machine::Machine;
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

/// The multi-tape machine and the initial tapes it runs on. Unary because the reduction is
/// indifferent to the encoding and unary is the cheaper of the two to build.
fn build_machine(src: &str) -> (Machine, Vec<Vec<Symbol>>) {
    let (core, ty) = core_and_ty(src);
    let d = run_tm_described(&core, EncodingKind::Unary, ty, TM_DEFAULT_CAPS)
        .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"));
    assert!(matches!(d.run, TmRun::Ran { .. }), "the multi-tape run must complete for {src:?}");
    let init = d.header.init(d.machine.tapes);
    (d.machine, init)
}
```

- [ ] **Step 3: The normal-tier corpus**

```rust
#[test]
fn the_single_tape_leg_agrees_on_small_programs() {
    for src in ["1 + 2", "3 - 5", "[1, 2]"] {
        assert_single_tape_agrees(src);
    }
}
```

- [ ] **Step 4: Run it**

Run: `cargo nextest run -p redextape-core --test single_tape_oracle`
Expected: PASS. A failure naming `OVERFLOW` means `PAD` is too small; a tape mismatch names the tape index.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/tests/single_tape_oracle.rs
git commit -m "Add the fourth oracle leg, asserting tape identity against the multi-tape run"
```

---

### Task 7: The slow tier, the cost table, and the sabotage

**Files:**
- Modify: `crates/redextape-core/tests/single_tape_oracle.rs`

**Interfaces:**
- Consumes: `assert_single_tape_agrees`.
- Produces: an ignored test producing the exact-integer cost table.

- [ ] **Step 1: Add the slow-tier test and the table**

```rust
/// The roadmap's actual point: "polynomial slowdown is normally a hand-wave; here step counts are
/// exact integers". This prints multi-tape steps against single-tape steps per program, so the
/// quadratic is a measured table rather than an adjective.
#[test]
#[ignore = "slow tier: the single-tape reduction is quadratic in tape length"]
fn the_single_tape_cost_table() {
    for src in ["1 + 2 * 3", "let x = 40; x + 2", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"] {
        let (multi, single) = step_counts(src);
        // `step_counts` is defined immediately below.
        println!("{src:60} multi {multi:>10}  single {single:>12}  ratio {:.1}x", single as f64 / multi as f64);
        assert_single_tape_agrees(src);
    }
}
```

Add `step_counts` beside it:

```rust
/// δ-steps for the same program on both machines. The ratio between them IS the reduction's cost,
/// and it is an exact integer rather than an asymptotic claim.
fn step_counts(src: &str) -> (u64, u64) {
    let (m, inits) = build_machine(src);
    let (_want, _ws, _wstatus, multi) = simulate_final(&m, &inits, DEFAULT_CAPS);
    let single_m = to_single_tape(&m);
    let cells = interleave(&inits, m.tapes, PAD, PAD);
    let (_got, _gs, _gstatus, single) = simulate_final(&single_m, &[cells], DEFAULT_CAPS);
    (multi, single)
}
```

- [ ] **Step 2: Run the slow tier**

Run: `cargo nextest run -p redextape-core --test single_tape_oracle --run-ignored all`
Expected: PASS, with the table on stdout. **Record the ratios** — they are the deliverable, and they go in the roadmap entry.

- [ ] **Step 3: Sabotage the wildcard skip**

Temporarily change `emit_candidate` to emit a check state for EVERY read position rather than only concrete ones (treat `None` as a wildcard that still checks and always matches). Re-run `the_construction_stays_inside_the_state_budget`.
Expected: the ratio rises toward the naive figure. **Record both ratios.** If the gate does not redden, the budget test is not load-bearing and the task is not done — say so rather than proceeding.

- [ ] **Step 4: Revert the sabotage and commit**

```bash
git add crates/redextape-core/tests/single_tape_oracle.rs
git commit -m "Reach the demo suite in the slow tier, and measure the reduction's real cost"
```

---

## Before the PR

- [ ] Write the roadmap entry in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, with every figure naming the command that produced it and run at the branch's last code commit — not before it, or the anchor re-stales.
- [ ] Run `scripts/check-all.sh`.
- [ ] Record in the entry: the measured states-per-original ratio, the sabotage's two ratios, and the cost table.
