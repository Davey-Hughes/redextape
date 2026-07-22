//! The human-readable, runnable lambda text form: `var`, `\x. e` (also `λ`), application by
//! juxtaposition (left-assoc), parens. Parsing resolves names to de Bruijn indices; printing
//! regenerates readable names from binder hints. Printer and parser round-trip (§7.2).

use crate::diagnostic::Diagnostic;
use crate::lambda::term::{LambdaTerm, abs, app, var};
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
        while matches!(self.peek(), Some(c) if is_ident_continue(c)) {
            s.push(self.bump().unwrap());
        }
        s
    }
}

fn is_ident_start(c: char) -> bool {
    c == '_' || c.is_ascii_alphabetic()
}

fn is_ident_continue(c: char) -> bool {
    c == '_' || c.is_ascii_alphanumeric()
}

/// Print a term with readable names, freshening on shadow collision, minimal parens.
pub fn print_lambda(t: &LambdaTerm) -> String {
    let mut names: Vec<String> = Vec::new();
    print_term(t, &mut names)
}

fn print_term(t: &LambdaTerm, names: &mut Vec<String>) -> String {
    match t {
        LambdaTerm::Var(i) => {
            let idx = names.len().checked_sub(1 + *i as usize);
            idx.and_then(|k| names.get(k)).cloned().unwrap_or_else(|| format!("?{i}"))
        }
        LambdaTerm::Abs(hint, body) => {
            let name = fresh(hint, names);
            names.push(name.clone());
            let inner = print_term(body, names);
            names.pop();
            format!("\\{name}. {inner}")
        }
        LambdaTerm::App(f, a) => {
            let fs = print_app_fn(f, names);
            let as_ = print_atom(a, names);
            format!("{fs} {as_}")
        }
    }
}

/// The function position of an application: an abstraction there needs parens.
fn print_app_fn(t: &LambdaTerm, names: &mut Vec<String>) -> String {
    match t {
        LambdaTerm::Abs(..) => format!("({})", print_term(t, names)),
        _ => print_term(t, names),
    }
}

/// An atom in argument position: abstractions and applications need parens.
fn print_atom(t: &LambdaTerm, names: &mut Vec<String>) -> String {
    match t {
        LambdaTerm::Var(_) => print_term(t, names),
        _ => format!("({})", print_term(t, names)),
    }
}

fn fresh(hint: &str, names: &[String]) -> String {
    let base = if hint.is_empty() { "v" } else { hint };
    if !names.iter().any(|n| n == base) {
        return base.to_string();
    }
    for k in 0.. {
        let cand = format!("{base}{k}");
        if !names.contains(&cand) {
            return cand;
        }
    }
    unreachable!()
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

    /// Generate closed de Bruijn terms of bounded depth.
    fn closed_term() -> impl Strategy<Value = LambdaTerm> {
        fn go(depth: u32, binders: u32) -> BoxedStrategy<LambdaTerm> {
            if depth == 0 {
                // Base case: a bound variable if any binder is in scope, else a trivial closed term.
                return if binders == 0 { Just(abs("x", var(0))).boxed() } else { (0..binders).prop_map(var).boxed() };
            }
            let abs_strat = go(depth - 1, binders + 1).prop_map(|b| abs("v", b)).boxed();
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
}
