//! The register-assembly IR: a small register machine whose control flow becomes (in Part 2) the
//! Turing machine's state graph, and whose data (registers, stack, heap) becomes tapes. Registers
//! hold `u64` words; because Core is typed, the compiled code statically knows whether a word is a
//! `Nat` count, a `0`/`1` `Bool`, or a heap pointer, so there are no runtime type tags.

use crate::analysis::push_span;
use crate::core::BinOp;
use crate::tm::asm_syntax::AsmDocument;
use crate::tm::comments::{AnchoredComment, AsmAnchor, CommentWriter};
use crate::ty::Ty;
use crate::value::Value;
use std::collections::HashMap;
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
    print_asm_with_inner(prog, None, &[])
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

/// `print_asm_with`, plus a class per span of the produced text — the header directive included.
#[must_use]
pub fn print_asm_with_mapped(prog: &Program, h: &AsmHeader) -> (String, crate::analysis::Classified) {
    print_asm_with_inner(prog, Some(h), &[])
}

/// The one printer. The header's presence is the ONLY difference between `print_asm_mapped` and
/// `print_asm_with_mapped`, which is what keeps them from drifting. Spans are pushed as each piece is
/// appended, so an offset is exact by construction and nothing re-scans the output.
///
/// `comments` is `&[]` from `print_asm_mapped`/`print_asm_with_mapped`: an empty slice makes every
/// `CommentWriter` call below write nothing, so those two entry points stay byte-identical to what
/// they produced before comments existed by construction, not by care taken here.
fn print_asm_with_inner(
    prog: &Program,
    header: Option<&AsmHeader>,
    comments: &[AnchoredComment<AsmAnchor>],
) -> (String, crate::analysis::Classified) {
    use crate::analysis::TokenClass as C;
    let mut out = String::new();
    let mut spans: crate::analysis::Classified = Vec::new();

    // The same writer the TM printer uses. One rule, one implementation.
    let cw = CommentWriter::new(comments);

    if let Some(h) = header {
        cw.own_line(&mut out, &mut spans, AsmAnchor::Result, "");
        push_span(&mut out, &mut spans, "result", C::Keyword);
        out.push(' ');
        push_span(&mut out, &mut spans, &crate::ty::show(&h.result), C::Ident);
        cw.trailing(&mut out, &mut spans, AsmAnchor::Result);
        out.push('\n');
        out.push('\n');
    }

    // Bucket the labels by the index they precede, once. Rescanning `prog.labels` inside the loop over
    // `prog.code` made printing O(code x labels), and both grow with program size.
    //
    // `prog.labels` ORDER is load-bearing: when several labels sit at one index they print in the order
    // they appear there, and the goldens pin that. Pushing into per-index buckets in `prog.labels` order
    // reproduces it exactly. The `code.len() + 1` length covers the one-past-the-end targets handled
    // below; a label further past the end is dropped by `get_mut`, which is what the old scan did too
    // (neither loop had an index for it).
    //
    // `(usize, &str)` rather than `&str`: the anchor is the label's own index in `prog.labels`, because
    // several labels may sit at one instruction index and this bucketing is what reproduces their
    // order. The index has to travel with the name to reach the emit calls below.
    let mut labels_at: Vec<Vec<(usize, &str)>> = vec![Vec::new(); prog.code.len() + 1];
    for (li, (name, at)) in prog.labels.iter().enumerate() {
        if let Some(bucket) = labels_at.get_mut(*at) {
            bucket.push((li, name.as_str()));
        }
    }

    let emit_label = |o: &mut String, s: &mut crate::analysis::Classified, li: usize, name: &str| {
        cw.own_line(o, s, AsmAnchor::Label(li), "");
        push_span(o, s, name, C::Label);
        push_span(o, s, ":", C::Punct);
        cw.trailing(o, s, AsmAnchor::Label(li));
        o.push('\n');
    };

    for (idx, instr) in prog.code.iter().enumerate() {
        for (li, name) in labels_at.get(idx).into_iter().flatten() {
            emit_label(&mut out, &mut spans, *li, name);
        }
        cw.own_line(&mut out, &mut spans, AsmAnchor::Instr(idx), "    ");
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
        cw.trailing(&mut out, &mut spans, AsmAnchor::Instr(idx));
        out.push('\n');
    }
    // Any labels pointing one past the end (e.g. a trailing skip target) still print.
    for (li, name) in labels_at.get(prog.code.len()).into_iter().flatten() {
        emit_label(&mut out, &mut spans, *li, name);
    }
    cw.own_line(&mut out, &mut spans, AsmAnchor::Eof, "");
    (out, spans)
}

/// Render a document — program, header and comments — as `.asm` text.
///
/// `None` when the document has no program, for the reason `print_tm_doc` states.
#[must_use]
pub fn print_asm_doc(d: &AsmDocument) -> Option<String> {
    let p = d.program.as_ref()?;
    Some(print_asm_with_inner(p, d.header.as_ref(), &d.comments).0)
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
///
/// `decode_asm_reason`'s `.ok()`, for the callers that only need to know THAT it failed.
#[must_use]
pub fn decode_asm(outcome: &AsmOutcome, expected: &Value) -> Option<Value> {
    decode_asm_reason(outcome, expected).ok()
}

/// `decode_asm`, keeping WHY a failed decode failed — the value-directed twin of
/// `decode_asm_ty_reason`, and for the same reason: the two causes have opposite fault attributions.
///
/// # Errors
///
/// `DecodeFailure::Mismatch` if `outcome`'s data does not have the shape `expected` describes.
/// `DecodeFailure::BudgetExhausted` if `MAX_DECODE_NODES` ran out on an otherwise-truthful decode.
pub fn decode_asm_reason(outcome: &AsmOutcome, expected: &Value) -> Result<Value, DecodeFailure> {
    let mut budget = MAX_DECODE_NODES;
    decode_word(outcome.result, &outcome.heap, expected, &mut budget)
}

/// Memo for the value-directed decode, keyed `(heap pointer, address of the expectation node)`.
///
/// **Why address identity is sound, as the two ways it could not be.** Two structurally-equal
/// expectations at different addresses are different keys, so the memo MISSES — which costs time and
/// cannot change an answer. Two DIFFERENT expectations cannot share an address while both are alive,
/// and `expected` is borrowed for the whole decode, so nothing the memo has keyed is dropped and its
/// address reissued mid-walk. No pointer here is ever dereferenced; they are hashed and compared.
///
/// Keying on the expectation's STRUCTURE instead would be slower — hashing a `Value` is proportional
/// to the walk the memo exists to avoid — and no more correct, since sharing is precisely what
/// address identity detects and structure does not.
///
/// **Bounded now, the same way `TyMemo` is.** Every insert happens in the `Cons` arm, right after the
/// `Cons`-node `spend` (see `MAX_DECODE_NODES`'s doc), and nothing else inserts — so the table can hold
/// at most one entry per budget unit spent, at most `MAX_DECODE_NODES` entries, on the order of a
/// gigabyte at the current constant, same as `TyMemo`.
type ValMemo = HashMap<(u64, *const Value), Value>;

/// `clippy::similar_names`: flags the local `head` against the `heap` parameter. Both are the
/// established domain terms (a cons cell's head; the HEAP tape/table) and neither can rename without
/// losing that.
#[allow(clippy::similar_names)]
pub(crate) fn decode_word(
    word: u64,
    heap: &[(u64, u64)],
    expected: &Value,
    budget: &mut usize,
) -> Result<Value, DecodeFailure> {
    let mut memo = ValMemo::new();
    decode_word_memo(word, heap, expected, &mut memo, budget)
}

/// `decode_word`'s recursion, carrying the memo. Split out so the public path seeds one per decode.
///
/// **Recurses once per list element, unlike its type-directed sibling.** `decode_word_ty_at` is
/// iterative over the list spine — that two-pass loop structure is what it is for. This function
/// instead calls itself on `tail` for every `Cons`, so its stack depth is the list length. That is a
/// property of this recursion's SHAPE, pre-existing before this branch's memo and not introduced or
/// worsened by it — the memo changes how much work a frame does, not how many frames there are (see
/// `crates/redextape-core/tests/sharing_aware_decode.rs`'s `value_directed_tails_is_linear` for a
/// measured depth).
///
/// **Accounting matches `decode_word_ty_at`'s `3L + 1` exactly: one unit per constructed node, one per
/// `Cons` descent.** A `Nat`/`Bool`/`Nil` leaf spends one unit for the node it constructs; a `Cons`
/// spends one unit for the descent (the value-directed twin of a spine step) plus one more for the
/// node it builds from the decoded head/tail — see `MAX_DECODE_NODES`'s doc. A memo hit spends
/// nothing, exactly as `decode_word_ty_at`'s does, for the same reason: it constructs nothing.
///
/// `clippy::similar_names`: flags the local `head` against the `heap` parameter — see `decode_word`.
#[allow(clippy::similar_names)]
fn decode_word_memo(
    word: u64,
    heap: &[(u64, u64)],
    expected: &Value,
    memo: &mut ValMemo,
    budget: &mut usize,
) -> Result<Value, DecodeFailure> {
    match expected {
        Value::Nat(_) => {
            spend(budget)?;
            Ok(Value::Nat(word))
        }
        Value::Bool(_) => {
            let v = match word {
                0 => Value::Bool(false),
                1 => Value::Bool(true),
                _ => return Err(DecodeFailure::Mismatch),
            };
            spend(budget)?;
            Ok(v)
        }
        Value::Nil => {
            if word == 0 {
                spend(budget)?;
                Ok(Value::Nil)
            } else {
                Err(DecodeFailure::Mismatch)
            }
        }
        Value::Cons(exp_h, exp_t) => {
            // Only the `Cons` arm memoizes: a leaf costs one construction, where an entry costs a
            // hash, a key and a clone. `from_ref` rather than `as *const _` per `clippy::pedantic`.
            let key = (word, std::ptr::from_ref::<Value>(expected));
            if let Some(v) = memo.get(&key) {
                return Ok(v.clone());
            }
            if word == 0 {
                return Err(DecodeFailure::Mismatch); // expected a cons, got nil
            }
            spend(budget)?; // this descent — the value-directed twin of a spine step
            // `word` comes from a public, caller-supplied `AsmOutcome` (see `decode_asm`), not only
            // from a `run_asm` run of this module's own bounded heap — a hand-built `word` may not fit
            // `usize` on a 32-bit target. Fold that into the existing "not a valid pointer" mismatch
            // rather than truncating into a wrong, in-range index.
            let Some(idx) = usize::try_from(word - 1).ok() else { return Err(DecodeFailure::Mismatch) };
            let Some(&(h, t)) = heap.get(idx) else { return Err(DecodeFailure::Mismatch) };
            let head = decode_word_memo(h, heap, exp_h, memo, budget)?;
            let tail = decode_word_memo(t, heap, exp_t, memo, budget)?;
            spend(budget)?; // the Cons node
            let out = Value::Cons(Rc::new(head), Rc::new(tail));
            memo.insert(key, out.clone());
            Ok(out)
        }
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) | Value::Box(_) => Err(DecodeFailure::Mismatch),
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
/// **That derivation is written for the ASM consumer; the other one is bounded by a DIFFERENT
/// constant.** `tm::decode::decode_tape_ty` reads a heap off a TM tape, bounded by `sim::DEFAULT_CAPS`
/// `.cells` (total tape cells), not by `asm::DEFAULT_CAPS.heap`. It works out with room to spare —
/// a heap cons cell costs at least three cells (`@`, `#`, and one word cell), so 5,000,000 cells is
/// under ~1.6M cells' worth of cons cells and well inside this budget. Stated because the two
/// constants are numerically equal today and independently changeable: raising `sim`'s cell cap
/// without revisiting this would silently break the property on the TM path.
///
/// DERIVED, not picked, and the derivation counts WORK rather than nodes. A decode spends one unit
/// per constructed `Value` node and one per spine step, so a flat `List<Nat>` over an `L`-cell heap
/// costs `3L + 1`: `L` steps, `L` `Nat` leaves, one `Nil`, `L` `Cons` nodes. A run under
/// `DEFAULT_CAPS` may legitimately build `DEFAULT_CAPS.heap` = `5_000_000` cells, so the largest
/// legitimate flat decode is `3 * 5_000_000 + 1` = `15_000_001` against this constant's `20_000_000`.
/// It fits with `4_999_999` units of headroom, which is the figure to re-derive if `DEFAULT_CAPS.heap`
/// ever rises: above `6_666_666` cells the flat case alone exceeds the budget. The margin is 1.33x,
/// where the earlier `2L + 1` accounting left 2.0x.
///
/// **WHY STEPS COST, AND NOT ONLY NODES.** The decode memoizes on `(pointer, depth)`, and a memo hit
/// constructs nothing. Charging only constructed nodes would therefore leave a way to make progress
/// for free — and PASS 1's spine walk, which allocates nothing and stops the instant it reaches nil or
/// a pointer already in the memo, would be re-walkable for free from every spine that reaches it: `k`
/// distinct prefixes converging on one shared tail of length `s` each re-walk that whole tail before
/// PASS 1's own memo exit can answer, so an unbudgeted PASS 1 costs `k * s` rather than `k + s` —
/// quadratic on a convergent heap, and nothing else bounds it (see
/// `convergent_chains_walk_the_shared_tail_once`). Charging the step restores the bound. The invariant
/// that follows, and the one worth keeping in mind when editing either loop: **every memo entry is paid
/// for by exactly one budget unit, so the memo cannot outgrow the budget** — still true here: every
/// insert happens in PASS 2's cons-up loop, one per `Cons` `spend`, which moving the spine-step charge
/// to PASS 1 does not touch.
///
/// **WHAT THIS CONSTANT NO LONGER HAS TO ABSORB.** It used to carry a documented residual gap:
/// `Instr::Tail` is a pointer read rather than an allocation, so an ordinary `tails`-style function
/// returns a `List<List<Nat>>` whose inner lists share the outer spine — `~2m` heap cells but
/// `m^2 + m + 1` decode nodes, because the decoder re-walked each shared sub-list once per pointer
/// into it. Breakeven was `m ~ 4_471`, three orders of magnitude below `DEFAULT_CAPS.heap`, so a
/// correct, fast, cap-respecting program could be refused. Memoization closes it: the same fixture at
/// `m = 64_000` decodes in about 192,000 nodes. What remains is honest — distinct `(pointer, depth)`
/// pairs are at most `heap.len() * (depth + 1)`, so a 5,000,000-cell heap under a 64-deep type can
/// still present 320,000,000 distinct nodes and be refused, and 320,000,000 distinct nodes is
/// 320,000,000 nodes of real memory.
///
/// `decode_asm`/`decode_word`, the Value-directed siblings, are bounded the same way and for the same
/// reason; see `decode_word`.
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

/// Memo for the type-directed decode, keyed `(heap pointer, depth)`.
///
/// **Depth identifies the type, and that is a property of this decoder rather than a convenience.**
/// `decode_word_ty_at` recurses in exactly one arm, `Ty::List(elem)`, and recurses on `elem` — so the
/// types visited from the root form a suffix chain of the root type, and a position in that chain
/// names one of them uniquely. A `usize` is therefore a complete key, with no `Ty` hashing and no
/// `Hash` impl on a public type.
///
/// Only LIST values are memoized. A `Nat`/`Bool`/`Unit` leaf costs one construction, where an entry
/// costs a hash, a key and a clone.
///
/// **The table's total size is bounded too, and by the same unit `MAX_DECODE_NODES` counts.** Every
/// insert happens in the cons-up loop, one per `Cons` `spend` (see `MAX_DECODE_NODES`'s doc), and
/// nothing else inserts — so the table can hold at most one entry per budget unit spent, roughly
/// 20,000,000 entries at the current constant, on the order of a gigabyte. That is a new term in the
/// decoder's peak memory that did not exist before this branch.
type TyMemo = HashMap<(u64, usize), Value>;

/// Type-directed decode of one word. `pub(crate)` because `tm::decode::decode_tape_ty_reason` decodes
/// the same `(word, heap)` pair off a set of TAPES and must not carry a second copy of THIS decoder —
/// a second budget/cycle-bound pair could silently disagree with this one. **That claim used to be
/// qualified, and the qualification was false.** It read: the VALUE-directed sibling `decode_word` IS
/// duplicated, "but safely, since both recurse structurally on a finite reference `Value` already in
/// memory and need no budget at all". A finite reference `Value` bounds TERMINATION and not COST — an
/// `Rc`-shared one is a DAG, and walking it expands the DAG back into a tree. So `decode_word` is no
/// longer duplicated either, for exactly the reason given above for this function.
///
/// Two SEPARATE totality guards, neither implying the other:
///
/// - Recursion here is on the TYPE (strictly smaller at each `List` element), never on the heap
///   chain: the list SPINE is a loop, bounded by one step per heap cell. That bound is what makes a
///   cyclic heap decode to `Err` instead of overflowing the stack — a chain longer than the heap has
///   cells must have revisited one. It bounds CYCLES, not SIZE: it says nothing about how much a
///   single acyclic decode may construct. **A cycle wins a `Mismatch` against its OWN spine's cost,
///   unconditionally** — matching `DecodeFailure`'s doc, which lists this arm's failure as `Mismatch`
///   with no qualification — because the `Ty::List` arm below walks the spine to completion (or to the
///   cycle bound) in a pass that decodes no head at all, BEFORE a second pass decodes any head of THAT
///   spine. An earlier version of this function interleaved the two — decoding each head as it walked
///   past it — so a cyclic heap whose OWN elements were themselves expensive to decode could exhaust
///   `budget` on an early, repeated element before the cycle bound ever fired, and get misreported as
///   `BudgetExhausted`. Separating the passes closes that hazard: a cycle can never be starved by the
///   cost of DECODING its own spine's elements. Nor, once PASS 1 started charging one unit per step
///   (see `MAX_DECODE_NODES`'s doc on why), can it be starved by the cost of WALKING them: PASS 1 does
///   not use `?` on its own `spend` — it records exhaustion and keeps walking, still bounded by
///   `steps > heap.len()`, so the cycle bound gets its chance to fire regardless of how little budget
///   the walk itself has left. Only if the walk reaches nil (or a memo hit) without ever tripping the
///   cycle bound is the recorded exhaustion reported.
///
///   **That guarantee does not reach a cycle sitting behind an expensive SIBLING.** If an earlier
///   element of an enclosing `List` — decoded first, in a separate call to this function — exhausts
///   `budget` to `0` before this cyclic `List` is ever reached, `decode_word_ty` returns
///   `BudgetExhausted` for THAT element and the whole decode fails there, via `?`, without this arm
///   ever running: the cycle is never walked, so it cannot "win" a `Mismatch` it never gets to claim.
///   That is the only route: a sibling that leaves `budget` merely LOW rather than fully exhausted does
///   not stop this arm from reaching its own cycle bound, because PASS 1's own exhaustion, if any, is
///   deferred until the walk finishes — so a cycle reached with any amount of budget remaining,
///   including exactly `0`, still wins its `Mismatch`. A cycle is guaranteed to win against its own
///   cost always; the only way to see `BudgetExhausted` instead is for an earlier sibling to exhaust
///   `budget` completely first (driving it negative via `?`), so this arm never runs at all.
/// - `budget` bounds SIZE. It is decremented once per constructed `Value` node (every
///   `Nat`/`Bool`/`Unit` leaf and every `Cons`), via `spend`; a memo hit (see `TyMemo`) returns a clone
///   of a node already paid for and spends nothing. Decode fails with `BudgetExhausted` once `budget`
///   would go negative.
///
///   **That collapses total spends to the memo's distinct-entry count, regardless of the order a
///   spine's heads arrive in.** Both PASS 1 and PASS 2 in the `Ty::List` arm below stop the instant they
///   reach a pointer already in the memo, not only at nil — so a spine first reached from a SHORTER
///   suffix is never re-walked once a longer head later runs into it; it stops there instead, the same
///   way it would at nil. Every `(pointer, depth)` key is therefore inserted at most once for the whole
///   decode, never overwritten. So `n * (depth + 1)`, the count of distinct `(pointer, depth)` keys an
///   n-cell heap can name across `MAX_TY_DEPTH` nesting, bounds both the memo's SIZE and
///   `MAX_DECODE_NODES`'s spends — see `convergent_chains_walk_the_shared_tail_once` for the
///   convergent-spine case this closes, and
///   `a_nested_type_over_a_shared_spine_decodes_instead_of_refusing`'s doc for the increasing-order case
///   it also closes.
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
    let mut memo = TyMemo::new();
    decode_word_ty_at(word, heap, ty, 0, &mut memo, budget)
}

/// `decode_word_ty`'s recursion, carrying the depth (which names the type — see `TyMemo`) and the
/// memo. Split out so the public path seeds one memo per decode and every recursive call shares it.
fn decode_word_ty_at(
    word: u64,
    heap: &[(u64, u64)],
    ty: &Ty,
    depth: usize,
    memo: &mut TyMemo,
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
            // This list has been decoded already, at this same type. Cloning a `Value::Cons(Rc, Rc)`
            // bumps two refcounts, so the hit SHARES rather than rebuilds — which is not a side effect
            // of memoizing, it is the point: this clone costs no `spend` at all, and (see `budget`'s own
            // bullet on `decode_word_ty`'s doc) that holds for a spine reached from ANY suffix, not only
            // its longest — the result is a DAG whose distinct-node count is exactly what the budget
            // measures.
            if let Some(v) = memo.get(&(word, depth)) {
                return Ok(v.clone());
            }

            // PASS 1 — walk the spine, decoding no head and allocating nothing, charging one `spend`
            // per step (see `MAX_DECODE_NODES`'s doc on why). Falling out of the loop means the chain
            // never reached nil, i.e. it is cyclic — a `Mismatch`, checked to completion BEFORE any
            // head of this spine is decoded, so an expensive element of THIS SPINE can never let
            // `budget` run out first and hide the cycle behind a `BudgetExhausted`.
            //
            // The spend is NOT `?`-ed here. Exhaustion is recorded in `exhausted` and the walk keeps
            // going — still bounded by `steps > heap.len()`, so the extra work past exhaustion is at
            // most one more pass over the heap, paid once for the whole decode — so the cycle bound
            // still gets its chance to fire even after `budget` is gone. Only once the walk finishes
            // without finding a cycle (nil, or a memo hit) does `exhausted` get reported. That is what
            // makes the cycle win unconditionally: neither an expensive head of THIS spine (PASS 2 never
            // runs while PASS 1 is still walking) nor `budget` merely running low or out DURING the walk
            // itself can stop PASS 1 short of the cycle bound.
            let mut w = word;
            let mut steps: usize = 0;
            let mut exhausted = false;
            loop {
                // Nil, or a pointer already proven finite and acyclic by a completed decode. The
                // second exit is what keeps CONVERGENT chains linear: without it each spine that runs
                // into a shared tail re-walks the whole tail before the memo can answer.
                if w == 0 || memo.contains_key(&(w, depth)) {
                    break;
                }
                if steps > heap.len() {
                    return Err(DecodeFailure::Mismatch); // the chain never reached nil: a cyclic heap
                }
                let Some(idx) = usize::try_from(w - 1).ok() else { return Err(DecodeFailure::Mismatch) };
                let Some(&(_, t)) = heap.get(idx) else { return Err(DecodeFailure::Mismatch) };
                if !exhausted && spend(budget).is_err() {
                    exhausted = true; // remember, but keep walking — the cycle bound still must fire
                }
                steps += 1;
                w = t;
            }
            if exhausted {
                return Err(DecodeFailure::BudgetExhausted);
            }

            // PASS 2 — the spine is confirmed finite and acyclic (or ends at a memo hit, which is
            // proven finite and acyclic by the completed decode that produced it), so decoding every
            // head and spending `budget` on it is honest. Each cell's POINTER is carried alongside its
            // decoded head, which costs 8 bytes per entry and is what lets the cons-up loop below
            // memoize every suffix rather than only the finished list.
            let mut cells: Vec<(u64, Value)> = Vec::new();
            let mut w = word;
            let base = loop {
                if w == 0 {
                    spend(budget)?; // the Nil node — only charged when the spine itself reaches nil; a
                    // spine that stops at a memo hit below builds no `Nil` of its own
                    break Value::Nil;
                }
                if let Some(v) = memo.get(&(w, depth)) {
                    break v.clone(); // the rest of this spine is already built
                }
                // These two checks are unreachable in practice: PASS 1 above walks this identical chain
                // over the same immutable heap first, so an invalid pointer is already a `Mismatch`
                // raised there, before PASS 2 ever sees it. They stay rather than get deleted as dead
                // code because they are what keeps this arm total if the two passes ever diverge — and
                // that stays true after this mid-spine exit: both passes stop at the same memo hit, so
                // the two chains still coincide. No `spend` here — PASS 1 already charged this step (see
                // `MAX_DECODE_NODES`'s doc); charging it again would double-count.
                let Some(idx) = usize::try_from(w - 1).ok() else { return Err(DecodeFailure::Mismatch) };
                let Some(&(h, t)) = heap.get(idx) else { return Err(DecodeFailure::Mismatch) };
                cells.push((w, decode_word_ty_at(h, heap, elem, depth + 1, memo, budget)?));
                w = t;
            };

            let mut out = base;
            for (ptr, h) in cells.into_iter().rev() {
                spend(budget)?; // each Cons node
                out = Value::Cons(Rc::new(h), Rc::new(out));
                // SUFFIX MEMOIZATION. `out` at this point is exactly the value of the list starting
                // at `ptr`, so recording it here — rather than recording only the finished list once
                // the loop ends — is what makes an aliased suffix a hit. `tails`'s m elements ARE the
                // m suffixes of one spine, so the first element's decode answers all the others.
                memo.insert((ptr, depth), out.clone());
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

    /// A flat `List<Nat>` over L cells spends exactly `3L + 1`: L spine steps, L `Nat` leaves, one `Nil`,
    /// L `Cons` nodes. Asserted as an EQUATION at more than one L, so a constant offset cannot pass it.
    ///
    /// This is the derivation `MAX_DECODE_NODES`'s doc states, and it is checked here rather than in
    /// `tests/` because the budget is a parameter of `decode_word_ty` and readable only from inside.
    #[test]
    fn a_flat_list_spends_exactly_three_per_cell_plus_one() {
        for l in [1_u64, 2, 7, 50] {
            // cons(1, cons(2, ... nil)): cell i is (i+1, i+2), last tail nil. Pointer 1 is the head.
            let heap: Vec<(u64, u64)> = (1..=l).map(|i| (i, if i == l { 0 } else { i + 1 })).collect();
            let ty = Ty::List(Box::new(Ty::Nat));
            let start = 1_000_usize;
            let mut budget = start;
            decode_word_ty(1, &heap, &ty, &mut budget).expect("flat list decodes");
            let spent = start - budget;
            assert_eq!(spent as u64, 3 * l + 1, "L={l}");
        }
    }

    /// §6's invariant, which is what keeps the memo from outgrowing the budget: every memo entry is paid
    /// for by exactly one budget unit. Checked on the sharing fixture, where hits actually happen.
    #[test]
    fn every_memo_entry_is_paid_for_by_one_budget_unit() {
        // tails([1..m]) at a small m: inner cell i = (i, i+1); outer cell m+j = (j, next).
        let m = 6_u64;
        let mut heap: Vec<(u64, u64)> = (1..=m).map(|i| (i, if i == m { 0 } else { i + 1 })).collect();
        for j in 1..=m {
            heap.push((j, if j == m { 0 } else { m + j + 1 }));
        }
        let ty = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
        let start = 100_000_usize;
        let mut budget = start;
        let mut memo = TyMemo::new();
        decode_word_ty_at(m + 1, &heap, &ty, 0, &mut memo, &mut budget).expect("tails decodes");
        let spent = start - budget;
        // Every insert accompanies exactly one `spend` in the cons-up loop, and nothing else inserts, so
        // entries can never exceed units spent. (A second assertion here used to claim linear-vs-quadratic
        // too, `spent < 10 * (2 * m)`, but it never bit: decoding each of this fixture's `m` inner lists
        // with NO memo at all — 3 * (m - j + 1) + 1 summed over j, plus the outer spine's 2m + 1 — spends
        // exactly 82 against that 120 threshold at `m = 6`, since `m` is too small for the O(m^2) a
        // no-memo run would actually cost to cross it. The linear-vs-quadratic claim belongs to
        // `convergent_chains_walk_the_shared_tail_once` and its increasing-order case instead, which use
        // thresholds a quadratic run actually exceeds.)
        assert!(memo.len() <= spent, "memo {} entries against {spent} units spent", memo.len());
    }

    /// CONVERGENT CHAINS — the case suffix memoization alone does not fix, and the reason PASS 1 needs a
    /// memo exit of its own.
    ///
    /// `k` distinct spines of length `p`, each ending by pointing into ONE shared tail of length `s`. The
    /// answer is right with or without the exit; only the work differs, so this asserts on units spent.
    /// Without the exit each spine re-walks the whole shared tail: `k * (p + s)`. With it, the tail is
    /// walked once: `k * p + s`, plus nodes.
    ///
    /// A second, unrelated shape shares this test because both are what forced the mid-spine exit: an
    /// outer list whose heads are pointers `1, 2, ..., n` in INCREASING order, over cells `i = (i - 1,
    /// i - 1)` — the counterexample Task 3's review used to show the un-qualified size bound was false
    /// (see `a_nested_type_over_a_shared_spine_decodes_instead_of_refusing`'s doc for the FAVOURABLE
    /// order this one inverts). Head `j` misses `(j, depth)` — only shorter suffixes were recorded
    /// before it runs — so without this exit PASS 2 re-decodes `j` heads per outer step: `Sigma(2j+1) ~=
    /// n^2` spends on a `2n`-cell heap. With it, head `j` stops the instant it reaches `(j-1, depth)`, so
    /// every cell is walked once across the whole decode.
    #[test]
    fn convergent_chains_walk_the_shared_tail_once() {
        let (k, p, s) = (20_u64, 3_u64, 200_u64);
        // Cells 1..=s are the shared tail: cell i = (i, i+1), last tail nil.
        let mut heap: Vec<(u64, u64)> = (1..=s).map(|i| (i, if i == s { 0 } else { i + 1 })).collect();
        // Then k prefixes of length p, each running into pointer 1 (the shared tail's head).
        let mut starts = Vec::new();
        for c in 0..k {
            let base = s + c * p;
            starts.push(base + 1);
            for q in 0..p {
                let tail = if q == p - 1 { 1 } else { base + q + 2 };
                heap.push((7, tail)); // head value is arbitrary; `Ty::Nat` accepts any word
            }
        }
        // An outer list whose j-th head is the pointer to the j-th prefix.
        let outer_base = heap.len() as u64;
        for (j, st) in starts.iter().enumerate() {
            let j = j as u64;
            let tail = if j == k - 1 { 0 } else { outer_base + j + 2 };
            heap.push((*st, tail));
        }
        let ty = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
        let start = 10_000_000_usize;
        let mut budget = start;
        decode_word_ty(outer_base + 1, &heap, &ty, &mut budget).expect("convergent chains decode");
        let spent = start - budget;
        // Without the PASS 1 exit this is >= k * s = 4,000 steps of re-walking alone. With it, the shared
        // tail is walked once, so total work is linear in the heap: 3 * (s + k * p + k) + change.
        let cells = s + k * p + k;
        assert!(spent < 4 * cells as usize, "spent {spent} for {cells} cells — the shared tail is being re-walked");

        // INCREASING-ORDER SPINE — see this test's doc for the shape. `n` inner cells at pointers
        // `1..=n` (cell i = (i - 1, i - 1)), plus a SEPARATE outer spine of `n` more cells whose j-th
        // head is pointer `j`, walked in increasing `j` order.
        let n = 200_u64;
        let mut heap2: Vec<(u64, u64)> = (1..=n).map(|i| (i - 1, i - 1)).collect();
        for j in 1..=n {
            heap2.push((j, if j == n { 0 } else { n + j + 1 }));
        }
        let ty2 = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
        let start2 = 1_000_000_usize;
        let mut budget2 = start2;
        decode_word_ty(n + 1, &heap2, &ty2, &mut budget2).expect("increasing-order spine decodes");
        let spent2 = start2 - budget2;
        // Without the exit this is ~Sigma(2j+1) = n^2 + 2n, quadratic in a 2n-cell heap. With it, every
        // cell is walked once, so total work is linear.
        let cells2 = 2 * n;
        assert!(
            spent2 < 4 * cells2 as usize,
            "spent {spent2} for {cells2} cells — increasing-order heads are being re-walked"
        );
    }

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

    /// The spine loop bounds CYCLES — one step per heap cell. It does not bound the number of DISTINCT
    /// nodes a decode with no sharing must construct. For a `List<List<Nat>>` where every inner list is
    /// its own unshared cells, each of up to n spine steps decodes an inner list that walks up to n
    /// cells: O(n^2) nodes, and `MAX_TY_DEPTH` nesting makes it O(n^d).
    ///
    /// **This heap is not that case, and that is the point.** Every cell here doubles as the next OUTER
    /// spine pointer AND the root of an INNER list — the identical "one big shared spine" shape `tails`
    /// exhibits (see `tests/sharing_aware_decode.rs`), just self-referential instead of split across two
    /// halves. Before `TyMemo`, decoding inner list `q` re-walked cells `q, q-1, ..., 1` from scratch on
    /// every outer step, for the O(n^2) total the first paragraph derives — this test used to pin
    /// exactly that, asserting `None` at n = 6000 (`6000^2 + 6000 + 1` = 36,006,001 nodes, ~1.8x
    /// `MAX_DECODE_NODES`). After `TyMemo`, the outer spine's first step decodes inner list `n - 1` in
    /// full and records every one of its suffixes at depth 1 (§4.1 of the design doc), so every later
    /// outer step's inner decode is a memo hit. The heap and the answer are unchanged; only the work to
    /// reach it dropped from ~36,006,001 nodes to a few thousand. Refusing this decode would now be the
    /// WRONG answer — `MAX_DECODE_NODES` measures DISTINCT nodes, and this decode produces far fewer
    /// than n^2 of them — so the assertion below is on the correct VALUE, not on refusal.
    ///
    /// **That DISTINCT-nodes claim holds in general, not only for this test's own spine order.** This
    /// outer spine walks pointers `n → 1`, so it reaches every inner list at its LONGEST suffix first —
    /// the same favorable order `tails`-shaped input has, and on its own that order is enough for the
    /// collapse above. A spine reached from a SHORTER suffix first (heads arriving in INCREASING order)
    /// used to be the counterexample: PASS 1 and PASS 2 only checked the memo at the very top of the arm,
    /// never mid-spine, so a later, longer head would re-walk and re-charge a suffix already recorded.
    /// Both passes now stop the instant they reach a pointer already in the memo, not only at nil, so the
    /// same collapse holds for that order too — see `convergent_chains_walk_the_shared_tail_once`'s
    /// second case, which walks this identical heap shape in increasing order and pins the same
    /// distinct-node bound.
    #[test]
    fn a_nested_type_over_a_shared_spine_decodes_instead_of_refusing() {
        use crate::ty::Ty;
        // Every cell points at the previous one, so the SAME n cells serve as both the outer spine and
        // every inner list's suffixes — see this test's doc.
        let n = 6000u64;
        let heap: Vec<(u64, u64)> = (1..=n).map(|i| (i - 1, i - 1)).collect();
        let o = AsmOutcome { result: n, heap };
        let nested = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));

        // Independently-built expected value. Inner list `q` (the decode of pointer `q`) is
        // `[q-1, q-2, ..., 0]`, `q` elements long; the outer spine's `p`-th cell (p = n downto 1) heads
        // with inner list `p - 1`. Each inner list is built once and shared via `Rc`, the same suffix
        // sharing `tests/sharing_aware_decode.rs::tails_value` relies on.
        let mut inner_by_q: Vec<Rc<Value>> = vec![Rc::new(Value::Nil)]; // inner_by_q[0] = []
        for q in 1..n {
            let prev = Rc::clone(&inner_by_q[(q - 1) as usize]);
            inner_by_q.push(Rc::new(Value::Cons(Rc::new(Value::Nat(q - 1)), prev)));
        }
        let mut want = Value::Nil;
        for q in 0..n {
            want = Value::Cons(Rc::clone(&inner_by_q[q as usize]), Rc::new(want));
        }

        let got = decode_asm_ty(&o, &nested);
        assert!(
            got == Some(want),
            "the (pointer, depth) memo must decode this shared spine, not refuse it; mismatch omitted \
             here because at n={n} the two structures would Debug-format to on the order of n^2 \
             (~36,000,000) nodes"
        );
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
    /// costs `3L + 1` units (L spine steps + L `Cons` + L `Nat` leaves + 1 `Nil`), so it must decode iff
    /// `3L + 1 <= MAX_DECODE_NODES`. `L` is chosen at that boundary — `(MAX_DECODE_NODES - 1) / 3` is
    /// the largest `L` for which `3L + 1` still fits, so it must decode; `L + 1` pushes `3L + 1` one
    /// past the budget, so it must not. Neither an over-count nor an under-count of what a step or node
    /// costs (e.g. charging only for `Cons`, not for `Nat` leaves or spine steps) could pass both
    /// assertions at once — unlike the nested-heap test above, which a same-order miscount could still
    /// slip past.
    ///
    /// Ignored by default: allocates ~`L` (~6,666,666) heap cells and ~`MAX_DECODE_NODES` (~20,000,000)
    /// `Value`s — three `Value`s per cell, per the `3L + 1` accounting above — which is slow under a
    /// debug build. Run explicitly, or via the slow tier (`scripts/check-slow.sh`).
    #[test]
    #[ignore = "slow tier: allocates ~MAX_DECODE_NODES values"]
    fn the_node_budget_boundary_is_exact() {
        use crate::ty::Ty;
        let l_ok = (MAX_DECODE_NODES as u64 - 1) / 3;
        let cost_ok = 3 * l_ok + 1;
        let cost_over = 3 * (l_ok + 1) + 1;
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
            "a {l_over}-element list costs one unit over budget and must not decode"
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
    /// `spend` anywhere in the call can even run, at any nesting depth — `cells` grows lazily and
    /// nothing buffers the spine's WORDS ahead of decoding them. `budget = 0` makes that first `spend`
    /// fail immediately, so whatever the allocator saw during the call is exactly what was committed
    /// before the budget could act.
    ///
    /// The heap is a single `l`-cell acyclic spine where EVERY cell's head word repoints at the spine's
    /// own start — "one big shared spine", so decoding any head at any nesting level re-walks the SAME
    /// `l` cells. `ty` nests that spine 4 levels deep (`List<List<List<List<Nat>>>>`). An earlier
    /// version of this arm (in what is now `decode_word_ty_at`) collected the spine's head WORDS into a
    /// `Vec<u64>` before decoding any of them — a paragraph PASS 1's own comment used to carry, removed
    /// when that comment was shortened — one such `Vec`, sized to the FULL spine, PER nesting level, all
    /// before `budget = 0` ever gets to refuse anything: roughly
    /// `4 * l * 8` bytes for `l = 20,000`, around 640KB, decisively over the bound below. The current
    /// arm allocates zero regardless of `l` or nesting depth.
    ///
    /// The bound is `assert_eq!(.., 0)`, not a generous margin, because the counter is now exact (see
    /// `CountingAlloc`'s doc): a `thread_local!` counter cannot see a concurrent test's allocation, so
    /// there is no foreign noise left to leave headroom FOR. What remains is only whether THIS call
    /// allocates, and tracing it settles that exactly — PASS 1 counts without allocating, PASS 2's
    /// `cells` is `Vec::new()` (no allocation until a first successful push), and at `budget = 0` the
    /// first `spend` anywhere in the call — reached by recursing to the innermost `Ty::Nat`, before
    /// `cells.push` on any level ever returns — fails via `?` before any `Vec` grows or any `Cons`
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
    /// `List<Nat>` (one element over the `3L + 1` boundary `the_node_budget_boundary_is_exact` derives,
    /// on its own) and a cyclic `List<Nat>` (a single self-referencing cell), assembled into a
    /// two-element `List<List<Nat>>` both ways: the two orderings differ ONLY in which element is
    /// decoded first, and that alone flips the reported `DecodeFailure`.
    ///
    /// Ignored by default: same scale as `the_node_budget_boundary_is_exact` above, for the same
    /// reason — the expensive sibling alone needs ~6,666,667 heap cells to exceed the budget.
    #[test]
    #[ignore = "slow tier: allocates ~6,666,667 heap cells"]
    fn a_cyclic_sibling_wins_only_against_its_own_spines_cost() {
        use crate::ty::Ty;
        // The `3L + 1` boundary `the_node_budget_boundary_is_exact` derives: `l_ok` is the largest `L`
        // for which `3L + 1` still fits `MAX_DECODE_NODES`, so `l_ok + 1` is one element past it —
        // "one element over budget, alone" for the expensive sibling below. (A stale `(MAX_DECODE_NODES
        // - 1) / 2 + 1` used to stand here: the pre-branch `2L + 1` boundary, millions of elements
        // short of the true one under this branch's `3L + 1` accounting.)
        let l_ok = (MAX_DECODE_NODES as u64 - 1) / 3;
        let l_over = l_ok + 1;

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
