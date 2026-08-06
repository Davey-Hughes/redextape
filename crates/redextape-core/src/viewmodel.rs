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

use crate::analysis::TokenClass;
use crate::core::NodeId;
use crate::lambda::term::Node;
use crate::lambda::{LambdaTerm, print_lambda_capped};
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
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct LambdaState {
    pub text: String,
    pub spans: Vec<(Span, TokenClass)>,
    pub truncated: bool,
    pub step: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct StateView {
    pub name: String,
    pub accept: bool,
    pub rules: Vec<RuleView>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RuleView {
    pub read: Vec<Option<Symbol>>,
    pub write: Vec<Option<Symbol>>,
    pub moves: Vec<String>,
    pub next: StateId,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
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
pub struct TmState {
    pub state: StateId,
    pub step: u64,
    /// Each tape's head index in materialized-tape coordinates (see the struct doc).
    pub heads: Vec<usize>,
    /// Each tape's `window[i][0]` index, in the same materialized-tape coordinates as `heads`.
    pub window_start: Vec<usize>,
    pub window: Vec<Vec<Symbol>>,
    pub source_node: Option<NodeId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum TermNode {
    Var(u32),
    Abs(String, Box<TermNode>),
    App(Box<TermNode>, Box<TermNode>),
}

impl LambdaState {
    /// Render the term the cursor currently holds, bounded by `byte_budget`.
    pub fn render(c: &LambdaCursor, byte_budget: usize) -> LambdaState {
        let (text, spans, truncated) = print_lambda_capped(c.term(), byte_budget);
        LambdaState { text, spans, truncated, step: c.steps_taken() }
    }

    /// The term as a tree, or `None` if it exceeds `node_budget`.
    ///
    /// `None` RATHER THAN A PARTIAL TREE. Truncated text is visibly truncated; a truncated AST is a lie
    /// about the term's shape. The count happens during the walk for the same reason the printer's
    /// budget does — building the tree and then measuring it defeats the purpose.
    pub fn ast(c: &LambdaCursor, node_budget: usize) -> Option<TermNode> {
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
/// THE BUDGET IS CHECKED BEFORE EACH NODE IS COUNTED AND BUILT, so a term that would exceed it returns
/// `None` at the node that overshoots rather than after the whole tree is built and measured — an
/// early `return` here abandons `work` and `results` without finishing them, which is fine because
/// nothing downstream reads either once this function has returned.
///
/// A SHARED SUBTERM COSTS THE BUDGET ONCE PER OCCURRENCE, not once per allocation: `TermNode` is an
/// owned, unshared tree, so a DAG node reached through two parents becomes two distinct `TermNode`s,
/// and both must be paid for — exactly as `print_lambda_capped` pays per occurrence in the text it
/// writes, not per underlying `Rc`.
fn to_tree<'a>(t: &'a LambdaTerm, budget: &mut usize) -> Option<TermNode> {
    let mut work: Vec<Work<'a>> = Vec::new();
    let mut results: Vec<TermNode> = Vec::new();
    work.push(Work::Enter(t));
    while let Some(item) = work.pop() {
        match item {
            Work::Enter(term) => {
                if *budget == 0 {
                    return None;
                }
                *budget -= 1;
                match term.node() {
                    Node::Var(i) => results.push(TermNode::Var(*i)),
                    Node::Abs(name, body) => {
                        work.push(Work::Abs(name.to_string()));
                        work.push(Work::Enter(body));
                    }
                    Node::App(f, a) => {
                        work.push(Work::App);
                        work.push(Work::Enter(a));
                        work.push(Work::Enter(f));
                    }
                }
            }
            // `f` was pushed after `a` (see the `App` arm above), so it is popped from `work` — and
            // therefore built — first. Its `TermNode` lands in `results` first too, with `a`'s pushed
            // on top once `a` finishes: `results` is itself a stack, so `a` comes off it FIRST and
            // `f` comes off LAST.
            Work::App => {
                let a = results.pop()?;
                let f = results.pop()?;
                results.push(TermNode::App(Box::new(f), Box::new(a)));
            }
            Work::Abs(name) => {
                let body = results.pop()?;
                results.push(TermNode::Abs(name, Box::new(body)));
            }
        }
    }
    results.pop()
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
    pub fn window<M: Borrow<Machine>>(c: &TmCursor<M>, map: &SourceMap, radius: usize) -> TmState {
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
        let source_node = c.machine().states.get(state as usize).and_then(|s| map.tm_owner(&s.name));
        TmState { state, step: c.steps_taken(), heads, window_start, window, source_node }
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
        use crate::lambda::term::{app, var};

        let flat = app(var(0), var(1));
        let flat_ast = LambdaState::ast(&LambdaCursor::new(&flat, 1_000), usize::MAX);
        assert_eq!(flat_ast, Some(TermNode::App(Box::new(TermNode::Var(0)), Box::new(TermNode::Var(1)))));

        // Nested one level, so a fix that only gets the outermost `App` right cannot pass: the
        // function position is itself an `App`, and its two children must land in order too.
        let nested = app(app(var(0), var(1)), var(2));
        let nested_ast = LambdaState::ast(&LambdaCursor::new(&nested, 1_000), usize::MAX);
        let expected = TermNode::App(
            Box::new(TermNode::App(Box::new(TermNode::Var(0)), Box::new(TermNode::Var(1)))),
            Box::new(TermNode::Var(2)),
        );
        assert_eq!(nested_ast, Some(expected));
    }

    #[test]
    fn move_text_matches_the_text_forms_own_vocabulary() {
        assert_eq!(move_text(Move::L), "L");
        assert_eq!(move_text(Move::R), "R");
        assert_eq!(move_text(Move::S), "S");
    }
}
