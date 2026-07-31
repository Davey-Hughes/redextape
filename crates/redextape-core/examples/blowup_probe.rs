//! Logical-vs-physical blow-up probe for the `Rc`-backed `LambdaTerm`. This is a HAZARD
//! DEMONSTRATOR, not a benchmark: its `oom` section is built to reach the size at which the reducer
//! stops making progress, and it does. Read the "how to run this" block below before running it.
//!
//! `LambdaTerm` is `struct LambdaTerm(Rc<Node>)`, so one allocation can be reached by more than one
//! edge. Every consumer in this crate that walks a term walks the LOGICAL expansion — it descends into
//! both children of every `App` without asking whether they are one allocation — so a term whose
//! logical size exceeds its physical size costs the walker the LOGICAL number. `reduce.rs`'s
//! `depth_exceeds` used to call that shape "impossible under `Box`, merely unreached by the current
//! corpus". This probe measured both halves of that claim, and **the second half was false**:
//!
//!   * PART 1 — the hazard exists at all. `c = app(c.clone(), c)`, n times: n+1 allocations,
//!     2^(n+1)-1 logical nodes. Which consumers pay the logical number, and at which n do they cross
//!     a 2-second budget? ANSWER: all of them but two. `depth_exceeds` crosses at n = 30,
//!     `LambdaCursor::next` at n = 29, `c == d` (separately built, so `ptr_eq` cannot fire) at n = 30,
//!     `print_lambda` produces 2.10 MB at n = 19. The two that are immune are `c == c.clone()` (one
//!     pointer comparison at any n) and `drop` — n = 10,000, a term of 2^10001 logical nodes, freed in
//!     175 µs, which is `Drop`'s Θ(physical) claim demonstrated rather than argued.
//!   * PART 2 — is the shape reachable from a source program? The only path a user controls is
//!     parse -> desugar -> Core -> `lower` -> reduce, so this ramps a family of source programs and
//!     measures the ratio of the term `lower` returns. ANSWER: REACHABLE, from 512 bytes. The
//!     multiplier is `lower.rs:453` — `lower_group` clones the whole group term once per member of a
//!     mutually recursive `fn` group — and it NESTS, because a member's body is a block that can
//!     declare its own group. 512 bytes lowers in ~196 µs to 1,644 allocations holding 616,152
//!     logical nodes (375x), and that term's FIRST β-step did not finish in 13 minutes at 974 MB.
//!     No guard fires: depth 141 against `MAX_TERM_DEPTH` = 3,000, and `MAX_REDUCTION_STEPS` is never
//!     consulted because control does not return from `reduce_step`.
//!
//! WHAT THE `step` SECTION IS FOR, since it looks redundant next to `oom`. It shows that reduction
//! cannot COMPOUND the ratio — it MATERIALIZES it. `beta`'s closing `shift(-1, 0, ..)` rebuilds every
//! node it visits, so a β-step's output aliases nothing, and the within-term ratio is exactly 1.00x
//! after ≥6 steps from starting ratios up to 114x. The compact term was never small; it was a promise
//! to allocate, and the reducer keeps it.
//!
//! MEASURED WITHOUT MATERIALIZING ANYTHING. `logical()` below is a memoized fold over the DAG, O(one
//! visit per allocation) — NOT a walk of the logical tree — so the ratio of a term with 2^40 logical
//! nodes is computed in microseconds and the process never holds more than the term itself. The timed
//! ramps are the only place a logical walk actually runs, and each stops at the first size over
//! budget. Measuring the natural way — walking it — is the very thing that is exponential.
//!
//! EVERY RAMP STEPS BY ONE. A size parameter that doubles the work per increment cannot be bisected:
//! the first jump past the budget is also the one that never returns. Each row is flushed before the
//! next size is computed, so an interrupted run still reports everything it established.
//!
//! # How to run this
//!
//! EVERY RUN GOES UNDER A CGROUP CAP. Not just `oom` — all of them, so the habit does not depend on
//! remembering which section is the dangerous one:
//!
//! ```text
//! # part1 + part2, the sections that are allocation-bounded by construction; ~40 s
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core
//!
//! # cursor-driven stepping, node-ceilinged; ~2 min
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- step
//!
//! # the failure boundary. RUNS FOR AS LONG AS YOU LET IT and holds ~1 GB from ten levels on, where a
//! # single β-step does not finish. Never run this without the cap. Stop it by hand.
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release --example blowup_probe -p redextape-core -- oom
//! ```
//!
//! `MemorySwapMax=0` is not decoration. The cap alone lets the kernel push the excess to swap, which
//! turns a bounded failure into an unbounded one — and did: an earlier version of this investigation
//! consumed **60 GiB of RAM and 29 GiB of swap** before it was stopped by hand.
//!
//! `reduce_trace` IS NEVER CALLED HERE and MUST NOT BE ADDED. That 60/29 GiB run is what calling it
//! costs: `reduce_trace` materializes every step's term by contract (592.9 MB for `sum(5)`, per the
//! Plan 4 design), and on a term of this shape each of those terms is itself unbounded, so the cgroup
//! cap has nothing to bite on before the machine does. `trace::LambdaCursor` is the O(1) stepper, and
//! it is what the `step` and `oom` sections use.
//!
//! Nothing here is a test and nothing here is wired into CI: CI compiles examples
//! (`cargo clippy --workspace --all-targets`) and does not run them, which for this target is the
//! intended arrangement rather than a gap. It is committed so the finding in the design's §10 has a
//! re-runnable repro instead of a quoted number.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{HashMap, HashSet};
use std::hint::black_box;
use std::io::Write;
use std::time::Instant;

use redextape_core::desugar::desugar;
use redextape_core::lambda::reduce::MAX_TERM_DEPTH;
use redextape_core::lambda::term::{LambdaTerm, Node, app, var};
use redextape_core::lambda::{MAX_REDUCTION_STEPS, lower, parse_lambda, print_lambda};
use redextape_core::parser::parse;
use redextape_core::trace::LambdaCursor;

/// Per-size wall-clock budget. A ramp stops at the FIRST size that exceeds it — the next size would
/// double the work, so "one more, to be sure" is exactly the step that does not return.
const BUDGET_S: f64 = 2.0;

/// Hard ceiling on every ramp. At n=64 the doubling chain has 2^65 logical nodes; nothing that walks
/// it logically can finish, so a ramp that reaches this bound has proved its consumer does not.
const MAX_N: u32 = 64;

/// Stop the `print_lambda` ramp once its output passes this. Output is proportional to LOGICAL size,
/// so the next size is twice this and nothing here may be allowed to reach for a gigabyte.
const MAX_PRINT_BYTES: usize = 1 << 20;

fn line(s: &str) {
    println!("{s}");
    let _ = std::io::stdout().flush();
}

fn head(s: &str) {
    line("");
    line(&format!("=== {s} ==="));
}

// --- measurement primitives (both O(one visit per allocation), neither walks the logical tree) ---

/// Distinct `Rc` allocations reachable from `t`. `t` is borrowed for the whole walk, so every
/// `alloc_id()` compared here belongs to a live allocation (see `LambdaTerm::alloc_id`'s doc).
fn physical(t: &LambdaTerm) -> usize {
    let mut seen: HashSet<usize> = HashSet::new();
    let mut stack: Vec<&LambdaTerm> = vec![t];
    while let Some(n) = stack.pop() {
        if !seen.insert(n.alloc_id()) {
            continue; // already counted this allocation; its subtree is counted with it
        }
        match n.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
    seen.len()
}

/// Logical node count — what every consumer in the crate actually walks — as a memoized fold over the
/// DAG: `size(n) = 1 + sum(size(child))`, each allocation folded once. `f64` because the answer can
/// exceed `u64`; exact below 2^53 and a bounded approximation above it, which is all a ratio needs.
/// Iterative (an explicit stack), so a deep term cannot overflow the native stack.
fn logical(t: &LambdaTerm) -> f64 {
    let mut memo: HashMap<usize, f64> = HashMap::new();
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
                Node::App(f, a) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
            continue;
        }
        let size = match n.node() {
            Node::Var(_) => 1.0,
            Node::Abs(_, b) => 1.0 + memo.get(&b.alloc_id()).copied().unwrap_or(0.0),
            Node::App(f, a) => {
                1.0 + memo.get(&f.alloc_id()).copied().unwrap_or(0.0) + memo.get(&a.alloc_id()).copied().unwrap_or(0.0)
            }
        };
        memo.insert(id, size);
    }
    memo.get(&t.alloc_id()).copied().unwrap_or(0.0)
}

/// Maximum nesting depth, memoized over the DAG the same way. This is what `MAX_TERM_DEPTH` bounds —
/// and the point of measuring it here is that it is a DIFFERENT quantity from logical size, so a term
/// can sit far under the depth limit while its logical size is astronomical.
fn depth(t: &LambdaTerm) -> u32 {
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
                Node::App(f, a) => {
                    stack.push((f, false));
                    stack.push((a, false));
                }
            }
            continue;
        }
        let d = match n.node() {
            Node::Var(_) => 0,
            Node::Abs(_, b) => 1 + memo.get(&b.alloc_id()).copied().unwrap_or(0),
            Node::App(f, a) => {
                1 + memo.get(&f.alloc_id()).copied().unwrap_or(0).max(memo.get(&a.alloc_id()).copied().unwrap_or(0))
            }
        };
        memo.insert(id, d);
    }
    memo.get(&t.alloc_id()).copied().unwrap_or(0)
}

/// A TRANSCRIPTION of `lambda::reduce::depth_exceeds`, which is `pub(crate)` and so unreachable from
/// an example target. Kept character-for-character equivalent on purpose: this is the function
/// `trace::LambdaCursor` calls BEFORE EVERY STEP, so what it costs is what a run costs before its
/// first β-step. The `LambdaCursor` ramp below measures the real one end-to-end as a cross-check.
fn depth_exceeds(t: &LambdaTerm, limit: u32) -> bool {
    let mut stack: Vec<(&LambdaTerm, u32)> = vec![(t, 0)];
    while let Some((node, d)) = stack.pop() {
        if d > limit {
            return true;
        }
        match node.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push((b, d + 1)),
            Node::App(f, a) => {
                stack.push((f, d + 1));
                stack.push((a, d + 1));
            }
        }
    }
    false
}

fn fmt_count(v: f64) -> String {
    if v < 1e15 { format!("{v:.0}") } else { format!("{v:.3e} (2^{:.1})", v.log2()) }
}

/// Run `f` at sizes 1, 2, 3, … Each row is flushed before the next size is computed, and the ramp
/// stops at the first size over budget (or when `f` reports its own guard). `f` returns the time it
/// wants judged on, so construction cost is never counted against the consumer being measured.
fn ramp(label: &str, note: &str, mut f: impl FnMut(u32) -> (f64, String, bool)) {
    line("");
    line(&format!("--- {label} ---"));
    line(&format!("    {note}"));
    for n in 1..=MAX_N {
        let (secs, row, guard) = f(n);
        line(&format!("  n={n:<4} {secs:>11.6}s  {row}"));
        if secs > BUDGET_S {
            line(&format!("  STOP: n={n} exceeded the {BUDGET_S:.0}s budget; n={} would be twice that", n + 1));
            return;
        }
        if guard {
            line(&format!("  STOP: n={n} hit this ramp's own guard"));
            return;
        }
    }
    line(&format!("  STOP: reached MAX_N={MAX_N} without exceeding the budget"));
}

// --- part 1: the hand-built doubling chain -------------------------------------------------------

/// `c = app(c.clone(), c)`, n times. n+1 allocations; 2^(n+1)-1 logical nodes. O(n) memory to build
/// and to hold — the whole point is that the physical object is tiny.
fn doubling_chain(n: u32) -> LambdaTerm {
    let mut c = var(0);
    for _ in 0..n {
        c = app(c.clone(), c);
    }
    c
}

fn part1() {
    head("PART 1 — the hazard, hand-built");
    let c = doubling_chain(20);
    line(&format!(
        "  shape check at n=20: physical={} logical={} depth={} (expected 21 / 2097151 / 20)",
        physical(&c),
        fmt_count(logical(&c)),
        depth(&c)
    ));
    drop(c);

    ramp(
        "depth_exceeds(t, MAX_TERM_DEPTH)",
        "transcription of reduce.rs:64-80; the cursor calls this BEFORE EVERY STEP",
        |n| {
            let c = doubling_chain(n);
            let t0 = Instant::now();
            let over = black_box(depth_exceeds(&c, MAX_TERM_DEPTH));
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("physical={:<5} logical={:<22} exceeds={over}", n + 1, fmt_count(logical(&c))), false)
        },
    );

    ramp(
        "LambdaCursor::next() — the real pipeline",
        "depth guard + reduce_step; the chain has no redex, so this allocates nothing and returns None",
        |n| {
            let c = doubling_chain(n);
            let mut cur = LambdaCursor::new(&c, MAX_REDUCTION_STEPS);
            let t0 = Instant::now();
            let ev = black_box(cur.next());
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("event={:?} status={:?} steps={}", ev, cur.status(), cur.steps_taken()), false)
        },
    );

    ramp(
        "c == c.clone() — the ptr_eq fast path",
        "term.rs:152; both sides are ONE allocation, so this must short-circuit at the root",
        |n| {
            let c = doubling_chain(n);
            let d = c.clone();
            let t0 = Instant::now();
            let eq = black_box(c == d);
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("eq={eq} (same allocation)"), false)
        },
    );

    ramp(
        "c == d — structurally equal, separately built",
        "the ptr_eq path cannot fire; term.rs:155-160 walks both logical trees",
        |n| {
            let c = doubling_chain(n);
            let d = doubling_chain(n);
            let t0 = Instant::now();
            let eq = black_box(c == d);
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("eq={eq} (distinct allocations, {} + {} of them)", n + 1, n + 1), false)
        },
    );

    ramp(
        "print_lambda(&c)",
        &format!("output is proportional to LOGICAL size; this ramp stops at {MAX_PRINT_BYTES} bytes of output"),
        |n| {
            let c = doubling_chain(n);
            let t0 = Instant::now();
            let s = print_lambda(&c);
            let secs = t0.elapsed().as_secs_f64();
            let bytes = s.len();
            drop(s);
            (secs, format!("output={bytes} bytes for {} allocations", n + 1), bytes > MAX_PRINT_BYTES)
        },
    );

    ramp("drop(c)", "term.rs:193-234, claimed to be the ONE traversal bounded by allocation count", |n| {
        let c = doubling_chain(n);
        let t0 = Instant::now();
        drop(black_box(c));
        let secs = t0.elapsed().as_secs_f64();
        (secs, format!("{} allocations freed", n + 1), false)
    });

    // The ramp above only reaches n=64. If `Drop` walked the logical tree, THIS would not return:
    // 2^1001 nodes. It returning at all is the claim's evidence; the time is the shape of it.
    for n in [100u32, 1_000, 10_000] {
        let c = doubling_chain(n);
        let phys = physical(&c);
        let t0 = Instant::now();
        drop(c);
        line(&format!("  drop at n={n:<6} {:>11.6}s  physical={phys} logical=2^{}", t0.elapsed().as_secs_f64(), n + 1));
    }
}

// --- part 2: reachability from a source program --------------------------------------------------

fn lower_src(src: &str) -> Option<LambdaTerm> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        line(&format!("  parse errors: {ds:?}"));
        return None;
    }
    let prog = prog?;
    let diags = redextape_core::typeck::typecheck(&prog);
    if diags.iter().any(|d| d.severity == redextape_core::Severity::Error) {
        line(&format!("  type errors: {diags:?}"));
        return None;
    }
    match lower(&desugar(&prog)) {
        Ok(t) => Some(t),
        Err(e) => {
            line(&format!("  lower error: {e:?}"));
            None
        }
    }
}

fn report(label: &str, t: &LambdaTerm) {
    let (p, l, d) = (physical(t), logical(t), depth(t));
    line(&format!(
        "  {label:<44} physical={p:<9} logical={:<24} ratio={:>12.2}x depth={d}",
        fmt_count(l),
        l / p as f64
    ));
}

/// `m+1` nested groups of two mutually recursive functions. Each level's pair is declared INSIDE the
/// previous level's `f`, which is what makes the nesting compose: `lower_group` clones `group` once
/// per member, and `group` contains every member's lowered value.
fn nested_groups_src(m: u32) -> String {
    let mut body = format!("n + g{m}(n)");
    for k in (0..m).rev() {
        let j = k + 1;
        body = format!("fn f{j}(n) {{ {body} }} fn g{j}(n) {{ f{j}(n) }} g{j}(n) + g{k}(n)");
    }
    format!("fn f0(n) {{ {body} }} fn g0(n) {{ f0(n) }} g0(1)")
}

fn part2() {
    head("PART 2 — reachability from source");

    line("");
    line("--- 2a: does parse_lambda introduce sharing? ---");
    for src in ["(\\x. x x) (\\x. x x)", "\\f. (\\x. f (x x)) (\\x. f (x x))", "\\a. \\b. a (a (a b))"] {
        let (t, ds) = parse_lambda(src);
        match t {
            Some(t) => report(&format!("parse_lambda {src:?}"), &t),
            None => line(&format!("  parse_lambda {src:?} failed: {ds:?}")),
        }
    }
    // Round trip: printing a shared term materializes the sharing, and re-parsing it gives a term
    // with as many allocations as the printed text has nodes. This is the sharing hazard's inverse
    // and the reason a printed term is not a cheap way to carry one.
    // Closed (the chain's leaf is `var(0)`, so a binder over it is what makes the text re-parseable —
    // `print_lambda` renders a free index as `?0`, which is deliberately not an identifier).
    let c = redextape_core::lambda::term::abs("x", doubling_chain(8));
    report("hand-built doubling chain, n=8, closed", &c);
    let text = print_lambda(&c);
    let (round, _) = parse_lambda(&text);
    match round {
        Some(r) => report(&format!("  ... printed ({} bytes) and re-parsed", text.len()), &r),
        None => line("  round-trip parse failed"),
    }

    line("");
    line("--- 2b: the corpus baseline (the terms `lower` returns today) ---");
    let corpus = [
        ("sum(5)", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
        ("while loop", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
        ("1 + 2 * 3", "1 + 2 * 3"),
        (
            "two mutually recursive fns",
            "fn even(n) { if n == 0 { 1 } else { odd(n - 1) } } fn odd(n) { if n == 0 { 0 } else { even(n - 1) } } even(4)",
        ),
        (
            "three mutually recursive fns",
            "fn a(n) { if n == 0 { 1 } else { b(n - 1) } } fn b(n) { if n == 0 { 2 } else { c(n - 1) } } fn c(n) { if n == 0 { 3 } else { a(n - 1) } } a(5)",
        ),
        (
            "three mutable variables",
            "let mut a = 1; let mut b = 2; let mut c = 3; a = b + c; b = a + c; c = a + b; a = b + c; a",
        ),
    ];
    for (label, src) in corpus {
        match lower_src(src) {
            Some(t) => report(label, &t),
            None => line(&format!("  {label}: did not lower")),
        }
    }

    line("");
    line("--- 2c: nested mutually recursive groups, ramped ---");
    line(&format!("    m=1 source: {}", nested_groups_src(1)));
    ramp(
        "logical/physical of lower()'s output",
        "n = number of NESTED groups; each level is a 2-member SCC declared inside the previous level's `f`",
        |n| {
            let src = nested_groups_src(n - 1);
            let t0 = Instant::now();
            let t = lower_src(&src);
            let secs = t0.elapsed().as_secs_f64();
            match t {
                Some(t) => {
                    let (p, l, d) = (physical(&t), logical(&t), depth(&t));
                    (
                        secs,
                        format!(
                            "src={:<7}B physical={p:<8} logical={:<24} ratio={:>12.2}x depth={d}",
                            src.len(),
                            fmt_count(l),
                            l / p as f64
                        ),
                        false,
                    )
                }
                None => (secs, "did not lower".to_string(), true),
            }
        },
    );

    line("");
    line("--- 2d: what that costs the consumer that runs first ---");
    ramp(
        "depth_exceeds on lower()'s output",
        "the cursor's pre-step guard, on the term from 2c; this runs BEFORE any β-step",
        |n| {
            let Some(t) = lower_src(&nested_groups_src(n - 1)) else {
                return (0.0, "did not lower".to_string(), true);
            };
            let l = logical(&t);
            let t0 = Instant::now();
            let over = black_box(depth_exceeds(&t, MAX_TERM_DEPTH));
            let secs = t0.elapsed().as_secs_f64();
            (secs, format!("logical={:<24} exceeds={over}", fmt_count(l)), false)
        },
    );

    line("");
    line("--- 2e: and what it costs the printer ---");
    ramp(
        "print_lambda on lower()'s output",
        &format!("stops at {MAX_PRINT_BYTES} bytes of output — the next size doubles it"),
        |n| {
            let Some(t) = lower_src(&nested_groups_src(n - 1)) else {
                return (0.0, "did not lower".to_string(), true);
            };
            let t0 = Instant::now();
            let s = print_lambda(&t);
            let secs = t0.elapsed().as_secs_f64();
            let bytes = s.len();
            drop(s);
            (secs, format!("output={bytes} bytes"), bytes > MAX_PRINT_BYTES)
        },
    );
}

// --- opt-in: drive a cursor, bounded by an explicit node ceiling ----------------------------------

/// The only section that reduces anything. Bounded three ways: the term is only stepped when its
/// logical size is under `LOGICAL_CEILING`, the walk stops the moment the CURRENT term passes
/// `NODE_CEILING` allocations, and the step count is capped. One term is held at a time — the cursor
/// holds exactly one by construction, and nothing here keeps a snapshot.
fn part_step() {
    const LOGICAL_CEILING: f64 = 200_000.0;
    const NODE_CEILING: usize = 1_000_000;
    const STEP_CAP: u64 = 2_000;

    head("STEP — driving a LambdaCursor over the reachable shape");
    line(&format!(
        "  bounds: logical<{LOGICAL_CEILING:.0} to start, stop at {NODE_CEILING} live allocations or {STEP_CAP} steps"
    ));
    for m in 0..12u32 {
        let Some(t) = lower_src(&nested_groups_src(m)) else { break };
        let l = logical(&t);
        if l > LOGICAL_CEILING {
            line(&format!("  m={m}: logical={} over the ceiling — not stepped", fmt_count(l)));
            break;
        }
        let start_phys = physical(&t);
        let mut cur = LambdaCursor::new(&t, STEP_CAP);
        let t0 = Instant::now();
        let mut steps = 0u64;
        let mut peak = start_phys;
        while cur.next().is_some() {
            steps += 1;
            if steps.is_multiple_of(16) {
                let p = physical(cur.term());
                peak = peak.max(p);
                if p > NODE_CEILING {
                    break;
                }
            }
            if t0.elapsed().as_secs_f64() > BUDGET_S {
                break;
            }
        }
        let final_logical = logical(cur.term());
        let final_phys = physical(cur.term());
        line(&format!(
            "  m={m:<3} {:>9.4}s steps={steps:<6} start: phys={start_phys} logical={} | end: phys={final_phys} logical={} ratio={:.2}x peak_phys={peak} status={:?}",
            t0.elapsed().as_secs_f64(),
            fmt_count(l),
            fmt_count(final_logical),
            final_logical / final_phys as f64,
            cur.status()
        ));
    }
}

/// Where the ordinary `lower` -> reduce path stops making progress. Opt-in, and the ONLY section with
/// no bound of its own on what one step may do.
///
/// MEASURED 2026-07-31: it does NOT get OOM-killed, which is what it was built expecting. Up to nine
/// nesting levels it survives a 2 GiB cgroup; at ten a SINGLE β-step had not returned after 13
/// minutes, with peak RSS at 974 MB and creeping ~1 MB per 40 s — the reducer allocates and frees
/// gigabyte-scale terms inside one `reduce_step` rather than accumulating toward a limit. The failure
/// this section actually finds is a hang, not an allocation failure. Stop it by hand.
///
/// NOTHING IN-PROCESS CAN BOUND THIS, which is why the bound is external. A β-step's output is
/// `shift(-1, 0, subst(0, shift(1, 0, arg), body))` — every occurrence of the bound variable in `body`
/// is replaced by `arg` and the whole result is then deep-copied by the outer `shift`, so ONE step can
/// produce on the order of |body| x |arg| LOGICAL nodes as real allocations. A guard that checked the
/// term's size between steps would therefore be reading a number that says nothing about what the next
/// step is about to allocate. `part_step`'s node ceiling is honest only because it runs at sizes where
/// the product is small.
///
/// So: run this under `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0`. Each `m`
/// prints its "before" line and flushes it BEFORE stepping, so the transcript names the size that is
/// stuck (or that died) whether or not the process survives to report it. The wall budget below is
/// checked BETWEEN steps and so overshoots badly — 90 s produced a 330 s run at nine levels. That
/// overshoot is a measurement, not a bug in the harness: it is what "a step cannot be interrupted"
/// looks like from outside.
fn part_oom() {
    const STEP_CAP: u64 = 1_000;
    const WALL_S: f64 = 90.0;

    head("OOM — where lower + reduce stops making progress");
    line(&format!("  cursor cap {STEP_CAP} steps, {WALL_S:.0}s per size; no snapshots, one term alive at a time"));
    for m in 0..12u32 {
        let src = nested_groups_src(m);
        let Some(t) = lower_src(&src) else { break };
        line(&format!(
            "  m={m:<3} src={:<5}B start: phys={} logical={} — stepping now",
            src.len(),
            physical(&t),
            fmt_count(logical(&t))
        ));
        let mut cur = LambdaCursor::new(&t, STEP_CAP);
        drop(t);
        let t0 = Instant::now();
        let mut steps = 0u64;
        while cur.next().is_some() {
            steps += 1;
            if t0.elapsed().as_secs_f64() > WALL_S {
                break;
            }
        }
        // Deliberately does NOT measure the final term: counting its allocations needs a set as large
        // as the term, which at these sizes is itself a second copy of the problem.
        line(&format!(
            "  m={m:<3} survived  {:>9.3}s steps={steps} status={:?}",
            t0.elapsed().as_secs_f64(),
            cur.status()
        ));
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let want = |name: &str| args.is_empty() || args.iter().any(|a| a == name);
    line("blowup_probe — logical vs physical size of an Rc-backed LambdaTerm");
    line(&format!("  MAX_TERM_DEPTH={MAX_TERM_DEPTH}, per-size budget={BUDGET_S}s, ramp ceiling n={MAX_N}"));
    // What a "node" costs, so a node count can be read as memory: one `Rc` allocation is the `Node`
    // plus the strong and weak counts `Rc` stores ahead of it.
    let node = std::mem::size_of::<Node>();
    line(&format!("  size_of::<Node>()={node}B; one Rc allocation is {node}+16={}B", node + 16));
    // Printed, not only documented. This target is a hazard demonstrator and the transcript is the
    // artifact people keep; a transcript that does not carry the running condition invites a re-run
    // without it.
    line("  RUN EVERY SECTION UNDER: systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0");
    if want("part1") {
        part1();
    }
    if want("part2") {
        part2();
    }
    // Opt-in only: this is the one section that allocates in proportion to what it discovers.
    if args.iter().any(|a| a == "step") {
        part_step();
    }
    // Opt-in. Named for what it was BUILT expecting — an OOM kill at the size that answers the
    // question — and kept under that name because the transcripts and the design's §10 use it. What
    // it actually finds is a hang: see `part_oom`'s doc comment.
    if args.iter().any(|a| a == "oom") {
        part_oom();
    }
}
