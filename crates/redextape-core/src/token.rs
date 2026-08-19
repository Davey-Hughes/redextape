//! Tokens. `TokenKind` is `Copy` — identifier/keyword spelling is recovered from the source by
//! span, not stored here.

use crate::span::Span;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenKind {
    // Literals & names.
    Nat(u64),
    Ident,
    // Keywords.
    Fn,
    Let,
    Mut,
    If,
    Else,
    While,
    True,
    False,
    // Operators.
    Plus,
    Minus,
    Star,
    Eq,     // ==
    Ne,     // !=
    Lt,     // <
    Le,     // <=
    Gt,     // >
    Ge,     // >=
    Assign, // =
    // Delimiters & punctuation.
    LParen,
    RParen,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Comma,
    Semi,
    Pipe, // | (closure delimiter)
    Dot,  // . (UFCS method call)
    // End of input.
    Eof,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
}

/// A `//` line comment the lexer kept instead of discarding. The TEXT is not stored —
/// `src[span.start..span.end]` recovers it, for the same reason `TokenKind` is `Copy` and identifier
/// spelling is recovered by span rather than held.
///
/// The span covers `//` through the last byte before the newline, so a CRLF line ending leaves the
/// `\r` inside it; the printer trims trailing whitespace.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Comment {
    pub span: Span,
    /// True when only whitespace separates this comment from the previous newline (or the start of
    /// input). Decided HERE, where the backward scan is already in reach, rather than recomputed by
    /// the printer — two places deciding what "own line" means is one place too many, and only one of
    /// them would be tested.
    pub own_line: bool,
}
