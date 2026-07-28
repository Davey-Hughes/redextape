# TM Header — Hardening, Versioning and Tooling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three Important findings and four fix-before-merge Minors from the whole-branch review, then add versioning, a file-emitting entry point, and three checks that make the format's headline claim falsifiable.

**Architecture:** Continues the `tm-self-describing-header` branch. Phase A is defensive hardening at the parser and decoder boundaries plus test strengthening — no new API. Phase B adds one header directive, one example, two fixtures/tests, and one deliberately-independent foreign reader.

**Tech Stack:** Rust, `redextape-core` only (plus its `examples/` and `tests/`). No new dependencies. `proptest` is already a dev-dependency.

**Spec:** `docs/superpowers/specs/2026-07-28-tm-header-hardening-and-tooling-design.md`

## Global Constraints

- **The four optionality properties must survive every task unchanged:**
  1. `parse_tm(print_tm(m))` → `(Some(m), [])`
  2. `parse_tm_full(print_tm_with(m, h))` → `(Some(m), Some(h), [])`
  3. `parse_tm(print_tm_with(m, h))` → `(Some(m), [])`
  4. `parse_tm_full(print_tm(m))` → `(Some(m), None, [])` — no header, **not** an error
- **`print_tm`'s output stays byte-identical.** Pinned by `print_tm_is_a_stable_readable_listing`. Task 5 changes `print_tm_with`'s output only.
- **`Machine` gains no field.** `parse_tm`'s signature and behaviour are unchanged.
- **Every new limit is a TOTALITY GUARD on untrusted input, not a language limit** — the wording `MAX_TY_DEPTH` already uses. Say so in each doc comment.
- **Caps, with their justifications** (copy verbatim into code docs):
  - `MAX_TAPES = 64` (new, in `tm/build.rs` beside `TAPES`): this compiler emits 5; 64 leaves an order of magnitude for hand-written machines while bounding `TmHeader::init` to 64 `Vec`s.
  - `slots` capped at the existing `lower_tm::MAX_SLOTS` (100_000).
  - `width` capped at the existing `build::MAX_FIELD_WIDTH` (64).
  - `MAX_DECODE_NODES = 1_000_000` (new, in `tm/asm.rs`).
- **Run everything with:** `cargo test -p redextape-core` (NO `--lib` — that misses the 12 integration binaries). Before every commit: `cargo fmt --all` and `cargo clippy --all-targets -- -D warnings`. Before the final task: `./scripts/check-all.sh --no-llvm`.
- **Current state:** 523 tests passing in `redextape-core`; 604 across the workspace gate; 0 failures.

---

## File Structure

| file | phase | responsibility |
|---|---|---|
| `src/tm/build.rs` | A1 | gains `MAX_TAPES` |
| `src/tm/syntax.rs` | A1, A4, B1 | `tapes` cap; span-check fix; prefix-strip comment; the `version` directive; module doc |
| `src/tm/header.rs` | A1, A4, A5, B1 | `slots`/`width` caps; `init` doc; dedup test; `new` doc; `version` in `HeaderParts` |
| `src/tm/asm.rs` | A2, A5 | `MAX_DECODE_NODES`, the budget, the two-guarantees doc; the false DRY claim |
| `src/tm/decode.rs` | A2 | budget passthrough |
| `src/ty.rs` | A4 | delete the stale slicing comment |
| `src/tm.rs` | A5 | `attempt`'s "ONE place" claim |
| `tests/tm_header.rs` | A3, B3 | round-trip assertions; the binary fixture's tests |
| `tests/fixtures/list_1_2.tm` | B1 | regenerated to carry `version 1` |
| `tests/fixtures/list_1_2_binary.tm` | **create** (B3) | a binary fixture — the only one with a `tape 1` line |
| `tests/tm_header_proptest.rs` | **create** (B4) | property 2 over generated machines |
| `tests/tm_foreign_reader.rs` | **create** (B5) | an independent simulator + decoder |
| `examples/tm_emit.rs` | **create** (B2) | `emit` / `run` |

## Task ordering

```
1 (caps) ─→ 4 (docs) ─→ 5 (version) ─→ 6 (tm_emit) ─→ 7 (binary fixture + proptest) ─→ 8 (foreign reader)
2 (budget) ─┘                    ↑
3 (round-trip asserts) ──────────┘
```

Tasks 1, 2, 3 are independent and may run concurrently in separate worktrees. Task 5 must precede 7 (it changes printed output, so the fixture regenerates once). Task 4 must precede 8 (the module doc is the foreign reader's source material).

---

### Task 1: Cap the file-supplied integers

**Files:** Modify `src/tm/build.rs`, `src/tm/syntax.rs`, `src/tm/header.rs`. Test: inline in `syntax.rs` and `header.rs`.

**Interfaces produced:** `pub const MAX_TAPES: usize = 64;` in `tm::build`, re-exported from `tm`.

- [ ] **Step 1: Write the failing tests** — in `syntax.rs`'s `mod tests`:

```rust
/// A `.tm` file is untrusted. `tapes N` drives `TmHeader::init`'s allocation directly, and a machine
/// whose only state is `state s: accept` has no rules — so the rule-arity check never constrains it.
/// Without a cap, `tapes 10000000000` parses clean and the documented next step allocates 10^10 Vecs.
/// `sim.rs` guards this exact scenario by name; the header path reintroduced it one call earlier.
#[test]
fn an_absurd_tape_count_is_refused_rather_than_allocated() {
    let src = "tapes 10000000000\nstart s\n\nstate s: accept\n";
    let (m, ds) = parse_tm(src);
    assert!(m.is_none(), "an absurd tape count must not yield a machine");
    assert!(ds.iter().any(|d| d.message.contains("tapes")), "{ds:?}");
    for d in &ds {
        assert!(d.span.start <= d.span.end && d.span.end <= src.len());
    }
}

/// BOTH DIRECTIONS. A cap tested only from above proves the rejection fires, never that it fires at
/// the right place — the value one below it must still be accepted.
#[test]
fn the_tape_cap_admits_the_value_just_below_it() {
    let at_cap = format!("tapes {MAX_TAPES}\nstart s\n\nstate s: accept\n");
    let (m, ds) = parse_tm(&at_cap);
    assert!(m.is_some() && ds.is_empty(), "at the cap must parse: {ds:?}");
    let over = format!("tapes {}\nstart s\n\nstate s: accept\n", MAX_TAPES + 1);
    assert!(parse_tm(&over).0.is_none(), "one over the cap must not");
}

/// `slots` and `width` feed `init_reg`, which allocates `slots * (width + 1)` cells — the recipe
/// evaluation the header exists for, and what the consistency check itself performs. MAX_SLOTS and
/// MAX_FIELD_WIDTH already bound this for in-memory programs; the file path bypassed them.
#[test]
fn absurd_slots_and_width_are_refused_at_their_existing_ceilings() {
    let hdr = |s: &str, w: &str| {
        format!("tapes 1\nstart s\nencoding unary\nwidth {w}\nslots {s}\nresult Nat\n\nstate s: accept\n")
    };
    // At each ceiling: accepted.
    assert!(parse_tm_full(&hdr("100000", "64")).1.is_some(), "at both ceilings must parse");
    // One over: refused, each naming its own directive.
    let (_, h, ds) = parse_tm_full(&hdr("100001", "64"));
    assert!(h.is_none() && ds.iter().any(|d| d.message.contains("slots")), "{ds:?}");
    let (_, h, ds) = parse_tm_full(&hdr("100000", "65"));
    assert!(h.is_none() && ds.iter().any(|d| d.message.contains("width")), "{ds:?}");
}
```

Import `MAX_TAPES` and `parse_tm_full` in the test module as needed.

- [ ] **Step 2: Run to verify they fail.** `cargo test -p redextape-core --lib tm::syntax` — expect `cannot find value MAX_TAPES`, then assertion failures once it exists.

- [ ] **Step 3: Add the constant** to `src/tm/build.rs`, beside `TAPES`:

```rust
/// The most tapes a PARSED machine may declare.
///
/// A TOTALITY guard on untrusted input, not a language limit. `tapes N` from a `.tm` file drives
/// `TmHeader::init`'s allocation directly, and a rule-less accept state means the rule-arity check
/// never constrains it — so without this, `tapes 10_000_000_000` parses clean and the documented next
/// step allocates that many `Vec`s. `sim.rs` guards the same scenario one call later, by name.
///
/// This compiler emits `TAPES` (5). 64 leaves an order of magnitude for hand-written machines while
/// bounding the allocation to something a test can survive.
pub const MAX_TAPES: usize = 64;
```

Re-export it from `src/tm.rs`'s `build` re-export list.

- [ ] **Step 4: Enforce `tapes`** in `syntax.rs`'s parse loop. The existing arm is:

```rust
        if let Some(rest) = trimmed.strip_prefix("tapes ") {
            match rest.split(';').next().unwrap_or("").trim().parse::<usize>() {
                Ok(n) if n >= 1 => tapes = Some(n),
                _ => diags.push(err(span, "expected `tapes <positive integer>`")),
            }
```

Change the guard to `Ok(n) if (1..=MAX_TAPES).contains(&n)` and give the failure a message that names the cap, e.g. `format!("expected `tapes <1..={MAX_TAPES}>`")`. Keep it one diagnostic, not two.

- [ ] **Step 5: Enforce `slots` and `width`** in `header.rs`'s `HeaderParts::directive`, in the existing `"width"` and `"slots"` arms. Add the ceiling to each guard and name it in the message. Import `MAX_FIELD_WIDTH` from `build` and `MAX_SLOTS` from `lower_tm`. Each doc-comment the reason inline:

```rust
// Capped at the same ceiling `lower_and_size` enforces for in-memory programs: `slots` and `width`
// feed `init_reg`, which allocates `slots * (width + 1)` cells. A TOTALITY guard on untrusted
// input, not a language limit.
```

- [ ] **Step 6: Narrow `TmHeader::init`'s doc.** It currently claims totality while being silent about the allocation, which is the part that aborts. Rewrite so it states: entries outside `0..n_tapes` are dropped; the allocation is `n_tapes` `Vec`s and is bounded only because the parser caps `tapes` at `MAX_TAPES` — a caller passing an unvalidated `n_tapes` is outside the guarantee.

- [ ] **Step 7: Run the tests, then the full suite.** `cargo test -p redextape-core` — must be 523 + your new tests, 0 failed.

- [ ] **Step 8: Commit.**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/tm/build.rs crates/redextape-core/src/tm/syntax.rs crates/redextape-core/src/tm/header.rs crates/redextape-core/src/tm.rs
git commit -m "fix(tm): cap the file-supplied integers that drive allocation

A .tm file is untrusted, and three of its numbers fed eager allocations
with no ceiling. tapes N drives TmHeader::init directly, and a rule-less
accept state means the arity check never constrains it — so tapes
10000000000 parsed clean and the documented next step allocated that many
Vecs. sim.rs guards the same scenario one call later, by name.

slots and width are the same class: they feed init_reg, which allocates
slots * (width + 1) cells. MAX_SLOTS and MAX_FIELD_WIDTH already bounded
that for in-memory programs; the file path went around them.

Each cap is tested from BOTH directions — the value at the ceiling still
parses. A cap tested only from above proves a rejection fires, never that
it fires in the right place."
```

---

### Task 2: Bound the type-directed decode's total size

**Files:** Modify `src/tm/asm.rs`, `src/tm/decode.rs`. Test: inline in `asm.rs`.

**Interfaces produced:** `pub(crate) const MAX_DECODE_NODES: usize = 1_000_000;`

- [ ] **Step 1: Write the failing tests** in `asm.rs`'s `mod tests`:

```rust
/// The spine loop bounds CYCLES — one step per heap cell. It does not bound SIZE. For
/// `List<List<Nat>>`, each of up to n spine steps decodes an inner list that walks up to n cells:
/// O(n^2) nodes, and `MAX_TY_DEPTH` nesting makes it O(n^d). BOTH factors are file-supplied, because
/// a machine of `state s: accept` returns its initial tapes unchanged. The two guards are separate
/// guarantees and neither implies the other.
#[test]
fn a_nested_type_over_a_large_heap_is_refused_rather_than_expanded() {
    use crate::ty::Ty;
    // Every cell points at the previous one, so each of the n spine steps decodes an inner list of
    // length up to n. n = 2000 gives ~2,000,000 nodes — over the budget.
    let n = 2000u64;
    let heap: Vec<(u64, u64)> = (1..=n).map(|i| (i - 1, i - 1)).collect();
    let o = AsmOutcome { result: n, heap };
    let nested = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
    assert_eq!(decode_asm_ty(&o, &nested), None, "must exhaust the node budget, not expand");
}

/// The budget must not reject legitimate decodes. A flat list well under the cap still decodes, and
/// a modest nested one does too.
#[test]
fn the_node_budget_admits_legitimate_decodes() {
    use crate::ty::Ty;
    let heap: Vec<(u64, u64)> = (1..=1000u64).map(|i| (i, i - 1)).collect();
    let o = AsmOutcome { result: 1000, heap };
    assert!(decode_asm_ty(&o, &Ty::List(Box::new(Ty::Nat))).is_some(), "a 1000-element list must decode");
    // A small nested case: 20 cells, List<List<Nat>> -> at most ~400 nodes.
    let heap: Vec<(u64, u64)> = (1..=20u64).map(|i| (i - 1, i - 1)).collect();
    let o = AsmOutcome { result: 20, heap };
    let nested = Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))));
    assert!(decode_asm_ty(&o, &nested).is_some(), "a small nested list must still decode");
}
```

- [ ] **Step 2: Run to verify they fail.** The first test will hang or take a very long time before the fix — that IS the failure signal. Run it with a timeout: `timeout 60 cargo test -p redextape-core --lib tm::asm::tests::a_nested_type_over_a_large_heap_is_refused_rather_than_expanded`. Record the timeout as the RED evidence.

- [ ] **Step 3: Add the constant and thread the budget.** In `asm.rs`:

```rust
/// The most `Value` nodes a single type-directed decode may construct.
///
/// A TOTALITY guard on untrusted input, not a language limit — and a SEPARATE guarantee from the
/// spine loop's bound. The loop bounds CYCLES: one step per heap cell, so a chain that never reaches
/// nil returns `None` instead of recursing forever. It does not bound SIZE, because nested list types
/// MULTIPLY — `List<List<Nat>>` over an n-cell heap is O(n²) nodes and `MAX_TY_DEPTH` nesting is
/// O(n^d). Both factors come from the file. Neither guard implies the other.
///
/// `decode_asm`/`decode_word`, the Value-directed siblings, need no budget: they recurse on a finite
/// reference `Value` already in memory, so its size is the bound.
pub(crate) const MAX_DECODE_NODES: usize = 1_000_000;
```

Give `decode_word_ty` a `budget: &mut usize` parameter, decrement once per constructed `Value`
(including each `Nat`/`Bool`/`Unit` leaf and each `Cons`), and return `None` when it would go below
zero. `decode_asm_ty` seeds it with `MAX_DECODE_NODES`. Update `decode_word_ty`'s existing doc so the
loop bound is described as addressing cycles specifically, with the budget addressing total size.

- [ ] **Step 4: Pass the budget through `decode.rs`.** `decode_tape_ty` seeds a fresh budget per call, same as `decode_asm_ty`.

- [ ] **Step 5: SABOTAGE — prove the budget is what is doing the work.** Temporarily set `MAX_DECODE_NODES = 1`, run `the_node_budget_admits_legitimate_decodes`, and confirm it FAILS. Restore, confirm it passes. Record both outputs. Without this the first test proves only that *something* returns `None`.

- [ ] **Step 6: Run the full suite.** `cargo test -p redextape-core` — 523 + new, 0 failed. The AOT path uses `decode_asm_ty`, so also run `cargo test -p redextape-native` (default features) and report its number.

- [ ] **Step 7: Commit.**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/tm/asm.rs crates/redextape-core/src/tm/decode.rs
git commit -m "fix(tm): bound the type-directed decode's SIZE, not only its cycles

The spine loop bounds one step per heap cell, which stops a cyclic chain.
It does not stop a large one: nested list types multiply, so List<List<Nat>>
over an n-cell heap is O(n^2) nodes and MAX_TY_DEPTH nesting is O(n^d).
Both factors are file-supplied — a machine of `state s: accept` returns its
initial tapes unchanged, so the heap the decoder reads is verbatim the
file's tape line.

The existing doc read as though the loop bound closed the totality question
for this function. It closed one dimension of it. Two guards, two separate
guarantees, and the doc now says so.

Proven by sabotage: with the budget set to 1, the legitimate-decode test
goes red."
```

---

### Task 3: Pin property 2 on a compiled machine under both encodings

**Files:** Modify `tests/tm_header.rs`.

- [ ] **Step 1: Strengthen the existing corpus loop.** In `the_headers_recipe_reproduces_its_literal_tapes`, the parsed machine is currently discarded (`let (_, h, ds) = …`) and the parsed header is never compared to the original. Capture both and add:

```rust
            // Optionality property 2, on the combination with the most moving parts: a 5-tape
            // COMPILED machine, a Binary header with a NON-EMPTY WORK tape line, `result List<Nat>`,
            // at a fitted width. Property 2's own test uses a hand-built 2-state machine with one
            // 6-cell unary tape — so without these two lines the spec's Testing §2 ("both encodings,
            // at their fitted widths") is asserted nowhere.
            assert_eq!(pm.as_ref(), Some(&d.machine), "{src} under {kind:?}: machine must round-trip");
            assert_eq!(h, d.header, "{src} under {kind:?}: header must round-trip");
```

- [ ] **Step 2: Run.** `cargo test -p redextape-core --test tm_header`. If either assertion fails, that is a REAL FINDING about the round-trip, not a test bug — report it and stop rather than weakening the assertion.

- [ ] **Step 3: Run the full suite.** 523, 0 failed (no new tests — this strengthens an existing one).

- [ ] **Step 4: Commit.**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/tests/tm_header.rs
git commit -m "test(tm): round-trip the compiled machines the corpus already builds

Property 2 was pinned on a hand-built 2-state machine with one 6-cell
unary tape. The corpus loop already printed and re-parsed 5-tape compiled
machines under BOTH encodings — including the only case with a non-empty
WORK tape line — and then threw the parsed machine away and never compared
the parsed header to the original.

Two assertions in a loop that already existed. The spec asked for this in
its Testing section and it was never wired up."
```

---

### Task 4: The comment and doc corrections, and the module doc the foreign reader needs

**Files:** Modify `src/ty.rs`, `src/tm/header.rs`, `src/tm/syntax.rs`, `src/tm.rs`, `src/tm/asm.rs`.

- [ ] **Step 1: `ty.rs`** — delete the comment justifying manual `len()-1` slicing. The code uses `strip_suffix`, which is boundary-safe unconditionally and needs no justification. Do not replace it with a different comment; the absence of a hazard needs no note.

- [ ] **Step 2: `header.rs`** — correct `TmHeader::new`'s "duplicates collapsed to the first". Empties are filtered BEFORE dedup, so given `[(REG, []), (REG, ['#'])]` the survivor is the second. State what actually happens.

- [ ] **Step 3: `header.rs`** — extend `construction_drops_empty_tapes_and_orders_the_rest` to exercise the duplicate-index collapse. `TmHeader::new` is `pub`, so this is documented external behaviour with zero coverage:

```rust
        // The duplicate-index collapse `dedup_by_key` exists for — untested until now, though
        // `TmHeader::new` is public and documents the behaviour.
        let h = TmHeader::new(
            EncodingKind::Unary, 8, 1, Ty::Nat,
            vec![(REG, vec!['#', 'a']), (REG, vec!['#', 'b'])],
        );
        assert_eq!(h.tapes().len(), 1, "duplicate indices must collapse to one entry");
```

Assert the surviving cells match whichever entry the corrected doc (Step 2) says wins.

- [ ] **Step 4: `syntax.rs`** — replace the span check's `covered.contains("tape")` with an exact comparison against the known offending line. `"tapes 1"` satisfies `contains("tape")`, so the assertion does not check what its own comment claims — a fresh instance of the branch's own defect class, inside the test added to fix another instance of it. Use `assert_eq!(covered.trim(), "tape 9 #____#")` or equivalent for that case.

- [ ] **Step 5: `syntax.rs`** — document the one-character margin in `print_tm_output_is_unchanged_by_the_header_split`:

```rust
    // The margin here is ONE CHARACTER. The only machine-authored line that comes close to a stripped
    // prefix is `tapes {n}`, which survives the `"tape "` prefix strip solely because index 4 is `s`
    // and not a space. State/rule lines are safe by construction (`"state "` and two leading spaces).
    // If either keyword ever loses its trailing space this test starts silently removing real content.
```

- [ ] **Step 6: `tm.rs`** — `attempt`'s claim "the single place that builds `init`" is false: `tm/attribute.rs` also builds one, and sets only `REG`, omitting `init_work()` — precisely the divergence the sentence says cannot exist. Qualify it to the `run_tm*` path, and add a one-line note that `attribute`'s omission is a real question under `Binary`, filed separately.

- [ ] **Step 7: `asm.rs`** — `decode_word_ty`'s doc says `tm::decode` "must not carry a second copy of this logic", while `decode.rs`'s `decode_word` IS a second copy of `asm.rs`'s `decode_word`. Narrow the claim to the type-directed decoder, and note the value-directed pair is duplicated-but-safe (both recurse structurally on a finite `Value`).

- [ ] **Step 8: `syntax.rs` module doc — the run semantics.** This is the prerequisite for Task 8, and the review found all three written down nowhere. Extend the module doc to state, as part of the format:

```rust
//! ## What a reader must assume beyond δ and q₀
//!
//! These are properties of the FORMAT, not of any one machine, and a foreign simulator that assumes
//! otherwise diverges silently:
//!
//! - **Each tape's head starts at cell 0** of its literal contents (an omitted `tape` line means an
//!   empty tape, whose head is at its single blank cell).
//! - **Tapes are TWO-WAY infinite.** Moving left from cell 0 is legal and yields a blank; it does not
//!   halt or error. A reader modelling a one-way tape computes a different function.
//! - **A state with no rule matching the current symbols HALTS**, and halting is not failure — the
//!   final tapes are the result. Only an `accept` state is distinguished, and only for readers that
//!   care about acceptance rather than output.
```

Also mention `print_tm_with`/`parse_tm_full` and the optional header — the module doc still describes a
format with only `print_tm`/`parse_tm`.

- [ ] **Step 9: Run the full suite.** 523 + the one new assertion block, 0 failed.

- [ ] **Step 10: Commit.**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/
git commit -m "docs(tm): write down the three run semantics, and fix four false claims

The module that owns the format did not describe the format. A foreign
simulator must assume three things stated nowhere: heads start at cell 0,
tapes are TWO-WAY infinite, and a rule-less state halts with its tapes as
the result. A reader modelling a one-way tape computes a different function
and nothing would have told them.

Four claims corrected where the code contradicted them: a boundary-safety
argument for slicing that strip_suffix makes unnecessary; 'duplicates
collapsed to the first' when empties are filtered first so the SECOND
survives; 'the single place that builds init' when attribute.rs builds one
too — omitting init_work(), the exact divergence the sentence forbids; and
a no-second-copy claim sitting beside a second copy.

Plus the span check that used contains(\"tape\"), which \"tapes 1\" satisfies
— the branch's own defect class, inside a test added to fix it."
```

---

### Task 5: The `version` directive

**Files:** Modify `src/tm/header.rs`, `src/tm/syntax.rs`; regenerate `tests/fixtures/list_1_2.tm`.

**Interfaces produced:** `pub const HEADER_VERSION: u32 = 1;` in `tm::header`; `TmHeader` gains no field (version is a format property, not a machine property — it is validated at parse and re-emitted as a constant).

- [ ] **Step 1: Write the failing tests** in `syntax.rs`'s `mod tests`:

```rust
/// Absent means version 1, so every file written before this directive existed stays valid.
#[test]
fn an_absent_version_means_one() {
    let src = "tapes 1\nstart s\nencoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n";
    let (m, h, ds) = parse_tm_full(src);
    assert!(m.is_some() && h.is_some(), "{ds:?}");
    assert!(ds.is_empty(), "an absent version is not a diagnostic: {ds:?}");
}

/// An unknown version is a hard ERROR, not a warning. A future version could change what `width` or
/// `slots` MEAN, so decoding a v2 file under v1 rules would produce a confidently wrong value — the
/// exact failure the header exists to prevent.
#[test]
fn an_unknown_version_is_an_error_not_a_warning() {
    for bad in ["version 2", "version 0", "version foo", "version"] {
        let src = format!("tapes 1\nstart s\n{bad}\nencoding unary\nwidth 4\nslots 1\nresult Nat\n\nstate s: accept\n");
        let (m, h, ds) = parse_tm_full(&src);
        assert!(m.is_none() && h.is_none(), "{bad:?} must be refused");
        assert!(ds.iter().any(|d| d.message.contains("version")), "{bad:?}: {ds:?}");
    }
}

/// `version` is NOT a member of the four-directive header set, so the four optionality properties are
/// untouched — but a lone `version` must not be silently dropped, on the same reasoning as a stray
/// `tape` line: discarding it turns a typo into "this file has no header".
#[test]
fn a_lone_version_without_a_header_is_a_diagnostic() {
    let src = "tapes 1\nstart s\nversion 1\n\nstate s: accept\n";
    let (_, h, ds) = parse_tm_full(src);
    assert!(h.is_none());
    assert!(ds.iter().any(|d| d.message.contains("version")), "{ds:?}");
}

/// The printer always emits it, and it leads the block.
#[test]
fn print_tm_with_emits_version_first() {
    let out = print_tm_with(&increment(), &a_header());
    let block: Vec<&str> = out.lines().skip(2).take(1).collect();
    assert_eq!(block, vec!["version 1"], "got:\n{out}");
}
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** In `header.rs`:

```rust
/// The `.tm` header format version this build writes and accepts.
///
/// An ABSENT `version` directive means 1, so every file written before this directive existed stays
/// valid. An unknown version is a hard parse ERROR rather than a warning: a future version could
/// change what `width` or `slots` MEAN, and decoding a v2 file under v1 rules would produce a
/// confidently wrong value — the exact failure the header exists to prevent.
///
/// NOT a member of the four-directive header set (`encoding`/`width`/`slots`/`result`), so the four
/// optionality properties are unaffected and a header-less file is still header-less.
pub const HEADER_VERSION: u32 = 1;
```

Add a `version: Option<u32>` and a `saw_version: bool` to `HeaderParts`; handle `"version"` in
`directive` (duplicate → error; unparseable or `!= HEADER_VERSION` → error naming the version); in
`finish`, treat `saw_version` exactly as `saw_tape` for the zero-of-four case. `print_header` emits
`version {HEADER_VERSION}` as its first line.

- [ ] **Step 4: Regenerate the fixture.** `cargo test -p redextape-core --test tm_header -- --ignored regenerate_fixture`, then confirm `head -3 crates/redextape-core/tests/fixtures/list_1_2.tm` shows `version 1` after `start`. `the_fixture_is_what_the_compiler_emits_today` going red before this step is the expected signal.

- [ ] **Step 5: Re-run the four optionality properties explicitly** and confirm all four still pass unchanged. `cargo test -p redextape-core --lib tm::syntax::tests::property`.

- [ ] **Step 6: Full suite**, then commit.

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/src/tm/header.rs crates/redextape-core/src/tm/syntax.rs crates/redextape-core/tests/fixtures/list_1_2.tm
git commit -m "feat(tm): a format version, with absence meaning 1

Always emitted, first line of the header block. Absent means 1, so every
file written before the directive existed stays valid. Unknown is a hard
ERROR, not a warning: a future version could change what width or slots
MEAN, and decoding a v2 file under v1 rules yields a confidently wrong
value — the failure the header exists to prevent.

Deliberately NOT a member of the four-directive header set, so all four
optionality properties are untouched. But a lone `version` is a diagnostic
rather than silently dropped, on the same reasoning as a stray tape line."
```

---

### Task 6: `tm_emit` — write a `.tm`, and run one back

**Files:** Create `examples/tm_emit.rs`. Test: add one round-trip test to `tests/tm_header.rs`.

- [ ] **Step 1: Write the example.** Two subcommands, hand-rolled arg parsing (no `clap` in the tree; `aot_demo` already parses `env::args` by hand). Model the file header comment on `tm_demo.rs`.

```
cargo run --example tm_emit -p redextape-core -- emit '<program>' [--encoding unary|binary] [-o <path>]
cargo run --example tm_emit -p redextape-core -- run <path>
```

`emit`: parse → `typeck::result_type` → `desugar` → `run_tm_described` → `print_tm_with` → stdout or file.
`run`: read the file → `parse_tm_full` → `h.init(m.tapes)` → `simulate` → `decode_tape_ty` → print via `value::format_value`.

Exit non-zero with a diagnostic on: bad args, a program that does not parse/typecheck/lower, a file that does not parse, a header-less file passed to `run` (it cannot be run without one — say so), or a decode that returns `None`. No panics, no `unwrap` on user input.

- [ ] **Step 2: Exercise it by hand** and paste the transcript into your report:

```bash
cargo run --example tm_emit -p redextape-core -- emit 'cons(1, cons(2, nil))' --encoding binary -o /tmp/t.tm
cargo run --example tm_emit -p redextape-core -- run /tmp/t.tm      # expect [1, 2]
cargo run --example tm_emit -p redextape-core -- run /dev/null      # expect a diagnostic, non-zero exit
```

- [ ] **Step 3: Add a test** in `tests/tm_header.rs` that performs the same emit→run round trip in-process (not by shelling out): produce the text with `run_tm_described` + `print_tm_with`, then feed it through the `run` path's exact sequence and assert the value equals `interp::eval`'s. The example stays the demo; the test is what CI protects.

- [ ] **Step 4: Full suite, then commit.**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/examples/tm_emit.rs crates/redextape-core/tests/tm_header.rs
git commit -m "feat(tm): tm_emit — write a .tm file, and run one back

The run mode is the slice's headline claim made executable outside the
test harness: a file, and only a file, becomes a value. Emit compiles a
program and writes the self-describing text; run parses it, builds init
from the header, simulates, and decodes against the header's result type.

An example rather than a [[bin]] — examples are this project's convention
and nothing yet needs a first binary."
```

---

### Task 7: A binary fixture, a round-trip proptest, and moving the regenerator out of the test harness

**Files:** Create `tests/fixtures/list_1_2_binary.tm`, `tests/tm_header_proptest.rs`, `examples/regen_fixtures.rs`; modify `tests/tm_header.rs`.

- [ ] **Step 0: Move `regenerate_fixture` OUT of the test harness — do this FIRST, before adding a second fixture.**

  `tests/tm_header.rs` currently has:

  ```rust
  #[test]
  #[ignore = "regenerates a checked-in fixture"]
  fn regenerate_fixture() {
      let d = described("cons(1, cons(2, nil))", EncodingKind::Unary);
      let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/list_1_2.tm");
      std::fs::write(path, print_tm_with(&d.machine, &d.header)).expect("write fixture");
  }
  ```

  **This is miscategorised, and the mechanism disagrees with the marker.** `scripts/check-slow.sh` runs
  `cargo test --release --workspace -- --ignored`, which selects *every* ignored test regardless of its
  reason string — the script's header says the tier is "defined by `#[ignore = "slow tier: ..."]`", but
  `--ignored` cannot read the string. So a CI job whose purpose is verification **silently rewrites a
  checked-in source file.** Under `--all` it is worse: `regenerate_fixture` and
  `the_fixture_is_what_the_compiler_emits_today` live in the same binary, so if the regenerator runs
  first the drift check compares the fixture against a file it just wrote and passes unconditionally —
  the test that exists to catch codegen drift disarmed by the one beside it.

  A function that asserts nothing and writes to the source tree is not a test. Move it to
  `examples/regen_fixtures.rs`, which regenerates **both** fixtures (the unary one, and the binary one
  this task adds):

  ```
  cargo run --example regen_fixtures -p redextape-core
  ```

  Print each path written so the developer sees what changed. Then delete `regenerate_fixture` from
  `tests/tm_header.rs`, and update `the_fixture_is_what_the_compiler_emits_today`'s failure message —
  it currently says "regenerate with: cargo test … --ignored regenerate_fixture" — to name the example
  instead. **Confirm afterwards that `cargo test -p redextape-core --test tm_header -- --ignored --list`
  reports no tests**, so the slow tier no longer touches this binary.

- [ ] **Step 1: Add a binary fixture**, mirroring the unary one. `Binary::init_work()` lays out a real `#`-delimited bank, so this fixture is **the only one carrying a `tape 1` line** — the path that has never round-tripped through an actual file.

Add `the_binary_fixture_is_what_the_compiler_emits_today` plus an end-to-end `a_binary_tm_file_becomes_a_value_with_nothing_but_the_file` mirroring the unary one. Its regeneration is handled by the example from Step 0 — do **not** add a second `#[ignore]`d writer.

- [ ] **Step 2: Confirm the fixture actually has a `tape 1` line** — `grep '^tape 1' crates/redextape-core/tests/fixtures/list_1_2_binary.tm`. If it does not, the fixture is not exercising what this task exists for; stop and report.

- [ ] **Step 3: Write the proptest** in a new `tests/tm_header_proptest.rs`:

```rust
//! Optionality property 2 over GENERATED machines and headers, alongside the existing
//! `tm_bank_invariant` and `tm_width_equivalence` proptests.
//!
//! The generator must produce headers in the normal form `TmHeader::new` maintains — empty tapes
//! dropped, indices ascending, no duplicates — because a header outside that form is not a value the
//! type can hold, and asserting a round-trip over one would be asserting a property `TmHeader` does
//! not have.
```

Generate: a small machine (1–3 tapes, 1–4 states, validate()-clean names), an `EncodingKind`, a
`width` in `MIN_FIELD_WIDTH..=MAX_FIELD_WIDTH`, a `slots` in `0..8`, a `result` drawn from
`Nat`/`Bool`/`Unit`/`List<Nat>`, and 0–3 tape entries with non-empty cell runs over the tape alphabet
`['_', '#', '1', '0', '@']` at indices `< tapes`. Assert
`parse_tm_full(print_tm_with(&m, &h)) == (Some(m), Some(h), vec![])`.

- [ ] **Step 4: Run the proptest** with more cases than the default at least once: `PROPTEST_CASES=2000 cargo test -p redextape-core --test tm_header_proptest`. Report the count run.

- [ ] **Step 5: Full suite, then commit.**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/tests/
git commit -m "test(tm): a binary fixture, and property 2 over generated headers

The unary fixture carries no tape 1 line, because Unary::init_work() is
empty — so the multi-tape-line path had never round-tripped through an
actual file, only through the in-memory corpus check. Binary lays out a
real WORK bank, so the binary fixture is the one that exercises it.

The proptest generates headers in the normal form TmHeader::new maintains;
generating outside it would assert a property the type does not have."
```

---

### Task 8: A foreign reader — an independent simulator and decoder

**Files:** Create `tests/tm_foreign_reader.rs`.

**This task's value rests entirely on one discipline, and it is invisible in the finished code:** the simulator and decoder must be written from the **doc comments** in `syntax.rs` (the run semantics added in Task 4), `machine.rs`, and `unary.rs` — never by reading their implementations. A decoder copied from `unary.rs`'s code proves nothing about whether the format is documented well enough to reimplement. State this in the test file's header comment, because a later reader cannot otherwise tell.

- [ ] **Step 1: Read the docs, not the code.** Read `syntax.rs`'s module doc (including Task 4's run-semantics section), `machine.rs`'s `Machine`/`Rule`/`Move` docs, and `unary.rs`'s module doc describing how a value is represented. **If any of them is insufficient to write the reader, that is the finding** — report it rather than filling the gap from the implementation.

- [ ] **Step 2: Write the file.**

```rust
//! A FOREIGN reader: an independent simulator and an independent decoder, written from the
//! documentation rather than from the implementation.
//!
//! WHY THIS EXISTS. The header's whole claim is that a `.tm` file can be RUN by any simulator and,
//! given the encoding's semantics, INTERPRETED. Every other test in this tree checks that claim with
//! OUR simulator and OUR decoder, which share every assumption the writer had — so they can only show
//! that the code round-trips against itself.
//!
//! THE DISCIPLINE THIS TEST DEPENDS ON, stated because it is invisible in the finished code: the
//! simulator and decoder below were written from the DOC COMMENTS in `tm/syntax.rs`, `tm/machine.rs`
//! and `tm/encoding/unary.rs` — never by reading their bodies. A decoder copied from the
//! implementation would prove nothing about whether the format is documented well enough to
//! reimplement. If you change this file, hold that line.
//!
//! WHAT IT SHARPENS. The spec recorded the limit as "a foreign tool cannot INTERPRET its result."
//! What is actually true is narrower and more useful: the FILE does not carry the encoding's
//! semantics, so a reader needs the spec — and a decoder written from that spec works. This test is
//! that claim, made falsifiable.
//!
//! Imports `parse_tm_full` (that is the FORMAT, not the simulation) and nothing else from
//! `redextape_core::tm` beyond the plain data it returns. No `simulate`, no `Tape`, no `Encoding`,
//! no `decode_tape_ty`.
```

Implement:
- a `Tapes` struct: `Vec<Vec<char>>` plus `Vec<isize>` heads, growing blanks at either end (two-way,
  per the documented semantics);
- `step`: find the first rule whose `read` matches (a `None` entry is a wildcard), write (`None` =
  unchanged), move, go to `next`; no matching rule → halt;
- a run loop with a generous step cap;
- `decode_unary_nat(cells, slot)`: walk to the `slot`-th `#`, count marks to the next `#`;
- `decode_unary_heap(cells)`: split `@ head # tail` cells, counting marks.

Then the test: read `tests/fixtures/list_1_2.tm`, run it with the foreign simulator, decode with the
foreign decoder, and assert the value is `[1, 2]`.

- [ ] **Step 3: Report any documentation gap you hit** in Step 1 as a finding, with the specific fact you needed and where you expected to find it. **This is a primary deliverable of the task, not an aside** — the test passing is the secondary outcome.

- [ ] **Step 4: Full suite**, then `./scripts/check-all.sh --no-llvm` (this is the last task; the branch gate must be green). Report both numbers.

- [ ] **Step 5: Commit.**

```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
git add crates/redextape-core/tests/tm_foreign_reader.rs
git commit -m "test(tm): a foreign reader, written from the docs and not the code

Every other test checks 'any simulator can run this file' with OUR
simulator, which shares every assumption the writer had — so it can only
show the code round-trips against itself. This one reimplements the tape
mechanics and a unary decoder from the doc comments, and runs the checked-in
fixture to [1, 2].

It also sharpens the limit the spec recorded. 'A foreign tool cannot
INTERPRET its result' is false as stated; what is true is that the FILE
does not carry the encoding's semantics, so a reader needs the spec — and a
decoder written from that spec works. That is falsifiable; the original
phrasing was not."
```

---

## Self-Review

**Spec coverage.** A1→Task 1, A2→Task 2, A3→Task 3, A4→Task 4 (items 1–4), A5→Task 4 (items 6–7), B1→Task 5, B2→Task 6, B3+B4→Task 7, B5→Task 8. The `syntax.rs` module doc (B5's stated prerequisite) is Task 4 Step 8. All spec Testing items 1–6 are covered; item 1's "both directions" is Task 1 Step 1's second test, and item 2's sabotage is Task 2 Step 5.

**Placeholder scan.** No TBDs. Tasks 6, 7 and 8 describe code rather than supplying it verbatim — deliberate, because Task 8's value depends on the author deriving it from documentation (supplying the code would defeat the task), and Tasks 6/7 are conventional example/proptest shapes with the required behaviour fully specified. Every other task carries its code.

**Type consistency.** `MAX_TAPES: usize` (build.rs) matches `tapes: usize`. `MAX_DECODE_NODES: usize` threaded as `&mut usize`. `HEADER_VERSION: u32` matches the `version: Option<u32>` field. `TmHeader` gains no field in any task — checked against Tasks 5 and 7, which both touch it.

**One risk worth naming.** Task 3 may FAIL when first run — if a compiled machine or its header does not in fact round-trip exactly, that is a genuine defect the branch shipped, not a bad assertion. The task says to stop and report rather than weaken it. That is the only task here that could turn into an unplanned investigation.
