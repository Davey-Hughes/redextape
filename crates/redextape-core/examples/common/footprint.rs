use std::collections::HashSet;

use redextape_core::desugar::desugar;
use redextape_core::lambda::lower;
use redextape_core::lambda::term::{LambdaTerm, Node};
use redextape_core::parser::parse;

use crate::text::line;

/// Peak resident-set size recorded for this process so far, from `/proc/self/status`'s `VmHWM`
/// (kernel-maintained high-water mark, not a value this probe computes). Cumulative across the whole
/// run, not per-row — since every row runs in this same process, later rows fold in earlier ones — so
/// read consecutive rows' deltas, not each row's value in isolation.
pub(crate) fn peak_rss_kb() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for l in status.lines() {
        if let Some(rest) = l.strip_prefix("VmHWM:") {
            return rest.split_whitespace().next()?.parse().ok();
        }
    }
    None
}

/// Distinct `Rc` allocations reachable from `t` — the physical size, against which `logical_size` is
/// the denoted one.
pub(crate) fn physical(t: &LambdaTerm) -> usize {
    let mut seen: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    while let Some(n) = stack.pop() {
        if !seen.insert(n.alloc_id()) {
            continue;
        }
        match n.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a, _) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
    seen.len()
}

/// `None` when `lower` refuses, printing the error rather than aborting. Since the shared-subterm guard
/// was reverted only `TooDeep` and the two `Unsupported` cases can fire here, and none of
/// `guard_hole_probe.rs`'s sources trips them — but a ramp that panics reports nothing after the panic,
/// and that defect is exactly what took `list_reduction_probe`'s documented invocation down when the
/// guard landed.
pub(crate) fn lower_src(src: &str) -> Option<LambdaTerm> {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.expect("parses"));
    match lower(&core) {
        Ok(t) => Some(t),
        Err(e) => {
            line(&format!("  lower error: {e:?}"));
            None
        }
    }
}
