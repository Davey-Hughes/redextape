//! `LambdaTree` and `LambdaCheckpoints`, held to the reducer and the printer at every step of a corpus.
//!
//! Each property is checked against an INDEPENDENT authority rather than against a second reading of
//! the builder: the next redex against the path the cursor's next step records, the contractum
//! against `last_redex`, the names against the printer's own output, the shape against the term, and
//! a replayed cursor against one stepped directly from step 0.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::BTreeMap;

use redextape_core::analysis::TokenClass;
use redextape_core::core::NodeId;
use redextape_core::lambda::term::logical_size;
use redextape_core::lambda::{self, Dir, LambdaTerm, MAX_REDUCTION_STEPS, Node, Path, print_lambda_mapped};
use redextape_core::parser;
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{EncodingKind, MIN_FIELD_WIDTH};
use redextape_core::trace::{LambdaCheckpoints, LambdaCursor};
use redextape_core::viewmodel::tree::{KIND_ABS, KIND_APP, KIND_VAR, NO_LINK};
use redextape_core::viewmodel::{LambdaTree, TreeAnswer};

/// Programs spread across the shapes that matter here: arithmetic on numerals, lists, a loop, direct
/// and mutual recursion, and higher-order functions.
const CORPUS: &[(&str, &str)] = &[
    ("sample", "let x = 40; x + 2"),
    ("list2", "[1, 2]"),
    ("while4", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
    ("sum5", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
    ("fact3", "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)"),
    (
        "is_even6",
        "fn is_even(n) { if n == 0 { true } else { is_odd(n - 1) } } \
         fn is_odd(n) { if n == 0 { false } else { is_even(n - 1) } } is_even(6)",
    ),
    (
        "map_fold",
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
         fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
         fn add(a, b) { a + b }\n\
         fn add1(x) { x + 1 }\n\
         fold([3, 1, 2].map(add1), 0, add)",
    ),
];

/// The lowered term and the map whose `node_to_lambda` paths are coordinates into it.
fn lowered(src: &str) -> (LambdaTerm, SourceMap) {
    let (program, diagnostics) = parser::parse(src);
    assert!(diagnostics.is_empty(), "{src}: {diagnostics:?}");
    let program = program.expect("a clean fixture parses");
    let (core, map) = SourceMap::build_from_program(&program, &*EncodingKind::Unary.at(MIN_FIELD_WIDTH));
    (lambda::lower(&core).expect("every corpus program lowers"), map)
}

fn tree_of(term: &LambdaTerm, contractum: Option<&Path>, links: &BTreeMap<NodeId, Path>) -> LambdaTree {
    match LambdaTree::build(term, contractum, links, usize::MAX) {
        TreeAnswer::Tree(t) => t,
        TreeAnswer::Refused { nodes } => panic!("an unreachable budget refused a {nodes}-node term"),
    }
}

/// The node a path names, following the tree's own columns.
fn resolve(tree: &LambdaTree, path: &Path) -> Option<u32> {
    let mut at = 0u32;
    for d in path {
        let kind = tree.kind[at as usize];
        at = match (d, kind) {
            (Dir::AppL, KIND_APP) | (Dir::AbsBody, KIND_ABS) => tree.left[at as usize],
            (Dir::AppR, KIND_APP) => tree.right[at as usize],
            _ => return None,
        };
    }
    Some(at)
}

/// Every step's cursor, from step 0 to the end of the run.
fn every_step(term: &LambdaTerm) -> Vec<LambdaCursor> {
    let mut c = LambdaCursor::new(term, MAX_REDUCTION_STEPS);
    let mut out = vec![c.clone()];
    while c.next().is_some() {
        out.push(c.clone());
    }
    out
}

#[test]
fn the_next_redex_is_the_one_the_next_step_contracts() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        let steps = every_step(&term);
        for (k, c) in steps.iter().enumerate() {
            let tree = tree_of(c.term(), c.last_redex(), &BTreeMap::new());
            let expected =
                steps.get(k + 1).map(|next| resolve(&tree, next.last_redex().expect("a step records its redex")));
            assert_eq!(
                tree.next_redex,
                expected.map(|n| n.expect("the next step's redex path resolves in this step's tree")),
                "{name} step {k}"
            );
        }
    }
}

#[test]
fn the_contractum_is_where_the_last_step_left_its_result() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        for (k, c) in every_step(&term).iter().enumerate() {
            let tree = tree_of(c.term(), c.last_redex(), &BTreeMap::new());
            let expected = c.last_redex().map(|p| resolve(&tree, p).expect("the contractum path resolves"));
            assert_eq!(tree.contractum, expected, "{name} step {k}");
            assert_eq!(tree.contractum.is_some(), k > 0, "{name} step {k}: a contractum exists exactly after a step");
        }
    }
}

/// The printer writes a binder's name, then its body; a function, then its argument — pre-order. So
/// the names it prints, in order, are the tree's `Abs` and `Var` names in index order.
#[test]
fn the_names_are_the_printers_names() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        for (k, c) in every_step(&term).iter().enumerate() {
            let tree = tree_of(c.term(), None, &BTreeMap::new());
            let (text, spans) = print_lambda_mapped(c.term());
            let printed: Vec<&str> = spans
                .iter()
                .filter(|(_, class)| matches!(class, TokenClass::Binder | TokenClass::Ident))
                .map(|(span, _)| &text[span.start..span.end])
                .filter(|s| *s != "\u{3bb}")
                .collect();
            let ours: Vec<&str> = (0..tree.kind.len())
                .filter(|&i| tree.kind[i] != KIND_APP)
                .map(|i| tree.names[tree.name[i] as usize].as_str())
                .collect();
            assert_eq!(ours, printed, "{name} step {k}");
        }
    }
}

/// One entry per occurrence, children after their parent, and the same shape as the term.
#[test]
fn the_tree_is_the_terms_shape_in_pre_order() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        for (k, c) in every_step(&term).iter().enumerate() {
            let tree = tree_of(c.term(), None, &BTreeMap::new());
            assert_eq!(tree.kind.len() as u64, logical_size(c.term()), "{name} step {k}: one entry per occurrence");
            let mut work: Vec<(u32, &LambdaTerm)> = vec![(0, c.term())];
            while let Some((i, t)) = work.pop() {
                let at = i as usize;
                match t.node() {
                    Node::Var(ix) => {
                        assert_eq!((tree.kind[at], tree.left[at]), (KIND_VAR, *ix), "{name} step {k} node {i}");
                    }
                    Node::Abs(hint, body) => {
                        assert_eq!(tree.kind[at], KIND_ABS, "{name} step {k} node {i}");
                        assert_eq!(tree.names[tree.hint[at] as usize], hint.as_ref(), "{name} step {k} node {i}");
                        assert!(tree.left[at] > i, "{name} step {k}: a body comes after its binder");
                        work.push((tree.left[at], body));
                    }
                    Node::App(f, a, _) => {
                        assert_eq!(tree.kind[at], KIND_APP, "{name} step {k} node {i}");
                        assert!(tree.left[at] > i && tree.right[at] > tree.left[at], "{name} step {k}: pre-order");
                        work.push((tree.left[at], f));
                        work.push((tree.right[at], a));
                    }
                }
            }
        }
    }
}

#[test]
fn a_replayed_cursor_is_the_cursor_stepped_directly() {
    for (name, src) in CORPUS {
        let (term, _) = lowered(src);
        let steps = every_step(&term);
        // A small interval, so most steps are rebuilt by replay rather than read off a checkpoint.
        let mut live = LambdaCursor::new(&term, MAX_REDUCTION_STEPS);
        let mut marks = LambdaCheckpoints::new(&live, 7);
        while live.next().is_some() {
            marks.observe(&live);
        }
        for (k, direct) in steps.iter().enumerate() {
            let replayed = marks.at(k as u64).expect("a step the run reached can be rebuilt");
            assert_eq!(replayed.steps_taken(), k as u64, "{name} step {k}");
            assert!(replayed.term() == direct.term(), "{name} step {k}: the terms differ");
            assert_eq!(replayed.last_redex(), direct.last_redex(), "{name} step {k}");
        }
        assert!(marks.at(steps.len() as u64).is_none(), "{name}: a step past the end is not rebuilt");
    }
}

/// At step 0 a construct's `node_to_lambda` path carries its id — the smaller id where two share a
/// path — and every other `App` carries its own owner tag.
#[test]
fn step_zero_links_every_construct_the_map_places() {
    for (name, src) in CORPUS {
        let (term, map) = lowered(src);
        let tree = tree_of(&term, None, &map.node_to_lambda);
        let mut first: BTreeMap<&Path, NodeId> = BTreeMap::new();
        for (id, path) in &map.node_to_lambda {
            first.entry(path).or_insert(*id);
        }
        for (path, id) in &first {
            let at = resolve(&tree, path).expect("a map path resolves in the step-0 tree");
            assert_eq!(tree.link[at as usize], *id, "{name}: the node at {path:?}");
        }
        let without = tree_of(&term, None, &BTreeMap::new());
        let mut work: Vec<(u32, &LambdaTerm)> = vec![(0, &term)];
        while let Some((i, t)) = work.pop() {
            match t.node() {
                Node::Var(_) => assert_eq!(without.link[i as usize], NO_LINK, "{name}: a variable carries no tag"),
                Node::Abs(_, body) => {
                    assert_eq!(without.link[i as usize], NO_LINK, "{name}: an abstraction carries no tag");
                    work.push((without.left[i as usize], body));
                }
                Node::App(f, a, owner) => {
                    assert_eq!(without.link[i as usize], owner.unwrap_or(NO_LINK), "{name}: node {i}");
                    work.push((without.left[i as usize], f));
                    work.push((without.right[i as usize], a));
                }
            }
        }
    }
}

/// `saved_steps()` is the only place a missed or a doubled checkpoint would show: `at` rebuilds by
/// replay from whichever checkpoint is nearest either way, so no test that compares its answers can
/// tell a dense save from a sparse one, or a single save from a repeated one. This drives a cursor
/// through several intervals, calling `observe` after every step — including a second call at a step
/// already on a boundary, so a repeat observation's failure to double-save is checked too — and reads
/// `saved_steps()` back against the exact multiples of `every` it should hold, in order, none skipped
/// and none repeated.
#[test]
fn saved_steps_holds_exactly_one_checkpoint_per_interval() {
    let (term, _) = lowered("fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)");
    let every = 8u64;
    let steps_to_take = every * 5; // well over one interval
    let mut c = LambdaCursor::new(&term, MAX_REDUCTION_STEPS);
    let mut marks = LambdaCheckpoints::new(&c, every);
    for _ in 0..steps_to_take {
        assert!(c.next().is_some(), "fact(3) must still be running");
        marks.observe(&c);
        if c.steps_taken().is_multiple_of(every) {
            marks.observe(&c); // a repeat at the same step must not duplicate its checkpoint
        }
    }
    let expected: Vec<u64> = (0..=steps_to_take).step_by(every as usize).collect();
    assert_eq!(marks.saved_steps(), expected);
}

#[test]
fn the_budget_refuses_one_node_short_and_admits_exactly_enough() {
    let (term, _) = lowered("fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)");
    let size = logical_size(&term);
    let n = usize::try_from(size).unwrap();
    assert_eq!(LambdaTree::build(&term, None, &BTreeMap::new(), n - 1), TreeAnswer::Refused { nodes: size });
    assert!(matches!(LambdaTree::build(&term, None, &BTreeMap::new(), n), TreeAnswer::Tree(t) if t.kind.len() == n));
}
