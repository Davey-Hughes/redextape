# Encoding Registry & Generator Dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible to add a Turing-machine encoding and leave half the tree silently unaware of it, and collapse four copies of one property-test generator into one shared definition.

**Architecture:** A `macro_rules!` registry in `crates/redextape-core/src/tm/header.rs` declares `EncodingKind` *and* its `ALL`/`name`/`parse`/`at` consumers from one invocation, so they cannot drift. Twelve of thirteen hard-coded variant enumerations across the tree then derive from `EncodingKind::ALL`; the thirteenth is made loudly non-automatic. A new dev-dependency-only `redextape-test-support` crate holds the shared expression generator, keeping `redextape-core`'s `[dependencies]` empty.

**Tech Stack:** Rust 2024, `cargo-nextest` (required), `proptest`, Cranelift + LLVM (feature-gated).

**Spec:** `docs/superpowers/specs/2026-07-29-encoding-registry-and-generator-dedup-design.md`
**Branch:** `encoding-registry-and-generator-dedup`, stacked on `binary-oracle-leg-and-collision-doc`.

---

## Global Constraints

- **`redextape-core`'s `[dependencies]` section MUST STAY EMPTY.** This is an enforced invariant, not a preference — the crate is deliberately WASM-clean. `proptest` is dev-only. Never add an optional or feature-gated regular dependency to it. If a task seems to require one, STOP and report.
- **BEHAVIOUR-PRESERVING REFACTOR.** No test's meaning may change. Every converted site must produce **the same encodings at the same widths** as before. `Binary::default()` and `Unary::default()` are both `MAX_FIELD_WIDTH` = 64 (`encoding/binary.rs:52`, `encoding/unary.rs:30`), so a width-less site converts to `kind.at(MAX_FIELD_WIDTH)`, not to some other width. Silently re-widthing a green test is the exact "lateral coverage change" the predecessor branch rejected.
- **THE GENERATOR EXTRACTION MUST BE SEED-IDENTICAL.** proptest's output depends on the strategy tree. If extraction changes generation for a given seed, the case distribution shifts and the predecessor branch's measured **60.4% unary fire rate** silently stops describing what runs. Task 7 pins this with a fixed-seed comparison; do not assume it.
- **RUN THE FORMATTER IN EVERY TASK.** `cargo fmt --all --check` must pass before each commit. On the predecessor branch the gate was red for eight consecutive tasks because every task ran tests and none ran fmt. Do not repeat that.
- Commit messages must contain NO `Co-Authored-By:` or `Generated with` attribution line (repo owner's standing rule).
- Full gate before merge: `scripts/check-all.sh` (add `--no-llvm` only if no LLVM toolchain, and say so).
- Test runner is `cargo nextest`, not `cargo test`. `redextape-native` tests need `--features cranelift`.
- **TWO SABOTAGE RECIPES, ANSWERING DIFFERENT QUESTIONS. Discovered in Task 2, where the wrong one was used.**
  - **ADDITION** (add a registry row) tests **count-derived guards**: does a check that compares two lists notice a third encoding? Tasks 3, 4 and 5 all turn genuinely red under it (`EMITTED` vs `encodings_at`, the sweep-target count, `tm_leg`'s wildcard-free match).
  - **REMOVAL** (delete the `Binary` row) tests **"did this site stop naming variants by hand?"** A converted site names no variant and still compiles; an unconverted one fails to compile, naming itself.
  - Task 2 needed REMOVAL and was given ADDITION, which carries **zero** distinguishing bits for that property: a site still reading `for k in [Unary, Binary]` would also pass an addition-sabotage, because Rust array literals are not exhaustiveness-checked. Controller re-ran it as a removal: 5 compile errors, none at the four converted sites — all at sites that deliberately name ONE encoding. That is the result the addition-sabotage could not produce.
  - Pick the recipe that can distinguish the hypothesis you are testing from its negation. A sabotage that both hypotheses survive proves nothing, however green or red it comes back.
- **THE SABOTAGE ROW IS `Quaternary => "quaternary" => Unary,` — NOT `Ternary`/`"ternary"`.** Discovered during Task 1: `"ternary"` is already used as a NEGATIVE-case fixture in two places (`src/tm/header.rs`'s `encoding_kind_names_round_trip` asserts `parse("ternary") == None`, and `src/tm/syntax.rs`'s parser tests use it as an unknown-encoding name). A sabotage row named `"ternary"` therefore fails those two tests for a reason that has nothing to do with what the sabotage is testing, muddying every result. `"quaternary"` appears nowhere in the tree. Do not "simplify" it back.

### Reference facts (measured; do not re-derive)

| Fact | Value |
|---|---|
| `EncodingKind` location | `crates/redextape-core/src/tm/header.rs:49` |
| Current derives | `#[derive(Clone, Copy, Debug, PartialEq, Eq)]` |
| `Unary::default()` / `Binary::default()` | both `MAX_FIELD_WIDTH` = 64 |
| Sites hard-coding every variant | **13, across 9 files** (table in the spec) |
| Copies of the `prop_recursive(3, 8, 3, …)` generator | **4**, in 2 crates |
| Workspace members | `crates/redextape-{core,native,native-rt}` |
| Baseline suite | 644 tests, `check-all.sh` green |

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `crates/redextape-core/src/tm/header.rs` | `EncodingKind` + the text-form header | Registry macro replaces the hand-written enum and its three impls (Task 1) |
| `crates/redextape-core/src/tm.rs` | re-exports | Verify `EncodingKind` still exported (Task 1) |
| `crates/redextape-core/tests/tm_header{,_proptest}.rs` | header round-trip | 4 sites derive from `ALL` (Task 2) |
| `crates/redextape-core/tests/tm_{bank_invariant,heap_stack_shape,static_delimiter_safety,width_equivalence}.rs` | TM invariants | 5 sites derive from `ALL` (Task 3) |
| `crates/redextape-core/tests/three_way_oracle.rs` | the three-way oracle | 1 inline site (Task 3) |
| `crates/redextape-core/tests/tm_exhaustive_bank_safety.rs` | exhaustive sweep | count guard, NOT converted (Task 4) |
| `crates/redextape-native/tests/native_oracle.rs` | the native oracle | `encodings()` derives from `ALL` (Task 5) |
| `crates/redextape-test-support/` | **NEW** shared test helpers | The one expression generator (Task 6) |
| `crates/redextape-{core,native}/tests/*` | proptest users | 4 generator copies → 1 (Task 7) |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | roadmap | Close both follow-ups (Task 9) |

---

## Task 1: The registry macro

**Files:**
- Modify: `crates/redextape-core/src/tm/header.rs:44-90` (the enum + `at`/`name`/`parse` impls)
- Verify: `crates/redextape-core/src/tm.rs:31` (the `pub use header::{EncodingKind, …}` line)

**Interfaces:**
- Consumes: nothing.
- Produces, relied on by every later task:
  - `EncodingKind::ALL: &'static [EncodingKind]`
  - `EncodingKind::at(self, width: usize) -> Box<dyn Encoding>` (unchanged signature)
  - `EncodingKind::name(self) -> &'static str` (unchanged)
  - `EncodingKind::parse(s: &str) -> Option<EncodingKind>` (unchanged)

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/src/tm/header.rs`'s existing `#[cfg(test)] mod tests`:

```rust
    /// `ALL` is generated by the same macro invocation that declares the variants, so it cannot omit
    /// one. This test pins the consequences a caller depends on: every entry round-trips through
    /// `name`/`parse`, and no two entries share a name.
    #[test]
    fn all_lists_every_kind_and_round_trips() {
        assert!(!EncodingKind::ALL.is_empty());
        for k in EncodingKind::ALL {
            assert_eq!(EncodingKind::parse(k.name()), Some(*k), "`{}` does not round-trip", k.name());
        }
        let mut names: Vec<&str> = EncodingKind::ALL.iter().map(|k| k.name()).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(names.len(), before, "two encodings share a name");
    }
```

- [ ] **Step 2: Run it — expect a COMPILE failure**

Run: `cargo test -p redextape-core --lib tm::header::tests::all_lists_every_kind_and_round_trips 2>&1 | head -20`
Expected: fails to compile, `no associated item named ALL found for enum EncodingKind`.

- [ ] **Step 3: Replace the hand-written enum with the registry macro**

In `crates/redextape-core/src/tm/header.rs`, replace the `#[derive(...)] pub enum EncodingKind {...}` block and the whole `impl EncodingKind { at, name, parse }` block with:

```rust
/// Declares `EncodingKind` and every list that must know about it, from ONE invocation.
///
/// THE POINT: `ALL`, `at`, `name` and `parse` are generated from the same rows, so they cannot drift.
/// Adding an encoding is one line here; a hand-written `ALL` beside a hand-written enum could not give
/// that guarantee, because nothing in stable Rust compares a written-out list against the variant set —
/// a developer can satisfy every exhaustive match and still leave the list short.
///
/// COST, stated because it is real: the enum is macro-generated, so it is less greppable and produces
/// weaker rustdoc than a plain `enum`. The invocation below is the definition — read it as one.
macro_rules! encoding_kinds {
    ($( $(#[$meta:meta])* $variant:ident => $name:literal => $ty:ty ),* $(,)?) => {
        /// Which `Encoding` a file names.
        ///
        /// Generated by `encoding_kinds!` together with `ALL`/`at`/`name`/`parse` — see that macro for
        /// why. **Adding an encoding means adding one row to the invocation below, nothing else.**
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum EncodingKind {
            $( $(#[$meta])* $variant ),*
        }

        impl EncodingKind {
            /// Every kind, in declaration order. Generated from the same rows as the variants, so it
            /// cannot omit one. Iterate this rather than writing a list out: a hand-written list is a
            /// place a future encoding gets silently left out of.
            pub const ALL: &'static [EncodingKind] = &[ $( EncodingKind::$variant ),* ];

            /// This kind instantiated at `width` cells. Both kinds are BOUNDED (`field_width()` is
            /// always `Some`), which is why the producer in `tm.rs` needs no unbounded early-return
            /// branch the way `run_tm_fitted` does — an unbounded encoding has no name in this enum to
            /// write in a file.
            pub fn at(self, width: usize) -> Box<dyn Encoding> {
                match self {
                    $( EncodingKind::$variant => Box::new(<$ty>::at(width)) ),*
                }
            }

            /// The name written in an `encoding` directive. Lowercase, matching the rest of the text
            /// form's keywords (`tapes`, `start`, `state`, `accept`).
            pub fn name(self) -> &'static str {
                match self {
                    $( EncodingKind::$variant => $name ),*
                }
            }

            /// The inverse of `name`. `None` for an unrecognized name, which the parser reports as a
            /// diagnostic rather than defaulting — a file naming an encoding this build does not have
            /// is unreadable, and guessing would decode its tape as something else entirely.
            pub fn parse(s: &str) -> Option<EncodingKind> {
                match s {
                    $( $name => Some(EncodingKind::$variant), )*
                    _ => None,
                }
            }
        }
    };
}

// THE REGISTRATION POINT. One row per encoding: variant, its name in a `.tm` file, its `Encoding` type.
// Adding a row updates `EncodingKind`, `ALL`, `at`, `name` and `parse` together.
encoding_kinds! {
    /// Unary: value `n` is `n` filled cells, so a `w`-cell field holds `0..=w`.
    Unary => "unary" => Unary,
    /// Binary: a `w`-cell field is base-2, holding `0..2^w`.
    Binary => "binary" => Binary,
}
```

**Preserve whatever `parse`'s original body did for the fallthrough** — read the existing code first; if it returned `None` for unknown names (it does), the generated version above matches.

- [ ] **Step 4: Run the test and the whole core suite**

Run: `cargo nextest run -p redextape-core`
Expected: all pass, including the new `all_lists_every_kind_and_round_trips`. Every pre-existing header test must still pass unchanged — the generated API is signature-identical.

- [ ] **Step 5: Prove the registry actually forces the link (sabotage)**

Temporarily add a third row to the invocation:

```rust
    Quaternary => "quaternary" => Unary,   // SABOTAGE: type is a lie, we only need it to compile
```

Run: `cargo nextest run -p redextape-core 2>&1 | tail -30`

Expected: it COMPILES (that is the point — `ALL`, `name`, `parse`, `at` all updated themselves), and `EncodingKind::ALL.len()` is now 3. Confirm by checking whether any test that iterates `ALL` now runs three encodings. **Then revert the sabotage** and confirm green.

Record in your report what this did and did NOT prove: it proves the five generated items move together. It does not prove other files noticed — that is Tasks 2-5.

- [ ] **Step 6: Format, then commit**

```bash
cargo fmt --all
cargo fmt --all --check
git add crates/redextape-core/src/tm/header.rs
git commit -m "feat(tm): generate EncodingKind and its consumers from one registry

ALL, at, name and parse are now generated from the same rows that declare
the variants, so they cannot drift. Adding an encoding is one row.

A hand-written ALL beside a hand-written enum was considered and rejected:
it cannot be made self-verifying in stable Rust. A developer can add a
variant, fix every exhaustive match the compiler flags, and still leave
ALL one entry short -- nothing in the language compares a written-out list
against the variant set.

strum/enum-iterator would also work but core's [dependencies] is empty by
design and stays that way.

Cost, recorded rather than hidden: the enum is macro-generated, so it is
less greppable and its rustdoc is weaker than a plain enum's."
```

---

## Task 2: The `EncodingKind`-typed sites derive from `ALL`

**Files:**
- Modify: `crates/redextape-core/src/tm/header.rs:458` (a `for k in [..]` in core's own tests)
- Modify: `crates/redextape-core/tests/tm_header.rs:52,222,255` (three `for kind in [..]` loops)
- Modify: `crates/redextape-core/tests/tm_header_proptest.rs:66` (`arb_encoding()`)

**Interfaces:**
- Consumes: `EncodingKind::ALL` (Task 1).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Convert the four sites**

Each `for kind in [EncodingKind::Unary, EncodingKind::Binary] {` becomes:

```rust
    for &kind in EncodingKind::ALL {
```

(note `&kind` — `ALL` is a slice, so iteration yields `&EncodingKind`; `EncodingKind` is `Copy`.)

At `crates/redextape-core/src/tm/header.rs:458`, the loop variable is `k`; use `for &k in EncodingKind::ALL {`.

At `crates/redextape-core/tests/tm_header_proptest.rs:66`, replace:

```rust
    prop_oneof![Just(EncodingKind::Unary), Just(EncodingKind::Binary)]
```

with:

```rust
    // Derived from `EncodingKind::ALL`, not written out: a hand-listed strategy would keep generating
    // only the encodings someone remembered, and the generator is exactly where that goes unnoticed.
    proptest::sample::select(EncodingKind::ALL)
```

**Check the import:** `tm_header_proptest.rs` already has `use proptest::prelude::*;`. `proptest::sample::select` is re-exported by the prelude in proptest 1.x as `select`; if the fully-qualified path fails to resolve, use bare `select(EncodingKind::ALL)`. Report which you used.

- [ ] **Step 2: Run the affected tests**

Run: `cargo nextest run -p redextape-core tm_header`
Expected: all pass, same count as before your change.

- [ ] **Step 3: Sabotage — prove the sites now follow `ALL`**

Temporarily add `Quaternary => "quaternary" => Unary,` to the `encoding_kinds!` invocation in `header.rs`.

Run: `cargo nextest run -p redextape-core tm_header 2>&1 | tail -20`

Expected: the converted loops now exercise **three** encodings. Whether that passes or fails is informative either way — report which, and if a test fails, report the failure text, since a genuine `Ternary` would need real gadget work. **Revert the sabotage** and confirm green.

- [ ] **Step 4: Format and commit**

```bash
cargo fmt --all && cargo fmt --all --check
git add crates/redextape-core/src/tm/header.rs crates/redextape-core/tests/tm_header.rs crates/redextape-core/tests/tm_header_proptest.rs
git commit -m "test(tm): derive the EncodingKind-typed sites from ALL

Four sites wrote out every variant by hand: three loops in tm_header.rs,
one in header.rs's own tests, and arb_encoding()'s proptest strategy. A
hand-listed strategy is the worst of them -- it silently keeps generating
only the encodings someone remembered."
```

---

## Task 3: The `Box<dyn Encoding>` list-sites derive from `ALL`

**Files:**
- Modify: `crates/redextape-core/tests/tm_bank_invariant.rs:30-32`
- Modify: `crates/redextape-core/tests/tm_heap_stack_shape.rs:43-45`
- Modify: `crates/redextape-core/tests/tm_static_delimiter_safety.rs:46-48`
- Modify: `crates/redextape-core/tests/tm_width_equivalence.rs:43-51`
- Modify: `crates/redextape-core/tests/three_way_oracle.rs:855`

**Interfaces:**
- Consumes: `EncodingKind::ALL`, `EncodingKind::at`, `EncodingKind::name` (Task 1).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Convert the width-taking helpers**

`tm_bank_invariant.rs`, `tm_static_delimiter_safety.rs`, and `tm_width_equivalence.rs`'s `encodings_at` all have this body:

```rust
    vec![("unary", Box::new(Unary::at(width))), ("binary", Box::new(Binary::at(width)))]
```

Replace each with:

```rust
    EncodingKind::ALL.iter().map(|&k| (k.name(), k.at(width))).collect()
```

Keep each function's existing doc comment and signature (`-> Vec<(&'static str, Box<dyn Encoding>)>`).

Add `EncodingKind` to each file's `use redextape_core::tm::{...}` import list. `Unary`/`Binary` may become unused in some files — remove them from the import only if the compiler warns, and say which files that affected.

- [ ] **Step 2: Convert the width-less helpers**

`tm_heap_stack_shape.rs:44` and `tm_width_equivalence.rs:44` have:

```rust
    vec![("unary", Box::new(Unary::default())), ("binary", Box::new(Binary::default()))]
```

Replace with:

```rust
    EncodingKind::ALL.iter().map(|&k| (k.name(), k.at(MAX_FIELD_WIDTH))).collect()
```

**This is behaviour-preserving and that is not an assumption:** `Unary::default()` is `MAX_FIELD_WIDTH` (`encoding/unary.rs:30`) and `Binary::default()` is `MAX_FIELD_WIDTH` (`encoding/binary.rs:52`). Import `MAX_FIELD_WIDTH` from `redextape_core::tm`.

Add a one-line comment at each site recording why the width is explicit:

```rust
    // `at(MAX_FIELD_WIDTH)`, not a default: identical to `{Unary,Binary}::default()` today, and stated
    // explicitly so a future encoding whose default differs cannot silently re-width this test.
```

- [ ] **Step 3: Convert the inline site in `three_way_oracle.rs:855`**

It currently reads:

```rust
                [("unary", &Unary::default() as &dyn Encoding), ("binary", &Binary::default() as &dyn Encoding)]
```

This one borrows temporaries, so it cannot become an iterator chain in place without lifetime trouble. Bind owned boxes first:

```rust
                let encs: Vec<(&'static str, Box<dyn Encoding>)> =
                    EncodingKind::ALL.iter().map(|&k| (k.name(), k.at(MAX_FIELD_WIDTH))).collect();
```

then iterate `encs.iter().map(|(n, e)| (*n, e.as_ref()))` where the original array was consumed. **Read the surrounding function before editing** — it is inside a metamorphic-law test and the iteration shape matters. If the rewrite gets awkward, keep the array literal but derive it from `ALL` with an assertion that `EncodingKind::ALL.len() == 2` beside it, and REPORT that you did — a guarded hand-list is an acceptable fallback here, silence is not.

- [ ] **Step 4: Run the full core suite**

Run: `cargo nextest run -p redextape-core`
Expected: all pass, **same test count as before** (644 workspace-wide; core's subset unchanged). A changed count means a coverage guard fired — investigate and report before proceeding.

- [ ] **Step 5: Sabotage — the payoff step**

Temporarily add `Quaternary => "quaternary" => Unary,` to `encoding_kinds!`.

Run: `cargo nextest run -p redextape-core 2>&1 | tail -40`

Expected: the coverage guards in `tm_bank_invariant.rs` (`the_split_covers_the_whole_cross_product`) and `tm_width_equivalence.rs` now FAIL, because their hard-coded generated-test lists no longer match `encodings_at`. **That failure is the entire point of this task** — before it, adding an encoding was silent. Record the exact failure text. **Revert** and confirm green.

- [ ] **Step 6: Format and commit**

```bash
cargo fmt --all && cargo fmt --all --check
git add crates/redextape-core/tests/
git commit -m "test(tm): derive the Box<dyn Encoding> list-sites from ALL

Five sites built their encoding lists from concrete types, so adding a
variant compiled clean and each silently covered less. They now derive
from EncodingKind::ALL.

Behaviour-preserving, not a re-widthing: the width-less sites become
at(MAX_FIELD_WIDTH), which is what {Unary,Binary}::default() already
returns. Stated explicitly at each site so a future encoding with a
different default cannot silently move these tests to another width.

Sabotage-verified: with a third row in the registry, the coverage guards
in tm_bank_invariant.rs and tm_width_equivalence.rs now fail. Before this
commit they passed."
```

---

## Task 4: The one site that cannot be converted, made loud

> **CORRECTION (2026-07-30, after the whole-branch review). This task's premise was wrong.** It
> asserts throughout that `tm_exhaustive_bank_safety.rs` "cannot be made automatic" and settles for a
> runtime count guard. **It could.** Commits `d5a283a`/`48f8231` made `widths_for(kind)` and
> `capacity(kind, width)` wildcard-free matches on `EncodingKind` with `sweep_targets()` deriving from
> `ALL`, so a new encoding is now an `error[E0004]` at three sites — the build fails before any test
> runs, and the runtime guard this task built was deleted as vacuous.
>
> The confusion was between the width VALUES (genuinely un-inheritable — a human must pick them) and
> the ENUMERATION (always compile-forceable, by the same mechanism `tm_leg` in this very branch relies
> on). Read the steps below as history; the shipped design is in the spec's corrected §B.

**Files:**
- Modify: `crates/redextape-core/tests/tm_exhaustive_bank_safety.rs:58` and its surrounding function

**Interfaces:**
- Consumes: `EncodingKind::ALL` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Read the site and understand why it resists conversion**

Run: `sed -n '40,80p' crates/redextape-core/tests/tm_exhaustive_bank_safety.rs`

It pairs each encoding with **its own width list** (`UNARY_WIDTHS`, `BINARY_WIDTHS`). Iterating `ALL` would require a width list per kind, which does not exist and which a third encoding could not supply automatically — the right widths for an encoding depend on how it represents values.

- [ ] **Step 2: Extend `sweep_targets`'s doc comment**

The function is `fn sweep_targets() -> [(&'static str, &'static [usize]); 2]` returning
`[("unary", UNARY_WIDTHS), ("binary", BINARY_WIDTHS)]`. Its existing doc already explains why the width
lists differ per encoding — keep that, and append:

```rust
/// DELIBERATELY HAND-LISTED, unlike every other encoding list in this tree, which derive from
/// `EncodingKind::ALL`. There is no width list a third encoding could inherit: "narrow enough that
/// overflow is common" is a property of the value RANGE, which is exactly what differs between
/// encodings. So this one cannot be made automatic — it is made LOUD instead, by
/// `every_encoding_has_a_sweep_target` below.
```

- [ ] **Step 3: Add the guard as its OWN fast-tier test**

This file's sweep is in the slow tier (its heavy tests are `#[ignore]`d). A guard buried inside an
ignored sweep would not run on the normal gate — it would be a check that exists and never fires,
which is the defect class this whole line of work exists to remove. So the guard is a separate,
NON-ignored test:

```rust
/// The count guard for `sweep_targets`, kept OUT of the ignored sweep deliberately: a guard that only
/// runs in the slow tier would not fire on the ordinary gate, and a check that never runs is worse
/// than no check because it reads like coverage.
///
/// This is the one encoding list in the tree that cannot derive from `EncodingKind::ALL` — see
/// `sweep_targets`'s doc for why. Failing loudly is the substitute for being automatic.
#[test]
fn every_encoding_has_a_sweep_target() {
    assert_eq!(
        sweep_targets().len(),
        EncodingKind::ALL.len(),
        "a new encoding was added to `EncodingKind` without a width list in `sweep_targets`; pick its \
         widths deliberately — they cannot be inherited, because the right widths depend on how the \
         encoding represents values"
    );
    // Names must match too: a target naming an encoding that no longer exists would sweep nothing.
    for (name, _) in sweep_targets() {
        assert!(
            EncodingKind::ALL.iter().any(|k| k.name() == name),
            "`sweep_targets` names `{name}`, which is not an `EncodingKind`"
        );
    }
}
```

Add `EncodingKind` to the file's `redextape_core::tm` import.

- [ ] **Step 4: Run the guard**

Run: `cargo nextest run -p redextape-core --test tm_exhaustive_bank_safety every_encoding_has_a_sweep_target`
Expected: PASS (2 == 2, both names resolve). Confirm it is NOT skipped — if nextest reports it as skipped, it inherited an `#[ignore]` and must be moved out.

- [ ] **Step 5: Sabotage**

Add `Quaternary => "quaternary" => Unary,` to `encoding_kinds!`. Expected: `every_encoding_has_a_sweep_target` FAILS with the message above (2 != 3). **Revert** and confirm green.

- [ ] **Step 6: Format and commit**

```bash
cargo fmt --all && cargo fmt --all --check
git add crates/redextape-core/tests/tm_exhaustive_bank_safety.rs
git commit -m "test(tm): make the one un-convertible encoding list fail loudly

This site pairs each encoding with its own width list, and the right
widths depend on how an encoding represents values -- there is nothing a
third encoding could inherit. It cannot be made automatic, so it is made
noisy: a count assertion against EncodingKind::ALL.len() fails the moment
an encoding lands without someone choosing its widths deliberately.

Sabotage-verified with a third registry row."
```

---

## Task 5: `native_oracle.rs`'s `encodings()` derives from `ALL`

**Files:**
- Modify: `crates/redextape-native/tests/native_oracle.rs:100-104`

**Interfaces:**
- Consumes: `EncodingKind::ALL`, `EncodingKind::name` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Convert `encodings()`**

It currently reads (with its doc comment above it — keep that):

```rust
fn encodings() -> Vec<(&'static str, EncodingKind)> {
    vec![("unary", EncodingKind::Unary), ("binary", EncodingKind::Binary)]
}
```

Replace the body with:

```rust
    EncodingKind::ALL.iter().map(|&k| (k.name(), k)).collect()
```

- [ ] **Step 2: Update the module doc, which now overstates in the OPPOSITE direction**

This file's module doc (around lines 21-31) currently explains — correctly, as of the predecessor branch — that `encodings()` is a hand-written list nothing forces you to extend, and that "remembering to extend `encodings()` is the one link nothing enforces."

**That is now false, and leaving it would be a stale claim in the file whose branch existed to remove stale claims.** Rewrite that passage: `encodings()` now derives from `EncodingKind::ALL`, which is generated by the same macro invocation that declares the variants, so the chain is closed end to end — adding a `EncodingKind` row updates `ALL`, which updates `encodings()`, which the coverage guard compares against `EMITTED`. State what remains true: the guard still only catches drift between `encodings()` and `EMITTED`; what changed is that `encodings()` can no longer itself fall behind.

Apply the same correction to `every_encoding_has_a_four_way_test`'s own doc comment (around line 425), which carries the matching statement at its point of use.

- [ ] **Step 3: Run the native oracle**

Run: `cargo nextest run -p redextape-native --features cranelift --test native_oracle`
Expected: 12/12 pass.

- [ ] **Step 4: Sabotage — the end-to-end payoff**

Add `Quaternary => "quaternary" => Unary,` to `encoding_kinds!` in core.

Run: `cargo nextest run -p redextape-native --features cranelift --test native_oracle 2>&1 | tail -25`

Expected: **a compile error** in `tm_leg`'s wildcard-free match (non-exhaustive), and — once you add a throwaway arm to get past it — `every_encoding_has_a_four_way_test` FAILS because `encodings()` now has three entries and `EMITTED` has two. Do both halves and record both, then **revert everything** and confirm 12/12.

This is the claim the predecessor branch could not make. Record it precisely.

- [ ] **Step 5: Format and commit**

```bash
cargo fmt --all && cargo fmt --all --check
git add crates/redextape-native/tests/native_oracle.rs
git commit -m "test(native): close the last link in the encoding chain

encodings() derives from EncodingKind::ALL, which is generated by the same
macro invocation that declares the variants. Adding a row now propagates
all the way to this file's coverage guard.

Also corrects this file's module doc, which said 'remembering to extend
encodings() is the one link nothing enforces'. That was true when written
and is now false -- leaving it would be a stale claim in the file whose
branch existed to remove them."
```

---

## Task 6: The `redextape-test-support` crate

**Files:**
- Create: `crates/redextape-test-support/Cargo.toml`
- Create: `crates/redextape-test-support/src/lib.rs`
- Modify: `Cargo.toml:3` (workspace members)
- Modify: `crates/redextape-core/Cargo.toml` (dev-dependencies)
- Modify: `crates/redextape-native/Cargo.toml` (dev-dependencies)

**Interfaces:**
- Consumes: nothing.
- Produces, relied on by Task 7:
  - `redextape_test_support::arb_expr_over(leaf: impl Strategy<Value = String> + 'static) -> impl Strategy<Value = String>`

- [ ] **Step 1: Create the crate manifest**

`crates/redextape-test-support/Cargo.toml`:

```toml
[package]
name = "redextape-test-support"
version = "0.0.0"
edition.workspace = true
license.workspace = true
repository.workspace = true
publish = false

[lints]
workspace = true

[dependencies]
proptest = "1"
```

- [ ] **Step 2: Add it to the workspace**

In the root `Cargo.toml`, change the members line to:

```toml
members = ["crates/redextape-core", "crates/redextape-native", "crates/redextape-native-rt", "crates/redextape-test-support"]
```

- [ ] **Step 3: Write the shared generator**

`crates/redextape-test-support/src/lib.rs`:

```rust
//! Test-only helpers shared across this workspace's crates.
//!
//! **A DEV-DEPENDENCY ONLY, and that is the reason this crate exists.** The natural home for
//! `arb_expr_over` would be a feature-gated module inside `redextape-core` — but that would put
//! `proptest` in core's `[dependencies]` as an optional entry, and core's `[dependencies]` is EMPTY by
//! design: the crate is deliberately WASM-clean. A separate crate keeps that invariant intact while
//! still letting `redextape-core` and `redextape-native` share one definition.

use proptest::prelude::*;

/// The workspace's one first-order expression generator, parameterised by its LEAF strategy.
///
/// Every caller shares this shape — `prop_recursive(3, 8, 3, …)` over five arms: `+`, `-`, a `>`
/// comparison, an `==` comparison, and a three-argument `if`. Callers differ ONLY in what a leaf is:
/// a wide range, a narrow one, or a mix. That is deliberate. Several tests compare results across
/// backends and encodings, and those comparisons only mean something if the programs are drawn from
/// the same distribution shape — four copies of this that could drift independently made a claim
/// nothing enforced.
///
/// DO NOT change the recursion parameters or the arm set without re-measuring every caller that
/// records a rate or a fire count against them. `binary_tm_agrees_while_unary_tm_is_never_wrong_on_
/// random_programs` (in `redextape-native`) documents a measured 60.4% unary fire rate that is a
/// property of THIS shape combined with its leaf strategy.
pub fn arb_expr_over(leaf: impl Strategy<Value = String> + 'static) -> impl Strategy<Value = String> {
    leaf.prop_recursive(3, 8, 3, |inner| {
        prop_oneof![
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} + {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("({a} - {b})")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} > {b} {{ 1 }} else {{ 0 }}")),
            (inner.clone(), inner.clone()).prop_map(|(a, b)| format!("if {a} == {b} {{ 1 }} else {{ 0 }}")),
            (inner.clone(), inner.clone(), inner).prop_map(|(c, a, b)| format!("if {c} > 0 {{ {a} }} else {{ {b} }}")),
        ]
    })
}
```

- [ ] **Step 4: Wire it into both crates as a DEV-dependency**

In `crates/redextape-core/Cargo.toml`, under `[dev-dependencies]` (NOT `[dependencies]`):

```toml
redextape-test-support = { path = "../redextape-test-support" }
```

Same line under `[dev-dependencies]` in `crates/redextape-native/Cargo.toml`.

- [ ] **Step 5: Verify core's dependency invariant is intact**

Run:
```bash
sed -n '/^\[dependencies\]/,/^\[/p' crates/redextape-core/Cargo.toml
cargo tree -p redextape-core --edges normal | head -20
```
Expected: the `[dependencies]` section is still EMPTY, and the normal-edges tree shows `redextape-core` with no dependencies. **If either shows otherwise, STOP and report** — that is the invariant this crate exists to protect.

- [ ] **Step 6: Build and commit**

```bash
cargo build --workspace
cargo fmt --all && cargo fmt --all --check
git add Cargo.toml crates/redextape-test-support crates/redextape-core/Cargo.toml crates/redextape-native/Cargo.toml
git commit -m "feat(test-support): add a dev-only crate for shared test helpers

Holds the one first-order expression generator that four test sites in two
crates had copies of.

A separate crate rather than a feature-gated module in redextape-core:
the latter needs proptest as an optional REGULAR dependency of core, and
core's [dependencies] is empty by design -- the crate is deliberately
WASM-clean. A dev-dependency keeps that intact."
```

---

## Task 7: Four generator copies become one — with a seed-identity proof

**Files:**
- Modify: `crates/redextape-native/tests/native_oracle.rs` (`arb_native_safe_expr`, `arb_tm_mixed_range_expr`)
- Modify: `crates/redextape-native/tests/llvm_oracle.rs` (its generator)
- Modify: `crates/redextape-core/tests/three_way_oracle.rs` (`arb_tm_safe_expr`)

**Interfaces:**
- Consumes: `redextape_test_support::arb_expr_over` (Task 6).
- Produces: nothing.

- [ ] **Step 1: Capture the BEFORE baseline — do this before changing anything**

For each of the four generators, capture what it produces for a fixed seed. Add a temporary test to each file:

```rust
    #[test]
    fn zz_capture_baseline() {
        use proptest::test_runner::{Config, TestRunner, RngAlgorithm, TestRng};
        let mut runner = TestRunner::new_with_rng(
            Config::default(),
            TestRng::deterministic_rng(RngAlgorithm::ChaCha),
        );
        let strat = arb_native_safe_expr();   // <-- the generator under test, by name
        for _ in 0..20 {
            let v = strat.new_tree(&mut runner).unwrap().current();
            println!("{v}");
        }
    }
```

Run each with `--no-capture` and save the 20 lines to a file under the scratch dir. Name the generator correctly per file.

**This step is the whole point of the task.** If you skip it you cannot prove the refactor is safe, and the 60.4% figure silently becomes unverifiable.

- [ ] **Step 2: Convert all four generators to call `arb_expr_over`**

In `crates/redextape-native/tests/native_oracle.rs`:

```rust
fn arb_native_safe_expr() -> impl Strategy<Value = String> {
    arb_expr_over((0u64..1000).prop_map(|n| n.to_string()))
}

fn arb_tm_mixed_range_expr() -> impl Strategy<Value = String> {
    arb_expr_over(prop_oneof![4 => (0u64..8), 1 => (0u64..1000)].prop_map(|n| n.to_string()))
}
```

**Read each existing generator first and preserve its leaf strategy EXACTLY** — including the `prop_oneof!` weights on the mixed one and each file's own leaf range. Keep every existing doc comment on these functions; they carry measured figures.

Add `use redextape_test_support::arb_expr_over;` to each file.

Do the same for `llvm_oracle.rs` and `three_way_oracle.rs`, using **their own** leaf strategies unchanged. If any of the four turns out NOT to share the `(3, 8, 3)` five-arm shape, do not force it — leave it alone and report the difference. Verify before converting.

- [ ] **Step 3: Capture the AFTER output and DIFF it against the baseline**

Re-run the same temporary capture tests. Diff each against its saved baseline.

Expected: **byte-identical**. If any differs, the refactor changed the strategy tree: STOP, revert that file, and report exactly which generator differs and how. Do not proceed on a "close enough" diff — a shifted distribution invalidates every rate this suite records.

- [ ] **Step 4: Remove the temporary capture tests**

Delete all four `zz_capture_baseline` tests. Confirm with `grep -rn "zz_capture_baseline" crates/` returning nothing.

- [ ] **Step 5: Run everything**

```bash
cargo nextest run --workspace
cargo nextest run -p redextape-native --features cranelift
```
Expected: 644 tests pass (plus whatever Task 1's new test added), no failures.

- [ ] **Step 6: Format and commit**

```bash
cargo fmt --all && cargo fmt --all --check
git add crates/
git commit -m "refactor(test): four copies of the expression generator become one

native_oracle.rs had two, llvm_oracle.rs and three_way_oracle.rs one each.
Their doc comments claimed structural identity; nothing enforced it. They
now share arb_expr_over from redextape-test-support and differ only in
their leaf strategy, which is the only thing that ever differed.

Seed-identity verified, not assumed: each generator's output for a fixed
deterministic RNG was captured before the change and diffed byte-for-byte
after. A shifted distribution would silently invalidate the measured 60.4%
unary fire rate that one caller documents."
```

---

## Task 8: Make the 60.4% figure self-defending

**Files:**
- Modify: `crates/redextape-native/tests/native_oracle.rs`

**Interfaces:**
- Consumes: `tm_leg`, `arb_tm_mixed_range_expr` (existing).
- Produces: nothing.

- [ ] **Step 1: Add the deterministic floor test**

The predecessor branch measured that the unary leg of `binary_tm_agrees_while_unary_tm_is_never_wrong_on_random_programs` runs (rather than overflowing) in 60.4% of cases, and that number is the entire justification the check is not near-vacuous. Nothing currently fails if a generator edit walks it back. Task 7 just put that generator under refactoring pressure for the first time.

Add, next to that proptest:

```rust
/// The 60.4% figure in `binary_tm_agrees_while_unary_tm_is_never_wrong_on_random_programs`'s doc is
/// LOAD-BEARING: it is the whole reason that test's unary half is not near-vacuous. Before the mixed
/// generator it was 0.6%, and the check asserted nothing on ~70% of runs.
///
/// Nothing used to fail if a leaf-range or weight edit walked that back — the doc comment would simply
/// become false. This pins a FLOOR, deterministically (fixed RNG, so it cannot flake), well below the
/// measured value: the point is to catch a regression to near-zero, not to pin 60.4% exactly, which
/// would break on any legitimate retuning.
#[test]
fn the_unary_leg_of_the_random_test_actually_fires() {
    use proptest::strategy::{Strategy, ValueTree};
    use proptest::test_runner::{Config, RngAlgorithm, TestRng, TestRunner};

    const SAMPLES: usize = 200;
    const FLOOR: usize = 60; // 30% of SAMPLES; measured ~60.4%, so this has wide headroom.

    let mut runner =
        TestRunner::new_with_rng(Config::default(), TestRng::deterministic_rng(RngAlgorithm::ChaCha));
    let strat = arb_tm_mixed_range_expr();
    let mut ran = 0usize;
    for _ in 0..SAMPLES {
        let src = strat.new_tree(&mut runner).expect("generator produces a value").current();
        let core = core_of(&src);
        if matches!(tm_leg(&core, EncodingKind::Unary).0, TmRun::Ran { .. }) {
            ran += 1;
        }
    }
    assert!(
        ran >= FLOOR,
        "the unary leg ran on only {ran}/{SAMPLES} generated programs (floor {FLOOR}); the mixed-range \
         generator's small-leaf weight was probably reduced, which would make the ~60.4% figure in \
         `binary_tm_agrees_while_unary_tm_is_never_wrong_on_random_programs`'s doc comment false"
    );
}
```

- [ ] **Step 2: Run it and record the actual number**

Run: `cargo nextest run -p redextape-native --features cranelift --test native_oracle the_unary_leg_of_the_random_test_actually_fires --no-capture`
Expected: PASS. **Report the actual `ran` count** — add a temporary `eprintln!("ran = {ran}/{SAMPLES}")` to read it, then remove it. If the rate is far from ~60%, that is a finding: report it rather than adjusting the floor to fit.

- [ ] **Step 3: Sabotage — prove the floor actually catches the regression it names**

Temporarily change `arb_tm_mixed_range_expr`'s weights from `4 => (0u64..8), 1 => (0u64..1000)` back to a single wide leaf `(0u64..1000)` — i.e. recreate the pre-fix 0.6% condition.

Expected: `the_unary_leg_of_the_random_test_actually_fires` FAILS with the message above. Record the count it reports. **Revert** and confirm green.

- [ ] **Step 4: Check the timing**

Run the native oracle suite and confirm the new test's duration. 200 TM simulations is not free; if it exceeds ~5s, report the number. Do not reduce `SAMPLES` below 100 without reporting the trade.

- [ ] **Step 5: Format and commit**

```bash
cargo fmt --all && cargo fmt --all --check
git add crates/redextape-native/tests/native_oracle.rs
git commit -m "test(native): make the 60.4% unary fire rate self-defending

That figure is the whole justification the random test's unary half is not
near-vacuous -- it was 0.6% before the mixed generator, asserting nothing
on ~70% of runs -- and until now nothing failed if a generator edit walked
it back; the doc comment would just become false. Sharing the generator
across crates put it under refactoring pressure for the first time.

Pins a deterministic FLOOR well below the measured value, not the value
itself: the point is catching a regression to near-zero, not breaking on
legitimate retuning. Sabotage-verified by restoring the old single-range
leaf, which reproduces the 0.6% condition and fails the floor."
```

---

## Task 9: Roadmap, and the full gate

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the two open items added by `0a381dd`)

- [ ] **Step 1: Close both follow-ups**

In the "What stays open" list, the two items added by commit `0a381dd` — the `EncodingKind`/six-lists link and the prose-only 60.4% figure — are now done. Convert them to **DONE (2026-07-29)** entries in the house voice (read neighbouring DONE entries first). Record:

- The true scope was **13 sites across 9 files in 3 shapes**, not the 6-across-5 originally filed. State that the original filing undercounted, since this roadmap's own entries are supposed to record what work taught.
- The registry is `macro_rules!`-generated: `EncodingKind`, `ALL`, `at`, `name`, `parse` from one row per encoding, complete by construction. A hand-written `ALL` was rejected because it cannot be made self-verifying in stable Rust — a developer can satisfy every exhaustive match and still leave the list short. `strum`/`enum-iterator` were rejected to keep `redextape-core`'s `[dependencies]` empty.
- **The cost, recorded not hidden:** the enum is macro-generated, so less greppable, weaker rustdoc.
- One site (`tm_exhaustive_bank_safety.rs`) could NOT be converted — it pairs each encoding with its own width list, and the right widths depend on how an encoding represents values. Made loud with a count assertion instead of made automatic.
- The generator dedup needed a NEW dev-only crate (`redextape-test-support`), because a feature-gated module in core would have required `proptest` as an optional regular dependency — spending the invariant the crate is organised around.
- Seed-identity was **verified by captured before/after diff**, not assumed.
- The sabotage results from Tasks 1-5 and 8: what failed with a third registry row, and what did not.
- The actual measured `ran` count from Task 8 Step 2.

- [ ] **Step 2: Run the full gate**

```bash
cargo fmt --all --check
scripts/check-all.sh
```
Both must pass. Use `--no-llvm` ONLY if no LLVM toolchain exists, and say so explicitly — a gate that skipped configs is not a gate that passed. Report wall-clock and per-config verdicts.

- [ ] **Step 3: Confirm the invariant one final time**

```bash
sed -n '/^\[dependencies\]/,/^\[/p' crates/redextape-core/Cargo.toml
```
Expected: empty section. This is the constraint most easily broken by accident across nine files of edits.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs(roadmap): close the encoding-registry and generator-dedup follow-ups

Records that the original filing undercounted: 13 sites across 9 files in
3 shapes, not 6 across 5. One site could not be converted at all and was
made loud instead."
```

---

## Self-Review Notes

**Spec coverage:** Registry → Task 1. The 13 sites → Tasks 2 (4 sites), 3 (6 sites), 4 (1 site, guarded not converted), 5 (1 site) = 12 converted + 1 guarded. `redextape-test-support` → Task 6. Generator dedup + seed identity → Task 7. The 60.4% floor (spec §D) → Task 8. Roadmap + gate → Task 9.

**Deliberately left to execution with a decision rule rather than a guess:** whether `three_way_oracle.rs:855`'s inline site rewrites cleanly (Task 3 Step 3 — a guarded hand-list is an acceptable documented fallback, silence is not); whether all four generators genuinely share the `(3, 8, 3)` shape (Task 7 Step 2 — verify, do not force); the actual `ran` count and the new test's cost (Task 8 Steps 2 and 4).

**Type consistency:** `EncodingKind::ALL` is `&'static [EncodingKind]`, so iteration yields `&EncodingKind` and every call site uses `|&k|` or `for &k in`. `at(self, width: usize) -> Box<dyn Encoding>`, `name(self) -> &'static str`, `parse(&str) -> Option<EncodingKind>` — all unchanged from the pre-registry signatures, so no consumer outside these tasks needs editing. `arb_expr_over(leaf: impl Strategy<Value = String> + 'static) -> impl Strategy<Value = String>` is consumed by Task 7 only.
