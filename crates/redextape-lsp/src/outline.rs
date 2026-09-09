//! The document outline, as a tree.
//!
//! `NameIndex` is a flat list of definitions in source order, and `documentSymbol` wants a
//! hierarchy. The shape that turns one into the other is an extent — the span of the construct a
//! definition introduces — and containment over extents is the whole rule: a definition is a child
//! of the innermost extent that contains its name.
//!
//! **`.tm` AND `.asm` CARRY NO EXTENT, SO THEY ARE UNCHANGED BY EVERY LINE HERE.** Nothing is ever
//! pushed on the stack for them, the stack stays empty, every definition is a root, and the
//! outline is exactly the flat list it was. That is not a fallback path — it is the same pass
//! reading a form that records no construct spans.

use gen_lsp_types::SymbolKind;
use redextape_core::Span;
use redextape_core::nav::NameIndex;

use crate::language::outline_kind;

/// The span of the whole line `span` sits on, terminator excluded.
///
/// **`DocumentSymbol::range` IS NOT DECORATION, IT IS WHAT A CLIENT TESTS THE CURSOR AGAINST.** The
/// protocol defines it as the region used to decide whether the caret is inside the symbol, and
/// `selectionRange` as the part to reveal — so setting both to the name span made breadcrumbs,
/// sticky scroll and nvim-navic report no symbol for every position except the few columns of the
/// name itself. The name span still goes to `selectionRange`, which is what it is for. Containment
/// holds either way, which is the only requirement the earlier doc comment checked itself against.
///
/// A line rather than a whole `state` block: `.tm` and `.asm` record no construct extent, so a line
/// is the smallest span that makes the cursor test behave, and is exact for `.asm`, where a label
/// IS its line. `.rxt` records an extent for every `fn`/`let`, so it never reaches this function —
/// `outline` calls it only when `o.extent()` is `None`.
pub(crate) fn enclosing_line(text: &str, span: Span) -> Span {
    let start = text.get(..span.start).map_or(span.start, |b| b.rfind('\n').map_or(0, |i| i + 1));
    let rest = text.get(span.end..).unwrap_or("");
    let end = rest.find('\n').map_or(text.len(), |i| span.end + i);
    let end = if text.get(end.saturating_sub(1)..end) == Some("\r") { end - 1 } else { end };
    Span { start, end }
}

/// One symbol in the outline, in BYTE offsets. The conversion to protocol positions happens in the
/// handler, so nothing here needs to know the client's `Encoding`.
pub(crate) struct OutlineNode {
    pub name: String,
    pub kind: SymbolKind,
    /// What a client tests the cursor against: the construct's extent when it has one, the
    /// enclosing line when it does not.
    pub range: Span,
    /// The part to reveal: the name, always.
    pub selection_range: Span,
    pub children: Vec<OutlineNode>,
}

/// The outline of one document, as a tree.
///
/// **ONE PASS, IN SOURCE ORDER, WITH AN EXPLICIT STACK.** `NameIndex::definitions` promises source
/// order and `Binder::finish`'s sort delivers it, which is what makes containment testable against
/// one offset instead of a search. For each definition: pop every extent that has closed, attach
/// the definition to the innermost extent still open, then push its own extent.
///
/// **DRAIN BEFORE PUSH IS THE WHOLE CORRECTNESS ARGUMENT, AND SELF-PARENTING IS NOT WHAT IT
/// GUARDS AGAINST — NO NODE CAN EVER BECOME ITS OWN CHILD, IN EITHER ORDER.** The extent branch
/// below only ever PUSHES the current node; `attach` is reached for it only on the extentless
/// branch, where nothing was ever pushed for it to be attached under. What draining first
/// protects is a CLOSED SIBLING sitting under a JUST-PUSHED entry: push the current node before
/// draining, and the new top of the stack is that fresh, never-closed entry, so the drain loop
/// sees a live top and stops immediately — leaving whatever was already closed underneath stuck
/// there until the pushed entry itself eventually pops, at which point it is attached under the
/// wrong parent instead of its own. Traced on `"let a = 1; let b = 2;"` with the two steps
/// swapped: pushing `b`'s extent (11, 21) before draining buries the already-closed `a` (0, 10)
/// beneath it, so the final flush attaches `b` under `a` instead of leaving them siblings —
/// `"a[b]"` instead of `"a b"`.
///
/// The stack is explicit rather than a recursive walk, but not because a recursive version would
/// be unsafe here — it would not be. `to_document_symbol` in `lib.rs` and `flatten` below DO
/// recurse over the very tree this pass builds, and both are safe for the reason their own doc
/// comments give: a `fn`/`let` extent nests inside another only by nesting inside a braced block,
/// and the parser's own `MAX_PARSE_DEPTH` (300) already bounds how deeply those can nest — so this
/// tree's depth is bounded the same way, and a recursive `outline` would be exactly as safe as
/// those two.
/// The explicit stack is the natural shape for what this pass actually walks:
/// `NameIndex::definitions` is a flat, already-sorted list, not a tree — there is nothing to
/// recurse over until this pass builds one.
pub(crate) fn outline(nav: &NameIndex, text: &str) -> Vec<OutlineNode> {
    let mut roots: Vec<OutlineNode> = Vec::new();
    // Each entry is an open extent's END and the node that owns it.
    let mut open: Vec<(usize, OutlineNode)> = Vec::new();

    let attach =
        |open: &mut Vec<(usize, OutlineNode)>, roots: &mut Vec<OutlineNode>, node: OutlineNode| match open.last_mut() {
            Some((_, parent)) => parent.children.push(node),
            None => roots.push(node),
        };

    for o in nav.definitions() {
        // A definition an outline does not list — a `.rxt` parameter. Filtered here rather than in
        // the index, which keeps it navigable, and inside this loop's own iteration — before the
        // stack work below ever runs for it — so it can neither become a parent nor be attached as
        // a child.
        let Some(kind) = o.def_kind().and_then(outline_kind) else { continue };

        while let Some((end, node)) = open.pop() {
            // `<=`: an extent that ends exactly where the next NAME starts is closed, not open —
            // the general containment rule, written for a boundary that only `.rxt` (the one form
            // that ever pushes anything here) can even offer. On `.rxt` it never occurs anyway,
            // per `consecutive_lets_are_siblings`'s doc: a name always lies past its own `let `/
            // `fn ` keyword, so `end == o.span.start` is unreachable and `<` would read identically.
            if end <= o.span.start {
                attach(&mut open, &mut roots, node);
            } else {
                open.push((end, node));
                break;
            }
        }

        let extent = o.extent();
        let node = OutlineNode {
            name: o.name.clone(),
            kind,
            range: extent.unwrap_or_else(|| enclosing_line(text, o.span)),
            selection_range: o.span,
            children: Vec::new(),
        };
        match extent {
            Some(e) => open.push((e.end, node)),
            None => attach(&mut open, &mut roots, node),
        }
    }

    while let Some((_, closed)) = open.pop() {
        attach(&mut open, &mut roots, closed);
    }
    roots
}

/// Every node of the tree in source order, each paired with the name of its parent.
///
/// Recursive, bounded by the outline tree's nesting depth, which cannot exceed the parser's
/// `MAX_PARSE_DEPTH` (300), because a `let` or `fn` can only nest inside another through a
/// braced block and the parser refuses blocks nested deeper than that.
///
/// For the `SymbolInformation[]` shape, which has no `children`: `container_name` is the only
/// place the nesting can appear, and dropping the non-roots would present a partial outline as a
/// complete one.
pub(crate) fn flatten(nodes: &[OutlineNode]) -> Vec<(&OutlineNode, Option<&str>)> {
    fn go<'a>(nodes: &'a [OutlineNode], container: Option<&'a str>, out: &mut Vec<(&'a OutlineNode, Option<&'a str>)>) {
        for n in nodes {
            out.push((n, container));
            go(&n.children, Some(n.name.as_str()), out);
        }
    }
    let mut out = Vec::new();
    go(nodes, None, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use redextape_core::binder::nav_rxt;

    /// The names of a tree, parent first, each node's children in brackets.
    fn shape(nodes: &[OutlineNode]) -> String {
        nodes
            .iter()
            .map(|n| if n.children.is_empty() { n.name.clone() } else { format!("{}[{}]", n.name, shape(&n.children)) })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Like `shape`, but each node as `name@start-end` using its `selection_range`, so a
    /// parent-child pair asserted against this string is anchored to the exact spans rather than
    /// to names alone. The design's testing section requires this for a nesting claim: a name can
    /// appear twice, and a name-keyed assertion passes against whichever node has that name, not
    /// necessarily the right one.
    fn shape_with_spans(nodes: &[OutlineNode]) -> String {
        nodes
            .iter()
            .map(|n| {
                let head = format!("{}@{}-{}", n.name, n.selection_range.start, n.selection_range.end);
                if n.children.is_empty() { head } else { format!("{head}[{}]", shape_with_spans(&n.children)) }
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Probed on 6e0ad6e: `f` extent (0,28) contains `x`'s name at (16,17) and not `y`'s at
    /// (33,34), and the parameter `a` is filtered by `outline_kind` inside the pass's own loop,
    /// before that iteration's stack work runs.
    ///
    /// Span-anchored per the design's testing section: `shape_with_spans` pins each node to the
    /// exact `(name, selection_range)` this pass produced, so the assertion cannot pass against a
    /// node sitting in the right place in the tree but carrying the wrong span — `shape` alone
    /// checks names and nesting, nothing about the spans on the nodes that carry them. Offsets
    /// measured on a real run of this source, not computed by hand: `f@3-4[x@16-17] y@33-34`.
    #[test]
    fn a_let_inside_a_fn_body_becomes_that_fn_s_child() {
        let src = "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny";
        let nav = nav_rxt(src).expect("within the token cap");
        assert_eq!(shape_with_spans(&outline(&nav, src)), "f@3-4[x@16-17] y@33-34");
    }

    /// The nesting rule is containment, not statement structure: this `let` is inside a BLOCK
    /// EXPRESSION, so it is not a statement of the outer block at all and no walk over
    /// `Program::block::stmts` would find it. The binder reaches it through its worklist and the
    /// extent puts it in the right place.
    ///
    /// Span-anchored, as above. Offsets measured on a real run: `g@4-5[y@14-15]`.
    #[test]
    fn a_let_inside_a_block_expression_nests_under_the_binding_that_holds_it() {
        let src = "let g = { let y = 1; y };";
        let nav = nav_rxt(src).expect("within the token cap");
        assert_eq!(shape_with_spans(&outline(&nav, src)), "g@4-5[y@14-15]");
    }

    /// Probed on 6e0ad6e: `a`'s extent ends at 10 and `b`'s name starts at 15 — a closed extent
    /// that this pins is actually popped, not left open forever. `end == name.start` cannot occur
    /// on this grammar: every name is preceded by its own `let `/`fn ` keyword, so a name always
    /// starts at least three bytes past its own statement's start, which is at or after the
    /// previous extent's end. The pop's `<=` is written for the general containment rule, and
    /// coincides with plain `<` on every input this grammar can produce.
    #[test]
    fn consecutive_lets_are_siblings() {
        let src = "let a = 1; let b = 2;";
        let nav = nav_rxt(src).expect("within the token cap");
        assert_eq!(shape(&outline(&nav, src)), "a b");
    }

    /// A `fn` run is a scoping unit and not a nesting one: `a` and `b` see each other, and neither
    /// contains the other.
    #[test]
    fn a_fn_run_does_not_nest() {
        let src = "fn a(n) { b(n) } fn b(n) { a(n) } 0";
        let nav = nav_rxt(src).expect("within the token cap");
        assert_eq!(shape(&outline(&nav, src)), "a b");
    }

    /// Not self-parenting — the extent branch only ever PUSHES the current node, so `f` can never
    /// be attached under itself in either ordering. What this pins is a CLOSED construct's
    /// trailing sibling: `f`'s extent closes before `z` starts, so by the time `z` is reached both
    /// `f` and its child `x` must already be off the stack. Push `z`'s own extent before draining
    /// — the ordering this test is named for — and the drain loop's new top is `z` itself, never
    /// closed, so it stops immediately and leaves `f`[x] buried underneath; the final flush then
    /// attaches `z` under `x` and `x` under `f`, giving one root `"f[x[z]]"` instead of the two
    /// siblings `"f[x] z"`.
    ///
    /// Span-anchored, as `a_let_inside_a_fn_body_becomes_that_fn_s_child` is. Offsets measured on
    /// a real run: `f@3-4[x@14-15] z@29-30`.
    #[test]
    fn a_closed_construct_does_not_bury_its_trailing_sibling() {
        let src = "fn f(a) { let x = 1; x } let z = 2;";
        let nav = nav_rxt(src).expect("within the token cap");
        let tree = outline(&nav, src);
        assert_eq!(tree.len(), 2, "f and z are both roots");
        assert_eq!(shape_with_spans(&tree), "f@3-4[x@14-15] z@29-30");
    }

    /// A broken file still outlines. Probed on 6e0ad6e: recovery gives `f` the extent (0,11),
    /// which runs to end of input.
    #[test]
    fn a_file_that_did_not_parse_completely_still_outlines() {
        let src = "fn f(a) { a";
        let nav = nav_rxt(src).expect("a recovered file is indexed");
        assert_eq!(shape(&outline(&nav, src)), "f");
    }

    /// Every node's selection range is inside its own range, which the protocol requires and which
    /// holds on both paths: an extent contains its own name, and a line contains any span on it.
    /// And every child's range is inside its parent's — not free, since the pass attaches by NAME
    /// containment rather than range containment: it holds because a nested `fn`/`let`'s own
    /// extent is itself nested inside the extent that contains it.
    #[test]
    fn a_selection_range_is_always_inside_its_range() {
        for src in [
            "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny",
            "let g = { let y = 1; y };",
            "fn a(n) { b(n) } fn b(n) { a(n) } 0",
        ] {
            let nav = nav_rxt(src).expect("within the token cap");
            let tree = outline(&nav, src);
            let mut stack: Vec<&OutlineNode> = tree.iter().collect();
            while let Some(n) = stack.pop() {
                assert!(
                    n.range.start <= n.selection_range.start && n.selection_range.end <= n.range.end,
                    "{src:?}: {} selection {:?} escapes range {:?}",
                    n.name,
                    n.selection_range,
                    n.range
                );
                for c in &n.children {
                    assert!(
                        n.range.start <= c.range.start && c.range.end <= n.range.end,
                        "{src:?}: {}'s range escapes {}'s",
                        c.name,
                        n.name
                    );
                }
                stack.extend(n.children.iter());
            }
        }
    }

    /// The flat shape has no `children`, so the nesting has to reach it as a container NAME or not
    /// at all — and the nodes themselves must all still be there.
    #[test]
    fn flattening_keeps_every_node_and_names_its_container() {
        let src = "fn f(a) {\n  let x = 1;\n  x\n}\nlet y = 2;\ny";
        let nav = nav_rxt(src).expect("within the token cap");
        let tree = outline(&nav, src);
        let flat: Vec<_> = flatten(&tree).into_iter().map(|(n, c)| (n.name.as_str(), c)).collect();
        assert_eq!(flat, vec![("f", None), ("x", Some("f")), ("y", None)]);
    }

    /// Source order survives flattening: a parent immediately precedes its children, which is what
    /// a client with no hierarchy renders as a list.
    #[test]
    fn flattening_keeps_source_order() {
        let src = "let g = { let y = 1; y };";
        let nav = nav_rxt(src).expect("within the token cap");
        let tree = outline(&nav, src);
        let flat: Vec<_> = flatten(&tree).into_iter().map(|(n, c)| (n.name.as_str(), c)).collect();
        assert_eq!(flat, vec![("g", None), ("y", Some("g"))]);
    }

    /// Like `flatten`, but pairs each node with its parent's `(name, selection_range)` rather than
    /// the bare name `flatten` sends to the protocol as `container_name`. Test-only: the span is
    /// what tells two SAME-NAMED parents apart in `assert_definitions_match_tree` below, and the
    /// protocol has no field to carry it in, which is exactly why `flatten` itself must not grow
    /// one.
    fn flatten_with_parent_span<'a>(
        nodes: &'a [OutlineNode],
        parent: Option<(&'a str, Span)>,
        out: &mut Vec<(&'a OutlineNode, Option<(&'a str, Span)>)>,
    ) {
        for n in nodes {
            out.push((n, parent));
            flatten_with_parent_span(&n.children, Some((n.name.as_str(), n.selection_range)), out);
        }
    }

    /// Whether two extents are properly nested (one contains the other, endpoints included) or
    /// fully disjoint — the only two shapes `expected_parent`'s "smallest containing extent"
    /// premise allows. A partial overlap — each covers part of the other's range but neither
    /// contains the whole — is neither, and would make "smallest containing" silently disagree
    /// with "innermost containing" without turning anything red on its own. See
    /// `overlapping_extents_are_told_apart_from_nested_ones` for this measured on the predicate
    /// itself, and `assert_definitions_match_tree` for where it guards the premise.
    fn nested_or_disjoint(a: Span, b: Span) -> bool {
        let disjoint = a.end <= b.start || b.end <= a.start;
        let nested = (a.start <= b.start && b.end <= a.end) || (b.start <= a.start && a.end <= b.end);
        disjoint || nested
    }

    #[test]
    fn overlapping_extents_are_told_apart_from_nested_ones() {
        assert!(nested_or_disjoint(Span { start: 0, end: 5 }, Span { start: 5, end: 10 }), "disjoint");
        assert!(nested_or_disjoint(Span { start: 0, end: 10 }, Span { start: 2, end: 8 }), "nested");
        // Neither disjoint nor nested — exactly the shape `expected_parent`'s premise forbids.
        // Measured false directly on the predicate, not inferred from a passing test elsewhere.
        assert!(!nested_or_disjoint(Span { start: 0, end: 10 }, Span { start: 5, end: 15 }), "partial overlap");
    }

    /// `(name, selection_range.start, selection_range.end, parent)`, `parent` being the same
    /// triple for the enclosing definition, or `None` at the root — the shape both the promised
    /// and the actual side of `assert_definitions_match_tree` reduce to before comparison.
    type PlacedDef = (String, usize, usize, Option<(String, usize, usize)>);

    /// The multiset of `(name, selection_range, parent)` triples `nav`'s outline-eligible
    /// definitions promise, compared against the same shape drawn from `outline(nav, src)`.
    /// `parent` on the promised side is not read off `outline`'s own tree — it is the innermost
    /// OTHER definition's extent that contains this definition's name span, found by plain
    /// interval containment, no stack and no source-order walk involved. That makes it an
    /// independent check on placement: a tree that reaches every node once but hangs one under the
    /// wrong parent is caught here — INCLUDING a misplacement between two SAME-NAMED parents,
    /// because `parent` here carries the parent's `(name, selection_range)`, not the bare name
    /// `flatten`'s `container_name` gives the protocol.
    ///
    /// A bare name is not enough on its own: measured on
    /// `"fn f(p) { fn f(q) { let z = 1; z } f(0) } 0"`, with `attach` sabotaged to prefer the
    /// OUTERMOST open extent instead of the innermost, `z` (correctly the inner `f`'s child) is
    /// misattached to the outer `f` instead — and because both parents are named `f`, the
    /// name-only form of this check (comparing `container.map(str::to_string)` against
    /// `expected_parent`'s name alone, as this function did before this paragraph) produced an
    /// identical sorted multiset for the correct and the misplaced tree, so it passed against the
    /// misplaced one. Carrying the parent's `selection_range` alongside its name — via
    /// `flatten_with_parent_span` rather than `flatten` — tells the two `f`s apart and reddens on
    /// that same sabotage.
    ///
    /// Sorted vectors rather than counts: a pass that duplicated one node and dropped another
    /// would have the right COUNT and the wrong CONTENTS, and a length check alone would not
    /// notice.
    fn assert_definitions_match_tree(nav: &NameIndex, src: &str, ctx: &str) {
        let defs: Vec<(String, Span, Option<Span>)> = nav
            .definitions()
            .filter(|o| o.def_kind().and_then(outline_kind).is_some())
            .map(|o| (o.name.clone(), o.span, o.extent()))
            .collect();

        // The premise `expected_parent` below leans on: no two extents partially overlap, so
        // "smallest containing" and "innermost containing" agree. Nothing else here checks that —
        // a violation would silently pick the wrong `expected_parent` rather than turn this test
        // red on its own — so check it directly over every pair. See `nested_or_disjoint`.
        for (i, (_, _, ei)) in defs.iter().enumerate() {
            let Some(ei) = *ei else { continue };
            for (_, _, ej) in defs.iter().skip(i + 1) {
                let Some(ej) = *ej else { continue };
                assert!(nested_or_disjoint(ei, ej), "{ctx}: extents {ei:?} and {ej:?} partially overlap");
            }
        }

        // The innermost OTHER extent in `defs` that contains `span`, returned with the owning
        // definition's own name span alongside its name — see this function's doc comment for why
        // the span has to ride along.
        let expected_parent = |skip: usize, span: Span| -> Option<(&str, Span)> {
            defs.iter()
                .enumerate()
                .filter_map(|(j, (name, name_span, extent))| {
                    if j == skip {
                        return None;
                    }
                    let e = (*extent)?;
                    (e.start <= span.start && span.end <= e.end).then_some((e.end - e.start, name.as_str(), *name_span))
                })
                .min_by_key(|(width, _, _)| *width)
                .map(|(_, name, name_span)| (name, name_span))
        };

        let mut listed: Vec<PlacedDef> = defs
            .iter()
            .enumerate()
            .map(|(i, (name, span, _))| {
                let parent = expected_parent(i, *span).map(|(n, s)| (n.to_string(), s.start, s.end));
                (name.clone(), span.start, span.end, parent)
            })
            .collect();

        let tree = outline(nav, src);
        let mut pairs = Vec::new();
        flatten_with_parent_span(&tree, None, &mut pairs);
        let mut got: Vec<PlacedDef> = pairs
            .into_iter()
            .map(|(n, parent)| {
                let parent = parent.map(|(name, s)| (name.to_string(), s.start, s.end));
                (n.name.clone(), n.selection_range.start, n.selection_range.end, parent)
            })
            .collect();

        listed.sort();
        got.sort();
        assert_eq!(got, listed, "{ctx}");
    }

    /// The exact scenario `assert_definitions_match_tree`'s doc comment measures: two `fn`s named
    /// `f`, one nested in the other, with a `let` inside the inner one. The correct tree nests `z`
    /// under the INNER `f`, and this test's job is only to pin that outcome for the shipped
    /// algorithm — the counterfactual (a name-only check passing against a MISPLACED tree here) is
    /// not reproduced by this test, since reproducing it needs a second copy of `outline` with
    /// `attach` sabotaged, which does not belong in the pass under test.
    #[test]
    fn same_named_parents_are_told_apart_by_selection_range() {
        let src = "fn f(p) { fn f(q) { let z = 1; z } f(0) } 0";
        let nav = nav_rxt(src).expect("within the token cap");
        assert_definitions_match_tree(&nav, src, "same-named nested fns");
    }

    /// `siblings` sibling `let`s, tail the last one. The bottom of `nested_level`'s recursion.
    fn nested_leaf(path: &str, siblings: usize) -> String {
        use std::fmt::Write as _;
        let mut stmts = String::new();
        let mut last = String::new();
        for i in 0..siblings {
            let name = format!("v{path}_{i}");
            let _ = writeln!(stmts, "let {name} = 0;");
            last = name;
        }
        stmts + &last
    }

    /// `siblings` sibling `fn`s: the first recurses to `depth - 1`, the rest bottom out one level
    /// down in `nested_leaf`. Every name is built from its own path from the root, so nothing in
    /// the generated source shadows anything else in it.
    fn nested_level(depth: usize, siblings: usize, path: &str) -> String {
        use std::fmt::Write as _;
        if depth == 0 {
            return nested_leaf(path, siblings);
        }
        let mut stmts = String::new();
        let mut last = String::new();
        for i in 0..siblings {
            let name = format!("f{path}_{i}");
            let child_path = format!("{path}_{i}");
            let body = if i == 0 {
                nested_level(depth - 1, siblings, &child_path)
            } else {
                nested_leaf(&child_path, siblings)
            };
            let _ = writeln!(stmts, "fn {name}(p) {{\n{body}\n}}");
            last = name;
        }
        let _ = write!(stmts, "{last}(0)");
        stmts
    }

    /// `depth` levels of nested `fn`, `siblings` siblings at every level: one chain runs the full
    /// `depth` deep, and the rest bottom out one level down in a run of sibling `let`s. See
    /// `nested_level`.
    fn nested_fn_source(depth: usize, siblings: usize) -> String {
        nested_level(depth, siblings, "")
    }

    /// The number of levels in `nodes`: 1 for a flat list, more for any real nesting, 0 for none.
    fn max_depth(nodes: &[OutlineNode]) -> usize {
        nodes.iter().map(|n| 1 + max_depth(&n.children)).max().unwrap_or(0)
    }

    /// Every definition the outline lists reaches the tree exactly once, and at the right place.
    ///
    /// Two halves, because they cover two different POPULATIONS under the same check: the real
    /// fixtures this pass exists for, and a generated source deep enough to nest, which the
    /// fixtures are not.
    ///
    /// **THE CORPUS HALF** runs over the `.rxt` files checked into the tree, which is the
    /// population this pass exists for. Measured on this branch, all but one of them are FLAT —
    /// ten contribute no outline-eligible definition at all and eleven are depth-1, so a flat file
    /// contributes at most two top-level definitions and two are `.tm` source in a `.rxt` file. The exception is `run_nested_scopes.in/p.rxt` — a CLI
    /// end-to-end case for a program whose scopes actually nest, not a fixture written for this
    /// test — which reaches depth 3 and gives the corpus its first real parent-child edges. One
    /// fixture is not scale: it alone cannot exercise the defect the doc below names — a node LOST
    /// by being popped and attached to a parent that was itself already popped — at anything like
    /// the breadth the generated half below produces, no matter how many flat files sit beside it.
    ///
    /// **THE GENERATED HALF** supplies nesting at a scale no single checked-in fixture matches:
    /// `nested_fn_source` builds several siblings per level, several levels deep, with one chain
    /// running the full depth. `max_depth` on its tree is the guard that makes this half a nesting
    /// test rather than another flat one — a shallow generated source would satisfy the multiset
    /// check below by having nothing to lose.
    ///
    /// Both halves are checked the same way, by `assert_definitions_match_tree`: not that the tree
    /// and the definition list have the same LENGTH — a pass that duplicated one node and dropped
    /// another would still pass that — but that they hold the same MULTISET of
    /// `(name, selection_range, parent)` triples.
    #[test]
    fn every_listed_definition_appears_in_the_tree_exactly_once() {
        // Measured on this branch: 22 `.rxt` files, all under `crates/redextape-cli/tests/cmd`,
        // and several are deliberately broken fixtures — which is the population this pass exists
        // for.
        let root = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
        let mut files = Vec::new();
        let mut dirs = vec![root.to_path_buf()];
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
                let path = entry.path();
                let name = entry.file_name();
                if name == "target" || name == ".git" || name == "node_modules" {
                    continue;
                }
                if path.is_dir() {
                    dirs.push(path);
                } else if path.extension().and_then(std::ffi::OsStr::to_str) == Some("rxt") {
                    files.push(path);
                }
            }
        }
        // This only proves the walk found the tree's fixtures — it says nothing about what any of
        // them contain. Measured on this branch: 10 of the 22 fixtures parse but contribute zero
        // outline-eligible definitions (and a fixture where `nav_rxt` returns `None` would
        // `continue` past it below the same way), so a corpus that read every file and built
        // nothing from half of them would still satisfy this alone.
        assert!(files.len() >= 20, "expected the tree's .rxt fixtures, found {}", files.len());

        let mut nodes_built = 0usize;
        let mut file_max_depth = 0usize;
        for path in files {
            let src = std::fs::read_to_string(&path).expect("a readable fixture");
            let Some(nav) = nav_rxt(&src) else { continue };
            assert_definitions_match_tree(&nav, &src, &path.display().to_string());
            let tree = outline(&nav, &src);
            nodes_built += flatten(&tree).len();
            file_max_depth = file_max_depth.max(max_depth(&tree));
        }
        // **THIS IS THE GUARD THAT MAKES THE CORPUS HALF A TEST RATHER THAN A LOOP OVER
        // NOTHING** — the file count above cannot tell a corpus that built real trees apart from
        // one that read every file and compared two empty lists 22 times. Measured on this
        // branch: 20 outline nodes built across the corpus, 8 of them from the one fixture that
        // nests (`run_nested_scopes.in/p.rxt`); the floor is raised from the previous 10 to sit
        // above the 12 the corpus built before that fixture existed, so losing that fixture fails
        // this assertion where the old floor of 10 would not have. It is not exclusive to it —
        // removing six of the eleven flat contributing fixtures also drops below 15 — but it is
        // slack measured against the corpus rather than an arbitrary round number. The depth floor
        // below is the one that is specific to nesting.
        assert!(nodes_built >= 15, "expected the corpus to build outline nodes, got {nodes_built}");
        // A second, independent floor on the same loop: node COUNT alone cannot tell a corpus that
        // nests from one that is wide but flat — ten more single-`let` fixtures would raise
        // `nodes_built` without adding a single parent-child edge. Measured on this branch: the
        // deepest corpus file is `run_nested_scopes.in/p.rxt` at depth 3; the floor sits under that
        // so an equally-nested but shallower replacement fixture would not fail this alone.
        assert!(
            file_max_depth >= 2,
            "expected the corpus itself to nest beyond depth 1, got max depth {file_max_depth}"
        );

        // The generated half: three levels of `fn`, three siblings per level — nesting at a scale
        // and breadth the corpus, even with one nesting fixture in it, does not supply on its own.
        // Measured on this branch: 30 definitions over 591 bytes, tree depth 4 (three nested `fn`s
        // and the `let` run at the bottom of the deep chain).
        let src = nested_fn_source(3, 3);
        let nav = nav_rxt(&src).expect("within the token cap");
        let depth = max_depth(&outline(&nav, &src));
        assert!(depth >= 4, "expected the generated source to nest 4 deep, got depth {depth}\n{src}");
        assert_definitions_match_tree(&nav, &src, "the generated nested source");
    }
}
