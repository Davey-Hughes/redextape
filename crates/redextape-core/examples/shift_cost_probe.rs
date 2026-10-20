//! The instrument for the `maxfree` short-circuit and the stored `depth`.
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --example shift_cost_probe
//! ```
//!
//! **The cap is not decoration and `MemorySwapMax=0` is the load-bearing half.** This ramps a family
//! built to blow up, and the cap alone lets the kernel thrash instead of failing, which is what makes a
//! box unusable rather than merely killing a process. An OOM-kill or a timeout here is a RESULT to
//! report, not something to work around by raising the cap.
//!
//! The reduction sections drive `trace::LambdaCursor`, which holds ONE term at a time. **Never
//! `reduce_trace` on anything this file builds** — it materialises every step's term by contract. Rows
//! are flushed BEFORE the next is computed, so an OOM-kill leaves the completed rows on stdout instead
//! of losing the table.
//!
//! # THE `maxfree` SHORT-CIRCUIT AND THE STORED `depth`
//!
//! `lower_group` writes a promise: a compact term whose logical size far exceeds its physical size.
//! **A `shift` that rebuilds every node it visits cashes it**, unconditionally — no memo by allocation,
//! and no check for whether any free index is actually in range. Two consequences, and the second is the
//! one that hangs:
//!
//!   1. It is Θ(LOGICAL), not Θ(physical) — it walks the denoted tree rather than the DAG.
//!   2. It DESTROYS SHARING: `shift(App(c, c))` recurses twice and builds two separate copies of `c`.
//!
//! `shift` and `subst` each open with a single comparison, reading a `maxfree` the three constructors
//! maintain in O(1): `shift(d, cutoff, t)` is the identity exactly when `maxfree(t) <= cutoff`, and
//! `subst(j, s, t)` is exactly when `maxfree(t) <= j`. Returning `t.clone()` in those cases preserves
//! the ALLOCATION, which is the half that matters — a rebuilt copy is structurally equal, so `==` does
//! not notice it and the cost stays invisible.
//!
//! `depth` is carried on the handle beside `maxfree`, O(1) at construction and O(1) to read, so
//! `depth_exceeds` is a comparison that walks and allocates nothing.
//!
//! # WHAT IT DOES NOT CLOSE
//!
//! **Divergence.** The nested-group family has no base case; it is non-terminating by construction.
//! Control RETURNS from each β-step, so the caps are reachable.
//!
//! The cap it reaches is `MAX_TERM_DEPTH`, not `MAX_REDUCTION_STEPS`, because the family grows deep as
//! it diverges. Worth naming, because "HIT CAP" in the table below reads as the step cap and it is not.
//!
//! The `maxfree` short-circuits and the stored `depth` remove cost that scales with the LOGICAL size
//! while the physical size stays small. A program whose physical size genuinely grows pays for it, and
//! `subst` rebuilds the spine of whatever it descends into.
//!
//! # THE β-FUSION CONTEST
//!
//! The census section at the bottom of `main` has `closing`, `freevar` and a SECOND contest —
//! `beta_three_pass` against `beta_fused_incr` and `beta_fused_occ` — for
//! `docs/superpowers/specs/2026-08-02-lambda-beta-fusion-design.md`, which describes collapsing `beta`'s
//! three passes into one walk. `subst()` and `lifted()` leave `closing` out: it is paid by both sides of
//! that ratio and cancels. `freevar` is the null-result counter, gated at 40% of `opening + closing`.
//!
//! # ALLOCATION COUNTS DO NOT REACH THIS FAMILY'S CLOCK
//!
//! What the reduction ramp printed by `main` below spends most of its time on is `reduce_step`, which
//! has NO MEMO: it recurses into both children of every `App` hunting the leftmost-outermost redex, so it
//! costs the LOGICAL tree, which is identical under both `beta`s. **No allocation saving can reach it.**
//! See the design's §5 SHIP RESULT.
//!
//! # THE TWO FUSED FORMULATIONS
//!
//! `fused_incr` carries `s` per binder (design §2); `fused_occ` pays the shift once per occurrence
//! (design §5b). The whole gap between them is `reshift` against `per_occ`, since `spine` and `freevar`
//! are common to both.
//!
//! # ALLOCATOR
//!
//! This target sets `mimalloc` as its global allocator, so a timing taken here is not comparable with one
//! taken under glibc's malloc. Node counts, allocation counts and step counts are properties of the
//! reduction, not of the machine, and do not depend on it.
//!
//! The reducer allocates one `Rc<Node>` per term node and frees on the same order, and glibc's layout for
//! that pattern costs real address-translation pressure.
//!
//! `mimalloc` is a `[dev-dependencies]` entry and reaches examples and tests ONLY.
//! `redextape-core`'s `[dependencies]` stays WASM-clean: `libmimalloc-sys` is C that does
//! not build for wasm32, and a library must not choose a global allocator for its consumers.

// This probe carries no unwrap/expect/panic allow because it never trips those lints — it needs
// only the pedantic exemption.
#![allow(clippy::pedantic)]

use std::collections::{HashMap, HashSet};
use std::io::Write;

use redextape_core::lambda::lower;
use redextape_core::lambda::term::{Dir, LambdaTerm, Node, logical_size, shift, subst};

#[path = "common/allocator.rs"]
mod allocator;
#[path = "common/nested_groups.rs"]
mod nested_groups;

use nested_groups::nested_groups_src;

fn line(s: &str) {
    println!("{s}");
    std::io::stdout().flush().ok();
}

fn core_of(src: &str) -> Option<redextape_core::core::Core> {
    let a = redextape_core::analyze(src);
    a.core
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
                Node::App(f, a, _) => {
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
            Node::App(f, a, _) => {
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
            Node::App(f, a, _) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
    order
}

/// Node-constructions `shift(d, cutoff, t)` would perform without the short-circuit: one per logical
/// node, unconditionally — the counterfactual the table below is measured against, kept so the saving
/// stays re-derivable rather than quoted.
///
/// It is the logical size, which `logical_size` already computes in O(physical), so nothing here walks
/// the logical tree to find it.
fn shift_cost_unguarded(t: &LambdaTerm, info: &HashMap<usize, (u64, u32)>) -> u64 {
    info.get(&t.alloc_id()).map(|v| v.0).unwrap_or(u64::MAX)
}

/// Node-constructions the shipped `shift` performs, with the short-circuit
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
        Node::App(f, a, _) => 1 + shift_cost_guarded(f, cutoff, info, memo) + shift_cost_guarded(a, cutoff, info, memo),
    };
    memo.insert((t.alloc_id(), cutoff), c);
    c
}

/// Node-constructions the shipped `shift(d, cutoff, t)` performs, counted FAITHFULLY — no memo, because
/// `shift` has none. Where `shift_cost_guarded` above answers "how many DISTINCT (allocation, cutoff)
/// pairs are rebuilt", this answers "how many nodes does the call actually construct", and the two
/// differ by exactly the sharing below the short-circuit boundary: `shift` recurses into both children
/// of every `App`, so a subterm reached twice is rebuilt twice. The table in `main` prints both, so
/// which one a claim rests on is visible rather than assumed.
///
/// The recursion mirrors `shift`'s arm for arm and reads the stored `maxfree` for the short-circuit,
/// so it costs what `shift` costs and cannot overflow anywhere `shift` would not.
fn shift_allocs(cutoff: u32, t: &LambdaTerm) -> u64 {
    // The short-circuit: no free index reaches `cutoff`, so `shift` returns the handle and builds
    // nothing.
    if t.maxfree() <= cutoff {
        return 0;
    }
    match t.node() {
        Node::Var(_) => 1,
        Node::Abs(_, b) => 1 + shift_allocs(cutoff + 1, b),
        Node::App(f, a, _) => 1 + shift_allocs(cutoff, f) + shift_allocs(cutoff, a),
    }
}

/// The redex `(\. body) arg` at `path`, as `(body, arg)`. `None` if the path does not lead to one,
/// which `reduce_step` never produces — counted rather than assumed, same as the sharing probe does.
fn redex_at<'a>(t: &'a LambdaTerm, path: &[Dir]) -> Option<(&'a LambdaTerm, &'a LambdaTerm)> {
    let mut cur = t;
    for d in path {
        cur = match (d, cur.node()) {
            (Dir::AppL, Node::App(f, _, _)) => f,
            (Dir::AppR, Node::App(_, a, _)) => a,
            (Dir::AbsBody, Node::Abs(_, b)) => b,
            _ => return None,
        };
    }
    let Node::App(f, arg, _) = cur.node() else { return None };
    let Node::Abs(_, body) = f.node() else { return None };
    Some((body, arg))
}

/// Allocations `term.rs`'s `subst(j, s, t)` makes, as `(body spine, per-binder re-shift)`.
///
/// **This mirrors `term.rs`'s `subst` arm for arm, INCLUDING BOTH SHORT-CIRCUITS** — which is the
/// whole reason it exists. The sharing probe's `Σ abs×arg` (`lambda_sharing_probe.rs`'s `account`) is
/// `count_abs(body) × size_of(arg)`, a STATIC model that ignores them: it charges every `Abs` node in
/// the body for a full copy of the argument, where `subst` does not descend into subterms without
/// the bound variable and `shift(1, 0, s)` is a refcount bump whenever `s` is closed. The two numbers
/// are not the same quantity and this is the one the function pays.
fn subst_allocs(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64) {
    // `subst`'s short-circuit: index `j` does not occur free in `t`, so the handle is the answer —
    // and, being checked before the `Abs` arm builds its argument, this is also what stops the
    // re-shift happening for a subterm that has nothing to substitute into.
    if t.maxfree() <= j {
        return (0, 0);
    }
    match t.node() {
        // Both `Var` arms return a handle: `s.clone()` at a hit, `t.clone()` otherwise.
        Node::Var(_) => (0, 0),
        Node::Abs(_, b) => {
            let re = shift_allocs(0, s);
            let lifted = shift(1, 0, s);
            let (spine, shifts) = subst_allocs(j + 1, &lifted, b);
            (1 + spine, re + shifts)
        }
        Node::App(f, a, _) => {
            let (sp1, sh1) = subst_allocs(j, s, f);
            let (sp2, sh2) = subst_allocs(j, s, a);
            (1 + sp1 + sp2, sh1 + sh2)
        }
    }
}

/// Allocations the lifted rewrite would make, as `(body spine, per-occurrence shift)`.
///
/// The candidate is `tests/subst_differential.rs::subst_at`, with both short-circuits merged in — the
/// version there has neither, so counting it as written would price a function nobody would ship. The
/// body spine is identical to `subst_allocs`'s by construction (`main` asserts it, rather than
/// trusting it), so the whole difference between the two is re-shift against per-occurrence shift.
fn subst_allocs_lifted(j: u32, lift: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64) {
    if t.maxfree() <= j {
        return (0, 0);
    }
    match t.node() {
        // The `lift == 0` arm: a refcount bump, where `shift(0, 0, s)` would deep-rebuild. Its
        // absence is a regression, not a missing micro-optimization — see the candidate's own doc.
        Node::Var(k) if *k == j => (0, if lift == 0 { 0 } else { shift_allocs(0, s) }),
        Node::Var(_) => (0, 0),
        Node::Abs(_, b) => {
            let (spine, shifts) = subst_allocs_lifted(j + 1, lift + 1, s, b);
            (1 + spine, shifts)
        }
        Node::App(f, a, _) => {
            let (sp1, sh1) = subst_allocs_lifted(j, lift, s, f);
            let (sp2, sh2) = subst_allocs_lifted(j, lift, s, a);
            (1 + sp1 + sp2, sh1 + sh2)
        }
    }
}

/// Allocations the fused `beta` of the β-fusion design §2 makes, as
/// `(body spine, per-binder re-shift, free-variable rebuild)`.
///
/// **Mirrors `beta_go` arm for arm, prune included** — the discipline `subst_allocs` exists to
/// enforce and `Σ abs×arg` breaks. `beta_go` is the shipped fused `beta` in `src/lambda/term.rs`.
/// Note the caller passes `arg` ITSELF, not `shift(1, 0, arg)`: never building the `+1` is the
/// mechanism, not an optimization on top of it.
fn beta_allocs_fused(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64, u64) {
    // The same prune as `subst`'s, and the same one the closing shift applies at this depth: every
    // free index in `t` is below `j`, so there is nothing to substitute AND nothing to decrement.
    if t.maxfree() <= j {
        return (0, 0, 0);
    }
    match t.node() {
        // `s.clone()` — a refcount bump, exactly as in `subst`'s hit arm.
        Node::Var(k) if *k == j => (0, 0, 0),
        // `var(*k - 1)`. `k > j` here (the prune took `k < j`), so `k >= 1` and the subtraction cannot
        // underflow. This is the ONE node the pre-fusion closing shift allocates that fusion cannot
        // delete — the null-result counter of §4.
        Node::Var(_) => (0, 0, 1),
        Node::Abs(_, b) => {
            let re = shift_allocs(0, s);
            let lifted = shift(1, 0, s);
            let (spine, shifts, fv) = beta_allocs_fused(j + 1, &lifted, b);
            (1 + spine, re + shifts, fv)
        }
        Node::App(f, a, _) => {
            let (sp1, sh1, fv1) = beta_allocs_fused(j, s, f);
            let (sp2, sh2, fv2) = beta_allocs_fused(j, s, a);
            (1 + sp1 + sp2, sh1 + sh2, fv1 + fv2)
        }
    }
}

/// Per-β-step totals for one program. Everything here is an allocation COUNT, deterministic and
/// machine-independent — the section that prints it reports no seconds, for the reason
/// `guard_counterexamples.rs` states: a timing gate is a flaky gate.
#[derive(Default)]
struct SubstCensus {
    steps: u64,
    closed_arg: u64,
    malformed: u64,
    /// Pre-fusion `beta`'s opening `shift(1, 0, arg)`. Paid by both `subst()` and `lifted()`, so it
    /// is neither side's win there; β-fusion deletes it.
    opening: u64,
    /// The body spine `subst` rebuilds. Paid by both, and asserted equal.
    spine: u64,
    /// `subst`'s `Abs` arm: `shift(1, 0, s)` once per binder DESCENDED THROUGH.
    reshift: u64,
    /// The rewrite's replacement: `shift(lift, 0, s)` once per occurrence at `lift > 0`.
    per_occ: u64,
    /// **PRE-FUSION** `beta`'s closing `shift(-1, 0, ·)` over the term `subst` returns. Deliberately
    /// still the three-pass quantity: it is what the fusion's ceiling was computed against, so pointing
    /// it at current code would make this census stop measuring the thing it exists to measure. Same
    /// intent as `lambda_sharing_probe.rs`'s `Work::closing`, which prices the same quantity on the
    /// 46-program corpus where this one prices it on the nested-group family.
    ///
    /// Comparing `subst` against the lifted rewrite, the closing shift is paid by both sides and
    /// cancels out of `subst()/lifted()`. It does not cancel against β-fusion, which deletes it — so
    /// it is counted here and enters only the second contest below.
    closing: u64,
    /// FUSION's null-result counter — the `var(k-1)` nodes the one-walk `beta` still allocates for a
    /// body free variable ABOVE the binder. A proper subset of `closing`: the pre-fusion closing pass
    /// allocates these same nodes, PLUS the spine down to them (which `subst` had already rebuilt),
    /// PLUS a rebuild of every substituted argument copy. The last two are what fusion deletes; this is
    /// what it cannot.
    freevar: u64,
}

impl SubstCensus {
    /// THE LIFTED-REWRITE CONTEST. `closing` is paid by both sides and cancels, so adding it to both
    /// sides would move the ratio the roadmap quotes without adding information.
    fn subst(&self) -> u64 {
        self.opening + self.spine + self.reshift
    }

    fn lifted(&self) -> u64 {
        self.opening + self.spine + self.per_occ
    }

    /// THE FUSION CONTEST. `closing` does not cancel here — it is half of what fusion deletes — so
    /// these three totals carry it where the pair above does not.
    fn beta_three_pass(&self) -> u64 {
        self.opening + self.spine + self.reshift + self.closing
    }

    /// Design §2: `s` carried incrementally, both of `beta`'s shifts gone, `reshift` untouched.
    fn beta_fused_incr(&self) -> u64 {
        self.spine + self.reshift + self.freevar
    }

    /// Design §5b's formulation: the shift paid once per occurrence. Carried so that the design's
    /// disagreement with the sentence it inherited is MEASURED rather than argued.
    fn beta_fused_occ(&self) -> u64 {
        self.spine + self.per_occ + self.freevar
    }

    /// Census one β-step, given the term BEFORE it and the redex path `LambdaCursor` emitted with it.
    fn observe(&mut self, before: &LambdaTerm, path: &[Dir]) {
        let Some((body, arg)) = redex_at(before, path) else {
            self.malformed += 1;
            return;
        };
        self.steps += 1;
        if arg.maxfree() == 0 {
            self.closed_arg += 1;
        }
        self.opening += shift_allocs(0, arg);
        // `beta` substitutes the OPENED argument, not `arg` — `subst(0, &shift(1, 0, arg), body)`.
        let opened = shift(1, 0, arg);
        let (spine_subst, reshift) = subst_allocs(0, &opened, body);
        let (spine_lifted, per_occ) = subst_allocs_lifted(0, 0, &opened, body);
        assert_eq!(spine_subst, spine_lifted, "the two candidates must rebuild the same body spine");

        // The fused walk takes `arg`, not `opened` — design §2. The two assertions below are DRIFT
        // GUARDS between `subst_allocs` and `beta_allocs_fused`, not a check of the design — both
        // are forced true by construction, not by the design being right. `spine`: the two mirrors share
        // the identical prune and the identical spine recursion, so `spine_subst == spine_fused` cannot
        // fail. `reshift`: the fused walk's `s` is exactly one `shift(1, 0, ·)` behind `subst`'s, and
        // `shift_allocs(0, ·)` is invariant under that shift — it changes neither the tree shape nor
        // which occurrences are free, so the prune flips identically on both sides. What these catch is a
        // LATER edit that desynchronises the two mirrors; the actual check that the shipped `beta`
        // matches this design is the equivalence differential in `tests/subst_differential.rs`, not these.
        let (spine_fused, reshift_fused, freevar) = beta_allocs_fused(0, arg, body);
        assert_eq!(spine_subst, spine_fused, "fusion must rebuild the same body spine as `subst`");
        assert_eq!(reshift, reshift_fused, "fusion must re-shift once per binder, as `subst` does");

        self.spine += spine_subst;
        self.reshift += reshift;
        self.per_occ += per_occ;
        self.closing += shift_allocs(0, &subst(0, &opened, body));
        self.freevar += freevar;
    }
}

/// Step `t` to normal form (or the cap) with `LambdaCursor`, censusing every β-step.
///
/// **`LambdaCursor`, never `reduce_trace`** — the cursor holds one term, where `reduce_trace`
/// materialises every step by contract. The census holds one extra handle, the term BEFORE the step,
/// because `next` advances `current` past it and the redex path is relative to the term it was found in.
fn census_run(t: &LambdaTerm, cap: u64) -> (SubstCensus, Option<redextape_core::lambda::Status>) {
    let mut census = SubstCensus::default();
    let mut cursor = redextape_core::trace::LambdaCursor::new(t, cap);
    loop {
        let before = cursor.term().clone();
        match cursor.next() {
            Some(redextape_core::trace::StepEvent::Beta { redex, .. }) => census.observe(&before, &redex),
            Some(_) => unreachable!("the λ cursor emits only Beta"),
            None => break,
        }
    }
    (census, cursor.status())
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
    line("shift(1, 0, t) node-constructions on the whole lowered term — `unguarded` vs what `shift` builds");
    line("`distinct` memoizes on (allocation, cutoff); `built` does not, because `shift` does not —");
    line("it recurses into both children of every `App`, so a shared subterm is rebuilt once per edge.");
    line("level   unguarded (= logical)   distinct      built   saved (built)");
    for level in 1..=11u32 {
        let src = nested_groups_src(level - 1);
        let Some(core) = core_of(&src) else { continue };
        let Ok(t) = lower(&core) else { break };
        let info = analyze_term(&t);
        let unguarded = shift_cost_unguarded(&t, &info);
        let mut memo = HashMap::new();
        let distinct = shift_cost_guarded(&t, 0, &info, &mut memo);
        let built = shift_allocs(0, &t);
        let saved = if unguarded == 0 { 0.0 } else { 100.0 * (1.0 - built as f64 / unguarded as f64) };
        line(&format!("{level:>5}   {unguarded:>18}   {distinct:>8}   {built:>8}   {saved:>10.2}%"));
    }

    // --- does the hang close? ---
    //
    // Steps the nested-group family with `LambdaCursor`, which holds ONE term at a time. Never
    // `reduce_trace`: that materialises every step by contract. Ramped upward, each row flushed BEFORE
    // the next is computed, so an OOM-kill or a timeout leaves the last completed row on stdout rather
    // than losing the whole table.
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

    // --- the two guard counterexamples in `tests/guard_counterexamples.rs` ---
    line("");
    line("the two guard counterexamples");
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

    // --- the `subst` lifted-shift rewrite ---
    //
    // Carrying `subst`'s per-binder re-shift down as one `shift(d, 0, ·)`, priced against what `subst`
    // allocates rather than against the STATIC `Σ abs×arg` model (`lambda_sharing_probe.rs`'s `account`,
    // `count_abs(body) × size_of(arg)`), which ignores both short-circuits. Counts only, no seconds:
    // every number below is a property of the reduction rather than of how fast the machine ran it.
    //
    // Rows are flushed BEFORE the next is computed, and the family is stepped with `LambdaCursor`.
    line("");
    line("per-step `subst` allocation census — what it pays vs what the lifted rewrite would");
    line("`opening` (beta's shift(1,0,arg)) and `spine` (the body subst rebuilds) are paid by BOTH and");
    line("are not either side's win; the rewrite trades `reshift` for `per_occ`.");
    line("program          steps  closed_arg   opening     spine   reshift   per_occ     subst    lifted     win");
    let mut family: Vec<(String, String)> =
        (1..=11u32).map(|level| (format!("nested lvl {level}"), nested_groups_src(level - 1))).collect();
    family.push((
        "two 500-lists".to_string(),
        format!("let xs = [{}]; let ys = [{}]; head(xs) + head(ys)", list(500), list(500)),
    ));
    family.push(("699-literal".to_string(), format!("[{}]", list(699))));
    let mut censuses: Vec<(String, SubstCensus, String)> = Vec::new();
    for (label, src) in family {
        let Some(core) = core_of(&src) else {
            line(&format!("{label:<14}   parse/type failed"));
            continue;
        };
        let Ok(t) = lower(&core) else {
            line(&format!("{label:<14}   lower error"));
            continue;
        };
        let (c, status) = census_run(&t, 5_000_000);
        let capped = match status {
            Some(redextape_core::lambda::Status::HitCap) => "  HIT CAP",
            _ => "",
        };
        let malformed = if c.malformed == 0 { String::new() } else { format!("  {} MALFORMED", c.malformed) };
        let suffix = format!("{capped}{malformed}");
        // Printed HERE, before the next program's census runs — the row is flushed, not deferred, so an
        // OOM-kill on a later program leaves this one on stdout. `censuses` below is table 2's copy of
        // the same already-computed row, not a second `census_run`.
        let win = if c.lifted() == 0 { 0.0 } else { c.subst() as f64 / c.lifted() as f64 };
        line(&format!(
            "{label:<14}  {:>6}  {:>9.1}%  {:>8}  {:>8}  {:>8}  {:>8}  {:>8}  {:>8}  {win:>5.2}x{suffix}",
            c.steps,
            100.0 * c.closed_arg as f64 / c.steps.max(1) as f64,
            c.opening,
            c.spine,
            c.reshift,
            c.per_occ,
            c.subst(),
            c.lifted(),
        ));
        censuses.push((label, c, suffix));
    }

    line("");
    line("β-FUSION contest — `beta` as three passes against `beta` as one. `closing` is counted here and");
    line("is NOT in the `subst` column above: it cancels in the lifted contest and does not cancel here.");
    line("`freevar` is the null-result counter — what the fused walk still has to rebuild.");
    line(
        "program          steps    opening     spine   reshift   per_occ   closing   freevar   beta_3pass  fused_incr  fused_occ    win",
    );
    for (label, c, suffix) in &censuses {
        let win = if c.beta_fused_incr() == 0 { 0.0 } else { c.beta_three_pass() as f64 / c.beta_fused_incr() as f64 };
        line(&format!(
            "{label:<14}  {:>6}  {:>9}  {:>8}  {:>8}  {:>8}  {:>8}  {:>8}  {:>11}  {:>10}  {:>9}  {win:>5.2}x{suffix}",
            c.steps,
            c.opening,
            c.spine,
            c.reshift,
            c.per_occ,
            c.closing,
            c.freevar,
            c.beta_three_pass(),
            c.beta_fused_incr(),
            c.beta_fused_occ(),
        ));
    }
}
