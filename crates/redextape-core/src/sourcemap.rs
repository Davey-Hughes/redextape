//! The sync anchor (§5.4): `NodeId` -> λ-subterm path, and `NodeId` -> TM state block. Both maps are
//! keyed to Core node ids, which is what lets the UI light the same construct in three panes at once.
//!
//! THE TM HALF ADDS NO LOWERING. It inverts the chain the 2026-07-24 slice already shipped:
//! `lower_tm_mapped` gives `state -> code index`, `lower_asm_mapped` gives `code index -> NodeId`.
//! `attribute.rs` composes these forwards to attribute step counts; this inverts the same composition.
//!
//! THE NAME INDEX IS NOT A THIRD HALF. `tm_name_to_node` is `node_to_tm` inverted through the very
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
//! `lower_asm` emits NO instruction for — a transparent `Let`/`Seq` binder, a `Lambda`, the callee
//! `Var` of a statically-resolved OR builtin call, or a `Var` whose resolved register is already the
//! destination it would be moved into (`if src != dst` at `lower_asm.rs:321`, reached directly from an
//! `Assign` to that name or through `If`/`Let`/`Seq` destination propagation) — maps to `None`: THE MAP
//! SAYS NOTHING WHERE THE LOWERING SAID NOTHING. It does not fall back to a surrounding block. A
//! caller that wants "nearest enclosing block" for highlighting computes that at its own call site,
//! where it reads as the UI heuristic it is rather than as map data.
//! `tests/sourcemap_coverage.rs` pins both halves of that boundary.

use std::collections::{BTreeMap, BTreeSet};

use crate::ast::Program;
use crate::core::{Core, NodeId};
use crate::lambda::{Path, lower_mapped};
use crate::span::Span;
use crate::tm::machine::StateId;
use crate::tm::{Encoding, LowerError, defunc_mapped, lower_asm_mapped, lower_tm_mapped};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SourceMap {
    pub node_to_lambda: BTreeMap<NodeId, Path>,
    pub node_to_tm: BTreeMap<NodeId, Vec<StateId>>,
    /// The TM half again, keyed by the state's printed NAME. Not a substitute for `node_to_tm`, which
    /// stays because a consumer may legitimately want the ids; this is the form something attributing
    /// printed text has to work in. See the module doc for why it is recorded rather than derived.
    pub tm_name_to_node: BTreeMap<String, NodeId>,
    /// `NodeId` -> the source text that produced it. Empty unless the map was built by
    /// `build_from_program`; see that constructor for why it offers no setter for this leg — though
    /// the field is `pub`, like the other two, so `map.node_to_source = other_spans` compiles and
    /// reintroduces the same mismatch a setter would.
    pub node_to_source: BTreeMap<NodeId, Span>,
}

impl SourceMap {
    /// Build both halves.
    ///
    /// TOTAL OVER BACKEND REFUSALS *AND* OVER DEPTH. A backend that *declines* this program contributes
    /// an empty half instead of aborting: the TM half handles `LowerError::TooDeep` and `Unsupported`
    /// explicitly (see `tm_half`), and a λ backend that returns `LowerError` leaves `node_to_lambda`
    /// empty.
    ///
    /// Depth is one of those refusals rather than a hole in them, which it was not until the λ lowering
    /// grew a guard of its own. Every recursive pass either side of this call is now bounded —
    /// `lower_asm::MAX_LOWER_DEPTH` and `defunc::MAX_DEFUNC_DEPTH` (580) on the TM side,
    /// `lambda::lower::MAX_LAMBDA_LOWER_DEPTH` (700) on the λ side — so the wide band of programs that
    /// parse and desugar cleanly and then nest far deeper than any backend can walk (a long list literal
    /// desugars to a `cons`-`Apply` spine, and `MAX_PARSE_DEPTH` counts only nested parens/blocks) yields
    /// empty halves instead of an uncatchable stack-overflow `SIGABRT`. That is the whole difference
    /// between a map a caller can rely on and one that can take the process — or the browser tab — with
    /// it. `build_is_total_on_a_core_too_deep_for_the_tm_lowering` pins it on an input past the depth at
    /// which the unguarded λ lowering used to abort.
    pub fn build(core: &Core, enc: &dyn Encoding) -> SourceMap {
        let (node_to_tm, tm_name_to_node) = tm_half(core, enc);
        SourceMap { node_to_lambda: lambda_half(core), node_to_tm, tm_name_to_node, node_to_source: BTreeMap::new() }
    }

    /// Both backend halves AND the source leg, from the one desugar that produced the `Core`.
    ///
    /// THE CONSTRUCTORS OFFER NO `with_source` SETTER, AND THAT IS THE DESIGN. A setter would let a
    /// caller attach one program's spans to a map built from another program's `Core`; the ids would
    /// resolve, most of them to the wrong construct, and nothing would notice. That is the same failure
    /// this module's TM name index was shaped to remove — see the module doc — and the same fix: record
    /// the association where both sides are in hand, so there is no second object to mismatch.
    /// `node_to_source` itself stays `pub`, like the other two legs, for a caller that legitimately
    /// needs to read it — the type does not, and cannot, enforce the no-setter design; only the
    /// constructors' shape does. Assigning the field directly (`map.node_to_source = other_spans`)
    /// compiles and reintroduces exactly the mismatch this paragraph describes.
    ///
    /// `build` remains for callers holding no `Program` (tests, examples, the oracle) and leaves
    /// `node_to_source` empty, staying total the way it already is over a λ backend that declines.
    pub fn build_from_program(program: &Program, enc: &dyn Encoding) -> (Core, SourceMap) {
        let (core, spans) = crate::desugar::desugar_mapped(program);
        let mut map = SourceMap::build(&core, enc);
        map.node_to_source = spans.into_iter().collect();
        (core, map)
    }

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
    pub fn tm_owner(&self, name: &str) -> Option<NodeId> {
        self.tm_name_to_node.get(name).copied()
    }

    /// The source text a Core node came from. `None` for a map built by `build`, which has no `Program`.
    pub fn source_span(&self, id: NodeId) -> Option<Span> {
        self.node_to_source.get(&id).copied()
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

fn tm_half(core: &Core, enc: &dyn Encoding) -> (BTreeMap<NodeId, Vec<StateId>>, BTreeMap<String, NodeId>) {
    // `attribute.rs`'s `lower_mapped`, error discrimination included: try the program as first-order
    // Core FIRST, retry through `defunc` only on `Unsupported`, and give up on `TooDeep` immediately —
    // a looser `or_else` would swallow it and replay a deep Core through `defunc`'s own recursive
    // passes. The match is exhaustive rather than wildcarded so a future `LowerError` variant must
    // decide here too. `build` is total, so each refusal yields an empty half instead of propagating.
    // The successful `lower_asm_mapped` is BOUND, not discarded: re-lowering a clone of the whole tree
    // to get the pair back is pure waste on the common (first-order) path.
    let (prog, origins, synthetic) = match lower_asm_mapped(core) {
        Ok((p, o)) => (p, o, BTreeSet::new()),
        Err(LowerError::Unsupported { .. }) => {
            let Ok((defunced, synthetic)) = defunc_mapped(core) else {
                return (BTreeMap::new(), BTreeMap::new());
            };
            let Ok((p, o)) = lower_asm_mapped(&defunced) else {
                return (BTreeMap::new(), BTreeMap::new());
            };
            (p, o, synthetic)
        }
        Err(LowerError::TooDeep { .. }) => return (BTreeMap::new(), BTreeMap::new()),
    };
    let (machine, state_origins) = lower_tm_mapped(&prog, enc);
    let mut out: BTreeMap<NodeId, Vec<StateId>> = BTreeMap::new();
    for state in 0..machine.states.len() {
        // `None` is machine scaffolding with no instruction behind it; skip rather than invent an owner.
        let Some(Some(code_index)) = state_origins.get(state) else {
            continue;
        };
        let Some(&node) = origins.get(*code_index) else {
            continue;
        };
        if synthetic.contains(&node) {
            continue;
        }
        out.entry(node).or_default().push(state as StateId);
    }
    // Nodes `lower_asm` emits nothing for are simply absent, and DELIBERATELY so — see the module doc.

    // Now the same claim keyed by name, taken from `out` rather than from the loop above so that the
    // FIRST claim on a name is settled in the order the block map records it — ascending node, then
    // ascending state — which is the order the removed caller-side inversion used. Duplicate names are
    // unreachable in a machine `lower_tm_mapped` builds, so the tie-break decides nothing today; it is
    // pinned anyway, because two fields describing one lowering must not be able to disagree.
    let mut names: BTreeMap<String, NodeId> = BTreeMap::new();
    for (node, block) in &out {
        for state in block {
            if let Some(s) = machine.states.get(*state as usize) {
                names.entry(s.name.clone()).or_insert(*node);
            }
        }
    }
    (out, names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::parser::parse;
    use crate::tm::Unary;

    fn core_of(src: &str) -> Core {
        let (p, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
        desugar(&p.unwrap())
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
        // `lower_asm_mapped` answers `TooDeep`. That is NOT the `Unsupported` that means "try defunc":
        // replaying this through `defunc`'s own recursive passes is what the depth guard exists to
        // prevent. The TM half is simply empty, and `build` still returns.
        //
        // 2048 IS A DEPTH THIS TEST COULD NOT USE BEFORE. It is above both backends' guards —
        // `MAX_LOWER_DEPTH` (580) and `lambda::lower::MAX_LAMBDA_LOWER_DEPTH` (700) — so BOTH halves
        // genuinely refuse, and it is past the ~1470 at which the once-unguarded λ lowering overflowed
        // an 8 MiB stack in a debug build. That overflow is an uncatchable `SIGABRT`, which is why this
        // test used to be pinned below it at 1024 and could only pin the TM half's refusal.
        //
        // It is still a bounded size, deliberately: the suite runs on 32 MiB threads, where an unguarded
        // lowering survives depth ~4000, so removing either guard fails this test rather than killing the
        // process.
        let src = format!("[{}]", (0..2048).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
        let core = core_of(&src);
        assert!(
            matches!(lower_asm_mapped(&core), Err(crate::tm::LowerError::TooDeep { .. })),
            "this program must reach the depth guard, or the test pins nothing"
        );
        let map = SourceMap::build(&core, &Unary::default());
        assert!(map.node_to_tm.is_empty(), "a program the TM lowering refuses has no TM half");
        assert!(map.node_to_lambda.is_empty(), "a program the λ lowering refuses has no λ half");
    }
}
