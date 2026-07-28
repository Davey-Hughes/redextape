# Self-Describing TM Text-Form Header — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `.tm` file that any TM simulator can **run**, and that this project can **interpret**, with nothing but the file — via an **optional** header carrying the literal initial tapes plus the `encoding`/`width`/`slots`/`result` recipe.

**Architecture:** Additive serialization slice. A new `tm/header.rs` owns the header's data type (`TmHeader`, `EncodingKind`) and its line grammar; `tm/syntax.rs` keeps owning state/rule lines and gains one parser (`parse_tm_full`) that `parse_tm` delegates to. `tm/decode.rs` gains a `Ty`-directed decoder *beside* the `Value`-directed one, over a shared tape read. `tm.rs` gains a producer that captures the initial tapes the simulation actually used, so the header describes a real run rather than a re-derived one. **`Machine` gains no field.**

**Tech Stack:** Rust (edition per `rust-toolchain.toml`), `redextape-core` crate only. No new dependencies. `cargo test`, `cargo fmt`, `cargo clippy`.

## Global Constraints

Copied from the spec. Every task's requirements implicitly include these.

- **`Machine` is untouched.** No new field, no changed derive. `lower_tm.rs` states the rule twice: provenance is a *returned artifact*, never a struct field, because `Machine` derives `PartialEq` and the round-trip asserts `parse_tm(print_tm(m)) == m`.
- **`print_tm`'s output is byte-identical to today.** If it is not, the split is wrong.
- **`parse_tm`'s signature and behaviour are unchanged.** Every existing call site is untouched.
- **Nothing in `lower_tm`, `sim`, or the `Encoding` trait changes.** No new trait method. (`tm/asm.rs` and `tm.rs` *do* change — see Tasks 2 and 6, each with its justification.)
- **Total and panic-free on untrusted input.** A `.tm` file is untrusted. Every new parse and decode path must be bounded: no unbounded recursion, no indexing that can panic, no stack overflow from a hostile nesting depth or a cyclic heap.
- **The four optionality properties are the load-bearing requirement:**

  | | property | guarantees |
  |---|---|---|
  | 1 | `parse_tm(print_tm(m))` → `(Some(m), [])` | today's round-trip, untouched |
  | 2 | `parse_tm_full(print_tm_with(m, h))` → `(Some(m), Some(h), [])` | the new round-trip |
  | 3 | `parse_tm(print_tm_with(m, h))` → `(Some(m), [])` | a headered file still reads as a plain machine |
  | 4 | `parse_tm_full(print_tm(m))` → `(Some(m), None, [])` | a header-less file yields **no header, not an error** |

- **Header grammar** (directives optional, order-independent, must precede the first `state`):

  ```
  tapes 5                          ; existing, required
  start entry                      ; existing, required
  encoding binary                  ; new — unary | binary
  width 16                         ; new — field width in CELLS
  slots 7                          ; new — REG bank field count
  result List<Nat>                 ; new — Nat | Bool | Unit | List<T>
  tape 0 #0000000000000000#…       ; new — literal initial contents  ; reg
  tape 1 #0000000000000000#        ; new                             ; work
  ```

- **The header set is exactly `encoding`, `width`, `slots`, `result`.** Zero present → no header, no diagnostic. All four → a header. One to three → a diagnostic naming the missing ones. `tape` lines are individually optional and are **not** in the header set; an omitted tape starts empty.
- **Run everything with:** `cargo test -p redextape-core`. Before any commit: `cargo fmt --all` and `cargo clippy --all-targets -- -D warnings`.

---

## File Structure

| file | status | responsibility |
|---|---|---|
| `crates/redextape-core/src/ty.rs` | modify | the type language **and its text form, both directions** — `show` (moved in from `typeck.rs`) and the new `parse_ty` |
| `crates/redextape-core/src/typeck.rs` | modify | loses `show` (2 call sites re-point to `ty::show`) |
| `crates/redextape-core/src/tm/asm.rs` | modify | `decode_word_ty` made total on cyclic heaps and `pub(crate)` |
| `crates/redextape-core/src/tm/decode.rs` | modify | shared tape read + the new `decode_tape_ty` sibling |
| `crates/redextape-core/src/tm/header.rs` | **create** | `EncodingKind`, `TmHeader`, and the header's own line grammar (print + parse of directives). Knows nothing about states or rules. |
| `crates/redextape-core/src/tm/syntax.rs` | modify | `print_tm_with`, `parse_tm_full`; `parse_tm` becomes a wrapper. Knows nothing about encodings. |
| `crates/redextape-core/src/tm.rs` | modify | re-exports; `DescribedRun` + `run_tm_described` (the producer) |
| `crates/redextape-core/tests/tm_header.rs` | **create** | the four optionality properties, the consistency check, the end-to-end file → value test, the sabotage table |
| `crates/redextape-core/tests/fixtures/list_1_2.tm` | **create** | a checked-in self-describing `.tm` file — the end-to-end test's input, so that test touches no `Core` and no `lower_tm` |

**Why `header.rs` is its own file rather than more of `syntax.rs`:** `syntax.rs` is 421 lines and owns one thing — the state/rule line grammar. The header is a second, independent grammar over a data type that depends on `Encoding` and `Ty`, neither of which `syntax.rs` currently mentions. Splitting keeps each file's dependency set honest: `header.rs` never imports `Machine`; `syntax.rs` never imports `Encoding`.

---

## Task ordering and dependencies

```
Task 1 (ty text form) ─┐
                       ├─→ Task 3 (TmHeader) ─→ Task 4 (print) ─→ Task 5 (parse) ─→ Task 6 (producer + integration) ─→ Task 7 (docs)
Task 2 (decode_tape_ty)┘                                                          ↗
```

Tasks 1 and 2 are independent of each other and can be done in either order.

---

### Task 1: The `Ty` text form, both directions

`typeck.rs` already has a private `show(ty)` that emits **exactly** the header's `result` grammar — `Nat`, `Bool`, `Unit`, `List<T>` — character for character. Move it to `ty.rs`, make it public, and add the parser beside it. Both directions living together is what lets one test pin them to each other.

**Files:**
- Modify: `crates/redextape-core/src/ty.rs`
- Modify: `crates/redextape-core/src/typeck.rs:157`, `:466` (call sites), `:504-518` (delete the moved fn)
- Test: `crates/redextape-core/src/ty.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `Ty` (already in `ty.rs`).
- Produces:
  - `pub fn show(ty: &Ty) -> String`
  - `pub fn parse_ty(s: &str) -> Option<Ty>`
  - `pub const MAX_TY_DEPTH: usize = 64`

- [ ] **Step 1: Write the failing tests**

Append to `crates/redextape-core/src/ty.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_types_round_trip_through_their_text_form() {
        for ty in [
            Ty::Nat,
            Ty::Bool,
            Ty::Unit,
            Ty::List(Box::new(Ty::Nat)),
            Ty::List(Box::new(Ty::List(Box::new(Ty::Bool)))),
        ] {
            assert_eq!(parse_ty(&show(&ty)), Some(ty.clone()), "round-trip failed for {ty:?}");
        }
    }

    /// D5: `Fun` and `Var` are not first-class values on the tape, so a file naming one is rejected
    /// where it is WRITTEN rather than decoding to a silent `None` where it is read. They still
    /// `show` — `typeck` prints them in error messages — they just do not parse back.
    #[test]
    fn non_value_types_show_but_do_not_parse() {
        let fun = Ty::Fun(vec![Ty::Nat], Box::new(Ty::Bool));
        assert_eq!(show(&fun), "(Nat) -> Bool");
        assert_eq!(parse_ty("(Nat) -> Bool"), None);
        assert_eq!(show(&Ty::Var(3)), "t3");
        assert_eq!(parse_ty("t3"), None);
    }

    /// Malformed input yields `None`, never a panic. `List<Nat>>` is the interesting one: a naive
    /// peel-the-prefix parser accepts it by ignoring the extra `>`.
    #[test]
    fn malformed_type_text_is_none_not_a_panic() {
        for s in ["", "  ", "List", "List<", "List<>", "List<Nat", "List<Nat>>", "ListNat", "nat", "List<Fun>"] {
            assert_eq!(parse_ty(s), None, "expected None for {s:?}");
        }
    }

    /// A `.tm` file is untrusted input. A hostile nesting depth must be REFUSED, not parsed into a
    /// `Ty` whose recursive `Drop` then overflows the stack on the way out. The parse itself is
    /// iterative; the cap exists for the drop.
    #[test]
    fn absurd_nesting_is_refused_rather_than_built() {
        let deep = format!("{}Nat{}", "List<".repeat(100_000), ">".repeat(100_000));
        assert_eq!(parse_ty(&deep), None);
        // At the cap it still parses; one past it does not.
        let at_cap = format!("{}Nat{}", "List<".repeat(MAX_TY_DEPTH), ">".repeat(MAX_TY_DEPTH));
        assert!(parse_ty(&at_cap).is_some());
        let over = format!("{}Nat{}", "List<".repeat(MAX_TY_DEPTH + 1), ">".repeat(MAX_TY_DEPTH + 1));
        assert_eq!(parse_ty(&over), None);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p redextape-core --lib ty::tests`
Expected: FAIL — `cannot find function 'show' in this scope`, `cannot find function 'parse_ty' in this scope`.

- [ ] **Step 3: Implement both directions in `ty.rs`**

Insert into `crates/redextape-core/src/ty.rs`, after the `Scheme` impl:

```rust
/// The deepest `List<…>` nesting `parse_ty` will build.
///
/// This is a TOTALITY guard on untrusted input, not a language limit. The parse below is iterative,
/// so parsing itself cannot overflow — but `Ty::List` holds a `Box<Ty>`, so a 100,000-deep type
/// overflows the stack in its recursive `Drop` on the way out of the function that built it. Refusing
/// to build it is the fix. Nothing the typechecker infers from real source comes close to 64.
pub const MAX_TY_DEPTH: usize = 64;

/// Render `ty` in the surface type syntax: `Nat`, `Bool`, `Unit`, `List<Nat>`, `(Nat) -> Bool`, `t0`.
///
/// Moved here from `typeck`, which used it only for error messages, because the TM text form's
/// `result` directive needs the same rendering and a second printer would be a second thing to keep
/// in agreement. `parse_ty` is its partial inverse — partial because `Fun`/`Var` print but do not
/// parse back (see `parse_ty`).
pub fn show(ty: &Ty) -> String {
    match ty {
        Ty::Nat => "Nat".into(),
        Ty::Bool => "Bool".into(),
        Ty::Unit => "Unit".into(),
        Ty::List(t) => format!("List<{}>", show(t)),
        Ty::Fun(ps, r) => {
            let ps: Vec<String> = ps.iter().map(show).collect();
            format!("({}) -> {}", ps.join(", "), show(r))
        }
        Ty::Var(v) => format!("t{v}"),
    }
}

/// Parse a VALUE type — `Nat | Bool | Unit | List<T>` — from its `show` form. `None` for anything
/// else, INCLUDING the well-formed-but-undecodable `Fun` and `Var`: they are not first-class values
/// on the tape, so a file naming one is rejected where it is written rather than decoding to a silent
/// `None` where it is read.
///
/// ITERATIVE on the `List` spine (recursion would be on untrusted nesting depth), and capped at
/// `MAX_TY_DEPTH` so the built value's recursive `Drop` is bounded too.
pub fn parse_ty(s: &str) -> Option<Ty> {
    let mut s = s.trim();
    let mut depth = 0usize;
    // Peel `List<` off the front and its matching `>` off the back together, so the two counts cannot
    // disagree: `List<Nat>>` peels to the base `Nat>`, which matches no base type and is rejected.
    while let Some(rest) = s.strip_prefix("List<") {
        // `>` is ASCII, so `len() - 1` is a char boundary whenever `ends_with` holds.
        let rest = rest.strip_suffix('>')?;
        s = rest.trim();
        depth += 1;
        if depth > MAX_TY_DEPTH {
            return None;
        }
    }
    let mut ty = match s {
        "Nat" => Ty::Nat,
        "Bool" => Ty::Bool,
        "Unit" => Ty::Unit,
        _ => return None,
    };
    for _ in 0..depth {
        ty = Ty::List(Box::new(ty));
    }
    Some(ty)
}
```

- [ ] **Step 4: Delete `show` from `typeck.rs` and re-point its two call sites**

In `crates/redextape-core/src/typeck.rs`, delete the whole `fn show(ty: &Ty) -> String { … }` (lines ~504-518) and add to the file's existing `use` block:

```rust
use crate::ty::show;
```

The two call sites (`typeck.rs:157` and `typeck.rs:466`) need no edit — the name resolves to the import.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p redextape-core --lib ty::tests typeck`
Expected: PASS, all of them. The `typeck` tests must be unchanged and green — `show`'s behaviour did not change, only its home.

- [ ] **Step 6: Commit**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/ty.rs crates/redextape-core/src/typeck.rs
git commit -m "refactor(ty): move show into ty.rs and give it an inverse

The TM header's `result` directive needs exactly the rendering typeck's
private `show` already produces, character for character. Moving it beside
the type it renders — rather than writing a second printer — keeps the two
directions in one file, where one test can pin them to each other.

parse_ty is iterative on the List spine and capped at MAX_TY_DEPTH. The cap
is not for the parse, which cannot overflow; it is for the recursive Drop of
the value the parse would otherwise build from untrusted input."
```

---

### Task 2: `decode_tape_ty`, beside `decode_tape` over a shared read

Spec D6. The two decoders **disagree on purpose** — nil under a `Cons` witness, and `Unit` — and the `Value`-directed strictness is what makes the oracle catch a machine that returned a *shorter list* than the reference. Share the tape read; keep the decoding apart; pin both the agreement and the disagreements.

**This task also closes a latent totality hole.** `asm.rs`'s `decode_word_ty` recurses on the heap chain guided by a type that never shrinks for `List`, so a **cyclic heap overflows the stack**. That is unreachable today (every heap comes from the compiler, and a cons cell's tail points only at an *earlier* cell). `decode_tape_ty` makes it reachable: its heap can come from a hand-written `.tm` file's initial HEAP tape. Reusing `decode_word_ty` without hardening it would import the hole; copying it into `decode.rs` would import the hole *and* duplicate the code.

**Files:**
- Modify: `crates/redextape-core/src/tm/asm.rs:470-491` (`decode_word_ty`)
- Modify: `crates/redextape-core/src/tm/decode.rs:17-22` (`decode_tape`), plus the new sibling
- Modify: `crates/redextape-core/src/tm.rs:27` (re-export)
- Test: `crates/redextape-core/src/tm/asm.rs` and `crates/redextape-core/src/tm/decode.rs` (inline test modules)

**Interfaces:**
- Consumes: `Encoding::decode_nat`, `Encoding::parse_heap_cells`, `Tape::snapshot`, `Ty`.
- Produces:
  - `pub fn decode_tape_ty(tapes: &[Tape], ty: &Ty, enc: &dyn Encoding) -> Option<Value>` (in `tm::decode`, re-exported from `tm`)
  - `pub(crate) fn decode_word_ty(word: u64, heap: &[(u64, u64)], ty: &Ty) -> Option<Value>` (in `tm::asm`)

- [ ] **Step 1: Write the failing test for the cyclic heap**

Add to `crates/redextape-core/src/tm/asm.rs`'s `mod tests`:

```rust
/// A heap whose chain never reaches nil must decode to `None`, not overflow the stack.
///
/// Unreachable from the compiler (a cons cell's tail points only at an EARLIER cell, so every
/// compiled chain is acyclic and terminates), but `tm::decode::decode_tape_ty` reads a heap that can
/// come from a hand-written `.tm` file's initial HEAP tape — i.e. from untrusted input. The
/// Value-directed `decode_asm` needs no such guard: it recurses on a finite reference `Value`.
#[test]
fn a_cyclic_heap_decodes_to_none_rather_than_overflowing() {
    use crate::ty::Ty;
    // Cell 1 = (7, 1): its tail points at itself.
    let o = AsmOutcome { result: 1, heap: vec![(7, 1)] };
    assert_eq!(decode_asm_ty(&o, &Ty::List(Box::new(Ty::Nat))), None);
    // A two-cell cycle: 1 -> 2 -> 1.
    let o2 = AsmOutcome { result: 1, heap: vec![(7, 2), (8, 1)] };
    assert_eq!(decode_asm_ty(&o2, &Ty::List(Box::new(Ty::Nat))), None);
}

/// The hardening must not change any acyclic answer — including a chain long enough that the old
/// recursive shape was the only thing under test.
#[test]
fn a_long_acyclic_list_still_decodes() {
    use crate::ty::Ty;
    // cell i (1-based) = (i, i-1), so the chain 1000 -> 999 -> … -> 1 -> nil.
    let heap: Vec<(u64, u64)> = (1..=1000u64).map(|i| (i, i - 1)).collect();
    let o = AsmOutcome { result: 1000, heap };
    let v = decode_asm_ty(&o, &Ty::List(Box::new(Ty::Nat))).expect("decodes");
    let mut n = 0u64;
    let mut cur = &v;
    while let Value::Cons(_, t) = cur {
        n += 1;
        cur = t;
    }
    assert_eq!(n, 1000);
    assert_eq!(cur, &Value::Nil);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::asm::tests::a_cyclic_heap_decodes_to_none_rather_than_overflowing`
Expected: FAIL — the process aborts with a stack overflow (`thread 'tm::asm::tests::a_cyclic_heap…' has overflowed its stack`), not a clean assertion failure. That abort **is** the failure signal for this test.

- [ ] **Step 3: Make `decode_word_ty` iterative on the list spine**

Replace `crates/redextape-core/src/tm/asm.rs`'s `fn decode_word_ty` (lines ~470-491) with:

```rust
/// Type-directed decode of one word. `pub(crate)` because `tm::decode` decodes the same
/// `(word, heap)` pair off a set of TAPES and must not carry a second copy of this logic.
///
/// Recursion here is on the TYPE (strictly smaller at each `List` element), never on the heap chain:
/// the list SPINE is a loop, bounded by one step per heap cell. That bound is what makes a cyclic
/// heap decode to `None` instead of overflowing the stack — a chain longer than the heap has cells
/// must have revisited one. It matters because `tm::decode::decode_tape_ty` reads a heap that can
/// come from a `.tm` FILE, where acyclicity is not something the compiler guaranteed.
pub(crate) fn decode_word_ty(word: u64, heap: &[(u64, u64)], ty: &Ty) -> Option<Value> {
    match ty {
        Ty::Nat => Some(Value::Nat(word)),
        Ty::Bool => match word {
            0 => Some(Value::Bool(false)),
            1 => Some(Value::Bool(true)),
            _ => None,
        },
        Ty::Unit => Some(Value::Unit),
        Ty::List(elem) => {
            // Walk the spine forwards collecting heads, then rebuild back-to-front. At most one step
            // per cell; falling out of the loop means the chain never reached nil, i.e. it is cyclic.
            let mut heads = Vec::new();
            let mut w = word;
            for _ in 0..=heap.len() {
                if w == 0 {
                    let mut out = Value::Nil;
                    for h in heads.into_iter().rev() {
                        out = Value::Cons(Rc::new(h), Rc::new(out));
                    }
                    return Some(out);
                }
                let &(h, t) = heap.get((w - 1) as usize)?;
                heads.push(decode_word_ty(h, heap, elem)?);
                w = t;
            }
            None
        }
        Ty::Fun(..) | Ty::Var(_) => None,
    }
}
```

- [ ] **Step 4: Run to verify both asm tests pass**

Run: `cargo test -p redextape-core --lib tm::asm`
Expected: PASS — including the pre-existing `decode_asm_ty_matches_decode_asm`, which must be unaffected.

- [ ] **Step 5: Write the failing tests for `decode_tape_ty`**

Add to `crates/redextape-core/src/tm/decode.rs`'s `mod tests`:

```rust
/// D6: the two decoders AGREE wherever both are defined…
#[test]
fn the_two_decoders_agree_on_nat_bool_and_a_non_empty_list() {
    use crate::ty::Ty;
    let enc = Unary::default();

    let prog = Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 2),
            Instr::Li(Reg::Loc(1), 3),
            Instr::Bin(BinOp::Add, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
            Instr::Halt,
        ],
        labels: vec![],
    };
    let t = run_to_tapes(&prog);
    assert_eq!(decode_tape(&t, &Value::Nat(0), &enc), decode_tape_ty(&t, &Ty::Nat, &enc));
    assert_eq!(decode_tape_ty(&t, &Ty::Nat, &enc), Some(Value::Nat(5)));

    let prog = Program {
        code: vec![
            Instr::Li(Reg::Loc(0), 2),
            Instr::Li(Reg::Loc(1), 2),
            Instr::Bin(BinOp::Eq, Reg::Rr, Reg::Loc(0), Reg::Loc(1)),
            Instr::Halt,
        ],
        labels: vec![],
    };
    let t = run_to_tapes(&prog);
    assert_eq!(decode_tape(&t, &Value::Bool(false), &enc), decode_tape_ty(&t, &Ty::Bool, &enc));

    let prog = Program {
        code: vec![
            Instr::Nil(Reg::Loc(0)),
            Instr::Li(Reg::Loc(1), 2),
            Instr::Cons(Reg::Loc(2), Reg::Loc(1), Reg::Loc(0)),
            Instr::Li(Reg::Loc(3), 1),
            Instr::Cons(Reg::Rr, Reg::Loc(3), Reg::Loc(2)),
            Instr::Halt,
        ],
        labels: vec![],
    };
    let t = run_to_tapes(&prog);
    let ty = Ty::List(Box::new(Ty::Nat));
    assert_eq!(decode_tape(&t, &Value::list_of_nats(&[1, 2]), &enc), decode_tape_ty(&t, &ty, &enc));
    assert_eq!(decode_tape_ty(&t, &ty, &enc), Some(Value::list_of_nats(&[1, 2])));
}

/// …and DISAGREE on exactly two cases, on purpose. Pinning the disagreements is the point: without
/// this test, re-expressing either decoder over the other later would pass every other test in the
/// tree while quietly loosening the oracle's list-LENGTH check.
#[test]
fn the_two_decoders_disagree_on_nil_and_unit_by_design() {
    use crate::ty::Ty;
    let enc = Unary::default();
    let t = run_to_tapes(&Program { code: vec![Instr::Nil(Reg::Rr), Instr::Halt], labels: vec![] });

    // A nil result under a one-element witness is a WRONG ANSWER the Value-directed decoder must
    // reject — that rejection is how the oracle catches a machine that returned a shorter list.
    assert_eq!(decode_tape(&t, &Value::list_of_nats(&[1]), &enc), None);
    // The Ty-directed decoder has no length to compare against; nil is a legitimate `List<Nat>`.
    assert_eq!(decode_tape_ty(&t, &Ty::List(Box::new(Ty::Nat)), &enc), Some(Value::Nil));

    // Unit is not a first-class tape value, so there is no `Value::Unit` witness to decode against…
    assert_eq!(decode_tape(&t, &Value::Unit, &enc), None);
    // …but a FILE may legitimately declare `result Unit`, and the word is then simply ignored.
    assert_eq!(decode_tape_ty(&t, &Ty::Unit, &enc), Some(Value::Unit));
}

/// A `.tm` file's initial HEAP is untrusted. A cyclic one must decode to `None`, not overflow.
#[test]
fn decode_tape_ty_survives_a_cyclic_heap_from_a_file() {
    use crate::ty::Ty;
    let enc = Unary::default();
    // REG: `# 1 #` -> slot 0 = pointer 1.  HEAP: `@ 1 # 1` -> cell 1 = (head 1, tail 1) — self-loop.
    let mut tapes = vec![Tape::new(&[]); TAPES];
    tapes[REG] = Tape::new(&[SEP, MARK, SEP]);
    tapes[HEAP] = Tape::new(&[AT, MARK, SEP, MARK]);
    assert_eq!(decode_tape_ty(&tapes, &Ty::List(Box::new(Ty::Nat)), &enc), None);
}
```

- [ ] **Step 6: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::decode`
Expected: FAIL — `cannot find function 'decode_tape_ty' in this scope`.

- [ ] **Step 7: Add the shared read and the sibling**

In `crates/redextape-core/src/tm/decode.rs`, add to the imports at the top:

```rust
use crate::tm::asm::decode_word_ty;
use crate::ty::Ty;
```

Then replace the existing `decode_tape` (lines 15-22) with:

```rust
/// The half of decoding that does not depend on WHAT is being decoded: the result word out of REG
/// slot 0 (`Rr`) and the cons cells out of HEAP, both read through `enc`. The two decoders below
/// share this and differ only in what they do with the pair.
fn read_result(tapes: &[Tape], enc: &dyn Encoding) -> Option<(u64, Vec<(u64, u64)>)> {
    let reg = tapes.get(REG)?.snapshot().0;
    let heap = enc.parse_heap_cells(&tapes.get(HEAP)?.snapshot().0);
    let word = enc.decode_nat(&reg, 0)?;
    Some((word, heap))
}

/// Decode the machine's final `tapes` to a `Value`, guided by `expected`'s SHAPE (never its contents).
/// The result word is REG slot 0 (`Rr`): a Nat/Bool value, or a list pointer into the HEAP.
pub fn decode_tape(tapes: &[Tape], expected: &Value, enc: &dyn Encoding) -> Option<Value> {
    let (word, heap) = read_result(tapes, enc)?;
    decode_word(word, &heap, expected)
}

/// Decode the final `tapes` against a TYPE rather than a `Value` shape witness — what a reader holding
/// only a `.tm` file has, since a file records its `result` type but has no reference run.
///
/// A SIBLING of `decode_tape`, not a replacement for it (spec D6). They share the tape read above and
/// nothing else, because they disagree on two cases on purpose: a nil result under a `Cons` witness,
/// and `Unit`. `decode_tape`'s strictness there is what makes the oracle catch a machine that returned
/// a SHORTER list than the reference, so it cannot be expressed over this one — and the reverse needs a
/// `Value -> Ty` function that is partial, since `Value::Nil` carries no recoverable element type.
/// `asm.rs` keeps `decode_asm` and `decode_asm_ty` side by side for the same reason.
pub fn decode_tape_ty(tapes: &[Tape], ty: &Ty, enc: &dyn Encoding) -> Option<Value> {
    let (word, heap) = read_result(tapes, enc)?;
    decode_word_ty(word, &heap, ty)
}
```

- [ ] **Step 8: Re-export from `tm.rs`**

In `crates/redextape-core/src/tm.rs`, change line 27:

```rust
pub use decode::{decode_tape, decode_tape_ty};
```

- [ ] **Step 9: Run the full suite**

Run: `cargo test -p redextape-core`
Expected: PASS. Note the baseline test count before this task and after; nothing should have gone from pass to fail.

- [ ] **Step 10: Commit**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/src/tm/decode.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): decode a final tape against a TYPE, and close the hole that opens

decode_tape_ty is what a reader holding only a .tm file has: no reference
run, so no Value witness. It sits BESIDE decode_tape over a shared tape
read rather than absorbing it — the two disagree on nil-under-a-Cons-witness
and on Unit, and decode_tape's strictness there is exactly what makes the
oracle catch a machine that returned a shorter list.

Reusing asm's decode_word_ty made a latent hole reachable: it recursed on
the heap chain under a type that never shrinks for List, so a CYCLIC heap
overflowed the stack. Unreachable while every heap came from the compiler
(a tail points only at an earlier cell); reachable the moment a heap can
come from a file. The spine is now a loop bounded by one step per cell, so
a cycle decodes to None."
```

---

### Task 3: `EncodingKind` and `TmHeader`

The data type and its semantics. No grammar yet — this task's deliverable is a `TmHeader` you can construct, ask for an `Encoding`, and ask for an initial tape vector.

**Files:**
- Create: `crates/redextape-core/src/tm/header.rs`
- Modify: `crates/redextape-core/src/tm.rs` (add `pub mod header;` and re-exports)
- Test: `crates/redextape-core/src/tm/header.rs` (inline)

**Interfaces:**
- Consumes: `Unary::at`, `Binary::at`, `Encoding`, `Ty`, `Symbol`, `build::{REG, WORK, STACK, HEAP, BOX}`.
- Produces:
  - `pub enum EncodingKind { Unary, Binary }` with `at(self, width: usize) -> Box<dyn Encoding>`, `name(self) -> &'static str`, `parse(s: &str) -> Option<EncodingKind>`
  - `pub struct TmHeader` with public fields `encoding: EncodingKind`, `width: usize`, `slots: u32`, `result: Ty`, and a **private** `tapes`
  - `TmHeader::new(encoding, width, slots, result, tapes: Vec<(usize, Vec<Symbol>)>) -> TmHeader`
  - `TmHeader::tapes(&self) -> &[(usize, Vec<Symbol>)]`
  - `TmHeader::encoding(&self) -> Box<dyn Encoding>`
  - `TmHeader::init(&self, n_tapes: usize) -> Vec<Vec<Symbol>>`
  - `pub(crate) fn tape_name(i: usize) -> Option<&'static str>`

**Deviation from the spec, and why:** the spec shows `pub tapes: Vec<(usize, Vec<Symbol>)>`. It is private here with an accessor, because `TmHeader::new` has to normalize it — empty tapes dropped, indices sorted — for property 2 (the round-trip) to hold exactly. An omitted `tape` line means "starts empty", so an explicitly-stored empty entry prints nothing and parses back to no entry, and `parse(print(h)) != h`. A public field would let a caller reintroduce that.

- [ ] **Step 1: Write the failing tests**

Create `crates/redextape-core/src/tm/header.rs` with only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::tm::build::{MAX_FIELD_WIDTH, TAPES};

    fn a_header() -> TmHeader {
        TmHeader::new(
            EncodingKind::Binary,
            16,
            3,
            Ty::List(Box::new(Ty::Nat)),
            vec![(REG, vec!['#', '0', '#']), (WORK, vec!['#', '0', '#'])],
        )
    }

    #[test]
    fn encoding_kind_names_round_trip() {
        for k in [EncodingKind::Unary, EncodingKind::Binary] {
            assert_eq!(EncodingKind::parse(k.name()), Some(k));
        }
        assert_eq!(EncodingKind::parse("ternary"), None);
        assert_eq!(EncodingKind::parse("Unary"), None); // names are lowercase
    }

    /// The kind names the encoding AND the width instantiates it — both halves must reach the
    /// `Encoding` you get back, or the recipe describes a different machine than it claims.
    #[test]
    fn encoding_kind_instantiates_the_named_encoding_at_the_given_width() {
        assert_eq!(EncodingKind::Unary.at(8).field_width(), Some(8));
        assert_eq!(EncodingKind::Binary.at(16).field_width(), Some(16));
        // The kinds are distinguishable through the trait: a zero bank differs between them.
        assert_ne!(EncodingKind::Unary.at(8).init_reg(1), EncodingKind::Binary.at(8).init_reg(1));
        // Both kinds are BOUNDED, which is why the producer in `tm.rs` needs no unbounded branch.
        assert!(EncodingKind::Unary.at(MAX_FIELD_WIDTH).field_width().is_some());
        assert!(EncodingKind::Binary.at(MAX_FIELD_WIDTH).field_width().is_some());
    }

    /// An omitted `tape` line means "starts empty", so an explicitly-empty entry is not
    /// representable in the text form. Normalizing it away at construction is what makes the
    /// round-trip (property 2) exact rather than approximate.
    #[test]
    fn construction_drops_empty_tapes_and_orders_the_rest() {
        let h = TmHeader::new(
            EncodingKind::Unary,
            8,
            1,
            Ty::Nat,
            vec![(HEAP, vec![]), (WORK, vec!['#']), (REG, vec!['#', '_'])],
        );
        assert_eq!(h.tapes(), &[(REG, vec!['#', '_']), (WORK, vec!['#'])]);
    }

    #[test]
    fn init_places_each_tape_at_its_index_and_leaves_the_rest_empty() {
        let init = a_header().init(TAPES);
        assert_eq!(init.len(), TAPES);
        assert_eq!(init[REG], vec!['#', '0', '#']);
        assert_eq!(init[WORK], vec!['#', '0', '#']);
        assert!(init[STACK].is_empty() && init[HEAP].is_empty() && init[BOX].is_empty());
    }

    /// `init` is asked for a tape count that comes from the FILE's `tapes N`, which need not match
    /// this compiler's `TAPES`. Out-of-range entries are dropped, not panicked on.
    #[test]
    fn init_is_total_for_any_tape_count() {
        assert_eq!(a_header().init(0).len(), 0);
        assert_eq!(a_header().init(1).len(), 1);
        assert_eq!(a_header().init(1)[0], vec!['#', '0', '#']);
        assert_eq!(a_header().init(64).len(), 64);
    }

    #[test]
    fn tape_names_cover_this_compilers_layout_and_nothing_else() {
        assert_eq!(tape_name(REG), Some("reg"));
        assert_eq!(tape_name(BOX), Some("box"));
        assert_eq!(tape_name(TAPES), None);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test -p redextape-core --lib tm::header`
Expected: FAIL — `file not found for module 'header'` (the module is not declared yet), or once declared, unresolved names.

- [ ] **Step 3: Implement the module**

Prepend to `crates/redextape-core/src/tm/header.rs` (above the test module):

```rust
//! What a `.tm` file records ABOUT its machine, as opposed to the machine itself.
//!
//! A Turing machine is a transition function plus an initial configuration. The text form serialized
//! only the first half: `print_tm` emits δ and q₀ and nothing about how the machine STARTS, so a
//! printed machine round-tripped faithfully as a machine and still could not be run or read back from
//! the file alone. `TmHeader` is the second half — the literal initial tapes, so any TM simulator can
//! run the file with no knowledge of this project's encodings, plus the `encoding`/`width`/`slots`/
//! `result` recipe needed to interpret the answer.
//!
//! **The header is OPTIONAL and adds no capability to the machine — it removes an INPUT requirement.**
//! `simulate(&m, &init, caps)` needs the caller to supply `init`; with a header, `init` can come from
//! the file instead. Nothing about δ, the start state, or execution changes, which is why a
//! header-less file stays exactly as runnable as it was.
//!
//! **Returned alongside a `Machine`, never stored on one.** `lower_tm.rs` states the rule twice:
//! `Machine` derives `PartialEq` and the round-trip asserts `parse_tm(print_tm(m)) == m`, which a
//! side-table field would break for a reason unrelated to what the machine computes.
//!
//! The one thing a header CANNOT do, stated here rather than discovered later: a foreign tool can RUN
//! a `.tm` file but cannot INTERPRET its result. Running is universal; interpreting needs the
//! encoding's semantics, and a name cannot convey them.

use crate::tm::build::{BOX, HEAP, REG, STACK, WORK};
use crate::tm::encoding::{Binary, Encoding, Unary};
use crate::tm::machine::Symbol;
use crate::ty::Ty;

/// Which `Encoding` a file names.
///
/// **This enum and `parse` below are the one new registration point this slice introduces:** adding a
/// third encoding means adding a variant here and a name there. That is inherent to any format that
/// names its variants — it is a small, obvious edit, but it is a place a future encoding must be
/// registered, and nothing else will remind you.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EncodingKind {
    Unary,
    Binary,
}

impl EncodingKind {
    /// This kind instantiated at `width` cells. Both kinds are BOUNDED (`field_width()` is always
    /// `Some`), which is why the producer in `tm.rs` needs no unbounded early-return branch the way
    /// `run_tm_fitted` does — an unbounded encoding has no name in this enum to write in a file.
    pub fn at(self, width: usize) -> Box<dyn Encoding> {
        match self {
            EncodingKind::Unary => Box::new(Unary::at(width)),
            EncodingKind::Binary => Box::new(Binary::at(width)),
        }
    }

    /// The name written in an `encoding` directive. Lowercase, matching the rest of the text form's
    /// keywords (`tapes`, `start`, `state`, `accept`).
    pub fn name(self) -> &'static str {
        match self {
            EncodingKind::Unary => "unary",
            EncodingKind::Binary => "binary",
        }
    }

    /// The inverse of `name`. `None` for an unrecognized name, which the parser reports as a
    /// diagnostic rather than defaulting — a file naming an encoding this build does not have is
    /// unreadable, and guessing would decode its tape as something else entirely.
    pub fn parse(s: &str) -> Option<EncodingKind> {
        match s {
            "unary" => Some(EncodingKind::Unary),
            "binary" => Some(EncodingKind::Binary),
            _ => None,
        }
    }
}

/// This compiler's name for tape `i`, used only for the trailing comment on a `tape` line.
///
/// Tapes are addressed by INDEX in the format (spec D3): names are this compiler's convention, not a
/// property of a Turing machine, and a generic simulator knows only indices. `None` for an index
/// outside this layout, which a file with a larger `tapes N` may legitimately have.
pub(crate) fn tape_name(i: usize) -> Option<&'static str> {
    match i {
        REG => Some("reg"),
        WORK => Some("work"),
        STACK => Some("stack"),
        HEAP => Some("heap"),
        BOX => Some("box"),
        _ => None,
    }
}

/// The header of a `.tm` file. See the module doc for why this is not a field on `Machine`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TmHeader {
    /// Which encoding reads this machine's tapes.
    pub encoding: EncodingKind,
    /// Field width in CELLS. What a field of that many cells can HOLD is the encoding's business
    /// (`v < width` for unary, `v < 2^width` for binary).
    pub width: usize,
    /// REG bank field count.
    pub slots: u32,
    /// The type the final tape decodes to. Only `Nat`/`Bool`/`Unit`/`List<T>` are admissible.
    pub result: Ty,
    /// Literal initial contents by tape INDEX, ascending, with EMPTY TAPES OMITTED. Private because
    /// `new` maintains that normal form and the round-trip depends on it — see `new`.
    tapes: Vec<(usize, Vec<Symbol>)>,
}

impl TmHeader {
    /// Build a header, normalizing `tapes` into the form the text output can represent exactly:
    /// empty tapes dropped, indices ascending, duplicates collapsed to the first.
    ///
    /// The normalization is not cosmetic. An omitted `tape` line MEANS "this tape starts empty"
    /// (which is how HEAP, STACK and BOX always start), so an explicitly-stored empty entry prints
    /// nothing and parses back to no entry — and `parse_tm_full(print_tm_with(m, h))` would return a
    /// header unequal to `h`, breaking optionality property 2 over a difference that carries no
    /// information. Normalizing at construction makes the round-trip exact instead of approximate.
    pub fn new(
        encoding: EncodingKind,
        width: usize,
        slots: u32,
        result: Ty,
        tapes: Vec<(usize, Vec<Symbol>)>,
    ) -> TmHeader {
        let mut tapes: Vec<(usize, Vec<Symbol>)> = tapes.into_iter().filter(|(_, c)| !c.is_empty()).collect();
        tapes.sort_by_key(|(i, _)| *i);
        tapes.dedup_by_key(|(i, _)| *i); // duplicates are sorted adjacent, so this keeps the first
        TmHeader { encoding, width, slots, result, tapes }
    }

    /// The literal initial tapes, by index, ascending, empties omitted.
    pub fn tapes(&self) -> &[(usize, Vec<Symbol>)] {
        &self.tapes
    }

    /// The `Encoding` instance this header names, at its width. This is the half a foreign reader
    /// cannot reproduce — it needs the implementations, which the header names but cannot inline.
    pub fn encoding(&self) -> Box<dyn Encoding> {
        self.encoding.at(self.width)
    }

    /// The initial tape vector to hand `simulate`, from the literal `tape` lines. `n_tapes` comes
    /// from the file's `tapes N`. Total: entries outside `0..n_tapes` are dropped rather than
    /// panicked on, so a header and a tape count that disagree still yield a runnable configuration.
    pub fn init(&self, n_tapes: usize) -> Vec<Vec<Symbol>> {
        let mut init = vec![Vec::new(); n_tapes];
        for (i, cells) in &self.tapes {
            if let Some(slot) = init.get_mut(*i) {
                *slot = cells.clone();
            }
        }
        init
    }
}
```

- [ ] **Step 4: Declare the module and re-export**

In `crates/redextape-core/src/tm.rs`, add `pub mod header;` to the module list (alphabetically, after `pub mod encoding;`) and add a re-export line after the `decode` one:

```rust
pub use header::{EncodingKind, TmHeader};
```

- [ ] **Step 5: Run to verify the tests pass**

Run: `cargo test -p redextape-core --lib tm::header`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/tm/header.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): the header type — what a .tm file records ABOUT its machine

A Turing machine is a transition function plus an initial configuration;
the text form serialized only the first half. TmHeader is the second: the
literal initial tapes, so any simulator can run the file, plus the
encoding/width/slots/result recipe needed to interpret the answer.

Not a field on Machine — lower_tm states the rule twice, and PartialEq plus
the round-trip is why.

`tapes` is private with a normalizing constructor. An omitted tape line
MEANS 'starts empty', so an explicitly-empty entry is not representable;
storing one would break the round-trip over a difference carrying no
information."
```

---

### Task 4: Printing — `print_header` and `print_tm_with`

**Files:**
- Modify: `crates/redextape-core/src/tm/header.rs` (add `print_header`, `print_cells`)
- Modify: `crates/redextape-core/src/tm/syntax.rs` (add `print_tm_with`, refactor `print_tm`)
- Modify: `crates/redextape-core/src/tm.rs` (re-export `print_tm_with`)
- Test: both files, inline

**Interfaces:**
- Consumes: `TmHeader`, `EncodingKind::name`, `tape_name`, `ty::show`.
- Produces:
  - `pub(crate) fn print_header(h: &TmHeader) -> String` (in `tm::header`)
  - `pub fn print_tm_with(m: &Machine, h: &TmHeader) -> String` (in `tm::syntax`, re-exported from `tm`)

- [ ] **Step 1: Write the failing tests**

Add to `crates/redextape-core/src/tm/header.rs`'s `mod tests`:

```rust
/// The header's canonical text. Order is FIXED even though the parser accepts any order — printing
/// has to pick one, and a fixed one is what makes re-printing a re-parse idempotent.
#[test]
fn print_header_is_a_stable_listing_with_packed_tapes_and_named_comments() {
    let h = TmHeader::new(
        EncodingKind::Binary,
        4,
        2,
        Ty::List(Box::new(Ty::Nat)),
        vec![(REG, vec!['#', '0', '0', '0', '0', '#']), (WORK, vec!['#', '0', '0', '0', '0', '#'])],
    );
    let expected = "\
encoding binary
width 4
slots 2
result List<Nat>
tape 0 #0000#  ; reg
tape 1 #0000#  ; work
";
    assert_eq!(print_header(&h), expected);
}

/// D4: cells are PACKED, not space-separated. Rules use space-separated symbol lists because a
/// rule's entries may be the wildcard `*`; a tape has no wildcards and `Symbol` is a `char`, so
/// packing keeps a 120-cell bank on one readable line.
#[test]
fn tape_cells_are_packed_not_space_separated() {
    let h = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(REG, vec!['#', '_', '_', '_', '_', '#'])]);
    assert!(print_header(&h).contains("tape 0 #____#"), "got:\n{}", print_header(&h));
    assert!(!print_header(&h).contains("# _ _"), "cells must not be space-separated");
}

/// A tape with no name still prints — the comment is a courtesy, the index is the address (D3).
#[test]
fn a_tape_beyond_this_compilers_layout_prints_without_a_comment() {
    let h = TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(9, vec!['#'])]);
    assert!(print_header(&h).contains("tape 9 #\n"), "got:\n{}", print_header(&h));
}
```

Add to `crates/redextape-core/src/tm/syntax.rs`'s `mod tests`:

```rust
use crate::tm::header::{EncodingKind, TmHeader};
use crate::ty::Ty;

fn a_header() -> TmHeader {
    TmHeader::new(EncodingKind::Unary, 4, 1, Ty::Nat, vec![(0, vec!['#', '_', '_', '_', '_', '#'])])
}

/// `print_tm_with` is `print_tm` plus a header block, in that exact position: after `start`, before
/// the blank line that precedes the states.
#[test]
fn print_tm_with_inserts_the_header_after_start() {
    let expected = "\
tapes 1
start scan
encoding unary
width 4
slots 1
result Nat
tape 0 #____#  ; reg

state scan:
  [1] -> write [*], move [R], goto scan
  [*] -> write [1], move [S], goto halt
state halt: accept
";
    assert_eq!(print_tm_with(&increment(), &a_header()), expected);
}

/// GLOBAL CONSTRAINT: `print_tm`'s output is byte-identical to before this slice. The check is that
/// removing the header from `print_tm_with`'s output recovers it exactly — if the two printers had
/// been allowed to drift, this is what catches it.
#[test]
fn print_tm_output_is_unchanged_by_the_header_split() {
    let m = increment();
    let plain = print_tm(&m);
    let headered = print_tm_with(&m, &a_header());
    let stripped: String = headered
        .lines()
        .filter(|l| {
            !["encoding ", "width ", "slots ", "result ", "tape "].iter().any(|p| l.starts_with(p))
        })
        .map(|l| format!("{l}\n"))
        .collect();
    assert_eq!(stripped, plain);
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::header tm::syntax`
Expected: FAIL — `cannot find function 'print_header'`, `cannot find function 'print_tm_with'`.

- [ ] **Step 3: Implement `print_header` in `header.rs`**

Add to `crates/redextape-core/src/tm/header.rs`, after the `impl TmHeader` block:

```rust
use crate::ty::show;
use std::fmt::Write as _;

/// Render `h`'s directives, one per line, ending in a newline. Emitted between `start` and the states
/// by `syntax::print_tm_with`.
///
/// The order — `encoding`, `width`, `slots`, `result`, then `tape` lines ascending — is FIXED, even
/// though the parser accepts any order. A printer has to choose one, and a fixed choice is what makes
/// re-printing a re-parse idempotent.
///
/// KNOWN LIMIT: a tape cell equal to `;` would open a comment and not round-trip. No `Encoding` in
/// this tree writes one — the tape alphabet is `_ # 1 0 @` — and `Machine::validate()` already
/// reserves `;`. A hand-built machine using `;` as a data symbol is outside the representable subset
/// the text form is specified for, the same as one whose state name contains a space.
pub(crate) fn print_header(h: &TmHeader) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "encoding {}", h.encoding.name());
    let _ = writeln!(out, "width {}", h.width);
    let _ = writeln!(out, "slots {}", h.slots);
    let _ = writeln!(out, "result {}", show(&h.result));
    for (i, cells) in &h.tapes {
        let packed: String = cells.iter().collect();
        match tape_name(*i) {
            Some(name) => {
                let _ = writeln!(out, "tape {i} {packed}  ; {name}");
            }
            None => {
                let _ = writeln!(out, "tape {i} {packed}");
            }
        }
    }
    out
}
```

- [ ] **Step 4: Implement `print_tm_with` in `syntax.rs`**

In `crates/redextape-core/src/tm/syntax.rs`, add the import:

```rust
use crate::tm::header::{TmHeader, print_header};
```

Replace `print_tm` (lines 43-67) with:

```rust
/// Render `m` as the readable TM text form, with NO header. Byte-identical to what this function has
/// always emitted — a machine printed without a header must stay exactly as readable, and as
/// parseable, as it was before headers existed.
pub fn print_tm(m: &Machine) -> String {
    print_tm_inner(m, "")
}

/// Render `m` with `h`'s directives between `start` and the states. The result is a complete,
/// self-describing `.tm` file: a reader can build the initial configuration and simulate it with no
/// knowledge of this project, and decode the answer given the encoding implementations.
pub fn print_tm_with(m: &Machine, h: &TmHeader) -> String {
    print_tm_inner(m, &print_header(h))
}

/// The one printer. `header` is either empty or a block of directives ending in a newline; it is the
/// ONLY difference between the two entry points above, which is what keeps them from drifting.
fn print_tm_inner(m: &Machine, header: &str) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "tapes {}", m.tapes);
    let _ = writeln!(out, "start {}", state_name(m, m.start));
    out.push_str(header);
    let _ = writeln!(out);
    for s in &m.states {
        if s.accept {
            let _ = writeln!(out, "state {}: accept", s.name);
        } else {
            let _ = writeln!(out, "state {}:", s.name);
            for r in &s.rules {
                let _ = writeln!(
                    out,
                    "  [{}] -> write [{}], move [{}], goto {}",
                    syms_str(&r.read),
                    syms_str(&r.write),
                    moves_str(&r.moves),
                    state_name(m, r.next),
                );
            }
        }
    }
    out
}
```

- [ ] **Step 5: Re-export from `tm.rs`**

In `crates/redextape-core/src/tm.rs`, change the `syntax` re-export line:

```rust
pub use syntax::{parse_tm, print_tm, print_tm_with};
```

- [ ] **Step 6: Run the tests**

Run: `cargo test -p redextape-core --lib tm::header tm::syntax`
Expected: PASS — including the pre-existing `print_tm_is_a_stable_readable_listing`, which pins `print_tm`'s exact bytes and must not have moved.

- [ ] **Step 7: Commit**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/tm/header.rs crates/redextape-core/src/tm/syntax.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): print a header, without disturbing the printer that has none

print_tm and print_tm_with are one function differing only in a header
string, so the two cannot drift. print_tm's bytes are unchanged, which the
pre-existing listing golden pins and a new test re-derives by stripping the
directives back out.

Tapes are addressed by index with the name as a comment (D3): names are
this compiler's convention, not a property of a Turing machine, and a
generic simulator knows only indices. Cells are packed (D4) — a tape has no
wildcards, so the space-separated form rules need buys nothing and costs a
120-cell bank its single line."
```

---

### Task 5: Parsing — `parse_tm_full`, and `parse_tm` as a wrapper

Spec D2: one parser. `parse_tm` **must** learn to skip header directives regardless, or it hits its unknown-line error path and rejects any file carrying one. Given that it must change, delegating removes the failure mode where two parsers drift.

**Files:**
- Modify: `crates/redextape-core/src/tm/header.rs` (add `HeaderParts` and `parse_cells`)
- Modify: `crates/redextape-core/src/tm/syntax.rs:137-262` (the parse loop)
- Modify: `crates/redextape-core/src/tm.rs` (re-export `parse_tm_full`)
- Test: both files, inline

**Interfaces:**
- Consumes: `TmHeader::new`, `EncodingKind::parse`, `ty::parse_ty`, `Diagnostic`, `Span`.
- Produces:
  - `pub(crate) struct HeaderParts` with `Default`, `pub(crate) fn directive(&mut self, key: &str, rest: &str, span: Span) -> Option<Result<(), String>>`, `pub(crate) fn finish(self, n_tapes: usize, span: Span) -> (Option<TmHeader>, Vec<String>)`
  - `pub(crate) fn parse_cells(s: &str) -> Vec<Symbol>` (in `tm::header`)
  - `pub fn parse_tm_full(src: &str) -> (Option<Machine>, Option<TmHeader>, Vec<Diagnostic>)` (in `tm::syntax`, re-exported from `tm`)

- [ ] **Step 1: Write the failing tests — the four optionality properties plus the grammar**

Add to `crates/redextape-core/src/tm/syntax.rs`'s `mod tests`:

```rust
/// PROPERTY 1: today's round-trip, untouched.
#[test]
fn property_1_plain_round_trip_is_untouched() {
    let m = increment();
    assert_eq!(parse_tm(&print_tm(&m)), (Some(m), vec![]));
}

/// PROPERTY 2: the new round-trip. A header printed is a header parsed back, equal.
#[test]
fn property_2_headered_round_trip_returns_both_halves() {
    let (m, h) = (increment(), a_header());
    let (pm, ph, ds) = parse_tm_full(&print_tm_with(&m, &h));
    assert!(ds.is_empty(), "diagnostics: {ds:?}");
    assert_eq!(pm, Some(m));
    assert_eq!(ph, Some(h));
}

/// PROPERTY 3: a headered file still reads as a plain machine. `parse_tm` must SKIP the directives,
/// not reject them — without this it hits its unknown-line error path on any file carrying a header.
#[test]
fn property_3_a_headered_file_still_parses_as_a_plain_machine() {
    let m = increment();
    assert_eq!(parse_tm(&print_tm_with(&m, &a_header())), (Some(m), vec![]));
}

/// PROPERTY 4: a header-less file yields NO HEADER, NOT AN ERROR.
///
/// This is the property most likely to regress silently, because a parser taught to recognize
/// directives is a parser that can start requiring them. Every file written before this slice looks
/// like this one.
#[test]
fn property_4_a_headerless_file_yields_none_not_a_diagnostic() {
    let m = increment();
    let (pm, ph, ds) = parse_tm_full(&print_tm(&m));
    assert_eq!(pm, Some(m));
    assert_eq!(ph, None);
    assert!(ds.is_empty(), "a missing header is not an error, got: {ds:?}");
}

/// `tapes N` and `tape I …` are told apart by the MANDATORY SPACE in each keyword, not by dispatch
/// order: `"tape 0 …".strip_prefix("tapes ")` fails at position 4 (`s` vs ` `) and the reverse fails
/// too. This test is what fails if either prefix ever loses its space.
#[test]
fn tapes_and_tape_are_distinguished_by_the_mandatory_space() {
    let src = "\
tapes 1
start s
encoding unary
width 4
slots 1
result Nat
tape 0 #____#

state s: accept
";
    let (m, h, ds) = parse_tm_full(src);
    assert!(ds.is_empty(), "diagnostics: {ds:?}");
    assert_eq!(m.expect("a machine").tapes, 1, "`tapes 1` must set the tape COUNT");
    assert_eq!(h.expect("a header").tapes(), &[(0, vec!['#', '_', '_', '_', '_', '#'])]);
}

/// A PARTIAL header is a diagnostic naming what is missing — not a `None`. Silently discarding a
/// half-written header would turn a typo into "this file has no header".
#[test]
fn a_partial_header_names_the_missing_directives() {
    let src = "tapes 1\nstart s\nencoding unary\nwidth 4\n\nstate s: accept\n";
    let (m, h, ds) = parse_tm_full(src);
    assert!(m.is_none(), "an error gate must suppress the machine too");
    assert!(h.is_none());
    let joined = ds.iter().map(|d| d.message.clone()).collect::<Vec<_>>().join(" | ");
    assert!(joined.contains("slots") && joined.contains("result"), "must name both: {joined}");
    assert!(!joined.contains("encoding") && !joined.contains("width"), "must not name present ones: {joined}");
}

/// `tape` lines with none of the four header directives would otherwise be SILENTLY DROPPED — the
/// same data loss the partial-header rule exists to prevent.
#[test]
fn tape_lines_without_a_header_are_a_diagnostic_not_silent_data_loss() {
    let src = "tapes 1\nstart s\ntape 0 #____#\n\nstate s: accept\n";
    let (_, h, ds) = parse_tm_full(src);
    assert!(h.is_none());
    assert!(ds.iter().any(|d| d.message.contains("tape")), "{ds:?}");
}

#[test]
fn malformed_header_directives_are_spanned_diagnostics_never_panics() {
    // Each case is a COMPLETE header with exactly one thing wrong. Building them by APPENDING a bad
    // line to a valid header would test something else entirely: every bad line would be a second
    // directive of its own key, so all of them would hit the duplicate arm and none would reach the
    // validation under test.
    let cases: &[(&str, &str)] = &[
        ("encoding ternary\nwidth 4\nslots 1\nresult Nat", "ternary"),
        ("encoding unary\nwidth 0\nslots 1\nresult Nat", "width"),
        ("encoding unary\nwidth -1\nslots 1\nresult Nat", "width"),
        ("encoding unary\nwidth nine\nslots 1\nresult Nat", "width"),
        ("encoding unary\nwidth 4\nslots nine\nresult Nat", "slots"),
        // D5: a well-formed type that is not a first-class tape value.
        ("encoding unary\nwidth 4\nslots 1\nresult (Nat) -> Bool", "result"),
        ("encoding unary\nwidth 4\nslots 1\nresult Wobble", "result"),
        // Index >= the file's `tapes 1`. Checked after the loop, since directives are order-independent.
        ("encoding unary\nwidth 4\nslots 1\nresult Nat\ntape 9 #____#", "out of range"),
        ("encoding unary\nwidth 4\nslots 1\nresult Nat\ntape x #____#", "tape"),
        ("encoding unary\nencoding binary\nwidth 4\nslots 1\nresult Nat", "duplicate"),
        ("encoding unary\nwidth 4\nwidth 8\nslots 1\nresult Nat", "duplicate"),
        ("encoding unary\nwidth 4\nslots 1\nresult Nat\ntape 0 #_#\ntape 0 #_#", "duplicate"),
    ];
    for (header, needle) in cases {
        let src = format!("tapes 1\nstart s\n{header}\n\nstate s: accept\n");
        let (m, h, ds) = parse_tm_full(&src);
        assert!(
            ds.iter().any(|d| d.message.contains(needle)),
            "expected a diagnostic mentioning {needle:?} for:\n{header}\ngot {ds:?}"
        );
        assert!(m.is_none() && h.is_none(), "an error gate must suppress both halves for:\n{header}");
        for d in &ds {
            assert!(d.span.start <= d.span.end && d.span.end <= src.len(), "bad span for:\n{header}");
        }
    }
}

#[test]
fn header_directives_are_order_independent() {
    let a = "tapes 1\nstart s\nencoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n";
    let b = "tapes 1\nresult Nat\nslots 1\nstart s\nwidth 4\nencoding unary\n\nstate s: accept\n";
    let (_, ha, _) = parse_tm_full(a);
    let (_, hb, _) = parse_tm_full(b);
    assert_eq!(ha, hb);
    assert!(ha.is_some());
}

#[test]
fn headered_garbage_never_panics() {
    for src in [
        "encoding\n", "width\n", "slots\n", "result\n", "tape\n", "tape 0\n",
        "encoding unary\n", "tapes 1\nstart s\nresult List<\n\nstate s: accept\n",
    ] {
        let _ = parse_tm_full(src); // must return, never panic
    }
}
```

Add to `crates/redextape-core/src/tm/header.rs`'s `mod tests`:

```rust
/// `parse_cells` is the inverse of the packed printing, and it stops at a comment.
#[test]
fn parse_cells_unpacks_and_stops_at_a_comment() {
    assert_eq!(parse_cells("#____#"), vec!['#', '_', '_', '_', '_', '#']);
    assert_eq!(parse_cells("#0000#  ; reg"), vec!['#', '0', '0', '0', '0', '#']);
    assert_eq!(parse_cells("   #1#   "), vec!['#', '1', '#']);
    assert_eq!(parse_cells(""), Vec::<Symbol>::new());
    assert_eq!(parse_cells("; only a comment"), Vec::<Symbol>::new());
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p redextape-core --lib tm::syntax tm::header`
Expected: FAIL — `cannot find function 'parse_tm_full'`, `cannot find function 'parse_cells'`.

- [ ] **Step 3: Add `parse_cells` and `HeaderParts` to `header.rs`**

Append to `crates/redextape-core/src/tm/header.rs` (above the test module):

```rust
/// Unpack a `tape` line's cell run: strip a trailing `;` comment, trim, and take one `Symbol` per
/// char. The inverse of `print_header`'s packing (D4).
pub(crate) fn parse_cells(s: &str) -> Vec<Symbol> {
    s.split(';').next().unwrap_or("").trim().chars().collect()
}

/// The header directives seen so far, accumulated across the parse loop so they can arrive in any
/// order. `finish` decides whether they amount to a header, a diagnostic, or nothing at all.
#[derive(Default)]
pub(crate) struct HeaderParts {
    encoding: Option<EncodingKind>,
    width: Option<usize>,
    slots: Option<u32>,
    result: Option<Ty>,
    tapes: Vec<(usize, Vec<Symbol>)>,
    /// Whether any `tape` line was seen. Tracked separately from `tapes` because a `tape` line that
    /// FAILED to parse still means the file was trying to carry a header, and `finish` must not then
    /// report "no header".
    saw_tape: bool,
}

impl HeaderParts {
    /// Offer one non-comment line's `key` and remainder. Returns `None` if `key` is not a header
    /// directive (the caller keeps looking), `Some(Ok(()))` if it was consumed, `Some(Err(msg))` if it
    /// was a header directive that did not parse.
    ///
    /// A DUPLICATE directive is an error rather than last-wins: two disagreeing `width` lines have no
    /// defensible winner, and picking one silently would decode the tape against a recipe the file
    /// does not unambiguously state.
    pub(crate) fn directive(&mut self, key: &str, rest: &str) -> Option<Result<(), String>> {
        let val = rest.split(';').next().unwrap_or("").trim();
        match key {
            "encoding" => Some(match (self.encoding, EncodingKind::parse(val)) {
                (Some(_), _) => Err("duplicate `encoding` directive".into()),
                (None, Some(k)) => {
                    self.encoding = Some(k);
                    Ok(())
                }
                (None, None) => Err(format!("unknown `encoding` name `{val}` (expected `unary` or `binary`)")),
            }),
            "width" => Some(match (self.width, val.parse::<usize>()) {
                (Some(_), _) => Err("duplicate `width` directive".into()),
                (None, Ok(n)) if n >= 1 => {
                    self.width = Some(n);
                    Ok(())
                }
                (None, _) => Err(format!("expected `width <positive integer>`, found `{val}`")),
            }),
            "slots" => Some(match (self.slots, val.parse::<u32>()) {
                (Some(_), _) => Err("duplicate `slots` directive".into()),
                (None, Ok(n)) => {
                    self.slots = Some(n);
                    Ok(())
                }
                (None, Err(_)) => Err(format!("expected `slots <integer>`, found `{val}`")),
            }),
            "result" => Some(match (&self.result, parse_ty(val)) {
                (Some(_), _) => Err("duplicate `result` directive".into()),
                (None, Some(t)) => {
                    self.result = Some(t);
                    Ok(())
                }
                // D5: `Fun`/`Var` are well-formed types that are not first-class tape values, so a
                // file naming one is rejected where it is WRITTEN rather than decoding to a silent
                // `None` where it is read.
                (None, None) => {
                    Err(format!("`result` must be a value type (Nat | Bool | Unit | List<T>), found `{val}`"))
                }
            }),
            "tape" => {
                self.saw_tape = true;
                let Some((idx, cells)) = val.split_once(' ') else {
                    return Some(Err(format!("expected `tape <index> <cells>`, found `tape {val}`")));
                };
                Some(match idx.trim().parse::<usize>() {
                    Err(_) => Err(format!("expected `tape <index> <cells>`, found index `{idx}`")),
                    Ok(i) if self.tapes.iter().any(|(j, _)| *j == i) => {
                        Err(format!("duplicate `tape {i}` directive"))
                    }
                    Ok(i) => {
                        self.tapes.push((i, parse_cells(cells)));
                        Ok(())
                    }
                })
            }
            _ => None,
        }
    }

    /// Decide what the accumulated directives amount to, given the file's declared `n_tapes`.
    ///
    /// - **Zero of the four present** (and no `tape` line) -> `(None, [])`: the file has no header,
    ///   which is not an error. This is optionality property 4, and it is what every file written
    ///   before this slice looks like.
    /// - **All four present** -> a validated header.
    /// - **One to three present** -> `(None, [msg])` naming the missing ones. Not a silent `None`,
    ///   because discarding a half-written header would turn a typo into "this file has no header".
    /// - **`tape` lines but none of the four** -> an error for the same reason: the tape data would
    ///   otherwise vanish without a word.
    pub(crate) fn finish(self, n_tapes: usize) -> (Option<TmHeader>, Vec<String>) {
        let missing: Vec<&str> = [
            ("encoding", self.encoding.is_none()),
            ("width", self.width.is_none()),
            ("slots", self.slots.is_none()),
            ("result", self.result.is_none()),
        ]
        .into_iter()
        .filter_map(|(name, absent)| absent.then_some(name))
        .collect();

        if missing.len() == 4 {
            return if self.saw_tape {
                (None, vec!["`tape` directives without a header (needs `encoding`, `width`, `slots`, `result`)".into()])
            } else {
                (None, Vec::new()) // no header, no diagnostic
            };
        }
        if !missing.is_empty() {
            return (None, vec![format!("incomplete header: missing {}", missing.join(", "))]);
        }

        // The range check lives HERE, not in `directive`, because directives are order-independent:
        // a `tape 7` line may precede the `tapes 5` that makes it out of range.
        let mut errs = Vec::new();
        for (i, _) in &self.tapes {
            if *i >= n_tapes {
                errs.push(format!("`tape {i}` is out of range for `tapes {n_tapes}`"));
            }
        }
        if !errs.is_empty() {
            return (None, errs);
        }
        let (encoding, width) = (self.encoding.unwrap(), self.width.unwrap());
        let (slots, result) = (self.slots.unwrap(), self.result.unwrap());
        (Some(TmHeader::new(encoding, width, slots, result, self.tapes)), Vec::new())
    }
}
```

Add `use crate::ty::parse_ty;` to `header.rs`'s imports.

- [ ] **Step 4: Rewrite the parse loop in `syntax.rs`**

In `crates/redextape-core/src/tm/syntax.rs`, extend the import to:

```rust
use crate::tm::header::{HeaderParts, TmHeader, print_header};
```

Replace the `pub fn parse_tm` signature line and its body's opening (lines 136-141) with:

```rust
/// Parse the TM text form, dropping any header. Unchanged in signature and behaviour: a file with a
/// header still reads as the machine it describes (optionality property 3).
///
/// A thin wrapper over `parse_tm_full` rather than a second parser (spec D2). This is not an
/// aesthetic preference: `parse_tm` MUST be taught to skip header directives regardless, or it hits
/// its unknown-line error path and rejects any file carrying one. Given that it must change, having
/// it delegate removes the failure mode where two parsers drift.
pub fn parse_tm(src: &str) -> (Option<Machine>, Vec<Diagnostic>) {
    let (m, _, ds) = parse_tm_full(src);
    (m, ds)
}

/// Parse the TM text form, returning the header too. Iterative (flat grammar, no recursion). Never
/// panics.
///
/// A `None` header means the file carried none, which is NOT an error — see `HeaderParts::finish`.
pub fn parse_tm_full(src: &str) -> (Option<Machine>, Option<TmHeader>, Vec<Diagnostic>) {
    let mut diags: Vec<Diagnostic> = Vec::new();
    let mut tapes: Option<usize> = None;
    let mut start_name: Option<(String, Span)> = None;
    let mut states: Vec<RawState> = Vec::new();
    let mut header = HeaderParts::default();
```

Inside the line loop, insert the header branch **after** the `tapes ` branch and **before** the `start ` branch (position is for readability; the mandatory space in each keyword is what actually disambiguates):

```rust
        } else if let Some((key, rest)) = trimmed.split_once(' ').filter(|(k, _)| {
            matches!(*k, "encoding" | "width" | "slots" | "result" | "tape")
        }) {
            match header.directive(key, rest) {
                Some(Err(msg)) => diags.push(err(span, msg)),
                Some(Ok(())) | None => {}
            }
```

Then, in the post-loop section, after `tapes` is unwrapped (i.e. after the existing `let Some(tapes) = tapes else { … };` block) add:

```rust
    let (parsed_header, header_errs) = header.finish(tapes);
    for msg in header_errs {
        diags.push(err(Span { start: 0, end: 0 }, msg));
    }
```

Change the error gate and the two returns:

```rust
    if diags.iter().any(|d| d.severity == Severity::Error) {
        return (None, None, diags);
    }
```

and the final return:

```rust
    (Some(machine), parsed_header, diags)
```

And the early return for a missing `tapes`:

```rust
    let Some(tapes) = tapes else {
        diags.push(err(Span { start: 0, end: 0 }, "missing `tapes <n>`"));
        return (None, None, diags);
    };
```

- [ ] **Step 5: Re-export from `tm.rs`**

```rust
pub use syntax::{parse_tm, parse_tm_full, print_tm, print_tm_with};
```

- [ ] **Step 6: Run the tests**

Run: `cargo test -p redextape-core --lib tm::syntax tm::header`
Expected: PASS — including every pre-existing `syntax` test (`garbage_never_panics`, `unknown_goto_target_is_a_spanned_error`, `compiled_machines_round_trip_through_the_text_form`, …). Any of those going red means `parse_tm`'s behaviour changed, which the global constraints forbid.

- [ ] **Step 7: Run the whole suite**

Run: `cargo test -p redextape-core`
Expected: PASS. `tests/tm_machine.rs`'s `author_simulate_and_round_trip_a_machine` and `malformed_tm_text_yields_diagnostics_not_a_panic` are the external check on `parse_tm`.

- [ ] **Step 8: Commit**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/tm/header.rs crates/redextape-core/src/tm/syntax.rs crates/redextape-core/src/tm.rs
git commit -m "feat(tm): one parser, and a header that is optional in all four directions

parse_tm had to learn to SKIP header directives regardless — otherwise its
unknown-line path rejects any file carrying one. Since it had to change, it
delegates instead of duplicating, so two parsers cannot drift.

The four optionality properties each get a test. Property 4 — a header-less
file yields None, NOT a diagnostic — is the one that regresses silently,
because a parser taught to recognize directives is a parser that can start
requiring them.

Two cases the spec left open, resolved toward not losing data: a partial
header names what is missing rather than being discarded, and `tape` lines
with no header set are an error rather than silently dropped."
```

---

### Task 6: The producer, the consistency check, and the file → value test

This is where the slice's goal becomes a fact rather than a claim. **Everything here turns on one thing: the header's literal tapes must be captured from the initial configuration the simulation ACTUALLY used, never re-derived from the header's own fields.** Re-deriving them makes the consistency check vacuous — it would compare `init_reg(slots)` against a copy of `init_reg(slots)` and pass no matter how wrong the recipe was.

**Files:**
- Modify: `crates/redextape-core/src/tm.rs` (`attempt` returns what it built; new `DescribedRun` + `run_tm_described`)
- Create: `crates/redextape-core/tests/tm_header.rs`
- Create: `crates/redextape-core/tests/fixtures/list_1_2.tm`
- Test: `crates/redextape-core/tests/tm_header.rs`

**Interfaces:**
- Consumes: `lower_and_size`, `lower_tm_guarded`, `simulate_final`, `EncodingKind`, `TmHeader::new`, `print_tm_with`, `parse_tm_full`, `decode_tape_ty`, `typeck::result_type`.
- Produces:
  - `pub struct DescribedRun { pub run: TmRun, pub machine: Machine, pub header: TmHeader }`
  - `pub fn run_tm_described(core: &Core, kind: EncodingKind, result: Ty, caps: TmCaps) -> Result<DescribedRun, TmRun>`

- [ ] **Step 1: Change `attempt` to return the machine and the init it built**

In `crates/redextape-core/src/tm.rs`, replace `fn attempt` (lines 117-128):

```rust
/// One attempt at `enc`'s own width: lower, lay out the bank, simulate, and classify the halt.
///
/// Returns the machine and the initial tapes it built alongside the outcome. `run_tm_fitted` drops
/// both; `run_tm_described` keeps them, and keeping them is the point — a header whose literal tapes
/// were re-derived from its own `encoding`/`width`/`slots` fields could not disagree with them, so
/// the consistency check over it would prove nothing. There is exactly ONE place that builds `init`,
/// which is what makes the check a check.
fn attempt(prog: &Program, enc: &dyn Encoding, n_slots: u32, caps: TmCaps) -> (TmRun, Machine, Vec<Vec<Symbol>>) {
    let (machine, overflow) = lower_tm_guarded(prog, enc);
    let mut init = vec![Vec::new(); TAPES];
    init[REG] = enc.init_reg(n_slots);
    init[WORK] = enc.init_work();
    let run = match simulate_final(&machine, &init, caps) {
        (_, s, TmStatus::Halted) if s == overflow => TmRun::Overflow,
        (tapes, _, TmStatus::Halted) => TmRun::Ran { tapes },
        (_, _, TmStatus::HitCap) => TmRun::HitCap,
    };
    (run, machine, init)
}
```

Update its two call sites in `run_tm_fitted` (line 182) and `run_tm_at` (line 197) to destructure and drop:

```rust
        match attempt(&prog, &*fitted, n_slots, caps).0 {
```

```rust
    attempt(&prog, enc, sm.n_slots(), caps).0
```

Add `Symbol` to the `use` at the top of `tm.rs` if it is not already in scope via the re-exports (it is — `pub use machine::{… Symbol}`).

- [ ] **Step 2: Write the failing integration tests**

Create `crates/redextape-core/tests/tm_header.rs`:

```rust
//! The self-describing TM text form, end to end: a `.tm` file that any simulator can RUN and that this
//! project can INTERPRET, with nothing but the file.

use redextape_core::desugar::desugar;
use redextape_core::parser::parse;
use redextape_core::tm::{
    EncodingKind, TM_DEFAULT_CAPS, TmRun, TmStatus, decode_tape_ty, parse_tm_full, print_tm_with, run_tm_described,
    simulate,
};
use redextape_core::typeck::result_type;
use redextape_core::value::Value;

/// Programs small enough to print in full and varied enough to reach REG, WORK, HEAP and the stack.
const CORPUS: &[&str] = &[
    "1 + 2 * 3",
    "if 1 == 2 { 10 } else { 20 }",
    "cons(1, cons(2, nil))",
    "fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } sum(5)",
];

fn described(src: &str, kind: EncodingKind) -> redextape_core::tm::DescribedRun {
    let (prog, ds) = parse(src);
    assert!(ds.is_empty(), "parse errors for {src}: {ds:?}");
    let prog = prog.expect("a program");
    let ty = result_type(&prog).unwrap_or_else(|e| panic!("type errors for {src}: {e:?}"));
    run_tm_described(&desugar(&prog), kind, ty, TM_DEFAULT_CAPS)
        .unwrap_or_else(|r| panic!("{src} did not run: {r:?}"))
}

/// THE CONSISTENCY CHECK (spec §3). The header carries the initial tapes LITERALLY, so any simulator
/// can run the file, AND the recipe needed to decode the result. The two are redundant by
/// construction — and that redundancy is turned into a checked invariant, which is the move this
/// project makes everywhere else: the oracle IS redundancy, checked.
///
/// It runs THROUGH THE TEXT, so serialization is inside the loop being checked rather than beside it.
///
/// This is only a real check because the literal tapes were CAPTURED from the configuration
/// `simulate` was actually handed (see `attempt` in `tm.rs`), not regenerated from the header's own
/// fields. Regenerating them would compare `init_reg(slots)` with a copy of itself.
#[test]
fn the_headers_recipe_reproduces_its_literal_tapes() {
    for &src in CORPUS {
        for kind in [EncodingKind::Unary, EncodingKind::Binary] {
            let d = described(src, kind);
            let file = print_tm_with(&d.machine, &d.header);
            let (_, h, ds) = parse_tm_full(&file);
            assert!(ds.is_empty(), "{src} under {kind:?}: {ds:?}");
            let h = h.expect("a header");

            let enc = h.encoding();
            let init = h.init(d.machine.tapes);
            assert_eq!(init[0], enc.init_reg(h.slots), "{src} under {kind:?}: REG recipe != literal");
            assert_eq!(init[1], enc.init_work(), "{src} under {kind:?}: WORK recipe != literal");
        }
    }
}

/// THE POINT OF THE SLICE: a file, and only a file, becomes a value.
///
/// No `Core`, no `lower_asm`, no `lower_tm`, no reference run — the input is a checked-in `.tm` file
/// read off disk. If any piece of the header were insufficient, this is the test that could not be
/// written.
#[test]
fn a_tm_file_becomes_a_value_with_nothing_but_the_file() {
    let file = include_str!("fixtures/list_1_2.tm");

    let (m, h, ds) = parse_tm_full(file);
    assert!(ds.is_empty(), "diagnostics: {ds:?}");
    let (m, h) = (m.expect("a machine"), h.expect("a header"));

    // 1. Build the initial configuration from the file and simulate. A generic simulator can do this
    //    much with no knowledge of this project.
    let (tapes, status) = simulate(&m, &h.init(m.tapes), TM_DEFAULT_CAPS);
    assert_eq!(status, TmStatus::Halted);

    // 2. Interpret the answer. THIS half needs the encoding's semantics, which the header NAMES but
    //    cannot inline — the gap the spec states rather than pretends to close.
    let got = decode_tape_ty(&tapes, &h.result, &*h.encoding());
    assert_eq!(got, Some(Value::list_of_nats(&[1, 2])));
}

/// The fixture is a real artifact of today's compiler, not a hand-tuned file that drifted from it.
/// A codegen change updates the fixture deliberately, with this test as the prompt.
#[test]
fn the_fixture_is_what_the_compiler_emits_today() {
    let d = described("cons(1, cons(2, nil))", EncodingKind::Unary);
    assert_eq!(
        print_tm_with(&d.machine, &d.header),
        include_str!("fixtures/list_1_2.tm"),
        "regenerate with: cargo test -p redextape-core --test tm_header -- --ignored regenerate_fixture"
    );
}

/// Writes the fixture. Ignored by default; run it deliberately after a codegen change.
#[test]
#[ignore = "regenerates a checked-in fixture"]
fn regenerate_fixture() {
    let d = described("cons(1, cons(2, nil))", EncodingKind::Unary);
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/list_1_2.tm");
    std::fs::write(path, print_tm_with(&d.machine, &d.header)).expect("write fixture");
}

/// SABOTAGE, each aimed at the check that can actually see it.
///
/// The width row is the one worth reading twice. Structural decode made both encodings
/// width-independent — `Binary::decode_nat` and `parse_heap_cells` each say outright that
/// `self.width` is never consulted — so a width off by one is INVISIBLE to the end-to-end test and
/// visible only here, where `init_reg` writes `width` cells per field. An earlier draft of the spec
/// aimed it at the end-to-end test, where it would have proved nothing.
#[test]
fn sabotaging_the_recipe_is_caught_by_the_consistency_check() {
    let d = described("1 + 2 * 3", EncodingKind::Binary);
    let h = &d.header;
    let literal_reg = h.init(d.machine.tapes)[0].clone();

    // Baseline: the true recipe reproduces the literal tape.
    assert_eq!(h.encoding().init_reg(h.slots), literal_reg);
    // Width off by one: caught.
    assert_ne!(EncodingKind::Binary.at(h.width + 1).init_reg(h.slots), literal_reg);
    assert_ne!(EncodingKind::Binary.at(h.width - 1).init_reg(h.slots), literal_reg);
    // One field too many: caught.
    assert_ne!(h.encoding().init_reg(h.slots + 1), literal_reg);
    // The wrong encoding at the right width: caught.
    assert_ne!(EncodingKind::Unary.at(h.width).init_reg(h.slots), literal_reg);
}

/// SABOTAGE of the end-to-end path: the three header fields it genuinely depends on.
#[test]
fn sabotaging_the_header_is_caught_by_the_end_to_end_decode() {
    let file = include_str!("fixtures/list_1_2.tm");
    let (m, h, _) = parse_tm_full(file);
    let (m, h) = (m.expect("a machine"), h.expect("a header"));
    let (tapes, _) = simulate(&m, &h.init(m.tapes), TM_DEFAULT_CAPS);
    let truth = Some(Value::list_of_nats(&[1, 2]));
    assert_eq!(decode_tape_ty(&tapes, &h.result, &*h.encoding()), truth);

    // Wrong encoding: a unary mark run read as binary digits is a different number.
    assert_ne!(decode_tape_ty(&tapes, &h.result, &*EncodingKind::Binary.at(h.width)), truth);
    // Wrong result type: the list POINTER decodes as a bare Nat.
    assert_ne!(decode_tape_ty(&tapes, &redextape_core::ty::Ty::Nat, &*h.encoding()), truth);
    // Wrong initial tapes: one flipped cell in the literal REG bank changes the run.
    let mut bad_init = h.init(m.tapes);
    bad_init[0][1] = '1';
    let (bad_tapes, _) = simulate(&m, &bad_init, TM_DEFAULT_CAPS);
    assert_ne!(decode_tape_ty(&bad_tapes, &h.result, &*h.encoding()), truth);
}

/// A described run agrees with the ordinary one — the producer must not be a second, divergent path
/// to a result.
#[test]
fn a_described_run_computes_what_an_ordinary_run_computes() {
    for &src in CORPUS {
        for kind in [EncodingKind::Unary, EncodingKind::Binary] {
            let d = described(src, kind);
            let TmRun::Ran { tapes } = &d.run else { panic!("{src} under {kind:?}: {:?}", d.run) };
            let got = decode_tape_ty(tapes, &d.header.result, &*d.header.encoding());
            assert!(got.is_some(), "{src} under {kind:?} decoded to None");
        }
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cargo test -p redextape-core --test tm_header`
Expected: FAIL — `cannot find function 'run_tm_described'`, and `couldn't read tests/fixtures/list_1_2.tm`.

- [ ] **Step 4: Implement `DescribedRun` and `run_tm_described`**

Add to `crates/redextape-core/src/tm.rs`, after `run_tm_fitted`:

```rust
/// A run together with everything needed to write it down: the machine, and the header describing the
/// very configuration it was run from.
#[derive(Clone, Debug)]
pub struct DescribedRun {
    /// What happened.
    pub run: TmRun,
    /// The machine that ran. `print_tm_with(&machine, &header)` is a complete, self-describing file.
    pub machine: Machine,
    /// The recipe AND the literal initial tapes, captured from the configuration `simulate` was
    /// handed — not re-derived from the recipe, which is what makes the consistency check a check.
    pub header: TmHeader,
}

/// Lower, auto-fit the width, run — and return the machine and header that together form a complete
/// `.tm` file for that run.
///
/// `result` is the program's top-level type (`typeck::result_type`), which the caller supplies
/// because this function takes `Core` and typing happens on the AST.
///
/// `Err` for a program that never ran (`LowerError` / `TooLarge`): there is no configuration to
/// describe, so there is no honest header to return.
///
/// Mirrors `run_tm_fitted`'s search — `MIN_FIELD_WIDTH`, doubling, retrying only on the overflow
/// guard — but has no unbounded-encoding branch: `EncodingKind` names only bounded encodings, since
/// an unbounded one has no name to write in a file.
pub fn run_tm_described(core: &Core, kind: EncodingKind, result: Ty, caps: TmCaps) -> Result<DescribedRun, TmRun> {
    let (prog, sm) = lower_and_size(core)?;
    let n_slots = sm.n_slots();
    let mut width = MIN_FIELD_WIDTH;
    loop {
        let fitted = kind.at(width);
        let (run, machine, init) = attempt(&prog, &*fitted, n_slots, caps);
        match run {
            TmRun::Overflow if width < MAX_FIELD_WIDTH => width = (width * 2).min(MAX_FIELD_WIDTH),
            run => {
                let tapes = init.into_iter().enumerate().collect();
                let header = TmHeader::new(kind, width, n_slots, result, tapes);
                return Ok(DescribedRun { run, machine, header });
            }
        }
    }
}
```

Add the needed imports to `tm.rs`'s top-level `use` section:

```rust
use crate::ty::Ty;
```

and extend the header re-export line:

```rust
pub use header::{EncodingKind, TmHeader};
```

`DescribedRun` and `run_tm_described` are defined in `tm.rs` itself, so they need no re-export.

**Note on `lower_and_size`:** it already returns `Result<_, TmRun>`, so `?` works directly here.

- [ ] **Step 5: Generate the fixture**

```bash
mkdir -p crates/redextape-core/tests/fixtures
touch crates/redextape-core/tests/fixtures/list_1_2.tm
cargo test -p redextape-core --test tm_header -- --ignored regenerate_fixture
```

Then inspect it — it must open with `tapes 5`, `start …`, the six header directives, and a blank line:

```bash
head -12 crates/redextape-core/tests/fixtures/list_1_2.tm
wc -l crates/redextape-core/tests/fixtures/list_1_2.tm
```

Expected: `encoding unary`, `width 4`, `slots N`, `result List<Nat>`, `tape 0 #…#  ; reg` among the first lines.

- [ ] **Step 6: Run the integration tests**

Run: `cargo test -p redextape-core --test tm_header`
Expected: PASS — 6 tests plus 1 ignored.

- [ ] **Step 7: Run the whole suite**

Run: `cargo test -p redextape-core && ./scripts/check-all.sh --no-llvm`
Expected: PASS. If `check-all.sh` takes a different flag in this tree, run `./scripts/check-all.sh --help` first.

- [ ] **Step 8: Commit**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/tm.rs crates/redextape-core/tests/tm_header.rs crates/redextape-core/tests/fixtures/list_1_2.tm
git commit -m "feat(tm): produce a self-describing file, and check that it describes the run

run_tm_described returns the machine AND a header whose literal tapes were
CAPTURED from the configuration simulate was actually handed. That capture
is the whole design: a header whose tapes were re-derived from its own
encoding/width/slots could not disagree with them, and the consistency
check over it would compare init_reg(slots) with a copy of itself.

The end-to-end test reads a checked-in .tm file off disk and turns it into
a value with no Core, no lower_tm and no reference run — the test that
could not be written if any part of the header were insufficient.

Sabotage is aimed by dimension. Width is invisible end-to-end (structural
decode made both encodings width-independent, as their own comments say)
and visible to the consistency check, where init_reg writes width cells per
field. The spec's earlier draft aimed it the other way."
```

---

### Task 7: Record what the format now guarantees — and what it does not

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md:222` (the scheduled entry → a completion entry)
- Modify: `docs/superpowers/specs/2026-07-27-tm-self-describing-header-design.md:3` (status line)

- [ ] **Step 1: Replace the roadmap's scheduled entry with a completion entry**

In `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, replace the `**Self-describing TM text form (optional header) — SCHEDULED…**` bullet with:

```markdown
- **Self-describing TM text form (optional header) — DONE (2026-07-27).** Spec:
  `docs/superpowers/specs/2026-07-27-tm-self-describing-header-design.md`; plan:
  `docs/superpowers/plans/2026-07-27-tm-self-describing-header.md`. A `.tm` file now records both
  halves of a Turing machine: δ and q₀ as before, plus the initial configuration — the literal initial
  tapes, so any simulator can run it, and the `encoding`/`width`/`slots`/`result` recipe needed to
  interpret the answer. `tests/tm_header.rs` turns a checked-in file into a value with no `Core`, no
  `lower_tm` and no reference run.

  **What it guarantees:** a foreign tool can RUN a `.tm` file. **What it cannot:** that tool cannot
  INTERPRET the result. Decoding needs the encoding's semantics, and a name cannot convey them. The
  asymmetry is inherent — running is universal, interpreting is not — and the header closes the gap it
  can close and names the gap it cannot.

  **Optionality is free and is pinned by four properties** (`tm/syntax.rs`), because a header adds no
  capability to the machine — it removes an INPUT requirement. `Machine` gained no field, per the rule
  `lower_tm.rs` states twice.

  **Two findings the slice produced beyond its own scope.**
  1. *A totality hole, latent until this slice made it reachable.* `asm.rs`'s `decode_word_ty` recursed
     on the heap chain under a type that never shrinks for `List`, so a CYCLIC heap overflowed the
     stack. Unreachable while every heap came from the compiler — a cons cell's tail points only at an
     earlier cell — and reachable the moment a heap can come from a FILE. The spine is now a loop
     bounded by one step per cell.
  2. *A sabotage aimed at the wrong dimension, caught in the spec rather than in the code.* The spec
     required the end-to-end test to go red on a `width` off by one. It cannot: structural decode made
     both encodings width-independent, and `Binary::decode_nat`/`parse_heap_cells` say so in as many
     words. Width is visible to the CONSISTENCY check, where `init_reg` writes `width` cells per field.
     Same lesson the branch has now recorded several times, one level up: a check is only as good as
     the direction and dimension it is aimed at, and that includes checks a plan merely specifies.

  **Deliberately not done, with reasons.** No format version directive — it costs nothing now and a
  migration later, but it is speculative until a second version exists. No CLI or file-emitting entry
  point: `run_tm_described` + `print_tm_with` produce the text, and whether a binary should write it
  to disk is a separate question. **One new registration point:** a third encoding must be added to
  `EncodingKind` and its `parse`, which is inherent to a format that names its variants.
```

- [ ] **Step 2: Update the spec's status line**

```markdown
> **Status:** IMPLEMENTED (2026-07-27). Plan: `docs/superpowers/plans/2026-07-27-tm-self-describing-header.md`.
```

- [ ] **Step 3: Verify the whole tree is green and commit**

```bash
cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test -p redextape-core
git add docs/
git commit -m "docs(roadmap): what the text form now guarantees, and the one thing it cannot

A foreign tool can RUN a .tm file; it cannot INTERPRET the result, because
decoding needs the encoding's semantics and a name cannot convey them. The
asymmetry is inherent, so it is recorded rather than papered over.

Also records the two findings the slice produced beyond its scope: a
totality hole that was latent only because every heap had come from the
compiler, and a spec-level sabotage aimed at a dimension its target test
cannot see."
```

---

## Self-Review

**Spec coverage.**

| spec requirement | task |
|---|---|
| Grammar (§1) | 4 (print), 5 (parse) |
| `TmHeader` / `EncodingKind` API (§2) | 3 |
| `TmHeader::encoding()` / `init()` | 3 |
| `print_tm_with` / `parse_tm_full` / `parse_tm` as wrapper (D2) | 4, 5 |
| `decode_tape_ty` (§2), sibling not replacement (D6) | 2 |
| Consistency check (§3) | 6 |
| D1 literal tapes AND recipe | 3 (type), 6 (capture) |
| D3 index-addressed, name as comment | 3 (`tape_name`), 4 |
| D4 packed cells | 4 (print), 5 (`parse_cells`) |
| D5 `result` admits only decodable types + reuse `show` | 1, 5 |
| Partial-header definition | 5 (`HeaderParts::finish`) |
| Testing 1 (four properties) | 5 |
| Testing 2 (round-trip over compiled machines, both encodings) | 6 (`the_headers_recipe_reproduces_its_literal_tapes` prints and re-parses every corpus machine under both kinds) |
| Testing 3 (consistency check over the corpus) | 6 |
| Testing 4 (file → value end-to-end) | 6 |
| Testing 5 (malformed-header cases) | 5 |
| Testing 6 (decoder agreement + disagreement) | 2 |
| Testing 7 (sabotage table) | 6 |
| Deliverable 5 (roadmap section) | 7 |
| "the one new coupling" — encoding-name registration | 3 (doc on `EncodingKind`), 7 (roadmap) |

No gaps.

**Placeholder scan.** No TBDs, no "add error handling", no "similar to Task N". Every code step carries the code.

**Type consistency.** Checked across tasks: `TmHeader::new(EncodingKind, usize, u32, Ty, Vec<(usize, Vec<Symbol>)>)` is used identically in Tasks 3, 5 and 6. `h.tapes()` is the accessor everywhere (never the field). `EncodingKind::at(self, usize) -> Box<dyn Encoding>` is called as `kind.at(w)` in Tasks 3 and 6 and as `h.encoding.at(h.width)` inside `TmHeader::encoding`. `decode_tape_ty(&[Tape], &Ty, &dyn Encoding)` is called with `&*h.encoding()` (deref of the `Box`) in Task 6, matching its `&dyn` parameter. `attempt`'s new 3-tuple is destructured consistently in `run_tm_fitted`, `run_tm_at` (both `.0`) and `run_tm_described`.

**One risk worth naming for the implementer.** Task 5's parse-loop edit is the only place this plan modifies control flow inside an existing function rather than adding beside it. **The `.filter(|(k, _)| matches!(*k, "encoding" | …))` is the load-bearing part, not the branch's position in the chain.** With it, a `state s:` line splits to `("state", "s:")`, is rejected by the filter, and falls through to its own branch — so the header branch is safe anywhere in the `else if` chain. Drop the filter and it swallows every space-containing line in the file. The pre-existing `syntax` tests are the check.

**One test-design trap, recorded because I walked into it while writing this plan.** The malformed-directive cases in Task 5 must each be a *complete* header with one thing wrong, never a valid header with a bad line appended. Appending makes every bad line a second directive of its own key, so all of them hit the duplicate-detection arm and none reaches the validation the case is named for — a test that passes for a reason unrelated to its name.
