/**
 * The Redextape TM text form — HIGHLIGHTING ONLY.
 *
 * Not authoritative. `redextape_core::tm::syntax`'s `parse_tm_full` is the parser, and
 * `print_tm_inner` (through `print_tm_mapped` and `print_tm_with_mapped`) is the printer AND the
 * classifier. This grammar is held to that classifier span for span by
 * `crates/redextape-grammar-check`; a disagreement is a defect here, never there.
 *
 * ## The form is LINE-ORIENTED and this grammar is not, deliberately
 *
 * `parse_tm_full` walks `src.split_inclusive('\n')` and decides each line's kind from its leading
 * token. A newline is therefore structural to the authority. Here it is in `extras`, so this grammar
 * accepts `tapes 5 start pc0` on one line where the authority rejects it.
 *
 * THAT IS AN ACCEPT-MORE DIVERGENCE AND IT IS THE RIGHT DIRECTION FOR AN EDITOR, which is where a
 * half-typed buffer is not an error worth underlining. It is also unreachable by the differential,
 * whose corpus is printed output and therefore always one construct per line. The opposite
 * divergence — a rule REJECTING input the real parser accepts — is the one PR 1 recorded as a defect,
 * and nothing here does that.
 *
 * There are THREE accept-more divergences in total, and this is the list:
 *
 *   1. one construct per line is not enforced (above);
 *   2. header directives are not required to precede the first `state`, where `header_position`
 *      returns a diagnostic if they do not;
 *   3. a header is not required to be COMPLETE. `HeaderParts::finish` answers "incomplete header:
 *      missing ..." unless all four of `encoding`/`width`/`slots`/`result` are present once ANY
 *      header directive is, and it separately rejects a `tape <i>` whose index falls outside
 *      `0..n_tapes`. This grammar has no opinion about either, because both are whole-file
 *      properties and a CST is the wrong place to check them — an editor should not underline a
 *      header the moment you type its first line.
 *
 * Every one of the three is unreachable from printed output, so none of them can reach the
 * differential; they matter only to a hand-typed buffer, where accepting more is the point.
 *
 * The one place a newline still matters is `comment`, whose pattern stops at the end of its line. A
 * comment pattern matching "any character" INCLUDING the newline would eat the following line,
 * silently deleting constructs from the tree, and the differential would report that as a span-count
 * mismatch a hundred lines further down rather than as a comment problem.
 *
 * ## ONE BARE-WORD TOKEN, DISTINGUISHED BY FIELD RATHER THAN BY PATTERN
 *
 * A state name is whatever is left after trimming: the module doc's rule is "no whitespace or
 * reserved `; * : [ ]`", so `wl1s2.s.sk0` and `add4.a.c.cwb` are single names and dots and digits are
 * ordinary characters. An encoding name (`unary`), a result type (`List<Nat>`) and a packed tape run
 * (`#0000#0000#`) all fall inside that same class. They are ONE token, `identifier`, because they
 * genuinely are one lexical class in this form — and `queries/highlights.scm` tells them apart by the
 * FIELD they sit in, which is what lets `state pc0:` be a `@label` and `goto pc0` a
 * `@label.reference` without two identically-patterned tokens fighting in the lexer.
 *
 * Two things are deliberately NOT `identifier`:
 *   - `symbol` is a SINGLE character, because `write_syms` pushes one span per symbol inside `[..]`
 *     while `write_header` pushes ONE span for a whole packed run. Same-looking text, two span
 *     shapes, so two nodes.
 *   - `head_move` is `/[LRS]/` rather than the string literals 'L'/'R'/'S', to keep them out of
 *     tree-sitter's keyword extraction, which is driven by `word` below and has no business
 *     inspecting the inside of a `move [..]` group.
 *
 * ## What this grammar does NOT accept, on purpose
 *
 *   - `<state 7>` — `write_state_name`'s fallback for a `Machine` whose `next` is out of range. It
 *     contains spaces, `Machine::validate()` rejects such a machine and `lower_tm` never builds one.
 *     Widening `identifier` to admit it would be shaping a rule around text no authority produces.
 *   - `result (Nat, Nat) -> Nat` — `show` can render a `Ty::Fun`, but `HeaderParts::directive`
 *     rejects one (D5: `result` must be a value type, `Nat | Bool | Unit | List<T>`), so a file
 *     carrying it does not re-parse and is outside the representable subset either way.
 */
module.exports = grammar({
  name: 'redextape_tm',

  // The mini-language's `extras` answers to `is_ascii_whitespace()` and λ's to
  // `char::is_whitespace()`. THIS one answers to neither: `parse_tm_full` does its own line splitting
  // and then `trim_start()`/`trim()`, which is `char::is_whitespace()` — but every construct here is
  // separated by literal spaces the printer wrote, and the header's `strip_prefix("tapes ")` family
  // requires a literal SPACE rather than any whitespace. The narrow ASCII set is what the printer
  // actually emits; widening it would claim agreement this grammar has no authority to check.
  extras: $ => [/[ \t\r\n]/, $.comment],

  // Makes the generated parser extract the keywords below from `identifier`, so `state` is a keyword
  // and `stateful` is a name. Without it, `identifier` swallows every keyword.
  word: $ => $.identifier,

  rules: {
    source_file: $ => repeat($._line),

    // Order is NOT enforced. `parse_tm_full` requires header directives to precede the first `state`
    // (`header_position` returns a diagnostic otherwise) and this grammar does not, which is the same
    // accept-more choice as the newline one above. The printer always emits them in position.
    _line: $ => choice($.tapes, $.start, $._directive, $.tape, $.state),

    tapes: $ => seq('tapes', $.number),

    start: $ => seq('start', field('target', $.identifier)),

    // One node per directive rather than a shared `(directive key: value:)`, because the queries must
    // give `encoding`'s operand and `result`'s operand DIFFERENT captures (`@variable` and `@type`,
    // both projecting to `Ident`) and `captures_with` does not evaluate query predicates — an
    // `#eq?` on the key would be ignored and would over-capture.
    _directive: $ => choice($.version, $.encoding, $.width, $.slots, $.result),

    version: $ => seq('version', $.number),
    encoding: $ => seq('encoding', field('name', $.identifier)),
    width: $ => seq('width', $.number),
    slots: $ => seq('slots', $.number),
    result: $ => seq('result', field('type', $.identifier)),

    // `cells` is optional: `TmHeader::new` drops empty tapes, so a written `tape` line always has a
    // run — but `parse_cells` answers `[]` for an empty one, so the form admits it.
    tape: $ => seq('tape', field('index', $.number), optional(field('cells', $.identifier))),

    // Rules nest INSIDE their state rather than sitting beside it. `parse_tm_full` attaches each rule
    // line to `states.last_mut()`, so nesting is what the authority already means; it also gives an
    // editor something to fold. An `accept` state carries no rules — `print_tm` drops them and
    // `Machine::validate()` rejects any that survive — so the choice is exclusive here too.
    state: $ => seq('state', field('name', $.identifier), ':', choice('accept', repeat($.rule))),

    rule: $ => seq(
      field('read', $.group),
      '->',
      'write', field('write', $.group), ',',
      'move', field('move', $.move_group), ',',
      'goto', field('target', $.identifier),
    ),

    group: $ => seq('[', repeat($.symbol), ']'),
    move_group: $ => seq('[', repeat($.head_move), ']'),

    // `*` is the read-wildcard / write-unchanged marker and is excluded from `identifier`, so it is
    // spelled out here. Everything else is ONE character: `_` is the blank, and the tape alphabet is
    // `_ # 1 0 @`.
    symbol: $ => choice('*', $._symbol_char),
    _symbol_char: _ => token(/[^\s;*:\[\]]/),

    head_move: _ => token(/[LRS]/),

    number: _ => token(/[0-9]+/),

    // "No whitespace or reserved `; * : [ ]`" — the module doc's own rule, spelled as a character
    // class. BOTH brackets need a backslash inside the class — tree-sitter's regex engine rejects a
    // bare `[` there as an unclosed character class, which is a generate-time error, not a silent one.
    identifier: _ => token(/[^\s;*:\[\]]+/),

    // MUST NOT CROSS A NEWLINE. `parse_tm_full` strips a whole-line comment before dispatch and every
    // line kind splits at its FIRST `;`, so a comment ends at the end of its line and nowhere else.
    comment: _ => token(seq(';', /[^\n]*/)),
  },
});
