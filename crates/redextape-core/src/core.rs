//! The Core AST — the minimal, desugared IR that is the synchronization anchor (spec §5.4). Both
//! backends read this tree; every node carries a stable `NodeId` used as the source-map key.

/// Stable identifier for a Core node (the source-map / sync anchor key).
pub type NodeId = u32;

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

#[derive(Clone, Debug)]
pub enum Core {
    Nat(NodeId, u64),
    Bool(NodeId, bool),
    /// The internal unit value — the result of a tail-less block (used only for its statements'
    /// effects). Never written by the user; the typechecker keeps it out of value positions.
    /// Distinct from `Nat(_, 0)` so the oracle's observable result is unambiguous.
    Unit(NodeId),
    Var(NodeId, String),
    BinOp(NodeId, BinOp, Box<Core>, Box<Core>),
    If(NodeId, Box<Core>, Box<Core>, Box<Core>),
    /// n-ary abstraction `|p0, p1, ...| body`.
    Lambda(NodeId, Vec<String>, Box<Core>),
    /// n-ary application `callee(a0, a1, ...)`.
    Apply(NodeId, Box<Core>, Vec<Core>),
    /// Non-recursive binding: `let name = value in body`. `mutable` drives backend lowering
    /// (tape cell / store-passing) — the interpreter treats every binding as a mutable slot.
    Let {
        id: NodeId,
        name: String,
        mutable: bool,
        value: Box<Core>,
        body: Box<Core>,
    },
    /// Recursive binding (from `fn`): `letrec name = value in body`; `value` is always a Lambda.
    LetRec {
        id: NodeId,
        name: String,
        value: Box<Core>,
        body: Box<Core>,
    },
    /// Mutually recursive bindings: `letrec f1 = v1 and … and fn = vn in body`. Every value is a
    /// `Lambda`, and every name is in scope in every value AND in the body.
    ///
    /// Constructed only for a genuine group (n >= 2) — a single recursive binding stays `LetRec`, so
    /// existing programs lower identically and the step-count goldens do not move.
    LetRecGroup(NodeId, Vec<(String, Core)>, Box<Core>),
    /// Evaluate `first` for effect (discard its value), then evaluate `then` for the result.
    Seq(NodeId, Box<Core>, Box<Core>),
    /// `name = value` — evaluates to the internal unit value.
    Assign(NodeId, String, Box<Core>),
    /// `while cond { body }` — evaluates to the internal unit value.
    While(NodeId, Box<Core>, Box<Core>),
}

impl Core {
    #[must_use]
    pub fn id(&self) -> NodeId {
        match self {
            Core::Nat(id, _)
            | Core::Bool(id, _)
            | Core::Unit(id)
            | Core::Var(id, _)
            | Core::BinOp(id, ..)
            | Core::If(id, ..)
            | Core::Lambda(id, ..)
            | Core::Apply(id, ..)
            | Core::Seq(id, ..)
            | Core::Assign(id, ..)
            | Core::While(id, ..)
            | Core::Let { id, .. }
            | Core::LetRec { id, .. }
            | Core::LetRecGroup(id, ..) => *id,
        }
    }

    /// Visit each direct child once. NON-RECURSIVE by contract: `Core` carries a hand-written
    /// iterative `Drop` precisely because a big list literal or long statement sequence desugars to a
    /// spine tens of thousands of nodes deep, and recursive traversal of that spine aborts the process
    /// with an uncatchable stack overflow. A caller walks the tree with its own explicit worklist (see
    /// `all_ids` in `tests/sourcemap_coverage.rs`); this method must never call itself.
    pub fn for_each_child<'a>(&'a self, f: &mut impl FnMut(&'a Core)) {
        match self {
            Core::Nat(..) | Core::Bool(..) | Core::Unit(..) | Core::Var(..) => {}
            Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
                f(a);
                f(b);
            }
            Core::If(_, c, t, e) => {
                f(c);
                f(t);
                f(e);
            }
            Core::Lambda(_, _, body) | Core::Assign(_, _, body) => f(body),
            Core::Apply(_, callee, args) => {
                f(callee);
                for a in args {
                    f(a);
                }
            }
            Core::Let { value, body, .. } | Core::LetRec { value, body, .. } => {
                f(value);
                f(body);
            }
            Core::LetRecGroup(_, bindings, body) => {
                for (_, value) in bindings {
                    f(value);
                }
                f(body);
            }
        }
    }
}

/// Hand-written iterative destructor. `Core` is a recursively-owned tree (`Box<Core>` / `Vec<Core>`
/// children), and a big list literal or long statement sequence desugars to a spine tens of
/// thousands of nodes deep. The compiler-generated recursive `drop_in_place` would recurse once per
/// level and abort the process with a stack overflow (SIGABRT — uncatchable) when that spine is
/// dropped in `run`/`analyze`. Instead we unlink every owned child into an explicit heap worklist
/// and drain it, so teardown uses bounded stack regardless of tree depth.
impl Drop for Core {
    fn drop(&mut self) {
        let mut stack: Vec<Core> = Vec::new();
        take_core_children(self, &mut stack);
        while let Some(mut node) = stack.pop() {
            take_core_children(&mut node, &mut stack);
            // `node` is now childless, so its own (re-entrant) drop here is shallow.
        }
    }
}

/// Move every owned `Core` child of `n` into `stack`, leaving a trivial childless leaf
/// (`Core::Nat(0, 0)`) behind so `n`'s subsequent drop does not recurse into the moved-out subtree.
fn take_core_children(n: &mut Core, stack: &mut Vec<Core>) {
    match n {
        // Same grouping `for_each_child` above uses: all three have exactly two `Box<Core>` children
        // in the same positions, so the teardown is identical — and if one of them ever grows a third
        // child, this `|`-pattern stops compiling rather than silently under-draining it.
        Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
            stack.push(*std::mem::replace(a, Box::new(Core::Nat(0, 0))));
            stack.push(*std::mem::replace(b, Box::new(Core::Nat(0, 0))));
        }
        Core::If(_, a, b, c) => {
            stack.push(*std::mem::replace(a, Box::new(Core::Nat(0, 0))));
            stack.push(*std::mem::replace(b, Box::new(Core::Nat(0, 0))));
            stack.push(*std::mem::replace(c, Box::new(Core::Nat(0, 0))));
        }
        Core::Lambda(_, _, b) | Core::Assign(_, _, b) => {
            stack.push(*std::mem::replace(b, Box::new(Core::Nat(0, 0))));
        }
        Core::Apply(_, f, args) => {
            stack.push(*std::mem::replace(f, Box::new(Core::Nat(0, 0))));
            stack.extend(std::mem::take(args));
        }
        Core::Let { value, body, .. } | Core::LetRec { value, body, .. } => {
            stack.push(*std::mem::replace(value, Box::new(Core::Nat(0, 0))));
            stack.push(*std::mem::replace(body, Box::new(Core::Nat(0, 0))));
        }
        Core::LetRecGroup(_, bindings, body) => {
            // Every binding's value is an unboxed `Core` in the vec (not a `Box<Core>`), so draining
            // the vec moves each one directly onto the worklist — no placeholder needed for them (the
            // vec itself becomes empty, which is already childless). The body is still `Box<Core>`, so
            // it gets the usual placeholder swap.
            for (_, value) in std::mem::take(bindings) {
                stack.push(value);
            }
            stack.push(*std::mem::replace(body, Box::new(Core::Nat(0, 0))));
        }
        // Truly childless leaves.
        Core::Nat(..) | Core::Bool(..) | Core::Unit(..) | Core::Var(..) => {}
    }
}

/// The largest `NodeId` `NodeGen` will issue. Reaching it stops issuance rather than wrapping.
///
/// **THE VALUE IS CHOSEN AGAINST `i32`, NOT AGAINST MEMORY.** It is below `i32::MAX`
/// (2,147,483,647), which is what makes `viewmodel::LinkIndex::build`'s `i32::try_from(node)`
/// provably succeed instead of merely usually succeeding: the `tm_owner` leg crosses to JavaScript as
/// an `Int32Array`, and a `NodeId` past `2^31` would go negative under the cast — landing on `-1` for
/// the one id that turns it exactly, and so becoming indistinguishable from "this state has no
/// owner", or on some other negative value that `web/src/link.ts`'s `nodeForState` collapses to the
/// same `null`.
///
/// It is **12,500x** the largest `NodeId` measured from source: 80,000, at 80,002 tokens, from a
/// `1 + 1 + ...` chain. `desugar` has no depth guard of its own, so `parser::MAX_TOKENS` (100,000) is
/// what bounds real issuance — roughly one id per token. No memory argument justifies a tighter
/// number: a `Core` tree of 10^9 nodes is impossible at >= 40 bytes a node, so this ceiling exists to
/// bound the COUNTER, not the tree.
///
/// See `docs/superpowers/specs/2026-08-11-count-bounds-design.md` §4.3.
pub const MAX_NODE_ID: NodeId = 1_000_000_000;

/// Monotonic `NodeId` source. Every desugar run uses a fresh one starting at 0.
#[derive(Default)]
pub struct NodeGen {
    next: NodeId,
    exhausted: bool,
}

impl NodeGen {
    /// A generator whose first `fresh()` returns `next`. Used by synthetic passes (e.g. `defunc`)
    /// that mint new nodes and must not collide with an existing tree's ids: seed past its max id.
    ///
    /// **CLAMPED TO `MAX_NODE_ID`, because this is the door the wrap was actually reachable
    /// through.** A `Core` tree of 4.29 billion nodes cannot be built — `MAX_TOKENS` holds real
    /// issuance to ~100,000 — but `seeded` is `pub` and takes an arbitrary `u32`, so
    /// `seeded(u32::MAX)` plus one `fresh()` reached the wrap from outside this module. A seed past
    /// the ceiling has already lost ids, so the generator reports `exhausted()` immediately rather
    /// than pretending the clamp was free.
    #[must_use]
    pub fn seeded(next: NodeId) -> Self {
        NodeGen { next: next.min(MAX_NODE_ID), exhausted: next > MAX_NODE_ID }
    }

    /// Whether issuance has reached `MAX_NODE_ID`.
    ///
    /// Once true, every `fresh()` returns `MAX_NODE_ID` again, so ids are no longer unique and
    /// anything keyed by `NodeId` — all three legs of `SourceMap` — would collide on that one id.
    #[must_use]
    pub fn exhausted(&self) -> bool {
        self.exhausted
    }

    /// Issue the next id. **SATURATES AT `MAX_NODE_ID` rather than wrapping.**
    ///
    /// This was a bare `self.next += 1`, which wraps silently in release (the workspace's only
    /// `[profile]` setting is dev debug info, so no debug assertion catches it) and re-issues id 0 to
    /// whatever mints next — colliding with the root of the tree and every early node, in the map the
    /// UI resolves clicks through.
    ///
    /// **SATURATION STILL REPEATS AN ID, and that is the honest trade rather than an oversight.** One
    /// known repeated id at a documented ceiling beats a silent restart at 0 that collides with the
    /// nodes most likely to be clicked. Making this fallible is the only fully correct fix — no id
    /// ever issued twice — and it ripples through ~15 call sites and `desugar`'s own return type,
    /// which cannot express refusal; `panic`/`expect`/`unwrap` are denied in library code
    /// (`clippy.toml`), so aborting is not available either. `exhausted()` is how a caller that cares
    /// finds out.
    ///
    /// **THE GAP `LinkIndex::build` CITED IS NOW CLOSED AT THE SOURCE.** Its `NodeId -> i32` cast
    /// refused because "nothing bounds how many a `Core` tree can mint (`NodeGen::fresh` is a bare
    /// counter)". Something does now, and `MAX_NODE_ID < i32::MAX`, so that cast provably succeeds.
    /// The refusal stays as defence in depth — see its own doc.
    pub fn fresh(&mut self) -> NodeId {
        let id = self.next;
        if self.next >= MAX_NODE_ID {
            self.exhausted = true;
        } else {
            self.next += 1;
        }
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// THE WRAP THIS CLOSES. `seeded(u32::MAX)` used to reach it in one call: `fresh()` returned
    /// `u32::MAX` and left `next` at 0, so the NEXT id collided with the root of whatever tree was
    /// being built — silently, in release, in the map the UI resolves clicks through.
    #[test]
    fn a_seed_past_the_ceiling_never_recycles_id_zero() {
        let mut g = NodeGen::seeded(NodeId::MAX);
        assert!(g.exhausted(), "a seed past MAX_NODE_ID has already lost ids, and says so");

        let first = g.fresh();
        let second = g.fresh();
        assert_eq!(first, MAX_NODE_ID, "clamped to the ceiling, not left at u32::MAX");
        assert_eq!(second, MAX_NODE_ID, "saturates rather than wrapping");
        assert_ne!(second, 0, "the wrap this guards against re-issued id 0");
    }

    /// THE POINT OF THE SPECIFIC VALUE. `viewmodel::LinkIndex::build` casts `NodeId -> i32` for the
    /// `tm_owner` leg (an `Int32Array` crossing to JavaScript). The ceiling sitting under `i32::MAX`
    /// is what turns that cast from "usually succeeds" into "provably succeeds", so the RELATION is
    /// what is pinned — not the literal, which may be tuned.
    #[test]
    fn every_issuable_node_id_fits_i32() {
        assert!(i32::try_from(MAX_NODE_ID).is_ok(), "MAX_NODE_ID must fit i32 for LinkIndex::build");
        let mut g = NodeGen::seeded(MAX_NODE_ID);
        assert!(i32::try_from(g.fresh()).is_ok(), "even the last id issuable must fit");
    }

    /// Ordinary issuance is untouched: consecutive, from zero, not exhausted. The guard must be
    /// invisible to every real tree — the largest `NodeId` measured from source is 80,000.
    #[test]
    fn fresh_still_issues_consecutive_ids_from_zero() {
        let mut g = NodeGen::default();
        assert_eq!((g.fresh(), g.fresh(), g.fresh()), (0, 1, 2));
        assert!(!g.exhausted());

        // `seeded` below the ceiling is unchanged too — the `defunc` use, seeding past a tree's max id.
        let mut s = NodeGen::seeded(500);
        assert_eq!((s.fresh(), s.fresh()), (500, 501));
        assert!(!s.exhausted());
    }
}
