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
//! before binding params. Capture-by-value is exact for immutables (they never change).
//!
//! Plan 3b-2 adds **mutable environment capture by boxing**: a `let mut` (or any assigned name) that
//! some lambda captures is BOXED — its binding becomes an immutable handle `let $boxh{k} = $box(v)`,
//! every read `$box_get($boxh{k})`, every write `$box_set($boxh{k}, v)`, and a capturing closure
//! carries the *handle* (an immutable, so no closure ever captures a mutable). Capturing the handle by
//! value is exactly by-reference capture of the shared cell, matching the reference. A mutable NO
//! lambda captures is left byte-for-byte unchanged (purely-imperative loop counters never box).
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

/// Prelude functions that are always applied directly (never used as a bare value). The `$box*`
/// trio (Plan 3b-2) joins them so `is_builtin_fn` keeps them as static direct-call callees — the
/// boxing rewrite emits `$box`/`$box_get`/`$box_set` applications, never a bare value-use of them.
const BUILTIN_FNS: [&str; 7] = ["cons", "head", "tail", "is_empty", "$box", "$box_get", "$box_set"];

fn is_builtin_fn(name: &str) -> bool {
    BUILTIN_FNS.contains(&name)
}

/// The node generator this pass mints synthetic ids from: a `core::NodeGen` that also RECORDS every
/// id it hands out. Everything `defunc` builds takes its id either from the input node it rewrites
/// (carried through, keeping the user's construct identifiable downstream) or from here — so
/// `minted` is exactly the set of output nodes with no source analogue, which is what
/// `defunc_mapped` returns.
///
/// Wrapping `NodeGen` rather than teaching `core::NodeGen` to record keeps the bookkeeping where the
/// need is: `desugar`'s generator (the other user) mints ids for a tree whose nodes ARE the source,
/// so a `minted` set there would be pure overhead, and `core`'s public API does not grow a field
/// only one pass reads.
struct SynthGen {
    inner: NodeGen,
    /// Every id this generator minted — i.e. every node in the output with no source analogue.
    /// Returned by `defunc_mapped` so the survey can bucket closure scaffolding separately from the
    /// constructs the user actually wrote.
    minted: BTreeSet<NodeId>,
}

impl SynthGen {
    /// A generator whose first `fresh()` returns `next` — seed it past the input's max id so a
    /// synthetic node can never collide with (and be mistaken for) a source one.
    fn seeded(next: NodeId) -> Self {
        SynthGen { inner: NodeGen::seeded(next), minted: BTreeSet::new() }
    }

    fn fresh(&mut self) -> NodeId {
        let id = self.inner.fresh();
        self.minted.insert(id);
        id
    }
}

/// A peeled top-level `fn name(params) { body }` (a `LetRec` whose value is a `Lambda`).
struct Func<'a> {
    /// The peeled `LetRec`'s and `Lambda`'s own ids. A KEPT (name-called) function is re-emitted as
    /// exactly this `fn`, so it is re-emitted with these ids rather than fresh ones — `lower_asm`
    /// bills a function's prologue (one `Mov` per parameter) and its `Ret` to the `LetRec` node, and
    /// those run on EVERY call, so minting here would report a user function's whole per-call frame
    /// cost as defunctionalization scaffolding. A VALUE-used function is dropped (inlined into a
    /// dispatcher arm), so its two ids simply do not appear in the output.
    letrec_id: NodeId,
    lambda_id: NodeId,
    name: String,
    params: Vec<String>,
    body: &'a Core,
}

/// A function to emit as a `LetRec { name, Lambda(params, body) }` in the output.
///
/// WHY NO INPUT ID CAN BE CARRIED BY TWO OUTPUT NODES (the invariant the step survey rests on —
/// attributing a step to an id only means something if that id names ONE node, and this pass INLINES
/// bodies, so duplication is a live hazard rather than a theoretical one). Nothing structurally
/// forbids it; it is emergent, from three separate properties, and a future change to ANY of them
/// reintroduces the hazard:
///   1. `peel` PARTITIONS the input — every node lands in exactly one of the prelude `let` VALUES, the
///      `fn` BODIES, or main, so each reaches `Rewriter::rewrite` at most once. (The peeled binder
///      nodes themselves are in none of the three: they are not rewritten at all, but re-emitted from
///      the ids recorded in `Func`/`LetBinding`, once each.)
///   2. `dispatcher` consumes each arm with `arms.remove(name)`, so an inlined body is emitted once.
///   3. A function both called-by-name AND used-as-a-value is `Unsupported` (see the classification
///      in `defunc_mapped` step 3). THIS is the load-bearing one: supporting that case means emitting
///      the same body twice — once as a kept `fn`, once as a dispatcher arm — and every id inside it
///      would then label two nodes, silently doubling the cost billed to the user's arithmetic.
///
/// Whoever relaxes (3) must re-id one of the two copies. `no_output_node_id_is_duplicated` fails
/// loudly if they do not.
struct Emitted {
    name: String,
    params: Vec<String>,
    body: Core,
    /// The source `(LetRec, Lambda)` ids when this function IS a user `fn` carried through (a kept
    /// function, see `Func`); `None` for a generated `$applyN` dispatcher, which has no source
    /// analogue at all and takes fresh ids.
    src: Option<(NodeId, NodeId)>,
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

/// Rewrite higher-order `core` into first-order Core (or `Unsupported` for a construct this pass does
/// not handle), returning the rewritten tree AND the set of ids that have no source analogue —
/// closure-dispatch scaffolding (`$applyN` dispatchers and their tag tests, the `cons(tag, env)`
/// closure representation, the `$box*` cells). Nodes carried through from the input keep their ids, so
/// the step survey can distinguish what the user wrote from what defunctionalization added.
///
/// The invariant the survey needs is one-directional and holds exactly: every id in the output is
/// either an input id or in the returned set. The set is a slight SUPERSET in one benign direction —
/// the unique-name counter for anonymous lambdas (`$lam{k}`) draws from the same generator, so a
/// handful of returned ids label no node at all. A bucket that collects zero steps costs nothing;
/// the reverse (an output node in neither set) is what would silently misattribute cost.
pub fn defunc_mapped(core: &Core) -> Result<(Core, BTreeSet<NodeId>), LowerError> {
    // 0. Total-by-construction: measure `core`'s nesting depth iteratively (no native recursion) and
    // reject as `TooDeep` BEFORE any recursive pass runs. See `MAX_DEFUNC_DEPTH`'s doc comment.
    if let Some(node) = too_deep_node(core) {
        return Err(LowerError::TooDeep { node });
    }

    let mut g = SynthGen::seeded(max_id(core).saturating_add(1));

    // 1. Peel the outer prelude: leading `let` value-bindings and `LetRec`-with-`Lambda` (`fn`) defs,
    // in whatever order they interleave. The first non-such node is the main tail expression.
    let (lets, funcs, main) = peel(core)?;
    let func_names: BTreeSet<String> = funcs.iter().map(|f| f.name.clone()).collect();
    let let_names: BTreeSet<String> = lets.iter().map(|l| l.name.clone()).collect();

    // Names bound `let mut` or `Assign`ed anywhere in the program. A mutable that some lambda
    // captures must be BOXED (Plan 3b-2): the closure captures a shared mutable cell by reference,
    // matching the reference's by-reference capture.
    let mutable_names = collect_mutable_names(core);

    // Plan 3b-2: `boxed_names` = the mutables that some lambda captures = mutable_names ∩ (⋃ over
    // every `Lambda` node of free_vars(body) \ params). A mutable NO lambda captures is left
    // untouched (purely-imperative mutables — loop counters — stay byte-for-byte unchanged). Each
    // boxed name gets a stable, uncollidable handle `$boxh{k}` ($-prefixed so no user identifier can
    // collide), so every site for the same mutable resolves to the same handle. Computed once, up
    // front, before any recursive rewrite pass runs.
    let captured_by_lambda = lambda_captured_names(core);
    let boxed_names: BTreeSet<String> = mutable_names.intersection(&captured_by_lambda).cloned().collect();

    // Plan 3b-2 (Task 7 fix): the by-name box interception (keyed by NAME) fires on ANY use of a name
    // matching a boxed mutable — but only `let mut` bindings are ever boxed, so two OTHER binder kinds
    // that reuse a boxed name would be miscompiled:
    //   - a lambda/fn PARAMETER (`param_names`): a param is never boxed, so its (never-boxed) reads get
    //     rewritten to `$box_get($boxh…)` — a handle NOT in scope inside that param's body — producing
    //     malformed `Ok` Core with a FREE `$boxh…`.
    //   - a top-level `fn`/`LetRec` FUNCTION NAME (`func_names`): the by-name interception in
    //     `rewrite_value_name` fires on the FUNCTION's value-use too, rewriting it to `$box_get($boxh…)`
    //     — a MISBOUND handle — again malformed `Ok` Core (`run_tm` then diverges to HitCap).
    // Either is a miscompile, not an accept, so a boxed mutable whose name ALSO appears as a parameter
    // OR a function name anywhere degrades the whole program to `Unsupported` (exactly how 3b-1 handled
    // these). Conservative: it also over-rejects the sound sibling where the name-collision is benign,
    // which is fine per never-miscompile > always-accept. The sound inner-`let`-shadowing case (an
    // inner `let n` shadowing an outer boxed `let mut n`) is neither a param nor a function name, so it
    // still boxes. `func_names` is the top-level function set already computed above.
    if !boxed_names.is_empty() {
        let mut clashers = param_names(core);
        clashers.extend(func_names.iter().cloned());
        if let Some(clash) = boxed_names.intersection(&clashers).next() {
            return Err(LowerError::Unsupported {
                node: core.id(),
                what: format!("boxed mutable `{clash}` is also used as a parameter or function name"),
            });
        }
    }

    let mut box_handle: BTreeMap<String, String> = BTreeMap::new();
    for (k, n) in boxed_names.iter().enumerate() {
        box_handle.insert(n.clone(), format!("$boxh{k}"));
    }

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
        box_handle: &box_handle,
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

    // 5b. Kept functions keep their binding — and their identity: re-emitted with the source `fn`'s
    // own `LetRec`/`Lambda` ids (see `Func`), since this IS that function, only with its body
    // rewritten.
    let mut emitted: Vec<Emitted> = Vec::new();
    for f in &kept {
        let locals: BTreeSet<String> = f.params.iter().cloned().collect();
        let body = rw.rewrite(f.body, &locals)?;
        emitted.push(Emitted {
            name: f.name.clone(),
            params: f.params.clone(),
            body,
            src: Some((f.letrec_id, f.lambda_id)),
        });
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
        // Pure scaffolding: a dispatcher exists only because closures do — no source `fn` corresponds
        // to it, so its `LetRec`/`Lambda` are minted (`src: None`).
        emitted.push(Emitted { name: dispatcher_name(arity), params, body, src: None });
    }

    // 8. Emit in dependency order (callees outer of callers); a non-self cycle is `Unsupported`.
    let order = topo_order(&emitted, main)?;

    // 9. Assemble: the function `LetRec`s wrap the prelude `let`s, which wrap the rewritten main.
    let mut by_name: BTreeMap<String, Emitted> = BTreeMap::new();
    for e in emitted {
        by_name.insert(e.name.clone(), e);
    }
    let mut acc = main_rw;
    // Prelude lets AROUND main: first let outermost of the let-group (so a later let's value can see
    // an earlier one). Innermost-first here means iterating in reverse.
    let mut let_pairs: Vec<(&LetBinding, Core)> = lets.iter().zip(let_values_rw).collect();
    while let Some((l, v)) = let_pairs.pop() {
        // Plan 3b-2: a boxed prelude mutable is re-emitted as an immutable box-handle binding
        // `let $boxh(n) = $box(value)`, so the closure built at a later let's site captures the box.
        if let Some(h) = box_handle.get(&l.name) {
            let boxed_val = box1(&mut g, v);
            acc = Core::Let {
                id: l.id,
                name: h.clone(),
                mutable: false,
                value: Box::new(boxed_val),
                body: Box::new(acc),
            };
        } else {
            acc = Core::Let {
                id: l.id,
                name: l.name.clone(),
                mutable: l.mutable,
                value: Box::new(v),
                body: Box::new(acc),
            };
        }
    }
    // Function chain OUTERMOST (outermost = `order[0]`).
    for name in order.iter().rev() {
        // Defensive: `order` is a permutation of `emitted`'s names (topo_order over exactly them), so
        // every name is present. Degrade an internal-invariant violation to `Unsupported` rather than
        // `expect`/panic — `defunc`/`run_tm` must stay total on ANY input.
        let Some(Emitted { params, body, src, .. }) = by_name.remove(name) else {
            return Err(LowerError::Unsupported {
                node: main.id(),
                what: format!("ordered name `{name}` was emitted"),
            });
        };
        // A carried-through user `fn` keeps its `LetRec`/`Lambda` ids; a generated dispatcher mints
        // both. Neither can collide: the source ids belong to a peeled node that appears nowhere else
        // in the output, and `g` is seeded past every input id.
        let (letrec_id, lambda_id) = match src {
            Some(ids) => ids,
            None => (g.fresh(), g.fresh()),
        };
        let lam = Core::Lambda(lambda_id, params, Box::new(body));
        acc = Core::LetRec { id: letrec_id, name: name.clone(), value: Box::new(lam), body: Box::new(acc) };
    }
    Ok((acc, g.minted))
}

/// Defunctionalize `core`. Exactly `defunc_mapped` with the synthetic-id set discarded — ONE
/// implementation, so the two cannot drift.
pub fn defunc(core: &Core) -> Result<Core, LowerError> {
    defunc_mapped(core).map(|(c, _)| c)
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
            Core::LetRec { id, name, value, body } => {
                let Core::Lambda(lam_id, params, lam_body) = value.as_ref() else {
                    return Err(unsupported(cur, "letrec value is not a function".to_string()));
                };
                funcs.push(Func {
                    letrec_id: *id,
                    lambda_id: *lam_id,
                    name: name.clone(),
                    params: params.clone(),
                    body: lam_body,
                });
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
    g: &'a mut SynthGen,
    tags: &'a BTreeMap<String, u64>,
    kept: &'a BTreeSet<String>,
    mutable_names: &'a BTreeSet<String>,
    /// Plan 3b-2: boxed name → its stable immutable handle name `$boxh{k}` (the box the closure
    /// captures). Its KEY set IS `boxed_names` (the mutables some lambda captures), so a `.get(name)`
    /// both tests boxed-membership and yields the handle in one lookup.
    box_handle: &'a BTreeMap<String, String>,
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
            Core::Assign(id, name, v) => {
                let rv = self.rewrite(v, locals)?;
                // Plan 3b-2: a write to a boxed mutable is `$box_set($boxh(n), v)`, which (like
                // `Assign`) evaluates to unit — semantics preserved. The `$box_set` call IS this
                // assignment, rewritten, so it carries the `Assign`'s own id.
                if let Some(h) = self.box_handle.get(name).cloned() {
                    let hv = var(self.g, &h);
                    return Ok(box_set2(self.g, *id, hv, rv));
                }
                Ok(Core::Assign(*id, name.clone(), Box::new(rv)))
            }
            Core::Let { id, name, mutable, value, body, .. } => {
                let value = self.rewrite(value, locals)?;
                // `body` is rewritten with the ORIGINAL `name` in scope (never the handle): capture
                // detection in a nested lambda matches on the original free-var name; the read/write
                // rewrites below intercept the boxed name before the `locals` check.
                let body = self.rewrite(body, &with(locals, name))?;
                // Plan 3b-2: a binding of a boxed mutable becomes an IMMUTABLE box-handle binding
                // `let $boxh(n) = $box(value)`. Keyed on box-set membership (not the `mutable` flag) so
                // an immutable inner `let n` shadowing an outer boxed mutable is boxed consistently —
                // otherwise its reads (rewritten to `$box_get($boxh(n))`) would hit the wrong cell.
                if let Some(h) = self.box_handle.get(name).cloned() {
                    let boxed_val = box1(self.g, value);
                    return Ok(Core::Let {
                        id: *id,
                        name: h,
                        mutable: false,
                        value: Box::new(boxed_val),
                        body: Box::new(body),
                    });
                }
                Ok(Core::Let {
                    id: *id,
                    name: name.clone(),
                    mutable: *mutable,
                    value: Box::new(value),
                    body: Box::new(body),
                })
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
        // Plan 3b-2: a read of a boxed mutable is `$box_get($boxh(n))`. Intercepted BEFORE the
        // `locals` check (a boxed mutable is a local, but its value lives in the box) so every
        // read site — direct `Var`, or an `Apply` callee routed here — resolves through the cell. The
        // `$box_get` call IS this variable read, rewritten, so it carries the `Var`'s own id.
        if let Some(h) = self.box_handle.get(name).cloned() {
            let hv = var(self.g, &h);
            return Ok(box_get1(self.g, id, hv));
        }
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
        // Captures in original-name order (BTreeSet). Plan 3b-2: a captured mutable contributes its
        // IMMUTABLE box HANDLE `$boxh(c)` (not `c`) — capturing the box handle by value is exactly
        // by-reference capture of the underlying cell. An immutable capture stays by-value (3b-1). The
        // mapping preserves order, so the creation-site env and the arm-unpack still pair up 1:1; and
        // since a box handle is immutable, no closure captures a mutable — the 3b-1 rejection is gone.
        let raw_captures = fv.iter().filter(|v| locals.contains(*v));
        let mut captures: Vec<String> = Vec::new();
        for c in raw_captures {
            if let Some(h) = self.box_handle.get(c) {
                captures.push(h.clone());
            } else if self.mutable_names.contains(c) {
                // Defensive invariant: boxed_names ⊇ every captured mutable, so a captured mutable is
                // always boxed and this is unreachable. Degrade rather than by-value-capture a mutable
                // (which would be a silent miscompile) — `defunc` must never miscompile.
                return Err(LowerError::Unsupported {
                    node: body.id(),
                    what: format!("lambda captures unboxed mutable `{c}`"),
                });
            } else {
                captures.push(c.clone());
            }
        }

        let arity = params.len();
        let tag = {
            let slot = self.next_tag.entry(arity).or_insert(0);
            let t = *slot;
            *slot += 1;
            t
        };
        // GUARANTEED-UNIQUE, independent of push order. The invariant this name needs is exactly: a
        // MONOTONIC counter, read BEFORE the recursive body rewrite. The historical bug was the FIRST
        // half — the name came from `self.anon.len()`, which DID satisfy "read before the recursion"
        // but is not a monotonic ticket dispenser at read time: `len()` only advances on the
        // `self.anon.push` below, which happens AFTER the recursive rewrite. So a value-lambda whose
        // body contains ANOTHER value-lambda (currying, nested callbacks) had both read `0` and mint
        // the SAME `$lam0` — a duplicate key that corrupted `tags`/`by_arity`/`arms` and panicked the
        // dispatcher's `arms.remove`.
        //
        // `self.g` satisfies that invariant, but nothing here NEEDS it to be the node generator: a
        // dedicated monotonic counter would be equally collision-proof. Borrowing `g` is a deliberate
        // convenience, and it costs one thing worth knowing — the id is consumed as a NAME, never
        // labelling a node, so `defunc_mapped`'s returned set is a slight superset of the ids that
        // actually appear in the output (see its doc comment). Harmless: a declared id that labels no
        // node collects no steps.
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
    g: &mut SynthGen,
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
        //
        // These param bindings are SCAFFOLDING (fresh ids), and that is a deliberate asymmetry worth
        // stating: for a KEPT function the equivalent parameter binding bills to the user's `LetRec`
        // (see `Func`), whereas here the same semantic act bills to the dispatcher. The dropped
        // `Lambda`'s id IS available and unused — it could have been reused here — so this is a
        // declined option, not a forced one. Declined because these bindings exist ONLY because
        // arguments now arrive through a dispatcher's positional `$a_i` slots: that is a
        // defunctionalization artifact, and billing it to closure dispatch is the honest measurement
        // the survey is for, not a distortion of it.
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
fn topo_order(emitted: &[Emitted], main: &Core) -> Result<Vec<String>, LowerError> {
    let names: BTreeSet<String> = emitted.iter().map(|e| e.name.clone()).collect();
    let mut edges: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for e in emitted {
        let mut callees = BTreeSet::new();
        collect_calls(&e.body, &names, &mut callees, 0)?;
        callees.remove(&e.name); // self-recursion is allowed (LetRec binds the name before its body)
        edges.insert(e.name.clone(), callees);
    }

    let mut order = Vec::new();
    let mut done: BTreeSet<String> = BTreeSet::new();
    let mut on_stack: BTreeSet<String> = BTreeSet::new();
    for e in emitted {
        visit(&e.name, &edges, &mut done, &mut on_stack, &mut order, main, 0)?;
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

/// The union, over every `Lambda` node in `core`, of the lambda body's free variables minus its
/// params — every name some lambda captures. Iterative outer walk (explicit worklist, no native
/// recursion); `free_vars` per lambda recurses only over a lambda body, so it is depth-bounded by the
/// up-front `too_deep_node` check (see `MAX_DEFUNC_DEPTH`) — totality preserved. Intersected with the
/// mutables (`collect_mutable_names`) to decide which mutables must be boxed (Plan 3b-2).
fn lambda_captured_names(core: &Core) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        if let Core::Lambda(_, params, body) = n {
            let mut fv = free_vars(body);
            for p in params {
                fv.remove(p);
            }
            out.extend(fv);
        }
        push_children(n, &mut stack);
    }
    out
}

/// Every name that appears as a lambda/fn PARAMETER anywhere in `core`. A `fn` desugars to a `LetRec`
/// whose value is a `Lambda`, so collecting every `Core::Lambda` node's params covers both bare
/// value-lambdas and named `fn` definitions. Iterative outer walk (explicit worklist, no native
/// recursion), so it is unconditionally total, like `collect_mutable_names`/`lambda_captured_names`.
/// Plan 3b-2 (Task 7 fix): intersected with `boxed_names` to reject a boxed mutable whose name is also
/// reused as a parameter (the by-name box interception would miscompile such a param — see `defunc`).
fn param_names(core: &Core) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        if let Core::Lambda(_, params, _) = n {
            out.extend(params.iter().cloned());
        }
        push_children(n, &mut stack);
    }
    out
}

// --- small Core builders --------------------------------------------------------------------------

// Every builder here mints a FRESH id for the node it makes: each exists only to represent a closure
// (`cons(tag, env)`), to take one apart inside a dispatcher, or to hold a boxed cell — none of them
// corresponds to a construct in the source. The two exceptions are `box_get1`/`box_set2`, whose outer
// `Apply` REPLACES a source `Var`/`Assign` and therefore takes that node's id (`at`).

fn var(g: &mut SynthGen, name: &str) -> Core {
    Core::Var(g.fresh(), name.to_string())
}

fn nat(g: &mut SynthGen, n: u64) -> Core {
    Core::Nat(g.fresh(), n)
}

fn apply(g: &mut SynthGen, callee: Core, args: Vec<Core>) -> Core {
    Core::Apply(g.fresh(), Box::new(callee), args)
}

fn cons(g: &mut SynthGen, head: Core, tail: Core) -> Core {
    let c = var(g, "cons");
    apply(g, c, vec![head, tail])
}

fn head1(g: &mut SynthGen, list: Core) -> Core {
    let h = var(g, "head");
    apply(g, h, vec![list])
}

fn tail1(g: &mut SynthGen, list: Core) -> Core {
    let t = var(g, "tail");
    apply(g, t, vec![list])
}

// Plan 3b-2 box builders: `$box(init)` allocates a fresh cell, `$box_get(h)` reads it, and
// `$box_set(h, v)` writes it (evaluating to unit). `$box*` are `BUILTIN_FNS`, so these applications
// stay static direct calls — the reference resolves them to the `Builtin::Box*` builtins and
// `lower_asm` to the `Box`/`BoxGet`/`BoxSet` instructions.
//
// `box1` is the only one of the three with no source analogue: the cell allocation is new (the `let`
// that holds it keeps its own id), so its `Apply` is minted. `box_get1`/`box_set2` each REPLACE a
// source node — a `Var` read, an `Assign` write — so their outer `Apply` bills to `at`, that node's
// id: a read/write through a box is still the read/write the user wrote, and the survey should say so.
fn box1(g: &mut SynthGen, init: Core) -> Core {
    let f = var(g, "$box");
    apply(g, f, vec![init])
}

fn box_get1(g: &mut SynthGen, at: NodeId, h: Core) -> Core {
    let f = var(g, "$box_get");
    Core::Apply(at, Box::new(f), vec![h])
}

fn box_set2(g: &mut SynthGen, at: NodeId, h: Core, v: Core) -> Core {
    let f = var(g, "$box_set");
    Core::Apply(at, Box::new(f), vec![h, v])
}

/// `cons(c1, cons(c2, … nil))` of the captured names as plain `Var`s (each in scope at the creation
/// site). Empty captures → `nil` (a closed closure's env), matching the pre-Task-4 `cons(tag, nil)`.
fn build_env(g: &mut SynthGen, captures: &[String]) -> Core {
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

    /// Every owned `Core` id, reachable from `core` by an ITERATIVE walk (reusing this module's own
    /// `push_children`, the same child enumeration `too_deep_node`/`max_id` walk with): a big list
    /// literal desugars to a spine tens of thousands of nodes deep, and a recursive walk here would
    /// overflow the native stack just like an unguarded recursive `Drop` would.
    fn all_node_ids(core: &Core) -> BTreeSet<NodeId> {
        let mut out = BTreeSet::new();
        let mut stack = vec![core];
        while let Some(n) = stack.pop() {
            out.insert(n.id());
            push_children(n, &mut stack);
        }
        out
    }

    /// A node in `core` satisfying `pred`, or `None`. Iterative for the same reason as
    /// `all_node_ids`; the worklist order is not source order, so "first" only pins a unique answer
    /// when the program contains exactly one match — which is how every caller below uses it.
    fn find_first<'a>(core: &'a Core, pred: &dyn Fn(&Core) -> bool) -> Option<&'a Core> {
        let mut stack = vec![core];
        while let Some(n) = stack.pop() {
            if pred(n) {
                return Some(n);
            }
            push_children(n, &mut stack);
        }
        None
    }

    /// The id of an `Add` `BinOp` node in `core`, or `None`.
    fn find_add_binop_id(core: &Core) -> Option<NodeId> {
        find_first(core, &|n| matches!(n, Core::BinOp(_, BinOp::Add, ..))).map(|n| n.id())
    }

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

    /// Plan 3b-2: a mutable captured by a VALUE-USED lambda is now BOXED and runs (it was
    /// `Unsupported` in 3b-1). `m` (a `let mut`) is captured by `|x| x + m`, which is passed to `ap` —
    /// defunc boxes `m` into a shared cell, and the reference agrees on the value.
    #[test]
    fn value_used_mutable_capture_is_boxed_and_runs() {
        defunc_preserves_and_lowers("let mut m = 0; fn ap(f) { f(1) } ap(|x| x + m)");
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

        // Plan 3b-2 scope: boxing only helps a mutable captured by a VALUE-USED lambda. A mutable
        // captured by a NAME-CALLED fn referencing an outer scope stays Unsupported (the pre-existing
        // closed-subroutine boundary): `f` is only called (`f(1)`), and reads the outer `let mut n`.
        rejects("let mut n = 5; fn f(x) { x + n } f(1)", "references an outer let binding");

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

    /// The headline (Plan 3b-2): a value-used closure captures a mutable; a later assignment is
    /// observed (by-reference). `defunc` must box the mutable and preserve the reference's value.
    #[test]
    fn boxed_mutable_capture_is_semantics_preserving() {
        let src = "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty());
        let core = desugar(&prog.unwrap());
        let reference = crate::interp::eval(&core).unwrap();
        assert_eq!(reference, crate::value::Value::Nat(10)); // by-reference: 0 + 10
        let d = defunc(&core).expect("boxing lowers");
        assert_eq!(crate::interp::eval(&d).unwrap(), reference); // reference(P) == reference(defunc(P))
    }

    /// The defunc'd program is first-order: no Lambda survives in value position, and no closure
    /// captures a mutable (every capture is a $boxh handle, bound immutably).
    #[test]
    fn boxed_capture_output_is_first_order_and_captures_no_mutable() {
        let src = "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)";
        let core = desugar(&parse(src).0.unwrap());
        let d = defunc(&core).expect("lowers");
        // It lowers first-order (the ultimate structural check) and runs on the TM.
        assert!(crate::tm::lower_asm(&d).is_ok(), "defunc'd boxing program must be first-order");
    }

    /// A purely imperative mutable (never captured by any lambda) is NOT boxed — no regression.
    #[test]
    fn uncaptured_mutable_is_not_boxed() {
        let src = "let mut n = 3; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc";
        let core = desugar(&parse(src).0.unwrap());
        // defunc is only invoked on higher-order fallback; here lower_asm already handles it directly,
        // but defunc must still be identity-preserving if called: reference matches.
        let reference = crate::interp::eval(&core).unwrap();
        let d = defunc(&core).expect("a purely-imperative program (no higher-order construct) must defunc");
        assert_eq!(crate::interp::eval(&d).unwrap(), reference);
        // No mutable here is captured by any lambda, so NOTHING is boxed: the output is byte-for-byte
        // un-boxed — a loop counter never grows a box. (FIX 3: previously vacuous under `if let Ok`.)
        assert!(!format!("{d:?}").contains("$box"), "an uncaptured loop counter must not be boxed:\n{d:?}");
    }

    /// End-to-end proof the whole box pipeline runs: `run_tm` defunctionalizes the headline boxing
    /// program, lowers the `$box*` ops to the BOX tape, simulates, and decodes to the SAME value the
    /// reference computes — `reference == TM` for mutable capture (λ cannot express it).
    #[test]
    fn boxed_mutable_capture_runs_reference_equals_tm() {
        use crate::tm::{TM_DEFAULT_CAPS, TmRun, Unary, decode_tape, run_tm};
        let src = "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)";
        let core = desugar(&parse(src).0.unwrap());
        let reference = crate::interp::eval(&core).unwrap();
        match run_tm(&core, &Unary, TM_DEFAULT_CAPS) {
            TmRun::Ran { tapes } => assert_eq!(
                decode_tape(&tapes, &reference, &Unary),
                Some(reference.clone()),
                "reference vs TM disagree on boxed mutable capture"
            ),
            other => panic!("boxed capture must run to a value on the TM: {other:?}"),
        }
    }

    /// Two distinct value-lambdas capture the SAME mutable `n`; both must see the by-reference write
    /// (`n = 5`). They share the one box handle `$boxh0` — each closure carries it, each arm reads
    /// through it. `ap(a) + ap(b) = 5 + 5 = 10`, reference-exact and first-order.
    #[test]
    fn two_lambdas_capture_the_same_mutable_share_one_box() {
        defunc_preserves_and_lowers(
            "let mut n = 1; fn ap(f) { f(0) } let a = |x| x + n; let b = |y| y + n; n = 5; ap(a) + ap(b)",
        );
    }

    /// A boxed mutable that is ALSO used imperatively (read-modify-write `n = n + 5` on the box)
    /// between creation and the capturing call: the closure observes the imperative update through the
    /// shared cell. `g(10) = 10 + 5 = 15`, reference-exact and first-order.
    #[test]
    fn mutable_captured_and_mutated_imperatively_is_boxed() {
        defunc_preserves_and_lowers("let mut n = 0; fn ap(f) { f(10) } let g = |x| x + n; n = n + 5; ap(g)");
    }

    /// FIX 1 (Task 7 review — the contract hole): a boxed mutable whose NAME is ALSO reused as a
    /// lambda/fn PARAMETER cannot be boxed safely. The read/write interception (`box_handle.get(name)`)
    /// is keyed by NAME, so a param that shadows the boxed mutable would have its (never-boxed) reads
    /// rewritten to `$box_get($boxh)` — a handle NOT in scope inside that param's body — producing
    /// malformed `Ok` Core with a free `$boxh`. That violates the contract (accept ⟹ semantics-exact),
    /// so the program must degrade to `Unsupported`, never `Ok` with a free variable.
    #[test]
    fn boxed_mutable_reused_as_a_parameter_is_unsupported() {
        use crate::tm::lower_asm::LowerError;
        // Both are well-typed programs the full pipeline evaluates to Nat(14); a lambda param `n` (first
        // case) / fn param `n` (second case) shadows the outer boxed `let mut n`.
        for src in [
            "let mut n = 1; fn ap(g){g(0)} let f = |x| x + n; let t = |n| n + 1; n = 10; ap(f) + t(3)",
            "let mut n = 1; fn ap(g){g(0)} fn t(n){ n + 1 } let f = |x| x + n; n = 10; ap(f) + t(3)",
        ] {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "{src}: {ds:?}");
            let core = desugar(&prog.unwrap());
            // Sanity: these are meaningful programs the reference evaluates to 14 (0 + 10, plus 3 + 1).
            assert_eq!(crate::interp::eval(&core).unwrap(), crate::value::Value::Nat(14), "{src}");
            // MUST be Unsupported — not `Ok` (with a free `$boxh0`), which would be a silent miscompile.
            assert!(
                matches!(defunc(&core), Err(LowerError::Unsupported { .. })),
                "a boxed mutable reused as a param must be Unsupported (not Ok with a free $boxh): {src}"
            );
        }
    }

    /// FIX C1 (Task 7 whole-branch review — the SAME contract hole as the param case, one rung up): a
    /// boxed mutable whose NAME is ALSO a top-level `fn`/`LetRec` (FUNCTION) name cannot be boxed
    /// safely. The by-name box interception in `rewrite_value_name` fires on ANY value-use of that
    /// name — INCLUDING the FUNCTION's value-use — rewriting it to `$box_get($boxh…)`, which is
    /// malformed Core `defunc` would otherwise return as `Ok`, making `run_tm` diverge (HitCap) from
    /// the reference. `param_names` only collects `Lambda` params, NOT function binder names, so the
    /// original guard let this through; the fix unions `func_names` into the clash set. Must degrade to
    /// `Unsupported`, never `Ok` with a free/misbound `$boxh`.
    #[test]
    fn boxed_mutable_reused_as_a_function_name_is_unsupported() {
        use crate::tm::lower_asm::LowerError;
        // Well-typed, 0 diagnostics: the outer boxed `let mut n` (captured by `g`) shares its name with
        // the top-level `fn n`. Reference = ap(n) + g(5) = n(0) + (5 + 0) = 1 + 5 = 6.
        let src = "let mut n = 0; let g = |x| x + n; fn n(z) { z + 1 } fn ap(h) { h(0) } ap(n) + g(5)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "{src}: {ds:?}");
        let core = desugar(&prog.unwrap());
        // Sanity: a meaningful program the reference evaluates to 6.
        assert_eq!(crate::interp::eval(&core).unwrap(), crate::value::Value::Nat(6), "{src}");
        // MUST be Unsupported — not `Ok` (with a misbound `$boxh0` for the fn value-use), which would be
        // a silent miscompile (`run_tm` then diverges to HitCap while the reference is 6).
        assert!(
            matches!(defunc(&core), Err(LowerError::Unsupported { .. })),
            "a boxed mutable reused as a function name must be Unsupported (not Ok with a misbound $boxh): {src}"
        );
    }

    /// FIX 2 (Task 7 review): the SOUND inner-`let`-shadowing-a-boxed-mutable case the `boxed_names`
    /// membership keying exists for. The inner immutable `let n = 5` shadows the outer boxed `let mut
    /// n`; because `collect_mutable_names` is name-based, `n ∈ boxed_names`, so the inner `let n` is
    /// boxed to a fresh `$boxh` that shadows the outer handle exactly as `n` shadows. The closure `f`
    /// captured the OUTER box (holding 1, un-reassigned here), so `ap(f) = 0 + 1 = 1`; the inner read
    /// sees 5; `5 + 1 = 6`. `n` is never a PARAMETER, so FIX 1 must NOT reject this (only lets, not
    /// params, are boxed here).
    #[test]
    fn inner_let_shadowing_a_boxed_mutable_is_boxed_consistently() {
        let src = "let mut n = 1; fn ap(g){g(0)} let f = |x| x + n; { let n = 5; n + ap(f) }";
        let core = desugar(&parse(src).0.unwrap());
        let reference = crate::interp::eval(&core).unwrap();
        assert_eq!(reference, crate::value::Value::Nat(6));
        let d = defunc(&core).expect("inner-let shadow of a boxed mutable must still box and lower");
        assert_eq!(crate::interp::eval(&d).unwrap(), reference); // reference(P) == reference(defunc(P))
    }

    /// THE EXHAUSTIVENESS INVARIANT: every id in `defunc`'s output is either an id that existed in the
    /// input (a construct carried through) or one `defunc` declared it minted (closure-dispatch
    /// scaffolding). Nothing in between — otherwise the step survey would bill TM cost to node ids that
    /// do not exist in the user's program.
    #[test]
    fn defunc_reports_exactly_the_ids_it_minted() {
        let core = desugar(
            &parse(
                "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} map([1,2],add1)",
            )
            .0
            .unwrap(),
        );
        let before = all_node_ids(&core);
        let (out, synthetic) = defunc_mapped(&core).expect("defuncs");
        let after = all_node_ids(&out);

        // Every id in the output is either one that existed before, or one declared synthetic.
        for id in &after {
            assert!(
                before.contains(id) || synthetic.contains(id),
                "id {id} is neither original nor declared synthetic"
            );
        }
        // The declared set must not claim ids that were already there.
        for id in &synthetic {
            assert!(!before.contains(id), "id {id} declared synthetic but existed in the input");
        }
        // A higher-order program genuinely needs scaffolding, so the set must be non-empty — otherwise
        // this test would pass vacuously against a `defunc` that minted nothing.
        //
        // NOTE the direction this test does NOT constrain: it is satisfied by a `defunc` that
        // preserves NOTHING (mint every node and all three assertions still hold), and by one that
        // recycles a DROPPED input id for a scaffolding node. Preservation is pinned positively, per
        // construct, by `defunc_pins_which_constructs_keep_their_identity` below.
        assert!(!synthetic.is_empty(), "defunc of a higher-order program minted no ids");
    }

    /// THE CLASSIFICATION ITSELF, pinned per construct. `defunc_reports_exactly_the_ids_it_minted`
    /// checks only that the two buckets TOGETHER cover the output; it cannot tell whether a given
    /// node landed in the right one, so on its own it admits a pass that mints everything. These
    /// assertions name the three judgement calls the classification rests on, so flipping any of them
    /// fails the build instead of silently re-billing the two largest cost buckets of a higher-order
    /// program.
    #[test]
    fn defunc_pins_which_constructs_keep_their_identity() {
        let core = desugar(
            &parse(
                "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} map([1,2],add1)",
            )
            .0
            .unwrap(),
        );
        let letrec = |name: &'static str| {
            find_first(&core, &move |n| matches!(n, Core::LetRec { name: m, .. } if m.as_str() == name))
                .unwrap_or_else(|| panic!("the source defines `{name}`"))
        };
        let map_letrec_id = letrec("map").id();
        let add1 = letrec("add1");
        let add1_letrec_id = add1.id();
        let Core::LetRec { value, .. } = add1 else { panic!("a `fn` desugars to a LetRec") };
        let add1_lambda_id = value.id();
        // The user's higher-order call site. `f` is applied exactly once (its other occurrence,
        // `map(tail(xs), f)`, is an argument, not a callee), so this pins a unique node.
        let call_f_id = find_first(
            &core,
            &|n| matches!(n, Core::Apply(_, c, _) if matches!(c.as_ref(), Core::Var(_, v) if v == "f")),
        )
        .expect("`map` applies its `f` parameter")
        .id();

        let (out, synthetic) = defunc_mapped(&core).expect("defuncs");
        let after = all_node_ids(&out);

        // KEPT function: this IS the user's `fn map`, only with its body rewritten. `lower_asm` bills
        // a function's per-call prologue (a `Mov` per parameter) and its `Ret` to the `LetRec`, and
        // those run on EVERY call — minting here would report a recursive user function's entire
        // frame cost as defunctionalization scaffolding.
        assert!(
            after.contains(&map_letrec_id),
            "kept fn `map` lost its LetRec identity: its whole per-call frame cost would bill to scaffolding"
        );
        // CALL SITE: the user wrote a call at `f(head(xs))`. It now routes through `$apply1`, but the
        // call is still theirs — mint it and every call site the user wrote reports zero cost, with
        // 100% of a `map`-heavy program landing in scaffolding.
        assert!(
            after.contains(&call_f_id),
            "the user's higher-order call site `f(head(xs))` lost its identity: calls the user wrote would report zero cost"
        );
        // VALUE-used function: `add1` is DISSOLVED into a dispatcher arm, so its own `fn` nodes must
        // not reappear.
        //
        // SCOPE, stated so nobody over-trusts this: these two assertions pin `add1`'s `LetRec` and
        // `Lambda` ids SPECIFICALLY. They do NOT close the general hazard of a scaffolding node
        // recycling some OTHER dropped input id — the value-mention `Var(add1)` that becomes
        // `cons(tag, nil)`, or an unapplied lambda's body. Making the `cons(tag, nil)` below carry the
        // dropped `Var(add1)` id instead of minting one still passes this whole module. Closing that
        // in general means asserting over the ENTIRE scaffolding set, a much larger test than the id
        // classification needs; this is a deliberate bound, not an oversight.
        assert!(
            !after.contains(&add1_letrec_id),
            "`add1` is used as a value and dropped, so its LetRec id must not appear in the output"
        );
        assert!(
            !after.contains(&add1_lambda_id),
            "`add1` is used as a value and dropped, so its Lambda id must not appear in the output"
        );
        // SCAFFOLDING, positively declared rather than merely absent from the input: the dispatcher's
        // tag test. `is_empty` is an `Apply`, so this `Eq` is the only one in the program.
        let tag_test_id = find_first(&out, &|n| matches!(n, Core::BinOp(_, BinOp::Eq, ..)))
            .expect("`$apply1` tests the closure tag")
            .id();
        assert!(
            synthetic.contains(&tag_test_id),
            "the `$apply1` tag test is closure-dispatch scaffolding and must be DECLARED synthetic"
        );
    }

    #[test]
    fn defunc_preserves_the_id_of_a_body_it_carried_through() {
        // `add1`'s `x + 1` survives defunctionalization as the dispatcher's callee body. Its BinOp node
        // must keep its original id, or the survey would bill user arithmetic to scaffolding.
        let core = desugar(
            &parse(
                "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} map([1,2],add1)",
            )
            .0
            .unwrap(),
        );
        let add_id = find_add_binop_id(&core).expect("the source has an Add BinOp");
        let (out, _) = defunc_mapped(&core).expect("defuncs");
        assert!(all_node_ids(&out).contains(&add_id), "the user's `x + 1` lost its identity through defunc");
    }

    /// No output node id is DUPLICATED. Attributing a TM step to a node id is only meaningful if an
    /// id names one node: a duplicate would silently merge (or double-bill) two constructs' cost —
    /// the same misattribution the mapped pass exists to prevent, one level down. `defunc` INLINES
    /// bodies (a value-used function's body becomes a dispatcher arm), so duplication is a live
    /// hazard here, not a theoretical one: the day the currently-`Unsupported` "both called by name
    /// and used as a value" case is supported, that body is emitted TWICE and this test fails rather
    /// than quietly doubling the arithmetic inside it.
    #[test]
    fn no_output_node_id_is_duplicated() {
        fn count_nodes(core: &Core) -> usize {
            let mut n = 0;
            let mut stack = vec![core];
            while let Some(x) = stack.pop() {
                n += 1;
                push_children(x, &mut stack);
            }
            n
        }
        for src in [
            // A named function value (`add1`) dispatched through `$apply1`, plus a kept recursive `map`.
            "fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} map([1,2],add1)",
            // Two value fns sharing one dispatcher (two arms, two tags).
            "fn ap(f, x) { f(x) } fn add1(x) { x + 1 } fn dbl(x) { x * 2 } ap(add1, 5) + ap(dbl, 5)",
            // An anonymous lambda capturing an immutable by value.
            "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)",
            // A boxed mutable capture: `$box`/`$box_get`/`$box_set` rewrites over a `let mut`/`Assign`.
            "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)",
            // Nested value-lambdas (currying): two anon closures, one inside the other's body.
            "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
            // Two arities, so two dispatchers.
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
             fn add(a, b) { a + b }\n fn add1(x) { x + 1 }\n fold([3, 1, 2].map(add1), 0, add)",
        ] {
            let core = desugar(&parse(src).0.unwrap());
            // The premise: desugar itself hands out one id per node, so a duplicate in the output is
            // `defunc`'s doing and not inherited.
            assert_eq!(count_nodes(&core), all_node_ids(&core).len(), "INPUT has duplicate ids: {src}");
            let out = defunc(&core).expect("defuncs");
            assert_eq!(count_nodes(&out), all_node_ids(&out).len(), "OUTPUT has duplicate ids: {src}");
        }
    }
}
