//! Core AST -> de Bruijn lambda-term. This module has the functional path (Task 5) and the
//! store-passing path for `let mut`/`while` (Task 6). Lowering is syntax-directed and total
//! (returns `LowerError`, never panics).

use crate::core::{Core, NodeId};
use crate::lambda::encode;
use crate::lambda::term::{Dir, LambdaTerm, Path, abs, app, shift, var};

/// Scope sentinel for a store binder introduced by store-passing. `$` is not a legal identifier
/// character, so this can never collide with a user variable (reads resolve to the innermost one).
const STORE: &str = "$store";
/// Scope sentinel for a `while`'s recursive `loop` binder.
const LOOP: &str = "$loop";
/// Scope sentinel for the tuple binder of a mutually recursive group's single fixpoint.
const GROUP: &str = "$group";

/// Bounds EVERY recursive tree-walk in this module — the lowering itself
/// (`lower_expr`/`lower_group`/`lower_lambda`/`lower_region`/`lower_region_body`/`build_while`) and the
/// two standalone analyses it runs first, `assigns_captured` (per `Lambda`) and `collect_region_vars`
/// (per region) — so lowering is TOTAL: `LowerError::TooDeep`, never a native stack overflow, on any
/// Core however deep. Deep-but-valid input reaches here routinely: a long list literal desugars to a
/// `cons`-`Apply` spine and a long statement sequence to a `Seq` spine, and neither is bounded by
/// `MAX_PARSE_DEPTH` (300), which counts only `parse_binary`/block nesting.
///
/// Rather than thread a live counter through all of those, this module measures the input's nesting
/// depth ONCE, ITERATIVELY (`too_deep_node`, an explicit worklist — no native recursion, mirroring
/// `core.rs`'s `Drop` impl and `defunc`'s guard of the same shape), before any recursive pass runs:
/// each of those walks descends only into sub-trees of `core`, so bounding `core`'s own height bounds
/// them all. THE TWO ANALYSES ARE WHY. `assigns_captured` walks a lambda's whole body before that body
/// is lowered, so a counter carried by `lower_expr` alone would still abort on a shallow `fn` wrapping
/// a deep list.
///
/// 700 rather than the 580 of `lower_asm::MAX_LOWER_DEPTH`/`defunc::MAX_DEFUNC_DEPTH`: same 8 MiB
/// production stack and the same ~2x margin (the invariant is the margin, not a numeric match to
/// another guard), but these frames differ in size from `lower_into`'s, so the number follows this
/// module's own measurement. Measured on an explicit 8 MiB thread in a debug build, the UNGUARDED
/// lowering survived depth 1453 and overflowed by 1473 on its fattest reachable shape — a store-passing
/// region's statement spine; a plain list spine survived to ~1750 and a `fn` body to ~1900. 700 keeps
/// ~2.1x below that, and it is exactly `interp::MAX_EVAL_DEPTH`, so the λ backend refuses nothing the
/// reference interpreter can evaluate: structural nesting past 700 already faults there. Do NOT tune
/// this against a smaller test thread — see `lower_asm::MAX_LOWER_DEPTH`'s doc for why.
const MAX_LAMBDA_LOWER_DEPTH: u32 = 700;

// A SECOND GUARD USED TO SIT HERE AND IT WAS REVERTED. `MAX_SHARED_LOGICAL_NODES` = 10,000 refused a
// term whose largest SHARED subterm exceeded it (`1652e09`), on the theory that `subst` duplicates a
// shared subterm once per occurrence of the substituted variable. **Measurement falsified it, and the
// mechanism it named was not what `subst` does.** `subst`'s `Var` arm is `s.clone()` — an `Rc` bump, so
// occurrences are free — while its `Abs` arm re-shifts the whole argument once per `Abs` node in the
// body, unconditionally, before anything checks whether the variable occurs. A step costs
// `|body| + Abs(body) × |arg|`, and NEITHER factor is a sharing property: `let xs = [0..500); let ys =
// [0..500); head(xs) + head(ys)` is 4,821 bytes with no recursion, measures `max_shared` = **4** against
// the bound of 10,000, and its FIRST β-step takes 19.0 s. The guard was 2,500x off on a program anyone
// could write by accident. The measurement stays (`term::max_shared_logical_size` is sound and the two
// tests below pin it); the refusal does not. **The hang is open.** Full record:
// `docs/superpowers/specs/2026-07-31-lambda-shared-subterm-guard-design.md` §10, instrument
// `examples/guard_hole_probe.rs`. The successor design is a per-redex work budget checked inside
// `LambdaCursor::next` — see the roadmap.

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LowerError {
    /// A closure assigns a variable captured from an outer scope (§5.3 — v1 limitation).
    StatefulClosure { node: NodeId },
    /// A construct the lambda backend does not yet support.
    Unsupported { node: NodeId, what: String },
    /// Core nested deeper than the lowering guard allows (bounds this module's native recursion).
    TooDeep { node: NodeId },
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

/// Directions from the root of a store built by `store_of`/`update` down to slot `i` of `k`. The
/// store is `\sel. sel s0 … s(k-1)`, so slot `i` is the argument of the application `k - 1 - i`
/// levels up the spine from the outermost one.
fn wrap_into_slot(origins: &mut Origins, from: usize, i: usize, k: usize) {
    origins.wrap(from, Dir::AppR);
    origins.wrap_n(from, Dir::AppL, k - 1 - i);
    origins.wrap(from, Dir::AbsBody);
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

/// Records `NodeId -> Path` while the term is built. Paths accumulate LEAF-TO-ROOT (`push`, never
/// `insert(0, ..)`) and are reversed once in `lower_mapped`; prefixing at every level would be
/// O(entries * depth) per level. `wrap` is called by each parent as it wraps its children.
///
/// `wrap` only ever extends a SUFFIX of `pairs`, so a parent must apply a child's complete chain of
/// directions before it lowers the next child — otherwise the later child's entries, which sit at
/// higher indices, would pick the earlier child's directions up too.
#[derive(Default)]
struct Origins {
    pairs: Vec<(NodeId, Path)>,
}

impl Origins {
    /// Record that `id` produced the subterm currently at the accumulation root.
    fn at_root(&mut self, id: NodeId) {
        self.pairs.push((id, Vec::new()));
    }

    /// Every path recorded at or after `from` gains `d` — the parent just wrapped those subterms.
    fn wrap(&mut self, from: usize, d: Dir) {
        for (_, p) in &mut self.pairs[from..] {
            p.push(d);
        }
    }

    /// `wrap` with `d` repeated `n` times (all `n` copies land on the same subterms).
    fn wrap_n(&mut self, from: usize, d: Dir, n: usize) {
        for _ in 0..n {
            self.wrap(from, d);
        }
    }

    fn mark(&self) -> usize {
        self.pairs.len()
    }

    /// Drop everything recorded at or after `from`: the subterm those entries describe was discarded
    /// (a store that never escapes its region), so their paths would not resolve.
    fn forget(&mut self, from: usize) {
        self.pairs.truncate(from);
    }

    /// Drop the entry at `at`. Used where one Core node is recorded twice — `lower_expr` records a
    /// region carrier against the whole region term, then `lower_region_body` records it again
    /// against the store-lambda's body — so that every node keeps exactly one path.
    fn drop_at(&mut self, at: usize) {
        if at < self.pairs.len() {
            debug_assert!(
                at == 0 || self.pairs[at - 1].0 == self.pairs[at].0,
                "drop_at({at}): entry does not duplicate its predecessor's NodeId — a caller stopped calling at_root first"
            );
            self.pairs.remove(at);
        }
    }
}

pub fn lower(core: &Core) -> Result<LambdaTerm, LowerError> {
    lower_mapped(core).map(|(t, _)| t)
}

/// `lower`, plus a `NodeId -> Path` map into the produced term. Paths are root-relative and
/// forward-ordered. Compilation is syntax-directed, so the map falls out of the traversal (§5.4).
pub fn lower_mapped(core: &Core) -> Result<(LambdaTerm, Vec<(NodeId, Path)>), LowerError> {
    // The depth guard, before ANY recursive pass — including `assigns_captured`/`collect_region_vars`,
    // which run ahead of the sub-tree they analyse. See `MAX_LAMBDA_LOWER_DEPTH`.
    if let Some(node) = too_deep_node(core) {
        return Err(LowerError::TooDeep { node });
    }
    let mut scope: Vec<String> = Vec::new();
    let mut origins = Origins::default();
    let term = lower_expr(core, &mut scope, None, &mut origins)?;
    for (_, p) in &mut origins.pairs {
        p.reverse();
    }
    // A SHARING GUARD USED TO RUN HERE, at the end, as the deliberate mirror of `too_deep_node` at the
    // start. It was reverted — see the note above `LowerError` — so `too_deep_node` is once again the
    // only refusal this function makes, and lowering is total on every Core within the depth bound.
    Ok((term, origins.pairs))
}

/// The id of the first node found deeper than `MAX_LAMBDA_LOWER_DEPTH`, or `None` if `core`'s whole
/// nesting depth is within bound. Iterative (an explicit `(node, depth)` worklist, no native recursion,
/// via `Core::for_each_child`) so the guard's own scan is unconditionally total however deep `core` is —
/// a recursive measurement would abort on exactly the input the guard exists to refuse.
fn too_deep_node(core: &Core) -> Option<NodeId> {
    let mut stack: Vec<(&Core, u32)> = vec![(core, 1)];
    while let Some((n, d)) = stack.pop() {
        if d > MAX_LAMBDA_LOWER_DEPTH {
            return Some(n.id());
        }
        n.for_each_child(&mut |c| stack.push((c, d + 1)));
    }
    None
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

fn lower_expr(
    core: &Core,
    scope: &mut Vec<String>,
    ctx: Option<&StoreCtx>,
    origins: &mut Origins,
) -> Result<LambdaTerm, LowerError> {
    // The node owns whatever this call returns, so it sits at the accumulation root; its ancestors
    // add the directions that reach it. A region carrier records here and NOT in `lower_region_body`
    // (which `lower_region` re-enters on the same node), so each node keeps exactly one path.
    origins.at_root(core.id());
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
            // `(binop la) lb`: `la` reaches its final place before `lb` is lowered, so `lb`'s entries
            // (which come later in `pairs`) never pick up `la`'s directions.
            let ma = origins.mark();
            let la = lower_expr(a, scope, ctx, origins)?;
            origins.wrap(ma, Dir::AppR); // argument of `binop la`
            origins.wrap(ma, Dir::AppL); // `binop la` is the function of the outer application
            let mb = origins.mark();
            let lb = lower_expr(b, scope, ctx, origins)?;
            origins.wrap(mb, Dir::AppR);
            Ok(app(app(encode::binop(*op), la), lb))
        }
        Core::If(_, c, t, e) => {
            let mc = origins.mark();
            let lc = lower_expr(c, scope, ctx, origins)?;
            origins.wrap_n(mc, Dir::AppL, 2); // the Scott bool is the head of both applications
            let mt = origins.mark();
            let lt = lower_expr(t, scope, ctx, origins)?;
            origins.wrap(mt, Dir::AppR);
            origins.wrap(mt, Dir::AppL);
            let me = origins.mark();
            let le = lower_expr(e, scope, ctx, origins)?;
            origins.wrap(me, Dir::AppR);
            Ok(app(app(lc, lt), le)) // Scott bool selects the branch
        }
        // Closures always take the functional path: the stateful-closure guard guarantees a closure
        // in a region captures only immutable values, so no store context crosses the boundary.
        Core::Lambda(id, params, body) => lower_lambda(*id, params, body, scope, origins),
        Core::Apply(_, f, args) => {
            let mf = origins.mark();
            let mut term = lower_expr(f, scope, ctx, origins)?;
            for a in args {
                // Everything lowered so far becomes the function side of one more application.
                origins.wrap(mf, Dir::AppL);
                let ma = origins.mark();
                let la = lower_expr(a, scope, ctx, origins)?;
                origins.wrap(ma, Dir::AppR);
                term = app(term, la);
            }
            Ok(term)
        }
        Core::Let { name, mutable: false, value, body, .. } => {
            let mv = origins.mark();
            let lv = lower_expr(value, scope, ctx, origins)?;
            origins.wrap(mv, Dir::AppR);
            scope.push(name.clone());
            let mb = origins.mark();
            let lb = lower_expr(body, scope, ctx, origins);
            scope.pop();
            let lb = lb?;
            origins.wrap(mb, Dir::AbsBody);
            origins.wrap(mb, Dir::AppL);
            Ok(app(abs(name.clone(), lb), lv))
        }
        Core::LetRec { name, value, body, .. } => {
            // (\name. body) (fix (\name. value))
            scope.push(name.clone());
            let mv = origins.mark();
            let lvalue = lower_expr(value, scope, ctx, origins);
            origins.wrap(mv, Dir::AbsBody); // under `\name.`
            origins.wrap_n(mv, Dir::AppR, 2); // `fix (\name. value)`, itself the outer argument
            let mb = origins.mark();
            let lbody = lower_expr(body, scope, ctx, origins);
            scope.pop();
            let recval = app(fix(), abs(name.clone(), lvalue?));
            let lbody = lbody?;
            origins.wrap(mb, Dir::AbsBody);
            origins.wrap(mb, Dir::AppL);
            Ok(app(abs(name.clone(), lbody), recval))
        }
        // A tail-less block's discarded carrier: any closed value (never observed by the oracle).
        Core::Unit(_) => Ok(encode::church(0)),
        // Mutation / statement carriers open (or continue) a store-passing region.
        Core::Let { mutable: true, .. } | Core::Assign(..) | Core::While(..) | Core::Seq(..) => {
            lower_region(core, scope, origins)
        }
        Core::LetRecGroup(id, bindings, body) => lower_group(*id, bindings, body, scope, ctx, origins),
    }
}

/// Lower a mutually recursive binding group as ONE fixpoint over an n-tuple, then project each
/// member out of it:
///
/// ```text
/// G   = fix (\g. (\f1 … fn. TUPLE(v1, …, vn)) (proj_1 g) … (proj_n g))
/// out = (\f1 … fn. body) (proj_1 G) … (proj_n G)
/// ```
///
/// The tuple is the existing Scott list encoding (`cons`/`nil`), so `proj_j` is `head` after `j`
/// `tail`s — no new combinator and no new encoding primitive. Applying `\f1 … fn. …` to the
/// projections is exactly "replace every `fj` inside a value by `proj_j g`", done with binders
/// instead of a substitution walk, so it reuses ordinary scope resolution.
///
/// Scope: all n names are pushed before ANY value (or the body) is lowered — the n-ary analogue of
/// `LetRec`'s single `scope.push(name)` — so every member sees every other member and itself. The
/// `GROUP` sentinel is pushed first because the `\g` binder sits outside all n name binders: it
/// keeps the de Bruijn index of every enclosing-scope reference inside a value counting it.
///
/// Cost note: call-by-name `fix` re-expands the whole tuple at EVERY projection rather than sharing
/// it, so a group costs meaningfully more reduction steps than an equivalent self-recursive `fn`.
/// That is a step-cap limit, not a correctness one.
fn lower_group(
    id: NodeId,
    bindings: &[(String, Core)],
    body: &Core,
    scope: &mut Vec<String>,
    ctx: Option<&StoreCtx>,
    origins: &mut Origins,
) -> Result<LambdaTerm, LowerError> {
    // A member name that also names one of the enclosing region's mutable variables would be read
    // back through the store, not through this group's binder: the `Var` arm checks `ctx` FIRST, so
    // every reference to the member — in a sibling's value or in the body — would silently project a
    // slot instead of resolving the function. Reject cleanly rather than miscompile, exactly as the
    // immutable-`let` arm of `lower_region_body` does for the same collision.
    if let Some(ctx) = ctx
        && let Some((name, _)) = bindings.iter().find(|(name, _)| ctx.index_of(name).is_some())
    {
        return Err(LowerError::Unsupported {
            node: id,
            what: format!("group member `{name}` shadowing a mutable variable (v1 limitation)"),
        });
    }

    let n = bindings.len();
    let base = scope.len();

    // --- G = fix (\g. (\f1 … fn. TUPLE) (proj_1 g) … (proj_n g)) ---
    scope.push(GROUP.to_string());
    for (name, _) in bindings {
        scope.push(name.clone());
    }
    // `group` is cloned once per projection, so each value occurs `n` times in the result. The map
    // points at the copy inside `proj_0 G`; the whole chain from a value up to `out`'s root is known
    // from `n` and `j` alone, so it can be applied while that value is still the last thing recorded.
    let mut values: Vec<LambdaTerm> = Vec::with_capacity(n);
    let mut failed: Option<LowerError> = None;
    for (j, (_, value)) in bindings.iter().enumerate() {
        let mv = origins.mark();
        match lower_expr(value, scope, ctx, origins) {
            Ok(lv) => values.push(lv),
            Err(e) => {
                failed = Some(e);
                break;
            }
        }
        origins.wrap(mv, Dir::AppR); // argument of `cons v_j`
        origins.wrap(mv, Dir::AppL); // `cons v_j` heads the j-th cons cell
        origins.wrap_n(mv, Dir::AppR, j); // the j-th cell is j tails down the tuple
        origins.wrap_n(mv, Dir::AbsBody, n); // under `\f1 … \fn.`
        origins.wrap_n(mv, Dir::AppL, n); // that abstraction heads the n projection applications
        origins.wrap(mv, Dir::AbsBody); // under `\g.`
        origins.wrap_n(mv, Dir::AppR, 3); // fix's argument, then `head`'s, then `proj_0 G`'s
        origins.wrap_n(mv, Dir::AppL, n - 1); // `proj_0 G` is the innermost of the n arguments
    }
    scope.truncate(base);
    if let Some(e) = failed {
        return Err(e);
    }

    // TUPLE(v1, …, vn) as a cons-list, then `\f1 … fn.` over it.
    let mut fix_body = encode::nil();
    for v in values.into_iter().rev() {
        fix_body = app(app(encode::cons(), v), fix_body);
    }
    for (name, _) in bindings.iter().rev() {
        fix_body = abs(name.clone(), fix_body);
    }
    // The arguments sit outside the n name binders but under `\g`, so `g` is `var(0)` here.
    for j in 0..n {
        fix_body = app(fix_body, projection(var(0), j));
    }
    let group = app(fix(), abs(GROUP, fix_body));

    // --- out = (\f1 … fn. body) (proj_1 G) … (proj_n G) ---
    for (name, _) in bindings {
        scope.push(name.clone());
    }
    let mb = origins.mark();
    let lbody = lower_expr(body, scope, ctx, origins);
    scope.truncate(base);
    let mut out = lbody?;
    origins.wrap_n(mb, Dir::AbsBody, n); // under `\f1 … \fn.`
    origins.wrap_n(mb, Dir::AppL, n); // that abstraction heads the n projection applications
    for (name, _) in bindings.iter().rev() {
        out = abs(name.clone(), out);
    }
    for j in 0..n {
        out = app(out, projection(group.clone(), j));
    }
    Ok(out)
}

/// `proj_j t` — the `j`-th (0-based) member of a cons-list tuple: `head (tail^j t)`. Iterative.
fn projection(tuple: LambdaTerm, j: usize) -> LambdaTerm {
    let mut t = tuple;
    for _ in 0..j {
        t = app(encode::tail(), t);
    }
    app(encode::head(), t)
}

fn lower_lambda(
    id: NodeId,
    params: &[String],
    body: &Core,
    scope: &mut Vec<String>,
    origins: &mut Origins,
) -> Result<LambdaTerm, LowerError> {
    // Stateful-closure check: an assignment to a name not in `params` (captured) is rejected.
    if assigns_captured(body, params) {
        return Err(LowerError::StatefulClosure { node: id });
    }
    for p in params {
        scope.push(p.clone());
    }
    // The body lowers functionally (no store context): a closure never threads its enclosing store.
    let mb = origins.mark();
    let lbody = lower_expr(body, scope, None, origins);
    for _ in params {
        scope.pop();
    }
    let mut term = lbody?;
    origins.wrap_n(mb, Dir::AbsBody, params.len());
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
fn lower_region(node: &Core, scope: &mut Vec<String>, origins: &mut Origins) -> Result<LambdaTerm, LowerError> {
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
    let mb = origins.mark();
    let body = lower_region_body(node, scope, &ctx, Pos::Value, origins);
    scope.pop();
    let body = body?;
    // `lower_expr` already recorded `node` against this whole term; `lower_region_body` recorded it
    // again, at `mb`, against the store-lambda's body. Keep the outer (larger) one only.
    origins.drop_at(mb);
    origins.wrap(mb, Dir::AbsBody);
    origins.wrap(mb, Dir::AppL);
    Ok(app(abs(STORE, body), initial_store))
}

/// Lower a node inside a region. In `Pos::Value` it yields the region's result value; in `Pos::Store`
/// it yields the store threaded past this node's effects. Reads of `M` variables project from the
/// current `$store`; assignments/`while` rebind it.
fn lower_region_body(
    node: &Core,
    scope: &mut Vec<String>,
    ctx: &StoreCtx,
    pos: Pos,
    origins: &mut Origins,
) -> Result<LambdaTerm, LowerError> {
    // Recorded per arm rather than up front: the `_` arm hands `node` to `lower_expr`, which records
    // it there, and `lower_region`'s entry call re-enters a node `lower_expr` already recorded.
    match node {
        // `let mut m = v` seeds slot `m` (overwriting its placeholder), then continues under the
        // updated store.
        Core::Let { mutable: true, id, name, value, body, .. } => {
            origins.at_root(*id);
            let mv = origins.mark();
            let lv = lower_expr(value, scope, Some(ctx), origins)?;
            // `collect_region_vars` always records a region `let mut` name, so this is total.
            let i = ctx.index_of(name).ok_or_else(|| LowerError::Unsupported {
                node: *id,
                what: format!("`let mut {name}` outside its region"),
            })?;
            let new_store = update(&cur_store(scope)?, i, lv, ctx.k());
            wrap_into_slot(origins, mv, i, ctx.k());
            origins.wrap(mv, Dir::AppR); // the rebuilt store is the argument
            scope.push(STORE.to_string());
            let mc = origins.mark();
            let cont = lower_region_body(body, scope, ctx, pos, origins);
            scope.pop();
            let cont = cont?;
            origins.wrap(mc, Dir::AbsBody);
            origins.wrap(mc, Dir::AppL);
            Ok(app(abs(STORE, cont), new_store))
        }
        // A non-mutable `let` inside a region is a value binder over the continuation; the functional
        // path handles it with `ctx` threaded (so reads in its body still project). If `name` shadows
        // one of the region's mutable variables, that projection would be wrong: the `Var` arm above
        // checks `ctx` first, so reads inside this `let`'s body would silently keep projecting from
        // the store instead of resolving the (correct) immutable binding. Reject cleanly rather than
        // miscompile.
        Core::Let { mutable: false, id, name, value, body, .. } => {
            origins.at_root(*id);
            if ctx.index_of(name).is_some() {
                return Err(LowerError::Unsupported {
                    node: *id,
                    what: "immutable let shadowing a mutable variable (v1 limitation)".to_string(),
                });
            }
            let mv = origins.mark();
            let lv = lower_expr(value, scope, Some(ctx), origins)?;
            origins.wrap(mv, Dir::AppR);
            scope.push(name.clone());
            let mb = origins.mark();
            let lb = lower_region_body(body, scope, ctx, pos, origins);
            scope.pop();
            let lb = lb?;
            origins.wrap(mb, Dir::AbsBody);
            origins.wrap(mb, Dir::AppL);
            Ok(app(abs(name.clone(), lb), lv))
        }
        // Thread the store: run `first` for its effect on the store, then continue with `then`.
        Core::Seq(id, first, then) => {
            origins.at_root(*id);
            let mf = origins.mark();
            let first_store = lower_region_body(first, scope, ctx, Pos::Store, origins)?;
            origins.wrap(mf, Dir::AppR);
            scope.push(STORE.to_string());
            let mc = origins.mark();
            let cont = lower_region_body(then, scope, ctx, pos, origins);
            scope.pop();
            let cont = cont?;
            origins.wrap(mc, Dir::AbsBody);
            origins.wrap(mc, Dir::AppL);
            Ok(app(abs(STORE, cont), first_store))
        }
        // `m = e` produces a new store with slot `m` replaced.
        Core::Assign(id, name, value) => {
            origins.at_root(*id);
            let i = ctx
                .index_of(name)
                .ok_or_else(|| LowerError::Unsupported { node: *id, what: format!("assign to non-region `{name}`") })?;
            let mv = origins.mark();
            let lv = lower_expr(value, scope, Some(ctx), origins)?;
            let new_store = update(&cur_store(scope)?, i, lv, ctx.k());
            match pos {
                Pos::Store => wrap_into_slot(origins, mv, i, ctx.k()),
                // `in_position` discards the store, and with it everything lowered for `value`.
                Pos::Value => origins.forget(mv),
            }
            Ok(in_position(new_store, pos))
        }
        // `while cond { body }` loops until `cond` is false, threading the store via `fix`.
        Core::While(id, cond, body) => {
            origins.at_root(*id);
            let ml = origins.mark();
            let loop_term = build_while(cond, body, scope, ctx, origins)?;
            if matches!(pos, Pos::Value) {
                origins.forget(ml); // `in_position` discards the loop, and with it its subterms
            }
            Ok(in_position(loop_term, pos))
        }
        // `if` splits the store/value across branches; the Scott bool selects one.
        Core::If(id, c, t, e) => {
            origins.at_root(*id);
            let mc = origins.mark();
            let lc = lower_expr(c, scope, Some(ctx), origins)?;
            origins.wrap_n(mc, Dir::AppL, 2);
            let mt = origins.mark();
            let lt = lower_region_body(t, scope, ctx, pos, origins)?;
            origins.wrap(mt, Dir::AppR);
            origins.wrap(mt, Dir::AppL);
            let me = origins.mark();
            let le = lower_region_body(e, scope, ctx, pos, origins)?;
            origins.wrap(me, Dir::AppR);
            Ok(app(app(lc, lt), le))
        }
        // A tail-less carrier: yield the current store (in store position) or a closed value.
        Core::Unit(id) => {
            origins.at_root(*id);
            match pos {
                Pos::Store => cur_store(scope),
                Pos::Value => Ok(encode::church(0)),
            }
        }
        // Any other node is a value expression (the region's tail, or a discarded effect-free
        // statement): lower it against the current store's projections.
        _ => match pos {
            Pos::Value => lower_expr(node, scope, Some(ctx), origins), // records `node` itself
            // Effect-free statement: the store is unchanged and the node contributes no subterm, so
            // there is nothing to record for it.
            Pos::Store => cur_store(scope),
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
fn build_while(
    cond: &Core,
    body: &Core,
    scope: &mut Vec<String>,
    ctx: &StoreCtx,
    origins: &mut Origins,
) -> Result<LambdaTerm, LowerError> {
    let s_init = cur_store(scope)?;
    scope.push(LOOP.to_string());
    scope.push(STORE.to_string());
    // `\loop. \s.` sits at `AppL, AppR` of `(fix g) s_init`; inside its body `iter`, the condition is
    // at `AppL, AppL` and the body's store at `AppL, AppR, AppR`. Both chains are known up front, so
    // each is applied in full before the next child is lowered.
    let mcond = origins.mark();
    let cond_term = lower_expr(cond, scope, Some(ctx), origins);
    origins.wrap_n(mcond, Dir::AppL, 2);
    origins.wrap_n(mcond, Dir::AbsBody, 2);
    origins.wrap(mcond, Dir::AppR);
    origins.wrap(mcond, Dir::AppL);
    let mbody = origins.mark();
    let body_store = lower_region_body(body, scope, ctx, Pos::Store, origins);
    origins.wrap_n(mbody, Dir::AppR, 2);
    origins.wrap(mbody, Dir::AppL);
    origins.wrap_n(mbody, Dir::AbsBody, 2);
    origins.wrap(mbody, Dir::AppR);
    origins.wrap(mbody, Dir::AppL);
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
            Core::LetRecGroup(_, bindings, body) => {
                for (_, value) in bindings {
                    walk(value, vars, letmut);
                }
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
            Core::LetRecGroup(_, bindings, body) => {
                let n = local.len();
                for (name, _) in bindings {
                    local.push(name.clone());
                }
                let r = bindings.iter().any(|(_, v)| walk(v, local, params)) || walk(body, local, params);
                local.truncate(n);
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
    use crate::core::BinOp;
    use crate::desugar::desugar;
    use crate::lambda::decode::decode;
    use crate::lambda::reduce::{MAX_REDUCTION_STEPS, reduce_to_normal_form};
    use crate::lambda::term::Node;
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
    fn mutual_recursion_reduces_to_the_same_value_as_the_reference() {
        // `is_even`/`is_odd` are observably DIFFERENT members: a SWAPPED projection (proj_2 for
        // `is_even`, proj_1 for `is_odd`) computes `false` at an even argument, so a mis-indexed
        // tuple fails rather than agreeing by symmetry.
        //
        // The ODD argument is NOT redundant, and this was measured, not assumed. Under the OTHER
        // natural projection mutant — every member projected to `proj_1`, which is the sabotage the
        // plan names — `is_odd` collapses onto `is_even`, and the pair degenerates into the single
        // self-recursive `is_even(n) = if n == 0 { true } else { is_even(n - 1) }`. That still
        // returns `true` at every EVEN argument, so `is_even(6)` alone PASSES under the mutant. Only
        // an odd argument, whose answer must come out of the OTHER member's base case, falsifies it.
        let defs = "fn is_even(n) { if n == 0 { true } else { is_odd(n - 1) } }\n\
                    fn is_odd(n) { if n == 0 { false } else { is_even(n - 1) } }\n";
        assert_eq!(run_lambda(&format!("{defs}is_even(6)")), Value::Bool(true));
        assert_eq!(run_lambda(&format!("{defs}is_even(5)")), Value::Bool(false));
    }

    #[test]
    fn a_three_member_cycle_projects_the_right_member() {
        // Exercises `proj_2` (TWO `tail`s): each member returns a DIFFERENT constant at n == 0, so
        // an off-by-one in the projection chain lands on the wrong constant.
        // a(4) -> b(3) -> c(2) -> a(1) -> b(0) == 8.
        let src = "fn a(n) { if n == 0 { 7 } else { b(n - 1) } }\n\
                   fn b(n) { if n == 0 { 8 } else { c(n - 1) } }\n\
                   fn c(n) { if n == 0 { 9 } else { a(n - 1) } }\n\
                   a(4)";
        assert_eq!(run_lambda(src), Value::Nat(8));
    }

    #[test]
    fn a_group_member_reads_an_enclosing_binding() {
        // The `\g` binder sits outside the group's n name binders, so a value's reference to an
        // ENCLOSING binding has to count it. Without the `GROUP` scope sentinel this resolves one
        // binder off and the program computes the wrong value (or fails to decode).
        let src = "let k = 10;\n\
                   fn f(n) { if n == 0 { k } else { g(n - 1) } }\n\
                   fn g(n) { if n == 0 { 0 } else { f(n - 1) } }\n\
                   f(2)";
        assert_eq!(run_lambda(src), Value::Nat(10));
    }

    #[test]
    fn a_group_member_shadowing_a_mutable_is_rejected() {
        // Inside a store-passing region, a member name that also names a mutable would be read back
        // out of the store instead of the group's binder. Without the guard this normalizes to a
        // term that does not decode at all (the reference says 5), so reject it up front.
        let src = "{ let mut f = 0; fn f(n) { g(n) } fn g(n) { if n == 0 { 5 } else { f(n - 1) } } f(1) }";
        let (prog, _) = parse(src);
        let core = desugar(&prog.unwrap());
        let err = lower(&core).unwrap_err();
        assert!(matches!(err, LowerError::Unsupported { .. }), "got {err:?}");
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

    // --- Source map (`lower_mapped`) ---

    /// Walk `path` from the root of `t`. Returns `None` if the path leaves the term.
    fn subterm_at<'a>(t: &'a LambdaTerm, path: &[Dir]) -> Option<&'a LambdaTerm> {
        let mut cur = t;
        for d in path {
            cur = match (d, cur.node()) {
                (Dir::AppL, Node::App(f, _)) => f,
                (Dir::AppR, Node::App(_, a)) => a,
                (Dir::AbsBody, Node::Abs(_, b)) => b,
                _ => return None,
            };
        }
        Some(cur)
    }

    fn path_of(pairs: &[(NodeId, Path)], id: NodeId) -> Option<&Path> {
        pairs.iter().find(|(n, _)| *n == id).map(|(_, p)| p)
    }

    #[test]
    fn lower_mapped_agrees_with_lower_and_locates_the_root() {
        let (prog, ds) = parse("1 + 2");
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let (mapped, pairs) = lower_mapped(&core).expect("lowers");
        // One implementation: the wrapper must return exactly what the mapped form's first element is.
        assert_eq!(lower(&core).expect("lowers"), mapped);
        // The root Core node maps to the empty path — it IS the whole term.
        let root = path_of(&pairs, core.id()).expect("root node is mapped");
        assert_eq!(*root, Vec::<Dir>::new(), "the root node's path must be empty");
        // Every recorded path must actually resolve to a subterm of the produced term.
        for (id, path) in &pairs {
            assert!(subterm_at(&mapped, path).is_some(), "node {id} path {path:?} does not resolve");
        }
        // `1 + 2` lowers to `(binop 1) 2`, so the two operands land in DIFFERENT subterms: a swapped
        // direction, or a wrap whose range bleeds from one operand into the other, is caught here even
        // though both paths would still resolve to *some* subterm.
        let Core::BinOp(_, _, a, b) = &core else { panic!("expected a binop at the root, got {core:?}") };
        let pa = path_of(&pairs, a.id()).expect("left operand is mapped");
        let pb = path_of(&pairs, b.id()).expect("right operand is mapped");
        assert_eq!(subterm_at(&mapped, pa), Some(&encode::church(1)), "left operand path {pa:?}");
        assert_eq!(subterm_at(&mapped, pb), Some(&encode::church(2)), "right operand path {pb:?}");
        // Every node is recorded exactly once.
        for (i, (id, _)) in pairs.iter().enumerate() {
            assert!(path_of(&pairs[..i], *id).is_none(), "node {id} recorded twice");
        }
    }

    /// Copied from `examples/tm_demo.rs`'s `first_order` array. No shared corpus helper exists —
    /// `redextape-test-support` exports only `arb_expr_over`.
    const FIRST_ORDER: &[&str] = &[
        "1 + 2 * 3",
        "3 - 5",
        "if 2 > 1 { 10 } else { 20 }",
        "let x = 1; let y = x + x; y * 3",
        "let mut x = 1; x = x + 10; x = x * 2; x",
        "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "[1, 2, 3]",
        "head(cons(1, cons(2, nil)))",
        "head(tail(cons(1, cons(2, nil))))",
    ];

    #[test]
    fn lower_mapped_agrees_with_lower_on_every_demo() {
        for src in FIRST_ORDER {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
            let core = desugar(&prog.unwrap());
            match (lower(&core), lower_mapped(&core)) {
                (Ok(plain), Ok((mapped, pairs))) => {
                    assert_eq!(plain, mapped, "term differs for {src:?}");
                    assert_eq!(path_of(&pairs, core.id()), Some(&Vec::new()), "{src:?}: root path");
                    for (id, path) in &pairs {
                        assert!(subterm_at(&mapped, path).is_some(), "{src:?}: node {id} path {path:?} unresolvable");
                    }
                    for (i, (id, _)) in pairs.iter().enumerate() {
                        assert!(path_of(&pairs[..i], *id).is_none(), "{src:?}: node {id} recorded twice");
                    }
                }
                (Err(a), Err(b)) => assert_eq!(format!("{a:?}"), format!("{b:?}"), "error differs for {src:?}"),
                (a, b) => panic!("{src:?}: one form succeeded and the other did not: {a:?} vs {b:?}"),
            }
        }
    }

    /// Every `Core::Nat` node in the tree, paired with its `NodeId` and value.
    ///
    /// Iterative with an explicit worklist, like `all_ids` in `tests/sourcemap_coverage.rs`, because
    /// `Core::for_each_child` is non-recursive BY CONTRACT: a list literal or statement sequence
    /// desugars to a spine tens of thousands of nodes deep, and recursing it overflows the stack.
    /// Nothing in `FIRST_ORDER` is that deep today, but a helper that recurses is a trap for whoever
    /// extends the corpus.
    fn nat_nodes(core: &Core) -> Vec<(NodeId, u64)> {
        let mut out = Vec::new();
        let mut stack = vec![core];
        while let Some(n) = stack.pop() {
            if let Core::Nat(id, v) = n {
                out.push((*id, *v));
            }
            n.for_each_child(&mut |c| stack.push(c));
        }
        out
    }

    /// `encode::church(n)` is a CLOSED term, so `shift` (applied whenever a subterm moves under a new
    /// binder on its way to the root) is the identity on it. So the subterm sitting at a `Core::Nat`
    /// node's recorded path must be `encode::church(n)` EXACTLY — not merely present, not merely
    /// nested under its parent's path. A wrong-but-nesting path (e.g. `BinOp`'s two wraps swapped, or
    /// a `wrap` range that bled from one sibling into another) lands on a *different* subterm, which
    /// `assert_eq!` here catches even though such a path would still resolve via `subterm_at` and
    /// would still nest under its parent.
    #[test]
    fn every_nat_node_resolves_to_its_church_encoding() {
        for src in FIRST_ORDER {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
            let core = desugar(&prog.unwrap());
            let (mapped, pairs) = lower_mapped(&core).expect("lowers");
            let nats = nat_nodes(&core);
            assert!(!nats.is_empty(), "{src:?}: corpus entry has no Nat node to check");
            for (id, n) in nats {
                let path = path_of(&pairs, id).unwrap_or_else(|| panic!("{src:?}: Nat node {id} unmapped"));
                let sub = subterm_at(&mapped, path)
                    .unwrap_or_else(|| panic!("{src:?}: Nat node {id} path {path:?} unresolvable"));
                assert_eq!(*sub, encode::church(n), "{src:?}: Nat node {id} path {path:?} != church({n})");
            }
        }
    }

    // --- `forget` is reachable only through direct `Core` construction (Finding 2) ---------------

    /// `\x. (x = x + 1)`: the lambda body is a BARE `Assign`, with no enclosing `Seq`, so
    /// `lower_region` enters `lower_region_body` with `Pos::Value` directly on the `Assign` node —
    /// the store-discard branch at `lower.rs:576` that calls `forget`. `desugar` never builds this
    /// shape (`Stmt::Assign`/`Stmt::While` always land inside a `Core::Seq`, desugar.rs:77-84), but
    /// `core` is a `pub mod` and `lower_mapped` takes `&Core`, so it is reachable through the public
    /// API. Without `forget`, the discarded `x + 1` subtree's origins would survive and pick up the
    /// coarse ancestor wraps meant for the (also-discarded) rebuilt store, landing on paths that do
    /// not resolve against the actual — much shallower — produced term.
    #[test]
    fn forget_discards_a_store_discarding_assigns_subtree_without_dangling_paths() {
        let value = Core::BinOp(2, BinOp::Add, Box::new(Core::Var(3, "x".to_string())), Box::new(Core::Nat(4, 1)));
        let assign = Core::Assign(1, "x".to_string(), Box::new(value));
        let core = Core::Lambda(0, vec!["x".to_string()], Box::new(assign));

        let (mapped, pairs) = lower_mapped(&core).expect("lowers");
        assert!(!pairs.is_empty(), "at least the lambda and the assign must be mapped");
        for (id, path) in &pairs {
            assert!(subterm_at(&mapped, path).is_some(), "node {id} path {path:?} dangles");
        }
    }

    // --- The depth guard (`MAX_LAMBDA_LOWER_DEPTH`) ------------------------------------------------

    fn core_of(src: &str) -> Core {
        let (p, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in a {}-byte program: {ds:?}", src.len());
        desugar(&p.unwrap())
    }

    /// A list literal of `n` elements — `cons(0, cons(1, … nil))`, a Core spine of depth `n + 1`.
    /// Parsing and desugaring it are both iterative, so only the lowering's recursion is under test.
    fn deep_list(n: usize) -> Core {
        core_of(&format!("[{}]", (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(", ")))
    }

    /// THIS INPUT USED TO ABORT THE PROCESS. Depth 2049 is past the ~1470 at which the unguarded
    /// lowering overflowed an 8 MiB stack (measured in a debug build), and a stack overflow is an
    /// uncatchable `SIGABRT` — not something a test could have asserted against. The guard measures
    /// depth iteratively before recursing, so it now answers `TooDeep`.
    ///
    /// 2049 is chosen to fail LOUDLY rather than fatally if the guard is ever removed: the suite runs
    /// on 32 MiB threads (`.cargo/config.toml` raises `RUST_MIN_STACK`), where an unguarded lowering
    /// still survives depth ~4000, so a regression makes this assertion fail instead of killing the
    /// test process.
    #[test]
    fn a_core_deeper_than_the_guard_errors_instead_of_overflowing_the_stack() {
        let core = deep_list(2048);
        assert!(matches!(lower(&core), Err(LowerError::TooDeep { .. })), "a 2048-element list must be refused");
        assert!(matches!(lower_mapped(&core), Err(LowerError::TooDeep { .. })), "the mapped path refuses too");
    }

    /// A `fn` whose BODY is deep but which is itself shallow: `assigns_captured` walks that body before
    /// the body is lowered, so a depth counter carried by `lower_expr` alone would recurse right past it
    /// and abort. Pins that the guard is measured over the whole input.
    #[test]
    fn a_deep_lambda_body_is_refused_before_the_capture_analysis_walks_it() {
        let items = (0..2048).map(|i| i.to_string()).collect::<Vec<_>>().join(", ");
        let core = core_of(&format!("fn f(x) {{ let l = [{items}]; x }}\nf(0)"));
        assert!(matches!(lower(&core), Err(LowerError::TooDeep { .. })), "the deep body must be refused");
    }

    /// The guard admits everything below it, so nothing that lowered before is newly refused: a list
    /// literal at the bound still lowers, and the refusal starts exactly one level above it.
    #[test]
    fn the_guard_admits_a_core_at_the_bound_and_refuses_only_past_it() {
        let at_bound = deep_list(MAX_LAMBDA_LOWER_DEPTH as usize - 1); // depth == MAX
        assert!(lower(&at_bound).is_ok(), "a Core exactly at the bound must still lower");
        let past_bound = deep_list(MAX_LAMBDA_LOWER_DEPTH as usize); // depth == MAX + 1
        assert!(matches!(lower(&past_bound), Err(LowerError::TooDeep { .. })), "one level past must refuse");
    }

    // --- Shared-subterm MEASUREMENTS (the guard that read them was reverted) ------------------------
    //
    // These two used to gate. `MAX_SHARED_LOGICAL_NODES` was falsified and removed (see the note above
    // `LowerError`), so they now assert what `max_shared_logical_size` reports rather than what `lower`
    // does with it. They stay because the numbers are worth pinning and cost nothing: both are the
    // extremes of the corpus profile the investigation ran, and either moving means the LOWERING
    // changed shape, which is a thing a later reader wants told.

    /// **The program that killed the total-size design.** A 699-element list literal is ~497,691 logical
    /// nodes with NO sharing, and it reduces cleanly (1,398 steps, 35 s). Its `max_shared` is exactly 0
    /// — which is also why the shared-subterm guard was silent on it, and, read the other way, the first
    /// hint that `max_shared` is blind to the cost of stepping a large unshared term.
    #[test]
    fn a_large_unshared_list_measures_zero_shared_nodes() {
        let big = deep_list(MAX_LAMBDA_LOWER_DEPTH as usize - 1);
        let term = lower(&big).expect("a 699-element list must still lower");
        assert_eq!(
            crate::lambda::term::max_shared_logical_size(&term),
            0,
            "a list literal shares nothing; if this is non-zero the lowering changed"
        );
    }

    /// The corpus maximum, pinned: 684 — the three-way mutual recursion at index 31 of
    /// `FIRST_ORDER_DEMOS`, and the largest `max_shared` any of the 46 demos produces. Re-derive with
    /// `examples/list_reduction_probe.rs corpus` rather than trusting this number.
    #[test]
    fn the_corpus_maximum_shared_subterm_is_684() {
        let core = core_of(
            "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
             fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
             fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
        );
        let term = lower(&core).expect("the corpus maximum must lower");
        assert_eq!(crate::lambda::term::max_shared_logical_size(&term), 684, "the corpus maximum, pinned");
    }
}
