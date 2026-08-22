/**
 * The redextape mini-language, for editor highlighting ONLY.
 *
 * THIS IS NOT AN AUTHORITATIVE GRAMMAR. `crates/redextape-core/src/parser.rs` is the semantic source
 * of truth and owns the canonical printer; this file may never be lowered into Core. Its agreement
 * with the real front end is enforced by `crates/redextape-grammar-check`, which compares every
 * highlight capture against `analysis::classify_source` span for span.
 *
 * NO KNOWN DIVERGENCE FROM THE REAL PARSER, and an earlier draft of this file had one. That draft
 * excluded braced blocks from callee, receiver and condition position — `_expression_except_block`,
 * the device Rust's own tree-sitter grammar uses — assuming `while n > 0 { .. }` would otherwise be
 * ambiguous. It is not: the generated parser resolves all three positions with no declared conflict.
 * The exclusion was REJECTING INPUT THE REAL PARSER ACCEPTS: `parse_postfix` runs its call and method
 * postfixes on any atom `parse_atom` produced, blocks included, so `{ f }(1)`, `{ f }.m(1)` and
 * `while { a } { b }` are all legal and all came back as ERROR nodes. In an editor that shows a valid
 * file as an error region, and nothing in CI would have caught it — the differential refuses a source
 * that produces ERROR nodes rather than comparing it.
 */
module.exports = grammar({
  name: 'redextape',

  // `word` makes the generated parser extract keywords from this token, which is what stops
  // `letter` from lexing as `let` followed by `ter`.
  word: $ => $.identifier,

  // The class lists EXACTLY the code points `is_ascii_whitespace()` accepts — the WhatWG Infra set:
  // TAB, LF, FF, CR, SPACE. It was `/\s/`, which is nearly right and diverges on ONE code point,
  // U+000B VERTICAL TAB: `/\s/` accepts it and the lexer's `is_ascii_whitespace()` rejects it, so the
  // grammar parsed a file the front end refuses. POSIX counts VT as whitespace and Rust does not,
  // which is the whole disagreement.
  //
  // THE DIFFERENTIAL COULD NOT SEE THIS, which is why it survived two PRs. `classify_source` is total
  // on malformed input: it skips the byte and emits no span for it, so it returns the same spans
  // either way and the span comparison passes. `the_grammar_and_the_lexer_agree_on_every_ascii_
  // whitespace_candidate` in `redextape-grammar-check`'s `tests/captures.rs` asks `parser::parse`
  // instead, which is the only authority that can answer.
  //
  // DO NOT HARMONISE THIS WITH `tree-sitter-redextape-lambda`'s `extras`, which is deliberately wider:
  // λ's `skip_ws` tests `char::is_whitespace()`, the Unicode White_Space property. Two grammars, two
  // authorities, and the classes are only both correct while each answers to its own.
  extras: $ => [/[\t\n\f\r ]/, $.comment],

  rules: {
    // A source file is a block body with no braces: statements, then an optional tail expression
    // carrying no semicolon.
    source_file: $ => seq(repeat($._statement), optional($._expression)),

    _statement: $ => choice(
      $.let_statement,
      $.function_definition,
      $.while_statement,
      $.assignment,
      $.expression_statement,
    ),

    let_statement: $ => seq(
      'let',
      optional('mut'),
      field('name', $.identifier),
      '=',
      field('value', $._expression),
      ';',
    ),

    function_definition: $ => seq(
      'fn',
      field('name', $.identifier),
      '(',
      optional($.parameters),
      ')',
      field('body', $.block),
    ),

    while_statement: $ => seq(
      'while',
      field('condition', $._expression),
      field('body', $.block),
    ),

    assignment: $ => seq(
      field('target', $.identifier),
      '=',
      field('value', $._expression),
      ';',
    ),

    expression_statement: $ => seq($._expression, ';'),

    block: $ => seq('{', repeat($._statement), optional($._expression), '}'),

    parameters: $ => seq(
      field('parameter', $.identifier),
      repeat(seq(',', field('parameter', $.identifier))),
      optional(','),
    ),

    arguments: $ => seq($._expression, repeat(seq(',', $._expression)), optional(',')),

    // Blocks are included. See the note above on why excluding them was wrong.
    _expression: $ => choice(
      $.binary_expression,
      $.call_expression,
      $.method_call,
      $.if_expression,
      $.closure,
      $.list,
      $.parenthesized_expression,
      $.block,
      $.identifier,
      $.number,
      $.boolean,
    ),

    // Binding powers mirror `parser.rs`'s `infix_op` exactly: comparisons 1, additive 2,
    // multiplicative 3, all left-associative (`parse_binary_inner` recurses at `bp + 1`).
    binary_expression: $ => choice(
      prec.left(1, seq($._expression, choice('==', '!=', '<', '<=', '>', '>='), $._expression)),
      prec.left(2, seq($._expression, choice('+', '-'), $._expression)),
      prec.left(3, seq($._expression, '*', $._expression)),
    ),

    // Postfix binds tighter than any infix operator, matching `parse_postfix` running inside
    // `parse_binary_inner`'s operand position.
    call_expression: $ => prec(10, seq(
      field('function', $._expression),
      '(',
      optional($.arguments),
      ')',
    )),

    method_call: $ => prec(10, seq(
      field('receiver', $._expression),
      '.',
      field('method', $.identifier),
      '(',
      optional($.arguments),
      ')',
    )),

    // `else` is REQUIRED — `parse_atom` calls `expect(TokenKind::Else)`. There is no `else if`.
    if_expression: $ => seq(
      'if',
      field('condition', $._expression),
      field('consequence', $.block),
      'else',
      field('alternative', $.block),
    ),

    closure: $ => seq('|', optional($.parameters), '|', field('body', $._expression)),

    // Deliberately NOT `optional($.arguments)`: `arguments` is a named node (see `call_expression`
    // and `method_call`), and reusing it here would wrap each element in an extra `arguments` node.
    // `parser.rs`'s `Expr::List` holds a flat `Vec<Expr>` with no such wrapper, so this inlines the
    // same comma / trailing-comma pattern `arguments` uses without introducing the wrapper node.
    list: $ => seq(
      '[',
      optional(seq($._expression, repeat(seq(',', $._expression)), optional(','))),
      ']',
    ),

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    identifier: $ => /[_A-Za-z][_A-Za-z0-9]*/,

    number: $ => /[0-9]+/,

    boolean: $ => choice('true', 'false'),

    comment: $ => token(seq('//', /[^\n]*/)),
  },
});
