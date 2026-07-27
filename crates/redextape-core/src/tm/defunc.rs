//! Core -> Core defunctionalization (Plan 3b-1): rewrite higher-order Core into the first-order
//! subset the existing `lower_asm`/`lower_tm`/`decode` handle unchanged, or `LowerError::Unsupported`.
//!
//! A function or lambda *used as a value* (occurring anywhere other than as the immediate callee of
//! an `Apply`) becomes a closure `cons(tag, env)` on the HEAP; an `Apply` of a value becomes a call
//! to a generated per-arity `applyN` dispatcher that inlines the target bodies as its arms. The
//! output BINDERS are emitted in dependency order (callees outer of callers); a mutually recursive
//! `LetRecGroup` is ONE binder, so calls among its own members need no ordering at all — the
//! reference and `lower_asm` both bind every name in a group before evaluating any of its values. A
//! cycle between two *distinct* binders remains `Unsupported`.
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
//! Still `Unsupported` (never a silent miscompile): a builtin used as a bare value, a nested/local
//! function definition, a cyclic higher-order call graph, and (conservatively, to preserve the
//! lets-around-main emission scoping) a top-level named function whose body references an outer `let`
//! binding. A function both called-by-name and used-as-a-value IS accepted (see `Emitted`'s doc
//! comment for how it is emitted without duplicating any id) — UNLESS the emitted BINDER graph (kept
//! `fn`s and `$applyN` dispatchers, with an edge for every call and every dispatcher arm) has a CYCLE
//! that returns to that function's OWN dispatcher, however it gets there. That is the rule in full; it
//! is NOT "its body applies a value at its own arity, or calls another kept `fn` whose body does" — a
//! two-disjunct phrasing this module used to state, and which looks exhaustive but is not, because the
//! cycle can also leave through one dispatcher and re-enter through ANOTHER, of a different arity,
//! reachable through other kept `fn`s along the way. Direct (own arity, own body): `fn inc(x) { x + 1 }
//! fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)` — `t` is BOTH (`t(inc)` calls it by name,
//! `ap(t, inc)` uses it as a value), and `t`'s own body `g(3)` applies `g` (on the dispatched path, `t`
//! itself) at `t`'s own arity, closing `$apply1 -> t -> $apply1` through `t`'s own forwarding arm. Own
//! arity, via another kept `fn`: `fn ap(g, y) { g(y) } fn f(x) { x + 1 } fn q(z) { ap(f, z) } q(1) +
//! ap(q, 2)` is *also* rejected even though `q`'s own body never applies a value directly — it calls
//! `ap` by name, and `ap`'s body applies ITS OWN parameter at arity 1, closing `$apply1 -> q -> ap ->
//! $apply1` one hop further out. Neither of those shapes, and still correctly rejected: the
//! non-obvious case, measured — `fn add(a, b) { a + b } fn inc(x) { x + 1 } fn f(g) { g(1, 2) } fn
//! h(p, q) { p(q) } fn ap1(k, x) { k(x) } fn ap2(k, a, b) { k(a, b) } f(add) + h(inc, 5) + ap1(f,
//! add) + ap2(h, inc, 5)`. `f` is BOTH at arity 1 (`f(add)`, `ap1(f, add)`), but its body `g(1, 2)`
//! applies a value at arity **2**, not 1, and it calls no kept `fn` by name at all (only its own
//! parameter `g`). Reference and λ agree at 18. Yet `f`'s body still reaches `$apply2` (arity 2), one
//! of whose arms is `h` (also BOTH, value-used at arity 2 via `ap2`); `h`'s body `p(q)` applies at arity 1,
//! reaching `$apply1` — the same dispatcher `t` closes through above, and the one `f` is itself an arm
//! of. The cycle `$apply1 -> f -> $apply2 -> h -> $apply1` closes on `f`'s own dispatcher without
//! either hop looking like "applies at its own arity" or "calls another kept `fn`" — it leaves through
//! one dispatcher and comes back through a different one. `topo_order`'s cycle check catches it
//! regardless, because it walks the actual graph rather than testing for these two named shapes; only
//! the doc's claim to be exhaustive was wrong. TM/asm/native: `Unsupported { "cyclic higher-order call
//! graph through `f`" }`.

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

/// Which source binder a peeled function came from — and therefore which node re-emits it, and with
/// which id. A KEPT (name-called) function is re-emitted as exactly the `fn` it was, so it carries
/// the source id rather than a fresh one: `lower_asm` bills a function's prologue (one `Mov` per
/// parameter) and its `Ret` to the binder node, and those run on EVERY call, so minting here would
/// report a user function's whole per-call frame cost as defunctionalization scaffolding.
#[derive(Clone, Copy, Debug)]
enum Origin {
    /// A standalone `fn`: the peeled `LetRec`'s own id, re-emitted as its own `LetRec`.
    Solo(NodeId),
    /// One member of a mutually recursive `LetRecGroup`: the GROUP node's own id. Every surviving
    /// member of that group shares this id and they are re-emitted together, by the one binder that
    /// carries it — so no output node id is duplicated (see `Emitted`) and the members stay
    /// simultaneously bound, which is the whole point of the group.
    Group(NodeId),
}

/// A peeled top-level `fn name(params) { body }` — a `LetRec` whose value is a `Lambda`, or one
/// member of a `LetRecGroup` (whose values are all `Lambda`s).
struct Func<'a> {
    /// The binder this `fn` was peeled from, carrying its id (see `Origin`).
    origin: Origin,
    /// The peeled `Lambda`'s own id — a member's own, never the group's, so each member keeps its
    /// identity in the source map. A VALUE-used function is dropped (inlined into a dispatcher arm),
    /// so its ids simply do not appear in the output.
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
///   3. Step 5c's forwarding arm for a function both called-by-name AND used-as-a-value HOLDS ONE
///      `Apply` node (`f($a1..$aN)`), never a copy of the body: the function itself is emitted ONCE,
///      as a kept `fn` (step 5b), and the dispatcher arm just calls it. This was previously guaranteed
///      instead by rejecting the case outright; forwarding is what replaced that rejection without
///      weakening the invariant. Duplicating the body — the obvious alternative, which buys one fewer
///      frame on the dispatched path — would put every id inside it on two nodes, silently doubling
///      the cost billed to the user's arithmetic, so a future change that prefers duplication MUST
///      re-id one of the copies.
///
/// `no_output_node_id_is_duplicated` fails loudly if any of the three stops holding.
///
/// A binding group is the one case where several `Emitted`s share a source id (their `Origin::Group`
/// id) — and it is not an exception to the invariant, because they are re-emitted by ONE
/// `LetRecGroup` node carrying that id once. Their `Lambda` ids stay one per member.
struct Emitted {
    name: String,
    params: Vec<String>,
    body: Core,
    /// The source binder and this function's own `Lambda` id when it IS a user `fn` carried through
    /// (a kept function, see `Func`); `None` for a generated `$applyN` dispatcher, which has no
    /// source analogue at all and takes fresh ids.
    src: Option<(Origin, NodeId)>,
}

impl Emitted {
    /// The output binder that will bind this function (see `Unit`).
    fn unit(&self) -> Unit {
        match self.src {
            Some((Origin::Group(id), _)) => Unit::Group(id),
            _ => Unit::Solo(self.name.clone()),
        }
    }
}

/// One OUTPUT BINDER: a lone function's own `LetRec`, or the whole `LetRecGroup` a peeled group is
/// re-emitted as (keyed by the source group node's id).
///
/// `topo_order` orders UNITS, not names, and that is not a workaround for its cycle rejection but the
/// only shape that can be right: a group's members call one another, so ordering them individually
/// would report a cycle for exactly the construct the group exists to express — and there is nothing
/// to order between them anyway, since ONE binder binds them all simultaneously. Edges within a unit
/// are dropped for the same reason self-edges always were: the binder binds every one of its names
/// before any of its values is evaluated. Edges in and out of the group are kept, so a genuine cycle
/// through a group (a dispatcher arm that calls a member while a member calls that dispatcher) is
/// still rejected.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Unit {
    Solo(String),
    Group(NodeId),
}

impl Unit {
    /// How this unit is named in an `Unsupported` message.
    fn label(&self) -> String {
        match self {
            Unit::Solo(name) => format!("`{name}`"),
            Unit::Group(id) => format!("the binding group at node {id}"),
        }
    }
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

    // KEPT = called by name (stays a named subroutine). VALUE = used as a value (tagged, reachable
    // through a dispatcher). BOTH is both at once: a named subroutine that ALSO has a dispatcher arm,
    // and the arm FORWARDS to the subroutine rather than duplicating its body (see step 5c and
    // `Emitted`'s doc comment). Neither is dead (dropped).
    let mut kept: Vec<&Func> = Vec::new();
    let mut value_funcs: Vec<&Func> = Vec::new();
    for f in &funcs {
        let vu = value_used.contains(&f.name);
        let nc = name_called.contains(&f.name);
        match (vu, nc) {
            (true, true) => {
                kept.push(f);
                value_funcs.push(f);
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

    // 5b. Kept functions keep their binding — and their identity: re-emitted from the source `fn`'s
    // own binder and `Lambda` ids (see `Func`), since this IS that function, only with its body
    // rewritten.
    let mut emitted: Vec<Emitted> = Vec::new();
    for f in &kept {
        let locals: BTreeSet<String> = f.params.iter().cloned().collect();
        let body = rw.rewrite(f.body, &locals)?;
        emitted.push(Emitted {
            name: f.name.clone(),
            params: f.params.clone(),
            body,
            src: Some((f.origin, f.lambda_id)),
        });
    }

    // 5c. Value functions: rewrite each body into a dispatcher arm. A named value fn never captures
    // (guard 2 rejected any that references a let), so its arm carries no captures.
    //
    // A BOTH function is the exception: it is ALSO `kept`, so its body is already emitted once as a
    // named subroutine (5b). Its arm FORWARDS to that subroutine — `f($a1, .., $aN)`, with NO param
    // bindings (an empty `ArmData.params` makes `dispatcher` emit none, so `$a_i` reaches the call
    // directly). Forwarding rather than duplicating is what keeps every input id labelling exactly ONE
    // output node; see `Emitted`'s doc comment. It costs one extra frame on the DISPATCHED path only —
    // the by-name path stays a direct call — and no existing program regresses, because programs in
    // this class were rejected outright before.
    let mut arms: BTreeMap<String, ArmData> = BTreeMap::new();
    for f in &value_funcs {
        if kept_names.contains(&f.name) {
            let callee = var(rw.g, &f.name);
            let args = (1..=f.params.len()).map(|i| var(rw.g, &format!("$a{i}"))).collect();
            let body = apply(rw.g, callee, args);
            arms.insert(f.name.clone(), ArmData { params: Vec::new(), captures: Vec::new(), body });
            continue;
        }
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

    // 8. Emit in dependency order (callees outer of callers), one BINDER at a time — a lone function
    // or a whole binding group (see `Unit`); a cycle between binders is `Unsupported`.
    let order = topo_order(&emitted, main)?;

    // 9. Assemble: the function binders wrap the prelude `let`s, which wrap the rewritten main. Each
    // unit's members in `emitted` order, which for a group is source order.
    let mut members: BTreeMap<Unit, Vec<String>> = BTreeMap::new();
    let mut by_name: BTreeMap<String, Emitted> = BTreeMap::new();
    for e in emitted {
        members.entry(e.unit()).or_default().push(e.name.clone());
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
    for unit in order.iter().rev() {
        // Defensive: `order` is a permutation of the units of `emitted` (`topo_order` over exactly
        // them), so every unit has members. Degrade an internal-invariant violation to `Unsupported`
        // rather than `expect`/panic — `defunc`/`run_tm` must stay total on ANY input.
        let Some(names) = members.remove(unit) else {
            return Err(LowerError::Unsupported {
                node: main.id(),
                what: format!("ordered unit {} was emitted", unit.label()),
            });
        };
        // Each member as a `(name, Lambda)` binding, and the id for the binder around them: the source
        // `LetRec`'s / `LetRecGroup`'s own, or a fresh one for a dispatcher (which has no source
        // analogue). A carried-through user `fn` likewise keeps its own `Lambda` id. None can collide:
        // the source ids belong to a peeled node that appears nowhere else in the output, and `g` is
        // seeded past every input id. ONE node ends up carrying the binder id, however many members
        // the unit has — a group's shared `Origin::Group` id is spent exactly once, here.
        let mut binder_id: Option<NodeId> = match unit {
            Unit::Group(id) => Some(*id),
            // A lone unit whose one member carries no source origin is a generated dispatcher, which
            // mints BOTH of its ids here. Mint the binder's now, BEFORE the member loop mints the
            // lambda's, so a dispatcher's pair keeps the order it had before groups existed — this
            // loop is the only place either is minted, and every higher-order program has one.
            Unit::Solo(name) => match by_name.get(name) {
                Some(e) if e.src.is_none() => Some(g.fresh()),
                _ => None,
            },
        };
        let mut bindings: Vec<(String, Core)> = Vec::with_capacity(names.len());
        for name in &names {
            let Some(Emitted { params, body, src, .. }) = by_name.remove(name) else {
                return Err(LowerError::Unsupported {
                    node: main.id(),
                    what: format!("ordered name `{name}` was emitted"),
                });
            };
            let lambda_id = match src {
                Some((Origin::Solo(letrec_id), lam_id)) => {
                    binder_id = Some(letrec_id);
                    lam_id
                }
                Some((Origin::Group(_), lam_id)) => lam_id,
                None => g.fresh(),
            };
            bindings.push((name.clone(), Core::Lambda(lambda_id, params, Box::new(body))));
        }
        let binder_id = match binder_id {
            Some(id) => id,
            None => g.fresh(),
        };
        acc = match bindings.len() {
            // Cannot happen (a unit exists only because a member was emitted into it); folding it
            // away keeps this total.
            0 => acc,
            // ONE member — a lone `fn`, or a group all but one of whose members were inlined into a
            // dispatcher arm. Either way `LetRec` already binds its own name in its own value, and
            // `LetRecGroup` is built only for a genuine group of two or more (see `Core::LetRecGroup`).
            1 => match bindings.pop() {
                Some((name, lam)) => Core::LetRec { id: binder_id, name, value: Box::new(lam), body: Box::new(acc) },
                None => acc, // unreachable: the length was just checked
            },
            _ => Core::LetRecGroup(binder_id, bindings, Box::new(acc)),
        };
    }
    Ok((acc, g.minted))
}

/// Defunctionalize `core`. Exactly `defunc_mapped` with the synthetic-id set discarded — ONE
/// implementation, so the two cannot drift.
pub fn defunc(core: &Core) -> Result<Core, LowerError> {
    defunc_mapped(core).map(|(c, _)| c)
}

/// Peel the outermost prelude chain of `let name = value` value-bindings,
/// `LetRec { name, Lambda(params, body), .. }` (`fn`) definitions and `LetRecGroup` binding groups, in
/// whatever order they interleave; the first non-such node is the main tail expression. A `LetRec` (or
/// group member) whose value is not a `Lambda` is `Unsupported`.
///
/// A group contributes EVERY member as its own `Func` — they are ordinary top-level functions to the
/// rest of the pass (classified, rewritten and possibly inlined one by one); all that distinguishes
/// them is the `Origin::Group` that re-assembles the survivors under one binder at the end.
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
                    origin: Origin::Solo(*id),
                    lambda_id: *lam_id,
                    name: name.clone(),
                    params: params.clone(),
                    body: lam_body,
                });
                cur = body;
            }
            Core::LetRecGroup(id, bindings, body) => {
                for (name, value) in bindings {
                    // Every value must be a `Lambda` (`desugar` builds a group only out of `fn`s, but
                    // `Core` is public and this must stay total either way) — same rejection as the
                    // `LetRec` arm above, named per member.
                    let Core::Lambda(lam_id, params, lam_body) = value else {
                        return Err(unsupported(value, format!("group binding `{name}` is not a function")));
                    };
                    funcs.push(Func {
                        origin: Origin::Group(*id),
                        lambda_id: *lam_id,
                        name: name.clone(),
                        params: params.clone(),
                        body: lam_body,
                    });
                }
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
        Core::LetRecGroup(_, bindings, body) => {
            let mut inner = locals.clone();
            inner.extend(bindings.iter().map(|(name, _)| name.clone()));
            for (_, value) in bindings {
                analyze(value, funcs, &inner, value_used, name_called);
            }
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
            // Only a NESTED binder reaches the rewriter: `peel` takes the whole top-level prelude
            // chain, `LetRecGroup` included, and hands the rewriter only the bodies and main.
            Core::LetRec { .. } => Err(unsupported(node, "nested function definition".to_string())),
            Core::LetRecGroup(..) => {
                Err(unsupported(node, "nested mutually recursive function definition".to_string()))
            }
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
        if locals.contains(name) {
            return Ok(Core::Var(id, name.to_string())); // a local value
        }
        // The `tags` check MUST run before the literal-`nil` fallback below: `nil` is just an
        // ordinary identifier in this language (not a keyword — see `prelude.rs`'s module doc), so a
        // user `fn nil` used as a value SHADOWS the empty list exactly the way the reference
        // interpreter's frame lookup shadows it (a `LetRecGroup` frame nearer than the prelude
        // frame). Checking `name == "nil"` first would resolve every value-use of a user `fn nil` to
        // the empty list instead of its closure — the bug this reorder closes (measured: TM `HitCap`
        // where reference and λ both agree on a value).
        if let Some(&tag) = self.tags.get(name) {
            // A closed named function-value: `cons(tag, $nil)` (a named value fn never captures — guard
            // 2 rejects one that would).
            let t = nat(self.g, tag);
            let n = nil_scaffold(self.g);
            return Ok(cons(self.g, t, n));
        }
        if name == "nil" {
            return Ok(Core::Var(id, name.to_string())); // the empty list
        }
        if self.kept.contains(name) {
            // A kept function in a value position. A BOTH function never reaches here — it is also
            // tagged, and the `tags` check above fires first, yielding `cons(tag, $nil)`. So this is a
            // kept-ONLY function, which by definition is not value-used; reaching it means the
            // classification and the rewrite disagree. Guard rather than build a tagless closure.
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

        // Build the closure at the creation site: `cons(tag, cons(c1, cons(c2, … $nil)))`. Each captured
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
    // The default is unreachable for well-typed programs; `$head($nil)` faults on every backend, so a
    // bad tag never silently returns a value.
    let n = nil_scaffold(g);
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

/// A DFS post-order of the emitted BINDERS (`Unit`s: a lone function, or a whole binding group) with
/// edges caller -> callee, so a callee is emitted outer of (before) every caller. A call WITHIN a unit
/// — self-recursion, or one group member calling another — is ignored, since the binder binds every
/// one of its names before any of its values is evaluated. Any other cycle is `Unsupported`.
fn topo_order(emitted: &[Emitted], main: &Core) -> Result<Vec<Unit>, LowerError> {
    let names: BTreeSet<String> = emitted.iter().map(|e| e.name.clone()).collect();
    let unit_of: BTreeMap<String, Unit> = emitted.iter().map(|e| (e.name.clone(), e.unit())).collect();
    let mut edges: BTreeMap<Unit, BTreeSet<Unit>> = BTreeMap::new();
    for e in emitted {
        let mut callees = BTreeSet::new();
        collect_calls(&e.body, &names, &mut callees, 0)?;
        let from = e.unit();
        // A unit's out-edges are the union of its members' — one group member's callee is a callee of
        // the whole group, since they are emitted together.
        let out = edges.entry(from.clone()).or_default();
        for callee in &callees {
            // A callee with no unit cannot happen (`callees` ⊆ `names`, and every name has one);
            // skipping it rather than indexing keeps this total.
            if let Some(u) = unit_of.get(callee)
                && *u != from
            {
                out.insert(u.clone());
            }
        }
    }

    let mut order = Vec::new();
    let mut done: BTreeSet<Unit> = BTreeSet::new();
    let mut on_stack: BTreeSet<Unit> = BTreeSet::new();
    for e in emitted {
        visit(&e.unit(), &edges, &mut done, &mut on_stack, &mut order, main, 0)?;
    }
    Ok(order)
}

/// `depth` is the number of `visit` frames currently on the native stack (the call-graph DAG depth
/// among emitted binders, i.e. #binders in the worst case) -- guarded defense-in-depth alongside
/// the up-front `too_deep_node` check on `core`'s own nesting (see `MAX_DEFUNC_DEPTH`).
#[allow(clippy::too_many_arguments)]
fn visit(
    unit: &Unit,
    edges: &BTreeMap<Unit, BTreeSet<Unit>>,
    done: &mut BTreeSet<Unit>,
    on_stack: &mut BTreeSet<Unit>,
    order: &mut Vec<Unit>,
    site: &Core,
    depth: u32,
) -> Result<(), LowerError> {
    if depth > MAX_DEFUNC_DEPTH {
        return Err(LowerError::TooDeep { node: site.id() });
    }
    if done.contains(unit) {
        return Ok(());
    }
    if !on_stack.insert(unit.clone()) {
        return Err(unsupported(site, format!("cyclic higher-order call graph through {}", unit.label())));
    }
    // `.get` rather than `edges[unit]`: every unit does have an entry (they are built over exactly
    // these units), but indexing PANICS if that ever stops holding, and this pass must stay total.
    for callee in edges.get(unit).into_iter().flatten() {
        visit(callee, edges, done, on_stack, order, site, depth + 1)?;
    }
    on_stack.remove(unit);
    done.insert(unit.clone());
    order.push(unit.clone());
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
        Core::LetRecGroup(_, bindings, body) => {
            for (_, value) in bindings {
                collect_calls(value, targets, out, depth + 1)?;
            }
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
        Core::LetRecGroup(_, bindings, body) => {
            let mut inner = BTreeSet::new();
            for (_, value) in bindings {
                fv_into(value, &mut inner);
            }
            fv_into(body, &mut inner);
            for (name, _) in bindings {
                inner.remove(name);
            }
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
    // `$cons`, not `cons`: this builds the closure representation itself, so a user `fn cons` must
    // never be able to capture it. `$` is rejected by the lexer in an identifier, so no user
    // binding can ever collide with this name — the same holds for its three siblings, `$head`/
    // `$tail`/`$nil` (see `prelude.rs`'s `runtime_env` doc comment, which enumerates all four, and
    // `lower_asm.rs`).
    let c = var(g, "$cons");
    apply(g, c, vec![head, tail])
}

fn head1(g: &mut SynthGen, list: Core) -> Core {
    // `$head`, not `head`: this is the dispatcher's tag test (and its default-arm/nil sentinel), so
    // a user `fn head` must never be able to capture it. Uncapturable for the same reason as `$cons`
    // above.
    let h = var(g, "$head");
    apply(g, h, vec![list])
}

fn tail1(g: &mut SynthGen, list: Core) -> Core {
    // `$tail`, not `tail`: this unpacks a closure's env when a dispatcher arm binds captures, so a
    // user `fn tail` must never be able to capture it. Uncapturable for the same reason as `$cons`
    // above.
    let t = var(g, "$tail");
    apply(g, t, vec![list])
}

/// The uncapturable empty-list scaffolding term. Every call site builds SCAFFOLDING with it — the
/// closed-function-value closure's env (`rewrite_value_name`'s `tags` arm), the dispatcher's
/// default/fault arm (an out-of-range tag `$head`s this and faults), and the env-list terminator
/// (`build_env`) — never a stand-in for a genuine user reference to the empty list, which
/// `rewrite_value_name` handles separately (its own `name == "nil"` arm, resolving the bare name).
fn nil_scaffold(g: &mut SynthGen) -> Core {
    // `$nil`, not `nil`: a user `fn nil` (or any other binding named `nil`) must never be able to
    // capture this. Uncapturable for the same reason as `$cons`/`$head`/`$tail` above.
    var(g, "$nil")
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

/// `cons(c1, cons(c2, … $nil))` of the captured names as plain `Var`s (each in scope at the creation
/// site). Empty captures → `$nil` (a closed closure's env), matching the pre-Task-4 `cons(tag, $nil)`.
fn build_env(g: &mut SynthGen, captures: &[String]) -> Core {
    let mut env = nil_scaffold(g);
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
        Core::LetRecGroup(_, bindings, body) => {
            for (_, value) in bindings {
                stack.push(value);
            }
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

    /// Every `Apply` in `core` whose callee is `Var(callee)`, by the same iterative walk the rest of
    /// this module uses (a big list literal desugars to a spine deep enough to overflow a recursive one).
    fn count_calls_to(core: &Core, callee: &str) -> usize {
        let mut n = 0;
        let mut stack = vec![core];
        while let Some(node) = stack.pop() {
            if let Core::Apply(_, f, _) = node
                && let Core::Var(_, name) = f.as_ref()
                && name == callee
            {
                n += 1;
            }
            push_children(node, &mut stack);
        }
        n
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
                matches!(run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS), TmRun::Ran { .. } | TmRun::LowerError(_)),
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

    /// A `fn` both CALLED BY NAME and USED AS A VALUE. Non-commutative at arity 2 (`sub`, not `add`):
    /// a forwarder that swapped `$a1`/`$a2` computes a plausible wrong answer, so a commutative
    /// fixture would pass while the pass was broken. 5 + 7 = 12; swapped, 5 + 0 = 5.
    #[test]
    fn both_called_by_name_and_used_as_a_value() {
        defunc_preserves_and_lowers("fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)");
    }

    /// A BOTH function's by-name call must stay a DIRECT call, not go through the dispatcher.
    /// `rewrite_apply` tests `is_static` before its dispatch branch, which is what makes this hold —
    /// and if a refactor ever swaps that order every answer stays correct and only gets slower, which
    /// no oracle leg can see. Hence a structural assertion.
    ///
    /// In this program the ONLY value-application is `g(a, b)` inside `ap2`, so exactly one `$apply2`
    /// call site may exist. Routing `sub(9, 4)` through dispatch would make it two.
    #[test]
    fn a_both_functions_by_name_call_stays_direct() {
        let src = "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)";
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "{ds:?}");
        let core = desugar(&prog.unwrap());
        let d = defunc(&core).expect("defunc succeeds");
        assert_eq!(
            count_calls_to(&d, &dispatcher_name(2)),
            1,
            "exactly one $apply2 site (`g(a, b)` in `ap2`); the by-name `sub(9, 4)` must not dispatch"
        );
        // Two direct calls to `sub`: the user's `sub(9, 4)` and the dispatcher arm's forwarder.
        assert_eq!(count_calls_to(&d, "sub"), 2, "the by-name call plus the forwarding arm");
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

        // The BOTH class's ONE remaining exception. A BOTH function's arm forwards to it, giving
        // `$applyN` an edge to `f`; if `f`'s body applies a value at the SAME arity N, that closes
        // `$applyN -> t -> $applyN`. This is the PRE-EXISTING cycle rule (see the two cases below),
        // not a new restriction — and dispatching at a DIFFERENT arity is fine, which is why the
        // `map`-passed-as-a-value demo works. Lifting it means emitting the dispatcher and the BOTH
        // function as one `LetRecGroup`, which is a change to `topo_order`'s unit model.
        rejects(
            "fn inc(x) { x + 1 } fn t(g) { g(3) } fn ap(h, y) { h(y) } t(inc) + ap(t, inc)",
            "cyclic higher-order call graph",
        );

        // WHY THE FORWARDING ARM NEVER BINDS CAPTURES. A dispatcher arm that forwards lets the callee
        // resolve its own free names LEXICALLY, ignoring the closure env — which is correct only if a
        // top-level `fn` cannot capture. It cannot: guard 2 rejects any peeled `fn` whose body reads a
        // prelude `let`, and it runs BEFORE the step-3 partition, so the BOTH variant is rejected for
        // the same reason the value-only variant at the top of this test is. If guard 2 is ever
        // relaxed, this line fails and the forwarder must start binding captures from the env.
        rejects("let n = 5; fn f(x) { x + n } fn ap(g, x) { g(x) } f(1) + ap(f, 1)", "references an outer let binding");

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

        // The half of the `Unit` rule that was deliberately NOT relaxed. `topo_order` drops edges
        // *within* a binder (a group's members call each other freely, since `lower_asm` binds every
        // name in the group before lowering any body) but KEEPS every edge in and out of one, so a
        // cycle running THROUGH a group is still rejected: `b` is value-used, so its body becomes an
        // `$apply1` arm that calls `a` by name, giving group{a,b} -> `ap` -> `$apply1` -> group{a,b}.
        rejects(
            "fn ap(f, x) { f(x) } fn a(n) { if n == 0 { 0 } else { ap(b, n - 1) } } \
             fn b(n) { if n == 0 { 1 } else { a(n - 1) } } a(4)",
            "cyclic higher-order call graph",
        );

        // A nested/local function definition, reached (its enclosing fn must be called, or it's dead
        // code and silently dropped rather than rewritten — see the report for that false start).
        rejects("fn outer(x) { fn inner(y) { y + 1 } inner(x) } outer(5)", "nested function definition");

        // A nested/local mutually recursive GROUP, same boundary one variant over: `peel` takes the
        // top-level prelude chain (groups included), so only a group INSIDE a body reaches the
        // rewriter, and a local definition is as unsupported for a group as for a lone `fn`.
        rejects(
            "fn outer(x) { fn a(n) { if n == 0 { 0 } else { b(n - 1) } } fn b(n) { a(n) + 1 } a(x) } outer(3)",
            "nested mutually recursive function definition",
        );
    }

    /// The dispatcher's fault arm (`$head($nil)`), not `Unsupported`, is how a partial-application /
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
        match run_tm(&core, &Unary::default(), TM_DEFAULT_CAPS) {
            TmRun::Ran { tapes } => assert_eq!(
                decode_tape(&tapes, &reference, &Unary::default()),
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
        // `cons(tag, $nil)`, or an unapplied lambda's body. Making the `cons(tag, $nil)` below carry the
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

    /// A mutually recursive binding group survives defunctionalization: `ev`/`od` are BOTH mutually
    /// recursive AND higher-order (they take a continuation `k` and apply it), so `lower_asm` alone
    /// reports `Unsupported` and the real pipeline routes the program through `defunc` — exactly the
    /// shape that reaches this pass.
    ///
    /// The two members contribute DIFFERENT arithmetic PER LEVEL (`+ 2` in `ev`, `+ 5` in `od`), not
    /// just different base constants: with `ev(4, id) == 1 + 5 + 2 + 5 + 2 == 15`, binding either
    /// body to the other's name gives 20, so a name<->body swap FAILS here instead of passing by
    /// symmetry (a constant-only difference can cancel out). Verified by mutation, see the task-6
    /// report.
    #[test]
    fn a_binding_group_survives_defunctionalization() {
        let src = "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) + 2 } } \
                   fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) + 5 } } \
                   fn id(x){ x } ev(4, id)";
        let core = crate::desugar::desugar(&crate::parser::parse(src).0.unwrap());
        // The premise: this program really is beyond the first-order backend on its own.
        assert!(
            matches!(crate::tm::lower_asm(&core), Err(LowerError::Unsupported { .. })),
            "the test program must be higher-order enough that `lower_asm` alone rejects it"
        );
        let out = defunc(&core).expect("a binding group must defunctionalize");
        let prog = crate::tm::lower_asm(&out).expect("and then lower");
        let expected = crate::run(src).unwrap();
        assert_eq!(expected, crate::value::Value::Nat(15), "the members' per-level arithmetic must differ");
        match crate::tm::run_asm(&prog, crate::tm::DEFAULT_CAPS) {
            crate::tm::AsmRun::Ran(o) => assert_eq!(crate::tm::decode_asm(&o, &expected), Some(expected)),
            other => panic!("did not run: {other:?}"),
        }

        // Structurally: the group comes out a GROUP — both members under ONE binder, in source
        // order, and that binder carries the SOURCE group node's own id (the source map's claim that
        // a construct the user wrote keeps its identity through the pass). A nested chain would bind
        // whichever member came second too late for the first one's body.
        let is_group = |c: &Core| matches!(c, Core::LetRecGroup(..));
        let src_id = find_first(&core, &is_group).map(Core::id).expect("the source has a group");
        match find_first(&out, &is_group) {
            Some(Core::LetRecGroup(id, bindings, _)) => {
                let names: Vec<&str> = bindings.iter().map(|(n, _)| n.as_str()).collect();
                assert_eq!(names, ["ev", "od"], "both members, in source order, under one binder");
                assert_eq!(*id, src_id, "the re-emitted group must keep the source group's id");
            }
            _ => panic!("defunc must re-emit the group as ONE LetRecGroup:\n{out:?}"),
        }
        // And each member keeps its OWN `Lambda` id (never the group's, never a fresh one).
        let member_lambda_ids: Vec<NodeId> = match find_first(&core, &is_group) {
            Some(Core::LetRecGroup(_, bindings, _)) => bindings.iter().map(|(_, v)| v.id()).collect(),
            _ => Vec::new(),
        };
        let out_ids = all_node_ids(&out);
        for id in member_lambda_ids {
            assert!(out_ids.contains(&id), "member lambda {id} lost its identity through defunc");
        }
    }

    /// THREE members, not two: a group is a `Vec` of bindings, and two is the one length where
    /// "swap" and "reverse" and "rotate" are the same mistake. `p`/`q`/`r` each add a different
    /// amount per level (`+ 2`, `+ 5`, `+ 11`) over different bases (1, 0, 7). Reference == defunc'd,
    /// and the output lowers first-order.
    ///
    /// **`p(4, id)`, not `p(5, id)` — the ARGUMENT is what makes a permutation visible, not the
    /// constants.** A rotation permutes *which* constant lands at *which* level; when the walk
    /// consumes a whole number of laps, the multiset of constants summed — and the base body finally
    /// reached — are both unchanged, so the answer is identical. Measured over all six pairings:
    ///
    /// | pairing | `p(4, id)` | `p(5, id)` |
    /// |---|---:|---:|
    /// | correct | **20** | **32** |
    /// | rotate | 24 | **32** ← invisible |
    /// | rotate the other way | 51 | 62 |
    /// | swap first two | 32 | 44 |
    /// | swap last two | 27 | 35 |
    /// | swap outer two | 51 | 62 |
    ///
    /// At `p(5, id)` one of the two rotations returns **exactly the correct answer**, so this test
    /// stayed green under the n-ary-only mispairing it exists to catch — only the rotation that
    /// degenerates into a self-loop showed, which is the one Task 6 happened to try. At `p(4, id)`
    /// every non-identity pairing differs.
    #[test]
    fn a_three_member_group_defuncs_and_agrees() {
        defunc_preserves_and_lowers(
            "fn p(n,k){ if n == 0 { k(1) } else { q(n - 1, k) + 2 } }\n\
             fn q(n,k){ if n == 0 { k(0) } else { r(n - 1, k) + 5 } }\n\
             fn r(n,k){ if n == 0 { k(7) } else { p(n - 1, k) + 11 } }\n\
             fn id(x){ x }\n p(4, id)",
        );
    }

    /// No output node id is DUPLICATED. Attributing a TM step to a node id is only meaningful if an
    /// id names one node: a duplicate would silently merge (or double-bill) two constructs' cost —
    /// the same misattribution the mapped pass exists to prevent, one level down. `defunc` INLINES
    /// bodies (a value-used function's body becomes a dispatcher arm), so duplication is a live
    /// hazard here, not a theoretical one. The corpus below includes a function both called-by-name
    /// and used-as-a-value (`sub`/`ap2`); it passes because that function's dispatcher arm FORWARDS to
    /// the kept subroutine (`sub($a1, $a2)`) rather than inlining a second copy of its body. If a
    /// future change ever switched that arm back to duplicating the body, THIS is the test that would
    /// fail — with a duplicate id, not by silently doubling the arithmetic inside it.
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
            // A mutually recursive binding group: its members SHARE one source id (`Origin::Group`),
            // spent on exactly ONE `LetRecGroup` node in the output. The one case where a shared
            // source id is by design is also the one where duplicating it would go unnoticed.
            "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) + 2 } } \
             fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) + 5 } } fn id(x){ x } ev(4, id)",
            // Two arities, so two dispatchers.
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
             fn add(a, b) { a + b }\n fn add1(x) { x + 1 }\n fold([3, 1, 2].map(add1), 0, add)",
            // The BOTH case: `sub` is called by name (`sub(9, 4)`) AND used as a value (`ap2(sub, ..)`),
            // so it is kept AND has a dispatcher arm. This is what makes item 3 of `Emitted`'s invariant
            // (see its doc comment) actually guarded — without this entry, nothing in this corpus
            // exercises the forwarding arm's id behaviour at all.
            "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
        ] {
            let core = desugar(&parse(src).0.unwrap());
            // The premise: desugar itself hands out one id per node, so a duplicate in the output is
            // `defunc`'s doing and not inherited.
            assert_eq!(count_nodes(&core), all_node_ids(&core).len(), "INPUT has duplicate ids: {src}");
            let out = defunc(&core).expect("defuncs");
            assert_eq!(count_nodes(&out), all_node_ids(&out).len(), "OUTPUT has duplicate ids: {src}");
        }
    }

    /// A user `fn` named after a list builtin must not capture `defunc`'s own scaffolding. Before the
    /// `$`-alias fix this MISCOMPILED SILENTLY: `lower_asm` resolves a bound function before the
    /// builtin table, so the dispatcher's synthesized `head($clos)` tag test resolved to the user's
    /// `head`. Measured at 3246742: reference 5, λ 5, TM 3.
    #[test]
    fn a_user_fn_named_like_a_builtin_does_not_capture_scaffolding() {
        for src in [
            "fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",
            "fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)",
            "fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)",
            // NOT `"fn tail(x) { x + 1 } fn ap(g, x) { g(x) } tail(1) + ap(tail, 2)"`: that program is
            // VACUOUS for the same reason `defunc_synthesizes_no_unaliased_builtin_call` was — `tail`
            // there is a NAMED value-fn, which never captures, so `tail1()` (the helper that only fires
            // to unpack a dispatched closure's non-empty env) is never invoked and a reverted
            // `$tail`->`tail` regression would pass unnoticed. This entry adds a capturing value-lambda
            // (`|y| y + n`) at the SAME arity alongside the shadowing `fn tail`, so its dispatcher arm
            // actually calls `tail1()` while a real top-level `tail` binder exists to collide with.
            "let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)",
        ] {
            defunc_preserves_and_lowers(src);
        }
    }

    /// Decides (by test, not by reasoning) whether `$cons`/`$head`/`$tail` belong in `BUILTIN_FNS`.
    /// `is_builtin_fn` is consulted at exactly two call sites, both while re-`rewrite`ing the INPUT
    /// `core` (`rewrite_apply`'s `is_static` and `rewrite_value_name`'s builtin-as-value rejection) —
    /// never on defunc's own synthesized output, which the `cons`/`head1`/`tail1` helpers build
    /// directly, bypassing `rewrite`/`rewrite_apply` entirely. Since `$` is rejected by the lexer, no
    /// real user program can ever contain a `$`-prefixed `Var`, so this path is unreachable from
    /// source. The only way to even exercise it is a hand-built `Core` (the `$`-name idiom from
    /// `lower_asm.rs`'s `dollar_aliases_match_their_bare_builtins`) — so build the one input shape at
    /// EACH call site where membership would matter, and confirm `defunc` rejects it safely (a
    /// `LowerError::Unsupported` naming it a "free variable"/"unbound", never a panic and never a
    /// silent accept) with `$cons`/`$head`/`$tail` absent from `BUILTIN_FNS`. That is the demonstration
    /// that leaving them out changes nothing reachable, so they are NOT added.
    #[test]
    fn dollar_aliases_are_not_needed_in_builtin_fns() {
        // Site 1 (`rewrite_value_name`): `$head` as a bare VALUE argument to a kept function.
        // `fn ap(f) { f(1) } ap($head)`, hand-built since `$` cannot appear in a source string.
        let mut g = NodeGen::default();
        let f_body =
            Core::Apply(g.fresh(), Box::new(Core::Var(g.fresh(), "f".to_string())), vec![Core::Nat(g.fresh(), 1)]);
        let ap_value = Core::Lambda(g.fresh(), vec!["f".to_string()], Box::new(f_body));
        let main = Core::Apply(
            g.fresh(),
            Box::new(Core::Var(g.fresh(), "ap".to_string())),
            vec![Core::Var(g.fresh(), "$head".to_string())],
        );
        let core =
            Core::LetRec { id: g.fresh(), name: "ap".to_string(), value: Box::new(ap_value), body: Box::new(main) };
        match defunc(&core) {
            Err(LowerError::Unsupported { what, .. }) => {
                assert!(
                    what.contains("free variable") && what.contains("$head"),
                    "expected a `free variable` rejection naming `$head`, got: {what}"
                );
            }
            other => panic!("expected Unsupported, got: {other:?}"),
        }

        // Site 2 (`rewrite_apply`'s `is_static`): `$head` applied directly as a callee.
        // `$head(1)` at the top level, hand-built for the same reason.
        let mut g2 = NodeGen::default();
        let core2 = Core::Apply(
            g2.fresh(),
            Box::new(Core::Var(g2.fresh(), "$head".to_string())),
            vec![Core::Nat(g2.fresh(), 1)],
        );
        match defunc(&core2) {
            Err(LowerError::Unsupported { what, .. }) => {
                assert!(
                    what.contains("unbound") && what.contains("$head"),
                    "expected an `unbound` rejection naming `$head`, got: {what}"
                );
            }
            other => panic!("expected Unsupported, got: {other:?}"),
        }
    }

    /// `is_empty` deliberately has NO `$` alias: `defunc` never synthesizes it, and an unused alias is
    /// a name that later drifts out of sync with the thing it aliases. If a future change starts
    /// synthesizing `is_empty`, this fails and points at the decision instead of silently
    /// reintroducing the capture bug this slice fixed.
    #[test]
    fn defunc_synthesizes_no_unaliased_builtin_call() {
        for src in [
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn add1(x) { x + 1 }\n\
             [3, 1, 2].map(add1)",
            // `tail1()` (the helper that emits a bare/aliased call to `tail`) only fires when a
            // DISPATCHED closure has a non-empty env to unpack (see `dispatcher`'s capture-unpacking
            // loop) — a NAMED value-fn like `add1` above never captures, so the demo above alone never
            // reaches it, and a mutation of `tail1` to emit any other name stays invisible. A capturing
            // value-lambda dispatched through `$apply1` (`|y| y + n`, closing over `n`) forces the arm
            // to actually bind from `$env`, so this entry is what makes the check below cover all
            // three helpers (`cons1`/`head1`/`tail1`) rather than just two of them.
            "let n = 7; fn ap(g, x) { g(x) } ap(|y| y + n, 5)",
        ] {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "{ds:?}");
            let core = desugar(&prog.unwrap());
            let (d, synthetic) = defunc_mapped(&core).expect("defunc succeeds");
            // Every `Apply` of a bare list-builtin name in the output must come from a node the USER
            // wrote (not in `synthetic`). A synthesized one would be capturable.
            let mut stack = vec![&d];
            while let Some(node) = stack.pop() {
                if let Core::Apply(id, callee, _) = node
                    && let Core::Var(_, name) = callee.as_ref()
                    && matches!(name.as_str(), "cons" | "head" | "tail" | "is_empty")
                {
                    assert!(!synthetic.contains(id), "synthesized call to bare `{name}` at {id} is capturable");
                }
                // `nil` is a VALUE, not a call — the same hazard shows up as a bare `Var`, not an
                // `Apply` callee, so it gets its own check rather than being silently uncovered by the
                // one above (this is the check that would have caught the `$nil` gap this test's
                // sibling demos in `three_way_oracle.rs` were added to close).
                if let Core::Var(id, name) = node
                    && name == "nil"
                {
                    assert!(!synthetic.contains(id), "synthesized bare `nil` at {id} is capturable");
                }
                push_children(node, &mut stack);
            }
        }
    }
}
