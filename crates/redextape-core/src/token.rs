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
