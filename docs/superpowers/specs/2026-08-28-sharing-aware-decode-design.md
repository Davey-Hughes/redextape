# Sharing-aware decode — design

**Slice:** `sharing-aware-decode`. An extension-track item, not on the critical path to v1; the
remaining v1 work is Plan 5's accessibility pass, which this does not touch.

**One-line statement of what this is:** the four decoders that turn a run's `(word, heap)` pair into a
`Value` re-walk every shared sub-list once per pointer into it, which is quadratic on ordinary output;
this makes all four memoize on the pair they are already keyed by, and bounds the working memory that
memoizing would otherwise leave unbounded.

**Why now.** The type-directed half was filed as open at the close of the TM-header slice
(2026-07-28), under "Still open after slice 2", item 1 — *"`decode_word_ty` is not sharing-aware …
a correct, fast, cap-respecting program can still be refused … The fix is memoizing on
`(pointer, type)`. **This applies to `decode_asm_ty` on the AOT path too** — a second consumer that
will not read this branch's specs."* That filing is right about the mechanism and understates the
blast radius by one whole family; see §3.

**Scope boundary, decided before anything else:** no new constant, no new public type, and no change
to what any decoder *answers*. Every entry point keeps its signature. Four gain `_reason` siblings,
one internal function is deleted, and `MAX_DECODE_NODES` keeps its value while its derivation is
rewritten.

---

## §1 The tree as it stands — verified 2026-08-28 at `26ea3c4`

Three internal decoders, in two families, behind six public entry points.

| family | internal fn | driven by | budget today | public entry points |
|---|---|---|---|---|
| type-directed | `asm::decode_word_ty` | `&Ty` | `MAX_DECODE_NODES` | `decode_asm_ty`, `decode_asm_ty_reason`, `decode_tape_ty`, `decode_tape_ty_reason` |
| value-directed | `asm::decode_word` | `&Value` | none | `decode_asm` |
| value-directed | `tm::decode::decode_word` | `&Value` | none | `decode_tape` |

`decode_word_ty` is `pub(crate)` and shared: `tm::decode` imports it rather than carrying a copy, and
its doc states why — *"a second budget/cycle-bound pair could silently disagree with this one."*

The two value-directed functions are a duplicate. They differ in three cosmetic ways and nothing else:
`Value::Nil` is spelled `if word == 0 { Some(Value::Nil) } else { None }` in `asm.rs` and
`(word == 0).then_some(Value::Nil)` in `tm/decode.rs`; the `Cons` bindings are named `exp_h`/`exp_t`
against `eh`/`et`; and the `asm.rs` copy carries an explanatory comment on the "expected a cons, got
nil" arm. Same arms, same order, same pointer arithmetic, same `usize::try_from` guard.

`decode_word_ty`'s doc justifies tolerating that duplicate, and the justification is the sentence this
branch falsifies:

> the VALUE-directed sibling below, `decode_word`, IS duplicated — `tm::decode` has its own copy
> rather than calling this one — but safely, since both recurse structurally on a finite reference
> `Value` already in memory and **need no budget at all**

Constants, all unchanged by this slice: `asm::DEFAULT_CAPS.heap` is `5_000_000`,
`MAX_DECODE_NODES` is `4 * DEFAULT_CAPS.heap` = `20_000_000`, `ty::MAX_TY_DEPTH` is `64`.

---

## §2 What ships

1. A per-call memo in the type-directed decoder, keyed `(pointer, depth)` (§4).
2. A per-call memo in the value-directed decoder, keyed `(pointer, expectation address)` (§5).
3. The budget charges one unit per **spine step** as well as one per constructed node, and the
   value-directed decoder gets a budget for the first time (§6).
4. `decode_asm_reason` and `decode_tape_reason`, so a refusal on the value-directed path is
   distinguishable from a wrong answer (§7).
5. `tm::decode::decode_word` is deleted; `decode_tape` calls `asm::decode_word` (§8).
6. `MAX_DECODE_NODES`'s derivation doc, and the falsified paragraph in `decode_word_ty`'s doc,
   rewritten to what is true after the above.

---

## §3 The measurement, and the part of it the filing did not predict

Reproduced with a `tails`-shaped result — `tails([1..m])`, whose inner lists all alias suffixes of one
spine, so `2m` heap cells carry `m² + m + 1` logical nodes. Not a crafted heap; it is what an ordinary
`tails` returns, because `Instr::Tail` is a pointer read rather than an allocation.

Release build, `Ty::List(Box::new(Ty::List(Box::new(Ty::Nat))))`, all three rows in **one** process,
RSS read from `/proc/self/status`'s `VmHWM` after each row:

| m | heap cells | logical nodes | type-directed | value-directed | RSS high-water |
|---|---|---|---|---|---|
| 1,000 | 2,000 | 1,003,001 | 41 ms | 37 ms | 125 MiB |
| 2,000 | 4,000 | 4,006,001 | 137 ms | 145 ms | 492 MiB |
| 4,000 | 8,000 | 16,012,001 | 544 ms | 652 ms | 1,959 MiB |

Doubling `m` multiplies time by 3.3× then 4.0× (type-directed) and 3.9× then 4.5× (value-directed) —
quadratic in both, with the sub-4 first step the usual small-input noise.

**Two caveats on the RSS column, because it is the figure most easily over-read.** `VmHWM` is a
high-water mark for the whole process, so each row's number is "the largest this process ever got by
the end of that row" rather than that row's own cost; the m = 4,000 row dominates it because the
earlier rows' values are dropped before it starts. And the run holds *both* decoders' results live at
once, since it asserts they are equal. Read 1,959 MiB as roughly 1 GiB per decode at m = 4,000 — on a
heap of 8,000 cells, which is 0.16% of `DEFAULT_CAPS.heap`.

**THE FILING NAMED THE WRONG FAMILY AS THE ONE THAT BITES.** Its closing sentence extends the finding
from `decode_word_ty` to `decode_asm_ty` — which is the same function reached through a second entry
point, not a second decoder. The second *decoder* is the value-directed one, it has the same quadratic
blowup, and its situation is worse in the way that matters: the type-directed path **refuses**
(`BudgetExhausted` at `m ≈ 4,471`, a wrong-but-safe answer), while the value-directed path has no
budget and so does not refuse. It allocates.

Its doc says the reference value's size is the bound. That is true of the reference value's *distinct*
nodes and false of what the walk constructs, and the two differ by a factor of `m` on this shape.
`interp.rs`'s `Builtin::Tail` arm returns `(**t).clone()`, and cloning a `Value::Cons(Rc, Rc)` bumps
two refcounts rather than deep-copying — so the reference value is itself a DAG, and the decoder
walking it expands the DAG back into a tree.

**And the failure mode is a panic, not a `None`.** The value-directed entry points are the oracle's:
`tm_oracle.rs` reads `decode_asm(&o, &reference).expect("asm decode")`, `llvm_oracle.rs` reads
`decode_asm(o, expected).unwrap_or_else(|| panic!("{label}: decode failed"))`, and
`redextape-native`'s own test reads `.expect("decode")`. Adding a budget to that path without §7
would convert an out-of-budget decode into a panicking oracle test whose message says the decode
failed and not why.

**Where these figures come from, stated plainly because the file they name does not exist yet.** They
were measured on `26ea3c4` with a throwaway `crates/redextape-core/tests/zz_scratch_sharing.rs`, which
is deleted before this branch's first commit. §11 rebuilds the same fixtures as
`crates/redextape-core/tests/sharing_aware_decode.rs`, and the command that reproduces this section
after that file lands is:

```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 -- \
  cargo test --release -p redextape-core --test sharing_aware_decode -- --nocapture --test-threads=1
```

The memory cap is not decoration: the thing being measured is unbounded allocation, and an unlucky
`m` without a cap takes the machine's swap with it.

---

## §4 The type-directed memo — key `(pointer, depth)`

**Depth identifies the type, and that is a property of this decoder rather than a convenience.**
`decode_word_ty` recurses in exactly one arm, `Ty::List(elem)`, and it recurses on `elem`. So the
types visited from the root form a suffix chain of the root type — `ty`, `elem(ty)`, `elem(elem(ty))`,
… — and the position in that chain names the type uniquely. A `usize` depth is therefore a complete
key, with no `Ty` hashing, no interning, and no `Hash` impl added to a public type.

The memo maps `(u64, usize) -> Value` and holds only list values. Leaves are not memoized: a `Nat`,
`Bool` or `Unit` costs one construction, and an entry costs a hash, a key and a clone.

Two moves beyond a plain memo. **The decode stays quadratic without either of them**, which is why
both are specified here rather than left to the implementation:

### §4.1 Suffix memoization

The cons-up loop already builds the list back-to-front, so at each step its accumulator *is* the value
of the suffix starting at one particular cell. Recording each of those, not just the finished list,
is what makes `tails` linear — `tails`'s m elements are precisely the m suffixes of one spine, so the
first element's decode populates every later element's answer.

This requires PASS 2 to carry each cell's pointer alongside its decoded head, where today it carries
only the head. That is `+8` bytes per entry on a `Vec` that already exists.

### §4.2 PASS 1 stops at a memo hit as well as at nil

A pointer in the memo has already been decoded, and a decode only completes on a chain that reached
nil, so a memoized pointer is proven finite and acyclic. PASS 1 may stop there.

Without this, the *node count* is linear and the *time* is not: two distinct spines that converge on a
shared tail each walk the whole shared tail in PASS 1, once per spine, while PASS 2 answers from the
memo. `tails` does not exhibit this — its aliasing is caught by §4.1 alone — so a test for it must be
written deliberately (§11.4).

---

## §5 The value-directed memo — key `(pointer, expectation address)`

`(u64, *const Value)`, taken with `Rc::as_ptr` at the two recursive sites and `expected as *const
Value` at the root.

**Why address identity is sound here, stated as the two ways it could be unsound and why neither
happens.** Two structurally-equal expectations at different addresses are different keys: the memo
*misses*, which costs time and cannot change an answer. Two *different* expectations cannot share an
address while both are alive, and `expected` is borrowed for the whole call, so nothing the memo has
keyed is dropped and its address reissued mid-decode.

The alternative — keying on the expectation's structure — is both slower (hashing a `Value` is
proportional to the thing the memo exists to avoid walking) and no more correct, since sharing is
exactly what address identity detects and structure does not.

---

## §6 The budget charges spine steps as well as constructed nodes

**The memo introduces a way to make progress without spending budget, and that is what needs
closing.** Today PASS 2's per-level `Vec` is bounded by the node budget, because every head that lands
in it spent a unit constructing something. A memo hit constructs nothing. Once hits are possible, that
`Vec` is bounded only by spine length × `MAX_TY_DEPTH` — 64 levels of up to 5,000,000 entries — which
is the same class of unbounded-working-memory hole this branch exists to close, one level down.

So: **one unit per constructed `Value` node, as today, plus one unit per spine step.** Both through
`spend`, so exhaustion is still tagged `BudgetExhausted` at the point of detection and no arm
re-derives it from `budget`'s value — the rule `DecodeFailure`'s doc establishes, unchanged.

The invariant to write into the code, because it is what makes the memo safe and it is not obvious
from either half on its own:

> Every memo entry is paid for by exactly one budget unit, so the memo cannot outgrow the budget.

### §6.1 The derivation, rewritten

`MAX_DECODE_NODES`'s doc derives its value from the largest flat list a correct program can produce.
That derivation changes and its conclusion does not.

A flat `List<Nat>` over an `L`-cell heap costs `2L + 1` today: `L` `Nat` leaves, `L` `Cons` nodes, one
`Nil`. With step charging it costs `3L + 1` — the same, plus one unit per spine step. A run under
`DEFAULT_CAPS` may legitimately build `DEFAULT_CAPS.heap` = `5,000,000` cells, so the largest
legitimate flat decode costs `3 × 5,000,000 + 1` = `15,000,001` against an unchanged
`MAX_DECODE_NODES` of `20,000,000`.

It fits, with 4,999,999 units of headroom, so no constant moves. **That headroom is the figure to
re-derive if `DEFAULT_CAPS.heap` ever rises**, and the doc says so: above `6,666,666` cells the flat
case alone would exceed the budget, where today's `2L + 1` tolerates `9,999,999`. The margin shrinks
from 2.0× to 1.33×.

### §6.2 The value-directed decoder gets a budget

Same rule, same constant, seeded per call the way `decode_asm_ty_reason` seeds it. It has never had
one; §3 is the measurement that says it needs one.

---

## §7 `decode_asm_reason` and `decode_tape_reason`

`decode_asm` and `decode_tape` keep returning `Option<Value>`, and every one of their existing callers
keeps compiling. Both figures below are at `26ea3c4`, each with the command that produced it:

```
62   occurrences outside the defining modules
       grep -rn 'decode_asm(\|decode_tape(' --include='*.rs' crates
         | grep -v 'src/tm/asm.rs\|src/tm/decode.rs' | wc -l
20   files containing them
       grep -rl 'decode_asm(\|decode_tape(' --include='*.rs' crates
         | grep -v 'src/tm/asm.rs\|src/tm/decode.rs' | wc -l
```

Those are textual occurrences, which is what the command measures — some are doc-comment mentions
rather than calls. The number is here to size the blast radius of a signature change, and for that
purpose an over-count is the safe direction.

Alongside them, `decode_asm_reason` and `decode_tape_reason` return `Result<Value, DecodeFailure>` —
the shape `decode_asm_ty` / `decode_asm_ty_reason` and `decode_tape_ty` / `decode_tape_ty_reason`
already establish twice, so this adds a pattern-instance rather than a pattern.

**This is what stops §6.2 from being a hazard.** `DecodeFailure`'s existing doc turns on the two
causes having opposite fault attributions; the oracle needs the same distinction for the same reason.
An oracle assertion that reads `Err(BudgetExhausted)` reports *the decoder ran out*, where today's
`.expect("asm decode")` on a `None` would report *decode failed* and leave the reader to guess between
a wrong machine and an exhausted decoder.

**Which call sites move, narrowed by counting them.** A first draft of this section said "the oracle
call sites move", which is 30-odd sites across five suites. Most of them are
`assert_eq!(decode_asm(&o, &rv), Some(rv))`, and a refusal there already prints `None` against
`Some(..)` — distinguishable from a wrong value without any change. Churning them buys nothing and
risks a test that passes for a new reason.

What actually misleads is the **panicking** form, where the message is the whole report. Six sites, in
the two suites named `*_oracle.rs` that use it:

```
4   crates/redextape-native/tests/llvm_oracle.rs
2   crates/redextape-core/tests/tm_oracle.rs
      grep -n 'decode_asm(\|decode_tape(' <file> | grep -E '\.expect\(|\.unwrap|panic!'
```

Those move to `X_reason(..).unwrap_or_else(|e| panic!("...: {e:?}"))`. Everything else — the
`assert_eq!` sites, the demos, and the library's own unit tests in `tm.rs`, `lower_asm.rs`,
`llvm.rs` and `redextape-native/src/lib.rs` — stays on the `Option` form. Those unit tests run
fixtures of a few dozen cells, where exhausting a 20,000,000-unit budget is not reachable.

---

## §8 Unification

`tm::decode::decode_word` is deleted. `tm::decode::decode_tape` calls `asm::decode_word`, which
becomes `pub(crate)`, exactly as `decode_word_ty` already is and for the identical reason: after §5
and §6.2 the two copies would each carry a memo and a budget, and *"a second budget/cycle-bound pair
could silently disagree with this one"* is `decode_word_ty`'s own stated argument for not doing that.

The paragraph quoted in §1 is replaced. What it should say instead: the value-directed decoder needs a
budget because a shared reference `Value` is a DAG whose walk is not bounded by its own node count,
and it is not duplicated, for the reason the type-directed one is not.

**The equivalence is pinned before the delete, not after** (§11.7). `decode_tape` and `decode_asm`
reach the same `(word, heap, expected)` triple by different routes, and the claim that the two copies
are interchangeable is a reading of two functions until a test runs both on the same input.

---

## §9 The decoded `Value` becomes a DAG

The memo stores a `Value` and clones it on a hit. Cloning a `Value::Cons(Rc, Rc)` bumps two refcounts,
so a memo hit *shares* rather than rebuilds — which is not a side effect of the fix, it is the fix:
the node counts in §11.1 are distinct-node counts, and they are what the budget now measures.

Logical value is unchanged and `Value`'s `PartialEq` is structural, so every existing equality
assertion holds without modification. The prototype asserts exactly this at m = 1,000 / 2,000 / 4,000
against today's decoder.

**Worth naming because it makes decoding cheap without making anything downstream cheap.** A consumer
that *walks* the result — `redextape-cli`'s printer — still sees the logical size, so a `tails` result
that now decodes in 23 ms still prints `m²`-ish nodes. That is not a regression: printing was always
the logical size, and nothing in this slice claims otherwise.

---

## §10 What the error behaviour preserves

- **Cycle → `Mismatch` is unchanged.** PASS 1 still runs to completion — or to the cycle bound —
  before any head of that spine is decoded, so a cycle cannot be starved by the cost of its own
  spine's elements. §4.2's new exit only *shortens* PASS 1, and only at a pointer already proven
  acyclic, so it cannot let a cycle through.
- **The "cycle wins against its own cost, never unconditionally" qualification is unchanged.** A
  cyclic list sitting behind a sibling that alone exhausts the budget still reports
  `BudgetExhausted`. Memoization makes that sibling cheaper and so makes the case rarer; it does not
  remove it, and the doc keeps saying so.
- **`Ty::Nat` and `Ty::Unit` still never `Mismatch`.** Step charging adds no failure arm to a
  non-recursing case.
- **A memo hit cannot fail.** It replays a decode that already succeeded, so it introduces no path on
  which a previously-`Ok` input becomes `Err`.

---

## §11 Testing

**The suite is split across two locations, and which test goes where is forced rather than stylistic.**
`decode_word_ty` is `pub(crate)` and the budget is one of its parameters, so anything asserting *how
many units a decode spends* has to live in `asm.rs`'s existing `#[cfg(test)] mod tests`, where the
count is readable directly. Anything asserting *what a decode answers* goes in a new integration test,
`crates/redextape-core/tests/sharing_aware_decode.rs`, against the public entry points. A first draft
of this section put the budget assertions in the integration file, where the only observable is
`Ok`/`Err` and every one of them would have had to be re-expressed as a refusal boundary — provable,
but it would have needed a 6,666,667-cell fixture to pin a constant that a unit test reads for free.

**In `asm.rs`'s unit tests** — budget accounting, seeded small so the fixtures stay small:

1. **The derivation is pinned as an equation, not an inequality.** A flat `List<Nat>` at `L` cells
   spends exactly `3L + 1`, at more than one `L` so a constant offset cannot pass.
2. **Convergent chains** — distinct spines sharing a tail, the case §4.1 alone does not fix. The
   answer is right with or without §4.2 and only the work differs, so the assertion is on units
   spent: linear in total cells, not quadratic.
3. **Every memo entry is paid for by exactly one budget unit** (§6's invariant), asserted as
   `memo.len() == units_spent_on_conses` on a fixture with known sharing.

**In `tests/sharing_aware_decode.rs`** — behaviour, through the public API:

4. **The test that could not pass before this branch.** A `tails` fixture at a size today's decoder
   refuses — `m = 64,000`, a 128,000-cell heap, `~4.1 × 10⁹` logical nodes against a 20,000,000
   budget. Asserts a successful decode and the expected value.
5. **Equivalence with today's answer** at every size today's decoder can still finish
   (m = 1,000 / 2,000 / 4,000), by structural `==`, across both families.
6. **Cyclic heaps still `Mismatch`**, including one reached *through* a memo hit — a cyclic list whose
   spine converges on a pointer the memo already holds, which is the shape §4.2's new exit could
   plausibly wave through and must not.
7. **Sabotage, and it is the one that decides whether the suite is worth anything.** Delete §4.1's
   suffix recording and assert test 4 goes back to refusing; delete §4.2's memo exit and assert test 2
   goes back to quadratic units. **Run both, and record the observed failure text in the closing
   entry** — the TM-header slice's own entry records a tape-flip sabotage that was found only when an
   implementer ran it, watched it fail to fire, and root-caused it rather than adjusting the assertion
   until it passed. A sabotage nobody executed is a paragraph, not a check.
8. **Pre-delete equivalence for §8.** `decode_tape` and `asm::decode_word` agree on the same
   `(word, heap, expected)`, asserted in the commit *before* the one that deletes the copy.
9. **Existing suites unchanged.** `cargo nextest run --workspace` — the oracle suites in particular,
   since §7 moves their call sites and §9 changes the representation they compare.

---

## §12 Risks

- **§7 rewrites oracle call sites.** The oracles are the project's correctness backbone; a mistake
  here is a test that passes for a new reason. Mitigated by making the move mechanical
  (`X.expect(m)` → `X_reason(...).unwrap_or_else(|e| panic!(...))`) and by test 8.
- **The memo's worst-case memory roughly doubles peak.** At a full 20,000,000-unit budget the memo
  holds up to 20,000,000 entries beside the values themselves. This is the same order as today's
  worst case rather than a new one — today's 20,000,000 constructed nodes are already ~1.2 GiB — and
  §6's invariant is what keeps it bounded at all.
- **`*const Value` keys read as unsafe and are not.** No pointer is dereferenced; they are compared
  and hashed. Worth a comment at the key type, because the next reader's first question is lifetime.
- **The `pub(crate)` widening in §8 makes `asm::decode_word` reachable from more of the crate.** It is
  the same widening `decode_word_ty` already carries.

---

## §13 What this does not close

- **`MAX_TY_DEPTH`-deep sharing is bounded, not free.** Distinct `(pointer, depth)` pairs are at most
  `heap.len() × (depth + 1)`, so a 5,000,000-cell heap under a 64-deep type can still present
  320,000,000 distinct nodes and be refused. That refusal is now *honest* — 320,000,000 distinct nodes
  is 320,000,000 nodes of real memory — where today's refusal fires on nodes that need not exist.
- ~~**Printing is untouched.** §9. A result that decodes in milliseconds can still print for a long
  time, and no cap in this slice reaches that.~~ **OVERTURNED — this was the slice's largest planning
  error, and it took two separate reviews to finish correcting.** §9 argued the DAG result was "not a
  regression; printing was already the logical size". The cost half is right and the conclusion is
  wrong: the decode budget used to refuse such a value before any printer saw it, so this slice
  removed a guard rather than leaving a cost unchanged. Task 11 added `value::MAX_PRINT_NODES` and
  `format_value_capped` and capped the CLI; its own review then found that only two of five CLI sites
  were covered, including the DEFAULT backend; and the whole-branch review then found the same
  uncapped printer still reachable from `redextape-wasm`'s `#[wasm_bindgen]` surface — i.e. from the
  browser playground — and in `redextape-native-rt`. All are now capped. `format_value` itself is
  unchanged, because the AOT oracle compares a compiled binary's stdout against it.
- **The λ decoder is out of scope, and reading its doc while writing this raised a question that is
  filed rather than answered.** `decode_list_ty`'s doc says no node budget is needed because
  *"`tm::decode_tape_ty` needs one because the TM heap is a GRAPH whose cells address each other; a λ
  normal form is a finite tree already in memory, so every walk terminates by construction."* That
  argument is about TERMINATION and it is correct. It is the same argument the value-directed TM
  decoder made — "a finite reference `Value` already in memory" — and §3 is the measurement showing
  that argument bounds termination without bounding cost. The specific thing to check, which this
  slice did not: the roadmap records under Plan 4's additions that *"the λ term is an `Rc`-shared DAG
  whose printed size is its LOGICAL size"*, which is exactly the property that makes a walk of it
  super-linear. `decode_list_ty` is iterative over the spine and recursive only into heads, so shared
  HEADS are where it would show. **Not measured, not claimed either way, and deliberately not fixed
  here** — widening to a third decoder family on an unmeasured suspicion is how a slice stops
  landing.
- **`Encoding`-level costs are untouched.** `parse_heap_cells` builds the `Vec<(u64, u64)>` this
  slice decodes *from*, and its cost is linear in tape length either way.
- **`Value`'s `PartialEq` and `Debug` walk the decoded value's LOGICAL size, not its distinct-node
  count, and nothing in this branch closes that.** Both are iterative over the `Cons` spine (bounded
  the same way `Drop`'s worklist is) but recurse into heads with no `Rc::ptr_eq` short-circuit, so a
  shared head reached from two spine positions is walked in full both times — comparing or
  `Debug`-formatting a DAG-shaped decoded value costs its logical size, exactly the quantity
  `MAX_PRINT_NODES` exists to bound for printing. `MAX_DECODE_NODES` plus `MAX_PRINT_NODES` do not
  close this hazard class; they close the two paths this branch's own decoders and printers take.
  **Currently safe, and deliberately left as a comment rather than a fix:** neither `redextape-cli`
  nor the WASM UI ever compares or `Debug`-formats a decoded value — every such site in this workspace
  is test or oracle code on small, trusted programs. The one place this exact gap is exercised at
  scale is this branch's own `tails_decodes_far_past_the_unmemoized_budget`
  (`crates/redextape-core/tests/sharing_aware_decode.rs`), which compares two `m = 64,000` values with
  `==` — an O(m²) walk that is CPU-bound rather than memory-bound, and completes, but is not free.

---

## §14 Open questions

None blocking. One noted for the implementer: whether the memo should be a `HashMap` or a
`Vec<HashMap<u64, Value>>` indexed by depth is a measurement, not a design decision — the second
avoids hashing the depth and is bounded by `MAX_TY_DEPTH` entries. Take whichever the fixture in
§11.1 prefers, and record which and by how much.
