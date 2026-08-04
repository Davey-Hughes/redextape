//! The instrument for `docs/superpowers/specs/2026-08-01-interpreter-concurrency-design.md`: **it is the
//! re-runnable source for every figure that document's five rejections and two proposals rest on.**
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --example concurrency_probe
//! ```
//!
//! **`--release` is not optional here and neither is the cap.** Every figure is a timing, and a debug
//! build measures the wrong program — the design's whole argument is a ratio between a ~13 ns step and a
//! ~2,200 ns rendezvous, and an unoptimized build moves only one of those. The memory cap is the same
//! rule `shift_cost_probe.rs` states at length: Part G/H reduce real λ terms, an earlier measurement over
//! that path took 60 GiB of RAM and 29 GiB of swap and wedged the machine, and `MemorySwapMax=0` is the
//! load-bearing half. An OOM-kill or a timeout is a RESULT to report, not something to work around by
//! raising the cap.
//!
//! **Never `reduce_trace` in this file.** Parts G and H drive `trace::LambdaCursor`, which holds ONE term
//! at a time; `reduce_trace` materialises every step's term by contract, and that is exactly how the
//! 60 GiB run happened. Part E drives `trace::TmCursor` for the same reason — `simulate_trace` allocates
//! a tape snapshot per step, which Part F measures at 75x the untraced step and which would dominate the
//! very distribution Part E exists to report. Rows are flushed BEFORE the next is computed, so an
//! OOM-kill leaves the completed table on stdout instead of losing it.
//!
//! # WHAT IT MEASURES, AND WHICH CLAIM EACH PART CARRIES
//!
//! Lettered to match the design's §10, which specifies this file:
//!
//! - **A** ns per δ-step, from whole-run repeats rather than a per-step timer (§2).
//! - **B** k-thread barrier cost and the derived break-even work-per-step — the ratio that rejects every
//!   intra-run parallel scheme (§3).
//! - **C** non-atomic vs. uncontended vs. contended RMW: the `Rc` -> `Arc` tax (§6).
//! - **D** dispatch profile — states visited, top-10 step share, static and dynamic rules/state (§4).
//! - **E** same-state and same-(state, rule) run-length distribution, over the corpus x both encodings.
//!   **This is the table a fusion slice is calibrated against** (§8.1), and open question 1 is precisely
//!   whether it holds beyond one program under one encoding.
//! - **F** `simulate_trace` ns/step against untraced (§3's snapshot result).
//! - **G** λ redex-path profile. **Four of its five columns exist to keep a NEGATIVE result falsifiable:**
//!   §8.2 concludes that run fusion does not carry to λ because same-path runs average ~1.3 steps against
//!   the TM's 37. If that number ever approaches the TM's, the conclusion flips and fusion becomes a λ
//!   optimization after all. The fifth column — retraced descent — is the positive finding.
//! - **H** ns per β-step. **§8.2 has no wall-clock number and cannot get one without this.**
//!
//! # WHAT IT FOUND (2026-08-01, 32 logical CPUs)
//!
//! A full δ-step is **12.99 ns**; a 5-thread barrier is **2,063 ns**, or **159x the entire step it would
//! be parallelizing**. Break-even for a 5-way split needs ~200x more work per step than exists, and k = 2
//! is no kinder (a cheaper barrier, a worse k/(k-1)). That single ratio is what rejects parallel `apply`,
//! and it is why a thread pool does not help: a pool removes thread *creation*, and the cost is the
//! *rejoin*.
//!
//! The strongest form of the result is Part F. `Tape::snapshot` is the only genuinely O(cells) per-tape
//! operation in either interpreter — five independent tapes, real work in each, 1,011 ns/step. Split
//! perfectly across five threads it is **still 2.25x slower** than sequential, because the barrier is
//! larger than the whole traced step.
//!
//! What survives is sequential, and both loops carry the same defect — recomputing per step a quantity the
//! previous step already knew, the class `depth_exceeds` cost 187.6 s of 195.7 s to before `depth` was
//! stored.
//!
//! **WRITING THIS FILE CHANGED TWO CONCLUSIONS THE THROWAWAY HARNESS HAD REACHED, which is the argument
//! for the probe discipline rather than an accident of it.**
//!
//!   1. **Part E: `Binary` is not `Unary`.** Under `Unary` the corpus confirms the single-program figure
//!      (mean run 38.56 vs `map`'s 37.09; 99.3% of steps in a run >= 2). Under `Binary` the mean run is
//!      **7.77** — five times shorter, and far more skewed (longest 1,431). A fused op costing `c`
//!      ordinary steps turns a run of `R` into `c`, so the win is ~`R/c`: at the pessimistic `c = 10` the
//!      first draft used, `Unary` gives ~3.9x and **`Binary` gives 0.78x — a LOSS**. The design's "~3.7x
//!      across the board" did not survive running the second encoding.
//!   2. **Part H: a β-step is 1,323 ns, ~102x a δ-step.** Part G's headline — **93.7% of all λ descent
//!      retraces the previous step's path** — is a large share of a SMALL thing: ~8.7 spine nodes against
//!      a 1,323 ns step. The zipper it argues for is a single-digit-percent lever, and the standing
//!      `subst` re-shift target (which attacks where that 1,323 ns lives) should land first.
//!
//! Part G's negative result did survive the corpus, and is stated with more confidence than the positive
//! one it contrasts with: same-redex-path runs average **1.22** against the TM's 38.56, and consecutive
//! root redexes are 1.3%, so there is nothing to fuse in λ and n-ary β has no surface.
//!
//! # ALLOCATOR — READ THIS BEFORE TRUSTING ANY TIMING ABOVE
//!
//! **This target has set `mimalloc` as its global allocator since 2026-08-04. Every timing recorded
//! in this file above this note was measured under glibc's malloc and is NOT comparable to a run
//! made today.** Counts are: node counts, allocation counts and step counts are properties of the
//! reduction, not of the machine, and did not move. Seconds, ms and ns did.
//!
//! It is here for a measured reason rather than a preference. The reducer allocates one `Rc<Node>`
//! per term node and frees on the same order, and glibc's layout for that pattern costs real
//! address-translation pressure: on the nested-group family, swapping ONLY the allocator took L1
//! DTLB misses from 1.20e9 to 0.92e9 for the three-pass `beta` and from 1.83e9 to 0.93e9 for the
//! fused one, with the wall clock following at ~9% and ~16%. That is also how the β-fusion family
//! regression was explained — it was glibc's layout, not the reducer's work.
//!
//! `mimalloc` is a `[dev-dependencies]` entry and reaches examples and tests ONLY.
//! `redextape-core`'s `[dependencies]` stays empty and WASM-clean: `libmimalloc-sys` is C that does
//! not build for wasm32, and a library must not choose a global allocator for its consumers.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

#[cfg(not(target_arch = "wasm32"))]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Barrier};
use std::time::Instant;

use redextape_core::core::Core;
use redextape_core::desugar::desugar;
use redextape_core::lambda::lower;
use redextape_core::lambda::reduce::MAX_REDUCTION_STEPS;
use redextape_core::lambda::term::{Dir, LambdaTerm};
use redextape_core::parser::parse;
use redextape_core::tm::build::{REG, TAPES, WORK};
use redextape_core::tm::machine::Machine;
use redextape_core::tm::sim::DEFAULT_CAPS;
use redextape_core::tm::{
    Binary, Encoding, Unary, defunc, lower_asm, lower_tm_guarded, n_slots_of, simulate, simulate_trace,
};
use redextape_core::trace::{LambdaCursor, StepEvent, TmCursor};

/// Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS` (comments stripped).
///
/// THIS COPY IS COVERED. `three_way_oracle.rs`'s `first_order_demos_stay_synced_across_all_six_copies`
/// reads this file as text and asserts its literals are byte-for-byte equal to the canonical array's.
/// That test was extended from five to six when this file landed, which is the protocol its own doc
/// comment specifies: the enumeration method is `grep -rn FIRST_ORDER_DEMOS` over the whole tree, and the
/// count has been wrong twice by being maintained from memory instead. Nothing here needs a by-hand diff
/// before it is trusted.
const FIRST_ORDER_DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "if 1 == 2 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    "is_empty(nil)",
    "is_empty(cons(1, nil))",
    "[1, 2, 3]",
    "cons(1, cons(2, nil))",
    "head(cons(7, nil))",
    "tail(cons(7, nil))",
    "head(cons(1, cons(2, nil)))",
    "tail(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
    "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    "let n = 5; fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } [1, 2, 3].map(|x| x + n)",
    "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
        fn add(a, b) { a + b }\n\
        fn add1(x) { x + 1 }\n\
        fold([3, 1, 2].map(add1), 0, add)",
    "fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } \
     fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(5)",
    "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)",
    "fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } \
     fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } \
     fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(4, id)",
    "fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } \
     fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(3, id)",
    "fn ap(h,x){ h(x) } fn f(n){ ap(g, n) } fn g(n){ n + 1 } f(3)",
    "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } fn ap(g, x) { g(x) } ap(sum, 4) + sum(2)",
    "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
     fn add1(x) { x + 1 }\n\
     fn ap2(g, a, b) { g(a, b) }\n\
     head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))",
    "fn v(x) { x * 10 } fn b(x) { x + 1 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn b(x) { x + 1 } fn v(x) { x * 10 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)",
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } head(1) + ap(add1, 2)",
    "fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)",
    "let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)",
    "fn nil(x) { x + 5 } fn ap(g, x) { g(x) } ap(nil, 0)",
    "fn nil(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } nil(1) + ap(add1, 2)",
    "fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)",
];

/// The program Parts A, B, D and F are timed on. `map` is the corpus's canonical higher-order demo — it
/// routes through `defunc`, so it exercises the dispatcher states rather than only straight-line gadgets,
/// and at ~345k steps it is long enough to time by whole-run repeats.
const TIMED: &str = "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
                     fn add1(x) { x + 1 } [3, 1, 2].map(add1)";

/// Threads fanned out in Part B. `TAPES` is the count a per-tape scheme would actually need; the wider
/// rows show the cost is not an artifact of picking a small k.
const BARRIER_THREADS: &[usize] = &[2, TAPES, 8];

fn flush() {
    let _ = std::io::stdout().flush();
}

fn core_of(src: &str) -> Option<Core> {
    let (prog, ds) = parse(src);
    if !ds.is_empty() {
        return None;
    }
    Some(desugar(&prog?))
}

/// Lower to a machine plus its initial tapes, defunctionalizing first if the direct path declines.
fn machine_of(src: &str, enc: &dyn Encoding) -> Option<(Machine, Vec<Vec<char>>)> {
    let core = core_of(src)?;
    let program = match lower_asm(&core) {
        Ok(p) => p,
        Err(_) => lower_asm(&defunc(&core).ok()?).ok()?,
    };
    let (m, _overflow) = lower_tm_guarded(&program, enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots_of(&program));
    init[WORK] = enc.init_work();
    Some((m, init))
}

fn main() {
    let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0);
    println!("host: {cpus} logical CPUs (every figure below is meaningless without this)");
    println!(
        "build: {}\n",
        if cfg!(debug_assertions) { "DEBUG — figures are NOT valid, re-run --release" } else { "release" }
    );
    flush();

    let (m, init) = machine_of(TIMED, &Unary::default()).expect("the timed program lowers under Unary");
    let ns_per_step = part_a(&m, &init);
    part_b(ns_per_step);
    part_c();
    part_d(&m, &init);
    part_e();
    part_f(&m, &init, ns_per_step);
    part_g();
    part_h();
}

// ---------------------------------------------------------------------------------------------------
// A — ns per δ-step
// ---------------------------------------------------------------------------------------------------

/// Times whole runs rather than individual steps: at ~13 ns/step an `Instant::now` pair per step would
/// measure the clock, not the simulator. Returns ns/step for Part B's break-even and Part F's ratio.
fn part_a(m: &Machine, init: &[Vec<char>]) -> f64 {
    println!("[A] full δ-step — state lookup + accept/cap checks + rule scan + apply over {TAPES} tapes");
    let steps = count_steps(m, init);
    let reps = 200u32;
    let _ = simulate(m, init, DEFAULT_CAPS); // warm
    let t0 = Instant::now();
    for _ in 0..reps {
        std::hint::black_box(simulate(m, init, DEFAULT_CAPS));
    }
    let elapsed = t0.elapsed();
    let total = u64::from(reps) * steps;
    let ns = elapsed.as_nanos() as f64 / total as f64;
    println!("    machine: {} states, {} tapes, {steps} steps to halt", m.states.len(), m.tapes);
    println!("    {reps} runs x {steps} steps = {total} steps in {elapsed:?}");
    println!("    => {ns:.2} ns per δ-step ({:.1} M steps/s)", 1000.0 / ns);
    println!("    => {:.2} ns per tape-slot of `apply` (upper bound: whole step / {TAPES})\n", ns / TAPES as f64);
    flush();
    ns
}

fn count_steps(m: &Machine, init: &[Vec<char>]) -> u64 {
    TmCursor::new(m, init, DEFAULT_CAPS).count() as u64
}

// ---------------------------------------------------------------------------------------------------
// B — the barrier, and the break-even it implies
// ---------------------------------------------------------------------------------------------------

/// The rejoin cost a per-tape scheme cannot avoid: the next δ-step cannot start until every tape from
/// this one is written, because `rule_matches` reads all `TAPES` heads.
fn part_b(ns_per_step: f64) {
    println!("[B] k-thread barrier rendezvous — the per-step rejoin a tape-parallel scheme must pay");
    println!("    {:>3}  {:>12}  {:>10}  {:>16}", "k", "ns/barrier", "x δ-step", "break-even work");
    for &k in BARRIER_THREADS {
        let iters = 100_000u64;
        let barrier = Arc::new(Barrier::new(k));
        let t0 = Instant::now();
        std::thread::scope(|s| {
            for _ in 0..k {
                let b = Arc::clone(&barrier);
                s.spawn(move || {
                    for _ in 0..iters {
                        std::hint::black_box(b.wait());
                    }
                });
            }
        });
        let per = t0.elapsed().as_nanos() as f64 / iters as f64;
        // A k-way split pays off when W/k + barrier < W, i.e. W > barrier * k/(k-1).
        let break_even = per * k as f64 / (k as f64 - 1.0);
        println!(
            "    {k:>3}  {per:>12.1}  {:>9.0}x  {:>13.0} ns  ({:.0}x today's step)",
            per / ns_per_step,
            break_even,
            break_even / ns_per_step
        );
    }
    println!("    A thread POOL does not address this: a pool removes thread creation, not the rejoin.");
    println!("    An async runtime is worse by category — there is nothing blocking here to hide.\n");
    flush();
}

// ---------------------------------------------------------------------------------------------------
// C — the Rc -> Arc tax
// ---------------------------------------------------------------------------------------------------

/// Prices what any thread-level λ scheme must pay first. `LambdaTerm` is `Rc<Node>` and `Rc` is not
/// `Send`; after the 2026-08-01 sharing fixes the reducer's fast paths ARE refcount bumps (`subst`'s
/// `Var` arm, both `maxfree` short-circuits, `reduce_step`'s untouched sibling).
fn part_c() {
    println!("[C] refcount bump: what `Rc` -> `Arc` would cost on the λ hot path");
    let n = 20_000_000u64;

    let mut plain = 0u64;
    let t0 = Instant::now();
    for _ in 0..n {
        plain += 1;
        std::hint::black_box(plain);
    }
    let plain_ns = t0.elapsed().as_nanos() as f64 / n as f64;

    let a = Arc::new(AtomicU64::new(0));
    let t0 = Instant::now();
    for _ in 0..n {
        std::hint::black_box(a.fetch_add(1, Ordering::Relaxed));
    }
    let uncontended = t0.elapsed().as_nanos() as f64 / n as f64;

    let threads = 8usize;
    let per = n / threads as u64;
    let t0 = Instant::now();
    std::thread::scope(|s| {
        for _ in 0..threads {
            let a = Arc::clone(&a);
            s.spawn(move || {
                for _ in 0..per {
                    std::hint::black_box(a.fetch_add(1, Ordering::Relaxed));
                }
            });
        }
    });
    let contended = t0.elapsed().as_nanos() as f64 / (per * threads as u64) as f64;

    println!("    non-atomic increment (~ an `Rc` bump):     {plain_ns:>6.2} ns");
    println!("    atomic fetch_add, 1 thread:                {uncontended:>6.2} ns  ({:.1}x)", uncontended / plain_ns);
    println!(
        "    atomic fetch_add, {threads} threads contended:      {contended:>6.2} ns  ({:.1}x)\n",
        contended / plain_ns
    );
    flush();
}

// ---------------------------------------------------------------------------------------------------
// D — dispatch profile
// ---------------------------------------------------------------------------------------------------

/// Taken expecting the classic interpreter-dispatch failure (one indirect branch, thousands of targets)
/// and finding the opposite: entropy is maximal, but Part E's runs make last-target prediction hit, so
/// the hardware already predicts this workload. There is no misprediction for speculation to recover.
fn part_d(m: &Machine, init: &[Vec<char>]) {
    println!("[D] dispatch profile — is the indirect branch the problem?");
    let mut counts = vec![0u64; m.states.len()];
    let mut dyn_rules = 0u64;
    let mut steps = 0u64;
    for e in TmCursor::new(m, init, DEFAULT_CAPS) {
        if let StepEvent::Delta { state, .. } = e
            && let Some(slot) = counts.get_mut(state as usize)
        {
            *slot = slot.saturating_add(1);
            dyn_rules += m.states[state as usize].rules.len() as u64;
            steps += 1;
        }
    }
    let visited = counts.iter().filter(|&&c| c > 0).count();
    let mut ranked: Vec<u64> = counts.iter().copied().filter(|&c| c > 0).collect();
    ranked.sort_unstable_by(|a, b| b.cmp(a));
    let top10: u64 = ranked.iter().take(10).sum();
    let widths: Vec<usize> = m.states.iter().map(|s| s.rules.len()).collect();
    println!("    states in machine:                {}", m.states.len());
    println!("    distinct states visited:          {visited}");
    println!("    top-10 states' share of steps:    {:.1}%", 100.0 * top10 as f64 / steps as f64);
    println!(
        "    rules/state: static mean {:.2}, max {}; dynamic mean {:.2}\n",
        widths.iter().sum::<usize>() as f64 / widths.len() as f64,
        widths.iter().copied().max().unwrap_or(0),
        dyn_rules as f64 / steps as f64
    );
    flush();
}

// ---------------------------------------------------------------------------------------------------
// E — run-length distribution: the fusion case
// ---------------------------------------------------------------------------------------------------

/// Streams `TmCursor` rather than `simulate_trace`: the distribution must not be measured through the
/// per-step snapshot Part F prices at 75x. Reports BOTH same-state runs (what a sweep looks like) and
/// same-(state, rule) runs (what is STRICTLY fusable — an identical transition firing again).
fn part_e() {
    println!("[E] same-state run lengths — the fusion case, over the corpus x both encodings");
    println!("    (open question 1: does §8.1's 99.3% hold beyond one program under one encoding?)");
    println!(
        "    {:<8} {:>4} {:>9} {:>8} {:>6} {:>9} {:>10}",
        "encoding", "n", "steps", "meanrun", "max", "in>=2", "fusable"
    );
    for (label, enc) in [("unary", &Unary::default() as &dyn Encoding), ("binary", &Binary::default())] {
        let (mut progs, mut steps, mut runs, mut longest, mut in_runs, mut fusable) =
            (0u64, 0u64, 0u64, 0u64, 0u64, 0u64);
        for src in FIRST_ORDER_DEMOS {
            let Some((m, init)) = machine_of(src, enc) else { continue };
            let mut prev: Option<(u32, u32)> = None;
            let mut state_run = 0u64;
            let mut pair_run = 0u64;
            let (mut p_steps, mut p_runs, mut p_in, mut p_fus, mut p_max) = (0u64, 0u64, 0u64, 0u64, 0u64);
            for e in TmCursor::new(&m, &init, DEFAULT_CAPS) {
                let StepEvent::Delta { state, rule } = e else { continue };
                p_steps += 1;
                match prev {
                    Some((ps, _)) if ps == state => state_run += 1,
                    _ => {
                        if state_run >= 2 {
                            p_in += state_run;
                        }
                        p_max = p_max.max(state_run);
                        p_runs += 1;
                        state_run = 1;
                    }
                }
                match prev {
                    Some(k) if k == (state, rule) => pair_run += 1,
                    _ => {
                        if pair_run >= 2 {
                            p_fus += pair_run;
                        }
                        pair_run = 1;
                    }
                }
                prev = Some((state, rule));
            }
            if state_run >= 2 {
                p_in += state_run;
            }
            if pair_run >= 2 {
                p_fus += pair_run;
            }
            p_max = p_max.max(state_run);
            if p_steps == 0 {
                continue;
            }
            progs += 1;
            steps += p_steps;
            runs += p_runs;
            longest = longest.max(p_max);
            in_runs += p_in;
            fusable += p_fus;
        }
        println!(
            "    {label:<8} {progs:>4} {steps:>9} {:>8.2} {longest:>6} {:>8.1}% {:>9.1}%",
            steps as f64 / runs.max(1) as f64,
            100.0 * in_runs as f64 / steps.max(1) as f64,
            100.0 * fusable as f64 / steps.max(1) as f64,
        );
        flush();
    }
    println!(
        "    fusable = share of steps repeating the IMMEDIATELY PRECEDING (state, rule) — the bulk-appliable case\n"
    );
    flush();
}

// ---------------------------------------------------------------------------------------------------
// F — what tracing costs
// ---------------------------------------------------------------------------------------------------

/// `Tape::snapshot` is the only genuinely O(cells) per-tape operation in either interpreter — the single
/// most favourable case for a per-tape split anywhere in this codebase, and it still loses to Part B's
/// barrier. That is the strongest form of §3's rejection.
fn part_f(m: &Machine, init: &[Vec<char>], ns_per_step: f64) {
    println!("[F] `simulate_trace` — the one O(cells) per-tape operation, and whether splitting it could pay");
    let steps = count_steps(m, init);
    let reps = 5u32;
    let t0 = Instant::now();
    for _ in 0..reps {
        std::hint::black_box(simulate_trace(m, init, DEFAULT_CAPS));
    }
    let traced = t0.elapsed().as_nanos() as f64 / (f64::from(reps) * steps as f64);
    println!("    traced {traced:.1} ns/step vs untraced {ns_per_step:.2} ns/step ({:.0}x)", traced / ns_per_step);
    // Re-derive the barrier for this comparison rather than threading Part B's value through.
    let iters = 100_000u64;
    let barrier = Arc::new(Barrier::new(TAPES));
    let t0 = Instant::now();
    std::thread::scope(|s| {
        for _ in 0..TAPES {
            let b = Arc::clone(&barrier);
            s.spawn(move || {
                for _ in 0..iters {
                    std::hint::black_box(b.wait());
                }
            });
        }
    });
    let bar = t0.elapsed().as_nanos() as f64 / iters as f64;
    let split = traced / TAPES as f64 + bar;
    println!(
        "    perfect {TAPES}-way split: {:.0}/{} + {bar:.0} = {split:.0} ns vs {traced:.0} ns sequential",
        traced, TAPES
    );
    println!(
        "    => {:.2}x {} than sequential\n",
        (split / traced).max(traced / split),
        if split > traced { "SLOWER" } else { "faster" }
    );
    flush();
}

// ---------------------------------------------------------------------------------------------------
// G — λ redex-path profile
// ---------------------------------------------------------------------------------------------------

/// The λ analogue of Part E, and the four run columns exist to keep a NEGATIVE result falsifiable: if
/// `run>=2` and `meanrun` ever approach the TM's 99.3% / 37.09, §8.2's conclusion flips. `prefix%` is the
/// positive finding — descent that retraces the path the previous step already walked, which
/// `reduce_step` pays because it re-enters from the root and rebuilds the spine coming back up.
///
/// Streams: only the previous path is retained, so this is O(depth) memory rather than O(steps).
fn part_g() {
    println!("[G] λ redex-path profile — does §8.1's fusion carry to the reducer?");
    println!(
        "    {:<10} {:>7} {:>8} {:>5} {:>8} {:>8} {:>7} {:>8}",
        "program", "steps", "meanlen", "max", "run>=2", "meanrun", "root", "prefix"
    );
    let (mut t_steps, mut t_len, mut t_prefix, mut t_in, mut t_root, mut t_runs) = (0u64, 0u64, 0u64, 0u64, 0u64, 0u64);
    for (i, src) in FIRST_ORDER_DEMOS.iter().enumerate() {
        let Some(core) = core_of(src) else { continue };
        let Ok(term) = lower(&core) else { continue }; // λ declines a few programs by design
        let Some(s) = path_stats(&term) else { continue };
        if s.steps >= 25 {
            println!(
                "    {:<10} {:>7} {:>8.2} {:>5} {:>7.1}% {:>8.2} {:>6.1}% {:>7.1}%",
                format!("#{i}"),
                s.steps,
                s.sum_len as f64 / s.steps as f64,
                s.max_len,
                100.0 * s.in_runs as f64 / s.steps as f64,
                s.steps as f64 / s.runs.max(1) as f64,
                100.0 * s.root as f64 / s.steps as f64,
                100.0 * s.prefix as f64 / s.sum_len.max(1) as f64,
            );
            flush();
        }
        t_steps += s.steps;
        t_len += s.sum_len;
        t_prefix += s.prefix;
        t_in += s.in_runs;
        t_root += s.root;
        t_runs += s.runs;
    }
    println!(
        "    {:<10} {t_steps:>7} {:>8.2} {:>5} {:>7.1}% {:>8.2} {:>6.1}% {:>7.1}%",
        "ALL",
        t_len as f64 / t_steps.max(1) as f64,
        "-",
        100.0 * t_in as f64 / t_steps.max(1) as f64,
        t_steps as f64 / t_runs.max(1) as f64,
        100.0 * t_root as f64 / t_steps.max(1) as f64,
        100.0 * t_prefix as f64 / t_len.max(1) as f64,
    );
    println!("    rows shown for programs with >= 25 β-steps; ALL is every program that lowers");
    println!("    run>=2/meanrun  same-redex-path runs — the TM analogue. COMPARE TO PART E's 99.3% / 37.09.");
    println!("    root            steps in a run of >= 2 consecutive ROOT redexes (the n-ary β surface)");
    println!("    prefix          descent that RETRACES the previous step's path — the zipper's target\n");
    flush();
}

#[derive(Default)]
struct PathStats {
    steps: u64,
    sum_len: u64,
    max_len: usize,
    runs: u64,
    in_runs: u64,
    root: u64,
    prefix: u64,
}

fn path_stats(term: &LambdaTerm) -> Option<PathStats> {
    let mut s = PathStats::default();
    let mut prev: Option<Vec<Dir>> = None;
    let mut run = 0u64;
    let mut root_run = 0u64;
    for e in LambdaCursor::new(term, MAX_REDUCTION_STEPS) {
        let StepEvent::Beta { redex } = e else { continue };
        s.steps += 1;
        s.sum_len += redex.len() as u64;
        s.max_len = s.max_len.max(redex.len());
        if redex.is_empty() {
            root_run += 1;
        } else {
            if root_run >= 2 {
                s.root += root_run;
            }
            root_run = 0;
        }
        match &prev {
            Some(p) => {
                s.prefix += p.iter().zip(&redex).take_while(|(a, b)| a == b).count() as u64;
                if *p == redex {
                    run += 1;
                } else {
                    if run >= 2 {
                        s.in_runs += run;
                    }
                    s.runs += 1;
                    run = 1;
                }
            }
            None => {
                s.runs += 1;
                run = 1;
            }
        }
        prev = Some(redex);
    }
    if run >= 2 {
        s.in_runs += run;
    }
    if root_run >= 2 {
        s.root += root_run;
    }
    (s.steps > 0).then_some(s)
}

// ---------------------------------------------------------------------------------------------------
// H — ns per β-step
// ---------------------------------------------------------------------------------------------------

/// **The measurement §8.2 cannot be sized without.** Part G's 95.1% is a ratio over DESCENT, and descent
/// is not the whole β-step — `subst` rebuilds the spine of whatever it descends into, and a zipper does
/// not touch that. Until a zipper exists to time against this baseline, no speedup may be quoted.
///
/// Drives `LambdaCursor` and discards the events, so one term is live at a time.
fn part_h() {
    println!("[H] ns per β-step — the baseline any §8.2 zipper must be timed against");
    println!("    {:<10} {:>8} {:>6} {:>12}", "program", "steps", "reps", "ns/β-step");
    let (mut t_ns, mut t_n) = (0f64, 0u64);
    for (i, src) in FIRST_ORDER_DEMOS.iter().enumerate() {
        let Some(core) = core_of(src) else { continue };
        let Ok(term) = lower(&core) else { continue };
        let steps = LambdaCursor::new(&term, MAX_REDUCTION_STEPS).count() as u64;
        if steps < 100 {
            continue;
        }
        let reps = 50u32;
        let t0 = Instant::now();
        for _ in 0..reps {
            std::hint::black_box(LambdaCursor::new(&term, MAX_REDUCTION_STEPS).count());
        }
        let ns = t0.elapsed().as_nanos() as f64 / (f64::from(reps) * steps as f64);
        println!("    {:<10} {steps:>8} {reps:>6} {ns:>12.1}", format!("#{i}"));
        flush();
        t_ns += ns * steps as f64;
        t_n += steps;
    }
    if t_n > 0 {
        println!("    {:<10} {t_n:>8} {:>6} {:>12.1}  (step-weighted mean)", "ALL", "-", t_ns / t_n as f64);
    }
    println!("    rows shown for programs with >= 100 β-steps\n");
    flush();
}
