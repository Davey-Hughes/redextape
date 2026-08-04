# λ β-fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `beta`'s three traversals with one, deleting `Σ opening` and `Σ closing` (18.0% of the reducer's allocations) without touching `Σ reshift` — and stop before writing reducer code if the measured ceiling does not clear a bar written first.

**Architecture:** Two probe tasks add the counters that make the ceiling computable, on the corpus and on the nested-group family. Task 3 runs the gate and is a **decision point** — Tasks 4–7 execute only if it passes. Task 4 lands the equivalence differential *before* the optimization, so the test that would catch a wrong index is green before there is anything for it to catch. Task 5 is the one-function change. Tasks 6–7 repair the citations the change falsifies and measure the clock.

**Tech Stack:** Rust (2024 edition), `redextape-core`, zero new dependencies. `cargo test`, `cargo run --release --example`.

**Design:** [`../specs/2026-08-02-lambda-beta-fusion-design.md`](../specs/2026-08-02-lambda-beta-fusion-design.md). Section references below (§2, §5, §6…) are to that document.

## Global Constraints

- **Zero new dependencies.** The crate's rule, and nothing here needs one.
- **Zero edited expectations.** `beta` is semantics-preserving by construction; the three-way oracle, every golden, every step count and every sharing pin must pass unedited. One edited expectation is a correctness defect and ends the slice — it is not a number to renegotiate.
- **Counts before seconds.** The GO/NO-GO gate (§5) is an allocation count and is machine-independent. Wall-clock is the ship bar and is measured last.
- **No wall-clock figure is ever a point value.** Four runs, reported as a range. House rule from `docs(lambda): four wall-clock quotes were still point values, one of them a heading`.
- **Every probe run is memory-capped.** `systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- cargo run --release …`. One λ measurement on this thread has already cost 60 GiB and all swap. **Never `reduce_trace` on the nested-group family** — it materialises every step by contract; the probes use `LambdaCursor`.
- **`--release` is load-bearing**, not hygiene, for every probe run.
- **Test counts are running totals**, not per-task assertions — **and a count is meaningless without the command that produced it.** This constraint originally quoted the roadmap's **748** without naming a runner, which sent Task 4 looking for 748 where its command reports 663. Measured 2026-08-03, after Task 4:
  - `cargo test -p redextape-core` → **663 passed, 3 ignored** (25 targets)
  - `cargo test --workspace` → **740 passed, 3 ignored** (35 targets)
  - `scripts/check-all.sh` → the roadmap's **748**. It is a different denominator, not a larger suite: the runner is `cargo-nextest`, it pairs each config with an explicit `cargo test --doc` (nextest cannot run doctests), and it runs `-p redextape-native --no-default-features` as a **second config**, so tests common to both are counted twice.

  Quote the command beside the number, always. `scripts/check-all.sh` is the branch gate; the per-crate count is what a single task moves.
- **Cite by name, never by line number.** `51c6f8a` replaced drifted line citations with names that cannot drift; do not reintroduce them.

---

### Task 1: The family census learns `closing` and `freevar`

**Why this is first:** §6.2 — `shift_cost_probe.rs`'s census does not count the closing shift at all, so **the GO/NO-GO gate is computable on the corpus and not on the family that selected the target.** Nothing else can proceed usefully.

**Files:**
- Modify: `crates/redextape-core/examples/shift_cost_probe.rs` (the `SubstCensus` struct, its `impl`, and the census printer in `main`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SubstCensus::{closing, freevar}` fields and `SubstCensus::{beta_today, beta_fused_incr, beta_fused_occ}` methods; a free function `beta_allocs_fused(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64, u64)` returning `(spine, reshift, freevar)`. Task 2 ports the same function into the sharing probe.

- [ ] **Step 1: Add the fused-allocation mirror**

Place it immediately after `subst_allocs_lifted`, so the three mirrors sit together.

```rust
/// Allocations the FUSED `beta` of the β-fusion design §2 would make, as
/// `(body spine, per-binder re-shift, free-variable rebuild)`.
///
/// **Mirrors `beta_go` arm for arm, prune included** — the discipline `subst_allocs_today` exists to
/// enforce and that `Σ abs×arg` was retired for breaking. Note the caller passes `arg` ITSELF, not
/// `shift(1, 0, arg)`: never building the `+1` is the mechanism, not an optimization on top of it.
fn beta_allocs_fused(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64, u64) {
    // The same prune as `subst`'s, and the same one the closing shift applies at this depth: every
    // free index in `t` is below `j`, so there is nothing to substitute AND nothing to decrement.
    if t.maxfree() <= j {
        return (0, 0, 0);
    }
    match t.node() {
        // `s.clone()` — a refcount bump, exactly as `subst`'s hit arm is today.
        Node::Var(k) if *k == j => (0, 0, 0),
        // `var(*k - 1)`. `k > j` here (the prune took `k < j`), so `k >= 1` and the subtraction cannot
        // underflow. This is the ONE node today's closing shift allocates that fusion cannot delete —
        // the null-result counter of §4.
        Node::Var(_) => (0, 0, 1),
        Node::Abs(_, b) => {
            let re = shift_allocs(0, s);
            let lifted = shift(1, 0, s);
            let (spine, shifts, fv) = beta_allocs_fused(j + 1, &lifted, b);
            (1 + spine, re + shifts, fv)
        }
        Node::App(f, a) => {
            let (sp1, sh1, fv1) = beta_allocs_fused(j, s, f);
            let (sp2, sh2, fv2) = beta_allocs_fused(j, s, a);
            (1 + sp1 + sp2, sh1 + sh2, fv1 + fv2)
        }
    }
}
```

- [ ] **Step 2: Add the two fields to `SubstCensus`**

Append to the struct, after `per_occ`:

```rust
    /// `beta`'s closing `shift(-1, 0, ·)` over the term `subst` returns.
    ///
    /// **ABSENT FROM THIS CENSUS UNTIL 2026-08-02, AND CORRECTLY SO FOR THE QUESTION IT WAS BUILT
    /// FOR.** Comparing today's `subst` against the lifted rewrite, the closing shift is paid by both
    /// sides and cancels out of `today()/lifted()`. It does not cancel against β-fusion, which deletes
    /// it — so it is counted here and enters only the second contest below.
    closing: u64,
    /// FUSION's null-result counter — the `var(k-1)` nodes the one-walk `beta` still allocates for a
    /// body free variable ABOVE the binder. A proper subset of `closing`: today's closing pass
    /// allocates these same nodes, PLUS the spine down to them (which `subst` had already rebuilt),
    /// PLUS a rebuild of every substituted argument copy. The last two are what fusion deletes; this is
    /// what it cannot, and a slice that cannot attribute a null result is how four designs on this
    /// thread died.
    freevar: u64,
```

- [ ] **Step 3: Add the second contest, leaving the first untouched**

In `impl SubstCensus`, leave `today()` and `lifted()` **exactly as they are** and add three methods below them:

```rust
    /// THE LIFTED-REWRITE CONTEST, DELIBERATELY UNCHANGED. `closing` is paid by both sides and cancels,
    /// and the 0.99x this ratio produced is a landed finding the roadmap quotes. Adding a term to both
    /// sides of it would move a published number without adding information.
    fn today(&self) -> u64 {
        self.opening + self.spine + self.reshift
    }

    fn lifted(&self) -> u64 {
        self.opening + self.spine + self.per_occ
    }

    /// THE FUSION CONTEST. `closing` does not cancel here — it is half of what fusion deletes — so
    /// these three totals carry it where the pair above does not.
    fn beta_today(&self) -> u64 {
        self.opening + self.spine + self.reshift + self.closing
    }

    /// Design §2: `s` carried incrementally, both of `beta`'s shifts gone, `reshift` untouched.
    fn beta_fused_incr(&self) -> u64 {
        self.spine + self.reshift + self.freevar
    }

    /// Design §5b's formulation: the shift paid once per occurrence. Carried so that the design's
    /// disagreement with the sentence it inherited is MEASURED rather than argued.
    fn beta_fused_occ(&self) -> u64 {
        self.spine + self.per_occ + self.freevar
    }
```

- [ ] **Step 4: Count the two new quantities in `observe`, and assert the design's two invariants**

In `SubstCensus::observe`, replace the block from `let (spine_lifted, per_occ) = …` through `self.per_occ += per_occ;` with:

```rust
        let (spine_lifted, per_occ) = subst_allocs_lifted(0, 0, &opened, body);
        assert_eq!(spine_today, spine_lifted, "the two candidates must rebuild the same body spine");

        // The fused walk takes `arg`, not `opened` — design §2. The two assertions below are DRIFT
        // GUARDS between `subst_allocs_today` and `beta_allocs_fused`, not a check of the design — both
        // are forced true by construction, not by the design being right. `spine`: the two mirrors share
        // the identical prune and the identical spine recursion, so `spine_today == spine_fused` cannot
        // fail. `reshift`: the fused walk's `s` is exactly one `shift(1, 0, ·)` behind today's, and
        // `shift_allocs(0, ·)` is invariant under that shift — it changes neither the tree shape nor
        // which occurrences are free, so the prune flips identically on both sides. What these catch is a
        // LATER edit that desynchronises the two mirrors; the actual check that the shipped `beta`
        // matches this design is the equivalence differential in Task 4, not these.
        let (spine_fused, reshift_fused, freevar) = beta_allocs_fused(0, arg, body);
        assert_eq!(spine_today, spine_fused, "fusion must rebuild the same body spine as `subst`");
        assert_eq!(reshift, reshift_fused, "fusion must re-shift once per binder, as `subst` does");

        self.spine += spine_today;
        self.reshift += reshift;
        self.per_occ += per_occ;
        self.closing += shift_allocs(0, &subst(0, &opened, body));
        self.freevar += freevar;
```

Check the `use` line at the top of the file imports `subst`; add it if not (`use redextape_core::lambda::term::{…, subst, …}`).

- [ ] **Step 5: Print the second table**

In `main`, immediately after the existing census loop ends, add a second loop over the same `family`. Do **not** widen the existing table — its format string is already at the file's line budget, and the two contests answer different questions.

The census is expensive enough per step (it now builds one real `subst` result per β-step, on top of three mirror walks) that recomputing it for a second table would double an already multi-minute run. So hoist the census results out of the first loop instead of re-running them: change the first loop to collect `Vec<(String, SubstCensus, &'static str)>` of `(label, census, capped)`, print the existing table from that vector, then print the new one from the same vector.

```rust
    line("");
    line("β-FUSION contest — `beta` as three passes against `beta` as one. `closing` is counted here and");
    line("is NOT in the `today` column above: it cancels in the lifted contest and does not cancel here.");
    line("`freevar` is the null-result counter — what the fused walk still has to rebuild.");
    line("program          steps    opening     spine   reshift   closing   freevar   beta_today  fused_incr  fused_occ    win");
    for (label, c, capped) in &censuses {
        let win = if c.beta_fused_incr() == 0 { 0.0 } else { c.beta_today() as f64 / c.beta_fused_incr() as f64 };
        line(&format!(
            "{label:<14}  {:>6}  {:>9}  {:>8}  {:>8}  {:>8}  {:>8}  {:>11}  {:>10}  {:>9}  {win:>5.2}x{capped}",
            c.steps,
            c.opening,
            c.spine,
            c.reshift,
            c.closing,
            c.freevar,
            c.beta_today(),
            c.beta_fused_incr(),
            c.beta_fused_occ(),
        ));
    }
```

- [ ] **Step 6: Build it**

Run: `cargo build --release -p redextape-core --example shift_cost_probe`
Expected: compiles clean, no warnings. `cargo clippy` runs in the pre-commit hook and must also be clean.

- [ ] **Step 7: Smoke-run the census on the cheap rows only**

Do not run the full family yet — Task 3 does that under the cap and records the output. Confirm the code path executes and neither assertion fires by temporarily reducing the family in `main` to `(1..=2u32)`, running, then reverting the range.

Run:
```bash
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example shift_cost_probe
```
Expected: both tables print, `spine`/`reshift` assertions do not fire, `freevar` and `closing` are non-zero.

**If either assertion fires, STOP.** By construction neither can: `spine_today == spine_fused` and
`reshift == reshift_fused` are forced by the two mirrors sharing the identical prune and the identical
spine recursion (see `SubstCensus::observe`'s comment for the argument in full). A firing means
`beta_allocs_fused` has desynced from `subst_allocs_today`, not that §2.2/§2.3 are wrong — those are
established by the design's own argument and checked end-to-end by the equivalence differential in
Task 4, not by these.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/examples/shift_cost_probe.rs
git commit -m "probe(lambda): the family census counts the closing shift, and the fused walk

The census was built to compare today's \`subst\` against the lifted rewrite, where
\`beta\`'s closing shift is paid by both sides and cancels out of the ratio. It does
not cancel against β-fusion, which deletes it — so the census could not compute
that slice's gate on the one family that selected the target.

Adds \`closing\`, \`freevar\` (the null-result counter: what the fused walk still has
to rebuild) and a second contest table. The lifted contest's \`today()\`/\`lifted()\`
are deliberately untouched, because the 0.99x they produce is a landed finding.

\`beta_allocs_fused\` mirrors the design's \`beta_go\` arm for arm. The two new
assertions in \`observe\` are drift guards between it and \`subst_allocs_today\`,
forced true by construction — not a check of §2.2/§2.3, which the design's own
argument establishes and Task 4's equivalence differential checks end-to-end."
```

---

### Task 2: The corpus census learns `freevar` and a FAITHFUL `per_occ`

**Files:**
- Modify: `crates/redextape-core/examples/lambda_sharing_probe.rs` (the `Work` struct, `impl Work`, `account`, `COUNTERS`, `part_b`)

**Interfaces:**
- Consumes: `beta_allocs_fused` from Task 1 — **ported, not shared.** Integration tests and examples in this crate carry local copies (`lambda_sharing_probe.rs` and `lambda_foreign_reader.rs` both copy `FIRST_ORDER_DEMOS` verbatim); an example cannot import from another example.
- Produces: `Work::{per_occ, freevar}` and `Work::{beta_today, beta_fused_incr, beta_fused_occ}`; four new `COUNTERS` entries.

- [ ] **Step 1: Port the two mirrors this probe lacks**

`lambda_sharing_probe.rs` has `shift_allocs` and `subst_allocs` (today's). It has **no faithful `per_occ`** — `occ_times_arg` is one of the three STALE models kept as controls, and reusing it would reproduce the exact error this probe was repaired for (§6.1). Add both functions next to `subst_allocs`:

```rust
/// Allocations the falsified lifted rewrite WOULD make, as `(body spine, per-occurrence shift)`.
///
/// Ported verbatim from `shift_cost_probe.rs`'s `subst_allocs_lifted`, which is the faithful mirror.
/// **`Work::occ_times_arg` is NOT this** — that is `occ × size_of(arg)`, a static model kept as a
/// control, and the whole point of the 2026-08-02 repair was to stop products standing in for walks.
/// This exists so the β-fusion design's disagreement with §5b's formulation is measured on this corpus.
fn subst_allocs_lifted(j: u32, lift: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64) {
    if t.maxfree() <= j {
        return (0, 0);
    }
    match t.node() {
        // The `lift == 0` arm: a refcount bump, where `shift(0, 0, s)` would deep-rebuild.
        Node::Var(k) if *k == j => (0, if lift == 0 { 0 } else { shift_allocs(0, s) }),
        Node::Var(_) => (0, 0),
        Node::Abs(_, b) => {
            let (spine, shifts) = subst_allocs_lifted(j + 1, lift + 1, s, b);
            (1 + spine, shifts)
        }
        Node::App(f, a) => {
            let (sp1, sh1) = subst_allocs_lifted(j, lift, s, f);
            let (sp2, sh2) = subst_allocs_lifted(j, lift, s, a);
            (1 + sp1 + sp2, sh1 + sh2)
        }
    }
}

/// Allocations the FUSED `beta` of the β-fusion design §2 would make, as
/// `(body spine, per-binder re-shift, free-variable rebuild)`.
///
/// **Mirrors `beta_go` arm for arm, prune included.** The caller passes `arg` ITSELF, not
/// `shift(1, 0, arg)`: never building the `+1` is the mechanism.
fn beta_allocs_fused(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> (u64, u64, u64) {
    if t.maxfree() <= j {
        return (0, 0, 0);
    }
    match t.node() {
        // `s.clone()` — a refcount bump.
        Node::Var(k) if *k == j => (0, 0, 0),
        // `var(*k - 1)`. `k > j` here, so `k >= 1` and the subtraction cannot underflow.
        Node::Var(_) => (0, 0, 1),
        Node::Abs(_, b) => {
            let re = shift_allocs(0, s);
            let lifted = shift(1, 0, s);
            let (spine, shifts, fv) = beta_allocs_fused(j + 1, &lifted, b);
            (1 + spine, re + shifts, fv)
        }
        Node::App(f, a) => {
            let (sp1, sh1, fv1) = beta_allocs_fused(j, s, f);
            let (sp2, sh2, fv2) = beta_allocs_fused(j, s, a);
            (1 + sp1 + sp2, sh1 + sh2, fv1 + fv2)
        }
    }
}
```

- [ ] **Step 2: Add the two fields to `Work`**

Append after `closing`, keeping them inside the FAITHFUL block rather than the stale one:

```rust
    /// FAITHFUL. The falsified lifted rewrite's replacement for `reshift`: `shift(lift, 0, s)` once per
    /// OCCURRENCE at `lift > 0`. New 2026-08-02 with β-fusion, which needs it to price §5b's
    /// formulation against §2's. `occ_times_arg` below is the STALE model of the same idea and loses to
    /// this in PART C.
    per_occ: u64,
    /// FAITHFUL, and it is β-fusion's NULL-RESULT COUNTER. The `var(k-1)` nodes the one-walk `beta`
    /// still allocates for a body free variable above the binder — a proper subset of `closing`, which
    /// also pays the spine down to them and a rebuild of every substituted argument copy.
    freevar: u64,
```

- [ ] **Step 3: Add the fusion totals, leaving `alloc()` alone**

`Work::alloc()` is today's real cost and PART C.2 fits node prices against it. **Do not add the fused counters to it.** Add three methods after `read()`:

```rust
    /// β-FUSION's contest. `beta_today` is `alloc()` minus the traversals fusion does not touch, so
    /// the ratio below is about `beta` and not about the whole reducer.
    fn beta_today(&self) -> u64 {
        self.opening + self.spine + self.reshift + self.closing
    }

    /// Design §2: `s` carried incrementally, both of `beta`'s shifts gone, `reshift` untouched.
    fn beta_fused_incr(&self) -> u64 {
        self.spine + self.reshift + self.freevar
    }

    /// Design §5b's formulation, the one §2 rejects: the shift paid once per occurrence.
    fn beta_fused_occ(&self) -> u64 {
        self.spine + self.per_occ + self.freevar
    }
```

- [ ] **Step 4: Count them in `account`, with the same two assertions**

Replace the faithful block in `account` (the five lines from `w.opening += shift_allocs(0, arg);` through `w.closing += …;`) with:

```rust
        w.opening += shift_allocs(0, arg);
        let opened = shift(1, 0, arg);
        let (spine, reshift) = subst_allocs(0, &opened, body);
        let (spine_lifted, per_occ) = subst_allocs_lifted(0, 0, &opened, body);
        assert_eq!(spine, spine_lifted, "the lifted candidate must rebuild the same body spine");

        // The fused walk takes `arg`, not `opened` — β-fusion design §2. These two assertions are DRIFT
        // GUARDS between `subst_allocs` and `beta_allocs_fused`, forced true by construction rather than
        // a check of the design (`shift_cost_probe.rs`'s `SubstCensus::observe` states the reason: the
        // two mirrors share the identical prune and spine recursion, and the fused walk's `s` is exactly
        // one `shift(1, 0, ·)` behind today's, under which `shift_allocs(0, ·)` is invariant). What they
        // catch is a later desync between the two mirrors, not a design error.
        let (spine_fused, reshift_fused, freevar) = beta_allocs_fused(0, arg, body);
        assert_eq!(spine, spine_fused, "fusion must rebuild the same body spine as `subst`");
        assert_eq!(reshift, reshift_fused, "fusion must re-shift once per binder, as `subst` does");

        w.spine += spine;
        w.reshift += reshift;
        w.per_occ += per_occ;
        w.closing += shift_allocs(0, &subst(0, &opened, body));
        w.freevar += freevar;
        w.depth_guard += 1;
```

- [ ] **Step 5: Enter the new counters in PART C's contest**

Append to `COUNTERS`, after `Σ guard` and before the `SPLIT` entries:

```rust
    Counter { name: "Σ per_occ", origin: "HYPO", f: |w| w.per_occ },
    Counter { name: "Σ freevar", origin: "HYPO", f: |w| w.freevar },
    Counter { name: "Σ β today", origin: "SPLIT", f: Work::beta_today },
    Counter { name: "Σ β fused", origin: "SPLIT", f: Work::beta_fused_incr },
    Counter { name: "Σ β occ", origin: "SPLIT", f: Work::beta_fused_occ },
```

- [ ] **Step 6: Print the β-fusion block in PART B**

After PART B's existing table loop, add:

```rust
    println!(
        "\nβ-FUSION (design 2026-08-02-lambda-beta-fusion §4). `beta today` is the three passes;\n\
         `fused incr` carries `s` per binder and deletes both shifts; `fused occ` is the\n\
         per-occurrence formulation §2 rejects. `freevar` is the null-result counter — what the\n\
         fused walk still has to rebuild, and the gate is that it stays under 40% of opening+closing.\n"
    );
    println!(
        "{:>3} | {:>9}  {:>9}  {:>9} | {:>10}  {:>10}  {:>10}",
        "#", "opening", "closing", "freevar", "β today", "fused incr", "fused occ"
    );
    println!("{}", "-".repeat(80));
    let (mut oc, mut fv) = (0u64, 0u64);
    for r in rows {
        let w = &r.work;
        oc += w.opening + w.closing;
        fv += w.freevar;
        println!(
            "{:>3} | {:>9}  {:>9}  {:>9} | {:>10}  {:>10}  {:>10}",
            r.idx,
            w.opening,
            w.closing,
            w.freevar,
            w.beta_today(),
            w.beta_fused_incr(),
            w.beta_fused_occ()
        );
    }
    println!(
        "\nGATE (design §5): Σ freevar = {fv} against Σ opening + Σ closing = {oc} — {:.1}%, \
         and the bar is under 40%.",
        if oc == 0 { 0.0 } else { 100.0 * fv as f64 / oc as f64 }
    );
```

- [ ] **Step 7: Build and run**

Run:
```bash
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example lambda_sharing_probe
```
Expected: PART B prints the new block and the `GATE` line; neither assertion fires; PART C's table gains five rows.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/examples/lambda_sharing_probe.rs
git commit -m "probe(lambda): PART B prices β-fusion, both formulations, on the corpus

Adds \`freevar\` — β-fusion's null-result counter, the \`var(k-1)\` nodes the fused
walk still allocates — and a FAITHFUL \`per_occ\`, which this probe did not have:
\`occ_times_arg\` is the static model kept as a control, and reusing it would
reproduce the error the 2026-08-02 repair was for.

Both formulations are priced, \`fused incr\` against \`fused occ\`, so the design's
disagreement with the sentence it inherited is measured rather than argued. Both
enter PART C's contest. \`alloc()\` is untouched — it is today's real cost and
PART C.2 fits against it.

Asserts per corpus β-step that fusion rebuilds the same spine and re-shifts once
per binder, as \`subst\` does."
```

---

### Task 3: Run the gate — **DECISION POINT**

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-lambda-beta-fusion-design.md` (§5 gains a GATE RESULT block)
- Modify: `crates/redextape-core/examples/shift_cost_probe.rs` (module doc: the sample tables gain the new columns)
- Modify: `crates/redextape-core/examples/lambda_sharing_probe.rs` (module doc: record the gate figure)

**Interfaces:**
- Consumes: both probes from Tasks 1–2.
- Produces: the decision. **Tasks 4–7 run only if the gate passes.**

- [ ] **Step 1: Run the corpus probe, capture the output**

```bash
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example lambda_sharing_probe \
  | tee "${TMPDIR:-/tmp}/sharing-gate.txt"
```
Expected: a `GATE (design §5): Σ freevar = … against Σ opening + Σ closing = … — NN.N%` line.

- [ ] **Step 2: Run the family probe, capture the output**

The full family is 11 levels and the census now builds one real `subst` result per β-step on top of three mirror walks, so budget **several minutes**. Rows flush before the next is computed, so partial output is usable if it is killed.

```bash
systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
  cargo run --release -p redextape-core --example shift_cost_probe \
  | tee "${TMPDIR:-/tmp}/family-gate.txt"
```
Expected: the β-FUSION contest table, 13 rows, with `freevar` and `closing` populated.

- [ ] **Step 3: Evaluate the gate against §5, written before these numbers existed**

The bar, verbatim from the design:

- `Σ freevar < 40%` of `Σ opening + Σ closing`; **and**
- no corpus row's total allocations rise — i.e. `beta_fused_incr() <= beta_today()` on every one of the 46 rows and every family level.

**If it fails:** stop. Do not write reducer code. Record the result in the design as a struck §5 with a dated block, add a `FALSIFIED 2026-08-02` entry to the roadmap in the shape of the `CLOSED 2026-08-02` block, and the slice ends as the fifth null result on this thread. That is a successful outcome of a measurement slice, not a failure of one.

**If it passes:** continue, and record which formulation won — `beta_fused_incr` against `beta_fused_occ`. §2 predicts `incr`; if `occ` wins on this corpus, §2's central argument is wrong and Task 5 changes shape. Say so explicitly in the block rather than implementing the prediction.

- [ ] **Step 4: Write the result into the design's §5**

Add directly under §5's SHIP bar, in the shape the zipper design's §3 uses (`The bar, set before the number is known — and PASSED at 36.2%`):

```markdown
> **GATE RESULT — 2026-08-02.** `Σ freevar` is **N** against `Σ opening + Σ closing` of **M**, i.e.
> **P%** against a bar of 40%. [PASSED / FAILED]. Corpus rows where allocations rise: **K**. The
> formulation contest: `Σ β fused` **A** against `Σ β occ` **B**, so §2's incremental form [wins /
> loses], which was [predicted / not predicted]. Family: `beta_today` **X** → `fused_incr` **Y** at
> level 1 and **X'** → **Y'** at level 11. Raw output: `shift_cost_probe` and `lambda_sharing_probe`,
> re-runnable rather than quoted.
```

Replace every bracketed alternative and every capital letter with the measured value. **No placeholder may survive this step.**

- [ ] **Step 5: Refresh both probes' module-doc tables**

Both files carry their own results in their module docs. `shift_cost_probe.rs`'s census sample table now has columns it does not show; `lambda_sharing_probe.rs`'s PART B header block should state the gate figure. Paste the real rows from Steps 1–2.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-02-lambda-beta-fusion-design.md \
        crates/redextape-core/examples/shift_cost_probe.rs \
        crates/redextape-core/examples/lambda_sharing_probe.rs
git commit -m "measure(lambda): the β-fusion gate — Σ freevar is P% of opening+closing

The bar was written in §5 before this number existed: under 40%, and no row's
allocations rising. [PASSED/FAILED at P%.]

Both formulations were priced rather than one. [Result.]

Both probes' module docs carry the rows, so the tables are a repro rather than a
quotation."
```

---

### Task 4: The equivalence differential lands BEFORE the optimization

**Why before:** the zipper's equivalence test *"landed one task before the optimization and stayed green through it with zero edits, which is what made resumption safe to add."* Same discipline. Today this test compares `beta` against a copy of itself and passes trivially; that is the point — Task 5 is what makes it load-bearing, and a test written after the change is a test written to the change.

**Files:**
- Modify: `crates/redextape-core/tests/subst_differential.rs`

**Interfaces:**
- Consumes: `terms_up_to`, `T_NODES`, `S_NODES`, `VARS` — already in the file.
- Produces: `beta_three_pass(body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm`, the reference Task 5's change is differentiated against.

- [ ] **Step 1: Record the test-count baseline**

Run: `cargo test -p redextape-core 2>&1 | tail -20`
Expected: all green. Note the total; the roadmap records **748** at the branch point. Carry it as a running total.

- [ ] **Step 2: Extend the module doc**

The file's header is entirely about the falsified lifted rewrite. Add, after the existing first paragraph:

```rust
//! **SECOND QUESTION, ADDED 2026-08-02: does β-FUSION preserve `beta`?** `beta` was three traversals —
//! `shift(-1, 0, subst(0, shift(1, 0, arg), body))` — and is now one walk that carries the argument
//! incrementally and decrements free indices in place. The rewrite is index arithmetic whose
//! correctness rests on a cancellation (`shift(-1, ·)` undoing the opening `+1` on the substituted
//! argument), which is exactly the kind of claim an exhaustive differential settles and an example does
//! not. `beta_three_pass` below is the old formulation, kept for the same reason `subst_naive` is: a
//! differential needs the thing it differentiates against to survive the change.
```

- [ ] **Step 3: Write the reference and the failing-by-construction test**

Add `beta` to the file's `use redextape_core::lambda::term::{…}` list. Then, after `subst_at`:

```rust
/// `beta` as THREE PASSES — the formulation `term.rs` shipped until β-fusion.
///
/// This is not dead code and it is not a duplicate: it is the reference the shipped `beta` is
/// differentiated against, and the moment it stops being spelled out here the differential compares
/// `beta` to itself. `tests/lambda_foreign_reader.rs` verified all three shifts independently against
/// the corpus, which is where the confidence that THIS is the right reference comes from.
fn beta_three_pass(body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm {
    shift(-1, 0, &subst(0, &shift(1, 0, arg), body))
}
```

and the test:

```rust
/// **THE GATE FOR β-FUSION, AND IT LANDED BEFORE THE OPTIMIZATION DID.** Today it compares the shipped
/// `beta` against a spelled-out copy of itself and passes trivially. That is deliberate: a test written
/// after the change is a test written to the change, and the zipper slice's equivalence gate landed one
/// task early for the same reason.
///
/// **Where a wrong index would hide.** The fused walk substitutes `shift(d, 0, arg)` at depth `d`,
/// where the three-pass form substitutes `shift(d+1, 0, arg)` and then decrements it. Those agree only
/// because the opening shift and the closing shift are an up-and-down pair that cancels — a claim about
/// arithmetic, over a case (`arg` with free indices, `d > 0`) that the curated `beta` tests in
/// `term.rs` do not reach. The enumeration reaches it by construction: `VARS` is 4, above the binder
/// depth the generator produces.
///
/// **`beta` is total on every pair here.** `subst(0, …)` replaces every free `Var(0)` before the
/// closing `shift(-1, 0, ·)` runs, so the negative-index assert is unreachable — the invariant
/// `shift`'s own doc block spells out.
#[test]
fn the_shipped_beta_agrees_with_the_three_pass_formulation_on_every_enumerated_pair() {
    let bodies = terms_up_to(T_NODES, VARS);
    let args = terms_up_to(S_NODES, VARS);
    let mut pairs = 0u64;
    for body in bodies.iter().flatten() {
        for arg in args.iter().flatten() {
            assert_eq!(
                beta(body, arg),
                beta_three_pass(body, arg),
                "β-fusion changed the answer for body {body:?} and arg {arg:?}"
            );
            pairs += 1;
        }
    }
    // The enumeration is the test; a collapsed generator would pass vacuously. `the_shipped_subst_…`
    // above guards its own count the same way and for the same reason.
    assert!(pairs > 80_000, "the (body, arg) enumeration collapsed: only {pairs} pairs");
    println!("β-fusion differential: {pairs} (body, arg) pairs, 0 mismatches");
}
```

- [ ] **Step 4: Run it**

Run: `cargo test -p redextape-core --test subst_differential -- --nocapture`
Expected: PASS, printing `β-fusion differential: 88960 (body, arg) pairs, 0 mismatches` (the exact count depends on `terms_up_to`; whatever it prints must exceed 80,000).

- [ ] **Step 5: Prove the test can fail**

A gate that has never been red is not known to be a gate. Temporarily change `beta_three_pass` to drop the closing shift (`subst(0, &shift(1, 0, arg), body)`), re-run, confirm FAIL, then revert.

Run: `cargo test -p redextape-core --test subst_differential`
Expected: FAIL with a `β-fusion changed the answer` assertion. **Revert the edit before committing.**

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/tests/subst_differential.rs
git commit -m "test(lambda): the β-fusion differential, landed before the optimization

Exhaustive over every (body, arg) pair the existing generator produces, comparing
the shipped \`beta\` against the three-pass formulation spelled out locally. Passes
trivially today — both sides are the same function — which is the point: a test
written after the change is a test written to the change.

Where a wrong index would hide is named in the doc: the fused walk substitutes
\`shift(d, 0, arg)\` where three passes substitute \`shift(d+1, 0, arg)\` and then
decrement, and they agree only because the opening and closing shifts cancel. The
curated \`beta\` tests in \`term.rs\` do not reach an open argument under a binder;
the enumeration does, by construction."
```

---

### Task 5: Fuse `beta`

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs` (`beta`, plus a new `beta_go`, plus one new test)

**Interfaces:**
- Consumes: Task 4's differential.
- Produces: `beta` with an unchanged public signature — `pub fn beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm`. `beta_go` is private. `shift` and `subst` keep their signatures and stay `pub`; §8 makes narrowing them a non-goal.

- [ ] **Step 1: Replace `beta`**

Replace the whole of `beta` (and its doc comment) with:

```rust
/// β-reduce `(\. abs_body) arg`: substitute `arg` for index 0 in `abs_body` and close the hole, in ONE
/// walk.
///
/// **This was three walks until 2026-08-02** — `shift(-1, 0, subst(0, shift(1, 0, arg), body))`, the
/// textbook de Bruijn formulation — and `Σ opening + Σ closing` was 18.0% of every allocation the
/// reducer made. The opening shift and the closing shift are an up-and-down pair that cancels on the
/// substituted argument: three passes build `shift(d+1, 0, arg)` at binder depth `d` and then decrement
/// it, where `beta_go` carries `shift(d, 0, arg)` and never builds the `+1`.
///
/// **The per-binder re-shift is deliberately NOT fused away.** Paying `shift(·, 0, arg)` once per
/// OCCURRENCE instead of once per binder crossed was measured at 1.5x — `subst`'s `maxfree`
/// short-circuit means it descends through only the binders on the path to an occurrence, so binders
/// crossed is the SMALLER quantity. That slice is falsified; this one is a different mechanism and
/// leaves `Σ reshift` alone. See
/// `docs/superpowers/specs/2026-08-02-lambda-beta-fusion-design.md`.
///
/// Equivalence to the three-pass form is exhaustive, not exemplary:
/// `tests/subst_differential.rs::the_shipped_beta_agrees_with_the_three_pass_formulation_on_every_enumerated_pair`.
pub fn beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm {
    // `arg`, NOT `shift(1, 0, arg)` — see the doc above.
    beta_go(abs_body, 0, arg)
}

/// One walk of `beta`: substitute `s` for index `j`, decrement every free index above `j`.
///
/// `s` is `arg` lifted by `j`, maintained by the `Abs` arm exactly as `subst`'s is — which is why
/// `Σ reshift` is unchanged by fusion, and `shift(1, 0, s)` short-circuits to a refcount bump on the
/// 88.4% of corpus steps whose argument is closed either way.
fn beta_go(t: &LambdaTerm, j: u32, s: &LambdaTerm) -> LambdaTerm {
    // `subst`'s short-circuit, and simultaneously the closing shift's: every free index in `t` is below
    // `j`, so there is nothing to substitute AND nothing to decrement. Returning the handle preserves
    // the ALLOCATION, which is what `a_beta_step_is_bounded_by_allocations_not_by_logical_nodes` pins.
    if t.maxfree() <= j {
        return t.clone();
    }
    match t.node() {
        // NO THIRD ARM, and the argument is `shift`'s verbatim: `maxfree(Var(k))` is `k + 1`, so this
        // is reached only when `k + 1 > j`, i.e. `k >= j` unconditionally. `k < j` cannot arrive here.
        Node::Var(k) => {
            debug_assert!(*k >= j, "the maxfree short-circuit should have returned for Var({k}) at index {j}");
            if *k == j {
                // A refcount bump. `subst`'s hit arm, unchanged.
                s.clone()
            } else {
                // `k > j`, hence `k >= 1`: THE SUBTRACTION CANNOT UNDERFLOW, and it cannot because of
                // the branch rather than because of a check. This is the node the closing
                // `shift(-1, 0, ·)` used to allocate, and the reason `shift`'s negative-index assert no
                // longer has an in-library caller — see its doc block.
                var(*k - 1)
            }
        }
        Node::Abs(n, b) => abs(Rc::clone(n), beta_go(b, j + 1, &shift(1, 0, s))),
        Node::App(f, a) => app(beta_go(f, j, s), beta_go(a, j, s)),
    }
}
```

- [ ] **Step 2: Run the differential first**

Run: `cargo test -p redextape-core --test subst_differential -- --nocapture`
Expected: PASS, same pair count as Task 4 Step 4. **This is the step that decides the slice.** If it fails, the index arithmetic is wrong; the failing `(body, arg)` pair is printed and is minimal enough to trace by hand.

- [ ] **Step 3: Run the whole suite, and expect ZERO edited expectations**

Run: `cargo test -p redextape-core`
Expected: the same total as Task 4 Step 1, all green — including `three_way_oracle`, `lambda_oracle`, `lambda_foreign_reader`, `zipper_equivalence`, `trace_equivalence`, `lambda_sharing`, and `term.rs`'s five `beta`/sharing unit tests.

**If any expectation would need editing, STOP.** That is the equivalence gate in §9 and it ends the slice rather than being renegotiated.

- [ ] **Step 4: Add the structural pin for §2.4**

In `term.rs`'s test module, next to the other `beta` tests:

```rust
/// **THE UNDERFLOW IS IMPOSSIBLE BY BRANCH, NOT BY CHECK, AND THIS IS WHAT SAYS SO.** `beta_go` reaches
/// `var(*k - 1)` only when `k > j >= 0`. Before fusion the same node came from `shift(-1, 0, ·)`, whose
/// `assert!` exists because the arithmetic wraps a negative result to a huge index — "a miscompile is
/// worse than a crash", as its doc block puts it. Fusion does not weaken that guarantee; it makes it
/// structural, and a test that never reaches `k = j + 1` would not notice if a later edit did weaken it.
#[test]
fn beta_decrements_a_free_index_directly_above_the_binder() {
    // Body `\y. (0 1)` under the redex binder: index 1 is the binder's own variable seen from inside
    // `y`, and index 2 is one above it — the `k = j + 1` case at `j = 1`.
    let body = abs("y", app(var(1), var(2)));
    let arg = var(7);
    assert_eq!(beta(&body, &arg), abs("y", app(var(7 + 1), var(1))));
}
```

- [ ] **Step 5: Run the new test**

Run: `cargo test -p redextape-core --lib lambda::term -- --nocapture`
Expected: PASS. Total is Task 4's running total + 1.

If the expected term is wrong, work it by hand against `beta_three_pass`: `shift(-1, 0, subst(0, shift(1, 0, var(7)), abs("y", app(var(1), var(2)))))`. Correct the *expectation* to whatever both formulations agree on — the differential in Task 4 is the authority on the semantics, and this test exists to reach a case, not to redefine one.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/lambda/term.rs
git commit -m "perf(lambda): beta's three passes become one

\`beta\` was \`shift(-1, 0, subst(0, shift(1, 0, arg), body))\`. The opening and the
closing shift are an up-and-down pair that cancels on the substituted argument:
three passes build \`shift(d+1, 0, arg)\` at binder depth d and then decrement it,
where one walk carries \`shift(d, 0, arg)\` and never builds the +1.

\`Σ reshift\` is untouched, deliberately. Paying the shift once per occurrence
instead of once per binder crossed was measured at 1.5x and is falsified; this is
a different mechanism on a different quantity, and the \`Abs\` arm is \`subst\`'s
unchanged.

The prune is unchanged too — \`t.maxfree() <= j\` is \`subst\`'s short-circuit and is
what the closing shift prunes at the same depth — so the same subterms are
returned by handle and no sharing is lost.

Equivalence is exhaustive: every (body, arg) pair the generator produces, against
the three-pass formulation. Zero edited expectations across the suite."
```

---

### Task 6: Repair every live citation of the three-pass formula

**Why it is a task and not a follow-up:** the roadmap's `grep the tree for a falsified claim, not the document that stated it first` entry, and the fact that `Σ abs×arg` stayed quoted by four documents for a day after the code moved out from under it.

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs` (`shift`'s doc block; `a_beta_step_is_bounded_by_allocations_not_by_logical_nodes`'s doc)
- Modify: `crates/redextape-core/tests/lambda_foreign_reader.rs` (§5 of the module doc)
- Modify: `crates/redextape-core/tests/subst_differential.rs` (`shift_additivity_…`'s doc; `the_shipped_subst_shares_the_argument_…`'s doc). **Added 2026-08-03 by Task 5's review** — the latter's doc says `beta` "closes the hole with `shift(-1, 0, ·)` … so it rebuilds the reduct and discards what `subst` shared". That is precisely the behaviour Task 5 deleted, and the sentence now describes no code in the tree. It is not a citation repair like the others in this list: it names a mechanism whose *absence* is the slice's second result, so the replacement should say what now happens rather than merely dropping the claim.
- Modify: `docs/superpowers/specs/2026-08-02-lambda-beta-fusion-design.md` §2.3. **Added 2026-08-03 from Task 5's measurement** — §2.3 claims "no allocation that is shared today becomes unshared", which is now known to be an UNDERSTATEMENT rather than the whole finding. Fusion does not merely preserve sharing; it recovers sharing the closing shift was destroying, because that pass walked `subst`'s result as a tree with no memoisation and rebuilt each shared argument copy separately. Measured: distinct allocations 18,939 → 17,920 and 4,364 → 4,305 with node totals unchanged, of which 82% / 95% is depth-0 inheritance of the caller's own `arg` and the remainder is same-depth multi-occurrence sharing at depth ≥ 1.
- Modify: `crates/redextape-core/examples/blowup_probe.rs`, `crates/redextape-core/examples/guard_hole_probe.rs`, `crates/redextape-core/examples/lambda_sharing_probe.rs` (module and field docs that spell out `beta`)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the lifted-shift `CLOSED 2026-08-02` block's mechanism sentence — *"WHY IT INVERTS, and the direction is forced rather than incidental"* — needs the same rescoping Task 3 gave the design's §2. The roadmap is not wrong about the corpus: it already records the rewrite favouring the corpus 2.16x. It is the generalisation to "forced" that overreaches — Task 3's gate found the family favours `incr` and the corpus favours `occ` on the identical quantity, `Σ reshift` against `Σ per_occ`. Strike and date-replace in house shape; do not touch the corpus figure.)
- Modify: `crates/redextape-core/examples/shift_cost_probe.rs` (the matching module-doc sentence, same wording, under the `# WHY IT INVERTS…` heading. Check the later `# THE TWO FORMULATIONS DISAGREE ABOUT WHICH CORPUS THEY ARE MEASURED ON` section first — Task 1 already added it and it partly re-scopes this claim in-file — then strike and date-replace so the two sections agree instead of contradicting each other.)

**Interfaces:** none — documentation only, no behaviour changes.

- [ ] **Step 1: Enumerate the citations**

Run: `grep -rn "shift(-1, 0" crates/`
Expected: the list above. **Dated design documents under `docs/` are history and are NOT rewritten** — the repo's convention is a struck line with a dated correction block, and the β-fusion design already added one to the zipper design's §5b.

- [ ] **Step 2: Repair `shift`'s doc block in `term.rs`**

The block currently reads *"`d` is signed and only `beta` ever passes a negative one (`shift(-1, 0, …)`, to close the hole after substituting)"*. Replace that clause with:

```rust
/// If a shifted index would go negative. `d` is signed, and **as of β-fusion (2026-08-02) NOTHING IN
/// THIS CRATE PASSES A NEGATIVE ONE.** `beta`'s closing `shift(-1, 0, …)` was the only such caller;
/// `beta_go` decrements in place, at `k > j >= 0`, so the case is now impossible by branch rather than
/// by check. **The assert and the signed `d` stay anyway, and not out of caution:** `shift` is `pub`,
/// `tests/subst_differential.rs` passes negative `d` deliberately, and the failure this guards is a
/// term full of dangling references that reduces to a wrong answer — the arithmetic was
/// `(i64::from(*k) + d) as u32`, which WRAPS. A miscompile is worse than a crash. Narrowing the
/// signature is a separate slice with a public-API survey to do first.
```

Then repair the paragraph below it that argues the invariant holds *"because `subst`'s `j + 1` and this function's `cutoff + 1` step in lockstep under `Abs`"* — that coupling is now internal to `beta_go` and the sentence must say so.

- [ ] **Step 3: Repair the two other `term.rs` sites**

`a_beta_step_is_bounded_by_allocations_not_by_logical_nodes`'s doc opens *"`beta` is `shift(-1, 0, subst(0, shift(1, 0, arg), body))`, and all three of those rebuilt every node they visited"*. That is a statement about the hang's history and stays — mark it as such (`beta was …, when the hang was diagnosed`) rather than deleting it, since the test's whole subject is that history. Check `shift`'s remaining prose for any other claim about `beta`'s shape.

- [ ] **Step 4: Repair `lambda_foreign_reader.rs` §5**

§5 resolves *"WHICH INDEX ARITHMETIC IS THE β RULE?"* with the textbook three-shift formulation and marks it **VERIFIED, all three shifts independently** against `term.rs`. `term.rs` no longer has three shifts. Reword so the section documents **the rule the printed form implies**, which is what a foreign implementer actually needs, and record that the shipped reducer now computes it in one pass — **and that this file deliberately does not**, which is what makes it an independent oracle for the fusion. Keep the three VERIFIED sub-claims; they are still true of the reference implementation in this file.

**Do not change the `FTerm` `beta` itself.** Its being three-pass is the point.

- [ ] **Step 5: Repair `subst_differential.rs` and the three probes**

In `subst_differential.rs`, `shift_additivity_holds_over_every_non_negative_composition`'s doc says *"The reducer's one negative shift (`beta`'s closing `shift(-1, 0, ·)`) is applied after substitution finishes and is composed with nothing"* — the reducer now has none. `the_shipped_subst_shares_the_argument_rather_than_rebuilding_it`'s doc reasons about the closing shift's short-circuit at cutoff 0; check whether its claim still holds and reword.

In `blowup_probe.rs`, `guard_hole_probe.rs` and `lambda_sharing_probe.rs`, repair each spelling of `beta` as three calls. **`lambda_sharing_probe.rs`'s `opening`/`closing` counters keep measuring the three-pass form** — they are what the β-fusion ceiling is computed against — so their docs must say they price the FORMER implementation, not the current one, or the probe starts lying about what it measures.

- [ ] **Step 6: Verify nothing was missed, and that the suite is still green**

Run: `grep -rn "shift(-1, 0" crates/ && cargo test -p redextape-core`
Expected: every remaining hit is either a deliberate historical statement, `tests/lambda_foreign_reader.rs`'s own reference implementation, or `tests/subst_differential.rs`'s `beta_three_pass`. Suite green at the Task 5 total.

- [ ] **Step 7: Commit**

```bash
git add -A crates/redextape-core
git commit -m "docs(lambda): repair every live citation of beta's three passes

Fusion left eleven statements in \`src\`, \`tests\` and \`examples\` describing an
implementation that no longer exists — including \`shift\`'s doc block naming
\`beta\` as its only negative-\`d\` caller, which is now nothing.

\`shift\` keeps the assert and the signed \`d\`: it is \`pub\`, the differential passes
negative \`d\` deliberately, and the failure it guards is a wrapped index rather
than a panic. Narrowing is a separate slice.

\`lambda_foreign_reader.rs\` stays three-pass — that is what makes it an
independent oracle for the fusion — and its §5 now documents the rule the printed
form implies rather than the implementation \`term.rs\` happens to have.

The sharing probe's \`opening\`/\`closing\` counters keep pricing the FORMER
implementation, since that is what the ceiling is computed against, and say so."
```

---

### Task 7: The wall-clock A/B, across two builds

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-lambda-beta-fusion-design.md` (§5's SHIP bar gains its result; §9's predictions are marked hit or missed)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the `DESIGNED … NOT BUILT` block becomes `BUILT`)

**Interfaces:**
- Consumes: Task 5's `beta`.
- Produces: the ship decision and the record.

- [ ] **Step 1: Measure the branch**

Four runs each, same host, `--release`, capped. `git stash` nothing — the tree is the branch.

```bash
for i in 1 2 3 4; do
  systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
    cargo run --release -p redextape-core --example lambda_sharing_probe \
    | grep -E "^Total|replay|corpus"
done | tee "${TMPDIR:-/tmp}/after-corpus.txt"
```

Then the family's reduction ramp (the `secs` column, levels 1–11):

```bash
for i in 1 2 3 4; do
  systemd-run --user --scope -q -p MemoryMax=2G -p MemorySwapMax=0 -- \
    cargo run --release -p redextape-core --example shift_cost_probe
done | tee "${TMPDIR:-/tmp}/after-family.txt"
```

- [ ] **Step 2: Measure `main`, with the probes from this branch**

The comparison needs the *old* `beta` and the *new* probes, or the two builds print different tables. Check out `main`'s `src/lambda/term.rs` alone:

```bash
git checkout main -- crates/redextape-core/src/lambda/term.rs
```

Re-run both loops from Step 1, into `before-corpus.txt` and `before-family.txt`. Then restore:

```bash
git checkout HEAD -- crates/redextape-core/src/lambda/term.rs
git status --short   # expected: clean
```

**`git status` must be clean before continuing.** A stray reverted `term.rs` is a silent un-landing of Task 5.

- [ ] **Step 3: Evaluate against §5's SHIP bar**

- nested groups, levels 1–11: **>= 1.10x**
- 46-program corpus: **>= 1.00x**

Report ranges over the four runs, never point values.

**If the family misses 1.10x and the corpus is flat**, that is §9's third prediction firing — the honest one, named in advance. The slice is a null result: it is written up as the fifth on this thread, the code is reverted, and the counters stay. Do **not** ship a change whose bar it missed because the allocation count looked good; that is precisely the mistake the lifted-shift slice made in the other direction.

- [ ] **Step 4: Record the result in the design**

Under §5's SHIP bar, add a dated block giving both ranges, the per-level family table, and the corpus figure. Then go through §9 and mark each prediction **HIT** or **MISSED** with its number — the discipline the zipper design credits with catching its own error, and the reason §9 was written before the code.

- [ ] **Step 5: Promote the roadmap block**

Rewrite the `#### DESIGNED 2026-08-02, NOT BUILT — β-fusion` heading and body as a `BUILT` (or `FALSIFIED`) block, in the shape of the zipper's, with a measured table: corpus wall-clock range, family range, the gate figure from Task 3, `Σ freevar` as a share, and the worst row. State plainly whichever rows regress.

- [ ] **Step 6: Full suite, one more time**

Run: `cargo test -p redextape-core && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
Expected: green, at the Task 5 running total.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-02-lambda-beta-fusion-design.md \
        docs/superpowers/plans/2026-07-19-redextape-roadmap.md
git commit -m "measure(lambda): β-fusion on the clock — corpus and the nested-group family

Four runs per side, across two builds with the probes held constant. Ranges, not
point values.

§9's predictions are marked hit or missed against the numbers they were written
before, which is the discipline that caught this thread's last two errors."
```

---

## Self-Review

**Spec coverage.** §2 mechanism → Task 5. §2.2/§2.3's invariants are established by the design's own argument (§2 itself) and checked end-to-end by the equivalence differential in Task 4; Tasks 1–2's `spine`/`reshift` assertions are drift guards between two mirror functions, forced true by construction, not a check of these invariants. §2.4's structural claim → Task 5 Step 4 plus Task 6 Step 2. §4's ceiling arithmetic → Tasks 1–2's counters. §5's two-stage bar → Task 3 (counts) and Task 7 (seconds). §6.1 → Task 2, including the explicit refusal to reuse `occ_times_arg`. §6.2's blocking gap → Task 1, first. §6.3's two-build method → Task 7 Steps 1–2. §7's five test items → Task 4 (item 1), Task 6 Step 4 (item 2), Task 5 Step 3 (item 3), Task 5 Step 4 (item 4), Task 6 Step 2 (item 5). §8's non-goals → stated in Task 5's `Interfaces` and Task 6 Step 2. §9's predictions → Task 3 Step 3, Task 7 Steps 3–4.

**Naming consistency.** `beta_allocs_fused(j, s, t) -> (spine, reshift, freevar)` is identical in Tasks 1 and 2. `beta_today` / `beta_fused_incr` / `beta_fused_occ` name the same three totals in both probes. `beta_go(t, j, s)` in Task 5 matches the design's §2 verbatim, including the argument order. `beta_three_pass(body, arg)` is Task 4's and is referenced by Task 5's doc comment under that name.

**Deliberate divergence from the design, recorded rather than silent.** §6.1 says `Work` gains two fields and two totals; Task 2 adds **three** totals, because `beta_today` has to exist as a named quantity for the ratio to mean anything. §6.2's draft said the census's `today()` becomes `opening + spine + reshift + closing`; Task 1 **does not** change `today()` and adds `beta_today()` beside it instead — changing it would move the published 0.99x that the roadmap's falsification block quotes, without adding information. The design's §6.2 has been struck and corrected to match, so the two documents do not disagree. Neither change moves what is measured.
