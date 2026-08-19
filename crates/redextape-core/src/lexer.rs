//! Hand-written lexer. Skips whitespace and COLLECTS `//` line comments; recognizes keywords, `Nat`
//! literals, identifiers, the v1 operator set, and delimiters. Unknown characters become a
//! `Diagnostic` and are skipped (no token emitted).

use crate::diagnostic::Diagnostic;
use crate::span::Span;
use crate::token::{Comment, Token, TokenKind};

#[must_use]
pub fn lex(src: &str) -> (Vec<Token>, Vec<Comment>, Vec<Diagnostic>) {
    let mut toks = Vec::new();
    let mut comments = Vec::new();
    let mut diags = Vec::new();
    let bytes = src.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        let c = bytes[i];
        // Whitespace.
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        // Line comments. Kept rather than skipped: a `print ∘ parse` formatter over an AST that never
        // saw them would delete every comment in the file.
        if c == b'/' && bytes.get(i + 1) == Some(&b'/') {
            let start = i;
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            comments.push(Comment { span: Span::new(start, i), own_line: own_line_at(bytes, start) });
            continue;
        }
        // Two-character operators (must be tried before their one-char prefixes).
        if let Some(kind) = two_char_kind(c, bytes.get(i + 1).copied()) {
            toks.push(Token { kind, span: Span::new(i, i + 2) });
            i += 2;
            continue;
        }
        // One-character operators and delimiters.
        if let Some(kind) = one_char_kind(c) {
            toks.push(Token { kind, span: Span::new(i, i + 1) });
            i += 1;
            continue;
        }
        // Nat literals.
        if c.is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            let text = &src[start..i];
            let value: u64 = text.parse().unwrap_or(u64::MAX);
            toks.push(Token { kind: TokenKind::Nat(value), span: Span::new(start, i) });
            continue;
        }
        // Identifiers and keywords.
        if c == b'_' || c.is_ascii_alphabetic() {
            let start = i;
            while i < bytes.len() && (bytes[i] == b'_' || bytes[i].is_ascii_alphanumeric()) {
                i += 1;
            }
            let kind = keyword_kind(&src[start..i]).unwrap_or(TokenKind::Ident);
            toks.push(Token { kind, span: Span::new(start, i) });
            continue;
        }
        // Anything else: one diagnostic per unknown character, then skip it.
        let ch_len = utf8_len(c);
        diags.push(Diagnostic::error(
            Span::new(i, i + ch_len),
            format!("unexpected character `{}`", &src[i..i + ch_len]),
        ));
        i += ch_len;
    }

    toks.push(Token { kind: TokenKind::Eof, span: Span::new(src.len(), src.len()) });
    (toks, comments, diags)
}

/// True when only whitespace separates `start` from the previous newline, or from the start of input.
/// Byte-wise and backwards from `start`, so it costs the length of one line at most.
fn own_line_at(bytes: &[u8], start: usize) -> bool {
    let mut j = start;
    while j > 0 {
        j -= 1;
        if bytes[j] == b'\n' {
            return true;
        }
        if !bytes[j].is_ascii_whitespace() {
            return false;
        }
    }
    true
}

fn two_char_kind(c: u8, next: Option<u8>) -> Option<TokenKind> {
    match (c, next) {
        (b'=', Some(b'=')) => Some(TokenKind::Eq),
        (b'!', Some(b'=')) => Some(TokenKind::Ne),
        (b'<', Some(b'=')) => Some(TokenKind::Le),
        (b'>', Some(b'=')) => Some(TokenKind::Ge),
        _ => None,
    }
}

fn one_char_kind(c: u8) -> Option<TokenKind> {
    Some(match c {
        b'+' => TokenKind::Plus,
        b'-' => TokenKind::Minus,
        b'*' => TokenKind::Star,
        b'<' => TokenKind::Lt,
        b'>' => TokenKind::Gt,
        b'=' => TokenKind::Assign,
        b'(' => TokenKind::LParen,
        b')' => TokenKind::RParen,
        b'{' => TokenKind::LBrace,
        b'}' => TokenKind::RBrace,
        b'[' => TokenKind::LBracket,
        b']' => TokenKind::RBracket,
        b',' => TokenKind::Comma,
        b';' => TokenKind::Semi,
        b'|' => TokenKind::Pipe,
        b'.' => TokenKind::Dot,
        _ => return None,
    })
}

fn keyword_kind(text: &str) -> Option<TokenKind> {
    Some(match text {
        "fn" => TokenKind::Fn,
        "let" => TokenKind::Let,
        "mut" => TokenKind::Mut,
        "if" => TokenKind::If,
        "else" => TokenKind::Else,
        "while" => TokenKind::While,
        "true" => TokenKind::True,
        "false" => TokenKind::False,
        _ => return None,
    })
}

/// Byte length of the UTF-8 character whose leading byte is `c` (for advancing past unknown input).
fn utf8_len(c: u8) -> usize {
    match c {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        _ => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<TokenKind> {
        let (toks, _comments, diags) = lex(src);
        assert!(diags.is_empty(), "unexpected diagnostics: {diags:?}");
        toks.into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn lexes_keywords_and_identifiers() {
        use TokenKind::*;
        assert_eq!(
            kinds("fn let mut if else while true false foo"),
            vec![Fn, Let, Mut, If, Else, While, True, False, Ident, Eof,]
        );
    }

    #[test]
    fn lexes_operators_longest_match_first() {
        use TokenKind::*;
        assert_eq!(kinds("== != <= >= < > = + - *"), vec![Eq, Ne, Le, Ge, Lt, Gt, Assign, Plus, Minus, Star, Eof,]);
    }

    #[test]
    fn lexes_delimiters_and_nat_literals() {
        use TokenKind::*;
        assert_eq!(
            kinds("(){}[],;|. 0 42"),
            vec![LParen, RParen, LBrace, RBrace, LBracket, RBracket, Comma, Semi, Pipe, Dot, Nat(0), Nat(42), Eof,]
        );
    }

    #[test]
    fn skips_whitespace_and_line_comments() {
        use TokenKind::*;
        assert_eq!(kinds("1 // a comment\n  2"), vec![Nat(1), Nat(2), Eof]);
    }

    #[test]
    fn ident_text_is_recovered_by_span() {
        let src = "count_down";
        let (toks, _, _) = lex(src);
        assert_eq!(toks[0].kind, TokenKind::Ident);
        assert_eq!(&src[toks[0].span.start..toks[0].span.end], "count_down");
    }

    #[test]
    fn unknown_char_becomes_a_diagnostic_and_is_skipped() {
        let (toks, _, diags) = lex("1 $ 2");
        assert_eq!(diags.len(), 1);
        assert_eq!(&"1 $ 2"[diags[0].span.start..diags[0].span.end], "$");
        assert_eq!(
            toks.iter().map(|t| t.kind).collect::<Vec<_>>(),
            vec![TokenKind::Nat(1), TokenKind::Nat(2), TokenKind::Eof,]
        );
    }

    #[test]
    fn comments_are_collected_with_their_spans_and_text() {
        let src = "1 // a comment\n2";
        let (toks, comments, diags) = lex(src);
        assert!(diags.is_empty(), "unexpected diagnostics: {diags:?}");
        assert_eq!(
            toks.iter().map(|t| t.kind).collect::<Vec<_>>(),
            vec![TokenKind::Nat(1), TokenKind::Nat(2), TokenKind::Eof,]
        );
        assert_eq!(comments.len(), 1);
        assert_eq!(&src[comments[0].span.start..comments[0].span.end], "// a comment");
    }

    #[test]
    fn own_line_is_true_only_when_nothing_but_whitespace_precedes_on_the_line() {
        let (_, comments, _) = lex("1 // trailing\n  // leading\n2");
        assert_eq!(comments.len(), 2);
        assert!(!comments[0].own_line, "a comment after code on the same line is trailing");
        assert!(comments[1].own_line, "a comment with only whitespace before it owns its line");
    }

    #[test]
    fn a_comment_at_the_very_start_of_input_owns_its_line() {
        let (_, comments, _) = lex("// first thing\n1");
        assert_eq!(comments.len(), 1);
        assert!(comments[0].own_line);
    }

    #[test]
    fn a_comment_with_no_trailing_newline_ends_at_end_of_input() {
        let src = "1 // to the end";
        let (_, comments, _) = lex(src);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].span.end, src.len());
        assert_eq!(&src[comments[0].span.start..comments[0].span.end], "// to the end");
    }

    #[test]
    fn a_crlf_line_ending_leaves_the_carriage_return_inside_the_span() {
        // The span stops at `\n`, so a `\r` before it is inside the comment text. The printer trims
        // trailing whitespace (design §3), which is where that is handled — recorded here so the
        // trimming has a reason rather than looking defensive.
        let src = "1 // note\r\n2";
        let (_, comments, _) = lex(src);
        assert_eq!(&src[comments[0].span.start..comments[0].span.end], "// note\r");
    }

    #[test]
    fn a_bare_double_slash_is_still_a_comment() {
        let src = "1 //\n2";
        let (_, comments, _) = lex(src);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].span.end - comments[0].span.start, 2);
    }
}
