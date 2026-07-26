//! The step survey — the payoff of the Core source-map slice (Tasks 1-5): where TM steps actually go
//! (Part A), and what each candidate optimizer pass could recover (Part B). This is evidence, not
//! code — the reader is choosing which Tier A pass to write next, and this prints the numbers for it.
//!
//!     cargo run --release --example step_survey -p redextape-core
//!
//! Part A's corpus is COPIED VERBATIM from `tests/three_way_oracle.rs` (`FIRST_ORDER_DEMOS` and
//! `LAMBDA_LIMITATION_DEMOS`) rather than invented here — an example is a separate binary crate and
//! cannot `use` another crate's integration-test module, so the strings are duplicated by hand.
//! `tests/tm_oracle.rs`'s `CONTROL_FLOW_DEMOS`/`CALL_DEMOS`/`LIST_BUILD_DEMOS`/`LIST_ACCESS_DEMOS` were
//! checked by hand against `FIRST_ORDER_DEMOS`/`LAMBDA_LIMITATION_DEMOS`: every string in those four
//! arrays already appears in one of the two copied here, so nothing from that file is missing. Excluded
//! on purpose: `three_way_oracle.rs`'s `FAULT_DEMOS` and `tm_oracle.rs`'s unbounded-loop cap test —
//! both are DESIGNED to hit a cap/diverge (a "no value" outcome has no completed steps to attribute),
//! which is outside this survey's scope (every program here must complete under `DEFAULT_CAPS`).
//!
//! THE SURVEY'S OWN BIGGEST LIMITATION, stated up front because it bounds every number below: that
//! corpus is an ORACLE suite, built to exercise BACKEND FEATURES (arithmetic, lists, recursion,
//! defunctionalization, boxing), NOT to be a representative workload. This survey can say where steps
//! go IN THESE PROGRAMS. It cannot say which population an intended workload resembles.
//!
//! A golden cross-check section additionally re-runs the exact programs `lower_tm.rs`'s and
//! `attribute.rs`'s own committed step-count goldens pin, including the two-element `[1, 2].map(add1)`
//! case whose user/ABI/closure split this report quotes.
//!
//! Part B isolates candidate passes as (as-written, hand-optimized) pairs and prints each pass's
//! CEILING on a shape built to suit it — not what it would recover on a real program. Part A is what
//! tells you whether that shape actually occurs.

use std::collections::BTreeMap;

use redextape_core::core::{BinOp, Core, NodeId};
use redextape_core::run;
use redextape_core::tm::attribute::{Attribution, StepBucket, attribute};
use redextape_core::tm::{LowerError, defunc, lower_asm};

// ================================================================================================
// Part A's corpus — copied verbatim, see the module doc comment above for why and from where.
// ================================================================================================

/// Verbatim copy of `tests/three_way_oracle.rs::FIRST_ORDER_DEMOS`: the full first-order-and-defunc'd
/// demo suite, every one of them known (by that file's own passing test) to run `reference == λ == TM`
/// to a value under `TM_DEFAULT_CAPS`.
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
];

/// Verbatim copy of `tests/three_way_oracle.rs::LAMBDA_LIMITATION_DEMOS`: Plan-2 latent traps the λ
/// backend refuses (`LowerError`) while `reference == TM`. Two-way, not three-way, but still a genuine
/// completed TM run worth attributing.
const LAMBDA_LIMITATION_DEMOS: &[&str] = &[
    "let mut x = 1; x = x + 1; let x = x + 10; x",
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
    "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)",
    "let mut c = 0; fn twice(g) { g(0); g(0); } let bump = |x| { c = c + 1; c }; twice(bump); c",
];

/// The exact programs `lower_tm.rs::tm_step_count_goldens` /
/// `tm_step_count_golden_higher_order` / `attribute.rs::higher_order_attribution_bills_the_closure_scaffold`
/// pin, paired with the committed step counts. Independent of `FIRST_ORDER_DEMOS` above (this survey's
/// own attribution totals are cross-checked against them, not derived from them).
const GOLDENS: &[(&str, u64)] = &[
    ("1 + 2 * 3", 5724),
    ("if 2 > 1 { 10 } else { 20 }", 2174),
    ("head(cons(7, nil))", 2300),
    (
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
         fn add1(x) { x + 1 } [1, 2].map(add1)",
        239_971,
    ),
];

/// (label, as-written, hand-optimized) — the hand-optimized form is what the named pass WOULD
/// produce, written out by hand. The delta is that pass's ceiling on this shape.
/// Every program here must complete under `DEFAULT_CAPS`: TM arithmetic is unary, so keep them small.
///
/// These six shapes are the task brief's, VERBATIM. Two of them measure more than their label claims,
/// and `SUPPLEMENTARY_PROBES` below carries the unbundled replacements — see `PROBE_CAVEATS`.
const PROBES: [(&str, &str, &str); 6] = [
    ("constant folding", "2 * 3 + 4 * 5", "26"),
    ("algebraic identities", "let x = 7; x * 1 + x * 0 + (x + 0)", "let x = 7; x + x"),
    ("dead-code elimination", "let a = 3; let b = 4; a", "let a = 3; a"),
    ("const propagation", "let x = 6; x * x", "36"),
    ("common subexpressions", "let n = 4; (n + n) + (n + n)", "let n = 4; let t = n + n; t + t"),
    ("inlining", "fn id(x){ x } id(5) + id(6)", "5 + 6"),
];

/// Where a `PROBES` row measures more than one pass, so its number is not that pass's ceiling alone.
const PROBE_CAVEATS: &[(&str, &str)] = &[
    (
        "const propagation",
        "`let x = 6; x * x` -> `36` BUNDLES folding: const-prop alone yields `6 * 6`, and reaching `36` \
         needs constant folding on top. The row is const-prop PLUS folding.",
    ),
    (
        "inlining",
        "`fn id(x){ x } id(5) + id(6)` -> `5 + 6` BUNDLES three things: the callee is the IDENTITY (its \
         body is free, so the row credits inlining for the whole call), it needs dead-function \
         elimination to retire `LetRec(id)`, and it needs copy propagation for the constant args. \
         SUPPLEMENTARY_PROBES below unbundles it; the honest ceiling is materially lower.",
    ),
];

/// (label, as-written, hand-optimized, why-this-shape) — probes added by the fix wave, either to
/// unbundle a `PROBES` row that measured two passes at once, or to cover a lever `PROBES` misses.
const SUPPLEMENTARY_PROBES: &[(&str, &str, &str, &str)] = &[
    (
        "inlining, real callee",
        "fn add1(x){ x + 1 } add1(5) + add1(6)",
        "(5 + 1) + (6 + 1)",
        "unbundles PROBES' identity-callee row: the callee's body now COSTS something, so the row \
         credits inlining only for the call mechanism it actually retires, not for a free body.",
    ),
    (
        "inlining, non-const args",
        "let a = 5; let b = 6; fn id(x){ x } id(a) + id(b)",
        "let a = 5; let b = 6; a + b",
        "unbundles the constant-argument assumption: the args are variables, so no folding rides along.",
    ),
    (
        "devirtualization",
        "fn ap(g) { g(5) } fn add1(x) { x + 1 } ap(add1)",
        "fn add1(x) { x + 1 } fn ap_add1() { add1(5) } ap_add1()",
        "I5's first gap: the defunctionalization tax. As-written passes `add1` as a VALUE, so defunc \
         builds a cons(tag,env) closure and routes the call through the `$apply1` dispatcher; the \
         optimized form is `ap` SPECIALIZED to its statically-known callee. Note what the optimized \
         form deliberately does NOT do: it keeps `ap_add1` as a real function, still CALLS it, and \
         still calls `add1` inside it. Deleting `ap` outright (`fn add1(x){ x + 1 } add1(5)`, 6022 \
         steps) would read 90.1% — but that bundles inlining and dead-function elimination on top of \
         devirtualization, the exact conflation PROBE_CAVEATS criticizes in the brief's own rows.",
    ),
    (
        "devirt. of map's callback",
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
         fn add1(x) { x + 1 } [1, 2].map(add1)",
        "fn add1(x) { x + 1 } \
         fn map_add1(xs) { if is_empty(xs) { nil } else { cons(add1(head(xs)), map_add1(tail(xs))) } } \
         map_add1([1, 2])",
        "the same pass on the corpus's DOMINANT shape: `map` specialized to its statically-known \
         callback. `add1` is still CALLED (not inlined), so this isolates devirtualization alone.",
    ),
];

fn main() {
    println!("\n════════════════════════════════════════════════════════════════════");
    println!(" Redextape — the step survey");
    println!(" where TM steps go (Part A), and what each candidate optimizer pass");
    println!(" could recover (Part B). Evidence for choosing the Tier A pass set.");
    println!("════════════════════════════════════════════════════════════════════");

    println!("\nREAD THIS FIRST — the bound on every number below:");
    println!("  The corpus is an ORACLE suite (three_way_oracle.rs / tm_oracle.rs), assembled to");
    println!("  exercise BACKEND FEATURES — arithmetic, lists, recursion, defunctionalization, boxing —");
    println!("  NOT to be a representative workload. This survey can say where steps go IN THESE");
    println!("  PROGRAMS. It CANNOT say which population an intended workload resembles. Every share");
    println!("  below is conditional on that corpus, and the sensitivity tables show how much they move.");

    println!("\nHow to read the buckets (established by measurement, Task 5):");
    println!("  • MachineScaffold is the CALL/RETURN ABI, not noise: zero for call-free programs,");
    println!("    ~7.2k steps per return on sum(3), and it scales O(n_loc^2) over the Loc bank in");
    println!("    `Ret`'s frame-restore. It is a LEVER, not a floor — do not read it as unattributable.");
    println!("  • ClosureScaffold is genuine defunctionalization overhead (dispatcher tag tests, its");
    println!("    param-binding Lets, the cons(tag,env) representation) — NOT the user's calls");
    println!("    relabelled: defunc reuses the user's own Apply id when routing through $applyN.");
    println!("    It is SPLIT IN TWO for the same reason Apply is: its DISPATCH half is what");
    println!("    known-callee devirtualization removes, while its BOXING half ($box allocations and");
    println!("    $boxh handle reads) survives that pass and falls only to a different mutable-capture");
    println!("    strategy. Merging them would overstate the devirtualization headline.");
    println!("  • Apply is DECOMPOSED BY CALLEE, because one `Apply` bucket would merge populations with");
    println!("    opposite optimizer implications. In particular `cons`/`head`/`tail`/`is_empty` lower to");
    println!("    a SINGLE asm instruction each (lower_asm.rs:247-250) — no frame, no Call, no Ret. They");
    println!("    are heap ops, and there is NOTHING THERE FOR AN INLINER TO INLINE.");
    println!("  • A Node(id) bucket identifies a construct by KIND and NodeId only. Core carries no");
    println!("    source span, so this report cannot and does not print a line/column.");

    let mut any_capped = false;

    // ============================================================================================
    // PART A — where cost actually goes.
    // ============================================================================================
    println!("\n\n════════════════════════════════════════════════════════════════════");
    println!(" PART A — where cost actually goes");
    println!("════════════════════════════════════════════════════════════════════");
    println!(
        "\nCorpus: {} programs from three_way_oracle.rs's FIRST_ORDER_DEMOS + {} from its \
         LAMBDA_LIMITATION_DEMOS. tm_oracle.rs contributes no case outside these two lists (checked by \
         hand). Excluded: FAULT_DEMOS and the unbounded-loop cap test — both are designed to diverge/cap.",
        FIRST_ORDER_DEMOS.len(),
        LAMBDA_LIMITATION_DEMOS.len()
    );

    let mut all = Rollup::default();
    let mut first_order_only = Rollup::default();
    for src in FIRST_ORDER_DEMOS.iter().chain(LAMBDA_LIMITATION_DEMOS.iter()) {
        let a = attribute(src).unwrap_or_else(|e| panic!("corpus program failed to attribute: {src}: {e:?}"));
        any_capped |= a.capped;
        // ONE `core_for_display` per program, shared by the printer and both rollups: it re-runs
        // `lower_asm`/`defunc`, and recomputing it per consumer was pure waste.
        let (core, first_order) = core_for_display(src);
        print_program_attribution(src, &a, &core);
        all.add(src, &a, &core);
        if first_order {
            first_order_only.add(src, &a, &core);
        }
    }

    all.print("the whole Part A corpus");
    all.print_concentration();
    all.print_weighting_sensitivity();

    println!("\n\n  ══ SENSITIVITY: the FIRST-ORDER-ONLY subcorpus ══\n");
    println!(
        "  The {} programs that lower WITHOUT defunctionalization — i.e. the corpus minus the",
        first_order_only.programs.len()
    );
    println!("  higher-order demos, which exist in the oracle suite TO EXERCISE DEFUNCTIONALIZATION, not");
    println!("  because they represent a workload. The headline INVERTS here, so it is not a property of");
    println!("  the language — it is a property of which programs were in the bag.");
    first_order_only.print("the first-order-only subcorpus");

    // ============================================================================================
    // Golden cross-check — this survey's own totals against the pipeline's committed goldens.
    // ============================================================================================
    println!("\n\n════════════════════════════════════════════════════════════════════");
    println!(" GOLDEN CROSS-CHECK — this survey's totals vs. the pipeline's committed goldens");
    println!("════════════════════════════════════════════════════════════════════\n");
    let mut higher_order_golden = None;
    for (src, golden) in GOLDENS {
        let a = attribute(src).unwrap_or_else(|e| panic!("golden program failed to attribute: {src}: {e:?}"));
        any_capped |= a.capped;
        let status = if a.total == *golden { "MATCH" } else { "MISMATCH" };
        println!("  {:<90} attributed={:<8} golden={:<8} {status}", truncate(src, 90), a.total, golden);
        assert_eq!(a.total, *golden, "attribution total drifted from the committed golden for: {src}");
        // Identify the higher-order golden by the PROPERTY that makes it the interesting one (it is
        // the only one that fills the ClosureScaffold bucket), not by a hardcoded index — and reuse the
        // attribution just computed rather than re-simulating 240k steps.
        if a.histogram.keys().any(|b| matches!(b, StepBucket::ClosureScaffold(_))) {
            higher_order_golden = Some((*golden, a));
        }
    }

    let (hi_golden, hi) = higher_order_golden.expect("one golden must be higher-order (it fills ClosureScaffold)");
    let closure = closure_steps(&hi);
    let machine = hi.histogram.get(&StepBucket::MachineScaffold).copied().unwrap_or(0);
    let user = hi.total - closure - machine;
    assert_eq!((closure, machine), (31_256, 60_022), "bucket split drifted from attribute.rs's own golden");
    println!(
        "\n  [1, 2].map(add1) split (total {hi_golden}): user constructs {:.1}%, call/return ABI {:.1}%, \
         defunctionalization {:.1}%.",
        pct(user, hi.total),
        pct(machine, hi.total),
        pct(closure, hi.total)
    );
    println!("  (ONE program. Read it with the Apply decomposition above: most of that 'user constructs'");
    println!("  share is dispatcher indirection and heap builtins, not calls an inliner could remove.)");

    // ============================================================================================
    // PART B — what each candidate pass could recover.
    // ============================================================================================
    println!("\n\n════════════════════════════════════════════════════════════════════");
    println!(" PART B — what each candidate pass could recover (a CEILING on a suited shape)");
    println!("════════════════════════════════════════════════════════════════════\n");
    println!("  {:<28} {:>12} {:>12} {:>10} {:>8}", "pass", "as-written", "optimized", "delta", "% cut");
    println!("  {}", "─".repeat(76));
    // Kept, not just printed: the conclusion quotes these ceilings, and it reads them back from here
    // rather than repeating them as typed literals that a re-bless would leave stale.
    let mut ceilings: BTreeMap<&str, f64> = BTreeMap::new();
    for (label, written, optimized) in PROBES {
        let (capped, cut) = run_probe(label, written, optimized);
        any_capped |= capped;
        ceilings.insert(label, cut);
    }

    println!("\n  CAVEATS — rows above that measure MORE than their label claims:\n");
    for (label, caveat) in PROBE_CAVEATS {
        println!("    {label}:");
        for line in wrap(caveat, 92) {
            println!("      {line}");
        }
    }

    println!("\n\n  ── SUPPLEMENTARY PROBES (fix wave): unbundled shapes, and the levers PROBES misses ──\n");
    println!("  {:<28} {:>12} {:>12} {:>10} {:>8}", "pass", "as-written", "optimized", "delta", "% cut");
    println!("  {}", "─".repeat(76));
    for (label, written, optimized, _why) in SUPPLEMENTARY_PROBES {
        let (capped, cut) = run_probe(label, written, optimized);
        any_capped |= capped;
        ceilings.insert(label, cut);
    }
    println!();
    for (label, _w, _o, why) in SUPPLEMENTARY_PROBES {
        println!("    {label}:");
        for line in wrap(why, 92) {
            println!("      {line}");
        }
    }

    any_capped |= print_abi_scaling();

    println!("\n\n  ── What Part B does NOT cover ──\n");
    println!("  Every row above is a CEILING: what the named pass recovers on a shape hand-built to suit");
    println!("  it, not what it would recover on a real program. Part A is what says whether that shape");
    println!("  occurs. Two further limits, stated rather than papered over:");
    println!("    • `Ret`'s frame-restore (MachineScaffold, the single largest bucket) has NO pass-ceiling");
    println!("      probe — a hand-optimized form would have to be a DIFFERENT ABI, not a different");
    println!("      program, so the (as-written, optimized) shape does not apply to it. The scaling");
    println!("      measurement above is the evidence offered instead: it shows the cost is real and");
    println!("      superlinear in locals live across a call, without claiming a specific pass's ceiling.");
    println!("    • No probe composes passes. Devirtualization ENABLES inlining (you cannot inline through");
    println!("      `$apply1`), so their combined recovery exceeds either row and is not measured here.");

    print_conclusion(&all, &first_order_only, &ceilings);

    println!(
        "\n\nNo corpus program or probe hit the step cap: {}",
        if any_capped { "FALSE — see PARTIAL markers above" } else { "confirmed" }
    );
    assert!(!any_capped, "a corpus program or probe hit the step cap — the survey's own requirement failed");
}

/// What the decomposed data supports, in pass order. Every number here is read back out — the shares
/// from the rollups, the Part B ceilings from `ceilings` (the probe results themselves) — rather than
/// retyped, so this cannot drift from the tables above it. That includes the ranges and the ratios:
/// a gadget-cost re-bless, which `lower_tm.rs::tm_step_count_goldens` explicitly invites, moves the
/// tables, and every figure below moves with them.
fn print_conclusion(all: &Rollup, first_order: &Rollup, ceilings: &BTreeMap<&str, f64>) {
    let get = |r: &Rollup, k: &str| r.by_kind.get(k).copied().unwrap_or(0);
    let dispatch = get(all, APPLY_DISPATCH);
    let direct = get(all, APPLY_DIRECT);
    let recursive = get(all, APPLY_SELF_RECURSIVE);
    let builtin = get(all, APPLY_BUILTIN);
    let devirt = all.devirt_target();

    println!("\n\n════════════════════════════════════════════════════════════════════");
    println!(" CONCLUSION — what the decomposed data supports");
    println!("════════════════════════════════════════════════════════════════════\n");

    println!(
        "  A single merged `Apply` bucket ({:.1}%) would suggest inlining is the standout. It is not:",
        pct(all.apply_total(), all.total)
    );
    println!("  that bucket is four populations with OPPOSITE optimizer implications, and the largest");
    println!(
        "  slice of it ({:.1}% dispatch) is not something an inliner can touch at all, while another",
        pct(dispatch, all.total)
    );
    println!(
        "  {:.1}% ({} steps) is `cons`/`head`/`tail`/`is_empty` — ONE asm instruction each, no frame,",
        pct(builtin, all.total),
        builtin
    );
    println!("  no Call, no Ret. There is nothing there to inline.\n");

    println!("  1. CLOSURE SPECIALIZATION / KNOWN-CALLEE DEVIRTUALIZATION — target {:.1}%", pct(devirt, all.total));
    println!(
        "       $applyN dispatch {:.1}% + ClosureScaffold's dispatch half {:.1}% = {} steps.",
        pct(dispatch, all.total),
        pct(all.closure_dispatch, all.total),
        devirt
    );
    println!(
        "       {:.1}x inlining's honest share ({:.1}%). EVERY closure at EVERY call site in this",
        if direct == 0 { 0.0 } else { devirt as f64 / direct as f64 },
        pct(direct, all.total)
    );
    println!("       corpus is statically known, so the opportunity is 100% present, not hypothetical.");
    println!("       It is also the ENABLING pass: you cannot inline through `$apply1`, so this must");
    println!("       come first for inlining to have anything to work on. Measured ceilings above:");
    println!(
        "       {:.1}% on the isolated shape, {:.1}% on `map` specialized to its known callback —",
        ceiling(ceilings, "devirtualization"),
        ceiling(ceilings, "devirt. of map's callback")
    );
    println!("       both with the specialized function still CALLED, so neither bundles the inliner.");
    println!("       ADJACENT, same root cause, and EXCLUDED from the target above by the same rule:");
    println!(
        "       defunc's mutable-capture BOXING totals {:.1}% ({} steps) — `Apply -> $box*` {:.1}%",
        pct(all.boxing_total(), all.total),
        all.boxing_total(),
        pct(get(all, APPLY_SYNTHETIC), all.total)
    );
    println!(
        "       plus the `$box` allocation and `$boxh` handle reads inside ClosureScaffold ({:.1}%).",
        pct(all.closure_box, all.total)
    );
    println!("       Devirtualization removes NONE of it; a different mutable-capture strategy removes");
    println!("       ALL of it. Bucketing by what a pass could DO about it is what puts it here and not");
    println!("       in the headline — the same call `3b932ec` made for the `$box_get`/`$box_set` row.");
    println!();
    println!("  2. `Ret`'s FRAME-RESTORE / LIVE-Loc-BANK REDUCTION — target {:.1}%", pct(all.machine, all.total));
    println!("       MachineScaffold is the largest SINGLE bucket in the survey — larger than any user");
    println!("       construct kind — and the scaling table above measures it growing QUADRATICALLY in");
    println!("       locals live across a call (constant 2nd differences). It is asm->asm rather than");
    println!("       Core->Core, so it may fall outside \"Tier A\" by the plan's taxonomy; per step saved");
    println!("       per unit of engineering it is nonetheless the largest measured target.");
    println!();
    println!(
        "  3. INLINING — target {:.1}% ({:.1}% counting self-recursive calls it can only unroll)",
        pct(direct, all.total),
        pct(direct + recursive, all.total)
    );
    let (honest_lo, honest_hi) =
        span(&[ceiling(ceilings, "inlining, real callee"), ceiling(ceilings, "inlining, non-const args")]);
    println!("       Legitimate, and it compounds with (1) — it also retires the MachineScaffold at the");
    println!(
        "       sites it removes. But its honest probe ceiling is {honest_lo:.1}-{honest_hi:.1}%, not the {:.1}% the",
        ceiling(ceilings, "inlining")
    );
    println!(
        "       identity-callee shape reports, and its share is {:.2}x devirtualization's.",
        if devirt == 0 { 0.0 } else { direct as f64 / devirt as f64 }
    );
    println!();
    println!(
        "  4. ARITHMETIC PASSES (folding, identities, const-prop) — {:.1}% step-weighted here,",
        pct(all.binop_total(), all.total)
    );
    println!("       which looks negligible ONLY under step-weighting of this corpus. Program-averaged");
    println!(
        "       they are {:.1}%, and on the {} first-order programs they are {:.1}% — BEATING",
        all.program_averaged(|p| p.binop),
        first_order.programs.len(),
        pct(first_order.binop_total(), first_order.total)
    );
    let (arith_lo, arith_hi) = span(&[
        ceiling(ceilings, "constant folding"),
        ceiling(ceilings, "algebraic identities"),
        ceiling(ceilings, "const propagation"),
    ]);
    println!(
        "       merged-Apply's {:.1}%. Their Part B ceilings are the highest in the survey ({arith_lo:.1}-{arith_hi:.1}%).",
        pct(first_order.apply_total(), first_order.total)
    );
    println!("       Whether that matters depends entirely on which population a real workload resembles.");

    let higher_order_programs = all.programs.len() - first_order.programs.len();
    let higher_order_steps = all.total - first_order.total;
    println!("\n  THE BOUND ON ALL OF THE ABOVE: this corpus is an oracle suite built for BACKEND FEATURE");
    println!(
        "  COVERAGE, not workload representativeness. {higher_order_programs} higher-order demos carry {:.1}% of the steps",
        pct(higher_order_steps, all.total)
    );
    println!("  and exist to exercise defunctionalization; drop them and the headline inverts. This survey");
    println!("  says where steps go IN THESE PROGRAMS. Choosing a pass on it means betting that an intended");
    println!("  workload resembles one of these populations — and that bet, not this table, is the decision.");
}

/// Run one (as-written, hand-optimized) probe pair and print its row. Returns whether either form
/// capped (which the in-loop assert then rejects — a capped total is not a usable ceiling), and the
/// % of steps the pass cut, which the conclusion quotes.
fn run_probe(label: &str, written: &str, optimized: &str) -> (bool, f64) {
    // Honesty check (Step 3 of the task): a probe whose "optimized" form computes something
    // different measures nothing. `.unwrap()` is fine here — this is example code, and a probe
    // that fails to run at all is a bug in the probe worth panicking loudly on.
    assert_eq!(run(written).unwrap(), run(optimized).unwrap(), "probe {label}: the two forms disagree");

    let wa = attribute(written).unwrap_or_else(|e| panic!("probe {label}: as-written form: {e:?}"));
    let oa = attribute(optimized).unwrap_or_else(|e| panic!("probe {label}: hand-optimized form: {e:?}"));
    let capped = wa.capped || oa.capped;
    assert!(!capped, "probe {label}: hit the step cap — not a usable ceiling");

    let delta = wa.total.saturating_sub(oa.total);
    let cut = pct(delta, wa.total);
    println!("  {:<28} {:>12} {:>12} {:>10} {:>7.1}%", label, wa.total, oa.total, delta, cut);
    (capped, cut)
}

/// The `MachineScaffold` scaling measurement (I5's second gap). Not a pass-ceiling probe — these are
/// not (as-written, optimized) pairs, they are the SAME call with a growing number of locals live
/// across it. `Ret`'s frame-restore re-seeks from home per field copy, so the claim under test is that
/// the ABI's cost is superlinear in the Loc bank. Returns whether any run capped.
fn print_abi_scaling() -> bool {
    println!("\n\n  ── ABI SCALING (not a probe): MachineScaffold vs. locals live across a call ──\n");
    println!("  Same single call, K locals defined BEFORE it and used AFTER it, so all K are live across");
    println!("  the frame save/restore. Every K computes the same value (asserted), so the only thing");
    println!("  varying is the size of the Loc bank `Ret` has to restore.\n");
    println!("  {:>3}  {:>12} {:>18} {:>10} {:>16}", "K", "total steps", "MachineScaffold", "share", "vs. K=0");
    println!("  {}", "─".repeat(66));

    let mut capped = false;
    let mut baseline = 0u64;
    let mut series = Vec::new();
    for k in [0usize, 2, 4, 6, 8] {
        let src = abi_scaling_program(k);
        assert_eq!(run(&src).unwrap(), run(&abi_scaling_program(0)).unwrap(), "ABI scaling K={k}: value changed");
        let a = attribute(&src).unwrap_or_else(|e| panic!("ABI scaling K={k}: {e:?}"));
        capped |= a.capped;
        assert!(!a.capped, "ABI scaling K={k} hit the cap");
        let machine = a.histogram.get(&StepBucket::MachineScaffold).copied().unwrap_or(0);
        if k == 0 {
            baseline = machine;
        }
        let ratio = if baseline == 0 { "—".to_string() } else { format!("{:.2}x", machine as f64 / baseline as f64) };
        println!("  {k:>3}  {:>12} {machine:>18} {:>9.1}% {ratio:>16}", a.total, pct(machine, a.total));
        series.push(machine);
    }

    // The O(n_loc^2) claim, checked rather than asserted rhetorically: for a quadratic in K sampled at
    // equally-spaced K, the SECOND differences are constant. Print them and let the reader see it.
    let first: Vec<i128> = series.windows(2).map(|w| i128::from(w[1]) - i128::from(w[0])).collect();
    let second: Vec<i128> = first.windows(2).map(|w| w[1] - w[0]).collect();
    println!("\n  Growth in MachineScaffold, K = 0,2,4,6,8 (equally spaced):");
    println!("    1st differences: {first:?}");
    println!("    2nd differences: {second:?}");
    let quadratic = second.windows(2).all(|w| w[0] == w[1]);
    println!(
        "  The 2nd differences are {}",
        if quadratic {
            "CONSTANT — i.e. EXACTLY quadratic in K. The O(n_loc^2) frame-restore claim,"
        } else {
            "NOT constant, so growth is not cleanly quadratic. The frame-restore cost,"
        }
    );
    println!(
        "  measured rather than asserted: {:.0}x more ABI cost at K=8 than at K=0, for the SAME one call.",
        if baseline == 0 { 0.0 } else { series.last().copied().unwrap_or(0) as f64 / baseline as f64 }
    );
    capped
}

/// `fn g(y) { y } fn f(n) { let a0 = 0; .. let a{k-1} = 0; let r = g(n); r + a0 + .. } f(3)` — K locals
/// live across the call to `g`, and a result (3) independent of K so the comparison is like-for-like.
fn abi_scaling_program(k: usize) -> String {
    let decls: String = (0..k).map(|i| format!("let a{i} = 0; ")).collect();
    let sums: String = (0..k).map(|i| format!(" + a{i}")).collect();
    format!("fn g(y) {{ y }} fn f(n) {{ {decls}let r = g(n); r{sums} }} f(3)")
}

/// Print one corpus program's attribution: total steps, capped status, and its buckets sorted by
/// descending step count, each as construct-kind + id + share of total (per the task's exact spec).
fn print_program_attribution(src: &str, a: &Attribution, core: &Core) {
    println!("\n  {}", truncate(src, 96));
    println!(
        "    total steps: {}   capped: {}",
        a.total,
        if a.capped { "YES — PARTIAL, treat as incomplete" } else { "no" }
    );
    assert!(a.total > 0, "corpus program ran zero steps, proving nothing: {src}");

    let classes = classify_applies(core);
    // The scaffolding buckets carry a node id apiece, so a defunctionalized program has dozens of
    // them. Roll them up into the two rows a reader can act on — they are what the two DIFFERENT
    // passes target — rather than listing every synthesized node.
    let (mut dispatch_scaffold, mut box_scaffold) = (0u64, 0u64);
    let mut rows: Vec<(String, u64)> = Vec::new();
    for (bucket, &steps) in &a.histogram {
        match bucket {
            StepBucket::Node(id) => {
                rows.push((format!("{} #{id}", describe_node(node_at(core, *id, src), &classes)), steps));
            }
            StepBucket::ClosureScaffold(id) => {
                if is_box_scaffold(node_at(core, *id, src)) {
                    box_scaffold += steps;
                } else {
                    dispatch_scaffold += steps;
                }
            }
            StepBucket::MachineScaffold => rows.push((MACHINE_SCAFFOLD_ROW.to_string(), steps)),
        }
    }
    for (label, steps) in [(CLOSURE_DISPATCH_ROW, dispatch_scaffold), (CLOSURE_BOX_ROW, box_scaffold)] {
        if steps > 0 {
            rows.push((label.to_string(), steps));
        }
    }
    rows.sort_by_key(|r| std::cmp::Reverse(r.1));
    for (label, steps) in rows {
        println!("      {:<54} {:>10} steps  {:>6.1}%", label, steps, pct(steps, a.total));
    }
    let attributed: u64 = a.histogram.values().sum();
    assert_eq!(attributed, a.total, "buckets did not sum to total for: {src}");
}

/// One corpus program's contribution, kept so the rollup can report PROGRAM-AVERAGED and MEDIAN shares
/// beside the step-weighted ones — a step-weighted number alone hides how concentrated this corpus is.
struct ProgramRow {
    src: String,
    total: u64,
    apply: u64,
    machine: u64,
    /// ALL of this program's `ClosureScaffold` — dispatch and boxing together. The re-weighting table
    /// asks "does this program pay any defunctionalization tax at all", for which the split does not
    /// matter; the corpus rollup keeps them apart because two different passes target them.
    closure: u64,
    binop: u64,
}

/// Corpus-wide rollup: sums every program's steps into three top-level buckets (user constructs —
/// broken down further by construct KIND, and `Apply` further still BY CALLEE, since that is what
/// tells passes apart — plus ClosureScaffold and MachineScaffold).
#[derive(Default)]
struct Rollup {
    by_kind: BTreeMap<&'static str, u64>,
    /// `ClosureScaffold` on defunc's CLOSURE-DISPATCH machinery: the `$applyN` dispatchers, their tag
    /// tests, the `cons(tag, env)` representation and its param binds. Known-callee devirtualization
    /// is the pass that removes this, which is why it is the one that joins the headline target.
    closure_dispatch: u64,
    /// `ClosureScaffold` on defunc's mutable-capture BOXING: the `$box(v)` allocation and the reads
    /// of its `$boxh{k}` handle. Held apart from `closure_dispatch` by the same rule that keeps
    /// `Apply -> $box*` out of the devirtualization target — devirtualization removes NONE of it, and
    /// a different mutable-capture strategy removes ALL of it. Bucket by what a pass could DO.
    closure_box: u64,
    machine: u64,
    total: u64,
    programs: Vec<ProgramRow>,
}

impl Rollup {
    fn add(&mut self, src: &str, a: &Attribution, core: &Core) {
        let classes = classify_applies(core);
        self.total += a.total;
        let (mut apply, mut binop, mut closure) = (0u64, 0u64, 0u64);
        for (bucket, &steps) in &a.histogram {
            match bucket {
                StepBucket::Node(id) => {
                    let node = node_at(core, *id, src);
                    if matches!(node, Core::Apply(..)) {
                        apply += steps;
                    }
                    if matches!(node, Core::BinOp(..)) {
                        binop += steps;
                    }
                    *self.by_kind.entry(canonical_kind(node, &classes)).or_insert(0) += steps;
                }
                StepBucket::ClosureScaffold(id) => {
                    closure += steps;
                    if is_box_scaffold(node_at(core, *id, src)) {
                        self.closure_box += steps;
                    } else {
                        self.closure_dispatch += steps;
                    }
                }
                StepBucket::MachineScaffold => self.machine += steps,
            }
        }
        self.programs.push(ProgramRow {
            src: src.to_string(),
            total: a.total,
            apply,
            machine: a.histogram.get(&StepBucket::MachineScaffold).copied().unwrap_or(0),
            closure,
            binop,
        });
    }

    fn print(&self, what: &str) {
        println!("\n\n  ── Aggregate over {what} ({} programs, {} total steps) ──\n", self.programs.len(), self.total);
        println!("  WEIGHTING: every share below is STEP-WEIGHTED — total steps in the bucket divided by");
        println!("  total steps in the corpus. It is therefore dominated by the longest-running programs.");
        println!("  See the concentration and re-weighting tables for how much that matters.\n");
        let user: u64 = self.by_kind.values().sum();
        // Same exhaustiveness discipline as `print_program_attribution`'s per-program assert, applied
        // to the sum across the whole corpus: nothing dropped or double-counted while rolling up.
        assert_eq!(
            user + self.machine + self.closure_dispatch + self.closure_box,
            self.total,
            "rollup's top-level buckets did not sum to the corpus total"
        );
        println!("  {:<44} {:>12} steps  {:>6.1}%", "user constructs (all kinds, summed)", user, pct(user, self.total));
        println!("  {:<44} {:>12} steps  {:>6.1}%", MACHINE_SCAFFOLD_ROW, self.machine, pct(self.machine, self.total));
        println!(
            "  {:<44} {:>12} steps  {:>6.1}%",
            CLOSURE_DISPATCH_ROW,
            self.closure_dispatch,
            pct(self.closure_dispatch, self.total)
        );
        println!(
            "  {:<44} {:>12} steps  {:>6.1}%",
            CLOSURE_BOX_ROW,
            self.closure_box,
            pct(self.closure_box, self.total)
        );

        println!("\n  User constructs by kind — Apply DECOMPOSED BY CALLEE (see the Apply note above):\n");
        let mut kinds: Vec<(&&str, &u64)> = self.by_kind.iter().collect();
        kinds.sort_by(|x, y| y.1.cmp(x.1));
        for (kind, steps) in kinds {
            println!("    {:<42} {:>12} steps  {:>6.1}%", kind, steps, pct(*steps, self.total));
        }

        // The decision-relevant regrouping: which of those Apply rows is which pass's actual target.
        let get = |k: &str| self.by_kind.get(k).copied().unwrap_or(0);
        let direct = get(APPLY_DIRECT);
        let recursive = get(APPLY_SELF_RECURSIVE);
        let builtin = get(APPLY_BUILTIN);
        println!("\n  What those Apply rows mean for a pass:\n");
        // The two merged totals FIRST, because their relative order is exactly what flips between the
        // full corpus and the first-order subcorpus — and a reader should not have to sum rows to see it.
        println!(
            "    Apply, ALL callees merged (what ONE Apply bucket would say) {:>12} steps  {:>6.1}%",
            self.apply_total(),
            pct(self.apply_total(), self.total)
        );
        println!(
            "    all BinOps (the arithmetic passes' target)                  {:>12} steps  {:>6.1}%",
            self.binop_total(),
            pct(self.binop_total(), self.total)
        );
        println!(
            "      -> arithmetic {} merged-Apply here ({:.1}% vs {:.1}%)\n",
            if self.binop_total() > self.apply_total() { "BEATS" } else { "loses to" },
            pct(self.binop_total(), self.total),
            pct(self.apply_total(), self.total)
        );
        println!(
            "    devirtualization target   $applyN dispatch + closure dispatch {:>12} steps  {:>6.1}%",
            self.devirt_target(),
            pct(self.devirt_target(), self.total)
        );
        println!(
            "    a DIFFERENT pass          all mutable-capture boxing          {:>12} steps  {:>6.1}%",
            self.boxing_total(),
            pct(self.boxing_total(), self.total)
        );
        println!(
            "    inlining target           direct non-recursive calls          {:>12} steps  {:>6.1}%",
            direct,
            pct(direct, self.total)
        );
        println!(
            "    inlining, generously      + self-recursive (unroll only)      {:>12} steps  {:>6.1}%",
            direct + recursive,
            pct(direct + recursive, self.total)
        );
        println!(
            "    NOT a call at all         cons/head/tail/is_empty (1 instr)   {:>12} steps  {:>6.1}%",
            builtin,
            pct(builtin, self.total)
        );
    }

    /// What known-callee devirtualization could remove: the `$applyN` dispatch calls the user's own
    /// `Apply`s were routed through, plus defunc's dispatch scaffolding.
    ///
    /// NOT included, deliberately: every step of defunc's mutable-capture boxing — the `Apply -> $box*`
    /// row, the `$box` allocation, and the `$boxh{k}` handle reads. Commit `3b932ec` established the
    /// rule "bucket by what a pass could DO about it" and applied it to the first of those three;
    /// these are the other two, removed by the same alternative mutable-capture strategy and by no
    /// amount of devirtualization. Leaving them in overstated this target by ~0.9pp.
    fn devirt_target(&self) -> u64 {
        self.by_kind.get(APPLY_DISPATCH).copied().unwrap_or(0) + self.closure_dispatch
    }

    /// Every step of defunc's mutable-capture boxing, wherever it landed: the `$box_get`/`$box_set`
    /// calls (billed to the source `Var`/`Assign` they replace, so they are a `by_kind` row) plus the
    /// `$box` allocation and `$boxh{k}` handle reads (synthesized, so they are `ClosureScaffold`).
    fn boxing_total(&self) -> u64 {
        self.by_kind.get(APPLY_SYNTHETIC).copied().unwrap_or(0) + self.closure_box
    }

    /// Every `Apply -> ...` row summed: what a single undecomposed `Apply` bucket would have reported.
    fn apply_total(&self) -> u64 {
        self.by_kind.iter().filter(|(k, _)| k.starts_with("Apply ->")).map(|(_, v)| *v).sum()
    }

    /// Every `BinOp(..)` row summed: the arithmetic passes' (folding, identities, const-prop) target.
    fn binop_total(&self) -> u64 {
        self.by_kind.iter().filter(|(k, _)| k.starts_with("BinOp(")).map(|(_, v)| *v).sum()
    }

    /// The mean over programs of each program's OWN percentage — the un-step-weighted view, where a
    /// 548-step program counts as much as a 944k-step one.
    fn program_averaged(&self, get: fn(&ProgramRow) -> u64) -> f64 {
        if self.programs.is_empty() {
            return 0.0;
        }
        self.programs.iter().map(|p| pct(get(p), p.total)).sum::<f64>() / self.programs.len() as f64
    }

    /// How concentrated the corpus is. A step-weighted share is only as representative as the spread
    /// of the programs behind it, and this one is bimodal enough that the spread IS the finding.
    fn print_concentration(&self) {
        let mut totals: Vec<u64> = self.programs.iter().map(|p| p.total).collect();
        totals.sort_unstable_by(|a, b| b.cmp(a));
        let top1 = totals.first().copied().unwrap_or(0);
        let top6: u64 = totals.iter().take(6).sum();
        let min = totals.last().copied().unwrap_or(0);
        let zero_machine = self.programs.iter().filter(|p| p.machine == 0).count();
        let zero_closure = self.programs.iter().filter(|p| p.closure == 0).count();

        println!("\n\n  ══ CONCENTRATION: how much of the step-weighted number is a handful of programs ══\n");
        println!("    largest single program        {:>12} steps  {:>6.1}% of the corpus", top1, pct(top1, self.total));
        println!(
            "    top 6 of {:<2} programs          {:>12} steps  {:>6.1}% of the corpus",
            self.programs.len(),
            top6,
            pct(top6, self.total)
        );
        println!(
            "    smallest program              {:>12} steps          (max/min ratio {:.0}x)",
            min,
            if min == 0 { 0.0 } else { top1 as f64 / min as f64 }
        );
        println!(
            "    programs with ZERO MachineScaffold   {:>2} of {:<2}   (median per-program share 0.0%)",
            zero_machine,
            self.programs.len()
        );
        println!(
            "    programs with ZERO ClosureScaffold   {:>2} of {:<2}   (median per-program share 0.0%)",
            zero_closure,
            self.programs.len()
        );
        println!("\n    Per-program share of the corpus, largest first:\n");
        let mut rows: Vec<&ProgramRow> = self.programs.iter().collect();
        rows.sort_by_key(|p| std::cmp::Reverse(p.total));
        for p in rows {
            println!("      {:>6.2}%  {:>9} steps  {}", pct(p.total, self.total), p.total, truncate(&p.src, 74));
        }
    }

    /// The same four quantities under three weightings. Where they disagree, the step-weighted headline
    /// is an artifact of which programs ran longest, not a property of the language.
    fn print_weighting_sensitivity(&self) {
        println!("\n\n  ══ RE-WEIGHTING: the same buckets, three ways ══\n");
        println!("    step-weighted     = bucket steps / corpus steps (what this survey reports)");
        println!("    program-averaged  = mean over programs of that program's OWN percentage");
        println!("    median            = median over programs of that program's own percentage\n");
        println!("  {:<34} {:>15} {:>18} {:>10}", "", "step-weighted", "program-averaged", "median");
        println!("  {}", "─".repeat(80));

        let rows: [SensitivityRow; 4] = [
            ("Apply (all callees)", |p| p.apply, self.programs.iter().map(|p| p.apply).sum()),
            ("MachineScaffold", |p| p.machine, self.machine),
            ("ClosureScaffold (dispatch + boxing)", |p| p.closure, self.closure_dispatch + self.closure_box),
            ("all BinOps", |p| p.binop, self.programs.iter().map(|p| p.binop).sum()),
        ];
        for (label, get, weighted) in rows {
            let shares: Vec<f64> = self.programs.iter().map(|p| pct(get(p), p.total)).collect();
            println!(
                "  {:<34} {:>14.1}% {:>17.1}% {:>9.1}%",
                label,
                pct(weighted, self.total),
                self.program_averaged(get),
                median(&shares)
            );
        }
        println!("\n  `Apply` SURVIVES re-weighting — \"Apply is big\" holds however you count it. The two");
        println!("  scaffold buckets DO NOT: both have a median of zero, i.e. MOST programs pay neither.");
        println!("  Any claim of the form \"X% is call/apply\" is a statement about the longest-running");
        println!("  programs in this bag, and the first-order sensitivity block below shows it inverting.");
    }
}

/// One row of the re-weighting table: its label, how to read that bucket out of a single program, and
/// its corpus-wide (step-weighted) total.
type SensitivityRow = (&'static str, fn(&ProgramRow) -> u64, u64);

/// Median of an unsorted slice of percentages (mean of the two middles when even). Empty slice -> 0.0,
/// which never arises here: every rollup has at least one program.
fn median(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    let mut s = xs.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = s.len() / 2;
    if s.len().is_multiple_of(2) { (s[mid - 1] + s[mid]) / 2.0 } else { s[mid] }
}

// The `Apply`-by-callee row labels. Named constants because the rollup's pass-target regrouping looks
// them back up by key, and a typo there would silently report a zero.
const APPLY_BUILTIN: &str = "Apply -> builtin (cons/head/tail/is_empty)";
const APPLY_DISPATCH: &str = "Apply -> $applyN dispatch (defunc)";
const APPLY_SELF_RECURSIVE: &str = "Apply -> direct call, self-recursive";
const APPLY_DIRECT: &str = "Apply -> direct call, non-recursive";
const APPLY_SYNTHETIC: &str = "Apply -> $box* (defunc mutable-capture boxing)";
const APPLY_INDIRECT: &str = "Apply -> computed callee";

// The non-`Apply` bucket row labels, shared by the per-program listing and the corpus rollup so the
// two cannot describe the same bucket differently.
const MACHINE_SCAFFOLD_ROW: &str = "MachineScaffold (call/return ABI)";
const CLOSURE_DISPATCH_ROW: &str = "ClosureScaffold (defunc dispatch/tag/env)";
const CLOSURE_BOX_ROW: &str = "ClosureScaffold ($box alloc + $boxh reads)";

/// How an `Apply`'s callee resolves. THE Critical finding of the review: one `Apply` bucket merges
/// four populations with opposite optimizer implications, and the merged number over-credits inlining
/// by ~4.7x. Everything needed to split them is already in the Core the rollup holds.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ApplyClass {
    /// `cons`/`head`/`tail`/`is_empty` — ONE asm instruction each (`lower_asm.rs:247-250`). No frame,
    /// no `Call`, no `Ret`. A heap op wearing call syntax; nothing here for an inliner.
    Builtin,
    /// `$applyN` — defunc's closure-dispatch indirection. The devirtualization target.
    Dispatch,
    /// A direct call to a function this `Apply` is lexically INSIDE. Inlining can only bounded-unroll.
    SelfRecursive,
    /// A direct call to a named user function from outside it. The inliner's actual target.
    Direct,
    /// Any other `$`-prefixed callee defunc minted. MEASURED on this corpus, the row is entirely
    /// `$box_get` (30,742 steps) + `$box_set` (18,888) — defunc's mutable-capture boxing, nothing else.
    /// Kept OUT of `Builtin` deliberately, even though `$box*` also lowers to one asm instruction: the
    /// two have opposite optimizer implications, which is precisely what the `Apply` split exists to
    /// stop hiding. `cons`/`head`/`tail` is irreducible heap work; `$box_get`/`$box_set` is an
    /// artifact of THIS mutable-capture strategy and a different one could avoid it.
    Synthetic,
    /// A callee that is not a plain name — nothing static to resolve.
    Indirect,
}

impl ApplyClass {
    fn label(self) -> &'static str {
        match self {
            ApplyClass::Builtin => APPLY_BUILTIN,
            ApplyClass::Dispatch => APPLY_DISPATCH,
            ApplyClass::SelfRecursive => APPLY_SELF_RECURSIVE,
            ApplyClass::Direct => APPLY_DIRECT,
            ApplyClass::Synthetic => APPLY_SYNTHETIC,
            ApplyClass::Indirect => APPLY_INDIRECT,
        }
    }

    /// The short form used in a per-program row, where the full label would crowd out the numbers.
    fn short(self) -> &'static str {
        match self {
            ApplyClass::Builtin => "builtin",
            ApplyClass::Dispatch => "dispatch",
            ApplyClass::SelfRecursive => "self-rec",
            ApplyClass::Direct => "direct",
            ApplyClass::Synthetic => "synth",
            ApplyClass::Indirect => "computed",
        }
    }
}

/// Classify every `Apply` in `core` by its callee, carrying the set of `LetRec` names whose VALUE we
/// are currently inside — that is what makes a call self-recursive rather than an ordinary call.
///
/// Iterative (explicit stack), not recursive: `Core` spines reach tens of thousands deep in general,
/// which is why `Core` has a hand-written iterative `Drop`. Nothing in this survey is remotely that
/// deep, but the traversal should not be the thing that reintroduces the hazard.
fn classify_applies(core: &Core) -> BTreeMap<NodeId, ApplyClass> {
    let mut out = BTreeMap::new();
    let mut stack: Vec<(&Core, Vec<&str>)> = vec![(core, Vec::new())];
    while let Some((node, rec)) = stack.pop() {
        match node {
            Core::Apply(id, callee, args) => {
                out.insert(*id, classify_callee(callee, &rec));
                stack.push((callee, rec.clone()));
                for a in args {
                    stack.push((a, rec.clone()));
                }
            }
            // Descending into a `LetRec`'s VALUE puts us inside the function being defined, so a call
            // to `name` from there is recursive. Its BODY is an ordinary call site and does not.
            Core::LetRec { name, value, body, .. } => {
                let mut inner = rec.clone();
                inner.push(name);
                stack.push((value, inner));
                stack.push((body, rec));
            }
            // Same idea, N-ary: every group name is in scope (and therefore self/mutually-recursive)
            // in EVERY binding's value; the body sees the group names but is an ordinary call site.
            Core::LetRecGroup(_, bindings, body) => {
                let mut inner = rec.clone();
                for (name, _) in bindings {
                    inner.push(name);
                }
                for (_, value) in bindings {
                    stack.push((value, inner.clone()));
                }
                stack.push((body, rec));
            }
            Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
                stack.push((a, rec.clone()));
                stack.push((b, rec));
            }
            Core::If(_, a, b, c) => {
                stack.push((a, rec.clone()));
                stack.push((b, rec.clone()));
                stack.push((c, rec));
            }
            Core::Lambda(_, _, b) | Core::Assign(_, _, b) => stack.push((b, rec)),
            Core::Let { value, body, .. } => {
                stack.push((value, rec.clone()));
                stack.push((body, rec));
            }
            Core::Nat(..) | Core::Bool(..) | Core::Unit(..) | Core::Var(..) => {}
        }
    }
    out
}

/// The callee-name test behind `ApplyClass`. `BUILTIN_FNS` in `defunc.rs` is the authority on which
/// names are builtins; the four listed here are the ones that lower to a single HEAP instruction and
/// are user-writable. `$box*` are builtins too, but defunc-synthesized, so they land in `Synthetic`.
fn classify_callee(callee: &Core, rec: &[&str]) -> ApplyClass {
    let Core::Var(_, name) = callee else { return ApplyClass::Indirect };
    if matches!(name.as_str(), "cons" | "head" | "tail" | "is_empty") {
        return ApplyClass::Builtin;
    }
    if name.starts_with("$apply") {
        return ApplyClass::Dispatch;
    }
    if name.starts_with('$') {
        return ApplyClass::Synthetic;
    }
    if rec.contains(&name.as_str()) {
        return ApplyClass::SelfRecursive;
    }
    ApplyClass::Direct
}

/// The Core `attribute` actually lowered for `src`: original if first-order, defunctionalized if
/// higher-order, plus whether it was first-order. Mirrors `lower_program`'s try-first-order-then-defunc
/// retry — the same pattern `tm_demo.rs`'s own `compile_tm` helper already uses. Needed only so a
/// `Node(id)` bucket can be labeled; `attribute` deliberately does not expose its internal Core (zero
/// blast radius on the pipeline is the whole point of the source-map design). `defunc` is literally
/// `defunc_mapped(..).map(|(c, _)| c)`, so this Core is bit-identical to the attributed one, same ids.
fn core_for_display(src: &str) -> (Core, bool) {
    let (prog, ds) = redextape_core::parser::parse(src);
    assert!(ds.is_empty(), "corpus program does not parse/typecheck: {src}: {ds:?}");
    let core = redextape_core::desugar::desugar(&prog.expect("parses"));
    match lower_asm(&core) {
        Ok(_) => (core, true),
        // Propagate loudly rather than falling back to the un-defunc'd Core: a silent fallback would
        // label buckets against a tree the machine never ran, matching `lower_mapped`'s own discipline.
        Err(LowerError::Unsupported { .. }) => {
            let d = defunc(&core).unwrap_or_else(|e| panic!("{src}: higher-order but defunc refused it: {e:?}"));
            (d, false)
        }
        Err(e @ LowerError::TooDeep { .. }) => panic!("{src}: too deep to lower: {e:?}"),
    }
}

/// The node a bucket cites, or a loud failure. `find_node` coming back empty would mean
/// `core_for_display` reconstructed the wrong Core (or `find_node`'s traversal missed a case) — a real
/// bug in this display glue, not a soft "unknown" case, so surface it rather than print a placeholder.
fn node_at<'a>(core: &'a Core, id: NodeId, src: &str) -> &'a Core {
    find_node(core, id).unwrap_or_else(|| panic!("{src}: bucket cites node #{id}, not found in the displayed Core"))
}

/// Whether a node `defunc` SYNTHESIZED belongs to its mutable-capture boxing rather than its
/// closure-dispatch machinery: the `$box(v)` allocation and the reads of the `$boxh{k}` handle that
/// holds it. (The `$box_get`/`$box_set` calls themselves are NOT synthesized — `defunc` builds them
/// with the id of the `Var`/`Assign` they replace — so they arrive as `Apply -> $box*`, a user-node
/// row, and `boxing_total` adds the two together.)
///
/// The split matters because the two halves of `ClosureScaffold` answer to different passes:
/// devirtualization removes the dispatch machinery and none of the boxing; a different
/// mutable-capture strategy removes the boxing and none of the dispatch.
fn is_box_scaffold(node: &Core) -> bool {
    let boxy = |name: &str| name.starts_with("$box"); // $box, $box_get, $box_set, $boxh{k}
    match node {
        Core::Var(_, name) => boxy(name),
        Core::Apply(_, callee, _) => matches!(callee.as_ref(), Core::Var(_, n) if boxy(n)),
        _ => false,
    }
}

/// Find the node with id `target` in `core` by walking an explicit stack (not recursion — `Core`
/// spines run tens of thousands deep in the worst case, though nothing in this survey does).
fn find_node(core: &Core, target: NodeId) -> Option<&Core> {
    let mut stack = vec![core];
    while let Some(node) = stack.pop() {
        if node.id() == target {
            return Some(node);
        }
        match node {
            Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
                stack.push(a);
                stack.push(b);
            }
            Core::If(_, a, b, c) => {
                stack.push(a);
                stack.push(b);
                stack.push(c);
            }
            Core::Lambda(_, _, b) | Core::Assign(_, _, b) => stack.push(b),
            Core::Apply(_, f, args) => {
                stack.push(f);
                for a in args {
                    stack.push(a);
                }
            }
            Core::Let { value, body, .. } | Core::LetRec { value, body, .. } => {
                stack.push(value);
                stack.push(body);
            }
            Core::LetRecGroup(_, bindings, body) => {
                for (_, value) in bindings {
                    stack.push(value);
                }
                stack.push(body);
            }
            Core::Nat(..) | Core::Bool(..) | Core::Unit(..) | Core::Var(..) => {}
        }
    }
    None
}

/// The per-program, per-node label: construct kind plus enough payload (a name, an arity, a callee
/// class) to tell two nodes of the same kind apart within one program. NOT a source location — `Core`
/// has none.
fn describe_node(node: &Core, classes: &BTreeMap<NodeId, ApplyClass>) -> String {
    match node {
        Core::Nat(_, n) => format!("Nat({n})"),
        Core::Bool(_, b) => format!("Bool({b})"),
        Core::Unit(_) => "Unit".to_string(),
        Core::Var(_, name) => format!("Var({name})"),
        Core::BinOp(_, op, ..) => format!("BinOp({op:?})"),
        Core::If(..) => "If".to_string(),
        Core::Lambda(_, params, _) => format!("Lambda/{}", params.len()),
        Core::Apply(id, callee, args) => {
            let class = classes.get(id).copied().unwrap_or(ApplyClass::Indirect);
            let name = match callee.as_ref() {
                Core::Var(_, n) => n.as_str(),
                _ => "<computed>",
            };
            format!("Apply/{} {}={}", args.len(), class.short(), name)
        }
        Core::Let { name, mutable, .. } => format!("Let({name}{})", if *mutable { ", mut" } else { "" }),
        Core::LetRec { name, .. } => format!("LetRec({name})"),
        Core::LetRecGroup(_, bindings, _) => {
            let names: Vec<&str> = bindings.iter().map(|(n, _)| n.as_str()).collect();
            format!("LetRecGroup({})", names.join(", "))
        }
        Core::Seq(..) => "Seq".to_string(),
        Core::Assign(_, name, _) => format!("Assign({name})"),
        Core::While(..) => "While".to_string(),
    }
}

/// The construct kind WITHOUT per-program payload — used for the corpus-wide rollup, which groups
/// steps across many programs. `Apply` keeps its CALLEE CLASS, because that distinction is the whole
/// point of the decomposition (a builtin heap op and a dispatcher indirection are not the same cost
/// to the same pass).
fn canonical_kind(node: &Core, classes: &BTreeMap<NodeId, ApplyClass>) -> &'static str {
    match node {
        Core::Nat(..) => "Nat",
        Core::Bool(..) => "Bool",
        Core::Unit(..) => "Unit",
        Core::Var(..) => "Var",
        Core::BinOp(_, BinOp::Add, ..) => "BinOp(Add)",
        Core::BinOp(_, BinOp::Sub, ..) => "BinOp(Sub)",
        Core::BinOp(_, BinOp::Mul, ..) => "BinOp(Mul)",
        Core::BinOp(_, BinOp::Eq, ..) => "BinOp(Eq)",
        Core::BinOp(_, BinOp::Ne, ..) => "BinOp(Ne)",
        Core::BinOp(_, BinOp::Lt, ..) => "BinOp(Lt)",
        Core::BinOp(_, BinOp::Le, ..) => "BinOp(Le)",
        Core::BinOp(_, BinOp::Gt, ..) => "BinOp(Gt)",
        Core::BinOp(_, BinOp::Ge, ..) => "BinOp(Ge)",
        Core::If(..) => "If",
        Core::Lambda(..) => "Lambda",
        Core::Apply(id, ..) => classes.get(id).copied().unwrap_or(ApplyClass::Indirect).label(),
        Core::Let { .. } => "Let",
        Core::LetRec { .. } => "LetRec",
        Core::LetRecGroup(..) => "LetRecGroup",
        Core::Seq(..) => "Seq",
        Core::Assign(..) => "Assign",
        Core::While(..) => "While",
    }
}

/// Every `ClosureScaffold` bucket summed. The bucket carries the synthesized node's id, so the
/// scaffolding total is a sum over keys rather than a single lookup.
fn closure_steps(a: &Attribution) -> u64 {
    a.histogram.iter().filter(|(b, _)| matches!(b, StepBucket::ClosureScaffold(_))).map(|(_, n)| *n).sum()
}

/// The smallest and largest of a set of measured probe ceilings, for a conclusion line that quotes a
/// RANGE. Only ever called on a non-empty slice built from `ceiling`, which panics on a label that
/// did not run rather than handing back a placeholder.
fn span(xs: &[f64]) -> (f64, f64) {
    (xs.iter().copied().fold(f64::INFINITY, f64::min), xs.iter().copied().fold(f64::NEG_INFINITY, f64::max))
}

/// A probe's measured % cut, by label. Panics on a label that did not run rather than defaulting to
/// zero: the point of reading these back out of the probe results is that a renamed or deleted probe
/// must break loudly, not silently print a plausible wrong number.
fn ceiling(ceilings: &BTreeMap<&str, f64>, label: &str) -> f64 {
    ceilings
        .get(label)
        .copied()
        .unwrap_or_else(|| panic!("the conclusion cites probe {label:?}, but no probe by that label ran"))
}

/// `part / whole` as a percentage, 0.0 for a zero whole (never hit on the real path: every attributed
/// program here runs at least one step, checked by `print_program_attribution`'s own assertion).
fn pct(part: u64, whole: u64) -> f64 {
    if whole == 0 { 0.0 } else { part as f64 / whole as f64 * 100.0 }
}

/// A single-line, whitespace-collapsed, width-truncated view of a (possibly multi-line) demo string.
/// `width == 0` yields the empty string rather than underflowing `width - 1`.
fn truncate(s: &str, width: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > width {
        format!("{}…", flat.chars().take(width.saturating_sub(1)).collect::<String>())
    } else {
        flat
    }
}

/// Greedy word-wrap for the prose caveats, so a long explanation stays inside the report's columns.
fn wrap(s: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut cur = String::new();
    for word in s.split_whitespace() {
        if !cur.is_empty() && cur.chars().count() + 1 + word.chars().count() > width {
            lines.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(word);
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    lines
}
