//! Core AST -> de Bruijn lambda-term. This module has the functional path (Task 5) and the
//! store-passing path for `let mut`/`while` (Task 6). Lowering is syntax-directed and total
//! (returns `LowerError`, never panics).

use crate::core::{Core, NodeId};
use crate::lambda::encode;
use crate::lambda::term::{LambdaTerm, abs, app, shift, var};

/// Scope sentinel for a store binder introduced by store-passing. `$` is not a legal identifier
/// character, so this can never collide with a user variable (reads resolve to the innermost one).
const STORE: &str = "$store";
/// Scope sentinel for a `while`'s recursive `loop` binder.
const LOOP: &str = "$loop";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LowerError {
    /// A closure assigns a variable captured from an outer scope (§5.3 — v1 limitation).
    StatefulClosure { node: NodeId },
    /// A construct the lambda backend does not yet support.
    Unsupported { node: NodeId, what: String },
}

/// The `fix` combinator (call-by-name Y): `\f. (\x. f (x x)) (\x. f (x x))`.
fn fix() -> LambdaTerm {
    let inner = abs("x", app(var(1), app(var(0), var(0))));
    abs("f", app(inner.clone(), inner))
}

// --- Store-passing helpers (§5.2) -----------------------------------------------------------
//
// The store of `k` mutable variables is the Scott k-tuple `\sel. sel v0 v1 ... v(k-1)`. Reading
// slot `i` applies the store to a selector that projects the i-th of k arguments; updating slot `i`
// rebuilds the tuple with the other slots re-projected from the old store. All three are pure
// `LambdaTerm` builders unit-tested via the reducer.

/// Build the store `\sel. sel v0 ... v(k-1)`. Each value moves under the new `\sel` binder, so its
/// free variables shift by one.
fn store_of(values: &[LambdaTerm]) -> LambdaTerm {
    let mut body = var(0); // sel
    for v in values {
        body = app(body, shift(1, 0, v));
    }
    abs("sel", body)
}

/// The selector `\v0. ... \v(k-1). vi` — picks the i-th of `k` arguments. Under `k` binders the
/// i-th (from the outside) is `var(k - 1 - i)`.
fn selector(i: usize, k: usize) -> LambdaTerm {
    let mut body = var((k - 1 - i) as u32);
    for _ in 0..k {
        body = abs("v", body);
    }
    body
}

/// Read slot `i`: `store (\v0...v(k-1). vi)`.
fn project(store: LambdaTerm, i: usize, k: usize) -> LambdaTerm {
    app(store, selector(i, k))
}

/// Rebuild the store with slot `i` replaced by `new` (other slots re-projected from `store`).
fn update(store: &LambdaTerm, i: usize, new: LambdaTerm, k: usize) -> LambdaTerm {
    let mut slots: Vec<LambdaTerm> = Vec::with_capacity(k);
    for j in 0..k {
        if j == i {
            slots.push(new.clone());
        } else {
            slots.push(project(store.clone(), j, k));
        }
    }
    store_of(&slots)
}

/// The ordered mutable variables live in a store-passing region. The store binder itself is found
/// by name (`STORE`) via `resolve`, so its de Bruijn index tracks the current binder depth for free.
struct StoreCtx {
    vars: Vec<String>,
}

impl StoreCtx {
    fn index_of(&self, name: &str) -> Option<usize> {
        self.vars.iter().position(|n| n == name)
    }
    fn k(&self) -> usize {
        self.vars.len()
    }
}

/// Position of a node within a region: does it yield the region's value, or the threaded store?
#[derive(Clone, Copy)]
enum Pos {
    Value,
    Store,
}

pub fn lower(core: &Core) -> Result<LambdaTerm, LowerError> {
    let mut scope: Vec<String> = Vec::new();
    lower_expr(core, &mut scope, None)
}

/// Resolve a name to a de Bruijn index (innermost binding), or fall back to a prelude encoder.
fn resolve(name: &str, scope: &[String]) -> Option<LambdaTerm> {
    if let Some(pos) = scope.iter().rposition(|n| n == name) {
        return Some(var((scope.len() - 1 - pos) as u32));
    }
    match name {
        "nil" => Some(encode::nil()),
        "cons" => Some(encode::cons()),
        "head" => Some(encode::head()),
        "tail" => Some(encode::tail()),
        "is_empty" => Some(encode::is_empty()),
        _ => None,
    }
}

fn lower_expr(core: &Core, scope: &mut Vec<String>, ctx: Option<&StoreCtx>) -> Result<LambdaTerm, LowerError> {
    match core {
        Core::Nat(_, n) => Ok(encode::church(*n)),
        Core::Bool(_, b) => Ok(if *b { encode::tru() } else { encode::fls() }),
        // A mutable variable in a region reads by projecting from the current store; everything else
        // resolves to a de Bruijn index (or a prelude encoder).
        Core::Var(id, name) => {
            if let Some(ctx) = ctx
                && let Some(i) = ctx.index_of(name)
            {
                return Ok(project(cur_store(scope)?, i, ctx.k()));
            }
            resolve(name, scope).ok_or_else(|| LowerError::Unsupported { node: *id, what: format!("unbound `{name}`") })
        }
        Core::BinOp(_, op, a, b) => {
            let la = lower_expr(a, scope, ctx)?;
            let lb = lower_expr(b, scope, ctx)?;
            Ok(app(app(encode::binop(*op), la), lb))
        }
        Core::If(_, c, t, e) => {
            let lc = lower_expr(c, scope, ctx)?;
            let lt = lower_expr(t, scope, ctx)?;
            let le = lower_expr(e, scope, ctx)?;
            Ok(app(app(lc, lt), le)) // Scott bool selects the branch
        }
        // Closures always take the functional path: the stateful-closure guard guarantees a closure
        // in a region captures only immutable values, so no store context crosses the boundary.
        Core::Lambda(id, params, body) => lower_lambda(*id, params, body, scope),
        Core::Apply(_, f, args) => {
            let mut term = lower_expr(f, scope, ctx)?;
            for a in args {
                term = app(term, lower_expr(a, scope, ctx)?);
            }
            Ok(term)
        }
        Core::Let { name, mutable: false, value, body, .. } => {
            let lv = lower_expr(value, scope, ctx)?;
            scope.push(name.clone());
            let lb = lower_expr(body, scope, ctx);
            scope.pop();
            Ok(app(abs(name.clone(), lb?), lv))
        }
        Core::LetRec { name, value, body, .. } => {
            // (\name. body) (fix (\name. value))
            scope.push(name.clone());
            let lvalue = lower_expr(value, scope, ctx);
            let lbody = lower_expr(body, scope, ctx);
            scope.pop();
            let recval = app(fix(), abs(name.clone(), lvalue?));
            Ok(app(abs(name.clone(), lbody?), recval))
        }
        // A tail-less block's discarded carrier: any closed value (never observed by the oracle).
        Core::Unit(_) => Ok(encode::church(0)),
        // Mutation / statement carriers open (or continue) a store-passing region.
        Core::Let { mutable: true, .. } | Core::Assign(..) | Core::While(..) | Core::Seq(..) => {
            lower_region(core, scope)
        }
    }
}

fn lower_lambda(id: NodeId, params: &[String], body: &Core, scope: &mut Vec<String>) -> Result<LambdaTerm, LowerError> {
    // Stateful-closure check: an assignment to a name not in `params` (captured) is rejected.
    if assigns_captured(body, params) {
        return Err(LowerError::StatefulClosure { node: id });
    }
    for p in params {
        scope.push(p.clone());
    }
    // The body lowers functionally (no store context): a closure never threads its enclosing store.
    let lbody = lower_expr(body, scope, None);
    for _ in params {
        scope.pop();
    }
    let mut term = lbody?;
    for p in params.iter().rev() {
        term = abs(p.clone(), term);
    }
    Ok(term)
}

/// The current store term (the innermost `$store` binder). This is an internal invariant — a region
/// always pushes `$store` before lowering its body — so the error is unreachable, but keeping it a
/// `Result` preserves totality (`lower` never panics).
fn cur_store(scope: &[String]) -> Result<LambdaTerm, LowerError> {
    resolve(STORE, scope).ok_or(LowerError::Unsupported { node: 0, what: "internal: store binder missing".to_string() })
}

/// Enter a store-passing region rooted at `node` (§5.2). Collects the ordered mutable variables `M`,
/// builds the initial store (`let mut` slots start as a placeholder they overwrite before any read;
/// externally-bound mutated names — e.g. a mutated parameter — start at their current value), binds
/// it, and threads it through the statement chain, collapsing to the region's value.
fn lower_region(node: &Core, scope: &mut Vec<String>) -> Result<LambdaTerm, LowerError> {
    let (vars, letmut) = collect_region_vars(node);
    let k = vars.len();

    // Initial store slot for each mutable variable.
    let mut slots: Vec<LambdaTerm> = Vec::with_capacity(k);
    for name in &vars {
        if letmut.contains(name) {
            slots.push(encode::church(0)); // overwritten by the `let mut` before it is read
        } else {
            // A mutated variable bound outside the region (e.g. a parameter): seed with its value.
            let v = resolve(name, scope).ok_or_else(|| LowerError::Unsupported {
                node: node.id(),
                what: format!("unbound mutable `{name}`"),
            })?;
            slots.push(v);
        }
    }
    let initial_store = store_of(&slots);

    let ctx = StoreCtx { vars };
    scope.push(STORE.to_string());
    let body = lower_region_body(node, scope, &ctx, Pos::Value);
    scope.pop();
    Ok(app(abs(STORE, body?), initial_store))
}

/// Lower a node inside a region. In `Pos::Value` it yields the region's result value; in `Pos::Store`
/// it yields the store threaded past this node's effects. Reads of `M` variables project from the
/// current `$store`; assignments/`while` rebind it.
fn lower_region_body(node: &Core, scope: &mut Vec<String>, ctx: &StoreCtx, pos: Pos) -> Result<LambdaTerm, LowerError> {
    match node {
        // `let mut m = v` seeds slot `m` (overwriting its placeholder), then continues under the
        // updated store.
        Core::Let { mutable: true, id, name, value, body, .. } => {
            let lv = lower_expr(value, scope, Some(ctx))?;
            // `collect_region_vars` always records a region `let mut` name, so this is total.
            let i = ctx.index_of(name).ok_or_else(|| LowerError::Unsupported {
                node: *id,
                what: format!("`let mut {name}` outside its region"),
            })?;
            let new_store = update(&cur_store(scope)?, i, lv, ctx.k());
            scope.push(STORE.to_string());
            let cont = lower_region_body(body, scope, ctx, pos);
            scope.pop();
            Ok(app(abs(STORE, cont?), new_store))
        }
        // A non-mutable `let` inside a region is a value binder over the continuation; the functional
        // path handles it with `ctx` threaded (so reads in its body still project). If `name` shadows
        // one of the region's mutable variables, that projection would be wrong: the `Var` arm above
        // checks `ctx` first, so reads inside this `let`'s body would silently keep projecting from
        // the store instead of resolving the (correct) immutable binding. Reject cleanly rather than
        // miscompile.
        Core::Let { mutable: false, id, name, value, body, .. } => {
            if ctx.index_of(name).is_some() {
                return Err(LowerError::Unsupported {
                    node: *id,
                    what: "immutable let shadowing a mutable variable (v1 limitation)".to_string(),
                });
            }
            let lv = lower_expr(value, scope, Some(ctx))?;
            scope.push(name.clone());
            let lb = lower_region_body(body, scope, ctx, pos);
            scope.pop();
            Ok(app(abs(name.clone(), lb?), lv))
        }
        // Thread the store: run `first` for its effect on the store, then continue with `then`.
        Core::Seq(_, first, then) => {
            let first_store = lower_region_body(first, scope, ctx, Pos::Store)?;
            scope.push(STORE.to_string());
            let cont = lower_region_body(then, scope, ctx, pos);
            scope.pop();
            Ok(app(abs(STORE, cont?), first_store))
        }
        // `m = e` produces a new store with slot `m` replaced.
        Core::Assign(id, name, value) => {
            let i = ctx
                .index_of(name)
                .ok_or_else(|| LowerError::Unsupported { node: *id, what: format!("assign to non-region `{name}`") })?;
            let lv = lower_expr(value, scope, Some(ctx))?;
            let new_store = update(&cur_store(scope)?, i, lv, ctx.k());
            Ok(in_position(new_store, pos))
        }
        // `while cond { body }` loops until `cond` is false, threading the store via `fix`.
        Core::While(_, cond, body) => {
            let loop_term = build_while(cond, body, scope, ctx)?;
            Ok(in_position(loop_term, pos))
        }
        // `if` splits the store/value across branches; the Scott bool selects one.
        Core::If(_, c, t, e) => {
            let lc = lower_expr(c, scope, Some(ctx))?;
            let lt = lower_region_body(t, scope, ctx, pos)?;
            let le = lower_region_body(e, scope, ctx, pos)?;
            Ok(app(app(lc, lt), le))
        }
        // A tail-less carrier: yield the current store (in store position) or a closed value.
        Core::Unit(_) => match pos {
            Pos::Store => cur_store(scope),
            Pos::Value => Ok(encode::church(0)),
        },
        // Any other node is a value expression (the region's tail, or a discarded effect-free
        // statement): lower it against the current store's projections.
        _ => match pos {
            Pos::Value => lower_expr(node, scope, Some(ctx)),
            Pos::Store => cur_store(scope), // effect-free statement: store is unchanged
        },
    }
}

/// Adapt a computed store term to the requested position: in `Pos::Store` it is the result; in
/// `Pos::Value` the store never escapes, so the region's observable value is a closed carrier. (A
/// bare statement in value position occurs only for a discarded effect; the demo suite never relies
/// on such a value.)
fn in_position(store: LambdaTerm, pos: Pos) -> LambdaTerm {
    match pos {
        Pos::Store => store,
        Pos::Value => encode::church(0),
    }
}

/// `fix (\loop. \s. (cond@s) (loop (body@s)) s) store` — the Scott bool `cond@s` selects
/// `loop (body@s)` (continue with the updated store) when true, else `s` (the final store).
fn build_while(cond: &Core, body: &Core, scope: &mut Vec<String>, ctx: &StoreCtx) -> Result<LambdaTerm, LowerError> {
    let s_init = cur_store(scope)?;
    scope.push(LOOP.to_string());
    scope.push(STORE.to_string());
    let cond_term = lower_expr(cond, scope, Some(ctx));
    let body_store = lower_region_body(body, scope, ctx, Pos::Store);
    let loop_var = resolve(LOOP, scope)
        .ok_or(LowerError::Unsupported { node: 0, what: "internal: loop binder missing".to_string() });
    let store_var = cur_store(scope);
    scope.pop();
    scope.pop();
    // (cond@s) (loop (body@s)) s
    let iter = app(app(cond_term?, app(loop_var?, body_store?)), store_var?);
    let g = abs(LOOP, abs(STORE, iter));
    Ok(app(app(fix(), g), s_init))
}

/// The ordered mutable variables of a region (first-assignment / first-`let mut` order) and the set
/// of names introduced by `let mut` inside it. Nested closures are skipped: their assignments belong
/// to their own region (and captured mutations are rejected up front).
fn collect_region_vars(node: &Core) -> (Vec<String>, Vec<String>) {
    fn push_unique(v: &mut Vec<String>, name: &str) {
        if !v.iter().any(|n| n == name) {
            v.push(name.to_string());
        }
    }
    fn walk(c: &Core, vars: &mut Vec<String>, letmut: &mut Vec<String>) {
        match c {
            Core::Assign(_, name, value) => {
                push_unique(vars, name);
                walk(value, vars, letmut);
            }
            Core::Let { mutable, name, value, body, .. } => {
                if *mutable {
                    push_unique(vars, name);
                    push_unique(letmut, name);
                }
                walk(value, vars, letmut);
                walk(body, vars, letmut);
            }
            Core::LetRec { value, body, .. } => {
                walk(value, vars, letmut);
                walk(body, vars, letmut);
            }
            Core::Seq(_, a, b) | Core::While(_, a, b) | Core::BinOp(_, _, a, b) => {
                walk(a, vars, letmut);
                walk(b, vars, letmut);
            }
            Core::If(_, a, b, c) => {
                walk(a, vars, letmut);
                walk(b, vars, letmut);
                walk(c, vars, letmut);
            }
            Core::Apply(_, f, args) => {
                walk(f, vars, letmut);
                for a in args {
                    walk(a, vars, letmut);
                }
            }
            // A nested closure's assignments are not part of this region's store.
            Core::Lambda(..) | Core::Nat(..) | Core::Bool(..) | Core::Var(..) | Core::Unit(..) => {}
        }
    }
    let mut vars = Vec::new();
    let mut letmut = Vec::new();
    walk(node, &mut vars, &mut letmut);
    (vars, letmut)
}

/// True if `body` assigns a variable not bound within it (captured from an outer scope). A
/// conservative walk: track names bound *inside* `body`; any `Assign` to a name not locally bound
/// (and not a `params` name) is a captured mutation.
fn assigns_captured(body: &Core, params: &[String]) -> bool {
    fn walk(c: &Core, local: &mut Vec<String>, params: &[String]) -> bool {
        match c {
            Core::Assign(_, name, v) => {
                let bound = params.contains(name) || local.contains(name);
                (!bound) || walk(v, local, params)
            }
            Core::Let { name, value, body, .. } => {
                if walk(value, local, params) {
                    return true;
                }
                local.push(name.clone());
                let r = walk(body, local, params);
                local.pop();
                r
            }
            Core::LetRec { name, value, body, .. } => {
                local.push(name.clone());
                let r = walk(value, local, params) || walk(body, local, params);
                local.pop();
                r
            }
            Core::Lambda(_, ps, b) => {
                let n = local.len();
                for p in ps {
                    local.push(p.clone());
                }
                let r = walk(b, local, params);
                local.truncate(n);
                r
            }
            Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
                walk(a, local, params) || walk(b, local, params)
            }
            Core::If(_, a, b, c) => walk(a, local, params) || walk(b, local, params) || walk(c, local, params),
            Core::Apply(_, f, args) => walk(f, local, params) || args.iter().any(|a| walk(a, local, params)),
            Core::Nat(..) | Core::Bool(..) | Core::Var(..) | Core::Unit(..) => false,
        }
    }
    let mut local = Vec::new();
    walk(body, &mut local, params)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::lambda::decode::decode;
    use crate::lambda::reduce::{MAX_REDUCTION_STEPS, reduce_to_normal_form};
    use crate::parser::parse;
    use crate::value::Value;

    /// End-to-end: source -> desugar -> lower -> reduce -> decode, guided by the reference
    /// interpreter's result as the type witness (decode is type-directed: the encodings overlap,
    /// e.g. `church(0) == Scott false`).
    fn run_lambda(src: &str) -> Value {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let expected = crate::run(src).expect("reference interpreter failed");
        let term = lower(&core).expect("lowering failed");
        let (nf, _) = reduce_to_normal_form(&term, MAX_REDUCTION_STEPS);
        decode(&nf, &expected).expect("normal form did not decode")
    }

    #[test]
    fn arithmetic_matches_the_reference() {
        assert_eq!(run_lambda("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(run_lambda("3 - 5"), Value::Nat(0)); // monus
    }

    #[test]
    fn comparisons_and_if() {
        assert_eq!(run_lambda("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(run_lambda("if 1 == 2 { 10 } else { 20 }"), Value::Nat(20));
    }

    #[test]
    fn closures_and_application() {
        assert_eq!(run_lambda("let add1 = |x| x + 1; add1(41)"), Value::Nat(42));
    }

    #[test]
    fn list_builtins() {
        assert_eq!(run_lambda("head(cons(7, nil))"), Value::Nat(7));
        assert_eq!(run_lambda("is_empty(nil)"), Value::Bool(true));
        assert_eq!(run_lambda("[1, 2, 3]"), Value::list_of_nats(&[1, 2, 3]));
    }

    #[test]
    fn recursion_via_fix() {
        let src = "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)";
        assert_eq!(run_lambda(src), Value::Nat(15));
    }

    #[test]
    fn map_and_fold_functional_demo() {
        let src = "\
            fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
            fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
            fn add(a, b) { a + b }\n\
            fn add1(x) { x + 1 }\n\
            fold([3, 1, 2].map(add1), 0, add)";
        assert_eq!(run_lambda(src), Value::Nat(9));
    }

    // --- Store helpers (unit-tested via the reducer) ---

    fn nf(t: &LambdaTerm) -> LambdaTerm {
        let (n, _) = reduce_to_normal_form(t, MAX_REDUCTION_STEPS);
        n
    }

    #[test]
    fn store_project_reads_the_right_slot() {
        let store = store_of(&[encode::church(7), encode::church(9)]);
        assert_eq!(nf(&project(store.clone(), 0, 2)), encode::church(7));
        assert_eq!(nf(&project(store, 1, 2)), encode::church(9));
    }

    #[test]
    fn store_update_replaces_one_slot() {
        let store = store_of(&[encode::church(7), encode::church(9)]);
        let updated = update(&store, 1, encode::church(5), 2);
        assert_eq!(nf(&project(updated.clone(), 0, 2)), encode::church(7)); // untouched
        assert_eq!(nf(&project(updated, 1, 2)), encode::church(5)); // replaced
    }

    // --- Store-passing lowering (simplest-first) ---

    #[test]
    fn single_mutable_binding_and_read() {
        // No loop: one `let mut`, one assignment, then read it back.
        assert_eq!(run_lambda("{ let mut x = 1; x = x + 4; x }"), Value::Nat(5));
    }

    #[test]
    fn while_loop_accumulator() {
        // count-up: increment acc while n > 0.
        let src = "{ let mut acc = 0; let mut n = 3; while n > 0 { acc = acc + 1; n = n - 1; } acc }";
        assert_eq!(run_lambda(src), Value::Nat(3));
    }

    #[test]
    fn count_down_matches_the_reference() {
        let src = "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)";
        assert_eq!(run_lambda(src), Value::Nat(4));
    }

    #[test]
    fn stateful_closure_is_rejected() {
        // A closure that assigns a captured outer `let mut` is not representable in v1.
        let (prog, _) = parse("let mut c = 0; let inc = |x| { c = c + x; c }; inc(1)");
        let core = desugar(&prog.unwrap());
        let err = lower(&core).unwrap_err();
        assert!(matches!(err, LowerError::StatefulClosure { .. }), "got {err:?}");
    }

    #[test]
    fn immutable_let_shadowing_a_mutable_is_rejected() {
        // Shadowing a `let mut` with an immutable `let` is not representable in the v1 store-passing.
        let (prog, _) = parse("{ let mut x = 1; let x = 99; x }");
        let core = desugar(&prog.unwrap());
        let err = lower(&core).unwrap_err();
        assert!(matches!(err, LowerError::Unsupported { .. }), "got {err:?}");
    }
}
