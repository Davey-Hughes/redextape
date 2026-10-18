//! The comment-placement generators `asm_comments.rs` and `tm_comments.rs` both build their
//! round-trip documents from.
//!
//! Each of those files includes this one by `#[path]` rather than through `common/mod.rs`, because
//! both are checked under `clippy::pedantic` and `mod.rs` relies on its includers allowing it.

use std::fmt::Write as _;

use proptest::prelude::Strategy;

/// A comment body that survives a round trip: no newline (impossible from a line-based parser anyway)
/// and no leading or trailing whitespace, since the printer writes `; ` and the parser trims.
/// Everything else is fair game, `;` included — `split_trailing` only ever looks at the FIRST `;` on a
/// line, so a body containing one still recovers whole.
pub fn body() -> impl Strategy<Value = String> {
    "[^\n]{0,40}".prop_map(|s| s.trim().to_string())
}

/// The own-line comments (0..=2, each printed above the construct it belongs to) and the optional
/// trailing comment (printed on the construct's own line) one candidate position gets.
#[derive(Clone, Debug)]
pub struct Slot {
    pub own: Vec<String>,
    pub trailing: Option<String>,
}

pub fn slot() -> impl Strategy<Value = Slot> {
    (proptest::collection::vec(body(), 0..=2), proptest::option::weighted(0.7, body()))
        .prop_map(|(own, trailing)| Slot { own, trailing })
}

/// Write `slot`'s own-line comments, each on its own line at `indent`, immediately above the
/// construct line the caller writes next.
pub fn write_own(out: &mut String, slot: &Slot, indent: &str) {
    for line in &slot.own {
        let _ = writeln!(out, "{indent}; {line}");
    }
}

/// `slot`'s trailing comment, formatted to append directly after a construct's own content on the
/// same line — empty when there isn't one.
pub fn trailing_of(slot: &Slot) -> String {
    match &slot.trailing {
        Some(t) => format!(" ; {t}"),
        None => String::new(),
    }
}

/// Write one construct line, preceded by `slot`'s own-line comments and followed by its trailing
/// comment, both at `indent`.
pub fn emit(out: &mut String, slot: &Slot, indent: &str, line: &str) {
    write_own(out, slot, indent);
    let _ = writeln!(out, "{indent}{line}{}", trailing_of(slot));
}
