//! The CLIF listing a view shows: each line Cranelift's writer prints for the run's functions as a row,
//! with an instruction's srcloc, which Cranelift prints in hex, moved to a pc column in the rxm view's
//! decimal form, so that a CLIF row and the rxm instruction it was lowered from show one number.

use std::cell::Cell;
use std::fmt::{self, Write};
use std::iter;

use cranelift_codegen::entity::SecondaryMap;
use cranelift_codegen::ir::entities::AnyEntity;
use cranelift_codegen::ir::{Block, Function, Inst, Value};
use cranelift_codegen::write::{FuncWriter, PlainWriter, decorate_function};

use crate::state::ClifAt;
use crate::stepper::pc_of;

/// What a listing row shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
pub enum ClifRowKind {
    /// `function u0:12(i64, i64) -> i64 system_v {`.
    Function,
    /// A declaration before the first block, `sig0 = (i64) -> i64 system_v` or `fn0 = u0:0 sig0`.
    Decl,
    /// The empty line before a block.
    Blank,
    /// A block header, `block3(v18: i64, v48: i64):`.
    Block,
    /// An instruction, `v4 = iconst.i64 5`.
    Inst,
    /// `v5 -> v4`: an alias, after the instruction or block header that defines the value it names.
    Alias,
    /// The function's closing `}`.
    Close,
}

/// One line of the listing.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ClifRow {
    pub kind: ClifRowKind,
    /// The columns before `text`, a srcloc's counted as spaces.
    pub indent: u8,
    /// An `Inst` row's srcloc, the rxm pc its instruction was lowered from. `None` for an instruction
    /// lowered from none, and on every other row.
    pub pc: Option<u32>,
    /// The instruction an `Inst` row shows; `None` on every other row.
    pub at: Option<ClifAt>,
    /// The line as Cranelift prints it, without its leading columns and its newline.
    pub text: String,
}

/// One function of the listing.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ClifFunction {
    /// Its name as Cranelift prints it, `u0:12`.
    pub name: String,
    /// The rxm subroutine it was built from, as `partition` names it: `$main`, `fact.0`.
    pub label: String,
    /// The index of its `Function` row in `ClifListing::rows`.
    pub first_row: usize,
}

/// The rows of a run's functions, each function's rows starting where the one before ended.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ClifListing {
    pub functions: Vec<ClifFunction>,
    pub rows: Vec<ClifRow>,
}

/// `funcs`' rows, each function's lines as `func.display()` prints them, with `names` labelling the
/// functions in order: `partition`'s names, whose order `build_listing` builds them in. A function past
/// the last name is labelled empty.
#[must_use]
pub fn listing(funcs: &[Function], names: &[String]) -> ClifListing {
    let mut listing = ClifListing { functions: Vec::new(), rows: Vec::new() };
    let labels = names.iter().cloned().chain(iter::repeat_with(String::new));
    for ((func, label), function) in funcs.iter().zip(labels).zip(0..) {
        listing.functions.push(ClifFunction { name: func.name.to_string(), label, first_row: listing.rows.len() });
        push_rows(&mut listing.rows, func, function);
    }
    listing
}

/// Appends the rows of `func`, the run's function `function`.
fn push_rows(rows: &mut Vec<ClifRow>, func: &Function, function: u32) {
    let len = Cell::new(0);
    let mut sink = Sink { text: String::new(), len: &len };
    let mut marks = Marks { len: &len, spans: Vec::new() };
    // A `Sink` takes every write, so the writer cannot fail.
    let _ = decorate_function(&mut marks, &mut sink, func);
    let text = sink.text;
    let mut spans = marks.spans.into_iter().peekable();
    let mut end = 0;
    for line in text.split_inclusive('\n') {
        let start = end;
        end += line.len();
        let line = line.strip_suffix('\n').unwrap_or(line);
        while spans.next_if(|span| span.end <= start).is_some() {}
        let by = spans.peek().filter(|span| span.start <= start).map(|span| (span.by, span.start == start));
        rows.push(match by {
            Some((Method::Inst(inst), true)) => inst_row(func, function, inst, line),
            Some((Method::Block, _)) => row(ClifRowKind::Block, line),
            Some((Method::Decl, _)) => row(ClifRowKind::Decl, line),
            // `decorate_function` itself writes the function line first and the brace last, and between
            // them only blank lines and each block parameter's aliases.
            None if start == 0 => row(ClifRowKind::Function, line),
            None if end == text.len() => row(ClifRowKind::Close, line),
            None if line.is_empty() => row(ClifRowKind::Blank, line),
            // `PlainWriter` writes an instruction's result aliases on the lines after it.
            Some((Method::Inst(_), false)) | None => row(ClifRowKind::Alias, line),
        });
    }
}

/// `line` as a row of `kind` that shows no instruction.
fn row(kind: ClifRowKind, line: &str) -> ClifRow {
    let (indent, text) = columns(line, "");
    ClifRow { kind, indent, pc: None, at: None, text: text.to_string() }
}

/// `line`, which `PlainWriter` wrote first for `inst`, as its row.
fn inst_row(func: &Function, function: u32, inst: Inst, line: &str) -> ClifRow {
    let pc = pc_of(func, inst);
    // `PlainWriter` prints a srcloc and a space in the indent's first columns.
    let srcloc = if pc.is_some() { format!("{} ", func.srcloc(inst)) } else { String::new() };
    let (indent, text) = columns(line, &srcloc);
    ClifRow {
        kind: ClifRowKind::Inst,
        indent,
        pc,
        at: Some(ClifAt { function, inst: inst.as_u32() }),
        text: text.to_string(),
    }
}

/// `line`'s leading columns, `lead` where the line starts with it and then spaces, and the text after
/// them. At most `u8::MAX` columns are counted, and any further ones stay in the text, so that none is
/// lost.
fn columns<'a>(line: &'a str, lead: &str) -> (u8, &'a str) {
    let lead = if line.starts_with(lead) { lead.len() } else { 0 };
    let columns = lead + line.bytes().skip(lead).take_while(|&byte| byte == b' ').count();
    let indent = u8::try_from(columns).unwrap_or(u8::MAX);
    (indent, line.get(usize::from(indent)..).unwrap_or_default())
}

/// The text `decorate_function` writes, with its length kept in a `Cell` that `Marks` reads, so that
/// the lines a `FuncWriter` method wrote can be told from those `decorate_function` wrote itself.
struct Sink<'a> {
    text: String,
    len: &'a Cell<usize>,
}

impl Write for Sink<'_> {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.text.push_str(s);
        self.len.set(self.text.len());
        Ok(())
    }
}

/// The `FuncWriter` method that wrote a span of the text.
#[derive(Clone, Copy)]
enum Method {
    Decl,
    Block,
    Inst(Inst),
}

/// The bytes `start..end` of the text, written by one `FuncWriter` call.
struct Span {
    start: usize,
    end: usize,
    by: Method,
}

/// A `FuncWriter` that writes as `PlainWriter` does and notes the span each of its calls wrote.
struct Marks<'a> {
    /// The `Sink`'s length.
    len: &'a Cell<usize>,
    spans: Vec<Span>,
}

impl Marks<'_> {
    /// Runs `write`, noting the span it wrote as `by`'s.
    fn mark(&mut self, by: Method, write: impl FnOnce() -> fmt::Result) -> fmt::Result {
        let start = self.len.get();
        write()?;
        self.spans.push(Span { start, end: self.len.get(), by });
        Ok(())
    }
}

impl FuncWriter for Marks<'_> {
    fn write_block_header(&mut self, w: &mut dyn Write, func: &Function, block: Block, indent: usize) -> fmt::Result {
        self.mark(Method::Block, || PlainWriter.write_block_header(w, func, block, indent))
    }

    fn write_instruction(
        &mut self,
        w: &mut dyn Write,
        func: &Function,
        aliases: &SecondaryMap<Value, Vec<Value>>,
        inst: Inst,
        indent: usize,
    ) -> fmt::Result {
        self.mark(Method::Inst(inst), || PlainWriter.write_instruction(w, func, aliases, inst, indent))
    }

    fn write_entity_definition(
        &mut self,
        w: &mut dyn Write,
        func: &Function,
        entity: AnyEntity,
        value: &dyn fmt::Display,
    ) -> fmt::Result {
        self.mark(Method::Decl, || PlainWriter.write_entity_definition(w, func, entity, value))
    }
}
