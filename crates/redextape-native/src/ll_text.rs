//! Our own LLVM IR text writer: the lowering walk's third sink, which prints the module `llvm.rs` builds
//! through inkwell as LLVM itself prints it, for a page that has no LLVM to ask. It builds for wasm32 under
//! the `ll` feature, with neither inkwell nor Cranelift.
//!
//! Nothing compiles this text: the compiler builds its IR with inkwell's builder, and this writer exists only
//! so the browser can show that IR. Two checks keep the two from parting. A native test holds the text to
//! the `.ll` snapshots, LLVM's own print of inkwell's module as built; and with both `llvm` and `ll` a test
//! requires the text to be LLVM's print of inkwell's module, comments included, for programs no snapshot
//! holds too, and has LLVM parse it back into a module that prints the same.
//!
//! The text is the module as built, before any pass, at `O0`-`O3`, which build the same module; `Os` and
//! `Oz` differ only by their function attributes. It is for x86-64 Linux with the generic CPU, the machine
//! the snapshots are printed for, since the module names its target.
//!
//! What the writer copies from LLVM, each of which a snapshot comparison catches if it moves:
//!
//! * **Names.** A name already taken in its symbol table (one per function for blocks and values, one per
//!   module for functions) gets the table's next number, as LLVM's `ValueSymbolTable::makeUniqueName` does:
//!   `%cons`, `%cons1`, `%guard2`, `cont4`, with a `.` before the number for a function. So names are taken
//!   in the order inkwell creates them.
//! * **Order.** Blocks print in creation order: `prologue`, one `i<pc>` per body instruction, `exit`, then
//!   each guard's `cont` block in the order the walk made them.
//! * **Predecessors.** A block's `; preds =` comment lists the branches to it newest first, LLVM's use-list
//!   order.
//! * **The intrinsics' attributes**, which LLVM attaches to an intrinsic's declaration by itself, as the
//!   pinned release spells them.

use std::collections::HashSet;
use std::fmt::Write;

use redextape_core::core::{BinOp, NodeId};
use redextape_core::tm::{LowerError, Program, Reg, reg_str};

use crate::analysis::{Subroutine, partition};
use crate::lower::{Banks, BodyPos, LowerFault, LowerSink, lower_subroutine};
use crate::rt_imports::RtFn;
use crate::shared::{MAX_REGISTERS, param_count, reg_over_cap};

/// The data layout LLVM gives x86-64 Linux, which `llvm.rs` sets from its target machine before it builds
/// anything; it decides the `align 8` on every slot.
const DATA_LAYOUT: &str = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128";
const TRIPLE: &str = "x86_64-unknown-linux-gnu";
/// The attributes LLVM attaches to the three arithmetic intrinsics, all the same set, in the pinned
/// release's spelling (`snapshots/llvm-version.txt`).
const INTRINSIC_ATTRS: &str =
    "nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)";
/// The column LLVM pads a block's label to before its `; preds` comment.
const PREDS_COLUMN: usize = 50;

/// One line of the module's text, with the rxm instruction it belongs to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LlLine {
    pub text: String,
    /// The code index (pc) of the instruction whose lowering wrote the line: its `i<pc>` label, what the
    /// walk emitted for it and the `cont` blocks its guards made. `None` for every other line: the header lines,
    /// the declarations and each intrinsic's `; Function Attrs` comment, a function's `define` line, its
    /// `prologue` and `exit` blocks and closing `}`, the `attributes` line, and the blank lines.
    pub pc: Option<usize>,
}

/// One defined function of the module.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LlFunction {
    /// Its name as the text prints it, after `@`: `"$main"`, `fact.0`.
    pub name: String,
    /// The rxm subroutine it was built from, as `partition` names it.
    pub label: String,
    /// The index of its `define` line in `LlModule::lines`.
    pub first_line: usize,
}

/// `prog`'s LLVM module as built, as lines.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LlModule {
    pub lines: Vec<LlLine>,
    pub functions: Vec<LlFunction>,
}

impl LlModule {
    /// The whole text, each line ended by a newline, as LLVM prints a module.
    #[must_use]
    pub fn text(&self) -> String {
        let mut out = String::new();
        for line in &self.lines {
            out.push_str(&line.text);
            out.push('\n');
        }
        out
    }
}

/// `prog`'s LLVM module as `llvm::build_module` builds it for x86-64 Linux at `O0`-`O3`, as LLVM prints it.
///
/// # Errors
/// `LowerError::Unsupported` when `partition` rejects `prog`, when a register index reaches
/// `MAX_REGISTERS`, or when the walk cannot lower a subroutine, which the native backends refuse too; and
/// when a subroutine's name takes LLVM's `llvm.` prefix or is empty up to a NUL, which the LLVM backend
/// refuses or names apart and the Cranelift backends do not.
pub fn llvm_text(prog: &Program) -> Result<LlModule, LowerError> {
    if reg_over_cap(prog) {
        return Err(unsupported(format!("register index exceeds MAX_REGISTERS ({MAX_REGISTERS})")));
    }
    let subs = partition(prog)?;
    let mut globals = SymbolTable::default();
    // `declare_rt`, then `declare_sat`, then `declare_subroutines`: the order `build_module` adds them in,
    // which decides who keeps a contested name.
    for f in RtFn::ALL {
        globals.take(f.symbol(), true);
    }
    for intrinsic in Intrinsic::ALL {
        globals.take(intrinsic.name(), true);
    }
    // inkwell hands LLVM a name up to its first NUL, so that is the name LLVM uniques and prints. An empty
    // one, which `parse_rxm` reads from a label that starts with a NUL, leaves the function unnamed and
    // numbered, which this writer does not follow.
    let mut names = Vec::with_capacity(subs.len());
    for sub in &subs {
        let name = sub.name.split('\0').next().unwrap_or_default();
        if name.is_empty() {
            return Err(unsupported(format!("a subroutine named {:?} has no name before its NUL", sub.name)));
        }
        names.push(globals.take(name, true));
    }
    // LLVM reserves the prefix for its intrinsics and refuses a body for any function that has it, so
    // `llvm.rs`'s module fails to verify and the backend refuses the program; this text would be a module
    // LLVM rejects.
    if let Some(name) = names.iter().find(|name| name.starts_with("llvm.")) {
        return Err(unsupported(format!("a subroutine named `{name}` takes LLVM's intrinsic prefix `llvm.`")));
    }

    let mut out = Out::default();
    out.plain("; ModuleID = 'redextape'");
    out.plain("source_filename = \"redextape\"");
    out.plain(&format!("target datalayout = \"{DATA_LAYOUT}\""));
    out.plain(&format!("target triple = \"{TRIPLE}\""));
    for f in RtFn::ALL {
        let ret = if f.returns_word() { "i64" } else { "void" };
        let params = std::iter::once("ptr").chain(std::iter::repeat_n("i64", f.word_params())).collect::<Vec<_>>();
        out.plain("");
        out.plain(&format!("declare {ret} @{}({})", quoted(f.symbol()), params.join(", ")));
    }
    for intrinsic in Intrinsic::ALL {
        out.plain("");
        out.plain(&format!("; Function Attrs: {INTRINSIC_ATTRS}"));
        out.plain(&format!("declare {} @{}(i64, i64) #0", intrinsic.ret(), intrinsic.name()));
    }

    let arity = |entry: usize| subs.iter().find(|s| s.entry == entry).map(param_count);
    let callee = |entry: usize| subs.iter().position(|s| s.entry == entry).map(|k| names[k].clone());
    let mut functions = Vec::with_capacity(subs.len());
    for (sub, name) in subs.iter().zip(&names) {
        out.plain("");
        functions.push(LlFunction { name: quoted(name), label: sub.name.clone(), first_line: out.lines.len() });
        write_function(&mut out, prog, sub, name, &arity, &callee)?;
    }
    out.plain("");
    out.plain(&format!("attributes #0 = {{ {INTRINSIC_ATTRS} }}"));
    Ok(LlModule { lines: out.lines, functions })
}

/// The arithmetic intrinsics `llvm.rs` declares at `i64`, in its order.
#[derive(Clone, Copy)]
enum Intrinsic {
    UaddSat,
    UsubSat,
    UmulOverflow,
}

impl Intrinsic {
    const ALL: [Intrinsic; 3] = [Intrinsic::UaddSat, Intrinsic::UsubSat, Intrinsic::UmulOverflow];

    fn name(self) -> &'static str {
        match self {
            Intrinsic::UaddSat => "llvm.uadd.sat.i64",
            Intrinsic::UsubSat => "llvm.usub.sat.i64",
            Intrinsic::UmulOverflow => "llvm.umul.with.overflow.i64",
        }
    }

    fn ret(self) -> &'static str {
        match self {
            Intrinsic::UaddSat | Intrinsic::UsubSat => "i64",
            Intrinsic::UmulOverflow => "{ i64, i1 }",
        }
    }
}

/// The lines written so far.
#[derive(Default)]
struct Out {
    lines: Vec<LlLine>,
}

impl Out {
    fn plain(&mut self, text: &str) {
        self.lines.push(LlLine { text: text.to_string(), pc: None });
    }
}

/// One LLVM symbol table: the names taken in it and its counter for the next unique number, which every
/// clash in the table advances, whichever name clashed.
#[derive(Default)]
struct SymbolTable {
    taken: HashSet<String>,
    last_unique: u32,
}

impl SymbolTable {
    /// The name `base` gets, as LLVM gives it: `base` when it is free, else `base` and the counter's next
    /// value that makes it free, joined by a `.` for a `global`.
    fn take(&mut self, base: &str, global: bool) -> String {
        if self.taken.insert(base.to_string()) {
            return base.to_string();
        }
        loop {
            self.last_unique += 1;
            let candidate =
                if global { format!("{base}.{}", self.last_unique) } else { format!("{base}{}", self.last_unique) };
            if self.taken.insert(candidate.clone()) {
                return candidate;
            }
        }
    }
}

/// `name` as LLVM writes an identifier: bare when every character is a letter, a digit, `-`, `.` or `_`
/// and the first is not a digit, else in quotes, as `printEscapedString` writes them: `\` doubled, and `"`
/// and every byte outside printable ASCII as `\` and two hex digits.
fn quoted(name: &str) -> String {
    let bare = !name.is_empty()
        && !name.as_bytes()[0].is_ascii_digit()
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_'));
    if bare {
        return name.to_string();
    }
    let mut out = String::from("\"");
    for b in name.bytes() {
        if b == b'\\' {
            out.push_str("\\\\");
        } else if b == b'"' || !(0x20..0x7f).contains(&b) {
            let _ = write!(out, "\\{b:02X}");
        } else {
            out.push(char::from(b));
        }
    }
    out.push('"');
    out
}

fn unsupported(what: String) -> LowerError {
    LowerError::Unsupported { node: NodeId::default(), what }
}

/// A word in the function being written.
#[derive(Clone, Copy)]
enum Val {
    /// The `n`th named value, an index into `FnWriter::values`.
    Named(usize),
    /// A parameter, numbered as LLVM numbers unnamed values: the runtime pointer is `%0`.
    Param(u32),
    Const(u64),
}

/// One block: its name, the lines in it and the blocks that branch to it, oldest branch first.
struct Block {
    name: String,
    pc: Option<usize>,
    body: Vec<String>,
    preds: Vec<usize>,
}

/// The function being written: the `LowerSink` that spells the walk's operations as LLVM's text.
struct FnWriter<'c> {
    /// Where `finish` leaves the blocks, for `write_function` to print.
    done: &'c mut Option<Vec<Block>>,
    names: SymbolTable,
    values: Vec<String>,
    blocks: Vec<Block>,
    /// The block the walk is writing into.
    at: usize,
    /// One block per `body` entry, in `body`'s order, so a `BodyPos` indexes it.
    body_blocks: Vec<usize>,
    exit: usize,
    args: u32,
    locals: u32,
    /// The slot names: `a<i>` per `Arg`, `r<i>` per `Loc`, then `rr`, as named values.
    arg_slots: Vec<usize>,
    loc_slots: Vec<usize>,
    rr: usize,
    callee: &'c dyn Fn(usize) -> Option<String>,
}

impl FnWriter<'_> {
    fn value(&mut self, base: &str) -> usize {
        let name = self.names.take(base, false);
        self.values.push(name);
        self.values.len() - 1
    }

    fn block(&mut self, base: &str, pc: Option<usize>) -> usize {
        let name = self.names.take(base, false);
        self.blocks.push(Block { name, pc, body: Vec::new(), preds: Vec::new() });
        self.blocks.len() - 1
    }

    fn emit(&mut self, line: String) {
        self.blocks[self.at].body.push(line);
    }

    fn operand(&self, v: Val) -> String {
        match v {
            Val::Named(k) => format!("%{}", quoted(&self.values[k])),
            Val::Param(n) => format!("%{n}"),
            // LLVM prints an integer constant signed.
            Val::Const(n) => (n.cast_signed()).to_string(),
        }
    }

    fn label(&self, block: usize) -> String {
        format!("%{}", quoted(&self.blocks[block].name))
    }

    fn slot(&self, r: Reg) -> Option<usize> {
        match r {
            Reg::Loc(n) => self.loc_slots.get(n as usize).copied(),
            Reg::Arg(n) => self.arg_slots.get(n as usize).copied(),
            Reg::Rr => Some(self.rr),
        }
    }

    fn br(&mut self, to: usize) {
        let line = format!("br label {}", self.label(to));
        self.emit(line);
        self.blocks[to].preds.push(self.at);
    }

    /// `br i1 cond, true, false`. The order of the two `preds` pushes cannot show in the text: it matters only
    /// when both targets are one block, whose list then names this block twice either way.
    fn cond_br(&mut self, cond: usize, if_true: usize, if_false: usize) {
        let line = format!(
            "br i1 {}, label {}, label {}",
            self.operand(Val::Named(cond)),
            self.label(if_true),
            self.label(if_false)
        );
        self.emit(line);
        self.blocks[if_false].preds.push(self.at);
        self.blocks[if_true].preds.push(self.at);
    }

    /// The runtime pointer followed by `words`, as a call's argument list.
    fn rt_args(&self, words: &[Val]) -> String {
        std::iter::once("ptr %0".to_string())
            .chain(words.iter().map(|&w| format!("i64 {}", self.operand(w))))
            .collect::<Vec<_>>()
            .join(", ")
    }

    fn call_i64(&mut self, base: &str, callee: &str, args: &str) -> Val {
        let v = self.value(base);
        let line = format!("{} = call i64 @{}({args})", self.operand(Val::Named(v)), quoted(callee));
        self.emit(line);
        Val::Named(v)
    }

    fn cmp(&mut self, pred: &str, x: Val, y: Val) -> Val {
        let bit = self.value("cmp");
        let line = format!("%{} = icmp {pred} i64 {}, {}", quoted(&self.values[bit]), self.operand(x), self.operand(y));
        self.emit(line);
        let word = self.value("cmpw");
        let line = format!("%{} = zext i1 %{} to i64", quoted(&self.values[word]), quoted(&self.values[bit]));
        self.emit(line);
        Val::Named(word)
    }
}

impl LowerSink for FnWriter<'_> {
    type Value = Val;
    type Callee = usize;
    type Error = LowerError;

    fn missing_entry(entry: usize) -> LowerFault {
        LowerFault(format!("no block for index {entry}"))
    }

    fn begin(&mut self, at: BodyPos) -> Result<(), LowerError> {
        self.at = self.body_blocks[at.get()];
        Ok(())
    }

    fn read(&mut self, r: Reg) -> Result<Val, LowerError> {
        let Some(slot) = self.slot(r) else { return Ok(Val::Const(0)) };
        let v = self.value(&format!("{}.v", reg_str(r)));
        let line =
            format!("{} = load i64, ptr {}, align 8", self.operand(Val::Named(v)), self.operand(Val::Named(slot)));
        self.emit(line);
        Ok(Val::Named(v))
    }

    fn write(&mut self, r: Reg, v: Val) -> Result<(), LowerError> {
        if let Some(slot) = self.slot(r) {
            let line = format!("store i64 {}, ptr {}, align 8", self.operand(v), self.operand(Val::Named(slot)));
            self.emit(line);
        }
        Ok(())
    }

    fn constant(&mut self, n: u64) -> Result<Val, LowerError> {
        Ok(Val::Const(n))
    }

    fn bin(&mut self, op: BinOp, x: Val, y: Val) -> Result<Val, LowerError> {
        let args = format!("i64 {}, i64 {}", self.operand(x), self.operand(y));
        Ok(match op {
            BinOp::Add => self.call_i64("sadd", Intrinsic::UaddSat.name(), &args),
            BinOp::Sub => self.call_i64("ssub", Intrinsic::UsubSat.name(), &args),
            BinOp::Mul => {
                let pair = self.value("mulo");
                let line = format!(
                    "%{} = call {} @{}({args})",
                    quoted(&self.values[pair]),
                    Intrinsic::UmulOverflow.ret(),
                    Intrinsic::UmulOverflow.name()
                );
                self.emit(line);
                let field = |w: &mut Self, i: u32, base: &str| {
                    let v = w.value(base);
                    let line = format!(
                        "%{} = extractvalue {} %{}, {i}",
                        quoted(&w.values[v]),
                        Intrinsic::UmulOverflow.ret(),
                        quoted(&w.values[pair])
                    );
                    w.emit(line);
                    v
                };
                let product = field(self, 0, "prod");
                let overflowed = field(self, 1, "ovf");
                let v = self.value("smul");
                let line = format!(
                    "%{} = select i1 %{}, i64 -1, i64 %{}",
                    quoted(&self.values[v]),
                    quoted(&self.values[overflowed]),
                    quoted(&self.values[product])
                );
                self.emit(line);
                Val::Named(v)
            }
            BinOp::Eq => self.cmp("eq", x, y),
            BinOp::Ne => self.cmp("ne", x, y),
            BinOp::Lt => self.cmp("ult", x, y),
            BinOp::Le => self.cmp("ule", x, y),
            BinOp::Gt => self.cmp("ugt", x, y),
            BinOp::Ge => self.cmp("uge", x, y),
        })
    }

    fn call_rt(&mut self, f: RtFn, words: &[Val]) -> Result<Val, LowerError> {
        let args = self.rt_args(words);
        Ok(self.call_i64(f.value_name(), f.symbol(), &args))
    }

    fn call_rt_void(&mut self, f: RtFn, words: &[Val]) -> Result<(), LowerError> {
        let line = format!("call void @{}({})", quoted(f.symbol()), self.rt_args(words));
        self.emit(line);
        Ok(())
    }

    fn guard(&mut self, f: RtFn) -> Result<(), LowerError> {
        let signal = self.call_i64(f.value_name(), f.symbol(), "ptr %0");
        let trip = self.value("trip");
        let line = format!("%{} = icmp ne i64 {}, 0", quoted(&self.values[trip]), self.operand(signal));
        self.emit(line);
        let cont = self.block("cont", self.blocks[self.at].pc);
        let exit = self.exit;
        self.cond_br(trip, exit, cont);
        self.at = cont;
        Ok(())
    }

    fn callee(&self, entry: usize) -> Option<usize> {
        (self.callee)(entry).map(|_| entry)
    }

    fn call_sub(&mut self, callee: usize, args: &[Val]) -> Result<Val, LowerError> {
        let name = (self.callee)(callee).ok_or_else(|| unsupported("call to non-subroutine".into()))?;
        let args = self.rt_args(args);
        Ok(self.call_i64("call", &name, &args))
    }

    fn jump(&mut self, to: BodyPos) -> Result<(), LowerError> {
        let to = self.body_blocks[to.get()];
        self.br(to);
        Ok(())
    }

    fn jump_if_zero(&mut self, cond: Val, target: BodyPos, next: BodyPos) -> Result<(), LowerError> {
        let is_zero = self.value("jz");
        let line = format!("%{} = icmp eq i64 {}, 0", quoted(&self.values[is_zero]), self.operand(cond));
        self.emit(line);
        let (target, next) = (self.body_blocks[target.get()], self.body_blocks[next.get()]);
        self.cond_br(is_zero, target, next);
        Ok(())
    }

    fn ret(&mut self, v: Val) -> Result<(), LowerError> {
        let line = format!("ret i64 {}", self.operand(v));
        self.emit(line);
        Ok(())
    }

    fn finish(self) -> Result<(), LowerError> {
        *self.done = Some(self.blocks);
        Ok(())
    }
}

impl From<LowerFault> for LowerError {
    fn from(f: LowerFault) -> Self {
        unsupported(f.0)
    }
}

/// Write `sub` as the function `name`, as `llvm.rs`'s `LlvmSink` builds it, then print its blocks.
fn write_function(
    out: &mut Out,
    prog: &Program,
    sub: &Subroutine,
    name: &str,
    arity: &dyn Fn(usize) -> Option<u32>,
    callee: &dyn Fn(usize) -> Option<String>,
) -> Result<(), LowerError> {
    let mut done = None;
    lower_subroutine(prog, sub, arity, |banks, body, entry| Ok(prologue(banks, body, entry, callee, &mut done)))?;
    let blocks = done.ok_or_else(|| unsupported(format!("subroutine `{}` was not written", sub.name)))?;
    let pred_name = |k: usize| format!("%{}", quoted(&blocks[k].name));

    let params = std::iter::once("ptr %0".to_string())
        .chain((1..=param_count(sub)).map(|n| format!("i64 %{n}")))
        .collect::<Vec<_>>()
        .join(", ");
    let linkage = if sub.entry == 0 { "" } else { "private " };
    out.plain(&format!("define {linkage}i64 @{}({params}) {{", quoted(name)));
    for (k, block) in blocks.iter().enumerate() {
        if k > 0 {
            out.lines.push(LlLine { text: String::new(), pc: None });
        }
        let mut label = format!("{}:", quoted(&block.name));
        if k > 0 {
            let width = label.chars().count();
            label.push_str(&" ".repeat(PREDS_COLUMN.saturating_sub(width).max(1)));
            if block.preds.is_empty() {
                label.push_str("; No predecessors!");
            } else {
                let preds: Vec<String> = block.preds.iter().rev().map(|&p| pred_name(p)).collect();
                let _ = write!(label, "; preds = {}", preds.join(", "));
            }
        }
        out.lines.push(LlLine { text: label, pc: block.pc });
        for line in &block.body {
            out.lines.push(LlLine { text: format!("  {line}"), pc: block.pc });
        }
    }
    out.plain("}");
    Ok(())
}

/// The `prologue` block: one `alloca` per register, each initialised (the first `params` `Arg`s from the
/// parameters, every other register `0`), then the `exit` block's `ret` and the branch to the entry block.
fn prologue<'c>(
    banks: Banks,
    body: &[usize],
    entry: BodyPos,
    callee: &'c dyn Fn(usize) -> Option<String>,
    done: &'c mut Option<Vec<Block>>,
) -> FnWriter<'c> {
    let mut w = FnWriter {
        done,
        names: SymbolTable::default(),
        values: Vec::new(),
        blocks: Vec::new(),
        at: 0,
        body_blocks: Vec::new(),
        exit: 0,
        args: banks.args,
        locals: banks.locals,
        arg_slots: Vec::new(),
        loc_slots: Vec::new(),
        rr: 0,
        callee,
    };
    // Every parameter is unnamed, so the numbers `%0`, `%1`, ... are theirs and take no name.
    let prologue = w.block("prologue", None);
    w.body_blocks = body.iter().map(|&idx| w.block(&format!("i{idx}"), Some(idx))).collect();
    w.exit = w.block("exit", None);
    w.at = prologue;
    for i in 0..w.args {
        let slot = w.value(&reg_str(Reg::Arg(i)));
        w.emit(format!("%{} = alloca i64, align 8", quoted(&w.values[slot])));
        let init = if i < banks.params { Val::Param(i + 1) } else { Val::Const(0) };
        w.emit(format!("store i64 {}, ptr %{}, align 8", w.operand(init), quoted(&w.values[slot])));
        w.arg_slots.push(slot);
    }
    for i in 0..w.locals {
        let slot = w.value(&reg_str(Reg::Loc(i)));
        w.emit(format!("%{} = alloca i64, align 8", quoted(&w.values[slot])));
        w.emit(format!("store i64 0, ptr %{}, align 8", quoted(&w.values[slot])));
        w.loc_slots.push(slot);
    }
    w.rr = w.value(&reg_str(Reg::Rr));
    w.emit(format!("%{} = alloca i64, align 8", quoted(&w.values[w.rr])));
    w.emit(format!("store i64 0, ptr %{}, align 8", quoted(&w.values[w.rr])));
    // The shared exit block returns a sentinel `0`: it is reached only once a guard has seen the runtime
    // latch a fault or a cap, and the driver reads the outcome from the runtime, not from this word.
    w.at = w.exit;
    w.emit("ret i64 0".to_string());
    w.at = prologue;
    let entry_block = w.body_blocks[entry.get()];
    w.br(entry_block);
    w
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use redextape_core::desugar::desugar;
    use redextape_core::parser::parse;
    use redextape_core::tm::{Instr, Program, Reg, lower_program, parse_rxm, print_rxm};

    use super::*;

    const SNAPSHOTS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/snapshots");
    const BUILT: &str = ";; ==== built: O0 O1 O2 O3 ====\n";

    /// The source a snapshot was made from, read back from its header, which `codegen_snapshots` writes as
    /// `;;   ` before each line and `;;` for a blank one; and its key.
    pub(super) fn source(snapshot: &str) -> String {
        let mut lines = snapshot.lines().skip_while(|l| *l != ";; source:").skip(1);
        let mut out = String::new();
        for line in lines.by_ref().take_while(|l| !l.starts_with(";; ====")) {
            out.push_str(line.strip_prefix(";;   ").unwrap_or(line.strip_prefix(";;").unwrap()));
            out.push('\n');
        }
        out
    }

    pub(super) fn program(key: &str, src: &str) -> Program {
        if key.starts_with("rxm-") {
            let (prog, diagnostics) = parse_rxm(src);
            assert!(diagnostics.is_empty(), "{key}: parse diagnostics {diagnostics:?}");
            return prog.unwrap();
        }
        let (ast, diagnostics) = parse(src);
        assert!(diagnostics.is_empty(), "{key}: parse diagnostics {diagnostics:?}");
        lower_program(&desugar(&ast.unwrap())).unwrap_or_else(|e| panic!("{key}: does not lower: {e:?}"))
    }

    /// The `built: O0 O1 O2 O3` section of a snapshot: LLVM's print of inkwell's module as built.
    fn built(snapshot: &str) -> &str {
        let start = snapshot.find(BUILT).unwrap() + BUILT.len();
        let len = snapshot[start..].find(";; ====").unwrap();
        &snapshot[start..start + len]
    }

    /// Every `<key>.ll` snapshot, as (key, file text).
    pub(super) fn snapshots() -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = std::fs::read_dir(SNAPSHOTS)
            .unwrap()
            .filter_map(|entry| {
                let name = entry.unwrap().file_name().into_string().unwrap();
                let key = name.strip_suffix(".ll").filter(|k| !k.ends_with(".opt"))?.to_string();
                let text = std::fs::read_to_string(Path::new(SNAPSHOTS).join(&name)).unwrap();
                Some((key, text))
            })
            .collect();
        out.sort();
        out
    }

    #[test]
    fn every_snapshot_is_the_writers_text() {
        let all = snapshots();
        assert!(all.len() >= 72, "only {} snapshots: is the snapshots directory where it was?", all.len());
        for (key, snapshot) in all {
            let text = llvm_text(&program(&key, &source(&snapshot))).unwrap().text();
            if let Some(parting) = parting(&text, built(&snapshot)) {
                panic!("{key}: the writer's text parts from the snapshot at {parting}");
            }
        }
    }

    /// Where `text` first differs from `want`, the line's number and both versions of it, so a failure
    /// names the print rule that broke rather than printing two whole modules; `None` when they are equal.
    pub(super) fn parting(text: &str, want: &str) -> Option<String> {
        if text == want {
            return None;
        }
        let line = text
            .lines()
            .zip(want.lines())
            .position(|(a, b)| a != b)
            .unwrap_or_else(|| text.lines().count().min(want.lines().count()));
        Some(format!("line {}:\n  got:  {:?}\n  want: {:?}", line + 1, text.lines().nth(line), want.lines().nth(line)))
    }

    /// `$main` calls the subroutine `name`, which doubles its argument.
    pub(super) fn call(name: &str) -> Program {
        Program {
            code: vec![
                Instr::Li(Reg::Arg(0), 6),
                Instr::Call(name.to_string()),
                Instr::Halt,
                Instr::Bin(BinOp::Add, Reg::Rr, Reg::Arg(0), Reg::Arg(0)),
                Instr::Ret,
            ],
            labels: vec![(name.to_string(), 3)],
        }
    }

    /// Programs for what the snapshots need not hold, so the exact check reaches every arm of the writer
    /// whatever the examples are: names LLVM must rename or quote and one with a `-`, which it leaves bare,
    /// words past `i64::MAX`, every operator, a `jz` whose target is its next instruction, so one branch
    /// names a block twice, every runtime call and guard, and an argument its caller never set, which has no
    /// slot there and passes as `0`.
    pub(super) fn edge_programs() -> Vec<(String, Program)> {
        let mut out: Vec<(String, Program)> = [
            "rt_cons",
            "rt_faulted",
            "$main",
            "main",
            "cont",
            "i0",
            "1st",
            "with space",
            "a-b",
            "quote\"back\\slash",
            "naïve",
            "nul\0cut",
        ]
        .iter()
        .map(|name| (format!("call {name:?}"), call(name)))
        .collect();
        let ops =
            [BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Eq, BinOp::Ne, BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge];
        let mut code = vec![Instr::Li(Reg::Loc(0), u64::MAX), Instr::Li(Reg::Loc(1), 1 << 63)];
        code.extend(ops.iter().map(|&op| Instr::Bin(op, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1))));
        code.extend([Instr::Jz(Reg::Loc(2), "next".to_string()), Instr::Mov(Reg::Rr, Reg::Loc(2)), Instr::Halt]);
        let next = code.len() - 2;
        out.push(("every operator".to_string(), Program { code, labels: vec![("next".to_string(), next)] }));
        out.push((
            "heap and a loop".to_string(),
            Program {
                code: vec![
                    Instr::Li(Reg::Loc(0), 3),
                    Instr::Nil(Reg::Loc(1)),
                    Instr::Cons(Reg::Loc(1), Reg::Loc(0), Reg::Loc(1)),
                    Instr::Box(Reg::Loc(2), Reg::Loc(1)),
                    Instr::BoxSet(Reg::Loc(2), Reg::Loc(0)),
                    Instr::BoxGet(Reg::Loc(3), Reg::Loc(2)),
                    Instr::Head(Reg::Loc(3), Reg::Loc(1)),
                    Instr::Tail(Reg::Loc(1), Reg::Loc(1)),
                    Instr::IsEmpty(Reg::Loc(4), Reg::Loc(1)),
                    Instr::Li(Reg::Loc(5), 1),
                    Instr::Bin(BinOp::Sub, Reg::Loc(0), Reg::Loc(0), Reg::Loc(5)),
                    Instr::Jz(Reg::Loc(0), "done".to_string()),
                    Instr::Jmp("top".to_string()),
                    Instr::Mov(Reg::Rr, Reg::Loc(4)),
                    Instr::Halt,
                ],
                labels: vec![("top".to_string(), 1), ("done".to_string(), 13)],
            },
        ));
        out.push((
            "an argument never set".to_string(),
            Program {
                code: vec![
                    Instr::Call("double".to_string()),
                    Instr::Halt,
                    Instr::Bin(BinOp::Add, Reg::Rr, Reg::Arg(0), Reg::Arg(0)),
                    Instr::Ret,
                ],
                labels: vec![("double".to_string(), 2)],
            },
        ));
        out
    }

    #[test]
    fn edge_programs_quote_and_rename_as_llvm_does() {
        let text = |name: &str| {
            let (_, prog) = edge_programs().into_iter().find(|(k, _)| *k == format!("call {name:?}")).unwrap();
            llvm_text(&prog).unwrap().text()
        };
        assert!(text("rt_cons").contains("define private i64 @rt_cons.1(ptr %0, i64 %1) {"));
        assert!(text("$main").contains("define private i64 @\"$main.1\"(ptr %0, i64 %1) {"));
        assert!(text("1st").contains("@\"1st\"("));
        assert!(text("a-b").contains("define private i64 @a-b(ptr %0, i64 %1) {"), "a `-` leaves a name bare");
        assert!(text("quote\"back\\slash").contains(r#"@"quote\22back\\slash"("#));
        assert!(text("naïve").contains(r#"@"na\C3\AFve"("#));
        assert!(text("nul\0cut").contains("define private i64 @nul(ptr %0, i64 %1) {"));
        let (read, diagnostics) = parse_rxm(&print_rxm(&call("\0cut")));
        assert!(diagnostics.is_empty(), "rxm text reads a label that starts with a NUL: {diagnostics:?}");
        assert!(llvm_text(&read.unwrap()).is_err(), "a name read from rxm text, empty up to its NUL, is refused");
        assert!(llvm_text(&call("\0cut")).is_err(), "a name empty up to its NUL is refused");
        let ops =
            llvm_text(&edge_programs().into_iter().find(|(k, _)| k == "every operator").unwrap().1).unwrap().text();
        assert!(ops.contains("store i64 -1, ptr %r0, align 8"), "u64::MAX prints as LLVM's signed -1");
        assert!(ops.contains("store i64 -9223372036854775808, ptr %r1, align 8"));
        let unset = llvm_text(&edge_programs().into_iter().find(|(k, _)| k == "an argument never set").unwrap().1)
            .unwrap()
            .text();
        assert!(unset.contains("%call = call i64 @double(ptr %0, i64 0)"), "an argument with no slot passes as 0");
    }

    #[test]
    fn lines_carry_the_pc_that_wrote_them() {
        let (_, prog) = edge_programs().into_iter().find(|(k, _)| k == "heap and a loop").unwrap();
        let module = llvm_text(&prog).unwrap();
        let pc_of = |text: &str| module.lines.iter().find(|l| l.text.starts_with(text)).unwrap().pc;
        assert_eq!(pc_of("define i64"), None);
        assert_eq!(pc_of("prologue:"), None);
        assert_eq!(pc_of("exit:"), None);
        assert_eq!(pc_of("i2:"), Some(2));
        assert_eq!(pc_of("  %cons = call i64 @rt_cons"), Some(2));
        // The first guard's `cont` block, at the end of the function, still belongs to the `cons` that made it.
        assert_eq!(pc_of("cont:"), Some(2));
        assert_eq!(module.functions.len(), 1);
        assert_eq!(module.functions[0].name, "\"$main\"");
        assert_eq!(module.lines[module.functions[0].first_line].text, "define i64 @\"$main\"(ptr %0) {");
    }

    #[test]
    fn a_program_partition_refuses_is_refused() {
        let prog = Program { code: vec![Instr::Jmp("nowhere".to_string())], labels: vec![] };
        assert!(llvm_text(&prog).is_err());
        let prog = Program { code: vec![Instr::Li(Reg::Loc(MAX_REGISTERS), 1), Instr::Halt], labels: vec![] };
        assert!(llvm_text(&prog).is_err());
    }

    /// Programs whose subroutine names take LLVM's `llvm.` prefix, one hand-built and one from source,
    /// where `fn llvm` becomes the subroutine `llvm.0`.
    pub(super) fn llvm_prefixed() -> Vec<Program> {
        vec![call("llvm.uadd.sat.i64"), program("fn llvm", "fn llvm(n) { n + 1 }\nllvm(41)\n")]
    }

    #[test]
    fn a_subroutine_with_llvms_prefix_is_refused() {
        for prog in llvm_prefixed() {
            let Err(LowerError::Unsupported { what, .. }) = llvm_text(&prog) else { panic!("{prog:?} was written") };
            assert!(what.contains("intrinsic prefix"), "{what}");
        }
    }

    /// The CI check of the IR views design's §9, piece 4
    /// (`docs/superpowers/specs/2026-10-27-ir-views-groundwork-design.md`): the writer's text must be LLVM's
    /// print of the module inkwell builds, comments included, since the `; preds` order, the quoting and the
    /// signed constants are print rules a module that only means the same would not hold. It runs on programs
    /// no snapshot holds, which the snapshot test cannot reach. LLVM must also parse the text into a module
    /// that verifies and prints as the same text.
    #[cfg(feature = "llvm")]
    mod parsed_by_llvm {
        use inkwell::context::Context;
        use inkwell::memory_buffer::MemoryBuffer;
        use inkwell::targets::{InitializationConfig, Target, TargetTriple};
        use proptest::prelude::*;
        use redextape_test_support::arb_expr_below;

        use super::*;
        use crate::{OptLevel, llvm};

        /// Parse `prog`'s text with LLVM and compare it with inkwell's module, built as the snapshots
        /// build it: x86-64 Linux, the generic CPU, `O0`.
        fn check(what: &str, prog: &Program) {
            static INIT: std::sync::Once = std::sync::Once::new();
            INIT.call_once(|| Target::initialize_x86(&InitializationConfig::default()));
            let machine = llvm::target_machine(&TargetTriple::create(TRIPLE), "x86-64", "", OptLevel::O0).unwrap();
            let ctx = Context::create();
            let subs = partition(prog).unwrap();
            let (built, _) = llvm::build_module(&ctx, &machine, prog, &subs, OptLevel::O0).unwrap();
            let text = llvm_text(prog).unwrap().text();
            let buffer = MemoryBuffer::create_from_memory_range_copy(text.as_bytes(), "redextape");
            let parsed = ctx
                .create_module_from_ir(buffer)
                .unwrap_or_else(|e| panic!("{what}: LLVM does not parse the writer's text: {e}\n{text}"));
            parsed.verify().unwrap_or_else(|e| panic!("{what}: the parsed module does not verify: {e}"));
            let theirs = built.print_to_string().to_string();
            if let Some(parting) = parting(&text, &theirs) {
                panic!("{what}: the writer's text parts from LLVM's print of inkwell's module at {parting}");
            }
            if let Some(parting) = parting(&parsed.print_to_string().to_string(), &theirs) {
                panic!("{what}: LLVM parses the text into a module that prints otherwise, at {parting}");
            }
        }

        #[test]
        fn llvm_parses_every_snapshot_programs_text_into_inkwells_module() {
            for (key, snapshot) in snapshots() {
                check(&key, &program(&key, &source(&snapshot)));
            }
        }

        #[test]
        fn llvm_parses_every_edge_programs_text_into_inkwells_module() {
            for (what, prog) in edge_programs() {
                check(&what, &prog);
            }
        }

        /// The writer refuses these because inkwell's module does not verify; were LLVM ever to accept them,
        /// this fails, and the writer should write them.
        #[test]
        fn inkwell_refuses_a_subroutine_with_llvms_prefix_too() {
            static INIT: std::sync::Once = std::sync::Once::new();
            INIT.call_once(|| Target::initialize_x86(&InitializationConfig::default()));
            let machine = llvm::target_machine(&TargetTriple::create(TRIPLE), "x86-64", "", OptLevel::O0).unwrap();
            for prog in llvm_prefixed() {
                let ctx = Context::create();
                let subs = partition(&prog).unwrap();
                assert!(llvm::build_module(&ctx, &machine, &prog, &subs, OptLevel::O0).is_err(), "{prog:?}");
            }
        }

        proptest! {
            #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

            #[test]
            fn llvm_parses_a_random_programs_text_into_inkwells_module(src in arb_expr_below(1000)) {
                let (ast, diagnostics) = parse(&src);
                prop_assume!(diagnostics.is_empty());
                let Ok(prog) = lower_program(&desugar(&ast.unwrap())) else { return Ok(()) };
                check(&src, &prog);
            }
        }
    }
}
