//! What a `.tm` file records ABOUT its machine, as opposed to the machine itself.
//!
//! A Turing machine is a transition function plus an initial configuration. The text form serialized
//! only the first half: `print_tm` emits δ and q₀ and nothing about how the machine STARTS, so a
//! printed machine round-tripped faithfully as a machine and still could not be run or read back from
//! the file alone. `TmHeader` is the second half — the literal initial tapes, so any TM simulator can
//! run the file with no knowledge of this project's encodings, plus the `encoding`/`width`/`slots`/
//! `result` recipe needed to interpret the answer.
//!
//! **The header is OPTIONAL and adds no capability to the machine — it removes an INPUT requirement.**
//! `simulate(&m, &init, caps)` needs the caller to supply `init`; with a header, `init` can come from
//! the file instead. Nothing about δ, the start state, or execution changes, which is why a
//! header-less file stays exactly as runnable as it was.
//!
//! **Returned alongside a `Machine`, never stored on one.** `lower_tm.rs` states the rule twice:
//! `Machine` derives `PartialEq` and the round-trip asserts `parse_tm(print_tm(m)) == m`, which a
//! side-table field would break for a reason unrelated to what the machine computes.
//!
//! The one thing a header CANNOT do, stated here rather than discovered later: a foreign tool can RUN
//! a `.tm` file but cannot INTERPRET its result. Running is universal; interpreting needs the
//! encoding's semantics, and a name cannot convey them.

use crate::Span;
use crate::tm::build::{BOX, HEAP, REG, STACK, WORK};
use crate::tm::encoding::{Binary, Encoding, Unary};
use crate::tm::machine::Symbol;
use crate::ty::Ty;
use crate::ty::parse_ty;

/// Which `Encoding` a file names.
///
/// **This enum and `parse` below are the one new registration point this slice introduces:** adding a
/// third encoding means adding a variant here and a name there. That is inherent to any format that
/// names its variants — it is a small, obvious edit, but it is a place a future encoding must be
/// registered, and nothing else will remind you.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EncodingKind {
    Unary,
    Binary,
}

impl EncodingKind {
    /// This kind instantiated at `width` cells. Both kinds are BOUNDED (`field_width()` is always
    /// `Some`), which is why the producer in `tm.rs` needs no unbounded early-return branch the way
    /// `run_tm_fitted` does — an unbounded encoding has no name in this enum to write in a file.
    pub fn at(self, width: usize) -> Box<dyn Encoding> {
        match self {
            EncodingKind::Unary => Box::new(Unary::at(width)),
            EncodingKind::Binary => Box::new(Binary::at(width)),
        }
    }

    /// The name written in an `encoding` directive. Lowercase, matching the rest of the text form's
    /// keywords (`tapes`, `start`, `state`, `accept`).
    pub fn name(self) -> &'static str {
        match self {
            EncodingKind::Unary => "unary",
            EncodingKind::Binary => "binary",
        }
    }

    /// The inverse of `name`. `None` for an unrecognized name, which the parser reports as a
    /// diagnostic rather than defaulting — a file naming an encoding this build does not have is
    /// unreadable, and guessing would decode its tape as something else entirely.
    pub fn parse(s: &str) -> Option<EncodingKind> {
        match s {
            "unary" => Some(EncodingKind::Unary),
            "binary" => Some(EncodingKind::Binary),
            _ => None,
        }
    }
}

/// This compiler's name for tape `i`, used only for the trailing comment on a `tape` line.
///
/// Tapes are addressed by INDEX in the format (spec D3): names are this compiler's convention, not a
/// property of a Turing machine, and a generic simulator knows only indices. `None` for an index
/// outside this layout, which a file with a larger `tapes N` may legitimately have.
pub(crate) fn tape_name(i: usize) -> Option<&'static str> {
    match i {
        REG => Some("reg"),
        WORK => Some("work"),
        STACK => Some("stack"),
        HEAP => Some("heap"),
        BOX => Some("box"),
        _ => None,
    }
}

/// The header of a `.tm` file. See the module doc for why this is not a field on `Machine`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TmHeader {
    /// Which encoding reads this machine's tapes.
    pub encoding: EncodingKind,
    /// Field width in CELLS. What a field of that many cells can HOLD is the encoding's business
    /// (`v < width` for unary, `v < 2^width` for binary).
    pub width: usize,
    /// REG bank field count.
    pub slots: u32,
    /// The type the final tape decodes to. Only `Nat`/`Bool`/`Unit`/`List<T>` are admissible.
    pub result: Ty,
    /// Literal initial contents by tape INDEX, ascending, with EMPTY TAPES OMITTED. Private because
    /// `new` maintains that normal form and the round-trip depends on it — see `new`.
    tapes: Vec<(usize, Vec<Symbol>)>,
}

impl TmHeader {
    /// Build a header, normalizing `tapes` into the form the text output can represent exactly:
    /// empty tapes dropped, indices ascending, duplicates collapsed to the first.
    ///
    /// The normalization is not cosmetic. An omitted `tape` line MEANS "this tape starts empty"
    /// (which is how HEAP, STACK and BOX always start), so an explicitly-stored empty entry prints
    /// nothing and parses back to no entry — and `parse_tm_full(print_tm_with(m, h))` would return a
    /// header unequal to `h`, breaking optionality property 2 over a difference that carries no
    /// information. Normalizing at construction makes the round-trip exact instead of approximate.
    pub fn new(
        encoding: EncodingKind,
        width: usize,
        slots: u32,
        result: Ty,
        tapes: Vec<(usize, Vec<Symbol>)>,
    ) -> TmHeader {
        let mut tapes: Vec<(usize, Vec<Symbol>)> = tapes.into_iter().filter(|(_, c)| !c.is_empty()).collect();
        tapes.sort_by_key(|(i, _)| *i);
        tapes.dedup_by_key(|(i, _)| *i); // duplicates are sorted adjacent, so this keeps the first
        TmHeader { encoding, width, slots, result, tapes }
    }

    /// The literal initial tapes, by index, ascending, empties omitted.
    pub fn tapes(&self) -> &[(usize, Vec<Symbol>)] {
        &self.tapes
    }

    /// The `Encoding` instance this header names, at its width. This is the half a foreign reader
    /// cannot reproduce — it needs the implementations, which the header names but cannot inline.
    pub fn encoding(&self) -> Box<dyn Encoding> {
        self.encoding.at(self.width)
    }

    /// The initial tape vector to hand `simulate`, from the literal `tape` lines. `n_tapes` comes
    /// from the file's `tapes N`. Total: entries outside `0..n_tapes` are dropped rather than
    /// panicked on, so a header and a tape count that disagree still yield a runnable configuration.
    pub fn init(&self, n_tapes: usize) -> Vec<Vec<Symbol>> {
        let mut init = vec![Vec::new(); n_tapes];
        for (i, cells) in &self.tapes {
            if let Some(slot) = init.get_mut(*i) {
                *slot = cells.clone();
            }
        }
        init
    }
}

use crate::ty::show;
use std::fmt::Write as _;

/// Render `h`'s directives, one per line, ending in a newline. Emitted between `start` and the states
/// by `syntax::print_tm_with`.
///
/// The order — `encoding`, `width`, `slots`, `result`, then `tape` lines ascending — is FIXED, even
/// though the parser accepts any order. A printer has to choose one, and a fixed choice is what makes
/// re-printing a re-parse idempotent.
///
/// KNOWN LIMIT: a tape cell equal to `;` would open a comment and not round-trip. No `Encoding` in
/// this tree writes one — the tape alphabet is `_ # 1 0 @` — and `Machine::validate()` already
/// reserves `;`. A hand-built machine using `;` as a data symbol is outside the representable subset
/// the text form is specified for, the same as one whose state name contains a space.
pub(crate) fn print_header(h: &TmHeader) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "encoding {}", h.encoding.name());
    let _ = writeln!(out, "width {}", h.width);
    let _ = writeln!(out, "slots {}", h.slots);
    let _ = writeln!(out, "result {}", show(&h.result));
    for (i, cells) in &h.tapes {
        let packed: String = cells.iter().collect();
        match tape_name(*i) {
            Some(name) => {
                let _ = writeln!(out, "tape {i} {packed}  ; {name}");
            }
            None => {
                let _ = writeln!(out, "tape {i} {packed}");
            }
        }
    }
    out
}

/// Unpack a `tape` line's cell run: strip a trailing `;` comment, trim, and take one `Symbol` per
/// char. The inverse of `print_header`'s packing (D4).
pub(crate) fn parse_cells(s: &str) -> Vec<Symbol> {
    s.split(';').next().unwrap_or("").trim().chars().collect()
}

/// The header directives seen so far, accumulated across the parse loop so they can arrive in any
/// order. `finish` decides whether they amount to a header, a diagnostic, or nothing at all.
#[derive(Default)]
pub(crate) struct HeaderParts {
    encoding: Option<EncodingKind>,
    width: Option<usize>,
    slots: Option<u32>,
    result: Option<Ty>,
    /// Each entry carries the `Span` of the `tape` line it came from, so a diagnostic about ONE
    /// specific entry (the out-of-range check in `finish`) can point at the line that caused it
    /// instead of the whole file. The span is parse-time-only: `finish` strips it before handing the
    /// tapes to `TmHeader::new`, which never carries one (see that type's doc).
    tapes: Vec<(usize, Vec<Symbol>, Span)>,
    /// Whether any `tape` line was seen. Tracked separately from `tapes` because a `tape` line that
    /// FAILED to parse still means the file was trying to carry a header, and `finish` must not then
    /// report "no header".
    saw_tape: bool,
}

impl HeaderParts {
    /// Offer one non-comment line's `key` and remainder, plus that line's `span` (needed only for a
    /// `tape` line — see the field doc on `tapes`). Returns `None` if `key` is not a header directive
    /// (the caller keeps looking), `Some(Ok(()))` if it was consumed, `Some(Err(msg))` if it was a
    /// header directive that did not parse.
    ///
    /// A DUPLICATE directive is an error rather than last-wins: two disagreeing `width` lines have no
    /// defensible winner, and picking one silently would decode the tape against a recipe the file
    /// does not unambiguously state.
    pub(crate) fn directive(&mut self, key: &str, rest: &str, span: Span) -> Option<Result<(), String>> {
        let val = rest.split(';').next().unwrap_or("").trim();
        match key {
            "encoding" => Some(match (self.encoding, EncodingKind::parse(val)) {
                (Some(_), _) => Err("duplicate `encoding` directive".into()),
                (None, Some(k)) => {
                    self.encoding = Some(k);
                    Ok(())
                }
                (None, None) => Err(format!("unknown `encoding` name `{val}` (expected `unary` or `binary`)")),
            }),
            "width" => Some(match (self.width, val.parse::<usize>()) {
                (Some(_), _) => Err("duplicate `width` directive".into()),
                (None, Ok(n)) if n >= 1 => {
                    self.width = Some(n);
                    Ok(())
                }
                (None, _) => Err(format!("expected `width <positive integer>`, found `{val}`")),
            }),
            "slots" => Some(match (self.slots, val.parse::<u32>()) {
                (Some(_), _) => Err("duplicate `slots` directive".into()),
                (None, Ok(n)) => {
                    self.slots = Some(n);
                    Ok(())
                }
                (None, Err(_)) => Err(format!("expected `slots <integer>`, found `{val}`")),
            }),
            "result" => Some(match (&self.result, parse_ty(val)) {
                (Some(_), _) => Err("duplicate `result` directive".into()),
                (None, Some(t)) => {
                    self.result = Some(t);
                    Ok(())
                }
                // D5: `Fun`/`Var` are well-formed types that are not first-class tape values, so a
                // file naming one is rejected where it is WRITTEN rather than decoding to a silent
                // `None` where it is read.
                (None, None) => {
                    Err(format!("`result` must be a value type (Nat | Bool | Unit | List<T>), found `{val}`"))
                }
            }),
            "tape" => {
                self.saw_tape = true;
                let Some((idx, cells)) = val.split_once(' ') else {
                    return Some(Err(format!("expected `tape <index> <cells>`, found `tape {val}`")));
                };
                Some(match idx.trim().parse::<usize>() {
                    Err(_) => Err(format!("expected `tape <index> <cells>`, found index `{idx}`")),
                    Ok(i) if self.tapes.iter().any(|(j, _, _)| *j == i) => {
                        Err(format!("duplicate `tape {i}` directive"))
                    }
                    Ok(i) => {
                        self.tapes.push((i, parse_cells(cells), span));
                        Ok(())
                    }
                })
            }
            _ => None,
        }
    }

    /// Decide what the accumulated directives amount to, given the file's declared `n_tapes`.
    ///
    /// Each diagnostic carries an `Option<Span>`: `Some` when it is about one specific line (the
    /// out-of-range check below, which has a real offending `tape` line in scope), `None` when it
    /// isn't (there is no single line to blame for a directive that never appeared at all). The
    /// caller stamps `None` to a `Span { start: 0, end: 0 }` placeholder.
    ///
    /// - **Zero of the four present** (and no `tape` line) -> `(None, [])`: the file has no header,
    ///   which is not an error. This is optionality property 4, and it is what every file written
    ///   before this slice looks like.
    /// - **All four present** -> a validated header.
    /// - **One to three present** -> `(None, [(msg, None)])` naming the missing ones. Not a silent
    ///   `None`, because discarding a half-written header would turn a typo into "this file has no
    ///   header". Spanless: there is no single offending line for an ABSENT directive.
    /// - **`tape` lines but none of the four** -> an error for the same reason: the tape data would
    ///   otherwise vanish without a word. Also spanless, for the same reason.
    pub(crate) fn finish(self, n_tapes: usize) -> (Option<TmHeader>, Vec<(String, Option<Span>)>) {
        let missing: Vec<&str> = [
            ("encoding", self.encoding.is_none()),
            ("width", self.width.is_none()),
            ("slots", self.slots.is_none()),
            ("result", self.result.is_none()),
        ]
        .into_iter()
        .filter_map(|(name, absent)| absent.then_some(name))
        .collect();

        if missing.len() == 4 {
            return if self.saw_tape {
                (
                    None,
                    vec![(
                        "`tape` directives without a header (needs `encoding`, `width`, `slots`, `result`)".into(),
                        None,
                    )],
                )
            } else {
                (None, Vec::new()) // no header, no diagnostic
            };
        }
        if !missing.is_empty() {
            return (None, vec![(format!("incomplete header: missing {}", missing.join(", ")), None)]);
        }

        // The range check lives HERE, not in `directive`, because directives are order-independent:
        // a `tape 7` line may precede the `tapes 5` that makes it out of range. Unlike the diagnostics
        // above, THIS one is about one specific line, whose span was in scope when `directive` saw
        // it — carry it, rather than throwing it away.
        let mut errs = Vec::new();
        for (i, _, span) in &self.tapes {
            if *i >= n_tapes {
                errs.push((format!("`tape {i}` is out of range for `tapes {n_tapes}`"), Some(*span)));
            }
        }
        if !errs.is_empty() {
            return (None, errs);
        }
        let (encoding, width) = (self.encoding.unwrap(), self.width.unwrap());
        let (slots, result) = (self.slots.unwrap(), self.result.unwrap());
        let tapes: Vec<(usize, Vec<Symbol>)> = self.tapes.into_iter().map(|(i, cells, _)| (i, cells)).collect();
        (Some(TmHeader::new(encoding, width, slots, result, tapes)), Vec::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::build::{MAX_FIELD_WIDTH, TAPES};

    fn a_header() -> TmHeader {
        TmHeader::new(
            EncodingKind::Binary,
            16,
            3,
            Ty::List(Box::new(Ty::Nat)),
            vec![(REG, vec!['#', '0', '#']), (WORK, vec!['#', '0', '#'])],
        )
    }

    #[test]
    fn encoding_kind_names_round_trip() {
        for k in [EncodingKind::Unary, EncodingKind::Binary] {
            assert_eq!(EncodingKind::parse(k.name()), Some(k));
        }
        assert_eq!(EncodingKind::parse("ternary"), None);
        assert_eq!(EncodingKind::parse("Unary"), None); // names are lowercase
    }

    /// The kind names the encoding AND the width instantiates it — both halves must reach the
    /// `Encoding` you get back, or the recipe describes a different machine than it claims.
    #[test]
    fn encoding_kind_instantiates_the_named_encoding_at_the_given_width() {
        assert_eq!(EncodingKind::Unary.at(8).field_width(), Some(8));
        assert_eq!(EncodingKind::Binary.at(16).field_width(), Some(16));
        // The kinds are distinguishable through the trait: a zero bank differs between them.
        assert_ne!(EncodingKind::Unary.at(8).init_reg(1), EncodingKind::Binary.at(8).init_reg(1));
        // Both kinds are BOUNDED, which is why the producer in `tm.rs` needs no unbounded branch.
        assert!(EncodingKind::Unary.at(MAX_FIELD_WIDTH).field_width().is_some());
        assert!(EncodingKind::Binary.at(MAX_FIELD_WIDTH).field_width().is_some());
    }

    /// An omitted `tape` line means "starts empty", so an explicitly-empty entry is not
    /// representable in the text form. Normalizing it away at construction is what makes the
    /// round-trip (property 2) exact rather than approximate.
    #[test]
    fn construction_drops_empty_tapes_and_orders_the_rest() {
        let h = TmHeader::new(
            EncodingKind::Unary,
            8,
            1,
            Ty::Nat,
            vec![(HEAP, vec![]), (WORK, vec!['#']), (REG, vec!['#', '_'])],
        );
        assert_eq!(h.tapes(), &[(REG, vec!['#', '_']), (WORK, vec!['#'])]);
    }

    #[test]
    fn init_places_each_tape_at_its_index_and_leaves_the_rest_empty() {
        let init = a_header().init(TAPES);
        assert_eq!(init.len(), TAPES);
        assert_eq!(init[REG], vec!['#', '0', '#']);
        assert_eq!(init[WORK], vec!['#', '0', '#']);
        assert!(init[STACK].is_empty() && init[HEAP].is_empty() && init[BOX].is_empty());
    }

    /// `init` is asked for a tape count that comes from the FILE's `tapes N`, which need not match
    /// this compiler's `TAPES`. Out-of-range entries are dropped, not panicked on.
    #[test]
    fn init_is_total_for_any_tape_count() {
        assert_eq!(a_header().init(0).len(), 0);
        assert_eq!(a_header().init(1).len(), 1);
        assert_eq!(a_header().init(1)[0], vec!['#', '0', '#']);
        assert_eq!(a_header().init(64).len(), 64);
    }

    #[test]
    fn tape_names_cover_this_compilers_layout_and_nothing_else() {
        assert_eq!(tape_name(REG), Some("reg"));
        assert_eq!(tape_name(BOX), Some("box"));
        assert_eq!(tape_name(TAPES), None);
    }

    /// The header's canonical text. Order is FIXED even though the parser accepts any order — printing
    /// has to pick one, and a fixed one is what makes re-printing a re-parse idempotent.
    #[test]
    fn print_header_is_a_stable_listing_with_packed_tapes_and_named_comments() {
        let h = TmHeader::new(
            EncodingKind::Binary,
            4,
            2,
            Ty::List(Box::new(Ty::Nat)),
            vec![(REG, vec!['#', '0', '0', '0', '0', '#']), (WORK, vec!['#', '0', '0', '0', '0', '#'])],
        );
        let expected = "\
encoding binary
width 4
slots 2
result List<Nat>
tape 0 #0000#  ; reg
tape 1 #0000#  ; work
";
        assert_eq!(print_header(&h), expected);
    }

    /// D4: cells are PACKED, not space-separated. Rules use space-separated symbol lists because a
    /// rule's entries may be the wildcard `*`; a tape has no wildcards and `Symbol` is a `char`, so
    /// packing keeps a 120-cell bank on one readable line.
    #[test]
    fn tape_cells_are_packed_not_space_separated() {
        let h = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(REG, vec!['#', '_', '_', '_', '_', '#'])]);
        assert!(print_header(&h).contains("tape 0 #____#"), "got:\n{}", print_header(&h));
        assert!(!print_header(&h).contains("# _ _"), "cells must not be space-separated");
    }

    /// A tape with no name still prints — the comment is a courtesy, the index is the address (D3).
    #[test]
    fn a_tape_beyond_this_compilers_layout_prints_without_a_comment() {
        let h = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(9, vec!['#'])]);
        assert!(print_header(&h).contains("tape 9 #\n"), "got:\n{}", print_header(&h));
    }

    /// `parse_cells` is the inverse of the packed printing, and it stops at a comment.
    #[test]
    fn parse_cells_unpacks_and_stops_at_a_comment() {
        assert_eq!(parse_cells("#____#"), vec!['#', '_', '_', '_', '_', '#']);
        assert_eq!(parse_cells("#0000#  ; reg"), vec!['#', '0', '0', '0', '0', '#']);
        assert_eq!(parse_cells("   #1#   "), vec!['#', '1', '#']);
        assert_eq!(parse_cells(""), Vec::<Symbol>::new());
        assert_eq!(parse_cells("; only a comment"), Vec::<Symbol>::new());
    }
}
