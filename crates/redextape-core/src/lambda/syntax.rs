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

use crate::analysis::push_span;
use crate::diagnostic::Diagnostic;
use crate::lambda::reduce::MAX_TERM_DEPTH;
use crate::lambda::term::{LambdaTerm, Node, abs, app, var};
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

/// `print_lambda_mapped`, bounded. Returns the text, its spans, and whether the budget fired.
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
/// past `lambda::reduce::MAX_TERM_DEPTH`, the walk stops and sets `hit` the same way the budget does. So
/// `truncated` means "bounded, for either reason" — a caller cannot tell from the bool alone which limit
/// fired, only that the walk did not run away.
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
/// less, so the advice does not soften for it: do not pass output from a call where `truncated` came
/// back `true`, for either reason, to `parse_lambda`.
pub fn print_lambda_capped(t: &LambdaTerm, byte_budget: usize) -> (String, crate::analysis::Classified, bool) {
    let mut out = String::new();
    let mut spans: crate::analysis::Classified = Vec::new();
    let mut names: Vec<String> = Vec::new();
    let mut hit = false;
    write_term(t, &mut names, &mut out, &mut spans, byte_budget, &mut hit, 0);
    (out, spans, hit)
}

/// `print_lambda`, plus a class per span. Spans are pushed as text is appended, so offsets are exact by
/// construction; `λ` is multi-byte, so nothing here may assume one byte per character.
///
/// One walker, not two: this is `print_lambda_capped` at a budget no real term reaches, so there is
/// nothing here that can drift from the capped path — the property `an_unreachable_budget_is_identical
/// _to_the_uncapped_printer` pins.
pub fn print_lambda_mapped(t: &LambdaTerm) -> (String, crate::analysis::Classified) {
    let (text, spans, _) = print_lambda_capped(t, usize::MAX);
    (text, spans)
}

// `depth` counts `Abs`/`App` levels from the root (0 there), one native call apart from the true
// recursion depth only by the fixed dispatch hops below — `write_app_fn`/`write_atom`/`parenthesized`
// pass it through UNCHANGED when they delegate on the SAME node (a different function, not a deeper
// term), and only `write_term`'s `Abs` and `App` arms increment it, matching exactly the unit
// `LambdaTerm::depth` counts. Checked at the top of every one of these four functions, right next to the
// budget check, so a term whose recursion the budget cannot bound (see the left-nested-spine paragraph
// on `print_lambda_capped`'s doc) still stops well short of a native stack overflow.

fn write_term(
    t: &LambdaTerm,
    names: &mut Vec<String>,
    out: &mut String,
    spans: &mut crate::analysis::Classified,
    budget: usize,
    hit: &mut bool,
    depth: u32,
) {
    if out.len() >= budget || depth > MAX_TERM_DEPTH {
        *hit = true;
        return;
    }
    use crate::analysis::TokenClass as C;
    match t.node() {
        Node::Var(i) => {
            let idx = names.len().checked_sub(1 + *i as usize);
            let name = idx.and_then(|k| names.get(k)).cloned().unwrap_or_else(|| format!("?{i}"));
            push_span(out, spans, &name, C::Ident);
        }
        Node::Abs(hint, body) => {
            let name = fresh(hint, names);
            push_span(out, spans, "λ", C::Binder);
            push_span(out, spans, &name, C::Binder);
            // The binder's `.` is punctuation, classified like the `(` and `)` in `parenthesized` and
            // like the TM printer's `:`/`,`/`->`. The space after it is whitespace and stays outside
            // the span: §6 asks for coverage of everything EXCEPT whitespace.
            push_span(out, spans, ".", C::Punct);
            out.push(' ');
            names.push(name);
            write_term(body, names, out, spans, budget, hit, depth + 1);
            names.pop();
        }
        Node::App(f, a) => {
            write_app_fn(f, names, out, spans, budget, hit, depth + 1);
            // Re-checked for the same reason `parenthesized` re-checks before its closing paren, and this is
            // the LEFT-nested mirror of that case. `lower.rs`'s `Core::Apply` builds `term = app(term, la)` in
            // a loop, so `f(a, b, c)` is `App(App(App(f,a),b),c)`; without this check every enclosing frame
            // pushes its separator as the stack unwinds, and the overshoot the doc comment bounds at one
            // binder prefix becomes one space PER ARGUMENT. Depth is deliberately NOT re-checked here, but
            // "a depth bail below writes nothing" only holds a level past THIS frame's own depth + 1: `f`
            // and `a` are both called at `depth + 1`, so a bail exactly AT that depth fires identically for
            // both, and this frame still writes its separator space with no operand on either side. The
            // effect is one stray space at the frontier bail site, not a correctness gap — `hit` is already
            // set by whichever call bailed — so it is not a second thing worth guarding.
            if out.len() >= budget {
                *hit = true;
                return;
            }
            out.push(' ');
            write_atom(a, names, out, spans, budget, hit, depth + 1);
        }
    }
}

/// The function position of an application: an abstraction there needs parens.
fn write_app_fn(
    t: &LambdaTerm,
    names: &mut Vec<String>,
    out: &mut String,
    spans: &mut crate::analysis::Classified,
    budget: usize,
    hit: &mut bool,
    depth: u32,
) {
    if out.len() >= budget || depth > MAX_TERM_DEPTH {
        *hit = true;
        return;
    }
    match t.node() {
        Node::Abs(..) => parenthesized(t, names, out, spans, budget, hit, depth),
        _ => write_term(t, names, out, spans, budget, hit, depth),
    }
}

/// An atom in argument position: abstractions and applications need parens.
fn write_atom(
    t: &LambdaTerm,
    names: &mut Vec<String>,
    out: &mut String,
    spans: &mut crate::analysis::Classified,
    budget: usize,
    hit: &mut bool,
    depth: u32,
) {
    if out.len() >= budget || depth > MAX_TERM_DEPTH {
        *hit = true;
        return;
    }
    match t.node() {
        Node::Var(_) => write_term(t, names, out, spans, budget, hit, depth),
        _ => parenthesized(t, names, out, spans, budget, hit, depth),
    }
}

fn parenthesized(
    t: &LambdaTerm,
    names: &mut Vec<String>,
    out: &mut String,
    spans: &mut crate::analysis::Classified,
    budget: usize,
    hit: &mut bool,
    depth: u32,
) {
    if out.len() >= budget || depth > MAX_TERM_DEPTH {
        *hit = true;
        return;
    }
    use crate::analysis::TokenClass as C;
    push_span(out, spans, "(", C::Punct);
    write_term(t, names, out, spans, budget, hit, depth);
    // Re-checked, not assumed: without this, a budget that fired partway through `write_term` above
    // would still be followed by an unconditional `)`, and every enclosing `parenthesized` frame on the
    // call stack would do the same as it unwound — turning "one binder prefix of overshoot" into one
    // closing paren PER NESTING LEVEL for a right-nested term (exactly the application chains a Church
    // numeral or a cons chain builds). This is what keeps the bound the doc comment states actually true.
    if out.len() >= budget {
        *hit = true;
        return;
    }
    push_span(out, spans, ")", C::Punct);
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

        let (full, _, full_truncated) = print_lambda_capped(&t, usize::MAX);
        assert!(!full_truncated, "an unreachable budget must not report truncation");

        let (short, spans, truncated) = print_lambda_capped(&t, 64);
        assert!(truncated, "a 64-byte budget on a term printing {} bytes must fire", full.len());
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

        let (short, _, truncated) = print_lambda_capped(&t, 128);
        assert!(truncated);
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

        let (full, _, full_truncated) = print_lambda_capped(&t, usize::MAX);
        assert!(!full_truncated, "an unreachable budget must not report truncation");
        let exact = full.len();

        let (at_budget, _, truncated) = print_lambda_capped(&t, exact);
        assert!(!truncated, "a complete {exact}-byte printing at a {exact}-byte budget is not truncated");
        assert_eq!(at_budget, full, "and it must be the whole output");

        let (_under, _, truncated_under) = print_lambda_capped(&t, exact - 1);
        assert!(truncated_under, "one byte less must truncate");
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
            let (got_text, got_spans, truncated) = print_lambda_capped(&t, usize::MAX);
            assert!(!truncated, "{src:?}");
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
        let (short, _, truncated) = print_lambda_capped(&t, 8);
        assert!(truncated);
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
        let (_, _, truncated) = print_lambda_capped(&t, usize::MAX);
        assert!(truncated, "a spine far past MAX_TERM_DEPTH must report truncated, not overflow the stack");
    }
}
