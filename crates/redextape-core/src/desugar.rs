//! Surface AST -> Core AST. Reduces sugar: UFCS method calls, list literals, and the
//! block/statement structure. Assumes the program has already parsed and typechecked.

use crate::ast::{self, Block, Expr, Program, Stmt};
use crate::core::{BinOp, Core, NodeGen};
use std::collections::{BTreeMap, BTreeSet};

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
    let mut i = stmts.len();
    while i > 0 {
        let Some(stmt) = stmts.get(i - 1) else { break };
        if matches!(stmt, Stmt::Fn { .. }) {
            // `fn`s are lowered a RUN at a time: the maximal block of adjacent `fn` statements is a
            // mutually-recursive scope (the same run `typeck::infer_fn_run` pre-binds), so its
            // members must be grouped and ordered together rather than emitted one by one in source
            // order. Walking right-to-left we meet a run's END first, so scan back to its start.
            let mut start = i - 1;
            while start > 0 && matches!(stmts.get(start - 1), Some(Stmt::Fn { .. })) {
                start -= 1;
            }
            acc = lower_fn_run(g, stmts.get(start..i).unwrap_or(&[]), acc);
            i = start;
            continue;
        }
        i -= 1;
        acc = match stmt {
            Stmt::Let { name, mutable, value, .. } => {
                let value = Box::new(lower_expr(g, value));
                let id = g.fresh();
                Core::Let { id, name: name.clone(), mutable: *mutable, value, body: Box::new(acc) }
            }
            // Unreachable: the branch above consumes every `Stmt::Fn` as part of a run. Routing a
            // lone one through the same helper (a run of one) keeps this arm correct rather than a
            // second, driftable copy of the lowering.
            Stmt::Fn { .. } => lower_fn_run(g, std::slice::from_ref(stmt), acc),
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

/// Lower one maximal run of adjacent `fn` statements onto `acc` (the already-lowered rest of the
/// block), in dependency order.
///
/// The right-to-left accumulator discipline is preserved: each component WRAPS `acc`, so the
/// component emitted LAST ends up OUTERMOST — and an outer binding is exactly the one an inner one
/// can see. `fn_run_groups` returns components callees-first, so we wrap them in REVERSE, putting
/// callees outermost where every caller in the run can reach them.
///
/// Hoisting a run's members above each other decides what a name inside the run means, in two
/// directions:
///
/// 1. Against an ENCLOSING binding of the same name — an outer `let`, a `fn` from an earlier run, or
///    an enclosing function's parameter — the RUN's `fn` wins. `typeck::infer_fn_run` (Task 1) binds
///    the whole run before checking any body, so this is desugar catching up to the scope the
///    program was typechecked against; the alternative is a program that typechecks against one
///    binding and runs against another. It matches how Rust's own block-scoped `fn` items hoist.
///    `a_member_name_wins_over_an_enclosing_binding_of_the_same_name` pins it. **This is a
///    deliberate language change**: `let g = |x| x * 10; fn f(x){ g(x) } fn g(y){ y } f(3)` was 30
///    and is now 3.
/// 2. Against ANOTHER MEMBER OF THE SAME RUN with the same name, there is no answer to give, so the
///    program is rejected — `typeck::infer_fn_run` reports it. Last-wins wants the second definition
///    INNERMOST while a sibling that calls the name wants it OUTERMOST, and no nesting satisfies
///    both. **Also a deliberate language change**: `fn a … fn a …` in one run used to be legal with
///    the last definition winning. See `infer_fn_run`'s doc comment for the unsound shape it closes.
fn lower_fn_run(g: &mut NodeGen, run: &[Stmt], acc: Core) -> Core {
    let groups = fn_run_groups(run);
    let mut acc = acc;
    for group in groups.iter().rev() {
        acc = match group.as_slice() {
            // Cannot happen (an SCC is never empty); folding it away keeps this total.
            [] => acc,
            // A component of ONE is a plain `LetRec` — byte-identical to what a `fn` lowered to
            // before grouping existed, down to the `NodeId`s, which is the additive guarantee that
            // keeps every step-count golden still. `LetRec` already binds its own name in its value,
            // so a self-recursive member needs nothing more.
            [i] => match run.get(*i) {
                Some(Stmt::Fn { name, params, body, .. }) => {
                    let lam = Core::Lambda(g.fresh(), params.clone(), Box::new(lower_block(g, body)));
                    let id = g.fresh();
                    Core::LetRec { id, name: name.clone(), value: Box::new(lam), body: Box::new(acc) }
                }
                // Cannot happen: every index comes from `run`, and `lower_stmts` only ever passes a
                // run of `Stmt::Fn`.
                _ => acc,
            },
            // Two or more members that reference each other: ONE `LetRecGroup`, every name bound
            // before any value is evaluated. Bindings keep source order (the indices are sorted).
            _ => {
                let mut bindings = Vec::with_capacity(group.len());
                for i in group {
                    if let Some(Stmt::Fn { name, params, body, .. }) = run.get(*i) {
                        let lam = Core::Lambda(g.fresh(), params.clone(), Box::new(lower_block(g, body)));
                        bindings.push((name.clone(), lam));
                    }
                }
                Core::LetRecGroup(g.fresh(), bindings, Box::new(acc))
            }
        };
    }
    acc
}

/// For one maximal run of adjacent `Stmt::Fn`, return its strongly connected components in
/// DEPENDENCY ORDER — callees before callers — as indices into the run.
///
/// Dependency order matters as much as the grouping: `desugar` nests bindings, so a component must
/// be emitted OUTSIDE every component that calls it. Source order is not enough — `fn a(n){ b(n) }
/// fn b(n){ n }` has no cycle but still needs `b` outermost.
///
/// An edge `i -> j` means member `i`'s body references member `j`'s name free — by call or as a
/// value (`free_member_refs`). Self-edges are dropped: a lone self-recursive `fn` is a component of
/// one, and `LetRec` already handles it.
fn fn_run_groups(stmts: &[Stmt]) -> Vec<Vec<usize>> {
    // name -> index. `typeck::infer_fn_run` rejects a run that binds the same name twice, so on any
    // program that got here from source this is a bijection and the insert never collides. It stays
    // last-wins for the raw-AST case (`desugar` is `pub`), matching `TyEnv::lookup`'s reverse scan
    // rather than inventing a second resolution rule.
    let mut index_of: BTreeMap<&str, usize> = BTreeMap::new();
    for (i, stmt) in stmts.iter().enumerate() {
        if let Stmt::Fn { name, .. } = stmt {
            index_of.insert(name.as_str(), i);
        }
    }
    let members: BTreeSet<&str> = index_of.keys().copied().collect();
    let mut adj: Vec<Vec<usize>> = Vec::with_capacity(stmts.len());
    for (i, stmt) in stmts.iter().enumerate() {
        let mut edges: Vec<usize> = Vec::new();
        if let Stmt::Fn { name: own, params, body, .. } = stmt {
            for name in free_member_refs(&members, params, body) {
                // A member's reference to its OWN name is a SELF-reference, full stop: the
                // `LetRec`/`LetRecGroup` this member is emitted into binds that name in its own
                // value, so nothing outside the member can be meant. Decided BEFORE the lookup,
                // because `index_of` is keyed by name and a name is only unique across the run once
                // `typeck::infer_fn_run` has rejected duplicates — and `desugar` is `pub`, so it also
                // runs on ASTs that never met the typechecker. On such an AST a name→last-index
                // lookup would turn a self-call into a cross-edge to the same-named sibling and
                // invert their nesting; this keeps the pass honest without depending on an upstream
                // check. Cheap either way: one string comparison per reference.
                if name == own.as_str() {
                    continue;
                }
                match index_of.get(name) {
                    Some(&j) if j != i => edges.push(j),
                    _ => {}
                }
            }
            edges.sort_unstable();
            edges.dedup();
        }
        adj.push(edges);
    }
    strongly_connected(&adj)
}

/// A scope in `free_member_refs`'s shadow chain: `(enclosing scope, the one name it shadows)`.
/// Scopes live in a flat arena and are addressed by index; `NO_SHADOW` (an index no arena slot can
/// have) is the root, where nothing is shadowed. Only names in the member set ever get a node, so a
/// body that shadows nothing costs nothing to build or to walk.
type Shadow<'a> = (usize, &'a str);
const NO_SHADOW: usize = usize::MAX;

/// Is `name` shadowed at scope `scope`? Walks the chain to the root — a loop, not recursion.
///
/// Cost is O(chain depth), and the chain is never truncated within one `free_member_refs` call, so a
/// body that binds K member names in sequence makes this O(K^2) overall. K is the number of DISTINCT
/// member names actually rebound inside one `fn` body — nothing else gets a node — so in practice it
/// is 0 or 1. Noted as a bound, not a live cost: it is well under the noise even at the 5,000-member
/// runs `a_long_fn_chain_groups_without_stack_overflow` exercises.
fn shadowed(chain: &[Shadow<'_>], scope: usize, name: &str) -> bool {
    let mut cur = scope;
    // `get` returns `None` for `NO_SHADOW`, which ends the walk at the root.
    while let Some(&(parent, bound)) = chain.get(cur) {
        if bound == name {
            return true;
        }
        cur = parent;
    }
    false
}

/// Extend `scope` with a binding of `name`, if `name` could shadow a member reference. Returns the
/// new scope (or `scope` unchanged when `name` is not a member name — nothing to track).
fn bind<'a>(chain: &mut Vec<Shadow<'a>>, scope: usize, members: &BTreeSet<&'a str>, name: &'a str) -> usize {
    if members.contains(name) {
        chain.push((scope, name));
        chain.len() - 1
    } else {
        scope
    }
}

/// The `members` names that appear FREE in one `fn` body — the references that make this member
/// depend on the others. Scope-aware: a name rebound inside the body (a parameter, a `let`, a lambda
/// parameter, a nested `fn`) shadows the member of the same name and is NOT a dependency, exactly as
/// the typechecker resolves it.
///
/// ITERATIVE: an explicit worklist over `Expr`/`Block`, never recursion. A surface tree is as deep as
/// the program is long (`ast.rs`'s hand-written iterative `Drop` exists for the same reason), and a
/// recursive walk here would abort the process with an uncatchable stack overflow.
///
/// A list literal's synthetic `cons`/`nil` are deliberately NOT references: `typeck` types a list
/// literal structurally without consulting either name, so counting them would make this analysis
/// disagree with the scope the typechecker checked against.
fn free_member_refs<'a>(members: &BTreeSet<&'a str>, params: &'a [String], body: &'a Block) -> BTreeSet<&'a str> {
    let mut out: BTreeSet<&'a str> = BTreeSet::new();
    if members.is_empty() {
        return out;
    }
    let mut chain: Vec<Shadow<'a>> = Vec::new();
    let mut scope = NO_SHADOW;
    for p in params {
        scope = bind(&mut chain, scope, members, p.as_str());
    }
    let mut work: Vec<Work<'a>> = vec![Work::B(body, scope)];
    while let Some(item) = work.pop() {
        match item {
            Work::E(expr, scope) => match expr {
                Expr::Nat { .. } | Expr::Bool { .. } => {}
                Expr::Var { name, .. } => note(&mut out, members, &chain, scope, name.as_str()),
                Expr::List { items, .. } => work.extend(items.iter().map(|e| Work::E(e, scope))),
                Expr::Binary { lhs, rhs, .. } => {
                    work.push(Work::E(lhs, scope));
                    work.push(Work::E(rhs, scope));
                }
                Expr::If { cond, then_blk, else_blk, .. } => {
                    work.push(Work::E(cond, scope));
                    work.push(Work::B(then_blk, scope));
                    work.push(Work::B(else_blk, scope));
                }
                Expr::Block { block, .. } => work.push(Work::B(block, scope)),
                Expr::Lambda { params, body, .. } => {
                    let mut inner = scope;
                    for p in params {
                        inner = bind(&mut chain, inner, members, p.as_str());
                    }
                    work.push(Work::E(body, inner));
                }
                Expr::Call { callee, args, .. } => {
                    work.push(Work::E(callee, scope));
                    work.extend(args.iter().map(|e| Work::E(e, scope)));
                }
                Expr::Method { recv, name, args, .. } => {
                    // UFCS: `recv.m(args)` is a reference to whatever `m` names in scope, both here
                    // and in `typeck` (which looks `m` up in the environment).
                    note(&mut out, members, &chain, scope, name.as_str());
                    work.push(Work::E(recv, scope));
                    work.extend(args.iter().map(|e| Work::E(e, scope)));
                }
            },
            Work::B(block, scope) => {
                // Statements bind progressively: a `let`'s name covers the rest of the block (but not
                // its own value), and a nested `fn` run's names cover the rest of the block AND every
                // body in that run — the rule `typeck::infer_fn_run` applies.
                let mut cur = scope;
                let mut i = 0;
                while let Some(stmt) = block.stmts.get(i) {
                    match stmt {
                        Stmt::Let { name, value, .. } => {
                            work.push(Work::E(value, cur));
                            cur = bind(&mut chain, cur, members, name.as_str());
                            i += 1;
                        }
                        Stmt::Fn { .. } => {
                            let start = i;
                            while matches!(block.stmts.get(i), Some(Stmt::Fn { .. })) {
                                i += 1;
                            }
                            let nested = block.stmts.get(start..i).unwrap_or(&[]);
                            for stmt in nested {
                                if let Stmt::Fn { name, .. } = stmt {
                                    cur = bind(&mut chain, cur, members, name.as_str());
                                }
                            }
                            for stmt in nested {
                                if let Stmt::Fn { params, body, .. } = stmt {
                                    let mut inner = cur;
                                    for p in params {
                                        inner = bind(&mut chain, inner, members, p.as_str());
                                    }
                                    work.push(Work::B(body, inner));
                                }
                            }
                        }
                        Stmt::Assign { target, value, .. } => {
                            note(&mut out, members, &chain, cur, target.as_str());
                            work.push(Work::E(value, cur));
                            i += 1;
                        }
                        Stmt::While { cond, body, .. } => {
                            work.push(Work::E(cond, cur));
                            work.push(Work::B(body, cur));
                            i += 1;
                        }
                        Stmt::Expr(e) => {
                            work.push(Work::E(e, cur));
                            i += 1;
                        }
                    }
                }
                if let Some(tail) = &block.tail {
                    work.push(Work::E(tail, cur));
                }
            }
        }
    }
    out
}

/// A pending subtree in `free_member_refs`'s worklist, paired with the scope it sits in.
enum Work<'a> {
    E(&'a Expr, usize),
    B(&'a Block, usize),
}

/// Record `name` as a dependency if it names a member and is not shadowed at `scope`.
fn note<'a>(
    out: &mut BTreeSet<&'a str>,
    members: &BTreeSet<&'a str>,
    chain: &[Shadow<'_>],
    scope: usize,
    name: &'a str,
) {
    if members.contains(name) && !shadowed(chain, scope, name) {
        out.insert(name);
    }
}

/// Tarjan's strongly connected components, ITERATIVE — an explicit frame stack, never recursion.
/// Tarjan's is naturally recursive, and a recursive walk over a long `fn` run would reintroduce
/// exactly the uncatchable stack overflow `Core`'s hand-written `Drop` exists to prevent.
///
/// Components come out in REVERSE TOPOLOGICAL order of the condensation: a component is emitted
/// before every component with an edge INTO it, so with `i -> j` meaning "i calls j", callees are
/// emitted before their callers. Roots are visited in index order, so a graph with no edges yields
/// one singleton per node IN SOURCE ORDER — which is what makes an existing, non-mutual program lower
/// exactly as it did before. Each component's indices are sorted ascending (source order).
fn strongly_connected(adj: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let n = adj.len();
    let mut index: Vec<Option<usize>> = vec![None; n];
    let mut low: Vec<usize> = vec![0; n];
    let mut on_stack: Vec<bool> = vec![false; n];
    let mut stack: Vec<usize> = Vec::new(); // Tarjan's component stack.
    let mut frames: Vec<(usize, usize)> = Vec::new(); // (node, next edge to visit) — the "call" stack.
    let mut counter = 0usize;
    let mut out: Vec<Vec<usize>> = Vec::new();

    for root in 0..n {
        if index.get(root).copied().flatten().is_some() {
            continue;
        }
        frames.push((root, 0));
        while let Some(&(v, edge)) = frames.last() {
            // First time this frame is on top: assign its index and put it on the component stack.
            // A frame is opened the moment it is pushed (it is immediately the top), so no node is
            // ever pushed twice.
            if index.get(v).copied().flatten().is_none() {
                if let Some(slot) = index.get_mut(v) {
                    *slot = Some(counter);
                }
                if let Some(slot) = low.get_mut(v) {
                    *slot = counter;
                }
                if let Some(slot) = on_stack.get_mut(v) {
                    *slot = true;
                }
                counter += 1;
                stack.push(v);
            }
            match adj.get(v).and_then(|e| e.get(edge)).copied() {
                Some(w) => {
                    if let Some(frame) = frames.last_mut() {
                        frame.1 = edge + 1;
                    }
                    match index.get(w).copied().flatten() {
                        // Not yet visited: descend.
                        None => frames.push((w, 0)),
                        // Visited and still on the stack: a back/cross edge within this component.
                        Some(iw) if on_stack.get(w).copied().unwrap_or(false) => {
                            if let Some(slot) = low.get_mut(v) {
                                *slot = (*slot).min(iw);
                            }
                        }
                        // Visited and already assigned to a finished component: ignore.
                        Some(_) => {}
                    }
                }
                // Every edge explored: close the frame.
                None => {
                    frames.pop();
                    let v_low = low.get(v).copied().unwrap_or(0);
                    if index.get(v).copied().flatten() == Some(v_low) {
                        // `v` roots a component: everything above it on the stack belongs to it.
                        let mut component: Vec<usize> = Vec::new();
                        while let Some(w) = stack.pop() {
                            if let Some(slot) = on_stack.get_mut(w) {
                                *slot = false;
                            }
                            component.push(w);
                            if w == v {
                                break;
                            }
                        }
                        component.sort_unstable();
                        out.push(component);
                    }
                    if let Some(&(parent, _)) = frames.last()
                        && let Some(slot) = low.get_mut(parent)
                    {
                        *slot = (*slot).min(v_low);
                    }
                }
            }
        }
    }
    out
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

    /// Every `Core` variant's children, mirroring `core.rs::take_core_children` (the authority).
    /// Deliberately EXHAUSTIVE — no catch-all arm — so a new `Core` variant is a compile error here
    /// rather than a silently childless node that makes `count`/`collect_ids`/`contains_group`
    /// under-report. (A catch-all is exactly how `LetRecGroup` first slipped through.)
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
            Core::LetRecGroup(_, bindings, body) => {
                let mut v: Vec<&Core> = bindings.iter().map(|(_, value)| value).collect();
                v.push(body);
                v
            }
            Core::Assign(_, _, v) => vec![v],
            Core::While(_, cond, body) => vec![cond, body],
            // Truly childless leaves.
            Core::Nat(..) | Core::Bool(..) | Core::Unit(..) | Core::Var(..) => vec![],
        }
    }

    /// Does the tree contain a `LetRecGroup` anywhere? ITERATIVE (a worklist, never recursion):
    /// `Core` spines reach tens of thousands of nodes deep, and a recursive walk would abort the
    /// test process with an uncatchable stack overflow on one.
    fn contains_group(root: &Core) -> bool {
        let mut work: Vec<&Core> = vec![root];
        while let Some(node) = work.pop() {
            if matches!(node, Core::LetRecGroup(..)) {
                return true;
            }
            work.extend(children(node));
        }
        false
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
    fn mutual_recursion_runs_end_to_end() {
        let src = "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
                   fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(10)";
        assert_eq!(crate::run(src).unwrap(), crate::value::Value::Bool(true));
    }

    #[test]
    fn a_forward_reference_without_a_cycle_runs() {
        // No cycle — but `a` still needs to see `b`, which is defined after it.
        assert_eq!(crate::run("fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)").unwrap(), crate::value::Value::Nat(7));
    }

    #[test]
    fn a_three_member_cycle_runs() {
        // n = 2 can pass while an n-ary bug lurks; pin n = 3.
        let src = "fn f(n){ if n == 0 { 0 } else { g(n - 1) } } \
                   fn g(n){ if n == 0 { 1 } else { h(n - 1) } } \
                   fn h(n){ if n == 0 { 2 } else { f(n - 1) } } f(7)";
        assert_eq!(crate::run(src).unwrap(), crate::value::Value::Nat(1));
    }

    #[test]
    fn an_independent_fn_still_lowers_as_a_plain_letrec() {
        // The additive guarantee: a non-mutual `fn` must NOT become a group.
        let core = desugar(&crate::parser::parse("fn f(n){ n + 1 } f(2)").0.unwrap());
        assert!(!contains_group(&core), "a singleton must stay a LetRec, or every step golden moves");
    }

    #[test]
    fn a_mutual_pair_lowers_to_one_group_holding_both_names() {
        // The other side of the guarantee: a genuine cycle DOES become one `LetRecGroup`, with its
        // members in source order — not two nested `LetRec`s (which could never see each other).
        let c = core(
            "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
                      fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(10)",
        );
        let Core::LetRecGroup(_, bindings, _) = &c else {
            panic!("expected a LetRecGroup at the root, got {c:?}");
        };
        let names: Vec<&str> = bindings.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["is_even", "is_odd"]);
        assert!(bindings.iter().all(|(_, v)| matches!(v, Core::Lambda(..))), "every value must be a Lambda");
    }

    #[test]
    fn a_run_ends_at_a_non_fn_statement() {
        // Grouping spans one MAXIMAL run of adjacent `fn`s — the same bound `typeck::infer_fn_run`
        // enforces. A `let` between them splits the run, so `a` cannot see `b` and the program is
        // still rejected (statically, by the typechecker) rather than silently grouped.
        assert!(crate::run("fn a(n){ b(n) } let k = 1; fn b(n){ n } a(3)").is_err());
        // Split by a `let`, each run lowers on its own — and each is a singleton, so no group.
        let c = core("fn a(x){ x } let k = 1; fn b(y){ a(y) + k } b(2)");
        assert!(!contains_group(&c));
    }

    #[test]
    fn a_duplicate_fn_name_keeps_the_later_definition_innermost() {
        // `typeck` now REJECTS two members of one run sharing a name (see `infer_fn_run`), so no
        // program reaching the compiler from source can hit this. `desugar` is `pub` and runs on a
        // raw AST though, so it must still not scramble the shape — which is what `fn_run_groups`'s
        // own-name check buys, and this test is its guard. Asserted structurally, since `crate::run`
        // no longer gets this far.
        //
        // Source order must survive: the FIRST definition outermost, the SECOND innermost, so a
        // reader (and any consumer that resolves names the way `TyEnv::lookup` does, last-wins)
        // still finds the second. Reading the first definition's self-call as a reference to the
        // second turns a dropped self-edge into a cross-edge and inverts exactly that.
        let c = core("fn a(n){ if n == 0 { 99 } else { a(n - 1) } } fn a(n){ n + 1 } a(3)");
        let Core::LetRec { name: outer, value: outer_value, body, .. } = &c else {
            panic!("expected a LetRec at the root, got {c:?}");
        };
        assert_eq!(outer, "a");
        assert!(
            matches!(outer_value.as_ref(), Core::Lambda(_, _, b) if matches!(b.as_ref(), Core::If(..))),
            "the OUTER binding must be the FIRST definition (the one whose body is the `if`)"
        );
        let Core::LetRec { name: inner, value: inner_value, .. } = body.as_ref() else {
            panic!("expected a second LetRec, got {body:?}");
        };
        assert_eq!(inner, "a");
        assert!(
            matches!(inner_value.as_ref(), Core::Lambda(_, _, b) if matches!(b.as_ref(), Core::BinOp(..))),
            "the INNER binding must be the SECOND definition (`n + 1`), the one a last-wins lookup finds"
        );
        // A self-call must never pull a same-named sibling into the same component.
        assert!(!contains_group(&core("fn a(x){ a(x) } fn a(x){ x } a(1)")));
        assert!(!contains_group(&core("fn a(x){ a(x) } fn a(x){ x } fn b(x){ a(x) } b(1)")));
    }

    #[test]
    fn a_member_name_wins_over_an_enclosing_binding_of_the_same_name() {
        // The one intended, observable behaviour change of this pass. A run's members are hoisted
        // above each other, so a name bound BOTH by an enclosing binding and by a later member of the
        // run resolves, inside the run, to the run's `fn` — these three all yielded 30 before and
        // yield 3 now.
        //
        // This is desugar catching up to `typeck::infer_fn_run` (Task 1), which already binds the
        // whole run before checking any body: the typechecker checks `g(x)` against the run's `g`, so
        // desugar binding it to the enclosing `g` would mean a program typechecked against one
        // binding and run against another. Rust's own block-scoped `fn` items hoist the same way.
        // Not observable at Task 2 — the grouping in this file is what makes it visible.
        assert_eq!(
            crate::run("let g = |x| x * 10; fn f(x){ g(x) } fn g(y){ y } f(3)").unwrap(),
            crate::value::Value::Nat(3),
            "an enclosing `let` of the same name must lose to the run's `fn`"
        );
        assert_eq!(
            crate::run("fn g(x){ x * 10 } let sep = 0; fn f(x){ g(x) + sep } fn g(y){ y } f(3)").unwrap(),
            crate::value::Value::Nat(3),
            "a same-named `fn` from a PREVIOUS run must lose to this run's `fn`"
        );
        assert_eq!(
            crate::run("fn outer(g){ fn f(x){ g(x) } fn g(y){ y } f(3) } outer(|x| x * 10)").unwrap(),
            crate::value::Value::Nat(3),
            "an enclosing PARAMETER must lose to the nested run's `fn`"
        );
    }

    #[test]
    fn a_shadowed_member_name_is_not_a_dependency() {
        // `f` mentions `g`, but as its own local — the later `fn g` is NOT a dependency, so the two
        // stay independent singletons and lower exactly as they did before grouping existed.
        let c = core("fn f(x){ let g = 1; g + x } fn g(y){ y } f(1)");
        assert!(!contains_group(&c), "a shadowed name must not create an edge");
        assert!(matches!(&c, Core::LetRec { name, .. } if name == "f"), "source order must be preserved: {c:?}");
    }

    #[test]
    fn a_long_fn_chain_groups_without_stack_overflow() {
        // The SCC pass is iterative, so a `fn` run whose dependency chain is thousands deep — the
        // worst case for a recursive Tarjan, which would recurse once per link and abort the process
        // with an uncatchable stack overflow — must still desugar. Each link is its own component,
        // so the result is a chain of plain `LetRec`s with the LAST `fn` outermost (callees first).
        const N: usize = 5_000;
        let mut src = String::new();
        for i in 0..N {
            if i + 1 == N {
                src.push_str(&format!("fn f{i}(n){{ n }} "));
            } else {
                src.push_str(&format!("fn f{i}(n){{ f{}(n) }} ", i + 1));
            }
        }
        src.push_str("f0(1)");
        let c = core(&src);
        assert!(!contains_group(&c), "a chain has no cycle, so every component is a singleton");
        assert!(
            matches!(&c, Core::LetRec { name, .. } if *name == format!("f{}", N - 1)),
            "the callee-most `fn` must be outermost"
        );
    }

    /// Cross-check the hand-written iterative Tarjan against the DEFINITION of an SCC, on a few
    /// thousand small random graphs: `u` and `v` share a component iff each reaches the other. Also
    /// checks the two properties `lower_fn_run` relies on — every node appears exactly once, and the
    /// components come out callees-first (a component is emitted before any component with an edge
    /// into it). A hand-rolled Tarjan is easy to get subtly wrong; this is the guard.
    #[test]
    fn strongly_connected_matches_the_definition_and_is_callees_first() {
        // A deterministic LCG, so a failure is reproducible without a proptest dependency.
        let mut seed: u64 = 0x2545_F491_4F6C_DD1D;
        let mut next = move || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) as usize
        };
        for _ in 0..3_000 {
            let n = next() % 8;
            let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
            for edges in adj.iter_mut() {
                for v in 0..n {
                    // ~30% edge density, self-edges included.
                    if next() % 10 < 3 {
                        edges.push(v);
                    }
                }
            }
            // Brute-force reachability (transitive closure of the edge relation).
            let mut reach = vec![vec![false; n]; n];
            for (u, edges) in adj.iter().enumerate() {
                for v in edges {
                    reach[u][*v] = true;
                }
            }
            for k in 0..n {
                for i in 0..n {
                    for j in 0..n {
                        if reach[i][k] && reach[k][j] {
                            reach[i][j] = true;
                        }
                    }
                }
            }
            let comps = strongly_connected(&adj);
            // 1. A partition: every node exactly once.
            let mut seen: Vec<usize> = comps.iter().flatten().copied().collect();
            seen.sort_unstable();
            assert_eq!(seen, (0..n).collect::<Vec<_>>(), "components must partition the nodes: {adj:?}");
            // 2. Exactly the mutual-reachability classes.
            let mut comp_of = vec![usize::MAX; n];
            for (ci, comp) in comps.iter().enumerate() {
                for v in comp {
                    comp_of[*v] = ci;
                }
            }
            for u in 0..n {
                for v in 0..n {
                    let mutual = u == v || (reach[u][v] && reach[v][u]);
                    assert_eq!(mutual, comp_of[u] == comp_of[v], "u={u} v={v} in {adj:?} -> {comps:?}");
                }
            }
            // 3. Callees first: an edge u -> v puts v's component no later than u's.
            for (u, edges) in adj.iter().enumerate() {
                for v in edges {
                    assert!(comp_of[*v] <= comp_of[u], "edge {u}->{v} is out of order in {adj:?} -> {comps:?}");
                }
            }
        }
    }

    #[test]
    fn an_edgeless_run_keeps_source_order() {
        // What makes an existing program lower identically: with no dependencies at all, the
        // components are singletons in source order, so the right-to-left fold emits exactly what it
        // always did. This is the shape `fn_run_groups` actually hands over for a run of independent
        // `fn`s — it strips self-edges, so its graphs are genuinely edgeless, not self-looping.
        assert_eq!(strongly_connected(&vec![Vec::new(); 4]), vec![vec![0], vec![1], vec![2], vec![3]]);
        // Self-loops must not change that (they cannot reach `strongly_connected` from
        // `fn_run_groups`, but a self-loop is still a legitimate SCC input and must stay a singleton).
        let with_self_loops: Vec<Vec<usize>> = vec![Vec::new(), vec![1], Vec::new(), vec![3]];
        assert_eq!(strongly_connected(&with_self_loops), vec![vec![0], vec![1], vec![2], vec![3]]);
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
