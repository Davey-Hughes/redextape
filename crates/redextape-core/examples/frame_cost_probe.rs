//! **What does it cost to record one frame?** The measurement Plan 5a's design names as its highest
//! open risk (`docs/superpowers/specs/2026-08-07-plan5a-panes-and-history-design.md` §8, §11.1).
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --features serde --example frame_cost_probe
//! ```
//!
//! **The cap is not decoration and `MemorySwapMax=0` is the load-bearing half.** This file drives λ
//! cursors over programs picked to be inconvenient. An earlier measurement over a comparable family
//! took 60 GiB of RAM and 29 GiB of swap and wedged the machine; the cap alone lets the kernel thrash
//! instead of failing. An OOM-kill or a timeout here is a RESULT to report, not something to work
//! around by raising the cap.
//!
//! Every section drives `trace::LambdaCursor`/`TmCursor`, which hold ONE state at a time. **Never
//! `reduce_trace` on anything this file builds** — it materialises every step's term by contract, and
//! that is how the 60 GiB run happened. Rows are flushed BEFORE the next is computed, so an OOM-kill
//! leaves the completed rows on stdout instead of losing the table.
//!
//! `--features serde` is optional. Without it the byte columns read `-`; the timing columns, which are
//! what §11.1 is actually about, do not need it.
//!
//! # THE QUESTION
//!
//! PR 3c's worker drives λ with `runLambda(50_000)` — **one wasm call per 50,000 β-steps**. Recording
//! a scrubbable history means `stepLambda()` + `lambdaState(budget)` **per step**, and the second of
//! those prints and classifies the whole term. If printing dominates stepping, then `RECORD_BUDGET`
//! and `FRAME_BYTES` are wrong before the plan that picks them is written.
//!
//! So: for each program, and for each leg, how long does `next()` take, how long does rendering the
//! state that `next()` produced take, and how large is the result?
//!
//! # WHAT THE NUMBERS ARE NOT
//!
//! **`render_us` is not `lambdaState()`'s cost at the boundary**, and the gap is worth naming rather
//! than discovering later. The browser path adds `serde_wasm_bindgen::to_value` (building a JS object
//! per frame) and a structured clone through `postMessage`. This probe measures the Rust half, which
//! is the half a Rust change could fix. If the Rust half is already the whole budget, the browser half
//! cannot rescue it — which is the decision this probe exists to make.
//!
//! Likewise **`json_b` is a proxy for the JS heap cost, not the cost itself.** It is a stable,
//! re-runnable number in the units the ring buffer will budget in; `text_b` beside it is the part that
//! is really `LAMBDA_BYTE_BUDGET`'s doing.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::io::Write;
use std::rc::Rc;
use std::time::{Duration, Instant};

use redextape_core::desugar::desugar_mapped;
use redextape_core::lambda::{self, MAX_REDUCTION_STEPS};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{self, EncodingKind, Machine, TmRun};
use redextape_core::trace::{LambdaCursor, TmCursor};
use redextape_core::viewmodel::{LambdaState, TmProgram, TmState};
use redextape_core::{parser, typeck};

/// `LAMBDA_BYTE_BUDGET` from `web/src/protocol.ts:10`, and the reason §3.2 of the design caps the ring
/// buffer in bytes rather than frames: one frame is allowed to be this large.
const WEB_BYTE_BUDGET: usize = 65_536;

/// Candidate smaller budgets for FRAME history, which is a different job from the one term a user
/// reads. §3.2 leaves the choice to this measurement.
const BUDGET_SWEEP: &[usize] = &[512, 4_096, 16_384, 65_536];

/// Tape window radii to sweep. The TM pane follows the head; the question is what a row costs.
const RADIUS_SWEEP: &[usize] = &[10, 20, 40, 80];

/// Candidate `LAMBDA_TREE_NODES` values, for §8's one remaining unmeasured constant.
///
/// The range is chosen from the one figure the design already has: this language lowers naturals to
/// Church numerals, so `40` alone is ~83 nodes and `200` is ~403 (§4.3) — before anything else in the
/// program. 1,024 is therefore near the floor of "can draw the app's own sample at all", and 524,288 is
/// far past what a reader could look at, included so the refusal column has somewhere to bottom out.
const NODE_BUDGET_SWEEP: &[usize] = &[1_024, 8_192, 65_536, 524_288];

/// Per-program recording ceiling. NOT `MAX_REDUCTION_STEPS` (5,000,000): this probe measures a
/// per-step cost, and a few thousand steps establishes it. A program that hits this is reported as
/// hitting it, never silently truncated.
const STEP_LIMIT: u64 = 20_000;

fn line(s: &str) {
    println!("{s}");
    let _ = std::io::stdout().flush();
}

fn head(s: &str) {
    line("");
    line(s);
    line(&"-".repeat(s.len()));
}

fn us(d: Duration) -> f64 {
    d.as_secs_f64() * 1e6
}

/// Programs, spread deliberately rather than sampled. The first six are the demo suite's own rows —
/// `three_way_oracle.rs`'s `FIRST_ORDER_DEMOS` — which makes them CALIBRATION. The last three exist to
/// falsify: the roadmap's standing lesson is that the corpus is chosen to be representative and so
/// cannot break a bound, and that a cost claim is not established until a program picked to defeat it
/// has been run.
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
    // Added for section F, and it defeats a DIFFERENT bound from the three above. Those attack frame
    // SIZE with a large term; a per-frame tree history is bounded by size x STEP COUNT, and every
    // program above runs in the hundreds of β-steps at most. `while4` is the same shape at n=4.
    v.push((
        "while40".to_string(),
        "let mut n = 40; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc".to_string(),
    ));
    v
}

/// `Session::compile`'s pipeline, replicated. The wasm crate is a cdylib and cannot be an example's
/// dependency, so this mirrors `crates/redextape-wasm/src/session.rs`'s `compile_with_caps` — parse,
/// typecheck, result type, source map, λ lower, `run_tm_described` — and returns the two cursors a
/// stepping UI would hold.
struct Compiled {
    lambda: Option<LambdaCursor>,
    tm: Option<(TmProgram, TmCursor<Rc<Machine>>)>,
    map: SourceMap,
    /// Wall-clock of the whole pipeline. PR 3c's open risk 1, unmeasured for two slices running.
    compile_time: Duration,
    /// δ-steps the TM run took at compile time — the run is finished before the cursor is touched.
    tm_total_steps: Option<u64>,
    lambda_decline: Option<String>,
    tm_decline: Option<String>,
}

fn compile(src: &str, kind: EncodingKind) -> Option<Compiled> {
    let t0 = Instant::now();

    let (program, mut diagnostics) = parser::parse(src);
    let program = program?;
    diagnostics.extend(typeck::typecheck(&program));
    if diagnostics.iter().any(|d| d.severity == redextape_core::Severity::Error) {
        return None;
    }
    let ty = typeck::result_type(&program).ok()?;

    let enc = kind.at(tm::MIN_FIELD_WIDTH);
    let (core, map) = {
        let (core, spans) = desugar_mapped(&program);
        let mut map = SourceMap::build(&core, &*enc);
        map.node_to_source = spans.into_iter().collect();
        (core, map)
    };

    let (lambda, lambda_decline) = match lambda::lower(&core) {
        Ok(t) => (Some(LambdaCursor::new(&t, MAX_REDUCTION_STEPS)), None),
        Err(e) => (None, Some(format!("{e:?}"))),
    };

    let described = tm::run_tm_described(&core, kind, ty, tm::TM_DEFAULT_CAPS);
    let tm_total_steps = described.as_ref().ok().map(|d| d.steps);
    let (tm, tm_decline) = match described {
        Err(e) => (None, Some(format!("{e:?}"))),
        Ok(d) => match d.run {
            TmRun::Ran { .. } | TmRun::HitCap => {
                let init = d.header.init(d.machine.tapes);
                let width = d.header.width;
                let machine = Rc::new(d.machine);
                let program = TmProgram::of(&machine, width);
                let cursor = TmCursor::new(Rc::clone(&machine), &init, tm::TM_DEFAULT_CAPS);
                (Some((program, cursor)), None)
            }
            other => (None, Some(format!("{other:?}"))),
        },
    };

    let compile_time = t0.elapsed();
    Some(Compiled { lambda, tm, map, compile_time, tm_total_steps, lambda_decline, tm_decline })
}

#[cfg(feature = "serde")]
fn json_len<T: serde::Serialize>(v: &T) -> Option<usize> {
    serde_json::to_vec(v).ok().map(|b| b.len())
}

#[cfg(not(feature = "serde"))]
fn json_len<T>(_v: &T) -> Option<usize> {
    None
}

fn opt_b(v: Option<usize>) -> String {
    v.map_or_else(|| "-".to_string(), |n| n.to_string())
}

/// One leg's per-step measurement.
struct Legs {
    steps: u64,
    step_total: Duration,
    render_total: Duration,
    max_bytes: usize,
    sum_bytes: usize,
    max_json: Option<usize>,
    sum_json: Option<usize>,
    truncated_at: Option<u64>,
    stopped: &'static str,
}

/// Step-and-record the λ leg exactly as §3.4's loop would: `next()`, then render the state it
/// produced. The two are timed SEPARATELY because the whole question is their ratio.
fn record_lambda(c: &mut LambdaCursor, byte_budget: usize) -> Legs {
    let (mut step_total, mut render_total) = (Duration::ZERO, Duration::ZERO);
    let (mut max_bytes, mut sum_bytes) = (0usize, 0usize);
    let (mut max_json, mut sum_json) = (Some(0usize), Some(0usize));
    let mut truncated_at = None;
    let mut steps = 0u64;
    let stopped = loop {
        let t = Instant::now();
        let advanced = c.next().is_some();
        step_total += t.elapsed();
        if !advanced {
            break "ended";
        }
        steps += 1;

        let t = Instant::now();
        let st = LambdaState::render(c, byte_budget, redextape_core::lambda::reduce::MAX_TERM_DEPTH);
        render_total += t.elapsed();

        if st.cut.is_some() && truncated_at.is_none() {
            truncated_at = Some(steps);
        }
        max_bytes = max_bytes.max(st.text.len());
        sum_bytes += st.text.len();
        if let (Some(m), Some(s), Some(j)) = (max_json.as_mut(), sum_json.as_mut(), json_len(&st)) {
            *m = (*m).max(j);
            *s += j;
        } else {
            max_json = None;
            sum_json = None;
        }

        if steps >= STEP_LIMIT {
            break "step-limit";
        }
    };
    Legs { steps, step_total, render_total, max_bytes, sum_bytes, max_json, sum_json, truncated_at, stopped }
}

/// The TM leg, same shape. It means something different — the TM run FINISHED during compile, so this
/// replays a run whose answer is already known (design §3.4) — but the per-step cost is the same
/// question.
fn record_tm(c: &mut TmCursor<Rc<Machine>>, map: &SourceMap, radius: usize) -> Legs {
    let (mut step_total, mut render_total) = (Duration::ZERO, Duration::ZERO);
    let (mut max_bytes, mut sum_bytes) = (0usize, 0usize);
    let (mut max_json, mut sum_json) = (Some(0usize), Some(0usize));
    let mut steps = 0u64;
    let stopped = loop {
        let t = Instant::now();
        let advanced = c.next().is_some();
        step_total += t.elapsed();
        if !advanced {
            break "ended";
        }
        steps += 1;

        let t = Instant::now();
        let st = TmState::window(c, Some(map), radius);
        render_total += t.elapsed();

        let cells: usize = st.window.iter().map(Vec::len).sum();
        max_bytes = max_bytes.max(cells);
        sum_bytes += cells;
        if let (Some(m), Some(s), Some(j)) = (max_json.as_mut(), sum_json.as_mut(), json_len(&st)) {
            *m = (*m).max(j);
            *s += j;
        } else {
            max_json = None;
            sum_json = None;
        }

        if steps >= STEP_LIMIT {
            break "step-limit";
        }
    };
    Legs { steps, step_total, render_total, max_bytes, sum_bytes, max_json, sum_json, truncated_at: None, stopped }
}

/// One λ leg's per-step `lambdaAst` measurement.
///
/// Separate from [`Legs`] because the question is different. `Legs` asks what a frame costs; this asks
/// whether a frame can be BUILT at all, so `refused` is a first-class column rather than an error path.
struct AstLegs {
    steps: u64,
    ast_total: Duration,
    /// Steps where `ast` returned `None` — the node budget refusing, or the arena's `u32` index space
    /// overflowing first. `LambdaState::ast`'s own doc says a consumer cannot tell the two apart, so
    /// neither does this column.
    refused: u64,
    first_refused_at: Option<u64>,
    max_nodes: usize,
    sum_nodes: usize,
    max_json: Option<usize>,
    sum_json: Option<usize>,
    stopped: &'static str,
}

/// Step-and-build-a-tree, exactly as a per-frame tree recorder would: `next()`, then `ast()` on the
/// state that step produced.
///
/// **TREES ARE DROPPED EACH ITERATION AND NEVER ACCUMULATED.** Retaining one per step is the shape this
/// file's module doc records as having taken 60 GiB, and the question here is a PER-STEP cost, which a
/// proxy answers without paying it. What a whole history would cost is arithmetic on `sum_json`, and
/// arithmetic does not need to be allocated to be believed.
fn record_ast(c: &mut LambdaCursor, node_budget: usize) -> AstLegs {
    let mut ast_total = Duration::ZERO;
    let (mut max_nodes, mut sum_nodes) = (0usize, 0usize);
    let (mut max_json, mut sum_json) = (Some(0usize), Some(0usize));
    let (mut refused, mut first_refused_at) = (0u64, None);
    let mut steps = 0u64;
    let stopped = loop {
        if c.next().is_none() {
            break "ended";
        }
        steps += 1;

        let t = Instant::now();
        let tree = LambdaState::ast(c, node_budget);
        ast_total += t.elapsed();

        match tree {
            None => {
                refused += 1;
                if first_refused_at.is_none() {
                    first_refused_at = Some(steps);
                }
            }
            Some(tree) => {
                max_nodes = max_nodes.max(tree.nodes.len());
                sum_nodes += tree.nodes.len();
                if let (Some(m), Some(s), Some(j)) = (max_json.as_mut(), sum_json.as_mut(), json_len(&tree)) {
                    *m = (*m).max(j);
                    *s += j;
                } else {
                    max_json = None;
                    sum_json = None;
                }
            }
        }

        if steps >= STEP_LIMIT {
            break "step-limit";
        }
    };
    AstLegs { steps, ast_total, refused, first_refused_at, max_nodes, sum_nodes, max_json, sum_json, stopped }
}

/// `hist_MB` is the decision column: what recording ONE TREE PER FRAME would cost for this program at
/// this budget, over the steps actually run. Compare it against §3.2's ~10 KB text frame.
fn ast_report(legs: &AstLegs) -> String {
    let n = legs.steps.max(1) as f64;
    let built = legs.steps.saturating_sub(legs.refused).max(1) as usize;
    format!(
        "{:>7} {:>10.2} {:>9} {:>9.1} {:>10} {:>10} {:>9} {:>9} {:>9.1}  {}",
        legs.steps,
        us(legs.ast_total) / n,
        legs.refused,
        100.0 * legs.refused as f64 / n,
        legs.max_nodes,
        legs.sum_nodes / built,
        opt_b(legs.max_json),
        opt_b(legs.sum_json.map(|s| s / built)),
        legs.sum_json.map_or(f64::NAN, |s| s as f64 / 1e6),
        legs.stopped,
    )
}

const AST_HDR: &str =
    "  steps    ast_us/  refused  refused%  max_nodes  avg_nodes  max_json  avg_json   hist_MB  stopped";

fn report(legs: &Legs) -> String {
    let n = legs.steps.max(1) as f64;
    let ratio = if legs.step_total.is_zero() {
        f64::INFINITY
    } else {
        legs.render_total.as_secs_f64() / legs.step_total.as_secs_f64()
    };
    format!(
        "{:>7} {:>10.2} {:>11.2} {:>8.1} {:>9} {:>9} {:>9} {:>9}  {}",
        legs.steps,
        us(legs.step_total) / n,
        us(legs.render_total) / n,
        ratio,
        legs.max_bytes,
        legs.sum_bytes / legs.steps.max(1) as usize,
        opt_b(legs.max_json),
        opt_b(legs.sum_json.map(|s| s / legs.steps.max(1) as usize)),
        legs.stopped,
    )
}

const HDR: &str = "  steps   step_us/  render_us/    ratio   max_txt   avg_txt  max_json  avg_json  stopped";

fn section_compile(progs: &[(String, String)]) {
    head("A — compile() wall-clock (PR 3c open risk 1, unmeasured for two slices)");
    line("  This is the whole pipeline INCLUDING the TM run, which `compile` performs eagerly.");
    line("");
    line("  `states`/`rules` size 5a-ii's virtualized table, whose only measured point was the");
    line("  `list_1_2.tm` fixture: 146 states and 309 rules for `[1, 2]`. `rows` is what the table");
    line("  flattens to — one per state plus one per rule — and is what `rowHeight` and `overscan`");
    line("  have to be chosen against.");
    line("");
    line(&format!(
        "{:<12} {:>12} {:>12} {:>8} {:>8} {:>8} {:>12}  {}",
        "program", "compile_ms", "tm_steps", "states", "rules", "rows", "lambda", "tm"
    ));
    for (name, src) in progs {
        let Some(c) = compile(src, EncodingKind::Unary) else {
            line(&format!(
                "{name:<12} {:>12} {:>12} {:>8} {:>8} {:>8} {:>12}  {}",
                "-", "-", "-", "-", "-", "no-session", "no-session"
            ));
            continue;
        };
        let (states, rules) = c.tm.as_ref().map_or((None, None), |(p, _)| {
            (Some(p.states.len()), Some(p.states.iter().map(|s| s.rules.len()).sum::<usize>()))
        });
        line(&format!(
            "{:<12} {:>12.2} {:>12} {:>8} {:>8} {:>8} {:>12}  {}",
            name,
            c.compile_time.as_secs_f64() * 1e3,
            c.tm_total_steps.map_or_else(|| "-".to_string(), |s| s.to_string()),
            opt_b(states),
            opt_b(rules),
            opt_b(states.zip(rules).map(|(s, r)| s + r)),
            c.lambda_decline.as_deref().unwrap_or("ok"),
            c.tm_decline.as_deref().unwrap_or("ok"),
        ));
    }
}

fn section_lambda(progs: &[(String, String)]) {
    head(&format!("B — λ: one step vs one frame, at the web's own budget ({WEB_BYTE_BUDGET} bytes)"));
    line("  `ratio` is render/step. Above 1.0, recording costs more than reducing.");
    line("");
    line(&format!("{:<12}{HDR}", "program"));
    for (name, src) in progs {
        let Some(mut c) = compile(src, EncodingKind::Unary) else { continue };
        let Some(cur) = c.lambda.as_mut() else {
            line(&format!("{:<12} declined: {}", name, c.lambda_decline.as_deref().unwrap_or("?")));
            continue;
        };
        let legs = record_lambda(cur, WEB_BYTE_BUDGET);
        line(&format!("{:<12}{}", name, report(&legs)));
        if let Some(at) = legs.truncated_at {
            line(&format!("{:<12}   first truncated at step {at}", ""));
        }
    }
}

fn section_tm(progs: &[(String, String)]) {
    head("C — TM: one step vs one frame, at radius 20");
    line("  The run already finished during compile; this replays it through the cursor.");
    line("");
    line(&format!("{:<12}{HDR}", "program"));
    for (name, src) in progs {
        let Some(mut c) = compile(src, EncodingKind::Unary) else { continue };
        let map = std::mem::take(&mut c.map);
        let Some((_, cur)) = c.tm.as_mut() else {
            line(&format!("{:<12} declined: {}", name, c.tm_decline.as_deref().unwrap_or("?")));
            continue;
        };
        let legs = record_tm(cur, &map, 20);
        line(&format!("{:<12}{}", name, report(&legs)));
    }
}

fn section_budgets(progs: &[(String, String)]) {
    head("D — does a smaller FRAME_BYTES buy anything? (§3.2's open question)");
    line("  If render_us is flat across budgets, truncation is not where the time goes and the");
    line("  history budget should be chosen for MEMORY alone.");
    line("");
    line(&format!("{:<12}{:>9}{HDR}", "program", "budget"));
    for (name, src) in progs {
        for &b in BUDGET_SWEEP {
            let Some(mut c) = compile(src, EncodingKind::Unary) else { continue };
            let Some(cur) = c.lambda.as_mut() else { continue };
            let legs = record_lambda(cur, b);
            line(&format!("{:<12}{:>9}{}", name, b, report(&legs)));
        }
    }
}

fn section_radius(progs: &[(String, String)]) {
    head("E — TM_RADIUS sweep");
    line("");
    line(&format!("{:<12}{:>9}{HDR}", "program", "radius"));
    for (name, src) in progs {
        for &r in RADIUS_SWEEP {
            let Some(mut c) = compile(src, EncodingKind::Unary) else { continue };
            let map = std::mem::take(&mut c.map);
            let Some((_, cur)) = c.tm.as_mut() else { continue };
            let legs = record_tm(cur, &map, r);
            line(&format!("{:<12}{:>9}{}", name, r, report(&legs)));
        }
    }
}

fn section_ast(progs: &[(String, String)]) {
    head("F — lambdaAst: LAMBDA_TREE_NODES, §8's one remaining unmeasured constant (5a-ii)");
    line("  `refused` is the column that decides the feature, not `ast_us`. A tree that refuses is a");
    line("  pane saying \"too large to draw\" (§4.3), so refused% at a budget is the fraction of steps");
    line("  where the structural view has nothing to show.");
    line("  `hist_MB` is what recording one tree per frame would cost over the steps run — compare it");
    line("  against §3.2's ~10 KB text frame and against HISTORY_BYTES' 32 MB per leg.");
    line("  avg_nodes and avg_json average over the steps that BUILT a tree, not over all steps.");
    line("");
    line(&format!("{:<12}{:>9}{AST_HDR}", "program", "budget"));
    for (name, src) in progs {
        for &b in NODE_BUDGET_SWEEP {
            let Some(mut c) = compile(src, EncodingKind::Unary) else { continue };
            let Some(cur) = c.lambda.as_mut() else { continue };
            let legs = record_ast(cur, b);
            line(&format!("{:<12}{:>9}{}", name, b, ast_report(&legs)));
            if let Some(at) = legs.first_refused_at {
                line(&format!("{:<12}{:>9}   first refused at step {at}", "", ""));
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let want = |name: &str| args.is_empty() || args.iter().any(|a| a == name);

    line("frame_cost_probe — what does recording one frame cost?");
    line("  RUN UNDER: systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0");
    line(&format!("  STEP_LIMIT={STEP_LIMIT} per program (a row that says `step-limit` was cut, not finished)"));
    if cfg!(feature = "serde") {
        line("  serde: ON — json_b columns are live");
    } else {
        line("  serde: OFF — json_b columns read `-`; rerun with --features serde for them");
    }

    let progs = programs();
    if want("a") {
        section_compile(&progs);
    }
    if want("b") {
        section_lambda(&progs);
    }
    if want("c") {
        section_tm(&progs);
    }
    if want("d") {
        section_budgets(&progs);
    }
    if want("e") {
        section_radius(&progs);
    }
    if want("f") {
        section_ast(&progs);
    }
}
