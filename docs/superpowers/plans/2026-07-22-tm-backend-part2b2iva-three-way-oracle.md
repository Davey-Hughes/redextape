# TM Backend — Part 2b-2-iv-a: The Three-Way Oracle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Tasks are composition/wiring/testing with complete code — no blind δ-authoring here (Task 1's δ change is a one-rule self-loop). Task 1 is a semantic change to merged code; Tasks 2–3 are new test files.

**Goal:** Deliver the headline of Plan 3 — the **three-way oracle** `reference == λ == TM` (spec §12.1) over the whole first-order demo suite, plus a TM-bounded property test that all three backends agree on random programs (§12.2). To make faults agree three ways, first resolve the deferred decision: a runtime fault on the TM now **spins to a cap (`HitCap`)** — matching λ's Ω-divergence and the reference's `Runtime` error — instead of defensively halting.

**Architecture:** A new `tests/three_way_oracle.rs` runs each demo through all three backends and asserts they reach the *same* place: a value that decodes equal (guided by the reference value's type), or — for a runtime fault — the shared "no value" outcome (reference `Runtime`, λ `HitCap`, TM `HitCap`). Higher-order `map`/`fold` demos stay λ-only (the TM is first-order — Plan 3b — so `run_tm` returns `LowerError`; the oracle asserts `reference == λ` *and* that the TM correctly refuses). A TM-safe proptest generator keeps every value (and every intermediate) under `FIELD_WIDTH`, so the TM's fixed-width unary fields never overflow.

**Tech Stack:** Rust; the merged `redextape_core::{run, RunError}`, `lambda::{run_lambda, decode, LambdaRun, MAX_REDUCTION_STEPS}`, and `tm::{run_tm, decode_tape, TmRun, TmCaps, TM_DEFAULT_CAPS, Unary}`; `proptest` (the sole dev-dep).

## Global Constraints

Copied from the design spec (`docs/superpowers/specs/2026-07-22-tm-backend-design.md` §12) and the `tm-backend-plan3` memory. Every task's requirements implicitly include this section.

- **The three-way oracle compares by the reference value's SHAPE, never its contents** — `decode`/`decode_tape` take the reference `Value` as a type witness only, so a backend that computed the wrong thing decodes to a different `Value` (or `None`) and fails the oracle. Same discipline as the existing two-way oracles.
- **Three outcomes are equated as "the same":** (1) all three produce a value that decodes equal; (2) all three fail to produce a value — reference `Err(RunError::Runtime)`, λ `LambdaRun::HitCap`, TM `TmRun::HitCap`. Any other combination is a mismatch (panic). This mirrors the existing `lambda_oracle.rs`/`asm_oracle.rs` fault arms.
- **The TM is FIRST-ORDER (Plan 3b defers higher-order).** A function-as-a-value program (`map`/`fold` taking a function argument) makes `run_tm` return `TmRun::LowerError`. Such demos are asserted λ-only: `reference == λ` **and** `run_tm` is `LowerError`. Do NOT try to run them on the TM.
- **`FIELD_WIDTH = 64` STRICT is the TM's representability bound.** Every value AND every intermediate in a TM-run program must be `< 64` (a value reaching 64 silently corrupts via `rewind_home` miscount — it is NOT a panic). The curated demos all stay `< 64`; the proptest generator must guarantee this **by construction** (bounded leaves + a node budget + only value-non-growing ops — no unbounded `*`, no value-reusing `let`).
- **λ still covers higher-order** — the higher-order `map`/`fold` demo stays in the suite as a λ-only (two-way) check; it is not dropped just because the TM can't run it.
- **The DUAL asymmetry is recorded too.** Two Plan-2 latent-trap programs (an immutable `let` shadowing a mutable variable; a `fn` inside a mutation region) are REJECTED by the λ backend in v1 (`LambdaRun::LowerError`, commit `54aad42` — λ refuses rather than silently miscompile), while the reference and the first-order TM run them fine. They are NOT three-way (λ produces no value), so they live in `LAMBDA_LIMITATION_DEMOS` asserted `reference == TM` + λ `LowerError` — the exact mirror of the higher-order case (there the TM refuses; here λ refuses). Do NOT put them in `FIRST_ORDER_DEMOS`.
- **Panic-free & total** — no new `unwrap`/`panic` on program-derived data beyond the deliberate oracle-mismatch `panic!` (a test failure). The existing `MAX_SLOTS`/`MAX_FRAME_LOC`/`FIELD_WIDTH` guards stay intact and untouched.
- **No attribution in commits** (repo rule): plain, single-line commit messages; never append `Co-Authored-By`/`Generated with`.

---

## File Structure

- **Modify** `crates/redextape-core/src/tm/encoding.rs` — in `head_op`/`tail_op`, make the `{base}.fault` state SPIN (add a self-loop rule) instead of being rule-less; update the two trait-method docs + the impl comments.
- **Modify** `crates/redextape-core/src/tm/lower_tm.rs` — repurpose the `head_tail_faults_are_total_defensive_halts` test to assert `HitCap` (rename `head_tail_faults_spin_to_a_cap`); update the module doc line about `nil`/dangling.
- **Create** `crates/redextape-core/tests/three_way_oracle.rs` — the unified `reference == λ == TM` harness, the consolidated first-order demo suite, the fault demos, the higher-order λ-only demos (Task 2), and the TM-safe proptest (Task 3).
- **NO change** to `decode.rs`, `build.rs`, `tm.rs`, the existing `tm_oracle.rs`/`lambda_oracle.rs`/`asm_oracle.rs` (they stay as localizing oracles). If you find yourself editing them, stop.

---

## Design reference (read before Task 1)

**Why the TM must spin on a fault.** The reference faults `head(nil)` → `RunError::Runtime` (`interp.rs:211`). The λ backend encodes `head`/`tail`'s nil-branch as `diverge()` = Ω = `(λx.x x)(λx.x x)` (`encode.rs:89-111`), so `head(nil)` reduces forever → `run_lambda` returns `HitCap` under any cap. After Part 2b-2-iii-b the TM *defensively halted* on a fault (a rule-less non-accept state → sim `Halted` → `run_tm` `Ran`), which is an oracle MISMATCH against the other two. Making the fault state **spin** (a self-loop rule → the sim never halts → `HitCap`, since `sim::run` has no fixed-point detector, only a step cap — `sim.rs:127-153`) makes all three "no value" outcomes identical, so the oracle can treat them as the same.

**Consolidating the demo suite.** The first-order demos currently live across `tm_oracle.rs` (control-flow, calls, list-build, list-access) and `asm_oracle.rs`/`lambda_oracle.rs`. Task 2 collects the full first-order set into ONE `FIRST_ORDER_DEMOS` in the new file (self-contained; the existing per-category oracles stay for localization). Every first-order demo runs to a value `< FIELD_WIDTH` on all three backends.

---

## Task 1: TM runtime faults spin to a cap

Resolve the deferred `head(nil)`/`tail(nil)` decision: the deref fault state spins (→ `HitCap`) instead of defensively halting (→ `Ran`), so a fault is the same "no value" outcome as λ (Ω) and the reference (`Runtime`).

**Files:**
- Modify: `crates/redextape-core/src/tm/encoding.rs` (`head_op`/`tail_op` fault state + docs)
- Modify: `crates/redextape-core/src/tm/lower_tm.rs` (repurpose one test + a doc line)

- [ ] **Step 1: Update the failing test (repurpose the totality test)**

In `lower_tm.rs`, replace the `head_tail_faults_are_total_defensive_halts` test with the `HitCap` version. Add `Caps` to the test imports (the module already imports `DEFAULT_CAPS as CAPS`, `Status`, `simulate` from `crate::tm::sim`; add `Caps`):

```rust
    #[test]
    fn head_tail_faults_spin_to_a_cap() {
        // head(nil), tail(nil), and a dangling pointer have no runtime value: the reference faults
        // (RunError::Runtime), λ's nil-branch is Ω (no normal form). The TM matches by DIVERGING — the
        // deref's fault state spins, so under any cap the machine hits it (HitCap), never Ran. This is
        // what lets the three-way oracle (Part 2b-2-iv-a) treat all three "no value" outcomes alike.
        // A small cap keeps the test fast (the spin has no fixed point; sim runs it to the step cap).
        fn hits_cap(prog: &Program) -> bool {
            let m = lower_tm(prog, &Unary);
            assert!(m.validate().is_empty(), "{:?}", m.validate());
            let sm = SlotMap::of(prog);
            let mut init = vec![Vec::new(); TAPES];
            init[REG] = Unary.init_reg(sm.n_slots());
            matches!(simulate(&m, &init, Caps { steps: 10_000, cells: 10_000 }).1, Status::HitCap)
        }
        // head(nil) / tail(nil): pointer 0.
        assert!(hits_cap(&Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        }));
        assert!(hits_cap(&Program {
            code: vec![Instr::Nil(Reg::Loc(0)), Instr::Tail(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        }));
        // Dangling: pointer 5 into an empty heap.
        assert!(hits_cap(&Program {
            code: vec![Instr::Li(Reg::Loc(0), 5), Instr::Head(Reg::Rr, Reg::Loc(0)), Instr::Halt],
            labels: vec![],
        }));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::lower_tm::tests::head_tail_faults_spin_to_a_cap`
Expected: FAIL — the fault state is currently rule-less, so the machine HALTS (`Status::Halted`), not `HitCap`; `hits_cap` returns false.

- [ ] **Step 3: Make the fault state spin**

In `encoding.rs`, in BOTH `head_op` and `tail_op`, right after `let fault = b.state(format!("{base}.fault"));`, add a self-loop so the fault diverges:

```rust
        let fault = b.state(format!("{base}.fault"));
        // A runtime fault (nil / dangling deref) has NO value: spin here forever so the machine hits the
        // step cap (HitCap), matching λ's Ω-divergence and the reference's Runtime error — the three-way
        // oracle treats all three "no value" outcomes alike. `RuleSpec::new()` reads wildcards / writes
        // nothing / all Stay, so it always matches and never halts (sim has no fixed-point detector).
        b.add_rule(fault, RuleSpec::new(), fault);
```

Update the doc comments accordingly: the `head_op`/`tail_op` trait-method docs (the "routes to an internal defensive-halt" phrasing) → "a nil or dangling pointer has no value and SPINS to a cap (HitCap), matching λ (Ω) and the reference (Runtime)". Update any impl comment that says "defensive halt"/"stuck == halt" for this state.

In `lower_tm.rs`, update the module-doc line `//! pointer over the HEAP — nil/dangling defensively halt.` → `//! pointer over the HEAP — nil/dangling have no value and spin to a cap (matching λ/reference).`

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test -p redextape-core --lib tm::lower_tm tm::encoding`
Expected: PASS (the repurposed test + all prior lower_tm/encoding tests — the valid-pointer deref tests are unaffected; only the fault state changed).

- [ ] **Step 5: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/src/tm/encoding.rs crates/redextape-core/src/tm/lower_tm.rs
git commit -m "feat(tm): a runtime deref fault spins to a cap (HitCap), matching lambda/reference"
```

---

## Task 2: The three-way oracle harness + demo suite

Create `tests/three_way_oracle.rs`: the unified `reference == λ == TM` harness, the consolidated first-order demo suite, the fault demos (now all diverge), and the higher-order λ-only demos.

**Files:**
- Create: `crates/redextape-core/tests/three_way_oracle.rs`

- [ ] **Step 1: Write the harness + demos + tests**

```rust
//! The three-way oracle (spec §12.1): for every first-order demo, the reference tree-walker's value,
//! the decoded λ normal form, and the decoded TM final tape all agree. Runtime faults are the shared
//! "no value" outcome (reference Runtime, λ HitCap, TM HitCap). Higher-order map/fold stays λ-only —
//! the TM is first-order (Plan 3b), so run_tm returns LowerError. The per-category oracles
//! (tm_oracle.rs's reference==TM / asm-interp==TM, lambda_oracle.rs's reference==λ) stay for
//! localization; this file is the unified capstone.

use redextape_core::desugar::desugar;
use redextape_core::lambda::{LambdaRun, MAX_REDUCTION_STEPS, decode, run_lambda};
use redextape_core::parser::parse;
use redextape_core::tm::{TM_DEFAULT_CAPS, TmCaps, TmRun, Unary, decode_tape, run_tm};
use redextape_core::{RunError, run};

/// reference == λ == TM, guided by the reference value's type. All three must run to a value that
/// decodes equal.
fn assert_three_way(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    let tm = run_tm(&core, &Unary, TM_DEFAULT_CAPS);
    match (reference, lambda, tm) {
        (Ok(rv), LambdaRun::Reduced(nf), TmRun::Ran { tapes }) => {
            assert_eq!(decode(&nf, &rv), Some(rv.clone()), "reference vs λ disagree for: {src}");
            assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv.clone()), "reference vs TM disagree for: {src}");
        }
        (r, l, t) => panic!("three-way oracle mismatch for {src}:\n  reference={r:?}\n  lambda={l:?}\n  tm={t:?}"),
    }
}

/// A runtime-faulting program: the reference faults (Runtime), λ's head/tail of nil is Ω (no normal
/// form), and the TM's deref fault state spins — all the same "no value" outcome. Small caps keep the
/// two divergences fast.
fn assert_three_way_diverges(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, 20_000);
    let tm = run_tm(&core, &Unary, TmCaps { steps: 20_000, cells: 20_000 });
    match (reference, lambda, tm) {
        (Err(RunError::Runtime(_)), LambdaRun::HitCap, TmRun::HitCap) => {}
        (r, l, t) => panic!("expected all three to diverge on {src}:\n  reference={r:?}\n  lambda={l:?}\n  tm={t:?}"),
    }
}

/// A higher-order program: the λ backend handles it (reference == λ), but the TM is first-order
/// (Plan 3b), so run_tm returns LowerError. Assert both.
fn assert_lambda_only(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    assert!(matches!(run_tm(&core, &Unary, TM_DEFAULT_CAPS), TmRun::LowerError(_)), "TM should reject higher-order: {src}");
    match (reference, lambda) {
        (Ok(rv), LambdaRun::Reduced(nf)) => assert_eq!(decode(&nf, &rv), Some(rv.clone()), "reference vs λ disagree for: {src}"),
        (r, l) => panic!("reference vs λ mismatch for {src}:\n  reference={r:?}\n  lambda={l:?}"),
    }
}

/// The dual of `assert_lambda_only`: a program the λ backend refuses to lower in v1 (`LowerError`),
/// while the reference and the first-order TM agree on the value.
fn assert_tm_only(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    assert!(matches!(run_lambda(&core, MAX_REDUCTION_STEPS), LambdaRun::LowerError(_)), "λ should refuse the v1 latent trap: {src}");
    match (reference, run_tm(&core, &Unary, TM_DEFAULT_CAPS)) {
        (Ok(rv), TmRun::Ran { tapes }) => assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv.clone()), "reference vs TM disagree for: {src}"),
        (r, t) => panic!("reference vs TM mismatch for {src}:\n  reference={r:?}\n  tm={t:?}"),
    }
}

/// The full first-order demo suite — arithmetic, monus, comparison, if, let/let-mut/assign/while/seq,
/// calls & recursion, and list construction & access. Every value stays « FIELD_WIDTH (64) and every
/// program runs to a value on ALL THREE backends. (The Plan-2 latent traps that λ v1 REJECTS live in
/// LAMBDA_LIMITATION_DEMOS below — they are not three-way.)
const FIRST_ORDER_DEMOS: &[&str] = &[
    "1 + 2 * 3",
    "3 - 5",
    "if 2 > 1 { 10 } else { 20 }",
    "if 1 == 2 { 10 } else { 20 }",
    "let x = 40; x + 2",
    "let x = 1; let y = x + x; y * 3",
    "let mut x = 1; x = x + 10; x = x * 2; x",
    "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
    "let add1 = |x| x + 1; add1(41)",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
    "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
    "fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))",
    "is_empty(nil)",
    "is_empty(cons(1, nil))",
    "[1, 2, 3]",
    "cons(1, cons(2, nil))",
    "head(cons(7, nil))",
    "tail(cons(7, nil))",
    "head(cons(1, cons(2, nil)))",
    "tail(cons(1, cons(2, nil)))",
    "head(tail(cons(1, cons(2, nil))))",
    "head([1, 2, 3])",
    "tail([1, 2, 3])",
];

/// Runtime-faulting programs: the reference faults, both other backends diverge — all "no value".
const FAULT_DEMOS: &[&str] = &["head(nil)", "tail(nil)"];

/// The DUAL of HIGHER_ORDER_DEMOS: Plan-2 latent-trap programs the λ backend REJECTS in v1 (an
/// immutable `let` shadowing a mutable variable; a `fn` inside a mutation region — λ returns
/// `LowerError` rather than silently miscompile, commit 54aad42), while the reference and the
/// first-order TM both run them to a value. Asserted reference == TM, and λ is `LowerError`.
const LAMBDA_LIMITATION_DEMOS: &[&str] = &[
    "let mut x = 1; x = x + 1; let x = x + 10; x",
    "let mut acc = 0; fn bump(n) { n + 1 } acc = bump(acc); acc = bump(acc); acc",
];

/// Higher-order (map/fold receiving a function argument): λ handles it, the TM refuses (LowerError).
const HIGHER_ORDER_DEMOS: &[&str] = &[
    "\
        fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
        fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
        fn add(a, b) { a + b }\n\
        fn add1(x) { x + 1 }\n\
        fold([3, 1, 2].map(add1), 0, add)",
];

#[test]
fn three_way_oracle_on_the_first_order_suite() {
    for src in FIRST_ORDER_DEMOS {
        assert_three_way(src);
    }
}

#[test]
fn three_way_faults_diverge_on_all_backends() {
    for src in FAULT_DEMOS {
        assert_three_way_diverges(src);
    }
}

#[test]
fn higher_order_agrees_reference_and_lambda_while_tm_refuses() {
    for src in HIGHER_ORDER_DEMOS {
        assert_lambda_only(src);
    }
}

#[test]
fn latent_traps_agree_reference_and_tm_while_lambda_refuses() {
    for src in LAMBDA_LIMITATION_DEMOS {
        assert_tm_only(src);
    }
}
```

- [ ] **Step 2: Run**

Run: `cargo test -p redextape-core --test three_way_oracle`
Expected: PASS. If `three_way_oracle_on_the_first_order_suite` fails on some `src`, localize with the existing per-category oracles: `cargo test -p redextape-core --test tm_oracle` (reference==TM / asm-interp==TM) and `--test lambda_oracle` (reference==λ) pinpoint whether the TM or λ leg disagrees. If `three_way_faults_diverge` fails, confirm Task 1 merged (the TM fault must spin to `HitCap`); if λ yields `Reduced` rather than `HitCap` on `head(nil)` (contradicting `encode.rs`'s Ω nil-branch + `lambda_oracle.rs`'s documented fault arm), STOP and report — the fault arm needs revisiting. If `higher_order_...` fails, confirm `run_tm` returns `LowerError` for the map/fold demo (the first-order boundary).

- [ ] **Step 3: fmt/clippy/commit**

```bash
cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings
git add crates/redextape-core/tests/three_way_oracle.rs
git commit -m "test(tm): the three-way oracle (reference == lambda == TM) over the first-order suite"
```

---

## Task 3: The TM-bounded three-way proptest

Add a property test to `tests/three_way_oracle.rs`: random first-order expressions, bounded so every value stays `< FIELD_WIDTH`, must agree `reference == λ == TM`.

**Files:**
- Modify: `crates/redextape-core/tests/three_way_oracle.rs` (add the `proptest` import, the generator, and the property)

- [ ] **Step 1: Add the generator + property**

Add `use proptest::prelude::*;` to the imports, then append:

```rust
/// A first-order expression generator whose value — AND every intermediate — provably stays under
/// FIELD_WIDTH (64), so the TM's fixed-width unary fields never overflow. Leaves are `< 8` and the
/// node budget keeps the total leaf-sum small; it emits only value-non-growing ops: `+` (bounded by
/// the leaf-sum), monus `-` (shrinks), comparisons and `if` (yield 0/1 or select one branch). It
/// deliberately OMITS `*` (blows values up) and value-reusing `let` (`let q = v; q + q` doubles) —
/// the curated demos cover `*`/`let`/`while`/calls/lists; this property stresses the arithmetic /
/// comparison / if structure three ways. Every generated program terminates to a value (no loops, no
/// functions, no faults), so the value arm always fires.
fn arb_tm_safe_expr() -> impl Strategy<Value = String> {
    let leaf = (0u64..8).prop_map(|n| n.to_string());
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

proptest! {
    #![proptest_config(ProptestConfig { cases: 200, ..ProptestConfig::default() })]

    /// Random TM-safe first-order programs must agree three ways: a value that decodes equal on both
    /// λ and TM. (The generator produces no loops/functions/faults, so a shared cap/fault never arises
    /// here — a `HitCap`/`LowerError` would itself be a bug and trips the catch-all.)
    #[test]
    fn three_way_agrees_on_random_first_order_programs(src in arb_tm_safe_expr()) {
        let reference = run(&src);
        let (prog, ds) = parse(&src);
        prop_assume!(ds.is_empty()); // skip anything that does not parse/type-check
        let core = desugar(&prog.unwrap());
        let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
        let tm = run_tm(&core, &Unary, TM_DEFAULT_CAPS);
        match (reference, lambda, tm) {
            (Ok(rv), LambdaRun::Reduced(nf), TmRun::Ran { tapes }) => {
                prop_assert_eq!(decode(&nf, &rv), Some(rv.clone()));
                prop_assert_eq!(decode_tape(&tapes, &rv, &Unary), Some(rv));
            }
            (r, l, t) => prop_assert!(false, "three-way mismatch for {}:\n ref={:?}\n λ={:?}\n tm={:?}", src, r, l, t),
        }
    }
}
```

- [ ] **Step 2: Run**

Run: `cargo test -p redextape-core --test three_way_oracle`
Expected: PASS (200 cases + the Task-2 tests). If a random program fails, proptest prints the minimal `src` — first check whether any intermediate reached 64 (a generator-bound bug: tighten the leaf range or node budget); otherwise localize with the per-category oracles as in Task 2.

- [ ] **Step 3: fmt/clippy + full suite**

Run: `cargo fmt -p redextape-core && cargo clippy -p redextape-core --all-targets -- -D warnings && cargo test -p redextape-core`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add crates/redextape-core/tests/three_way_oracle.rs
git commit -m "test(tm): a TM-bounded proptest that reference == lambda == TM on random programs"
```

---

## Deferred to Part 2b-2-iv-b (do NOT attempt here)

- **Goldens:** golden `print_asm` output + TM step counts for a few canonical demos (inline expected values — the repo has no snapshot lib, only `proptest`).
- **TM-text round-trip over compiled machines:** `parse_tm(print_tm(m)) == (Some(m), [])` for `m = lower_tm(demo)` (exercises the text form on real, large machines).
- **Fold the deferred Minors:** tighten 2b-1 sub-primitive visibility to private (now `mov`/`jz` are real callers); `x*0` + comparison-trichotomy sweeps; broaden the `asm_oracle` proptest generator + drop its dead `RunError::Static` arm; `cmp_mnemonic`→`bin_mnemonic` rename; dedup `SlotMap::of` (computed twice in `run_tm`); DRY the `run_gadget`/`init_reg` bank layout; the `parse_heap`↔`heap_cells` DRY hoist + a `decode_word` cycle guard consistent with `decode_asm`; the `decode_word` termination-doc reword; the stale `non_first_class_and_heap_shapes_decode_to_none` test rename; the `cons` nested-backtick / `is_empty_op` aliasing / `heap_count` over-spec doc nits; and the two 2b-2-iii-b coverage tests (tail-of-non-last-cell-w/-nonempty-tail; cons-after-deref). Consider splitting STACK/HEAP gadgets into `tm/stack.rs`/`tm/heap.rs` if `encoding.rs` is unwieldy.

## Self-Review (completed while writing)

- **Spec coverage (this slice):** the three-way oracle `reference == λ == TM` over the first-order suite (§12.1) ✓; the fault outcome unified across all three (the deferred `head(nil)` decision — TM now spins to `HitCap`) ✓; higher-order kept λ-only with the TM asserted to `LowerError` (§13.3 first-order boundary) ✓; the TM-bounded proptest that all three agree on random programs (§12.2) ✓. Goldens, TM-text round-trip, and the Minors are deferred to iv-b.
- **Placeholder scan:** all code is complete and concrete — the fault self-loop, the repurposed test, the full harness + demo suite, and the generator + property. No `unimplemented!()`/sketch markers. The one empirical dependency (λ `head(nil)` → `HitCap`) is grounded in `encode.rs`'s Ω nil-branch and `lambda_oracle.rs`'s documented fault arm, with a Step-2 instruction to STOP and report if reality differs.
- **Type/interface consistency:** `run(src) -> Result<Value, RunError>`; `run_lambda(&Core, u64) -> LambdaRun{Reduced(nf),HitCap}`; `decode(&nf, &rv) -> Option<Value>`; `run_tm(&Core, &dyn Encoding, TmCaps) -> TmRun{Ran{tapes},HitCap,LowerError}`; `decode_tape(&tapes, &rv, &Unary) -> Option<Value>` — all match the existing `lambda_oracle.rs`/`tm_oracle.rs` usages verbatim. The generator's value-bound argument (`+`/monus/comparison/if only, bounded leaves + node budget) guarantees every value < FIELD_WIDTH by construction, so the TM never corrupts and the value arm always fires.
