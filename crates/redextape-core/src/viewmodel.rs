//! The data contract a renderer consumes (§9.1). Types plus budget-parameterized builders — and the
//! budgets are PARAMETERS, never constants in this file.
//!
//! CORE NEVER PICKS A NUMBER. A window radius and a truncation threshold are renderer policy: how much
//! tape fits on screen and how much text a pane will hold are facts about the pane, not about the
//! machine. A library that hardcodes them stops being reusable by the second consumer, and there are
//! already two more coming — Plan 6's CLI and the terminal-visualization track.
//!
//! THE MACHINE CROSSES ONCE, NOT PER STEP. §9.1 puts the machine inside `TmState`; the `map` demo is
//! 3,203 states and 344,999 steps, so that would re-send 3,203 states 344,999 times. `TmProgram` is
//! built once per compile and `TmState` carries a bounded window instead — the same reasoning that made
//! `trace.rs` refuse to materialize tapes per step (3,488 bytes/step, 592.9 MB for `sum(5)`).

use std::borrow::Borrow;
use std::collections::BTreeMap;

use crate::analysis::TokenClass;
use crate::core::NodeId;
use crate::lambda::reduce::Owner;
use crate::lambda::term::Node;
use crate::lambda::{Cut, LambdaTerm, Path, print_lambda_linked};
use crate::sourcemap::SourceMap;
use crate::span::Span;
use crate::tm::machine::{Machine, Move, StateId, Symbol};
use crate::trace::{LambdaCursor, TmCursor};

/// NO `redex` FIELD, DELIBERATELY. §4.2 lists one, and nothing in this PR can fill it: a redex is a
/// `Path` INTO THE TERM, while highlighting it in `text` needs a byte SPAN, and correlating the two
/// means the printer recording where a given path lands as it walks — real work in
/// `print_lambda_capped`, touching every recursive arm of `write_term`, and not part of this task.
///
/// Shipping the field as a structural `None` would be the exact defect `node_to_source` was built to
/// remove: a consumer could not distinguish "no redex here" from "not implemented". The field is
/// omitted until something can populate it, which is the same call already made for
/// `TmState.source_node` below. Adding it later is not a breaking change, because nothing consumes
/// these types yet.
///
/// NO `source_node` FIELD EITHER, ANYMORE — REMOVED, NOT LEFT `None`, FOR THE SAME REASON ABOVE ONE
/// LAYER WORSE. This field shipped briefly, resolved by `owning_node` from a caller-supplied redex
/// `Path`. It was right for exactly the first β-event and confidently wrong for every one after:
/// `SourceMap::node_to_lambda` records paths root-relative into the INITIAL lowered term, while
/// normal-order reduction contracts root redexes, so a `Beta` event's redex path at step N > 1 indexes
/// a structurally different tree — the coordinate system `node_to_lambda` speaks in has stopped
/// existing. `owning_node` could not detect this: the root is recorded at the empty path, the empty
/// path is a prefix of every path, so it always found a match. Measured on `let x = 40; x + 2`, all
/// seven steps reported the same node, "let x = 40;"; `x + 2` was never named.
///
/// A structurally-`None` `redex` at least tells a consumer "not implemented". A `source_node` that is
/// sometimes silently wrong tells a consumer nothing is wrong at all — the exact fallback
/// `sourcemap.rs`'s module doc forbids ("THE MAP SAYS NOTHING WHERE THE LOWERING SAID NOTHING"),
/// reintroduced one layer out. `render` no longer takes `map` or `redex`; they existed only to compute
/// this field.
///
/// `TmState.source_node` SURVIVED AND IS NOW RESOLVED, which is not an inconsistency: it is keyed by the
/// current state's NAME, and a name is not a coordinate into a tree that reduction rewrites underneath
/// it. That is the whole difference — the λ field was wrong because its coordinate system went stale
/// after one step, and a state name never does.
///
/// **AND THE λ SIDE NOW HAS ONE AGAIN, BY A DIFFERENT MECHANISM.** `owner` is not a coordinate into a
/// tree that reduction rewrites — it is a tag inherited by every rebuild, so it does not go stale after
/// one step the way `node_to_lambda`'s paths did. `redex` IS a path, and is honest precisely because it
/// is scoped to the frame that carries it.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct LambdaState {
    pub text: String,
    pub spans: Vec<(Span, TokenClass)>,
    pub cut: Option<Cut>,
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub step: u64,
    /// The redex contracted by the step that produced this frame; `None` at step 0.
    ///
    /// A `Path` INTO THE TERM THIS FRAME HOLDS, which is exactly `print_lambda_linked`'s contract —
    /// and exactly what `node_to_lambda` was not. The distinction is the whole slice: this path is
    /// resolved against the term it was taken from, never against a later one.
    ///
    /// **NAMED FOR THE REDEX; WHAT STANDS AT IT IS THE CONTRACTUM.** `LambdaCursor::next` records this
    /// path against the PRE-step term, where it did name the redex `App` — but `beta` then consumed
    /// that `App` and its `Abs`, so the subterm sitting at this path in THIS frame's (post-step) term
    /// is the CONTRACTUM that step produced, not the redex it consumed. Both statements are true at
    /// once and the field stays honest either way, because the path never leaves the frame it is
    /// resolved against; the consequence is only that a consumer painting it is showing WHAT THE STEP
    /// JUST PRODUCED, not what the step was about to contract.
    ///
    /// **NOT ON THE WIRE — `serde(skip)`, UNTIL THE TREE VIEW READS IT.** It has no JS consumer today:
    /// the λ pane paints from `redex_span`, and shipping the path as well put a ~9.3-element array of
    /// `Dir` strings on every frame that nothing read and that `lambdaFrameBytes` then charged against
    /// `HISTORY_BYTES`, evicting the ring earlier for dead weight. `reduce.rs`'s `reduce_trace` refuses
    /// to widen `Step` for exactly that reason ("a field with no reader"); the same rule applies here.
    ///
    /// **IT STAYS ON THE RUST TYPE RATHER THAN BEING DELETED**, because `redex_span` cannot replace it
    /// for a STRUCTURAL consumer: a byte span is a coordinate into `text`, and `LambdaState::tree`'s
    /// `TermTree` has no text to index into. The planned tree view needs the path itself. Skipping is
    /// what makes that a wire decision that can be reversed by deleting one attribute, rather than a
    /// deletion that has to be re-derived. `Option<Path>` is `Default`, so the `Deserialize` half of the
    /// derive is well-formed even though nothing in this tree deserializes a `LambdaState`.
    #[cfg_attr(feature = "serde", serde(skip))]
    pub redex: Option<Path>,
    /// `redex`'s byte span in `text`, ABOVE — I.E. IN THIS FRAME'S OWN TEXT. `None` when there is no
    /// redex to locate (step 0, same as `redex` itself) OR when `redex`'s subterm fell outside what
    /// `text` actually shows — cut by `byte_budget` or `depth_cap` before the walk reached it. See
    /// `print_lambda_linked`'s "A NODE PAST THE TRUNCATION CUT RECORDS NOTHING": a clamped span would
    /// claim a boundary the print never reached, which is false, so absence is the honest answer, the
    /// same rule `redex_span` inherits rather than reinvents.
    ///
    /// **RESOLVED AGAINST THE TERM THIS FRAME HOLDS — `print_lambda_linked`'s ACTUAL CONTRACT, AND
    /// PRECISELY WHAT `node_to_lambda` WAS NOT.** `redex`'s own doc, immediately above, draws this
    /// line for the PATH; this field closes it for the SPAN a renderer actually needs to paint. A
    /// `node_to_lambda` span was fixed once, against the INITIAL term, and went stale the instant
    /// reduction contracted a root redex — the exact staleness that killed the old `source_node` field
    /// (see this struct's header comment). `redex_span` cannot go stale that way: `render` computes it
    /// FRESH every frame, by handing `redex`'s own path to the SAME walk that prints `text` for THIS
    /// frame — never a path recorded once and later resolved against a term it was not taken from.
    ///
    /// **AND SO IT COVERS THE CONTRACTUM, NOT THE REDEX** — the same distinction `redex`'s own doc
    /// draws for the PATH, cashed here as printed bytes: the text under this span is the subterm the
    /// step PRODUCED, because the redex `App` this path was recorded against no longer exists in the
    /// term being printed.
    ///
    /// **BYTES, LIKE EVERY OTHER SPAN ON THIS TYPE.** A consumer indexing into a JS string converts
    /// first — `web/src/spans.ts`'s `byteToIndex`/`byteIndexAt` — and `web/src/lambda-pane.ts`'s
    /// frame view is the one place this crosses into a DOM range.
    pub redex_span: Option<Span>,
    /// The source construct the step belonged to.
    pub owner: Owner,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct StateView {
    pub name: String,
    pub accept: bool,
    pub rules: Vec<RuleView>,
}

/// One transition, projected for a renderer. `read`/`write` carry one entry PER TAPE and `None` is a
/// wildcard — `RuleSpec` defaults every untouched tape to (wildcard read, unchanged write, `Stay`),
/// which is what lets a gadget name only the tapes it touches.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct RuleView {
    pub read: Vec<Option<Symbol>>,
    pub write: Vec<Option<Symbol>>,
    /// Head moves, one per tape, as `move_text` prints them.
    ///
    /// `Vec<String>` AND GENERATED AS `Array<Move>`, WHICH IS NOT A CONTRADICTION. `TmProgram::of`
    /// stringifies through `move_text`, whose own comment records why that is an explicit match
    /// rather than `Move`'s `Debug`: the text form and this projection must not drift independently
    /// even though today they agree. Changing the field to `Vec<Move>` would be wire-identical —
    /// the variants are literally `L`, `R`, `S` — and would collapse exactly that decoupling, so the
    /// field stays stringly typed and the TypeScript is narrowed by attribute instead.
    ///
    /// THE OVERRIDE SPELLS `as`, NOT `type`, AND THE DIFFERENCE IS NOT COSMETIC. `type` substitutes
    /// rendered text and registers no dependency, so it would generate a `RuleView.ts` that names
    /// `Move` without importing it — a file no `tsc` run in this repository would see until
    /// `web/src/types.ts` imports it. `as` routes through `Vec<Move>`'s own `TS` impl, so the import
    /// is emitted with the name. `move_text_matches_the_text_forms_own_vocabulary` is what pins the
    /// three strings this override claims.
    #[cfg_attr(feature = "ts", ts(as = "Vec<Move>"))]
    pub moves: Vec<String>,
    pub next: StateId,
}

/// The machine, projected ONCE per compile and never per step — see the module doc for the
/// measurement behind that split, and `TmProgram::of` for what `width` is doing in the signature.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct TmProgram {
    pub states: Vec<StateView>,
    pub alphabet: Vec<Symbol>,
    pub tapes: usize,
    pub width: usize,
    /// The state the machine enters at step 0, as an index into `states`.
    pub start: StateId,
}

/// `source_node` IS THE CORE NODE THAT PRODUCED THE CURRENT STATE, resolved through the `SourceMap`
/// `window` now takes. §6.2's dual-focus highlight is the consumer that decided it: it needs the Core
/// node behind the state the machine is in, and `SourceMap::tm_owner` keys on the state's printed NAME,
/// which is why a map has to reach `window` at all.
///
/// IT IS HONESTLY `None` FOR THREE KINDS OF STATE, and the map's own contract is the limit: machine
/// scaffolding with no instruction behind it, `defunc`-minted constructs, and any state THIS lowering
/// did not produce — including every state belonging to some other lowering of the same program.
/// `tm_owner` has deliberately no fallback to a nearby or similarly-spelled state, so neither does
/// this. Unlike the `source_node` that `LambdaState` had and lost, this one cannot be silently wrong
/// about a state it does resolve: a name either was recorded by this lowering or was not.
///
/// A `StateId` past the end of `states` also yields `None` rather than panicking — `window` is a
/// library path a renderer calls per step, and no index it could hold may abort the process.
///
/// `heads` AND `window_start` ARE BOTH MATERIALIZED-TAPE COORDINATES, not window-relative ones:
/// `heads[i]` is tape `i`'s head index against the tape as currently materialized
/// (`sim::Tape::head_index`, i.e. `left.len()`), and `window_start[i]` is the index of `window[i][0]`
/// in that same space. A marker's position inside the window is therefore `heads[i] -
/// window_start[i]`, and a scrolling call that addresses the tape directly — the planned
/// `tapeSlice(tape, from, to)` — has these as a coordinate space to speak in, rather than only a
/// window-relative index with nothing to scroll against. See `TmState::window`'s doc for the one
/// caveat on what "materialized" bounds this coordinate to.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct TmState {
    pub state: StateId,
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub step: u64,
    /// Each tape's head index in materialized-tape coordinates (see the struct doc).
    pub heads: Vec<usize>,
    /// Each tape's `window[i][0]` index, in the same materialized-tape coordinates as `heads`.
    pub window_start: Vec<usize>,
    pub window: Vec<Vec<Symbol>>,
    pub source_node: Option<NodeId>,
    /// The index into `states[state].rules` of the rule ABOUT TO FIRE, or `None` when nothing matches.
    ///
    /// IT NAMES WHAT HAPPENS NEXT, NOT WHAT PRODUCED THIS STATE. `window` is called after a step, so
    /// the tapes it reads and the `state` beside this field are both post-step; the first rule matching
    /// those tapes is what the FOLLOWING step will take. `None` — at an accept state, at `halt`, or at a
    /// genuinely stuck configuration — is a real answer about why a run stopped, not a missing one.
    ///
    /// `Some` DOES NOT PROMISE THE CURSOR WILL STEP, and the ordering that makes this true is one
    /// module over: `TmCursor::next` reads the step and cell caps BEFORE it matches a rule
    /// (`trace.rs`), returning `HitCap` without consulting δ at all. So at a spent cap this field names
    /// a transition the very next `next()` will not take.
    ///
    /// THAT IS DELIBERATE, AND ANSWERING `None` THERE WOULD BE WORSE. A cap is raiseable —
    /// `raise_cap` exists and `[continue]` is wired to it — so a run sitting at one is PAUSED, not
    /// stuck, and the rule this field names is exactly what fires once the cap moves. Reporting `None`
    /// would make a paused run indistinguishable from a halted one, which is the conflation
    /// `RecordEnd`'s four outcomes exist to prevent one layer up (`web/src/protocol.ts`: "conflating
    /// any two of them is the trap"). Whether the cursor may step is `status()`'s question, and a
    /// consumer that needs both asks both.
    ///
    /// RESOLVED BY `sim::rule_matches`, THE CRATE'S ONLY δ-MATCHER, rather than re-derived. A consumer
    /// could compute this from `window`, `heads` and `window_start`, which the frame already carries —
    /// and that consumer would be a second copy of first-match-wins-with-wildcards in a language whose
    /// compiler cannot see this one. `usize` rather than `u32` to match `heads` and `window_start`
    /// beside it; on wasm32 they are the same width and cross as plain numbers.
    pub rule: Option<usize>,
}

/// A λ term as a flat arena, so that NOTHING DERIVED ON IT RECURSES.
///
/// The obvious shape — `Abs(String, Box<TermNode>)` — gives the type two recursive paths, and both
/// are linear in DEPTH rather than node count: serde's derived `Serialize` descends one frame per
/// level, and the compiler's `drop_in_place` walks the `Box` chain the same way. A wasm trap does not
/// unwind, so neither returns an error — both poison the module, and the `Drop` path fires where no
/// caller can see it. `LambdaTerm`, the type this is built FROM, carries a hand-written iterative
/// destructor (`term.rs`'s `impl Drop for LambdaTerm`) for exactly that hazard; indices are how this
/// type avoids needing one.
///
/// `nodes` is in POST-ORDER — every child precedes its parent — because the walk that builds it
/// completes children before parents. `root` is therefore always `nodes.len() - 1`, and is stored
/// anyway so a consumer never encodes that convention.
///
/// `nodes` is never empty: a term has at least one node, and a zero budget refuses at the first one,
/// so `root` always indexes a real element.
///
/// THAT POINTER READ `term.rs` line 482 UNTIL THIS COMMIT, AND IT HAD DRIFTED. It was
/// `impl Drop for LambdaTerm`'s own opening line when the arena rewrite (#15) wrote it, and three
/// commits moved it 166 lines down between them — static click-linking (#23) by 5, the dual-focus
/// slice (#26) by 95, and `clippy::pedantic` (#31) by 66. This conversion found 482, as this file
/// then stood, inside a comment in `subst`'s body, arguing why the `maxfree` check has to come
/// BEFORE the `Abs` arm builds its shifted argument — a different function, and an argument about
/// substitution COST rather than about teardown depth, so nothing near where it landed could be
/// mistaken for the destructor. THIS COMMIT'S OWN ADDED LINES ELSEWHERE IN `term.rs` HAVE SINCE
/// MOVED 482 AGAIN, off that landing too — the tightest demonstration available of why this note
/// retires the coordinate rather than trusting it: even the sentence recording the drift did not
/// outlive its own commit.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TermTree {
    pub nodes: Vec<TermNode>,
    pub root: u32,
}

/// One node of a [`TermTree`]. Children are indices into that tree's `nodes`, never owned subtrees.
///
/// `u32` rather than `usize` is a BOUNDARY decision, not a memory one: wasm-bindgen maps `u64` to a
/// JavaScript `bigint`, and `Var`'s de Bruijn index is already `u32`, so the payload stays uniformly
/// numeric. On wasm32 `usize` is 32 bits, which makes the two exactly as wide as `node_budget` there.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum TermNode {
    Var(u32),
    Abs(String, u32),
    App(u32, u32),
}

impl LambdaState {
    /// Render the term the cursor currently holds, bounded by `byte_budget` and `depth_cap`.
    ///
    /// **NO SECOND WALK.** `print_lambda_capped` is ALREADY `print_lambda_linked` called with an empty
    /// `want` (see that function's one-line body); the recording a non-empty `want` triggers lives at
    /// `Printer::node`, the single site every subterm passes through regardless of whether `want` has
    /// anything in it. Calling `print_lambda_linked` here directly, with `c.last_redex()` as `want`,
    /// rides the walk this call was already paying for — it does not add one. That matters because the
    /// record loop calls this once per β-step (`FRAME_BYTES`, measured at 555 steps on `map_fold`); a
    /// design that printed twice here would pay for the second print that many times over.
    ///
    /// **NO SECOND WALK IS NOT THE SAME AS FREE.** Measured with `frame_cost_probe` before and after,
    /// same machine, section D (`FRAME_BYTES = 512`): render cost rose **+20% to +75%** per step —
    /// `map_fold` 3.92 → 5.74 µs, `while4` 4.41 → 5.46, `sample` 3.31 → 5.81 — while the β-step itself
    /// was unchanged (`while4` 0.46 → 0.46). Two things this doc's argument does not mention pay for
    /// that: the `want` map is allocated and dropped per call, and `Printer::node`'s
    /// `want.get(&self.path)` compares a `Vec<Dir>` where the empty-`want` path was a null check, so it
    /// scales with path length. Microseconds in absolute terms, and the record loop's budget is bytes
    /// rather than time — but the figure belongs next to the claim rather than inferred from it.
    ///
    /// **THE SENTINEL KEY IS ARBITRARY AND NEVER LEAVES THIS FUNCTION.** `print_lambda_linked` inverts
    /// `want` BY PATH (see its own doc) and hands back whichever id named the matching path; nothing
    /// downstream reads the id for anything else. `want` here never holds more than the one entry
    /// `last_redex()` supplies, so no real `NodeId` this call's caller might be tracking can collide
    /// with it — the id is discarded the moment `redex_span` is pulled back out.
    #[must_use]
    pub fn render(c: &LambdaCursor, byte_budget: usize, depth_cap: u32) -> LambdaState {
        let mut want: BTreeMap<NodeId, Path> = BTreeMap::new();
        if let Some(redex) = c.last_redex() {
            want.insert(0, redex.clone());
        }
        let (text, spans, cut, nodes) = print_lambda_linked(c.term(), byte_budget, depth_cap, &want);
        // At most one entry can ever match: `want` above never holds more than the one path, so this is
        // "the span for that path, if the walk reached it" rather than a search over several candidates.
        let redex_span = nodes.into_iter().find_map(|(span, id)| (id == 0).then_some(span));
        LambdaState {
            text,
            spans,
            cut,
            step: c.steps_taken(),
            redex: c.last_redex().cloned(),
            redex_span,
            owner: c.last_owner(),
        }
    }

    /// The term as a flat tree, or `None` if it exceeds `node_budget`. A second, independent cause
    /// also yields `None`: the arena's own `u32` index space overflowing before the budget would have
    /// refused first (see `emit`'s doc for why that is a refusal rather than a panic) -- a consumer
    /// reading only this entry point could not otherwise tell the two apart.
    ///
    /// `None` RATHER THAN A PARTIAL TREE. Truncated text is visibly truncated; a truncated AST is a lie
    /// about the term's shape, and a partial arena would be the same lie with an index on it. The count
    /// happens during the walk for the same reason the printer's budget does — building the tree and
    /// then measuring it defeats the purpose.
    #[must_use]
    pub fn ast(c: &LambdaCursor, node_budget: usize) -> Option<TermTree> {
        let mut budget = node_budget;
        to_tree(c.term(), &mut budget)
    }
}

/// One `to_tree` work item: either a subterm still to visit, or a marker recording how many completed
/// children to pop off `results` and how to combine them, once every item pushed after it is done.
enum Work<'a> {
    Enter(&'a LambdaTerm),
    Abs(String),
    App,
}

/// `LambdaState::ast`'s walk. ITERATIVE, OVER AN EXPLICIT STACK, deliberately: `LambdaTerm` is only
/// guarded against unbounded depth from the SECOND step onward (`LambdaCursor::next`'s depth check),
/// not at construction, so the very first term a cursor holds can already be deeper than a native
/// recursive walk survives — the same hazard `term.rs`'s own `Drop` and `logical_sizes` are iterative
/// to avoid.
///
/// IT BUILDS AN ARENA RATHER THAN A TREE OF `Box`ES, and that is what extends the same protection to
/// everything that happens to the RESULT. This walk was always safe; the derived `Serialize` and
/// derived `Drop` on the value it returned were not. See [`TermTree`].
///
/// THE BUDGET IS CHECKED BEFORE EACH NODE IS COUNTED AND BUILT, so a term that would exceed it returns
/// `None` at the node that overshoots rather than after the whole tree is built and measured — an
/// early `return` here abandons `work`, `nodes` and `results` without finishing them, which is fine
/// because nothing downstream reads any of them once this function has returned.
///
/// A SHARED SUBTERM COSTS THE BUDGET ONCE PER OCCURRENCE, not once per allocation: the arena is
/// unshared, so a DAG node reached through two parents becomes two distinct entries, and both must be
/// paid for — exactly as `print_lambda_capped` pays per occurrence in the text it writes, not per
/// underlying `Rc`.
fn to_tree<'a>(t: &'a LambdaTerm, budget: &mut usize) -> Option<TermTree> {
    let mut work: Vec<Work<'a>> = Vec::new();
    let mut nodes: Vec<TermNode> = Vec::new();
    let mut results: Vec<u32> = Vec::new();
    work.push(Work::Enter(t));
    while let Some(item) = work.pop() {
        match item {
            Work::Enter(term) => {
                if *budget == 0 {
                    return None;
                }
                *budget -= 1;
                match term.node() {
                    Node::Var(i) => emit(&mut nodes, &mut results, TermNode::Var(*i))?,
                    Node::Abs(name, body) => {
                        work.push(Work::Abs(name.to_string()));
                        work.push(Work::Enter(body));
                    }
                    Node::App(f, a, _) => {
                        work.push(Work::App);
                        work.push(Work::Enter(a));
                        work.push(Work::Enter(f));
                    }
                }
            }
            // `f` was pushed after `a` (see the `App` arm above), so it is popped from `work` — and
            // therefore built — first. Its index lands in `results` first too, with `a`'s pushed on
            // top once `a` finishes: `results` is itself a stack, so `a` comes off it FIRST and `f`
            // comes off LAST.
            Work::App => {
                let a = results.pop()?;
                let f = results.pop()?;
                emit(&mut nodes, &mut results, TermNode::App(f, a))?;
            }
            Work::Abs(name) => {
                let body = results.pop()?;
                emit(&mut nodes, &mut results, TermNode::Abs(name, body))?;
            }
        }
    }
    let root = results.pop()?;
    Some(TermTree { nodes, root })
}

/// Append `n` to the arena and push the index it landed at onto `results`.
///
/// `None` WHEN THE INDEX WOULD NOT FIT `u32`, refusing through the channel that already means "no
/// tree" rather than panicking — a panic under wasm aborts the module, and `unreachable!` is ruled
/// out for the same reason. 2^32 entries is on the order of 100 GB at `size_of::<TermNode>()`, so
/// this cannot occur; it is written as a branch rather than an assumption because a branch that
/// claims to be total and is not is the defect this project has corrected twice.
fn emit(nodes: &mut Vec<TermNode>, results: &mut Vec<u32>, n: TermNode) -> Option<()> {
    let idx = u32::try_from(nodes.len()).ok()?;
    nodes.push(n);
    results.push(idx);
    Some(())
}

fn move_text(m: Move) -> &'static str {
    // Mirrors `tm/syntax.rs`'s `write_moves`, the text form's own move vocabulary — kept as an
    // explicit match rather than `Move`'s `Debug` output so the two cannot drift independently even
    // though today they happen to agree.
    match m {
        Move::L => "L",
        Move::R => "R",
        Move::S => "S",
    }
}

impl TmProgram {
    /// Project `m` once (see the module doc: this is built per compile, never per step). `width` is
    /// the caller's field-width choice for the encoding that produced `m` — a fact about the encoding,
    /// not something a `Machine` carries, so it comes in as a parameter rather than a re-derivation.
    #[must_use]
    pub fn of(m: &Machine, width: usize) -> TmProgram {
        let states = m
            .states
            .iter()
            .map(|s| StateView {
                name: s.name.clone(),
                accept: s.accept,
                rules: s
                    .rules
                    .iter()
                    .map(|r| RuleView {
                        read: r.read.clone(),
                        write: r.write.clone(),
                        moves: r.moves.iter().map(|&mv| move_text(mv).to_string()).collect(),
                        next: r.next,
                    })
                    .collect(),
            })
            .collect();
        // `m.alphabet()`, NOT a re-derivation: `Machine::alphabet` already walks every rule's read and
        // write symbols into a sorted set, and duplicating that here is exactly the second copy this
        // codebase's conventions treat as a defect (see `sourcemap.rs`'s module doc on the same point).
        TmProgram { states, alphabet: m.alphabet(), tapes: m.tapes, width, start: m.start }
    }
}

impl TmState {
    /// The cursor's current state and step, plus `radius` cells of tape around each head — never the
    /// whole tape (see the module doc's `TmProgram`/`TmState` split). Built from `sim::Tape::head_index`
    /// and `sim::Tape::window`, which slice the zipper directly, rather than `sim::Tape::snapshot`,
    /// which clones the whole tape before any slice is taken: `window` is called once per tape per
    /// step by a renderer, and `sim::DEFAULT_CAPS.cells` alone permits 5,000,000 cells TOTAL ACROSS
    /// EVERY TAPE — `TmCursor::next` sums `Tape::cells()` over all of them and compares that one total
    /// against the cap, not against each tape individually — so paying `snapshot`'s O(tape) cost here
    /// is exactly what the module doc's `TmProgram`/`TmState` split exists to avoid.
    ///
    /// `map` RESOLVES `source_node` AND IS USED FOR NOTHING ELSE — one `BTreeMap` lookup on the current
    /// state's name, which allocates nothing and so does not disturb the cost above. See the struct doc
    /// for what it resolves and the three cases where it honestly answers `None`.
    ///
    /// **`Option<&SourceMap>` BECAUSE A CALLER CAN HONESTLY HAVE NO MAP AT ALL**, which is 5d-i's
    /// `TmScratch`: a machine typed straight into a pane was never lowered from a Core, so there is no
    /// lowering for `tm_owner` to have recorded anything in. `Session::tm_state` passes
    /// `Some(&self.map)`; a scratch passes `None`, and `source_node` becomes `None` on exactly the path
    /// where it has no meaning. See
    /// `docs/superpowers/specs/2026-08-11-plan5d-i-session-model-design.md` §3.1.
    ///
    /// **THIS IS THE SHAPE §3.1's DECISION 2 REJECTED ONE LAYER OUT, AND IT IS ADMISSIBLE HERE FOR A
    /// REASON THAT DOES NOT TRANSFER.** At the wasm boundary that design chose three distinct types
    /// over one type with `Option` fields, because `redextape-wasm`'s `session.rs` records what the
    /// looser shape cost there: a fabricated, permanently uncovered user-facing status for a state no
    /// program could produce. Here the *output* field is ALREADY `Option<NodeId>` and independently
    /// reachable — a `Session` whose lowering recorded nothing gets `source_node: None` today, and the
    /// struct doc above lists three kinds of state that do — so the parameter adds no state to the type
    /// and there is no status to fabricate.
    ///
    /// **THE REJECTED ALTERNATIVE IS A SECOND `window_unmapped` CONSTRUCTOR**, which is the cheaper
    /// diff: it leaves the twelve test call sites of this function untouched. It duplicates the window,
    /// heads and rule computation — the part of this function with logic in it — so a change to how a
    /// window is clamped, or to how `rule` matches, would have to land in two places or silently land
    /// in one. Cheap diff, wrong factoring.
    ///
    /// CLAMPED AT BOTH ENDS OF WHAT THE TAPE HAS MATERIALIZED, not merely bounded in length: a head
    /// near the start of a tape has no `radius` cells to its left, and `Tape::window`'s own
    /// `saturating_sub`/`min` are what stop the slice running off either edge rather than merely
    /// producing a short-but-wrong one.
    ///
    /// `heads[i]` AND `window_start[i]` ARE MATERIALIZED-TAPE COORDINATES (see the struct doc), which
    /// corrects an earlier claim here that no coordinate existed once the head had moved left of
    /// everything it had visited. Checked against `sim::Tape::step`: `left.len()` is a well-defined
    /// index into every cell the tape has touched so far. What is true is narrower than "no
    /// coordinate" — a `Move::L` past the materialized region leaves `left` empty, so the region's own
    /// left edge (and therefore the origin `left.len()` counts from) shifts with the head rather than
    /// staying fixed at the start of the run. `heads`/`window_start` are reported against the region as
    /// materialized at the moment of this call, which is well-defined, just not a fixed absolute origin.
    pub fn window<M: Borrow<Machine>>(c: &TmCursor<M>, map: Option<&SourceMap>, radius: usize) -> TmState {
        let mut window = Vec::with_capacity(c.tapes().len());
        let mut heads = Vec::with_capacity(c.tapes().len());
        let mut window_start = Vec::with_capacity(c.tapes().len());
        for tape in c.tapes() {
            let (cells, start) = tape.window(radius);
            heads.push(tape.head_index());
            window_start.push(start);
            window.push(cells);
        }
        let state = c.state();
        // `get`, never `[]`: a `StateId` past the end must answer `None` rather than abort a renderer.
        let entry = c.machine().states.get(state as usize);
        // `entry` FIRST, `map` SECOND, which is the order this line already read in before the map
        // became optional — both are pure `Option`s over lookups with no side effects, so the nesting
        // is free to be chosen for legibility rather than forced by evaluation order. NO FALLBACK IN
        // THE `None` ARM: an absent map answers `None` for every state, the same answer `tm_owner`
        // already gives for scaffolding, rather than an invented owner. See this function's doc.
        let source_node = entry.and_then(|s| map.and_then(|m| m.tm_owner(&s.name)));
        let rule = entry.and_then(|s| s.rules.iter().position(|r| crate::tm::sim::rule_matches(&r.read, c.tapes())));
        TmState { state, step: c.steps_taken(), heads, window_start, window, source_node, rule }
    }
}

/// Everything a renderer needs to link one construct across three panes, built ONCE PER COMPILE.
///
/// NOT A FRAME, AND THE DIFFERENCE IS THE WHOLE DESIGN. `LambdaState` is recorded per step at
/// `FRAME_BYTES`; this is built once, at the readout's budget, for the INITIAL term only. That is
/// what makes it affordable where `LambdaState::ast` was not: a per-step tree cost 850 MB against a
/// 32 MB ring, and this costs one extra print per compile over a walk that was already happening.
///
/// **IT IS STEP-0 ONLY, AND THAT IS NOT A SHORTCUT.** `SourceMap::node_to_lambda` records paths
/// root-relative into the initial lowered term; normal-order reduction contracts root redexes, so at
/// step N > 1 a path indexes a structurally different tree. `LambdaState` had a `source_node` on that
/// mistake and lost it — see this module's header. A consumer must not use `lambda_nodes` against any
/// term but the one `lambda_text` holds.
///
/// **ONE STRUCT RATHER THAN THREE ACCESSORS**, because all three legs must come from ONE compile. Three
/// would be three chances to hold one program's source index beside another program's lambda index;
/// the `NodeId`s would resolve, most of them to the wrong construct, and nothing would notice. That is
/// the failure `SourceMap` is shaped to remove by offering no `with_source` setter, applied at the
/// boundary instead of inside the map.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct LinkIndex {
    /// The INITIAL term, printed at the caller's budget.
    pub lambda_text: String,
    pub lambda_spans: Vec<(Span, TokenClass)>,
    /// Which limit cut `lambda_text`, or `None`. **Renamed from `lambda_truncated` rather than
    /// retyped**: leaving the name would let `if (index.lambdaTruncated)` keep compiling while
    /// silently meaning something new.
    pub lambda_cut: Option<Cut>,
    /// A node's span in `lambda_text`. ABSENT for a node whose subterm fell past the cut, never a
    /// span clamped to it — see `print_lambda_linked`.
    pub lambda_nodes: Vec<(Span, NodeId)>,
    /// A node's span in the SOURCE text. Empty unless the map was built by `build_from_program`.
    pub source_nodes: Vec<(Span, NodeId)>,
    /// `tm_owner[state_id]` is the Core node that produced that state, or `-1`.
    ///
    /// **BUILT BY NAME, NOT BY FLATTENING `node_to_tm`.** `SourceMap::build_from_program` lowers at
    /// `MIN_FIELD_WIDTH` only to record ownership, and `run_tm_described` re-lowers with its own
    /// auto-fitted width — so `node_to_tm`'s `StateId`s index a different machine from the one
    /// `TmProgram.states` indexes. The invariant that survives the width change is that `lower_tm`
    /// derives state NAMES from the instruction stream, so the two lowerings agree on names. This is
    /// the same resolution `TmState::window` performs per step, hoisted to once per compile.
    ///
    /// `-1` RATHER THAN `Option<NodeId>` because this crosses to JavaScript as an `Int32Array`, and a
    /// dense typed array is the difference between 143 KB and 26,484 objects for `list60`.
    ///
    /// **A `NodeId` THAT WOULD NOT FIT `i32` DECLINES THE WHOLE LEG, THE SAME WAY A `None` PROGRAM
    /// DOES — IT DOES NOT BECOME `-1`.** `NodeId` is a `u32`, and a value at or past `2^31` goes
    /// negative under `as i32` — landing on `-1` for the one id that turns it exactly, or some other
    /// negative value otherwise, and either way becoming indistinguishable from (or worse, a wrong
    /// index next to) a state that genuinely has no owner. `build` refuses that cast with
    /// `i32::try_from` and empties the whole vec on failure — the same "no lie, just nothing" refusal
    /// `emit` (above) makes for `TermTree`'s arena index.
    ///
    /// **THAT REFUSAL IS NOW PROVABLY UNREACHABLE, AND IS KEPT ANYWAY.** It used to cite
    /// `core::NodeGen::fresh` as a bare counter that bounded nothing; `core::MAX_NODE_ID` bounds it
    /// now, and sits under `i32::MAX` precisely so this cast cannot fail. The check stays because it
    /// costs one comparison and because the alternative is a cast whose soundness lives in another
    /// module's constant — if that ceiling is ever raised past `2^31`, this refuses instead of
    /// silently emitting a wrong owner.
    ///
    /// THE NARROWER ALTERNATIVE WAS WEIGHED AND REJECTED, recorded so it is not re-proposed blind:
    /// map only the failing entries to some *other* negative value (`i32::MIN`) and keep every
    /// representable owner, trading total refusal for one missing link. It buys availability and
    /// costs honesty, and honesty is what this refusal is for — `web/src/link.ts`'s `nodeForState`
    /// collapses ANY negative to `null`, so at the consumer `i32::MIN` renders exactly as `-1` does:
    /// "this state has no owner." The state has one. A distinct sentinel is only distinguishable
    /// Rust-side, and nothing Rust-side reads this field. Declining the leg is the only option that
    /// does not tell the UI something false about a state it can click.
    pub tm_owner: Vec<i32>,
}

impl LinkIndex {
    /// Build all three legs from one compile.
    ///
    /// TOTAL OVER BOTH ABSENCES. A `None` term (the lambda backend declined this program) gives empty
    /// lambda legs rather than failing, and a `None` program (the TM backend declined) gives an empty
    /// `tm_owner`. `SourceMap::build` is already total over exactly these refusals, and the index must
    /// not be the layer that stops being. A THIRD, NARROWER REFUSAL joins those two here: a `Some`
    /// program whose owner ids cannot all fit `i32` also empties `tm_owner` rather than emitting a
    /// value that would misidentify a state's owner — see the field's own doc.
    ///
    /// `byte_budget` AND `depth_cap` ARE PARAMETERS because this file picks no numbers — see the
    /// module header. The web app passes `LAMBDA_BYTE_BUDGET`; the wasm boundary passes
    /// `MAX_PRINT_DEPTH`, which is a fact about an engine call stack rather than renderer policy.
    #[must_use]
    pub fn build(
        term: Option<&LambdaTerm>,
        program: Option<&TmProgram>,
        map: &SourceMap,
        byte_budget: usize,
        depth_cap: u32,
    ) -> LinkIndex {
        let (lambda_text, lambda_spans, lambda_cut, lambda_nodes) = match term {
            None => (String::new(), Vec::new(), None, Vec::new()),
            Some(t) => print_lambda_linked(t, byte_budget, depth_cap, &map.node_to_lambda),
        };
        let source_nodes = map.node_to_source.iter().map(|(id, span)| (*span, *id)).collect();
        // `collect::<Option<Vec<i32>>>()` SHORT-CIRCUITS TO `None` THE INSTANT ONE STATE'S OWNER
        // OVERFLOWS `i32`, discarding whatever entries the walk had already produced for other states —
        // never a vec with some real owners and one lie. That `None` then falls into the exact
        // `unwrap_or_default` a declined program already used, so an id too big to represent is treated
        // as no different from "the TM backend declined this program": no owner info, not wrong owner
        // info. See `tm_owner`'s own doc for why `-1` specifically must not be the fallback here.
        let tm_owner = program
            .and_then(|p| {
                p.states
                    .iter()
                    .map(|s| match map.tm_owner(&s.name) {
                        None => Some(-1),
                        Some(n) => i32::try_from(n).ok(),
                    })
                    .collect::<Option<Vec<i32>>>()
            })
            .unwrap_or_default();
        LinkIndex { lambda_text, lambda_spans, lambda_cut, lambda_nodes, source_nodes, tm_owner }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_tree_matches_the_term_shape_within_budget() {
        // `App(Var(0), Var(1))` is the minimal discriminator: a transposed pop order builds
        // `App(Var(1), Var(0))` instead, a difference `is_some()` cannot see. Built directly with the
        // `lambda::term` constructors, not lowered from source, so the expected shape is unambiguous.
        //
        // THE ARENA IS ASSERTED IN FULL, INDICES AND ALL, not just its root. Post-order is what makes
        // `root == nodes.len() - 1` true, and an implementation that emitted the right nodes in the
        // wrong order would still satisfy a root-only assertion.
        use crate::lambda::term::{app, var};

        let flat = app(var(0), var(1));
        let flat_ast = LambdaState::ast(&LambdaCursor::new(&flat, 1_000), usize::MAX);
        assert_eq!(
            flat_ast,
            Some(TermTree { nodes: vec![TermNode::Var(0), TermNode::Var(1), TermNode::App(0, 1)], root: 2 })
        );

        // Nested one level, so a fix that only gets the outermost `App` right cannot pass: the
        // function position is itself an `App`, and its two children must land in order too.
        let nested = app(app(var(0), var(1)), var(2));
        let nested_ast = LambdaState::ast(&LambdaCursor::new(&nested, 1_000), usize::MAX);
        assert_eq!(
            nested_ast,
            Some(TermTree {
                nodes: vec![
                    TermNode::Var(0),
                    TermNode::Var(1),
                    TermNode::App(0, 1),
                    TermNode::Var(2),
                    TermNode::App(2, 3),
                ],
                root: 4,
            })
        );
    }

    #[test]
    fn move_text_matches_the_text_forms_own_vocabulary() {
        assert_eq!(move_text(Move::L), "L");
        assert_eq!(move_text(Move::R), "R");
        assert_eq!(move_text(Move::S), "S");
    }

    /// THE DEFECT THIS PINS: before the fix, `tm_owner` cast a `NodeId` to `i32` with `as`, which wraps
    /// silently rather than refusing. `u32::MAX` is the sharpest fixture for it — `u32::MAX as i32` is
    /// exactly `-1`, the same sentinel `tm_owner`'s doc reserves for "this state has no owner at all" —
    /// so the pre-fix build for `s0` (which DOES have an owner, `u32::MAX`) was byte-for-byte identical
    /// to the pre-fix build for `s1` (which genuinely has none). A consumer reading `tm_owner` could not
    /// tell a real, huge owner id from no owner; that is the silent wrong answer, not a crash.
    ///
    /// A `NodeId` this large can never occur from real parsing today (`core::NodeGen::fresh` is a bare
    /// counter with no cap — see its own doc), which is exactly why this test builds the `SourceMap`
    /// fixture by hand instead of parsing a program: reaching `u32::MAX` legitimately would need
    /// billions of source constructs, and the enforcement this pins must be checkable without paying
    /// that cost.
    #[test]
    fn tm_owner_declines_the_whole_leg_rather_than_wrap_an_id_into_the_no_owner_sentinel() {
        let program = TmProgram {
            states: vec![
                // `s0`'s "owner" is `NodeId::MAX` (`u32::MAX`) — unrepresentable in `i32`, and the one
                // value whose wraparound lands exactly on the `-1` sentinel.
                StateView { name: "s0".to_string(), accept: false, rules: Vec::new() },
                // `s1` has a real absence: no entry in `tm_name_to_node` at all.
                StateView { name: "s1".to_string(), accept: true, rules: Vec::new() },
            ],
            alphabet: Vec::new(),
            tapes: 1,
            width: 1,
            start: 0,
        };
        let map = SourceMap {
            tm_name_to_node: [("s0".to_string(), NodeId::MAX)].into_iter().collect(),
            ..SourceMap::default()
        };

        let index = LinkIndex::build(None, Some(&program), &map, 0, 0);

        // Not `vec![-1, -1]` — that would be the pre-fix collision, s0's real (if unrepresentable) owner
        // reading identically to s1's genuine absence. The whole leg must decline instead, exactly as it
        // already does for a `None` program (`link_index_is_total_over_a_declined_leg`, in the
        // integration suite).
        assert!(
            index.tm_owner.is_empty(),
            "an id that cannot fit i32 must empty the whole leg, not report -1 as though there were no \
             owner: got {:?}",
            index.tm_owner
        );
    }
}
