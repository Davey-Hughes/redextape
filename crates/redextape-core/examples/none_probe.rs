//! **Are `Owner::None` β-steps structurally unattributable, or is there headroom for more tagging?**
//! Follow-up to `owner_probe.rs`'s M1/M2: that probe measured `while4` and `countdown4` at 470/474
//! steps with 397 `None` each, after `lower.rs` grew five tagging sites. This one asks WHY the `None`
//! count stayed so high — decayed tag coverage (headroom == 0, tags consumed by contraction) or
//! misplaced tagging (headroom > 0, tags still present but off the redex's path).
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --example none_probe
//! ```
//!
//! **The cap is not decoration and `MemorySwapMax=0` is the load-bearing half.** An earlier measurement
//! over a comparable family took 60 GiB of RAM and 29 GiB of swap and wedged the machine. An OOM-kill
//! or a timeout here is a RESULT to report, not something to work around by raising the cap.
//!
//! **Drives `trace::LambdaCursor`, never `reduce_trace`**, which materialises every step's term by
//! contract and is how the 60 GiB run happened. Every table below is flushed per program, per line —
//! see `line()` — so a kill mid-run leaves complete rows up through the last program's `measure()`,
//! never a half-written one.
//!
//! # WHAT THIS MEASURES
//!
//! For every `Owner::None` β-step, this counts how many tagged `App` allocations still exist ANYWHERE
//! in the term the step was taken FROM (not the contractum the step produces — the redex node itself
//! is consumed by `beta`, so the relevant term is the one entering the step, same term the reducer
//! chose the redex from). That count splits every `None` step two ways:
//!
//!   * **zero tags left** — no additional or better-placed tagging site could have attributed this
//!     step; whatever tags existed earlier in the run are gone. No headroom.
//!   * **at least one tag left** — a tagged `App` exists somewhere in the term, just not on this
//!     redex's path. More or better-placed tagging COULD attribute steps like this one. Real headroom.
//!
//! Reported per program: the `[SPLIT]` table above (the deliverable), `[OV]` step/Exact/Within/None
//! totals plus the last non-`None` step's index (to see whether the tail is uniformly `None`), and
//! `[TRAJ]` the tagged-App count at step 0 and the 25th/50th/75th/100th percentile step (to see whether
//! it decays monotonically).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::collections::HashSet;
use std::io::Write;

use redextape_core::lambda::reduce::Owner;
use redextape_core::lambda::term::Node;
use redextape_core::lambda::{self, LambdaTerm, MAX_REDUCTION_STEPS};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{self, EncodingKind};
use redextape_core::{parser, trace};

fn line(s: &str) {
    println!("{s}");
    let _ = std::io::stdout().flush();
}

fn head(s: &str) {
    line("");
    line(s);
    line(&"-".repeat(s.len()));
}

/// The four programs to contrast: two loop programs (`while4`, `countdown4` — the pair `owner_probe.rs`
/// measured at 397 `None` each) against two from the recursive family, which is "already well covered"
/// per this probe's brief. `sum5` and `map_fold` are copied VERBATIM from `owner_probe.rs`'s
/// `programs()` so the source strings cannot drift between the two probes.
fn programs() -> Vec<(&'static str, &'static str)> {
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
/// shared subterms would be the hang this file's module doc warns about, not a measurement of one.
///
/// Iterative over an explicit stack, never recursive — a walk added to a probe whose whole reason to
/// exist is capped-memory safety must not itself risk a native stack overflow on a deep term.
fn count_tagged_apps(t: &LambdaTerm) -> u64 {
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

/// One program's full census: `Owner` totals, the headroom split over every `None` step, and the
/// tagged-App trajectory needed to read that split.
struct Census {
    steps: u64,
    exact: u64,
    within: u64,
    none: u64,
    /// 1-based index of the last step whose `Owner` was NOT `None`; `None` if every step was.
    last_non_none_step: Option<u64>,
    /// `None` steps where the term ENTERING that step (the one the redex was chosen from) had zero
    /// tagged `App` allocations anywhere in it — no headroom, the tags were already consumed.
    none_zero_tags: u64,
    /// `None` steps where the term entering that step still had at least one tagged `App` somewhere —
    /// headroom: the redex sat outside every tagged subterm, not past the last tag standing.
    none_some_tags: u64,
    /// Tagged-App count entering each step, index 0 = the initial term (before step 1), index i =
    /// entering step i+1 (i.e. the term after i steps). Length is `steps + 1`.
    tagged_by_step: Vec<u64>,
}

impl Census {
    fn empty() -> Census {
        Census {
            steps: 0,
            exact: 0,
            within: 0,
            none: 0,
            last_non_none_step: None,
            none_zero_tags: 0,
            none_some_tags: 0,
            tagged_by_step: Vec::new(),
        }
    }
}

/// Drive one program to `MAX_REDUCTION_STEPS` over `trace::LambdaCursor` — never `reduce_trace`, see
/// this file's module doc — counting `Owner` and the tagged-App headroom split at every step.
///
/// **`count_tagged_apps` is called against the term ENTERING each step**, i.e. `LambdaCursor::term()`
/// as read BEFORE that step's `next()` call: `term()` returns "the term as of the last emitted event",
/// so reading it before calling `next()` for step i returns the term step i's redex was chosen from —
/// the same term whose ancestor path `Owner::Within`/`Owner::None` describe. Reading it AFTER the step
/// would already be missing the just-contracted redex (and any tag it carried), which is precisely the
/// consumption this probe exists to measure, not a term to classify a step by.
///
/// O(steps x term size): one `count_tagged_apps` walk per step, each walk O(physical allocations) by
/// `count_tagged_apps`'s own doc. Acceptable at this corpus's sizes; anything worse is not.
fn measure(src: &str) -> Census {
    let (program, _) = parser::parse(src);
    let Some(program) = program else {
        return Census::empty();
    };
    let enc = EncodingKind::Unary.at(tm::MIN_FIELD_WIDTH);
    let (core, _map) = SourceMap::build_from_program(&program, &*enc);
    let Ok(term) = lambda::lower(&core) else {
        return Census::empty();
    };

    // `LambdaCursor`, NEVER `reduce_trace` — see this file's module doc.
    let mut c = trace::LambdaCursor::new(&term, MAX_REDUCTION_STEPS);
    let mut tagged_by_step: Vec<u64> = vec![count_tagged_apps(c.term())];
    let (mut exact, mut within, mut none) = (0u64, 0u64, 0u64);
    let (mut none_zero_tags, mut none_some_tags) = (0u64, 0u64);
    let mut last_non_none_step: Option<u64> = None;
    let mut step_idx = 0u64;
    while c.next().is_some() {
        step_idx += 1;
        // The count entering THIS step is the last one pushed — computed before this `next()` call,
        // against the pre-step term. See this function's doc.
        let entering = tagged_by_step[(step_idx - 1) as usize];
        match c.last_owner() {
            Owner::Exact(_) => {
                exact += 1;
                last_non_none_step = Some(step_idx);
            }
            Owner::Within(_) => {
                within += 1;
                last_non_none_step = Some(step_idx);
            }
            Owner::None => {
                none += 1;
                if entering == 0 {
                    none_zero_tags += 1;
                } else {
                    none_some_tags += 1;
                }
            }
        }
        tagged_by_step.push(count_tagged_apps(c.term()));
    }
    Census { steps: step_idx, exact, within, none, last_non_none_step, none_zero_tags, none_some_tags, tagged_by_step }
}

/// The tagged-App count entering the step at percentile `q` (0.0..=1.0) OF THE RUN — i.e. indexing
/// `counts` by STEP POSITION, not by sorted value. `owner_probe.rs`'s `percentile` sorts and ranks
/// VALUES (span widths, which have no inherent order); this instead reads a fixed position along an
/// already-step-ordered sequence, so sorting it would destroy the thing being asked for: whether the
/// count decays monotonically as the run proceeds.
fn tagged_count_at_pct(counts: &[u64], q: f64) -> u64 {
    if counts.is_empty() {
        return 0;
    }
    let idx = ((q * (counts.len() - 1) as f64).round() as usize).min(counts.len() - 1);
    counts[idx]
}

/// Whether `counts` never increases step over step. A monotonic decay is the signature the consumed-tag
/// hypothesis predicts; any increase falsifies "tags only ever disappear" (a shared subterm losing a
/// reference elsewhere in the DAG could in principle drop a tagged allocation's last consumer without
/// the redex path touching it, but nothing in this reducer creates a NEW tag after lowering — see
/// `term.rs`'s "THE TAG IS INHERITED, NEVER RECOMPUTED" — so an increase here would be worth a second
/// look, not an expected outcome).
fn is_monotonic_non_increasing(counts: &[u64]) -> bool {
    counts.windows(2).all(|w| w[1] <= w[0])
}

fn fmt_pct(n: u64, of: u64) -> String {
    if of == 0 { "-".to_string() } else { format!("{:.1}%", 100.0 * n as f64 / of as f64) }
}

fn main() {
    line("none_probe — headroom split for Owner::None β-steps: consumed tags vs. misplaced tagging");
    line("  RUN UNDER: systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0");

    let progs = programs();

    head("[OV] Owner totals and the last non-None step (loop family first, then recursive)");
    line(&format!(
        "[OV] {:<11}{:>8}{:>8}{:>8}{:>8}{:>14}",
        "program", "steps", "Exact", "Within", "None", "last!=None"
    ));

    head("[SPLIT] THE DELIVERABLE — None steps split by tagged-App count in the term entering the step");
    line("  zero  = no tagged App left anywhere in the term -> no headroom, tags were consumed");
    line("  some  = >=1 tagged App still present somewhere   -> headroom, redex just sat outside it");
    line(&format!("[SPLIT] {:<11}{:>8}{:>10}{:>8}{:>10}{:>8}", "program", "None", "zero", "zero%", "some", "some%"));

    head("[TRAJ] Tagged-App count in the term, by step percentile (0/25/50/75/100), and monotonicity");
    line(&format!(
        "[TRAJ] {:<11}{:>8}{:>8}{:>8}{:>8}{:>8}  {}",
        "program", "p0", "p25", "p50", "p75", "p100", "monotonic-non-increasing"
    ));

    // Every table's row for a program is flushed immediately after that program's `measure()` finishes
    // — interleaved across the three tags rather than three separate passes — so a kill mid-run leaves
    // every table complete through the last finished program, never one table ahead of the others. Same
    // fix `owner_probe.rs` already applies to its M1/M2 split; see this file's module doc.
    for (name, src) in &progs {
        let c = measure(src);

        line(&format!(
            "[OV] {:<11}{:>8}{:>8}{:>8}{:>8}{:>14}",
            name,
            c.steps,
            c.exact,
            c.within,
            c.none,
            c.last_non_none_step.map_or_else(|| "none".to_string(), |s| s.to_string()),
        ));

        line(&format!(
            "[SPLIT] {:<11}{:>8}{:>10}{:>8}{:>10}{:>8}",
            name,
            c.none,
            c.none_zero_tags,
            fmt_pct(c.none_zero_tags, c.none),
            c.none_some_tags,
            fmt_pct(c.none_some_tags, c.none),
        ));

        let p0 = tagged_count_at_pct(&c.tagged_by_step, 0.0);
        let p25 = tagged_count_at_pct(&c.tagged_by_step, 0.25);
        let p50 = tagged_count_at_pct(&c.tagged_by_step, 0.50);
        let p75 = tagged_count_at_pct(&c.tagged_by_step, 0.75);
        let p100 = tagged_count_at_pct(&c.tagged_by_step, 1.0);
        let mono = is_monotonic_non_increasing(&c.tagged_by_step);
        line(&format!("[TRAJ] {:<11}{:>8}{:>8}{:>8}{:>8}{:>8}  {}", name, p0, p25, p50, p75, p100, mono));
    }

    line("");
    line("Read the [SPLIT] table for the headroom verdict per program: `some%` near 0 across the loop");
    line("family, alongside [TRAJ]'s p50/p75/p100 collapsing to 0, is the consumed-tag hypothesis; any");
    line("program with a substantial `some%` late in [TRAJ] is real, unclaimed headroom instead.");
}
