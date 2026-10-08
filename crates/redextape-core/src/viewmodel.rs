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
//!
//! THE ASM LEG IS SPLIT THE SAME WAY, AND ITS FRAME'S BOUNDS ARE PARAMETERS TOO. `AsmProgram` is built once
//! per compile; `AsmState` carries at most `AsmWindow`'s count of locals, arguments, call frames, cells and
//! boxes, each beside the length it was cut from. The spec's `sum(1000)` reaches 1,001 frames and its
//! `upto(200)` 200 cells (§2.5), so a frame that carried the whole machine would grow with the run; how
//! much of it a view shows is the renderer's call, made where `TM_RADIUS` is, in `web/src/protocol.ts`.

use std::borrow::Borrow;
use std::collections::{BTreeMap, BTreeSet};

use crate::analysis::TokenClass;
use crate::core::NodeId;
use crate::lambda::{Cut, LambdaTerm, Owner, Path, print_lambda_linked};
use crate::sourcemap::SourceMap;
use crate::span::Span;
use crate::tm::asm::{Program, print_instr, reg_str};
use crate::tm::machine::{Machine, Move, StateId, Symbol};
use crate::trace::{AsmCursor, AsmStatus, LambdaCursor, TmCursor, WordTag};

pub mod tree;

pub use tree::{LambdaTree, TreeAnswer};

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
    /// The classified spans of `text`, byte offsets into it.
    ///
    /// **ON THE WIRE THEY ARE ONE BYTE STRING, THREE LITTLE-ENDIAN `u32`S A SPAN** (`span_words`): its start, its end
    /// and its class's index in `token_class_names`, which `serde-wasm-bindgen` puts on the page as a `Uint8Array`. As
    /// `[{start, end}, "Class"]` tuples, about 300 a frame, they were most of what a λ frame cost to build and to copy.
    #[cfg_attr(feature = "serde", serde(with = "span_words"))]
    #[cfg_attr(feature = "ts", ts(type = "Uint8Array"))]
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
    /// **NOT ON THE WIRE — `serde(skip)`, AND THE TREE VIEW DID NOT CHANGE THAT** (spec §4.3 keeps it
    /// skipped). It has no JS consumer: the λ view's flat text paints from `redex_span`, and its tree
    /// marks the contractum through `LambdaTree.contractum`, which the core resolves from this same path
    /// (below). Shipping the path as well put a ~9.3-element array of
    /// `Dir` strings on every frame that nothing read and that `lambdaFrameBytes` then charged against
    /// `HISTORY_BYTES`, evicting the ring earlier for dead weight. `reduce.rs`'s `reduce_trace` refuses
    /// to widen `Step` for exactly that reason ("a field with no reader"); the same rule applies here.
    ///
    /// **IT STAYS ON THE RUST TYPE RATHER THAN BEING DELETED**, because `redex_span` cannot replace it
    /// for a STRUCTURAL consumer: a byte span is a coordinate into `text`, and `LambdaTree` — which the tree
    /// view reads — marks the contractum by node index, resolving this path Rust-side (`viewmodel::tree`). Skipping is
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
    /// The line of `TmProgram.listing` whose instruction built this state — `SourceMap::tm_instr` — or
    /// `None` for machine scaffolding, and for every state of a machine with no map behind it: a copy, a
    /// reduced file.
    pub instr: Option<usize>,
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
    /// The asm program this machine was lowered from, one instruction per line as `print_instr` writes
    /// it — `SourceMap::tm_listing`. Empty for a machine with no map behind it.
    pub listing: Vec<String>,
    /// That program's labels, each with the `listing` line it precedes — `SourceMap::tm_labels`.
    pub labels: Vec<(String, usize)>,
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
/// (`sim::Tape::head_index`, i.e. `left.len()`), and `window_start[i]` is the index of tape `i`'s first
/// window cell in that same space. A marker's position inside the window is therefore `heads[i] -
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
    /// The index of each tape's first window cell, in the same materialized-tape coordinates as `heads`.
    pub window_start: Vec<usize>,
    /// Each tape's cells from `window_start[i]`, at most `radius` either side of its head.
    ///
    /// **ON THE WIRE A TAPE'S WINDOW IS ONE STRING, A CELL A CHARACTER** (`tape_windows`). The web app records a TM leg
    /// a frame a step, and as an array of one-character strings a tape this field was most of what a frame cost. For
    /// `map`/`fold` over three elements, 78,459 frames of 85 cells, measured in node on the release wasm: building them
    /// took 501 to 519 ms, and the structured clone that carries them from the worker to the page 227 to 235 ms to
    /// write and 199 to 208 ms to read, 44.1 MB in all (2026-10-06). As a string a tape, from a throwaway build that
    /// wrote the same shape and from this one: building 185 to 203 ms in five runs, writing 49 to 55 ms and reading 58
    /// to 59 ms in three, 20.7 MB (2026-10-06 and 07). A full TM history in Chromium retained 68,637,886.67 bytes of heap, and retains
    /// 29,342,720.67 (`HISTORY_BYTES`'s doc). **A CELL IS A `char`, NOT A UTF-16 UNIT**: a symbol outside the basic
    /// plane is two units of the string, so a reader takes the cells by code point.
    #[cfg_attr(feature = "serde", serde(with = "tape_windows"))]
    #[cfg_attr(feature = "ts", ts(type = "Array<string>"))]
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

/// How much of the asm machine one `AsmState` carries: the first `locals` locals, the first `args`
/// arguments, the top `frames` call frames, the newest `cells` cons cells and the newest `boxes` boxes.
///
/// **FIVE BOUNDS, ALL THE RENDERER'S** — the module doc's rule that core picks no number. Each one bounds a
/// list the run can grow without limit: a register bank to `MAX_REGISTERS`, the stack to `Caps::stack`
/// frames, the heap and the boxes to `Caps::heap` each. `locals` also bounds each frame's saved locals,
/// since a frame's saved bank is the caller's locals as they stood at the `call`, and a view that shows
/// five of the current frame's registers has no use for fifty of a caller's.
///
/// **`Deserialize` IS LOAD-BEARING HERE, WHERE IT IS NOT FOR ANY OTHER TYPE IN THIS FILE.** Every other type
/// derives it and nothing reads it back; this one travels the other way, as the argument JavaScript passes
/// to the asm leg's frame request, so a renderer states its window in one object rather than five
/// positional numbers it could transpose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct AsmWindow {
    pub locals: usize,
    pub args: usize,
    pub frames: usize,
    pub cells: usize,
    pub boxes: usize,
}

/// One machine word and the tag saying which kind of instruction made it.
///
/// **`word` IS THE `u64` IN DECIMAL, A STRING FOR EVERY WORD, NOT ONLY THE LARGE ONES** (spec §5.3, amendment
/// 13). Saturating `mul` reaches `u64::MAX`, which a JS number cannot hold exactly — 2^53 + 1 already rounds —
/// and `serde-wasm-bindgen` 0.6.5, the serializer `redextape-wasm` puts every frame through, refuses a `u64`
/// above `Number.MAX_SAFE_INTEGER` with an error rather than rounding it, so one saturated register would
/// fail the whole frame. A number for small words and a string for large ones would put a branch in every
/// reader for a case no corpus program reaches; one form puts none. `ts-rs`'s `u64`-to-`bigint` default
/// never arises, since there is no `u64` here to map.
///
/// **THE TAG TRAVELS WITH THE WORD, NOT BESIDE THE LIST IT SITS IN**, because it is what the view reads the
/// word by: `3` as a value, `#3` or `nil` as a list, `box #3` as a box handle (spec §6.3). A parallel list
/// of tags could be windowed differently from its words; a field cannot.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct AsmWord {
    pub word: String,
    pub tag: WordTag,
}

/// One saved call frame: where `ret` resumes, and the first of the caller's locals as they stood at the
/// `call`, with the length of the whole saved bank.
///
/// **NO CALLEE.** The instruction before `ret_pc` is the `call` that pushed this frame, and it names the
/// label it jumped to, so a renderer holding `AsmProgram.listing` reads the callee off line `ret_pc - 1`.
/// Carrying it here would send, per frame per step, a name the listing already holds once (spec §5.3).
///
/// **NO WRITTEN BITS EITHER.** The view marks a local "left over from caller" in the CURRENT frame (§6.3); a
/// saved frame's bits come back into play only when `ret` restores them, at which point they are the
/// current frame's and `AsmState.written` carries them.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct AsmCallFrame {
    pub ret_pc: usize,
    /// The first `AsmWindow::locals` of the caller's saved locals.
    pub saved: Vec<AsmWord>,
    /// How many locals the frame saved, however many `saved` shows.
    pub saved_len: usize,
}

/// One cons cell, named by the list word that points at it.
///
/// **`cell` IS 1-BASED, BECAUSE THAT IS THE WORD A REGISTER HOLDS.** `cons` returns the heap's length after
/// its push, and `nil` is the list word 0, so a register reading `#3` points at the cell with `cell: 3`.
/// A 0-based index here would make every register-to-cell match an off-by-one the renderer had to know.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct AsmCell {
    pub cell: usize,
    pub head: AsmWord,
    pub tail: AsmWord,
}

/// One box, named by the 1-based handle `box` returned for it, for `AsmCell::cell`'s reason: it is the word
/// a register holds.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct AsmBox {
    pub handle: usize,
    pub content: AsmWord,
}

/// The asm program, projected ONCE per compile and never per step, as `TmProgram` is.
///
/// **THE LISTING IS `print_instr`'S TEXT, AND SO IS `TmProgram.listing`.** Both views show the same program
/// from one printer — `SourceMap::tm_listing` is built the same way — so the asm view's line `pc5` and the
/// TM view's instruction 5 cannot read differently (spec §5.2).
///
/// **NO OWNERS.** Each instruction's Core node reaches JavaScript in `LinkIndex::asm_owner`, beside
/// `tm_owner`, for the reason `LinkIndex`'s own doc gives for one struct rather than an accessor per leg:
/// every leg's owners must come from one compile. `TmProgram` carries no owners for the same reason.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct AsmProgram {
    /// One line per `Program::code` index, as `print_instr` writes it: `cmpeq\tr1, r2, r3`.
    pub listing: Vec<String>,
    /// `Program::labels`: each label with the `listing` line it precedes.
    pub labels: Vec<(String, usize)>,
}

/// One step of the asm run, BOUNDED BY CONSTRUCTION: every list the run can grow is cut at a bound
/// `AsmWindow` supplies, and beside each cut list is the length it was cut from, so a view can say "+N
/// more" without the rest crossing (spec §5.3). `cells` and `boxes` are the one exception to "cut at the
/// bound", and they are bounded too — see their docs.
///
/// **`pc` IS WHERE THE MACHINE STANDS, `next` IS WHAT RUNS THERE, AND `source_node` IS ITS OWNER.** A frame
/// is built between two steps, after `step` instructions have completed. While the run can go on, `pc` is
/// the instruction about to run and `next` says so; once it has ended, `pc` is the instruction that halted
/// or faulted — `AsmCursor::pc` says which two faults leave it elsewhere — and `next` is `None`.
///
/// **ALL THREE REGISTER KINDS KEEP THEIR TAGS, AND THE LOCALS KEEP THEIR WRITTEN BITS.** A local whose bit is
/// clear holds a word the current frame did not write: the caller's, which `call` leaves in place, or a `0`
/// the bank grew past (`AsmCursor::written`). The view dims it as "left over from caller" (§6.3).
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct AsmState {
    /// Instructions completed — `AsmCursor::steps_taken`.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub step: u64,
    pub pc: usize,
    /// The instruction ABOUT TO RUN, `Some(pc)`, or `None` once the run has halted or faulted.
    ///
    /// IT NAMES WHAT HAPPENS NEXT, NOT WHAT PRODUCED THIS FRAME. A frame is built after a step, so the
    /// instruction at `pc` is the one the FOLLOWING step executes, and the listing marks that row "runs
    /// next" and follows it (spec §6.2). `None` after `halt` — `pc` stays on the `halt`, which has already
    /// run — and after a fault, whose instruction at `pc` did not complete and never will, is a real answer
    /// about why the run stopped, not a missing one.
    ///
    /// **NOT A SECOND COPY OF `pc`.** The two agree while the run can move and part once it has ended, which
    /// is the case a view must not mark "runs next": a halted program's last row did run, and a faulted
    /// program's last row never will.
    ///
    /// `Some` DOES NOT PROMISE THE CURSOR WILL STEP, `TmState::rule`'s caveat one leg over: at a spent cap
    /// `AsmCursor::next` refuses before it runs anything, so this names an instruction the very next
    /// `next()` will not execute.
    ///
    /// THAT IS DELIBERATE, AND ANSWERING `None` THERE WOULD BE WORSE. A step cap is raiseable, so a run
    /// sitting at one is PAUSED, not finished, and the instruction at `pc` is exactly what runs once the cap
    /// moves; `None` would make a paused run read as a halted one, the conflation `TmState::rule`'s doc
    /// refuses for the same reason. A stack, heap or memory cap cannot be raised, and it answers `Some` all
    /// the same: the instruction at `pc` is the one the cap refused, which is where the run stands. Whether
    /// the cursor may step is the status's question, and a consumer that needs both asks both.
    pub next: Option<usize>,
    pub rr: AsmWord,
    /// The first `AsmWindow::locals` locals.
    pub locals: Vec<AsmWord>,
    /// Parallel to `locals`: whether the current frame has written each one.
    pub written: Vec<bool>,
    /// How many locals the cursor holds, however many `locals` shows.
    pub locals_len: usize,
    /// The first `AsmWindow::args` argument registers.
    pub args: Vec<AsmWord>,
    pub args_len: usize,
    /// The register the step that produced this frame wrote, spelled as the listing spells registers —
    /// `r3`, `a0`, `rr` — or `None` for a step that wrote none, and before the first step.
    ///
    /// **A NAME, NOT A `Reg`**, because a register crosses as the text the view matches it by, and
    /// `tm::asm`'s printer is the one place that text is made. `Reg` has no serde form and needs none.
    pub wrote: Option<String>,
    /// How many frames the stack holds, however many `frames` shows.
    pub depth: usize,
    /// The top `AsmWindow::frames` call frames, TOP FIRST.
    ///
    /// **TOP FIRST, SO THE WINDOW CUTS THE OLDEST.** The frame nearest the running instruction is the one
    /// its `ret` returns to, and the view reads the stack from there down (§6.4). `AsmCursor::stack` is
    /// oldest first, which in a window of 8 over `sum(1000)`'s 1,001 frames would show the program's first
    /// seven calls and nothing of where it is now.
    pub frames: Vec<AsmCallFrame>,
    /// How many cons cells the heap holds.
    pub heap_len: usize,
    /// The newest `AsmWindow::cells` cells, PLUS every cell a list-tagged word in `rr`, `locals` or `args`
    /// points at, each once, NEWEST FIRST — descending `cell`.
    ///
    /// **THE REGISTER-NAMED CELLS ARE WHAT MAKE THE VIEW'S BACK-REFERENCE WHOLE.** The heap panel writes
    /// `#57  57 → #56  ← r5`: cell 57, its head, its tail, and the list registers whose word is 57 (§6.5).
    /// A window of the newest cells alone drops a list a register built long ago and still holds — the list
    /// a loop walks, a callee's argument — so the register would read `#3` with no cell 3 to read. For a
    /// compiled program the tags are exact (`WordTag`'s doc), so every list register's cell is here and every
    /// back-reference the view draws is true.
    ///
    /// **ONLY THE REGISTERS THIS FRAME SHOWS NAME CELLS.** A list word in a local past `AsmWindow::locals`, or
    /// in a saved frame, is not on screen to be a back-reference, so it pulls in nothing, and the list stays
    /// bounded: at most `cells + locals + args + 1` entries. A value-tagged word pulls in nothing either,
    /// even when it equals some cell's number — that is the ambiguity the tags exist to resolve.
    pub cells: Vec<AsmCell>,
    /// How many boxes the machine holds.
    pub box_len: usize,
    /// The newest `AsmWindow::boxes` boxes, plus every box a box-tagged word in `rr`, `locals` or `args`
    /// names, each once, newest first — by `cells`' rule and for its reason.
    pub boxes: Vec<AsmBox>,
    /// The Core node whose lowering emitted instruction `pc`, through `SourceMap::asm_owner`. `None` with no
    /// map, for an instruction `defunc` minted, and for a `pc` past the program's end, where a fetch faulted.
    ///
    /// **A MAP MUST INDEX THE PROGRAM THE CURSOR RUNS**, which `SourceMap`'s asm half does for the program
    /// `tm::lower_program` returns — `sourcemap.rs`'s `asm_owner_covers_the_program_lower_program_returns`
    /// holds it — so a caller steps that program, or passes no map.
    pub source_node: Option<NodeId>,
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
    ///
    /// `map` supplies each state's instruction, the listing and the labels, and `None` leaves them empty:
    /// a copy or a reduced file has no program behind it. **A MAP MUST HAVE BEEN BUILT AT `width`**, since
    /// it answers by state name and names depend on the width (`SourceMap::tm_instr`).
    #[must_use]
    pub fn of(m: &Machine, width: usize, map: Option<&SourceMap>) -> TmProgram {
        let states = m
            .states
            .iter()
            .map(|s| StateView {
                name: s.name.clone(),
                accept: s.accept,
                instr: map.and_then(|m| m.tm_instr(&s.name)),
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
        TmProgram {
            states,
            alphabet: m.alphabet(),
            tapes: m.tapes,
            width,
            start: m.start,
            listing: map.map(|m| m.tm_listing.clone()).unwrap_or_default(),
            labels: map.map(|m| m.tm_labels.clone()).unwrap_or_default(),
        }
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

/// `LambdaState::spans` on the wire: one byte string, three little-endian `u32`s a span (start, end, class index), and
/// back.
///
/// **A SPAN PAST `u32::MAX` IS AN ERROR, NOT A WRAP.** A frame's text is bounded by the byte budget its renderer
/// passes, so no frame the app builds comes near; a caller rendering with `usize::MAX` on a text of 4 GiB gets an error
/// from the serializer rather than offsets that point somewhere else. On the way back, a length that is not a whole
/// number of spans, a class index `TokenClass::from_index` has no class for, and a start past its end are errors too.
#[cfg(feature = "serde")]
mod span_words {
    use serde::de::Error as _;
    use serde::ser::Error as _;
    use serde::{Deserializer, Serializer};

    use crate::analysis::TokenClass;
    use crate::span::Span;

    pub(super) fn serialize<S: Serializer>(spans: &[(Span, TokenClass)], s: S) -> Result<S::Ok, S::Error> {
        let mut out = Vec::with_capacity(spans.len() * 12);
        for (span, class) in spans {
            for word in [span.start, span.end, *class as usize] {
                let word = u32::try_from(word).map_err(|_| S::Error::custom("a span offset past u32::MAX"))?;
                out.extend_from_slice(&word.to_le_bytes());
            }
        }
        s.serialize_bytes(&out)
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<(Span, TokenClass)>, D::Error> {
        let bytes = serde_bytes_or_seq(d)?;
        if bytes.len() % 12 != 0 {
            return Err(D::Error::custom("span bytes are not a whole number of spans"));
        }
        let word = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
        (0..bytes.len())
            .step_by(12)
            .map(|i| {
                let class =
                    TokenClass::from_index(word(i + 8)).ok_or_else(|| D::Error::custom("no such token class"))?;
                let (start, end) = (word(i), word(i + 4));
                if start > end {
                    return Err(D::Error::custom("a span whose start is past its end"));
                }
                Ok((Span::new(start, end), class))
            })
            .collect()
    }

    /// The bytes, whichever way the format wrote them: `serde_json` as an array of numbers, a binary format as bytes.
    fn serde_bytes_or_seq<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        struct Bytes;
        impl<'de> serde::de::Visitor<'de> for Bytes {
            type Value = Vec<u8>;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("span bytes")
            }
            fn visit_bytes<E: serde::de::Error>(self, v: &[u8]) -> Result<Self::Value, E> {
                Ok(v.to_vec())
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
                let mut out = Vec::with_capacity(seq.size_hint().unwrap_or(0));
                while let Some(b) = seq.next_element::<u8>()? {
                    out.push(b);
                }
                Ok(out)
            }
        }
        d.deserialize_bytes(Bytes)
    }
}

/// `TmState::window` on the wire: one string a tape, a cell a character, and back.
#[cfg(feature = "serde")]
mod tape_windows {
    use serde::{Deserialize, Deserializer, Serializer};

    use crate::tm::Symbol;

    pub(super) fn serialize<S: Serializer>(windows: &[Vec<Symbol>], s: S) -> Result<S::Ok, S::Error> {
        s.collect_seq(windows.iter().map(|tape| tape.iter().collect::<String>()))
    }

    pub(super) fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Vec<Symbol>>, D::Error> {
        Ok(Vec::<String>::deserialize(d)?.into_iter().map(|tape| tape.chars().collect()).collect())
    }
}

impl AsmProgram {
    /// Project `p` once — see the module doc; this is built per compile, never per step.
    #[must_use]
    pub fn of(p: &Program) -> AsmProgram {
        AsmProgram { listing: p.code.iter().map(print_instr).collect(), labels: p.labels.clone() }
    }
}

impl AsmWord {
    fn of(word: u64, tag: WordTag) -> AsmWord {
        AsmWord { word: word.to_string(), tag }
    }
}

/// The first `n` of `words`, each with the tag at its index. `get`, never `[]`: the cursor keeps the two
/// parallel, and a tag it did not have reads as `WordTag`'s default, as the cursor's own reads do.
fn tagged(words: &[u64], tags: &[WordTag], n: usize) -> Vec<(u64, WordTag)> {
    words.iter().take(n).enumerate().map(|(i, w)| (*w, tags.get(i).copied().unwrap_or_default())).collect()
}

/// The 0-based slot a 1-based list word or box handle names among `len`, or `None` for the null word 0 and
/// for a word past the end.
///
/// **UNREACHABLE PAST THE END FROM A REAL RUN, AND REFUSED RATHER THAN INDEXED ANYWAY.** A list-tagged word
/// comes from `cons`, which returns the heap's new length, from `nil`, or from an instruction that copies
/// one; the heap never shrinks; so every list word names a cell that exists, and boxes likewise. The check
/// stays because `window` is a library path a renderer calls per step, and `TmState::window`'s rule holds
/// here: no word it could be handed may abort the process. `usize::try_from` routes a word a 32-bit target
/// cannot index to the same `None`, as `AsmCursor`'s own cell lookup does.
fn slot(word: u64, len: usize) -> Option<usize> {
    let i = usize::try_from(word.checked_sub(1)?).ok()?;
    (i < len).then_some(i)
}

/// The slots a heap or box window shows, ascending: the newest `newest` of `len`, plus the slot each of
/// `named` points at. A set, so a cell both new and named appears once.
fn shown(len: usize, newest: usize, named: impl IntoIterator<Item = u64>) -> BTreeSet<usize> {
    let mut out: BTreeSet<usize> = (len.saturating_sub(newest)..len).collect();
    out.extend(named.into_iter().filter_map(|w| slot(w, len)));
    out
}

impl AsmState {
    /// The cursor's machine between two steps, cut to `window` — never the whole machine (see the struct
    /// doc for what each field carries and why each list is cut where it is).
    ///
    /// `map` RESOLVES `source_node` AND IS USED FOR NOTHING ELSE, as in `TmState::window`, and `Option` for
    /// that function's reason: a program no lowering produced — one written or edited by hand — has no map,
    /// and `source_node` becomes `None` on exactly the path where it has no meaning.
    ///
    /// **THE COST IS THE WINDOW'S, NOT THE MACHINE'S.** Each register list, each frame and each saved bank is
    /// read through `take`, and the heap and boxes are indexed only at the slots `shown` picks, so a frame of
    /// `sum(1000)` at its deepest reads eight of its 1,001 saved banks.
    pub fn window<P: Borrow<Program>>(c: &AsmCursor<P>, map: Option<&SourceMap>, window: AsmWindow) -> AsmState {
        let locals = tagged(c.locals(), c.local_tags(), window.locals);
        let args = tagged(c.args(), c.arg_tags(), window.args);
        let rr = (c.rr(), c.rr_tag());
        // The registers this frame shows, which are the only ones whose words pull a cell or a box into
        // it — see `cells`' doc.
        let shown_regs = || locals.iter().chain(&args).chain([&rr]).copied();
        let named = |tag: WordTag| shown_regs().filter(move |(_, t)| *t == tag).map(|(w, _)| w);

        let frames = c
            .stack()
            .iter()
            .rev()
            .take(window.frames)
            .map(|f| AsmCallFrame {
                ret_pc: f.ret_pc,
                saved: words(&tagged(&f.saved_locals, &f.saved_tags, window.locals)),
                saved_len: f.saved_locals.len(),
            })
            .collect();

        // Descending, so newest first; `get` again, so a slot `shown` picked cannot index past the end.
        let conses = c.heap();
        let cells = shown(conses.len(), window.cells, named(WordTag::List))
            .into_iter()
            .rev()
            .filter_map(|i| {
                let (head, tail) = *conses.get(i)?;
                let (head_tag, tail_tag) = c.heap_tags().get(i).copied().unwrap_or_default();
                Some(AsmCell { cell: i + 1, head: AsmWord::of(head, head_tag), tail: AsmWord::of(tail, tail_tag) })
            })
            .collect();
        let held = c.boxes();
        let boxes = shown(held.len(), window.boxes, named(WordTag::Box))
            .into_iter()
            .rev()
            .filter_map(|i| {
                let content = *held.get(i)?;
                let tag = c.box_tags().get(i).copied().unwrap_or_default();
                Some(AsmBox { handle: i + 1, content: AsmWord::of(content, tag) })
            })
            .collect();

        AsmState {
            step: c.steps_taken(),
            pc: c.pc(),
            next: match c.status() {
                None | Some(AsmStatus::Capped(_)) => Some(c.pc()),
                Some(AsmStatus::Halted | AsmStatus::Faulted(_)) => None,
            },
            rr: AsmWord::of(rr.0, rr.1),
            written: c.written().iter().take(window.locals).copied().collect(),
            locals: words(&locals),
            locals_len: c.locals().len(),
            args: words(&args),
            args_len: c.args().len(),
            wrote: c.wrote().map(reg_str),
            depth: c.stack().len(),
            frames,
            heap_len: conses.len(),
            cells,
            box_len: held.len(),
            boxes,
            source_node: map.and_then(|m| m.asm_owner(c.pc())),
        }
    }
}

/// `tagged`'s pairs as the words a frame carries.
fn words(pairs: &[(u64, WordTag)]) -> Vec<AsmWord> {
    pairs.iter().map(|(w, t)| AsmWord::of(*w, *t)).collect()
}

/// The step-0 half of linking one construct across the panes, built ONCE PER COMPILE.
///
/// **THE λ VIEW NO LONGER LINKS THROUGH THIS (Plan 7 part 4a).** It links through the tree it draws,
/// `LambdaTree`'s per-node `link`, at whatever step it shows. `lambda_spans` and `lambda_nodes` still
/// cross the wasm boundary but have no reader in the web app; what it reads here is the source spans,
/// the TM owners and `lambda_text`, the initial term a copy is seeded from.
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
/// **ONE STRUCT RATHER THAN AN ACCESSOR PER LEG**, because every leg must come from ONE compile. An
/// accessor per leg would be a chance per leg to hold one program's source index beside another
/// program's lambda index; the `NodeId`s would resolve, most of them to the wrong construct, and nothing
/// would notice. That is the failure `SourceMap` is shaped to remove by offering no `with_source` setter,
/// applied at the boundary instead of inside the map.
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
    /// **BUILT BY NAME, NOT BY FLATTENING `node_to_tm`.** `node_to_tm`'s `StateId`s index the machine the
    /// map itself lowered, and nothing checks that it is the machine `TmProgram.states` projects; a
    /// state's printed name is the association the map recorded where both were in hand. This is the
    /// same resolution `TmState::window` performs per step, hoisted to once per compile. **NAMES AGREE AT
    /// ONE WIDTH ONLY** — a wider machine has states no narrower one names — so a session builds its map
    /// at the width its run fitted (`SourceMap::tm_instr`'s doc).
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
    /// `LambdaTree::build` makes when its arena index would not fit `u32`.
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
    /// `asm_owner[i]` is the Core node whose lowering emitted instruction `i`, or `-1` — `SourceMap`'s
    /// `asm_owner` in the form `tm_owner` crosses to JavaScript in, and refused whole by the same rule when
    /// an id would not fit `i32`. It needs no `TmProgram`: the asm half is built apart from the machine.
    pub asm_owner: Vec<i32>,
}

impl LinkIndex {
    /// Build every leg from one compile.
    ///
    /// TOTAL OVER BOTH ABSENCES. A `None` term (the lambda backend declined this program) gives empty
    /// lambda legs rather than failing, and a `None` program (the TM backend declined) gives an empty
    /// `tm_owner`. `SourceMap::build` is already total over exactly these refusals, and the index must
    /// not be the layer that stops being. NARROWER REFUSALS join those two here, one per owner column: a
    /// `Some` program whose owner ids cannot all fit `i32` empties `tm_owner` rather than emitting a
    /// value that would misidentify a state's owner — see the field's own doc — and an instruction owner
    /// that cannot fit `i32` empties `asm_owner` by the same rule, with or without a program, since the
    /// asm column needs none.
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
        let asm_owner = map
            .asm_owner
            .iter()
            .map(|owner| match owner {
                None => Some(-1),
                Some(n) => i32::try_from(*n).ok(),
            })
            .collect::<Option<Vec<i32>>>()
            .unwrap_or_default();
        LinkIndex { lambda_text, lambda_spans, lambda_cut, lambda_nodes, source_nodes, tm_owner, asm_owner }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    /// No parse can mint a `NodeId` this large: `core::NodeGen::fresh` saturates at `core::MAX_NODE_ID`,
    /// which sits under `i32::MAX` so that this cast cannot fail — see both docs. That is exactly why this
    /// test builds the `SourceMap` fixture by hand instead of parsing a program: the refusal it pins is the
    /// defence in depth `tm_owner`'s doc keeps for a ceiling raised past `2^31`, and only a hand-built map
    /// reaches it.
    #[test]
    fn tm_owner_declines_the_whole_leg_rather_than_wrap_an_id_into_the_no_owner_sentinel() {
        let program = TmProgram {
            states: vec![
                // `s0`'s "owner" is `NodeId::MAX` (`u32::MAX`) — unrepresentable in `i32`, and the one
                // value whose wraparound lands exactly on the `-1` sentinel.
                StateView { name: "s0".to_string(), accept: false, rules: Vec::new(), instr: None },
                // `s1` has a real absence: no entry in `tm_name_to_node` at all.
                StateView { name: "s1".to_string(), accept: true, rules: Vec::new(), instr: None },
            ],
            alphabet: Vec::new(),
            tapes: 1,
            width: 1,
            start: 0,
            listing: Vec::new(),
            labels: Vec::new(),
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

    /// `asm_owner` refuses an id past `i32` the way `tm_owner` does, for the reason `tm_owner`'s own test
    /// gives: `u32::MAX` would wrap onto `-1` and read as "no owner". It refuses with a program and
    /// without one, as `LinkIndex::build` says, since the asm column needs none.
    #[test]
    fn asm_owner_declines_the_whole_leg_rather_than_wrap_an_id_into_the_no_owner_sentinel() {
        let map = SourceMap { asm_owner: vec![Some(NodeId::MAX), None], ..SourceMap::default() };
        let program = TmProgram {
            states: Vec::new(),
            alphabet: Vec::new(),
            tapes: 1,
            width: 1,
            start: 0,
            listing: Vec::new(),
            labels: Vec::new(),
        };
        for program in [None, Some(&program)] {
            let index = LinkIndex::build(None, program, &map, 0, 0);
            assert!(index.asm_owner.is_empty(), "with a program: {}, got {:?}", program.is_some(), index.asm_owner);
        }
    }

    /// A list word or box handle past the end names no slot, nor does `nil`'s 0, so `AsmState::window` shows
    /// no cell for such a word rather than indexing past the heap. No real run hands `window` one — `slot`'s
    /// doc says why — so a hand-made word is the only way to reach the refusal. Of the three named words
    /// only 2 is in range, and it names slot 1 beside the newest, slot 2.
    #[test]
    fn a_word_past_the_heap_names_no_cell() {
        assert_eq!(shown(3, 1, [0, 2, 4, u64::MAX]), BTreeSet::from([1, 2]));
        assert_eq!((slot(3, 3), slot(4, 3), slot(0, 3)), (Some(2), None, None));
        assert!(shown(0, 16, [1]).is_empty(), "an empty heap shows nothing, whatever a register says");
    }

    /// `span_words` READ AS A BINARY FORMAT READS IT, through `visit_bytes`, which `serde_json` never calls; and every
    /// way a byte string can fail to be spans is an error rather than a span. A start past its end among them:
    /// `Span::new` asserts against it in a debug build, so a decoder that handed it on would panic where it should
    /// refuse.
    #[cfg(feature = "serde")]
    #[test]
    fn span_words_reads_bytes_and_refuses_what_is_not_spans() {
        use serde::de::value::{BytesDeserializer, Error};
        let words = |w: [u32; 3]| w.iter().flat_map(|w| w.to_le_bytes()).collect::<Vec<u8>>();
        let read = |b: &[u8]| span_words::deserialize(BytesDeserializer::<Error>::new(b)).map_err(|e| e.to_string());

        assert_eq!(read(&words([0, 3, 3])), Ok(vec![(Span::new(0, 3), TokenClass::Keyword)]));
        assert_eq!(read(&[]), Ok(vec![]));
        let refused = |b: &[u8], why: &str| assert!(read(b).is_err_and(|e| e.contains(why)), "{b:?}: {:?}", read(b));
        refused(&words([0, 3, 3])[..11], "not a whole number of spans");
        refused(&words([0, 3, 14]), "no such token class");
        refused(&words([5, 3, 0]), "a span whose start is past its end");
    }

    /// The other direction's one refusal: an offset that does not fit the `u32` a span is written in.
    #[cfg(all(feature = "serde", target_pointer_width = "64"))]
    #[test]
    fn span_words_refuses_an_offset_past_u32_max() {
        let past = usize::try_from(u64::from(u32::MAX) + 1).expect("a 64-bit usize");
        let wrote = span_words::serialize(&[(Span::new(0, past), TokenClass::Ident)], serde_json::value::Serializer);
        assert!(wrote.is_err_and(|e| e.to_string().contains("a span offset past u32::MAX")));
    }
}
