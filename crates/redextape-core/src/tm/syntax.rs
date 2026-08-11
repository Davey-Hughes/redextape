//! The TM text form: a flat, line-oriented, human-readable language for a `Machine`. `print_tm`
//! renders it; `parse_tm` reads it back (Task 4); they round-trip (design §9). Reserved markers:
//! `_` is the blank symbol, `*` is the read-wildcard / write-unchanged marker, and `;` starts a
//! comment (whole-line or trailing). The round-trip guarantee
//! `parse_tm(print_tm(m)) == (Some(m), [])` holds for every `Machine` that passes
//! `Machine::validate()` **and declares `tapes <= MAX_TAPES`** — i.e. identifier-ish state names (no
//! whitespace or reserved `; * : [ ]`), data symbols outside the reserved set, and a tape count the
//! parser will accept back. `lower_tm` produces only such machines; a machine outside this
//! representable subset is *rejected* by `validate` rather than silently corrupted.
//!
//! **The tape-count clause is a real caveat, not a formality, and `validate()` does not enforce it.**
//! `validate()` places no bound on `tapes`, and an accept-only machine has no rules, so the
//! rule-arity check is vacuous for it — making `Machine { tapes: 100, states: [accept], .. }`
//! validate()-clean. `print_tm` writes `tapes 100` faithfully and `parse_tm` then refuses it, because
//! `MAX_TAPES` is a totality guard on untrusted input (see `build::MAX_TAPES`). The asymmetry is
//! deliberate — the guard protects a reader from a hostile file — but it means "representable" is a
//! slightly narrower set than "validate()-clean", and this is where that is written down.
//!
//! `print_tm`/`parse_tm` are the header-less pair above. `print_tm_with`/`parse_tm_full` are their
//! header-carrying siblings: a file may additionally record a `TmHeader` (initial tapes, plus the
//! `encoding`/`width`/`slots`/`result` recipe for interpreting the answer — see `tm::header`'s module
//! doc for why that lives on the side rather than on `Machine`). The header is OPTIONAL; `parse_tm` is
//! a thin wrapper that discards it, so a header-less file and a headered one both parse to the same
//! machine.
//!
//! Each printer has a `_mapped` counterpart returning the same text plus a class per span:
//! `print_tm`/`print_tm_mapped` and `print_tm_with`/`print_tm_with_mapped`. The suffix means the same
//! thing here as in `print_asm`/`print_asm_mapped` and `print_lambda`/`print_lambda_mapped` — adding
//! it never changes WHICH text is produced, only whether the classification comes back with it.
//!
//! ## What a reader must assume beyond δ and q₀
//!
//! These are properties of the FORMAT, not of any one machine, and a foreign simulator that assumes
//! otherwise diverges silently:
//!
//! - **Each tape's head starts at cell 0** of its literal contents (an omitted `tape` line means an
//!   empty tape, whose head is at its single blank cell).
//! - **Tapes are TWO-WAY infinite.** Moving left from cell 0 is legal and yields a blank; it does not
//!   halt or error. A reader modelling a one-way tape computes a different function.
//! - **A state with no rule matching the current symbols HALTS**, and halting is not failure — the
//!   final tapes are the result. Only an `accept` state is distinguished, and only for readers that
//!   care about acceptance rather than output.

use crate::analysis::{Classified, TokenClass as C, push_span};
use crate::diagnostic::Severity;
use crate::tm::build::MAX_TAPES;
use crate::tm::header::{HeaderParts, TmHeader, write_header};
use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
use crate::{Diagnostic, Span};

/// One read/write entry: `*` for the wildcard (read) / unchanged (write) marker, else the symbol.
/// Takes `s` by value: `Option<Symbol>` is `Copy` (`Symbol` is `char`), so passing the 4-byte value is
/// cheaper than a reference to it (`clippy::trivially_copy_pass_by_ref`/`clippy::ref_option`).
fn write_sym(out: &mut String, spans: &mut Classified, s: Option<Symbol>) {
    let mut buf = [0u8; 4];
    let text: &str = match s {
        None => "*",
        Some(c) => c.encode_utf8(&mut buf),
    };
    push_span(out, spans, text, C::TapeSymbol);
}

/// A space-separated symbol list, as it appears inside a `[..]` group.
fn write_syms(out: &mut String, spans: &mut Classified, v: &[Option<Symbol>]) {
    for (i, s) in v.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        write_sym(out, spans, *s);
    }
}

/// A space-separated move list, as it appears inside `move [..]`.
fn write_moves(out: &mut String, spans: &mut Classified, v: &[Move]) {
    for (i, m) in v.iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        let text = match m {
            Move::L => "L",
            Move::R => "R",
            Move::S => "S",
        };
        push_span(out, spans, text, C::Move);
    }
}

/// The name of a state by id, or a fallback so printing never panics on a malformed `Machine`. `class`
/// is the caller's, because the same name is `Label` where it is DEFINED and `StateName` where it is
/// referenced (`start`, `goto`) — that distinction is the whole reason a renderer can link the two.
fn write_state_name(out: &mut String, spans: &mut Classified, m: &Machine, id: u32, class: C) {
    match m.states.get(id as usize) {
        Some(s) => push_span(out, spans, &s.name, class),
        None => push_span(out, spans, &format!("<state {id}>"), class),
    }
}

/// Render `m` as the readable TM text form, with NO header. Byte-identical to what this function has
/// always emitted — a machine printed without a header must stay exactly as readable, and as
/// parseable, as it was before headers existed.
#[must_use]
pub fn print_tm(m: &Machine) -> String {
    print_tm_mapped(m).0
}

/// Render `m` with `h`'s directives between `start` and the states. The result is a complete,
/// self-describing `.tm` file: a reader can build the initial configuration and simulate it with no
/// knowledge of this project, and decode the answer given the encoding implementations.
#[must_use]
pub fn print_tm_with(m: &Machine, h: &TmHeader) -> String {
    print_tm_with_mapped(m, h).0
}

/// `print_tm`, plus a class per span of the produced text.
#[must_use]
pub fn print_tm_mapped(m: &Machine) -> (String, Classified) {
    print_tm_inner(m, None)
}

/// `print_tm_with`, plus a class per span of the produced text — header directives included.
#[must_use]
pub fn print_tm_with_mapped(m: &Machine, h: &TmHeader) -> (String, Classified) {
    print_tm_inner(m, Some(h))
}

/// The one printer. The header's presence is the ONLY difference between the entry points above, which
/// is what keeps them from drifting. Spans are pushed as each piece is appended, so an offset is exact
/// by construction and nothing re-scans the output.
fn print_tm_inner(m: &Machine, header: Option<&TmHeader>) -> (String, Classified) {
    let mut out = String::new();
    let mut spans: Classified = Vec::new();
    let (o, s) = (&mut out, &mut spans);
    push_span(o, s, "tapes", C::Keyword);
    o.push(' ');
    push_span(o, s, &m.tapes.to_string(), C::Nat);
    o.push('\n');
    push_span(o, s, "start", C::Keyword);
    o.push(' ');
    write_state_name(o, s, m, m.start, C::StateName);
    o.push('\n');
    if let Some(h) = header {
        write_header(o, s, h);
    }
    o.push('\n');
    for st in &m.states {
        push_span(o, s, "state", C::Keyword);
        o.push(' ');
        push_span(o, s, &st.name, C::Label);
        push_span(o, s, ":", C::Punct);
        if st.accept {
            o.push(' ');
            push_span(o, s, "accept", C::Keyword);
            o.push('\n');
            continue;
        }
        o.push('\n');
        for r in &st.rules {
            o.push_str("  ");
            push_span(o, s, "[", C::Punct);
            write_syms(o, s, &r.read);
            push_span(o, s, "]", C::Punct);
            o.push(' ');
            push_span(o, s, "->", C::Punct);
            o.push(' ');
            push_span(o, s, "write", C::Keyword);
            o.push(' ');
            push_span(o, s, "[", C::Punct);
            write_syms(o, s, &r.write);
            push_span(o, s, "]", C::Punct);
            push_span(o, s, ",", C::Punct);
            o.push(' ');
            push_span(o, s, "move", C::Keyword);
            o.push(' ');
            push_span(o, s, "[", C::Punct);
            write_moves(o, s, &r.moves);
            push_span(o, s, "]", C::Punct);
            push_span(o, s, ",", C::Punct);
            o.push(' ');
            push_span(o, s, "goto", C::Keyword);
            o.push(' ');
            write_state_name(o, s, m, r.next, C::StateName);
            o.push('\n');
        }
    }
    (out, spans)
}

fn err(span: Span, message: impl Into<String>) -> Diagnostic {
    Diagnostic { span, severity: Severity::Error, message: message.into() }
}

/// A rule whose `goto` is still a name (resolved after all states are seen).
struct RawRule {
    read: Vec<Option<Symbol>>,
    write: Vec<Option<Symbol>>,
    moves: Vec<Move>,
    goto: String,
    span: Span,
}

struct RawState {
    name: String,
    accept: bool,
    rules: Vec<RawRule>,
}

/// Parse one read/write symbol token: `*` -> wildcard/unchanged, any other single char -> that symbol
/// (`_` is the blank symbol). A multi-char token uses its first char.
fn parse_sym(tok: &str) -> Option<Symbol> {
    if tok == "*" { None } else { Some(tok.chars().next().unwrap_or(BLANK)) }
}

fn parse_move(tok: &str) -> Option<Move> {
    match tok {
        "L" => Some(Move::L),
        "R" => Some(Move::R),
        "S" => Some(Move::S),
        _ => None,
    }
}

/// Strip a leading `[...]` group, returning `(inside, rest_after_bracket)`.
fn bracket(s: &str, span: Span) -> Result<(&str, &str), Diagnostic> {
    let s = s.trim_start();
    let s = s.strip_prefix('[').ok_or_else(|| err(span, "expected `[`"))?;
    let close = s.find(']').ok_or_else(|| err(span, "expected `]`"))?;
    Ok((&s[..close], &s[close + 1..]))
}

/// Parse a single rule line body (already known to start with `[`). Strips a trailing `;` comment.
fn parse_rule_line(line: &str, span: Span) -> Result<RawRule, Diagnostic> {
    let line = line.split(';').next().unwrap_or("").trim();
    let (read_s, rest) = bracket(line, span)?;
    let rest = rest.trim_start().strip_prefix("->").ok_or_else(|| err(span, "expected `->`"))?;
    let rest = rest.trim_start().strip_prefix("write").ok_or_else(|| err(span, "expected `write`"))?;
    let (write_s, rest) = bracket(rest, span)?;
    let rest = rest.trim_start().strip_prefix(',').ok_or_else(|| err(span, "expected `,`"))?;
    let rest = rest.trim_start().strip_prefix("move").ok_or_else(|| err(span, "expected `move`"))?;
    let (moves_s, rest) = bracket(rest, span)?;
    let rest = rest.trim_start().strip_prefix(',').ok_or_else(|| err(span, "expected `,`"))?;
    let goto = rest.trim_start().strip_prefix("goto").ok_or_else(|| err(span, "expected `goto`"))?.trim();
    if goto.is_empty() {
        return Err(err(span, "expected a goto target"));
    }
    let read = read_s.split_whitespace().map(parse_sym).collect();
    let write = write_s.split_whitespace().map(parse_sym).collect();
    // Named `moves_s` (not `move_s`) to stay clear of `moves` below — `clippy::similar_names` flagged
    // the original `move_s`/`moves` pair, and this keeps the `<field>_s` (raw bracket text) vs
    // `<field>` (parsed value) convention that `read_s`/`write_s` already use.
    let moves = moves_s
        .split_whitespace()
        .map(parse_move)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| err(span, "bad move (expected L/R/S)"))?;
    Ok(RawRule { read, write, moves, goto: goto.to_string(), span })
}

/// Reject a header directive that appears AFTER the first `state`.
///
/// The grammar has always said directives "must precede the first `state`", and the parser has always
/// accepted them anywhere — a divergence that only gets more expensive with age, because every file
/// written in the meantime that violates the stated grammar is one a later, stricter parser breaks.
/// The printer emits them in position unconditionally, so no file this project produces is affected;
/// enforcing now costs nothing and closes the gap while that is still true.
fn header_position(key: &str, states: &[RawState]) -> Result<(), String> {
    if states.is_empty() {
        Ok(())
    } else {
        Err(format!("`{key}` must precede the first `state` (header directives come before the states)"))
    }
}

/// Parse the TM text form, dropping any header. Unchanged in signature and behaviour: a file with a
/// header still reads as the machine it describes (optionality property 3).
///
/// A thin wrapper over `parse_tm_full` rather than a second parser (spec D2). This is not an
/// aesthetic preference: `parse_tm` MUST be taught to skip header directives regardless, or it hits
/// its unknown-line error path and rejects any file carrying one. Given that it must change, having
/// it delegate removes the failure mode where two parsers drift.
#[must_use]
pub fn parse_tm(src: &str) -> (Option<Machine>, Vec<Diagnostic>) {
    let (m, _, ds) = parse_tm_full(src);
    (m, ds)
}

/// Parse the TM text form, returning the header too. Iterative (flat grammar, no recursion). Never
/// panics.
///
/// A `None` header means the file carried none, which is NOT an error — see `HeaderParts::finish`.
///
/// `clippy::too_many_lines`: this is one coherent per-line dispatch loop over a flat grammar (the
/// module doc says so explicitly — "Iterative, no recursion"), sharing six mutable accumulators
/// (`diags`, `tapes`, `start_name`, `states`, `header`, `offset`) across every line kind. Splitting it
/// would mean threading all six through new function boundaries for no gain in clarity — the loop
/// body's length comes from the number of line kinds the grammar has, not from doing too much in one
/// place.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn parse_tm_full(src: &str) -> (Option<Machine>, Option<TmHeader>, Vec<Diagnostic>) {
    let mut diags: Vec<Diagnostic> = Vec::new();
    let mut tapes: Option<usize> = None;
    let mut start_name: Option<(String, Span)> = None;
    let mut states: Vec<RawState> = Vec::new();
    let mut header = HeaderParts::default();

    let mut offset = 0usize;
    for raw_line in src.split_inclusive('\n') {
        let line_start = offset;
        offset += raw_line.len();
        let content = raw_line.trim_end_matches('\n');
        let span = Span { start: line_start, end: line_start + content.len() };
        // Strip a full-line comment / blank.
        let trimmed = content.trim_start();
        if trimmed.is_empty() || trimmed.starts_with(';') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("tapes ") {
            match rest.split(';').next().unwrap_or("").trim().parse::<usize>() {
                Ok(n) if (1..=MAX_TAPES).contains(&n) => tapes = Some(n),
                _ => diags.push(err(span, format!("expected `tapes <1..={MAX_TAPES}>`"))),
            }
        } else if let Some((key, rest)) = trimmed
            .split_once(' ')
            .filter(|(k, _)| matches!(*k, "version" | "encoding" | "width" | "slots" | "result" | "tape"))
        {
            if let Err(msg) = header_position(key, &states) {
                diags.push(err(span, msg));
            } else if let Some(Err(msg)) = header.directive(key, rest, span) {
                diags.push(err(span, msg));
            }
        } else if trimmed == "version" {
            // The one directive with no required argument shape to key off: every other directive's
            // dispatch above needs a space to find its `key`/`rest` split, but a bare `version` line
            // (no number at all) is exactly one of the malformed forms `directive` must still name as
            // a version error rather than fall through to "unrecognized line" — see
            // `an_unknown_version_is_an_error_not_a_warning`.
            if let Err(msg) = header_position("version", &states) {
                diags.push(err(span, msg));
            } else if let Some(Err(msg)) = header.directive("version", "", span) {
                diags.push(err(span, msg));
            }
        } else if let Some(rest) = trimmed.strip_prefix("start ") {
            start_name = Some((rest.split(';').next().unwrap_or("").trim().to_string(), span));
        } else if let Some(rest) = trimmed.strip_prefix("state ") {
            let rest = rest.split(';').next().unwrap_or("").trim();
            let Some((name, tail)) = rest.split_once(':') else {
                diags.push(err(span, "expected `state <name>:`"));
                continue;
            };
            let (name, tail) = (name.trim().to_string(), tail.trim());
            if name.is_empty() {
                diags.push(err(span, "empty state name"));
                continue;
            }
            let accept = tail == "accept";
            if !accept && !tail.is_empty() {
                diags.push(err(span, "expected `:` or `: accept` after the state name"));
            }
            if states.iter().any(|s| s.name == name) {
                diags.push(err(span, format!("duplicate state name `{name}`")));
            }
            states.push(RawState { name, accept, rules: Vec::new() });
        } else if trimmed.starts_with('[') {
            let Some(state) = states.last_mut() else {
                diags.push(err(span, "rule outside any state"));
                continue;
            };
            // Defense in depth: an accept state has no rules (`print_tm` drops them, and
            // `Machine::validate()` rejects any that carry them), so a rule line under an accept
            // header can never round-trip — flag it instead of silently accepting it.
            if state.accept {
                diags
                    .push(err(span, format!("rule after accept state `{}` (accept states have no rules)", state.name)));
                continue;
            }
            match parse_rule_line(trimmed, span) {
                Ok(r) => state.rules.push(r),
                Err(d) => diags.push(d),
            }
        } else {
            diags.push(err(span, "unrecognized line"));
        }
    }

    let Some(tapes) = tapes else {
        diags.push(err(Span { start: 0, end: 0 }, "missing `tapes <n>`"));
        return (None, None, diags);
    };

    let (parsed_header, header_errs) = header.finish(tapes);
    for (msg, sp) in header_errs {
        diags.push(err(sp.unwrap_or(Span { start: 0, end: 0 }), msg));
    }

    // Resolve names -> ids (definition order). Owned keys, so it does not borrow `states` and the
    // final builder can consume `states` freely. (Duplicate names were diagnosed above; if any exist
    // the error gate below returns `None` before this map is used to build.)
    // Bounded by `src.len()`, not by any explicit cap: `states` holds one entry per `state <name>:`
    // LINE actually present in `src`, which `parse_tm_full` takes as a single in-memory `&str` up
    // front (no streaming) — so reaching `StateId::MAX` (u32, ~4.29 billion) states requires a source
    // text of tens of GB already resident in memory, not a compact trigger for a disproportionate
    // allocation the way `tapes N` is (see `build::MAX_TAPES`'s doc for that distinction). No caller in
    // this tree can construct that input.
    //
    // THIS IS THE SAME SHAPE OF ARGUMENT `tm/build.rs` and `sourcemap.rs` removed — the reason it is
    // still sound HERE is worth citing rather than re-deriving. Parsing has a multiplier of ONE:
    // `parse_tm_full` produces at most one state per `state <name>:` line, so the input bounds the
    // count directly and the allocator refuses first. Lowering was dangerous because its state count
    // is a PRODUCT — a 6 KB program expands to 8.6M states (`build::MAX_MACHINE_STATES`'s doc) — and
    // no such multiplier exists here. See
    // `docs/superpowers/specs/2026-08-11-count-bounds-design.md` §6, which records the corollary this
    // site is an instance of: `MAX_MACHINE_STATES` bounds machines built through `Builder`, not
    // machines parsed from text.
    #[allow(clippy::cast_possible_truncation)]
    let ids: std::collections::HashMap<String, StateId> =
        states.iter().enumerate().map(|(i, s)| (s.name.clone(), i as StateId)).collect();
    for rs in &states {
        for rr in &rs.rules {
            if rr.read.len() != tapes || rr.write.len() != tapes || rr.moves.len() != tapes {
                diags.push(err(rr.span, format!("rule arity does not match `tapes {tapes}`")));
            }
            if !ids.contains_key(&rr.goto) {
                diags.push(err(rr.span, format!("unknown goto target `{}`", rr.goto)));
            }
        }
    }
    let start = if let Some((name, span)) = &start_name {
        if let Some(id) = ids.get(name).copied() {
            id
        } else {
            diags.push(err(*span, format!("unknown start state `{name}`")));
            0
        }
    } else {
        diags.push(err(Span { start: 0, end: 0 }, "missing `start <name>`"));
        0
    };

    if diags.iter().any(|d| d.severity == Severity::Error) {
        return (None, None, diags);
    }

    let machine = Machine {
        tapes,
        start,
        states: states
            .into_iter()
            .map(|rs| State {
                name: rs.name,
                accept: rs.accept,
                rules: rs
                    .rules
                    .into_iter()
                    .map(|rr| Rule {
                        read: rr.read,
                        write: rr.write,
                        moves: rr.moves,
                        next: ids.get(&rr.goto).copied().unwrap_or(0),
                    })
                    .collect(),
            })
            .collect(),
    };
    (Some(machine), parsed_header, diags)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::encoding::Unary;
    use crate::tm::lower_asm::lower_asm;
    use crate::tm::lower_tm::lower_tm;
    use crate::tm::machine::{Rule, State};
    use crate::{desugar::desugar, parser::parse};

    fn increment() -> Machine {
        Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "scan".into(),
                    accept: false,
                    rules: vec![
                        Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 0 },
                        Rule { read: vec![None], write: vec![Some('1')], moves: vec![Move::S], next: 1 },
                    ],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        }
    }

    #[test]
    fn print_tm_is_a_stable_readable_listing() {
        let expected = "\
tapes 1
start scan

state scan:
  [1] -> write [*], move [R], goto scan
  [*] -> write [1], move [S], goto halt
state halt: accept
";
        assert_eq!(print_tm(&increment()), expected);
    }

    use crate::tm::header::{EncodingKind, TmHeader};
    use crate::ty::Ty;

    fn a_header() -> TmHeader {
        TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(0, vec!['#', '_', '_', '_', '_', '#'])])
    }

    /// `print_tm_with` is `print_tm` plus a header block, in that exact position: after `start`, before
    /// the blank line that precedes the states.
    #[test]
    fn print_tm_with_inserts_the_header_after_start() {
        let expected = "\
tapes 1
start scan
version 1
encoding unary
width 4
slots 1
result Nat
tape 0 #____#  ; reg

state scan:
  [1] -> write [*], move [R], goto scan
  [*] -> write [1], move [S], goto halt
state halt: accept
";
        assert_eq!(print_tm_with(&increment(), &a_header()), expected);
    }

    /// GLOBAL CONSTRAINT: `print_tm`'s output is byte-identical to before this slice. The check is that
    /// removing the header from `print_tm_with`'s output recovers it exactly — if the two printers had
    /// been allowed to drift, this is what catches it.
    #[test]
    fn print_tm_output_is_unchanged_by_the_header_split() {
        let m = increment();
        let plain = print_tm(&m);
        let headered = print_tm_with(&m, &a_header());
        // The margin here is ONE CHARACTER. The only machine-authored line that comes close to a stripped
        // prefix is `tapes {n}`, which survives the `"tape "` prefix strip solely because index 4 is `s`
        // and not a space. State/rule lines are safe by construction (`"state "` and two leading spaces).
        // If either keyword ever loses its trailing space this test starts silently removing real content.
        let stripped: String = headered
            .lines()
            .filter(|l| {
                !["version ", "encoding ", "width ", "slots ", "result ", "tape "].iter().any(|p| l.starts_with(p))
            })
            .map(|l| format!("{l}\n"))
            .collect();
        assert_eq!(stripped, plain);
    }

    /// The classified form of `print_tm`, asserted as the FULL ORDERED sequence of `(text, class)`.
    /// Nothing weaker will do: `scan` occurs three times — once referenced by `start`, once DEFINING a
    /// state, once as a `goto` target — so any "some span has class Label" assertion is satisfied by the
    /// wrong occurrence and never looks at the text at all. The sequence pins which is which.
    #[test]
    fn print_tm_mapped_agrees_and_classifies_states_symbols_and_moves() {
        use crate::analysis::TokenClass;
        use TokenClass::{Keyword as Kw, Label as Lb, Move as Mv, Nat as Nt, Punct as Pu};
        use TokenClass::{StateName as Sn, TapeSymbol as Ts};
        let m = increment();
        let (text, spans) = print_tm_mapped(&m);
        assert_eq!(text, print_tm(&m), "the wrapper must return the mapped form's text verbatim");
        for w in spans.windows(2) {
            assert!(w[0].0.end <= w[1].0.start, "spans overlap or are unordered: {:?} then {:?}", w[0], w[1]);
        }
        for (s, _) in &spans {
            assert!(s.end <= text.len() && s.start < s.end, "bad span {s:?}");
            assert!(text.is_char_boundary(s.start) && text.is_char_boundary(s.end), "{s:?} splits a char");
        }
        let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&text[s.start..s.end], *c)).collect();
        assert_eq!(
            named,
            vec![
                ("tapes", Kw),
                ("1", Nt),
                ("start", Kw),
                ("scan", Sn),
                ("state", Kw),
                ("scan", Lb),
                (":", Pu),
                ("[", Pu),
                ("1", Ts),
                ("]", Pu),
                ("->", Pu),
                ("write", Kw),
                ("[", Pu),
                ("*", Ts),
                ("]", Pu),
                (",", Pu),
                ("move", Kw),
                ("[", Pu),
                ("R", Mv),
                ("]", Pu),
                (",", Pu),
                ("goto", Kw),
                ("scan", Sn),
                ("[", Pu),
                ("*", Ts),
                ("]", Pu),
                ("->", Pu),
                ("write", Kw),
                ("[", Pu),
                ("1", Ts),
                ("]", Pu),
                (",", Pu),
                ("move", Kw),
                ("[", Pu),
                ("S", Mv),
                ("]", Pu),
                (",", Pu),
                ("goto", Kw),
                ("halt", Sn),
                ("state", Kw),
                ("halt", Lb),
                (":", Pu),
                ("accept", Kw),
            ]
        );
        // Stated again as the property, independent of the layout above: ONE name, three positions,
        // and the class tracks the position rather than the name. A printer that classified every
        // state name identically would still satisfy any per-text assertion, and fails this.
        let scans: Vec<TokenClass> = named.iter().filter(|(t, _)| *t == "scan").map(|(_, c)| *c).collect();
        assert_eq!(scans, vec![Sn, Lb, Sn], "`start`/`goto` references are StateName, the definition is Label");
    }

    /// The header block classifies too, in position: `print_tm_with_mapped` is `print_tm_with`'s text plus
    /// spans, so the directives between `start` and the states carry classes like everything else.
    #[test]
    fn print_tm_with_mapped_still_agrees() {
        use crate::analysis::TokenClass;
        use TokenClass::{Comment as Cm, Ident as Id, Keyword as Kw, Nat as Nt, TapeSymbol as Ts};
        let m = increment();
        let h = a_header();
        let (text, spans) = print_tm_with_mapped(&m, &h);
        assert_eq!(text, print_tm_with(&m, &h));
        for w in spans.windows(2) {
            assert!(w[0].0.end <= w[1].0.start, "spans overlap or are unordered: {:?} then {:?}", w[0], w[1]);
        }
        let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&text[s.start..s.end], *c)).collect();
        // The header occupies exactly the four spans after `tapes N` / `start scan` and before the states.
        assert_eq!(
            &named[4..18],
            &[
                ("version", Kw),
                ("1", Nt),
                ("encoding", Kw),
                ("unary", Id),
                ("width", Kw),
                ("4", Nt),
                ("slots", Kw),
                ("1", Nt),
                ("result", Kw),
                ("Nat", Id),
                ("tape", Kw),
                ("0", Nt),
                ("#____#", Ts),
                ("; reg", Cm),
            ]
        );
        assert_eq!(&named[..4], &[("tapes", Kw), ("1", Nt), ("start", Kw), ("scan", TokenClass::StateName)]);
        assert_eq!(named[18], ("state", Kw), "the states resume immediately after the header");
    }

    use crate::Severity;

    fn parse_ok(src: &str) -> Machine {
        let (m, ds) = parse_tm(src);
        assert!(ds.iter().all(|d| d.severity != Severity::Error), "unexpected errors: {ds:?}");
        m.expect("expected a machine")
    }

    #[test]
    fn parse_then_print_round_trips() {
        let m = increment();
        // `increment()` has the shape the round-trip contract is stated for: unique state names and
        // an accept state (`halt`) carrying no rules. Confirm it clears `validate()` before relying
        // on the round-trip, since `validate()` is what gates the guarantee.
        assert!(m.validate().is_empty(), "increment() must be validate()-clean: {:?}", m.validate());
        let printed = print_tm(&m);
        assert_eq!(parse_ok(&printed), m, "parse(print(m)) must equal m");
        // print is idempotent on a re-parse.
        assert_eq!(print_tm(&parse_ok(&printed)), printed);
    }

    #[test]
    fn parse_handles_comments_and_blank_lines() {
        let src = "\
; a unary incrementer
tapes 1
start scan

state scan:
  [1] -> write [*], move [R], goto scan   ; keep scanning
  [*] -> write [1], move [S], goto halt
state halt: accept
";
        assert_eq!(parse_ok(src), increment());
    }

    #[test]
    fn unknown_goto_target_is_a_spanned_error() {
        let src = "tapes 1\nstart s\nstate s:\n  [*] -> write [*], move [S], goto nowhere\n";
        let (m, ds) = parse_tm(src);
        assert!(m.is_none());
        assert!(ds.iter().any(|d| d.message.contains("nowhere")));
        let d = &ds[0];
        assert!(d.span.start <= d.span.end && d.span.end <= src.len());
    }

    #[test]
    fn rule_after_accept_state_is_a_spanned_error() {
        let src = "tapes 1\nstart s\nstate s: accept\n  [1] -> write [*], move [S], goto s\n";
        let (m, ds) = parse_tm(src);
        assert!(m.is_none());
        assert!(ds.iter().any(|d| d.message.contains("accept") && d.message.contains("rules")), "{ds:?}");
        let d = &ds[0];
        assert!(d.span.start <= d.span.end && d.span.end <= src.len());
    }

    #[test]
    fn duplicate_state_name_is_an_error() {
        let src = "tapes 1\nstart s\nstate s: accept\nstate s: accept\n";
        let (m, ds) = parse_tm(src);
        assert!(m.is_none());
        assert!(ds.iter().any(|d| d.message.contains("duplicate")));
    }

    #[test]
    fn arity_mismatch_is_an_error() {
        // 2 tapes declared, but a rule lists only one symbol per bracket.
        let src = "tapes 2\nstart s\nstate s:\n  [1] -> write [*], move [S], goto s\n";
        let (m, ds) = parse_tm(src);
        assert!(m.is_none());
        assert!(ds.iter().any(|d| d.message.contains("arity") || d.message.contains("tapes")));
    }

    #[test]
    fn garbage_never_panics() {
        for src in ["", "tapes\n", "state\n", "[bad", "goto", "tapes 0\n", "start x\n"] {
            let _ = parse_tm(src); // must return, never panic
        }
    }

    #[test]
    fn identifier_name_with_dot_round_trips() {
        // The real `lower_tm` shape: an identifier state name containing `.`. It is representable
        // (passes `validate`) and must round-trip exactly, with no diagnostics.
        let m = Machine {
            tapes: 1,
            start: 0,
            states: vec![
                State {
                    name: "sum.rec".into(),
                    accept: false,
                    rules: vec![Rule { read: vec![Some('1')], write: vec![None], moves: vec![Move::R], next: 1 }],
                },
                State { name: "halt".into(), accept: true, rules: vec![] },
            ],
        };
        assert!(m.validate().is_empty(), "machine should be representable: {:?}", m.validate());
        let (parsed, ds) = parse_tm(&print_tm(&m));
        assert!(ds.is_empty(), "unexpected diagnostics: {ds:?}");
        assert_eq!(parsed, Some(m));
    }

    #[test]
    fn compiled_machines_round_trip_through_the_text_form() {
        // parse_tm(print_tm(m)) == (Some(m), []) for machines produced by the real compiler, not just
        // hand-built ones. lower_tm guarantees validate()-clean machines (state names use only `.` and
        // alphanumerics — no reserved `; * : [ ]`/whitespace), which is exactly what gates the round-trip.
        for src in ["1 + 2 * 3", "if 1 == 2 { 10 } else { 20 }", "head(cons(7, nil))", "cons(1, cons(2, nil))"] {
            let (prog, ds) = parse(src);
            assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
            let core = desugar(&prog.unwrap());
            let m = lower_tm(&lower_asm(&core).expect("lowers"), &Unary::default());
            assert!(m.validate().is_empty(), "compiled machine must be validate()-clean for {src}: {:?}", m.validate());
            assert_eq!(parse_tm(&print_tm(&m)), (Some(m.clone()), vec![]), "round-trip must equal m for {src}");
        }
    }

    /// A header directive AFTER the first `state` is refused, as the grammar has always said.
    ///
    /// The parser used to accept them anywhere, so this file parsed clean. Nothing this project emits
    /// is affected — `print_header` writes the block between `start` and the states unconditionally —
    /// which is exactly why enforcing was cheap NOW and would not have been later: every file written
    /// against the looser parser is one a stricter parser breaks.
    #[test]
    fn a_header_directive_after_the_first_state_is_refused() {
        for bad in ["encoding unary", "width 4", "slots 1", "result Nat", "tape 0 #_#", "version 1"] {
            let src = format!("tapes 1\nstart s\n\nstate s: accept\n{bad}\n");
            let (m, h, ds) = parse_tm_full(&src);
            assert!(m.is_none() && h.is_none(), "{bad:?} after a state must be refused");
            assert!(ds.iter().any(|d| d.message.contains("must precede the first `state`")), "{bad:?}: {ds:?}");
        }
    }

    /// ...and the same directives BEFORE the first state still parse, so the guard is positional
    /// rather than a blanket rejection.
    #[test]
    fn the_same_directives_before_the_first_state_still_parse() {
        let src = "tapes 1\nstart s\nversion 1\nencoding unary\nwidth 4\nslots 1\nresult Nat\ntape 0 #_#\n\nstate s: accept\n";
        let (m, h, ds) = parse_tm_full(src);
        assert!(ds.is_empty(), "{ds:?}");
        assert!(m.is_some() && h.is_some());
    }

    /// PROPERTY 1: today's round-trip, untouched.
    #[test]
    fn property_1_plain_round_trip_is_untouched() {
        let m = increment();
        assert_eq!(parse_tm(&print_tm(&m)), (Some(m), vec![]));
    }

    /// PROPERTY 2: the new round-trip. A header printed is a header parsed back, equal.
    #[test]
    fn property_2_headered_round_trip_returns_both_halves() {
        let (m, h) = (increment(), a_header());
        let (pm, ph, ds) = parse_tm_full(&print_tm_with(&m, &h));
        assert!(ds.is_empty(), "diagnostics: {ds:?}");
        assert_eq!(pm, Some(m));
        assert_eq!(ph, Some(h));
    }

    /// PROPERTY 3: a headered file still reads as a plain machine. `parse_tm` must SKIP the directives,
    /// not reject them — without this it hits its unknown-line error path on any file carrying a header.
    #[test]
    fn property_3_a_headered_file_still_parses_as_a_plain_machine() {
        let m = increment();
        assert_eq!(parse_tm(&print_tm_with(&m, &a_header())), (Some(m), vec![]));
    }

    /// PROPERTY 4: a header-less file yields NO HEADER, NOT AN ERROR.
    ///
    /// This is the property most likely to regress silently, because a parser taught to recognize
    /// directives is a parser that can start requiring them. Every file written before this slice looks
    /// like this one.
    #[test]
    fn property_4_a_headerless_file_yields_none_not_a_diagnostic() {
        let m = increment();
        let (pm, ph, ds) = parse_tm_full(&print_tm(&m));
        assert_eq!(pm, Some(m));
        assert_eq!(ph, None);
        assert!(ds.is_empty(), "a missing header is not an error, got: {ds:?}");
    }

    /// `tapes N` and `tape I …` are told apart by the MANDATORY SPACE in each keyword, not by dispatch
    /// order: `"tape 0 …".strip_prefix("tapes ")` fails at position 4 (`s` vs ` `) and the reverse fails
    /// too. This test is what fails if either prefix ever loses its space.
    #[test]
    fn tapes_and_tape_are_distinguished_by_the_mandatory_space() {
        let src = "\
tapes 1
start s
encoding unary
width 4
slots 1
result Nat
tape 0 #____#

state s: accept
";
        let (m, h, ds) = parse_tm_full(src);
        assert!(ds.is_empty(), "diagnostics: {ds:?}");
        assert_eq!(m.expect("a machine").tapes, 1, "`tapes 1` must set the tape COUNT");
        assert_eq!(h.expect("a header").tapes(), &[(0, vec!['#', '_', '_', '_', '_', '#'])]);
    }

    /// A PARTIAL header is a diagnostic naming what is missing — not a `None`. Silently discarding a
    /// half-written header would turn a typo into "this file has no header".
    #[test]
    fn a_partial_header_names_the_missing_directives() {
        let src = "tapes 1\nstart s\nencoding unary\nwidth 4\n\nstate s: accept\n";
        let (m, h, ds) = parse_tm_full(src);
        assert!(m.is_none(), "an error gate must suppress the machine too");
        assert!(h.is_none());
        let joined = ds.iter().map(|d| d.message.clone()).collect::<Vec<_>>().join(" | ");
        assert!(joined.contains("slots") && joined.contains("result"), "must name both: {joined}");
        assert!(!joined.contains("encoding") && !joined.contains("width"), "must not name present ones: {joined}");
    }

    /// `tape` lines with none of the four header directives would otherwise be SILENTLY DROPPED — the
    /// same data loss the partial-header rule exists to prevent.
    #[test]
    fn tape_lines_without_a_header_are_a_diagnostic_not_silent_data_loss() {
        let src = "tapes 1\nstart s\ntape 0 #____#\n\nstate s: accept\n";
        let (_, h, ds) = parse_tm_full(src);
        assert!(h.is_none());
        assert!(ds.iter().any(|d| d.message.contains("tape")), "{ds:?}");
    }

    #[test]
    fn malformed_header_directives_are_spanned_diagnostics_never_panics() {
        // Each case is a COMPLETE header with exactly one thing wrong. Building them by APPENDING a bad
        // line to a valid header would test something else entirely: every bad line would be a second
        // directive of its own key, so all of them would hit the duplicate arm and none would reach the
        // validation under test.
        let cases: &[(&str, &str)] = &[
            ("encoding ternary\nwidth 4\nslots 1\nresult Nat", "ternary"),
            ("encoding unary\nwidth 0\nslots 1\nresult Nat", "width"),
            ("encoding unary\nwidth -1\nslots 1\nresult Nat", "width"),
            ("encoding unary\nwidth nine\nslots 1\nresult Nat", "width"),
            ("encoding unary\nwidth 4\nslots nine\nresult Nat", "slots"),
            // D5: a well-formed type that is not a first-class tape value.
            ("encoding unary\nwidth 4\nslots 1\nresult (Nat) -> Bool", "result"),
            ("encoding unary\nwidth 4\nslots 1\nresult Wobble", "result"),
            // Index >= the file's `tapes 1`. Checked after the loop, since directives are order-independent.
            ("encoding unary\nwidth 4\nslots 1\nresult Nat\ntape 9 #____#", "out of range"),
            ("encoding unary\nwidth 4\nslots 1\nresult Nat\ntape x #____#", "tape"),
            ("encoding unary\nencoding binary\nwidth 4\nslots 1\nresult Nat", "duplicate"),
            ("encoding unary\nwidth 4\nwidth 8\nslots 1\nresult Nat", "duplicate"),
            ("encoding unary\nwidth 4\nslots 1\nresult Nat\ntape 0 #_#\ntape 0 #_#", "duplicate"),
            // `version` gets the same duplicate rule as the other four. Two AGREEING lines are still
            // an error: the rule is about the file stating a thing once, not about the values matching.
            ("version 1\nversion 1\nencoding unary\nwidth 4\nslots 1\nresult Nat", "duplicate"),
        ];
        for (header, needle) in cases {
            let src = format!("tapes 1\nstart s\n{header}\n\nstate s: accept\n");
            let (m, h, ds) = parse_tm_full(&src);
            assert!(
                ds.iter().any(|d| d.message.contains(needle)),
                "expected a diagnostic mentioning {needle:?} for:\n{header}\ngot {ds:?}"
            );
            assert!(m.is_none() && h.is_none(), "an error gate must suppress both halves for:\n{header}");
            for d in &ds {
                assert!(d.span.start <= d.span.end && d.span.end <= src.len(), "bad span for:\n{header}");
            }
            // The out-of-range `tape` diagnostic is about ONE specific line, whose real span was in
            // scope when `directive` saw it. `start <= end <= len` is trivially true of `{0, 0}` too
            // (which is exactly how this went unnoticed before), so check the span is non-empty and
            // actually covers the offending `tape` line — exactly, not by substring: `covered.contains
            // ("tape")` would also pass for the `tapes 1` line above it, which is the same defect class
            // this test exists to catch. The other cases legitimately have no single offending line and
            // keep the loose check above.
            if *needle == "out of range" {
                let d = ds.iter().find(|d| d.message.contains("out of range")).expect("out of range diagnostic");
                assert!(d.span.start < d.span.end, "expected a non-empty span for:\n{header}\ngot {d:?}");
                let covered = &src[d.span.start..d.span.end];
                assert_eq!(
                    covered.trim(),
                    "tape 9 #____#",
                    "span must cover exactly the offending `tape` line for:\n{header}\ngot span {:?} -> {covered:?}",
                    d.span
                );
            }
        }
    }

    /// The range check lives in `finish`, not in `directive`, precisely because directives are
    /// order-independent — a `tape` line may precede the `tapes N` that makes it out of range. Every
    /// other test writes `tapes` first, so without this one the scenario the design cites as its own
    /// reason is asserted nowhere.
    #[test]
    fn an_out_of_range_tape_is_caught_even_when_it_precedes_the_tapes_line() {
        let src = "tape 9 #____#\ntapes 1\nstart s\nencoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n";
        let (m, h, ds) = parse_tm_full(src);
        assert!(m.is_none() && h.is_none());
        assert!(ds.iter().any(|d| d.message.contains("out of range")), "{ds:?}");
    }

    #[test]
    fn header_directives_are_order_independent() {
        let a = "tapes 1\nstart s\nencoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n";
        let b = "tapes 1\nresult Nat\nslots 1\nstart s\nwidth 4\nencoding unary\n\nstate s: accept\n";
        let (_, ha, _) = parse_tm_full(a);
        let (_, hb, _) = parse_tm_full(b);
        assert_eq!(ha, hb);
        assert!(ha.is_some());
    }

    #[test]
    fn headered_garbage_never_panics() {
        for src in [
            "encoding\n",
            "width\n",
            "slots\n",
            "result\n",
            "tape\n",
            "tape 0\n",
            "encoding unary\n",
            "tapes 1\nstart s\nresult List<\n\nstate s: accept\n",
        ] {
            let _ = parse_tm_full(src); // must return, never panic
        }
    }

    /// A `.tm` file is untrusted. `tapes N` drives `TmHeader::init`'s allocation directly, and a machine
    /// whose only state is `state s: accept` has no rules — so the rule-arity check never constrains it.
    /// Without a cap, `tapes 10000000000` parses clean and the documented next step allocates 10^10 Vecs.
    /// `sim.rs` guards this exact scenario by name; the header path reintroduced it one call earlier.
    #[test]
    fn an_absurd_tape_count_is_refused_rather_than_allocated() {
        let src = "tapes 10000000000\nstart s\n\nstate s: accept\n";
        let (m, ds) = parse_tm(src);
        assert!(m.is_none(), "an absurd tape count must not yield a machine");
        assert!(ds.iter().any(|d| d.message.contains("tapes")), "{ds:?}");
        for d in &ds {
            assert!(d.span.start <= d.span.end && d.span.end <= src.len());
        }
    }

    /// BOTH DIRECTIONS. A cap tested only from above proves the rejection fires, never that it fires at
    /// the right place — the value one below it must still be accepted.
    #[test]
    fn the_tape_cap_admits_the_value_just_below_it() {
        let at_cap = format!("tapes {MAX_TAPES}\nstart s\n\nstate s: accept\n");
        let (m, ds) = parse_tm(&at_cap);
        assert!(m.is_some() && ds.is_empty(), "at the cap must parse: {ds:?}");
        let over = format!("tapes {}\nstart s\n\nstate s: accept\n", MAX_TAPES + 1);
        let (m, ds) = parse_tm(&over);
        assert!(m.is_none(), "one over the cap must not parse");
        // Naming the directive matters: `is_none()` alone would also be satisfied by an unrelated
        // parse error, so it cannot tell "the cap fired" from "something else rejected this file".
        // Its two sibling cap tests both check the message; this one did not.
        assert!(ds.iter().any(|d| d.message.contains("tapes")), "must be refused BY THE CAP: {ds:?}");
    }

    /// `slots` and `width` feed `init_reg`, which allocates `slots * (width + 1)` cells — the recipe
    /// evaluation the header exists for, and what the consistency check itself performs. MAX_SLOTS and
    /// MAX_FIELD_WIDTH already bound this for in-memory programs; the file path bypassed them.
    #[test]
    fn absurd_slots_and_width_are_refused_at_their_existing_ceilings() {
        let hdr = |s: &str, w: &str| {
            format!("tapes 1\nstart s\nencoding unary\nwidth {w}\nslots {s}\nresult Nat\n\nstate s: accept\n")
        };
        // At each ceiling: accepted.
        assert!(parse_tm_full(&hdr("100000", "64")).1.is_some(), "at both ceilings must parse");
        // One over: refused, each naming its own directive.
        let (_, h, ds) = parse_tm_full(&hdr("100001", "64"));
        assert!(h.is_none() && ds.iter().any(|d| d.message.contains("slots")), "{ds:?}");
        let (_, h, ds) = parse_tm_full(&hdr("100000", "65"));
        assert!(h.is_none() && ds.iter().any(|d| d.message.contains("width")), "{ds:?}");
    }

    /// Absent means version 1, so every file written before this directive existed stays valid.
    #[test]
    fn an_absent_version_means_one() {
        let src = "tapes 1\nstart s\nencoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n";
        let (m, h, ds) = parse_tm_full(src);
        assert!(m.is_some() && h.is_some(), "{ds:?}");
        assert!(ds.is_empty(), "an absent version is not a diagnostic: {ds:?}");
    }

    /// An unknown version is a hard ERROR, not a warning. A future version could change what `width` or
    /// `slots` MEAN, so decoding a v2 file under v1 rules would produce a confidently wrong value — the
    /// exact failure the header exists to prevent.
    #[test]
    fn an_unknown_version_is_an_error_not_a_warning() {
        for bad in ["version 2", "version 0", "version foo", "version"] {
            let src =
                format!("tapes 1\nstart s\n{bad}\nencoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n");
            let (m, h, ds) = parse_tm_full(&src);
            assert!(m.is_none() && h.is_none(), "{bad:?} must be refused");
            assert!(ds.iter().any(|d| d.message.contains("version")), "{bad:?}: {ds:?}");
        }
    }

    /// `version` is NOT a member of the four-directive header set, so the four optionality properties are
    /// untouched — but a lone `version` must not be silently dropped, on the same reasoning as a stray
    /// `tape` line: discarding it turns a typo into "this file has no header".
    #[test]
    fn a_lone_version_without_a_header_is_a_diagnostic() {
        let src = "tapes 1\nstart s\nversion 1\n\nstate s: accept\n";
        let (_, h, ds) = parse_tm_full(src);
        assert!(h.is_none());
        assert!(ds.iter().any(|d| d.message.contains("version")), "{ds:?}");
    }

    /// The printer always emits it, and it leads the block.
    #[test]
    fn print_tm_with_emits_version_first() {
        let out = print_tm_with(&increment(), &a_header());
        let block: Vec<&str> = out.lines().skip(2).take(1).collect();
        assert_eq!(block, vec!["version 1"], "got:\n{out}");
    }
}
