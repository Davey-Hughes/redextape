//! Hand-written Pratt (precedence-climbing) parser: `&str` -> `Program`. Produces spanned
//! diagnostics; `parse_full`/`parse` return `Some` only when complete, `parse_recovering` always
//! returns a tree (since a partial tree would be deleted by `format` = `print ∘ parse`).

use crate::ast::{BinOp, Block, Expr, Param, Program, Stmt};
use crate::diagnostic::Diagnostic;
use crate::lexer::lex;
use crate::span::Span;
use crate::token::{Comment, Token, TokenKind};

/// Maximum number of tokens (including the trailing `Eof`) a program may contain. This is now only
/// a coarse resource bound — it caps the memory and time spent lexing/parsing pathological input —
/// NOT the stack-safety mechanism: each recursive pass (parser, typecheck, eval) has its own
/// depth guard (`MAX_PARSE_DEPTH`, `MAX_TYPE_DEPTH`, `MAX_EVAL_DEPTH`) that turns deep-but-narrow
/// input into a `Diagnostic`/`RuntimeError` well before a native stack overflow, independent of
/// how many tokens the program contains.
pub const MAX_TOKENS: usize = 100_000;

/// A parse and everything needed to print it back: the tree, its trivia, and the string both are
/// measured against.
///
/// THE THREE TRAVEL TOGETHER BECAUSE A MISMATCH AMONG THEM IS SILENT. Comments carry byte offsets;
/// resolving them against a different string yields text from the wrong place with no error and no
/// empty result. `analysis::attribute_tm_spans` records the same failure from the version that took a
/// map and a machine as two arguments — it "could not check they described one lowering", and
/// resolved every id to some other state's name. One value makes that unrepresentable.
#[derive(Debug)]
pub struct Parsed<'a> {
    pub program: Program,
    pub comments: Vec<Comment>,
    pub src: &'a str,
}

/// Parse `src`, keeping its trivia, and always answer a tree.
///
/// A failed parse yields a tree carrying `Stmt::Error`/`Expr::Error` nodes marking the source
/// recovery could not read. The diagnostics say what went wrong.
///
/// **THIS IS NOT A REPLACEMENT FOR `parse_full`, IT IS THE OTHER HALF OF A SPLIT CONTRACT.**
/// `format` is `print ∘ parse`, so a `parse` that answered a partial tree would have `format` write
/// that tree back over the author's buffer and delete the part that did not parse. Consumers that
/// print, lower, or evaluate must keep going through `parse`/`parse_full`; this exists for
/// navigation, which is worth most on exactly the broken files those must refuse.
#[must_use]
pub fn parse_recovering(src: &str) -> (Parsed<'_>, Vec<Diagnostic>) {
    let (parsed, diags, _complete) = parse_inner(src);
    (parsed, diags)
}

/// Parse `src`, keeping its trivia. `Some` only when the entire input parsed.
///
/// `comments` is sorted by start offset and no comment overlaps a token, which is what lets the
/// printer walk it with a single forward cursor.
#[must_use]
pub fn parse_full(src: &str) -> (Option<Parsed<'_>>, Vec<Diagnostic>) {
    let (parsed, diags, complete) = parse_inner(src);
    if complete { (Some(parsed), diags) } else { (None, diags) }
}

/// The one parse. `bool` is whether it was complete — no lexer diagnostic, within `MAX_TOKENS`, and
/// no recovery.
fn parse_inner(src: &str) -> (Parsed<'_>, Vec<Diagnostic>, bool) {
    let (tokens, comments, lex_diags) = lex(src);
    let clean_lex = lex_diags.is_empty();
    let mut diags = lex_diags;
    let whole = Span::new(0, src.len());
    if tokens.len() > MAX_TOKENS {
        diags.push(Diagnostic::error(
            whole,
            format!("program too large: {} tokens exceeds the maximum of {MAX_TOKENS} (deeply nested or very long programs are rejected to avoid stack overflow)", tokens.len()),
        ));
        let program = Program { block: Block { stmts: Vec::new(), tail: None, span: whole } };
        return (Parsed { program, comments, src }, diags, false);
    }
    let mut p = Parser { src, tokens, pos: 0, depth: 0, diags: Vec::new(), recovered: 0 };
    let program = p.parse_program();
    p.finish_diagnostics();
    let complete = clean_lex && p.recovered == 0;
    diags.extend(p.diags);
    // Two passes produce these — the lexer left to right, then the parser — so their concatenation
    // is not sorted by construction even though each half is.
    diags.sort_by_key(|d| d.span.start);
    (Parsed { program, comments, src }, diags, complete)
}

/// Parse `src`, discarding trivia. The entry point for every consumer that wants a tree and nothing
/// else — roughly 25 call sites across this workspace, none of which formats anything.
#[must_use]
pub fn parse(src: &str) -> (Option<Program>, Vec<Diagnostic>) {
    let (parsed, diags) = parse_full(src);
    (parsed.map(|p| p.program), diags)
}

/// Maximum nesting depth (parens, brackets, nested calls, nested blocks — anything that recurses
/// through `parse_binary`) `parse_binary` will descend before giving up. Every nested sub-expression
/// passes through `parse_binary`, so counting its recursion depth bounds the parser's native stack
/// usage; input nested deeper than this yields a `Diagnostic` instead of a parser stack overflow
/// (an uncatchable process abort). Chosen empirically at roughly half the depth that overflows an
/// 8 MiB debug main thread (see the crash-harness measurements in the robust-fix report).
pub const MAX_PARSE_DEPTH: u32 = 300;

/// Recovered constructs past which diagnostics stop being recorded.
///
/// Recovery itself does NOT stop — the tree stays as complete as it can be, because navigation
/// reads the tree and not the diagnostics. What stops is the reporting: `MAX_TOKENS` is 100,000 and
/// a file of pure garbage recovers at roughly one construct per token, which is 100,000 diagnostics
/// pushed to an editor that re-parses on every keystroke.
const MAX_RECOVERED_DIAGNOSTICS: usize = 100;

struct Parser<'a> {
    src: &'a str,
    tokens: Vec<Token>,
    pos: usize,
    depth: u32,
    /// Diagnostics recovery recorded rather than propagated through `PResult`.
    diags: Vec<Diagnostic>,
    /// How many times recovery fired. `parse_full` answers `None` when this is non-zero, which is
    /// the whole of the contract split — see the module's two entry points.
    recovered: usize,
}

type PResult<T> = Result<T, Diagnostic>;

/// One turn of `parse_block_body`'s loop: a statement, or the block's tail expression.
enum BlockItem {
    Stmt(Stmt),
    Tail(Expr),
}

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

    /// Record a diagnostic recovery produced, and count the recovery.
    ///
    /// The COUNT is unconditional and the RECORDING is capped, so `parse_full`'s answer never
    /// depends on how many errors a file has — only on whether it had any.
    fn record(&mut self, d: Diagnostic) {
        self.recovered += 1;
        if self.recovered <= MAX_RECOVERED_DIAGNOSTICS {
            self.diags.push(d);
        }
    }

    /// Append the summary line when the cap suppressed anything. Called once, after parsing.
    fn finish_diagnostics(&mut self) {
        let Some(n) = self.recovered.checked_sub(MAX_RECOVERED_DIAGNOSTICS) else { return };
        if n == 0 {
            return;
        }
        let end = self.src.len();
        self.diags.push(Diagnostic::error(Span::new(end, end), format!("{n} further parse errors not reported")));
    }

    fn parse_program(&mut self) -> Program {
        let mut block = self.parse_block_body(TokenKind::Eof);
        // `parse_block_body`'s `Tail` arm can break its loop on a token that is not `close` (a tail
        // expression not followed by `;` stops the loop, not the input), and every OTHER exit is
        // followed by a caller-side `expect(close)` that turns leftover tokens into a recorded
        // diagnostic — except this one, the top level, which has no such caller. Without this check
        // trailing tokens are silently dropped and the parse reports as complete. `bump` never
        // advances past `Eof`, so the absorbing loop below always terminates.
        if self.peek().kind != TokenKind::Eof {
            let start = self.peek().span;
            let mut end = start;
            while self.peek().kind != TokenKind::Eof {
                end = self.bump().span;
            }
            let span = start.merge(end);
            self.record(Diagnostic::error(start, "expected end of input"));
            // `Block` holds `tail` conceptually AFTER `stmts`, but these absorbed tokens come LAST
            // in the source. Left in `tail`, the `Stmt::Error` pushed below would sit BEFORE it in
            // the tree while coming after it in the source -- exactly backwards, and a navigation
            // index that assumes source order would misplace every name in `tail`. Demoting the
            // tail into `stmts` first keeps the statement list in source order; it prints with a
            // trailing `;` the source never had, which is acceptable here because a tree containing
            // `Stmt::Error` never reaches `format`, and source order is what the recovered tree
            // exists to provide.
            if let Some(tail) = block.tail.take() {
                block.stmts.push(Stmt::Expr(*tail));
            }
            block.stmts.push(Stmt::Error { span });
            block.span = block.span.merge(span);
        }
        Program { block }
    }

    /// What one turn of the statement loop produced.
    fn parse_block_item(&mut self) -> PResult<BlockItem> {
        match self.peek().kind {
            TokenKind::Let => return Ok(BlockItem::Stmt(self.parse_let()?)),
            TokenKind::Fn => return Ok(BlockItem::Stmt(self.parse_fn()?)),
            TokenKind::While => return Ok(BlockItem::Stmt(self.parse_while()?)),
            _ => {}
        }
        // An identifier followed by `=` is an assignment statement.
        if self.peek().kind == TokenKind::Ident && self.tokens[self.pos + 1].kind == TokenKind::Assign {
            return Ok(BlockItem::Stmt(self.parse_assign()?));
        }
        let e = self.parse_expr()?;
        if self.peek().kind == TokenKind::Semi {
            self.bump();
            Ok(BlockItem::Stmt(Stmt::Expr(e)))
        } else {
            Ok(BlockItem::Tail(e))
        }
    }

    /// Skip forward to just past the next `;`, or to the `}` or end of input that closes the
    /// construct recovery started inside — whichever comes first.
    ///
    /// **THE DEPTH COUNTER IS WHAT MAKES THIS SAFE INSIDE A NESTED BLOCK.** Without it, resync
    /// cannot tell a nested block's own `;` from a statement boundary. On `"fn (a) { 1; } fn g(b) {
    /// b }"` — where the missing name fails `parse_fn` before it ever reaches the body — a
    /// depth-blind resync stops at the body's `;` instead of running past the `}` that closes it,
    /// leaving that `}` behind as a stray token that costs a second, unrelated diagnostic.
    ///
    /// Consumes nothing at `Eof` or at a `}` belonging to an enclosing block, which is what leaves
    /// the enclosing `parse_block_body` free to see its own close token. That also means resync can
    /// return without advancing, which is why its caller carries the progress rule.
    fn resync(&mut self) {
        let mut depth = 0usize;
        loop {
            match self.peek().kind {
                TokenKind::Eof => return,
                TokenKind::LBrace => {
                    depth += 1;
                    self.bump();
                }
                TokenKind::RBrace => {
                    if depth == 0 {
                        return;
                    }
                    depth -= 1;
                    self.bump();
                    // A block closing back to the depth we started at IS a statement boundary.
                    // Without this, `fn (a) { 1; }` — which fails at the missing name, before its
                    // body — resyncs past the body's `}` and then keeps going, because there is no
                    // `;` after a braced construct. It would eat every following declaration.
                    if depth == 0 {
                        return;
                    }
                }
                TokenKind::Semi if depth == 0 => {
                    self.bump();
                    return;
                }
                _ => {
                    self.bump();
                }
            }
        }
    }

    /// `expect`, but a mismatch is recorded rather than propagated. Answers the span the construct
    /// should end at: the matched token's, when it was consumed, or a zero-width span at the
    /// current token's start when nothing matched.
    ///
    /// **ZERO-WIDTH, NOT THE MISMATCHED TOKEN'S FULL SPAN.** That token was never consumed here --
    /// it still belongs to whatever the caller parses next. Answering its full span used to make
    /// the construct claim source that a following sibling also claims: `"let x = 1 let y = 2; y"`
    /// gave `Let(x)` the span `0..13` ("let x = 1 let", swallowing the next statement's `let`) and
    /// `Let(y)` `10..20`, overlapping it. A zero-width span at the same start point marks exactly
    /// where the construct ended without stealing source the next construct still owns.
    ///
    /// Recording here counts a recovery, so `parse_full` still answers `None` for the file.
    fn expect_or_record(&mut self, kind: TokenKind, what: &str) -> Span {
        let t = self.peek();
        if t.kind == kind {
            self.bump().span
        } else {
            self.record(Diagnostic::error(t.span, format!("expected {what}")));
            Span::new(t.span.start, t.span.start)
        }
    }

    /// Parse an expression, or record the failure and answer an `Expr::Error` covering what was
    /// consumed trying.
    ///
    /// **DOES NOT RESYNC.** The statement that called this owns the resync rule, and skipping ahead
    /// here would eat the `;` the caller is about to expect. When a token was consumed trying, the
    /// span covers it; when nothing was -- whether that is real end of input, or `parse_expr`
    /// failing on the very first token it saw -- the span is a zero-width position at that token's
    /// start, not the token's full span. The token was never consumed, so it still belongs to
    /// whatever the caller parses next; claiming its full span here is what let `"let x =\nlet y =
    /// 1;\ny"` give `Let(x)` the span `0..11` ("let x =\nlet"), overlapping the following `Let(y)`.
    /// A zero-width span still marks the correct insertion point, and `record` still fires there so
    /// the source-loss invariant holds.
    fn parse_expr_recovering(&mut self) -> Expr {
        let before = self.pos;
        match self.parse_expr() {
            Ok(e) => e,
            Err(d) => {
                self.record(d);
                let start = self.tokens[before].span.start;
                let span = if self.pos == before {
                    Span::new(start, start)
                } else {
                    let end = self.tokens[self.pos - 1].span;
                    self.tokens[before].span.merge(end)
                };
                Expr::Error { span }
            }
        }
    }

    /// Parse statements + optional tail until (but not consuming) `close`, or until end of input.
    ///
    /// **INFALLIBLE, AND THAT IS THE RECOVERY.** A statement that does not parse becomes a
    /// `Stmt::Error` and the loop carries on, so one bad line costs one line rather than the file.
    /// Stopping at `Eof` as well as at `close` is what keeps an unclosed block's body: the caller
    /// records the missing brace instead of propagating an error that would discard everything
    /// collected here.
    fn parse_block_body(&mut self, close: TokenKind) -> Block {
        let start = self.peek().span;
        let mut stmts = Vec::new();
        let mut tail = None;
        // A statement loop cannot legitimately run more times than there are tokens. Exceeding that
        // turns a hang into a diagnostic, the same shape `MAX_TOKENS` and `MAX_PARSE_DEPTH` use.
        let bound = self.tokens.len() + 1;
        let mut turns = 0usize;
        while self.peek().kind != close && self.peek().kind != TokenKind::Eof {
            turns += 1;
            if turns > bound {
                self.record(Diagnostic::error(self.peek().span, "parser made no progress"));
                break;
            }
            let before = self.pos;
            match self.parse_block_item() {
                Ok(BlockItem::Stmt(s)) => stmts.push(s),
                Ok(BlockItem::Tail(e)) => {
                    tail = Some(Box::new(e));
                    break;
                }
                Err(d) => {
                    self.record(d);
                    self.resync();
                    // `resync` returns without advancing at a `}` that closes an enclosing block,
                    // and `parse_block_item` can fail without consuming (the depth guard does).
                    // One bump is what guarantees the loop terminates.
                    if self.pos == before {
                        self.bump();
                    }
                    let end = self.tokens[self.pos.saturating_sub(1).max(before)].span;
                    stmts.push(Stmt::Error { span: self.tokens[before].span.merge(end) });
                }
            }
        }
        // The loop above can exit two ways: at `close` (or `Eof`, when `close` IS `Eof`), where
        // `peek` is the token that ends this block and its full span belongs to the block -- a
        // brace-delimited block covers its own closing brace, which is existing behaviour. Or via
        // the `Tail` arm's `break`, on whatever token stopped the tail expression, which was never
        // consumed and still belongs to whatever the caller parses next: `"fn f(a) { 1 let x = 1;
        // }"` took that `let`'s full span into the block here, which then extended into `Stmt::Fn`'s
        // own span and overlapped the sibling `Stmt::Let` parsed from the very same `let`. A
        // zero-width span at the stopping token's start marks the block's end without claiming it.
        let peek = self.peek();
        let end = if peek.kind == close { peek.span } else { Span::new(peek.span.start, peek.span.start) };
        Block { stmts, tail, span: start.merge(end) }
    }

    fn parse_let(&mut self) -> PResult<Stmt> {
        let kw = self.expect(TokenKind::Let, "`let`")?;
        let mutable = if self.peek().kind == TokenKind::Mut {
            self.bump();
            true
        } else {
            false
        };
        // Still propagating: with no name, or a name but no `=`, there is no well-formed binding
        // to salvage, and the statement is a `Stmt::Error` in full. Recovery in place begins at
        // the value, below.
        let name_tok = self.expect(TokenKind::Ident, "a variable name")?;
        let name = self.text(name_tok.span);
        self.expect(TokenKind::Assign, "`=`")?;
        let value = self.parse_expr_recovering();
        let semi = self.expect_or_record(TokenKind::Semi, "`;`");
        Ok(Stmt::Let { name, name_span: name_tok.span, mutable, value, span: kw.span.merge(semi) })
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
        Ok(Stmt::Fn { name, name_span: name_tok.span, params, body, span })
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
        let value = self.parse_expr_recovering();
        let semi = self.expect_or_record(TokenKind::Semi, "`;`");
        Ok(Stmt::Assign { target, target_span: name_tok.span, value, span: name_tok.span.merge(semi) })
    }

    fn parse_param_list(&mut self, close: TokenKind) -> PResult<Vec<Param>> {
        let mut params = Vec::new();
        while self.peek().kind != close {
            let tok = self.expect(TokenKind::Ident, "a parameter name")?;
            params.push(Param { name: self.text(tok.span), span: tok.span });
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
        // Still propagating: with no `{` there is no block, and the construct is a `Stmt::Error`.
        self.expect(TokenKind::LBrace, "`{`")?;
        let block = self.parse_block_body(TokenKind::RBrace);
        // **NOT `?`.** `parse_block_body` consumes to end of input looking for this brace, so
        // everything it collected belongs to the statement that would fail here. Propagating
        // discards the file from an unclosed brace onward, and an unclosed brace is what a buffer
        // looks like while its author is still inside the function.
        self.expect_or_record(TokenKind::RBrace, "`}`");
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
                    e = Expr::Method { recv: Box::new(e), name, name_span: name_tok.span, args, span };
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
                // MERGED WITH THE `{`, not taken from `block.span`. `parse_block_body` starts its span
                // at the first token INSIDE the braces, so `block.span` runs first-inner-token..`}` —
                // fine for a `Block`, which is a body and not an expression, but wrong for the
                // expression that CONTAINS it. Every other `Expr` variant's span covers its own opening
                // token (`Expr::List` merges `t.span` with the `]` right above), and the printer relies
                // on that: it uses `item.span().start` as "the offset this item's printed text begins
                // at" to decide what a comment precedes and how many newlines the author left before it.
                // With the inner start, a comment between `{` and the first statement read as being
                // BEFORE the block entirely and escaped its braces, and the gap measured for blank
                // lines ran across the `{` and its newline, inventing one. Design §14 and §17.
                let span = t.span.merge(block.span);
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
    fn parse_full_returns_the_comments_beside_the_program() {
        let src = "// lead\nlet x = 1; // trail\nx";
        let (parsed, diags) = parse_full(src);
        assert!(diags.is_empty(), "unexpected diagnostics: {diags:?}");
        let parsed = parsed.expect("a clean program parses");
        assert_eq!(parsed.src, src);
        let texts: Vec<&str> = parsed.comments.iter().map(|c| &src[c.span.start..c.span.end]).collect();
        assert_eq!(texts, vec!["// lead", "// trail"]);
        assert_eq!(parsed.program.block.stmts.len(), 1);
    }

    #[test]
    fn parse_full_yields_none_and_diagnostics_on_malformed_input() {
        let (parsed, diags) = parse_full("let x = ;");
        assert!(parsed.is_none(), "a program that does not parse yields no Parsed");
        assert!(!diags.is_empty(), "and says why");
    }

    #[test]
    fn parse_is_unchanged_and_still_returns_a_two_tuple() {
        let (program, diags) = parse("let x = 1; x");
        assert!(diags.is_empty());
        assert!(program.is_some());
    }

    #[test]
    fn comments_are_sorted_by_start_offset() {
        let src = "// a\nlet x = 1; // b\n// c\nx";
        let (parsed, _) = parse_full(src);
        let parsed = parsed.expect("parses");
        assert!(
            parsed.comments.windows(2).all(|w| w[0].span.start < w[1].span.start),
            "the printer's cursor walks this list once, forwards"
        );
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
            matches!(&prog.block.stmts[0], Stmt::Fn { name, params, .. } if name == "count_down" && params.iter().map(|p| p.name.as_str()).collect::<Vec<_>>() == vec!["n"])
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
    fn parse_recovering_always_answers_a_tree_and_parse_full_only_answers_a_complete_one() {
        // BOTH HALVES ARE LOAD-BEARING. Without the clean-input half, a `parse_recovering` that
        // always returned an empty tree would satisfy the broken-input half.
        let clean = "let x = 1; x + 1";
        let (recovered, rd) = parse_recovering(clean);
        let (full, fd) = parse_full(clean);
        assert!(rd.is_empty() && fd.is_empty(), "clean input: {rd:?} {fd:?}");
        assert_eq!(recovered.program, full.expect("clean input parses").program, "same tree");

        let broken = "let x = ";
        let (_, rd) = parse_recovering(broken);
        let (full, fd) = parse_full(broken);
        assert!(full.is_none(), "parse_full must not hand a partial tree to `format`");
        assert!(!rd.is_empty() && !fd.is_empty(), "both report the error: {rd:?} {fd:?}");
    }

    #[test]
    fn diagnostics_come_back_ordered_by_span() {
        // The editor renders them in list order. Lexer diagnostics and parser diagnostics are
        // produced by two separate passes, so their concatenation is not sorted by construction.
        // `"let = 1;\n@"` gives both: the parser fails immediately at the `=` (offset 4, where a
        // variable name was expected), while the lexer's unknown-character diagnostic for `@` sits
        // near the end (offset 9) — lexer-first concatenation puts the higher offset ahead of the
        // lower one, so the assertion below is false without the sort.
        let (_, diags) = parse_recovering("let = 1;\n@");
        assert!(diags.len() >= 2, "need both a lexer and a parser diagnostic: {diags:?}");
        assert!(diags.windows(2).all(|w| w[0].span.start <= w[1].span.start), "diagnostics out of order: {diags:?}");
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

    #[test]
    fn every_parse_error_is_reported_not_just_the_first() {
        // This pins the recovery machinery at the `parse_recovering` entry point: three broken
        // statements, three diagnostics, and the two good statements around them survive. But
        // `parse_recovering` has no caller outside this module's own tests — nothing in this crate
        // or its consumers reaches it yet. The shipping path is `analyze` -> `parser::parse` ->
        // `parse_full` -> `parse_inner`, which this test never exercises even though it shares
        // `parse_inner` with `parse_recovering`. `analyze_reports_every_parse_error_not_just_the_first`
        // (in this crate's root, alongside `analyze`) asserts the same property on that path, and
        // is the one that covers what actually ships.
        let src = "let a = ; let b = 1; let c = ; let d = 2; let e = ;";
        let (parsed, diags) = parse_recovering(src);
        assert_eq!(diags.len(), 3, "one per broken statement: {diags:?}");
        let good = parsed
            .program
            .block
            .stmts
            .iter()
            .filter(|s| matches!(s, Stmt::Let { name, .. } if name == "b" || name == "d"))
            .count();
        assert_eq!(good, 2, "the statements between the errors must survive");
    }

    #[test]
    fn recovery_makes_progress_on_a_token_it_cannot_start_a_statement_with() {
        // A stray `}` at top level starts no statement and `resync` returns on it without
        // consuming, so without the progress bump `parse_block_body` spins forever. With the
        // iteration bound in place the failure is a diagnostic rather than a hang, and this
        // asserts that bound never fires.
        let (parsed, diags) = parse_recovering("} } } let x = 1; x");
        assert!(
            !diags.iter().any(|d| d.message.contains("parser made no progress")),
            "the progress bump should have kept the bound from firing: {diags:?}"
        );
        // An assertion of absence alone would also pass an implementation that silently swallowed
        // the three stray `}` with no diagnostic at all — the same defect class as a parse that
        // drops tokens without recording them. Pin what recovery actually did: one diagnostic per
        // stray `}`, one `Stmt::Error` per stray `}` at its own span, and the `let` and its tail
        // surviving past them.
        assert_eq!(diags.len(), 3, "one diagnostic per stray `}}`: {diags:?}");
        assert!(diags.iter().all(|d| d.message.contains("expected an expression")), "{diags:?}");
        let error_spans: Vec<Span> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Error { span } => Some(*span),
                _ => None,
            })
            .collect();
        assert_eq!(error_spans, vec![Span::new(0, 1), Span::new(2, 3), Span::new(4, 5)], "{error_spans:?}");
        assert!(
            parsed.program.block.stmts.iter().any(|s| matches!(s, Stmt::Let { name, .. } if name == "x")),
            "the `let` after the stray `}}`s must survive: {:?}",
            parsed.program.block.stmts
        );
        assert!(parsed.program.block.tail.is_some(), "the tail expression must survive");
    }

    #[test]
    fn resync_skips_a_whole_nested_block_and_stops_at_its_end() {
        // A `fn` with no name fails BEFORE its body, so resync meets the body's braces. It must
        // consume the block whole and stop at the `}` that closes it — not stop at the `{`, and
        // not run past the `}` looking for a `;` that a braced construct never has. Either
        // mistake swallows `g`.
        let src = "fn (a) { 1; } fn g(b) { b }";
        let (parsed, diags) = parse_recovering(src);
        let names: Vec<&str> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Fn { name, .. } => Some(name.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(names, vec!["g"], "the next function must survive recovery: {names:?}");
        // The direct property: the `Stmt::Error` covers exactly the malformed `fn`'s span, "fn (a) {
        // 1; }", and nothing of `fn g`.
        let error_spans: Vec<Span> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Error { span } => Some(*span),
                _ => None,
            })
            .collect();
        assert_eq!(error_spans, vec![Span::new(0, 13)], "{error_spans:?}");
        // The depth counter is what makes this ONE diagnostic rather than two: with it broken,
        // resync cannot tell the body's own `;` from a statement boundary and stops there instead
        // of running past the `}` that closes the body, leaving that `}` behind as a stray token
        // that trips a second, unrelated diagnostic on the way out (verified by disabling the depth
        // increment: `g` still survives, but `diags` gains "expected an expression" for the stray
        // `}`).
        assert_eq!(diags.len(), 1, "resync must swallow the malformed fn whole, in one diagnostic: {diags:?}");
    }

    #[test]
    fn trailing_tokens_after_a_complete_program_are_not_silently_dropped() {
        // `parse_block_body`'s `Tail` arm stops the loop on the first token that cannot extend the
        // tail expression, not on `close`/`Eof`. Without a caller-side check, `parse_program` reports
        // a complete parse while the tokens after the tail sit unconsumed, and `format` = `print ∘
        // parse` then prints only what it saw and deletes the rest of the author's buffer.
        assert!(crate::format("1 2").is_err(), "trailing `2` must not be silently discarded");
        assert!(crate::format("fn f(a) { a } 9 8 7").is_err(), "trailing `8 7` must not be silently discarded");
        assert!(crate::format("1 }").is_err(), "trailing `}}` must not be silently discarded");
        // Positive controls: the assertions above must not pass by rejecting everything.
        assert!(crate::format("1").is_ok(), "a single tail expression must still format");
        assert!(crate::format("fn f(a) { a }").is_ok(), "a single complete statement must still format");
    }

    #[test]
    fn a_binding_whose_value_does_not_parse_still_binds_its_name() {
        // THE REASON Expr::Error EXISTS. `@@@` is skipped by the lexer, so the parser meets
        // `let x = ;` and has nothing to put in `value`. Dropping the statement would lose `x` --
        // which is the name under the cursor at the moment someone is typing its value.
        let (parsed, diags) = parse_recovering("let x = @@@; let y = 2; x + y");
        assert!(!diags.is_empty(), "the broken value must be reported");
        let bound: Vec<&str> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Let { name, .. } => Some(name.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(bound, vec!["x", "y"], "both bindings survive: {bound:?}");
    }

    #[test]
    fn the_error_expression_spans_the_source_that_did_not_parse() {
        // `let x = ;` -- the `;` is where an expression was expected, at offset 8. Nothing was
        // consumed trying to parse it (the `;` isn't a valid expression start and `parse_atom`'s
        // failing arm never bumps), so the span is zero-width AT that offset, not the `;` token's
        // full 8..9: that token was never consumed and still belongs to the statement's own `;`
        // (`expect_or_record` claims it right after). An over-wide span here would claim a
        // not-yet-consumed token twice -- once for this `Expr::Error` and once for whatever
        // construct actually consumes it next, which is how sibling spans end up overlapping.
        let (parsed, _) = parse_recovering("let x = ;");
        let value_span = parsed.program.block.stmts.iter().find_map(|s| match s {
            Stmt::Let { value: Expr::Error { span }, .. } => Some(*span),
            _ => None,
        });
        assert_eq!(value_span, Some(Span::new(8, 8)), "zero-width at the position the value was expected");
    }

    #[test]
    fn absorbed_trailing_tokens_come_after_a_demoted_tail_not_before_it() {
        // `Block` holds `tail` conceptually AFTER `stmts`, but the trailing tokens `parse_program`
        // absorbs come LAST in the source. `"1 2"` -- `1` parses as the block's tail, then `2` is
        // trailing and gets absorbed into a `Stmt::Error`. Left in `tail`, that `Error` would sit
        // BEFORE the `1` in the tree while coming after it in the source: a navigation index
        // scanning `stmts` first would see the space `2` occupies before it saw `1`'s.
        let (parsed, diags) = parse_recovering("1 2");
        assert!(!diags.is_empty(), "the trailing `2` must be reported");
        assert!(parsed.program.block.tail.is_none(), "the tail is demoted into `stmts`, not left behind");
        assert_eq!(
            parsed.program.block.stmts,
            vec![Stmt::Expr(Expr::Nat { value: 1, span: Span::new(0, 1) }), Stmt::Error { span: Span::new(2, 3) }],
            "the demoted tail comes first, in source order, then the absorbed trailing token"
        );
    }

    #[test]
    fn a_mismatched_expect_or_record_does_not_claim_the_next_statements_first_token() {
        // DEFECT 2, site (a): `expect_or_record` used to answer a MISMATCHED token's full span, even
        // though that token was never consumed. `"let x = 1 let y = 2; y"` -- `Let(x)`'s `;` check
        // meets the second `let` instead, which `expect_or_record` records and must not claim: it
        // still belongs to `Let(y)`, parsed right after. Before the fix this gave `Let(x)` the span
        // `0..13` ("let x = 1 let") and `Let(y)` `10..20`, overlapping it.
        let (parsed, diags) = parse_recovering("let x = 1 let y = 2; y");
        assert!(!diags.is_empty(), "the missing `;` must be reported");
        let spans: Vec<Span> = parsed.program.block.stmts.iter().map(Stmt::span).collect();
        assert_eq!(
            spans,
            vec![Span::new(0, 10), Span::new(10, 20)],
            "Let(x) ends exactly where the unconsumed second `let` starts, not past it"
        );
        assert!(spans.windows(2).all(|w| w[0].end <= w[1].start), "siblings must not overlap: {spans:?}");
        let names: Vec<&str> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Let { name, .. } => Some(name.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(names, vec!["x", "y"], "both bindings must still be recovered: {names:?}");
    }

    #[test]
    fn an_expr_recovering_failure_that_consumes_nothing_does_not_claim_the_next_statements_keyword() {
        // DEFECT 2, site (b): `parse_expr_recovering` used to answer `tokens[before]`'s full span even
        // when `parse_expr` consumed nothing trying it. `"let x =\nlet y = 1;\ny"` -- `Let(x)`'s value
        // meets the keyword `let` instead of an expression, consumes nothing, and must not claim it:
        // it still belongs to `Let(y)`. Before the fix this gave `Let(x)` the span `0..11` ("let
        // x =\nlet") and `Let(y)` `8..18`, overlapping it.
        let (parsed, diags) = parse_recovering("let x =\nlet y = 1;\ny");
        assert!(!diags.is_empty(), "the missing value must be reported");
        let spans: Vec<Span> = parsed.program.block.stmts.iter().map(Stmt::span).collect();
        assert_eq!(
            spans,
            vec![Span::new(0, 8), Span::new(8, 18)],
            "Let(x) ends exactly where the unconsumed `let` starts, not past it"
        );
        assert!(spans.windows(2).all(|w| w[0].end <= w[1].start), "siblings must not overlap: {spans:?}");
        let value_span = parsed.program.block.stmts.iter().find_map(|s| match s {
            Stmt::Let { value: Expr::Error { span }, .. } => Some(*span),
            _ => None,
        });
        assert_eq!(value_span, Some(Span::new(8, 8)), "zero-width at the `let` keyword's start");
    }

    #[test]
    fn a_block_that_stops_on_its_tail_does_not_claim_the_next_statements_first_token() {
        // DEFECT 2, site (c): `parse_block_body`'s own end span used to be `self.peek().span`
        // unconditionally, even when the loop stopped on the `Tail` arm's `break` rather than at
        // `close`. `"fn f(a) { 1 let x = 1; } g()"` -- the body's tail (`1`) is followed by `let`, not
        // `}`, so the body never reaches its own closing brace; the `let` was never consumed and
        // still belongs to the top-level `Stmt::Let` parsed right after. Before the fix this let
        // `Fn`'s span run into that `let`, overlapping the sibling `Stmt::Let`.
        let (parsed, diags) = parse_recovering("fn f(a) { 1 let x = 1; } g()");
        assert!(!diags.is_empty(), "the missing `}}` must be reported");
        let spans: Vec<Span> = parsed.program.block.stmts.iter().map(Stmt::span).collect();
        assert_eq!(
            spans,
            vec![Span::new(0, 12), Span::new(12, 22), Span::new(23, 24)],
            "Fn(f) ends exactly where the unconsumed `let` starts, not past it"
        );
        assert!(spans.windows(2).all(|w| w[0].end <= w[1].start), "siblings must not overlap: {spans:?}");
        let body_span = parsed.program.block.stmts.iter().find_map(|s| match s {
            Stmt::Fn { name, body, .. } if name == "f" => Some(body.span),
            _ => None,
        });
        assert_eq!(body_span, Some(Span::new(10, 12)), "the body itself ends at the unconsumed `let`'s start");
    }

    #[test]
    fn a_recovered_value_makes_parse_full_answer_none() {
        // The two tests above use `@@@`, which is a LEXER error -- their `!diags.is_empty()`
        // assertion holds even if `parse_expr_recovering` never called `record`, because the
        // lexer's own diagnostic covers for it. This input lexes clean, so the only diagnostic
        // `parse_full` can see is the one `record` produces, which is what actually flips
        // `parse_full` to `None` and keeps a lossy tree away from `format`.
        let src = "let x = ; let y = 2; x + y";
        let (parsed, diags) = parse_recovering(src);
        assert!(!diags.is_empty(), "the missing value must be reported");
        let bound: Vec<(&str, bool)> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Let { name, value, .. } => Some((name.as_str(), matches!(value, Expr::Error { .. }))),
                _ => None,
            })
            .collect();
        assert_eq!(bound, vec![("x", true), ("y", false)], "x survives as an error value, y is untouched: {bound:?}");

        let (full, _) = parse_full(src);
        assert!(full.is_none(), "recovery must count against parse_full, or a lossy tree reaches format");
        assert!(crate::format(src).is_err(), "format must refuse a source that needed recovery");
    }

    #[test]
    fn an_unclosed_block_keeps_the_body_it_collected() {
        // THE CASE THE WHOLE RECOVERY DESIGN TURNS ON. parse_block_body consumes to end of input
        // looking for its `}`, so everything after the brace belongs to the statement that then
        // fails. Propagating that failure discards the file from the brace onward -- and a brace
        // still open is what a buffer looks like while its author is inside the function.
        //
        // This input lexes clean, so -- as with `a_recovered_value_makes_parse_full_answer_none`
        // above -- the only diagnostic in play is the one `expect_or_record` produces. A version
        // that reported the missing brace via a lexer error and then threw the body away would
        // satisfy an assertion built on `@@@`; it cannot satisfy one built on this input.
        let src = "fn f(a) { let y = 1;";
        let (parsed, diags) = parse_recovering(src);
        assert!(!diags.is_empty(), "the missing `}}` must be reported");
        let body_names: Vec<&str> = parsed
            .program
            .block
            .stmts
            .iter()
            .filter_map(|s| match s {
                Stmt::Fn { name, body, .. } if name == "f" => Some(body),
                _ => None,
            })
            .flat_map(|b| {
                b.stmts.iter().filter_map(|s| match s {
                    Stmt::Let { name, .. } => Some(name.as_str()),
                    _ => None,
                })
            })
            .collect();
        // Asserting the BINDING and not the diagnostic count is what makes this test able to fail:
        // a scheme that reported the missing brace and then threw the body away satisfies the
        // assertion above and not this one.
        assert_eq!(body_names, vec!["y"], "the body's bindings must survive: {body_names:?}");

        // The recovery counter, not just the tree's shape: an unclosed block still needed
        // recovery, so `parse_full` must refuse it and `format` -- which writes the tree straight
        // back over the author's buffer -- must not be handed it.
        let (full, _) = parse_full(src);
        assert!(full.is_none(), "an unclosed block recovered, and must count against parse_full");
        assert!(crate::format(src).is_err(), "format must refuse a source with an unclosed block");
    }

    #[test]
    fn the_diagnostic_cap_bounds_the_report_without_bounding_the_recovery() {
        // BOTH HALVES. A cap that also stopped recovering would answer a truncated tree, and
        // navigation reads the tree. 300 broken statements, capped at 100 reports plus one
        // summary, and every one of the 300 still present in the tree.
        let src = "let a = ; ".repeat(300);
        let (parsed, diags) = parse_recovering(&src);
        assert_eq!(diags.len(), MAX_RECOVERED_DIAGNOSTICS + 1, "100 reports and one summary: {}", diags.len());
        assert!(
            diags.last().is_some_and(|d| d.message.contains("further parse errors not reported")),
            "the summary must say how many were suppressed: {:?}",
            diags.last()
        );
        assert_eq!(parsed.program.block.stmts.len(), 300, "recovery itself must not stop at the cap");
    }

    #[test]
    fn parameters_carry_the_span_of_their_own_name() {
        // Both producers go through `parse_param_list`, but they are reached by different callers,
        // so both are pinned. Spans are sliced back out of the source rather than compared to
        // literals: a span that is merely non-empty would satisfy a literal comparison written to
        // match whatever the code happened to produce.
        let src = "fn f(alpha, beta) { 1 }\nlet g = |gamma| gamma;\n0";
        let (program, diags) = parse(src);
        assert!(diags.is_empty(), "{diags:?}");
        let stmts = &program.expect("parses").block.stmts;

        let Stmt::Fn { params, .. } = &stmts[0] else { panic!("expected a fn, got {:?}", stmts[0]) };
        let text: Vec<&str> = params.iter().map(|p| &src[p.span.start..p.span.end]).collect();
        assert_eq!(text, vec!["alpha", "beta"]);
        assert_eq!(params.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["alpha", "beta"]);

        let Stmt::Let { value: Expr::Lambda { params, .. }, .. } = &stmts[1] else {
            panic!("expected a let holding a lambda, got {:?}", stmts[1])
        };
        assert_eq!(params.len(), 1);
        assert_eq!(&src[params[0].span.start..params[0].span.end], "gamma");
    }

    #[test]
    fn format_never_sees_a_recovered_tree() {
        // Asserted at `format`'s own level, not by reasoning about parse_full's callers. This is
        // the property that keeps a recovered tree from being written back over the author's
        // buffer with the unparsed part deleted.
        assert!(crate::format("let x = ").is_err());
        assert!(crate::format("fn f(a) { let y = 1;").is_err());
        assert!(crate::format("let x = @@@;").is_err());
        // And the converse, so the assertions above are not passing because `format` rejects
        // everything.
        assert!(crate::format("let x = 1; x").is_ok());
    }

    #[test]
    fn definitions_and_the_method_callee_carry_the_span_of_their_own_name() {
        // The statement spans these four sit beside are deliberately WIDER than the name — `Let` and
        // `Assign` swallow their `;`, `Fn` runs to the body's `}`, and `Method` covers the whole call
        // — so slicing the name span back out of the source is what separates a real name span from
        // a copy of the statement span.
        let src = "let mut counter = 1; fn compute(a) { a } counter = 2; 1.method()";
        let (program, diags) = parse(src);
        assert!(diags.is_empty(), "{diags:?}");
        let block = program.expect("parses").block;
        let slice = |s: Span| &src[s.start..s.end];

        let Stmt::Let { name_span, span, .. } = &block.stmts[0] else { panic!("{:?}", block.stmts[0]) };
        assert_eq!(slice(*name_span), "counter");
        assert_ne!(name_span, span, "the name span must not be the statement span");

        let Stmt::Fn { name_span, .. } = &block.stmts[1] else { panic!("{:?}", block.stmts[1]) };
        assert_eq!(slice(*name_span), "compute");

        let Stmt::Assign { target_span, .. } = &block.stmts[2] else { panic!("{:?}", block.stmts[2]) };
        assert_eq!(slice(*target_span), "counter");

        let Some(Expr::Method { name_span, .. }) = block.tail.as_deref() else {
            panic!("expected a method call tail, got {:?}", block.tail)
        };
        assert_eq!(slice(*name_span), "method");
    }
}
