//! Sharing-aware decode: an aliased sub-list is built once, not once per pointer into it.
//!
//! The fixture throughout is `tails([1..m])`, whose inner lists all alias suffixes of ONE spine —
//! `2m` heap cells carrying `m^2 + m + 1` logical nodes. That is not a crafted heap; it is what an
//! ordinary `tails` returns, because `Instr::Tail` is a pointer read rather than an allocation.
//!
//! Design: docs/superpowers/specs/2026-08-28-sharing-aware-decode-design.md

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::pedantic)]

use std::rc::Rc;

use redextape_core::tm::{
    AsmOutcome, DecodeFailure, decode_asm, decode_asm_reason, decode_asm_ty, decode_asm_ty_reason,
};
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
    assert!(
        got == tails_value(m),
        "decode_asm_ty(tails({m})) did not match the independently built value; mismatch omitted \
         because at m={m} the two structures would Debug-format to on the order of m^2 (~4.1e9) nodes"
    );
}

/// The value-directed twin of `tails_decodes_far_past_the_unmemoized_budget`. This one had no budget
/// to exceed, so before the memo it did not refuse — it allocated: at m = 4,000 the un-memoized walk
/// built 16,012,001 nodes and about 1 GiB. At m = 64,000 it is ~4.1e9 nodes, which does not complete.
///
/// Slow tier, not for a reason `check-slow.sh`'s other entries share: `decode_word_memo` recurses
/// once per list element (unlike the type-directed decoder, whose recursion follows TYPE nesting, not
/// value length), so its stack depth is the list length — measured at `m + 2` for m = 10, 100, 1,000,
/// 5,000 and 20,000. NOT `2m`: `decode_word_memo` computes `head` fully, and lets it unwind, before it
/// computes `tail`, so the deepest point of the whole decode occurs ONCE — while decoding the single
/// longest sub-list, nested one frame inside the outer call — and that peak is never added to the
/// later traversal of the outer spine, which is shallow because every element after the first is a
/// memo hit. The two `m`-deep contributions a naive sum would add together never coexist on the stack.
/// So m = 64,000 needs a call stack ~64,002 frames deep. A release build's frames fit the workspace's
/// 32 MiB `RUST_MIN_STACK` with room to spare; a debug build's do not — confirmed by running this test
/// directly (bypassing `#[ignore]`) under `cargo test` (no `--release`), which aborts with "thread ...
/// has overflowed its stack" at the default 32 MiB, and passes once `RUST_MIN_STACK` is raised to
/// 64 MiB. This is a property of the recursion's SHAPE, not a bug this task's memo introduced or is
/// scoped to fix, and `m + 2` agrees with the plan's standing constraint that this decoder's stack
/// depth is the list length (design plan, "Out of scope, and must not get worse") — the `2m` framing
/// this comment used to carry contradicted that constraint.
#[test]
#[ignore = "slow tier: needs a release build's smaller stack frames — a debug build overflows the \
            workspace's 32 MiB test stack at this recursion depth; run via scripts/check-slow.sh"]
fn value_directed_tails_is_linear() {
    let m = 64_000;
    let o = tails_heap(m);
    let want = tails_value(m);
    let got = decode_asm(&o, &want).expect("value-directed decode of tails");
    assert!(
        got == want,
        "decode_asm(tails({m})) did not match the independently built value; mismatch omitted because \
         at m={m} the two structures would Debug-format to on the order of m^2 (~4.1e9) nodes"
    );
}

/// Equivalence at the sizes the un-memoized decoder could still finish. The expected value is built
/// independently by `tails_value` rather than captured from the old decoder, so this keeps biting
/// after the old code path is gone.
#[test]
fn memoized_decode_equals_the_independently_built_value() {
    for m in [1_000_u64, 2_000, 4_000] {
        let o = tails_heap(m);
        let want = tails_value(m);
        let got_ty = decode_asm_ty(&o, &list_of_lists()).unwrap();
        assert!(
            got_ty == want,
            "type-directed decode of tails({m}) did not match tails_value({m}); mismatch omitted, up \
             to ~m^2 nodes"
        );
        let got_val = decode_asm(&o, &want).unwrap();
        assert!(
            got_val == want,
            "value-directed decode of tails({m}) did not match tails_value({m}); mismatch omitted, up \
             to ~m^2 nodes"
        );
    }
}

/// A plain cycle is still a `Mismatch` — the file's heap is not acyclic, as a well-formed one must be.
#[test]
fn a_cyclic_heap_is_still_a_mismatch() {
    // cell 1 = (7, 2), cell 2 = (7, 1): the chain never reaches nil.
    let o = AsmOutcome { result: 1, heap: vec![(7, 2), (7, 1)] };
    assert_eq!(
        decode_asm_ty_reason(&o, &Ty::List(Box::new(Ty::Nat))),
        Err(DecodeFailure::Mismatch),
        "a cycle that never reaches nil must not decode"
    );
}

/// A cycle that never reaches a populated memo entry is still caught by the ordinary step bound:
/// decoding the outer list's first element populates `memo[(1,1)]` and `memo[(2,1)]`, and the second
/// element then cycles (`3 -> 4 -> 3 -> ...`) without ever visiting pointer 1 or 2. This shows a
/// populated memo does not spuriously short-circuit an unrelated cycle elsewhere in the heap — which
/// is narrower than this test was once named to suggest, when it claimed the cycle ran INTO the
/// memoized pointer and raced the memo-hit check against the step bound.
///
/// That race cannot happen with any fixture: a pointer enters the memo only after a decode proves its
/// tail-chain reaches nil, a property of the raw pointer graph that holds at every depth, so a
/// pointer that sits on a non-terminating cycle can never be memoized at any depth. The scenario this
/// test was originally written to cover is unsatisfiable.
///
/// Consequently this test does not exercise PASS 1's `|| memo.contains_key(&(w, depth))` exit at all
/// — removing that disjunct would not change the outcome here — so it must not be cited as coverage
/// for it. That coverage belongs to `a_spine_that_converges_on_a_memoized_pointer_still_decodes`,
/// which converges on a real memo hit and exercises both PASS 1's short-circuit and PASS 2's fast
/// path.
#[test]
fn a_cycle_disjoint_from_a_populated_memo_is_still_a_mismatch() {
    // Cells 1,2: an acyclic 2-list. 1 -> 2 -> nil.
    // Cells 3,4: a cycle, 3 -> 4 -> 3, which never reaches either nil or cell 1.
    // Outer cells 5,6: heads are pointers 1 then 3.
    let heap = vec![(7, 2), (7, 0), (7, 4), (7, 3), (1, 6), (3, 0)];
    let o = AsmOutcome { result: 5, heap };
    assert_eq!(
        decode_asm_ty_reason(&o, &Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))))),
        Err(DecodeFailure::Mismatch),
        "a cycle disjoint from a populated memo must not decode"
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
    let got =
        decode_asm_ty(&o, &Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))))).expect("convergent, acyclic, must decode");
    let inner_short =
        Value::Cons(Rc::new(Value::Nat(7)), Rc::new(Value::Cons(Rc::new(Value::Nat(8)), Rc::new(Value::Nil))));
    let inner_long = Value::Cons(Rc::new(Value::Nat(9)), Rc::new(inner_short.clone()));
    let want = Value::Cons(Rc::new(inner_long), Rc::new(Value::Cons(Rc::new(inner_short), Rc::new(Value::Nil))));
    assert!(got == want, "decode_asm_ty of the convergent spine did not match the independently constructed value");
}

/// The value-directed decoder is bounded now, and says so. A 3-cell heap under a budget it cannot
/// meet is not constructible from outside, so this asserts the two things that ARE observable: an
/// ordinary decode reports `Ok`, and a representation mismatch reports `Mismatch` rather than a bare
/// `None` — i.e. the reason channel exists and carries the right arm.
#[test]
fn value_directed_reports_a_reason() {
    let o = AsmOutcome { result: 1, heap: vec![(5, 0)] };
    let expected = Value::Cons(Rc::new(Value::Nat(0)), Rc::new(Value::Nil));
    assert!(decode_asm_reason(&o, &expected).is_ok(), "an ordinary 1-cell decode must report Ok");

    // A `Bool` expectation against the word 5: not 0 and not 1, so the DATA is wrong, not the budget.
    //
    // `assert!(a == b, ..)` rather than `assert_eq!`, per this file's idiom: `assert_eq!`
    // `Debug`-formats BOTH sides on failure, and a decoded value here is an `Rc` DAG whose printed
    // size is its LOGICAL size, so a large one expands into a walk that OOMs instead of printing a
    // diff. This particular expectation is a `Bool` leaf and could never grow, but the idiom is
    // uniform across the file precisely so no future test has a same-file precedent to copy from.
    let b = AsmOutcome { result: 5, heap: vec![] };
    assert!(
        decode_asm_reason(&b, &Value::Bool(false)) == Err(DecodeFailure::Mismatch),
        "a word that is neither 0 nor 1 under a Bool expectation is the DATA's fault, not the budget's"
    );
}
