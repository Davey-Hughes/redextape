//! One grammar's identity, and the comparison machinery every grammar shares.
//!
//! **THE CAPTURE TABLE IS PER GRAMMAR AND THE MACHINERY IS NOT.** Design §5.1 records why the tables
//! cannot be shared: `@variable.parameter` is an `Ident` in the mini-language, where `class_of` calls
//! a parameter an identifier, and a `Binder` in λ, where `print_lambda_mapped` folds the bound name
//! into the binder. Both are right for their own language. What would be a defect is three copies of
//! the overlap rule, the disagreement check and the span comparison — so those live here, once.

use redextape_core::Span;
use redextape_core::analysis::TokenClass;
use tree_sitter::{Language, Parser, Query, QueryCursor, StreamingIterator, Tree};
use tree_sitter_language::LanguageFn;

/// One grammar's identity: its parser, its highlight queries, and the table that projects its
/// capture names onto `TokenClass`.
///
/// A `Grammar` carries no authority of its own — see `compare_classified` below for why that lives
/// with the caller instead.
pub struct Grammar {
    /// Names this grammar in every error message, so a failure says which one.
    pub name: &'static str,
    pub language_fn: LanguageFn,
    pub highlights: &'static str,
    pub capture_classes: &'static [(&'static str, TokenClass)],
}

impl Grammar {
    /// This grammar's `tree_sitter::Language`, built from `language_fn`.
    #[must_use]
    pub fn language(&self) -> Language {
        Language::new(self.language_fn)
    }

    /// Parse source with this grammar.
    ///
    /// # Errors
    ///
    /// Returns a message in two cases. One: the generated parser's ABI is incompatible with the
    /// linked `tree-sitter` crate — the failure a toolchain bump produces, and why this returns
    /// `Result` rather than panicking, since a bare abort here reads like a build problem rather than
    /// a version problem. Two: tree-sitter returns no tree, which it does only under a timeout or
    /// cancellation, and neither is set here. **A syntax error is neither of these.** Source that does
    /// not lex or parse cleanly still produces a `Tree`, just one containing `ERROR`/`MISSING` nodes —
    /// see `error_nodes`.
    pub fn parse(&self, src: &str) -> Result<Tree, String> {
        let mut p = Parser::new();
        p.set_language(&self.language()).map_err(|e| {
            format!("{}: the generated parser's ABI is incompatible with the linked tree-sitter crate: {e}", self.name)
        })?;
        p.parse(src, None).ok_or_else(|| {
            format!(
                "{}: tree-sitter produced no tree; it returns None only under a timeout or cancellation, and neither is set",
                self.name
            )
        })
    }

    /// Byte ranges of every `ERROR` and `MISSING` node, in offset order.
    ///
    /// A corpus entry that fails to parse would otherwise yield an empty capture list and compare
    /// equal to nothing, so the differential checks this first rather than separately.
    ///
    /// Lives on `Grammar` alongside `parse` and `captures` even though the walk itself needs no
    /// grammar-specific state — `ERROR`/`MISSING` are tree-sitter node kinds every grammar shares —
    /// so that callers write `g.error_nodes(&tree)` in the same one namespace per grammar as the rest.
    #[must_use]
    pub fn error_nodes(&self, tree: &Tree) -> Vec<Span> {
        let mut out = Vec::new();
        let mut cursor = tree.walk();
        let mut stack = vec![tree.root_node()];
        while let Some(node) = stack.pop() {
            if node.is_error() || node.is_missing() {
                out.push(Span::new(node.start_byte(), node.end_byte()));
            }
            stack.extend(node.children(&mut cursor));
        }
        out.sort_by_key(|s| s.start);
        out
    }

    /// The class a capture name projects to, or `None` if the map does not cover it.
    #[must_use]
    pub fn class_for(&self, capture: &str) -> Option<TokenClass> {
        self.capture_classes.iter().find(|(n, _)| *n == capture).map(|(_, c)| *c)
    }

    /// Every capture name this grammar's queries actually use.
    ///
    /// # Errors
    ///
    /// Returns the compile error if `highlights` is not a valid query for this grammar — which is
    /// what a query naming a node the grammar no longer has produces.
    pub fn query_capture_names(&self) -> Result<Vec<String>, String> {
        let q =
            Query::new(&self.language(), self.highlights).map_err(|e| format!("{}: highlights.scm: {e}", self.name))?;
        Ok(q.capture_names().iter().map(|n| (*n).to_string()).collect())
    }

    /// Run this grammar's highlight queries over `src` and project every capture through
    /// `self.capture_classes`.
    ///
    /// Returns offset-ordered `(Span, TokenClass)` with ONE ENTRY PER BYTE RANGE — the same shape and
    /// the same unit as `analysis::classify_source`, which is what makes the comparison in
    /// `tests/differential.rs` a direct equality rather than a reconciliation.
    ///
    /// **Overlapping captures are collapsed, and disagreement is an `Err` rather than a choice.** The
    /// broad `(identifier) @variable` pattern overlaps the role-specific ones by design; every
    /// identifier role projects to `Ident`, so collapsing is sound. Two captures on one range
    /// projecting to different classes means a query was written that this rule cannot resolve, and
    /// silently keeping one of them would make the differential compare something nobody chose.
    ///
    /// # Errors
    ///
    /// Returns a message when the query fails to compile, when `parse` fails (its two cases,
    /// documented there — NOT a syntax error: that yields `ERROR`/`MISSING` nodes from a tree `parse`
    /// still returns successfully), when a capture has no row in `self.capture_classes`, when two
    /// captures on one byte range disagree, or when the query cursor hit its match limit — which would
    /// otherwise drop captures silently and surface much later as an unexplained span-count mismatch
    /// in `compare_classified`.
    ///
    /// **THE DISAGREEMENT RULE COVERS IDENTICAL BYTE RANGES ONLY.** Every pattern the shipped queries
    /// use captures a leaf, so two captures either land on the same range or on disjoint ones. A
    /// future pattern capturing a composite node — `(call_expression) @function.call`, say — would
    /// produce an entry OVERLAPPING several others without ever comparing unequal, and the comparison
    /// would then report a span-count mismatch instead of naming the query. Capture leaves.
    pub fn captures(&self, src: &str) -> Result<Vec<(Span, TokenClass)>, String> {
        self.captures_with(self.highlights, src)
    }

    /// `captures`, over a caller-supplied query.
    ///
    /// **EXISTS SO THE DISAGREEMENT CHECK CAN BE SHOWN TO FIRE.** `a_conflicting_query_is_rejected`
    /// runs a query that captures one identifier as two classes; without this entry point that error
    /// would be unreachable from a test, and a check nobody has seen fail is a check nobody has
    /// tested.
    ///
    /// # Errors
    ///
    /// As `captures`.
    pub fn captures_with(&self, query_src: &str, src: &str) -> Result<Vec<(Span, TokenClass)>, String> {
        let lang = self.language();
        let q = Query::new(&lang, query_src).map_err(|e| format!("{}: query failed to compile: {e}", self.name))?;
        let names = q.capture_names().to_vec();
        let tree = self.parse(src)?;
        let mut cursor = QueryCursor::new();
        let mut by_span: std::collections::BTreeMap<(usize, usize), TokenClass> = std::collections::BTreeMap::new();
        let mut it = cursor.matches(&q, tree.root_node(), src.as_bytes());
        while let Some(m) = it.next() {
            for c in m.captures {
                let name = names[c.index as usize];
                let class = self
                    .class_for(name)
                    .ok_or_else(|| format!("{}: `@{name}` has no row in CAPTURE_CLASSES", self.name))?;
                let key = (c.node.start_byte(), c.node.end_byte());
                if let Some(prev) = by_span.insert(key, class)
                    && prev != class
                {
                    // `get` rather than `&src[..]`: a slice that is not on a char boundary panics, and
                    // a library path in this workspace may not panic. tree-sitter advances by
                    // codepoint so the range should always be valid, but an error path is a poor place
                    // to find out.
                    return Err(format!(
                        "{}: two captures on {}..{} (`{}`) disagree: {prev:?} and {class:?} via `@{name}`",
                        self.name,
                        key.0,
                        key.1,
                        src.get(key.0..key.1).unwrap_or("<not a char boundary>")
                    ));
                }
            }
        }
        // DELIBERATELY UNTESTED. The default `QueryCursor` match limit is `u32::MAX` and this method
        // builds its own cursor rather than taking one, so reaching the limit here would take billions
        // of matches — not reachable from this crate's tests. Widening the public API to inject a
        // cursor purely to test this branch would trade a real API for a test of a branch that cannot
        // fire in practice, so it is left as it is: an arm that exists for the day the default changes
        // or a caller-supplied cursor is added, not one this suite can currently drive.
        if cursor.did_exceed_match_limit() {
            return Err(format!("{}: the query cursor hit its match limit, so captures were dropped", self.name));
        }
        Ok(by_span.into_iter().map(|((start, end), c)| (Span::new(start, end), c)).collect())
    }

    /// Every pattern in this grammar's `highlights.scm`, exercised at least once by `corpus`.
    ///
    /// **A QUERY PATTERN NOTHING EXERCISES IS A CLAIM NOTHING CHECKS.** The λ grammar shipped one —
    /// `(parenthesized_term (identifier) @variable)` — that no corpus entry reached AND that the
    /// printer can never produce, so it had zero coverage in the whole pipeline while every test
    /// stayed green. Deleting a pattern outright was equally invisible. This is the local guard for
    /// both, and it lives on `Grammar` so a third grammar inherits it rather than rediscovering it.
    ///
    /// # Errors
    ///
    /// A message naming this grammar and the 0-based pattern indices that never matched.
    pub fn every_query_pattern_fires(&self, corpus: &[(&str, &str)]) -> Result<(), String> {
        let query =
            Query::new(&self.language(), self.highlights).map_err(|e| format!("{}: highlights.scm: {e}", self.name))?;
        let mut seen = std::collections::BTreeSet::new();
        for (name, src) in corpus {
            let tree = self.parse(src).map_err(|e| format!("{}: `{name}`: {e}", self.name))?;
            let mut cursor = QueryCursor::new();
            let mut matches = cursor.matches(&query, tree.root_node(), src.as_bytes());
            while let Some(m) = matches.next() {
                seen.insert(m.pattern_index);
            }
        }
        let missing: Vec<usize> = (0..query.pattern_count()).filter(|i| !seen.contains(i)).collect();
        if missing.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "{}: highlights.scm pattern index(es) {missing:?} (of {} total, 0-based) never matched over the corpus",
                self.name,
                query.pattern_count()
            ))
        }
    }

    // ------------------------------------------------------------------------------------------
    // FIVE CHECKS PROMOTED FROM `tests/captures.rs` AND `tests/lambda.rs`, WHERE THEY WERE
    // DUPLICATED VERBATIM. Same motive as `every_query_pattern_fires` above: none of these five
    // reads anything grammar-specific beyond `self`, so a third grammar (TM, PR 3) inherits them by
    // calling them rather than becoming a third copy-pasted copy. `a_conflicting_query_is_rejected`
    // is deliberately NOT here — see its doc comment in each `tests/*.rs` for why it must stay
    // per-grammar. Every method below returns `Result` rather than panicking: `clippy.toml` exempts
    // `unwrap`/`expect`/`panic` only inside `#[test]` fns and `#[cfg(test)]` modules, and this is
    // neither.
    // ------------------------------------------------------------------------------------------

    /// Every capture name this grammar's queries emit has a row in `capture_classes`. Adding a
    /// capture without deciding its class would otherwise colour something in an editor that the
    /// differential then silently ignores.
    ///
    /// # Errors
    ///
    /// Whatever `query_capture_names` reports, or a message naming this grammar and the capture with
    /// no row in `capture_classes`.
    pub fn capture_map_is_total(&self) -> Result<(), String> {
        for name in self.query_capture_names()? {
            if self.class_for(&name).is_none() {
                return Err(format!(
                    "{}: `@{name}` appears in highlights.scm with no entry in CAPTURE_CLASSES",
                    self.name
                ));
            }
        }
        Ok(())
    }

    /// `capture_classes` is a function: one capture name, one class.
    ///
    /// # Errors
    ///
    /// A message naming this grammar and the capture name that appears twice.
    pub fn capture_map_has_no_duplicate_keys(&self) -> Result<(), String> {
        let mut seen = std::collections::BTreeSet::new();
        for (name, _) in self.capture_classes {
            if !seen.insert(*name) {
                return Err(format!("{}: `@{name}` appears twice in CAPTURE_CLASSES", self.name));
            }
        }
        Ok(())
    }

    /// A row no query uses is a row a query edit left behind. Testable only because the tables are
    /// per-grammar — design §5.1.
    ///
    /// # Errors
    ///
    /// Whatever `query_capture_names` reports, or a message naming this grammar and the unused row.
    pub fn every_capture_row_is_used(&self) -> Result<(), String> {
        let used = self.query_capture_names()?;
        for (name, _) in self.capture_classes {
            if !used.iter().any(|u| u == name) {
                return Err(format!("{}: `@{name}` is in CAPTURE_CLASSES but no query uses it", self.name));
            }
        }
        Ok(())
    }

    /// Every corpus entry parses without producing `ERROR`/`MISSING` nodes. `parse` succeeds even on
    /// a syntax error — see its doc — so a corpus entry that stopped parsing cleanly would otherwise
    /// pass every capture-based check with a short-but-consistent list; this is what actually checks
    /// the corpus was well-formed to begin with.
    ///
    /// # Errors
    ///
    /// Whatever `parse` reports, or a message naming this grammar, the corpus entry and its
    /// error-node spans.
    pub fn every_corpus_program_parses_without_error_nodes(&self, corpus: &[(&str, &str)]) -> Result<(), String> {
        for (name, src) in corpus {
            let tree = self.parse(src)?;
            let errors = self.error_nodes(&tree);
            if !errors.is_empty() {
                return Err(format!("{}: `{name}` produced ERROR/MISSING nodes at {errors:?}", self.name));
            }
        }
        Ok(())
    }

    /// The shipped queries overlap deliberately and must agree everywhere in `corpus` — `captures`'s
    /// doc describes the disagreement rule this exercises.
    ///
    /// # Errors
    ///
    /// Whatever `captures` reports for the failing entry, prefixed with that entry's name.
    pub fn shipped_queries_never_disagree(&self, corpus: &[(&str, &str)]) -> Result<(), String> {
        for (name, src) in corpus {
            self.captures(src).map_err(|why| format!("`{name}`: {why}"))?;
        }
        Ok(())
    }
}

/// Compare a grammar's projected captures against an authority's classification of the same text.
///
/// **THE DIRECTION MATTERS.** The authority is right; this function has no opinion of its own. A
/// divergence is a defect in `grammar.js` or `highlights.scm`, never a reason to relax the
/// comparison.
///
/// The caller supplies `want` because the two authorities have different shapes: the mini-language's
/// `classify_source` is a function of source text, while λ's `print_lambda_mapped` produces the text
/// and its spans together. A single signature could not serve both without lying about one.
///
/// Parse failure is checked FIRST. A source that produces `ERROR` nodes yields a short capture list,
/// and a short list that happens to be a prefix of the truth is the shape of a comparison that passes
/// while covering nothing.
///
/// # Errors
///
/// Four distinct messages, and they are worth distinguishing because they mean different things:
///
/// - the grammar produced `ERROR`/`MISSING` nodes, so the source was never compared at all;
/// - a per-index divergence, naming the index, both texts and both classes;
/// - a length mismatch, naming which side produced more spans and the first extra one;
/// - anything `captures_with` itself reports — a query that will not compile, a capture with no row
///   in `self.capture_classes`, two captures disagreeing on one range, or the match limit.
pub fn compare_classified(g: &Grammar, query_src: &str, src: &str, want: &[(Span, TokenClass)]) -> Result<(), String> {
    let tree = g.parse(src)?;
    let errors = g.error_nodes(&tree);
    if !errors.is_empty() {
        return Err(format!("{}: the grammar produced ERROR/MISSING nodes at {errors:?}", g.name));
    }

    let got = g.captures_with(query_src, src)?;

    for (i, (w, c)) in want.iter().zip(got.iter()).enumerate() {
        if w != c {
            // `get` rather than `&src[..]` throughout: a slice off a char boundary panics, and a
            // library path in this workspace may not panic. Same rule as `captures_with`.
            return Err(format!(
                "{}: at index {i}: the authority says {:?} {:?} at {}..{}, the grammar says {:?} {:?} at {}..{}",
                g.name,
                src.get(w.0.start..w.0.end).unwrap_or("<not a char boundary>"),
                w.1,
                w.0.start,
                w.0.end,
                src.get(c.0.start..c.0.end).unwrap_or("<not a char boundary>"),
                c.1,
                c.0.start,
                c.0.end,
            ));
        }
    }
    if want.len() != got.len() {
        let (longer, which) = if want.len() > got.len() { (want, "the authority") } else { (&got[..], "the grammar") };
        let extra = &longer[want.len().min(got.len())..];
        let first = extra.first().ok_or_else(|| {
            format!("{}: unreachable: the lengths differ, so the longer side has at least one extra span", g.name)
        })?;
        return Err(format!(
            "{}: {which} produced {} more span(s); the first is {:?} at {}..{}",
            g.name,
            extra.len(),
            src.get(first.0.start..first.0.end).unwrap_or("<not a char boundary>"),
            first.0.start,
            first.0.end,
        ));
    }
    Ok(())
}
