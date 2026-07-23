//! Core -> Core defunctionalization (Plan 3b-1): rewrite higher-order Core into the first-order
//! subset the existing `lower_asm`/`lower_tm`/`decode` handle unchanged, or `LowerError::Unsupported`.
//!
//! A function or lambda *used as a value* (occurring anywhere other than as the immediate callee of
//! an `Apply`) becomes a closure `cons(tag, env)` on the HEAP; an `Apply` of a value becomes a call
//! to a generated per-arity `applyN` dispatcher that inlines the target bodies as its arms. Functions
//! are emitted in dependency order (callees outer of callers) since neither the reference nor
//! `lower_asm` supports mutual recursion.
//!
//! Task 4 adds **immutable environment capture**: an anonymous `Lambda` used as a value (e.g. as an
//! `Apply` argument) captures its free immutable variables **by value** — the closure env carries the
//! captured *values*, built at the creation site, and the dispatcher arm unpacks them from the env
//! before binding params. Capture-by-value is exact for immutables (they never change). A captured
//! **mutable** (a `let mut`, or any name assigned anywhere) is `LowerError::Unsupported` — matching the
//! λ backend, and because by-value capture would be WRONG for a mutable (the reference captures by
//! reference; boxed mutable capture is Plan 3b-2).
//!
//! Still `Unsupported` (never a silent miscompile): a builtin used as a bare value, a function both
//! called-by-name and used-as-a-value, a nested/local function definition, a cyclic higher-order call
//! graph, and (conservatively, to preserve the lets-around-main emission scoping) a top-level named
//! function whose body references an outer `let` binding.

use std::collections::{BTreeMap, BTreeSet};

use crate::core::{BinOp, Core, NodeGen, NodeId};
use crate::tm::lower_asm::LowerError;

/// Bounds every recursive tree-walk in this module (`analyze`, `free_vars`/`fv_into`,
/// `Rewriter::rewrite`/`rewrite_apply`/`rewrite_lambda_value`, `collect_calls`, `visit`) so `defunc`
/// is TOTAL -- `LowerError::TooDeep`, never a native stack overflow -- on any Core, including a deep
/// FIRST-order Core (that `run_tm` no longer even routes here, see `tm.rs::lower_program`) and a deep
/// HIGHER-order one (which it does).
///
/// Rather than thread a live counter through every one of those functions, `defunc` measures the
/// input's nesting depth ONCE, ITERATIVELY (`too_deep_node`, an explicit worklist -- no native
/// recursion, mirroring `core.rs`'s `Drop` impl and this module's own `max_id`), before any recursive
/// pass runs. `analyze`/`free_vars`/`Rewriter::rewrite`/`peel` all recurse only on `core` itself or its
/// sub-trees, so bounding `core`'s own height bounds them too; `collect_calls`/`visit` walk the
/// *rewritten* output instead (structurally close to the input, plus a small constant), so they
/// additionally carry their own depth counter as defense-in-depth (cheap to add, and the reviewer
/// flagged them by name).
///
/// Same bound as `lower_asm::MAX_LOWER_DEPTH` (580): both are tuned against the same 8 MiB production
/// stack, and `defunc`'s frames are not meaningfully fatter than `lower_into`'s, so reusing the
/// measured ~2x-margin bound is conservative rather than a guess. See `lower_asm`'s doc comment for why
/// this must NOT be tuned against a smaller test thread.
const MAX_DEFUNC_DEPTH: u32 = 580;

/// Prelude functions that are always applied directly (never used as a bare value in 3b-1).
const BUILTIN_FNS: [&str; 4] = ["cons", "head", "tail", "is_empty"];

fn is_builtin_fn(name: &str) -> bool {
    BUILTIN_FNS.contains(&name)
}

/// A peeled top-level `fn name(params) { body }` (a `LetRec` whose value is a `Lambda`).
struct Func<'a> {
    name: String,
    params: Vec<String>,
    body: &'a Core,
}

/// A peeled top-level `let name = value` value-binding sitting in the prelude chain (interleaved with
/// the `fn` definitions). Re-emitted AROUND the rewritten main expression (inner of the hoisted
/// functions); captured immutables are read from here at the closure-creation site.
struct LetBinding<'a> {
    id: NodeId,
    name: String,
    mutable: bool,
    value: &'a Core,
}

/// A dispatcher arm: the (inlined) body of a value-used function or an anonymous value-lambda, plus
/// the names it needs bound around that body — captured free variables (unpacked from the closure env)
/// and its own parameters (bound to the dispatcher's `$a_i` inputs).
struct ArmData {
    params: Vec<String>,
    captures: Vec<String>,
    body: Core,
}

/// An anonymous `Lambda` used as a value, discovered and tagged lazily during the rewrite (unlike a
/// named function, which is classified up front). Its body is inlined as a dispatcher arm; its
/// captured immutables are read at the creation site into the closure env.
struct AnonClosure {
    name: String,
    arity: usize,
    tag: u64,
    params: Vec<String>,
    captures: Vec<String>,
    body: Core,
}

/// Rewrite higher-order `core` into first-order Core, or `Unsupported` for a construct this pass does
/// not handle.
pub fn defunc(core: &Core) -> Result<Core, LowerError> {
    // 0. Total-by-construction: measure `core`'s nesting depth iteratively (no native recursion) and
    // reject as `TooDeep` BEFORE any recursive pass runs. See `MAX_DEFUNC_DEPTH`'s doc comment.
    if let Some(node) = too_deep_node(core) {
        return Err(LowerError::TooDeep { node });
    }

    let mut g = NodeGen::seeded(max_id(core).saturating_add(1));

    // 1. Peel the outer prelude: leading `let` value-bindings and `LetRec`-with-`Lambda` (`fn`) defs,
    // in whatever order they interleave. The first non-such node is the main tail expression.
    let (lets, funcs, main) = peel(core)?;
    let func_names: BTreeSet<String> = funcs.iter().map(|f| f.name.clone()).collect();
    let let_names: BTreeSet<String> = lets.iter().map(|l| l.name.clone()).collect();

    // Names bound `let mut` or `Assign`ed anywhere in the program: capturing one by value would be
    // wrong (the reference captures a mutable by reference), so such a capture is `Unsupported`.
    let mutable_names = collect_mutable_names(core);

    // 2. Guard: the hoisted functions are emitted OUTER of the `let` bindings (which wrap only main),
    // so no function body may reference a `let` name — it would be out of scope. Reject rather than
    // miscompile. (The lambda-in-a-fn-body capture path is unaffected: it captures the fn's *params*,
    // which are in scope at the creation site, not the outer lets.)
    for f in &funcs {
        let mut fv = free_vars(f.body);
        for p in &f.params {
            fv.remove(p);
        }
        if fv.intersection(&let_names).next().is_some() {
            return Err(unsupported(f.body, format!("function `{}` references an outer let binding", f.name)));
        }
    }

    // 3. Classify each named function: is it used as a value anywhere, called by name anywhere?
    let mut value_used = BTreeSet::new();
    let mut name_called = BTreeSet::new();
    for f in &funcs {
        let locals: BTreeSet<String> = f.params.iter().cloned().collect();
        analyze(f.body, &func_names, &locals, &mut value_used, &mut name_called);
    }
    analyze(main, &func_names, &let_names, &mut value_used, &mut name_called);
    for l in &lets {
        analyze(l.value, &func_names, &BTreeSet::new(), &mut value_used, &mut name_called);
    }

    // KEPT = called by name only (stays a named subroutine). VALUE = used as a value only (dropped,
    // inlined into a dispatcher arm). BOTH is deferred to a later task; neither is dead (dropped).
    let mut kept: Vec<&Func> = Vec::new();
    let mut value_funcs: Vec<&Func> = Vec::new();
    for f in &funcs {
        let vu = value_used.contains(&f.name);
        let nc = name_called.contains(&f.name);
        match (vu, nc) {
            (true, true) => {
                return Err(unsupported(f.body, format!("`{}` is both called by name and used as a value", f.name)));
            }
            (true, false) => value_funcs.push(f),
            (false, true) => kept.push(f),
            (false, false) => {} // dead: drop it
        }
    }

    // 4. Assign a tag to each value-used function, grouped by arity (the dispatcher is per-arity).
    let mut tags: BTreeMap<String, u64> = BTreeMap::new();
    let mut by_arity: BTreeMap<usize, Vec<String>> = BTreeMap::new();
    for f in &value_funcs {
        let slot = by_arity.entry(f.params.len()).or_default();
        tags.insert(f.name.clone(), slot.len() as u64);
        slot.push(f.name.clone());
    }
    let kept_names: BTreeSet<String> = kept.iter().map(|f| f.name.clone()).collect();

    // 5. Rewrite every body: value-uses -> `cons(tag, env)`, value-applies -> `applyN`; anonymous
    // value-lambdas are tagged lazily and their captures recorded (continuing the per-arity tag count).
    let next_tag = by_arity.iter().map(|(&a, v)| (a, v.len() as u64)).collect();
    let mut rw = Rewriter {
        g: &mut g,
        tags: &tags,
        kept: &kept_names,
        mutable_names: &mutable_names,
        arities_used: BTreeSet::new(),
        next_tag,
        anon: Vec::new(),
    };

    // 5a. Prelude `let` values (each in the scope of the lets that precede it).
    let mut seen_lets: BTreeSet<String> = BTreeSet::new();
    let mut let_values_rw: Vec<Core> = Vec::with_capacity(lets.len());
    for l in &lets {
        let v = rw.rewrite(l.value, &seen_lets)?;
        let_values_rw.push(v);
        seen_lets.insert(l.name.clone());
    }

    // 5b. Kept functions keep their binding; rewrite their bodies.
    let mut emitted: Vec<(String, Vec<String>, Core)> = Vec::new();
    for f in &kept {
        let locals: BTreeSet<String> = f.params.iter().cloned().collect();
        let body = rw.rewrite(f.body, &locals)?;
        emitted.push((f.name.clone(), f.params.clone(), body));
    }

    // 5c. Value functions are dropped; rewrite each body into a dispatcher arm. A named value fn never
    // captures (guard 2 rejected any that references a let), so its arm carries no captures.
    let mut arms: BTreeMap<String, ArmData> = BTreeMap::new();
    for f in &value_funcs {
        let locals: BTreeSet<String> = f.params.iter().cloned().collect();
        let body = rw.rewrite(f.body, &locals)?;
        arms.insert(f.name.clone(), ArmData { params: f.params.clone(), captures: Vec::new(), body });
    }

    // 5d. The main expression, in the scope of the prelude lets (so a lambda there can capture them).
    let main_rw = rw.rewrite(main, &let_names)?;

    // Extract what the rewrite accumulated, then release its borrows of `g`/`tags`.
    let arities_used = std::mem::take(&mut rw.arities_used);
    let anon = std::mem::take(&mut rw.anon);
    drop(rw);

    // 6. Fold the anonymous value-lambdas into the same per-arity tag space as the named value fns.
    for a in anon {
        tags.insert(a.name.clone(), a.tag);
        by_arity.entry(a.arity).or_default().push(a.name.clone());
        arms.insert(a.name.clone(), ArmData { params: a.params, captures: a.captures, body: a.body });
    }

    // 7. Generate one `applyN` dispatcher per arity that is actually applied.
    for &arity in &arities_used {
        let empty = Vec::new();
        let group = by_arity.get(&arity).unwrap_or(&empty);
        let (params, body) = dispatcher(&mut g, arity, group, &tags, &mut arms)?;
        emitted.push((dispatcher_name(arity), params, body));
    }

    // 8. Emit in dependency order (callees outer of callers); a non-self cycle is `Unsupported`.
    let order = topo_order(&emitted, main)?;

    // 9. Assemble: the function `LetRec`s wrap the prelude `let`s, which wrap the rewritten main.
    let mut by_name: BTreeMap<String, (Vec<String>, Core)> = BTreeMap::new();
    for (name, params, body) in emitted {
        by_name.insert(name, (params, body));
    }
    let mut acc = main_rw;
    // Prelude lets AROUND main: first let outermost of the let-group (so a later let's value can see
    // an earlier one). Innermost-first here means iterating in reverse.
    let mut let_pairs: Vec<(&LetBinding, Core)> = lets.iter().zip(let_values_rw).collect();
    while let Some((l, v)) = let_pairs.pop() {
        acc = Core::Let { id: l.id, name: l.name.clone(), mutable: l.mutable, value: Box::new(v), body: Box::new(acc) };
    }
    // Function chain OUTERMOST (outermost = `order[0]`).
    for name in order.iter().rev() {
        // Defensive: `order` is a permutation of `emitted`'s names (topo_order over exactly them), so
        // every name is present. Degrade an internal-invariant violation to `Unsupported` rather than
        // `expect`/panic — `defunc`/`run_tm` must stay total on ANY input.
        let Some((params, body)) = by_name.remove(name) else {
            return Err(LowerError::Unsupported {
                node: main.id(),
                what: format!("ordered name `{name}` was emitted"),
            });
        };
        let lam = Core::Lambda(g.fresh(), params, Box::new(body));
        acc = Core::LetRec { id: g.fresh(), name: name.clone(), value: Box::new(lam), body: Box::new(acc) };
    }
    Ok(acc)
}

/// Peel the outermost prelude chain of `let name = value` value-bindings and
/// `LetRec { name, Lambda(params, body), .. }` (`fn`) definitions, in whatever order they interleave;
/// the first non-such node is the main tail expression. A `LetRec` whose value is not a `Lambda` is
/// `Unsupported`.
#[allow(clippy::type_complexity)]
fn peel(core: &Core) -> Result<(Vec<LetBinding<'_>>, Vec<Func<'_>>, &Core), LowerError> {
    let mut lets = Vec::new();
    let mut funcs = Vec::new();
    let mut cur = core;
    loop {
        match cur {
            Core::LetRec { name, value, body, .. } => {
                let Core::Lambda(_, params, lam_body) = value.as_ref() else {
                    return Err(unsupported(cur, "letrec value is not a function".to_string()));
                };
                funcs.push(Func { name: name.clone(), params: params.clone(), body: lam_body });
                cur = body;
            }
            Core::Let { id, name, mutable, value, body } => {
                lets.push(LetBinding { id: *id, name: name.clone(), mutable: *mutable, value });
                cur = body;
            }
            _ => break,
        }
    }
    Ok((lets, funcs, cur))
}

/// Record, over `node`, which `funcs` names occur as a value (`value_used`) and which occur as an
/// `Apply` callee that resolves to a function (`name_called`). `locals` shadow function names.
fn analyze(
    node: &Core,
    funcs: &BTreeSet<String>,
    locals: &BTreeSet<String>,
    value_used: &mut BTreeSet<String>,
    name_called: &mut BTreeSet<String>,
) {
    match node {
        Core::Var(_, name) => {
            if funcs.contains(name) && !locals.contains(name) {
                value_used.insert(name.clone());
            }
        }
        Core::Apply(_, callee, args) => {
            if let Core::Var(_, name) = callee.as_ref() {
                if funcs.contains(name) && !locals.contains(name) {
                    name_called.insert(name.clone()); // a direct call, not a value-use
                } else {
                    analyze(callee, funcs, locals, value_used, name_called);
                }
            } else {
                analyze(callee, funcs, locals, value_used, name_called);
            }
            for a in args {
                analyze(a, funcs, locals, value_used, name_called);
            }
        }
        Core::Let { name, value, body, .. } => {
            analyze(value, funcs, locals, value_used, name_called);
            analyze(body, funcs, &with(locals, name), value_used, name_called);
        }
        Core::LetRec { name, value, body, .. } => {
            let inner = with(locals, name);
            analyze(value, funcs, &inner, value_used, name_called);
            analyze(body, funcs, &inner, value_used, name_called);
        }
        Core::Lambda(_, params, body) => {
            let mut inner = locals.clone();
            inner.extend(params.iter().cloned());
            analyze(body, funcs, &inner, value_used, name_called);
        }
        Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
            analyze(a, funcs, locals, value_used, name_called);
            analyze(b, funcs, locals, value_used, name_called);
        }
        Core::If(_, a, b, c) => {
            analyze(a, funcs, locals, value_used, name_called);
            analyze(b, funcs, locals, value_used, name_called);
            analyze(c, funcs, locals, value_used, name_called);
        }
        Core::Assign(_, _, value) => analyze(value, funcs, locals, value_used, name_called),
        Core::Nat(..) | Core::Bool(..) | Core::Unit(..) => {}
    }
}

/// The body rewriter: it carries the node generator, the (named) tag/kept classification, the mutable
/// name set, and accumulates the set of arities at which a value is applied (so exactly those
/// dispatchers are generated) plus the anonymous value-lambdas it tags on the fly.
struct Rewriter<'a> {
    g: &'a mut NodeGen,
    tags: &'a BTreeMap<String, u64>,
    kept: &'a BTreeSet<String>,
    mutable_names: &'a BTreeSet<String>,
    arities_used: BTreeSet<usize>,
    /// Next free tag per arity, seeded past the named value fns so anonymous lambdas never collide.
    next_tag: BTreeMap<usize, u64>,
    anon: Vec<AnonClosure>,
}

impl Rewriter<'_> {
    fn rewrite(&mut self, node: &Core, locals: &BTreeSet<String>) -> Result<Core, LowerError> {
        match node {
            Core::Nat(id, n) => Ok(Core::Nat(*id, *n)),
            Core::Bool(id, b) => Ok(Core::Bool(*id, *b)),
            Core::Unit(id) => Ok(Core::Unit(*id)),
            Core::Var(id, name) => self.rewrite_value_name(*id, name, locals),
            Core::BinOp(id, op, a, b) => {
                Ok(Core::BinOp(*id, *op, Box::new(self.rewrite(a, locals)?), Box::new(self.rewrite(b, locals)?)))
            }
            Core::If(id, c, t, e) => Ok(Core::If(
                *id,
                Box::new(self.rewrite(c, locals)?),
                Box::new(self.rewrite(t, locals)?),
                Box::new(self.rewrite(e, locals)?),
            )),
            Core::Seq(id, a, b) => {
                Ok(Core::Seq(*id, Box::new(self.rewrite(a, locals)?), Box::new(self.rewrite(b, locals)?)))
            }
            Core::While(id, c, b) => {
                Ok(Core::While(*id, Box::new(self.rewrite(c, locals)?), Box::new(self.rewrite(b, locals)?)))
            }
            Core::Assign(id, name, v) => Ok(Core::Assign(*id, name.clone(), Box::new(self.rewrite(v, locals)?))),
            Core::Let { id, name, mutable, value, body, .. } => {
                let value = Box::new(self.rewrite(value, locals)?);
                let body = Box::new(self.rewrite(body, &with(locals, name))?);
                Ok(Core::Let { id: *id, name: name.clone(), mutable: *mutable, value, body })
            }
            Core::Apply(id, callee, args) => self.rewrite_apply(*id, callee, args, locals),
            // An anonymous lambda used as a value: a closure `cons(tag, env)` capturing its free
            // immutable locals by value.
            Core::Lambda(_, params, body) => self.rewrite_lambda_value(params, body, locals),
            // A nested/local function definition is a higher-order construct this pass does not handle.
            Core::LetRec { .. } => Err(unsupported(node, "nested function definition".to_string())),
        }
    }

    /// A `Var` in value position (not an immediate static-call callee).
    fn rewrite_value_name(&mut self, id: NodeId, name: &str, locals: &BTreeSet<String>) -> Result<Core, LowerError> {
        if locals.contains(name) || name == "nil" {
            return Ok(Core::Var(id, name.to_string())); // a local value / the empty list
        }
        if let Some(&tag) = self.tags.get(name) {
            // A closed named function-value: `cons(tag, nil)` (a named value fn never captures — guard 2
            // rejects one that would).
            let t = nat(self.g, tag);
            let n = var(self.g, "nil");
            return Ok(cons(self.g, t, n));
        }
        if self.kept.contains(name) {
            // A kept (name-called) function should never reach a value position (that would make it
            // value-used); guard against it rather than silently produce a bad closure.
            return Err(LowerError::Unsupported { node: id, what: format!("`{name}` used as a value") });
        }
        if is_builtin_fn(name) {
            return Err(LowerError::Unsupported { node: id, what: format!("builtin `{name}` used as a value") });
        }
        Err(LowerError::Unsupported { node: id, what: format!("free variable `{name}` (capture)") })
    }

    /// An anonymous `|params| body` used as a value: capture its free immutable locals BY VALUE. The
    /// closure built here is `cons(tag, env)` where `env` is the list of captured *values* (evaluated
    /// at this creation site); the matching dispatcher arm unpacks them back out.
    fn rewrite_lambda_value(
        &mut self,
        params: &[String],
        body: &Core,
        locals: &BTreeSet<String>,
    ) -> Result<Core, LowerError> {
        // Captures = free variables of the lambda that resolve to an in-scope local (a prelude `let`
        // or an enclosing parameter). Free names that are functions/builtins/`nil` are NOT captured —
        // the recursive body rewrite turns them into nested closures or calls. Sorted (BTreeSet) so the
        // creation-site env order and the dispatcher-arm unpack order agree.
        let mut fv = free_vars(body);
        for p in params {
            fv.remove(p);
        }
        let captures: Vec<String> = fv.iter().filter(|v| locals.contains(*v)).cloned().collect();
        for c in &captures {
            if self.mutable_names.contains(c) {
                // By-value capture of a mutable would diverge from the reference (which captures a
                // mutable by reference); boxed mutable capture is Plan 3b-2.
                return Err(LowerError::Unsupported {
                    node: body.id(),
                    what: format!("lambda captures mutable `{c}`"),
                });
            }
        }

        let arity = params.len();
        let tag = {
            let slot = self.next_tag.entry(arity).or_insert(0);
            let t = *slot;
            *slot += 1;
            t
        };
        // GUARANTEED-UNIQUE, independent of push order: `self.anon.len()` was computed BEFORE the
        // recursive body rewrite and the `self.anon.push`, so a value-lambda whose body contains
        // ANOTHER value-lambda (currying, nested callbacks) minted the SAME `$lam0` for both — a
        // duplicate key that corrupted `tags`/`by_arity`/`arms` and panicked the dispatcher's
        // `arms.remove`. A fresh monotonic id from the shared `NodeGen` can never collide.
        let name = format!("$lam{}", self.g.fresh());

        // The arm body is closed over exactly params + captures (bound by the dispatcher).
        let mut arm_locals: BTreeSet<String> = params.iter().cloned().collect();
        arm_locals.extend(captures.iter().cloned());
        let arm_body = self.rewrite(body, &arm_locals)?;
        self.anon.push(AnonClosure {
            name,
            arity,
            tag,
            params: params.to_vec(),
            captures: captures.clone(),
            body: arm_body,
        });

        // Build the closure at the creation site: `cons(tag, cons(c1, cons(c2, … nil)))`. Each captured
        // value is just `Var(c_i)` (a local in scope here).
        let env = build_env(self.g, &captures);
        let t = nat(self.g, tag);
        Ok(cons(self.g, t, env))
    }

    fn rewrite_apply(
        &mut self,
        id: NodeId,
        callee: &Core,
        args: &[Core],
        locals: &BTreeSet<String>,
    ) -> Result<Core, LowerError> {
        if let Core::Var(_, name) = callee {
            let is_local = locals.contains(name);
            let is_value_fn = self.tags.contains_key(name.as_str());
            let is_static = self.kept.contains(name) || is_builtin_fn(name);
            if !is_local && is_static {
                // A direct call to a kept function or a builtin: keep the callee, rewrite the args.
                let new_args = args.iter().map(|a| self.rewrite(a, locals)).collect::<Result<Vec<_>, _>>()?;
                return Ok(Core::Apply(id, Box::new(Core::Var(callee.id(), name.clone())), new_args));
            }
            if is_local || is_value_fn {
                // Applying a value (a param holding a closure, or a named function-value): dispatch.
                let clos = self.rewrite_value_name(callee.id(), name, locals)?;
                return self.build_dispatch(id, clos, args, locals);
            }
            return Err(LowerError::Unsupported { node: id, what: format!("call of unbound `{name}`") });
        }
        // Applying an arbitrary expression that evaluates to a closure (e.g. an inline lambda IIFE).
        let clos = self.rewrite(callee, locals)?;
        self.build_dispatch(id, clos, args, locals)
    }

    /// `Apply(applyN, [clos, a1..aN])` — route a value-application through its per-arity dispatcher.
    fn build_dispatch(
        &mut self,
        id: NodeId,
        clos: Core,
        args: &[Core],
        locals: &BTreeSet<String>,
    ) -> Result<Core, LowerError> {
        let arity = args.len();
        self.arities_used.insert(arity);
        let mut call_args = Vec::with_capacity(arity + 1);
        call_args.push(clos);
        for a in args {
            call_args.push(self.rewrite(a, locals)?);
        }
        let f = var(self.g, &dispatcher_name(arity));
        Ok(Core::Apply(id, Box::new(f), call_args))
    }
}

/// Build `fn applyN($clos, $a1..$aN)` dispatching on `head($clos)`: one arm per tagged function/lambda
/// of this arity (the tag guards it), and a faulting `else`. An arm binds its captures from the closure
/// env (`let c1 = head($env); let c2 = head(tail($env)); …`, `$env = tail($clos)`) then its params
/// (`let p1 = $a1; …`) around the (rewritten) body.
fn dispatcher(
    g: &mut NodeGen,
    arity: usize,
    group: &[String],
    tags: &BTreeMap<String, u64>,
    arms: &mut BTreeMap<String, ArmData>,
) -> Result<(Vec<String>, Core), LowerError> {
    // The default is unreachable for well-typed programs; `head(nil)` faults on every backend, so a
    // bad tag never silently returns a value.
    let n = var(g, "nil");
    let mut chain = head1(g, n);

    // Fold the arms into an `if tag == k { arm } else …` chain (tag 0 outermost).
    for name in group.iter().rev() {
        // Defensive: `group`/`tags`/`arms` are built together in phases 4/6, so every `name` here has a
        // tag and an unconsumed arm. Rather than `expect`/panic on a would-be internal-invariant
        // violation (e.g. a future duplicate-name regression like the one this pass just fixed), degrade
        // to `Unsupported` — `run_tm` must stay panic-free on ANY input.
        let Some(&tag) = tags.get(name) else {
            return Err(LowerError::Unsupported { node: g.fresh(), what: format!("missing tag for `{name}`") });
        };
        let Some(ArmData { params, captures, body }) = arms.remove(name) else {
            return Err(LowerError::Unsupported { node: g.fresh(), what: format!("arm was rewritten for `{name}`") });
        };
        let mut arm = body;
        // Bind the function's real parameters to the dispatcher's `$a_i` (innermost, closest to body).
        for (i, p) in params.iter().enumerate().rev() {
            let a = var(g, &format!("$a{}", i + 1));
            arm = Core::Let { id: g.fresh(), name: p.clone(), mutable: false, value: Box::new(a), body: Box::new(arm) };
        }
        // Bind the captured values from the env (outer of the params): c_i = head(tail^i($env)).
        if !captures.is_empty() {
            for (i, c) in captures.iter().enumerate().rev() {
                let mut acc = var(g, "$env");
                for _ in 0..i {
                    acc = tail1(g, acc);
                }
                let val = head1(g, acc);
                arm = Core::Let {
                    id: g.fresh(),
                    name: c.clone(),
                    mutable: false,
                    value: Box::new(val),
                    body: Box::new(arm),
                };
            }
            let clos = var(g, "$clos");
            let env_val = tail1(g, clos);
            arm = Core::Let {
                id: g.fresh(),
                name: "$env".to_string(),
                mutable: false,
                value: Box::new(env_val),
                body: Box::new(arm),
            };
        }
        let clos = var(g, "$clos");
        let cond = Core::BinOp(g.fresh(), BinOp::Eq, Box::new(head1(g, clos)), Box::new(nat(g, tag)));
        chain = Core::If(g.fresh(), Box::new(cond), Box::new(arm), Box::new(chain));
    }

    let mut params = vec!["$clos".to_string()];
    for i in 1..=arity {
        params.push(format!("$a{i}"));
    }
    Ok((params, chain))
}

fn dispatcher_name(arity: usize) -> String {
    // `$`-prefixed so it can never collide with a user identifier (the lexer only allows
    // `[A-Za-z_][A-Za-z0-9_]*`) — same convention as the pass's other synthetic names (`$clos`, `$a{i}`,
    // `$env`, `$lam{k}`).
    format!("$apply{arity}")
}

/// A DFS post-order of the emitted functions with edges caller -> callee, so a callee is emitted
/// outer of (before) every caller. Self-recursion is fine (ignored); any other cycle is `Unsupported`.
fn topo_order(emitted: &[(String, Vec<String>, Core)], main: &Core) -> Result<Vec<String>, LowerError> {
    let names: BTreeSet<String> = emitted.iter().map(|(n, ..)| n.clone()).collect();
    let mut edges: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (name, _, body) in emitted {
        let mut callees = BTreeSet::new();
        collect_calls(body, &names, &mut callees, 0)?;
        callees.remove(name); // self-recursion is allowed (LetRec binds the name before its body)
        edges.insert(name.clone(), callees);
    }

    let mut order = Vec::new();
    let mut done: BTreeSet<String> = BTreeSet::new();
    let mut on_stack: BTreeSet<String> = BTreeSet::new();
    for (name, ..) in emitted {
        visit(name, &edges, &mut done, &mut on_stack, &mut order, main, 0)?;
    }
    Ok(order)
}

/// `depth` is the number of `visit` frames currently on the native stack (the call-graph DAG depth
/// among emitted functions, i.e. #functions in the worst case) -- guarded defense-in-depth alongside
/// the up-front `too_deep_node` check on `core`'s own nesting (see `MAX_DEFUNC_DEPTH`).
#[allow(clippy::too_many_arguments)]
fn visit(
    name: &str,
    edges: &BTreeMap<String, BTreeSet<String>>,
    done: &mut BTreeSet<String>,
    on_stack: &mut BTreeSet<String>,
    order: &mut Vec<String>,
    site: &Core,
    depth: u32,
) -> Result<(), LowerError> {
    if depth > MAX_DEFUNC_DEPTH {
        return Err(LowerError::TooDeep { node: site.id() });
    }
    if done.contains(name) {
        return Ok(());
    }
    if !on_stack.insert(name.to_string()) {
        return Err(unsupported(site, format!("cyclic higher-order call graph through `{name}`")));
    }
    for callee in &edges[name] {
        visit(callee, edges, done, on_stack, order, site, depth + 1)?;
    }
    on_stack.remove(name);
    done.insert(name.to_string());
    order.push(name.to_string());
    Ok(())
}

/// Names in `targets` that appear as an `Apply` callee `Var(name)` anywhere in `node`. `depth` guards
/// this tree-walk (defense-in-depth; see `MAX_DEFUNC_DEPTH`) since it recurses over the *rewritten*
/// output, not `core` itself.
fn collect_calls(
    node: &Core,
    targets: &BTreeSet<String>,
    out: &mut BTreeSet<String>,
    depth: u32,
) -> Result<(), LowerError> {
    if depth > MAX_DEFUNC_DEPTH {
        return Err(LowerError::TooDeep { node: node.id() });
    }
    match node {
        Core::Apply(_, callee, args) => {
            if let Core::Var(_, name) = callee.as_ref()
                && targets.contains(name)
            {
                out.insert(name.clone());
            } else {
                collect_calls(callee, targets, out, depth + 1)?;
            }
            for a in args {
                collect_calls(a, targets, out, depth + 1)?;
            }
        }
        Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
            collect_calls(a, targets, out, depth + 1)?;
            collect_calls(b, targets, out, depth + 1)?;
        }
        Core::If(_, a, b, c) => {
            collect_calls(a, targets, out, depth + 1)?;
            collect_calls(b, targets, out, depth + 1)?;
            collect_calls(c, targets, out, depth + 1)?;
        }
        Core::Lambda(_, _, b) | Core::Assign(_, _, b) => collect_calls(b, targets, out, depth + 1)?,
        Core::Let { value, body, .. } | Core::LetRec { value, body, .. } => {
            collect_calls(value, targets, out, depth + 1)?;
            collect_calls(body, targets, out, depth + 1)?;
        }
        Core::Var(..) | Core::Nat(..) | Core::Bool(..) | Core::Unit(..) => {}
    }
    Ok(())
}

/// The free variables of `node` (every `Var`/`Assign`-lvalue name not bound by an inner binder). Used
/// to compute a lambda's captures and to guard functions against referencing an outer `let`. Recurses
/// only over `core` sub-trees (a lambda/function body), so it is bounded by the up-front
/// `too_deep_node` depth check (see `MAX_DEFUNC_DEPTH`) — no separate counter needed, like `analyze`.
fn free_vars(node: &Core) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    fv_into(node, &mut out);
    out
}

fn fv_into(node: &Core, out: &mut BTreeSet<String>) {
    match node {
        Core::Var(_, name) => {
            out.insert(name.clone());
        }
        Core::Nat(..) | Core::Bool(..) | Core::Unit(..) => {}
        Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
            fv_into(a, out);
            fv_into(b, out);
        }
        Core::If(_, a, b, c) => {
            fv_into(a, out);
            fv_into(b, out);
            fv_into(c, out);
        }
        Core::Apply(_, f, args) => {
            fv_into(f, out);
            for a in args {
                fv_into(a, out);
            }
        }
        Core::Lambda(_, params, body) => {
            let mut inner = BTreeSet::new();
            fv_into(body, &mut inner);
            for p in params {
                inner.remove(p);
            }
            out.extend(inner);
        }
        Core::Let { name, value, body, .. } => {
            fv_into(value, out);
            let mut inner = BTreeSet::new();
            fv_into(body, &mut inner);
            inner.remove(name);
            out.extend(inner);
        }
        Core::LetRec { name, value, body, .. } => {
            let mut inner = BTreeSet::new();
            fv_into(value, &mut inner);
            fv_into(body, &mut inner);
            inner.remove(name);
            out.extend(inner);
        }
        Core::Assign(_, name, value) => {
            // The lvalue is a read/write reference (must be in scope) — treat it as free so a lambda
            // that assigns a captured name is caught by the mutable-capture check.
            out.insert(name.clone());
            fv_into(value, out);
        }
    }
}

/// The names bound `let mut` or `Assign`ed anywhere in `core` — a captured one is mutable (rejected).
/// Iterative (explicit worklist via `push_children`), so it can never overflow. Name-based and
/// therefore conservative under shadowing (an immutable inner binding sharing a name with an outer
/// `let mut` is treated as mutable → `Unsupported`, never a miscompile).
fn collect_mutable_names(core: &Core) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        match n {
            Core::Let { mutable: true, name, .. } => {
                out.insert(name.clone());
            }
            Core::Assign(_, name, _) => {
                out.insert(name.clone());
            }
            _ => {}
        }
        push_children(n, &mut stack);
    }
    out
}

// --- small Core builders --------------------------------------------------------------------------

fn var(g: &mut NodeGen, name: &str) -> Core {
    Core::Var(g.fresh(), name.to_string())
}

fn nat(g: &mut NodeGen, n: u64) -> Core {
    Core::Nat(g.fresh(), n)
}

fn apply(g: &mut NodeGen, callee: Core, args: Vec<Core>) -> Core {
    Core::Apply(g.fresh(), Box::new(callee), args)
}

fn cons(g: &mut NodeGen, head: Core, tail: Core) -> Core {
    let c = var(g, "cons");
    apply(g, c, vec![head, tail])
}

fn head1(g: &mut NodeGen, list: Core) -> Core {
    let h = var(g, "head");
    apply(g, h, vec![list])
}

fn tail1(g: &mut NodeGen, list: Core) -> Core {
    let t = var(g, "tail");
    apply(g, t, vec![list])
}

/// `cons(c1, cons(c2, … nil))` of the captured names as plain `Var`s (each in scope at the creation
/// site). Empty captures → `nil` (a closed closure's env), matching the pre-Task-4 `cons(tag, nil)`.
fn build_env(g: &mut NodeGen, captures: &[String]) -> Core {
    let mut env = var(g, "nil");
    for c in captures.iter().rev() {
        let cv = var(g, c);
        env = cons(g, cv, env);
    }
    env
}

fn unsupported(node: &Core, what: String) -> LowerError {
    LowerError::Unsupported { node: node.id(), what }
}

/// `locals` with `name` added — a fresh set for descending into a binder's scope.
fn with(locals: &BTreeSet<String>, name: &str) -> BTreeSet<String> {
    let mut s = locals.clone();
    s.insert(name.to_string());
    s
}

/// The id of the first node found deeper than `MAX_DEFUNC_DEPTH`, or `None` if `core`'s whole nesting
/// depth is within bound. Iterative (explicit `(node, depth)` worklist, no native recursion) so this
/// itself can never overflow, however deep `core` is -- the guard's own scan must be unconditionally
/// total. Mirrors `max_id`'s traversal shape, reusing `push_children`.
fn too_deep_node(core: &Core) -> Option<NodeId> {
    let mut stack: Vec<(&Core, u32)> = vec![(core, 1)];
    while let Some((n, d)) = stack.pop() {
        if d > MAX_DEFUNC_DEPTH {
            return Some(n.id());
        }
        let mut children = Vec::new();
        push_children(n, &mut children);
        for c in children {
            stack.push((c, d + 1));
        }
    }
    None
}

/// The maximum `NodeId` in `core`, used to seed a synthetic `NodeGen` past the input's ids.
fn max_id(core: &Core) -> NodeId {
    let mut max = core.id();
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        max = max.max(n.id());
        push_children(n, &mut stack);
    }
    max
}

fn push_children<'a>(node: &'a Core, stack: &mut Vec<&'a Core>) {
    match node {
        Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
            stack.push(a);
            stack.push(b);
        }
        Core::If(_, a, b, c) => {
            stack.push(a);
            stack.push(b);
            stack.push(c);
        }
        Core::Lambda(_, _, b) | Core::Assign(_, _, b) => stack.push(b),
        Core::Apply(_, f, args) => {
            stack.push(f);
            stack.extend(args.iter());
        }
        Core::Let { value, body, .. } | Core::LetRec { value, body, .. } => {
            stack.push(value);
            stack.push(body);
        }
        Core::Var(..) | Core::Nat(..) | Core::Bool(..) | Core::Unit(..) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;

    /// Reference-equivalence: `defunc` preserves meaning. Parse+desugar `src`, run the reference on the
    /// ORIGINAL and on `defunc(original)`, and require the same value. Also require `defunc`'s output to
    /// lower first-order (lower_asm accepts it) — the whole point.
    fn defunc_preserves_and_lowers(src: &str) {
        use crate::tm::lower_asm::lower_asm;
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let reference = crate::run(src).expect("reference runs");
        let d = defunc(&core).expect("defunc succeeds");
        // 1. meaning preserved: the reference evaluates defunc(core) to the same value.
        let via_defunc = crate::interp::eval(&d).expect("defunc'd core runs on the reference");
        assert_eq!(via_defunc, reference, "defunc changed the meaning of: {src}");
        // 2. defunc(core) is first-order: lower_asm accepts it (no fn-as-value left).
        lower_asm(&d).unwrap_or_else(|e| panic!("defunc(core) must lower first-order for {src}: {e:?}"));
    }

    #[test]
    fn one_closed_function_value_through_a_dispatcher() {
        // Currently `function_as_a_value_is_unsupported`: apply2 takes a function argument.
        defunc_preserves_and_lowers("fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)");
    }

    #[test]
    fn map_over_a_list_defuncs_and_agrees() {
        defunc_preserves_and_lowers(
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn add1(x) { x + 1 }\n\
             [3, 1, 2].map(add1)",
        );
    }

    #[test]
    fn map_and_fold_with_two_arities_agree() {
        defunc_preserves_and_lowers(
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
             fn add(a, b) { a + b }\n\
             fn add1(x) { x + 1 }\n\
             fold([3, 1, 2].map(add1), 0, add)",
        );
    }

    #[test]
    fn two_value_fns_of_the_same_arity_get_distinct_tags() {
        // The contract demos put each value fn in a distinct arity (one arm per dispatcher); this
        // exercises the multi-arm path — `add1`/`dbl` share `apply1` as tags 0 and 1.
        defunc_preserves_and_lowers(
            "fn ap(f, x) { f(x) }\n\
             fn add1(x) { x + 1 }\n\
             fn dbl(x) { x * 2 }\n\
             ap(add1, 5) + ap(dbl, 5)",
        );
    }

    #[test]
    fn user_fn_named_apply_does_not_collide_with_a_dispatcher() {
        // A user fn literally named `apply1` in a higher-order program must NOT collide with the
        // generated dispatcher (which is `$apply1`). Reference and defunc must agree (6), not miscompile.
        defunc_preserves_and_lowers(
            "fn apply1(xs, y) { head(xs) + y } fn ap(f, x) { f(x) } fn add1(x) { x + 1 } apply1([0, 9], ap(add1, 5))",
        );
    }

    #[test]
    fn a_capturing_lambda_defuncs_by_value() {
        defunc_preserves_and_lowers(
            "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)",
        );
    }

    /// A value-lambda whose body is ANOTHER value-lambda (currying: `|y| |z| y + z`) once minted the
    /// SAME `$lam0` name for both, corrupting `tags`/`by_arity`/`arms` and panicking the dispatcher's
    /// `arms.remove`. With guaranteed-unique anon names it defuncs semantics-exact and lowers (result 9).
    #[test]
    fn nested_value_lambdas_curry_defunc_three_way() {
        defunc_preserves_and_lowers("fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)");
    }

    /// A nested higher-order callback (`|x| head([x].map(|y| y + x))`, an inner value-lambda passed to
    /// `map` inside an outer value-lambda) no longer panics: unique naming fixes the crash, and the
    /// program then lands cleanly on defunc's existing cyclic-call-graph rejection (`map -> $apply1 ->
    /// map`, induced by dispatcher aggregation), returning `Unsupported` — never a panic.
    #[test]
    fn nested_hof_callback_is_cleanly_unsupported() {
        use crate::tm::lower_asm::LowerError;
        let (prog, ds) = parse(
            "fn map(xs,f){ if is_empty(xs){nil} else {cons(f(head(xs)), map(tail(xs),f))} } fn ap(f,x){f(x)} ap(|x| head([x].map(|y| y + x)), 3)",
        );
        assert!(ds.is_empty(), "{ds:?}");
        let core = desugar(&prog.unwrap());
        assert!(
            matches!(defunc(&core), Err(LowerError::Unsupported { .. })),
            "nested-HOF callback must be a clean Unsupported (not a panic, not a miscompile)"
        );
    }

    /// Totality guard: `run_tm` (which routes through `defunc`) must NEVER panic on the nested / curried
    /// value-lambda programs — every input is either `Ran` or a clean `LowerError`.
    #[test]
    fn nested_value_lambdas_never_panic_run_tm() {
        use crate::tm::{TM_DEFAULT_CAPS, TmRun, Unary, run_tm};
        for src in [
            "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
            "fn map(xs,f){ if is_empty(xs){nil} else {cons(f(head(xs)), map(tail(xs),f))} } fn ap(f,x){f(x)} ap(|x| head([x].map(|y| y + x)), 3)",
        ] {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "{src}: {ds:?}");
            let core = desugar(&prog.unwrap());
            assert!(
                matches!(run_tm(&core, &Unary, TM_DEFAULT_CAPS), TmRun::Ran { .. } | TmRun::LowerError(_)),
                "run_tm must not panic on: {src}"
            );
        }
    }

    #[test]
    fn capturing_a_mutable_is_unsupported() {
        use crate::tm::lower_asm::LowerError;
        let (prog, ds) = parse("let mut m = 0; fn ap(f) { f(1) } ap(|x| x + m)");
        assert!(ds.is_empty(), "{ds:?}");
        let core = desugar(&prog.unwrap());
        assert!(
            matches!(defunc(&core), Err(LowerError::Unsupported { .. })),
            "mutable capture must be Unsupported in 3b-1"
        );
    }

    /// Pins the REAL `Unsupported` rejection boundary: every one of these was run individually to
    /// confirm it actually returns `Err(LowerError::Unsupported { .. })` (not `Ok`, not a downstream
    /// panic) before being added here — see the task-5 report for the full discovery log. `needle` also
    /// pins *why* (the `what` message), so this can't accidentally pass by tripping a different,
    /// unrelated rejection than the one the case names.
    #[test]
    fn unsupported_boundary() {
        use crate::tm::lower_asm::LowerError;
        fn rejects(src: &str, needle: &str) {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "{src}: {ds:?}");
            let core = desugar(&prog.unwrap());
            match defunc(&core) {
                Err(LowerError::Unsupported { what, .. }) => {
                    assert!(what.contains(needle), "{src}: Unsupported, but `{what}` does not mention `{needle}`");
                }
                other => panic!("must be Unsupported (mentioning `{needle}`): {src}\n  got: {other:?}"),
            }
        }

        // A builtin used as a bare value (never applied): every prelude builtin hits the same check.
        rejects("fn ap(f, x) { f(x) } ap(cons, 1)", "builtin `cons`");
        rejects("fn ap(f, x) { f(x) } ap(head, cons(1, nil))", "builtin `head`");
        rejects("fn ap(f, x) { f(x) } ap(tail, cons(1, nil))", "builtin `tail`");
        rejects("fn ap(f, x) { f(x) } ap(is_empty, nil)", "builtin `is_empty`");

        // A fn both called-by-name AND used-as-a-value (`f` here): Task 1's "BOTH" rejection.
        rejects("fn f(x) { x + 1 } fn ap(g, x) { g(x) } f(1) + ap(f, 2)", "both called by name and used as a value");

        // A named value-fn referencing an outer `let` (Task 4's restriction): `f` is used only as a
        // value (passed to `ap`), and its body reads the outer `n`.
        rejects("let n = 5; fn f(x) { x + n } fn ap(g,x){g(x)} ap(f, 1)", "references an outer let binding");

        // A cyclic higher-order call graph that reaches defunc's cycle detection: `ap` (kept, dispatches
        // through `$apply1`) and `again` (value-used, arity 1, so its body becomes an `$apply1` arm that
        // calls `ap` by name) form a real cycle in the emitted call graph -- `ap -> $apply1 -> ap` --
        // even though no *named* function calls itself (the language's strict declare-before-use
        // scoping rules out mutual recursion by name; this cycle is induced by dispatcher aggregation).
        rejects(
            "fn ap(f, x) { f(x) } fn inc(x) { x + 1 } fn again(x) { ap(inc, x) } \
             fn use_it(g, y) { g(y) } use_it(again, 5)",
            "cyclic higher-order call graph",
        );

        // A nested/local function definition, reached (its enclosing fn must be called, or it's dead
        // code and silently dropped rather than rewritten — see the report for that false start).
        rejects("fn outer(x) { fn inner(y) { y + 1 } inner(x) } outer(5)", "nested function definition");
    }

    /// The dispatcher's fault arm (`head(nil)`), not `Unsupported`, is how a partial-application /
    /// arity-mismatched closure call is handled (Task 1's review): `defunc` has no static arity check on
    /// a value-application, so a mismatched call simply lands on a per-arity dispatcher with no matching
    /// arm and falls through to the faulting `else`. Both the reference (dynamic arity check on
    /// `Value::Closure`) and `defunc`'s output fault — never a silently wrong value. (`crate::run` would
    /// reject this SRC statically as a type error before it ever reached `defunc`, so this exercises the
    /// untyped parse+desugar path directly, exactly as `defunc`'s other unit tests build `core`.)
    #[test]
    fn arity_mismatch_on_closure_call_faults_not_unsupported() {
        let src = "fn ap(f, x) { f(x) } fn add(a, b) { a + b } ap(add, 5)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "{ds:?}");
        let core = desugar(&prog.unwrap());
        assert!(crate::interp::eval(&core).is_err(), "the reference must fault on a mismatched closure call");
        let d = defunc(&core).expect("defunc must NOT reject an arity mismatch as Unsupported");
        assert!(crate::interp::eval(&d).is_err(), "defunc's output must also fault (never silently wrong)");
    }
}
