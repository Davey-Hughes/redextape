//! The register-assembly IR: a small register machine whose control flow becomes (in Part 2) the
//! Turing machine's state graph, and whose data (registers, stack, heap) becomes tapes. Registers
//! hold `u64` words; because Core is typed, the compiled code statically knows whether a word is a
//! `Nat` count, a `0`/`1` `Bool`, or a heap pointer, so there are no runtime type tags.

use crate::core::BinOp;
use crate::value::Value;
use std::rc::Rc;

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

/// Resource caps for `run_asm`, mirroring the reference interpreter's budget/depth guards.
#[derive(Clone, Copy, Debug)]
pub struct Caps {
    pub steps: u64,
    pub stack: u64,
    pub heap: u64,
    /// Cap on total words held across saved call frames (bounds the per-`Call` `locals` clone
    /// accumulation).
    pub mem: u64,
}

/// Generous defaults: the demo suite terminates well within these; runaway programs hit a cap.
pub const DEFAULT_CAPS: Caps = Caps { steps: 5_000_000, stack: 100_000, heap: 5_000_000, mem: 64_000_000 };

/// Upper bound on a `Reg::Loc`/`Reg::Arg` index. A program with a million registers is absurd (real
/// ones use dozens); this caps each register bank at <= 8 MB, well below allocation-abort territory,
/// while never rejecting a legitimate program.
const MAX_REGISTERS: u32 = 1_000_000;

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
    /// Running total of words held across all frames currently on `stack` (mirrors the sum of
    /// `saved_locals.len()`), tracked incrementally so `Call`/`Ret` stay O(1).
    saved_words: u64,
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

/// True if `r` is a bank register whose index reaches or exceeds `MAX_REGISTERS` (`Rr` never does).
fn reg_over_cap(r: Reg) -> bool {
    match r {
        Reg::Loc(n) | Reg::Arg(n) => n >= MAX_REGISTERS,
        Reg::Rr => false,
    }
}

/// True if any register operand of `i` reaches or exceeds `MAX_REGISTERS`.
fn instr_reg_over_cap(i: &Instr) -> bool {
    match i {
        Instr::Li(rd, _) | Instr::Jz(rd, _) | Instr::Nil(rd) => reg_over_cap(*rd),
        Instr::Mov(a, b) | Instr::Head(a, b) | Instr::Tail(a, b) | Instr::IsEmpty(a, b) => {
            reg_over_cap(*a) || reg_over_cap(*b)
        }
        Instr::Bin(_, a, b, c) | Instr::Cons(a, b, c) => reg_over_cap(*a) || reg_over_cap(*b) || reg_over_cap(*c),
        Instr::Jmp(_) | Instr::Call(_) | Instr::Ret | Instr::Halt => false,
    }
}

/// Execute `prog` starting at index 0, bounded by `caps`. Never panics, never hangs.
pub fn run_asm(prog: &Program, caps: Caps) -> AsmRun {
    // Guard against absurd register indices before running: an unbounded `Reg::Loc(n)`/`Reg::Arg(n)`
    // would make `grow_set` attempt a multi-GB `Vec::resize`, whose allocation failure aborts the
    // process. A one-time O(code) scan keeps `run_asm` safe on any `Program` at no per-step cost.
    if prog.code.iter().any(instr_reg_over_cap) {
        return AsmRun::Fault("register index exceeds MAX_REGISTERS".to_string());
    }
    let mut vm = Vm {
        locals: Vec::new(),
        args: Vec::new(),
        rr: 0,
        heap: Vec::new(),
        stack: Vec::new(),
        pc: 0,
        steps: 0,
        caps,
        saved_words: 0,
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
                // Bound the cumulative words held across saved frames *before* cloning `locals`: a
                // legal-but-large register bank (see `MAX_REGISTERS`) cloned on every self-recursive
                // `Call` can accumulate tens of GB across frames well before the stack-count cap
                // fires, and an allocation failure there aborts the process. Checking first means we
                // never perform the clone that would have pushed us over.
                let prospective = vm.saved_words + vm.locals.len() as u64;
                if prospective > vm.caps.mem {
                    return AsmRun::HitCap;
                }
                vm.stack.push(Frame { ret_pc: vm.pc + 1, saved_locals: vm.locals.clone() });
                vm.saved_words = prospective;
                vm.pc = target;
            }
            Instr::Ret => match vm.stack.pop() {
                Some(frame) => {
                    vm.saved_words -= frame.saved_locals.len() as u64;
                    vm.locals = frame.saved_locals;
                    vm.pc = frame.ret_pc;
                }
                // `ret` with an empty stack ends the program (equivalent to `halt`).
                None => return AsmRun::Ran(AsmOutcome { result: vm.rr, heap: std::mem::take(&mut vm.heap) }),
            },
            Instr::Halt => return AsmRun::Ran(AsmOutcome { result: vm.rr, heap: std::mem::take(&mut vm.heap) }),
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
                // A non-null pointer past the heap end is a dangling pointer: fault, never index.
                let Some(&(h, _)) = vm.heap.get((p - 1) as usize) else {
                    return AsmRun::Fault("head of invalid list pointer".to_string());
                };
                vm.write(*rd, h);
                vm.pc += 1;
            }
            Instr::Tail(rd, rl) => {
                let p = vm.read(*rl);
                if p == 0 {
                    return AsmRun::Fault("tail of empty list".to_string());
                }
                let Some(&(_, t)) = vm.heap.get((p - 1) as usize) else {
                    return AsmRun::Fault("tail of invalid list pointer".to_string());
                };
                vm.write(*rd, t);
                vm.pc += 1;
            }
            Instr::IsEmpty(rd, rl) => {
                let empty = u64::from(vm.read(*rl) == 0);
                vm.write(*rd, empty);
                vm.pc += 1;
            }
        }
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(decode_asm(&o, &Value::list_of_nats(&[1, 2])), Some(Value::list_of_nats(&[1, 2])));
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

    #[test]
    fn program_resolves_labels_to_code_indices() {
        let prog = Program { code: vec![Instr::Li(Reg::Rr, 7), Instr::Ret], labels: vec![("f".to_string(), 0)] };
        assert_eq!(prog.label_index("f"), Some(0));
        assert_eq!(prog.label_index("missing"), None);
    }

    #[test]
    fn reg_and_instr_are_comparable() {
        assert_eq!(Reg::Loc(1), Reg::Loc(1));
        assert_ne!(Reg::Loc(1), Reg::Arg(1));
        assert_eq!(
            Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
            Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1))
        );
    }

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
        let expected = "    li a0, #5
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
                Instr::Mov(Reg::Loc(0), Reg::Arg(0)), // r0 = n
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
        let prog = Program { code: vec![Instr::Jmp("loop".to_string())], labels: vec![("loop".to_string(), 0)] };
        assert!(matches!(run_asm(&prog, Caps { steps: 1000, ..DEFAULT_CAPS }), AsmRun::HitCap));
    }

    #[test]
    fn huge_register_index_faults_instead_of_aborting() {
        // A `Reg::Loc(n)` in the millions must not drive `Vec::resize` into a multi-GB allocation
        // (whose failure would abort the process); the pre-run scan turns it into a fault.
        let prog = Program { code: vec![Instr::Li(Reg::Loc(2_000_000), 1), Instr::Halt], labels: vec![] };
        assert!(matches!(run(prog), AsmRun::Fault(_)));
    }

    #[test]
    fn stack_cap_stops_unbounded_recursion() {
        // f: call f  — each activation pushes a frame and never returns; the stack cap must stop it.
        let prog = Program { code: vec![Instr::Call("f".to_string())], labels: vec![("f".to_string(), 0)] };
        assert!(matches!(run_asm(&prog, Caps { stack: 3, ..DEFAULT_CAPS }), AsmRun::HitCap));
    }

    #[test]
    fn mem_cap_stops_crafted_self_recursion_before_it_can_abort() {
        // A legal-but-wide register bank (r1000, well under `MAX_REGISTERS`) makes every `Call`
        // clone a ~1000-word `locals` vector into the frame stack. Self-recursion through `f` would
        // otherwise accumulate that clone on every activation, and with a wide enough register (as
        // in the real crafted input this guards against) run the process out of memory long before
        // the stack's frame-COUNT cap could fire. With a tiny `mem` cap, this must return `HitCap`
        // after only a handful of frames — fast, and without ever approaching an abort.
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(1000), 1),
                // f:
                Instr::Call("f".to_string()),
            ],
            labels: vec![("f".to_string(), 1)],
        };
        assert!(matches!(run_asm(&prog, Caps { mem: 5000, ..DEFAULT_CAPS }), AsmRun::HitCap));
    }

    #[test]
    fn heap_cap_stops_unbounded_cons() {
        // r0 = nil; r1 = cons(r0, r0); r2 = cons(r1, r1) — with `heap: 1`, the *second* `cons` must
        // be the one that hits the cap (the first is allowed to fill the sole heap slot).
        let prog = Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)),
                Instr::Cons(Reg::Loc(1), Reg::Loc(0), Reg::Loc(0)),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert!(matches!(run_asm(&prog, Caps { heap: 1, ..DEFAULT_CAPS }), AsmRun::HitCap));
    }

    #[test]
    fn builds_and_reads_a_list() {
        // rr = head(tail(cons(1, cons(2, nil)))) == 2
        let prog = Program {
            code: vec![
                Instr::Nil(Reg::Loc(0)), // r0 = nil
                Instr::Li(Reg::Loc(1), 2),
                Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)), // r2 = cons(2, nil)
                Instr::Li(Reg::Loc(3), 1),
                Instr::Cons(Reg::Loc(4), Reg::Loc(3), Reg::Loc(2)), // r4 = cons(1, r2)
                Instr::Tail(Reg::Loc(5), Reg::Loc(4)),              // r5 = tail(r4)
                Instr::Head(Reg::Rr, Reg::Loc(5)),                  // rr = head(r5) = 2
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

    #[test]
    fn dangling_list_pointer_faults_instead_of_panicking() {
        // A non-null pointer (5) into an empty heap must fault, not index out of bounds: `run_asm` is
        // `pub` and must never panic on any `Program`, not just compiler-generated ones.
        let head_prog = Program {
            code: vec![Instr::Li(Reg::Loc(0), 5), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        };
        assert!(matches!(run(head_prog), AsmRun::Fault(_)));

        let tail_prog = Program {
            code: vec![Instr::Li(Reg::Loc(0), 5), Instr::Tail(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        };
        assert!(matches!(run(tail_prog), AsmRun::Fault(_)));
    }
}
