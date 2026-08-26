# The asm form gets an optional header and a CLI path — PR 2 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an emitted `.asm` file says what type its answer has, and `redextape run prog.asm` executes
it and prints that answer — making emit-then-run the second of the two artifact forms `run` executes,
expressible as two shell commands.

**Architecture:** TM's optionality model, reused whole. `print_asm` stays byte-identical; a new
`print_asm_with` prepends a `result <Ty>` directive; `parse_asm` skips a header if present and
`parse_asm_full` returns it; a header-less file is not an error. The CLI dispatches on the `.asm`
extension exactly as it already does for `.tm`, and **checks for the header before running**, because
without a result type there is nothing that could be printed.

**Tech Stack:** Rust edition 2024, `proptest`, `cargo nextest`, `trycmd`. No new dependencies —
`redextape-core` has none and this adds none.

**Design:** [`../specs/2026-08-24-asm-reader-design.md`](../specs/2026-08-24-asm-reader-design.md).
Read §5 and §6 before starting; §6 carries a correction made on 2026-08-25 that reverses the order of
the header check and the run.

**Prior art to copy rather than reinvent:** `crates/redextape-core/src/tm/syntax.rs` for the header
directive shape, and `crates/redextape-cli/src/run.rs`'s `run_artifact_text` for the `.tm` artifact
path this mirrors.

## Global Constraints

- **Rust edition 2024**, `max_width = 120`, `use_small_heuristics = "Max"` (`rustfmt.toml`).
- **`redextape-core` has zero runtime dependencies** and must build for `wasm32-unknown-unknown`.
  Nothing here adds one.
- **No panics on user input.** `parse_asm_full` and the CLI path are on user-input paths: never panic,
  never recurse, never hang. `clippy.toml`'s allow-*-in-tests reaches a `#[cfg(test)] mod` in `src/`
  but NOT a free helper in a `tests/` target, which carries a file-level `#![allow(...)]`.
- **`clippy::pedantic` is ON with no globally-allowed lint**; `cargo clippy --workspace --all-targets
  -- -D warnings` runs as a pre-commit hook on any staged `.rs`.
- **One commit per task, after the tests are green.** The clippy hook compiles `--all-targets`, so a
  commit holding a test that calls a not-yet-existing function cannot build. TDD still runs test-first
  *within* a task.
- **`scripts/check-citations.sh` rejects `file:line` in tracked source.** Cite symbols by name.
- **`print_asm`'s output bytes do not change.** Every existing caller sees no difference;
  `span_wellformed.rs` and `asm_oracle.rs` must pass unedited. The headered form is a NEW entry point.
- **Exit codes are 0/1/2 only.** `Outcome::Ran`/`Emitted` → 0, `ProgramFailed` → 1 (the input is at
  fault), `ToolFailed` → 2 (this tool could not answer; the program may be perfectly good).
- **The printer/parser file split stays unmade** (design §6). `print_asm_with` goes beside `print_asm`
  in `asm.rs`; header PARSING goes in `asm_syntax.rs`.
- Never `--no-verify`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `crates/redextape-core/src/tm/asm.rs` | **Modify.** `AsmHeader` and `print_asm_with`/`print_asm_with_mapped`, beside `print_asm`. `print_asm`'s own body untouched. |
| `crates/redextape-core/src/tm/asm_syntax.rs` | **Modify.** Header parsing: `parse_asm_full`, directive dispatch, position enforcement. `parse_asm` becomes a thin wrapper. |
| `crates/redextape-core/src/tm.rs` | **Modify.** Re-export `AsmHeader`, `print_asm_with`, `print_asm_with_mapped`, `parse_asm_full`. |
| `crates/redextape-core/tests/asm_roundtrip.rs` | **Modify.** The headered form's round trip, and the optionality properties. |
| `crates/redextape-core/tests/span_wellformed.rs` | **Modify.** Extend the existing asm check to `print_asm_with_mapped`. |
| `crates/redextape-cli/src/emit.rs` | **Modify.** `Lang::Asm` writes a header when the result type is a value type. |
| `crates/redextape-cli/src/run.rs` | **Modify.** `.asm` extension dispatch and `run_asm_artifact`. |
| `crates/redextape-cli/tests/cmd/` | **Modify/Create.** trycmd transcripts for the new behaviour. |

---

## Task 1: `AsmHeader` and the headered printer

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`
- Modify: `crates/redextape-core/src/tm.rs`

**Interfaces:**
- Consumes: `crate::ty::{Ty, show}`, the existing `print_asm_mapped`.
- Produces: `pub struct AsmHeader { pub result: Ty }`,
  `pub fn print_asm_with(prog: &Program, h: &AsmHeader) -> String`,
  `pub fn print_asm_with_mapped(prog: &Program, h: &AsmHeader) -> (String, Classified)`.

- [ ] **Step 1: Write the failing tests**

Append to `asm.rs`'s existing `#[cfg(test)] mod tests`:

```rust
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
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cargo nextest run -p redextape-core --lib -E 'test(asm)'
```

Expected: FAIL — `cannot find struct AsmHeader`. This is a compile error, which is why the commit for
this task comes after Step 4.

- [ ] **Step 3: Implement**

In `asm.rs`, beside `print_asm`:

```rust
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
        listing_spans
            .into_iter()
            .map(|(s, c)| (crate::span::Span { start: s.start + offset, end: s.end + offset }, c)),
    );
    (out, spans)
}
```

`asm.rs` already has `use crate::ty::Ty;` — checked, not assumed — so no import change is needed.

- [ ] **Step 4: Run the tests**

```bash
cargo nextest run -p redextape-core --lib -E 'test(asm)'
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: all four new tests pass alongside the existing `asm` tests, clippy clean.

`Classified` is `Vec<(Span, TokenClass)>` — checked — so the `.map` above destructures it correctly,
and `push_span` is already imported in `asm.rs`.

- [ ] **Step 5: Re-export**

In `crates/redextape-core/src/tm.rs`, add `AsmHeader`, `print_asm_with` and `print_asm_with_mapped` to
the existing `pub use asm::{...}` block, keeping it alphabetical.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/src/tm.rs
git commit -m "asm: an optional result header, and a printer that prepends it

print_asm's bytes do not move: print_asm_with prepends a directive and shifts
the listing's spans by the header's length rather than recomputing them, so
the two halves cannot disagree about where the listing starts.

One directive. TM carries a version because its tape encoding has evolved;
the asm form has had one encoding since it existed, and a field with a single
legal value is one nothing can use."
```

---

## Task 2: `parse_asm_full` reads the header back

**Files:**
- Modify: `crates/redextape-core/src/tm/asm_syntax.rs`
- Modify: `crates/redextape-core/src/tm.rs`

**Interfaces:**
- Consumes: Task 1's `AsmHeader`; the existing `parse_asm` line loop.
- Produces: `pub fn parse_asm_full(src: &str) -> (Option<Program>, Option<AsmHeader>, Vec<Diagnostic>)`.
  `parse_asm` keeps its exact current signature and becomes a wrapper.

- [ ] **Step 1: Write the failing tests**

Append to `asm_syntax.rs`'s `mod tests`:

```rust
    #[test]
    fn a_headered_file_yields_both_halves() {
        let (prog, header, ds) = parse_asm_full("result Nat\n\n    halt\n");
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(header, Some(AsmHeader { result: Ty::Nat }));
        assert_eq!(prog.expect("parses").code, vec![Instr::Halt]);
    }

    /// Optionality property: a header-less file is NOT an error, it simply has no header.
    #[test]
    fn a_header_less_file_is_not_an_error() {
        let (prog, header, ds) = parse_asm_full("    halt\n");
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
        let (prog, header, ds) = parse_asm_full("result Fun\n\n    halt\n");
        assert!(prog.is_none());
        assert_eq!(header, None);
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("value type"), "the message says what is admissible: {}", ds[0].message);
    }

    #[test]
    fn a_duplicate_result_directive_is_an_error() {
        let (_, _, ds) = parse_asm_full("result Nat\nresult Bool\n\n    halt\n");
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("duplicate"), "{}", ds[0].message);
    }

    /// Mirrors `header_position` on the TM side: a directive after the body is rejected, so a file
    /// written today cannot be broken by a later, stricter reader.
    #[test]
    fn a_directive_after_the_first_instruction_is_rejected() {
        let (_, _, ds) = parse_asm_full("    halt\nresult Nat\n");
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("precede"), "{}", ds[0].message);
    }

    /// A label counts as body, not header — the same rule, checked on the other line kind.
    #[test]
    fn a_directive_after_the_first_label_is_rejected() {
        let (_, _, ds) = parse_asm_full("f:\nresult Nat\n    halt\n");
        assert_eq!(ds.len(), 1, "{ds:?}");
        assert!(ds[0].message.contains("precede"), "{}", ds[0].message);
    }
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cargo nextest run -p redextape-core --lib -E 'test(asm_syntax)'
```

Expected: FAIL — `cannot find function parse_asm_full`.

- [ ] **Step 3: Implement**

In `asm_syntax.rs`, rename the existing `parse_asm` body into `parse_asm_full`, add header handling to
its line loop, and leave `parse_asm` as a wrapper. The header dispatch goes immediately after the
comment-strip and empty-line `continue`, BEFORE the label check:

```rust
        if let Some(rest) = text.strip_prefix("result") {
            // `result` is a directive only when a separator follows. Without this, a label named
            // `resultset:` would be read as a malformed directive rather than the label it is.
            if rest.starts_with(char::is_whitespace) || rest.is_empty() {
                if !code.is_empty() || !labels.is_empty() {
                    diags.push(Diagnostic::error(
                        span,
                        "`result` must precede the first instruction or label (header directives come first)",
                    ));
                } else if header.is_some() {
                    diags.push(Diagnostic::error(span, "duplicate `result` directive"));
                } else if let Some(t) = crate::ty::parse_ty(rest.trim()) {
                    header = Some(AsmHeader { result: t });
                } else {
                    diags.push(Diagnostic::error(
                        span,
                        format!(
                            "`result` must be a value type (Nat | Bool | Unit | List<T>), found `{}`",
                            rest.trim()
                        ),
                    ));
                }
                continue;
            }
        }
```

Declare `let mut header: Option<AsmHeader> = None;` beside the other accumulators, return it in the
tuple, and give the wrapper:

```rust
/// Parse the register-assembly text form, dropping any header.
///
/// A thin wrapper over `parse_asm_full` rather than a second parser, for the reason `parse_tm` states
/// about its own: this function MUST learn to skip directives regardless — otherwise a file carrying
/// one hits the unknown-mnemonic path and is rejected — and once it must change anyway, delegating
/// removes the failure mode where two parsers drift.
#[must_use]
pub fn parse_asm(src: &str) -> (Option<Program>, Vec<Diagnostic>) {
    let (prog, _, ds) = parse_asm_full(src);
    (prog, ds)
}
```

`parse_asm_full` keeps the existing rule that any diagnostic means `None` for the program; make it
return `None` for the header too in that case, which the `Fun` test above pins.

- [ ] **Step 4: Run the tests**

```bash
cargo nextest run -p redextape-core --lib -E 'test(asm_syntax)'
cargo nextest run -p redextape-core
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: the seven new tests pass, every pre-existing `asm_syntax` test still passes unedited (that
is the evidence `parse_asm`'s contract did not move), clippy clean.

- [ ] **Step 5: Re-export and commit**

Add `parse_asm_full` to `tm.rs`'s `pub use asm_syntax::{...}`.

```bash
git add crates/redextape-core/src/tm/asm_syntax.rs crates/redextape-core/src/tm.rs
git commit -m "asm: parse_asm_full reads the header, parse_asm drops it

parse_asm delegates rather than duplicating: it has to learn to skip
directives regardless, or a headered file hits the unknown-mnemonic path and
is rejected. Once it must change anyway, delegating removes the drift.

A directive after the first instruction or label is rejected, mirroring the
TM reader -- the printer emits them in position unconditionally, so no file
this project writes is affected and the gap closes while that is still true."
```

---

## Task 3: The headered form's round trip, and span well-formedness

**Files:**
- Modify: `crates/redextape-core/tests/asm_roundtrip.rs`
- Modify: `crates/redextape-core/tests/span_wellformed.rs`

**Interfaces:**
- Consumes: `parse_asm_full`, `print_asm_with`, `print_asm_with_mapped`, `AsmHeader`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the tests**

Append to `crates/redextape-core/tests/asm_roundtrip.rs` (add `AsmHeader`, `parse_asm_full`,
`print_asm_with` and `redextape_core::ty::Ty` to the import block at the TOP of the file):

```rust
/// P1 for the headered form: what `print_asm_with` writes reads back to identical text.
#[test]
fn headered_text_reads_back_to_identical_text() {
    for src in DEMOS {
        let prog = lower(src);
        let h = AsmHeader { result: Ty::Nat };
        let text = print_asm_with(&prog, &h);
        let (back, header, ds) = parse_asm_full(&text);
        assert!(ds.is_empty(), "diagnostics for {src}: {ds:?}");
        assert_eq!(header, Some(h.clone()), "the header survives for {src}");
        assert_eq!(print_asm_with(&back.expect("parses"), &h), text, "headered P1 failed for {src}");
    }
}

/// Every result type the header admits must survive the trip, not just the common one.
#[test]
fn every_admissible_result_type_round_trips() {
    let prog = lower("1 + 2");
    for ty in [Ty::Nat, Ty::Bool, Ty::Unit, Ty::List(Box::new(Ty::Nat)), Ty::List(Box::new(Ty::List(Box::new(Ty::Bool))))]
    {
        let h = AsmHeader { result: ty.clone() };
        let (_, header, ds) = parse_asm_full(&print_asm_with(&prog, &h));
        assert!(ds.is_empty(), "{ty:?}: {ds:?}");
        assert_eq!(header, Some(h), "{ty:?} did not survive");
    }
}

/// The optionality property design §5 rests on: the same bytes, read two ways, give the same program.
#[test]
fn a_header_changes_the_program_not_at_all() {
    for src in DEMOS {
        let prog = lower(src);
        let bare = parse_asm(&print_asm(&prog)).0.expect("bare parses");
        let with = parse_asm(&print_asm_with(&prog, &AsmHeader { result: Ty::Nat })).0.expect("headered parses");
        assert_eq!(bare, with, "the header must not perturb the program for {src}");
    }
}
```

Then extend `crates/redextape-core/tests/span_wellformed.rs`. Read its existing asm block first — it
calls `print_asm_mapped` and checks the produced spans. Add the headered entry point to the same
checks, so the new printer is held to the identical contract:

```rust
        let (aht, ahs) = print_asm_with_mapped(&prog, &AsmHeader { result: Ty::Nat });
        check(&aht, &ahs, &format!("asm+header {src:?}"));
```

placed immediately after the existing `check(&at, &asm_spans, ...)` call, and add `AsmHeader` and
`print_asm_with_mapped` to that file's `use redextape_core::tm::{...}` list (`Ty` is already imported).

**There is direct precedent in this same file, and it is worth reading before you add yours.** The
headered TM form was added to this loop for the identical reason, and its comment says why: until it
was, `print_tm_with_mapped`'s extra spans had their "coverage, ordering and bounds unproven while
every other printer's were pinned". The asm header is now the last printer entry point in that
position. Match the shape of that block, including a comment saying what the new call covers that the
bare one does not.

- [ ] **Step 2: Run the tests**

```bash
cargo nextest run -p redextape-core -E 'binary(asm_roundtrip)'
cargo nextest run -p redextape-core -E 'binary(span_wellformed)'
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: all pass. **If `headered_text_reads_back_to_identical_text` fails, suspect the blank line
between header and listing** — it must be produced by the printer and consumed by the reader's
empty-line `continue`, and a mismatch there shows up as a one-byte text difference.

- [ ] **Step 3: Commit**

```bash
git add crates/redextape-core/tests/asm_roundtrip.rs crates/redextape-core/tests/span_wellformed.rs
git commit -m "asm: the headered form round-trips, and its spans are well-formed

P1 again over the new entry point, every admissible result type through the
trip rather than just Nat, and the optionality property stated as a test: the
same program read with and without a header is the same program.

span_wellformed now covers print_asm_with_mapped, so the shifted listing
offsets are held to the same contract as the unshifted ones."
```

---

## Task 4: `emit --lang asm` writes the header

**Files:**
- Modify: `crates/redextape-cli/src/emit.rs`
- Modify: `crates/redextape-cli/tests/cmd/emit_asm.stdout`

**Interfaces:**
- Consumes: `print_asm_with`, `AsmHeader`.
- Produces: an emitted `.asm` that `run` (Task 5) can execute.

**A decision this task makes, stated because the design does not cover it.** `emit`'s common path
already computes `ty` via `typeck::result_type`, and the `Lang::Asm` arm currently ignores it. That
type may be one no `result` directive can express. **`--lang asm` writes a header when the type is a
value type and omits it otherwise, rather than refusing.**

**CORRECTED 2026-08-25, during this task, and the correction is about which case is REACHABLE.** This
paragraph first said the inexpressible case is a program "whose value is a function" — `Ty::Fun`. It
is not, because such a program never gets this far: `lower_asm` refuses it outright with
`LowerError::Unsupported { what: "function used as a value" }`, so `--lang asm` exits before any
header question arises. Five fixtures were tried before this was traced to the lowering rather than
guessed at. **The reachable inexpressible case is `Ty::Var`** — an unresolved type variable, which
the empty list `[]` produces. The decision is unchanged and the code is unchanged; what was wrong was
the example given for it, and an example that cannot occur is worth less than none.

Refusing would be a capability regression: PR 1 established `--lang asm` as a form you emit *to
read*, and a listing is just as readable for a function-typed program. The omission is exactly what
the optional model buys, and `run` then declines that file for the reason that is actually
true — its answer cannot be named.

- [ ] **Step 1: Write the failing tests**

Append to `emit.rs`'s `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn emitted_asm_carries_a_result_header() {
        let (text, err, outcome) = emit_case("asm", "1 + 2", Lang::Asm, None);
        assert!(err.is_empty(), "no stderr: {err}");
        assert!(matches!(outcome, Outcome::Emitted));
        assert!(text.contains("result Nat"), "the header names the result type:\n{text}");
        let (prog, header, ds) = redextape_core::tm::parse_asm_full(&text);
        assert!(ds.is_empty(), "the emitted file parses: {ds:?}");
        assert_eq!(header.map(|h| h.result), Some(redextape_core::ty::Ty::Nat));
        assert!(!prog.expect("parses").code.is_empty());
    }

    /// A function-typed program has no expressible result type. It still emits — a listing is
    /// readable regardless — just without a header.
    #[test]
    fn a_function_typed_program_emits_asm_without_a_header() {
        let (text, err, outcome) = emit_case("asm-fn", "|x| x + 1", Lang::Asm, None);
        assert!(matches!(outcome, Outcome::Emitted), "emitting a listing does not require a result type: {err}");
        let (_, header, ds) = redextape_core::tm::parse_asm_full(&text);
        assert!(ds.is_empty(), "{ds:?}");
        assert_eq!(header, None, "no header, because no value type could be written");
    }
```

- [ ] **Step 2: Run them to watch them fail**

```bash
cargo nextest run --bin redextape -E 'test(emitted_asm) + test(function_typed)'
```

Expected: FAIL — the emitted text has no `result` line.

**If `"|x| x + 1"` does not lower to asm at all** (rather than lowering with a `Fun` result type), the
second test needs a different fixture: find one whose `result_type` is `Fun` but which `lower_asm`
accepts, and say in your report which you used and why.

- [ ] **Step 3: Implement**

Replace the `Lang::Asm` arm:

```rust
        Lang::Asm => match redextape_core::tm::lower_asm(&core) {
            // A header only when the result type is one the directive can express. `parse_ty` admits
            // exactly Nat/Bool/Unit/List<T>, and `AsmHeader` must not carry anything it would reject
            // — a file whose own reader refuses its header is worse than one with no header at all.
            Ok(prog) => {
                let header = redextape_core::ty::parse_ty(&redextape_core::ty::show(&ty))
                    .map(|result| redextape_core::tm::AsmHeader { result });
                let listing = match &header {
                    Some(h) => redextape_core::tm::print_asm_with(&prog, h),
                    None => redextape_core::tm::print_asm(&prog),
                };
                format!("{ASM_PREAMBLE}{listing}")
            }
            Err(e) => {
                writeln!(err, "error: this program has no asm lowering: {e:?}")?;
                return Ok(Outcome::ToolFailed);
            }
        },
```

**The `parse_ty(show(ty))` round trip is the admissibility test, deliberately.** It asks the reader
whether it would accept what the writer is about to produce, rather than restating the value-type rule
in a second place where it could drift. If you prefer a direct `matches!` on `Ty`, do NOT — that is
the second-description-of-one-rule failure this project treats as a defect.

- [ ] **Step 4: Regenerate the transcript and confirm it is header-only**

```bash
TRYCMD=overwrite cargo nextest run --bin redextape -E 'binary(cli)'
git diff -- crates/redextape-cli/tests/cmd/emit_asm.stdout
```

Expected: exactly one added `result Nat` line plus the blank line. **Read the diff — if any instruction
line moved, `print_asm`'s bytes changed and that is a stop.**

- [ ] **Step 5: Run everything and commit**

```bash
cargo nextest run --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

```bash
git add crates/redextape-cli/src/emit.rs crates/redextape-cli/tests/cmd/emit_asm.stdout
git commit -m "cli: emit --lang asm writes a result header when one can be written

The admissibility test is parse_ty(show(ty)) -- asking the reader whether it
would accept what the writer is about to produce, rather than restating the
value-type rule somewhere it could drift from ty::parse_ty.

A function-typed program still emits, without a header. Refusing would be a
capability regression: --lang asm exists to be READ, and a listing is readable
whatever its result type. The omission is what the optional model buys."
```

---

## Task 5: `redextape run prog.asm`

**Files:**
- Modify: `crates/redextape-cli/src/run.rs`
- Create: `crates/redextape-cli/tests/cmd/run_asm.toml` and `.stdout`
- Modify: `crates/redextape-cli/tests/roundtrip.rs`

**Interfaces:**
- Consumes: `parse_asm_full`, `Program::validate`, `run_asm`, `DEFAULT_CAPS`, `decode_asm_ty`.
- Produces: the `.asm` artifact path. No signature change to `run`.

**Order matters and the design corrected itself about it:** parse → validate → **header check** → run
→ decode. The header check precedes the run because without a `result` type there is nothing that
could be printed, so running first spends up to `DEFAULT_CAPS.steps` (5,000,000) to reach a value the
tool must then decline to name.

- [ ] **Step 1: Write the failing tests**

Append to `run.rs`'s `#[cfg(test)] mod tests`, following the shape of the existing `.tm` artifact
tests in that module:

```rust
    #[test]
    fn an_asm_artifact_runs_and_prints_its_value() {
        let (out, err, outcome) = run_case("asm-ok", "p.asm", "result Nat\n\n    li\trr, #7\n    halt\n", Backend::Reference);
        assert!(err.is_empty(), "no stderr: {err}");
        assert!(matches!(outcome, Outcome::Ran));
        assert_eq!(out.trim(), "7");
    }

    #[test]
    fn a_header_less_asm_artifact_is_refused_before_it_runs() {
        let (out, err, outcome) = run_case("asm-nohdr", "p.asm", "    li\trr, #7\n    halt\n", Backend::Reference);
        assert!(out.is_empty(), "nothing is printed: {out}");
        assert!(matches!(outcome, Outcome::ToolFailed), "exit 2 — the tool cannot answer");
        assert!(err.contains("result"), "the message names what is missing: {err}");
        assert!(err.contains("emit --lang asm"), "and how to get one: {err}");
    }

    #[test]
    fn backend_does_not_apply_to_an_asm_artifact() {
        let (_, err, outcome) = run_case("asm-backend", "p.asm", "result Nat\n\n    halt\n", Backend::Lambda);
        assert!(matches!(outcome, Outcome::ToolFailed));
        assert!(err.contains("--backend"), "{err}");
    }

    #[test]
    fn an_invalid_asm_artifact_reports_validation_rather_than_running() {
        let (_, err, outcome) = run_case("asm-bad", "p.asm", "result Nat\n\n    jmp\tnowhere\n", Backend::Reference);
        assert!(matches!(outcome, Outcome::ProgramFailed), "the FILE is at fault: exit 1");
        assert!(err.contains("nowhere"), "the message names the undefined label: {err}");
    }
```

`run_case` is the existing helper in that module, and its signature is
`fn run_case(case: &str, filename: &str, src: &str, backend: Backend) -> (String, String, Outcome)`.
**The `filename` argument is the one that matters here** — it is what gives the temp file its
extension, and therefore what drives the dispatch these tests exercise. Passing `"p.asm"` is the whole
mechanism; a `.rxt` name would send the fixture down the source path and the test would assert
nothing. The `case` string keys the temp directory (a fix from an earlier slice, where four tests
shared one directory keyed only by process id and raced), so the four case names above must stay
unique within the module.

- [ ] **Step 2: Run them to watch them fail**

```bash
cargo nextest run --bin redextape -E 'test(asm)'
```

Expected: FAIL — `.asm` falls through to the `.rxt` lexer and produces parse errors.

- [ ] **Step 3: Implement**

Widen the artifact dispatch. The existing check tests one extension; make it name which:

```rust
    // ASCII-case-insensitive, because `M.TM` is a real artifact and a byte-for-byte `e == "tm"` sent
    // it down the `.rxt` path, where the lexer produced a cascade of errors and exit 1 blamed a
    // perfectly valid file on the program.
    let artifact = match input {
        Input::Path(p) => p.extension().and_then(|e| {
            let e = e.to_string_lossy().to_ascii_lowercase();
            match e.as_str() {
                "tm" => Some(Artifact::Tm),
                "asm" => Some(Artifact::Asm),
                _ => None,
            }
        }),
        Input::Stdin => None,
    };
    if let Some(kind) = artifact {
        if backend != Backend::Reference {
            let noun = match kind {
                Artifact::Tm => "a `.tm` file, which is already a machine",
                Artifact::Asm => "a `.asm` file, which is already a program",
            };
            writeln!(err, "error: `--backend` does not apply to {noun}")?;
            return Ok(Outcome::ToolFailed);
        }
        return match kind {
            Artifact::Tm => run_artifact_text(&src, &label, out, err, color),
            Artifact::Asm => run_asm_artifact(&src, &label, out, err, color),
        };
    }
```

with, beside `Backend`:

```rust
/// Which already-compiled form a path names. A source file is neither.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Artifact {
    Tm,
    Asm,
}
```

and the new runner:

```rust
/// Run a `.asm` artifact: parse, validate, require a header, execute, decode.
///
/// **The header check precedes the run, and the ordering is the interesting part.** A header-less
/// `.tm` has nothing to RUN — its header carries the initial tapes — so refusing early is forced
/// there. A header-less `.asm` is fully runnable; what it lacks is a way to NAME its answer. Running
/// first would spend up to `DEFAULT_CAPS.steps` reaching a value this function must then decline to
/// print, so the check moves ahead of the work it would waste.
fn run_asm_artifact(
    src: &str,
    label: &str,
    out: &mut impl std::io::Write,
    err: &mut impl std::io::Write,
    color: bool,
) -> std::io::Result<Outcome> {
    let (program, header, ds) = redextape_core::tm::parse_asm_full(src);
    if !ds.is_empty() {
        report::render(err, label, src, &ds, color)?;
        return Ok(Outcome::ProgramFailed);
    }
    let Some(program) = program else {
        writeln!(err, "error: `{label}` carries no program")?;
        return Ok(Outcome::ProgramFailed);
    };
    let errs = program.validate();
    if !errs.is_empty() {
        for e in &errs {
            writeln!(err, "error: `{label}`: {e}")?;
        }
        return Ok(Outcome::ProgramFailed);
    }
    let Some(header) = header else {
        writeln!(
            err,
            "error: `{label}` has no `result` directive\n  \
             the listing is a valid program and would run, but nothing declares the type of its \
             answer, so there is no way to print one\n  \
             re-emit it with `redextape emit --lang asm`, which writes a header whenever the \
             program's result type can be expressed"
        )?;
        return Ok(Outcome::ToolFailed);
    };
    match redextape_core::tm::run_asm(&program, redextape_core::tm::DEFAULT_CAPS) {
        redextape_core::tm::AsmRun::Ran(outcome) => {
            match redextape_core::tm::decode_asm_ty(&outcome, &header.result) {
                Some(v) => {
                    writeln!(out, "{}", redextape_core::value::format_value(&v))?;
                    Ok(Outcome::Ran)
                }
                None => {
                    writeln!(
                        err,
                        "error: `{label}` ran, but its result does not decode as `{}`",
                        redextape_core::ty::show(&header.result)
                    )?;
                    Ok(Outcome::ToolFailed)
                }
            }
        }
        redextape_core::tm::AsmRun::HitCap => {
            writeln!(err, "error: `{label}` did not halt within the default step, stack or heap budget")?;
            Ok(Outcome::ProgramFailed)
        }
        redextape_core::tm::AsmRun::Fault(m) => {
            writeln!(err, "error: `{label}` faulted: {m}")?;
            Ok(Outcome::ProgramFailed)
        }
    }
}
```

**On the parallel with `run_artifact_text`, which is deliberate and not shared.** The two runners
have the same shape — parse, reject diagnostics, unwrap, require a header, execute, decode — and about
ten lines of that preamble read alike. They are NOT factored together: `parse_tm_full` and
`parse_asm_full` return different types, `simulate` and `run_asm` have different outcome shapes, and
`TmHeader` carries four fields where `AsmHeader` carries one. A shared helper would have to abstract
over two functions agreeing on nothing but their arity, to save ten lines that will diverge further
when either form gains a directive. If a reviewer reads this as duplication, that is a judgement worth
having rather than one to pre-empt — say so and it gets decided.

**Note what this cannot get wrong, and do not add a guard for it:** `AsmOutcome` lives *inside*
`AsmRun::Ran`, so a capped run has no outcome to decode. The `.tm` path once printed a value for a
run that never finished because `simulate` returned tapes and status separately; here the type makes
that unrepresentable.

- [ ] **Step 4: Run the tests**

```bash
cargo nextest run --bin redextape -E 'test(asm)'
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: the four new tests pass; the existing `.tm` artifact tests pass unedited, which is the
evidence the widened dispatch did not disturb them.

- [ ] **Step 5: Add the end-to-end transcript**

`crates/redextape-cli/tests/roundtrip.rs` already shells out to the real binary for the `.tm`
emit-then-run pair. Read it, then add the `.asm` equivalent alongside: emit `[1, 2, 3]` to a `.asm`,
run it back, assert the output matches the reference. That pair is the second of the two artifact
forms `run` executes, which this PR exists to make expressible.

Also add a `trycmd` case pinning the header-less refusal, following the naming of the existing
`tests/cmd/*.toml` files.

- [ ] **Step 6: Run everything and commit**

```bash
cargo nextest run --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
scripts/check-citations.sh
```

```bash
git add crates/redextape-cli/src/run.rs crates/redextape-cli/tests/
git commit -m "cli: run prog.asm executes an emitted listing and prints its value

Parse, validate, require a header, run, decode -- and the header check comes
BEFORE the run. A header-less .tm has nothing to run; a header-less .asm runs
fine and merely cannot name its answer, so checking first saves up to five
million steps spent reaching a value that could never be printed.

emit then run is now the oracle as two shell commands for a third form."
```

---

## Task 6: The roadmap entry

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

The entry is written before the PR opens, per this repo's standing convention.

- [ ] **Step 1: Measure every figure the entry will quote**

```bash
git rev-list --count main..HEAD
git log -1 --format=%cs HEAD
wc -l < crates/redextape-core/src/tm/asm_syntax.rs
wc -l < crates/redextape-core/src/tm/asm.rs
cargo nextest run --workspace 2>&1 | tail -3
cargo nextest run -p redextape-cli 2>&1 | tail -1
```

**Re-measure at the branch's LAST CODE COMMIT, not partway through.** PR 1's entry was written early,
its range stopped short of the whole-branch review's fixes, and it understated the branch by three
commits and two tests until it was re-measured.

- [ ] **Step 2: Write the entry**

Append a `#### ` entry at the end. Read the last two entries first and match their voice and rigour.
It must carry:

- What closed: the optional header and the `.asm` CLI path; PR 2 of 3.
- **The ordering decision and why it reverses intuition**: a header-less `.tm` has nothing to run, a
  header-less `.asm` runs fine and merely cannot be named. Same refusal, different reason. The design
  said run-then-refuse and was corrected before this was planned.
- **What the type system made unnecessary**: `AsmOutcome` lives inside `AsmRun::Ran`, so the capped-run
  bug PR #58 fixed for `.tm` — a run that never finished printing a value at exit 0 — cannot be
  written here.
- The `parse_ty(show(ty))` admissibility test, and why it is not a second `matches!` on `Ty`.
- That the reachable inexpressible case is `Ty::Var`, from the empty list `[]`, not a function-typed
  program — `lower_asm` refuses a function used as a value before any header question arises.
- **WHAT THIS DID NOT CLOSE:** no fourth tree-sitter grammar (PR 3, and it needs this PR's headered
  form); the printer/parser file split still unmade; `"the brief"` references; `version` deliberately
  excluded and the condition under which it would be earned.
- **VERIFICATION**, every figure naming its command. Name SHAs, never "the branch head". Leave the CI
  line as a single clearly-marked `<FILL:` placeholder — filled after a green run and before merge,
  never written as a prediction.

- [ ] **Step 3: Check the entry's own claims**

```bash
scripts/check-doc-figures.sh
scripts/check-citations.sh
```

Then re-read it: every number beside a command, and no sentence naming a relationship where a value
belongs. **Re-read WHAT THIS DID NOT CLOSE against the tree as it now stands** — PR 1's version of
that section went false before merge because a later fix round closed an item and nobody re-read the
sentence.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "roadmap: the asm form gets a header and a CLI path"
```

---

## Definition of done

- [ ] `cargo nextest run --workspace` green.
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` clean.
- [ ] `cargo fmt --all --check` clean.
- [ ] `scripts/check-all.sh` green.
- [ ] `span_wellformed.rs`'s pre-existing checks and `asm_oracle.rs` pass **unedited** — the evidence
      `print_asm` did not move.
- [ ] `redextape emit --lang asm -o p.asm` then `redextape run p.asm` prints the same value as
      `redextape run p.rxt`, run by hand and recorded in the entry.
- [ ] The roadmap entry's VERIFICATION names a commit SHA with a green CI run, and
      `grep '<FILL:' docs/superpowers/plans/2026-07-19-redextape-roadmap.md` is empty.
