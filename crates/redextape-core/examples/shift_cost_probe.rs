//! The instrument for the `maxfree` short-circuit and the stored `depth`: **it identified `shift` as
//! the blow-up's cash register and then `depth_exceeds` as what was left, and it is the re-runnable
//! source for every figure those changes are justified by.**
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --example shift_cost_probe
//! ```
//!
//! **The cap is not decoration and `MemorySwapMax=0` is the load-bearing half.** This ramps a family
//! built to blow up. An earlier measurement over the same family took 60 GiB of RAM and 29 GiB of swap
//! and wedged the machine; the cap alone lets the kernel thrash instead of failing, which is what makes
//! a box unusable rather than merely killing a process. An OOM-kill or a timeout here is a RESULT to
//! report, not something to work around by raising the cap.
//!
//! The reduction sections drive `trace::LambdaCursor`, which holds ONE term at a time. **Never
//! `reduce_trace` on anything this file builds** — it materialises every step's term by contract, and
//! that is precisely how the 60 GiB run happened. Rows are flushed BEFORE the next is computed, so an
//! OOM-kill leaves the completed rows on stdout instead of losing the table.
//!
//! # WHAT IT FOUND
//!
//! The record said the next slice was a per-redex work budget, and that `lower_group`'s duplication
//! was worth re-examining first because "fixing the root cause may remove the need for a guard at
//! all". It does. The root cause was not `lower_group`, which only writes the promise:
//!
//! **`shift` cashed it.** `term.rs`'s `shift` rebuilt every node it visited, unconditionally — no memo
//! by allocation, and no check for whether any free index was actually in range. Two consequences, and
//! the second is the one that hangs:
//!
//!   1. It was Θ(LOGICAL), not Θ(physical) — it walked the denoted tree rather than the DAG.
//!   2. It DESTROYED SHARING: `shift(App(c, c))` recursed twice and built two separate copies of `c`.
//!
//! `blowup_probe.rs` had already recorded (2) as a finding without naming it as a cause — "a β-step's
//! output aliases nothing, and the within-term ratio is exactly 1.00x after ≥6 steps from starting
//! ratios up to 114x". The compact term was never small; `shift` is what made the reducer keep the
//! promise.
//!
//! The fix is a single comparison at the top of `shift` and of `subst`, reading a `maxfree` the three
//! constructors maintain in O(1): `shift(d, cutoff, t)` is the identity exactly when
//! `maxfree(t) <= cutoff`, and `subst(j, s, t)` is exactly when `maxfree(t) <= j`. Returning `t.clone()`
//! in those cases preserves the ALLOCATION, which is the half that matters — the rebuilt copy was
//! always structurally equal, so `==` never noticed and the cost stayed invisible.
//!
//! # AND THEN `depth_exceeds` WAS 96% OF WHAT REMAINED
//!
//! With `shift` fixed, the reduction ramp still doubled per level — and the second measurement found
//! that almost none of that was reduction. `reduce.rs`'s `depth_exceeds` walked the LOGICAL expansion
//! once per β-step, the same bug class one function over. Sampled 1-in-200 against a memoized
//! equivalent, verdicts identical on every sample:
//!
//! ```text
//! level   steps   logical_depth   memo_depth   speedup
//!     7  107379          11.630       25.110      0.5x
//!     9  106493          46.863       23.527      2.0x
//!    11  105607         187.599       23.824      7.9x
//! ```
//!
//! **187.6 s of level 11's 195.7 s was the depth guard.** Memoizing is not the answer, and the level-7
//! row is why: a `HashMap` per call is a net LOSS on the small terms the ordinary corpus reduces (that
//! flat ~24 s is per-call allocation overhead, not walking). `depth` is instead carried on the handle
//! beside `maxfree`, O(1) at construction and O(1) to read, so `depth_exceeds` is now a comparison that
//! walks and allocates nothing.
//!
//! # MEASURED 2026-08-01
//!
//! | program | before either fix | `shift` only | both |
//! | --- | --- | --- | --- |
//! | the 512-byte nested-group hang | one β-step unfinished at 13 min / 974 MB | 105,607 steps, 195.7 s | **7.48 s** |
//! | `let xs = [0..500); let ys = […]; head(xs) + head(ys)` | 19.0 s in the FIRST β-step | 0.024 s | **<0.001 s** |
//! | `[0, 1, …, 698]` | 35 s over 1,398 steps | 3.187 s | **0.986 s**, same 1,398 steps |
//!
//! **The reduction ramp is now FLAT** — 7.5–9.0 s at every level from 1 to 11, against a logical size
//! that grows 306 → 616,152 across that range. Before the depth fix it doubled per level in step with
//! the logical size; before the `shift` fix the last level did not finish.
//!
//! Step counts are unchanged wherever they were recorded, which is the evidence that both changes are
//! representational and not semantic. The sharing gate agrees from the other end: the same node totals
//! held in 7.42x and 42.5x fewer allocations (`tests/lambda_sharing.rs`).
//!
//! # WHAT IT DOES NOT CLOSE
//!
//! **Divergence.** The nested-group family has no base case; it is non-terminating by construction, and
//! "terminates" above means it reaches a cap in bounded time rather than that it computes an answer.
//! The halting problem was never this slice's to solve. What changed is that control now RETURNS from
//! each β-step, so the caps are reachable at all.
//!
//! The cap it reaches is `MAX_TERM_DEPTH`, not `MAX_REDUCTION_STEPS` — 105,607 steps against a step cap
//! of 5,000,000 — because the family grows deep as it diverges. Worth naming, because "HIT CAP" in the
//! table below reads as the step cap and it is not.
//!
//! **This family is now flat; that is not a claim about every family.** What both fixes removed is cost
//! that scaled with the LOGICAL size while the physical size stayed small. A program whose physical
//! size genuinely grows still pays for it, and `subst` still rebuilds the spine of whatever it descends
//! into. The record's older "next target" — carrying `subst`'s per-binder re-shift down as a single
//! `shift(d, 0, ·)`, with an additivity lemma already verified in the perf design — is untouched and
//! still available.

use std::collections::{HashMap, HashSet};
use std::io::Write;

use redextape_core::lambda::lower;
use redextape_core::lambda::term::{LambdaTerm, Node, logical_size};

fn line(s: &str) {
    println!("{s}");
    std::io::stdout().flush().ok();
}

fn core_of(src: &str) -> Option<redextape_core::core::Core> {
    let a = redextape_core::analyze(src);
    a.core
}

fn nested_groups_src(m: u32) -> String {
    let mut body = format!("n + g{m}(n)");
    for k in (0..m).rev() {
        let j = k + 1;
        body = format!("fn f{j}(n) {{ {body} }} fn g{j}(n) {{ f{j}(n) }} g{j}(n) + g{k}(n)");
    }
    format!("fn f0(n) {{ {body} }} fn g0(n) {{ f0(n) }} g0(1)")
}

/// Post-order over the DAG, memoized by allocation identity — O(physical).
/// Returns, per allocation: (logical size, max free index + 1; 0 means CLOSED).
fn analyze_term(t: &LambdaTerm) -> HashMap<usize, (u64, u32)> {
    let mut out: HashMap<usize, (u64, u32)> = HashMap::new();
    let mut stack: Vec<(&LambdaTerm, bool)> = vec![(t, false)];
    while let Some((node, expanded)) = stack.pop() {
        let id = node.alloc_id();
        if out.contains_key(&id) {
            continue;
        }
        if !expanded {
            stack.push((node, true));
            match node.node() {
                Node::Var(_) => {}
                Node::Abs(_, b) => stack.push((b, false)),
                Node::App(f, a) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
            continue;
        }
        let get = |c: &LambdaTerm| out.get(&c.alloc_id()).copied().unwrap_or((u64::MAX, u32::MAX));
        let v = match node.node() {
            Node::Var(k) => (1u64, k + 1),
            Node::Abs(_, b) => {
                let (bs, bf) = get(b);
                // A free index inside the body is one binder further out here; index 0 was bound.
                (bs.saturating_add(1), bf.saturating_sub(1))
            }
            Node::App(f, a) => {
                let (fs, ff) = get(f);
                let (as_, af) = get(a);
                (fs.saturating_add(as_).saturating_add(1), ff.max(af))
            }
        };
        out.insert(id, v);
    }
    out
}

fn physical_ids(t: &LambdaTerm) -> Vec<usize> {
    let mut seen: HashSet<usize> = HashSet::new();
    let mut order = Vec::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    while let Some(n) = stack.pop() {
        if !seen.insert(n.alloc_id()) {
            continue;
        }
        order.push(n.alloc_id());
        match n.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
    order
}

/// Node-constructions `shift(d, cutoff, t)` performed BEFORE the short-circuit: one per logical node,
/// unconditionally. **Not what `shift` does now** — this is the counterfactual the table below is
/// measured against, kept so the saving stays re-derivable rather than quoted.
///
/// It is the logical size, which `logical_size` already computes in O(physical), so nothing here walks
/// the logical tree to find it.
fn shift_cost_unguarded(t: &LambdaTerm, info: &HashMap<usize, (u64, u32)>) -> u64 {
    info.get(&t.alloc_id()).map(|v| v.0).unwrap_or(u64::MAX)
}

/// Node-constructions `shift` performs NOW, with the short-circuit
/// `maxfree(t) <= cutoff => return t.clone()`. Recursion mirrors `shift` exactly; memoized on
/// (alloc, cutoff) so this MEASUREMENT is O(physical x distinct cutoffs) rather than O(logical). The
/// memo is the probe's, not `shift`'s — `shift` needs none, because the short-circuit fires before it
/// would have recursed.
fn shift_cost_guarded(
    t: &LambdaTerm,
    cutoff: u32,
    info: &HashMap<usize, (u64, u32)>,
    memo: &mut HashMap<(usize, u32), u64>,
) -> u64 {
    // The short-circuit: no free index reaches `cutoff`, so shift is the identity here.
    if info.get(&t.alloc_id()).map(|v| v.1).unwrap_or(u32::MAX) <= cutoff {
        return 0;
    }
    if let Some(&c) = memo.get(&(t.alloc_id(), cutoff)) {
        return c;
    }
    let c = match t.node() {
        Node::Var(_) => 1,
        Node::Abs(_, b) => 1 + shift_cost_guarded(b, cutoff + 1, info, memo),
        Node::App(f, a) => 1 + shift_cost_guarded(f, cutoff, info, memo) + shift_cost_guarded(a, cutoff, info, memo),
    };
    memo.insert((t.alloc_id(), cutoff), c);
    c
}

fn main() {
    line("level  bytes  physical   logical        ratio     closed_allocs  closed_share_of_phys");
    for level in 1..=11u32 {
        let src = nested_groups_src(level - 1);
        let Some(core) = core_of(&src) else {
            line(&format!("{level:>5}  parse/type failed"));
            continue;
        };
        let t = match lower(&core) {
            Ok(t) => t,
            Err(e) => {
                line(&format!("{level:>5}  lower error: {e:?}"));
                break;
            }
        };
        let info = analyze_term(&t);
        let ids = physical_ids(&t);
        let phys = ids.len();
        let log = logical_size(&t);
        let closed: Vec<usize> = ids.iter().copied().filter(|id| info.get(id).map(|v| v.1) == Some(0)).collect();
        let ratio = if log == u64::MAX { "saturated".to_string() } else { format!("{:.1}x", log as f64 / phys as f64) };
        let logs = if log == u64::MAX { "saturated".to_string() } else { log.to_string() };
        line(&format!(
            "{level:>5}  {:>5}  {phys:>8}   {logs:>12}   {ratio:>9}     {:>8}       {:>5.1}%",
            src.len(),
            closed.len(),
            100.0 * closed.len() as f64 / phys as f64,
        ));
    }

    line("");
    line("shift(1, 0, t) node-constructions on the whole lowered term — before the fix vs now");
    line("level   unguarded (= logical)   now   saved");
    for level in 1..=11u32 {
        let src = nested_groups_src(level - 1);
        let Some(core) = core_of(&src) else { continue };
        let Ok(t) = lower(&core) else { break };
        let info = analyze_term(&t);
        let unguarded = shift_cost_unguarded(&t, &info);
        let mut memo = HashMap::new();
        let guarded = shift_cost_guarded(&t, 0, &info, &mut memo);
        let saved = if unguarded == 0 { 0.0 } else { 100.0 * (1.0 - guarded as f64 / unguarded as f64) };
        line(&format!("{level:>5}   {unguarded:>18}   {guarded:>8}   {saved:>5.2}%"));
    }

    // --- does the hang close? ---
    //
    // Steps the nested-group family with `LambdaCursor`, which holds ONE term at a time. Never
    // `reduce_trace`: that materialises every step by contract and is what made an earlier run of this
    // family eat 60 GiB. Ramped upward, each row flushed BEFORE the next is computed, so an OOM-kill
    // or a timeout leaves the last completed row on stdout rather than losing the whole table.
    line("");
    line("reduction to normal form — LambdaCursor, one term at a time, cap 5,000,000 steps");
    line("level   physical   logical      steps        secs   outcome");
    for level in 1..=11u32 {
        let src = nested_groups_src(level - 1);
        let Some(core) = core_of(&src) else { continue };
        let Ok(t) = lower(&core) else { break };
        let (phys, log) = (physical_ids(&t).len(), logical_size(&t));
        let logs = if log == u64::MAX { "saturated".to_string() } else { log.to_string() };

        let t0 = std::time::Instant::now();
        let mut cursor = redextape_core::trace::LambdaCursor::new(&t, 5_000_000);
        let mut steps = 0u64;
        while cursor.next().is_some() {
            steps += 1;
        }
        let secs = t0.elapsed().as_secs_f64();
        let outcome = match cursor.status() {
            Some(redextape_core::lambda::Status::Normalized) => "normalized",
            Some(redextape_core::lambda::Status::HitCap) => "HIT CAP",
            None => "no status",
        };
        line(&format!("{level:>5}   {phys:>8}   {logs:>9}   {steps:>8}   {secs:>9.3}   {outcome}"));
    }

    // --- the two programs that falsified the reverted guards ---
    //
    // Both are in `tests/guard_counterexamples.rs`. Recorded costs, pre-fix: the two-list program spent
    // 19.0 s in its FIRST β-step; the 699-element literal took 35 s over 1,398 steps.
    line("");
    line("the falsified-guard counterexamples");
    let list = |n: usize| (0..n).map(|i| i.to_string()).collect::<Vec<_>>().join(", ");
    let cases: Vec<(String, String)> = vec![
        (
            "two 500-element lists".to_string(),
            format!("let xs = [{}]; let ys = [{}]; head(xs) + head(ys)", list(500), list(500)),
        ),
        // The bare literal, exactly as `guard_counterexamples.rs::list_src(699)` builds it — wrapping
        // it in a `let` adds a Core level and `lower` refuses it as `TooDeep` at this length.
        ("699-element literal".to_string(), format!("[{}]", list(699))),
    ];
    for (label, src) in cases {
        let Some(core) = core_of(&src) else {
            line(&format!("  {label:<24} parse/type failed"));
            continue;
        };
        let t0 = std::time::Instant::now();
        let t = match lower(&core) {
            Ok(t) => t,
            Err(e) => {
                line(&format!("  {label:<24} lower error: {e:?}"));
                continue;
            }
        };
        let lower_secs = t0.elapsed().as_secs_f64();
        let (phys, log) = (physical_ids(&t).len(), logical_size(&t));

        let t1 = std::time::Instant::now();
        let mut cursor = redextape_core::trace::LambdaCursor::new(&t, 5_000_000);
        let mut steps = 0u64;
        let mut first_step_secs = 0.0;
        while cursor.next().is_some() {
            if steps == 0 {
                first_step_secs = t1.elapsed().as_secs_f64();
            }
            steps += 1;
        }
        let secs = t1.elapsed().as_secs_f64();
        let outcome = match cursor.status() {
            Some(redextape_core::lambda::Status::Normalized) => "normalized",
            Some(redextape_core::lambda::Status::HitCap) => "HIT CAP",
            None => "no status",
        };
        line(&format!(
            "  {label:<24} bytes={:<6} physical={phys:<8} logical={log:<9} lower={lower_secs:.3}s  \
             first_step={first_step_secs:.3}s  total={secs:.3}s over {steps} steps  {outcome}",
            src.len()
        ));
    }
}
