# The asm text form gets a reader — PR 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `parse_asm` reads back everything `print_asm` writes, `Program::validate()` makes the
printer's three silent losses checkable, and the four places in the tree claiming the asm form cannot
be read stop saying so.

**Architecture:** A new `crates/redextape-core/src/tm/asm_syntax.rs` holds the parser and the
mnemonic table it dispatches on; `asm.rs` keeps the printer and gains `Program::validate()`. The
table is the parser's half of `instr_parts` — 24 mnemonics against 16 `Instr` variants — and one
differential test derives each mnemonic's operand shape from the printer's own output and checks it
against the table, so the two halves cannot drift. Round-trip is two properties over restricted
domains, not one over all `Program`s: see the design's §3.

**Tech Stack:** Rust edition 2024, `proptest`, `cargo nextest`. No new dependencies —
`redextape-core` has none and PR 1 adds none.

**Design:** [`../specs/2026-08-24-asm-reader-design.md`](../specs/2026-08-24-asm-reader-design.md).
Read §1, §3 and §4 before starting. This plan implements PR 1 of §7 only.

## Global Constraints

- **Rust edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- **`redextape-core` has zero dependencies.** Nothing in this PR adds one.
- **No panics on user input.** `parse_asm` returns diagnostics; it never panics, never recurses, and
  never hangs. Malformed text is a `Diagnostic`, always.
- **`clippy::pedantic` is on with no globally-allowed lint**, and `cargo clippy --workspace
  --all-targets -- -D warnings` runs as a pre-commit hook on any staged `.rs`. No `unwrap`/`expect`
  in `src/` — test targets carry their own `#![allow(...)]` header, copied verbatim from a sibling.
- **One commit per task, after the tests are green.** The clippy hook compiles `--all-targets`, so a
  commit containing a test that calls a function which does not exist yet cannot build and the hook
  rejects it. TDD still runs test-first *within* a task; only the commit boundary moves.
- **`scripts/check-citations.sh` rejects `file:line` in tracked source.** Every pointer written into
  a `.rs` file here cites a SYMBOL. (The design's own line citations are the gate's deliberate
  `docs/` exception.)
- **The printer does not move.** `print_asm`'s output bytes are identical at the end of this PR.
  `span_wellformed.rs` passing unedited is the evidence.
- **Never `--no-verify`.**

---

## File Structure

| File | Responsibility |
| --- | --- |
| `crates/redextape-core/src/tm/asm_syntax.rs` | **New.** The parser: the `Shape`/`MNEMONICS` table, `parse_asm`, operand readers, and their unit tests. |
| `crates/redextape-core/src/tm/asm.rs` | **Modify.** `instr_parts`/`Operand` become `pub(super)` so the differential can see them; `Program::validate()` lands beside `label_index`. Printer untouched. |
| `crates/redextape-core/src/tm.rs` | **Modify.** Declare `pub mod asm_syntax;` and re-export `parse_asm`. |
| `crates/redextape-core/tests/asm_roundtrip.rs` | **New.** P1, P2, the three boundary tests, and the `Instr`-variant coverage record. |
| `crates/redextape-cli/src/emit.rs` | **Modify.** Retire the four falsified write-only claims. |

**Why the parser is a new file and the printer stays put.** `asm.rs` is 1,295 lines and already
holds the IR, the printer, the VM and two decoders; a parser plus its tests would push it past 1,600.
Moving `print_asm` into `asm_syntax.rs` too would match `tm/syntax.rs` exactly — printer and parser in
one text-form module — and is invisible to all four consumers, which reach it through the `tm::`
re-export. It is deliberately **not** done here: it would render the whole printer as moved lines in a
diff whose subject is the parser. Filed for PR 2, which touches the printer anyway.

---

## Task 1: The mnemonic table, held to the printer

**Files:**
- Create: `crates/redextape-core/src/tm/asm_syntax.rs`
- Modify: `crates/redextape-core/src/tm/asm.rs` (visibility of `Operand`, `instr_parts`; add `Operand::kind`)
- Modify: `crates/redextape-core/src/tm.rs` (declare the module)

**Interfaces:**
- Consumes: `asm::{Instr, Reg}`, `core::BinOp`.
- Produces: `pub(super) enum Shape { Nullary, R, RR, RRR, RI, RL, L }`,
  `pub(super) fn shape_of(mnemonic: &str) -> Option<Shape>`,
  `pub(super) fn bin_op_for(mnemonic: &str) -> Option<BinOp>`, and in `asm.rs`
  `pub(super) enum OperandKind { Reg, Imm, Label }` with `pub(super) fn Operand::kind(&self)`.

- [ ] **Step 1: Widen the printer's two items to `pub(super)` and give `Operand` a kind accessor**

In `crates/redextape-core/src/tm/asm.rs`, change `enum Operand<'a>` to `pub(super) enum Operand<'a>`
and `fn instr_parts` to `pub(super) fn instr_parts`. Then add, in the existing `impl Operand<'_>`
block beside `class`:

```rust
    /// The operand's kind, stripped of its value — what `asm_syntax`'s table has to agree with. This
    /// is `class` without the `TokenClass` vocabulary, which carries highlighting concerns the parser
    /// has no use for.
    pub(super) fn kind(&self) -> OperandKind {
        match self {
            Operand::Reg(_) => OperandKind::Reg,
            Operand::Imm(_) => OperandKind::Imm,
            Operand::Label(_) => OperandKind::Label,
        }
    }
```

and above `enum Operand`:

```rust
/// An operand's kind with no value attached. `Operand` itself borrows, so it cannot be compared
/// across the printer/parser boundary; this can.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum OperandKind {
    Reg,
    Imm,
    Label,
}
```

- [ ] **Step 2: Create the module with the table and its differential test**

Create `crates/redextape-core/src/tm/asm_syntax.rs`:

```rust
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
use crate::diagnostic::Diagnostic;
use crate::span::Span;
use crate::tm::asm::{Instr, OperandKind, Program, Reg};

/// The positional operand kinds of one mnemonic. `RI` is `li rd, #n`; `RL` is `jz r, label`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Shape {
    Nullary,
    R,
    RR,
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
    ("add", Shape::RRR),     // Bin
    ("sub", Shape::RRR),     // Bin
    ("mul", Shape::RRR),     // Bin
    ("cmpeq", Shape::RRR),   // Bin
    ("cmpne", Shape::RRR),   // Bin
    ("cmplt", Shape::RRR),   // Bin
    ("cmple", Shape::RRR),   // Bin
    ("cmpgt", Shape::RRR),   // Bin
    ("cmpge", Shape::RRR),   // Bin
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::asm::{Operand, instr_parts};

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
}
```

No file-level `#![allow(...)]` is needed here, and this was checked rather than assumed:
`clippy.toml` sets `allow-unwrap-in-tests`/`allow-expect-in-tests`/`allow-panic-in-tests`, and its
own comment states the exemption reaches code lexically inside a `#[cfg(test)]` module. This module
is one, so the `unwrap_or_else(|| panic!(...))` above is permitted. (A free helper in a `tests/`
target is NOT — which is why Task 4's file carries the header and this one does not.)

- [ ] **Step 3: Declare the module**

In `crates/redextape-core/src/tm.rs`, add `pub mod asm_syntax;` to the module list, keeping it
alphabetical — it goes immediately after `pub mod asm;`.

- [ ] **Step 4: Run the tests and clippy**

```bash
cargo nextest run -p redextape-core asm_syntax
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: 4 tests pass (`table_agrees_with_the_printer`,
`the_table_has_one_row_per_mnemonic_and_no_duplicates`, `bin_op_for_inverts_bin_mnemonic`,
`a_mnemonic_nothing_prints_has_no_row`), clippy clean.

If `table_agrees_with_the_printer` fails, the table is wrong, not the printer — the printer is the
authority here and this PR does not change it.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm_syntax.rs crates/redextape-core/src/tm/asm.rs \
        crates/redextape-core/src/tm.rs
git commit -m "asm: the mnemonic table, derived from the printer and checked against it

24 mnemonics against 16 Instr variants, because Instr::Bin prints as one of
nine. The differential derives each mnemonic's operand shape from instr_parts'
own output rather than restating it, so the parser's table cannot drift from
the printer that defines the form."
```

---

## Task 2: `parse_asm` reads labels, comments and blank lines

**Files:**
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs`
- Modify: `crates/redextape-core/src/tm.rs` (re-export `parse_asm`)

**Interfaces:**
- Consumes: Task 1's `Shape`, `shape_of`, `bin_op_for`.
- Produces: `pub fn parse_asm(src: &str) -> (Option<Program>, Vec<Diagnostic>)`. A `None` program
  means at least one `Diagnostic` was produced; an empty source is `Some(Program::default())` with no
  diagnostics.

This task lands the line loop and label handling only. Instructions arrive in Task 3, so every
non-label line is an error here — and one of this task's tests pins that the error names the line.

- [ ] **Step 1: Write the failing tests**

Append to `asm_syntax.rs`'s `mod tests`:

```rust
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

    #[test]
    fn a_colon_with_no_name_is_an_error() {
        let (prog, ds) = parse_asm(":\n");
        assert!(prog.is_none());
        assert_eq!(ds.len(), 1, "one diagnostic: {ds:?}");
        assert!(ds[0].message.contains("label"), "the message names what is missing: {}", ds[0].message);
    }
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cargo nextest run -p redextape-core asm_syntax
```

Expected: FAIL — `cannot find function \`parse_asm\` in this scope`. This is a compile error, which is
why the commit for this task comes after Step 4 rather than here.

- [ ] **Step 3: Write `parse_asm`**

Add to `asm_syntax.rs`, above `mod tests`:

```rust
/// Parse the register-assembly text form. Iterative over a flat line grammar, no recursion, never
/// panics — `parse_tm`'s shape and contract.
///
/// A `None` program means at least one diagnostic; an empty source is an empty program and no
/// diagnostics, since a program with no instructions is well-formed and the printer emits one.
///
/// **This reader is deliberately more permissive than the printer is precise.** `r007` reads as
/// `Reg::Loc(7)` and would print back as `r7`, so it is not a fixed point of print-then-parse. That
/// costs nothing: the round-trip property this form guarantees is over text the PRINTER produced
/// (design §3.4, P1), and rejecting a leading zero would buy a stricter grammar no writer needs.
#[must_use]
pub fn parse_asm(src: &str) -> (Option<Program>, Vec<Diagnostic>) {
    let mut diags: Vec<Diagnostic> = Vec::new();
    let mut code: Vec<Instr> = Vec::new();
    let mut labels: Vec<(String, usize)> = Vec::new();

    let mut offset = 0usize;
    for raw_line in src.split_inclusive('\n') {
        let line_start = offset;
        offset += raw_line.len();
        let content = raw_line.trim_end_matches('\n');
        let span = Span { start: line_start, end: line_start + content.len() };

        // A `;` starts a comment wherever it appears. Neither a mnemonic nor a label name may contain
        // one — `Program::validate` rejects a name that does — so splitting here cannot cut a token.
        let text = content.split(';').next().unwrap_or("").trim();
        if text.is_empty() {
            continue;
        }

        if let Some(name) = text.strip_suffix(':') {
            let name = name.trim_end();
            if name.is_empty() {
                diags.push(Diagnostic::error(span, "expected a label name before `:`"));
            } else {
                labels.push((name.to_string(), code.len()));
            }
            continue;
        }

        match parse_instr(text) {
            Ok(instr) => code.push(instr),
            Err(message) => diags.push(Diagnostic::error(span, message)),
        }
    }

    if diags.is_empty() { (Some(Program { code, labels }), diags) } else { (None, diags) }
}

/// One instruction line, already stripped of indentation and comments. Task 3 fills this in; until
/// then every instruction line is an unrecognized one.
fn parse_instr(text: &str) -> Result<Instr, String> {
    Err(format!("unrecognized line `{text}`"))
}
```

- [ ] **Step 4: Run the tests**

```bash
cargo nextest run -p redextape-core asm_syntax
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: 9 tests pass (Task 1's four plus this task's five), clippy clean.

- [ ] **Step 5: Re-export `parse_asm`**

In `crates/redextape-core/src/tm.rs`, add `pub use asm_syntax::parse_asm;` after the `asm::{...}`
re-export block, keeping the `pub use` statements alphabetical by module.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/tm/asm_syntax.rs crates/redextape-core/src/tm.rs
git commit -m "asm: parse_asm reads labels, comments and blank lines

The line loop and label binding, with instructions still rejected — Task 3
fills parse_instr in. Spans are computed from split_inclusive offsets so a
diagnostic covers its own line, which one test checks by arithmetic on the
fixture rather than by eye."
```

---

## Task 3: `parse_asm` reads instructions

**Files:**
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs`

**Interfaces:**
- Consumes: `shape_of`, `bin_op_for`, `Shape::kinds` from Task 1; the `parse_instr` stub from Task 2.
- Produces: a complete `parse_asm`. No signature change.

- [ ] **Step 1: Write the failing tests**

Append to `mod tests`:

```rust
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
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cargo nextest run -p redextape-core asm_syntax
```

Expected: FAIL — `cannot find function \`parse_reg\``, and the shape tests fail on the `parse_instr`
stub returning `Err`.

- [ ] **Step 3: Replace the `parse_instr` stub and add the operand readers**

In `asm_syntax.rs`, replace the stub with:

```rust
/// One instruction line, already stripped of indentation and comments.
fn parse_instr(text: &str) -> Result<Instr, String> {
    let (mnemonic, rest) = text.split_once(char::is_whitespace).unwrap_or((text, ""));
    let shape = shape_of(mnemonic).ok_or_else(|| format!("unknown mnemonic `{mnemonic}`"))?;

    let rest = rest.trim();
    let operands: Vec<&str> = if rest.is_empty() { Vec::new() } else { rest.split(',').map(str::trim).collect() };

    let kinds = shape.kinds();
    if operands.len() != kinds.len() {
        return Err(format!("`{mnemonic}` takes {} operand(s), found {}", kinds.len(), operands.len()));
    }

    // Read positionally: the shape decides what each operand IS, so a label spelled like a register
    // is a label. This is the reading half of the rule `Operand`'s doc states for the printer.
    let reg = |i: usize| -> Result<Reg, String> {
        parse_reg(operands[i]).ok_or_else(|| format!("`{}` is not a register", operands[i]))
    };
    let imm = |i: usize| -> Result<u64, String> {
        parse_imm(operands[i]).ok_or_else(|| format!("`{}` is not an immediate (expected `#n`)", operands[i]))
    };
    let label = |i: usize| -> Result<String, String> {
        let l = operands[i];
        if l.is_empty() { Err(format!("`{mnemonic}` expects a label")) } else { Ok(l.to_string()) }
    };

    if let Some(op) = bin_op_for(mnemonic) {
        return Ok(Instr::Bin(op, reg(0)?, reg(1)?, reg(2)?));
    }

    match mnemonic {
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
    }
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
```

- [ ] **Step 4: Add the test that proves the dead arm is dead**

Append to `mod tests`:

```rust
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
```

- [ ] **Step 5: Run the tests**

```bash
cargo nextest run -p redextape-core asm_syntax
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: 18 tests pass, clippy clean.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/tm/asm_syntax.rs
git commit -m "asm: parse_asm reads instructions

Operands are read positionally off the shape, so a label spelled \`r0\` is a
label — the reading half of the rule the printer's Operand doc states. The
nine Bin mnemonics fold through bin_op_for before the per-mnemonic match, and
every_table_mnemonic_builds_an_instruction proves the match's final arm is
dead rather than asserting it with a panic."
```

---

## Task 4: P1 — printer output reads back byte-identically

**Files:**
- Create: `crates/redextape-core/tests/asm_roundtrip.rs`

**Interfaces:**
- Consumes: `redextape_core::tm::{parse_asm, print_asm, lower_asm}`, `parser::parse`,
  `desugar::desugar`.
- Produces: nothing other tasks depend on.

This is the design's P1: `print(parse(t)) == t` for every `t` the printer produced. It also discharges
design §9 risk 2 — the corpus is only evidence for the variants it actually reaches, so this task
measures that coverage rather than assuming the demos are exhaustive.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/asm_roundtrip.rs`:

```rust
//! The two round-trip properties of design §3.4, and the three asymmetries that are the reason there
//! are two rather than one.
//!
//! P1 is over TEXT: anything the printer wrote, the parser reads back to text identical byte for
//! byte. P2 is over PROGRAMS, and only over the ones `lower_asm` can produce — §3 explains why the
//! unrestricted property is false.

// Test target: a fixture that fails to parse IS the failure this file reports. The `allow-*-in-tests`
// keys in `clippy.toml` reach `#[test]` functions and `#[cfg(test)]` modules, not the free helpers
// below, so the exemption is stated per target — the same note `tests/common/mod.rs` carries.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{Instr, Program, lower_asm, parse_asm, print_asm};

/// The programs P1 is held over, chosen for `Instr`-variant coverage — which is what P1's evidence
/// base needs, and what the test below MEASURES rather than assumes.
///
/// **Deliberately independent of `asm_oracle.rs`'s list, which it resembles.** That file's corpus
/// exists to make two backends agree; this one exists to reach as many instruction variants as
/// possible. Sharing them would couple two unrelated properties, and an earlier draft of this
/// comment claimed copying meant "the two files cannot disagree" — which is backwards, since copying
/// is precisely how they drift apart. They are separate on purpose and neither constrains the other.
const DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let add1 = |x| x + 1; add1(41)",
    "head(cons(7, nil))",
    "is_empty(nil)",
    "[1, 2, 3]",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "let mut x = 1; x = x + 1; let x = x + 10; x",
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
];

fn lower(src: &str) -> Program {
    let (ast, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let core = desugar(&ast.unwrap());
    lower_asm(&core).unwrap_or_else(|e| panic!("lowering failed for {src}: {e:?}"))
}

/// P1. The printer's output is the canonical form, and the parser is required to be its exact
/// inverse there — text in, same text out.
#[test]
fn printed_text_reads_back_to_identical_text() {
    for src in DEMOS {
        let text = print_asm(&lower(src));
        let (prog, ds) = parse_asm(&text);
        assert!(ds.is_empty(), "diagnostics reading back {src}: {ds:?}");
        assert_eq!(print_asm(&prog.expect("printer output parses")), text, "P1 failed for {src}");
    }
}

/// The demos are evidence only for the variants they reach. Measured rather than assumed, per design
/// §9 risk 2 — and the count is asserted so that a future change to `DEMOS` or to `lower_asm` which
/// drops coverage fails here instead of silently weakening P1.
#[test]
fn the_demo_corpus_covers_thirteen_of_the_sixteen_instr_variants() {
    let mut seen: Vec<&'static str> = DEMOS.iter().flat_map(|src| lower(src).code).map(variant_name).collect();
    seen.sort_unstable();
    seen.dedup();
    assert_eq!(
        seen.len(),
        13,
        "demo corpus reaches these variants: {seen:?}\n\
         If this number moved, say which variants moved and why in the roadmap entry — the corpus is \
         P1's entire evidence base."
    );
    // The three the corpus does not reach, named so the gap is a record rather than a surprise.
    for absent in ["Box", "BoxGet", "BoxSet"] {
        assert!(!seen.contains(&absent), "`{absent}` is now covered — update this test and the entry");
    }
}

fn variant_name(i: Instr) -> &'static str {
    match i {
        Instr::Li(..) => "Li",
        Instr::Mov(..) => "Mov",
        Instr::Bin(..) => "Bin",
        Instr::Jz(..) => "Jz",
        Instr::Jmp(..) => "Jmp",
        Instr::Call(..) => "Call",
        Instr::Ret => "Ret",
        Instr::Halt => "Halt",
        Instr::Nil(..) => "Nil",
        Instr::Cons(..) => "Cons",
        Instr::Head(..) => "Head",
        Instr::Tail(..) => "Tail",
        Instr::IsEmpty(..) => "IsEmpty",
        Instr::Box(..) => "Box",
        Instr::BoxGet(..) => "BoxGet",
        Instr::BoxSet(..) => "BoxSet",
    }
}
```

- [ ] **Step 2: Run it**

```bash
cargo nextest run -p redextape-core -E 'binary(asm_roundtrip)'
```

Expected: `printed_text_reads_back_to_identical_text` PASSES if Tasks 1–3 are correct — P1 is the
first end-to-end check of them, so a failure here is a parser defect to fix, not an expected red.

`the_demo_corpus_covers_thirteen_of_the_sixteen_instr_variants` will likely FAIL on the count. **The
13 and the three absent names are a prediction, not a measurement** — `Box`/`BoxGet`/`BoxSet` come
from `let mut` captured across a call, which the demos may or may not reach. Run it, read the printed
`seen` list, and correct the number and the absent-name list to what the corpus actually covers.
Record the real figure; do not adjust `DEMOS` to hit a predicted number.

- [ ] **Step 3: Correct the coverage figures to the measurement**

Edit the count and the `absent` list to match what Step 2 printed. If coverage is 16/16, delete the
`absent` loop and say so in the test name.

- [ ] **Step 4: Run the tests and clippy**

```bash
cargo nextest run -p redextape-core -E 'binary(asm_roundtrip)'
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: both tests pass, clippy clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/tests/asm_roundtrip.rs
git commit -m "asm: P1 — printer output reads back byte-identically

The property is over text, not over Programs: print(parse(t)) == t for t the
printer produced. Its evidence base is the demo corpus, so this also measures
which of the 16 Instr variants that corpus actually reaches and asserts the
count, rather than leaving P1's coverage as an assumption."
```

---

## Task 5: `Program::validate()`

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`

**Interfaces:**
- Consumes: `instr_reg_over_cap`, `MAX_REGISTERS` — both already in `asm.rs`.
- Produces: `pub fn Program::validate(&self) -> Vec<String>`. Empty means valid. Callers in PR 2
  depend on this signature; it mirrors `Machine::validate`.

- [ ] **Step 1: Write the failing tests**

Append to `asm.rs`'s existing `#[cfg(test)] mod tests`:

```rust
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
        let prog = Program {
            code: vec![Instr::Halt, Instr::Halt],
            labels: vec![("f".to_string(), 0), ("f".to_string(), 1)],
        };
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
        let prog = Program { code: vec![Instr::Halt], labels: vec![("far".to_string(), 5)] };
        let errs = prog.validate();
        assert!(errs.iter().any(|e| e.contains("far")), "{errs:?}");
        // One past the end is legal — the printer emits it, and a trailing skip target needs it.
        let ok = Program { code: vec![Instr::Halt], labels: vec![("end".to_string(), 1)] };
        assert_eq!(ok.validate(), Vec::<String>::new());
    }
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cargo nextest run -p redextape-core tm::asm::tests::validate
```

Expected: FAIL — `no method named \`validate\` found for struct \`Program\``.

- [ ] **Step 3: Implement `validate`**

In `asm.rs`, inside the existing `impl Program` block beside `label_index`:

```rust
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

        let mut seen: Vec<&str> = Vec::new();
        for (name, at) in &self.labels {
            if !label_name_representable(name) {
                errs.push(format!("label name {name:?} is not representable (empty, or contains whitespace or ; : ,)"));
            }
            if seen.contains(&name.as_str()) {
                errs.push(format!("duplicate label `{name}` (label_index resolves to the first)"));
            } else {
                seen.push(name.as_str());
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
```

and beside `reg_str`:

```rust
/// Whether a label name survives a print-then-parse trip. The rejected set is derived from the
/// format's own separators rather than chosen: whitespace splits a mnemonic from its operands, `,`
/// splits operands, `:` ends a label line, and `;` starts a comment. A name containing any of them
/// prints unquoted and reads back as something else, or as an error.
fn label_name_representable(name: &str) -> bool {
    !name.is_empty() && !name.chars().any(|c| c.is_whitespace() || matches!(c, ';' | ':' | ','))
}
```

- [ ] **Step 4: Run the tests**

```bash
cargo nextest run -p redextape-core asm
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: all seven new tests pass alongside the existing `asm` tests, clippy clean.

If clippy rejects the `if let ... && ...` let-chain, split it into a nested `if let` — edition 2024
allows let-chains, but the toolchain's clippy is the authority, not this plan.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs
git commit -m "asm: Program::validate()

run_asm's lazy faults hoisted, plus two checks with no runtime counterpart: a
duplicate name that label_index silently resolves to the first, and the two
shapes the PRINTER drops silently — a label past the end, and a name carrying
one of the format's own separators.

Vec<String> rather than Vec<Diagnostic> because a Program carries no spans and
one built by lower_asm has no text to point into, which is why
Machine::validate returns strings too. run_asm is unchanged: the two ways to
obtain a Program must behave identically."
```

---

## Task 6: P2 and the three asymmetries

**Files:**
- Modify: `crates/redextape-core/tests/asm_roundtrip.rs`

**Interfaces:**
- Consumes: Task 5's `Program::validate`, Task 4's `lower` helper and `DEMOS`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the tests**

First add these two lines to the import block at the TOP of
`crates/redextape-core/tests/asm_roundtrip.rs`, above the existing `use redextape_core::...` lines —
a module-level `use` placed after items compiles but is not this repo's layout:

```rust
use proptest::prelude::*;
use redextape_test_support::arb_expr_over;
```

`redextape-test-support` is already a dev-dependency of `redextape-core`; no manifest change.

Then append to the same file:

```rust
/// P2's domain, stated as an assertion rather than as prose. Design §3.4 restricts the property to
/// programs that validate and whose labels are index-ordered; `lower_asm` gives both by
/// construction, and this is what checks that claim on every program the property runs over.
fn in_p2_domain(p: &Program) -> bool {
    p.validate().is_empty() && p.labels.windows(2).all(|w| w[0].1 <= w[1].1)
}

/// P2 over the demo corpus. Same programs as P1, opposite direction.
#[test]
fn lowered_programs_survive_print_then_parse() {
    for src in DEMOS {
        let prog = lower(src);
        assert!(in_p2_domain(&prog), "lower_asm produced a program outside P2's domain for {src}");
        let (back, ds) = parse_asm(&print_asm(&prog));
        assert!(ds.is_empty(), "diagnostics for {src}: {ds:?}");
        assert_eq!(back.expect("parses"), prog, "P2 failed for {src}");
    }
}

/// The generator is `redextape_test_support::arb_expr_over`, NOT a local one. Its own doc records
/// why: four independently-drifting copies of this shape once made a claim nothing enforced, and
/// `asm_oracle.rs` still carries one of them. A fifth copy here would be that defect committed
/// again, in the file whose subject is two descriptions of one form agreeing.
///
/// No new `Arbitrary` for `Program` either: `lower_asm`'s image IS P2's domain, so generating source
/// and lowering it produces exactly the programs the property is about, and `in_p2_domain` is what
/// keeps that from being an untested claim.
///
/// **What this generator reaches, and what it does not.** Its arms are `+`, `-` and three `if`
/// shapes, so it exercises `Li`, `Mov`, `Bin`, `Jz`, `Jmp` and `Halt` broadly. It emits no list
/// literal and no `fn`, so `Nil`, `Cons`, `Head`, `Tail`, `IsEmpty` and `Call` reach P2 only through
/// the demo corpus above. Breadth here, coverage there — stated so the split is a design rather than
/// a gap someone finds later.
proptest! {
    #![proptest_config(ProptestConfig { cases: 200, ..ProptestConfig::default() })]

    #[test]
    fn p2_holds_on_random_first_order_programs(
        src in arb_expr_over((0u64..1500).prop_map(|n| n.to_string()))
    ) {
        let (ast, ds) = parse(&src);
        prop_assume!(ds.is_empty());
        let core = desugar(&ast.unwrap());
        let prog = match lower_asm(&core) {
            Ok(p) => p,
            Err(_) => return Ok(()), // Unsupported/TooDeep: outside this property's scope
        };
        prop_assert!(in_p2_domain(&prog), "lower_asm produced a program outside P2's domain");
        let (back, ds) = parse_asm(&print_asm(&prog));
        prop_assert!(ds.is_empty(), "diagnostics: {:?}", ds);
        prop_assert_eq!(back.unwrap(), prog);
    }
}

// ---------------------------------------------------------------------------
// The three asymmetries. Each demonstrates the BOUNDARY of P2's domain — a program just outside it,
// and what the round trip does to it. They are the reason the property is restricted, so they are
// tested as facts rather than left as prose in the design.
// ---------------------------------------------------------------------------

/// §3.1. `print_asm` buckets labels into `code.len() + 1` slots and drops anything past that.
#[test]
fn a_label_past_the_end_is_dropped_by_the_printer() {
    let prog = Program { code: vec![Instr::Halt], labels: vec![("far".to_string(), 5)] };
    assert!(!prog.validate().is_empty(), "validate names it, which is how the loss stops being silent");
    let (back, ds) = parse_asm(&print_asm(&prog));
    assert!(ds.is_empty(), "the printed text is well-formed — that is the problem: {ds:?}");
    assert_eq!(back.expect("parses").labels, Vec::new(), "the label is gone, not relocated");
}

/// §3.2. Order across indices is normalized; order within one index is preserved.
#[test]
fn label_order_is_normalized_across_indices_and_kept_within_one() {
    let prog = Program {
        code: vec![Instr::Halt, Instr::Halt],
        labels: vec![("b".to_string(), 1), ("a2".to_string(), 0), ("a1".to_string(), 0)],
    };
    assert!(prog.validate().is_empty(), "this program is perfectly valid — only its Vec order differs");
    assert!(!in_p2_domain(&prog), "and it is outside P2's domain for exactly that reason");
    let (back, ds) = parse_asm(&print_asm(&prog));
    assert!(ds.is_empty(), "{ds:?}");
    assert_eq!(
        back.expect("parses").labels,
        vec![("a2".to_string(), 0), ("a1".to_string(), 0), ("b".to_string(), 1)],
        "sorted by index; `a2` still precedes `a1` because the printer keeps within-index order"
    );
}

/// §3.3. A name carrying one of the format's own separators cannot survive the trip.
#[test]
fn a_label_name_with_a_space_does_not_survive_the_trip() {
    let prog = Program { code: vec![Instr::Halt], labels: vec![("two words".to_string(), 0)] };
    assert!(!prog.validate().is_empty(), "validate rejects the name before anything prints it");
    let (back, ds) = parse_asm(&print_asm(&prog));
    // The printed line is `two words:` — one token to the parser, which is not what was written.
    let survived = ds.is_empty() && back.is_some_and(|p| p.labels == prog.labels);
    assert!(!survived, "an unrepresentable name must not silently round-trip");
}
```

- [ ] **Step 2: Run the tests**

```bash
cargo nextest run -p redextape-core -E 'binary(asm_roundtrip)'
```

Expected: all pass. Two are worth reading rather than just watching go green:

- `label_order_is_normalized_across_indices_and_kept_within_one` encodes a *prediction* about
  within-index order (`a2` before `a1`). The printer's own comment says that order is load-bearing, so
  this should hold — but if it fails, the printer is the authority: correct the expectation, and note
  it, because the design cites that behaviour.
- `a_label_name_with_a_space_does_not_survive_the_trip` asserts a negative, which pins nothing.
  **Tightening it is required, not optional.** Run it, observe which of the two happens — the parser
  errors, or it reads a *different* name — and replace the `survived` boolean with an assertion on
  that exact outcome. A test whose only claim is "not the good case" passes for reasons that have
  nothing to do with the property, and the review rubric treats it as a defect.

- [ ] **Step 3: Run clippy and the full core suite**

```bash
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run -p redextape-core
```

Expected: clippy clean; the whole `redextape-core` suite green, including `span_wellformed` and
`asm_oracle` unedited — that is the evidence the printer did not move.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/tests/asm_roundtrip.rs
git commit -m "asm: P2 and the three asymmetries that restrict it

P2 runs over lower_asm's image rather than over arbitrary Programs, and
in_p2_domain asserts that domain on every program the property sees rather
than leaving 'lower_asm produces well-formed programs' as a claim in prose.

The three boundary tests are the reason there are two properties instead of
one: a label past the end vanishes, order across indices is normalized while
order within an index survives, and a name carrying a separator does not make
the trip. Each is a program just outside the domain, with what the round trip
actually does to it."
```

---

## Task 7: Retire the four falsified claims

**Files:**
- Modify: `crates/redextape-cli/src/emit.rs`

**Interfaces:**
- Consumes: `redextape_core::tm::parse_asm`.
- Produces: nothing.

`parse_asm` now exists, so four current-tense statements in the tree are false. A tree that ships a
false claim about its own capabilities is the defect the roadmap's last three entries are about.

- [ ] **Step 1: Replace the emitted preamble**

In `crates/redextape-cli/src/emit.rs`, replace the `ASM_PREAMBLE` constant and its doc comment with:

```rust
/// The asm form's emitted header comment. It used to exist to declare that the file could not be
/// read back — `parse_asm` was unclaimed, and ten roadmap entries said so. It now names the command
/// that reads it, because a file that states what opens it is worth more than a bare listing.
const ASM_PREAMBLE: &str = "\
; Register-assembly listing. `redextape` reads this form back with `parse_asm`.
";
```

- [ ] **Step 2: Fix the module doc**

In the same file's module doc, the sentence reading

```
//! `parse_tm_full` and `lambda` through `parse_lambda`. `asm` cannot: `parse_asm` is unclaimed, so
//! nothing — including this program — can read an emitted `.asm` back. That target writes a header
```

becomes

```
//! `parse_tm_full` and `lambda` through `parse_lambda`, and `asm` through `parse_asm`. All three
//! emitted forms read back. The asm target writes a header
```

Read the surrounding sentence before editing and make the result grammatical — the replacement above
covers the two lines that carry the false claim, not necessarily the whole sentence.

- [ ] **Step 3: Fix `Lang::Asm`'s doc**

```rust
    /// The register-machine lowering, read back by `parse_asm`. `redextape run` does not yet take a
    /// `.asm` file — that is the next slice; the form is readable, not yet executable from the
    /// command line.
    Asm,
```

- [ ] **Step 4: Replace the test that asserts the gap**

`emitted_asm_declares_that_it_cannot_be_read_back` asserts a property that is now false. Replace it
with one asserting the property that replaced it — that what `emit` writes is what `parse_asm` reads:

```rust
    /// The asm target's round trip, which this crate could not test until `parse_asm` landed: what
    /// `emit` writes, `parse_asm` reads — preamble comment and all.
    #[test]
    fn emitted_asm_parses_back() {
        let (text, err, outcome) = emit_case("asm", "1 + 2", Lang::Asm, None);
        assert!(err.is_empty(), "no stderr: {err}");
        assert!(matches!(outcome, Outcome::Ran), "emit succeeded");
        let (prog, ds) = redextape_core::tm::parse_asm(&text);
        assert!(ds.is_empty(), "the emitted file parses: {ds:?}");
        assert!(!prog.expect("parses").code.is_empty(), "and it is not empty");
    }
```

`emit_case`'s shape was checked rather than assumed: it is
`fn emit_case(case: &str, src: &str, lang: Lang, encoding: Option<EncodingArg>) -> (String, String, Outcome)`,
returning (stdout, stderr, outcome). Keep the case name `"asm"` — it keys the temp directory, the
test it replaces already used it, and the only other case in this module is `"enc-absent"`, so
there is no collision.

- [ ] **Step 5: Search for any claim this task missed**

```bash
grep -rn 'unclaimed\|cannot be read\|write-only\|read back' crates/ --include='*.rs'
```

Expected: no hit that asserts, in the present tense, that the asm form cannot be read. Hits inside
`docs/` are history and stay. Fix anything else you find here rather than leaving it for review.

- [ ] **Step 6: Run the full suite and clippy**

```bash
cargo nextest run --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

Expected: workspace green, clippy clean, formatting clean.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-cli/src/emit.rs
git commit -m "cli: the asm form is no longer write-only, and four places said it was

ASM_PREAMBLE, the module doc, Lang::Asm's doc, and the test asserting the gap
could never be closed. The preamble now names the function that reads the file
instead of the one that was missing, and the test asserts the round trip it
was written to say was impossible."
```

---

## Task 8: The roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

The roadmap entry is written before the PR opens, per the repo's standing convention. It is a task
here because it is work, and because the figures in it must be measured rather than estimated.

- [ ] **Step 1: Measure every figure the entry will quote**

```bash
git rev-list --count main..HEAD                                    # commits
git log -1 --format=%cs HEAD                                       # branch date
wc -l < crates/redextape-core/src/tm/asm_syntax.rs                 # parser size
cargo nextest run -p redextape-core 2>&1 | tail -3                 # crate suite total
awk '/^#### /{n++} /parse_asm/{h[n]=1} END{for(i=1;i<=n;i++)c+=h[i]; print c}' \
    docs/superpowers/plans/2026-07-19-redextape-roadmap.md         # entries that named it unclaimed
```

- [ ] **Step 2: Write the entry**

Append a `#### ` entry at the end of the roadmap. It must carry:

- What closed: `parse_asm`, after 10 entries naming it unclaimed.
- **The finding that outranks the feature:** `parse(print(p)) == p` is false for an arbitrary
  `Program` in three independent ways, all three found by READING `print_asm_mapped` rather than by
  testing — and two of the three had a code comment already admitting them.
- What the corpus actually covers (Task 4's measured variant count), stated as a limit on P1's
  evidence rather than as a completeness claim.
- **WHAT THIS DID NOT CLOSE:** no CLI path for `.asm` (PR 2), no header (PR 2), no fourth grammar
  (PR 3), `run_asm`'s faults still lazy by design, the printer/parser file split deferred, and
  `"the brief"` references still open.
- **VERIFICATION**, with each figure naming the command that produced it. Per the standing rule in
  this file: name SHAs, never "the branch head". Leave this block uncommitted until a CI run is green
  on a named commit — do not write "CI green" as a prediction.

- [ ] **Step 3: Check the entry's own claims**

```bash
scripts/check-doc-figures.sh
scripts/check-citations.sh
```

Expected: both pass. Then re-read the entry against the tree: every number in it should have a
command beside it, and no sentence should name a relationship ("the largest", "the only", "the branch
head") where a value belongs.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "roadmap: the asm text form gets a reader"
```

---

## Definition of done

- [ ] `cargo nextest run --workspace` green.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` clean.
- [ ] `cargo fmt --all --check` clean.
- [ ] `scripts/check-all.sh` green.
- [ ] `span_wellformed.rs` and `asm_oracle.rs` pass **unedited** — the evidence the printer did not
      move.
- [ ] No present-tense claim anywhere in `crates/` that the asm form cannot be read.
- [ ] The roadmap entry's VERIFICATION block names a commit SHA with a green CI run.
