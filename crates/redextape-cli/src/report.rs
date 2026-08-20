//! `Diagnostic` to the terminal, through ariadne.
//!
//! THE ONLY MODULE THAT KNOWS ARIADNE EXISTS. `fmt`'s parse errors and `lint`'s analysis diagnostics
//! both render here, which is what stops the two commands from growing two different diagnostic looks.
//!
//! `IndexType::Byte` is not optional. `Span` is byte offsets everywhere in this workspace, and
//! ariadne's default is CHARACTER offsets — a file with one multi-byte character before a diagnostic
//! would silently underline the wrong span.
use ariadne::{Config, IndexType, Label, Report, ReportKind, Source};
use redextape_core::{Diagnostic, Severity};

/// Render every diagnostic against `src`, labelled `label`.
///
/// # Errors
///
/// Any `std::io::Error` from writing to `w`.
///
/// # Panics
///
/// Ariadne itself panics if any `d.span` fails `d.span.start <= d.span.end <= src.len()` with both
/// ends on a UTF-8 char boundary — `render` passes each span straight through unvalidated. Every
/// diagnostic this crate's `analyze` and `format` produce satisfies that invariant today, but it is
/// the caller's responsibility to keep satisfying it; `render` does not re-check it.
pub fn render(
    w: &mut impl std::io::Write,
    label: &str,
    src: &str,
    ds: &[Diagnostic],
    color: bool,
) -> std::io::Result<()> {
    let config = Config::default().with_index_type(IndexType::Byte).with_color(color);
    for d in ds {
        let kind = match d.severity {
            Severity::Error => ReportKind::Error,
            Severity::Warning => ReportKind::Warning,
        };
        let span = (label, d.span.start..d.span.end);
        Report::build(kind, span.clone())
            .with_config(config)
            .with_message(&d.message)
            .with_label(Label::new(span).with_message(&d.message))
            .finish()
            .write((label, Source::from(src)), &mut *w)?;
    }
    Ok(())
}

/// Whether to colour: a terminal that has not opted out.
///
/// `NO_COLOR` is honoured at any value, per the convention's own rule that presence is what counts.
#[must_use]
pub fn should_color() -> bool {
    should_color_from(std::env::var_os("NO_COLOR").as_deref(), std::io::IsTerminal::is_terminal(&std::io::stderr()))
}

/// The pure decision behind `should_color`, taking `NO_COLOR` and the terminal check as plain
/// values instead of reading them itself. Split out so the four `NO_COLOR`-present/absent ×
/// tty/non-tty combinations can be tested directly — mutating `std::env` in a test races under
/// parallel execution (both within `cargo test`'s threads and across concurrent `cargo nextest`
/// processes, which still share one environment), so this is the only place those combinations can
/// be pinned at all.
///
/// `no_color`'s value is never inspected, only its presence — `NO_COLOR`'s own convention is that
/// merely setting the variable, to any value including an empty string, opts out.
#[must_use]
fn should_color_from(no_color: Option<&std::ffi::OsStr>, tty: bool) -> bool {
    no_color.is_none() && tty
}

#[cfg(test)]
mod tests {
    use super::*;

    // I1: `should_color` itself reads real process state (`NO_COLOR`, stderr's tty-ness), which is
    // exactly what a test must not mutate — `std::env::set_var` races every other test in the same
    // process. `should_color_from` is the pure decision extracted so all four combinations can be
    // pinned directly, with no environment involved at all.
    #[test]
    fn no_color_absent_and_a_tty_colours() {
        assert!(should_color_from(None, true));
    }

    #[test]
    fn no_color_absent_and_not_a_tty_does_not_colour() {
        assert!(!should_color_from(None, false));
    }

    #[test]
    fn no_color_present_and_a_tty_does_not_colour() {
        // The convention's own rule: PRESENCE opts out, regardless of value — even an empty string.
        assert!(!should_color_from(Some(std::ffi::OsStr::new("")), true));
    }

    #[test]
    fn no_color_present_and_not_a_tty_does_not_colour() {
        assert!(!should_color_from(Some(std::ffi::OsStr::new("1")), false));
    }

    #[test]
    fn an_error_renders_with_its_source_line_and_the_word_error() {
        let src = "let x = ;";
        let ds = redextape_core::analyze(src).diagnostics;
        assert!(!ds.is_empty(), "this program must not parse");
        let mut buf = Vec::new();
        render(&mut buf, "a.rxt", src, &ds, false).unwrap();
        let text = String::from_utf8(buf).unwrap();
        assert!(text.contains("Error"), "got {text}");
        assert!(text.contains("a.rxt"), "the label names the file: {text}");
    }

    #[test]
    fn a_warning_renders_as_a_warning_and_not_as_an_error() {
        let src = "let mut x = 1; x + 1";
        let ds = redextape_core::analyze(src).diagnostics;
        assert_eq!(ds.len(), 1, "expected the unused-mut warning: {ds:?}");
        let mut buf = Vec::new();
        render(&mut buf, "a.rxt", src, &ds, false).unwrap();
        let text = String::from_utf8(buf).unwrap();
        assert!(text.contains("Warning"), "got {text}");
    }

    #[test]
    fn colour_off_emits_no_ansi_escapes_so_a_golden_test_is_stable() {
        let src = "let mut x = 1; x + 1";
        let ds = redextape_core::analyze(src).diagnostics;
        let mut buf = Vec::new();
        render(&mut buf, "a.rxt", src, &ds, false).unwrap();
        assert!(!buf.contains(&0x1b), "no ESC byte may appear with colour off");
    }

    #[test]
    fn a_span_late_in_a_multibyte_file_lands_on_the_right_line() {
        // The label offsets are BYTES. A file with a multi-byte character before the diagnostic is
        // where a character-indexed renderer would drift, so this is the shape that catches it.
        //
        // `π` sits in a `//` comment rather than a string literal: this toy language has no string
        // syntax at all (an unquoted `"` is itself an "unexpected character"), so a `"π"` on line 1
        // reports THREE lexer errors there and `analyze` skips the lint pass once any error-severity
        // diagnostic exists — the line-2 warning this test wants to see never fires. A `//` comment is
        // scanned as raw bytes with no per-character tokenizing, so `π` costs nothing: line 1 stays
        // fully clean and the single unused-`mut` warning below is line 2's only diagnostic.
        //
        // `// π` is 4 characters but 5 bytes (`π` is 2 bytes), so the byte offset of column 1 on line 2
        // is one past its char offset. `render`'s label is `LINE:COL`: byte-correct indexing must
        // therefore report `2:1`, and a char-indexed renderer fed these byte offsets would report
        // `2:2` instead — asserting the exact column is what makes this test fail if `IndexType::Byte`
        // is ever swapped for `IndexType::Char`. Confirmed by making that swap locally: the label moved
        // one column later, exactly as this comment predicts.
        //
        // The two coordinates below are RENDERED OUTPUT, not pointers. `a.rxt` is the `label` argument
        // this test passes to `render` — no such file exists — so `LINE:COL` here names a position in
        // a string literal three lines down, and nothing it could drift away from. `check-citations`
        // cannot tell that apart from a real pointer, which is what its marker is for.
        // a.rxt:2:2 is what a char-indexed renderer prints. check-citations: allow
        let src = "// π\nlet mut x = 1; x + 1";
        let ds = redextape_core::analyze(src).diagnostics;
        assert_eq!(ds.len(), 1, "expected only the unused-mut warning, on line 2: {ds:?}");
        let mut buf = Vec::new();
        render(&mut buf, "a.rxt", src, &ds, false).unwrap();
        let text = String::from_utf8(buf).unwrap();
        assert!(text.contains("a.rxt:2:1"), "byte-correct column: {text}"); // check-citations: allow
    }
}
