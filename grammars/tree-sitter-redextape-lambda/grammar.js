/**
 * The redextape λ text form, for editor highlighting ONLY.
 *
 * THIS IS NOT AN AUTHORITATIVE GRAMMAR. `crates/redextape-core/src/lambda/syntax.rs` is the semantic
 * source of truth; this file may never be lowered into a term. Agreement is enforced by
 * `crates/redextape-grammar-check`, which compares every highlight capture against
 * `print_lambda_mapped` span for span.
 *
 * `\` AND `λ` ARE BOTH ACCEPTED, and that asymmetry is deliberate upstream: `parse_lambda` takes
 * either, `print_lambda` emits only `λ`. So `λ` is the canonical form and `\` is a permanent input
 * alias, because it is what a keyboard types. The differential can only ever see the `λ` half — its
 * corpus is printer-produced — so the `\` arm rests on `tree-sitter test` alone. Design §6.2.
 *
 * `?<index>` IS DELIBERATELY NOT ACCEPTED. A free variable prints as `?0`, and `parse_lambda` rejects
 * it too, so that an open term fails to reparse loudly rather than silently rebinding. Rejecting it
 * here is agreement with the authority, not a gap in this grammar.
 */
module.exports = grammar({
  name: 'redextape_lambda',

  // λ's `skip_ws` (`syntax.rs`) tests `char::is_whitespace()`, the Unicode White_Space property —
  // wider than the mini-language lexer's `is_ascii_whitespace()` (`parser.rs`), so this set is
  // deliberately wider than `tree-sitter-redextape/grammar.js`'s `extras`. Do not "harmonise" the
  // two by copying this class over there: the mini-language's `/\s/` is NEARLY right for
  // `is_ascii_whitespace()`, not exactly — it diverges on one code point, U+000B VERTICAL TAB, which
  // its `/\s/` accepts and `is_ascii_whitespace()` rejects. That is a known open item for a later PR,
  // not fixed here. This class is right for λ's Unicode authority regardless of that sibling gap.
  // The class lists exactly the code points `char::is_whitespace()` accepts: U+0009-U+000D, U+0020,
  // U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
  extras: $ => [/[\t-\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/],

  rules: {
    // Accepts empty and whitespace-only input (the authority's `parse_lambda` errors "expected a
    // term" on both). Deliberate, not a divergence: `optional(...)` at `source_file` is the
    // tree-sitter convention, and it is the right one for an editor, where an empty or
    // still-being-typed buffer is not itself an error. Do not "fix" this into matching the
    // authority — that would make every new file open with an error underline.
    source_file: $ => optional($._term),

    // Application by juxtaposition, LEFT-associative: `f x y` is `(f x) y`.
    _term: $ => choice($.abstraction, $.application, $._atom),

    // Precedence 1, above `abstraction`'s implicit 0: at the shift/reduce choice between extending
    // an application (shift another argument in) and reducing to close off an enclosing abstraction
    // body early, the higher-precedence production wins, so application keeps shifting. That is what
    // makes `f λx. x y` parse as `f (λx. x y)` and not `(f (λx. x)) y` — see the `abstraction` rule's
    // comment for why the authority requires exactly that shape.
    application: $ => prec.left(1, seq(
      field('function', choice($.application, $._atom)),
      // An abstraction is a legal argument: `parse_application`'s loop tests for `'\\' | 'λ' | '('
      // | is_ident_start` before calling `parse_atom`, and `parse_atom`'s first arm on `\`/`λ` is
      // `parse_abstraction` — so the authority accepts `f λx. x` as `f (λx. x)`. `_atom` alone
      // (excluding abstraction) would reject it and mis-parse the abstraction as a sibling of
      // whatever this application sits inside.
      field('argument', choice($._atom, $.abstraction)),
    )),

    // The body runs as far right as it can, which is what `parse_abstraction` calling `parse_term`
    // (not `parse_atom`) produces: `λx. f x` is `λx. (f x)`, never `(λx. f) x`. `prec.right` says the
    // same thing to the generated parser: at the conflict above, prefer shifting more into this
    // rule's `body` over reducing the abstraction as already complete.
    abstraction: $ => prec.right(seq(
      choice('\\', 'λ'),
      field('parameter', $.identifier),
      '.',
      field('body', $._term),
    )),

    _atom: $ => choice($.parenthesized_term, $.identifier),

    parenthesized_term: $ => seq('(', $._term, ')'),

    // `$` is legal in start position AND inside: the lowering names its store-passing binder
    // `$store`, and `$` is this project's marker for a compiler-generated name the surface syntax
    // cannot forge. Matches `is_ident_start` / `is_ident_continue`.
    identifier: $ => /[_$A-Za-z][_$A-Za-z0-9]*/,
  },
});
