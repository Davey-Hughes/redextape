# λ backend — typed decode + foreign reader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Spec:** [`docs/superpowers/specs/2026-07-28-lambda-foreign-reader-and-typed-decode-design.md`](../specs/2026-07-28-lambda-foreign-reader-and-typed-decode-design.md)

**Goal:** Give the λ backend a `Ty`-directed decoder that reads a normal form without a reference run,
and a foreign reader — its own parser, reducer and decoder written from the docs — that checks the λ text
form is unambiguous to someone who did not write the printer.

**Architecture:** Four independent commits. Task 1 fixes a printer/parser defect measured before this plan
was written (below), because Task 3's corpus cannot be expressed in the text form until it is fixed.
Task 2 adds `decode_lambda_ty` as a plain sibling of `decode` in `lambda/decode.rs`, with the list spine
walked iteratively so decode depth tracks the TYPE's nesting rather than the list's length. Task 3 is a
new integration test that shares no code with the λ backend. Task 4 settles spec section C and records it.

**Tech Stack:** Rust (edition 2024, `max_width = 120`, `use_small_heuristics = "Max"`), `proptest`,
`cargo test -p redextape-core`. No new dependencies.

## Global Constraints

- **Formatting:** `rustfmt.toml` pins `edition = "2024"`, `max_width = 120`, `use_small_heuristics = "Max"`.
  Run `cargo fmt --all` before every commit; CI enforces it.
- **Gate:** `scripts/check-all.sh --no-llvm` is the before-merge gate (fast tier). Per-task steps use
  narrower `cargo test` invocations; run the gate once at the end of each task.
- **Commit messages:** repo style is `type(scope): lower-case summary` (`fix(lambda):`, `feat(lambda):`,
  `test(lambda):`, `docs(roadmap):`). **Do not add any `Co-Authored-By` or "Generated with" attribution.**
- **`decode` is never replaced.** Every new decoder is a SIBLING. The Value-directed decoder's strictness
  is what makes the oracle catch a wrong answer; re-expressing one over the other silently loosens it.
- **A disagreement is a defect, not something to accommodate.** If a new checker disagrees with existing
  code, stop and report which input and which step — do not adjust the checker until the disagreement is
  explained.

---

## What was measured before this plan was written

Two facts, obtained by running a throwaway probe over the oracle demo corpus. Both change the plan, so
neither is left as an assumption for the implementer.

**1. `print_lambda`'s output does not reparse for any program with mutable state — a live defect.**
`lambda/lower.rs` binds the store-passing state under a binder literally named `$store`
(`const STORE: &str = "$store"`, line 11). `lambda/syntax.rs`'s lexer accepts `_` and ASCII alphanumerics
only, so `parse_lambda` rejects its own printer's output with `expected a parameter name` at byte 2:

| demo | `parse_lambda(print_lambda(lower(core))) == term` |
|---|---|
| `1 + 2 * 3` | true |
| `let x = 1; let y = x + x; y * 3` | true |
| `let mut x = 1; x = x + 10; x = x * 2; x` | **false** |
| `let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc` | **false** |
| `fn count_down(n) { let mut acc = 0; while n > 0 { … } acc } count_down(4)` | **false** |
| `fn sum(n) { … } sum(5)`, `head(cons(7, nil))`, `[1, 2, 3]` | true |

`parse_print_round_trips` never caught it because its generator emits the binder hints `"v"` and `"x"`
and nothing else. This is Task 1, and it is a sharper version of what spec §B4 predicted: the risk was
guessed to be an undocumented α-renaming rule; what is actually broken is that the text form cannot
express the names the lowering emits.

**2. Term depth on the demo corpus is small — the foreign parser's depth guard is not a constraint.**
Maximum depth of any lowered term across the corpus: **46** (`let add1 = |x| x + 1; add1(41)`). Maximum
normal-form depth: **44**. Longest printed lowered term: **860 chars**. `MAX_PARSE_DEPTH` is 256, so
nothing in Task 3's corpus comes near either bound.

**3. The A2 determination (spec §A2 asked for this, explicitly refusing to assume it).**
`decode`'s recursion is driven by `expected` — `decode_cons` recurses on the expected head and tail — so
its depth is bounded by the **reference `Value`'s** depth, which the caller already built and holds.
`decode_lambda_ty` cannot inherit that bound: a `Ty` is finite but a `List<Nat>` describes a spine of any
length, so recursion would be driven by the **term**, a new axis proportional to the data. Terms out of
`reduce_to_normal_form`'s `Normalized` path are ≤ `MAX_TERM_DEPTH` (3,000) — `depth_exceeds` is checked at
the top of the loop iteration that returns them — but that is a postcondition nothing states, and
`decode_lambda_ty` is `pub`, so it can be handed a parsed or hand-built term instead. Task 2 removes the
axis rather than relying on the bound: the spine is walked iteratively, leaving decode depth equal to the
`Ty`'s own nesting depth (`MAX_TY_DEPTH` = 64 for a parsed type). No node budget — the spec is right that
a λ normal form is a finite tree, not the TM heap's graph.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `crates/redextape-core/src/lambda/syntax.rs` | Modify | Lexer accepts `$`; module doc gains the identifier grammar and the freshening rule; generator draws from a hint pool; new demo round-trip test |
| `crates/redextape-core/src/lambda/decode.rs` | Modify | New `decode_lambda_ty` sibling + agreement, pinned-disagreement and spine-depth tests |
| `crates/redextape-core/src/lambda.rs` | Modify | Re-export `decode_lambda_ty` |
| `crates/redextape-core/tests/lambda_foreign_reader.rs` | Create | Independent parser + reducer + decoder, written from doc comments only |
| `docs/superpowers/specs/2026-07-28-…-design.md` | Modify | Status header; record the §C decision |
| `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` | Modify | Slice entry with findings and what stays open |

---

## Task 1: The λ text form cannot express the names its own lowering emits

**Files:**
- Modify: `crates/redextape-core/src/lambda/syntax.rs` (module doc lines 1-3; `is_ident_start`/
  `is_ident_continue` lines 145-151; `closed_term()` generator lines 293-309; tests module)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `parse_lambda(print_lambda(t))` round-trips for every term `lambda::lower::lower` can emit.
  Task 3's corpus depends on this — without it, three of its rows produce text no parser can read.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `crates/redextape-core/src/lambda/syntax.rs`, after `print_is_idempotent`:

```rust
/// The text form must be able to express what this backend's own lowering emits. It could not:
/// `lower.rs` binds store-passing state under `$store`, and the lexer below accepted only `_` and
/// ASCII alphanumerics, so `parse_lambda` rejected `print_lambda`'s output — with `expected a
/// parameter name` — for every program with mutable state. `parse_print_round_trips` missed it
/// because its generator only ever emitted the hints `v` and `x`.
#[test]
fn printed_lowering_of_every_demo_reparses() {
    use crate::desugar::desugar;
    use crate::lambda::lower::lower;
    use crate::parser::parse;

    let demos = [
        "1 + 2 * 3",
        "let x = 1; let y = x + x; y * 3",
        "let mut x = 1; x = x + 10; x = x * 2; x",
        "let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc",
        "fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)",
        "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
        "[1, 2, 3]",
    ];
    for src in demos {
        let (prog, ds) = parse(src);
        assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
        let term = lower(&desugar(&prog.unwrap())).expect("every demo lowers");
        let printed = print_lambda(&term);
        let (reparsed, ds) = parse_lambda(&printed);
        assert!(ds.is_empty(), "printed lowering of {src:?} does not reparse: {ds:?}\n{printed}");
        assert_eq!(reparsed.unwrap(), term, "round-trip changed the term for {src:?}");
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cargo test -p redextape-core --lib lambda::syntax::tests::printed_lowering_of_every_demo_reparses
```

Expected: FAIL, on the `let mut x = 1; …` row, with
`does not reparse: [Diagnostic { … message: "expected a parameter name" }]`.

- [ ] **Step 3: Make the lexer accept the lowering's scaffolding names**

Replace lines 145-151 of `crates/redextape-core/src/lambda/syntax.rs`:

```rust
fn is_ident_start(c: char) -> bool {
    c == '_' || c == '$' || c.is_ascii_alphabetic()
}

fn is_ident_continue(c: char) -> bool {
    c == '_' || c == '$' || c.is_ascii_alphanumeric()
}
```

`$` is accepted in both positions, not just the first: `$` is the project's marker for compiler-generated
names the surface syntax cannot forge (see `defunc`'s scaffolding builtins), so any future λ scaffolding
name is covered without revisiting this, and no source-level identifier can collide with one.

- [ ] **Step 4: Document the identifier grammar and the freshening rule**

The parser and printer are what Task 3's foreign reader is written against, and neither the identifier
grammar nor the freshening convention is written down anywhere today. Replace the module doc at lines 1-3:

```rust
//! The human-readable, runnable lambda text form: `var`, `\x. e` (also `λ`), application by
//! juxtaposition (left-assoc), parens. Parsing resolves names to de Bruijn indices; printing
//! regenerates readable names from binder hints. Printer and parser round-trip (§7.2).
//!
//! IDENTIFIERS. An identifier starts with an ASCII letter, `_`, or `$`, and continues with those plus
//! ASCII digits. `$` is there because the lowering names its store-passing binder `$store`
//! (`lower.rs`); it is the project's marker for a compiler-generated name the surface syntax cannot
//! forge, so a printed lowering never collides with a source identifier. Whitespace separates
//! identifiers; `\`, `λ`, `.`, `(` and `)` terminate one.
//!
//! NAMES AND SCOPE — the rule that makes printed output unambiguous, stated because a reader that did
//! not write the printer needs it. `print_lambda` guarantees **no binder shares a name with any binder
//! enclosing it**: `fresh` takes the binder's hint and, if that name is already in scope, appends the
//! least `k >= 0` making `hint{k}` unused. So an occurrence resolves to the NEAREST enclosing binder
//! with that name, and the parser's rightmost-in-scope match is exact rather than a convention. A name
//! MAY be reused in a disjoint scope (`(\x. x) (\x. x)`), which is why the rule is about enclosing
//! binders and not about the term as a whole.
//!
//! A FREE variable has no name to print and comes out as `?<index>`, which is not a valid identifier —
//! deliberately, so an open term fails to reparse loudly rather than silently rebinding. Everything the
//! backend produces is closed.
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cargo test -p redextape-core --lib lambda::syntax::tests::printed_lowering_of_every_demo_reparses
```

Expected: PASS.

- [ ] **Step 6: Give the round-trip proptest a generator that could have caught this**

The generator could only ever produce two binder names, so it could not exercise `$`-names or the
freshening path at all. Replace the `closed_term()` strategy (lines 292-309):

```rust
/// Binder hints the generator draws from. A single fixed hint (what this used to use) can produce
/// neither a `$`-prefixed lowering name nor a shadow collision, so it could not have caught either
/// the lexer gap above or a freshening bug. Drawing independently at each binder means nested
/// repeats — and therefore `fresh`'s rename path — occur naturally.
const HINTS: [&str; 4] = ["v", "x", "$store", "_a1"];

/// Generate closed de Bruijn terms of bounded depth.
fn closed_term() -> impl Strategy<Value = LambdaTerm> {
    fn go(depth: u32, binders: u32) -> BoxedStrategy<LambdaTerm> {
        if depth == 0 {
            // Base case: a bound variable if any binder is in scope, else a trivial closed term.
            return if binders == 0 { Just(abs("x", var(0))).boxed() } else { (0..binders).prop_map(var).boxed() };
        }
        let abs_strat =
            (go(depth - 1, binders + 1), 0..HINTS.len()).prop_map(|(b, i)| abs(HINTS[i], b)).boxed();
        if binders == 0 {
            // No variable is in scope yet, so a closed term MUST introduce a binder here.
            return abs_strat;
        }
        let var_strat = (0..binders).prop_map(var).boxed();
        let app_strat = (go(depth - 1, binders), go(depth - 1, binders)).prop_map(|(f, a)| app(f, a)).boxed();
        prop_oneof![var_strat, abs_strat, app_strat].boxed()
    }
    go(4, 0)
}
```

- [ ] **Step 7: Verify the new generator would have caught the original defect**

Sabotage check — confirm the strengthened proptest actually detects the bug it is meant to detect, rather
than passing for unrelated reasons. Temporarily revert Step 3 (drop `c == '$' ||` from both predicates),
then run:

```bash
cargo test -p redextape-core --lib lambda::syntax::tests::parse_print_round_trips
```

Expected: FAIL, with a shrunk counterexample containing `$store`. **Restore Step 3's change** and re-run;
expected: PASS. If it passes while sabotaged, the generator is still not reaching `$store` — fix the
generator before continuing, because a proptest that cannot fail here is worth nothing.

- [ ] **Step 8: Run the whole λ suite and the gate**

```bash
cargo fmt --all
cargo test -p redextape-core --lib lambda
scripts/check-all.sh --no-llvm
```

Expected: all green. `print_is_idempotent_prop` in particular must still pass — it exercises `fresh`'s
rename path far more often now.

- [ ] **Step 9: Commit**

```bash
git add crates/redextape-core/src/lambda/syntax.rs
git commit -m "fix(lambda): the text form could not express its own lowering's names

print_lambda emits \$store binders (lower.rs's store-passing state); the lexer
accepted only _ and ASCII alphanumerics, so parse_lambda rejected its own
printer's output for every program with mutable state. parse_print_round_trips
missed it because its generator only ever emitted the hints v and x.

Accept \$ in identifiers, write down the identifier grammar and the freshening
rule (no binder shares a name with one enclosing it -> rightmost-in-scope is
exact, not a convention), and draw binder hints from a pool so the proptest can
reach both."
```

---

## Task 2: `decode_lambda_ty` — reading a normal form without a reference run

**Files:**
- Modify: `crates/redextape-core/src/lambda/decode.rs` (module doc lines 1-4; new public fn after
  `decode`; new tests)
- Modify: `crates/redextape-core/src/lambda.rs:12` (re-export)

**Interfaces:**
- Consumes: nothing from Task 1 (independent, but ordered after it so the branch's first commit is the
  bug fix).
- Produces: `pub fn decode_lambda_ty(nf: &LambdaTerm, ty: &Ty) -> Option<Value>`, re-exported as
  `redextape_core::lambda::decode_lambda_ty`. Task 4 cites its existence; Task 3 does NOT use it (the
  foreign reader writes its own).

- [ ] **Step 1: Write the failing agreement + disagreement tests**

Add to the `tests` module in `crates/redextape-core/src/lambda/decode.rs`, after
`wrong_shape_decodes_to_none`:

```rust
use crate::ty::Ty;

/// A1: the two decoders AGREE wherever both are defined. `decode` is Value-directed (it needs a
/// reference run); `decode_lambda_ty` is Ty-directed (all a reader of printed text can have).
#[test]
fn the_two_decoders_agree_on_nat_bool_and_a_non_empty_list() {
    assert_eq!(decode(&church(5), &Value::Nat(0)), decode_lambda_ty(&church(5), &Ty::Nat));
    assert_eq!(decode_lambda_ty(&church(5), &Ty::Nat), Some(Value::Nat(5)));

    assert_eq!(decode(&tru(), &Value::Bool(false)), decode_lambda_ty(&tru(), &Ty::Bool));
    assert_eq!(decode_lambda_ty(&fls(), &Ty::Bool), Some(Value::Bool(false)));

    let list = app(app(cons(), church(1)), app(app(cons(), church(2)), nil()));
    let (nf, _) = reduce_to_normal_form(&list, MAX_REDUCTION_STEPS);
    let ty = Ty::List(Box::new(Ty::Nat));
    assert_eq!(decode(&nf, &Value::list_of_nats(&[1, 2])), decode_lambda_ty(&nf, &ty));
    assert_eq!(decode_lambda_ty(&nf, &ty), Some(Value::list_of_nats(&[1, 2])));
}

/// …and DISAGREE on exactly two cases, on purpose (spec A1, mirroring `tm::decode`'s D6). Pinning the
/// disagreements is the point: without this test, re-expressing either decoder over the other later
/// would pass every other test in the tree while quietly loosening the oracle's list-LENGTH check.
#[test]
fn the_two_decoders_disagree_on_nil_and_unit_by_design() {
    // A nil normal form under a one-element witness is a WRONG ANSWER the Value-directed decoder must
    // reject — that rejection is how the oracle catches a backend that returned a SHORTER list.
    assert_eq!(decode(&nil(), &Value::list_of_nats(&[1])), None);
    // The Ty-directed decoder has no length to compare against; nil is a legitimate `List<Nat>`.
    assert_eq!(decode_lambda_ty(&nil(), &Ty::List(Box::new(Ty::Nat))), Some(Value::Nil));

    // `Value::Unit` is an internal statement result with no encoding, so there is nothing to decode
    // against it…
    assert_eq!(decode(&church(0), &Value::Unit), None);
    // …but a caller holding `typeck::result_type`'s answer may legitimately have `Ty::Unit` (a
    // `while`-tailed program), and the normal form is then simply ignored.
    assert_eq!(decode_lambda_ty(&church(0), &Ty::Unit), Some(Value::Unit));
}

/// Types that are well-formed but not first-class values decode to `None` — the same call that
/// `ty::parse_ty` makes, and for the same reason: refuse them where they are named rather than let
/// them read as a silent decode failure.
#[test]
fn function_and_variable_types_decode_to_none() {
    let id = abs("x", var(0));
    assert_eq!(decode_lambda_ty(&id, &Ty::Fun(vec![Ty::Nat], Box::new(Ty::Nat))), None);
    assert_eq!(decode_lambda_ty(&id, &Ty::Var(0)), None);
}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cargo test -p redextape-core --lib lambda::decode
```

Expected: FAIL to compile — `cannot find function decode_lambda_ty in this scope`.

- [ ] **Step 3: Write the minimal implementation**

Add to `crates/redextape-core/src/lambda/decode.rs`, immediately after `decode` (line 22), and add
`use crate::ty::Ty;` to the imports at the top:

```rust
/// Decode a normal form against a TYPE rather than a `Value` shape witness — what a reader holding
/// only printed λ text has, since a bare normal form is ambiguous (`church(0)` and `false` are the
/// same term) and there is no reference run to disambiguate it.
///
/// A SIBLING of `decode`, not a replacement for it. They disagree on two cases on purpose: nil under a
/// `Cons` witness, and `Unit`. `decode`'s strictness there is what makes the oracle catch a backend
/// that returned a SHORTER list than the reference, so it cannot be expressed over this one — and the
/// reverse needs a `Value -> Ty` function that is partial, since `Value::Nil` carries no recoverable
/// element type. `tm::decode` and `asm` keep their two decoders side by side for the same reason.
///
/// Unlike the TM pair there is nothing to share: both take the term directly, with no analogue of
/// `read_result`'s tape read.
pub fn decode_lambda_ty(nf: &LambdaTerm, ty: &Ty) -> Option<Value> {
    match ty {
        Ty::Nat => decode_church(nf).map(Value::Nat),
        Ty::Bool => decode_bool(nf).map(Value::Bool),
        // No encoding to read: `Unit` types statements (`while`, assignment), and a program of that
        // type has no value. Declaring it is legitimate, so the normal form is ignored, not rejected.
        Ty::Unit => Some(Value::Unit),
        Ty::List(elem) => decode_list_ty(nf, elem),
        // Well-formed but not first-class values, exactly as `ty::parse_ty` refuses them.
        Ty::Fun(..) | Ty::Var(_) => None,
    }
}

/// Scott list under an element type: `nil = \n.\c. n`, `cons H T = \n.\c. c H T`.
fn decode_list_ty(nf: &LambdaTerm, elem: &Ty) -> Option<Value> {
    let LambdaTerm::Abs(_, outer) = nf else { return None };
    let LambdaTerm::Abs(_, body) = outer.as_ref() else { return None };
    match body.as_ref() {
        LambdaTerm::Var(1) => Some(Value::Nil),
        LambdaTerm::App(ca, t_term) => {
            let LambdaTerm::App(c, h_term) = ca.as_ref() else { return None };
            if !matches!(c.as_ref(), LambdaTerm::Var(0)) {
                return None;
            }
            let head = decode_lambda_ty(h_term, elem)?;
            let tail = decode_list_ty(t_term, elem)?;
            Some(Value::Cons(Rc::new(head), Rc::new(tail)))
        }
        _ => None,
    }
}
```

Then re-export it — `crates/redextape-core/src/lambda.rs:12` becomes:

```rust
pub use decode::{decode, decode_lambda_ty};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cargo test -p redextape-core --lib lambda::decode
```

Expected: PASS (all four new tests plus the pre-existing ones).

- [ ] **Step 5: Write the failing depth test (spec A2)**

`decode_list_ty` above recurses once per cons cell, so its depth is proportional to the list's LENGTH.
That is a new axis `decode` never had — `decode` recurses on the expected `Value`, which the caller
already built. Add to the same tests module:

```rust
/// Build the NORMAL FORM of a Scott list directly, bypassing the reducer: `cons H T` normalizes to
/// `\n.\c. c H T` with `H`/`T` unshifted, because both are closed. Direct construction is the point —
/// `reduce_to_normal_form` refuses any term deeper than `MAX_TERM_DEPTH` (3,000) and a 5,000-cell list
/// is ~20,000 deep, so reduction CANNOT produce this term. A `pub` decoder handed a term from anywhere
/// else — a parser, another tool, a test — must still survive it.
fn scott_list_nf(ns: &[u64]) -> LambdaTerm {
    let mut acc = nil();
    for &n in ns.iter().rev() {
        acc = abs("n", abs("c", app(app(var(0), church(n)), acc)));
    }
    acc
}

/// A2: `decode_lambda_ty` walks the list SPINE iteratively, so its recursion depth is the TYPE's
/// nesting (`List<List<Nat>>` is 2), never the list's length. `decode` needs no equivalent: its
/// recursion is driven by `expected`, so it is bounded by a `Value` the caller already holds.
///
/// Run on a deliberately small 256 KiB stack, which a spine-recursive decoder cannot survive at 5,000
/// cells. NOTE THE FAILURE MODE: a Rust stack overflow aborts the test process, so a regression here
/// shows up as "test binary crashed", not as a red assertion.
///
/// The decode AND its assertion both run inside the thread: `Value` holds `Rc`s, so it is not `Send`
/// and cannot be returned across the join. `Vec<u64>` can, so `ns` is moved in and the expected list
/// rebuilt there. The term is built out here, on the full-size stack, so only the decode is measured —
/// and dropping it inside costs no stack either, since `LambdaTerm` and `Value` both have iterative
/// `Drop`s.
#[test]
fn decode_lambda_ty_is_iterative_over_the_list_spine() {
    let ns: Vec<u64> = (0..5_000).map(|i| i % 10).collect();
    let term = scott_list_nf(&ns);
    std::thread::Builder::new()
        .stack_size(256 * 1024)
        .spawn(move || {
            let decoded = decode_lambda_ty(&term, &Ty::List(Box::new(Ty::Nat)));
            assert_eq!(decoded, Some(Value::list_of_nats(&ns)));
        })
        .expect("spawn a small-stack thread")
        .join()
        .expect("the decode thread must not overflow its stack");
}
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cargo test -p redextape-core --lib lambda::decode::tests::decode_lambda_ty_is_iterative_over_the_list_spine
```

Expected: the test binary aborts with a stack-overflow message (`thread '<unnamed>' has overflowed its
stack`), not a clean assertion failure. That IS the failure being fixed. If instead it passes, stop and
report — either the frame is smaller than assumed or the term is not the shape intended; do not lower the
stack size until you know which.

- [ ] **Step 7: Make the spine iterative**

Replace `decode_list_ty` from Step 3 with:

```rust
/// Scott list under an element type: `nil = \n.\c. n`, `cons H T = \n.\c. c H T`.
///
/// ITERATIVE over the spine, recursive only into HEADS. That is what bounds decode depth by the TYPE's
/// nesting instead of the list's length — the one axis here that grows with the data. No node budget is
/// needed on top (`tm::decode_tape_ty` needs one because the TM heap is a GRAPH whose cells address each
/// other; a λ normal form is a finite tree already in memory, so every walk terminates by construction).
fn decode_list_ty(nf: &LambdaTerm, elem: &Ty) -> Option<Value> {
    let mut heads: Vec<Value> = Vec::new();
    let mut cur = nf;
    loop {
        let LambdaTerm::Abs(_, outer) = cur else { return None };
        let LambdaTerm::Abs(_, body) = outer.as_ref() else { return None };
        match body.as_ref() {
            LambdaTerm::Var(1) => break, // nil
            LambdaTerm::App(ca, t_term) => {
                let LambdaTerm::App(c, h_term) = ca.as_ref() else { return None };
                if !matches!(c.as_ref(), LambdaTerm::Var(0)) {
                    return None;
                }
                heads.push(decode_lambda_ty(h_term, elem)?);
                cur = t_term.as_ref();
            }
            _ => return None,
        }
    }
    let mut acc = Value::Nil;
    for h in heads.into_iter().rev() {
        acc = Value::Cons(Rc::new(h), Rc::new(acc));
    }
    Some(acc)
}
```

- [ ] **Step 8: Run the λ suite to verify everything passes**

```bash
cargo fmt --all
cargo test -p redextape-core --lib lambda
```

Expected: PASS, including the small-stack test. The agreement and disagreement tests must be unchanged —
if the iterative rewrite changed any of their results, the rewrite changed behaviour and must be
explained before continuing.

- [ ] **Step 9: Record the A2 determination on `decode` itself**

Prepend to `decode`'s existing doc comment (line 10-12 of `decode.rs`) so the bound is written where a
caller reads it:

```rust
/// Decode a normal-form term to a `Value`, guided by the type/shape of `expected`. Returns the
/// actual decoded value (equal to `expected` iff the lambda computed the right answer), or `None`
/// if `nf` doesn't match the expected shape.
///
/// DEPTH. Recursion here is driven by `expected`, not by `nf`: `decode_cons` descends into the
/// expected head and tail. So this call is as deep as the reference `Value` the caller already built
/// and holds, and needs no guard of its own. `decode_lambda_ty` cannot inherit that bound — a `Ty` is
/// finite while the list it describes is not — which is why its spine walk is iterative.
```

- [ ] **Step 10: Run the full gate**

```bash
scripts/check-all.sh --no-llvm
```

Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add crates/redextape-core/src/lambda/decode.rs crates/redextape-core/src/lambda.rs
git commit -m "feat(lambda): decode a normal form from a type, with no reference run

decode is Value-directed, so printed lambda text cannot be interpreted from the
text alone. decode_lambda_ty is a SIBLING, not a replacement: they disagree on
nil-under-a-Cons-witness and on Unit, and decode's strictness there is what makes
the oracle catch a backend that returned a shorter list. Both disagreements are
pinned by a test.

Spine walked iteratively, so decode depth is the type's nesting rather than the
list's length; no node budget (a normal form is a tree, not the TM heap's graph).
decode needs no such change and its doc now says why: its recursion is driven by
the expected Value the caller already holds."
```

---

## Task 3: A foreign λ reader

**Files:**
- Create: `crates/redextape-core/tests/lambda_foreign_reader.rs`

**Interfaces:**
- Consumes: Task 1's lexer fix (three corpus rows are unreadable without it). Does NOT consume Task 2 —
  the foreign reader writes its own decoder; that independence is the whole point.
- Produces: no code other tasks use. Its deliverable is the findings list in its own module doc, which
  Task 4 reads.

> **DELIBERATE DEPARTURE FROM THIS PLAN'S OWN "COMPLETE CODE IN EVERY STEP" RULE.** Every other task
> below shows the code to write. This one must not, and a reviewer should not read the omission as a
> placeholder. Spec §B3: the parser, reducer and decoder have to be written from the DOC COMMENTS, never
> from the implementations — a reducer copied from `reduce.rs` proves nothing about whether the format
> and encodings are documented well enough to reimplement. Code in this plan would be code derived from
> reading those implementations, which contaminates exactly the property the test exists to measure. So
> what follows specifies the contract, the corpus, the assertions, the permitted reading list and the
> ban list — precisely, and in full — and leaves the three algorithms to the implementer.
>
> **Execute this task in a fresh subagent** that has not read `term.rs`, `reduce.rs`, `decode.rs` or
> `syntax.rs`'s bodies in its context. If you have already read them in this session, dispatch it; do not
> write it yourself.

- [ ] **Step 1: Read ONLY the permitted sources**

Permitted, doc comments and public signatures only — never a function body:

| File | What it documents |
|---|---|
| `crates/redextape-core/src/lambda/syntax.rs` | Module doc only: the grammar, the identifier rule and the naming/scope rule (all three written by Task 1) |
| `crates/redextape-core/src/lambda/term.rs` | Module doc + `LambdaTerm` variant docs: de Bruijn indices 0-based, 0 = innermost binder; substitution is index arithmetic |
| `crates/redextape-core/src/lambda/reduce.rs` | Module doc + `MAX_REDUCTION_STEPS`/`MAX_TERM_DEPTH` docs: normal-order (leftmost-outermost) β-reduction, step cap, depth bound |
| `crates/redextape-core/src/lambda/encode.rs` | Module doc + per-combinator docs: `church n = \f.\x. fⁿ x`, `true = \t.\f. t`, `false = \t.\f. f`, `nil = \n.\c. n`, `cons = \h.\t.\n.\c. c h t` |

**Banned:** the body of anything in `lambda/`, `lambda/lower.rs` entirely, `lambda/decode.rs` entirely
(including its module doc — it describes the decoding strategy this task must rederive),
`tests/lambda_oracle.rs`, and `tests/tm_foreign_reader.rs`'s parser/simulator bodies (its module doc and
overall shape are fine to read as a template).

Record, as you go, every question the permitted docs did not answer. That list is this task's primary
deliverable — not the passing test.

- [ ] **Step 2: Write the test file's module doc first**

Create `crates/redextape-core/tests/lambda_foreign_reader.rs` starting with:

```rust
//! A FOREIGN reader for the λ text form: an independent PARSER, an independent normal-order REDUCER
//! and an independent DECODER, written from the documentation rather than from the implementation.
//!
//! WHY THIS EXISTS. `parse_lambda(print_lambda(t)) == t` is already proptested — and that property can
//! hold while the printed text is ambiguous to any reader that did not write the printer, because our
//! parser shares our printer's assumptions about names. This is the only check in the project that can
//! find an ambiguity in the λ text form.
//!
//! WHY IT IS A CORRECTNESS CHECK AND NOT JUST A DOCUMENTATION ONE, unlike the TM's foreign reader:
//! β-reduction is a textbook algorithm with a published specification, so an independent
//! implementation is genuinely independent; and normal-order reduction has subtle parts —
//! capture-avoiding substitution, redex selection — where two honest implementations can diverge. A
//! disagreement here is a bug signal, not only a doc gap.
//!
//! THE DISCIPLINE THIS TEST DEPENDS ON, stated because it is invisible in the finished code: the
//! parser, reducer and decoder below were written from the DOC COMMENTS in `lambda/syntax.rs`,
//! `lambda/term.rs`, `lambda/reduce.rs` and `lambda/encode.rs` — never by reading their bodies.
//! `lambda/decode.rs` and `lambda/lower.rs` were never opened at all. If you change this file, hold
//! that line.
//!
//! IT WRITES ITS OWN PARSER — the one place this goes further than `tm_foreign_reader.rs`, which was
//! right to reuse `parse_tm_full`. There, parsing is the format, not the simulation. Here, the parser
//! is exactly where the untested risk lives.
//!
//! WHAT THE DOCS DID NOT COVER — this file's primary deliverable. <filled in at Step 6>
//!
//! Imports `lower` and `print_lambda` (the PRODUCER side — this test is about reading what they
//! write), `run` (the reference), `parse`/`desugar` (the front end) and `Value`. Nothing else from
//! `redextape_core::lambda`: no `LambdaTerm`, no `parse_lambda`, no `reduce_*`, no `decode`, no
//! `decode_lambda_ty`.
```

- [ ] **Step 3: Write the reader — its own term type, parser, reducer, decoder**

Contract, all four pieces local to this file:

1. **A term type.** Its own enum; `redextape_core::lambda::LambdaTerm` must not appear in this file.
2. **A parser** `&str -> Result<YourTerm, String>` implementing the grammar from `syntax.rs`'s module
   doc, resolving names to de Bruijn indices. Reject unbound names and trailing input. Guard nesting
   depth (measured corpus maximum is 46; a limit of 256 matches the documented `MAX_PARSE_DEPTH`).
3. **A reducer** to normal form: normal-order, leftmost-outermost, with a step cap (`1_000_000` is
   ample — the corpus normalizes in well under that) and a depth cap mirroring the documented
   `MAX_TERM_DEPTH`. Panic on either cap with a message naming the source program, so a subtly wrong
   redex rule fails loudly instead of hanging.
4. **A decoder** `(YourTerm, FTy) -> Option<Value>` over a local `enum FTy { Nat, Bool, ListNat }`,
   reading Church numerals and Scott booleans/lists per `encode.rs`'s combinator docs.

The type must be supplied per corpus row rather than read from the text — the λ text form carries no
result type. **Note that fact in the module doc**; it is the evidence Task 4's decision turns on.

- [ ] **Step 4: Write the test**

One `#[test]` over the corpus below. For each row: `parse` → `desugar` → `lower` → `print_lambda` to get
the text, hand that TEXT to the foreign parser, foreign-reduce it, foreign-decode it with the row's type,
and assert it equals `redextape_core::run(src).unwrap()`.

Use the printed **lowered** term, not the printed normal form. Reducing an already-normal term is a
no-op, so a normal-form corpus would exercise the parser and decoder and leave the reducer — the piece
with the published specification and the subtle parts — untested.

```rust
const CORPUS: &[(&str, FTy)] = &[
    ("1 + 2 * 3", FTy::Nat),
    ("3 - 5", FTy::Nat),
    ("if 2 > 1 { 10 } else { 20 }", FTy::Nat),
    ("2 > 1", FTy::Bool),
    ("let x = 1; let y = x + x; y * 3", FTy::Nat),
    ("let add1 = |x| x + 1; add1(41)", FTy::Nat),
    ("fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)", FTy::Nat),
    ("head(cons(7, nil))", FTy::Nat),
    ("[1, 2, 3]", FTy::ListNat),
    ("is_empty(nil)", FTy::Bool),
    // Mutable state: these lower through `$store` binders, and their printed form was unparseable
    // before this branch's first commit. They are the regression link to it.
    ("let mut x = 1; x = x + 10; x = x * 2; x", FTy::Nat),
    ("let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc", FTy::Nat),
    ("fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)", FTy::Nat),
];
```

Assertion message must name the source program and the printed text on failure.

- [ ] **Step 5: Run it**

```bash
cargo test -p redextape-core --test lambda_foreign_reader -- --nocapture
```

Expected: PASS.

**If the foreign reducer disagrees with the reference on any row, STOP.** Report which program, which
reduction step, and both terms. Do not adjust the foreign reducer to match — a disagreement between an
implementation and a textbook algorithm is the finding this test was built to produce, and explaining it
comes before making it green.

- [ ] **Step 6: Fill in the findings section**

Replace `<filled in at Step 6>` in the module doc with the numbered list from Step 1 — every question the
permitted docs did not answer, and how you resolved each (guessed and verified against the corpus / found
in another doc / genuinely undocumented). If the list is empty, say so explicitly and say what you
checked; "no gaps" is a real result only when it is stated as one.

State any residual honestly, in the manner of `tm_foreign_reader.rs`'s own residual note: if a piece was
taken from this plan's brief rather than from a doc comment, say which piece, because a later reader will
otherwise take this file as establishing more than it does.

- [ ] **Step 7: Run the full gate**

```bash
cargo fmt --all
scripts/check-all.sh --no-llvm
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add crates/redextape-core/tests/lambda_foreign_reader.rs
git commit -m "test(lambda): a foreign reader for the text form — own parser, reducer, decoder

Every existing check reads printed lambda text with the parser that was written
alongside the printer, so parse_print_round_trips can hold while the text is
ambiguous to anyone else. This reader shares no code with the backend: its own
term type, its own normal-order reducer, its own Church/Scott decoder, all
written from the doc comments in syntax.rs/term.rs/reduce.rs/encode.rs.

It consumes the printed LOWERED term, not the normal form — reducing an
already-normal term would leave the reducer, the piece with a published spec and
the subtle parts, untested. The findings list in the module doc is the
deliverable; the passing test is the floor."
```

---

## Task 4: Settle spec §C — does the λ text form want a result type?

**Files:**
- Modify: `docs/superpowers/specs/2026-07-28-lambda-foreign-reader-and-typed-decode-design.md` (status
  header at lines 3-7; §C at lines 112-126)
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md` (append a slice entry)

**Interfaces:**
- Consumes: Task 2's `decode_lambda_ty` (the thing that needs a `Ty` from somewhere) and Task 3's finding
  that its type came from the corpus table rather than the text.
- Produces: documentation only.

- [ ] **Step 1: Apply the criterion**

The spec's three options are: (1) nothing — callers hold the type via `typeck::result_type`; (2)
`run_lambda` returns the type alongside the normal form; (3) a `; result: List<Nat>` line in the printed
text. The criterion the spec set is **whether anything outside this project would ever read a printed λ
term.**

Answer it from what Tasks 2 and 3 actually showed, not from preference. Concretely: does any consumer in
the tree today read `print_lambda`'s output and need to interpret it? Check with

```bash
grep -rn "print_lambda" crates --include='*.rs' | grep -v "src/lambda/syntax.rs"
```

- [ ] **Step 2: Write the decision into §C**

If the grep shows only `examples/lambda_demo.rs` (which prints for a human) and
`tests/lambda_foreign_reader.rs` (which is handed the type by its corpus table), the answer is **option
1**. Replace §C's body with:

```markdown
## C — RESOLVED (2026-07-28): nothing. The text form carries no result type.

`decode_lambda_ty` needs a `Ty`, and every caller in the tree has one already: the oracle holds the
reference `Value`, other callers hold `typeck::result_type`'s answer, and the foreign reader is handed
one per corpus row. Nothing reads printed λ text and needs to interpret it — `lambda_demo` prints for a
human, and `tests/lambda_foreign_reader.rs` is the only mechanical reader, by construction supplied with
the type.

**What would flip this**, stated so a later reader can weigh it instead of rediscovering it: a consumer
that receives λ text WITHOUT also receiving the program it came from. The visualizer's λ pane is not one
(it holds the source). A `.lam` file handed to another tool would be, and would want option 2 —
`run_lambda` returning the type — before option 3, because a comment line in the text is a format change
and the type is already computed.

**The evidence, and its limit.** The foreign reader demonstrates that a term whose type is supplied
out-of-band is fully interpretable. It does NOT demonstrate that a term WITHOUT one is — nothing tried,
because nothing needed to. That is the residual, and it is exactly the residual option 1 accepts.
```

If instead the grep turns up a consumer that reads printed text and must interpret it, record option 2
with that consumer named, and open a follow-up item rather than implementing it here — it is a change to
`run_lambda`'s signature and belongs in its own slice.

- [ ] **Step 3: Update the spec's status header**

Replace lines 3-7 of the spec:

```markdown
> **Status:** IMPLEMENTED (2026-07-28) — see
> [`docs/superpowers/plans/2026-07-28-lambda-foreign-reader-and-typed-decode.md`](../plans/2026-07-28-lambda-foreign-reader-and-typed-decode.md).
> §A shipped as `lambda::decode_lambda_ty`; §B as `tests/lambda_foreign_reader.rs`; §C resolved below.
> **One thing this spec did not predict:** §B guessed the risk in the text form was an undocumented
> α-renaming rule. The actual defect was cruder and larger — `print_lambda` emitted `$store` binders the
> lexer could not read, so the printed lowering of every program with mutable state failed to reparse in
> OUR OWN parser. The freshening rule turned out to be sound and merely unwritten; it is written now.
```

- [ ] **Step 4: Append the roadmap entry**

Append to `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, matching the existing entries' style
(bold lead, what shipped, findings, honest bound, what stays open):

```markdown
- **λ typed decode + foreign reader (2026-07-28).** Spec:
  `specs/2026-07-28-lambda-foreign-reader-and-typed-decode-design.md`. The λ backend had the two gaps the
  TM header branch had just closed on its side: a printed normal form could not be INTERPRETED without a
  reference run, and every test of "any reducer can read this" used OUR reducer. Both closed;
  **λ needs no header** — `print_tm` serialized half a machine, but a λ term IS its whole configuration.

  **Shipped.** `lambda::decode_lambda_ty` as a SIBLING of `decode`, with both deliberate disagreements
  pinned (nil under a `Cons` witness, `Unit`) so re-expressing either over the other cannot quietly
  loosen the oracle's list-length check. Its list spine is walked ITERATIVELY, which is the whole of the
  A2 answer: `decode`'s recursion is driven by the expected `Value` the caller already holds, so it needs
  no guard; a Ty-directed decode is driven by the TERM, an axis proportional to the data, and removing
  the axis beats bounding it. No node budget — `decode_tape_ty` needs one because the TM heap is a graph;
  a normal form is a finite tree. And `tests/lambda_foreign_reader.rs`: its own term type, parser,
  normal-order reducer and Church/Scott decoder, written from doc comments only, consuming the printed
  LOWERED term so the reducer is actually exercised.

  **THE FINDING, and it was live.** `print_lambda`'s output did not reparse in `parse_lambda` for any
  program with mutable state: the lowering binds store-passing state as `$store`, and the lexer accepted
  only `_` and ASCII alphanumerics. `parse_print_round_trips` had proptested the round-trip since Plan 2
  and never saw it, because its generator emitted exactly two binder hints. **The guard proved less than
  its name claimed, and the gap was in the generator, not the property.** The generator now draws from a
  pool including `$store`, and the fix was sabotage-checked: reverting the lexer change must make the
  proptest fail with a `$store` counterexample.

  **Also written down, because the foreign reader needed it and could not find it:** the identifier
  grammar, and the naming rule that makes printed output unambiguous — `fresh` guarantees no binder
  shares a name with any binder ENCLOSING it, so the parser's rightmost-in-scope match is exact rather
  than a convention. The spec expected the α-renaming rule to be the missing piece; it was merely
  unwritten, and the cruder defect above was the real one.

  **What stays open.** §C resolved as "nothing" (see the spec): the λ text form carries no result type
  because every caller already has one. The residual is that no reader has interpreted a printed λ term
  WITHOUT being handed its type out of band — nothing needed to. A `.lam` file handed to another tool
  would flip it, and wants `run_lambda` returning the type before it wants a `; result:` line.
```

- [ ] **Step 5: Verify the docs are consistent**

```bash
grep -n "Status:" docs/superpowers/specs/2026-07-28-lambda-foreign-reader-and-typed-decode-design.md
grep -c "DEFERRED ON PURPOSE" docs/superpowers/specs/2026-07-28-lambda-foreign-reader-and-typed-decode-design.md
```

Expected: the status line reads `IMPLEMENTED (2026-07-28)`, and the `DEFERRED ON PURPOSE` count is `0` —
§C's heading was replaced, so a surviving instance means the old text is still there and the spec now
asserts both that the question is open and that it is answered.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-28-lambda-foreign-reader-and-typed-decode-design.md \
        docs/superpowers/plans/2026-07-19-redextape-roadmap.md \
        docs/superpowers/plans/2026-07-28-lambda-foreign-reader-and-typed-decode.md
git commit -m "docs(roadmap): record the lambda typed-decode + foreign-reader slice

Resolves spec section C as 'nothing' — the text form carries no result type
because every caller already has one — and records what would flip it. Also
records the branch's real finding: print_lambda's output did not reparse in
parse_lambda for any program with mutable state, and the round-trip proptest
that had covered that property since Plan 2 could not have caught it, because
its generator emitted exactly two binder hints."
```

---

## Self-Review

**Spec coverage.** §A1 (`decode_lambda_ty` as a sibling, both disagreements pinned) → Task 2 Steps 1-4.
§A2 (determine, do not assume, whether decode is depth-bounded and by what) → the measurement section
plus Task 2 Steps 5-9. §B1 (own parser as well as own reducer) → Task 3 Step 3 item 2, and the module doc
says why. §B2 (independent decode) → Task 3 Step 3 item 4. §B3 (written from doc comments) → Task 3's
departure note, Step 1's permitted/banned lists, and the module doc's discipline paragraph. §B4 (the
documentation gap is the deliverable) → Task 3 Step 6. §C (deferred until A and B report) → Task 4, with
the criterion applied rather than pre-answered. Testing items 1-4 → Task 2 Steps 1/5, Task 3 Steps 4-5.
Non-goals respected: no λ header, no fast reducer; "fixing `print_lambda`'s freshening" is untouched —
Task 1 fixes the LEXER and writes the freshening rule down, which the spec's non-goal did not anticipate
because it did not know the defect existed.

**Placeholder scan.** One intentional omission, in Task 3, flagged in a call-out box with its
justification: the three foreign algorithms must not be written here or the property under test is
destroyed. Everything else carries the code or the exact command and expected output. `<filled in at Step
6>` is a literal marker in a file being authored across two steps, not an unresolved plan item.

**Type consistency.** `decode_lambda_ty(&LambdaTerm, &Ty) -> Option<Value>` is used identically in Task
2's tests, its implementation, the re-export, and Task 4's citation. `decode_list_ty(&LambdaTerm, &Ty)`
appears twice — Step 3's recursive version and Step 7's iterative replacement — with the same signature,
which is what makes Step 7 a drop-in. `scott_list_nf(&[u64]) -> LambdaTerm` is defined and used once.
Task 3 deliberately shares no names with the backend; its `FTy` is local and appears only in that task.
