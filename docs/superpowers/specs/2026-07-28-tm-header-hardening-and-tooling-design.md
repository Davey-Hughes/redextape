# TM header — hardening, versioning, and tooling — Design Spec

> **Status:** DESIGN (2026-07-28). Follows directly from the whole-branch review of the
> self-describing-header slice (`docs/superpowers/specs/2026-07-27-tm-self-describing-header-design.md`,
> IMPLEMENTED). That review returned **Not ready to merge** with three Important findings; this spec
> covers those, four carried Minors it marked fix-before-merge, and five additions.
> **Branch:** continues `tm-self-describing-header`. Nothing here is merged until all of Phase A lands.

## Why this exists

The header slice shipped a `.tm` file that records both halves of a Turing machine. The whole-branch
review found that its **stated threat model is honoured in two places and abandoned in two others**.
The branch's own binding constraint reads "a `.tm` file is untrusted" — and it closed a cyclic-heap
stack overflow on exactly that reasoning, in code that was unreachable in-tree. Meanwhile three
file-supplied integers feed eager allocations with no cap, and the type-directed decoder's cost is
exponential in a file-controlled type depth.

That inconsistency is the point of Phase A. A hardening argument that applies to one input and not its
three siblings is not a hardening argument.

Phase B then closes the two gaps the slice deliberately deferred (no version, no way to write a file)
and adds three checks that make the format's headline claim falsifiable rather than asserted.

## Phases

**Phase A — merge blockers.** The three Importants and four fix-before-merge Minors. The branch does
not merge without these.

**Phase B — additions.** Versioning, the emitter, and three tests.

They are separable: Phase A could merge alone. They are specced together because Phase B's tests
(B3–B5) are the strongest available evidence that Phase A's fixes did not break anything, and because
B1 changes the printed output, which forces a fixture regeneration that A3 also touches.

---

# Phase A — hardening

## A1 — File-supplied integers must not drive unbounded allocation

**The hole.** `parse_tm_full` accepts any `tapes N >= 1`, any `slots: u32`, any `width >= 1`. A machine
whose only state is `state s: accept` has no rules, so the rule-arity check never constrains `tapes`.
Therefore:

```
tapes 10000000000
start s
encoding unary
width 4
slots 1
result Nat

state s: accept
```

parses to `(Some(m), Some(h), [])` — clean, no diagnostics — and the documented next step,
`h.init(m.tapes)`, allocates 10¹⁰ `Vec`s and aborts. `sim.rs:124` guards this exact scenario with a
comment naming it; the header path reintroduces it one call earlier, on the path the docs recommend.

`slots` and `width` are the same class: `h.encoding().init_reg(h.slots)` — the recipe evaluation the
header exists for, and what the consistency check itself performs — allocates `slots × (width + 1)`
cells. `MAX_SLOTS` exists precisely to stop that, and the file path bypasses it.

**Decision: validate at the parser, where `MAX_TY_DEPTH` already set the precedent.**

| directive | cap | why that value |
|---|---|---|
| `tapes` | new `MAX_TAPES = 64` | this compiler emits 5; 64 leaves an order of magnitude for hand-written machines while bounding `init` to 64 `Vec`s |
| `slots` | existing `MAX_SLOTS` (100_000) | the same ceiling `lower_and_size` already enforces for in-memory programs |
| `width` | existing `MAX_FIELD_WIDTH` (64) | the auto-fit search's own ceiling: a file naming a wider field describes a bank this build could not have produced and whose recipe it cannot evaluate |

Each is a **totality guard on untrusted input, not a language limit** — the same wording `MAX_TY_DEPTH`
carries, and for the same reason. Each rejection is a spanned diagnostic naming the cap.

`tapes` is capped in `parse_tm` proper, not in the header path, because `tapes` is a pre-existing
required directive and the hazard exists with or without a header.

**Then narrow `TmHeader::init`'s doc to the totality it actually provides.** It currently claims
"Total: entries outside `0..n_tapes` are dropped rather than panicked on" — true of the *entries* and
silent about the *allocation*, which is the part that aborts.

## A2 — `decode_tape_ty` must bound its product, not just its spine

**The hole.** The cyclic-heap fix bounded the list SPINE at one step per heap cell. Recursion on the
TYPE is separately fine — it strictly shrinks at each `List` element. Neither bounds **the product**:
for `List<List<Nat>>`, each of up to `n` spine steps calls `decode_word_ty` on `List<Nat>`, which walks
up to `n` cells. That is O(n²) time and O(n²) `Rc<Value>` allocations, and `parse_ty` admits nesting to
`MAX_TY_DEPTH = 64`, giving O(n^d).

Both factors come from the file. A machine of `state s: accept` returns its initial tapes unchanged, so
the HEAP `decode_tape_ty` reads is verbatim the file's `tape 3 …` line.

**This is worth stating plainly because the existing doc invites the mistake:** the loop bound reads as
though it closed the totality question for this function. It closed one dimension of it.

**Decision: a node budget threaded through `decode_word_ty`.**

```rust
/// The most `Value` nodes a single type-directed decode may construct.
///
/// The spine loop bounds CYCLES — one step per heap cell. It does not bound SIZE: nested list types
/// multiply, so `List<List<Nat>>` over an n-cell heap is O(n²) nodes and `MAX_TY_DEPTH` nesting is
/// O(n^d). Both factors are file-supplied. The two guards are separate guarantees and neither implies
/// the other.
pub(crate) const MAX_DECODE_NODES: usize = 1_000_000;
```

Decrement per constructed `Value`; return `None` on exhaustion. The doc on `decode_word_ty` must say
the loop bound addresses cycles and the budget addresses total size — **two separate guarantees**.

`decode_asm`/`decode_word` (the Value-directed siblings) need no budget: they recurse on a finite
reference `Value` that is already in memory, so its size is the bound.

## A3 — Optionality property 2 must be pinned on a compiled machine under both encodings

**The hole.** Property 2 (`parse_tm_full(print_tm_with(m, h))` → `(Some(m), Some(h), [])`) is tested
against `increment()`: one tape, one 6-cell unary `tape 0` line, `result Nat`. The spec's Testing §2
asked for the compiled-machine round-trip "both encodings, at their fitted widths" and it was never
wired up. `the_headers_recipe_reproduces_its_literal_tapes` *does* run compiled machines under both
encodings through the text — and then discards the parsed machine and never compares the parsed header
to the original.

So the combination with the most moving parts — a 5-tape compiled machine, a `Binary` header with a
**non-empty WORK tape line**, `result List<Nat>`, at a fitted width — is never asserted to round-trip.

**Decision: two assertions inside the loop that already exists.**

```rust
assert_eq!(pm.as_ref(), Some(&d.machine), "...");   // was discarded as `_`
assert_eq!(h, d.header, "...");                      // never compared
```

That turns the corpus check into the compiled-machine round-trip the spec asked for, at both
encodings, for free.

## A4 — The four carried Minors marked fix-before-merge

1. **`ty.rs:69`** — a comment offering a boundary-safety argument for manual `len()-1` slicing that the
   code does not perform (it uses `strip_suffix`, unconditionally safe). Delete it.
2. **`header.rs`** — `construction_drops_empty_tapes_and_orders_the_rest` never exercises the
   duplicate-index collapse `dedup_by_key` exists for. `TmHeader::new` is `pub`, so that is documented
   external behaviour with zero coverage. Add a duplicate entry to the existing test.
3. **`syntax.rs`** — the span check uses `covered.contains("tape")`, which `"tapes 1"` satisfies, while
   its own comment claims it verifies the span covers the offending `tape` line. **A fresh instance of
   the branch's own defect class, inside the test added to fix another instance of it.** Use an exact
   comparison against the known offending line.
4. **`syntax.rs`** — `print_tm_output_is_unchanged_by_the_header_split`'s prefix-strip is safe by a
   one-character margin (`"tapes 1"` vs the `"tape "` prefix) and says so nowhere. The project's own
   rule, quoted in the roadmap, is that a limit belongs where a reader of the checker finds it.

## A5 — Three comment/doc corrections the review found false

- **`attempt`'s "exactly ONE place that builds `init`" is false as written.** `tm/attribute.rs` also
  builds one — and sets only `REG`, omitting `init_work()`, which is precisely the divergence the
  sentence claims cannot exist. Qualify to "one place on the `run_tm*` path", and separately note that
  `attribute`'s omission of the WORK bank is a real question under `Binary` (recorded, not fixed here).
- **`TmHeader::new`'s "duplicates collapsed to the first"** — empties are filtered *before* dedup, so
  given `[(REG, []), (REG, ['#'])]` the survivor is the second. Correct the sentence.
- **`asm.rs`'s new doc says `tm::decode` "must not carry a second copy of this logic"** — while
  `decode.rs`'s `decode_word` *is* a second copy of `asm.rs`'s `decode_word`. Both are safe; the
  comment argues against the file it sits beside. Either share them or narrow the claim to the
  type-directed decoder.

---

# Phase B — versioning, tooling, and falsifiable claims

## B1 — A format-version directive

**Decision: always emit `version 1`; absent means 1; unknown is a hard error.**

```
version 1          ; always emitted, first line of the header block
encoding binary
width 16
slots 7
result List<Nat>
tape 0 #…#  ; reg
```

| parsed | outcome |
|---|---|
| absent | version 1 — every hand-written and pre-existing file stays valid |
| `version 1` | ok |
| `version 2` | **error**: "unknown header version 2" |
| `version foo` | error |

**Unknown is an error, not a warning, because a future version could change what `width` or `slots`
MEAN.** Decoding a v2 file under v1 rules would produce a confidently wrong value — the exact failure
the header exists to prevent.

**`version` is NOT a member of the four-directive header set.** The set stays `encoding`, `width`,
`slots`, `result`, so all four optionality properties are untouched and a header-less file is still
header-less. But `version` present with none of the four is a diagnostic, on the same reasoning as a
stray `tape` line: silently discarding it turns a typo into "this file has no header".

**Consequence to plan for:** `print_tm_with`'s output changes, so `list_1_2.tm` must be regenerated and
`the_fixture_is_what_the_compiler_emits_today` will go red until it is. That test doing its job is the
expected signal, not a problem.

## B2 — `tm_emit`: an example that writes a `.tm` and runs one back

The project has no `[[bin]]`; its entry points are `examples/` (eight of them, two already taking
args). `tm_emit` follows that convention.

```
cargo run --example tm_emit -p redextape-core -- emit 'cons(1, cons(2, nil))' --encoding binary -o out.tm
cargo run --example tm_emit -p redextape-core -- run out.tm
#=> [1, 2]
```

- `emit <program> [--encoding unary|binary] [-o <path>]` — compile, run to fit the width, print the
  self-describing text to stdout or write it to `<path>`.
- `run <path>` — parse, build `init` from the header, simulate, decode against the header's `result`,
  print the value.

**The `run` mode is the point.** It is the slice's headline claim made executable outside the test
harness: a file, and only a file, becomes a value. Arg parsing is hand-rolled — no `clap` in the
dependency tree, and `aot_demo` already parses `env::args` by hand.

## B3 — A binary-encoding fixture

`list_1_2.tm` is unary, and `Unary::init_work()` is empty, so **the `tape 1` line has never
round-tripped through an actual file** — only through the in-memory corpus check. `Binary::init_work()`
lays out a real `#`-delimited bank, so a binary fixture exercises the multi-tape-line path end to end.

This is the same gap as the vacuous-WORK-assertion finding, one level up: a check that looks like it
covers WORK and does not.

## B4 — A proptest for the header round-trip

Property 2 over generated machines and headers, alongside the existing `tm_bank_invariant` and
`tm_width_equivalence` proptests. Generators must produce headers in the normal form `TmHeader::new`
maintains, or the test asserts a property the type does not have.

## B5 — A foreign reader: an independent simulator *and* an independent decoder

**Decision: do both halves, in a dedicated `tests/tm_foreign_reader.rs`, written from the DOCS.**

A ~40-line tape/head/rule interpreter and a ~10-line unary decoder (count marks between `#`), using
`parse_tm_full` to read the file — that is the format, not the simulation — and **nothing else** from
`redextape_core::tm`. No `simulate`, no `Tape`, no `Encoding`.

**Why the decoder half is worth doing, given the spec scoped it out.** The review found that three
pieces of the format's run semantics are written down nowhere: that each tape's head starts at cell 0,
that tapes are **two-way** infinite (a foreign simulator modelling a one-way tape silently diverges),
and that a rule-less state halts. Writing an independent reader is the process that surfaces exactly
that class of gap, because the author must reconstruct the semantics from prose and hits each hole.

And it **sharpens** the spec's stated limit rather than contradicting it. The limit was written as "a
foreign tool cannot INTERPRET its result." What is actually true is narrower and more useful: *the file
does not carry the encoding's semantics, so a reader needs the spec* — and a decoder written from that
spec works. Proving reimplementability-from-documentation is a falsifiable claim; "interpreting is
impossible" is not, and is false.

**The discipline this test depends on, stated so it survives review:** the foreign reader must be
written from `unary.rs`'s and `syntax.rs`'s **doc comments**, never by reading their code. A decoder
copied from the implementation proves nothing about the documentation. This belongs in the test's own
header comment, because it is the assumption the test's value rests on and it is invisible in the code.

**Prerequisite:** `syntax.rs`'s module doc must first document the three run-semantics conventions
above. Without them the foreign reader cannot be written honestly, and the roadmap's unqualified "a
foreign tool can RUN a `.tm` file" is wider than what a foreign implementer could reconstruct.

---

## Non-goals

- **Making `tm_emit` a real CLI binary.** Examples are this project's convention; a `[[bin]]` would be
  the first, and nothing yet needs one.
- **A v2 of the format.** B1 adds the mechanism, not a second version.
- **Sharing `decode_word` between `asm.rs` and `decode.rs`** (A5's third item). Narrowing the false
  comment is in scope; the refactor is not.
- **Fixing `attribute.rs`'s missing WORK bank.** Recorded in A5, filed for its own slice — it is a
  question about step attribution under `Binary`, not about the text form.

## Testing

1. Every cap in A1 rejected with a spanned diagnostic, and the value one below each cap accepted —
   both directions, or the cap is untested in the direction that matters.
2. A2's budget: a decode that exceeds it returns `None`; a legitimate nested-list decode below it still
   succeeds. **Sabotage: set the budget to 1 and confirm the legitimate case goes red**, or the test
   proves only that the budget exists.
3. A3's two assertions, over the existing corpus, both encodings.
4. B1's four version cases, plus the four optionality properties re-run unchanged.
5. B2: `tm_emit emit` piped into `tm_emit run` yields the reference value — as a test, not only as a
   demo.
6. B3/B4/B5 as described.

## What stays open

0. **`decode_word_ty` is not sharing-aware, and a legitimate program can hit the node budget.**
   Discovered by the re-review of A2, after the budget was already derived correctly.

   The derivation covers a FLAT list exactly. It does not cover a nested one, because `Instr::Tail` is
   a pointer read rather than an allocation — so an ordinary `tails`-style function returns a
   `List<List<Nat>>` whose inner lists all SHARE the outer spine's cells: `~2m` heap cells for an
   `m`-element input, but `m² + m + 1` decode nodes, since the decoder re-walks each shared sub-list
   for every pointer into it. Breakeven is `m ≈ 4,471`, three orders of magnitude below
   `DEFAULT_CAPS.heap`. **A correct, fast, cap-respecting program can therefore still be told
   "could not decode result".**

   No constant closes this: raising the budget to cover `d = 2` re-opens the `d = 3` case it exists to
   refuse. The fix is a **sharing-aware decode** — memoize on `(pointer, type)` so an aliased sub-list
   is constructed once — which also makes the output `Value` share structure the way the heap does.
   Deferred because it is a decoder redesign, not a hardening tweak, and because the failure it
   prevents is a refusal rather than a wrong answer.

   Recorded here rather than only in the code comment because the same reasoning applies to
   `decode_asm_ty` on the AOT path, which is a different consumer.

1. **`attribute.rs` builds an `init` without `init_work()`.** Real under `Binary`; filed, not fixed.
2. **The duplicated auto-fit loop** (`run_tm_fitted` vs `run_tm_described`). Correct today, nothing
   pins that it stays correct. The review rated it Minor because a divergence would redden the pinned
   fixture on the unary path; a shared `fit(...)` helper is the fix if it recurs.
3. **Header directives are accepted after the first `state`**, while the grammar says they must precede
   it. Harmless for round-tripping since the printer always emits them in position. Either enforce it
   or amend the grammar text — deferred as a deliberate choice, not an oversight.
