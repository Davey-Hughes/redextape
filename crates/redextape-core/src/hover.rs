//! What hover says, for each text form that has anything to say.
//!
//! **THE WORDS LIVE HERE, NOT IN THE SERVER.** `redextape-lsp` renders what this module returns and
//! decides nothing about it. The reason is the drift test: the asm table `tm/asm_syntax.rs` carries
//! is held to `MNEMONICS`, which carries no visibility modifier at all inside `tm::asm_syntax` —
//! private even to the rest of `tm`, so a table living in `redextape-lsp` could only be held to it by
//! widening that constant across a crate boundary — a weaker claim than
//! `table_agrees_with_the_printer`, the sibling it copies. That table and its drift tests are
//! `asm_syntax.rs`'s own; this module only calls `instr_at`. Core already owns user-facing English;
//! every `Diagnostic` message is core's.
//!
//! **`None` IS THE ORDINARY ANSWER.** A cursor on whitespace, on a keyword, or in `.rxlambda` has
//! nothing to say about it, and LSP spells that `null`. Nothing here is an error path.

use crate::ast::{Block, Expr, Program, Stmt};
use crate::nav::NameIndex;
use crate::span::Span;

/// One hover answer, carrying no markup.
///
/// Markup is the server's business: the same answer renders as plaintext or as markdown depending
/// on what the client advertised, and authoring it twice would be two copies of one sentence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HoverAnswer {
    /// The first line — a signature, a mnemonic, a literal's type.
    pub title: String,
    /// Everything under the title, one entry per line.
    pub lines: Vec<String>,
    /// What the answer is about, for `Hover.range`. Byte offsets, as every span in this crate is.
    pub span: Span,
}

/// What the cursor landed on, when it landed on a literal.
enum Lit {
    Nat(u64),
    Bool(bool),
}

/// Everything one walk of the tree answers.
///
/// **ONE WALK, TWO ANSWERS, BECAUSE TWO WALKS DRIFT.** The literal row and the arity row both need
/// the AST and both need every block reached; written separately, one of them ends up missing a
/// construct the other visits, and the symptom is a row that silently never answers inside a
/// `while` body.
#[derive(Default)]
struct Walked {
    literal: Option<(Span, Lit)>,
    /// Every `fn` declaration, as the span of its NAME and its parameter count. The span is the key
    /// because it is exactly what `NameIndex` stores for the same declaration, which is what lets a
    /// hover on a CALL resolve to its definition and read that definition's arity.
    fns: Vec<(Span, usize)>,
}

/// Walk every block and expression for the literal at `offset`, and every `fn` declaration reached
/// along the way.
///
/// **THE ANSWER IS THE UNIQUE LEAF WHOSE SPAN HOLDS `offset`.** Only `Expr::Nat` and `Expr::Bool`
/// ever assign `out.literal` — every other arm exists to reach further into the tree, not to compete
/// for the answer — and two literal spans cannot nest, so there is no outer/inner pair for a
/// "closest wins" rule to arbitrate. What has to be right is reaching that leaf at all: a literal
/// sits inside a call inside a binary inside a `let`, and skipping any one of those constructs on
/// the way down is a hover that silently never answers there.
///
/// **EXHAUSTIVE MATCHES, NO `_` ARM.** A new `Stmt` or `Expr` variant must be a compile error here
/// rather than a construct hover silently never reaches — the same argument `outline_kind` makes for
/// matching `DefKind` exhaustively.
fn walk(program: &Program, offset: usize) -> Walked {
    fn holds(span: Span, offset: usize) -> bool {
        offset >= span.start && offset < span.end
    }

    // An explicit worklist rather than recursion: `ast.rs` builds trees up to roughly `MAX_TOKENS`/2
    // deep and states that its own `Drop` is iterative for exactly that reason. A recursive walk here
    // would overflow on the documents that module already guards against.
    let mut out = Walked::default();
    let mut blocks: Vec<&Block> = vec![&program.block];
    let mut exprs: Vec<&Expr> = Vec::new();

    while let Some(block) = blocks.pop() {
        for stmt in &block.stmts {
            match stmt {
                Stmt::Let { value, .. } | Stmt::Assign { value, .. } => exprs.push(value),
                Stmt::Fn { params, body, name_span, .. } => {
                    out.fns.push((*name_span, params.len()));
                    blocks.push(body);
                }
                // A `while` holds both an expression and a block, and an earlier draft of this walk
                // visited neither — a literal in a loop condition would never have hovered.
                Stmt::While { cond, body, .. } => {
                    exprs.push(cond);
                    blocks.push(body);
                }
                // The common case, and the one the earlier draft also missed: a bare expression
                // statement. `fact(3)` on its own line is this, not the block's tail.
                Stmt::Expr(e) => exprs.push(e),
                Stmt::Error { .. } => {}
            }
        }
        if let Some(tail) = block.tail.as_deref() {
            exprs.push(tail);
        }

        while let Some(expr) = exprs.pop() {
            match expr {
                Expr::Nat { value, span } => {
                    if holds(*span, offset) {
                        out.literal = Some((*span, Lit::Nat(*value)));
                    }
                }
                Expr::Bool { value, span } => {
                    if holds(*span, offset) {
                        out.literal = Some((*span, Lit::Bool(*value)));
                    }
                }
                Expr::List { items, .. } => exprs.extend(items),
                Expr::Binary { lhs, rhs, .. } => {
                    exprs.push(lhs);
                    exprs.push(rhs);
                }
                Expr::Call { callee, args, .. } => {
                    exprs.push(callee);
                    exprs.extend(args);
                }
                Expr::Method { recv, args, .. } => {
                    exprs.push(recv);
                    exprs.extend(args);
                }
                Expr::If { cond, then_blk, else_blk, .. } => {
                    exprs.push(cond);
                    blocks.push(then_blk);
                    blocks.push(else_blk);
                }
                Expr::Block { block, .. } => blocks.push(block),
                Expr::Lambda { body, .. } => exprs.push(body),
                Expr::Var { .. } | Expr::Error { .. } => {}
            }
        }
    }
    out
}

/// The signature and description of a builtin, or `None` for a name that is not one.
///
/// **THE LOOKUP IS `type_env`, NOT `BUILTIN_NAMES`.** One lookup answers both "is this a builtin" and
/// "what is its type", and `prelude.rs`'s own comment rests a paragraph on nothing reading
/// `BUILTIN_NAMES`. Keeping that true costs nothing here.
fn builtin(name: &str) -> Option<(String, &'static str)> {
    let scheme = crate::prelude::type_env().into_iter().find(|(n, _)| n == name).map(|(_, s)| s)?;
    // Authored, because a type cannot say any of it. The `fault` halves are `interp`'s behaviour,
    // which the signatures above give no hint of.
    let description = match name {
        "nil" => "The empty list.",
        "cons" => "Prepends an element to a list.",
        "head" => "The first element. Faults on an empty list.",
        "tail" => "Everything after the first element. Faults on an empty list.",
        "is_empty" => "Whether a list has no elements.",
        _ => return None,
    };
    Some((format!("{name} : {}", crate::ty::show(&scheme.ty)), description))
}

/// Hover for the `.rxt` source form.
///
/// `nav` is the caller's already-built `NameIndex` for `src` — `binder::nav_rxt(src)`, or `None`
/// where the caller has none (an `.rxt` above `MAX_TOKENS` refuses to parse, so `nav_rxt` answers
/// `None` too; passing that straight through changes no answer, since the name-resolution branch
/// below would find nothing to resolve against either way). Building it here instead would be a
/// second parse of `src` on every request — see `redextape-lsp`'s `Document::nav` for the cost.
#[must_use]
pub fn rxt(src: &str, offset: usize, nav: Option<&NameIndex>) -> Option<HoverAnswer> {
    // `parse_for_nav`, not `parse_full`: the file hover is worth most on is the one being typed
    // into, which is exactly the file `parse_full` answers `None` for. This is the same choice
    // `nav_rxt` states for itself.
    let (parsed, _diags) = crate::parser::parse_for_nav(src);
    let parsed = parsed?;

    let walked = walk(&parsed.program, offset);
    if let Some((span, lit)) = walked.literal {
        return Some(match lit {
            Lit::Nat(n) => HoverAnswer {
                title: "Nat".to_string(),
                // Decimal, hex and binary. The source grammar has no radix prefix — `lexer.rs` takes
                // digits and nothing else — so these are informational and cannot be typed back.
                lines: vec![format!("{n}  ·  {n:#x}  ·  {n:#b}")],
                span,
            },
            Lit::Bool(b) => HoverAnswer {
                title: "Bool".to_string(),
                // A Bool has no bases. What it has is a lowering: `lower_asm`'s `Core::Bool` arm
                // emits `Li(dst, u64::from(*b))`, so the value below is that arm's and not a
                // convention invented here.
                lines: vec![format!("lowers to {} in a register", u64::from(b))],
                span,
            },
        });
    }

    // A name, resolved through the index `definition` and `references` already share — the one
    // passed in above, not rebuilt here. The literal branch ran first because a literal is not an
    // occurrence and the two cannot both match.
    let nav = nav?;
    let (i, occurrence) = nav.at(offset)?;
    let name = occurrence.name.clone();
    let span = occurrence.span;

    // A name this document BINDS is never the builtin of the same name, whatever it is called.
    if nav.definition_of(i).is_none()
        && let Some((signature, description)) = builtin(&name)
    {
        return Some(HoverAnswer { title: signature, lines: vec![description.to_string()], span });
    }

    // **ARITY IS KEYED ON THE DEFINITION'S SPAN, NOT ON THE NAME.** `DefKind::Fn` is a bare
    // discriminant and the count is `params.len()` on `Stmt::Fn`, which only the AST has — but
    // looking that `fn` up BY NAME would answer the wrong one wherever a name is shadowed. The span
    // `NameIndex` stores for a declaration is the same `name_span` the AST carries, so matching on
    // it is exact. A cursor on a `let` resolves to a definition no `fn` declares, and falls through.
    let definition = nav.get(nav.definition_of(i)?)?;
    let arity = walked.fns.iter().find(|(s, _)| *s == definition.span).map(|(_, n)| *n)?;
    Some(HoverAnswer {
        title: format!("fn {name}"),
        lines: vec![format!("{arity} parameter{}", if arity == 1 { "" } else { "s" })],
        span,
    })
}

/// Hover for the `.tm` text form.
///
/// `nav` is the caller's already-built `NameIndex` for `src` — `tm::parse_tm_nav(src).1`, which is
/// always `Some` for a form with no `MAX_TOKENS`-style ceiling. Building it here instead would be a
/// second parse of `src` on every request — see `redextape-lsp`'s `Document::nav` for the cost.
#[must_use]
pub fn tm(src: &str, offset: usize, nav: Option<&NameIndex>) -> Option<HoverAnswer> {
    // The rule row runs first, but NOT because a rule line holds no state name — it does: a `goto`
    // target pushes a `Reference` occurrence for it, exactly like `start q0` does. What actually
    // keeps the two rows apart is the `Role::Definition { kind: DefKind::State, .. }` guard below,
    // which a `goto`'s `Reference` fails and a `state <name>:` header's `Definition` passes. Delete
    // that guard as "redundant" and hovering `q0` on a `start q0` line would answer a rule count
    // scanned forward from the `start` line — a number about nothing.
    if let Some((span, facts)) = crate::tm::rule_at(src, offset) {
        let sym = |s: &Option<char>| s.map_or_else(|| "any symbol".to_string(), |c| format!("`{c}`"));
        let reads = facts.reads.iter().map(sym).collect::<Vec<_>>().join(", ");
        let writes = facts.writes.iter().map(sym).collect::<Vec<_>>().join(", ");
        let moves = facts
            .moves
            .iter()
            .map(|m| match m {
                crate::tm::Move::L => "left",
                crate::tm::Move::R => "right",
                crate::tm::Move::S => "stays",
            })
            .collect::<Vec<_>>()
            .join(", ");
        return Some(HoverAnswer {
            title: format!("rule → {}", facts.goto),
            lines: vec![
                format!("reads {reads}"),
                format!("writes {writes}"),
                format!("moves {moves}"),
                format!("then goes to `{}`", facts.goto),
            ],
            span,
        });
    }

    let nav = nav?;
    let (_, occurrence) = nav.at(offset)?;
    if !matches!(occurrence.role, crate::nav::Role::Definition { kind: crate::nav::DefKind::State, .. }) {
        return None;
    }
    let count = crate::tm::state_rule_count(src, occurrence.span);
    Some(HoverAnswer {
        title: format!("state {}", occurrence.name),
        lines: vec![format!("{count} rule{}", if count == 1 { "" } else { "s" })],
        span: occurrence.span,
    })
}

/// The 1-based line number `offset` falls on.
///
/// Line numbers, not byte offsets, are what a hover ANSWER says — this crate's `file:line` ban is on
/// citations in tracked source, not on a location this module hands the person reading the editor.
fn line_of(src: &str, offset: usize) -> usize {
    src.get(..offset).unwrap_or(src).matches('\n').count() + 1
}

/// Hover for the `.asm` text form.
///
/// `nav` is the caller's already-built `NameIndex` for `src` — `tm::parse_asm_nav(src).1`, which is
/// always `Some` for a form with no `MAX_TOKENS`-style ceiling. Building it here instead would be a
/// second parse of `src` on every request — see `redextape-lsp`'s `Document::nav` for the cost.
#[must_use]
pub fn asm(src: &str, offset: usize, nav: Option<&NameIndex>) -> Option<HoverAnswer> {
    if let Some((span, doc)) = crate::tm::instr_at(src, offset) {
        let mut lines = vec![doc.summary.to_string()];
        if !doc.operands.is_empty() {
            lines.push(format!("operands: {}", doc.operands.join(", ")));
        }
        return Some(HoverAnswer { title: doc.mnemonic.to_string(), lines, span });
    }

    let nav = nav?;
    let (i, occurrence) = nav.at(offset)?;
    // BOTH ARMS ARE STRUCT VARIANTS. `Role::Reference` carries a `def: Option<usize>` — a
    // dangling reference is an ordinary value here, because `parse_asm_full` accepts
    // `jmp nowhere` with zero diagnostics — so this matches `{ .. }` rather than a bare name.
    //
    // **THE REFERENCE ROW NAMES A LINE, NOT JUST A ROLE.** §8's design table promises "where it is
    // defined" for a label hover; the role alone ("A jump or call target.") never says where.
    // `NameIndex::definition_of` resolves the reference to its definition, and that definition's
    // span, run through `line_of`, is the location the row is named for. A dangling reference — the
    // `def: None` case above — has no definition to name, and the row says only what it is.
    let lines = match occurrence.role {
        crate::nav::Role::Definition { .. } => vec!["Defined here.".to_string()],
        crate::nav::Role::Reference { .. } => {
            let mut lines = vec!["A jump or call target.".to_string()];
            if let Some(def) = nav.definition_of(i).and_then(|d| nav.get(d)) {
                lines.push(format!("Defined on line {}.", line_of(src, def.span.start)));
            }
            lines
        }
    };
    Some(HoverAnswer { title: format!("label {}", occurrence.name), lines, span: occurrence.span })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The answer's title and lines joined, for assertions that do not care about the split.
    fn text(a: &HoverAnswer) -> String {
        std::iter::once(a.title.clone()).chain(a.lines.iter().cloned()).collect::<Vec<_>>().join("\n")
    }

    /// `rxt`, building its own `NameIndex` fresh. What every name-resolving test below needs: the
    /// cache `rxt` now takes instead of building lives one crate up, in `redextape-lsp`'s
    /// `Document`, which no test here constructs.
    fn rxt_with_nav(src: &str, offset: usize) -> Option<HoverAnswer> {
        let nav = crate::binder::nav_rxt(src);
        rxt(src, offset, nav.as_ref())
    }

    /// `tm`, building its own `NameIndex` fresh — the state-name row's sibling of `rxt_with_nav`.
    fn tm_with_nav(src: &str, offset: usize) -> Option<HoverAnswer> {
        let nav = crate::tm::parse_tm_nav(src).1;
        tm(src, offset, Some(&nav))
    }

    /// `asm`, building its own `NameIndex` fresh — the label row's sibling of `rxt_with_nav`.
    fn asm_with_nav(src: &str, offset: usize) -> Option<HoverAnswer> {
        let nav = crate::tm::parse_asm_nav(src).1;
        asm(src, offset, Some(&nav))
    }

    #[test]
    fn a_nat_literal_hovers_with_its_other_bases() {
        let src = "let x = 42;\nx\n";
        let at = src.find("42").expect("fixture holds it");
        let a = rxt(src, at, None).expect("a literal answers");
        assert_eq!(a.span, Span { start: at, end: at + 2 });
        assert!(text(&a).contains("Nat"), "{}", text(&a));
        assert!(text(&a).contains("0x2a"), "{}", text(&a));
        assert!(text(&a).contains("0b101010"), "{}", text(&a));
    }

    #[test]
    fn a_bool_literal_hovers_with_what_it_lowers_to() {
        // `1` and `0` are `lower_asm`'s, not this module's invention: `Core::Bool(_, b)` emits
        // `Li(dst, u64::from(*b))`. A Bool has no bases, which is why this row says something else.
        let src = "let b = true;\nb\n";
        let at = src.find("true").expect("fixture holds it");
        let a = rxt(src, at, None).expect("a literal answers");
        assert!(text(&a).contains("Bool"), "{}", text(&a));
        assert!(text(&a).contains('1'), "{}", text(&a));

        let src = "let b = false;\nb\n";
        let at = src.find("false").expect("fixture holds it");
        let a = rxt(src, at, None).expect("a literal answers");
        assert!(text(&a).contains('0'), "{}", text(&a));
    }

    #[test]
    fn a_cursor_on_nothing_answers_nothing() {
        let src = "let x = 42;\nx\n";
        // On the `let` keyword, and past the end of the document.
        assert!(rxt(src, 1, None).is_none());
        assert!(rxt(src, src.len() + 99, None).is_none());
    }

    #[test]
    fn a_literal_hovers_in_every_construct_that_can_hold_one() {
        // ONE ROW PER STATEMENT KIND THAT CARRIES AN EXPRESSION. An earlier draft of the walk
        // visited `Let`, `Assign` and `Fn` only, so a literal in a `while` condition, a `while`
        // body or a bare expression statement answered nothing — and the bare expression statement
        // is the commonest shape a program has.
        let cases = [
            ("let x = 7;\nx\n", "a let"),
            ("fn f(a) { 7 }\nf(1)\n", "a fn body"),
            ("let mut i = 0;\nwhile i < 7 { i = i + 1; }\ni\n", "a while condition"),
            ("let mut i = 0;\nwhile i < 3 { i = i + 7; }\ni\n", "a while body"),
            ("fn f(a) { a }\nf(7);\n0\n", "a bare expression statement"),
            ("let x = if true { 7 } else { 0 };\nx\n", "an if branch"),
            ("let xs = [7];\nxs\n", "a list element"),
        ];
        for (src, what) in cases {
            let at = src.find('7').unwrap_or_else(|| panic!("fixture for {what} must hold a 7"));
            assert!(rxt(src, at, None).is_some(), "no hover for a literal in {what}");
        }
    }

    #[test]
    fn the_walk_descends_into_call_args_and_binary_operands_rather_than_stopping_at_the_statement() {
        // A literal inside a call inside a binary: the walk must reach through both constructs, or a
        // literal hover anywhere but the top of a statement answers nothing.
        let src = "fn f(a) { a }\nlet y = f(7) + 100;\ny\n";
        let at = src.find('7').expect("fixture holds it");
        let a = rxt(src, at, None).expect("the literal answers");
        assert_eq!(a.span, Span { start: at, end: at + 1 });
        assert!(text(&a).contains('7'), "{}", text(&a));
    }

    #[test]
    fn a_fn_name_hovers_with_its_arity() {
        let src = "fn add3(a, b, c) { a + b + c }\nadd3(1, 2, 3)\n";
        // On the declaration.
        let at = src.find("add3").expect("fixture holds it");
        let a = rxt_with_nav(src, at).expect("a fn name answers");
        assert!(text(&a).contains("add3"), "{}", text(&a));
        assert!(text(&a).contains('3'), "arity missing from {}", text(&a));

        // And on the CALL, which resolves through the same index `definition` uses.
        let call = src.rfind("add3").expect("fixture holds it twice");
        assert!(text(&rxt_with_nav(src, call).expect("a call answers")).contains("add3"));
    }

    #[test]
    fn a_builtin_hovers_with_its_signature_and_its_one_line() {
        let src = "head(cons(1, nil))\n";
        let at = src.find("head").expect("fixture holds it");
        let a = rxt_with_nav(src, at).expect("a builtin answers");
        // The signature is COMPUTED from `prelude::type_env` through `ty::show`, so this asserts the
        // shape rather than a string this module authored.
        assert!(text(&a).contains("head"), "{}", text(&a));
        assert!(text(&a).contains("List<"), "{}", text(&a));
        // The authored half: a type cannot say this.
        assert!(text(&a).to_lowercase().contains("empty"), "{}", text(&a));
    }

    #[test]
    fn every_builtin_has_a_line_of_its_own() {
        // A table with a hole answers `None` for one name and nothing says so. `type_env` is the
        // authority for WHICH names exist, so the loop is over it rather than over this module's table.
        for (name, _) in crate::prelude::type_env() {
            let src = format!("{name}\n");
            let a = rxt_with_nav(&src, 0).unwrap_or_else(|| panic!("no hover for builtin `{name}`"));
            assert!(!a.lines.is_empty(), "builtin `{name}` has a signature and no line");
        }
    }

    #[test]
    fn a_shadowed_fn_name_answers_the_declaration_the_cursor_resolves_to() {
        // The reason arity is keyed on the DEFINITION'S SPAN rather than looked up by name: both
        // `f`s below are declared, with different arities, and a name lookup answers whichever the
        // walk happened to reach first for both cursors.
        let src = "fn f(p) { fn f(q, r) { q } f(1, 2) }\nf(0)\n";
        let outer = src.find("f(0)").expect("fixture holds the outer call");
        let a = rxt_with_nav(src, outer).expect("the outer call answers");
        assert!(text(&a).contains('1'), "the outer f takes one parameter: {}", text(&a));

        let inner = src.find("f(1, 2)").expect("fixture holds the inner call");
        let a = rxt_with_nav(src, inner).expect("the inner call answers");
        assert!(text(&a).contains('2'), "the inner f takes two parameters: {}", text(&a));
    }

    #[test]
    fn a_local_binding_is_not_mistaken_for_a_builtin() {
        // `head` shadowed by a `let` must not answer with the builtin's signature.
        let src = "let head = 1;\nhead\n";
        let at = src.rfind("head").expect("fixture holds it");
        let a = rxt_with_nav(src, at);
        assert!(
            a.as_ref().is_none_or(|a| !text(a).contains("List<")),
            "a shadowed name answered as the builtin: {a:?}"
        );
    }

    const MACHINE: &str = "\
tapes 1
start q0

state q0:
  [a] -> write [b], move [R], goto q1
  [b] -> write [a], move [L], goto q0
state q1: accept
";

    #[test]
    fn a_rule_hovers_with_what_it_does_in_words() {
        let at = MACHINE.find("write [b]").expect("fixture holds it");
        let a = tm(MACHINE, at, None).expect("a rule answers");
        let t = text(&a);
        assert!(t.contains('b'), "{t}");
        assert!(t.contains("q1"), "the goto target is missing from {t}");
        // The move, in words rather than as the letter the file already shows.
        assert!(t.to_lowercase().contains("right"), "{t}");

        // MACHINE's SECOND rule moves LEFT and goes to `q0` — the opposite of the first rule on both
        // counts. Asserted too, so the direction and the goto target are both shown to vary with the
        // rule under the cursor rather than being constants an implementation could have hardcoded
        // from the first rule alone (an implementation that always said "right" would still pass the
        // assertions above, since the first rule really does move right).
        let at = MACHINE.find("write [a]").expect("fixture holds it");
        let a = tm(MACHINE, at, None).expect("a rule answers");
        let t = text(&a);
        assert!(t.contains('a'), "{t}");
        assert!(t.contains("q0"), "the goto target is missing from {t}");
        assert!(t.to_lowercase().contains("left"), "{t}");
    }

    #[test]
    fn a_wildcard_and_multi_tape_rule_hovers_with_every_element() {
        // A two-tape rule with a `*` wildcard in it, so ONE fixture exercises both gaps: the `sym`
        // closure's `None => "any symbol"` branch (never run by `MACHINE`, which has no wildcard),
        // and the `", "`-joining of reads/writes/moves across more than one element (never run by
        // `MACHINE`, which is single-tape). Consulted `parse_rule_line` for the exact syntax — one
        // space-separated symbol/move per tape, inside each `[..]` group.
        let src = "\
tapes 2
start q0

state q0:
  [a *] -> write [* b], move [R L], goto q1
state q1: accept
";
        assert!(
            crate::tm::parse_tm_full(src).machine.is_some(),
            "the fixture must actually parse, or this test proves nothing about the wildcard/multi-tape paths"
        );
        let at = src.find("write [* b]").expect("fixture holds it");
        let a = tm(src, at, None).expect("a rule answers");
        let t = text(&a);
        assert!(t.contains("any symbol"), "the wildcard's `None` branch never ran: {t}");
        assert!(t.contains("`a`"), "the first tape's read is missing from {t}");
        assert!(t.contains("`b`"), "the second tape's write is missing from {t}");
        assert!(t.to_lowercase().contains("right"), "{t}");
        assert!(t.to_lowercase().contains("left"), "the second tape's move is missing from {t}");
    }

    #[test]
    fn a_state_name_hovers_with_how_many_rules_it_has() {
        let at = MACHINE.find("q0:").expect("fixture holds it");
        let a = tm_with_nav(MACHINE, at).expect("a state answers");
        assert!(text(&a).contains('2'), "q0 has two rules: {}", text(&a));

        let at = MACHINE.find("q1:").expect("fixture holds it");
        let a = tm_with_nav(MACHINE, at).expect("a state answers");
        assert!(text(&a).contains('0'), "q1 has none: {}", text(&a));
    }

    #[test]
    fn a_rule_in_a_file_carrying_an_error_still_hovers() {
        // THE PROPERTY §8.3 EXISTS FOR, and the hover sibling of
        // `definition_in_a_broken_file_still_answers`. The broken line is a DIFFERENT line from the
        // one under the cursor: `TmDocument::machine` is `None` for this whole document, so a hover
        // built on the machine answers nothing here.
        let broken = "tapes 1\nstart q0\n\nstate q0:\n  [a] -> write [b], move [R], goto q1\n  this line is not a rule\nstate q1: accept\n";
        assert!(
            crate::tm::parse_tm_full(broken).machine.is_none(),
            "the fixture must really be broken, or this test proves nothing"
        );
        let at = broken.find("write [b]").expect("fixture holds it");
        let a = tm(broken, at, None).expect("a rule in a broken file still answers");
        assert!(text(&a).contains("q1"), "{}", text(&a));
    }

    #[test]
    fn a_malformed_rule_line_answers_nothing() {
        let broken = "tapes 1\nstart q0\n\nstate q0:\n  this line is not a rule\n";
        let at = broken.find("not a rule").expect("fixture holds it");
        assert!(tm(broken, at, None).is_none());
    }

    const PROGRAM: &str = "\
result Nat
f:
    li\tr0, #1
    ret
";

    #[test]
    fn an_instruction_hovers_with_what_it_does_and_its_operand_roles() {
        let at = PROGRAM.find("li").expect("fixture holds it");
        let a = asm(PROGRAM, at, None).expect("an instruction answers");
        let t = text(&a);
        assert!(t.contains("li"), "{t}");
        assert!(t.to_lowercase().contains("immediate"), "{t}");
        assert!(t.contains("destination"), "the operand roles are missing from {t}");
    }

    /// `g` is defined once (line 6, `g:`) and referenced twice — `jz`'s second operand (line 4) and
    /// `jmp`'s operand (line 5).
    const LABELED: &str = "result Nat\nf:\n\tli\tr0, #1\n\tjz\tr0, g\n\tjmp\tg\ng:\n\tret\n";

    #[test]
    fn a_label_hovers_with_where_it_is_defined() {
        // THE OLD TEST PROVED NOTHING ABOUT THE LOCATION. It hovered a DEFINITION (`PROGRAM`'s
        // `f:`), whose title is `label f` — `text(&a).contains('f')` passed off that title alone,
        // with `lines` never read, so an answer of `lines: vec![]` for `Role::Definition` would have
        // satisfied it exactly as well as `"Defined here."` does. This fixture instead hovers a
        // REFERENCE (`g`, used twice) and checks the actual LINE NUMBER its definition (`g:`) sits on.
        let g_line = LABELED.lines().position(|l| l == "g:").expect("fixture holds it") + 1;
        assert_eq!(g_line, 6, "fixture drifted under the test that assumes this");

        let at = LABELED.find("jz\tr0, g").map(|i| i + "jz\tr0, ".len()).expect("fixture holds it");
        let reference = asm_with_nav(LABELED, at).expect("a reference answers");
        assert!(
            text(&reference).contains(&format!("line {g_line}")),
            "a reference must name where `g` is defined: {}",
            text(&reference)
        );

        let at = LABELED.find("g:\n").expect("fixture holds it");
        let definition = asm_with_nav(LABELED, at).expect("a definition answers");
        assert!(text(&definition).contains("Defined here."), "{}", text(&definition));

        // The wasm-boundary test asserts the two arms differ; this checks the same property against
        // the location specifically, so a fix that made both arms report the same line would still
        // be caught here even though `Defined here.` and `A jump or call target.` already differ.
        assert_ne!(text(&reference), text(&definition));
    }
}
