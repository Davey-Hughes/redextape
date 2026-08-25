# The asm text form gets a reader — design

**Slice:** `asm-reader`. Closes `parse_asm`, promised by the roadmap's Plan 3 key-interface list and
named as unclaimed by **10** roadmap entries, counted with the command the roadmap itself carries for
the purpose:

```
$ awk '/^#### /{n++} /parse_asm/{h[n]=1} END{for(i=1;i<=n;i++)c+=h[i]; print c}' \
    docs/superpowers/plans/2026-07-19-redextape-roadmap.md
10
```

**One-line statement of what this is:** the register-assembly text form becomes readable — a parser
held to its own printer, a validator that makes the printer's losses checkable rather than silent, a
CLI path that runs a `.asm` file, and a fourth tree-sitter grammar that the missing parser was
blocking.

**Scope boundary, decided before anything else:** the printer does not move. `print_asm` stays
byte-identical through all three PRs; every property, header and grammar is built around the bytes it
already emits. §3 is the reason, and §4 is what that costs.

---

## §1 The tree as it stands — verified at `91bda96`, 2026-08-24

Every claim below was run, not recalled.

**`crates/redextape-core/src/tm/asm.rs` is 1,295 lines and prints without reading.** It defines
`Program { code: Vec<Instr>, labels: Vec<(String, usize)> }` (`asm.rs:61`), `print_asm` (`:151`) and
`print_asm_mapped` (`:158`), the VM `run_asm` (`:335`), and the decoders `decode_asm` (`:513`) and
`decode_asm_ty` (`:619`). Nothing parses.

**The form it emits.** Labels at column 0 as `name:`; instructions indented four spaces as
`mnemonic\top1, op2`, one per line. The `\t` before the first operand and the space after each `,`
belong to no span; the `,` is punctuation. `print_asm_mapped` is the only place that joins mnemonic
and operands into text, so the separator and the classification cannot disagree.

**Operands print by kind, and the kind is fixed by the mnemonic.** `Reg::Loc(n)` → `r{n}`,
`Reg::Arg(n)` → `a{n}`, `Reg::Rr` → `rr`; an immediate → `#{n}`; a label → its bare name.
`instr_parts` (`:126`) maps each `Instr` to `(mnemonic, Vec<Operand>)`, and `Operand` is classified by
what it IS rather than how it spells — the comment at `:96` says so, and gives the reason: a label
named `retry` must never be mistaken for a register.

**Sizes, each with the command that produced it:**

```
16   Instr variants        awk '/^pub enum Instr/,/^}/' .../asm.rs | grep -cE '^    [A-Z][A-Za-z]*(\(|,)'
15   fixed mnemonics       awk '/^fn instr_parts/,/^}/' .../asm.rs | grep -c '=> ("'
9    Bin mnemonics         awk '/^fn bin_mnemonic/,/^}/' .../asm.rs | grep -c '=> "'
5    token classes         grep -o 'C::[A-Za-z]*' .../asm.rs | sort -u
1295 asm.rs lines          wc -l < crates/redextape-core/src/tm/asm.rs
1083 tm/syntax.rs lines    wc -l < crates/redextape-core/src/tm/syntax.rs
```

**24 mnemonics, not 16.** `Instr::Bin` carries a `BinOp` and prints as one of nine (`add`, `sub`,
`mul`, `cmpeq`, `cmpne`, `cmplt`, `cmple`, `cmpgt`, `cmpge`), so the parser's mnemonic table has 15 +
9 = 24 entries against 16 variants. The parser must fold nine mnemonics back into one variant, which
is the one place its table is not a mirror image of the printer's.

**The five token classes are `Label`, `Mnemonic`, `Nat`, `Punct`, `Register`** — the whole capture
vocabulary the grammar of PR 3 has to project onto, and smaller than TM's seven.

**`print_asm`'s consumers, all four:** the `redextape_core::tm` re-export (`tm.rs:21`),
`span_wellformed.rs:131`, `examples/tm_demo.rs:111`, and `redextape-cli`'s `emit.rs:121`. There are no
`.asm` golden FILES anywhere in the tree — `find . -name '*.asm'` is empty — so the printer's output
is pinned by inline assertions and by `span_wellformed`'s offset checks, not by fixtures.

**`run_asm` already makes every check this design calls validation, but lazily.** An undefined label
faults at `:383`, `:391` and `:398`; a register at or over `MAX_REGISTERS` (1,000,000, `:225`) faults
at `:340`. All are reached only when the instruction executes, so a `jmp typo` on a branch that never
fires runs clean to completion today.

**`Program::label_index` returns the FIRST match** (`:69`), so a duplicate name is silently shadowed
rather than reported.

**`lower_asm`'s label alphabet.** `fresh_label` appends a counter to a hint (`lower_asm.rs:83`); the
hints are `skip` (`:205`), `else` and `endif` (`:382`, `:383`), `while` and `endwhile` (`:433`,
`:434`), and `format!("{name}.")` for a user function name (`:204`). So real labels look like `skip7`,
`endwhile3` and `count_down.2` — identifier characters plus a `.`.

**Labels are pushed in non-decreasing index order.** `lower_asm.rs:130` pushes `(name, code.len())`,
and `code.len()` only grows. This is load-bearing for §3's second property.

### §1.1 Sibling precedent, which this design follows rather than reinvents

**`parse_tm` (`tm/syntax.rs:281`) is the shape.** `(Option<Machine>, Vec<Diagnostic>)`, iterative over
a flat line grammar, no recursion, never panics; blank lines and `;` comments skipped; `parse_tm_full`
(`:299`) additionally returns the header, and a header-less file is not an error.

**`Machine::validate() -> Vec<String>` (`machine.rs:76`) is the validator shape** — plain strings, no
spans, called by whoever wants the check. It already flags out-of-range targets, duplicate state
names, and — directly analogous to this design's §3.3 — a state name that is not *representable*
(`name_representable`: no whitespace, no `; * : [ ]`).

**The TM header is the decode story.** `result <Ty>` is parsed through `ty::parse_ty` (`ty.rs:79`,
`pub`) and restricted to value types — `Nat | Bool | Unit | List<T>` — with `Fun`/`Var` rejected where
they are WRITTEN rather than decoding to a silent `None` where they are read (`syntax.rs:382`). That
directive is why a bare `.tm` file prints `42` instead of a machine word.

---

## §2 What ships

Three PRs, phased in §7.

1. **`parse_asm`** — a reader for the form §1 describes, plus `parse_asm`'s validator sibling
   `Program::validate()`, plus the two round-trip properties of §3, plus removal of every
   current-tense claim in the tree that says the form cannot be read.
2. **An optional header and a CLI path** — `result <Ty>` on TM's optionality model, `emit --lang asm`
   writing it, `redextape run prog.asm` reading it and decoding through `decode_asm_ty`.
3. **`tree-sitter-redextape-asm`** — the fourth grammar, held span-for-span against
   `print_asm_mapped` by `redextape-grammar-check`, exactly as the three before it.

---

## §3 The round-trip contract, and the three asymmetries that shape it

`parse(print(p)) == p` is **false** for an arbitrary `Program`, in three independent ways. All three
were found by reading `print_asm_mapped`, not by testing.

### §3.1 Out-of-range labels are dropped

`labels_at` is `vec![Vec::new(); prog.code.len() + 1]` and the bucketing loop uses `get_mut(*at)`, so a
label at an index greater than `code.len()` silently goes nowhere. The code comment at `:173` already
records this — *"a label further past the end is dropped by `get_mut`, which is what the old scan did
too"* — as a deliberate match to prior behaviour, not as an accident.

### §3.2 Label order is normalized across indices

`labels` is a `Vec` in construction order. The printer buckets by index and emits bucket 0 first, so
`[("b", 1), ("a", 0)]` prints `a:` before `b:` and parses back as `[("a", 0), ("b", 1)]` — the same
program, a different `Vec`. Order WITHIN one index is preserved, deliberately: the printer's comment at
`:170` calls that order load-bearing and says *"the goldens pin that"*. What actually pins it is
inline assertions and `span_wellformed`'s offsets, since there are no `.asm` fixture files (§1); the
comment's word is recorded here as the printer's own, not adopted as a description of the tree.

### §3.3 Label names are unconstrained by the type

**CORRECTED 2026-08-24, during PR 1's Task 6. The sentence this section was built on is false, and it
was falsified by a test written to confirm it.** It read: *"`String` admits a space, a `:`, a newline,
and the empty string. None can be read back."* The first sentence is true; the second is wrong, and
wrong in a way that matters — several of those names round-trip **byte-identically**.

`String` admits a space, a `,`, a `:`, a `;`, a newline and the empty string, none of which the type
rules out. But **whether a name survives print-then-parse is not a property of its characters alone.**
It depends on whether the name appears as a label DECLARATION or as a jump/call OPERAND, and, for
whitespace, on whether it sits at an edge or in the interior. Measured, not assumed:

| name | as a DECLARATION | as an OPERAND |
| --- | --- | --- |
| interior space | survives byte-identically | survives byte-identically |
| leading/trailing space | **silently trimmed** — different name, no diagnostic | **silently trimmed** — different name, no diagnostic |
| `,` | survives byte-identically | parse error (operand count) |
| interior `:` | survives byte-identically | survives byte-identically |
| name ENDING in `:` | survives (`foo::` strips back to `foo:`) | **the instruction vanishes** — see below |
| `;` | parse error (the comment split cuts the line) | **silently truncated** to a shorter name |
| empty | parse error | parse error |

**The worst case is a name that itself ends in `:`, and it is silent.** The printed operand line
`    jmp\tfoo:` ends in `:`, so `parse_asm`'s line-level label check reads the WHOLE LINE — mnemonic
included — as a declaration of a label named `jmp\tfoo`. The instruction is dropped and nothing is
reported.

**No single sentence like "none can be read back" is true.** Failure ranges across a clean parse
error, a silently different name, and a silently dropped instruction, and three of the shapes do not
fail at all. §4's `label_name_representable` answers this the same conservative way
`Machine::validate`'s `name_representable` does — reject every character that is unsafe in ANY
position — and that stays correct even though it also rejects names that happen to survive, because
**`validate` checks names and not occurrences**: it cannot know where a given label will be used.

**Why this section was wrong is worth more than the correction.** The claim was written from the
format's separator list — reasoning about what the grammar *ought* to do to those characters — and
never run. The reader's actual behaviour differs per position, which no amount of reading the
separator list would have revealed.

### §3.4 The contract

**The printer does not move** (§2's scope boundary), so the contract is stated over a restricted
domain rather than bought by changing bytes. Two properties, not one:

- **P1, over text.** `print(parse(t)) == t` for every `t` the printer produced. This is the property
  the form actually needs: printer output is the canonical form, and the parser is required to be its
  exact inverse there. Held over the existing demo corpus.
- **P2, over programs.** `parse(print(p)) == p` for every `p` whose `validate()` is empty and whose
  `labels` are non-decreasing in index. **`lower_asm` produces both by construction** — §1's last two
  paragraphs are the evidence — so the generator is `arb_expr_over` → `lower_asm` and **no new
  `Arbitrary` is written.**

**§4 is what makes P2's domain checkable rather than merely stated.** `validate()` reports §3.1's
out-of-range index and §3.3's unrepresentable name, so the only part of P2's precondition that is not
a validator result is §3.2's ordering — which is a property of a `Vec`'s permutation, not of the
program, and is therefore named in the property rather than checked by the validator.

Four tests pin the asymmetries as documented non-goals, each demonstrating the boundary rather than
asserting the good case: a label past the end vanishes, an index-shuffled `labels` comes back sorted,
a name with an embedded space round-trips byte-identically even though `validate()` rejects it, and a
name ending in `:` used as a jump operand silently drops the instruction that carries it — §3.3's
worst case.

---

## §4 `Program::validate()`

`pub fn validate(&self) -> Vec<String>`, mirroring `Machine::validate` in signature, in placement (an
inherent method beside the type) and in returning plain strings. It reports:

1. **Undefined label targets** — every `Jz`/`Jmp`/`Call` operand with no entry in `labels`. This is
   `run_asm`'s `:383`/`:391`/`:398` fault, hoisted out of the execution path.
2. **Over-cap registers** — any `Reg::Loc`/`Reg::Arg` index at or over `MAX_REGISTERS`, reusing
   `instr_reg_over_cap` (`:313`) rather than a second traversal. `run_asm`'s `:340`, hoisted the same
   way.
3. **Duplicate label names** — which `label_index` currently resolves by silently taking the first.
4. **Unrepresentable label names** — empty, or containing whitespace, `:`, `;` or `,`. The alphabet is
   derived from what the printer's own separators are, so the rule and the format cannot disagree.
5. **Out-of-range label indices** — an index past `code.len()`, §3.1's silent loss made loud.

**`run_asm` is not changed.** Its lazy faults stay exactly as they are, because the two ways to obtain
a `Program` must not behave differently, and because a validator that callers opt into is the
established shape here. What changes is that a caller who wants the check before running can have it,
which the CLI of PR 2 does.

**No spans, and that is the precedent rather than an oversight.** `Machine::validate` returns
`Vec<String>` and the TM path lives with it. A spanned variant would need `parse_asm` to keep a
side-table of operand offsets and would make the validator's output depend on whether the `Program`
came from text or from `lower_asm` — the divergence item 2 above exists to avoid.

---

## §5 The optional header (PR 2)

**TM's optionality model, reused whole.** `print_asm` stays byte-identical; a new
`print_asm_with(prog, &AsmHeader)` prepends the block; `parse_asm` skips a header if present and
returns the `Program`; `parse_asm_full` returns `(Option<Program>, Option<AsmHeader>, Vec<Diagnostic>)`
and a header-less file is **not** an error. Every existing caller of `print_asm` — all four of §1 —
sees no change, and `span_wellformed.rs` must pass over `print_asm_with` as well as `print_asm`.

**One directive: `result <Ty>`**, reusing `ty::parse_ty` and the value-type restriction verbatim from
`syntax.rs:382`. `Fun` and `Var` are rejected where written.

**`version` is deliberately excluded.** TM carries one because its tape encoding has evolved and a
file must say which encoding it was written under. The asm text form has one encoding, has never had
another, and a version directive with a single legal value is a field nothing can use. If the form
ever gains a second encoding, that is when it earns a version — the same rule this whole slice applies
to `parse_asm` itself.

**Comments are `;` to end-of-line**, which the form already emits (the ASM_PREAMBLE) and which matches
TM. The parser skips them; the printer never produces them.

---

## §6 The CLI path (PR 2)

`redextape run prog.asm` dispatches on the extension exactly as `.tm` does at `run.rs:65` —
ASCII-case-insensitive, because `M.ASM` is as much an artifact as `m.asm`, which is the correction
`run.rs:403` already records for `.tm`. A `.asm` file is a program, not a source, so it takes no
`--backend`, same as `.tm`.

The pipeline is `parse_asm_full` → `validate()` → `run_asm` with `DEFAULT_CAPS` → `decode_asm_ty`
against the header's `result`. A file with no header runs and reports that it cannot decode without
one, which is a diagnostic about the FILE rather than about the tool — the same distinction
`run --backend lambda` already draws for a function-typed result (exit 2, the program is fine).

`emit --lang asm` writes the header through `print_asm_with`, so an emitted file is
self-describing and the emit-then-run pair is a fourth leg of the oracle expressible as two shell
commands, which is what `emit --lang tm` plus `run` already is.

**The write-only claims come out in PR 1, not here.** `ASM_PREAMBLE` (`emit.rs:30`), the `emit.rs`
module doc (`:4`), `Lang::Asm`'s doc (`:20`) and the test
`emitted_asm_declares_that_it_cannot_be_read_back` (`:315`) all assert something PR 1 makes false, and
a tree that ships a false current-tense claim for one PR's duration is the defect the roadmap's last
three entries are about.

---

## §7 Phasing — three PRs

**PR 1 — the reader.** `parse_asm`, `Program::validate()`, P1 and P2, the three boundary tests, and
the four falsified claims of §6. One idea, and the only PR that can be written without the others.

**PR 2 — the header and the CLI.** §5 and §6. The header lands with the consumer that asks for it,
which is the rule this slice applies to `parse_asm` itself; landing it in PR 1 would ship syntax
nothing reads.

**PR 3 — the grammar.** §8. It needs both earlier PRs: the parser to be checked against, and the
header because the grammar must cover the headered form as TM's does (seven captures header-less, nine
with the header).

Each PR gets its roadmap entry written before it opens.

---

## §8 The grammar (PR 3)

`grammars/tree-sitter-redextape-asm`, held span-for-span against `print_asm_mapped` through
`redextape-grammar-check`, on the identical differential the three existing grammars use. Five
captures header-less (§1), more with the header block.

**Extension: `.asm`, and the collision is a README line.** `.asm` is claimed by essentially every
assembler in existence. That is the same situation as `.tm` and TeXmacs, which the tree-sitter PR 3
entry ruled on explicitly — *"a README line rather than a reason to invent an extension"* — and this
design follows it rather than reopening it.

**No `locals.scm`, and this slice earns the argument the TM grammar used.** A label reference resolves
against the program's own label table, which `parse_asm` builds and `Program::validate()` checks. Name
resolution has an owner, and it is not the grammar.

---

## §8.1 One convention every PR here is bound by

**`scripts/check-citations.sh` rejects `file:line` in tracked source.** Every pointer this design
plants in code — and PR 1 alone touches `asm.rs`, `emit.rs` and several tests — must cite a SYMBOL.
The `file:line` citations throughout this document are the deliberate exception the gate's own header
names: `docs/` is out of scope because a citation in a dated spec is an observation about `91bda96`
rather than a pointer that must stay true.

---

## §9 Risks

1. **The 24-to-16 mnemonic fold is the one place the parser is not the printer's mirror**, and it is
   where a wrong `BinOp` would be silently accepted — `cmpge` read as `Ge` is right, read as `Gt` is a
   program that runs and answers wrongly. P2 over `lower_asm`'s image covers every mnemonic the
   compiler emits; a table-driven test over all nine covers the rest.
2. **P1's corpus is only as good as the programs in it.** The demo suite exercises what `lower_asm`
   produces, which is not the same as what the form can express. `Instr` variants that no demo reaches
   would have their parsing untested by P1 and tested by P2 only if the generator reaches them. PR 1
   must record which of the 16 variants the corpus actually covers rather than assume the demos are
   exhaustive.
3. **`span_wellformed.rs` is the only structural check on printer offsets**, and PR 2 adds a second
   printer entry point that it does not currently cover. Extending it to `print_asm_with` is a task,
   not an afterthought.
4. **The header's decode failure mode is new to the CLI.** A header-less `.asm` run is a case `.tm`
   never has, because `emit` always writes a TM header. The exit code and message for it are a
   decision PR 2 has to make and state, not inherit.

---

## §10 Explicitly out of scope

- **`redextape fmt` for `.asm`.** `fmt` is the surface language's formatter, defined as `print ∘ parse`
  over `.rxt`. Whether the asm form gets one is a separate question with its own idempotency corpus.
- **Changing `print_asm`'s bytes**, in any of the three ways §3 would be simplified by.
- **Spanned validation.** §4's last paragraph.
- **A `version` directive.** §5.
- **`locals.scm`, `injections.scm`, folds, indents, editor packaging, anything in `web/`.** §8, and
  design §12 of the tree-sitter spec, which this slice does not reopen.
- **`--backend native`.** Still not a CLI dependency; the fourth oracle leg this slice adds is asm,
  not native.
