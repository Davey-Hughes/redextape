# Binary as a participating oracle leg, and the λ encoding collision — design

**Date:** 2026-07-29
**Status:** approved, ready for planning
**Roadmap items closed:** λ open item 2 (encoding collision undocumented in reader-facing files);
"`Binary` as a fourth PARTICIPATING leg in the native oracle" (binary-encoding follow-ups).

---

## Why these two together

Both are the same defect class, and it is the one this project keeps finding: **a check or a document
covers less than its name claims.** Neither is a bug in shipped behaviour; both are places where the
written record overstates what is actually established.

- **Item 1.** The λ encodings collide, which is why decoding needs an externally supplied result type.
  That fact *is* recorded — in `lambda/decode.rs`'s module doc, the one file a foreign reader is
  correctly told not to open, because it describes the very decode strategy such a reader must
  rederive. So the fact is not undocumented project-wide; the gap is narrower and more actionable:
  **no file a foreign reader is permitted to consult carries it**, so it must be rediscovered by
  hitting it. The `lambda_foreign_reader.rs` corpus recorded this as finding 8 and resolved it *for
  that task* by supplying the type per corpus row. This is the residue.

- **Item 2.** When `Binary` landed, `redextape-native`'s doc comments were corrected to say that
  "native has no `MAX_FIELD_WIDTH` ceiling, unlike the TM" was true of **unary alone**. The docs were
  fixed. **The suite was not.** `native_oracle.rs` still pins `Unary::default()` at every TM site, so
  the corrected claim lives only in prose while the executable check tests what it always tested.

---

## Item 1 — record the collision where a permitted reader will find it

Doc-only. No code, no test.

### `lambda/encode.rs` module doc

Gains a paragraph stating the collision as a **principled** fact, not an implementation convenience:

- `tru()` (`\t.\f. t`) and `nil()` (`\n.\c. n`) are the same de Bruijn term, `Abs(Abs(Var 1))`.
- `fls()` (`\t.\f. f`) and `church(0)` (`\f.\x. x`) are both `Abs(Abs(Var 0))`.
- The collision **propagates through structure**: the list `[0]` and the list `[false]` are one term.
- Therefore no reader of a normal form — ours or an independent one — can decode it without a type
  supplied from outside. This is not a limitation of our decoder; it is a property of the encoding.

The paragraph must **not** cite `decode.rs` as required reading. That file stays off-limits by design.
The fact is stated at its source, where the colliding combinators are defined.

### `lambda/syntax.rs` module doc

Gains a one-line cross-reference to the above. `syntax.rs` describes the text form, and **the text form
carries no result type** — so this is the file where a reader actually hits the problem, and the
existing module doc already sets the "a reader that did not write the printer needs this" precedent.

### What this does not do

It does not add a type to the text form. That was assessed during the λ foreign-reader slice and
resolved as out of scope ("no result type in the text form"); nothing here reopens it.

---

## Item 2 — make `Binary` a participating leg in `native_oracle.rs`

### The governing constraint: additive only

**Every assertion that is green today must run identically after this branch.** No existing check is
rewritten, re-widthed, or weakened. Binary is added *alongside*.

This was a live decision, not a default. The first draft of this design unified both encodings onto
`run_tm_fitted` for a cleaner parameterization. That was rejected:

1. It is a **lateral** coverage trade, not an upgrade. `Unary::default()` is `MAX_FIELD_WIDTH` = 64
   (`encoding/unary.rs:30`); `run_tm_fitted` starts at `MIN_FIELD_WIDTH` and doubles (`tm.rs:194`), so
   most demos would move from width 64 to width 8–16. Fitted exercises narrow banks and the overflow
   boundary; fixed-64 exercises wide banks and never approaches it. Neither dominates.
2. **The width axis is already owned elsewhere** — `tm_width_equivalence.rs` and `tm_bank_invariant.rs`
   both run `widths() × encodings_at(width)`. This file's job is *native agreement*. Fitting here
   duplicates coverage that exists while dropping this file's only fixed-64 unary run.
3. It would **destroy the additive-only property on a branch whose subject is under-delivering
   checks.** If a unary leg went red, nobody could tell a real defect from the width change.
4. `the_tm_reports_its_ceiling_on_the_same_demos` would get slower and less direct: fitted runs the
   program five times (4→8→16→32→64), all overflowing, before reporting.

> **CORRECTION (2026-07-29, during execution — this paragraph as originally written was FALSE).**
> The original text read: *"The asymmetry that remains is semantic, not accidental: binary needs
> fitting because its decode needs the width (`Binary::at(w)`); unary's decode does not."*
> **That is not true.** Both decoders are structural, so a default-width (64) `Binary` decodes a
> fitted-at-16 tape correctly — `a_tape_decodes_the_same_at_every_reader_width`
> (`crates/redextape-core/src/tm.rs:316`) pins exactly that. It was caught by sabotage during Task 3:
> swapping the fitted encoding for `&Binary::default()` was expected to fail and **passed**.
>
> Provenance, because it is the instructive part: core's `three_way_oracle.rs` records this as *"That
> was once REQUIRED"* and then retracts it two sentences later. Writing this spec I extracted the
> obsolete half and propagated it as live justification — through spec, plan, and into committed code
> — because it *reads* like a correctness constraint. Same defect class as this branch's subject,
> introduced by the branch. Fixed in code by commit `fbc970f`.

The asymmetry that remains is a **deliberate convention plus the additive-only constraint, NOT a
correctness requirement**. Binary is fitted because the width it settles on is worth naming (it is the
number `binary_runs_the_demos_unary_cannot_represent` reports — all four demos fit at 16), because it
keeps `at_width` on this file's executed path, and because it is exactly the split core's
`three_way_oracle.rs` already uses, so the two files stay consistent and a third encoding faces the
same choice in both. Unary stays at fixed 64 because changing a green check buys nothing here.

### The seam

One local helper decides which encodings exist, and one decides how to run a leg:

```rust
fn encodings() -> Vec<(&'static str, EncodingKind)> {
    vec![("unary", EncodingKind::Unary), ("binary", EncodingKind::Binary)]
}

/// Run the TM leg for `kind`, returning the outcome AND the encoding to decode it with.
///
/// Unary runs at the fixed `MAX_FIELD_WIDTH` (64) it has always run at here — unchanged, so this
/// branch adds a leg without altering one. Binary uses `run_tm_fitted` by CONVENTION, not because
/// decode requires it (see the correction above). Same split as core's `three_way_oracle.rs`.
fn tm_leg(core: &Core, kind: EncodingKind) -> (TmRun, Box<dyn Encoding>) { ... }
```

`encodings()` is the single place that decides which encodings this file covers. The coverage guard
below reads from it — never from a second hard-coded list, or the guard merely restates the thing it
is checking.

### The five sites

| # | Test | Change |
|---|------|--------|
| 1 | `four_way_oracle_on_the_first_order_suite` | Split into `…_unary` and `…_binary` via a `macro_rules!` that also records `EMITTED`. The unary test's **assertions are unchanged** (same fixed-64 run, same decode, same demos); only its name and the enclosing function change. Binary leg added |
| 2 | `every_encoding_has_a_four_way_test` | **New.** Derives the expected test set from `encodings()` at runtime and compares against `EMITTED` |
| 3 | `the_tm_reports_its_ceiling_on_the_same_demos` | Unary `Overflow` assertion **kept unchanged** (it is the control) + binary **runs** the same demos and agrees with reference/native |
| 4 | `native_agrees_with_reference_and_asm_on_random_programs` | Binary TM leg added; unary asserted "never wrong" (see below) |
| 5 | `SATURATION_DEMOS` | **New.** reference == native == `u64::MAX` while binary-TM == `TmRun::Overflow` |

**The name `four_way` stays correct after the split, and that is not a coincidence.** Each emitted test
is genuinely four-way — reference == λ == TM(*one* encoding) == native. It is the *file* that now
covers five backends, not any single test. Collapsing both encodings into one test would have made
every emitted name understate its own arity; the split keeps name and claim aligned.

Sites 1 and 2 mirror `tm_bank_invariant.rs`'s established pattern exactly: a macro emitting one
`#[test]` per unit, an `EMITTED` const recording what it emitted, and a guard comparing that against
the runtime-derived list. The hazard it defends is real and recorded: add a third encoding to
`encodings()` and, without the guard, that encoding is checked by **nothing** while every remaining
test still passes — the file gets faster and weaker at once.

### Site 3 turns prose into measurement

Today the Task-17 correction ("the gap is native-vs-unary, not native-vs-the-TM-backend") exists only
as a doc comment. Site 3 makes it two measured results side by side: unary `Overflow`, binary a value
equal to reference and native, on the same four demos. **Measured during design:** `100 * 100` fits
binary at width **16** and runs; unary at 64 overflows.

### Site 4's weaker claim, stated as the weaker claim

The generator draws leaves from `0..1000`, which unary cannot represent — that is the point of the
wide-range generator, and it is why this test has no TM leg today. So the two encodings cannot be
asserted symmetrically here:

- **Binary:** full leg. Runs, decodes at the fitted width, must equal the reference.
- **Unary:** asserted **never wrong** — `Ran ⇒ decodes equal to the reference`, `Overflow ⇒ permitted`.

The unary half is a disjunction and must be documented as one. It does not claim unary computes these
programs; it claims unary never *silently* computes them wrongly. That is weaker than the binary leg
and stronger than nothing, and the test's doc comment must say so rather than letting the test name
imply symmetry.

### Site 5 pins a disagreement, not an agreement

The module doc calls values `>= 2^64` "the honest remaining gap … not exercised here". It cannot be
closed by an agreement test, because **the backends genuinely diverge there by design** — measured
2026-07-29 with a throwaway probe:

| program | reference | native | binary-TM (fitted) | unary-TM @64 |
|---|---|---|---|---|
| `18446744073709551615 + 1` | `Nat(u64::MAX)` | `Nat(u64::MAX)` | `Overflow` (width 64) | `Overflow` |
| `let n = 18446744073709551615; n + 1` | `Nat(u64::MAX)` | `Nat(u64::MAX)` | `Overflow` (width 64) | `Overflow` |
| `4294967295 * 4294967295 * 4294967295` | `Nat(u64::MAX)` | `Nat(u64::MAX)` | `Overflow` (width 64) | `Overflow` |

The reference and native **saturate** (`asm.rs:225` — `saturating_add`/`saturating_mul`); the TM
**halts in a rule-less overflow guard** (`lower_tm.rs:159`) and never saturates. Both behaviours are
deliberate; they are simply different, and nothing currently records that in an executable form.

Site 5 asserts exactly that: reference == native == `u64::MAX`, binary-TM == `Overflow`. Its doc
comment must state that agreement is **impossible here by construction**, so a later reader does not
"fix" the test by making the TM saturate.

Also confirmed by the probe: the parser accepts a 20-digit `u64::MAX` literal with no diagnostics, so
the demos need no special construction.

### Not in scope

- `llvm_oracle.rs` and `aot_oracle.rs` have **no TM leg at all** — nothing there pins an encoding, so
  there is nothing to reparameterize. Confirmed by grep.
- `native_demo.rs`'s prose already carries the Task-17 correction and needs no change. **Correction
  (final whole-branch review, 2026-07-29):** this assessment was itself wrong — the module doc's "which
  section 3 below demonstrates instead" promised a demonstration that section 3's own printed output
  says it cannot give (no program in the demo reaches `>= 2^64`). A cleared-file claim that let a false
  sentence ship. Fixed by wording (`demonstrates` → `explains`), not by adding such a program; see the
  roadmap's item 4 write-up.
- Arbitrary-precision (variable-length) fields remain deferred, for the reason the roadmap records:
  every widening write would shift the bank, invalidating the fixed-window in-place-write invariant
  every gadget rests on.

---

## Cost

Measured baseline, 2026-07-29, `cargo nextest run -p redextape-native --features cranelift --test
native_oracle`: **16.786s total**, of which `four_way_oracle_on_the_first_order_suite` is **16.784s** —
one test is the entire wall-clock.

Anchor for the marginal cost: core's `three_way_oracle_on_the_first_order_suite` already runs **both**
encodings over a **superset** of these demos in 17.3s. So a binary leg roughly doubles the TM work in
this file, but the per-encoding split lets nextest schedule the two legs concurrently. Expected
wall-clock: **roughly flat (~17–19s)**. This is a projection, not a measurement — the plan must record
the actual post-change number, and if the split fails to hold wall-clock flat, that is a finding to
report rather than absorb.

---

## Verification

1. `cargo nextest run -p redextape-native --features cranelift` — all green.
2. `scripts/check-all.sh` before merge (the full feature matrix; nextest + paired doctests).
3. **Sabotage checks**, per this project's established practice — each new check must be shown to fail
   when the thing it claims to cover is broken:
   - Delete one generated `four_way_oracle_*` test → the coverage guard (site 2) must be the thing
     that fails.
   - Add a third entry to `encodings()` without a matching test → guard fails.
   - Make the binary leg decode with `Unary::default()` instead of the fitted encoding → site 1 fails.
   - Remove the unary `Overflow` control from site 3 → the test must become obviously weaker (this one
     is an inspection, not an assertion; record the finding).
4. Record the actual wall-clock delta against the 16.786s baseline above.

## What this branch does not establish

- It does not verify any *new* behaviour of the binary encoding. Every leg added here runs code that
  already shipped; what changes is that the native oracle now observes it.
- The coverage guard proves every encoding is covered by *some* test. It says nothing about whether
  any generated test's body is correct — the helpers carry those assertions.
- Site 4's unary half proves absence of silent miscompilation, not agreement.
- The demo corpus is still `FIRST_ORDER_DEMOS`/`LAMBDA_LIMITATION_DEMOS`, built for backend feature
  coverage rather than workload representativeness. The step survey's standing caveat applies here too.
