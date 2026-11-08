//! The sync anchor (§5.4): `NodeId` -> λ-subterm path, `NodeId` -> rxm instructions, and `NodeId` -> TM
//! state block. All three maps are keyed to Core node ids, which is what lets the UI light the same
//! construct in every pane at once.
//!
//! THE TM HALF ADDS NO LOWERING. It inverts the existing chain: `lower_tm_mapped` gives
//! `state -> code index`, `lower_rxm_mapped` gives `code index -> NodeId`. `attribute.rs` composes these
//! forwards to attribute step counts; this inverts the same composition.
//!
//! THE RXM HALF IS THE CHAIN'S MIDDLE LINK, KEPT. `lower_rxm_mapped`'s `code index -> NodeId` is what the
//! TM half composes through; `rxm_owner` records it on its own, because the rxm view links instructions
//! and a machine the TM refuses to lay out still has a program. So it is built before, and apart from,
//! the machine.
//!
//! THE NAME INDEX IS NOT A HALF OF ITS OWN. `tm_name_to_node` is `node_to_tm` inverted through the very
//! machine `tm_half` just lowered, kept because a state's identity in PRINTED text is its name, not its
//! id. Deriving it outside would mean a caller holding a `Machine` next to a `SourceMap` with nothing
//! checking the two came from one lowering — a map built at one encoding, indexed through a machine
//! lowered at another, resolves every id to some plausible name and mis-attributes most of them in
//! silence. Recording the association where the right machine is in hand removes the second object.
//!
//! THREE EXCLUSIONS ARE PRINCIPLED, NOT CONVENIENCE. Ids that `defunc` MINTED have no source
//! construct to point at — which is exactly why `defunc_mapped` returns that set — and are omitted
//! rather than mapped to a lie. Programs the λ backend DECLINES (it returns `LowerError` for a mutable
//! capture rather than risk a silent miscompile) simply have no λ half; `build` leaves `node_to_lambda`
//! empty for those instead of failing, so a TM-only program still gets a usable map. And a Core node
//! `lower_rxm` emits NO instruction for — a transparent `Let`/`Seq` binder, a `Lambda`, the callee
//! `Var` of a statically-resolved OR builtin call, or a `Var` whose resolved register is already the
//! destination it would be moved into (the `if src != dst` in `lower_rxm.rs`'s `lower_inner`, in its
//! `Core::Var` arm, reached directly from an `Assign` to that name or through `If`/`Let`/`Seq`
//! destination propagation) — maps to `None`: THE MAP SAYS NOTHING WHERE THE LOWERING SAID NOTHING.
//! It does not fall back to a surrounding block. A caller that wants "nearest enclosing block" for
//! highlighting computes that at its own call site, where it reads as the UI heuristic it is rather
//! than as map data. `tests/sourcemap_coverage.rs` pins both halves of that boundary.

use std::collections::BTreeMap;

use crate::ast::Program;
use crate::core::{Core, NodeId};
use crate::lambda::{Path, lower_mapped};
use crate::span::Span;
use crate::tm::machine::StateId;
use crate::tm::{Encoding, LowerError, Lowered, lower_program_mapped, lower_tm_mapped, print_instr};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SourceMap {
    pub node_to_lambda: BTreeMap<NodeId, Path>,
    pub node_to_tm: BTreeMap<NodeId, Vec<StateId>>,
    /// The TM half again, keyed by the state's printed NAME. Not a substitute for `node_to_tm`, which
    /// stays because a consumer may legitimately want the ids; this is the form something attributing
    /// printed text has to work in. See the module doc for why it is recorded rather than derived.
    pub tm_name_to_node: BTreeMap<String, NodeId>,
    /// `NodeId` -> the source text that produced it. Empty unless the map was built by
    /// `build_from_program` or `build_prepared`; see the first for why neither offers a setter — though
    /// the field is `pub`, like every other field, so `map.node_to_source = other_spans` compiles and
    /// reintroduces the same mismatch a setter would.
    pub node_to_source: BTreeMap<NodeId, Span>,
    /// The `prog.code` index each state was built for, keyed by the state's printed NAME as
    /// `tm_name_to_node` is. A state with no instruction behind it — the shared return handler, the halt
    /// and overflow states — is absent, so `tm_instr` answers `None` for it. Unlike `tm_name_to_node`,
    /// states built for a construct `defunc` minted are present: they still belong to an instruction.
    pub tm_name_to_instr: BTreeMap<String, usize>,
    /// The rxm program the TM half built its machine from, one line per `prog.code` index, each as
    /// `print_instr` writes it. Empty when the TM half is. The indices `tm_name_to_instr` holds index this.
    pub tm_listing: Vec<String>,
    /// That program's labels, each with the `prog.code` index it precedes, in `prog.labels` order.
    pub tm_labels: Vec<(String, usize)>,
    /// `rxm_owner[i]` is the Core node whose lowering emitted instruction `i` of the program
    /// `tm::lower_program` returns, or `None` for a node `defunc` minted. Empty when the program does not
    /// lower. Unlike the TM half it needs no machine, so a program whose machine the TM refuses to lay out
    /// still has it.
    pub rxm_owner: Vec<Option<NodeId>>,
    /// `rxm_owner` inverted: each node's instructions, ascending. A node that owns none is absent.
    pub node_to_rxm: BTreeMap<NodeId, Vec<usize>>,
}

impl SourceMap {
    /// Build the three halves: λ, rxm and TM.
    ///
    /// TOTAL OVER BACKEND REFUSALS *AND* OVER DEPTH. A backend that *declines* this program contributes
    /// an empty half instead of aborting. The rxm half answers `LowerError::TooDeep` and `Unsupported`
    /// with no half (see `rxm_half`), and a program it refuses has no TM half either, since the machine is
    /// built from its program; a machine the TM refuses to lay out empties the TM half alone; and a λ
    /// backend that returns `LowerError` leaves `node_to_lambda` empty.
    ///
    /// Depth is one of those refusals rather than a hole in them. Every recursive pass either side of
    /// this call is bounded — `lower_rxm::MAX_LOWER_DEPTH` and `defunc::MAX_DEFUNC_DEPTH` (580) on the TM
    /// side, `lambda::lower::MAX_LAMBDA_LOWER_DEPTH` (700) on the λ side — so the wide band of programs
    /// that parse and desugar cleanly and then nest far deeper than any backend can walk (a long list
    /// literal desugars to a `cons`-`Apply` spine, and `MAX_PARSE_DEPTH` counts only nested
    /// parens/blocks) yields empty halves instead of an uncatchable stack-overflow `SIGABRT`. That is the
    /// whole difference between a map a caller can rely on and one that can take the process — or the
    /// browser tab — with it. `build_is_total_on_a_core_too_deep_for_the_tm_lowering` pins it on an input
    /// past the depth at which an unguarded λ lowering would abort.
    pub fn build(core: &Core, enc: &dyn Encoding) -> SourceMap {
        build_over(core, rxm_half(core).as_ref(), enc)
    }

    /// Every backend half — λ, rxm and TM — AND the source leg, from the one desugar that produced the
    /// `Core`.
    ///
    /// THE CONSTRUCTORS OFFER NO `with_source` SETTER, AND THAT IS THE DESIGN. A setter would let a
    /// caller attach one program's spans to a map built from another program's `Core`; the ids would
    /// resolve, most of them to the wrong construct, and nothing would notice. That is the same failure
    /// this module's TM name index was shaped to remove — see the module doc — and the same fix: record
    /// the association where both sides are in hand, so there is no second object to mismatch.
    /// `node_to_source` itself stays `pub`, like every other field, for a caller that legitimately
    /// needs to read it — the type does not, and cannot, enforce the no-setter design; only the
    /// constructors' shape does. Assigning the field directly (`map.node_to_source = other_spans`)
    /// compiles and reintroduces exactly the mismatch this paragraph describes.
    ///
    /// `build` remains for callers holding no `Program` (tests, examples, the oracle) and leaves
    /// `node_to_source` empty, staying total the way it already is over a λ backend that declines.
    pub fn build_from_program(program: &Program, enc: &dyn Encoding) -> (Core, SourceMap) {
        let prepared = Prepared::new(program);
        let map = SourceMap::build_prepared(&prepared, enc);
        (prepared.into_parts().0, map)
    }

    /// `build_from_program` over a `Prepared` the caller keeps, so the map and the backends the caller
    /// runs from `p` share one desugar and one lowering. The source leg is `p`'s own, for the reason
    /// `build_from_program` gives.
    #[must_use]
    pub fn build_prepared(p: &Prepared, enc: &dyn Encoding) -> SourceMap {
        let mut map = build_over(&p.core, p.lowered.as_ref().ok(), enc);
        map.node_to_source = p.spans.iter().copied().collect();
        map
    }

    #[must_use]
    pub fn lambda_path(&self, id: NodeId) -> Option<&Path> {
        self.node_to_lambda.get(&id)
    }

    pub fn tm_block(&self, id: NodeId) -> Option<&[StateId]> {
        self.node_to_tm.get(&id).map(Vec::as_slice)
    }

    /// The Core node that produced the state printed as `name`. `None` for machine scaffolding, for
    /// `defunc`-minted constructs, and for any name THIS lowering never produced — including every name
    /// belonging to some other lowering of the same program. The map says nothing where the lowering
    /// said nothing: there is deliberately no fallback to a nearby or similarly-spelled state.
    #[must_use]
    pub fn tm_owner(&self, name: &str) -> Option<NodeId> {
        self.tm_name_to_node.get(name).copied()
    }

    /// The `prog.code` index — a line of `tm_listing` — whose gadgets built the state printed as `name`.
    /// `None` for machine scaffolding and for any name this lowering never produced, with no fallback, as
    /// `tm_owner`.
    ///
    /// **NAMES DEPEND ON THE FIELD WIDTH**, so this answers for the machine lowered at the width `build`
    /// was handed and for no other: a wider machine has states no narrower one names. A caller asking
    /// about a machine it ran builds the map at the width that run fitted.
    #[must_use]
    pub fn tm_instr(&self, name: &str) -> Option<usize> {
        self.tm_name_to_instr.get(name).copied()
    }

    /// The Core node whose lowering emitted instruction `i`. `None` for an instruction a `defunc`-minted
    /// node emitted and for an index past the program's end.
    #[must_use]
    pub fn rxm_owner(&self, i: usize) -> Option<NodeId> {
        self.rxm_owner.get(i).copied().flatten()
    }

    /// The instructions a Core node's lowering emitted, ascending. `None` for a node that emitted none.
    #[must_use]
    pub fn rxm_block(&self, id: NodeId) -> Option<&[usize]> {
        self.node_to_rxm.get(&id).map(Vec::as_slice)
    }

    /// The source text a Core node came from. `None` for a map built by `build`, which has no `Program`.
    #[must_use]
    pub fn source_span(&self, id: NodeId) -> Option<Span> {
        self.node_to_source.get(&id).copied()
    }
}

/// One desugar of a `Program` and one lowering of its `Core`, for a caller that builds a map AND runs
/// the backends from them. The fields are private so the source leg can only come from the desugar that
/// made `core`, and the rxm and TM halves only from the lowering of that `core`.
#[derive(Debug)]
pub struct Prepared {
    core: Core,
    spans: Vec<(NodeId, Span)>,
    lowered: Result<Lowered, LowerError>,
}

impl Prepared {
    /// `desugar_mapped`, then `tm::lower_program_mapped` over the `Core` it made.
    #[must_use]
    pub fn new(program: &Program) -> Prepared {
        let (core, spans) = crate::desugar::desugar_mapped(program);
        let lowered = lower_program_mapped(&core);
        Prepared { core, spans, lowered }
    }

    #[must_use]
    pub fn core(&self) -> &Core {
        &self.core
    }

    /// The lowering, the one `tm::lower_program` would return the program of.
    ///
    /// # Errors
    ///
    /// The `LowerError` `tm::lower_program_mapped` returned for this `Core`.
    pub fn lowered(&self) -> Result<&Lowered, &LowerError> {
        self.lowered.as_ref()
    }

    pub fn into_parts(self) -> (Core, Result<Lowered, LowerError>) {
        (self.core, self.lowered)
    }
}

/// `build`'s and `build_prepared`'s one body, over a lowering of `core` or `None` for a refused one.
fn build_over(core: &Core, rxm: Option<&Lowered>, enc: &dyn Encoding) -> SourceMap {
    let tm = rxm.map_or_else(TmHalf::default, |a| tm_half(a, enc));
    let rxm_owner: Vec<Option<NodeId>> = rxm.map(owners).unwrap_or_default();
    let mut node_to_rxm: BTreeMap<NodeId, Vec<usize>> = BTreeMap::new();
    for (i, owner) in rxm_owner.iter().enumerate() {
        if let Some(node) = owner {
            node_to_rxm.entry(*node).or_default().push(i);
        }
    }
    SourceMap {
        node_to_lambda: lambda_half(core),
        node_to_tm: tm.node_to_tm,
        tm_name_to_node: tm.name_to_node,
        node_to_source: BTreeMap::new(),
        tm_name_to_instr: tm.name_to_instr,
        tm_listing: tm.listing,
        tm_labels: tm.labels,
        rxm_owner,
        node_to_rxm,
    }
}

fn lambda_half(core: &Core) -> BTreeMap<NodeId, Path> {
    // A node may be recorded more than once (a construct can appear in several lowered positions);
    // keep the FIRST, which is the leftmost-outermost occurrence and the one a reader expects.
    let mut out = BTreeMap::new();
    if let Ok((_, pairs)) = lower_mapped(core) {
        for (id, path) in pairs {
            out.entry(id).or_insert(path);
        }
    }
    out
}

/// Each instruction's owner: the node that emitted it, or `None` for a node `defunc` minted, which names
/// no source construct.
fn owners(lowered: &Lowered) -> Vec<Option<NodeId>> {
    lowered.origins.iter().map(|n| (!lowered.synthetic.contains(n)).then_some(*n)).collect()
}

/// `tm::lower_program_mapped`, the one lowering `tm::lower_program` returns the program of. `build` is
/// total, so a refusal is `None` rather than an error.
fn rxm_half(core: &Core) -> Option<Lowered> {
    lower_program_mapped(core).ok()
}

/// Everything `tm_half` records about one lowering: the two owner indexes, the instruction index, and
/// the listing and labels those instruction indices point into. `Default` is the empty half every
/// refusal returns.
#[derive(Default)]
struct TmHalf {
    node_to_tm: BTreeMap<NodeId, Vec<StateId>>,
    name_to_node: BTreeMap<String, NodeId>,
    name_to_instr: BTreeMap<String, usize>,
    listing: Vec<String>,
    labels: Vec<(String, usize)>,
}

fn tm_half(rxm: &Lowered, enc: &dyn Encoding) -> TmHalf {
    let Lowered { program: prog, origins, synthetic } = rxm;
    // `None` is any of `lower_tm_mapped`'s four layout refusals (`MAX_SLOTS`, `MAX_FRAME_LOC`,
    // `MAX_MUL_INSTRS`, `MAX_MACHINE_STATES`; see its doc). NONE of the four is re-derived here:
    // `rxm_half` handles a different error entirely, `LowerError`'s `Unsupported`/`TooDeep` from
    // `tm::lower_program_mapped`. All four layout refusals arrive here, at this single `else`,
    // deferred whole to `lower_tm_mapped`'s own `Option` — there is nothing here that could drift from
    // what it checks. It gives back empty TM maps, as `build` does when `rxm_half` refuses: a refused
    // program built no machine, so there is no state to own anything. The rxm half is unaffected — the
    // program still lowered.
    let Some((machine, state_origins)) = lower_tm_mapped(prog, enc) else {
        return TmHalf::default();
    };
    let mut out: BTreeMap<NodeId, Vec<StateId>> = BTreeMap::new();
    let mut name_to_instr: BTreeMap<String, usize> = BTreeMap::new();
    for state in 0..machine.states.len() {
        // `None` is machine scaffolding with no instruction behind it; skip rather than invent an owner.
        let Some(Some(code_index)) = state_origins.get(state) else {
            continue;
        };
        // BEFORE THE `synthetic` SKIP BELOW: a state built for a construct `defunc` minted has no owner
        // to name, but it was still built for this instruction.
        if let Some(s) = machine.states.get(state) {
            name_to_instr.entry(s.name.clone()).or_insert(*code_index);
        }
        let Some(&node) = origins.get(*code_index) else {
            continue;
        };
        if synthetic.contains(&node) {
            continue;
        }
        // `state` is a loop index over `machine.states`, a `Vec<State>` this function only ever gets
        // from `lower_tm_mapped` — built via `Builder::state`/`accept` (push-only, one call per
        // state) and nothing else. Both enforce `MAX_MACHINE_STATES`, which is 4,295x under
        // `StateId::MAX`, so the narrowing cannot truncate. The `#[allow]` stays only because clippy
        // cannot see a guard two modules away.
        #[allow(clippy::cast_possible_truncation)]
        out.entry(node).or_default().push(state as StateId);
    }
    // Nodes `lower_rxm` emits nothing for are simply absent, and DELIBERATELY so — see the module doc.

    // Now the same claim keyed by name, taken from `out` rather than from the loop above so that the
    // FIRST claim on a name is settled in the order the block map records it — ascending node, then
    // ascending state. Duplicate names are unreachable in a machine `lower_tm_mapped` builds, so the
    // tie-break decides nothing today; it is pinned anyway, because two fields describing one lowering
    // must not be able to disagree.
    let mut names: BTreeMap<String, NodeId> = BTreeMap::new();
    for (node, block) in &out {
        for state in block {
            if let Some(s) = machine.states.get(*state as usize) {
                names.entry(s.name.clone()).or_insert(*node);
            }
        }
    }
    let listing = prog.code.iter().map(print_instr).collect();
    TmHalf { node_to_tm: out, name_to_node: names, name_to_instr, listing, labels: prog.labels.clone() }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::tm::{Unary, lower_rxm_mapped};

    fn core_of(src: &str) -> Core {
        let (p, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
        desugar(&p.unwrap())
    }

    fn map_of(src: &str) -> (Core, SourceMap) {
        let (p, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
        SourceMap::build_from_program(&p.unwrap(), &Unary::default())
    }

    /// First-order: every instruction has an owner.
    const FACT: &str = "fn fact(n) { if n == 0 { 1 } else { n * fact(n - 1) } } fact(3)";

    /// Higher-order, so it lowers through `defunc`: 17 of its 54 instructions come from nodes `defunc`
    /// minted, and have no owner.
    const MAP: &str = "fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } \
                       map([3, 1, 2], |x| x + 1)";

    /// The rxm half describes the program `tm::lower_program` returns, one owner per instruction, and the TM
    /// half's listing is that same program: on `FACT`, which lowers first-order, and on `MAP`, which lowers
    /// through `defunc`. Tests and examples pair a map with a program they lowered apart from it, so both
    /// branches of `tm::lower_program_mapped` answer here to `lower_program` itself; the web session hands its
    /// map, its TM run and its rxm leg one `Prepared`. In the first-order program every instruction has an
    /// owner, and every owner is a construct with source.
    #[test]
    fn rxm_owner_covers_the_program_lower_program_returns() {
        for src in [FACT, MAP] {
            let (core, map) = map_of(src);
            let prog = crate::tm::lower_program(&core).expect("the sample lowers");
            let listing: Vec<String> = prog.code.iter().map(print_instr).collect();
            assert_eq!((map.rxm_owner.len(), &map.tm_listing), (prog.code.len(), &listing), "{src}");
        }
        let (_, map) = map_of(FACT);
        for (i, owner) in map.rxm_owner.iter().enumerate() {
            let node = owner.unwrap_or_else(|| panic!("instruction {i} has no owner in a first-order program"));
            assert!(map.source_span(node).is_some(), "instruction {i}'s owner {node} has no source");
        }
    }

    /// Each instruction's owner is the construct that emitted it, read back as the source text of its
    /// span. The rows are measured from this sample's listing; a permuted or shifted `rxm_owner` still has
    /// one owner per instruction and still inverts cleanly, and fails only here.
    #[test]
    fn each_instruction_is_owned_by_the_construct_that_emitted_it() {
        let src = FACT;
        let (core, map) = map_of(src);
        let prog = crate::tm::lower_program(&core).expect("the sample lowers");
        let row = |i: usize| {
            let line = prog.code.get(i).map(print_instr);
            let text = map.rxm_owner(i).and_then(|n| map.source_span(n)).map(|s| &src[s.start..s.end]);
            (line, text)
        };
        for (i, line, owner) in [
            (4, "cmpeq\tr1, r2, r3", "n == 0"),
            (11, "sub\tr6, r7, r8", "n - 1"),
            (15, "mul\trr, r4, r5", "n * fact(n - 1)"),
            (17, "li\tr0, #3", "3"),
            (19, "call\tfact.0", "fact(3)"),
        ] {
            assert_eq!(row(i), (Some(line.to_string()), Some(owner)), "instruction {i}");
        }
    }

    /// `defunc` mints constructs no one wrote; the instructions they emit have no owner, and every
    /// instruction that does have one points at source. 17 of its 54 instructions are minted, so an
    /// `rxm_owner` that dropped every owner of a program `defunc` touched fails too.
    #[test]
    fn instructions_defunc_minted_have_no_owner() {
        let (_, map) = map_of(MAP);
        let unowned = map.rxm_owner.iter().filter(|o| o.is_none()).count();
        assert_eq!((unowned, map.rxm_owner.len()), (17, 54), "unowned and total instructions on `MAP`");
        for (i, node) in map.rxm_owner.iter().enumerate().filter_map(|(i, o)| Some((i, (*o)?))) {
            assert!(map.source_span(node).is_some(), "instruction {i}'s owner {node} was minted");
        }
    }

    /// `node_to_rxm` holds exactly `rxm_owner`'s claims, inverted, each block ascending — and `rxm_block`
    /// and `rxm_owner` read them back. On `MAP` some instructions have no owner, and they are in no block.
    #[test]
    fn node_to_rxm_inverts_rxm_owner() {
        for src in [FACT, MAP] {
            let (_, map) = map_of(src);
            let forward: BTreeSet<(NodeId, usize)> =
                map.rxm_owner.iter().enumerate().filter_map(|(i, o)| Some(((*o)?, i))).collect();
            let inverted: Vec<(NodeId, usize)> =
                map.node_to_rxm.iter().flat_map(|(n, is)| is.iter().map(move |i| (*n, *i))).collect();
            assert_eq!(inverted.len(), forward.len(), "{src}: an instruction claimed twice, or dropped");
            assert_eq!(inverted.iter().copied().collect::<BTreeSet<_>>(), forward, "{src}");
            for (node, block) in &map.node_to_rxm {
                assert!(block.is_sorted(), "{src}: {node}'s block is not ascending");
                assert_eq!(map.rxm_block(*node), Some(&block[..]), "{src}");
                assert!(block.iter().all(|i| map.rxm_owner(*i) == Some(*node)), "{src}");
            }
        }
        let (_, map) = map_of(MAP);
        assert!(map.rxm_owner.iter().any(Option::is_none), "`MAP` must have unowned instructions, or it adds nothing");
    }

    /// A program the TM refuses to lay out still lowers, so it keeps its rxm half: 33 multiplications is
    /// one past `MAX_MUL_INSTRS`, and the TM maps come back empty while every instruction is owned.
    #[test]
    fn the_rxm_half_survives_a_machine_the_tm_refuses() {
        let src = vec!["1"; 34].join(" * ");
        let (core, map) = map_of(&src);
        assert!(map.node_to_tm.is_empty() && map.tm_listing.is_empty(), "the TM must refuse this machine");
        let prog = crate::tm::lower_program(&core).expect("the sample lowers");
        assert_eq!(map.rxm_owner.len(), prog.code.len());
        assert!(map.rxm_owner.iter().all(Option::is_some));
    }

    #[test]
    fn build_is_total_on_a_program_the_lambda_backend_declines() {
        // A mutable captured by a closure: the λ backend refuses this (risk of a silent miscompile
        // under call-by-value capture), but the TM backend defunctionalizes it and runs it. `build`
        // must not panic and must leave the λ half empty while the TM half is still usable.
        let src = "let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)";
        let core = core_of(src);
        let map = SourceMap::build(&core, &Unary::default());
        assert!(map.node_to_lambda.is_empty(), "the lambda backend declines this program");
        assert!(!map.node_to_tm.is_empty(), "the TM half must still be usable");
    }

    #[test]
    fn build_is_total_on_a_core_too_deep_for_the_tm_lowering() {
        // A long list literal desugars to a `cons`-`Apply` spine deeper than `MAX_LOWER_DEPTH`, so
        // `lower_rxm_mapped` answers `TooDeep`. That is NOT the `Unsupported` that means "try defunc":
        // replaying this through `defunc`'s own recursive passes is what the depth guard exists to
        // prevent. The TM half is simply empty, and `build` still returns.
        //
        // 2048 is above both backends' guards — `MAX_LOWER_DEPTH` (580) and
        // `lambda::lower::MAX_LAMBDA_LOWER_DEPTH` (700) — so BOTH halves genuinely refuse, and it is
        // past the ~1470 at which an unguarded λ lowering overflows an 8 MiB stack in a debug build.
        // That overflow is an uncatchable `SIGABRT`.
        //
        // It is still a bounded size, deliberately: the suite runs on 32 MiB threads, where an unguarded
        // lowering survives depth ~4000, so removing either guard fails this test rather than killing the
        // process.
        let src = format!("[{}]", (0..2048).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
        let core = core_of(&src);
        assert!(
            matches!(lower_rxm_mapped(&core), Err(crate::tm::LowerError::TooDeep { .. })),
            "this program must reach the depth guard, or the test pins nothing"
        );
        let map = SourceMap::build(&core, &Unary::default());
        assert!(map.node_to_tm.is_empty(), "a program the TM lowering refuses has no TM half");
        assert!(map.node_to_lambda.is_empty(), "a program the λ lowering refuses has no λ half");
    }
}
