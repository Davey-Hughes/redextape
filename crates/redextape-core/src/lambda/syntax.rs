//! The human-readable, runnable lambda text form: `var`, `λx. e`, application by juxtaposition
//! (left-assoc), parens. Parsing resolves names to de Bruijn indices; printing regenerates readable
//! names from binder hints. Printer and parser round-trip (§7.2).
//!
//! BINDER SPELLING IS ASYMMETRIC ON PURPOSE. The parser accepts `\` and `λ` interchangeably; the
//! printer emits only `λ`. So `λ` is the canonical form — what a golden file, a demo, or a CLI dump
//! shows — while `\` stays a permanent input alias, because it is what a keyboard types. This costs
//! nothing to keep: `\` is one more arm on the same match, and the round-trip property is unaffected
//! either way (printed output uses `λ`, which the parser reads back identically).
//!
//! IDENTIFIERS. An identifier starts with an ASCII letter, `_`, or `$`, and continues with those plus
//! ASCII digits. `$` is there because the lowering names its store-passing binder `$store`
//! (`lower.rs`); it is the project's marker for a compiler-generated name the surface syntax cannot
//! forge, so a printed lowering never collides with a source identifier. Whitespace separates
//! identifiers; `\`, `λ`, `.`, `(` and `)` terminate one.
//!
//! NAMES AND SCOPE — the rule that makes printed output unambiguous, stated because a reader that did
//! not write the printer needs it. `print_lambda` guarantees **no binder shares a name with any binder
//! enclosing it**: `fresh` takes the binder's hint — or `v`, if the hint is empty — and, if that name is
//! already in scope, appends the least `k >= 0` such that the hint with `k`'s digits directly appended
//! is unused (hint `x` collides, so `x0`, then `x1`, …; no separator). So an occurrence resolves to the
//! NEAREST enclosing binder with that name, and the parser's rightmost-in-scope match is exact rather
//! than a convention. A name MAY be reused in a disjoint scope (`(\x. x) (\x. x)`), which is why the
//! rule is about enclosing binders and not about the term as a whole.
//!
//! A FREE variable has no name to print and comes out as `?<index>`, which is not a valid identifier —
//! deliberately, so an open term fails to reparse loudly rather than silently rebinding. Everything the
//! backend produces is closed.
//!
//! THIS TEXT FORM CARRIES NO RESULT TYPE, and one is required to interpret what it denotes: the value
//! encodings collide, so `\a.\b. b` is `false` and `church(0)` at once, and `\a.\b. a` is `true` and
//! `nil` at once. Parsing and printing are unaffected — the terms round-trip exactly — but a reader
//! that intends to DECODE a term to a value needs the type from its caller. See `encode.rs`'s module
//! doc for the full statement.

use std::collections::BTreeMap;

use crate::analysis::push_span;
use crate::core::NodeId;
use crate::diagnostic::Diagnostic;
use crate::lambda::reduce::MAX_TERM_DEPTH;
use crate::lambda::term::{Dir, LambdaTerm, Node, Path, abs, app, var};
use crate::span::Span;

/// Nesting-depth guard for the recursive-descent parser (mirrors the source parser). Tuned below
/// the native stack-overflow depth; raise only with a larger stack (see Plan 1).
pub const MAX_PARSE_DEPTH: u32 = 256;

pub fn parse_lambda(src: &str) -> (Option<LambdaTerm>, Vec<Diagnostic>) {
    let mut p = Parser { src, chars: src.char_indices().collect(), pos: 0, depth: 0 };
    match p.parse_term(&mut Vec::new()) {
        Ok(t) => {
            p.skip_ws();
            if p.pos < p.chars.len() {
                let span = Span::new(p.byte_pos(), src.len());
                (None, vec![Diagnostic::error(span, "unexpected trailing input")])
            } else {
                (Some(t), Vec::new())
            }
        }
        Err(d) => (None, vec![d]),
    }
}

struct Parser<'a> {
    src: &'a str,
    chars: Vec<(usize, char)>,
    pos: usize,
    depth: u32,
}

type PResult<T> = Result<T, Diagnostic>;

impl Parser<'_> {
    fn byte_pos(&self) -> usize {
        self.chars.get(self.pos).map_or(self.src.len(), |(b, _)| *b)
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).map(|(_, c)| *c)
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(c) if c.is_whitespace()) {
            self.pos += 1;
        }
    }

    fn err(&self, msg: &str) -> Diagnostic {
        Diagnostic::error(Span::new(self.byte_pos(), self.byte_pos()), msg)
    }

    /// term := application (one or more atoms, left-associative)
    fn parse_term(&mut self, scope: &mut Vec<String>) -> PResult<LambdaTerm> {
        self.depth += 1;
        if self.depth > MAX_PARSE_DEPTH {
            self.depth -= 1;
            return Err(self.err("expression nested too deeply"));
        }
        let r = self.parse_application(scope);
        self.depth -= 1;
        r
    }

    fn parse_application(&mut self, scope: &mut Vec<String>) -> PResult<LambdaTerm> {
        let mut term = self.parse_atom(scope)?;
        loop {
            self.skip_ws();
            match self.peek() {
                Some(c) if c == '\\' || c == 'λ' || c == '(' || is_ident_start(c) => {
                    let arg = self.parse_atom(scope)?;
                    term = app(term, arg);
                }
                _ => break,
            }
        }
        Ok(term)
    }

    fn parse_atom(&mut self, scope: &mut Vec<String>) -> PResult<LambdaTerm> {
        self.skip_ws();
        match self.peek() {
            Some('\\') | Some('λ') => self.parse_abstraction(scope),
            Some('(') => {
                self.bump();
                let t = self.parse_term(scope)?;
                self.skip_ws();
                if self.bump() != Some(')') {
                    return Err(self.err("expected `)`"));
                }
                Ok(t)
            }
            Some(c) if is_ident_start(c) => {
                let start = self.byte_pos();
                let name = self.parse_ident();
                match scope.iter().rposition(|n| *n == name) {
                    Some(pos) => Ok(var((scope.len() - 1 - pos) as u32)),
                    None => {
                        Err(Diagnostic::error(Span::new(start, self.byte_pos()), format!("unbound variable `{name}`")))
                    }
                }
            }
            _ => Err(self.err("expected a term")),
        }
    }

    fn parse_abstraction(&mut self, scope: &mut Vec<String>) -> PResult<LambdaTerm> {
        self.bump(); // \ or λ
        self.skip_ws();
        if !matches!(self.peek(), Some(c) if is_ident_start(c)) {
            return Err(self.err("expected a parameter name"));
        }
        let name = self.parse_ident();
        self.skip_ws();
        if self.bump() != Some('.') {
            return Err(self.err("expected `.`"));
        }
        scope.push(name.clone());
        let body = self.parse_term(scope);
        scope.pop();
        Ok(abs(name, body?))
    }

    fn parse_ident(&mut self) -> String {
        let mut s = String::new();
        while let Some(c) = self.peek().filter(|c| is_ident_continue(*c)) {
            self.bump();
            s.push(c);
        }
        s
    }
}

fn is_ident_start(c: char) -> bool {
    c == '_' || c == '$' || c.is_ascii_alphabetic()
}

fn is_ident_continue(c: char) -> bool {
    c == '_' || c == '$' || c.is_ascii_alphanumeric()
}

/// Print a term with readable names, freshening on shadow collision, minimal parens. Binders print as
/// `λ`, never `\` — see the module doc on why input accepts both and output picks one.
pub fn print_lambda(t: &LambdaTerm) -> String {
    print_lambda_mapped(t).0
}

/// `print_lambda_mapped`, bounded. Returns the text, its spans, and which limit cut the walk, if any.
///
/// THE BUDGET IS ENFORCED DURING THE WALK, WHICH IS THE ENTIRE POINT. Truncating the string this
/// function returns would be useless: `write_term` recurses over the term's LOGICAL size, and the
/// in-memory term is a shared DAG, so a caller that lets the walk finish has already paid the
/// exponential allocation the budget exists to prevent. This is the same quantity four falsified λ
/// designs on this thread were aimed at, and the one `maxfree`/`depth` short-circuit to avoid touching.
///
/// THE OVERSHOOT IS BOUNDED BY AT MOST ONE BINDER PREFIX, not one token. The `Abs` arm writes `λ`, the
/// binder's name, `.`, and its trailing space as a group behind a single check — splitting it with a
/// check between each write would leave a dangling `λ` on truncation, which is worse than the whole
/// prefix. Its size is `2 + |name| + 2` bytes (`λ` is two bytes in UTF-8), and `|name|` is a source
/// identifier with no length cap, so a long variable name makes the overshoot on any one print
/// arbitrarily large.
///
/// WHAT STILL HOLDS, and is the guarantee a caller budgeting memory actually needs: overshoot is a
/// per-print constant. It does not grow with term size, nesting depth, or argument count, because the
/// only two writes that happen on an UNWIND path — the `App` arm's separator and `parenthesized`'s
/// closing paren — are both guarded by a re-check.
///
/// THE BUDGET ALONE DOES NOT BOUND RECURSION, WHICH IS WHY A DEPTH COUNTER RIDES ALONGSIDE IT. A
/// left-nested spine — `write_app_fn` delegating into `write_term` down the function-position chain,
/// exactly the shape `lower.rs`'s `Core::Apply` builds — writes ZERO bytes while descending: every
/// frame calls `write_app_fn`/`write_term` again before it writes anything of its own, so `out.len() >=
/// budget` cannot fire during that descent no matter how small `byte_budget` is. Native recursion depth
/// there equals the spine length, and a spine of 100,000 juxtaposed atoms overflows the stack before
/// the budget ever gets a chance to look at `out`. A `depth` counter threaded alongside `budget` through
/// `write_term`, `write_app_fn`, `write_atom` and `parenthesized` — incremented once per `Abs`/`App`
/// level, checked at the top of each function next to the budget check — catches this independently:
/// past the caller's `depth_cap`, the walk stops and records `Cut::Depth` the same way the budget
/// records `Cut::Bytes`. See [`Cut`]'s doc for why a caller needs to tell the two apart, and can.
///
/// The cut is not byte-exact for the same reason: the check happens between pushes (or, for the binder
/// prefix, between push-groups), so whatever was in progress finishes. Cutting mid-token would split a
/// `λ` — two bytes in UTF-8 — and produce a `String` that is not valid UTF-8 at all.
///
/// TRUNCATED OUTPUT IS NOT SAFE TO REPARSE, AND THE TWO PRODUCERS FAIL DIFFERENTLY. Only the BUDGET
/// re-check gates a `parenthesized` frame's closing paren (`out.len() >= budget`, above); the DEPTH
/// check has no matching re-check there, so on a depth bail every `parenthesized` frame still open
/// closes its `)` normally as the stack unwinds. A budget-truncated string is therefore reliably
/// malformed — an unclosed paren — and fails to reparse loudly. A DEPTH-truncated string can come out
/// well-formed: syntactically valid λ text that reparses successfully into a DIFFERENT, shorter term
/// than the one this call actually printed, silently. That is more dangerous than the budget case, not
/// less, so the advice does not soften for it: do not pass output from a call where `cut` came back
/// `Some`, for either reason, to `parse_lambda`.
pub fn print_lambda_capped(
    t: &LambdaTerm,
    byte_budget: usize,
    depth_cap: u32,
) -> (String, crate::analysis::Classified, Option<Cut>) {
    let want: BTreeMap<NodeId, Path> = BTreeMap::new();
    let (text, spans, cut, _) = print_lambda_linked(t, byte_budget, depth_cap, &want);
    (text, spans, cut)
}

/// `print_lambda`, plus a class per span. Spans are pushed as text is appended, so offsets are exact by
/// construction; `λ` is multi-byte, so nothing here may assume one byte per character.
///
/// One walker, not two: this is `print_lambda_capped` at a budget no real term reaches, so there is
/// nothing here that can drift from the capped path — the property `an_unreachable_budget_is_identical
/// _to_the_uncapped_printer` pins.
pub fn print_lambda_mapped(t: &LambdaTerm) -> (String, crate::analysis::Classified) {
    let (text, spans, _) = print_lambda_capped(t, usize::MAX, MAX_TERM_DEPTH);
    (text, spans)
}

/// `print_lambda_capped`, plus the byte span of every subterm the caller named by path.
///
/// WHAT THIS IS FOR. `SourceMap::node_to_lambda` locates a Core node's subterm as a `Path`, and
/// highlighting it in printed text needs a byte `Span`. Nothing correlated the two until this
/// function; `viewmodel.rs`'s no-`redex` doc is where that gap was priced. Plan 5b's click-linking is
/// the consumer.
///
/// `want` IS KEYED BY `NodeId` AND INVERTED HERE, rather than taken pre-inverted, so a caller cannot
/// get the inversion wrong. Two nodes may name the same path — a transparent wrapper lowers to the
/// subterm it wraps — and the inversion keeps the FIRST by node id, which is the same rule
/// `sourcemap::lambda_half` applies when two paths name one node.
///
/// **A NODE PAST THE TRUNCATION CUT RECORDS NOTHING**, rather than a span clamped to where the walk
/// stopped. A clamped span would say "this subterm ends here", which is false; absence says "this
/// subterm is not shown", which is true. The same rule holds for a node whose walk was interrupted by
/// the DEPTH bail partway through a descendant: its own span would be incomplete, so it is not
/// recorded either.
///
/// **A RECORDED SPAN INCLUDES THE NODE'S OWN PARENTHESES.** `parens` writes `(` before delegating, and
/// the entry mark is taken outside it. Lighting `f x` but not the parens around it names a different
/// subterm than the one at that path.
///
/// Cost is one walk, the walk that was already happening. `want` is `SourceMap::node_to_lambda`, which
/// the demo corpus measures at 5-403 entries.
pub fn print_lambda_linked(
    t: &LambdaTerm,
    byte_budget: usize,
    depth_cap: u32,
    want: &BTreeMap<NodeId, Path>,
) -> (String, crate::analysis::Classified, Option<Cut>, Vec<(Span, NodeId)>) {
    let mut by_path: BTreeMap<&Path, NodeId> = BTreeMap::new();
    for (id, path) in want {
        by_path.entry(path).or_insert(*id);
    }
    let mut p = Printer {
        names: Vec::new(),
        out: String::new(),
        spans: Vec::new(),
        budget: byte_budget,
        depth_cap,
        cut: None,
        path: Path::new(),
        want: &by_path,
        nodes: Vec::new(),
    };
    p.node(t, 0, Role::Term);
    (p.out, p.spans, p.cut, p.nodes)
}

/// Where a node sits in its parent, which is what decides whether it needs parentheses.
#[derive(Clone, Copy)]
enum Role {
    /// The root, an `Abs` body, or the inside of a paren pair: never parenthesized by its position.
    Term,
    /// The function position of an application: an abstraction there needs parens.
    AppFn,
    /// An argument: abstractions and applications need parens.
    Atom,
}

/// Why a bounded print stopped early. `None` means it ran to completion.
///
/// **THE TWO ARE NOT INTERCHANGEABLE, WHICH IS WHY THIS IS NOT A BOOL.** Only the byte re-check gates
/// a `parens` frame's closing paren, so a `Bytes` cut is reliably malformed — an unclosed paren — and
/// fails to reparse loudly. On a `Depth` cut every enclosing `parens` frame closes its `)` as the
/// stack unwinds, so the text can come out WELL-FORMED: valid λ text that reparses into a different,
/// shorter term than the one printed. That is the more dangerous of the two, and a caller that cannot
/// tell them apart cannot defend against it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Cut {
    Bytes,
    Depth,
}

/// The printer's state, threaded as one receiver rather than as seven parameters.
///
/// A STRUCT BECAUSE THE PARAMETER LIST RAN OUT, and the shape is otherwise unchanged. The four walker
/// functions already carried seven arguments each; recording spans needs two more (the current path,
/// and somewhere to put the results) and `clippy::too_many_arguments` denies at eight. Every field
/// here was already threaded through every call, unchanged or mutated in place, so collapsing them
/// costs nothing but the receiver.
struct Printer<'a> {
    names: Vec<String>,
    out: String,
    spans: crate::analysis::Classified,
    budget: usize,
    /// The deepest `Abs`/`App` level this walk may reach. **The caller's number, not
    /// `MAX_TERM_DEPTH`** — that constant bounds the REDUCER's recursion against a native stack, and
    /// a printer running on a browser engine's call stack needs a different, smaller one. See
    /// `redextape_wasm::session::MAX_PRINT_DEPTH`.
    depth_cap: u32,
    cut: Option<Cut>,
    /// The path from the root to the node being written. Pushed and popped at exactly the three
    /// points `Dir` names, and at no others — the dispatch hops in `node` are the SAME node.
    path: Path,
    want: &'a BTreeMap<&'a Path, NodeId>,
    nodes: Vec<(Span, NodeId)>,
}

// `depth` counts `Abs`/`App` levels from the root (0 there), one native call apart from the true
// recursion depth only by the fixed dispatch hops below — `node` and `parens` pass it through
// UNCHANGED when they delegate on the SAME node (a different method, not a deeper term), and only
// `write`'s `Abs` and `App` arms increment it, matching exactly the unit `LambdaTerm::depth` counts.
// Checked at the top of `node`, `write` and `parens`, right next to the budget check, so a term whose
// recursion the budget cannot bound (see the left-nested-spine paragraph on `print_lambda_capped`'s
// doc) still stops well short of a native stack overflow.
impl Printer<'_> {
    /// FIRST CAUSE WINS — see `when_both_limits_fire_the_byte_cause_is_the_one_reported`.
    fn set_cut(&mut self, c: Cut) {
        if self.cut.is_none() {
            self.cut = Some(c);
        }
    }

    /// The one bail site's condition, in one place so the three walkers cannot drift apart. Bytes is
    /// tested first, which is what makes `Bytes` the answer when both would fire.
    fn bail(&mut self, depth: u32) -> bool {
        if self.out.len() >= self.budget {
            self.set_cut(Cut::Bytes);
            return true;
        }
        if depth > self.depth_cap {
            self.set_cut(Cut::Depth);
            return true;
        }
        false
    }

    /// Write `t` in `role`, recording its span if the caller asked for this path.
    ///
    /// THE ONE RECORDING SITE. Every node reaches the printer through exactly one call here, so the
    /// span recorded covers everything written for that subterm — including any parentheses `role`
    /// causes. `parens` delegates to `write` rather than back to `node`, which is what stops a
    /// parenthesized node being recorded twice, the second time without its parens.
    fn node(&mut self, t: &LambdaTerm, depth: u32, role: Role) {
        if self.bail(depth) {
            return;
        }
        let start = self.out.len();
        match role {
            Role::Term => self.write(t, depth),
            Role::AppFn => match t.node() {
                Node::Abs(..) => self.parens(t, depth),
                _ => self.write(t, depth),
            },
            Role::Atom => match t.node() {
                Node::Var(_) => self.write(t, depth),
                _ => self.parens(t, depth),
            },
        }
        if self.cut.is_some() {
            return;
        }
        if let Some(&id) = self.want.get(&self.path) {
            self.nodes.push((Span::new(start, self.out.len()), id));
        }
    }

    fn write(&mut self, t: &LambdaTerm, depth: u32) {
        if self.bail(depth) {
            return;
        }
        use crate::analysis::TokenClass as C;
        match t.node() {
            Node::Var(i) => {
                let idx = self.names.len().checked_sub(1 + *i as usize);
                let name = idx.and_then(|k| self.names.get(k)).cloned().unwrap_or_else(|| format!("?{i}"));
                push_span(&mut self.out, &mut self.spans, &name, C::Ident);
            }
            Node::Abs(hint, body) => {
                let name = fresh(hint, &self.names);
                push_span(&mut self.out, &mut self.spans, "\u{3bb}", C::Binder);
                push_span(&mut self.out, &mut self.spans, &name, C::Binder);
                // The binder's `.` is punctuation, classified like the `(` and `)` in `parens` and
                // like the TM printer's `:`/`,`/`->`. The space after it is whitespace and stays
                // outside the span: §6 asks for coverage of everything EXCEPT whitespace.
                push_span(&mut self.out, &mut self.spans, ".", C::Punct);
                self.out.push(' ');
                self.names.push(name);
                self.path.push(Dir::AbsBody);
                self.node(body, depth + 1, Role::Term);
                self.path.pop();
                self.names.pop();
            }
            Node::App(f, a, _) => {
                self.path.push(Dir::AppL);
                self.node(f, depth + 1, Role::AppFn);
                self.path.pop();
                // Re-checked for the same reason `parens` re-checks before its closing paren, and this
                // is the LEFT-nested mirror of that case. `lower.rs`'s `Core::Apply` builds
                // `term = app(term, la)` in a loop, so `f(a, b, c)` is `App(App(App(f,a),b),c)`;
                // without this check every enclosing frame pushes its separator as the stack unwinds,
                // and the overshoot the doc comment bounds at one binder prefix becomes one space PER
                // ARGUMENT. Depth is deliberately NOT re-checked here: `f` and `a` are both visited at
                // `depth + 1`, so a bail exactly at that depth fires identically for both, and the
                // effect is one stray space at the frontier bail site rather than a correctness gap —
                // `cut` is already set by whichever call bailed.
                if self.out.len() >= self.budget {
                    self.set_cut(Cut::Bytes);
                    return;
                }
                self.out.push(' ');
                self.path.push(Dir::AppR);
                self.node(a, depth + 1, Role::Atom);
                self.path.pop();
            }
        }
    }

    fn parens(&mut self, t: &LambdaTerm, depth: u32) {
        if self.bail(depth) {
            return;
        }
        use crate::analysis::TokenClass as C;
        push_span(&mut self.out, &mut self.spans, "(", C::Punct);
        self.write(t, depth);
        // Re-checked, not assumed: without this, a budget that fired partway through `write` above
        // would still be followed by an unconditional `)`, and every enclosing `parens` frame on the
        // call stack would do the same as it unwound — turning "one binder prefix of overshoot" into
        // one closing paren PER NESTING LEVEL for a right-nested term (exactly the application chains
        // a Church numeral or a cons chain builds). This is what keeps the bound the doc comment
        // states actually true.
        if self.out.len() >= self.budget {
            self.set_cut(Cut::Bytes);
            return;
        }
        push_span(&mut self.out, &mut self.spans, ")", C::Punct);
    }
}

fn fresh(hint: &str, names: &[String]) -> String {
    let base = if hint.is_empty() { "v" } else { hint };
    if !names.iter().any(|n| n == base) {
        return base.to_string();
    }
    // PIGEONHOLE, which is what lets this be a bounded loop rather than `0..` with an `unreachable!()`
    // tail: `names` holds at most `names.len()` strings, so among the `names.len() + 1` candidates
    // `base0 ..= base{names.len()}` at least one is unused. The search cannot fall through.
    //
    // The fallthrough therefore returns a value instead of panicking. It is unreachable by the argument
    // above, and a panic here would be a library-path abort in a printer — the one place a caller has
    // no way to recover — for a case that cannot arise.
    for k in 0..=names.len() {
        let cand = format!("{base}{k}");
        if !names.contains(&cand) {
            return cand;
        }
    }
    base.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_ok(src: &str) -> LambdaTerm {
        let (t, ds) = parse_lambda(src);
        assert!(ds.is_empty(), "diagnostics: {ds:?}");
        t.expect("expected a term")
    }

    #[test]
    fn parses_identity_and_application() {
        assert_eq!(parse_ok("\\x. x"), abs("x", var(0)));
        // application is left-associative: a b c == (a b) c, with a,b,c bound
        assert_eq!(parse_ok("\\a.\\b.\\c. a b c"), abs("a", abs("b", abs("c", app(app(var(2), var(1)), var(0))))));
    }

    #[test]
    fn accepts_unicode_lambda() {
        assert_eq!(parse_ok("λx. x"), abs("x", var(0)));
    }

    /// The printer emits `λ` and the parser accepts both spellings. This is the ONLY test that pins
    /// either half: every other printing test is a round-trip or idempotency property, and those hold
    /// just as well if the printer emits `\` — so a silent revert to `\`, or a parser that quietly
    /// dropped the ASCII alias, would leave the whole suite green without this.
    #[test]
    fn prints_lambda_but_accepts_both_binder_spellings() {
        let printed = print_lambda(&abs("x", var(0)));
        assert_eq!(printed, "λx. x");
        assert!(!printed.contains('\\'), "the printer must not emit a backslash binder: {printed:?}");
        // `\` stays a permanent input alias and denotes exactly the same term.
        assert_eq!(parse_ok("\\x. x"), parse_ok("λx. x"));
        // Mixed spellings in one term are fine — the two chars are interchangeable on input.
        assert_eq!(parse_ok("\\a. λb. a b"), parse_ok("λa. λb. a b"));
    }

    #[test]
    fn free_variable_is_a_diagnostic() {
        let (t, ds) = parse_lambda("\\x. y");
        assert!(t.is_none());
        assert!(ds.iter().any(|d| d.message.contains("unbound")), "diags: {ds:?}");
    }

    #[test]
    fn print_then_parse_round_trips() {
        let terms = [
            abs("x", var(0)),
            abs("f", abs("x", app(var(1), app(var(1), var(0))))), // church 2
            app(abs("x", var(0)), abs("y", var(0))),
        ];
        for t in terms {
            let printed = print_lambda(&t);
            let (reparsed, ds) = parse_lambda(&printed);
            assert!(ds.is_empty(), "printed {printed:?} -> diags {ds:?}");
            assert_eq!(reparsed.unwrap(), t, "round-trip failed for {printed:?}");
        }
    }

    #[test]
    fn print_is_idempotent() {
        let t = abs("f", abs("x", app(var(1), app(var(1), var(0)))));
        let once = print_lambda(&t);
        let (t2, _) = parse_lambda(&once);
        assert_eq!(print_lambda(&t2.unwrap()), once);
    }

    /// The text form must be able to express what this backend's own lowering emits. It could not:
    /// `lower.rs` binds store-passing state under `$store`, and the lexer below accepted only `_` and
    /// ASCII alphanumerics, so `parse_lambda` rejected `print_lambda`'s output — with `expected a
    /// parameter name` — for every program with mutable state. `parse_print_round_trips` missed it
    /// because its generator only ever emitted the hints `v` and `x`.
    #[test]
    fn printed_lowering_of_every_demo_reparses() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        let demos = [
            "1 + 2 * 3",
            "let x = 1; let y = x + x; y * 3",
            "let mut x = 1; x = x + 10; x = x * 2; x",
            "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
            "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
            "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
            "[1, 2, 3]",
        ];
        for src in demos {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
            let term = lower(&desugar(&prog.unwrap())).expect("every demo lowers");
            let printed = print_lambda(&term);
            let (reparsed, ds) = parse_lambda(&printed);
            assert!(ds.is_empty(), "printed lowering of {src:?} does not reparse: {ds:?}\n{printed}");
            assert_eq!(reparsed.unwrap(), term, "round-trip changed the term for {src:?}");
        }
    }

    #[test]
    fn unbound_variable_span_covers_the_identifier() {
        let src = "\\x. foo";
        let (t, ds) = parse_lambda(src);
        assert!(t.is_none());
        assert_eq!(ds.len(), 1);
        assert_eq!(&src[ds[0].span.start..ds[0].span.end], "foo", "span: {:?}", ds[0].span);
    }

    #[test]
    fn malformed_input_never_panics() {
        // Reaching the end without a panic is the assertion; each must yield diagnostics.
        for src in ["(x", "\\", "\\x", "\\x.", "", ")", "\\. x", "x y z ("] {
            let (_t, ds) = parse_lambda(src);
            let _ = ds;
        }
        assert!(!parse_lambda("(x").1.is_empty(), "unclosed paren should diagnose");
    }

    #[test]
    fn deeply_nested_parens_are_a_diagnostic_not_a_stack_overflow() {
        // 1000 nested parens trips MAX_PARSE_DEPTH (256) long before any native overflow.
        let n = 1000usize;
        let src = format!("{}x{}", "(".repeat(n), ")".repeat(n));
        let (_t, ds) = parse_lambda(&src);
        assert!(ds.iter().any(|d| d.message.contains("too deeply")), "diags: {ds:?}");
    }

    use proptest::prelude::*;

    /// Binder hints the generator draws from. A single fixed hint (what this used to use) can produce
    /// neither a `$`-prefixed lowering name nor a shadow collision, so it could not have caught either
    /// the lexer gap above or a freshening bug. Drawing independently at each binder means nested
    /// repeats — and therefore `fresh`'s rename path — occur naturally.
    const HINTS: [&str; 4] = ["v", "x", "$store", "_a1"];

    /// Generate closed de Bruijn terms of bounded depth.
    fn closed_term() -> impl Strategy<Value = LambdaTerm> {
        fn go(depth: u32, binders: u32) -> BoxedStrategy<LambdaTerm> {
            if depth == 0 {
                // Base case: a bound variable if any binder is in scope, else a trivial closed term.
                return if binders == 0 { Just(abs("x", var(0))).boxed() } else { (0..binders).prop_map(var).boxed() };
            }
            let abs_strat = (go(depth - 1, binders + 1), 0..HINTS.len()).prop_map(|(b, i)| abs(HINTS[i], b)).boxed();
            if binders == 0 {
                // No variable is in scope yet, so a closed term MUST introduce a binder here.
                return abs_strat;
            }
            let var_strat = (0..binders).prop_map(var).boxed();
            let app_strat = (go(depth - 1, binders), go(depth - 1, binders)).prop_map(|(f, a)| app(f, a)).boxed();
            prop_oneof![var_strat, abs_strat, app_strat].boxed()
        }
        go(4, 0)
    }

    proptest! {
        #[test]
        fn parse_print_round_trips(t in closed_term()) {
            let printed = print_lambda(&t);
            let (reparsed, ds) = parse_lambda(&printed);
            prop_assert!(ds.is_empty(), "printed {printed:?} -> {ds:?}");
            prop_assert_eq!(reparsed.unwrap(), t);
        }

        #[test]
        fn print_is_idempotent_prop(t in closed_term()) {
            let once = print_lambda(&t);
            let (t2, _) = parse_lambda(&once);
            prop_assert_eq!(print_lambda(&t2.unwrap()), once);
        }
    }

    #[test]
    fn print_lambda_mapped_agrees_and_classifies_binders_and_variables() {
        use crate::analysis::TokenClass;
        let t = abs("f", abs("x", app(var(1), var(0))));
        let (text, spans) = print_lambda_mapped(&t);
        assert_eq!(text, print_lambda(&t), "the wrapper must return the mapped form's text verbatim");
        assert_eq!(text, "λf. λx. f x");
        for w in spans.windows(2) {
            assert!(w[0].0.end <= w[1].0.start, "spans overlap or are unordered: {:?} then {:?}", w[0], w[1]);
        }
        let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&text[s.start..s.end], *c)).collect();
        // ASSERT THE WHOLE SEQUENCE, not "some span has this class". Task 6 found the weaker style
        // vacuous: `named.contains(&("done", Label))` passed even with every operand deliberately
        // misclassified, because `"done"` also occurs as its own label definition. Here `f` occurs twice —
        // once as a binder, once as a variable — so any per-text assertion is satisfied by the wrong
        // occurrence. Only the full ordered sequence pins which is which.
        assert_eq!(
            named,
            vec![
                ("λ", TokenClass::Binder),
                ("f", TokenClass::Binder),
                (".", TokenClass::Punct),
                ("λ", TokenClass::Binder),
                ("x", TokenClass::Binder),
                (".", TokenClass::Punct),
                ("f", TokenClass::Ident),
                ("x", TokenClass::Ident),
            ]
        );
    }

    /// The term above needs no parentheses, so nothing there pins that `(` and `)` are classified at
    /// all: deleting their spans entirely leaves the printed text unchanged and every other assertion
    /// satisfied. This term forces parens in BOTH positions the printer inserts them — an abstraction
    /// in function position and one in argument position — and asserts the whole sequence, so a
    /// dropped or misplaced paren span fails here.
    #[test]
    fn print_lambda_mapped_classifies_the_parentheses_it_inserts() {
        use crate::analysis::TokenClass;
        let t = app(abs("x", var(0)), abs("y", var(0)));
        let (text, spans) = print_lambda_mapped(&t);
        assert_eq!(text, print_lambda(&t), "the wrapper must return the mapped form's text verbatim");
        assert_eq!(text, "(λx. x) (λy. y)");
        let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&text[s.start..s.end], *c)).collect();
        assert_eq!(
            named,
            vec![
                ("(", TokenClass::Punct),
                ("λ", TokenClass::Binder),
                ("x", TokenClass::Binder),
                (".", TokenClass::Punct),
                ("x", TokenClass::Ident),
                (")", TokenClass::Punct),
                ("(", TokenClass::Punct),
                ("λ", TokenClass::Binder),
                ("y", TokenClass::Binder),
                (".", TokenClass::Punct),
                ("y", TokenClass::Ident),
                (")", TokenClass::Punct),
            ]
        );
    }

    #[test]
    fn print_lambda_mapped_spans_stay_in_bounds_on_every_demo() {
        for src in ["1 + 2 * 3", "3 - 5", "let x = 1; let y = x + x; y * 3", "[1, 2, 3]"] {
            let (prog, ds) = crate::parser::parse(src);
            assert!(ds.is_empty(), "parse errors in {src:?}: {ds:?}");
            let term = crate::lambda::lower(&crate::desugar::desugar(&prog.unwrap())).expect("lowers");
            let (text, spans) = print_lambda_mapped(&term);
            assert_eq!(text, print_lambda(&term), "text differs for {src:?}");
            for (s, _) in &spans {
                assert!(s.end <= text.len() && s.start < s.end, "{src:?}: bad span {s:?}");
                assert!(text.is_char_boundary(s.start) && text.is_char_boundary(s.end), "{src:?}: {s:?} splits a char");
            }
        }
    }

    /// The depth bound is the CALLER'S, not `MAX_TERM_DEPTH`. Driving it at 3 rather than at 3,000 is
    /// the whole reason it became a parameter: the branch is reachable without building a term deep
    /// enough to be a hazard in its own right.
    #[test]
    fn the_depth_cap_is_the_callers_number() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        let (program, ds) = parse("10");
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let t = lower(&desugar(&program.expect("parsed"))).expect("a numeral lowers");

        let (_, _, uncapped) = print_lambda_capped(&t, usize::MAX, MAX_TERM_DEPTH);
        assert!(uncapped.is_none(), "an unreachable budget and an unreachable depth must not report truncation");

        let (shallow, _, capped) = print_lambda_capped(&t, usize::MAX, 3);
        assert_eq!(capped, Some(Cut::Depth), "a depth cap of 3 must fire on a term deeper than 3");
        assert!(!shallow.is_empty(), "the walk still writes what it reached before bailing");
    }

    #[test]
    fn capped_printing_stops_at_the_budget_and_says_so() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        // A flat 200-element list, then `head` of it. There is no `0..200` range-literal syntax in this
        // parser (list literals are only comma-separated `[a, b, c]`), so this builds the same shape —
        // a sizeable first-order term with no recursion — the way `printed_lowering_of_every_demo_reparses`
        // builds every other term here: `parse` -> `desugar` -> `lower`, inline.
        let items = (0..200).map(|i| i.to_string()).collect::<Vec<_>>().join(", ");
        let src = format!("let xs = [{items}]; head(xs)");
        let (program, ds) = parse(&src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let t = lower(&desugar(&program.expect("parsed"))).expect("first-order demo lowers");

        let (full, _, full_truncated) = print_lambda_capped(&t, usize::MAX, MAX_TERM_DEPTH);
        assert!(full_truncated.is_none(), "an unreachable budget must not report truncation");

        let (short, spans, truncated) = print_lambda_capped(&t, 64, MAX_TERM_DEPTH);
        assert_eq!(truncated, Some(Cut::Bytes), "a 64-byte budget on a term printing {} bytes must fire", full.len());
        assert!(short.len() < full.len(), "the capped output must be shorter than the full one");
        assert!(spans.iter().all(|(s, _)| s.end <= short.len()), "spans must stay inside the text");
    }

    /// The whole point: the budget bounds what is BUILT, not what is returned. A capped print of a term
    /// whose full printing is enormous must not first build the enormous string.
    #[test]
    fn the_budget_bounds_the_allocation_not_just_the_result() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        // A single large Church numeral. `MAX_LAMBDA_LOWER_DEPTH` bounds Core AST depth, not numeral
        // magnitude — a bare `Nat` literal has depth 1 regardless of its value — so this lowers to a
        // half-million-node application chain (`encode::church` loops, it does not recurse) from a
        // one-line, depth-1 source program. Its full printing would be megabytes; this test never
        // builds it, only the 128-byte-capped walk runs.
        let (program, ds) = parse("500000");
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let t = lower(&desugar(&program.expect("parsed"))).expect("large numeral lowers");

        let (short, _, truncated) = print_lambda_capped(&t, 128, MAX_TERM_DEPTH);
        assert_eq!(truncated, Some(Cut::Bytes));
        // Overshoot is bounded by one binder prefix, not by the term's size — and in this region every
        // write is one byte behind its own check, so the fixed implementation lands at or very near
        // exactly 128 bytes. A wider tolerance here would let the `parenthesized` re-check regress
        // silently and this test would not notice.
        assert!(
            short.len() <= 128 + 6,
            "expected at most one binder prefix of overshoot, got {} bytes at a 128-byte budget \
             (an unfixed `parenthesized` re-check would land well above this)",
            short.len()
        );
    }

    /// Exact fit is NOT truncation, and length alone cannot tell the difference. A term whose complete
    /// printing is exactly `byte_budget` bytes finished its walk with nothing cut; inferring truncation
    /// from `out.len() >= byte_budget` reported that as truncated, and inferring it from `>` would have
    /// reported a genuinely cut walk as complete. Only the walk knows, so the walk reports it.
    #[test]
    fn a_term_printing_to_exactly_the_budget_is_not_truncated() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        // A small first-order term, built the same way the neighbouring tests build one: parse ->
        // desugar -> lower, inline. Small enough that `exact - 1` is a meaningful, distinct budget.
        let (program, ds) = parse("[1, 2, 3]");
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let t = lower(&desugar(&program.expect("parsed"))).expect("small list demo lowers");

        let (full, _, full_truncated) = print_lambda_capped(&t, usize::MAX, MAX_TERM_DEPTH);
        assert!(full_truncated.is_none(), "an unreachable budget must not report truncation");
        let exact = full.len();

        let (at_budget, _, truncated) = print_lambda_capped(&t, exact, MAX_TERM_DEPTH);
        assert!(truncated.is_none(), "a complete {exact}-byte printing at a {exact}-byte budget is not truncated");
        assert_eq!(at_budget, full, "and it must be the whole output");

        let (_under, _, truncated_under) = print_lambda_capped(&t, exact - 1, MAX_TERM_DEPTH);
        assert_eq!(truncated_under, Some(Cut::Bytes), "one byte less must truncate");
    }

    /// No printed byte moves. At a budget larger than the term, capped printing is byte-identical to
    /// `print_lambda_mapped` — text AND spans — which is what pins that this slice changed no output.
    #[test]
    fn an_unreachable_budget_is_identical_to_the_uncapped_printer() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        // The same demo list `printed_lowering_of_every_demo_reparses` uses, for the same reason: it is
        // the set whose printed lowering this module already promises to keep stable.
        let demos = ["1 + 2 * 3", "let x = 1; let y = x + x; y * 3", "if 2 > 1 { 10 } else { 20 }", "[1, 2, 3]"];
        for src in demos {
            let (program, _) = parse(src);
            let Some(program) = program else { continue };
            let Ok(t) = lower(&desugar(&program)) else { continue };
            let (want_text, want_spans) = print_lambda_mapped(&t);
            let (got_text, got_spans, truncated) = print_lambda_capped(&t, usize::MAX, MAX_TERM_DEPTH);
            assert!(truncated.is_none(), "{src:?}");
            assert_eq!(got_text, want_text, "{src:?}: text moved");
            assert_eq!(got_spans, want_spans, "{src:?}: spans moved");
        }
    }

    /// Left-nested application chains are the case `parenthesized`'s re-check does NOT cover, and they
    /// are the common one: `lower.rs`'s `Core::Apply` builds `term = app(term, la)` per argument, so
    /// every multi-argument call is left-nested. Without a budget re-check before the separator, each
    /// frame pushes another space as the stack unwinds and overshoot grows with the argument count.
    #[test]
    fn a_left_nested_application_chain_overshoots_by_at_most_one_token() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        // A user `fn` with eight parameters called with eight arguments, built the way the neighbouring
        // tests build one: parse -> desugar -> lower, inline. `Core::Apply` lowers the call to a chain
        // App(App(App(...App(Var f, 1)...), 8) eight levels deep — the natural shape for "several
        // arguments", not a contrived one.
        let src = "fn f(a, b, c, d, e, g, h, i) { a } f(1, 2, 3, 4, 5, 6, 7, 8)";
        let (program, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let t = lower(&desugar(&program.expect("parsed"))).expect("multi-arg call lowers");

        // 8 bytes lands the walk exactly at the end of "(λf. f " — the chain's innermost spine leaf plus
        // its trailing separator — so the budget fires right as the stack begins unwinding through all
        // eight `App` frames. Before the fix, each frame pushed its separator unconditionally: one extra
        // byte PER ARGUMENT (8 extra bytes, double the budget). After the fix, no frame writes past the
        // point the budget fired.
        let (short, _, truncated) = print_lambda_capped(&t, 8, MAX_TERM_DEPTH);
        assert_eq!(truncated, Some(Cut::Bytes));
        // Pins the exact landing point, not just its length: a change to the lowering that moved where
        // the walk bails would pass the two bound checks below vacuously without this.
        assert_eq!(short, "(λf. f ", "the fixture's exact truncated output moved: {short:?}");
        // Every token in this fixture (identifiers, `.`, `(`, `)`, and the 2-byte `λ`) is short, so one
        // token of legitimate overshoot is bounded well under this; the pre-fix bug blew past it by
        // growing with the argument count instead.
        assert!(short.len() <= 8 + 4, "overshoot grew with the chain: {} bytes at an 8-byte budget", short.len());
        assert!(!short.ends_with("  "), "consecutive separators mean a frame wrote after the budget fired: {short:?}");
    }

    /// THE CRITICAL FIX. Before the depth counter, `write_app_fn` delegating into `write_term` down a
    /// left-nested spine's function position wrote ZERO bytes while descending, so `out.len() >= budget`
    /// never got a chance to fire during that descent: native recursion depth equalled the spine length.
    /// At `usize::MAX` the byte budget can never be what stops it — only a depth guard can — and a spine
    /// this long overflowed the native stack before the fix. Built with `app`/`var` directly, not the
    /// parser, because the term is OPEN: `var(0)` here names no enclosing binder, and `parse_atom`'s
    /// ident branch only ever produces a `Var` by resolving a name against `scope` — a free index is not
    /// something source text can spell, so this exact term is not parser-reachable.
    ///
    /// `MAX_PARSE_DEPTH` is NOT why hand-building is necessary here, and does not make a spine this long
    /// unreachable from the parser. `depth` is incremented only in `parse_term` (paren nesting and a
    /// `λ`-body), not by juxtaposition: `parse_application` consumes each argument through a LOOP calling
    /// `parse_atom`, folding `term = app(term, arg)` at the same parser depth every time, and
    /// `parse_atom`'s ident branch neither recurses nor touches `depth`. So `λa.` followed by 30,000 `a`s
    /// parses at parser depth 2 — one for the outer `parse_term`, one for the abstraction's body — and
    /// produces exactly this left-nested spine. A source program CAN reach this code path, which is why
    /// the depth guard above is load-bearing for parsed input too, not only for hand-built terms.
    #[test]
    fn a_left_nested_spine_far_past_max_term_depth_truncates_instead_of_overflowing_the_stack() {
        let mut t = var(0);
        for _ in 0..(MAX_TERM_DEPTH as usize * 10) {
            t = app(t, var(0));
        }
        let (_, _, truncated) = print_lambda_capped(&t, usize::MAX, MAX_TERM_DEPTH);
        assert_eq!(
            truncated,
            Some(Cut::Depth),
            "a spine far past MAX_TERM_DEPTH must report a depth cut, not overflow the stack"
        );
    }

    use std::collections::BTreeMap;

    use crate::lambda::term::{Dir, Path};

    /// Every path in `t`, paired with a synthetic `NodeId`, so a test can ask for the whole tree at
    /// once. Ids are assigned in walk order and mean nothing beyond being distinct.
    fn all_paths(t: &LambdaTerm) -> BTreeMap<u32, Path> {
        fn walk(t: &LambdaTerm, at: &mut Path, out: &mut Vec<Path>) {
            out.push(at.clone());
            match t.node() {
                Node::Var(_) => {}
                Node::Abs(_, body) => {
                    at.push(Dir::AbsBody);
                    walk(body, at, out);
                    at.pop();
                }
                Node::App(f, a, _) => {
                    at.push(Dir::AppL);
                    walk(f, at, out);
                    at.pop();
                    at.push(Dir::AppR);
                    walk(a, at, out);
                    at.pop();
                }
            }
        }
        let mut paths = Vec::new();
        walk(t, &mut Path::new(), &mut paths);
        paths.into_iter().enumerate().map(|(i, p)| (i as u32, p)).collect()
    }

    /// The subterm at `path`, or `None` if the path leaves the term.
    fn at_path<'a>(t: &'a LambdaTerm, path: &[Dir]) -> Option<&'a LambdaTerm> {
        let mut cur = t;
        for d in path {
            cur = match (d, cur.node()) {
                (Dir::AbsBody, Node::Abs(_, body)) => body,
                (Dir::AppL, Node::App(f, _, _)) => f,
                (Dir::AppR, Node::App(_, a, _)) => a,
                _ => return None,
            };
        }
        Some(cur)
    }

    #[test]
    fn an_empty_want_is_byte_identical_to_the_capped_printer() {
        // ONE WALKER, NOT TWO — the same property `an_unreachable_budget_is_identical_to_the_uncapped
        // _printer` pins one layer out. `print_lambda_capped` now delegates here, so a divergence
        // would mean the recording path had quietly become a second printer.
        for src in ["\\x. x", "\\z. (\\f. \\x. f (f x)) (\\y. y) z", "\\a. \\b. a b (a b)"] {
            let t = parse_ok(src);
            let want: BTreeMap<u32, Path> = BTreeMap::new();
            for budget in [4, 16, 64, usize::MAX] {
                let (a, sa, ha) = print_lambda_capped(&t, budget, MAX_TERM_DEPTH);
                let (b, sb, hb, nodes) = print_lambda_linked(&t, budget, MAX_TERM_DEPTH, &want);
                assert_eq!(a, b, "{src:?} at budget {budget}");
                assert_eq!(sa, sb, "{src:?} spans at budget {budget}");
                assert_eq!(ha, hb, "{src:?} truncated at budget {budget}");
                assert!(nodes.is_empty(), "an empty want records nothing");
            }
        }
    }

    #[test]
    fn a_closed_subterms_recorded_span_is_exactly_its_own_printing() {
        // THE REPRINT ORACLE, AND WHY IT IS RESTRICTED TO CLOSED SUBTERMS. `Var(i)` is a de Bruijn
        // index resolved against the binders ambient where it is PRINTED, so re-rooting a subterm that
        // references an outer binder changes what it means: the body of `\x. x` prints `x` in context
        // and `?0` standalone, `?0` being this printer's deliberate marker for an index with no binder.
        // Comparing those would be testing de Bruijn semantics, not span recording. `maxfree() == 0` is
        // exactly the condition under which extraction is meaning-preserving.
        //
        // THE FIXTURES ARE CHOSEN SO THE RESTRICTION IS NOT A GUTTING. An application of closed terms
        // has closed subterms at the root, at both `App` arms, and at their arms in turn — which is
        // precisely the structure a swapped `AppL`/`AppR` push would corrupt. `checked` pins the count
        // so a future fixture edit cannot quietly reduce this to the trivial root case.
        let mut checked = 0;
        for (src, expect_closed) in
            [("\\x. x", 1), ("(\\x. x) (\\y. y y)", 3), ("(\\f. \\x. f (f x)) (\\y. y) (\\z. z)", 5)]
        {
            let t = parse_ok(src);
            let want = all_paths(&t);
            let (text, _, truncated, nodes) = print_lambda_linked(&t, usize::MAX, MAX_TERM_DEPTH, &want);
            assert!(truncated.is_none(), "{src:?} must print whole at an unreachable budget");
            assert_eq!(nodes.len(), want.len(), "{src:?}: every path recorded when nothing truncates");

            let mut closed_here = 0;
            for (span, id) in &nodes {
                let path = want.get(id).expect("recorded id must be one we asked for");
                let sub = at_path(&t, path).expect("recorded path must resolve");
                if sub.maxfree() != 0 {
                    continue;
                }
                // CLOSED IS NECESSARY, NOT SUFFICIENT, and the second reason is nothing to do with de
                // Bruijn. A subterm's ROLE in its parent decides its parentheses — `AppFn` wraps an
                // `Abs`, `Atom` wraps anything but a `Var`, `Term` (the root, and every `AbsBody`
                // slot) wraps nothing — and `print_lambda_mapped` always prints at `Term`, so it never
                // adds positional parens. That is the same "a recorded span includes the node's own
                // parentheses" contract `a_recorded_span_includes_the_nodes_own_parentheses` pins.
                //
                // THE ROLE IS PREDICTED, NOT TOLERATED. Accepting "the reprint, or the reprint in
                // parens" would pass a node that should be wrapped and is not, and one that should not
                // be and is — the exact `Role` dispatch this oracle exists to cover. The last step of
                // the path and the subterm's own kind determine the answer, so this stays an equality.
                let (base, _) = print_lambda_mapped(sub);
                let wrapped = match path.last() {
                    None | Some(Dir::AbsBody) => false,
                    Some(Dir::AppL) => matches!(sub.node(), Node::Abs(..)),
                    Some(Dir::AppR) => !matches!(sub.node(), Node::Var(_)),
                };
                let expected = if wrapped { format!("({base})") } else { base };
                assert_eq!(&text[span.start..span.end], expected, "{src:?}: path {path:?}");
                closed_here += 1;
            }
            assert_eq!(closed_here, expect_closed, "{src:?}: closed-subterm count changed");
            checked += closed_here;
        }
        assert_eq!(checked, 9, "the oracle must not go vacuous");
    }

    #[test]
    fn an_applications_arms_are_recorded_in_the_order_they_print() {
        // THE ORACLE FOR EVERY OTHER SUBTERM, and the one that actually catches a swapped arm. It needs
        // no reprinting, so it is unaffected by de Bruijn context: the function position is written
        // before the argument, so `AppL`'s span must end at or before `AppR`'s begins, and both must
        // sit strictly inside the parent's. Pushing `AppR` where `AppL` belongs makes the left child's
        // span come back under the right child's path, and this inverts.
        let mut arms = 0;
        for src in ["\\z. (\\f. \\x. f (f x)) (\\y. y) z", "\\a. \\b. a b (a b)", "\\f. \\g. \\h. f (g h) (\\q. q q)"] {
            let t = parse_ok(src);
            let want = all_paths(&t);
            let (_, _, _, nodes) = print_lambda_linked(&t, usize::MAX, MAX_TERM_DEPTH, &want);
            let by_path: BTreeMap<&Path, Span> =
                nodes.iter().map(|(s, id)| (want.get(id).expect("known id"), *s)).collect();
            for (path, parent) in &by_path {
                let mut l = (*path).clone();
                l.push(Dir::AppL);
                let mut r = (*path).clone();
                r.push(Dir::AppR);
                let (Some(ls), Some(rs)) = (by_path.get(&l), by_path.get(&r)) else { continue };
                assert!(ls.end <= rs.start, "{src:?}: {path:?} arms out of order — {ls:?} then {rs:?}");
                assert!(parent.start <= ls.start && rs.end <= parent.end, "{src:?}: {path:?} arms escape parent");
                arms += 1;
            }
        }
        assert!(arms >= 6, "only {arms} applications checked — the fixtures stopped exercising this");
    }

    #[test]
    fn an_ancestors_span_contains_its_descendants() {
        let t = parse_ok("\\z. (\\f. \\x. f (f x)) (\\y. y) z");
        let want = all_paths(&t);
        let (_, _, _, nodes) = print_lambda_linked(&t, usize::MAX, MAX_TERM_DEPTH, &want);
        let by_id: BTreeMap<u32, Span> = nodes.iter().map(|(s, id)| (*id, *s)).collect();
        for (outer, outer_path) in &want {
            for (inner, inner_path) in &want {
                if outer == inner || !inner_path.starts_with(outer_path) {
                    continue;
                }
                let (o, i) = match (by_id.get(outer), by_id.get(inner)) {
                    (Some(o), Some(i)) => (o, i),
                    _ => continue,
                };
                assert!(
                    o.start <= i.start && i.end <= o.end,
                    "path {outer_path:?} {o:?} must contain {inner_path:?} {i:?}"
                );
            }
        }
    }

    #[test]
    fn a_recorded_span_includes_the_nodes_own_parentheses() {
        // `\y. y` in argument position prints as `(λy. y)`, and the highlight must cover the parens:
        // lighting `λy. y` alone names a subterm that is not the one at that path.
        let t = parse_ok("\\f. f (\\y. y)");
        let mut want: BTreeMap<u32, Path> = BTreeMap::new();
        want.insert(7, vec![Dir::AbsBody, Dir::AppR]);
        let (text, _, _, nodes) = print_lambda_linked(&t, usize::MAX, MAX_TERM_DEPTH, &want);
        assert_eq!(text, "\u{3bb}f. f (\u{3bb}y. y)");
        let (span, id) = nodes.first().copied().expect("the argument must be recorded");
        assert_eq!(id, 7);
        assert_eq!(&text[span.start..span.end], "(\u{3bb}y. y)");
    }

    #[test]
    fn a_node_past_the_cut_records_nothing_rather_than_a_clamped_span() {
        // PINS AN EXACT, NAMED SHAPE — NOT A COUNT INEQUALITY. The original form asserted only
        // `nodes.len() < want.len()`, which a "records nothing, ever" implementation (`nodes:
        // Vec::new()` unconditionally) also satisfies, since `0 < want.len()` is vacuously true for
        // any non-trivial term. Its per-node loop checked only `span.end <= text.len()`, which cannot
        // tell "never recorded" from "recorded but clamped to the cut": a clamped span satisfies that
        // bound BY CONSTRUCTION, since clamping means "trim the end to fit inside the text". So the old
        // test passed unchanged against both bugs this doc paragraph rules out.
        //
        // This form instead picks a budget where the walk gets partway, and pins both halves by
        // identity: the completed subterm is recorded with its EXACT span and text, and the cut
        // subterm is ABSENT from `nodes` — not present with an end pinned to where the walk stopped.
        // Budget 10 on `\f. f (\y. y)` was read out empirically (a temporary probe test printed the
        // walk's output at budgets 0..=15 and was deleted once these numbers were confirmed): the walk
        // produces exactly `"λf. f (λy. "` (13 bytes) and stops inside the inner `Abs`'s body write, so
        // `Var f` at `[AbsBody, AppL]` finishes and is recorded, while `(\y. y)` at `[AbsBody, AppR]` —
        // whose opening paren is written but whose own recording site never runs because `cut` is
        // already set when its `node()` call returns — is cut and must not appear at all. A clamping
        // implementation would instead record it as `(7, 13)`, i.e. `"(λy. "`.
        let t = parse_ok("\\f. f (\\y. y)");
        let want = all_paths(&t);
        let (text, _, truncated, nodes) = print_lambda_linked(&t, 10, MAX_TERM_DEPTH, &want);
        assert_eq!(truncated, Some(Cut::Bytes), "budget 10 must truncate this term");
        assert_eq!(text, "\u{3bb}f. f (\u{3bb}y. ", "budget 10's exact truncated text changed");
        assert!(!nodes.is_empty(), "a walk that gets partway must record the part it completed");

        let path_id =
            |path: &Path| want.iter().find(|(_, p)| *p == path).map(|(id, _)| *id).expect("path must be in `want`");

        let f_id = path_id(&vec![Dir::AbsBody, Dir::AppL]);
        let (span, id) = nodes[0];
        assert_eq!(id, f_id, "the one recorded node must be `f`, not some other path");
        assert_eq!(span, Span::new(5, 6), "`f`'s span must be exactly where it was printed");
        assert_eq!(&text[span.start..span.end], "f", "the recorded span must slice back to \"f\" itself");

        // Checked BEFORE the exact-count assertion below: a clamping implementation still records
        // `f` correctly (it is never cut) but ALSO records the cut `(\y. y)`, so the count check alone
        // would catch that bug too — this assertion is what proves it is caught for the right reason,
        // by naming the exact path that must be missing rather than just noticing the total is off.
        let cut_id = path_id(&vec![Dir::AbsBody, Dir::AppR]);
        assert!(
            nodes.iter().all(|(_, id)| *id != cut_id),
            "`(\\y. y)` was cut by the budget and must be ABSENT, not recorded with a span clamped to the cut"
        );

        assert_eq!(nodes.len(), 1, "exactly one path completes before budget 10 cuts this term");
    }

    /// The two producers of a cut are different kinds of object, so a caller must be able to tell them
    /// apart. Only the BYTE cut is reliably malformed (`parens` re-checks bytes before its closing paren
    /// and does not re-check depth); a DEPTH cut can come out well-formed and reparse into a different,
    /// shorter term. `trace.rs`'s `depth_capped` draws exactly this distinction for `HitCap`.
    #[test]
    fn a_cut_names_the_limit_that_fired() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        let (program, ds) = parse("10");
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let t = lower(&desugar(&program.expect("parsed"))).expect("a numeral lowers");

        let (_, _, none) = print_lambda_capped(&t, usize::MAX, MAX_TERM_DEPTH);
        assert_eq!(none, None, "a walk that ran to completion was not cut");

        let (_, _, by_depth) = print_lambda_capped(&t, usize::MAX, 3);
        assert_eq!(by_depth, Some(Cut::Depth), "an unreachable byte budget leaves depth as the only cause");

        let (_, _, by_bytes) = print_lambda_capped(&t, 8, MAX_TERM_DEPTH);
        assert_eq!(by_bytes, Some(Cut::Bytes), "an unreachable depth cap leaves bytes as the only cause");
    }

    /// FIRST CAUSE WINS, which is only observable when both limits fire at the SAME `bail()` call —
    /// not merely reachable somewhere in the same print. The walk continues at siblings after a bail,
    /// so without the rule the reported cause would be whichever subtree bailed LAST; that is a
    /// different property from precedence at one site, and does not pin the order `bail` checks in.
    ///
    /// The numbers are chosen so both conditions are true at the one deciding call. `church(10)`'s two
    /// `Abs` prefixes write `"λf. λx. "` — 10 bytes — before the walk reaches the application chain, so
    /// the `bail(depth)` call guarding that chain's root sees `depth == 2` and `out.len() == 10`. Budget
    /// 8 makes `out.len() >= budget` true there (`10 >= 8`), and depth cap 1 makes `depth > depth_cap`
    /// true there too (`2 > 1`) — both at that identical call, not one at an earlier bail and the other
    /// at a later one. (Depth cap 3, used previously, made only the byte condition true at that call —
    /// the test passed but did not exercise precedence, only walk order.) `bail` tests bytes before
    /// depth, so bytes is the answer.
    #[test]
    fn when_both_limits_fire_the_byte_cause_is_the_one_reported() {
        use crate::desugar::desugar;
        use crate::lambda::lower::lower;
        use crate::parser::parse;

        let (program, ds) = parse("10");
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let t = lower(&desugar(&program.expect("parsed"))).expect("a numeral lowers");

        // Both true at the same bail() call: see the doc comment above for the byte/depth trace.
        let (_, _, both) = print_lambda_capped(&t, 8, 1);
        assert_eq!(both, Some(Cut::Bytes), "bytes is tested before depth at the same bail site");
    }
}
