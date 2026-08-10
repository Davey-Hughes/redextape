//! **How often does a β-step name a source construct, and how wide is the answer when it only
//! contains one?** M1 and M2 of the 5c design.
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --example owner_probe
//! ```
//!
//! **The cap is not decoration and `MemorySwapMax=0` is the load-bearing half.** An earlier
//! measurement over a comparable family took 60 GiB of RAM and 29 GiB of swap and wedged the machine.
//! An OOM-kill or a timeout here is a RESULT to report, not something to work around by raising the
//! cap.
//!
//! **Drives `trace::LambdaCursor`, never `reduce_trace`**, which materialises every step's term by
//! contract and is how the 60 GiB run happened. A program's M1 AND M2 rows are both flushed —
//! interleaved, tagged `[M1]`/`[M2]` — before the next program's `measure()` begins; M2 is not a
//! deferred second pass over the whole corpus, because it is the table that gates (see below), and
//! deferring it would mean an OOM-kill mid-run loses every M2 row, including for programs whose
//! `Census` was already complete.
//!
//! # WHAT THIS MEASURES
//!
//! **M1 — the tagged-contraction rate.** Over each corpus program, what fraction of β-steps contract
//! an `App` carrying its own tag (`Owner::Exact`), versus only an enclosing one (`Owner::Within`),
//! versus neither (`Owner::None`)? Reported, not gated: `Owner` has three states rather than two, so a
//! low `Exact` rate is information the renderer already handles, not a failure.
//!
//! **M2 — the `Within` span width**, as a fraction of program length. THIS ONE GATES. The threshold
//! was fixed before any number existed: if the median `Within` span exceeds 60% of program length on
//! more than one corpus program, a later task renders `Within` as a status line only, not a highlight.
//! That verdict is not renegotiated here even if a number lands close to the line.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::io::Write;

use redextape_core::lambda::reduce::Owner;
use redextape_core::lambda::{self, MAX_REDUCTION_STEPS};
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

/// The corpus, copied verbatim from `frame_cost_probe.rs:107-133` (its `programs()`, minus `while40`,
/// which that file adds only for its own section F). Reusing it keeps this probe's columns comparable
/// with every figure this Plan has already recorded. The last three entries are picked to defeat
/// bounds, not to represent the corpus — see that file's comment on `num200`/`list20`/`list60`.
fn programs() -> Vec<(String, String)> {
    let list20 = format!("[{}]", (1..=20).map(|n| n.to_string()).collect::<Vec<_>>().join(", "));
    let list60 = format!("[{}]", (1..=60).map(|n| n.to_string()).collect::<Vec<_>>().join(", "));
    let mut v: Vec<(String, String)> = [
        ("sample", "let x = 40; x + 2"),
        ("list2", "[1, 2]"),
        ("while4", "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc"),
        ("sum5", "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)"),
        (
            "countdown4",
            "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
        ),
        (
            "map_fold",
            "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
             fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
             fn add(a, b) { a + b }\n\
             fn add1(x) { x + 1 }\n\
             fold([3, 1, 2].map(add1), 0, add)",
        ),
        // --- picked to defeat the bound, not to represent the corpus ---------------------------
        // A Church numeral is unary in the λ lowering, so `200` alone is ~403 nodes before anything
        // else in the program. `40` is the app's own sample and already ~83.
        ("num200", "let x = 200; x + 1"),
    ]
    .iter()
    .map(|(n, s)| ((*n).to_string(), (*s).to_string()))
    .collect();
    // A list literal desugars to a `cons` spine of depth n+1 — the shape whose 699-element instance
    // falsified the logical-size guard. These two are far below that and still the largest terms here.
    v.push(("list20".to_string(), list20));
    v.push(("list60".to_string(), list60));
    v
}

/// One program's β-step census: how many steps landed `Exact`/`Within`/`None`, and — for every
/// `Within` step — the resolved span's width as a percentage of `src`'s length.
///
/// Empty on a parse or lower failure (none expected over this corpus; every entry here already
/// round-trips through `frame_cost_probe`'s `compile()`), reported as a zero row rather than a panic.
///
/// **INVARIANT, ASSERTED IN `measure()`: `within_widths.len() == within`.** Every `Owner::Within(id)`
/// carries an `id` that `desugar_mapped` minted (`term.rs`'s `subst`/`shift`/`beta_go` all thread
/// `*owner` through `app_tagged` unchanged, so a step's tag is never regenerated), and
/// `sourcemap_coverage.rs`'s `every_core_node_resolves_to_an_in_bounds_source_span` pins — as a
/// tested invariant over `SourceMap::build_from_program`'s output, not an empirical fact about this
/// corpus — that every id `desugar_mapped` mints resolves to a span. So `map.source_span(id)` at
/// `:125` returning `None` for a `Within` id is a genuine bug, not an expected corpus quirk, and this
/// struct never carries a `within_widths` narrower than `within` without saying so loudly.
struct Census {
    exact: u64,
    within: u64,
    none: u64,
    /// Width of each `Within` step's resolved span, as a percentage of `src.len()`. Always
    /// `within_widths.len() == within` — see this struct's doc.
    within_widths: Vec<f64>,
}

/// Drive one program to `MAX_REDUCTION_STEPS` over `trace::LambdaCursor` — never `reduce_trace`, see
/// this file's module doc — counting `Owner` at every step and, for `Within`, resolving the span.
fn measure(src: &str) -> Census {
    let (program, _) = parser::parse(src);
    let Some(program) = program else {
        return Census { exact: 0, within: 0, none: 0, within_widths: Vec::new() };
    };
    let enc = EncodingKind::Unary.at(tm::MIN_FIELD_WIDTH);
    let (core, map) = SourceMap::build_from_program(&program, &*enc);
    let Ok(term) = lambda::lower(&core) else {
        return Census { exact: 0, within: 0, none: 0, within_widths: Vec::new() };
    };

    let (mut exact, mut within, mut none) = (0u64, 0u64, 0u64);
    let mut within_widths: Vec<f64> = Vec::new();
    // `LambdaCursor`, NEVER `reduce_trace` — see this file's module doc.
    let mut c = trace::LambdaCursor::new(&term, MAX_REDUCTION_STEPS);
    while c.next().is_some() {
        match c.last_owner() {
            Owner::Exact(_) => exact += 1,
            Owner::Within(id) => {
                within += 1;
                if let Some(s) = map.source_span(id) {
                    within_widths.push((s.end - s.start) as f64 / src.len() as f64 * 100.0);
                }
            }
            Owner::None => none += 1,
        }
    }
    // Finding 2 (task 8's fix pass): cheap post-processing, not the risky β-step loop this file's
    // module doc warns about, so crashing on a violation is safe — and preferred over silently
    // reporting a `within_widths` narrower than `within`. See `Census`'s doc for why this is expected
    // to hold structurally, not just for this corpus.
    assert_eq!(
        within_widths.len() as u64,
        within,
        "within_widths ({} entries) diverged from within ({within}) for {src:?}: \
         SourceMap::source_span returned None for some Owner::Within id, which \
         sourcemap_coverage.rs's every_core_node_resolves_to_an_in_bounds_source_span says should \
         never happen — this is a genuine regression, not a corpus quirk",
        within_widths.len(),
    );
    Census { exact, within, none, within_widths }
}

/// Median of an unsorted slice, nearest-rank (see `percentile`) — for an EVEN-length slice this is
/// the lower of the two middle values, NOT their average. `None` on an empty slice — a program with
/// zero `Within` steps has no span width to report, and that is different from a width of zero.
fn median(xs: &[f64]) -> Option<f64> {
    percentile(xs, 0.5)
}

/// The value at rank `q` (0.0..=1.0) of an unsorted slice, nearest-rank: always one of `xs`'s actual
/// elements, never an interpolated value between two of them. `None` on an empty slice.
fn percentile(xs: &[f64], q: f64) -> Option<f64> {
    if xs.is_empty() {
        return None;
    }
    let mut s = xs.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((q * s.len() as f64).ceil() as usize).clamp(1, s.len()) - 1;
    Some(s[rank])
}

fn fmt_pct(v: Option<f64>) -> String {
    v.map_or_else(|| "-".to_string(), |x| format!("{x:.1}"))
}

fn main() {
    line("owner_probe — M1 (tagged-contraction rate) and M2 (Within span width)");
    line("  RUN UNDER: systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0");

    let progs = programs();

    head("M1 (tagged-contraction rate) and M2 (Within span width), interleaved per program");
    line("  M1 is `[M1]`-tagged, M2 is `[M2]`-tagged — read each table down by filtering on its tag;");
    line("  they print interleaved, program by program, so a kill mid-run leaves BOTH tables complete");
    line("  up through the last program `measure()` finished, never M1-only. This is the fix for the");
    line("  finding that M2 — the table that gates — used to be a second pass over the whole corpus.");
    line("");
    line("  M2 verdict: `degenerate` when the median Within span exceeds 60% of program length.");
    line("  Gate: Task 9 renders Within as a status line, not a highlight, if MORE THAN ONE program");
    line("  reports `degenerate`.");
    line("");
    line(&format!("[M1] {:<10}{:>7}{:>9}{:>10}{:>9}{:>9}", "program", "steps", "Exact", "Within", "None", "Exact%"));
    line(&format!("[M2] {:<10}{:>9}{:>10}{:>8}{:>8}  {}", "program", "Within", "median%", "p90%", "max%", "verdict"));
    line("");

    let mut degenerate_count = 0usize;
    for (name, src) in &progs {
        let c = measure(src);

        // M1 row — flushed immediately.
        let steps = c.exact + c.within + c.none;
        let exact_pct = if steps == 0 { 0.0 } else { 100.0 * c.exact as f64 / steps as f64 };
        line(&format!("[M1] {:<10}{:>7}{:>9}{:>10}{:>9}{:>8.1}%", name, steps, c.exact, c.within, c.none, exact_pct));

        // M2 row — computed and flushed right here, still inside this program's iteration, so it
        // reaches stdout before the next program's `measure()` call begins. This is the fix for the
        // finding: M2 used to be a wholly separate pass, deferred until every program's `measure()`
        // had already run, so an OOM-kill during ANY program's `measure()` left zero M2 rows even for
        // programs whose `Census` (including `within_widths`) was already complete and sitting in
        // memory.
        let med = median(&c.within_widths);
        let p90 = percentile(&c.within_widths, 0.9);
        let max = percentile(&c.within_widths, 1.0);
        let verdict = match med {
            Some(m) if m > 60.0 => {
                degenerate_count += 1;
                "degenerate"
            }
            Some(_) => "ok",
            None => "n/a (no Within steps)",
        };
        line(&format!(
            "[M2] {:<10}{:>9}{:>10}{:>8}{:>8}  {}",
            name,
            c.within.to_string(),
            fmt_pct(med),
            fmt_pct(p90),
            fmt_pct(max),
            verdict,
        ));
    }
    line("");
    line(&format!(
        "{degenerate_count} of {} programs reported `degenerate` (median Within span > 60% of program length).",
        progs.len()
    ));
    if degenerate_count > 1 {
        line("VERDICT: MORE THAN ONE program is `degenerate`. Within must render as a status line, not a highlight.");
    } else {
        line("VERDICT: at most one program is `degenerate`. Within may render as a highlight.");
    }
}
