# Encoding registry, and one shared expression generator — design

**Date:** 2026-07-29
**Status:** approved, ready for planning
**Branch:** `encoding-registry-and-generator-dedup`, stacked on `binary-oracle-leg-and-collision-doc`
(unmerged by choice). Both can merge independently or together.
**Closes:** the two follow-ups filed in the roadmap's "What stays open" by commit `0a381dd`.

---

## The two problems, measured

Both were filed smaller than they are. The numbers below come from surveying the tree, not from the
review transcript that filed them.

**1. Thirteen sites across nine files hard-code the full variant set — in three different shapes.**

> **CORRECTION (2026-07-29, before planning).** This section originally said "six sites across five
> files", counting only functions literally named `encodings`/`encodings_at`. A full grep for
> enumerations of every variant found **thirteen**, including two shapes the original count missed
> entirely. The corrected survey is below. Filing a follow-up smaller than it is was the failure the
> previous branch closed; repeating it in the spec that closes it would be the same defect again.

| file | site | shape |
|---|---|---|
| `redextape-core/tests/tm_bank_invariant.rs:31` | `encodings_at` | `Box<dyn Encoding>` list |
| `redextape-core/tests/tm_heap_stack_shape.rs:44` | `encodings` | `Box<dyn Encoding>` list |
| `redextape-core/tests/tm_static_delimiter_safety.rs:47` | `encodings_at` | `Box<dyn Encoding>` list |
| `redextape-core/tests/tm_width_equivalence.rs:44,50` | `encodings`, `encodings_at` | `Box<dyn Encoding>` list |
| `redextape-core/tests/three_way_oracle.rs:855` | inline in a metamorphic law | `&dyn Encoding` pair |
| `redextape-native/tests/native_oracle.rs:103` | `encodings` | `EncodingKind` list |
| `redextape-core/tests/tm_header.rs:52,222,255` | three `for kind in [..]` loops | `EncodingKind` array |
| `redextape-core/src/tm/header.rs:458` | a unit test in core itself | `EncodingKind` array |
| `redextape-core/tests/tm_header_proptest.rs:66` | `arb_encoding()` | proptest strategy |
| `redextape-core/tests/tm_exhaustive_bank_safety.rs:58` | name → width-list pairing | ~~**not mechanically convertible**~~ — **FALSE, see correction below** |

> **CORRECTION (2026-07-30, after execution).** The last row's verdict was wrong, and so is §B's
> "twelve of the thirteen". `tm_exhaustive_bank_safety.rs` WAS converted (`d5a283a`): `widths_for(kind)`
> and `capacity(kind, width)` became wildcard-free matches on `EncodingKind` and `sweep_targets()`
> derives from `ALL`, so adding an encoding is now an `error[E0004]` at three sites — a compile failure
> before any test runs, rather than the runtime guard this spec settled for.
>
> The mistake was conflating two things: the width VALUES genuinely cannot be inherited by a new
> encoding (they depend on the value range), but the ENUMERATION could always have been compile-forced.
> The mechanism was already in this tree — `tm_leg`'s wildcard-free match, which this very branch relied
> on. Choosing a runtime guard without recording that compile-time had been considered was a claim
> stronger than the evidence. Found by the whole-branch review, not during the task.
>
> Also undercounted: the survey missed a **14th** site (a bare `["unary","binary"]` string array, found
> by executing) and a **15th** (`encoding_kind_instantiates_the_named_encoding_at_the_given_width`,
> found by the whole-branch review). "A full grep for every way" was falsified three times.

Only the `EncodingKind`-typed sites get any compile-time signal at all, and only indirectly (via a
wildcard-free match elsewhere). Every `Box<dyn Encoding>` site calls `Unary::default()` /
`Binary::default()` directly: **adding a third encoding compiles clean and each one silently covers
less.** The last row is a different problem — it pairs each encoding with its own width list, so it
needs judgment, not a mechanical rewrite.

**2. The `prop_recursive(3, 8, 3, …)` five-arm expression generator exists in four places, in two
crates:** `native_oracle.rs` (`arb_native_safe_expr`, `arb_tm_mixed_range_expr`),
`llvm_oracle.rs`, and `redextape-core/tests/three_way_oracle.rs` (`arb_tm_safe_expr`). The filed
follow-up described "two copies in one file."

---

## Why a `macro_rules!` registry, and not the alternatives

**Rejected: a hand-written `EncodingKind::ALL`.** It collapses six drift-points to one, which is most
of the value — but it **cannot be made self-verifying in stable Rust.** A developer can add a variant,
satisfy every exhaustive match in the tree (`at`, `name`, `parse` all break and all get fixed), and
still leave `ALL` one entry short. Every guard then passes. Worked through in full before rejecting:
there is no const-assertion arrangement that catches it, because nothing in the language can compare a
hand-written list against the variant set.

**Rejected: `strum` / `enum-iterator`.** Both would work and are standard. But `redextape-core`'s
`[dependencies]` section is **empty** — WASM-cleanliness here is an enforced invariant, not a
preference — and a derive macro is still a dependency edge. Not worth spending the invariant on.

**Chosen: declare the enum and its consumers from one macro invocation.**

```rust
encoding_kinds! {
    /// Unary: value `n` is `n` filled cells.
    Unary  => "unary"  => Unary,
    /// Binary: a `w`-cell field holds `0..2^w`.
    Binary => "binary" => Binary,
}
```

generating `enum EncodingKind`, `ALL`, `name`, `parse`, and `at`. **Complete by construction:** adding
an encoding is one line that feeds all five, so they cannot drift. Zero new dependencies. It also
matches house style — `four_way_tests!` and `reg_bank_tests!` already generate tests plus the list a
coverage guard reads.

**The cost, stated because it is real:** the enum definition becomes macro-generated, which is less
greppable and produces weaker rustdoc than a plain `enum`. Mitigated by a doc comment above the
invocation naming every variant in plain text, so `grep EncodingKind` still lands somewhere useful.
This is a genuine trade, not a free win.

---

## Why a new `redextape-test-support` crate

The obvious way to share a generator across crates is a feature-gated `pub mod testing` in
`redextape-core/src/`. **That would require `proptest` as an optional regular dependency of core**,
and core's `[dependencies]` is empty by design. An optional dependency is still an entry in that
section.

So: a small `crates/redextape-test-support` crate, a **dev-dependency** of both core and native,
holding the shared generator. Core's `[dependencies]` stays empty; nothing ships in a WASM build.

---

## What ships

### A. The registry (`redextape-core/src/tm/header.rs`)

`encoding_kinds!` generates `EncodingKind` + `ALL` + `name` + `parse` + `at`. Per-variant doc comments
are preserved (`$(#[$meta:meta])*`). Derives stay `Clone, Copy, Debug, PartialEq, Eq`.

`EncodingKind::ALL` becomes the single registration point the whole tree reads.

### B. Twelve of the thirteen sites converted to derive from `ALL`

Each site derives from `EncodingKind::ALL` via `kind.name()` and `kind.at(w)`. The three shapes convert
differently: `Box<dyn Encoding>` lists map `ALL` through `kind.at(w)`; `for kind in [..]` loops iterate
`ALL` directly; `arb_encoding()` becomes `proptest::sample::select(EncodingKind::ALL)`.

~~**The thirteenth (`tm_exhaustive_bank_safety.rs:58`) is deliberately excluded from mechanical
conversion.**~~ **SUPERSEDED — see the correction above the table.** The reasoning as originally written
was: it pairs each encoding with its own width list (`UNARY_WIDTHS`, `BINARY_WIDTHS`), so iterating
`ALL` would need a per-kind width list that does not exist; therefore give it a runtime guard asserting
its pair count equals `EncodingKind::ALL.len()`, "made noisy since it cannot be made automatic."

**What actually shipped (`d5a283a`, `48f8231`):** the site WAS converted. `widths_for(kind)` and
`capacity(kind, width)` are wildcard-free matches on `EncodingKind`; `sweep_targets()` derives from
`ALL`. A new encoding is an `error[E0004]` at three sites — the build fails before any test runs. The
runtime guard was **deleted as vacuous** once derivation made its assertions true by construction, and
`encoding_named` went with it. The width VALUES still cannot be inherited (a human must choose them);
the compiler now forces that choice instead of a test reporting it afterwards.

**Behaviour-preservation, verified before writing the plan:** `Binary::default()` is `MAX_FIELD_WIDTH`
(`encoding/binary.rs:52`), identical to `Unary::default()` (`encoding/unary.rs:30`). So the width-less
sites convert to `kind.at(MAX_FIELD_WIDTH)` and produce **the same encodings at the same widths** — a
refactor, not a re-widthing. This matters: silently moving those tests to a different width would be
the exact "lateral coverage change to already-green checks" the previous branch rejected.

**Expected consequence, and it is the point:** the coverage guards in `tm_bank_invariant.rs` and
`tm_width_equivalence.rs` compare hard-coded generated-test lists against `encodings_at`. Once those
derive from `ALL`, adding an encoding makes those guards fire. That is the gap being closed.

### C. One shared generator (`redextape-test-support`)

```rust
pub fn arb_expr_over(leaf: impl Strategy<Value = String> + 'static) -> impl Strategy<Value = String>
```

— the `prop_recursive(3, 8, 3, …)` five-arm shape, parameterised only by its leaf strategy. All four
copies call it.

**The verification that makes or breaks this:** proptest generation must be **byte-identical for the
same seed** before and after. If the refactor changes the strategy tree, the case distribution shifts
and the previous branch's measured **60.4% unary fire rate** silently stops describing what runs. The
plan must pin this with a fixed-seed comparison, not assume it.

### D. The 60.4% figure, made self-defending

The previous branch left that number protected only by prose. Since `C` puts the generator's structure
under refactoring pressure for the first time, add the deterministic floor assertion that follow-up
called for: a fixed-seed sampling test asserting the unary `Ran` fraction exceeds a floor well below
60.4%. Without it, `C` is exactly the kind of edit that would invalidate the claim silently.

---

## What this does not do

- It does not make `redextape-core` depend on anything at runtime. Core's `[dependencies]` stays empty.
- It does not change any assertion's meaning. Every converted site produces the same encodings at the
  same widths; the generator produces the same programs for the same seed (pinned by test).
- It does not add a third encoding, or make one easier to implement — only impossible to add
  *half-way* without something failing.

## Honest bound

The registry closes drift between `EncodingKind` and its consumers. It does **not** guarantee a new
encoding is *correct*, or that its gadgets are right — only that no list silently omits it. Coverage
and correctness remain separate questions, as they were before.
