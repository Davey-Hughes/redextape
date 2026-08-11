//! A FOREIGN reader for the λ text form: an independent PARSER, an independent normal-order REDUCER
//! and an independent DECODER, written from the documentation rather than from the implementation.
//!
//! WHY THIS EXISTS. `parse_lambda(print_lambda(t)) == t` is already proptested — and that property can
//! hold while the printed text is ambiguous to any reader that did not write the printer, because our
//! parser shares our printer's assumptions about names. This is the only check in the project that can
//! find an ambiguity in the λ text form.
//!
//! WHY IT IS A CORRECTNESS CHECK AND NOT JUST A DOCUMENTATION ONE, unlike the TM's foreign reader:
//! β-reduction is a textbook algorithm with a published specification, so an independent
//! implementation is genuinely independent; and normal-order reduction has subtle parts —
//! capture-avoiding substitution, redex selection — where two honest implementations can diverge. A
//! disagreement here is a bug signal, not only a doc gap.
//!
//! THE DISCIPLINE THIS TEST DEPENDS ON, stated because it is invisible in the finished code: the
//! parser, reducer and decoder below were written from the DOC COMMENTS in `lambda/syntax.rs`,
//! `lambda/term.rs`, `lambda/reduce.rs` and `lambda/encode.rs` — never by reading their bodies.
//! `lambda/decode.rs` and `lambda/lower.rs` were never opened at all. If you change this file, hold
//! that line.
//!
//! IT WRITES ITS OWN PARSER — the one place this goes further than `tm_foreign_reader.rs`, which was
//! right to reuse `parse_tm_full`. There, parsing is the format, not the simulation. Here, the parser
//! is exactly where the untested risk lives.
//!
//! WHAT THE DOCS DID NOT COVER — this file's primary deliverable. Eleven questions the permitted docs
//! left open, in the order they blocked writing the three components. Where a resolution says
//! VERIFIED, it means the opposite choice was substituted into the code below and the corpus was
//! re-run: it failed. Where it says UNEXERCISED, the corpus cannot tell the two apart, and the
//! resolution is a guess this test does not license anyone to rely on. Findings 8 and 11 carry
//! neither mark, and that is deliberate rather than an omission: 8 records a structural fact about the
//! encodings, not a choice between alternatives the corpus could adjudicate, and 11's resolution is a
//! defensive assertion, not a substitutable code path. The taxonomy applies only to findings whose
//! resolution could have gone the other way in the code below.
//!
//!  1. WHERE DOES A `\x. e` BODY END? `syntax.rs`'s module doc gives the surface forms (`var`,
//!     `\x. e`, "application by juxtaposition (left-assoc)", parens) but never states the relative
//!     precedence of abstraction and application — whether `\x. a b` is `\x. (a b)` or `(\x. a) b`.
//!     This is the single most load-bearing thing a foreign parser needs and it is not written down.
//!     *Resolved:* took the usual convention, that the body extends as far right as it can.
//!     **VERIFIED** — with the non-greedy reading the very first row fails, and the printed text
//!     depends on it throughout (`(\m. \n. \f. \x. m f (n f x))` is printed with no parens around
//!     any body).
//!  2. IS THERE MULTI-BINDER SUGAR (`\x y. e`)? Not stated either way. *Resolved:* not implemented.
//!     **UNEXERCISED** in the reading direction — the printer emits exactly one name per `\` — but a
//!     foreign WRITER has no way to know from the doc whether it is allowed to emit the short form.
//!  3. IS THE SPACE AFTER `.` REQUIRED? The doc writes `\x. e` with a space and separately lists `.`
//!     as an identifier terminator, which implies `\x.e` lexes; it never says so. *Resolved:*
//!     accepted both. **UNEXERCISED** — the printer always emits the space.
//!  4. IS THERE A COMMENT SYNTAX? Not stated. *Resolved:* assumed none; any character that is neither
//!     whitespace, an identifier character, nor one of `\ λ . ( )` is a lex error. **UNEXERCISED.**
//!  5. WHICH INDEX ARITHMETIC IS THE β RULE? This is the gap that mattered most. `term.rs` documents
//!     `shift(d, cutoff, t)` ("shift the free variables ... by `d`"), `subst(j, s, t)` ("substitute
//!     `s` for the variable with index `j`") and `beta` ("substitute `arg` for index 0 in `abs_body`
//!     and close the hole") — but does not spell out the index arithmetic itself, so a reader has to
//!     derive it from the rule the printed text form implies: closing a hole after substituting needs
//!     the substituted argument shifted up before it goes in and the reduct shifted down afterward, and
//!     crossing a binder during substitution renumbers both sides. "Substitution is pure index
//!     arithmetic (no fresh names, no capture)" tells you it IS index arithmetic, not WHICH. *Resolved:*
//!     the textbook formulation (Pierce, TAPL §6.2), `beta body arg = shift(-1, 0, subst(0, shift(1, 0,
//!     arg), body))` with `subst` renumbering both sides at a binder — implemented as three genuinely
//!     separate passes below, deliberately, even though `term.rs`'s shipped `beta` has computed the same
//!     answer in one fused walk since 2026-08-03 (β-fusion — see its doc block's note that this was
//!     three walks until that date). Staying three-pass here is what makes this file an independent oracle
//!     for that fusion rather than a restatement of it: `tests/subst_differential.rs`'s
//!     `the_shipped_beta_agrees_with_the_three_pass_formulation_on_every_enumerated_pair` checks the
//!     shipped `beta` against `subst_differential.rs`'s own three-pass reference, `beta_three_pass` — a reference this
//!     file's finding is what justified trusting in the first place, since it VERIFIED the same formula
//!     independently, from the doc comments alone, against the corpus rather than against `term.rs`.
//!     **VERIFIED, all three shifts independently** — dropping the pre-shift trips the negative-index
//!     assertion; dropping `subst`'s per-binder shift (i.e. allowing capture) fails the corpus; dropping
//!     the closing `shift(-1)` fails the corpus.
//!  6. DOES "NORMAL FORM" MEAN REDUCING UNDER BINDERS? `reduce.rs` says "normal-order
//!     (leftmost-outermost) β-reduction" and "reduce to normal form", but never says the reducer
//!     descends into `Abs` — which is precisely what the decoder depends on, since a Church numeral
//!     is unrecognizable until its body is fully reduced. *Resolved:* inferred from "normal form" as
//!     against weak head normal form. **VERIFIED** — stopping at `Abs` fails the corpus.
//!  7. WITHIN `App(f, a)` WHERE `f` IS NOT YET AN ABSTRACTION, WHICH SIDE FIRST? "Leftmost-outermost"
//!     is a standard term but the doc does not spell the order out. *Resolved:* function before
//!     argument. **VERIFIED, and this one is a genuine correctness check rather than a doc check** —
//!     reducing the argument first makes `sum(5)` fail to normalize at any cap, for a reason specific
//!     to that row: the lowering uses a call-by-name fixpoint combinator, and forcing the recursive
//!     call before the base case can stop it diverges on its own, with no other cause needed. A
//!     second, independent reason applies to a different corpus row: `head`'s `nil` branch is a
//!     deliberately non-normalizing term, so an argument-first reader would diverge there too, for an
//!     unrelated cause. An applicative-order reader of this text form is simply wrong, and nothing in
//!     the docs warns it.
//!  8. THE TEXT FORM CARRIES NO RESULT TYPE, AND THE ENCODINGS COLLIDE — noted here because the task
//!     brief asks for it and because it is stronger than "the file happens not to record a type".
//!     `encode.rs` documents `true = \t.\f. t` and `nil = \n.\c. n`: the SAME de Bruijn term,
//!     `Abs(Abs(Var 1))`. And `false = \t.\f. f` and `church 0 = \f.\x. x`: also the same term,
//!     `Abs(Abs(Var 0))`. So a normal form cannot be decoded without an externally supplied type —
//!     not as an implementation convenience, but in principle. No READER-FACING permitted doc says
//!     this anywhere — not `syntax.rs`, not `encode.rs`. It IS recorded, in `lambda/decode.rs`'s
//!     module doc, the file this task's brief correctly banned (that file describes the very decoding
//!     strategy a foreign reader has to rederive independently). So the fact is not undocumented
//!     project-wide; the gap is narrower and more actionable than that: no file a foreign reader is
//!     permitted to consult carries it, so it has to be rediscovered rather than looked up.
//!     *Resolved:* the type is supplied per corpus row, from the brief.
//!  9. WHAT SHAPE SHOULD A DECODER MATCH? `encode.rs` documents the combinators, not the normal forms
//!     they produce. That a fully applied, normalized cons cell is `\n.\c. c h t`, and that its two
//!     payloads are closed and therefore need no shifting out from under those two binders, has to be
//!     rederived. *Resolved:* derived by hand, **VERIFIED** against `[1, 2, 3]`. Mechanical, but a
//!     foreign reader does the work.
//! 10. WHAT DOES `MAX_PARSE_DEPTH` COUNT? **CORRECTED — the original version of this finding was
//!     wrong; see the note below.** `syntax.rs` documents it as a "nesting-depth guard for the
//!     recursive-descent parser (mirrors the source parser)", which answers parser recursion but says
//!     nothing about a second axis: TERM depth. A long left-associated application chain deepens the
//!     parsed term without deepening parser recursion (`parse_application`'s loop is not recursive),
//!     so a parser-recursion guard alone does not bound how deep a term reaching the reducer can be.
//!     *Resolved:* guard parser recursion (mirroring the documented `MAX_PARSE_DEPTH`) and the parsed
//!     term's depth separately, via `FOREIGN_MAX_TERM_DEPTH`. **UNEXERCISED** — the corpus maximum is
//!     47.
//!
//!     THE CORRECTION: an earlier version of this finding claimed `MAX_PARSE_DEPTH` had "no doc
//!     comment at all". That was false — the doc quoted above exists and directly answers the question
//!     this finding poses. A review caught it. Cause: this file's doc-only extraction from `syntax.rs`
//!     used `grep '^//!'` (module-doc lines only), which by construction cannot match a `///` item doc
//!     comment, so `MAX_PARSE_DEPTH`'s doc was never seen — and its absence from the extraction was
//!     then written up as the constant having no doc at all. Recorded here rather than silently
//!     dropped, because a findings list that quietly loses a false entry teaches the next reader
//!     nothing.
//! 11. WHAT DOES `shift` DO IF THE RESULT WOULD BE NEGATIVE? `d` is an `i64` and nothing says. It can
//!     only happen on an open term. *Resolved:* asserted. Worth keeping: that assertion is what
//!     caught the missing pre-shift in finding 5.
//!
//! WHAT THE DOCS COVERED CLEANLY, NO GAP — stated because "no gaps here" is only a result if it is
//! said: the identifier grammar including `$` (exactly right, and load-bearing — dropping `$` from
//! the start set fails the three mutable-state rows); left-associative application; de Bruijn indices
//! 0-based with 0 innermost; `?<index>` for free variables and why it is deliberately unlexable; the
//! Church/Scott combinator equations themselves, which transliterate to de Bruijn without ambiguity;
//! and the step cap and `MAX_TERM_DEPTH` rationale.
//!
//! ONE DOCUMENTED RULE THIS TEST CANNOT CHECK, and the reason is interesting. `syntax.rs` says an
//! occurrence resolves to the NEAREST enclosing binder of that name. Replacing "nearest" with
//! "outermost" in the resolver below changes nothing: the corpus still passes. That is not a weak
//! corpus — it is the printer's own freshening guarantee ("no binder shares a name with any binder
//! enclosing it") making the enclosing chain duplicate-free by construction, so the two rules cannot
//! differ on anything `print_lambda` emits. The rule is therefore unfalsifiable from printed output,
//! which is exactly what makes it a guarantee rather than a convention. What IS exercised is the
//! other half: names are reused freely in disjoint scopes (`\f. \x.` appears dozens of times per
//! row), so a resolver holding one flat name-to-index map instead of a push/pop binder stack breaks.
//!
//! THE RESIDUAL, so a later reader does not take this file as establishing more than it does. Unlike
//! `tm_foreign_reader.rs`, whose heap layout came from its brief, nothing about the GRAMMAR or the
//! ENCODINGS here came from the brief — those are `syntax.rs`'s and `encode.rs`'s module and
//! combinator docs, and the β rule is TAPL's. What did come from the brief is: the corpus itself, the
//! `FTy` set and the decision to supply a type per row (finding 8), the caps, and the
//! `parse`/`desugar`/`lower`/`print_lambda` pipeline. Separately, findings 2, 3, 4 and 10 are
//! resolved by guesses the corpus cannot falsify; this file does not establish them.
//!
//! A NARROWER RESIDUAL WITHIN THE β RULE ITSELF, worth stating plainly rather than leaving implicit:
//! `shift`, `subst` and `beta` below share their originals' names, signatures (`shift(d: i64, cutoff:
//! u32, ...)`), the TAPL formulation, and one verbatim doc line quoted from `term.rs` (finding 5) — all
//! of that permitted, since public signatures and doc comments were on the reading list, and quoted
//! there deliberately. The consequence: the substitution layer is NOT an independent cross-check of
//! `term.rs`'s, because a shared TAPL-level misreading of `shift`/`subst`/`beta` would be invisible to
//! this test — both implementations would agree and both would be wrong the same way. The genuinely
//! independent component is redex selection — which side of `App` reduces first, whether reduction
//! descends under `Abs` — and that is precisely where the one correctness finding (7) came from.
//! `tests/tm_foreign_reader.rs` draws exactly this kind of narrowing conclusion about its own scope
//! ("what it establishes today is narrower than its own title suggests"); the same applies here.
//!
//! Imports `lower` and `print_lambda` (the PRODUCER side — this test is about reading what they
//! write), `run` (the reference), `parse`/`desugar` (the front end) and `Value`. Nothing else from
//! `redextape_core::lambda`: no `LambdaTerm`, no `parse_lambda`, no `reduce_*`, no `decode`, no
//! `decode_lambda_ty`.

// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use redextape_core::desugar::desugar;
use redextape_core::lambda::{lower, print_lambda};
use redextape_core::parser::parse;
use redextape_core::value::{Value, format_value};
use std::rc::Rc;

// ---------------------------------------------------------------------------------------------
// The term type. Its own enum; `redextape_core::lambda::LambdaTerm` must not appear in this file.
//
// From `term.rs`'s module doc: de Bruijn, 0-based, 0 = innermost binder; the `Abs` name hint is
// print-only and equality is de Bruijn structural — so this reader drops the hint entirely at parse
// time and never needs it again.
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
enum FTerm {
    Var(u32),
    Abs(Box<FTerm>),
    App(Box<FTerm>, Box<FTerm>),
}

use FTerm::{Abs, App, Var};

fn abs(body: FTerm) -> FTerm {
    Abs(Box::new(body))
}

fn app(f: FTerm, a: FTerm) -> FTerm {
    App(Box::new(f), Box::new(a))
}

/// Mirrors the documented `syntax::MAX_PARSE_DEPTH`. The measured corpus maximum is well under it.
const FOREIGN_MAX_PARSE_DEPTH: u32 = 256;

/// Mirrors the documented `reduce::MAX_TERM_DEPTH` AS A CAP. As a MEASURE the two differ by exactly
/// one: `term_depth` below (see its doc) seeds its worklist at depth 1, not 0, so every value it
/// returns is `reduce::MAX_TERM_DEPTH`'s notion of depth plus one. `shift`/`subst`/`step` below
/// recurse once per term node, so an unbounded term would overflow the native stack instead of
/// failing cleanly.
const FOREIGN_MAX_TERM_DEPTH: u32 = 3_000;

/// Step cap. The documented `MAX_REDUCTION_STEPS` is 5_000_000; this reader uses a tighter cap
/// because the corpus normalizes in well under it and a subtly wrong redex rule should fail fast.
const FOREIGN_MAX_STEPS: u64 = 1_000_000;

// ---------------------------------------------------------------------------------------------
// The parser.
//
// Grammar, from `syntax.rs`'s module doc: `var`, `\x. e` (also `λ`), application by juxtaposition
// (left-associative), parens.
//
//     term ::= app
//     app  ::= atom+                       -- left-associative
//     atom ::= ident | '(' term ')' | lam
//     lam  ::= ('\' | 'λ') ident '.' term  -- body extends as far right as it can
//
// IDENTIFIERS, quoted from that doc: "An identifier starts with an ASCII letter, `_`, or `$`, and
// continues with those plus ASCII digits. Whitespace separates identifiers; `\`, `λ`, `.`, `(` and
// `)` terminate one." `?<index>` (a free variable) is therefore NOT lexable, which is the documented
// intent: an open term must fail to reparse loudly.
//
// NAMES AND SCOPE, quoted from that doc: "no binder shares a name with any binder enclosing it ... an
// occurrence resolves to the NEAREST enclosing binder with that name". So resolution is a rightmost
// match over a stack of binder names, and the index is the distance from the top of that stack.
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq)]
enum Tok {
    Lam,
    Dot,
    LParen,
    RParen,
    Ident(String),
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '$'
}

fn is_ident_continue(c: char) -> bool {
    is_ident_start(c) || c.is_ascii_digit()
}

fn lex(src: &str) -> Result<Vec<Tok>, String> {
    let mut toks = Vec::new();
    let mut chars = src.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        match c {
            '\\' | 'λ' => {
                chars.next();
                toks.push(Tok::Lam);
            }
            '.' => {
                chars.next();
                toks.push(Tok::Dot);
            }
            '(' => {
                chars.next();
                toks.push(Tok::LParen);
            }
            ')' => {
                chars.next();
                toks.push(Tok::RParen);
            }
            _ if is_ident_start(c) => {
                let mut name = String::new();
                while let Some(&d) = chars.peek() {
                    if is_ident_continue(d) {
                        name.push(d);
                        chars.next();
                    } else {
                        break;
                    }
                }
                toks.push(Tok::Ident(name));
            }
            _ => return Err(format!("unexpected character {c:?} (not an identifier char and not `\\ λ . ( )`)")),
        }
    }
    Ok(toks)
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
    /// Binder names, innermost LAST. An occurrence's de Bruijn index is `len - 1 - position`.
    scope: Vec<String>,
    depth: u32,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }

    fn bump(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.pos).cloned();
        if t.is_some() {
            self.pos += 1;
        }
        t
    }

    /// `app ::= atom+`, left-associative.
    fn parse_term(&mut self) -> Result<FTerm, String> {
        let mut t = self.parse_atom()?;
        while let Some(Tok::Ident(_) | Tok::LParen | Tok::Lam) = self.peek() {
            let a = self.parse_atom()?;
            t = app(t, a);
        }
        Ok(t)
    }

    fn parse_atom(&mut self) -> Result<FTerm, String> {
        self.depth += 1;
        if self.depth > FOREIGN_MAX_PARSE_DEPTH {
            return Err(format!("nesting deeper than {FOREIGN_MAX_PARSE_DEPTH}"));
        }
        let out = match self.bump() {
            Some(Tok::Ident(name)) => match self.scope.iter().rposition(|b| *b == name) {
                Some(p) => Ok(Var((self.scope.len() - 1 - p) as u32)),
                None => Err(format!("unbound name `{name}`")),
            },
            Some(Tok::LParen) => {
                let inner = self.parse_term()?;
                match self.bump() {
                    Some(Tok::RParen) => Ok(inner),
                    other => Err(format!("expected `)`, found {other:?}")),
                }
            }
            Some(Tok::Lam) => {
                let name = match self.bump() {
                    Some(Tok::Ident(n)) => n,
                    other => return Err(format!("expected a binder name after `\\`, found {other:?}")),
                };
                match self.bump() {
                    Some(Tok::Dot) => {}
                    other => return Err(format!("expected `.` after binder `{name}`, found {other:?}")),
                }
                self.scope.push(name);
                let body = self.parse_term();
                self.scope.pop();
                body.map(abs)
            }
            other => Err(format!("expected a term, found {other:?}")),
        };
        self.depth -= 1;
        out
    }
}

fn foreign_parse(src: &str) -> Result<FTerm, String> {
    let toks = lex(src)?;
    let mut p = Parser { toks, pos: 0, scope: Vec::new(), depth: 0 };
    let t = p.parse_term()?;
    if p.pos != p.toks.len() {
        return Err(format!("trailing input at token {}: {:?}", p.pos, &p.toks[p.pos..]));
    }
    let d = term_depth(&t);
    if d > FOREIGN_MAX_TERM_DEPTH {
        return Err(format!("parsed term depth {d} exceeds {FOREIGN_MAX_TERM_DEPTH}"));
    }
    Ok(t)
}

// ---------------------------------------------------------------------------------------------
// The reducer: normal-order (leftmost-outermost) β-reduction to normal form.
//
// From `reduce.rs`'s module doc: "Normal-order (leftmost-outermost) β-reduction over de Bruijn
// terms". From `term.rs`: indices are 0-based with 0 = the innermost binder, and "substitution is
// pure index arithmetic (no fresh names, no capture)". The three operations below are the textbook
// de Bruijn presentation (Pierce, TAPL §6.2): `shift` renumbers free variables, `subst` replaces one
// index, and β pre-shifts the argument up by one so it survives crossing the binder, substitutes for
// index 0, then shifts the whole body back down to close the hole the binder left.
// ---------------------------------------------------------------------------------------------

/// Shift the free variables of `t` (those with index >= `cutoff`) by `d`.
fn shift(d: i64, cutoff: u32, t: &FTerm) -> FTerm {
    match t {
        Var(i) => {
            if *i >= cutoff {
                let n = i64::from(*i) + d;
                assert!(n >= 0, "shift produced a negative index — the term was not closed");
                Var(n as u32)
            } else {
                Var(*i)
            }
        }
        Abs(b) => abs(shift(d, cutoff + 1, b)),
        App(f, a) => app(shift(d, cutoff, f), shift(d, cutoff, a)),
    }
}

/// Substitute `s` for the variable with index `j` in `t`. Crossing a binder renumbers both sides.
fn subst(j: u32, s: &FTerm, t: &FTerm) -> FTerm {
    match t {
        Var(i) => {
            if *i == j {
                s.clone()
            } else {
                Var(*i)
            }
        }
        Abs(b) => abs(subst(j + 1, &shift(1, 0, s), b)),
        App(f, a) => app(subst(j, s, f), subst(j, s, a)),
    }
}

/// β-reduce `(\. body) arg`.
fn beta(body: &FTerm, arg: &FTerm) -> FTerm {
    shift(-1, 0, &subst(0, &shift(1, 0, arg), body))
}

/// One leftmost-outermost β-step, or `None` if `t` is already in normal form.
///
/// Normal order: the outermost redex is preferred, and among redexes at the same nesting the
/// leftmost. Concretely — an application whose function is already an abstraction IS the redex;
/// otherwise look in the function first, then the argument; otherwise look under the binder. Looking
/// under the binder is what makes this a NORMAL form rather than a weak head normal form, which the
/// decoder needs: a Church numeral is only recognizable once its body is fully reduced.
fn step(t: &FTerm) -> Option<FTerm> {
    match t {
        Var(_) => None,
        Abs(b) => step(b).map(abs),
        App(f, a) => {
            if let Abs(body) = f.as_ref() {
                return Some(beta(body, a));
            }
            if let Some(f2) = step(f) {
                return Some(app(f2, a.as_ref().clone()));
            }
            step(a).map(|a2| app(f.as_ref().clone(), a2))
        }
    }
}

/// Iterative (explicit stack) so measuring the depth cannot itself overflow on a deep term. Seeds the
/// worklist at depth 1, not 0 — which is the exact, now-identified cause of this reader's measured
/// corpus maximum of 47 running one over the brief's stated 46 (previously attributed to "a slightly
/// different origin" for lack of a better explanation). A measured difference in where the two depth
/// counts start, not a fault: the original `term_depth` was never read, per the discipline this file
/// depends on.
fn term_depth(t: &FTerm) -> u32 {
    let mut max = 0;
    let mut work = vec![(t, 1u32)];
    while let Some((node, d)) = work.pop() {
        max = max.max(d);
        match node {
            Var(_) => {}
            Abs(b) => work.push((b, d + 1)),
            App(f, a) => {
                work.push((f, d + 1));
                work.push((a, d + 1));
            }
        }
    }
    max
}

/// Reduce to normal form. Panics on either cap, naming `src`, so a subtly wrong redex rule fails
/// loudly instead of hanging. Returns the normal form and the number of β-steps taken.
fn foreign_reduce(t: &FTerm, src: &str) -> (FTerm, u64) {
    let mut cur = t.clone();
    let mut steps = 0u64;
    loop {
        let d = term_depth(&cur);
        assert!(
            d <= FOREIGN_MAX_TERM_DEPTH,
            "`{src}`: term depth {d} exceeded {FOREIGN_MAX_TERM_DEPTH} after {steps} steps"
        );
        match step(&cur) {
            None => return (cur, steps),
            Some(next) => {
                cur = next;
                steps += 1;
                assert!(steps <= FOREIGN_MAX_STEPS, "`{src}`: did not normalize within {FOREIGN_MAX_STEPS} steps");
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The decoder.
//
// From `encode.rs`'s per-combinator docs, transliterated into de Bruijn by hand:
//
//     church n = \f.\x. fⁿ x     -> Abs(Abs( Var1 (Var1 (... Var0)) ))  -- n copies of Var1
//     true     = \t.\f. t        -> Abs(Abs(Var1))
//     false    = \t.\f. f        -> Abs(Abs(Var0))
//     nil      = \n.\c. n        -> Abs(Abs(Var1))
//     cons h t = \h.\t.\n.\c. c h t applied to h,t, normalizing to Abs(Abs( Var0 h t ))
//
// THE TYPE MUST BE SUPPLIED PER ROW — the λ text form carries no result type, and it could not be
// inferred even in principle here, because the encodings genuinely collide: `Abs(Abs(Var1))` is
// BOTH `true` AND `nil`, and `Abs(Abs(Var0))` is BOTH `false` AND `church 0`. See finding 8.
// ---------------------------------------------------------------------------------------------

/// The result type, supplied per corpus row. Local on purpose: `decode_lambda_ty` is not imported.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FTy {
    Nat,
    Bool,
    ListNat,
}

fn decode_nat(t: &FTerm) -> Option<u64> {
    // `\f.\x. fⁿ x`: under the two binders, `f` is index 1 and `x` is index 0.
    let Abs(outer) = t else { return None };
    let Abs(body) = outer.as_ref() else { return None };
    let mut n = 0u64;
    let mut cur = body.as_ref();
    loop {
        match cur {
            Var(0) => return Some(n),
            App(f, a) if **f == Var(1) => {
                n += 1;
                cur = a;
            }
            _ => return None,
        }
    }
}

fn decode_bool(t: &FTerm) -> Option<bool> {
    // `true = \t.\f. t` is index 1 under two binders; `false = \t.\f. f` is index 0.
    let Abs(outer) = t else { return None };
    let Abs(body) = outer.as_ref() else { return None };
    match body.as_ref() {
        Var(1) => Some(true),
        Var(0) => Some(false),
        _ => None,
    }
}

fn decode_list_nat(t: &FTerm) -> Option<Value> {
    // `nil = \n.\c. n` is index 1 under two binders. `cons h t = \n.\c. c h t` applies index 0 to
    // the two payloads, left-associated. Both payloads are CLOSED (every encoding above is a closed
    // term), so no shifting is needed to lift them out from under the two binders.
    let Abs(outer) = t else { return None };
    let Abs(body) = outer.as_ref() else { return None };
    match body.as_ref() {
        Var(1) => Some(Value::Nil),
        App(ch, tail) => {
            let App(c, head) = ch.as_ref() else { return None };
            if **c != Var(0) {
                return None;
            }
            let h = decode_nat(head)?;
            let rest = decode_list_nat(tail)?;
            Some(Value::Cons(Rc::new(Value::Nat(h)), Rc::new(rest)))
        }
        _ => None,
    }
}

fn foreign_decode(t: &FTerm, ty: FTy) -> Option<Value> {
    match ty {
        FTy::Nat => decode_nat(t).map(Value::Nat),
        FTy::Bool => decode_bool(t).map(Value::Bool),
        FTy::ListNat => decode_list_nat(t),
    }
}

// ---------------------------------------------------------------------------------------------
// The test.
// ---------------------------------------------------------------------------------------------

/// Compare two `Value`s WITHOUT routing through core's own equality walk. `assert_eq!` would compile —
/// `value.rs` does implement `PartialEq`, it just isn't derived — but a foreign reader that checked its
/// result with core's comparison would be leaning on the thing under test for the last step of the
/// check. Spelled out over the shapes this test can produce, for exactly the reason `decode.rs`'s
/// `nat_list_to_vec` is spelled out: independence from a separate walk with its own separate decisions.
fn same_value(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Nat(x), Value::Nat(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Nil, Value::Nil) => true,
        (Value::Cons(h1, t1), Value::Cons(h2, t2)) => same_value(h1, h2) && same_value(t1, t2),
        _ => false,
    }
}

const CORPUS: &[(&str, FTy)] = &[
    ("1 + 2 * 3", FTy::Nat),
    ("3 - 5", FTy::Nat),
    ("if 2 > 1 { 10 } else { 20 }", FTy::Nat),
    ("2 > 1", FTy::Bool),
    ("let x = 1; let y = x + x; y * 3", FTy::Nat),
    ("let add1 = |x| x + 1; add1(41)", FTy::Nat),
    ("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)", FTy::Nat),
    ("head(cons(7, nil))", FTy::Nat),
    ("[1, 2, 3]", FTy::ListNat),
    ("is_empty(nil)", FTy::Bool),
    // Mutable state: these lower through `$store` binders, and their printed form was unparseable
    // before this branch's first commit. They are the regression link to it.
    ("let mut x = 1; x = x + 10; x = x * 2; x", FTy::Nat),
    ("let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc", FTy::Nat),
    ("fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)", FTy::Nat),
];

#[test]
fn foreign_reader_agrees_with_the_reference() {
    for (src, ty) in CORPUS {
        // PRODUCER side: our front end, our lowering, our printer. Everything after this point is
        // the foreign reader.
        let (program, diags) = parse(src);
        let program = program.unwrap_or_else(|| panic!("`{src}`: failed to parse: {diags:?}"));
        let core = desugar(&program);
        let term = match lower(&core) {
            Ok(t) => t,
            Err(_) => panic!("`{src}`: lower failed"),
        };
        let text = print_lambda(&term);

        // READER side.
        let parsed = foreign_parse(&text)
            .unwrap_or_else(|e| panic!("`{src}`: foreign parse failed: {e}\nprinted text:\n{text}"));
        let (nf, steps) = foreign_reduce(&parsed, src);
        assert!(
            steps > 0,
            "`{src}`: the printed LOWERED term reduced in 0 steps, so this row does not exercise the reducer\nprinted text:\n{text}"
        );
        let got = foreign_decode(&nf, *ty).unwrap_or_else(|| {
            panic!("`{src}`: foreign decode as {ty:?} failed\nnormal form: {nf:?}\nprinted text:\n{text}")
        });

        let want = match redextape_core::run(src) {
            Ok(v) => v,
            Err(e) => panic!("`{src}`: the reference did not produce a value: {e:?}"),
        };

        assert!(
            same_value(&got, &want),
            "`{src}`: foreign reader disagrees with the reference\n  foreign: {}\n  reference: {}\n  ({steps} β-steps, {} chars of printed text)\nprinted text:\n{text}",
            format_value(&got),
            format_value(&want),
            text.len()
        );

        println!("ok  {src}  ({steps} β-steps, depth {}, {} chars)", term_depth(&parsed), text.len());
    }
}
