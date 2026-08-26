/**
 * The Redextape register-assembly text form — HIGHLIGHTING ONLY.
 *
 * Not authoritative. `redextape_core::tm::asm_syntax`'s `parse_asm_full` is the parser, and
 * `print_asm_mapped` (through `print_asm_with_mapped`) is the printer AND the classifier. This
 * grammar is held to that classifier span for span by `crates/redextape-grammar-check`; a
 * disagreement is a defect here, never there.
 *
 * ## The form is LINE-ORIENTED and this grammar is not, deliberately
 *
 * `parse_asm_full` walks `src.split_inclusive('\n')` and decides each line's kind from its first
 * `;`-delimited, trimmed text. A newline is therefore structural to the authority. Here it is in
 * `extras`, so this grammar accepts `halt jmp foo` on one line where the authority rejects it.
 *
 * THAT IS THE ONE ACCEPT-MORE DIVERGENCE THIS GRAMMAR HAS, and it is the right direction for an
 * editor, which is where a half-typed buffer is not an error worth underlining. It is also
 * unreachable by the differential, whose corpus is printed output and therefore always one
 * construct per line. The opposite divergence — a rule REJECTING input the real parser accepts — is
 * the one PR 1 of the tree-sitter slice recorded as the defect to avoid, and the aliasing below
 * exists to close exactly that hole rather than open a new one.
 *
 * The one place a newline still matters is `comment`, whose pattern stops at the end of its line. A
 * comment pattern matching "any character" INCLUDING the newline would eat the following line,
 * silently deleting constructs from the tree, and the differential would report that as a
 * span-count mismatch a hundred lines further down rather than as a comment problem.
 *
 * ## A LABEL MAY BE SPELLED LIKE A MNEMONIC, AND THE AUTHORITY SAYS SO FIRST
 *
 * `parse_asm_full` checks `strip_suffix(':')` BEFORE it dispatches on `result` or on a mnemonic —
 * its own comment says the label check "must win over the `result` directive dispatch", and the
 * same order applies to every mnemonic: `add:` is a label, not a truncated `add` instruction.
 *
 * Without `_label_name`'s aliases, `word: $ => $.identifier` would make tree-sitter's automatic
 * keyword extraction claim `add` as the `reg_reg_reg_instruction` keyword everywhere the literal
 * text `add` appears, including at the position `_label_name` occupies — turning `add:` into an
 * ERROR node, a rule REJECTING input the real parser accepts. Aliasing each reserved word to
 * `$.identifier` inside `_label_name` gives the lexer a second, equally valid reading of that exact
 * text in label position, and LR(1) lookahead on the token that follows (`:` versus an operand, or
 * versus a type name for `result`) settles which reading applies — no `conflicts` declaration is
 * needed. This was probed against `.tools/tree-sitter` 0.25.10 before it was written: a minimal
 * grammar without the aliases parsed `add:` as `(ERROR [0, 0] - [0, 4])` while `foo:` parsed clean;
 * with the aliases, `add:`, `halt:` and `foo:` all parsed as `(label name: (identifier))` and
 * `add r0, r1` still parsed as an instruction.
 *
 * The aliases are needed ONLY at line start, where the mnemonics and `result` genuinely are valid
 * productions. Tree-sitter's keyword substitution only fires where the keyword token is valid in the
 * current parser state — a fact the TM grammar's `state state:` already demonstrates (the second
 * `state` reads as a plain identifier, because the `state` keyword is not valid there) — so `target:`
 * and `type:` position need no aliasing of their own: `$.identifier` already accepts any reserved
 * spelling there.
 *
 * ## SEVEN INSTRUCTION RULES, NAMED AFTER THEIR SHAPE, NOT COLLAPSED INTO ONE
 *
 * An operand's kind is fixed by its MNEMONIC, never by its spelling — `Operand`'s own doc says a
 * label named `retry` can never be mistaken for a register. A single generic `instruction` rule with
 * a repeated operand cannot express that: it would have to guess an operand's kind from its
 * spelling, which is the one thing both the printer and the parser refuse to do. So there is one
 * rule per `Shape`, a direct mirror of `MNEMONICS` rather than an invention, and the rules are named
 * `nullary_instruction` / `reg_instruction` / `reg_reg_instruction` / `reg_reg_reg_instruction` /
 * `imm_instruction` / `branch_instruction` / `jump_instruction` because those names are what appears
 * in queries, in `test/corpus/*.txt`, and in an editor's structural navigation.
 *
 * ## No `locals.scm`
 *
 * A label reference resolves against the program's own label table, which `parse_asm` builds and
 * `Program::validate()` checks. Name resolution has an owner and it is not this grammar.
 */

// The 24 mnemonics `MNEMONICS` (asm_syntax) holds, grouped by the `Shape` that decides how many
// operands follow and what each one IS. The grouping is the whole reason there are seven
// instruction rules rather than one: an operand's kind comes from its mnemonic, never from its
// spelling, so a rule that read operands generically could not tell `jz r0, retry` apart from
// `mov r0, r1` without guessing.
const NULLARY = ['ret', 'halt'];
const R       = ['nil'];
const RR      = ['mov', 'head', 'tail', 'isempty', 'box', 'box_get', 'box_set'];
const RRR     = ['add', 'sub', 'mul', 'cmpeq', 'cmpne', 'cmplt', 'cmple', 'cmpgt', 'cmpge', 'cons'];
const RI      = ['li'];
const RL      = ['jz'];
const L       = ['jmp', 'call'];

// The header directive's keyword. Spelled once here and used both in `RESERVED` and in the
// `result` rule below, because those two spellings MUST agree: if `RESERVED` ever lost it, a
// label literally named `result:` would stop parsing, and `parse_asm_full` handles that case
// explicitly.
const RESULT = 'result';

// `choice()` of a single element is a `tree-sitter generate` warning ("contains a `seq` or
// `choice` rule with a single element"), which three of the seven shapes below hit today since
// they hold exactly one mnemonic (`R`, `RI`, `RL`). `oneOf` collapses that case in one place so
// all seven rules stay written the same way rather than special-casing three of them.
const oneOf = xs => (xs.length === 1 ? xs[0] : choice(...xs));

// Every word this grammar spells as a string literal, and therefore every word tree-sitter's
// keyword extraction would otherwise refuse to read as a label name. See `_label_name`.
const RESERVED = [...NULLARY, ...R, ...RR, ...RRR, ...RI, ...RL, ...L, RESULT];

module.exports = grammar({
  name: 'redextape_asm',

  extras: $ => [/[ \t\r\n]/, $.comment],

  word: $ => $.identifier,

  rules: {
    source_file: $ => repeat($._line),

    _line: $ => choice($.result, $.label, $._instruction),

    // The whole header. One directive, and `AsmHeader`'s doc says why there is no `version`: the
    // asm form has had one encoding since it existed, and a directive with a single legal value is
    // a field nothing can use.
    result: $ => seq(RESULT, field('type', $.identifier)),

    label: $ => seq(field('name', $._label_name), ':'),

    // A LABEL MAY BE SPELLED LIKE A MNEMONIC, AND THE AUTHORITY SAYS SO FIRST. `parse_asm_full`
    // checks `strip_suffix(':')` BEFORE it dispatches on `result` or on a mnemonic, with its own
    // comment explaining that order. Without these aliases, `word: $ => $.identifier` makes
    // `add:` an ERROR node — see the module doc above for the probe that confirmed it. The alias
    // makes each one a plain `(identifier)` in the tree, so `queries/highlights.scm`'s
    // `(label name: (identifier) @label)` still fires on it.
    _label_name: $ => choice($.identifier, ...RESERVED.map(w => alias(w, $.identifier))),

    _instruction: $ => choice(
      $.nullary_instruction,
      $.reg_instruction,
      $.reg_reg_instruction,
      $.reg_reg_reg_instruction,
      $.imm_instruction,
      $.branch_instruction,
      $.jump_instruction,
    ),

    nullary_instruction:     _  => oneOf(NULLARY),
    reg_instruction:         $  => seq(oneOf(R),   $.register),
    reg_reg_instruction:     $  => seq(oneOf(RR),  $.register, ',', $.register),
    reg_reg_reg_instruction: $  => seq(oneOf(RRR), $.register, ',', $.register, ',', $.register),
    imm_instruction:         $  => seq(oneOf(RI),  $.register, ',', $.immediate),
    branch_instruction:      $  => seq(oneOf(RL),  $.register, ',', field('target', $.identifier)),
    jump_instruction:        $  => seq(oneOf(L),   field('target', $.identifier)),

    // `rr` FIRST. The three spellings `reg_str` produces, and the three `parse_reg` reads back.
    // The reader is more permissive than the printer is precise — `r007` reads as `Reg::Loc(7)`
    // and prints back as `r7` — and this pattern matches the reader, since a hand-typed buffer is
    // what an editor colours.
    register: _ => token(/rr|r[0-9]+|a[0-9]+/),

    // ONE TOKEN INCLUDING THE `#`. `operand_str` writes `format!("#{n}")` and the printer pushes a
    // single `Nat` span over the whole thing; splitting it costs a span-count mismatch at the first
    // `li`.
    immediate: _ => token(/#[0-9]+/),

    // `label_name_representable`'s alphabet, spelled as a character class: non-empty, no
    // whitespace, and none of `; : ,` — the format's own separators. A `>` or `<` is ordinary,
    // which is what lets `result List<Nat>` be one token in `type:` position.
    identifier: _ => token(/[^\s;:,]+/),

    // MUST NOT CROSS A NEWLINE. `parse_asm_full` splits each line at its first `;`, so a comment
    // ends at the end of its line and nowhere else. A `/;.*/` that ate the following line would
    // silently delete constructs from the tree and surface as a span-count mismatch a hundred lines
    // further down rather than as a comment problem.
    comment: _ => token(seq(';', /[^\n]*/)),
  },
});
