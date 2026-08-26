# The asm text form gets a grammar — PR 3 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `grammars/tree-sitter-redextape-asm`, the fourth tree-sitter grammar, held span-for-span
against `print_asm_mapped` and `print_asm_with_mapped` by `redextape-grammar-check` — so a grammar
that colours a printed listing differently from the printer fails a test. Closes the asm-reader
slice.

**Architecture:** PR 2 of the tree-sitter slice generalised `crates/redextape-grammar-check` into a
`Grammar` value carrying its own language, queries and capture map, and promoted six shared checks
onto it. This PR adds a fourth `Grammar` and changes none of that machinery. What is new is the
*form*: the asm listing is the SMALLEST of the four corpora by an order of magnitude, its printer
distinguishes a label declaration from a jump target NOWHERE (both are `TokenClass::Label`, unlike
TM), and its instruction grammar is a direct mirror of `asm_syntax`'s seven-arm `Shape` enum.

**Tech Stack:** unchanged — tree-sitter CLI 0.25.10 (generation), `tree-sitter` Rust crate 0.26
(loading), `cc` (compiling generated C), `proptest` via `redextape-test-support`. No new
dependencies.

**Design:** [`../specs/2026-08-24-asm-reader-design.md`](../specs/2026-08-24-asm-reader-design.md)
§8, and the tree-sitter slice's own
[`../specs/2026-08-20-tree-sitter-grammars-design.md`](../specs/2026-08-20-tree-sitter-grammars-design.md)
§§5.1, 5.2, 8.1 and 12, which this slice inherits and does not reopen. PR 1 merged 2026-08-25 as #62
(`1050a19`); PR 2 merged 2026-08-25 as #63 (`8d0fe0d`).

**Every figure in this plan was run on this machine at `8d0fe0d`**, not recalled — the standard §1 of
both designs sets for itself. The commands are in the sections that quote them.

## Global Constraints

Every task's requirements implicitly include all of these.

- **Highlighting only.** No code path from a tree-sitter node to a `redextape_core` AST type.
  Reading `Span` and `TokenClass` is fine — they are data. `redextape-grammar-check`'s `lib.rs`
  module doc states the rule and names lowering as the test for "authoritative".
- **`crates/redextape-core` is NOT modified, except two doc comments.** Nothing in this PR touches
  the printer, the parser, or any `analysis::TokenClass` *variant*. Task 2 Step 0 corrects
  `TokenClass::Label`'s doc comment, which is false and which this plan's research found, and the
  same step authorises adjusting `StateName`'s alongside it so the pair reads consistently; those
  two are the whole of the relaxation. If any other task appears to need a core change, stop and say
  so.
- **Pinned toolchain:** tree-sitter CLI **`0.25.10`**, generated ABI **15**, `tree-sitter` Rust crate
  `0.26`. Use `.tools/tree-sitter`, **not** whatever is on `PATH` — `/usr/sbin/tree-sitter` is Arch's
  `master` build and reports `0.27.0`. `scripts/setup-dev.sh` installs the pin. The pin sits below
  the newest release because 0.26+ Linux binaries need glibc 2.39 and CI's runner has 2.35.
- **The grammar directory needs a `tree-sitter.json`.** Without it the CLI warns and silently
  generates **ABI 14**, which the Rust crate refuses to load. `abi_version_is_pinned` in
  `src/asm.rs` is what turns that into a message naming the real cause.
- **Node IS required** by the CLI to evaluate `grammar.js`.
- **Library code may not panic.** `[workspace.lints.clippy]` warns
  `unwrap_used`/`expect_used`/`panic`/`todo`/`unimplemented` plus `pedantic`, and CI makes warnings
  fatal. `clippy.toml` exempts those only inside a `#[test]` fn or `#[cfg(test)]` module —
  `src/*.rs` is neither. Integration tests in `tests/` may unwrap freely.
- **Nothing in this crate may reduce or simulate.** No `reduce_trace`, no `reduce`, no `run_asm`,
  no `run_tm_described`. The asm pipeline stops at `lower_asm`/`defunc` and `print_asm_mapped`.
  TM's module needed a bounded exception for its headered corpus; **this one does not**, because
  `AsmHeader` is built from `typeck::result_type` without running anything. Treat a `run_*` call in
  `src/asm.rs` as a defect.
- **One commit per task, after the tests are green.** The pre-commit hook compiles `--all-targets`
  under `-D warnings`, so a commit containing a test that calls a function which does not exist yet
  cannot build and the hook rejects it. TDD still runs test-first *within* a task; only the commit
  boundary moves. **Never `--no-verify`.**
- **No `file:line` citations in tracked source outside `docs/`** — cite symbols by name.
  `scripts/check-citations.sh` is a pre-commit hook and a CI step. **No C0 control bytes** except
  TAB, LF, CR — and `test/corpus/*.txt` is tracked source, as is every `.scm` and `.js` file here.
- **`scripts/check-doc-figures.sh` is a pre-commit hook.** The moment Task 5 writes a README with a
  numeric claim, that claim needs a row in the gate's table or the claim is unchecked; and a row
  whose locator finds nothing FAILS rather than skipping. Task 5 does both halves together.

---

## The asm text form, read from the tree at `8d0fe0d`

From `crates/redextape-core/src/tm/asm.rs` (`print_asm_mapped`, `print_asm_with_mapped`,
`instr_parts`, `operand_str`, `reg_str`, `bin_mnemonic`, `Operand::class`, `AsmHeader`,
`label_name_representable`) and `crates/redextape-core/src/tm/asm_syntax.rs` (`parse_asm_full`,
`parse_instr`, `parse_reg`, `parse_imm`, `MNEMONICS`, `Shape`).

```
file        := line*
line        := blank | ';' ...            comment, to end of line, after leading whitespace
             | 'result' ' ' TYPE          the whole header; optional; before any label or instr
             | NAME ':'                   a label declaration, at column 0
             | MNEMONIC ['\t' OPERANDS]   an instruction, indented four spaces
OPERANDS    := OPERAND (', ' OPERAND)*
OPERAND     := REGISTER | IMMEDIATE | LABEL     — which one is fixed by the MNEMONIC, not by spelling
REGISTER    := 'rr' | 'r' NAT | 'a' NAT
IMMEDIATE   := '#' NAT
TYPE        := 'Nat' | 'Bool' | 'Unit' | 'List<' TYPE '>'      — `ty::show`, no spaces
NAME        := any non-empty run with no whitespace and no `;` `:` `,`
```

**Every line kind additionally accepts a trailing `;` comment**: `parse_asm_full` splits each line at
its **first** `;` before doing anything else, exactly as `parse_tm_full` does.

**Five lexical facts that shape this grammar. Read all five before writing a line of `grammar.js`.**

1. **AN OPERAND'S KIND IS FIXED BY ITS MNEMONIC, NEVER BY ITS SPELLING.** `Operand`'s own doc says
   so — *"classified by what it IS rather than how it prints — so a label named `retry` can never be
   mistaken for a register"* — and `parse_instr` reads operands positionally off `Shape::kinds`.
   **A grammar with one generic `instruction` rule cannot express this** and would have to guess
   from spelling, which is the one thing both the printer and the parser refuse to do. So the
   grammar carries **one rule per `Shape`**, seven of them, and that is a mirror of `MNEMONICS`
   rather than an invention.
2. **`#5` is ONE span, not `#` plus `5`.** `operand_str` formats an immediate as `format!("#{n}")`
   and `print_asm_mapped` pushes a single `Nat` span over the whole thing. A grammar that lexes `#`
   as punctuation fails on span count at the first `li`.
3. **A label name is `label_name_representable`'s alphabet**: non-empty, no whitespace, no `;`, no
   `:`, no `,`. Dots and digits are ordinary characters — real labels are `skip1`, `else0`,
   `endif3`, `count_down.0` (`fresh_label` appends a counter to a hint, and a user function's hint
   is `format!("{name}.")`). Nothing like λ's `[_$A-Za-z][_$A-Za-z0-9]*` applies.
4. **`result <Ty>` is one bare word after the keyword.** `ty::show` renders a value type with no
   spaces at all — `Nat`, `List<Nat>`, `List<List<Nat>>` — and `print_asm_with_mapped` pushes ONE
   `Ident` span over it. Same shape as TM's `result` directive, and the same node: an `identifier`
   told apart by its field.
5. **THERE ARE NO BRACKETS AND NO OPERATOR CLASS.** The only punctuation the printer emits is `:`
   after a label name and `,` between operands, both `Punct`. So this grammar has one punctuation
   capture where all three siblings have two, and a `@punctuation.bracket` or `@operator` row would
   fail `every_capture_row_is_used`.

**What the printers classify — the whole authority.** `print_asm_mapped` is the listing; the header
`Option` is the only difference between the entry points, and `print_asm_with_mapped` prepends and
never perturbs (its own doc: *"The listing's bytes are IDENTICAL to `print_asm`'s"*).

| printed text | `TokenClass` | printer |
|---|---|---|
| the mnemonic (24 spellings, 16 `Instr` variants) | `Mnemonic` | both |
| `r0`, `a1`, `rr` | `Register` | both |
| `#5` — the whole token | `Nat` | both |
| a `jz`/`jmp`/`call` target | `Label` | both |
| the name in `<name>:` | `Label` | both |
| `:` and `,` | `Punct` | both |
| `result` | `Keyword` | headered only |
| the type after `result` | `Ident` | headered only |

**Five classes header-less, seven headered — measured, not read off the source:**

```
$ # via a throwaway example over print_asm_mapped / print_asm_with_mapped
header-less classes (5): {"Label", "Mnemonic", "Nat", "Punct", "Register"}
headered classes   (7): {"Ident", "Keyword", "Label", "Mnemonic", "Nat", "Punct", "Register"}
```

Design §8 says *"Five captures header-less (§1), more with the header block."* **The number is
right and the word is not** — five is the count of `TokenClass` values, and this grammar's
`queries/highlights.scm` will carry nine capture NAMES over ten pattern occurrences. §1 of that
design uses the accurate word ("five token classes"). Do not read §8's "captures" as a target for
the query file.

**Every printed non-whitespace byte carries a span.** The four-space indent, the `\t` before the
first operand, the space after each `,`, and the blank line after the header belong to no span;
everything else does. So **this grammar's queries must be TOTAL over its own tokens**, the same
constraint TM carries and neither the mini-language nor λ does: a token the queries leave
uncaptured becomes a length mismatch in `compare_classified` rather than a merely uncoloured
character.

**`emit --lang asm` writes a comment that no printer classifies.** `ASM_PREAMBLE` in
`crates/redextape-cli/src/emit.rs` prepends one `;` line — *"Register-assembly listing, read back by
parse_asm and run by redextape run."* — to every emitted file. `print_asm_mapped` and `print_asm_with_mapped`
know nothing about it. So the CLI's own output contains a token the differential structurally
cannot reach — see Task 4, which is where that goes.

---

## Sizing: this corpus is the cheapest of the four, and that is a measurement

TM's plan had to fight its corpus size and set `cases: 32` against proptest's default. **The asm
form inverts that**, and the number is what decides the case count rather than the other way round.

Measured at `8d0fe0d`, 64 programs drawn from `arb_expr_over`'s shape (`prop_recursive(3, 8, 3, …)`
over the five arms, numeric leaves `0..100`), lowered with `lower_asm` and printed with
`print_asm_mapped`:

| | λ (`print_lambda_mapped`) | TM (`print_tm_mapped`) | **asm (`print_asm_mapped`)** |
|---|---|---|---|
| mean bytes per entry | 912 | 18,905 | **146** |
| mean spans per entry | 637 | 6,865 | **36** |
| max bytes seen | 2,977 | 109,668 | **393** |
| max spans seen | — | 39,310 | **99** |
| lowering pass rate | — | 100% | **100% (64/64, zero refusals)** |

The λ and TM columns are this repository's own recorded figures (`src/tm.rs`'s `printed_machine`
doc and the TM README); the asm column was run for this plan.

**These figures replace ones quoted earlier in this plan's history, and the correction is worth
recording.** The original numbers came from a probe that approximated `arb_expr_over` with a
hand-rolled generator; that generator ignored `prop_recursive`'s `desired_size = 8` parameter and so
drew programs roughly double the size the real strategy produces. Task 3's implementer measured the
real path — through the shipped `arb_expr_over` and `printed_program`, exactly as the test does —
and reported the discrepancy rather than quietly adjusting the numbers to match. The figures above
are the corrected ones, taken from that measurement. **The sizing conclusion is unaffected**: 256
cases was affordable at the wrong figure and is more affordable at the right one.

**Consequence: take proptest's default 256, and set it EXPLICITLY with the measurement beside it.**
At 256 cases this leg parses roughly **37.6 KB** and compares roughly **9,400 spans** — about a
seventeenth of what λ's 256-case leg already compares (163K) and a thirtieth of TM's 32-case leg
(282,006). Writing `cases: 256` by hand rather than inheriting the default is the point: TM's entry
records that an inherited default is a number nobody measured, and a reader of this file should be
able to see that this one was.

**The baseline this PR is accountable to**, measured at `8d0fe0d`:

```
$ cargo nextest run -p redextape-grammar-check
     Summary [   1.042s] 44 tests run: 44 passed, 0 skipped
```

A fourth grammar that pushes this crate past roughly two seconds has been sized wrong.

---

## The fixed corpus reaches all 24 mnemonics, and that needs `lower_program`'s template

`arb_expr_over` is five arms over numeric leaves. It reaches `li`, `mov`, `add`, `sub`, `cmpeq`,
`cmpgt`, `jz`, `jmp` and `halt` and nothing else — no list op, no call, no boxing. The structurally
interesting mnemonics live in a fixed list, exactly as TM's `HEADERED_CORPUS` does.

**Measured over a 17-entry candidate list** — `asm_roundtrip.rs`'s twelve `DEMOS` verbatim, plus one
mutable-capture closure, plus four comparison programs (`!=`, `<`, `<=`, `>=`). These figures are
for `print_asm_mapped`, header-less — not the printer the shipped
`the_asm_grammar_agrees_with_the_headered_printer` actually drives:

```
entries 17, of which 1 needed the defunc retry
mnemonics reached (24/24): {add, box, box_get, box_set, call, cmpeq, cmpge, cmpgt, cmple, cmplt,
                            cmpne, cons, halt, head, isempty, jmp, jz, li, mov, mul, nil, ret, sub, tail}
mean bytes 185 / mean spans 45; max 701 bytes, 168 spans; total 3157 bytes / 776 spans
```

**The shipped test uses `print_asm_with_mapped`, headered, and each entry gains the header's bytes
and exactly 2 spans**: 776 + (17 × 2) = 810, which matches the measured total exactly.

```
mean bytes 198 / mean spans 47; max 713 bytes, 170 spans; total 3,374 bytes / 810 spans
```

**All 24 mnemonics, therefore all 16 `Instr` variants and all nine `BinOp`s.** That is strictly more
than `asm_roundtrip.rs` reaches: its
`the_demo_corpus_covers_thirteen_of_the_sixteen_instr_variants` asserts **13 of 16**, and PR 2's
roadmap entry records the missing three (`Box`, `BoxGet`, `BoxSet`) as an open gap whose cause is
that `asm_roundtrip.rs`'s `lower` helper calls `lower_asm` directly.

**The three are reachable, and the mechanism is `lower_program`'s template.** `redextape_core::tm`'s
`lower_program` is private, but two other test files in this workspace already reproduce it as a
documented duplicate (`redextape-native`'s `tests/native_oracle.rs` and `redextape-core`'s
`tests/guard_counterexamples.rs`), and `redextape_core::tm::defunc::defunc` is public. Measured:

```
box-ish=  5  bytes=  701  lines=  46  let mut acc = 0; let bump = |n| { acc = acc + n; acc }; bump(1); acc
```

Five `box`-family instructions in one 701-byte listing, via `lower_asm` → `Unsupported` → `defunc`
→ `lower_asm`. **This is a gap the grammar PR closes for free**, and it is worth saying in the
roadmap entry rather than leaving a reader to infer it: the asm grammar's differential covers the
whole mnemonic table, which no other check in this tree does.

**`emit --lang asm` cannot reach them and that is not a defect here.** `emit.rs` calls `lower_asm`
directly, so all four boxing programs above fail it with
`Unsupported { what: "assign to unbound ..." }` or `"call of unknown function ..."`. The grammar
corpus is not the CLI and does not have to match it.

---

## The blind spot this grammar has and TM does not

**In TM, `@label` and `@label.reference` project to DIFFERENT classes** — `Label` for a state name
where it is defined, `StateName` for the same name as a `start`/`goto` target — so a query that
swapped them fails the differential immediately.

**In asm they project to the SAME class.** `Operand::class` maps `Operand::Label(_)` to
`TokenClass::Label`, and `print_asm_mapped`'s `emit_label` pushes `TokenClass::Label` for a
declaration. `TokenClass::StateName`'s own doc says it is *"A TM state name in REFERENCE
position"* — there is no asm counterpart.

So: **if this grammar captures a label declaration as `@label.reference`, or a jump target as
`@label`, `compare_classified` cannot tell.** Both project to `Label`, both land on the same byte
range the printer named, and every test stays green. That is a real hole in the differential and it
is specific to this grammar.

**It is still worth carrying both captures**, for the reason TM's README gives for `@variable` and
`@type` both projecting to `Ident`: splitting the capture is what lets an editor theme a definition
differently from a reference, and the projection map is allowed to be many-to-one.
`capture_map_has_no_duplicate_keys` checks the map is a function, not an injection.

**What covers the hole instead** is Task 4's pinning test, which asserts which BYTE RANGES each of
the two capture names lands on for a fixture — not which class they project to. Write it; do not
assume the differential covers this.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `grammars/tree-sitter-redextape-asm/grammar.js` | the asm grammar — the only hand-edited grammar file |
| `grammars/tree-sitter-redextape-asm/tree-sitter.json` | metadata; **required for ABI 15** |
| `grammars/tree-sitter-redextape-asm/queries/highlights.scm` | capture assignments |
| `grammars/tree-sitter-redextape-asm/test/corpus/*.txt` | `tree-sitter test` cases over tree shape |
| `grammars/tree-sitter-redextape-asm/README.md` | what it is, how it is checked, install snippets |
| `grammars/tree-sitter-redextape-asm/src/**` | generated, committed |
| `crates/redextape-grammar-check/src/asm.rs` | asm's language, queries, map, corpus builders |
| `crates/redextape-grammar-check/tests/asm.rs` | asm's differential, capture and corpus tests |

**Modified:**

| Path | Change |
|---|---|
| `crates/redextape-grammar-check/src/lib.rs` | `pub mod asm;` and its re-export |
| `crates/redextape-grammar-check/build.rs` | compiles the fourth `parser.c` |
| `crates/redextape-core/src/analysis.rs` | Task 2 Step 0 — `TokenClass::Label`'s doc comment and `StateName`'s; comment text only, and the only relaxation of the core-not-modified rule above |
| `grammars/tree-sitter-redextape-tm/README.md` | not anticipated when this plan was written: a fourth grammar falsifies three sibling COUNTS and one sibling COMPARISON, and the whole-branch review found two more comparisons after that |
| `grammars/tree-sitter-redextape-lambda/README.md` | the same, for two counts — plus a sentence predicting in the future tense that the TM grammar would inherit a guard it inherited in August |
| `scripts/check-all.sh` | Task 4 — the `check_grammars` comment that counts three grammars and calls a fourth hypothetical |
| `scripts/check-doc-figures.sh` | Task 5 — `G_ASM`, a `map_src` arm, and the new README's rows |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | Task 6 — the closing entry |

**Deliberately NOT modified:**

- **`.forgejo/workflows/ci.yml`.** `check_grammars` globs `grammars/*/` and CI already installs the
  pinned CLI for the base tier; a fourth directory is picked up with no workflow change. Verified by
  reading the `grammar` leg and the two "Install tree-sitter CLI" steps.
- **`README.md`'s test-count paragraph.** Those figures are stated as a **dated observation** —
  *"when counted on 2026-08-24"* — precisely because no gate can afford to check them
  (`cargo nextest list --workspace` costs 218 s against the figure gate's ~150 ms). A dated
  observation does not go stale when the tree moves past it. **Do not "update" it**; that would turn
  a true sentence about 2026-08-24 into a claim about today.
- **Anything in `web/`.** The web app draws over the printer's own spans and has no use for a CST.
  Design §12 of the tree-sitter spec, which this slice does not reopen.

---

## Task 1: The asm grammar

**Files:**
- Create: `grammars/tree-sitter-redextape-asm/grammar.js`, `tree-sitter.json`, `test/corpus/*.txt`
- Create (generated, committed): `grammars/tree-sitter-redextape-asm/src/**`
- Modify: `crates/redextape-grammar-check/build.rs`

**Interfaces:**
- Consumes: nothing from this crate — a grammar is standalone until Task 2 queries it.
- Produces: the `tree_sitter_redextape_asm` symbol, and the node and field names Task 2's queries
  reference: `result` (field `type:`), `label` (field `name:`), `register`, `immediate`,
  `identifier`, `comment`, and the seven instruction nodes below (fields `target:` on two of them).

**Read "The asm text form" and "The blind spot" above before writing a line of it.**

**The extension is `asm`**, and the collision with every assembler in existence is a README line
rather than a reason to invent one — design §8 rules on it explicitly, following the `.tm`/TeXmacs
precedent. `crates/redextape-cli/src/run.rs` dispatches on it, ASCII-case-insensitively, so `.asm`
is what this project calls these files. Mirror the three existing `tree-sitter.json` files:
`"name": "redextape_asm"`, `"camelcase": "RedextapeAsm"`, `"scope": "source.asm"`,
`"file-types": ["asm"]`, `"injection-regex": "^asm$"`, and the same `metadata` block (version
`0.1.0`, `GPL-3.0-only`, author `davey`, repository `https://git.daveynet.xyz/davey/redextape`).

**The starting `grammar.js`.** This is further along than a sketch — the two hard parts were probed
against the real CLI at `0.25.10` before this plan was written, and both results are recorded below
it. Expect to iterate on the rest.

```js
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
```

**Two things in that file were probed against `.tools/tree-sitter` 0.25.10 rather than reasoned
about, and the results are why they are written the way they are:**

1. **Without `_label_name`'s aliases, a mnemonic-spelled label is an ERROR node.** A minimal
   throwaway grammar with `word: $ => $.identifier`, a `label` rule and an `add` instruction parsed
   `add:` as `(ERROR [0, 0] - [0, 4])` while `foo:` parsed as a `label`. **With** the aliases, the
   same input parsed as `(label name: (identifier))` — for `add:`, `halt:` and `foo:` alike — and
   `add r0, r1` still parsed as an instruction. **No `conflicts` declaration was needed**: LR(1)
   lookahead on `:` versus an operand settles it. If the real 25-word `RESERVED` list produces a
   conflict the two-word probe did not, resolve it by narrowing, and record what you did.
2. **A keyword valid nowhere in the current state does not shadow `identifier`.** The TM grammar
   parses `state state:` as `name: (identifier)` today, because tree-sitter's lexer only substitutes
   a keyword where that keyword token is valid. That is why the aliases are needed **only** at line
   start, where the mnemonics genuinely are valid, and not in `target:` or `type:` position.

**Three decisions this plan makes rather than leaves open, each with the constraint that settles
it:**

1. **`\n` goes in `extras`.** The authority is strictly line-oriented — `parse_asm_full` walks
   `src.split_inclusive('\n')` — so this grammar accepts `halt jmp foo` on one line where the
   authority rejects it. That is an **accept-more** divergence, the right direction for an editor,
   and it is the same choice both sibling line-oriented grammars made. **State it in `grammar.js`'s
   module doc and carry it into Task 6's entry**, the way TM's grammar.js lists its three.
2. **The seven instruction rules are named after their shape, not their mnemonics.** Node names
   appear in queries, in `test/corpus/*.txt` and in an editor's structural navigation, so
   `reg_reg_reg_instruction` beats `rrr`. Do not collapse them into one node with a repeated
   operand: fact 1 of the form section is the reason. Wrapping all seven uniformly in
   `choice(...SHAPE)` produced three `tree-sitter generate` warnings, since `R`, `RI` and `RL` hold
   exactly one mnemonic each; the `oneOf` helper collapses that singleton case in one place so the
   seven rules stay written the same way rather than gaining three special cases.
3. **No `locals.scm`.** Design §8: a label reference resolves against the program's own label
   table, which `parse_asm` builds and `Program::validate()` checks. Name resolution has an owner
   and it is not the grammar.

- [ ] **Step 1: Write the `tree-sitter test` corpus first**, in
      `grammars/tree-sitter-redextape-asm/test/corpus/`. Model the file format on
      `grammars/tree-sitter-redextape-tm/test/corpus/machines.txt`. Writing it first is what fixes
      the node and field names before Task 2's queries depend on them. At minimum, one case each
      for:
      - a header-less listing with one nullary instruction (`halt`);
      - a headered listing (`result Nat`, blank line, then the listing);
      - a nested result type (`result List<List<Nat>>`);
      - all seven instruction shapes, at least one mnemonic each;
      - a label declaration followed by an instruction;
      - a label whose name carries a dot and digits (`count_down.0`);
      - **a label spelled exactly like a mnemonic** (`halt:`) and **one spelled `result:`** — the
        two cases `_label_name` exists for;
      - a whole-line comment, and a trailing comment after an instruction;
      - an empty file.

- [ ] **Step 2: Write `grammar.js` and `tree-sitter.json`.**

- [ ] **Step 3: Generate and test.**

```bash
cd grammars/tree-sitter-redextape-asm
../../.tools/tree-sitter generate
../../.tools/tree-sitter test
grep -m1 LANGUAGE_VERSION src/parser.c    # must be 15; 14 means tree-sitter.json was not picked up
```

- [ ] **Step 4: Parse a real emitted file, end to end.** This is the cheapest end-to-end check the
      task has, and unlike TM there is no checked-in `.asm` fixture in the tree
      (`find . -name '*.asm'` was empty when the asm-reader design was written), so produce one:

```bash
printf 'fn count_down(n) { if n == 0 { 0 } else { count_down(n - 1) } } count_down(4)\n' > /tmp/cd.rxt
cargo run -q -p redextape-cli --bin redextape -- emit --lang asm --out /tmp/cd.asm /tmp/cd.rxt
cat > /tmp/ts.json <<JSON
{ "parser-directories": ["$PWD/grammars"] }
JSON
.tools/tree-sitter parse --config-path /tmp/ts.json /tmp/cd.asm
```

**`tree-sitter parse` resolves a grammar through the CLI's config, not through the working
directory.** With no config it prints *"You have not configured any parser directories"*, parses
nothing, and still exits in a way a naive `grep -c ERROR` reads as success. **Confirm the output is
a real parse tree before believing any count taken from it**, and note that the emitted file leads
with `ASM_PREAMBLE`'s comment — that line exercises `$.comment` in `extras`, which is exactly what
you want to see parse.

- [ ] **Step 5: Add the fourth `compile_grammar("tree-sitter-redextape-asm")` line to
      `crates/redextape-grammar-check/build.rs`.** **Read that file's module doc first**: one
      `cc::Build` per grammar, each with its own library name, or two grammars silently compile into
      one archive and the missing `tree_sitter_*` symbol surfaces as an undefined reference in a
      downstream crate rather than as a build-script error.

- [ ] **Step 6: Record `wc -c src/parser.c` and `wc -l grammar.js`** for Tasks 5 and 6. The siblings
      at `8d0fe0d` are 103,482 / 171 (mini), 11,483 / 78 (λ) and 42,220 / 147 (TM).

- [ ] **Step 7: Commit.**

```bash
git add grammars/tree-sitter-redextape-asm crates/redextape-grammar-check/build.rs
git commit -m "feat(grammar): a tree-sitter grammar for the asm text form"
```

---

## Task 2: The queries and the capture map

**Files:**
- Create: `grammars/tree-sitter-redextape-asm/queries/highlights.scm`
- Create: `crates/redextape-grammar-check/src/asm.rs`, `crates/redextape-grammar-check/tests/asm.rs`
- Modify: `crates/redextape-grammar-check/src/lib.rs`

**Interfaces:**
- Consumes: `Grammar` and the six checks promoted onto it in PR 2 of the tree-sitter slice; the node
  and field names Task 1 produced.
- Produces: `pub static ASM: Grammar`, plus `pub const CORPUS`, `pub const HIGHLIGHTS` and
  `pub const CAPTURE_CLASSES` in `src/asm.rs`; `pub use asm::ASM;` in `lib.rs`.

**The map, from the printer table in the form section above:**

| capture | `TokenClass` | what it covers |
|---|---|---|
| `@keyword` | `Keyword` | `result` |
| `@type` | `Ident` | the type after `result` |
| `@function` | `Mnemonic` | all 24 mnemonics |
| `@variable.builtin` | `Register` | `r0`, `a1`, `rr` |
| `@number` | `Nat` | `#5` — the whole token |
| `@label` | `Label` | the name in `<name>:` — DEFINING position |
| `@label.reference` | `Label` | a `jz`/`jmp`/`call` target |
| `@punctuation.delimiter` | `Punct` | `:` and `,` |
| `@comment` | `Comment` | a `;` comment |

**Nine capture names, nine map rows, eight distinct classes.** The one many-to-one pair is
`@label`/`@label.reference`, and the "blind spot" section above is why it is deliberate, why it
costs the differential nothing, and why Task 4 has to cover it another way.

**`@function` for a mnemonic, not `@keyword`.** They cannot share a capture: `result` is `Keyword`
and a mnemonic is `Mnemonic`, and one capture name may project to only one class
(`capture_map_has_no_duplicate_keys`). `@function` is what tree-sitter's asm grammars in the wider
ecosystem use for an opcode, and the tables are per grammar (design §5.1), so `@function` meaning
`Mnemonic` here does not disturb the mini-language's `@function` meaning `Ident`.

**`@variable.builtin` for a register**, for the same per-grammar reason. If your editor's theme has
no rule for it, the dotted-capture fallback nvim-treesitter and Helix both implement colours it as
`@variable` — the same property design §5.2 leans on for `@label.reference`.

**No `@punctuation.bracket` and no `@operator`.** The asm form has no brackets and emits no
`Operator` class at all; a row for either would fail `every_capture_row_is_used`.

**`@comment` is in the map and no printer will ever produce it.** That is not a mistake and it is
not the same thing as an unused row: `every_capture_row_is_used` asks whether a QUERY uses the row,
and one does. What it means is that the `Comment` class never appears on the authority side of the
differential, which is Task 4's subject.

**The query file, in full:**

```scheme
; Highlight queries for the Redextape asm text form.
;
; THESE MUST BE TOTAL OVER THE GRAMMAR'S OWN TOKENS. `print_asm_mapped` pushes a span for EVERY
; non-whitespace byte it writes — the `:` after a label and the `,` between operands included — so a
; token this file leaves uncaptured becomes a length mismatch in the differential rather than merely
; an uncoloured character. The four-space indent, the `\t` before the first operand and the space
; after each `,` belong to no span and there is nothing here to capture them with.
;
; NOTHING OVERLAPS. A mnemonic, a register and an immediate are each their own token; the two
; identifier roles are told apart by the FIELD they sit in. Resist adding a broad
; `(identifier) @variable` catch-all — it would land on the same byte range as the field-scoped
; patterns and ask for the wrong class where the printer disagrees. `tests/asm.rs`'s
; `a_conflicting_query_is_rejected` demonstrates exactly that failure with `(identifier) @type` —
; asm has no bare `variable` capture row, so `@type` is the row that actually lands on a label's
; span and asks for `Ident` where the printer says `Label`.

"result" @keyword
(result type: (identifier) @type)

[
  "li" "mov"
  "add" "sub" "mul" "cmpeq" "cmpne" "cmplt" "cmple" "cmpgt" "cmpge"
  "jz" "jmp" "call"
  "ret" "halt"
  "nil" "cons" "head" "tail" "isempty"
  "box" "box_get" "box_set"
] @function

(register) @variable.builtin
(immediate) @number

; A label name in DEFINING position and the same name as a jump target BOTH project to
; `TokenClass::Label` — unlike TM, where the printer distinguishes `Label` from `StateName`. The two
; captures are kept apart anyway so an editor can theme a definition differently from a reference,
; and `tests/asm.rs`'s `each_label_capture_lands_on_its_own_positions` is what checks they have not
; been swapped, because the differential structurally cannot.
(label name: (identifier) @label)
(branch_instruction target: (identifier) @label.reference)
(jump_instruction target: (identifier) @label.reference)

(comment) @comment

; `:` ends a label declaration and `,` separates operands. There are no brackets in this form and no
; `Operator` class, so this is the only punctuation row.
[":" ","] @punctuation.delimiter
```

**That is ten capture occurrences over nine names.** Both numbers are README claims in Task 5 and
gate rows; take them with the gate's own commands rather than by counting the block above:

```bash
G=grammars/tree-sitter-redextape-asm
grep -v '^;' $G/queries/highlights.scm | grep -oE '@[a-z._]+' | wc -l          # patterns
grep -v '^;' $G/queries/highlights.scm | grep -oE '@[a-z._]+' | sort -u | wc -l # capture names
```

**The `-v '^;'` is not cosmetic.** PR 1 of the tree-sitter slice recorded that without it the
mini-language's pattern count reads 14 instead of 12, because prose comments in the query file name
captures — and 14 is what that entry said before the command was run against it. The block above
names `@label`, `@label.reference`, `@variable` and `Ident` inside comments.

- [ ] **Step 0: Correct `TokenClass::Label`'s doc comment in
      `crates/redextape-core/src/analysis.rs`.** It reads *"An asm or TM label / state name in
      DEFINING position."* and that is **false**, in the one language this PR is about. `Label` has
      three producers and one of them is a reference: `Operand::class` maps `Operand::Label(_)` — a
      `jz`/`jmp`/`call` target — to `Label`, alongside `print_asm_mapped`'s declaration span and
      `print_tm_inner`'s state name. `asm.rs`'s own
      `print_asm_mapped_agrees_with_print_asm_and_classifies_every_piece` pins the whole ordered span sequence for
      `li r0, #5 / jz r0, done / halt / done:` and asserts `("done", TokenClass::Label)` **twice** —
      once for the operand, once for the definition — with a comment directly above it saying so:
      *"`done` is both the `jz` operand and the trailing label definition"*. The doc and the test
      contradict each other, three lines apart in two files.

      **Correct the doc, not the classification.** Collapsing the two positions onto one class is
      what the printer chose and this PR does not reopen it; TM's `StateName` stays a TM-only
      distinction. Reword to say that `Label` covers an asm label in EITHER position and a TM state
      name in defining position, and that `StateName` is TM-only. Adjust `StateName`'s doc if that
      reads better as a pair. **This is a one-commit, one-file, comment-only change and it goes in
      before anything that depends on reading that vocabulary correctly** — which is the whole of
      Task 2.

- [ ] **Step 1: Write the failing tests.** Create `crates/redextape-grammar-check/tests/asm.rs`.
      **Six of the seven checks are already methods on `Grammar`** — `capture_map_is_total`,
      `capture_map_has_no_duplicate_keys`, `every_capture_row_is_used`,
      `every_corpus_program_parses_without_error_nodes`, `shipped_queries_never_disagree` and
      `every_query_pattern_fires`. **Read `tests/tm.rs` and call them; do not reimplement.**
      `a_conflicting_query_is_rejected` is the one that must stay per-grammar — its doc comment in
      each `tests/*.rs` says why: the query has to name capture rows that exist in *this* grammar's
      table.

```rust
#![cfg_attr(test, allow(clippy::pedantic))]

use redextape_grammar_check::ASM;
use redextape_grammar_check::asm::CORPUS;

#[test]
fn the_capture_map_is_total_over_the_queries() {
    if let Err(why) = ASM.capture_map_is_total() {
        panic!("{why}");
    }
}

#[test]
fn the_capture_map_has_no_duplicate_keys() {
    if let Err(why) = ASM.capture_map_has_no_duplicate_keys() {
        panic!("{why}");
    }
}

#[test]
fn every_map_row_is_used_by_a_query() {
    if let Err(why) = ASM.every_capture_row_is_used() {
        panic!("{why}");
    }
}

#[test]
fn the_shipped_queries_never_disagree() {
    if let Err(why) = ASM.shipped_queries_never_disagree(CORPUS) {
        panic!("{why}");
    }
}

#[test]
fn every_corpus_program_parses_without_error_nodes() {
    if let Err(why) = ASM.every_corpus_program_parses_without_error_nodes(CORPUS) {
        panic!("{why}");
    }
}

/// Asm's mandatory half of `every_query_pattern_fires`. Three of the ten patterns — `result`'s
/// keyword, `result`'s operand and `@comment` — are unreachable from a HEADER-LESS listing, and
/// `@comment` is unreachable from any printer at all, so a `CORPUS` of bare listings would leave
/// them at zero coverage with every other test in this file still green.
#[test]
fn every_asm_query_pattern_fires_over_the_corpus() {
    if let Err(why) = ASM.every_query_pattern_fires(CORPUS) {
        panic!("{why}");
    }
}

/// THE COLLAPSE IN `captures` IS ONLY SOUND BECAUSE OVERLAPPING CAPTURES AGREE, so the check that
/// they do must be shown capable of failing. A future reader adding a catch-all to this grammar
/// would most likely write a broad `(identifier) @variable` — "so unnamed identifiers still get a
/// colour" — since that is the bare capture TM's sibling test uses for exactly this edit. The
/// conflicting query below uses `@type` instead, standing in for that same class of edit: either
/// way, a label name is an `identifier`, so the catch-all lands on the same byte range as
/// `(label name: ...) @label`.
///
/// **`@type`, because `@variable` cannot reach the branch under test here.** TM's `CAPTURE_CLASSES`
/// has a `variable` row (`encoding`'s operand), so TM's stray `@variable` there is a live capture
/// that disagrees with `@label`. Asm has no bare `variable` row — only `variable.builtin`, a
/// distinct capture name — so the same literal query would fail `captures_with` on the missing row
/// before ever reaching the disagreement it is meant to demonstrate. `@type` is the row this
/// grammar actually has that projects to `Ident`, so it lands on `(label name: ...) @label`'s span
/// and asks for `Ident` where the printer says `Label` — keeping the property under test, two
/// captures on one span disagreeing on class, genuinely reachable here.
#[test]
fn a_conflicting_query_is_rejected() {
    let conflicting = "(label name: (identifier) @label)\n(identifier) @type\n";
    let err = ASM
        .captures_with(conflicting, "halt\nfoo:\n")
        .expect_err("a label name captured as both Label and Ident must not be collapsed silently");
    assert!(err.contains("disagree"), "the message must say what happened, got: {err}");
}
```

**This test's query was corrected mid-branch.** The paragraph above and the code above it both
originally read the bare `(identifier) @variable`, matching TM's sibling test, and both were wrong
for the same reason: asm's capture map has no bare `variable` row — only `variable.builtin`, a
distinct capture name — and `Grammar::class_for` is an exact string match with no dotted-capture
fallback, so `captures_with`'s missing-row guard fires before its disagreement guard ever gets a
chance to run. `(identifier) @type` is the query that actually reaches the disagreement this test
exists to demonstrate. This repository corrects a plan mid-branch when it misdescribes the tree
rather than shipping the wrong prose — Task 1 of this branch already did the same for its
`grammar.js` block. (An earlier draft of this paragraph also cited an UNNAMED commit on the previous
slice's branch as precedent. It gave no SHA, so there was nothing a reader could check, and checking
it after the fact does not help either: squash is the only enabled merge style here, so no branch
commit lands on `main` and the roadmap says so directly. The half that stays is the one this branch
can show.)

- [ ] **Step 2: Run them and confirm they fail to compile** — `ASM` does not exist yet.

```bash
cargo nextest run -p redextape-grammar-check
```

Expected: a compile error naming `redextape_grammar_check::ASM`.

- [ ] **Step 3: Write `queries/highlights.scm`** exactly as given above.

- [ ] **Step 4: Write `crates/redextape-grammar-check/src/asm.rs`**, modelled on `src/tm.rs`. The
      `CORPUS` here is the HAND-WRITTEN one for the capture and pattern checks — the differential's
      corpus is printed and arrives in Task 3. **Every entry must parse under `parse_asm_full`**,
      which Task 4 asserts; these are hand-typed, so nothing else establishes that they are asm at
      all.

```rust
//! Asm's grammar: its generated parser, its highlight queries, its capture table, and the thin
//! wrappers over `print_asm_mapped`/`print_asm_with_mapped` that make them asm's authority.
//!
//! **TWO PRINTER ENTRY POINTS, ONE PRINTER.** `print_asm_with_mapped` prepends the header and
//! shifts the listing's spans by its byte length; the listing's bytes are identical either way.
//!
//! | printer | header | classes |
//! |---|---|---|
//! | `print_asm_mapped` | none | 5 — `Label`, `Mnemonic`, `Nat`, `Punct`, `Register` |
//! | `print_asm_with_mapped` | `AsmHeader` | 7 — those, plus `Keyword` and `Ident` |
//!
//! **NEITHER EVER EMITS `Comment`.** `emit --lang asm` writes one in `ASM_PREAMBLE`, but that is
//! the CLI prepending text no printer classifies, so `TokenClass::Comment` never appears on the
//! authority side of this crate's asm differential. See `tests/asm.rs`.
//!
//! Model the layout on `tm.rs`, which went through review — but the shapes genuinely differ here
//! and the differences are the point rather than drift.

use crate::grammar::{Grammar, compare_classified};
use redextape_core::Span;
use redextape_core::analysis::TokenClass;
use tree_sitter_language::LanguageFn;

unsafe extern "C" {
    fn tree_sitter_redextape_asm() -> *const ();
}

/// Hand-written corpus, for the capture and pattern checks — NOT for the differential, whose corpus
/// is printed (`printed_program`, `printed_program_with_header`).
///
/// **EVERY ENTRY MUST PARSE UNDER `parse_asm_full`**, which `tests/asm.rs` asserts.
///
/// Between them they reach every pattern in `queries/highlights.scm`
/// (`every_asm_query_pattern_fires_over_the_corpus`). Three of those patterns — `result`'s keyword,
/// `result`'s operand and `@comment` — are unreachable from a header-less listing, and `@comment`
/// is unreachable from any printer at all, so a corpus of bare listings would leave them at zero
/// coverage with every other test still green.
///
/// The last three entries are the residue: a comment position no printer produces, and the two
/// label names `_label_name`'s aliases exist for.
pub const CORPUS: &[(&str, &str)] = &[
    ("an empty file", ""),
    ("one nullary instruction", "    halt\n"),
    ("a label and an instruction", "foo:\n    halt\n"),
    (
        "every operand kind",
        "    li\tr0, #1\n    mov\ta0, r0\n    add\trr, r0, a0\n    jz\trr, skip1\n    jmp\tskip1\nskip1:\n    call\tskip1\n    ret\n",
    ),
    ("the list instructions", "    nil\tr0\n    cons\tr1, r0, r0\n    head\tr2, r1\n    tail\tr3, r1\n    isempty\tr4, r1\n"),
    ("the boxing instructions", "    box\tr0, r1\n    box_get\tr2, r0\n    box_set\tr0, r2\n"),
    ("a dotted, digit-bearing label name", "count_down.0:\n    ret\n"),
    ("the header, as the printer emits it", "result Nat\n\n    li\trr, #7\n    halt\n"),
    ("a nested result type", "result List<List<Nat>>\n\n    nil\trr\n    halt\n"),
    // ---- the residue: nothing in this project's PRINTER pipeline emits any of these ----
    ("a whole-line comment, as `emit --lang asm` writes one", "; Register-assembly listing\n    halt\n"),
    ("a trailing comment, which the parser accepts everywhere and no printer writes", "    halt\t; done\nfoo:  ; here\n"),
    ("labels spelled like reserved words", "halt:\nresult:\n    halt\n"),
];

/// Asm's highlight queries, compiled into the binary so the test needs no file I/O and cannot read
/// a stale copy out of a build directory.
pub const HIGHLIGHTS: &str = include_str!("../../../grammars/tree-sitter-redextape-asm/queries/highlights.scm");

/// Where the two vocabularies meet, FOR ASM. Design §5.1 of the tree-sitter spec records why the
/// tables are per-grammar.
///
/// **TWO ROWS PROJECT TO `Label` AND THE DIFFERENTIAL CANNOT TELL THEM APART.** `Operand::class`
/// maps a label operand to `Label` and `print_asm_mapped` pushes `Label` for a declaration too;
/// `TokenClass::StateName` is a TM-only distinction. The captures are kept separate so an editor
/// can theme a definition differently from a reference — the projection map is allowed to be
/// many-to-one, and `capture_map_has_no_duplicate_keys` checks it is a function, not an injection.
/// `each_label_capture_lands_on_its_own_positions` in `tests/asm.rs` is what actually holds the two
/// apart, because `compare_classified` structurally cannot.
///
/// **`@comment` HAS NO PRINTER.** It is in the map because a query uses it and
/// `capture_map_is_total` requires a row; `Comment` never appears on the authority side.
///
/// There is no `@punctuation.bracket` row and no `@operator` row: this form has no brackets and
/// emits no `Operator` class, and either row would fail `every_capture_row_is_used`.
pub const CAPTURE_CLASSES: &[(&str, TokenClass)] = &[
    ("keyword", TokenClass::Keyword),
    ("type", TokenClass::Ident),
    ("function", TokenClass::Mnemonic),
    ("variable.builtin", TokenClass::Register),
    ("number", TokenClass::Nat),
    ("label", TokenClass::Label),
    ("label.reference", TokenClass::Label),
    ("punctuation.delimiter", TokenClass::Punct),
    ("comment", TokenClass::Comment),
];

/// Asm's grammar: its generated parser, its highlight queries and its capture table together as one
/// `Grammar` value.
///
/// See `mini::MINI`'s doc comment for why `LanguageFn::from_raw` over the generated symbol, rather
/// than a hand-rolled transmute, is the sanctioned conversion.
pub static ASM: Grammar = Grammar {
    name: "asm",
    // SAFETY: `tree_sitter_redextape_asm` is generated by `tree-sitter generate` and returns a
    // pointer to a `'static` `TSLanguage`, which is exactly what `LanguageFn::from_raw` requires.
    // The ABI it was generated at is pinned to 15 and checked by `abi_version_is_pinned` below, so
    // a toolchain bump that changes it fails here by name rather than as an opaque `set_language`
    // error.
    language_fn: unsafe { LanguageFn::from_raw(tree_sitter_redextape_asm) },
    highlights: HIGHLIGHTS,
    capture_classes: CAPTURE_CLASSES,
};

/// Compare the asm grammar's projected captures against the printer's own classification of the
/// same printed text.
///
/// **THE DIRECTION MATTERS**, the same as every sibling: the printer is the authority because it is
/// the only thing that can classify asm text at all. A divergence is a defect in `grammar.js` or
/// `highlights.scm`, never a reason to relax the comparison.
///
/// # Errors
///
/// As `compare_classified`, run with asm's shipped `HIGHLIGHTS`.
pub fn compare_printed(text: &str, want: &[(Span, TokenClass)]) -> Result<(), String> {
    compare_classified(&ASM, HIGHLIGHTS, text, want)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A toolchain bump that changes the generated ABI past what the Rust crate reads presents as a
    /// bare `set_language` failure, which reads like a build error rather than a version error.
    /// Pinning it here makes the message name the real cause.
    #[test]
    fn abi_version_is_pinned() {
        assert_eq!(
            ASM.language().abi_version(),
            15,
            "regenerate with the pinned tree-sitter CLI 0.25.10; ABI 14 means tree-sitter.json was not picked up"
        );
    }
}
```

- [ ] **Step 5: Declare the module and re-export in `crates/redextape-grammar-check/src/lib.rs`.**
      Add `pub mod asm;` alongside the other three and `pub use asm::ASM;` alongside the other
      three re-exports. Keep both lists alphabetical, which puts `asm` first in each.

- [ ] **Step 6: Run the tests and confirm they pass.**

```bash
cargo nextest run -p redextape-grammar-check
```

Expected: the seven new tests in `redextape-grammar-check::asm` pass, plus `abi_version_is_pinned`
in the unit-test target. If `every_asm_query_pattern_fires_over_the_corpus` fails, it names the
0-based pattern indices that never matched — add a corpus entry that reaches them rather than
deleting the pattern.

- [ ] **Step 7: Commit.**

```bash
git add grammars/tree-sitter-redextape-asm/queries crates/redextape-grammar-check/src crates/redextape-grammar-check/tests
git commit -m "feat(grammar): asm highlight queries and its capture map"
```

---

## Task 3: The differential — two corpora, both printed

**Files:**
- Modify: `crates/redextape-grammar-check/src/asm.rs` (the corpus builders and `FIXED_CORPUS`)
- Modify: `crates/redextape-grammar-check/tests/asm.rs` (the differential legs)

**Interfaces:**
- Consumes: `ASM`, `HIGHLIGHTS`, `compare_printed` from Task 2; `arb_expr_over` from
  `redextape-test-support`.
- Produces:
  `pub fn printed_program(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)>`,
  `pub fn printed_program_with_header(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)>`,
  and `pub const FIXED_CORPUS: &[&str]`.

**Two corpora, because the two entry points reach different classes** — the same split `tm.rs`
carries and for the same reason:

| corpus | printer | how it is built | size |
|---|---|---|---|
| generated | `print_asm_mapped` | `parse` → `desugar` → lower → print | 256 proptest cases |
| fixed | `print_asm_with_mapped` | `parse` → `result_type` → `desugar` → lower → print | 17 programs |

**`cases: 256` is the measurement, not the default.** See the sizing section: 146 bytes and 36
spans per generated entry, so 256 cases is ~37.6 KB and ~9,400 spans — a seventeenth of λ's
256-case leg and a thirtieth of TM's 32-case leg. Write it explicitly with the numbers in the doc
comment so a reader can see it was measured.

**Both builders lower through `lower_program`'s template rather than `lower_asm` alone**, and that
is what reaches `box`/`box_get`/`box_set`. Reproducing the private template is a documented
duplicate with two precedents in this workspace — `redextape-native`'s `tests/native_oracle.rs` and
`redextape-core`'s `tests/guard_counterexamples.rs` both do it and both say so in a doc comment.
**Copy the ordering exactly**: try `lower_asm` on the unchanged Core first, retry through `defunc`
only on `LowerError::Unsupported`, and return `TooDeep` immediately. Lowering `let add1 = |x| x + 1;
add1(41)` through `defunc` FIRST would wrongly reject it — `lower_program`'s own doc records that
regression.

**Neither builder may run anything.** `AsmHeader` comes from `typeck::result_type`, which is a type,
not an execution. TM's headered corpus needed a bounded simulation and this one does not; a
`run_asm` here is a defect.

- [ ] **Step 1: Write the failing tests** in `crates/redextape-grammar-check/tests/asm.rs`.

```rust
use proptest::prelude::*;
use proptest::test_runner::{TestCaseError, TestRunner};
use redextape_core::analysis::TokenClass;
use redextape_grammar_check::asm::{
    CORPUS, FIXED_CORPUS, compare_printed, printed_program, printed_program_with_header,
};
use redextape_test_support::arb_expr_over;

/// The headered leg — **the only corpus in this crate that reaches `Keyword` and `Ident` for asm**,
/// and the one that reaches every mnemonic. `FIXED_CORPUS` is fixed rather than generated because
/// `arb_expr_over` is five arms over numeric leaves: it never produces a list operation, a call or
/// a mutable capture, so it reaches nine of the twenty-four mnemonics and no more.
#[test]
fn the_asm_grammar_agrees_with_the_headered_printer() {
    let mut keywords = 0;
    let mut idents = 0;
    for src in FIXED_CORPUS {
        let (text, want) =
            printed_program_with_header(src).unwrap_or_else(|| panic!("`{src}` must lower and print with a header"));
        keywords += want.iter().filter(|(_, c)| *c == TokenClass::Keyword).count();
        idents += want.iter().filter(|(_, c)| *c == TokenClass::Ident).count();
        if let Err(why) = compare_printed(&text, &want) {
            panic!("`{src}` diverged:\n{why}");
        }
    }
    assert_eq!(keywords, FIXED_CORPUS.len(), "every headered listing carries exactly one `result`");
    assert_eq!(idents, FIXED_CORPUS.len(), "every headered listing carries exactly one result type");
}

/// **The whole mnemonic table, which no other check in this tree covers.**
/// `asm_roundtrip.rs`'s `the_demo_corpus_covers_thirteen_of_the_sixteen_instr_variants` asserts 13
/// of 16 `Instr` variants, and PR 2's roadmap entry records the missing three as structural to that
/// file's `lower` helper. Lowering through `lower_program`'s template instead reaches all of them.
///
/// Counted from the printed TEXT rather than by matching on `Instr`, so this test needs nothing
/// `pub(super)` out of `redextape-core` and stays a claim about what an editor would actually see.
/// The list is written out because the printer's table (`instr_parts` plus `bin_mnemonic`) is not
/// visible from this crate; a wrong entry here fails loudly rather than silently shrinking the set.
#[test]
fn the_fixed_corpus_reaches_every_mnemonic() {
    const ALL: &[&str] = &[
        "add", "box", "box_get", "box_set", "call", "cmpeq", "cmpge", "cmpgt", "cmple", "cmplt", "cmpne", "cons",
        "halt", "head", "isempty", "jmp", "jz", "li", "mov", "mul", "nil", "ret", "sub", "tail",
    ];
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for src in FIXED_CORPUS {
        let (text, _) = printed_program_with_header(src).expect("lowers and prints");
        for line in text.lines() {
            let t = line.trim_start();
            if t.ends_with(':') || t.starts_with("result") || t.is_empty() {
                continue;
            }
            if let Some(m) = t.split(char::is_whitespace).next()
                && !m.is_empty()
            {
                seen.insert(m.to_string());
            }
        }
    }
    let want: std::collections::BTreeSet<String> = ALL.iter().map(|s| (*s).to_string()).collect();
    assert_eq!(seen, want, "the fixed corpus must print every one of the 24 mnemonics");
}

/// The header-less leg, generated.
///
/// **`cases` IS SET EXPLICITLY AND 256 IS A MEASUREMENT, NOT AN INHERITED DEFAULT.** One printed
/// asm listing averages 146 bytes and 36 spans against λ's 912/637 and TM's 18,905/6,865, so 256
/// cases parse roughly 37.6 KB and compare roughly 9,400 spans — a seventeenth of what λ's
/// 256-case leg already compares (163K) and a thirtieth of TM's 32-case leg (282,006). This is the
/// cheapest of the four corpora; if you lower it, say why.
///
/// **Reproducible on demand**: this is what `arb_expr_over` at this leaf range, through
/// `printed_program`, actually produces at 256 cases, and the `eprintln!` below prints the live
/// span total on every run.
///
/// Driven through `TestRunner` directly rather than the `proptest!` macro so the lowering pass rate
/// can be logged once after every case has run — the same reason λ's and TM's generated legs do.
/// **Expect 100%**: measured over 64 samples at this leaf range, `lower_asm` refused nothing.
#[test]
fn the_asm_grammar_agrees_with_the_printer_on_generated_programs() {
    let strategy = arb_expr_over((0u64..100).prop_map(|n| n.to_string()));
    let mut runner =
        TestRunner::new(ProptestConfig { cases: 256, source_file: Some(file!()), ..ProptestConfig::default() });
    let total = std::cell::Cell::new(0usize);
    let lowered = std::cell::Cell::new(0usize);
    let spans = std::cell::Cell::new(0usize);
    let outcome = runner.run(&strategy, |src| {
        total.set(total.get() + 1);
        let Some((text, want)) = printed_program(&src) else { return Ok(()) };
        lowered.set(lowered.get() + 1);
        spans.set(spans.get() + want.len());
        if let Err(why) = compare_printed(&text, &want) {
            return Err(TestCaseError::fail(why));
        }
        Ok(())
    });
    let (total, lowered, spans) = (total.get(), lowered.get(), spans.get());
    eprintln!("asm generated leg: {lowered}/{total} programs lowered, {spans} spans compared");
    if let Err(why) = outcome {
        panic!("{why}");
    }
    assert!(lowered >= total / 2, "only {lowered}/{total} generated programs lowered; the leg is not exercising asm");
}

/// The comparison must be capable of failing — the standard every PR in the tree-sitter slice has
/// met, and PR 1's review found `compare_classified` had shipped entirely untested.
///
/// **THIS FIRES THE LENGTH BRANCH, NOT THE PER-INDEX ONE, AND THE CHOICE IS DELIBERATE.** A subset
/// query like `[":" ","] @punctuation.delimiter` would diverge at index 0 (the mnemonic against the
/// first `,`) and never reach the length comparison. `(comment) @comment` over printed text
/// captures nothing at all — no asm printer writes a comment — so `got` is empty, the per-index
/// loop runs zero times, and every one of `want`'s spans becomes an extra on the authority side.
/// The length branch is what catches a grammar that silently captures too little.
#[test]
fn the_asm_comparison_can_fail() {
    let (text, want) = printed_program("1 + 2").expect("this program lowers");
    assert!(!want.is_empty(), "the fixture must produce spans, or this test proves nothing");
    let err = redextape_grammar_check::compare_classified(&redextape_grammar_check::ASM, "(comment) @comment", &text, &want)
        .expect_err("a query capturing nothing must not compare equal to a full classification");
    assert!(err.contains("more span(s)"), "expected a length mismatch, got: {err}");
}

/// Asm's printer spans EVERY non-whitespace byte it writes, separators included, so the grammar's
/// captures must be total over its own tokens — there is no unclassified text a query could
/// legitimately miss. `compare_printed` already enforces this implicitly through its length check;
/// this names the property, so a future query edit that drops a pattern fails with a legible reason
/// rather than as an off-by-N span count buried in a generated case.
#[test]
fn every_printed_token_is_captured() {
    for src in FIXED_CORPUS {
        let (text, want) = printed_program_with_header(src).expect("lowers and prints");
        let got = redextape_grammar_check::ASM.captures(&text).expect("the query must run");
        assert_eq!(
            got.len(),
            want.len(),
            "`{src}`: the printer wrote {} spans and the queries captured {} — asm has no unclassified tokens, so \
             any difference is a query that does not cover one",
            want.len(),
            got.len()
        );
    }
}
```

- [ ] **Step 2: Run and confirm they fail to compile** — `printed_program`,
      `printed_program_with_header` and `FIXED_CORPUS` do not exist yet.

- [ ] **Step 3: Add the builders and the fixed corpus to `crates/redextape-grammar-check/src/asm.rs`.**

```rust
/// `lower_program`'s template, reproduced. `redextape_core::tm::lower_program` is private, and this
/// is the third documented duplicate of it in this workspace — `redextape-native`'s
/// `tests/native_oracle.rs` and `redextape-core`'s `tests/guard_counterexamples.rs` are the other
/// two, both of which say so in a doc comment.
///
/// **THE ORDER IS LOAD-BEARING AND IS NOT A PREFERENCE.** Try the program as first-order Core
/// unchanged, and defunctionalize only when the direct attempt rejects it as higher-order.
/// `lower_program`'s own doc records what the other order costs: `defunc` treats any bare `Lambda`
/// in `Let`'s value position as a higher-order value-use, so defunctionalizing first regresses
/// `let add1 = |x| x + 1; add1(41)` from lowering cleanly to `LowerError`. `TooDeep` is returned
/// immediately rather than retried: it is never a signal that defunctionalizing would help.
///
/// **THIS IS WHAT REACHES `box`/`box_get`/`box_set`.** Those three `Instr` variants are emitted only
/// by `defunc`'s mutable-capture boxing rewrite, so a builder that called `lower_asm` alone would
/// leave three of the sixteen variants — and three of the twenty-four mnemonics — outside every
/// corpus in this crate.
fn lower_via_program_template(core: &redextape_core::core::Core) -> Option<redextape_core::tm::Program> {
    match redextape_core::tm::lower_asm(core) {
        Ok(p) => return Some(p),
        Err(redextape_core::tm::LowerError::Unsupported { .. }) => {}
        Err(redextape_core::tm::LowerError::TooDeep { .. }) => return None,
    }
    let defunced = redextape_core::tm::defunc::defunc(core).ok()?;
    redextape_core::tm::lower_asm(&defunced).ok()
}

/// Lower a mini-language program to a `Program` and print it HEADER-LESS with its classification,
/// or `None` when the program does not lower.
///
/// **FIVE CLASSES, NOT SEVEN.** This is `print_asm_mapped`, so no `Keyword` and no `Ident` can
/// appear in what it returns — use `printed_program_with_header` for those.
///
/// **THIS MUST NOT RUN.** The pipeline stops at the lowering and the printer. `run_asm` exists and
/// is one import away; calling it here would be the asm analogue of the reduction the λ corpus is
/// forbidden from doing, and a reviewer should treat it as a defect.
///
/// **Lowering is allowed to fail and that is not this function's failure to report.** Callers
/// filter on `None`. Measured over 64 samples of `arb_expr_over` at the leaf range in use: nothing
/// refused. The filter is real and currently idle.
#[must_use]
pub fn printed_program(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)> {
    let (program, _diagnostics) = redextape_core::parser::parse(src);
    let program = program?;
    let core = redextape_core::desugar::desugar(&program);
    let prog = lower_via_program_template(&core)?;
    Some(redextape_core::tm::print_asm_mapped(&prog))
}

/// Lower a mini-language program and print it WITH a `result` header, or `None` when it does not
/// lower or its result type is not one the directive can express.
///
/// **THIS IS THE ONLY PATH IN THIS MODULE THAT REACHES `Keyword` AND `Ident`.**
///
/// **THE HEADER IS BUILT THE WAY `emit --lang asm` BUILDS IT, DELIBERATELY.**
/// `crates/redextape-cli/src/emit.rs` runs the result type through `ty::show` and back through
/// `ty::parse_ty`, and writes a header only when that round trip succeeds — `parse_ty` admits
/// exactly `Nat`/`Bool`/`Unit`/`List<T>`, and `AsmHeader` must not carry anything its own reader
/// would reject. Constructing an `AsmHeader` some other way would produce text no writer in this
/// project emits, which is a corpus that checks something nobody would ever see.
///
/// **IT DOES NOT RUN ANYTHING.** `typeck::result_type` is a type, not an execution, which is why
/// this needs none of the bounds `tm::printed_machine_with_header` documents for its simulation.
#[must_use]
pub fn printed_program_with_header(src: &str) -> Option<(String, Vec<(Span, TokenClass)>)> {
    let (program, _diagnostics) = redextape_core::parser::parse(src);
    let program = program?;
    let ty = redextape_core::typeck::result_type(&program).ok()?;
    let core = redextape_core::desugar::desugar(&program);
    let prog = lower_via_program_template(&core)?;
    let result = redextape_core::ty::parse_ty(&redextape_core::ty::show(&ty))?;
    Some(redextape_core::tm::print_asm_with_mapped(&prog, &redextape_core::tm::AsmHeader { result }))
}

/// The FIXED list the headered corpus is built from. Fixed rather than generated because
/// `arb_expr_over` is five arms over numeric leaves and reaches nine of the twenty-four mnemonics;
/// everything structurally interesting in this form is here.
///
/// **THE FIRST TWELVE ARE `asm_roundtrip.rs`'s `DEMOS`, IN ORDER**, reused because they were
/// already chosen for `Instr`-variant coverage and are already held to the round-trip properties.
/// There is no shared `const` between the two files, so the two lists can drift; that is accepted,
/// since they answer different questions.
///
/// **THE LAST FIVE ARE THIS CRATE'S OWN ADDITIONS, EACH FOR A NAMED GAP.** The mutable-capture
/// closure is the only entry that needs the `defunc` retry and the only one that reaches
/// `box`/`box_get`/`box_set`. The four comparisons reach `cmpne`, `cmplt`, `cmple` and `cmpge`,
/// which `DEMOS` alone does not: measured, `DEMOS` plus the closure reaches 20 of 24 mnemonics and
/// this list reaches all 24 (`the_fixed_corpus_reaches_every_mnemonic`).
pub const FIXED_CORPUS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "let add1 = |x| x + 1; add1(41)",
    "head(cons(7, nil))",
    "is_empty(nil)",
    "[1, 2, 3]",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "let mut x = 1; x = x + 1; let x = x + 10; x",
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
    "tail(cons(7, nil))",
    "let mut acc = 0; let bump = |n| { acc = acc + n; acc }; bump(1); acc",
    "if 1 != 2 { 1 } else { 0 }",
    "if 1 < 2 { 1 } else { 0 }",
    "if 1 <= 2 { 1 } else { 0 }",
    "if 1 >= 2 { 1 } else { 0 }",
];
```

- [ ] **Step 4: Run the tests and confirm they pass.**

```bash
cargo nextest run -p redextape-grammar-check
```

If `the_fixed_corpus_reaches_every_mnemonic` fails, its message names the exact set difference. Do
not delete an entry from `ALL` to make it pass — add a program that reaches the missing mnemonic,
or record why it is unreachable.

- [ ] **Step 5: Measure and record the wall clock**, for Task 5's README and Task 6's entry.

```bash
cargo nextest run -p redextape-grammar-check      # 44 tests / 1.042s at 8d0fe0d — the baseline
```

**If the crate is now measured in several seconds rather than a little over one, the case count was
wrong** — halve it and measure again rather than accepting it. Record the new count and the new
time either way.

- [ ] **Step 6: Commit.**

```bash
git add crates/redextape-grammar-check
git commit -m "test(grammar): hold the asm grammar to both printers span for span"
```

---

## Task 4: The residue, and the hole the differential cannot see

**Files:**
- Modify: `crates/redextape-grammar-check/tests/asm.rs`
- Modify: `scripts/check-all.sh`

**Two things are left after Task 3, and they are different in kind.**

**One: `Comment` has no authority at all.** Neither `print_asm_mapped` nor `print_asm_with_mapped`
ever writes a `;`, so `TokenClass::Comment` cannot appear on the authority side of this
differential. This is a wider gap than TM's: TM's headered printer *does* emit `Comment` (a
`; reg` after a named tape line), so only three comment POSITIONS were left outside its
differential. Here the whole class is outside. And the gap is not theoretical — **`emit --lang asm`
writes a comment into every file it produces**, via `ASM_PREAMBLE`, so the most common `.asm` file
in existence leads with a token the differential cannot check. The treatment is the one design
§6.2/§6.3 of the tree-sitter spec established for the λ backslash alias and TM's comment residue:
hand-written corpus entries, `tree-sitter test` for tree shape, plus a test asserting the real
parser accepts each entry. **That is weaker than the differential — it checks that the text parses
under both descriptions, not that any capture agrees with a classification — and saying so is the
point.**

**Two: `@label` and `@label.reference` project to the same class**, so a swap between them is
invisible to `compare_classified`. See the "blind spot" section above. The check has to read the
byte ranges each capture NAME lands on, out of the SHIPPED `queries/highlights.scm` — not out of a
query string written into the test — so that editing the shipped file is what moves the test's
answer.

**Correction, made mid-branch:** the version of this task originally planned here drove each
pattern ALONE through `Grammar::captures_with`, passing the test its OWN hardcoded copy of the two
query fragments rather than reading `ASM.highlights`. That body pinned a real property — that the
two capture positions are disjoint in the tree the fixture produces — but it pinned it against a
string the test carried itself, so it could never observe an edit to the file it claimed to guard.
A review after Task 4 landed swapped the two capture names in the shipped `highlights.scm` and
found all 60 tests in this crate still green, `each_label_capture_lands_on_its_own_positions`
included: the exact blind spot the test exists to close, reproduced one level up, inside the test
written to close it. The fix reads the two capture ranges out of `ASM.highlights` itself through a
small helper, `ranges_by_capture`, built on `tree_sitter::{Query, QueryCursor}` directly rather than
`Grammar::captures_with` (which only ever returns the *collapsed* class, not the capture name a
range came from). Everything the test asserts — the disjointness, the fixture, the expected text
lists — is unchanged; only where the query text comes from moved.

- [ ] **Step 1: Add the parser-acceptance test.** This is the analogue of TM's
      `parse_tm_accepts_every_corpus_entry` and λ's
      `parse_lambda_succeeds_on_every_backslash_spelled_corpus_entry`. **It did not exist for λ
      until PR 2's whole-branch review found the design and the README both claiming it did — do
      not repeat that: write it, run it, and confirm it can fail** (temporarily add a corpus entry
      like `"    nope\n"` and watch it fail, then remove it).

```rust
/// The hand-written `CORPUS` is the only corpus in this module nothing else vouches for — the
/// differential's two are printed, so they are asm by construction. `parse_asm_full` is the
/// authority; if it rejects an entry, that entry is not evidence about anything.
#[test]
fn parse_asm_accepts_every_corpus_entry() {
    for (name, src) in CORPUS {
        let (prog, _header, diagnostics) = redextape_core::tm::parse_asm_full(src);
        assert!(diagnostics.is_empty(), "`{name}` must parse under the real authority cleanly, got: {diagnostics:?}");
        assert!(prog.is_some(), "`{name}` produced no program despite no diagnostics");
    }
}

/// The residue, pinned by name so a corpus edit cannot quietly drop it. **No asm printer writes a
/// `;` at all** — `emit --lang asm` prepends `ASM_PREAMBLE`, but that is the CLI, not the printer —
/// so `@comment` has no differential authority whatsoever and rests on `tree-sitter test` plus
/// `parse_asm_accepts_every_corpus_entry` above.
#[test]
fn the_corpus_carries_the_comment_positions_no_printer_emits() {
    let whole_line = CORPUS.iter().filter(|(_, s)| s.lines().any(|l| l.trim_start().starts_with(';'))).count();
    let trailing = CORPUS
        .iter()
        .filter(|(_, s)| {
            s.lines().any(|l| {
                let t = l.trim_start();
                !t.starts_with(';') && t.contains(';')
            })
        })
        .count();
    assert!(whole_line > 0, "no corpus entry carries a whole-line comment; the residue is unchecked");
    assert!(trailing > 0, "no corpus entry carries a trailing comment; the residue is unchecked");
}

use tree_sitter::{Query, QueryCursor, StreamingIterator};

/// Byte ranges captured under capture NAME `name`, read from the SHIPPED `ASM.highlights` file —
/// not a literal copy of its query text — so that editing the shipped file moves this helper's
/// answer. That is the whole point: a query hardcoded in the test would pin only that two patterns
/// disagree inside this file, and could never notice a swap in the file it claims to guard.
// This helper is not itself a `#[test]` fn, so it falls outside `clippy.toml`'s
// `allow-expect-in-tests` (that exemption reaches only code lexically inside a `#[test]` function
// or a `#[cfg(test)]` module) — allowed here directly rather than by widening the file-level
// attribute above, which every call site in this file still respects.
#[allow(clippy::expect_used)]
fn ranges_by_capture(src: &str, name: &str) -> Vec<(usize, usize)> {
    let q = Query::new(&ASM.language(), ASM.highlights).expect("the shipped queries must compile");
    let names = q.capture_names().to_vec();
    let tree = ASM.parse(src).expect("the fixture must parse");
    let mut cursor = QueryCursor::new();
    let mut out = Vec::new();
    let mut it = cursor.matches(&q, tree.root_node(), src.as_bytes());
    while let Some(m) = it.next() {
        for c in m.captures {
            if names[c.index as usize] == name {
                out.push((c.node.start_byte(), c.node.end_byte()));
            }
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// **THE ONE HOLE `compare_classified` STRUCTURALLY CANNOT SEE.** `@label` and `@label.reference`
/// both project to `TokenClass::Label` here — unlike TM, where the printer distinguishes `Label`
/// from `StateName` and a swap fails the differential immediately. So this reads the two capture
/// names apart from the SHIPPED `ASM.highlights` file, through `ranges_by_capture`, and asserts the
/// byte ranges each one lands on: a declaration capture that started matching jump targets, or the
/// reverse, changes these lists and nothing else in this crate would notice. Asserting on text and
/// ranges rather than on `TokenClass` is the point — the class is exactly what the two captures
/// share, so a class-level assertion would be blind to the same swap `compare_classified` is.
#[test]
fn each_label_capture_lands_on_its_own_positions() {
    let src = "    jz\tr0, else0\n    jmp\tendif1\nelse0:\n    call\telse0\nendif1:\n    halt\n";

    let decls = ranges_by_capture(src, "label");
    let decl_text: Vec<&str> = decls.iter().map(|(s, e)| &src[*s..*e]).collect();
    assert_eq!(decl_text, vec!["else0", "endif1"], "@label must land on declarations only");

    let refs = ranges_by_capture(src, "label.reference");
    let ref_text: Vec<&str> = refs.iter().map(|(s, e)| &src[*s..*e]).collect();
    assert_eq!(ref_text, vec!["else0", "endif1", "else0"], "@label.reference must land on targets only");

    // The two sets are disjoint by BYTE RANGE, which is the property the class equality hides.
    let decl_spans: std::collections::BTreeSet<(usize, usize)> = decls.iter().copied().collect();
    for (s, e) in &refs {
        assert!(!decl_spans.contains(&(*s, *e)), "a target at {s}..{e} was also captured as a declaration");
    }
}
```

**`ref_text`'s expected value has `else0` twice and the order is offset order, not source order** —
`ranges_by_capture` sorts by byte offset, so `else0` at the `jz` on line 1 and `else0` at the `call`
on line 4 are two distinct ranges. Run the test and read the actual list rather than trusting this
literal; if it differs, the literal is what to fix, not the grammar.

- [ ] **Step 2: Fix `scripts/check-all.sh`'s `check_grammars` comment.** It currently reads *"Three
      grammars exist today (`tree-sitter-redextape`, `tree-sitter-redextape-lambda` and
      `tree-sitter-redextape-tm`, added by PR 3) … but a FOURTH grammar whose `src/` was never
      staged would regenerate green FOREVER"*. **This PR is that fourth grammar.** The comment
      already anticipates its own staleness one sentence later — *"This comment named `-tm` as that
      hypothetical fourth until `-tm` arrived; the hazard is the untracked file, not any particular
      grammar"* — so update the count and the list, and either keep the hypothetical as a FIFTH or
      reword it so the hazard stops being tied to a number. **No logic changes**: `check_grammars`
      globs `grammars/*/`. A comment that miscounts the thing it documents is exactly the class of
      defect this slice keeps finding, and this is the second time this same comment has needed it.

- [ ] **Step 3: Run the grammar leg end to end.** There is no per-leg flag — the script takes only
      `--no-llvm`, `--no-browser`, `--llvm-only`, `--browser-only` and `--list`.

```bash
scripts/check-all.sh --no-llvm --no-browser
```

Read its `==> regenerating and testing grammars/...` lines: **all four** must appear, and
`git diff -- grammars/` must be clean afterwards. The leg also fails on any UNTRACKED file under
`grammars/` — which is precisely the hazard the comment in Step 2 describes, and the reason to run
this after `git add` rather than before.

- [ ] **Step 4: Commit.**

```bash
git add crates/redextape-grammar-check/tests/asm.rs scripts/check-all.sh
git commit -m "test(grammar): pin the label captures the differential cannot tell apart"
```

---

## Task 5: The README, and its rows in the figure gate

**Files:**
- Create: `grammars/tree-sitter-redextape-asm/README.md`
- Modify: `scripts/check-doc-figures.sh`

**These are one task because a figure without a row is unchecked and a row without a figure is a
hard failure.** `scripts/check-doc-figures.sh` is a pre-commit hook and a CI step; its table is a
REQUIRED set where every row must match **exactly once**, so zero matches fails as loudly as a wrong
number. Writing the README in one commit and the rows in another would mean a commit whose README
claims are gated by nothing, which is the exact condition the gate exists to end.

- [ ] **Step 1: Write the README**, modelled on `grammars/tree-sitter-redextape-tm/README.md` — it
      is the most recent and the closest in shape. It must carry everything the three siblings do:

  - **what it is and what it is not.** Highlighting only; `redextape_core::tm::asm_syntax`'s
    `parse_asm_full` is the parser and `print_asm_mapped` is the printer AND the classifier; this
    grammar produces a CST and never lowers it. No `locals.scm`, no injections, no folds, no
    indents (there is no `redextape fmt` for this form — design §10 puts it explicitly out of
    scope), nothing in `web/`.
  - **the form in one page**, as the grammar block near the top of this plan gives it.
  - **the four asm-specific facts**: an operand's kind comes from its mnemonic and never from its
    spelling, so there are seven instruction rules; `#5` is one token; there are no brackets and no
    `Operator` class; and a label may be spelled like a mnemonic, which is what `_label_name`'s
    aliases are for.
  - **how it is checked**: the span-for-span differential, the two corpora and how each is built,
    and the fact that this one reaches **all 24 mnemonics** where `asm_roundtrip.rs` reaches 13 of
    16 `Instr` variants.
  - **what the differential does NOT reach**: the whole `Comment` class, including the comment
    `emit --lang asm` writes into every file; and the `@label`/`@label.reference` swap, with
    `each_label_capture_lands_on_its_own_positions` named as what covers it instead.
  - **the accept-more divergences, stated** — at minimum the newline one, plus any the
    implementation adds. And the accept-LESS list, which should be empty; if `_label_name` did not
    fully close it, say exactly what is left.
  - **regenerating**: `.tools/tree-sitter`, the 0.25.10 pin, why the pin sits below the newest
    release (0.26+ needs glibc 2.39, CI's runner has 2.35), and that `tree-sitter.json` is required
    or the CLI silently generates ABI 14.
  - **installing it in an editor**: the same Neovim (`main` and `master`), Helix and Zed snippets
    the siblings carry, with `redextape_asm` / `source.asm` / `["asm"]` substituted, and
    `comment-tokens = ";"` / `line_comments = [";"]` — this form HAS comment syntax, like TM and
    unlike λ.
  - **the clonability probe, RE-RUN rather than copied.** The siblings record
    `forge.daveynet.xyz` answering `401` and `git.daveynet.xyz` answering the ref advertisement with
    HTTP 200 and a zero-byte body, which `git ls-remote` reports as exit 0 and no output. Re-run the
    three commands and quote today's results with today's date.
  - **`.asm` collides with essentially every assembler**, so an editor that already maps the
    extension needs the user to say which wins — the same paragraph TM's README carries for TeXmacs.
    Worth adding: `run.rs` dispatches on the extension ASCII-case-insensitively (`P.ASM` is an
    artifact), while tree-sitter's `file-types` matching is not, so an uppercase extension is a
    file this project runs and this grammar does not colour.

- [ ] **Step 2: Take every figure with its own command, before writing the sentence that quotes
      it.** Do not carry a number over from this plan — Task 1 through Task 4 will have moved
      several of them.

```bash
G=grammars/tree-sitter-redextape-asm
wc -l < $G/grammar.js                                                          # siblings: 171, 78, 147
wc -c < $G/src/parser.c                                                        # siblings: 103,482 / 11,483 / 42,220
grep -v '^;' $G/queries/highlights.scm | grep -oE '@[a-z._]+' | wc -l           # patterns
grep -v '^;' $G/queries/highlights.scm | grep -oE '@[a-z._]+' | sort -u | wc -l # capture names
awk '/pub const CAPTURE_CLASSES/,/^\];/' crates/redextape-grammar-check/src/asm.rs | grep -c '^    ("'
awk '/pub const CAPTURE_CLASSES/,/^\];/' crates/redextape-grammar-check/src/asm.rs \
  | grep '^    ("' | sed -E 's/.*,[[:space:]]*(TokenClass::[A-Za-z]+).*/\1/' | sort -u | wc -l
cat $G/test/corpus/* | grep -c '^===*$'                                        # halve it
```

The last one is halved because each `tree-sitter test` case is fenced by two `===` rules; the
siblings hold 16, 12 and 24 cases.

- [ ] **Step 3: Add the gate's rows.** Three edits to `scripts/check-doc-figures.sh`, in this order:

  1. `readonly G_ASM="grammars/tree-sitter-redextape-asm"` beside its three siblings.
  2. A `"$G_ASM") echo "crates/redextape-grammar-check/src/asm.rs" ;;` arm in `map_src`.
  3. One row per figure in `claims()`, in the same `readme|dir|key|desc|regex` shape. Cover at
     minimum `grammar_js_lines`, `parser_c_bytes`, `query_patterns`, `capture_names`, `map_rows`,
     `map_classes` and `corpus_cases` for this README's own claims.

**Two rules the existing table's header states, and both bite here:**

  - **A figure asserted twice is two rows, because it drifts twice.** If the README states the
    capture-name count in two sentences, write two rows with two locators.
  - **A cross-reference is a claim in one README about ANOTHER grammar**, and those are the rows
    nobody looks at when they edit. If this README compares its line count to a sibling's — TM's
    does, twice — that comparison needs its own row pointed at the sibling's directory. Anchor the
    locator on the whole clause: the first draft of the existing cross-reference rows matched a
    different figure entirely because the locator was just `mini-language's (…)`.

- [ ] **Step 4: Run both halves of the gate and read the count.**

```bash
scripts/check-doc-figures.sh --self-test
scripts/check-doc-figures.sh
```

The scan reports how many figures it checked — **24 at `8d0fe0d`**. The new number is a figure for
Task 6's entry. A "NOT FOUND" error means the locator does not match the prose you wrote: fix the
locator, never delete the row.

- [ ] **Step 5: Commit.**

```bash
git add grammars/tree-sitter-redextape-asm/README.md scripts/check-doc-figures.sh
git commit -m "docs(grammar): the asm grammar's README, and its rows in the figure gate"
```

---

## Task 6: The roadmap entry, and the PR

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**The entry is written BEFORE the pull request opens.** That is this repository's standing rule and
PR 1 of this slice paid to learn it.

- [ ] **Step 1: Read the last two `####` entries and match their shape** — a title naming the
      finding that outranks the feature, the branch and commit range, Design and Plan links, what
      closed, a **WHAT THIS DID NOT CLOSE** section, and a **VERIFICATION** block whose every figure
      carries the command that produces it.

Cover at minimum:

  - **The finding that outranks the feature: this grammar has a blind spot TM does not, and it is
    in the projection map rather than in the corpus.** `@label` and `@label.reference` both project
    to `TokenClass::Label`, because `Operand::class` gives a jump target the same class the printer
    gives a declaration. `compare_classified` therefore cannot tell a swapped pair apart — every
    span lands on the byte range the printer named, with the class the printer said, and the
    differential passes. This is the **fourth** variation on the tree-sitter slice's recurring
    finding — a grammar can be wrong exactly where nothing downstream is able to look — and the
    first where the blindness comes from the AUTHORITY'S VOCABULARY being coarser than the
    grammar's, rather than from the corpus (PR 1), the query file (PR 2) or the classifier (PR 3).
    Name `each_label_capture_lands_on_its_own_positions` as what covers it and say plainly that it
    is a weaker check than the differential.
  - **And the class those two captures share is documented as something it is not.**
    `TokenClass::Label`'s doc comment says *"in DEFINING position"*; `Operand::class` has been
    mapping a `jz`/`jmp`/`call` target to it since the asm printer's classification was written, and
    `print_asm_mapped_agrees_with_print_asm_and_classifies_every_piece` asserts `("done", TokenClass::Label)` twice —
    operand and definition — with a comment above it saying exactly that. **A doc comment and a test
    three lines apart in two files, contradicting each other, with nothing able to notice.** Fixed
    here as a comment-only change; the classification is unchanged.

  - **A rule that would have REJECTED input the real parser accepts, caught before it was written.**
    With `word: $ => $.identifier` and the mnemonics as string literals, `add:` parses as an ERROR
    node while `foo:` parses as a label — measured on a throwaway grammar under the pinned CLI
    before this plan was written. `parse_asm_full` accepts it, and says so in its own comment: the
    `strip_suffix(':')` check runs BEFORE the `result` and mnemonic dispatch, deliberately. The
    `_label_name` alias list is the fix and it needed no `conflicts` declaration. **This is the
    defect PR 1 of the tree-sitter slice recorded**, found in the design phase rather than in
    review.
  - **The design's own §8 used the wrong word for a right number.** *"Five captures header-less"*
    is five `TokenClass` values, not five capture names; the query file carries nine names over ten
    pattern occurrences. §1 of the same design uses the accurate word. Worth recording because the
    slice's previous two entries each found a design claim that was false, and this one is a claim
    that is true under one reading and false under the obvious one.
  - **The three `Instr` variants PR 2 left open are now inside a differential.** `Box`, `BoxGet` and
    `BoxSet` are emitted only by `defunc`'s mutable-capture boxing rewrite, and
    `asm_roundtrip.rs`'s coverage test still asserts 13 of 16 because its `lower` helper calls
    `lower_asm` directly. This crate's builders reproduce `lower_program`'s template instead — the
    third documented duplicate of a private function — and the fixed corpus reaches all 24
    mnemonics. **Say which gap this closes and which it does not**: `asm_roundtrip.rs`'s own
    assertion is unchanged and still reads 13 of 16.
  - **The sizing risk that dominated PR 3 of the tree-sitter slice does not exist here**, with the
    numbers: 146 bytes and 36 spans per generated entry against TM's 18,905 and 6,865 and λ's 912
    and 637. `cases: 256` is a measurement, and the entry should say so rather than leave a reader
    to assume the default was inherited.
  - **The whole `Comment` class is outside this differential, and the CLI writes one into every file
    it emits.** Wider than TM's residue, which was three comment POSITIONS with the class itself
    inside.

- [ ] **Step 2: MEASURE THE FIGURES AT PR TIME, NOT AT TASK TIME. Leave the VERIFICATION block
      empty until then.**

**Every entry in this slice so far has needed an appended correction for the identical structural
reason:** the closing entry is written in the last task, the whole-branch review then runs and
reliably lands more commits, and the entry's figures are stale by construction the moment they are
written. PR 1 of the asm-reader slice had four figures move; PR 2 of the tree-sitter slice had
three. **Take every number after the final review's fixes have landed, from the commit CI actually
passed on, and read that commit from the pull request's own `head.sha` rather than assuming it from
the branch.**

Figures to take, each with its command:

```bash
git rev-list --count 8d0fe0d..<final>                                   # commits
cargo nextest run --workspace                                            # 1,215 run / 9 skipped / 35.7s at 8d0fe0d
cargo nextest run -p redextape-grammar-check                             # 44 / 1.042s at 8d0fe0d
scripts/check-all.sh --no-llvm --no-browser                              # quote its own final line
scripts/check-doc-figures.sh                                             # 24 figures at 8d0fe0d
scripts/check-citations.sh
wc -l < grammars/tree-sitter-redextape-asm/grammar.js                    # siblings: 171, 78, 147
wc -c < grammars/tree-sitter-redextape-asm/src/parser.c                  # siblings: 103,482 / 11,483 / 42,220
grep -m1 LANGUAGE_VERSION grammars/tree-sitter-redextape-asm/src/parser.c
cd grammars/tree-sitter-redextape-asm && ../../.tools/tree-sitter test    # "Total parses: N"
```

**Two conventions this file states about its own claims, and both apply:**

  - **Name values, never relationships.** Write the number and the SHA, not "the only", "the
    largest" or "the branch head". A relationship is true until something else moves.
  - **Repeat every wall-clock claim.** CI timing on this runner varies by more than 2x for the same
    job — PR 2's entry records `rust` at 9m21s against PR 1's 3m25s, same job, same runner, nothing
    in the branch responsible.

- [ ] **Step 3: Commit the entry, push the branch, open the PR.**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "roadmap: the asm form gets a grammar, and its label captures are indistinguishable to the differential"
git push -u origin tree-sitter-asm
```

**Do not merge.** Davey reviews and merges his own PRs, and holds branches to fix findings rather
than landing and following up. Write the PR body as **one long line per paragraph** — Forgejo
renders bodies with GFM `breaks: true`, so a hard-wrapped paragraph shows as forced line breaks.

- [ ] **Step 4: When CI is green, fill the VERIFICATION block and say which commit it describes.**
      Use the gitea MCP rather than `tea api get`, which 404s everything AND exits 0. The API's run
      id is not the run number in the URL. There is no rerun endpoint — edit the PR body to
      retrigger.

**And when you fill it, re-read the paragraph that said it was empty.** PR 2's entry records that
the sentence explaining why a result was absent became false the moment the result arrived, sitting
directly above the result it denied — and the arrival is exactly the moment nobody re-reads it.

---

## Self-Review

**Spec coverage.** Design §8 (`grammars/tree-sitter-redextape-asm`, the differential, the `.asm`
extension ruling, no `locals.scm`) → Tasks 1, 2, 3 and 5. §8's "five captures header-less" →
corrected to five CLASSES in the form section, and the correction is a Task 6 bullet. §8.1 (cite
symbols, not `file:line`) → Global Constraints. §7's PR 3 scope → this whole plan. §9 risk 1 (the
24-to-16 mnemonic fold) → Task 3's `the_fixed_corpus_reaches_every_mnemonic`, which is the
grammar-side counterpart to PR 1's table differential. §9 risk 2 (the corpus is only as good as its
programs) → the same test, and the measured 24/24. §10 (`fmt`, spanned validation, a `version`
directive, `locals.scm`, `web/`) stays out entirely. The tree-sitter spec's §5.1 (per-grammar
tables) → Task 2; §5.2 (`@label`/`@label.reference`) → Task 2 and the blind-spot section, which is
where this grammar departs from TM's use of that pair; §8.1 (the CLI pin) → Global Constraints and
Task 1 Step 3; §12 stays out.

**What this plan decides that TM's left open, and why.** TM's plan handed the implementer three
open decisions (newline as extra or token; whether `word:` survives the CLI; whether `cases: 32` was
right). All three are settled here with measurements: the newline goes in `extras` with the
divergence stated, `word: $ => $.identifier` was probed against the pinned CLI along with the
`_label_name` fix it makes necessary, and `cases: 256` follows from 146 bytes / 36 spans per entry.
What is left genuinely open is only whether the 25-word `RESERVED` alias list produces an LR
conflict the two-word probe did not (Task 1, decision note 1), and the exact `ref_text` literal in
`each_label_capture_lands_on_its_own_positions` (Task 4 Step 1, which says to read the actual list).

**One task touches a file the Global Constraints otherwise fence off.** Task 2 Step 0 edits
`crates/redextape-core/src/analysis.rs`, comment text only, because `TokenClass::Label`'s doc is
false for the one language this PR is about and Task 2 is where a reader has to trust that
vocabulary. TM's PR did the same thing for `web/` and stated the limit the same way: comment text,
that file, no further.

**Placeholder scan.** No step says "add appropriate error handling", "write tests for the above" or
"similar to Task N". Every code step carries the code. The one place a step says "modelled on" —
Task 5 Step 1's README — enumerates the eleven things the model must supply rather than pointing at
the sibling and stopping.

**Type consistency.** `ASM: Grammar` is defined in Task 2 and used in Tasks 2, 3 and 4.
`printed_program` (header-less) and `printed_program_with_header` (headered) are both defined in
Task 3 and return the same `Option<(String, Vec<(Span, TokenClass)>)>` shape, so one
`compare_printed` serves both. `CORPUS` is the hand-written `&[(&str, &str)]` from Task 2, read by
the six `Grammar` checks and by Task 4's parser-acceptance test; `FIXED_CORPUS` is the `&[&str]`
from Task 3, read only by the differential legs. The two are different types on purpose — the first
carries names for error messages, the second is mini-language source. Node and field names produced
by Task 1 (`result`/`type:`, `label`/`name:`, `branch_instruction`/`target:`,
`jump_instruction`/`target:`, `register`, `immediate`, `identifier`, `comment`) are exactly those
Tasks 2 and 4 reference, and Task 1 Step 1 writes the `tree-sitter test` corpus before the grammar
so the names are chosen once.

**One thing this plan asserts that a reviewer should check rather than trust.** The claim that
`_label_name`'s aliases close the accept-less divergence completely rests on a **two-word** probe
(`add`, `halt`). The real list is 25 words, several of which share prefixes (`box`, `box_get`,
`box_set`). If `tree-sitter generate` reports a conflict, that is the place, and narrowing the token
— never widening a rule to swallow the other's text — is the resolution the slice's earlier grammars
used.
