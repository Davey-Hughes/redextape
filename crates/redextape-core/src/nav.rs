//! Where names are written in one document, and which of them define rather than mention.
//!
//! **THIS MODULE HOLDS NO GRAMMAR.** It does not know what a TM state is, what an asm label is,
//! or which of the three a given document contains. The parsers push occurrences as they scan —
//! they are the only things in this crate that know where a name begins — and the server maps a
//! definition to a `SymbolKind` per occurrence, via `outline_kind(DefKind)`, because a `.rxt`
//! document mixes several kinds and no one language determines the kind any more. Anything here
//! that could answer "is this a state?" would be a second definition of a grammar that already
//! has exactly one.
//!
//! `DefKind` names constructs from every form and does not breach this: the rule is that nothing
//! here may DECIDE what a name is. A discriminant each parser supplies and this module only
//! carries decides nothing, and the alternative — a neutral vocabulary invented to avoid the
//! words — would be the protocol's `SymbolKind` in disguise, in a crate that names no protocol.
//!
//! **AN INDEX OUTLIVES A FAILED PARSE, AND THAT IS THE DIFFERENCE FROM `comments`.** Comment
//! recovery is all-or-nothing across a document because comments feed the PRINTER, which has
//! nothing to print for a file with an error. This feeds NAVIGATION: a jump from a `goto` to its
//! `state` is correct on its own terms, and nothing else in the file has to be true for it to be
//! the right answer. The moment navigation is worth most is the moment the file is broken,
//! because that is what a file under active editing is.

use std::collections::HashMap;

use crate::Span;

/// Every name occurrence in one document, in source order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NameIndex {
    occurrences: Vec<Occurrence>,
}

/// One name, as written, at one place.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Occurrence {
    /// The name as written. An owned `String` and not a slice: the index outlives the borrow of
    /// the text it was built from, and every consumer holds it across a parse.
    pub name: String,
    /// The span of the NAME — not of the line, statement or block containing it.
    pub span: Span,
    pub role: Role,
}

/// What a definition defines.
///
/// **SUPPLIED BY THE PARSER THAT PUSHED THE OCCURRENCE; NOTHING HERE DECIDES ONE.** That is the
/// distinction this module's own rule turns on — a function answering "is this a state?" would be
/// a second definition of a grammar that has exactly one, and a value the parser hands over is
/// not. The server maps these to the protocol's `SymbolKind`; this crate names no protocol.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DefKind {
    /// A `.tm` `state <name>:` header.
    State,
    /// A `.asm` `<name>:` label.
    Label,
    /// A `.rxt` `let` binding.
    Let,
    /// A `.rxt` `fn` declaration.
    Fn,
    /// A `.rxt` `fn` or lambda parameter.
    Param,
}

/// Whether an occurrence introduces a name or mentions one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Definition {
        kind: DefKind,
    },
    Reference {
        /// Index into the document's occurrences. `None` when nothing in this document defines
        /// the name — `parse_asm_full` accepts `jmp nowhere` with zero diagnostics, so a
        /// dangling reference is an ordinary value rather than an error to report.
        def: Option<usize>,
    },
}

impl NameIndex {
    pub(crate) fn push_definition(&mut self, name: &str, span: Span, kind: DefKind) {
        self.occurrences.push(Occurrence { name: name.to_string(), span, role: Role::Definition { kind } });
    }

    /// Record a mention. The link is filled by `link`, not here: a `goto` may name a state
    /// defined further down the file, so nothing can be resolved until the scan has finished.
    pub(crate) fn push_reference(&mut self, name: &str, span: Span) {
        self.occurrences.push(Occurrence { name: name.to_string(), span, role: Role::Reference { def: None } });
    }

    /// Record a mention whose binding is already known.
    ///
    /// **`link` IS THE WRONG RULE FOR A SCOPED LANGUAGE, WHICH IS WHY THIS IS A SECOND ENTRY POINT
    /// RATHER THAN A FLAG ON THE FIRST.** `link` points every reference at the FIRST definition of
    /// its name; in `let x = 1; let x = x + 1;` the right-hand `x` is bound by the first `let` and
    /// the tail by the second, and no name-keyed rule can answer both. `binder` resolves against
    /// the scope chain as it walks and calls this; the `.tm` and `.asm` parsers keep calling
    /// `push_reference` and `link`. That split is a convention the two call paths follow, not one
    /// this module enforces: `push_reference(n, s)` is exactly `push_resolved_reference(n, s,
    /// None)`, and `link` stays `pub(crate)` and callable after either. Each caller keeps to its
    /// own entry point because its own linking rule is the one it wants — a flat namespace for
    /// `.tm`/`.asm`, a scope chain for `.rxt` — not because a mode of the other is unreachable.
    pub(crate) fn push_resolved_reference(&mut self, name: &str, span: Span, def: Option<usize>) {
        self.occurrences.push(Occurrence { name: name.to_string(), span, role: Role::Reference { def } });
    }

    /// Point every reference at the FIRST definition of its name. Called once, by the `.tm` and
    /// `.asm` parsers, after the whole document has been scanned.
    pub(crate) fn link(&mut self) {
        let mut first: HashMap<&str, usize> = HashMap::new();
        for (i, o) in self.occurrences.iter().enumerate() {
            if matches!(o.role, Role::Definition { .. }) {
                first.entry(o.name.as_str()).or_insert(i);
            }
        }
        // `first` borrows `self.occurrences`, so the resolved links are collected before the
        // mutable pass rather than looked up inside it.
        let links: Vec<Option<usize>> = self.occurrences.iter().map(|o| first.get(o.name.as_str()).copied()).collect();
        for (o, link) in self.occurrences.iter_mut().zip(links) {
            if let Role::Reference { def } = &mut o.role {
                *def = link;
            }
        }
    }

    /// The occurrence containing `offset`, and its index. `None` when the cursor is on
    /// punctuation, whitespace, a comment, or anything else that is not a name.
    ///
    /// A linear scan. Occurrences are in source order and a hand-written document has few of
    /// them; binary search would be the same answer with a sortedness invariant to hold.
    #[must_use]
    pub fn at(&self, offset: usize) -> Option<(usize, &Occurrence)> {
        // **A CURSOR ONE PAST THE LAST BYTE OF A NAME IS STILL ON THAT NAME.** That is where the
        // caret sits after typing one, after `e`/`w` in Vim, and after a double-click or `End` in
        // most editors — so a strictly half-open test answers `null` at the position navigation is
        // most often invoked from. rust-analyzer's `find_node_at_offset` and gopls both accept
        // `offset == end`. An earlier version of this method did not, under a test asserting "the
        // end is exclusive" as though that were the requirement rather than the defect.
        //
        // Containment wins over adjacency, so an occurrence ending where the next one begins can
        // never shadow the one the cursor is genuinely inside. None of the three grammars can
        // produce two adjacent names: each one's tokenizer reads a maximal run of identifier
        // characters, so two names with nothing between them would already have been read as one
        // longer identifier rather than two adjacent ones. But the ordering costs nothing and
        // removes the question.
        let contains = self.occurrences.iter().enumerate().find(|(_, o)| o.span.start <= offset && offset < o.span.end);
        contains.or_else(|| self.occurrences.iter().enumerate().find(|(_, o)| o.span.end == offset))
    }

    #[must_use]
    pub fn get(&self, i: usize) -> Option<&Occurrence> {
        self.occurrences.get(i)
    }

    /// The index of the definition occurrence `i` names: itself when `i` is a definition, its
    /// link when `i` is a reference. `None` for a dangling reference or an index out of range.
    #[must_use]
    pub fn definition_of(&self, i: usize) -> Option<usize> {
        match self.occurrences.get(i)?.role {
            Role::Definition { .. } => Some(i),
            Role::Reference { def } => def,
        }
    }

    /// Every definition, in source order. A name defined twice appears twice — `.asm` accepts
    /// that with no diagnostic, and an outline should show the file that exists.
    pub fn definitions(&self) -> impl Iterator<Item = &Occurrence> {
        self.occurrences.iter().filter(|o| matches!(o.role, Role::Definition { .. }))
    }

    /// Every reference that names what occurrence `i` names, when `i` is a reference nothing
    /// defines — `i` itself included.
    ///
    /// **THIS MATCHES ON NAME, WHICH THIS TYPE REFUSES EVERYWHERE ELSE, AND THE REASON IT IS RIGHT
    /// HERE IS THAT THERE IS NOTHING ELSE TO MATCH ON.** `references_to` keys on the link because
    /// a name can be bound twice and the binding is what a reference belongs to. A DANGLING
    /// reference has no binding: `parse_asm_full` accepts `jmp nowhere` with zero diagnostics, and
    /// a `.tm` file mid-edit has every `goto X` dangling the moment its `state X:` header is being
    /// retyped. Grouping those by name is not a shortcut past a better answer, it is the only
    /// answer available — and the alternative that shipped first was `null`, which tells someone
    /// hunting every jump still to fix that the name under their cursor is not a name.
    ///
    /// Returns nothing for an index that is a definition or a resolved reference; those have a
    /// binding and belong to `references_to`.
    pub fn dangling_like(&self, i: usize) -> impl Iterator<Item = &Occurrence> {
        let name = match self.occurrences.get(i).map(|o| (&o.name, o.role)) {
            Some((name, Role::Reference { def: None })) => Some(name.as_str()),
            _ => None,
        };
        self.occurrences
            .iter()
            .filter(move |o| name.is_some_and(|n| o.name == n) && o.role == Role::Reference { def: None })
    }

    /// Every reference linked to `def`. **The definition itself is excluded**: whether to
    /// include it is `ReferenceContext::include_declaration`, which is the client's choice, and
    /// answering the same list either way would ignore the parameter rather than serve it.
    pub fn references_to(&self, def: usize) -> impl Iterator<Item = &Occurrence> {
        self.occurrences.iter().filter(move |o| o.role == Role::Reference { def: Some(def) })
    }
}

impl Occurrence {
    /// The kind of thing this defines, or `None` when it is a reference.
    #[must_use]
    pub fn def_kind(&self) -> Option<DefKind> {
        match self.role {
            Role::Definition { kind } => Some(kind),
            Role::Reference { .. } => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Three occurrences of one name and two of another, laid out so that every query has a
    /// wrong answer available to it. `alpha` is defined at 20..25 and referenced at 0..5 and
    /// 40..45 — a reference BEFORE its definition and one after, because a `goto` may name a
    /// state defined further down the file.
    fn fixture() -> NameIndex {
        let mut n = NameIndex::default();
        n.push_reference("alpha", Span::new(0, 5));
        n.push_definition("alpha", Span::new(20, 25), DefKind::State);
        n.push_reference("alpha", Span::new(40, 45));
        n.push_definition("beta", Span::new(60, 64), DefKind::State);
        n.push_reference("ghost", Span::new(80, 85));
        n.link();
        n
    }

    #[test]
    fn a_reference_links_to_the_definition_of_its_own_name() {
        let n = fixture();
        // Index 1 is `alpha`'s definition. Asserting the INDEX and not just the name is what
        // makes this test able to fail: every occurrence here named `alpha` would satisfy a
        // name-only assertion.
        assert_eq!(n.definition_of(0), Some(1), "the forward reference");
        assert_eq!(n.definition_of(2), Some(1), "the backward reference");
        assert_eq!(n.get(1).map(|o| o.span), Some(Span::new(20, 25)));
    }

    #[test]
    fn a_definition_is_its_own_definition() {
        let n = fixture();
        assert_eq!(n.definition_of(1), Some(1));
        assert_eq!(n.definition_of(3), Some(3));
    }

    #[test]
    fn a_reference_to_a_name_nothing_defines_links_to_nothing() {
        // NOT AN ERROR STATE. `parse_asm_full` accepts `jmp nowhere` with zero diagnostics,
        // so a dangling reference is an ordinary value this index must be able to hold.
        let n = fixture();
        assert_eq!(n.definition_of(4), None);
        assert_eq!(n.get(4).map(|o| o.role), Some(Role::Reference { def: None }));
    }

    #[test]
    fn at_finds_the_occurrence_containing_an_offset_and_nothing_outside_one() {
        let n = fixture();
        assert_eq!(n.at(0).map(|(i, _)| i), Some(0), "first byte is inside");
        assert_eq!(n.at(4).map(|(i, _)| i), Some(0), "last byte is inside");
        // ONE PAST THE LAST BYTE IS STILL THE NAME — see `at`'s doc. This assertion read
        // `n.at(5) == None, "the end is exclusive"` and pinned the defect as though it were the
        // contract: it is where the caret lands after typing a name, and answering `null` there
        // is the single most likely way a user meets this feature failing.
        assert_eq!(n.at(5).map(|(i, _)| i), Some(0), "one past the end is still the name");
        assert_eq!(n.at(6), None, "two past the end is not");
        assert_eq!(n.at(22).map(|(i, _)| i), Some(1));
        assert_eq!(n.at(19), None, "between occurrences");
        assert_eq!(n.at(9_999), None, "past everything");
    }

    #[test]
    fn references_to_lists_every_reference_and_excludes_the_definition() {
        // The definition's own inclusion is `include_declaration`'s job at the LSP layer, and
        // that is a decision the CLIENT makes. Building it in here would answer the same list
        // either way and ignore the parameter.
        let n = fixture();
        let spans: Vec<_> = n.references_to(1).map(|o| o.span).collect();
        assert_eq!(spans, vec![Span::new(0, 5), Span::new(40, 45)]);
        assert_eq!(n.references_to(3).count(), 0, "beta is defined and never referenced");
    }

    #[test]
    fn definitions_lists_only_definitions_in_source_order() {
        // NAMES CHOSEN SO SOURCE ORDER AND ALPHABETICAL ORDER DISAGREE. The shared fixture's
        // `alpha` before `beta` satisfies both, so against it this test's own name is the only
        // thing claiming source order is what is checked. Sabotage-verified: sorting
        // `definitions()` by name reddens this test and nothing else in the file.
        let mut n = NameIndex::default();
        n.push_reference("zeta", Span::new(0, 4));
        n.push_definition("zeta", Span::new(10, 14), DefKind::State);
        n.push_definition("alpha", Span::new(20, 25), DefKind::State);
        n.link();
        let names: Vec<_> = n.definitions().map(|o| o.name.as_str()).collect();
        assert_eq!(names, vec!["zeta", "alpha"], "source order, and the reference is excluded");
    }

    #[test]
    fn the_first_definition_wins_when_a_name_is_defined_twice() {
        // `.asm` accepts a duplicate label with no diagnostic at all — `labels` comes back as
        // [("f", 0), ("f", 0)] — so this is a shape the index really meets, not a hypothetical.
        // BOTH definitions stay listed; only the link is singular.
        let mut n = NameIndex::default();
        n.push_definition("f", Span::new(0, 1), DefKind::State);
        n.push_definition("f", Span::new(10, 11), DefKind::State);
        n.push_reference("f", Span::new(20, 21));
        n.link();
        assert_eq!(n.definition_of(2), Some(0), "the FIRST definition, not the last");
        assert_eq!(n.definitions().count(), 2, "both are still listed for documentSymbol");
    }

    #[test]
    fn dangling_like_groups_by_name_and_only_for_the_unresolved() {
        let mut n = NameIndex::default();
        n.push_definition("f", Span::new(0, 1), DefKind::State);
        n.push_reference("f", Span::new(10, 11));
        n.push_reference("ghost", Span::new(20, 25));
        n.push_reference("ghost", Span::new(30, 35));
        n.push_reference("other", Span::new(40, 45));
        n.link();
        // The two `ghost` mentions find each other; the one under the cursor is included, because
        // with no binding every occurrence of the name is a reference.
        assert_eq!(n.dangling_like(2).map(|o| o.span).collect::<Vec<_>>(), vec![Span::new(20, 25), Span::new(30, 35)]);
        assert_eq!(n.dangling_like(3).count(), 2, "either one gives the same set");
        assert_eq!(n.dangling_like(4).map(|o| o.span).collect::<Vec<_>>(), vec![Span::new(40, 45)], "alone");
        // A RESOLVED reference and a DEFINITION both belong to `references_to`, not here — the
        // whole reason this method may match on name is that its subjects have no binding to
        // match on instead.
        assert_eq!(n.dangling_like(1).count(), 0, "a resolved reference");
        assert_eq!(n.dangling_like(0).count(), 0, "a definition");
        assert_eq!(n.dangling_like(99).count(), 0, "out of range");
    }

    #[test]
    fn references_to_does_not_answer_by_name() {
        // The ordinary case: distinct names, each resolving to its own definition. **THIS TEST
        // DOES NOT CATCH A NAME-MATCHING `references_to`** — with one definition per name the two
        // implementations cannot disagree, and an earlier draft of this file claimed otherwise
        // here. The test that separates them is the shadowed-name one directly below; this one
        // covers that the ordinary case works at all.
        let mut n = NameIndex::default();
        n.push_definition("a", Span::new(0, 1), DefKind::State);
        n.push_definition("b", Span::new(10, 11), DefKind::State);
        n.push_reference("b", Span::new(20, 21));
        n.link();
        assert_eq!(n.references_to(0).count(), 0, "`a` has no references");
        assert_eq!(n.references_to(1).map(|o| o.span).collect::<Vec<_>>(), vec![Span::new(20, 21)]);
    }

    /// ADDED BEYOND THE BRIEF. `references_to_does_not_answer_by_name` above does not actually
    /// distinguish name-matching from link-matching: with one definition per name, `link` resolves
    /// every reference to the string's unique definition, so the two answers always agree —
    /// verified by running the sabotage it names with that test present, which still passed.
    /// Divergence needs a SHADOWED name: two definitions sharing one string, so that a name-match
    /// on the SECOND one wrongly pulls in a reference that actually links to the FIRST.
    #[test]
    fn references_to_does_not_answer_by_name_even_when_a_name_is_shadowed() {
        let mut n = NameIndex::default();
        n.push_definition("f", Span::new(0, 1), DefKind::State);
        n.push_definition("f", Span::new(10, 11), DefKind::State);
        n.push_reference("f", Span::new(20, 21));
        n.link();
        assert_eq!(
            n.references_to(0).map(|o| o.span).collect::<Vec<_>>(),
            vec![Span::new(20, 21)],
            "links to the first"
        );
        assert_eq!(n.references_to(1).count(), 0, "nothing links to the SECOND `f`, despite the name matching");
    }

    #[test]
    fn a_definition_carries_the_kind_its_parser_gave_it_and_a_reference_carries_none() {
        let mut n = NameIndex::default();
        n.push_definition("q0", Span::new(0, 2), DefKind::State);
        n.push_definition("f", Span::new(10, 11), DefKind::Fn);
        n.push_reference("q0", Span::new(20, 22));
        n.link();
        assert_eq!(n.get(0).and_then(Occurrence::def_kind), Some(DefKind::State));
        // Two kinds in one index, so an implementation that hard-codes a single constant fails here
        // rather than passing against whichever kind the first assertion happens to name.
        assert_eq!(n.get(1).and_then(Occurrence::def_kind), Some(DefKind::Fn));
        assert_eq!(n.get(2).and_then(Occurrence::def_kind), None, "a reference has no kind");
    }

    #[test]
    fn a_resolved_reference_keeps_the_link_it_was_given_and_link_is_not_called() {
        // The `.rxt` path resolves as it walks and never calls `link`. Two definitions share the
        // name, so a `link`-style first-definition-wins rule and the supplied link disagree: this
        // asserts the SECOND, which `link` could not produce.
        let mut n = NameIndex::default();
        n.push_definition("x", Span::new(0, 1), DefKind::Let);
        n.push_definition("x", Span::new(10, 11), DefKind::Let);
        n.push_resolved_reference("x", Span::new(20, 21), Some(1));
        n.push_resolved_reference("ghost", Span::new(30, 35), None);
        assert_eq!(n.definition_of(2), Some(1), "the supplied link, not the first definition");
        assert_eq!(n.definition_of(3), None);
        assert_eq!(n.references_to(1).map(|o| o.span).collect::<Vec<_>>(), vec![Span::new(20, 21)]);
        assert_eq!(n.references_to(0).count(), 0);
    }
}
