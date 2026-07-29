# Binary Oracle Leg & λ Encoding Collision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two roadmap items of the same defect class — record the λ encoding collision where a permitted reader will find it, and make `Binary` an actually-participating leg of the native oracle instead of a corrected doc comment.

**Architecture:** Item 1 is doc-only (two module docs). Item 2 adds one seam to `crates/redextape-native/tests/native_oracle.rs` — `encodings()` naming the encodings this file covers, and `tm_leg(core, kind)` returning a TM outcome plus the encoding to decode it with — then threads that seam through five sites, splitting the four-way suite into one `#[test]` per encoding with a runtime-derived coverage guard.

**Tech Stack:** Rust 2024, `cargo-nextest` (required, not optional), `proptest`, Cranelift (`--features cranelift`).

**Spec:** `docs/superpowers/specs/2026-07-29-binary-oracle-leg-and-encoding-collision-design.md`

---

## Global Constraints

> **CORRECTION (2026-07-29, mid-execution). A claim this plan repeats in three places is FALSE.**
> Wherever this plan says binary needs `run_tm_fitted` *because its DECODE needs the fitted width* —
> in Task 2's prescribed code, in Task 2's commit message, and in Task 6's draft module doc — **that
> is not true, and must not be transcribed into code.** Both decoders are structural, so a
> default-width (64) `Binary` decodes a fitted-at-16 tape correctly;
> `a_tape_decodes_the_same_at_every_reader_width` (`crates/redextape-core/src/tm.rs:316`) pins it.
> Caught by sabotage in Task 3: swapping the fitted encoding for `&Binary::default()` was expected to
> fail and **passed**. Corrected in code by commit `fbc970f`.
>
> What is actually true: the unary/binary asymmetry is **deliberate convention plus the additive-only
> constraint, NOT a correctness requirement**. Binary is fitted because the width is worth naming,
> because it keeps `at_width` on the executed path, and because core's `three_way_oracle.rs` does the
> same. Do not "fix" the unary arm into a fitted one believing decode demands it.
>
> Provenance, since it is the reusable lesson: core's `three_way_oracle.rs` records this as *"That was
> once REQUIRED"* and retracts it two sentences later. The plan author read the first half and
> propagated it as live justification, because it reads like a correctness constraint. **This is the
> same defect class the branch exists to close, committed by the plan itself.**

- **ADDITIVE ONLY.** Every assertion green today must run identically after this branch. No existing check is rewritten, re-widthed, or weakened. Binary is added *alongside*. In particular the unary leg stays at `Unary::default()` (= `MAX_FIELD_WIDTH` = 64) and is **never** moved to `run_tm_fitted`.
- **THE TDD CYCLE IS INVERTED HERE — read this before Task 2.** These tasks add *checks* over behaviour that already ships, so a new test is expected to **PASS on its first run**. There is no red phase. The red phase is replaced by a **sabotage step**: break the thing the check claims to cover, confirm *this* check is what fails, then revert. A new check that passes both before and after sabotage is vacuous and must be reported, not committed. If a new check FAILS on its first run, that is a real defect in shipped code — **stop and report it**, do not adjust the test to fit.
- **Never hard-code a list twice.** The coverage guard derives its expectation from `encodings()` at runtime. A guard that restates a hard-coded list checks nothing.
- **Commit after every task.** Do not squash tasks together.
- Branch: `binary-oracle-leg-and-collision-doc` (already created; spec already committed as `f827992`).
- Run tests with: `cargo nextest run -p redextape-native --features cranelift --test native_oracle`
- Full gate before merge: `scripts/check-all.sh` (or `--no-llvm` if no LLVM toolchain).
- Commit messages: no `Co-Authored-By` / `Generated with` attribution (user's global rule).

### Measured baselines (2026-07-29, do not re-derive)

| Fact | Value | Source |
|---|---|---|
| `native_oracle` suite total | 16.786s | `cargo nextest run … --test native_oracle` |
| `four_way_oracle_on_the_first_order_suite` | 16.784s (the entire wall-clock) | same |
| `Unary::default()` width | `MAX_FIELD_WIDTH` = 64 | `crates/redextape-core/src/tm/encoding/unary.rs:30` |
| `run_tm_fitted` search | starts `MIN_FIELD_WIDTH`, doubles to 64 | `crates/redextape-core/src/tm.rs:194` |
| All 4 `BEYOND_FIELD_WIDTH_DEMOS` under binary | run at width **16**, decode correctly (incl. the heap list `[100, 200, 300]`) | probe |
| `u64::MAX + 1` | reference `Nat(u64::MAX)`, native `Nat(u64::MAX)`, binary-TM `Overflow` @64, unary-TM `Overflow` | probe |
| 20-digit `u64::MAX` literal | parses with zero diagnostics | probe |

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `crates/redextape-core/src/lambda/encode.rs` | Church/Scott combinator definitions | Module doc gains the collision paragraph (Task 1) |
| `crates/redextape-core/src/lambda/syntax.rs` | The λ text form | Module doc gains a one-line cross-reference (Task 1) |
| `crates/redextape-native/tests/native_oracle.rs` | The native oracle suite | The seam + all five sites (Tasks 2–6) |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | Roadmap | Both items marked DONE (Task 7) |

---

## Task 1: Record the λ encoding collision

Doc-only. No code, no test, no behaviour change. Independent of every other task — can be done first or last.

**Files:**
- Modify: `crates/redextape-core/src/lambda/encode.rs` (module doc, after the existing normal-order paragraph ending `…why confluence does not excuse it.`)
- Modify: `crates/redextape-core/src/lambda/syntax.rs` (module doc, after the paragraph ending `…Everything the backend produces is closed.`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. No symbol changes.

- [ ] **Step 1: Add the collision paragraph to `encode.rs`**

Append to the module doc in `crates/redextape-core/src/lambda/encode.rs`, immediately after the line ending `…and why confluence does not excuse it.`:

```rust
//!
//! THE ENCODINGS COLLIDE, so a normal form CANNOT be decoded without a result type supplied from
//! outside. This is a property of the encodings, not a shortcoming of any particular decoder, and it
//! holds for an independent implementation exactly as it holds for ours:
//!
//!   * `tru()` (`\t.\f. t`) and `nil()` (`\n.\c. n`) are the SAME de Bruijn term, `Abs(Abs(Var 1))`.
//!   * `fls()` (`\t.\f. f`) and `church(0)` (`\f.\x. x`) are both `Abs(Abs(Var 0))`.
//!
//! The collision propagates through structure rather than staying at the leaves: a one-element Scott
//! list holding either one is a single term, so `[0]` and `[false]` are indistinguishable, and so is
//! every larger structure built over them. Nothing recoverable from a printed or reduced term says
//! which was meant. A reader handed only a normal form is therefore not merely inconvenienced — it
//! has strictly insufficient information, and must be told the result type by its caller.
```

Two rules for this paragraph, both deliberate:
- It must NOT cite `lambda/decode.rs` as further reading. That file is off-limits to a foreign reader by design (it describes the decode strategy such a reader must rederive independently), and pointing at it would reintroduce the exact gap this task closes.
- It must state the fact as *principled* ("strictly insufficient information"), not as a convenience. The whole point of the roadmap item is that a reader who thinks this is an implementation shortcut will try to work around it.

- [ ] **Step 2: Add the cross-reference to `syntax.rs`**

Append to the module doc in `crates/redextape-core/src/lambda/syntax.rs`, immediately after the line ending `…Everything the backend produces is closed.`:

```rust
//!
//! THIS TEXT FORM CARRIES NO RESULT TYPE, and one is required to interpret what it denotes: the value
//! encodings collide, so `\a.\b. b` is `false` and `church(0)` at once, and `\a.\b. a` is `true` and
//! `nil` at once. Parsing and printing are unaffected — the terms round-trip exactly — but a reader
//! that intends to DECODE a term to a value needs the type from its caller. See `encode.rs`'s module
//! doc for the full statement.
```

- [ ] **Step 3: Verify it compiles and the docs render**

Run: `cargo check -p redextape-core && cargo doc -p redextape-core --no-deps`
Expected: both succeed, no warnings introduced.

- [ ] **Step 4: Verify nothing else changed**

Run: `git diff --stat`
Expected: exactly two files, doc lines only, zero lines of Rust code changed.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/lambda/encode.rs crates/redextape-core/src/lambda/syntax.rs
git commit -m "docs(lambda): record that the value encodings collide

tru/nil are both Abs(Abs(Var 1)); fls/church(0) are both Abs(Abs(Var 0)),
and the collision propagates through structure -- [0] and [false] are one
term. So decoding needs a result type supplied from outside, in principle
rather than as a convenience.

The fact was recorded only in lambda/decode.rs, the one file a foreign
reader is correctly told not to open (it describes the decode strategy
such a reader must rederive). Stated now in encode.rs, where the
colliding combinators are defined, with a pointer from syntax.rs -- the
text form carries no result type, so that is where a reader hits it.

Closes lambda open item 2; last residue of foreign-reader finding 8."
```

---

## Task 2: The seam, the per-encoding split, and the coverage guard

This is the structural task. Sites 1 and 2 from the spec.

**Files:**
- Modify: `crates/redextape-native/tests/native_oracle.rs`

**Interfaces:**
- Produces, relied on by Tasks 3–5:
  - `fn encodings() -> Vec<(&'static str, EncodingKind)>`
  - `fn encoding_named(name: &str) -> EncodingKind`
  - `fn tm_leg(core: &Core, kind: EncodingKind) -> (TmRun, Box<dyn Encoding>)`
  - `fn assert_four_way(src: &str, kind: EncodingKind)` — note the **new second parameter**
  - `const EMITTED: &[&str]`

- [ ] **Step 1: Extend the imports**

In `crates/redextape-native/tests/native_oracle.rs`, replace the `redextape_core::tm` import block:

```rust
use redextape_core::tm::{
    AsmRun, Binary, DEFAULT_CAPS, Encoding, EncodingKind, LowerError, Program, TM_DEFAULT_CAPS, TmRun, Unary,
    decode_asm, decode_tape, defunc, lower_asm, run_asm, run_tm, run_tm_fitted,
};
```

- [ ] **Step 2: Add the seam helpers**

Insert immediately after the existing `fn lower_program(...)` definition:

```rust
/// Every encoding this file's TM leg covers. THE single place that decides — the coverage guard
/// (`every_encoding_has_a_four_way_test`) derives its expectation from here rather than from a second
/// hard-coded list, because a guard that restates the list it is checking checks nothing.
fn encodings() -> Vec<(&'static str, EncodingKind)> {
    vec![("unary", EncodingKind::Unary), ("binary", EncodingKind::Binary)]
}

/// The `EncodingKind` that `encodings()` gives this name. Panics on an unknown name, so a generated
/// test whose name drifts out of sync fails loudly instead of silently covering nothing.
fn encoding_named(name: &str) -> EncodingKind {
    encodings()
        .into_iter()
        .find(|(n, _)| *n == name)
        .unwrap_or_else(|| panic!("no encoding named `{name}` in `encodings()`"))
        .1
}

/// Run the TM leg for `kind`, returning the outcome AND the encoding its tape must be DECODED with.
///
/// The two encodings run differently, and the asymmetry is SEMANTIC rather than accidental. Unary runs
/// at the fixed `MAX_FIELD_WIDTH` (64) that `Unary::default()` gives — the width this file's TM leg has
/// always used, kept unchanged so that adding binary alters no assertion that was already green.
/// CORRECTION (2026-07-29): the next two lines are FALSE and were replaced in commit `fbc970f` — see
/// the CORRECTION block in Global Constraints above. Both decoders are structural; a 64-wide `Binary`
/// decodes a fitted-at-16 tape fine. Binary is fitted by CONVENTION, not for correctness.
/// Binary goes through `run_tm_fitted` because its DECODE needs the width the fit settled on: a binary
/// tape fitted at 16 cells and read back with a 64-wide `Binary` does not decode. Unary's decode has no
/// such dependency, so fitting it would buy nothing and would silently move every demo from width 64 to
/// width 8-16 — a lateral coverage change to checks that are already green.
///
/// This is the same split core's `three_way_oracle.rs` uses, so a third encoding faces the same choice
/// in both files instead of the two drifting apart.
fn tm_leg(core: &Core, kind: EncodingKind) -> (TmRun, Box<dyn Encoding>) {
    match kind {
        EncodingKind::Unary => (run_tm(core, &Unary::default(), TM_DEFAULT_CAPS), Box::new(Unary::default())),
        EncodingKind::Binary => {
            let (run, width) = run_tm_fitted(core, &Binary::default(), TM_DEFAULT_CAPS);
            let w = width.expect("Binary::field_width() is always Some");
            (run, EncodingKind::Binary.at(w))
        }
    }
}
```

- [ ] **Step 3: Thread the encoding through `assert_four_way`**

Replace the whole existing `fn assert_four_way(src: &str) { … }` with:

```rust
/// reference == λ == TM(`kind`) == native, guided by the reference value's type. All four must run to
/// a value that decodes equal.
///
/// Still genuinely FOUR-way after the per-encoding split, and that is not an accident of naming: each
/// emitted test runs ONE encoding, so its name states its real arity. It is the FILE that now covers
/// five backends, not any single test.
fn assert_four_way(src: &str, kind: EncodingKind) {
    let reference = run(src).unwrap_or_else(|e| panic!("reference run failed for `{src}`: {e:?}"));
    let core = core_of(src);
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    let (tm, tm_enc) = tm_leg(&core, kind);
    let native = run_native(&core, DEFAULT_CAPS);
    match (lambda, tm, native) {
        (LambdaRun::Reduced(nf), TmRun::Ran { tapes }, NativeRun::Ran(outcome)) => {
            assert_eq!(decode(&nf, &reference), Some(reference.clone()), "reference vs λ disagree for: {src}");
            assert_eq!(
                decode_tape(&tapes, &reference, &*tm_enc),
                Some(reference.clone()),
                "reference vs {}-TM disagree for: {src}",
                kind.name()
            );
            assert_eq!(
                decode_asm(&outcome, &reference),
                Some(reference.clone()),
                "reference vs native disagree for: {src}"
            );
        }
        (l, t, n) => panic!(
            "four-way oracle mismatch for {src} ({}):\n  reference={reference:?}\n  lambda={l:?}\n  tm={t:?}\n  native={n:?}",
            kind.name()
        ),
    }
}
```

- [ ] **Step 4: Replace the single suite test with the macro + guard**

Delete the existing:

```rust
#[test]
fn four_way_oracle_on_the_first_order_suite() {
    for src in FIRST_ORDER_DEMOS {
        assert_four_way(src);
    }
}
```

and put in its place:

```rust
/// Emits one `#[test]` per encoding — each running the WHOLE first-order suite under that encoding —
/// and records what it emitted into `EMITTED` so the coverage guard below can compare against
/// `encodings()` instead of a second hard-coded copy of it.
///
/// The axis is per-encoding rather than per-demo because the runner (cargo-nextest) schedules every
/// test from every binary in one parallel pool: two encoding tests run concurrently, so adding the
/// binary leg costs roughly nothing in wall-clock, whereas one test doing both legs would have made
/// this file's single long pole twice as long.
macro_rules! four_way_tests {
    ($( $test:ident => $enc:expr ),* $(,)?) => {
        $(
            #[test]
            fn $test() {
                let kind = encoding_named($enc);
                for src in FIRST_ORDER_DEMOS {
                    assert_four_way(src, kind);
                }
            }
        )*

        /// Every encoding name the macro above actually emitted a test for.
        const EMITTED: &[&str] = &[ $( $enc ),* ];
    };
}

four_way_tests! {
    four_way_oracle_on_the_first_order_suite_unary => "unary",
    four_way_oracle_on_the_first_order_suite_binary => "binary",
}

/// The hazard this guards: the macro invocation above hard-codes which encodings get a test, while
/// `encodings()` is the list everything else reads. Add a third encoding to `encodings()` and, without
/// this guard, that encoding is covered by NOTHING while every remaining test still passes — the file
/// gets faster and weaker at the same time. Deleting a generated test has the identical signature.
///
/// So: derive the expectation from `encodings()` AT RUNTIME and compare against `EMITTED`. Never
/// hard-code the expected answer a second time, or this guard just restates the thing it checks.
///
/// What this does NOT catch: whether any generated test's BODY is correct. It proves only that every
/// encoding is covered by SOME test; `assert_four_way` carries the actual assertions.
#[test]
fn every_encoding_has_a_four_way_test() {
    let mut expected: Vec<&str> = encodings().into_iter().map(|(name, _)| name).collect();
    let mut emitted: Vec<&str> = EMITTED.to_vec();
    expected.sort_unstable();
    emitted.sort_unstable();
    assert_eq!(
        emitted, expected,
        "the tests `four_way_tests!` emits do not match `encodings()`; an encoding was added or \
         removed, or a generated test was deleted, without updating the macro invocation"
    );
}
```

- [ ] **Step 5: Run — expect PASS, not FAIL**

Run: `cargo nextest run -p redextape-native --features cranelift --test native_oracle`
Expected: all tests PASS, now including `four_way_oracle_on_the_first_order_suite_unary`, `…_binary`, and `every_encoding_has_a_four_way_test`.

If `…_binary` FAILS: that is a **real defect in shipped code**, not a test to adjust. Stop and report the failing demo and both decoded values.

- [ ] **Step 6: Sabotage-check the binary leg (it must not be vacuous)**

Temporarily change `tm_leg`'s `EncodingKind::Binary` arm to decode with the wrong encoding:

```rust
        EncodingKind::Binary => {
            let (run, _width) = run_tm_fitted(core, &Binary::default(), TM_DEFAULT_CAPS);
            (run, Box::new(Unary::default()))   // SABOTAGE: wrong decoder
        }
```

Run the suite. Expected: `four_way_oracle_on_the_first_order_suite_binary` FAILS; `…_unary` still PASSES. Then **revert the sabotage** and confirm green.

- [ ] **Step 7: Sabotage-check the coverage guard**

Temporarily delete the `four_way_oracle_on_the_first_order_suite_binary => "binary",` line from the `four_way_tests!` invocation.

Run the suite. Expected: `every_encoding_has_a_four_way_test` FAILS with the "do not match `encodings()`" message. Then **revert** and confirm green.

- [ ] **Step 8: Record the wall-clock**

Run: `cargo nextest run -p redextape-native --features cranelift --test native_oracle`
Note the summary total and the two per-encoding test times. Baseline was **16.786s total / 16.784s in one test**. The spec projects roughly flat (~17–19s). If it materially exceeds that, record the number and report it rather than absorbing it.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-native/tests/native_oracle.rs
git commit -m "test(native): make Binary a participating leg of the four-way oracle

The native oracle pinned Unary::default() at every TM site. When Binary
landed, this file's doc claims were corrected but the suite was not
reparameterized -- so the corrected claim lived only in prose while the
executable check tested what it always tested.

Adds one seam: encodings() names what this file covers, tm_leg(core,kind)
returns an outcome plus the encoding to decode it with. The four-way
suite splits into one #[test] per encoding, with a guard deriving its
expectation from encodings() at runtime so a third encoding cannot be
added and silently covered by nothing.

Additive only: the unary leg still runs at the fixed width 64 it always
ran at. Binary uses run_tm_fitted by convention, not because decode needs it;
unary's does not. Same split core's three_way_oracle.rs uses.

Each emitted test is still genuinely four-way -- one encoding each. It is
the file that now covers five backends, not any single test."
```

---

## Task 3: The ceiling test's binary half

Site 3. Turns the Task-17 doc correction into a measured result.

**Files:**
- Modify: `crates/redextape-native/tests/native_oracle.rs`

**Interfaces:**
- Consumes: `tm_leg`, `core_of` (Task 2).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Leave `the_tm_reports_its_ceiling_on_the_same_demos` COMPLETELY UNCHANGED**

Do not touch it. It is the **control**: it asserts unary reports `Overflow` on `BEYOND_FIELD_WIDTH_DEMOS`. Without it, the new test below would pass just as well if the ceiling had been raised for *both* encodings — a different claim entirely. Read its existing doc comment; do not edit it.

- [ ] **Step 2: Add the binary half immediately after it**

```rust
/// The OTHER half of the Task-17 correction, as a measured result rather than a doc comment. Every
/// value in `BEYOND_FIELD_WIDTH_DEMOS` is « 2⁶⁴, so `Binary` represents all of them: it runs all four
/// and agrees with the reference (and so, transitively, with native — `native_runs_beyond_field_width`
/// above pins native against the same reference values).
///
/// Measured 2026-07-29: all four fit at width 16, including the heap list `[100, 200, 300]`.
///
/// Together with `the_tm_reports_its_ceiling_on_the_same_demos` (which MUST be kept — it is the
/// control), this establishes as two measured results what the module doc previously only asserted in
/// prose: the gap this file exhibits is "native vs. UNARY", not "native vs. the TM backend".
#[test]
fn binary_runs_the_demos_unary_cannot_represent() {
    for src in BEYOND_FIELD_WIDTH_DEMOS {
        let reference = run(src).unwrap_or_else(|e| panic!("reference run failed for `{src}`: {e:?}"));
        let core = core_of(src);
        let (tm, enc) = tm_leg(&core, EncodingKind::Binary);
        match tm {
            TmRun::Ran { tapes } => assert_eq!(
                decode_tape(&tapes, &reference, &*enc),
                Some(reference.clone()),
                "binary-TM vs reference disagree for: {src}"
            ),
            other => panic!("binary must RUN what unary cannot represent, got {other:?} for: {src}"),
        }
    }
}
```

- [ ] **Step 3: Run — expect PASS**

Run: `cargo nextest run -p redextape-native --features cranelift --test native_oracle binary_runs_the_demos`
Expected: PASS.

- [ ] **Step 4: Sabotage-check**

Temporarily change `EncodingKind::Binary` to `EncodingKind::Unary` in the new test's `tm_leg` call.
Expected: the test FAILS with `binary must RUN what unary cannot represent, got Overflow`. Then **revert** and confirm green.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-native/tests/native_oracle.rs
git commit -m "test(native): measure the binary half of the field-width contrast

the_tm_reports_its_ceiling_on_the_same_demos pins unary Overflow on the
beyond-width demos; that binary RUNS the same demos was only a doc
comment. Now it is a test: all four run under binary (measured: width 16,
including the heap list) and agree with the reference.

The unary control is kept untouched and is load-bearing -- without it
this test would pass equally well if the ceiling had been raised for both
encodings, which is a different claim."
```

---

## Task 4: Pin the ≥2⁶⁴ divergence

Site 5. The module doc's "honest remaining gap", pinned as the disagreement it actually is.

**Files:**
- Modify: `crates/redextape-native/tests/native_oracle.rs`

**Interfaces:**
- Consumes: `tm_leg`, `encodings`, `core_of` (Task 2).
- Produces: `const SATURATION_DEMOS: &[&str]`.

- [ ] **Step 1: Add the `Value` import**

Change the existing `use redextape_core::{RunError, run};` to:

```rust
use redextape_core::value::Value;
use redextape_core::{RunError, run};
```

- [ ] **Step 2: Add the demo set, next to `BEYOND_FIELD_WIDTH_DEMOS`**

```rust
/// Values at or past 2⁶⁴ — the gap the module doc calls "the honest remaining gap", which until now
/// nothing exercised.
///
/// IT CANNOT BE AN AGREEMENT TEST, and this must not be "fixed" into one. The backends diverge here BY
/// DESIGN: the reference and native SATURATE (`tm/asm.rs`'s `saturating_add`/`saturating_mul`), while
/// the TM halts in its rule-less overflow guard (`tm/lower_tm.rs`'s `Builder::overflow`) and never
/// saturates at any width up to the 64-cell ceiling. Both behaviours are deliberate; they are simply
/// different, and nothing recorded that in an executable form before this test.
///
/// Measured 2026-07-29: each of these gives reference `Nat(u64::MAX)`, native `Nat(u64::MAX)`, binary
/// TM `Overflow` (having widened to 64), unary TM `Overflow`. The 20-digit literal parses with zero
/// diagnostics, so these need no special construction.
const SATURATION_DEMOS: &[&str] = &[
    "18446744073709551615 + 1",
    "let n = 18446744073709551615; n + 1",
    "4294967295 * 4294967295 * 4294967295",
];
```

- [ ] **Step 3: Add the test**

```rust
/// Native's ceiling-free claim at the ONE place it is genuinely load-bearing, and the TM's refusal
/// beside it. See `SATURATION_DEMOS` for why agreement is impossible here by construction.
///
/// The TM half loops over `encodings()` rather than naming `Binary`: this is a claim about the TM
/// BACKEND, not about one encoding, so a third encoding must satisfy it too the day it is added.
#[test]
fn past_the_u64_ceiling_the_backends_diverge_by_design() {
    for src in SATURATION_DEMOS {
        let reference = run(src).unwrap_or_else(|e| panic!("reference run failed for `{src}`: {e:?}"));
        assert_eq!(reference, Value::Nat(u64::MAX), "these demos exist in order to saturate: {src}");
        let core = core_of(src);
        match run_native(&core, DEFAULT_CAPS) {
            NativeRun::Ran(outcome) => assert_eq!(
                decode_asm(&outcome, &reference),
                Some(reference.clone()),
                "native must saturate exactly as the reference does: {src}"
            ),
            other => panic!("native must run `{src}`, got {other:?}"),
        }
        for (name, kind) in encodings() {
            let (tm, _) = tm_leg(&core, kind);
            assert!(
                matches!(tm, TmRun::Overflow),
                "the {name} TM must REFUSE this, not saturate and not miscompile: {src} gave {tm:?}"
            );
        }
    }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cargo nextest run -p redextape-native --features cranelift --test native_oracle past_the_u64_ceiling`
Expected: PASS.

- [ ] **Step 5: Sabotage-check both halves**

First half — change the native assertion's expected value to `Value::Nat(0)`. Expected: FAILS. Revert.

Second half — change `matches!(tm, TmRun::Overflow)` to `matches!(tm, TmRun::Overflow | TmRun::Ran { .. })`. Expected: still passes (this proves nothing on its own, which is the point) — so instead assert the *stronger* direction holds by changing it to `matches!(tm, TmRun::Ran { .. })` and confirming it FAILS for both encodings. Revert to `TmRun::Overflow`.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-native/tests/native_oracle.rs
git commit -m "test(native): pin the >=2^64 divergence instead of leaving it unexercised

The module doc called values >= 2^64 the honest remaining gap and noted
nothing exercised it. It cannot be closed by an agreement test: the
reference and native saturate to u64::MAX (asm.rs's saturating_add /
saturating_mul) while the TM halts in its rule-less overflow guard
(lower_tm.rs) and never saturates.

So it is pinned as the disagreement it is -- reference == native ==
u64::MAX, every encoding's TM == Overflow -- with the reason recorded so
a later reader does not 'fix' the test by making the TM saturate.

The TM half loops over encodings() rather than naming Binary: the claim
is about the TM backend, so a third encoding must satisfy it too."
```

---

## Task 5: TM legs in the wide-range proptest

Site 4. The asymmetric one — read the doc comment carefully, it is the deliverable as much as the code.

**Files:**
- Modify: `crates/redextape-native/tests/native_oracle.rs`

**Interfaces:**
- Consumes: `tm_leg`, `arb_native_safe_expr` (existing).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Leave the existing proptest UNCHANGED**

Do not modify `native_agrees_with_reference_and_asm_on_random_programs`. The TM legs go in a **separate** `proptest!` block so nextest schedules them concurrently — the same reason Task 2 split per encoding rather than doing both legs in one test.

- [ ] **Step 2: Add a second `proptest!` block after the existing one**

```rust
proptest! {
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    /// The TM legs over the same wide-range generator — and they are ASYMMETRIC BY NECESSITY, which is
    /// the whole reason this test has its own doc comment.
    ///
    /// The generator draws leaves from `0..1000`. A 64-cell UNARY field cannot represent those, which
    /// is exactly why this file's proptest had no TM leg at all until now. So:
    ///
    ///   * BINARY is a FULL leg: it must run, and decode equal to the reference.
    ///   * UNARY is asserted NEVER WRONG, which is strictly weaker: `Ran` must decode equal to the
    ///     reference; `Overflow` is permitted and expected for most cases.
    ///
    /// DO NOT READ THE NAME AS SYMMETRIC. The unary half does not claim unary computes these programs.
    /// It claims unary never SILENTLY computes them wrongly — a `Ran` that decodes to the wrong value
    /// is caught, a refusal is not a failure. That is weaker than the binary leg and stronger than the
    /// nothing that was here before, and it is stated rather than left for a reader to infer from the
    /// code.
    #[test]
    fn the_tm_legs_agree_with_the_reference_on_random_programs(src in arb_native_safe_expr()) {
        let reference = run(&src);
        prop_assume!(reference.is_ok());
        let rv = reference.unwrap();
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty());
        let core = desugar(&prog.unwrap());

        let (btm, benc) = tm_leg(&core, EncodingKind::Binary);
        match btm {
            TmRun::Ran { tapes } => prop_assert_eq!(
                decode_tape(&tapes, &rv, &*benc),
                Some(rv.clone()),
                "binary-TM vs reference disagree: {}",
                src
            ),
            other => prop_assert!(false, "binary must run {}: {:?}", src, other),
        }

        // The weaker half. A refusal is fine; a WRONG ANSWER is not.
        let (utm, uenc) = tm_leg(&core, EncodingKind::Unary);
        if let TmRun::Ran { tapes } = utm {
            prop_assert_eq!(
                decode_tape(&tapes, &rv, &*uenc),
                Some(rv.clone()),
                "unary-TM RAN and produced the WRONG answer: {}",
                src
            );
        }
    }
}
```

- [ ] **Step 3: Run — expect PASS, and record the cost**

Run: `cargo nextest run -p redextape-native --features cranelift --test native_oracle the_tm_legs_agree`
Expected: PASS. **Note the time.** The existing native-only proptest is 0.095s; this one simulates two TMs per case over 64 cases, so it will be materially slower. If it exceeds roughly 20s (i.e. becomes this file's new long pole), report the number — reducing `cases` is a legitimate response but must be recorded as a deliberate coverage reduction with the number that motivated it, not done silently.

- [ ] **Step 4: Confirm the unary half is not vacuous**

The unary half only asserts anything when unary actually `Ran`. Confirm that happens at least sometimes: temporarily add `if matches!(utm, TmRun::Ran{..}) { eprintln!("UNARY RAN: {src}"); }` before the `if let`, run with `--no-capture`, and confirm at least one line prints.

Expected: at least one `UNARY RAN` line (small values — comparisons yield 0/1, saturating subtraction yields small results). If ZERO print, the unary half is vacuous over this generator: **report that**, and record it in the test's doc comment rather than leaving a check that can never fire. Remove the temporary `eprintln!` afterwards.

- [ ] **Step 5: Sabotage-check the binary leg**

Temporarily replace `&*benc` with `&Unary::default()` in the binary assertion.
Expected: FAILS. Revert and confirm green.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-native/tests/native_oracle.rs
git commit -m "test(native): add TM legs to the wide-range proptest

The generator draws leaves from 0..1000, which a 64-cell unary field
cannot represent -- which is why this file's proptest had no TM leg at
all. Binary can, so binary gets a full leg.

Unary gets the weaker claim its representation permits: never wrong. Ran
must decode equal to the reference; Overflow is permitted. That is a
disjunction, not agreement, and the doc comment says so -- a test whose
name implies more than it checks is the defect this branch exists to
close.

Its own proptest! block rather than folded into the existing one, so
nextest schedules it concurrently."
```

---

## Task 6: Module-doc coherence pass

The module doc still describes a file that pins `Unary`. Now that all five sites exist, make the prose match.

**Files:**
- Modify: `crates/redextape-native/tests/native_oracle.rs` (module doc only, lines 1–31)

**Interfaces:** none.

- [ ] **Step 1: Re-read the module doc against the file as it now stands**

Run: `sed -n '1,35p' crates/redextape-native/tests/native_oracle.rs`

Check each claim against reality. Specifically, these three are now stale or incomplete:
1. "the decoded TM final tape" (singular) — there are now two TM legs.
2. "The true remaining gap — values `>= 2^64` … is not exercised here (nothing in this suite goes there)" — **`SATURATION_DEMOS` now goes there.** This sentence is now false and must be corrected.
3. The CORRECTION (Task 17) paragraph says the narrower claim is what "this file can actually make" — that is now understated; the file *measures* both halves.

- [ ] **Step 1b: Sweep the FUNCTION-LEVEL doc comments too, not just the module doc**

ADDED MID-BRANCH after Task 4's review found this scope gap: the original Task 6 scoped only the module doc, but the same now-false claim is repeated on an individual test.

`native_runs_beyond_field_width`'s doc comment (around `crates/redextape-native/tests/native_oracle.rs:448-450`) says: *"…and the module doc for the honest gap that remains — values `>= 2^64`, which nothing in this file exercises on the TM side either way."* **That is false as of commit `d4a8a13`** — `past_the_u64_ceiling_the_backends_diverge_by_design` exercises exactly that, on the TM side, in this file.

Correct it, and then run:

```
grep -n "2\^64\|2⁶⁴\|not exercised\|nothing in this" crates/redextape-native/tests/native_oracle.rs
```

Every hit must be a claim that is true after Tasks 3, 4 and 5. Report each hit and your verdict on it. The file has an established convention for this situation — see the `CORRECTION (Task 17, tm-binary-encoding)` block near the top, which annotates a doc claim that a later branch invalidated rather than silently deleting it. Follow that convention.

- [ ] **Step 2: Rewrite the stale claims**

Replace the module doc's first three paragraphs and the CORRECTION paragraph with the following. Keep the existing `Native's PRIMARY new cross-check` paragraph and the `CAPS NOTE` paragraph unchanged — both are still accurate.

```rust
//! The native oracle: for every first-order demo, the reference tree-walker's value, the decoded λ
//! normal form, the decoded TM final tape UNDER EVERY ENCODING, and the decoded native (Cranelift JIT)
//! result all agree. This extends `redextape-core`'s three-way oracle (`tests/three_way_oracle.rs`)
//! with native as a validated leg.
//!
//! ONE TEST PER ENCODING, not one test doing every encoding: `four_way_tests!` emits
//! `four_way_oracle_on_the_first_order_suite_{unary,binary}`, so each emitted test is still genuinely
//! FOUR-way (reference == λ == TM(one encoding) == native) and its name states its real arity. It is
//! this FILE that covers five backends, not any single test. `every_encoding_has_a_four_way_test`
//! derives its expectation from `encodings()` at runtime, so a third encoding cannot be added and left
//! silently covered by nothing.
//!
//! THE UNARY LEG DELIBERATELY RUNS AT THE FIXED `MAX_FIELD_WIDTH` (64) it has always run at, while
//! binary goes through `run_tm_fitted`. NOTE: the rest of this drafted paragraph was FALSE and must
//! NOT be transcribed — see the CORRECTION in Global Constraints. The asymmetry is CONVENTION plus
//! additive-only, not correctness. Superseded draft text follows:
//! binary goes through `run_tm_fitted`. The asymmetry is semantic: binary's DECODE needs the width the
//! fit settled on (`Binary::at(w)`), and unary's does not. Moving unary to fitted was considered and
//! rejected — it would silently move every demo from width 64 to width 8-16, which is a LATERAL
//! coverage change (fitted exercises narrow banks and the overflow boundary; fixed-64 exercises wide
//! banks) to checks that were already green. The width axis is owned by `tm_width_equivalence.rs` and
//! `tm_bank_invariant.rs`, which run `widths() x encodings_at(width)`; this file's job is native
//! agreement. Same split as core's `three_way_oracle.rs`.
//!
//! NATIVE'S DISTINCTIVE CAPABILITY, stated at the width it actually holds. Native compiles to real
//! 64-bit machine registers and has no `MAX_FIELD_WIDTH` ceiling. That is a contrast with UNARY, not
//! with the TM backend: a `w`-cell binary field holds `0..2^w`, so at 64 cells `Binary` covers the
//! entire `u64` range. Both halves are now MEASURED rather than asserted in prose —
//! `the_tm_reports_its_ceiling_on_the_same_demos` pins unary reporting `Overflow` on
//! `BEYOND_FIELD_WIDTH_DEMOS` (the control), and `binary_runs_the_demos_unary_cannot_represent` pins
//! binary running the same four and agreeing with the reference (measured: all four fit at width 16).
//!
//! PAST 2^64 THE BACKENDS DIVERGE BY DESIGN, and that is pinned rather than left unexercised — see
//! `past_the_u64_ceiling_the_backends_diverge_by_design` and `SATURATION_DEMOS`. It cannot be an
//! agreement test: the reference and native SATURATE to `u64::MAX` (`tm/asm.rs`'s
//! `saturating_add`/`saturating_mul`), while the TM halts in its rule-less overflow guard
//! (`tm/lower_tm.rs`'s `Builder::overflow`) at every width up to the ceiling. Both are deliberate.
```

Adjust the wording if an earlier task's measurement contradicts anything above — the numbers here (width 16, the saturation behaviour) come from probes recorded in this plan's Global Constraints, so they should hold; if one does not, that is a finding to report.

- [ ] **Step 3: Verify no claim in the doc is now unbacked**

For each remaining assertion in the module doc, name the test that establishes it. Any claim with no test behind it must either get a test or be reworded to what is actually established. Record any you reword.

- [ ] **Step 4: Run the full file**

Run: `cargo nextest run -p redextape-native --features cranelift --test native_oracle`
Expected: all PASS. Record the final total wall-clock against the 16.786s baseline.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-native/tests/native_oracle.rs
git commit -m "docs(native): make the oracle module doc match the suite

Three claims went stale as the binary leg landed: the TM leg is no longer
singular; 'values >= 2^64 are not exercised here' is now false
(SATURATION_DEMOS goes there); and the Task-17 correction is now measured
by two tests rather than asserted in prose.

Also records why the unary leg deliberately stays at fixed width 64."
```

---

## Task 7: Close both roadmap items

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

**Interfaces:** none.

- [ ] **Step 1: Close λ open item 2**

At `docs/superpowers/plans/2026-07-19-redextape-roadmap.md:431`, the item begins `2. **No reader-facing file records that the encodings collide.**`. Rewrite it in the style of its DONE siblings (items 1 and 3 immediately around it — read them first for the house voice): mark `**DONE (2026-07-29).**`, state what shipped (the paragraph in `encode.rs`, the cross-reference in `syntax.rs`), and record the one non-obvious decision — that the paragraph deliberately does **not** cite `decode.rs`, because pointing a foreign reader at the file they are told not to open would reintroduce the gap.

- [ ] **Step 2: Close the binary-oracle-leg item**

At `docs/superpowers/plans/2026-07-19-redextape-roadmap.md:910-911`, the text `and \`Binary\` as a fourth PARTICIPATING leg in the native oracle (its doc claims were corrected; the suite itself was not reparameterized to actually run both encodings)` sits inside a "What stays open" sentence. Move it out of that sentence into its own **DONE (2026-07-29)** entry, leaving arbitrary-precision fields as the only thing still open there.

The entry must record what the work actually taught, not just that it happened:
- The five sites, and the additive-only constraint (unary stays at fixed 64 — and *why* fitting it was considered and rejected: a lateral coverage change to already-green checks, on a branch whose subject is checks that under-deliver).
- That the ≥2⁶⁴ gap turned out to be **unclosable as an agreement test** — reference/native saturate, the TM refuses — so it is pinned as a divergence. This is a finding the original roadmap item did not anticipate.
- The measured numbers: baseline 16.786s (one test was the entire wall-clock), the post-split total, and that all four beyond-width demos fit binary at width 16.
- Whatever Task 5 Step 4 found about the unary half's vacuity, and Task 6 Step 3 found about unbacked doc claims.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "docs(roadmap): close the encoding-collision and binary-oracle-leg items

Records the finding the binary-leg item did not anticipate: the >=2^64
gap cannot be closed by an agreement test, because the reference and
native saturate while the TM refuses. It is pinned as a divergence
instead."
```

---

## Task 8: Full gate and merge readiness

**Files:** none modified (verification only, unless the gate finds something).

- [ ] **Step 1: Run the full feature matrix**

Run: `scripts/check-all.sh` (add `--no-llvm` only if no LLVM toolchain is installed — and say so in the report if you do).
Expected: every config green.

- [ ] **Step 2: Confirm the additive-only constraint held**

Run: `git diff main --stat` and `git diff main -- crates/redextape-native/tests/native_oracle.rs`

Walk the diff and confirm, explicitly, that **no assertion that was green before this branch now runs differently**. The one legitimate exception is `four_way_oracle_on_the_first_order_suite`, which was renamed to `…_unary` — same assertions, same fixed-64 run, same demos, new name. Anything else is a constraint violation: report it.

- [ ] **Step 3: Report the numbers**

State: the baseline (16.786s), the final `native_oracle` total, the per-test breakdown, and the full `check-all.sh` wall-clock. If the file's long pole moved from `four_way_oracle_…` to the new proptest, say so.

- [ ] **Step 4: Summarize findings for review**

List every place where reality differed from this plan's expectations — a test that failed on first run, a sabotage that did not produce the predicted failure, a vacuous check, a doc claim with no test behind it. **A task that found nothing should say so explicitly**; silence is not evidence of a clean run.

---

## Self-Review Notes

**Spec coverage:** Item 1 → Task 1. Seam + sites 1–2 → Task 2. Site 3 → Task 3. Site 5 → Task 4. Site 4 → Task 5. Spec's "module doc must state the reasons" → Task 6. Roadmap closure → Task 7. Spec's Verification section (full gate, sabotage checks, wall-clock delta) → distributed into each task's sabotage step plus Task 8.

**Deliberately deferred to execution, with a decision rule rather than a guess:** the proptest's TM-leg cost (Task 5 Step 3 — measure, and if it becomes the long pole, report the number before reducing `cases`), and whether the unary half of that proptest is vacuous (Task 5 Step 4 — measure, and if it never fires, say so in the doc comment rather than leaving a dead check).

**Type consistency:** `assert_four_way` gains a second parameter in Task 2 and is called with it in Tasks 2 only. `tm_leg` returns `(TmRun, Box<dyn Encoding>)` and every consumer derefs with `&*`. `encodings()` returns `Vec<(&'static str, EncodingKind)>` and is consumed by name in Task 2's guard and by `(name, kind)` destructuring in Task 4. `EncodingKind::name()` and `EncodingKind::at()` are existing public methods (`tm/header.rs:58,67`).
