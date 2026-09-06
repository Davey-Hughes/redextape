//! Which of the CLI's three text forms an input is, and nothing about what to do with one.
//!
//! **THIS MODULE ANSWERS IDENTITY, NOT BEHAVIOUR.** The formatting dispatch lives in `fmt.rs` and
//! the running dispatch in `run.rs`; keeping printers out of here is what lets `run` — a command
//! that never prints a program back — depend on it.
//!
//! **AND IT EXISTS SO THE EXTENSION TABLE IS WRITTEN ONCE.** `run` had the only copy; `fmt` needs
//! the same knowledge, and two copies of "which extension means what" is the drift this repository
//! treats as a defect rather than a style question.

use std::path::Path;

use crate::input::Input;

/// One of the three text forms `redextape` reads from a file.
///
/// `Rxt` is the source language; `Tm` and `Asm` are compiled output that the toolchain can also
/// read back. **A total three-way answer, and both commands hold one.** `fmt` formats all three;
/// `run` executes the two artifact forms and hands the third to a backend. Neither carries an
/// `Option<Form>` past the point where the extension is read — the `None` collapses into `Rxt`
/// there — so "is this compiled output" is `is_artifact` in both, and not `Option::is_some` in one
/// of them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum Form {
    /// The source language, `.rxt`. The default when nothing else identifies the input.
    #[default]
    Rxt,
    /// A Turing machine listing, `.tm`.
    Tm,
    /// A register-assembly listing, `.asm`.
    Asm,
}

impl Form {
    /// The form a path's extension names, or `None` for anything else.
    ///
    /// **ASCII-case-insensitive, and that is not decoration.** `M.TM` is a real artifact; a
    /// byte-for-byte comparison sends it down the `.rxt` path where the lexer produces a cascade of
    /// errors blaming a perfectly valid file on the program. `run.rs` paid that once already.
    ///
    /// `.rxt` is deliberately absent: it is the fallback both callers apply to this `None` —
    /// `resolve`, and `run`'s own path arm — not an entry here, so that "this extension names an
    /// artifact" and "this is the default" stay two different answers.
    #[must_use]
    pub fn from_extension(path: &Path) -> Option<Form> {
        let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
        match ext.as_str() {
            "tm" => Some(Form::Tm),
            "asm" => Some(Form::Asm),
            _ => None,
        }
    }

    /// Whether this form is already-compiled output rather than source.
    ///
    /// `run` uses it to refuse `--backend`, which is meaningless for a file that is already a
    /// machine or a program; `fmt` uses it the same way to refuse an explicit `--width`, which
    /// those two printers ignore because they lay out from their own content.
    #[must_use]
    pub fn is_artifact(self) -> bool {
        match self {
            Form::Tm | Form::Asm => true,
            Form::Rxt => false,
        }
    }

    /// Which form this content is, judged by asking the real front ends — or `None` when none of
    /// them claims it.
    ///
    /// **THERE IS NO PATTERN HERE, AND THAT IS THE POINT.** `plugin/redextape.lua` sniffs `.tm` and
    /// `.asm` buffers by content too, and a second pattern set in Rust would be one rule in two
    /// languages that no gate could hold in step — the two have different inputs (sixty buffer lines
    /// against whole stdin) and different fallbacks (a path test against none). Trial parsing has no
    /// rule to duplicate: the parser IS the definition of the language.
    ///
    /// **A PATTERN RULE COULD NOT HAVE BEEN WRITTEN CORRECTLY ANYWAY.** The obvious asm signal, the
    /// `result <Type>` line, is optional — a checked-in fixture `run_asm` exercises is two indented
    /// mnemonics with no header, no `result` and no label.
    ///
    /// **The payload is the test, not an empty diagnostics list.** Both document types define the
    /// payload as `None` exactly when an error was reported, so the two agree on every input today
    /// — neither parser emits a warning at all. They stop agreeing the moment one does, and a
    /// sniffer keyed to emptiness would then refuse a machine that parsed fine and merely warned.
    #[must_use]
    pub fn sniff(src: &str) -> Option<Form> {
        // The one ambiguity the matrix found: an empty or whitespace-only file is accepted by the
        // asm parser AND by `.rxt`. There is nothing to format either way, so the guard costs
        // nothing and removes the only case a precedence rule would have to arbitrate.
        if src.trim().is_empty() {
            return None;
        }
        if redextape_core::tm::parse_tm_full(src).machine.is_some() {
            return Some(Form::Tm);
        }
        if redextape_core::tm::parse_asm_full(src).program.is_some() {
            return Some(Form::Asm);
        }
        None
    }

    /// Which form to treat this input as.
    ///
    /// The precedence, and the reason for each step:
    ///
    /// 1. `explicit` — a `--form` the user passed. It wins over a contradicting extension, because
    ///    overriding the filename is what the flag is for.
    /// 2. The path's extension.
    /// 3. For stdin only, the content (`sniff`).
    /// 4. `Rxt`.
    ///
    /// **SNIFFING IS STDIN-ONLY, AND THAT IS A SAFETY PROPERTY.** A path with an extension has
    /// already answered the question. Restricting content inspection to the one input that carries
    /// no extension is what makes "a `.rxt` file silently reformatted as a machine" impossible
    /// rather than merely unlikely.
    #[must_use]
    pub fn resolve(input: &Input, explicit: Option<Form>, src: &str) -> Form {
        if let Some(form) = explicit {
            return form;
        }
        match input {
            Input::Path(p) => Form::from_extension(p).unwrap_or(Form::Rxt),
            Input::Stdin => Form::sniff(src).unwrap_or(Form::Rxt),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    /// Parses clean. Printing it changes it (one space becomes two before the trailing comment),
    /// which is what lets a test tell formatting apart from a passthrough.
    const TM_IN: &str = "; a machine\ntapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1 ; and a trailing one\nstate q1: accept\n";

    /// `TM_IN`'s printed form, byte-exact. Formatting THIS is a no-op — the idempotence fixture.
    const TM_OUT: &str = "; a machine\ntapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1  ; and a trailing one\nstate q1: accept\n";

    /// Parses clean. Printing it inserts a blank line after `result Nat` and doubles the spaces
    /// before each trailing comment. Note the literal tab after `li`.
    const ASM_IN: &str = "; a program\nresult Nat\nf: ; the entry\n    li\tr0, #1 ; and a trailing one\n    ret\n";

    /// `ASM_IN`'s printed form, byte-exact. The idempotence fixture.
    const ASM_OUT: &str = "; a program\nresult Nat\n\nf:  ; the entry\n    li\tr0, #1  ; and a trailing one\n    ret\n";

    // DERIVED from design §4.1's matrix, measured against the real front ends before this plan was
    // written — not a copy of it, and the two lists being twelve rows each is a coincidence that
    // hid the difference. Three of §4.1's rows have no counterpart here: a comment-free minimal tm,
    // `42` and `x`. Three rows here have none there: `TM_OUT`, `ASM_IN` and `ASM_OUT`, the printed
    // and round-trip fixtures the rest of this module reads, which pin that a printer's own output
    // sniffs back as the form it came from. Each row is (input, what sniff must answer).
    const MATRIX: &[(&str, Option<Form>)] = &[
        // Both degenerate rows are accepted by the asm parser AND by `.rxt`. They are the only
        // ambiguity in the matrix, and the emptiness guard is why they resolve here rather than
        // through a precedence rule invented for a file with nothing in it.
        ("", None),
        ("   \n\n  \n", None),
        ("; just a comment\n", Some(Form::Asm)),
        ("    li\trr, #7\n    halt\n", Some(Form::Asm)),
        ("result Nat\n    li\trr, #7\n    halt\n", Some(Form::Asm)),
        (TM_IN, Some(Form::Tm)),
        (TM_OUT, Some(Form::Tm)),
        (ASM_IN, Some(Form::Asm)),
        (ASM_OUT, Some(Form::Asm)),
        // Accepted by no front end at all, so the caller falls back to `.rxt` and the user gets a
        // real `.rxt` diagnostic rather than a shrug.
        ("let f = \\x. x; f 1", None),
        ("let   x=1;\nx+1", None),
        ("[1, 2, 3]", None),
    ];

    #[test]
    fn sniff_answers_every_measured_row() {
        for (src, expected) in MATRIX {
            assert_eq!(Form::sniff(src), *expected, "sniffing {src:?}");
        }
    }

    #[test]
    fn tm_and_asm_never_both_accept() {
        // They LOOK disjoint — a TM's `tapes <n>` is an unknown mnemonic to the asm parser — and
        // "looks disjoint" is a claim. This pins it over every row, so a grammar change that made
        // them overlap would redden here rather than silently making `sniff` order-dependent.
        for (src, _) in MATRIX {
            let tm = redextape_core::tm::parse_tm_full(src).machine.is_some();
            let asm = redextape_core::tm::parse_asm_full(src).program.is_some();
            assert!(!(tm && asm), "both front ends accepted {src:?}");
        }
    }

    #[test]
    fn the_extension_table_is_case_insensitive() {
        assert_eq!(Form::from_extension(Path::new("p.tm")), Some(Form::Tm));
        assert_eq!(Form::from_extension(Path::new("p.asm")), Some(Form::Asm));
        // `M.TM` is as much an artifact as `m.tm`. `run.rs` records what a byte-for-byte
        // comparison cost: an uppercase file went down the `.rxt` path and the lexer blamed a
        // valid file on the program.
        assert_eq!(Form::from_extension(Path::new("M.TM")), Some(Form::Tm));
        assert_eq!(Form::from_extension(Path::new("P.AsM")), Some(Form::Asm));

        // `.rxt` is NOT in the table: it is the fallback, not a recognised artifact extension.
        assert_eq!(Form::from_extension(Path::new("p.rxt")), None);
        assert_eq!(Form::from_extension(Path::new("p.txt")), None);
        assert_eq!(Form::from_extension(Path::new("noextension")), None);
    }

    #[test]
    fn only_the_two_compiled_forms_are_artifacts() {
        assert!(Form::Tm.is_artifact());
        assert!(Form::Asm.is_artifact());
        assert!(!Form::Rxt.is_artifact());
    }

    #[test]
    fn an_explicit_form_wins_over_everything() {
        // Overriding what the filename says is the whole reason the flag exists, so a mismatch is
        // not an error.
        let p = Input::Path("p.rxt".into());
        assert_eq!(Form::resolve(&p, Some(Form::Tm), TM_IN), Form::Tm);
        let t = Input::Path("p.tm".into());
        assert_eq!(Form::resolve(&t, Some(Form::Rxt), TM_IN), Form::Rxt);
        // And over sniffing.
        assert_eq!(Form::resolve(&Input::Stdin, Some(Form::Rxt), TM_IN), Form::Rxt);
    }

    #[test]
    fn a_paths_extension_decides_and_its_content_is_never_consulted() {
        // THE CONTENT HERE CONTRADICTS THE EXTENSION ON PURPOSE. A `.rxt` file whose text happens
        // to satisfy another front end must not be reformatted as a machine — that is why sniffing
        // is stdin-only, and this is the assertion that holds it.
        let p = Input::Path("p.rxt".into());
        assert_eq!(Form::resolve(&p, None, TM_IN), Form::Rxt);

        assert_eq!(Form::resolve(&Input::Path("p.tm".into()), None, ""), Form::Tm);
        assert_eq!(Form::resolve(&Input::Path("M.TM".into()), None, ""), Form::Tm);
        assert_eq!(Form::resolve(&Input::Path("p.asm".into()), None, ""), Form::Asm);
    }

    #[test]
    fn stdin_is_sniffed_and_falls_back_to_rxt() {
        assert_eq!(Form::resolve(&Input::Stdin, None, TM_IN), Form::Tm);
        assert_eq!(Form::resolve(&Input::Stdin, None, ASM_IN), Form::Asm);
        assert_eq!(Form::resolve(&Input::Stdin, None, "let   x=1;\nx+1"), Form::Rxt);
        assert_eq!(Form::resolve(&Input::Stdin, None, ""), Form::Rxt);
    }
}
