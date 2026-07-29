//! The register-assembly IR: a small register machine whose control flow becomes (in Part 2) the
//! Turing machine's state graph, and whose data (registers, stack, heap) becomes tapes. Registers
//! hold `u64` words; because Core is typed, the compiled code statically knows whether a word is a
//! `Nat` count, a `0`/`1` `Bool`, or a heap pointer, so there are no runtime type tags.

use crate::core::BinOp;
use crate::ty::Ty;
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
    /// `rd <- box(rv)` (allocate a fresh mutable box cell holding rv, return its 1-based pointer)
    Box(Reg, Reg),
    /// `rd <- box_get(rb)` (read the box; fault if rb is null/dangling)
    BoxGet(Reg, Reg),
    /// `box_set(rb, rv)` — overwrite the box in place (fault if rb is null/dangling)
    BoxSet(Reg, Reg),
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

fn bin_mnemonic(op: BinOp) -> &'static str {
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
            format!("{} {}, {}, {}", bin_mnemonic(*op), reg_str(*rd), reg_str(*ra), reg_str(*rb))
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
        Instr::Box(rd, rv) => format!("box {}, {}", reg_str(*rd), reg_str(*rv)),
        Instr::BoxGet(rd, rb) => format!("box_get {}, {}", reg_str(*rd), reg_str(*rb)),
        Instr::BoxSet(rb, rv) => format!("box_set {}, {}", reg_str(*rb), reg_str(*rv)),
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
    boxes: Vec<u64>,
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
        Instr::Mov(a, b)
        | Instr::Head(a, b)
        | Instr::Tail(a, b)
        | Instr::IsEmpty(a, b)
        | Instr::Box(a, b)
        | Instr::BoxGet(a, b)
        | Instr::BoxSet(a, b) => reg_over_cap(*a) || reg_over_cap(*b),
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
        boxes: Vec::new(),
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
            Instr::Box(rd, rv) => {
                if vm.boxes.len() as u64 >= vm.caps.heap {
                    return AsmRun::HitCap;
                }
                let v = vm.read(*rv);
                vm.boxes.push(v);
                let ptr = vm.boxes.len() as u64; // 1-based
                vm.write(*rd, ptr);
                vm.pc += 1;
            }
            Instr::BoxGet(rd, rb) => {
                let p = vm.read(*rb);
                if p == 0 {
                    return AsmRun::Fault("box_get of null handle".to_string());
                }
                let Some(&v) = vm.boxes.get((p - 1) as usize) else {
                    return AsmRun::Fault("box_get of invalid handle".to_string());
                };
                vm.write(*rd, v);
                vm.pc += 1;
            }
            Instr::BoxSet(rb, rv) => {
                let p = vm.read(*rb);
                if p == 0 {
                    return AsmRun::Fault("box_set of null handle".to_string());
                }
                let v = vm.read(*rv);
                let Some(slot) = vm.boxes.get_mut((p - 1) as usize) else {
                    return AsmRun::Fault("box_set of invalid handle".to_string());
                };
                *slot = v;
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
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) | Value::Box(_) => None,
    }
}

/// The most `Value` nodes a single type-directed decode may construct.
///
/// A TOTALITY guard on untrusted input, not a language limit — and a SEPARATE guarantee from the
/// spine loop's bound. The loop bounds CYCLES: one step per heap cell, so a chain that never reaches
/// nil returns `None` instead of recursing forever. It does not bound SIZE, because nested list types
/// MULTIPLY — `List<List<Nat>>` over an n-cell heap is O(n²) nodes and `MAX_TY_DEPTH` nesting is
/// O(n^d). Both factors come from the file. Neither guard implies the other.
///
/// DERIVED, not picked: a flat `List<Nat>` over an `L`-cell heap costs `2L + 1` nodes, and a run under
/// `DEFAULT_CAPS` may legitimately build `DEFAULT_CAPS.heap` cells — so anything at or below
/// `2 * DEFAULT_CAPS.heap + 1` is reachable by a correct program and must NOT be refused. The budget
/// sits above that with room to spare, which is what keeps it a totality guard on untrusted input
/// rather than a language limit. A constant below the runtime's own ceiling would reject programs
/// that ran correctly, reporting them as "could not decode result".
///
/// **That derivation is written for the ASM consumer; the other one is bounded by a DIFFERENT
/// constant.** `tm::decode::decode_tape_ty` reads a heap off a TM tape, bounded by `sim::DEFAULT_CAPS`
/// `.cells` (total tape cells), not by `asm::DEFAULT_CAPS.heap`. It works out with room to spare —
/// a heap cons cell costs at least three cells (`@`, `#`, and one word cell), so 5,000,000 cells is
/// under ~1.6M cells' worth of cons cells and well inside this budget. Stated because the two
/// constants are numerically equal today and independently changeable: raising `sim`'s cell cap
/// without revisiting this would silently break the property on the TM path.
///
/// THE RESIDUAL GAP, stated in numbers because no constant closes it and an adjective would hide it.
///
/// The derivation above covers a FLAT list exactly. It does not cover a nested one, and the reason is
/// SHARING: `Instr::Tail` is a pointer read, not an allocation, so an ordinary function like
///
/// ```text
/// fn tails(xs) = if is_empty(xs) { cons(nil, nil) } else { cons(xs, tails(tail(xs))) }
/// ```
///
/// returns a `List<List<Nat>>` whose inner lists all SHARE the outer spine's cells — about `2m` heap
/// cells for an `m`-element input, but `m² + m + 1` decode nodes, because this decoder walks each
/// shared sub-list again for every pointer into it. **That is not a crafted heap; it is what `tails`
/// produces.** Breakeven is `m ≈ 4,471` — three orders of magnitude below `DEFAULT_CAPS.heap`, and a
/// perfectly ordinary input size. So a correct, fast, cap-respecting program CAN still be refused
/// here, and calling this case adversarial (as an earlier revision of this comment did) was wrong.
///
/// Where the budget IS exactly as protective as intended is DEPTH, which is the hazard `MAX_TY_DEPTH`
/// opens up. For the same maximally-shared shape, cost is `~n^d`, so breakeven `n ≈ 20_000_000^(1/d)`:
///
/// | `d` | 2 | 3 | 4 | 64 |
/// |---|---|---|---|---|
/// | breakeven `n` | ~4,471 | ~271 | ~67 | ~1.3 — i.e. **2 cells** already exceed it by ~9 orders |
///
/// Closing the `d = 2` gap properly needs a SHARING-AWARE decode — memoizing on `(pointer, type)` so
/// an aliased sub-list is built once — not a bigger number. Filed in the spec's "What stays open".
///
/// `decode_asm`/`decode_word`, the Value-directed siblings, need no budget: they recurse on a finite
/// reference `Value` already in memory, so its size is the bound.
pub(crate) const MAX_DECODE_NODES: usize = 4 * DEFAULT_CAPS.heap as usize;

/// Type-directed decode of a run's outcome to a `Value` (the AOT sibling of `decode_asm`, which is
/// value-directed). Drives off the static `Ty` instead of a reference `Value`, so the standalone
/// binary can decode without a reference run. Returns `None` on a representation mismatch, a
/// non-value type (`Fun`/`Var`), or an exhausted `MAX_DECODE_NODES` budget.
pub fn decode_asm_ty(outcome: &AsmOutcome, ty: &Ty) -> Option<Value> {
    let mut budget = MAX_DECODE_NODES;
    decode_word_ty(outcome.result, &outcome.heap, ty, &mut budget)
}

/// Type-directed decode of one word. `pub(crate)` because `tm::decode::decode_tape_ty` decodes the
/// same `(word, heap)` pair off a set of TAPES and must not carry a second copy of THIS decoder — a
/// second budget/cycle-bound pair could silently disagree with this one. That claim is narrower than
/// it sounds: the VALUE-directed sibling below, `decode_word`, IS duplicated — `tm::decode` has its
/// own copy rather than calling this one — but safely, since both recurse structurally on a finite
/// reference `Value` already in memory and need no budget at all (see `MAX_DECODE_NODES`'s doc above).
///
/// Two SEPARATE totality guards, neither implying the other:
///
/// - Recursion here is on the TYPE (strictly smaller at each `List` element), never on the heap
///   chain: the list SPINE is a loop, bounded by one step per heap cell. That bound is what makes a
///   cyclic heap decode to `None` instead of overflowing the stack — a chain longer than the heap has
///   cells must have revisited one. It bounds CYCLES, not SIZE: it says nothing about how much a
///   single acyclic decode may construct.
/// - `budget` bounds SIZE. It is decremented once per constructed `Value` node (every `Nat`/`Bool`/
///   `Unit` leaf and every `Cons`), and decode fails once it would go negative. It matters because
///   nested list types multiply: for `List<List<Nat>>`, each of up to n spine steps decodes an inner
///   list that itself walks up to n cells, so an acyclic n-cell heap can still expand to O(n²) nodes
///   — and `MAX_TY_DEPTH` nesting makes that O(n^d). The spine loop does not catch this: every step
///   makes cycle-bounded progress while still constructing an unbounded amount of output.
///
/// Both matter because `tm::decode::decode_tape_ty` reads a heap AND a type that can come from a
/// `.tm` FILE, where neither acyclicity nor a small size is something the compiler guaranteed.
pub(crate) fn decode_word_ty(word: u64, heap: &[(u64, u64)], ty: &Ty, budget: &mut usize) -> Option<Value> {
    match ty {
        Ty::Nat => {
            *budget = budget.checked_sub(1)?;
            Some(Value::Nat(word))
        }
        Ty::Bool => {
            let v = match word {
                0 => Value::Bool(false),
                1 => Value::Bool(true),
                _ => return None,
            };
            *budget = budget.checked_sub(1)?;
            Some(v)
        }
        Ty::Unit => {
            *budget = budget.checked_sub(1)?;
            Some(Value::Unit)
        }
        Ty::List(elem) => {
            // Walk the spine forwards collecting heads, then rebuild back-to-front. At most one step
            // per cell; falling out of the loop means the chain never reached nil, i.e. it is cyclic.
            let mut heads = Vec::new();
            let mut w = word;
            for _ in 0..=heap.len() {
                if w == 0 {
                    *budget = budget.checked_sub(1)?; // the Nil node
                    let mut out = Value::Nil;
                    for h in heads.into_iter().rev() {
                        *budget = budget.checked_sub(1)?; // each Cons node
                        out = Value::Cons(Rc::new(h), Rc::new(out));
                    }
                    return Some(out);
                }
                let &(h, t) = heap.get((w - 1) as usize)?;
                heads.push(decode_word_ty(h, heap, elem, budget)?);
                w = t;
            }
            None
        }
        Ty::Fun(..) | Ty::Var(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::tm::lower_asm::lower_asm;

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
    fn decode_asm_ty_matches_decode_asm() {
        use crate::ty::Ty;
        // Nat, Bool, and a list [1,2] via the heap; agree with the Value-directed decoder.
        let nat = AsmOutcome { result: 5, heap: vec![] };
        assert_eq!(decode_asm_ty(&nat, &Ty::Nat), Some(Value::Nat(5)));
        let b = AsmOutcome { result: 1, heap: vec![] };
        assert_eq!(decode_asm_ty(&b, &Ty::Bool), Some(Value::Bool(true)));
        let bad = AsmOutcome { result: 7, heap: vec![] };
        assert_eq!(decode_asm_ty(&bad, &Ty::Bool), None); // Bool word > 1 invalid
        let list = AsmOutcome { result: 2, heap: vec![(2, 0), (1, 1)] }; // cons(1, cons(2, nil))
        assert_eq!(decode_asm_ty(&list, &Ty::List(Box::new(Ty::Nat))), Some(Value::list_of_nats(&[1, 2])));
        let nil = AsmOutcome { result: 0, heap: vec![] };
        assert_eq!(decode_asm_ty(&nil, &Ty::List(Box::new(Ty::Nat))), Some(Value::Nil));

        // Now actually CROSS-CHECK against `decode_asm`: for each shared concrete case, feed
        // `decode_asm` a witness `Value` of the SAME shape as the `Ty` (`Ty::Nat` <-> `Value::Nat(0)`,
        // `Ty::Bool` <-> `Value::Bool(false)`, `Ty::List(Nat)` <-> a `Value::list_of_nats` of the SAME
        // LENGTH as the outcome actually decodes to -- `decode_asm` is shape-directed by its `expected`
        // argument, so a length-2 outcome needs a length-2 witness and a nil (length-0) outcome needs
        // `Value::Nil`/`list_of_nats(&[])`) and assert the two decoders produce the identical
        // `Option<Value>` on identical `AsmOutcome`s -- so this test earns its name instead of only
        // exercising `decode_asm_ty` in isolation.
        assert_eq!(decode_asm_ty(&nat, &Ty::Nat), decode_asm(&nat, &Value::Nat(0)));
        assert_eq!(decode_asm_ty(&b, &Ty::Bool), decode_asm(&b, &Value::Bool(false)));
        assert_eq!(decode_asm_ty(&bad, &Ty::Bool), decode_asm(&bad, &Value::Bool(false)));
        assert_eq!(
            decode_asm_ty(&list, &Ty::List(Box::new(Ty::Nat))),
            decode_asm(&list, &Value::list_of_nats(&[0, 0])) // same length (2) as the actual list
        );
        assert_eq!(
            decode_asm_ty(&nil, &Ty::List(Box::new(Ty::Nat))),
            decode_asm(&nil, &Value::list_of_nats(&[])) // same length (0) == Value::Nil
        );
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

    #[test]
    fn print_asm_golden_for_a_small_demo() {
        // A regression guard on lower_asm's codegen + print_asm's format. If either changes, re-capture
        // the expected string below (run the test, copy the `left` from the panic) — a deliberate re-bless.
        let (prog, ds) = parse("let x = 1; let y = x + x; y * 3");
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let asm = print_asm(&lower_asm(&core).expect("lowers"));
        let expected = "    li r0, #1
    mov r2, r0
    mov r3, r0
    add r1, r2, r3
    mov r4, r1
    li r5, #3
    mul rr, r4, r5
    halt
";
        assert_eq!(asm, expected);
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

    #[test]
    fn box_alloc_get_and_set_roundtrip() {
        // b = box(7); r1 = box_get(b) == 7; box_set(b, 9); rr = box_get(b) == 9
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 7),
                Instr::Box(Reg::Loc(1), Reg::Loc(0)),    // r1 = box(7), pointer 1
                Instr::BoxGet(Reg::Loc(2), Reg::Loc(1)), // r2 = box_get(r1) = 7
                Instr::Li(Reg::Loc(3), 9),
                Instr::BoxSet(Reg::Loc(1), Reg::Loc(3)), // *r1 = 9 (in place)
                Instr::BoxGet(Reg::Rr, Reg::Loc(1)),     // rr = box_get(r1) = 9
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(ran(prog), 9);
    }

    #[test]
    fn boxes_get_sequential_pointers_and_are_independent() {
        // two boxes are distinct cells; setting one does not touch the other
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 3),
                Instr::Box(Reg::Loc(1), Reg::Loc(0)), // r1 = box(3) -> ptr 1
                Instr::Li(Reg::Loc(2), 4),
                Instr::Box(Reg::Loc(3), Reg::Loc(2)), // r3 = box(4) -> ptr 2
                Instr::Li(Reg::Loc(4), 5),
                Instr::BoxSet(Reg::Loc(1), Reg::Loc(4)), // *r1 = 5
                Instr::BoxGet(Reg::Rr, Reg::Loc(3)),     // rr = box_get(r3) = 4 (unchanged)
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert_eq!(ran(prog), 4);
    }

    #[test]
    fn box_get_of_null_handle_faults() {
        let prog = Program {
            code: vec![Instr::Li(Reg::Loc(0), 0), Instr::BoxGet(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        };
        assert!(matches!(run(prog), AsmRun::Fault(_)));
    }

    #[test]
    fn box_set_of_dangling_handle_faults() {
        // pointer 5 into an empty box store: fault, never index out of bounds
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 5),
                Instr::Li(Reg::Loc(1), 1),
                Instr::BoxSet(Reg::Loc(0), Reg::Loc(1)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        assert!(matches!(run(prog), AsmRun::Fault(_)));
    }

    #[test]
    fn box_alloc_respects_the_allocation_cap() {
        let prog = Program {
            code: vec![
                Instr::Li(Reg::Loc(0), 1),
                Instr::Box(Reg::Loc(1), Reg::Loc(0)),
                Instr::Box(Reg::Loc(2), Reg::Loc(0)),
                Instr::Halt,
            ],
            labels: vec![],
        };
        // cap of 1 box allocation: the second Box hits the cap
        assert!(matches!(run_asm(&prog, Caps { heap: 1, ..DEFAULT_CAPS }), AsmRun::HitCap));
    }

    /// A heap whose chain never reaches nil must decode to `None`, not overflow the stack.
    ///
    /// Unreachable from the compiler (a cons cell's tail points only at an EARLIER cell, so every
    /// compiled chain is acyclic and terminates), but `tm::decode::decode_tape_ty` reads a heap that can
    /// come from a hand-written `.tm` file's initial HEAP tape — i.e. from untrusted input. The
    /// Value-directed `decode_asm` needs no such guard: it recurses on a finite reference `Value`.
    #[test]
    fn a_cyclic_heap_decodes_to_none_rather_than_overflowing() {
        use crate::ty::Ty;
        // Cell 1 = (7, 1): its tail points at itself.
        let o = AsmOutcome { result: 1, heap: vec![(7, 1)] };
        assert_eq!(decode_asm_ty(&o, &Ty::List(Box::new(Ty::Nat))), None);
        // A two-cell cycle: 1 -> 2 -> 1.
        let o2 = AsmOutcome { result: 1, heap: vec![(7, 2), (8, 1)] };
        assert_eq!(decode_asm_ty(&o2, &Ty::List(Box::new(Ty::Nat))), None);
    }

    /// The hardening must not change any acyclic answer — including a chain long enough that the old
    /// recursive shape was the only thing under test. This test now checks the HEADS, not just the length,
    /// so a reversed rebuild (which would still produce a 1000-element nil-terminated list) fails it.
    #[test]
    fn a_long_acyclic_list_still_decodes() {
        use crate::ty::Ty;
        // cell i (1-based) = (i, i-1), so the chain 1000 -> 999 -> … -> 1 -> nil.
        let heap: Vec<(u64, u64)> = (1..=1000u64).map(|i| (i, i - 1)).collect();
        let o = AsmOutcome { result: 1000, heap };
        let v = decode_asm_ty(&o, &Ty::List(Box::new(Ty::Nat))).expect("decodes");

        // Collect the HEADS, not just the length: a reversed rebuild would still produce a
        // 1000-element `Nil`-terminated list, so a length-only assertion cannot tell the two apart —
        // and "the hardening must not change any acyclic answer" is a claim about the VALUES.
        let mut heads = Vec::new();
        let mut cur = &v;
        while let Value::Cons(h, t) = cur {
            let Value::Nat(n) = &**h else { panic!("expected a Nat head, got {h:?}") };
            heads.push(*n);
            cur = t;
        }
        assert_eq!(cur, &Value::Nil, "the chain must terminate in nil");
        assert_eq!(heads, (1..=1000u64).rev().collect::<Vec<u64>>());
    }

    /// The spine loop bounds CYCLES — one step per heap cell. It does not bound SIZE. For
    /// `List<List<Nat>>`, each of up to n spine steps decodes an inner list that walks up to n cells:
    /// O(n^2) nodes, and `MAX_TY_DEPTH` nesting makes it O(n^d). BOTH factors are file-supplied, because
    /// a machine of `state s: accept` returns its initial tapes unchanged. The two guards are separate
    /// guarantees and neither implies the other.
    #[test]
    fn a_nested_type_over_a_large_heap_is_refused_rather_than_expanded() {
        use crate::ty::Ty;
        // Every cell points at the previous one, so each of the n spine steps decodes an inner list of
        // length up to n. Costing it out: the outer spine takes n steps, each contributing 1 outer
        // `Cons` plus an inner `List<Nat>` decode of length m (m running 0..=n-1), which costs 2m + 1
        // nodes. Summing the inner costs over m = 0..=n-1 gives n^2 (sum of the first n odd numbers),
        // plus n outer `Cons` nodes, plus 1 final outer `Nil`: n^2 + n + 1 total.
        //
        // n = 6000 gives 6000^2 + 6000 + 1 = 36,006,001 nodes — about 1.8x MAX_DECODE_NODES
        // (4 * DEFAULT_CAPS.heap = 20,000,000), decisively over without being absurdly large.
        let n = 6000u64;
        let heap: Vec<(u64, u64)> = (1..=n).map(|i| (i - 1, i - 1)).collect();
        let o = AsmOutcome { result: n, heap };
        let nested = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
        assert_eq!(decode_asm_ty(&o, &nested), None, "must exhaust the node budget, not expand");
    }

    /// The budget must not reject legitimate decodes. A flat list well under the cap still decodes, and
    /// a modest nested one does too.
    #[test]
    fn the_node_budget_admits_legitimate_decodes() {
        use crate::ty::Ty;
        let heap: Vec<(u64, u64)> = (1..=1000u64).map(|i| (i, i - 1)).collect();
        let o = AsmOutcome { result: 1000, heap };
        assert!(decode_asm_ty(&o, &Ty::List(Box::new(Ty::Nat))).is_some(), "a 1000-element list must decode");
        // A small nested case: 20 cells, List<List<Nat>> -> at most ~400 nodes.
        let heap: Vec<(u64, u64)> = (1..=20u64).map(|i| (i - 1, i - 1)).collect();
        let o = AsmOutcome { result: 20, heap };
        let nested = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
        assert!(decode_asm_ty(&o, &nested).is_some(), "a small nested list must still decode");
    }

    /// Pins the per-node accounting exactly, in both directions: a flat `List<Nat>` of `L` elements
    /// costs `2L + 1` nodes (L `Cons` + L `Nat` leaves + 1 `Nil`), so it must decode iff
    /// `2L + 1 <= MAX_DECODE_NODES`. `L` is chosen at that boundary — `(MAX_DECODE_NODES - 1) / 2` is
    /// the largest `L` for which `2L + 1` still fits, so it must decode; `L + 1` pushes `2L + 1` one
    /// past the budget, so it must not. Neither an over-count nor an under-count of what a node costs
    /// (e.g. charging only for `Cons`, not for `Nat` leaves) could pass both assertions at once — unlike
    /// the nested-heap test above, which a same-order miscount could still slip past.
    ///
    /// Ignored by default: `L` is ~10,000,000, so this allocates ~`MAX_DECODE_NODES` heap cells and
    /// `Value`s, which is slow under a debug build. Run explicitly, or via the slow tier
    /// (`scripts/check-slow.sh`).
    #[test]
    #[ignore = "slow tier: allocates ~MAX_DECODE_NODES values"]
    fn the_node_budget_boundary_is_exact() {
        use crate::ty::Ty;
        let l_ok = (MAX_DECODE_NODES as u64 - 1) / 2;
        let cost_ok = 2 * l_ok + 1;
        let cost_over = 2 * (l_ok + 1) + 1;
        assert!(cost_ok <= MAX_DECODE_NODES as u64, "sanity: l_ok must fit the budget");
        assert!(cost_over > MAX_DECODE_NODES as u64, "sanity: l_ok must be the largest such L");

        let heap: Vec<(u64, u64)> = (1..=l_ok).map(|i| (i, i - 1)).collect();
        let o = AsmOutcome { result: l_ok, heap };
        assert!(
            decode_asm_ty(&o, &Ty::List(Box::new(Ty::Nat))).is_some(),
            "a {l_ok}-element list costs {cost_ok} <= MAX_DECODE_NODES and must decode"
        );

        let l_over = l_ok + 1;
        let heap: Vec<(u64, u64)> = (1..=l_over).map(|i| (i, i - 1)).collect();
        let o = AsmOutcome { result: l_over, heap };
        assert_eq!(
            decode_asm_ty(&o, &Ty::List(Box::new(Ty::Nat))),
            None,
            "a {l_over}-element list costs one node over budget and must not decode"
        );
    }
}
