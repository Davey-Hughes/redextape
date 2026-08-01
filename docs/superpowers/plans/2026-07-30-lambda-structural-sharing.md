# λ-term structural sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Box`-based `LambdaTerm` with a `Rc`-backed newtype so the λ reducer stops deep-cloning untouched sibling subtrees on every β-step, and trace snapshots become nearly free.

**Architecture:** `LambdaTerm` becomes `struct LambdaTerm(Rc<Node>)` with a public `Node` enum reached through `.node()`. Cloning any term at any level becomes one refcount bump. The hand-written iterative `Drop` **stays on `LambdaTerm`** and may only descend into uniquely-owned children. Everything else — reduction strategy, printers, spans, error types, depth guards — is untouched.

> **Corrected 2026-07-31.** This line originally read "the hand-written iterative `Drop` moves to `Node`". **That design does not terminate and was never shipped** — Task 2's Step 4 records the whole diagnosis, and the shipped destructor is `impl Drop for LambdaTerm` (`term.rs:181`), opening with a strong-count guard and a `Node::Var(_)` leaf guard. The leaf guard is what terminates the placeholder cascade; `Node` deliberately has no `Drop` at all, which is also what lets `Rc::into_inner`'s result be destructured by value. See the design's §6.

**Tech Stack:** Rust (stable channel), `cargo-nextest`, `cargo-llvm-cov`. No new dependencies; `redextape-core` must stay dependency-free.

Design: [`docs/superpowers/specs/2026-07-30-lambda-structural-sharing-design.md`](../specs/2026-07-30-lambda-structural-sharing-design.md)

**Status: all seven tasks complete on branch `lambda-structural-sharing` (2026-07-31).** Layer 0 `3688bd1`
(pre-plan) and this plan `14e4771`; Task 1 `2f51e65` + `8fa6832`; Task 2 `8846f8d`; Task 3 `5e41c01`;
Task 4 `2123ea2`; Task 5 `07e98a5` + `1c5f3d0`; Task 6 `5e38f36` + `d3ab121`; Task 7 `427bc2e` +
`e93bd07` + `a22b382`. Layer 1 bought a uniform 2.1x–2.8x and the worst case is **still a hang**
(1,216.7 ms); layer 1.5 answered §7's gate and **layers 2 and 3 are not planned** on its evidence. ~~The
next slice is `subst`'s per-binder re-shift, not interning — design §10.~~ — **superseded 2026-07-31,
before that slice was planned.** The design's §10 also sized a hazard this plan's own conversion moved
rather than created: 512 bytes of ordinary source lower to a term whose reduction reaches a β-step that
does not return, and the roadmap re-routed the next λ slice at that instead (its
*"THE NEXT λ SLICE IS NOT the `subst` fix"* entry). Two guards were built against it and both were
falsified by measurement; ~~**the hang is open** and the next slice is a per-redex work budget~~ —
**CLOSED 2026-08-01, and that budget was never built.** The cause was one level below where this line
looked: `term.rs`'s `shift` was Θ(logical) and destroyed sharing on every β-step, and `reduce.rs`'s
`depth_exceeds` walked the logical tree once per step. Both now read `u32`s the constructors maintain,
and the 512-byte program reduces in 7.48 s.

The `subst` fix this plan pointed at is **still unaffected and still worth taking** — a constant-factor
win on programs that terminate — and it is now genuinely next rather than displaced. Read the roadmap
for the ordering, not this line.

## Global Constraints

- **`redextape-core` stays dependency-free.** Verify with `cargo tree -p redextape-core --edges normal` — it must show only itself.
- **No printed byte may move.** Every golden, round-trip, fixture and span test passes **unedited**. An edited expectation is a defect in this work until proven otherwise.
- **No library path may panic.** `[workspace.lints.clippy]` warns `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented`; CI runs `-D warnings`. `clippy.toml` exempts code lexically inside `#[test]` fns and bare `#[cfg(test)]` modules only — `tests/` and `examples/` targets need a file-level `#![allow(...)]`.
- **`Rc`, never `Arc`.** WASM is single-threaded and `value.rs` already establishes the pattern.
- **The gate is `scripts/check-all.sh`** — four feature configurations. Pass `--no-llvm` if no LLVM 22 toolchain is present.
- **Test runner is `cargo nextest run`, not `cargo test`.**
- **Branch is `lambda-structural-sharing`**; land with `scripts/land.sh` as one gated commit.
- **Layer 0 is already done** — `examples/lambda_sharing_probe.rs` and the design's §2/§3 tables are its output (commit `3688bd1`).

**Non-goals — do not "helpfully" fix these** (design §9). Each is deliberate, and touching it makes this branch un-reviewable:

- **`shift`'s negative-index `assert!` stays.** It is the documented anti-miscompile guard: wrapping produced a term full of dangling references that reduced to a *wrong answer* rather than an error. It is a library-path panic that `clippy::panic` does not catch (the lint does not cover `assert!`), and converting it is a signature change to a `pub` function belonging to a different slice.
- **No depth-bound changes.** `MAX_TERM_DEPTH`, `MAX_LAMBDA_LOWER_DEPTH`, `MAX_EVAL_DEPTH`, `MAX_DEFUNC_DEPTH` are all calibrated to a native 8 MiB stack and none protects WASM's ~1 MB. Real, open, and routed to Plan 5 where the target's stack is known.
- **No serde, no view models, no WASM crate.** Plan 5.
- **No change to reduction strategy.** Normal order stays, for the three independent reasons `reduce.rs`'s module doc gives.
- **No new `unwrap`/`expect`/`panic` on library paths**, and no `#[allow]` added to dodge one.

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `crates/redextape-core/src/lambda/term.rs` | the type, `shift`/`subst`/`beta`, `PartialEq`, `Drop` | **rewritten** (185 lines) |
| `crates/redextape-core/src/lambda/reduce.rs` | β-step + `depth_exceeds` | 11 match sites |
| `crates/redextape-core/src/lambda/decode.rs` | normal-form → `Value` | 23 match sites + the thread test |
| `crates/redextape-core/src/lambda/syntax.rs` | λ text printer/parser | 5 match sites |
| `crates/redextape-core/src/lambda/lower.rs` | Core → λ | 3 match sites (all in `#[cfg(test)]`) |
| `crates/redextape-core/src/lambda/encode.rs` | Church/Scott encodings | **0 match sites** — constructors only, no change expected |
| `crates/redextape-core/src/trace.rs` | `LambdaCursor` | no match sites; its `t.clone()` silently becomes a bump |
| `crates/redextape-core/src/lib.rs` | `drop_tests` module | **3 new tests** (Task 1) + **1** (Task 2) + **1** (Task 3) — **five** λ cases in all |
| `crates/redextape-core/tests/lambda_sharing.rs` | the sharing gate | **new** (Task 5) |
| `crates/redextape-core/examples/lambda_sharing_probe.rs` | the measurement instrument | 12 match sites; extended in Task 7 |

Integration tests and the other examples use `LambdaTerm` as a type and construct via `var`/`abs`/`app`; **none matches on the variants** (verified with `rg -n 'LambdaTerm::' crates/*/tests/`). They need no edits.

---

### Task 1: Test the iterative `Drop` that already exists

The spec's §6 records that `lib.rs`'s `drop_tests` covers `Core`, `Expr`, `Value` and `LetRecGroup` but has **no `LambdaTerm` case** — its iterative `Drop` has been asserted in a doc comment and exercised only incidentally by `decode.rs`. Task 2 rewrites that `Drop`. This task builds the safety net first, against the **current `Box` code**, so the net is known to work before the risky change lands.

**Files:**
- Modify: `crates/redextape-core/src/lib.rs` (inside `mod drop_tests`, after `dropping_deep_letrecgroup_chain_through_a_binding_value_does_not_overflow`)

**Interfaces:**
- Consumes: `crate::lambda::term::{abs, app, var}` — all `pub` in `pub mod term`, reachable as `crate::lambda::term::*` even though `lambda.rs` re-exports only `Dir`/`LambdaTerm`/`Path`.
- Produces: nothing. This task adds tests only.

- [x] **Step 1: Write the three tests**

Append inside `mod drop_tests` in `crates/redextape-core/src/lib.rs`. The `App` arm unlinks TWO
children (`f` and `a`), so — same as the `LetRecGroup` pair above — it needs two chains, one deep
via each child, for each unlink to be independently falsifiable. A single left-nested `App` chain
would still PASS if the code forgot to unlink `a`, because `a` is always a shallow `var(1)` leaf
and the compiler's own recursive drop glue handles a one-node subtree in O(1):

```rust
    /// Deep `LambdaTerm` via a right-nested `Abs` chain: exercises `take_children`'s `Abs` arm.
    ///
    /// `term.rs` gives `LambdaTerm` the same hand-written iterative `Drop` the types above have, and
    /// until now NOTHING tested it directly — `decode.rs`'s small-stack decode exercised it only
    /// incidentally, as a side effect of a test about a different subject. This closes that gap
    /// BEFORE the representation changes, so the net is known to work before it is needed.
    ///
    /// Built with an iterative loop, not a recursive helper: the build must not be what overflows.
    #[test]
    fn dropping_deep_lambda_abs_chain_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::lambda::term::{abs, var};
                let mut acc = var(0);
                for _ in 0..40_000 {
                    acc = abs("x", acc);
                }
                drop(acc); // must tear down iteratively, not recurse 40,000 deep.
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// Deep `LambdaTerm` via a left-nested `App` chain: exercises `take_children`'s `App` arm, which
    /// unlinks TWO children rather than one. This is the left-nested half of a pair — the same
    /// device the `LetRecGroup` pair above uses — so it is falsifiable only for a forgotten `f`;
    /// its twin below (deep via `a`) is what makes a forgotten `a` falsifiable too.
    #[test]
    fn dropping_deep_lambda_app_chain_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::lambda::term::{app, var};
                let mut acc = var(0);
                for _ in 0..40_000 {
                    acc = app(acc, var(1)); // chain via the LEFT child; the right is a shallow leaf.
                }
                drop(acc);
            })
            .unwrap()
            .join()
            .unwrap();
    }

    /// The right-nested twin: deep via `a`, with `f` a shallow leaf. The `App` arm unlinks TWO
    /// children, so it needs TWO chains, and without this one the pair is not the device the test
    /// above claims it is.
    ///
    /// Concretely: a `take_children` that unlinked `f` and forgot `a` would leave `a` to the
    /// compiler's recursive drop glue — which is O(1) when `a` is always `var(1)`, so the left-nested
    /// test PASSES with that half broken. Verified by sabotage, not reasoned about: see this pair's
    /// entry in the branch's review notes.
    #[test]
    fn dropping_deep_lambda_app_chain_through_the_argument_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::lambda::term::{app, var};
                let mut acc = var(0);
                for _ in 0..40_000 {
                    acc = app(var(1), acc); // chain via the RIGHT child; the left is a shallow leaf.
                }
                drop(acc);
            })
            .unwrap()
            .join()
            .unwrap();
    }
```

- [x] **Step 2: Run them and verify they PASS on the current code**

Run: `cargo nextest run -p redextape-core -E 'test(dropping_deep_lambda)'`
Expected: `3 tests run: 3 passed`. They pass because the existing `Drop` is already iterative — that is the point. A failure here means the safety net is broken and Task 2 must not start.

- [x] **Step 3: Prove the tests are non-vacuous**

Temporarily delete the `impl Drop for LambdaTerm` block in `crates/redextape-core/src/lambda/term.rs:107-115` and re-run.

Run: `cargo nextest run -p redextape-core -E 'test(dropping_deep_lambda)'`
Expected: the test process **aborts** (SIGABRT / stack overflow), not a clean failure. This is what proves 512 KiB is small enough to catch a recursive teardown at depth 40,000.

- [x] **Step 4: Restore the `Drop` impl and re-run**

Run: `git checkout crates/redextape-core/src/lambda/term.rs && cargo nextest run -p redextape-core -E 'test(dropping_deep_lambda)'`
Expected: `3 tests run: 3 passed`

- [x] **Step 5: Commit**

```bash
git add crates/redextape-core/src/lib.rs
git commit -m "test(lambda): LambdaTerm joins the iterative-drop suite, before Rc rewrites it

drop_tests covered Core, Expr, Value and LetRecGroup; LambdaTerm's own
hand-written iterative Drop was asserted in a doc comment and exercised only
incidentally, by a decode test about a different subject. One chain for the
Abs arm's single child, plus a left/right pair for the App arm's two children,
so every unlink is independently falsifiable — a chain deep via only one of
App's two children would still pass if the other were left to the compiler's
recursive drop glue, since that child is always a shallow one-node leaf.

Non-vacuity verified by deleting the Drop impl: all three tests abort a
512 KiB thread at depth 40,000 rather than failing cleanly."
```

**Estimate: 20 minutes.**

---

### Task 2: The conversion

The single atomic change. A Rust type change breaks five files at once, so there is no green intermediate state — this task starts green and ends green with nothing in between.

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs` (rewrite)
- Modify: `crates/redextape-core/src/lambda/reduce.rs:54-121`
- Modify: `crates/redextape-core/src/lambda/decode.rs:74-152`, `:271-277`, `:317-334`
- Modify: `crates/redextape-core/src/lambda/syntax.rs:203-245`
- Modify: `crates/redextape-core/src/lambda/lower.rs:1022-1032`
- Modify: `crates/redextape-core/examples/lambda_sharing_probe.rs` (12 match sites)

**Interfaces:**
- Produces, and every later task depends on these exact signatures:
  - `pub struct LambdaTerm(Rc<Node>)` — `Clone`, `Debug`, `PartialEq`, `Eq`
  - `pub enum Node { Var(u32), Abs(Rc<str>, LambdaTerm), App(LambdaTerm, LambdaTerm) }`
  - `pub fn LambdaTerm::node(&self) -> &Node`
  - `pub fn LambdaTerm::alloc_id(&self) -> usize`
  - `pub fn var(i: u32) -> LambdaTerm`
  - `pub fn abs(name: impl Into<Rc<str>>, body: LambdaTerm) -> LambdaTerm`
  - `pub fn app(f: LambdaTerm, a: LambdaTerm) -> LambdaTerm`
  - `pub fn shift(d: i64, cutoff: u32, t: &LambdaTerm) -> LambdaTerm` (unchanged signature)
  - `pub fn subst(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm` (unchanged signature)
  - `pub fn beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm` (unchanged signature)

- [x] **Step 1: Rewrite the type, constructors, and `Rc` import in `term.rs`**

Replace lines 1–34 of `crates/redextape-core/src/lambda/term.rs`:

```rust
//! de Bruijn lambda-terms. Indices are 0-based (0 = innermost binder). The `Abs` name hint is used
//! only when printing; equality is de Bruijn structural, so substitution is pure index arithmetic
//! (no fresh names, no capture).
//!
//! STRUCTURALLY SHARED, AND THAT IS THE POINT. `LambdaTerm` is a handle around one `Rc<Node>`, so
//! cloning ANY term at ANY level — including the root — is a refcount bump rather than a deep copy.
//! The reducer's spine rebuild (`reduce.rs`) was measured deep-cloning the untouched sibling subtree
//! at every level of the redex path; that is what this representation removes. See
//! `docs/superpowers/specs/2026-07-30-lambda-structural-sharing-design.md`.

use std::rc::Rc;

/// A lambda-term. One `Rc` per node; `.node()` reaches the variant.
#[derive(Clone, Debug)]
pub struct LambdaTerm(Rc<Node>);

/// The shape of a term. `pub` because five modules in `src/` match on it; a private inner enum would
/// need a parallel view type for no gain.
#[derive(Debug)]
pub enum Node {
    /// de Bruijn index; 0 refers to the innermost enclosing `Abs`.
    Var(u32),
    /// Abstraction with a print-only name hint and a body.
    ///
    /// `Rc<str>`, not `String`: the hint is print-only and `PartialEq` ignores it, so a `String`
    /// would make every clone allocate — defeating the point at the root, which is cloned once per
    /// step by `reduce_trace`. `abs` takes `impl Into<Rc<str>>`, which accepts `&str` and `String`
    /// alike, so no call site changed.
    Abs(Rc<str>, LambdaTerm),
    /// Application.
    App(LambdaTerm, LambdaTerm),
}

impl LambdaTerm {
    /// The variant. Deliberately a method rather than a `Deref` impl: the indirection stays visible
    /// at every match site instead of being inferred, in exactly the code that most needs to read
    /// literally.
    pub fn node(&self) -> &Node {
        &self.0
    }

    /// Allocation identity. Two terms sharing this ARE the same allocation, which is what makes
    /// structural sharing OBSERVABLE to a test rather than merely assumed from the type. Returns
    /// `usize` rather than a raw pointer so nothing can dereference it.
    pub fn alloc_id(&self) -> usize {
        Rc::as_ptr(&self.0) as usize
    }
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
    LambdaTerm(Rc::new(Node::Var(i)))
}

pub fn abs(name: impl Into<Rc<str>>, body: LambdaTerm) -> LambdaTerm {
    LambdaTerm(Rc::new(Node::Abs(name.into(), body)))
}

pub fn app(f: LambdaTerm, a: LambdaTerm) -> LambdaTerm {
    LambdaTerm(Rc::new(Node::App(f, a)))
}
```

- [x] **Step 2: Rewrite `shift`, `subst` and `beta` in `term.rs`**

Keep the entire existing `# Panics` doc comment on `shift` verbatim — it documents the anti-miscompile guard and is explicitly out of scope. Replace only the bodies (old lines 55–89):

```rust
pub fn shift(d: i64, cutoff: u32, t: &LambdaTerm) -> LambdaTerm {
    match t.node() {
        Node::Var(k) => {
            if *k >= cutoff {
                let shifted = i64::from(*k) + d;
                assert!(shifted >= 0, "shift({d}, {cutoff}) produced a negative de Bruijn index from Var({k})");
                var(shifted as u32)
            } else {
                var(*k)
            }
        }
        Node::Abs(n, b) => abs(Rc::clone(n), shift(d, cutoff + 1, b)),
        Node::App(f, a) => app(shift(d, cutoff, f), shift(d, cutoff, a)),
    }
}

/// Substitute `s` for the variable with index `j` in `t`.
pub fn subst(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    match t.node() {
        Node::Var(k) => {
            if *k == j {
                s.clone()
            } else {
                var(*k)
            }
        }
        Node::Abs(n, b) => abs(Rc::clone(n), subst(j + 1, &shift(1, 0, s), b)),
        Node::App(f, a) => app(subst(j, s, f), subst(j, s, a)),
    }
}

/// β-reduce `(\. abs_body) arg`: substitute `arg` for index 0 in `abs_body`, then close the hole.
pub fn beta(abs_body: &LambdaTerm, arg: &LambdaTerm) -> LambdaTerm {
    shift(-1, 0, &subst(0, &shift(1, 0, arg), abs_body))
}
```

Note `s.clone()` in `subst`'s `Var(k) == j` arm is now a **refcount bump**, where it was a deep copy. That single line is a large share of the win.

- [x] **Step 3: Rewrite `PartialEq` with the `ptr_eq` fast path**

Replace old lines 91–102:

```rust
impl PartialEq for LambdaTerm {
    fn eq(&self, other: &Self) -> bool {
        // Pointer equality implies structural equality: an allocation cannot differ from itself.
        // This is the fast path structural sharing exists to enable — after a β-step, most of the
        // new term IS the old term, so most comparisons short-circuit at the first node.
        // `ptr_eq_short_circuits_without_changing_the_answer` proves it fires and changes nothing.
        if Rc::ptr_eq(&self.0, &other.0) {
            return true;
        }
        match (self.node(), other.node()) {
            (Node::Var(a), Node::Var(b)) => a == b,
            (Node::Abs(_, a), Node::Abs(_, b)) => a == b, // name hint ignored
            (Node::App(f1, a1), Node::App(f2, a2)) => f1 == f2 && a1 == a2,
            _ => false,
        }
    }
}

impl Eq for LambdaTerm {}
```

- [x] **Step 4: Rewrite the iterative `Drop`**

**This design was tried and does not terminate — do not build it.** Putting `Drop` on `Node` and
opening it with `let blank = var(0)` is a trap: `blank` is itself a `LambdaTerm` wrapping
`Rc<Node::Var(0)>`, and a `Node`-level `Drop` means the placeholder is itself a `Node`. When `blank`
goes out of scope at the end of `drop`, its own teardown re-enters this same `Drop::drop` — which
allocates *another* `blank`, whose teardown allocates another, without bound. This is not a
large-input-only defect: `drop(var(0))` alone recurses forever and aborts the process immediately, on
every run, verified by compiling the code above verbatim and running a test that merely compares two
three-node terms (SIGABRT, stack overflow, before any deep chain is involved).

There is also a cost problem hiding even if the recursion were fixed with an early return for `Var`:
each node popped off the worklist arrives as a `Node` **value** (out of `Rc::into_inner`), so the
compiler runs its own destructor when the loop iteration ends. That nested destructor allocates a
placeholder of its own — one malloc/free pair **per node freed**, exactly what the `Box` version
already cost, not the O(1) allocation this design claims.

Both problems trace to the same cause: `Drop` on `Node` means every value ever taken out of an `Rc`
is itself a `Drop` type, so the compiler's own glue re-enters the walk at a granularity the worklist
does not control. The fix is to put `Drop` on `LambdaTerm` instead and keep `Node` free of `Drop`
entirely — recorded on `Node`'s own doc comment as load-bearing rather than incidental. That has two
consequences that make the rest of this shape work:

- Because `Node` has no `Drop`, `Rc::into_inner`'s result can be **destructured by value** — the
  children move straight onto the worklist and nothing below the root needs a placeholder at all.
  (Moving a field out of a `Drop` type does not compile — the same rule, pointing the other way.)
- `blank` is allocated once per teardown and cloned only into the **root's** child slots, so the walk
  really is O(1) allocations, not O(nodes).

Replace old lines 104–126 with this instead:

```rust
/// Hand-written iterative destructor: a deep term (large lowering / reduction growth) would otherwise
/// recurse once per node in the compiler-generated `drop_in_place` and abort the process.
///
/// THE FIRST GUARD IS WHAT STRUCTURAL SHARING ADDS, and it is the whole difference from the `Box`
/// version. Dropping a handle is a decrement; only the LAST handle frees anything, so every other
/// drop must leave the term completely alone. `Rc::get_mut` below enforces that on its own, which
/// makes this check redundant for CORRECTNESS and load-bearing for COST: the overwhelmingly common
/// drop in the reducer is of a clone that is not the last one, and without this it would allocate a
/// placeholder and walk an empty worklist every time.
///
/// THE SECOND GUARD IS WHAT MAKES THIS TERMINATE AT ALL. `blank` is itself a `Var` handle, so its own
/// drop re-enters this function; allocating the placeholder before checking for a leaf recurses
/// forever on the placeholder alone — the very first `drop(var(0))` overflows the stack. A `Var` has
/// no children, so returning early leaves the compiler's field glue nothing to descend into.
///
/// ON `LambdaTerm`, NOT ON `Node`, and the two are not interchangeable. A `Node`-level `Drop` cannot
/// keep the placeholder to itself: every node taken off the worklist is then a `Node` value whose own
/// destructor runs when the iteration ends, so each one allocates a placeholder of its own (O(nodes),
/// which is what the `Box` version cost) and the placeholder's own teardown re-enters the same
/// destructor. Keeping `Node` free of `Drop` is also what lets `Rc::into_inner`'s result be
/// destructured BY VALUE below — moving a field out of a `Drop` type does not compile.
///
/// So `blank` is allocated ONCE per teardown and cloned (a refcount bump) into the ROOT's child slots
/// only; below the root nothing is replaced at all, because the children move straight out of the
/// returned `Node` onto the worklist. `into_inner` returning `Some` exactly when the popped handle was
/// the last one is also what keeps a SHARED graph iterative: the earlier handles decrement to `None`,
/// and the one that finally reaches zero continues this same loop instead of recursing through glue.
impl Drop for LambdaTerm {
    fn drop(&mut self) {
        if Rc::strong_count(&self.0) != 1 {
            return;
        }
        if matches!(*self.0, Node::Var(_)) {
            return;
        }
        let blank = var(0);
        let mut stack: Vec<LambdaTerm> = Vec::new();
        // Unlink the root's children so the drop glue that runs after this function returns has
        // nothing to descend into. `get_mut` is `Some`: the strong count is 1 (checked above) and no
        // `Weak` handle to a term is ever created.
        if let Some(root) = Rc::get_mut(&mut self.0) {
            match root {
                Node::Abs(_, b) => stack.push(std::mem::replace(b, blank.clone())),
                Node::App(f, a) => {
                    stack.push(std::mem::replace(f, blank.clone()));
                    stack.push(std::mem::replace(a, blank.clone()));
                }
                Node::Var(_) => {}
            }
        }
        while let Some(mut t) = stack.pop() {
            // Swap the placeholder in and consume the `Rc` that comes out: `LambdaTerm` implements
            // `Drop`, so `t.0` cannot be moved out of it directly. `t` is left holding `blank`, whose
            // strong count exceeds one for as long as this function runs, so dropping `t` at the end
            // of the iteration takes the first guard's early return.
            let rc = std::mem::replace(&mut t.0, Rc::clone(&blank.0));
            if let Some(node) = Rc::into_inner(rc) {
                match node {
                    Node::Abs(_, b) => stack.push(b),
                    Node::App(f, a) => {
                        stack.push(f);
                        stack.push(a);
                    }
                    Node::Var(_) => {}
                }
            }
        }
    }
}
```

There is no free-standing `take_children` helper in this shape — the unlink logic is inlined once for
the root (via `Rc::get_mut`, which only unlinks when uniquely owned) and once for the worklist loop
(via `Rc::into_inner`, which only yields a `Node` to destructure when the popped handle was the last
one). `Node` gains a doc comment recording that its lack of a `Drop` impl is load-bearing, so nobody
adds one later without re-reading this.

Both guards are verified load-bearing by sabotage, the same way Task 3 verifies its own test:
removing the `Var` guard aborts on the first `drop(var(0))`-shaped test (SIGABRT, stack overflow);
unlinking only uniquely-owned children (i.e. skipping the `Rc::get_mut`/`Rc::into_inner` distinction)
leaves the three Task 1 chains passing but the shared-child chain aborting — which is exactly the gap
Task 3 pins with its own dedicated test.

- [x] **Step 5: Fix `term.rs`'s own tests**

`abs("x", var(0))` and friends compile unchanged (`&str: Into<Rc<str>>`). The six existing tests in `mod tests` need **no edits**. Confirm that rather than assuming it.

- [x] **Step 6: Fix `reduce.rs`**

`depth_exceeds` (lines 54–70) — change only the `match`:

```rust
        match node.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push((b, d + 1)),
            Node::App(f, a) => {
                stack.push((f, d + 1));
                stack.push((a, d + 1));
            }
        }
```

`reduce_step` (lines 95–121) — this is the measured hot spot:

```rust
pub fn reduce_step(t: &LambdaTerm) -> Option<(LambdaTerm, Path)> {
    // Redex at the root: (\. body) arg
    if let Node::App(f, a) = t.node()
        && let Node::Abs(_, body) = f.node()
    {
        return Some((beta(body, a), Vec::new()));
    }
    match t.node() {
        Node::App(f, a) => {
            // Try the function side first (leftmost), then the argument. Both `clone`s below are
            // refcount bumps; under `Box` they deep-copied the untouched sibling at every level of
            // the path, which is the cost this representation exists to remove.
            if let Some((f2, mut path)) = reduce_step(f) {
                path.insert(0, Dir::AppL);
                Some((app(f2, a.clone()), path))
            } else if let Some((a2, mut path)) = reduce_step(a) {
                path.insert(0, Dir::AppR);
                Some((app(f.clone(), a2), path))
            } else {
                None
            }
        }
        Node::Abs(n, b) => reduce_step(b).map(|(b2, mut path)| {
            path.insert(0, Dir::AbsBody);
            (abs(std::rc::Rc::clone(n), b2), path)
        }),
        Node::Var(_) => None,
    }
}
```

Update the import at line 38:

```rust
use crate::lambda::term::{Dir, LambdaTerm, Node, Path, abs, app, beta};
```

- [x] **Step 7: Fix `decode.rs`'s 23 match sites**

One mechanical rule, applied at `decode.rs:78-84`, `:102-111`, `:124-128`, `:135-138`, `:146-151`:

| before | after |
| --- | --- |
| `let LambdaTerm::Abs(_, outer) = cur else` | `let Node::Abs(_, outer) = cur.node() else` |
| `outer.as_ref()` | `outer.node()` |
| `body.as_ref()` | `body.node()` |
| `matches!(c.as_ref(), LambdaTerm::Var(0))` | `matches!(c.node(), Node::Var(0))` |
| `cur = t_term.as_ref();` | `cur = t_term;` |
| `LambdaTerm::Var(1) => …` | `Node::Var(1) => …` |

Worked example — `decode_list_ty` (lines 74–92) becomes:

```rust
fn decode_list_ty(nf: &LambdaTerm, elem: &Ty) -> Option<Value> {
    let mut heads: Vec<Value> = Vec::new();
    let mut cur = nf;
    loop {
        let Node::Abs(_, outer) = cur.node() else { return None };
        let Node::Abs(_, body) = outer.node() else { return None };
        match body.node() {
            Node::Var(1) => break, // nil
            Node::App(ca, t_term) => {
                let Node::App(c, h_term) = ca.node() else { return None };
                if !matches!(c.node(), Node::Var(0)) {
                    return None;
                }
                heads.push(decode_lambda_ty(h_term, elem)?);
                cur = t_term;
            }
            _ => return None,
        }
    }
```

Add `Node` to `decode.rs`'s `use` of `crate::lambda::term::…`.

- [x] **Step 8: Fix `syntax.rs`'s 5 match sites**

`write_term` (line 205): `match t {` → `match t.node() {`, then `LambdaTerm::Var` → `Node::Var`, `LambdaTerm::Abs` → `Node::Abs`, `LambdaTerm::App` → `Node::App`.

`fresh(hint, names)` at line 211 compiles **unchanged**: `fresh` takes `&str` (`syntax.rs:254`) and `&Rc<str>` deref-coerces to `&str`.

`write_app_fn` (line 234) and `write_atom` (line 242) likewise:

```rust
fn write_app_fn(t: &LambdaTerm, names: &mut Vec<String>, out: &mut String, spans: &mut crate::analysis::Classified) {
    match t.node() {
        Node::Abs(..) => parenthesized(t, names, out, spans),
        _ => write_term(t, names, out, spans),
    }
}

fn write_atom(t: &LambdaTerm, names: &mut Vec<String>, out: &mut String, spans: &mut crate::analysis::Classified) {
    match t.node() {
        Node::Var(_) => write_term(t, names, out, spans),
        _ => parenthesized(t, names, out, spans),
    }
}
```

Note both pass `t` (the handle), not the matched node, to the callee — unchanged from today.

- [x] **Step 9: Fix `lower.rs`'s 3 match sites**

All three are in `#[cfg(test)]`, in `subterm_at` (lines 1022–1032):

```rust
    fn subterm_at<'a>(t: &'a LambdaTerm, path: &[Dir]) -> Option<&'a LambdaTerm> {
        let mut cur = t;
        for d in path {
            cur = match (d, cur.node()) {
                (Dir::AppL, Node::App(f, _)) => f,
                (Dir::AppR, Node::App(_, a)) => a,
                (Dir::AbsBody, Node::Abs(_, b)) => b,
                _ => return None,
            };
        }
        Some(cur)
    }
```

- [x] **Step 10: Fix the probe's 12 match sites**

`crates/redextape-core/examples/lambda_sharing_probe.rs` — `intern_term`, `size_of`, `collect_subterms`. Same rule; `b.as_ref()` / `f.as_ref()` become `b` / `f` since children are already `&LambdaTerm`, and `std::ptr::from_ref(b.as_ref())` becomes `std::ptr::from_ref(b)`.

The probe's `by_addr` keying still works: a `&LambdaTerm` handle's address is stable for the duration of the call. Add `Node` to its `use`.

- [x] **Step 11: Fix `decode.rs`'s cross-thread test**

`decode_lambda_ty_is_iterative_over_the_list_spine` (lines 317–334) currently *moves* a `LambdaTerm` into a `spawn`, which `Rc` makes illegal. Build it inside instead:

```rust
    /// The decode AND its assertion both run inside the thread: `Value` holds `Rc`s, so it is not
    /// `Send` — and since `LambdaTerm` became `Rc`-backed, neither is the term. `Vec<u64>` is, so
    /// `ns` is moved in and both the term and the expected list are built there.
    ///
    /// WIDER THAN IT WAS, stated rather than glossed. The term used to be built on the main thread
    /// so only the DECODE was measured against the small stack; it now also covers construction and
    /// teardown. That is acceptable because `scott_list_nf` builds with an iterative loop and
    /// `LambdaTerm`'s `Drop` is iterative by contract — but it means a failure here no longer points
    /// at the decode alone, and the stack size below was re-derived with construction included
    /// rather than inherited.
    #[test]
    fn decode_lambda_ty_is_iterative_over_the_list_spine() {
        let ns: Vec<u64> = (0..5_000).map(|i| i % 10).collect();
        std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || {
                let term = scott_list_nf(&ns);
                let decoded = decode_lambda_ty(&term, &Ty::List(Box::new(Ty::Nat))).expect("a 5,000-cell list decodes");
                assert_eq!(nat_list_to_vec(&decoded), Some(ns));
            })
            .expect("spawn a small-stack thread")
            .join()
            .expect("the decode thread must not overflow its stack");
    }
```

`scott_list_nf` (line 271) builds with a `for` loop over `ns.iter().rev()`, so its stack cost is O(1) and **256 KiB is expected to still pass**. Run it; only if it fails, raise to the smallest multiple of 256 KiB that passes and say so in the comment. Do not raise pre-emptively.

- [x] **Step 12: Build and fix whatever the compiler finds**

Run: `cargo build --workspace --all-targets`
Expected: clean. Compiler errors here are the mechanical sites this plan may have missed; fix them by the same rule. Do **not** change any expected value in a test to make it compile — see Global Constraints.

- [x] **Step 13: Run the full gate**

Run: `scripts/check-all.sh --no-llvm`
Expected: green across the default and `--no-default-features` configurations, with **zero edited expectations**. Include the LLVM configurations by dropping `--no-llvm` if LLVM 22 is installed.

- [x] **Step 14: Verify the dependency-free constraint still holds**

Run: `cargo tree -p redextape-core --edges normal`
Expected: only `redextape-core v0.0.0` itself.

- [x] **Step 15: Commit**

```bash
git add -A
git commit -m "refactor(lambda): LambdaTerm becomes a structurally shared Rc newtype

struct LambdaTerm(Rc<Node>) with a pub Node reached through .node(). Cloning
any term at any level is now one refcount bump, so reduce_step's spine rebuild
and subst's substituted-argument clone stop deep-copying untouched subtrees.

Drop moves to Node and descends only into uniquely-owned children —
Rc::into_inner is Some exactly then. The blank placeholder is allocated once
per teardown and cloned, so the walk allocates O(1) rather than O(nodes).

PartialEq gains a ptr_eq short-circuit; after a beta-step most of the new term
IS the old term, so most comparisons stop at the first node.

The Abs name hint is Rc<str> rather than String so a root clone allocates
nothing. abs() takes impl Into<Rc<str>>, so no call site changed.

decode_lambda_ty_is_iterative_over_the_list_spine built its term on the main
thread and moved it into a 256 KiB thread; Rc makes LambdaTerm !Send, so the
term is now built inside. Its coverage widens from decode alone to build +
decode + drop, which the comment now says.

No printed byte moved: every golden, round-trip, span and fixture test passes
unedited."
```

**Estimate: 2–3 hours**, most of it Step 7 and Step 12.

---

### Task 3: The failure mode `Rc` introduces

Task 1's three tests cover a uniquely-owned chain. `Rc` adds a second case the `Box` version could not have: an interior node whose strong count exceeds one, where the walk must **stop unlinking** and merely decrement. A `Drop` that unconditionally unlinks would corrupt a live shared subterm; one that never unlinks would overflow.

By the time this task ran, Task 2 had already added a fourth existing test —
`dropping_deep_lambda_shared_child_chain_does_not_overflow`, shared at EVERY level, everything dying
together — to pin the Task 2 rewrite itself. This task's test is a genuinely different shape and
stays that way on purpose: shared at exactly ONE interior point, unique above and below it, with the
sharer still alive when the shared-holding chain is dropped. Only that shape can catch a **corrupted
survivor** — the all-shared test cannot, because nothing in it survives to be checked.

**Files:**
- Modify: `crates/redextape-core/src/lib.rs` (`mod drop_tests`)

**Interfaces:**
- Consumes: `LambdaTerm`, `crate::lambda::term::{Node, abs, var}` from Task 2.

- [x] **Step 1: Write the failing test**

```rust
    /// A deep chain SHARED partway down — the failure mode `Rc` introduces and `Box` could not have.
    /// The walk must stop unlinking where the strong count exceeds one and merely decrement, without
    /// either corrupting the still-live `keep` or falling back to a recursive teardown of the rest.
    ///
    /// THIS IS A DIFFERENT SHAPE FROM `dropping_deep_lambda_shared_child_chain_does_not_overflow`
    /// ABOVE, and deliberately so — do not fold one into the other. That test shares at EVERY level
    /// and everything dies together in one `drop`; it cannot catch a corrupted survivor because
    /// nothing survives. Here sharing is at exactly ONE interior node — the top of `keep`'s chain —
    /// unique above it (in `outer`'s own 20,000 "y" levels) and unique below it (in `keep`'s 20,000
    /// "x" levels), and `outer` is dropped while `keep` is still alive, so the shared node IS shared
    /// at teardown time. The property only this test can catch is non-corruption of a survivor: after
    /// `drop(outer)`, `keep` must still be a valid, fully intact 20,000-deep term.
    ///
    /// That check has to be more than "did not crash": the spine below is walked and counted BEFORE
    /// `keep` is dropped, so a corrupted survivor fails an assertion here rather than merely surviving
    /// to (or failing at) the second `drop`.
    ///
    /// Two drops, in this order on purpose: the outer chain goes first while `keep` is still alive
    /// (so the shared node IS shared at teardown time — the whole point), then `keep` goes, which is
    /// itself a 20,000-deep uniquely-owned teardown.
    #[test]
    fn dropping_a_deep_chain_shared_partway_down_does_not_overflow() {
        std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(|| {
                use crate::lambda::term::{Node, abs, var};
                let mut keep = var(0);
                for _ in 0..20_000 {
                    keep = abs("x", keep);
                }
                let mut outer = keep.clone(); // strong count 2 at this node
                for _ in 0..20_000 {
                    outer = abs("y", outer);
                }
                drop(outer); // must stop at the shared node, not recurse past it

                // Observe that `keep` survived intact, rather than merely not crashing: walk its
                // spine iteratively and count the levels.
                let mut depth = 0u32;
                let mut cur = &keep;
                loop {
                    match cur.node() {
                        Node::Abs(_, body) => {
                            depth += 1;
                            cur = body;
                        }
                        Node::Var(_) => break,
                        Node::App(..) => panic!("keep should be a pure Abs chain over a Var leaf"),
                    }
                }
                assert_eq!(depth, 20_000, "keep must still be a fully intact 20,000-deep chain");

                drop(keep); // now uniquely owned again; tears down iteratively
            })
            .unwrap()
            .join()
            .unwrap();
    }
```

- [x] **Step 2: Run it**

Run: `cargo nextest run -p redextape-core -E 'test(dropping_a_deep_chain_shared)'`
Expected: PASS.

- [x] **Step 3: Prove it is non-vacuous**

Two sabotages, because this test guards two opposite mistakes. Apply each on its own, run, then revert.
The brief that first proposed these sabotages assumed the old (non-terminating) `impl Drop for Node`
shape from Task 2's original Step 4 — in particular a free-standing `take_children` helper that the
shipped code does not have. Both are restated below against the real `impl Drop for LambdaTerm` in
`term.rs`.

**Sabotage A — never descend** (the "forgot to tear down iteratively" mistake). In `term.rs`'s `Drop`,
replace the entire `while let Some(mut t) = stack.pop() { … }` loop body so nothing is unlinked below
the first level:

```rust
        while let Some(_t) = stack.pop() {} // sabotage A: never descend
```

Run: `cargo nextest run -p redextape-core -E 'test(dropping_deep_lambda) + test(dropping_a_deep_chain_shared)'`
Expected: this filter now matches **five** tests — Task 1's three chains, Task 2's
`dropping_deep_lambda_shared_child_chain_does_not_overflow`, and this task's new one — and all five
**abort** the process (SIGABRT, stack overflow). Popping `_t` without descending does not stop the
recursion; it just relocates it: `_t` is still a full `LambdaTerm` handle, and dropping it at the end
of the (now-empty) loop body re-enters `LambdaTerm::drop` through the compiler's own glue — a genuine
recursive function call, one native stack frame per level, instead of a loop iteration. That is
recursive `drop_in_place` again, wearing a different hat.

**Sabotage B — descend unconditionally** (the mistake `Rc` specifically introduces). The shipped loop
extracts a `Node` from the popped `Rc` via `Rc::into_inner(rc)`, which yields `Some` only when the
popped handle was the last strong reference — that is the uniqueness check. Force extraction even
when it is not the last reference:

```rust
            let rc = std::mem::replace(&mut t.0, Rc::clone(&blank.0));
            // sabotage B: unlink even when the child is shared
            let forced = Rc::try_unwrap(rc).unwrap_or_else(|shared| (*shared).clone());
            match forced {
                Node::Abs(_, b) => stack.push(b),
                Node::App(f, a) => {
                    stack.push(f);
                    stack.push(a);
                }
                Node::Var(_) => {}
            }
```

This does not compile: `error[E0599]: no method named `clone` found for enum `Node``. `Node` derives
only `Debug`, not `Clone`, so there is no legal way to pull an owned `Node` out of an `Rc` you do not
uniquely hold. Record that as the result, verbatim, rather than adding a `Clone` impl to make it
compile — adding one would defeat the point of the sabotage. The uniqueness check is not a runtime
guard you could forget; it is the only shape that type-checks. Sabotage A is therefore the live risk
and B is structurally impossible, confirmed by the compiler rather than merely asserted.

Restore the real `Drop` afterwards and confirm all five tests pass.

- [x] **Step 4: Commit**

```bash
git add crates/redextape-core/src/lib.rs
git commit -m "test(lambda): pin the shared-chain teardown Rc introduces

Task 1's chains are uniquely owned. Rc adds a case Box could not have: an
interior node with strong count > 1, where the walk must stop unlinking and
merely decrement. Unconditional unlinking would corrupt a live subterm; never
unlinking would overflow. Non-vacuity verified by sabotaging the descent."
```

**Estimate: 30 minutes.**

---

### Task 4: Prove the `ptr_eq` fast path fires

A fast path that never fires is dead code that reads as an optimization. This pins both halves: it *is* taken, and it changes *no* answer.

**Files:**
- Modify: `crates/redextape-core/src/lambda/term.rs` (`mod tests`)

**Interfaces:**
- Consumes: `LambdaTerm::alloc_id`, `var`, `abs`, `app` from Task 2.

- [x] **Step 1: Write the tests**

Append to `term.rs`'s `mod tests`:

```rust
    /// The `ptr_eq` short-circuit fires on real reduction output, and agrees with the structural
    /// answer wherever both apply. Two halves, because either alone is worthless: a fast path that
    /// never fires is dead code, and one that fires but disagrees is a miscompile.
    #[test]
    fn ptr_eq_short_circuits_without_changing_the_answer() {
        // Shared: the SAME allocation on both sides. Structurally equal too, so the fast path and
        // the slow path must agree.
        let shared = abs("x", app(var(0), var(1)));
        let a = shared.clone();
        let b = shared.clone();
        assert_eq!(a.alloc_id(), b.alloc_id(), "clone must share the allocation, not copy it");
        assert_eq!(a, b);

        // Structurally equal but SEPARATELY BUILT: different allocations, so the fast path cannot
        // fire and the structural walk must still say equal. This is the case interning would
        // collapse and `Rc` cannot.
        let c = abs("x", app(var(0), var(1)));
        assert_ne!(shared.alloc_id(), c.alloc_id(), "separately built terms are separate allocations");
        assert_eq!(shared, c);

        // Different terms stay different — the fast path must not make everything equal.
        assert_ne!(shared, abs("x", app(var(1), var(0))));
    }

    /// A β-step physically inherits the untouched sibling: that is the property the whole
    /// representation exists for, and it is what makes the `ptr_eq` path fire in the reducer rather
    /// than only in a hand-built test.
    #[test]
    fn a_beta_step_inherits_the_untouched_sibling_allocation() {
        use crate::lambda::reduce::reduce_step;
        // ((\x. x) y) sibling — the redex is on the LEFT, so `sibling` must survive by identity.
        let sibling = abs("s", app(var(0), var(0)));
        let redex = app(abs("x", var(0)), var(7));
        let t = app(redex, sibling.clone());

        let (next, _path) = reduce_step(&t).expect("a redex exists");
        let Node::App(_, inherited) = next.node() else { panic!("expected an App at the root") };
        assert_eq!(
            inherited.alloc_id(),
            sibling.alloc_id(),
            "the untouched sibling must be inherited by identity, not rebuilt"
        );
    }
```

- [x] **Step 2: Run them**

Run: `cargo nextest run -p redextape-core -E 'test(ptr_eq_short_circuits) + test(a_beta_step_inherits)'`
Expected: `2 tests run: 2 passed`

- [x] **Step 3: Commit**

```bash
git add crates/redextape-core/src/lambda/term.rs
git commit -m "test(lambda): the ptr_eq path fires, and changes no answer

Both halves, because either alone is worthless: a fast path that never fires is
dead code, one that fires but disagrees is a miscompile. The second test pins
the property in the REDUCER rather than only in a hand-built term — a beta-step
must inherit the untouched sibling by identity."
```

**Estimate: 30 minutes.**

---

### Task 5: The sharing gate

The design's §8 deliverable. Deterministic and machine-independent, so it belongs in CI where a wall-clock gate would not.

**Files:**
- Create: `crates/redextape-core/tests/lambda_sharing.rs`

**Interfaces:**
- Consumes: `LambdaTerm::{node, alloc_id}`, `Node`, `reduce_trace`, `lower` from Task 2.

- [x] **Step 1: Write the test with a deliberately wrong pinned number**

Create `crates/redextape-core/tests/lambda_sharing.rs`:

```rust
//! The sharing gate: `reduce_trace`'s snapshots share their subterms rather than copying them.
//!
//! DETERMINISTIC ON PURPOSE. This tree gates on counts and reports wall-clock in `examples/`
//! (`step_survey.rs`, `width_report.rs`, `lambda_sharing_probe.rs`), because a timing gate is a
//! flaky gate. The count below is machine-independent: it is a property of the reduction, not of
//! how fast the machine ran it.
//!
//! Two assertions, and the second is the one that bites:
//!
//!   1. NON-VACUITY — distinct allocations are strictly below the total node count. A representation
//!      that shares nothing fails here.
//!   2. A PINNED NUMBER, committed alongside the node total. A regression MOVES this number rather
//!      than merely staying under some threshold, which is what makes it a gate and not a smoke
//!      test. Same idiom as this tree's committed step counts.

// Test target: `clippy.toml`'s `allow-*-in-tests` keys do not reach free helpers in a `tests/`
// target, so the exemption is stated per target.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::HashSet;

use redextape_core::desugar::desugar;
use redextape_core::lambda::term::Node;
use redextape_core::lambda::{LambdaTerm, MAX_REDUCTION_STEPS, lower, reduce_trace};
use redextape_core::parser::parse;

/// `sum(5)` — row 9 of `three_way_oracle.rs::FIRST_ORDER_DEMOS`, and the program the Plan 4 design
/// quoted its λ figures from. Chosen so this gate and that table describe the same thing.
const SUBJECT: &str = "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)";

/// Every node of `t`, walked iteratively. Recursion would overflow on a deep term, which is exactly
/// the class of term this file is about.
fn walk(t: &LambdaTerm, nodes: &mut u64, seen: &mut HashSet<usize>) {
    let mut stack = vec![t];
    while let Some(n) = stack.pop() {
        *nodes += 1;
        seen.insert(n.alloc_id());
        match n.node() {
            Node::Var(_) => {}
            Node::Abs(_, b) => stack.push(b),
            Node::App(f, a) => {
                stack.push(f);
                stack.push(a);
            }
        }
    }
}

#[test]
fn reduce_trace_shares_its_snapshots() {
    let (prog, ds) = parse(SUBJECT);
    assert!(ds.is_empty(), "parse errors: {ds:?}");
    let term = lower(&desugar(&prog.unwrap())).expect("sum(5) lowers");
    let trace = reduce_trace(&term, MAX_REDUCTION_STEPS);

    let mut nodes = 0u64;
    let mut seen = HashSet::new();
    for s in &trace.steps {
        walk(&s.term, &mut nodes, &mut seen);
    }
    walk(&trace.normal_form, &mut nodes, &mut seen);

    // 1. Non-vacuity. A representation that shares nothing has distinct == nodes.
    assert!(
        (seen.len() as u64) < nodes,
        "no sharing at all: {} distinct allocations for {nodes} nodes",
        seen.len()
    );

    // 2. The pinned number. Replace both values with what the run actually reports.
    assert_eq!(nodes, 0, "total nodes across the trace");
    assert_eq!(seen.len(), 0, "distinct allocations across the trace");
}
```

- [x] **Step 2: Run it and read the real numbers off the failure**

Run: `cargo nextest run -p redextape-core --test lambda_sharing --no-capture`
Expected: FAIL on `assert_eq!(nodes, 0, …)`, reporting the actual totals. The non-vacuity assertion above it must already have **passed** — if it did not, sharing is not working and Task 2 is wrong.

The probe's committed table says `sum(5)` has 502,146 trace nodes, so `nodes` should land there. `distinct` has no predicted value; it is what this step discovers.

- [x] **Step 3: Pin the observed numbers**

Replace the two zeros with the observed values, and add the ratio as a comment, e.g.:

```rust
    // Measured 2026-07-30. 502,146 nodes -> <observed> distinct (<ratio>x). The probe's across-trace
    // column for row 9 predicts the same order; see `examples/lambda_sharing_probe.rs`.
    assert_eq!(nodes, 502_146, "total nodes across the trace");
    assert_eq!(seen.len(), 0 /* replace with observed */, "distinct allocations across the trace");
```

- [x] **Step 4: Re-run and confirm green**

Run: `cargo nextest run -p redextape-core --test lambda_sharing`
Expected: `1 test run: 1 passed`

- [x] **Step 5: Confirm the gate is machine-independent**

Run it twice more: `cargo nextest run -p redextape-core --test lambda_sharing --run-ignored all -j1` then again with default parallelism.
Expected: identical pass. The count must not depend on thread count or timing. If it varies, the test is wrong — allocation identity is being confused with allocation *address reuse*, and the walk must hold the trace alive throughout (it does: `trace` outlives `seen`).

- [x] **Step 6: Commit**

```bash
git add crates/redextape-core/tests/lambda_sharing.rs
git commit -m "test(lambda): gate that reduce_trace shares its snapshots

Deterministic and machine-independent, so it belongs in CI where a wall-clock
gate would not. Non-vacuity (distinct strictly below total) plus a pinned
number committed alongside the node total, the idiom this tree already uses for
step counts — a regression moves the number rather than merely staying under a
threshold.

Deliberately NOT phrased as O(steps) allocations: each step builds O(path)
spine nodes plus whatever beta builds, so the true bound is not linear in steps
and asserting that it is would be wrong."
```

**Estimate: 45 minutes.**

---

### Task 6: Re-measure, and correct the record

Layer 1's numbers. The spec's §2 and §3 tables are `main`'s baseline; this adds the after column and corrects Plan 4's roadmap entry.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-lambda-structural-sharing-design.md` (§2, §3)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (the Plan 4 entry)

**Interfaces:** none — documentation only.

- [x] **Step 1: Re-run the probe on the converted code**

Run: `cargo run --release --example lambda_sharing_probe -p redextape-core`
Expected: the self-verification line prints first (`interner verified: 4 hand-built cases + 46 real reduction terms recounted by PartialEq`), then the 46-row table.

Capture the full output. The `replay ms` column is the layer-1 result; the `distinct` columns should be **unchanged**, because interning was not implemented — if they moved, the conversion changed term structure and that is a bug.

- [x] **Step 2: Add the after column to §2**

Rewrite §2's table with `before` and `after` columns for all seven rows named there (9, 26, 10, 7, 29, 31, plus 28, 32, 33 if they still exceed 350 ms), and state the speedup factor. Keep the "row 9 of 46, not the worst case" correction — it is true of the baseline regardless of what the fix achieved.

- [x] **Step 3: Record what layer 1 did and did not fix in §3**

Add a subsection stating plainly whether the worst case is still a hang. Do not soften it if it is: the spec's §7 makes layer 1.5 a gate precisely because that outcome is possible.

- [x] **Step 4: Correct the Plan 4 roadmap entry**

In `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, the Plan 4 section says **"`Rc<LambdaTerm>` remains the λ performance fix"** and quotes 99 ms. Add a short block under it recording: that the slice landed, the measured before/after, that 99 ms was row 9 of 46 rather than the worst case, and that hash-consing was measured *not* to be YAGNI — with the within-term ratio as the evidence.

- [x] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(spec,roadmap): layer 1's measured result, and Plan 4's correction

The probe re-run on the converted code. The distinct columns are unchanged by
construction — interning was not implemented, so any movement there would be a
structural bug rather than a result.

Plan 4's entry quoted 99 ms as the lambda cost; that was row 9 of 46 and the
corpus worst case was 2,580 ms. Recorded there rather than only here, since the
roadmap is what the next reader opens."
```

**Estimate: 45 minutes.**

---

### Task 7: Layer 1.5 — explain row 31

**This is a gate, not a nice-to-have.** The spec's §3 records that node count does not predict replay time: row 7 has bigger terms (9,763 vs 4,898) and more steps (470 vs 411) than row 31, yet ran 5.5x faster. Layers 2 and 3 are a speed bet. Neither can be evaluated against an unexplained 5.5x, so this task ends the plan and the next plan starts from its answer.

**Files:**
- Modify: `crates/redextape-core/examples/lambda_sharing_probe.rs`
- Modify: `docs/superpowers/specs/2026-07-30-lambda-structural-sharing-design.md` (§10)

**Interfaces:**
- Consumes: `reduce_step`, `Node`, `Dir`, `Path` from Task 2.

- [x] **Step 1: Add per-step work accounting to the probe**

The hypothesis to test: row 31's cost is **substitution blowup** — a large argument copied into many occurrences — while row 7 has large terms but small arguments. Four counters, chosen to *separate* the candidates rather than to confirm one: if two of them move together across the corpus, neither is the answer.

Append to `crates/redextape-core/examples/lambda_sharing_probe.rs`, and add `Dir` and `Trace` to its imports (`use redextape_core::lambda::{Trace, term::Dir, term::Node, …}`):

```rust
/// Per-step work accounting, summed over a whole trace.
#[derive(Default)]
struct Work {
    /// Spine-rebuild work: one node constructed per path element. Should be negligible after
    /// structural sharing — a large share here would mean the sharing is not doing its job.
    path_len: u64,
    /// `subst`'s traversal: the size of the abstraction body it walks, per step.
    body_size: u64,
    /// SUBSTITUTION BLOWUP — the hypothesis. Every occurrence of the bound variable is replaced by a
    /// copy of the shifted argument, so this is the work `subst` does that the body size alone does
    /// not bound.
    occ_times_arg: u64,
    /// Whether `depth_exceeds`' per-step O(size) walk is implicated: its cost tracks term size, and
    /// summing it here makes that comparable against the other three.
    term_size: u64,
}

/// Follow `path` from `t`. `None` if the path leaves the term.
fn subterm_at<'a>(t: &'a LambdaTerm, path: &[Dir]) -> Option<&'a LambdaTerm> {
    let mut cur = t;
    for d in path {
        cur = match (d, cur.node()) {
            (Dir::AppL, Node::App(f, _)) => f,
            (Dir::AppR, Node::App(_, a)) => a,
            (Dir::AbsBody, Node::Abs(_, b)) => b,
            _ => return None,
        };
    }
    Some(cur)
}

/// Occurrences of the variable bound by the enclosing binder inside `body`. The index starts at `j`
/// and increments under each `Abs`, so this counts exactly what `subst(0, …)` will replace.
/// Iterative, carrying the index alongside each node, so a deep body cannot overflow.
fn count_occurrences(body: &LambdaTerm, j: u32) -> u64 {
    let mut stack = vec![(body, j)];
    let mut n = 0u64;
    while let Some((t, k)) = stack.pop() {
        match t.node() {
            Node::Var(i) => {
                if *i == k {
                    n += 1;
                }
            }
            Node::Abs(_, b) => stack.push((b, k + 1)),
            Node::App(f, a) => {
                stack.push((f, k));
                stack.push((a, k));
            }
        }
    }
    n
}

fn account(trace: &Trace) -> Work {
    let mut w = Work::default();
    for s in &trace.steps {
        w.path_len += s.redex.len() as u64;
        w.term_size += size_of(&s.term);
        // The redex at `s.redex` is `(\. body) arg` by construction. A step that does not have that
        // shape would be a defect in the trace, not a case to tolerate — but this is a probe, so it
        // is skipped and the skip counted rather than aborting the whole table.
        let Some(redex) = subterm_at(&s.term, &s.redex) else { continue };
        let Node::App(f, arg) = redex.node() else { continue };
        let Node::Abs(_, body) = f.node() else { continue };
        w.body_size += size_of(body);
        w.occ_times_arg += count_occurrences(body, 0) * size_of(arg);
    }
    w
}
```

Print one row per program as **PART B** of the existing table: `#`, `replay ms`, `Σ path`, `Σ body`, `Σ occ×arg`, `Σ size`.

- [x] **Step 2: Run it and compare rows 7 and 31 directly**

Run: `cargo run --release --example lambda_sharing_probe -p redextape-core`
Expected: a counter whose ratio between rows 31 and 7 is close to their **5.5x time ratio**. That counter is the answer; ones that track term size are not.

- [x] **Step 3: Verify the explanation rather than accepting the correlation**

A matching ratio across two programs is one data point, not a cause. Check the identified counter against **all 46 rows**: rank programs by it and by `replay ms`, and report the disagreements. State the rank correlation and name every program the explanation fails on. An explanation that fits 44 of 46 is worth having and worth saying so precisely.

- [x] **Step 4: Record the answer in §10 and close the open question**

Rewrite the first bullet of the design's §10 ("What dominates λ replay time") from a question into a finding, with the counter, the evidence, and the rows it does not explain. Then state explicitly whether layers 2 and 3 are worth planning — that is this task's actual deliverable.

- [x] **Step 5: Record layer 1.5 in the roadmap**

Task 6 has this step for layer 1 and this task originally did not, which is how the roadmap came to
carry layer 1's result and none of layer 1.5's. **The roadmap is what the next reader opens**, and a
reader routing the next slice from it alone must not reach the conclusion the design's §10 explicitly
forbids ("Not 'fix `subst` and then do interning'").

In `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, under the λ block Task 6 added, record:
the finding and its counter; that it **answers** the gate that block leaves open, so
"explain what dominates λ replay time" is no longer open; that **layers 2 and 3 are declared not worth
planning** on that evidence; that §3's **memory** case for interning survives untouched while its
**speed corollary** does not; and what the next target actually is — `subst`'s per-binder re-shift,
then `beta`'s closing `shift(-1, 0, ·)`. Match the roadmap's voice: it records what was measured and
what was falsified.

- [x] **Step 6: Commit**

```bash
git add crates/redextape-core/examples/lambda_sharing_probe.rs docs/
git commit -m "measure(lambda): what actually dominates lambda replay time

Node count does not predict it — row 7 is larger than row 31 by every available
measure and ran 5.5x faster. Four per-step counters separate spine rebuild from
subst traversal from substitution blowup from depth.

Checked against all 46 rows rather than the two that motivated it, and the
programs the explanation fails on are named rather than dropped."
```

**Estimate: 2–3 hours.** The measurement is quick; Step 3 is most of it.

---

## Where this plan deliberately stops

**Layers 2 (interning) and 3 (memoized `subst`/`shift`/`depth_exceeds`) are not planned here.**

Not an oversight, and not deferral-by-default. Both are speed bets, and the spec's §3 states the limit of the evidence behind them: the probe measured **sharing, not speed**, and a de Bruijn shifted copy carries different indices that interning does not dedupe. Writing detailed tasks for either now would be planning against an unmeasured fact, and Task 7 exists to measure it.

After Task 7, the layer-2/3 plan is written from its answer — or, if Task 7 shows the dominant cost is something neither layer addresses, it is written against **that** instead. The probe already proved this discipline pays once: hash-consing was priced as YAGNI on intuition and the measurement refuted it.

Land Tasks 1–7 with `scripts/land.sh` before starting that plan, so `main` carries a working, tested, measured layer 1 rather than an open-ended branch.

**Total for Tasks 1–7: roughly one working day.**
