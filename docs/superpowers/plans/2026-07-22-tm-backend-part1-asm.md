# TM Backend — Part 1: Register Assembly + Core→asm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the register-assembly layer of the TM backend — a legible register-machine IR
(`Instr`/`Program`), its `print_asm` printer, a reference **asm interpreter**, and the **Core → asm**
lowering for the first-order language subset — delivering the intermediate oracle
`reference tree-walker == decoded asm-interpreter result` on the first-order demo suite.

**Architecture:** A new `tm` submodule of the existing `redextape-core` crate, mirroring the `lambda`
submodule's layout. The pipeline for this part is `Core → Program (lower_asm) → AsmOutcome (run_asm) →
Value (decode_asm)`. The register machine has three register classes (`Loc` locals, `Arg` argument
registers, `Rr` result), a heap tape model for lists, and a call stack. `call`/`ret` manage frames
automatically (locals are frame-saved, args are volatile, `rr` carries the result), so the emitted
code needs no manual caller-saves. Lowering is syntax-directed and total (`Result<_, LowerError>`,
never panics). Part 2 (`machine`/`encoding`/`lower_tm`/`sim`/`decode`/`syntax`) compiles this same
`Program` down to a genuine multi-tape Turing machine — written as a separate plan once these
interfaces exist.

**Tech Stack:** Rust (edition 2024), zero runtime deps; `proptest` (existing dev-dep) for the oracle
property. Builds only on Plan 1's `core::{Core, BinOp, NodeId}`, `value::Value`, `desugar::desugar`,
`parser::parse`, and `run`, plus Plan 2's λ backend for the (later, Part 2) three-way comparison.

**Design source:** [`docs/superpowers/specs/2026-07-22-tm-backend-design.md`](../specs/2026-07-22-tm-backend-design.md)
(§3 register-assembly IR, §11 module layout, §12 testing).

## Global Constraints

Every task's requirements implicitly include these (from the spec + repo config, exact values):

- **Rust edition 2024**; `rustfmt.toml` sets `max_width = 120`, `use_small_heuristics = "Max"`.
- Must pass, at all times: `cargo fmt --all --check`;
  `cargo clippy --workspace --all-targets -- -D warnings`;
  `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`.
- **No panics on user input.** `lower_asm` returns `Result<_, LowerError>`; `run_asm` returns an
  `AsmRun` (never panics, never hangs — bounded by caps); only genuine internal invariants may
  `panic!`/`unreachable!`.
- **No process aborts / no hangs on any input** (Plan 1 discipline): `run_asm` is an iterative loop
  bounded by a **step cap**, a **stack-depth cap**, and a **heap-size cap**; `lower_asm` carries a
  recursion-depth guard (`MAX_LOWER_DEPTH`) returning `LowerError::TooDeep` so a deeply-nested Core
  (a big list literal desugars to a deep `cons`-`Apply` spine) never overflows the native stack.
- **`Program`, `Instr`, `AsmOutcome` are flat `Vec`-backed** — no deep recursive trees — so **no
  hand-written iterative `Drop` is required** (unlike `Core`/`Value`/`LambdaTerm`).
- Arithmetic matches the reference exactly: `Add`=saturating add, `Sub`=**monus** (saturating sub),
  `Mul`=saturating mul; comparisons yield `1`/`0`.
- The oracle treats a reference runtime fault or cap (`RunError::Runtime`) as matching an asm
  non-`Ran` outcome (`AsmRun::HitCap | AsmRun::Fault`).

## Locked scope decisions (from the design spec §1.1)

1. **First-order only.** All function calls target statically-known named functions. A **function used
   as a value** (passed as an argument, stored, or returned) is higher-order → `LowerError::Unsupported`
   (deferred to the defunctionalization follow-on). No `apply` instruction.
2. **Unary is a Part 2 concern.** This part is numeric-representation-agnostic: the asm interpreter
   works on `u64` words; how a word is laid out on a tape is Part 2's `encoding.rs`.
3. **asm text form = printer only** (`print_asm`). No `parse_asm` in this plan (deferred to the v2
   assembly pane).

## File structure

```
crates/redextape-core/src/
  lib.rs               # add `pub mod tm;`
  tm.rs                # submodule root: `pub mod` lines, re-exports, LowerError re-export
  tm/
    asm.rs             # Instr, Reg, Program, print_asm, run_asm (interpreter), decode_asm,
                       #   AsmRun/AsmOutcome/Caps                              (Tasks 1–5)
    lower_asm.rs       # lower_asm(&Core) -> Result<Program, LowerError>       (Tasks 6–9)
  tests/
    asm_oracle.rs      # reference == asm-interp on the demo suite + proptest  (Task 10)
```

Task 10 wires `tm.rs` re-exports and adds the Part 1 oracle.

---

### Task 1: asm IR types + submodule wiring

**Files:**
- Create: `crates/redextape-core/src/tm.rs`
- Create: `crates/redextape-core/src/tm/asm.rs`
- Modify: `crates/redextape-core/src/lib.rs` (add `pub mod tm;`)

**Interfaces:**
- Consumes: `core::BinOp`.
- Produces:
  - `asm::Reg { Loc(u32), Arg(u32), Rr }` — register operands.
  - `asm::Instr` — the instruction set (below).
  - `asm::Program { code: Vec<Instr>, labels: Vec<(String, usize)> }` where each `labels` entry maps a
    label name to the index in `code` it precedes.
  - Constructor helper `Program::label_index(&self, name: &str) -> Option<usize>`.

- [ ] **Step 1: Create the submodule root and wire it in**

Create `crates/redextape-core/src/tm.rs`:

```rust
//! The TM backend: Core AST -> register-assembly -> multi-tape Turing machine -> `Value`, plus a
//! round-tripping TM text form. See `docs/superpowers/specs/2026-07-22-tm-backend-design.md`.
//!
//! Part 1 (this slice): the register-assembly IR (`asm`) and Core -> asm lowering (`lower_asm`),
//! delivering the intermediate oracle `reference == asm-interpreter`.

pub mod asm;
```

Add to `crates/redextape-core/src/lib.rs` (keep module declarations sorted — `tm` sorts after `ty`?
no: alphabetically `tm` < `token`; place it to keep the list sorted, i.e. after `span`/`token`? The
current order is `... span, token, ty, typeck, value`. Insert `tm` before `token`):

```rust
pub mod tm;
```

- [ ] **Step 2: Write the failing test for `asm.rs` types**

Create `crates/redextape-core/src/tm/asm.rs` with the test first:

```rust
//! The register-assembly IR: a small register machine whose control flow becomes (in Part 2) the
//! Turing machine's state graph, and whose data (registers, stack, heap) becomes tapes. Registers
//! hold `u64` words; because Core is typed, the compiled code statically knows whether a word is a
//! `Nat` count, a `0`/`1` `Bool`, or a heap pointer, so there are no runtime type tags.

use crate::core::BinOp;

/// A register operand. `Loc` registers are function-local and frame-saved across `call`; `Arg`
/// registers pass arguments (volatile); `Rr` carries the result of a `call` and the whole program.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reg {
    Loc(u32),
    Arg(u32),
    Rr,
}

/// One register-machine instruction. Labels are stored separately in `Program`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Instr {
    /// `rd <- #n`
    Li(Reg, u64),
    /// `rd <- rs`
    Mov(Reg, Reg),
    /// `rd <- ra op rb` (arithmetic yields a Nat; comparison yields 0/1). Reuses `core::BinOp`.
    Bin(BinOp, Reg, Reg, Reg),
    /// jump to `label` if `r == 0`
    Jz(Reg, String),
    /// unconditional jump to `label`
    Jmp(String),
    /// call the subroutine at `label` (saves local frame, result returns in `Rr`)
    Call(String),
    /// return to the caller (restores the caller's local frame)
    Ret,
    /// stop the program (top-level result is in `Rr`)
    Halt,
    /// `rd <- nil` (the null list pointer)
    Nil(Reg),
    /// `rd <- cons(rh, rt)` (allocate a heap cell, return its pointer)
    Cons(Reg, Reg, Reg),
    /// `rd <- head(rl)` (fault if `rl` is nil)
    Head(Reg, Reg),
    /// `rd <- tail(rl)` (fault if `rl` is nil)
    Tail(Reg, Reg),
    /// `rd <- is_empty(rl)` (1 if nil, else 0)
    IsEmpty(Reg, Reg),
}

/// A whole program: a flat instruction stream plus label positions (name -> index it precedes).
/// Execution starts at index 0.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Program {
    pub code: Vec<Instr>,
    pub labels: Vec<(String, usize)>,
}

impl Program {
    /// The `code` index a label precedes, or `None` if undefined.
    pub fn label_index(&self, name: &str) -> Option<usize> {
        self.labels.iter().find(|(n, _)| n == name).map(|(_, i)| *i)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn program_resolves_labels_to_code_indices() {
        let prog = Program {
            code: vec![Instr::Li(Reg::Rr, 7), Instr::Ret],
            labels: vec![("f".to_string(), 0)],
        };
        assert_eq!(prog.label_index("f"), Some(0));
        assert_eq!(prog.label_index("missing"), None);
    }

    #[test]
    fn reg_and_instr_are_comparable() {
        assert_eq!(Reg::Loc(1), Reg::Loc(1));
        assert_ne!(Reg::Loc(1), Reg::Arg(1));
        assert_eq!(Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                   Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1)));
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass** (these are pure type/data tests — no impl gap)

Run: `cargo test -p redextape-core tm::asm`
Expected: PASS — 2 tests.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/src/tm.rs crates/redextape-core/src/tm/asm.rs \
        crates/redextape-core/src/lib.rs
git commit -m "feat(tm): add the register-assembly IR types"
```

---

### Task 2: `print_asm` — the readable printer

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`

**Interfaces:**
- Consumes: `Program`, `Instr`, `Reg`, `core::BinOp`.
- Produces: `print_asm(&Program) -> String`.

Format (exact, so goldens are stable): a label definition prints as `{name}:` at column 0; every
instruction prints indented 4 spaces. `Reg` prints as `r{n}` / `a{n}` / `rr`. Mnemonics: `li rd, #n`,
`mov rd, rs`, arithmetic/compare `{op} rd, ra, rb` with op ∈ {`add`,`sub`,`mul`, `cmpeq`,`cmpne`,
`cmplt`,`cmple`,`cmpgt`,`cmpge`}, `jz r, L`, `jmp L`, `call L`, `ret`, `halt`, `nil rd`,
`cons rd, rh, rt`, `head rd, rl`, `tail rd, rl`, `isempty rd, rl`. Lines are `\n`-separated with a
trailing newline.

- [ ] **Step 1: Write the failing golden test**

Add to the `tests` module in `asm.rs`:

```rust
    #[test]
    fn print_asm_is_a_stable_readable_listing() {
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Arg(0), 5),
                Instr::Call("sum".to_string()),
                Instr::Halt,
                Instr::Mov(Reg::Loc(0), Reg::Arg(0)),
                Instr::Bin(BinOp::Eq, Reg::Loc(1), Reg::Loc(0), Reg::Loc(0)),
                Instr::Jz(Reg::Loc(1), "rec".to_string()),
                Instr::Ret,
            ],
            labels: vec![("sum".to_string(), 3), ("rec".to_string(), 6)],
        };
        let expected = "\
    li a0, #5
    call sum
    halt
sum:
    mov r0, a0
    cmpeq r1, r0, r0
    jz r1, rec
rec:
    ret
";
        assert_eq!(print_asm(&prog), expected);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core tm::asm::tests::print_asm_is_a_stable_readable_listing`
Expected: FAIL — `cannot find function 'print_asm'`.

- [ ] **Step 3: Implement `print_asm`**

Add above the `#[cfg(test)]` module in `asm.rs`:

```rust
use std::fmt::Write as _;

fn reg_str(r: Reg) -> String {
    match r {
        Reg::Loc(n) => format!("r{n}"),
        Reg::Arg(n) => format!("a{n}"),
        Reg::Rr => "rr".to_string(),
    }
}

fn cmp_mnemonic(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "add",
        BinOp::Sub => "sub",
        BinOp::Mul => "mul",
        BinOp::Eq => "cmpeq",
        BinOp::Ne => "cmpne",
        BinOp::Lt => "cmplt",
        BinOp::Le => "cmple",
        BinOp::Gt => "cmpgt",
        BinOp::Ge => "cmpge",
    }
}

fn instr_str(i: &Instr) -> String {
    match i {
        Instr::Li(rd, n) => format!("li {}, #{n}", reg_str(*rd)),
        Instr::Mov(rd, rs) => format!("mov {}, {}", reg_str(*rd), reg_str(*rs)),
        Instr::Bin(op, rd, ra, rb) => {
            format!("{} {}, {}, {}", cmp_mnemonic(*op), reg_str(*rd), reg_str(*ra), reg_str(*rb))
        }
        Instr::Jz(r, l) => format!("jz {}, {l}", reg_str(*r)),
        Instr::Jmp(l) => format!("jmp {l}"),
        Instr::Call(l) => format!("call {l}"),
        Instr::Ret => "ret".to_string(),
        Instr::Halt => "halt".to_string(),
        Instr::Nil(rd) => format!("nil {}", reg_str(*rd)),
        Instr::Cons(rd, rh, rt) => {
            format!("cons {}, {}, {}", reg_str(*rd), reg_str(*rh), reg_str(*rt))
        }
        Instr::Head(rd, rl) => format!("head {}, {}", reg_str(*rd), reg_str(*rl)),
        Instr::Tail(rd, rl) => format!("tail {}, {}", reg_str(*rd), reg_str(*rl)),
        Instr::IsEmpty(rd, rl) => format!("isempty {}, {}", reg_str(*rd), reg_str(*rl)),
    }
}

/// Render a `Program` as the readable assembly listing (labels at column 0, instructions indented).
pub fn print_asm(prog: &Program) -> String {
    let mut out = String::new();
    for (idx, instr) in prog.code.iter().enumerate() {
        for (name, at) in &prog.labels {
            if *at == idx {
                let _ = writeln!(out, "{name}:");
            }
        }
        let _ = writeln!(out, "    {}", instr_str(instr));
    }
    // Any labels pointing one past the end (e.g. a trailing skip target) still print.
    for (name, at) in &prog.labels {
        if *at == prog.code.len() {
            let _ = writeln!(out, "{name}:");
        }
    }
    out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core tm::asm`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs
git commit -m "feat(tm): add print_asm, the readable assembly printer"
```

---

### Task 3: the asm interpreter — arithmetic, control flow, calls

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`

**Interfaces:**
- Consumes: `Program`, `Instr`, `Reg`, `core::BinOp`.
- Produces:
  - `Caps { steps: u64, stack: u64, heap: u64 }` and `DEFAULT_CAPS`.
  - `AsmOutcome { result: u64, heap: Vec<(u64, u64)> }` — the result word + the heap (cons cells).
  - `AsmRun { Ran(AsmOutcome), HitCap, Fault(String) }`.
  - `run_asm(&Program, Caps) -> AsmRun` — executes the register machine.

Register model: three banks — `locals: Vec<u64>` (frame-saved across `call`), `args: Vec<u64>`
(volatile), and `rr: u64`. `call` pushes a `Frame { ret_pc, saved_locals }` and jumps to the label;
`ret` pops it, restoring `locals` and `pc` (`rr` and `args` are not saved). Vectors grow on demand
(default `0`). `Bin` uses the same saturating/monus arithmetic as the reference interpreter.

This task covers everything except the list/heap instructions (Task 4).

- [ ] **Step 1: Write the failing tests (hand-written asm programs)**

Add to the `tests` module in `asm.rs`:

```rust
    fn run(prog: Program) -> AsmRun {
        run_asm(&prog, DEFAULT_CAPS)
    }

    fn ran(prog: Program) -> u64 {
        match run(prog) {
            AsmRun::Ran(o) => o.result,
            other => panic!("expected Ran, got {other:?}"),
        }
    }

    #[test]
    fn evaluates_straight_line_arithmetic() {
        // rr = (2 + 3) * 4 = 20
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
        assert_eq!(ran(prog), 20);
    }

    #[test]
    fn subtraction_is_monus() {
        // rr = 3 - 5 = 0 (truncated)
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 3),
                Instr::Li(Reg::Loc(1), 5),
                Instr::Bin(BinOp::Sub, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(ran(prog), 0);
    }

    #[test]
    fn jz_and_jmp_branch() {
        // if (1 == 2) rr = 10 else rr = 20  -> 20
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
        assert_eq!(ran(prog), 20);
    }

    #[test]
    fn recursive_call_preserves_locals_across_the_call() {
        // sum(n) = if n==0 {0} else { n + sum(n-1) };  sum(5) == 15
        // a0 holds the argument; each activation copies it to r0 (a frame-saved local).
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Arg(0), 5),
                Instr::Call("sum".to_string()),
                Instr::Halt,
                // sum:
                Instr::Mov(Reg::Loc(0), Reg::Arg(0)),                       // r0 = n
                Instr::Li(Reg::Loc(1), 0),
                Instr::Bin(BinOp::Eq, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1)),
                Instr::Jz(Reg::Loc(2), "rec".to_string()),
                Instr::Li(Reg::Rr, 0),
                Instr::Ret,
                // rec:
                Instr::Li(Reg::Loc(3), 1),
                Instr::Bin(BinOp::Sub, Reg::Arg(0), Reg::Loc(0), Reg::Loc(3)), // a0 = n - 1
                Instr::Call("sum".to_string()),                                // rr = sum(n-1)
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Rr),         // n + sum(n-1)
                Instr::Ret,
            ],
            labels: vec![("sum".to_string(), 3), ("rec".to_string(), 9)],
        };
        assert_eq!(ran(prog), 15);
    }

    #[test]
    fn step_cap_stops_an_infinite_loop() {
        // loop: jmp loop
        let prog = Program {
            code: vec![Instr::Jmp("loop".to_string())],
            labels: vec![("loop".to_string(), 0)],
        };
        assert!(matches!(run_asm(&prog, Caps { steps: 1000, ..DEFAULT_CAPS }), AsmRun::HitCap));
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::asm`
Expected: FAIL — `cannot find function 'run_asm'`.

- [ ] **Step 3: Implement the interpreter (no list/heap ops yet)**

Add above the `#[cfg(test)]` module in `asm.rs`:

```rust
/// Resource caps for `run_asm`, mirroring the reference interpreter's budget/depth guards.
#[derive(Clone, Copy, Debug)]
pub struct Caps {
    pub steps: u64,
    pub stack: u64,
    pub heap: u64,
}

/// Generous defaults: the demo suite terminates well within these; runaway programs hit a cap.
pub const DEFAULT_CAPS: Caps = Caps { steps: 5_000_000, stack: 100_000, heap: 5_000_000 };

/// The result of a completed run: the word in `rr` plus the heap needed to reconstruct a list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AsmOutcome {
    pub result: u64,
    pub heap: Vec<(u64, u64)>,
}

/// Why a run ended.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AsmRun {
    /// Ran to `halt`.
    Ran(AsmOutcome),
    /// Hit a step / stack / heap cap.
    HitCap,
    /// A runtime fault (e.g. `head` of nil) — matches a reference `RunError::Runtime`.
    Fault(String),
}

struct Frame {
    ret_pc: usize,
    saved_locals: Vec<u64>,
}

struct Vm {
    locals: Vec<u64>,
    args: Vec<u64>,
    rr: u64,
    heap: Vec<(u64, u64)>,
    stack: Vec<Frame>,
    pc: usize,
    steps: u64,
    caps: Caps,
}

impl Vm {
    fn read(&self, r: Reg) -> u64 {
        match r {
            Reg::Loc(n) => self.locals.get(n as usize).copied().unwrap_or(0),
            Reg::Arg(n) => self.args.get(n as usize).copied().unwrap_or(0),
            Reg::Rr => self.rr,
        }
    }

    fn write(&mut self, r: Reg, v: u64) {
        match r {
            Reg::Loc(n) => grow_set(&mut self.locals, n as usize, v),
            Reg::Arg(n) => grow_set(&mut self.args, n as usize, v),
            Reg::Rr => self.rr = v,
        }
    }
}

fn grow_set(v: &mut Vec<u64>, i: usize, val: u64) {
    if i >= v.len() {
        v.resize(i + 1, 0);
    }
    v[i] = val;
}

fn eval_bin(op: BinOp, a: u64, b: u64) -> u64 {
    match op {
        BinOp::Add => a.saturating_add(b),
        BinOp::Sub => a.saturating_sub(b), // monus
        BinOp::Mul => a.saturating_mul(b),
        BinOp::Eq => u64::from(a == b),
        BinOp::Ne => u64::from(a != b),
        BinOp::Lt => u64::from(a < b),
        BinOp::Le => u64::from(a <= b),
        BinOp::Gt => u64::from(a > b),
        BinOp::Ge => u64::from(a >= b),
    }
}

/// Execute `prog` starting at index 0, bounded by `caps`. Never panics, never hangs.
pub fn run_asm(prog: &Program, caps: Caps) -> AsmRun {
    let mut vm = Vm {
        locals: Vec::new(),
        args: Vec::new(),
        rr: 0,
        heap: Vec::new(),
        stack: Vec::new(),
        pc: 0,
        steps: 0,
        caps,
    };
    loop {
        if vm.steps >= vm.caps.steps {
            return AsmRun::HitCap;
        }
        vm.steps += 1;
        let Some(instr) = prog.code.get(vm.pc) else {
            // Falling off the end without `halt`/`ret` is an internal lowering invariant violation;
            // treat defensively as a fault rather than a panic.
            return AsmRun::Fault("ran past end of program".to_string());
        };
        match instr {
            Instr::Li(rd, n) => {
                vm.write(*rd, *n);
                vm.pc += 1;
            }
            Instr::Mov(rd, rs) => {
                let v = vm.read(*rs);
                vm.write(*rd, v);
                vm.pc += 1;
            }
            Instr::Bin(op, rd, ra, rb) => {
                let v = eval_bin(*op, vm.read(*ra), vm.read(*rb));
                vm.write(*rd, v);
                vm.pc += 1;
            }
            Instr::Jz(r, l) => {
                if vm.read(*r) == 0 {
                    match prog.label_index(l) {
                        Some(i) => vm.pc = i,
                        None => return AsmRun::Fault(format!("undefined label `{l}`")),
                    }
                } else {
                    vm.pc += 1;
                }
            }
            Instr::Jmp(l) => match prog.label_index(l) {
                Some(i) => vm.pc = i,
                None => return AsmRun::Fault(format!("undefined label `{l}`")),
            },
            Instr::Call(l) => {
                if vm.stack.len() as u64 >= vm.caps.stack {
                    return AsmRun::HitCap;
                }
                let Some(target) = prog.label_index(l) else {
                    return AsmRun::Fault(format!("undefined label `{l}`"));
                };
                vm.stack.push(Frame { ret_pc: vm.pc + 1, saved_locals: vm.locals.clone() });
                vm.pc = target;
            }
            Instr::Ret => match vm.stack.pop() {
                Some(frame) => {
                    vm.locals = frame.saved_locals;
                    vm.pc = frame.ret_pc;
                }
                // `ret` with an empty stack ends the program (equivalent to `halt`).
                None => return AsmRun::Ran(AsmOutcome { result: vm.rr, heap: vm.heap }),
            },
            Instr::Halt => return AsmRun::Ran(AsmOutcome { result: vm.rr, heap: vm.heap }),
            // List/heap instructions arrive in Task 4.
            Instr::Nil(_) | Instr::Cons(..) | Instr::Head(..) | Instr::Tail(..) | Instr::IsEmpty(..) => {
                return AsmRun::Fault("list op not yet implemented".to_string());
            }
        }
    }
}
```

> **Implementer note:** `AsmOutcome` owns `heap` by move on `Ran`; that is fine because it is the last
> use of `vm.heap`. If the borrow checker objects, `std::mem::take(&mut vm.heap)`.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::asm`
Expected: PASS — all Task 3 tests (plus Tasks 1–2).

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs
git commit -m "feat(tm): add the asm interpreter (arithmetic, control flow, calls)"
```

---

### Task 4: list/heap instructions in the interpreter

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`

**Interfaces:**
- Consumes: the `Vm` from Task 3.
- Produces: `Nil`/`Cons`/`Head`/`Tail`/`IsEmpty` execution. Heap model: a pointer `p` is `0` for nil,
  else refers to `heap[p - 1]`; `cons` appends a `(head, tail)` cell and returns `heap.len()` (the new
  1-based pointer). `head`/`tail` of `0` → `AsmRun::Fault`.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `asm.rs`:

```rust
    #[test]
    fn builds_and_reads_a_list() {
        // rr = head(tail(cons(1, cons(2, nil)))) == 2
        let prog = Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),                                  // r0 = nil
                Instr::Li(Reg::Loc(1), 2),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)),       // r2 = cons(2, nil)
                Instr::Li(Reg::Loc(3), 1),
                Instr::Cons(Reg::Loc(4), Reg::Loc(3), Reg::Loc(2)),       // r4 = cons(1, r2)
                Instr::Tail(Reg::Loc(5), Reg::Loc(4)),                    // r5 = tail(r4)
                Instr::Head(Reg::Rr, Reg::Loc(5)),                        // rr = head(r5) = 2
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(ran(prog), 2);
    }

    #[test]
    fn is_empty_distinguishes_nil_from_cons() {
        let prog = Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),
                Instr::IsEmpty(Reg::Rr, Reg::Loc(0)), // 1
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(ran(prog), 1);
    }

    #[test]
    fn head_of_nil_is_a_fault() {
        let prog = Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        };
        assert!(matches!(run(prog), AsmRun::Fault(_)));
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::asm`
Expected: FAIL — `builds_and_reads_a_list` etc. hit the "list op not yet implemented" fault.

- [ ] **Step 3: Implement the list/heap arm**

Replace the placeholder list arm in `run_asm` with:

```rust
            Instr::Nil(rd) => {
                vm.write(*rd, 0);
                vm.pc += 1;
            }
            Instr::Cons(rd, rh, rt) => {
                if vm.heap.len() as u64 >= vm.caps.heap {
                    return AsmRun::HitCap;
                }
                let (h, t) = (vm.read(*rh), vm.read(*rt));
                vm.heap.push((h, t));
                let ptr = vm.heap.len() as u64; // 1-based
                vm.write(*rd, ptr);
                vm.pc += 1;
            }
            Instr::Head(rd, rl) => {
                let p = vm.read(*rl);
                if p == 0 {
                    return AsmRun::Fault("head of empty list".to_string());
                }
                let h = vm.heap[(p - 1) as usize].0;
                vm.write(*rd, h);
                vm.pc += 1;
            }
            Instr::Tail(rd, rl) => {
                let p = vm.read(*rl);
                if p == 0 {
                    return AsmRun::Fault("tail of empty list".to_string());
                }
                let t = vm.heap[(p - 1) as usize].1;
                vm.write(*rd, t);
                vm.pc += 1;
            }
            Instr::IsEmpty(rd, rl) => {
                let empty = u64::from(vm.read(*rl) == 0);
                vm.write(*rd, empty);
                vm.pc += 1;
            }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::asm`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs
git commit -m "feat(tm): add list/heap ops to the asm interpreter"
```

---

### Task 5: `decode_asm` — type-directed outcome → `Value`

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`

**Interfaces:**
- Consumes: `AsmOutcome`, `value::Value`.
- Produces: `decode_asm(&AsmOutcome, expected: &Value) -> Option<Value>` — reads the outcome according
  to the *type/shape* of `expected` (the reference result), returning the **actual** decoded value.

Mirrors the λ backend's type-directed `decode`: a raw word is ambiguous (`0` could be `Nat(0)`,
`Bool(false)`, or nil), so `expected` supplies the type witness — but only its *shape*, never its
contents, so a wrong answer still decodes to a *different* `Value` (or `None`).

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `asm.rs`:

```rust
    use crate::value::Value;

    #[test]
    fn decodes_nat_and_bool_by_expected_shape() {
        let o = AsmOutcome { result: 5, heap: vec![] };
        assert_eq!(decode_asm(&o, &Value::Nat(0)), Some(Value::Nat(5))); // shape only, not contents
        let t = AsmOutcome { result: 1, heap: vec![] };
        assert_eq!(decode_asm(&t, &Value::Bool(false)), Some(Value::Bool(true)));
        // The identical word `0` decodes differently under different expectations:
        let z = AsmOutcome { result: 0, heap: vec![] };
        assert_eq!(decode_asm(&z, &Value::Nat(9)), Some(Value::Nat(0)));
        assert_eq!(decode_asm(&z, &Value::Bool(true)), Some(Value::Bool(false)));
        assert_eq!(decode_asm(&z, &Value::Nil), Some(Value::Nil));
    }

    #[test]
    fn decodes_a_list_by_following_the_heap() {
        // heap encodes cons(1, cons(2, nil)); result points at the outer cell.
        let o = AsmOutcome { result: 2, heap: vec![(2, 0), (1, 1)] };
        assert_eq!(
            decode_asm(&o, &Value::list_of_nats(&[1, 2])),
            Some(Value::list_of_nats(&[1, 2]))
        );
    }

    #[test]
    fn wrong_shape_decodes_to_none() {
        // A Bool word > 1 under a Bool expectation is not a valid bool.
        let bad = AsmOutcome { result: 7, heap: vec![] };
        assert_eq!(decode_asm(&bad, &Value::Bool(false)), None);
        // Non-first-class expectations never decode.
        let o = AsmOutcome { result: 0, heap: vec![] };
        assert_eq!(decode_asm(&o, &Value::Unit), None);
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::asm`
Expected: FAIL — `cannot find function 'decode_asm'`.

- [ ] **Step 3: Implement `decode_asm`**

Add above the `#[cfg(test)]` module in `asm.rs`:

```rust
use crate::value::Value;
use std::rc::Rc;

/// Decode a completed run's outcome to a `Value`, guided by the *shape* of `expected`. Returns the
/// actual decoded value (equal to `expected` iff the machine computed the right answer), or `None`.
pub fn decode_asm(outcome: &AsmOutcome, expected: &Value) -> Option<Value> {
    decode_word(outcome.result, &outcome.heap, expected)
}

fn decode_word(word: u64, heap: &[(u64, u64)], expected: &Value) -> Option<Value> {
    match expected {
        Value::Nat(_) => Some(Value::Nat(word)),
        Value::Bool(_) => match word {
            0 => Some(Value::Bool(false)),
            1 => Some(Value::Bool(true)),
            _ => None,
        },
        Value::Nil => {
            if word == 0 {
                Some(Value::Nil)
            } else {
                None
            }
        }
        Value::Cons(exp_h, exp_t) => {
            if word == 0 {
                return None; // expected a cons, got nil
            }
            let &(h, t) = heap.get((word - 1) as usize)?;
            let head = decode_word(h, heap, exp_h)?;
            let tail = decode_word(t, heap, exp_t)?;
            Some(Value::Cons(Rc::new(head), Rc::new(tail)))
        }
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) => None,
    }
}
```

> **Implementer note:** move the existing `use crate::core::BinOp;` and add `use crate::value::Value;`
> at the top of the file; the `tests` module's `use crate::value::Value;` can then be removed to avoid
> a duplicate-import warning. Recursion depth here is bounded by the list length (the heap is acyclic —
> `cons` only ever points at earlier cells), so no guard is needed for well-formed outcomes.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::asm`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs
git commit -m "feat(tm): decode an asm outcome back to a Value, type-directed"
```

---

### Task 6: `lower_asm` — the functional first-order core

**Files:**
- Create: `crates/redextape-core/src/tm/lower_asm.rs`
- Modify: `crates/redextape-core/src/tm.rs` (add `pub mod lower_asm;`)

**Interfaces:**
- Consumes: `core::{BinOp, Core, NodeId}`, `asm::{Instr, Program, Reg}`.
- Produces:
  - `LowerError { Unsupported { node: NodeId, what: String }, TooDeep { node: NodeId } }`.
  - `lower_asm(&Core) -> Result<Program, LowerError>` — for this task, the **pure** subset: `Nat`,
    `Bool`, `Var` (locals + `nil`), `BinOp`, `If`, `Let { mutable: false }`, `Seq`. Mutation
    (`Let{mutable:true}`, `Assign`, `While`), calls (`Apply`, `LetRec`, `Lambda`), the list builtins,
    and `Unit` return `Unsupported` for now (added in Tasks 7–9).

The lowering threads a `Ctx` with a lexical scope (name → `Reg::Loc`), a local-register counter, a
fresh-label counter, and a `depth` guard. The core primitive is `lower_into(ctx, core, dst)`, which
emits code leaving `core`'s value in register `dst`.

- [ ] **Step 1: Write the failing tests (end-to-end via the interpreter + decode)**

Create `crates/redextape-core/src/tm/lower_asm.rs` with tests first:

```rust
//! Core AST -> register-assembly `Program`, first-order subset. Syntax-directed and total (returns
//! `LowerError`, never panics). Emitted code leaves the whole program's result in `Reg::Rr` and ends
//! with `Halt`; each function is emitted inline, jumped over during linear flow and entered by `Call`.

use crate::core::{Core, NodeId};
use crate::tm::asm::{Instr, Program, Reg};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::tm::asm::{decode_asm, run_asm, AsmRun, DEFAULT_CAPS};
    use crate::value::Value;

    /// source -> desugar -> lower_asm -> run_asm -> decode_asm, using the reference result as the
    /// type witness. Returns the decoded value (equals the reference iff asm computed the right one).
    fn run(src: &str) -> Value {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let expected = crate::run(src).expect("reference run failed");
        let program = lower_asm(&core).expect("lowering failed");
        match run_asm(&program, DEFAULT_CAPS) {
            AsmRun::Ran(o) => decode_asm(&o, &expected).expect("decode failed"),
            other => panic!("asm did not run: {other:?}"),
        }
    }

    #[test]
    fn arithmetic_and_monus() {
        assert_eq!(run("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(run("3 - 5"), Value::Nat(0));
    }

    #[test]
    fn comparisons_and_if() {
        assert_eq!(run("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(run("if 1 == 2 { 10 } else { 20 }"), Value::Nat(20));
    }

    #[test]
    fn let_bindings() {
        assert_eq!(run("let x = 40; x + 2"), Value::Nat(42));
        assert_eq!(run("let x = 1; let y = x + x; y * 3"), Value::Nat(6));
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::lower_asm`
Expected: FAIL — `cannot find function 'lower_asm'`.

- [ ] **Step 3: Implement the `Ctx` + the pure lowering**

Add above the `#[cfg(test)]` module in `lower_asm.rs`:

```rust
/// Why lowering could not produce a program.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LowerError {
    /// A construct the first-order TM backend does not support (e.g. a function used as a value).
    Unsupported { node: NodeId, what: String },
    /// Core nested deeper than the lowering guard allows (bounds native recursion).
    TooDeep { node: NodeId },
}

/// Bounds `lower_into` recursion so a deeply-nested Core (a huge list literal desugars to a deep
/// `cons`-`Apply` spine) yields `TooDeep` instead of overflowing the native stack. Tuned like the
/// Plan 1 guards (well under the debug crash depth on an 8 MiB stack).
const MAX_LOWER_DEPTH: u32 = 400;

struct Ctx {
    code: Vec<Instr>,
    labels: Vec<(String, usize)>,
    /// Lexical scopes of value bindings: name -> local register. Innermost last.
    scopes: Vec<Vec<(String, Reg)>>,
    next_local: u32,
    next_label: u32,
    depth: u32,
}

impl Ctx {
    fn new() -> Self {
        Ctx { code: Vec::new(), labels: Vec::new(), scopes: vec![Vec::new()], next_local: 0, next_label: 0, depth: 0 }
    }

    fn emit(&mut self, i: Instr) {
        self.code.push(i);
    }

    fn fresh_local(&mut self) -> Reg {
        let r = Reg::Loc(self.next_local);
        self.next_local += 1;
        r
    }

    fn fresh_label(&mut self, hint: &str) -> String {
        let l = format!("{hint}{}", self.next_label);
        self.next_label += 1;
        l
    }

    /// Bind `name` to a fresh local in the current scope and return that register.
    fn bind(&mut self, name: &str) -> Reg {
        let r = self.fresh_local();
        self.scopes.last_mut().unwrap().push((name.to_string(), r));
        r
    }

    /// Resolve a value binding (innermost first).
    fn resolve(&self, name: &str) -> Option<Reg> {
        for scope in self.scopes.iter().rev() {
            if let Some((_, r)) = scope.iter().rev().find(|(n, _)| n == name) {
                return Some(*r);
            }
        }
        None
    }

    /// Place a label at the current end of `code`.
    fn place(&mut self, label: &str) {
        self.labels.push((label.to_string(), self.code.len()));
    }
}

/// Lower a whole program: compute its value into `Rr`, then `Halt`.
pub fn lower_asm(core: &Core) -> Result<Program, LowerError> {
    let mut ctx = Ctx::new();
    lower_into(&mut ctx, core, Reg::Rr)?;
    ctx.emit(Instr::Halt);
    Ok(Program { code: ctx.code, labels: ctx.labels })
}

/// Emit code that computes `core` into register `dst`.
fn lower_into(ctx: &mut Ctx, core: &Core, dst: Reg) -> Result<(), LowerError> {
    ctx.depth += 1;
    if ctx.depth > MAX_LOWER_DEPTH {
        ctx.depth -= 1;
        return Err(LowerError::TooDeep { node: core.id() });
    }
    let r = lower_inner(ctx, core, dst);
    ctx.depth -= 1;
    r
}

fn lower_inner(ctx: &mut Ctx, core: &Core, dst: Reg) -> Result<(), LowerError> {
    match core {
        Core::Nat(_, n) => {
            ctx.emit(Instr::Li(dst, *n));
            Ok(())
        }
        Core::Bool(_, b) => {
            ctx.emit(Instr::Li(dst, u64::from(*b)));
            Ok(())
        }
        Core::Var(id, name) => {
            if name == "nil" && ctx.resolve(name).is_none() {
                ctx.emit(Instr::Nil(dst));
                return Ok(());
            }
            match ctx.resolve(name) {
                Some(src) => {
                    if src != dst {
                        ctx.emit(Instr::Mov(dst, src));
                    }
                    Ok(())
                }
                None => Err(LowerError::Unsupported { node: *id, what: format!("unbound `{name}`") }),
            }
        }
        Core::BinOp(_, op, a, b) => {
            let ra = ctx.fresh_local();
            lower_into(ctx, a, ra)?;
            let rb = ctx.fresh_local();
            lower_into(ctx, b, rb)?;
            ctx.emit(Instr::Bin(*op, dst, ra, rb));
            Ok(())
        }
        Core::If(_, c, t, e) => {
            let rc = ctx.fresh_local();
            lower_into(ctx, c, rc)?;
            let else_l = ctx.fresh_label("else");
            let end_l = ctx.fresh_label("endif");
            ctx.emit(Instr::Jz(rc, else_l.clone()));
            lower_into(ctx, t, dst)?;
            ctx.emit(Instr::Jmp(end_l.clone()));
            ctx.place(&else_l);
            lower_into(ctx, e, dst)?;
            ctx.place(&end_l);
            Ok(())
        }
        Core::Let { name, mutable: false, value, body, .. } => {
            let slot = ctx.fresh_local();
            lower_into(ctx, value, slot)?;
            ctx.scopes.push(vec![(name.clone(), slot)]);
            let r = lower_into(ctx, body, dst);
            ctx.scopes.pop();
            r
        }
        Core::Seq(_, first, then) => {
            let throwaway = ctx.fresh_local();
            lower_into(ctx, first, throwaway)?;
            lower_into(ctx, then, dst)
        }
        // Mutation, calls, list builtins, and Unit arrive in Tasks 7–9.
        other => Err(LowerError::Unsupported {
            node: other.id(),
            what: "construct not yet lowered (Tasks 7–9)".to_string(),
        }),
    }
}
```

Add to `crates/redextape-core/src/tm.rs`:

```rust
pub mod lower_asm;
```

> **Implementer notes:**
> - `Var` resolves value bindings; the prelude name `nil` (when not shadowed) lowers to `Instr::Nil`.
>   `cons`/`head`/`tail`/`is_empty` are handled in `Apply` (Task 9), not here.
> - The `else`/`endif` labels are made unique per `if` via the counter, so nested/sequential `if`s do
>   not collide.
> - `lower_into` guards depth; the `.id()` accessor exists on `Core` (Plan 1).

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::lower_asm`
Expected: PASS — the three pure-subset tests.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean. (`LowerError::TooDeep` is not yet constructed on any *tested* path but is reachable;
if clippy flags the `what` field or a variant as unused, it is used by later tasks — keep it.)

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/lower_asm.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): lower the functional first-order core to asm"
```

---

### Task 7: `lower_asm` — `let mut`, assignment, `while`

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_asm.rs`

**Interfaces:**
- Consumes: the `Ctx` from Task 6.
- Produces: lowering for `Let { mutable: true }`, `Assign`, `While`, and `Unit`. A mutable binding is
  just a local register (the interpreter treats every binding as a slot); `Assign(name, e)` computes
  `e` into the variable's existing register; `While(c, b)` is a labelled loop; `Unit` writes `0` into
  `dst` (its word is never compared — `decode_asm` returns `None` for `Value::Unit`).

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `lower_asm.rs`:

```rust
    #[test]
    fn while_loop_and_mutation() {
        // count_down's loop body inlined (a top-level call needs Task 8).
        let inline = "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc";
        assert_eq!(run(inline), Value::Nat(4));
    }

    #[test]
    fn assignment_updates_in_place() {
        assert_eq!(run("let mut x = 1; x = x + 10; x = x * 2; x"), Value::Nat(22));
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::lower_asm`
Expected: FAIL — `Unsupported` for `Let{mutable:true}` / `While`.

- [ ] **Step 3: Implement the mutation arms**

In `lower_inner`, add these match arms (before the catch-all `other =>`):

```rust
        Core::Let { name, mutable: true, value, body, .. } => {
            let slot = ctx.fresh_local();
            lower_into(ctx, value, slot)?;
            ctx.scopes.push(vec![(name.clone(), slot)]);
            let r = lower_into(ctx, body, dst);
            ctx.scopes.pop();
            r
        }
        Core::Assign(id, name, value) => {
            let slot = ctx
                .resolve(name)
                .ok_or_else(|| LowerError::Unsupported { node: *id, what: format!("assign to unbound `{name}`") })?;
            lower_into(ctx, value, slot)?; // recompute into the variable's own register
            ctx.emit(Instr::Li(dst, 0)); // the assignment expression's Unit result
            Ok(())
        }
        Core::While(_, cond, body) => {
            let top = ctx.fresh_label("while");
            let done = ctx.fresh_label("endwhile");
            ctx.place(&top);
            let rc = ctx.fresh_local();
            lower_into(ctx, cond, rc)?;
            ctx.emit(Instr::Jz(rc, done.clone()));
            let throwaway = ctx.fresh_local();
            lower_into(ctx, body, throwaway)?;
            ctx.emit(Instr::Jmp(top.clone()));
            ctx.place(&done);
            ctx.emit(Instr::Li(dst, 0)); // the loop's Unit result
            Ok(())
        }
        Core::Unit(_) => {
            ctx.emit(Instr::Li(dst, 0));
            Ok(())
        }
```

> **Implementer note:** an `Assign` recomputes the value directly into the variable's register. Because
> a `Loc` register is frame-saved across `call`, a mutated variable survives any calls the loop body
> makes. `Assign`/`While`/`Unit` all produce the internal unit; their `dst` word is never compared
> (the oracle never decodes a `Value::Unit`).

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::lower_asm`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/lower_asm.rs
git commit -m "feat(tm): lower let-mut, assignment, and while to asm"
```

---

### Task 8: `lower_asm` — recursion, calls, and the first-order boundary

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_asm.rs`

**Interfaces:**
- Consumes: the `Ctx` from Task 7.
- Produces: lowering for `LetRec` (a `fn`), a `Lambda` bound and only ever applied (treated like a
  named function), and `Apply` to a named function. Adds a **function environment** (name → label +
  arity) to `Ctx`. A **function used as a value** (any reference to a function name outside the callee
  position of an `Apply`) → `LowerError::Unsupported` — the first-order boundary.

**Calling convention** (matches the asm interpreter): arguments are placed in `Arg(0..)`; `Call`
saves the caller's `Loc` frame and restores it on `ret`; the result returns in `Rr`. A function is
emitted **inline**, skipped during linear flow by a `jmp`: `jmp skip; f: <body into Rr> ret; skip:`.
On entry a function copies its `Arg(i)` params into fresh `Loc` registers so nested calls may reuse
the arg registers.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `lower_asm.rs`:

```rust
    #[test]
    fn recursion_via_fn() {
        assert_eq!(run("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"), Value::Nat(15));
    }

    #[test]
    fn count_down_with_a_call() {
        let src = "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)";
        assert_eq!(run(src), Value::Nat(4));
    }

    #[test]
    fn directly_applied_lambda_is_a_named_subroutine() {
        assert_eq!(run("let add1 = |x| x + 1; add1(41)"), Value::Nat(42));
    }

    #[test]
    fn function_as_a_value_is_unsupported() {
        // `apply2` receives a function argument -> higher-order -> Unsupported (deferred to 3b).
        let src = "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        assert!(matches!(lower_asm(&core), Err(LowerError::Unsupported { .. })));
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::lower_asm`
Expected: FAIL — `Unsupported` for `LetRec`/`Apply`.

- [ ] **Step 3: Implement functions + calls**

Add a function environment to `Ctx` (extend the struct and `new`):

```rust
struct FnInfo {
    label: String,
    arity: usize,
}
```

Add fields to `Ctx`:

```rust
    /// Function bindings in scope: name -> (label, arity). Innermost scope last.
    fn_scopes: Vec<Vec<(String, FnInfo)>>,
```

Update `Ctx::new` to initialise `fn_scopes: vec![Vec::new()]`, and add helpers:

```rust
    fn resolve_fn(&self, name: &str) -> Option<&FnInfo> {
        for scope in self.fn_scopes.iter().rev() {
            if let Some((_, info)) = scope.iter().rev().find(|(n, _)| n == name) {
                return Some(info);
            }
        }
        None
    }

    fn bind_fn(&mut self, name: &str, label: String, arity: usize) {
        self.fn_scopes.last_mut().unwrap().push((name.to_string(), FnInfo { label, arity }));
    }
```

Add a shared helper that lowers a function definition inline and returns its label:

```rust
/// Emit `params`-arity function `body` as an inline subroutine (jumped over during linear flow).
/// Returns the entry label. The function is registered in `ctx` under `name` before its body is
/// lowered, so it may recurse.
fn lower_function(ctx: &mut Ctx, name: &str, params: &[String], body: &Core) -> Result<String, LowerError> {
    let label = ctx.fresh_label(&format!("{name}."));
    let skip = ctx.fresh_label("skip");
    ctx.bind_fn(name, label.clone(), params.len());
    ctx.emit(Instr::Jmp(skip.clone()));
    ctx.place(&label);
    // Fresh value scope for the body; copy args into fresh locals so nested calls can reuse Arg regs.
    ctx.scopes.push(Vec::new());
    let saved_next = ctx.next_local;
    ctx.next_local = 0; // each activation has its own local space
    for (i, p) in params.iter().enumerate() {
        let slot = ctx.bind(p);
        ctx.emit(Instr::Mov(slot, Reg::Arg(i as u32)));
    }
    lower_into(ctx, body, Reg::Rr)?;
    ctx.emit(Instr::Ret);
    ctx.next_local = saved_next;
    ctx.scopes.pop();
    ctx.place(&skip);
    Ok(label)
}
```

Add these arms to `lower_inner` (before the catch-all):

```rust
        Core::LetRec { name, value, body, .. } => {
            let Core::Lambda(_, params, fn_body) = value.as_ref() else {
                return Err(LowerError::Unsupported {
                    node: core.id(),
                    what: "letrec value is not a function".to_string(),
                });
            };
            reject_fn_value(body, name)?; // the fn name must be call-only in the body
            ctx.fn_scopes.push(Vec::new());
            lower_function(ctx, name, params, fn_body)?;
            let r = lower_into(ctx, body, dst);
            ctx.fn_scopes.pop();
            r
        }
        Core::Lambda(id, ..) => {
            // A bare lambda in value position is a function-as-a-value use (a call-only Let binding
            // is handled by the Let arm above).
            Err(LowerError::Unsupported { node: *id, what: "function used as a value".to_string() })
        }
        Core::Apply(id, callee, args) => {
            let Core::Var(_, fname) = callee.as_ref() else {
                return Err(LowerError::Unsupported {
                    node: *id,
                    what: "call of a non-name (higher-order)".to_string(),
                });
            };
            // Prelude list builtins are handled in Task 9; defer to it if not a known function.
            if let Some(info) = ctx.resolve_fn(fname) {
                if info.arity != args.len() {
                    return Err(LowerError::Unsupported {
                        node: *id,
                        what: format!("arity mismatch calling `{fname}`"),
                    });
                }
                let label = info.label.clone();
                for (i, a) in args.iter().enumerate() {
                    lower_into(ctx, a, Reg::Arg(i as u32))?;
                }
                ctx.emit(Instr::Call(label));
                if dst != Reg::Rr {
                    ctx.emit(Instr::Mov(dst, Reg::Rr));
                }
                Ok(())
            } else {
                lower_builtin_apply(ctx, *id, fname, args, dst) // Task 9
            }
        }
```

**Then delete the catch-all `other => …` arm added in Task 6.** With the three arms above plus the
`Let` replacement below, the match covers all 13 `Core` variants exhaustively (the two
`Let { mutable: … }` arms cover the `bool`), so the catch-all is now an unreachable pattern and would
fail `-D warnings`.

Handle the directly-applied-lambda demo (`let add1 = |x| x+1; add1(41)`): a `Let{mutable:false}`
whose `value` is a `Lambda` and whose bound name is **call-only** in the body lowers as a function.
Replace the Task 6 `Core::Let { mutable: false, .. }` arm with:

```rust
        Core::Let { name, mutable: false, value, body, .. } => {
            if let Core::Lambda(_, params, fn_body) = value.as_ref() {
                if reject_fn_value(body, name).is_ok() {
                    ctx.fn_scopes.push(Vec::new());
                    lower_function(ctx, name, params, fn_body)?;
                    let r = lower_into(ctx, body, dst);
                    ctx.fn_scopes.pop();
                    return r;
                }
                // Otherwise it is used as a value -> Unsupported (fall through to the lambda arm).
            }
            let slot = ctx.fresh_local();
            lower_into(ctx, value, slot)?;
            ctx.scopes.push(vec![(name.clone(), slot)]);
            let r = lower_into(ctx, body, dst);
            ctx.scopes.pop();
            r
        }
```

Add the first-order-boundary check helper (above `lower_asm`):

```rust
/// `Ok(())` iff `fname` is used in `body` only as the callee of an `Apply` (never as a bare value).
/// Any other occurrence is a function-as-a-value use -> `Unsupported`.
fn reject_fn_value(body: &Core, fname: &str) -> Result<(), LowerError> {
    fn walk(c: &Core, fname: &str) -> Option<NodeId> {
        match c {
            Core::Var(id, name) => (name == fname).then_some(*id),
            Core::Apply(_, callee, args) => {
                // The callee being exactly `fname` is allowed; still scan the args.
                let callee_ok = matches!(callee.as_ref(), Core::Var(_, n) if n == fname);
                if !callee_ok
                    && let Some(id) = walk(callee, fname)
                {
                    return Some(id);
                }
                args.iter().find_map(|a| walk(a, fname))
            }
            Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
                walk(a, fname).or_else(|| walk(b, fname))
            }
            Core::If(_, a, b, d) => walk(a, fname).or_else(|| walk(b, fname)).or_else(|| walk(d, fname)),
            Core::Lambda(_, _, b) | Core::Assign(_, _, b) => walk(b, fname),
            Core::Let { value, body, .. } | Core::LetRec { value, body, .. } => {
                walk(value, fname).or_else(|| walk(body, fname))
            }
            Core::Nat(..) | Core::Bool(..) | Core::Unit(..) => None,
        }
    }
    match walk(body, fname) {
        Some(node) => Err(LowerError::Unsupported { node, what: format!("`{fname}` used as a value") }),
        None => Ok(()),
    }
}
```

Add a temporary stub for the Task 9 hook so this task compiles:

```rust
/// List/prelude builtins (`cons`/`head`/`tail`/`is_empty`) — implemented in Task 9.
fn lower_builtin_apply(_ctx: &mut Ctx, id: NodeId, name: &str, _args: &[Core], _dst: Reg) -> Result<(), LowerError> {
    Err(LowerError::Unsupported { node: id, what: format!("call of unknown function `{name}`") })
}
```

> **Implementer notes:**
> - `next_local` is reset per function activation and restored afterward, so each function's locals
>   number from 0 (they live in distinct frames at run time).
> - `reject_fn_value` returns the offending node id so the diagnostic points at the misuse.
> - The demo `apply2(add1, 5)` fails because inside `apply2`'s body `f` is applied but `f` is a
>   *parameter* (not a bound function) — `resolve_fn("f")` is `None`, so the `Apply` falls to
>   `lower_builtin_apply` and errors `Unsupported`. (`add1` passed as an argument to `apply2` also
>   trips `reject_fn_value` at that call site.)

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::lower_asm`
Expected: PASS — recursion, count_down, add1, and the Unsupported rejection.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/lower_asm.rs
git commit -m "feat(tm): lower recursion, calls, and the first-order boundary to asm"
```

---

### Task 9: `lower_asm` — list builtins

**Files:**
- Modify: `crates/redextape-core/src/tm/lower_asm.rs`

**Interfaces:**
- Consumes: the `Ctx` + the `lower_builtin_apply` hook from Task 8.
- Produces: lowering `cons`/`head`/`tail`/`is_empty` applications to the heap instructions. (`nil` is
  already handled as a `Var` in Task 6.) An unknown callee remains `Unsupported`.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `lower_asm.rs`:

```rust
    #[test]
    fn list_builtins_and_literals() {
        assert_eq!(run("head(cons(7, nil))"), Value::Nat(7));
        assert_eq!(run("is_empty(nil)"), Value::Bool(true));
        assert_eq!(run("is_empty(cons(1, nil))"), Value::Bool(false));
        assert_eq!(run("[1, 2, 3]"), Value::list_of_nats(&[1, 2, 3]));
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core tm::lower_asm`
Expected: FAIL — `Unsupported` for `cons`/`head`/etc.

- [ ] **Step 3: Implement `lower_builtin_apply`**

Replace the Task 8 stub with:

```rust
/// Lower a prelude list builtin applied to `args`, or `Unsupported` for an unknown callee. `nil` in
/// callee position is unusual (it is a value, handled as a `Var`), so only the functions appear here.
fn lower_builtin_apply(ctx: &mut Ctx, id: NodeId, name: &str, args: &[Core], dst: Reg) -> Result<(), LowerError> {
    // Any of these being shadowed by a local binding is a function-as-a-value use we do not support.
    let expected_arity = match name {
        "cons" => 2,
        "head" | "tail" | "is_empty" => 1,
        _ => return Err(LowerError::Unsupported { node: id, what: format!("call of unknown function `{name}`") }),
    };
    if args.len() != expected_arity {
        return Err(LowerError::Unsupported { node: id, what: format!("arity mismatch calling `{name}`") });
    }
    // Lower the argument expressions into fresh locals first.
    let mut regs = Vec::with_capacity(args.len());
    for a in args {
        let r = ctx.fresh_local();
        lower_into(ctx, a, r)?;
        regs.push(r);
    }
    match name {
        "cons" => ctx.emit(Instr::Cons(dst, regs[0], regs[1])),
        "head" => ctx.emit(Instr::Head(dst, regs[0])),
        "tail" => ctx.emit(Instr::Tail(dst, regs[0])),
        "is_empty" => ctx.emit(Instr::IsEmpty(dst, regs[0])),
        _ => unreachable!("arity table and dispatch agree"),
    }
    Ok(())
}
```

> **Implementer note:** `[1, 2, 3]` desugars (Plan 1) to `cons(1, cons(2, cons(3, nil)))`, a nest of
> `Apply(Var("cons"), …)` bottoming out at `Var("nil")` — so this arm plus the Task 6 `nil` handling
> covers list literals. Deep list literals are bounded by `MAX_LOWER_DEPTH` (→ `TooDeep`), never a
> native overflow.

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p redextape-core tm::lower_asm`
Expected: PASS.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/lower_asm.rs
git commit -m "feat(tm): lower list builtins to the heap instructions"
```

---

### Task 10: re-exports + the Part 1 oracle (reference == asm-interp)

**Files:**
- Modify: `crates/redextape-core/src/tm.rs` (re-exports)
- Create: `crates/redextape-core/tests/asm_oracle.rs`

**Interfaces:**
- Consumes: everything above, plus Plan 1's `run`, `parse`, `desugar`.
- Produces: `tm` re-exports and the integration oracle. This is the plan's headline deliverable.

- [ ] **Step 1: Add re-exports to `tm.rs`**

```rust
pub use asm::{decode_asm, print_asm, run_asm, AsmOutcome, AsmRun, Caps, Instr, Program, Reg, DEFAULT_CAPS};
pub use lower_asm::{lower_asm, LowerError};
```

Run: `cargo build -p redextape-core`
Expected: clean.

- [ ] **Step 2: Write the oracle test (demo suite)**

Create `crates/redextape-core/tests/asm_oracle.rs`:

```rust
//! Part 1 of the three-way oracle (spec §12.2): the reference tree-walker and the asm interpreter
//! agree on every first-order demo. This is the intermediate oracle that makes Part 2's TM δ-tables
//! debuggable (a disagreement is localized to Core→asm before the TM even exists).

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{decode_asm, lower_asm, run_asm, AsmRun, DEFAULT_CAPS};
use redextape_core::{run, RunError};

/// Every program the reference runs to a value, the asm backend must run to an outcome that decodes
/// (guided by that value's type) to the SAME value. Reference faults/caps match asm non-`Ran`.
fn assert_asm_agrees(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let program = lower_asm(&core).unwrap_or_else(|e| panic!("lowering failed for {src}: {e:?}"));
    match (reference, run_asm(&program, DEFAULT_CAPS)) {
        (Ok(rv), AsmRun::Ran(o)) => {
            assert_eq!(decode_asm(&o, &rv), Some(rv.clone()), "reference vs asm disagree for: {src}");
        }
        (Err(RunError::Runtime(_)), AsmRun::HitCap | AsmRun::Fault(_)) => {
            // A reference runtime fault/cap matches an asm cap/fault (e.g. head(nil)).
        }
        (r, a) => panic!("oracle mismatch for {src}:\n  reference={r:?}\n  asm={a:?}"),
    }
}

#[test]
fn asm_oracle_on_the_first_order_demo_suite() {
    let demos = [
        "1 + 2 * 3",
        "3 - 5",
        "if 2 > 1 { 10 } else { 20 }",
        "let add1 = |x| x + 1; add1(41)",
        "head(cons(7, nil))",
        "is_empty(nil)",
        "[1, 2, 3]",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    ];
    for src in demos {
        assert_asm_agrees(src);
    }
}

#[test]
fn asm_oracle_on_the_latent_trap_programs() {
    // Plan 2 follow-ups: an immutable `let` shadowing a mutable variable, and a `fn` defined inside a
    // mutation region — both must agree three-way (here: reference == asm).
    assert_asm_agrees("let mut x = 1; x = x + 1; let x = x + 10; x");
    assert_asm_agrees("let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc");
}

#[test]
fn head_of_empty_matches_a_reference_fault() {
    assert_asm_agrees("head(nil)");
}
```

- [ ] **Step 3: Run the oracle**

Run: `cargo test -p redextape-core --test asm_oracle`
Expected: PASS — the demo suite, the latent-trap programs, and the fault case.

- [ ] **Step 4: Write the bounded proptest generator + property**

Add to `crates/redextape-core/tests/asm_oracle.rs`:

```rust
use proptest::prelude::*;

/// A tiny first-order expression generator that stays within every backend's caps: `Nat` literals
/// are bounded (< 1500, the λ-representability bound), nesting is shallow, and it emits only the
/// first-order constructs Part 1 supports (no function-as-a-value, no closures passed as arguments).
fn arb_expr() -> impl Strategy<Value = String> {
    let leaf = (0u64..1500).prop_map(|n| n.to_string());
    leaf.prop_recursive(4, 32, 3, |inner| {
        prop_oneof![
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} + {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} - {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} * {b})")),
            (inner.clone(), inner.clone(), inner.clone())
                .prop_map(|(c, a, b)| format!("if {c} > 0 {{ {a} }} else {{ {b} }}")),
            (inner.clone(), inner).prop_map(|(v, body)| format!("let q = {v}; ({body} + q)")),
        ]
    })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 200, ..ProptestConfig::default() })]

    #[test]
    fn asm_agrees_with_reference_on_random_first_order_programs(src in arb_expr()) {
        // Both must reach the same place: a value that decodes equal, or a shared cap/fault.
        let reference = run(&src);
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty()); // skip anything that does not parse/type-check
        let core = desugar(&prog.unwrap());
        let program = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => return Ok(()), // Unsupported/TooDeep: outside this property's scope
        };
        match (reference, run_asm(&program, DEFAULT_CAPS)) {
            (Ok(rv), AsmRun::Ran(o)) => prop_assert_eq!(decode_asm(&o, &rv), Some(rv)),
            (Err(RunError::Runtime(_)), AsmRun::HitCap | AsmRun::Fault(_)) => {}
            (Err(RunError::Static(_)), _) => {} // unreachable given prop_assume, but harmless
            (r, a) => prop_assert!(false, "mismatch for {}:\n ref={:?}\n asm={:?}", src, r, a),
        }
    }
}
```

- [ ] **Step 5: Run the full test suite + coverage**

Run: `cargo test -p redextape-core`
Expected: PASS — all unit + oracle + proptest.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

Run: `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`
Expected: ≥ 80% line coverage (the oracle + unit tests exercise the interpreter, lowering, print, and
decode). If a specific arm is uncovered, add a targeted unit test for it.

- [ ] **Step 6: Add the deep-Core safety test**

Add to `crates/redextape-core/tests/asm_oracle.rs`:

```rust
#[test]
fn deep_list_literal_lowers_without_overflowing() {
    // A huge list literal desugars to a deep cons-Apply spine. lower_asm must return (Ok or a
    // TooDeep LowerError), never overflow the native stack — run it on a small thread to prove it.
    std::thread::Builder::new()
        .stack_size(512 * 1024)
        .spawn(|| {
            let src = format!("[{}]", vec!["1"; 40_000].join(", "));
            let (prog, ds) = parse(&src);
            assert!(ds.is_empty(), "parse errors: {ds:?}");
            let core = desugar(&prog.unwrap());
            let _ = lower_asm(&core); // Ok or Err — must not abort the process
        })
        .unwrap()
        .join()
        .unwrap();
}
```

Run: `cargo test -p redextape-core --test asm_oracle deep_list_literal_lowers_without_overflowing`
Expected: PASS (no SIGABRT).

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/tm.rs crates/redextape-core/tests/asm_oracle.rs
git commit -m "test(tm): add the reference==asm-interp oracle + proptest + deep-Core safety"
```

---

## Self-review (completed while writing — notes for the executor)

- **Spec coverage (§3):** IR types (Task 1), `print_asm` (Task 2), interpreter incl. calls/recursion
  (Tasks 3–4), type-directed decode (Task 5), Core→asm for every first-order construct — arithmetic/
  compare/if/let/seq (Task 6), mut/while (Task 7), recursion/calls/first-order-boundary (Task 8),
  lists (Task 9), the asm interpreter as intermediate oracle + bounded proptest + latent traps + deep-
  Core safety (Task 10). Deferred by design: `parse_asm` (v2 pane), higher-order/`apply` (3b),
  everything TM-side (Part 2).
- **Type consistency:** `Reg`/`Instr`/`Program`/`AsmRun`/`AsmOutcome`/`Caps`/`DEFAULT_CAPS` are defined
  in Task 1/3 and used verbatim thereafter; `LowerError::{Unsupported, TooDeep}` in Task 6 and reused;
  `lower_builtin_apply` is stubbed in Task 8 with the exact signature Task 9 replaces; `lower_function`
  / `reject_fn_value` / `Ctx` fields are introduced once and reused.
- **Cap/fault matching:** the oracle's accepted arms are `(Ok, Ran)` and `(Runtime, HitCap|Fault)`,
  consistent across the demo test and the proptest; the generator is bounded (`Nat < 1500`, shallow
  nesting) so generated programs terminate within all caps.
- **No placeholders:** every code step shows complete code; the only intentional stub
  (`lower_builtin_apply`, Task 8) is explicitly replaced in Task 9.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-tm-backend-part1-asm.md`. Two execution
options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast
   iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
