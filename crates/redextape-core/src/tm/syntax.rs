//! The TM text form: a flat, line-oriented, human-readable language for a `Machine`. `print_tm`
//! renders it; `parse_tm` reads it back (Task 4); they round-trip (design §9). Reserved markers:
//! `_` is the blank symbol, `*` is the read-wildcard / write-unchanged marker, and `;` starts a
//! comment (whole-line or trailing). The round-trip guarantee
//! `parse_tm(print_tm(m)) == (Some(m), [])` holds for every `Machine` that passes
//! `Machine::validate()` — i.e. identifier-ish state names (no whitespace or reserved `; * : [ ]`)
//! and data symbols outside the reserved set. `lower_tm` produces only such machines; a machine
//! outside this representable subset is *rejected* by `validate` rather than silently corrupted.

use crate::diagnostic::Severity;
use crate::tm::machine::{BLANK, Machine, Move, Rule, State, StateId, Symbol};
use crate::{Diagnostic, Span};
use std::fmt::Write as _;

fn sym_str(s: &Option<Symbol>) -> String {
    match s {
        None => "*".to_string(),
        Some(c) => c.to_string(),
    }
}

fn syms_str(v: &[Option<Symbol>]) -> String {
    v.iter().map(sym_str).collect::<Vec<_>>().join(" ")
}

fn move_str(m: Move) -> char {
    match m {
        Move::L => 'L',
        Move::R => 'R',
        Move::S => 'S',
    }
}

fn moves_str(v: &[Move]) -> String {
    v.iter().map(|m| move_str(*m).to_string()).collect::<Vec<_>>().join(" ")
}

/// The name of a state by id, or a fallback so `print_tm` never panics on a malformed `Machine`.
fn state_name(m: &Machine, id: u32) -> String {
    m.states.get(id as usize).map_or_else(|| format!("<state {id}>"), |s| s.name.clone())
}

/// Render `m` as the readable TM text form.
pub fn print_tm(m: &Machine) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "tapes {}", m.tapes);
    let _ = writeln!(out, "start {}", state_name(m, m.start));
    let _ = writeln!(out);
    for s in &m.states {
        if s.accept {
            let _ = writeln!(out, "state {}: accept", s.name);
        } else {
            let _ = writeln!(out, "state {}:", s.name);
            for r in &s.rules {
                let _ = writeln!(
                    out,
                    "  [{}] -> write [{}], move [{}], goto {}",
                    syms_str(&r.read),
                    syms_str(&r.write),
                    moves_str(&r.moves),
                    state_name(m, r.next),
                );
            }
        }
    }
    out
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
    let (move_s, rest) = bracket(rest, span)?;
    let rest = rest.trim_start().strip_prefix(',').ok_or_else(|| err(span, "expected `,`"))?;
    let goto = rest.trim_start().strip_prefix("goto").ok_or_else(|| err(span, "expected `goto`"))?.trim();
    if goto.is_empty() {
        return Err(err(span, "expected a goto target"));
    }
    let read = read_s.split_whitespace().map(parse_sym).collect();
    let write = write_s.split_whitespace().map(parse_sym).collect();
    let moves = move_s
        .split_whitespace()
        .map(parse_move)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| err(span, "bad move (expected L/R/S)"))?;
    Ok(RawRule { read, write, moves, goto: goto.to_string(), span })
}

/// Parse the TM text form. Iterative (flat grammar, no recursion). Never panics.
pub fn parse_tm(src: &str) -> (Option<Machine>, Vec<Diagnostic>) {
    let mut diags: Vec<Diagnostic> = Vec::new();
    let mut tapes: Option<usize> = None;
    let mut start_name: Option<(String, Span)> = None;
    let mut states: Vec<RawState> = Vec::new();

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
                Ok(n) if n >= 1 => tapes = Some(n),
                _ => diags.push(err(span, "expected `tapes <positive integer>`")),
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
        return (None, diags);
    };

    // Resolve names -> ids (definition order). Owned keys, so it does not borrow `states` and the
    // final builder can consume `states` freely. (Duplicate names were diagnosed above; if any exist
    // the error gate below returns `None` before this map is used to build.)
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
    let start = match &start_name {
        Some((name, span)) => match ids.get(name).copied() {
            Some(id) => id,
            None => {
                diags.push(err(*span, format!("unknown start state `{name}`")));
                0
            }
        },
        None => {
            diags.push(err(Span { start: 0, end: 0 }, "missing `start <name>`"));
            0
        }
    };

    if diags.iter().any(|d| d.severity == Severity::Error) {
        return (None, diags);
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
    (Some(machine), diags)
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
}
