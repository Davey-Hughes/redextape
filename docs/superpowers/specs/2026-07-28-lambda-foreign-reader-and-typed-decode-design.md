# λ backend — a typed decode and a foreign reader — Design Spec

> **Status:** IMPLEMENTED (2026-07-28). Plan:
> `docs/superpowers/plans/2026-07-28-lambda-foreign-reader-and-typed-decode.md`.
> §A shipped as `lambda::decode_lambda_ty`; §B as `tests/lambda_foreign_reader.rs`; §C resolved below.
> **One thing this spec did not predict:** §B guessed the risk in the text form was an undocumented
> α-renaming rule. The actual defect was cruder and larger — `print_lambda` emitted `$store` binders the
> lexer could not read, so the printed lowering of every program with mutable state failed to reparse in
> OUR OWN parser. The freshening rule turned out to be sound and merely unwritten; it is written now.
> **And one thing outside all three sections:** the branch surfaced a pre-existing defect in `value.rs`
> — `PartialEq` and `Debug` recursed over a `Value::Cons` spine that `Drop` was hand-written to walk
> ITERATIVELY, on a premise (millions of cells) that makes the other two overflow. Both are iterative
> now.

## Why this exists

The TM branch closed two gaps: a printed machine could not be *interpreted* without a reference run
(fixed by `decode_tape_ty`), and every test of "any simulator can run this" used *our* simulator
(fixed by a foreign reader written from the docs).

**The λ backend has the first gap unfixed and the second untested — and asking whether it also needs a
header turned out to be the wrong question.**

## What does NOT transfer, and why that matters

**λ needs no header.** The TM header exists because `print_tm` serialized *half a machine*: the
transition function and start state, but not the initial configuration. A λ term has no such split —
**the term IS the entire configuration.** `print_lambda(t)` already emits everything a reducer needs.

Building a λ header would be cargo-culting a solution to a problem this backend does not have. The one
piece of the header that *would* apply — recording the result type — is addressed in C below, and only
after A and B have shown whether it is wanted.

## A — `decode_lambda_ty`: the gap that does transfer exactly

`lambda/decode.rs` today:

```rust
pub fn decode(nf: &LambdaTerm, expected: &Value) -> Option<Value>
```

Value-directed only; the file mentions `Ty` once, in an import. So a printed normal form **cannot be
interpreted from the text alone** — you need a reference `Value` to tell a Church numeral from a Church
boolean from a Church-encoded list. `lambda.rs`'s own module doc already says the problem out loud:
*"bare normal forms are ambiguous."*

That is precisely the state `decode_tape` was in before this branch, and the fix has now been written
twice (`asm::decode_asm_ty`, `tm::decode::decode_tape_ty`).

**A1 — Add `pub fn decode_lambda_ty(nf: &LambdaTerm, ty: &Ty) -> Option<Value>` as a SIBLING of
`decode`, not a replacement.**

The TM slice's D6 reasoning applies unchanged: the two decoders **disagree on purpose**, and the
Value-directed strictness is what makes the oracle catch a wrong answer.

| normal form | `decode` (Value-directed) | `decode_lambda_ty` (Ty-directed) |
|---|---|---|
| Church nil, witness `[1]` / `List<Nat>` | `None` | `Some(Nil)` |
| any term, `Value::Unit` / `Ty::Unit` | `None` | `Some(Unit)` |

Unlike the TM pair there is **nothing to share** — both take the term directly, with no analogue of
`read_result`'s tape read. So they are plain siblings, and the deliverable is the agreement test plus
the two pinned disagreements.

**A2 — Totality is a genuinely different question here, and the difference is worth stating.**

`decode_tape_ty` needed a node budget because the TM heap is a **graph**: cells address each other by
pointer, so a chain can cycle and aliasing makes cost multiply (`m² + m + 1` for a shared
`List<List<Nat>>`; see that branch's finding). A λ normal form is a **finite tree already in memory**,
so structural recursion on it terminates by construction and no budget is needed.

**But depth is not free.** A deeply nested term could still overflow the stack during decode, and
`MAX_TERM_DEPTH` exists in this backend for related reasons. **The implementer must determine whether
`decode`'s existing recursion is already depth-bounded, and by what** — not assume it either way. If it
is not, that is a finding about the *existing* decoder, not new work introduced here.

**A2 — RESOLVED (2026-07-28): `decode` is depth-bounded, but by `nf`, not by `expected`.** `decode_cons`
destructures the TERM before it consults `expected`, and descends only where both `nf` is cons-shaped and
`expected` is `Value::Cons`, so the depth is `min(expected's spine length, nf's own cons nesting)`. The
term is the binding half: every producer caps term depth (`MAX_TERM_DEPTH` = 3,000 out of the reducer,
`MAX_PARSE_DEPTH` = 256 out of the parser), which at four term nodes per Scott cell is roughly 750 frames
— safe on a normal stack, so the existing recursion was left alone and there is no finding against the
existing decoder. **The tempting wrong answer, which this branch shipped and then had to correct**, was
"bounded by the `Value` the caller already holds, so it needs no guard": a caller-held `Cons` spine is
bounded only by the step budget — millions of cells — and that is precisely the premise that made
`value.rs`'s `Drop` iterative and made `PartialEq`/`Debug` overflow (see the status header). So
`decode_lambda_ty`'s iterative spine walk is *not* compensating for a guard `decode` has and it lacks;
both are ultimately bounded by `nf`. It is new code that could remove the data-proportional axis for
nothing, and gains survival of directly-built terms — past every producer cap — by doing so.

## B — A foreign λ reader: a stronger idea here than it was for the TM

For the TM, a foreign simulator mainly proved the docs were adequate. For λ it does that **and**
becomes a correctness check, for three reasons:

1. **β-reduction is a textbook algorithm**, so an independent implementation is genuinely independent —
   there is a published specification to write against. The TM's tape-gadget conventions have no such
   external referent.
2. **Normal-order reduction has subtle parts** — capture-avoiding substitution and redex selection —
   where two honest implementations can diverge. A disagreement is a real bug signal, not just a
   documentation gap.
3. **The riskiest behaviour is the least specified.** `print_lambda`'s doc says it prints "with readable
   names, freshening on shadow collision" — that is α-renaming in the printer, and the freshening
   convention is described nowhere. `parse_lambda(print_lambda(t)) == t` is already proptested
   (`parse_print_round_trips`), and **that property can hold while the printed text is ambiguous to any
   other reader**, because our parser shares our printer's assumptions about names.

**B1 — DECISION: the foreign reader implements its own PARSER as well as its own reducer.**

This is the one place the λ version should go further than the TM version did. There, using
`parse_tm_full` was right — parsing is the format, not the simulation. Here, the parser is exactly
where the untested risk lives: a foreign parser is the only thing that can show `print_lambda`'s
freshened output is unambiguous to someone who did not write the printer.

*Beat:* reuse `parse_lambda` and write only the reducer — cheaper, and still tests the reduction
semantics, but leaves the α-renaming question exactly as untested as it is today. Rejected for that
reason; the parser is ~60 lines of textbook grammar.

**B2 — It decodes independently too**, on the same reasoning the TM slice settled: a hand-written
Church-numeral reader (~15 lines) tests whether the *encoding* is documented well enough to
reimplement, and sharpens "interpreting needs the semantics" from an assertion into a measured claim.

**B3 — The discipline, stated because it is invisible in the finished code.** The parser, reducer and
decoder must be written from the **doc comments** in `lambda/term.rs`, `lambda/syntax.rs`,
`lambda/reduce.rs` and `lambda/encode.rs` — never from their bodies. A reducer copied from `reduce.rs`
proves nothing. This belongs in the test file's own header, as it does in `tm_foreign_reader.rs`.

**B4 — The primary deliverable is any documentation gap**, not the passing test. The α-renaming
convention is the specific thing expected to be missing; if it is, the finding is that
`print_lambda`'s freshening needs a written rule, and the fix belongs to whoever owns that printer.

## C — RESOLVED (2026-07-28): nothing. The text form carries no result type.

The criterion this spec set was **whether anything outside this project would ever read a printed λ
term**, and the answer today is no. `grep -rn print_lambda` over the workspace returns three consumers:
the `lambda.rs` re-export; `examples/lambda_demo.rs`, which prints for a human and whose one mechanical
use re-parses and compares against the term it already holds; and `tests/lambda_foreign_reader.rs`, the
only reader in the tree that INTERPRETS printed text — and by construction supplied with the type, one
per corpus row. `decode_lambda_ty` needs a `Ty` and every caller has one: the oracle holds the reference
`Value`, other callers hold `typeck::result_type`'s answer (as `tm_header.rs`, `aot_oracle.rs`,
`measure.rs` and `tm_emit.rs` all already do). `decode_lambda_ty` has in fact no in-tree production
caller yet at all; its tests build terms directly. So option 1.

**B sharpened the question, though, and the sharpened version has to be answered rather than skipped.**
Foreign-reader finding 8 established that the ambiguity is not a convenience gap: the encodings
genuinely COLLIDE. `true = \t.\f. t` and `nil = \n.\c. n` are the same de Bruijn term, `Abs(Abs(Var 1))`;
`false = \t.\f. f` and `church 0 = \f.\x. x` are both `Abs(Abs(Var 0))`. A result type is therefore
needed **in principle** to interpret a normal form, not as an implementation convenience — and that is
an argument FOR recording one somewhere. It is stronger than "untested": it is not that nobody tried to
interpret a bare term, it is that a bare term **does not determine its value**. What it is not is an
argument for recording the type *in the text*, because the text has never travelled without the program
it came from. Option 1 is a claim about the DISTRIBUTION of the type, not about whether one is needed;
the collision settles the latter, and the grep settles the former.

**Why not option 3, given that.** Two reasons, the second the stronger. A `; result:` line is a format
change while the type is already computed, so option 2 dominates it the moment the need appears. And a
type alone would close less of the gap than it looks like: it names `List<Nat>` but not the Church/Scott
encoding `List<Nat>` is expressed in, and finding 9 measured exactly that residue — the foreign decoder
had to rederive the normal FORMS (a fully applied, normalized cons cell is `\n.\c. c h t`) from the
combinator equations, because `encode.rs` documents the combinators and not what they normalize to.
This is the TM header branch's own asymmetry restated for λ: running is universal, interpreting is not,
and a name cannot convey semantics.

**What would flip this**, stated so a later reader can weigh it instead of rediscovering it: a consumer
that receives λ text WITHOUT also receiving the program it came from. The visualizer's λ pane is not one
(it holds the source). A `.lam` file handed to another tool would be, and would want option 2 —
`run_lambda` returning the type — before option 3.

**The one action finding 8 does license, and it is not a format change.** The collision IS documented,
in `lambda/decode.rs`'s module doc — the file the foreign-reader task correctly banned, since it
describes the decoding strategy an independent reader has to rederive. No READER-FACING file
(`syntax.rs`, `encode.rs`) carries it, so an independent implementer rediscovers it by hitting it rather
than by looking it up. That is a doc line in `encode.rs`, not a change to the text form, and so it is
filed as a roadmap follow-up rather than settled here.

## Non-goals

- **A λ header.** See above — the term is the configuration.
- **Making the foreign reducer fast.** It is a checker; normal-order reduction of the demo corpus is
  small.
- **Fixing `print_lambda`'s freshening.** B4 may produce a finding; acting on it is a separate slice.

## Testing

1. `decode_lambda_ty` agrees with `decode` on Nat, Bool, and a non-empty list; **and the two deliberate
   disagreements are pinned** (nil under a `Cons` witness; `Unit`). Without the second half, a later
   attempt to express one over the other would pass.
2. Depth behaviour of both decoders, per A2's finding.
3. The foreign reader parses, reduces and decodes the oracle corpus's printed normal forms, agreeing
   with `reference == λ` on every one.
4. **A disagreement is reported as a defect, not accommodated.** If the foreign reducer differs from
   ours, the task stops and reports which term and which reduction step — exactly as the TM branch's
   round-trip task was instructed.

## What this is worth, honestly

A is a real gap with a proven template — small, certain value. B is the interesting one: it is the only
check in this project that can find an ambiguity in the λ text form, because every existing check reads
that text with the parser that was written alongside the printer. C is a question, and the answer may
well be "nothing needed", which is a fine outcome to reach deliberately rather than by omission.

*(Written at design time, and all three held. B was the interesting one — it found a live defect in the
text form, plus eleven documentation gaps, one of which is a correctness requirement rather than a doc
gap. C did land on "nothing needed", and §C above records the evidence and what would flip it.)*
