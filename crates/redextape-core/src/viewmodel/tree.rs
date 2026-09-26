//! The λ term as a laid-out view needs it: every node, in pre-order, with the names the printer would
//! give it, the construct it links to, and where the next redex and the last contractum sit.
//!
//! **PRE-ORDER, NOT POST-ORDER.** `nodes[0]` is the root and a node's children come after it, which
//! is the order the printer writes a term in: a renderer walking indices upward walks the text left
//! to right. It is also the order in which the first `App` whose function is an `Abs` is the
//! leftmost-outermost redex, so the walk that builds the arena finds the next redex without a second
//! traversal (spec amendment 3).
//!
//! **COLUMNS, NOT A VEC OF ENUMS**, because this crosses the wasm boundary as typed arrays (the
//! `linkIndex` precedent in `redextape-wasm`'s `lib.rs`): one buffer per column, not one JS object
//! per node.

use std::collections::BTreeMap;

use crate::core::NodeId;
use crate::lambda::{Dir, LambdaTerm, Node, Path};

/// `kind[i]` for a variable.
pub const KIND_VAR: u8 = 0;
/// `kind[i]` for an abstraction.
pub const KIND_ABS: u8 = 1;
/// `kind[i]` for an application.
pub const KIND_APP: u8 = 2;
/// `link[i]` for a node that links to no construct. `NodeId` is bounded by `core::MAX_NODE_ID`, far
/// below this, so the sentinel cannot collide with a real id.
pub const NO_LINK: u32 = u32::MAX;

/// A term as parallel columns indexed by node, in pre-order. See the module doc.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LambdaTree {
    /// `KIND_VAR`, `KIND_ABS` or `KIND_APP`.
    pub kind: Vec<u8>,
    /// A `Var`'s de Bruijn index; an `Abs`'s body; an `App`'s function.
    pub left: Vec<u32>,
    /// An `App`'s argument; `0` for the other two kinds.
    pub right: Vec<u32>,
    /// An index into `names`: an `Abs`'s display name, or a `Var`'s — its binder's display name, or
    /// `?i` for a free variable, exactly as the printer writes it. `0` for an `App`.
    pub name: Vec<u32>,
    /// An index into `names`: an `Abs`'s raw hint, before freshening. `0` for the other two kinds.
    pub hint: Vec<u32>,
    /// The construct this node links to, or `NO_LINK`.
    pub link: Vec<u32>,
    /// Every distinct string `name` and `hint` index, each once.
    pub names: Vec<String>,
    /// The leftmost-outermost redex — the `App` the next step contracts — or `None` in normal form.
    pub next_redex: Option<u32>,
    /// The subterm the step that produced this term left at its redex's path, or `None` at step 0.
    pub contractum: Option<u32>,
}

/// What `LambdaTree::build` answers: a whole tree, or the term's size when it exceeds the budget.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TreeAnswer {
    Tree(LambdaTree),
    /// The term's logical size, one per occurrence — the number the budget was compared against.
    Refused {
        nodes: u64,
    },
}

/// One unit of the builder's explicit stack.
enum Work<'a> {
    /// Visit `t` as the child of `parent` in direction `dir`, at `depth` edges below the root.
    Enter { t: &'a LambdaTerm, parent: u32, dir: Option<Dir>, depth: usize },
    /// Leave an `Abs`: its binder's display name, `names[name]`, goes out of scope.
    Leave { name: u32 },
}

impl LambdaTree {
    /// Build the tree of `term`, or refuse when it has more than `node_budget` nodes.
    ///
    /// `contractum` is the path `LambdaCursor::last_redex` reports for this term. `links` maps a
    /// construct to a path into THIS term — `SourceMap::node_to_lambda`, and only at step 0, where its
    /// paths are coordinates into the term being built; any other step passes an empty map. A path
    /// named by two constructs links to the smaller id, `print_lambda_linked`'s rule.
    ///
    /// ITERATIVE, over an explicit stack: a term can be deeper than a native recursive walk survives.
    #[must_use]
    pub fn build(
        term: &LambdaTerm,
        contractum: Option<&Path>,
        links: &BTreeMap<NodeId, Path>,
        node_budget: usize,
    ) -> TreeAnswer {
        let mut by_path: BTreeMap<&Path, NodeId> = BTreeMap::new();
        for (id, path) in links {
            by_path.entry(path).or_insert(*id);
        }
        let mut b = Builder::default();
        // THE DISPLAY NAMES IN SCOPE, innermost last: a `Var` names its binder by indexing this.
        let mut scope: Vec<u32> = Vec::new();
        let mut path: Path = Vec::new();
        let mut work = vec![Work::Enter { t: term, parent: u32::MAX, dir: None, depth: 0 }];
        while let Some(item) = work.pop() {
            let (t, parent, dir, depth) = match item {
                Work::Leave { name } => {
                    scope.pop();
                    b.leave(name);
                    continue;
                }
                Work::Enter { t, parent, dir, depth } => (t, parent, dir, depth),
            };
            if b.tree.kind.len() >= node_budget {
                return TreeAnswer::Refused { nodes: crate::lambda::term::logical_size(term) };
            }
            path.truncate(depth.saturating_sub(1));
            if let Some(d) = dir {
                path.push(d);
            }
            let Ok(me) = u32::try_from(b.tree.kind.len()) else {
                return TreeAnswer::Refused { nodes: crate::lambda::term::logical_size(term) };
            };
            // `get_mut`, never `[]`: `parent` is always an index this walk already pushed, but a library
            // path does not index where it can ask.
            let column = match dir {
                Some(Dir::AppR) => Some(&mut b.tree.right),
                Some(Dir::AppL | Dir::AbsBody) => Some(&mut b.tree.left),
                None => None,
            };
            if let Some(slot) = column.and_then(|c| c.get_mut(parent as usize)) {
                *slot = me;
            }
            let tag = match t.node() {
                Node::App(_, _, owner) => *owner,
                _ => None,
            };
            b.tree.link.push(by_path.get(&path).copied().or(tag).unwrap_or(NO_LINK));
            if contractum.is_some_and(|c| *c == path) {
                b.tree.contractum = Some(me);
            }
            match t.node() {
                Node::Var(i) => {
                    let name = scope
                        .len()
                        .checked_sub(1 + *i as usize)
                        .and_then(|k| scope.get(k).copied())
                        .unwrap_or_else(|| b.intern(&format!("?{i}")));
                    b.push(KIND_VAR, *i, name, 0);
                }
                Node::Abs(hint, body) => {
                    let display = crate::lambda::syntax::fresh_by(hint, scope.len(), |s| b.in_scope(s));
                    let name = b.intern(&display);
                    let raw = b.intern(hint);
                    b.push(KIND_ABS, 0, name, raw);
                    scope.push(name);
                    b.enter(name);
                    work.push(Work::Leave { name });
                    work.push(Work::Enter { t: body, parent: me, dir: Some(Dir::AbsBody), depth: depth + 1 });
                }
                Node::App(f, a, _) => {
                    if b.tree.next_redex.is_none() && matches!(f.node(), Node::Abs(..)) {
                        b.tree.next_redex = Some(me);
                    }
                    b.push(KIND_APP, 0, 0, 0);
                    work.push(Work::Enter { t: a, parent: me, dir: Some(Dir::AppR), depth: depth + 1 });
                    work.push(Work::Enter { t: f, parent: me, dir: Some(Dir::AppL), depth: depth + 1 });
                }
            }
        }
        TreeAnswer::Tree(b.tree)
    }
}

/// The tree under construction, the index of every string already interned, and which names are in
/// scope.
#[derive(Default)]
struct Builder {
    tree: LambdaTree,
    interned: BTreeMap<String, u32>,
    /// `shown[i]` is how many binders around the node being built show `names[i]`: the names in scope as
    /// a multiset, so `fresh_by` asks about a name in one lookup rather than a scan of the scope. A COUNT
    /// RATHER THAN A FLAG, so it stays right without leaning on `fresh_by` never choosing a name already in
    /// scope.
    shown: Vec<u32>,
}

impl Builder {
    fn push(&mut self, kind: u8, left: u32, name: u32, hint: u32) {
        self.tree.kind.push(kind);
        self.tree.left.push(left);
        self.tree.right.push(0);
        self.tree.name.push(name);
        self.tree.hint.push(hint);
    }

    /// Whether a binder around the node being built shows `s`. A name never interned was never shown.
    fn in_scope(&self, s: &str) -> bool {
        self.interned.get(s).and_then(|&i| self.shown.get(i as usize)).is_some_and(|&n| n > 0)
    }

    /// `names[name]` comes into scope.
    fn enter(&mut self, name: u32) {
        let i = name as usize;
        if self.shown.len() <= i {
            self.shown.resize(i + 1, 0);
        }
        if let Some(n) = self.shown.get_mut(i) {
            *n += 1;
        }
    }

    /// `names[name]` goes out of scope.
    fn leave(&mut self, name: u32) {
        if let Some(n) = self.shown.get_mut(name as usize) {
            *n = n.saturating_sub(1);
        }
    }

    /// The index of `s` in `names`, adding it on first sight. Names are few — a term's distinct binder
    /// names — so the table stays small however large the term is.
    fn intern(&mut self, s: &str) -> u32 {
        if let Some(&i) = self.interned.get(s) {
            return i;
        }
        // `names` holds at most one entry per distinct string in a tree already under `node_budget`,
        // so it cannot outgrow `u32` before `kind` does; saturating keeps this total without a panic.
        let i = u32::try_from(self.tree.names.len()).unwrap_or(u32::MAX);
        self.tree.names.push(s.to_string());
        self.interned.insert(s.to_string(), i);
        i
    }
}
