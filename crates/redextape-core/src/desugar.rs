//! Surface AST -> Core AST. Reduces sugar: UFCS method calls, list literals, and the
//! block/statement structure. Assumes the program has already parsed and typechecked.

use crate::ast::{self, Block, Expr, Program, Stmt};
use crate::core::{BinOp, Core, NodeGen};

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

/// Iterative: fold the statements right-to-left onto an accumulator that starts as the lowered
/// tail (or the internal unit value for a tail-less block), building the same right-nested
/// `Let`/`LetRec`/`Seq` structure the naive per-statement recursion would, but with a single loop
/// instead of one native stack frame per statement — so an arbitrarily long statement sequence
/// cannot overflow the stack while desugaring (bounded instead by the typecheck depth guard that
/// already ran over the same program upstream, and by the eval depth guard when it's run).
fn lower_stmts(g: &mut NodeGen, stmts: &[Stmt], tail: Option<&Expr>) -> Core {
    // A tail-less block appears only in statement (discarded) position; its value is the internal
    // unit. `Core::Unit` makes that explicit (and distinct from the literal 0).
    let mut acc = match tail {
        Some(e) => lower_expr(g, e),
        None => Core::Unit(g.fresh()),
    };
    for stmt in stmts.iter().rev() {
        acc = match stmt {
            Stmt::Let { name, mutable, value, .. } => {
                let value = Box::new(lower_expr(g, value));
                let id = g.fresh();
                Core::Let { id, name: name.clone(), mutable: *mutable, value, body: Box::new(acc) }
            }
            Stmt::Fn { name, params, body, .. } => {
                let lam = Core::Lambda(g.fresh(), params.clone(), Box::new(lower_block(g, body)));
                let id = g.fresh();
                Core::LetRec { id, name: name.clone(), value: Box::new(lam), body: Box::new(acc) }
            }
            Stmt::Assign { target, value, .. } => {
                let assign = Core::Assign(g.fresh(), target.clone(), Box::new(lower_expr(g, value)));
                Core::Seq(g.fresh(), Box::new(assign), Box::new(acc))
            }
            Stmt::While { cond, body, .. } => {
                let while_ = Core::While(g.fresh(), Box::new(lower_expr(g, cond)), Box::new(lower_block(g, body)));
                Core::Seq(g.fresh(), Box::new(while_), Box::new(acc))
            }
            Stmt::Expr(e) => {
                let first = lower_expr(g, e);
                Core::Seq(g.fresh(), Box::new(first), Box::new(acc))
            }
        };
    }
    acc
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::NodeId;
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
            Core::Assign(_, _, v) => vec![v],
            Core::While(_, cond, body) => vec![cond, body],
            _ => vec![],
        }
    }

    #[test]
    fn method_chain_desugars_to_nested_applies() {
        // xs.map(f) -> map(xs, f)
        let c = core("fn map(xs, f) { xs } fn f(x) { x } map(nil, f).map(f)");
        // The tail `map(nil, f).map(f)` becomes map(map(nil, f), f): two Applies of `map`.
        let applies_of_map = count(
            &c,
            &|n| matches!(n, Core::Apply(_, callee, _) if matches!(callee.as_ref(), Core::Var(_, name) if name == "map")),
        );
        assert_eq!(applies_of_map, 2);
    }

    #[test]
    fn list_literal_desugars_to_cons_nil() {
        let c = core("[1, 2]");
        // Expect cons(1, cons(2, nil)): two `cons` applications and one `nil` var.
        let conses = count(
            &c,
            &|n| matches!(n, Core::Apply(_, callee, _) if matches!(callee.as_ref(), Core::Var(_, name) if name == "cons")),
        );
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
        let c =
            core("fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(3)");
        let mut ids = Vec::new();
        collect_ids(&c, &mut ids);
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(ids.len(), sorted.len(), "duplicate NodeIds found");
    }

    #[test]
    fn expr_statement_lowers_to_seq_with_unique_ids() {
        // `f(1);` is a non-tail expression statement -> Seq(apply f, tail).
        let c = core("fn f(x) { x } f(1); f(2)");
        // The LetRec body is a Seq: first the discarded `f(1)`, then the tail `f(2)`.
        if let Core::LetRec { body, .. } = &c {
            assert!(matches!(body.as_ref(), Core::Seq(..)), "expected Seq body, got {:?}", body);
        } else {
            panic!("expected LetRec at the root, got {c:?}");
        }
        // NodeIds remain unique through the Seq path.
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

    #[test]
    fn long_statement_sequence_desugars_without_stack_overflow() {
        // `lower_stmts` is iterative, so a statement count well above what the old per-statement
        // recursion could survive (empirically ~4800 on an 8 MiB debug main thread) must still
        // desugar cleanly into a deeply right-nested Seq chain with unique NodeIds.
        let stmts: Vec<String> = (0..20_000).map(|i| format!("{i};")).collect();
        let src = stmts.join("");
        let c = core(&src);
        assert!(matches!(&c, Core::Seq(..)), "expected a Seq chain, got {c:?}");
        let mut ids = Vec::new();
        collect_ids(&c, &mut ids);
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(ids.len(), sorted.len(), "duplicate NodeIds found");
    }
}
