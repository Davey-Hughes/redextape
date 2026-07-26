//! Hindley–Milner type inference (Algorithm W) over the surface AST. Immutable `let`/`fn`
//! bindings are generalized; `let mut` bindings stay monomorphic (value restriction).

use crate::ast::{BinOp, Block, Expr, Program, Stmt};
use crate::diagnostic::Diagnostic;
use crate::prelude::type_env;
use crate::span::Span;
use crate::ty::{Scheme, Ty};
use std::collections::{HashMap, HashSet};

pub fn typecheck(program: &Program) -> Vec<Diagnostic> {
    let mut inf = Infer::new();
    let mut env = TyEnv::new();
    for (name, scheme) in type_env() {
        env.insert(name, scheme, false);
    }
    inf.infer_block(&env, &program.block);
    inf.diags
}

/// Infer the program's top-level result type (the value `run` would produce), fully resolved.
/// `Err` carries the type errors when the program is ill-typed. Used by the AOT backend to decode
/// and print a standalone binary's result without a reference run.
pub fn result_type(program: &Program) -> Result<Ty, Vec<Diagnostic>> {
    let mut inf = Infer::new();
    let mut env = TyEnv::new();
    for (name, scheme) in type_env() {
        env.insert(name, scheme, false);
    }
    let ty = inf.infer_block(&env, &program.block);
    if inf.diags.iter().any(|d| d.severity == crate::diagnostic::Severity::Error) {
        return Err(inf.diags);
    }
    Ok(inf.resolve(&ty))
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

/// Maximum recursion depth of `infer_expr`/`infer_block` before inference gives up on a branch.
/// Every nested expression and block passes through one of these two functions, so counting their
/// combined recursion depth bounds the typechecker's native stack usage; input nested deeper than
/// this yields a `Diagnostic` instead of a typechecker stack overflow (an uncatchable process
/// abort). Chosen empirically at roughly half the depth that overflows an 8 MiB debug main thread
/// (see the crash-harness measurements in the robust-fix report).
const MAX_TYPE_DEPTH: u32 = 1500;

struct Infer {
    subst: HashMap<u32, Ty>,
    next: u32,
    diags: Vec<Diagnostic>,
    depth: u32,
}

impl Infer {
    fn new() -> Self {
        // Prelude schemes quantify over var 0, so start fresh ids above it.
        Infer { subst: HashMap::new(), next: 1, diags: Vec::new(), depth: 0 }
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
                    self.error(
                        span,
                        format!("this function takes {} argument(s) but {} were supplied", p1.len(), p2.len()),
                    );
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
    ///
    /// Wraps `infer_block_inner` with the depth guard so every nesting level (mutually recursive
    /// with `infer_expr`) is counted and every return path decrements `self.depth`.
    fn infer_block(&mut self, env: &TyEnv, block: &Block) -> Ty {
        self.depth += 1;
        if self.depth > MAX_TYPE_DEPTH {
            // Only the first level over the limit reports, to avoid a flood of duplicate diagnostics.
            if self.depth == MAX_TYPE_DEPTH + 1 {
                self.error(block.span, "expression nested too deeply");
            }
            self.depth -= 1;
            return Ty::Unit;
        }
        let ty = self.infer_block_inner(env, block);
        self.depth -= 1;
        ty
    }

    fn infer_block_inner(&mut self, env: &TyEnv, block: &Block) -> Ty {
        let mut env = clone_env(env);
        let mark = env.mark();
        let mut i = 0;
        while i < block.stmts.len() {
            if matches!(&block.stmts[i], Stmt::Fn { .. }) {
                // The maximal run of consecutive `Stmt::Fn`: pre-bind every name in the run
                // monomorphically before checking any body, so a `fn` may forward-reference (or
                // mutually recurse with) any other `fn` in the same run. A non-`fn` statement — a
                // `let`, an `Assign`, a `while`, a bare `Expr` — ends the run; a `fn` after that
                // point starts a fresh one and cannot see the earlier run's names.
                let start = i;
                while i < block.stmts.len() && matches!(&block.stmts[i], Stmt::Fn { .. }) {
                    i += 1;
                }
                self.infer_fn_run(&mut env, &block.stmts[start..i]);
            } else {
                self.infer_stmt(&mut env, &block.stmts[i]);
                i += 1;
            }
        }
        let ty = match &block.tail {
            Some(e) => self.infer_expr(&env, e),
            None => Ty::Unit,
        };
        env.truncate(mark);
        ty
    }

    /// Typecheck a maximal run of consecutive `Stmt::Fn` as a single mutually-recursive group:
    /// every name in the run is bound monomorphically (its own `param_tys`/`ret`/`fun`) before any
    /// body is checked, then each body is checked in turn against that shared, fully-bound
    /// environment. This is what lets `fn a(n){ b(n) }` (or a genuine cycle) see a name defined
    /// later in the same run — the ordering gate that used to reject both forward references and
    /// mutual recursion.
    ///
    /// Everything else matches the original per-`fn` discipline: `rec_mark`/`body_mark`,
    /// `unify(&ret, &body_ty, *span)`, and re-binding each name with a generalized scheme once all
    /// bodies are checked. `fns` is non-empty and every element is `Stmt::Fn` (the caller's run).
    ///
    /// Two members of one run may NOT share a name — that is an error, reported here. This is a
    /// DELIBERATE LANGUAGE CHANGE: before mutual recursion, `fn a … fn a …` was legal and the last
    /// definition simply won, because each `fn` was bound in turn. Pre-binding the whole run makes
    /// that shape genuinely ambiguous rather than merely redundant: last-wins requires the second `a`
    /// to be the INNERMOST binding, while a sibling that calls `a` requires `a` to be OUTSIDE it, and
    /// with `fn b(z){ a(z) } fn a(x){ x } fn a(y){ true }` no ordering satisfies both — the program
    /// typechecks as `Bool` (last-wins) but evaluates through the first `a` to a `Nat`. There is no
    /// winner to pick, so the honest move is to reject, as Rust does ("the name `a` is defined
    /// multiple times"). Two runs separated by a non-`fn` statement are unaffected: those are
    /// ordinary shadowing, not a duplicate, and stay legal.
    fn infer_fn_run(&mut self, env: &mut TyEnv, fns: &[Stmt]) {
        let rec_mark = env.mark();
        // Pass 1: create every function's type and bind its name monomorphically, all before any
        // body is checked (monomorphic mutual recursion).
        let mut sigs: Vec<(Vec<Ty>, Ty, Ty)> = Vec::with_capacity(fns.len());
        let mut defined: HashSet<&str> = HashSet::with_capacity(fns.len());
        for stmt in fns {
            let Stmt::Fn { name, params, span, .. } = stmt else {
                continue;
            };
            if !defined.insert(name.as_str()) {
                // Report and carry on binding it: recovery keeps the rest of the block checkable, and
                // `sigs` must stay index-aligned with `fns` for pass 2.
                self.error(
                    *span,
                    format!("the name `{name}` is defined multiple times in the same group of functions"),
                );
            }
            let param_tys: Vec<Ty> = params.iter().map(|_| self.fresh()).collect();
            let ret = self.fresh();
            let fun = Ty::Fun(param_tys.clone(), Box::new(ret.clone()));
            env.insert(name.clone(), Scheme::mono(fun.clone()), false);
            sigs.push((param_tys, ret, fun));
        }
        // Pass 2: check each body in turn. Parameters are assignable locals within the function
        // body (e.g. `count_down` reassigns its own `n`), even though they aren't declared with
        // `let mut`.
        for (stmt, (param_tys, ret, _)) in fns.iter().zip(&sigs) {
            let Stmt::Fn { params, body, span, .. } = stmt else {
                continue;
            };
            let body_mark = env.mark();
            for (p, pt) in params.iter().zip(param_tys) {
                env.insert(p.clone(), Scheme::mono(pt.clone()), true);
            }
            let body_ty = self.infer_block(env, body);
            self.unify(ret, &body_ty, *span);
            env.truncate(body_mark);
        }
        // Re-bind every name in the run with a generalized scheme for the rest of the block, once
        // all of the run's monomorphic bindings (and the last body's params) are out of the way.
        env.truncate(rec_mark);
        for (stmt, (_, _, fun)) in fns.iter().zip(&sigs) {
            let Stmt::Fn { name, .. } = stmt else {
                continue;
            };
            let scheme = self.generalize(env, fun);
            env.insert(name.clone(), scheme, false);
        }
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
            // A lone `fn` is the degenerate case of a run of one; `infer_block_inner` is the
            // normal call site (it groups consecutive `Stmt::Fn`s before reaching here), but
            // routing a singleton through the same function keeps this arm correct — rather than
            // a second, driftable copy — if `infer_stmt` is ever called on a `Stmt::Fn` directly.
            Stmt::Fn { .. } => self.infer_fn_run(env, std::slice::from_ref(stmt)),
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

    /// Wraps `infer_expr_inner` with the depth guard so every nesting level (mutually recursive with
    /// `infer_block`) is counted and every return path decrements `self.depth`.
    fn infer_expr(&mut self, env: &TyEnv, expr: &Expr) -> Ty {
        self.depth += 1;
        if self.depth > MAX_TYPE_DEPTH {
            if self.depth == MAX_TYPE_DEPTH + 1 {
                self.error(expr.span(), "expression nested too deeply");
            }
            self.depth -= 1;
            return self.fresh();
        }
        let ty = self.infer_expr_inner(env, expr);
        self.depth -= 1;
        ty
    }

    fn infer_expr_inner(&mut self, env: &TyEnv, expr: &Expr) -> Ty {
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
                    env2.insert(p.clone(), Scheme::mono(pt.clone()), true);
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
        stack: env
            .stack
            .iter()
            .map(|b| Binding { name: b.name.clone(), scheme: b.scheme.clone(), mutable: b.mutable })
            .collect(),
    }
}

fn subst_vars(ty: &Ty, mapping: &HashMap<u32, Ty>) -> Ty {
    match ty {
        Ty::Var(v) => mapping.get(v).cloned().unwrap_or(Ty::Var(*v)),
        Ty::List(t) => Ty::List(Box::new(subst_vars(t, mapping))),
        Ty::Fun(ps, r) => {
            Ty::Fun(ps.iter().map(|p| subst_vars(p, mapping)).collect(), Box::new(subst_vars(r, mapping)))
        }
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
    fn method_call_types_as_ufcs() {
        // `recv.m(args)` types as `m(recv, args)`.
        assert_ok("fn add(a, b) { a + b } 1.add(2)");
        // A wrong argument type through method syntax is a mismatch.
        assert_err("fn add(a, b) { a + b } 1.add(cons(1, nil))", "type mismatch");
        // An unknown method name is an unbound variable.
        assert_err("1.nope(2)", "unbound variable `nope`");
    }

    #[test]
    fn wrong_argument_count_is_an_arity_error() {
        assert_err("fn id(x) { x } id(1, 2)", "argument(s)");
    }

    #[test]
    fn self_application_fails_the_occurs_check() {
        assert_err("fn f(x) { x(x) } 0", "recursive type");
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

    #[test]
    fn closure_params_are_assignable_like_fn_params() {
        // A closure may reassign its own parameter, consistent with named `fn`.
        assert_ok("let f = |x| { x = x + 1; x }; f(1)");
    }

    #[test]
    fn mutually_recursive_fns_typecheck() {
        let src = "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
                   fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(10)";
        assert!(crate::analyze(src).diagnostics.is_empty(), "{:?}", crate::analyze(src).diagnostics);
    }

    #[test]
    fn a_forward_reference_without_a_cycle_typechecks() {
        // `a` calls `b`, defined after it, and `b` calls nothing — no cycle, but the same ordering gate.
        let src = "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)";
        assert!(crate::analyze(src).diagnostics.is_empty(), "{:?}", crate::analyze(src).diagnostics);
    }

    #[test]
    fn two_fns_in_one_run_may_not_share_a_name() {
        // A DELIBERATE LANGUAGE CHANGE: `fn a … fn a …` used to be legal (last one won). Pre-binding
        // the whole run makes it ambiguous rather than redundant, so it is now rejected — see
        // `infer_fn_run`'s doc comment.
        //
        // The unsound shape this closes: this program typechecks as `Bool` (last-wins picks the
        // second `a`) but, since `b` needs `a` bound OUTSIDE it, evaluates through the FIRST `a` to
        // `Nat(3)` — a well-typed program producing a value of the wrong type. No ordering can
        // satisfy both constraints, which is why the answer is rejection and not a better ordering.
        assert_err("fn b(z){ a(z) } fn a(x){ x } fn a(y){ true } a(3)", "the name `a` is defined multiple times");
        // The silent value change the same map caused: `b(3)` was 3 (the first `a`), became 4 (the
        // second). Both readings are defensible, which is the point — neither is now on offer.
        assert_err("fn a(x){ x } fn b(y){ a(y) } fn a(z){ z + 1 } b(3)", "the name `a` is defined multiple times");
        // Three definitions: reported once per redefinition, and the run still typechecks onward.
        assert_err("fn a(x){a(x)} fn a(x){a(x)} fn a(x){x} a(1)", "the name `a` is defined multiple times");
        assert_eq!(
            diags("fn a(x){a(x)} fn a(x){a(x)} fn a(x){x} a(1)")
                .iter()
                .filter(|d| d.message.contains("defined multiple times"))
                .count(),
            2,
            "one diagnostic per REDEFINITION, not per definition"
        );
    }

    #[test]
    fn the_same_name_in_two_different_runs_is_still_legal() {
        // Only a duplicate WITHIN one adjacent run is rejected. A non-`fn` statement ends the run, so
        // the second `fn a` is ordinary shadowing — exactly as before this change — and must not be
        // caught by the duplicate check.
        assert_ok("fn a(x){ x } let sep = 0; fn a(y){ y + 1 } a(3)");
        assert_eq!(crate::run("fn a(x){ x } let sep = 0; fn a(y){ y + 1 } a(3)").unwrap(), crate::value::Value::Nat(4));
        // Same name at a different nesting level is likewise untouched.
        assert_ok("fn a(x){ x } fn outer(y){ fn a(z){ z + 1 } a(y) } outer(3)");
    }

    #[test]
    fn a_fn_separated_by_a_let_still_cannot_forward_reference() {
        // The documented bound: grouping stops at a non-`fn` statement.
        let src = "fn a(n){ b(n) } let k = 1; fn b(n){ n } a(3)";
        assert!(!crate::analyze(src).diagnostics.is_empty(), "expected an unbound-name diagnostic");
    }

    #[test]
    fn result_type_infers_top_level() {
        use crate::parser::parse;
        let ty = |src: &str| super::result_type(&parse(src).0.unwrap());
        assert_eq!(ty("1 + 2"), Ok(Ty::Nat));
        assert_eq!(ty("2 > 1"), Ok(Ty::Bool));
        assert_eq!(ty("[1, 2, 3]"), Ok(Ty::List(Box::new(Ty::Nat))));
        assert!(ty("head(nil)").is_ok()); // nil-typed head is polymorphic but well-typed
        assert!(ty("1 + true").is_err()); // ill-typed → diagnostics
    }
}
