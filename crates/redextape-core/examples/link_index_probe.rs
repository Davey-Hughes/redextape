//! **What does `linkIndex()` weigh, and how many clicks land?** The measurements Plan 5b's design
//! §2.1-§2.3 is built on, made re-runnable.
//!
//! # HOW TO RUN THIS
//!
//! ```text
//! systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 -- \
//!   cargo run --release -p redextape-core --features serde --example link_index_probe
//! ```
//!
//! The cgroup cap follows `frame_cost_probe`'s convention. **This probe reduces nothing** — it holds
//! no cursor and never calls `reduce_trace` — so it is far cheaper than that one, but the cap costs
//! nothing and an OOM here would still be a result rather than something to work around.
//!
//! # THE QUESTIONS
//!
//! 1. **How large is the step-0 term?** 5b's lambda link is step-0 only, so the text it highlights
//!    against is `print(lower(core))` — bounded by the PROGRAM, not by any reduction. If that prints
//!    whole at a sane budget, windowing around a clicked construct is a JS string slice rather than
//!    new printer machinery. `while40`, which defeated 5a-ii's tree bound, is irrelevant here: it
//!    explodes at step N, not step 0.
//! 2. **How many clicks land?** A click resolves to the innermost node whose source span contains it.
//!    That node needs a lambda path for the lambda highlight and a TM block for the table highlight.
//!    `lam%`/`tm%` measure exactly that share, over the nodes `SourceMap::node_to_source` maps — the
//!    only nodes a click can land on. `own_st` answers a DIFFERENT question (the share of TM STATES,
//!    not source-mapped NODES, carrying an owner) and must not be read as this one — see
//!    `Row::owned_states`'s doc.
//! 3. **What does the index weigh on the wire?** Naive (an array of objects) against columnar (typed
//!    arrays), which is the decision design §4.1 records.
//!
//! # WHAT THE NUMBERS ARE NOT
//!
//! `naive_b` is JSON of the shape decision 9 (§4.1) REJECTED — all three legs as arrays of objects,
//! with the TM leg as `(state, owner)` PAIRS — never `serde_json::to_vec(&LinkIndex)`. `LinkIndex` IS
//! that decision's WINNER: its `tm_owner` is already the dense `Vec<i32>` §4.1 chose, so serializing
//! the struct whole can only ever re-measure the columnar shape wearing a naive label. `naive_b` is
//! therefore assembled by hand from `LinkIndex`'s own legs, reshaping only `tm_owner` back into
//! sparse pairs, and it is STILL a PROXY for the JS heap cost even so — the same caveat
//! `frame_cost_probe` states about its own `json_b`. `columnar_b` is exact, because a typed array's
//! byte length is its byte length.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::io::Write;
use std::rc::Rc;

use redextape_core::lambda;
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{self, EncodingKind, TmRun};
use redextape_core::viewmodel::{LinkIndex, TmProgram};
use redextape_core::{parser, typeck};

/// `LAMBDA_BYTE_BUDGET` from `web/src/protocol.ts:9` — the budget the app passes `linkIndex`.
const WEB_BYTE_BUDGET: usize = 65_536;

/// Programs, spread deliberately. The first seven are `frame_cost_probe`'s own calibration rows; the
/// last two exist to falsify, and they attack a DIFFERENT bound from that probe's. The standing lesson
/// is that a corpus chosen to be representative cannot break a bound, and 5a-ii proved it twice in one
/// day.
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
        ("num200", "let x = 200; x + 1"),
    ]
    .iter()
    .map(|(n, s)| ((*n).to_string(), (*s).to_string()))
    .collect();
    v.push(("list20".to_string(), list20));
    v.push(("list60".to_string(), list60));
    v.push((
        "while40".to_string(),
        "let mut n = 40; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc".to_string(),
    ));
    // --- picked to defeat THIS bound, not to represent the corpus -------------------------------
    // The step-0 term is proportional to PROGRAM size, so the way to attack it is a big program.
    let lets = (1..=200).map(|n| format!("let y{n} = {n};")).collect::<Vec<_>>().join(" ");
    v.push(("prog200".to_string(), format!("let x = 900; {lets} x")));
    // And the OTHER axis, which is the genuinely unbounded one: this language lowers naturals to UNARY
    // Church numerals, so ONE literal is O(n) bytes of lambda text regardless of program length.
    v.push(("num2000".to_string(), "let x = 2000; x + 1".to_string()));
    v
}

struct Row {
    name: String,
    src_b: usize,
    step0_b: usize,
    truncated: bool,
    lam_spans: usize,
    states: usize,
    src_nodes: usize,
    lam_nodes: usize,
    /// Share (rounded to the nearest percent) of `src_nodes` — i.e. of `SourceMap::node_to_source`,
    /// the only nodes a click can land on — that also have an entry in `SourceMap::node_to_lambda`.
    /// This IS design §2.2's "λ coverage", claimed at 100% on every program.
    ///
    /// NOT the same axis as `lam_nodes` above: `lam_nodes` is `LinkIndex::lambda_nodes`, which drops a
    /// node whose subterm fell past the truncation cut (see `LinkIndex`'s doc on that field), so it
    /// would UNDERSTATE λ coverage on `prog200`, the one program the cut bites. `lam_pct` looks up
    /// `SourceMap`'s own map instead, which the cut never touches.
    lam_pct: usize,
    /// Share (rounded to the nearest percent) of `src_nodes` that also have an entry in
    /// `SourceMap::node_to_tm`. This IS design §2.2's "TM coverage", claimed at 50-82%.
    ///
    /// THIS, NOT `owned_states` BELOW, IS THE RATIO §2.2 MEANS. See `owned_states`'s doc for why the
    /// two do not measure the same thing and can disagree by orders of magnitude.
    tm_pct: usize,
    /// Count of STATES — not source-mapped NODES — carrying an owner:
    /// `tm_owner.iter().filter(|o| **o >= 0).count()`. Genuinely useful on its own terms: it says how
    /// much of `tm_owner` is `-1`.
    ///
    /// IT IS NOT §2.2's "TM coverage" (`tm_pct`, above), which counts NODES. A program can have
    /// `states` far exceed `src_nodes` — `prog200` is 44,670 states over 403 nodes — so the two ratios
    /// read nothing alike: `prog200` is ~1.3% by this count against 50% by `tm_pct`. Conflating the
    /// two was exactly the bug this probe shipped with.
    owned_states: usize,
    naive_b: usize,
    columnar_b: usize,
}

/// Round `count / total` to the nearest whole percent; `0` when `total` is zero rather than dividing
/// by it (every corpus row has `total > 0`, but a probe must not assume its own corpus). Integer-only
/// half-up rounding — `+ total / 2` before the floor division — so e.g. 5/7 (71.43%) reads `71` and
/// 17/21 (80.95%) reads `81`, matching design §2.2's own rounding on both.
fn pct(count: usize, total: usize) -> usize {
    (count * 100 + total / 2).checked_div(total).unwrap_or(0)
}

fn build(name: &str, src: &str) -> Option<Row> {
    let (program, _) = parser::parse(src);
    let program = program?;
    if typeck::typecheck(&program).iter().any(|d| d.severity == redextape_core::Severity::Error) {
        return None;
    }
    let ty = typeck::result_type(&program).ok()?;
    let kind = EncodingKind::Binary;
    let enc = kind.at(tm::MIN_FIELD_WIDTH);
    let (core, map) = SourceMap::build_from_program(&program, &*enc);

    let tm_program = match tm::run_tm_described(&core, kind, ty, tm::TM_DEFAULT_CAPS) {
        Ok(d) => match d.run {
            TmRun::Ran { .. } | TmRun::HitCap => {
                let width = d.header.width;
                Some(TmProgram::of(&Rc::new(d.machine), width))
            }
            _ => None,
        },
        Err(_) => None,
    };
    let term = lambda::lower(&core).ok();
    let index = LinkIndex::build(
        term.as_ref(),
        tm_program.as_ref(),
        &map,
        WEB_BYTE_BUDGET,
        redextape_core::lambda::reduce::MAX_TERM_DEPTH,
    );

    // Columnar, exactly as `linkIndex` ships it: text + 3 span/id arrays x 2 legs + one owner array.
    let columnar_b = index.lambda_text.len()
        + index.lambda_spans.len() * 9
        + index.lambda_nodes.len() * 12
        + index.source_nodes.len() * 12
        + index.tm_owner.len() * 4;

    // §2.2's clickable-set ratios, over `map`'s OWN maps rather than `index`'s legs — see `Row::lam_pct`
    // and `Row::tm_pct` for why that distinction matters (in short: `index.lambda_nodes` drops a node
    // past the truncation cut, which would understate λ coverage on `prog200` specifically).
    let src_n = map.node_to_source.len();
    let lam_hits = map.node_to_source.keys().filter(|id| map.node_to_lambda.contains_key(id)).count();
    let tm_hits = map.node_to_source.keys().filter(|id| map.node_to_tm.contains_key(id)).count();

    Some(Row {
        name: name.to_string(),
        src_b: src.len(),
        step0_b: index.lambda_text.len(),
        truncated: index.lambda_cut.is_some(),
        lam_spans: index.lambda_spans.len(),
        states: index.tm_owner.len(),
        src_nodes: src_n,
        lam_nodes: index.lambda_nodes.len(),
        lam_pct: pct(lam_hits, src_n),
        tm_pct: pct(tm_hits, src_n),
        owned_states: index.tm_owner.iter().filter(|o| **o >= 0).count(),
        naive_b: naive_len(&index),
        columnar_b,
    })
}

/// The shape decision 9 (§4.1) REJECTED: all three legs as arrays of objects, with the TM leg as
/// `(state, owner)` PAIRS rather than the dense `Vec<i32>` the columnar decision introduced. Built
/// from `index`'s own legs — `lambda_spans`, `lambda_nodes` and `source_nodes` are identical arrays
/// in both the naive and columnar shapes, so only the TM leg needs reshaping — never from
/// `serde_json::to_vec(index)` whole, which was the bug: `LinkIndex` IS the columnar decision's
/// output, so serializing it directly can only re-measure the winner under a naive label.
#[cfg(feature = "serde")]
fn naive_len(index: &LinkIndex) -> usize {
    let tm_pairs: Vec<(u32, u32)> = index
        .tm_owner
        .iter()
        .enumerate()
        .filter_map(|(i, &owner)| if owner >= 0 { Some((i as u32, owner as u32)) } else { None })
        .collect();
    let legs = (&index.lambda_spans, &index.lambda_nodes, &index.source_nodes, &tm_pairs);
    let legs_b = serde_json::to_vec(&legs).map(|b| b.len()).unwrap_or(0);
    legs_b + index.lambda_text.len()
}

#[cfg(not(feature = "serde"))]
fn naive_len(_index: &LinkIndex) -> usize {
    0
}

fn main() {
    println!("Plan 5b link index. `naive_b` is JSON and reads 0 without --features serde.");
    println!("`lam%`/`tm%` are §2.2's node coverage; `own_st` is a different axis (states, not nodes).\n");
    println!(
        "{:<12} {:>7} {:>9} {:>5} {:>9} {:>8} {:>8} {:>8} {:>6} {:>6} {:>8} {:>10} {:>10}",
        "program",
        "src_b",
        "step0_b",
        "cut",
        "lam_spans",
        "states",
        "src_n",
        "lam_n",
        "lam%",
        "tm%",
        "own_st",
        "naive_b",
        "colmn_b"
    );
    println!("{}", "-".repeat(118));
    let _ = std::io::stdout().flush();
    for (name, src) in programs() {
        match build(&name, &src) {
            None => println!("{name:<12} did not compile"),
            Some(r) => println!(
                "{:<12} {:>7} {:>9} {:>5} {:>9} {:>8} {:>8} {:>8} {:>6} {:>6} {:>8} {:>10} {:>10}",
                r.name,
                r.src_b,
                r.step0_b,
                if r.truncated { "yes" } else { "no" },
                r.lam_spans,
                r.states,
                r.src_nodes,
                r.lam_nodes,
                format!("{}%", r.lam_pct),
                format!("{}%", r.tm_pct),
                r.owned_states,
                r.naive_b,
                r.columnar_b,
            ),
        }
        let _ = std::io::stdout().flush();
    }
}
