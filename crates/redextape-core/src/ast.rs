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

/// A dummy span for the trivial leaves that iterative drop swaps in for moved-out children. These
/// placeholders are only ever dropped, never inspected, so the span value is irrelevant.
const DROP_SPAN: Span = Span { start: 0, end: 0 };

/// Worklist item for the iterative destructor: `Expr`/`Block`/`Stmt` are mutually recursive, so a
/// single-type worklist is insufficient — a deep tree can alternate between them.
enum DropItem {
    E(Expr),
    B(Block),
    S(Stmt),
}

/// Hand-written iterative destructor. The parser builds left-nested `Binary`/`Call`/`Method` chains
/// up to ~`MAX_TOKENS`/2 deep; the compiler-generated recursive `drop_in_place` would recurse once
/// per level and abort the process (SIGABRT) when such a chain is dropped in `analyze`. We unlink
/// every owned child (`Expr`, `Block`, or `Stmt`) into a heap worklist and drain it iteratively.
///
/// Only `Expr` needs an explicit `Drop`: any deep structure is reached through an owned `Expr`
/// somewhere (a `Program`/`Block` tail, an `Expr::Block`, a statement's value), and once that
/// `Expr`'s drop fires it routes the whole mutually-recursive subtree through the worklist. The
/// default field-drop of a `Block`/`Stmt` reached outside the worklist likewise bottoms out at an
/// `Expr` whose iterative `Drop` takes over.
impl Drop for Expr {
    fn drop(&mut self) {
        let mut work: Vec<DropItem> = Vec::new();
        take_expr_children(self, &mut work);
        drain(work);
    }
}

fn drain(mut work: Vec<DropItem>) {
    while let Some(item) = work.pop() {
        match item {
            DropItem::E(mut e) => take_expr_children(&mut e, &mut work),
            DropItem::B(mut b) => take_block_children(&mut b, &mut work),
            DropItem::S(mut s) => take_stmt_children(&mut s, &mut work),
        }
        // The popped node is now childless, so its re-entrant/default drop here is shallow.
    }
}

fn leaf_expr() -> Expr {
    Expr::Nat { value: 0, span: DROP_SPAN }
}

fn leaf_block() -> Block {
    Block { stmts: Vec::new(), tail: None, span: DROP_SPAN }
}

/// Move every owned `Expr`/`Block` child of `e` into `work`, leaving trivial leaves behind.
fn take_expr_children(e: &mut Expr, work: &mut Vec<DropItem>) {
    match e {
        Expr::List { items, .. } => {
            work.extend(std::mem::take(items).into_iter().map(DropItem::E));
        }
        Expr::Binary { lhs, rhs, .. } => {
            work.push(DropItem::E(*std::mem::replace(lhs, Box::new(leaf_expr()))));
            work.push(DropItem::E(*std::mem::replace(rhs, Box::new(leaf_expr()))));
        }
        Expr::If { cond, then_blk, else_blk, .. } => {
            work.push(DropItem::E(*std::mem::replace(cond, Box::new(leaf_expr()))));
            work.push(DropItem::B(std::mem::replace(then_blk, leaf_block())));
            work.push(DropItem::B(std::mem::replace(else_blk, leaf_block())));
        }
        Expr::Block { block, .. } => {
            work.push(DropItem::B(*std::mem::replace(block, Box::new(leaf_block()))));
        }
        Expr::Lambda { body, .. } => {
            work.push(DropItem::E(*std::mem::replace(body, Box::new(leaf_expr()))));
        }
        Expr::Call { callee, args, .. } => {
            work.push(DropItem::E(*std::mem::replace(callee, Box::new(leaf_expr()))));
            work.extend(std::mem::take(args).into_iter().map(DropItem::E));
        }
        Expr::Method { recv, args, .. } => {
            work.push(DropItem::E(*std::mem::replace(recv, Box::new(leaf_expr()))));
            work.extend(std::mem::take(args).into_iter().map(DropItem::E));
        }
        // Childless leaves.
        Expr::Nat { .. } | Expr::Bool { .. } | Expr::Var { .. } => {}
    }
}

/// Move every owned `Stmt`/`Expr` child of `b` into `work`, leaving trivial leaves behind.
fn take_block_children(b: &mut Block, work: &mut Vec<DropItem>) {
    work.extend(std::mem::take(&mut b.stmts).into_iter().map(DropItem::S));
    if let Some(tail) = std::mem::take(&mut b.tail) {
        work.push(DropItem::E(*tail));
    }
}

/// Move every owned `Expr`/`Block` child of `s` into `work`, leaving trivial leaves behind.
fn take_stmt_children(s: &mut Stmt, work: &mut Vec<DropItem>) {
    match s {
        Stmt::Let { value, .. } | Stmt::Assign { value, .. } => {
            work.push(DropItem::E(std::mem::replace(value, leaf_expr())));
        }
        Stmt::Fn { body, .. } => {
            work.push(DropItem::B(std::mem::replace(body, leaf_block())));
        }
        Stmt::While { cond, body, .. } => {
            work.push(DropItem::E(std::mem::replace(cond, leaf_expr())));
            work.push(DropItem::B(std::mem::replace(body, leaf_block())));
        }
        Stmt::Expr(e) => {
            work.push(DropItem::E(std::mem::replace(e, leaf_expr())));
        }
    }
}

impl Expr {
    #[must_use]
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
