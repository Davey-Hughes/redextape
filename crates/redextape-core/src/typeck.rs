//! Hindley–Milner type inference (Algorithm W) over the surface AST. Immutable `let`/`fn`
//! bindings are generalized; `let mut` bindings stay monomorphic (value restriction).

use crate::ast::{BinOp, Block, Expr, Program, Stmt};
use crate::diagnostic::Diagnostic;
use crate::prelude::type_env;
use crate::span::Span;
use crate::ty::{Scheme, Ty};
use std::collections::HashMap;

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
                // Parameters are assignable locals within the function body (e.g. `count_down`
                // reassigns its own `n`), even though they aren't declared with `let mut`.
                for (p, pt) in params.iter().zip(&param_tys) {
                    env.insert(p.clone(), Scheme::mono(pt.clone()), true);
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
