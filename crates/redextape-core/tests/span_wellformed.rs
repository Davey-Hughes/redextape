//! Span invariants that must hold for every classifier, plus the highlight composition. A renderer
//! indexes the printed string with these spans, so a violation is a panic in the consumer, not a
//! cosmetic bug.
//!
//! THE ATTRIBUTION ASSERTIONS ARE DELIBERATELY NOT "SOME SPAN GOT AN ORIGIN". That is satisfied by a
//! composition that attributes one span and gets every other one wrong. What is pinned instead is
//! WHICH spans carry an origin (exactly the state-naming ones the map covers, both definitions and
//! `goto` references), WHICH node each one names (the block that node owns must really contain that
//! state), that one named construct owns exactly the states its own lowering produced, and that a
//! class collision — a tape symbol or a keyword spelled like a state name — is still not attributed.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::{BTreeMap, BTreeSet};

use redextape_core::Span;
use redextape_core::analysis::{Attributed, TokenClass, attribute_tm_spans, classify_source};
use redextape_core::core::{BinOp, Core, NodeId};
use redextape_core::lambda::{lower, print_lambda_mapped};
use redextape_core::sourcemap::SourceMap;
use redextape_core::tm::{
    Binary, EncodingKind, Machine, Move, Program, Rule, State, TmHeader, Unary, defunc, lower_asm, lower_tm,
    print_asm_mapped, print_tm_mapped, print_tm_with_mapped,
};
use redextape_core::ty::Ty;

mod common;
use common::core_of;

/// NO PROGRAM HERE CARRIES A `//` COMMENT, AND THAT RESTRICTION IS LOAD-BEARING FOR THE COVERAGE
/// ASSERTION IN `check`. `lexer.rs` discards comments, so `TokenKind` has no variant for them and
/// `classify_source` emits nothing over their bytes — a real, non-whitespace hole. That is a filed,
/// separately-scoped issue (item 4 of the Plan 4 deferral list in
/// `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`: trivia representation blocks `redextape fmt`
/// and `TokenClass::Comment` alike, and is to be settled once for both), not something to paper over
/// with a `is_comment` special case here. `source_with_a_comment_is_the_one_gap_this_corpus_avoids`
/// below states the hole outright, so extending this corpus to comments fails loudly rather than
/// quietly weakening the property. The printed forms are unaffected: no printer emits a comment.
/// THE `if` IS NOT DECORATION. The four straight-line programs lower to assembly with NO LABELS, so the
/// coverage assertion could not see the label `:` at all: deleting its classification left this whole
/// file green, which is how it was measured. A branch is the smallest program that emits one.
const CORPUS: &[&str] =
    &["1 + 2 * 3", "3 - 5", "let x = 1; let y = x + x; y * 3", "[1, 2, 3]", "if 2 > 1 { 10 } else { 20 }"];

/// The same asm and TM the source map is built against.
fn asm_and_tm(core: &Core) -> (Program, Machine) {
    let prog = match lower_asm(core) {
        Ok(p) => p,
        Err(_) => lower_asm(&defunc(core).expect("defunc")).expect("lowers after defunc"),
    };
    let m = lower_tm(&prog, &Unary::default());
    (prog, m)
}

/// Every `NodeId` of a `BinOp` with operator `op`, lowest first. Iterative: `Core::for_each_child` is
/// non-recursive by contract because a desugared spine can be tens of thousands of nodes deep.
fn binops(core: &Core, op: BinOp) -> Vec<NodeId> {
    let mut out = Vec::new();
    let mut stack = vec![core];
    while let Some(n) = stack.pop() {
        if let Core::BinOp(id, o, ..) = n
            && *o == op
        {
            out.push(*id);
        }
        n.for_each_child(&mut |c| stack.push(c));
    }
    out.sort_unstable();
    out
}

fn check(text: &str, spans: &[(Span, TokenClass)], what: &str) {
    assert!(!spans.is_empty(), "{what}: classified nothing, so the invariants below would prove nothing");
    for (s, _) in spans {
        assert!(s.start < s.end, "{what}: zero-width span {s:?}");
        assert!(s.end <= text.len(), "{what}: span {s:?} exceeds {} bytes", text.len());
        assert!(text.is_char_boundary(s.start) && text.is_char_boundary(s.end), "{what}: {s:?} splits a char");
    }
    for w in spans.windows(2) {
        assert!(w[0].0.end <= w[1].0.start, "{what}: spans overlap or unordered: {:?} then {:?}", w[0], w[1]);
    }
    // COVERAGE, the property the design's §6 states and this helper used to omit: every non-whitespace
    // byte lies inside some span. Without it a printer can emit punctuation it never classifies and stay
    // green — which is exactly what λ (56 bytes) and asm (16) did, while the TM printer covered its own.
    // The spans are ordered and disjoint by the assertions above, so one forward sweep over the holes
    // between them decides it, and every bound below is a char boundary those assertions already pinned.
    let mut cursor = 0usize;
    for (s, _) in spans {
        assert_gap_is_whitespace(text, cursor, s.start, what);
        cursor = s.end;
    }
    assert_gap_is_whitespace(text, cursor, text.len(), what);
}

/// `text[from..to]` belongs to no span. Only whitespace legitimately may. Reports the first offender by
/// absolute byte offset, line and column, with its whole line — "coverage failed" alone does not say
/// which punctuation went unclassified, and locating it by hand in a 40 KB TM listing is the work.
fn assert_gap_is_whitespace(text: &str, from: usize, to: usize, what: &str) {
    let gap = &text[from..to];
    let Some((off, c)) = gap.char_indices().find(|(_, c)| !c.is_whitespace()) else { return };
    let at = from + off;
    let line_start = text[..at].rfind('\n').map_or(0, |i| i + 1);
    let line_end = text[at..].find('\n').map_or(text.len(), |i| at + i);
    let (line, col) = (1 + text[..at].matches('\n').count(), 1 + text[line_start..at].chars().count());
    panic!(
        "{what}: byte {at} is {c:?}, which is not whitespace and lies in no span — line {line}, column \
         {col}, in {:?}. Every non-whitespace byte of printed text must be classified.",
        &text[line_start..line_end]
    );
}

#[test]
fn every_classifier_produces_well_formed_spans() {
    let mut checked = 0usize;
    for src in CORPUS {
        check(src, &classify_source(src), &format!("source {src:?}"));

        let core = core_of(src);

        let term = lower(&core).expect("the lambda backend accepts this corpus");
        let (lt, ls) = print_lambda_mapped(&term);
        check(&lt, &ls, &format!("lambda {src:?}"));

        let (prog, m) = asm_and_tm(&core);
        let (at, asm_spans) = print_asm_mapped(&prog);
        check(&at, &asm_spans, &format!("asm {src:?}"));

        let (mt, ms) = print_tm_mapped(&m);
        check(&mt, &ms, &format!("tm {src:?}"));

        // The HEADERED TM form too. `print_tm_with_mapped` emits a whole block the bare form does not
        // — `version`, `encoding`, `width`, `slots`, `result` and the `tape` lines — and until now
        // nothing put those spans through `check`, so their coverage, ordering and bounds were
        // unproven while every other printer's were pinned. The header is also the only place a
        // `Comment` class is currently reachable (the trailing `; reg` tape annotation), which makes
        // it exactly the part most worth checking rather than the least.
        let header = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(0, vec!['#', '_', '#'])]);
        let (ht, hs) = print_tm_with_mapped(&m, &header);
        check(&ht, &hs, &format!("tm+header {src:?}"));

        checked += 5;
    }
    assert_eq!(checked, CORPUS.len() * 5, "every source must reach all five classified forms");
}

/// The coverage assertion above holds for `classify_source` only because `CORPUS` has no comments. This
/// pins the exception rather than leaving it to a doc comment: the `//` bytes are non-whitespace and no
/// token claims them, so `check` WOULD fail on this input. Asserted as an equality on the classified
/// text, not merely "some gap exists", so it cannot pass for an unrelated reason.
///
/// When trivia representation is settled (roadmap Plan 4, deferral item 4 — the same decision `redextape
/// fmt` waits on), `classify_source` will emit `TokenClass::Comment` here, THIS TEST WILL FAIL, and the
/// fix is to delete it and add a commented program to `CORPUS`.
#[test]
fn source_with_a_comment_is_the_one_gap_this_corpus_avoids() {
    let src = "1 + // why\n2";
    let spans = classify_source(src);
    let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&src[s.start..s.end], *c)).collect();
    assert_eq!(
        named,
        vec![("1", TokenClass::Nat), ("+", TokenClass::Operator), ("2", TokenClass::Nat)],
        "the lexer discards comments, so no span covers `// why`"
    );
    assert!(
        !spans.iter().any(|(s, _)| s.start < 11 && s.end > 5),
        "if a span now covers the comment, the deferred trivia work has landed: delete this test and put \
         a commented program in CORPUS"
    );
}

#[test]
fn tm_spans_attribute_to_the_source_constructs_that_produced_them() {
    for src in CORPUS {
        let core = core_of(src);
        let (_, m) = asm_and_tm(&core);
        let map = SourceMap::build(&core, &Unary::default());
        let (text, spans) = print_tm_mapped(&m);
        let attributed: Attributed = attribute_tm_spans(&text, &map, &spans);

        assert_eq!(
            attributed.iter().map(|(s, c, _)| (*s, *c)).collect::<Vec<_>>(),
            spans,
            "{src:?}: attribution must preserve every span and class, in order"
        );

        // Which state names the map covers, as a SET that records no owning node — enough to say a
        // span MUST be attributed, not enough to say to what, so the "which node" assertion below
        // cannot be satisfied by restating the lookup the implementation performs.
        let covered: BTreeSet<&str> = map
            .node_to_tm
            .values()
            .flatten()
            .filter_map(|s| m.states.get(*s as usize))
            .map(|s| s.name.as_str())
            .collect();
        assert!(!covered.is_empty(), "{src:?}: the source map covers no TM state, so nothing is under test");

        let (mut defs, mut refs) = (0usize, 0usize);
        for (span, class, node) in &attributed {
            let name = &text[span.start..span.end];
            if !matches!(class, TokenClass::Label | TokenClass::StateName) {
                assert!(node.is_none(), "{src:?}: a {class:?} span {name:?} names no state and must carry no origin");
                continue;
            }
            assert_eq!(
                node.is_some(),
                covered.contains(name),
                "{src:?}: state {name:?} attributed {node:?}, but the map's coverage of it is {}",
                covered.contains(name)
            );
            let Some(id) = node else { continue };
            let block = map.tm_block(*id).unwrap_or_default();
            assert!(
                block.iter().filter_map(|s| m.states.get(*s as usize)).any(|s| s.name == name),
                "{src:?}: {name:?} attributed to node {id}, whose block {block:?} does not contain that state"
            );
            if *class == TokenClass::Label { defs += 1 } else { refs += 1 }
        }
        assert!(defs > 0, "{src:?}: no state DEFINITION was attributed");
        assert!(refs > 0, "{src:?}: no `start`/`goto` REFERENCE was attributed");
    }
}

/// The composition's point, pinned on one construct: the `*` in `1 + 2 * 3` owns a specific set of TM
/// states, and the printed definitions attributed to that node are EXACTLY those — not a neighbour's,
/// not a subset, and not merely "some node's".
#[test]
fn the_multiplication_owns_exactly_the_states_its_own_lowering_produced() {
    let core = core_of("1 + 2 * 3");
    let muls = binops(&core, BinOp::Mul);
    assert_eq!(muls.len(), 1, "this program has exactly one multiplication");
    let mul = muls[0];

    let (_, m) = asm_and_tm(&core);
    let map = SourceMap::build(&core, &Unary::default());
    let block = map.tm_block(mul).expect("the multiplication lowers to TM states");
    let want: BTreeSet<&str> =
        block.iter().filter_map(|s| m.states.get(*s as usize)).map(|s| s.name.as_str()).collect();
    assert_eq!(want.len(), block.len(), "state names are unique, so the block must name that many distinct states");
    assert!(!want.is_empty(), "an empty block would make the comparison below vacuous");

    let (text, spans) = print_tm_mapped(&m);
    let got: BTreeSet<&str> = attribute_tm_spans(&text, &map, &spans)
        .iter()
        .filter(|(_, class, id)| *class == TokenClass::Label && *id == Some(mul))
        .map(|(s, _, _)| &text[s.start..s.end])
        .collect();
    assert_eq!(got, want, "the state definitions attributed to the `*` node must be exactly its own block");
}

/// A hand-built machine in which a tape symbol, a head move and a keyword are spelled exactly like
/// state names the map covers. Only spans that NAME a state may be attributed: a composition that
/// looked up every span's text regardless of class would light the `[x]` cell, the `L` move and the
/// `goto` keyword as well, which is a false highlight in the consumer.
#[test]
fn text_that_merely_looks_like_a_state_name_is_never_attributed() {
    let m = Machine {
        states: vec![
            State {
                name: "goto".to_string(),
                accept: false,
                rules: vec![Rule { read: vec![Some('x')], write: vec![Some('L')], moves: vec![Move::L], next: 1 }],
            },
            State {
                name: "x".to_string(),
                accept: false,
                rules: vec![Rule { read: vec![None], write: vec![None], moves: vec![Move::S], next: 2 }],
            },
            State { name: "L".to_string(), accept: true, rules: Vec::new() },
        ],
        start: 0,
        tapes: 1,
    };
    assert!(m.validate().is_empty(), "the fixture must be a valid machine: {:?}", m.validate());

    let owner: BTreeMap<&str, NodeId> = [("goto", 10), ("x", 11), ("L", 12)].into_iter().collect();
    let node_to_tm = owner
        .iter()
        .map(|(name, id)| {
            let state = m.states.iter().position(|s| s.name == *name).expect("named state exists");
            (*id, vec![state as u32])
        })
        .collect();
    let tm_name_to_node = owner.iter().map(|(name, id)| ((*name).to_string(), *id)).collect();
    let map =
        SourceMap { node_to_lambda: BTreeMap::new(), node_to_tm, tm_name_to_node, node_to_source: BTreeMap::new() };

    let (text, spans) = print_tm_mapped(&m);
    let attributed = attribute_tm_spans(&text, &map, &spans);
    let mut seen: Vec<TokenClass> = Vec::new();
    for (span, class, node) in &attributed {
        let t = &text[span.start..span.end];
        let want = matches!(class, TokenClass::Label | TokenClass::StateName).then(|| owner.get(t).copied()).flatten();
        assert_eq!(*node, want, "{class:?} span {t:?} attributed {node:?}, wanted {want:?}");
        if !seen.contains(class) {
            seen.push(*class);
        }
    }
    for c in [TokenClass::Label, TokenClass::StateName, TokenClass::TapeSymbol, TokenClass::Move, TokenClass::Keyword] {
        assert!(seen.contains(&c), "the fixture must exercise {c:?}, or the collision it pins is untested");
    }
}

/// `attribute_tm_spans` promises totality: an out-of-range span yields `None` rather than a panic.
/// Nothing tested that promise — reverting the `text.get(..)` inside it to a plain `&text[..]` slice
/// left every other test in this file green, because they only ever pass spans produced against the
/// very text they hand in.
///
/// The realistic way to violate that pairing is mixing the two TM printers: `print_tm_with_mapped` emits a
/// header, so its spans sit further into the string than `print_tm_mapped`'s text is long. Empty
/// text is the sharpest form of the same mismatch, and the cheapest to state.
#[test]
fn spans_that_do_not_belong_to_the_text_yield_none_instead_of_panicking() {
    let core = core_of("1 + 2 * 3");
    let (_, machine) = asm_and_tm(&core);
    let map = SourceMap::build(&core, &Unary::default());
    let (text, spans) = print_tm_mapped(&machine);
    assert!(!spans.is_empty(), "the fixture must produce spans, or this pins nothing");

    // Every span is out of range for the empty string, so every lookup must decline.
    let against_nothing = attribute_tm_spans("", &map, &spans);
    assert_eq!(against_nothing.len(), spans.len(), "spans must be returned unchanged in number");
    assert!(
        against_nothing.iter().all(|(_, _, node)| node.is_none()),
        "a span that does not index the given text cannot name a state, so it must not be attributed"
    );

    // And the headered printer's spans against the bare text: the same mismatch, one a caller could
    // plausibly reach by pairing the wrong two functions.
    let header = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(0, vec!['#', '_', '#'])]);
    let (_, headered_spans) = print_tm_with_mapped(&machine, &header);
    let mismatched = attribute_tm_spans(&text, &map, &headered_spans);
    assert_eq!(mismatched.len(), headered_spans.len(), "spans must be returned unchanged in number");
}

/// THE MAP AND THE MACHINE CANNOT DISAGREE, BECAUSE THERE IS NO LONGER A SECOND ONE TO PASS.
/// `attribute_tm_spans` used to take a `Machine` beside the `SourceMap`, and used it for one thing:
/// turning the map's `StateId`s into the names printed text refers to states by. Nothing checked the
/// two came from the same lowering, so a renderer offering an encoding switch — build the map once,
/// re-lower the machine — silently attributed most state-naming spans to the wrong Core node.
///
/// What is pinned is the honest answer: a name the map's OWN lowering never produced is attributed to
/// nothing. The final block reconstructs the old composition as a witness, so this test cannot pass by
/// asserting something both versions satisfy — it counts the spans the discarded machine used to answer
/// confidently and wrongly.
#[test]
fn a_map_built_at_one_encoding_declines_text_printed_at_another() {
    let core = core_of("let x = 1; let y = x + x; y * 3");
    let prog = lower_asm(&core).expect("this corpus is first-order");
    let unary = lower_tm(&prog, &Unary::at(6));
    let binary = lower_tm(&prog, &Binary::at(6));

    // The map describes the UNARY lowering; the text is printed from the BINARY one.
    let map = SourceMap::build(&core, &Unary::at(6));
    let (text, spans) = print_tm_mapped(&binary);

    // Which names the map covers, resolved through the machine it was really built from — computed
    // from `node_to_tm`, so it does not restate the name index the implementation now consults.
    let covered: BTreeSet<&str> = map
        .node_to_tm
        .values()
        .flatten()
        .filter_map(|s| unary.states.get(*s as usize))
        .map(|s| s.name.as_str())
        .collect();
    let printed: BTreeSet<&str> = binary.states.iter().map(|s| s.name.as_str()).collect();
    assert!(!covered.is_empty(), "the map must cover states, or every `None` below is trivially right");
    assert!(printed.difference(&covered).next().is_some(), "the two lowerings must name states differently");

    let attributed = attribute_tm_spans(&text, &map, &spans);
    assert_eq!(
        attributed.iter().map(|(s, c, _)| (*s, *c)).collect::<Vec<_>>(),
        spans,
        "attribution must preserve every span and class, in order"
    );

    // Exactly the printed names the map's own lowering produced are attributed, and no others.
    let got: BTreeSet<&str> =
        attributed.iter().filter(|(_, _, n)| n.is_some()).map(|(s, _, _)| &text[s.start..s.end]).collect();
    let want: BTreeSet<&str> = printed.intersection(&covered).copied().collect();
    assert_eq!(got, want, "a name this map's lowering never produced must be attributed to nothing");
    for (span, _, node) in &attributed {
        let Some(id) = node else { continue };
        let name = &text[span.start..span.end];
        let block = map.tm_block(*id).unwrap_or_default();
        assert!(
            block.iter().filter_map(|s| unary.states.get(*s as usize)).any(|s| s.name == name),
            "{name:?} attributed to node {id}, whose block {block:?} contains no state of that name"
        );
    }

    // The old composition, written out as the bug it was: the map's state IDS resolved through the
    // machine handed in alongside — here the binary one. Every id still indexes some state, so every
    // lookup still answers; the answers are just about a different machine's states.
    let mut stale: BTreeMap<&str, NodeId> = BTreeMap::new();
    for (node, block) in &map.node_to_tm {
        for state in block {
            if let Some(s) = binary.states.get(*state as usize) {
                stale.entry(s.name.as_str()).or_insert(*node);
            }
        }
    }
    // Of the spans that old composition attributed AT ALL, how many did it attribute to a name this
    // map's lowering never produced — an origin manufactured out of an id collision between two
    // unrelated machines, which is precisely what has no honest answer and now yields `None`.
    let (mut claimed, mut manufactured) = (0usize, 0usize);
    for (span, class, _) in &attributed {
        if !matches!(class, TokenClass::Label | TokenClass::StateName) {
            continue;
        }
        let name = &text[span.start..span.end];
        if stale.contains_key(name) {
            claimed += 1;
            if !covered.contains(name) {
                manufactured += 1;
            }
        }
    }
    assert!(claimed > 0, "the old composition must have attributed something, or there is no bug to contrast");
    assert!(
        manufactured * 10 > claimed * 9,
        "nearly every origin the old composition produced here came from an id collision between two \
         unrelated machines — measured at 802 of 818 when this was written, got {manufactured} of \
         {claimed}. A fixture where that ratio collapses is no longer reproducing the bug."
    );
    assert!(
        attributed.iter().filter(|(_, _, n)| n.is_some()).count() < claimed,
        "and the honest map attributes strictly fewer spans than the confident wrong one did"
    );
}
