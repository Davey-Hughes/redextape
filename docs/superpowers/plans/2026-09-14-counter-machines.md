# Counter Machines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every corpus program's stage 1 image as a three-counter machine — accelerated, with its exact literal step count computed rather than taken — held to the Turing machine simulator and the reference interpreter. Separately, fold three counters into two by Gödel numbering, and run that fold literally on toy machines.

**Architecture:** A new `counter` module in `redextape-core`, built in five tasks:
1. `nat.rs`, an in-tree natural number that divides by a fixed divisor through a precomputed reciprocal;
2. `program.rs`, programs written in `Move`, `Stop` and `Spin` macros, each with one literal expansion, plus `accel.rs`, which runs them literally and accelerated;
3. `compile.rs`, a Turing machine to a counter program, plus `readback.rs`, counters back to tapes;
4. the value readback and `tests/counter_oracle.rs`, the oracle leg;
5. `godel.rs`, the two-counter fold on toys.

**Tech Stack:** Rust (`redextape-core`), no new dependency, cargo-nextest for the fast tier, `cargo test --release` through `scripts/check-slow.sh` for the slow tier, the repository's pre-commit gates.

**Spec:** `docs/superpowers/specs/2026-09-14-counter-machines-design.md`, committed at `e4ef974`, with the amendments made while planning left uncommitted in the `counter-machines` worktree. *Decisions and spec corrections found while planning* records the decisions behind them and the corrections still open.

## Global Constraints

- **Files:** `crates/redextape-core/src/lib.rs` (one line), `crates/redextape-core/src/counter.rs`, the six files under `crates/redextape-core/src/counter/`, and `crates/redextape-core/tests/counter_oracle.rs`. Nothing else, and no `Cargo.toml` or `Cargo.lock` change: **no dependency is added.**
- **One public item exists for tests:** `accel::check_literal_agreement`, marked `#[doc(hidden)]`. The compiled toys' unit tests and `tests/counter_oracle.rs` both hold a literal run to an accelerated one through it, and an integration test can reach only public items. It returns an error instead of panicking, because the workspace's clippy lints (`panic`, `unwrap_used`, `expect_used`) forbid panics in library code.
- **File names** match no tracked file, because `scripts/check-attributions.sh` resolves citations by bare filename.
- **Build location:** work in the `counter-machines` worktree, and put `CARGO_TARGET_DIR="$P/target"` on every cargo command and on every `git commit`, because the pre-commit hook runs cargo. Never build into the main checkout's `target/`, and never into `/tmp`.
- **Memory cap:** every test run, suite run, slow-tier run and sabotage run goes under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`. An OOM kill is a result to record, never a reason to raise the cap.
- **Shell:** the Bash tool runs zsh, which passes an unquoted variable as one word where bash would split it. So every command gives each argument as its own word, never through a variable holding several. Each Bash tool call is also a new shell, so the setup below is repeated in every call, and a block that defines a function uses it in the same call.
- **Hooks:** never `git commit --no-verify`. Tracked source may not cite `file:line`; name symbols instead.
- **Staging:** stage files by name, never with `git add -A`.
- No AI or Claude attribution anywhere: code, comments or commit messages.
- The roadmap entry is not part of this plan.
- **Timings are one machine's,** taken while other agents loaded it; the load average is given where it mattered.

## How this plan's code was verified

Every task's end state was built in the scratch worktree `.claude/worktrees/counter-machines-scratch`, on branch `counter-machines-scratch-6`, whose history starts at `e4ef974`. Each was committed there through the unmodified pre-commit hooks before this plan was written, and nothing in this plan's verification used `--no-verify`.

**Tasks 3 to 5 were rebuilt on 2026-09-15, for decision 14.** Tasks 1 and 2 are the commits of the first build, on branch `counter-machines-scratch-5`, and Tasks 3 to 5 were rebuilt on top of them. Every pass/fail expectation in Tasks 3 to 5 was re-run on the rebuilt commits. Where a result changed, the step shows the new one: the diff stats of Tasks 3 and 4, and Task 5 Step 10's S6 row, which recorded one of the two red results proptest can draw. Replaying the patches staged also showed the first version's attribution counts for Tasks 2 and 3 one task behind: 480 and 481, where the gate prints 481 and 483 on both builds. Both are corrected. **The times this plan records were taken on the first build,** at the SHAs they name, and were not retaken.

| task | scratch commit |
| --- | --- |
| 1 | `3a662cb` Add an in-tree natural number with division through a reciprocal |
| 2 | `d438f9e` Add counter programs and run them literally and accelerated |
| 3 | `f5cf15a` Compile a Turing machine to a counter program, and read its tapes back |
| 4 | `3a9af9d` Run the corpus's stage 1 images as counter machines |
| 5 | `936ca8a` Fold three counters into two by Gödel numbering, on toy machines |

**Each task's code below is that commit's `git show --format=` output, embedded verbatim. Apply it; do not retype it.** Each block, expected stat and commit message was compared byte for byte with its commit. The five blocks were also extracted from this file with `block_of` and applied in order, staged and never committed, to a detached `e4ef974` in a throwaway worktree; after each one, `git diff --cached --quiet <that task's commit>` succeeded.

**No step shows a red-first run of a new test,** because the code existed before the plan. Task 5 instead runs seven sabotages on the finished code, each breaking one mechanism, and records which tests go red; what they found is in *Decisions and spec corrections found while planning*.

**The fast-tier commands select tests with a filterset, `-E 'test(/^counter::/) | binary_id(redextape-core::counter_oracle)'`, never with a positional `counter`.** A positional filter applies to the oracle binary's test names too, and `a_lowered_literal_agrees_literally` and `a_lowered_sum_agrees_literally` do not contain `counter`. So a positional filter drops them without a word.

**Baseline:** `cargo nextest run -p redextape-core` at `e4ef974`, under the cap, in a throwaway worktree: `1131 tests run: 1131 passed, 14 skipped`.

Every embedded file sits between a `<!-- BEGIN name -->` line and an `<!-- END name -->` line. Set these at the start of every Bash tool call, before any task's command: each call is a new shell, and neither a variable nor a function survives into the next one.

```bash
P=/home/davey/projects/redextape/.claude/worktrees/counter-machines
PLAN="$P/docs/superpowers/plans/2026-09-14-counter-machines.md"
S=/tmp/claude-1000/-home-davey-projects-redextape/c6a1cf33-0c42-448c-a0ee-76239e25a1eb/scratchpad/counter-exec
mkdir -p "$S"
block_of() { awk -v t="$1" '$0 == "<!-- BEGIN " t " -->" {f = 1; next} $0 == "<!-- END " t " -->" {f = 0} f' "$PLAN" | sed '1d;$d'; }
cap() { systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- "$@"; }
```

`$S` holds only small helper scripts; any directory outside the worktree works.

---

### Task 1: `nat.rs`, an in-tree natural number

**Files:**
- Create: `crates/redextape-core/src/counter.rs` — the module root, declaring only `nat` for now
- Create: `crates/redextape-core/src/counter/nat.rs`
- Modify: `crates/redextape-core/src/lib.rs` — `pub mod counter;`

**What it is, and why it is in the tree.**
- `Nat` is 64-bit limbs, least significant first, with no zero limb at the top. It multiplies-and-adds, adds and divides in place.
- `Divisor` precomputes the reciprocal of a fixed divisor, so `Nat::div_rem` costs a 128-bit multiplication and a few compares per limb: Möller and Granlund's 2-by-1 division, with its first correction as a mask and its second as a branch.
- `num-bigint`, which the spec first chose, divides by a single digit with a hardware `div` on every limb. On the merged `Move` it ran `sum(5)` at stage 1 in 146.9 s, with its division at 55% of the profile of `let x = 40; x + 2`.

**Tests, in `nat.rs`:**
- `operations_agree_with_u128` — addition, multiplication-and-add, division with remainder and bit length equal `u128` arithmetic wherever the result fits.
- `division_inverts_multiplication_on_large_numbers` — on up to 40 limbs, `q·b + r == n` with `r < b`, and `(n·b + s) / b == n` with remainder `s`, for bases including 1, every power of two and `u64::MAX`.
- `addition_commutes_on_large_numbers` and `carries_and_zero_keep_the_representation_normalized`.

**Interfaces:**
- Consumes: nothing.
- Produces, in `crate::counter::nat`:
  - `pub struct Nat`, with `pub const fn zero() -> Nat`, `pub fn is_zero(&self) -> bool`, `pub fn limbs(&self) -> &[u64]`, `pub fn set(&mut self, other: &Nat)`, `pub fn from_limbs(limbs: Vec<u64>) -> Nat`, `pub fn bits(&self) -> u64`, `pub fn mul_add(&mut self, multiplier: u64, addend: u64)`, `pub fn add(&mut self, other: &Nat)` and `pub fn div_rem(&mut self, divisor: &Divisor) -> u64`
  - `impl From<u64> for Nat`, `impl From<u128> for Nat`, `impl TryFrom<&Nat> for u64` and `impl TryFrom<&Nat> for u128`, each with `Error = ()`
  - `pub struct Divisor`, with `pub fn new(base: u64) -> Option<Divisor>`, `None` for zero, and `pub fn base(&self) -> u64`

- [ ] **Step 1: Confirm no code has changed yet**

```bash
git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: `clean`

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task1.patch | git -C "$P" apply --index --check && block_of task1.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/counter.rs     |   6 +
 crates/redextape-core/src/counter/nat.rs | 313 +++++++++++++++++++++++++++++++
 crates/redextape-core/src/lib.rs         |   1 +
 3 files changed, 320 insertions(+)
```

<!-- BEGIN task1.patch -->
````diff
diff --git a/crates/redextape-core/src/counter.rs b/crates/redextape-core/src/counter.rs
new file mode 100644
index 0000000..af8175c
--- /dev/null
+++ b/crates/redextape-core/src/counter.rs
@@ -0,0 +1,6 @@
+//! Counter machines: a program over a handful of unbounded natural-number counters, which is all a
+//! Minsky machine has, and the reduction of a Turing machine to one.
+//!
+//! [`nat`] is the arithmetic the counters need.
+
+pub mod nat;
diff --git a/crates/redextape-core/src/counter/nat.rs b/crates/redextape-core/src/counter/nat.rs
new file mode 100644
index 0000000..b4827ca
--- /dev/null
+++ b/crates/redextape-core/src/counter/nat.rs
@@ -0,0 +1,313 @@
+//! The unbounded natural numbers a counter holds, and the few operations a counter program's accelerated
+//! run and its readback need of them.
+//!
+//! **WHY THIS IS IN THE TREE AND NOT A DEPENDENCY.** A compiled program's counters reach thousands of bits,
+//! and an accelerated run divides them by a divisor that never changes within the program. When every head
+//! move divided a counter by the base with `num-bigint`, that division was 55% of the profile of
+//! `let x = 40; x + 2`'s stage 1 run and `sum(5)` took 146.9 s, because `num-bigint` spends a hardware `div`
+//! on every limb. This module divides through a precomputed reciprocal instead — [`Divisor`] — which is a
+//! multiplication and a few compares per limb, and it works in place on the limbs.
+//!
+//! **THE REPRESENTATION.** A [`Nat`] is its base-2^64 digits, least significant first, with no zero limb
+//! at the top, so zero is the empty vector and two equal numbers have equal limbs. 64-bit limbs halve the
+//! passes 32-bit limbs would take, and `u128` holds every product and every two-limb numerator exactly.
+
+/// An unbounded natural number: its 64-bit limbs, least significant first, with no zero limb at the top.
+#[derive(Clone, Debug, Default, PartialEq, Eq)]
+pub struct Nat {
+    limbs: Vec<u64>,
+}
+
+/// The high and low halves of `x`.
+#[expect(clippy::cast_possible_truncation, reason = "the two halves of a u128 are each exactly 64 bits")]
+fn halves(x: u128) -> (u64, u64) {
+    ((x >> 64) as u64, x as u64)
+}
+
+/// A base to divide by, with its reciprocal: dividing by it takes no hardware division per limb.
+///
+/// The method is Möller and Granlund's 2-by-1 division by an invariant integer ("Improved division by
+/// invariant integers", IEEE Transactions on Computers, 2011, Algorithm 4). The divisor is normalized —
+/// shifted left until its top bit is set — and `reciprocal` is `⌊(2^128 − 1) / normalized⌋ − 2^64`. Each
+/// limb's quotient digit is then estimated by one 128-bit multiplication by the reciprocal and corrected by
+/// at most two compares.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+pub struct Divisor {
+    base: u64,
+    shift: u32,
+    normalized: u64,
+    reciprocal: u64,
+}
+
+impl Divisor {
+    /// The divisor for `base`, or `None` for a base of zero.
+    #[must_use]
+    pub fn new(base: u64) -> Option<Divisor> {
+        if base == 0 {
+            return None;
+        }
+        let shift = base.leading_zeros();
+        let normalized = base << shift;
+        let (high, reciprocal) =
+            halves(((u128::from(!normalized) << 64) | u128::from(u64::MAX)) / u128::from(normalized));
+        (high == 0).then_some(Divisor { base, shift, normalized, reciprocal })
+    }
+
+    /// The base this divides by.
+    #[must_use]
+    pub fn base(&self) -> u64 {
+        self.base
+    }
+
+    /// `(⌊(high·2^64 + low) / normalized⌋, remainder)`, for `high < normalized`.
+    #[inline]
+    fn divide_two_limbs(&self, high: u64, low: u64) -> (u64, u64) {
+        let d = self.normalized;
+        let estimate =
+            (u128::from(self.reciprocal) * u128::from(high)).wrapping_add((u128::from(high) << 64) | u128::from(low));
+        let (q1, q0) = halves(estimate);
+        let mut quotient = q1.wrapping_add(1);
+        let mut remainder = low.wrapping_sub(quotient.wrapping_mul(d));
+        let overshot = u64::from(remainder > q0).wrapping_neg();
+        quotient = quotient.wrapping_add(overshot);
+        remainder = remainder.wrapping_add(overshot & d);
+        if remainder >= d {
+            quotient = quotient.wrapping_add(1);
+            remainder -= d;
+        }
+        (quotient, remainder)
+    }
+}
+
+impl Nat {
+    /// Zero.
+    #[must_use]
+    pub const fn zero() -> Nat {
+        Nat { limbs: Vec::new() }
+    }
+
+    /// Whether this is zero.
+    #[must_use]
+    pub fn is_zero(&self) -> bool {
+        self.limbs.is_empty()
+    }
+
+    /// The limbs, least significant first, with no zero limb at the top.
+    #[must_use]
+    pub fn limbs(&self) -> &[u64] {
+        &self.limbs
+    }
+
+    /// `self = other`, reusing `self`'s allocation.
+    pub fn set(&mut self, other: &Nat) {
+        self.limbs.clone_from(&other.limbs);
+    }
+
+    /// The number whose limbs, least significant first, are `limbs`. Zero limbs at the top are dropped.
+    #[must_use]
+    pub fn from_limbs(mut limbs: Vec<u64>) -> Nat {
+        while limbs.last() == Some(&0) {
+            limbs.pop();
+        }
+        Nat { limbs }
+    }
+
+    /// The number of bits up to and including the highest set bit; zero has none.
+    #[must_use]
+    pub fn bits(&self) -> u64 {
+        match self.limbs.last() {
+            None => 0,
+            Some(top) => {
+                u64::try_from(self.limbs.len()).unwrap_or(u64::MAX).saturating_mul(64) - u64::from(top.leading_zeros())
+            }
+        }
+    }
+
+    /// `self = self·multiplier + addend`, in place.
+    pub fn mul_add(&mut self, multiplier: u64, addend: u64) {
+        let mut carry = addend;
+        for limb in &mut self.limbs {
+            let (high, low) = halves(u128::from(*limb) * u128::from(multiplier) + u128::from(carry));
+            *limb = low;
+            carry = high;
+        }
+        if carry != 0 {
+            self.limbs.push(carry);
+        }
+        if multiplier == 0 {
+            let keep = self.limbs.iter().rposition(|l| *l != 0).map_or(0, |top| top + 1);
+            self.limbs.truncate(keep);
+        }
+    }
+
+    /// `self = self + other`, in place.
+    pub fn add(&mut self, other: &Nat) {
+        if self.limbs.len() < other.limbs.len() {
+            self.limbs.resize(other.limbs.len(), 0);
+        }
+        let mut carry = false;
+        let (low, high) = self.limbs.split_at_mut(other.limbs.len());
+        for (limb, addend) in low.iter_mut().zip(&other.limbs) {
+            let (sum, first) = limb.overflowing_add(*addend);
+            let (sum, second) = sum.overflowing_add(u64::from(carry));
+            *limb = sum;
+            carry = first || second;
+        }
+        for limb in high {
+            if !carry {
+                break;
+            }
+            (*limb, carry) = limb.overflowing_add(1);
+        }
+        if carry {
+            self.limbs.push(1);
+        }
+    }
+
+    /// `self = ⌊self / divisor⌋`, in place, returning `self mod divisor`.
+    pub fn div_rem(&mut self, divisor: &Divisor) -> u64 {
+        let shift = divisor.shift;
+        if shift != 0 {
+            // Divide `self · 2^shift` by the normalized divisor instead: the quotient is the same, and the
+            // remainder comes out multiplied by `2^shift`.
+            let mut carry = 0u64;
+            for limb in &mut self.limbs {
+                let spilled = *limb >> (64 - shift);
+                *limb = (*limb << shift) | carry;
+                carry = spilled;
+            }
+            if carry != 0 {
+                self.limbs.push(carry);
+            }
+        }
+        let mut remainder = 0u64;
+        for limb in self.limbs.iter_mut().rev() {
+            (*limb, remainder) = divisor.divide_two_limbs(remainder, *limb);
+        }
+        while self.limbs.last() == Some(&0) {
+            self.limbs.pop();
+        }
+        remainder >> shift
+    }
+}
+
+impl From<u64> for Nat {
+    fn from(v: u64) -> Nat {
+        Nat::from_limbs(vec![v])
+    }
+}
+
+impl From<u128> for Nat {
+    fn from(v: u128) -> Nat {
+        let (high, low) = halves(v);
+        Nat::from_limbs(vec![low, high])
+    }
+}
+
+impl TryFrom<&Nat> for u64 {
+    type Error = ();
+
+    fn try_from(n: &Nat) -> Result<u64, ()> {
+        match n.limbs[..] {
+            [] => Ok(0),
+            [only] => Ok(only),
+            _ => Err(()),
+        }
+    }
+}
+
+impl TryFrom<&Nat> for u128 {
+    type Error = ();
+
+    fn try_from(n: &Nat) -> Result<u128, ()> {
+        match n.limbs[..] {
+            [] => Ok(0),
+            [low] => Ok(u128::from(low)),
+            [low, high] => Ok((u128::from(high) << 64) | u128::from(low)),
+            _ => Err(()),
+        }
+    }
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use proptest::prelude::*;
+
+    /// Bases worth dividing by: small ones a compiled program uses, powers of two (a shift of 63 down to 0),
+    /// and the largest a `u64` holds.
+    fn base() -> impl Strategy<Value = u64> {
+        prop_oneof![1u64..40, (0u32..64).prop_map(|k| 1u64 << k), any::<u64>().prop_map(|b| b.max(1)), Just(u64::MAX)]
+    }
+
+    proptest! {
+        /// Every operation agrees with `u128` arithmetic wherever the result fits one.
+        #[test]
+        fn operations_agree_with_u128(x in any::<u128>(), y in any::<u128>(), b in base(), small in any::<u32>(), s in any::<u64>()) {
+            let n = Nat::from(x);
+            prop_assert_eq!(u128::try_from(&n), Ok(x));
+            prop_assert_eq!(n.bits(), u64::from(128 - x.leading_zeros()));
+
+            let (half_x, half_y) = (x >> 1, y >> 1);
+            let mut sum = Nat::from(half_x);
+            sum.add(&Nat::from(half_y));
+            prop_assert_eq!(u128::try_from(&sum), Ok(half_x + half_y));
+
+            let d = Divisor::new(b).unwrap();
+            let mut q = Nat::from(x);
+            let r = q.div_rem(&d);
+            prop_assert_eq!((u128::try_from(&q), r), (Ok(x / u128::from(b)), u64::try_from(x % u128::from(b)).unwrap()));
+
+            let narrow = x >> 96;
+            let mut grown = Nat::from(narrow);
+            grown.mul_add(u64::from(small), s);
+            prop_assert_eq!(u128::try_from(&grown), Ok(narrow * u128::from(small) + u128::from(s)));
+        }
+
+        /// On numbers of up to 40 limbs: dividing by `b` gives `q` and `r < b` with `q·b + r` the number, and
+        /// pushing a digit `s < b` then dividing gives the number back with remainder `s`.
+        #[test]
+        fn division_inverts_multiplication_on_large_numbers(limbs in prop::collection::vec(any::<u64>(), 0..40), b in base(), digit in any::<u64>()) {
+            let n = Nat::from_limbs(limbs);
+            let d = Divisor::new(b).unwrap();
+
+            let mut q = n.clone();
+            let r = q.div_rem(&d);
+            prop_assert!(r < b);
+            let mut back = q;
+            back.mul_add(b, r);
+            prop_assert_eq!(&back, &n);
+
+            let s = digit % b;
+            let mut pushed = n.clone();
+            pushed.mul_add(b, s);
+            let popped = pushed.div_rem(&d);
+            prop_assert_eq!((pushed, popped), (n, s));
+        }
+
+        /// Adding in either order gives the same number, and adding zero changes nothing.
+        #[test]
+        fn addition_commutes_on_large_numbers(a in prop::collection::vec(any::<u64>(), 0..40), b in prop::collection::vec(any::<u64>(), 0..40)) {
+            let (a, b) = (Nat::from_limbs(a), Nat::from_limbs(b));
+            let mut ab = a.clone();
+            ab.add(&b);
+            let mut ba = b.clone();
+            ba.add(&a);
+            prop_assert_eq!(&ab, &ba);
+            let mut same = a.clone();
+            same.add(&Nat::zero());
+            prop_assert_eq!(same, a);
+        }
+    }
+
+    /// A carry that runs off the top adds a limb, and multiplying by zero leaves no zero limb behind.
+    #[test]
+    fn carries_and_zero_keep_the_representation_normalized() {
+        let mut all_ones = Nat::from_limbs(vec![u64::MAX, u64::MAX]);
+        all_ones.add(&Nat::from(1u64));
+        assert_eq!(all_ones.limbs(), &[0, 0, 1]);
+        all_ones.mul_add(0, 0);
+        assert!(all_ones.is_zero());
+        assert_eq!(Divisor::new(0), None);
+    }
+}
diff --git a/crates/redextape-core/src/lib.rs b/crates/redextape-core/src/lib.rs
index 1108104..709e2ca 100644
--- a/crates/redextape-core/src/lib.rs
+++ b/crates/redextape-core/src/lib.rs
@@ -17,6 +17,7 @@ pub mod analysis;
 pub mod ast;
 pub mod binder;
 pub mod core;
+pub mod counter;
 pub mod desugar;
 pub mod diagnostic;
 pub mod interp;
````
<!-- END task1.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run this task's tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib counter::nat
```

Expected summary line: `4 tests run: 4 passed, 830 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 480 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `461 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Add an in-tree natural number with division through a reciprocal

The counter module's first piece. Nat holds 64-bit limbs, least
significant first, and multiplies-and-adds, adds and divides in place.
A Divisor precomputes the reciprocal of a fixed base, so dividing a
number by it costs a 128-bit multiplication and a few compares per limb
instead of a hardware div.

No dependency is added. Proptests hold every operation to u128
arithmetic wherever the result fits, and hold q*b + r == n with r < b,
and (n*b + s) / b == n with remainder s, on numbers of up to 40 limbs,
for bases including 1, every power of two and u64::MAX.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 2: `program.rs` and `accel.rs`, programs and their two runs

**Files:**
- Create: `crates/redextape-core/src/counter/program.rs`
- Create: `crates/redextape-core/src/counter/accel.rs`
- Modify: `crates/redextape-core/src/counter.rs` — declare `accel` and `program`

**What changes.**
1. **A program has one base** (`Program::base`, the Turing machine's alphabet size), and is written in three macros:
   - `Move { push, pop, s, exits }`, one head move: `push = b·P + s`, `pop = ⌊Q/b⌋`, then `exits[Q mod b]`.
   - `Stop { state, head }`, which records the halting state and the digits under the heads.
   - `Spin`, which runs forever.
2. **`expand`** derives each macro's single literal expansion. A `Move` is five loops over the scratch counter, `4·b + 4 + s` instructions. `Expansion::leaves` marks the one branch in each loop that leaves the macro, so a literal run tells entering a macro from a move's own loop back to its first instruction — a move may be its own exit.
3. **`move_steps`** writes the move formula plainly: `(b + 3)·(P + ⌊Q/b⌋) + (Q mod b) + s + 4`. `literal_steps` computes through it.
4. **`run_literal`** executes the expansion over `u64` counters, and `run_literal_traced` also records `(macro, steps so far)` at every macro entry.
5. **`run_accelerated`** holds each counter as `hi·b^j + lo`: `lo` a `u64` holding the counter's `j` lowest base-`b` digits, `j` at most the largest `k` with `b^k` in a `u64`. A push or a pop is arithmetic on `lo`; only a full `lo` (flushed into `hi`) or an empty one (refilled from `hi`, dividing by `b^k` through a `Divisor`) passes over the limbs.
6. **The step tally is deferred to match.** Each counted value's `lo` goes into a `u128` at once, and its `b^j` into a per-counter weight that multiplies `hi`; `hi·weight` joins the tally only when `hi` is about to change or a total is read. `run_accelerated_traced` multiplies the tally out at every entry.
7. **Tests:**
   - `a_move_takes_exactly_its_formulas_steps` — a proptest over `P`, `Q`, `b` and `s`, in both directions.
   - `accelerated_and_literal_runs_agree_at_every_macro_entry` — a proptest over a branching program, one of whose moves is its own exit.
   - `buffered_counters_and_their_tally_match_plain_arithmetic` — a proptest over hundreds of moves, over bases whose digit buffer holds 1, 4, 16 or 40 digits, against plain `Nat` arithmetic and `move_steps` summed move by move.
   - The caps, the counter count, `Spin`, and every rule `Program::check` enforces.

**Interfaces:**
- Consumes: Task 1's `Nat` and `Divisor`.
- Produces, in `crate::counter::program`:
  - `pub enum Instr { Inc { c, next }, Dec { c, nonzero, zero }, Stop }`
  - `pub enum Macro { Move { push: usize, pop: usize, s: u64, exits: Vec<usize> }, Stop { state: StateId, head: Vec<usize> }, Spin }`
  - `pub struct Program { counters: usize, scratch: usize, base: u64, macros: Vec<Macro>, start: usize }`, with `pub fn check(&self) -> Result<(), ProgramError>`
  - `pub enum ProgramError { NoSuchMacro { at, target }, NoSuchCounter { at, counter }, Base, Degenerate { at }, TooLarge, CounterCount { expected, got } }`
  - `pub const MAX_LITERAL_INSTRS: usize`, `pub const MAX_BASE: u64`
  - `pub fn literal_len(m: &Macro, base: u64) -> Option<usize>`
  - `pub fn move_steps(base: u64, s: u64, pushed: &Nat, quotient: &Nat, digit: u64) -> Option<Nat>`
  - `pub fn literal_steps(m: &Macro, base: u64, pushed: &Nat, popped: &Nat) -> Option<Nat>`
  - `pub struct Expansion { instrs: Vec<Instr>, first: Vec<usize>, owner: Vec<usize>, leaves: Vec<bool> }`, and `pub fn expand(p: &Program) -> Result<Expansion, ProgramError>`
- Produces, in `crate::counter::accel`:
  - `pub enum LiteralEnd { Stopped { at }, StepCap, CounterOverflow, Malformed }`, `pub struct LiteralRun { end, counters: Vec<u64>, steps: u64 }`
  - `pub fn run_literal(instrs: &[Instr], counters: Vec<u64>, start: usize, max_steps: u64) -> LiteralRun`
  - `pub fn run_literal_traced(e: &Expansion, counters: Vec<u64>, start: usize, max_steps: u64, trace: &mut Vec<(usize, u64)>) -> LiteralRun`
  - `pub struct Caps { macros: u64, bits: u64 }`, `pub enum End { Stopped { at }, Spun { at }, MacroCap, BitCap }`
  - `pub struct Run { end: End, counters: Vec<Nat>, steps: Nat, macros: u64, largest_bits: u64 }`
  - `pub fn run_accelerated(p: &Program, counters: Vec<Nat>, caps: Caps) -> Result<Run, ProgramError>`
  - `pub fn run_accelerated_traced(p: &Program, counters: Vec<Nat>, caps: Caps, trace: &mut Vec<(usize, Nat)>) -> Result<Run, ProgramError>`

- [ ] **Step 1: Confirm Task 1 is the last commit and nothing is pending**

```bash
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: Task 1's commit subject, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task2.patch | git -C "$P" apply --index --check && block_of task2.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/counter.rs         |   9 +
 crates/redextape-core/src/counter/accel.rs   | 484 +++++++++++++++++++++++++++
 crates/redextape-core/src/counter/program.rs | 357 ++++++++++++++++++++
 3 files changed, 850 insertions(+)
```

<!-- BEGIN task2.patch -->
````diff
diff --git a/crates/redextape-core/src/counter.rs b/crates/redextape-core/src/counter.rs
index af8175c..57fbd0d 100644
--- a/crates/redextape-core/src/counter.rs
+++ b/crates/redextape-core/src/counter.rs
@@ -1,6 +1,15 @@
 //! Counter machines: a program over a handful of unbounded natural-number counters, which is all a
 //! Minsky machine has, and the reduction of a Turing machine to one.
 //!
+//! **TWO LEVELS, ONE MEANING.** A [`program::Program`] is written in macros, and every macro has exactly
+//! one literal expansion into the `Inc`/`Dec`/`Stop` instructions a textbook counter machine runs, with an
+//! exact count of the literal steps that expansion takes. [`accel`] runs a program both ways: literally, one
+//! instruction at a time, and accelerated, where each macro is arithmetic on the counters' values and its step
+//! count is computed from its formula. **An accelerated run computes its literal step count; it does not take those
+//! steps**, and nothing that reports one may say otherwise.
+//!
 //! [`nat`] is the arithmetic the counters need.
 
+pub mod accel;
 pub mod nat;
+pub mod program;
diff --git a/crates/redextape-core/src/counter/accel.rs b/crates/redextape-core/src/counter/accel.rs
new file mode 100644
index 0000000..b4af574
--- /dev/null
+++ b/crates/redextape-core/src/counter/accel.rs
@@ -0,0 +1,484 @@
+//! Running a counter program, two ways.
+//!
+//! * **Literally** — [`run_literal`] executes `Inc`, `Dec` and `Stop` one at a time over `u64` counters.
+//!   It is the counter machine itself, and it is only affordable for toys and small programs.
+//! * **Accelerated** — [`run_accelerated`] executes each move as arithmetic on the counters' values and
+//!   counts its literal steps by `program.rs`'s `move_steps` formula, kept in a deferred shape. **The count is
+//!   computed, not taken:** a stage 1 image of `3 - 5` reports about 10^380 literal steps.
+//!
+//! **THE TWO ARE HELD TO EACH OTHER BY A TRACE.** Both can record `(macro, literal steps so far)` each time
+//! a macro is entered. A literal run of a program's expansion and an accelerated run of its macros agree on
+//! that pair at every entry, on the counters, and on where they stop, or one of them is wrong.
+//!
+//! **A COUNTER KEEPS ITS LOWEST DIGITS OUT OF ITS LIMBS.** A head move multiplies one counter by the base
+//! and divides another, which over [`Nat`] limbs is a pass over every limb of both — and a stage 1 image's
+//! counters run to thousands of bits. So an accelerated run holds a counter as `hi·b^j + lo`, with `lo` a
+//! `u64` holding its `j` lowest base-`b` digits, `j` at most the largest `k` for which `b^k` fits a `u64`:
+//! 16 for base 15. A push or a pop is then arithmetic on `lo`, and only a full `lo` (flushed into `hi`) or an
+//! empty one (refilled from `hi`, dividing by `b^k` through a `Divisor`) passes over the limbs — about once
+//! every `k` moves of that counter. Measured on `sum(5)`'s stage 1 image while this was planned, it took the
+//! run from 110.2 s, with a limb pass on every move, to 18.0 s.
+//!
+//! **THE TALLY IS DEFERRED THE SAME WAY.** The steps of a move are `(b + 3)·(P + ⌊Q/b⌋) + (Q mod b) + s + 4`
+//! for `P` the value pushed onto and `⌊Q/b⌋` the value left after the pop — two counter values. A counter's
+//! value `hi·b^j + lo` contributes `lo` to a `u128` sum at once, and `b^j` to a per-counter `weight` that
+//! multiplies its `hi`; `hi·weight` is added to the tally only when `hi` is about to change, or when a total
+//! is read.
+
+use crate::counter::nat::{Divisor, Nat};
+use crate::counter::program::{Expansion, Instr, Macro, Program, ProgramError};
+
+/// Why a literal run stopped.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+pub enum LiteralEnd {
+    /// It reached the `Stop` instruction at index `at`.
+    Stopped { at: usize },
+    /// It took the step budget without stopping.
+    StepCap,
+    /// An `Inc` would have taken a counter past `u64::MAX`.
+    CounterOverflow,
+    /// An instruction named an instruction or a counter that does not exist.
+    Malformed,
+}
+
+/// A finished literal run: why it ended, the counters then, and the steps it took.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub struct LiteralRun {
+    pub end: LiteralEnd,
+    pub counters: Vec<u64>,
+    pub steps: u64,
+}
+
+/// Run `instrs` literally from instruction `start`, for at most `max_steps` steps. Every `Inc` and every
+/// `Dec` is one step; `Stop` is not.
+#[must_use]
+pub fn run_literal(instrs: &[Instr], counters: Vec<u64>, start: usize, max_steps: u64) -> LiteralRun {
+    literal(instrs, counters, start, max_steps, None)
+}
+
+/// [`run_literal`] over `e`, also pushing `(macro, steps so far)` onto `trace` at the start and each time
+/// the run leaves a macro for the one it enters — the literal side of the agreement trace.
+#[must_use]
+pub fn run_literal_traced(
+    e: &Expansion,
+    counters: Vec<u64>,
+    start: usize,
+    max_steps: u64,
+    trace: &mut Vec<(usize, u64)>,
+) -> LiteralRun {
+    if let Some(&entered) = e.owner.get(start) {
+        trace.push((entered, 0));
+    }
+    literal(&e.instrs, counters, start, max_steps, Some((e, trace)))
+}
+
+fn literal(
+    instrs: &[Instr],
+    mut counters: Vec<u64>,
+    start: usize,
+    max_steps: u64,
+    mut tracer: Option<(&Expansion, &mut Vec<(usize, u64)>)>,
+) -> LiteralRun {
+    let mut pc = start;
+    let mut steps = 0u64;
+    let end = loop {
+        let Some(instr) = instrs.get(pc) else { break LiteralEnd::Malformed };
+        let from = pc;
+        let exit_branch = match *instr {
+            Instr::Stop => break LiteralEnd::Stopped { at: pc },
+            _ if steps >= max_steps => break LiteralEnd::StepCap,
+            Instr::Inc { c, next } => {
+                let Some(slot) = counters.get_mut(c) else { break LiteralEnd::Malformed };
+                let Some(v) = slot.checked_add(1) else { break LiteralEnd::CounterOverflow };
+                *slot = v;
+                pc = next;
+                true
+            }
+            Instr::Dec { c, nonzero, zero } => {
+                let Some(slot) = counters.get_mut(c) else { break LiteralEnd::Malformed };
+                if *slot == 0 {
+                    pc = zero;
+                    true
+                } else {
+                    *slot -= 1;
+                    pc = nonzero;
+                    false
+                }
+            }
+        };
+        steps += 1;
+        if let Some((e, trace)) = tracer.as_mut()
+            && exit_branch
+            && e.leaves.get(from) == Some(&true)
+        {
+            let Some(&entered) = e.owner.get(pc) else { break LiteralEnd::Malformed };
+            trace.push((entered, steps));
+        }
+    };
+    LiteralRun { end, counters, steps }
+}
+
+/// The budgets of an accelerated run: macros executed, and the bit length a counter may reach.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+pub struct Caps {
+    pub macros: u64,
+    pub bits: u64,
+}
+
+/// Why an accelerated run stopped.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+pub enum End {
+    /// It reached the [`Macro::Stop`] at index `at`.
+    Stopped { at: usize },
+    /// It reached the [`Macro::Spin`] at index `at`, which never ends.
+    Spun { at: usize },
+    /// It executed [`Caps::macros`] macros without stopping.
+    MacroCap,
+    /// A counter grew past [`Caps::bits`] bits.
+    BitCap,
+}
+
+/// A finished accelerated run.
+///
+/// `steps` is the number of literal steps the run stands for, COMPUTED from each move's formula — the
+/// literal machine was not run. `macros` is how many macros were executed.
+///
+/// `largest_bits` is the bit length of the largest value a counter held at the start, when its lowest digits
+/// were flushed into its limbs, and at the end. Between flushes a counter gains at most `k` digits with `b^k`
+/// in a `u64`, so this is below the true peak by at most 65 bits; [`End::BitCap`] is checked against it.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub struct Run {
+    pub end: End,
+    pub counters: Vec<Nat>,
+    pub steps: Nat,
+    pub macros: u64,
+    pub largest_bits: u64,
+}
+
+/// Run `p` accelerated from its start, on `counters`.
+///
+/// # Errors
+///
+/// [`Program::check`]'s, or [`ProgramError::CounterCount`] when `counters` does not hold `p.counters`
+/// values.
+pub fn run_accelerated(p: &Program, counters: Vec<Nat>, caps: Caps) -> Result<Run, ProgramError> {
+    accelerate(p, counters, caps, None)
+}
+
+/// [`run_accelerated`], also pushing `(macro, literal steps so far)` onto `trace` on entry to every macro
+/// the run reaches — the accelerated side of the agreement trace. The tally is multiplied out at every
+/// entry, which a run without a trace never pays.
+///
+/// # Errors
+///
+/// As [`run_accelerated`].
+pub fn run_accelerated_traced(
+    p: &Program,
+    counters: Vec<Nat>,
+    caps: Caps,
+    trace: &mut Vec<(usize, Nat)>,
+) -> Result<Run, ProgramError> {
+    accelerate(p, counters, caps, Some(trace))
+}
+
+/// One counter during an accelerated run: the value `hi·b^digits + lo`, with `lo < b^digits`, and `weight`,
+/// the sum of `b^digits` over the times its value was counted since `hi` last changed.
+struct Counter {
+    hi: Nat,
+    lo: u64,
+    digits: usize,
+    weight: u64,
+}
+
+/// An accelerated run's counters and its deferred tally of `Σ(P + ⌊Q/b⌋)` and `Σ((Q mod b) + s + 4)`.
+struct Buffers {
+    base: u64,
+    /// `powers[j] = base^j` for `j` up to the digits `lo` holds, `powers.len() - 1`.
+    powers: Vec<u64>,
+    by_block: Divisor,
+    counters: Vec<Counter>,
+    /// The counted values' `hi·weight` parts already added up.
+    folded: Nat,
+    /// The counted values' `lo` parts not yet in `folded`.
+    lows: u128,
+    /// `Σ((Q mod b) + s + 4)`, which is not multiplied by `b + 3`.
+    loose: u128,
+    spare: Nat,
+    largest_bits: u64,
+}
+
+impl Buffers {
+    fn new(base: u64, values: Vec<Nat>) -> Option<Buffers> {
+        let mut powers = vec![1u64];
+        while powers.len() <= 64 {
+            let Some(next) = powers.last().and_then(|p| p.checked_mul(base)) else { break };
+            powers.push(next);
+        }
+        let by_block = Divisor::new(*powers.last()?)?;
+        let largest_bits = values.iter().map(Nat::bits).max().unwrap_or(0);
+        let counters = values.into_iter().map(|hi| Counter { hi, lo: 0, digits: 0, weight: 0 }).collect();
+        Some(Buffers {
+            base,
+            powers,
+            by_block,
+            counters,
+            folded: Nat::zero(),
+            lows: 0,
+            loose: 0,
+            spare: Nat::zero(),
+            largest_bits,
+        })
+    }
+
+    fn block(&self) -> usize {
+        self.powers.len() - 1
+    }
+
+    /// Add counter `c`'s `hi·weight` to the tally and zero its weight — due before `hi` changes.
+    fn fold(&mut self, c: usize) {
+        let Buffers { counters, folded, spare, .. } = self;
+        if let Some(counter) = counters.get_mut(c)
+            && counter.weight != 0
+        {
+            spare.set(&counter.hi);
+            spare.mul_add(counter.weight, 0);
+            folded.add(spare);
+            counter.weight = 0;
+        }
+    }
+
+    /// Count counter `c`'s current value into `Σ(P + ⌊Q/b⌋)`.
+    fn count(&mut self, c: usize) {
+        let Some((digits, lo)) = self.counters.get(c).map(|k| (k.digits, k.lo)) else { return };
+        let power = self.powers.get(digits).copied().unwrap_or(0);
+        if self.counters.get(c).is_some_and(|k| k.weight.checked_add(power).is_none()) {
+            self.fold(c);
+        }
+        if let Some(k) = self.counters.get_mut(c) {
+            k.weight += power;
+        }
+        if let Some(sum) = self.lows.checked_add(u128::from(lo)) {
+            self.lows = sum;
+        } else {
+            self.folded.add(&Nat::from(self.lows));
+            self.lows = u128::from(lo);
+        }
+    }
+
+    /// Remove counter `c`'s lowest digit, refilling `lo` from `hi` when it is empty.
+    fn pop(&mut self, c: usize) -> u64 {
+        if self.counters.get(c).is_some_and(|k| k.digits == 0) {
+            self.fold(c);
+            let block = self.block();
+            if let Some(k) = self.counters.get_mut(c) {
+                k.lo = k.hi.div_rem(&self.by_block);
+                k.digits = block;
+            }
+        }
+        let Some(k) = self.counters.get_mut(c) else { return 0 };
+        let digit = k.lo % self.base;
+        k.lo /= self.base;
+        k.digits -= 1;
+        digit
+    }
+
+    /// Make `s` counter `c`'s lowest digit, flushing `lo` into `hi` when it is full.
+    fn push(&mut self, c: usize, s: u64) {
+        let block = self.block();
+        if self.counters.get(c).is_some_and(|k| k.digits == block) {
+            self.fold(c);
+            let scale = self.powers.get(block).copied().unwrap_or(1);
+            if let Some(k) = self.counters.get_mut(c) {
+                k.hi.mul_add(scale, k.lo);
+                k.lo = 0;
+                k.digits = 0;
+                self.largest_bits = self.largest_bits.max(k.hi.bits());
+            }
+        }
+        if let Some(k) = self.counters.get_mut(c) {
+            k.lo = k.lo * self.base + s;
+            k.digits += 1;
+        }
+    }
+
+    /// The exact literal steps counted so far.
+    fn total(&self) -> Nat {
+        let mut sum = self.folded.clone();
+        for k in &self.counters {
+            let mut part = k.hi.clone();
+            part.mul_add(k.weight, 0);
+            sum.add(&part);
+        }
+        sum.add(&Nat::from(self.lows));
+        sum.mul_add(self.base + 3, 0);
+        sum.add(&Nat::from(self.loose));
+        sum
+    }
+
+    /// Every counter's value.
+    fn values(&self) -> Vec<Nat> {
+        self.counters
+            .iter()
+            .map(|k| {
+                let mut v = k.hi.clone();
+                v.mul_add(self.powers.get(k.digits).copied().unwrap_or(1), k.lo);
+                v
+            })
+            .collect()
+    }
+}
+
+fn accelerate(
+    p: &Program,
+    counters: Vec<Nat>,
+    caps: Caps,
+    mut trace: Option<&mut Vec<(usize, Nat)>>,
+) -> Result<Run, ProgramError> {
+    p.check()?;
+    if counters.len() != p.counters {
+        return Err(ProgramError::CounterCount { expected: p.counters, got: counters.len() });
+    }
+    let mut run = Buffers::new(p.base, counters).ok_or(ProgramError::Base)?;
+    let mut pc = p.start;
+    let mut executed = 0u64;
+    let end = loop {
+        if let Some(trace) = trace.as_mut() {
+            trace.push((pc, run.total()));
+        }
+        let m = p.macros.get(pc).ok_or(ProgramError::NoSuchMacro { at: pc, target: pc })?;
+        let Macro::Move { push, pop, s, exits } = m else {
+            break if matches!(m, Macro::Spin) { End::Spun { at: pc } } else { End::Stopped { at: pc } };
+        };
+        if executed >= caps.macros {
+            break End::MacroCap;
+        }
+        let digit = run.pop(*pop);
+        run.count(*push);
+        run.count(*pop);
+        run.loose += u128::from(digit) + u128::from(*s) + 4;
+        run.push(*push, *s);
+        executed += 1;
+        pc = *usize::try_from(digit).ok().and_then(|d| exits.get(d)).ok_or(ProgramError::Degenerate { at: pc })?;
+        if run.largest_bits > caps.bits {
+            break End::BitCap;
+        }
+    };
+    let values = run.values();
+    let largest_bits = values.iter().map(Nat::bits).fold(run.largest_bits, u64::max);
+    Ok(Run { end, steps: run.total(), counters: values, macros: executed, largest_bits })
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use crate::counter::program::{expand, move_steps};
+    use proptest::prelude::*;
+
+    const WIDE: Caps = Caps { macros: 1_000_000, bits: 1 << 20 };
+
+    /// Moves in both directions, with and without a digit, one of them its own exit, over base 3. Macro 0
+    /// loops on itself while the digit it removes from `c1` is 2, which ends because `c1` shrinks; the rest
+    /// only go forward, to one of two `Stop`s. Counter `c2` is scratch.
+    fn branching() -> Program {
+        let mv = |push: usize, pop: usize, s: u64, exits: Vec<usize>| Macro::Move { push, pop, s, exits };
+        Program {
+            counters: 3,
+            scratch: 2,
+            base: 3,
+            start: 0,
+            macros: vec![
+                mv(0, 1, 2, vec![1, 2, 0]),
+                mv(1, 0, 0, vec![2, 3, 4]),
+                mv(1, 0, 1, vec![3, 4, 3]),
+                Macro::Stop { state: 0, head: vec![] },
+                Macro::Stop { state: 1, head: vec![] },
+            ],
+        }
+    }
+
+    proptest! {
+        /// At every macro entry, a literal run of the expansion and an accelerated run of the macros report
+        /// the same macro and the same literal steps so far; they stop at the same `Stop`, with the same
+        /// counters, after the same number of literal steps.
+        #[test]
+        fn accelerated_and_literal_runs_agree_at_every_macro_entry(c0 in 0u64..60, c1 in 0u64..200) {
+            let p = branching();
+            let mut fast = Vec::new();
+            let run = run_accelerated_traced(&p, vec![c0.into(), c1.into(), Nat::zero()], WIDE, &mut fast).unwrap();
+            let End::Stopped { at } = run.end else { panic!("did not stop: {:?}", run.end) };
+
+            let e = expand(&p).unwrap();
+            let mut slow = Vec::new();
+            let lit = run_literal_traced(&e, vec![c0, c1, 0], e.first[p.start], 1 << 40, &mut slow);
+            let LiteralEnd::Stopped { at: lit_at } = lit.end else { panic!("did not stop: {:?}", lit.end) };
+
+            prop_assert_eq!(e.owner[lit_at], at);
+            prop_assert_eq!(Nat::from(lit.steps), run.steps);
+            let counters: Vec<Nat> = lit.counters.into_iter().map(Nat::from).collect();
+            prop_assert_eq!(counters, run.counters);
+            let slow: Vec<(usize, Nat)> = slow.into_iter().map(|(m, s)| (m, Nat::from(s))).collect();
+            prop_assert_eq!(slow, fast);
+        }
+
+        /// Many moves between two counters, over bases whose digit buffer holds 1, 4, 16 or 40 digits, so
+        /// they flush and refill often: the buffered counters keep the values plain arithmetic on each counter
+        /// gives, and the deferred tally equals `move_steps` summed move by move.
+        #[test]
+        fn buffered_counters_and_their_tally_match_plain_arithmetic(
+            start in prop::collection::vec(prop::collection::vec(any::<u64>(), 0..6), 2..3),
+            moves in prop::collection::vec((any::<bool>(), any::<u64>()), 0..300),
+            base in prop_oneof![Just(1u64 << 32), Just(65_521u64), Just(15u64), Just(3u64)],
+        ) {
+            let values: Vec<Nat> = start.into_iter().map(Nat::from_limbs).collect();
+            let mut plain = values.clone();
+            let mut plain_steps = Nat::zero();
+            let divisor = Divisor::new(base).unwrap();
+            let mut run = Buffers::new(base, values).unwrap();
+            for (rightward, s) in moves {
+                let (push, pop) = if rightward { (0, 1) } else { (1, 0) };
+                let s = s % base;
+                let digit = run.pop(pop);
+                run.count(push);
+                run.count(pop);
+                run.loose += u128::from(digit) + u128::from(s) + 4;
+                run.push(push, s);
+
+                let want_digit = plain[pop].div_rem(&divisor);
+                prop_assert_eq!(digit, want_digit);
+                plain_steps.add(&move_steps(base, s, &plain[push], &plain[pop], want_digit).unwrap());
+                plain[push].mul_add(base, s);
+            }
+            prop_assert_eq!(run.values(), plain);
+            prop_assert_eq!(run.total(), plain_steps);
+        }
+    }
+
+    /// The macro budget stops a run before it executes a macro past it, and the bit budget stops one once a
+    /// counter grows past it.
+    #[test]
+    fn each_cap_stops_the_run_that_reaches_it() {
+        let run =
+            run_accelerated(&branching(), vec![7u64.into(), 1u64.into(), Nat::zero()], Caps { macros: 1, bits: 64 });
+        assert_eq!(run.map(|r| (r.end, r.macros)), Ok((End::MacroCap, 1)));
+
+        let growing = Program {
+            counters: 3,
+            scratch: 2,
+            base: 1000,
+            start: 0,
+            macros: vec![Macro::Move { push: 0, pop: 1, s: 999, exits: vec![0; 1000] }],
+        };
+        let run =
+            run_accelerated(&growing, vec![1u64.into(), Nat::zero(), Nat::zero()], Caps { macros: 100, bits: 40 });
+        let run = run.unwrap();
+        assert_eq!(run.end, End::BitCap);
+        assert!(run.largest_bits > 40, "{}", run.largest_bits);
+    }
+
+    /// A counter vector of the wrong length is refused rather than indexed past.
+    #[test]
+    fn a_counter_vector_of_the_wrong_length_is_refused() {
+        let got = run_accelerated(&branching(), vec![Nat::zero(); 2], WIDE);
+        assert_eq!(got, Err(ProgramError::CounterCount { expected: 3, got: 2 }));
+    }
+}
diff --git a/crates/redextape-core/src/counter/program.rs b/crates/redextape-core/src/counter/program.rs
new file mode 100644
index 0000000..b5b0316
--- /dev/null
+++ b/crates/redextape-core/src/counter/program.rs
@@ -0,0 +1,357 @@
+//! What a counter program is made of: the literal instructions, the macros a compiled program is written
+//! in, each macro's single literal expansion, and the exact number of literal steps it takes.
+//!
+//! **A MACRO IS EMITTED, NEVER RECOGNISED.** Acceleration does not look for loops in literal code that
+//! happen to transfer or divide. A program is macros from the start, and its literal form is DERIVED from
+//! them by [`expand`], so the thing accelerated and the thing it stands for cannot disagree about which
+//! instructions a macro means. What they can still disagree about is the step count, and that is what the
+//! tests below hold: each macro's [`literal_steps`] against a literal run of its expansion.
+//!
+//! **ONE MACRO PER HEAD MOVE.** Between halts a compiled Turing machine does nothing but move heads, so
+//! [`Macro::Move`] is the whole of its work. Its expansion is the transfer, add and divide loops a head move
+//! takes when each is written out. They were three separate macros first; merging them left one macro per
+//! move for an accelerated run to execute.
+
+use crate::counter::nat::{Divisor, Nat};
+use crate::tm::machine::StateId;
+
+/// One literal instruction. A counter machine in the textbook sense is a list of these and nothing else.
+#[derive(Clone, Copy, Debug, PartialEq, Eq)]
+pub enum Instr {
+    /// Add one to counter `c`, then go to `next`.
+    Inc { c: usize, next: usize },
+    /// If counter `c` is zero, go to `zero`; otherwise subtract one from it and go to `nonzero`.
+    Dec { c: usize, nonzero: usize, zero: usize },
+    /// Halt. Halting is not a step.
+    Stop,
+}
+
+/// One macro.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub enum Macro {
+    /// One head move, over base-`b` numbers whose least significant digit is the cell nearest the head,
+    /// with `b` the program's [`Program::base`]: make `s` the new least significant digit of counter `push`,
+    /// remove the least significant digit of counter `pop`, and go to `exits[the digit removed]`. See
+    /// [`move_steps`] for its step count.
+    Move { push: usize, pop: usize, s: u64, exits: Vec<usize> },
+    /// Halt, recording the Turing machine state the compiled machine halted in and the digit under each
+    /// of its heads, which a readback needs and the counters do not hold.
+    Stop { state: StateId, head: Vec<usize> },
+    /// Run forever: the Turing machine this program was compiled from reached a cycle of rules that never
+    /// move a head.
+    Spin,
+}
+
+/// A counter program: `counters` counters, the base every move uses, the macros, and the macro execution
+/// starts at.
+///
+/// `scratch` names the counter a program uses only inside a macro. [`Macro::Move`] holds a copy there while
+/// it runs, so it is zero between macros, and [`Macro::Spin`]'s literal expansion loops on it without
+/// changing anything.
+///
+/// **ONE BASE PER PROGRAM.** A compiled program's base is its Turing machine's alphabet size, which never
+/// changes, so it is stated once: an accelerated run computes its reciprocal once, and a step count folds
+/// with one multiplier.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub struct Program {
+    pub counters: usize,
+    pub scratch: usize,
+    pub base: u64,
+    pub macros: Vec<Macro>,
+    pub start: usize,
+}
+
+/// Why a program cannot be run or expanded.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub enum ProgramError {
+    /// `start` or an exit names no macro.
+    NoSuchMacro { at: usize, target: usize },
+    /// A macro names a counter past `counters`, or `scratch` is past it.
+    NoSuchCounter { at: usize, counter: usize },
+    /// The base is zero or past [`MAX_BASE`].
+    Base,
+    /// A move's own parameters make it meaningless: a digit `s` that is not below the base, `push` and `pop`
+    /// the same counter or either of them the scratch counter, or an exit count that is not the base.
+    Degenerate { at: usize },
+    /// The literal expansion would hold more than [`MAX_LITERAL_INSTRS`] instructions.
+    TooLarge,
+    /// A run was given `got` counters for a program of `expected`.
+    CounterCount { expected: usize, got: usize },
+}
+
+/// The most literal instructions [`expand`] builds. A literal run is for toys and small programs; a
+/// compiled program large enough to reach this is run accelerated.
+pub const MAX_LITERAL_INSTRS: usize = 50_000_000;
+
+/// The largest base a program may use. A base is an alphabet size, so this is far past any machine's, and it
+/// keeps `b + 3` and `4·b + 4 + s` inside a `u64`.
+pub const MAX_BASE: u64 = 1 << 32;
+
+impl Program {
+    /// Every structural rule [`ProgramError`] names.
+    ///
+    /// # Errors
+    ///
+    /// The first rule this program breaks.
+    pub fn check(&self) -> Result<(), ProgramError> {
+        let n = self.macros.len();
+        if self.base == 0 || self.base > MAX_BASE {
+            return Err(ProgramError::Base);
+        }
+        if self.start >= n {
+            return Err(ProgramError::NoSuchMacro { at: usize::MAX, target: self.start });
+        }
+        if self.scratch >= self.counters {
+            return Err(ProgramError::NoSuchCounter { at: usize::MAX, counter: self.scratch });
+        }
+        for (at, m) in self.macros.iter().enumerate() {
+            let Macro::Move { push, pop, s, exits } = m else { continue };
+            for counter in [*push, *pop] {
+                if counter >= self.counters {
+                    return Err(ProgramError::NoSuchCounter { at, counter });
+                }
+            }
+            let shape = *s >= self.base
+                || push == pop
+                || [*push, *pop].contains(&self.scratch)
+                || u64::try_from(exits.len()).ok() != Some(self.base);
+            if shape {
+                return Err(ProgramError::Degenerate { at });
+            }
+            if let Some(&target) = exits.iter().find(|&&t| t >= n) {
+                return Err(ProgramError::NoSuchMacro { at, target });
+            }
+        }
+        Ok(())
+    }
+}
+
+/// How many literal instructions `m`'s expansion holds over `base`, or `None` when that does not fit a
+/// `usize`.
+#[must_use]
+pub fn literal_len(m: &Macro, base: u64) -> Option<usize> {
+    match m {
+        Macro::Move { s, .. } => usize::try_from(base.checked_mul(4)?.checked_add(4)?.checked_add(*s)?).ok(),
+        Macro::Stop { .. } | Macro::Spin => Some(1),
+    }
+}
+
+/// The literal steps of one [`Macro::Move`] over `base`, pushing digit `s` onto a counter holding `pushed`,
+/// when dividing the popped counter by the base gave `quotient` and `digit`; `None` for a base past
+/// [`MAX_BASE`].
+///
+/// Following [`expand`]'s five loops, with `P = pushed` and `Q = quotient·b + digit` the popped value,
+///
+/// > `(2·P + 1) + ((b + 1)·P + 1) + s + (Q + ⌊Q/b⌋ + 1) + (2·⌊Q/b⌋ + 1)`
+/// > `= (b + 3)·P + s + Q + 3·⌊Q/b⌋ + 4`
+/// > `= (b + 3)·(P + ⌊Q/b⌋) + (Q mod b) + s + 4`.
+///
+/// **THE FORMULA, WRITTEN PLAINLY.** [`literal_steps`] computes through it, and the tests below hold it to a
+/// literal run of the expansion. The accelerated run cannot afford to call it — it keeps the same sum in a
+/// deferred shape of its own — so `accel.rs`'s tests hold that tally to this function, move by move.
+#[must_use]
+pub fn move_steps(base: u64, s: u64, pushed: &Nat, quotient: &Nat, digit: u64) -> Option<Nat> {
+    if base > MAX_BASE {
+        return None;
+    }
+    let mut steps = pushed.clone();
+    steps.add(quotient);
+    steps.mul_add(base + 3, 0);
+    steps.add(&Nat::from(u128::from(digit) + u128::from(s) + 4));
+    Some(steps)
+}
+
+/// The literal steps `m`'s expansion takes over `base` when its `push` counter holds `pushed` and its `pop`
+/// counter holds `popped`, or `None` for [`Macro::Spin`], which never finishes, and for a base of zero or
+/// past [`MAX_BASE`]. A [`Macro::Stop`] takes none: halting is not a step.
+#[must_use]
+pub fn literal_steps(m: &Macro, base: u64, pushed: &Nat, popped: &Nat) -> Option<Nat> {
+    match m {
+        Macro::Move { s, .. } => {
+            let mut quotient = popped.clone();
+            let digit = quotient.div_rem(&Divisor::new(base)?);
+            move_steps(base, *s, pushed, &quotient, digit)
+        }
+        Macro::Stop { .. } => Some(Nat::zero()),
+        Macro::Spin => None,
+    }
+}
+
+/// A program's literal form: the instructions, the first instruction of each macro, the macro each
+/// instruction came from, and which instructions leave their macro.
+///
+/// `leaves[i]` says that instruction `i`'s way out of its macro is taken: an `Inc`'s `next`, or a `Dec`'s
+/// `zero` branch. It is how a literal run tells entering a macro from a macro's own loop back to its first
+/// instruction, which a move that is its own exit also looks like.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub struct Expansion {
+    pub instrs: Vec<Instr>,
+    pub first: Vec<usize>,
+    pub owner: Vec<usize>,
+    pub leaves: Vec<bool>,
+}
+
+/// Expand every macro of `p` into its literal instructions.
+///
+/// A `Move { push, pop, s, exits }` over base `b`, with `t` the scratch counter, is five loops in a row:
+///
+/// 1. `Dec push` (zero: on to 2), `Inc t` back — `t` takes a copy of `push`.
+/// 2. `Dec t` (zero: on to 3), then `b` × `Inc push` back — `push` becomes `b` times the copy.
+/// 3. `s` × `Inc push` — the digit.
+/// 4. `b` × `Dec pop`, the `m`-th finding zero going to 5's `m`-th copy loop, then `Inc t` back — `t`
+///    takes `⌊pop / b⌋`, and which `Dec` found zero is the digit removed.
+/// 5. For each digit `m`: `Dec t` (zero: leave for `exits[m]`), `Inc pop` back — the quotient returns.
+///
+/// That is `4·b + 4 + s` instructions. A `Stop` is `Stop`, and a `Spin` is `Dec scratch` going back to
+/// itself whether or not the counter is zero, which loops forever because scratch is zero between macros.
+///
+/// # Errors
+///
+/// [`Program::check`]'s, or [`ProgramError::TooLarge`] past [`MAX_LITERAL_INSTRS`].
+pub fn expand(p: &Program) -> Result<Expansion, ProgramError> {
+    p.check()?;
+    let mut first = Vec::with_capacity(p.macros.len());
+    let mut total = 0usize;
+    for m in &p.macros {
+        first.push(total);
+        total = literal_len(m, p.base).and_then(|len| total.checked_add(len)).ok_or(ProgramError::TooLarge)?;
+        if total > MAX_LITERAL_INSTRS {
+            return Err(ProgramError::TooLarge);
+        }
+    }
+    let copies = usize::try_from(p.base).map_err(|_| ProgramError::TooLarge)?;
+    let mut e = Expansion { instrs: Vec::with_capacity(total), first, owner: Vec::new(), leaves: Vec::new() };
+    for (j, m) in p.macros.iter().enumerate() {
+        let base = e.instrs.len();
+        match m {
+            Macro::Move { push, pop, s, exits } => {
+                let targets = exits.iter().map(|x| e.first.get(*x).copied()).collect::<Option<Vec<usize>>>();
+                let targets = targets.ok_or(ProgramError::NoSuchMacro { at: j, target: usize::MAX })?;
+                expand_move(&mut e.instrs, base, (*push, *pop, p.scratch), (copies, *s), &targets)?;
+            }
+            Macro::Stop { .. } => e.instrs.push(Instr::Stop),
+            Macro::Spin => e.instrs.push(Instr::Dec { c: p.scratch, nonzero: base, zero: base }),
+        }
+        e.leaves.resize(e.instrs.len(), false);
+        e.owner.resize(e.instrs.len(), j);
+        if matches!(m, Macro::Move { .. }) {
+            // Each copy loop in step 5 leaves on its `Dec`, which is every second instruction from the end.
+            for k in 0..copies {
+                if let Some(leaving) = e.leaves.get_mut(e.instrs.len() - 2 * (copies - k)) {
+                    *leaving = true;
+                }
+            }
+        }
+    }
+    Ok(e)
+}
+
+/// Append one move's expansion at `base`: counters `(push, pop, scratch)`, `(base b, digit s)`, and the
+/// first instruction of each exit.
+fn expand_move(
+    out: &mut Vec<Instr>,
+    base: usize,
+    (push, pop, t): (usize, usize, usize),
+    (b, s): (usize, u64),
+    exits: &[usize],
+) -> Result<(), ProgramError> {
+    let s = usize::try_from(s).map_err(|_| ProgramError::TooLarge)?;
+    let scale = base + 2;
+    let add = scale + 1 + b;
+    let divide = add + s;
+    let copy = divide + b + 1;
+    out.push(Instr::Dec { c: push, nonzero: base + 1, zero: scale });
+    out.push(Instr::Inc { c: t, next: base });
+    out.push(Instr::Dec { c: t, nonzero: scale + 1, zero: add });
+    for i in 0..b {
+        out.push(Instr::Inc { c: push, next: if i + 1 < b { scale + 2 + i } else { scale } });
+    }
+    for i in 0..s {
+        out.push(Instr::Inc { c: push, next: if i + 1 < s { add + 1 + i } else { divide } });
+    }
+    for m in 0..b {
+        out.push(Instr::Dec { c: pop, nonzero: divide + m + 1, zero: copy + 2 * m });
+    }
+    out.push(Instr::Inc { c: t, next: divide });
+    for (m, exit) in exits.iter().enumerate() {
+        out.push(Instr::Dec { c: t, nonzero: copy + 2 * m + 1, zero: *exit });
+        out.push(Instr::Inc { c: pop, next: copy + 2 * m });
+    }
+    Ok(())
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use crate::counter::accel::{LiteralEnd, run_literal};
+    use proptest::prelude::*;
+
+    /// A move at macro 0 whose exits are `Stop`s, one per digit, so a literal run's stopping instruction
+    /// says which digit it removed. Counters 0 and 1 hold data and counter 2 is scratch.
+    fn one_move(push: usize, pop: usize, b: u64, s: u64) -> Program {
+        let stops = usize::try_from(b).unwrap();
+        let mut macros = vec![Macro::Move { push, pop, s, exits: (1..=stops).collect() }];
+        macros.extend((0..stops).map(|i| Macro::Stop { state: u32::try_from(i).unwrap(), head: vec![] }));
+        Program { counters: 3, scratch: 2, base: b, macros, start: 0 }
+    }
+
+    proptest! {
+        /// A move's expansion pushes `s` onto `push`, pops `pop`'s least digit, leaves by that digit's exit,
+        /// empties scratch, and takes exactly its formula's steps — in both directions.
+        #[test]
+        fn a_move_takes_exactly_its_formulas_steps(
+            pushed in 0u64..400, popped in 0u64..400, b in 1u64..10, digit in 0u64..10, rightward in any::<bool>()
+        ) {
+            let s = digit % b;
+            let (push, pop) = if rightward { (0, 1) } else { (1, 0) };
+            let p = one_move(push, pop, b, s);
+            let e = expand(&p).unwrap();
+            prop_assert_eq!(e.instrs.len(), usize::try_from(4 * b + 4 + s).unwrap() + usize::try_from(b).unwrap());
+            let mut counters = vec![0, 0, 0];
+            counters[push] = pushed;
+            counters[pop] = popped;
+            let run = run_literal(&e.instrs, counters, 0, 1 << 30);
+            let LiteralEnd::Stopped { at } = run.end else { panic!("did not stop: {:?}", run.end) };
+            prop_assert_eq!(e.owner[at], 1 + usize::try_from(popped % b).unwrap());
+            let mut want = vec![0, 0, 0];
+            want[push] = pushed * b + s;
+            want[pop] = popped / b;
+            prop_assert_eq!(run.counters, want);
+            let formula = literal_steps(&p.macros[0], b, &Nat::from(pushed), &Nat::from(popped)).unwrap();
+            prop_assert_eq!(Nat::from(run.steps), formula);
+        }
+    }
+
+    /// `Spin`'s expansion runs until the cap and changes no counter, and its formula says it never ends.
+    #[test]
+    fn spin_runs_forever_and_changes_nothing() {
+        let p = Program { counters: 3, scratch: 2, base: 2, macros: vec![Macro::Spin], start: 0 };
+        let e = expand(&p).unwrap();
+        let run = run_literal(&e.instrs, vec![4, 5, 0], 0, 1_000);
+        assert_eq!(run.end, LiteralEnd::StepCap);
+        assert_eq!(run.counters, vec![4, 5, 0]);
+        assert_eq!(literal_steps(&Macro::Spin, 2, &Nat::zero(), &Nat::zero()), None);
+    }
+
+    /// Each structural rule refuses the program that breaks it, and a move that is its own exit is allowed.
+    #[test]
+    fn check_refuses_each_broken_rule() {
+        let stop = Macro::Stop { state: 0, head: vec![] };
+        let mv = |push: usize, pop: usize, s: u64, exits: Vec<usize>| Macro::Move { push, pop, s, exits };
+        let p = |base: u64, macros: Vec<Macro>| Program { counters: 3, scratch: 2, base, macros, start: 0 };
+        let cases = [
+            (p(0, vec![stop.clone()]), ProgramError::Base),
+            (p(MAX_BASE + 1, vec![stop.clone()]), ProgramError::Base),
+            (p(2, vec![mv(0, 1, 0, vec![1, 7]), stop.clone()]), ProgramError::NoSuchMacro { at: 0, target: 7 }),
+            (p(1, vec![mv(3, 1, 0, vec![1]), stop.clone()]), ProgramError::NoSuchCounter { at: 0, counter: 3 }),
+            (p(2, vec![mv(0, 1, 2, vec![1, 1]), stop.clone()]), ProgramError::Degenerate { at: 0 }),
+            (p(1, vec![mv(1, 1, 0, vec![1]), stop.clone()]), ProgramError::Degenerate { at: 0 }),
+            (p(1, vec![mv(0, 2, 0, vec![1]), stop.clone()]), ProgramError::Degenerate { at: 0 }),
+            (p(2, vec![mv(0, 1, 0, vec![1]), stop.clone()]), ProgramError::Degenerate { at: 0 }),
+        ];
+        for (program, want) in cases {
+            assert_eq!(program.check(), Err(want.clone()), "{program:?}");
+        }
+        assert_eq!(p(2, vec![mv(0, 1, 1, vec![1, 0]), stop]).check(), Ok(()));
+    }
+}
````
<!-- END task2.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run this task's tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib counter::nat counter::program counter::accel
```

Expected summary line: `11 tests run: 11 passed, 830 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 481 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `463 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Add counter programs and run them literally and accelerated

A Program is written over one base in Move, Stop and Spin macros, and
expand() derives each macro's single literal expansion into Inc, Dec
and Stop instructions: a Move is five loops, 4b + 4 + s instructions.
move_steps() writes a move's step formula plainly, and a proptest holds
it to a literal run of the expansion in both directions.

run_accelerated holds each counter as hi*b^j + lo, with lo a u64 of its
lowest base-b digits, so only a full or empty lo passes over hi's limbs,
and defers its step tally to match. A proptest holds the buffered
counters and the tally to plain arithmetic and move_steps summed move by
move; another holds accelerated and literal runs to the same
(macro, steps so far) at every macro entry.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 3: `compile.rs` and `readback.rs`, a Turing machine in and its tapes out

**Files:**
- Create: `crates/redextape-core/src/counter/compile.rs`
- Create: `crates/redextape-core/src/counter/readback.rs` — `tapes` only; Task 4 adds `value`
- Modify: `crates/redextape-core/src/counter/accel.rs` — `check_literal_agreement`, test support
- Modify: `crates/redextape-core/src/counter.rs` — declare `compile` and `readback`

**What changes.**
1. **A tape is two base-`b` numbers,** its cells left and right of the head, nearest cell least significant, `BLANK` digit 0. Tape `i` uses counters `2·i` and `2·i + 1`, and scratch is `2·k`, so a stage 1 image compiles to three counters. The digit under the head is not in a counter; it is in which macro runs next.
2. **The symbols are `two_symbol.rs`'s `Code` order,** so every symbol a rule or an initial tape names has a digit.
3. **A head move is one `Move`.** A rule that moves no head emits nothing, and a cycle of such rules compiles to `Spin`. The compiler builds one macro per (state, digits under heads) and fills each move's exits afterwards, from a worklist.
4. **`readback::tapes`** divides each counter's digits back out into cells and a head position.
5. **`accel::check_literal_agreement` says once what agreeing is.**
   - It runs a program accelerated, and its expansion literally from the same counters.
   - It returns the accelerated run and the literal step count when both stop in the same macro, with the same steps, counters and trace of macro entries. Otherwise it returns an error naming the first difference.
   - It is `#[doc(hidden)] pub`, because Task 4's integration test calls it too, and it returns an error instead of panicking; the Global Constraints give the reasons.
   - It checks, in order: where each run stopped, the literal steps, the counters, the trace's length, then the trace. The toys' `agrees` calls it first, then holds the accelerated run it returns to the simulator.
6. **Tests, in `compile.rs`:**
   - `compiled_toys_agree_with_the_simulator_and_their_literal_expansion` — four toy machines, on inputs of length 0 to 8 (0 to 6 for `binary_increment`), against the simulator and, through `check_literal_agreement`, against their own literal expansion at every macro entry. `copy_two_tapes` takes five counters and walks a head left of its start; `increment`'s scan is a move that is its own exit.
   - `a_cycle_of_rules_that_never_move_compiles_to_spin` and `more_initial_tapes_than_the_machine_has_is_refused`.
   - The toys live in a `#[cfg(test)] pub(crate) mod toys` for Task 5 to reuse.

**Interfaces:**
- Consumes: Tasks 1 and 2; `crate::tm::two_symbol::Code`; `Machine::validate`.
- Produces, in `crate::counter::compile`:
  - `pub fn left(i: usize) -> usize`, `pub fn right(i: usize) -> usize`, `pub fn scratch(k: usize) -> usize`
  - `pub const MAX_MACROS: usize`
  - `pub struct Compiled { program: Program, symbols: Vec<Symbol>, counters: Vec<Nat> }`
  - `pub enum CompileError { InvalidMachine, TooLarge, Program(ProgramError) }`
  - `pub fn compile(m: &Machine, inits: &[Vec<Symbol>]) -> Result<Compiled, CompileError>`
  - `#[cfg(test)] pub(crate) mod toys` with `increment`, `binary_increment`, `parity_eraser`, `copy_two_tapes` and `spinner`
- Produces, in `crate::counter::readback`: `pub fn tapes(counters: &[Nat], head: &[usize], symbols: &[Symbol]) -> Option<Vec<(Vec<Symbol>, usize)>>`
- Produces, in `crate::counter::accel`: `#[doc(hidden)] pub fn check_literal_agreement(p: &Program, counters: &[Nat], caps: Caps, max_literal_steps: u64) -> Result<(Run, u64), String>`

- [ ] **Step 1: Confirm Task 2 is the last commit and nothing is pending**

```bash
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: Task 2's commit subject, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task3.patch | git -C "$P" apply --index --check && block_of task3.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/counter.rs          |   5 +-
 crates/redextape-core/src/counter/accel.rs    |  62 +++-
 crates/redextape-core/src/counter/compile.rs  | 408 ++++++++++++++++++++++++++
 crates/redextape-core/src/counter/readback.rs |  35 +++
 4 files changed, 508 insertions(+), 2 deletions(-)
```

<!-- BEGIN task3.patch -->
````diff
diff --git a/crates/redextape-core/src/counter.rs b/crates/redextape-core/src/counter.rs
index 57fbd0d..8924dc0 100644
--- a/crates/redextape-core/src/counter.rs
+++ b/crates/redextape-core/src/counter.rs
@@ -8,8 +8,11 @@
 //! count is computed from its formula. **An accelerated run computes its literal step count; it does not take those
 //! steps**, and nothing that reports one may say otherwise.
 //!
-//! [`nat`] is the arithmetic the counters need.
+//! [`nat`] is the arithmetic the counters need, [`compile`] turns a Turing machine into a program, and
+//! [`readback`] turns a stopped program's counters back into tapes.
 
 pub mod accel;
+pub mod compile;
 pub mod nat;
 pub mod program;
+pub mod readback;
diff --git a/crates/redextape-core/src/counter/accel.rs b/crates/redextape-core/src/counter/accel.rs
index b4af574..072f813 100644
--- a/crates/redextape-core/src/counter/accel.rs
+++ b/crates/redextape-core/src/counter/accel.rs
@@ -26,7 +26,7 @@
 //! is read.
 
 use crate::counter::nat::{Divisor, Nat};
-use crate::counter::program::{Expansion, Instr, Macro, Program, ProgramError};
+use crate::counter::program::{Expansion, Instr, Macro, Program, ProgramError, expand};
 
 /// Why a literal run stopped.
 #[derive(Clone, Copy, Debug, PartialEq, Eq)]
@@ -181,6 +181,66 @@ pub fn run_accelerated_traced(
     accelerate(p, counters, caps, Some(trace))
 }
 
+/// Run `p` accelerated from `counters`, run its expansion literally from the same counters for at most
+/// `max_literal_steps` steps, and require the two runs to agree: both stop, in the same macro, with the same
+/// literal step count, the same counters and the same `(macro, literal steps so far)` trace. On agreement,
+/// the accelerated run and the literal step count.
+///
+/// This is test support. The unit tests of compiled programs and the oracle's integration test hold the two
+/// runs to each other through this one statement of what agreeing means; it is not part of the crate's API.
+/// It returns an error instead of panicking because the crate's library code may not panic.
+///
+/// # Errors
+///
+/// The first thing the two runs disagree on, or why they could not be compared: the accelerated run is
+/// refused or ends without stopping, the program has no literal expansion, a counter does not fit a `u64`,
+/// or the literal run ends without stopping.
+// Test support for compiled programs' unit tests and `tests/counter_oracle.rs`, not part of the module's contract.
+#[doc(hidden)]
+pub fn check_literal_agreement(
+    p: &Program,
+    counters: &[Nat],
+    caps: Caps,
+    max_literal_steps: u64,
+) -> Result<(Run, u64), String> {
+    let mut fast = Vec::new();
+    let run = run_accelerated_traced(p, counters.to_vec(), caps, &mut fast)
+        .map_err(|e| format!("the accelerated run was refused: {e:?}"))?;
+    let End::Stopped { at } = run.end else {
+        return Err(format!("the accelerated run ended with {:?}", run.end));
+    };
+    let e = expand(p).map_err(|e| format!("the program has no literal expansion: {e:?}"))?;
+    let literal: Vec<u64> = counters
+        .iter()
+        .map(u64::try_from)
+        .collect::<Result<_, _>>()
+        .map_err(|()| "an initial counter does not fit a u64".to_owned())?;
+    let start = *e.first.get(p.start).ok_or("the expansion has no instruction for the start macro")?;
+    let mut slow = Vec::new();
+    let lit = run_literal_traced(&e, literal, start, max_literal_steps, &mut slow);
+    let LiteralEnd::Stopped { at: lit_at } = lit.end else {
+        return Err(format!("the literal run ended with {:?}", lit.end));
+    };
+    let lit_macro = e.owner.get(lit_at).copied();
+    if lit_macro != Some(at) {
+        return Err(format!("the literal run stopped in macro {lit_macro:?}, the accelerated run in macro {at}"));
+    }
+    if Nat::from(lit.steps) != run.steps {
+        return Err(format!("the literal run took {} steps, the accelerated run computed {:?}", lit.steps, run.steps));
+    }
+    let lit_counters: Vec<Nat> = lit.counters.into_iter().map(Nat::from).collect();
+    if lit_counters != run.counters {
+        return Err(format!("the counters differ: literal {lit_counters:?}, accelerated {:?}", run.counters));
+    }
+    if slow.len() != fast.len() {
+        return Err(format!("the literal run entered {} macros, the accelerated run {}", slow.len(), fast.len()));
+    }
+    if let Some((s, f)) = slow.iter().zip(&fast).find(|((sm, ss), (fm, fs))| sm != fm || Nat::from(*ss) != *fs) {
+        return Err(format!("the traces differ: literal entry {s:?}, accelerated entry {f:?}"));
+    }
+    Ok((run, lit.steps))
+}
+
 /// One counter during an accelerated run: the value `hi·b^digits + lo`, with `lo < b^digits`, and `weight`,
 /// the sum of `b^digits` over the times its value was counted since `hi` last changed.
 struct Counter {
diff --git a/crates/redextape-core/src/counter/compile.rs b/crates/redextape-core/src/counter/compile.rs
new file mode 100644
index 0000000..6ffceab
--- /dev/null
+++ b/crates/redextape-core/src/counter/compile.rs
@@ -0,0 +1,408 @@
+//! Compiling a Turing machine to a counter program.
+//!
+//! **A TAPE IS TWO NUMBERS.** Over an alphabet of `b` symbols with `BLANK` as digit 0, the cells left of
+//! a head are a base-`b` number with the nearest cell least significant, and so are the cells right of it.
+//! Tape `i` keeps its left number in counter [`left`]`(i)` and its right number in [`right`]`(i)`; the
+//! digit under the head is not in any counter but in which macro runs next, so reading it costs nothing.
+//! One more counter, [`scratch`]`(k)`, is empty between macros. A stage 1 image has one tape, so it
+//! compiles to three counters.
+//!
+//! **A HEAD MOVE IS ONE MACRO.** Moving tape `i` right is a [`Macro::Move`] that pushes the digit under the
+//! head onto the left number and pops the right number's least digit, whose value picks one of `b` exits.
+//! Moving left is the same with the two numbers swapped. A rule that moves no head emits nothing: its writes
+//! and its next state only change which macro comes next, and a cycle of such rules becomes
+//! [`Macro::Spin`].
+
+use std::collections::{HashMap, HashSet};
+
+use crate::counter::nat::Nat;
+use crate::counter::program::{Macro, Program, ProgramError};
+use crate::tm::machine::{Machine, Move, StateId, Symbol};
+use crate::tm::two_symbol::Code;
+
+/// The counter holding tape `i`'s cells left of its head.
+#[must_use]
+pub fn left(i: usize) -> usize {
+    2 * i
+}
+
+/// The counter holding tape `i`'s cells right of its head.
+#[must_use]
+pub fn right(i: usize) -> usize {
+    2 * i + 1
+}
+
+/// The scratch counter of a program compiled from a `k`-tape machine.
+#[must_use]
+pub fn scratch(k: usize) -> usize {
+    2 * k
+}
+
+/// The most macros [`compile`] emits before refusing a machine.
+pub const MAX_MACROS: usize = 20_000_000;
+
+/// A compiled machine: the program, the symbol each digit stands for, and the counters it starts on.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub struct Compiled {
+    pub program: Program,
+    /// Digit `d` is `symbols[d]`, and `BLANK` is digit 0 — the order of `two_symbol.rs`'s `Code`.
+    pub symbols: Vec<Symbol>,
+    pub counters: Vec<Nat>,
+}
+
+/// Why a machine cannot be compiled.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub enum CompileError {
+    /// `Machine::validate` found problems, or there are more initial tapes than the machine has.
+    InvalidMachine,
+    /// The program would hold more than [`MAX_MACROS`] macros.
+    TooLarge,
+    /// The emitted program failed its own check — a defect in this compiler, reported rather than run.
+    Program(ProgramError),
+}
+
+/// A move's exit still to fill: exit `exit` of the move at `at` goes wherever [`Emitter::step`] sends the
+/// rest of the rule.
+struct Pending {
+    at: usize,
+    exit: usize,
+    state: StateId,
+    rule: usize,
+    tape: usize,
+    digits: Vec<usize>,
+}
+
+struct Emitter<'a> {
+    m: &'a Machine,
+    b: u64,
+    digit: HashMap<Symbol, usize>,
+    macros: Vec<Macro>,
+    dispatched: HashMap<(StateId, Vec<usize>), usize>,
+    stepped: HashMap<(StateId, usize, usize, Vec<usize>), usize>,
+    pending: Vec<Pending>,
+}
+
+impl Emitter<'_> {
+    fn push(&mut self, m: Macro) -> Result<usize, CompileError> {
+        if self.macros.len() >= MAX_MACROS {
+            return Err(CompileError::TooLarge);
+        }
+        self.macros.push(m);
+        Ok(self.macros.len() - 1)
+    }
+
+    /// The macro that runs the machine from `state` with `digits` under its heads: the first rule that
+    /// moves a head, reached through any rules that move none, or a `Stop` or a `Spin`.
+    fn dispatch(&mut self, state: StateId, digits: Vec<usize>) -> Result<usize, CompileError> {
+        let key = (state, digits);
+        if let Some(&at) = self.dispatched.get(&key) {
+            return Ok(at);
+        }
+        let (mut q, mut h) = key.clone();
+        let mut seen = HashSet::new();
+        let at = loop {
+            if !seen.insert((q, h.clone())) {
+                break self.push(Macro::Spin)?;
+            }
+            let Some(st) = usize::try_from(q).ok().and_then(|i| self.m.states.get(i)) else {
+                break self.push(Macro::Stop { state: q, head: h })?;
+            };
+            let matched = if st.accept {
+                None
+            } else {
+                st.rules.iter().position(|r| {
+                    r.read.iter().zip(&h).all(|(want, got)| want.is_none_or(|s| self.digit.get(&s) == Some(got)))
+                })
+            };
+            let Some((ri, rule)) = matched.and_then(|ri| st.rules.get(ri).map(|r| (ri, r))) else {
+                break self.push(Macro::Stop { state: q, head: h })?;
+            };
+            let mut written = h.clone();
+            for (slot, w) in written.iter_mut().zip(&rule.write) {
+                if let Some(s) = w {
+                    *slot = self.digit.get(s).copied().ok_or(CompileError::InvalidMachine)?;
+                }
+            }
+            if rule.moves.iter().all(|mv| *mv == Move::S) {
+                (q, h) = (rule.next, written);
+                continue;
+            }
+            break self.step(q, ri, 0, written)?;
+        };
+        self.dispatched.insert(key, at);
+        Ok(at)
+    }
+
+    /// The macros that finish rule `rule` of `state` from tape `tape` on, with `digits` under the heads: a
+    /// move for the first tape from `tape` on that the rule moves, or, when there is none, the rule's next
+    /// state.
+    fn step(&mut self, state: StateId, rule: usize, tape: usize, digits: Vec<usize>) -> Result<usize, CompileError> {
+        let machine = self.m;
+        let applied = usize::try_from(state)
+            .ok()
+            .and_then(|q| machine.states.get(q))
+            .and_then(|st| st.rules.get(rule))
+            .ok_or(CompileError::InvalidMachine)?;
+        let moving = (tape..machine.tapes).find(|&t| applied.moves.get(t).is_some_and(|mv| *mv != Move::S));
+        let Some(moving) = moving else {
+            return self.dispatch(applied.next, digits);
+        };
+        let key = (state, rule, moving, digits);
+        if let Some(&at) = self.stepped.get(&key) {
+            return Ok(at);
+        }
+        let (push, pop) = if applied.moves.get(moving) == Some(&Move::R) {
+            (left(moving), right(moving))
+        } else {
+            (right(moving), left(moving))
+        };
+        let under = key.3.get(moving).copied().ok_or(CompileError::InvalidMachine)?;
+        let written = u64::try_from(under).map_err(|_| CompileError::InvalidMachine)?;
+        let exit_count = usize::try_from(self.b).map_err(|_| CompileError::TooLarge)?;
+        let at = self.push(Macro::Move { push, pop, s: written, exits: vec![usize::MAX; exit_count] })?;
+        for popped_digit in 0..exit_count {
+            let mut popped = key.3.clone();
+            if let Some(slot) = popped.get_mut(moving) {
+                *slot = popped_digit;
+            }
+            self.pending.push(Pending { at, exit: popped_digit, state, rule, tape: moving + 1, digits: popped });
+        }
+        self.stepped.insert(key, at);
+        Ok(at)
+    }
+}
+
+/// Compile `m`, running on `inits`, to a counter program over `2·m.tapes + 1` counters.
+///
+/// The symbols are `Code::new(m, inits)`'s, so every symbol a rule or an initial tape names has a digit.
+/// Each tape's first initial cell is under its head; the rest are its right number.
+///
+/// # Errors
+///
+/// [`CompileError::InvalidMachine`] for a machine `Machine::validate` refuses or more initial tapes than
+/// `m.tapes`, [`CompileError::TooLarge`] past [`MAX_MACROS`].
+pub fn compile(m: &Machine, inits: &[Vec<Symbol>]) -> Result<Compiled, CompileError> {
+    if !m.validate().is_empty() || inits.len() > m.tapes {
+        return Err(CompileError::InvalidMachine);
+    }
+    let symbols = Code::new(m, inits).symbols().to_vec();
+    let digit: HashMap<Symbol, usize> = symbols.iter().enumerate().map(|(d, s)| (*s, d)).collect();
+    let b = u64::try_from(symbols.len()).map_err(|_| CompileError::TooLarge)?;
+    let k = m.tapes;
+    let mut counters = vec![Nat::zero(); 2 * k + 1];
+    let mut head = vec![0usize; k];
+    for (i, cells) in inits.iter().enumerate() {
+        let lookup = |s: &Symbol| digit.get(s).copied().ok_or(CompileError::InvalidMachine);
+        if let (Some(first), Some(slot)) = (cells.first(), head.get_mut(i)) {
+            *slot = lookup(first)?;
+        }
+        let mut r = Nat::zero();
+        for s in cells.iter().skip(1).rev() {
+            r.mul_add(b, u64::try_from(lookup(s)?).map_err(|_| CompileError::TooLarge)?);
+        }
+        if let Some(slot) = counters.get_mut(right(i)) {
+            *slot = r;
+        }
+    }
+    let mut e = Emitter {
+        m,
+        b,
+        digit,
+        macros: Vec::new(),
+        dispatched: HashMap::new(),
+        stepped: HashMap::new(),
+        pending: Vec::new(),
+    };
+    let start = e.dispatch(m.start, head)?;
+    while let Some(p) = e.pending.pop() {
+        let target = e.step(p.state, p.rule, p.tape, p.digits)?;
+        if let Some(Macro::Move { exits, .. }) = e.macros.get_mut(p.at)
+            && let Some(slot) = exits.get_mut(p.exit)
+        {
+            *slot = target;
+        }
+    }
+    let program = Program { counters: 2 * k + 1, scratch: scratch(k), base: b, macros: e.macros, start };
+    program.check().map_err(CompileError::Program)?;
+    Ok(Compiled { program, symbols, counters })
+}
+
+/// Small hand-built machines, shared by this module's tests and the 2-counter tests.
+#[cfg(test)]
+pub(crate) mod toys {
+    use crate::tm::machine::{BLANK, Machine, Move, Rule, State, Symbol};
+
+    fn one(read: Symbol, write: Option<Symbol>, mv: Move, next: u32) -> Rule {
+        Rule { read: vec![Some(read)], write: vec![write], moves: vec![mv], next }
+    }
+
+    fn state(name: &str, accept: bool, rules: Vec<Rule>) -> State {
+        State { name: name.into(), accept, rules }
+    }
+
+    /// Walk right over a unary string and append one mark.
+    pub(crate) fn increment() -> Machine {
+        Machine {
+            tapes: 1,
+            start: 0,
+            states: vec![
+                state("scan", false, vec![one('1', None, Move::R, 0), one(BLANK, Some('1'), Move::S, 1)]),
+                state("done", true, vec![]),
+            ],
+        }
+    }
+
+    /// Add one to a binary number written most significant digit first, moving left from its end.
+    pub(crate) fn binary_increment() -> Machine {
+        Machine {
+            tapes: 1,
+            start: 0,
+            states: vec![
+                state(
+                    "right",
+                    false,
+                    vec![one('0', None, Move::R, 0), one('1', None, Move::R, 0), one(BLANK, None, Move::L, 1)],
+                ),
+                state(
+                    "carry",
+                    false,
+                    vec![
+                        one('1', Some('0'), Move::L, 1),
+                        one('0', Some('1'), Move::S, 2),
+                        one(BLANK, Some('1'), Move::S, 2),
+                    ],
+                ),
+                state("done", true, vec![]),
+            ],
+        }
+    }
+
+    /// Erase a unary string left to right, halting in `even` (an accept) or `odd` (not one).
+    pub(crate) fn parity_eraser() -> Machine {
+        Machine {
+            tapes: 1,
+            start: 0,
+            states: vec![
+                state("e", false, vec![one('1', Some(BLANK), Move::R, 1), one(BLANK, None, Move::S, 2)]),
+                state("o", false, vec![one('1', Some(BLANK), Move::R, 0), one(BLANK, None, Move::S, 3)]),
+                state("even", true, vec![]),
+                state("odd", false, vec![]),
+            ],
+        }
+    }
+
+    /// Copy a unary string from tape 0 to tape 1, then walk tape 1's head back past where it started.
+    pub(crate) fn copy_two_tapes() -> Machine {
+        let two = |read: [Option<Symbol>; 2], write: [Option<Symbol>; 2], moves: [Move; 2], next: u32| Rule {
+            read: read.to_vec(),
+            write: write.to_vec(),
+            moves: moves.to_vec(),
+            next,
+        };
+        Machine {
+            tapes: 2,
+            start: 0,
+            states: vec![
+                state(
+                    "copy",
+                    false,
+                    vec![
+                        two([Some('1'), None], [None, Some('1')], [Move::R, Move::R], 0),
+                        two([Some(BLANK), None], [None, None], [Move::S, Move::L], 1),
+                    ],
+                ),
+                state(
+                    "back",
+                    false,
+                    vec![
+                        two([None, Some('1')], [None, None], [Move::S, Move::L], 1),
+                        two([None, Some(BLANK)], [None, None], [Move::L, Move::S], 2),
+                    ],
+                ),
+                state("done", true, vec![]),
+            ],
+        }
+    }
+
+    /// Two states that pass control back and forth without ever moving the head.
+    pub(crate) fn spinner() -> Machine {
+        Machine {
+            tapes: 1,
+            start: 0,
+            states: vec![
+                state("ping", false, vec![one('1', None, Move::S, 1)]),
+                state("pong", false, vec![one('1', Some('1'), Move::S, 0)]),
+            ],
+        }
+    }
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use crate::counter::accel::{Caps, End, check_literal_agreement, run_accelerated};
+    use crate::counter::readback;
+    use crate::tm::machine::BLANK;
+    use crate::tm::sim::{Caps as TmCaps, Status, simulate_final};
+    use crate::tm::single_tape::normalize;
+
+    const WIDE: Caps = Caps { macros: 10_000_000, bits: 1 << 20 };
+    const TM: TmCaps = TmCaps { steps: 1_000_000, cells: 1_000_000 };
+
+    /// Compile `m` on `inits`, require a literal run of the program's expansion to agree with its accelerated
+    /// run as `check_literal_agreement` defines agreeing, and require of that accelerated run what the Turing
+    /// machine simulator does: the same halting state, the same tapes, an empty scratch counter.
+    fn agrees(what: &str, m: &Machine, inits: &[Vec<Symbol>]) {
+        let c = compile(m, inits).unwrap_or_else(|e| panic!("{what}: {e:?}"));
+        let (want, want_state, status, _) = simulate_final(m, inits, TM);
+        assert_eq!(status, Status::Halted, "{what}: the Turing machine must halt");
+
+        let (run, _) = check_literal_agreement(&c.program, &c.counters, WIDE, 2_000_000_000)
+            .unwrap_or_else(|e| panic!("{what}: {e}"));
+        let End::Stopped { at } = run.end else { panic!("{what}: {:?}", run.end) };
+        let Macro::Stop { state, head } = &c.program.macros[at] else { panic!("{what}: not a Stop") };
+        assert_eq!(*state, want_state, "{what}: halting state");
+        assert!(run.counters[scratch(m.tapes)].is_zero(), "{what}: scratch must be empty at a Stop");
+        let got = readback::tapes(&run.counters, head, &c.symbols).unwrap();
+        assert_eq!(got.len(), want.len(), "{what}: tape count");
+        for (i, ((cells, h), tape)) in got.iter().zip(&want).enumerate() {
+            let (wc, wh) = tape.snapshot();
+            assert_eq!(normalize(cells, *h), normalize(&wc, wh), "{what}: tape {i}");
+        }
+    }
+
+    /// Every toy, on inputs of every length from 0 to 8 (0 to 6 for `binary_increment`), agrees with the Turing
+    /// machine simulator and with its own literal expansion. `copy_two_tapes` compiles to five counters and walks
+    /// a head left of where it started, and `increment`'s scan is a move that is its own exit.
+    #[test]
+    fn compiled_toys_agree_with_the_simulator_and_their_literal_expansion() {
+        for n in 0..=8 {
+            let marks = vec![vec!['1'; n]];
+            agrees(&format!("increment n={n}"), &toys::increment(), &marks);
+            agrees(&format!("parity_eraser n={n}"), &toys::parity_eraser(), &marks);
+            agrees(&format!("copy_two_tapes n={n}"), &toys::copy_two_tapes(), &marks);
+            let ones = vec![vec!['1'; n.min(6)]];
+            agrees(&format!("binary_increment n={}", n.min(6)), &toys::binary_increment(), &ones);
+        }
+    }
+
+    /// A cycle of rules that move no head compiles to `Spin`, which the accelerated run reports, while the
+    /// simulator runs the same machine to its step cap.
+    #[test]
+    fn a_cycle_of_rules_that_never_move_compiles_to_spin() {
+        let m = toys::spinner();
+        let inits = vec![vec!['1']];
+        let c = compile(&m, &inits).unwrap();
+        assert_eq!(c.program.macros[c.program.start], Macro::Spin);
+        let run = run_accelerated(&c.program, c.counters, WIDE).unwrap();
+        assert!(matches!(run.end, End::Spun { .. }), "{:?}", run.end);
+        assert_eq!(simulate_final(&m, &inits, TM).2, Status::HitCap);
+    }
+
+    /// More initial tapes than the machine has is refused, not truncated.
+    #[test]
+    fn more_initial_tapes_than_the_machine_has_is_refused() {
+        let got = compile(&toys::increment(), &[vec!['1'], vec![BLANK]]);
+        assert_eq!(got, Err(CompileError::InvalidMachine));
+    }
+}
diff --git a/crates/redextape-core/src/counter/readback.rs b/crates/redextape-core/src/counter/readback.rs
new file mode 100644
index 0000000..f3f29b4
--- /dev/null
+++ b/crates/redextape-core/src/counter/readback.rs
@@ -0,0 +1,35 @@
+//! Reading a compiled machine's tapes back out of a stopped program's counters.
+
+use crate::counter::compile::{left, right};
+use crate::counter::nat::{Divisor, Nat};
+use crate::tm::machine::Symbol;
+
+/// Each tape as `(cells, head index)`, from the counters a compiled program stopped with and the digits
+/// its `Stop` recorded under the heads — the shape `Tape::snapshot` returns.
+///
+/// A number has no leading zero digits, so a tape comes back without the `BLANK`s beyond its outermost
+/// non-blank cells; compare it with a simulator's tape under `single_tape.rs`'s `normalize`. `None` when a
+/// digit names no symbol or a counter is missing.
+#[must_use]
+pub fn tapes(counters: &[Nat], head: &[usize], symbols: &[Symbol]) -> Option<Vec<(Vec<Symbol>, usize)>> {
+    let divisor = Divisor::new(u64::try_from(symbols.len()).ok()?)?;
+    let digits = |v: &Nat| -> Option<Vec<Symbol>> {
+        let mut v = v.clone();
+        let mut out = Vec::new();
+        while !v.is_zero() {
+            let d = usize::try_from(v.div_rem(&divisor)).ok()?;
+            out.push(*symbols.get(d)?);
+        }
+        Some(out)
+    };
+    head.iter()
+        .enumerate()
+        .map(|(i, under)| {
+            let mut cells: Vec<Symbol> = digits(counters.get(left(i))?)?.into_iter().rev().collect();
+            let at = cells.len();
+            cells.push(*symbols.get(*under)?);
+            cells.extend(digits(counters.get(right(i))?)?);
+            Some((cells, at))
+        })
+        .collect()
+}
````
<!-- END task3.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run this task's tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib counter
```

Expected summary line: `14 tests run: 14 passed, 830 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 483 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `465 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Compile a Turing machine to a counter program, and read its tapes back

Each tape is two base-b numbers, the cells left and right of its head,
with BLANK as digit 0 and the digit under the head held in which macro
runs next. A head move is one Move; a rule that moves no head emits
nothing, and a cycle of such rules compiles to Spin. A k-tape machine
takes 2k+1 counters, so a stage 1 image takes three.

readback::tapes turns a stopped program's counters back into cells and
head positions. Four toy machines, on inputs of length 0 to 8 (0 to 6
for the binary incrementer), halt in
the same state as the simulator with the same tapes and an empty
scratch counter, and each program's literal expansion agrees with its
accelerated run at every macro entry.

accel::check_literal_agreement states what that agreement is, once, as
test support hidden from the docs. It returns an error instead of
panicking, because the crate's library code may not panic.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 4: The oracle leg

**Files:**
- Modify: `crates/redextape-core/src/counter/readback.rs` — `value`
- Modify: `crates/redextape-core/src/counter.rs` — one doc line
- Create: `crates/redextape-core/tests/counter_oracle.rs`

**What changes.**
1. **`readback::value`** splits a stage 1 tape with `single_tape.rs`'s `deinterleave` and decodes it with `decode_tape_ty`.
2. **`agrees_at_stage_one`**, for each corpus program under unary, with the oracles' `PAD` of 2, requires:
   - the stage 1 image's counter program to stop in the simulator's halting state;
   - the scratch counter to be empty;
   - the tape, under `normalize`, to be the simulator's;
   - the value to be the reference interpreter's.
3. **`literal_and_accelerated_agree`** runs the lowered machines of `1` and `1 + 1`, compiled to eleven counters, and requires the literal and accelerated runs to agree at every macro entry, through Task 3's `check_literal_agreement`. No stage 1 image is within reach of a literal run: `3 - 5`'s stands for about 10^380 literal steps.
4. **The tiers are measured.** A test is fast when it ran in under 1 s in the debug build, timed on its own. Every slow-tier (`#[ignore]`) test ran in under 60 s in release. Debug, one test at a time, three runs at a load average near 4:
   - fast: `three_minus_five` 0.144–0.153 s, `a_list` 0.347–0.359 s, `a_conditional` 0.582–0.597 s, `arithmetic` 0.678–0.692 s, `a_lowered_literal` 0.003 s
   - slow: `a_lowered_sum` 2.300–2.352 s, `a_call` 3.055–3.238 s

   **The fast tier's two slowest tests are not under 1 s in the whole-crate run,** where every test runs in parallel: Task 5 Step 9 shows those times.

**Interfaces:**
- Consumes: Tasks 1–3, including `accel::check_literal_agreement`; `tests/common/mod.rs`'s `core_and_ty` and `build_machine`.
- Produces: `pub fn value(stage_one: &[Symbol], lowered_tapes: usize, ty: &Ty, enc: &dyn Encoding) -> Option<Value>` in `crate::counter::readback`.

- [ ] **Step 1: Confirm Task 3 is the last commit and nothing is pending**

```bash
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: Task 3's commit subject, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task4.patch | git -C "$P" apply --index --check && block_of task4.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/counter.rs          |   2 +-
 crates/redextape-core/src/counter/readback.rs |  20 +++-
 crates/redextape-core/tests/counter_oracle.rs | 131 ++++++++++++++++++++++++++
 3 files changed, 151 insertions(+), 2 deletions(-)
```

<!-- BEGIN task4.patch -->
````diff
diff --git a/crates/redextape-core/src/counter.rs b/crates/redextape-core/src/counter.rs
index 8924dc0..cae05a2 100644
--- a/crates/redextape-core/src/counter.rs
+++ b/crates/redextape-core/src/counter.rs
@@ -9,7 +9,7 @@
 //! steps**, and nothing that reports one may say otherwise.
 //!
 //! [`nat`] is the arithmetic the counters need, [`compile`] turns a Turing machine into a program, and
-//! [`readback`] turns a stopped program's counters back into tapes.
+//! [`readback`] turns a stopped program's counters back into tapes and a value.
 
 pub mod accel;
 pub mod compile;
diff --git a/crates/redextape-core/src/counter/readback.rs b/crates/redextape-core/src/counter/readback.rs
index f3f29b4..2d06e3a 100644
--- a/crates/redextape-core/src/counter/readback.rs
+++ b/crates/redextape-core/src/counter/readback.rs
@@ -1,8 +1,15 @@
-//! Reading a compiled machine's tapes back out of a stopped program's counters.
+//! Reading a compiled machine's tapes back out of a stopped program's counters, and a stage 1 image's tape
+//! back to the value its program computed.
 
 use crate::counter::compile::{left, right};
 use crate::counter::nat::{Divisor, Nat};
+use crate::tm::decode::decode_tape_ty;
+use crate::tm::encoding::Encoding;
 use crate::tm::machine::Symbol;
+use crate::tm::sim::Tape;
+use crate::tm::single_tape::deinterleave;
+use crate::ty::Ty;
+use crate::value::Value;
 
 /// Each tape as `(cells, head index)`, from the counters a compiled program stopped with and the digits
 /// its `Stop` recorded under the heads — the shape `Tape::snapshot` returns.
@@ -33,3 +40,14 @@ pub fn tapes(counters: &[Nat], head: &[usize], symbols: &[Symbol]) -> Option<Vec
         })
         .collect()
 }
+
+/// The value a stage 1 image computed, from its one tape as [`tapes`] read it back: the tape split into the
+/// `lowered_tapes` tapes of the machine stage 1 reduced, then decoded as `ty` under `enc`.
+///
+/// `None` when the tape is not a well-formed block skeleton, or does not decode as `ty`.
+#[must_use]
+pub fn value(stage_one: &[Symbol], lowered_tapes: usize, ty: &Ty, enc: &dyn Encoding) -> Option<Value> {
+    let lowered = deinterleave(&Tape::new(stage_one), lowered_tapes)?;
+    let rebuilt: Vec<Tape> = lowered.iter().map(|(cells, _)| Tape::new(cells)).collect();
+    decode_tape_ty(&rebuilt, ty, enc)
+}
diff --git a/crates/redextape-core/tests/counter_oracle.rs b/crates/redextape-core/tests/counter_oracle.rs
new file mode 100644
index 0000000..3484251
--- /dev/null
+++ b/crates/redextape-core/tests/counter_oracle.rs
@@ -0,0 +1,131 @@
+//! The counter-machine leg of the oracle.
+//!
+//! Each corpus program's stage 1 image is compiled to a three-counter program and run accelerated. It must
+//! halt in the state the Turing machine simulator halts in, leave the tape the simulator leaves, and read
+//! back to the value the reference interpreter computes.
+//!
+//! Programs small enough to run literally are held to more: the lowered machines of `1` and `1 + 1`,
+//! compiled to eleven counters, must agree literal against accelerated at every macro entry. No stage 1 image
+//! is small enough — `3 - 5`'s stands for about 10^380 literal steps.
+//!
+//! **THE TIERS ARE MEASURED.** A test is in the fast tier when it ran in under 1 s in the debug build `cargo nextest`
+//! runs, timed on its own, and in the slow tier otherwise; every slow-tier test ran in under 60 s in the release
+//! build `scripts/check-slow.sh` runs.
+
+// Test target: a fixture that fails to build IS the failure this file reports, so panicking is
+// deliberate here. The `allow-*-in-tests` keys in `clippy.toml` only reach `#[test]` functions and
+// `#[cfg(test)]` modules, not the free helpers below, so the exemption is stated per target.
+#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]
+
+use redextape_core::counter::accel::{Caps, End, check_literal_agreement, run_accelerated};
+use redextape_core::counter::compile::{compile, scratch};
+use redextape_core::counter::program::Macro;
+use redextape_core::counter::readback;
+use redextape_core::tm::sim::{Caps as TmCaps, Status, simulate_final};
+use redextape_core::tm::single_tape::{interleave, layout_collision, normalize, to_single_tape};
+use redextape_core::tm::{EncodingKind, TM_DEFAULT_CAPS, TmRun, run_tm_described};
+
+mod common;
+use common::{build_machine, core_and_ty};
+
+/// The oracles' padding blocks on each side of a stage 1 image.
+const PAD: usize = 2;
+const CAPS: Caps = Caps { macros: 2_000_000_000, bits: 1 << 22 };
+const TM_CAPS: TmCaps = TmCaps { steps: 2_000_000_000, cells: 50_000_000 };
+
+/// Run `src`'s stage 1 image as a counter program and hold it to the simulator and the reference.
+fn agrees_at_stage_one(src: &str) {
+    let (core, ty) = core_and_ty(src);
+    // `interp::eval` is this project's reference interpreter for the mini-language `Core` AST built above from
+    // a fixed corpus — not a dynamic or untrusted code-execution primitive.
+    let reference = redextape_core::interp::eval(&core).unwrap_or_else(|e| panic!("reference failed for {src}: {e:?}"));
+    let d = run_tm_described(&core, EncodingKind::Unary, ty.clone(), TM_DEFAULT_CAPS).unwrap();
+    assert!(matches!(d.run, TmRun::Ran { .. }), "{src}: the lowered machine must complete");
+    let inits = d.header.init(d.machine.tapes);
+    assert_eq!(layout_collision(&d.machine, &inits), None, "{src}");
+    let single = to_single_tape(&d.machine);
+    let cells = vec![interleave(&inits, d.machine.tapes, PAD, PAD)];
+    let (want, want_state, status, _) = simulate_final(&single, &cells, TM_CAPS);
+    assert_eq!(status, Status::Halted, "{src}: the stage 1 image must halt");
+
+    let c = compile(&single, &cells).unwrap_or_else(|e| panic!("{src}: {e:?}"));
+    let run = run_accelerated(&c.program, c.counters.clone(), CAPS).unwrap();
+    let End::Stopped { at } = run.end else { panic!("{src}: {:?}", run.end) };
+    let Macro::Stop { state, head } = &c.program.macros[at] else { panic!("{src}: stopped on a non-Stop") };
+    assert_eq!(*state, want_state, "{src}: halting state");
+    assert!(run.counters[scratch(1)].is_zero(), "{src}: scratch must be empty at a Stop");
+
+    let tapes = readback::tapes(&run.counters, head, &c.symbols).unwrap();
+    let (cells_want, head_want) = want[0].snapshot();
+    assert_eq!(normalize(&tapes[0].0, tapes[0].1), normalize(&cells_want, head_want), "{src}: tape");
+    let value = readback::value(&tapes[0].0, d.machine.tapes, &ty, &*d.header.encoding());
+    assert_eq!(value, Some(reference), "{src}: value");
+    println!(
+        "{src}: {} moves, largest counter {} bits, about 2^{} literal steps computed",
+        run.macros,
+        run.largest_bits,
+        run.steps.bits()
+    );
+}
+
+#[test]
+fn three_minus_five_runs_as_a_counter_machine() {
+    agrees_at_stage_one("3 - 5");
+}
+
+#[test]
+fn a_conditional_runs_as_a_counter_machine() {
+    agrees_at_stage_one("if 2 > 1 { 10 } else { 20 }");
+}
+
+#[test]
+fn a_list_runs_as_a_counter_machine() {
+    agrees_at_stage_one("cons(1, cons(2, nil))");
+}
+
+#[test]
+fn arithmetic_runs_as_a_counter_machine() {
+    agrees_at_stage_one("1 + 2 * 3");
+}
+
+#[test]
+#[ignore = "slow tier: over 1 s in a debug build when this leg was planned; run via scripts/check-slow.sh"]
+fn a_call_runs_as_a_counter_machine() {
+    agrees_at_stage_one("fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))");
+}
+
+#[test]
+#[ignore = "slow tier: over 1 s in a debug build when this leg was planned; run via scripts/check-slow.sh"]
+fn a_binding_runs_as_a_counter_machine() {
+    agrees_at_stage_one("let x = 40; x + 2");
+}
+
+#[test]
+#[ignore = "slow tier: over 1 s in a debug build when this leg was planned; run via scripts/check-slow.sh"]
+fn recursion_runs_as_a_counter_machine() {
+    agrees_at_stage_one("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)");
+}
+
+/// Compile `src`'s lowered machine, and require its literal expansion and its accelerated run to agree as
+/// `check_literal_agreement` defines agreeing: on where they stop, the steps, the counters and the trace of
+/// macro entries. Returns the literal step count.
+fn literal_and_accelerated_agree(src: &str) -> u64 {
+    let (m, inits) = build_machine(src, EncodingKind::Unary);
+    let c = compile(&m, &inits).unwrap_or_else(|e| panic!("{src}: {e:?}"));
+    let (_, steps) =
+        check_literal_agreement(&c.program, &c.counters, CAPS, 2_000_000_000).unwrap_or_else(|e| panic!("{src}: {e}"));
+    steps
+}
+
+#[test]
+fn a_lowered_literal_agrees_literally() {
+    let steps = literal_and_accelerated_agree("1");
+    println!("1 lowered: {steps} literal steps");
+}
+
+#[test]
+#[ignore = "slow tier: over 1 s in a debug build when this leg was planned; run via scripts/check-slow.sh"]
+fn a_lowered_sum_agrees_literally() {
+    let steps = literal_and_accelerated_agree("1 + 1");
+    println!("1 + 1 lowered: {steps} literal steps");
+}
````
<!-- END task4.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run this task's fast-tier tests**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib --test counter_oracle -E 'test(/^counter::/) | binary_id(redextape-core::counter_oracle)'
```

Expected summary line: `19 tests run: 19 passed, 834 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 483 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `466 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Run the corpus's stage 1 images as counter machines

tests/counter_oracle.rs compiles each corpus program's stage 1 image to
a three-counter program, runs it accelerated, and requires the
simulator's halting state and tape and the reference interpreter's
value, read back through deinterleave by readback::value. The lowered
machines of 1 and 1 + 1, compiled to eleven counters, must also agree
literal against accelerated at every macro entry.

The tiers are measured: a test under 1 s in the debug build, timed on
its own, is fast, and every slow-tier test ran under 60 s in release,
sum(5) the longest.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

---

### Task 5: `godel.rs`, and the finished-code checks

**Files:**
- Create: `crates/redextape-core/src/counter/godel.rs`
- Modify: `crates/redextape-core/src/counter.rs` — declare `godel`

**What changes.**
1. **`fold`** compiles a literal three-counter program into one over `A`, which holds `2^x · 3^y · 5^z`, and scratch `B`:
   - an `Inc` is `p + 3` instructions;
   - a `Dec` is `3·p + 3`: divide `A` by `p`, and either keep the quotient (nonzero branch) or restore `A` (zero branch);
   - a `Stop` is `Stop`.
2. **`encode` and `decode`** convert between the three counters and `A`.
3. **Tests:**
   - `one_instruction_folds_to_the_same_effect` and `decode_inverts_encode_and_refuses_other_factors`.
   - `toys_fold_to_two_counters` — the unary incrementer and the parity eraser, each on up to four marks. Each fold stops where the three-counter program does, with the same counters, and reads back to the simulator's tape.
   - Slow tier: `the_parity_eraser_on_five_marks_folds_to_two_counters` and `the_binary_incrementer_folds_to_two_counters`.

**Interfaces:**
- Consumes: Tasks 1–3, including `compile.rs`'s test-only `toys`.
- Produces, in `crate::counter::godel`:
  - `pub const PRIMES: [u64; 3]`
  - `pub struct Folded { instrs: Vec<Instr>, first: Vec<usize> }`
  - `pub enum FoldError { Malformed { at: usize }, TooLarge }`
  - `pub fn fold(three: &[Instr]) -> Result<Folded, FoldError>`
  - `pub fn encode(counters: [u64; 3]) -> Option<u64>`, `pub fn decode(a: u64) -> Option<[u64; 3]>`

- [ ] **Step 1: Confirm Task 4 is the last commit and nothing is pending**

```bash
git -C "$P" log --oneline -1 && git -C "$P" diff --quiet HEAD -- crates/ && git -C "$P" diff --cached --quiet -- crates/ && echo clean
```

Expected: Task 4's commit subject, then `clean`.

- [ ] **Step 2: Apply the patch, staged**

```bash
block_of task5.patch | git -C "$P" apply --index --check && block_of task5.patch | git -C "$P" apply --index
git -C "$P" diff --cached --stat
```

Expected:

```text
 crates/redextape-core/src/counter.rs       |   6 +-
 crates/redextape-core/src/counter/godel.rs | 235 +++++++++++++++++++++++++++++
 2 files changed, 239 insertions(+), 2 deletions(-)
```

<!-- BEGIN task5.patch -->
````diff
diff --git a/crates/redextape-core/src/counter.rs b/crates/redextape-core/src/counter.rs
index cae05a2..aa89cac 100644
--- a/crates/redextape-core/src/counter.rs
+++ b/crates/redextape-core/src/counter.rs
@@ -8,11 +8,13 @@
 //! count is computed from its formula. **An accelerated run computes its literal step count; it does not take those
 //! steps**, and nothing that reports one may say otherwise.
 //!
-//! [`nat`] is the arithmetic the counters need, [`compile`] turns a Turing machine into a program, and
-//! [`readback`] turns a stopped program's counters back into tapes and a value.
+//! [`nat`] is the arithmetic the counters need, [`compile`] turns a Turing machine into a program, [`readback`]
+//! turns a stopped program's counters back into tapes and a value, and [`godel`] folds three counters into
+//! two for literal runs on toy machines.
 
 pub mod accel;
 pub mod compile;
+pub mod godel;
 pub mod nat;
 pub mod program;
 pub mod readback;
diff --git a/crates/redextape-core/src/counter/godel.rs b/crates/redextape-core/src/counter/godel.rs
new file mode 100644
index 0000000..84d8b5b
--- /dev/null
+++ b/crates/redextape-core/src/counter/godel.rs
@@ -0,0 +1,235 @@
+//! Folding a three-counter literal program into a two-counter one, by Gödel numbering.
+//!
+//! Counter `A` holds `2^x · 3^y · 5^z` for the three counters `x`, `y` and `z` of the program being folded,
+//! and counter `B` is scratch. Incrementing `y` multiplies `A` by 3, through `B`; decrementing it divides
+//! `A` by 3, and a nonzero remainder says `y` was already zero, so the division is undone and the zero
+//! branch taken.
+//!
+//! **THIS RUNS LITERALLY, AND ONLY ON TOYS.** Every instruction of the folded program costs steps in
+//! proportion to `A`, and `A` is exponential in counters that are themselves exponential in a tape's
+//! length. A stage 1 image of `3 - 5` has a counter of 1,253 bits, whose `A` would need about 10^377 bits to
+//! store; a unary incrementer on four marks takes 2,974,863 two-counter steps.
+
+use crate::counter::program::{Instr, MAX_LITERAL_INSTRS};
+
+/// The prime each of the three counters is the exponent of, in counter order.
+pub const PRIMES: [u64; 3] = [2, 3, 5];
+
+/// The counter holding the Gödel number.
+const A: usize = 0;
+/// The scratch counter.
+const B: usize = 1;
+
+/// A folded program, and the first two-counter instruction of each three-counter instruction.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub struct Folded {
+    pub instrs: Vec<Instr>,
+    pub first: Vec<usize>,
+}
+
+/// Why a program cannot be folded.
+#[derive(Clone, Debug, PartialEq, Eq)]
+pub enum FoldError {
+    /// The instruction at `at` names a counter past the three, or an instruction that does not exist.
+    Malformed { at: usize },
+    /// The folded program would hold more than `MAX_LITERAL_INSTRS` instructions.
+    TooLarge,
+}
+
+/// The two-counter instructions `instr` folds to.
+fn folded_len(instr: &Instr) -> Option<usize> {
+    let prime = |c: usize| PRIMES.get(c).and_then(|p| usize::try_from(*p).ok());
+    match *instr {
+        Instr::Inc { c, .. } => Some(prime(c)? + 3),
+        Instr::Dec { c, .. } => Some(3 * prime(c)? + 3),
+        Instr::Stop => Some(1),
+    }
+}
+
+/// Fold `three`, a literal program over counters 0, 1 and 2, into one over `A` and `B`.
+///
+/// With `p` the counter's prime and `base` the first folded instruction:
+///
+/// * `Inc` is `p + 3` instructions: move `A` into `B` `p` times over, then move `B` back into `A`.
+/// * `Dec` is `3·p + 3`: divide `A` by `p` into `B`, the `Dec` that finds `A` empty naming the remainder
+///   `m`. A remainder of zero moves the quotient back into `A` and takes the nonzero branch; any other
+///   restores `A` to `p·B + m` and takes the zero branch.
+/// * `Stop` is `Stop`.
+///
+/// # Errors
+///
+/// [`FoldError::Malformed`] for a counter past 2 or a jump past the program, [`FoldError::TooLarge`] past
+/// `MAX_LITERAL_INSTRS`.
+pub fn fold(three: &[Instr]) -> Result<Folded, FoldError> {
+    let mut first = Vec::with_capacity(three.len());
+    let mut total = 0usize;
+    for (at, instr) in three.iter().enumerate() {
+        first.push(total);
+        total = folded_len(instr).ok_or(FoldError::Malformed { at })?.checked_add(total).ok_or(FoldError::TooLarge)?;
+        if total > MAX_LITERAL_INSTRS {
+            return Err(FoldError::TooLarge);
+        }
+    }
+    let mut out = Vec::with_capacity(total);
+    for (at, instr) in three.iter().enumerate() {
+        let base = out.len();
+        let to = |target: usize| first.get(target).copied().ok_or(FoldError::Malformed { at });
+        let prime = |c: usize| PRIMES.get(c).and_then(|p| usize::try_from(*p).ok()).ok_or(FoldError::Malformed { at });
+        match *instr {
+            Instr::Inc { c, next } => {
+                let p = prime(c)?;
+                out.push(Instr::Dec { c: A, nonzero: base + 1, zero: base + p + 1 });
+                for q in 0..p {
+                    out.push(Instr::Inc { c: B, next: if q + 1 < p { base + 2 + q } else { base } });
+                }
+                out.push(Instr::Dec { c: B, nonzero: base + p + 2, zero: to(next)? });
+                out.push(Instr::Inc { c: A, next: base + p + 1 });
+            }
+            Instr::Dec { c, nonzero, zero } => {
+                let p = prime(c)?;
+                let restore = |m: usize| if m == 0 { base + p + 1 } else { base + p + 2 + m };
+                let undo = base + 2 * p + 2;
+                for m in 0..p {
+                    out.push(Instr::Dec { c: A, nonzero: base + m + 1, zero: restore(m) });
+                }
+                out.push(Instr::Inc { c: B, next: base });
+                out.push(Instr::Dec { c: B, nonzero: base + p + 2, zero: to(nonzero)? });
+                out.push(Instr::Inc { c: A, next: base + p + 1 });
+                for m in 1..p {
+                    out.push(Instr::Inc { c: A, next: if m == 1 { undo } else { restore(m - 1) } });
+                }
+                out.push(Instr::Dec { c: B, nonzero: undo + 1, zero: to(zero)? });
+                for q in 0..p {
+                    out.push(Instr::Inc { c: A, next: if q + 1 < p { undo + 2 + q } else { undo } });
+                }
+            }
+            Instr::Stop => out.push(Instr::Stop),
+        }
+    }
+    Ok(Folded { instrs: out, first })
+}
+
+/// `2^x · 3^y · 5^z` for `counters = [x, y, z]`, or `None` when it does not fit a `u64`.
+#[must_use]
+pub fn encode(counters: [u64; 3]) -> Option<u64> {
+    PRIMES.iter().zip(counters).try_fold(1u64, |acc, (p, e)| acc.checked_mul(p.checked_pow(u32::try_from(e).ok()?)?))
+}
+
+/// The exponents `[x, y, z]` of `a = 2^x · 3^y · 5^z`, or `None` when `a` is zero or has another prime
+/// factor.
+#[must_use]
+pub fn decode(mut a: u64) -> Option<[u64; 3]> {
+    if a == 0 {
+        return None;
+    }
+    let mut out = [0u64; 3];
+    for (slot, p) in out.iter_mut().zip(PRIMES) {
+        while a.is_multiple_of(p) {
+            a /= p;
+            *slot += 1;
+        }
+    }
+    (a == 1).then_some(out)
+}
+
+#[cfg(test)]
+mod tests {
+    use super::*;
+    use crate::counter::accel::{LiteralEnd, run_literal};
+    use crate::counter::compile::{compile, toys};
+    use crate::counter::nat::Nat;
+    use crate::counter::program::{Macro, expand};
+    use crate::counter::readback;
+    use crate::tm::machine::{Machine, Symbol};
+    use crate::tm::sim::{Caps as TmCaps, simulate_final};
+    use crate::tm::single_tape::normalize;
+    use proptest::prelude::*;
+
+    proptest! {
+        /// One `Inc` or `Dec` on any of the three counters, folded, does what it did unfolded: the same
+        /// branch, and a Gödel number that decodes to the same counters.
+        #[test]
+        fn one_instruction_folds_to_the_same_effect(x in 0u64..6, y in 0u64..5, z in 0u64..4, c in 0usize..3, inc in any::<bool>()) {
+            let three = if inc {
+                vec![Instr::Inc { c, next: 1 }, Instr::Stop, Instr::Stop]
+            } else {
+                vec![Instr::Dec { c, nonzero: 1, zero: 2 }, Instr::Stop, Instr::Stop]
+            };
+            let unfolded = run_literal(&three, vec![x, y, z], 0, 10);
+            let LiteralEnd::Stopped { at } = unfolded.end else { panic!("{:?}", unfolded.end) };
+            let f = fold(&three).unwrap();
+            let run = run_literal(&f.instrs, vec![encode([x, y, z]).unwrap(), 0], 0, 1 << 30);
+            let LiteralEnd::Stopped { at: folded_at } = run.end else { panic!("{:?}", run.end) };
+            prop_assert_eq!(f.first.binary_search(&folded_at), Ok(at));
+            prop_assert_eq!(run.counters[B], 0);
+            let want: [u64; 3] = unfolded.counters.try_into().unwrap();
+            prop_assert_eq!(decode(run.counters[A]), Some(want));
+        }
+    }
+
+    /// `decode` inverts `encode`, and refuses zero and a number with another prime factor.
+    #[test]
+    fn decode_inverts_encode_and_refuses_other_factors() {
+        for counters in [[0, 0, 0], [3, 1, 2], [10, 0, 5]] {
+            assert_eq!(decode(encode(counters).unwrap()), Some(counters));
+        }
+        assert_eq!(decode(0), None);
+        assert_eq!(decode(14), None);
+        assert_eq!(encode([64, 0, 0]), None);
+    }
+
+    /// Compile a toy, expand it, run its three-counter expansion and its two-counter fold literally, and
+    /// require the fold to stop at the same instruction with the same counters — and those counters to read
+    /// back to the simulator's tapes. Returns the two-counter step count.
+    fn folds(what: &str, m: &Machine, inits: &[Vec<Symbol>]) -> u64 {
+        let c = compile(m, inits).unwrap();
+        let e = expand(&c.program).unwrap();
+        let counters: Vec<u64> = c.counters.iter().map(|v| u64::try_from(v).unwrap()).collect();
+        let start = e.first[c.program.start];
+        let three = run_literal(&e.instrs, counters.clone(), start, 1 << 40);
+        let LiteralEnd::Stopped { at } = three.end else { panic!("{what}: {:?}", three.end) };
+
+        let f = fold(&e.instrs).unwrap();
+        let gödel = encode(counters.try_into().unwrap()).unwrap();
+        let two = run_literal(&f.instrs, vec![gödel, 0], f.first[start], 10_000_000_000);
+        let LiteralEnd::Stopped { at: folded_at } = two.end else { panic!("{what}: {:?}", two.end) };
+        assert_eq!(f.first.binary_search(&folded_at), Ok(at), "{what}: stopped elsewhere");
+        assert_eq!(two.counters[B], 0, "{what}: scratch");
+        let decoded = decode(two.counters[A]).unwrap_or_else(|| panic!("{what}: not a Gödel number"));
+        assert_eq!(decoded.to_vec(), three.counters, "{what}: counters");
+
+        let Macro::Stop { head, .. } = &c.program.macros[e.owner[at]] else { panic!("{what}: not a Stop") };
+        let big: Vec<Nat> = decoded.iter().map(|v| Nat::from(*v)).collect();
+        let got = readback::tapes(&big, head, &c.symbols).unwrap();
+        let (want, ..) = simulate_final(m, inits, TmCaps { steps: 1_000_000, cells: 1_000_000 });
+        let (cells, h) = want[0].snapshot();
+        assert_eq!(normalize(&got[0].0, got[0].1), normalize(&cells, h), "{what}: tape");
+        two.steps
+    }
+
+    /// The two-counter fold of the unary incrementer and of the parity eraser, each on up to four marks, stops
+    /// where the three-counter program does, with the same counters and the same tape.
+    #[test]
+    fn toys_fold_to_two_counters() {
+        for n in 0..=4 {
+            folds(&format!("increment n={n}"), &toys::increment(), &[vec!['1'; n]]);
+            folds(&format!("parity_eraser n={n}"), &toys::parity_eraser(), &[vec!['1'; n]]);
+        }
+    }
+
+    /// The parity eraser on five marks, which takes over two hundred million two-counter steps.
+    #[test]
+    #[ignore = "slow tier: over 1 s in a debug build; run via scripts/check-slow.sh"]
+    fn the_parity_eraser_on_five_marks_folds_to_two_counters() {
+        let steps = folds("parity_eraser n=5", &toys::parity_eraser(), &[vec!['1'; 5]]);
+        println!("parity_eraser n=5: {steps} two-counter steps");
+    }
+
+    /// The binary incrementer on three ones, which takes over two billion two-counter steps.
+    #[test]
+    #[ignore = "slow tier: over two billion literal two-counter steps; run via scripts/check-slow.sh"]
+    fn the_binary_incrementer_folds_to_two_counters() {
+        let steps = folds("binary_increment n=3", &toys::binary_increment(), &[vec!['1'; 3]]);
+        println!("binary_increment n=3: {steps} two-counter steps");
+    }
+}
````
<!-- END task5.patch -->

- [ ] **Step 3: Format check and lint**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cargo fmt --all --check; echo "fmt exit $?"
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo clippy -p redextape-core --all-targets -- -D warnings; echo "clippy exit $?"
```

Expected: `fmt exit 0` with no diff printed; `clippy exit 0` with no warning.

- [ ] **Step 4: Run the fast tier**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib --test counter_oracle -E 'test(/^counter::/) | binary_id(redextape-core::counter_oracle)'
```

Expected summary line: `22 tests run: 22 passed, 836 skipped`

- [ ] **Step 5: Run the two text gates**

```bash
cd "$P" && bash scripts/check-attributions.sh | grep checked; bash scripts/check-citations.sh | tail -1
```

Expected:
- `checked 483 attribution sites, 6 excused by marker, 0 violations`
- a citations line containing `467 files scanned, 0 violations`

- [ ] **Step 6: Commit**

```bash
CARGO_TARGET_DIR="$P/target" git -C "$P" commit -F - <<'EOF'
Fold three counters into two by Gödel numbering, on toy machines

godel::fold compiles a literal three-counter program into one over two
counters, A holding 2^x * 3^y * 5^z and B scratch. It runs literally,
and only on toys: every folded instruction costs steps in proportion to
A. A proptest holds one folded Inc or Dec to its unfolded effect; the
unary incrementer and the parity eraser on up to four marks fold, stop
where the three-counter program stops, and read back to the simulator's
tape, with the parity eraser on five marks and the binary incrementer
on three ones in the slow tier.
EOF
```

Expected: every hook reports `Passed` or `Skipped`.

- [ ] **Step 7: Run the wasm32 rows of `scripts/check-all.sh`**

These are that script's `wasm` rows, run directly. Each row calls `wasm` with its arguments as separate words, because zsh does not split a variable into words; see the Global Constraints.

```bash
wasm() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo check --target wasm32-unknown-unknown "$@" >/dev/null 2>&1; echo "wasm32 $*: exit $?"; }
wasm -p redextape-core --lib
wasm -p redextape-core --lib --features serde
wasm -p redextape-core --lib --features ts
wasm -p redextape-wasm --lib
wasm -p redextape-wasm --lib --features ts
```

Expected: each of the five rows prints `exit 0`.

Measured at `936ca8a` with this block, in one Bash tool call: all five rows printed `exit 0`.

The first version of this step held each row in a variable. Run through the Bash tool, its first row exits 101 with ``invalid character ` ` in package name``. So its recorded `exit 0`, at `74906c4` and at `936ca8a`, did not come from zsh; the `936ca8a` reading came from a bash script, where the variable splits.

- [ ] **Step 8: Run the slow tier in release**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run --release -p redextape-core --lib --test counter_oracle -E 'test(/^counter::/) | binary_id(redextape-core::counter_oracle)' --run-ignored only --no-capture 2>&1 | grep -E "PASS|FAIL|Summary|two-counter steps|literal steps"
```

Expected: every test passes. As measured:

At `74906c4`, starting at a load average of 13.9:

| test | time | count printed |
| --- | --- | --- |
| `the_binary_incrementer_folds_to_two_counters` | 4.069 s | 2,530,013,456 two-counter steps |
| `the_parity_eraser_on_five_marks_folds_to_two_counters` | 0.357 s | 220,027,664 two-counter steps |
| `a_binding_runs_as_a_counter_machine` | 1.344 s | 22,495,905 moves, largest counter 10,356 bits |
| `a_call_runs_as_a_counter_machine` | 0.459 s | 6,747,237 moves, largest counter 2,659 bits |
| `a_lowered_sum_agrees_literally` | 0.343 s | 206,024,328 literal steps |
| `recursion_runs_as_a_counter_machine` | 17.350 s | 303,419,137 moves, largest counter 7,504 bits |

Summary line: `6 tests run: 6 passed, 852 skipped`.

At `936ca8a`, every test passed again with the same summary line, and each printed the same count as the table. Its times are not recorded here.

- [ ] **Step 9: Run the whole crate's normal tier**

```bash
cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core
```

Expected: `1153 tests run: 1153 passed, 20 skipped`, measured at `74906c4` in 50.484 s, starting at a load average of 16.0, and the same summary at `936ca8a`. Against the baseline's `1131 passed, 14 skipped`, that is this plan's 22 fast-tier tests and 6 slow-tier ones.

In this run every test runs in parallel, and two fast-tier tests took over 1 s: `a_conditional_runs_as_a_counter_machine` 1.318 s and `arithmetic_runs_as_a_counter_machine` 1.795 s. The tier is measured with a test timed on its own; see *Figures*.

- [ ] **Step 10: Run the sabotages, restoring after each**

Each edit is an exact-text replacement that must match exactly once, applied by the helper below. After every row, restore with `git -C "$P" checkout -- crates/redextape-core/src/`, delete the `crates/redextape-core/proptest-regressions/` directory a failing proptest writes, and confirm `git -C "$P" status --short` prints nothing for `crates/`.

<!-- BEGIN sab.py -->
```python
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
n = text.count(old)
if n != 1:
    sys.exit(f"SABOTAGE NOT APPLIED: expected exactly 1 match in {path}, found {n}")
open(path, "w").write(text.replace(old, new))
```
<!-- END sab.py -->

The helpers and the seven edits are one block, and each edit is followed by `restore`. **Run the whole block in a single Bash tool call, with a timeout of 600000 ms.** A function does not outlive the call that defines it, and at `936ca8a` the block took 102 s, starting at a load average of 1.03, 91.6 s of it S4's.

```bash
block_of sab.py >| "$S/sab.py"
fast() { cd "$P" && CARGO_TARGET_DIR="$P/target" cap cargo nextest run -p redextape-core --lib --test counter_oracle -E 'test(/^counter::/) | binary_id(redextape-core::counter_oracle)' --no-fail-fast 2>&1 | grep -E "^\s+FAIL \[|Summary"; }
restore() { git -C "$P" checkout -- crates/redextape-core/src/ && rm -rf "${P:?}/crates/redextape-core/proptest-regressions" && git -C "$P" status --short -- crates/; }
C="$P/crates/redextape-core/src/counter"

# S1: move_steps charges one step too many
python3 "$S/sab.py" "$C/program.rs" '    steps.add(&Nat::from(u128::from(digit) + u128::from(s) + 4));' '    steps.add(&Nat::from(u128::from(digit) + u128::from(s) + 5));' && fast; restore

# S2: move_steps charges (b + 2) where the expansion takes (b + 3)
python3 "$S/sab.py" "$C/program.rs" '    steps.mul_add(base + 3, 0);' '    steps.mul_add(base + 2, 0);' && fast; restore

# S3: the compiler uses base b - 1
python3 "$S/sab.py" "$C/compile.rs" '    let b = u64::try_from(symbols.len()).map_err(|_| CompileError::TooLarge)?;' '    let b = u64::try_from(symbols.len() - 1).map_err(|_| CompileError::TooLarge)?;' && fast; restore

# S4: the fold's Inc on counter 1 multiplies by 5 instead of 3
python3 "$S/sab.py" "$C/godel.rs" $'            Instr::Inc { c, next } => {\n                let p = prime(c)?;' $'            Instr::Inc { c, next } => {\n                let p = if c == 1 { 5 } else { prime(c)? };' && fast; restore

# S5: a cycle of rules that never move compiles to Stop instead of Spin
python3 "$S/sab.py" "$C/compile.rs" '                break self.push(Macro::Spin)?;' '                break self.push(Macro::Stop { state: q, head: h })?;' && fast; restore

# S6: the reciprocal division skips its final correction
python3 "$S/sab.py" "$C/nat.rs" $'        if remainder >= d {\n            quotient = quotient.wrapping_add(1);\n            remainder -= d;\n        }\n' '' && fast; restore

# S7: the deferred tally skips folding a counter's hi before a refill changes it
python3 "$S/sab.py" "$C/accel.rs" $'        if self.counters.get(c).is_some_and(|k| k.digits == 0) {\n            self.fold(c);\n' $'        if self.counters.get(c).is_some_and(|k| k.digits == 0) {\n' && fast; restore
```

Expected, as measured. The clean fast tier is `22 tests run: 22 passed, 836 skipped`:

Measured at `74906c4`. At `936ca8a` the rows ran twice, once from a bash script and once as this block through the Bash tool. Both times, every row but S6 reddened the tests below and left the rest green; S6's row gives both of its results:

| row | sabotage | red | green |
| --- | --- | --- | --- |
| S1 | `move_steps` charges one step too many | `a_move_takes_exactly_its_formulas_steps`, `buffered_counters_and_their_tally_match_plain_arithmetic` — `20 passed, 2 failed` | the rest, including `accelerated_and_literal_runs_agree_at_every_macro_entry`, `compiled_toys_agree_with_the_simulator_and_their_literal_expansion` and `a_lowered_literal_agrees_literally` |
| S2 | `move_steps` charges `(b + 2)` | the same two — `20 passed, 2 failed` | the same |
| S3 | the compiler uses base `b - 1` | at compilation, with `Degenerate`: `compiled_toys_agree_with_the_simulator_and_their_literal_expansion`, `toys_fold_to_two_counters`, `a_lowered_literal_agrees_literally`; at the tape comparison: the four fast stage 1 oracle tests — `15 passed, 7 failed` | the rest |
| S4 | the fold's `Inc` on counter 1 multiplies by 5 | `one_instruction_folds_to_the_same_effect`, `toys_fold_to_two_counters` — `20 passed, 2 failed` | the rest |
| S5 | a spinning cycle compiles to `Stop` | `a_cycle_of_rules_that_never_move_compiles_to_spin`, on its start-macro assertion — `21 passed, 1 failed` | the rest |
| S6 | the reciprocal division skips its final correction | `division_inverts_multiplication_on_large_numbers` on every run; `buffered_counters_and_their_tally_match_plain_arithmetic` on some — `20 passed, 2 failed` at `74906c4` and in the bash run at `936ca8a`, `21 passed, 1 failed` in the Bash tool run at `936ca8a` | `operations_agree_with_u128`, and the rest |
| S7 | the deferred tally skips folding `hi` before a refill | `buffered_counters_and_their_tally_match_plain_arithmetic` — `21 passed, 1 failed` | the rest, including `accelerated_and_literal_runs_agree_at_every_macro_entry` |

**S4 is slow to fail.** At `936ca8a` its slower red test took 88.6 s in one run and 91.6 s in the other. `fast` sets no timeout, so wait for it.

What these found is decisions 7 to 10.

---

## Figures, measured while planning

**These are not steps.** They were taken with an untracked probe, `crates/redextape-core/examples/counter_corpus_probe.rs` in the scratch worktree. For each program it lowers under unary, builds the stage 1 image with `PAD` 2, simulates it, compiles it, runs it accelerated, and checks the tape, the halting state, the scratch counter and the value. Every run that stopped checked `true` on all four. Each ran under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`, built in release: through `cargo run --release --example counter_corpus_probe -p redextape-core`, or for `74906c4` with `cargo build` and the binary run directly.

### The stage 1 corpus, across the designs this plan went through

`sum(5)`'s stage 1 image is 22,696 states and runs 303,610,850 Turing machine steps; its counter program executes 303,419,137 moves. Accelerated wall time, release, 8G cap:

| program | moves | three macros on `num-bigint` | one `Move` on `num-bigint` | one `Move` on `Nat` | buffered counters, `74906c4` |
| --- | --- | --- | --- | --- | --- |
| `3 - 5` | 256,351 | 0.095 s | 0.030 s | 0.022 s | 0.004 s |
| `cons(1, cons(2, nil))` | 396,441 | 0.138 s | 0.065 s | 0.032 s | 0.007 s |
| `if 2 > 1 { 10 } else { 20 }` | 1,497,261 | 0.878 s | 0.306 s | 0.207 s | 0.034 s |
| `1 + 2 * 3` | 1,603,003 | 0.724 s | 0.358 s | 0.162 s | 0.030 s |
| `pair_sum(1, add1(2))` | 6,747,237 | 3.673 s | 1.779 s | 1.044 s | 0.145 s |
| `let x = 40; x + 2` | 22,495,905 | 35.263 s | 14.812 s | 10.362 s | 1.171 s |
| `sum(5)` | 303,419,137 | stopped by the 400,000,000-macro cap after 103.446 s | 146.948 s | 110.246 s | 11.861 s |

- **The "three macros" column counts macros, not moves:** `Transfer`, `Add` and `DivMod`. `3 - 5` executed 1,162,185 of them.
- **The `Nat` column** divides through the reciprocal with its first correction as a mask, and carries the step count lazily. An earlier `Nat` build, with both corrections as branches and a carrying add, ran `let x` in 12.311 s and `sum(5)` in 124.985 s.
- **The buffered column** started at a load average of 27.8. The same design at `ee47c1c`, whose code differs from `74906c4` only in comments, ran `let x` in 1.681 s and `sum(5)` in 17.994 s at a load average near 77. Before it was adopted, an untracked probe of the design matched the unbuffered run's step counts and counters exactly on every program but `sum(5)`, and ran `let x` in 1.197 s and `sum(5)` in 17.421 s.
- **Largest counter,** in bits, and the bit length of the literal step count computed: `3 - 5` 1,253 and 1,264; `cons` 1,203 and 1,214; `if` 2,855 and 2,867; `1 + 2 * 3` 1,956 and 1,969; `pair_sum` 2,659 and 2,674; `let x` 10,356 and 10,370; `sum(5)` 7,504 and 7,523. The unbuffered designs printed the same bit lengths.

### Where `let x = 40; x + 2`'s run spends its time

Self time by symbol, from `perf record` on the probe's release binary. The probe also simulates the Turing machine, which is the `TmCursor`, `sim::apply` and `sim::run` rows.

| design | top entries |
| --- | --- |
| one `Move` on `num-bigint` | `div_rem_cow` 51.83%, `scalar_mul` 19.56%, `AddAssign` 11.92%, `div_rem` 3.54% |
| buffered counters, `74906c4` | `Nat::div_rem` 34.97%, `accelerate` 25.20%, `Nat::add` 18.54%, `TmCursor::next` 7.27%, `Buffers::count` 5.50%, `sim::apply` 4.85%, `sim::run` 1.18% |

### Test times, for the tiers

Debug `cargo nextest` with `--test-threads 1`, three runs starting at load averages of 4.2, 3.8 and 3.9, at `ee47c1c`:
- **fast:** `three_minus_five` 0.144–0.153 s; `a_list` 0.347–0.359 s; `a_conditional` 0.582–0.597 s; `arithmetic` 0.678–0.692 s; `a_lowered_literal` 0.003 s
- **slow:** `a_lowered_sum` 2.300–2.352 s; `a_call` 3.055–3.238 s
- **the parity eraser on five marks,** in the slow tier: 1.909 s

### The two-counter toys

- **The unary incrementer on four marks** is 14 three-counter instructions, folded to 131, and runs 2,974,863 two-counter steps. A temporary test measured it and was removed.
- **The parity eraser on five marks** runs 220,027,664 steps and **the binary incrementer on three ones** 2,530,013,456: 0.357 s and 4.069 s in release.
- **Cross-check:** the spec's table, from the design research prototype, gives the same three step counts.

## Decisions and spec corrections found while planning

1. **One macro per head move.** The spec's `Transfer`, `Add` and `DivMod` became one `Move`, whose expansion is exactly the instruction sequence they made. Chosen on 2026-09-14, after the three macros ran `let x = 40; x + 2` in 35.263 s and `sum(5)` was stopped by a 400,000,000-macro cap after 103.446 s. **Amended in the spec.**
2. **An in-tree bignum, `nat.rs`, instead of `num-bigint`.** Chosen on 2026-09-14, after the merged `Move` on `num-bigint` ran `sum(5)` in 146.948 s, with division at 55% of `let x`'s profile. No `Cargo.toml` or `Cargo.lock` changes. **Amended in the spec.**
   - **Representation:** 64-bit limbs, least significant first, normalized, because `u128` holds every product and every two-limb numerator.
   - **Division:** Möller–Granlund 2-by-1 through a reciprocal; the first correction is a mask and the second a branch.
3. **Buffered counters and a deferred tally.** The brief left the representation to this plan and asked for deferred step counting. The in-tree bignum alone still ran `sum(5)` in 110.246 s, because every move passed over every limb of two counters. Holding a counter as `hi·b^j + lo` took it to 11.861 s at `74906c4`, with the step count still exact. **Amended in the spec.**
4. **One base per program.** `Program::base`, not a `b` on every `Move`: the run builds one `Divisor`, and the tally has one multiplier. **Amended in the spec.**
5. **The spec's literal `Stop { tm_state }` does not exist.** The literal `Stop` carries nothing; `Macro::Stop { state, head }` records the halting state and the digits under the heads. **Amended in the spec.**
6. **A move may be its own exit.** `increment` on one to four marks compiles its scan to macro 0, whose exits include 0. So `Program::check` has no self-loop rule, and a literal trace tells a macro's entries from its internal loops by `Expansion::leaves`, not by position.
7. **Rows S1 and S2 leave the agreement tests green, which the spec predicted red.** `move_steps` is called only by `literal_steps` and by `buffered_counters_and_their_tally_match_plain_arithmetic`. The accelerated tally keeps the same sum in a deferred shape with its own `b + 3` and `+ 4`. So a wrong `move_steps` reddens the `Move` proptest and the tally proptest, and every test that compares an accelerated run's steps with a literal run's stays green. **The spec's table keeps its prediction; this is the finding.**
8. **Row S5 compiles a spinning cycle to `Stop`, not to "no instructions"** as the spec wrote. `Emitter::dispatch` returns a macro index, so "no instructions" has nothing to return. Without its cycle check, its loop over rules that move no head never ends on the spinner.
9. **Row S6 is invisible to the `u128` proptest.** `division_inverts_multiplication_on_large_numbers` went red on all three runs, at `d996c04`, `ee47c1c` and `74906c4`, whose code differs only in comments. `buffered_counters_and_their_tally_match_plain_arithmetic` went red on two of them, at `d996c04` and `74906c4`; which inputs proptest draws decides that. At `936ca8a`, after decision 14's rebuild, it ran twice: the tally proptest went red in the bash run and stayed green in the Bash tool run, while the division proptest went red in both.
10. **Row S7 is seen by one test.** Deleting the fold of `hi` before a refill reddens only `buffered_counters_and_their_tally_match_plain_arithmetic`. The three other tests that compare step counts stay green: the branching agreement proptest, the compiled toys and the lowered `1`. The stage 1 oracle tests compare tapes, states and values, and no step count.
11. **A fast-tier test is timed on its own.** "Under 1 s" was not tied to a build or to concurrency. In the whole-crate run, where every test runs in parallel, `a_conditional` took 1.318 s and `arithmetic` 1.795 s. Timed on their own in debug, they took under 0.7 s. **Amended in the spec.**
12. **`Run::largest_bits` is measured at the start, at flushes and at the end.** Between flushes a counter gains at most `k` digits with `b^k` in a `u64`, so the true peak is at most 65 bits higher.
13. **Literal runs of compiled programs are limited to lowered machines.** The lowered `1` and `1 + 1` have 5 tapes and compile to 11 counters; `1 + 1` takes 206,024,328 literal steps. No stage 1 image is within reach: `3 - 5`'s stands for about 10^380.
14. **One test-support function states literal-against-accelerated agreement.** The first version of this plan wrote the same comparison twice: in the toys' `agrees` and in `tests/counter_oracle.rs`'s `literal_and_accelerated_agree`. Chosen on 2026-09-15: `accel::check_literal_agreement`, `#[doc(hidden)] pub`, in the module that holds the two runs it compares.
    - **Public,** because an integration test reaches only public items, and a unit test cannot import `tests/common`.
    - **An error, not a panic,** because the workspace's clippy lints forbid a panic in library code. The tests panic with the error's text.
    - **`agrees` now checks the literal run before the simulator's tapes,** because it takes its accelerated run from the function instead of running it twice. Every assertion is still made; only which one fails first can differ.
    - **Left as it was:** Task 2's proptest `accelerated_and_literal_runs_agree_at_every_macro_entry` makes the same comparisons with `prop_assert_eq!`, which a proptest needs to shrink a failing case.
15. **The commands are written for zsh, the Bash tool's shell.** Found on 2026-09-15, after the universal-TM plan hit the same bug. Every bash block was searched for an unquoted expansion that needs word splitting, and one had it: Task 5 Step 7's loop passed each row's arguments as one word, so its first row exits 101 under zsh. It now calls a function with separate arguments. A second check found that neither a variable nor a function outlives a Bash tool call, so Step 10's helpers moved into the block that uses them, and the setup is repeated in every call. Both blocks were re-run through the Bash tool at `936ca8a`.

## Left for the controller

- **Commit the spec's amendments and this plan** before Task 1; their diff touches only `docs/`.
- **The roadmap entry.**
- **The scratch worktree** `.claude/worktrees/counter-machines-scratch` holds:
  - branch `counter-machines-scratch-6`, the five commits this plan embeds;
  - superseded branches `counter-machines-scratch` and `counter-machines-scratch-2` to `counter-machines-scratch-5`; `-5` holds the first build, which the recorded times name;
  - the untracked probe.

  All of it can be deleted without losing anything this plan does not embed.
