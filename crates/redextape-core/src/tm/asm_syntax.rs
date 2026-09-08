//! The register-assembly text form's reader. `asm.rs` writes this form; this module reads it back.
//!
//! **The parser dispatches on a table, and the table is checked against the printer.** `instr_parts`
//! decides how an instruction is written; `MNEMONICS` decides how one is read. They are separate
//! because they run in opposite directions — 24 mnemonics fold back into 16 `Instr` variants, since
//! `Instr::Bin` prints as one of nine — and `table_agrees_with_the_printer` is what stops them
//! drifting: it derives each mnemonic's operand shape from the printer's own output and compares.
//!
//! Iterative over a flat line grammar, no recursion, never panics — the shape `parse_tm` established
//! for the TM text form, and for the same reasons.

use crate::core::BinOp;
use crate::nav::{DefKind, NameIndex};
use crate::tm::asm::{AsmHeader, Instr, OperandKind, Program, Reg};
use crate::tm::comments::{self, AnchoredComment, AsmAnchor};
use crate::{Diagnostic, Span};

use super::syntax::trimmed_at;

/// The positional operand kinds of one mnemonic. `RI` is `li rd, #n`; `RL` is `jz r, label`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Shape {
    Nullary,
    R,
    RR,
    #[allow(clippy::upper_case_acronyms)]
    RRR,
    RI,
    RL,
    L,
}

impl Shape {
    /// The operand kinds this shape expects, in order. The parser reads it left to right and the
    /// differential compares it against what the printer emitted.
    fn kinds(self) -> &'static [OperandKind] {
        use OperandKind::{Imm, Label, Reg};
        match self {
            Shape::Nullary => &[],
            Shape::R => &[Reg],
            Shape::RR => &[Reg, Reg],
            Shape::RRR => &[Reg, Reg, Reg],
            Shape::RI => &[Reg, Imm],
            Shape::RL => &[Reg, Label],
            Shape::L => &[Label],
        }
    }
}

/// Every mnemonic the printer can emit, with the operand shape that follows it. 24 entries against
/// 16 `Instr` variants: the nine below marked `Bin` all build `Instr::Bin` with a different `BinOp`.
const MNEMONICS: &[(&str, Shape)] = &[
    ("li", Shape::RI),
    ("mov", Shape::RR),
    ("add", Shape::RRR),   // Bin
    ("sub", Shape::RRR),   // Bin
    ("mul", Shape::RRR),   // Bin
    ("cmpeq", Shape::RRR), // Bin
    ("cmpne", Shape::RRR), // Bin
    ("cmplt", Shape::RRR), // Bin
    ("cmple", Shape::RRR), // Bin
    ("cmpgt", Shape::RRR), // Bin
    ("cmpge", Shape::RRR), // Bin
    ("jz", Shape::RL),
    ("jmp", Shape::L),
    ("call", Shape::L),
    ("ret", Shape::Nullary),
    ("halt", Shape::Nullary),
    ("nil", Shape::R),
    ("cons", Shape::RRR),
    ("head", Shape::RR),
    ("tail", Shape::RR),
    ("isempty", Shape::RR),
    ("box", Shape::RR),
    ("box_get", Shape::RR),
    ("box_set", Shape::RR),
];

/// The shape `mnemonic` takes, or `None` if nothing prints it.
pub(super) fn shape_of(mnemonic: &str) -> Option<Shape> {
    MNEMONICS.iter().find(|(m, _)| *m == mnemonic).map(|(_, s)| *s)
}

/// The inverse of `bin_mnemonic`. `None` for a mnemonic that is not one of the nine.
///
/// Spelled out rather than derived: this is the one fold in the form where a wrong answer is a
/// program that runs and answers incorrectly rather than one that fails to parse, so the nine pairs
/// are written where a reader can check them against `bin_mnemonic` side by side, and
/// `bin_op_for_inverts_bin_mnemonic` proves it for every variant.
pub(super) fn bin_op_for(mnemonic: &str) -> Option<BinOp> {
    Some(match mnemonic {
        "add" => BinOp::Add,
        "sub" => BinOp::Sub,
        "mul" => BinOp::Mul,
        "cmpeq" => BinOp::Eq,
        "cmpne" => BinOp::Ne,
        "cmplt" => BinOp::Lt,
        "cmple" => BinOp::Le,
        "cmpgt" => BinOp::Gt,
        "cmpge" => BinOp::Ge,
        _ => return None,
    })
}

/// An `.asm` file as authored: the program it describes, its optional header, and the comments that
/// belong to neither. `TmDocument`'s shape over asm's line grammar, for the reasons stated there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AsmDocument {
    /// `None` exactly when `diagnostics` is non-empty, matching what the tuple returned.
    pub program: Option<Program>,
    pub header: Option<AsmHeader>,
    /// Recovered only from lines that parsed, for the reason `TmDocument::comments` states.
    pub comments: Vec<AnchoredComment<AsmAnchor>>,
    pub diagnostics: Vec<Diagnostic>,
}

/// Parse the register-assembly text form. Unchanged in signature and behaviour.
///
/// `parse_asm_nav`'s document half, for the reason `parse_tm_full` states.
///
/// **REFERENCES ELSEWHERE TO THIS FUNCTION DIAGNOSING OR CAPPING SOMETHING MEAN THE LOOP IN
/// `parse_asm_nav`.** Several safety arguments across this crate — `header.rs`'s allocation bound,
/// `comments.rs`'s anchor-names-one-line claim — name this function as the code that performs a
/// check, and were written when it WAS that code. It is now one line. The checks did not move
/// out of the crate, only into `parse_asm_nav`, and a reader following such a pointer should
/// continue there rather than conclude the bound is unenforced.
#[must_use]
pub fn parse_asm_full(src: &str) -> AsmDocument {
    parse_asm_nav(src).0
}

/// Parse the register-assembly text form, returning the header and a navigation index too.
/// Iterative over a flat line grammar, no recursion, never panics — `parse_tm_full`'s former shape
/// and contract, now shared with `parse_tm_nav`.
///
/// A `None` program means at least one diagnostic; an empty source is an empty program and no
/// diagnostics, since a program with no instructions is well-formed and the printer emits one. A
/// `None` header means the file carried none, which is NOT an error — the header is optional (see
/// `AsmHeader`'s doc).
///
/// **This reader is deliberately more permissive than the printer is precise.** `r007` reads as
/// `Reg::Loc(7)` and would print back as `r7`, so it is not a fixed point of print-then-parse. That
/// costs nothing: the round-trip property this form guarantees is over text the PRINTER produced
/// (design §3.4, P1), and rejecting a leading zero would buy a stricter grammar no writer needs.
#[must_use]
pub fn parse_asm_nav(src: &str) -> (AsmDocument, NameIndex) {
    let mut diags: Vec<Diagnostic> = Vec::new();
    let mut code: Vec<Instr> = Vec::new();
    let mut labels: Vec<(String, usize)> = Vec::new();
    let mut header: Option<AsmHeader> = None;
    let mut comments: Vec<AnchoredComment<AsmAnchor>> = Vec::new();
    // Own-line comments seen but not yet attached: they belong to the NEXT line that parses, which
    // has not been read. Drained at each anchor and, if any survive, at end of input.
    let mut pending: Vec<String> = Vec::new();
    let mut nav = NameIndex::default();

    // Attach everything waiting to `anchor`, then the line's own trailing comment. Called only from
    // a branch that has decided the line parses — a line that errors leaves `pending` intact for the
    // next line that does, and contributes no trailing comment of its own.
    let attach = |comments: &mut Vec<AnchoredComment<AsmAnchor>>,
                  pending: &mut Vec<String>,
                  anchor: AsmAnchor,
                  comment: Option<&str>| {
        for text in pending.drain(..) {
            comments.push(AnchoredComment { text, anchor, own_line: true });
        }
        if let Some(body) = comment {
            comments.push(AnchoredComment { text: body.to_string(), anchor, own_line: false });
        }
    };

    let mut offset = 0usize;
    for raw_line in src.split_inclusive('\n') {
        let line_start = offset;
        offset += raw_line.len();
        let content = raw_line.trim_end_matches(['\r', '\n']);
        let span = Span { start: line_start, end: line_start + content.len() };
        // How far the line's content sits from the line's own start. Every name span below is
        // measured from here; computed once because both the label branch and the instruction
        // branch need it, and two copies is one more than can be kept in agreement by reading.
        let indent = content.len() - content.trim_start().len();

        // A `;` unconditionally starts a comment in this grammar, so no legal mnemonic or label name
        // can contain one — that is what makes splitting here safe, not any check that runs later. The
        // cost: a hand-written `weird;name:` reads as the label `weird`, silently, with no diagnostic.
        let (before, comment) = comments::split_trailing(content);
        let text = before.trim();
        if text.is_empty() {
            if let Some(body) = comment {
                pending.push(body.to_string());
            }
            continue;
        }

        // The label check runs first: a line ending in `:` is a label declaration full stop, so it
        // must win over the `result` directive dispatch below. Without this order, a label named
        // `result` written with a space before its colon (`result :`, legal here exactly as `foo :`
        // is) would be swallowed by the directive check instead of read as the label it is.
        if let Some(name) = text.strip_suffix(':') {
            let name = name.trim_end();
            if name.is_empty() {
                diags.push(Diagnostic::error(span, "expected a label name before `:`"));
            } else {
                labels.push((name.to_string(), code.len()));
                attach(&mut comments, &mut pending, AsmAnchor::Label(labels.len() - 1), comment);
                // `name` is already fully trimmed — `text` is `before.trim()` and this strips a
                // `:` then `trim_end`s — so this pad is structurally ZERO and `indent` carries the
                // whole offset. Called for the name rather than the pad. Spelled out because the
                // `.tm` sites had exactly this shape and were WRONG there, the difference being
                // that they added a keyword length this site does not have; `trimmed_at`'s doc
                // now warns that a trimmed argument makes its second return meaningless.
                let (name_text, pad) = trimmed_at(name);
                let at = line_start + indent + pad;
                nav.push_definition(name_text, Span::new(at, at + name_text.len()), DefKind::Label);
            }
            continue;
        }

        if let Some(rest) = text.strip_prefix("result") {
            // `result` is a directive only when a separator follows. Without this, a label named
            // `resultset` would be read as a malformed directive rather than the label it is. A line
            // ending in `:` never reaches here — the label check above already claimed it.
            if rest.starts_with(char::is_whitespace) || rest.is_empty() {
                if !code.is_empty() || !labels.is_empty() {
                    diags.push(Diagnostic::error(
                        span,
                        "`result` must precede the first instruction or label (header directives come first)",
                    ));
                } else if header.is_some() {
                    diags.push(Diagnostic::error(span, "duplicate `result` directive"));
                } else {
                    let ty_text = rest.trim();
                    if let Some(t) = crate::ty::parse_ty(ty_text) {
                        header = Some(AsmHeader { result: t });
                        attach(&mut comments, &mut pending, AsmAnchor::Result, comment);
                    } else {
                        diags.push(Diagnostic::error(
                            span,
                            format!("`result` must be a value type (Nat | Bool | Unit | List<T>), found `{ty_text}`"),
                        ));
                    }
                }
                continue;
            }
        }

        match parse_instr_at(text) {
            Ok((instr, label)) => {
                if let Some((name, rel)) = label {
                    // `text` is `before.trim()` and `before` starts where `content` does, so
                    // `text` begins exactly `indent` bytes into the line — there is no further
                    // leading pad to add. An earlier version added the difference between the
                    // indent-stripped line and `text`, which measures what was removed from the
                    // END (a trailing comment), and so pushed the span INTO the comment: `jmp f
                    // ; go back` reported the `k` of `back`.
                    let at = line_start + indent + rel;
                    nav.push_reference(name, Span::new(at, at + name.len()));
                }
                code.push(instr);
                attach(&mut comments, &mut pending, AsmAnchor::Instr(code.len() - 1), comment);
            }
            Err(message) => diags.push(Diagnostic::error(span, message)),
        }
    }

    for text in pending.drain(..) {
        comments.push(AnchoredComment { text, anchor: AsmAnchor::Eof, own_line: true });
    }

    nav.link();

    // Unlike `pending` above — where each branch decides for itself whether to drain it — whether
    // `comments` survives at all is decided in exactly one place: this check. Any diagnostic, from
    // any line, empties it regardless of which branch produced it or how much had already been
    // attached; no branch above needs to undo its own `attach` call when a later line goes on to
    // fail. `a_file_with_an_error_recovers_no_comments` is the test for this.
    if diags.is_empty() {
        (AsmDocument { program: Some(Program { code, labels }), header, comments, diagnostics: diags }, nav)
    } else {
        (AsmDocument { program: None, header: None, comments: Vec::new(), diagnostics: diags }, nav)
    }
}

/// Parse the register-assembly text form, dropping any header.
///
/// A thin wrapper over `parse_asm_full` rather than a second parser, for the reason `parse_tm` states
/// about its own: this function MUST learn to skip directives regardless — otherwise a file carrying
/// one hits the unknown-mnemonic path and is rejected — and once it must change anyway, delegating
/// removes the failure mode where two parsers drift.
#[must_use]
pub fn parse_asm(src: &str) -> (Option<Program>, Vec<Diagnostic>) {
    let d = parse_asm_full(src);
    (d.program, d.diagnostics)
}

/// One instruction line, already stripped of indentation and comments.
///
/// `parse_instr_at`'s instruction half, the shape `parse_asm` and `parse_tm` already use for the
/// same reason: one reader, two entry points, and no way for them to disagree.
///
/// `#[cfg(test)]`: production now calls `parse_instr_at` directly (it needs the offset), so this
/// wrapper's only remaining caller is the test suite below, which exercises the plain `Result`
/// without carrying `label_at` through every assertion.
#[cfg(test)]
fn parse_instr(text: &str) -> Result<Instr, String> {
    parse_instr_at(text).map(|(i, _)| i)
}

/// `parse_instr`, plus where the `Label` operand begins relative to the start of `text` — `None`
/// for the twenty-one shapes that take no label.
///
/// **THE OFFSET IS RECORDED AS THE OPERANDS ARE SPLIT**, which is the discipline `print_tm_inner`
/// already states for its own spans: an offset is exact by construction and nothing re-scans the
/// text. Which operand is the label comes from `Shape::kinds()`, the one table that says so — a
/// list of label-taking mnemonics here would be a second copy of `MNEMONICS` with no gate able to
/// hold the two in agreement.
/// One parsed instruction, plus its label operand — the name as written and where it begins,
/// relative to the start of the instruction text — for the three shapes that carry one.
type InstrWithLabel<'a> = (Instr, Option<(&'a str, usize)>);

fn parse_instr_at(text: &str) -> Result<InstrWithLabel<'_>, String> {
    let (mnemonic, rest_raw) = text.split_once(char::is_whitespace).unwrap_or((text, ""));
    let shape = shape_of(mnemonic).ok_or_else(|| format!("unknown mnemonic `{mnemonic}`"))?;
    let kinds = shape.kinds();

    // Where `rest` begins in `text`: past the mnemonic and its delimiter, then past the leading
    // whitespace `trim` removes. Derived from LENGTHS rather than from the delimiter's width, so a
    // multi-byte whitespace character cannot shift it.
    let rest_start = (text.len() - rest_raw.len()) + (rest_raw.len() - rest_raw.trim_start().len());
    let rest = rest_raw.trim();

    // Each operand's text AND where it begins in `text`. Still bounded to `kinds.len() + 1` for
    // the reason the previous version stated: one operand past what any shape accepts is what lets
    // the arity check below tell "too many" from "too few".
    let mut operands: Vec<(&str, usize)> = Vec::new();
    if !rest.is_empty() {
        let mut cursor = rest_start;
        for piece in rest.split(',').take(kinds.len() + 1) {
            operands.push((piece.trim(), cursor + (piece.len() - piece.trim_start().len())));
            cursor += piece.len() + 1; // `+ 1` for the comma `split` consumed
        }
    }

    if operands.len() != kinds.len() {
        return Err(format!("`{mnemonic}` takes {} operand(s), found {}", kinds.len(), operands.len()));
    }

    // Read positionally: the shape decides what each operand IS, so a label spelled like a register
    // is a label. This is the reading half of the rule `Operand`'s doc states for the printer.
    //
    // SAFETY INVARIANT (not enforced by the type system): these closures index `operands[i]`
    // directly. That is in bounds only because the arity check above guarantees
    // `operands.len() == kinds.len()`, PLUS a hand-maintained correspondence between each
    // `MNEMONICS` row's `Shape` and the indices the match arm below actually reads — nothing stops
    // `("head", Shape::RR)` from being written next to `"head" => Ok(Instr::Head(reg(0)?, reg(1)?))`
    // even though `Head` only needs one register, and nothing stops the reverse either. The
    // guarantee that every match arm's indices stay within its row's arity is a TEST RESULT, not a
    // construction: `table_agrees_with_the_printer` pins each row's `Shape` to what the printer
    // actually emits, and `every_table_mnemonic_builds_an_instruction` calls every row's match arm
    // with exactly that many operands and asserts it does not panic. Keep both green when adding or
    // reshaping a row.
    let reg = |i: usize| -> Result<Reg, String> {
        parse_reg(operands[i].0).ok_or_else(|| format!("`{}` is not a register", operands[i].0))
    };
    let imm = |i: usize| -> Result<u64, String> {
        parse_imm(operands[i].0).ok_or_else(|| format!("`{}` is not an immediate (expected `#n`)", operands[i].0))
    };
    let label = |i: usize| -> Result<String, String> {
        let l = operands[i].0;
        if l.is_empty() { Err(format!("`{mnemonic}` expects a label")) } else { Ok(l.to_string()) }
    };

    // This sits AFTER the arity check, which is what makes `operands[k]` in bounds — the same
    // invariant the three closures above rely on, and the one the SAFETY INVARIANT comment above
    // them documents.
    // **THE TEXT AND THE OFFSET COME FROM ONE LOOKUP, WHICH IS WHAT MAKES THEM UNABLE TO
    // DISAGREE.** They were two: `Shape::kinds()` gave the offset here and a hand-written match
    // over `Instr` variants gave the name at the call site — the second copy of `MNEMONICS` this
    // function's own doc refuses, written in variants rather than strings. Add a fourth
    // label-taking mnemonic with a new `Instr` variant and the offset would have been right while
    // the name lookup returned `None`, dropping the reference with no diagnostic, no panic and no
    // compile error. `operands[k]` holds both halves on one line; taking both deletes the
    // disagreement rather than documenting it.
    let label_at = kinds.iter().position(|k| matches!(k, OperandKind::Label)).map(|k| operands[k]);

    if let Some(op) = bin_op_for(mnemonic) {
        return Ok((Instr::Bin(op, reg(0)?, reg(1)?, reg(2)?), label_at));
    }

    let instr = match mnemonic {
        "li" => Ok(Instr::Li(reg(0)?, imm(1)?)),
        "mov" => Ok(Instr::Mov(reg(0)?, reg(1)?)),
        "jz" => Ok(Instr::Jz(reg(0)?, label(1)?)),
        "jmp" => Ok(Instr::Jmp(label(0)?)),
        "call" => Ok(Instr::Call(label(0)?)),
        "ret" => Ok(Instr::Ret),
        "halt" => Ok(Instr::Halt),
        "nil" => Ok(Instr::Nil(reg(0)?)),
        "cons" => Ok(Instr::Cons(reg(0)?, reg(1)?, reg(2)?)),
        "head" => Ok(Instr::Head(reg(0)?, reg(1)?)),
        "tail" => Ok(Instr::Tail(reg(0)?, reg(1)?)),
        "isempty" => Ok(Instr::IsEmpty(reg(0)?, reg(1)?)),
        "box" => Ok(Instr::Box(reg(0)?, reg(1)?)),
        "box_get" => Ok(Instr::BoxGet(reg(0)?, reg(1)?)),
        "box_set" => Ok(Instr::BoxSet(reg(0)?, reg(1)?)),
        // Unreachable in practice: `shape_of` succeeded above, so `mnemonic` is one of the 24 and
        // every one is handled here or by `bin_op_for`. Returning an error rather than
        // `unreachable!()` keeps the no-panic rule mechanical, and
        // `every_table_mnemonic_builds_an_instruction` is what proves the arm is dead.
        _ => Err(format!("`{mnemonic}` has a table row but no reader")),
    }?;
    Ok((instr, label_at))
}

/// `r{n}` / `a{n}` / `rr`, the three spellings `reg_str` produces.
fn parse_reg(text: &str) -> Option<Reg> {
    // `rr` first: `strip_prefix('r')` would otherwise leave `"r"`, which is not a number.
    if text == "rr" {
        return Some(Reg::Rr);
    }
    if let Some(n) = text.strip_prefix('r') {
        return n.parse().ok().map(Reg::Loc);
    }
    if let Some(n) = text.strip_prefix('a') {
        return n.parse().ok().map(Reg::Arg);
    }
    None
}

/// `#{n}`, the one spelling `operand_str` produces for an immediate.
fn parse_imm(text: &str) -> Option<u64> {
    text.strip_prefix('#')?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::asm::{Instr, Operand, Reg, instr_parts};
    use crate::ty::Ty;

    /// One instance of all 16 `Instr` variants, with all nine `BinOp`s for `Bin`. The differential
    /// below is only as complete as this list, so it is written variant by variant rather than
    /// generated.
    fn every_instr() -> Vec<Instr> {
        let ops =
            [BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Eq, BinOp::Ne, BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge];
        let mut v = vec![
            Instr::Li(Reg::Loc(0), 7),
            Instr::Mov(Reg::Loc(1), Reg::Arg(0)),
            Instr::Jz(Reg::Rr, "skip0".to_string()),
            Instr::Jmp("endif1".to_string()),
            Instr::Call("f.2".to_string()),
            Instr::Ret,
            Instr::Halt,
            Instr::Nil(Reg::Loc(2)),
            Instr::Cons(Reg::Loc(3), Reg::Loc(1), Reg::Loc(2)),
            Instr::Head(Reg::Loc(4), Reg::Loc(3)),
            Instr::Tail(Reg::Loc(5), Reg::Loc(3)),
            Instr::IsEmpty(Reg::Loc(6), Reg::Loc(3)),
            Instr::Box(Reg::Loc(7), Reg::Loc(0)),
            Instr::BoxGet(Reg::Loc(8), Reg::Loc(7)),
            Instr::BoxSet(Reg::Loc(7), Reg::Loc(0)),
        ];
        v.extend(ops.into_iter().map(|op| Instr::Bin(op, Reg::Loc(9), Reg::Loc(0), Reg::Loc(1))));
        v
    }

    /// THE DIFFERENTIAL. For every variant, the shape the table claims for its mnemonic must equal
    /// the operand kinds the printer actually emits. This is what makes the table a description of
    /// the printer rather than a second opinion about it.
    #[test]
    fn table_agrees_with_the_printer() {
        for instr in every_instr() {
            let (mnemonic, operands) = instr_parts(&instr);
            let shape = shape_of(mnemonic).unwrap_or_else(|| panic!("printer emits `{mnemonic}`, table has no row"));
            let printed: Vec<OperandKind> = operands.iter().map(Operand::kind).collect();
            assert_eq!(shape.kinds(), printed.as_slice(), "shape mismatch for `{mnemonic}`");
        }
    }

    #[test]
    fn the_table_has_one_row_per_mnemonic_and_no_duplicates() {
        let mut names: Vec<&str> = MNEMONICS.iter().map(|(m, _)| *m).collect();
        let before = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), before, "duplicate mnemonic in MNEMONICS");
        assert_eq!(before, 24, "24 mnemonics fold into 16 Instr variants (design §1)");
    }

    /// The nine-to-one fold, in the direction that matters: a `cmpge` read as `Gt` is a program that
    /// runs and answers wrongly rather than one that fails to parse (design §9 risk 1).
    #[test]
    fn bin_op_for_inverts_bin_mnemonic() {
        for op in [BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Eq, BinOp::Ne, BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge]
        {
            // Bind the instruction: `instr_parts` returns operands borrowed from it, so passing a
            // temporary would not outlive the call.
            let instr = Instr::Bin(op, Reg::Rr, Reg::Rr, Reg::Rr);
            let (m, _) = instr_parts(&instr);
            assert_eq!(bin_op_for(m), Some(op), "`{m}` must read back as the op that printed it");
        }
    }

    #[test]
    fn a_mnemonic_nothing_prints_has_no_row() {
        assert!(shape_of("frobnicate").is_none());
        assert!(bin_op_for("mov").is_none());
    }

    #[test]
    fn an_empty_source_is_an_empty_program() {
        let (prog, ds) = parse_asm("");
        assert!(ds.is_empty(), "no diagnostics: {ds:?}");
        let prog = prog.expect("empty source parses");
        assert!(prog.code.is_empty());
        assert!(prog.labels.is_empty());
    }

    #[test]
    fn labels_bind_to_the_index_they_precede() {
        // No instructions yet, so every label lands at index 0 — including the two that share it.
        let (prog, ds) = parse_asm("f:\ng:\n");
        assert!(ds.is_empty(), "no diagnostics: {ds:?}");
        let prog = prog.expect("labels parse");
        assert_eq!(prog.labels, vec![("f".to_string(), 0), ("g".to_string(), 0)]);
    }

    #[test]
    fn blank_lines_and_semicolon_comments_are_skipped() {
        let src = "; leading comment\n\nf:   ; trailing comment\n\n";
        let (prog, ds) = parse_asm(src);
        assert!(ds.is_empty(), "no diagnostics: {ds:?}");
        assert_eq!(prog.expect("parses").labels, vec![("f".to_string(), 0)]);
    }

    /// The span must cover the offending line, not the whole file — this is the property that makes
    /// a diagnostic clickable, and it is checked by arithmetic on the source rather than by eye.
    #[test]
    fn an_unrecognized_line_is_a_spanned_error() {
        let src = "f:\nnot an instruction\n";
        let (prog, ds) = parse_asm(src);
        assert!(prog.is_none(), "a file with an error yields no program");
        assert_eq!(ds.len(), 1, "one diagnostic: {ds:?}");
        let line_start = src.find("not").expect("fixture contains the line");
        assert_eq!(ds[0].span, Span { start: line_start, end: line_start + "not an instruction".len() });
    }

    /// `content` is built with `trim_end_matches`, so a `\r\n` source must not leave the `\r` inside
    /// the span — the same arithmetic check as `an_unrecognized_line_is_a_spanned_error`, on a CRLF
    /// fixture, pinning that the span covers the logical line and not one byte past it.
    #[test]
    fn a_crlf_line_span_excludes_the_line_terminator() {
        let src = "f:\r\nnot an instruction\r\n";
        let (prog, ds) = parse_asm(src);
        assert!(prog.is_none(), "a file with an error yields no program");
        assert_eq!(ds.len(), 1, "one diagnostic: {ds:?}");
        let line_start = src.find("not").expect("fixture contains the line");
        assert_eq!(ds[0].span, Span { start: line_start, end: line_start + "not an instruction".len() });
    }

    #[test]
    fn a_colon_with_no_name_is_an_error() {
        let (prog, ds) = parse_asm(":\n");
        assert!(prog.is_none());
        assert_eq!(ds.len(), 1, "one diagnostic: {ds:?}");
        assert!(ds[0].message.contains("label"), "the message names what is missing: {}", ds[0].message);
    }

    #[test]
    fn every_register_spelling_reads_back() {
        assert_eq!(parse_reg("r0"), Some(Reg::Loc(0)));
        assert_eq!(parse_reg("r42"), Some(Reg::Loc(42)));
        assert_eq!(parse_reg("a3"), Some(Reg::Arg(3)));
        assert_eq!(parse_reg("rr"), Some(Reg::Rr));
        // `rr` must be tested before the `r` prefix, or it reads as `Loc` of an unparseable "r".
        assert_eq!(parse_reg("r"), None);
        assert_eq!(parse_reg("x1"), None);
        assert_eq!(parse_reg(""), None);
    }

    #[test]
    fn an_instruction_of_every_shape_reads_back() {
        let cases = [
            ("li\tr0, #7", Instr::Li(Reg::Loc(0), 7)),
            ("mov\tr1, a0", Instr::Mov(Reg::Loc(1), Reg::Arg(0))),
            ("add\trr, r0, r1", Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1))),
            ("cmpge\tr2, r0, r1", Instr::Bin(BinOp::Ge, Reg::Loc(2), Reg::Loc(0), Reg::Loc(1))),
            ("jz\tr0, skip0", Instr::Jz(Reg::Loc(0), "skip0".to_string())),
            ("jmp\tendif1", Instr::Jmp("endif1".to_string())),
            ("call\tf.2", Instr::Call("f.2".to_string())),
            ("ret", Instr::Ret),
            ("halt", Instr::Halt),
            ("nil\tr3", Instr::Nil(Reg::Loc(3))),
            ("box\tr6, r7", Instr::Box(Reg::Loc(6), Reg::Loc(7))),
            ("box_get\tr8, r9", Instr::BoxGet(Reg::Loc(8), Reg::Loc(9))),
            ("box_set\tr4, r5", Instr::BoxSet(Reg::Loc(4), Reg::Loc(5))),
        ];
        for (text, want) in cases {
            assert_eq!(parse_instr(text), Ok(want.clone()), "reading `{text}`");
        }
    }

    /// A label operand is whatever sits in a label position, so a label spelled like a register is
    /// read as a label — the property `Operand`'s own doc says the printer relies on.
    #[test]
    fn a_label_named_like_a_register_is_still_a_label() {
        assert_eq!(parse_instr("jmp\tr0"), Ok(Instr::Jmp("r0".to_string())));
        assert_eq!(parse_instr("jz\trr, rr"), Ok(Instr::Jz(Reg::Rr, "rr".to_string())));
    }

    #[test]
    fn the_wrong_operand_count_is_an_error_naming_the_mnemonic() {
        let e = parse_instr("mov\tr0").expect_err("mov takes two operands");
        assert!(e.contains("mov"), "the message names the mnemonic: {e}");
        let e = parse_instr("ret\tr0").expect_err("ret takes none");
        assert!(e.contains("ret"), "the message names the mnemonic: {e}");
    }

    /// `jz` is `Shape::RL`, arity 2. `"r0,"` splits on `,` into `["r0", ""]` — length 2, so the arity
    /// check does not trip, and the empty second operand reaches the label closure's `is_empty()` arm
    /// instead. That branch was reachable but untested; this pins the exact error it produces.
    #[test]
    fn a_trailing_comma_with_no_label_reaches_the_empty_label_error() {
        let e = parse_instr("jz\tr0,").expect_err("the label operand is empty, not present");
        assert_eq!(e, "`jz` expects a label");
    }

    /// `.take(kinds.len() + 1)` bounds the allocation, not the diagnostic: a list with exactly one
    /// operand too many is still within the bound, so the reported count is the true one — the same
    /// message a caller would have seen before the bound existed. A wildly over-long list (the
    /// pathological case the bound exists for) is still rejected as "too many", just with a capped
    /// count rather than a true one, which is the trade this bound makes.
    #[test]
    fn an_over_long_operand_list_is_bounded_and_still_reports_too_many() {
        // `ret` is `Shape::Nullary` — arity 0 — so one operand is already one too many.
        let e = parse_instr("ret\tr0").expect_err("ret takes no operands");
        assert_eq!(e, "`ret` takes 0 operand(s), found 1");

        // Far longer than any shape ever accepts: still an arity error, not an allocation proportional
        // to the input, and not a silent truncation to a shorter instruction.
        let long = format!("mov\t{}", vec!["r0"; 10_000].join(", "));
        let e = parse_instr(&long).expect_err("mov takes two operands, not ten thousand");
        assert!(e.starts_with("`mov` takes 2 operand(s), found"), "{e}");
    }

    #[test]
    fn an_unknown_mnemonic_is_an_error_naming_it() {
        let e = parse_instr("frob\tr0").expect_err("no such mnemonic");
        assert!(e.contains("frob"), "the message names the mnemonic: {e}");
    }

    #[test]
    fn a_malformed_operand_is_an_error_naming_the_operand() {
        let e = parse_instr("li\tr0, 7").expect_err("an immediate needs its `#`");
        assert!(e.contains('7'), "the message names the operand: {e}");
        let e = parse_instr("mov\tr0, x9").expect_err("x9 is not a register");
        assert!(e.contains("x9"), "the message names the operand: {e}");
    }

    /// The printer writes `\t` before the first operand and `, ` between the rest. The reader accepts
    /// any run of whitespace, so a hand-written file need not reproduce the tab.
    #[test]
    fn spacing_around_operands_is_free() {
        let want = Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1));
        assert_eq!(parse_instr("add rr,r0,r1"), Ok(want.clone()));
        assert_eq!(parse_instr("add   rr ,  r0 , r1"), Ok(want));
    }

    #[test]
    fn instructions_and_labels_interleave_in_source_order() {
        let (prog, ds) = parse_asm("f:\n    li\tr0, #1\ng:\n    halt\n");
        assert!(ds.is_empty(), "no diagnostics: {ds:?}");
        let prog = prog.expect("parses");
        assert_eq!(prog.code, vec![Instr::Li(Reg::Loc(0), 1), Instr::Halt]);
        assert_eq!(prog.labels, vec![("f".to_string(), 0), ("g".to_string(), 1)]);
    }

    /// Every mnemonic in the table builds an instruction, so `parse_instr`'s final arm is
    /// unreachable. Written as a test rather than an `unreachable!()` because the no-panic rule is
    /// mechanical: the arm exists, and this is what says it can never fire.
    #[test]
    fn every_table_mnemonic_builds_an_instruction() {
        for (mnemonic, shape) in MNEMONICS {
            let operands = match shape {
                Shape::Nullary => String::new(),
                Shape::R => "\tr0".to_string(),
                Shape::RR => "\tr0, r1".to_string(),
                Shape::RRR => "\tr0, r1, r2".to_string(),
                Shape::RI => "\tr0, #1".to_string(),
                Shape::RL => "\tr0, lbl".to_string(),
                Shape::L => "\tlbl".to_string(),
            };
            let line = format!("{mnemonic}{operands}");
            assert!(parse_instr(&line).is_ok(), "`{line}` must build an instruction");
        }
    }

    #[test]
    fn a_headered_file_yields_both_halves() {
        let AsmDocument { program: prog, header, diagnostics: ds, .. } = parse_asm_full("result Nat\n\n    halt\n");
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(header, Some(AsmHeader { result: Ty::Nat }));
        assert_eq!(prog.expect("parses").code, vec![Instr::Halt]);
    }

    /// Optionality property: a header-less file is NOT an error, it simply has no header.
    #[test]
    fn a_header_less_file_is_not_an_error() {
        let AsmDocument { program: prog, header, diagnostics: ds, .. } = parse_asm_full("    halt\n");
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(header, None);
        assert_eq!(prog.expect("parses").code, vec![Instr::Halt]);
    }

    /// `parse_asm` must keep working on a headered file rather than choking on the directive.
    #[test]
    fn parse_asm_drops_a_header_instead_of_rejecting_it() {
        let (prog, ds) = parse_asm("result List<Nat>\n\n    halt\n");
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(prog.expect("parses").code, vec![Instr::Halt]);
    }

    #[test]
    fn a_result_that_is_not_a_value_type_is_rejected_where_it_is_written() {
        let AsmDocument { program: prog, header, diagnostics: ds, .. } = parse_asm_full("result Fun\n\n    halt\n");
        assert!(prog.is_none());
        assert_eq!(header, None);
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("value type"), "the message says what is admissible: {}", ds[0].message);
    }

    #[test]
    fn a_duplicate_result_directive_is_an_error() {
        let ds = parse_asm_full("result Nat\nresult Bool\n\n    halt\n").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("duplicate"), "{}", ds[0].message);
    }

    /// Mirrors `header_position` on the TM side: a directive after the body is rejected, so a file
    /// written today cannot be broken by a later, stricter reader.
    #[test]
    fn a_directive_after_the_first_instruction_is_rejected() {
        let ds = parse_asm_full("    halt\nresult Nat\n").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("precede"), "{}", ds[0].message);
    }

    /// A label counts as body, not header — the same rule, checked on the other line kind.
    #[test]
    fn a_directive_after_the_first_label_is_rejected() {
        let ds = parse_asm_full("f:\nresult Nat\n    halt\n").diagnostics;
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("precede"), "{}", ds[0].message);
    }

    /// `result` is a directive only when a separator follows it — a label named `result:` or
    /// `resultset:` must still read as the label it is, not a malformed directive. This is the
    /// property the `strip_prefix("result")` + separator check in `parse_asm_full` exists for.
    #[test]
    fn a_label_named_result_or_resultset_is_not_read_as_a_directive() {
        let AsmDocument { program: prog, header, diagnostics: ds, .. } =
            parse_asm_full("result:\nresultset:\n    halt\n");
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(header, None, "no directive was written, so there is no header");
        let prog = prog.expect("parses");
        assert_eq!(prog.code, vec![Instr::Halt]);
        assert_eq!(prog.labels, vec![("result".to_string(), 0), ("resultset".to_string(), 0)]);
    }

    /// THE REGRESSION: a label named `result` with a space before its colon must read as the label
    /// `result`, not be swallowed by the `result` directive dispatch. Space-before-colon is legal for
    /// every other identifier (see `a_label_named_foo_with_a_space_before_the_colon_is_a_label`, the
    /// control case below) — `result :` is no different, and directive dispatch must not claim it just
    /// because the line starts with the word `result`.
    #[test]
    fn a_label_named_result_with_a_space_before_the_colon_is_a_label() {
        let AsmDocument { program: prog, header, diagnostics: ds, .. } = parse_asm_full("result :\n    halt\n");
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(header, None, "no directive was written, so there is no header");
        let prog = prog.expect("parses");
        assert_eq!(prog.code, vec![Instr::Halt]);
        assert_eq!(prog.labels, vec![("result".to_string(), 0)]);
    }

    /// The control proving the case above is really a regression and not just how labels work: `foo`
    /// is an ordinary identifier with no directive to compete with, and `foo :` has always read as the
    /// label `foo`. If this ever stops passing, the fix for the regression above went too far and broke
    /// label parsing generally, not just the `result` special case.
    #[test]
    fn a_label_named_foo_with_a_space_before_the_colon_is_a_label() {
        let (prog, ds) = parse_asm("foo :\n    halt\n");
        assert!(ds.is_empty(), "{ds:?}");
        let prog = prog.expect("parses");
        assert_eq!(prog.code, vec![Instr::Halt]);
        assert_eq!(prog.labels, vec![("foo".to_string(), 0)]);
    }

    /// The fix must not overcorrect: `result Nat` does not end in `:`, so it is still read as a
    /// directive, not a label — the label check only claims lines that end in `:`.
    #[test]
    fn result_nat_with_no_trailing_colon_is_still_a_directive() {
        let AsmDocument { program: prog, header, diagnostics: ds, .. } = parse_asm_full("result Nat\n\n    halt\n");
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(header, Some(AsmHeader { result: Ty::Nat }));
        let prog = prog.expect("parses");
        assert_eq!(prog.code, vec![Instr::Halt]);
        assert!(prog.labels.is_empty(), "`result Nat` is a directive, not a label: {:?}", prog.labels);
    }

    #[test]
    fn the_label_operand_offset_survives_every_spacing_the_grammar_allows() {
        // Tabs, several spaces, and no space after the comma are all legal here, and each moves
        // the operand. A fixture using only the printer's own tab layout would pass against
        // arithmetic that is wrong for every hand-written file.
        // The expectation carries the NAME as well as the offset, because the two now come from
        // one lookup and pinning only the offset would leave the half that used to be computed
        // separately unchecked.
        for (text, want) in [
            ("jmp\tf", Some(("f", 4))),
            ("jz\tr0, f", Some(("f", 7))),
            ("call\tlong_name", Some(("long_name", 5))),
            ("jmp   f", Some(("f", 6))),
            ("jz\tr0,f", Some(("f", 6))),
            ("jmp f", Some(("f", 4))),
            ("li\tr0, #1", None),
            ("ret", None),
            ("add\tr0, r1, r2", None),
        ] {
            let (_, at) = parse_instr_at(text).unwrap_or_else(|e| panic!("{text:?}: {e}"));
            assert_eq!(at, want, "{text:?}");
        }
    }

    /// Probed at `64c1164`: parses clean, `labels` is [("f", 0), ("g", 3)] and `code` is
    /// [Li(Loc(0), 1), Jz(Loc(0), "g"), Jmp("g"), Ret]. Note the TABs — that is what the
    /// printer emits and what the existing fixtures in this file use.
    const NAV_ASM: &str = "result Nat\nf:\n\tli\tr0, #1\n\tjz\tr0, g\n\tjmp\tg\ng:\n\tret\n";

    #[test]
    fn asm_navigation_records_labels_and_the_label_operand_of_any_instruction() {
        let (doc, nav) = parse_asm_nav(NAV_ASM);
        assert!(doc.program.is_some(), "the fixture's premise: it parses");

        let defs: Vec<_> = nav.definitions().map(|o| (o.name.as_str(), &NAV_ASM[o.span.start..o.span.end])).collect();
        assert_eq!(defs, vec![("f", "f"), ("g", "g")]);

        // Resolve through `at` on the operand of `jz`, which is the SECOND operand — a
        // reference located by operand position 0 would find `r0` instead.
        let jz_g = NAV_ASM.find("r0, g").expect("fixture") + "r0, ".len();
        let (i, occ) = nav.at(jz_g).expect("a name at the jz operand");
        assert_eq!(&NAV_ASM[occ.span.start..occ.span.end], "g");
        let def = nav.definition_of(i).and_then(|d| nav.get(d)).expect("resolves");
        assert_eq!(&NAV_ASM[def.span.start..def.span.end], "g");
        assert_eq!(def.span.start, NAV_ASM.rfind("g:").expect("fixture"), "the LABEL, not an operand");
    }

    #[test]
    fn a_register_operand_is_not_a_name() {
        // `jz r0, g` has a Reg then a Label. Recording both would make go-to-definition fire on
        // a register, and `Shape::kinds()` is what tells them apart — a mnemonic list could not.
        let (_, nav) = parse_asm_nav(NAV_ASM);
        let r0 = NAV_ASM.find("r0, g").expect("fixture");
        assert_eq!(nav.at(r0), None, "r0 is a register, not a name");
    }

    #[test]
    fn a_dangling_jump_target_is_a_reference_that_resolves_to_nothing() {
        // Probed: this parses with `program: Some` and ZERO diagnostics. asm never checks jump
        // targets, so this is a clean file carrying a reference to nothing — not an error.
        let src = "result Nat\nf:\n\tjmp\tnowhere\n\tret\n";
        let (doc, nav) = parse_asm_nav(src);
        assert!(doc.program.is_some());
        assert_eq!(doc.diagnostics.len(), 0, "the premise: asm does not check jump targets");
        let (i, _) = nav.at(src.find("nowhere").expect("fixture")).expect("still a reference");
        assert_eq!(nav.definition_of(i), None);
    }

    #[test]
    fn a_duplicate_label_is_listed_twice_and_the_first_one_is_linked() {
        // Probed: `labels` comes back [("f", 0), ("f", 0)] with ZERO diagnostics — unlike `.tm`,
        // which diagnoses a duplicate state name. Both must appear in an outline.
        let src = "result Nat\nf:\nf:\n\tjmp\tf\n\tret\n";
        let (doc, nav) = parse_asm_nav(src);
        assert_eq!(doc.diagnostics.len(), 0, "the premise: asm does not diagnose duplicates");
        assert_eq!(nav.definitions().count(), 2);
        let (i, _) = nav.at(src.rfind('f').expect("fixture")).expect("the jmp operand");
        assert_eq!(nav.definition_of(i), Some(0), "the FIRST `f:`");
    }

    #[test]
    fn a_trailing_comment_does_not_shift_any_span() {
        // **A SPAN IS MEASURED FROM THE LINE'S START AND A COMMENT IS REMOVED FROM ITS END**, so
        // any offset term derived from what comment-stripping removed pushes the span rightwards
        // — INTO the comment. An earlier version of this code did exactly that: `jmp f ; go back`
        // reported the `k` of `back` as the reference to `f`. Every other fixture in this file
        // lacks a trailing comment and passes under that defect, which is the whole reason this
        // test exists.
        //
        // The assertion is the general invariant rather than a table of offsets: every
        // occurrence's span must slice back to its own name. That catches this bug and every
        // other one of its shape, including ones no fixture here anticipates.
        // The label is INDENTED and carries a trailing comment, and all three label-taking
        // mnemonics appear — `jz` (label is the second operand), `jmp` and `call` (the first).
        // Every fixture elsewhere in this file puts labels at column 0 and omits `call`.
        let src = "result Nat ; r\n  f: ; entry\n\tjz\tr0, f ; conditional\n\tjmp\tf ; go back\n\tcall\tf ; and again\n\tret ; end\n";
        let (doc, nav) = parse_asm_nav(src);
        assert!(doc.program.is_some(), "the fixture's premise: {:?}", doc.diagnostics);
        let mut seen = 0;
        while let Some(occ) = nav.get(seen) {
            assert_eq!(
                src.get(occ.span.start..occ.span.end),
                Some(occ.name.as_str()),
                "occurrence {seen} ({:?}) spans {}..{}, which is not its own name",
                occ.name,
                occ.span.start,
                occ.span.end
            );
            seen += 1;
        }
        assert_eq!(seen, 4, "one label and three jumps to it");
        assert_eq!(nav.references_to(0).count(), 3, "jz, jmp and call");
    }

    #[test]
    fn parse_asm_full_is_exactly_the_documents_half_of_parse_asm_nav() {
        // **A TAUTOLOGY TODAY, AND SAYING SO IS THE POINT.** `parse_asm_full` is *defined* as
        // `parse_asm_nav(src).0`, so this expands to `x == x` and no sabotage can redden it. It
        // is kept as a guard for the day someone de-delegates the wrapper into a second parser —
        // the failure `parse_asm`'s own doc calls the reason for delegating — at which point it
        // becomes live. It is NOT evidence that the two agree; the function body is that.
        for src in [NAV_ASM, "\tli\tr0, #1\n\tret\n", "", "li\n"] {
            assert_eq!(parse_asm_full(src), parse_asm_nav(src).0, "disagreement on {src:?}");
        }
    }

    #[test]
    fn every_label_taking_shape_is_covered_by_the_derivation() {
        // THE POINT OF DERIVING FROM `Shape::kinds()` IS LOST IF THE TEST HARDCODES WHAT THE
        // CODE REFUSES TO. This walks the real MNEMONICS table, builds a line for every entry
        // whose shape contains a Label, and asserts each produces exactly one reference. A
        // fourth label-taking mnemonic added later is covered the day it is added.
        let mut checked = 0;
        for (mnemonic, shape) in MNEMONICS {
            let kinds = shape.kinds();
            let Some(pos) = kinds.iter().position(|k| matches!(k, OperandKind::Label)) else {
                continue;
            };
            let operands: Vec<String> = kinds
                .iter()
                .enumerate()
                .map(|(i, k)| match k {
                    OperandKind::Reg => format!("r{i}"),
                    OperandKind::Imm => "#1".to_string(),
                    OperandKind::Label => "target".to_string(),
                })
                .collect();
            let src = format!("target:\n\t{mnemonic}\t{}\n", operands.join(", "));
            let (doc, nav) = parse_asm_nav(&src);
            assert!(doc.program.is_some(), "{mnemonic} line did not parse: {:?}", doc.diagnostics);
            let refs = nav.definitions().count();
            assert_eq!(refs, 1, "{mnemonic}: expected one label definition");
            let operand_at = src.rfind("target").expect("fixture");
            let (i, _) = nav.at(operand_at).unwrap_or_else(|| panic!("{mnemonic}: no name at operand {pos}"));
            assert_eq!(nav.definition_of(i), Some(0), "{mnemonic}: operand links to the label");
            checked += 1;
        }
        assert_eq!(checked, 3, "MNEMONICS has three label-taking entries today: jz, jmp, call");
    }
}
