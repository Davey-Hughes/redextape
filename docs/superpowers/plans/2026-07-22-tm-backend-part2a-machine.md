# TM Backend — Part 2a: Machine Model + Simulator + TM Text Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Turing-machine substrate of the TM backend — a genuine multi-tape TM data model
(`Machine`), an iterative bounded **simulator**, and a human-readable, round-tripping **TM text form**
(`parse_tm`/`print_tm`) — so Part 2b's `encoding` + `lower_tm` can build and run real machines against a
tested substrate.

**Architecture:** New modules in the existing `tm` submodule of `redextape-core`. A `Machine` is a
finite `Vec` of named control `State`s, each with an ordered list of `Rule`s over `tapes`
two-way-infinite tapes; it is deterministic (**first matching rule wins**, with per-tape wildcards) and
halts in an `accept` state. The simulator is an iterative loop (bounded stack) over a zipper tape
representation, bounded by a step cap and a total-cells cap. The text form is a flat, line-oriented
language (no recursive nesting), so its parser is iterative and cannot overflow. Everything is flat
`Vec`-backed — **no hand-written `Drop` needed**.

**Tech Stack:** Rust (edition 2024), zero runtime deps. Builds on Plan 1's `Diagnostic`/`Span` and the
Part-1 `tm` submodule; needs nothing from `asm.rs`/`lower_asm.rs` (Part 2b wires them together).

**Design source:** [`docs/superpowers/specs/2026-07-22-tm-backend-design.md`](../specs/2026-07-22-tm-backend-design.md)
(§4 machine model, §7 simulator, §9 TM text form).

## Global Constraints

Every task's requirements implicitly include these (from the spec + repo config, exact values):

- **Rust edition 2024**; `rustfmt.toml`: `max_width = 120`, `use_small_heuristics = "Max"`.
- Must pass, at all times: `cargo fmt --all --check`;
  `cargo clippy --workspace --all-targets -- -D warnings`;
  `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`.
- **No panics on user input.** `parse_tm` returns spanned `Diagnostic`s, never panics. `simulate` is
  defensive on a malformed `Machine` (uses `.get()`, treats an out-of-range target / missing state /
  stuck state as a halt) — never a native index panic. Only genuine internal invariants may `panic!`.
- **No hangs / no aborts on any input.** The simulator is an **iterative** loop bounded by
  `Caps { steps, cells }`; the text-form parser is **iterative** (a flat grammar, no recursion → no
  stack overflow). `Machine`/`State`/`Rule`/`Tape` are flat `Vec`-backed — no recursive `Drop`.
- **Reserved symbols in the text form:** `_` is the blank symbol, `*` is the read-wildcard /
  write-unchanged marker. Data symbols (Part 2b's encoding) must avoid `_` and `*`.
- Deterministic + total: what Part 2b emits is deterministic (first-match) and total (halts in an
  `accept` state). This substrate must faithfully run any such machine.

## Scope (Part 2a of two Part-2 plans)

**In scope:** `machine.rs` (model + validation), `sim.rs` (simulator + trace), `syntax.rs`
(`parse_tm`/`print_tm` + round-trip). **Out of scope (Part 2b):** `encoding.rs` (the `Encoding` trait +
unary δ-gadgets), `lower_tm.rs` (asm→`Machine`), `decode.rs` (tapes→`Value`), and the three-way oracle.
Part 2a's deliverable is self-contained: construct/parse a machine, simulate it, round-trip its text.

## File structure

```
crates/redextape-core/src/
  tm.rs                # add `pub mod machine; pub mod sim; pub mod syntax;` + re-exports
  tm/
    machine.rs         # Machine, State, Rule, Move, Symbol, StateId, BLANK; validate/alphabet  (Task 1)
    sim.rs             # Tape (zipper), simulate/simulate_trace, Status/Step/Trace/Caps          (Task 2)
    syntax.rs          # print_tm (Task 3); parse_tm + round-trip (Task 4)
```

Task 5 wires the re-exports and adds the substrate integration test.

---

### Task 1: the `Machine` model

**Files:**
- Create: `crates/redextape-core/src/tm/machine.rs`
- Modify: `crates/redextape-core/src/tm.rs` (add `pub mod machine;`)

**Interfaces:**
- Consumes: nothing.
- Produces: `Symbol` (= `char`), `BLANK` (= `'_'`), `StateId` (= `u32`), `Move { L, R, S }`,
  `Rule { read: Vec<Option<Symbol>>, write: Vec<Option<Symbol>>, moves: Vec<Move>, next: StateId }`,
  `State { name: String, accept: bool, rules: Vec<Rule> }`,
  `Machine { states: Vec<State>, start: StateId, tapes: usize }`, plus `Machine::alphabet()` and
  `Machine::validate()`.

- [ ] **Step 1: Write the tests**

Create `crates/redextape-core/src/tm/machine.rs` with the tests first:

```rust
//! The multi-tape Turing machine model: a finite `Vec` of named control states, each with an ordered
//! list of transition rules over `tapes` two-way-infinite tapes. Deterministic (first matching rule
//! wins; `read[i] = None` is a per-tape wildcard) and flat (`Vec`-backed, no recursive tree — so no
//! hand-written `Drop`). Part 2b's `encoding`/`lower_tm` build `Machine`s; this module is data + checks.

/// A tape symbol. `BLANK` is the contents of an unwritten cell.
pub type Symbol = char;

/// The blank symbol. Also reserved (with `*`) by the text form.
pub const BLANK: Symbol = '_';

/// Index of a state in `Machine::states`.
pub type StateId = u32;

/// A head move.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Move {
    L,
    R,
    S,
}

/// One transition rule. `read`/`write`/`moves` are per-tape (length == `Machine::tapes`).
/// `read[i] == None` matches any symbol under tape `i`'s head; `write[i] == None` leaves it unchanged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rule {
    pub read: Vec<Option<Symbol>>,
    pub write: Vec<Option<Symbol>>,
    pub moves: Vec<Move>,
    pub next: StateId,
}

/// A control state: a legible name (also its identity in the text form), an accept flag (accept =
/// halt), and rules matched in order (first match wins).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State {
    pub name: String,
    pub accept: bool,
    pub rules: Vec<Rule>,
}

/// A multi-tape Turing machine. `states` is indexed by `StateId`; `start` is the initial state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Machine {
    pub states: Vec<State>,
    pub start: StateId,
    pub tapes: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1-tape "increment unary" machine: scan right over `1`s, write a `1` in the first blank, halt.
    fn increment() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "scan".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn valid_machine_has_no_validation_errors() {
        assert!(increment().validate().is_empty());
    }

    #[test]
    fn alphabet_is_the_symbols_used_in_rules() {
        assert_eq!(increment().alphabet(), vec!['1']);
    }

    #[test]
    fn validate_flags_out_of_range_targets_and_bad_arity() {
        let mut m = increment();
        m.states[0].rules[0].next = 99; // out of range
        m.states[0].rules[1].read = vec![]; // arity 0 != 1 tape
        m.start = 42; // out of range
        let errs = m.validate();
        assert!(errs.iter().any(|e| e.contains("start")));
        assert!(errs.iter().any(|e| e.contains("next")));
        assert!(errs.iter().any(|e| e.contains("arity")));
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::machine`
Expected: FAIL — `no method named 'validate'` / `alphabet`.

- [ ] **Step 3: Implement `alphabet` + `validate`**

Add above the `#[cfg(test)]` module in `machine.rs`:

```rust
use std::collections::BTreeSet;

impl Machine {
    /// The sorted set of concrete symbols appearing in any rule (wildcards excluded). Derived — the
    /// text form and Plan 4's view model present it; it is not stored.
    pub fn alphabet(&self) -> Vec<Symbol> {
        let mut set: BTreeSet<Symbol> = BTreeSet::new();
        for s in &self.states {
            for r in &s.rules {
                for sym in r.read.iter().chain(r.write.iter()).flatten() {
                    set.insert(*sym);
                }
            }
        }
        set.into_iter().collect()
    }

    /// Structural invariants: `start` in range; every rule's `read`/`write`/`moves` have length
    /// `tapes`; every `next` in range. Returns the problems (empty == valid). Never panics.
    pub fn validate(&self) -> Vec<String> {
        let mut errs = Vec::new();
        let n = self.states.len() as u32;
        if self.start >= n {
            errs.push(format!("start state {} out of range (states: {n})", self.start));
        }
        for (i, s) in self.states.iter().enumerate() {
            for (j, r) in s.rules.iter().enumerate() {
                if r.read.len() != self.tapes || r.write.len() != self.tapes || r.moves.len() != self.tapes
                {
                    errs.push(format!("state {i} `{}` rule {j}: arity != {} tapes", s.name, self.tapes));
                }
                if r.next >= n {
                    errs.push(format!("state {i} `{}` rule {j}: next {} out of range", s.name, r.next));
                }
            }
        }
        errs
    }
}
```

Add to `crates/redextape-core/src/tm.rs`: `pub mod machine;`

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::machine`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/machine.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): add the multi-tape Turing machine model"
```

---

### Task 2: the simulator

**Files:**
- Create: `crates/redextape-core/src/tm/sim.rs`
- Modify: `crates/redextape-core/src/tm.rs` (add `pub mod sim;`)

**Interfaces:**
- Consumes: `machine::{Machine, Move, Rule, StateId, Symbol, BLANK}`.
- Produces:
  - `Tape` (opaque zipper) with `Tape::new(&[Symbol])` and `Tape::snapshot() -> (Vec<Symbol>, usize)`.
  - `Status { Halted, HitCap }`, `Caps { steps: u64, cells: u64 }`, `DEFAULT_CAPS`.
  - `Step { state: StateId, tapes: Vec<(Vec<Symbol>, usize)> }`,
    `Trace { steps: Vec<Step>, final_state: StateId, final_tapes: Vec<(Vec<Symbol>, usize)>, status: Status }`.
  - `simulate(&Machine, init: &[Vec<Symbol>], Caps) -> (Vec<Tape>, Status)` and
    `simulate_trace(&Machine, init: &[Vec<Symbol>], Caps) -> Trace`.

`init[i]` seeds tape `i` (head at its leftmost cell); missing/blank tapes start empty. A step records
the state + tape snapshots *before* the rule is applied (mirrors the λ reducer's `Step`).

- [ ] **Step 1: Write the tests**

Create `crates/redextape-core/src/tm/sim.rs` with the tests first:

```rust
//! Iterative, bounded simulator for the multi-tape Turing machine. Deterministic (first matching rule
//! wins). A zipper tape gives O(1) head moves; a step cap + total-cells cap bound every run, so no
//! input hangs or overflows the native stack. Defensive on a malformed `Machine` (halts, never panics).

use crate::tm::machine::{Machine, Move, Rule, StateId, Symbol, BLANK};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::machine::State;

    fn increment() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "scan".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    /// A 1-tape machine that never halts: move right forever.
    fn spin() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![State {
                name: "go".into(),
                accept: false,
                rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::R], next: 0 }],
            }],
        }
    }

    #[test]
    fn increment_appends_a_mark() {
        let (tapes, status) = simulate(&increment(), &[vec!['1', '1', '1']], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        let (cells, _head) = tapes[0].snapshot();
        assert_eq!(cells, vec!['1', '1', '1', '1']);
    }

    #[test]
    fn increment_from_blank_writes_one_mark() {
        let (tapes, status) = simulate(&increment(), &[], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
        assert_eq!(tapes[0].snapshot().0, vec!['1']);
    }

    #[test]
    fn step_cap_stops_a_spinning_machine() {
        let (_t, status) = simulate(&spin(), &[], Caps { steps: 1000, ..DEFAULT_CAPS });
        assert_eq!(status, Status::HitCap);
    }

    #[test]
    fn cells_cap_stops_unbounded_tape_growth() {
        // spin() moves right forever, touching a new blank cell each step -> the cells cap trips.
        let (_t, status) = simulate(&spin(), &[], Caps { steps: u64::MAX, cells: 500 });
        assert_eq!(status, Status::HitCap);
    }

    #[test]
    fn trace_records_each_step_before_it_is_applied() {
        let trace = simulate_trace(&increment(), &[vec!['1', '1', '1']], DEFAULT_CAPS);
        assert_eq!(trace.status, Status::Halted);
        // 3 rightward moves over the marks + 1 write = 4 steps, then the accept state halts.
        assert_eq!(trace.steps.len(), 4);
        assert_eq!(trace.steps[0].state, 0);
        // The first snapshot is the initial tape.
        assert_eq!(trace.steps[0].tapes[0].0, vec!['1', '1', '1']);
        assert_eq!(trace.final_tapes[0].0, vec!['1', '1', '1', '1']);
    }

    #[test]
    fn a_malformed_machine_halts_rather_than_panicking() {
        // A rule whose `next` is out of range must halt defensively, not index-panic.
        let m = Machine {
            tapes: 1,
            start: 0,
            states: vec![State {
                name: "s".into(),
                accept: false,
                rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 99 }],
            }],
        };
        let (_t, status) = simulate(&m, &[], DEFAULT_CAPS);
        assert_eq!(status, Status::Halted);
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::sim`
Expected: FAIL — `cannot find function 'simulate'`.

- [ ] **Step 3: Implement the tape + simulator**

Add above the `#[cfg(test)]` module in `sim.rs`:

```rust
/// Why the run stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Halted,
    HitCap,
}

/// Resource caps, mirroring the interpreter/λ budgets.
#[derive(Clone, Copy, Debug)]
pub struct Caps {
    pub steps: u64,
    pub cells: u64,
}

/// Generous defaults: the demo machines halt well within these; runaway machines hit a cap.
pub const DEFAULT_CAPS: Caps = Caps { steps: 5_000_000, cells: 5_000_000 };

/// One tape as a zipper. `left`/`right` are stacks growing away from the head; `left.last()` is the
/// cell immediately left of the head, `right.last()` immediately right. Blanks are lazy at the ends.
#[derive(Clone, Debug)]
pub struct Tape {
    left: Vec<Symbol>,
    head: Symbol,
    right: Vec<Symbol>,
}

impl Tape {
    /// A tape seeded with `init` left-to-right (head at the leftmost cell, or blank if empty).
    pub fn new(init: &[Symbol]) -> Tape {
        let mut it = init.iter().copied();
        let head = it.next().unwrap_or(BLANK);
        Tape { left: Vec::new(), head, right: it.rev().collect() }
    }

    fn read(&self) -> Symbol {
        self.head
    }

    fn write(&mut self, s: Symbol) {
        self.head = s;
    }

    fn step(&mut self, m: Move) {
        match m {
            Move::S => {}
            Move::L => {
                self.right.push(self.head);
                self.head = self.left.pop().unwrap_or(BLANK);
            }
            Move::R => {
                self.left.push(self.head);
                self.head = self.right.pop().unwrap_or(BLANK);
            }
        }
    }

    fn cells(&self) -> usize {
        self.left.len() + 1 + self.right.len()
    }

    /// Materialize as `(contents left-to-right, head index)`.
    pub fn snapshot(&self) -> (Vec<Symbol>, usize) {
        let mut cells = self.left.clone();
        let head = cells.len();
        cells.push(self.head);
        cells.extend(self.right.iter().rev());
        (cells, head)
    }
}

/// One recorded step: the state + tape snapshots *before* the rule was applied.
#[derive(Clone, Debug)]
pub struct Step {
    pub state: StateId,
    pub tapes: Vec<(Vec<Symbol>, usize)>,
}

#[derive(Clone, Debug)]
pub struct Trace {
    pub steps: Vec<Step>,
    pub final_state: StateId,
    pub final_tapes: Vec<(Vec<Symbol>, usize)>,
    pub status: Status,
}

fn rule_matches(read: &[Option<Symbol>], tapes: &[Tape]) -> bool {
    read.len() == tapes.len()
        && read.iter().zip(tapes).all(|(pat, t)| match pat {
            None => true,
            Some(s) => *s == t.read(),
        })
}

fn apply(rule: &Rule, tapes: &mut [Tape]) {
    for (i, t) in tapes.iter_mut().enumerate() {
        if let Some(s) = rule.write[i] {
            t.write(s);
        }
        t.step(rule.moves[i]);
    }
}

/// The shared iterative loop. `record` optionally collects a step trace. Defensive on a malformed
/// machine (missing state / out-of-range target / stuck state all halt).
fn run(
    m: &Machine,
    init: &[Vec<Symbol>],
    caps: Caps,
    mut record: Option<&mut Vec<Step>>,
) -> (Vec<Tape>, StateId, Status) {
    let mut tapes: Vec<Tape> =
        (0..m.tapes).map(|i| Tape::new(init.get(i).map_or(&[][..], Vec::as_slice))).collect();
    let mut cur = m.start;
    let mut steps = 0u64;
    loop {
        let Some(state) = m.states.get(cur as usize) else {
            return (tapes, cur, Status::Halted);
        };
        if state.accept {
            return (tapes, cur, Status::Halted);
        }
        if steps >= caps.steps {
            return (tapes, cur, Status::HitCap);
        }
        let total: usize = tapes.iter().map(Tape::cells).sum();
        if total as u64 > caps.cells {
            return (tapes, cur, Status::HitCap);
        }
        let Some(rule) = state.rules.iter().find(|r| rule_matches(&r.read, &tapes)) else {
            return (tapes, cur, Status::Halted); // stuck == halt
        };
        if (rule.next as usize) >= m.states.len() || rule.write.len() != m.tapes || rule.moves.len() != m.tapes {
            return (tapes, cur, Status::Halted); // defensive: malformed rule
        }
        if let Some(rec) = record.as_deref_mut() {
            rec.push(Step { state: cur, tapes: tapes.iter().map(Tape::snapshot).collect() });
        }
        apply(rule, &mut tapes);
        cur = rule.next;
        steps += 1;
    }
}

/// Simulate to a halt or a cap, without retaining the step trace.
pub fn simulate(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, Status) {
    let (tapes, _final, status) = run(m, init, caps, None);
    (tapes, status)
}

/// Simulate, recording every step (before it is applied) for the scrubbable trace / view models.
pub fn simulate_trace(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> Trace {
    let mut steps = Vec::new();
    let (tapes, final_state, status) = run(m, init, caps, Some(&mut steps));
    let final_tapes = tapes.iter().map(Tape::snapshot).collect();
    Trace { steps, final_state, final_tapes, status }
}
```

Add to `crates/redextape-core/src/tm.rs`: `pub mod sim;`

> **Implementer notes:**
> - The `apply` indexing `rule.write[i]`/`rule.moves[i]` is safe because `run` returns early (halts) on
>   any rule whose `write`/`moves` arity != `m.tapes`, and `rule_matches` already required
>   `read.len() == tapes.len()`.
> - `simulate` deliberately does not delegate to `simulate_trace` (it avoids the per-step snapshot
>   allocation) — same rationale as the λ reducer's `reduce_to_normal_form` vs `reduce_trace`.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::sim`
Expected: PASS — all 6 simulator tests.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/sim.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): add the iterative multi-tape simulator with step + cells caps"
```

---

### Task 3: `print_tm` — render a machine as text

**Files:**
- Create: `crates/redextape-core/src/tm/syntax.rs`
- Modify: `crates/redextape-core/src/tm.rs` (add `pub mod syntax;`)

**Interfaces:**
- Consumes: `machine::{Machine, Move, Symbol, BLANK}`.
- Produces: `print_tm(&Machine) -> String`.

Format (exact, so goldens + round-trip are stable): `tapes <n>` line; `start <name>` line; a blank
line; then per state either `state <name>: accept` (accept, no rules) or `state <name>:` followed by
its rules, each indented two spaces as `  [<read>] -> write [<write>], move [<moves>], goto <name>`.
Symbol rendering: `None`→`*`, `Some('_')`→`_` (blank), `Some(c)`→`c`. Moves: `L`/`R`/`S`. Per-tape
entries are space-separated inside the brackets. Lines are `\n`-separated with a trailing newline.

- [ ] **Step 1: Write the golden test**

Create `crates/redextape-core/src/tm/syntax.rs` with the test first:

```rust
//! The TM text form: a flat, line-oriented, human-readable language for a `Machine`. `print_tm`
//! renders it; `parse_tm` reads it back (Task 4); they round-trip (design §9). `_` is the blank
//! symbol, `*` is the read-wildcard / write-unchanged marker.

use crate::tm::machine::{Machine, Move, Symbol};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::machine::{Rule, State};

    fn increment() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "scan".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn print_tm_is_a_stable_readable_listing() {
        let expected = "\
tapes 1
start scan

state scan:
  [1] -> write [*], move [R], goto scan
  [*] -> write [1], move [S], goto halt
state halt: accept
";
        assert_eq!(print_tm(&increment()), expected);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core tm::syntax`
Expected: FAIL — `cannot find function 'print_tm'`.

- [ ] **Step 3: Implement `print_tm`**

Add above the `#[cfg(test)]` module in `syntax.rs`:

```rust
use std::fmt::Write as _;

fn sym_str(s: &Option<Symbol>) -> String {
    match s {
        None => "*".to_string(),
        Some(c) => c.to_string(),
    }
}

fn syms_str(v: &[Option<Symbol>]) -> String {
    v.iter().map(sym_str).collect::<Vec<_>>().join(" ")
}

fn move_str(m: Move) -> char {
    match m {
        Move::L => 'L',
        Move::R => 'R',
        Move::S => 'S',
    }
}

fn moves_str(v: &[Move]) -> String {
    v.iter().map(|m| move_str(*m).to_string()).collect::<Vec<_>>().join(" ")
}

/// The name of a state by id, or a fallback so `print_tm` never panics on a malformed `Machine`.
fn state_name(m: &Machine, id: u32) -> String {
    m.states.get(id as usize).map_or_else(|| format!("<state {id}>"), |s| s.name.clone())
}

/// Render `m` as the readable TM text form.
pub fn print_tm(m: &Machine) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "tapes {}", m.tapes);
    let _ = writeln!(out, "start {}", state_name(m, m.start));
    let _ = writeln!(out);
    for s in &m.states {
        if s.accept {
            let _ = writeln!(out, "state {}: accept", s.name);
        } else {
            let _ = writeln!(out, "state {}:", s.name);
            for r in &s.rules {
                let _ = writeln!(
                    out,
                    "  [{}] -> write [{}], move [{}], goto {}",
                    syms_str(&r.read),
                    syms_str(&r.write),
                    moves_str(&r.moves),
                    state_name(m, r.next),
                );
            }
        }
    }
    out
}
```

Add to `crates/redextape-core/src/tm.rs`: `pub mod syntax;`

> **Implementer note:** the doc-comment `use` of `BLANK` may be unused until Task 4; if clippy flags
> the `BLANK` import as unused in Task 3, drop it from the `use` and re-add it in Task 4 where the
> parser needs it.

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core tm::syntax`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/syntax.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): add print_tm, the readable TM text printer"
```

---

### Task 4: `parse_tm` + round-trip

**Files:**
- Modify: `crates/redextape-core/src/tm/syntax.rs`

**Interfaces:**
- Consumes: `machine::{Machine, Move, Rule, State, Symbol, BLANK}`, `crate::{Diagnostic, Span}`,
  `crate::diagnostic::Severity`.
- Produces: `parse_tm(&str) -> (Option<Machine>, Vec<Diagnostic>)` — a flat, line-oriented parser
  (iterative; no recursion → no overflow). Resolves state names to ids (in definition order); rejects
  duplicate names, unknown `goto`/`start` targets, missing/invalid `tapes`, arity mismatches, and
  malformed rule lines with spanned diagnostics. `Machine` is returned only when there are no
  error-severity diagnostics. Round-trips with `print_tm`: `parse_tm(print_tm(m))` equals
  `(Some(m'), [])` with `m' == m`, and `print_tm(parse_tm(s))` is idempotent.

- [ ] **Step 1: Write the tests**

Add to the `tests` module in `syntax.rs`:

```rust
    use crate::Severity;

    fn parse_ok(src: &str) -> Machine {
        let (m, ds) = parse_tm(src);
        assert!(ds.iter().all(|d| d.severity != Severity::Error), "unexpected errors: {ds:?}");
        m.expect("expected a machine")
    }

    #[test]
    fn parse_then_print_round_trips() {
        let m = increment();
        let printed = print_tm(&m);
        assert_eq!(parse_ok(&printed), m, "parse(print(m)) must equal m");
        // print is idempotent on a re-parse.
        assert_eq!(print_tm(&parse_ok(&printed)), printed);
    }

    #[test]
    fn parse_handles_comments_and_blank_lines() {
        let src = "\
; a unary incrementer
tapes 1
start scan

state scan:
  [1] -> write [*], move [R], goto scan   ; keep scanning
  [*] -> write [1], move [S], goto halt
state halt: accept
";
        assert_eq!(parse_ok(src), increment());
    }

    #[test]
    fn unknown_goto_target_is_a_spanned_error() {
        let src = "tapes 1\nstart s\nstate s:\n  [*] -> write [*], move [S], goto nowhere\n";
        let (m, ds) = parse_tm(src);
        assert!(m.is_none());
        assert!(ds.iter().any(|d| d.message.contains("nowhere")));
        let d = &ds[0];
        assert!(d.span.start <= d.span.end && d.span.end <= src.len());
    }

    #[test]
    fn duplicate_state_name_is_an_error() {
        let src = "tapes 1\nstart s\nstate s: accept\nstate s: accept\n";
        let (m, ds) = parse_tm(src);
        assert!(m.is_none());
        assert!(ds.iter().any(|d| d.message.contains("duplicate")));
    }

    #[test]
    fn arity_mismatch_is_an_error() {
        // 2 tapes declared, but a rule lists only one symbol per bracket.
        let src = "tapes 2\nstart s\nstate s:\n  [1] -> write [*], move [S], goto s\n";
        let (m, ds) = parse_tm(src);
        assert!(m.is_none());
        assert!(ds.iter().any(|d| d.message.contains("arity") || d.message.contains("tapes")));
    }

    #[test]
    fn garbage_never_panics() {
        for src in ["", "tapes\n", "state\n", "[bad", "goto", "tapes 0\n", "start x\n"] {
            let _ = parse_tm(src); // must return, never panic
        }
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::syntax`
Expected: FAIL — `cannot find function 'parse_tm'`.

- [ ] **Step 3: Implement `parse_tm`**

Add to `syntax.rs` (extend the top `use` to include the machine types + diagnostics):

```rust
use crate::diagnostic::Severity;
use crate::tm::machine::{BLANK, Rule, State, StateId};
use crate::{Diagnostic, Span};
```

Add above the `#[cfg(test)]` module:

```rust
fn err(span: Span, message: impl Into<String>) -> Diagnostic {
    Diagnostic { span, severity: Severity::Error, message: message.into() }
}

/// A rule whose `goto` is still a name (resolved after all states are seen).
struct RawRule {
    read: Vec<Option<Symbol>>,
    write: Vec<Option<Symbol>>,
    moves: Vec<Move>,
    goto: String,
    span: Span,
}

struct RawState {
    name: String,
    accept: bool,
    rules: Vec<RawRule>,
}

/// Parse one read/write symbol token: `*` -> wildcard/unchanged, any other single char -> that symbol
/// (`_` is the blank symbol). A multi-char token uses its first char.
fn parse_sym(tok: &str) -> Option<Symbol> {
    if tok == "*" { None } else { Some(tok.chars().next().unwrap_or(BLANK)) }
}

fn parse_move(tok: &str) -> Option<Move> {
    match tok {
        "L" => Some(Move::L),
        "R" => Some(Move::R),
        "S" => Some(Move::S),
        _ => None,
    }
}

/// Strip a leading `[...]` group, returning `(inside, rest_after_bracket)`.
fn bracket<'a>(s: &'a str, span: Span) -> Result<(&'a str, &'a str), Diagnostic> {
    let s = s.trim_start();
    let s = s.strip_prefix('[').ok_or_else(|| err(span, "expected `[`"))?;
    let close = s.find(']').ok_or_else(|| err(span, "expected `]`"))?;
    Ok((&s[..close], &s[close + 1..]))
}

/// Parse a single rule line body (already known to start with `[`). Strips a trailing `;` comment.
fn parse_rule_line(line: &str, span: Span) -> Result<RawRule, Diagnostic> {
    let line = line.split(';').next().unwrap_or("").trim();
    let (read_s, rest) = bracket(line, span)?;
    let rest = rest.trim_start().strip_prefix("->").ok_or_else(|| err(span, "expected `->`"))?;
    let rest = rest.trim_start().strip_prefix("write").ok_or_else(|| err(span, "expected `write`"))?;
    let (write_s, rest) = bracket(rest, span)?;
    let rest = rest.trim_start().strip_prefix(',').ok_or_else(|| err(span, "expected `,`"))?;
    let rest = rest.trim_start().strip_prefix("move").ok_or_else(|| err(span, "expected `move`"))?;
    let (move_s, rest) = bracket(rest, span)?;
    let rest = rest.trim_start().strip_prefix(',').ok_or_else(|| err(span, "expected `,`"))?;
    let goto = rest.trim_start().strip_prefix("goto").ok_or_else(|| err(span, "expected `goto`"))?.trim();
    if goto.is_empty() {
        return Err(err(span, "expected a goto target"));
    }
    let read = read_s.split_whitespace().map(parse_sym).collect();
    let write = write_s.split_whitespace().map(parse_sym).collect();
    let moves = move_s
        .split_whitespace()
        .map(parse_move)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| err(span, "bad move (expected L/R/S)"))?;
    Ok(RawRule { read, write, moves, goto: goto.to_string(), span })
}

/// Parse the TM text form. Iterative (flat grammar, no recursion). Never panics.
pub fn parse_tm(src: &str) -> (Option<Machine>, Vec<Diagnostic>) {
    let mut diags: Vec<Diagnostic> = Vec::new();
    let mut tapes: Option<usize> = None;
    let mut start_name: Option<(String, Span)> = None;
    let mut states: Vec<RawState> = Vec::new();

    let mut offset = 0usize;
    for raw_line in src.split_inclusive('\n') {
        let line_start = offset;
        offset += raw_line.len();
        let content = raw_line.trim_end_matches('\n');
        let span = Span { start: line_start, end: line_start + content.len() };
        // Strip a full-line comment / blank.
        let trimmed = content.trim_start();
        if trimmed.is_empty() || trimmed.starts_with(';') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("tapes ") {
            match rest.split(';').next().unwrap_or("").trim().parse::<usize>() {
                Ok(n) if n >= 1 => tapes = Some(n),
                _ => diags.push(err(span, "expected `tapes <positive integer>`")),
            }
        } else if let Some(rest) = trimmed.strip_prefix("start ") {
            start_name = Some((rest.split(';').next().unwrap_or("").trim().to_string(), span));
        } else if let Some(rest) = trimmed.strip_prefix("state ") {
            let rest = rest.split(';').next().unwrap_or("").trim();
            let Some((name, tail)) = rest.split_once(':') else {
                diags.push(err(span, "expected `state <name>:`"));
                continue;
            };
            let (name, tail) = (name.trim().to_string(), tail.trim());
            if name.is_empty() {
                diags.push(err(span, "empty state name"));
                continue;
            }
            let accept = tail == "accept";
            if !accept && !tail.is_empty() {
                diags.push(err(span, "expected `:` or `: accept` after the state name"));
            }
            if states.iter().any(|s| s.name == name) {
                diags.push(err(span, format!("duplicate state name `{name}`")));
            }
            states.push(RawState { name, accept, rules: Vec::new() });
        } else if trimmed.starts_with('[') {
            let Some(state) = states.last_mut() else {
                diags.push(err(span, "rule outside any state"));
                continue;
            };
            match parse_rule_line(trimmed, span) {
                Ok(r) => state.rules.push(r),
                Err(d) => diags.push(d),
            }
        } else {
            diags.push(err(span, "unrecognized line"));
        }
    }

    let Some(tapes) = tapes else {
        diags.push(err(Span { start: 0, end: 0 }, "missing `tapes <n>`"));
        return (None, diags);
    };

    // Resolve names -> ids (definition order). Owned keys, so it does not borrow `states` and the
    // final builder can consume `states` freely. (Duplicate names were diagnosed above; if any exist
    // the error gate below returns `None` before this map is used to build.)
    let ids: std::collections::HashMap<String, StateId> =
        states.iter().enumerate().map(|(i, s)| (s.name.clone(), i as StateId)).collect();
    for rs in &states {
        for rr in &rs.rules {
            if rr.read.len() != tapes || rr.write.len() != tapes || rr.moves.len() != tapes {
                diags.push(err(rr.span, format!("rule arity does not match `tapes {tapes}`")));
            }
            if !ids.contains_key(&rr.goto) {
                diags.push(err(rr.span, format!("unknown goto target `{}`", rr.goto)));
            }
        }
    }
    let start = match &start_name {
        Some((name, span)) => match ids.get(name).copied() {
            Some(id) => id,
            None => {
                diags.push(err(*span, format!("unknown start state `{name}`")));
                0
            }
        },
        None => {
            diags.push(err(Span { start: 0, end: 0 }, "missing `start <name>`"));
            0
        }
    };

    if diags.iter().any(|d| d.severity == Severity::Error) {
        return (None, diags);
    }

    let machine = Machine {
        tapes,
        start,
        states: states
            .into_iter()
            .map(|rs| State {
                name: rs.name,
                accept: rs.accept,
                rules: rs
                    .rules
                    .into_iter()
                    .map(|rr| Rule {
                        read: rr.read,
                        write: rr.write,
                        moves: rr.moves,
                        next: ids.get(&rr.goto).copied().unwrap_or(0),
                    })
                    .collect(),
            })
            .collect(),
    };
    (Some(machine), diags)
}
```

> **Implementer notes:**
> - The `ids` map owns its `String` keys, so it does not borrow `states`; the final `Machine { states:
>   states.into_iter()… }` builder can consume `states` while `ids` resolves `goto` targets.
> - The parser is fully iterative over lines — there is no recursive nesting in the grammar, so no
>   depth guard is needed (a justified deviation from the spec's boilerplate "depth guard" note, which
>   assumed a recursively-nested grammar like the source/λ parsers). Coarse input-size bounds can be
>   added later if needed; they are not a stack-safety requirement here.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::syntax`
Expected: PASS — round-trip, comments, and every error case; `garbage_never_panics` returns cleanly.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/syntax.rs
git commit -m "feat(tm): add parse_tm with round-trip and spanned diagnostics"
```

---

### Task 5: re-exports + the substrate integration test

**Files:**
- Modify: `crates/redextape-core/src/tm.rs` (re-exports)
- Create: `crates/redextape-core/tests/tm_machine.rs`

**Interfaces:**
- Consumes: everything above.
- Produces: `tm` re-exports and an end-to-end substrate test (build/parse → simulate → round-trip).

- [ ] **Step 1: Add re-exports to `tm.rs`**

```rust
pub use machine::{Machine, Move, Rule, State, StateId, Symbol, BLANK};
pub use sim::{simulate, simulate_trace, Caps as TmCaps, Status as TmStatus, Step, Tape, Trace, DEFAULT_CAPS as TM_DEFAULT_CAPS};
pub use syntax::{parse_tm, print_tm};
```

> **Note:** `Caps`/`Status`/`DEFAULT_CAPS` are re-exported under `Tm`-prefixed aliases to avoid
> colliding with the asm module's `Caps`/`DEFAULT_CAPS` (Part 1). The `Step`/`Trace` names are distinct
> from the λ backend's (different modules), so no alias is needed.

Run: `cargo build -p redextape-core`
Expected: clean. (If any re-exported name is genuinely unused workspace-wide and clippy complains,
it is part of the public API surface Part 2b/Plan 4 consume — keep it; the re-export itself is a use.)

- [ ] **Step 2: Write the integration test**

Create `crates/redextape-core/tests/tm_machine.rs`:

```rust
//! Part 2a substrate: a genuine multi-tape TM can be authored (in text or by hand), simulated to a
//! result, and round-tripped through its text form. Part 2b compiles register-assembly down to such
//! machines and checks them against the reference (the three-way oracle).

use redextape_core::tm::{parse_tm, print_tm, simulate, TmStatus, TM_DEFAULT_CAPS};

const INCREMENT: &str = "\
; unary incrementer: append one mark
tapes 1
start scan

state scan:
  [1] -> write [*], move [R], goto scan
  [*] -> write [1], move [S], goto halt
state halt: accept
";

#[test]
fn author_simulate_and_round_trip_a_machine() {
    let (machine, ds) = parse_tm(INCREMENT);
    assert!(ds.is_empty(), "diagnostics: {ds:?}");
    let machine = machine.expect("a machine");

    // Simulate: 3 marks -> 4 marks.
    let (tapes, status) = simulate(&machine, &[vec!['1', '1', '1']], TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);
    assert_eq!(tapes[0].snapshot().0, vec!['1', '1', '1', '1']);

    // Round-trip: print(parse(s)) is idempotent, and re-parsing yields the same machine.
    let printed = print_tm(&machine);
    let (reparsed, ds2) = parse_tm(&printed);
    assert!(ds2.is_empty(), "diagnostics: {ds2:?}");
    assert_eq!(reparsed.as_ref(), Some(&machine));
    assert_eq!(print_tm(&reparsed.unwrap()), printed);
}

#[test]
fn malformed_tm_text_yields_diagnostics_not_a_panic() {
    for src in ["", "tapes 0\n", "state s:\n  [*] -> write [*], move [S], goto ghost\n", "junk line"] {
        let (m, ds) = parse_tm(src);
        assert!(m.is_none() || ds.is_empty()); // either a clean parse or diagnostics — never a panic
    }
}
```

- [ ] **Step 3: Run the integration test + full suite + coverage**

Run: `cargo test -p redextape-core`
Expected: PASS — all `tm::machine` / `tm::sim` / `tm::syntax` unit tests + the integration test + the
existing Part-1 `asm` tests / `asm_oracle` / `lambda_oracle`.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

Run: `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`
Expected: ≥ 80% line coverage. If an arm is uncovered, add a focused unit test for it (say which in the
report) — do not lower the threshold.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm.rs crates/redextape-core/tests/tm_machine.rs
git commit -m "test(tm): wire the TM substrate re-exports + build/simulate/round-trip test"
```

---

## Self-review (completed while writing — notes for the executor)

- **Spec coverage:** machine model §4 (Task 1); simulator §7 incl. Trace/Step/Status + caps (Task 2);
  TM text form §9 with `print_tm` (Task 3) and a round-tripping `parse_tm` (Task 4); re-exports +
  substrate integration (Task 5). Deferred by design: `encoding`/`lower_tm`/`decode`/three-way oracle
  (Part 2b). The spec's "`parse_tm` depth guard" is intentionally omitted — the flat grammar has no
  recursion (documented in Task 4).
- **Type consistency:** `Machine`/`State`/`Rule`/`Move`/`Symbol`/`StateId`/`BLANK` (Task 1) are used
  verbatim by `sim` (Task 2) and `syntax` (Tasks 3–4). `Tape::snapshot() -> (Vec<Symbol>, usize)` is
  the single tape-reading accessor used by tests and Part 2b's `decode`. `Caps`/`Status`/`DEFAULT_CAPS`
  are re-exported under `Tm`-prefixed aliases (Task 5) to avoid the asm-module name clash.
- **Safety:** `simulate` uses `.get()`/early-halt on any malformed rule/target (Task 2 test
  `a_malformed_machine_halts_rather_than_panicking`); `parse_tm` is iterative and total (Task 4
  `garbage_never_panics`, Task 5 malformed-text test). Flat `Vec`-backed types → no iterative `Drop`.
- **No placeholders:** every code step is complete; the only note-flagged risks (borrow of `states` in
  the final builder, an unused `BLANK` import in Task 3) have explicit implementer guidance.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-tm-backend-part2a-machine.md`. Two
execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast
   iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
