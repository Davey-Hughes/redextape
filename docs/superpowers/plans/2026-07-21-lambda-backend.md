# Lambda Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `redextape-core`'s lambda backend — compile the Core AST directly to a de Bruijn
λ-term (Church `Nat`, Scott `Bool`/`List`, `fix`/Y recursion, store-passing for `mut`/`while`),
reduce it normal-order while tracking the redex, decode the normal form back to a `Value`, and ship a
round-tripping λ text form — delivering the **two-way oracle**: `reference == decoded λ normal form`.

**Architecture:** A new `lambda` submodule of the existing `redextape-core` crate. The pipeline is
`Core → LambdaTerm → reduce → normal form → Value`, plus `text ↔ LambdaTerm` (parse/print). Binders
are **de Bruijn indices from day 1** (so substitution is pure index arithmetic — no α-renaming, no
capture), with a print-only name hint per binder. Reduction is **normal-order (leftmost-outermost)**
with a step cap. Compilation is syntax-directed so each task's lowering is compositional.

**Tech Stack:** Rust (edition 2024), zero runtime deps; `proptest` (existing dev-dep) for round-trip
and oracle properties. Builds only on Plan 1's `core::{Core, BinOp, NodeId}` and `value::Value`.

**Design source:** [`docs/superpowers/specs/2026-07-21-lambda-backend-design.md`](../specs/2026-07-21-lambda-backend-design.md).

## Global Constraints

Every task's requirements implicitly include these (from the spec + repo config, exact values):

- **Rust edition 2024**; `rustfmt.toml` sets `max_width = 120`, `use_small_heuristics = "Max"`.
- Must pass, at all times: `cargo fmt --all --check`;
  `cargo clippy --workspace --all-targets -- -D warnings`;
  `cargo llvm-cov --workspace --all-targets --fail-under-lines 80`.
- **No panics on user input.** `parse_lambda` and `lower` return diagnostics/`Result`, never panic;
  only genuine internal invariants may `panic!`/`unreachable!`.
- **No process aborts on any input** (Plan 1 discipline): `LambdaTerm` gets a **hand-written
  iterative `Drop`**; reduction is bounded by a **step cap**; `parse_lambda` carries a nesting-depth
  guard mirroring the source parser. Constants are tuned empirically (measure the crash depth on an
  8 MiB debug main thread, pick ≤ half). WASM shadow-stack sizing for these limits stays a Plan 4
  follow-up.
- **Binders are de Bruijn** (`Var(u32)`, 0 = innermost). α-equivalence is de Bruijn structural; the
  `Abs` name hint is print-only and ignored by equality.
- **Encodings:** Church `Nat`; Scott `Bool`/`List`. `Nat` subtraction is **monus** (truncated).
- **Reduction:** normal-order (leftmost-outermost).
- The oracle treats "reference hit its cap" ≡ "λ hit its step cap" as the same outcome.

## Locked scope decisions (owner-confirmed)

1. **Full backend in one plan** — functional path + store-passing; the two-way oracle passes on the
   full demo suite including `count_down`.
2. **Minimal pure λ text form** — `var / \x. e / application / parens` only (accept `λ`, print `\`).
   No numeric/bool/list-literal or named-definition sugar; readability sugar is a later UI concern.
3. **Local store-passing + documented limit** — support function-local mutation. A closure that
   assigns a variable captured from an outer scope is rejected with `LowerError::StatefulClosure`;
   the oracle/proptest exclude that pattern.

## File structure

```
crates/redextape-core/src/
  lib.rs               # add `pub mod lambda;`
  lambda.rs            # submodule root: `pub mod` lines, re-exports, LowerError, run_lambda
  lambda/
    term.rs            # LambdaTerm, Dir/Path, alpha-eq (manual PartialEq), shift/subst/beta,
                       #   builders (var/abs/app), iterative Drop            (Task 1)
    encode.rs          # Church Nat + succ/plus/mult/pred/monus/is_zero; Scott Bool/List +
                       #   head/tail/is_empty; comparison combinators; binop(op)  (Task 2)
    reduce.rs          # normal-order step, reduce_trace, reduce_to_normal_form, Trace/Step/Status,
                       #   MAX_REDUCTION_STEPS, MAX_TERM_DEPTH guard         (Task 3)
    decode.rs          # decode(&LambdaTerm) -> Option<Value>                (Task 4)
    lower.rs           # lower(&Core) -> Result<LambdaTerm, LowerError>: functional path (Task 5)
                       #   + store-passing for mut/while + stateful-closure rejection (Task 6)
    syntax.rs          # parse_lambda / print_lambda + MAX_PARSE_DEPTH guard  (Task 7)
```

Task 8 wires `lambda.rs` (re-exports + `run_lambda`) and adds the two-way oracle + proptest.

---

### Task 1: de Bruijn terms — representation, substitution, iterative Drop

**Files:**
- Create: `crates/redextape-core/src/lambda/term.rs`
- Create: `crates/redextape-core/src/lambda.rs`
- Modify: `crates/redextape-core/src/lib.rs` (add `pub mod lambda;`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `term::LambdaTerm { Var(u32), Abs(String, Box<LambdaTerm>), App(Box<LambdaTerm>, Box<LambdaTerm>) }`
    with a manual `PartialEq`/`Eq` that ignores the `Abs` name hint (de Bruijn α-equality).
  - Builders `var(u32) -> LambdaTerm`, `abs(impl Into<String>, LambdaTerm) -> LambdaTerm`,
    `app(LambdaTerm, LambdaTerm) -> LambdaTerm`.
  - `shift(d: i64, cutoff: u32, &LambdaTerm) -> LambdaTerm`, `subst(j: u32, s: &LambdaTerm,
    t: &LambdaTerm) -> LambdaTerm`, `beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm`.
  - `term::{Dir, Path}` — `Dir { AppL, AppR, AbsBody }`, `Path = Vec<Dir>`.
  - A hand-written iterative `Drop for LambdaTerm`.

- [ ] **Step 1: Create the submodule root and wire it in**

Create `crates/redextape-core/src/lambda.rs`:

```rust
//! The lambda backend: Core AST -> de Bruijn lambda-term -> normal-order reduction -> `Value`,
//! plus a round-tripping lambda text form. See
//! `docs/superpowers/specs/2026-07-21-lambda-backend-design.md`.

pub mod term;
```

Add to `crates/redextape-core/src/lib.rs` (keep module declarations sorted):

```rust
pub mod lambda;
```

- [ ] **Step 2: Write the failing tests for `term.rs`**

Create `crates/redextape-core/src/lambda/term.rs` with the tests first:

```rust
//! de Bruijn lambda-terms. Indices are 0-based (0 = innermost binder). The `Abs` name hint is used
//! only when printing; equality is de Bruijn structural, so substitution is pure index arithmetic
//! (no fresh names, no capture).

#[derive(Clone, Debug)]
pub enum LambdaTerm {
    /// de Bruijn index; 0 refers to the innermost enclosing `Abs`.
    Var(u32),
    /// Abstraction with a print-only name hint and a body.
    Abs(String, Box<LambdaTerm>),
    /// Application.
    App(Box<LambdaTerm>, Box<LambdaTerm>),
}

/// A direction into a `LambdaTerm`; a `Path` locates a subterm (e.g. the reduced redex).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    AppL,
    AppR,
    AbsBody,
}

pub type Path = Vec<Dir>;

pub fn var(i: u32) -> LambdaTerm {
    LambdaTerm::Var(i)
}

pub fn abs(name: impl Into<String>, body: LambdaTerm) -> LambdaTerm {
    LambdaTerm::Abs(name.into(), Box::new(body))
}

pub fn app(f: LambdaTerm, a: LambdaTerm) -> LambdaTerm {
    LambdaTerm::App(Box::new(f), Box::new(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alpha_equality_ignores_name_hints() {
        // \x. x  ==  \y. y   (both are Abs(_, Var(0)))
        assert_eq!(abs("x", var(0)), abs("y", var(0)));
        // \x. x  !=  \x. \y. x
        assert_ne!(abs("x", var(0)), abs("x", abs("y", var(1))));
    }

    #[test]
    fn shift_adjusts_free_but_not_bound_vars() {
        // shift(1, 0, \.0 1) == \.0 2   (0 is bound, 1 is free -> becomes 2)
        let t = abs("x", app(var(0), var(1)));
        assert_eq!(shift(1, 0, &t), abs("x", app(var(0), var(2))));
    }

    #[test]
    fn beta_reduces_identity_application() {
        // (\x. x) (\y. y)  ->  \y. y
        let id = abs("y", var(0));
        let redex_body = var(0); // body of (\x. x)
        assert_eq!(beta(&redex_body, &id), id);
    }

    #[test]
    fn beta_reduces_const_application() {
        // (\x. \y. x) a  ->  \y. a   (a is a free var, index 0 outside)
        let body = abs("y", var(1)); // \y. x  where x is index 1
        let arg = var(5);
        // substituting arg for the outer binder: \y. (shifted arg)
        assert_eq!(beta(&body, &arg), abs("y", var(6)));
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p redextape-core lambda::term`
Expected: FAIL — `cannot find function 'shift'` / `beta`.

- [ ] **Step 4: Implement `shift`, `subst`, `beta`, and iterative `Drop`**

Add above the `#[cfg(test)]` module in `term.rs`:

```rust
/// Shift the free variables of `t` (those with index >= `cutoff`) by `d`.
pub fn shift(d: i64, cutoff: u32, t: &LambdaTerm) -> LambdaTerm {
    match t {
        LambdaTerm::Var(k) => {
            if *k >= cutoff {
                LambdaTerm::Var((i64::from(*k) + d) as u32)
            } else {
                LambdaTerm::Var(*k)
            }
        }
        LambdaTerm::Abs(n, b) => LambdaTerm::Abs(n.clone(), Box::new(shift(d, cutoff + 1, b))),
        LambdaTerm::App(f, a) => {
            LambdaTerm::App(Box::new(shift(d, cutoff, f)), Box::new(shift(d, cutoff, a)))
        }
    }
}

/// Substitute `s` for the variable with index `j` in `t`.
pub fn subst(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    match t {
        LambdaTerm::Var(k) => {
            if *k == j {
                s.clone()
            } else {
                LambdaTerm::Var(*k)
            }
        }
        LambdaTerm::Abs(n, b) => LambdaTerm::Abs(n.clone(), Box::new(subst(j + 1, &shift(1, 0, s), b))),
        LambdaTerm::App(f, a) => {
            LambdaTerm::App(Box::new(subst(j, s, f)), Box::new(subst(j, s, a)))
        }
    }
}

/// β-reduce `(\. abs_body) arg`: substitute `arg` for index 0 in `abs_body`, then close the hole.
pub fn beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm {
    shift(-1, 0, &subst(0, &shift(1, 0, arg), abs_body))
}

impl PartialEq for LambdaTerm {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (LambdaTerm::Var(a), LambdaTerm::Var(b)) => a == b,
            (LambdaTerm::Abs(_, a), LambdaTerm::Abs(_, b)) => a == b, // name hint ignored
            (LambdaTerm::App(f1, a1), LambdaTerm::App(f2, a2)) => f1 == f2 && a1 == a2,
            _ => false,
        }
    }
}

impl Eq for LambdaTerm {}

/// Hand-written iterative destructor: a deep term (large lowering / reduction growth) would
/// otherwise recurse once per node in the compiler-generated `drop_in_place` and abort the
/// process. Unlink the `Box` children into a worklist and drain it with bounded stack.
impl Drop for LambdaTerm {
    fn drop(&mut self) {
        let mut stack: Vec<LambdaTerm> = Vec::new();
        take_children(self, &mut stack);
        while let Some(mut node) = stack.pop() {
            take_children(&mut node, &mut stack);
        }
    }
}

fn take_children(t: &mut LambdaTerm, stack: &mut Vec<LambdaTerm>) {
    match t {
        LambdaTerm::Abs(_, b) => stack.push(*std::mem::replace(b, Box::new(LambdaTerm::Var(0)))),
        LambdaTerm::App(f, a) => {
            stack.push(*std::mem::replace(f, Box::new(LambdaTerm::Var(0))));
            stack.push(*std::mem::replace(a, Box::new(LambdaTerm::Var(0))));
        }
        LambdaTerm::Var(_) => {}
    }
}
```

> **Note on `Drop` + moves:** as in Plan 1, `impl Drop` forbids moving fields out of an owned
> `LambdaTerm`. Match/destructure owned terms through a reference (`match &t { … }`) if the compiler
> flags a partial move.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p redextape-core lambda::term`
Expected: PASS — all 4 term tests.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/lambda.rs crates/redextape-core/src/lambda/term.rs \
        crates/redextape-core/src/lib.rs
git commit -m "feat(lambda): add de Bruijn terms with shift/subst and iterative Drop"
```

---

### Task 2: Church / Scott encodings and combinators

**Files:**
- Create: `crates/redextape-core/src/lambda/encode.rs`
- Modify: `crates/redextape-core/src/lambda.rs` (add `pub mod encode;`)

**Interfaces:**
- Consumes: `term::{LambdaTerm, var, abs, app}`.
- Produces (all closed `LambdaTerm`s):
  - `church(n: u64) -> LambdaTerm` (Church numeral), `succ()`, `plus()`, `mult()`, `pred()`,
    `monus()`, `is_zero()`.
  - `tru()`, `fls()` (Scott/Church booleans), `nil()`, `cons()`, `head()`, `tail()`, `is_empty()`.
  - `binop(op: core::BinOp) -> LambdaTerm` — the combinator for a Core binary operator; arithmetic
    ops yield a `Nat`-combinator, comparisons a `Bool`-combinator.

Reduction (`reduce_to_normal_form`) does not exist yet, so verify combinators by **constructing the
application and comparing its normal form** — but Task 2 predates Task 3. Therefore Task 2's tests
assert **structural** shapes only (e.g. `church(2) == abs("f", abs("x", app(var(1), app(var(1),
var(0)))))`); the *behavioral* checks (`plus 2 3` normalizes to `church(5)`) live in Task 3's tests,
which have the reducer. Keep Task 2 purely constructive.

- [ ] **Step 1: Write the failing structural tests**

Create `crates/redextape-core/src/lambda/encode.rs` with tests first:

```rust
//! Church `Nat` and Scott `Bool`/`List` encodings as closed de Bruijn lambda-terms, plus the
//! arithmetic, comparison, and list combinators the lowering uses. Behavioral correctness (these
//! reduce to the right normal forms) is covered in `reduce.rs`'s tests.

use crate::lambda::term::{LambdaTerm, abs, app, var};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn church_zero_and_two_have_the_right_shape() {
        // 0 = \f.\x. x
        assert_eq!(church(0), abs("f", abs("x", var(0))));
        // 2 = \f.\x. f (f x)
        assert_eq!(church(2), abs("f", abs("x", app(var(1), app(var(1), var(0))))));
    }

    #[test]
    fn scott_booleans_have_the_right_shape() {
        // true = \t.\f. t ; false = \t.\f. f
        assert_eq!(tru(), abs("t", abs("f", var(1))));
        assert_eq!(fls(), abs("t", abs("f", var(0))));
    }

    #[test]
    fn scott_nil_and_cons_have_the_right_shape() {
        // nil = \n.\c. n ; cons = \h.\t.\n.\c. c h t
        assert_eq!(nil(), abs("n", abs("c", var(1))));
        assert_eq!(cons(), abs("h", abs("t", abs("n", abs("c", app(app(var(0), var(3)), var(2)))))));
    }

    #[test]
    fn binop_dispatches_arith_and_comparison() {
        use crate::core::BinOp;
        // Smoke: every operator produces some closed term without panicking.
        for op in [
            BinOp::Add, BinOp::Sub, BinOp::Mul, BinOp::Eq, BinOp::Ne, BinOp::Lt, BinOp::Le,
            BinOp::Gt, BinOp::Ge,
        ] {
            let _ = binop(op);
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core lambda::encode`
Expected: FAIL — `cannot find function 'church'`.

- [ ] **Step 3: Implement the encodings**

Add above the `#[cfg(test)]` module in `encode.rs`. (These are standard combinators; the de Bruijn
indices are pre-computed. The implementer should verify each against the structural tests, then the
behavioral tests in Task 3.)

```rust
use crate::core::BinOp;

/// Church numeral `n` = `\f.\x. fⁿ x`.
pub fn church(n: u64) -> LambdaTerm {
    let mut body = var(0); // x
    for _ in 0..n {
        body = app(var(1), body); // f (…)
    }
    abs("f", abs("x", body))
}

/// `succ = \n.\f.\x. f (n f x)`
pub fn succ() -> LambdaTerm {
    abs("n", abs("f", abs("x", app(var(1), app(app(var(2), var(1)), var(0))))))
}

/// `plus = \m.\n.\f.\x. m f (n f x)`
pub fn plus() -> LambdaTerm {
    abs("m", abs("n", abs("f", abs("x", app(app(var(3), var(1)), app(app(var(2), var(1)), var(0)))))))
}

/// `mult = \m.\n.\f. m (n f)`
pub fn mult() -> LambdaTerm {
    abs("m", abs("n", abs("f", app(var(2), app(var(1), var(0))))))
}

/// `pred = \n.\f.\x. n (\g.\h. h (g f)) (\u. x) (\u. u)`  (standard Church predecessor)
pub fn pred() -> LambdaTerm {
    abs(
        "n",
        abs(
            "f",
            abs(
                "x",
                app(
                    app(
                        app(var(2), abs("g", abs("h", app(var(0), app(var(1), var(3)))))),
                        abs("u", var(1)),
                    ),
                    abs("u", var(0)),
                ),
            ),
        ),
    )
}

/// `monus = \m.\n. n pred m`  (truncated subtraction: apply `pred` `n` times to `m`).
pub fn monus() -> LambdaTerm {
    abs("m", abs("n", app(app(var(0), pred()), var(1))))
}

/// `is_zero = \n. n (\x. false) true`
pub fn is_zero() -> LambdaTerm {
    abs("n", app(app(var(0), abs("x", fls())), tru()))
}

/// Scott/Church `true = \t.\f. t`.
pub fn tru() -> LambdaTerm {
    abs("t", abs("f", var(1)))
}

/// Scott/Church `false = \t.\f. f`.
pub fn fls() -> LambdaTerm {
    abs("t", abs("f", var(0)))
}

/// `not = \b. b false true`
pub fn not() -> LambdaTerm {
    abs("b", app(app(var(0), fls()), tru()))
}

/// `and = \a.\b. a b false`
pub fn and() -> LambdaTerm {
    abs("a", abs("b", app(app(var(1), var(0)), fls())))
}

/// Scott `nil = \n.\c. n`.
pub fn nil() -> LambdaTerm {
    abs("n", abs("c", var(1)))
}

/// Scott `cons = \h.\t.\n.\c. c h t`.
pub fn cons() -> LambdaTerm {
    abs("h", abs("t", abs("n", abs("c", app(app(var(0), var(3)), var(2))))))
}

/// `head = \l. l DIVERGE (\h.\t. h)` — the `nil` branch is an arbitrary closed term; the
/// interpreter's `head(nil)` is a runtime error, and the oracle only compares programs that do not
/// evaluate it. Use `\h.\t. h` for the cons branch.
pub fn head() -> LambdaTerm {
    abs("l", app(app(var(0), diverge()), abs("h", abs("t", var(1)))))
}

/// `tail = \l. l DIVERGE (\h.\t. t)`
pub fn tail() -> LambdaTerm {
    abs("l", app(app(var(0), diverge()), abs("h", abs("t", var(0)))))
}

/// `is_empty = \l. l true (\h.\t. false)`
pub fn is_empty() -> LambdaTerm {
    abs("l", app(app(var(0), tru()), abs("h", abs("t", fls()))))
}

/// A closed non-normalizing term used as the `nil` branch of `head`/`tail`. Never selected by a
/// well-typed program that does not take `head`/`tail` of an empty list.
fn diverge() -> LambdaTerm {
    // (\x. x x) (\x. x x)
    let omega = abs("x", app(var(0), var(0)));
    app(omega.clone(), omega)
}

/// Comparison combinators on Church numerals -> Scott bool. `le m n = is_zero (monus m n)`.
fn le() -> LambdaTerm {
    abs("m", abs("n", app(is_zero(), app(app(monus(), var(1)), var(0)))))
}

/// `eq m n = and (le m n) (le n m)`
fn eq() -> LambdaTerm {
    abs("m", abs("n", app(app(and(), app(app(le(), var(1)), var(0))), app(app(le(), var(0)), var(1)))))
}

/// The lambda-term implementing a Core binary operator.
pub fn binop(op: BinOp) -> LambdaTerm {
    match op {
        BinOp::Add => plus(),
        BinOp::Sub => monus(),
        BinOp::Mul => mult(),
        BinOp::Eq => eq(),
        BinOp::Ne => abs("m", abs("n", app(not(), app(app(eq(), var(1)), var(0))))),
        BinOp::Lt => abs("m", abs("n", app(app(le(), app(succ(), var(1))), var(0)))), // m+1 <= n
        BinOp::Le => le(),
        BinOp::Gt => abs("m", abs("n", app(app(le(), app(succ(), var(0))), var(1)))), // n+1 <= m
        BinOp::Ge => abs("m", abs("n", app(app(le(), var(0)), var(1)))),              // n <= m
    }
}
```

> **Implementer note:** `head`/`tail`'s `nil` branch uses a divergent term (`Ω`). Under normal
> order `Ω` is never reduced unless selected, so it costs nothing on valid programs. The behavioral
> tests in Task 3 confirm each combinator; if any structural test in this task disagrees with the
> shape above, trust the *behavioral* test and fix the combinator's indices.

- [ ] **Step 4: Wire the module + run the tests**

Add to `crates/redextape-core/src/lambda.rs`: `pub mod encode;`

Run: `cargo test -p redextape-core lambda::encode`
Expected: PASS — the 4 structural tests.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean. (Combinator helpers not yet used outside tests may trip `dead_code`; keep `le`/`eq`
etc. `pub(crate)` if needed, or ensure `binop` references them so they are reachable.)

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/lambda/encode.rs crates/redextape-core/src/lambda.rs
git commit -m "feat(lambda): add Church/Scott encodings and operator combinators"
```

---

### Task 3: Normal-order reducer + trace + step cap

**Files:**
- Create: `crates/redextape-core/src/lambda/reduce.rs`
- Modify: `crates/redextape-core/src/lambda.rs` (add `pub mod reduce;`)

**Interfaces:**
- Consumes: `term::{LambdaTerm, Dir, Path, beta}`, `encode::*` (tests only).
- Produces:
  - `MAX_REDUCTION_STEPS: u64` (default cap), `Status { Normalized, HitCap }`.
  - `Step { term: LambdaTerm, redex: Path }`, `Trace { steps: Vec<Step>, normal_form: LambdaTerm,
    status: Status }`.
  - `reduce_step(&LambdaTerm) -> Option<(LambdaTerm, Path)>` — one leftmost-outermost β-step, or
    `None` if already in normal form.
  - `reduce_trace(&LambdaTerm, cap: u64) -> Trace` and
    `reduce_to_normal_form(&LambdaTerm, cap: u64) -> (LambdaTerm, Status)`.

- [ ] **Step 1: Write the failing tests (behavioral — these validate Task 2's combinators too)**

Create `crates/redextape-core/src/lambda/reduce.rs` with tests first:

```rust
//! Normal-order (leftmost-outermost) β-reduction over de Bruijn terms, tracking the redex path per
//! step. A step cap bounds non-terminating reduction (returns a partial trace + `HitCap`).

use crate::lambda::term::{Dir, LambdaTerm, Path, beta};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lambda::encode::*;
    use crate::lambda::term::{abs, app, var};

    fn nf(t: &LambdaTerm) -> LambdaTerm {
        let (n, status) = reduce_to_normal_form(t, MAX_REDUCTION_STEPS);
        assert!(matches!(status, Status::Normalized), "expected normalization");
        n
    }

    #[test]
    fn identity_application_reduces() {
        let t = app(abs("x", var(0)), abs("y", var(0)));
        assert_eq!(nf(&t), abs("y", var(0)));
    }

    #[test]
    fn church_arithmetic_normalizes() {
        assert_eq!(nf(&app(app(plus(), church(2)), church(3))), church(5));
        assert_eq!(nf(&app(app(mult(), church(2)), church(3))), church(6));
        assert_eq!(nf(&app(pred(), church(4))), church(3));
        // monus is truncated: 3 - 5 = 0
        assert_eq!(nf(&app(app(monus(), church(3)), church(5))), church(0));
    }

    #[test]
    fn comparisons_normalize_to_booleans() {
        use crate::core::BinOp;
        assert_eq!(nf(&app(app(binop(BinOp::Lt), church(1)), church(2))), tru());
        assert_eq!(nf(&app(app(binop(BinOp::Le), church(2)), church(2))), tru());
        assert_eq!(nf(&app(app(binop(BinOp::Eq), church(2)), church(3))), fls());
        assert_eq!(nf(&app(app(binop(BinOp::Ge), church(3)), church(1))), tru());
    }

    #[test]
    fn scott_list_operations_normalize() {
        // is_empty nil -> true ; is_empty (cons 1 nil) -> false
        assert_eq!(nf(&app(is_empty(), nil())), tru());
        let one_list = app(app(cons(), church(1)), nil());
        assert_eq!(nf(&app(is_empty(), one_list.clone())), fls());
        // head (cons 7 nil) -> 7
        let seven_list = app(app(cons(), church(7)), nil());
        assert_eq!(nf(&app(head(), seven_list)), church(7));
    }

    #[test]
    fn if_only_reduces_the_taken_branch() {
        // true A B -> A, even if B diverges: normal order never touches B.
        let omega = abs("x", app(var(0), var(0)));
        let diverge = app(omega.clone(), omega);
        let t = app(app(tru(), church(1)), diverge);
        assert_eq!(nf(&t), church(1));
    }

    #[test]
    fn non_termination_hits_the_cap() {
        let omega = abs("x", app(var(0), var(0)));
        let t = app(omega.clone(), omega);
        let (_, status) = reduce_to_normal_form(&t, 1000);
        assert!(matches!(status, Status::HitCap));
    }

    #[test]
    fn trace_records_the_first_redex_path() {
        // (\x.x) ((\y.y) z) — leftmost-outermost redex is the OUTER application (root).
        let inner = app(abs("y", var(0)), var(9));
        let t = app(abs("x", var(0)), inner);
        let step = reduce_step(&t).expect("a redex exists");
        assert_eq!(step.1, Vec::<Dir>::new()); // redex at the root
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core lambda::reduce`
Expected: FAIL — `cannot find function 'reduce_to_normal_form'`.

- [ ] **Step 3: Implement the reducer**

Add above the `#[cfg(test)]` module in `reduce.rs`:

```rust
/// Default reduction step cap. High enough for the demo suite, low enough to fail fast instead of
/// hanging. Mirrors the interpreter's `DEFAULT_BUDGET` philosophy.
pub const MAX_REDUCTION_STEPS: u64 = 5_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Normalized,
    HitCap,
}

#[derive(Clone, Debug)]
pub struct Step {
    /// The term *before* this step.
    pub term: LambdaTerm,
    /// Path to the redex reduced in this step.
    pub redex: Path,
}

#[derive(Clone, Debug)]
pub struct Trace {
    pub steps: Vec<Step>,
    pub normal_form: LambdaTerm,
    pub status: Status,
}

/// Perform one leftmost-outermost β-step. Returns the reduced term and the path to the redex, or
/// `None` if `t` is already in normal form.
pub fn reduce_step(t: &LambdaTerm) -> Option<(LambdaTerm, Path)> {
    // Redex at the root: (\. body) arg
    if let LambdaTerm::App(f, a) = t
        && let LambdaTerm::Abs(_, body) = f.as_ref()
    {
        return Some((beta(body, a), Vec::new()));
    }
    match t {
        LambdaTerm::App(f, a) => {
            // Try the function side first (leftmost), then the argument.
            if let Some((f2, mut path)) = reduce_step(f) {
                path.insert(0, Dir::AppL);
                Some((LambdaTerm::App(Box::new(f2), a.clone()), path))
            } else if let Some((a2, mut path)) = reduce_step(a) {
                path.insert(0, Dir::AppR);
                Some((LambdaTerm::App(f.clone(), Box::new(a2)), path))
            } else {
                None
            }
        }
        LambdaTerm::Abs(n, b) => reduce_step(b).map(|(b2, mut path)| {
            path.insert(0, Dir::AbsBody);
            (LambdaTerm::Abs(n.clone(), Box::new(b2)), path)
        }),
        LambdaTerm::Var(_) => None,
    }
}

/// Reduce to normal form (or the cap), recording every step and its redex path.
pub fn reduce_trace(t: &LambdaTerm, cap: u64) -> Trace {
    let mut current = t.clone();
    let mut steps = Vec::new();
    let mut n = 0u64;
    while n < cap {
        match reduce_step(&current) {
            Some((next, redex)) => {
                steps.push(Step { term: current.clone(), redex });
                current = next;
                n += 1;
            }
            None => return Trace { steps, normal_form: current, status: Status::Normalized },
        }
    }
    Trace { steps, normal_form: current, status: Status::HitCap }
}

/// Reduce to normal form (or the cap) without retaining the intermediate steps.
pub fn reduce_to_normal_form(t: &LambdaTerm, cap: u64) -> (LambdaTerm, Status) {
    let mut current = t.clone();
    let mut n = 0u64;
    while n < cap {
        match reduce_step(&current) {
            Some((next, _)) => {
                current = next;
                n += 1;
            }
            None => return (current, Status::Normalized),
        }
    }
    (current, Status::HitCap)
}
```

> **Implementer notes:**
> - The `if let … && let …` chain uses Rust 2024 let-chains. If clippy/edition disallow it here,
>   nest the `if let`s.
> - `reduce_step` is recursive over term depth. For the demo suite this stays shallow; deep-term
>   guarding (a `MAX_TERM_DEPTH` on `reduce_step`, mirroring Plan 1) is a follow-up — add it only if
>   a test or the oracle surfaces an overflow. Note it in the report if deferred.

- [ ] **Step 4: Wire the module + run the tests**

Add to `crates/redextape-core/src/lambda.rs`: `pub mod reduce;`

Run: `cargo test -p redextape-core lambda::reduce`
Expected: PASS — all 7 reducer tests (these also validate every Task 2 combinator behaviorally).

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/lambda/reduce.rs crates/redextape-core/src/lambda.rs
git commit -m "feat(lambda): add normal-order reducer with redex trace and step cap"
```

---

### Task 4: Decode normal form → `Value`

**Files:**
- Create: `crates/redextape-core/src/lambda/decode.rs`
- Modify: `crates/redextape-core/src/lambda.rs` (add `pub mod decode;`)

**Interfaces:**
- Consumes: `term::LambdaTerm`, `value::Value`, `reduce::{reduce_to_normal_form, Status}` (tests).
- Produces: `decode(nf: &LambdaTerm, expected: &Value) -> Option<Value>` — **type-directed** decode of
  a **normal-form** term. It reads `nf` according to the *type/shape* of `expected` (Church numeral
  under a `Nat` expectation, Scott bool under `Bool`, Scott list under `Nil`/`Cons`, recursing into
  list elements), and returns the **actual** decoded value (which equals `expected` iff the lambda
  computed the right answer), or `None` if `nf` doesn't match the expected shape.

**Why type-directed (a design correction):** the encodings *overlap* — `church(0) = \f.\x. x` and
Scott `false = \t.\f. f` are the identical de Bruijn term `Abs(_, Abs(_, Var(0)))`; likewise
`nil = \n.\c. n` equals `true`, and a `[0]` list is indistinguishable from `[false]`. A type-agnostic
`decode(nf)` is therefore **impossible**. The two-way oracle already has the type witness — the
reference interpreter's result `Value` — so `decode` takes it as `expected`. `decode` uses `expected`
**only for its type/shape** (which decoder to run + element types), not its numeric contents, so it
still catches a lambda that computed the wrong value (it decodes to a *different* `Value`, or `None`).

- [ ] **Step 1: Write the failing tests**

Create `crates/redextape-core/src/lambda/decode.rs` with tests first:

```rust
//! Type-directed decode of a normal-form lambda-term back to a `Value`, guided by the expected
//! value's shape. Necessary because the encodings overlap: `church(0)` and Scott `false` are the
//! same de Bruijn term (`\.\. 0`), as are `nil` and `true` (`\.\. 1`), and `[0]` is
//! indistinguishable from `[false]`. `expected` (the reference result) says how to read `nf`.

use crate::lambda::term::LambdaTerm;
use crate::value::Value;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lambda::encode::*;
    use crate::lambda::reduce::{MAX_REDUCTION_STEPS, reduce_to_normal_form};
    use crate::lambda::term::{LambdaTerm, abs, app, var};

    fn decode_nf(t: LambdaTerm, expected: &Value) -> Option<Value> {
        let (nf, _) = reduce_to_normal_form(&t, MAX_REDUCTION_STEPS);
        decode(&nf, expected)
    }

    #[test]
    fn decodes_church_numerals() {
        assert_eq!(decode(&church(0), &Value::Nat(0)), Some(Value::Nat(0)));
        assert_eq!(decode(&church(5), &Value::Nat(5)), Some(Value::Nat(5)));
        // Uses `expected` only for its TYPE: a wrong numeral still decodes to its actual value.
        assert_eq!(decode(&church(3), &Value::Nat(5)), Some(Value::Nat(3)));
    }

    #[test]
    fn overlapping_encodings_resolve_by_expected_shape() {
        // `false` and `church(0)` are the SAME term; the expectation disambiguates.
        assert_eq!(decode(&fls(), &Value::Bool(false)), Some(Value::Bool(false)));
        assert_eq!(decode(&tru(), &Value::Bool(true)), Some(Value::Bool(true)));
        // The identical term decodes as Nat(0) under a Nat expectation and Bool(false) under Bool:
        assert_eq!(decode(&church(0), &Value::Nat(0)), Some(Value::Nat(0)));
        assert_eq!(decode(&church(0), &Value::Bool(false)), Some(Value::Bool(false)));
    }

    #[test]
    fn decodes_scott_lists() {
        assert_eq!(decode(&nil(), &Value::Nil), Some(Value::Nil));
        // cons 1 (cons 2 nil), reduced, decodes (guided by [1,2]) to the value list [1, 2].
        let list = app(app(cons(), church(1)), app(app(cons(), church(2)), nil()));
        assert_eq!(decode_nf(list, &Value::list_of_nats(&[1, 2])), Some(Value::list_of_nats(&[1, 2])));
    }

    #[test]
    fn wrong_shape_decodes_to_none() {
        // A residual function under any expectation -> None.
        assert_eq!(decode(&abs("x", abs("y", app(var(1), var(0)))), &Value::Nat(0)), None);
        // A length mismatch: term is a 2-element list, expectation is 1-element -> None.
        let two = app(app(cons(), church(1)), app(app(cons(), church(2)), nil()));
        assert_eq!(decode_nf(two, &Value::list_of_nats(&[9])), None);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core lambda::decode`
Expected: FAIL — `cannot find function 'decode'`.

- [ ] **Step 3: Implement decode**

Add above the `#[cfg(test)]` module in `decode.rs`:

```rust
use std::rc::Rc;

/// Decode a normal-form term to a `Value`, guided by the type/shape of `expected`. Returns the
/// actual decoded value (equal to `expected` iff the lambda computed the right answer), or `None`
/// if `nf` doesn't match the expected shape.
pub fn decode(nf: &LambdaTerm, expected: &Value) -> Option<Value> {
    match expected {
        Value::Nat(_) => decode_church(nf).map(Value::Nat),
        Value::Bool(_) => decode_bool(nf).map(Value::Bool),
        Value::Nil => decode_nil(nf),
        Value::Cons(h, t) => decode_cons(nf, h, t),
        // No first-class encoded value to compare against.
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) => None,
    }
}

/// Church numeral `\f.\x. f (f … x)` -> the count of `f`-applications. `f` is index 1, `x` is 0.
fn decode_church(t: &LambdaTerm) -> Option<u64> {
    let LambdaTerm::Abs(_, outer) = t else { return None };
    let LambdaTerm::Abs(_, mut body) = outer.as_ref() else { return None };
    let mut count = 0u64;
    loop {
        match body.as_ref() {
            LambdaTerm::Var(0) => return Some(count), // reached x
            LambdaTerm::App(f, a) => {
                // must be `f (…)` where f is Var(1)
                if !matches!(f.as_ref(), LambdaTerm::Var(1)) {
                    return None;
                }
                count += 1;
                body = a;
            }
            _ => return None,
        }
    }
}

/// Scott bool `\t.\f. t` (true) or `\t.\f. f` (false). `t` is index 1, `f` is index 0.
fn decode_bool(t: &LambdaTerm) -> Option<bool> {
    let LambdaTerm::Abs(_, outer) = t else { return None };
    let LambdaTerm::Abs(_, body) = outer.as_ref() else { return None };
    match body.as_ref() {
        LambdaTerm::Var(1) => Some(true),
        LambdaTerm::Var(0) => Some(false),
        _ => None,
    }
}

/// Scott `nil = \n.\c. n` (`Abs(_, Abs(_, Var(1)))`).
fn decode_nil(t: &LambdaTerm) -> Option<Value> {
    let LambdaTerm::Abs(_, outer) = t else { return None };
    let LambdaTerm::Abs(_, body) = outer.as_ref() else { return None };
    match body.as_ref() {
        LambdaTerm::Var(1) => Some(Value::Nil),
        _ => None,
    }
}

/// Scott `cons = \n.\c. c H T` (`Abs(_, Abs(_, App(App(Var(0), H), T)))`). Decode `H`/`T` guided by
/// the expected head/tail values.
fn decode_cons(t: &LambdaTerm, exp_h: &Value, exp_t: &Value) -> Option<Value> {
    let LambdaTerm::Abs(_, outer) = t else { return None };
    let LambdaTerm::Abs(_, body) = outer.as_ref() else { return None };
    let LambdaTerm::App(ca, t_term) = body.as_ref() else { return None };
    // ca must be `c H`, i.e. App(Var(0), H)
    let LambdaTerm::App(c, h_term) = ca.as_ref() else { return None };
    if !matches!(c.as_ref(), LambdaTerm::Var(0)) {
        return None;
    }
    // H and T are closed subterms (don't reference n/c); decode them directly, guided by expected.
    let head = decode(h_term, exp_h)?;
    let tail = decode(t_term, exp_t)?;
    Some(Value::Cons(Rc::new(head), Rc::new(tail)))
}
```

> **Implementer note on indices in `H`/`T`:** the cons body is `c H T` under two binders (`n`=1,
> `c`=0). A well-formed encoded element `H` (a Church numeral or nested Scott value) is closed with
> respect to `n`/`c`, so decoding it directly is sound.

- [ ] **Step 4: Wire the module + run the tests**

Add to `crates/redextape-core/src/lambda.rs`: `pub mod decode;`

Run: `cargo test -p redextape-core lambda::decode`
Expected: PASS — all 4 decode tests.

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/lambda/decode.rs crates/redextape-core/src/lambda.rs
git commit -m "feat(lambda): decode Church/Scott normal forms back to Value"
```

---

### Task 5: Lowering — the functional path

**Files:**
- Create: `crates/redextape-core/src/lambda/lower.rs`
- Modify: `crates/redextape-core/src/lambda.rs` (add `pub mod lower;`, re-export `LowerError`)

**Interfaces:**
- Consumes: `core::{Core, BinOp}`, `term::{LambdaTerm, abs, app, var}`, `encode::*`.
- Produces:
  - `LowerError { StatefulClosure { node: NodeId }, Unsupported { node: NodeId, what: String } }`.
  - `lower(core: &Core) -> Result<LambdaTerm, LowerError>` — for this task, the **functional**
    subset: `Nat, Bool, Var, BinOp, If, Lambda, Apply, Let (immutable), LetRec`. `Let{mutable:true}`,
    `Assign`, `While`, and the tail-less `Unit` carrier return `Unsupported` for now (Task 6 handles
    them). `Seq` lowers by discarding the first when it is pure (see note).

This task threads a compile-time **scope**: a `Vec<String>` of in-scope binder names, innermost
last. `Var(name)` resolves to the de Bruijn index `scope.len() - 1 - position_of_innermost(name)`.
Prelude names (`nil/cons/head/tail/is_empty`) that are not shadowed resolve to their encoders.

- [ ] **Step 1: Write the failing tests (via the reducer + decode — functional end-to-end)**

Create `crates/redextape-core/src/lambda/lower.rs` with tests first:

```rust
//! Core AST -> de Bruijn lambda-term. This module has the functional path (Task 5) and the
//! store-passing path for `let mut`/`while` (Task 6). Lowering is syntax-directed and total
//! (returns `LowerError`, never panics).

use crate::core::{BinOp, Core, NodeId};
use crate::lambda::encode;
use crate::lambda::term::{LambdaTerm, abs, app, var};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::lambda::decode::decode;
    use crate::lambda::reduce::{MAX_REDUCTION_STEPS, reduce_to_normal_form};
    use crate::parser::parse;
    use crate::value::Value;

    /// End-to-end mini-oracle: source -> desugar -> lower -> reduce -> decode. Decoding is
    /// type-directed, so it uses the reference interpreter's result as the type witness; the
    /// returned value equals the reference's iff the lambda backend computed the right answer.
    fn run_lambda(src: &str) -> Value {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors: {ds:?}");
        let core = desugar(&prog.unwrap());
        let expected = crate::run(src).expect("reference run failed");
        let term = lower(&core).expect("lowering failed");
        let (nf, _) = reduce_to_normal_form(&term, MAX_REDUCTION_STEPS);
        decode(&nf, &expected).expect("normal form did not decode against the expected shape")
    }

    #[test]
    fn arithmetic_matches_the_reference() {
        assert_eq!(run_lambda("1 + 2 * 3"), Value::Nat(7));
        assert_eq!(run_lambda("3 - 5"), Value::Nat(0)); // monus
    }

    #[test]
    fn comparisons_and_if() {
        assert_eq!(run_lambda("if 2 > 1 { 10 } else { 20 }"), Value::Nat(10));
        assert_eq!(run_lambda("if 1 == 2 { 10 } else { 20 }"), Value::Nat(20));
    }

    #[test]
    fn closures_and_application() {
        assert_eq!(run_lambda("let add1 = |x| x + 1; add1(41)"), Value::Nat(42));
    }

    #[test]
    fn list_builtins() {
        assert_eq!(run_lambda("head(cons(7, nil))"), Value::Nat(7));
        assert_eq!(run_lambda("is_empty(nil)"), Value::Bool(true));
        assert_eq!(run_lambda("[1, 2, 3]"), Value::list_of_nats(&[1, 2, 3]));
    }

    #[test]
    fn recursion_via_fix() {
        let src = "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)";
        assert_eq!(run_lambda(src), Value::Nat(15));
    }

    #[test]
    fn map_and_fold_functional_demo() {
        let src = "\
            fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
            fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
            fn add(a, b) { a + b }\n\
            fn add1(x) { x + 1 }\n\
            fold([3, 1, 2].map(add1), 0, add)";
        assert_eq!(run_lambda(src), Value::Nat(9));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core lambda::lower`
Expected: FAIL — `cannot find function 'lower'`.

- [ ] **Step 3: Implement the functional lowering**

Add above the `#[cfg(test)]` module in `lower.rs`:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LowerError {
    /// A closure assigns a variable captured from an outer scope (§5.3 — v1 limitation).
    StatefulClosure { node: NodeId },
    /// A construct the lambda backend does not yet support.
    Unsupported { node: NodeId, what: String },
}

/// The `fix` combinator (call-by-name Y): `\f. (\x. f (x x)) (\x. f (x x))`.
fn fix() -> LambdaTerm {
    let inner = abs("x", app(var(1), app(var(0), var(0))));
    abs("f", app(inner.clone(), inner))
}

pub fn lower(core: &Core) -> Result<LambdaTerm, LowerError> {
    let mut scope: Vec<String> = Vec::new();
    lower_expr(core, &mut scope)
}

/// Resolve a name to a de Bruijn index (innermost binding), or fall back to a prelude encoder.
fn resolve(name: &str, scope: &[String]) -> Option<LambdaTerm> {
    if let Some(pos) = scope.iter().rposition(|n| n == name) {
        return Some(var((scope.len() - 1 - pos) as u32));
    }
    match name {
        "nil" => Some(encode::nil()),
        "cons" => Some(encode::cons()),
        "head" => Some(encode::head()),
        "tail" => Some(encode::tail()),
        "is_empty" => Some(encode::is_empty()),
        _ => None,
    }
}

fn lower_expr(core: &Core, scope: &mut Vec<String>) -> Result<LambdaTerm, LowerError> {
    match core {
        Core::Nat(_, n) => Ok(encode::church(*n)),
        Core::Bool(_, b) => Ok(if *b { encode::tru() } else { encode::fls() }),
        Core::Var(id, name) => resolve(name, scope)
            .ok_or_else(|| LowerError::Unsupported { node: *id, what: format!("unbound `{name}`") }),
        Core::BinOp(_, op, a, b) => {
            let la = lower_expr(a, scope)?;
            let lb = lower_expr(b, scope)?;
            Ok(app(app(encode::binop(*op), la), lb))
        }
        Core::If(_, c, t, e) => {
            let lc = lower_expr(c, scope)?;
            let lt = lower_expr(t, scope)?;
            let le = lower_expr(e, scope)?;
            Ok(app(app(lc, lt), le)) // Scott bool selects the branch
        }
        Core::Lambda(id, params, body) => lower_lambda(*id, params, body, scope),
        Core::Apply(_, f, args) => {
            let mut term = lower_expr(f, scope)?;
            for a in args {
                term = app(term, lower_expr(a, scope)?);
            }
            Ok(term)
        }
        Core::Let { name, mutable: false, value, body, .. } => {
            let lv = lower_expr(value, scope)?;
            scope.push(name.clone());
            let lb = lower_expr(body, scope);
            scope.pop();
            Ok(app(abs(name.clone(), lb?), lv))
        }
        Core::LetRec { name, value, body, .. } => {
            // (\name. body) (fix (\name. value))
            scope.push(name.clone());
            let lvalue = lower_expr(value, scope);
            let lbody = lower_expr(body, scope);
            scope.pop();
            let recval = app(fix(), abs(name.clone(), lvalue?));
            Ok(app(abs(name.clone(), lbody?), recval))
        }
        // Mutation / statement carriers (incl. the tail-less `Unit`) are handled in Task 6.
        Core::Let { mutable: true, id, .. }
        | Core::Assign(id, ..)
        | Core::While(id, ..)
        | Core::Seq(id, ..)
        | Core::Unit(id) => Err(LowerError::Unsupported {
            node: *id,
            what: "mutation/statement lowering (Task 6)".to_string(),
        }),
    }
}

fn lower_lambda(
    id: NodeId,
    params: &[String],
    body: &Core,
    scope: &mut Vec<String>,
) -> Result<LambdaTerm, LowerError> {
    // Stateful-closure check: an assignment to a name not in `params` (captured) is rejected.
    if assigns_captured(body, params) {
        return Err(LowerError::StatefulClosure { node: id });
    }
    for p in params {
        scope.push(p.clone());
    }
    let lbody = lower_expr(body, scope);
    for _ in params {
        scope.pop();
    }
    let mut term = lbody?;
    for p in params.iter().rev() {
        term = abs(p.clone(), term);
    }
    Ok(term)
}

/// True if `body` assigns a variable not bound within it (captured from an outer scope). A
/// conservative walk: track names bound *inside* `body`; any `Assign` to a name not locally bound
/// (and not a `params` name) is a captured mutation.
fn assigns_captured(body: &Core, params: &[String]) -> bool {
    fn walk(c: &Core, local: &mut Vec<String>, params: &[String]) -> bool {
        match c {
            Core::Assign(_, name, v) => {
                let bound = params.contains(name) || local.contains(name);
                (!bound) || walk(v, local, params)
            }
            Core::Let { name, value, body, .. } => {
                if walk(value, local, params) {
                    return true;
                }
                local.push(name.clone());
                let r = walk(body, local, params);
                local.pop();
                r
            }
            Core::LetRec { name, value, body, .. } => {
                local.push(name.clone());
                let r = walk(value, local, params) || walk(body, local, params);
                local.pop();
                r
            }
            Core::Lambda(_, ps, b) => {
                let n = local.len();
                for p in ps {
                    local.push(p.clone());
                }
                let r = walk(b, local, params);
                local.truncate(n);
                r
            }
            Core::BinOp(_, _, a, b) | Core::Seq(_, a, b) | Core::While(_, a, b) => {
                walk(a, local, params) || walk(b, local, params)
            }
            Core::If(_, a, b, c) => walk(a, local, params) || walk(b, local, params) || walk(c, local, params),
            Core::Apply(_, f, args) => walk(f, local, params) || args.iter().any(|a| walk(a, local, params)),
            Core::Nat(..) | Core::Bool(..) | Core::Var(..) | Core::Unit(..) => false,
        }
    }
    let mut local = Vec::new();
    walk(body, &mut local, params)
}
```

> **Implementer notes:**
> - `Core::Unit` sits in the `Unsupported` arm for Task 5 (a tail-less block only appears in
>   statement position, which the functional demo suite never reaches). Task 6 gives it a real
>   lowering (any closed value — the discarded carrier). Keep the match exhaustive over all `Core`
>   variants.
> - `assigns_captured` walks `body`; it must handle every `Core` variant exhaustively (the match
>   above does). Keep it in sync if `Core` gains variants.

- [ ] **Step 4: Wire the module + run the tests**

Add to `crates/redextape-core/src/lambda.rs`: `pub mod lower;` and `pub use lower::LowerError;`

Run: `cargo test -p redextape-core lambda::lower`
Expected: PASS — all 6 functional lowering tests (arithmetic, comparisons, closures, lists,
recursion, `map`/`fold`).

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/lambda/lower.rs crates/redextape-core/src/lambda.rs
git commit -m "feat(lambda): lower the functional Core subset to lambda-terms"
```

---

### Task 6: Lowering — store-passing for `let mut` / `while` / assignment

**Files:**
- Modify: `crates/redextape-core/src/lambda/lower.rs`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces: `lower` now succeeds on function-local mutation. The two-way oracle passes on
  `count_down` and any program whose mutation is function-local. Stateful closures still return
  `LowerError::StatefulClosure`.

**This is the intricate task.** The design (§5.2) is: a body with mutation threads a **Scott-tuple
store** of its mutable variables through a `fix`-loop; reads project from the store, assignments
rebuild it, `while` recurses until the condition is false, and the store collapses to the body's
result. The **tests below pin the behavior**; the implementer builds the lowering to satisfy them,
using the design's combinators. Because this translation is custom, TDD is the safety net — get each
test green in order (simplest first).

- [ ] **Step 1: Write the failing tests, simplest-mutation first**

Add these tests to the `tests` module in `lower.rs` (they reuse the `run_lambda` helper from Task 5):

```rust
    #[test]
    fn single_mutable_binding_and_read() {
        // No loop: one `let mut`, one assignment, then read it back.
        assert_eq!(run_lambda("{ let mut x = 1; x = x + 4; x }"), Value::Nat(5));
    }

    #[test]
    fn while_loop_accumulator() {
        // count-up: increment acc while n > 0.
        let src = "{ let mut acc = 0; let mut n = 3; while n > 0 { acc = acc + 1; n = n - 1; } acc }";
        assert_eq!(run_lambda(src), Value::Nat(3));
    }

    #[test]
    fn count_down_matches_the_reference() {
        let src = "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)";
        assert_eq!(run_lambda(src), Value::Nat(4));
    }

    #[test]
    fn stateful_closure_is_rejected() {
        // A closure that assigns a captured outer `let mut` is not representable in v1.
        let (prog, _) = parse("let mut c = 0; let inc = |x| { c = c + x; c }; inc(1)");
        let core = desugar(&prog.unwrap());
        let err = lower(&core).unwrap_err();
        assert!(matches!(err, LowerError::StatefulClosure { .. }), "got {err:?}");
    }
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cargo test -p redextape-core lambda::lower`
Expected: FAIL — `single_mutable_binding_and_read` etc. hit `Unsupported` (mutation not yet lowered).
(`stateful_closure_is_rejected` may already pass from Task 5's check — that is fine.)

- [ ] **Step 3: Implement store-passing**

Replace the `Core::Let{mutable:true} | Assign | While | Seq => Unsupported` arm with a store-passing
translation. **Approach (from §5.2), to implement and verify against the tests:**

1. **Detect a mutation region.** When `lower_expr` reaches a `Core::Let { mutable: true, .. }` or a
   `Core::Seq`/`Core::While`/`Core::Assign` in expression position, switch to `lower_stmts_sp` over
   the statement chain, computing the ordered set `M` of variables assigned anywhere in the chain
   (walk with a helper `collect_assigned(chain) -> Vec<String>`, dedup, stable order = first
   assignment seen).

2. **Store representation.** With `|M| = k`, the store is the Scott k-tuple `\sel. sel v0 … v(k-1)`.
   Provide helpers on `LambdaTerm`s:
   - `store_of(values: &[LambdaTerm]) -> LambdaTerm` builds `\sel. sel v0 … v(k-1)`.
   - `project(store, i, k) -> LambdaTerm` = `store (\v0…v(k-1). vi)`.
   - `update(store, i, new, k) -> LambdaTerm` = rebuild `store_of([project 0 … new@i … project k-1])`.

3. **Reads.** Inside a mutation region, a `Core::Var(name)` where `name ∈ M` lowers to
   `project(store, index_of(name), k)` rather than a plain de Bruijn var. Thread the current
   `store` term (a de Bruijn var referring to the store binder) through `lower_expr` while in the
   region — pass an optional `Option<&StoreCtx>` (the ordered `M` + the store's de Bruijn index).

4. **`Assign(name, e)`** ⇒ produce a new store: `update(store, index_of(name), lower(e), k)`.

5. **`While(cond, body)`** ⇒
   `fix (\loop. \s. (lower cond @ s) (loop (body-thread s)) s) initial_store`
   where `lower cond @ s` uses the store for reads, and `body-thread s` lowers the body's
   assignments into an updated store (folding `Seq`/`Assign` over the store). The Scott bool selects
   `loop (body-thread s)` (true) or `s` (false = final store).

6. **Collapse.** After the statement chain, the tail expression is lowered with reads projecting
   from the final store; the store then falls away (it is a local binder introduced by `store_of`
   and consumed by projections). A `let mut x = v` at the head introduces `x` into `M` with initial
   value `lower(v)`; the region's overall term is `(\store. lower(tail) @ store) initial_store`, with
   `while`/`Assign` in between updating `store` as they are threaded.

7. **Stateful-closure guard stays.** `lower_lambda`'s `assigns_captured` check (Task 5) already
   rejects closures that mutate captured state, so store contexts never need to cross a `Lambda`
   boundary — a closure inside a mutation region captures only *immutable* values and lowers via the
   functional path.

Also add the `Core::Unit(_) => Ok(<any closed value, e.g. encode::church(0)>)` arm (a tail-less
block's discarded result — never observed, matching the interpreter's carrier).

> **Implementer guidance:** implement `store_of`/`project`/`update` as small helpers first and
> unit-test them via the reducer (e.g. `project(store_of([church(7), church(9)]), 0, 2)` normalizes
> to `church(7)`; `update(...)` then project the updated slot). Then wire `while`/`Assign`/`Let mut`.
> Build up: get `single_mutable_binding_and_read` green (no loop), then `while_loop_accumulator`,
> then `count_down`. If the store-passing shape needs to differ from the sketch to pass the tests,
> that is expected — the **tests are the contract**, the sketch is the intended approach. Keep
> functional-path terms unchanged (a body with no assignments must still lower store-free — verify
> the Task 5 tests still pass).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p redextape-core lambda::lower`
Expected: PASS — the 4 new mutation tests **and** all 6 Task 5 functional tests (unchanged: no
store threading leaked into functional code).

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/lambda/lower.rs
git commit -m "feat(lambda): store-passing lowering for let mut/while; reject stateful closures"
```

---

### Task 7: λ text form — parser and printer

**Files:**
- Create: `crates/redextape-core/src/lambda/syntax.rs`
- Modify: `crates/redextape-core/src/lambda.rs` (add `pub mod syntax;`)

**Interfaces:**
- Consumes: `term::{LambdaTerm, abs, app, var}`, `Span`, `Diagnostic`.
- Produces:
  - `parse_lambda(&str) -> (Option<LambdaTerm>, Vec<Diagnostic>)` — de Bruijn resolution; unbound
    (free) variable = spanned error; never panics; `MAX_PARSE_DEPTH` nesting guard.
  - `print_lambda(&LambdaTerm) -> String` — readable names from binder hints (freshened on shadow
    collision), minimal parens.

- [ ] **Step 1: Write the failing tests (round-trip is the headline)**

Create `crates/redextape-core/src/lambda/syntax.rs` with tests first:

```rust
//! The human-readable, runnable lambda text form: `var`, `\x. e` (also `λ`), application by
//! juxtaposition (left-assoc), parens. Parsing resolves names to de Bruijn indices; printing
//! regenerates readable names from binder hints. Printer and parser round-trip (§7.2).

use crate::diagnostic::Diagnostic;
use crate::lambda::term::{LambdaTerm, abs, app, var};
use crate::span::Span;

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_ok(src: &str) -> LambdaTerm {
        let (t, ds) = parse_lambda(src);
        assert!(ds.is_empty(), "diagnostics: {ds:?}");
        t.expect("expected a term")
    }

    #[test]
    fn parses_identity_and_application() {
        assert_eq!(parse_ok("\\x. x"), abs("x", var(0)));
        // application is left-associative: a b c == (a b) c, with a,b,c bound
        assert_eq!(parse_ok("\\a.\\b.\\c. a b c"),
            abs("a", abs("b", abs("c", app(app(var(2), var(1)), var(0))))));
    }

    #[test]
    fn accepts_unicode_lambda() {
        assert_eq!(parse_ok("λx. x"), abs("x", var(0)));
    }

    #[test]
    fn free_variable_is_a_diagnostic() {
        let (t, ds) = parse_lambda("\\x. y");
        assert!(t.is_none());
        assert!(ds.iter().any(|d| d.message.contains("unbound")), "diags: {ds:?}");
    }

    #[test]
    fn print_then_parse_round_trips() {
        let terms = [
            abs("x", var(0)),
            abs("f", abs("x", app(var(1), app(var(1), var(0))))), // church 2
            app(abs("x", var(0)), abs("y", var(0))),
        ];
        for t in terms {
            let printed = print_lambda(&t);
            let (reparsed, ds) = parse_lambda(&printed);
            assert!(ds.is_empty(), "printed {printed:?} -> diags {ds:?}");
            assert_eq!(reparsed.unwrap(), t, "round-trip failed for {printed:?}");
        }
    }

    #[test]
    fn print_is_idempotent() {
        let t = abs("f", abs("x", app(var(1), app(var(1), var(0)))));
        let once = print_lambda(&t);
        let (t2, _) = parse_lambda(&once);
        assert_eq!(print_lambda(&t2.unwrap()), once);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core lambda::syntax`
Expected: FAIL — `cannot find function 'parse_lambda'`.

- [ ] **Step 3: Implement the parser and printer**

Add above the `#[cfg(test)]` module in `syntax.rs`. The parser is a small recursive-descent parser
over chars with a scope stack (names → de Bruijn); the printer walks the term with a name
environment. Full implementation:

```rust
/// Nesting-depth guard for the recursive-descent parser (mirrors the source parser). Tuned below
/// the native stack-overflow depth; raise only with a larger stack (see Plan 1).
pub const MAX_PARSE_DEPTH: u32 = 256;

pub fn parse_lambda(src: &str) -> (Option<LambdaTerm>, Vec<Diagnostic>) {
    let mut p = Parser { src, chars: src.char_indices().collect(), pos: 0, depth: 0 };
    match p.parse_term(&mut Vec::new()) {
        Ok(t) => {
            p.skip_ws();
            if p.pos < p.chars.len() {
                let span = Span::new(p.byte_pos(), src.len());
                (None, vec![Diagnostic::error(span, "unexpected trailing input")])
            } else {
                (Some(t), Vec::new())
            }
        }
        Err(d) => (None, vec![d]),
    }
}

struct Parser<'a> {
    src: &'a str,
    chars: Vec<(usize, char)>,
    pos: usize,
    depth: u32,
}

type PResult<T> = Result<T, Diagnostic>;

impl Parser<'_> {
    fn byte_pos(&self) -> usize {
        self.chars.get(self.pos).map_or(self.src.len(), |(b, _)| *b)
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).map(|(_, c)| *c)
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek();
        if c.is_some() {
            self.pos += 1;
        }
        c
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(c) if c.is_whitespace()) {
            self.pos += 1;
        }
    }

    fn err(&self, msg: &str) -> Diagnostic {
        Diagnostic::error(Span::new(self.byte_pos(), self.byte_pos()), msg)
    }

    /// term := application (one or more atoms, left-associative)
    fn parse_term(&mut self, scope: &mut Vec<String>) -> PResult<LambdaTerm> {
        self.depth += 1;
        if self.depth > MAX_PARSE_DEPTH {
            self.depth -= 1;
            return Err(self.err("expression nested too deeply"));
        }
        let r = self.parse_application(scope);
        self.depth -= 1;
        r
    }

    fn parse_application(&mut self, scope: &mut Vec<String>) -> PResult<LambdaTerm> {
        let mut term = self.parse_atom(scope)?;
        loop {
            self.skip_ws();
            match self.peek() {
                Some(c) if c == '\\' || c == 'λ' || c == '(' || is_ident_start(c) => {
                    let arg = self.parse_atom(scope)?;
                    term = app(term, arg);
                }
                _ => break,
            }
        }
        Ok(term)
    }

    fn parse_atom(&mut self, scope: &mut Vec<String>) -> PResult<LambdaTerm> {
        self.skip_ws();
        match self.peek() {
            Some('\\') | Some('λ') => self.parse_abstraction(scope),
            Some('(') => {
                self.bump();
                let t = self.parse_term(scope)?;
                self.skip_ws();
                if self.bump() != Some(')') {
                    return Err(self.err("expected `)`"));
                }
                Ok(t)
            }
            Some(c) if is_ident_start(c) => {
                let name = self.parse_ident();
                match scope.iter().rposition(|n| *n == name) {
                    Some(pos) => Ok(var((scope.len() - 1 - pos) as u32)),
                    None => Err(Diagnostic::error(
                        Span::new(self.byte_pos(), self.byte_pos()),
                        format!("unbound variable `{name}`"),
                    )),
                }
            }
            _ => Err(self.err("expected a term")),
        }
    }

    fn parse_abstraction(&mut self, scope: &mut Vec<String>) -> PResult<LambdaTerm> {
        self.bump(); // \ or λ
        self.skip_ws();
        if !matches!(self.peek(), Some(c) if is_ident_start(c)) {
            return Err(self.err("expected a parameter name"));
        }
        let name = self.parse_ident();
        self.skip_ws();
        if self.bump() != Some('.') {
            return Err(self.err("expected `.`"));
        }
        scope.push(name.clone());
        let body = self.parse_term(scope);
        scope.pop();
        Ok(abs(name, body?))
    }

    fn parse_ident(&mut self) -> String {
        let mut s = String::new();
        while matches!(self.peek(), Some(c) if is_ident_continue(c)) {
            s.push(self.bump().unwrap());
        }
        s
    }
}

fn is_ident_start(c: char) -> bool {
    c == '_' || c.is_ascii_alphabetic()
}

fn is_ident_continue(c: char) -> bool {
    c == '_' || c.is_ascii_alphanumeric()
}

/// Print a term with readable names, freshening on shadow collision, minimal parens.
pub fn print_lambda(t: &LambdaTerm) -> String {
    let mut names: Vec<String> = Vec::new();
    print_term(t, &mut names)
}

fn print_term(t: &LambdaTerm, names: &mut Vec<String>) -> String {
    match t {
        LambdaTerm::Var(i) => {
            let idx = names.len().checked_sub(1 + *i as usize);
            idx.and_then(|k| names.get(k)).cloned().unwrap_or_else(|| format!("?{i}"))
        }
        LambdaTerm::Abs(hint, body) => {
            let name = fresh(hint, names);
            names.push(name.clone());
            let inner = print_term(body, names);
            names.pop();
            format!("\\{name}. {inner}")
        }
        LambdaTerm::App(f, a) => {
            let fs = print_app_fn(f, names);
            let as_ = print_atom(a, names);
            format!("{fs} {as_}")
        }
    }
}

/// The function position of an application: an abstraction there needs parens.
fn print_app_fn(t: &LambdaTerm, names: &mut Vec<String>) -> String {
    match t {
        LambdaTerm::Abs(..) => format!("({})", print_term(t, names)),
        _ => print_term(t, names),
    }
}

/// An atom in argument position: abstractions and applications need parens.
fn print_atom(t: &LambdaTerm, names: &mut Vec<String>) -> String {
    match t {
        LambdaTerm::Var(_) => print_term(t, names),
        _ => format!("({})", print_term(t, names)),
    }
}

fn fresh(hint: &str, names: &[String]) -> String {
    let base = if hint.is_empty() { "v" } else { hint };
    if !names.iter().any(|n| n == base) {
        return base.to_string();
    }
    for k in 0.. {
        let cand = format!("{base}{k}");
        if !names.iter().any(|n| *n == cand) {
            return cand;
        }
    }
    unreachable!()
}
```

> **Implementer notes:**
> - The identifier boundary after `parse_ident` for a `var` uses `byte_pos()` for the span; if the
>   unbound-name span reads slightly off, adjust to span the identifier's start..end (record the
>   start byte before `parse_ident`). Behavior (a spanned "unbound variable" diagnostic) is what the
>   test asserts.
> - Round-trip is on de Bruijn α-equality (the term's `PartialEq`), so printed *names* need not match
>   the original hints — only the structure must. `fresh` avoids same-name shadowing so parse
>   re-resolves indices correctly.

- [ ] **Step 4: Wire the module + run the tests**

Add to `crates/redextape-core/src/lambda.rs`: `pub mod syntax;`

Run: `cargo test -p redextape-core lambda::syntax`
Expected: PASS — all 5 syntax tests (parse, unicode λ, unbound diagnostic, round-trip, idempotence).

Run: `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --all --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/lambda/syntax.rs crates/redextape-core/src/lambda.rs
git commit -m "feat(lambda): add round-tripping lambda text form parser and printer"
```

---

### Task 8: Public API, the two-way oracle, and proptest

**Files:**
- Modify: `crates/redextape-core/src/lambda.rs` (re-exports + `run_lambda`)
- Create: `crates/redextape-core/tests/lambda_oracle.rs` (integration test) **or** add an oracle
  module inside `lambda.rs` — the integration-test form keeps the oracle harness reusable by Plan 3.

**Interfaces:**
- Consumes: `lower`, `reduce_to_normal_form`, `decode`, `analyze`/`run` (reference), `Value`.
- Produces:
  - `lambda::run_lambda(core: &Core, cap: u64) -> LambdaRun` where
    `LambdaRun { Reduced(LambdaTerm), HitCap, LowerError(LowerError) }` — lower + reduce, returning the
    normal form (decoding is the caller's job, since it is type-directed). The convenience entry the
    oracle and later plans use.
  - Re-exports at `lambda`: `LambdaTerm`, `Dir`, `Path`, `Trace`, `Step`, `Status`, `LowerError`,
    `lower`, `reduce_trace`, `reduce_to_normal_form`, `decode`, `parse_lambda`, `print_lambda`,
    `run_lambda`, `LambdaRun`.

- [ ] **Step 1: Add `run_lambda` and re-exports to `lambda.rs`**

Append to `crates/redextape-core/src/lambda.rs`:

```rust
pub use decode::decode;
pub use lower::{LowerError, lower};
pub use reduce::{MAX_REDUCTION_STEPS, Status, Step, Trace, reduce_to_normal_form, reduce_trace};
pub use syntax::{parse_lambda, print_lambda};
pub use term::{Dir, LambdaTerm, Path};

use crate::core::Core;
use crate::value::Value;

/// The outcome of lowering + reducing a program through the lambda backend. Decoding to a `Value`
/// is a separate, type-directed step (see `decode`), because bare normal forms are ambiguous.
#[derive(Clone, Debug)]
pub enum LambdaRun {
    /// Reduced to a normal form. Decode it against an expected value's shape (`decode`).
    Reduced(LambdaTerm),
    /// Reduction hit the step cap.
    HitCap,
    /// The program could not be lowered (e.g. a stateful closure).
    LowerError(LowerError),
}

/// Lower -> reduce. The convenience entry point for the oracle and later plans.
pub fn run_lambda(core: &Core, cap: u64) -> LambdaRun {
    let term = match lower(core) {
        Ok(t) => t,
        Err(e) => return LambdaRun::LowerError(e),
    };
    let (nf, status) = reduce_to_normal_form(&term, cap);
    match status {
        Status::HitCap => LambdaRun::HitCap,
        Status::Normalized => LambdaRun::Reduced(nf),
    }
}
```

> Note: `use crate::value::Value;` is only needed if `Value` is referenced in this file after the
> change; keep the `use crate::core::Core;` import (used by `run_lambda`'s signature). Remove an
> unused `Value` import if clippy flags it.

- [ ] **Step 2: Write the failing two-way oracle test**

Create `crates/redextape-core/tests/lambda_oracle.rs`:

```rust
//! The two-way oracle (§10.1): for every demo program, the reference tree-walker's result equals
//! the decoded lambda normal form. This is the first cross-backend agreement guarantee; Plan 3
//! extends it to three ways.

use redextape_core::desugar::desugar;
use redextape_core::lambda::{LambdaRun, MAX_REDUCTION_STEPS, decode, run_lambda};
use redextape_core::parser::parse;
use redextape_core::{RunError, run};

/// Every program the reference runs to a value, the lambda backend must run to a normal form that
/// decodes (guided by that value's type) to the SAME value.
fn assert_oracle_agrees(src: &str) {
    let reference = run(src);
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let core = desugar(&prog.unwrap());
    let lambda = run_lambda(&core, MAX_REDUCTION_STEPS);
    match (reference, lambda) {
        (Ok(rv), LambdaRun::Reduced(nf)) => {
            // Decode the lambda normal form guided by the reference value's type; it must equal it.
            assert_eq!(decode(&nf, &rv), Some(rv.clone()), "reference vs lambda disagree for: {src}");
        }
        (Err(RunError::Runtime(_)), LambdaRun::HitCap) => {
            // A reference runtime fault (e.g. head(nil)) has no finite lambda normal form — acceptable.
        }
        (r, l) => panic!("oracle mismatch for {src}:\n  reference={r:?}\n  lambda={l:?}"),
    }
}

#[test]
fn two_way_oracle_on_the_demo_suite() {
    let demos = [
        "1 + 2 * 3",
        "3 - 5",
        "if 2 > 1 { 10 } else { 20 }",
        "let add1 = |x| x + 1; add1(41)",
        "head(cons(7, nil))",
        "[1, 2, 3]",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
        "\
            fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }\n\
            fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }\n\
            fn add(a, b) { a + b }\n\
            fn add1(x) { x + 1 }\n\
            fold([3, 1, 2].map(add1), 0, add)",
    ];
    for src in demos {
        assert_oracle_agrees(src);
    }
}
```

- [ ] **Step 3: Run the oracle to verify it fails, then passes**

Run: `cargo test -p redextape-core --test lambda_oracle`
Expected: at first FAIL if `run`/`RunError`/`desugar`/`lambda` are not all `pub` at the crate root —
confirm each is exported (`run`, `RunError` from Task 7 of Plan 1; `desugar`, `parser`, `lambda` are
`pub mod`s). Once wired, PASS — the reference and lambda agree on the full demo suite (this is the
headline deliverable).

- [ ] **Step 4: Add proptest round-trips**

Add a proptest module to `syntax.rs` (encoding + parse/print properties). Append inside
`syntax.rs`'s `#[cfg(test)] mod tests`:

```rust
    use proptest::prelude::*;

    /// Generate closed de Bruijn terms of bounded depth.
    fn closed_term() -> impl Strategy<Value = LambdaTerm> {
        fn go(depth: u32, binders: u32) -> BoxedStrategy<LambdaTerm> {
            let var_strat = (0..binders.max(1)).prop_map(var).boxed();
            if depth == 0 || binders == 0 {
                // must produce a bound variable if any binder exists; else a trivial abstraction
                if binders == 0 {
                    return Just(abs("x", var(0))).boxed();
                }
                return var_strat;
            }
            let abs_strat = go(depth - 1, binders + 1).prop_map(|b| abs("v", b));
            let app_strat =
                (go(depth - 1, binders), go(depth - 1, binders)).prop_map(|(f, a)| app(f, a));
            prop_oneof![var_strat, abs_strat.boxed(), app_strat.boxed()].boxed()
        }
        go(4, 0)
    }

    proptest! {
        #[test]
        fn parse_print_round_trips(t in closed_term()) {
            let printed = print_lambda(&t);
            let (reparsed, ds) = parse_lambda(&printed);
            prop_assert!(ds.is_empty(), "printed {printed:?} -> {ds:?}");
            prop_assert_eq!(reparsed.unwrap(), t);
        }

        #[test]
        fn print_is_idempotent_prop(t in closed_term()) {
            let once = print_lambda(&t);
            let (t2, _) = parse_lambda(&once);
            prop_assert_eq!(print_lambda(&t2.unwrap()), once);
        }
    }
```

Also add an encoding round-trip proptest to `decode.rs`'s test module:

```rust
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn church_round_trips(n in 0u64..200) {
            prop_assert_eq!(decode(&church(n), &Value::Nat(n)), Some(Value::Nat(n)));
        }

        #[test]
        fn nat_list_round_trips(ns in proptest::collection::vec(0u64..50, 0..8)) {
            // build cons(n0, cons(n1, ... nil)), reduce, decode (guided by the expected list).
            let mut term = nil();
            for &n in ns.iter().rev() {
                term = app(app(cons(), church(n)), term);
            }
            let (nf, _) = reduce_to_normal_form(&term, MAX_REDUCTION_STEPS);
            let expected = Value::list_of_nats(&ns);
            prop_assert_eq!(decode(&nf, &expected), Some(expected.clone()));
        }
    }
```

- [ ] **Step 5: Run the full suite + gates**

Run: `cargo test -p redextape-core` and `cargo test -p redextape-core --test lambda_oracle`
Expected: PASS — all unit tests, proptests, and the two-way oracle.

Run: `cargo fmt --all --check`; `cargo clippy --workspace --all-targets -- -D warnings`;
`cargo llvm-cov --workspace --all-targets --fail-under-lines 80`
Expected: all clean; coverage ≥ 80% (add targeted unit tests for any uncovered lowering/decode
branch the report names — likely `LowerError` arms or the store-passing helpers).

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/lambda.rs crates/redextape-core/tests/lambda_oracle.rs \
        crates/redextape-core/src/lambda/syntax.rs crates/redextape-core/src/lambda/decode.rs
git commit -m "feat(lambda): add run_lambda, the two-way oracle, and proptest round-trips"
```

---

## Self-Review

**Spec coverage (design doc §1–§12):**
- de Bruijn `LambdaTerm` + α-eq + shift/subst + iterative Drop (§3) — Task 1. ✔
- Church/Scott encodings + arithmetic/comparison/list combinators (§4) — Task 2 (structural) + Task 3
  (behavioral). ✔
- Normal-order reducer + `reduce_trace` + redex path + step cap (§6) — Task 3. ✔
- Decode normal form → `Value` (§7) — Task 4. ✔
- Functional lowering + `fix`/Y + stateful-closure rejection (§5.1, §5.3) — Task 5. ✔
- Store-passing for `let mut`/`while` (§5.2) — Task 6. ✔
- λ text form parser/printer + round-trip + parse-depth guard (§8, §9) — Task 7. ✔
- Public API + two-way oracle + proptest round-trips (§10, §11) — Task 8. ✔
- **Deferred (correctly out of scope):** readability sugar, general heap-passing/stateful closures,
  view models/source maps/trace-as-view/WASM (Plan 4), TM backend/three-way oracle (Plan 3).

**Placeholder scan:** no `TBD`/`later` with missing content. Task 6 intentionally provides an
approach + complete tests rather than complete code, because the store-passing translation is custom
and TDD-driven — the tests are the contract and are complete; the sketch is labeled as the intended
approach, and the store helpers (`store_of`/`project`/`update`) have concrete definitions.

**Type consistency:** `LambdaTerm`, `Dir`/`Path`, `shift`/`subst`/`beta`, `church`/`tru`/`fls`/
`nil`/`cons`/`binop`, `reduce_step`/`reduce_trace`/`reduce_to_normal_form`/`Trace`/`Step`/`Status`/
`MAX_REDUCTION_STEPS`, `decode`, `lower`/`LowerError`, `parse_lambda`/`print_lambda`, `run_lambda`/
`LambdaRun` are named identically wherever they appear across tasks. `decode(nf, expected)` is
type-directed (bare normal forms are ambiguous — `church(0)` ≡ `false`). The reference entry points
(`run`, `RunError`, `desugar`, `parse`) match Plan 1's public API.

**Known risk:** Task 6 (store-passing) is the intricate task — it is deliberately gated behind the
functional path (Tasks 1–5, oracle-validated on `sum`/`map`/`fold`) so the reducer/encodings/decode
are trusted before the store-passing lands, and its four mutation tests build up simplest-first.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-21-lambda-backend.md`.**
