# Sharing-Aware Decode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all four `(word, heap) -> Value` decoders memoize on the pair they are already keyed by, so an aliased sub-list is built once instead of once per pointer into it, and bound the working memory that memoizing would otherwise leave unbounded.

**Architecture:** Two internal decoders (three today — two of them are a duplicate that this plan merges). Each gains a per-call `HashMap` memo and an inner recursive function that carries it; the existing public entry points keep their signatures and seed the memo. The type-directed decoder keys on `(pointer, depth)`, because it recurses only through `Ty::List(elem)` and so the depth names the type uniquely. The value-directed decoder keys on `(pointer, address of the expectation node)`. The budget then charges one unit per spine step as well as one per constructed node, which is what stops a memo hit — which constructs nothing — from making unbounded progress.

**Tech Stack:** Rust 2021, `std::collections::HashMap` only (no new dependency — `redextape-core` has exactly one, optional, and this plan does not add a second). `cargo nextest` for the suite.

**Design:** `docs/superpowers/specs/2026-08-28-sharing-aware-decode-design.md`. Section references below (§3, §4.1, …) are to that file.

## Global Constraints

- **Every commit must pass `pre-commit`, which runs `cargo clippy` with `-D warnings`.** A commit that leaves a warning cannot land, so no task may introduce an unused item and fix it in the next one. `--no-verify` is not an option.
- **`clippy::pedantic` is on workspace-wide, as written, with no lint allowed globally.** Every new `pub` function returning a value needs `#[must_use]`; every new `pub` function returning `Result` needs an `# Errors` doc section. Prefer `std::ptr::from_ref(x)` over `x as *const _`.
- **No `unwrap`/`expect`/`panic!`/`todo!`/`unimplemented!` in library code.** Test code is exempt, but only lexically inside a `#[test]` fn or a `#[cfg(test)]` module — a free helper in a `tests/` target is in neither, so files under `tests/` carry `#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]` at the top. `todo`/`unimplemented` are exempt nowhere.
- **No new dependency.** `redextape-core` has exactly one, optional; this branch does not add a second.
- **No new constant in the decode path.** `MAX_DECODE_NODES` keeps the value `20_000_000`; only its derivation doc changes. Raising it was considered and rejected before the branch started, because no constant closes the sharing gap — covering `d = 2` reopens `d = 3`. **Amended 2026-08-28:** Task 11 adds one constant OUTSIDE the decode path, `value::MAX_PRINT_NODES`, for a hazard the decode budget used to mask. The original constraint's target was inventing a bigger decode budget to paper over the gap; that still holds.
- **`asm::DEFAULT_CAPS.heap` is `5_000_000`. `ty::MAX_TY_DEPTH` is `64`.** Both are read, never changed.
- **No public entry point changes signature.** `decode_asm`, `decode_tape`, `decode_asm_ty`, `decode_tape_ty` and the two existing `_reason` siblings keep theirs. Two `_reason` siblings are added.
- **Out of scope, and must not get worse:** the value-directed decoder recurses on the list TAIL, so its stack depth is the list length. That is pre-existing, unrelated to sharing, and unchanged by this plan.
- Run measurements under `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0` — the thing being measured is unbounded allocation.

---

## File Structure

| file | responsibility | change |
|---|---|---|
| `crates/redextape-core/src/tm/asm.rs` | both internal decoders, `MAX_DECODE_NODES`, `DecodeFailure`, `spend`, the asm entry points | modified throughout |
| `crates/redextape-core/src/tm/decode.rs` | the TM-tape half: read tapes, then delegate | duplicate decoder deleted; `decode_tape_reason` added |
| `crates/redextape-core/src/tm.rs` | crate-level re-exports | two names added to the `asm::` and `decode::` re-export lists |
| `crates/redextape-core/tests/sharing_aware_decode.rs` | behaviour through the public API | created (Task 3) |
| `crates/redextape-core/tests/tm_oracle.rs` | oracle | 2 call sites (Task 8) |
| `crates/redextape-native/tests/llvm_oracle.rs` | oracle | 4 call sites (Task 8) |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | the record | entry appended (Task 10) |

Budget-accounting assertions live in `asm.rs`'s existing `#[cfg(test)] mod tests`, because `decode_word_ty` is `pub(crate)` and takes the budget as a parameter, so the count is readable there and nowhere else (§11).

---

## Task 1: Widen `asm::decode_word` and pin the duplicate's equivalence

The two value-directed decoders are a duplicate (§1). Before deleting one, prove they agree. The test needs to call both, so `asm::decode_word` has to be reachable from `tm::decode` — which is the same widening Task 2 needs anyway, and `decode_word_ty` already carries it.

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs` — `decode_word`'s visibility
- Modify: `crates/redextape-core/src/tm/decode.rs` — add a test to the existing `mod tests`

**Interfaces:**
- Produces: `pub(crate) fn decode_word(word: u64, heap: &[(u64, u64)], expected: &Value) -> Option<Value>` in `asm.rs` — Task 2 calls it from `tm::decode`.

- [ ] **Step 1: Write the failing test**

In `crates/redextape-core/src/tm/decode.rs`, inside the existing `#[cfg(test)] mod tests`:

```rust
/// The two value-directed decoders are a duplicate (see the sibling in `asm.rs`). This asserts they
/// agree on the same `(word, heap, expected)` triple, and exists so the commit that deletes one of
/// them is deleting something demonstrated redundant rather than something read as redundant.
///
/// It is removed by that same commit: once there is one function, this compares it with itself.
#[test]
fn the_two_value_directed_decoders_agree() {
    // cons(1, cons(2, nil)) — the outer cell is index 0, so the pointer to it is 1.
    let heap = vec![(1, 2), (2, 0)];
    let expected = Value::Cons(
        Rc::new(Value::Nat(0)),
        Rc::new(Value::Cons(Rc::new(Value::Nat(0)), Rc::new(Value::Nil))),
    );
    for word in [0_u64, 1, 2, 3, 99] {
        assert_eq!(
            super::decode_word(word, &heap, &expected),
            crate::tm::asm::decode_word(word, &heap, &expected),
            "the two decoders disagree at word {word}"
        );
    }
    // And on the shapes that are not lists at all.
    for exp in [Value::Nat(0), Value::Bool(false), Value::Nil, Value::Unit] {
        for word in [0_u64, 1, 2] {
            assert_eq!(
                super::decode_word(word, &heap, &exp),
                crate::tm::asm::decode_word(word, &heap, &exp),
                "the two decoders disagree at word {word} for {exp:?}"
            );
        }
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --lib tm::decode::tests::the_two_value_directed_decoders_agree`
Expected: FAIL to compile — `function 'decode_word' is private`.

- [ ] **Step 3: Widen the visibility**

In `crates/redextape-core/src/tm/asm.rs`, change the signature line of `decode_word` from

```rust
fn decode_word(word: u64, heap: &[(u64, u64)], expected: &Value) -> Option<Value> {
```

to

```rust
pub(crate) fn decode_word(word: u64, heap: &[(u64, u64)], expected: &Value) -> Option<Value> {
```

No other change. `decode_asm` in the same module already calls it, so nothing becomes dead.

- [ ] **Step 4: Run it to verify it passes**

Run: `cargo test -p redextape-core --lib tm::decode::tests::the_two_value_directed_decoders_agree`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/src/tm/decode.rs
git commit -m "Pin that the two value-directed decoders agree, before deleting one"
```

---

## Task 2: Delete the duplicate, and the doc paragraph it justified

**Files:**
- Modify: `crates/redextape-core/src/tm/decode.rs` — delete `decode_word` and the Task 1 test, redirect `decode_tape`
- Modify: `crates/redextape-core/src/tm/asm.rs` — replace the falsified paragraph in `decode_word_ty`'s doc

**Interfaces:**
- Consumes: `asm::decode_word` from Task 1.
- Produces: `tm::decode::decode_tape` unchanged in signature; `tm/decode.rs` no longer defines a decoder.

- [ ] **Step 1: Redirect `decode_tape`**

In `crates/redextape-core/src/tm/decode.rs`, change the body of `decode_tape` from

```rust
    let (word, heap) = read_result(tapes, enc)?;
    decode_word(word, &heap, expected)
```

to

```rust
    let (word, heap) = read_result(tapes, enc)?;
    crate::tm::asm::decode_word(word, &heap, expected)
```

- [ ] **Step 2: Delete the local copy and the Task 1 test**

Delete the whole `fn decode_word` item from `crates/redextape-core/src/tm/decode.rs`, including its `#[allow(clippy::similar_names)]` attribute and its doc comment. Delete the `the_two_value_directed_decoders_agree` test added in Task 1 — with one function, it compares that function with itself.

Then remove the now-unused imports from the top of the file. `use std::rc::Rc;` is used only by the deleted function; check with the compiler rather than by eye (Step 4).

- [ ] **Step 3: Replace the falsified paragraph**

In `crates/redextape-core/src/tm/asm.rs`, inside `decode_word_ty`'s doc comment, replace:

```rust
/// `pub(crate)` because `tm::decode::decode_tape_ty_reason` decodes
/// the same `(word, heap)` pair off a set of TAPES and must not carry a second copy of THIS decoder —
/// a second budget/cycle-bound pair could silently disagree with this one. That claim is narrower than
/// it sounds: the VALUE-directed sibling below, `decode_word`, IS duplicated — `tm::decode` has its
/// own copy rather than calling this one — but safely, since both recurse structurally on a finite
/// reference `Value` already in memory and need no budget at all (see `MAX_DECODE_NODES`'s doc above).
```

with:

```rust
/// `pub(crate)` because `tm::decode::decode_tape_ty_reason` decodes
/// the same `(word, heap)` pair off a set of TAPES and must not carry a second copy of THIS decoder —
/// a second budget/cycle-bound pair could silently disagree with this one. **That claim used to be
/// qualified, and the qualification was false.** It read: the VALUE-directed sibling `decode_word` IS
/// duplicated, "but safely, since both recurse structurally on a finite reference `Value` already in
/// memory and need no budget at all". A finite reference `Value` bounds TERMINATION and not COST — an
/// `Rc`-shared one is a DAG, and walking it expands the DAG back into a tree. So `decode_word` is no
/// longer duplicated either, for exactly the reason given above for this function.
```

Leave the rest of the doc comment untouched; the two-guards material below it is still accurate.

- [ ] **Step 4: Run the suite**

Run: `cargo clippy -p redextape-core --all-targets -- -D warnings && cargo nextest run -p redextape-core`
Expected: clippy clean (this is what catches a now-unused `use std::rc::Rc;`), all tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/src/tm/decode.rs
git commit -m "One value-directed decoder, not two, and the reason for two was false"
```

---

## Task 3: The type-directed memo — `(pointer, depth)` and suffix memoization

§4 and §4.1. The memo check at the top of the `Ty::List` arm, and the cons-up loop recording every suffix it forms. **Not** the mid-spine exits (Task 5) and **not** step charging (Task 4) — each of those has its own biting test, and landing them together would leave none of the three demonstrated.

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`
- Create: `crates/redextape-core/tests/sharing_aware_decode.rs`

**Interfaces:**
- Produces: `pub(crate) fn decode_word_ty(word: u64, heap: &[(u64, u64)], ty: &Ty, budget: &mut usize) -> Result<Value, DecodeFailure>` — signature UNCHANGED, so both existing callers are untouched. A new private `decode_word_ty_at(word: u64, heap: &[(u64, u64)], ty: &Ty, depth: usize, memo: &mut TyMemo, budget: &mut usize) -> Result<Value, DecodeFailure>` carries the recursion.
- Produces: `type TyMemo = HashMap<(u64, usize), Value>;`, private to `asm.rs`.
- Produces (test helpers, reused by Tasks 5, 6, 8): `tails_heap(m: u64) -> AsmOutcome` and `tails_value(m: u64) -> Value` in `tests/sharing_aware_decode.rs`.

- [ ] **Step 1: Write the failing test**

Create `crates/redextape-core/tests/sharing_aware_decode.rs`:

```rust
//! Sharing-aware decode: an aliased sub-list is built once, not once per pointer into it.
//!
//! The fixture throughout is `tails([1..m])`, whose inner lists all alias suffixes of ONE spine —
//! `2m` heap cells carrying `m^2 + m + 1` logical nodes. That is not a crafted heap; it is what an
//! ordinary `tails` returns, because `Instr::Tail` is a pointer read rather than an allocation.
//!
//! Design: docs/superpowers/specs/2026-08-28-sharing-aware-decode-design.md

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::rc::Rc;

use redextape_core::tm::{AsmOutcome, decode_asm, decode_asm_ty};
use redextape_core::ty::Ty;
use redextape_core::value::Value;

/// `tails([1..m])` as the compiler leaves it. Inner cell `i` is `(i, i+1)` with the last tail nil, so
/// the pointer `i` denotes the suffix `[i..m]`; the outer spine's `j`-th head is the pointer `j`.
/// `2m` cells, and the result word points at the first outer cell.
fn tails_heap(m: u64) -> AsmOutcome {
    let mut heap = Vec::new();
    for i in 1..=m {
        heap.push((i, if i == m { 0 } else { i + 1 }));
    }
    for j in 1..=m {
        let idx = m + j;
        heap.push((j, if j == m { 0 } else { idx + 1 }));
    }
    AsmOutcome { result: m + 1, heap }
}

/// The same value as the reference interpreter holds it: `Builtin::Tail` returns `(**t).clone()`,
/// which on a `Cons(Rc, Rc)` bumps two refcounts, so every suffix is SHARED rather than copied.
fn tails_value(m: u64) -> Value {
    let mut suffix = Rc::new(Value::Nil);
    let mut suffixes: Vec<Rc<Value>> = Vec::new();
    for i in (1..=m).rev() {
        suffix = Rc::new(Value::Cons(Rc::new(Value::Nat(i)), suffix));
        suffixes.push(Rc::clone(&suffix));
    }
    let mut out = Rc::new(Value::Nil);
    for s in suffixes {
        out = Rc::new(Value::Cons(s, out));
    }
    (*out).clone()
}

fn list_of_lists() -> Ty {
    Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))))
}

/// THE TEST THAT COULD NOT PASS BEFORE THIS BRANCH. At m = 64,000 the un-memoized decode is about
/// 4.1e9 logical nodes against a 20,000,000 budget, so it is refused. Memoized it is ~192,000.
#[test]
fn tails_decodes_far_past_the_unmemoized_budget() {
    let m = 64_000;
    let o = tails_heap(m);
    let got = decode_asm_ty(&o, &list_of_lists()).expect("type-directed decode of tails");
    assert_eq!(got, tails_value(m));
}

/// Equivalence at the sizes the un-memoized decoder could still finish. The expected value is built
/// independently by `tails_value` rather than captured from the old decoder, so this keeps biting
/// after the old code path is gone.
#[test]
fn memoized_decode_equals_the_independently_built_value() {
    for m in [1_000_u64, 2_000, 4_000] {
        let o = tails_heap(m);
        let want = tails_value(m);
        assert_eq!(decode_asm_ty(&o, &list_of_lists()).unwrap(), want, "type-directed, m={m}");
        assert_eq!(decode_asm(&o, &want).unwrap(), want, "value-directed, m={m}");
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --release -p redextape-core --test sharing_aware_decode`
Expected: `tails_decodes_far_past_the_unmemoized_budget` FAILS on `.expect("type-directed decode of tails")`, because the decode returns `None`. `memoized_decode_equals_the_independently_built_value` PASSES already — it is the equivalence guard, not the new capability, and it must be green both before and after.

Use `--release`. In a debug build the m = 64,000 fixture is slow enough to look hung.

- [ ] **Step 3: Add the memo**

In `crates/redextape-core/src/tm/asm.rs`, add the import at the top of the file, next to the existing `use std::rc::Rc;`:

```rust
use std::collections::HashMap;
```

Above `decode_word_ty`, add:

```rust
/// Memo for the type-directed decode, keyed `(heap pointer, depth)`.
///
/// **Depth identifies the type, and that is a property of this decoder rather than a convenience.**
/// `decode_word_ty_at` recurses in exactly one arm, `Ty::List(elem)`, and recurses on `elem` — so the
/// types visited from the root form a suffix chain of the root type, and a position in that chain
/// names one of them uniquely. A `usize` is therefore a complete key, with no `Ty` hashing and no
/// `Hash` impl on a public type.
///
/// Only LIST values are memoized. A `Nat`/`Bool`/`Unit` leaf costs one construction, where an entry
/// costs a hash, a key and a clone.
type TyMemo = HashMap<(u64, usize), Value>;
```

Replace `decode_word_ty`'s body — keeping its whole doc comment and signature — with a seeding wrapper:

```rust
pub(crate) fn decode_word_ty(
    word: u64,
    heap: &[(u64, u64)],
    ty: &Ty,
    budget: &mut usize,
) -> Result<Value, DecodeFailure> {
    let mut memo = TyMemo::new();
    decode_word_ty_at(word, heap, ty, 0, &mut memo, budget)
}
```

Add the recursion below it, which is the old body with three changes: the extra `depth`/`memo`
parameters, the memo check at the top of the `Ty::List` arm, and PASS 2 carrying each cell's pointer
so the cons-up loop can record every suffix.

```rust
/// `decode_word_ty`'s recursion, carrying the depth (which names the type — see `TyMemo`) and the
/// memo. Split out so the public path seeds one memo per decode and every recursive call shares it.
fn decode_word_ty_at(
    word: u64,
    heap: &[(u64, u64)],
    ty: &Ty,
    depth: usize,
    memo: &mut TyMemo,
    budget: &mut usize,
) -> Result<Value, DecodeFailure> {
    match ty {
        Ty::Nat => {
            spend(budget)?;
            Ok(Value::Nat(word))
        }
        Ty::Bool => {
            // The mismatch check runs BEFORE `spend` — see `DecodeFailure`'s doc on why that ordering
            // is exactly the hazard this enum exists to sidestep, rather than something to "fix" by
            // reordering: tagging the reason here, at the point of detection, is what makes the
            // ordering harmless.
            let v = match word {
                0 => Value::Bool(false),
                1 => Value::Bool(true),
                _ => return Err(DecodeFailure::Mismatch),
            };
            spend(budget)?;
            Ok(v)
        }
        Ty::Unit => {
            spend(budget)?;
            Ok(Value::Unit)
        }
        Ty::List(elem) => {
            // This list has been decoded already, at this same type. Cloning a `Value::Cons(Rc, Rc)`
            // bumps two refcounts, so the hit SHARES rather than rebuilds — which is not a side
            // effect of memoizing, it is the point: the result becomes a DAG whose distinct-node
            // count is what the budget measures.
            if let Some(v) = memo.get(&(word, depth)) {
                return Ok(v.clone());
            }

            // PASS 1 — walk the spine, decoding nothing and allocating nothing, so its cost is
            // bounded purely by `heap.len()`. Falling out of the loop means the chain never reached
            // nil, i.e. it is cyclic — a `Mismatch`, checked to completion BEFORE any head of this
            // spine is decoded, so an expensive element of THIS SPINE can never let `budget` run out
            // first and hide the cycle behind a `BudgetExhausted`. See this function's caller's doc.
            let mut w = word;
            let mut steps: usize = 0;
            loop {
                if w == 0 {
                    break;
                }
                if steps > heap.len() {
                    return Err(DecodeFailure::Mismatch); // the chain never reached nil: a cyclic heap
                }
                let Some(idx) = usize::try_from(w - 1).ok() else { return Err(DecodeFailure::Mismatch) };
                let Some(&(_, t)) = heap.get(idx) else { return Err(DecodeFailure::Mismatch) };
                steps += 1;
                w = t;
            }

            // PASS 2 — the spine is confirmed finite and acyclic, so decoding every head and spending
            // `budget` on it is honest. Each cell's POINTER is carried alongside its decoded head,
            // which costs 8 bytes per entry and is what lets the cons-up loop below memoize every
            // suffix rather than only the finished list.
            let mut cells: Vec<(u64, Value)> = Vec::new();
            let mut w = word;
            loop {
                if w == 0 {
                    break;
                }
                let Some(idx) = usize::try_from(w - 1).ok() else { return Err(DecodeFailure::Mismatch) };
                let Some(&(h, t)) = heap.get(idx) else { return Err(DecodeFailure::Mismatch) };
                cells.push((w, decode_word_ty_at(h, heap, elem, depth + 1, memo, budget)?));
                w = t;
            }

            spend(budget)?; // the Nil node
            let mut out = Value::Nil;
            for (ptr, h) in cells.into_iter().rev() {
                spend(budget)?; // each Cons node
                out = Value::Cons(Rc::new(h), Rc::new(out));
                // SUFFIX MEMOIZATION. `out` at this point is exactly the value of the list starting
                // at `ptr`, so recording it here — rather than recording only the finished list once
                // the loop ends — is what makes an aliased suffix a hit. `tails`'s m elements ARE the
                // m suffixes of one spine, so the first element's decode answers all the others.
                memo.insert((ptr, depth), out.clone());
            }
            Ok(out)
        }
        Ty::Fun(..) | Ty::Var(_) => Err(DecodeFailure::Mismatch),
    }
}
```

Delete the old `decode_word_ty` body's `match` (it has moved into `decode_word_ty_at`), and delete the
PASS-2 comment paragraph that reads "…decoding each head as it is reached rather than buffering words
first. `heads` grows only as heads are successfully decoded…" — the `Vec` is now `cells` and the
paragraph above replaces it.

- [ ] **Step 4: Run the tests**

Run: `cargo test --release -p redextape-core --test sharing_aware_decode`
Expected: both tests PASS.

Run: `cargo nextest run -p redextape-core`
Expected: all pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/tests/sharing_aware_decode.rs
git commit -m "Type-directed decode memoizes on (pointer, depth), and records every suffix"
```

---

## Task 4: The budget charges spine steps, and the derivation is rewritten

§6 and §6.1. A memo hit constructs nothing, so charging only constructed nodes leaves PASS 2's `cells` bounded by spine length x `MAX_TY_DEPTH` rather than by the budget.

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs` — one `spend` call, `MAX_DECODE_NODES`'s doc, and two unit tests

**Interfaces:**
- Consumes: `decode_word_ty_at` from Task 3.
- Produces: no signature change. The budget's MEANING changes: units of decoding work, not constructed nodes.

- [ ] **Step 1: Write the failing tests**

In `crates/redextape-core/src/tm/asm.rs`, inside the existing `#[cfg(test)] mod tests`:

```rust
/// A flat `List<Nat>` over L cells spends exactly `3L + 1`: L spine steps, L `Nat` leaves, one `Nil`,
/// L `Cons` nodes. Asserted as an EQUATION at more than one L, so a constant offset cannot pass it.
///
/// This is the derivation `MAX_DECODE_NODES`'s doc states, and it is checked here rather than in
/// `tests/` because the budget is a parameter of `decode_word_ty` and readable only from inside.
#[test]
fn a_flat_list_spends_exactly_three_per_cell_plus_one() {
    for l in [1_u64, 2, 7, 50] {
        // cons(1, cons(2, ... nil)): cell i is (i+1, i+2), last tail nil. Pointer 1 is the head.
        let heap: Vec<(u64, u64)> =
            (1..=l).map(|i| (i, if i == l { 0 } else { i + 1 })).collect();
        let ty = Ty::List(Box::new(Ty::Nat));
        let start = 1_000_usize;
        let mut budget = start;
        decode_word_ty(1, &heap, &ty, &mut budget).expect("flat list decodes");
        let spent = start - budget;
        assert_eq!(spent as u64, 3 * l + 1, "L={l}");
    }
}

/// §6's invariant, which is what keeps the memo from outgrowing the budget: every memo entry is paid
/// for by exactly one budget unit. Checked on the sharing fixture, where hits actually happen.
#[test]
fn every_memo_entry_is_paid_for_by_one_budget_unit() {
    // tails([1..m]) at a small m: inner cell i = (i, i+1); outer cell m+j = (j, next).
    let m = 6_u64;
    let mut heap: Vec<(u64, u64)> = (1..=m).map(|i| (i, if i == m { 0 } else { i + 1 })).collect();
    for j in 1..=m {
        heap.push((j, if j == m { 0 } else { m + j + 1 }));
    }
    let ty = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
    let start = 100_000_usize;
    let mut budget = start;
    let mut memo = TyMemo::new();
    decode_word_ty_at(m + 1, &heap, &ty, 0, &mut memo, &mut budget).expect("tails decodes");
    let spent = start - budget;
    // Every insert accompanies exactly one `spend` in the cons-up loop, and nothing else inserts, so
    // entries can never exceed units spent.
    assert!(memo.len() <= spent, "memo {} entries against {spent} units spent", memo.len());
    // And the decode is linear in cells, not quadratic: 2m cells, not ~m^2 nodes.
    assert!(spent < 10 * (2 * m as usize), "spent {spent} for {} cells", 2 * m);
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p redextape-core --lib tm::asm::tests::a_flat_list_spends_exactly_three_per_cell_plus_one tm::asm::tests::every_memo_entry_is_paid_for_by_one_budget_unit`
Expected: `a_flat_list_spends_exactly_three_per_cell_plus_one` FAILS with `assertion failed: left == right` showing `2L + 1` against `3L + 1` (e.g. `101` against `151` at L = 50). The invariant test PASSES already — it is a guard against a future change, and stating it now is the point.

- [ ] **Step 3: Charge the spine step**

In `decode_word_ty_at`'s `Ty::List` arm, in PASS 2, add one `spend` immediately after the nil check:

```rust
            let mut cells: Vec<(u64, Value)> = Vec::new();
            let mut w = word;
            loop {
                if w == 0 {
                    break;
                }
                spend(budget)?; // this spine step — see `MAX_DECODE_NODES`'s doc on why steps cost
                let Some(idx) = usize::try_from(w - 1).ok() else { return Err(DecodeFailure::Mismatch) };
```

- [ ] **Step 4: Rewrite `MAX_DECODE_NODES`'s derivation**

In `crates/redextape-core/src/tm/asm.rs`, replace the doc paragraph beginning "DERIVED, not picked:" and the whole "THE RESIDUAL GAP" section through the sharing table, the sentence "Closing the `d = 2` gap properly needs a SHARING-AWARE decode … Filed in the spec's 'What stays open'.", **and the two-line paragraph immediately after it** —

```rust
/// `decode_asm`/`decode_word`, the Value-directed siblings, need no budget: they recurse on a finite
/// reference `Value` already in memory, so its size is the bound.
```

— which carries the same falsified claim Task 2 removed from `decode_word_ty`'s doc, in a second place that does not name the function and so was out of Task 2's scope. Task 2's implementer flagged it. The replacement's last paragraph is its corrected form, so leaving it would produce both the new sentence and the stale one. Replace all of that with:

```rust
/// DERIVED, not picked, and the derivation counts WORK rather than nodes. A decode spends one unit
/// per constructed `Value` node and one per spine step, so a flat `List<Nat>` over an `L`-cell heap
/// costs `3L + 1`: `L` steps, `L` `Nat` leaves, one `Nil`, `L` `Cons` nodes. A run under
/// `DEFAULT_CAPS` may legitimately build `DEFAULT_CAPS.heap` = `5_000_000` cells, so the largest
/// legitimate flat decode is `3 * 5_000_000 + 1` = `15_000_001` against this constant's `20_000_000`.
/// It fits with `4_999_999` units of headroom, which is the figure to re-derive if `DEFAULT_CAPS.heap`
/// ever rises: above `6_666_666` cells the flat case alone exceeds the budget. The margin is 1.33x,
/// where the earlier `2L + 1` accounting left 2.0x.
///
/// **WHY STEPS COST, AND NOT ONLY NODES.** The decode memoizes on `(pointer, depth)`, and a memo hit
/// constructs nothing. Charging only constructed nodes would therefore leave a way to make progress
/// for free — and PASS 2's `cells` vector, which today is bounded because every head in it spent a
/// unit, would be bounded only by spine length times `MAX_TY_DEPTH`: 64 levels of up to 5,000,000
/// entries. Charging the step restores the bound. The invariant that follows, and the one worth
/// keeping in mind when editing either loop: **every memo entry is paid for by exactly one budget
/// unit, so the memo cannot outgrow the budget.**
///
/// **WHAT THIS CONSTANT NO LONGER HAS TO ABSORB.** It used to carry a documented residual gap:
/// `Instr::Tail` is a pointer read rather than an allocation, so an ordinary `tails`-style function
/// returns a `List<List<Nat>>` whose inner lists share the outer spine — `~2m` heap cells but
/// `m^2 + m + 1` decode nodes, because the decoder re-walked each shared sub-list once per pointer
/// into it. Breakeven was `m ~ 4_471`, three orders of magnitude below `DEFAULT_CAPS.heap`, so a
/// correct, fast, cap-respecting program could be refused. Memoization closes it: the same fixture at
/// `m = 64_000` decodes in about 192,000 nodes. What remains is honest — distinct `(pointer, depth)`
/// pairs are at most `heap.len() * (depth + 1)`, so a 5,000,000-cell heap under a 64-deep type can
/// still present 320,000,000 distinct nodes and be refused, and 320,000,000 distinct nodes is
/// 320,000,000 nodes of real memory.
///
/// `decode_asm`/`decode_word`, the Value-directed siblings, are bounded the same way and for the same
/// reason; see `decode_word`.
```

The two paragraphs before "DERIVED" — the one opening "A TOTALITY guard on untrusted input" and the one about `tm::decode::decode_tape_ty` being bounded by `sim::DEFAULT_CAPS.cells` — stay as they are. Both are still true.

- [ ] **Step 4a: Bound the memo's total size where the memo is defined**

Task 3's second review raised this and it belongs with the re-derivation rather than with the memo: `TyMemo`'s doc states the cost of one entry and not the cost of the table. Add a sentence there. The table can hold up to one entry per `Cons` spend, so it is bounded by the budget — roughly 20,000,000 entries, on the order of a gigabyte, at the current constant — which is a new term in the decoder's peak memory that did not exist before this branch. That bound is exactly the invariant this step's own text states ("every memo entry is paid for by exactly one budget unit"), so say it in both places and make them agree.

- [ ] **Step 4b: One stale phrase in `decode.rs`'s module doc**

Task 2's reviewer caught this: the module doc still describes a parallel implementation that no longer exists. In `crates/redextape-core/src/tm/decode.rs`, line 4, change

```rust
//! the result word, mirroring `asm.rs`'s `decode_word`. `expected` is used ONLY for its shape, so a
```

to

```rust
//! the result word, by calling `asm.rs`'s `decode_word`. `expected` is used ONLY for its shape, so a
```

"Mirroring" described two implementations kept in step. Since Task 2 there is one, and `decode_tape` calls it.

- [ ] **Step 5: Run the tests**

Run: `cargo test -p redextape-core --lib tm::asm::tests::a_flat_list_spends_exactly_three_per_cell_plus_one tm::asm::tests::every_memo_entry_is_paid_for_by_one_budget_unit`
Expected: both PASS.

Run: `cargo test --release -p redextape-core --test sharing_aware_decode && cargo nextest run -p redextape-core`
Expected: all pass. The m = 64,000 tails fixture now spends about 320,000 units (128,000 steps plus ~192,000 nodes), still far under 20,000,000.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs
git commit -m "Budget counts work, not nodes: a spine step costs one unit"
```

---

## Task 5: The mid-spine memo exit, and the case it is the only fix for

§4.2. `tails` is answered by Task 3 alone, because its aliases are whole lists hit at the top of the arm. Two distinct spines that CONVERGE on a shared tail are not: each walks the shared tail in full, once per spine, and the memo answers only after the walk.

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs` — both loops in the `Ty::List` arm, and one unit test

**Interfaces:**
- Consumes: `decode_word_ty_at` and `TyMemo` from Task 3, `spend`-per-step from Task 4.

- [ ] **Step 1: Write the failing test**

In `crates/redextape-core/src/tm/asm.rs`'s `#[cfg(test)] mod tests`:

```rust
/// CONVERGENT CHAINS — the case suffix memoization alone does not fix, and the reason PASS 1 needs a
/// memo exit of its own.
///
/// `k` distinct spines of length `p`, each ending by pointing into ONE shared tail of length `s`. The
/// answer is right with or without the exit; only the work differs, so this asserts on units spent.
/// Without the exit each spine re-walks the whole shared tail: `k * (p + s)`. With it, the tail is
/// walked once: `k * p + s`, plus nodes.
#[test]
fn convergent_chains_walk_the_shared_tail_once() {
    let (k, p, s) = (20_u64, 3_u64, 200_u64);
    // Cells 1..=s are the shared tail: cell i = (i, i+1), last tail nil.
    let mut heap: Vec<(u64, u64)> = (1..=s).map(|i| (i, if i == s { 0 } else { i + 1 })).collect();
    // Then k prefixes of length p, each running into pointer 1 (the shared tail's head).
    let mut starts = Vec::new();
    for c in 0..k {
        let base = s + c * p;
        starts.push(base + 1);
        for q in 0..p {
            let tail = if q == p - 1 { 1 } else { base + q + 2 };
            heap.push((7, tail)); // head value is arbitrary; `Ty::Nat` accepts any word
        }
    }
    // An outer list whose j-th head is the pointer to the j-th prefix.
    let outer_base = heap.len() as u64;
    for (j, st) in starts.iter().enumerate() {
        let j = j as u64;
        let tail = if j == k - 1 { 0 } else { outer_base + j + 2 };
        heap.push((*st, tail));
    }
    let ty = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
    let start = 10_000_000_usize;
    let mut budget = start;
    decode_word_ty(outer_base + 1, &heap, &ty, &mut budget).expect("convergent chains decode");
    let spent = start - budget;
    // Without the PASS 1 exit this is >= k * s = 4,000 steps of re-walking alone. With it, the shared
    // tail is walked once, so total work is linear in the heap: 3 * (s + k * p + k) + change.
    let cells = s + k * p + k;
    assert!(
        spent < 4 * cells as usize,
        "spent {spent} for {cells} cells — the shared tail is being re-walked"
    );
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --lib tm::asm::tests::convergent_chains_walk_the_shared_tail_once`
Expected: FAIL — `spent` is roughly `k * (p + s) + nodes` = well over `4 * cells`, with a message naming both numbers.

- [ ] **Step 3: Add the exit to both loops**

A pointer in the memo has been decoded, and a decode completes only on a chain that reached nil, so a memoized pointer is proven finite and acyclic — PASS 1 may stop there. PASS 2 must stop at the same place, because past it the chain is the memoized one and re-walking it is exactly the cost being removed.

In `decode_word_ty_at`'s `Ty::List` arm, change PASS 1's loop head:

```rust
            let mut w = word;
            let mut steps: usize = 0;
            loop {
                // Nil, or a pointer already proven finite and acyclic by a completed decode. The
                // second exit is what keeps CONVERGENT chains linear: without it each spine that runs
                // into a shared tail re-walks the whole tail before the memo can answer.
                if w == 0 || memo.contains_key(&(w, depth)) {
                    break;
                }
                if steps > heap.len() {
```

and turn PASS 2's loop into one that yields the base of the cons-up:

```rust
            let mut cells: Vec<(u64, Value)> = Vec::new();
            let mut w = word;
            let base = loop {
                if w == 0 {
                    spend(budget)?; // the Nil node
                    break Value::Nil;
                }
                if let Some(v) = memo.get(&(w, depth)) {
                    break v.clone(); // the rest of this spine is already built
                }
                spend(budget)?; // this spine step
                let Some(idx) = usize::try_from(w - 1).ok() else { return Err(DecodeFailure::Mismatch) };
                let Some(&(h, t)) = heap.get(idx) else { return Err(DecodeFailure::Mismatch) };
                cells.push((w, decode_word_ty_at(h, heap, elem, depth + 1, memo, budget)?));
                w = t;
            };

            let mut out = base;
            for (ptr, h) in cells.into_iter().rev() {
                spend(budget)?; // each Cons node
                out = Value::Cons(Rc::new(h), Rc::new(out));
                memo.insert((ptr, depth), out.clone());
            }
            Ok(out)
```

Note the `spend` for the `Nil` node moved INSIDE the loop's nil arm, because a spine that ends at a memo hit builds no `Nil` of its own.

- [ ] **Step 3b: The claim Task 3 had to qualify becomes true here**

Task 3's second review found that the "`budget` bounds SIZE" bullet in `decode_word_ty`'s doc claimed a property the decoder did not yet have, and Task 3's fix pass qualified it: the distinct-node bound holds *when a spine is first reached at its longest end*, and a spine reached from a shorter suffix is still re-walked. The counterexample is an outer list whose heads are pointers `1, 2, …, n` in INCREASING order — head `j` misses `(j, depth)` because only the shorter suffixes were recorded, so the walk is `Σ(2j+1) ≈ n²` on a `2n`-cell heap.

**This step is what removes the qualification.** With PASS 1 and PASS 2 both stopping at a memo hit, head `j` stops as soon as it reaches `(j-1, depth)`, so each cell is walked once across the whole decode. Update all three places Task 3's fix pass qualified — `decode_word_ty`'s size bullet, the inline comment at the top of the `Ty::List` arm, and the surviving CLI test's doc in `run.rs` — to state the property without the caveat, and delete the forward reference to this task.

**A fourth site carries the same claim and was never qualified**, because Task 3's fix pass was given three and this one is in an adjacent doc: `a_nested_type_over_a_shared_spine_decodes_instead_of_refusing`'s doc still says, unqualified, that `MAX_DECODE_NODES` measures DISTINCT nodes. That was true only of that test's own favourable spine order — its outer spine walks pointers `n → 1`, so every inner list is reached at its longest suffix first. After this step it is true in general. Bring it into line with the other three rather than leaving one doc a future reader could copy the overclaim from.

Add the increasing-order shape as a second case in Step 1's test, alongside the convergent-chain one. It is the shape that motivated the qualification, so it is the shape that should hold the fix down.

- [ ] **Step 3c: Three corrections Task 4's review left for this task, because this is when the doc reopens**

1. **A claim Task 4's own change falsified.** `decode_word_ty`'s doc says every mismatch arm "checks its condition and returns BEFORE touching `budget`", naming "both pointer-validity checks in `Ty::List`". Task 4 put the spine-step `spend` immediately before PASS 2's pointer check, so that is no longer true of PASS 2's occurrence. It is harmless — PASS 1 walks the identical chain over the same immutable heap first, so an invalid pointer is already a `Mismatch` before PASS 2 sees it — but the sentence is now false as written. Correct it, and say why the ordering is still safe rather than deleting the claim.

2. **PASS 2's pointer checks are unreachable, and that is deliberate.** They duplicate PASS 1's, over an unchanged heap. Do NOT delete them — they are what keeps the arm total if the two passes ever diverge. Say so at the site, so the next reader does not remove them as dead code. Note this stays true after this task's mid-spine exit: both passes stop at the same memo hit, so the two chains still coincide.

3. **Two weak spots Task 4's review measured.** `every_memo_entry_is_paid_for_by_one_budget_unit`'s secondary assertion `spent < 10 * (2 * m)` does not bite at `m = 6` — a fully unmemoized run of the same fixture spends about 82 against a threshold of 120. Its primary assertion (`memo.len() <= spent`) is real and stays. Either give the secondary a threshold that a no-memo run would actually exceed, or delete it and let this task's own convergent-chain and increasing-order tests carry that claim, which is what they are for. Separately, the slow-tier boundary test's doc still says it "allocates ~`MAX_DECODE_NODES` heap cells"; it allocates about `L`, which is now ~6,666,666 rather than 20,000,000 — an approximation that was off by 2x before Task 4 and is off by 3x now.

- [ ] **Step 4: Run the tests**

Run: `cargo test -p redextape-core --lib tm::asm::tests::`
Expected: all PASS, including `a_flat_list_spends_exactly_three_per_cell_plus_one` — a flat list has no memo hits, so its accounting is unchanged at `3L + 1`.

Run: `cargo test --release -p redextape-core --test sharing_aware_decode && cargo nextest run -p redextape-core`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs
git commit -m "PASS 1 stops at a memo hit, so convergent chains walk the shared tail once"
```

---

## Task 6: Cyclic heaps still refuse, including through a memo hit

> **CORRECTED 2026-08-28, after this task's review. Test 2 below is specified wrong, and the way it is wrong is the finding.** Its doc comment describes a race — a cycle entered before the memoized pointer is reached, so the step bound wins — and that race is **unsatisfiable**. A pointer enters the memo only after a decode proved its tail-chain reaches nil; "reaches nil" is a property of the raw pointer graph and is depth-independent; so a pointer inside a non-terminating cycle can never be memoized at any depth. **No fixture can produce the shape this test was written to cover.** Traced on the specified heap: the first element memoizes `(1,1)` and `(2,1)`, the cyclic element's walk only ever asks about `(3,1)` and `(4,1)`, and deleting PASS 1's memo exit entirely would not change the outcome — so as written the test duplicates test 1 and must not be cited as coverage for that exit. The fix is the doc comment, not the fixture: state the narrow property the test does establish (a populated memo does not spuriously short-circuit an unrelated cycle), and record the impossibility argument, which is the actual result. Test 3 is what genuinely exercises a memo hit, in both passes.

§10 and §11.6. Task 5 gave PASS 1 a second exit, and the shape that could plausibly slip through it is a cyclic spine that runs into a pointer the memo already holds.

**Files:**
- Modify: `crates/redextape-core/tests/sharing_aware_decode.rs`

**Interfaces:**
- Consumes: `decode_asm_ty_reason` and `DecodeFailure` from the crate's public API.

- [ ] **Step 1: Write the tests**

Add to `crates/redextape-core/tests/sharing_aware_decode.rs`, extending the import line to
`use redextape_core::tm::{AsmOutcome, DecodeFailure, decode_asm, decode_asm_ty, decode_asm_ty_reason};`:

```rust
/// A plain cycle is still a `Mismatch` — the file's heap is not acyclic, as a well-formed one must be.
#[test]
fn a_cyclic_heap_is_still_a_mismatch() {
    // cell 1 = (7, 2), cell 2 = (7, 1): the chain never reaches nil.
    let o = AsmOutcome { result: 1, heap: vec![(7, 2), (7, 1)] };
    assert_eq!(
        decode_asm_ty_reason(&o, &Ty::List(Box::new(Ty::Nat))),
        Err(DecodeFailure::Mismatch)
    );
}

/// THE SHAPE TASK 5's NEW EXIT COULD PLAUSIBLY WAVE THROUGH. An outer list whose first element is an
/// ordinary acyclic list — so the memo is populated — and whose second element is a CYCLE that runs
/// into that same populated pointer. PASS 1 stops early at the memo hit, and the question is whether
/// it stopped before or after noticing the cycle it walked through to get there.
///
/// It must still be a `Mismatch`: the cycle is entered before the memoized pointer is reached, so the
/// step bound fires first.
#[test]
fn a_cycle_reached_through_a_memo_hit_is_still_a_mismatch() {
    // Cells 1,2: an acyclic 2-list. 1 -> 2 -> nil.
    // Cells 3,4: a cycle, 3 -> 4 -> 3, which never reaches either nil or cell 1.
    // Outer cells 5,6: heads are pointers 1 then 3.
    let heap = vec![(7, 2), (7, 0), (7, 4), (7, 3), (1, 6), (3, 0)];
    let o = AsmOutcome { result: 5, heap };
    assert_eq!(
        decode_asm_ty_reason(&o, &Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))))),
        Err(DecodeFailure::Mismatch),
        "a cycle behind a populated memo must not decode"
    );
}

/// The mirror: a spine that legitimately runs into a memoized pointer, with no cycle anywhere, still
/// decodes — so the test above is not passing merely because everything refuses.
#[test]
fn a_spine_that_converges_on_a_memoized_pointer_still_decodes() {
    // Cells 1,2: 1 -> 2 -> nil. Cell 3: 3 -> 1, i.e. a longer spine sharing the tail.
    // Outer cells 4,5: heads are pointers 3 then 1.
    let heap = vec![(7, 2), (8, 0), (9, 1), (3, 5), (1, 0)];
    let o = AsmOutcome { result: 4, heap };
    let got = decode_asm_ty(&o, &Ty::List(Box::new(Ty::List(Box::new(Ty::Nat)))))
        .expect("convergent, acyclic, must decode");
    let inner_short = Value::Cons(Rc::new(Value::Nat(7)), Rc::new(Value::Cons(Rc::new(Value::Nat(8)), Rc::new(Value::Nil))));
    let inner_long = Value::Cons(Rc::new(Value::Nat(9)), Rc::new(inner_short.clone()));
    let want = Value::Cons(Rc::new(inner_long), Rc::new(Value::Cons(Rc::new(inner_short), Rc::new(Value::Nil))));
    assert_eq!(got, want);
}
```

- [ ] **Step 2: Run them**

Run: `cargo test -p redextape-core --test sharing_aware_decode`
Expected: all PASS. If `a_cycle_reached_through_a_memo_hit_is_still_a_mismatch` fails, Task 5's PASS 1 exit is checking the memo before the step bound in a way that lets a cycle through — fix the ordering in the loop, do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add crates/redextape-core/tests/sharing_aware_decode.rs
git commit -m "Cyclic heaps still refuse, including one reached through a memo hit"
```

---

## Task 7: The value-directed memo — `(pointer, expectation address)`

§5. Same shape as Task 3, different key, and no budget yet — the budget is Task 8, so that a failure in either is attributable.

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`
- Modify: `crates/redextape-core/tests/sharing_aware_decode.rs`

**Interfaces:**
- Produces: `pub(crate) fn decode_word(word: u64, heap: &[(u64, u64)], expected: &Value) -> Option<Value>` — signature UNCHANGED. A new private `decode_word_memo(word: u64, heap: &[(u64, u64)], expected: &Value, memo: &mut ValMemo) -> Option<Value>` carries the recursion.
- Produces: `type ValMemo = HashMap<(u64, *const Value), Value>;`, private to `asm.rs`.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/tests/sharing_aware_decode.rs`:

```rust
/// The value-directed twin of `tails_decodes_far_past_the_unmemoized_budget`. This one had no budget
/// to exceed, so before the memo it did not refuse — it allocated: at m = 4,000 the un-memoized walk
/// built 16,012,001 nodes and about 1 GiB. At m = 64,000 it is ~4.1e9 nodes, which does not complete.
#[test]
fn value_directed_tails_is_linear() {
    let m = 64_000;
    let o = tails_heap(m);
    let want = tails_value(m);
    assert_eq!(decode_asm(&o, &want).expect("value-directed decode of tails"), want);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `timeout 120 cargo test --release -p redextape-core --test sharing_aware_decode value_directed_tails_is_linear`
Expected: TIMEOUT or the OOM killer. Run it under
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0` so it cannot take the machine's swap.
This is the one test in the plan whose pre-implementation failure mode is resource exhaustion rather
than an assertion, which is itself the finding — see §3.

- [ ] **Step 3: Add the memo**

In `crates/redextape-core/src/tm/asm.rs`, above `decode_word`:

```rust
/// Memo for the value-directed decode, keyed `(heap pointer, address of the expectation node)`.
///
/// **Why address identity is sound, as the two ways it could not be.** Two structurally-equal
/// expectations at different addresses are different keys, so the memo MISSES — which costs time and
/// cannot change an answer. Two DIFFERENT expectations cannot share an address while both are alive,
/// and `expected` is borrowed for the whole decode, so nothing the memo has keyed is dropped and its
/// address reissued mid-walk. No pointer here is ever dereferenced; they are hashed and compared.
///
/// Keying on the expectation's STRUCTURE instead would be slower — hashing a `Value` is proportional
/// to the walk the memo exists to avoid — and no more correct, since sharing is precisely what
/// address identity detects and structure does not.
type ValMemo = HashMap<(u64, *const Value), Value>;
```

Replace `decode_word`'s body with a seeding wrapper, keeping its doc comment, its
`#[allow(clippy::similar_names)]` and its signature:

```rust
pub(crate) fn decode_word(word: u64, heap: &[(u64, u64)], expected: &Value) -> Option<Value> {
    let mut memo = ValMemo::new();
    decode_word_memo(word, heap, expected, &mut memo)
}
```

and add the recursion below it:

```rust
/// `decode_word`'s recursion, carrying the memo. Split out so the public path seeds one per decode.
///
/// `clippy::similar_names`: flags the local `head` against the `heap` parameter — see `decode_word`.
#[allow(clippy::similar_names)]
fn decode_word_memo(
    word: u64,
    heap: &[(u64, u64)],
    expected: &Value,
    memo: &mut ValMemo,
) -> Option<Value> {
    match expected {
        Value::Nat(_) => Some(Value::Nat(word)),
        Value::Bool(_) => match word {
            0 => Some(Value::Bool(false)),
            1 => Some(Value::Bool(true)),
            _ => None,
        },
        Value::Nil => {
            if word == 0 {
                Some(Value::Nil)
            } else {
                None
            }
        }
        Value::Cons(exp_h, exp_t) => {
            // Only the `Cons` arm memoizes: a leaf costs one construction, where an entry costs a
            // hash, a key and a clone. `from_ref` rather than `as *const _` per `clippy::pedantic`.
            let key = (word, std::ptr::from_ref::<Value>(expected));
            if let Some(v) = memo.get(&key) {
                return Some(v.clone());
            }
            if word == 0 {
                return None; // expected a cons, got nil
            }
            let idx = usize::try_from(word - 1).ok()?;
            let &(h, t) = heap.get(idx)?;
            let head = decode_word_memo(h, heap, exp_h, memo)?;
            let tail = decode_word_memo(t, heap, exp_t, memo)?;
            let out = Value::Cons(Rc::new(head), Rc::new(tail));
            memo.insert(key, out.clone());
            Some(out)
        }
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) | Value::Box(_) => None,
    }
}
```

The recursive calls pass `exp_h`/`exp_t`, which are `&Rc<Value>` coerced to `&Value` — so
`std::ptr::from_ref(expected)` inside the callee is the `Rc`'s payload address, which is exactly the
identity that sharing preserves.

- [ ] **Step 4: Run the tests**

Run: `cargo test --release -p redextape-core --test sharing_aware_decode`
Expected: all PASS, `value_directed_tails_is_linear` in well under a second.

Run: `cargo nextest run -p redextape-core && cargo nextest run -p redextape-native`
Expected: all pass. `redextape-native` matters here — it is the heaviest consumer of `decode_asm`.

- [ ] **Step 5: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/tests/sharing_aware_decode.rs
git commit -m "Value-directed decode memoizes on (pointer, expectation address)"
```

---

## Task 8: The value-directed budget, and `_reason` siblings so a refusal says why

§6.2 and §7. The budget makes the value-directed path bounded like its sibling; the `_reason` siblings are what stop that bound from arriving as a panic reading "decode failed".

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs` — budget through `decode_word_memo`, `decode_asm_reason`
- Modify: `crates/redextape-core/src/tm/decode.rs` — `decode_tape_reason`
- Modify: `crates/redextape-core/src/tm.rs` — two re-exports
- Modify: `crates/redextape-core/tests/tm_oracle.rs` — 2 call sites
- Modify: `crates/redextape-native/tests/llvm_oracle.rs` — 4 call sites

**Interfaces:**
- Consumes: `decode_word_memo` and `ValMemo` from Task 7, `spend` and `DecodeFailure` from the module.
- Produces: `pub fn decode_asm_reason(outcome: &AsmOutcome, expected: &Value) -> Result<Value, DecodeFailure>` and `pub fn decode_tape_reason(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Result<Value, DecodeFailure>`.
- Produces: `pub(crate) fn decode_word(word: u64, heap: &[(u64, u64)], expected: &Value, budget: &mut usize) -> Result<Value, DecodeFailure>` — signature CHANGED. Its only two callers are `decode_asm_reason` and `tm::decode::decode_tape_reason`, both written in this task.

- [ ] **Step 1: Write the failing test**

Add to `crates/redextape-core/tests/sharing_aware_decode.rs`:

```rust
/// The value-directed decoder is bounded now, and says so. A 3-cell heap under a budget it cannot
/// meet is not constructible from outside, so this asserts the two things that ARE observable: an
/// ordinary decode reports `Ok`, and a representation mismatch reports `Mismatch` rather than a bare
/// `None` — i.e. the reason channel exists and carries the right arm.
#[test]
fn value_directed_reports_a_reason() {
    let o = AsmOutcome { result: 1, heap: vec![(5, 0)] };
    let expected = Value::Cons(Rc::new(Value::Nat(0)), Rc::new(Value::Nil));
    assert!(decode_asm_reason(&o, &expected).is_ok());

    // A `Bool` expectation against the word 5: not 0 and not 1, so the DATA is wrong, not the budget.
    let b = AsmOutcome { result: 5, heap: vec![] };
    assert_eq!(decode_asm_reason(&b, &Value::Bool(false)), Err(DecodeFailure::Mismatch));
}
```

Extend the import line to include `decode_asm_reason`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test -p redextape-core --test sharing_aware_decode value_directed_reports_a_reason`
Expected: FAIL to compile — `no function 'decode_asm_reason' in 'redextape_core::tm'`.

- [ ] **Step 3: Thread the budget**

In `crates/redextape-core/src/tm/asm.rs`, change `decode_word` and `decode_word_memo` to carry a budget and return `Result`:

```rust
pub(crate) fn decode_word(
    word: u64,
    heap: &[(u64, u64)],
    expected: &Value,
    budget: &mut usize,
) -> Result<Value, DecodeFailure> {
    let mut memo = ValMemo::new();
    decode_word_memo(word, heap, expected, &mut memo, budget)
}
```

and in `decode_word_memo`, add the `budget: &mut usize` parameter, change the return type to
`Result<Value, DecodeFailure>`, and change each arm. The accounting matches the type-directed side's
`3L + 1` exactly: one unit per constructed node, one per `Cons` descent.

```rust
    match expected {
        Value::Nat(_) => {
            spend(budget)?;
            Ok(Value::Nat(word))
        }
        Value::Bool(_) => {
            let v = match word {
                0 => Value::Bool(false),
                1 => Value::Bool(true),
                _ => return Err(DecodeFailure::Mismatch),
            };
            spend(budget)?;
            Ok(v)
        }
        Value::Nil => {
            if word == 0 {
                spend(budget)?;
                Ok(Value::Nil)
            } else {
                Err(DecodeFailure::Mismatch)
            }
        }
        Value::Cons(exp_h, exp_t) => {
            let key = (word, std::ptr::from_ref::<Value>(expected));
            if let Some(v) = memo.get(&key) {
                return Ok(v.clone());
            }
            if word == 0 {
                return Err(DecodeFailure::Mismatch); // expected a cons, got nil
            }
            spend(budget)?; // this descent — the value-directed twin of a spine step
            let Some(idx) = usize::try_from(word - 1).ok() else { return Err(DecodeFailure::Mismatch) };
            let Some(&(h, t)) = heap.get(idx) else { return Err(DecodeFailure::Mismatch) };
            let head = decode_word_memo(h, heap, exp_h, memo, budget)?;
            let tail = decode_word_memo(t, heap, exp_t, memo, budget)?;
            spend(budget)?; // the Cons node
            let out = Value::Cons(Rc::new(head), Rc::new(tail));
            memo.insert(key, out.clone());
            Ok(out)
        }
        Value::Unit | Value::Closure { .. } | Value::Builtin(_) | Value::Box(_) => {
            Err(DecodeFailure::Mismatch)
        }
    }
```

- [ ] **Step 4: Add the two `_reason` entry points**

In `crates/redextape-core/src/tm/asm.rs`, replace `decode_asm`'s body and add its sibling:

```rust
#[must_use]
pub fn decode_asm(outcome: &AsmOutcome, expected: &Value) -> Option<Value> {
    decode_asm_reason(outcome, expected).ok()
}

/// `decode_asm`, keeping WHY a failed decode failed — the value-directed twin of
/// `decode_asm_ty_reason`, and for the same reason: the two causes have opposite fault attributions.
///
/// # Errors
///
/// `DecodeFailure::Mismatch` if `outcome`'s data does not have the shape `expected` describes.
/// `DecodeFailure::BudgetExhausted` if `MAX_DECODE_NODES` ran out on an otherwise-truthful decode.
pub fn decode_asm_reason(outcome: &AsmOutcome, expected: &Value) -> Result<Value, DecodeFailure> {
    let mut budget = MAX_DECODE_NODES;
    decode_word(outcome.result, &outcome.heap, expected, &mut budget)
}
```

Keep whatever doc comment `decode_asm` already carries, appending one line: "`decode_asm_reason`'s
`.ok()`, for the callers that only need to know THAT it failed."

In `crates/redextape-core/src/tm/decode.rs`, the same for `decode_tape`:

```rust
pub fn decode_tape(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Option<Value> {
    decode_tape_reason(tapes, expected, enc).ok()
}

/// `decode_tape`, keeping WHY a failed decode failed. `read_result` failing — a missing REG/HEAP tape,
/// or a REG field this `enc` cannot parse as a Nat — is `DecodeFailure::Mismatch`, exactly as in
/// `decode_tape_ty_reason`: a claim about the DATA, never about the budget, which is not allocated yet.
///
/// # Errors
///
/// See `DecodeFailure`'s doc for the two causes.
pub fn decode_tape_reason(
    tapes: &[Tape],
    expected: &Value,
    enc: &dyn Encoding,
) -> Result<Value, DecodeFailure> {
    let Some((word, heap)) = read_result(tapes, enc) else { return Err(DecodeFailure::Mismatch) };
    let mut budget = MAX_DECODE_NODES;
    crate::tm::asm::decode_word(word, &heap, expected, &mut budget)
}
```

`decode_tape` keeps `#[must_use]` if it has one; add it if not.

- [ ] **Step 5: Re-export both**

In `crates/redextape-core/src/tm.rs`, add `decode_asm_reason` to the `pub use asm::{...}` list (alphabetical: after `decode_asm`) and `decode_tape_reason` to the `pub use decode::{...}` list (after `decode_tape`).

- [ ] **Step 6: Move the six panicking oracle sites**

`crates/redextape-core/tests/tm_oracle.rs`, adding `decode_asm_reason, decode_tape_reason` to its import list:

```rust
// line ~61
AsmRun::Ran(o) => decode_asm_reason(&o, &reference).unwrap_or_else(|e| panic!("asm decode: {e:?}")),
// line ~68
decode_tape_reason(&tapes, &reference, &*fitted).unwrap_or_else(|e| panic!("tm decode: {e:?}"))
```

`crates/redextape-native/tests/llvm_oracle.rs`, adding `decode_asm_reason` to its import list:

```rust
// line ~54
NativeRun::Ran(o) => decode_asm_reason(o, expected).unwrap_or_else(|e| panic!("{label}: decode failed: {e:?}")),
// line ~173
let cl_value = decode_asm_reason(&cl_outcome, &rv).unwrap_or_else(|e| panic!("decode cranelift: {e:?}"));
// line ~178
let cl_at = decode_asm_reason(&o, &rv).unwrap_or_else(|e| panic!("decode cranelift: {e:?}"));
// line ~185
let llvm_value = decode_asm_reason(&o, &rv).unwrap_or_else(|e| panic!("decode llvm: {e:?}"));
```

Change nothing else. The `assert_eq!(decode_asm(..), Some(v))` sites across `asm_oracle.rs`,
`three_way_oracle.rs` and `native_oracle.rs` stay as they are — a refusal there already prints `None`
against `Some(..)`, which is distinguishable from a wrong value, and churning them risks a test that
passes for a new reason (§7).

- [ ] **Step 7: Run everything**

Run: `cargo clippy --workspace --all-targets -- -D warnings`
Expected: clean. This is the step that catches a missing `#[must_use]` or `# Errors`.

Run: `cargo nextest run --workspace`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/src/tm/decode.rs \
        crates/redextape-core/src/tm.rs crates/redextape-core/tests/tm_oracle.rs \
        crates/redextape-core/tests/sharing_aware_decode.rs \
        crates/redextape-native/tests/llvm_oracle.rs
git commit -m "The value-directed decode is bounded, and a refusal names its reason"
```

---

## Task 9: Run both sabotages, and record what they printed

§11.7. A sabotage nobody executed is a paragraph, not a check. Neither change is committed — each is made, run, observed, and reverted.

**Files:** none committed. Working-tree edits only, plus the notes that feed Task 10.

- [ ] **Step 1: Sabotage §4.1 — delete the suffix memoization**

In `decode_word_ty_at`'s cons-up loop, comment out the `memo.insert((ptr, depth), out.clone());` line.

Run: `cargo test --release -p redextape-core --test sharing_aware_decode tails_decodes_far_past_the_unmemoized_budget`
Expected: FAIL, on `.expect("type-directed decode of tails")` — the decode returns `None` again.

**Record the exact failure text.** If it PASSES, the tails fixture is being answered by something
other than suffix memoization and the test does not bite on the mechanism it names. Do not adjust the
test until it passes; find out what is answering it.

Revert: `git checkout crates/redextape-core/src/tm/asm.rs`

- [ ] **Step 2: Sabotage §4.2 — delete the PASS 1 memo exit**

In PASS 1's loop head, change `if w == 0 || memo.contains_key(&(w, depth))` back to `if w == 0`.

Run: `cargo test -p redextape-core --lib tm::asm::tests::convergent_chains_walk_the_shared_tail_once`
Expected: FAIL, with the message naming units spent against cells.

**Record the exact numbers it printed.** Both figures go in the roadmap entry.

Revert: `git checkout crates/redextape-core/src/tm/asm.rs`

- [ ] **Step 3: Confirm the tree is clean**

Run: `git status --porcelain`
Expected: empty. Both sabotages reverted, nothing staged.

- [ ] **Step 4: Re-measure the headline figures for the roadmap entry**

Run:

```bash
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 -- \
  cargo test --release -p redextape-core --test sharing_aware_decode -- --nocapture --test-threads=1
```

Record the wall clock. Then run the full gate:

```bash
cargo nextest run --workspace
scripts/check-all.sh --no-llvm --no-browser
pre-commit run --all-files
```

Quote `check-all.sh`'s own final line rather than calling the run green — it ends with a PARTIAL
notice naming the skipped tiers.

---

## Task 10: Roadmap entry, then the PR

Substantive PRs get a roadmap entry BEFORE the PR is opened, and every VERIFICATION figure names the command that produced it.

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`

- [ ] **Step 1: Strike the filed item**

Find the entry under the TM-header slice's "Still open after slice 2", item 1, beginning
"**`decode_word_ty` is not sharing-aware.**". Mark it `**CLOSED (2026-08-28)**` in place, keeping the
original text struck rather than deleted, per this file's convention — and note the one thing it got
wrong: it extended the finding to `decode_asm_ty`, which is the same function through a second entry
point, and missed the value-directed decoder, which is a second decoder with the same defect and no
budget.

- [ ] **Step 2: Append the closing entry**

At the end of the file, a `####` entry in the house style. It must carry:

- The measurement table from §3 with its command.
- The after figures from Task 9 Step 4.
- Both sabotage results from Task 9, with the text they printed.
- A VERIFICATION block where every figure names the command that produced it, re-derived against the
  head being pushed rather than the head the entry was drafted at.
- The CI run number AND the API run id, with the SHA read from the PR's own `head.sha`.

- [ ] **Step 3: Open the PR**

Push the branch and open the PR against `main`. Body is one long line per paragraph — Forgejo renders
with GFM `breaks: true`, so a hard-wrapped paragraph shows as forced line breaks.

- [ ] **Step 4: Fill in the CI figures**

Once CI is green, read the run number from the status `target_url` and the run id from the API — they
are different values for the same run and neither can be guessed from the other. Amend the entry, and
re-read the paragraph above any placeholder just filled.

---

## Task 11: The printer inherits the hazard the decode budget used to mask

**Added 2026-08-28, after Task 3's review. Runs AFTER Task 8 and BEFORE Task 9**, so the sabotage pass and the roadmap entry both see the finished tree.

**Why this exists, and why the spec was wrong.** §9 of the design said the decoded value becoming a DAG "makes decoding cheap without making printing cheap — not a regression; printing was already the logical size." The first clause is right and the conclusion is wrong. `run.rs` prints a successful decode with `format_value`, which walks the value as a TREE. Before this branch, a `tails`-shaped `.tm` at m = 64,000 was refused at decode, so the printer never saw it. After Task 3 the decode succeeds in about 192,000 distinct nodes and hands the printer a 4.1 × 10⁹-node walk. `.tm` is untrusted input by this branch's own threat model, and the roadmap's cardinal rule is that no input may crash any process. **The decode budget was doing double duty, and this branch removed half of it without replacing it.**

**Files:**
- Modify: `crates/redextape-core/src/value.rs` — `MAX_PRINT_NODES`, a shared walk, `format_value_capped`
- Modify: `crates/redextape-cli/src/run.rs` — both print sites, through Task 3's extracted seams
- Modify: `crates/redextape-core/src/tm.rs` or the crate root re-exports, if `value` items are re-exported there

**Interfaces:**
- Consumes: the two decode-result seam functions Task 3's fix extracted in `run.rs`.
- Produces: `pub const MAX_PRINT_NODES: usize` and `pub fn format_value_capped(v: &Value, budget: usize) -> Option<String>` in `redextape_core::value`.

**`format_value` keeps its exact behaviour, and that is a hard requirement, not a preference.** The AOT oracle compares a compiled binary's stdout against `format_value(expected)`, so a cap there would change what the oracle asserts. The capped form is a sibling, and the two share one walk rather than carrying two copies of it.

- [ ] **Step 1: Write the failing test**

In `crates/redextape-core/src/value.rs`'s `#[cfg(test)] mod tests`:

```rust
/// A value can be SMALL in memory and astronomically large printed, because `Value::Cons` holds
/// `Rc`s and a decoded value is now a DAG. 64 levels of self-sharing is 65 allocations and 2^64
/// logical nodes — the shape a `.tm` file can hand the CLI after the decoder learned to memoize.
///
/// `format_value` walks it as a tree and would not return in any useful time; `format_value_capped`
/// must refuse. The test asserts the refusal, and never calls the uncapped form on this value.
#[test]
fn a_shared_dag_is_small_in_memory_and_refused_by_the_capped_printer() {
    let mut v = Value::Cons(Rc::new(Value::Nat(1)), Rc::new(Value::Nil));
    for _ in 0..64 {
        let shared = Rc::new(v);
        v = Value::Cons(Rc::clone(&shared), Rc::new(Value::Cons(shared, Rc::new(Value::Nil))));
    }
    assert_eq!(format_value_capped(&v, MAX_PRINT_NODES), None);
}

/// The cap does not refuse anything a correct program can produce. The derivation in
/// `MAX_PRINT_NODES`'s doc says a flat `List<Nat>` at the heap cap costs `2L + 1` logical nodes;
/// this pins the equation at a small `L` so a constant offset cannot pass.
#[test]
fn the_capped_printer_agrees_with_the_uncapped_one_below_the_cap() {
    for l in [0_u64, 1, 3, 50] {
        let ns: Vec<u64> = (1..=l).collect();
        let v = Value::list_of_nats(&ns);
        assert_eq!(format_value_capped(&v, MAX_PRINT_NODES).as_deref(), Some(format_value(&v).as_str()));
        // `2L + 1` logical nodes: L `Nat`s, L `Cons`es, one `Nil`. One unit short must refuse.
        let exact = 2 * l as usize + 1;
        assert!(format_value_capped(&v, exact).is_some(), "L={l} must fit in exactly 2L+1");
        assert_eq!(format_value_capped(&v, exact - 1), None, "L={l} must refuse at 2L");
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib value::tests::a_shared_dag_is_small_in_memory_and_refused_by_the_capped_printer`
Expected: FAIL to compile — `cannot find function 'format_value_capped'`.

Do NOT run the first test's fixture through the uncapped `format_value` to "see what happens". It does not terminate.

- [ ] **Step 3: Implement**

In `crates/redextape-core/src/value.rs`:

```rust
/// The most LOGICAL value nodes `format_value_capped` will walk.
///
/// A totality guard on untrusted input, and it exists because the decode budget stopped covering
/// this case. `MAX_DECODE_NODES` bounds how many DISTINCT nodes a decode builds; once the decoder
/// memoizes, distinct and logical diverge without limit — a 65-allocation value can have 2^64
/// logical nodes. Printing is a tree walk, so printing pays the logical size. Until the decoder
/// memoized, the decode budget refused such a value before the printer could see it; it no longer
/// does, and this is the replacement for the half of that guard that was lost.
///
/// DERIVED, not picked: a run under `tm::DEFAULT_CAPS` may build `5_000_000` heap cells, and a flat
/// `List<Nat>` of that length prints as `L` `Nat`s + `L` `Cons`es + one `Nil` = `10_000_001` logical
/// nodes. This sits at `20_000_000`, just under 2x that, so nothing a correct program can produce is
/// refused. It is numerically equal to `MAX_DECODE_NODES` because the same run cap drives both
/// derivations, NOT because either is defined in terms of the other — they are independently
/// changeable and bound different quantities.
pub const MAX_PRINT_NODES: usize = 20_000_000;

/// `format_value`, refusing rather than walking forever when the value's LOGICAL size exceeds
/// `budget`. Returns `None` on refusal — the caller reports it as the tool's limit, never as the
/// file's fault, exactly as `DecodeFailure::BudgetExhausted` is reported.
///
/// Use this on any value that came from a FILE. `format_value` remains correct for values the tree
/// produced itself, and the AOT oracle depends on its exact output.
#[must_use]
pub fn format_value_capped(v: &Value, budget: usize) -> Option<String> {
    let mut out = String::new();
    let mut left = budget;
    fmt_into(v, &mut out, &mut left).then_some(out)
}
```

Rewrite `format_value`'s body to share the walk, keeping its signature, its `#[must_use]` and its doc comment exactly as they are:

```rust
pub fn format_value(v: &Value) -> String {
    let mut out = String::new();
    let mut left = usize::MAX;
    // `usize::MAX` cannot be reached by a walk that terminates at all, so this is the uncapped
    // walk and the bool is always true. Ignored rather than asserted: an `assert!` here would be
    // a panic in a library path, and `debug_assert!` would drop the call in release.
    let _ = fmt_into(v, &mut out, &mut left);
    out
}
```

and add the shared walk, which is the old `format_value` body with a budget threaded through:

```rust
/// The one value-printing walk, shared by `format_value` and `format_value_capped` so the two
/// cannot drift. Returns `false` once `budget` would go negative, leaving `out` truncated —
/// callers discard it in that case.
fn fmt_into(v: &Value, out: &mut String, budget: &mut usize) -> bool {
    let Some(next) = budget.checked_sub(1) else { return false };
    *budget = next;
    match v {
        Value::Nat(n) => out.push_str(&n.to_string()),
        Value::Bool(b) => out.push_str(&b.to_string()),
        Value::Unit => out.push_str("()"),
        Value::Nil => out.push_str("[]"),
        Value::Cons(_, _) => {
            out.push('[');
            let mut cur: &Value = v;
            let mut first = true;
            while let Value::Cons(h, t) = cur {
                if !first {
                    out.push_str(", ");
                }
                first = false;
                if !fmt_into(h, out, budget) {
                    return false;
                }
                cur = t.as_ref();
            }
            out.push(']');
        }
        Value::Closure { .. } | Value::Builtin(_) | Value::Box(_) => out.push_str("<non-value>"),
    }
    true
}
```

**One subtlety to get right rather than discover:** the `Cons` arm's `while` loop walks the spine iteratively — that is deliberate and pre-existing, because a list's spine length is bounded only by the step budget and recursing per cell overflows the stack. Each spine step must spend a unit too, or the cap does not bound a long flat list. The `checked_sub` at the top of `fmt_into` charges the head; add a second charge inside the loop for the spine step, or the `2L + 1` equation in Step 1's test will not hold. Derive which, run the test, and make the doc match what you implemented.

- [ ] **Step 4: Route the CLI's two print sites through the cap**

In `crates/redextape-cli/src/run.rs`, both seam functions Task 3's fix extracted print a successful decode with `format_value`. Change each to `format_value_capped(&v, redextape_core::value::MAX_PRINT_NODES)`, and on `None` write a tool-limit message and return `Outcome::ToolFailed` — the same exit path `DecodeFailure::BudgetExhausted` already uses, with wording that says the value decoded but is too large to print, and that this is the tool's limit rather than the file's.

Add a test at each seam, alongside the ones Task 3's fix added, passing an `Ok(v)` whose `v` is a small shared DAG, and asserting the message and `Outcome::ToolFailed`.

- [ ] **Step 5: Run**

Run: `cargo nextest run --workspace` and `cargo clippy --workspace --all-targets -- -D warnings`
Expected: all pass, clippy clean. The oracle suites matter here — `format_value`'s output must be unchanged, and they are what would notice.

- [ ] **Step 6: Commit**

```bash
git add crates/redextape-core/src/value.rs crates/redextape-cli/src/run.rs
git commit -m "The printer gets the bound the decode budget used to give it for free"
```

---

## Task 12: The spine charge moves to PASS 1, which is the pass that can be re-walked

**Added 2026-08-28, after Task 9's sabotage pass. Runs BEFORE Task 9 is re-run and before Task 10.**

**Why this exists: a sabotage that did not fire, and a measurement that explains why.** Task 9 removed PASS 1's mid-spine memo exit and the entire `redextape-core` suite stayed green — 692 tests, nothing red. `convergent_chains_walk_the_shared_tail_once` asserts on budget units, and **PASS 1 spends no budget**, so it was measuring PASS 2's exit the whole time. Task 5's central mechanism had no test that bites.

Measured on `k` one-cell prefixes converging on one shared tail, with the decode SUCCEEDING in every row:

| cells | with the exit | without | ratio |
|---|---|---|---|
| 15,000 | 3 ms | 46 ms | 15x |
| 30,000 | 8 ms | 174 ms | 22x |
| 60,000 | 19 ms | 673 ms | 35x |
| 120,000 | 35 ms | 2,659 ms | 76x |

Linear against quadratic, and `decoded=true` throughout — **the budget never fires**. At the 5,000,000-cell heap cap that shape is about `6.25e12` pointer steps, hours of work, reachable from a `.tm` file with no guard reacting. PASS 1's exit is not an optimization; it is the only thing bounding that pass, and the budget cannot see it.

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs`

**Interfaces:** no signature changes anywhere. This moves one `spend` call and rewrites three doc passages.

### The change

Delete the spine-step `spend(budget)?` from PASS 2's loop. Add one to PASS 1's loop, **after every mismatch check and after the cycle bound**, so the loop body reads: break on nil or memo hit; return `Mismatch` if `steps > heap.len()`; resolve and validate the pointer, returning `Mismatch` on either failure; **then** `spend`; then advance.

**The flat-list accounting is unchanged, and that is the point of putting it here rather than adding a second charge.** Both passes walk the same chain, so charging PASS 1 instead of PASS 2 leaves a flat `List<Nat>` at `L` steps + `L` `Nat` leaves + one `Nil` + `L` `Cons` = `3L + 1`. Task 4's `a_flat_list_spends_exactly_three_per_cell_plus_one` must still pass unchanged, and `MAX_DECODE_NODES`'s derivation needs no new arithmetic.

### Two properties this improves, and one it costs

- **It restores something Task 4 broke.** Task 4's review found that PASS 2's spine spend ran immediately before PASS 2's pointer-validity check, falsifying the doc's claim that every mismatch arm returns before touching `budget`. Removing that spend removes the exception; placing PASS 1's spend after its own checks means the claim is true again, in both passes. Update the `DecodeFailure` doc accordingly and delete the qualification Task 5 Step 3c added.
- **It makes the convergent-chains test bite.** Without the exit, PASS 1 now charges `k * s` and the decode refuses; with it, the charge is linear. The test's existing doc already describes PASS 1's re-walking — after this change the doc and the assertion finally describe the same thing. Verify by re-running Task 9's second sabotage; it must fail now.
- **It costs a caveat on the cycle guarantee, and this must be written down rather than glossed.** PASS 1's walk was free, so a cyclic spine always won a `Mismatch` against its own cost. Now its own walk charges up to `heap.len()`, so it wins only while that much budget remains; a cycle behind an expensive sibling can report `BudgetExhausted` instead. That is the same class as the caveat already documented for an expensive sibling — it is wider now, and the doc must say so in those terms.

### Steps

- [ ] **Step 1:** Re-run Task 9's sabotage as a RED check — remove PASS 1's memo exit, run `convergent_chains_walk_the_shared_tail_once`, and confirm it still PASSES. That is the defect, recorded before it is fixed. Restore the exit.
- [ ] **Step 2:** Move the `spend` as described.
- [ ] **Step 3:** Re-run the sabotage. The test must now FAIL. Record the failure text. Restore the exit.
- [ ] **Step 4:** Confirm `a_flat_list_spends_exactly_three_per_cell_plus_one` still passes at `3L + 1`, unchanged.
- [ ] **Step 5:** Update the three doc passages: `MAX_DECODE_NODES`'s "WHY STEPS COST" paragraph (the reason is now PASS 1's re-walkable chain, not PASS 2's vector), `DecodeFailure`'s mismatch-arm claim, and the cycle caveat.
- [ ] **Step 6:** `cargo nextest run --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, commit.

---

## Self-Review

**Spec coverage.** §4 → Task 3. §4.1 → Task 3. §4.2 → Task 5. §5 → Task 7. §6 → Task 4. §6.1 → Task 4 Step 4. §6.2 → Task 8. §7 → Task 8. §8 → Tasks 1 and 2. §9 → no task: it is a consequence, asserted by Task 3's equivalence test, which compares against an independently built `Value` and so would fail if sharing changed the logical value. §10 → Task 6. §11.1 → Task 4. §11.2 → Task 5. §11.3 → Task 4. §11.4 → Task 3. §11.5 → Task 3. §11.6 → Task 6. §11.7 → Task 9. §11.8 → Task 1. §11.9 → Task 8 Step 7. §12 risks → Task 8's clippy gate and Task 9's full-gate run. §13/§14 → carried into the roadmap entry, Task 10.

**Type consistency.** `TyMemo = HashMap<(u64, usize), Value>` and `ValMemo = HashMap<(u64, *const Value), Value>` are each defined once and used with the same name throughout. `decode_word_ty_at` takes `(word, heap, ty, depth, memo, budget)` in that order at its definition (Task 3) and at both recursive call sites (Tasks 3 and 5). `decode_word_memo` takes `(word, heap, expected, memo)` in Task 7 and gains `budget` as a sixth-position parameter in Task 8, with both recursive calls updated in the same step. `decode_word`'s signature changes exactly once, in Task 8, and its only two callers are written in that same task.

**One thing to watch during execution.** Task 4 changes the budget's meaning while Task 3's memo is already in place, and the two interact: the m = 64,000 fixture spends roughly 128,000 steps plus 192,000 nodes after Task 4, against 20,000,000. If Task 4 is applied WITHOUT Task 3, the same fixture would spend the un-memoized quadratic step count and refuse at a smaller m than it does today. The order in this plan is deliberate and must not be swapped.
