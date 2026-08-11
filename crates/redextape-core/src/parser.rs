//! Hand-written Pratt (precedence-climbing) parser: `&str` -> `Program`. Produces spanned
//! diagnostics; returns `Some(program)` only when the entire input parsed.

use crate::ast::{BinOp, Block, Expr, Program, Stmt};
use crate::diagnostic::Diagnostic;
use crate::lexer::lex;
use crate::span::Span;
use crate::token::{Token, TokenKind};

/// Maximum number of tokens (including the trailing `Eof`) a program may contain. This is now only
/// a coarse resource bound — it caps the memory and time spent lexing/parsing pathological input —
/// NOT the stack-safety mechanism: each recursive pass (parser, typecheck, eval) has its own
/// depth guard (`MAX_PARSE_DEPTH`, `MAX_TYPE_DEPTH`, `MAX_EVAL_DEPTH`) that turns deep-but-narrow
/// input into a `Diagnostic`/`RuntimeError` well before a native stack overflow, independent of
/// how many tokens the program contains.
pub const MAX_TOKENS: usize = 100_000;

#[must_use]
pub fn parse(src: &str) -> (Option<Program>, Vec<Diagnostic>) {
    let (tokens, mut diags) = lex(src);
    if !diags.is_empty() {
        return (None, diags);
    }
    if tokens.len() > MAX_TOKENS {
        diags.push(Diagnostic::error(
            Span::new(0, src.len()),
            format!("program too large: {} tokens exceeds the maximum of {MAX_TOKENS} (deeply nested or very long programs are rejected to avoid stack overflow)", tokens.len()),
        ));
        return (None, diags);
    }
    let mut p = Parser { src, tokens, pos: 0, depth: 0 };
    match p.parse_program() {
        Ok(program) => (Some(program), diags),
        Err(diag) => {
            diags.push(diag);
            (None, diags)
        }
    }
}

/// Maximum nesting depth (parens, brackets, nested calls, nested blocks — anything that recurses
/// through `parse_binary`) `parse_binary` will descend before giving up. Every nested sub-expression
/// passes through `parse_binary`, so counting its recursion depth bounds the parser's native stack
/// usage; input nested deeper than this yields a `Diagnostic` instead of a parser stack overflow
/// (an uncatchable process abort). Chosen empirically at roughly half the depth that overflows an
/// 8 MiB debug main thread (see the crash-harness measurements in the robust-fix report).
pub const MAX_PARSE_DEPTH: u32 = 300;

struct Parser<'a> {
    src: &'a str,
    tokens: Vec<Token>,
    pos: usize,
    depth: u32,
}

type PResult<T> = Result<T, Diagnostic>;

impl Parser<'_> {
    fn peek(&self) -> Token {
        self.tokens[self.pos]
    }

    fn bump(&mut self) -> Token {
        let t = self.tokens[self.pos];
        if !matches!(t.kind, TokenKind::Eof) {
            self.pos += 1;
        }
        t
    }

    fn text(&self, span: Span) -> String {
        self.src[span.start..span.end].to_string()
    }

    fn expect(&mut self, kind: TokenKind, what: &str) -> PResult<Token> {
        let t = self.peek();
        if t.kind == kind { Ok(self.bump()) } else { Err(Diagnostic::error(t.span, format!("expected {what}"))) }
    }

    fn parse_program(&mut self) -> PResult<Program> {
        let block = self.parse_block_body(TokenKind::Eof)?;
        self.expect(TokenKind::Eof, "end of input")?;
        Ok(Program { block })
    }

    /// Parse statements + optional tail until (but not consuming) `close`.
    fn parse_block_body(&mut self, close: TokenKind) -> PResult<Block> {
        let start = self.peek().span;
        let mut stmts = Vec::new();
        let mut tail = None;
        while self.peek().kind != close {
            match self.peek().kind {
                TokenKind::Let => stmts.push(self.parse_let()?),
                TokenKind::Fn => stmts.push(self.parse_fn()?),
                TokenKind::While => stmts.push(self.parse_while()?),
                _ => {
                    // An identifier followed by `=` is an assignment statement.
                    if self.peek().kind == TokenKind::Ident && self.tokens[self.pos + 1].kind == TokenKind::Assign {
                        stmts.push(self.parse_assign()?);
                        continue;
                    }
                    let e = self.parse_expr()?;
                    if self.peek().kind == TokenKind::Semi {
                        self.bump();
                        stmts.push(Stmt::Expr(e));
                    } else {
                        tail = Some(Box::new(e));
                        break;
                    }
                }
            }
        }
        let end = self.peek().span;
        Ok(Block { stmts, tail, span: start.merge(end) })
    }

    fn parse_let(&mut self) -> PResult<Stmt> {
        let kw = self.expect(TokenKind::Let, "`let`")?;
        let mutable = if self.peek().kind == TokenKind::Mut {
            self.bump();
            true
        } else {
            false
        };
        let name_tok = self.expect(TokenKind::Ident, "a variable name")?;
        let name = self.text(name_tok.span);
        self.expect(TokenKind::Assign, "`=`")?;
        let value = self.parse_expr()?;
        let semi = self.expect(TokenKind::Semi, "`;`")?;
        Ok(Stmt::Let { name, mutable, value, span: kw.span.merge(semi.span) })
    }

    fn parse_fn(&mut self) -> PResult<Stmt> {
        let kw = self.expect(TokenKind::Fn, "`fn`")?;
        let name_tok = self.expect(TokenKind::Ident, "a function name")?;
        let name = self.text(name_tok.span);
        self.expect(TokenKind::LParen, "`(`")?;
        let params = self.parse_param_list(TokenKind::RParen)?;
        self.expect(TokenKind::RParen, "`)`")?;
        let body = self.parse_braced_block()?;
        let span = kw.span.merge(body.span);
        Ok(Stmt::Fn { name, params, body, span })
    }

    fn parse_while(&mut self) -> PResult<Stmt> {
        let kw = self.expect(TokenKind::While, "`while`")?;
        let cond = self.parse_expr()?;
        let body = self.parse_braced_block()?;
        let span = kw.span.merge(body.span);
        Ok(Stmt::While { cond, body, span })
    }

    fn parse_assign(&mut self) -> PResult<Stmt> {
        let name_tok = self.bump(); // Ident (checked by caller)
        let target = self.text(name_tok.span);
        self.expect(TokenKind::Assign, "`=`")?;
        let value = self.parse_expr()?;
        let semi = self.expect(TokenKind::Semi, "`;`")?;
        Ok(Stmt::Assign { target, value, span: name_tok.span.merge(semi.span) })
    }

    fn parse_param_list(&mut self, close: TokenKind) -> PResult<Vec<String>> {
        let mut params = Vec::new();
        while self.peek().kind != close {
            let tok = self.expect(TokenKind::Ident, "a parameter name")?;
            params.push(self.text(tok.span));
            if self.peek().kind == TokenKind::Comma {
                self.bump();
            } else {
                break;
            }
        }
        Ok(params)
    }

    /// `fn`/`while`/`if`/block bodies all funnel through here, so it's the other recursion choke
    /// point besides `parse_binary` — nested braced blocks never touch `parse_binary` themselves,
    /// so without this guard they could recurse past the native stack limit uncaught. Shares
    /// `self.depth`/`MAX_PARSE_DEPTH` with `parse_binary` so expression- and block-nesting accumulate
    /// on one counter, bounding total nesting. Mirrors `parse_binary`'s wrapper/inner split: the
    /// check wraps `parse_braced_block_inner` so every nesting level is counted and every return path
    /// (`Ok` and `?`-propagated `Err`) decrements `self.depth`.
    fn parse_braced_block(&mut self) -> PResult<Block> {
        self.depth += 1;
        if self.depth > MAX_PARSE_DEPTH {
            self.depth -= 1;
            return Err(Diagnostic::error(self.peek().span, "block nested too deeply"));
        }
        let r = self.parse_braced_block_inner();
        self.depth -= 1;
        r
    }

    fn parse_braced_block_inner(&mut self) -> PResult<Block> {
        self.expect(TokenKind::LBrace, "`{`")?;
        let block = self.parse_block_body(TokenKind::RBrace)?;
        self.expect(TokenKind::RBrace, "`}`")?;
        Ok(block)
    }

    // --- Expression parsing (precedence climbing) ---

    fn parse_expr(&mut self) -> PResult<Expr> {
        self.parse_binary(0)
    }

    /// Precedence climbing. `min_bp` is the minimum binding power this call will accept.
    ///
    /// This is the recursion choke point: every nested sub-expression (parens, brackets, call/method
    /// args, nested blocks, `if`/lambda bodies) passes back through here, so it's where the depth
    /// guard lives. The check wraps `parse_binary_inner` so every nesting level is counted and every
    /// return path (`Ok` and `?`-propagated `Err`) decrements `self.depth`.
    fn parse_binary(&mut self, min_bp: u8) -> PResult<Expr> {
        self.depth += 1;
        if self.depth > MAX_PARSE_DEPTH {
            self.depth -= 1;
            return Err(Diagnostic::error(self.peek().span, "expression nested too deeply"));
        }
        let r = self.parse_binary_inner(min_bp);
        self.depth -= 1;
        r
    }

    fn parse_binary_inner(&mut self, min_bp: u8) -> PResult<Expr> {
        let mut lhs = self.parse_postfix()?;
        while let Some((op, bp)) = infix_op(self.peek().kind) {
            if bp < min_bp {
                break;
            }
            self.bump();
            let rhs = self.parse_binary(bp + 1)?; // left-associative: rhs binds tighter
            let span = lhs.span().merge(rhs.span());
            lhs = Expr::Binary { op, lhs: Box::new(lhs), rhs: Box::new(rhs), span };
        }
        Ok(lhs)
    }

    /// Atoms followed by any run of call `(...)` and method `.m(...)` postfixes.
    fn parse_postfix(&mut self) -> PResult<Expr> {
        let mut e = self.parse_atom()?;
        loop {
            match self.peek().kind {
                TokenKind::LParen => {
                    self.bump();
                    let args = self.parse_arg_list()?;
                    let close = self.expect(TokenKind::RParen, "`)`")?;
                    let span = e.span().merge(close.span);
                    e = Expr::Call { callee: Box::new(e), args, span };
                }
                TokenKind::Dot => {
                    self.bump();
                    let name_tok = self.expect(TokenKind::Ident, "a method name")?;
                    let name = self.text(name_tok.span);
                    self.expect(TokenKind::LParen, "`(`")?;
                    let args = self.parse_arg_list()?;
                    let close = self.expect(TokenKind::RParen, "`)`")?;
                    let span = e.span().merge(close.span);
                    e = Expr::Method { recv: Box::new(e), name, args, span };
                }
                _ => break,
            }
        }
        Ok(e)
    }

    fn parse_arg_list(&mut self) -> PResult<Vec<Expr>> {
        let mut args = Vec::new();
        while self.peek().kind != TokenKind::RParen {
            args.push(self.parse_expr()?);
            if self.peek().kind == TokenKind::Comma {
                self.bump();
            } else {
                break;
            }
        }
        Ok(args)
    }

    fn parse_atom(&mut self) -> PResult<Expr> {
        let t = self.peek();
        match t.kind {
            TokenKind::Nat(value) => {
                self.bump();
                Ok(Expr::Nat { value, span: t.span })
            }
            TokenKind::True => {
                self.bump();
                Ok(Expr::Bool { value: true, span: t.span })
            }
            TokenKind::False => {
                self.bump();
                Ok(Expr::Bool { value: false, span: t.span })
            }
            TokenKind::Ident => {
                self.bump();
                Ok(Expr::Var { name: self.text(t.span), span: t.span })
            }
            TokenKind::LParen => {
                self.bump();
                let e = self.parse_expr()?;
                self.expect(TokenKind::RParen, "`)`")?;
                Ok(e)
            }
            TokenKind::LBracket => {
                self.bump();
                let mut items = Vec::new();
                while self.peek().kind != TokenKind::RBracket {
                    items.push(self.parse_expr()?);
                    if self.peek().kind == TokenKind::Comma {
                        self.bump();
                    } else {
                        break;
                    }
                }
                let close = self.expect(TokenKind::RBracket, "`]`")?;
                Ok(Expr::List { items, span: t.span.merge(close.span) })
            }
            TokenKind::LBrace => {
                let block = self.parse_braced_block()?;
                let span = block.span;
                Ok(Expr::Block { block: Box::new(block), span })
            }
            TokenKind::If => {
                self.bump();
                let cond = self.parse_expr()?;
                let then_blk = self.parse_braced_block()?;
                self.expect(TokenKind::Else, "`else`")?;
                let else_blk = self.parse_braced_block()?;
                let span = t.span.merge(else_blk.span);
                Ok(Expr::If { cond: Box::new(cond), then_blk, else_blk, span })
            }
            TokenKind::Pipe => {
                self.bump();
                let params = self.parse_param_list(TokenKind::Pipe)?;
                self.expect(TokenKind::Pipe, "`|`")?;
                let body = self.parse_expr()?;
                let span = t.span.merge(body.span());
                Ok(Expr::Lambda { params, body: Box::new(body), span })
            }
            _ => Err(Diagnostic::error(t.span, "expected an expression")),
        }
    }
}

/// Infix operators and their binding powers (higher binds tighter). Comparisons sit below
/// additive, additive below multiplicative.
fn infix_op(kind: TokenKind) -> Option<(BinOp, u8)> {
    Some(match kind {
        TokenKind::Eq => (BinOp::Eq, 1),
        TokenKind::Ne => (BinOp::Ne, 1),
        TokenKind::Lt => (BinOp::Lt, 1),
        TokenKind::Le => (BinOp::Le, 1),
        TokenKind::Gt => (BinOp::Gt, 1),
        TokenKind::Ge => (BinOp::Ge, 1),
        TokenKind::Plus => (BinOp::Add, 2),
        TokenKind::Minus => (BinOp::Sub, 2),
        TokenKind::Star => (BinOp::Mul, 3),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn program(src: &str) -> Program {
        let (prog, diags) = parse(src);
        assert!(diags.is_empty(), "unexpected diagnostics: {diags:?}");
        prog.expect("expected a program")
    }

    fn expr(src: &str) -> Expr {
        let prog = program(src);
        assert!(prog.block.stmts.is_empty(), "expected a single tail expression");
        *prog.block.tail.expect("expected a tail expression")
    }

    #[test]
    fn parses_additive_and_multiplicative_precedence() {
        // 1 + 2 * 3  ==  1 + (2 * 3)
        let e = expr("1 + 2 * 3");
        // Match by reference: `Expr` now has a hand-written `Drop`, so its fields cannot be moved
        // out by value.
        match &e {
            Expr::Binary { op: BinOp::Add, rhs, .. } => {
                assert!(matches!(&**rhs, Expr::Binary { op: BinOp::Mul, .. }));
            }
            other => panic!("expected top-level Add, got {other:?}"),
        }
    }

    #[test]
    fn additive_is_left_associative() {
        // 1 - 2 - 3  ==  (1 - 2) - 3
        match &expr("1 - 2 - 3") {
            Expr::Binary { op: BinOp::Sub, lhs, .. } => {
                assert!(matches!(&**lhs, Expr::Binary { op: BinOp::Sub, .. }));
            }
            other => panic!("expected left-nested Sub, got {other:?}"),
        }
    }

    #[test]
    fn parses_comparison_below_arithmetic() {
        // n > 0  parses the comparison at the top
        assert!(matches!(expr("n > 0"), Expr::Binary { op: BinOp::Gt, .. }));
    }

    #[test]
    fn parses_call_and_ufcs_chain() {
        // [3,1,2].map(add1).fold(0, add)
        let e = expr("[3, 1, 2].map(add1).fold(0, add)");
        // Match by reference: `Expr` now has a hand-written `Drop`, so its fields cannot be moved
        // out by value.
        match &e {
            Expr::Method { name, args, recv, .. } => {
                assert_eq!(name, "fold");
                assert_eq!(args.len(), 2);
                assert!(matches!(&**recv, Expr::Method { .. }));
            }
            other => panic!("expected outer .fold method, got {other:?}"),
        }
    }

    #[test]
    fn parses_closure_and_let() {
        // let add1 = |x| x + 1; add1
        let prog = program("let add1 = |x| x + 1; add1");
        assert_eq!(prog.block.stmts.len(), 1);
        assert!(matches!(&prog.block.stmts[0], Stmt::Let { name, mutable: false, .. } if name == "add1"));
    }

    #[test]
    fn parses_fn_while_and_assignment() {
        let src = "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(3)";
        let prog = program(src);
        assert!(
            matches!(&prog.block.stmts[0], Stmt::Fn { name, params, .. } if name == "count_down" && params == &["n"])
        );
    }

    #[test]
    fn if_else_is_an_expression() {
        assert!(matches!(expr("if true { 1 } else { 2 }"), Expr::If { .. }));
    }

    #[test]
    fn reports_unclosed_paren_with_a_span() {
        let (prog, diags) = parse("(1 + 2");
        assert!(prog.is_none());
        assert_eq!(diags.len(), 1);
        assert!(diags[0].message.contains(')'), "message was: {}", diags[0].message);
    }

    #[test]
    fn deeply_nested_parens_is_a_diagnostic_not_a_stack_overflow() {
        // Nesting well above MAX_PARSE_DEPTH must yield a Diagnostic from the depth guard, never a
        // native parser stack overflow (an uncatchable process abort).
        let depth = (MAX_PARSE_DEPTH as usize) * 4;
        let src = format!("{}1{}", "(".repeat(depth), ")".repeat(depth));
        let (prog, diags) = parse(&src);
        assert!(prog.is_none());
        assert!(diags.iter().any(|d| d.message.contains("nested too deeply")), "diags: {diags:?}");
    }

    #[test]
    fn deeply_nested_fn_blocks_are_a_diagnostic_not_a_stack_overflow() {
        // Nested `fn` bodies recurse through parse_fn -> parse_braced_block without ever entering
        // parse_binary, so this exercises the block-nesting guard specifically.
        let n = 1000usize;
        let src = format!("{}0{}", "fn f() { ".repeat(n), " }".repeat(n));
        let (prog, diags) = parse(&src);
        assert!(prog.is_none());
        assert!(diags.iter().any(|d| d.message.contains("too deeply")), "diags: {diags:?}");
    }

    #[test]
    fn deeply_nested_while_blocks_are_a_diagnostic_not_a_stack_overflow() {
        let n = 1000usize;
        let src = format!("{}{}", "while true { ".repeat(n), "}".repeat(n));
        let (prog, diags) = parse(&src);
        assert!(prog.is_none());
        assert!(diags.iter().any(|d| d.message.contains("too deeply")), "diags: {diags:?}");
    }

    #[test]
    fn oversized_program_is_a_diagnostic_not_a_stack_overflow() {
        // A program exceeding MAX_TOKENS must yield a Diagnostic, never a native stack overflow during
        // the deep recursive passes. A long `1 + 1 + ...` chain parses iteratively but would otherwise
        // build a very deep tree that overflows typecheck/desugar/eval.
        let src = format!("1{}", " + 1".repeat(MAX_TOKENS));
        let (prog, diags) = parse(&src);
        assert!(prog.is_none());
        assert!(diags.iter().any(|d| d.message.contains("too large")), "diags: {diags:?}");
    }
}
