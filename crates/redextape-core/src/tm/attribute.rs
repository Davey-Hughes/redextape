//! Attribute TM steps back to the Core constructs that caused them.
//!
//! Composition: per-state step counts (`sim::simulate_counts`) → the asm instruction that built each
//! state (`lower_tm_mapped`) → the `Core` node whose lowering emitted that instruction
//! (`lower_asm_mapped`) → and, for higher-order programs, whether that node is something the user
//! wrote or scaffolding `defunc` synthesized (`defunc_mapped`).
//!
//! The structural property is exhaustiveness: every step lands in exactly one bucket, so the
//! histogram's values sum to the simulator's total. That catches steps dropped or double-counted on
//! the way through the composition — but only those. It is deliberately blind to a step charged to
//! the WRONG bucket, because a misdirected step is still counted once: an index shifted by a
//! constant anywhere in the composition preserves the sum exactly. What pins the mapping itself is
//! the pair of whole-histogram goldens, `attribution_golden_2_times_3` (arithmetic, no call) and
//! `attribution_golden_add1_of_5` (a call, so a prologue, a `Ret` and the ABI), which assert a whole
//! histogram node by node — plus `a_boxed_read_and_write_bill_the_source_nodes_they_replace`, which
//! pins the one place `defunc` deliberately reuses a source node's id.

use std::collections::{BTreeMap, BTreeSet};

use crate::core::{Core, NodeId};
use crate::tm::build::{REG, TAPES};
use crate::tm::defunc::defunc_mapped;
use crate::tm::encoding::{Encoding, Unary};
use crate::tm::lower_asm::{LowerError, lower_asm_mapped};
use crate::tm::lower_tm::{MAX_SLOTS, SlotMap, frame_bank_unrepresentable, lower_tm_mapped, mul_count_unrepresentable};
use crate::tm::machine::{Machine, Symbol};
use crate::tm::sim::{self, Status};

/// Where a TM step's cost is charged.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum StepBucket {
    /// A `Core` construct the user wrote.
    Node(NodeId),
    /// A node `defunc` synthesized — closure dispatch (`$applyN`), tag comparison, closure
    /// construction, mutable-capture boxing. Real cost, but not attributable to anything in the
    /// source.
    ///
    /// It carries the synthesized node's id for the same reason `Node` does: those nodes are NOT one
    /// population. Dispatch scaffolding and boxing scaffolding are removed by DIFFERENT passes
    /// (known-callee specialization vs. a different mutable-capture strategy), so a consumer
    /// bucketing "by what a pass could do about it" has to tell them apart — and telling them apart
    /// means reading the node out of the defunctionalized `Core`, which is the consumer's job, not
    /// this module's. Here it is only "which synthesized node", never "what kind".
    ClosureScaffold(NodeId),
    /// A TM state belonging to no single instruction. In practice this bucket is the CALL/RETURN ABI,
    /// and reading it as generic irreducible overhead would be a mistake: it holds the shared halt
    /// state, the return-tag dispatch chain that routes a `Ret` back to its call site, and `Ret`'s
    /// frame-restore gadget.
    ///
    /// So it is exactly ZERO for a program that makes no calls (measured: all three call-free cases
    /// in this module's tests), and it is the largest single bucket in a recursive one — ~25% of
    /// `sum(3)`, about 7.2k steps per return. And it SCALES: `push_frame`/`pop_frame_restore` unroll
    /// O(n_loc^2) states over the `Loc` bank, because each field-copy re-seeks from home. A program
    /// with more locals in scope across a call pays quadratically more here for the same call. That
    /// makes this bucket a lever, not a floor.
    MachineScaffold,
}

/// A program's step attribution.
#[derive(Clone, Debug)]
pub struct Attribution {
    pub histogram: BTreeMap<StepBucket, u64>,
    /// Total steps the simulator reported. `histogram.values().sum() == total` always.
    pub total: u64,
    /// True if the histogram does NOT describe a complete execution — either the simulation hit a
    /// step/cell cap mid-run, or the program was unrepresentable and never ran at all (see
    /// `Attribution::unrepresentable`). The two are told apart by `total`: a capped run has counted
    /// steps, an unrepresentable one has `total == 0`.
    pub capped: bool,
}

impl Attribution {
    /// What to report for a program `lower_tm_mapped` refuses to lay out — `MAX_SLOTS` (an absurd
    /// register file), `MAX_FRAME_LOC` (an absurd `Loc` bank in a call-containing program), or
    /// `MAX_MUL_INSTRS` (too many `Mul` instructions, each O(width²) states under `Binary`). Every one
    /// hands back a degenerate machine that halts before doing anything, so nothing ran and nothing is
    /// attributed — and `capped` says the histogram does not describe a complete execution.
    ///
    /// The alternative is what this used to do for the `MAX_FRAME_LOC` half: simulate the degenerate
    /// machine and report `{ histogram: {}, total: 0, capped: false }`, which a consumer reads as a
    /// program that RAN and cost NOTHING. That is the one wrong answer available here.
    ///
    /// `run_tm` reports the SAME class of program as `TmRun::TooLarge` — a program refused before it
    /// took a step, never `Ran` over tapes that decode to nothing. Attribution mirrors `run_tm`'s
    /// LOWERING exactly (same machine, same encoding, same caps) — and `capped` is documented as "does
    /// not describe a complete execution", which a zero-step degenerate halt indeed does not.
    fn unrepresentable() -> Attribution {
        Attribution { histogram: BTreeMap::new(), total: 0, capped: true }
    }
}

/// Compose the maps into a histogram. `origins` is parallel to the program's code; `state_origins`
/// is parallel to the machine's states; `synthetic` is `defunc`'s minted-id set.
///
/// Membership in `synthetic` — never its size — decides the `ClosureScaffold` bucket: the set is a
/// slight superset of the ids that actually label nodes (`defunc_mapped`'s `$lam{k}` counter draws
/// from the same generator), so a handful of its ids label nothing and simply never come up here.
///
/// Total by construction: every state's count lands in exactly one bucket, and an index that falls
/// outside either map is charged to `MachineScaffold` rather than dropped (or panicked on).
/// Accumulation saturates so that a synthetic `counts` (this is a public entry point) cannot overflow
/// a bucket into a debug-build panic; a simulator's own counts sum to at most `caps.steps`, so it
/// never comes up on the real path.
pub fn attribute_steps(
    counts: &[u64],
    state_origins: &[Option<usize>],
    origins: &[NodeId],
    synthetic: &BTreeSet<NodeId>,
) -> BTreeMap<StepBucket, u64> {
    let mut hist: BTreeMap<StepBucket, u64> = BTreeMap::new();
    for (state, &n) in counts.iter().enumerate() {
        if n == 0 {
            continue;
        }
        let bucket = match state_origins.get(state).copied().flatten() {
            None => StepBucket::MachineScaffold,
            Some(idx) => match origins.get(idx) {
                None => StepBucket::MachineScaffold,
                Some(id) if synthetic.contains(id) => StepBucket::ClosureScaffold(*id),
                Some(id) => StepBucket::Node(*id),
            },
        };
        let slot = hist.entry(bucket).or_insert(0);
        *slot = slot.saturating_add(n);
    }
    hist
}

/// Everything `run_tm` builds on the way to a simulation, with the two maps `run_tm` discards kept.
struct Mapped {
    machine: Machine,
    /// Parallel to `machine.states`: the `code` index that built each state (`None` = scaffolding).
    state_origins: Vec<Option<usize>>,
    /// Parallel to the asm program's `code`: the `Core` node whose lowering emitted each instruction.
    origins: Vec<NodeId>,
    /// The ids `defunc` minted, empty when the program lowered first-order (so `defunc` never ran).
    synthetic: BTreeSet<NodeId>,
    /// The initial tapes: `run_tm` seeds the REG bank, and the machine computes nothing without it.
    init: Vec<Vec<Symbol>>,
}

/// The mapped analogue of `run_tm`'s lowering (`tm.rs`), step for step: `lower_program`'s
/// direct-then-`defunc` sequence with its exact error discrimination, `lower_tm`, the layout
/// refusals, and the seeded REG tape. Mirroring it is the point — an attribution of a differently
/// lowered machine would describe a program nobody executes.
///
/// `Ok(None)` is a program `lower_tm_mapped` refuses to lay out (`MAX_SLOTS`, `MAX_FRAME_LOC`, or
/// `MAX_MUL_INSTRS`): the machine halts before doing anything, so there is no run to attribute.
fn lower_mapped(core: &Core, enc: &dyn Encoding) -> Result<Option<Mapped>, LowerError> {
    // `lower_program`: try the program as first-order Core FIRST (a shape `defunc`'s top-level peel
    // does not recognize would otherwise be wrongly rejected), and retry through `defunc` only on
    // `Unsupported`. `TooDeep` is returned immediately, exactly as `lower_program` does — a looser
    // `or_else` would swallow it and replay a deep Core through `defunc`'s own recursive passes. The
    // match is exhaustive rather than wildcarded so a future `LowerError` variant must decide here too.
    let (prog, origins, synthetic) = match lower_asm_mapped(core) {
        Ok((p, o)) => (p, o, BTreeSet::new()),
        Err(LowerError::Unsupported { .. }) => {
            let (defunced, synthetic) = defunc_mapped(core)?;
            let (p, o) = lower_asm_mapped(&defunced)?;
            (p, o, synthetic)
        }
        Err(e @ LowerError::TooDeep { .. }) => return Err(e),
    };
    let (machine, state_origins) = lower_tm_mapped(&prog, enc);
    let sm = SlotMap::of(&prog);
    // ALL THREE of `lower_tm_mapped`'s layout refusals, exactly the set `run_tm` now mirrors too (see
    // `tm.rs`'s `run_tm_fitted`/`run_tm_at`). Each hands back a degenerate halt-immediately machine with
    // an all-`None` state map, so simulating any of them would report a meaningless zero-step run — and
    // a zero-step run passes the exhaustiveness invariant (0 == 0) while telling a consumer the program
    // cost nothing.
    //
    // `MAX_SLOTS` is spelled out here because `run_tm` spells it out too (an absurd register index
    // would also drive `init_reg` into a huge allocation just below). The `MAX_FRAME_LOC` and
    // `MAX_MUL_INSTRS` halves go through `lower_tm`'s own predicates rather than being re-derived, so
    // this cannot drift from the guards it mirrors.
    if sm.n_slots() > MAX_SLOTS || frame_bank_unrepresentable(&prog, &sm) || mul_count_unrepresentable(&prog) {
        return Ok(None);
    }
    let mut init = vec![Vec::new(); TAPES];
    // `REG < TAPES` by construction; `get_mut` rather than indexing keeps this library path total.
    if let Some(reg) = init.get_mut(REG) {
        *reg = enc.init_reg(sm.n_slots());
    }
    Ok(Some(Mapped { machine, state_origins, origins, synthetic, init }))
}

/// Simulate a lowered program and compose its maps into the histogram.
fn attribute_mapped(m: &Mapped) -> Attribution {
    let (counts, status) = sim::simulate_counts(&m.machine, &m.init, sim::DEFAULT_CAPS);
    let histogram = attribute_steps(&counts, &m.state_origins, &m.origins, &m.synthetic);
    // `total` comes from the SAME `counts` the histogram was built from. Deriving it independently
    // (re-running the simulator, summing something else) would make the exhaustiveness invariant
    // compare two separate measurements — masking exactly the composition bug it exists to catch.
    // Saturating for the same reason `attribute_steps` accumulates that way; the simulator's counts
    // sum to at most `caps.steps`, so the saturation is unreachable here.
    let total = counts.iter().copied().fold(0u64, u64::saturating_add);
    Attribution { histogram, total, capped: matches!(status, Status::HitCap) }
}

/// Parse and desugar `src` the way every `run_tm` call site does. A program that does not parse has
/// no Core to attribute; report that as `Unsupported` rather than panicking (`node: 0` — there is no
/// node to blame, since there is no tree).
///
/// This is `parse` + `desugar`, NOT `analyze`: diagnostics are dropped, so a program the parser
/// recovered from, or one that would fail the typechecker, is still attributed as long as it produced
/// a tree. That is deliberate — it is what the TM backend's own entry points do, and attribution
/// describes what the machine executes, not whether the program is well-typed. A caller that wants
/// static errors reported should run `analyze` itself first.
fn parse_core(src: &str) -> Result<Core, LowerError> {
    match crate::parser::parse(src).0 {
        Some(program) => Ok(crate::desugar::desugar(&program)),
        None => Err(LowerError::Unsupported { node: 0, what: "source does not parse".to_string() }),
    }
}

/// Attribute a source program's TM steps to the Core constructs that caused them.
///
/// Mirrors `run_tm`'s lowering sequence exactly — including its `defunc` retry — so the attribution
/// describes the same machine `run_tm` would actually run, not a differently-lowered one. Likewise
/// the encoding and caps: every `run_tm` call site in the workspace passes `&Unary::default()` (the only
/// `Encoding` impl) and `DEFAULT_CAPS`.
pub fn attribute(src: &str) -> Result<Attribution, LowerError> {
    attribute_at(src, &Unary::default())
}

/// `attribute` at an explicit encoding rather than the default 64-cell one.
///
/// Exists because every share `attribute` reports is measured at ONE field width, and step cost is
/// affine in that width (`steps = a + b·W`) with the `b·W` term at 91–97% of the total at width 64. A
/// bucket's SHARE is therefore only width-independent if every bucket happens to have the same `b/a`
/// ratio, which nothing guarantees. Re-attributing at the width `run_tm` actually fits is how that gets
/// checked rather than assumed — see `examples/width_ranking.rs`.
///
/// A program whose values do not fit `enc` halts in the overflow guard, which is a real halt, so the
/// histogram it produces describes a run that computed nothing. Callers must pass a width the program
/// fits (`run_tm_fitted` reports one).
pub fn attribute_at(src: &str, enc: &dyn Encoding) -> Result<Attribution, LowerError> {
    let core = parse_core(src)?;
    Ok(match lower_mapped(&core, enc)? {
        Some(m) => attribute_mapped(&m),
        None => Attribution::unrepresentable(),
    })
}

/// Test-only sabotage hook: `attribute`'s pipeline with the instruction origin map rotated by one
/// before composing. A rotation keeps the map's LENGTH right, so what it perturbs is the mapping
/// itself, not its shape.
#[cfg(test)]
fn attribute_with_shifted_origins(src: &str) -> Result<Attribution, LowerError> {
    let core = parse_core(src)?;
    Ok(match lower_mapped(&core, &Unary::default())? {
        Some(mut m) => {
            m.origins.rotate_left(1);
            attribute_mapped(&m)
        }
        None => Attribution::unrepresentable(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;

    /// Programs small enough to simulate on the TM. TM arithmetic is UNARY — `sum(5)` alone costs
    /// ~178k steps of a 5,000,000 cap — so nothing here may grow much.
    ///
    /// The last one is HIGHER-ORDER, and it is the only case that exercises three things the others
    /// cannot: `lower_mapped`'s `defunc` retry, a non-empty `synthetic` set, and therefore the
    /// `ClosureScaffold` bucket — which is precisely the split (what the user wrote vs what
    /// defunctionalization added) the step survey consumes. It is the two-element `map` demo the TM
    /// goldens already pin, kept to two elements so it stays cheap.
    const CASES: [&str; 5] = [
        "2 * 3",
        "1 + 2 * 3",
        "if 2 > 1 { 10 } else { 20 }",
        "fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)",
        "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
         fn add1(x) { x + 1 } [1, 2].map(add1)",
    ];

    /// Every `ClosureScaffold` bucket summed. The bucket carries the synthesized node's id (so a
    /// consumer can tell dispatch scaffolding from boxing scaffolding), which means the scaffolding
    /// total is a sum over keys rather than a single lookup.
    fn closure_total(a: &Attribution) -> u64 {
        a.histogram.iter().filter(|(b, _)| matches!(b, StepBucket::ClosureScaffold(_))).map(|(_, n)| *n).sum()
    }

    /// Every node in `core`, by an iterative walk — same discipline as the library's own traversals
    /// (`Core` spines run deep enough that recursion is a hazard, hence its hand-written `Drop`).
    fn all_nodes(core: &Core) -> Vec<&Core> {
        let mut out = Vec::new();
        let mut stack = vec![core];
        while let Some(node) = stack.pop() {
            out.push(node);
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
        out
    }

    /// The single node matching `p`, asserting there is exactly one — so a test that identifies a
    /// node by a property fails loudly if the program ever grows a second one, rather than pinning
    /// whichever the traversal happened to reach first.
    fn only<'a>(nodes: &[&'a Core], what: &str, p: impl Fn(&Core) -> bool) -> &'a Core {
        let found: Vec<&Core> = nodes.iter().copied().filter(|n| p(n)).collect();
        assert_eq!(found.len(), 1, "expected exactly one {what}, found {}", found.len());
        found[0]
    }

    #[test]
    fn attribution_accounts_for_every_step() {
        for src in CASES {
            let a = attribute(src).expect("attributes");
            let attributed: u64 = a.histogram.values().sum();
            assert_eq!(attributed, a.total, "{src}: attributed {attributed} of {} steps", a.total);
            assert!(a.total > 0, "{src}: ran zero steps — the case proves nothing");
        }
    }

    /// A GOLDEN: the WHOLE attribution of `2 * 3`, bucket by bucket — the only test here that pins
    /// *which* node each step is charged to.
    ///
    /// Exhaustiveness cannot do this and is not meant to. A step charged to the wrong bucket is still
    /// charged exactly once, so any constant shift inside the composition (`origins.get(idx + 1)`, a
    /// rotated `state_origins`) preserves the sum perfectly. Nor does the rotation test catch it: a
    /// shift introduced inside the composition COMPOSES with the rotation instead of cancelling it, so
    /// the histogram still differs and `assert_ne!` still holds. Both mutants were applied and both
    /// left all the other tests green; this assertion is what fails.
    ///
    /// `2 * 3` desugars to a `BinOp` over two `Nat`s, so the three buckets are the two literals and
    /// the multiply — and the multiply's bucket also carries the trailing `Halt`, which
    /// `lower_asm_mapped` bills to the top-level node. Note the literal `3` costs more than the
    /// literal `2`: the tape is unary.
    ///
    /// The three ids are READ OFF the parsed Core rather than written out as `Node(0..2)`, so the
    /// golden pins the shape of the attribution and not `NodeGen`'s numbering. A desugar or parser
    /// change that renumbers nodes — numbering a parent before its children, say — would otherwise
    /// produce the exact signature of a mapping bug (the same total against different ids) with
    /// nothing whatsoever wrong, and send a maintainer hunting one. Costs no rigour: this form still
    /// fails both shift mutants, because a shift moves cost to a DIFFERENT node's id, whichever
    /// numbering is in force.
    ///
    /// The step COUNTS are CAPTURED, same discipline as `lower_tm.rs::tm_step_count_goldens` (run,
    /// paste the real numbers, re-run to confirm they are stable — the TM is deterministic). A
    /// lowering or gadget change legitimately moves them, and `tm_step_count_goldens` moves with
    /// them; what is NOT legitimate is the same total landing on the wrong construct — cost sliding
    /// between these three buckets, or a `MachineScaffold` entry appearing in a program that makes no
    /// calls. That is the source map misattributing, and no lowering change explains it.
    #[test]
    fn attribution_golden_2_times_3() {
        let a = attribute("2 * 3").expect("attributes");
        let core = desugar(&parse("2 * 3").0.expect("parses"));
        let Core::BinOp(mul, _, lhs, rhs) = &core else { panic!("`2 * 3` must desugar to a BinOp: {core:?}") };
        assert_eq!(
            a.histogram,
            BTreeMap::from([
                (StepBucket::Node(lhs.id()), 269), // the literal `2`
                (StepBucket::Node(rhs.id()), 401), // the literal `3`
                (StepBucket::Node(*mul), 1066),    // the multiply, plus the trailing `Halt`
            ])
        );
        assert_eq!(a.total, 1736);
        assert!(!a.capped);
    }

    /// The SECOND whole-histogram golden, and the one that pins attribution for a program that CALLS
    /// something. `attribution_golden_2_times_3` cannot: `2 * 3` has three nodes, no call, no `Ret`,
    /// no `defunc` — so nothing above constrained which construct a step lands on in any program with
    /// a function in it, which is every interesting program in the corpus the survey reports on.
    ///
    /// Two mutants motivate it, both of which left the ENTIRE rest of the suite green and both of
    /// which move the survey's headline pass ranking:
    ///
    ///   1. `lower_asm::lower_function` re-billing the prologue (`Mov` per param) and the `Ret` from
    ///      the enclosing `LetRec` to the body node — e.g. by lowering the `Lambda` through
    ///      `lower_into`. That is exactly the attribution `defunc.rs` cites as its own reason to
    ///      exist ("`lower_asm` bills a function's prologue and its `Ret` to the `LetRec` node, and
    ///      those run on EVERY call"). Here it empties the `LetRec` bucket; corpus-wide it moved
    ///      `LetRec` from 128,040 steps to 16.
    ///   2. Anything that drops the `at` source-id carry in `defunc`'s `box_get1`/`box_set2` — see
    ///      `a_boxed_read_and_write_bill_the_source_nodes_they_replace`, which pins that half.
    ///
    /// Ids are READ OFF the parsed Core, not written as `Node(n)`, for the reason
    /// `attribution_golden_2_times_3` documents at length: a desugar change that renumbers nodes
    /// would otherwise produce the exact signature of a mapping bug with nothing wrong. Costs no
    /// rigour — both mutants move cost to a DIFFERENT node's id under any numbering.
    ///
    /// Counts CAPTURED, same re-bless discipline as the golden above. What is NOT legitimate is the
    /// same total landing on different constructs.
    #[test]
    fn attribution_golden_add1_of_5() {
        const SRC: &str = "fn add1(x) { x + 1 } add1(5)";
        let a = attribute(SRC).expect("attributes");
        let core = desugar(&parse(SRC).0.expect("parses"));
        let Core::LetRec { id: letrec, value, body, .. } = &core else {
            panic!("`fn add1(x){{ x + 1 }} add1(5)` must desugar to a LetRec: {core:?}")
        };
        let Core::Lambda(_, _, lam_body) = value.as_ref() else {
            panic!("a LetRec's value is always a Lambda: {value:?}")
        };
        let Core::BinOp(add, _, x, one) = lam_body.as_ref() else { panic!("the body must be `x + 1`: {lam_body:?}") };
        let Core::Apply(call, _, args) = body.as_ref() else { panic!("the LetRec's body must be the call: {body:?}") };
        let [five] = args.as_slice() else { panic!("add1 is called with one argument: {args:?}") };

        assert_eq!(
            a.histogram,
            BTreeMap::from([
                // The `LetRec` — this is the whole point of the golden. It is billed the function's
                // PROLOGUE (`Mov` per param) and its `Ret`, which run on every call and belong to no
                // expression inside the body. Zero here means someone re-billed them elsewhere.
                (StepBucket::Node(*letrec), 831),
                (StepBucket::Node(*call), 1692), // the call itself: arg setup + `Call`, plus the trailing `Halt`
                (StepBucket::Node(five.id()), 275), // the literal `5`
                (StepBucket::Node(x.id()), 578), // reading the parameter `x`
                (StepBucket::Node(one.id()), 527), // the literal `1`
                (StepBucket::Node(*add), 861),   // the addition
                // The call/return ABI: the shared halt, the return-tag dispatch chain, `Ret`'s
                // frame-restore. Nonzero precisely BECAUSE this program makes a call.
                (StepBucket::MachineScaffold, 1258),
            ])
        );
        assert_eq!(a.total, 6022);
        assert!(!a.capped);
    }

    /// The other half of the same guard: a read of, and a write to, a mutable captured by a closure
    /// must bill the SOURCE node each replaces.
    ///
    /// `defunc` boxes such a mutable — the read becomes `$box_get($boxh0)` and the write
    /// `$box_set($boxh0, v)` — and it builds those two `Apply`s with the id of the `Var`/`Assign`
    /// they replace rather than a fresh one, so a read through a box still bills the read the user
    /// wrote. Dropping that carry (minting fresh ids, which is what the surrounding builders do)
    /// compiles, computes the same value, and leaves every other test green: the steps merely move
    /// into `ClosureScaffold`. Corpus-wide that silently relabels 49,630 steps — 1.5% of the survey —
    /// from "a mutable the user read/wrote" to "defunctionalization overhead", which are the two
    /// buckets with the most opposite optimizer implications in the whole report.
    ///
    /// Both bucket ids are read off the SOURCE Core (before `defunc`), which is the property under
    /// test: they must be findable there at all.
    ///
    /// The WRITE bucket and the total were re-blessed (+106 steps, 4,954 -> 5,060) when
    /// `box_overwrite_field` became a COUNTED `width`-long chain instead of a content-driven loop. That
    /// is a deliberate algorithmic change, not a guard: a box write now always traverses the full
    /// window, so at the pinned width 64 these numbers grew. The overflow guards themselves add rules
    /// and no steps, which is what the untouched `tm_step_count_goldens` continue to check. At the
    /// fitted widths `run_tm` actually uses for a boxing program (8, not 64) the counted chain costs
    /// about what the content-driven loop did, so the regression is confined to pinned-64 measurement.
    #[test]
    fn a_boxed_read_and_write_bill_the_source_nodes_they_replace() {
        const SRC: &str = "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)";
        let a = attribute(SRC).expect("attributes");
        let core = desugar(&parse(SRC).0.expect("parses"));
        let nodes = all_nodes(&core);
        let read = only(&nodes, "read of `n`", |n| matches!(n, Core::Var(_, name) if name == "n"));
        let write = only(&nodes, "write to `n`", |n| matches!(n, Core::Assign(_, name, _) if name == "n"));

        assert_eq!(
            a.histogram.get(&StepBucket::Node(read.id())).copied(),
            Some(5_594),
            "the boxed READ of `n` must bill the `Var(n)` the user wrote (node #{}); absent means \
             `defunc`'s `box_get1` minted a fresh id and the cost vanished into ClosureScaffold",
            read.id()
        );
        assert_eq!(
            a.histogram.get(&StepBucket::Node(write.id())).copied(),
            Some(5_060),
            "the boxed WRITE to `n` must bill the `Assign(n)` the user wrote (node #{}); absent means \
             `defunc`'s `box_set2` minted a fresh id and the cost vanished into ClosureScaffold",
            write.id()
        );
        assert_eq!(a.total, 136_695);
        assert!(!a.capped);
    }

    /// `lower_tm_mapped` has THREE layout refusals, and all three hand back a degenerate machine that
    /// halts before doing anything. Mirroring only the `MAX_SLOTS` one made this program — which really
    /// does exceed `MAX_FRAME_LOC`, 3,315 states of which 0 were mapped — attribute as
    /// `{ histogram: {}, total: 0, capped: false }`: a program that never ran, reported as one that
    /// ran and cost nothing.
    #[test]
    fn a_program_too_wide_for_the_frame_bank_reports_that_nothing_ran() {
        // > MAX_FRAME_LOC (1,000) locals in a function that contains a call.
        const N: usize = 1_100;
        let params: String = (0..N).map(|i| format!("p{i}, ")).collect();
        let src = format!("fn g(y) {{ y }} fn f({params}n) {{ g(n) }} f({}3)", "1, ".repeat(N));

        let a = attribute(&src).expect("attributes");
        assert_eq!(a.total, 0, "the degenerate halt machine cannot take a step");
        assert!(a.histogram.is_empty(), "nothing ran, so nothing is attributable: {:?}", a.histogram);
        assert!(a.capped, "a program that never ran must not be reported as one that ran for free");
    }

    /// The THIRD layout refusal, `MAX_MUL_INSTRS`: a program with too many `Mul` instructions must also
    /// attribute as "never ran", not as a zero-cost run. Same shape as the frame-bank case above, and
    /// the same wrong answer would result if this refusal were left unmirrored here.
    #[test]
    fn a_program_with_too_many_muls_reports_that_nothing_ran() {
        // > MAX_MUL_INSTRS (32) multiplications in one straight-line expression.
        let src = vec!["2"; 34].join(" * "); // 33 `*` operators.

        let a = attribute(&src).expect("attributes");
        assert_eq!(a.total, 0, "the degenerate halt machine cannot take a step");
        assert!(a.histogram.is_empty(), "nothing ran, so nothing is attributable: {:?}", a.histogram);
        assert!(a.capped, "a program that never ran must not be reported as one that ran for free");
    }

    /// The higher-order case, which is the only one that reaches `lower_mapped`'s `defunc` retry and
    /// so the only one that can fill the `ClosureScaffold` bucket — the "what the user wrote vs what
    /// defunctionalization added" split the step survey exists to report. Without this the whole
    /// retry branch and the `synthetic` lookup would be untested.
    ///
    /// CAPTURED like the golden above. The total cross-checks an INDEPENDENT measurement: it is the
    /// number `lower_tm.rs::tm_step_count_golden_higher_order` pins for this same program through
    /// `run_tm`'s own path, so if `attribute` ever stops mirroring that path, these two disagree.
    #[test]
    fn higher_order_attribution_bills_the_closure_scaffold() {
        let a = attribute(CASES[4]).expect("attributes");
        let closure = closure_total(&a);
        let machine = a.histogram.get(&StepBucket::MachineScaffold).copied().unwrap_or(0);
        assert!(closure > 0, "a defunctionalized program billed NOTHING to closure scaffolding");
        assert_eq!((closure, machine), (31_256, 60_022));
        assert_eq!(a.total, 239_971, "must match the step count `tm_step_count_golden_higher_order` pins");
    }

    /// The maps must COVER the machine they describe: `state_origins` parallel to the machine's
    /// states, every origin index a real instruction. `attribute_steps` charges an out-of-range index
    /// to `MachineScaffold` rather than panicking — which keeps it total, but also means
    /// exhaustiveness alone would silently absorb a truncated map into the scaffolding bucket. So
    /// check the coverage directly rather than inferring it from a sum that cannot drop.
    #[test]
    fn the_maps_cover_the_machine_they_describe() {
        for src in CASES {
            let core = parse_core(src).expect("parses");
            let m = lower_mapped(&core, &Unary::default()).expect("lowers").expect("representable");
            assert_eq!(
                m.state_origins.len(),
                m.machine.states.len(),
                "{src}: the state map is not parallel to the machine's states"
            );
            for (state, origin) in m.state_origins.iter().enumerate() {
                if let Some(idx) = origin {
                    assert!(
                        *idx < m.origins.len(),
                        "{src}: state {state} cites instruction {idx}, but the program has {} of them",
                        m.origins.len()
                    );
                }
            }
        }
    }

    /// The attributed run must be the run `run_tm` performs — not merely *a* halting run.
    ///
    /// Exhaustiveness cannot see this, which is why it is pinned separately. Simulate the very same
    /// machine WITHOUT `run_tm`'s seeded REG bank — the one part of the pipeline no `*_mapped`
    /// function hands back, and so the easiest to drop — and three of these four cases halt in ZERO
    /// steps: `0 == 0` satisfies the invariant while every number in the histogram describes a
    /// machine that computed nothing. So pin the observable instead: the machine these counts came
    /// from decodes to the program's value.
    #[test]
    fn the_attributed_machine_computes_the_program() {
        for src in CASES {
            let core = parse_core(src).expect("parses");
            let m = lower_mapped(&core, &Unary::default()).expect("lowers").expect("representable");
            let expected = crate::run(src).expect("reference runs");
            let (tapes, status) = sim::simulate(&m.machine, &m.init, sim::DEFAULT_CAPS);
            assert_eq!(status, Status::Halted, "{src}: the attributed run did not halt");
            assert_eq!(
                crate::tm::decode::decode_tape(&tapes, &expected, &Unary::default()),
                Some(expected.clone()),
                "{src}: the attributed machine did not compute the program's value"
            );
        }
    }

    #[test]
    fn a_multiply_bills_its_own_binop_node() {
        let a = attribute("2 * 3").expect("attributes");
        let core = desugar(&parse("2 * 3").0.unwrap());
        let steps = a.histogram.get(&StepBucket::Node(core.id())).copied().unwrap_or(0);
        assert!(steps > 0, "the top-level multiply was billed no steps at all");
    }

    #[test]
    fn perturbing_the_map_breaks_the_invariant() {
        // The sabotage test: a guard that cannot fail is not a guard. Shifting the instruction
        // origins by one must make attribution stop accounting for every step, or the invariant is
        // decorative. (A rotation keeps the LENGTH right, so this tests the mapping, not the shape.)
        let a = attribute_with_shifted_origins("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)")
            .expect("attributes");
        let attributed: u64 = a.histogram.values().sum();
        assert_eq!(attributed, a.total, "shifting origins must not lose steps (buckets change, total does not)");
        assert_ne!(
            a.histogram,
            attribute("fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(3)").unwrap().histogram,
            "shifting the origin map produced an identical histogram — attribution is ignoring the map"
        );
    }

    /// A BOTH function's dispatcher arm is a FORWARDER, and its frame is defunctionalization
    /// scaffolding: it exists only because the dispatched path routes arguments through `$a_i` slots,
    /// and known-callee devirtualization is precisely the pass that removes it. So its steps must land
    /// in `ClosureScaffold` — while the function's own body still bills to the user's constructs.
    ///
    /// WHY THIS ASSERTS BY IDENTITY, not by summing each kind of bucket: the summed form (`closure =
    /// sum of every ClosureScaffold bucket`, `user = sum of every Node bucket`, each asserted `> 0`)
    /// was measured UNABLE TO FAIL under the exact mutation this test exists to catch — making 5c's
    /// forwarding arm reuse the source function's own `lambda_id` instead of minting fresh ids from
    /// `SynthGen`. Under that mutation the forwarding call's 13,082 steps relocate WHOLESALE from
    /// `ClosureScaffold(25)` to `Node(16)` — the wrong-bucket bug this whole file exists to catch —
    /// yet `closure` (24,052) and `user` (81,733) both stay positive, so both `assert!(... > 0)`s keep
    /// passing. The mutant was caught only incidentally, by `defunc::no_output_node_id_is_duplicated`
    /// in a different file, and for a different symptom (a duplicate output id, not a relocated cost).
    /// So this test locates the forwarding `Apply` structurally, confirms `defunc` itself declares it
    /// synthetic, and then asserts the histogram bills THAT SPECIFIC id to `ClosureScaffold` — a claim
    /// the relocation actually breaks.
    #[test]
    fn a_both_functions_forwarding_arm_bills_to_closure_scaffold() {
        const SRC: &str = "fn sub(a, b) { a - b } fn ap2(g, a, b) { g(a, b) } sub(9, 4) + ap2(sub, 10, 3)";
        let core = desugar(&parse(SRC).0.expect("parses"));

        // The user's own `a - b`, read off the ORIGINAL core before `defunc` runs. `sub` is KEPT (it
        // is also called by name), so its body is re-emitted with its source ids intact — this
        // specific id, not just "some Node bucket", must survive into the attributed histogram.
        let src_nodes = all_nodes(&core);
        let sub_minus =
            only(&src_nodes, "the `a - b` subtraction", |n| matches!(n, Core::BinOp(_, crate::core::BinOp::Sub, ..)));

        let (rewritten, synthetic) = defunc_mapped(&core).expect("defuncs");

        // Locate the forwarding arm STRUCTURALLY rather than by a hardcoded id (a hardcoded id is a
        // brittle golden that breaks on any unrelated id-numbering change): it is the unique `Apply`
        // whose callee is `Var(_, "sub")` and whose arguments are ALL dispatcher slots (`$a1`, `$a2`,
        // ...). The user's own call site `sub(9, 4)` has `Nat` arguments, so this is unambiguous.
        fn is_dispatch_slot(name: &str) -> bool {
            name.strip_prefix("$a").is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
        }
        let out_nodes = all_nodes(&rewritten);
        let forward = only(&out_nodes, "forwarding call to `sub`", |n| {
            matches!(n, Core::Apply(_, f, args)
                if matches!(f.as_ref(), Core::Var(_, name) if name == "sub")
                    && !args.is_empty()
                    && args.iter().all(|a| matches!(a, Core::Var(_, name) if is_dispatch_slot(name))))
        });

        // THE HEADLINE ASSERTION: the forwarder's own id must bill `ClosureScaffold`, specifically —
        // not merely "some ClosureScaffold bucket is nonzero" (the summed form above's replacement).
        // This is checked BEFORE the synthetic-membership sanity check below on purpose: under the
        // mutation this test exists to catch, the relocated cost fails this assertion (`None` where a
        // positive count belongs) — the synthetic check would ALSO fail for the same underlying
        // reason, and ordering this one first keeps the failure pinned to the claim actually under
        // test, not a downstream symptom of it.
        let a = attribute(SRC).expect("attributes");
        assert!(!a.capped, "the fixture must run to completion");
        assert_eq!(a.histogram.values().sum::<u64>(), a.total, "every step lands in exactly one bucket");

        let forward_steps = a.histogram.get(&StepBucket::ClosureScaffold(forward.id())).copied();
        assert!(
            matches!(forward_steps, Some(n) if n > 0),
            "the forwarding arm (id {}) must bill `ClosureScaffold` under its OWN id; got {:?} instead \
             — this is exactly what a relocated (wrong-bucket) cost looks like",
            forward.id(),
            forward_steps
        );

        // This is what makes it scaffolding rather than a user node: confirm `defunc` itself declared
        // the forwarder's id synthetic (not merely that some bucket lookup happened to succeed).
        assert!(
            synthetic.contains(&forward.id()),
            "the forwarding Apply (id {}) must be declared synthetic by `defunc` — it is scaffolding, \
             not a node the user wrote",
            forward.id()
        );

        let sub_steps = a.histogram.get(&StepBucket::Node(sub_minus.id())).copied().unwrap_or(0);
        assert!(
            sub_steps > 0,
            "the `a - b` subtraction (id {}) must still bill a `Node` bucket: the forwarder does not \
             swallow the body it forwards to",
            sub_minus.id()
        );
    }
}
