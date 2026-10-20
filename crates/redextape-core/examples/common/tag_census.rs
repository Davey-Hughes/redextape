use std::collections::HashSet;

use redextape_core::lambda::{LambdaTerm, Node};

/// The four programs to contrast: two loop programs (`while4`, `countdown4`) against two from the
/// recursive family, which `2026-08-10-region-path-tagging-design.md` calls "already well covered" in the
/// same sentence that calls the loop programs "an order of magnitude worse". `sum5` and `map_fold` are
/// copied VERBATIM from `owner_probe.rs`'s `programs()`, so `owner_probe.rs` and `none_probe.rs` run the
/// same source strings.
pub(crate) fn programs() -> Vec<(&'static str, &'static str)> {
    vec![
        ("while4", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
        (
            "countdown4",
            "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
        ),
        ("sum5", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
        (
            "map_fold",
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
             fn add(a, b) { a + b }\n\
             fn add1(x) { x + 1 }\n\
             fold([3, 1, 2].map(add1), 0, add)",
        ),
    ]
}

/// Number of DISTINCT allocations reachable from `t` that are a tagged `App` (`owner().is_some()`).
/// **Physical, not logical** — deduped by `alloc_id` over an explicit worklist, the same convention
/// `term.rs`'s `max_shared_logical_size` uses for exactly this reason: under structural sharing a term
/// can denote an astronomical logical tree from a small number of allocations, so a walk that revisits
/// shared subterms would be the hang `none_probe.rs`'s module doc warns about, not a measurement of one.
///
/// Iterative over an explicit stack, never recursive — a walk added to a probe whose whole reason to
/// exist is capped-memory safety must not itself risk a native stack overflow on a deep term.
pub(crate) fn count_tagged_apps(t: &LambdaTerm) -> u64 {
    let mut seen: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    let mut count = 0u64;
    while let Some(node) = stack.pop() {
        if !seen.insert(node.alloc_id()) {
            continue; // already visited this allocation; do not recount or re-walk its children
        }
        match node.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a, _) => {
                if node.owner().is_some() {
                    count += 1;
                }
                stack.push(f);
                stack.push(a);
            }
        }
    }
    count
}

pub(crate) fn fmt_pct(n: u64, of: u64) -> String {
    if of == 0 { "-".to_string() } else { format!("{:.1}%", 100.0 * n as f64 / of as f64) }
}
