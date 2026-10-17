use std::collections::HashMap;

use redextape_core::lambda::term::{LambdaTerm, Node};

/// Maximum nesting depth, memoized over the DAG the same way as `physical` in `blowup_probe.rs`. This
/// is what `MAX_TERM_DEPTH` bounds — and the point of measuring it here is that it is a DIFFERENT
/// quantity from logical size, so a term can sit far under the depth limit while its logical size is
/// astronomical.
pub(crate) fn depth(t: &LambdaTerm) -> u32 {
    let mut memo: HashMap<usize, u32> = HashMap::new();
    let mut stack: Vec<(&LambdaTerm, bool)> = vec![(t, false)];
    while let Some((n, folded)) = stack.pop() {
        let id = n.alloc_id();
        if memo.contains_key(&id) {
            continue;
        }
        if !folded {
            stack.push((n, true));
            match n.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push((b, false)),
                Node::App(f, a, _) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
            continue;
        }
        let d = match n.node() {
            Node::Var(_) => 0,
            Node::Abs(_, b) => 1 + memo.get(&b.alloc_id()).copied().unwrap_or(0),
            Node::App(f, a, _) => {
                1 + memo.get(&f.alloc_id()).copied().unwrap_or(0).max(memo.get(&a.alloc_id()).copied().unwrap_or(0))
            }
        };
        memo.insert(id, d);
    }
    memo.get(&t.alloc_id()).copied().unwrap_or(0)
}
