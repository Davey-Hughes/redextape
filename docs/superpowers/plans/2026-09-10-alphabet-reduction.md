# Alphabet Reduction to Two Symbols Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Machine -> Machine` reduction onto a two-symbol tape alphabet and a fifth oracle leg asserting `reference == λ == multitape-TM == singletape-TM == two-symbol-TM`, which composed with stage 1 produces one tape, one head, two symbols.

**Architecture:** A new `tm/two_symbol.rs` holding a `Code` (the symbol ↔ bit-pattern table), a tape encoding `bitify` and its inverse `unbitify`, and the transformation `to_two_symbol`. Original cell `j` of tape `i` becomes reduced cells `[j·k, (j+1)·k)`, MSB first, with `code(BLANK) = 0ᵏ` so an unwritten region decodes to a run of blanks. A simulated step verifies each block against one candidate rule's bit pattern rather than collecting the bits into the control state, which is what removes the `2ᵏ = |Γ|` state factor. There are no reserved symbols, so tapes stay two-way infinite and the tape count is preserved. Nothing in `core`, `asm` or `encoding` changes.

**Tech Stack:** Rust 2024, `redextape-core`, `proptest`, `cargo nextest`.

**Spec:** [`docs/superpowers/specs/2026-09-10-alphabet-reduction-design.md`](../specs/2026-09-10-alphabet-reduction-design.md).

**Stage 1, which this stacks on:** [`tm/single_tape.rs`](../../../crates/redextape-core/src/tm/single_tape.rs), spec [`2026-09-10-single-tape-reduction-design.md`](../specs/2026-09-10-single-tape-reduction-design.md), plan [`2026-09-10-single-tape-reduction.md`](2026-09-10-single-tape-reduction.md).

## Global Constraints

- **Edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- **Every commit runs the pre-commit gate**, which includes `cargo clippy --workspace --all-targets -- -D warnings`. **A commit whose tree does not compile cannot land.** So the classic TDD split of "commit the failing test, then commit the fix" is NOT available here: within a task, write the test AND a stub, run the test to watch it fail against the stub, then fill the stub, then commit once. Every step below that says "commit" is at a compiling, clippy-clean tree.
- **Never `--no-verify`.**
- **`clippy::pedantic` is `warn` at workspace level and CI runs `-D warnings`, so pedantic is DENIED in library code**, along with `unwrap_used`, `expect_used`, `panic`, `todo` and `unimplemented` (`Cargo.toml`'s `[workspace.lints.clippy]`). The exemption in `clippy.toml` reaches code lexically inside a `#[test]` fn or a `#[cfg(test)]` module ONLY — a free helper in a `tests/` target is in neither, which is why `single_tape_oracle.rs` carries a file-level `#![allow(...)]`. **Library code in `two_symbol.rs` may not `unwrap`, `expect` or `panic!`** — `unwrap_or`, `unwrap_or_else` and `unwrap_or_default` are fine, they are different lints.
- **`file:line` citations are banned in tracked source** (`scripts/check-citations.sh`). Cite the symbol.
- **A symbol citation must name the file the symbol is in** (`scripts/check-attributions.sh`). Both gates run on every commit.
- `MAX_MACHINE_STATES = 1_000_000` (`tm/build.rs`). The construction must stay under it for every machine the oracle corpus builds.
- `Machine::validate()` returns `Vec<String>`; empty means valid. It requires unique state names free of whitespace and `; * : [ ]`, concrete symbols outside `* ; [ ]` and non-whitespace, and **accept states carrying no rules**. Dot-separated segments satisfy the name rule.
- **The two symbols are `_` and `1`.** `_` is `BLANK` (`tm/machine.rs`) and plays zero. Both are legal concrete rule symbols.
- A roadmap entry in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` is written **before** the PR is opened, and every figure in it names the command that produced it.

## What changed from the spec while planning, and why

Two corrections, both folded into the tasks below. Neither invalidates a spec decision; both sharpen a figure or a signature.

1. **The per-concrete-read state cost is `3k - 2`, not the spec's estimated `2k`.** The verify phase needs `k` comparison states, a rewind ladder of `k - 1` for the success path, and a second ladder of `k - 1` for the failure path — the two ladders cannot share, because they differ in where rung 0 goes. The two figures agree at `k = 2` (both 4) and diverge after: at `k = 4` it is 10 against 8. The spec's cost section already says its numbers are estimates and that the plan gates a property rather than restating them, so this is a sharper input to the same gate, not a change of plan.
2. **`bitify` returns `Option<Vec<Vec<Symbol>>>`, not `Vec<Vec<Symbol>>`.** A symbol with no code cannot be encoded, and returning a silently wrong tape is the exact failure the spec builds `Code::new(m, inits)` to prevent. Making it `Option` puts that obligation in the type instead of in a caller's discipline — the same move as `unbitify`'s `Option`.

One mechanism decision the spec does not fix, made here: **each original state gets a dedicated entry state `q{sid}.enter`** holding a single unconditional rule into candidate 0's first real state. Candidates are emitted back-to-front so each one's fallthrough target is a name already built, which removes name prediction — and stage 1 recorded that predicting a generated state's name in two places is a bug that tests green, because a mispredicted name mints an EMPTY state and the simulator reports its halt exactly as it reports a real accept. The entry state costs one state and one step per original state and is measured in Task 5 rather than assumed away.

## File Structure

- **Create** `crates/redextape-core/src/tm/two_symbol.rs` — the whole reduction: `Code`, `bitify`, `unbitify`, `to_two_symbol`, `states_per_original`. One responsibility: turning a machine and its tapes into a two-symbol machine and back.
- **Modify** `crates/redextape-core/src/tm.rs` — add `pub mod two_symbol;` to the existing module list, in alphabetical position after `pub mod syntax;`.
- **Create** `crates/redextape-core/tests/two_symbol_oracle.rs` — the fifth oracle leg, the composed canonical machine, and the slow-tier cost table.

---

### Task 1: `Code`, `bitify`, and `unbitify`

**Files:**
- Create: `crates/redextape-core/src/tm/two_symbol.rs`
- Modify: `crates/redextape-core/src/tm.rs`

**Interfaces:**
- Consumes: `redextape_core::tm::machine::{BLANK, Machine, Symbol}`, `redextape_core::tm::sim::Tape`.
- Produces: `ZERO`, `ONE`, `Code`, `Code::new(&Machine, &[Vec<Symbol>]) -> Code`, `Code::bits(&self) -> usize`, `Code::symbols(&self) -> &[Symbol]`, `Code::pattern(&self, Symbol) -> Option<Vec<Symbol>>`, `Code::symbol(&self, &[Symbol]) -> Option<Symbol>`, `bitify(&[Vec<Symbol>], &Code) -> Option<Vec<Vec<Symbol>>>`, `unbitify(&Tape, &Code) -> Option<(Vec<Symbol>, usize)>`.

- [ ] **Step 1: Create the module with the code table and the two conversions**

Create `crates/redextape-core/src/tm/two_symbol.rs`:

```rust
//! The alphabet reduction: a `Machine` over any alphabet becomes a `Machine` over **two symbols**,
//! by giving every symbol a fixed-width block of cells and simulating each step as a bit-by-bit
//! comparison against one candidate rule's pattern.
//!
//! **THE BLANK IS THE ZERO BIT, AND THAT IS FORCED RATHER THAN CHOSEN.** `BLANK` is a fixed const
//! and `Tape` materializes cells lazily, so an unvisited cell reads it and no construction can
//! change that. A machine whose alphabet were literally `{'0', '1'}` would read a THIRD symbol the
//! moment a head stepped past its written region. So the two symbols are [`ZERO`] (which IS `BLANK`)
//! and [`ONE`], and `Code` gives `BLANK` the all-zeros pattern: an unwritten region is an infinite
//! run of zero bits and must decode back to the run of blanks the original tape has there.
//!
//! **NOTHING HERE IS NAMED `binary`.** `tm/encoding/binary.rs` already owns that name for a
//! different axis — how a NUMBER is represented in a field, against how a SYMBOL is represented in
//! cells. The two compose freely and disagree about which is smaller: `EncodingKind::Binary` makes
//! the tape ALPHABET larger (`#@_01` against unary's `#@_`), so it costs this reduction a bit per
//! symbol.
//!
//! **THERE ARE NO RESERVED SYMBOLS, WHICH IS THE LARGEST SIMPLIFICATION OVER `single_tape`.** Every
//! cell of a reduced tape is a bit, so nothing of the original alphabet survives to collide with the
//! layout, the tapes stay two-way infinite, and there is no `layout_collision` analogue to call.

use std::collections::BTreeSet;

use crate::tm::machine::{BLANK, Machine, Symbol};
use crate::tm::sim::Tape;

/// The zero bit. **This IS `BLANK`** — see the module doc for why that is forced.
pub const ZERO: Symbol = BLANK;
/// The one bit.
pub const ONE: Symbol = '1';

/// The symbol ↔ bit-pattern table, and the block width `k` derived from it.
///
/// **ONE `Code` FEEDS `to_two_symbol`, `bitify` AND `unbitify`**, so the construction and the two
/// conversions cannot disagree about `k` or about any symbol's pattern. That is stage 1's "no second
/// decode path that could drift", obtained structurally instead of by discipline.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Code {
    /// Symbols in code order. `BLANK` is index 0 — forced, not conventional — and the rest follow in
    /// sorted order so the table is a function of the symbol set alone.
    order: Vec<Symbol>,
    bits: usize,
}

impl Code {
    /// The code table for `m` running on `inits`.
    ///
    /// **IT TAKES `inits` BECAUSE `Machine::alphabet()` IS NOT THE SET OF SYMBOLS THAT CAN APPEAR ON
    /// A TAPE.** That method collects reads ∪ writes. A rule with a wildcard read and a wildcard
    /// write carries an INITIAL symbol past untouched without ever mentioning it, and `BLANK` need
    /// not appear in any rule at all. The set that matters is `writes ∪ inits ∪ {BLANK}`, and
    /// `alphabet() ∪ inits ∪ {BLANK}` is the safe superset built here.
    ///
    /// The single-tape images this composes onto are the concrete case: `single_tape.rs`'s
    /// `interleave` writes a marker for EVERY tape in `0..k` whether that tape's rules mention it or
    /// not, so the reduced image of `1 + 2 * 3` runs on a tape over 15 symbols while its rules name
    /// 9 (`the_composed_machine_needs_more_symbols_than_its_rules_name` asserts both counts).
    #[must_use]
    pub fn new(m: &Machine, inits: &[Vec<Symbol>]) -> Code {
        let mut set: BTreeSet<Symbol> = m.alphabet().into_iter().collect();
        set.extend(inits.iter().flatten().copied());
        set.remove(&BLANK);
        let mut order = Vec::with_capacity(set.len() + 1);
        order.push(BLANK);
        order.extend(set);
        let mut bits = 1usize;
        while (1usize << bits) < order.len() {
            bits += 1;
        }
        Code { order, bits }
    }

    /// The block width `k`: `max(1, ceil(log2(n)))` over the symbol set. Never zero, so a pattern is
    /// never empty and a block never has width zero.
    #[must_use]
    pub fn bits(&self) -> usize {
        self.bits
    }

    /// The symbol set in code order, `BLANK` first.
    #[must_use]
    pub fn symbols(&self) -> &[Symbol] {
        &self.order
    }

    /// `s`'s bit pattern, most significant bit first, or `None` when `s` has no code. MSB-first is
    /// arbitrary; nothing depends on it beyond this function and [`Code::symbol`] agreeing.
    #[must_use]
    pub fn pattern(&self, s: Symbol) -> Option<Vec<Symbol>> {
        let idx = self.order.iter().position(|&x| x == s)?;
        Some((0..self.bits).map(|b| if (idx >> (self.bits - 1 - b)) & 1 == 1 { ONE } else { ZERO }).collect())
    }

    /// The symbol a block decodes to, or `None` when the block is the wrong width, holds a cell that
    /// is neither [`ZERO`] nor [`ONE`], or names an index past the symbol set.
    #[must_use]
    pub fn symbol(&self, block: &[Symbol]) -> Option<Symbol> {
        if block.len() != self.bits {
            return None;
        }
        let mut idx = 0usize;
        for cell in block {
            idx <<= 1;
            match *cell {
                ONE => idx |= 1,
                ZERO => {}
                _ => return None,
            }
        }
        self.order.get(idx).copied()
    }
}

/// Encode every tape: symbol `j` becomes cells `[j·k, (j+1)·k)`. `None` when any symbol has no code,
/// which is a caller pairing a `Code` with tapes it was not built from — the silently-wrong-tape
/// failure this signature exists to refuse.
#[must_use]
pub fn bitify(inits: &[Vec<Symbol>], code: &Code) -> Option<Vec<Vec<Symbol>>> {
    let mut out = Vec::with_capacity(inits.len());
    for tape in inits {
        let mut cells = Vec::with_capacity(tape.len() * code.bits());
        for s in tape {
            cells.extend(code.pattern(*s)?);
        }
        out.push(cells);
    }
    Some(out)
}

/// Recover one tape's `(contents, head index)` — the shape `Tape::snapshot` returns, so the two are
/// directly comparable.
///
/// **THE RIGHT EDGE IS PADDED AND THE LEFT EDGE IS CHECKED, AND THE ASYMMETRY IS REAL.** A write
/// pass walks right one cell per bit and lands on the FIRST cell of the next block, materializing
/// it, so the rightmost materialized cell can sit one cell into a block that is otherwise unwritten
/// — the snapshot's length need not be a multiple of `k`. Padding with [`ZERO`] is not a repair: an
/// unmaterialized cell reads `BLANK`, which IS `ZERO`, so the padding restores exactly the cells the
/// tape would have returned had they been touched. The LEFT edge carries no such slack: every head
/// move is a whole `k`-cell stride and every verify ladder rewinds to the block start it came from,
/// so the head is always on a block boundary and `head % k != 0` means the reduction is broken.
///
/// `None` on that misalignment or on a block that does not decode — a structural failure of the
/// reduction rather than a computation that went wrong, so it carries no reason: the caller has
/// nothing to do with it but fail.
#[must_use]
pub fn unbitify(tape: &Tape, code: &Code) -> Option<(Vec<Symbol>, usize)> {
    let k = code.bits();
    let (mut cells, head) = tape.snapshot();
    if head % k != 0 {
        return None;
    }
    while cells.len() % k != 0 {
        cells.push(ZERO);
    }
    let mut out = Vec::with_capacity(cells.len() / k);
    for block in cells.chunks(k) {
        out.push(code.symbol(block)?);
    }
    Some((out, head / k))
}
```

- [ ] **Step 2: Register the module**

In `crates/redextape-core/src/tm.rs`, after the `pub mod syntax;` line, add:

```rust
pub mod two_symbol;
```

- [ ] **Step 3: Add the unit tests at the bottom of `two_symbol.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::machine::{Move, Rule, State};
    use proptest::prelude::*;

    /// A machine whose rules mention exactly `syms`, so `Code::new` sees a known alphabet.
    fn machine_over(syms: &[Symbol]) -> Machine {
        let rules = syms
            .iter()
            .map(|s| Rule { read: vec![Some(*s)], write: vec![Some(*s)], moves: vec![Move::S], next: 0 })
            .collect();
        Machine { states: vec![State { name: "q".into(), accept: false, rules }], start: 0, tapes: 1 }
    }

    #[test]
    fn blank_is_always_the_all_zeros_pattern() {
        for syms in [&['a'][..], &['a', 'b', 'c'][..], &['#', '1', '@'][..]] {
            let code = Code::new(&machine_over(syms), &[]);
            assert_eq!(code.pattern(BLANK), Some(vec![ZERO; code.bits()]), "for {syms:?}");
        }
    }

    #[test]
    fn width_is_ceil_log2_and_never_zero() {
        // `BLANK` is always in the set, so n is syms.len() + 1 for these.
        assert_eq!(Code::new(&machine_over(&[]), &[]).bits(), 1, "just BLANK: n = 1, k = 1");
        assert_eq!(Code::new(&machine_over(&['a']), &[]).bits(), 1, "n = 2");
        assert_eq!(Code::new(&machine_over(&['a', 'b']), &[]).bits(), 2, "n = 3");
        assert_eq!(Code::new(&machine_over(&['a', 'b', 'c']), &[]).bits(), 2, "n = 4");
        assert_eq!(Code::new(&machine_over(&['a', 'b', 'c', 'd']), &[]).bits(), 3, "n = 5");
    }

    /// The hazard `Code::new`'s doc names: a machine whose only rule is an unconditional wildcard has
    /// an EMPTY `alphabet()`, so a code built from the rules alone has no pattern for a symbol that
    /// arrives on an initial tape.
    #[test]
    fn a_symbol_reaching_a_tape_only_through_inits_still_gets_a_code() {
        let m = Machine {
            states: vec![State {
                name: "q".into(),
                accept: false,
                rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::R], next: 0 }],
            }],
            start: 0,
            tapes: 1,
        };
        assert!(m.alphabet().is_empty(), "the only rule is an unconditional wildcard");
        let inits = vec![vec!['x', 'y']];
        assert_eq!(Code::new(&m, &[]).pattern('x'), None, "a code built from the rules alone cannot encode it");
        let code = Code::new(&m, &inits);
        assert!(code.pattern('x').is_some() && code.pattern('y').is_some());
        assert!(bitify(&inits, &code).is_some());
    }

    #[test]
    fn bitify_refuses_a_symbol_the_code_does_not_cover() {
        let code = Code::new(&machine_over(&['a']), &[]);
        assert_eq!(bitify(&[vec!['z']], &code), None);
    }

    proptest! {
        /// The round trip, through a real `Tape` rather than a `Vec`, because `Tape` is what the
        /// oracle leg hands `unbitify` and it is the thing that materializes cells lazily.
        #[test]
        fn unbitify_inverts_bitify(
            syms in prop::collection::vec(prop::sample::select(vec!['a', 'b', 'c', '#', '@', BLANK]), 0..12),
            extra in prop::sample::select(vec!['a', 'b', 'c', 'd', 'e', 'f', 'g'])
        ) {
            let m = machine_over(&[extra]);
            let code = Code::new(&m, &[syms.clone()]);
            let cells = bitify(&[syms.clone()], &code).expect("the code was built from these symbols");
            let tape = Tape::new(&cells[0]);
            let (back, head) = unbitify(&tape, &code).expect("a freshly built tape is aligned");
            prop_assert_eq!(head, 0);
            // `bitify` writes no trailing padding, so the decode is exact up to the input's length.
            prop_assert_eq!(&back[..syms.len()], &syms[..]);
        }
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-core two_symbol`
Expected: PASS, 5 tests (4 `#[test]` plus the proptest).

**Review added three more, and the reason they were missing is worth keeping.** Every test above routes through `bitify`, which always emits a whole number of blocks — so `unbitify`'s right-edge padding loop and `Code::symbol`'s three `None` branches were unreachable, and the round trip could not have noticed if either were deleted. The three added are `unbitify_pads_a_trailing_partial_block_with_zeros` (a `Tape` built directly, three cells against `k = 2`), `symbol_refuses_a_block_it_cannot_decode` (all three `None` branches plus an in-range control), and `unbitify_refuses_a_head_that_is_not_on_a_block_boundary` (a hand-built `Machine` that steps ONE cell right, which is half a block, run through `simulate_final`). Each was confirmed red under a targeted sabotage of the branch it names. **The general lesson for the tasks below: a round trip tests the paths its own encoder produces, and nothing else.**

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/two_symbol.rs crates/redextape-core/src/tm.rs
git commit -m "Add the two-symbol code table and its tape conversions

Code gives every symbol a fixed-width bit pattern with BLANK at index 0. That
assignment is forced: BLANK is a const and an unvisited cell reads it, so the
zero bit has to BE the blank or an unwritten region would decode to something
the original tape does not have there.

Code::new takes the initial tapes because Machine::alphabet() collects reads and
writes only -- a wildcard rule carries an initial symbol past without naming it,
and that symbol would have no code at all. bitify returns Option for the same
reason, so pairing a Code with tapes it was not built from is refused rather
than silently encoded wrong."
```

---

### Task 2: The construction's skeleton — entry, accept, stuck, and the one-tape rule

**Files:**
- Modify: `crates/redextape-core/src/tm/two_symbol.rs`

**Interfaces:**
- Consumes: Task 1's `Code`, `ZERO`, `ONE`.
- Produces: `to_two_symbol(&Machine, &Code) -> Machine`, and the private `Names` builder with `id`, `push_rule`, `one`, `nop`, `stride`, `rewind_ladder`, `rung`, `entry_name`.

This task builds every state that is NOT a verify or an apply pass, so the result is already correct for machines whose rules are all wildcard-read, no-write, all-`S`.

- [ ] **Step 1: Add the imports and the builder**

At the top of `two_symbol.rs`, extend the existing `use` block:

```rust
use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
```

Then append, before the `#[cfg(test)]` module:

```rust
/// Generated states per original state — the ratio that decides whether a machine can be reduced at
/// all, and the figure Task 5's gate holds a ceiling on.
#[must_use]
pub fn states_per_original(m: &Machine, code: &Code) -> f64 {
    let reduced = to_two_symbol(m, code);
    #[expect(clippy::cast_precision_loss, reason = "a ratio of state counts, reported to 2 dp")]
    let ratio = reduced.states.len() as f64 / m.states.len().max(1) as f64;
    ratio
}

/// Reduce `m` to a machine over the two symbols [`ZERO`] and [`ONE`], with `code` fixing the block
/// width and every symbol's pattern. **The tape count is PRESERVED** — this reduction varies the
/// alphabet, not the machine's shape, and is orthogonal to `single_tape.rs`'s, which varies the
/// shape and not the alphabet. Composing them in that order reaches one tape over two symbols.
///
/// **PRECONDITION: `code` must cover every symbol that can reach a tape**, which is what
/// `Code::new(m, inits)` builds and what `bitify` refuses to proceed without. A `Code` built from a
/// different machine can leave a read symbol with no pattern; the construction then emits no check
/// for that read, and the rule matches unconditionally — a silent wrong answer. Callers pair the two
/// by construction: build the `Code` once and hand the same one to `to_two_symbol` and `bitify`.
#[must_use]
pub fn to_two_symbol(m: &Machine, code: &Code) -> Machine {
    let mut b = Names::new(m.tapes);
    for (sid, st) in m.states.iter().enumerate() {
        b.emit_state(m, code, StateId::try_from(sid).unwrap_or(0), st);
    }
    b.finish(m)
}

/// Assigns a `StateId` to every generated state name, so rules can name their targets before the
/// target is emitted. Names are the text form's identity and must be unique, non-empty and free of
/// whitespace and `; * : [ ]` (`Machine::validate`), which `.`-separated segments satisfy.
struct Names {
    ids: std::collections::HashMap<String, StateId>,
    states: Vec<State>,
    tapes: usize,
}

impl Names {
    fn new(tapes: usize) -> Names {
        Names { ids: std::collections::HashMap::new(), states: Vec::new(), tapes }
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
    /// **ONE FUNCTION BECAUSE TWO SPELLINGS IS A BUG THAT TESTS GREEN**, the lesson `single_tape.rs`
    /// records under the same name: a mispredicted target mints an EMPTY state, and the simulator
    /// stopping there reports the same `Status::Halted` a real accept does. The difference is
    /// visible only in the final state's NAME, so any assertion on the status alone passes over it.
    /// Here the risk is larger than in stage 1, because a candidate's first state can be a check, a
    /// write, a move or nothing at all depending on the rule — which is why the entry is its own
    /// state rather than a name computed twice.
    fn entry_name(sid: StateId, accept: bool) -> String {
        if accept { format!("q{sid}.halt") } else { format!("q{sid}.enter") }
    }

    fn push_rule(&mut self, at: &str, rule: Rule) {
        let id = self.id(at);
        if let Some(st) = self.states.get_mut(id as usize) {
            st.rules.push(rule);
        }
    }

    /// A rule touching exactly one tape: every other tape reads a wildcard, writes nothing and stays
    /// put. Arity is `tapes` on all three vectors, which `Machine::validate` requires.
    fn one(&self, i: usize, read: Option<Symbol>, write: Option<Symbol>, mv: Move, next: StateId) -> Rule {
        let mut rule =
            Rule { read: vec![None; self.tapes], write: vec![None; self.tapes], moves: vec![Move::S; self.tapes], next };
        if let Some(slot) = rule.read.get_mut(i) {
            *slot = read;
        }
        if let Some(slot) = rule.write.get_mut(i) {
            *slot = write;
        }
        if let Some(slot) = rule.moves.get_mut(i) {
            *slot = mv;
        }
        rule
    }

    /// An unconditional rule that touches no tape at all.
    fn nop(&self, next: StateId) -> Rule {
        Rule { read: vec![None; self.tapes], write: vec![None; self.tapes], moves: vec![Move::S; self.tapes], next }
    }

    /// `n` states, each moving tape `i` one cell in `mv`, ending at `dest`. Returns the name to
    /// enter — **`dest` itself when `n == 0`, emitting nothing**, which is how a `Move::S` with no
    /// write costs zero states.
    fn stride(&mut self, prefix: &str, i: usize, mv: Move, n: usize, dest: &str) -> String {
        let mut next = dest.to_string();
        for p in (0..n).rev() {
            let name = format!("{prefix}{p}");
            let next_id = self.id(&next);
            let rule = self.one(i, None, None, mv, next_id);
            self.push_rule(&name, rule);
            next = name;
        }
        next
    }

    /// A left-rewind ladder for tape `i`: entering rung `p` moves `p` cells left and lands on
    /// `dest`. Rung 0 IS `dest`, so no state is emitted for it — see [`Names::rung`].
    fn rewind_ladder(&mut self, prefix: &str, i: usize, depth: usize, dest: &str) {
        for p in 1..=depth {
            let below = Names::rung(prefix, p - 1, dest);
            let below_id = self.id(&below);
            let rule = self.one(i, None, None, Move::L, below_id);
            self.push_rule(&format!("{prefix}{p}"), rule);
        }
    }

    /// The name of rung `p` of a ladder built by [`Names::rewind_ladder`]. **Rung 0 is `dest`, not a
    /// state**, so a caller that spells `format!("{prefix}0")` instead of calling this names a state
    /// that was never emitted — the empty-state failure `entry_name` documents.
    fn rung(prefix: &str, p: usize, dest: &str) -> String {
        if p == 0 { dest.to_string() } else { format!("{prefix}{p}") }
    }

    fn emit_state(&mut self, m: &Machine, code: &Code, sid: StateId, st: &State) {
        if st.accept {
            let name = Names::entry_name(sid, true);
            let id = self.id(&name);
            if let Some(s) = self.states.get_mut(id as usize) {
                s.accept = true;
                s.rules.clear();
            }
            return;
        }
        // A non-accept state with no matching candidate is a stuck halt in the original and stays one
        // here: a real state, with no rules, that is not an accept. The simulator stops on it, and the
        // oracle leg tells it from a real accept by the final state's `accept` flag.
        let stuck = format!("q{sid}.stuck");
        let _ = self.id(&stuck);
        // **CANDIDATES ARE EMITTED BACK TO FRONT**, so each one's fallthrough target is a name that
        // has already been built and no name is ever predicted. Determinism is first-match-wins, so
        // candidate `c`'s failure path is candidate `c + 1`'s head, and the last one's is `stuck`.
        let mut fallthrough = stuck;
        for (c, rule) in st.rules.iter().enumerate().rev() {
            let next = self.emit_candidate(m, code, sid, c, rule, &fallthrough);
            fallthrough = next;
        }
        let head_id = self.id(&fallthrough);
        let rule = self.nop(head_id);
        self.push_rule(&Names::entry_name(sid, false), rule);
    }

    fn finish(self, m: &Machine) -> Machine {
        let start = self
            .ids
            .get(&Names::entry_name(m.start, m.states.get(m.start as usize).is_some_and(|s| s.accept)))
            .copied()
            .unwrap_or(0);
        Machine { states: self.states, start, tapes: m.tapes }
    }
}
```

- [ ] **Step 2: Add the two stubs, at the signatures Tasks 3 and 4 will fill**

Inside `impl Names`, add both. **These signatures are final** — Task 3 replaces `emit_candidate`'s body and Task 4 replaces `emit_apply`'s, and neither changes an argument list. Getting them right here is what keeps the later tasks to one edit each.

```rust
    /// Emit candidate `c` of original state `sid`, whose failure path is `fallthrough`. Returns the
    /// name of the candidate's FIRST state, which is the previous candidate's failure path.
    fn emit_candidate(&mut self, m: &Machine, code: &Code, sid: StateId, c: usize, rule: &Rule, fallthrough: &str) -> String {
        let _ = (code, c, fallthrough);
        self.emit_apply(m, code, sid, c, rule)
    }

    /// Emit candidate `c`'s apply phase — every acting tape's write and move — ending in the state
    /// `rule.next` is entered at. Returns the name to enter, which is that entry directly when no
    /// tape acts.
    fn emit_apply(&mut self, m: &Machine, code: &Code, sid: StateId, c: usize, rule: &Rule) -> String {
        let _ = (code, sid, c);
        let accept = m.states.get(rule.next as usize).is_some_and(|s| s.accept);
        Names::entry_name(rule.next, accept)
    }
```

Both stubs ignore reads, writes and moves, so the construction is correct only for machines whose rules are all wildcard-read, no-write and all-`Move::S` — which is exactly what Step 3 tests. **`emit_apply` must consult `m` for `rule.next`'s accept flag even as a stub**: spelling the target `q{sid}.enter` when the target is an accept mints an EMPTY state, and the machine stopping there reports the same `Status::Halted` a real accept does. Step 3's `assert_no_accidental_empty_states` is what catches that.

- [ ] **Step 3: Add the tests**

Add to the `mod tests` block:

```rust
    use crate::tm::sim::{DEFAULT_CAPS, Status, simulate_final};

    /// Every generated state must either carry rules, be an accept, or be a NAMED stuck halt. An
    /// empty state with any other name is a target somebody spelled twice and got wrong — the
    /// failure `Names::entry_name` documents, which no status assertion can see.
    fn assert_no_accidental_empty_states(reduced: &Machine) {
        for st in &reduced.states {
            assert!(
                !st.rules.is_empty() || st.accept || st.name.ends_with(".stuck"),
                "state `{}` has no rules, is not an accept, and is not a named stuck halt",
                st.name
            );
        }
    }

    /// A machine that steps `n` times through wildcard rules and accepts. Every rule reads a
    /// wildcard, writes nothing and stays put, so Task 2's construction alone is enough for it.
    fn chain(n: usize) -> Machine {
        let mut states: Vec<State> = (0..n)
            .map(|i| State {
                name: format!("s{i}"),
                accept: false,
                rules: vec![Rule {
                    read: vec![None],
                    write: vec![None],
                    moves: vec![Move::S],
                    next: StateId::try_from(i + 1).unwrap_or(0),
                }],
            })
            .collect();
        states.push(State { name: "done".into(), accept: true, rules: vec![] });
        Machine { states, start: 0, tapes: 1 }
    }

    #[test]
    fn a_wildcard_chain_reduces_and_reaches_the_same_accept() {
        let m = chain(3);
        let code = Code::new(&m, &[]);
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        assert_eq!(reduced.tapes, m.tapes, "the alphabet reduction preserves the tape count");
        assert_eq!(reduced.alphabet(), Vec::<Symbol>::new(), "wildcard rules name no symbol at all");
        assert_no_accidental_empty_states(&reduced);
        let (_t, state, status, _steps) = simulate_final(&reduced, &[vec![]], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert!(reduced.states[state as usize].accept, "halted in `{}`", reduced.states[state as usize].name);
    }

    /// A non-accept state with no rules is stuck in the original, and the reduction must not invent
    /// an accept there. `Status::Halted` cannot tell the two apart, so this asserts the flag.
    #[test]
    fn a_stuck_original_stays_stuck_and_does_not_become_an_accept() {
        let m = Machine {
            states: vec![State { name: "s0".into(), accept: false, rules: vec![] }],
            start: 0,
            tapes: 1,
        };
        let code = Code::new(&m, &[]);
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        let (_t, state, status, _steps) = simulate_final(&reduced, &[vec![]], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert!(!reduced.states[state as usize].accept, "halted in an ACCEPT, but the original is stuck");
    }
```

- [ ] **Step 4: Run the tests**

Run: `cargo nextest run -p redextape-core two_symbol`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/two_symbol.rs
git commit -m "Build the two-symbol construction's state skeleton

to_two_symbol emits an entry state, an accept, and a named stuck halt per
original state, with candidates chained back to front so each one's failure path
is a name already built. Nothing is predicted: single_tape.rs records that
spelling a generated state's name in two places mints an empty state whose halt
reports the same status a real accept does, and a candidate's first state here
can be a check, a write, a move or nothing depending on the rule, so the risk is
larger than it was there.

The tape count is preserved. This reduction varies the alphabet; single_tape's
varies the shape. They are orthogonal and compose in that order."
```

---

### Task 3: Verify a candidate against its bit patterns

**Files:**
- Modify: `crates/redextape-core/src/tm/two_symbol.rs`

**Interfaces:**
- Consumes: Task 2's `Names`, `Code::pattern`.
- Produces: `Names::check_block`, and an `emit_candidate` that verifies but does not yet apply.

- [ ] **Step 1: Add `check_block` to `impl Names`**

```rust
    /// Verify that tape `i`'s block equals `pattern`, then rewind to the block start and enter `ok`.
    /// A mismatch at bit `p` rewinds `p` cells and enters `bad`. Returns the name to enter.
    ///
    /// **THIS IS THE "VERIFY, NEVER COLLECT" TRICK, AND IT IS WHAT MAKES THE CONSTRUCTION FIT.**
    /// Collecting a block's `k` bits into the control state to learn WHICH symbol it is costs
    /// `2ᵏ = |Γ|` states per read position. Rules are an ordered list and determinism is
    /// first-match-wins, so the reduced machine never needs to know which symbol is there — only
    /// whether it equals the one a specific candidate asks for, and comparing against a known
    /// pattern costs `k`. `single_tape.rs`'s construction turns the same trick for the same reason.
    ///
    /// **THE TWO LADDERS CANNOT SHARE.** Both walk left over the same cells; they differ only in
    /// where rung 0 goes, and a Turing machine has no return address to carry that difference in. So
    /// the cost is `k` checks plus `2(k - 1)` rungs — `3k - 2`, which equals `2k` only at `k = 2`.
    fn check_block(&mut self, prefix: &str, i: usize, pattern: &[Symbol], ok: &str, bad: &str) -> String {
        let k = pattern.len();
        let back = format!("{prefix}.back");
        let fail = format!("{prefix}.fail");
        self.rewind_ladder(&back, i, k.saturating_sub(1), ok);
        self.rewind_ladder(&fail, i, k.saturating_sub(1), bad);
        for (p, bit) in pattern.iter().enumerate() {
            let name = format!("{prefix}.chk{p}");
            // On a match: step to the next bit, or — at the last one — stand still and take the
            // success ladder, which walks the k-1 cells back to the block start.
            let (on_match, mv) = if p + 1 < k {
                (format!("{prefix}.chk{}", p + 1), Move::R)
            } else {
                (Names::rung(&back, k - 1, ok), Move::S)
            };
            let match_id = self.id(&on_match);
            let matched = self.one(i, Some(*bit), None, mv, match_id);
            self.push_rule(&name, matched);
            // Anything else abandons this candidate from depth `p`. This rule is unconditional and
            // is pushed SECOND, so first-match-wins makes it the fallthrough.
            let bad_id = self.id(&Names::rung(&fail, p, bad));
            let missed = self.one(i, None, None, Move::S, bad_id);
            self.push_rule(&name, missed);
        }
        format!("{prefix}.chk0")
    }
```

- [ ] **Step 2: Fill in `emit_candidate`'s body**

Replace the stub's body only — the signature from Task 2 is unchanged.

```rust
    /// Emit candidate `c` of original state `sid`, whose failure path is `fallthrough`. Returns the
    /// name of the candidate's FIRST state, which is the previous candidate's failure path.
    ///
    /// Built back to front: the apply phase is emitted first so the verify chain can name it, and the
    /// verify blocks are then threaded right to left so each names the next. **A wildcard read emits
    /// nothing at all**, which is the property that makes stage 1 fit too — 80.9%–82.0% of read
    /// positions are wildcards on the real lowered machines that spec measured.
    fn emit_candidate(&mut self, m: &Machine, code: &Code, sid: StateId, c: usize, rule: &Rule, fallthrough: &str) -> String {
        let mut head = self.emit_apply(m, code, sid, c, rule);
        for i in (0..self.tapes).rev() {
            let Some(want) = rule.read.get(i).copied().flatten() else { continue };
            // **A READ SYMBOL WITH NO CODE MUST NOT SILENTLY BECOME A WILDCARD.** Emitting no check
            // would make the candidate match unconditionally. `to_two_symbol`'s precondition is that
            // `code` covers `m`, and `Code::new(m, _)` always does, so this sends the candidate
            // straight to its failure path instead: a rule that can never fire, which is visible, in
            // place of one that always fires, which is not.
            let Some(pattern) = code.pattern(want) else { return fallthrough.to_string() };
            let prefix = format!("q{sid}.c{c}.t{i}");
            head = self.check_block(&prefix, i, &pattern, &head, fallthrough);
        }
        head
    }
```

**`emit_apply` is still Task 2's stub**, so this task's construction is correct for rules that read concretely but write nothing and move nowhere. Task 4 fills the rest in, and Step 4's tests are chosen to stay inside that boundary.

- [ ] **Step 4: Add the tests**

```rust
    /// A one-tape machine that accepts only when it reads `want` under the head.
    fn reads(want: Symbol, alphabet: &[Symbol]) -> Machine {
        let mut rules = vec![Rule { read: vec![Some(want)], write: vec![None], moves: vec![Move::S], next: 1 }];
        // A second candidate over a different symbol, so first-match-wins has something to fall
        // through TO and the fallthrough chain is exercised rather than assumed.
        if let Some(other) = alphabet.iter().find(|s| **s != want) {
            rules.push(Rule { read: vec![Some(*other)], write: vec![None], moves: vec![Move::S], next: 2 });
        }
        Machine {
            states: vec![
                State { name: "s0".into(), accept: false, rules },
                State { name: "yes".into(), accept: true, rules: vec![] },
                State { name: "no".into(), accept: false, rules: vec![] },
            ],
            start: 0,
            tapes: 1,
        }
    }

    #[test]
    fn a_candidate_matches_its_own_symbol_and_falls_through_on_every_other() {
        let alphabet = ['a', 'b', 'c'];
        let m = reads('b', &alphabet);
        // Built over the whole alphabet, not just the two symbols the rules name: `'c'` reaches the
        // tape only as an initial symbol, which is the case `Code::new`'s doc exists for.
        let code = Code::new(&m, &[alphabet.to_vec()]);
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        assert_no_accidental_empty_states(&reduced);
        assert_eq!(reduced.alphabet(), vec![ONE, ZERO], "two symbols, and `_` sorts after `1`");
        for sym in [BLANK, 'a', 'b', 'c'] {
            let cells = bitify(&[vec![sym]], &code).expect("the code covers the alphabet");
            let (_t, state, status, _steps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            assert_eq!(status, Status::Halted, "for {sym:?}");
            assert_eq!(
                reduced.states[state as usize].accept,
                sym == 'b',
                "reading {sym:?} halted in `{}`",
                reduced.states[state as usize].name
            );
        }
    }

    /// The verify ladders must leave the head exactly where they found it, whether the candidate
    /// matched or not — otherwise the next candidate reads a shifted block. Asserted through
    /// `unbitify`, which returns `None` on a head that is not on a block boundary.
    #[test]
    fn a_failed_candidate_leaves_the_head_on_its_block_boundary() {
        let alphabet = ['a', 'b', 'c'];
        let m = reads('b', &alphabet);
        let code = Code::new(&m, &[alphabet.to_vec()]);
        assert!(code.bits() >= 2, "a one-bit code would not exercise the ladders");
        let reduced = to_two_symbol(&m, &code);
        for sym in [BLANK, 'a', 'b', 'c'] {
            let cells = bitify(&[vec![sym]], &code).expect("the code covers the alphabet");
            let (tapes, _state, _status, _steps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            let (back, head) = unbitify(&tapes[0], &code).unwrap_or_else(|| panic!("misaligned for {sym:?}"));
            assert_eq!(head, 0, "for {sym:?}");
            assert_eq!(back.first(), Some(&sym), "verify must not write, for {sym:?}");
        }
    }
```

- [ ] **Step 5: Run the tests**

Run: `cargo nextest run -p redextape-core two_symbol`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/tm/two_symbol.rs
git commit -m "Verify a candidate rule against its bit patterns

check_block compares a block against a known pattern one cell at a time rather
than collecting the bits into the control state, which is what removes the
2^k = |alphabet| state factor -- the same trick single_tape.rs turns, for the
same reason. A wildcard read emits nothing at all.

The success and failure rewind ladders cannot share. Both walk left over the
same cells and differ only in where rung 0 goes, and a Turing machine has no
return address to carry that difference in, so a concrete read costs 3k-2 states
and not the 2k the spec estimated. The two agree at k=2 and diverge after.

A read symbol the code does not cover sends the candidate to its failure path
rather than emitting no check. Emitting no check would turn it into a wildcard,
and a rule that always fires is invisible where one that never fires is not."
```

---

### Task 4: Apply — the writes and the moves

**Files:**
- Modify: `crates/redextape-core/src/tm/two_symbol.rs`

**Interfaces:**
- Consumes: Task 2's `Names::stride`, `Names::rewind_ladder`, `Names::rung`; Task 3's `emit_candidate`.
- Produces: `Names::write_block`, and the real `emit_apply`.

- [ ] **Step 1: Add `write_block` to `impl Names`**

```rust
    /// Write `pattern` onto tape `i`, one cell per bit walking right, ending at `dest`. **The head
    /// finishes on the FIRST cell of the NEXT block**, which is why `Move::R` costs nothing beyond
    /// the write and the other two moves pay to come back.
    fn write_block(&mut self, prefix: &str, i: usize, pattern: &[Symbol], dest: &str) -> String {
        let mut next = dest.to_string();
        for (p, bit) in pattern.iter().enumerate().rev() {
            let name = format!("{prefix}.wr{p}");
            let next_id = self.id(&next);
            let rule = self.one(i, None, Some(*bit), Move::R, next_id);
            self.push_rule(&name, rule);
            next = name;
        }
        next
    }
```

- [ ] **Step 2: Fill in `emit_apply`'s body**

Replace Task 2's stub body only — the signature is unchanged.

```rust
    /// Emit candidate `c`'s apply phase — every acting tape's write and move — ending in the state
    /// `rule.next` is entered at. Returns the name to enter, which is that entry directly when no
    /// tape acts.
    ///
    /// **THE WRITE AND THE MOVE FUSE, AND `Move::S` WITH NO WRITE IS FREE.** A write walks right one
    /// cell per bit and lands on the next block, so `R` is already done, `S` owes `k` cells back and
    /// `L` owes `2k`. Without a write, `R` and `L` are a `k`-cell stride and `S` emits no state at
    /// all. Stage 1 had to split its no-write path out as an optimisation worth ~9% of its state
    /// count; here it falls out of the layout.
    ///
    /// Tapes are folded RIGHT TO LEFT so each one's pass names the next, and a tape that neither
    /// writes nor moves drops out of the chain entirely rather than contributing a no-op state.
    fn emit_apply(&mut self, m: &Machine, code: &Code, sid: StateId, c: usize, rule: &Rule) -> String {
        let accept = m.states.get(rule.next as usize).is_some_and(|s| s.accept);
        let mut dest = Names::entry_name(rule.next, accept);
        let k = code.bits();
        for i in (0..self.tapes).rev() {
            let write = rule.write.get(i).copied().flatten();
            let mv = rule.moves.get(i).copied().unwrap_or(Move::S);
            let prefix = format!("q{sid}.c{c}.t{i}");
            dest = match (write.and_then(|y| code.pattern(y)), mv) {
                // A write leaves the head on the next block: R is done, S owes k back, L owes 2k.
                (Some(pattern), Move::R) => self.write_block(&prefix, i, &pattern, &dest),
                (Some(pattern), Move::S) => {
                    let back = format!("{prefix}.ret");
                    self.rewind_ladder(&back, i, k, &dest);
                    let entry = Names::rung(&back, k, &dest);
                    self.write_block(&prefix, i, &pattern, &entry)
                }
                (Some(pattern), Move::L) => {
                    let back = format!("{prefix}.ret");
                    self.rewind_ladder(&back, i, 2 * k, &dest);
                    let entry = Names::rung(&back, 2 * k, &dest);
                    self.write_block(&prefix, i, &pattern, &entry)
                }
                // No write: a move is one k-cell stride, and staying put costs nothing.
                (None, Move::R) => self.stride(&format!("{prefix}.mvr"), i, Move::R, k, &dest),
                (None, Move::L) => self.stride(&format!("{prefix}.mvl"), i, Move::L, k, &dest),
                (None, Move::S) => dest,
            };
        }
        dest
    }
```

- [ ] **Step 3: Add the tests**

```rust
    /// A one-tape machine that writes `out` over whatever it reads, moves `mv`, and accepts.
    fn writes(out: Symbol, mv: Move, alphabet: &[Symbol]) -> Machine {
        let seed: Vec<Rule> = alphabet
            .iter()
            .map(|s| Rule { read: vec![Some(*s)], write: vec![Some(out)], moves: vec![mv], next: 1 })
            .collect();
        Machine {
            states: vec![
                State { name: "s0".into(), accept: false, rules: seed },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
            start: 0,
            tapes: 1,
        }
    }

    /// The construction against the original, cell for cell and head for head — the same assertion
    /// the oracle leg makes, on a machine small enough to read.
    #[test]
    fn a_toy_machine_matches_its_two_symbol_image_cell_for_cell() {
        let alphabet = ['a', 'b', 'c'];
        for mv in [Move::L, Move::S, Move::R] {
            let m = writes('c', mv, &alphabet);
            let inits = vec![vec!['a', 'b', 'a']];
            let code = Code::new(&m, &inits);
            let reduced = to_two_symbol(&m, &code);
            assert_eq!(reduced.validate(), Vec::<String>::new(), "for {mv:?}");
            assert_no_accidental_empty_states(&reduced);
            let (want, _ws, want_status, _wsteps) = simulate_final(&m, &inits, DEFAULT_CAPS);
            assert_eq!(want_status, Status::Halted, "for {mv:?}");
            let cells = bitify(&inits, &code).expect("the code was built from these tapes");
            let (got, gs, got_status, _gsteps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            assert_eq!(got_status, Status::Halted, "for {mv:?}");
            assert!(reduced.states[gs as usize].accept, "halted in `{}` for {mv:?}", reduced.states[gs as usize].name);
            let (back, head) = unbitify(&got[0], &code).unwrap_or_else(|| panic!("misaligned for {mv:?}"));
            let (w_cells, w_head) = want[0].snapshot();
            assert_eq!(
                crate::tm::single_tape::normalize(&back, head),
                crate::tm::single_tape::normalize(&w_cells, w_head),
                "for {mv:?}"
            );
        }
    }

    /// Multi-tape: the reduction preserves the tape count, and each tape's blocks are independent.
    #[test]
    fn two_tapes_reduce_independently() {
        let m = Machine {
            states: vec![
                State {
                    name: "s0".into(),
                    accept: false,
                    // **BOTH READS ARE CONCRETE ON PURPOSE.** One concrete read and one wildcard
                    // emits a single `check_block`, and a single check cannot catch a tape-INDEX
                    // confusion — a check or a write built for tape 0 landing on tape 1. Two
                    // concrete reads can. **IT DOES NOT CATCH A WRONG FOLD ORDER**: every generated
                    // rule touches exactly one tape, so the per-tape passes commute, and reordering
                    // them changes the step sequence without changing either tape's final contents.
                    // The wildcard-read path is covered by
                    // `a_wildcard_chain_reduces_and_reaches_the_same_accept`.
                    rules: vec![Rule {
                        read: vec![Some('a'), Some('c')],
                        write: vec![Some('b'), Some('c')],
                        moves: vec![Move::R, Move::L],
                        next: 1,
                    }],
                },
                State { name: "done".into(), accept: true, rules: vec![] },
            ],
            start: 0,
            tapes: 2,
        };
        let inits = vec![vec!['a', 'a'], vec!['c', 'a']];
        let code = Code::new(&m, &inits);
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        assert_eq!(reduced.tapes, 2);
        assert_no_accidental_empty_states(&reduced);
        let (want, _ws, _wstatus, _wsteps) = simulate_final(&m, &inits, DEFAULT_CAPS);
        let cells = bitify(&inits, &code).expect("the code was built from these tapes");
        let (got, _gs, _gstatus, _gsteps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
        for (i, tape) in want.iter().enumerate() {
            let (back, head) = unbitify(&got[i], &code).unwrap_or_else(|| panic!("tape {i} misaligned"));
            let (w_cells, w_head) = tape.snapshot();
            assert_eq!(
                crate::tm::single_tape::normalize(&back, head),
                crate::tm::single_tape::normalize(&w_cells, w_head),
                "tape {i}"
            );
        }
    }
```

- [ ] **Step 4: Cover `k == 1`, which nothing else in the corpus reaches**

Task 3's review found both ladders degenerate to nothing at `k == 1` and that no test reaches it: every other machine in this file has three or more symbols, and so does every machine this project lowers. Correct by reading is not the same as covered.

```rust
    /// **`k == 1` DEGENERATES BOTH LADDERS TO NOTHING.** The check state's match arm must go
    /// straight to `ok` and its mismatch arm straight to `bad`, because `Names::rung(_, 0, dest)` IS
    /// `dest` and emits no state. Naming a rung here instead would mint an empty state, and halting
    /// in one reports the same `Status::Halted` a real accept does.
    #[test]
    fn a_one_bit_code_emits_no_ladder_rungs_and_still_decides() {
        let alphabet = ['a'];
        let m = reads('a', &alphabet);
        let code = Code::new(&m, &[alphabet.to_vec()]);
        assert_eq!(code.bits(), 1, "BLANK and `a` is two symbols, so one bit");
        let reduced = to_two_symbol(&m, &code);
        assert_eq!(reduced.validate(), Vec::<String>::new());
        assert_no_accidental_empty_states(&reduced);
        for sym in [BLANK, 'a'] {
            let cells = bitify(&[vec![sym]], &code).expect("the code covers the alphabet");
            let (_t, state, status, _steps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            assert_eq!(status, Status::Halted, "for {sym:?}");
            assert_eq!(
                reduced.states[state as usize].accept,
                sym == 'a',
                "reading {sym:?} halted in `{}`",
                reduced.states[state as usize].name
            );
        }
    }
```

- [ ] **Step 5: Cover the two arms `stride` is the only route to**

Review found `stride` had **never executed** — it carried `#[expect(dead_code)]` through Tasks 2 and 3, which only survives `-D warnings` while nothing calls the item, and the only two arms that reach it are a move with no write. That is every scanning step a real lowered machine takes.

```rust
    /// **`stride` HAD NEVER EXECUTED BEFORE THIS TEST.** It carried `#[expect(dead_code)]` through
    /// two tasks — which only survives `-D warnings` while nothing calls the item — and the two arms
    /// that reach it, a move with no write, are reached by no other machine in this file.
    #[test]
    fn a_move_with_no_write_strides_one_whole_block() {
        for mv in [Move::R, Move::L] {
            let m = Machine {
                states: vec![
                    State {
                        name: "s0".into(),
                        accept: false,
                        rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![mv], next: 1 }],
                    },
                    State { name: "done".into(), accept: true, rules: vec![] },
                ],
                start: 0,
                tapes: 1,
            };
            let inits = vec![vec!['a', 'b', 'c']];
            let code = Code::new(&m, &inits);
            let reduced = to_two_symbol(&m, &code);
            assert_eq!(reduced.validate(), Vec::<String>::new(), "for {mv:?}");
            assert_no_accidental_empty_states(&reduced);
            let (want, _ws, _wstatus, _wsteps) = simulate_final(&m, &inits, DEFAULT_CAPS);
            let cells = bitify(&inits, &code).expect("the code was built from these tapes");
            let (got, gs, got_status, _gsteps) = simulate_final(&reduced, &cells, DEFAULT_CAPS);
            assert_eq!(got_status, Status::Halted, "for {mv:?}");
            assert!(reduced.states[gs as usize].accept, "halted in `{}` for {mv:?}", reduced.states[gs as usize].name);
            // A stride of the wrong LENGTH leaves the head off a block boundary and `unbitify`
            // refuses; a stride in the wrong DIRECTION lands on the wrong block and the comparison
            // fails. The two failure modes are distinguishable in the output, and both were checked.
            let (back, head) = unbitify(&got[0], &code).unwrap_or_else(|| panic!("misaligned for {mv:?}"));
            let (w_cells, w_head) = want[0].snapshot();
            assert_eq!(
                crate::tm::single_tape::normalize(&back, head),
                crate::tm::single_tape::normalize(&w_cells, w_head),
                "for {mv:?}"
            );
        }
    }
```

- [ ] **Step 6: Run the tests**

Run: `cargo nextest run -p redextape-core two_symbol`
Expected: PASS, 16 tests.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/tm/two_symbol.rs
git commit -m "Apply a matched candidate's writes and moves

A write walks right one cell per bit and lands on the next block, so the write
and the move fuse: R is already done, S owes k cells back, L owes 2k. Without a
write a move is one k-cell stride and staying put emits no state at all. Stage 1
had to split its no-write path out as an optimisation worth about 9% of its
state count; here it falls out of the layout.

Tapes fold right to left so each pass names the next, and a tape that neither
writes nor moves leaves the chain rather than contributing a no-op."
```

---

### Task 5: Measure the state budget, and gate it

**Files:**
- Modify: `crates/redextape-core/src/tm/two_symbol.rs`

**Interfaces:**
- Consumes: `states_per_original`, and the demo pipeline `parse` → `desugar` → `result_type` → `run_tm_described`.
- Produces: a measured ceiling constant and the tests that hold it.

- [ ] **Step 1: Measure before writing any assertion**

Add a temporary `#[test]` that prints rather than asserts:

```rust
    #[test]
    fn print_the_state_ratio() {
        for src in [
            "1 + 2 * 3",
            "3 - 5",
            "if 2 > 1 { 10 } else { 20 }",
            "cons(1, cons(2, nil))",
            "let x = 40; x + 2",
            "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        ] {
            for enc in [crate::tm::EncodingKind::Unary, crate::tm::EncodingKind::Binary] {
                let (m, inits) = demo_machine(src, enc);
                let code = Code::new(&m, &inits);
                println!("{src:60} {enc:?} k={} states={} ratio={:.6}", code.bits(), m.states.len(), states_per_original(&m, &code));
            }
        }
    }
```

with the helper (place it in `mod tests`):

```rust
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
```

Run: `cargo nextest run -p redextape-core two_symbol::tests::print_the_state_ratio --no-capture`

**Write the printed table into this plan below this step before continuing.** Do not carry the spec's estimate of 18 forward — it is an estimate, and stage 1's equivalent estimate came out 2.7× low.

**MEASURED, 2026-09-10.** Generated states per original state:

| program | states (U/B) | unary | binary |
| --- | --- | --- | --- |
| `1 + 2 * 3` | 143 / 278 | 14.062937 | 17.982014 |
| `3 - 5` | 60 / 58 | 12.150000 | 20.155172 |
| `if 2 > 1 { 10 } else { 20 }` | 96 / 101 | 12.531250 | 15.970297 |
| `cons(1, cons(2, nil))` | 146 / 201 | 13.568493 | **29.502488** (`k` = 3) |
| `let x = 40; x + 2` | 123 / 112 | **11.569106** | 25.205357 |
| `fn sum(n) … sum(5)` | 1182 / 1371 | 15.449239 | 23.819840 |

Every row is `k = 2` except the marked one. **The spec's estimate of 18 sits inside the range and misses the worst case by 1.6×** — better than stage 1's 2.7×, and still not a number anything should have been built on.

**THE RESULT THE SPEC DID NOT PREDICT AT ALL: `EncodingKind::Binary` COSTS MORE IN EVERY SINGLE ROW.** The spec expected it to matter by widening the alphabet and so raising `k`, and that happens exactly once, in the `cons` row. But `3 - 5` goes 12.150000 → 20.155172 **at the same `k`, on a machine that is smaller** (60 original states → 58), and `let x = 40; x + 2` goes 11.569106 → 25.205357, also at `k = 2`. So the extra cost is not the wider alphabet. **THE CAUSE THIS PARAGRAPH FIRST GAVE — "roughly twice the concrete reads per rule" — IS ALSO WRONG, AND WRONG IN A WAY THAT HIDES HALF THE EFFECT.** Measured per rule and per state (from a probe, not a shipped command): reads per rule go 0.904 → 1.283 for `3 - 5`, 0.921 → 1.450 for `let x = 40; x + 2`, 0.924 → 1.104 for `1 + 2 * 3` — factors of 1.42, 1.57 and 1.19, not two. And **rules per state rises by a comparable factor** over the same three: 1.900 → 2.379, 1.748 → 2.696, 2.203 → 2.424. For `let x = 40; x + 2` those two multipliers are 1.57 and 1.54, so rules-per-state accounts for about half the ratio's increase and the original claim credited it with none. Binary machines carry more concrete reads per rule *and* more rules per state. The six factors above run 1.10 to 1.57, and a concrete read costs `3k - 2`, which is how more reads per rule and more rules per state both turn into more states.

- [ ] **Step 2: Replace the printing test with a gate on the measured ceiling**

Delete `print_the_state_ratio`. Add, with `CEILING` set from the table you just wrote, rounded UP to the next whole number:

```rust
    /// The ratio the construction may not exceed, as a PROPERTY rather than a restated measurement.
    /// **A gate on an exact figure is a gate that a one-state change trips**, which stage 1 learned
    /// by putting a program with a 0.062% margin inside its gated set. This holds a ceiling, and
    /// `print_the_state_ratio`'s successor prints the live figure so a move is visible without being
    /// fatal.
    const STATE_CEILING: f64 = 30.0;

    #[test]
    fn the_construction_stays_under_its_state_ceiling() {
        for src in ["1 + 2 * 3", "cons(1, cons(2, nil))", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"] {
            for enc in [crate::tm::EncodingKind::Unary, crate::tm::EncodingKind::Binary] {
                let (m, inits) = demo_machine(src, enc);
                let code = Code::new(&m, &inits);
                let ratio = states_per_original(&m, &code);
                println!("{src:60} {enc:?} k={} ratio={ratio:.6}", code.bits());
                assert!(
                    ratio < STATE_CEILING,
                    "{src} at {enc:?} (k={}) measures {ratio:.6} against {STATE_CEILING}",
                    code.bits()
                );
            }
        }
    }

    /// One entry state per **non-accept** original state — the arity this test checks, and the reason
    /// it exists: a state emitted twice would otherwise be absorbed into the ratio above.
    ///
    /// **THIS SAYS NOTHING ABOUT STEPS.** What the entry state costs at run time is a different
    /// quantity, needing a different instrument, and no figure for it is asserted anywhere in this
    /// file. Two earlier drafts of this comment asserted one: the first claimed this test measured
    /// it, the second dropped that and kept the figure.
    #[test]
    fn the_entry_state_overhead_is_one_state_per_original_state() {
        let (m, inits) = demo_machine("1 + 2 * 3", crate::tm::EncodingKind::Unary);
        let code = Code::new(&m, &inits);
        let reduced = to_two_symbol(&m, &code);
        let entries = reduced.states.iter().filter(|s| s.name.ends_with(".enter")).count();
        let non_accept = m.states.iter().filter(|s| !s.accept).count();
        assert_eq!(entries, non_accept, "one entry state per non-accept original state, and no more");
    }
```

- [ ] **Step 3: Run the tests**

Run: `cargo nextest run -p redextape-core two_symbol --no-capture`
Expected: PASS, 18 tests, with the ratio table printed.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm/two_symbol.rs
git commit -m "Gate the construction's state ratio against a measured ceiling

The gate holds a ceiling and prints the live figure, rather than asserting the
measurement back. Stage 1 put a program with a 0.062% margin inside its gated
set, where a seven-state change to an 11,024-state image would trip it.

The entry state's overhead is asserted at one per non-accept original state, so
a change that makes it larger is visible rather than absorbed into the ratio."
```

---

### Task 6: The fifth oracle leg

**Files:**
- Create: `crates/redextape-core/tests/two_symbol_oracle.rs`

**Interfaces:**
- Consumes: `to_two_symbol`, `Code`, `bitify`, `unbitify`, `single_tape::normalize`.
- Produces: the normal-tier leg. Task 7 adds the slow tier to this same file.

- [ ] **Step 1: Confirm the corpus members**

Run: `grep -n 'cons(1, cons(2, nil))\|if 2 > 1\|3 - 5' crates/redextape-native/tests/native_oracle.rs`
Expected: each string appears inside `FIRST_ORDER_DEMOS`. **A program that is not a member gets no four-way chain to add a fifth equality to** — it would establish `multitape == two-symbol` and nothing else. If any is absent, replace it with one that is present and say so in the file's doc comment.

- [ ] **Step 2: Write the test file**

Create `crates/redextape-core/tests/two_symbol_oracle.rs`:

```rust
//! The fifth oracle leg: `reference == λ == multitape-TM == singletape-TM == two-symbol-TM`. The
//! first three are `three_way_oracle.rs`'s and `native_oracle.rs`'s subject and the fourth is
//! `single_tape_oracle.rs`'s; this file adds the fifth, and asserts it by TAPE IDENTITY rather than
//! by decoded value — strictly stronger, and it needs no second decode path that could drift.
//!
//! **THE COMPARISON IS `single_tape::normalize`, AND ITS DOCUMENTED WEAKNESS IS INHERITED WHOLE.**
//! Reusing it is deliberate — one trimmer means the two reductions' legs cannot disagree about what
//! "the same tape" means — but on an ALL-BLANK tape it discards the head position, so every
//! assertion below is satisfied by any head on either side whenever that tape ends all blank, which
//! most tapes in this corpus do. That is an instrument weakness, not a construction defect: nothing
//! in `to_two_symbol`, `bitify` or `unbitify` loses head information, only this comparison does.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::machine::{Machine, Symbol};
use redextape_core::tm::sim::{Caps, DEFAULT_CAPS, Status, simulate_final};
use redextape_core::tm::single_tape::normalize;
use redextape_core::tm::two_symbol::{Code, bitify, to_two_symbol, unbitify};
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

/// The leg itself, over an arbitrary machine and its tapes, so Task 7 can point it at a single-tape
/// image without a second copy of the assertions.
fn assert_two_symbol_agrees(label: &str, m: &Machine, inits: &[Vec<Symbol>], caps: Caps) -> (u64, u64) {
    let code = Code::new(m, inits);
    let (want, _ws, want_status, want_steps) = simulate_final(m, inits, caps);
    assert_eq!(want_status, Status::Halted, "the source run must halt for {label}");

    let reduced = to_two_symbol(m, &code);
    assert_eq!(reduced.validate(), Vec::<String>::new(), "the reduced machine must be well formed for {label}");
    assert_eq!(reduced.alphabet().len(), 2, "the whole point: two symbols, for {label}");
    let cells = bitify(inits, &code).expect("the code was built from these tapes");
    let (got, got_state, got_status, got_steps) = simulate_final(&reduced, &cells, caps);
    assert_eq!(got_status, Status::Halted, "the reduced run hit a cap for {label}");
    // NOT just "it halted": a stuck state halts too and reports the same `Status`. The difference is
    // visible only in the final state's accept flag, which is the gap stage 1's Task 6 review found
    // by sabotaging `entry_name` and watching its strongest leg stay green.
    assert!(
        reduced.states[got_state as usize].accept,
        "halted in `{}`, not an accept, for {label}",
        reduced.states[got_state as usize].name
    );

    for (i, tape) in want.iter().enumerate() {
        let (back, head) = unbitify(&got[i], &code).unwrap_or_else(|| panic!("tape {i} misaligned for {label}"));
        let (w_cells, w_head) = tape.snapshot();
        assert_eq!(normalize(&back, head), normalize(&w_cells, w_head), "tape {i} differs for {label}");
    }
    assert!(got_steps > want_steps, "the reduction should cost more steps, not fewer, for {label}");
    (want_steps, got_steps)
}

/// Every member here MUST be a member of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`
/// (`crates/redextape-native/tests/native_oracle.rs`), which is what this file's doc claims a fifth
/// leg onto: that array's four-way oracle already asserts `reference == λ == multitape-TM ==
/// native` for every entry, so a program drawn from it gets the earlier equalities for free and this
/// leg only adds the fifth. A program NOT in that array gets no such thing — it would establish
/// `multitape-TM == two-symbol-TM` and nothing else.
#[test]
fn the_two_symbol_leg_agrees_on_small_programs() {
    for src in ["3 - 5", "if 2 > 1 { 10 } else { 20 }", "cons(1, cons(2, nil))"] {
        let (m, inits) = build_machine(src, EncodingKind::Unary);
        assert_two_symbol_agrees(src, &m, &inits, DEFAULT_CAPS);
    }
}

/// **THE ONE AXIS THAT MOVES `k`.** `EncodingKind::Binary` makes the tape ALPHABET larger, not
/// smaller — `#@_01` against unary's `#@_` — so `cons(1, cons(2, nil))` needs 3 bits per symbol
/// where unary needs 2. The roadmap asks whether the oracle runs the product of its axes or a
/// diagonal; this is a diagonal with one deliberate off-axis point, not a product.
#[test]
fn the_leg_holds_where_the_encoding_widens_the_alphabet() {
    let src = "cons(1, cons(2, nil))";
    let (unary, u_inits) = build_machine(src, EncodingKind::Unary);
    let (binary, b_inits) = build_machine(src, EncodingKind::Binary);
    let u_bits = Code::new(&unary, &u_inits).bits();
    let b_bits = Code::new(&binary, &b_inits).bits();
    assert!(b_bits > u_bits, "binary must widen the alphabet here: {u_bits} -> {b_bits}");
    assert_two_symbol_agrees(&format!("{src} (binary)"), &binary, &b_inits, DEFAULT_CAPS);
}
```

**WHAT THREE FIX ROUNDS CHANGED, AND THE FINDING THAT OUTLIVES THEM.** The leg as drafted above claimed to assert tape identity "strictly stronger" than a decoded-value comparison. For most of this corpus it does not, and the reason is `single_tape::normalize`, which discards the head position on an all-blank tape — so comparing two all-blank tapes succeeds for any pair of heads. Measured per tape rather than argued: **8 of 20 comparisons discriminate a head position and 12 do not.** The fix hoists the corpus into a `CORPUS` constant, adds `the_leg_reports_how_many_of_its_tape_comparisons_discriminate` to count and print the distribution with a per-program floor, and cuts the module doc's claim down to what holds.

The corpus gained a fourth member, `fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))`, **for a reason that turned out to be false**: that calling a function would leave the STACK tape non-blank. `return` pops the frame before halt, so it ends blank exactly as in the other three — and the per-tape measurement is what falsified it. The member stays because it is the corpus's only program whose lowering emits `encoding.rs`'s `Encoding::push_frame` and `Encoding::pop_frame_restore`, and the comment now records both that the original reason was false and that nothing in the file enforces the current one.

**A GATE WENT GREEN AND BLIND ON THE WAY.** The third round's brief cited `lower_tm.rs` for those two methods, which are defined in `encoding.rs`. `scripts/check-attributions.sh` — whose entire purpose is rejecting a citation that names the wrong file — passed it: 494 sites, 0 violations, exit 0. It matches on textual presence, and `lower_tm.rs` contains both names as call sites. The gate cannot distinguish a definition from a call. Found only because the implementer verified the citation by hand and refused to commit.

- [ ] **Step 3: Run the leg**

Run: `cargo nextest run -p redextape-core --test two_symbol_oracle`
Expected: PASS, 2 tests. If `the_leg_holds_where_the_encoding_widens_the_alphabet` fails its `b_bits > u_bits` assertion, the alphabets have moved since the spec measured them — re-derive both with the command in the spec's alphabet table and pick a program where they still differ, rather than deleting the assertion.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/tests/two_symbol_oracle.rs
git commit -m "Add the fifth oracle leg

reference == lambda == multitape-TM == singletape-TM == two-symbol-TM, asserted
by tape identity rather than by decoded value: every tape's contents and head
against the source run, so decode_tape takes the recovered tapes unchanged and
no second decode path exists to drift.

The corpus is drawn from FIRST_ORDER_DEMOS so the earlier equalities come free.
A non-member would establish multitape == two-symbol and nothing else, which is
the mistake stage 1's corpus made before it was corrected.

The leg checks the final state's accept flag, not just its status. A stuck halt
reports the same status a real accept does, and stage 1's review found exactly
that gap by sabotaging entry_name and watching its strongest leg stay green.

One leg runs under EncodingKind::Binary, the one axis that moves k -- it makes
the tape alphabet larger, not smaller."
```

---

### Task 7: The canonical machine, the cost table, and the sabotage

**Files:**
- Modify: `crates/redextape-core/tests/two_symbol_oracle.rs`

**Interfaces:**
- Consumes: Task 6's `assert_two_symbol_agrees` and `build_machine`; `single_tape::{interleave, to_single_tape, layout_collision}`.
- Produces: the slow-tier tests and the measured tables the roadmap entry quotes.

- [ ] **Step 1: Pin the counts the spec's `Code::new(inits)` argument rests on**

Append to `two_symbol_oracle.rs`:

```rust
use redextape_core::tm::machine::BLANK;
use redextape_core::tm::single_tape::{interleave, layout_collision, to_single_tape};
use std::collections::BTreeSet;

/// Padding blocks per side for the single-tape image, matching `single_tape_oracle.rs`'s `PAD`.
const PAD: usize = 2;

/// **THE CONCRETE CASE FOR `Code::new` TAKING THE INITIAL TAPES.** `interleave` writes a marker for
/// EVERY tape in `0..k`, whether that tape's rules mention it or not, so a single-tape image runs on
/// a tape carrying symbols its rules never name. `Machine::alphabet()` cannot see them.
///
/// **BOTH PROGRAMS STILL NEED 4 BITS EITHER WAY, SO NEITHER WOULD CATCH A `Code` BUILT FROM THE
/// RULES ALONE** — which is why the sabotage below exists rather than trust in this corpus.
#[test]
fn the_composed_machine_needs_more_symbols_than_its_rules_name() {
    for (src, rules_only, with_inits) in [("1 + 2 * 3", 9, 15), ("cons(1, cons(2, nil))", 12, 16)] {
        let (m, inits) = build_machine(src, EncodingKind::Unary);
        assert_eq!(layout_collision(&m, &inits), None, "a data symbol collides with stage 1's layout for {src:?}");
        let single = to_single_tape(&m);
        let cells = interleave(&inits, m.tapes, PAD, PAD);
        let named: BTreeSet<Symbol> = single.alphabet().into_iter().collect();
        let mut reachable = named.clone();
        reachable.extend(cells.iter().copied());
        reachable.insert(BLANK);
        assert_eq!(named.len(), rules_only, "symbols the rules of {src:?}'s image name");
        assert_eq!(reachable.len(), with_inits, "symbols that can reach {src:?}'s image's tape");
        assert_eq!(Code::new(&single, &[cells]).symbols().len(), with_inits, "Code::new must see all of them");
    }
}
```

- [ ] **Step 2: The composed canonical machine, gated cheaply and executed slowly**

**Split in two on purpose.** Building the composed machine is cheap and asserting what it IS — one tape, one head, two symbols — is the roadmap's punchline, so it belongs in the normal tier where it is a live gate. RUNNING it is not cheap: it is the single-tape image's step count multiplied again, and stage 1 measured `1 + 2 * 3` alone at hundreds of millions of single-tape steps. Only the execution goes behind `#[ignore]`.

```rust
/// **ONE TAPE, ONE HEAD, TWO SYMBOLS** — stage 1 composed with stage 2, which is the roadmap's
/// stated reason to do the alphabet reduction second. Only stage 3's one-way fold is missing.
///
/// This asserts the SHAPE, which is cheap. `the_composed_machine_runs` asserts that it computes the
/// same thing, which is not.
#[test]
fn the_composed_machine_is_one_tape_over_two_symbols() {
    for src in ["3 - 5", "if 2 > 1 { 10 } else { 20 }", "cons(1, cons(2, nil))"] {
        let (m, inits) = build_machine(src, EncodingKind::Unary);
        assert_eq!(layout_collision(&m, &inits), None, "a data symbol collides with stage 1's layout for {src:?}");
        let single = to_single_tape(&m);
        let cells = vec![interleave(&inits, m.tapes, PAD, PAD)];
        let code = Code::new(&single, &cells);
        let canonical = to_two_symbol(&single, &code);
        assert_eq!(canonical.validate(), Vec::<String>::new(), "for {src:?}");
        assert_eq!(canonical.tapes, 1, "one tape, for {src:?}");
        assert_eq!(canonical.alphabet().len(), 2, "two symbols, for {src:?}");
        assert!(canonical.states.len() < 1_000_000, "over MAX_MACHINE_STATES for {src:?}");
        println!(
            "{src:40} k={} states={} (from {} single-tape, {} original)",
            code.bits(),
            canonical.states.len(),
            single.states.len(),
            m.states.len()
        );
    }
}

/// The composed machine actually computing the same thing. **The corpus is ONE program and the
/// smallest one available**, because this is stage 1's step count multiplied by stage 2's and stage
/// 1's own cost table needed 400,000,000 steps for programs of this size.
#[test]
#[ignore = "slow tier: stage 1's step count multiplied again; run via cargo nextest run \
            -p redextape-core --test two_symbol_oracle --run-ignored all"]
fn the_composed_machine_runs() {
    const CAPS: Caps = Caps { steps: 2_000_000_000, cells: DEFAULT_CAPS.cells };
    let src = "3 - 5";
    let (m, inits) = build_machine(src, EncodingKind::Unary);
    assert_eq!(layout_collision(&m, &inits), None, "a data symbol collides with stage 1's layout");
    let single = to_single_tape(&m);
    let cells = vec![interleave(&inits, m.tapes, PAD, PAD)];
    let (want, got) = assert_two_symbol_agrees(&format!("{src} (composed)"), &single, &cells, CAPS);
    println!("{src:40} single-tape {want:>12}  composed {got:>14}  ratio {:.2}x", got as f64 / want as f64);
}
```

**If `the_composed_machine_runs` does not finish in a few minutes**, do not raise `CAPS` — CI's `rust-slow` job has to sit through it. Record the step count it reached, and either drop the execution test with that measurement as the reason it cannot exist, or find a smaller program than `3 - 5`. A test nobody can run is worse than a recorded number saying why.

- [ ] **Step 3: The cost table**

```rust
/// The roadmap's actual point: "polynomial slowdown is normally a hand-wave; here step counts are
/// exact integers". **`k` IS NAMED IN EVERY ROW**, because a blowup quoted without the block width
/// it was measured at is not a property of the reduction — the same trap stage 1's cost table fell
/// into with its padding constant, where a raw ratio spanning 4.98× across three programs was
/// measuring `PAD` rather than the construction.
///
/// **THE PREDICTION THIS TABLE TESTS:** unlike stage 1, this reduction is LOCAL — a head moves at
/// most `k` cells to read, `k` back to rewind and `k` to move — so the per-step cost should be `O(k)`
/// and INDEPENDENT of tape length, where stage 1's every step sweeps the whole tape. If that holds,
/// the ratio column is near-constant across programs of very different tape lengths.
#[test]
#[ignore = "slow tier: run via cargo nextest run -p redextape-core --test two_symbol_oracle --run-ignored all"]
fn the_two_symbol_cost_table() {
    const CAPS: Caps = Caps { steps: 400_000_000, cells: DEFAULT_CAPS.cells };
    for src in ["1 + 2 * 3", "let x = 40; x + 2", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"] {
        for enc in [EncodingKind::Unary, EncodingKind::Binary] {
            let (m, inits) = build_machine(src, enc);
            let code = Code::new(&m, &inits);
            let (want, got) = assert_two_symbol_agrees(&format!("{src} ({enc:?})"), &m, &inits, CAPS);
            let ratio = got as f64 / want as f64;
            println!(
                "{src:60} {enc:>6?}  k {}  source {want:>10}  two-symbol {got:>12}  ratio {ratio:>7.2}x  ratio/k {:>6.2}",
                code.bits(),
                ratio / code.bits() as f64
            );
        }
    }
}
```

- [ ] **Step 4: Run the slow tier and record the numbers**

Run: `cargo nextest run -p redextape-core --test two_symbol_oracle --run-ignored all --no-capture`
Expected: PASS. **Write the printed cost table into this plan below this step.**

**MEASURED.** Every row `k = 2`:

| program | enc | source steps | two-symbol steps | ratio | ratio/k |
| --- | --- | --- | --- | --- | --- |
| `1 + 2 * 3` | U | 1,020 | 7,161 | 7.02x | 3.51 |
| `1 + 2 * 3` | B | 613 | 4,245 | 6.92x | 3.46 |
| `let x = 40; x + 2` | U | 2,870 | 19,589 | 6.83x | 3.41 |
| `let x = 40; x + 2` | B | 405 | 2,923 | 7.22x | 3.61 |
| `fn sum(n) … sum(5)` | U | 50,542 | 353,397 | 6.99x | 3.50 |
| `fn sum(n) … sum(5)` | B | 18,086 | 134,438 | 7.43x | 3.72 |

**THE LOCALITY PREDICTION HELD, AND THE THING IT DEMONSTRATES IS NARROWER THAN "ratio/k IS CONSTANT".**
Source step counts span 405 to 50,542 — a factor of 125 — and the raw ratio moves from 6.83x to 7.43x,
a factor of 1.09. That is independence from **tape length** — though 125 is a span of step counts, not
of tape lengths, which over the same six rows run 26 to 261 cells at their longest initial tape, a
factor of 10, measured by a probe rather than printed by anything — which is what a local construction
predicts and what stage 1, sweeping its whole tape on every step, could not deliver. It is **not**
evidence of `O(k)` scaling: every row here shares one `k`, so dividing by `k` divides six numbers by a
constant. `the_two_symbol_cost_table` asserts the rows agree on `k`, because that premise is what its
own conclusion rests on.

**And the step estimate erred in the opposite direction to the state estimate.** The spec predicted
≈12x and measured 6.83x–7.43x, so it was high by about 1.7x, where its state estimate of 18 was low by
about 1.6x against a measured 29.5. If any row hits its cap, lower that program out of the corpus rather than raising `CAPS` past what CI will sit through, and say which one and why.

- [ ] **Step 5: The sabotage**

Do NOT commit this. Apply it, measure, revert.

Edit `Code::new` in `two_symbol.rs` to drop the initial tapes and the blank:

```rust
        let mut set: BTreeSet<Symbol> = m.alphabet().into_iter().collect();
        // SABOTAGE: `set.extend(inits.iter().flatten().copied());` removed.
        // SABOTAGE: `BLANK` is no longer forced into index 0.
```

Run: `cargo nextest run -p redextape-core two_symbol && cargo nextest run -p redextape-core --test two_symbol_oracle --run-ignored all`

**The property this sabotage aims at is exactly "the code table covers every symbol that can reach a tape, not merely every symbol a rule names".** Record, in the plan and then in the roadmap entry:

1. Which tests go red, by name.
2. **Whether the oracle leg itself reddens.** If it stays green, that is the finding and it goes in the roadmap entry as one — an oracle leg asserts correctness and a green leg under a sabotage means the leg cannot see this property, which is what stage 1's Task 6 review discovered about its own strongest check.
3. Whether `a_symbol_reaching_a_tape_only_through_inits_still_gets_a_code` and `blank_is_always_the_all_zeros_pattern` are the only two that catch it, which is what makes them load-bearing rather than decorative.

**MEASURED, AND THE HEADLINE RESULT IS THE OPPOSITE OF WHAT RUNNING THE SABOTAGE AS WRITTEN SUGGESTS.**

The sabotage as this step writes it changes **two** things — it drops `inits` and it stops forcing
`BLANK` to index 0 — so its combined result attributes to one property what the other is doing. Split
and run separately:

| sabotage | fifth oracle leg | what reddens |
| --- | --- | --- |
| both halves, as written above | **RED** | 12 lib, 5 oracle |
| `inits` dropped only | **GREEN** | 5 lib, 2 oracle |
| `BLANK` not forced to 0 only | RED | the leg, via the round trip |

**THE HALF THAT TARGETS THE PROPERTY THIS STEP NAMES LEAVES THE LIVE GATE GREEN.** Dropping `inits`
attacks exactly "the code table covers every symbol that can reach a tape, not merely every symbol a
rule names" — and the fifth leg does not notice, because on all four `CORPUS` members
`Code::new(m, inits)` and `Code::new(m, &[])` are **identical**: same `k`, same symbol set, and
byte-identical reduced state counts. On the corpus the leg runs, the `inits` argument is inert.

The only *leg* that caught it was `the_composed_machine_runs` — which was `#[ignore]`d into the slow
tier. **This is the same result as stage 1**, whose equivalent sabotage left its strongest leg green,
not the opposite of it.

**AN EARLIER DRAFT OF THIS PARAGRAPH SAID ONE COUNTING TEST WAS THE ONLY NORMAL-TIER CATCHER, WHICH
THE TABLE ABOVE CONTRADICTS.** Five normal-tier unit tests in `two_symbol.rs` catch it:
`a_symbol_reaching_a_tape_only_through_inits_still_gets_a_code`,
`a_candidate_matches_its_own_symbol_and_falls_through_on_every_other`,
`a_failed_candidate_leaves_the_head_on_its_block_boundary`,
`a_move_with_no_write_strides_one_whole_block` and `unbitify_inverts_bitify`, alongside the counting
test `the_composed_machine_needs_more_symbols_than_its_rules_name`. **That also answers this step's own
question** — whether the two tests it nominates are "the only two that catch it, which is what makes
them load-bearing rather than decorative". No, in both directions: five catch it, and
`blank_is_always_the_all_zeros_pattern`, one of the two nominated, catches the *other* half instead.

Closing the gap: `the_composed_machine_runs` measures 0.33s, so the whole-branch fix wave promoted it
to the normal tier. **In `two_symbol_oracle.rs`** it is the only test that runs a machine whose `Code`
the initial tapes changed; three of the five unit tests above run one over in `two_symbol.rs`, and
`the_composed_machine_is_one_tape_over_two_symbols` builds three without executing them.

Then: `git checkout crates/redextape-core/src/tm/two_symbol.rs`

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/tests/two_symbol_oracle.rs
git commit -m "Compose the canonical machine, and measure what it costs

to_two_symbol(to_single_tape(m)) is one tape, one head, two symbols -- the
roadmap's stated reason to do the alphabet reduction after single-tape, with
only stage 3's one-way fold missing.

The cost table names k in every row. A blowup quoted without the block width it
was measured at is not a property of the reduction, which is the trap stage 1's
table fell into with its padding constant: a raw ratio spanning 4.98x across
three programs was measuring PAD rather than the construction.

The table tests a prediction as well as reporting a number. This reduction is
local -- a head moves at most k cells to read, k back, and k to move -- so the
per-step cost should be independent of tape length where stage 1's every step
sweeps the whole tape."
```

---

## Before the PR

- [ ] Run `scripts/check-all.sh`.
- [ ] Write the roadmap entry in `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, under the *Machine-model reductions — a PIPELINE* bullet, marking stage 2 done and leaving stage 3 as the remaining one. Every figure names the command that produced it, and the entry is written at the branch's **last code commit** — not before it, or the anchor re-stales.
- [ ] Record in the entry: the measured states-per-original table with `k` per row, the cost table with `k` per row, whether the locality prediction held, the sabotage's result **including whether the oracle leg stayed green**, and the corrected `3k - 2` per-concrete-read figure against the spec's estimated `2k`.
- [ ] Correct the spec's `bitify` signature line to `Option<Vec<Vec<Symbol>>>`, and its "2k states per concrete read" to `3k - 2`, in a commit of their own so the change is reviewable against the reason for it.
