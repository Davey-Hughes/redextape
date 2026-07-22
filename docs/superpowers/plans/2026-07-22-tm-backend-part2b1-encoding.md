# TM Backend — Part 2b-1: Machine Builder + Unary Encoding Gadgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the substrate that turns register-assembly into a genuine Turing machine — a composable
`Machine` **builder** and the **unary δ-gadget library** (the `Encoding` seam): arithmetic
(`add`/`sub`/`mul`), the six comparisons, `write_literal`, and `decode_nat`. Each gadget is verified
**by simulation** on the Part-2a simulator, so Part 2b-2's `lower_tm` composes only tested pieces.

**Architecture:** Two new modules in `tm`. `tm/build.rs` provides `Builder` (fresh states + a rule
helper that defaults untouched tapes to wildcard/unchanged/stay) over the fixed **4-tape** layout
(`reg`/`work`/`stack`/`heap`). `tm/encoding.rs` provides the `Encoding` trait and its `Unary`
implementation: a gadget populates builder states from an `entry` to an `exit`, operating on the `reg`
bank (unary fields, `#`-separated, addressed by compile-time slot index) using `work` as scratch.
Gadgets decompose into small reusable **sub-primitives** (seek / clear / copy / append / erase) so the
δ-state code stays tractable and each layer is independently simulate-testable.

**Tech Stack:** Rust (edition 2024), zero runtime deps. Builds on the merged Part-2a `tm::machine` +
`tm::sim` (the `Machine` model + simulator) and `core::BinOp`. No `asm`/`lower_asm` dependency (2b-2
wires them). No `stack`/`heap` gadgets here (2b-2) — this plan is arithmetic on the `reg`/`work` tapes.

**Design source:** [`docs/superpowers/specs/2026-07-22-tm-backend-design.md`](../specs/2026-07-22-tm-backend-design.md)
(§5 encoding seam, §4 machine model). Machine design confirmed with the owner this session.

## Global Constraints

- **Rust edition 2024**; `rustfmt.toml`: `max_width = 120`, `use_small_heuristics = "Max"`.
- Must pass, at all times: `cargo fmt --all --check`;
  `cargo clippy --workspace --all-targets -- -D warnings`;
  `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`.
- **No panics on any input.** Gadget builders are pure `Machine` construction (only genuine internal
  invariants may `panic!`). The produced machines are simulated by the Part-2a simulator, which is
  already bounded + defensive.
- **Every produced `Machine` passes `Machine::validate()`** — deterministic, total-where-needed, and in
  the **representable subset**: data symbols are only `1` (`MARK`), `_` (`BLANK`), `#` (`SEP`) here;
  state names are identifiers (letters/digits/`.`/`_`). This is what lets Part 2b-2's machines round-trip
  through the TM text form. (`@` is reserved for 2b-2's stack/heap; unused here.)
- **Unary encoding** (the locked decision): a `Nat` value `v` is `v` copies of `MARK`. `Bool` is `0`/`1`
  marks. Arithmetic matches the reference exactly: `Sub` = **monus** (truncated), `Mul` saturating is
  irrelevant at gadget scale (values are small); comparisons yield a `0`- or `1`-mark result.

## Scope (Part 2b-1 of the two Part-2b plans)

**In scope:** `tm/build.rs` (the builder) and `tm/encoding.rs` (the `Encoding` trait + `Unary` gadgets +
`decode_nat`), tested by simulation. **Out of scope (Part 2b-2):** `lower_tm.rs` (asm `Program` →
`Machine`, incl. control flow, `call`/`ret` via the `stack` tape + return-tag, and `cons`/`head`/`tail`
via the `heap` tape), `decode.rs` (full tapes → `Value`), and the **three-way oracle**. This plan
delivers the tested gadget library those consume.

## Machine design (the substrate this plan builds against)

**Four tapes**, fixed indices: `REG=0`, `WORK=1`, `STACK=2`, `HEAP=3` (stack/heap unused here but the
arity is fixed so gadgets compose with 2b-2). **Symbols:** `MARK='1'`, `BLANK='_'`, `SEP='#'`.

**`reg` tape bank (FIXED-WIDTH fields — mutation never shifts the tape):** `# f0 # f1 # … # fK #`,
where each field `fi` is exactly `FIELD_WIDTH` cells — a value `v` is `v` `MARK`s left-justified then
`FIELD_WIDTH - v` `BLANK`s. Writing a value blanks the field's window and writes the marks in place (no
insert/shift). A leading `SEP` sits at position 0. **Home convention:** between gadgets the `REG` head
rests on the **leading `SEP` (position 0)** and the `WORK` head at its **blank left end**; every
sub-primitive assumes this on entry and restores it on exit, so they compose. A **slot** is a
compile-time field index `0..=K`.

**Seek:** "seek `REG` to slot `i`" walks right from home, scanning each field's cells (marks AND blank
padding) to the next `SEP`, `i+1` times, landing on field `i`'s first cell. **Read/decode a field:**
count the leading `MARK`s until the first non-`MARK` (blank or `SEP`), then the blank padding, then a
closing `SEP` (a well-formed field).

## File structure

```
crates/redextape-core/src/
  tm.rs                # add `pub mod build; pub mod encoding;` + re-exports
  tm/
    build.rs           # Builder, RuleSpec, tape/symbol consts, Slot                    (Task 1)
    encoding.rs        # Encoding trait + Unary; sub-primitives; write_literal/decode_nat (Task 2);
                       #   add/sub (Task 3); mul (Task 4); the six comparisons (Task 5)
  tests/
    tm_encoding.rs     # end-to-end gadget simulation harness + integration             (Task 6)
```

## How to implement + test a gadget (read before Task 2)

A gadget is `fn(&mut Builder, entry: StateId, exit: StateId, …slots)` — it fills `entry` (and fresh
states) so that running from `entry`, with the home convention holding, performs the op and transitions
to `exit` with home restored. **The simulation test is the contract:** build a `Machine` that writes
literal operands into slots, runs the gadget, then halts; simulate it; `decode_nat` the result slot from
the final `reg` tape; assert the value. The δ-states are DERIVED to pass the test — treat the test +
the stated algorithm as the source of truth and iterate the states (genuine TDD on a state machine).
The reference δ-code in each task is a correct-as-written starting point, but if a simulation test
fails, fix the states, not the test.

---

### Task 1: the machine `Builder`

**Files:**
- Create: `crates/redextape-core/src/tm/build.rs`
- Modify: `crates/redextape-core/src/tm.rs` (add `pub mod build;`)

**Interfaces:**
- Consumes: `machine::{Machine, Move, Rule, State, StateId, Symbol}`.
- Produces: tape consts `TAPES/REG/WORK/STACK/HEAP`, symbol consts `MARK/SEP` (`BLANK` re-used from
  `machine`), `Slot = u32`, `RuleSpec` (a per-tape partial rule defaulting untouched tapes to
  wildcard-read / unchanged-write / `Stay`), and `Builder` (`state`/`accept`/`add_rule`/`finish`).

- [ ] **Step 1: Write the tests**

Create `crates/redextape-core/src/tm/build.rs` with tests first:

```rust
//! A composable builder for `Machine`s. `Builder` hands out fresh `StateId`s and appends rules via
//! `RuleSpec`, which defaults every untouched tape to (wildcard read, unchanged write, `Stay`) — so a
//! gadget names only the tapes it touches and stays agnostic to the fixed tape count. Part 2b's
//! `encoding` (gadgets) and `lower_tm` (control flow) build every `Machine` through this.

use crate::tm::machine::{Machine, Move, Rule, State, StateId, Symbol, BLANK};

/// Fixed multi-tape layout (arity shared by every gadget so they compose).
pub const TAPES: usize = 4;
pub const REG: usize = 0;
pub const WORK: usize = 1;
pub const STACK: usize = 2;
pub const HEAP: usize = 3;

/// Tape data symbols. `BLANK` (`_`) comes from `machine`. `SEP` (`#`) delimits register fields.
pub const MARK: Symbol = '1';
pub const SEP: Symbol = '#';

/// Fixed width (cells) of every register field: a value `v` is `v` `MARK`s left-justified, then
/// `FIELD_WIDTH - v` `BLANK`s. Fixed width means a write mutates the field IN PLACE (blank the window,
/// write the marks) and never has to shift the rest of the tape. `v` must stay `<= FIELD_WIDTH`
/// (2b-2 sizes this per program / the value bound; 64 is ample for 2b-1's small test values).
pub const FIELD_WIDTH: usize = 64;

/// A register-bank field index.
pub type Slot = u32;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::sim::{simulate, Status, TM_DEFAULT_CAPS};

    #[test]
    fn rulespec_defaults_untouched_tapes() {
        // Touch only WORK: write a mark, move R. REG/STACK/HEAP default to wildcard/unchanged/stay.
        let r = RuleSpec::new().on(WORK, None, Some(MARK), Move::R).into_rule(7);
        assert_eq!(r.next, 7);
        assert_eq!(r.read, vec![None, None, None, None]);
        assert_eq!(r.write, vec![None, Some(MARK), None, None]);
        assert_eq!(r.moves, vec![Move::S, Move::R, Move::S, Move::S]);
    }

    #[test]
    fn builds_and_runs_a_two_state_machine() {
        // A machine that writes one MARK on WORK then halts (proves Builder + sim integrate).
        let mut b = Builder::new();
        let go = b.state("go");
        let halt = b.accept("halt");
        b.add_rule(go, RuleSpec::new().on(WORK, None, Some(MARK), Move::S), halt);
        let m = b.finish(go);
        assert!(m.validate().is_empty(), "{:?}", m.validate());
        let (tapes, status) = simulate(&m, &[], TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(tapes[WORK].snapshot().0, vec![MARK]);
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::build`
Expected: FAIL — `cannot find type 'RuleSpec' / 'Builder'`.

- [ ] **Step 3: Implement `RuleSpec` + `Builder`**

Add above the `#[cfg(test)]` module in `build.rs`:

```rust
/// A partial transition rule under construction: name only the tapes you touch; the rest default to
/// (wildcard read, unchanged write, `Stay`).
pub struct RuleSpec {
    read: [Option<Symbol>; TAPES],
    write: [Option<Symbol>; TAPES],
    moves: [Move; TAPES],
}

impl Default for RuleSpec {
    fn default() -> Self {
        RuleSpec { read: [None; TAPES], write: [None; TAPES], moves: [Move::S; TAPES] }
    }
}

impl RuleSpec {
    pub fn new() -> Self {
        Self::default()
    }

    /// On tape `t`: require reading `r` (`None` = any), write `w` (`None` = unchanged), move `m`.
    pub fn on(mut self, t: usize, r: Option<Symbol>, w: Option<Symbol>, m: Move) -> Self {
        self.read[t] = r;
        self.write[t] = w;
        self.moves[t] = m;
        self
    }

    /// Finalize into a `Rule` targeting `next`.
    pub fn into_rule(self, next: StateId) -> Rule {
        Rule { read: self.read.to_vec(), write: self.write.to_vec(), moves: self.moves.to_vec(), next }
    }
}

/// Incrementally builds a `Machine`'s states.
#[derive(Default)]
pub struct Builder {
    states: Vec<State>,
}

impl Builder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Allocate a fresh non-accept state; returns its id. Names should be identifiers (no reserved
    /// text-form chars) so the produced machine stays round-trippable.
    pub fn state(&mut self, name: impl Into<String>) -> StateId {
        let id = self.states.len() as StateId;
        self.states.push(State { name: name.into(), accept: false, rules: Vec::new() });
        id
    }

    /// Allocate a fresh accept (halt) state.
    pub fn accept(&mut self, name: impl Into<String>) -> StateId {
        let id = self.states.len() as StateId;
        self.states.push(State { name: name.into(), accept: true, rules: Vec::new() });
        id
    }

    /// Append a rule (built via `RuleSpec`) to state `s`, targeting `next`.
    pub fn add_rule(&mut self, s: StateId, spec: RuleSpec, next: StateId) {
        self.states[s as usize].rules.push(spec.into_rule(next));
    }

    /// Finalize into a 4-tape `Machine` starting at `start`.
    pub fn finish(self, start: StateId) -> Machine {
        Machine { states: self.states, start, tapes: TAPES }
    }
}
```

Add to `crates/redextape-core/src/tm.rs`: `pub mod build;`

> **Implementer note:** `[None; TAPES]` needs `Option<Symbol>: Copy` (it is — `Option<char>`), and
> `[Move::S; TAPES]` needs `Move: Copy` (it derives `Copy`). If clippy flags `new` as identical to
> `Default::default`, keep both (`new` is the ergonomic constructor gadgets call).

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::build`
Expected: PASS — both tests (the second proves Builder output runs on the 2a simulator).

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/build.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): add the composable multi-tape machine builder"
```

---

### Task 2: `Encoding` trait + sub-primitives + `write_literal` / `decode_nat`

**Files:**
- Create: `crates/redextape-core/src/tm/encoding.rs`
- Modify: `crates/redextape-core/src/tm.rs` (add `pub mod encoding;`)

**Interfaces:**
- Consumes: `build::*`, `machine::{Move, StateId, Symbol}`, `sim` (tests).
- Produces:
  - `trait Encoding` with (for this plan) `write_literal`, `arith` (added in Tasks 3–4), `compare`
    (Task 5), and `decode_nat`, each taking `&mut Builder`, an `entry`, an `exit`, and slot operands.
  - `struct Unary` implementing it.
  - The shared sub-primitives (`seek_slot`, `clear_field`, `copy_field_to_work`, `append_work_to_field`,
    `clear_work`) as free functions building state-chains under the home convention.
  - `write_literal(b, entry, exit, n, rd)` and `decode_nat(reg_cells, slot) -> Option<u64>`.

The home convention (see the design section) holds on entry/exit of every sub-primitive.

- [ ] **Step 1: Write the tests (by simulation)**

Create `crates/redextape-core/src/tm/encoding.rs` with tests first:

```rust
//! The `Encoding` seam: unary δ-gadgets over the `reg`/`work` tapes. A `Nat v` is `v` `MARK`s in a
//! `#`-delimited register field. Gadgets decompose into sub-primitives (seek/clear/copy/append) that
//! each preserve the home convention (REG head on the leading `#`, WORK head at its blank left end),
//! so they compose freely. Behavior is verified by SIMULATION (build a tiny machine → run → decode).

use crate::core::BinOp;
use crate::tm::build::{Builder, RuleSpec, Slot, MARK, REG, SEP, WORK};
use crate::tm::machine::{Move, StateId, Symbol, BLANK};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::build::{FIELD_WIDTH, TAPES};
    use crate::tm::sim::{simulate, Status, TM_DEFAULT_CAPS};

    /// Build a machine over a `slots`-field register bank: `write_literal` each `(slot, value)`, run
    /// `body(entry, exit)` to wire the gadget under test, and halt. Returns the decoded `result` slot.
    fn run_gadget(slots: u32, inits: &[(Slot, u64)], result: Slot, body: impl FnOnce(&mut Builder, StateId, StateId)) -> Option<u64> {
        let enc = Unary;
        let mut b = Builder::new();
        // Chain: setup literals -> body -> halt. Build back-to-front so each `exit` is known.
        let halt = b.accept("halt");
        let gadget_entry = b.state("gadget");
        // The body wires `gadget_entry .. halt`.
        body(&mut b, gadget_entry, halt);
        // Prepend literal-writers, each flowing into the next, ending at `gadget_entry`.
        let mut entry = gadget_entry;
        for &(slot, val) in inits.iter().rev() {
            let w = b.state(format!("lit{slot}"));
            enc.write_literal(&mut b, w, entry, val, slot);
            entry = w;
        }
        // The reg tape starts as an all-zero FIXED-WIDTH bank: `#` then (FIELD_WIDTH blanks + `#`)*slots.
        let mut init_reg: Vec<Symbol> = vec![SEP];
        for _ in 0..slots {
            init_reg.extend(std::iter::repeat_n(BLANK, FIELD_WIDTH));
            init_reg.push(SEP);
        }
        let m = b.finish(entry);
        assert!(m.validate().is_empty(), "invalid machine: {:?}", m.validate());
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = init_reg;
        let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
        assert_eq!(status, Status::Halted, "gadget did not halt");
        enc.decode_nat(&tapes[REG].snapshot().0, result)
    }

    #[test]
    fn write_literal_then_decode() {
        // The body under test writes the literal (no setup inits); decode reads it back.
        assert_eq!(run_gadget(1, &[], 0, |b, e, x| Unary.write_literal(b, e, x, 5, 0)), Some(5));
        assert_eq!(run_gadget(2, &[], 1, |b, e, x| Unary.write_literal(b, e, x, 3, 1)), Some(3));
        assert_eq!(run_gadget(2, &[], 0, |b, e, x| Unary.write_literal(b, e, x, 0, 0)), Some(0));
    }

    #[test]
    fn decode_nat_reads_a_field() {
        // reg = `# 1 1 1 # 1 #` -> slot0=3, slot1=1.
        // Non-padded and padded fields both decode via the trait method.
        let cells = vec![SEP, MARK, MARK, MARK, SEP, MARK, SEP];
        assert_eq!(Unary.decode_nat(&cells, 0), Some(3));
        assert_eq!(Unary.decode_nat(&cells, 1), Some(1));
        assert_eq!(Unary.decode_nat(&cells, 2), None); // no field after the trailing `#`
        // A fixed-width field `# 1 1 _ _ #` (value 2, padded) decodes to 2.
        let padded = vec![SEP, MARK, MARK, BLANK, BLANK, SEP];
        assert_eq!(Unary.decode_nat(&padded, 0), Some(2));
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::encoding`
Expected: FAIL — `cannot find … Unary / write_literal / decode_nat`.

- [ ] **Step 3: Implement the trait, sub-primitives, `write_literal`, `decode_nat`**

Add above the `#[cfg(test)]` module in `encoding.rs`. **Algorithm notes are the contract; the δ-code
is the reference implementation — iterate it against the simulation tests until green.**

```rust
/// The pluggable numeric encoding (the swappable seam). `Unary` is the v1 implementation; a `Binary`
/// impl is the committed follow-on. Gadgets build states into `b`, flowing `entry -> exit`, under the
/// home convention (REG head on the leading `#`; WORK head blank at its left end) on entry and exit.
pub trait Encoding {
    /// `slot rd <- n` (clear the field, write `n` marks).
    fn write_literal(&self, b: &mut Builder, entry: StateId, exit: StateId, n: u64, rd: Slot);
    /// `slot rd <- (ra `op` rb)` for an arithmetic `BinOp` (Add/Sub/Mul); comparisons go to `compare`.
    fn arith(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot);
    /// `slot rd <- (ra `op` rb) as 0/1` for a comparison `BinOp` (Eq/Ne/Lt/Le/Gt/Ge).
    fn compare(&self, b: &mut Builder, entry: StateId, exit: StateId, op: BinOp, ra: Slot, rb: Slot, rd: Slot);
    /// Decode field `slot` of a materialized `reg` tape to its unary value (`None` if the field is absent).
    fn decode_nat(&self, reg_cells: &[Symbol], slot: Slot) -> Option<u64>;
}

pub struct Unary;

// ---- shared sub-primitives (free functions; each preserves the home convention) ----

/// Seek the REG head from home to field `slot`'s first cell. Constant-size chain: step off the leading
/// `#`, then for each further slot scan its field to the next `#` and step off. Ends AT `slot`'s first
/// cell (or on the following `#` if the field is empty), NOT at home — internal to a gadget, which must
/// return home before `exit`.
fn seek_slot(b: &mut Builder, from: StateId, slot: Slot) -> StateId {
    // `from` reads the leading `#` and steps right onto field 0.
    let mut cur = b.state(format!("seek{slot}.0"));
    b.add_rule(from, RuleSpec::new().on(REG, Some(SEP), None, Move::R), cur);
    for k in 1..=slot {
        let next = b.state(format!("seek{slot}.{k}"));
        // scan field k-1's cells (marks AND blank padding) to its trailing `#`, then step onto field k.
        b.add_rule(cur, RuleSpec::new().on(REG, Some(MARK), None, Move::R), cur);
        b.add_rule(cur, RuleSpec::new().on(REG, Some(BLANK), None, Move::R), cur);
        b.add_rule(cur, RuleSpec::new().on(REG, Some(SEP), None, Move::R), next);
        cur = next;
    }
    cur // control state sitting on `slot`'s first cell
}

/// From a state sitting at a field's first cell, move the REG head back to home (the leading `#`):
/// scan left over marks and `#`s until the leftmost `#` (position 0). Returns the state now at home.
fn rewind_home(b: &mut Builder, from: StateId, label: &str) -> StateId {
    let scan = b.state(format!("{label}.rewind"));
    let home = b.state(format!("{label}.home"));
    b.add_rule(from, RuleSpec::new(), scan); // enter the scan
    // On WORK-blank/REG-any: move left while not at position 0. Position 0 is the only `#` with a
    // BLANK to its left — detect the left end by a left-move that reads BLANK on REG, then step back.
    // (Reference approach; refine against the test.)
    b.add_rule(scan, RuleSpec::new().on(REG, Some(MARK), None, Move::L), scan);
    b.add_rule(scan, RuleSpec::new().on(REG, Some(SEP), None, Move::L), scan);
    b.add_rule(scan, RuleSpec::new().on(REG, Some(BLANK), None, Move::R), home); // stepped off the left end -> back onto leading `#`
    home
}
```

> **Sub-primitive completeness note.** `seek_slot` + `rewind_home` above are the reference for the
> *pattern*. `clear_field`, `copy_field_to_work`, `append_work_to_field`, and `clear_work` follow the
> same shape and are implemented in this task guided by their one-line algorithms:
> - `clear_work` — WORK head at left end: while reading `MARK`, write `BLANK`, move R; on `BLANK`,
>   rewind WORK left to home. (Ensures scratch starts empty.)
> - `copy_field_to_work` — with REG at field `s` (via `seek_slot`) and WORK at home: while REG reads
>   `MARK`, write `MARK` on WORK and move both R; on the first non-`MARK` (blank padding or `SEP`), stop;
>   then `rewind_home` REG and rewind WORK to home. Result: WORK holds a copy of field `s`'s marks.
> - `append_work_to_field` — clear field `rd` then, scanning WORK left-to-right, write one `MARK` per
>   WORK mark into field `rd` (REG at `rd`), then rewind both home. (Fields are fixed-width by `#`
>   delimiters, so "write into a field" shifts nothing — a value never exceeds its allocated marks at
>   demo scale; if a field must grow, that is a 2b-2 lowering concern, noted there.)
> Write each with its own simulation test in this task (e.g. copy slot0→work→slot1, decode slot1).
> Keep every one home-restoring so higher gadgets compose them blindly.

Then `write_literal` and `decode_nat`:

```rust
impl Encoding for Unary {
    fn write_literal(&self, b: &mut Builder, entry: StateId, exit: StateId, n: u64, rd: Slot) {
        // Algorithm (fixed-width, no shift): seek rd's field; BLANK the whole window (write BLANK moving
        // R until the trailing `#`); return left to the field's first cell (move L over the blanks to
        // the leading `#`, then R); write `n` MARKs moving R; rewind REG home. Reference δ-states below
        // — iterate against `write_literal_then_decode`.
        let at = seek_slot(b, entry, rd);
        let blanking = b.state(format!("wl{rd}.blank"));
        b.add_rule(at, RuleSpec::new(), blanking);
        b.add_rule(blanking, RuleSpec::new().on(REG, Some(MARK), Some(BLANK), Move::R), blanking);
        b.add_rule(blanking, RuleSpec::new().on(REG, Some(BLANK), Some(BLANK), Move::R), blanking);
        let back = b.state(format!("wl{rd}.back"));
        b.add_rule(blanking, RuleSpec::new().on(REG, Some(SEP), None, Move::L), back); // on trailing `#`
        b.add_rule(back, RuleSpec::new().on(REG, Some(BLANK), None, Move::L), back);
        let start = b.state(format!("wl{rd}.start"));
        b.add_rule(back, RuleSpec::new().on(REG, Some(SEP), None, Move::R), start); // leading `#` -> first cell
        let mut cur = start;
        for i in 0..n {
            let nxt = b.state(format!("wl{rd}.m{i}"));
            b.add_rule(cur, RuleSpec::new().on(REG, None, Some(MARK), Move::R), nxt);
            cur = nxt;
        }
        let home = rewind_home(b, cur, &format!("wl{rd}"));
        b.add_rule(home, RuleSpec::new(), exit);
    }

    fn decode_nat(&self, reg_cells: &[Symbol], slot: Slot) -> Option<u64> {
        // Fixed-width bank `# f0 # f1 # … #`; field `slot` follows the `slot`-th `#` (leading `#` = #0)
        // as leading `MARK`s then `BLANK` padding then a closing `#`. Find the sep, count marks, and
        // require the field be well-formed (marks, then blanks, then a `#`) — so a `slot` past the last
        // field (only the trailing `#`, no closing `#` after it) is `None`.
        let mut seps = 0u32;
        for (i, &c) in reg_cells.iter().enumerate() {
            if c == SEP {
                if seps == slot {
                    let rest = &reg_cells[i + 1..];
                    let marks = rest.iter().take_while(|&&x| x == MARK).count();
                    let pad = rest[marks..].iter().take_while(|&&x| x == BLANK).count();
                    return (rest.get(marks + pad) == Some(&SEP)).then_some(marks as u64);
                }
                seps += 1;
            }
        }
        None
    }

    // `arith` (Tasks 3–4) and `compare` (Task 5) added below.
    fn arith(&self, _b: &mut Builder, _entry: StateId, _exit: StateId, _op: BinOp, _ra: Slot, _rb: Slot, _rd: Slot) {
        unimplemented!("Task 3–4")
    }
    fn compare(&self, _b: &mut Builder, _entry: StateId, _exit: StateId, _op: BinOp, _ra: Slot, _rb: Slot, _rd: Slot) {
        unimplemented!("Task 5")
    }
}
```

> **On the `unimplemented!` stubs:** they satisfy the trait so this task compiles and its tests run,
> but they are only reachable from Tasks 3–5's own tests (never from this task's tests). Clippy's
> `-D warnings` does not flag `unimplemented!`. Tasks 3–5 replace each stub with the real gadget; do
> NOT leave a stub once its task lands.

- [ ] **Step 4: Wire the module + run the tests**

Add to `crates/redextape-core/src/tm.rs`: `pub mod encoding;`

Run: `cargo test -p redextape-core tm::encoding`
Expected: PASS — `write_literal`/`decode_nat` round-trip and the sub-primitive tests you added. Iterate
the `seek`/`rewind`/`write_literal` δ-states against the failing simulations until green.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/encoding.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): add the Encoding seam, sub-primitives, write_literal, decode_nat"
```

---

### Task 3: `add` and `sub` (monus) gadgets

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs`

**Interfaces:**
- Produces: the `BinOp::Add` and `BinOp::Sub` arms of `Unary::arith`, built from the Task-2
  sub-primitives.

**Algorithms** (the contract — derive the δ-states to satisfy the tests):
- **add(ra, rb, rd):** `clear_work`; `copy_field_to_work(ra)` (appends ra's marks to work);
  `copy_field_to_work(rb)` (appends rb's marks after them); `append_work_to_field(rd)` (rd ← work).
  Result rd = ra + rb.
- **monus(ra, rb, rd):** `clear_work`; `copy_field_to_work(ra)`; then **erase one work mark per rb
  mark** (seek ra... no — iterate rb: for each mark in rb, erase the rightmost work mark if any);
  `append_work_to_field(rd)`. Result rd = max(0, ra − rb). The "erase one per rb mark" loop reads rb's
  field mark-by-mark (REG at rb) and, for each, runs an `erase-one-work-mark` step (WORK to rightmost
  mark, blank it); stop when rb is exhausted (works even if work empties first).

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `encoding.rs`:

```rust
    fn arith(op: BinOp, a: u64, b: u64) -> Option<u64> {
        // 3-field bank: slot0=a, slot1=b, slot2=result.
        run_gadget(3, &[(0, a), (1, b)], 2, move |bd, e, x| Unary.arith(bd, e, x, op, 0, 1, 2))
    }

    #[test]
    fn add_gadget() {
        assert_eq!(arith(BinOp::Add, 3, 2), Some(5));
        assert_eq!(arith(BinOp::Add, 0, 4), Some(4));
        assert_eq!(arith(BinOp::Add, 0, 0), Some(0));
    }

    #[test]
    fn monus_gadget_is_truncated() {
        assert_eq!(arith(BinOp::Sub, 5, 3), Some(2));
        assert_eq!(arith(BinOp::Sub, 3, 5), Some(0)); // monus
        assert_eq!(arith(BinOp::Sub, 4, 0), Some(4));
    }
```

- [ ] **Step 2: Run to verify they fail** (`unimplemented!` panics / wrong result)

Run: `cargo test -p redextape-core tm::encoding::tests::add_gadget`
Expected: FAIL (panic from the `arith` stub).

- [ ] **Step 3: Implement the Add/Sub arms of `arith`** (replace the stub's body with a `match op`,
  building the two gadgets from the sub-primitives per the algorithms above; leave Mul → `unimplemented!`
  until Task 4). Add an `erase_one_work_mark` sub-primitive if not already present.

- [ ] **Step 4: Run to verify they pass** (iterate the δ-states against the sims)

Run: `cargo test -p redextape-core tm::encoding`
Expected: PASS — add + monus. Then `clippy`/`fmt` clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): add unary add and monus gadgets"
```

---

### Task 4: `mul` gadget

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs`

**Interfaces:** the `BinOp::Mul` arm of `Unary::arith`.

**Algorithm:** `mul(ra, rb, rd)` = repeated addition. `clear_work`; then **for each mark in rb**, append
a copy of ra's marks into work (`copy_field_to_work(ra)` accumulates, since it appends); finally
`append_work_to_field(rd)`. Result rd = ra × rb. The outer loop iterates over rb's marks (REG at rb,
one iteration per mark); `copy_field_to_work(ra)` must re-seek ra each iteration and append. Preserve
rb across the loop (it is only read).

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module:

```rust
    #[test]
    fn mul_gadget() {
        assert_eq!(arith(BinOp::Mul, 3, 2), Some(6));
        assert_eq!(arith(BinOp::Mul, 0, 5), Some(0));
        assert_eq!(arith(BinOp::Mul, 4, 1), Some(4));
        assert_eq!(arith(BinOp::Mul, 1, 4), Some(4));
    }
```

- [ ] **Step 2: Run to verify it fails.** Run: `cargo test -p redextape-core tm::encoding::tests::mul_gadget` — FAIL (Mul stub).

- [ ] **Step 3: Implement the Mul arm** (replace the `unimplemented!` for Mul with the repeated-add
  loop). Iterate the δ-states against the sim.

- [ ] **Step 4: Run to verify it passes;** `clippy`/`fmt` clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): add the unary mul (repeated-add) gadget"
```

---

### Task 5: the six comparison gadgets

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs`

**Interfaces:** `Unary::compare` for `Eq/Ne/Lt/Le/Gt/Ge`, writing `0` or `1` mark to `rd`.

**Algorithm (zig-zag match):** copy ra→work and rb→a second scratch region (or compare in place by
walking both fields). The clean unary comparison: repeatedly erase one mark from a copy of ra and one
from a copy of rb until one (or both) is empty; then:
- both empty → `ra == rb`;
- ra empty first → `ra < rb`;
- rb empty first → `ra > rb`.
Derive each operator from that trichotomy: `Eq`=both-empty; `Ne`=not; `Lt`=ra-empty-first; `Le`=ra
empties no later than rb; `Gt`=rb-empty-first; `Ge`=rb empties no later than ra. Write `1` (one MARK)
to `rd` if the relation holds, else `0` (clear rd). Implement `le(ra,rb)` as the primitive
(is-ra≤rb) and derive the rest (`ge = le(rb,ra)`, `lt = !ge`, `gt = !le`, `eq = le(a,b)&&le(b,a)`,
`ne = !eq`) — matching the λ backend's comparison derivations for consistency.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module:

```rust
    fn cmp(op: BinOp, a: u64, b: u64) -> Option<u64> {
        run_gadget(3, &[(0, a), (1, b)], 2, move |bd, e, x| Unary.compare(bd, e, x, op, 0, 1, 2))
    }

    #[test]
    fn comparison_gadgets() {
        assert_eq!(cmp(BinOp::Eq, 2, 2), Some(1));
        assert_eq!(cmp(BinOp::Eq, 2, 3), Some(0));
        assert_eq!(cmp(BinOp::Ne, 2, 3), Some(1));
        assert_eq!(cmp(BinOp::Lt, 1, 2), Some(1));
        assert_eq!(cmp(BinOp::Lt, 2, 2), Some(0));
        assert_eq!(cmp(BinOp::Le, 2, 2), Some(1));
        assert_eq!(cmp(BinOp::Gt, 3, 1), Some(1));
        assert_eq!(cmp(BinOp::Gt, 1, 3), Some(0));
        assert_eq!(cmp(BinOp::Ge, 3, 3), Some(1));
        assert_eq!(cmp(BinOp::Ge, 1, 3), Some(0));
    }
```

- [ ] **Step 2: Run to verify they fail** (`compare` stub).

- [ ] **Step 3: Implement `compare`** (the `le` primitive + the six derivations, building `0`/`1` into
  `rd`). Iterate the δ-states against the sim.

- [ ] **Step 4: Run to verify they pass;** `clippy`/`fmt` clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): add the six unary comparison gadgets"
```

---

### Task 6: re-exports + the gadget integration test

**Files:**
- Modify: `crates/redextape-core/src/tm.rs` (re-exports)
- Create: `crates/redextape-core/tests/tm_encoding.rs`

**Interfaces:** `tm` re-exports (`Encoding`, `Unary`, `Builder`, the tape/symbol consts, `Slot`) and an
integration test that composes several gadgets end-to-end through the public surface.

- [ ] **Step 1: Add re-exports to `tm.rs`**

```rust
pub use build::{Builder, RuleSpec, Slot, FIELD_WIDTH, HEAP, MARK, REG, SEP, STACK, TAPES, WORK};
pub use encoding::{Encoding, Unary};
```

Run: `cargo build -p redextape-core` — clean.

- [ ] **Step 2: Write the integration test**

Create `crates/redextape-core/tests/tm_encoding.rs`: build a machine that computes, e.g.,
`(3 + 2) * 2` by composing `write_literal` + `arith(Add)` + `arith(Mul)` through the public `Encoding`
trait, simulate it, and assert the decoded result is `10` — plus a comparison producing a `Bool`. This
proves the gadgets compose into a multi-step computation on a genuine simulated TM (the shape Part 2b-2's
`lower_tm` produces). Use the same `run_gadget`-style harness (copy it into the test, or expose a
minimal public helper).

```rust
//! Part 2b-1 substrate: the unary gadgets compose into a multi-step computation on a genuine simulated
//! multi-tape TM. Part 2b-2's `lower_tm` produces machines of exactly this shape from register-assembly.

use redextape_core::core::BinOp;
use redextape_core::tm::machine::{Symbol, BLANK};
use redextape_core::tm::{
    simulate, Builder, Encoding, Unary, FIELD_WIDTH, REG, SEP, TAPES, TM_DEFAULT_CAPS, TmStatus,
};

#[test]
fn gadgets_compose_into_a_multi_step_computation() {
    // (3 + 2) * 2 == 10, in a 4-field bank: s0=3, s1=2, s2=(s0+s1), s3=(s2*s1).
    let enc = Unary;
    let mut b = Builder::new();
    let halt = b.accept("halt");
    // build back-to-front: mul(s2,s1)->s3 ; add(s0,s1)->s2 ; lit s1=2 ; lit s0=3
    let mul = b.state("mul");
    enc.arith(&mut b, mul, halt, BinOp::Mul, 2, 1, 3);
    let add = b.state("add");
    enc.arith(&mut b, add, mul, BinOp::Add, 0, 1, 2);
    let l1 = b.state("l1");
    enc.write_literal(&mut b, l1, add, 2, 1);
    let l0 = b.state("l0");
    enc.write_literal(&mut b, l0, l1, 3, 0);
    let m = b.finish(l0);
    assert!(m.validate().is_empty(), "{:?}", m.validate());

    let mut init = vec![Vec::<Symbol>::new(); TAPES];
    let mut bank = vec![SEP]; // an all-zero fixed-width bank of 4 fields
    for _ in 0..4 {
        bank.extend(std::iter::repeat_n(BLANK, FIELD_WIDTH));
        bank.push(SEP);
    }
    init[REG] = bank;
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    assert_eq!(enc.decode_nat(&tapes[REG].snapshot().0, 3), Some(10));
}
```

- [ ] **Step 3: Run the suite + coverage**

Run: `cargo test -p redextape-core` — all `tm::build` / `tm::encoding` unit tests + the integration
test + the existing Part-1/2a suites pass.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check` — clean.

Run: `cargo llvm-cov --workspace --all-targets --fail-under-lines 80` — ≥ 80%. Add focused gadget
sims for any uncovered arm; do not lower the threshold.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm.rs crates/redextape-core/tests/tm_encoding.rs
git commit -m "test(tm): wire encoding re-exports + a composed-gadget simulation test"
```

---

## Self-review (completed while writing — notes for the executor)

- **Spec coverage (§5):** the `Encoding` seam trait + `Unary` impl (Tasks 2–5), the builder substrate
  (Task 1), `write_literal`/`decode_nat` (Task 2), `add`/`monus`/`mul` + six comparisons (Tasks 3–5),
  composed-gadget integration (Task 6). Deferred by design: `lower_tm`, `decode_tape`, the three-way
  oracle, and the `stack`/`heap` gadgets — all Part 2b-2. A `Binary` encoding is the later committed seam.
- **The δ-code is TDD, not blind-final:** the reference gadget states are a starting point; the
  simulation tests are the contract, and the "How to implement a gadget" section + the per-gadget
  algorithms are what the implementer builds to. This is called out explicitly rather than pretending
  the blind δ-states are correct as written — the honest shape for TM state-machine construction.
- **Type consistency:** `Builder`/`RuleSpec`/`Slot`/the tape+symbol consts (Task 1) are used verbatim by
  `encoding` (Tasks 2–6); the `Encoding` trait methods (`write_literal`/`arith`/`compare`/`decode_nat`)
  are defined once (Task 2, with Task 3–5 filling `arith`/`compare`) and consumed by the integration
  test. Every produced `Machine` must pass `validate()` (asserted in each harness).
- **No placeholders that ship:** the `arith`/`compare` `unimplemented!` stubs exist only so Task 2
  compiles; Tasks 3–5 replace them, and the plan says not to leave a stub once its task lands.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-tm-backend-part2b1-encoding.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks. Note:
   the gadget tasks (2–5) are genuine state-machine TDD — the implementer will iterate δ-states against
   the simulation tests; give those tasks a capable model and expect more iterations than a mechanical task.
2. **Inline Execution** — execute in this session with checkpoints.

Which approach?
