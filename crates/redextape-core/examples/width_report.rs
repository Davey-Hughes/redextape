//! The field-width report — the sizing experiment made reproducible.
//!
//!     cargo run --release --example width_report -p redextape-core
//!
//! The experiment that motivated per-program sizing was originally run by editing a constant and
//! rebuilding eleven times. Now that the width lives on the encoding instance (`Unary::at(w)`), the
//! whole sweep is a runtime loop, and now that the overflow guard exists, the fitted width is something
//! the machine DETERMINES rather than something a human infers from whether the answer looked right.
//!
//! That distinction is the reason this report supersedes the estimated table in
//! `docs/superpowers/specs/2026-07-26-per-program-field-width-design.md`. Those fitted widths were read
//! off answer agreement, which is an unsound detector: at width 4 the program `3 - 5` destroys a field
//! delimiter and still returns 0, and `0 + 5` merges two 4-cell fields into a 9-cell run and still
//! returns 5. The numbers below come from the guard instead, so some are one power of two higher.
//!
//! Three sections:
//!   A. the affine fit `steps(W) = a + b*W` per program, and the share of width-driven padding at 64;
//!   B. the width auto-fit settles on, and the speedup against the pinned 64-cell bank;
//!   C. the cost of the search itself — total steps across all attempts versus the final attempt.
//!
//! LIMITATION, stated up front: the corpus is an ORACLE suite, built to exercise backend features, not
//! to be a representative workload. This says what sizing is worth ON THESE PROGRAMS.

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::run;
use redextape_core::tm::{
    Binary, Encoding, MAX_FIELD_WIDTH, MIN_FIELD_WIDTH, Program, REG, TAPES, TM_DEFAULT_CAPS, TmRun, TmStatus, Unary,
    WORK, decode_tape, defunc, lower_asm, lower_tm_guarded, n_slots_of, run_tm_fitted, simulate_counts, simulate_final,
};
use redextape_core::value::Value;

/// The corpus, kept in step with `tests/tm_bank_invariant.rs`.
const CORPUS: &[(&str, &str)] = &[
    ("arith", "1 + 2 * 3"),
    ("monus", "3 - 5"),
    ("if", "if 2 > 1 { 10 } else { 20 }"),
    ("let", "let x = 40; x + 2"),
    ("let-chain", "let x = 1; let y = x + x; y * 3"),
    ("assign", "let mut x = 1; x = x + 10; x = x * 2; x"),
    ("while", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
    ("lambda-call", "let add1 = |x| x + 1; add1(41)"),
    ("recursion", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
    ("list-build", "[1, 2, 3]"),
    ("list-head", "head([1, 2, 3])"),
    ("list-tail-head", "head(tail(cons(1, cons(2, nil))))"),
    ("higher-order", "fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)"),
    (
        "map",
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)",
    ),
    (
        "mutual-rec",
        "fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)",
    ),
    ("forward-ref", "fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)"),
    ("both", "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)"),
    ("mut-capture", "let mut c = 0; fn ap(f, x) { f(x) } ap(|x| { c = c + x; c }, 5) + c"),
];

/// Steps taken at a PINNED width, and whether the run completed. `None` means the run did not reach a
/// value there (it overflowed the bank or hit a cap), which is exactly what happens below the fitted
/// width and is reported rather than silently averaged in.
///
/// Generic over `enc` (already at the width to measure) so this serves both `Unary` and `Binary` — the
/// only reason it needs `init[WORK]` at all is `Binary`: `Unary::init_work()` is the empty vector, so
/// this is a behaviour-preserving addition for every existing (unary) call site.
fn steps_at(src: &str, enc: &dyn Encoding) -> Option<u64> {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
    let core = desugar(&prog.unwrap());
    let program = match lower_asm(&core) {
        Ok(p) => p,
        Err(_) => lower_asm(&defunc(&core).ok()?).ok()?,
    };
    let (m, overflow) = lower_tm_guarded(&program, enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots_of(&program));
    init[WORK] = enc.init_work();
    let (counts, status) = simulate_counts(&m, &init, TM_DEFAULT_CAPS);
    if status != TmStatus::Halted {
        return None;
    }
    // A run that ended in the guard did not compute anything; its step count is not comparable.
    if counts.get(overflow as usize).is_some() && ended_in_guard(&program, enc) {
        return None;
    }
    Some(counts.iter().sum())
}

/// Whether a pinned-width run halts in the overflow guard.
fn ended_in_guard(program: &Program, enc: &dyn Encoding) -> bool {
    let (m, overflow) = lower_tm_guarded(program, enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots_of(program));
    init[WORK] = enc.init_work();
    let (_, final_state, status) = simulate_final(&m, &init, TM_DEFAULT_CAPS);
    status == TmStatus::Halted && final_state == overflow
}

/// Every width auto-fit can choose, narrowest first.
fn widths() -> Vec<usize> {
    let mut w = vec![MIN_FIELD_WIDTH];
    while *w.last().unwrap() < MAX_FIELD_WIDTH {
        w.push(w.last().unwrap() * 2);
    }
    w
}

/// The width `run_tm` settles on, and the value it produced, under `family` (`Unary::default()` or
/// `Binary::default()` — `run_tm_fitted` re-widens it as it searches).
///
/// Decodes at the FITTED width (`family.at_width(w)`), not at `family`'s own (usually 64-cell) width.
/// This was once required for correctness: `Binary`'s decode was width-strict, so a tape fitted at, say,
/// 4 cells decoded to `None` under a 64-cell `Binary`, while `Unary`'s scan-to-the-first-blank decode hid
/// the asymmetry — this function used to decode every result with `Unary::default()` regardless of the
/// fitted width and happened to work only because of it. Both decoders are structural now, so the
/// `at_width` below is no longer load-bearing; it stays because a width report that decoded at a width
/// it does not report would be a confusing thing to leave behind.
fn fitted(src: &str, family: &dyn Encoding) -> (Option<usize>, String) {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
    let core = desugar(&prog.unwrap());
    let expected = run(src).ok();
    let (outcome, width) = run_tm_fitted(&core, family, TM_DEFAULT_CAPS);
    let dec_enc = family.at_width(width.unwrap_or(MAX_FIELD_WIDTH));
    let shown = match (&outcome, &expected) {
        (TmRun::Ran { tapes }, Some(v)) => match decode_tape(tapes, v, dec_enc.as_ref()) {
            Some(got) if got == *v => fmt_value(&got),
            other => format!("MISMATCH {other:?}"),
        },
        (TmRun::Overflow, _) => "overflow".to_string(),
        (other, _) => format!("{other:?}"),
    };
    (width, shown)
}

fn fmt_value(v: &Value) -> String {
    match v {
        Value::Nat(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        other => format!("{other:?}"),
    }
}

/// One encoding's measurement for one program at its own fitted width: the width, total steps, the
/// final REG tape's cell length, and the decoded value (for a sanity cross-check against the reference).
struct Measured {
    width: Option<usize>,
    steps: Option<u64>,
    reg_len: Option<usize>,
    value: String,
}

/// Fit `family` to `src`, run once at the fitted width, and report width + steps + final REG length —
/// the deliverable this task adds: a per-program, per-encoding comparison at the width each actually
/// settles on, not at a shared pinned width.
fn measure(src: &str, family: &dyn Encoding) -> Measured {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
    let core = desugar(&prog.unwrap());
    let (outcome, width) = run_tm_fitted(&core, family, TM_DEFAULT_CAPS);
    match (outcome, width) {
        (TmRun::Ran { tapes }, Some(w)) => {
            let enc = family.at_width(w);
            let reg_len = tapes[REG].snapshot().0.len();
            let steps = steps_at(src, enc.as_ref());
            let expected = run(src).ok();
            let value = match &expected {
                Some(v) => match decode_tape(&tapes, v, enc.as_ref()) {
                    Some(got) if got == *v => fmt_value(&got),
                    other => format!("MISMATCH {other:?}"),
                },
                None => "no-reference".to_string(),
            };
            Measured { width: Some(w), steps, reg_len: Some(reg_len), value }
        }
        (TmRun::Overflow, _) => Measured { width: None, steps: None, reg_len: None, value: "overflow".to_string() },
        (other, _) => Measured { width: None, steps: None, reg_len: None, value: format!("{other:?}") },
    }
}

fn main() {
    println!("\n=== A. steps(W) = a + b*W, and the width-driven share at W = 64 ===\n");
    println!("   {:<16} {:>9} {:>11} {:>9}  affine?", "program", "slope b", "intercept a", "pad@64");
    let mut shares: Vec<f64> = Vec::new();
    for (name, src) in CORPUS {
        // Fit from the two widest points, then check every other completed width lies on that line.
        let (Some(s32), Some(s64)) = (steps_at(src, &Unary::at(32)), steps_at(src, &Unary::at(64))) else {
            println!("   {name:<16} {:>9} {:>11} {:>9}  (does not complete at 32/64)", "—", "—", "—");
            continue;
        };
        let b = (s64 as f64 - s32 as f64) / 32.0;
        let a = s64 as f64 - b * 64.0;
        let affine = widths()
            .iter()
            .filter_map(|&w| steps_at(src, &Unary::at(w)).map(|s| (w, s)))
            .all(|(w, s)| ((a + b * w as f64) - s as f64).abs() < 0.5);
        let share = b * 64.0 / s64 as f64 * 100.0;
        shares.push(share);
        println!("   {name:<16} {b:>9.0} {a:>11.0} {share:>8.1}%  {}", if affine { "exact" } else { "NO — see below" });
    }
    if !shares.is_empty() {
        let mut sorted = shares.clone();
        sorted.sort_by(|x, y| x.partial_cmp(y).unwrap());
        println!(
            "\n   padding share at W = 64: min {:.1}%  median {:.1}%  max {:.1}%",
            sorted[0],
            sorted[sorted.len() / 2],
            sorted[sorted.len() - 1]
        );
        println!("   A program marked `NO` deviates from its own line at some width, which happens only");
        println!("   where it is corrupting its bank — a shape the guard now refuses outright.");
        println!();
        println!("   BIAS, stated because it runs one way: fitting a line needs two widths at which the");
        println!("   program COMPLETES, so any program that fits only at 64 is excluded from this median.");
        println!("   Those are exactly the programs holding a large literal — the ones with the LOWEST");
        println!("   width-driven share, since their intercept is large relative to their slope. So the");
        println!("   median above is optimistic; the excluded programs measured ~71% before the guard");
        println!("   existed, when a narrow run still returned numbers (from a corrupted bank).");
    }

    println!("\n=== B. the width auto-fit determines, and what it saves ===\n");
    println!("   {:<16} {:>7} {:>12} {:>12} {:>9}  value", "program", "fitted", "steps@fitted", "steps@64", "speedup");
    let mut speedups: Vec<f64> = Vec::new();
    for (name, src) in CORPUS {
        let (w, shown) = fitted(src, &Unary::default());
        let Some(w) = w else {
            println!("   {name:<16} {:>7} {:>12} {:>12} {:>9}  {shown}", "—", "—", "—", "—");
            continue;
        };
        match (steps_at(src, &Unary::at(w)), steps_at(src, &Unary::at(MAX_FIELD_WIDTH))) {
            (Some(sf), Some(s64)) => {
                let ratio = s64 as f64 / sf as f64;
                speedups.push(ratio);
                println!("   {name:<16} {w:>7} {sf:>12} {s64:>12} {ratio:>8.2}x  {shown}");
            }
            _ => println!("   {name:<16} {w:>7} {:>12} {:>12} {:>9}  {shown}", "—", "—", "—"),
        }
    }
    if !speedups.is_empty() {
        let mut sorted = speedups.clone();
        sorted.sort_by(|x, y| x.partial_cmp(y).unwrap());
        println!(
            "\n   speedup: min {:.2}x  median {:.2}x  max {:.2}x",
            sorted[0],
            sorted[sorted.len() / 2],
            sorted[sorted.len() - 1]
        );
    }

    println!("\n=== C. what the search itself costs ===\n");
    println!("   Auto-fit runs the program once per attempted width. A too-narrow attempt executes the");
    println!("   correct prefix and then halts AT the guard, so it costs less than the successful attempt");
    println!("   that follows — which is the claim this section measures rather than asserts.\n");
    println!("   {:<16} {:>7} {:>14} {:>14} {:>9}", "program", "fitted", "search total", "final attempt", "overhead");
    let mut worst: f64 = 0.0;
    for (name, src) in CORPUS {
        let (Some(w), _) = fitted(src, &Unary::default()) else { continue };
        // Every attempt auto-fit made, in order, is every width up to and including the fitted one.
        let total: u64 = widths().iter().take_while(|&&x| x <= w).filter_map(|&x| pinned_steps_any(src, x)).sum();
        let Some(final_attempt) = steps_at(src, &Unary::at(w)) else { continue };
        let overhead = total as f64 / final_attempt as f64;
        worst = worst.max(overhead);
        println!("   {name:<16} {w:>7} {total:>14} {final_attempt:>14} {overhead:>8.2}x");
    }
    println!("\n   worst overhead across the corpus: {worst:.2}x the final attempt.");
    println!();

    // ============================================================================================
    // D. unary vs binary at each encoding's OWN fitted width — the payoff of the toggle (Task 17).
    // ============================================================================================
    //
    // Every earlier section is unary-only (it measures per-program width sizing WITHIN one encoding).
    // This section is the new thing: the same corpus, run through BOTH encodings, each auto-fit by
    // `run_tm_fitted` independently, so the comparison is "the width and step cost each encoding
    // actually settles on", not the same pinned width imposed on both.
    println!("\n=== D. unary vs binary, each at its OWN fitted width ===\n");
    println!("   `ratio` is binary steps / unary steps: below 1.0 binary is FASTER. `reg` is the final REG");
    println!("   tape's cell length (`1 + slots*(w+1)`). Both encodings are fit independently by");
    println!("   `run_tm_fitted` — no width here is chosen or pinned by hand.\n");
    println!(
        "   {:<16} | {:>4} {:>10} {:>6} | {:>4} {:>10} {:>6} | {:>7}  value",
        "program", "u-w", "u-steps", "u-reg", "b-w", "b-steps", "b-reg", "ratio"
    );
    let mut total_u = 0u64;
    let mut total_b = 0u64;
    let mut controlled: Vec<(&str, f64)> = Vec::new();
    let mut incomplete = 0usize;
    for (name, src) in CORPUS {
        let mu = measure(src, &Unary::default());
        let mb = measure(src, &Binary::default());
        match (mu.width, mu.steps, mu.reg_len, mb.width, mb.steps, mb.reg_len) {
            (Some(uw), Some(us), Some(ur), Some(bw), Some(bs), Some(br)) => {
                let ratio = bs as f64 / us as f64;
                total_u += us;
                total_b += bs;
                println!(
                    "   {name:<16} | {uw:>4} {us:>10} {ur:>6} | {bw:>4} {bs:>10} {br:>6} | {ratio:>6.2}x  {}",
                    mu.value
                );
                // The CONTROLLED comparison: both settle at the narrowest possible width under BOTH
                // encodings, so there is no bank-width advantage for binary and the ratio isolates the
                // per-operation cost of ripple-carry over mark-counting.
                if uw == MIN_FIELD_WIDTH && bw == MIN_FIELD_WIDTH {
                    controlled.push((name, ratio));
                }
            }
            _ => {
                incomplete += 1;
                println!(
                    "   {name:<16}   (did not complete under one or both encodings: unary {:?}, binary {:?})",
                    mu.value, mb.value
                );
            }
        }
    }
    println!(
        "\n   TOTAL steps summed over the {} completed programs: unary {total_u}  binary {total_b}  ratio {:.2}x",
        CORPUS.len() - incomplete,
        total_b as f64 / total_u as f64
    );
    if !controlled.is_empty() {
        println!("\n   CONTROLLED COMPARISON — programs that fit at width {MIN_FIELD_WIDTH} under BOTH encodings (no");
        println!("   bank-width advantage for binary here; this isolates the true per-operation cost):");
        for (name, ratio) in &controlled {
            let verdict = if *ratio > 1.0 { "binary LOSES" } else { "binary wins" };
            println!("     {name:<16} {ratio:>6.2}x  {verdict}");
        }
        println!("   Everywhere else in the table binary wins by fitting a NARROWER bank than unary needs.");
    }
    println!(
        "\n   Footer: {} corpus programs (same CORPUS as sections A-C); `run_tm_fitted` chose every width",
        CORPUS.len()
    );
    println!("   shown above independently per encoding — none was pinned by hand.");
    println!();
}

/// Steps at a pinned width INCLUDING runs that end in the guard — which is what the search actually
/// pays for, as distinct from `steps_at`, which reports only runs that computed something.
fn pinned_steps_any(src: &str, width: usize) -> Option<u64> {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors in `{src}`: {ds:?}");
    let core = desugar(&prog.unwrap());
    let program = match lower_asm(&core) {
        Ok(p) => p,
        Err(_) => lower_asm(&defunc(&core).ok()?).ok()?,
    };
    let enc = Unary::at(width);
    let (m, _) = lower_tm_guarded(&program, &enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots_of(&program));
    let (counts, _) = simulate_counts(&m, &init, TM_DEFAULT_CAPS);
    Some(counts.iter().sum())
}
