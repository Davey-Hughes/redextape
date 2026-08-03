# Per-program field-width sizing + the overflow guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TM's unary register-field width a per-program property chosen automatically by
`run_tm`, guarded so that an under-sized field halts in a distinguishable state instead of silently
corrupting the tape.

**Architecture:** The width moves from a global `const FIELD_WIDTH` onto the `Unary` encoding instance
(`Unary::at(w)`), reaching only four places (`init_reg`, `write_literal`, and the BOX tape's fixed-width
navigation). A single shared, rule-less, non-accept `overflow` state — owned by `Builder`, returned as an
artifact by `lower_tm_guarded` — is the target of four guard rules, one at each of the four sites in the
codebase that write a value mark to REG or BOX. `run_tm` then doubles the width from 4 to 64 until the
guard stops firing.

**Tech Stack:** Rust 2024, no new dependencies. `cargo test -p redextape-core`, `cargo test --workspace`.

**Design spec:** `docs/superpowers/specs/2026-07-26-per-program-field-width-design.md`. Read §3 and §4
before Task 3.

## Global Constraints

- `MIN_FIELD_WIDTH = 4`, `MAX_FIELD_WIDTH = 64`. Auto-fit attempts exactly `4, 8, 16, 32, 64`.
- A stored value `v` is representable iff `v < width` (strict — at least one padding blank must remain).
- **Every committed step-count golden at width 64 must stay byte-identical**: `5724`, `2174`, `2300`,
  `239_971`. Guards add rules, never steps. Any task that moves one of these numbers is wrong.
- Rule insertion order is load-bearing: lookup is first-match-wins and `Machine::validate()` has no
  overlap check. Every guard rule is added **before** the rules it shadows.
- WORK, STACK and HEAP stay unbounded — they are variable-width and bounded only by `caps.cells`. Do not
  add guards there.
- The baseline is 375 passing tests in `redextape-core`. No task may reduce that count.
- No attribution lines in commit messages.

**One refinement over the spec:** the spec describes the overflow state as *lazily* allocated, giving
`lower_tm_guarded -> (Machine, Option<StateId>)`. This plan allocates it **eagerly**, immediately after
the `halt` state, so `lower_tm_guarded -> (Machine, StateId)` with no `Option`. Reason: `lower_tm_mapped`
bills states to instructions by before/after span arithmetic around each gadget, so a lazily-allocated
state would be billed to whichever instruction happened to trigger it first. Eager allocation bills it to
`None` (scaffolding), alongside `halt`, which is what it is. `Builder::overflow()` still allocates lazily
for direct-`Builder` unit tests that never go through `lower_tm`.

---

### Task 1: Width becomes encoding state

**Files:**
- Modify: `crates/redextape-core/src/tm/build.rs:23-32` (the `FIELD_WIDTH` const)
- Modify: `crates/redextape-core/src/tm/encoding.rs` (the `Unary` struct, the `Encoding` trait, six BOX
  helpers, `init_reg`, `write_literal`, the `#[cfg(test)]` module)
- Modify: `crates/redextape-core/src/tm.rs:23` (the `pub use` from `build`)
- Modify: every `&Unary` call site — `crates/redextape-core/src/tm/attribute.rs`,
  `crates/redextape-core/src/tm/lower_tm.rs`, `crates/redextape-core/src/tm.rs`,
  `crates/redextape-core/tests/*.rs`, `crates/redextape-core/examples/*.rs`,
  `crates/redextape-native/tests/native_oracle.rs`
- Test: `crates/redextape-core/src/tm/encoding.rs` (unit tests), `crates/redextape-core/tests/tm_encoding.rs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `MIN_FIELD_WIDTH: usize`, `MAX_FIELD_WIDTH: usize`, `Unary { width: usize }` with
  `Unary::at(width: usize) -> Unary` and `Default` (= `MAX_FIELD_WIDTH`), and two new `Encoding` methods:
  `fn field_width(&self) -> Option<usize>` and `fn at_width(&self, width: usize) -> Box<dyn Encoding>`.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` at the bottom of `crates/redextape-core/src/tm/encoding.rs`:

```rust
/// The field width is a property of the encoding INSTANCE, not a global constant: two `Unary`s at
/// different widths lay out different banks, and each one's own `decode_nat` reads its own layout.
#[test]
fn unary_width_is_per_instance() {
    let narrow = Unary::at(8);
    let wide = Unary::default();
    assert_eq!(narrow.field_width(), Some(8));
    assert_eq!(wide.field_width(), Some(MAX_FIELD_WIDTH));

    // `#` then (width blanks + `#`) per slot.
    assert_eq!(narrow.init_reg(2).len(), 1 + 2 * (8 + 1));
    assert_eq!(wide.init_reg(2).len(), 1 + 2 * (MAX_FIELD_WIDTH + 1));

    // `at_width` re-instantiates: the receiver is unchanged, the result carries the new width.
    let refitted = wide.at_width(8);
    assert_eq!(refitted.field_width(), Some(8));
    assert_eq!(wide.field_width(), Some(MAX_FIELD_WIDTH), "at_width must not mutate the receiver");
}

/// A whole program runs correctly on a narrow bank, provided every stored value fits. `1 + 2 * 3`
/// stores at most 7, so width 8 is sufficient — and much cheaper than the default 64.
#[test]
fn a_program_runs_on_a_narrow_bank() {
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::tm::decode::decode_tape;
    use crate::tm::lower_asm::lower_asm;
    use crate::tm::lower_tm::lower_tm;
    use crate::tm::sim::{DEFAULT_CAPS, Status, simulate};
    use crate::value::Value;

    let (prog, ds) = parse("1 + 2 * 3");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let program = lower_asm(&core).expect("lowers");
    let enc = Unary::at(8);
    let m = lower_tm(&program, &enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(crate::tm::lower_tm::SlotMap::of(&program).n_slots());
    let (tapes, status) = simulate(&m, &init, DEFAULT_CAPS);
    assert_eq!(status, Status::Halted);
    assert_eq!(decode_tape(&tapes, &Value::Nat(7), &enc), Some(Value::Nat(7)));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p redextape-core --lib tm::encoding 2>&1 | tail -20`
Expected: FAIL to COMPILE — `no function or associated item named 'at' found for struct 'Unary'`, and
`no method named 'field_width'`.

- [ ] **Step 3: Rename the constant**

In `crates/redextape-core/src/tm/build.rs`, replace the `FIELD_WIDTH` const (lines 23-32) with:

```rust
/// The narrowest unary field width `run_tm`'s auto-fit search starts at.
pub const MIN_FIELD_WIDTH: usize = 4;

/// The widest unary field width: the ceiling of `run_tm`'s auto-fit search, and the width of
/// `Unary::default()`. A register field is `width` cells: a value `v` is `v` `MARK`s left-justified,
/// then `width - v` `BLANK`s. Fixed width means a write mutates the field IN PLACE (blank the window,
/// write the marks) and never has to shift the rest of the tape. The bound is STRICT: `v` must stay
/// `< width`, so at least one padding blank always remains. This is load-bearing, not cosmetic —
/// `rewind_home` walks left and stops on the first `#` it meets; a field written EXACTLY full (zero
/// padding) has no interior blank for the copy/write/erase loops to land on, so they instead stop on the
/// field's trailing `#`, and `rewind_home` then crosses one delimiter too many and lands the REG head one
/// field to the RIGHT of home. The overflow guard (see `Builder::overflow`) turns that from a silent
/// miscompile into a halt; a program whose values exceed this ceiling is reported as `TmRun::Overflow`.
pub const MAX_FIELD_WIDTH: usize = 64;
```

In `crates/redextape-core/src/tm.rs:23`, change the re-export:

```rust
pub use build::{
    AT, Builder, HEAP, MARK, MAX_FIELD_WIDTH, MIN_FIELD_WIDTH, REG, RuleSpec, SEP, STACK, Slot, TAPES, WORK,
};
```

- [ ] **Step 4: Give `Unary` a width and the trait two methods**

In `crates/redextape-core/src/tm/encoding.rs`, change the import on line 8 from `FIELD_WIDTH` to
`MAX_FIELD_WIDTH`, then replace `pub struct Unary;` (line 94) with:

```rust
/// The v1 unary encoding at a given field width. `Default` is `MAX_FIELD_WIDTH`; `run_tm` auto-fits a
/// narrower one per program via `at_width`.
#[derive(Clone, Copy, Debug)]
pub struct Unary {
    width: usize,
}

impl Default for Unary {
    fn default() -> Self {
        Unary { width: MAX_FIELD_WIDTH }
    }
}

impl Unary {
    /// A unary encoding whose register fields are `width` cells wide. Values `>= width` are not
    /// representable and route to the overflow guard.
    pub const fn at(width: usize) -> Unary {
        Unary { width }
    }
}
```

Add to the `Encoding` trait (after `decode_nat`):

```rust
    /// The strict value bound this instance was built at — a stored value `v` must satisfy
    /// `v < width`. `None` means the encoding is unbounded, which is how `run_tm`'s auto-fit knows
    /// not to search at all.
    fn field_width(&self) -> Option<usize>;
    /// Re-instantiate this encoding at `width`. An unbounded encoding returns an equivalent of itself.
    fn at_width(&self, width: usize) -> Box<dyn Encoding>;
```

Add to `impl Encoding for Unary`:

```rust
    fn field_width(&self) -> Option<usize> {
        Some(self.width)
    }

    fn at_width(&self, width: usize) -> Box<dyn Encoding> {
        Box::new(Unary::at(width))
    }
```

- [ ] **Step 5: Thread the width into the four places that need it**

`init_reg` — replace `FIELD_WIDTH` with `self.width`:

```rust
    fn init_reg(&self, slots: u32) -> Vec<Symbol> {
        // Fixed-width all-zero bank: `#` then (width blanks + `#`) per field.
        let mut cells = vec![SEP];
        for _ in 0..slots {
            cells.extend(std::iter::repeat_n(BLANK, self.width));
            cells.push(SEP);
        }
        cells
    }
```

`write_literal` — no width use yet beyond the (Task 4) static check; leave as is.

The six BOX helpers each gain a trailing `width: usize` parameter, replacing `FIELD_WIDTH`:
`box_skip_field_right`, `box_skip_field_left`, `box_append_field`, `box_count_fields_to_work`,
`box_seek_field`, `box_return_to_origin`. For example:

```rust
fn box_skip_field_right(b: &mut Builder, from: StateId, label: &str, width: usize) -> StateId {
    let mut cur = from;
    for k in 0..=width {
        let nxt = b.state(format!("{label}.sr{k}"));
        b.add_rule(cur, RuleSpec::new().on(BOX, None, None, Move::R), nxt);
        cur = nxt;
    }
    cur // on the boundary (`#` or top blank)
}
```

`box_count_fields_to_work`, `box_seek_field` and `box_return_to_origin` pass their own `width` through to
the `box_skip_field_*` calls they make. The three `Unary` methods that call them — `box_op`,
`box_get_op`, `box_set_op` — pass `self.width`.

- [ ] **Step 6: Update every call site**

Run: `cargo build --workspace 2>&1 | grep -E "^error" | head -40`

Fix each reported site mechanically: `&Unary` becomes `&Unary::default()`, `Unary.init_reg(..)` becomes
`Unary::default().init_reg(..)`, `FIELD_WIDTH` becomes `MAX_FIELD_WIDTH`. In
`crates/redextape-core/tests/tm_encoding.rs` also update the import on line 6 and the two `let enc =
Unary;` bindings (lines 21, 46) to `Unary::default()`.

- [ ] **Step 7: Run the tests**

Run: `cargo test -q -p redextape-core 2>&1 | grep -E "^test result|FAILED|panicked" | head -20`
Expected: all pass, 377 total (375 baseline + the 2 new tests).

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::tm_step_count 2>&1 | tail -5`
Expected: PASS — the goldens `5724 / 2174 / 2300 / 239_971` are unchanged, because `Unary::default()`
is still 64 cells wide.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(tm): the unary field width is per-encoding-instance, not a global const

FIELD_WIDTH becomes MIN_FIELD_WIDTH/MAX_FIELD_WIDTH and the width moves onto
Unary itself (Unary::at(w), Default = 64). Two new Encoding methods carry it
across the seam: field_width() reports the strict value bound (None = an
unbounded encoding, which is how auto-fit will know not to search), and
at_width() re-instantiates.

The width reaches only four places, because almost every gadget stops on
content rather than on a count: init_reg's padding, write_literal, and the BOX
tape's content-blind fixed-width navigation. seek_slot, rewind_home,
append_work_to_field and every HEAP/STACK gadget need nothing, and decode_nat
was already width-agnostic.

No behaviour change: Unary::default() is 64, so every step golden is untouched."
```

---

### Task 2: The shared overflow state, plumbed but not yet used

**Files:**
- Modify: `crates/redextape-core/src/tm/build.rs` (the `Builder` struct)
- Modify: `crates/redextape-core/src/tm/lower_tm.rs:117-260` (`lower_tm_mapped` → `lower_tm_all`)
- Modify: `crates/redextape-core/src/tm/sim.rs:165-170` (add `simulate_final`)
- Modify: `crates/redextape-core/src/tm.rs` (re-exports)
- Test: `crates/redextape-core/src/tm/build.rs`, `crates/redextape-core/src/tm/lower_tm.rs`

**Interfaces:**
- Consumes: Task 1's `Unary::at`, `MAX_FIELD_WIDTH`.
- Produces: `Builder::overflow(&mut self) -> StateId`, `Builder::overflow_state(&self) -> Option<StateId>`,
  `lower_tm_guarded(prog: &Program, enc: &dyn Encoding) -> (Machine, StateId)`,
  `simulate_final(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, StateId, Status)`.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm/build.rs`'s `#[cfg(test)] mod tests`:

```rust
/// The overflow state is ONE shared, rule-less, non-accept state: repeated requests return the same
/// id, and reaching it halts the machine (no rule matches, and it is not an accept state).
#[test]
fn overflow_state_is_shared_ruleless_and_non_accept() {
    let mut b = Builder::new();
    assert_eq!(b.overflow_state(), None, "not allocated until asked for");
    let first = b.overflow();
    let second = b.overflow();
    assert_eq!(first, second, "every gadget must share the one overflow state");
    assert_eq!(b.overflow_state(), Some(first));

    let start = b.state("start");
    b.add_rule(start, RuleSpec::new(), first);
    let m = b.finish(start);
    assert!(!m.states[first as usize].accept, "overflow must NOT be an accept state");
    assert!(m.states[first as usize].rules.is_empty(), "overflow must be rule-less so it halts");
}
```

Add to `crates/redextape-core/src/tm/lower_tm.rs`'s `#[cfg(test)] mod tests`:

```rust
/// `lower_tm_guarded` hands the overflow state back as an ARTIFACT (like `lower_tm_mapped`'s origin
/// map), and it is billed to no instruction — it is scaffolding, allocated alongside `halt`.
#[test]
fn lower_tm_guarded_returns_the_overflow_state_as_scaffolding() {
    let (prog, ds) = parse("1 + 2 * 3");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let program = lower_asm(&core).expect("lowers");

    let (m, overflow) = lower_tm_guarded(&program, &Unary::default());
    assert!(m.states[overflow as usize].rules.is_empty());
    assert!(!m.states[overflow as usize].accept);

    let (_, origins) = lower_tm_mapped(&program, &Unary::default());
    assert_eq!(origins[overflow as usize], None, "the guard belongs to no single instruction");

    // The unguarded entry point is the same machine.
    assert_eq!(lower_tm(&program, &Unary::default()), m);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -q -p redextape-core --lib tm::build tm::lower_tm 2>&1 | tail -20`
Expected: FAIL to COMPILE — `no method named 'overflow' found for struct 'Builder'`, and
`cannot find function 'lower_tm_guarded'`.

- [ ] **Step 3: Add the state to `Builder`**

In `crates/redextape-core/src/tm/build.rs`, replace the `Builder` struct and add two methods:

```rust
/// Incrementally builds a `Machine`'s states.
#[derive(Default)]
pub struct Builder {
    states: Vec<State>,
    overflow: Option<StateId>,
}
```

```rust
    /// The ONE shared overflow-guard state, allocated on first request. Rule-less and non-accept, so
    /// reaching it halts the machine immediately and `simulate_final` can name it as the reason.
    ///
    /// Every gadget that writes a value into a fixed-width field (the REG bank, the BOX tape) routes
    /// its "this value does not fit" case here, rather than allocating a fault state of its own as the
    /// nil/dangling DEREF faults do. Those spin to a cap on purpose (matching λ's Ω and the reference's
    /// `Runtime`); an overflow is a different thing — the program is fine, the tape is too narrow —
    /// and the caller retries at a wider one, so it must be told apart from divergence.
    pub fn overflow(&mut self) -> StateId {
        match self.overflow {
            Some(s) => s,
            None => {
                let s = self.state("overflow");
                self.overflow = Some(s);
                s
            }
        }
    }

    /// The overflow state if one has been allocated, without allocating one.
    pub fn overflow_state(&self) -> Option<StateId> {
        self.overflow
    }
```

- [ ] **Step 4: Make `lower_tm_all` the one implementation**

In `crates/redextape-core/src/tm/lower_tm.rs`, rename `pub fn lower_tm_mapped` to
`fn lower_tm_all(prog: &Program, enc: &dyn Encoding) -> (Machine, Vec<Option<usize>>, StateId)`. Directly
after `let halt = b.accept("halt");` insert:

```rust
    // Allocated EAGERLY, next to `halt`, so the origin map bills it to `None` (scaffolding) rather than
    // to whichever instruction's gadget happened to request it first. Every guard rule targets this one
    // state; see `Builder::overflow`.
    let overflow = b.overflow();
```

Change both early returns and the final return to carry `overflow` as a third element, then add the three
public wrappers in place of the old `lower_tm_mapped` / `lower_tm`:

```rust
/// Lower `prog` to a Turing machine, returning the machine AND its state map (see `lower_tm_all`).
pub fn lower_tm_mapped(prog: &Program, enc: &dyn Encoding) -> (Machine, Vec<Option<usize>>) {
    let (m, origins, _) = lower_tm_all(prog, enc);
    (m, origins)
}

/// Lower `prog`, returning the machine AND its overflow-guard state. Halting in that state means a
/// value did not fit the encoding's field width — retry at a wider one (`run_tm` does exactly that).
///
/// Returned as an artifact rather than stored on `Machine` for the same reason as the origin map:
/// `Machine` derives `PartialEq` and the TM text round-trip asserts `parse_tm(print_tm(m)) == m`, which
/// a side-table field would break for a reason unrelated to what the machine computes.
pub fn lower_tm_guarded(prog: &Program, enc: &dyn Encoding) -> (Machine, StateId) {
    let (m, _, overflow) = lower_tm_all(prog, enc);
    (m, overflow)
}

/// Lower `prog` into a `TAPES`-tape `Machine`. Total and panic-free on any `Program`.
pub fn lower_tm(prog: &Program, enc: &dyn Encoding) -> Machine {
    lower_tm_all(prog, enc).0
}
```

- [ ] **Step 5: Add `simulate_final`**

In `crates/redextape-core/src/tm/sim.rs`, directly after `simulate`:

```rust
/// Simulate to a halt or a cap, reporting the final state alongside the tapes. The state is what tells
/// a caller *why* a machine halted — in particular whether it halted in the overflow-guard state that
/// `lower_tm_guarded` hands back. `simulate` is exactly this with the state discarded.
pub fn simulate_final(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, StateId, Status) {
    run(m, init, caps, None, None)
}
```

- [ ] **Step 6: Update the re-exports**

In `crates/redextape-core/src/tm.rs`:

```rust
pub use lower_tm::{lower_tm, lower_tm_guarded, lower_tm_mapped};
pub use sim::{
    Caps as TmCaps, DEFAULT_CAPS as TM_DEFAULT_CAPS, Status as TmStatus, Step, Tape, Trace, simulate,
    simulate_final, simulate_trace,
};
```

- [ ] **Step 7: Run the tests**

Run: `cargo test -q -p redextape-core 2>&1 | grep -E "^test result|FAILED|panicked" | head -20`
Expected: all pass, 379 total.

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::tm_step_count 2>&1 | tail -5`
Expected: PASS — adding a rule-less state costs no steps, so the goldens are untouched.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(tm): one shared overflow-guard state, returned as a lowering artifact

Builder owns a single rule-less non-accept 'overflow' state; lower_tm_guarded
hands its id back the way lower_tm_mapped hands back the origin map, so
Machine stays a plain machine the text form round-trips. simulate_final
reports the final state so a caller can tell halting-in-the-guard apart from
halting normally.

Allocated eagerly next to halt, not lazily: lower_tm bills states to
instructions by before/after span arithmetic around each gadget, so a lazy
allocation would be billed to whichever instruction requested it first.

No guard rules yet -- this is the plumbing. TmStatus is untouched: stuck still
folds into Halted, and the guard is identified by id, which avoids claiming an
invariant (no other stuck state is reachable) that nothing here proves."
```

---

### Task 3: Guard the universal REG store

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/unary.rs`'s `append_work_to_field`
- Test: `crates/redextape-core/src/tm/lower_tm.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `Builder::overflow` (Task 2), `lower_tm_guarded`, `simulate_final`, `Unary::at` (Task 1).
- Produces: no new API. `append_work_to_field` now routes a value `>= width` to `b.overflow()`.

Read design spec §3, "Why one rule suffices at `append_work_to_field`", before starting.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm/lower_tm.rs`'s `#[cfg(test)] mod tests`:

```rust
/// Run `src` on a bank `width` cells wide and report whether it halted in the overflow guard.
#[cfg(test)]
fn halts_in_overflow(src: &str, width: usize) -> bool {
    use crate::tm::sim::simulate_final;
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let program = lower_asm(&core).expect("lowers");
    let enc = Unary::at(width);
    let (m, overflow) = lower_tm_guarded(&program, &enc);
    let sm = SlotMap::of(&program);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(sm.n_slots());
    let (_, final_state, status) = simulate_final(&m, &init, CAPS);
    status == crate::tm::sim::Status::Halted && final_state == overflow
}

/// The two cases from the design spec that NO correctness-based test can catch: at width 4 both
/// programs corrupt the REG bank and still decode to the right answer. `3 - 5` destroys the last
/// field's trailing `#`; `0 + 5` merges two 4-cell fields into one 9-cell run. The guard must report
/// them, so the assertion is on the OUTCOME, not on a value or a tape shape that happens to decode.
#[test]
fn silent_reg_corruption_is_now_reported() {
    assert!(halts_in_overflow("3 - 5", 4), "5 does not fit a 4-cell field");
    assert!(halts_in_overflow("0 + 5", 4), "5 does not fit a 4-cell field");
    // Sufficient width: no overflow, and the answers are right.
    assert!(!halts_in_overflow("3 - 5", 8));
    assert!(!halts_in_overflow("0 + 5", 8));
}

/// The bound is STRICT: a value EXACTLY equal to the width overflows too, because a full field leaves
/// no padding blank for `rewind_home` to stop on. `4 + 0` stores 4, so width 4 must be rejected and
/// width 8 accepted. Without this case a guard that only caught `v > width` would look correct.
#[test]
fn a_value_exactly_equal_to_the_width_overflows() {
    assert!(halts_in_overflow("4 + 0", 4), "v == width leaves no padding blank");
    assert!(!halts_in_overflow("4 + 0", 8));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::silent_reg 2>&1 | tail -20`
Expected: FAIL — `assertion failed: halts_in_overflow("3 - 5", 4)`. Today the program halts normally
having corrupted the bank.

- [ ] **Step 3: Add the guard rule**

In `crates/redextape-core/src/tm/encoding.rs`, in `append_work_to_field`, replace the write-loop block:

```rust
    // Write one REG mark per WORK mark, advancing both heads; stop at WORK's trailing blank.
    let wr = b.state(format!("{label}.wr"));
    b.add_rule(start, RuleSpec::new(), wr);
    // GUARD (must stay FIRST — rule lookup is first-match-wins and `validate()` has no overlap check).
    // The window was blanked before this loop and the head entered on the field's first cell, so the
    // head can only read the field's TRAILING `#` by having walked off the end: the value does not fit.
    // Reading `#` regardless of WORK covers both overflow shapes at once — `v > width` arrives here
    // with WORK still holding marks, `v == width` with WORK exactly exhausted (the `rewind_home`
    // miscount described on `MAX_FIELD_WIDTH`). A separate `v == width` arm is therefore unnecessary,
    // and a guard that read WORK would miss exactly that case.
    let overflow = b.overflow();
    b.add_rule(wr, RuleSpec::new().on(REG, Some(SEP), None, Move::S), overflow);
    b.add_rule(wr, RuleSpec::new().on(WORK, Some(MARK), None, Move::R).on(REG, None, Some(MARK), Move::R), wr);
    let rin = b.state(format!("{label}.rin"));
    b.add_rule(wr, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S), rin); // WORK exhausted -> done
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -q -p redextape-core --lib tm::lower_tm 2>&1 | grep -E "^test result|FAILED" | head`
Expected: PASS.

Run: `cargo test -q -p redextape-core 2>&1 | grep -E "^test result|FAILED|panicked" | head -20`
Expected: all pass, 381 total.

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::tm_step_count 2>&1 | tail -5`
Expected: PASS — goldens unchanged. **If any golden moved, the guard is matching on the good path;
stop and fix the rule rather than re-blessing the number.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(tm): guard the universal REG store against a value that does not fit

append_work_to_field is the single path by which mov, arith, compare,
pop_frame_restore, cons, head/tail, is_empty and the box ops all write a value
into a register field. One rule at its write loop -- REG reads the trailing #,
regardless of WORK -- catches both overflow shapes: v > width arrives with WORK
still holding marks, v == width with WORK exactly exhausted (the rewind_home
miscount). A guard that read WORK would miss the second.

Pins the two cases no correctness-based test can see: at width 4, '3 - 5'
destroys a field delimiter and '0 + 5' merges two fields into a 9-cell run, and
both still decode to the right answer. Both now report overflow.

Step goldens are unchanged, which is the check that the rule never matches on
the good path."
```

---

### Task 4: Guard `write_literal`

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/unary.rs`'s `write_literal`
- Test: `crates/redextape-core/src/tm/lower_tm.rs`

**Interfaces:**
- Consumes: `halts_in_overflow` (Task 3), `Builder::overflow` (Task 2).
- Produces: no new API.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm/lower_tm.rs`'s test module:

```rust
/// A literal too large for the field is known at BUILD time — `n` is a compile-time constant — so the
/// guard is static: the instruction routes straight to the overflow state and emits no write chain at
/// all. `41` is stored directly by `let x = 41; x`, so widths 4 through 32 must all report overflow
/// and 64 must not.
#[test]
fn an_oversized_literal_is_rejected_statically() {
    for w in [4usize, 8, 16, 32] {
        assert!(halts_in_overflow("let x = 41; x", w), "41 must not fit a {w}-cell field");
    }
    assert!(!halts_in_overflow("let x = 41; x", 64));
}

/// The static check uses the same STRICT bound as the runtime one: a literal exactly equal to the
/// width does not fit.
#[test]
fn a_literal_exactly_equal_to_the_width_is_rejected() {
    assert!(halts_in_overflow("let x = 8; x", 8));
    assert!(!halts_in_overflow("let x = 7; x", 8));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::an_oversized 2>&1 | tail -20`
Expected: FAIL at `w = 4` — today the literal is written unconditionally, clobbering the delimiter, and
the program halts normally.

- [ ] **Step 3: Add the static guard**

In `crates/redextape-core/src/tm/encoding.rs`, at the top of `write_literal`'s body, before
`let base = ...`:

```rust
        // STATIC guard: `n` is a compile-time constant, so an unrepresentable literal needs no runtime
        // check — route the instruction straight to the guard and emit no write chain at all. The bound
        // is the same STRICT one the runtime guard uses (`n == width` leaves no padding blank).
        if n >= self.width as u64 {
            let overflow = b.overflow();
            b.add_rule(entry, RuleSpec::new(), overflow);
            return;
        }
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -q -p redextape-core 2>&1 | grep -E "^test result|FAILED|panicked" | head -20`
Expected: all pass, 383 total.

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::tm_step_count 2>&1 | tail -5`
Expected: PASS — goldens unchanged (every golden's literals are `< 64`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(tm): reject an unrepresentable literal statically

write_literal's mark chain is unrolled from a compile-time n, so an oversized
literal needs no runtime check: route the instruction to the overflow guard and
emit no chain. Same strict bound as the runtime guard -- n == width leaves no
padding blank -- which the test pins directly rather than assuming."
```

---

### Task 5: Guard the BOX tape

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding/unary.rs`'s `box_append_field`
- Modify: `crates/redextape-core/src/tm/encoding/unary.rs`'s `box_overwrite_field` (— restructured)
- Test: `crates/redextape-core/src/tm/lower_tm.rs`

**Interfaces:**
- Consumes: `halts_in_overflow` (Task 3), the `width` parameters added in Task 1.
- Produces: `box_overwrite_field(b, from, label, width)` — gains a `width` parameter, since it becomes a
  counted chain. Its one caller is `Unary::box_set_op`, which passes `self.width`.

Read design spec §3, "Why `box_overwrite_field` is restructured rather than given a rule", first.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm/lower_tm.rs`'s test module:

```rust
/// The BOX tape is the machine's other fixed-width storage, so it needs its own guard. A
/// mutable-capture closure boxes `c` and writes back through it, exercising both box_append_field
/// (the allocation) and box_overwrite_field (the `c = c + x` store).
#[test]
fn box_writes_are_guarded() {
    let src = "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 5) + c";
    assert!(halts_in_overflow_defunc(src, 4), "5 does not fit a 4-cell box field");
    assert!(!halts_in_overflow_defunc(src, 16));
}

/// As `halts_in_overflow`, but for a higher-order program that must be defunctionalized first.
#[cfg(test)]
fn halts_in_overflow_defunc(src: &str, width: usize) -> bool {
    use crate::tm::sim::simulate_final;
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let defunced = crate::tm::defunc::defunc(&core).expect("defuncs");
    let program = lower_asm(&defunced).expect("lowers");
    let enc = Unary::at(width);
    let (m, overflow) = lower_tm_guarded(&program, &enc);
    let sm = SlotMap::of(&program);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(sm.n_slots());
    let (_, final_state, status) = simulate_final(&m, &init, CAPS);
    status == crate::tm::sim::Status::Halted && final_state == overflow
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::box_writes 2>&1 | tail -20`
Expected: FAIL — the program halts normally at width 4.

- [ ] **Step 3: Guard `box_append_field`**

In `crates/redextape-core/src/tm/encoding.rs`, in `box_append_field`, replace the window loop:

```rust
    // Fixed-width window: `width` cells. MARK arm copies a WORK mark (both heads R); once WORK is
    // exhausted the BLANK arm pads (BOX writes a blank, advances; WORK stays on its trailing blank).
    let overflow = b.overflow();
    for k in 0..width {
        let nxt = b.state(format!("{label}.w{}", k + 1));
        // GUARD (must stay FIRST) at the LAST window cell only. Reaching cell `width - 1` with WORK
        // still on a MARK means `width - 1` marks have already been copied and at least one remains,
        // i.e. `v >= width` — the field would be left with no padding blank, which is exactly what
        // `box_read_field_to_work` relies on to find the field's end.
        if k + 1 == width {
            b.add_rule(cur, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), overflow);
        }
        b.add_rule(cur, RuleSpec::new().on(WORK, Some(MARK), None, Move::R).on(BOX, None, Some(MARK), Move::R), nxt);
        b.add_rule(cur, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S).on(BOX, None, Some(BLANK), Move::R), nxt);
        cur = nxt;
    }
```

- [ ] **Step 4: Restructure `box_overwrite_field` to a counted chain**

Replace `box_overwrite_field` entirely:

```rust
/// Overwrite the field under the BOX head with WORK's marks, IN PLACE (the `#` delimiters never move).
/// `from`: BOX on the field's first cell, WORK home over the new value's marks. Writes one MARK per WORK
/// mark, then blanks any leftover old marks, then walks left to the leading `#` and steps right onto the
/// first cell; then rewinds WORK home.
///
/// COUNTED, not content-driven, and this matters: BOX fields have no trailing `#` after the LAST one —
/// the top is a blank — so a content-driven overflow on the last field would spill into the top blank
/// with no delimiter to hit. The corruption would then surface only later, when the next
/// `box_skip_field_right` lands mid-spill and reads a `MARK` where it expects `#` or blank, and goes
/// stuck-silent. A `width`-long chain makes the guard uniform with `box_append_field` and matches the
/// tape it writes to, whose navigation is fixed-width everywhere else.
fn box_overwrite_field(b: &mut Builder, from: StateId, label: &str, width: usize) -> StateId {
    let overflow = b.overflow();
    let mut cur = b.state(format!("{label}.w0"));
    b.add_rule(from, RuleSpec::new(), cur);
    // Phase 1: `width` cells, one per window cell. Copy a WORK mark, or (once WORK is exhausted) erase
    // whatever old content is there — so the whole window is rewritten, exactly as the old blanking
    // pass did, without needing a delimiter to stop on.
    for k in 0..width {
        let nxt = b.state(format!("{label}.w{}", k + 1));
        // GUARD (must stay FIRST) — see `box_append_field`; `v >= width` leaves no padding blank.
        if k + 1 == width {
            b.add_rule(cur, RuleSpec::new().on(WORK, Some(MARK), None, Move::S), overflow);
        }
        b.add_rule(cur, RuleSpec::new().on(WORK, Some(MARK), None, Move::R).on(BOX, None, Some(MARK), Move::R), nxt);
        b.add_rule(cur, RuleSpec::new().on(WORK, Some(BLANK), None, Move::S).on(BOX, None, Some(BLANK), Move::R), nxt);
        cur = nxt;
    }
    // Phase 2: the head is one cell past the window. Walk left over the field's content to the leading
    // `#`, then step right onto the first cell.
    let restore = b.state(format!("{label}.rs"));
    b.add_rule(cur, RuleSpec::new().on(BOX, None, None, Move::L), restore);
    b.add_rule(restore, RuleSpec::new().on(BOX, Some(MARK), None, Move::L), restore);
    b.add_rule(restore, RuleSpec::new().on(BOX, Some(BLANK), None, Move::L), restore);
    let first = b.state(format!("{label}.fc"));
    b.add_rule(restore, RuleSpec::new().on(BOX, Some(SEP), None, Move::R), first); // leading `#` -> first cell
    rewind_work(b, first, label) // WORK head on its tail -> home, marks intact
}
```

Update its single caller, `Unary::box_set_op`, to pass `self.width`.

- [ ] **Step 5: Run the tests**

Run: `cargo test -q -p redextape-core 2>&1 | grep -E "^test result|FAILED|panicked" | head -20`
Expected: all pass, 384 total. In particular the existing box round-trip tests in `encoding.rs` and
`box_program_runs_end_to_end_on_the_tm` in `lower_tm.rs` must still pass — they exercise the restructured
`box_overwrite_field` at the default width.

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::tm_step_count 2>&1 | tail -5`
Expected: PASS. (None of the four goldens uses a box, so this is a regression check on Task 1's threading
rather than on this task.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(tm): guard the BOX tape, and make box_overwrite_field counted

box_append_field gets one rule at its last window cell: WORK still on a MARK
there means v >= width. box_overwrite_field gets the same rule, but only after
being restructured from content-driven to a width-long counted chain -- BOX
fields have no trailing # after the LAST one, so a content-driven overflow
there spills into the top blank with no delimiter to hit, and only surfaces
later when box_skip_field_right lands mid-spill and goes stuck-silent.

Counted also matches the tape it writes to: BOX navigation is content-blind and
fixed-width everywhere else, for the same reason (a zero-valued field is
indistinguishable from the boundary by a single read)."
```

---

### Task 6: `TmRun::Overflow` and the auto-fit loop

**Files:**
- Modify: `crates/redextape-core/src/tm.rs:40-102` (`TmRun`, `run_tm`)
- Modify: every exhaustive `match` on `TmRun` the compiler reports
- Test: `crates/redextape-core/src/tm.rs` (`#[cfg(test)] mod run_tm_tests`)

**Interfaces:**
- Consumes: `lower_tm_guarded`, `simulate_final` (Task 2); all four guards (Tasks 3–5);
  `Encoding::{field_width, at_width}`, `MIN_FIELD_WIDTH`, `MAX_FIELD_WIDTH` (Task 1).
- Produces: `TmRun::Overflow`; `run_tm(core, enc, caps) -> TmRun` (auto-fitting);
  `run_tm_fitted(core, enc, caps) -> (TmRun, Option<usize>)`; `run_tm_at(core, enc, caps) -> TmRun`.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm.rs`'s `#[cfg(test)] mod run_tm_tests`:

```rust
/// Auto-fit settles on the narrowest power-of-two width at which nothing overflows, and the answer is
/// the same one the default 64-wide bank gives. The widths are the interesting assertion: a program
/// storing 7 must not be run on a 64-cell bank.
#[test]
fn run_tm_auto_fits_the_width_per_program() {
    fn fitted(src: &str) -> (Value, Option<usize>) {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let expected = crate::run(src).expect("reference run failed");
        let (run, width) = run_tm_fitted(&core, &Unary::default(), TM_DEFAULT_CAPS);
        match run {
            TmRun::Ran { tapes } => (decode_tape(&tapes, &expected, &Unary::default()).expect("decode"), width),
            other => panic!("tm did not run: {other:?}"),
        }
    }
    assert_eq!(fitted("1 + 2 * 3"), (Value::Nat(7), Some(8)));
    assert_eq!(fitted("3 - 5"), (Value::Nat(0), Some(8)));
    assert_eq!(fitted("let x = 40; x + 2"), (Value::Nat(42), Some(64)));
    assert_eq!(fitted("[1, 2, 3]"), (Value::list_of_nats(&[1, 2, 3]), Some(4)));
}

/// A value the tape cannot represent at ANY width up to the ceiling is now REPORTED. Today this
/// silently miscompiles: the bank is corrupted and a wrong answer comes back.
#[test]
fn a_value_beyond_the_ceiling_reports_overflow() {
    let (prog, ds) = parse("100 * 100");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    assert!(matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::Overflow));
}

/// `run_tm_at` does NOT search: it runs once at the encoding's own width, which is what the step
/// goldens and the attribution survey need in order to stay comparable across slices.
#[test]
fn run_tm_at_pins_the_width() {
    let (prog, ds) = parse("1 + 2 * 3");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    assert!(matches!(run_tm_at(&core, &Unary::at(4), TM_DEFAULT_CAPS), TmRun::Overflow));
    assert!(matches!(run_tm_at(&core, &Unary::at(8), TM_DEFAULT_CAPS), TmRun::Ran { .. }));
}

/// Divergence must NOT be mistaken for a too-narrow field and retried: `head(nil)` spins to a cap at
/// every width, and auto-fit must report that rather than climbing to 64 and reporting Overflow.
#[test]
fn divergence_is_not_retried_as_an_overflow() {
    let (prog, ds) = parse("head(nil)");
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let (run, width) = run_tm_fitted(&core, &Unary::default(), TmCaps { steps: 50_000, cells: 50_000 });
    assert!(matches!(run, TmRun::HitCap), "a deref fault spins to a cap, it does not overflow");
    assert_eq!(width, Some(MIN_FIELD_WIDTH), "and it must not have been retried at a wider bank");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -q -p redextape-core --lib tm::run_tm_tests 2>&1 | tail -20`
Expected: FAIL to COMPILE — `no variant named 'Overflow'`, `cannot find function 'run_tm_fitted'`.

- [ ] **Step 3: Add the variant and the loop**

In `crates/redextape-core/src/tm.rs`, add to `TmRun`:

```rust
    /// A value did not fit the encoding's field width at ANY width up to `MAX_FIELD_WIDTH` — the
    /// program is not representable on this tape. Distinct from `HitCap`: nothing diverged, the tape
    /// is simply too narrow, which is a property of the encoding and not of the program's semantics.
    Overflow,
```

Replace `run_tm` with:

```rust
/// One attempt at `enc`'s own width: lower, lay out the bank, simulate, and classify the halt.
fn attempt(prog: &Program, enc: &dyn Encoding, sm: &SlotMap, caps: TmCaps) -> TmRun {
    let (machine, overflow) = lower_tm_guarded(prog, enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(sm.n_slots());
    match simulate_final(&machine, &init, caps) {
        (_, s, TmStatus::Halted) if s == overflow => TmRun::Overflow,
        (tapes, _, TmStatus::Halted) => TmRun::Ran { tapes },
        (_, _, TmStatus::HitCap) => TmRun::HitCap,
    }
}

/// Lower, then run at the narrowest field width that fits, reporting that width alongside the outcome.
///
/// Attempts `MIN_FIELD_WIDTH`, doubling, up to `MAX_FIELD_WIDTH`; an attempt that halts in the overflow
/// guard is retried one width wider, anything else is the answer. Reaching the ceiling and still
/// overflowing yields `TmRun::Overflow`. An encoding reporting `field_width() == None` is unbounded, so
/// there is exactly one attempt and the reported width is `None`.
///
/// The retries are cheap BECAUSE of the guard: a too-narrow attempt runs the correct prefix of the
/// program and then halts at its first overflowing store, so it costs less than the successful attempt
/// that follows it. Without the guard an under-sized run corrupts the bank and frequently runs away to
/// the full step cap instead, which is what made the pre-guard behaviour expensive as well as wrong.
pub fn run_tm_fitted(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> (TmRun, Option<usize>) {
    let prog = match lower_program(core) {
        Ok(p) => p,
        Err(e) => return (TmRun::LowerError(e), None),
    };
    let sm = SlotMap::of(&prog);
    // Mirrors `lower_tm`'s own guard: an absurd register index would drive `init_reg` into a huge or
    // aborting allocation. An unrepresentable program is a resource-cap outcome, not a panic.
    if sm.n_slots() > crate::tm::lower_tm::MAX_SLOTS {
        return (TmRun::HitCap, None);
    }
    if enc.field_width().is_none() {
        return (attempt(&prog, enc, &sm, caps), None);
    }
    let mut width = MIN_FIELD_WIDTH;
    loop {
        let fitted = enc.at_width(width);
        match attempt(&prog, &*fitted, &sm, caps) {
            TmRun::Overflow if width < MAX_FIELD_WIDTH => width = (width * 2).min(MAX_FIELD_WIDTH),
            other => return (other, Some(width)),
        }
    }
}

/// Lower then simulate, auto-fitting the field width per program. The convenience entry point for the
/// oracle. Panic-free and bounded by `caps` (per attempt).
pub fn run_tm(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun {
    run_tm_fitted(core, enc, caps).0
}

/// Lower then simulate ONCE, at `enc`'s own width, with no search. What the step-count goldens and the
/// attribution survey use, so their numbers stay comparable across slices even as auto-fit changes what
/// a program costs end to end.
pub fn run_tm_at(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun {
    let prog = match lower_program(core) {
        Ok(p) => p,
        Err(e) => return TmRun::LowerError(e),
    };
    let sm = SlotMap::of(&prog);
    if sm.n_slots() > crate::tm::lower_tm::MAX_SLOTS {
        return TmRun::HitCap;
    }
    attempt(&prog, enc, &sm, caps)
}
```

Add the needed imports at the top of the `use` block in `tm.rs`:
`use crate::tm::asm::Program;` and `use crate::tm::lower_tm::SlotMap;` (the latter is already there).

- [ ] **Step 4: Fix every exhaustive match**

Run: `cargo build --workspace 2>&1 | grep -E "^error" -A 6 | head -40`
Add an `TmRun::Overflow` arm wherever the compiler reports a non-exhaustive match. In test files the
correct arm is the same as the existing `TmRun::HitCap` arm's (a panic or an explicit failure) unless
the test is specifically about overflow.

- [ ] **Step 5: Run the tests**

Run: `cargo test -q --workspace 2>&1 | grep -E "^test result|FAILED|panicked" | head -30`
Expected: all pass. `redextape-core` at 388.

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::tm_step_count 2>&1 | tail -5`
Expected: PASS — the goldens call `lower_tm` directly, not `run_tm`, so auto-fit cannot reach them.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(tm): run_tm auto-fits the field width per program

Attempts 4, 8, 16, 32, 64, retrying only on the overflow guard. run_tm_fitted
reports the width it settled on; run_tm_at pins a width with no search, which
is what the step goldens and the attribution survey use so their numbers stay
comparable across slices.

TmRun::Overflow is new and is a correctness fix, not just a variant: a value
beyond the 64 ceiling used to corrupt the bank and return a wrong answer.
'100 * 100' now reports Overflow.

Divergence is not confused with a narrow bank -- a deref fault spins to a cap,
which is not the guard, so head(nil) reports HitCap at the FIRST width rather
than climbing to 64 first. Pinned by a test, because the retry loop would be
both wrong and slow if it retried caps."
```

---

### Task 7: The completeness layers — guard position, bank invariant, sabotage

**Files:**
- Create: `crates/redextape-core/tests/tm_bank_invariant.rs`
- Modify: `crates/redextape-core/src/tm/sim.rs` (a step-callback simulate variant)
- Modify: `crates/redextape-core/src/tm/encoding.rs` (a test asserting guard rule position)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `simulate_watched(m, init, caps, watch: &mut dyn FnMut(&[Tape]) -> bool) -> (Vec<Tape>, StateId, Status)`
  — `watch` is called after every applied step and returns `false` to stop the run.

Read design spec §4 first. This task is layers 2 and 3 and the sabotage mutants.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/tm_bank_invariant.rs`:

```rust
//! Layer 3 of the overflow guard's completeness argument (design spec §4): rather than trusting the
//! enumeration of write sites, assert the PROPERTY those sites exist to preserve — that the REG and BOX
//! banks stay well-formed — after every single step, over the whole corpus at every width.
//!
//! This is what catches corruption from a write site nobody enumerated, from a guard silently disabled
//! by rule ordering, or from a boundary case derived wrong. It does not depend on any of those being
//! right.

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{
    BLANK, MARK, REG, SEP, TAPES, TM_DEFAULT_CAPS, TmStatus, Unary, defunc, lower_asm, lower_tm_guarded,
    simulate_watched,
};

/// A representative spread of the survey corpus: arithmetic, while, recursion, lists, higher-order,
/// mutual recursion and mutable capture.
const CORPUS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "[1, 2, 3]",
    "head(tail(cons(1, cons(2, nil))))",
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 5) + c",
];

/// The REG bank must be `#` then, per slot, exactly `width` cells of marks-then-blanks, then `#`.
/// Returns `Err(reason)` on the first violation.
fn reg_bank_is_well_formed(cells: &[char], width: usize, slots: usize) -> Result<(), String> {
    if cells.first() != Some(&SEP) {
        return Err(format!("bank must start with `{SEP}`, got {:?}", cells.first()));
    }
    if cells.len() != 1 + slots * (width + 1) {
        return Err(format!("bank is {} cells, expected {}", cells.len(), 1 + slots * (width + 1)));
    }
    for s in 0..slots {
        let field = &cells[1 + s * (width + 1)..1 + s * (width + 1) + width];
        let marks = field.iter().take_while(|&&c| c == MARK).count();
        if !field[marks..].iter().all(|&c| c == BLANK) {
            return Err(format!("field {s} is not marks-then-blanks: {:?}", field.iter().collect::<String>()));
        }
        if cells[1 + s * (width + 1) + width] != SEP {
            return Err(format!("field {s} is not closed by `{SEP}`"));
        }
    }
    Ok(())
}

#[test]
fn the_reg_bank_stays_well_formed_at_every_step_and_every_width() {
    for src in CORPUS {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
        let core = desugar(&prog.unwrap());
        let program = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => lower_asm(&defunc(&core).expect("defuncs")).expect("lowers after defunc"),
        };
        for width in [4usize, 8, 16, 32, 64] {
            let enc = Unary::at(width);
            let (m, _overflow) = lower_tm_guarded(&program, &enc);
            let init_reg = enc.init_reg(slots_of(&init_reg_len(&enc, &program)));
            let slots = (init_reg.len() - 1) / (width + 1);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = init_reg;

            let mut step = 0usize;
            let mut failure: Option<String> = None;
            let mut watch = |tapes: &[redextape_core::tm::Tape]| {
                step += 1;
                let (cells, _) = tapes[REG].snapshot();
                match reg_bank_is_well_formed(&cells, width, slots) {
                    Ok(()) => true,
                    Err(why) => {
                        failure = Some(format!("`{src}` at width {width}, step {step}: {why}"));
                        false
                    }
                }
            };
            let (_, _, status) = simulate_watched(&m, &init, TM_DEFAULT_CAPS, &mut watch);
            assert!(failure.is_none(), "{}", failure.unwrap());
            assert!(
                matches!(status, TmStatus::Halted | TmStatus::HitCap),
                "`{src}` at width {width} must reach a defined outcome"
            );
        }
    }
}
```

Note for the implementer: `slots_of` / `init_reg_len` above are placeholders for whatever the crate
exposes. `SlotMap` is `pub(crate)`, so an integration test cannot call it — derive `slots` from the
`init_reg` length instead, as the body already does: `slots = (init_reg.len() - 1) / (width + 1)`. Build
`init_reg` by asking the encoding for a bank sized to the program's slot count, which the test obtains by
calling `redextape_core::tm::lower_tm_guarded` and reading `m` — **simplest correct approach: add a
`pub fn n_slots_of(prog: &Program) -> u32` to `lower_tm.rs`** re-exported from `tm.rs`, and use it here.
Do that rather than reverse-engineering the length.

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -q -p redextape-core --test tm_bank_invariant 2>&1 | tail -20`
Expected: FAIL to COMPILE — `cannot find function 'simulate_watched'`, `cannot find function 'n_slots_of'`.

- [ ] **Step 3: Add `simulate_watched` and `n_slots_of`**

In `crates/redextape-core/src/tm/sim.rs`, add a `watch` parameter to the shared `run` loop — called
directly after `apply(rule, &mut tapes)`, stopping the run when it returns `false` — and expose:

```rust
/// Simulate, calling `watch` with the tapes after every applied step; a `false` return stops the run
/// (reported as `Status::Halted`, since the machine did not hit a cap). The hook exists for invariant
/// checking: it is how a test asserts a property of every intermediate configuration rather than only
/// of the final one.
pub fn simulate_watched(
    m: &Machine,
    init: &[Vec<Symbol>],
    caps: Caps,
    watch: &mut dyn FnMut(&[Tape]) -> bool,
) -> (Vec<Tape>, StateId, Status) {
    run(m, init, caps, None, None, Some(watch))
}
```

Update `run`'s signature with a sixth `watch: Option<&mut dyn FnMut(&[Tape]) -> bool>` parameter and pass
`None` from `simulate`, `simulate_trace`, `simulate_counts`, `simulate_final`.

In `crates/redextape-core/src/tm/lower_tm.rs`:

```rust
/// The number of REG-bank fields `prog` needs — the argument `init_reg` expects. Public because a
/// caller laying out a bank by hand (an invariant test, a visualizer) needs it and `SlotMap` is
/// crate-internal.
pub fn n_slots_of(prog: &Program) -> u32 {
    SlotMap::of(prog).n_slots()
}
```

Re-export `simulate_watched` and `n_slots_of` from `tm.rs`, and rewrite the test's bank setup to:

```rust
            let slots = redextape_core::tm::n_slots_of(&program);
            let init_reg = enc.init_reg(slots);
            let slots = slots as usize;
```

- [ ] **Step 4: Add the layer-2 positional test**

Add to `crates/redextape-core/src/tm/encoding.rs`'s `#[cfg(test)] mod tests`:

```rust
/// Layer 2 (design spec §4): a guard only fires if it is matched BEFORE the rules it shadows — rule
/// lookup is first-match-wins and `validate()` has no overlap check, the hazard already documented at
/// `append_field_to_work`. Assert the position directly, because moving the rule to the end is a
/// silent disable that every behavioural test would still pass at a sufficient width.
#[test]
fn every_guard_rule_is_first_in_its_state() {
    let mut b = Builder::new();
    let entry = b.state("entry");
    let exit = b.accept("exit");
    let enc = Unary::at(8);
    enc.mov(&mut b, entry, exit, 0, 1); // reaches append_work_to_field
    let overflow = b.overflow_state().expect("mov must have requested the guard");
    let m = b.finish(entry);

    let guard_states: Vec<_> = m
        .states
        .iter()
        .enumerate()
        .filter(|(_, s)| s.rules.iter().any(|r| r.next == overflow))
        .collect();
    assert!(!guard_states.is_empty(), "mov must contain at least one guarded state");
    for (id, s) in guard_states {
        assert_eq!(
            s.rules[0].next, overflow,
            "state {id} (`{}`) routes to the guard, but not from its FIRST rule — a later rule can \
             shadow it and the guard silently stops firing",
            s.name
        );
    }
}
```

- [ ] **Step 5: Add the sabotage tests**

Add to `crates/redextape-core/tests/tm_bank_invariant.rs`:

```rust
/// SABOTAGE: an unguarded write site. Layer 3 must catch corruption it did not know about — otherwise
/// it is passing only because the four enumerated guards already caught everything, and it would not
/// notice a fifth site added by a later slice.
///
/// Rather than editing the encoding, this builds a machine by hand whose only job is to write more
/// marks into a field than it can hold, exactly as an unguarded gadget would.
#[test]
fn the_invariant_catches_an_unguarded_write() {
    use redextape_core::tm::{Builder, Move, RuleSpec, simulate_watched};

    let width = 4usize;
    let enc = Unary::at(width);
    let mut b = Builder::new();
    let start = b.state("start");
    let halt = b.accept("halt");
    // Step off the leading `#`, then write width+1 marks rightward — one past the window, destroying
    // the field's trailing `#`. This is precisely what an unguarded `append_work_to_field` does.
    let mut cur = b.state("w0");
    b.add_rule(start, RuleSpec::new().on(REG, Some(SEP), None, Move::R), cur);
    for k in 0..=width {
        let nxt = b.state(format!("w{}", k + 1));
        b.add_rule(cur, RuleSpec::new().on(REG, None, Some(MARK), Move::R), nxt);
        cur = nxt;
    }
    b.add_rule(cur, RuleSpec::new(), halt);
    let m = b.finish(start);

    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(2);
    let mut caught = false;
    let mut watch = |tapes: &[redextape_core::tm::Tape]| {
        let (cells, _) = tapes[REG].snapshot();
        if reg_bank_is_well_formed(&cells, width, 2).is_err() {
            caught = true;
            return false;
        }
        true
    };
    simulate_watched(&m, &init, TM_DEFAULT_CAPS, &mut watch);
    assert!(caught, "the bank invariant must catch a write site no guard knows about");
}
```

- [ ] **Step 6: Run the tests**

Run: `cargo test -q -p redextape-core 2>&1 | grep -E "^test result|FAILED|panicked" | head -30`
Expected: all pass.

Manual sabotage check — perform, observe, then REVERT each:

1. In `append_work_to_field`, move the guard `add_rule` to *after* the two loop rules. Run
   `cargo test -q -p redextape-core --lib tm::encoding::tests::every_guard_rule_is_first 2>&1 | tail -5`.
   Expected: FAIL. Revert.
2. Delete the guard `add_rule` in `append_work_to_field` entirely. Run
   `cargo test -q -p redextape-core --lib tm::lower_tm::tests::silent_reg 2>&1 | tail -5`.
   Expected: FAIL. Revert.
3. Delete the `box_append_field` guard. Run
   `cargo test -q -p redextape-core --lib tm::lower_tm::tests::box_writes 2>&1 | tail -5`.
   Expected: FAIL. Revert.

Confirm the working tree is clean before committing: `git diff --stat`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test(tm): assert the guard's completeness instead of arguing it

The guard-site table is an argument from enumeration -- sound only if those are
all the sites, which is true today and decays silently. Two layers that do not
rest on that audit:

Layer 2 asserts each guard rule is FIRST in its state. Lookup is
first-match-wins and validate() has no overlap check, so moving a guard to the
end is a silent disable that every behavioural test still passes at a
sufficient width.

Layer 3 (simulate_watched + tm_bank_invariant.rs) validates REG bank
well-formedness after EVERY step, over the corpus at widths 4/8/16/32/64. It
catches corruption from an unenumerated site, a guard disabled by ordering, or
a boundary case derived wrong. Its own sabotage test builds a machine that
writes one mark past a field, so layer 3 is checked for doing its job rather
than passing because the guards already caught everything.

Honest limit: layer 3 is corpus-bounded, an observation over programs actually
run, not a proof over all programs."
```

---

### Task 8: The width report, and the survey's fitted column

**Files:**
- Create: `crates/redextape-core/examples/width_report.rs`
- Modify: `crates/redextape-core/examples/step_survey.rs` (add a fitted-width section)

**Interfaces:**
- Consumes: `run_tm_fitted`, `run_tm_at`, `Unary::at`, `MIN_FIELD_WIDTH`, `MAX_FIELD_WIDTH`.
- Produces: no library API.

- [ ] **Step 1: Write the report**

Create `crates/redextape-core/examples/width_report.rs`. It must, for each program in the corpus (copy
`CORPUS` from `tests/tm_bank_invariant.rs`), print:

1. the affine fit `a + b·W` obtained by running at two widths and solving, plus the padding share
   `b·64 / steps(64)` as a percentage;
2. the fitted width `run_tm_fitted` settles on;
3. `steps(fitted)` versus `steps(64)` and the ratio.

Step counts come from `attribute`-style simulation at a pinned width; use `run_tm_at` plus
`simulate_counts` summed, or reuse `attribute`. Header comment must state that this supersedes the
estimated table in the design spec, and that the numbers are corpus-bounded.

- [ ] **Step 2: Run it**

Run: `cargo run --release --quiet --example width_report -p redextape-core`
Expected: a table with no `WRONG` or `Overflow` rows at the fitted widths, and every padding share
between 60% and 99%.

- [ ] **Step 3: Add the survey's fitted column**

In `crates/redextape-core/examples/step_survey.rs`, add a section that prints, per Part A program, the
pinned-64 step count (unchanged, what the existing report measures) alongside the fitted width and its
step count — and a closing line stating whether the pass ranking computed at width 64 is preserved at
fitted widths, computed rather than asserted.

Leave every existing number in `step_survey.rs` pinned at 64 via `run_tm_at` / the existing `attribute`
path. The `(src, steps)` goldens at lines 222-228 must not change.

- [ ] **Step 4: Run both**

Run: `cargo run --release --quiet --example step_survey -p redextape-core 2>&1 | head -60`
Expected: the existing report is byte-identical in its Part A numbers, with the new section appended.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(tm): width_report makes the sizing experiment reproducible

The field-width sweep that motivated this slice was run by editing a constant
and rebuilding eleven times. width_report does it at runtime via Unary::at(w):
per program, the affine fit a + b*W, the padding share at width 64, the width
auto-fit settles on, and the speedup against 64. It supersedes the estimated
table in the design spec, whose fitted widths were inferred from answer
agreement -- an unsound detector, which is the finding that motivated the guard
in the first place.

step_survey gains the same fitted column and computes whether the pass ranking
measured at width 64 survives sizing, rather than assuming it does. Its own
numbers stay pinned at 64 so they remain comparable with what is on main."
```

---

### Task 9: Close the native ceiling comment, and verify the whole slice

**Files:**
- Modify: `crates/redextape-native/tests/native_oracle.rs:281-330` (`BEYOND_FIELD_WIDTH_DEMOS`)
- Modify: `docs/superpowers/specs/2026-07-26-per-program-field-width-design.md` (status line)

**Interfaces:**
- Consumes: `TmRun::Overflow`, `run_tm` (Task 6).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

In `crates/redextape-native/tests/native_oracle.rs`, inside the test that iterates
`BEYOND_FIELD_WIDTH_DEMOS`, add an assertion that the TM reports the ceiling rather than a value:

```rust
        // The TM's side of this claim, which until now was only a comment. A value beyond
        // MAX_FIELD_WIDTH used to corrupt the register bank and hand back a WRONG answer; the overflow
        // guard makes the ceiling an outcome the caller can see.
        let core = core_of(src);
        assert!(
            matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::Overflow),
            "the TM must REPORT that it cannot represent this, not miscompile it: {src}"
        );
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cargo test -q -p redextape-native --test native_oracle 2>&1 | grep -E "^test result|FAILED" | head`
Expected: PASS (the guard from Task 6 already makes this true; the assertion is what pins it).

If any demo reports `HitCap` instead, that demo diverges rather than overflowing — move it out of
`BEYOND_FIELD_WIDTH_DEMOS` or assert `HitCap` for it explicitly, and say which in the commit message.

- [ ] **Step 3: Full-workspace verification**

Run: `cargo test -q --workspace 2>&1 | grep -E "^test result|FAILED|panicked"`
Expected: all pass, zero failures.

Run: `cargo clippy --workspace --all-targets -- -D warnings 2>&1 | tail -20`
Expected: no warnings.

Run: `cargo fmt --check 2>&1 | head`
Expected: no output.

Run: `cargo test -q -p redextape-core --lib tm::lower_tm::tests::tm_step_count 2>&1 | tail -5`
Expected: PASS — final confirmation that `5724 / 2174 / 2300 / 239_971` never moved across the whole slice.

- [ ] **Step 4: Mark the spec implemented**

Change the spec's status line to:
`> **Status:** implemented (2026-07-26). See `docs/superpowers/plans/2026-07-26-per-program-field-width.md`.`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(native): the TM's FIELD_WIDTH ceiling is asserted, not just documented

BEYOND_FIELD_WIDTH_DEMOS existed to show what native can do that the TM cannot,
but only said so in a comment -- the TM leg was never run on them, because
until the overflow guard it would have corrupted its bank and returned a wrong
answer rather than refusing. It now reports TmRun::Overflow, so the claim is a
test.

Closes the slice: full workspace green, clippy clean, and the four step goldens
byte-identical from the first commit to the last."
```

---

## Self-Review

**Spec coverage.** §1 (width as encoding state) → Task 1. §2 (overflow state, `lower_tm_guarded`,
`simulate_final`) → Task 2. §3 four guard sites → Tasks 3, 4, 5. §4 layer 1 (enumeration) → Tasks 3-5;
layer 2 (guard position) → Task 7 step 4; layer 3 (bank invariant) → Task 7 steps 1-3. §5 (auto-fit,
`TmRun::Overflow`, three entry points) → Task 6. "What this disturbs" item 1 (native ceiling) → Task 9;
item 2 (survey stays pinned, fitted column) → Task 8; item 3 (goldens keep their values) → the global
constraint, re-checked in Tasks 1, 2, 3, 4, 5, 6 and 9. Tests 1-8 → Tasks 1-9 as listed. Deliverables:
`width_report.rs` → Task 8.

**Known gap, accepted:** spec test #8 ("retry cost is bounded — total steps across all attempts versus
the final attempt") has no dedicated task. Task 6's `divergence_is_not_retried_as_an_overflow` pins the
behaviour that would make retries expensive (retrying on `HitCap`), which is the failure mode the bound
exists to detect. Add the explicit ratio assertion in Task 8's `width_report` output instead of as a
test, since the number is corpus-dependent and more useful printed than pinned.

**Type consistency check.** `Unary::at(width: usize)`, `field_width() -> Option<usize>`,
`at_width(&self, width: usize) -> Box<dyn Encoding>`, `Builder::overflow(&mut self) -> StateId`,
`Builder::overflow_state(&self) -> Option<StateId>`, `lower_tm_guarded -> (Machine, StateId)`,
`simulate_final -> (Vec<Tape>, StateId, Status)`,
`simulate_watched(.., &mut dyn FnMut(&[Tape]) -> bool) -> (Vec<Tape>, StateId, Status)`,
`n_slots_of(&Program) -> u32`, `run_tm_fitted -> (TmRun, Option<usize>)` — each used consistently in
every later task. `halts_in_overflow(src, width) -> bool` is defined in Task 3 and used in Tasks 4 and 5;
`halts_in_overflow_defunc` is defined in Task 5 and used only there.
