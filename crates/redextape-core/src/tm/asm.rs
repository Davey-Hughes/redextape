//! The register-assembly IR: a small register machine whose control flow becomes (in Part 2) the
//! Turing machine's state graph, and whose data (registers, stack, heap) becomes tapes. Registers
//! hold `u64` words; because Core is typed, the compiled code statically knows whether a word is a
//! `Nat` count, a `0`/`1` `Bool`, or a heap pointer, so there are no runtime type tags.

use crate::analysis::push_span;
use crate::core::BinOp;
use crate::ty::Ty;
use crate::value::Value;
use std::collections::HashSet;
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
    #[must_use]
    pub fn label_index(&self, name: &str) -> Option<usize> {
        self.labels.iter().find(|(n, _)| n == name).map(|(_, i)| *i)
    }

    /// Every way a `Program` can be ill-formed, as messages. Empty means valid.
    ///
    /// **This is `run_asm`'s lazy faults, hoisted.** An undefined target and an over-cap register
    /// already fault, but only when the instruction executes, so a typo on a branch that never fires
    /// runs clean to completion. Two further checks have no runtime counterpart at all: a duplicate
    /// name, which `label_index` resolves by silently taking the first, and a name or index the
    /// PRINTER cannot represent — a label past the end is dropped and an unrepresentable name is
    /// written unquoted, both silently (design §3.1, §3.3).
    ///
    /// `Vec<String>` and not `Vec<Diagnostic>`: a `Program` carries no spans, and one built by
    /// `lower_asm` has no text for a span to point into. `Machine::validate` returns strings for the
    /// same reason.
    ///
    /// `run_asm` is deliberately unchanged. The two ways to obtain a `Program` must behave
    /// identically, so this is a check callers opt into rather than a gate on execution.
    #[must_use]
    pub fn validate(&self) -> Vec<String> {
        let mut errs = Vec::new();
        let n = self.code.len();

        // A `HashSet`, not the `Vec` + `.contains` this used to be: `.contains` on a `Vec` is O(n)
        // inside a loop over `self.labels`, making the whole pass O(n²) — measured on the release
        // binary at 20,000/40,000/80,000 labels, about 5x per doubling, while the parser that builds
        // `self.labels` stays linear. `Machine::validate` (`tm/machine.rs`) already uses a `HashSet`
        // for its own duplicate-name check; this matches that sibling rather than inventing a second
        // way to do the same thing. The DIAGNOSTIC order and text are unchanged — a set changes lookup
        // cost, not what is reported: `.insert` returns `false` on exactly the names `.contains` used
        // to find already present, so the branch taken per label is identical.
        let mut seen: HashSet<&str> = HashSet::new();
        for (name, at) in &self.labels {
            if !label_name_representable(name) {
                errs.push(format!("label name {name:?} is not representable (empty, or contains whitespace or ; : ,)"));
            }
            if !seen.insert(name.as_str()) {
                errs.push(format!("duplicate label `{name}` (label_index resolves to the first)"));
            }
            // `n` itself is legal: a trailing skip target points one past the last instruction and the
            // printer emits it. Anything beyond that is dropped when printed.
            if *at > n {
                errs.push(format!("label `{name}` at index {at} is past the end (code length {n})"));
            }
        }

        for (i, instr) in self.code.iter().enumerate() {
            if instr_reg_over_cap(instr) {
                errs.push(format!("instruction {i} uses a register at or over MAX_REGISTERS ({MAX_REGISTERS})"));
            }
            let target = match instr {
                Instr::Jz(_, l) | Instr::Jmp(l) | Instr::Call(l) => Some(l),
                _ => None,
            };
            if let Some(l) = target
                && self.label_index(l).is_none()
            {
                errs.push(format!("instruction {i} jumps to undefined label `{l}`"));
            }
        }

        errs
    }
}

/// Whether a label name survives a print-then-parse trip. The rejected set is derived from the
/// format's own separators rather than chosen: whitespace splits a mnemonic from its operands, `,`
/// splits operands, `:` ends a label line, and `;` starts a comment.
///
/// **Conservative, not precise.** Whether a name actually survives is not a property of its
/// characters alone — it depends on whether the name sits in a label DECLARATION or a jump/call
/// OPERAND, and, for whitespace, on whether it sits at an edge or in the interior. Several rejected
/// names round-trip byte-identically in one or both of those positions; the worst case is the
/// opposite failure — a name ENDING in `:` used as an operand makes the whole instruction line read
/// back as a label declaration, mnemonic included, silently and with no diagnostic (design §3.3).
/// Rejecting the set uniformly anyway is deliberate: `validate` checks names, not occurrences — it
/// has no way to know where a given label will be used.
fn label_name_representable(name: &str) -> bool {
    !name.is_empty() && !name.chars().any(|c| c.is_whitespace() || matches!(c, ';' | ':' | ','))
}

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

/// An operand's kind with no value attached. `Operand` itself borrows, so it cannot be compared
/// across the printer/parser boundary; this can.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum OperandKind {
    Reg,
    Imm,
    Label,
}

/// One operand, classified by what it IS rather than how it prints — so a label named `retry` can
/// never be mistaken for a register, which any spelling-based rule would get wrong.
pub(super) enum Operand<'a> {
    Reg(Reg),
    Imm(u64),
    Label(&'a str),
}

impl Operand<'_> {
    fn class(&self) -> crate::analysis::TokenClass {
        use crate::analysis::TokenClass as C;
        match self {
            Operand::Reg(_) => C::Register,
            Operand::Imm(_) => C::Nat,
            Operand::Label(_) => C::Label,
        }
    }

    /// The operand's kind, stripped of its value — what `asm_syntax`'s table has to agree with. This
    /// is `class` without the `TokenClass` vocabulary, which carries highlighting concerns the parser
    /// has no use for.
    #[allow(
        dead_code,
        reason = "called only by the differential test `table_agrees_with_the_printer`, which compares this \
                  against `Shape::kinds`; the parser itself reads operands positionally off the shape and \
                  never calls it"
    )]
    pub(super) fn kind(&self) -> OperandKind {
        match self {
            Operand::Reg(_) => OperandKind::Reg,
            Operand::Imm(_) => OperandKind::Imm,
            Operand::Label(_) => OperandKind::Label,
        }
    }
}

fn operand_str(o: &Operand<'_>) -> String {
    match o {
        Operand::Reg(r) => reg_str(*r),
        Operand::Imm(n) => format!("#{n}"),
        Operand::Label(l) => (*l).to_string(),
    }
}

/// The mnemonic and operands of one instruction. `print_asm_mapped` is the only place that joins
/// them into text, so the listing's separator and its classification cannot disagree about where an
/// operand starts.
pub(super) fn instr_parts(i: &Instr) -> (&'static str, Vec<Operand<'_>>) {
    match i {
        Instr::Li(rd, n) => ("li", vec![Operand::Reg(*rd), Operand::Imm(*n)]),
        Instr::Mov(rd, rs) => ("mov", vec![Operand::Reg(*rd), Operand::Reg(*rs)]),
        Instr::Bin(op, rd, ra, rb) => {
            (bin_mnemonic(*op), vec![Operand::Reg(*rd), Operand::Reg(*ra), Operand::Reg(*rb)])
        }
        Instr::Jz(r, l) => ("jz", vec![Operand::Reg(*r), Operand::Label(l)]),
        Instr::Jmp(l) => ("jmp", vec![Operand::Label(l)]),
        Instr::Call(l) => ("call", vec![Operand::Label(l)]),
        Instr::Ret => ("ret", Vec::new()),
        Instr::Halt => ("halt", Vec::new()),
        Instr::Nil(rd) => ("nil", vec![Operand::Reg(*rd)]),
        Instr::Cons(rd, rh, rt) => ("cons", vec![Operand::Reg(*rd), Operand::Reg(*rh), Operand::Reg(*rt)]),
        Instr::Head(rd, rl) => ("head", vec![Operand::Reg(*rd), Operand::Reg(*rl)]),
        Instr::Tail(rd, rl) => ("tail", vec![Operand::Reg(*rd), Operand::Reg(*rl)]),
        Instr::IsEmpty(rd, rl) => ("isempty", vec![Operand::Reg(*rd), Operand::Reg(*rl)]),
        Instr::Box(rd, rv) => ("box", vec![Operand::Reg(*rd), Operand::Reg(*rv)]),
        Instr::BoxGet(rd, rb) => ("box_get", vec![Operand::Reg(*rd), Operand::Reg(*rb)]),
        Instr::BoxSet(rb, rv) => ("box_set", vec![Operand::Reg(*rb), Operand::Reg(*rv)]),
    }
}

/// Render a `Program` as the readable assembly listing (labels at column 0, instructions indented).
#[must_use]
pub fn print_asm(prog: &Program) -> String {
    print_asm_mapped(prog).0
}

/// `print_asm`, plus a class per span of the produced text. Spans are pushed as each piece is written,
/// so offsets are exact by construction — nothing re-scans the output.
#[must_use]
pub fn print_asm_mapped(prog: &Program) -> (String, crate::analysis::Classified) {
    use crate::analysis::TokenClass as C;
    let mut out = String::new();
    let mut spans: crate::analysis::Classified = Vec::new();
    let emit_label = |out: &mut String, spans: &mut crate::analysis::Classified, name: &str| {
        push_span(out, spans, name, C::Label);
        push_span(out, spans, ":", C::Punct);
        out.push('\n');
    };
    // Bucket the labels by the index they precede, once. Rescanning `prog.labels` inside the loop over
    // `prog.code` made printing O(code x labels), and both grow with program size.
    //
    // `prog.labels` ORDER is load-bearing: when several labels sit at one index they print in the order
    // they appear there, and the goldens pin that. Pushing into per-index buckets in `prog.labels` order
    // reproduces it exactly. The `code.len() + 1` length covers the one-past-the-end targets handled
    // below; a label further past the end is dropped by `get_mut`, which is what the old scan did too
    // (neither loop had an index for it).
    let mut labels_at: Vec<Vec<&str>> = vec![Vec::new(); prog.code.len() + 1];
    for (name, at) in &prog.labels {
        if let Some(bucket) = labels_at.get_mut(*at) {
            bucket.push(name);
        }
    }
    for (idx, instr) in prog.code.iter().enumerate() {
        for name in labels_at.get(idx).into_iter().flatten() {
            emit_label(&mut out, &mut spans, name);
        }
        out.push_str("    ");
        let (mnemonic, operands) = instr_parts(instr);
        push_span(&mut out, &mut spans, mnemonic, C::Mnemonic);
        for (i, operand) in operands.iter().enumerate() {
            // The `\t` before the first operand and the space after each `,` are whitespace and belong
            // to no span; the `,` itself is punctuation, classified as the TM printer already does.
            if i == 0 {
                out.push('\t');
            } else {
                push_span(&mut out, &mut spans, ",", C::Punct);
                out.push(' ');
            }
            push_span(&mut out, &mut spans, &operand_str(operand), operand.class());
        }
        out.push('\n');
    }
    // Any labels pointing one past the end (e.g. a trailing skip target) still print.
    for name in labels_at.get(prog.code.len()).into_iter().flatten() {
        emit_label(&mut out, &mut spans, name);
    }
    (out, spans)
}

/// The optional self-describing block an emitted `.asm` file may carry.
///
/// One directive, `result`, naming the type of the value the program computes. That is the whole
/// header, and the omission is deliberate: TM carries a `version` because its tape encoding has
/// evolved and a file must say which one it was written under, while the asm text form has had
/// exactly one encoding since it existed. A directive with a single legal value is a field nothing
/// can use. If the form ever gains a second encoding, that is when it earns a version.
///
/// The header is OPTIONAL in the same sense TM's is: a file without one is not malformed, it is
/// simply a listing whose answer cannot be named. `parse_asm` drops it, `parse_asm_full` returns it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AsmHeader {
    /// The type of the program's result value, read from `Reg::Rr`. Only `Nat`/`Bool`/`Unit`/`List<T>`
    /// are admissible — `ty::parse_ty` yields nothing else, so the reader gets that restriction for
    /// free and the writer must not construct one that violates it.
    pub result: Ty,
}

/// `print_asm`, preceded by `h`'s directives and a blank line.
///
/// The listing's bytes are IDENTICAL to `print_asm`'s — this prepends and never perturbs — which is
/// what lets every existing consumer keep its goldens while gaining a self-describing form.
#[must_use]
pub fn print_asm_with(prog: &Program, h: &AsmHeader) -> String {
    print_asm_with_mapped(prog, h).0
}

/// `print_asm_with`, plus a class per span. Offsets are exact by construction: the header's spans are
/// pushed as it is written, and the listing's are shifted by the header's byte length rather than
/// recomputed, so the two halves cannot disagree about where the listing starts.
#[must_use]
pub fn print_asm_with_mapped(prog: &Program, h: &AsmHeader) -> (String, crate::analysis::Classified) {
    use crate::analysis::TokenClass as C;
    let mut out = String::new();
    let mut spans: crate::analysis::Classified = Vec::new();
    push_span(&mut out, &mut spans, "result", C::Keyword);
    out.push(' ');
    push_span(&mut out, &mut spans, &crate::ty::show(&h.result), C::Ident);
    out.push('\n');
    out.push('\n');

    let offset = out.len();
    let (listing, listing_spans) = print_asm_mapped(prog);
    out.push_str(&listing);
    spans.extend(
        listing_spans.into_iter().map(|(s, c)| (crate::span::Span { start: s.start + offset, end: s.end + offset }, c)),
    );
    (out, spans)
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
///
/// `clippy::too_many_lines`: one `match instr` arm per `Instr` variant, executing the interpreter's
/// fetch-decode-execute loop — the length tracks `Instr`'s variant count, not any one arm's
/// complexity. Splitting the loop body out would separate the dispatch from the loop that drives it,
/// the opposite of easier to follow.
#[allow(clippy::too_many_lines)]
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
                // A non-null pointer past the heap end is a dangling pointer: fault, never index. `p`
                // is a register value a program can set to any `u64` (an `Li` immediate, or arithmetic
                // over one), so `p - 1` may not fit `usize` on a 32-bit target; `try_from` routes that
                // case to the same fault as an in-range-but-past-the-end pointer, rather than
                // truncating into a wrong, in-range index that would read the wrong heap cell.
                let Some(&(h, _)) = usize::try_from(p - 1).ok().and_then(|idx| vm.heap.get(idx)) else {
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
                // Same truncation hazard as `Head` above, and the same fix: never let a `p` that does
                // not fit `usize` alias into a small, in-range index.
                let Some(&(_, t)) = usize::try_from(p - 1).ok().and_then(|idx| vm.heap.get(idx)) else {
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
                // Same truncation hazard as `Head`/`Tail` above.
                let Some(&v) = usize::try_from(p - 1).ok().and_then(|idx| vm.boxes.get(idx)) else {
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
                // Same truncation hazard as `Head`/`Tail`/`BoxGet` above.
                let Some(slot) = usize::try_from(p - 1).ok().and_then(|idx| vm.boxes.get_mut(idx)) else {
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
#[must_use]
pub fn decode_asm(outcome: &AsmOutcome, expected: &Value) -> Option<Value> {
    decode_word(outcome.result, &outcome.heap, expected)
}

/// `clippy::similar_names`: flags the local `head` against the `heap` parameter. Both are the
/// established domain terms (a cons cell's head; the HEAP tape/table) and neither can rename without
/// losing that — `head` least of all, since `tm::decode::decode_word` mirrors this function on
/// purpose (see its doc: "Mirrors `asm.rs::decode_word`") and a reader checking the two stay in step
/// wants matching local names, not divergent ones.
#[allow(clippy::similar_names)]
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
            // `word` comes from a public, caller-supplied `AsmOutcome` (see `decode_asm`), not only
            // from a `run_asm` run of this module's own bounded heap — a hand-built `word` may not fit
            // `usize` on a 32-bit target. Fold that into the existing "not a valid pointer" `None`
            // rather than truncating into a wrong, in-range index.
            let idx = usize::try_from(word - 1).ok()?;
            let &(h, t) = heap.get(idx)?;
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
///
/// Bounded by construction, not by a runtime check: `DEFAULT_CAPS.heap` is the literal constant
/// `5_000_000` (see `DEFAULT_CAPS`), so `4 * DEFAULT_CAPS.heap` is `20_000_000` — far under both
/// `u32::MAX` and `usize::MAX` on every target this workspace builds for (native 64-bit and wasm32).
#[allow(clippy::cast_possible_truncation)]
pub(crate) const MAX_DECODE_NODES: usize = 4 * DEFAULT_CAPS.heap as usize;

/// Why a type-directed decode failed. The two causes have OPPOSITE fault attributions (see
/// `redextape-cli::run`'s module doc, "the exit-code rule is whose fault is it"), which is the whole
/// reason this exists rather than collapsing straight to `None` the way `decode_word_ty` used to.
///
/// **Mismatch is a claim about the DATA, never about the budget — and vice versa.** `Ty::Nat` and
/// `Ty::Unit` never mismatch (any word is a valid `Nat`; `Unit` ignores the word entirely), so every
/// failure they can produce is `BudgetExhausted`. Every OTHER failure arm — an out-of-range `Bool`
/// word, an unrepresentable or out-of-bounds heap pointer, a chain that never reaches nil (a cyclic
/// heap), a non-value type — is `Mismatch`, and none of them touch `budget` at all before returning.
///
/// **Tagged at the point of detection, not inferred from `budget` afterward.** An earlier design
/// considered leaving `decode_word_ty` returning `Option<Value>` and having the caller read `budget`
/// after a `None`: `budget == 0` would mean exhaustion, anything else a mismatch. That is UNSOUND.
/// `budget` can legitimately reach exactly `0` from prior, correctly-decremented nodes elsewhere in
/// the same decode — a sibling `Nat` leaf, an earlier list's `Nil`/`Cons` nodes — and every mismatch
/// arm (`Ty::Bool`'s `_ => ...`, both pointer-validity checks in `Ty::List`, the cyclic-heap fallback)
/// checks its condition and returns BEFORE touching `budget`. So a mismatch discovered in that exact
/// state would leave `budget == 0` behind it, identical to what real exhaustion leaves — a real
/// counterexample, not a hypothetical one, which is why every arm below tags its own reason instead.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecodeFailure {
    /// The word/heap does not have the shape `ty` claims — a header (or a `result` directive) that
    /// lies about what the run actually produced. The FILE's fault.
    Mismatch,
    /// `MAX_DECODE_NODES` ran out on an otherwise well-formed decode — the declared type may be
    /// entirely truthful; the decoder simply built more `Value` nodes than the budget allows (nested
    /// list types multiply node count; see `MAX_DECODE_NODES`'s doc). This TOOL's limit, not the
    /// file's.
    BudgetExhausted,
}

/// Spend one unit of `budget`, tagging exhaustion as `BudgetExhausted`. The ONE place that touches
/// `budget`, so every arm of `decode_word_ty` reports the same reason for running out — no arm ever
/// re-derives "exhausted" from `budget`'s value on its own.
fn spend(budget: &mut usize) -> Result<(), DecodeFailure> {
    *budget = budget.checked_sub(1).ok_or(DecodeFailure::BudgetExhausted)?;
    Ok(())
}

/// Type-directed decode of a run's outcome to a `Value` (the AOT sibling of `decode_asm`, which is
/// value-directed). Drives off the static `Ty` instead of a reference `Value`, so the standalone
/// binary can decode without a reference run. Returns `None` on a representation mismatch, a
/// non-value type (`Fun`/`Var`), or an exhausted `MAX_DECODE_NODES` budget — `decode_asm_ty_reason`'s
/// `.ok()`, for the many existing callers (`redextape-wasm`, `redextape-native-rt`, the `.asm`
/// example, and this module's own tests) that only need to know THAT it failed, not why.
#[must_use]
pub fn decode_asm_ty(outcome: &AsmOutcome, ty: &Ty) -> Option<Value> {
    decode_asm_ty_reason(outcome, ty).ok()
}

/// `decode_asm_ty`, keeping WHY a failed decode failed. See `DecodeFailure`'s doc for the two causes
/// and why the distinction is worth keeping.
///
/// # Errors
///
/// `DecodeFailure::Mismatch` if `outcome`'s data does not have the shape `ty` claims — the file's own
/// fault. `DecodeFailure::BudgetExhausted` if `MAX_DECODE_NODES` ran out on an otherwise-truthful
/// decode — this tool's limit, not the file's.
pub fn decode_asm_ty_reason(outcome: &AsmOutcome, ty: &Ty) -> Result<Value, DecodeFailure> {
    let mut budget = MAX_DECODE_NODES;
    decode_word_ty(outcome.result, &outcome.heap, ty, &mut budget)
}

/// Type-directed decode of one word. `pub(crate)` because `tm::decode::decode_tape_ty_reason` decodes
/// the same `(word, heap)` pair off a set of TAPES and must not carry a second copy of THIS decoder —
/// a second budget/cycle-bound pair could silently disagree with this one. That claim is narrower than
/// it sounds: the VALUE-directed sibling below, `decode_word`, IS duplicated — `tm::decode` has its
/// own copy rather than calling this one — but safely, since both recurse structurally on a finite
/// reference `Value` already in memory and need no budget at all (see `MAX_DECODE_NODES`'s doc above).
///
/// Two SEPARATE totality guards, neither implying the other:
///
/// - Recursion here is on the TYPE (strictly smaller at each `List` element), never on the heap
///   chain: the list SPINE is a loop, bounded by one step per heap cell. That bound is what makes a
///   cyclic heap decode to `Err` instead of overflowing the stack — a chain longer than the heap has
///   cells must have revisited one. It bounds CYCLES, not SIZE: it says nothing about how much a
///   single acyclic decode may construct. **A cycle wins a `Mismatch` against its OWN spine's cost,
///   never UNCONDITIONALLY** — see the "does not reach a cycle sitting behind an expensive SIBLING"
///   paragraph below, not `DecodeFailure`'s doc, which lists this arm's failure as `Mismatch` with no
///   such qualification — because the `Ty::List` arm below walks the spine to completion (or to the
///   cycle bound) in a pass that decodes no head and spends no `budget` at all, BEFORE a second pass
///   decodes any head of THAT spine. An earlier version of this function interleaved the two —
///   decoding each head as it walked past it — so a cyclic heap whose
///   OWN elements were themselves expensive to decode could exhaust `budget` on an early, repeated
///   element before the cycle bound ever fired, and get misreported as `BudgetExhausted`. Separating
///   the passes closes exactly that hazard: a cycle cannot be starved by the cost of its own spine's
///   elements.
///
///   **That guarantee does not reach a cycle sitting behind an expensive SIBLING.** If an earlier
///   element of an enclosing `List` — decoded first, in a separate call to this function — exhausts
///   `budget` before this cyclic `List` is ever reached, `decode_word_ty` returns `BudgetExhausted`
///   for THAT element and the whole decode fails there, via `?`, without this arm ever running: the
///   cycle is never walked, so it cannot "win" a `Mismatch` it never gets to claim. Two files carrying
///   the identical cyclic heap can therefore exit differently depending only on where the cyclic
///   element sits relative to an expensive one in the type: cyclic element decoded first, `Mismatch`;
///   cyclic element decoded after a sibling that alone exhausts the budget, `BudgetExhausted`. Both
///   are correct, and neither is a regression — a cycle is guaranteed to win only against its own
///   cost, never against a budget already spent elsewhere.
/// - `budget` bounds SIZE. It is decremented once per constructed `Value` node (every `Nat`/`Bool`/
///   `Unit` leaf and every `Cons`), via `spend`, and decode fails with `BudgetExhausted` once it would
///   go negative. It matters because nested list types multiply: for `List<List<Nat>>`, each of up to
///   n spine steps decodes an inner list that itself walks up to n cells, so an acyclic n-cell heap can
///   still expand to O(n²) nodes — and `MAX_TY_DEPTH` nesting makes that O(n^d). The spine loop does
///   not catch this: every step makes cycle-bounded progress while still constructing an unbounded
///   amount of output.
///
/// Both matter because `tm::decode::decode_tape_ty_reason` reads a heap AND a type that can come from
/// a `.tm` FILE, where neither acyclicity nor a small size is something the compiler guaranteed. Only
/// `.tm` can actually present a cyclic heap: the `.asm` heap is built exclusively by `Instr::Cons`,
/// which only ever appends a new cell and never mutates an existing one (see its match arm above), so
/// a cell can only reference cells that already existed before it — an `.asm` heap is acyclic by
/// construction, and this guard exists for `.tm`'s hand-writable heap.
pub(crate) fn decode_word_ty(
    word: u64,
    heap: &[(u64, u64)],
    ty: &Ty,
    budget: &mut usize,
) -> Result<Value, DecodeFailure> {
    match ty {
        Ty::Nat => {
            spend(budget)?;
            Ok(Value::Nat(word))
        }
        Ty::Bool => {
            // The mismatch check runs BEFORE `spend` — see `DecodeFailure`'s doc on why that ordering
            // is exactly the hazard this enum exists to sidestep, rather than something to "fix" by
            // reordering: tagging the reason here, at the point of detection, is what makes the
            // ordering harmless.
            let v = match word {
                0 => Value::Bool(false),
                1 => Value::Bool(true),
                _ => return Err(DecodeFailure::Mismatch),
            };
            spend(budget)?;
            Ok(v)
        }
        Ty::Unit => {
            spend(budget)?;
            Ok(Value::Unit)
        }
        Ty::List(elem) => {
            // PASS 1 — walk the spine TWICE rather than buffering it: this walk confirms the chain
            // reaches nil, decoding nothing and allocating nothing, so its cost is bounded purely by
            // `heap.len()` (one counter), never by what the elements are and never by the heap's own
            // size in memory. At most one step per cell; falling out of the loop means the chain never
            // reached nil, i.e. it is cyclic — a `Mismatch` (the heap the file supplied is not
            // acyclic, as a well-formed one must be), and this is checked to completion BEFORE any
            // head is decoded, so an expensive element of THIS SPINE can never let `budget` run out
            // first and hide the cycle behind a `BudgetExhausted` — an expensive element of an
            // enclosing SIBLING, decoded first in a separate call, still can. See this function's doc.
            //
            // An earlier version of this pass collected each head WORD into a `Vec<u64>` here instead
            // of just counting: cheap per element, but that `Vec` stays fully allocated for the whole
            // of PASS 2 below, including while PASS 2 recurses into further `Ty::List` levels — so a
            // heap that is one big shared spine (any `w` doubles as a valid pointer into the SAME
            // array; see `MAX_DECODE_NODES`'s doc on sharing) stacked one such `Vec` per nesting level,
            // up to `MAX_TY_DEPTH` deep, for a total memory cost that is `O(heap.len() * MAX_TY_DEPTH)`
            // rather than the `O(budget)` this function's own doc claims. Counting instead of
            // collecting removes the `Vec` entirely; the second walk below re-reads the same pointers
            // from scratch instead of remembering them.
            let mut w = word;
            let mut steps: usize = 0;
            loop {
                if w == 0 {
                    break;
                }
                if steps > heap.len() {
                    return Err(DecodeFailure::Mismatch); // the chain never reached nil: a cyclic heap
                }
                // `w` is read off a `.tm` FILE's tapes (see this function's doc: "neither acyclicity
                // nor a small size is something the compiler guaranteed"), so it may not fit `usize` on
                // a 32-bit target. `try_from` folds that into the existing "not a valid pointer"
                // mismatch instead of truncating into a wrong, in-range index.
                let Some(idx) = usize::try_from(w - 1).ok() else { return Err(DecodeFailure::Mismatch) };
                let Some(&(_, t)) = heap.get(idx) else { return Err(DecodeFailure::Mismatch) };
                steps += 1;
                w = t;
            }

            // PASS 2 — the spine is now confirmed finite and acyclic, so decoding every head (the
            // expensive part) and spending `budget` on it is honest: any exhaustion from here really
            // is this decode being too large, not a cycle in disguise. Re-walks the identical pointers
            // PASS 1 already validated (`word` and `heap` are unchanged), decoding each head as it is
            // reached rather than buffering words first. `heads` grows only as heads are successfully
            // decoded, and every decoded head spends `budget` (below), so this `Vec` is already bounded
            // by `MAX_DECODE_NODES` — no `with_capacity` needed, and none is used. Same order as
            // before: heads decoded front-to-back, then consed back-to-front.
            let mut heads = Vec::new();
            let mut w = word;
            loop {
                if w == 0 {
                    break;
                }
                let Some(idx) = usize::try_from(w - 1).ok() else { return Err(DecodeFailure::Mismatch) };
                let Some(&(h, t)) = heap.get(idx) else { return Err(DecodeFailure::Mismatch) };
                heads.push(decode_word_ty(h, heap, elem, budget)?);
                w = t;
            }
            spend(budget)?; // the Nil node
            let mut out = Value::Nil;
            for h in heads.into_iter().rev() {
                spend(budget)?; // each Cons node
                out = Value::Cons(Rc::new(h), Rc::new(out));
            }
            Ok(out)
        }
        Ty::Fun(..) | Ty::Var(_) => Err(DecodeFailure::Mismatch),
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
    fn print_asm_mapped_agrees_with_print_asm_and_classifies_every_piece() {
        use crate::analysis::TokenClass;
        let prog = Program {
            code: vec![Instr::Li(Reg::Loc(0), 5), Instr::Jz(Reg::Loc(0), "done".to_string()), Instr::Halt],
            labels: vec![("done".to_string(), 3)],
        };
        let (text, spans) = print_asm_mapped(&prog);
        assert_eq!(text, print_asm(&prog), "the wrapper must return the mapped form's text verbatim");
        for (s, _) in &spans {
            assert!(s.end <= text.len(), "span {s:?} out of bounds for {} bytes", text.len());
            assert!(s.start < s.end, "zero-width span {s:?}");
        }
        // Spans must be ordered and non-overlapping.
        for w in spans.windows(2) {
            assert!(w[0].0.end <= w[1].0.start, "spans overlap or are unordered: {:?} then {:?}", w[0], w[1]);
        }
        // Pin the separators here rather than relying on the goldens below: swapping `\t` and `, `
        // leaves every span well-formed and every class correct, so only exact text catches it.
        assert_eq!(text, concat!("    li\tr0, #5\n", "    jz\tr0, done\n", "    halt\n", "done:\n"));

        // ASSERT THE WHOLE ORDERED SEQUENCE. Every weaker form has now failed on this branch. A
        // `named.contains(&("done", Label))` is satisfied by EITHER occurrence — "done" is both the
        // `jz` operand and the trailing label definition — so it cannot tell a broken operand
        // classification from a correct one while the unrelated definition span is still right. And
        // per-text checks say nothing at all about `#5`, which is how the `Nat` arm went untested:
        // mutating `Operand::Imm => Nat` to `Register` was caught by no test in the suite.
        let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&text[s.start..s.end], *c)).collect();
        assert_eq!(
            named,
            vec![
                ("li", TokenClass::Mnemonic),
                ("r0", TokenClass::Register),
                (",", TokenClass::Punct),
                ("#5", TokenClass::Nat),
                ("jz", TokenClass::Mnemonic),
                ("r0", TokenClass::Register),
                (",", TokenClass::Punct),
                ("done", TokenClass::Label),
                ("halt", TokenClass::Mnemonic),
                ("done", TokenClass::Label),
                (":", TokenClass::Punct),
            ]
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
        // Written with explicit `\t` rather than a literal tab: the separator is the thing under test,
        // and a literal tab here is indistinguishable from spaces on screen and liable to be
        // "helpfully" re-indented by an editor.
        let expected = concat!(
            "    li\ta0, #5\n",
            "    call\tsum\n",
            "    halt\n",
            "sum:\n",
            "    mov\tr0, a0\n",
            "    cmpeq\tr1, r0, r0\n",
            "    jz\tr1, rec\n",
            "rec:\n",
            "    ret\n",
        );
        assert_eq!(print_asm(&prog), expected);
    }

    /// Several labels at ONE index print in `prog.labels` order, and a label one past the end still
    /// prints last. `print_asm_mapped` buckets labels by index rather than rescanning, and a bucket
    /// filled in the wrong order would emit the same two names swapped — which nothing else here would
    /// catch, because every golden above has at most one label per index.
    #[test]
    fn labels_sharing_an_index_print_in_prog_labels_order() {
        let prog = Program {
            code: vec![Instr::Halt],
            labels: vec![("second".into(), 0), ("first".into(), 0), ("past_end".into(), 1)],
        };
        assert_eq!(print_asm(&prog), "second:\nfirst:\n    halt\npast_end:\n");
    }

    #[test]
    fn print_asm_golden_for_a_small_demo() {
        // A regression guard on lower_asm's codegen + print_asm's format. If either changes, re-capture
        // the expected string below (run the test, copy the `left` from the panic) — a deliberate re-bless.
        let (prog, ds) = parse("let x = 1; let y = x + x; y * 3");
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let asm = print_asm(&lower_asm(&core).expect("lowers"));
        let expected = concat!(
            "    li\tr0, #1\n",
            "    mov\tr2, r0\n",
            "    mov\tr3, r0\n",
            "    add\tr1, r2, r3\n",
            "    mov\tr4, r1\n",
            "    li\tr5, #3\n",
            "    mul\trr, r4, r5\n",
            "    halt\n",
        );
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

    /// PASS 1 must confirm a cycle from the spine's SHAPE alone, decoding no heads and spending no
    /// `budget` — never by decoding heads as it walks, the way an earlier version of this arm did (see
    /// `decode_word_ty`'s doc, "An earlier version of this function interleaved the two"). Pins that
    /// directly: a small 2-cell cycle (pointers 6 <-> 7) whose own head (pointer 1, shared by both
    /// cells) is a 5-element acyclic `List<Nat>` — 11 nodes to decode in full (5 `Cons` + 5 `Nat` + 1
    /// `Nil`) — against a `budget` of only 3, far below that. An interleaved implementation decodes
    /// that head on the very first spine step, exhausts `budget` partway through it, and never gets far
    /// enough into the spine walk to notice it never reaches nil — misreporting `BudgetExhausted`
    /// instead of `Mismatch`.
    ///
    /// Calls `decode_word_ty` directly rather than through `decode_asm_ty_reason` (whose budget is
    /// always `MAX_DECODE_NODES`), specifically so `budget` can be made this small: the whole point is
    /// that the OWN-element hazard bites at any scale, so pinning it needs only a handful of heap cells
    /// rather than the ~10,000,000 `a_cyclic_sibling_wins_only_against_its_own_spines_cost` below needs
    /// to exceed the real budget.
    #[test]
    fn a_cyclic_heap_is_mismatch_even_when_its_own_head_is_expensive() {
        use crate::ty::Ty;
        let heap: Vec<(u64, u64)> = vec![
            (10, 2), // idx0 (ptr 1): the acyclic sub-list 10 -> 20 -> 30 -> 40 -> 50 -> nil
            (20, 3), // idx1 (ptr 2)
            (30, 4), // idx2 (ptr 3)
            (40, 5), // idx3 (ptr 4)
            (50, 0), // idx4 (ptr 5): tail nil
            (1, 7),  // idx5 (ptr 6): the cycle's first cell -- head -> the sub-list, tail -> ptr 7
            (1, 6),  // idx6 (ptr 7): the cycle's second cell -- tail -> ptr 6, closing the loop
        ];
        let ty = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
        let mut budget = 3;
        assert_eq!(
            decode_word_ty(6, &heap, &ty, &mut budget), // 6 = pointer to the cycle's first cell
            Err(DecodeFailure::Mismatch),
            "a cycle must win a Mismatch against its own spine's cost, however expensive its own head is"
        );
    }

    /// Counts bytes requested through the global allocator for one call below, so
    /// `budget_zero_allocates_nothing_at_any_nesting_depth` can measure what `decode_word_ty` commits
    /// BEFORE its budget can act, instead of inferring it from wall-clock time (which this repository
    /// has recorded enough measurement mistakes over to keep trusting).
    ///
    /// An integration test under `tests/` — a separate crate — is the shape `redextape-core/tests/
    /// viewmodel_contract.rs` already uses for exactly this technique, and says so in its own comment,
    /// but that shape cannot be used here: `decode_word_ty` is `pub(crate)` (see its doc for why:
    /// `tm::decode` must not carry a second copy of this decoder), so only code inside THIS crate can
    /// call it with a hand-picked `budget` — which is what the test below needs (`budget = 0`, never
    /// reachable through the public `decode_asm_ty_reason`, whose budget is always `MAX_DECODE_NODES`).
    /// So the counter lives here instead, in this module's own `#[cfg(test)]` unit tests, and
    /// `#[global_allocator]` makes it install for `redextape-core`'s ENTIRE `--lib` unit test binary —
    /// every `#[cfg(test)] mod tests` in the crate, not just this file's — rather than the one
    /// integration-test binary `viewmodel_contract.rs` has to itself.
    ///
    /// THAT divergence is what made an earlier version of this counter wrong: it was one process-wide
    /// `AtomicUsize`, exact under cargo-nextest (one OS process per test) but not under plain `cargo
    /// test`, which runs every non-`#[ignore]`d lib test — all 682 of them — against the SAME counter.
    /// `scripts/check-slow.sh --all` drives exactly that shared-process path and failed this test
    /// deterministically (300KB-600KB of concurrent tests' allocations landing inside the before/after
    /// window, against a 4,096-byte bound), even though every CI job would have stayed green: the
    /// `rust-slow` job filters this test out via `--ignored`, and every other Rust job uses nextest.
    ///
    /// THE FIX below is per-THREAD, not per-process, and that is safe for a reason narrower than "less
    /// sharing": `libtest`'s default parallel runner spawns a genuinely new OS thread for every
    /// `#[test]` function (bounded concurrency via `--test-threads`, not a reused pool), so two tests
    /// never share a THREAD even when they share a process. A `thread_local!` counter therefore reads
    /// exact under every runner this repository has: nextest's one-process-per-test makes it exact
    /// trivially, and plain `cargo test`'s many concurrent OS threads each carry their own
    /// zero-initialized counter that only this test's own thread ever touches — a concurrent test on a
    /// SIBLING thread cannot add to it no matter how much it allocates. Unlike the process-wide
    /// version, this scoping no longer depends on which runner is asking, so it stays crate-global
    /// (`#[global_allocator]` cannot be anything else) without reintroducing the hazard.
    ///
    /// A DIFFERENT hazard this thread-local scoping does not close: libtest's own spawn hook — the
    /// closure that sets up each test's thread and clones its output-capture sink — runs on the PARENT
    /// thread, not the new test thread, so any allocation IT does lands in the parent thread's counter.
    /// Not live today: the only call this counter ever measures (`decode_word_ty`, from this file's own
    /// tests) spawns no thread of its own, so that hook never runs inside a measurement window. But a
    /// future measurement here that wrapped a call containing a `thread::spawn` would need to account
    /// for that hook's allocation too — a hazard different in kind from a concurrent test on a SIBLING
    /// thread, which this counter is genuinely immune to.
    struct CountingAlloc;

    thread_local! {
        static BYTES_ALLOCATED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    }

    unsafe impl std::alloc::GlobalAlloc for CountingAlloc {
        unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
            BYTES_ALLOCATED.with(|bytes| bytes.set(bytes.get() + layout.size()));
            unsafe { std::alloc::System.alloc(layout) }
        }

        // The default `GlobalAlloc::alloc_zeroed` (inherited if this arm is omitted) is
        // `self.alloc(layout)` followed by `write_bytes(.., 0, ..)`: it zeroes the memory itself
        // instead of asking the underlying allocator for zeroed pages, which loses `calloc`'s
        // zero-page fast path for every `vec![0; n]` in this binary's tests. Delegating to
        // `System::alloc_zeroed` restores that path; accounting is unaffected either way, since
        // both routes commit exactly `layout.size()` new bytes.
        unsafe fn alloc_zeroed(&self, layout: std::alloc::Layout) -> *mut u8 {
            BYTES_ALLOCATED.with(|bytes| bytes.set(bytes.get() + layout.size()));
            unsafe { std::alloc::System.alloc_zeroed(layout) }
        }

        unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
            unsafe { std::alloc::System.dealloc(ptr, layout) }
        }

        // The default `GlobalAlloc::realloc` (inherited if this arm is omitted) is alloc-copy-dealloc:
        // it always allocates `new_size` fresh, copies the old bytes in, and frees the original, even
        // when the underlying allocator could have grown the same block in place. That default was
        // live here for every one of this binary's 685 tests, not just this one — every in-place
        // `Vec`/`String` growth anywhere in `redextape-core`'s lib tests was silently paying for a
        // fresh allocation and a copy it would not have paid running under `System` alone, which is
        // also most of why the noise floor a shared-process counter saw ran to hundreds of KB. Routing
        // through `System::realloc` restores in-place growth, and counting only `new_size`'s excess
        // over the OLD layout's size (never the full `new_size`, which would recount bytes the block
        // already held) matches what `alloc`/`dealloc` count: bytes newly committed, not bytes moved.
        unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, new_size: usize) -> *mut u8 {
            if let Some(grew_by) = new_size.checked_sub(layout.size()) {
                BYTES_ALLOCATED.with(|bytes| bytes.set(bytes.get() + grew_by));
            }
            unsafe { std::alloc::System.realloc(ptr, layout, new_size) }
        }
    }

    #[global_allocator]
    static ALLOCATOR: CountingAlloc = CountingAlloc;

    /// Pins the SECOND fix: at `budget = 0`, the `Ty::List` arm must allocate NOTHING before the first
    /// `spend` anywhere in the call can even run, at any nesting depth — `heads` grows lazily and
    /// nothing buffers the spine's WORDS ahead of decoding them. `budget = 0` makes that first `spend`
    /// fail immediately, so whatever the allocator saw during the call is exactly what was committed
    /// before the budget could act.
    ///
    /// The heap is a single `l`-cell acyclic spine where EVERY cell's head word repoints at the spine's
    /// own start — "one big shared spine" (`decode_word_ty`'s doc on `PASS 1` names this exact hazard),
    /// so decoding any head at any nesting level re-walks the SAME `l` cells. `ty` nests that spine 4
    /// levels deep (`List<List<List<List<Nat>>>>`). An earlier version of this arm collected the
    /// spine's head WORDS into a `Vec<u64>` before decoding any of them (`PASS 1`'s doc, "An earlier
    /// version of this pass collected each head WORD into a `Vec<u64>`") — one such `Vec`, sized to the
    /// FULL spine, PER nesting level, all before `budget = 0` ever gets to refuse anything: roughly
    /// `4 * l * 8` bytes for `l = 20,000`, around 640KB, decisively over the bound below. The current
    /// arm allocates zero regardless of `l` or nesting depth.
    ///
    /// The bound is `assert_eq!(.., 0)`, not a generous margin, because the counter is now exact (see
    /// `CountingAlloc`'s doc): a `thread_local!` counter cannot see a concurrent test's allocation, so
    /// there is no foreign noise left to leave headroom FOR. What remains is only whether THIS call
    /// allocates, and tracing it settles that exactly — PASS 1 counts without allocating, PASS 2's
    /// `heads` is `Vec::new()` (no allocation until a first successful push), and at `budget = 0` the
    /// first `spend` anywhere in the call — reached by recursing to the innermost `Ty::Nat`, before
    /// `heads.push` on any level ever returns — fails via `?` before any `Vec` grows or any `Cons`
    /// node's `Rc::new` runs. Confirmed directly: a probe read of `bytes_used` at HEAD prints `0`, on
    /// every one of `cargo test --release`, its debug build, `--include-ignored`, and `cargo nextest`.
    #[test]
    fn budget_zero_allocates_nothing_at_any_nesting_depth() {
        use crate::ty::Ty;
        let l: u64 = 20_000;
        // Every cell's head repoints at the spine's own start (`l`); tail counts down to nil, same
        // acyclic shape as `a_long_acyclic_list_still_decodes` above.
        let heap: Vec<(u64, u64)> = (1..=l).map(|i| (l, i - 1)).collect();
        let ty = Ty::List(Box::new(Ty::List(Box::new(Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))))))));

        let before = BYTES_ALLOCATED.with(std::cell::Cell::get);
        let mut budget = 0;
        let result = decode_word_ty(l, &heap, &ty, &mut budget);
        let bytes_used = BYTES_ALLOCATED.with(std::cell::Cell::get) - before;

        assert_eq!(result, Err(DecodeFailure::BudgetExhausted), "budget = 0 must fail on the very first spend");
        assert_eq!(
            bytes_used, 0,
            "decoding at budget = 0 must allocate nothing before the first spend can act, got {bytes_used} bytes"
        );
    }

    /// The doc comment above (and `redextape-cli/README.md`) claims only that a cycle wins a
    /// `Mismatch` against ITS OWN spine's cost, never unconditionally: reached behind a SIBLING that
    /// alone exhausts `budget`, the same cyclic heap is never even walked, and the failure is
    /// `BudgetExhausted` instead. Pins that with one heap holding both an expensive, acyclic
    /// `List<Nat>` (one element over `MAX_DECODE_NODES` on its own) and a cyclic `List<Nat>` (a
    /// single self-referencing cell), assembled into a two-element `List<List<Nat>>` both ways: the
    /// two orderings differ ONLY in which element is decoded first, and that alone flips the reported
    /// `DecodeFailure`.
    ///
    /// Ignored by default: same scale as `the_node_budget_boundary_is_exact` above, for the same
    /// reason — the expensive sibling alone needs ~10,000,000 heap cells to exceed the budget.
    #[test]
    #[ignore = "slow tier: allocates ~10,000,000 heap cells"]
    fn a_cyclic_sibling_wins_only_against_its_own_spines_cost() {
        use crate::ty::Ty;
        let l_over = (MAX_DECODE_NODES as u64 - 1) / 2 + 1; // one element over budget, alone

        // The expensive, acyclic sibling: a flat `List<Nat>` of `l_over` elements, same construction
        // as `the_node_budget_boundary_is_exact`'s over-budget case. Its own pointer is `l_over`.
        let mut heap: Vec<(u64, u64)> = (1..=l_over).map(|i| (i, i - 1)).collect();
        let expensive_ptr = l_over;

        // The cyclic sibling: one cell whose tail points at itself, same shape as
        // `a_cyclic_heap_decodes_to_none_rather_than_overflowing`'s first case.
        heap.push((7, heap.len() as u64 + 1));
        let cyclic_ptr = heap.len() as u64;

        // Append the two-element outer spine (`cons(first, cons(second, nil))`) to a COPY of the
        // shared heap, so the two orderings below are otherwise identical.
        let build_outer = |mut heap: Vec<(u64, u64)>, first: u64, second: u64| -> AsmOutcome {
            heap.push((second, 0)); // second element, tail nil
            let second_cell = heap.len() as u64;
            heap.push((first, second_cell)); // first element, tail -> second cell
            let top = heap.len() as u64;
            AsmOutcome { result: top, heap }
        };

        let ty = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));

        let cycle_first = build_outer(heap.clone(), cyclic_ptr, expensive_ptr);
        assert_eq!(
            decode_asm_ty_reason(&cycle_first, &ty),
            Err(DecodeFailure::Mismatch),
            "decoded first, the cyclic element must win its own Mismatch before the expensive sibling ever runs"
        );

        let cycle_behind_expensive = build_outer(heap, expensive_ptr, cyclic_ptr);
        assert_eq!(
            decode_asm_ty_reason(&cycle_behind_expensive, &ty),
            Err(DecodeFailure::BudgetExhausted),
            "decoded first, the expensive sibling exhausts the budget before the cyclic element is ever reached"
        );
    }

    #[test]
    fn validate_accepts_a_lowered_program() {
        let prog = Program {
            code: vec![Instr::Li(Reg::Loc(0), 1), Instr::Jmp("done".to_string()), Instr::Halt],
            labels: vec![("done".to_string(), 2)],
        };
        assert_eq!(prog.validate(), Vec::<String>::new());
    }

    #[test]
    fn validate_flags_an_undefined_jump_target() {
        let prog = Program { code: vec![Instr::Jmp("nowhere".to_string())], labels: Vec::new() };
        let errs = prog.validate();
        assert!(errs.iter().any(|e| e.contains("nowhere")), "{errs:?}");
    }

    /// Every jumping instruction, not just `Jmp` — the defect this exists to catch is a typo, and a
    /// typo is as likely in a `jz` or a `call`.
    #[test]
    fn validate_flags_undefined_targets_of_jz_and_call() {
        let prog = Program {
            code: vec![Instr::Jz(Reg::Rr, "a".to_string()), Instr::Call("b".to_string())],
            labels: Vec::new(),
        };
        let errs = prog.validate();
        assert!(errs.iter().any(|e| e.contains('a')), "{errs:?}");
        assert!(errs.iter().any(|e| e.contains('b')), "{errs:?}");
    }

    #[test]
    fn validate_flags_a_register_over_the_cap() {
        let prog = Program { code: vec![Instr::Nil(Reg::Loc(MAX_REGISTERS))], labels: Vec::new() };
        let errs = prog.validate();
        assert!(errs.iter().any(|e| e.contains("register")), "{errs:?}");
    }

    /// `label_index` takes the first match, so a duplicate is silently shadowed rather than reported.
    #[test]
    fn validate_flags_a_duplicate_label_name() {
        let prog =
            Program { code: vec![Instr::Halt, Instr::Halt], labels: vec![("f".to_string(), 0), ("f".to_string(), 1)] };
        let errs = prog.validate();
        assert!(errs.iter().any(|e| e.contains("duplicate")), "{errs:?}");
    }

    /// Design §3.3: `String` admits names the form cannot represent. This is the asm counterpart of
    /// `Machine::validate`'s `name_representable` check.
    #[test]
    fn validate_flags_an_unrepresentable_label_name() {
        for bad in ["", "two words", "colon:", "semi;colon", "com,ma"] {
            let prog = Program { code: vec![Instr::Halt], labels: vec![(bad.to_string(), 0)] };
            let errs = prog.validate();
            assert!(!errs.is_empty(), "`{bad}` must be rejected as a label name");
        }
    }

    /// Design §3.1: the printer drops these silently. Validation is what makes the loss loud.
    #[test]
    fn validate_flags_a_label_index_past_the_end() {
        let prog = Program { code: vec![Instr::Halt], labels: vec![("far".to_string(), 2)] };
        let errs = prog.validate();
        assert!(errs.iter().any(|e| e.contains("far")), "{errs:?}");
        // One past the end is legal — the printer emits it, and a trailing skip target needs it.
        let ok = Program { code: vec![Instr::Halt], labels: vec![("end".to_string(), 1)] };
        assert_eq!(ok.validate(), Vec::<String>::new());
    }

    #[test]
    fn the_header_prints_before_the_listing() {
        let prog = Program { code: vec![Instr::Li(Reg::Rr, 7), Instr::Halt], labels: Vec::new() };
        let h = AsmHeader { result: Ty::Nat };
        let text = print_asm_with(&prog, &h);
        assert!(text.starts_with("result Nat\n\n"), "header then a blank line, got:\n{text}");
        assert!(text.ends_with(&print_asm(&prog)), "the listing follows unchanged");
    }

    /// The whole point of the optional model: adding a header must not perturb the listing's bytes.
    #[test]
    fn the_listing_is_byte_identical_with_and_without_a_header() {
        let prog = Program {
            code: vec![Instr::Li(Reg::Loc(0), 1), Instr::Jmp("done".to_string()), Instr::Halt],
            labels: vec![("done".to_string(), 2)],
        };
        let bare = print_asm(&prog);
        let headered = print_asm_with(&prog, &AsmHeader { result: Ty::Bool });
        assert_eq!(headered.strip_prefix("result Bool\n\n"), Some(bare.as_str()));
    }

    #[test]
    fn a_list_result_prints_through_ty_show() {
        let prog = Program { code: vec![Instr::Halt], labels: Vec::new() };
        let h = AsmHeader { result: Ty::List(Box::new(Ty::Nat)) };
        assert!(print_asm_with(&prog, &h).starts_with("result List<Nat>\n"));
    }

    /// Spans must cover the header too, and by construction rather than by re-scanning.
    #[test]
    fn the_headered_printer_classifies_its_own_directive() {
        use crate::analysis::TokenClass as C;
        let prog = Program { code: vec![Instr::Halt], labels: Vec::new() };
        let (text, spans) = print_asm_with_mapped(&prog, &AsmHeader { result: Ty::Nat });
        // Every span must name the bytes it claims.
        for (span, _) in &spans {
            assert!(span.end <= text.len(), "span past end of text");
        }
        assert!(spans.iter().any(|(s, c)| *c == C::Keyword && &text[s.start..s.end] == "result"));
        assert!(spans.iter().any(|(s, c)| *c == C::Ident && &text[s.start..s.end] == "Nat"));
    }
}
