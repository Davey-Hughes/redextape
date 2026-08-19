# Surface trivia and the surface printer — design

**Slice:** `surface-trivia-and-printer`, filed against the roadmap's standing blocker recorded twice —
as Plan 4's deferral item 4 (*"`classify_source` can never emit `TokenClass::Comment`, and this is the
`fmt` blocker wearing a different hat"*) and as Plan 6's survey note (*"The blocking decision for `fmt`
is comment retention, and it is bigger than the printer"*). Both say the same thing: decide once, and
two consumers are served.

**One-line statement of what this is:** the mini-language gets a printer, and comments and blank lines
get a representation that survives `print ∘ parse` — which is what `redextape fmt` has been waiting on
and what makes `TokenClass::Comment` reachable for the first time.

**Scope boundary, decided before anything else:** this slice is `redextape-core` only. `crates/redextape-cli`
is a later slice and nothing here assumes it. The deliverable is a library API plus a reachable
`TokenClass::Comment`, both usable and testable without a binary.

---

## §1 What is missing, verified against the tree

- **`lexer.rs:23-28` discards `//` comments.** The scan advances to the newline and `continue`s; no
  token is emitted and no span is kept. Nothing downstream can know a comment was there.
- **`TokenKind` (`token.rs:6-42`) has no comment variant**, so `analysis::class_of` (`analysis.rs:142`)
  — an exhaustive match with no wildcard — cannot produce `TokenClass::Comment`. The class is declared
  (`analysis.rs:30`), is at index 6 of `token_class_names()`, is pinned by the discriminant test, and is
  unreachable on the source path.
- **There is no surface printer.** `print_lambda` (`lambda/syntax.rs:199`), `print_tm`
  (`tm/syntax.rs:102`) and `print_asm` (`tm/asm.rs:151`) exist; the mini-language has a parser and no
  printer at all. §7.2 defines the formatter as exactly `print ∘ parse`, so this printer *is* the bulk
  of `fmt`, not a wrapper over something existing.
- **A test already exists that is written to fail when this lands.**
  `tests/span_wellformed.rs:149`'s `source_with_a_comment_is_the_one_gap_this_corpus_avoids` states the
  hole outright, and the corpus doc at `:33` says the no-comment restriction is *"load-bearing for the
  coverage assertion"* and is to be deleted rather than papered over. Flipping it is a deliverable of
  this slice.

## §2 `fmt` is a full reflow, and that is what makes placement a real question

§7.2: *"The formatter (§8) is exactly `print ∘ parse`."* Nothing about the author's layout is preserved
by construction — every line break in the output is the printer's choice. A formatter that merely
tidied whitespace could leave comments where it found them; this one cannot, because it is rebuilding
the text from a tree that never saw them.

**Reference style: rustfmt, and specifically this repo's dialect.** `rustfmt.toml` sets `max_width = 120`
and `use_small_heuristics = "Max"`; indent is rustfmt's default 4 spaces. Where a question below has an
answer in rustfmt, that is the answer, and §6 names the one place this design deliberately diverges.

## §3 The placement rule

**A comment binds to what follows it, and a comment sharing a line with preceding code stays trailing on
that line.** The rustfmt/Roslyn rule.

```
INPUT and OUTPUT are identical for this program:

    // sum the list
    let xs = [
        1, // first
        2,
    ];
```

Rejected alternatives, with the reason each was rejected, in §12.

**Indentation is the anchor's, and the text is the source's.** A comment prints at exactly the
indentation of the construct it anchors to — it never gains or loses leading space. Its bytes are copied
from `src[span]` with trailing whitespace trimmed, and are never re-wrapped or re-flowed (rustfmt's
`wrap_comments` is off by default and this follows it). A trailing comment gets exactly one space before
`//`.

## §4 Representation: a sorted side list, flushed by span

`lex` collects comments instead of discarding them. `parse_full` returns them beside the `Program`. The
printer walks the AST holding a cursor into that list and, before printing any node, flushes every
comment whose span starts before that node's span.

```rust
pub struct Comment {
    pub span: Span,
    pub own_line: bool,
}
```

**`own_line` is decided in `lex`**, where the backward scan to the previous newline is already in reach.
The printer could recompute it from `src`, but then two places would have to agree on what "own line"
means, and only one of them would be tested.

**The comment text is not stored.** `src[span.start..span.end]` recovers it. Same reason `TokenKind` is
`Copy` and identifier spelling is recovered by span rather than held (`token.rs:1-2`).

**The load-bearing assumption: this AST prints in source order.** Every `Expr` and `Stmt` variant was
checked — `Binary` is lhs/op/rhs, `Method` is `recv.name(args)`, `If` is cond/then/else, `Let` is
`name = value`, `Call` is `callee(args)`. None reorders. A span cursor is only correct while that holds,
so §10.5's test asserts it rather than this paragraph asserting it.

**Where the flush happens decides trailing versus own-line, so it is stated rather than left to the
implementation.** A trailing comment's span starts after the preceding construct ends and before the next
one begins, so both kinds of comment are found by the same cursor at the same moment. The printer flushes
**before terminating the previous line**: a `own_line: false` comment is written onto the line still open,
and a `own_line: true` comment terminates that line first and then prints at the next construct's indent.
A flush that ran after the newline could only ever produce own-line comments, and §3's rule would be
unimplementable.

## §5 Blank lines need no records

The printer holds `src`. At each boundary it counts newlines in the gap between the previous item's
`span.end` and the next item's `span.start`; two or more means the author left a blank line. So the
trivia list is comments only even though the feature covers comments *and* blank lines.

**"Item" means construct *or* comment, and the distinction matters.** A comment sitting in the gap is
itself an emitted item, so the gap is measured against whichever came last — otherwise a comment between
two statements would swallow the blank line on one side of it and invent one on the other.

**Blank-line rules, following rustfmt:** runs of two or more collapse to one; none is kept immediately
after `{` or immediately before `}`; none at file start; the file ends with exactly one newline.

**Why blank lines are in this slice at all.** They are trivia in precisely the sense comments are —
absent from the AST, therefore destroyed by `print ∘ parse`. Carrying only comments would return a
formatted file as one undifferentiated wall of statements, and the follow-up slice would reopen the same
`lex`/`parse` plumbing to fix it.

## §6 Layout rules

1. One statement per line. Blocks: `{` on the introducer's line, body indented +4, `}` on its own line at
   the introducer's indent.
2. `} else {` on one line. ~~An else block that is exactly a tail `If` with no statements prints as
   `} else if cond {`. The AST cannot distinguish that from a literally-nested `else { if ... }`, and
   collapsing it is both what rustfmt does and what the author wrote.~~ **WRONG, 2026-08-19 — see §15.**
   This grammar has no `else if` sugar, so the collapsed spelling does not reparse; a nested `if` in an
   `else` branch always prints fully braced. `else` is mandatory in this grammar (`parser.rs:354` calls
   `expect(TokenKind::Else)`), so there is no empty-else case to print around.
3. ~~**List literals fill** — several short elements per line — while **call and method argument lists break
   one-per-line**. rustfmt treats these two differently.~~ **FALSIFIED BY MEASUREMENT, 2026-08-19 — see
   §13.** rustfmt fills *both*, identically, at the same threshold. The rule is now: **a bracketed,
   comma-separated sequence fills when every element is short, and breaks one-per-line otherwise** —
   one rule, no distinction between `[…]` and `(…)`. **"Short" is a printed element width of 10
   characters**, rustfmt's `short_array_element_width_threshold` default, confirmed exactly at the 10/11
   boundary.
4. Trailing comma when a construct breaks vertically, ~~and none in fill mode~~ — **also falsified,
   §13: rustfmt emits one in fill mode too.**
5. Method chains stay on one line up to the width, then one `.method(...)` per line at +4.
6. **Binary expressions never break.** This is the one deliberate divergence from rustfmt in this design.
   A long arithmetic chain can exceed 120 columns. Breaking binaries well is what a general Wadler-style
   group-and-break engine is for, and that engine was considered and rejected (§12); this is the cost of
   that rejection, stated up front rather than reported later as a defect.
7. **A construct that breaks forces the one around it to break too.** A nested list or argument list
   that goes vertical leaves a short FINAL line even though the enclosing construct was never on one
   line; accepting that gives a half-broken hybrid (`[[\n    1,\n], 2]`) that rustfmt does not
   produce at this repo's settings. Added 2026-08-19 — `postfix_chain` had this rule from the start
   and `bracketed` did not; see §17 for what enforcing it cost and how that cost was removed.

**Width handling is confined to two constructs** — list literals and argument lists (rules 3 and 4). There
is no general pretty-printer. ~~That bound is the whole point of the chosen layout policy: no input can
produce an unbounded line~~ — **FALSE, 2026-08-19, see §17: parameter lists and indentation are two
further sources of an over-budget line, alongside §6.6's binary chains.** There is no fitting algorithm
whose interaction with comments would need its own idempotence proof, and that half stands.

## §7 The invariant that keeps output parseable

`//` runs to end of line. Emitting a comment mid-line comments out everything after it on that line:
`[1, // first 2]` is not an ugly rendering of the input, it is a **different program** — a one-element
list, or a parse error.

**Therefore: emitting a comment always ends the line, and any construct containing a comment is forced to
break.** This is structural in the printer — the emit-comment path writes the newline itself — not a case
for a caller to remember. ~~(As written, that described the design and not the code: `flush_before` wrote
no newline and all five call sites did.)~~ **TRUE AS OF 2026-08-19 AND NOT BEFORE — see §17.2**, which
records how the gap between this sentence and the code produced two defects, and what the postcondition
is now. It is why the comment-bearing list in §3 breaks even though it would fit on one
line, and §10.4's reparse test is the direct guard on it.

## §8 Interfaces

**`lexer::lex` changes shape:**

```rust
pub fn lex(src: &str) -> (Vec<Token>, Vec<Comment>, Vec<Diagnostic>)
```

Three real call sites — `parser.rs:20`, `analysis.rs:138`, `examples/state_cost_probe.rs:152` (which uses
`.0.len()` and is unaffected). A second lexer would be worse than a third tuple slot.

**`parser::parse` does not change.** It has roughly 25 call sites across `redextape-core` and
`redextape-native`, nearly all of the form `parse(src).0.unwrap()`, and none of them wants trivia.

**`parser::parse_full` is new:**

```rust
pub struct Parsed<'a> {
    pub program: Program,
    pub comments: Vec<Comment>,
    pub src: &'a str,
}

pub fn parse_full(src: &str) -> (Option<Parsed<'_>>, Vec<Diagnostic>)
```

The `_full` suffix is not invented here: `parse_tm_full` is already this codebase's name for the variant
that also returns the extra thing.

**`Parsed` bundles rather than passing three arguments, and that is a correctness decision.**
`printer::print(&Parsed) -> String` cannot be handed comments carrying offsets into a different string.
This is the same move `SourceMap::tm_owner` made, for the reason `analysis.rs` records against the
version that took a map and a machine separately: it *"could not check they described one lowering"*, and
a mismatch resolved every id to some other state's name — *"no error, no empty result, just a confidently
wrong highlight"*. Bundling makes that unrepresentable instead of unlikely.

**New module `printer.rs`**, top-level, pairing with `lexer.rs` and `parser.rs`. λ, TM and asm keep their
printers in their own `syntax.rs` because their whole languages live in submodules; the surface language's
modules are top-level, so its printer is too.

**One entry point in `lib.rs`**, beside `analyze` and `run`, so this slice is usable before any CLI
exists:

```rust
pub fn format(src: &str) -> Result<String, Vec<Diagnostic>>
```

**`analysis::classify_source` merges the comment spans** into its output by start offset. Comments never
overlap tokens, so this is a merge and not a reconciliation. `class_of` is untouched: `TokenClass::Comment`
is already declared and already at index 6, and simply becomes reachable.

## §9 Error handling

- **`format` returns `Err(Vec<Diagnostic>)` when the source does not parse.** Never a partial format,
  never a panic. This is the front end's existing no-panic-on-user-input rule, not a new one.
- **No comment can be dropped, by construction.** The flush drains remaining comments at each construct's
  close and `format` drains the rest at EOF, so a comment past the last node still prints. Comment count
  in equals comment count out is a test (§10.2), not an aspiration.
- **`[workspace.lints.clippy]` denies `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`.**
  The printer returns or defaults; it does not assert its way past a state it thinks impossible.

## §10 Tests

1. **Idempotence** — `format(format(s)) == format(s)`, proptest over generated programs plus the existing
   corpus. §7.2's stability half.
2. **Comment preservation** — the comments of `format(s)`, in order and byte-for-byte after trailing-space
   trimming, equal those of `s`. This is the property §4's representation gives up as a free consequence
   of `==` and buys back explicitly. It is the single test that most directly falsifies a wrong design.
3. **Semantics preserved** — `run(s) == run(format(s))` across the demo corpus. Reuses the existing oracle
   infrastructure, and is stronger evidence than an AST comparison, which span differences would defeat.
4. **Output always reparses** with zero diagnostics — the direct guard on §7.
5. **Source-order invariant** — the node spans the printer's walk visits are non-decreasing, for every
   corpus program. §4's assumption fails here loudly if a future AST variant prints out of order, rather
   than silently misplacing comments.
7. **Comment anchoring** — every comment keeps its bracket depth and its nearest non-punctuation token
   either side. **ADDED 2026-08-19 AFTER §14, WHICH ITS ABSENCE LET THROUGH.** Both defects recorded
   there moved a comment onto a construct it was never written against, while properties 1–4 all held:
   the output reparsed, every comment's text and order survived, and the wrong output was a fixed point
   so idempotence held too. Depth is what separates them — a comment inside `[ … ]` is at depth 1, and
   moved outside it is at 0. Punctuation is excluded from the neighbours because a vertical break
   legitimately inserts a trailing comma between a comment and the token it followed. A companion test
   asserts the property can fail, by checking it distinguishes the two shapes §14 records.
6. **Width** — no output line exceeds 120 columns except a single unbreakable token or a binary chain
   (§6.6). The exceptions are enumerated in the test, not waived by a wildcard.

**Plus the `span_wellformed.rs` work:** delete the `:33` corpus restriction, flip
`source_with_a_comment_is_the_one_gap_this_corpus_avoids`, and extend `CORPUS` with comment-bearing
programs so the coverage assertion covers comment bytes for the first time.

**One calibration step, deliberately not a CI test.**
`examples/rustfmt_calibration_probe.rs` emits the equivalent Rust for each corpus program, runs real
`rustfmt` over it, and diffs the shapes — so §6's rules 3, 4 and 5 are checked against rustfmt's actual
behaviour rather than against this document's author's memory of it. A probe rather than a gate because
rustfmt version drift would make it flaky, and this repo already keeps one-shot measurements in
`examples/*_probe.rs`.

## §11 What this slice does not close

- **`crates/redextape-cli` is not created.** `redextape fmt`, `lint` and the emit/run subcommands are a
  later slice; this one delivers the engine they will call.
- **`parse_asm` remains unclaimed**, exactly as the roadmap's Plan 6 survey left it. The asm form still
  prints without reading back.
- **λ, TM and asm keep their own printers.** Nothing here generalizes to them, and the calibration probe
  targets the surface language only.
- **Comment content is never linted or re-wrapped.** No `wrap_comments` equivalent, no doc-comment
  handling, no `//!`-style distinction — the language has one comment form and this treats it as opaque
  bytes.

## §12 Rejected approaches

**Comments as tokens in the stream** (`TokenKind::Comment`, parser skips trivia via a trivia-aware
`peek`/`bump`). The most conventional design, and `class_of` would pick the class up naturally as a new
match arm. Rejected because the cost lands where it hurts: `parser.rs` indexes `self.tokens[self.pos]`
directly throughout, so every peek and bump site must learn to skip trivia, and one missed site is a
**parse** bug rather than a formatting bug. `MAX_TOKENS = 100_000` would also silently change meaning —
it is a bound written about program size, and a comment-heavy file would start hitting it.

**Trivia attached to AST nodes** (`leading: Vec<Comment>` / `trailing: Option<Comment>` per node). Highest
fidelity, and it would make §7.2's `parse(print(x)) == x` cover comments directly rather than needing
§10.2 as a separate property. Rejected on blast radius: every AST variant grows fields; the hand-written
iterative destructor at `ast.rs:76` and its `take_expr_children`/`take_stmt_children` helpers must handle
them; derived `PartialEq` starts comparing comments, changing the meaning of every existing test that
compares two `Program`s; and `desugar`/`typeck` must thread past fields they have no interest in. It buys
a stronger equality by putting formatting concerns inside the tree the typechecker walks.

**A full width-aware pretty printer** (Wadler/Oppen groups and breaks over the whole AST). Best output for
method chains, nested calls and `if`/`else`, and it would generalize to the λ and TM printers later.
Rejected for this slice because comments interact with it badly: a comment forces a break (§7), which
changes fitting decisions for every enclosing group, so idempotence would need its own proof rather than
following by construction. §6.6 records the price of this rejection.

**Fixed rules with no width awareness at all.** Smaller still, and idempotent by construction. Rejected
because a 40-element list or a long method chain would emit one very long line, and in a tool whose source
pane can be dragged narrow — measured at the divider slice, roughly 89px at a 900px window — that is a
foreseeable annoyance rather than a hypothetical one.

**Comments preserved at statement granularity only**, hoisting any in-expression comment to the enclosing
statement's leading position. Simplest AST-level story. Rejected because it visibly relocates list and
argument comments away from what they annotate, which is the failure mode a reader notices first: the
`1, // first` case becomes a `// first` floating above the whole `let`.

**All comments forced to own-line.** Trivially idempotent, no same-line decision to make. Rejected because
`1, // first` becoming a line of its own above `2` reads worse than the input, on every file that uses
inline notes.

## §13 Measured against rustfmt, and two of §6's rules were wrong (2026-08-19)

§6's layout rules were written from recollection of rustfmt's behaviour. §10's calibration probe —
`examples/rustfmt_calibration_probe.rs`, run at rustfmt 1.9.0-stable — measured them. **Two of the five
were wrong, and both were wrong in the direction of extra complexity this design had invented a
justification for.**

**RULE 3 IS FALSIFIED. rustfmt fills argument lists exactly as it fills arrays.** Verbatim, at this
repo's own `max_width = 120, use_small_heuristics = Max`:

```
    f(
        aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, gggggggggg, hhhhhhhhhh, iiiiiiiiii,
        jjjjjjjjjj, kkkkkkkkkk,
    );
    let _ = [
        aaaaaaaaaa, bbbbbbbbbb, cccccccccc, dddddddddd, eeeeeeeeee, ffffffffff, gggggggggg, hhhhhhhhhh, iiiiiiiiii,
        jjjjjjjjjj, kkkkkkkkkk,
    ];
```

Same packing, same threshold, same trailing comma. The two are not treated differently at all.

**THE RATIONALE SURVIVED LONGER THAN THE FACT, WHICH IS THE PART WORTH RECORDING.** §6 rule 3 did not
merely assert a difference — it explained one: *"an argument list is a set of distinct roles, and packing
them hides which is which."* That sentence is a plausible aesthetic argument, it reads as authoritative,
and it is attached to a factual claim that measurement destroyed. It also propagated: it justified
`bracketed`'s `allow_fill` parameter, and it was quoted in the plan, in that function's doc comment, and
in a test's failure message (`"arguments never fill"`). One unmeasured sentence produced a parameter, a
branch, and an assertion — all of which are now deleted. `bracketed(open, close, items)` takes three
arguments and has one rule.

**RULE 4 IS FALSIFIED TOO**, in the same run and less interestingly: rustfmt emits a trailing comma in
fill mode, and the printer did not. `fill_rows` now does.

**WHAT THE PROBE COULD NOT SHOW ON ITS OWN, recorded because a probe that overstates its reach is worse
than no probe.** Two of the four readings needed a supplementary direct rustfmt run, because the probe's
own cases did not exercise the boundary they were supposed to measure: its "method chain" case is 105
columns wide and so stays inline on *both* sides, never testing the break rule at all; and its array case
never lands on the 10/11 element-width boundary. Both are recorded in the probe's own doc block rather
than being allowed to read as confirmations the probe earned.

**Rule 6 — binary expressions never break — stands, and was deliberately not measured for.** rustfmt
does break long binaries. That divergence is recorded in §6.6 with its price; the probe was explicitly
not permitted to overturn it, because the alternative is the general pretty-printer §12 rejected.

## §14 §7's forced-break guarantee had a hole at the brackets (2026-08-19)

§7 states the rule this slice's correctness rests on: *"emitting a comment always ends the line, and any
construct containing a comment is forced to break."* The implementation asked whether a construct
contained a comment by measuring **from the first element's start to the last element's end** — which is
not the construct. A comment between a bracket and the nearest element falls outside that range.

```
INPUT                          SHIPPED OUTPUT (before the fix)
    let xs = [1, 2 // trailing     let xs = [1, 2]; // trailing
    ];
    let y = 3;                     let y = 3;
    y                              y
```

The list does not break though it holds a comment; the comment is torn off its element and reattached to
an unrelated `;`; and a blank line appears that the author never wrote. The same failure occurs on the
leading edge (`[ // c` and `f( // c`) and for call arguments.

**IT PASSED EVERY GUARD THIS DESIGN SPECIFIED.** The output reparses, so §10.4 is satisfied. Comment
count and order are preserved, so §10.2 is satisfied — the comment is not dropped, only moved. §10.1's
idempotence holds, because the wrong output is a fixed point. **The property that would have caught it —
that a comment stays with the construct it was written against — is the one §10 never states**, and the
test that looked like it covered this, `every_comment_survives_regardless_of_where_it_sits`, counts `//`
occurrences without checking where they land.

**AND THE JUSTIFICATION WAS FALSE, WHICH IS THE SECOND TIME ON THIS BRANCH.** The helper's doc comment
read *"The AST gives spans per element, not per bracket."* It does not: `Expr::List`, `Expr::Call` and
`Expr::Method` each carry an outer span, and nothing was passing it down. The fix is one parameter, not a
reconstruction. Together with §13's *"an argument list is a set of distinct roles"* — also confidently
worded, also never checked, also wrong — this branch produced two rationales that survived review by
sounding like reasons. **A stated reason is not evidence, and this document is where that keeps being
demonstrated.**

**A second defect closed in the same pass**, narrower and mentioned so the record is complete: both
flush-to-close calls hardcoded `first = false` where the enclosing loop's own flag was in scope, so a
file or block whose entire content is comments opened with a blank line it was never given — reopening
§5's "none at file start" rule for exactly that input class.

## §15 §6.2's "collapsed" `else if` was never valid in this grammar (2026-08-19)

§6 rule 2 claimed *"`else { if c {...} else {...} }` and `else if c {...} else {...}` are the same tree,
and collapsing it is both what rustfmt does and what the author wrote."* Only the first half is true of
this language. In Rust, `else if` is sugar the parser itself desugars, so the two spellings really are one
tree. `parser.rs`'s `If` arm has no such case: after `expect(TokenKind::Else)` it calls
`parse_braced_block()` unconditionally, which requires a literal `{`. `else if` was never sugar here — it
is a token sequence this parser has always rejected.

The collapse fired on any nested `if` in an `else` branch, silently emitting output the printer's own
parser could not read back:

```
INPUT                                        SHIPPED OUTPUT (before the fix)
if a { 1 } else { if b { 2 } else { 3 } }    if a {
                                                  1
                                              } else if b {
                                                  2
                                              } else {
                                                  3
                                              }
```

Reparsing the shipped output fails with `expected `{`` at the `if` right after `else` — the exact token
the collapse omitted.

**Task 10's generative property suite found it**, unprompted, within 89 generated cases:
`idempotent_on_generated_programs` and `value_survives_on_generated_programs`
(`crates/redextape-core/tests/format_properties.rs`) both shrank to
`let v0 = if 0 > 0 { 0 } else { if 0 > 0 { 1 } else { 0 } };\nv0`. This is not an enumerated exception to
§7's invariant the way §6.6's binary chains are — **it is §7 failing outright**, for any program with a
nested `if` in an `else` position, which `arb_expr_over`'s five-arm generator (one of the five arms is
`if`) produces routinely. The hardcoded `CORPUS` in `format_properties.rs` and `printer.rs`'s own test
module happened never to nest an `if` inside an `else`, which is why `collapses_a_nested_else_into_else_if`
(asserting the printed *string*, never reparsing it) shipped and stayed green through Task 9's review.

The fix removes the collapse: `if_chain` always braces the nested `if`, exactly as written, and §6 rule 2
is corrected in place above. No design goal depended on the collapsed spelling — it was cosmetic, carried
over from rustfmt's behaviour on a grammar that, unlike this one, actually has the sugar it is short for.

## §16 Two requirements found by planning, not by measurement (2026-08-19)

§13, §14 and §15 are three rationales this document stated with confidence and this branch found wrong by
running something. The two items below are a different kind of gap: neither was ever an asserted claim to
falsify, because this document never made either claim at all. Both surfaced when the plan mapped §3-§9
onto the actual tree — `parser.rs`, `ast.rs` — rather than from anything a probe or a property caught.
Recorded here because a requirement invisible from the spec alone and only visible once the plan sat next
to the code is exactly as real a gap as a measured falsification, and belongs in the same document.

**The printer must not recurse on left-nested chains.** `parse_binary_inner` (`parser.rs:251`) climbs
precedence in a `while` loop, so `a + b + c + ...` builds a `Binary` tree as deep as the chain is long
WITHOUT the parser ever recursing to build it — `Call` and `Method` chains are built the same way. This
codebase already has the proof that a recursive walk over such a tree is not a style choice but a crash:
`ast.rs:77`'s hand-written iterative `Drop`, whose own doc (`ast.rs:67-68`) names "left-nested
`Binary`/`Call`/`Method` chains up to ~`MAX_TOKENS`/2 deep" and records that the compiler-generated
recursive destructor aborts the process (SIGABRT) on exactly that shape. §4's printer design says the
walk visits nodes in source order; it does not say, anywhere, that the walk must not recurse — that
requirement is inherited from `ast.rs`'s own precedent, not stated by this document, and a printer written
the obvious way (recurse on the left child, print, recurse on the right) has the identical defect on the
identical input class this codebase has already crashed on once. Task 4 walks all three left spines
iteratively as a result; the reviewer measured max recursion depth **3** on a 96,003-token adversarial
alternating-precedence input, against an O(n) hand-trace that had predicted otherwise and was wrong.

**The printer must re-add parentheses the AST does not store.** Binding powers (`infix_op`,
`parser.rs:374`): comparisons at 1, `+`/`-` at 2, `*` at 3, left-associative. `Expr` has no `Paren`
variant, so `(1 + 2) * 3` and `1 + 2 * 3` parse to different trees, and nothing in §3-§9 above says a
printer walking `Binary` has to compare its own binding power against its child's before deciding whether
the child needs parentheses — the design is silent on it, not wrong about it. Without that comparison
`(1 + 2) * 3` prints as `1 + 2 * 3`, a different program by §10.3's semantics property rather than a
defect this document had reasoned about and gotten wrong. It belongs in the printer's design as a
structural requirement, not as something a test was left to discover on its own.

Neither item corrects an existing claim in §1-§15, and neither earns its own numbered rule in §6: both are
things the printer must do to produce a program that means what the input meant, not layout choices among
several correct ones.

## §17 The final review: three more falsified claims, and a cost that was never measured (2026-08-19)

The whole-branch review before merge found eight items. Five were defects with a reproduction; three
were claims this document or the code made that turned out to be untrue. This section records the
three claims and the two judgement calls, in the same form as §13-§15, because the pattern they
continue is the one this document exists to demonstrate: **a stated reason is not evidence.**

### §17.1 "The AST carries bracket-to-bracket spans" was true of three variants and false of a fourth

§14 corrected the helper's doc comment — *"The AST gives spans per element, not per bracket"* — by
observing that `Expr::List`, `Expr::Call` and `Expr::Method` each carry an outer span. They do. The
correction did not check `Expr::Block`, which does not: `parse_block_body` starts a `Block`'s span at
the first token INSIDE the braces, and the `Expr::Block` arm adopted it unchanged. The printer reads
`item.span().start` as "the offset this item's printed text begins at", and for exactly one variant it
pointed past the opening token.

```
INPUT                                   SHIPPED OUTPUT (before the fix)
    let xs = [{ // c                        let xs = [ // c
    let a = 1; a }, 2];                         {
    xs                                              let a = 1;
                                                    a
                                                },
```

The comment escaped the block it was written inside, and the gap measured for blank lines ran across
the `{` and its newline, so a second format pass inserted one. **Fixed in the parser, not the printer**,
after auditing every consumer: `Expr::Block`'s span reaches only `Expr::span()`, and only the printer
distinguishes `Block` there — `typeck` and `desugar` take the inner `Block`, and `desugar` pushes no
source-map entry for the variant at all. Every other `Expr` variant already merges its own opening
token; this one now does too.

### §17.2 §7's forced break was structural in the document and caller-enforced in the code

§7: *"emitting a comment always ends the line, and any construct containing a comment is forced to
break. This is structural in the printer — the emit-comment path writes the newline itself — not a
case for a caller to remember."* `flush_before` wrote no newline. All five call sites did, and the
sixth kind of site never had one — which is precisely how Task 9's regression happened, and why
`bracketed`'s empty-construct early return skipped the break entirely for `[ // inside\n]` and
`f( // inside\n)`.

`flush_before` now ends the line, and its postcondition is stated where it can be tested: **if it
emitted anything, `out` ends with a newline.** Callers ask the buffer (`end_line()`, `col() == 0`)
instead of pushing a newline they may or may not need. The two obligations are not the same one
restated: forgetting `end_line` merges two lines the printer chose to separate, while forgetting the
old newline merged a line into a `//` and deleted a call from the program.

### §17.3 The forced break's cost had never been measured, and it was exponential

`postfix_chain`'s fit check rejects an attempt that contains a newline, and explains at length why
`col()` alone is insufficient. `bracketed` — the nested construct that check is about — asked only
`col()`, so it accepted the half-broken hybrid, which is §6's new rule 7. Making the two checks agree
is a two-word change and it made a 202-byte input take **11.5 seconds**:

```
[[[…]]] nested 16 deep, 202 bytes    11.5 s      (depth 20 did not finish)
```

An inline attempt containing a construct that breaks is doomed — a newline is exactly what
disqualifies it — so printing that construct's broken form in full is work the enclosing rewind throws
away, and doing it at every level costs two full prints of the level below. **`postfix_chain` has had
that check since Task 6 and therefore has had this cost since Task 6, and nobody measured it:** a
713-byte chain nested 22 deep took 1.82 seconds, with each further level multiplying by 2.6. That is a
hang on user input, from an input well inside `MAX_PARSE_DEPTH`, on a branch whose constraints say no
panics on user input — and a hang is the worse of the two.

`Printer::speculating` counts enclosing attempts that discard their output when a newline appears in
it. A construct about to print a broken form inside one emits a single newline and returns, and the
enclosing rewind reprints it for real once the counter reaches zero. Correctness rests on one
invariant — the counter is incremented ONLY around an attempt that unconditionally discards, which is
why a non-breakable call chain, whose output is kept whatever it looks like, does not count.

```
nested lists, depth 16    11.5 s   ->  13 us
nested chains, depth 22    1.82 s  ->  31 us
2000 statements            1.39 ms ->  0.96 ms
```

Pinned by a work counter, not a wall clock: a regression here would otherwise hang the test run
instead of failing it.

### §17.4 JUDGEMENT CALL: §6's "no input can produce an unbounded line" is corrected, not implemented

Three constructs produce an over-budget line, and §6 claimed none did:

| source | measured |
| --- | --- |
| binary chains (§6.6, already documented) | 797 columns at 200 terms |
| parameter lists — `Stmt::Fn` and `Expr::Lambda` both print `params.join(", ")` | 509 and 511 columns at 30 parameters; 1,019 at 60 |
| indentation — 4 columns per nesting level | 135 columns at depth 20, 255 at depth 50 |

**The claim is corrected rather than the code, and the reason is that fixing the code would not make
the claim true.** Parameters are `Vec<String>`: they have no spans and no `Expr`s, so `bracketed`
cannot take them, and width-handling them means a second implementation of §13's measured fill rule
over strings — the "second parallel implementation" shape `analysis.rs`'s module doc treats as a
defect, with two places for one measured rule to drift between. And even with parameter lists handled,
indentation remains: at `MAX_PARSE_DEPTH` of 300 the indent alone is 1,200 columns, and no fill rule
touches that (rustfmt has the same property). So the choice was between a claim that is still false
plus a new parallel implementation, and a claim that is true. §6.6 already prices one divergence
exactly this way. `no_line_exceeds_the_budget_except_the_three_documented_constructs` now pins all
three with inputs that overrun, so closing any of them fails the test and has to say so.

### §17.5 JUDGEMENT CALL: a statement-interior comment relocates, and that stays open

A comment with no flush point of its own — between `=` and its value, in an `Assign`, after
`|params|`, after `fn`, between a condition and its `{`, between `}` and `else` — is emitted at the
next flush point, by which time the whole statement is already in the buffer. It therefore MOVES:

```
"let a = // c\n1;\nb"  ->  "let a = 1; // c\nb\n"
```

Three of those six positions ALSO invented a blank line, because `flush_before` assigned `last_end`
from the comment it had just emitted rather than maxing it — moving the cursor backwards relative to
the buffer, so the next `blank_between` measured a gap running across the rest of the statement and
counted its newlines. **The invented blank line is closed; the relocation is not.** Giving statement
interiors their own flush points is a per-construct change to `stmt`, `if_chain` and `Lambda` with its
own placement questions, and nothing about it is forced by §7 — the output reparses, computes the same
value, and is a fixed point.

Recorded where a test can hold it: `RELOCATING_TRIVIA` in `format_properties.rs` carries these inputs
and runs every property over them EXCEPT anchoring, so exactly one property is excluded and no more.
If they ever gain a flush point, the entries move into `CORPUS` and the exclusion goes with them.

### §17.6 Two smaller behaviours this document never mentioned

**An empty block prints `{\n}` where rustfmt prints `{}`.** `braced` unconditionally opens a line for
the body and another for the `}`. Harmless and idempotent; noted so it is a decision rather than an
oversight.

**CRLF input is normalised to LF.** The printer emits `\n` and `comment_text` trims the `\r` a CRLF
line ending leaves inside a comment span, so `format` on a CRLF file returns an LF file. That is what
rustfmt does with its default `newline_style = "Auto"` only for files it detects as LF; this printer
does not detect. Recorded, not changed — the alternative is carrying a line-ending mode through every
`newline()` call for a language whose only tooling writes LF.

### §17.7 The fourth instance: `vertical_rows`'s last-element flush disagreed with `contains_comment` about where the comment was

One root cause, two symptoms, found by a whole-branch review after §17.1-§17.6 landed.
`vertical_rows`'s trailing flush computed `upto.min(self.next_boundary(item))`, where `upto` is the
next sibling element's own start for every element EXCEPT the last, which has no next sibling and used
`usize::MAX` instead — never actually saying "no farther than this construct's own close."
`next_boundary` means "the end of the line this item ends on, in the ORIGINAL SOURCE," and was not
clamped to the construct's own closing bracket. Reflowed output never puts two constructs on one line;
formatter INPUT routinely does — that is what running a formatter is for — so
`usize::MAX.min(next_boundary(item))` regularly ran straight through the construct's own `]` or `)`,
across the separator that followed it, and into a LATER SIBLING that happened to share the source line:

```
CAUSE PREDATES THIS BRANCH'S FIX WAVES; THE DEFECT IS REACHABLE ONLY FROM `9005c44` — see the
correction below the block
"fn e(x) { x }\n[{ e({}) }, [1 // c\n]]"
  -> `// c` lands inside `e(...)`'s own argument list, four levels from the list it was written
     against, and the tail list `[1]` gains a vertical break for a comment it no longer holds.

INTRODUCED BY THIS TASK'S OWN C2 FIX (the guard `bracketed`'s empty-items branch added for the
comment-only-bracket defect, commit 80b21ae, earlier on this branch)
"fn e(x) { x }\n[e({}), [ // c\n]]"
  -> `[    ]` — an empty bracket pair holding four columns of bare whitespace and nothing else.
```

**CORRECTION, BISECTED AFTER THE FACT.** The first draft of this section called the first symptom
"pre-existing" and the second "introduced by this task". Measured at `77af295`, that is half wrong: the
first input already fails idempotence there — for §17.1's separate reason — but **`// c` is still
correctly attached to its `1`**. The misattribution becomes reachable at `9005c44`, the nested-break
rule. Until that landed, `bracketed` accepted the half-broken hybrid, so these lists never broke
vertically and `vertical_rows`'s flush was never reached. **The uncapped `next_boundary` was a latent
cause the whole time; "pre-existing cause" and "pre-existing defect" are different claims, and writing
the first while meaning the second is the same shape as §13, §14 and §15.**

**AND THE GENERATOR THAT REPORTED 50,000 CLEAN CASES COULD NOT HAVE FOUND THIS.**
`arb_list_with_bracket_trivia` emits a newline after `[` and after every `,`, so every program it
produces is already laid out the way the printer would lay it out — the one shape where
`next_boundary` cannot overrun a construct. **A generator that formats its own inputs agrees with the
printer by construction.** That is why `arb_multi_construct_line` exists, and it is the sharpest
version of the §10 lesson: a property is only as good as the distribution it is sampled over, and a
distribution drawn in the output's own shape samples nothing.

`contains_comment` is what let the second half of each symptom happen. It scanned the FULL comment
list against `span` — positional against the SOURCE, oblivious to `self.next`, the cursor recording
what has actually been printed. So once a comment had already been flushed from inside an earlier
sibling's overrun, the LATER construct's own `must_break = self.contains_comment(region)` still found
it sitting inside `region` — the source text never moved — and forced a break for a comment
`flush_before` had nothing left to emit. On the empty-bracket construct that meant the C2 branch called
`indent()` unconditionally inside `if must_break`, ignoring the `bool` `flush_before` returns for
exactly this case, and produced `[` + four columns of whitespace + `]` with no newline before the
indent to justify it. Both symptoms vanish on a second format pass, once the comment has genuinely
moved to wherever it actually printed — which is what made them non-idempotent rather than simply
wrong: the reviewer's 60,000-program sweep over inputs that put several constructs on one line found
**8,334 non-idempotent and 234 with the bare-whitespace shape**.

**Fixed by making both checks agree with the cursor, not just the source.** `bracketed` now passes its
own closing bracket (`region.end`) into `vertical_rows`, which uses it — not `usize::MAX` — as the last
element's bound, so `next_boundary` can never run past a construct's own close regardless of how the
source is laid out. `contains_comment` now scans only `self.comments[self.next..]`, so a comment
already behind the cursor cannot volunteer a LATER construct for a break it does not need. And the
empty-bracket branch now checks what `flush_before` actually emitted before calling `indent()`, rather
than trusting `must_break` alone — the guard the branch needed regardless of which mechanism let
`must_break` and the cursor disagree.

> `must_break` asks where comments **are**, the flush asks where the cursor **is**, and until those two
> agree a construct can force a break for a comment it no longer holds.

**This is the fourth instance of that shape on this branch, not the first.** §14 found it first: a
construct's "does it contain a comment" range measured first-element-start to last-element-end, which
excludes a comment sitting at either bracket edge, so a bracket-edge comment escaped its own construct
and reattached wherever the printer flushed next. §17.1 found it a second time in `Expr::Block`'s span
starting past its own `{`. The empty-bracket-early-return defect — `printer.rs`'s regression suite
calls it "Final review C2," fixed in commit 80b21ae, earlier on this same branch — found it a third
time. Each had a different mechanical cause — span arithmetic, span construction, statement order — but
the same effect: a comment attributed to the wrong construct, or a break forced for one that no longer
has it. **And the C2 fix is what created this fourth instance's second symptom.** The empty-bracket
guard it added calls `indent()` on `must_break` alone, which was sound the day it was written — nothing
yet made `must_break` and the cursor disagree — and stopped being sound the moment `vertical_rows`'s
uncapped scan gave `contains_comment` a way to be right about the source and wrong about the print. A
fix wave introducing a narrower instance of the class it was closing is exactly the kind of thing this
document exists to keep on the record.

Regression coverage: `a_later_sibling_construct_on_the_same_line_does_not_donate_its_comment` and
`a_later_sibling_construct_on_the_same_line_does_not_starve_an_empty_bracket_pair` in `printer.rs` pin
both inputs above byte for byte, RED before the fix and GREEN after it. `arb_multi_construct_line` in
`format_properties.rs` is the generator arm that can find the next one:
`arb_list_with_bracket_trivia` puts one element per line by construction, so `next_boundary` never had
anywhere to overrun TO, and a suite built only on it could not have found this defect however long it
ran — `arb_multi_construct_line` found it well inside proptest's default 256-case budget against the
pre-fix printer, on both the idempotence and the anchoring property independently.
