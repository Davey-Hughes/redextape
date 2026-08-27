//! Printer for the mini-language: a parsed program plus its trivia back to canonical text.
//!
//! `redextape fmt` is exactly `print ∘ parse` (spec §7.2), so EVERY line break below is this module's
//! choice and none of it is recovered from the author's layout. That is what makes comment placement
//! a decision rather than bookkeeping.
//!
//! TWO SHAPES THE AST DOES NOT CARRY, both re-derived here:
//!
//!   * **Parentheses.** `(1 + 2) * 3` and `1 + 2 * 3` are different trees and the same token set minus
//!     two bytes. `expr_prec` re-adds exactly the parens the binding powers require.
//!   * **Nothing about the left spine's depth.** `parse_binary_inner` climbs precedence in a loop, so
//!     `a + b + c + …` nests as deep as the chain is long while the parser recurses once. `ast.rs`'s
//!     hand-written iterative `Drop` exists for that shape and records that the recursive version
//!     aborts the process; a recursive printer would abort on the same input. `binary_chain` and
//!     `postfix_chain` walk their spines iteratively. Everything else recurses, bounded by the
//!     parser's own `MAX_PARSE_DEPTH`.

use crate::ast::{BinOp, Block, Expr, Program, Stmt};
use crate::parser::Parsed;
use crate::span::Span;
use crate::token::Comment;

/// Column budget, matching this repo's `rustfmt.toml` `max_width`.
///
/// MEASURED IN BYTES, not display columns: every comparison against it goes through `col()`, which is
/// `out.len() - line_start`. A non-ASCII comment therefore spends more of the budget than it occupies
/// on screen — a line of two-byte characters is cut at 60 of them. Stated rather than fixed, because
/// the only inputs this language admits outside comments are ASCII, and a grapheme-aware width would
/// be a second measurement to keep in step with the first.
///
/// **THIS IS THE DEFAULT, NOT THE RULE, AND IT IS BOTH OF THOSE WORDS THAT MATTER.** A caller may
/// choose another width through `print_with_width`, so a reader who meets this constant learns what
/// an un-parameterized `print` uses and nothing about what any given output is bounded by. It is
/// also not a bound at the default: `tests/format_properties.rs`'s
/// `no_line_exceeds_the_budget_except_the_three_documented_constructs` enumerates three constructs
/// that overrun it and pins each with an input that does.
pub const MAX_WIDTH: usize = 120;

/// Spaces per nesting level — rustfmt's default `tab_spaces`.
const INDENT: usize = 4;

/// A list element whose printed form is wider than this forces one-per-line instead of fill.
/// rustfmt's `short_array_element_width_threshold` default. `examples/rustfmt_calibration_probe.rs`
/// is what confirms or moves it; it is written down so the probe has something to disagree with.
const SHORT_ELEMENT: usize = 10;

/// Binding power of an expression in operand position: the operator's own for a `Binary`, zero for a
/// `Lambda` (its body is greedy, so it always parenthesises inside an operator), and above every
/// operator for anything else.
const ATOM_BP: u8 = 4;

/// Everything a speculative print can mutate that must be undone if the attempt is discarded — see
/// `Printer::mark`/`Printer::rewind`. The question for a field belonging here is never "is this a byte
/// offset into `out`?" (test-only `visited_len` is not); it is "does this need to rewind?" — if a print
/// inside a `mark`/`rewind` window can write it for real, the answer is yes.
///
/// `next` is the fourth field found this way, and the reasoning is the same shape as the other three:
/// `bracketed` guards its own inline attempt with `must_break`, so THAT path never flushes a comment
/// during speculation — but `postfix_chain` has no such guard. Its inline attempt calls `args` ->
/// `bracketed` on each argument list, and if ONE of those holds a comment, `bracketed` takes
/// `must_break`, breaks vertically, and `vertical_rows` -> `open_line` -> `flush_before` advances `next`
/// and writes real output — inside a window `postfix_chain` may still discard. Without `next` on `Mark`,
/// a `rewind` there leaves the cursor already past those comments; the reprint that follows starts
/// looking from `next` onward and never sees them again. They are not misplaced, they are gone.
#[derive(Clone, Copy)]
struct Mark {
    out_len: usize,
    line_start: usize,
    last_end: usize,
    next: usize,
    /// Saved length of `Printer::visited`, mirroring `out_len`: rewound by truncating back to a length
    /// rather than restoring a cloned snapshot, for the same reason `out` is truncated rather than
    /// replaced.
    #[cfg(test)]
    visited_len: usize,
}

struct Printer<'a> {
    /// The string every span in the tree indexes into. Blank lines are read back out of it rather
    /// than recorded, which is why the trivia list holds comments only.
    src: &'a str,
    /// Sorted by start offset and non-overlapping with any token, which is what lets `next` be a
    /// single forward cursor rather than a search.
    comments: &'a [Comment],
    /// Index into `comments` of the next comment not yet emitted.
    next: usize,
    out: String,
    /// Byte index in `out` at which the current line starts. The column is `out.len() - line_start`.
    line_start: usize,
    /// Nesting level, in units of `INDENT`.
    level: usize,
    /// The line budget this printer is working to. `MAX_WIDTH` unless a caller chose otherwise —
    /// see that constant's doc for why it is a budget rather than a bound at any value.
    width: usize,
    /// End offset of the last item written — construct OR comment. Gaps measure from here, so a
    /// comment sitting between two statements does not swallow the blank line on one side of it and
    /// invent one on the other.
    last_end: usize,
    /// How many enclosing inline attempts are in progress, all of which discard their output if a
    /// newline appears in it. NOT on `Mark`: it is a balanced counter that each attempt restores by
    /// its own decrement, so it is never in the wrong state at a `rewind`.
    ///
    /// **THE COST THIS EXISTS FOR IS EXPONENTIAL, and was measured, not reasoned about.** An inline
    /// attempt that contains a construct which breaks is doomed — a newline inside it is exactly what
    /// disqualifies it — so printing that construct's broken form in full is work the enclosing
    /// `rewind` throws away. Do it at every level of a nested construct and each level costs two full
    /// prints of the level below: `[[[…]]]` nested 16 deep, 202 bytes of input, took 11.5 SECONDS,
    /// and 20 deep did not finish. With this counter each doomed attempt stops at the first newline
    /// its own depth produces, and the same input formats in microseconds.
    ///
    /// Correctness rests on one invariant: `speculating` is incremented ONLY around an attempt that
    /// unconditionally discards its output when a newline appears in it. So an abort is never
    /// observable — some ancestor is guaranteed to rewind it and reprint, and that reprint runs with
    /// the counter one lower, until the outermost print runs at zero and prints for real.
    speculating: usize,
    /// Test-only count of `expr_prec` entries: the unit of work a discarded inline attempt repeats.
    /// DELIBERATELY NOT ON `Mark` — a rewind discards the OUTPUT of a speculative print, and what this
    /// counts is that the print happened at all. It is the only way to assert `speculating`'s
    /// guarantee without a wall-clock timer, whose failure mode for a regression here is a test run
    /// that never finishes rather than one that fails.
    #[cfg(test)]
    prints: usize,
    /// Node spans in visit order. Test-only: the whole trivia design rests on this sequence being
    /// non-decreasing, and a field is how that gets asserted without a second traversal to disagree
    /// with the first. Rewound alongside `out` by `Printer::rewind` — see `Mark`'s doc.
    #[cfg(test)]
    visited: Vec<Span>,
}

impl<'a> Printer<'a> {
    fn new(src: &'a str, comments: &'a [Comment]) -> Self {
        Printer::with_width(src, comments, MAX_WIDTH)
    }

    fn with_width(src: &'a str, comments: &'a [Comment], width: usize) -> Self {
        Printer {
            src,
            comments,
            next: 0,
            out: String::new(),
            line_start: 0,
            level: 0,
            last_end: 0,
            speculating: 0,
            width,
            #[cfg(test)]
            prints: 0,
            #[cfg(test)]
            visited: Vec::new(),
        }
    }

    /// Current column: bytes since the last `newline`. BYTES, not display columns — see `MAX_WIDTH`,
    /// which this is compared against.
    fn col(&self) -> usize {
        self.out.len() - self.line_start
    }

    fn newline(&mut self) {
        self.out.push('\n');
        self.line_start = self.out.len();
    }

    /// Close the open line, if one is open. A no-op at column 0 — which since `flush_before` started
    /// writing its own terminating newline (§7's forced break, made structural) is the state every
    /// caller is in immediately after a comment was flushed.
    ///
    /// THIS IS WHY THE FORCED BREAK IS NO LONGER A CALLER'S OBLIGATION. Each site below wants "the
    /// next thing starts on a fresh line", and `newline()` spelled that as "push one" — correct only
    /// while nothing else could have ended the line first. `flush_before` now can, so the sites that
    /// used to push unconditionally would double up, and the one site that pushed CONDITIONALLY
    /// (`postfix_chain`'s `Link::Call`) is the one that once forgot and swallowed a whole call into a
    /// comment. Asking the buffer is not the same obligation restated: forgetting `end_line` merges
    /// two lines the printer chose to separate, while forgetting the old newline merged a line into a
    /// `//` and changed the program.
    fn end_line(&mut self) {
        if self.col() != 0 {
            self.newline();
        }
    }

    /// Is everything printed since `mark` still a candidate for the inline form — within the width
    /// budget AND unbroken?
    ///
    /// `col()` ALONE IS NOT THE QUESTION, and `postfix_chain` said so long before `bracketed` asked
    /// it: a nested construct can break internally on its own overrun, which leaves a short FINAL
    /// line even though the attempt was never one line. Accepting that gives the half-broken hybrid —
    /// one element vertical, everything around it still inline — which is not a shape rustfmt
    /// produces at this repo's settings.
    ///
    /// `line_start > mark.out_len` is the O(1) spelling of "a newline was written since the mark":
    /// `newline()` sets `line_start = out.len()`, so it can only exceed a length captured earlier if
    /// one ran in between. It replaces an `out[mark..].contains('\n')` scan that re-read the whole
    /// tail on every call.
    ///
    /// MONOTONE, which is what lets a caller stop the moment it goes false: absent a newline the
    /// buffer only grows, so the column only rises, and a newline cannot be unwritten.
    fn fits_inline_since(&self, mark: Mark) -> bool {
        self.col() <= self.width && self.line_start <= mark.out_len
    }

    /// Called by every construct that is about to print a form containing a newline. Inside an
    /// enclosing inline attempt that form is already discarded work, so emit the one newline that
    /// tells the caller its attempt failed and return without printing it. See `speculating`.
    fn abort_if_speculating(&mut self) -> bool {
        if self.speculating == 0 {
            return false;
        }
        self.newline();
        true
    }

    /// Capture every field a speculative print can write, so a discarded attempt leaves none of them
    /// describing text `out` no longer contains.
    ///
    /// THE RULE, and it is the whole of this doc: a site that saves a position to possibly truncate
    /// back to MUST go through `mark`/`rewind` rather than a bare `self.out.len()`, and a field added
    /// to `Printer` must be asked "can a print between `mark` and `rewind` write this for real?" —
    /// never "is it a byte offset?". `Mark`'s own doc is where the five present fields and the
    /// reasoning that found each of them live. Their symptoms are all different, which is why the
    /// question and not the pattern is what carries: a `col()` underflow (`line_start`), a blank line
    /// measured against text that was thrown away (`last_end`), a visit order that goes backwards
    /// (`visited`), and comments consumed by a print that never shipped (`next`).
    fn mark(&self) -> Mark {
        Mark {
            out_len: self.out.len(),
            line_start: self.line_start,
            last_end: self.last_end,
            next: self.next,
            #[cfg(test)]
            visited_len: self.visited.len(),
        }
    }

    /// Undo everything printed since `mark`, restoring `out`, `line_start`, `last_end`, `next`, and
    /// (test-only) `visited` to that point.
    fn rewind(&mut self, mark: Mark) {
        self.out.truncate(mark.out_len);
        self.line_start = mark.line_start;
        self.last_end = mark.last_end;
        self.next = mark.next;
        #[cfg(test)]
        self.visited.truncate(mark.visited_len);
    }

    fn indent(&mut self) {
        for _ in 0..self.level * INDENT {
            self.out.push(' ');
        }
    }

    /// Record that a node is being visited. The body is test-only; the call sites are not, so the
    /// visit order asserted by the tests is the order production printing actually uses.
    // `self` is genuinely unused once the `#[cfg(test)]` push is compiled out, in a non-test build.
    // This allow is PERMANENT: `visit`'s body stays `#[cfg(test)]`-gated indefinitely, so `self` is
    // unused in every non-test build for good.
    #[allow(clippy::unused_self)]
    fn visit(&mut self, span: Span) {
        #[cfg(test)]
        self.visited.push(span);
        let _ = span;
    }

    fn expr(&mut self, e: &Expr) {
        self.expr_prec(e, 0);
    }

    /// Print `e`, wrapping it in parens when its binding power is below `min_bp`.
    fn expr_prec(&mut self, e: &Expr, min_bp: u8) {
        #[cfg(test)]
        {
            self.prints += 1;
        }
        if bp_of(e) < min_bp {
            self.out.push('(');
            self.expr_prec(e, 0);
            self.out.push(')');
            return;
        }
        self.visit(e.span());
        match e {
            Expr::Nat { value, .. } => self.out.push_str(&value.to_string()),
            Expr::Bool { value, .. } => self.out.push_str(if *value { "true" } else { "false" }),
            Expr::Var { name, .. } => self.out.push_str(name),
            Expr::Binary { .. } => self.binary_chain(e),
            Expr::List { items, span } => self.list(items, *span),
            Expr::Lambda { params, body, .. } => {
                self.out.push('|');
                self.out.push_str(&params.join(", "));
                self.out.push_str("| ");
                self.expr_prec(body, 0);
            }
            Expr::Call { .. } | Expr::Method { .. } => self.postfix_chain(e),
            Expr::Block { block, .. } => self.braced(block),
            Expr::If { cond, then_blk, else_blk, .. } => self.if_chain(cond, then_blk, else_blk),
        }
    }

    /// A left-nested `Binary` run at one precedence level, printed without recursing down the spine.
    ///
    /// The spine is collected only while the left child's binding power is at least the parent's —
    /// which is exactly when no parens are needed — so a precedence drop ends the run and recurses
    /// once. There are three precedence levels, so that recursion is bounded by three, not by the
    /// chain's length.
    fn binary_chain(&mut self, e: &Expr) {
        let Expr::Binary { op, .. } = e else { return };
        let bp = bp_of_op(*op);
        let mut spine: Vec<(BinOp, &Expr)> = Vec::new();
        let mut cur = e;
        while let Expr::Binary { op: o, lhs, rhs, .. } = cur {
            if bp_of_op(*o) != bp {
                break;
            }
            spine.push((*o, rhs.as_ref()));
            cur = lhs.as_ref();
        }
        spine.reverse();
        // `cur` is the leftmost operand of the run. Left-associative: the left side accepts equal
        // binding power, the right side does not.
        self.expr_prec(cur, bp);
        for (o, rhs) in spine {
            self.out.push(' ');
            self.out.push_str(op_text(o));
            self.out.push(' ');
            self.expr_prec(rhs, bp + 1);
        }
    }

    /// A left-nested run of calls and method calls, printed without recursing down the spine.
    fn postfix_chain(&mut self, e: &Expr) {
        #[derive(Clone, Copy)]
        enum Link<'a> {
            // The `Span` is the argument region passed to `bracketed` — see its doc comment for how
            // each variant derives one. The `bool` is whether a comment sits in the CONNECTOR zone
            // ahead of this link — between the previous link's true end and this link's own `(` — which
            // `region` deliberately excludes (see `bracketed`'s doc) but which still has to be noticed
            // by SOMETHING, or it is silently dropped rather than merely misattributed.
            Call(&'a [Expr], Span, bool),
            Method(&'a str, &'a [Expr], Span, bool),
        }
        impl Link<'_> {
            fn region(self) -> Span {
                match self {
                    Link::Call(_, r, _) | Link::Method(_, _, r, _) => r,
                }
            }
            fn has_connector_comment(self) -> bool {
                match self {
                    Link::Call(_, _, c) | Link::Method(_, _, _, c) => c,
                }
            }
        }
        let mut links: Vec<Link<'_>> = Vec::new();
        let mut cur = e;
        loop {
            match cur {
                Expr::Call { callee, args, span } => {
                    let prev_end = callee.span().end;
                    let start = self.open_paren_after(prev_end);
                    let connector = self.contains_comment(Span::new(prev_end, start));
                    links.push(Link::Call(args, Span::new(start, span.end), connector));
                    cur = callee.as_ref();
                }
                Expr::Method { recv, name, args, span } => {
                    let prev_end = recv.span().end;
                    let start = self.open_paren_after(prev_end);
                    let connector = self.contains_comment(Span::new(prev_end, start));
                    links.push(Link::Method(name, args, Span::new(start, span.end), connector));
                    cur = recv.as_ref();
                }
                _ => break,
            }
        }
        links.reverse();
        // ONLY `.method(…)` LINKS ARE BREAKABLE FOR WIDTH. `f(1)(2)` has nowhere to put a newline
        // just because it is long, so a chain of plain calls stays on one line however wide it gets —
        // the same class of exception as §6.6's binary chains, and named here rather than discovered.
        // `breakable` gates the width-driven, one-link-per-line vertical form below; it does NOT gate
        // whether a connector comment gets flushed — see `has_connector_comment`, where a comment
        // forces a real newline regardless of whether the chain can also break for width.
        let breakable = links.iter().any(|l| matches!(l, Link::Method(..)));
        // A connector comment forces a break regardless of width: it sits between two links, outside
        // every argument list's own region, so no `bracketed` call below ever sees it and the fit
        // check has no way to know it exists. This applies to EVERY chain, breakable or not — `//`
        // runs to end of line no matter how many links follow it, so a chain of plain calls needs the
        // flush exactly as much as a method chain does. Leaving it ungated on `breakable` was the bug:
        // a chain of plain calls never reached the vertical loop at all, and the comment drifted to
        // whatever flush point up the tree ran next — landing inside a LATER link's own parentheses
        // whenever that link broke for its own reasons, not merely "lost."
        let has_connector_comment = links.iter().any(|l| l.has_connector_comment());
        // THE ATTEMPT IS SKIPPED, NOT MADE AND DISCARDED, when a comment has already decided the
        // outcome — the same discipline `bracketed` applies to `must_break`. It used to be printed
        // and then unconditionally rewound: speculation whose result could never be kept.
        if !has_connector_comment {
            let mark = self.mark();
            // COUNTED ONLY WHEN `breakable`. A non-breakable chain has no vertical form to fall back
            // to, so this is not an attempt at all — whatever it prints is KEPT, including an argument
            // list that broke internally, and a nested construct must not abort inside it.
            self.speculating += usize::from(breakable);
            // A `Binary` or `Lambda` base would re-parse as something else without parens: `|x| x (1)`
            // reads the call as part of the lambda body.
            self.expr_prec(cur, ATOM_BP);
            let mut fits_inline = self.fits_inline_since(mark);
            for link in &links {
                // Stop as soon as the attempt is doomed — `fits_inline_since` is monotone. Gated on
                // `breakable` because a non-breakable chain keeps what it prints and must finish.
                if breakable && !fits_inline {
                    break;
                }
                match *link {
                    Link::Call(args, region, _) => self.args(args, region),
                    Link::Method(name, args, region, _) => {
                        self.out.push('.');
                        self.out.push_str(name);
                        self.args(args, region);
                    }
                }
                fits_inline = self.fits_inline_since(mark);
            }
            self.speculating -= usize::from(breakable);
            if !breakable || fits_inline {
                return;
            }
            self.rewind(mark);
        }
        if self.abort_if_speculating() {
            return;
        }
        self.expr_prec(cur, ATOM_BP);
        self.last_end = cur.span().end;
        self.level += 1;
        for link in &links {
            // Flush a connector comment now, BEFORE this link's own newline below ends the previous
            // line — the same ordering `flush_before`'s doc requires for a trailing comment to land on
            // the line it trails rather than the one after it.
            self.flush_before(link.region().start, false);
            match *link {
                Link::Call(args, region, _) => {
                    // A plain `Call` link glues to whatever the previous link printed — there is
                    // nowhere in `f(1)(2)` to put a newline for width, so it never opens a line of its
                    // own. The one exception is not remembered here any more: `flush_before` has
                    // already ended the line if it emitted a connector comment, so column 0 is the
                    // signal, and all that is left to decide is the indent. This arm is where the
                    // obligation was forgotten once — `xs.first(1) // note\n(2).second(3)` printed
                    // `// note(2)` and reparsed with the `(2)` call gone.
                    if self.col() == 0 {
                        self.indent();
                    }
                    self.args(args, region);
                }
                Link::Method(name, args, region, _) => {
                    self.end_line();
                    self.indent();
                    self.out.push('.');
                    self.out.push_str(name);
                    self.args(args, region);
                }
            }
            self.last_end = link.region().end;
        }
        self.level -= 1;
    }

    fn list(&mut self, items: &[Expr], span: Span) {
        self.bracketed('[', ']', items, span);
    }

    fn args(&mut self, args: &[Expr], region: Span) {
        self.bracketed('(', ')', args, region);
    }

    /// A bracketed, comma-separated element sequence.
    ///
    /// Prints the inline form, and truncates back to `mark` when it overruns. That reuses ONE
    /// traversal rather than adding a measuring printer beside the real one — the
    /// "second parallel implementation" shape `analysis.rs`'s module doc treats as a defect rather
    /// than a style choice.
    ///
    /// Lists and argument lists use the SAME fill/vertical decision. The design's recollection (§6
    /// rule 3, struck through by §13) was that rustfmt packs short elements in an array literal but
    /// never in an argument list; the "long argument list" case in
    /// `examples/rustfmt_calibration_probe.rs` measured otherwise — under this
    /// project's `use_small_heuristics = "Max"`, rustfmt fills a short-element argument list exactly
    /// like an array, at the identical `SHORT_ELEMENT` width threshold. So there is one rule here, not
    /// one per caller, and `allow_fill` (a parameter that would now be `true` at both call sites) is
    /// gone rather than kept as a vestige of the wrong recollection.
    ///
    /// `region` is the span `must_break` tests for a comment: the bracket-to-bracket range, NOT a
    /// range reconstructed from `items`. A range built from `items.first().span().start ..
    /// items.last().span().end` misses a comment sitting between a bracket and its nearest element —
    /// which then prints on the (never-flushing) inline path and resurfaces far away, at the next
    /// flush point. Each caller derives `region` from the AST span it already carries, not from the
    /// elements:
    ///   * `Expr::List { span, .. }` — `span` already runs bracket-to-bracket; passed straight through.
    ///   * `Expr::Call` and `Expr::Method` — the open paren's offset is NOT in the AST, so
    ///     `postfix_chain` recovers it with `open_paren_after(prev_end)` and passes
    ///     `open_paren .. span.end`.
    ///
    /// **THE PREVIOUS TWO BULLETS SAID `callee.span().end .. span.end` AND `recv.span().end ..
    /// span.end`, AND CALLED THE WIDTH "HARMLESS: A COMMENT CANNOT OCCUR INSIDE AN IDENTIFIER OR ITS
    /// LEADING `.`."** A comment cannot, but the zone those regions covered is not an identifier — it
    /// is everything between one link's end and the next link's `(`, which is exactly where a
    /// connector comment sits. `xs.first(1) // note` put the comment inside `.second`'s region, forced
    /// `.second`'s argument list to break, and printed it after `.second`'s `(`. The scan replaced
    /// those bullets; the claim outlived the code it justified by four commits, so it is written down
    /// here as the third rationale on this branch that read as a reason and was not one (design §13,
    /// §14, §15). `postfix_chain`'s `Link` doc cross-references this list.
    fn bracketed(&mut self, open: char, close: char, items: &[Expr], region: Span) {
        // A COMMENT ANYWHERE INSIDE FORCES THE BREAK, and the inline attempt is skipped rather than
        // made and discarded: `//` runs to end of line, so an inline form holding a comment is not an
        // ugly candidate to measure, it is a different program.
        //
        // COMPUTED BEFORE THE EMPTY CASE, WHICH IS THE HALF §14 DID NOT COVER. `[ // inside\n]` and
        // `f( // inside\n)` hold a comment and have no elements, and the empty early-return used to
        // run first — so §7's forced break was skipped for exactly the constructs whose entire content
        // IS the comment. It escaped its own brackets and reattached to whatever flushed next
        // (`"let xs = []; // inside"`), which the anchoring property sees as depth 1 dropping to 0.
        let must_break = self.contains_comment(region);
        if items.is_empty() {
            self.out.push(open);
            if must_break {
                // `first = true`: nothing is kept just inside a bracket, exactly as for `{`.
                self.level += 1;
                let flushed = self.flush_before(region.end, true);
                self.level -= 1;
                // GUARDED ON WHAT WAS ACTUALLY EMITTED, not on `must_break` alone. `must_break` asks
                // whether a comment starts inside `region`; by the time this runs the cursor may have
                // already passed it (flushed from an enclosing sibling's overrun — see
                // `vertical_rows`'s `close` clamp). Indenting unconditionally then pushed four columns
                // of whitespace between `open` and `close` with nothing between them to justify it.
                if flushed {
                    self.indent();
                }
            }
            self.out.push(close);
            return;
        }
        let mark = self.mark();
        if !must_break {
            self.out.push(open);
            self.speculating += 1;
            let mut fits = true;
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    self.out.push_str(", ");
                }
                self.expr_prec(item, 0);
                // Stop as soon as the attempt is doomed: `fits_inline_since` is monotone, so it
                // cannot recover, and every further element is a full print the `rewind` below
                // discards.
                if !self.fits_inline_since(mark) {
                    fits = false;
                    break;
                }
            }
            self.speculating -= 1;
            if fits {
                self.out.push(close);
                // The close bracket is the one character the loop could not account for.
                if self.col() <= self.width {
                    return;
                }
            }
            self.rewind(mark);
        }
        // This construct is about to write newlines. If an enclosing attempt is in progress it will
        // discard them, so say so and stop rather than printing a whole subtree to be thrown away.
        if self.abort_if_speculating() {
            return;
        }
        // Fill packs several elements per row, which puts a trailing comment mid-row. Vertical rows
        // are the only shape that can carry one, so a comment rules fill out.
        let fill = !must_break && items.iter().all(|item| width_of(item) <= SHORT_ELEMENT);
        self.out.push(open);
        self.level += 1;
        if fill {
            self.fill_rows(items);
        } else {
            // `region.end` is THIS construct's own closing bracket — see `vertical_rows`'s `close`
            // parameter for why the last element's trailing flush needs it.
            self.vertical_rows(items, true, region.end);
        }
        self.level -= 1;
        self.end_line();
        self.indent();
        self.out.push(close);
    }

    /// As many elements per row as fit, `", "`-separated, ending in a trailing comma. The design's
    /// recollection (§6 rule 4, struck through by §13) was that fill mode had no trailing comma; the
    /// "long list of short elements" case
    /// in `examples/rustfmt_calibration_probe.rs` measured rustfmt adding one after the final element
    /// even in fill mode, same as vertical mode.
    ///
    /// Reserves one extra column beyond the element itself: breaking a row appends a single `,` to
    /// terminate it, so a row that were allowed to pack all the way to `MAX_WIDTH` would overflow by
    /// that comma the moment the *next* element doesn't fit. `+ 1` here keeps every row a byte short
    /// of the edge so the comma always lands inside budget — the same margin that leaves room for the
    /// unconditional trailing comma appended after the loop below.
    fn fill_rows(&mut self, items: &[Expr]) {
        self.newline();
        self.indent();
        for (i, item) in items.iter().enumerate() {
            if i > 0 {
                // `saturating_add`: `width_of` returns `usize::MAX` as its own-line sentinel, and
                // plain `+` would overflow on it. Unreachable today — `fill` requires every element
                // `<= SHORT_ELEMENT` — but this keeps it that way if `fill`'s predicate ever loosens.
                if self.col().saturating_add(width_of(item)).saturating_add(3) > self.width {
                    self.out.push(',');
                    self.newline();
                    self.indent();
                } else {
                    self.out.push_str(", ");
                }
            }
            self.expr_prec(item, 0);
        }
        self.out.push(',');
    }

    /// One element per row, each comma-terminated.
    ///
    /// `i == 0` IS THE `first` FLAG, not `false`. §5's "no blank line just inside a brace" was
    /// implemented for `{` (by `block_body` and `program` threading their own loop flag) and for
    /// nothing else: hardcoding `false` here left `open_line` measuring the gap from the previous
    /// STATEMENT's end to the first element's start, a range that crosses the `[` or `(` and the
    /// newline after it, so any list broken across lines gained a blank line just inside its own
    /// bracket. It survived review because it needs a comment to force the break AND a statement in
    /// front of the list, and every corpus entry with a bracket comment was the file's first statement.
    ///
    /// `close` is the CONSTRUCT'S OWN closing bracket offset (`bracketed`'s `region.end`), not derived
    /// from `items`. It bounds the last element's trailing flush the same way `n.span().start` bounds
    /// every other element's: for `i + 1 < items.len()` the next SIBLING already caps how far a
    /// trailing comment can be pulled forward, but the last element has no next sibling, and
    /// `usize::MAX` used to stand in for one. §17: when the source puts a later CONSTRUCT — not
    /// element, a sibling of the whole bracketed thing one level up — on the same line,
    /// `next_boundary`'s "end of the line in the original source" runs past this construct's own `]`
    /// or `)` and pulls that later construct's comment in here instead. `contains_comment` is
    /// position-based, so the construct the comment actually belonged to still sees it in its own span
    /// and forces a break for a comment `flush_before` has already emitted elsewhere — a break with
    /// nothing left to flush, present on pass 1 and gone on pass 2 once the comment has moved.
    fn vertical_rows(&mut self, items: &[Expr], trailing_comma: bool, close: usize) {
        for (i, item) in items.iter().enumerate() {
            self.open_line(item.span().start, i == 0);
            self.expr_prec(item, 0);
            if trailing_comma || i + 1 < items.len() {
                self.out.push(',');
            }
            self.last_end = item.span().end;
            // A comment trailing THIS element sits before the next element's start; flushing it here
            // keeps it on this row. For the last element there is no next element, so `close` — this
            // construct's own bracket, not a later sibling's — is the bound instead.
            let upto = items.get(i + 1).map_or(close, |n| n.span().start);
            self.flush_before(upto.min(self.next_boundary(item)), false);
        }
    }

    /// The offset past which a comment no longer belongs to `item`'s row: the end of the line `item`
    /// ends on, in the ORIGINAL source.
    ///
    /// `get` rather than indexing — a span end that is not a char boundary would panic on a slice,
    /// and the no-panic-on-user-input rule holds here as everywhere else.
    fn next_boundary(&self, item: &Expr) -> usize {
        let end = item.span().end;
        self.src.get(end..).and_then(|rest| rest.find('\n')).map_or(self.src.len(), |off| end + off)
    }

    /// `{` on the current line, body indented, `}` at the introducer's indent. Leaves the cursor
    /// immediately after `}` so `} else {` can continue on the same line.
    fn braced(&mut self, block: &Block) {
        // A block ALWAYS breaks — `block_body` opens a line for every item and `}` gets its own —
        // so an enclosing inline attempt holding one is doomed before the body is printed at all.
        if self.abort_if_speculating() {
            return;
        }
        self.out.push('{');
        self.level += 1;
        self.block_body(block);
        self.level -= 1;
        self.end_line();
        self.indent();
        self.out.push('}');
    }

    fn if_chain(&mut self, cond: &Expr, then_blk: &Block, else_blk: &Block) {
        self.out.push_str("if ");
        self.expr_prec(cond, 0);
        self.out.push(' ');
        self.braced(then_blk);
        self.out.push_str(" else ");
        // NOT collapsed into `else if cond { … }`, even though rustfmt would: `else { if c {…} else
        // {…} }` and `else if c {…} else {…}` are the same tree only in a grammar where `else if` is
        // itself valid syntax. This one's is not — `parser.rs`'s `If` arm always requires a literal `{`
        // immediately after `else` (`expect(TokenKind::Else)` then `parse_braced_block()`, no special
        // case for a following `if`) — so the collapsed text is not a reformatting of the input, it is
        // a program this parser rejects. §7's invariant ("output always reparses") binds here just as
        // much as it does for comments; always bracing the nested `if` is what keeps it true.
        self.braced(else_blk);
    }
}

/// Printed width of one element, standalone.
///
/// Printed alone rather than sliced out of the inline attempt: elements are separated by `", "`
/// there, and an element's own text can contain `", "` too, so splitting the string would mis-measure
/// any list holding a call or a nested list.
fn width_of(item: &Expr) -> usize {
    let mut probe = Printer::new("", &[]);
    // The probe speculates from its first byte. This measurement is only ever compared against
    // `SHORT_ELEMENT`, and an element that cannot render on one line is not short by any reading —
    // so there is nothing to learn from printing its broken form, and printing it re-does the
    // caller's own work once per nesting level, which is the cost `speculating` exists to remove.
    probe.speculating = 1;
    probe.expr_prec(item, 0);
    if probe.line_start > 0 { usize::MAX } else { probe.out.len() }
}

fn bp_of(e: &Expr) -> u8 {
    match e {
        Expr::Binary { op, .. } => bp_of_op(*op),
        // A lambda body runs as far as it can, so a lambda in operand position always parenthesises.
        Expr::Lambda { .. } => 0,
        _ => ATOM_BP,
    }
}

/// Mirrors `parser::infix_op`'s binding powers. The two tables are pinned against each other by
/// `binding_powers_match_the_parser` below, because a printer that disagrees with its parser about
/// precedence emits programs that mean something else.
fn bp_of_op(op: BinOp) -> u8 {
    match op {
        BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge => 1,
        BinOp::Add | BinOp::Sub => 2,
        BinOp::Mul => 3,
    }
}

fn op_text(op: BinOp) -> &'static str {
    match op {
        BinOp::Add => "+",
        BinOp::Sub => "-",
        BinOp::Mul => "*",
        BinOp::Eq => "==",
        BinOp::Ne => "!=",
        BinOp::Lt => "<",
        BinOp::Le => "<=",
        BinOp::Gt => ">",
        BinOp::Ge => ">=",
    }
}

impl<'a> Printer<'a> {
    /// True when the author left at least one blank line between `prev_end` and `next_start`.
    /// Total: a reversed or out-of-range pair reads as no blank line rather than panicking.
    fn blank_between(&self, prev_end: usize, next_start: usize) -> bool {
        self.src.get(prev_end..next_start).is_some_and(|gap| gap.matches('\n').count() >= 2)
    }

    /// Comment text with trailing whitespace trimmed. A CRLF line ending leaves a `\r` inside the
    /// span (see `token::Comment`), and rustfmt trims trailing space; both are this one call.
    ///
    /// Returns `&'a str` — tied to `src`, not to `&self` — so the borrow does not overlap the `&mut
    /// self` writes `flush_before` makes right after reading it; eliding the lifetime here ties the
    /// return to `&self` instead and that borrow does span those writes.
    fn comment_text(&self, c: Comment) -> &'a str {
        self.src.get(c.span.start..c.span.end).unwrap_or("").trim_end()
    }

    /// Is there a comment, NOT YET EMITTED, anywhere inside `span`? A construct that holds one must
    /// break, because a comment printed mid-line would comment out the rest of that line.
    ///
    /// `self.next..` — CURSOR-BOUNDED, not a scan of every comment in the file. `span` is
    /// POSITION-based (bracket-to-bracket source offsets) while `self.next` is where printing actually
    /// stands; a comment already flushed still has a `span.start` inside some later sibling's range
    /// (the source doesn't know it moved), so an unbounded scan finds it there too and forces that
    /// sibling to break for a comment `flush_before` has already emitted elsewhere. §17: this is what
    /// let `vertical_rows`'s stale-boundary bug (see its `close` parameter) turn into a spurious
    /// break instead of a silent one — the two only agree once both ask where the CURSOR is.
    fn contains_comment(&self, span: Span) -> bool {
        self.comments[self.next.min(self.comments.len())..]
            .iter()
            .any(|c| c.span.start >= span.start && c.span.start < span.end)
    }

    /// The offset of the first `(` at or after `from`, skipping any `(` that falls inside a comment —
    /// a comment's text can itself contain one (`xs // (\n.first(1)` is legal input), and a naive
    /// `str::find('(')` would land inside it and produce a region that is too wide in a different way.
    ///
    /// Used to recover a `Call`/`Method` argument list's own bracket-to-bracket span for `bracketed`'s
    /// `region` — see `bracketed`'s doc comment. The open bracket's offset is not stored in the AST.
    ///
    /// Total: falls back to `from` if no `(` is found before the end of `src`. That should be
    /// unreachable for a well-formed `Call`/`Method` (both always have an argument list), but the
    /// no-panic-on-user-input rule holds here as everywhere else, and `get` rather than indexing keeps
    /// it that way even if `from` is not a char boundary.
    fn open_paren_after(&self, from: usize) -> usize {
        let mut i = from;
        loop {
            let Some(rest) = self.src.get(i..) else { return from };
            let Some(off) = rest.find('(') else { return from };
            let candidate = i + off;
            match self.comments.iter().find(|c| c.span.start <= candidate && candidate < c.span.end) {
                Some(c) => i = c.span.end,
                None => return candidate,
            }
        }
    }

    /// Emit every comment starting before `upto`.
    ///
    /// CALLED BEFORE THE PREVIOUS LINE IS TERMINATED, and that is what makes a trailing comment
    /// possible at all: a trailing comment's span starts after the preceding construct and before the
    /// next one, so the same cursor finds both kinds at the same moment. A flush that ran after the
    /// newline could only ever produce own-line comments.
    ///
    /// EMITTING A COMMENT ALWAYS ENDS THE LINE, and THIS function is what ends it. `//` runs to end of
    /// line, so anything written after one on the same line is inside it. §7 always described that as
    /// structural; until the final review it was not — the newline lived at all five call sites, and
    /// the sixth kind of call site (`postfix_chain`'s `Link::Call`) is the one that forgot it and
    /// silently deleted a call from the program. The POSTCONDITION is now: if this returns `true`,
    /// `out` ends with a newline. Callers therefore ask `end_line()`/`col() == 0` rather than pushing
    /// a newline they may or may not need.
    ///
    /// Returns whether it emitted anything, which is what lets `open_line` tell "first thing in this
    /// block" from "first CONSTRUCT in this block, but a comment already opened it".
    fn flush_before(&mut self, upto: usize, first: bool) -> bool {
        let mut first = first;
        let mut emitted = false;
        while self.next < self.comments.len() && self.comments[self.next].span.start < upto {
            let c = self.comments[self.next];
            self.next += 1;
            if c.own_line {
                // Terminate the open line FIRST, then add the author's blank line on top of it. At
                // column 0 — an empty buffer, or the newline the previous comment in this same loop
                // wrote — there is no line to terminate, and terminating one that does not exist
                // would print a blank line above the file's first byte.
                self.end_line();
                if !first && self.blank_between(self.last_end, c.span.start) {
                    self.newline();
                }
                self.indent();
            } else if self.col() == 0 {
                // A comment the lexer classified as trailing, reached at column 0: the code it trails
                // in the SOURCE is not what precedes it in the OUTPUT — either nothing has been
                // printed yet, or the previous comment in this same loop already ended the line. It
                // opens its own line, so it takes the indent rather than a separating space.
                self.indent();
            } else {
                self.out.push(' ');
            }
            let text = self.comment_text(c);
            self.out.push_str(text);
            // §7 MADE STRUCTURAL. `//` runs to end of line, so anything written after a comment on the
            // same line is inside it — §7 called that "the emit-comment path writes the newline
            // itself, not a case for a caller to remember", and until now every one of the five call
            // sites remembered it instead. One of them forgot: `postfix_chain`'s `Link::Call` arm
            // printed an argument list straight onto a just-flushed comment, and `f(1) // note\n(2)`
            // reparsed with the `(2)` call gone. It is written here now, once.
            self.newline();
            // MONOTONE, never a plain assignment. A comment can start EARLIER in the source than text
            // already printed — a comment in a statement-interior position (between `=` and its value,
            // after `fn`, inside a parameter list) has no flush point of its own, so it is emitted at
            // the next one, by which time the whole statement is already in the buffer. A plain
            // `last_end = c.span.end` then moves the cursor BACKWARDS relative to `out`, and the next
            // `blank_between(last_end, …)` measures a gap that spans real code rather than whitespace —
            // inventing a blank line the author never wrote. Where such a comment RELOCATES to is a
            // separate question this design leaves open (see §17); the invented blank line is not.
            self.last_end = self.last_end.max(c.span.end);
            first = false;
            emitted = true;
        }
        emitted
    }

    /// Open the line for the item at `start`: flush any comments that precede it, then emit the blank
    /// line the author left, then the newline and indent for the item itself.
    ///
    /// `first` suppresses the blank line — nothing is kept just inside a brace or at file start.
    /// A comment flushed just now UNSUPPRESSES it: the comment has already opened the block, so a
    /// blank line between that comment and this construct is the author's and survives. The
    /// suppression must key off what THIS call emitted, not off the cursor's global position — a
    /// cursor that has passed any comment anywhere in the file is never at zero again, and using it
    /// as the test would let a blank line through just inside every brace after the file's first
    /// comment.
    fn open_line(&mut self, start: usize, first: bool) {
        let flushed = self.flush_before(start, first);
        // ORDER MATTERS, and it is the reverse of what it was: terminate the open line first, THEN
        // add the author's blank line on top. Both newlines used to be unconditional pushes, so
        // either order gave two; `end_line` is conditional, so putting it second makes the blank
        // line's own newline close the open line and collapse the pair into one.
        self.end_line();
        if (!first || flushed) && self.blank_between(self.last_end, start) {
            self.newline();
        }
        self.indent();
    }
}

impl Printer<'_> {
    fn block_body(&mut self, block: &Block) {
        let mut first = true;
        for s in &block.stmts {
            self.open_line(s.span().start, first);
            first = false;
            self.stmt(s);
            self.last_end = s.span().end;
        }
        if let Some(tail) = block.tail.as_deref() {
            self.open_line(tail.span().start, first);
            self.expr(tail);
            self.last_end = tail.span().end;
        }
        // Comments between the last item and `}` belong inside the braces, at the body's indent. Pass
        // the loop's own `first` rather than hardcoding `false`: a block that is entirely comments
        // (no statements, no tail) never flips `first` to `false`, and hardcoding it here suppressed
        // that fact, leaking a blank line just inside the brace whenever the author left one.
        self.flush_before(block.span.end, first);
    }

    fn stmt(&mut self, s: &Stmt) {
        self.visit(s.span());
        match s {
            Stmt::Let { name, mutable, value, .. } => {
                self.out.push_str(if *mutable { "let mut " } else { "let " });
                self.out.push_str(name);
                self.out.push_str(" = ");
                self.expr_prec(value, 0);
                self.out.push(';');
            }
            Stmt::Assign { target, value, .. } => {
                self.out.push_str(target);
                self.out.push_str(" = ");
                self.expr_prec(value, 0);
                self.out.push(';');
            }
            Stmt::Fn { name, params, body, .. } => {
                self.out.push_str("fn ");
                self.out.push_str(name);
                self.out.push('(');
                self.out.push_str(&params.join(", "));
                self.out.push_str(") ");
                self.braced(body);
            }
            Stmt::While { cond, body, .. } => {
                self.out.push_str("while ");
                self.expr_prec(cond, 0);
                self.out.push(' ');
                self.braced(body);
            }
            Stmt::Expr(e) => {
                self.expr_prec(e, 0);
                self.out.push(';');
            }
        }
    }

    /// The top-level block: same as `block_body` but with no braces and no leading newline before the
    /// first item.
    fn program(&mut self, program: &Program) {
        let mut first = true;
        for s in &program.block.stmts {
            self.open_first_or_next(s.span().start, &mut first);
            self.stmt(s);
            self.last_end = s.span().end;
        }
        if let Some(tail) = program.block.tail.as_deref() {
            self.open_first_or_next(tail.span().start, &mut first);
            self.expr(tail);
            self.last_end = tail.span().end;
        }
        // Anything after the last construct. `usize::MAX` drains the rest of the cursor. Pass `first`
        // rather than hardcoding `false`, for the same reason as `block_body`'s matching call: a
        // comment-only program never flips `first`, and hardcoding `false` here leaked a blank line
        // above the file's first byte.
        self.flush_before(usize::MAX, first);
        // NOT `end_line()`: the empty program's whole output is this one newline, and an empty buffer
        // is already at column 0. "Ends with exactly one newline" is the rule, so ask the buffer that
        // question directly.
        if !self.out.ends_with('\n') {
            self.newline();
        }
    }

    /// The top level has no braces, so its first item opens the file rather than opening a line.
    fn open_first_or_next(&mut self, start: usize, first: &mut bool) {
        if *first {
            self.flush_before(start, true);
            // Both of the old branches collapse into `end_line`: an empty buffer is at column 0, and
            // so is a buffer a just-flushed comment ended. Nothing else can reach here with `*first`.
            self.end_line();
            self.indent();
        } else {
            self.open_line(start, false);
        }
        *first = false;
    }
}

/// Print a parsed program back to canonical text.
///
/// The output always ends with exactly one newline, and re-parsing it yields a program with the same
/// meaning — see `tests/format_properties.rs` for the properties that hold this to account.
#[must_use]
pub fn print(parsed: &Parsed<'_>) -> String {
    let mut p = Printer::new(parsed.src, &parsed.comments);
    p.program(&parsed.program);
    p.out
}

/// Print `parsed` to a chosen line budget.
///
/// `print` is this at `MAX_WIDTH`. **`width` IS NOT VALIDATED HERE**: core prints to whatever it is
/// given, and what a human may write in a config file is a CLI policy that lives in
/// `redextape-cli`'s `config::WIDTH_RANGE`. Keeping the range in one place is what stops two
/// definitions of "a legal width" drifting apart.
#[must_use]
pub fn print_with_width(parsed: &Parsed<'_>, width: usize) -> String {
    let mut p = Printer::with_width(parsed.src, &parsed.comments, width);
    p.program(&parsed.program);
    p.out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse;

    /// Format a whole program through the public entry point.
    fn f(src: &str) -> String {
        let (parsed, diags) = crate::parser::parse_full(src);
        assert!(diags.is_empty(), "test input must parse: {diags:?}");
        print(&parsed.expect("parses"))
    }

    #[test]
    fn prints_each_statement_kind() {
        assert_eq!(f("let x=1;x"), "let x = 1;\nx\n");
        assert_eq!(f("let mut x=1;x"), "let mut x = 1;\nx\n");
        assert_eq!(f("let mut x=1;x=2;x"), "let mut x = 1;\nx = 2;\nx\n");
        assert_eq!(f("f(1);0"), "f(1);\n0\n");
    }

    #[test]
    fn prints_fn_and_while_without_a_trailing_semicolon() {
        assert_eq!(f("fn f(a,b){a+b} f(1,2)"), "fn f(a, b) {\n    a + b\n}\nf(1, 2)\n");
        assert_eq!(f("fn f(){1} f()"), "fn f() {\n    1\n}\nf()\n");
        assert_eq!(f("let mut x=3; while x>0 { x=x-1; } x"), "let mut x = 3;\nwhile x > 0 {\n    x = x - 1;\n}\nx\n");
    }

    #[test]
    fn nests_blocks_at_four_spaces_per_level() {
        assert_eq!(
            f("fn f(a){ if a > 0 { let b = a; b } else { 0 } } f(1)"),
            "fn f(a) {\n    if a > 0 {\n        let b = a;\n        b\n    } else {\n        0\n    }\n}\nf(1)\n"
        );
    }

    #[test]
    fn output_ends_with_exactly_one_newline() {
        for src in ["1", "let x = 1; x", "fn f(){1} f()"] {
            let out = f(src);
            assert!(out.ends_with('\n'), "{src:?} -> {out:?}");
            assert!(!out.ends_with("\n\n"), "{src:?} -> {out:?}");
        }
    }

    // `output_ends_with_exactly_one_newline` above only rules out a *trailing* extra newline; a
    // spurious *leading* one (e.g. tail-only "1" printing as "\n1\n") would satisfy both of its
    // checks. `prints_each_statement_kind` etc. only exercise programs that start with a statement,
    // so `program`'s "no leading newline before the first item" branch for a tail-only program, a
    // statement-only program with no tail, and the empty program are otherwise never pinned. These
    // three assert the exact output for each shape.
    #[test]
    fn program_has_no_leading_newline_for_a_tail_only_program() {
        assert_eq!(f("1"), "1\n");
    }

    #[test]
    fn program_has_no_leading_newline_for_a_statement_with_no_tail() {
        assert_eq!(f("let x = 1;"), "let x = 1;\n");
    }

    #[test]
    fn the_empty_program_prints_a_single_newline() {
        // The empty string parses to a `Block` with no statements and no tail (the parser's `while`
        // loop over `parse_block_body` never runs), so `program` skips both loops and falls straight
        // to its unconditional trailing `newline()`.
        assert_eq!(f(""), "\n");
    }

    /// Print the tail expression of a one-expression program, driving `Printer` directly rather than
    /// going through `print`. `f` above is the whole-program helper; this one exists so an expression
    /// test asserts the expression's own text without a trailing newline or a program's framing.
    fn p(src: &str) -> String {
        let (program, diags) = parse(src);
        assert!(diags.is_empty(), "test input must parse: {diags:?}");
        let program = program.expect("parses");
        let tail = program.block.tail.as_ref().expect("test inputs are a single tail expression");
        let mut pr = Printer::new(src, &[]);
        pr.expr(tail);
        pr.out
    }

    #[test]
    fn prints_leaves() {
        assert_eq!(p("42"), "42");
        assert_eq!(p("true"), "true");
        assert_eq!(p("false"), "false");
        assert_eq!(p("some_name"), "some_name");
    }

    #[test]
    fn prints_binary_with_spaces_and_no_redundant_parens() {
        assert_eq!(p("1+2"), "1 + 2");
        assert_eq!(p("1 + 2 * 3"), "1 + 2 * 3");
        assert_eq!(p("1 - 2 - 3"), "1 - 2 - 3");
        assert_eq!(p("1 == 2"), "1 == 2");
        // `op_text` is a per-operator lookup table, not a shared match arm the way `bp_of_op` groups
        // all six comparisons into one arm — there, sampling `Eq` and `Gt` genuinely proxies for the
        // rest because they share code. Here they don't: a transposition typo on any untested line
        // (e.g. `Le => "<"`) would silently print a program that computes something else, and nothing
        // would catch it. So every operator's text is enumerated one by one rather than sampled. `>`
        // (`Gt`) is exercised by the `if` tests below; the remaining eight are asserted here.
        assert_eq!(p("1 != 2"), "1 != 2");
        assert_eq!(p("1 < 2"), "1 < 2");
        assert_eq!(p("1 <= 2"), "1 <= 2");
        assert_eq!(p("1 >= 2"), "1 >= 2");
    }

    #[test]
    fn re_adds_the_parens_the_ast_does_not_store() {
        assert_eq!(p("(1 + 2) * 3"), "(1 + 2) * 3");
        assert_eq!(p("1 * (2 + 3)"), "1 * (2 + 3)");
        // Left-associative, so the right operand of a same-precedence op needs parens and the left
        // does not.
        assert_eq!(p("1 - (2 - 3)"), "1 - (2 - 3)");
        assert_eq!(p("(1 - 2) - 3"), "1 - 2 - 3");
    }

    #[test]
    fn prints_lists_calls_methods_and_lambdas() {
        assert_eq!(p("[1, 2, 3]"), "[1, 2, 3]");
        assert_eq!(p("[]"), "[]");
        assert_eq!(p("f(1, 2)"), "f(1, 2)");
        assert_eq!(p("f()"), "f()");
        assert_eq!(p("xs.map(|x| x + 1)"), "xs.map(|x| x + 1)");
        assert_eq!(p("|x, y| x + y"), "|x, y| x + y");
        assert_eq!(p("|| 1"), "|| 1");
    }

    #[test]
    fn a_lambda_used_as_an_operand_or_a_callee_is_parenthesised() {
        // A lambda body is greedy, so `(|x| x) + 1` would re-parse as `|x| (x + 1)` without parens.
        assert_eq!(p("(|x| x) + 1"), "(|x| x) + 1");
        assert_eq!(p("(|x| x)(1)"), "(|x| x)(1)");
    }

    #[test]
    fn prints_if_as_an_expression() {
        assert_eq!(p("if a > b { 1 } else { 2 }"), "if a > b {\n    1\n} else {\n    2\n}");
    }

    #[test]
    fn a_nested_if_in_an_else_stays_fully_braced() {
        // NOT collapsed to `else if b { … }`: this grammar has no such sugar (`parser.rs`'s `If` arm
        // requires a literal `{` right after `else`), so the collapsed text would not reparse. Design
        // doc §15 — see `if_chain`'s doc.
        let out = p("if a { 1 } else { if b { 2 } else { 3 } }");
        assert_eq!(out, "if a {\n    1\n} else {\n    if b {\n        2\n    } else {\n        3\n    }\n}");
        let (program, diags) = parse(&out);
        assert!(diags.is_empty(), "nested if-in-else must reparse: {diags:?}\n{out}");
        assert!(program.is_some());
    }

    #[test]
    fn a_long_left_nested_chain_does_not_overflow_the_stack() {
        // `parse_binary_inner` climbs precedence in a LOOP, so this builds a `Binary` tree 20,000
        // deep while the parser's own recursion depth stays at one. `ast.rs`'s hand-written iterative
        // `Drop` exists for exactly this shape and records that the recursive version aborts the
        // process. A recursive printer has the identical defect, so this test is the guard on it.
        let src = std::iter::repeat_n("1", 20_000).collect::<Vec<_>>().join(" + ");
        let out = p(&src);
        assert_eq!(out, src);
    }

    #[test]
    fn a_long_postfix_chain_does_not_overflow_the_stack() {
        // Long chains break one `.method(…)` per line (§6 rule 5), so `out` is not byte-identical to
        // `src` — that is the feature working, not a regression. What this test actually guards is
        // stack safety (an overflow here aborts the process rather than failing an assertion, so a
        // silent abort is the failure mode to watch for) and that no link is lost or duplicated while
        // walking the 20,000-deep spine.
        let src = format!("x{}", ".f()".repeat(20_000));
        let out = p(&src);
        assert_eq!(out.matches(".f()").count(), 20_000, "every link survives: {} chars of output", out.len());
        assert!(
            out.lines().all(|l| l.len() <= MAX_WIDTH),
            "no line over the budget — a per-iteration `level` increment would compound over 20,000 \
             links and this is the only test long enough to notice"
        );
    }

    #[test]
    fn the_visit_order_is_non_decreasing_in_span_start() {
        // The load-bearing assumption of the whole trivia design (spec §4): a single forward cursor
        // into a sorted comment list is only correct while the printer visits nodes in source order.
        for src in [
            "f(a + b, [1, 2]).g(|x| x * 2)".to_string(),
            // Wide enough to overrun MAX_WIDTH and force `bracketed`'s rewind-then-reprint fallback:
            // the speculative inline attempt visits every item once, then the fill/vertical reprint
            // visits the same items again. If `visited` does not rewind with the buffer, the second
            // pass's first item goes backwards from the first pass's last item.
            format!("[{}]", (0..80).map(|i| i.to_string()).collect::<Vec<_>>().join(", ")),
        ] {
            let (program, _) = parse(&src);
            let program = program.expect("parses");
            let mut pr = Printer::new(&src, &[]);
            pr.expr(program.block.tail.as_ref().expect("tail"));
            assert!(
                pr.visited.windows(2).all(|w| w[0].start <= w[1].start),
                "visit order went backwards for {src:?}: {:?}",
                pr.visited
            );
        }
    }

    #[test]
    fn a_short_list_stays_inline() {
        assert_eq!(f("[1, 2, 3]"), "[1, 2, 3]\n");
    }

    #[test]
    fn a_list_of_short_elements_fills_when_it_does_not_fit() {
        let src = format!("[{}]", (0..80).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
        let out = f(&src);
        assert!(out.starts_with("[\n    "), "fill mode indents its first row: {out:?}");
        assert!(out.lines().all(|l| l.len() <= MAX_WIDTH), "no line over the budget: {out:?}");
        let body: Vec<&str> = out.lines().filter(|l| l.starts_with("    ")).collect();
        assert!(body.len() > 1, "it broke into rows: {out:?}");
        assert!(body[0].matches(',').count() > 1, "fill puts several elements on a row: {body:?}");
        // §6 rule 4's recollection was that fill mode had no trailing comma; the probe measured
        // rustfmt adding one after the final element in fill mode too. See `fill_rows`'s doc comment.
        assert!(out.contains(",\n]"), "fill mode adds a trailing comma: {out:?}");
    }

    #[test]
    fn fill_switches_to_one_per_line_at_the_short_element_boundary() {
        // SHORT_ELEMENT is 10, checked against an element's PRINTED width via `width_of`, not its
        // source length — but for a bare identifier the two coincide, so `.repeat(width)` controls
        // it exactly. Twelve identifiers, one repeated letter each, so the width is visible at the
        // call site: `.repeat(10)` sits exactly at the boundary, `.repeat(11)` is one column past it.
        //
        // Inline length in both cases is `2` (brackets) + `12 * width` (elements) + `11 * 2` (", "
        // separators): 2 + 120 + 22 = 144 at width 10, 2 + 132 + 22 = 156 at width 11. Both exceed
        // MAX_WIDTH (120), so both must break — the boundary under test is only in HOW they break.
        let names = |width: usize| -> Vec<String> {
            (0..12u8).map(|i| ((b'a' + i) as char).to_string().repeat(width)).collect()
        };

        let ten = names(10);
        assert!(ten.iter().all(|s| s.len() == 10), "verify the width actually built: {ten:?}");
        let out = f(&format!("[{}]", ten.join(", ")));
        let body: Vec<&str> = out.lines().filter(|l| l.starts_with("    ")).collect();
        assert!(body.len() > 1, "it broke into rows: {out:?}");
        assert!(body[0].matches(',').count() > 1, "width-10 elements still fill: {body:?}");
        assert!(out.contains(",\n]"), "fill mode adds a trailing comma: {out:?}");

        let eleven = names(11);
        assert!(eleven.iter().all(|s| s.len() == 11), "verify the width actually built: {eleven:?}");
        let out = f(&format!("[{}]", eleven.join(", ")));
        let rows: Vec<&str> = out.lines().filter(|l| l.starts_with("    ")).collect();
        assert_eq!(rows.len(), 12, "width-11 elements break one per line: {out:?}");
        assert!(out.contains(",\n]"), "vertical mode adds a trailing comma: {out:?}");
    }

    #[test]
    fn a_construct_breaks_only_once_it_passes_the_width_budget() {
        // A single-element list as the whole program (a tail expression, so it starts at column 0
        // with no indentation), giving `[` + identifier + `]` as the full line. An 118-character
        // identifier makes that 2 + 118 = 120, exactly MAX_WIDTH; a 119-character one makes it
        // 2 + 119 = 121, one column over.
        let at_budget = "a".repeat(118);
        let out = f(&format!("[{at_budget}]"));
        assert_eq!(out, format!("[{at_budget}]\n"), "fits exactly at the budget, stays inline: {out:?}");
        assert_eq!(out.lines().next().unwrap().len(), MAX_WIDTH);

        let over_budget = "a".repeat(119);
        let out = f(&format!("[{over_budget}]"));
        assert_eq!(out, format!("[\n    {over_budget},\n]\n"), "one column past the budget, breaks: {out:?}");
    }

    #[test]
    fn a_list_with_a_wide_element_breaks_one_per_line_with_a_trailing_comma() {
        let wide = "a_rather_long_name";
        let src = format!("[{}]", std::iter::repeat_n(wide, 12).collect::<Vec<_>>().join(", "));
        let out = f(&src);
        let rows: Vec<&str> = out.lines().filter(|l| l.starts_with("    ")).collect();
        assert_eq!(rows.len(), 12, "one element per row: {out:?}");
        assert!(rows.iter().all(|r| r.ends_with(',')), "every row is comma-terminated: {rows:?}");
        assert!(out.contains(",\n]"), "vertical mode adds a trailing comma: {out:?}");
    }

    #[test]
    fn short_arguments_fill_the_same_as_short_list_elements() {
        // §6 rule 3 was "arguments never fill, only lists do" — `examples/rustfmt_calibration_probe.rs`'s
        // "long argument list" case measured rustfmt filling a short-element argument list exactly
        // like an array, under this project's `use_small_heuristics = "Max"`. Mirrors
        // `a_list_of_short_elements_fills_when_it_does_not_fit` with `f(...)` in place of `[...]`.
        let src = format!("f({})", (0..80).map(|i| i.to_string()).collect::<Vec<_>>().join(", "));
        let out = f(&src);
        assert!(out.starts_with("f(\n    "), "fill mode indents its first row: {out:?}");
        assert!(out.lines().all(|l| l.len() <= MAX_WIDTH), "no line over the budget: {out:?}");
        let body: Vec<&str> = out.lines().filter(|l| l.starts_with("    ")).collect();
        assert!(body.len() > 1, "it broke into rows: {out:?}");
        assert!(body[0].matches(',').count() > 1, "fill puts several arguments on a row: {body:?}");
        assert!(out.contains(",\n)"), "fill mode adds a trailing comma: {out:?}");
    }

    #[test]
    fn wide_arguments_break_one_per_line_with_a_trailing_comma() {
        // Mirrors `a_list_with_a_wide_element_breaks_one_per_line_with_a_trailing_comma`: elements
        // over `SHORT_ELEMENT` force vertical mode in an argument list too, same as an array literal —
        // the probe's calibration only moved WHICH lists fill, not what happens once elements are wide.
        let wide = "a_rather_long_name";
        let src = format!("f({})", std::iter::repeat_n(wide, 12).collect::<Vec<_>>().join(", "));
        let out = f(&src);
        let rows: Vec<&str> = out.lines().filter(|l| l.starts_with("    ")).collect();
        assert_eq!(rows.len(), 12, "one argument per row: {out:?}");
        assert!(rows.iter().all(|r| r.ends_with(',')), "every row is comma-terminated: {rows:?}");
        assert!(out.contains(",\n)"), "vertical mode adds a trailing comma: {out:?}");
    }

    #[test]
    fn no_line_exceeds_the_budget_for_a_breakable_construct() {
        let src = format!("f({})", (0..300).map(|i| format!("x{i}")).collect::<Vec<_>>().join(", "));
        assert!(f(&src).lines().all(|l| l.len() <= MAX_WIDTH));
    }

    /// `depth` single-element list wrappers around a list wide enough that the innermost must break.
    /// Every level is then a construct whose inline attempt is doomed by the level below it.
    fn nested_lists(depth: usize) -> String {
        let mut s = format!("[{}]", (0..12).map(|i| format!("aaaaaaaaaaa{i}")).collect::<Vec<_>>().join(", "));
        for _ in 0..depth {
            s = format!("[{s}]");
        }
        s
    }

    /// `expr_prec` entries for a whole program — the work counter, including work later discarded.
    fn print_work(src: &str) -> usize {
        let (program, diags) = parse(src);
        assert!(diags.is_empty(), "test input must parse: {diags:?}");
        let mut pr = Printer::new(src, &[]);
        pr.program(&program.expect("parses"));
        pr.prints
    }

    #[test]
    fn a_nested_construct_that_breaks_breaks_the_one_around_it() {
        // `postfix_chain` explained at length why `col()` alone is not the fit question — a nested
        // construct that broke internally leaves a SHORT final line even though the attempt was never
        // one line — and then `bracketed`, the nested construct in question, asked only `col()`. The
        // result was the half-broken hybrid: the inner list vertical, the outer one still inline.
        // rustfmt breaks the outer list at this repo's settings, so this follows it.
        let wide = (1..=8).map(|i| i.to_string().repeat(13)).collect::<Vec<_>>().join(", ");
        let out = f(&format!("let xs = [[{wide}], 2];\nxs"));
        assert!(!out.contains("[["), "the outer list must break too, not stay inline around a broken inner: {out:?}");
        assert!(out.starts_with("let xs = [\n    [\n"), "{out:?}");
        assert!(out.contains("\n    ],\n    2,\n];\n"), "{out:?}");
        // Same rule for the other constructs that always break: a block and an `if` as list elements.
        assert_eq!(f("[{ 1 }, { 2 }]"), "[\n    {\n        1\n    },\n    {\n        2\n    },\n]\n");
        assert_eq!(
            f("[if 1 > 0 { 1 } else { 2 }, 3]"),
            "[\n    if 1 > 0 {\n        1\n    } else {\n        2\n    },\n    3,\n]\n"
        );
    }

    #[test]
    fn a_doomed_inline_attempt_costs_a_newline_rather_than_a_whole_subtree() {
        // WITHOUT `speculating` THIS IS 2^depth, MEASURED AND NOT REASONED ABOUT: printing the broken
        // form of a construct inside an enclosing attempt that is about to discard it makes each level
        // cost two full prints of the level below. `nested_lists(16)` — 202 bytes of input — took 11.5
        // SECONDS, and depth 20 did not finish. That is a hang on user input, which the no-panic rule
        // exists to forbid the milder version of.
        //
        // ASSERTED AS A WORK COUNT, NOT A WALL CLOCK, because the failure mode of a regression here is
        // a test that never returns. Doubling the depth must roughly double the work; exponential
        // growth would be a factor of 256 over the same span.
        // The depths are DELIBERATELY SHALLOW. A regression has to FAIL this test, not hang the run:
        // at depth 16 the exponential version takes minutes, so the numbers compared are 4 and 8,
        // where it still finishes while the ratio still separates the two shapes by 16x against a
        // threshold of 4.
        let (d4, d6, d8) = (print_work(&nested_lists(4)), print_work(&nested_lists(6)), print_work(&nested_lists(8)));
        assert!(d4 < d6 && d6 < d8, "deeper input must cost more, or this measures nothing: {d4}/{d6}/{d8}");
        assert!(
            d8 <= 4 * d4,
            "work must be linear in the nesting depth, not exponential: depth 4 = {d4}, depth 6 = {d6}, \
             depth 8 = {d8} (exponential is roughly 16x over that span, linear roughly 1.5x)"
        );
        // The same shape through `postfix_chain`, whose inline attempt has had the newline-aware fit
        // check since it was written and so has had this cost all along: a 713-byte chain nested 22 deep
        // took 1.82 seconds before this fix.
        let chain = |depth: usize| {
            let mut s = String::from("xs");
            for _ in 0..depth {
                s = format!("xs.filter(|a_long_parameter| {s})");
            }
            format!("{s}.map(|a_long_parameter| a_long_parameter > 2222222)")
        };
        let (c4, c12) = (print_work(&chain(4)), print_work(&chain(12)));
        // 20x rather than 4x: unlike the list shape, tripling this chain's depth also triples its
        // NODE count, so the honest bound is polynomial, not flat. Exponential over the same span is
        // 2^8 = 256x, so the threshold still separates the two by an order of magnitude.
        assert!(c12 <= 20 * c4, "chain nesting must stay polynomial: depth 4 = {c4}, depth 12 = {c12}");
    }

    #[test]
    fn a_short_method_chain_stays_on_one_line() {
        assert_eq!(f("xs.map(|x| x + 1).fold(0, |a, b| a + b)"), "xs.map(|x| x + 1).fold(0, |a, b| a + b)\n");
    }

    #[test]
    fn a_long_method_chain_breaks_one_link_per_line() {
        let src = format!("xs{}", ".filter(|a_long_parameter| a_long_parameter > 2)".repeat(5));
        let out = f(&src);
        let rows: Vec<&str> = out.lines().collect();
        assert_eq!(rows.len(), 6, "base then one row per link: {out:?}");
        assert_eq!(rows[0], "xs");
        assert!(rows[1..].iter().all(|r| r.starts_with("    .")), "links indent by four: {rows:?}");
        assert!(out.lines().all(|l| l.len() <= MAX_WIDTH), "no line over budget: {out:?}");
    }

    #[test]
    fn a_chain_of_plain_calls_does_not_break() {
        // Only `.method(…)` links are breakable — there is nowhere to put a newline in `f(1)(2)`.
        assert_eq!(f("f(1)(2)(3)"), "f(1)(2)(3)\n");
    }

    #[test]
    fn a_bracketed_base_after_a_link_that_broke_internally_does_not_underflow_the_column() {
        // Reproduction for the `line_start`/`out` desync: `postfix_chain` saves `mark` before the
        // base, prints the base plus every link inline, and truncates back to `mark` if that overran
        // — but only `bracketed`'s two post-truncate paths call `newline()` before anything reads
        // `col()`. `postfix_chain` calls `expr_prec` on the base FIRST, with no intervening
        // `newline()`, so if that base is itself bracketed (a list here), `bracketed` computes
        // `self.col()` unconditionally before deciding whether IT needs to break, using whatever
        // `line_start` the truncated-away text left behind.
        //
        // `.map(...)`'s own argument list is wide enough to overflow on its own (a) — `args` breaks
        // internally and calls `newline()`, advancing `line_start` past `mark`. That makes the whole
        // chain's inline attempt contain a newline, so `postfix_chain` truncates back to `mark`
        // without restoring `line_start`, then reprints the base — a list literal (b) — whose
        // `bracketed` call reads `col()` before any `newline()` of its own. `line_start` (left
        // pointing partway through the now-truncated argument list) exceeds `out.len()` (rewound to
        // `mark`), so `out.len() - line_start` underflows.
        let src = "[1, 2, 3].map(aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, \
                    gggggggggg, hhhhhhhhhh, iiiiiiiiii, jjjjjjjjjj)";
        let out = f(src);
        assert!(out.lines().all(|l| l.len() <= MAX_WIDTH), "no line over budget: {out:?}");
    }

    #[test]
    fn last_end_rewinds_with_the_buffer() {
        // Finding: `bracketed`'s inline attempt prints every item via `expr_prec` before deciding
        // whether to keep the result. A list item that is a block expression routes through `braced` ->
        // `block_body`, which writes `self.last_end` for real, mid-speculation. If the attempt then
        // overruns, a `rewind` that does not restore `last_end` leaves it holding a value from discarded
        // work.
        //
        // That corruption never survives a full call to `bracketed`: on overrun, `bracketed`
        // unconditionally reprints every item in the fallback (fill or vertical) layout, and
        // `block_body`'s fixup writes are a pure function of the AST span — so the SAME item, reprinted
        // for real, converges back to the identical `last_end` value whether or not `Mark` carries it.
        // The corruption is only observable in the WINDOW between `rewind` and that reprint, which no
        // caller reads today (`block_body`/`program` read `last_end` only immediately after their own
        // unconditional fixup, or skip the read entirely on `first = true`). So this test drives
        // `bracketed`'s speculative phase directly — the same sequence `bracketed` itself runs — and
        // inspects `last_end` in that window, rather than relying on final output (which is identical
        // with or without the fix).
        //
        // Two list items: a block (so a real `block_body` write happens mid-speculation) followed by an
        // identifier wide enough that the combined line — the block's closing `}`, `, `, the identifier,
        // and the closing `]` — overruns MAX_WIDTH, exactly the condition `bracketed` checks via `col()`
        // before deciding to rewind.
        let wide = "a".repeat(130);
        let src = format!("[{{ let x = 1; x }}, {wide}]");
        let (program, diags) = parse(&src);
        assert!(diags.is_empty(), "test input must parse: {diags:?}");
        let program = program.expect("parses");
        let tail = program.block.tail.as_ref().expect("single tail expression");
        let Expr::List { items, .. } = &**tail else { panic!("expected a list literal: {tail:?}") };

        let mut pr = Printer::new(&src, &[]);
        let last_end_before = pr.last_end;

        // Replicate `bracketed`'s speculative phase exactly (mark, print every item inline, check the
        // same overrun condition) instead of calling `bracketed` itself: `bracketed`'s own fallback
        // would immediately reprint the block and self-heal `last_end` before this test could observe
        // the corruption.
        let mark = pr.mark();
        pr.out.push('[');
        for (i, item) in items.iter().enumerate() {
            if i > 0 {
                pr.out.push_str(", ");
            }
            pr.expr_prec(item, 0);
        }
        pr.out.push(']');
        assert!(pr.col() > MAX_WIDTH, "the attempt must actually overrun to exercise a rewind: col={}", pr.col());
        assert_ne!(
            pr.last_end, last_end_before,
            "the block's speculative print must touch last_end for the scenario to be meaningful"
        );

        pr.rewind(mark);
        assert_eq!(
            pr.last_end, last_end_before,
            "last_end must rewind with the buffer, not remain corrupted after rewind"
        );
    }

    #[test]
    fn a_single_blank_line_between_statements_survives() {
        assert_eq!(f("let a = 1;\n\nlet b = 2;\nb"), "let a = 1;\n\nlet b = 2;\nb\n");
    }

    #[test]
    fn runs_of_blank_lines_collapse_to_one() {
        assert_eq!(f("let a = 1;\n\n\n\n\nlet b = 2;\nb"), "let a = 1;\n\nlet b = 2;\nb\n");
    }

    #[test]
    fn no_blank_line_is_kept_just_after_the_open_brace() {
        assert_eq!(f("fn g(){\n\n  1\n}\ng()"), "fn g() {\n    1\n}\ng()\n");
    }

    #[test]
    fn no_blank_line_is_kept_just_before_the_close_brace() {
        assert_eq!(f("fn g(){\n  1\n\n}\ng()"), "fn g() {\n    1\n}\ng()\n");
    }

    #[test]
    fn no_blank_line_at_the_start_of_the_file() {
        assert_eq!(f("\n\n\nlet a = 1;\na"), "let a = 1;\na\n");
    }

    #[test]
    fn blank_lines_inside_a_block_survive() {
        assert_eq!(
            f("fn g(){ let a = 1;\n\nlet b = 2;\na + b } g()"),
            "fn g() {\n    let a = 1;\n\n    let b = 2;\n    a + b\n}\ng()\n"
        );
    }

    #[test]
    fn runs_of_blank_lines_collapse_to_one_inside_a_block() {
        // `runs_of_blank_lines_collapse_to_one` above only exercises the collapse rule at top level;
        // `blank_lines_inside_a_block_survive` only exercises a nested block with a SINGLE blank line.
        // Neither pins the collapse rule nested, so this mirrors the latter's shape with a run of five
        // blank lines in place of one.
        assert_eq!(
            f("fn g(){ let a = 1;\n\n\n\n\nlet b = 2;\na + b } g()"),
            "fn g() {\n    let a = 1;\n\n    let b = 2;\n    a + b\n}\ng()\n"
        );
    }

    #[test]
    fn binding_powers_match_the_parser() {
        // Enumerated rather than derived: `parser::infix_op` maps TOKENS to (op, bp) and is private
        // to that module, so the only mechanical link available is this table, checked by parsing.
        // Each case is a program whose tree depends on the two tables agreeing.
        for (src, expected) in [
            ("1 + 2 * 3", "1 + 2 * 3"),
            ("1 * 2 + 3", "1 * 2 + 3"),
            ("(1 + 2) * 3", "(1 + 2) * 3"),
            ("1 == 2 + 3", "1 == 2 + 3"),
            ("(1 == 2) == 3", "1 == 2 == 3"),
            ("1 == (2 == 3)", "1 == (2 == 3)"),
        ] {
            assert_eq!(p(src), expected, "for {src:?}");
        }
    }

    #[test]
    fn an_own_line_comment_prints_above_the_construct_it_precedes() {
        assert_eq!(f("// why\nlet a = 1;\na"), "// why\nlet a = 1;\na\n");
    }

    #[test]
    fn a_trailing_comment_stays_on_its_line_with_exactly_one_space() {
        assert_eq!(f("let a = 1;   // note\na"), "let a = 1; // note\na\n");
    }

    #[test]
    fn a_comment_takes_the_indentation_of_what_it_anchors_to_and_gains_no_space() {
        assert_eq!(
            f("fn g(){\n// inner\nlet a = 1;\na\n}\ng()"),
            "fn g() {\n    // inner\n    let a = 1;\n    a\n}\ng()\n"
        );
    }

    #[test]
    fn comment_text_is_copied_byte_for_byte_with_trailing_space_trimmed() {
        assert_eq!(f("let a = 1; //   spaced   \na"), "let a = 1; //   spaced\na\n");
        assert_eq!(f("let a = 1; //no space after slashes\na"), "let a = 1; //no space after slashes\na\n");
    }

    #[test]
    fn a_comment_after_the_last_construct_still_prints() {
        assert_eq!(f("let a = 1;\na\n// last word\n"), "let a = 1;\na\n// last word\n");
    }

    #[test]
    fn a_comment_inside_a_list_forces_the_list_to_break() {
        // THE HAZARD THIS RULE EXISTS FOR: `//` runs to end of line, so `[1, // first 2]` is not an
        // ugly rendering of the input — it is a one-element list, or a parse error.
        let out = f("let xs = [\n1, // first\n2,\n];\nxs");
        assert_eq!(out, "let xs = [\n    1, // first\n    2,\n];\nxs\n");
        let (reparsed, diags) = crate::parser::parse_full(&out);
        assert!(diags.is_empty(), "output must reparse: {diags:?}");
        assert!(reparsed.is_some());
    }

    /// Assert a formatted output both matches exactly and reparses cleanly. Shared by the bracket-edge
    /// comment reproductions below, which all need both checks.
    fn assert_formats_and_reparses(src: &str, expected: &str) {
        let out = f(src);
        assert_eq!(out, expected, "for {src:?}");
        let (reparsed, diags) = crate::parser::parse_full(&out);
        assert!(diags.is_empty(), "output must reparse: {diags:?}\n{out}");
        assert!(reparsed.is_some());
    }

    #[test]
    fn a_comment_trailing_a_lists_last_element_forces_the_break_and_stays_attached() {
        // Finding 1 reproduction: `list_span` measured only first-element-start..last-element-end, so
        // a comment between the last element and the closing `]` fell outside it. `must_break` missed
        // it, the list printed inline (the path that never flushes), and the comment resurfaced at the
        // next statement boundary, reattached to an unrelated `;` and inventing a blank line. Before
        // the fix this reproduced byte-for-byte as `"let xs = [1, 2]; // trailing\n\nlet y = 3;\ny\n"`.
        assert_formats_and_reparses(
            "let xs = [1, 2 // trailing\n];\nlet y = 3;\ny",
            "let xs = [\n    1,\n    2, // trailing\n];\nlet y = 3;\ny\n",
        );
    }

    #[test]
    fn a_comment_trailing_a_calls_last_argument_forces_the_break_and_stays_attached() {
        // Same defect, on a call's argument list. Before the fix this reproduced byte-for-byte as
        // `"f(1) // trailing\n"` — the call stayed inline and the comment jumped past the `)`.
        assert_formats_and_reparses("f(1 // trailing\n)", "f(\n    1, // trailing\n)\n");
    }

    #[test]
    fn a_comment_leading_a_list_forces_the_break() {
        // Same defect, on the OTHER edge: a comment between `[` and the first element also sat outside
        // `list_span`'s first-start..last-end range.
        assert_formats_and_reparses("[ // leading\n1, 2]", "[ // leading\n    1,\n    2,\n]\n");
    }

    #[test]
    fn a_comment_leading_a_calls_argument_list_forces_the_break() {
        // Same defect, on a call's argument list: a comment between `(` and the first argument.
        assert_formats_and_reparses("f( // leading\n1, 2)", "f( // leading\n    1,\n    2,\n)\n");
    }

    #[test]
    fn a_comment_only_file_has_no_leading_blank_line() {
        // Finding 2 reproduction: `program`'s trailing `flush_before(usize::MAX, false)` hardcoded
        // `first = false` instead of passing the loop's own `first` flag, so content that is entirely
        // comments opened with a blank line it was never given. Before the fix this reproduced
        // byte-for-byte as `"\n\n// only\n"`, violating `no_blank_line_at_the_start_of_the_file`.
        assert_formats_and_reparses("\n\n// only", "// only\n");
    }

    #[test]
    fn a_comment_only_block_body_has_no_leading_blank_line() {
        // Same defect in `block_body`'s trailing `flush_before(block.span.end, false)`. Before the fix
        // this reproduced byte-for-byte as `"fn g() {\n\n    // only\n}\ng()\n"`, violating
        // `no_blank_line_is_kept_just_after_the_open_brace`.
        assert_formats_and_reparses("fn g() {\n\n// only\n}\ng()", "fn g() {\n    // only\n}\ng()\n");
    }

    #[test]
    fn a_comment_flushed_from_a_statement_interior_invents_no_blank_line() {
        // `last_end` used to be assigned, not maxed, so a comment emitted from a position with no
        // flush point of its own — the whole statement is already in `out` by the time the next flush
        // point arrives — moved the cursor BACKWARDS relative to the buffer. The following
        // `blank_between(last_end, next_start)` then measured a gap running across the REST OF THE
        // STATEMENT rather than across whitespace, counted its newlines, and invented a blank line.
        // Each of these reproduced byte-for-byte with a spurious `\n\n` before the fix. WHERE the
        // comment lands is a separate, deliberately open question (design §17); that it does not drag
        // a blank line along with it is not.
        assert_eq!(f("let a = // c\n1;\nb"), "let a = 1; // c\nb\n");
        assert_eq!(f("let mut a = 1;\na = // c\n2;\na"), "let mut a = 1;\na = 2; // c\na\n");
        assert_eq!(f("let f = |x| // c\nx;\nf(1)"), "let f = |x| x; // c\nf(1)\n");
    }

    #[test]
    fn a_trailing_comment_that_opens_the_file_gains_no_leading_space() {
        // `flush_before`'s own-line branch guarded its newline with `!out.is_empty()`; the trailing
        // branch pushed its separating space unconditionally, onto a buffer that is still empty. The
        // space became the file's first byte — and was not even a fixed point, since reformatting
        // lexes a line-leading `//` as own-line and drops it. Before the fix: `" // c\n1 + 2\n"`.
        //
        // THE INPUT IS PARENTHESISED FOR A REASON. Every other way of putting a trailing comment at
        // the head of a file is closed: a comment with nothing but whitespace before it is `own_line`
        // by construction (`lexer::own_line_at`), and every `Expr` variant's span now starts at its
        // own first token — including `Expr::Block`, which is what `{ // c` used to exercise before
        // the parser started merging the `{` into the span. `Expr` has no `Paren` variant, so `(`
        // is the one opening token that survives into printed output without a span of its own,
        // leaving `( // c` as the remaining door into this branch.
        assert_formats_and_reparses("( // c\n1 + 2)", "// c\n1 + 2\n");
    }

    #[test]
    fn a_broken_list_gains_no_blank_line_just_inside_its_own_bracket() {
        // §5's "no blank line just inside a brace" was implemented for `{` and for nothing else:
        // `vertical_rows` hardcoded `first = false`, so `open_line` measured the gap from the
        // PREVIOUS STATEMENT's end to the first element's start — a range crossing the `[` and the
        // newline after it. Before the fix the first input was not idempotent (pass 2 gained
        // `"[\n\n    1,"`), and the second, already in this shape, gained the blank line on pass ONE
        // and was then a fixed point, so idempotence could not have caught it at all.
        assert_formats_and_reparses(
            "let a = 1;\nlet xs = [1, // c\n2];\nxs",
            "let a = 1;\nlet xs = [\n    1, // c\n    2,\n];\nxs\n",
        );
        assert_formats_and_reparses(
            "let a = 1;\nlet xs = [\n    1, // first\n    2,\n];\n0",
            "let a = 1;\nlet xs = [\n    1, // first\n    2,\n];\n0\n",
        );
    }

    #[test]
    fn a_block_element_starts_at_its_own_open_brace() {
        // `parse_block_body` starts a `Block`'s span at the first token INSIDE the braces, and
        // `Expr::Block` used to adopt it unchanged — so the printer's `item.span().start`, which it
        // reads as "the offset this item's printed text begins at", pointed PAST the `{`. Two
        // consequences, both here: a comment between `{` and the first statement counted as preceding
        // the whole block and escaped its braces, and `blank_between` measured a gap running across
        // the `{` and its newline and invented a blank line. Before the fix, pass 1 was
        // `"let xs = [ // c\n    {\n..."` — comment outside the block — and pass 2 added `"[ // c\n\n"`.
        assert_formats_and_reparses(
            "let xs = [{ // c\nlet a = 1; a }, 2];\nxs",
            "let xs = [\n    { // c\n        let a = 1;\n        a\n    },\n    2,\n];\nxs\n",
        );
    }

    #[test]
    fn a_comment_inside_an_empty_bracket_pair_stays_inside_it() {
        // `bracketed`'s `items.is_empty()` early return ran BEFORE `must_break` was computed, so §7's
        // forced break was skipped for exactly the constructs whose entire content is a comment. The
        // comment escaped its own brackets and reattached to whatever flushed next. Before the fix:
        // `"let xs = []; // inside\n\nxs\n"` and `"f() // inside\n"` — the anchoring property sees
        // both as a comment at bracket depth 1 dropping to depth 0.
        assert_formats_and_reparses("let xs = [ // inside\n];\nxs", "let xs = [ // inside\n];\nxs\n");
        assert_formats_and_reparses("f( // inside\n)", "f( // inside\n)\n");
        // The own-line spelling takes the body indent, like any other own-line comment.
        assert_formats_and_reparses("let xs = [\n// inside\n];\nxs", "let xs = [\n    // inside\n];\nxs\n");
        // And an empty pair with NO comment is untouched — the early return still fires.
        assert_eq!(f("let xs = [];\nf()"), "let xs = [];\nf()\n");
    }

    #[test]
    fn a_later_sibling_construct_on_the_same_line_does_not_donate_its_comment() {
        // §17.7. THE CAUSE PREDATES THIS BRANCH'S FIX WAVES; THE OBSERVABLE DEFECT DOES NOT — bisected
        // after the fact, and the first draft of this comment said "pre-existing" of both, which is
        // wrong in the way this branch keeps being wrong. At `77af295` this input already fails
        // idempotence for a different reason, but `// c` is still correctly attached to its `1`. The
        // misattribution appears at `9005c44`, the nested-break rule: until that landed, `bracketed`
        // accepted the half-broken hybrid, these lists never broke vertically, and the flush path
        // below was unreachable. A latent cause and a reachable defect are not the same claim.
        // `vertical_rows`
        // capped the LAST element's trailing flush at `usize::MAX` rather than this construct's own
        // close, so `next_boundary` — "the end of the line this item ends on in the ORIGINAL SOURCE",
        // uncapped for the last element — ran past the tail list's own `]` and into the sibling
        // construct that follows it on the same source line, pulling `// c` in there instead.
        // `contains_comment` then still found the comment sitting inside the tail list's own span
        // (position-based against the source, not cursor-based against what has actually been
        // emitted), so it forced a break for a comment that had already been printed somewhere else —
        // present on pass 1, gone on pass 2 once the comment had genuinely moved. Before the fix this
        // reproduced byte-for-byte as:
        // `"fn e(x) {\n    x\n}\n[\n    {\n        e(\n            {\n            }, // c\n        )\n    },\n    [\n        1,\n    ],\n]\n"`
        // — `// c` landing inside `e`'s empty-block argument, four levels away from the list it was
        // written against, and `[1]` breaking vertically for a comment it no longer held.
        assert_formats_and_reparses(
            "fn e(x) { x }\n[{ e({}) }, [1 // c\n]]",
            "fn e(x) {\n    x\n}\n[\n    {\n        e(\n            {\n            },\n        )\n    },\n    [\n        1, // c\n    ],\n]\n",
        );
    }

    #[test]
    fn a_later_sibling_construct_on_the_same_line_does_not_starve_an_empty_bracket_pair() {
        // §17.7, INTRODUCED by this task's own C2 fix (`a_comment_inside_an_empty_bracket_pair_stays_
        // inside_it`, immediately above). Same root cause as the test above, but the donated comment is
        // the ENTIRE content of the next construct — an empty bracket pair whose only reason to break
        // at all is the comment `vertical_rows` had already stolen from it. `must_break` still fired
        // (the same position-based `contains_comment`, oblivious to the comment having been flushed
        // already), and the empty-bracket branch called `indent()` unconditionally inside `if
        // must_break`, ignoring the `bool` `flush_before` returns for exactly this case — so with
        // nothing left to flush, `indent` ran straight after the open bracket with no newline before
        // it. Before the fix this reproduced byte-for-byte as:
        // `"fn e(x) {\n    x\n}\n[\n    e(\n        {\n        }, // c\n    ),\n    [    ],\n]\n"`
        // — `[    ]`, an empty bracket pair holding four columns of bare whitespace.
        assert_formats_and_reparses(
            "fn e(x) { x }\n[e({}), [ // c\n]]",
            "fn e(x) {\n    x\n}\n[\n    e(\n        {\n        },\n    ),\n    [ // c\n    ],\n]\n",
        );
    }

    #[test]
    fn flushing_a_comment_always_ends_the_line_itself() {
        // §7 SAID THIS WAS STRUCTURAL AND IT WAS NOT: "the emit-comment path writes the newline
        // itself — not a case for a caller to remember." `flush_before` wrote no newline; all five
        // call sites did, and `postfix_chain`'s `Link::Call` arm forgot, printing an argument list
        // onto a just-flushed comment so that `f(1) // note\n(2)` reparsed with the call gone.
        //
        // Asserted against `flush_before` directly rather than through output, because output only
        // shows that today's callers happen to be right. Each input reaches the flush in a different
        // buffer state and each prefix puts it at a different column; the postcondition is the same in
        // all of them.
        for src in [
            "// own line\n1",
            "1 // trailing\n+ 2",
            "// one\n// two\n1",
            "1 // trailing\n// then own line\n+ 2",
            "let a = // interior\n1;\na",
        ] {
            let (parsed, diags) = crate::parser::parse_full(src);
            assert!(diags.is_empty(), "test input must parse: {diags:?}");
            let parsed = parsed.expect("parses");
            for prefix in ["", "x", "    x"] {
                let mut pr = Printer::new(parsed.src, &parsed.comments);
                pr.out.push_str(prefix);
                assert!(pr.flush_before(usize::MAX, false), "{src:?} must have something to flush");
                assert!(pr.out.ends_with('\n'), "{src:?} at prefix {prefix:?} left the line open: {:?}", pr.out);
            }
        }
    }

    #[test]
    fn blank_lines_measure_against_a_comment_when_one_sits_between() {
        assert_eq!(f("let a = 1;\n\n// note\nlet b = 2;\nb"), "let a = 1;\n\n// note\nlet b = 2;\nb\n");
        assert_eq!(f("let a = 1;\n// note\n\nlet b = 2;\nb"), "let a = 1;\n// note\n\nlet b = 2;\nb\n");
    }

    #[test]
    fn a_comment_between_chain_links_stays_trailing_the_link_it_followed() {
        // Finding reproduction: `bracketed`'s region for a call/method link started at the END of the
        // PREVIOUS link (`callee.span().end` / `recv.span().end`), not at this link's own `(`. A comment
        // trailing `.first(1)` therefore fell inside `.second`'s region, forced `.second`'s OWN argument
        // list to break, and printed just after `.second`'s `(` — attached to the wrong call. Before the
        // fix this reproduced byte-for-byte as `"xs\n    .first(1)\n    .second( // note\n        2,\n    )\n"`.
        //
        // The comment stays on `.first(1)`'s line, the chain breaks one link per line to make room for
        // it, and — this is the "not beyond what the comment requires" half of the finding — `.second`'s
        // own argument list stays INLINE, since nothing about `(2)` itself holds a comment.
        assert_formats_and_reparses("xs.first(1) // note\n.second(2)", "xs\n    .first(1) // note\n    .second(2)\n");
    }

    #[test]
    fn a_comment_trailing_the_bare_receiver_stays_before_the_first_link() {
        // Same defect, one link shorter: the comment trails the bare receiver `xs`, before any `.` at
        // all. Before the fix this was absorbed into `.first`'s argument list.
        assert_formats_and_reparses("xs // note\n.first(1)", "xs // note\n    .first(1)\n");
    }

    #[test]
    fn a_comment_genuinely_inside_an_argument_list_still_forces_that_list_to_break() {
        // The other direction: narrowing `region` to the link's own `(...)` must not stop catching a
        // comment that is actually inside the parens. A comment inside `.second`'s own argument list
        // forces THAT list to break internally — `must_break` still fires, unregressed by the narrower
        // region — which in turn introduces a newline before `postfix_chain`'s own `fits_inline` check
        // runs, so the whole chain converges on the same one-link-per-line form a too-long chain would
        // (`postfix_chain`'s pre-existing "half-broken hybrid" avoidance, untouched by this fix).
        assert_formats_and_reparses(
            "xs.first(1).second(2 // inside\n)",
            "xs\n    .first(1)\n    .second(\n        2, // inside\n    )\n",
        );
    }

    #[test]
    fn a_connector_comment_containing_an_open_paren_does_not_fool_the_bracket_scan() {
        // `xs // (\n.first(1)` is legal input: the comment's TEXT contains a `(`, so a naive
        // `str::find('(')` from `recv.span().end` would land inside the comment and misplace the
        // region. `open_paren_after` must skip past the comment span and keep scanning to the real `(`.
        assert_formats_and_reparses("xs // (\n.first(1)", "xs // (\n    .first(1)\n");
    }

    #[test]
    fn a_short_chain_with_an_inter_link_comment_is_not_force_broken_beyond_the_comment() {
        // The reviewer's other half of the finding: the CURRENT bug forces a two-link chain that would
        // otherwise fit on one line into the full vertical form even when the only thing that actually
        // needs a break is the comment's own end-of-line. This is the same shape as
        // `a_comment_between_chain_links_stays_trailing_the_link_it_followed` but asserts the negative
        // space directly: nothing downstream of the comment (here, `.b(2)`'s own argument list) is
        // touched, and the chain is short enough that width alone would never have forced a break.
        assert_formats_and_reparses("xs.a(1) // note\n.b(2)", "xs\n    .a(1) // note\n    .b(2)\n");
    }

    #[test]
    fn a_connector_comment_in_an_all_call_chain_survives_a_later_forced_break() {
        // The reviewer's reproduction: `breakable` (true only when a `Link::Method` exists) used to
        // gate the EARLY RETURN too, so an all-`Call` chain never reached the connector-flushing loop
        // at all — the comment drifted until the next thing that broke, which here is the third call's
        // own wide argument. Before the fix this reproduced byte-for-byte as
        // `"f(1)(2)( // note\n    aaaa…,\n)\n"` — the comment landing inside the THIRD call's
        // parentheses, two links from where it was written.
        let wide = "a".repeat(130);
        let src = format!("f(1) // note\n(2)({wide})");
        let expected = format!("f(1) // note\n    (2)(\n        {wide},\n    )\n");
        assert_eq!(f(&src).matches("//").count(), 1, "exactly one comment in the source");
        assert_formats_and_reparses(&src, &expected);
        assert_eq!(expected.matches("//").count(), 1, "comment emitted exactly once, not lost or doubled");
    }

    #[test]
    fn a_connector_comment_in_an_all_call_chain_survives_when_nothing_else_breaks() {
        // Same defect, one call shorter and with no width pressure at all: nothing else in the chain
        // forces a break, so before the fix this drifted all the way to the program's trailing
        // catch-all flush, reproducing byte-for-byte as `"f(1)(2) // note\n"` — attached to the whole
        // chain's end rather than to the call it actually followed.
        assert_eq!(f("f(1) // note\n(2)").matches("//").count(), 1);
        assert_formats_and_reparses("f(1) // note\n(2)", "f(1) // note\n    (2)\n");
    }

    #[test]
    fn a_connector_comment_before_a_bare_call_link_in_a_mixed_chain_does_not_swallow_the_call() {
        // Adjacent defect surfaced while fixing the all-`Call` case: the vertical reprint's `Link::Call`
        // arm called `self.args(...)` right after `flush_before`, with no newline in between — safe
        // ONLY because every existing test's connector comment happened to precede a `Link::Method`,
        // whose own `newline()` runs unconditionally. A connector comment before a bare `Call` link
        // (legal: `xs.first(1)(2)` is `(2)` called on `.first(1)`'s result) had no such newline, so the
        // flushed trailing `// note` absorbed the `(2)` that followed it on the same physical line —
        // verified against actual HEAD output before this fix: `"xs\n    .first(1) // note(2)\n    .second(3)\n"`,
        // which reparses to `xs.first(1).second(3)` — the whole `(2)` call silently dropped, not merely
        // misplaced. Fixed by giving `Link::Call` the same "connector implies a newline" treatment
        // `Link::Method` already had unconditionally, gated on `connector` so a `Call` link with
        // nothing to flush still glues to the previous link exactly as before.
        let src = "xs.first(1) // note\n(2).second(3)";
        assert_eq!(f(src).matches("//").count(), 1, "exactly one comment in the source");
        assert_formats_and_reparses(src, "xs\n    .first(1) // note\n    (2)\n    .second(3)\n");
    }

    #[test]
    fn a_connector_comment_before_a_method_link_in_a_mixed_chain_is_unaffected() {
        // The `Link::Call` arm's new `if connector { newline(); indent(); }` must not change
        // `Link::Method`'s own unconditional newline — a mixed chain (both link kinds present) with the
        // connector comment before the METHOD link exercises the untouched arm.
        let src = "xs(1).second(2) // note\n.third(3)";
        assert_eq!(f(src).matches("//").count(), 1, "exactly one comment in the source");
        assert_formats_and_reparses(src, "xs(1)\n    .second(2) // note\n    .third(3)\n");
    }

    #[test]
    fn an_all_call_chain_with_no_comment_still_never_rewinds_for_width() {
        // Path-3 pin, same shape as the reviewer's reproduction with the comment removed: the third
        // call's wide argument still overruns `MAX_WIDTH` and `bracketed` still breaks THAT argument
        // list vertically on its own (introducing a newline into `self.out` since `mark`), but with no
        // connector comment, `has_connector_comment` is false, so `!breakable` alone (still true, per
        // the widened `if`) is enough to return early and keep the FIRST attempt's output — no
        // chain-level rewind, no `self.level` indent bump. `fits_inline` is irrelevant here, which is
        // exactly what proves the width check was not accidentally re-coupled to `!breakable` chains by
        // widening the condition.
        let wide = "a".repeat(130);
        let src = format!("f(1)(2)({wide})");
        assert_formats_and_reparses(&src, &format!("f(1)(2)(\n    {wide},\n)\n"));
    }

    #[test]
    fn every_comment_survives_regardless_of_where_it_sits() {
        let src = "// a\nfn g(a) { // b\n  // c\n  a // d\n} // e\n// f\ng(1) // g\n// h";
        let out = f(src);
        let count = |s: &str| s.matches("//").count();
        assert_eq!(count(&out), count(src), "no comment dropped:\n{out}");
    }
}
