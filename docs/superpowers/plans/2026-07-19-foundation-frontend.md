# Redextape Foundation: Front End + Reference Interpreter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `redextape-core`'s front end — lexer → Pratt parser → Hindley–Milner
typechecker → desugar to the Core AST → reference tree-walker interpreter — with spanned
diagnostics surfaced through a public `analyze` / `run` API. This is subsystem #1 of the v1
roadmap; it is the synchronization anchor everything else is built on.

**Architecture:** A single library crate (`crates/redextape-core`) in a new Cargo workspace.
The pipeline is `&str → Vec<Token> → Program (surface AST) → typecheck → Core (Core AST) → Value`.
The Core AST is the spec's sync anchor: every node carries a stable `NodeId`. Malformed input
never panics — it produces `Diagnostic`s with byte-offset spans. The reference interpreter is the
**oracle** later plans check the λ and TM backends against, so it prioritizes obvious correctness
over speed.

**Tech Stack:** Rust (edition 2024), zero runtime dependencies for the core, `proptest` as a
dev-dependency for property tests. Hand-written lexer and Pratt parser; hand-written Algorithm W.

## Global Constraints

Every task's requirements implicitly include these (from the spec + repo config, exact values):

- **Rust edition 2024**; `rustfmt.toml` sets `max_width = 120`, `use_small_heuristics = "Max"`.
- Toolchain `stable` with `rustfmt` + `clippy` (`rust-toolchain.toml`).
- Must pass, at all times: `cargo fmt --all --check`;
  `cargo clippy --workspace --all-targets -- -D warnings`;
  `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`.
- The workspace manifest **must be a root `Cargo.toml`** (the CI `detect` job keys on it).
- **No panics on user input.** Lexer/parser/typechecker report `Diagnostic { span, severity,
  message }`; only genuine internal invariants may `panic!`/`unreachable!`.
- **Every `Core` node carries a `NodeId`** (the source-map anchor, §5.4/§9).
- `Nat` is a non-negative integer with **monus** subtraction (`3 - 5 == 0`, §3.4). Represented as
  `u64` in v1; arithmetic saturates (documented limit — Church numerals are unbounded, `u64` is a
  pragmatic v1 cap).
- **UFCS** `recv.m(args)` desugars to `m(recv, args)` (§3.4) — reduced in Task 5.

## v1 language scope decisions (locked in by this plan)

These resolve ambiguities the spec deliberately left open. Documented here so downstream plans
inherit them:

1. **Types are Hindley–Milner** over the constructors `Nat`, `Bool`, `List<T>`, and n-ary
   functions `(T, …) -> T`, plus an internal `Unit` for statements. Immutable `let` and `fn`
   bindings are generalized (let-polymorphism); `let mut` bindings are monomorphic (value
   restriction — they can be reassigned). This gives sound, annotation-free typing and lets
   `map`/`fold` be polymorphic library code.
2. **List primitives are builtins, not keywords:** `nil : List<a>`, `cons : (a, List<a>) -> List<a>`,
   `head : List<a> -> a`, `tail : List<a> -> List<a>`, `is_empty : List<a> -> Bool`. They are
   ordinary (first-class) identifiers in a prelude env. `map`/`fold` are **not** builtins — they
   are ordinary programs written in the language (this is how §3.3 keeps them "library, not
   built-ins"; pattern matching stays deferred, §3.5 — list deconstruction goes through these).
3. **No boolean operators** in v1 (`&&`, `||`, `!` deferred). `Bool` comes from the comparison
   operators and `is_empty`; control flow is `if`/`else`. This removes the `|` (closure) vs `||`
   (or) lexer ambiguity entirely.
4. **Comparison operators are `Nat`-only** (`==`, `!=`, `<`, `<=`, `>`, `>=` take two `Nat`s,
   yield `Bool`). Equality on `Bool`/`List` is deferred.
5. **`while` and assignment are statements** (no value / internal `Unit`), so v1 needs no
   user-facing unit type. A block used where a value is required must end in a tail expression
   (the typechecker enforces this).
6. **Closures require ≥1 parameter** (so `||` never appears). Named `fn` may be nullary.
7. **`fn` is a recursive binding; `let` is non-recursive.** (`fn` → `LetRec`, `let` → `Let`.)

## File structure

New workspace laid out as:

```
Cargo.toml                         # [workspace] — root manifest (CI detect keys on this)
crates/
  redextape-core/
    Cargo.toml
    src/
      lib.rs        # public API: analyze(), run(), re-exports; ties the pipeline together (Task 1, 7)
      span.rs       # Span (byte offsets) + merge (Task 2)
      diagnostic.rs # Diagnostic, Severity (Task 2)
      token.rs      # Token, TokenKind (Task 2)
      lexer.rs      # lex(&str) -> (Vec<Token>, Vec<Diagnostic>) (Task 2)
      ast.rs        # surface AST: Program, Block, Stmt, Expr, BinOp (Task 3)
      parser.rs     # parse(&str) -> (Option<Program>, Vec<Diagnostic>) — Pratt parser (Task 3)
      ty.rs         # Ty, Scheme (Task 4)
      typeck.rs     # typecheck(&Program) -> Vec<Diagnostic> — Algorithm W (Task 4)
      prelude.rs    # builtin type schemes + builtin runtime values (Task 4, 6)
      core.rs       # Core AST (Core enum), NodeId, NodeGen allocator (Task 5)
      desugar.rs    # desugar(&Program) -> Core (Task 5)
      value.rs      # runtime Value + manual PartialEq (Task 6)
      interp.rs     # eval(&Core) -> Result<Value, RuntimeError> (Task 6)
```

Each file has one responsibility; files that change together (lexer + its tokens; typechecker +
its type language) live adjacent. `lib.rs` is the only module that knows the whole pipeline.

---

### Task 1: Cargo workspace + `redextape-core` skeleton

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `crates/redextape-core/Cargo.toml`
- Create: `crates/redextape-core/src/lib.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: the `redextape_core` crate compiling with a passing smoke test; the workspace CI
  gates (fmt/clippy/llvm-cov) all green. Later tasks add modules to `src/` and `mod` lines to
  `lib.rs`.

- [ ] **Step 1: Create the workspace root manifest**

Create `Cargo.toml`:

```toml
[workspace]
resolver = "3"
members = ["crates/redextape-core"]

[workspace.package]
edition = "2024"
license = "GPL-3.0-only"
repository = "https://git.daveynet.xyz/davey/redextape"

[workspace.lints.clippy]
# Deny is enforced by CI (`-D warnings`); keep the crate clippy-clean.
all = "warn"
```

- [ ] **Step 2: Create the core crate manifest**

Create `crates/redextape-core/Cargo.toml`:

```toml
[package]
name = "redextape-core"
version = "0.0.0"
edition.workspace = true
license.workspace = true
repository.workspace = true

[lints]
workspace = true

[dependencies]

[dev-dependencies]
proptest = "1"
```

- [ ] **Step 3: Write the smoke test and crate root**

Create `crates/redextape-core/src/lib.rs`:

```rust
//! Redextape core: the mini-language front end, the λ and TM backends, and the shared analysis
//! layer. This crate is compiled to WASM for the web UI and reused by the CLI and LSP.
//!
//! Foundation slice (this plan): lexer -> parser -> typecheck -> desugar -> reference interpreter.

/// The library version string, used by the smoke test and later by the CLI `--version`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod smoke_tests {
    use super::*;

    #[test]
    fn version_is_exposed() {
        assert_eq!(VERSION, "0.0.0");
    }
}
```

- [ ] **Step 4: Verify the workspace builds and the gates pass**

Run: `cargo test --workspace`
Expected: PASS — `version_is_exposed` passes.

Run: `cargo fmt --all --check`
Expected: no output, exit 0.

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: no warnings, exit 0.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/redextape-core/Cargo.toml crates/redextape-core/src/lib.rs
git commit -m "feat(core): scaffold Cargo workspace and redextape-core crate"
```

---

### Task 2: Span, diagnostics, and the lexer

**Files:**
- Create: `crates/redextape-core/src/span.rs`
- Create: `crates/redextape-core/src/diagnostic.rs`
- Create: `crates/redextape-core/src/token.rs`
- Create: `crates/redextape-core/src/lexer.rs`
- Modify: `crates/redextape-core/src/lib.rs` (add `mod` lines + re-exports)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `span::Span { start: usize, end: usize }` with `Span::new`, `Span::merge`.
  - `diagnostic::{Diagnostic, Severity}` with `Diagnostic::error(span, msg)`.
  - `token::{Token, TokenKind}`. `Token { kind: TokenKind, span: Span }`. Identifier/keyword text
    is recovered by slicing `src[span.start..span.end]` (tokens store no owned strings).
  - `lexer::lex(src: &str) -> (Vec<Token>, Vec<Diagnostic>)` — always ends with a `TokenKind::Eof`
    token whose span is the empty range at `src.len()`.

- [ ] **Step 1: Write `span.rs`**

Create `crates/redextape-core/src/span.rs`:

```rust
//! Byte-offset source spans. All positions are byte offsets into the original `&str`, so slicing
//! `src[span.start..span.end]` recovers the exact source text.

/// A half-open byte range `[start, end)` into the source string.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Self {
        debug_assert!(start <= end, "span start must not exceed end");
        Span { start, end }
    }

    /// The smallest span covering both `self` and `other`.
    pub fn merge(self, other: Span) -> Span {
        Span::new(self.start.min(other.start), self.end.max(other.end))
    }
}
```

- [ ] **Step 2: Write `diagnostic.rs`**

Create `crates/redextape-core/src/diagnostic.rs`:

```rust
//! Spanned diagnostics. Malformed user input turns into these — the front end never panics on it.

use crate::span::Span;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagnostic {
    pub span: Span,
    pub severity: Severity,
    pub message: String,
}

impl Diagnostic {
    pub fn error(span: Span, message: impl Into<String>) -> Self {
        Diagnostic { span, severity: Severity::Error, message: message.into() }
    }
}
```

- [ ] **Step 3: Write `token.rs`**

Create `crates/redextape-core/src/token.rs`:

```rust
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
```

- [ ] **Step 4: Write the failing lexer tests**

Create `crates/redextape-core/src/lexer.rs` with only the tests first:

```rust
//! Hand-written lexer. Skips whitespace and `//` line comments; recognizes keywords, `Nat`
//! literals, identifiers, the v1 operator set, and delimiters. Unknown characters become a
//! `Diagnostic` and are skipped (no token emitted).

use crate::diagnostic::Diagnostic;
use crate::span::Span;
use crate::token::{Token, TokenKind};

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<TokenKind> {
        let (toks, diags) = lex(src);
        assert!(diags.is_empty(), "unexpected diagnostics: {diags:?}");
        toks.into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn lexes_keywords_and_identifiers() {
        use TokenKind::*;
        assert_eq!(kinds("fn let mut if else while true false foo"), vec![
            Fn, Let, Mut, If, Else, While, True, False, Ident, Eof,
        ]);
    }

    #[test]
    fn lexes_operators_longest_match_first() {
        use TokenKind::*;
        assert_eq!(kinds("== != <= >= < > = + - *"), vec![
            Eq, Ne, Le, Ge, Lt, Gt, Assign, Plus, Minus, Star, Eof,
        ]);
    }

    #[test]
    fn lexes_delimiters_and_nat_literals() {
        use TokenKind::*;
        assert_eq!(kinds("(){}[],;|. 0 42"), vec![
            LParen, RParen, LBrace, RBrace, LBracket, RBracket, Comma, Semi, Pipe, Dot, Nat(0),
            Nat(42), Eof,
        ]);
    }

    #[test]
    fn skips_whitespace_and_line_comments() {
        use TokenKind::*;
        assert_eq!(kinds("1 // a comment\n  2"), vec![Nat(1), Nat(2), Eof]);
    }

    #[test]
    fn ident_text_is_recovered_by_span() {
        let src = "count_down";
        let (toks, _) = lex(src);
        assert_eq!(toks[0].kind, TokenKind::Ident);
        assert_eq!(&src[toks[0].span.start..toks[0].span.end], "count_down");
    }

    #[test]
    fn unknown_char_becomes_a_diagnostic_and_is_skipped() {
        let (toks, diags) = lex("1 $ 2");
        assert_eq!(diags.len(), 1);
        assert_eq!(&"1 $ 2"[diags[0].span.start..diags[0].span.end], "$");
        assert_eq!(toks.iter().map(|t| t.kind).collect::<Vec<_>>(), vec![
            TokenKind::Nat(1),
            TokenKind::Nat(2),
            TokenKind::Eof,
        ]);
    }
}
```

- [ ] **Step 5: Run the lexer tests to verify they fail**

Run: `cargo test -p redextape-core lexer`
Expected: FAIL — `cannot find function 'lex' in this scope`.

- [ ] **Step 6: Implement the lexer**

Add above the `#[cfg(test)]` module in `lexer.rs`:

```rust
pub fn lex(src: &str) -> (Vec<Token>, Vec<Diagnostic>) {
    let mut toks = Vec::new();
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
        // Line comments.
        if c == b'/' && bytes.get(i + 1) == Some(&b'/') {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
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
        diags.push(Diagnostic::error(Span::new(i, i + ch_len), format!("unexpected character `{}`", &src[i..i + ch_len])));
        i += ch_len;
    }

    toks.push(Token { kind: TokenKind::Eof, span: Span::new(src.len(), src.len()) });
    (toks, diags)
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
```

- [ ] **Step 7: Wire the modules into `lib.rs`**

In `crates/redextape-core/src/lib.rs`, add module declarations and re-exports above the smoke
test (keep them sorted):

```rust
pub mod diagnostic;
pub mod lexer;
pub mod span;
pub mod token;

pub use diagnostic::{Diagnostic, Severity};
pub use span::Span;
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cargo test -p redextape-core`
Expected: PASS — all lexer tests + the smoke test.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/src/span.rs crates/redextape-core/src/diagnostic.rs \
        crates/redextape-core/src/token.rs crates/redextape-core/src/lexer.rs \
        crates/redextape-core/src/lib.rs
git commit -m "feat(core): add spans, diagnostics, and the lexer"
```

---

### Task 3: Surface AST + Pratt parser

**Files:**
- Create: `crates/redextape-core/src/ast.rs`
- Create: `crates/redextape-core/src/parser.rs`
- Modify: `crates/redextape-core/src/lib.rs`

**Interfaces:**
- Consumes: `token::{Token, TokenKind}`, `lexer::lex`, `Span`, `Diagnostic`.
- Produces:
  - `ast::{Program, Block, Stmt, Expr, BinOp}` (see code). `Program { block: Block }`.
    `Block { stmts: Vec<Stmt>, tail: Option<Box<Expr>>, span: Span }`.
  - `parser::parse(src: &str) -> (Option<Program>, Vec<Diagnostic>)`. Returns `Some` only when the
    whole input parsed cleanly; diagnostics carry spans either way. (Multi-error recovery is
    deferred; v1 reports the first parse error.)
  - Operator precedence (low → high): comparison (`== != < <= > >=`, non-associative-ish, parsed
    left) < additive (`+ -`) < multiplicative (`*`) < call/method postfix (`f(...)`, `.m(...)`)
    < atoms.

- [ ] **Step 1: Write `ast.rs`**

Create `crates/redextape-core/src/ast.rs`:

```rust
//! The surface AST — the tree the parser produces, before desugaring. Statements (`let`, `fn`,
//! assignment, `while`, expression statements) are distinct from value-producing expressions;
//! blocks used as values must carry a `tail` expression (the typechecker enforces this).

use crate::span::Span;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Program {
    pub block: Block,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub stmts: Vec<Stmt>,
    pub tail: Option<Box<Expr>>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Stmt {
    Let { name: String, mutable: bool, value: Expr, span: Span },
    Fn { name: String, params: Vec<String>, body: Block, span: Span },
    Assign { target: String, value: Expr, span: Span },
    While { cond: Expr, body: Block, span: Span },
    Expr(Expr),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Expr {
    Nat { value: u64, span: Span },
    Bool { value: bool, span: Span },
    Var { name: String, span: Span },
    List { items: Vec<Expr>, span: Span },
    Binary { op: BinOp, lhs: Box<Expr>, rhs: Box<Expr>, span: Span },
    If { cond: Box<Expr>, then_blk: Block, else_blk: Block, span: Span },
    Block { block: Box<Block>, span: Span },
    Lambda { params: Vec<String>, body: Box<Expr>, span: Span },
    Call { callee: Box<Expr>, args: Vec<Expr>, span: Span },
    Method { recv: Box<Expr>, name: String, args: Vec<Expr>, span: Span },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

impl Expr {
    pub fn span(&self) -> Span {
        match self {
            Expr::Nat { span, .. }
            | Expr::Bool { span, .. }
            | Expr::Var { span, .. }
            | Expr::List { span, .. }
            | Expr::Binary { span, .. }
            | Expr::If { span, .. }
            | Expr::Block { span, .. }
            | Expr::Lambda { span, .. }
            | Expr::Call { span, .. }
            | Expr::Method { span, .. } => *span,
        }
    }
}
```

- [ ] **Step 2: Write the failing parser tests**

Create `crates/redextape-core/src/parser.rs` with the tests first:

```rust
//! Hand-written Pratt (precedence-climbing) parser: `&str` -> `Program`. Produces spanned
//! diagnostics; returns `Some(program)` only when the entire input parsed.

use crate::ast::{BinOp, Block, Expr, Program, Stmt};
use crate::diagnostic::Diagnostic;
use crate::lexer::lex;
use crate::span::Span;
use crate::token::{Token, TokenKind};

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
        match e {
            Expr::Binary { op: BinOp::Add, rhs, .. } => {
                assert!(matches!(*rhs, Expr::Binary { op: BinOp::Mul, .. }));
            }
            other => panic!("expected top-level Add, got {other:?}"),
        }
    }

    #[test]
    fn additive_is_left_associative() {
        // 1 - 2 - 3  ==  (1 - 2) - 3
        match expr("1 - 2 - 3") {
            Expr::Binary { op: BinOp::Sub, lhs, .. } => {
                assert!(matches!(*lhs, Expr::Binary { op: BinOp::Sub, .. }));
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
        match e {
            Expr::Method { name, args, recv, .. } => {
                assert_eq!(name, "fold");
                assert_eq!(args.len(), 2);
                assert!(matches!(*recv, Expr::Method { .. }));
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
        assert!(matches!(&prog.block.stmts[0], Stmt::Fn { name, params, .. } if name == "count_down" && params == &["n"]));
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
}
```

- [ ] **Step 3: Run the parser tests to verify they fail**

Run: `cargo test -p redextape-core parser`
Expected: FAIL — `cannot find function 'parse'`.

- [ ] **Step 4: Implement the parser**

Add above the `#[cfg(test)]` module in `parser.rs`. A `Diagnostic` is thrown via `Result` and
caught at the top level so a parse error returns `(None, vec![diag])`:

```rust
pub fn parse(src: &str) -> (Option<Program>, Vec<Diagnostic>) {
    let (tokens, mut diags) = lex(src);
    if !diags.is_empty() {
        return (None, diags);
    }
    let mut p = Parser { src, tokens, pos: 0 };
    match p.parse_program() {
        Ok(program) => (Some(program), diags),
        Err(diag) => {
            diags.push(diag);
            (None, diags)
        }
    }
}

struct Parser<'a> {
    src: &'a str,
    tokens: Vec<Token>,
    pos: usize,
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
        if t.kind == kind {
            Ok(self.bump())
        } else {
            Err(Diagnostic::error(t.span, format!("expected {what}")))
        }
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
        let name = self.text(self.expect(TokenKind::Ident, "a function name")?.span);
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

    fn parse_braced_block(&mut self) -> PResult<Block> {
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
    fn parse_binary(&mut self, min_bp: u8) -> PResult<Expr> {
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
                    let name = self.text(self.expect(TokenKind::Ident, "a method name")?.span);
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
```

- [ ] **Step 5: Wire modules into `lib.rs`**

Add to `crates/redextape-core/src/lib.rs` (keep declarations sorted):

```rust
pub mod ast;
pub mod parser;
```

- [ ] **Step 6: Run the parser tests to verify they pass**

Run: `cargo test -p redextape-core parser`
Expected: PASS — all 8 parser tests.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/ast.rs crates/redextape-core/src/parser.rs \
        crates/redextape-core/src/lib.rs
git commit -m "feat(core): add the surface AST and Pratt parser"
```

---

### Task 4: Hindley–Milner typechecker + prelude

**Files:**
- Create: `crates/redextape-core/src/ty.rs`
- Create: `crates/redextape-core/src/prelude.rs`
- Create: `crates/redextape-core/src/typeck.rs`
- Modify: `crates/redextape-core/src/lib.rs`

**Interfaces:**
- Consumes: `ast::*`, `Diagnostic`, `Span`.
- Produces:
  - `ty::{Ty, Scheme}` — `Ty::{Nat, Bool, Unit, List(Box<Ty>), Fun(Vec<Ty>, Box<Ty>), Var(u32)}`;
    `Scheme { vars: Vec<u32>, ty: Ty }`.
  - `prelude::type_env() -> Vec<(String, Scheme)>` — builtin schemes for
    `nil, cons, head, tail, is_empty`.
  - `typeck::typecheck(program: &Program) -> Vec<Diagnostic>` — empty iff well-typed. Reports
    unbound variables, type mismatches, arity mismatches, assignment to immutable/undeclared
    variables, and use of a statement (`Unit`) where a value is required.

- [ ] **Step 1: Write `ty.rs`**

Create `crates/redextape-core/src/ty.rs`:

```rust
//! The type language: monomorphic types `Ty` and polymorphic `Scheme`s (`forall vars. ty`).
//! `Unit` is internal — it types `while`/assignment/tail-less blocks and is never written by the
//! user.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Ty {
    Nat,
    Bool,
    Unit,
    List(Box<Ty>),
    Fun(Vec<Ty>, Box<Ty>),
    Var(u32),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scheme {
    pub vars: Vec<u32>,
    pub ty: Ty,
}

impl Scheme {
    /// A monomorphic scheme (no quantified variables).
    pub fn mono(ty: Ty) -> Self {
        Scheme { vars: Vec::new(), ty }
    }
}
```

- [ ] **Step 2: Write `prelude.rs` (type side)**

Create `crates/redextape-core/src/prelude.rs`:

```rust
//! Builtin bindings shared by the typechecker and the interpreter. The list primitives live here
//! so `map`/`fold` can be written in the language itself. (`nil`/`cons`/`head`/`tail`/`is_empty`
//! are first-class values, not keywords.)

use crate::ty::{Scheme, Ty};

/// Names of the builtin values, in a stable order.
pub const BUILTIN_NAMES: [&str; 5] = ["nil", "cons", "head", "tail", "is_empty"];

/// The initial type environment: `name -> polymorphic scheme`.
pub fn type_env() -> Vec<(String, Scheme)> {
    // Type variable 0 stands for the list element type `a`; each scheme quantifies over it.
    let a = || Ty::Var(0);
    let list = || Ty::List(Box::new(a()));
    vec![
        ("nil".into(), Scheme { vars: vec![0], ty: list() }),
        ("cons".into(), Scheme { vars: vec![0], ty: Ty::Fun(vec![a(), list()], Box::new(list())) }),
        ("head".into(), Scheme { vars: vec![0], ty: Ty::Fun(vec![list()], Box::new(a())) }),
        ("tail".into(), Scheme { vars: vec![0], ty: Ty::Fun(vec![list()], Box::new(list())) }),
        ("is_empty".into(), Scheme { vars: vec![0], ty: Ty::Fun(vec![list()], Box::new(Ty::Bool)) }),
    ]
}
```

- [ ] **Step 3: Write the failing typechecker tests**

Create `crates/redextape-core/src/typeck.rs` with the tests first:

```rust
//! Hindley–Milner type inference (Algorithm W) over the surface AST. Immutable `let`/`fn`
//! bindings are generalized; `let mut` bindings stay monomorphic (value restriction).

use crate::ast::{BinOp, Block, Expr, Program, Stmt};
use crate::diagnostic::Diagnostic;
use crate::prelude::type_env;
use crate::span::Span;
use crate::ty::{Scheme, Ty};
use std::collections::HashMap;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse;

    fn diags(src: &str) -> Vec<Diagnostic> {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        typecheck(&prog.unwrap())
    }

    fn assert_ok(src: &str) {
        let ds = diags(src);
        assert!(ds.is_empty(), "expected well-typed, got: {ds:?}");
    }

    fn assert_err(src: &str, needle: &str) {
        let ds = diags(src);
        assert!(ds.iter().any(|d| d.message.contains(needle)), "expected an error containing {needle:?}, got: {ds:?}");
    }

    #[test]
    fn arithmetic_and_comparison_are_well_typed() {
        assert_ok("1 + 2 * 3");
        assert_ok("if 1 > 0 { 1 } else { 2 }");
    }

    #[test]
    fn adding_a_bool_to_a_nat_is_an_error() {
        assert_err("1 + true", "expected `Nat`");
    }

    #[test]
    fn unbound_variable_is_reported() {
        assert_err("nope + 1", "unbound variable `nope`");
    }

    #[test]
    fn if_branches_must_agree() {
        assert_err("if true { 1 } else { false }", "type mismatch");
    }

    #[test]
    fn closure_applies_at_its_argument_type() {
        assert_ok("let add1 = |x| x + 1; add1(41)");
        // add1 wants a Nat; handing it a List is a mismatch.
        assert_err("let add1 = |x| x + 1; add1(cons(1, nil))", "type mismatch");
    }

    #[test]
    fn fn_bindings_are_let_polymorphic() {
        // `id` is used at both Bool and Nat — only sound if generalized at the `fn` binding.
        assert_ok("fn id(x) { x } if id(true) { id(1) } else { id(2) }");
    }

    #[test]
    fn map_and_fold_written_in_language_typecheck() {
        let src = "\
            fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
            fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
            fn add(a, b) { a + b }\n\
            fn add1(x) { x + 1 }\n\
            fold(map(cons(3, cons(1, cons(2, nil))), add1), 0, add)";
        assert_ok(src);
    }

    #[test]
    fn count_down_typechecks() {
        let src = "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(3)";
        assert_ok(src);
    }

    #[test]
    fn assignment_to_immutable_is_an_error() {
        assert_err("{ let x = 1; x = 2; x }", "cannot assign to immutable");
    }

    #[test]
    fn assignment_to_undeclared_is_an_error() {
        assert_err("{ let mut x = 1; y = 2; x }", "unbound variable `y`");
    }

    #[test]
    fn value_position_block_needs_a_tail() {
        // `let z = { let a = 1; };` binds z to a tail-less block -> Unit where a value is needed.
        assert_err("{ let z = { let a = 1; }; z }", "expected a value");
    }
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cargo test -p redextape-core typeck`
Expected: FAIL — `cannot find function 'typecheck'`.

- [ ] **Step 5: Implement Algorithm W**

Add above the `#[cfg(test)]` module in `typeck.rs`:

```rust
pub fn typecheck(program: &Program) -> Vec<Diagnostic> {
    let mut inf = Infer::new();
    let mut env = TyEnv::new();
    for (name, scheme) in type_env() {
        env.insert(name, scheme, false);
    }
    inf.infer_block(&env, &program.block);
    inf.diags
}

/// One `let`-scope entry.
struct Binding {
    name: String,
    scheme: Scheme,
    mutable: bool,
}

#[derive(Default)]
struct TyEnv {
    stack: Vec<Binding>,
}

impl TyEnv {
    fn new() -> Self {
        TyEnv::default()
    }

    fn insert(&mut self, name: String, scheme: Scheme, mutable: bool) {
        self.stack.push(Binding { name, scheme, mutable });
    }

    fn lookup(&self, name: &str) -> Option<&Binding> {
        self.stack.iter().rev().find(|b| b.name == name)
    }

    /// A cheap scope marker: bindings pushed after this length are dropped by `truncate`.
    fn mark(&self) -> usize {
        self.stack.len()
    }

    fn truncate(&mut self, mark: usize) {
        self.stack.truncate(mark);
    }
}

struct Infer {
    subst: HashMap<u32, Ty>,
    next: u32,
    diags: Vec<Diagnostic>,
}

impl Infer {
    fn new() -> Self {
        // Prelude schemes quantify over var 0, so start fresh ids above it.
        Infer { subst: HashMap::new(), next: 1, diags: Vec::new() }
    }

    fn fresh(&mut self) -> Ty {
        let v = self.next;
        self.next += 1;
        Ty::Var(v)
    }

    fn error(&mut self, span: Span, msg: impl Into<String>) {
        self.diags.push(Diagnostic::error(span, msg));
    }

    /// Resolve a type through the current substitution (shallow at the head, deep on demand).
    fn resolve(&self, ty: &Ty) -> Ty {
        match ty {
            Ty::Var(v) => match self.subst.get(v) {
                Some(t) => self.resolve(&t.clone()),
                None => Ty::Var(*v),
            },
            Ty::List(t) => Ty::List(Box::new(self.resolve(t))),
            Ty::Fun(ps, r) => Ty::Fun(ps.iter().map(|p| self.resolve(p)).collect(), Box::new(self.resolve(r))),
            Ty::Nat | Ty::Bool | Ty::Unit => ty.clone(),
        }
    }

    fn occurs(&self, v: u32, ty: &Ty) -> bool {
        match self.resolve(ty) {
            Ty::Var(w) => v == w,
            Ty::List(t) => self.occurs(v, &t),
            Ty::Fun(ps, r) => ps.iter().any(|p| self.occurs(v, p)) || self.occurs(v, &r),
            Ty::Nat | Ty::Bool | Ty::Unit => false,
        }
    }

    fn bind(&mut self, v: u32, ty: Ty) {
        self.subst.insert(v, ty);
    }

    /// Unify `a` and `b`; on failure report a mismatch at `span` and continue.
    fn unify(&mut self, a: &Ty, b: &Ty, span: Span) {
        let a = self.resolve(a);
        let b = self.resolve(b);
        match (&a, &b) {
            (Ty::Var(v), Ty::Var(w)) if v == w => {}
            (Ty::Var(v), other) | (other, Ty::Var(v)) => {
                if self.occurs(*v, other) {
                    self.error(span, "recursive type (occurs check failed)");
                } else {
                    self.bind(*v, other.clone());
                }
            }
            (Ty::Nat, Ty::Nat) | (Ty::Bool, Ty::Bool) | (Ty::Unit, Ty::Unit) => {}
            (Ty::List(x), Ty::List(y)) => self.unify(x, y, span),
            (Ty::Fun(p1, r1), Ty::Fun(p2, r2)) => {
                if p1.len() != p2.len() {
                    self.error(span, format!("this function takes {} argument(s) but {} were supplied", p1.len(), p2.len()));
                } else {
                    for (x, y) in p1.iter().zip(p2) {
                        self.unify(x, y, span);
                    }
                    self.unify(r1, r2, span);
                }
            }
            _ => self.error(span, format!("type mismatch: expected `{}`, found `{}`", show(&a), show(&b))),
        }
    }

    /// Type variables free in `ty` after resolution.
    fn free_vars(&self, ty: &Ty, out: &mut Vec<u32>) {
        match self.resolve(ty) {
            Ty::Var(v) => {
                if !out.contains(&v) {
                    out.push(v);
                }
            }
            Ty::List(t) => self.free_vars(&t, out),
            Ty::Fun(ps, r) => {
                for p in &ps {
                    self.free_vars(p, out);
                }
                self.free_vars(&r, out);
            }
            Ty::Nat | Ty::Bool | Ty::Unit => {}
        }
    }

    fn env_free_vars(&self, env: &TyEnv) -> Vec<u32> {
        let mut out = Vec::new();
        for b in &env.stack {
            let mut vs = Vec::new();
            self.free_vars(&b.scheme.ty, &mut vs);
            for v in vs {
                if !b.scheme.vars.contains(&v) && !out.contains(&v) {
                    out.push(v);
                }
            }
        }
        out
    }

    /// Generalize `ty` over the variables not free in `env`.
    fn generalize(&self, env: &TyEnv, ty: &Ty) -> Scheme {
        let env_free = self.env_free_vars(env);
        let mut ty_free = Vec::new();
        self.free_vars(ty, &mut ty_free);
        let vars: Vec<u32> = ty_free.into_iter().filter(|v| !env_free.contains(v)).collect();
        Scheme { vars, ty: self.resolve(ty) }
    }

    /// Instantiate a scheme with fresh variables for each quantified variable.
    fn instantiate(&mut self, scheme: &Scheme) -> Ty {
        let mapping: HashMap<u32, Ty> = scheme.vars.iter().map(|&v| (v, self.fresh())).collect();
        subst_vars(&scheme.ty, &mapping)
    }

    // --- Inference ---

    /// Infer a block; returns its value type (`Unit` if there is no tail expression).
    fn infer_block(&mut self, env: &TyEnv, block: &Block) -> Ty {
        let mut env = clone_env(env);
        let mark = env.mark();
        for stmt in &block.stmts {
            self.infer_stmt(&mut env, stmt);
        }
        let ty = match &block.tail {
            Some(e) => self.infer_expr(&env, e),
            None => Ty::Unit,
        };
        env.truncate(mark);
        ty
    }

    fn infer_stmt(&mut self, env: &mut TyEnv, stmt: &Stmt) {
        match stmt {
            Stmt::Let { name, mutable, value, .. } => {
                let vt = self.infer_expr(env, value);
                // A `let` binding a tail-less block (`Unit`) is using a statement as a value.
                self.require_value(&vt, value.span());
                let scheme = if *mutable { Scheme::mono(self.resolve(&vt)) } else { self.generalize(env, &vt) };
                env.insert(name.clone(), scheme, *mutable);
            }
            Stmt::Fn { name, params, body, span } => {
                let param_tys: Vec<Ty> = params.iter().map(|_| self.fresh()).collect();
                let ret = self.fresh();
                let fun = Ty::Fun(param_tys.clone(), Box::new(ret.clone()));
                // Bind the function name monomorphically while checking its body (monomorphic recursion).
                let rec_mark = env.mark();
                env.insert(name.clone(), Scheme::mono(fun.clone()), false);
                let body_mark = env.mark();
                for (p, pt) in params.iter().zip(&param_tys) {
                    env.insert(p.clone(), Scheme::mono(pt.clone()), false);
                }
                let body_ty = self.infer_block(env, body);
                self.unify(&ret, &body_ty, *span);
                env.truncate(body_mark);
                // Re-bind the name with a generalized scheme for the rest of the block.
                env.truncate(rec_mark);
                let scheme = self.generalize(env, &fun);
                env.insert(name.clone(), scheme, false);
            }
            Stmt::Assign { target, value, span } => match env.lookup(target) {
                None => self.error(*span, format!("unbound variable `{target}`")),
                Some(b) => {
                    if !b.mutable {
                        self.error(*span, format!("cannot assign to immutable variable `{target}`"));
                    }
                    let target_ty = b.scheme.ty.clone();
                    let vt = self.infer_expr(env, value);
                    self.unify(&target_ty, &vt, *span);
                }
            },
            Stmt::While { cond, body, span } => {
                let ct = self.infer_expr(env, cond);
                self.unify(&ct, &Ty::Bool, *span);
                self.infer_block(env, body);
            }
            Stmt::Expr(e) => {
                self.infer_expr(env, e);
            }
        }
    }

    fn infer_expr(&mut self, env: &TyEnv, expr: &Expr) -> Ty {
        match expr {
            Expr::Nat { .. } => Ty::Nat,
            Expr::Bool { .. } => Ty::Bool,
            Expr::Var { name, span } => match env.lookup(name) {
                Some(b) => {
                    let scheme = b.scheme.clone();
                    self.instantiate(&scheme)
                }
                None => {
                    self.error(*span, format!("unbound variable `{name}`"));
                    self.fresh()
                }
            },
            Expr::List { items, .. } => {
                let elem = self.fresh();
                for item in items {
                    let it = self.infer_expr(env, item);
                    self.unify(&elem, &it, item.span());
                }
                Ty::List(Box::new(elem))
            }
            Expr::Binary { op, lhs, rhs, .. } => {
                let lt = self.infer_expr(env, lhs);
                let rt = self.infer_expr(env, rhs);
                self.expect(&lt, &Ty::Nat, lhs.span());
                self.expect(&rt, &Ty::Nat, rhs.span());
                if op.is_comparison() { Ty::Bool } else { Ty::Nat }
            }
            Expr::If { cond, then_blk, else_blk, .. } => {
                let ct = self.infer_expr(env, cond);
                self.unify(&ct, &Ty::Bool, cond.span());
                let tt = self.infer_block(env, then_blk);
                let et = self.infer_block(env, else_blk);
                self.unify(&tt, &et, else_blk.span);
                self.require_value(&tt, then_blk.span);
                tt
            }
            Expr::Block { block, .. } => self.infer_block(env, block),
            Expr::Lambda { params, body, .. } => {
                let param_tys: Vec<Ty> = params.iter().map(|_| self.fresh()).collect();
                let mut env2 = clone_env(env);
                for (p, pt) in params.iter().zip(&param_tys) {
                    env2.insert(p.clone(), Scheme::mono(pt.clone()), false);
                }
                let body_ty = self.infer_expr(&env2, body);
                Ty::Fun(param_tys, Box::new(body_ty))
            }
            Expr::Call { callee, args, span } => {
                let ft = self.infer_expr(env, callee);
                let arg_tys: Vec<Ty> = args.iter().map(|a| self.infer_expr(env, a)).collect();
                let ret = self.fresh();
                self.unify(&ft, &Ty::Fun(arg_tys, Box::new(ret.clone())), *span);
                ret
            }
            Expr::Method { recv, name, args, span } => {
                // UFCS: `recv.m(args)` types as `m(recv, args)`.
                let recv_ty = self.infer_expr(env, recv);
                let fun_ty = match env.lookup(name) {
                    Some(b) => {
                        let scheme = b.scheme.clone();
                        self.instantiate(&scheme)
                    }
                    None => {
                        self.error(*span, format!("unbound variable `{name}`"));
                        return self.fresh();
                    }
                };
                let mut arg_tys = vec![recv_ty];
                arg_tys.extend(args.iter().map(|a| self.infer_expr(env, a)));
                let ret = self.fresh();
                self.unify(&fun_ty, &Ty::Fun(arg_tys, Box::new(ret.clone())), *span);
                ret
            }
        }
    }

    /// Unify but phrase the failure as "expected `expected`" (used for operator operands).
    fn expect(&mut self, actual: &Ty, expected: &Ty, span: Span) {
        let a = self.resolve(actual);
        if matches!(a, Ty::Var(_)) {
            self.unify(&a, expected, span);
        } else if a != *expected {
            self.error(span, format!("expected `{}`, found `{}`", show(expected), show(&a)));
        }
    }

    /// Report if a type is `Unit` in a position that needs a real value.
    fn require_value(&mut self, ty: &Ty, span: Span) {
        if self.resolve(ty) == Ty::Unit {
            self.error(span, "expected a value, found a statement (`Unit`)");
        }
    }
}

impl BinOp {
    fn is_comparison(self) -> bool {
        matches!(self, BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge)
    }
}

fn clone_env(env: &TyEnv) -> TyEnv {
    TyEnv {
        stack: env.stack.iter().map(|b| Binding { name: b.name.clone(), scheme: b.scheme.clone(), mutable: b.mutable }).collect(),
    }
}

fn subst_vars(ty: &Ty, mapping: &HashMap<u32, Ty>) -> Ty {
    match ty {
        Ty::Var(v) => mapping.get(v).cloned().unwrap_or(Ty::Var(*v)),
        Ty::List(t) => Ty::List(Box::new(subst_vars(t, mapping))),
        Ty::Fun(ps, r) => Ty::Fun(ps.iter().map(|p| subst_vars(p, mapping)).collect(), Box::new(subst_vars(r, mapping))),
        Ty::Nat | Ty::Bool | Ty::Unit => ty.clone(),
    }
}

fn show(ty: &Ty) -> String {
    match ty {
        Ty::Nat => "Nat".into(),
        Ty::Bool => "Bool".into(),
        Ty::Unit => "Unit".into(),
        Ty::List(t) => format!("List<{}>", show(t)),
        Ty::Fun(ps, r) => {
            let ps: Vec<String> = ps.iter().map(show).collect();
            format!("({}) -> {}", ps.join(", "), show(r))
        }
        Ty::Var(v) => format!("t{v}"),
    }
}
```

> **Note for the implementer:** a tail-less block infers to the internal `Unit` type. Two
> `require_value` sites reject it where a real value is required: `Stmt::Let` (binding a statement)
> and `Expr::If` (a branch that produces no value). `while`/assignment legitimately produce `Unit`
> and only ever appear in discarded (`Seq`-first) position, so they are never flagged. Do not add a
> user-facing unit type — `Unit` stays internal by design.

- [ ] **Step 6: Wire modules into `lib.rs`**

Add to `crates/redextape-core/src/lib.rs`:

```rust
pub mod prelude;
pub mod ty;
pub mod typeck;
```

- [ ] **Step 7: Run the typechecker tests**

Run: `cargo test -p redextape-core typeck`
Expected: PASS — all typechecker tests.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/ty.rs crates/redextape-core/src/prelude.rs \
        crates/redextape-core/src/typeck.rs crates/redextape-core/src/lib.rs
git commit -m "feat(core): add Hindley-Milner typechecker and prelude"
```

---

### Task 5: Core AST + desugar

**Files:**
- Create: `crates/redextape-core/src/core.rs`
- Create: `crates/redextape-core/src/desugar.rs`
- Modify: `crates/redextape-core/src/lib.rs`

**Interfaces:**
- Consumes: `ast::*`.
- Produces:
  - `core::{Core, NodeId}`. `NodeId = u32`. Every `Core` node's first field is its `NodeId`.
    Variants: `Nat, Bool, Var, BinOp, If, Lambda, Apply, Let, LetRec, Seq, Assign, While`.
    `Core::id(&self) -> NodeId`.
  - `core::BinOp` — re-uses the semantics of `ast::BinOp` but is the Core-level operator enum
    (identical variants; kept separate so Core does not depend on surface types).
  - `desugar::desugar(program: &Program) -> Core`. Infallible — assumes the program parsed and
    typechecked. Reductions performed: UFCS methods → `Apply`; list literals → `cons`/`nil`
    chains; blocks/statements → right-nested `Let`/`LetRec`/`Seq`; `fn` → `LetRec`; `let` → `Let`.

- [ ] **Step 1: Write `core.rs`**

Create `crates/redextape-core/src/core.rs`:

```rust
//! The Core AST — the minimal, desugared IR that is the synchronization anchor (spec §5.4). Both
//! backends read this tree; every node carries a stable `NodeId` used as the source-map key.

/// Stable identifier for a Core node (the source-map / sync anchor key).
pub type NodeId = u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Clone, Debug)]
pub enum Core {
    Nat(NodeId, u64),
    Bool(NodeId, bool),
    Var(NodeId, String),
    BinOp(NodeId, BinOp, Box<Core>, Box<Core>),
    If(NodeId, Box<Core>, Box<Core>, Box<Core>),
    /// n-ary abstraction `|p0, p1, ...| body`.
    Lambda(NodeId, Vec<String>, Box<Core>),
    /// n-ary application `callee(a0, a1, ...)`.
    Apply(NodeId, Box<Core>, Vec<Core>),
    /// Non-recursive binding: `let name = value in body`. `mutable` drives backend lowering
    /// (tape cell / store-passing) — the interpreter treats every binding as a mutable slot.
    Let { id: NodeId, name: String, mutable: bool, value: Box<Core>, body: Box<Core> },
    /// Recursive binding (from `fn`): `letrec name = value in body`; `value` is always a Lambda.
    LetRec { id: NodeId, name: String, value: Box<Core>, body: Box<Core> },
    /// Evaluate `first` for effect (discard its value), then evaluate `then` for the result.
    Seq(NodeId, Box<Core>, Box<Core>),
    /// `name = value` — evaluates to the internal unit value.
    Assign(NodeId, String, Box<Core>),
    /// `while cond { body }` — evaluates to the internal unit value.
    While(NodeId, Box<Core>, Box<Core>),
}

impl Core {
    pub fn id(&self) -> NodeId {
        match self {
            Core::Nat(id, _)
            | Core::Bool(id, _)
            | Core::Var(id, _)
            | Core::BinOp(id, ..)
            | Core::If(id, ..)
            | Core::Lambda(id, ..)
            | Core::Apply(id, ..)
            | Core::Seq(id, ..)
            | Core::Assign(id, ..)
            | Core::While(id, ..) => *id,
            Core::Let { id, .. } | Core::LetRec { id, .. } => *id,
        }
    }
}

/// Monotonic `NodeId` source. Every desugar run uses a fresh one starting at 0.
#[derive(Default)]
pub struct NodeGen {
    next: NodeId,
}

impl NodeGen {
    pub fn fresh(&mut self) -> NodeId {
        let id = self.next;
        self.next += 1;
        id
    }
}
```

- [ ] **Step 2: Write the failing desugar tests**

Create `crates/redextape-core/src/desugar.rs` with the tests first:

```rust
//! Surface AST -> Core AST. Reduces sugar: UFCS method calls, list literals, and the
//! block/statement structure. Assumes the program has already parsed and typechecked.

use crate::ast::{self, Block, Expr, Program, Stmt};
use crate::core::{BinOp, Core, NodeGen, NodeId};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse;

    fn core(src: &str) -> Core {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        desugar(&prog.unwrap())
    }

    /// Count nodes of a shape matching `pred` in the tree.
    fn count(node: &Core, pred: &dyn Fn(&Core) -> bool) -> usize {
        let here = usize::from(pred(node));
        let kids: usize = children(node).iter().map(|c| count(c, pred)).sum();
        here + kids
    }

    fn children(node: &Core) -> Vec<&Core> {
        match node {
            Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) => vec![a, b],
            Core::If(_, a, b, c) => vec![a, b, c],
            Core::Lambda(_, _, b) => vec![b],
            Core::Apply(_, f, args) => {
                let mut v = vec![f.as_ref()];
                v.extend(args.iter());
                v
            }
            Core::Let { value, body, .. } | Core::LetRec { value, body, .. } => vec![value, body],
            Core::Assign(_, _, v) | Core::While(_, _, v) => vec![v],
            _ => vec![],
        }
    }

    #[test]
    fn method_chain_desugars_to_nested_applies() {
        // xs.map(f) -> map(xs, f)
        let c = core("fn map(xs, f) { xs } fn f(x) { x } map(nil, f).map(f)");
        // The tail `map(nil, f).map(f)` becomes map(map(nil, f), f): two Applies of `map`.
        let applies_of_map = count(&c, &|n| matches!(n, Core::Apply(_, callee, _) if matches!(callee.as_ref(), Core::Var(_, name) if name == "map")));
        assert_eq!(applies_of_map, 2);
    }

    #[test]
    fn list_literal_desugars_to_cons_nil() {
        let c = core("[1, 2]");
        // Expect cons(1, cons(2, nil)): two `cons` applications and one `nil` var.
        let conses = count(&c, &|n| matches!(n, Core::Apply(_, callee, _) if matches!(callee.as_ref(), Core::Var(_, name) if name == "cons")));
        let nils = count(&c, &|n| matches!(n, Core::Var(_, name) if name == "nil"));
        assert_eq!((conses, nils), (2, 1));
    }

    #[test]
    fn fn_becomes_letrec_and_let_becomes_let() {
        let c = core("fn f(x) { x } let y = 1; f(y)");
        assert!(matches!(&c, Core::LetRec { name, .. } if name == "f"));
        if let Core::LetRec { body, .. } = &c {
            assert!(matches!(body.as_ref(), Core::Let { name, .. } if name == "y"));
        }
    }

    #[test]
    fn node_ids_are_unique() {
        let c = core("fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(3)");
        let mut ids = Vec::new();
        collect_ids(&c, &mut ids);
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(ids.len(), sorted.len(), "duplicate NodeIds found");
    }

    fn collect_ids(node: &Core, out: &mut Vec<NodeId>) {
        out.push(node.id());
        for c in children(node) {
            collect_ids(c, out);
        }
    }
}
```

- [ ] **Step 3: Run the desugar tests to verify they fail**

Run: `cargo test -p redextape-core desugar`
Expected: FAIL — `cannot find function 'desugar'`.

- [ ] **Step 4: Implement desugar**

Add above the `#[cfg(test)]` module in `desugar.rs`:

```rust
pub fn desugar(program: &Program) -> Core {
    let mut g = NodeGen::default();
    lower_block(&mut g, &program.block)
}

fn map_op(op: ast::BinOp) -> BinOp {
    match op {
        ast::BinOp::Add => BinOp::Add,
        ast::BinOp::Sub => BinOp::Sub,
        ast::BinOp::Mul => BinOp::Mul,
        ast::BinOp::Eq => BinOp::Eq,
        ast::BinOp::Ne => BinOp::Ne,
        ast::BinOp::Lt => BinOp::Lt,
        ast::BinOp::Le => BinOp::Le,
        ast::BinOp::Gt => BinOp::Gt,
        ast::BinOp::Ge => BinOp::Ge,
    }
}

fn var(g: &mut NodeGen, name: &str) -> Core {
    Core::Var(g.fresh(), name.to_string())
}

/// Lower a block by processing its statements right-to-left into nested `Let`/`LetRec`/`Seq`,
/// ending in the tail expression (or the unit value `nil`-less... — see note).
fn lower_block(g: &mut NodeGen, block: &Block) -> Core {
    lower_stmts(g, &block.stmts, block.tail.as_deref())
}

fn lower_stmts(g: &mut NodeGen, stmts: &[Stmt], tail: Option<&Expr>) -> Core {
    match stmts.split_first() {
        None => match tail {
            Some(e) => lower_expr(g, e),
            // A tail-less block only appears in statement position; its value is discarded. We
            // represent the empty result with an assignment-free unit stand-in: `Seq` of two
            // trivial nodes is overkill, so use a zero `Nat` as the discarded unit carrier. The
            // interpreter never inspects a discarded value.
            None => Core::Nat(g.fresh(), 0),
        },
        Some((stmt, rest)) => {
            let id = g.fresh();
            match stmt {
                Stmt::Let { name, mutable, value, .. } => {
                    let value = Box::new(lower_expr(g, value));
                    let body = Box::new(lower_stmts(g, rest, tail));
                    Core::Let { id, name: name.clone(), mutable: *mutable, value, body }
                }
                Stmt::Fn { name, params, body, .. } => {
                    let lam = Core::Lambda(g.fresh(), params.clone(), Box::new(lower_block(g, body)));
                    let rest = Box::new(lower_stmts(g, rest, tail));
                    Core::LetRec { id, name: name.clone(), value: Box::new(lam), body: rest }
                }
                Stmt::Assign { target, value, .. } => {
                    let assign = Core::Assign(id, target.clone(), Box::new(lower_expr(g, value)));
                    seq_then(g, assign, rest, tail)
                }
                Stmt::While { cond, body, .. } => {
                    let while_ = Core::While(id, Box::new(lower_expr(g, cond)), Box::new(lower_block(g, body)));
                    seq_then(g, while_, rest, tail)
                }
                Stmt::Expr(e) => {
                    let first = lower_expr(g, e);
                    // Reuse `id` as the Seq node id (the expr node got its own id inside lower_expr).
                    let then = Box::new(lower_stmts(g, rest, tail));
                    Core::Seq(id, Box::new(first), then)
                }
            }
        }
    }
}

/// Sequence an effectful `first` before the remaining statements.
fn seq_then(g: &mut NodeGen, first: Core, rest: &[Stmt], tail: Option<&Expr>) -> Core {
    let then = Box::new(lower_stmts(g, rest, tail));
    Core::Seq(g.fresh(), Box::new(first), then)
}

fn lower_expr(g: &mut NodeGen, expr: &Expr) -> Core {
    match expr {
        Expr::Nat { value, .. } => Core::Nat(g.fresh(), *value),
        Expr::Bool { value, .. } => Core::Bool(g.fresh(), *value),
        Expr::Var { name, .. } => Core::Var(g.fresh(), name.clone()),
        Expr::List { items, .. } => {
            // Build cons(i0, cons(i1, ... nil)) from the right.
            let mut acc = var(g, "nil");
            for item in items.iter().rev() {
                let elem = lower_expr(g, item);
                let cons = var(g, "cons");
                acc = Core::Apply(g.fresh(), Box::new(cons), vec![elem, acc]);
            }
            acc
        }
        Expr::Binary { op, lhs, rhs, .. } => {
            let l = Box::new(lower_expr(g, lhs));
            let r = Box::new(lower_expr(g, rhs));
            Core::BinOp(g.fresh(), map_op(*op), l, r)
        }
        Expr::If { cond, then_blk, else_blk, .. } => {
            let c = Box::new(lower_expr(g, cond));
            let t = Box::new(lower_block(g, then_blk));
            let e = Box::new(lower_block(g, else_blk));
            Core::If(g.fresh(), c, t, e)
        }
        Expr::Block { block, .. } => lower_block(g, block),
        Expr::Lambda { params, body, .. } => Core::Lambda(g.fresh(), params.clone(), Box::new(lower_expr(g, body))),
        Expr::Call { callee, args, .. } => {
            let f = Box::new(lower_expr(g, callee));
            let args = args.iter().map(|a| lower_expr(g, a)).collect();
            Core::Apply(g.fresh(), f, args)
        }
        Expr::Method { recv, name, args, .. } => {
            // UFCS: recv.m(args) -> m(recv, args).
            let callee = Box::new(var(g, name));
            let mut all = vec![lower_expr(g, recv)];
            all.extend(args.iter().map(|a| lower_expr(g, a)));
            Core::Apply(g.fresh(), callee, all)
        }
    }
}
```

> **Implementer note on the tail-less block unit carrier:** using `Core::Nat(_, 0)` as the
> discarded value of a tail-less block is a deliberate simplification — the typechecker (Task 4)
> guarantees such a block is only ever in statement position, so its value is discarded by the
> enclosing `Seq`/`While` and never observed. Do not "fix" this to a real unit node; Core has no
> unit variant by design.

- [ ] **Step 5: Wire modules into `lib.rs`**

Add to `crates/redextape-core/src/lib.rs`:

```rust
pub mod core;
pub mod desugar;
```

> **Naming note:** the module is `redextape_core::core` (our Core AST), distinct from Rust's
> `::core`. Always refer to it as `crate::core` inside the crate to avoid the prelude's `core`.

- [ ] **Step 6: Run the desugar tests to verify they pass**

Run: `cargo test -p redextape-core desugar`
Expected: PASS — all 4 desugar tests.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add crates/redextape-core/src/core.rs crates/redextape-core/src/desugar.rs \
        crates/redextape-core/src/lib.rs
git commit -m "feat(core): add the Core AST and desugar pass"
```

---

### Task 6: Runtime values + reference interpreter

**Files:**
- Create: `crates/redextape-core/src/value.rs`
- Create: `crates/redextape-core/src/interp.rs`
- Modify: `crates/redextape-core/src/prelude.rs` (add the runtime builtins)
- Modify: `crates/redextape-core/src/lib.rs`

**Interfaces:**
- Consumes: `core::{Core, BinOp}`, `prelude::BUILTIN_NAMES`.
- Produces:
  - `value::{Value, Builtin}`. `Value::{Nat(u64), Bool(bool), Nil, Cons(Rc<Value>, Rc<Value>),
    Closure { params, body, env }, Builtin(Builtin), Unit}`. Manual `PartialEq` compares
    `Nat/Bool/Nil/Cons/Unit` structurally; `Closure`/`Builtin` never compare equal.
  - `interp::{eval, eval_with_budget, RuntimeError}`. `eval(core: &Core) -> Result<Value,
    RuntimeError>` runs with a default step budget; `eval_with_budget(core, budget)` is explicit.
    `RuntimeError { message: String }`.
  - `prelude::runtime_env() -> Vec<(String, Value)>` — the builtin runtime bindings.

- [ ] **Step 1: Write `value.rs`**

Create `crates/redextape-core/src/value.rs`:

```rust
//! Runtime values for the reference interpreter (the oracle). Lists are cons-cells so the shape
//! matches the Scott encoding the λ backend will use later.

use crate::core::Core;
use std::cell::RefCell;
use std::rc::Rc;

/// The environment is a cons-list of `name -> mutable slot` frames; closures capture it by `Rc`.
pub type Env = Option<Rc<Frame>>;

pub struct Frame {
    pub name: String,
    pub slot: Rc<RefCell<Value>>,
    pub parent: Env,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Builtin {
    Cons,
    Head,
    Tail,
    IsEmpty,
}

#[derive(Clone)]
pub enum Value {
    Nat(u64),
    Bool(bool),
    Nil,
    Cons(Rc<Value>, Rc<Value>),
    Closure { params: Vec<String>, body: Rc<Core>, env: Env },
    Builtin(Builtin),
    /// Internal statement result (`while`/assignment); never surfaced to the user.
    Unit,
}

impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Value::Nat(a), Value::Nat(b)) => a == b,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            (Value::Nil, Value::Nil) => true,
            (Value::Unit, Value::Unit) => true,
            (Value::Cons(h1, t1), Value::Cons(h2, t2)) => h1 == h2 && t1 == t2,
            // Functions have no structural equality.
            _ => false,
        }
    }
}

impl std::fmt::Debug for Value {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Value::Nat(n) => write!(f, "Nat({n})"),
            Value::Bool(b) => write!(f, "Bool({b})"),
            Value::Nil => write!(f, "Nil"),
            Value::Cons(h, t) => write!(f, "Cons({h:?}, {t:?})"),
            Value::Closure { params, .. } => write!(f, "Closure(|{}|)", params.join(", ")),
            Value::Builtin(b) => write!(f, "Builtin({b:?})"),
            Value::Unit => write!(f, "Unit"),
        }
    }
}

impl Value {
    /// Build a `Value` list from a slice of `Nat`s (test helper + used by `run` result decoding).
    pub fn list_of_nats(ns: &[u64]) -> Value {
        let mut acc = Value::Nil;
        for &n in ns.iter().rev() {
            acc = Value::Cons(Rc::new(Value::Nat(n)), Rc::new(acc));
        }
        acc
    }
}
```

- [ ] **Step 2: Add the runtime builtins to `prelude.rs`**

Append to `crates/redextape-core/src/prelude.rs`:

```rust
use crate::value::{Builtin, Value};

/// The initial runtime environment: `name -> builtin value`.
pub fn runtime_env() -> Vec<(String, Value)> {
    vec![
        ("nil".into(), Value::Nil),
        ("cons".into(), Value::Builtin(Builtin::Cons)),
        ("head".into(), Value::Builtin(Builtin::Head)),
        ("tail".into(), Value::Builtin(Builtin::Tail)),
        ("is_empty".into(), Value::Builtin(Builtin::IsEmpty)),
    ]
}
```

> Add `use` at the top of `prelude.rs` alongside the existing `use crate::ty::...` line. Keep the
> two `use` groups; rustfmt will order them.

- [ ] **Step 3: Write the failing interpreter tests**

Create `crates/redextape-core/src/interp.rs` with the tests first:

```rust
//! Reference tree-walker over the Core AST — the oracle later backends are checked against. Every
//! binding is a mutable `Rc<RefCell<Value>>` slot so `while`/assignment and closures share one
//! mechanism. Subtraction is monus (saturating). A step budget guards against nontermination.

use crate::core::{BinOp, Core};
use crate::prelude::runtime_env;
use crate::value::{Builtin, Env, Frame, Value};
use std::cell::RefCell;
use std::rc::Rc;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;

    fn run(src: &str) -> Value {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        eval(&core).expect("runtime error")
    }

    #[test]
    fn arithmetic_with_monus() {
        assert_eq!(run("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(run("3 - 5"), Value::Nat(0)); // monus
    }

    #[test]
    fn comparisons_and_if() {
        assert_eq!(run("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(run("if 1 == 2 { 10 } else { 20 }"), Value::Nat(20));
    }

    #[test]
    fn let_closure_application() {
        assert_eq!(run("let add1 = |x| x + 1; add1(41)"), Value::Nat(42));
    }

    #[test]
    fn list_builtins() {
        assert_eq!(run("head(cons(7, nil))"), Value::Nat(7));
        assert_eq!(run("is_empty(nil)"), Value::Bool(true));
        assert_eq!(run("is_empty(cons(1, nil))"), Value::Bool(false));
        assert_eq!(run("[1, 2, 3]"), Value::list_of_nats(&[1, 2, 3]));
    }

    #[test]
    fn recursion_via_fn() {
        let src = "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)";
        assert_eq!(run(src), Value::Nat(15));
    }

    #[test]
    fn while_and_mutation() {
        let src = "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)";
        assert_eq!(run(src), Value::Nat(4));
    }

    #[test]
    fn map_and_fold_library_programs_run() {
        let src = "\
            fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
            fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
            fn add(a, b) { a + b }\n\
            fn add1(x) { x + 1 }\n\
            fold([3, 1, 2].map(add1), 0, add)";
        // map(add1) -> [4,2,3]; fold add from 0 -> 9
        assert_eq!(run(src), Value::Nat(9));
    }

    #[test]
    fn head_of_empty_is_a_runtime_error() {
        let (prog, _) = parse("head(nil)");
        let core = desugar(&prog.unwrap());
        let err = eval(&core).unwrap_err();
        assert!(err.message.contains("empty list"), "message: {}", err.message);
    }

    #[test]
    fn budget_exhaustion_is_an_error_not_a_hang() {
        let (prog, _) = parse("fn loop_forever(n) { let mut x = 0; while 0 == 0 { x = x + 1; } x } loop_forever(0)");
        let core = desugar(&prog.unwrap());
        let err = eval_with_budget(&core, 1000).unwrap_err();
        assert!(err.message.contains("step budget"), "message: {}", err.message);
    }
}
```

- [ ] **Step 4: Run the interpreter tests to verify they fail**

Run: `cargo test -p redextape-core interp`
Expected: FAIL — `cannot find function 'eval'`.

- [ ] **Step 5: Implement the interpreter**

Add above the `#[cfg(test)]` module in `interp.rs`:

```rust
/// Default step budget for `eval` — high enough for the demo suite, low enough to fail fast in
/// tests instead of hanging. (§6.4 makes caps first-class; this is the interpreter's own guard.)
pub const DEFAULT_BUDGET: u64 = 5_000_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeError {
    pub message: String,
}

impl RuntimeError {
    fn new(message: impl Into<String>) -> Self {
        RuntimeError { message: message.into() }
    }
}

type EResult = Result<Value, RuntimeError>;

pub fn eval(core: &Core) -> EResult {
    eval_with_budget(core, DEFAULT_BUDGET)
}

pub fn eval_with_budget(core: &Core, budget: u64) -> EResult {
    let mut env: Env = None;
    for (name, value) in runtime_env() {
        env = Some(Rc::new(Frame { name, slot: Rc::new(RefCell::new(value)), parent: env }));
    }
    let mut ev = Evaluator { steps: 0, budget };
    ev.eval(core, &env)
}

struct Evaluator {
    steps: u64,
    budget: u64,
}

impl Evaluator {
    fn tick(&mut self) -> Result<(), RuntimeError> {
        self.steps += 1;
        if self.steps > self.budget {
            return Err(RuntimeError::new(format!("exceeded step budget of {}", self.budget)));
        }
        Ok(())
    }

    fn eval(&mut self, node: &Core, env: &Env) -> EResult {
        self.tick()?;
        match node {
            Core::Nat(_, n) => Ok(Value::Nat(*n)),
            Core::Bool(_, b) => Ok(Value::Bool(*b)),
            Core::Var(_, name) => lookup(env, name).ok_or_else(|| RuntimeError::new(format!("unbound variable `{name}`"))),
            Core::BinOp(_, op, a, b) => {
                let x = self.eval(a, env)?;
                let y = self.eval(b, env)?;
                eval_binop(*op, x, y)
            }
            Core::If(_, c, t, e) => match self.eval(c, env)? {
                Value::Bool(true) => self.eval(t, env),
                Value::Bool(false) => self.eval(e, env),
                other => Err(RuntimeError::new(format!("`if` condition was not a Bool: {other:?}"))),
            },
            Core::Lambda(_, params, body) => Ok(Value::Closure {
                params: params.clone(),
                body: Rc::new((**body).clone()),
                env: env.clone(),
            }),
            Core::Apply(_, callee, args) => {
                let f = self.eval(callee, env)?;
                let mut argv = Vec::with_capacity(args.len());
                for a in args {
                    argv.push(self.eval(a, env)?);
                }
                self.apply(f, argv)
            }
            Core::Let { name, value, body, .. } => {
                let v = self.eval(value, env)?;
                let env2 = push(env, name, v);
                self.eval(body, &env2)
            }
            Core::LetRec { name, value, body, .. } => {
                // Pre-bind the name to a placeholder slot, evaluate the (lambda) value in that
                // extended env so it can see itself, then patch the slot.
                let slot = Rc::new(RefCell::new(Value::Unit));
                let env2 = Some(Rc::new(Frame { name: name.clone(), slot: slot.clone(), parent: env.clone() }));
                let v = self.eval(value, &env2)?;
                *slot.borrow_mut() = v;
                self.eval(body, &env2)
            }
            Core::Seq(_, first, then) => {
                self.eval(first, env)?;
                self.eval(then, env)
            }
            Core::Assign(_, name, value) => {
                let v = self.eval(value, env)?;
                let slot = find_slot(env, name).ok_or_else(|| RuntimeError::new(format!("unbound variable `{name}`")))?;
                *slot.borrow_mut() = v;
                Ok(Value::Unit)
            }
            Core::While(_, cond, body) => {
                loop {
                    self.tick()?;
                    match self.eval(cond, env)? {
                        Value::Bool(true) => {
                            self.eval(body, env)?;
                        }
                        Value::Bool(false) => break,
                        other => return Err(RuntimeError::new(format!("`while` condition was not a Bool: {other:?}"))),
                    }
                }
                Ok(Value::Unit)
            }
        }
    }

    fn apply(&mut self, callee: Value, args: Vec<Value>) -> EResult {
        match callee {
            Value::Closure { params, body, env } => {
                if params.len() != args.len() {
                    return Err(RuntimeError::new(format!("closure expects {} argument(s), got {}", params.len(), args.len())));
                }
                let mut env2 = env.clone();
                for (p, a) in params.iter().zip(args) {
                    env2 = push(&env2, p, a);
                }
                self.eval(&body, &env2)
            }
            Value::Builtin(b) => apply_builtin(b, args),
            other => Err(RuntimeError::new(format!("attempted to call a non-function: {other:?}"))),
        }
    }
}

fn eval_binop(op: BinOp, x: Value, y: Value) -> EResult {
    let (a, b) = match (x, y) {
        (Value::Nat(a), Value::Nat(b)) => (a, b),
        (x, y) => return Err(RuntimeError::new(format!("arithmetic on non-Nat operands: {x:?}, {y:?}"))),
    };
    Ok(match op {
        BinOp::Add => Value::Nat(a.saturating_add(b)),
        BinOp::Sub => Value::Nat(a.saturating_sub(b)), // monus
        BinOp::Mul => Value::Nat(a.saturating_mul(b)),
        BinOp::Eq => Value::Bool(a == b),
        BinOp::Ne => Value::Bool(a != b),
        BinOp::Lt => Value::Bool(a < b),
        BinOp::Le => Value::Bool(a <= b),
        BinOp::Gt => Value::Bool(a > b),
        BinOp::Ge => Value::Bool(a >= b),
    })
}

fn apply_builtin(b: Builtin, args: Vec<Value>) -> EResult {
    match (b, args.as_slice()) {
        (Builtin::Cons, [h, t]) => Ok(Value::Cons(Rc::new(h.clone()), Rc::new(t.clone()))),
        (Builtin::Head, [Value::Cons(h, _)]) => Ok((**h).clone()),
        (Builtin::Head, [Value::Nil]) => Err(RuntimeError::new("head of empty list")),
        (Builtin::Tail, [Value::Cons(_, t)]) => Ok((**t).clone()),
        (Builtin::Tail, [Value::Nil]) => Err(RuntimeError::new("tail of empty list")),
        (Builtin::IsEmpty, [Value::Nil]) => Ok(Value::Bool(true)),
        (Builtin::IsEmpty, [Value::Cons(_, _)]) => Ok(Value::Bool(false)),
        _ => Err(RuntimeError::new(format!("builtin {b:?} applied to bad arguments: {args:?}"))),
    }
}

fn push(env: &Env, name: &str, value: Value) -> Env {
    Some(Rc::new(Frame { name: name.to_string(), slot: Rc::new(RefCell::new(value)), parent: env.clone() }))
}

fn find_slot(env: &Env, name: &str) -> Option<Rc<RefCell<Value>>> {
    let mut cur = env.clone();
    while let Some(frame) = cur {
        if frame.name == name {
            return Some(frame.slot.clone());
        }
        cur = frame.parent.clone();
    }
    None
}

fn lookup(env: &Env, name: &str) -> Option<Value> {
    find_slot(env, name).map(|slot| slot.borrow().clone())
}
```

- [ ] **Step 6: Wire modules into `lib.rs`**

Add to `crates/redextape-core/src/lib.rs`:

```rust
pub mod interp;
pub mod value;
```

- [ ] **Step 7: Run the interpreter tests to verify they pass**

Run: `cargo test -p redextape-core interp`
Expected: PASS — all 9 interpreter tests, including the `map`/`fold` demo returning `Nat(9)` and
`count_down(4)` returning `Nat(4)`.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/value.rs crates/redextape-core/src/interp.rs \
        crates/redextape-core/src/prelude.rs crates/redextape-core/src/lib.rs
git commit -m "feat(core): add runtime values and the reference interpreter"
```

---

### Task 7: Public `analyze` / `run` API — diagnostics surface

**Files:**
- Modify: `crates/redextape-core/src/lib.rs`

**Interfaces:**
- Consumes: `parser::parse`, `typeck::typecheck`, `desugar::desugar`, `interp::{eval,
  RuntimeError}`, `core::Core`, `value::Value`, `Diagnostic`.
- Produces the crate's public entry points:
  - `Analysis { diagnostics: Vec<Diagnostic>, core: Option<Core> }`.
  - `analyze(src: &str) -> Analysis` — runs parse → typecheck → desugar, collecting **all** static
    diagnostics; `core` is `Some` only when there are no error diagnostics.
  - `RunError { Static(Vec<Diagnostic>), Runtime(RuntimeError) }`.
  - `run(src: &str) -> Result<Value, RunError>` — the end-to-end convenience used by tests, the
    CLI (Plan 6), and the WASM layer (Plan 4).

- [ ] **Step 1: Write the failing API tests**

Add a new test module at the bottom of `crates/redextape-core/src/lib.rs`:

```rust
#[cfg(test)]
mod api_tests {
    use super::*;

    #[test]
    fn analyze_reports_parse_errors_with_spans() {
        let a = analyze("(1 + 2");
        assert!(a.core.is_none());
        assert_eq!(a.diagnostics.len(), 1);
        assert!(a.diagnostics[0].message.contains(')'));
    }

    #[test]
    fn analyze_reports_type_errors() {
        let a = analyze("1 + true");
        assert!(a.core.is_none());
        assert!(a.diagnostics.iter().any(|d| d.message.contains("Nat")));
    }

    #[test]
    fn analyze_succeeds_on_valid_program() {
        let a = analyze("let x = 1; x + 2");
        assert!(a.diagnostics.is_empty());
        assert!(a.core.is_some());
    }

    #[test]
    fn run_returns_value_for_valid_program() {
        assert_eq!(run("let x = 40; x + 2").unwrap(), value::Value::Nat(42));
    }

    #[test]
    fn run_returns_static_errors_for_invalid_program() {
        match run("1 + true") {
            Err(RunError::Static(ds)) => assert!(!ds.is_empty()),
            other => panic!("expected static error, got {other:?}"),
        }
    }

    #[test]
    fn run_returns_runtime_error_for_head_of_empty() {
        match run("head(nil)") {
            Err(RunError::Runtime(e)) => assert!(e.message.contains("empty list")),
            other => panic!("expected runtime error, got {other:?}"),
        }
    }
}
```

- [ ] **Step 2: Run the API tests to verify they fail**

Run: `cargo test -p redextape-core api_tests`
Expected: FAIL — `cannot find function 'analyze'` / `cannot find type 'RunError'`.

- [ ] **Step 3: Implement the public API**

Add to `crates/redextape-core/src/lib.rs`, above the test modules (and add
`pub use interp::RuntimeError;` to the re-export group):

```rust
use crate::core::Core;
use crate::interp::{RuntimeError, eval};
use crate::value::Value;

/// The result of static analysis: all diagnostics plus the Core AST when the program is clean.
#[derive(Debug)]
pub struct Analysis {
    pub diagnostics: Vec<Diagnostic>,
    pub core: Option<Core>,
}

/// Parse, typecheck, and desugar `src`, collecting every static diagnostic. `core` is `Some` only
/// when there are no error-severity diagnostics.
pub fn analyze(src: &str) -> Analysis {
    let (program, mut diagnostics) = parser::parse(src);
    let Some(program) = program else {
        return Analysis { diagnostics, core: None };
    };
    diagnostics.extend(typeck::typecheck(&program));
    let has_error = diagnostics.iter().any(|d| d.severity == Severity::Error);
    let core = if has_error { None } else { Some(desugar::desugar(&program)) };
    Analysis { diagnostics, core }
}

/// Why a `run` did not produce a value.
#[derive(Debug)]
pub enum RunError {
    /// Parse or type errors — the program never ran.
    Static(Vec<Diagnostic>),
    /// The program ran but faulted (e.g. `head` of an empty list, or the step budget).
    Runtime(RuntimeError),
}

/// End-to-end: analyze then evaluate. The convenience entry point for the CLI and tests.
pub fn run(src: &str) -> Result<Value, RunError> {
    let analysis = analyze(src);
    match analysis.core {
        Some(core) => eval(&core).map_err(RunError::Runtime),
        None => Err(RunError::Static(analysis.diagnostics)),
    }
}
```

- [ ] **Step 4: Run the API tests to verify they pass**

Run: `cargo test -p redextape-core api_tests`
Expected: PASS — all 6 API tests.

- [ ] **Step 5: Run the full suite + gates**

Run: `cargo test --workspace`
Expected: PASS — every test across all modules.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

Run: `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`
Expected: PASS (line coverage ≥ 80%). If it fails, add unit tests for the uncovered branches the
report names — the most likely gaps are the `Debug`/error-message arms in `value.rs`/`interp.rs`
and the less-common typechecker error paths (arity mismatch, occurs check). Add targeted tests
until the gate passes, then re-run.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/lib.rs
git commit -m "feat(core): add public analyze/run API surfacing diagnostics"
```

- [ ] **Step 7: Confirm CI activation locally**

The CI `detect` job keys on a root `Cargo.toml` (now present). Confirm the exact CI command
sequence passes end-to-end:

Run:
```bash
cargo fmt --all --check && \
cargo clippy --workspace --all-targets -- -D warnings && \
cargo llvm-cov --workspace --all-targets --fail-under-lines 80
```
Expected: all three succeed. The `rust` CI job will now run (and pass) on push; the `web` and
`docker` jobs stay skipped until Plan 5 adds `web/package.json`.

---

## Self-Review

**Spec coverage (front-end slice of §11 v1):**
- Lexer/parser for the mini-language — Tasks 2–3. ✔
- `Nat`/`Bool`/`List`/closures/UFCS chaining — Tasks 3 (parse), 4 (type), 5 (desugar), 6 (run). ✔
- Recursion **and** `while` + `let mut` — Tasks 3–6 (`count_down`, `sum`). ✔
- `map`/`fold` as in-language library (not builtins) — verified end-to-end in Tasks 4 & 6. ✔
- Monus subtraction (`3 - 5 == 0`) — Task 6. ✔
- Reference tree-walker (the §10.1 oracle) — Task 6. ✔
- Inline parse/type diagnostics from day one (§9.4) — Tasks 2, 3, 4, surfaced in Task 7. ✔
- Core AST with per-node `NodeId` (the §5.4 sync anchor) — Task 5. ✔
- **Deferred to later plans (correctly out of this slice):** λ/TM backends (Plans 2–3), source
  maps/view models/trace/WASM (Plan 4), web UI (Plan 5), CLI + formatter (Plan 6), synchronized
  stepping (v1.5). The source-language *printer/formatter* (§8) lands with Plan 6's `fmt` surface;
  this plan intentionally ships only parser + interpreter, which is independently testable.

**Placeholder scan:** no `TBD`/`later`/"add error handling" — every step has complete code and a
concrete command with expected output. The two implementer notes (typecheck `require_value`, the
tail-less-block unit carrier) explain deliberate design choices, not deferred work.

**Type consistency:** `Core`, `NodeId`, `Value`, `Env`, `Builtin`, `RuntimeError`, `Analysis`,
`RunError`, `analyze`, `run`, `eval`, `eval_with_budget`, `typecheck`, `desugar`, `parse`, `lex`
are named identically wherever they appear across tasks. `ast::BinOp` and `core::BinOp` are
distinct-by-design (surface vs Core) and bridged by `desugar::map_op`. `redextape_core::core` is
consistently referred to as `crate::core` to avoid the Rust prelude `core`.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-19-foundation-frontend.md`.** Two
execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks,
   fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution
   with checkpoints.

Which approach?
