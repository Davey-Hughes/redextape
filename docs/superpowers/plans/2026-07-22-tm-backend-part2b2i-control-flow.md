# TM Backend — Part 2b-2-i: Control Flow → TM State Graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lower a straight-line + branching asm `Program` (no `call`/`ret`, no heap ops) into a genuine multi-tape `Machine`, run it on the Part-2a simulator, and decode the final REG tape back to a `Nat`/`Bool` `Value` — so the TM *actually executes* arithmetic, comparisons, `if`, `let`/`let mut`, `assign`, `while`, and `seq`, agreeing with the reference tree-walker.

**Architecture:** `lower_tm(prog, enc)` builds one **entry state per instruction index** (`pc0`, `pc1`, …); each instruction becomes a **block of states** (a δ-gadget) that flows from its `pc` to a successor `pc` — straight-line instructions fall through to `pc[i+1]`, `jmp`/`jz` become edges to a label's `pc`. Value instructions (`li`/`mov`/arith/compare) delegate to the merged 2b-1 `Encoding` gadgets over the REG/WORK tapes; `jz` tests a field for zero and branches. `run_tm` composes `lower_asm → lower_tm → simulate`; `decode_tape` reads the result field (REG slot 0) guided by the reference value's shape. This slice deliberately excludes `call`/`ret` (Part 2b-2-**ii**) and the heap ops (Part 2b-2-**iii**); the three-way oracle + proptest + goldens land in Part 2b-2-**iv**.

**Tech Stack:** Rust; the merged `tm::{asm, lower_asm, machine, sim, build, encoding}` modules; `proptest` (already a dev-dep) is not needed until 2b-2-iv.

## Global Constraints

Copied verbatim from the design spec (`docs/superpowers/specs/2026-07-22-tm-backend-design.md`) and the `tm-backend-plan3` project memory. Every task's requirements implicitly include this section.

- **Panic-free & total.** `lower_tm` must be **total** on *any* `Program` (never panic, never `unwrap` a program-derived index). Instructions this slice does not yet implement (`Call`/`Ret`/`Nil`/`Cons`/`Head`/`Tail`/`IsEmpty`) wire their `pc` state straight to the halt state (a defensive stop) — they are replaced in 2b-2-ii/iii, and this slice's tests never feed a program containing them.
- **`v < FIELD_WIDTH` STRICT.** A field holds a value `v` as `v` marks + ≥1 padding blank; an exactly-full field breaks `rewind_home` (see the `FIELD_WIDTH` doc in `build.rs`). `FIELD_WIDTH = 64` is ample for this slice's inputs (every intermediate and final value stays well under 64). This is the TM backend's representability bound, analogous to the λ backend's `< ~1500`.
- **`rd` a FRESH temp, distinct from `ra` AND `rb`** for `arith`/`compare`. Distinct asm registers map to distinct slots (see `SlotMap`), and `lower_asm` already emits `ra`/`rb` as fresh locals `≠ dst`, so the slot-level invariant holds for free — do not break it in the slot map.
- **Data symbols only `1` (`MARK`) / `_` (`BLANK`) / `#` (`SEP`).** No new symbols in this slice (`@` arrives with the STACK/HEAP tapes in 2b-2-ii/iii). Every produced `Machine` must satisfy `Machine::validate()` (so it round-trips through the text form) — assert this in tests.
- **Home convention.** REG head on the leading `#`; WORK head at its leftmost (value) cell (blank when empty). Every gadget restores it on exit, so gadgets compose by chaining `entry → exit`. The initial REG tape places the head on the leading `#` (home); WORK/STACK/HEAP start empty (a single blank cell = home).
- **`Rr` is REG slot 0.** The whole program's result lands in `Rr`; `decode_tape` reads slot 0. This is fixed convention, not discovered at runtime.
- **First-order only.** No `apply`, no closures — inherited from `lower_asm`, which already rejects them as `LowerError::Unsupported`.
- **Encoding-generic.** `lower_tm`, `run_tm`, and `decode_tape` take `enc: &dyn Encoding`; they never mention `Unary` directly (the oracle/tests pass `&Unary`). All value-tape operations go through the `Encoding` trait — this is what keeps the binary follow-on cheap.

---

## File Structure

- **Modify** `crates/redextape-core/src/tm/encoding.rs` — add three methods to the `Encoding` trait (`init_reg`, `mov`, `jz`) with `Unary` implementations built from the existing sub-primitives; add unit tests.
- **Create** `crates/redextape-core/src/tm/lower_tm.rs` — `SlotMap`, `lower_tm(prog, &dyn Encoding) -> Machine`, the per-instruction gadget dispatch (straight-line + control flow only), module unit tests over hand-built `Program`s.
- **Create** `crates/redextape-core/src/tm/decode.rs` — `decode_tape(tapes, expected, &dyn Encoding) -> Option<Value>` (Nat/Bool arms this slice; Nil/Cons return `None` until 2b-2-iii), unit tests.
- **Modify** `crates/redextape-core/src/tm.rs` — declare the `decode`/`lower_tm` modules, re-export `lower_tm`, `decode_tape`, and add `TmRun` + `run_tm`.
- **Create** `crates/redextape-core/tests/tm_oracle.rs` — the reference-vs-TM oracle over the control-flow demo subset, the intermediate `asm-interp == TM` oracle, and cap-equivalence. This file grows in 2b-2-ii/iii/iv toward the full three-way oracle.

---

## Task 1: `Encoding::init_reg` + `Encoding::mov`

Two encoding-generic primitives `lower_tm` needs, both composable from merged 2b-1 code. `init_reg` lays out the all-zero register bank; `mov` copies one field to another (via the WORK scratch tape).

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (trait + `Unary` impl + tests)

**Interfaces:**
- Consumes: `Builder`, `RuleSpec`, `Symbol`, `Slot`, `StateId`, `MARK`, `SEP`, `BLANK`, `REG`, `WORK`, `FIELD_WIDTH`, and the `pub` sub-primitives `copy_field_to_work`, `append_work_to_field` (all already in scope in `encoding.rs`).
- Produces (added to `pub trait Encoding`):
  - `fn init_reg(&self, slots: u32) -> Vec<Symbol>` — the initial REG tape: `#` then, `slots` times, (`FIELD_WIDTH` blanks then `#`). Head starts at cell 0 (the leading `#` = home).
  - `fn mov(&self, b: &mut Builder, entry: StateId, exit: StateId, rs: Slot, rd: Slot)` — field `rd <- field rs`; flows `entry → exit`, both heads home on entry and exit. Safe when `rs == rd` (identity).

- [ ] **Step 1: Write the failing tests**

Add to `encoding.rs`'s `#[cfg(test)] mod tests` (the `run_gadget` harness and imports already exist):

```rust
#[test]
fn init_reg_lays_out_a_fixed_width_bank() {
    // `#` then (FIELD_WIDTH blanks + `#`) per slot; every field decodes to 0.
    let cells = Unary.init_reg(2);
    assert_eq!(cells.len(), 1 + 2 * (FIELD_WIDTH + 1));
    assert_eq!(cells[0], SEP);
    assert_eq!(Unary.decode_nat(&cells, 0), Some(0));
    assert_eq!(Unary.decode_nat(&cells, 1), Some(0));
    assert_eq!(Unary.decode_nat(&cells, 2), None); // no field past the trailing `#`
}

#[test]
fn mov_copies_a_field() {
    // slot0 <- v; mov slot1 <- slot0; decode slot1 == v (and slot0 is unchanged).
    fn body(b: &mut Builder, e: StateId, x: StateId) {
        Unary.mov(b, e, x, 0, 1);
    }
    assert_eq!(run_gadget(2, &[(0, 5)], 1, body), Some(5));
    assert_eq!(run_gadget(2, &[(0, 0)], 1, body), Some(0));
    // Source is preserved by the copy.
    assert_eq!(run_gadget(2, &[(0, 3)], 0, body), Some(3));
}

#[test]
fn mov_into_self_is_identity() {
    assert_eq!(run_gadget(1, &[(0, 4)], 0, |b, e, x| Unary.mov(b, e, x, 0, 0)), Some(4));
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: FAIL — `init_reg`/`mov` are not members of `Encoding`.

- [ ] **Step 3: Add the trait methods and `Unary` implementations**

In the `pub trait Encoding` block, add the two method signatures (with a short doc each mirroring the "Produces" contract above):

```rust
    /// The initial REG tape for a `slots`-field bank: `#` then (`FIELD_WIDTH` blanks + `#`)*`slots`.
    /// Head begins at cell 0 (the leading `#` = home). Encoding-specific (a zero field's contents).
    fn init_reg(&self, slots: u32) -> Vec<Symbol>;
    /// `slot rd <- slot rs`. Flows `entry -> exit`; both heads home on entry and exit. Safe when
    /// `rs == rd` (identity). Encoding-specific (copies the value representation).
    fn mov(&self, b: &mut Builder, entry: StateId, exit: StateId, rs: Slot, rd: Slot);
```

In `impl Encoding for Unary`, add:

```rust
    fn init_reg(&self, slots: u32) -> Vec<Symbol> {
        // Fixed-width all-zero bank: `#` then (FIELD_WIDTH blanks + `#`) per field.
        let mut cells = vec![SEP];
        for _ in 0..slots {
            cells.extend(std::iter::repeat_n(BLANK, FIELD_WIDTH));
            cells.push(SEP);
        }
        cells
    }

    fn mov(&self, b: &mut Builder, entry: StateId, exit: StateId, rs: Slot, rd: Slot) {
        // WORK <- rs (clears WORK, copies its marks); rd <- WORK (blanks rd's window, rewrites). Both
        // sub-primitives restore the home convention, so this composes. `rs == rd` round-trips the
        // same value through WORK -> identity.
        let l = format!("mv{rd}s{entry}"); // `entry` (fresh per call site) uniquifies derived states
        let after_copy = copy_field_to_work(b, entry, rs, &format!("{l}.c"));
        let after_wr = append_work_to_field(b, after_copy, rd, &format!("{l}.d"));
        b.add_rule(after_wr, RuleSpec::new(), exit);
    }
```

`FIELD_WIDTH` is already imported in the test module; import it into the encoding module body too if not already (`use crate::tm::build::{... FIELD_WIDTH ...}`) — add it to the existing `use` line.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS (all encoding tests, old + new).

- [ ] **Step 5: fmt/clippy/commit**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: clean.

```bash
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): add Encoding::init_reg and Encoding::mov for lower_tm"
```

---

## Task 2: `Encoding::jz` — the zero-test branch gadget

`jz r, L` needs a δ-gadget that reads field `r`, and routes to one of **two** exits depending on whether the field is zero (unary: its first cell is blank). This lives in `encoding.rs` because it uses the private `seek_slot`/`rewind_home` sub-primitives.

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (trait + `Unary` impl + a two-exit test harness)

**Interfaces:**
- Consumes: the private `seek_slot`, `rewind_home` sub-primitives; `MARK`/`BLANK`/`REG`.
- Produces (added to `pub trait Encoding`):
  - `fn jz(&self, b: &mut Builder, entry: StateId, if_zero: StateId, if_nonzero: StateId, r: Slot)` — from `entry` (REG at home), seek field `r`; if it is zero (first cell blank) flow to `if_zero`, else to `if_nonzero`; REG head home on both exits. WORK untouched.

- [ ] **Step 1: Write the failing test**

The existing `run_gadget` wires a single `entry → exit`; `jz` has two exits, so add a dedicated harness + test in the encoding test module:

```rust
/// Build a 2-field machine: init slot0 <- `v`; `jz(slot0, zero_exit, nonzero_exit)`; the zero exit
/// writes 7 into slot1, the nonzero exit writes 9. Decode slot1 to see which branch ran.
fn run_jz(v: u64) -> Option<u64> {
    let enc = Unary;
    let mut b = Builder::new();
    let halt = b.accept("halt");
    let zero_exit = b.state("zexit");
    let nz_exit = b.state("nzexit");
    enc.write_literal(&mut b, zero_exit, halt, 7, 1);
    enc.write_literal(&mut b, nz_exit, halt, 9, 1);
    let jz_entry = b.state("jz");
    enc.jz(&mut b, jz_entry, zero_exit, nz_exit, 0);
    // Prepend: init slot0 <- v, flowing into the jz entry.
    let start = b.state("start");
    enc.write_literal(&mut b, start, jz_entry, v, 0);
    // Initial 2-field bank.
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(2);
    let m = b.finish(start);
    assert!(m.validate().is_empty(), "invalid machine: {:?}", m.validate());
    let (tapes, status) = simulate(&m, &init, TM_DEFAULT_CAPS);
    assert_eq!(status, Status::Halted, "jz machine did not halt");
    enc.decode_nat(&tapes[REG].snapshot().0, 1)
}

#[test]
fn jz_branches_on_zero() {
    assert_eq!(run_jz(0), Some(7)); // zero -> zero_exit
    assert_eq!(run_jz(1), Some(9)); // nonzero -> nonzero_exit
    assert_eq!(run_jz(5), Some(9));
}
```

`Unary.init_reg` (Task 1) is used here; ensure Task 1 is committed first.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::encoding::tests::jz_branches_on_zero`
Expected: FAIL — `jz` is not a member of `Encoding`.

- [ ] **Step 3: Add the trait method + `Unary` implementation**

Trait signature (in `pub trait Encoding`):

```rust
    /// From `entry` (REG at home), seek field `r`: if it is zero (unary: first cell blank) flow to
    /// `if_zero`, else to `if_nonzero`. REG head home on both exits; WORK untouched. Encoding-specific
    /// (what "zero" looks like on the tape).
    fn jz(&self, b: &mut Builder, entry: StateId, if_zero: StateId, if_nonzero: StateId, r: Slot);
```

`Unary` impl:

```rust
    fn jz(&self, b: &mut Builder, entry: StateId, if_zero: StateId, if_nonzero: StateId, r: Slot) {
        // Seek field r; its first cell is a MARK (nonzero) or a BLANK (zero, all padding). Each branch
        // rewinds REG home to its own exit. rewind_home's precondition (head inside the field, not on
        // its trailing `#`) holds: the first cell is a mark or an interior padding blank.
        let l = format!("jz{r}s{entry}"); // `entry` (fresh per call site) uniquifies derived states
        let at = seek_slot(b, entry, r, &format!("{l}.s")); // REG on field r's first cell
        let nz = b.state(format!("{l}.nz"));
        b.add_rule(at, RuleSpec::new().on(REG, Some(MARK), None, Move::S), nz);
        let z = b.state(format!("{l}.z"));
        b.add_rule(at, RuleSpec::new().on(REG, Some(BLANK), None, Move::S), z);
        let home_nz = rewind_home(b, nz, r, &format!("{l}.rn"));
        b.add_rule(home_nz, RuleSpec::new(), if_nonzero);
        let home_z = rewind_home(b, z, r, &format!("{l}.rz"));
        b.add_rule(home_z, RuleSpec::new(), if_zero);
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::encoding::tests`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings`

```bash
git add crates/redextape-core/src/tm/encoding.rs
git commit -m "feat(tm): add Encoding::jz zero-test branch gadget"
```

---

## Task 3: `SlotMap` + `lower_tm` skeleton + straight-line instructions

Create `lower_tm.rs` with the register→slot map, the per-instruction `pc`-state skeleton, and the value instructions (`Li`/`Mov`/`Bin`) plus `Halt`. Control flow (`Jmp`/`Jz`) is Task 4.

**Files:**
- Create: `crates/redextape-core/src/tm/lower_tm.rs`
- Modify: `crates/redextape-core/src/tm.rs` (add `pub mod lower_tm;` and a re-export — the re-export can be a placeholder now, finalized in Task 5)

**Interfaces:**
- Consumes: `asm::{Instr, Program, Reg}`, `build::{Builder, RuleSpec, Slot}`, `machine::{Machine, StateId}`, `encoding::Encoding`, `core::BinOp`.
- Produces:
  - `pub fn lower_tm(prog: &Program, enc: &dyn Encoding) -> Machine`
  - `struct SlotMap` with `of(&Program) -> SlotMap`, `slot(Reg) -> Slot`, `n_slots() -> u32` (crate-visible for Task 5's `run_tm`, which sizes the initial tape).

- [ ] **Step 1: Write the failing test**

Create `lower_tm.rs` with a module skeleton and this test module. The test lowers hand-built `Program`s (mirroring `asm.rs`'s own tests) and checks the decoded result slot:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::asm::{Instr, Program, Reg};
    use crate::tm::build::REG;
    use crate::tm::encoding::Unary;
    use crate::tm::machine::TAPES; // if not present, use crate::tm::build::TAPES
    use crate::tm::sim::{DEFAULT_CAPS as CAPS, Status, simulate};
    use crate::core::BinOp;

    /// Lower `prog`, run it, and decode field 0 (the `Rr` result) as a unary Nat.
    fn run_nat(prog: &Program) -> Option<u64> {
        let enc = Unary;
        let m = lower_tm(prog, &enc);
        assert!(m.validate().is_empty(), "invalid machine: {:?}", m.validate());
        let sm = SlotMap::of(prog);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(sm.n_slots());
        let (tapes, status) = simulate(&m, &init, CAPS);
        assert_eq!(status, Status::Halted, "machine did not halt");
        enc.decode_nat(&tapes[REG].snapshot().0, 0)
    }

    #[test]
    fn straight_line_arithmetic() {
        // rr = (2 + 3) * 4 = 20  (identical to asm.rs's evaluates_straight_line_arithmetic)
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 3),
                Instr::Bin(BinOp::Add, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Li(Reg::Loc(3), 4),
                Instr::Bin(BinOp::Mul, Reg::Rr, Reg::Loc(2), Reg::Loc(3)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(run_nat(&prog), Some(20));
    }

    #[test]
    fn monus_and_mov() {
        // r0=3; r1=5; r2 = 3 - 5 = 0; rr = r2. Exercises Sub + Mov.
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 3),
                Instr::Li(Reg::Loc(1), 5),
                Instr::Bin(BinOp::Sub, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Mov(Reg::Rr, Reg::Loc(2)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(run_nat(&prog), Some(0));
    }

    #[test]
    fn slot_map_layout() {
        let prog = Program {
            code: vec![Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Arg(1)), Instr::Halt],
            labels: vec![],
        };
        let sm = SlotMap::of(&prog);
        assert_eq!(sm.slot(Reg::Rr), 0);
        assert_eq!(sm.slot(Reg::Loc(0)), 1);
        // n_loc = 1 (Loc(0)), so Arg(1) sits at 1 + 1 + 1 = 3; n_slots = 1 + 1 + 2 = 4.
        assert_eq!(sm.slot(Reg::Arg(1)), 3);
        assert_eq!(sm.n_slots(), 4);
    }
}
```

> Note: `TAPES` is exported from `build`; import from wherever it resolves (`crate::tm::build::TAPES`). Adjust the `use` if the `machine` re-export path differs.

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::lower_tm`
Expected: FAIL — `lower_tm`/`SlotMap` undefined (and the module is not yet declared).

- [ ] **Step 3: Implement `SlotMap`, `instr_regs`, and `lower_tm` (straight-line + Halt)**

Write the module body above the test module:

```rust
//! asm `Program` -> multi-tape `Machine`. Control flow becomes the TM's state graph: one entry state
//! per instruction index; each instruction is a block of states (a delta-gadget) that flows from its
//! `pc` to a successor `pc`. Straight-line instructions fall through to `pc[i+1]`; `jmp`/`jz` (Task 4)
//! jump to a label's `pc`. Value gadgets come from the `Encoding` seam. Total and panic-free on any
//! `Program`. `call`/`ret` and the heap ops are Parts 2b-2-ii/iii; here they defensively halt.

use crate::core::BinOp;
use crate::tm::asm::{Instr, Program, Reg};
use crate::tm::build::{Builder, RuleSpec, Slot};
use crate::tm::encoding::Encoding;
use crate::tm::machine::{Machine, StateId};

/// Maps the asm register file onto REG-tape fields. Layout: slot 0 = `Rr` (the result), then the
/// `Loc` bank, then the `Arg` bank. Distinct registers -> distinct slots, so `lower_asm`'s
/// "`ra`/`rb` fresh, `!= dst`" invariant carries to the `rd != ra, rb` slot precondition for free.
pub(crate) struct SlotMap {
    n_loc: u32,
    n_arg: u32,
}

impl SlotMap {
    pub(crate) fn of(prog: &Program) -> SlotMap {
        let mut n_loc = 0;
        let mut n_arg = 0;
        for instr in &prog.code {
            for r in instr_regs(instr) {
                match r {
                    Reg::Loc(k) => n_loc = n_loc.max(k + 1),
                    Reg::Arg(k) => n_arg = n_arg.max(k + 1),
                    Reg::Rr => {}
                }
            }
        }
        SlotMap { n_loc, n_arg }
    }

    pub(crate) fn slot(&self, r: Reg) -> Slot {
        match r {
            Reg::Rr => 0,
            Reg::Loc(k) => 1 + k,
            Reg::Arg(k) => 1 + self.n_loc + k,
        }
    }

    pub(crate) fn n_slots(&self) -> u32 {
        1 + self.n_loc + self.n_arg
    }
}

/// The register operands of an instruction (for sizing the bank). Read and write operands alike.
fn instr_regs(i: &Instr) -> Vec<Reg> {
    match i {
        Instr::Li(rd, _) | Instr::Jz(rd, _) | Instr::Nil(rd) => vec![*rd],
        Instr::Mov(a, b) | Instr::Head(a, b) | Instr::Tail(a, b) | Instr::IsEmpty(a, b) => vec![*a, *b],
        Instr::Bin(_, a, b, c) | Instr::Cons(a, b, c) => vec![*a, *b, *c],
        Instr::Jmp(_) | Instr::Call(_) | Instr::Ret | Instr::Halt => vec![],
    }
}

/// True for the arithmetic `BinOp`s (dispatch to `enc.arith`); the rest are comparisons (`enc.compare`).
fn is_arith(op: BinOp) -> bool {
    matches!(op, BinOp::Add | BinOp::Sub | BinOp::Mul)
}

/// Lower `prog` into a 4-tape `Machine`. Total and panic-free on any `Program`.
pub fn lower_tm(prog: &Program, enc: &dyn Encoding) -> Machine {
    let sm = SlotMap::of(prog);
    let mut b = Builder::new();
    let n = prog.code.len();
    // The single halt (accept) state: `halt`, an out-of-range/unimplemented instruction, and falling
    // off the end all route here.
    let halt = b.accept("halt");
    // One entry state per instruction index. `pc[i]` means "about to execute instruction i".
    let pc: Vec<StateId> = (0..n).map(|i| b.state(format!("pc{i}"))).collect();
    // Successor entry for a (possibly past-the-end) instruction index.
    let succ = |k: usize| if k < n { pc[k] } else { halt };

    for (i, instr) in prog.code.iter().enumerate() {
        let fall = succ(i + 1);
        match instr {
            Instr::Li(rd, v) => enc.write_literal(&mut b, pc[i], fall, *v, sm.slot(*rd)),
            Instr::Mov(rd, rs) => enc.mov(&mut b, pc[i], fall, sm.slot(*rs), sm.slot(*rd)),
            Instr::Bin(op, rd, ra, rb) if is_arith(*op) => {
                enc.arith(&mut b, pc[i], fall, *op, sm.slot(*ra), sm.slot(*rb), sm.slot(*rd))
            }
            Instr::Bin(op, rd, ra, rb) => {
                enc.compare(&mut b, pc[i], fall, *op, sm.slot(*ra), sm.slot(*rb), sm.slot(*rd))
            }
            Instr::Halt => b.add_rule(pc[i], RuleSpec::new(), halt),
            // Task 4 replaces these two arms:
            Instr::Jmp(_) | Instr::Jz(..) => b.add_rule(pc[i], RuleSpec::new(), halt),
            // 2b-2-ii/iii replace these — defensively halt for now (never fed to this slice's tests).
            Instr::Call(_)
            | Instr::Ret
            | Instr::Nil(_)
            | Instr::Cons(..)
            | Instr::Head(..)
            | Instr::Tail(..)
            | Instr::IsEmpty(..) => b.add_rule(pc[i], RuleSpec::new(), halt),
        }
    }

    b.finish(pc.first().copied().unwrap_or(halt))
}
```

Then declare the module in `tm.rs`: add `pub mod lower_tm;` next to the other `pub mod` lines, and (placeholder) `pub use lower_tm::lower_tm;` next to the other re-exports. (Task 5 extends this re-export line.)

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::lower_tm`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings`

```bash
git add crates/redextape-core/src/tm/lower_tm.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): lower_tm skeleton + straight-line (li/mov/bin) instructions"
```

---

## Task 4: Control flow — `Jmp` and `Jz`

Replace the two placeholder arms with real edges: `jmp` is an unconditional edge to the label's `pc`; `jz` delegates to `enc.jz`, routing the zero-branch to the label and the nonzero-branch to fall-through.

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_tm.rs`

**Interfaces:**
- Consumes: `Program::label_index`, `enc.jz` (Task 2).

- [ ] **Step 1: Write the failing tests**

Add to `lower_tm.rs`'s test module:

```rust
#[test]
fn jz_and_jmp_branch() {
    // if (1 == 2) rr=10 else rr=20  ->  20 (mirrors asm.rs's jz_and_jmp_branch)
    let prog = Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 1),
            Instr::Li(Reg::Loc(1), 2),
            Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)), // 0 (false)
            Instr::Jz(Reg::Loc(2), "else".to_string()),
            Instr::Li(Reg::Rr, 10),
            Instr::Jmp("end".to_string()),
            Instr::Li(Reg::Rr, 20), // else:
            Instr::Halt,            // end:
        ],
        labels: vec![("else".to_string(), 6), ("end".to_string(), 7)],
    };
    assert_eq!(run_nat(&prog), Some(20));
}

#[test]
fn while_loop_counts_down() {
    // n=3; acc=0; while n>0 { acc=acc+1; n=n-1 }; rr=acc == 3.
    // r0=n, r1=acc, r2=cond, r3=one.
    let prog = Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 3),                                  // 0: n = 3
            Instr::Li(Reg::Loc(1), 0),                                  // 1: acc = 0
            Instr::Li(Reg::Loc(3), 0),                                  // 2: zero (for the compare)
            Instr::Bin(BinOp::Gt, Reg::Loc(2), Reg::Loc(0), Reg::Loc(3)), // 3: cond = n > 0   (top:)
            Instr::Jz(Reg::Loc(2), "done".to_string()),                 // 4: if !cond -> done
            Instr::Li(Reg::Loc(4), 1),                                  // 5: one = 1
            Instr::Bin(BinOp::Add, Reg::Loc(1), Reg::Loc(1), Reg::Loc(4)), // 6: acc = acc + 1
            Instr::Bin(BinOp::Sub, Reg::Loc(0), Reg::Loc(0), Reg::Loc(4)), // 7: n = n - 1
            Instr::Jmp("top".to_string()),                              // 8: -> top
            Instr::Mov(Reg::Rr, Reg::Loc(1)),                           // 9: rr = acc   (done:)
            Instr::Halt,                                                // 10
        ],
        labels: vec![("top".to_string(), 3), ("done".to_string(), 9)],
    };
    assert_eq!(run_nat(&prog), Some(3));
}
```

> Aliasing note for the reviewer: instruction 6/7 reuse `Loc(1)`/`Loc(0)` as both a source and the destination of a `Bin`. This is `rd == ra` with `rb = Loc(4)` distinct — hand-built here to exercise the loop, but **NOT** what `lower_asm` emits (it always uses fresh `ra`/`rb ≠ dst`). The `Encoding` preconditions require `rd ∉ {ra, rb}`; `Add` is alias-safe for `rd == ra` (it copies `ra` to WORK first), but if this test is flaky, rewrite instructions 6/7 to use fresh destination locals then `mov` back, matching real `lower_asm` output. Prefer the fresh-dst form if in doubt — the goal is to exercise the loop edge, not to probe gadget aliasing.

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::lower_tm`
Expected: FAIL — `jz_and_jmp_branch` decodes wrong / halts early (placeholder arms route to `halt`).

- [ ] **Step 3: Implement the control-flow arms**

Add a label-resolution helper and replace the placeholder arm:

```rust
    // (helper, near is_arith)
    // Resolve a jump target label to its entry state, defensively halting on an undefined/out-of-range
    // label (mirrors run_asm treating an undefined label as a fault -> a stuck/halt here).
    let target = |l: &str| prog.label_index(l).map_or(halt, &succ);
```

Because `target` borrows `prog`, `pc`, and `halt`, define it as a small closure *inside* `lower_tm` after `succ` (or inline the `prog.label_index(l).map_or(halt, |k| succ(k))` expression in each arm). Replace the `Instr::Jmp(_) | Instr::Jz(..)` placeholder with:

```rust
            Instr::Jmp(l) => {
                let t = prog.label_index(l).map_or(halt, &succ);
                b.add_rule(pc[i], RuleSpec::new(), t);
            }
            Instr::Jz(r, l) => {
                let t = prog.label_index(l).map_or(halt, &succ);
                // jz jumps to the label when the field is ZERO; otherwise falls through.
                enc.jz(&mut b, pc[i], t, fall, sm.slot(*r));
            }
```

> `succ` is a closure; `&succ` as the `map_or` fallback-fn works because `Fn(usize) -> StateId`. If the borrow checker objects to reusing `succ` by reference here, replace `.map_or(halt, &succ)` with `.map_or(halt, |k| succ(k))`.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core --lib tm::lower_tm`
Expected: PASS.

- [ ] **Step 5: fmt/clippy/commit**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings`

```bash
git add crates/redextape-core/src/tm/lower_tm.rs
git commit -m "feat(tm): lower jmp/jz to TM state-graph edges"
```

---

## Task 5: `decode_tape` + `TmRun` + `run_tm`

The type-directed decoder (Nat/Bool this slice) and the composed entry point mirroring `run_lambda`/`LambdaRun`.

**Files:**
- Create: `crates/redextape-core/src/tm/decode.rs`
- Modify: `crates/redextape-core/src/tm.rs` (declare `decode`, re-export `decode_tape`, add `TmRun` + `run_tm`)

**Interfaces:**
- Consumes: `value::Value`, `sim::Tape`, `encoding::Encoding`, `build::REG`, `lower_asm::{lower_asm, LowerError}`, `lower_tm::{lower_tm, SlotMap}`, `sim::{simulate, Caps as TmCaps, Status}`.
- Produces:
  - `pub fn decode_tape(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Option<Value>`
  - `pub enum TmRun { Ran { tapes: Vec<Tape> }, HitCap, LowerError(LowerError) }`
  - `pub fn run_tm(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun`

- [ ] **Step 1: Write the failing tests**

Create `decode.rs` with:

```rust
//! Final tapes -> `Value`, type-directed like the asm/lambda decoders: the reference value supplies
//! the type witness (a bare tape is ambiguous). Nat/Bool are decoded here; Nil/Cons (heap-pointer
//! following) arrive with the HEAP tape in Part 2b-2-iii. `expected` is used ONLY for its shape, so a
//! machine that computed the wrong value decodes to a different `Value` (or `None`), still failing the
//! oracle.

use crate::tm::build::REG;
use crate::tm::encoding::Encoding;
use crate::tm::sim::Tape;
use crate::value::Value;

/// Decode the machine's final `tapes` to a `Value`, guided by `expected`'s shape. The result word is
/// REG slot 0 (`Rr`). Returns `None` when the tape shape does not match the expected type.
pub fn decode_tape(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Option<Value> {
    let reg = tapes.get(REG)?.snapshot().0;
    match expected {
        Value::Nat(_) => enc.decode_nat(&reg, 0).map(Value::Nat),
        Value::Bool(_) => match enc.decode_nat(&reg, 0)? {
            0 => Some(Value::Bool(false)),
            1 => Some(Value::Bool(true)),
            _ => None,
        },
        // Heap-shaped results need the HEAP tape follower (Part 2b-2-iii).
        Value::Nil | Value::Cons(..) => None,
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::BinOp;
    use crate::tm::asm::{Instr, Program, Reg};
    use crate::tm::build::TAPES;
    use crate::tm::encoding::Unary;
    use crate::tm::lower_tm::{SlotMap, lower_tm};
    use crate::tm::sim::{DEFAULT_CAPS as CAPS, simulate};

    fn run_to_tapes(prog: &Program) -> Vec<Tape> {
        let enc = Unary;
        let m = lower_tm(prog, &enc);
        let sm = SlotMap::of(prog);
        let mut init = vec![Vec::new(); TAPES];
        init[REG] = enc.init_reg(sm.n_slots());
        simulate(&m, &init, CAPS).0
    }

    #[test]
    fn decodes_nat_by_expected_shape() {
        // rr = 2 + 3 = 5
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 3),
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Nat(0), &Unary), Some(Value::Nat(5)));
    }

    #[test]
    fn decodes_bool_and_catches_a_wrong_value() {
        // rr = (2 == 2) = 1  -> Bool(true).
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 2),
                Instr::Li(Reg::Loc(1), 2),
                Instr::Bin(BinOp::Eq, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Bool(false), &Unary), Some(Value::Bool(true)));
        // Same tape, a Nat witness: still decodes (to Nat(1)) — but as a DIFFERENT value, which is how
        // decode catches a machine that computed the wrong thing under a given type.
        assert_eq!(decode_tape(&tapes, &Value::Nat(9), &Unary), Some(Value::Nat(1)));
    }

    #[test]
    fn non_first_class_and_heap_shapes_decode_to_none() {
        let prog = Program { code: vec![Instr::Halt], labels: vec![] };
        let tapes = run_to_tapes(&prog);
        assert_eq!(decode_tape(&tapes, &Value::Unit, &Unary), None);
        assert_eq!(decode_tape(&tapes, &Value::Nil, &Unary), None); // until 2b-2-iii
    }
}
```

Then add a `run_tm` test in `tm.rs`'s existing (or a new) `#[cfg(test)]` module:

```rust
#[cfg(test)]
mod run_tm_tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::value::Value;

    fn tm_value(src: &str) -> Value {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let expected = crate::run(src).expect("reference run failed");
        match run_tm(&core, &Unary, TM_DEFAULT_CAPS) {
            TmRun::Ran { tapes } => decode_tape(&tapes, &expected, &Unary).expect("decode failed"),
            other => panic!("tm did not run: {other:?}"),
        }
    }

    #[test]
    fn run_tm_on_control_flow_programs() {
        assert_eq!(tm_value("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(tm_value("3 - 5"), Value::Nat(0));
        assert_eq!(tm_value("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(tm_value("let x = 40; x + 2"), Value::Nat(42));
        assert_eq!(tm_value("let mut n = 3; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"), Value::Nat(3));
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::decode tm::run_tm_tests`
Expected: FAIL — `decode`/`decode_tape`/`run_tm`/`TmRun` undefined.

- [ ] **Step 3: Implement**

In `tm.rs`: declare `pub mod decode;` and extend the re-exports:

```rust
pub use decode::decode_tape;
pub use lower_tm::lower_tm;
```

Add `TmRun` + `run_tm` to `tm.rs` (mirroring `lambda::{LambdaRun, run_lambda}`).

**Import discipline (load-bearing):** `tm.rs` **already** re-exports `simulate`, `Tape`, `Caps as TmCaps`, and `Status as TmStatus` (see its existing `pub use sim::{...}` line), so those names are already in scope in this module — do **not** add a fresh `use crate::tm::sim::{...}` for them (that is a duplicate-import compile error). The match arms use the **aliased** `TmStatus`, not `Status`. The only new `use` lines needed are `Core` and `SlotMap`:

```rust
use crate::core::Core;
use crate::tm::lower_tm::SlotMap;
// `Encoding`, `lower_asm`, `LowerError`, `lower_tm`, `simulate`, `Tape`, `TmCaps`, `TmStatus`, `REG`,
// and `TAPES` are all already in scope via `tm.rs`'s existing `pub use` re-exports.

/// The outcome of lowering + simulating a program through the TM backend. Decoding to a `Value` is a
/// separate, type-directed step (`decode_tape`), because bare tapes are ambiguous. Mirrors `LambdaRun`.
#[derive(Clone, Debug)]
pub enum TmRun {
    /// Simulated to a halt. Decode the final tapes against an expected value's shape (`decode_tape`).
    Ran { tapes: Vec<Tape> },
    /// The simulation hit a step / tape-cells cap.
    HitCap,
    /// The program could not be lowered to asm (e.g. a higher-order use).
    LowerError(LowerError),
}

/// Lower (`lower_asm` -> `lower_tm`) then simulate. The convenience entry point for the oracle and
/// later plans; `enc` selects the numeric encoding (the v1 `Unary`). Panic-free and bounded by `caps`.
pub fn run_tm(core: &Core, enc: &dyn Encoding, caps: TmCaps) -> TmRun {
    let prog = match lower_asm(core) {
        Ok(p) => p,
        Err(e) => return TmRun::LowerError(e),
    };
    let machine = lower_tm(&prog, enc);
    let sm = SlotMap::of(&prog);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(sm.n_slots());
    match simulate(&machine, &init, caps) {
        (tapes, TmStatus::Halted) => TmRun::Ran { tapes },
        (_tapes, TmStatus::HitCap) => TmRun::HitCap,
    }
}
```

> `SlotMap` is `pub(crate)` (Task 3), so `run_tm` in `tm.rs` can construct it. If the `run_tm_tests` module in `tm.rs` needs `TM_DEFAULT_CAPS`/`decode_tape`/`run_tm`/`TmRun`/`Unary`, they are all in module scope via `super::*`.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core --lib tm::`
Expected: PASS (decode + run_tm + all prior tm tests).

- [ ] **Step 5: fmt/clippy/commit**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings`

```bash
git add crates/redextape-core/src/tm/decode.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): add decode_tape (Nat/Bool) + run_tm/TmRun composed entry"
```

---

## Task 6: The control-flow oracle (`tests/tm_oracle.rs`)

The integration test that makes this slice a real (partial) three-way link: the reference tree-walker and the TM agree on the control-flow demo subset, plus the intermediate `asm-interp == TM` oracle (localizes any gadget bug to lowering), plus cap-equivalence. This file grows in 2b-2-ii/iii/iv toward the full `reference == λ == TM`.

**Files:**
- Create: `crates/redextape-core/tests/tm_oracle.rs`

**Interfaces:**
- Consumes (from `redextape_core::tm`): `run_tm`, `decode_tape`, `TmRun`, `Unary`, `TM_DEFAULT_CAPS`, `TmCaps`, `AsmRun`, `run_asm`, `lower_asm`, `decode_asm`, `DEFAULT_CAPS` (asm caps); and `redextape_core::{run, RunError}`.

- [ ] **Step 1: Write the oracle tests**

```rust
//! Part of the three-way oracle (spec §12.1), control-flow slice: the reference tree-walker and the
//! genuine multi-tape TM agree on straight-line + branching programs (no calls, no heap yet). Also
//! carries the intermediate `asm-interp == TM` oracle (a disagreement localizes to asm->TM lowering)
//! and cap-equivalence. Parts 2b-2-ii/iii/iv extend this to calls, lists, and the full
//! `reference == lambda == TM`.

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{
    AsmRun, DEFAULT_CAPS as ASM_CAPS, TM_DEFAULT_CAPS, TmRun, Unary, decode_asm, decode_tape, lower_asm, run_asm,
    run_tm,
};
use redextape_core::{RunError, run};

/// The reference result and the TM's decoded final tape must agree (guided by the reference value's
/// type). A reference runtime fault/cap corresponds to a TM cap.
fn assert_tm_agrees(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    match (reference, run_tm(&core, &Unary, TM_DEFAULT_CAPS)) {
        (Ok(rv), TmRun::Ran { tapes }) => {
            assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv.clone()), "reference vs TM disagree for: {src}");
        }
        (Err(RunError::Runtime(_)), TmRun::HitCap) => {}
        (r, t) => panic!("oracle mismatch for {src}:\n  reference={r:?}\n  tm={t:?}"),
    }
}

/// The intermediate oracle: the asm interpreter and the TM sim decode to the same value. Localizes a
/// disagreement to asm->TM lowering (the reference==asm link is proven in `asm_oracle.rs`).
fn assert_asm_interp_matches_tm(src: &str) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let reference = run(src).expect("control-flow demos run to a value");
    let program = lower_asm(&core).expect("lowering to asm succeeds");
    let asm = match run_asm(&program, ASM_CAPS) {
        AsmRun::Ran(o) => decode_asm(&o, &reference).expect("asm decode"),
        other => panic!("asm did not run for {src}: {other:?}"),
    };
    let tm = match run_tm(&core, &Unary, TM_DEFAULT_CAPS) {
        TmRun::Ran { tapes } => decode_tape(&tapes, &reference, &Unary).expect("tm decode"),
        other => panic!("tm did not run for {src}: {other:?}"),
    };
    assert_eq!(asm, tm, "asm-interp vs TM disagree for: {src}");
}

/// The control-flow demo subset: arithmetic, monus, comparisons, if, let/let mut, assign, while, seq.
/// No `call`/`ret`, no list/heap ops (those are Parts 2b-2-ii/iii). Values stay well under FIELD_WIDTH.
const CONTROL_FLOW_DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "if 1 == 2 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    // Latent-trap program (Plan 2 follow-up): an immutable `let` shadowing a mutable variable.
    "let mut x = 1; x = x + 1; let x = x + 10; x",
];

#[test]
fn tm_agrees_with_reference_on_control_flow_demos() {
    for src in CONTROL_FLOW_DEMOS {
        assert_tm_agrees(src);
    }
}

#[test]
fn asm_interp_matches_tm_on_control_flow_demos() {
    for src in CONTROL_FLOW_DEMOS {
        assert_asm_interp_matches_tm(src);
    }
}

#[test]
fn tm_cap_matches_a_reference_nonterminating_program() {
    // An unbounded loop: the reference hits its step budget (Runtime error) and the TM hits its cap.
    // Both are the "same outcome" under cap-equivalence.
    use redextape_core::tm::TmCaps;
    let src = "let mut n = 1; while n > 0 { n = n + 1; } n";
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let caps = TmCaps { steps: 50_000, cells: 50_000 };
    assert!(matches!(run_tm(&core, &Unary, caps), TmRun::HitCap), "expected the TM to hit a cap");
}
```

> If `run(src)` on the non-terminating program returns `Ok` (because the reference's own step budget is generous) rather than a `Runtime` error, keep the TM-only cap assertion as written (it asserts only the TM side) and drop any reference-side coupling — the point is that the TM *bounds* the loop, never hangs. Confirm the reference's behavior while implementing and adjust the comment to match; do not weaken the assertion that the TM returns `HitCap`.

- [ ] **Step 2: Run to verify (they should pass once compiled — this is an integration test of Tasks 1–5)**

Run: `cargo test -p redextape-core --test tm_oracle`
Expected: PASS. If `tm_agrees_with_reference_on_control_flow_demos` fails on a specific `src`, use `asm_interp_matches_tm_on_control_flow_demos` to localize: if asm==TM also fails there, the bug is in asm→TM lowering (this slice); if asm==TM passes but reference==TM fails, the bug is in decode.

- [ ] **Step 3: fmt/clippy**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 4: Full suite green**

Run: `cargo test -p redextape-core`
Expected: PASS — all lib tests + `asm_oracle` + `lambda_oracle` + `tm_machine` + `tm_encoding` + the new `tm_oracle`.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/tests/tm_oracle.rs
git commit -m "test(tm): reference==TM + asm-interp==TM oracle on the control-flow demo subset"
```

---

## Deferred to later sub-parts (do NOT attempt here)

- **Part 2b-2-ii — calls & recursion:** `Call`/`Ret` via the STACK tape (frame save/restore of the `Loc` bank + a unary **return-tag** dispatch back to the call site's continuation). Unblocks `sum(5)`, `count_down(4)` *as a call*, `add1(41)`, and the `fn bump` latent-trap program. Introduces the `@` STACK delimiter symbol.
- **Part 2b-2-iii — heap & lists:** `Nil`/`Cons`/`Head`/`Tail`/`IsEmpty` via the HEAP tape (cons cells at unary addresses); extend `decode_tape`'s `Nil`/`Cons` arms to follow the heap pointer from `Rr`. Unblocks `head(cons(7, nil))`, `is_empty`, `[1, 2, 3]`.
- **Part 2b-2-iv — the finale:** the full three-way oracle (`reference == λ == TM`) over the whole first-order demo suite; the TM-bounded proptest (small `Nat` magnitudes so unary stays tractable *and* under `FIELD_WIDTH`); golden `print_asm` + TM step counts; TM-text round-trip over compiled machines; and folding in the deferred 2b-1 Minors (tighten sub-primitive visibility to private now that `mov`/`jz` are the real callers; `x*0` + comparison-trichotomy sweeps; broaden the `asm_oracle` generator + drop its dead `RunError::Static` arm; `cmp_mnemonic`→`bin_mnemonic` rename).

## Self-Review (completed while writing)

- **Spec coverage (this slice):** control-flow → state graph (spec §3.4, §6) ✓; value gadgets consumed via the `Encoding` seam (§5) ✓; `decode_tape` type-directed, Nat/Bool (§8) ✓; `run_tm`/`TmRun` mirror `LambdaRun` (§11) ✓; intermediate `asm-interp == TM` oracle (§3.5, §12.2) ✓; cap-equivalence (§10) ✓. Calls/heap/full-oracle/proptest/goldens/text-round-trip are explicitly deferred to ii/iii/iv (§12.1/§12.3/§12.5/§12.6).
- **Placeholder scan:** none — every code step carries complete code; the two "if the borrow checker/reference behavior differs" notes name the concrete fallback rather than leaving a TODO.
- **Type consistency:** `SlotMap::{of, slot, n_slots}` (`pub(crate)`), `lower_tm(&Program, &dyn Encoding) -> Machine`, `decode_tape(&[Tape], &Value, &dyn Encoding) -> Option<Value>`, `run_tm(&Core, &dyn Encoding, TmCaps) -> TmRun`, `TmRun::{Ran{tapes}, HitCap, LowerError}`, and the trait additions `init_reg`/`mov`/`jz` are used identically across Tasks 1–6. `Rr = slot 0` is honored by both `SlotMap::slot` and `decode_tape`.
