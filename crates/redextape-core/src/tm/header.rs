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
use crate::tm::build::{BOX, HEAP, MAX_FIELD_WIDTH, REG, STACK, WORK};
use crate::tm::encoding::{Binary, Encoding, Unary};
use crate::tm::lower_tm::MAX_SLOTS;
use crate::tm::machine::{BLANK, Symbol};
use crate::tm::single_tape::MAX_ENCODABLE_TAPES;
use crate::tm::two_symbol::Code;
use crate::ty::Ty;
use crate::ty::parse_ty;

/// The `.tm` header format version of a LOWERED machine's file, and what an absent `version` means.
///
/// An ABSENT `version` directive means 1, so every file written before this directive existed stays
/// valid. An unknown version is a hard parse ERROR rather than a warning: a version can change what
/// the header's fields MEAN, and decoding a file under the wrong version's rules would produce a
/// confidently wrong value — the exact failure the header exists to prevent.
/// [`REDUCED_HEADER_VERSION`] is that case.
///
/// NOT a member of the four-directive header set (`encoding`/`width`/`slots`/`result`), so the four
/// optionality properties are unaffected and a header-less file is still header-less.
pub const HEADER_VERSION: u32 = 1;

/// The header version of a REDUCED machine's file. Its `tape` lines are the reduced machine's tapes
/// rather than the layout `encoding`, `width` and `slots` describe, so it is a version of its own, and
/// it carries `reduced` and `steps` — see [`Reduction`].
pub const REDUCED_HEADER_VERSION: u32 = 2;

/// The most steps a `steps` directive may record. A reduced file runs under its own `steps` rather than
/// `TM_DEFAULT_CAPS`, so this bounds how long a file can make a reader simulate.
pub const MAX_REDUCED_STEPS: u64 = 1_000_000_000;

/// One of the three reductions, without the data undoing it needs. Declared in the one order a reduced
/// file may list them, so `Ord` is that order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum StageKind {
    /// The fold onto one-way tapes, `to_one_way`.
    Fold,
    /// The reduction to one tape, `to_single_tape`.
    SingleTape,
    /// The reduction to two symbols, `to_two_symbol`.
    TwoSymbol,
}

impl StageKind {
    /// Every stage, in the order a reduced file lists them.
    pub const ALL: [StageKind; 3] = [StageKind::Fold, StageKind::SingleTape, StageKind::TwoSymbol];

    /// The stage's name in a `reduced` directive.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            StageKind::Fold => "fold",
            StageKind::SingleTape => "single-tape",
            StageKind::TwoSymbol => "two-symbol",
        }
    }

    /// The inverse of `name`.
    #[must_use]
    pub fn parse(s: &str) -> Option<StageKind> {
        StageKind::ALL.into_iter().find(|k| k.name() == s)
    }
}

/// Whether `kinds` is a stage list a reduced file may carry: at least one stage, in the order of
/// [`StageKind::ALL`], and none repeated.
#[must_use]
pub fn is_stage_list(kinds: &[StageKind]) -> bool {
    !kinds.is_empty() && kinds.windows(2).all(|w| w[0] < w[1])
}

/// One reduction a file's machine went through, with what undoing it needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Stage {
    /// Nothing: a folded tape reads back with no outside information.
    Fold,
    /// The tape count before the stage, `1..=MAX_ENCODABLE_TAPES`, which splitting the one tape back
    /// into its tapes needs.
    SingleTape { k: usize },
    /// The code's symbols in `Code::symbols` order, which `Code::from_symbols` rebuilds the code from.
    TwoSymbol { symbols: Vec<Symbol> },
}

impl Stage {
    /// Which reduction this is.
    #[must_use]
    pub fn kind(&self) -> StageKind {
        match self {
            Stage::Fold => StageKind::Fold,
            Stage::SingleTape { .. } => StageKind::SingleTape,
            Stage::TwoSymbol { .. } => StageKind::TwoSymbol,
        }
    }
}

/// What makes a header a reduced one: the stages its machine went through, in the order they ran, and the
/// steps the reduced machine takes to halt.
///
/// **THE `tape` LINES OF A REDUCED FILE ARE THE REDUCED MACHINE'S OWN TAPES**, so any simulator can still
/// run it, while `encoding`, `width`, `slots` and `result` stay the recipe for the tapes once every stage
/// is undone.
///
/// **PRECONDITION for the round-trip, unenforced here**, as for `TmHeader::new`: `stages` must satisfy
/// [`is_stage_list`], each stage's data must be what the parser admits (`k` in `1..=MAX_ENCODABLE_TAPES`,
/// symbols that `Code::from_symbols` accepts AND that are neither `;` nor whitespace), and `steps` must be
/// in `1..=MAX_REDUCED_STEPS`. A reduction outside those prints and does not parse back.
///
/// `;` and whitespace are named separately because `Code::from_symbols` accepts both and the round trip
/// does not: a `reduced` line is comment-stripped and trimmed before `parse_stages` sees it, so a `;`
/// symbol TRUNCATES the code there and a trailing whitespace one is dropped — parsing back to a SHORTER
/// code with no diagnostic, which is worse than failing to parse. [`reduce`] cannot reach it, since
/// `Machine::validate` refuses both as concrete symbols; this binds a hand-built header only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reduction {
    pub stages: Vec<Stage>,
    pub steps: u64,
}

/// Declares `EncodingKind` and every list that must know about it, from ONE invocation.
///
/// THE POINT: `ALL`, `at`, `name` and `parse` are generated from the same rows, so they cannot drift.
/// Adding an encoding is one line here; a hand-written `ALL` beside a hand-written enum could not give
/// that guarantee, because nothing in stable Rust compares a written-out list against the variant set —
/// a developer can satisfy every exhaustive match and still leave the list short.
///
/// COST, stated because it is real: the enum is macro-generated, so it is less greppable and produces
/// weaker rustdoc than a plain `enum`. The invocation below is the definition — read it as one.
macro_rules! encoding_kinds {
    ($( $(#[$meta:meta])* $variant:ident => $name:literal => $ty:ty ),* $(,)?) => {
        /// Which `Encoding` a file names.
        ///
        /// Generated by `encoding_kinds!` together with `ALL`/`at`/`name`/`parse` — see that macro for
        /// why. **Adding an encoding means adding one row to the invocation below, nothing else.**
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum EncodingKind {
            $( $(#[$meta])* $variant ),*
        }

        impl EncodingKind {
            /// Every kind, in declaration order. Generated from the same rows as the variants, so it
            /// cannot omit one. Iterate this rather than writing a list out: a hand-written list is a
            /// place a future encoding gets silently left out of.
            pub const ALL: &'static [EncodingKind] = &[ $( EncodingKind::$variant ),* ];

            /// This kind instantiated at `width` cells. EVERY kind in this registry must be BOUNDED
            /// (`field_width()` is always `Some`), which is why the producer in `tm.rs` needs no
            /// unbounded early-return branch the way `run_tm_fitted` does — an unbounded encoding has
            /// no name in this enum to write in a file. This doc text is emitted regardless of row
            /// count, so it says "every" rather than naming the current two — a row added here without
            /// a bounded `Encoding` behind it would go stale on exactly this line.
            /// `encoding_kind_instantiates_the_named_encoding_at_the_given_width` (below) pins
            /// boundedness for every kind in `ALL`, not just the two named at the time it was written.
            pub fn at(self, width: usize) -> Box<dyn Encoding> {
                match self {
                    $( EncodingKind::$variant => Box::new(<$ty>::at(width)) ),*
                }
            }

            /// The name written in an `encoding` directive. Lowercase, matching the rest of the text
            /// form's keywords (`tapes`, `start`, `state`, `accept`).
            pub fn name(self) -> &'static str {
                match self {
                    $( EncodingKind::$variant => $name ),*
                }
            }

            /// The inverse of `name`. `None` for an unrecognized name, which the parser reports as a
            /// diagnostic rather than defaulting — a file naming an encoding this build does not have
            /// is unreadable, and guessing would decode its tape as something else entirely.
            pub fn parse(s: &str) -> Option<EncodingKind> {
                match s {
                    $( $name => Some(EncodingKind::$variant), )*
                    _ => None,
                }
            }
        }
    };
}

// THE REGISTRATION POINT. One row per encoding: variant, its name in a `.tm` file, its `Encoding` type.
// Adding a row updates `EncodingKind`, `ALL`, `at`, `name` and `parse` together.
encoding_kinds! {
    /// Unary: value `n` is `n` filled cells, so a `w`-cell field holds `0..=w`.
    Unary => "unary" => Unary,
    /// Binary: a `w`-cell field is base-2, holding `0..2^w`.
    Binary => "binary" => Binary,
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
    /// The type of the program's RESULT VALUE — NOT "the final tape" (tape `TAPES - 1`, the BOX bank,
    /// is typically unused). The value is read from REG field 0 (`Reg::Rr`) and, for a `List<T>`,
    /// followed as a pointer into the HEAP tape (see `build::AT` for the cons-cell layout — it covers
    /// BOTH encodings, which matters here because a header may say `encoding binary`, whose head/tail
    /// words are fixed-width digit strings rather than the variable-length mark runs `encoding::unary`
    /// describes; `decode::decode_tape_ty` is the reader). Only `Nat`/`Bool`/`Unit`/`List<T>` are
    /// admissible.
    pub result: Ty,
    /// Literal initial contents by tape INDEX, ascending, with EMPTY TAPES OMITTED. Private because
    /// `new` maintains that normal form and the round-trip depends on it — see `new`.
    tapes: Vec<(usize, Vec<Symbol>)>,
    /// `Some` for a reduced machine's file, which is `version 2`; `new` leaves it `None`. See
    /// [`Reduction`] for what the other fields mean then.
    pub reduction: Option<Reduction>,
}

impl TmHeader {
    /// Build a header, normalizing `tapes` into the form the text output can represent exactly:
    /// empty tapes dropped, indices ascending, and duplicate indices collapsed to one entry — but
    /// NOT always "the first" of the input. Empties are dropped BEFORE the duplicate collapse runs,
    /// so an empty entry never wins a duplicate index merely by coming first: `[(0, []), (0, ['#'])]`
    /// keeps the SECOND entry, because the first is already gone by the time dedup sees the list.
    /// Only among the entries that survive the empty drop does input order decide the winner.
    ///
    /// The normalization is not cosmetic. An omitted `tape` line MEANS "this tape starts empty"
    /// (which is how HEAP, STACK and BOX always start), so an explicitly-stored empty entry prints
    /// nothing and parses back to no entry — and `parse_tm_full(print_tm_with(m, h))` would return a
    /// header unequal to `h`, breaking optionality property 2 over a difference that carries no
    /// information. Normalizing at construction makes the round-trip exact instead of approximate.
    ///
    /// **PRECONDITION for the round-trip, unenforced here.** This constructor accepts any `width` and
    /// `slots`, but `parse_tm_nav` caps them at `MAX_FIELD_WIDTH` and `MAX_SLOTS` (totality guards on
    /// untrusted input). So a header built with `width: 0`, `width > MAX_FIELD_WIDTH` or
    /// `slots > MAX_SLOTS` will PRINT and then fail to parse back — optionality property 2 holds for
    /// headers within those caps, not for every value this constructor admits. `run_tm_described`, the
    /// only producer in the tree, cannot exceed them: its width comes from the auto-fit search, which
    /// clamps at `MAX_FIELD_WIDTH`, and its slot count from `lower_and_size`, which refuses above
    /// `MAX_SLOTS` before a machine is ever built. The caps are not re-checked here because doing so
    /// would make a pure normalizer fallible for a case its only caller cannot reach — but a hand-built
    /// header is outside the guarantee, and that is stated here rather than discovered at parse time.
    #[must_use]
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
        TmHeader { encoding, width, slots, result, tapes, reduction: None }
    }

    /// The literal initial tapes, by index, ascending, empties omitted.
    #[must_use]
    pub fn tapes(&self) -> &[(usize, Vec<Symbol>)] {
        &self.tapes
    }

    /// The `Encoding` instance this header names, at its width. This is the half a foreign reader
    /// cannot reproduce — it needs the implementations, which the header names but cannot inline.
    #[must_use]
    pub fn encoding(&self) -> Box<dyn Encoding> {
        self.encoding.at(self.width)
    }

    /// The initial tape vector to hand `simulate`, from the literal `tape` lines. `n_tapes` comes
    /// from the file's `tapes N`. Entries outside `0..n_tapes` are dropped rather than panicked on, so
    /// a header and a tape count that disagree still yield a runnable configuration.
    ///
    /// **Not total in `n_tapes` itself.** The allocation below is `n_tapes` `Vec`s, so this is bounded
    /// only because the one caller that parses `n_tapes` from a file (`syntax::parse_tm_nav`, which
    /// `parse_tm_full` is a one-line wrapper over) caps it at `MAX_TAPES` before it ever reaches here — see that cap's doc for why an unbounded `tapes N`
    /// is a hazard. A caller that hands this an unvalidated `n_tapes` is outside that guarantee.
    #[must_use]
    pub fn init(&self, n_tapes: usize) -> Vec<Vec<Symbol>> {
        let mut init = vec![Vec::new(); n_tapes];
        for (i, cells) in &self.tapes {
            if let Some(slot) = init.get_mut(*i) {
                slot.clone_from(cells);
            }
        }
        init
    }
}

use crate::analysis::{Classified, TokenClass, push_span};
use crate::tm::comments::{CommentWriter, TmAnchor, TmDirective, content_before_comment};
use crate::ty::show;

/// Append `h`'s directives to `out`, one per line, each ending in a newline, pushing a class per span
/// onto `spans`. Emitted between `start` and the states by `syntax::print_tm_inner`, which owns the
/// buffer — so the offsets recorded here are already absolute in the finished file, with no rebasing.
/// `cw` is that same call's `CommentWriter`, so an authored comment against a header line lands on it.
///
/// The order — `version`, `encoding`, `width`, `slots`, `result`, then a reduced header's `reduced` and
/// `steps`, then `tape` lines ascending — is FIXED, even though the parser accepts any order. A printer
/// has to choose one, and a fixed choice is what makes re-printing a re-parse idempotent. `version`
/// leads: `TmHeader` has no field for it, since it is `REDUCED_HEADER_VERSION` exactly when `reduction`
/// is `Some`, but a reader needs to know which rules govern the rest of the block before it makes sense
/// of them.
///
/// KNOWN LIMIT: a tape cell equal to `;` would open a comment and not round-trip. Nothing in this tree
/// writes one: the encodings write `_ # 1 0 @`, a REDUCED file's tapes add the reductions' own markers
/// (`single_tape.rs`'s `< >` and `A`-`Z`/`a`-`z`, `one_way.rs`'s `|`), and `Machine::validate()` already
/// reserves `;`. A hand-built machine using `;` as a data symbol is outside the representable subset
/// the text form is specified for, the same as one whose state name contains a space.
pub(crate) fn write_header(out: &mut String, spans: &mut Classified, h: &TmHeader, cw: &CommentWriter<'_, TmAnchor>) {
    let directive =
        |out: &mut String, spans: &mut Classified, key: &str, val: &str, class: TokenClass, anchor: TmDirective| {
            cw.own_line(out, spans, TmAnchor::Directive(anchor), "");
            push_span(out, spans, key, TokenClass::Keyword);
            out.push(' ');
            push_span(out, spans, val, class);
            cw.trailing(out, spans, TmAnchor::Directive(anchor));
            out.push('\n');
        };
    let version = if h.reduction.is_some() { REDUCED_HEADER_VERSION } else { HEADER_VERSION };
    // `encoding` and `result` name an encoding and a type; neither has a class of its own, and `Ident`
    // is the vocabulary's word for "a name whose meaning comes from elsewhere in the file".
    directive(out, spans, "version", &version.to_string(), TokenClass::Nat, TmDirective::Version);
    directive(out, spans, "encoding", h.encoding.name(), TokenClass::Ident, TmDirective::Encoding);
    directive(out, spans, "width", &h.width.to_string(), TokenClass::Nat, TmDirective::Width);
    directive(out, spans, "slots", &h.slots.to_string(), TokenClass::Nat, TmDirective::Slots);
    directive(out, spans, "result", &show(&h.result), TokenClass::Ident, TmDirective::Result);
    if let Some(r) = &h.reduction {
        write_reduced(out, spans, &r.stages, cw);
        directive(out, spans, "steps", &r.steps.to_string(), TokenClass::Nat, TmDirective::Steps);
    }
    for (i, cells) in &h.tapes {
        let anchor = TmDirective::Tape(*i);
        cw.own_line(out, spans, TmAnchor::Directive(anchor), "");
        let packed: String = cells.iter().collect();
        push_span(out, spans, "tape", TokenClass::Keyword);
        out.push(' ');
        push_span(out, spans, &i.to_string(), TokenClass::Nat);
        out.push(' ');
        // ONE span for the whole cell run, not one per cell: the run is a single packed lexeme (D4),
        // and a 120-cell bank would otherwise contribute 120 adjacent identical spans for no gain.
        // `TmHeader::new` drops empty tapes, so the guard is belt-and-braces against a zero-width span.
        if !packed.is_empty() {
            push_span(out, spans, &packed, TokenClass::TapeSymbol);
        }
        // AN AUTHORED COMMENT DISPLACES THE GENERATED LABEL RATHER THAN JOINING IT. `;` runs to end
        // of line, so `; reg  ; mine` reparses as ONE comment whose body is `reg  ; mine`, and the
        // round trip is lost. The author's line wins: a generated label is a convenience, and
        // somebody who wrote their own has said what they want the line to say.
        //
        // Reachable, not defensive: `tape_name` labels tape 0 `reg` and tape 1 `work`, and
        // `tests/fixtures/list_1_2.tm` carries `; reg` on its `tape 0` line today.
        //
        // A reduced header's tapes are the reduced machine's, which `tape_name` does not name, so they
        // carry no label at all.
        if h.reduction.is_none()
            && !cw.has_trailing(TmAnchor::Directive(anchor))
            && let Some(name) = tape_name(*i)
        {
            out.push_str("  ");
            push_span(out, spans, &format!("; {name}"), TokenClass::Comment);
        }
        cw.trailing(out, spans, TmAnchor::Directive(anchor));
        out.push('\n');
    }
}

/// A reduced header's `reduced` line: the stages comma-separated, each with the data undoing it needs.
/// A stage name is a `Keyword` like the directive's own, a tape count a `Nat`, and the code's symbols ONE
/// `TapeSymbol` span, for the reason a `tape` line's cells are one.
///
/// KNOWN LIMIT, the same shape as the one `write_header` carries for a tape cell: a code symbol equal to
/// `;` opens a comment and truncates the code on the way back, and a trailing whitespace one is trimmed
/// away. Neither round-trips, neither is reachable from [`reduce`] — see [`Reduction`]'s precondition.
fn write_reduced(out: &mut String, spans: &mut Classified, stages: &[Stage], cw: &CommentWriter<'_, TmAnchor>) {
    let anchor = TmAnchor::Directive(TmDirective::Reduced);
    cw.own_line(out, spans, anchor, "");
    push_span(out, spans, "reduced", TokenClass::Keyword);
    for (i, stage) in stages.iter().enumerate() {
        if i > 0 {
            push_span(out, spans, ",", TokenClass::Punct);
        }
        out.push(' ');
        push_span(out, spans, stage.kind().name(), TokenClass::Keyword);
        match stage {
            Stage::Fold => {}
            Stage::SingleTape { k } => {
                out.push(' ');
                push_span(out, spans, &k.to_string(), TokenClass::Nat);
            }
            Stage::TwoSymbol { symbols } => {
                out.push(' ');
                let run: String = symbols.iter().collect();
                // `Code::from_symbols` refuses an empty order, so the guard only keeps a hand-built
                // header from pushing a zero-width span.
                if !run.is_empty() {
                    push_span(out, spans, &run, TokenClass::TapeSymbol);
                }
            }
        }
    }
    cw.trailing(out, spans, anchor);
    out.push('\n');
}

/// Unpack a `tape` line's cell run: strip a trailing `;` comment, trim, and take one `Symbol` per
/// char. The inverse of `print_header`'s packing (D4).
pub(crate) fn parse_cells(s: &str) -> Vec<Symbol> {
    content_before_comment(s).chars().collect()
}

/// The header directives seen so far, accumulated across the parse loop so they can arrive in any
/// order. `finish` decides whether they amount to a header, a diagnostic, or nothing at all.
#[derive(Default)]
pub(crate) struct HeaderParts {
    encoding: Option<EncodingKind>,
    width: Option<usize>,
    slots: Option<u32>,
    result: Option<Ty>,
    /// The parsed, VALIDATED version — `Some` only once a `version` directive has been seen naming
    /// `HEADER_VERSION` or `REDUCED_HEADER_VERSION`. Not surfaced on `TmHeader`, which prints the one
    /// that `reduction` implies. It detects a duplicate directive, and `finish` reads it for the version
    /// rules; whether a header was being attempted at all is `saw_version`'s question instead, because a
    /// `version` line that FAILED to validate still means the file was trying to carry a header.
    version: Option<u32>,
    /// The stages of the first `reduced` directive that parsed.
    reduced: Option<Vec<Stage>>,
    /// The span of the first `reduced` line, whether or not it parsed, so `finish` can both tell that
    /// one was written and point at it.
    saw_reduced: Option<Span>,
    /// The count of the first `steps` directive that parsed.
    steps: Option<u64>,
    /// The span of the first `steps` line, whether or not it parsed, for the reason `saw_reduced` gives.
    saw_steps: Option<Span>,
    /// Each entry carries the `Span` of the `tape` line it came from, so a diagnostic about ONE
    /// specific entry (the out-of-range check in `finish`) can point at the line that caused it
    /// instead of the whole file. The span is parse-time-only: `finish` strips it before handing the
    /// tapes to `TmHeader::new`, which never carries one (see that type's doc).
    tapes: Vec<(usize, Vec<Symbol>, Span)>,
    /// The index of every entry in `tapes`, so a duplicate `tape` line is found in one lookup.
    /// Scanning `tapes` for it compared each line's index with every earlier one, which made a header
    /// of many `tape` lines quadratic to parse.
    tape_indices: std::collections::HashSet<usize>,
    /// Whether any `tape` line was seen. Tracked separately from `tapes` because a `tape` line that
    /// FAILED to parse still means the file was trying to carry a header, and `finish` must not then
    /// report "no header".
    saw_tape: bool,
    /// Whether any `version` line was seen, mirroring `saw_tape` exactly and for the same reason: a
    /// `version` directive that failed to parse (or named an unknown version — caught earlier, in
    /// `directive`, since that error must fire regardless of what else is in the file) still means the
    /// file was trying to say something, and a LONE, valid `version` with none of the four directives
    /// must not silently read as "no header" either — that would turn a typo into invisible data loss,
    /// same as a stray `tape` line.
    saw_version: bool,
}

impl HeaderParts {
    /// Offer one non-comment line's `key` and remainder, plus that line's `span` (needed only for a
    /// `tape` line — see the field doc on `tapes`). Returns `None` if `key` is not a header directive
    /// (the caller keeps looking), `Some(Ok(()))` if it was consumed, `Some(Err(msg))` if it was a
    /// header directive that did not parse.
    ///
    /// A DUPLICATE directive is an error rather than last-wins. The rule is that the file STATES A
    /// THING ONCE — not that the values disagree: two *agreeing* `width 4` lines are refused too.
    /// Disagreeing ones are the motivating case (there is no defensible winner, and picking one
    /// silently would decode the tape against a recipe the file does not unambiguously state), but
    /// admitting agreeing duplicates would mean comparing values to decide whether a file is
    /// well-formed, which is a strictly worse rule to state and to test.
    pub(crate) fn directive(&mut self, key: &str, rest: &str, span: Span) -> Option<Result<(), String>> {
        let val = content_before_comment(rest);
        match key {
            // Unlike the four directives below, an unrecognized version is not "incomplete" — it is
            // refused outright, here, at the earliest point it can be: a file parsed under the wrong
            // version's rules would not fail to parse, it would parse to a CONFIDENTLY WRONG value,
            // because a version can redefine what the other directives mean. A duplicate is an error for
            // the same reason as the other four, and on the same rule: the file states a thing once, so
            // two AGREEING `version 1` lines are refused as well.
            "version" => {
                self.saw_version = true;
                Some(match (self.version, val.parse::<u32>()) {
                    (Some(_), _) => Err("duplicate `version` directive".into()),
                    (None, Ok(v)) if v == HEADER_VERSION || v == REDUCED_HEADER_VERSION => {
                        self.version = Some(v);
                        Ok(())
                    }
                    (None, Ok(v)) => Err(format!(
                        "unsupported header version `{v}` (this build reads versions {HEADER_VERSION} and \
                         {REDUCED_HEADER_VERSION})"
                    )),
                    (None, Err(_)) => Err(format!(
                        "expected `version {HEADER_VERSION}` or `version {REDUCED_HEADER_VERSION}`, found `{val}`"
                    )),
                })
            }
            // Whether a `reduced` or `steps` line is allowed at all is the version's business, and the
            // version may come later in the file, so `finish` decides that; these arms parse the value.
            "reduced" => {
                self.saw_reduced = self.saw_reduced.or(Some(span));
                Some(match (&self.reduced, parse_stages(val)) {
                    (Some(_), _) => Err("duplicate `reduced` directive".into()),
                    (None, Some(stages)) => {
                        self.reduced = Some(stages);
                        Ok(())
                    }
                    (None, None) => Err(format!(
                        "expected `reduced` followed by `fold`, `single-tape <1..={MAX_ENCODABLE_TAPES}>` and \
                         `two-symbol <symbols>`, comma-separated, in that order and each at most once, with \
                         the symbols starting at `{BLANK}` and none repeated; found `{val}`"
                    )),
                })
            }
            "steps" => {
                self.saw_steps = self.saw_steps.or(Some(span));
                Some(match (self.steps, val.parse::<u64>()) {
                    (Some(_), _) => Err("duplicate `steps` directive".into()),
                    (None, Ok(n)) if (1..=MAX_REDUCED_STEPS).contains(&n) => {
                        self.steps = Some(n);
                        Ok(())
                    }
                    (None, _) => Err(format!("expected `steps <1..={MAX_REDUCED_STEPS}>`, found `{val}`")),
                })
            }
            "encoding" => Some(match (self.encoding, EncodingKind::parse(val)) {
                (Some(_), _) => Err("duplicate `encoding` directive".into()),
                (None, Some(k)) => {
                    self.encoding = Some(k);
                    Ok(())
                }
                (None, None) => Err(format!("unknown `encoding` name `{val}` (expected `unary` or `binary`)")),
            }),
            // Capped at the auto-fit search's OWN ceiling: `run_tm_fitted` doubles from
            // `MIN_FIELD_WIDTH` and clamps at `MAX_FIELD_WIDTH`, so a file naming a wider field
            // describes a bank this build could not have produced and whose recipe it cannot evaluate.
            // (NOT, despite the sibling arm below, a ceiling `lower_and_size` enforces — that function
            // checks `MAX_SLOTS`, `frame_bank_unrepresentable` and `mul_count_unrepresentable`, and
            // nothing about field width.) With `slots`, this bounds `init_reg`'s
            // `slots * (width + 1)` allocation. A TOTALITY guard on untrusted input, not a language limit.
            "width" => Some(match (self.width, val.parse::<usize>()) {
                (Some(_), _) => Err("duplicate `width` directive".into()),
                (None, Ok(n)) if (1..=MAX_FIELD_WIDTH).contains(&n) => {
                    self.width = Some(n);
                    Ok(())
                }
                (None, _) => Err(format!("expected `width <1..={MAX_FIELD_WIDTH}>`, found `{val}`")),
            }),
            // Capped at the same ceiling `lower_and_size` enforces for in-memory programs, so the file
            // path and the in-memory path cannot disagree about one named limit. With `width`, this
            // bounds `init_reg`'s `slots * (width + 1)` allocation. A TOTALITY guard on untrusted
            // input, not a language limit.
            "slots" => Some(match (self.slots, val.parse::<u32>()) {
                (Some(_), _) => Err("duplicate `slots` directive".into()),
                (None, Ok(n)) if n <= MAX_SLOTS => {
                    self.slots = Some(n);
                    Ok(())
                }
                (None, _) => Err(format!("expected `slots <0..={MAX_SLOTS}>`, found `{val}`")),
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
                    Ok(i) if self.tape_indices.contains(&i) => Err(format!("duplicate `tape {i}` directive")),
                    Ok(i) => {
                        self.tape_indices.insert(i);
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
    /// - **Zero of the four present** (and no `tape` or `version` line) -> `(None, [])`: the file has
    ///   no header, which is not an error. This is optionality property 4, and it is what every file
    ///   written before this slice looks like.
    /// - **All four present** -> a validated header. (`version`, valid or absent, has already been
    ///   settled in `directive` — an unrecognized version errors there, immediately, rather than
    ///   waiting for `finish`.)
    /// - **One to three present** -> `(None, [(msg, None)])` naming the missing ones. Not a silent
    ///   `None`, because discarding a half-written header would turn a typo into "this file has no
    ///   header". Spanless: there is no single offending line for an ABSENT directive.
    /// - **`tape`, `version`, `reduced` and/or `steps` lines but none of the four** -> an error for the
    ///   same reason: that data would otherwise vanish without a word. Also spanless, for the same
    ///   reason. The other three are folded in here rather than getting cases of their own because a
    ///   LONE one has exactly the same shape as a lone `tape`: a directive with no header for it to
    ///   belong to.
    /// - **The version rules** -> `version 2` requires `reduced` and `steps`, and under `version 1`,
    ///   written or absent, either is an error pointing at its line. See `version_errors`.
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
            return if self.saw_tape || self.saw_version || self.saw_reduced.is_some() || self.saw_steps.is_some() {
                (
                    None,
                    vec![(
                        "`tape`/`version`/`reduced`/`steps` directives without a header (needs `encoding`, \
                         `width`, `slots`, `result`)"
                            .into(),
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
        let errs = self.version_errors();
        if !errs.is_empty() {
            return (None, errs);
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
        // `missing` is empty here, so all four ARE `Some` — but destructure rather than unwrap, so the
        // no-panic rule holds by construction rather than by reading the twenty lines above. The `else`
        // arm is unreachable in practice and reports the same incomplete-header diagnostic it would
        // have reported above, so a future edit that breaks the invariant degrades to a diagnostic.
        let (Some(encoding), Some(width), Some(slots), Some(result)) =
            (self.encoding, self.width, self.slots, self.result)
        else {
            return (None, vec![("incomplete header: missing a required directive".into(), None)]);
        };
        let tapes: Vec<(usize, Vec<Symbol>)> = self.tapes.into_iter().map(|(i, cells, _)| (i, cells)).collect();
        let mut header = TmHeader::new(encoding, width, slots, result, tapes);
        header.reduction = self.reduced.zip(self.steps).map(|(stages, steps)| Reduction { stages, steps });
        (Some(header), Vec::new())
    }

    /// `version 2` exactly when `reduced` and `steps` are both written: under `version 2` a missing one is
    /// an error, and under `version 1`, written or absent, a written one is an error pointing at its line.
    ///
    /// Asked only once the version is known. A `version` line that did not parse has been reported
    /// already, and it says nothing about which rules the rest of the header meant, so a guess here would
    /// only add a second diagnostic about the same line.
    fn version_errors(&self) -> Vec<(String, Option<Span>)> {
        if self.saw_version && self.version.is_none() {
            return Vec::new();
        }
        if self.version == Some(REDUCED_HEADER_VERSION) {
            [("reduced", self.saw_reduced), ("steps", self.saw_steps)]
                .into_iter()
                .filter(|(_, seen)| seen.is_none())
                .map(|(key, _)| (format!("`version {REDUCED_HEADER_VERSION}` requires a `{key}` directive"), None))
                .collect()
        } else {
            [("reduced", self.saw_reduced), ("steps", self.saw_steps)]
                .into_iter()
                .filter_map(|(key, seen)| {
                    let msg = format!(
                        "`{key}` requires `version {REDUCED_HEADER_VERSION}`; this header is version {HEADER_VERSION}"
                    );
                    seen.map(|span| (msg, Some(span)))
                })
                .collect()
        }
    }
}

/// A `reduced` directive's stages, or `None` unless every stage parses, its data is in range, and the list
/// is one [`is_stage_list`] admits.
///
/// **`two-symbol` IS ALWAYS LAST, SO ITS SYMBOLS ARE THE REST OF THE LINE.** A symbol can be `,`, so
/// splitting the line on commas first would cut the symbols in two; a symbol cannot be `;`, which is
/// what lets `content_before_comment` strip a trailing comment before this sees the value.
fn parse_stages(val: &str) -> Option<Vec<Stage>> {
    let mut stages = Vec::new();
    let mut rest = val;
    loop {
        if let Some(run) = rest.strip_prefix(StageKind::TwoSymbol.name()).and_then(|r| r.strip_prefix(' ')) {
            let symbols: Vec<Symbol> = run.chars().collect();
            Code::from_symbols(&symbols)?;
            stages.push(Stage::TwoSymbol { symbols });
            break;
        }
        let (item, tail) = match rest.split_once(", ") {
            Some((item, tail)) => (item, Some(tail)),
            None => (rest, None),
        };
        stages.push(match item.split_once(' ') {
            None if item == StageKind::Fold.name() => Stage::Fold,
            Some((name, k)) if name == StageKind::SingleTape.name() => {
                Stage::SingleTape { k: k.parse().ok().filter(|k| (1..=MAX_ENCODABLE_TAPES).contains(k))? }
            }
            _ => return None,
        });
        match tail {
            Some(t) => rest = t,
            None => break,
        }
    }
    let kinds: Vec<StageKind> = stages.iter().map(Stage::kind).collect();
    is_stage_list(&kinds).then_some(stages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::build::{MAX_FIELD_WIDTH, TAPES};

    /// The header block on its own, for the tests below that assert its text rather than a whole file.
    /// A one-line wrapper over the one formatter — the spans are simply discarded here.
    fn print_header(h: &TmHeader) -> String {
        let mut out = String::new();
        write_header(&mut out, &mut Vec::new(), h, &CommentWriter::new(&[]));
        out
    }

    fn a_header() -> TmHeader {
        TmHeader::new(
            EncodingKind::Binary,
            16,
            3,
            Ty::List(Box::new(Ty::Nat)),
            vec![(REG, vec!['#', '0', '#']), (WORK, vec!['#', '0', '#'])],
        )
    }

    /// `ALL` is generated by the same macro invocation that declares the variants, so it cannot omit
    /// one. This test pins the consequences a caller depends on: every entry round-trips through
    /// `name`/`parse`, and no two entries share a name.
    #[test]
    fn all_lists_every_kind_and_round_trips() {
        assert!(!EncodingKind::ALL.is_empty());
        for &k in EncodingKind::ALL {
            assert_eq!(EncodingKind::parse(k.name()), Some(k), "`{}` does not round-trip", k.name());
        }
        let mut names: Vec<&str> = EncodingKind::ALL.iter().map(|k| k.name()).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(names.len(), before, "two encodings share a name");
    }

    #[test]
    fn encoding_kind_names_round_trip() {
        for &k in EncodingKind::ALL {
            assert_eq!(EncodingKind::parse(k.name()), Some(k));
        }
        assert_eq!(EncodingKind::parse("ternary"), None);
        assert_eq!(EncodingKind::parse("Unary"), None); // names are lowercase
    }

    /// The kind names the encoding AND the width instantiates it — both halves must reach the
    /// `Encoding` you get back, or the recipe describes a different machine than it claims.
    ///
    /// Iterates `EncodingKind::ALL` rather than naming `Unary`/`Binary` by hand, so a third row added
    /// to `encoding_kinds!` is checked here automatically instead of leaving this test covering two of
    /// three kinds while its assertions still read as general. In particular, this is what pins
    /// `at`'s doc claim that EVERY kind is BOUNDED (`field_width()` is always `Some`) — the property
    /// `run_tm_described` in `tm.rs` relies on to skip an unbounded branch.
    #[test]
    fn encoding_kind_instantiates_the_named_encoding_at_the_given_width() {
        for &k in EncodingKind::ALL {
            assert_eq!(k.at(8).field_width(), Some(8));
            assert_eq!(k.at(16).field_width(), Some(16));
            // BOUNDED: `field_width()` must be `Some` even at the largest width this build allows.
            assert!(k.at(MAX_FIELD_WIDTH).field_width().is_some());
        }
        // The kinds are distinguishable through the trait: a zero bank differs between them.
        assert_ne!(EncodingKind::Unary.at(8).init_reg(1), EncodingKind::Binary.at(8).init_reg(1));
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

        // The duplicate-index collapse `dedup_by_key` implements has been untested until now, though
        // `TmHeader::new` is `pub` and documents the behaviour. Neither entry here is empty, so the
        // empty-tape filter above does not interfere with either one — input order alone decides the
        // winner, and (per the corrected doc on `new`) the first entry survives.
        let h = TmHeader::new(EncodingKind::Unary, 8, 1, Ty::Nat, vec![(REG, vec!['#', 'a']), (REG, vec!['#', 'b'])]);
        assert_eq!(h.tapes().len(), 1, "duplicate indices must collapse to one entry");
        assert_eq!(h.tapes()[0], (REG, vec!['#', 'a']), "first survives when neither side is empty");
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
version 1
encoding binary
width 4
slots 2
result List<Nat>
tape 0 #0000#  ; reg
tape 1 #0000#  ; work
";
        assert_eq!(print_header(&h), expected);
    }

    /// `a_header`'s recipe with a one-tape reduced machine's tape, through all three stages.
    fn a_reduced_header() -> TmHeader {
        let mut h = TmHeader::new(EncodingKind::Unary, 8, 4, Ty::Nat, vec![(REG, vec!['1', '_', '1'])]);
        h.reduction = Some(Reduction {
            stages: vec![Stage::Fold, Stage::SingleTape { k: 5 }, Stage::TwoSymbol { symbols: vec!['_', '#', ','] }],
            steps: 7_088_578,
        });
        h
    }

    /// A reduced header's canonical text: `version 2`, then `reduced` and `steps` after `result`, and no
    /// generated label on a `tape` line, since the reduced machine's tape 0 is not REG.
    #[test]
    fn a_reduced_header_prints_version_2_its_stages_and_steps_and_no_tape_label() {
        let expected = "\
version 2
encoding unary
width 8
slots 4
result Nat
reduced fold, single-tape 5, two-symbol _#,
steps 7088578
tape 0 1_1
";
        assert_eq!(print_header(&a_reduced_header()), expected);
    }

    /// Every token of a reduced header carries a class, in order: a stage name is a `Keyword`, a tape
    /// count a `Nat`, the separator a `Punct`, and the code's symbols one `TapeSymbol` span.
    #[test]
    fn a_reduced_header_classifies_every_token() {
        use TokenClass::{Ident as Id, Keyword as Kw, Nat as Nt, Punct as Pu, TapeSymbol as Ts};
        let (mut out, mut spans) = (String::new(), Vec::new());
        write_header(&mut out, &mut spans, &a_reduced_header(), &CommentWriter::new(&[]));
        let named: Vec<(&str, TokenClass)> = spans.iter().map(|(s, c)| (&out[s.start..s.end], *c)).collect();
        assert_eq!(
            named,
            vec![
                ("version", Kw),
                ("2", Nt),
                ("encoding", Kw),
                ("unary", Id),
                ("width", Kw),
                ("8", Nt),
                ("slots", Kw),
                ("4", Nt),
                ("result", Kw),
                ("Nat", Id),
                ("reduced", Kw),
                ("fold", Kw),
                (",", Pu),
                ("single-tape", Kw),
                ("5", Nt),
                (",", Pu),
                ("two-symbol", Kw),
                ("_#,", Ts),
                ("steps", Kw),
                ("7088578", Nt),
                ("tape", Kw),
                ("0", Nt),
                ("1_1", Ts),
            ]
        );
    }

    #[test]
    fn stage_names_round_trip_and_only_the_canonical_order_is_a_stage_list() {
        for k in StageKind::ALL {
            assert_eq!(StageKind::parse(k.name()), Some(k));
        }
        assert_eq!(StageKind::parse("Fold"), None);
        use StageKind::{Fold, SingleTape, TwoSymbol};
        assert!(is_stage_list(&[Fold, SingleTape, TwoSymbol]));
        assert!(is_stage_list(&[SingleTape]));
        assert!(!is_stage_list(&[]), "empty");
        assert!(!is_stage_list(&[TwoSymbol, Fold]), "out of order");
        assert!(!is_stage_list(&[Fold, Fold]), "repeated");
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
