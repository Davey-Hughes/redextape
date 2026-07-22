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
    /// Evaluate `first` for effect (discard its value), then evaluate `then` for the result.
    Seq(NodeId, Box<Core>, Box<Core>),
    /// `name = value` — evaluates to the internal unit value.
    Assign(NodeId, String, Box<Core>),
    /// `while cond { body }` — evaluates to the internal unit value.
    While(NodeId, Box<Core>, Box<Core>),
}

impl Core {
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
            | Core::While(id, ..) => *id,
            Core::Let { id, .. } | Core::LetRec { id, .. } => *id,
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
        Core::BinOp(_, _, a, b) => {
            stack.push(*std::mem::replace(a, Box::new(Core::Nat(0, 0))));
            stack.push(*std::mem::replace(b, Box::new(Core::Nat(0, 0))));
        }
        Core::Seq(_, a, b) | Core::While(_, a, b) => {
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
        // Truly childless leaves.
        Core::Nat(..) | Core::Bool(..) | Core::Unit(..) | Core::Var(..) => {}
    }
}

/// Monotonic `NodeId` source. Every desugar run uses a fresh one starting at 0.
#[derive(Default)]
pub struct NodeGen {
    next: NodeId,
}

impl NodeGen {
    pub fn fresh(&mut self) -> NodeId {
        let id = self.next;
        self.next += 1;
        id
    }
}
