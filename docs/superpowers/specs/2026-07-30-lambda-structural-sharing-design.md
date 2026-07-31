# λ-term structural sharing — design

**Status:** designed 2026-07-30; **layers 0, 1 and 1.5 landed 2026-07-31** and their numbers are recorded
in §2, §3 and §10 (which §3 corrects in one place — the across-trace ratio). **Layers 2 and 3 are
deliberately not planned**, on layer 1.5's evidence: §10 records that 86.8% of the nodes the reducer
visits — and 95.6% of the ones it *constructs*, the bucket that is 90.8% of all nodes and **99.7% of
the time** — are `subst` re-copying the argument under every binder, which neither layer addresses.
(An earlier draft called that bucket "the half that costs time". "Half" understates it by a factor
that matters: read-only nodes are the other 9.2%, and they cost 0.3%.)
Implements the `Rc<LambdaTerm>` item the Plan 4 producer slice
deferred ("**`Rc<LambdaTerm>` remains the λ performance fix**, not checkpoints" — roadmap, Plan 4
scope table). Supersedes that entry's framing of the problem size; see §2.

**Scope:** `redextape-core` only. Zero new dependencies. No printed byte moves.

## 1. Why this slice exists

`reduce_step` rebuilds the redex spine as `App(Box::new(f2), a.clone())` (`reduce.rs:107`, `:110`).
`LambdaTerm` was `Box`-based when this was written, so `a.clone()` **deep-cloned the untouched sibling
subtree at every level of the path**. A redex 30 deep cloned ~30 subtrees, and the same shape recurred
in `subst`/`shift`. (Past tense since 2026-07-31: layer 1 replaced the representation. The diagnosis
stands as written — it is what the fix was aimed at — and what it bought is in §2.)

That diagnosis is inherited from the Plan 4 design's §7 and is not re-derived here. What *is* new is
the measurement of how bad it actually is, and a second finding that changes the answer.

## 2. Correction: the Plan 4 figure was row 9 of 46, not the worst case

Plan 4's design and the roadmap entry both cite λ `sum(5)` at **99 ms** and conclude it is "a visible
hitch on a scrub, not a hang." Measured across the *whole* first-order corpus rather than two hand-picked
programs, that is the wrong end of the distribution.

**Updated 2026-07-31 with layer 1's result.** `before` is this table as it stood on `main`; `after` is
the same probe, same machine, on the converted code.

| # | program | steps | before (`Box`) | after (`Rc`) | factor |
| --- | --- | --- | --- | --- | --- |
| 9 | `sum(5)` — the figure Plan 4 quoted | 626 | 116 ms | 41.6 ms | 2.79x |
| 26 | `fold([3,1,2].map(add1), 0, add)` | 555 | 197 ms | 69.4 ms | 2.84x |
| 10 | `count_down(4)` | 474 | 376 ms | 139.2 ms | 2.70x |
| 33 | `ev/od` CPS mutual, `ev(3, id)` | 270 | 395.8 ms† | 182.0 ms | 2.17x |
| 7 | `let mut n = 4; … while n > 0 { … }` | 470 | 473 ms | 180.4 ms | 2.62x |
| 28 | `is_even/is_odd`, `is_even(4)` | 367 | 490.6 ms† | 223.4 ms | 2.20x |
| 32 | `ev/od` CPS mutual, `ev(4, id)` | 377 | 519.8 ms† | 234.0 ms | 2.22x |
| 29 | `is_even/is_odd`, `is_even(5)` | 502 | 592 ms | 266.8 ms | 2.22x |
| **31** | **`s0/s1/s2` three-way mutual, `s0(4)`** | **411** | **2,580 ms** | **1,216.7 ms** | **2.12x** |

Seven of 46 programs exceeded 350 ms (rows 7, 10, 28, 29, 31, 32, 33) and the worst was **2.6 seconds**.
That is a hang, not a hitch. The
conclusion Plan 4 drew from 99 ms — that the cost did not block its own slice — remains correct; the
characterisation of the cost does not. **After layer 1, one of 46 exceeds 350 ms** — row 31, and it is
still a hang; see §3's "what layer 1 did and did not fix".

The `steps` column is identical before and after, as is every structural column the probe prints, on all
46 rows (§3). The two runs describe the same reductions, differing only in how the terms are stored.

Instrument: `crates/redextape-core/examples/lambda_sharing_probe.rs`, release, best of three.
`before` for rows 9, 26, 10, 7, 29 and 31 is this table's original recorded baseline. † Rows 33, 28 and
32 were counted in the "seven of 46" sentence but never had a figure recorded, so theirs comes from a
re-run of the probe at `8fa6832` — the commit before the conversion — on the same machine in the same
session as the `after` column. That re-run reproduced all six recorded figures within 1% (115.7, 195.3,
377.0, 475.9, 596.4, 2582.1 ms), which is what licenses two sources in one table.

## 3. The finding that changed the design

The obvious fix is `Rc`: share the untouched siblings physically, and spine rebuild becomes O(path).
The question this design had to settle first is whether **interning** (hash-consing — deduplicating
*structurally identical* subterms, wherever they occur) is worth more than plain `Rc`.

That was settled by measurement, not preference, and **without implementing either**. The probe runs
hash-consing's own algorithm offline over the terms the reducer produces — `Box`-based when this was
written, `Rc`-based since layer 1, and the probe's counts are identical either way (see "the structural
columns did not move", below): a bottom-up pass keyed on already-interned children, so each node is
keyed in O(1) from its children's ids.

Two ratios come out:

- **across-trace** — Σ nodes over every step's term ÷ distinct subterms across all of them. This is the
  ceiling for sharing of any kind. Measured 2.6x–372x across the corpus.

  **This bullet claimed the ratio "does not discriminate, because `Rc` already captures the bulk of it".
  Layer 1 measured that, and the conclusion is false wherever it has since been measured.** It was an
  inference drawn when no `Rc` allocation existed to count; those now exist for rows 9 and 7, and on
  those two rows what `Rc` *leaves* is still an order of magnitude above the structural floor. The
  qualifier is not decoration: the printed ratio **alone** still cannot decide the question, because on
  the other 44 rows nothing has counted the allocations, so nothing says how much of the number `Rc` has
  already taken. What discriminates is the **residual after `Rc`**, and that exists for two rows. See
  the correction below.
- **within-term** — nodes of a single term ÷ distinct subterms inside *that* term. This counts subterms
  that are structurally identical but were **built separately**, which `Rc` cannot share and interning
  can. It was the only discriminating number available before layer 1 shipped, and it still decides the
  question on its own; the correction below adds a second, independent route to the same answer.

The prediction going in was that within-term would be ~1.0x, closing the question. It is not:

| # | program | max term | distinct | **within-term** |
| --- | --- | --- | --- | --- |
| 12 | `is_empty(nil)` | 16 | 12 | 1.33x |
| 0 | `1 + 2 * 3` | 46 | 29 | 1.59x |
| 9 | `sum(5)` | 1,213 | 117 | 10.4x |
| 26 | `fold(map(…))` | 2,921 | 137 | 21.3x |
| 31 | `s0/s1/s2` | 4,898 | 148 | 33.1x |
| 10 | `count_down(4)` | 8,883 | 146 | 60.8x |
| 7 | `while` loop | 9,763 | 152 | **64.2x** |

**The `distinct` column is the finding.** It never exceeds ~155 anywhere in the corpus, whether the term
holds 16 nodes or 9,763. The count of distinct subterms is bounded by the program's *encoding
vocabulary* — Church numerals, Scott constructors, the `Y` combinator, the arithmetic gadgets — not by
how far the reduction has run. Corpus-wide: 43,580 within-term nodes collapse to 2,994 distinct (14.6x).

### Correction (2026-07-31): the across-trace ratio's **residual after `Rc`** *does* discriminate, by 10x–50x where allocation counts exist

The across-trace bullet above was argued away on the grounds that `Rc` already captures the bulk of it.
That was an inference, not a measurement — before layer 1 there were no `Rc` allocations to count.
Layer 1 produced them, and `tests/lambda_sharing.rs` counts them. The inference does not survive.

Three independent measurements of one program's whole trace, from two instruments:

| `sum(5)`, whole trace | count | what it is | source |
| --- | --- | --- | --- |
| logical nodes | 502,146 | every node of every step's term, walked | probe row 9, `trace nodes` |
| distinct `Rc` allocations | 140,529 | what `Rc` sharing actually achieves | `tests/lambda_sharing.rs` |
| distinct structural subterms | 13,590 | what interning would achieve | probe row 9, `distinct` |

`Rc` removes **72.0%** of the logical nodes (502,146 → 140,529 — a 3.57x collapse). Interning would then
remove **90.3% of what `Rc` leaves** (140,529 → 13,590): a further **10.3x**, on top of `Rc` rather than
instead of it. The two factors multiply out to the probe's across-trace 36.9x exactly, because that is
what the decomposition is. Row 7 — the other program the sharing gate pins — is the same shape, further
out:

| row 7 (`while` loop), whole trace | count | against the line above |
| --- | --- | --- |
| logical nodes | 1,379,187 | — |
| distinct `Rc` allocations | 185,459 | 7.44x — `Rc` removes 86.6% |
| distinct structural subterms | 3,710 | **50.0x** — interning removes a further 98.0% |

So on the two programs where all three counts exist, `Rc` removes 72%–87% of the logical nodes and
interning would remove a further 90%–98% of the remainder: **10.3x to 50.0x beyond `Rc`**. This
*strengthens* the case for layer 2 by a second, independent route — the within-term ratio reaches the
same verdict from a different quantity — where the bullet above argued it away.

**The two 10.x figures on row 9 are different measurements that happen to land close.** Row 9's
within-term **10.4x** (the table above: one term's nodes over its distinct subterms) and its **10.3x**
residual here (a whole trace's `Rc` allocations over its distinct subterms) are near-identical by
coincidence on this one row, not by identity — different quantities over different scopes, which is
exactly why the second route counts as independent evidence rather than as a restatement of the first.
`tests/lambda_sharing.rs:100-106` already records the arithmetic relating them (`3.57 × 10.37 ≈ 37.0`
against the probe's across-trace 36.9x) as an approximation rather than a proven relationship, and on
row 7 it does not hold: 7.44 × 64.2 ≈ 478 against the probe's 371.7x.

**Stated exactly, because overstating it is the failure mode here.** The "bulk" clause was fair on its
own terms: `Rc` does remove most nodes. What was false is the conclusion drawn from it, that the ratio
"proves nothing about interning" — what survives `Rc` is still an order of magnitude above the
structural floor, and that gap is precisely interning's territory. Three limits on the claim:

1. It is an **allocation/memory** argument and nothing more. "The limit of this evidence" below stands
   unchanged: `subst`/`shift` still traverse the whole abstraction body, and under de Bruijn a shifted
   copy carries *different indices*, so it is a structurally new term that interning does not dedupe. A
   memory win is not automatically a speed win.
2. The counts are **nodes, not bytes**. A real hash-cons carries a table entry per distinct node, so the
   memory win is smaller than the allocation-count win.
3. Two programs, not 46. `tests/lambda_sharing.rs` pins allocation counts for rows 9 and 7 only; the
   corpus-wide version of this table does not exist and would need the gate extended to produce it.

**The probe carried the same error, in three places, and is corrected here rather than left stale.**
`examples/lambda_sharing_probe.rs`'s module doc, the "HOW TO READ THIS" legend it prints **at
runtime**, and the inline comment at the across-trace computation itself (`:539-541`) all said the
across-trace ratio "does NOT discriminate" and that "a big number here does NOT
justify interning" — inherited from this section, and the runtime one meant anyone re-running the probe
read a measured-false claim in its own output. (This sentence said "two places" until 2026-07-31 and
undercounted the inline comment; **all three are corrected in the shipped probe** — only the count here
was wrong.) All three now say what replaces it: **the across-trace column
alone still cannot decide whether interning is worth it**, because `Rc` takes an unmeasured share of it;
where that share has been counted — rows 9 and 7, via `tests/lambda_sharing.rs` — the **residual after
`Rc`** is what discriminates, by 10x–50x. What none of them may say is that a big number there *justifies*
interning: that is false on the other 44 of 46 rows, which have no allocation count at all, and it is
the specific error this correction exists to prevent. The probe was reviewed and approved in its earlier
state, and correcting its text changes no code, no constant and no computed column, so this slice stays
documentation-only. (`tests/lambda_sharing.rs` never shared the error — it says the across-trace ratio
is "the WRONG axis *for this gate*", which is true and is the distinction above.)

### What layer 1 fixed, and what it did not

`Rc` bought a uniform **2.1x–2.8x**, on the nine heaviest programs (§2). The spread across those nine
rows is 2.12x to 2.84x, so it is not program-shape-dependent.

**The worst case is still a hang.** Row 31 went 2,580 ms → **1,216.7 ms**. Against a 16 ms frame budget
that is ~76 frames of dead UI on one scrub. The distribution improved a great deal — seven of 46
programs over 350 ms became one — but the number that decides whether λ scrubbing is usable did not
cross the line. It halved and stayed on the wrong side. Layer 1 was never going to be sufficient alone,
and §7 makes layer 1.5 a gate for exactly this outcome.

**The unexplained outlier got worse, not better.** Below, this section records row 7 running 5.5x faster
than row 31 despite being larger by every available measure. After the conversion that gap is **6.7x**
(180.4 ms against 1,216.7 ms; 5.4x on the same machine's pre-conversion re-run). Whatever dominates row
31 is therefore something `Rc` does not touch, and it now dominates by a wider margin. That promotes
layer 1.5 from "explain an anomaly" to "explain what is left": 1,216.7 ms of the corpus's worst case is
unaccounted-for by any diagnosis this design has made.

**The structural columns did not move**, on any of the 46 rows — `steps`, `trace nodes`, `distinct`,
`max term` and its `distinct` are identical before and after, with corpus totals of 7,435,004 trace
nodes and 43,580 within-term nodes over 2,994 distinct (14.56x) either side. `intern_term` descends into
both children of every `App`, so a subterm reached twice is walked twice whether the two edges are two
`Box`es or two handles on one allocation: the pass measures the **logical** tree, and structural sharing
changes only how that tree is stored. (The probe's module doc records the same thing.) Movement in those
columns would have been a structural bug, not a result — which is why they were checked before the
`replay ms` column was believed.

**One cost-side number moved in interning's favour.** The intern pass's own throughput improved: across
the nine rows in §2's table it went from **73–81 ns/node to 58.9–65.1 ns/node**. The `before` band has
one source only — the `8fa6832` re-run described in §2's sourcing note, since the original baseline
recorded no `ns/node` — and the `after` band is quoted to the rows that bound it: 58.9 on row 26 and
65.1 on row 9. **Both bands are single-pass figures and carry §10's caveat**, which every other
timing-derived number in this document states and this paragraph did not until 2026-07-31: `ns/node` is
not best-of-three like `replay ms`, so it moves a few percent between runs on the same machine and the
identity of the two bounding rows can move with it. Re-derive the band rather than reconciling a re-run
against these two rows. The *direction* is what the paragraph rests on, and that is not at stake — the
whole band moved down. The improvement is consistent with a shared
subterm being walked repeatedly out of cache rather than out of freshly allocated memory. The
~70 ns/node quoted below is therefore now conservative on exactly the programs the cost argument is
about.

### Why this number is trusted

A silently-wrong interner produces exactly this shape (over-merging inflates the ratio), so the probe
verifies itself before printing, and aborts rather than warns:

1. Four hand-built terms whose distinct counts are countable by eye — including two **non-vacuity**
   cases: name hints must *not* split a class (`\x. x` ≡ `\y. y`), and genuinely different subterms must
   *not* collapse.
2. An O(n²) recount of the same subterms using `LambdaTerm`'s **own `PartialEq`** — no hashing, no ids,
   nothing shared with the intern pass but the traversal — on **46 real reduction terms**, requiring
   exact agreement.

### The cost side, and what it is not

Measured ~70 ns/node for the intern pass. That is an **overestimate of steady-state cost**: the probe
builds a per-call address→id `HashMap` that a real hash-cons does not need, since children arrive
already interned. Steady state is one hash plus one map probe per constructed node — call it 20–30 ns
against the **~35 ns/node** the reducer already pays to construct one (§10's fitted allocating price).
At 64x fewer nodes that is strongly net-positive on the large programs and roughly break-even on the
small ones.

**That denominator is a correction.** This line read "the ~4 ns allocation it replaces" until 2026-07-31,
a figure nothing in this tree ever measured. It made the *measured* comparison — the intern pass at
~60 ns/node against the reducer's ~35 ns/node — look like a 15x gap where it is **~1.7x**, and the two
numbers are apples to apples: each is a whole-traversal cost, walking a node and paying for it, not a
bare `Rc::new`. §10's PART C.2 is where the 35 comes from and §10's layer-2 paragraph quotes the pair.

### The limit of this evidence, stated so the table is not over-read

**The probe measures sharing (memory). It does not measure speed.** Interning collapses storage and
makes `PartialEq` O(1), but `subst`/`shift` still traverse the whole abstraction body — and under de
Bruijn a shifted copy carries *different indices*, so it is a structurally new term that interning does
not dedupe. Converting 64x fewer *distinct* nodes into 64x less *work* requires **memoized traversals
keyed on interned ids**, which is a further change interning enables and `Rc` does not.

**And one outlier is unexplained.** Row 7 has bigger terms (9,763 vs 4,898) and more steps (470 vs 411)
than row 31, yet runs **5.5x faster** (**6.7x** after layer 1 — the gap widened; see "what layer 1 fixed,
and what it did not", above). Node count therefore does not predict replay time, and something
else dominates. Until that is understood, no speed projection for layers 2 or 3 below is trustworthy —
which is why §7 makes explaining it a gate rather than a nice-to-have.

## 4. The type

```rust
/// Public handle. Cloning is one refcount bump at EVERY level, root included.
#[derive(Clone)]
pub struct LambdaTerm(Rc<Node>);

pub enum Node {
    Var(u32),
    Abs(Rc<str>, LambdaTerm),
    App(LambdaTerm, LambdaTerm),
}

impl LambdaTerm {
    pub fn node(&self) -> &Node { &self.0 }
}
```

Four decisions worth stating, each with the alternative it beat:

- **A newtype, not `Rc` children on the existing enum.** `Abs(Rc<str>, Rc<LambdaTerm>)` /
  `App(Rc<..>, Rc<..>)` would fix the measured deep-clone with near-zero churn — match sites keep
  working by auto-deref. It was the recommendation until §3's measurement landed. It loses because it
  **cannot carry an id or a cached hash without adding a field to every variant**, so layers 2 and 3
  would require converting the type a second time — after Plan 5's WASM crate has begun consuming it,
  when breaking a public type stops being free. The newtype can swap `Rc<Node>` for an interned handle
  **without touching a single match site again**.
- **The name stays `LambdaTerm`.** No `use` in any consumer changes; only match sites do
  (`match t {` → `match t.node() {`).
- **`Node` is `pub`.** Five modules in `src/` and seven test/example files match on the variants. A
  private inner enum would require a parallel view type for no gain.
- **No `Deref` to `Node`.** `.node()` is explicit, so the indirection is visible at every match site
  rather than inferred. Deref-to-enum reads as magic in exactly the code that most needs to be literal.

Children are `LambdaTerm`, not `Rc<LambdaTerm>`, so there is exactly **one `Rc` per node**.

**`Rc`, not `Arc`.** WASM is single-threaded, and the crate already establishes the pattern: `value.rs`
holds `Rc<Frame>` / `Rc<Value>` / `Rc<Core>` and `Value` is deliberately `!Send`. `Arc` would buy
nothing this crate uses and cost an atomic on the hottest operation in the reducer.

**`Rc<str>` for the `Abs` name hint, not `String`.** The hint is print-only and `PartialEq` ignores it;
`String` would make every clone allocate, defeating the point at the root. `abs(name: impl Into<Rc<str>>)`
accepts `&str` and `String` alike, so no call site changes.

## 5. Blast radius

| File | Change |
| --- | --- |
| `lambda/term.rs` | the type, `shift`/`subst`/`beta`, `PartialEq` (+ `ptr_eq` fast path), `Drop`. `var`/`abs`/`app` keep their signatures. |
| `lambda/reduce.rs` | `reduce_step`'s spine rebuild (`:107`, `:110`) becomes refcount bumps — the measured cause |
| `lambda/lower.rs`, `decode.rs`, `encode.rs`, `syntax.rs` | mechanical `.node()` at match sites |
| `trace.rs` | `LambdaCursor::new`'s `t.clone()` becomes a bump |
| `lambda/decode.rs` (the `decode_lambda_ty_is_iterative_over_the_list_spine` test) | build the term **inside** the spawned thread — `Rc` makes `LambdaTerm` `!Send`, and this test currently *moves* one across a `spawn`. Verified to be the only such site in the workspace. See below. |
| 7 test/example files | same mechanical `.node()` change |

**The `decode.rs` test, resolved explicitly rather than left to the implementer.** Today it builds a
5,000-cell Scott list on the main thread and *moves* it into a 256 KiB thread, so only the decode is
measured against the small stack — deliberate, and stated in that test's own doc comment. `Rc` makes
that move illegal. The resolution is: **build the term inside the thread**, raise `stack_size` to the
smallest multiple of 256 KiB that passes with construction included, and rewrite the doc comment to say
the test now covers build + decode + drop rather than decode alone. Not "keep it at 256 KiB and hope" —
`scott_list_nf`'s own stack cost is unmeasured, so the new size is derived empirically and committed as
a number, the way the rest of this tree commits measured constants. The assertion still extracts through
`nat_list_to_vec`, so the subject of the test is unchanged even though its coverage widens.

## 6. The `Drop` rewrite — the part that can actually go wrong

`term.rs` gives `LambdaTerm` a hand-written iterative `Drop` because the compiler-generated
`drop_in_place` recurses once per node and aborts the process on a deep term. That constraint does not
relax; the mechanism must change.

The worklist may descend into a child **only when it uniquely owns it**: `Rc::into_inner` returns `Some`
exactly then, and a shared child is simply decremented. Getting this wrong is a stack-overflow abort,
silently, only on large inputs.

### Corrected 2026-07-31: `Drop` stays on `LambdaTerm`. It does **not** move to `Node`

**This section originally specified "`Drop` moves to `Node` — dropping a `LambdaTerm` is a decrement,
and only reaching zero matters". The first clause is false of the shipped code and the design behind it
does not terminate.** It is corrected here because §6 is the section a future implementer reads for the
destructor, and it was the only part of this document still carrying the superseded shape.

The shipped destructor is **`impl Drop for LambdaTerm`** (`term.rs:181`), and `Node` deliberately has no
`Drop` at all. Three things follow, none of which the `Node` version can have:

1. **A `Node`-level `Drop` never terminates.** The walk opens by allocating a placeholder `blank = var(0)`,
   which is itself a handle; under a `Node`-level `Drop` the placeholder's own teardown re-enters the
   same destructor and allocates another. `drop(var(0))` alone aborts the process immediately — not a
   large-input-only defect. The plan records this as tried and rejected, with the verbatim reproduction:
   `plan.md`'s Task 2, Step 4, "**This design was tried and does not terminate — do not build it**".
2. **The `Node::Var(_)` leaf guard is what terminates the cascade** and is the second of the shipped
   destructor's two opening guards. `blank` re-enters `drop`, and a `Var` has no children, so returning
   before the placeholder is allocated is what stops the recursion. The first guard —
   `Rc::strong_count(&self.0) != 1` — is redundant for correctness (`Rc::get_mut` enforces it anyway) and
   load-bearing for cost, since the overwhelmingly common drop in the reducer is of a non-final clone.
3. **Keeping `Node` free of `Drop` is what makes the walk O(1) allocations.** `Rc::into_inner`'s result
   can then be destructured **by value**, so children move straight onto the worklist and nothing below
   the root needs a placeholder — moving a field out of a `Drop` type does not compile. Under a
   `Node`-level `Drop` each popped node allocates a placeholder of its own: O(nodes), exactly what the
   `Box` version cost.

§10's closing bullet depends on this shape and states the same thing from the other side: teardown
descends only through `Rc::into_inner`, so it visits each **allocation** once and is bounded by
allocation count rather than by logical size — the one traversal of the five that the logical-vs-physical
hazard does not expose.

**`lib.rs`'s `drop_tests` module covers `Core`, `Expr`, `Value` and `LetRecGroup` on a 512 KiB stack and
has no `LambdaTerm` case at all** — the invariant has been asserted in a doc comment and tested only
incidentally, via `decode.rs`'s small-stack test. **Five cases join it** (this read "two" until
2026-07-31, which was the design's count and not the shipped one), because `Rc` adds a second failure
mode to the one that already existed and each unlink has to be independently falsifiable:

1. a 40,000-deep **uniquely owned** `Abs` chain — the pre-existing invariant, finally tested directly;
2. a 40,000-deep `App` chain deep via **`f`**, the left child;
3. its twin, deep via **`a`** — the `App` arm unlinks *two* children, and a destructor that forgot `a`
   still passes case 2, because there `a` is always a shallow `var(1)` the compiler's glue frees in O(1);
4. a 40,000-deep chain in which **every** child is shared (`App(c, c)` over one allocation) — unreachable
   under `Box`, and the case that catches a walk which unlinks only uniquely-owned children;
5. a 40,000-deep chain **shared partway down** (refcount > 1 at exactly one interior node) — the
   invariant `Rc` introduces, where the walk must stop unlinking and merely decrement, and the only one
   of the five with a survivor to check for truncation.

## 7. The layers

Each layer is a separate commit carrying its own numbers, and layers 2 and 3 are **provisional by
construction** — kept only if measured, reverted otherwise. There is deliberately **no wall-clock gate**:
the project gates on deterministic counts and reports time in `examples/`, and this slice does not
change that.

| Layer | Change | Kept if |
| --- | --- | --- |
| 0 | the probe + recorded baseline | **done** — §2 and §3 are its output |
| 1 | newtype, `Rc`, `Rc<str>`, `Drop` rewrite, `ptr_eq`, the `decode.rs` thread fix | **done** — 2.1x–2.8x, §2 |
| 1.5 | **explain row 31's remaining 1.22 s** (2.58 s before layer 1): instrument what actually dominates reduction time | **done** — §10 is its output |
| 2 | interning (hash-cons) behind the newtype | measured win > measured cost — **not planned**, §10 |
| 3 | memoized `subst` / `shift` / `depth_exceeds` over interned ids | measured — **not planned**, §10 |

**Layer 1.5 is a gate, not padding.** §3 records that node count does not predict replay time and that
row 7 is 5.5x faster than row 31 despite being larger by every available measure. Layer 3 is *entirely*
a speed bet, and layer 2's justification is memory with a speed corollary. Neither can be evaluated
against an unexplained 5.5x — **now 6.7x**, since layer 1 shipped and the gap widened rather than
closing (§3). **Answered 2026-07-31 in §10, and the answer is neither layer's: 86.8% of the nodes visited are
`subst` deep-copying the argument once per binder in the body. Layers 2 and 3 stay unplanned on that
evidence, which is what this gate was for.**

A candidate for layer 2's remaining cost, noted so it is measured rather than assumed: `trace.rs:73`
calls `depth_exceeds` over the whole term **every step**, an O(size) walk. At today's ~1,213-node terms
that is ~3% of replay time and correctly ruled out by Plan 4 as the cause; once the clones are gone it
becomes a much larger share, and on row 7's 9,763-node terms it is not small in absolute terms either.
**The clones are now gone**, so this is a live candidate for layer 1.5 rather than a prospective one —
and note that `depth_exceeds` walks the *logical* expansion, which §10 records is no longer the same
thing as the allocation count.

**Measured (§10), and the answer is: right direction, wrong quantity, wrong conclusion.**
`depth_exceeds` is **9.1% of the nodes** the corpus traverses today — but **0.3% of the time**, because
it only *reads* nodes and §10's PART C.2 measures a read node at ~1 ns against ~35 ns for one the
reducer *constructs*. After §10's `subst` fix it becomes 64% of the remaining **nodes** and about **5%
of the remaining time**, and the largest remaining cost is `beta`'s closing `shift(-1, 0, …)` instead.

Two things are being kept apart here that an earlier draft of this paragraph ran together. The ~3%
above is a per-row *time* estimate; the 9.1% is a corpus-wide *node* share. They are not the same
quantity and the draft compared them as "right direction, wrong size" — which was wrong twice over,
since the corrected time share (0.3%) is *smaller* than the ~3% it was said to exceed. **A node share
is never a time share until a price has been measured.** Layer 3's `depth_exceeds` component is
therefore the weakest of the candidates, not the strongest; §10's closing table has the ranking.

## 8. Testing

- **The primary gate is behaviour preservation.** Every existing golden, oracle, round-trip, proptest
  and fixture passes **unedited** — the same evidence standard the Plan 4 producer slice held itself to
  ("no printed byte moved"). Anything requiring an edited expectation is a defect in this slice until
  shown otherwise.
- **Sharing gate** — deterministic and machine-independent, so it belongs in CI where a timing gate
  would not. Collect `Rc::as_ptr` over every step's term of a `reduce_trace` into a `HashSet` and assert
  two things about the count:
  1. **Non-vacuity:** it is strictly below the total node count. A trace that shares nothing fails.
  2. **A pinned number** per chosen corpus program, committed alongside the node total — the idiom this
     tree already uses for step counts (`step_survey.rs`'s committed figures). A regression *moves* the
     number rather than merely staying under a threshold, which is what makes it a gate and not a
     smoke test.

  Deliberately **not** phrased as "O(steps) allocations": each step constructs O(path) spine nodes
  *plus* whatever `beta` builds, so the true bound is not linear in steps and asserting that it is would
  be wrong. This is the property that makes trace snapshots cheap, pinned by measurement rather than
  inferred from the representation.
- **THERE IS NO EXCEPTION TO "UNEDITED", §10's `subst` fix included — and an earlier draft of this
  bullet asserted the opposite.** That draft named the four constants pinned in
  `tests/lambda_sharing.rs` — `:107-108` (`nodes = 502_146`, `seen.len() = 140_529`) and `:138-139`
  (`1_379_187`, `185_459`) — as the one expected exception, predicted that both counts would **fall**,
  and instructed the next implementer to re-pin them. It was recorded without ever being run. It is
  wrong, and it is wrong in the worst direction: it pre-authorises editing a gate that would only move
  if the rewrite were broken.

  **`nodes` cannot move, by that same draft's own argument.** `walk` (`tests/lambda_sharing.rs:52-66`)
  pushes both `App` children unconditionally and counts one per pop, so it counts each snapshot's
  *logical* expansion, not its allocations. The rewrite is behaviour-preserving — which is exactly what
  §10's exhaustive differential establishes — so every snapshot is structurally identical to today's and
  the logical total is fixed by construction.

  **`seen.len()` cannot move either, for a sharper reason: none of `subst`'s sharing ever reaches a
  snapshot.** `beta` closes the hole with `shift(-1, 0, …)` (`term.rs:129`), and `shift`
  (`term.rs:94-108`) has no sharing-preserving arm — all three of its arms allocate. It therefore
  rebuilds the entire reduct node for node, discarding whatever `subst` shared internally before the
  result is ever stored in a step. Measured on `(\x. \a. \b. x x) arg` with a three-node argument:
  today's `subst` returns 9 logical nodes over **6** distinct allocations; after the closing shift it is
  9 over **9**; `beta`'s output shares **0** allocations with either `abs_body` or `arg`. And the
  general form, over the probe's own enumeration — every term to 6 nodes over 4 indices, `d ∈ 0..=2`,
  `cutoff ∈ 0..=2` — `shift`'s output shares an allocation with its input in **0 of 10,008** cases.

  The draft's mechanism sentence was wrong about the baseline as well. It said depth-0 occurrences
  "stop being copied at all"; `term.rs:117` already returns `s.clone()` at every depth today, and the
  `lift == 0` arm **preserves** that behaviour rather than introducing it.

  **So this gate is expected to hold unedited, those four constants included, and movement in any of
  them is a DEFECT SIGNAL rather than an expected update.** Verified directly rather than argued: the
  rewrite was applied to `term.rs` in a scratch working copy and the whole `redextape-core` suite run —
  **624 tests, 624 passed**, `lambda_sharing` among them with all four constants untouched. A future
  implementer who sees one of them move has not implemented the rewrite §10 describes.
- **Deep-drop tests** — the **five** cases in §6, in `lib.rs::drop_tests` at 512 KiB, alongside the
  existing `Core` / `Expr` / `Value` / `LetRecGroup` cases. (This read "the two cases" until 2026-07-31;
  see §6 for why the shipped count is five and what each of the extra three is falsifiable for.)
- **`ptr_eq` non-vacuity** — a test proving the fast path is actually taken *and* does not change any
  answer. A fast path that never fires is dead code that reads as an optimization.
- **The probe ships** as `examples/lambda_sharing_probe.rs`, with its self-verification, so §2's and
  §3's tables are reproducible rather than quoted.
- **`verify_subst_rewrite` moved into a test target — done.** The shift-additivity lemma, the
  exhaustive differential and the `lift == 0` allocation-identity pin, all three, now live in
  `crates/redextape-core/tests/subst_rewrite_equivalence.rs` as three `#[test]` functions, which
  `cargo nextest run -p redextape-core` runs on every invocation — including CI's. It used to live in
  the probe, where §10 called it a check that "runs on every invocation". That was true and weaker
  than it sounds: **CI compiles examples but never runs this one.** `.forgejo/workflows/ci.yml:112`
  builds them via `cargo clippy --workspace --all-targets`, and the test step (`:128`, `cargo llvm-cov
  nextest --workspace`) does not run example targets at all — the only `cargo run --example` in the
  workflow is `opt_report` (`:228`), a different crate. So "every invocation" used to mean every
  *manual* invocation, and the check gated nothing until it became a test. The probe no longer carries
  a copy of the candidate rewrite or the check — `run()` prints a pointer to the test file instead —
  so the two cannot drift apart the way this branch's earlier corrections had to fix elsewhere. This
  move did not wait for the `subst` fix itself to land in `src/`: `term.rs`'s `subst` is unchanged, and
  the candidate rewrite (`subst_at`/`subst_lifted`) lives only in the test file as the thing being
  checked, same as it lived in the probe before.

## 9. Non-goals

- **No WASM depth-bound change.** `MAX_TERM_DEPTH`, `MAX_LAMBDA_LOWER_DEPTH`, `MAX_EVAL_DEPTH` and
  `MAX_DEFUNC_DEPTH` are all calibrated to a native 8 MiB stack and none protects WASM's ~1 MB. That is
  real and open, and the roadmap already routes it to Plan 5, where the target's stack is known.
- **No serde, no view models, no WASM crate.** Plan 5.
- **No change to reduction strategy.** Normal order stays, for the three independent reasons
  `reduce.rs`'s module doc gives.
- **`shift`'s negative-index `assert!` stays.** It is the documented anti-miscompile guard — wrapping
  produced a term full of dangling references that reduced to a *wrong answer* rather than an error.
  (It is a panic on a library path that `clippy::panic` does not catch, since the lint does not cover
  `assert!`. Recorded here rather than fixed: converting it is a signature change to a `pub` function
  and belongs to whoever revisits the five `unreachable!`s the Plan 4 review filed.)
- **No printed byte moves.** Every printer, span map and text form is untouched.

## 10. Open questions

### CLOSED 2026-07-31 by layer 1.5: what dominates λ replay time is `subst` re-copying the argument under every binder — 86.8% of the nodes the reducer visits, and 95.6% of the ones it constructs

Node count does not predict replay time because node count is not what the reducer spends its time on.
Measured by `examples/lambda_sharing_probe.rs` PART B/C, which counts, per β-step, the size of every
traversal the reducer actually performs and then checks the candidate against **all 46 corpus programs**
rather than the two that motivated the question.

The counter is **`Σ abs×arg`**: for each step, `#Abs(body) × |arg|`. It exists because `subst`'s
abstraction arm (`term.rs:122`) is

```rust
Node::Abs(n, b) => abs(Rc::clone(n), subst(j + 1, &shift(1, 0, s), b)),
```

and `shift` rebuilds every node it walks. So the argument is **deep-copied once per `Abs` node in the
body** — once per *binder*, not once per *occurrence* of the bound variable, and whether or not the
variable occurs beneath that binder at all. Over the corpus's **5,955 β-steps, `subst` replaced 6,220
occurrences (1.04 per step) and built 273,004 copies of the argument (45.8 per step): 44 copies for
every use the step had for one.**

**The hypothesis layer 1.5 was written to test is refuted.** That hypothesis was *substitution blowup* —
a large argument copied into many occurrences — measured as `Σ occ×arg`. There is no substitution
blowup anywhere in this corpus: `Σ occ×arg` and `Σ arg` sit within 5% of each other on every row that
takes measurable time, because the mean occurrence count is 1.04. The argument is copied 44 times and
used once.

**Every number below, and every timing-derived figure in the rest of this section, comes from one
probe run on 2026-07-31.** Structural columns (`steps`, all the `Σ` counters, node and distinct counts)
are deterministic and reproduce exactly. Timing-derived columns do not: `replay ms` is best of three,
but `ns/node` and the fitted prices below come from a **single** pass, so they move a few percent
between runs on the same machine. Re-derive them rather than reconciling them against these.

| row 31 `s0/s1/s2` vs row 7 `while` | row 31 | row 7 | ratio 31:7 |
| --- | --- | --- | --- |
| **replay ms** | 1,212.7 | 179.9 | **6.74x** |
| steps | 411 | 470 | 0.87x |
| max term nodes | 4,898 | 9,763 | 0.50x |
| `Σ size` — `depth_exceeds`' walk | 869,186 | 1,379,176 | 0.63x |
| `Σ path` — spine rebuild | 5,556 | 2,931 | 1.90x |
| `Σ scan` — redex search | 2,120 | 12 | — |
| `Σ occ×arg` — **the hypothesis** | 144,192 | 107,691 | **1.34x** |
| `Σ abs×arg` — **the answer** | 33,660,955 | 4,705,450 | **7.15x** |
| `Σ read` — the read-only traversals | 871,306 | 1,379,188 | 0.63x |
| `Σ alloc` — the allocating ones | 34,269,655 | 5,072,266 | **6.76x** |
| `Σ model` — every traversal, summed | 35,140,961 | 6,451,454 | 5.45x |
| ns per `Σ model` node | 34.5 | 27.9 | 1.24x |

Every counter that tracks term size points the *wrong way* (row 7 is the bigger program). Only
`Σ abs×arg` moves with the clock — and note the two ways of getting from a counter to the 6.74x, which
is the subject of "one price or two?" below. Counting every node the same, it is 5.45x more work at a
1.24x higher price per node. Counting only the nodes the reducer *constructs*, it is **6.76x more work
at the same price**, with no second factor to explain.

**The verification, which is the part that makes this a finding and not a coincidence.** Two rows
agreeing is one data point, so the counter was checked against all 46:

| | Spearman ρ vs `replay ms` (46 rows) | ns-per-unit spread, max/min |
| --- | --- | --- |
| `Σ scan` | 0.371 | 495,673x † |
| `Σ path` | 0.939 | 390x |
| `Σ size` | 0.976 | 31x |
| `Σ occ×arg` (the hypothesis) | 0.986 | 43x |
| `Σ body` | 0.988 | 58x |
| `Σ arg` | 0.988 | 43x |
| **`Σ abs×arg`** | **0.996** | **4.1x** |
| `Σ read` (the read-only traversals) | 0.974 | 31x |
| **`Σ alloc`** (the allocating ones) | **0.999** | **1.5x** |
| **`Σ model`** (all traversals summed) | **0.997** | **1.9x** |

† **`Σ scan`'s spread is not a measurement and must not be read as one.** Scan is 0 on every row whose
redex path never takes an `AppR`, and the probe's `.max(1.0)` floor divides by 1 rather than by 0 there,
so the printed max/min is an artifact of that floor. What `Σ scan` actually says is its ρ: it does not
track the clock (and over the 14 timer-reliable rows it is *negative*, −0.55).

ρ is the weak test — it stays near 1.0 for *any* counter that merely grows with the program, which is
why three of the four hypothesis counters score above 0.97 while explaining nothing. (`Σ path`, the
fourth, is 0.939 — an earlier draft said all four were above 0.97, contradicting this table eight lines
up.) The **spread** is the discriminating column: it asks whether one unit of a counter costs the same
nanoseconds on every program, and only a genuine cost does. `Σ model` — `Σ size + Σ scan + Σ path +
Σ arg + Σ body + Σ abs×arg + Σ reduct`, i.e. the whole accounting — prices at **18.0 to 34.5 ns per node
visited across all 46 rows**, over traces spanning 118 to 35,140,961 nodes of work: five orders of
magnitude inside a 1.9x band.

**The residual inside that band is not noise, and chasing it is what "one price or two?" below does.**
Stated correctly, because the earlier draft stated it wrongly: the heaviest row runs **92% dearer per
node than the lightest** (34.5 ns on row 31 against 18.0 ns on row 12) and **20% dearer than the
median** (28.7 ns over the 14 timer-reliable rows). Those are two different comparisons and the draft
gave the median gap while naming the lightest row. The low end of the band is also the least
trustworthy part of it — row 12 is 118 nodes of work measured at 2 µs — and it moves between runs.

**What the control does and does not prove, because an earlier draft claimed "nothing is missing from
the accounting" and that is too strong.** `Σ model` is 86.8% `Σ abs×arg`, so its band mostly tests
whether that *one* counter is linear in time. A traversal **proportional** to it is invisible to the
control and gets folded into the constant rather than showing up as drift — the obvious candidate being
the `Drop` walk that frees those same nodes (`term.rs:181-222`), which by construction visits roughly
what `subst` allocated. What the evidence supports is **"nothing large and non-proportional is
missing"**, which is what the flat band actually demonstrates and is still enough for the dominance
claim: a hidden traversal proportional to `Σ abs×arg` makes the substitution redundancy *more* of the
cost, not less. There is also one **known** gap, small but real: the accounting sums over `trace.steps`,
so the final `reduce_step` that finds no redex and the `depth_exceeds` before it — once per program, and
read-only — are outside it. Negligible against 5,955 steps, and recorded because a control described as
complete should name its exceptions.

### One price or two? The residual is structure, and it changes what happens after the fix

`Σ model`'s band assumes a **flat** cost model — one price per node visited, whatever the traversal was
doing with it. That is an assumption inside the control, not a result taken from it, and the accounting
already contains the material to test it. Two of the seven traversals only **read** a node
(`depth_exceeds` returns a bool; the redex search returns a path); the other five **construct** one for
every node they walk. `Σ read` and `Σ alloc` are those buckets, and PART C.2 fits a price to each by
least squares over the 14 timer-reliable rows, with no intercept.

| model | fit | worst row |
| --- | --- | --- |
| flat: `ms = c·Σ model` | c = **33.9 ns/node** | off by **38.5%** |
| two-price: `ms = a·Σ alloc + r·Σ read` | a = **35.4 ns/node**, r = **1.1 ns/node** | off by **4.1%** |

**The two-price model holds up, and the reviewer's caveat about it was tested rather than repeated.**
The worry was that two parameters on 14 points is easy to overfit and that the two regressors, both
growing with program size, might be collinear enough to make the split arithmetic rather than physics.
Measured: the uncentered correlation of `Σ alloc` and `Σ read` over those rows is **0.61**, a variance
inflation factor of **1.6** — not a collinear pair, because `Σ size` is driven by term size and
`Σ abs×arg` by binder density, and the corpus separates those. Leave-one-out refits move `a` between
35.26 and 35.36 ns/node (1.0x), and eight runs of the binary put `a` in 35.4–36.3 ns/node — the price
this section actually leans on is the stable one.

**Two corroborating re-expressions, and calling them independent evidence would be a mistake this
paragraph used to make.** `Σ alloc` **alone** prices at a 1.5x spread over all 46 rows against
`Σ model`'s 1.9x — a strictly tighter fit from a strictly smaller counter, which a flat model cannot
produce — and a row's `Σ abs×arg` share correlates **0.88** with its ns-per-`Σ model`-node over the
reliable rows, where a flat model predicts 0. Both are functions of the same residual, over the same 46
rows, from the same run as the fit itself. They restate the fit in two other coordinates and are useful
for exactly that — a reader can see the structure without trusting the least squares — but they cannot
confirm it, because there is no new measurement in either. The independent check is the *out-of-sample*
one: re-run the probe after the `subst` fix and see whether the two-price column of the table below
predicted the result.

**What is *not* well determined is `r`, and it is less well determined than an earlier draft of this
paragraph said.** That draft reported three runs landing at 1.07, 1.83 and 1.91 ns/node, leave-one-out
swings of "roughly ±40%", and concluded the corpus pins `r` to *small and positive*, somewhere in
0.9–2.5 ns/node. **Eight runs of the same binary on the same machine give −1.24, −0.71, −0.59, 0.02,
0.28, 1.36, 1.87 and 4.24 ns/node**, with within-run leave-one-out ranges as wide as −1.52 to 0.29 and
2.16 to 6.77 — the swing exceeds the coefficient itself, which is the condition the probe's own PART C.2
commentary names as "the corpus cannot identify two prices". Three of the eight are **negative**, and a
negative price for reading a node is physically impossible, so at this magnitude the second parameter is
absorbing residual rather than resolving a price.

**What the corpus does pin, and it is enough for everything downstream: `|r|` is a few percent of `a`,
so a read node is nearly free next to one the reducer constructs.** Every conclusion in this section is
monotone in `r` and holds across the *whole* observed range including `r ≤ 0`. `r` moves `Σ size`'s
post-fix time share between −6.6% and +17.8% across those eight runs — the negative end being the tell
that the fit is at its identification limit, not a measurement — and `Σ reduct` leads at **both** ends.
`a` is the coefficient this section leans on, and `a` does not move (35.4–36.3 ns/node over the same
eight runs, leave-one-out 1.0x within each).

So the honest replacement for "replay time is the price of visiting a node times the number of nodes
visited" is: **replay time is the price of *constructing* a node times the number of nodes constructed,
plus a small correction for nodes merely read.** Corpus-wide today, read-only work is **9.2% of the
nodes and 0.3% of the time**. That distinction does nothing to the headline — 87 of every 100 nodes
visited is still `subst` copying an argument under a binder it is not used beneath, and on the
allocating half it is **95.6%** — but it changes the forward guidance a great deal, below and in §7.

**Rows the explanation fails on.** Two different questions, and the earlier draft answered only the
first:

- **Against `Σ model`, the completeness control: none.** Of the 14 rows above 1 ms every one prices
  within 1.21x of the median and none reaches the 2x the probe flags at. The other 32 rows are reported
  and not flagged, because at 2 µs–800 µs the clock is the uncertain quantity; they price at the same
  ns/node regardless, which is corroboration that filtering them out would have discarded.
- **Against `Σ abs×arg` itself — the counter the finding names — eight rows: 0, 4, 5, 6, 8, 16, 17 and
  27.** Criterion: ns-per-`Σ abs×arg` off the 14-row median by more than 2x, applied to all 46 rows.
  **Every one of them is sub-millisecond**, so the headline is untouched, and they fail for the obvious
  reason — the counter is 16–33% of the work on those rows against 96% on row 31, and a counter that is
  a sixth of the work cannot price like a counter that is all of it. Membership of this list is
  itself run-dependent: an earlier run of the same binary named ten rows, adding 2 and 12, both of which
  sit within noise of the boundary. No row above 1 ms appears in any run.

**Why row 31 and not row 7.** `lower_group` (`lower.rs:346`) lowers a mutually recursive group as one
fixpoint over an n-tuple, `fix (\g. (\f1 … fn. TUPLE(v1, …, vn)) (proj_1 g) … (proj_n g))`, and its own
cost note already says the call-by-name `fix` re-expands the whole tuple at every projection. Every
member's body is therefore a binder-dense term, and `subst`'s cost is *linear in the binder count*:
`Σ abs×arg ÷ Σ arg` — the argument-weighted mean binder count of the bodies it substitutes into — is
**232 on row 31 against 44 on row 7**. That is the 6.74x. `desugar` forms a `LetRecGroup` only for a
genuine cycle, so the corpus contains exactly five mutually recursive programs — rows 28, 29, 31, 32,
33 — and they are exactly the five slowest, at 88–96% `Σ abs×arg`.

**"The five slowest" holds by a margin inside the noise, so it is not load-bearing.** Row 33 (180.9 ms)
leads row 7 (179.9 ms) by **0.5%** on this run, and by 1.4% on the run before it. The five mutually
recursive programs and row 7 are the six slowest; which of the last two comes fifth is a coin flip. The
claim that survives is the one about binder density, which is structural and does not move at all.

**The fix, written down and deliberately not implemented here** (this was a measurement task; §9's
non-goals hold). The shift is redundant, not merely repeated: at binder depth `d` the argument is
`shift(1,0,·)` applied `d` times, which is `shift(d, 0, ·)`, so it can be deferred to the substitution
site and paid once per occurrence instead of once per binder. Carrying the lift separately from the
index keeps `subst`'s public contract for `j ≠ 0` intact:

```rust
pub fn subst(j: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm { subst_at(j, 0, s, t) }

fn subst_at(j: u32, lift: u32, s: &LambdaTerm, t: &LambdaTerm) -> LambdaTerm {
    match t.node() {
        // The `lift == 0` case is load-bearing, NOT a micro-optimization. See below.
        Node::Var(k) if *k == j => if lift == 0 { s.clone() } else { shift(i64::from(lift), 0, s) },
        Node::Var(k) => var(*k),
        Node::Abs(n, b) => abs(Rc::clone(n), subst_at(j + 1, lift + 1, s, b)),
        Node::App(f, a) => app(subst_at(j, lift, s, f), subst_at(j, lift, s, a)),
    }
}
```

**`lift == 0` MUST NOT BE "SIMPLIFIED" BACK OUT INTO THE GENERAL ARM.** `shift` allocates a fresh node
on every arm regardless of `d`, so `shift(0, 0, s)` **deep-rebuilds** the argument — where today's
`term.rs:117` returns `s.clone()`, a refcount bump. Substituting into a body with no binders therefore
costs **0** today and would cost **`|arg|`** without this arm: a strict regression at exactly those
sites, and one that discards the structural-sharing property this whole branch exists to establish.
Every substitution into an occurrence at binder depth 0 goes through it. The probe pins the arm by
**allocation identity** (`alloc_id`), not by structural equality, because `==` is satisfied by a deep
copy and would pass either way — so deleting the arm fails a check rather than quietly costing a copy.

**The proof obligation, stated so it can be discharged rather than assumed.** The argument for deferring
the shift is "`shift(1,0,·)` applied `d` times is `shift(d,0,·)`". What makes that true rather than
merely plausible is the **shift-additivity lemma**:

```text
shift(a, c, shift(b, c, t)) == shift(a + b, c, t)      for a, b >= 0
```

**The side condition is not decoration, and an earlier draft omitted it.** Stated unconditionally the
lemma is **false**: `shift(-1, 0, Var 0)` trips `term.rs:99`'s negative-index assert, so the inner
application does not even have a value to be additive with. Nothing is lost by the restriction — the
rewrite accumulates `lift` upward through `Abs`, so every shift it composes has `d = 1`, and the
non-negative case is the whole of what the induction over `Abs` needs. The one negative shift in the
reducer, `beta`'s closing `shift(-1, 0, …)`, is applied *after* substitution finishes and is not
composed with anything.

With the lemma, the induction over `Abs` is immediate; without it, the rewrite is a plausible-looking
index manipulation. It is verified exhaustively — `a, b ∈ 0..=3`, `c ∈ 0..=2`, every term up to 6 nodes
over 4 distinct indices: **53,376 cases, 0 violations.** Note that the checked range is exactly the
non-negative one, so the check discharges the obligation as stated above and says nothing about
negative `b` — which is correct, because the rewrite never needs it.

**The equivalence evidence is re-runnable, and its earlier form was not.** This section previously
recorded "200,000 randomly generated `(j, s, t)` triples, offline" against a throwaway project outside
the repo that no longer exists. Two things were wrong with that. It could not be re-run, and *random*
de Bruijn term generation almost never produces the deep-binder/high-index configurations the `lift`
arithmetic actually stresses — the one thing the check exists to cover. It is replaced by an
**exhaustive** differential, living as three `#[test]`s in
`crates/redextape-core/tests/subst_rewrite_equivalence.rs` and run by `cargo nextest run -p
redextape-core` on every invocation, including CI's: every `t` up to 6 nodes over 4 distinct indices
against every `s` up to 4 nodes, for `j ∈ 0..=3` (`j ≠ 0` is the part of `subst`'s public contract
`beta` never exercises) — **355,840 triples, 0 mismatches**, in well under a second. Exhaustive
enumeration to ~6 nodes is cheap enough that there is no reason to sample.

**Moved into a test target — done**, closing the gate item §8's list carried for it. It used to live in
`examples/lambda_sharing_probe.rs` and run "every time the probe is" — true and not a gate, because CI
compiled examples and never ran this one (`.forgejo/workflows/ci.yml:112` vs `:128`), so it ran on
every *manual* invocation and on no automatic one. As a test it now runs on every CI push instead, and
the probe no longer carries a copy of the candidate rewrite or the check — it prints a pointer to the
test file so the two evidence sources cannot drift apart.

**A third check is already in the tree and was not previously mentioned.**
`tests/lambda_foreign_reader.rs:385-419` carries an independent, textbook-TAPL `subst`/`shift`/`beta`
over its own term type, exercised against the same corpus — `shift` at `:385-399`, `subst` at
`:402-414`, `beta` at `:417-419`. (This citation read `:402-418` until 2026-07-31, a range that holds
`subst` and `beta` but stops short of the independent `shift` it also names.) It is written the eager
way. After the rewrite it becomes, at no extra cost, a committed differential check of
**eager-vs-lifted equivalence on real programs** rather than on enumerated toy terms — and it should be
kept eager for exactly that reason.

**Blast radius, corrected.** This section previously said "`beta` is the only in-tree caller of either
function". That is true of **`subst`** — `beta` (`term.rs:129`) is its only caller, and `beta`'s only
caller is `reduce_step` (`reduce.rs:100`). It is **false of `shift`**, which has a second in-tree
caller: `lower.rs:72`, inside `store_of`, calls `shift(1, 0, v)` when a store value moves under the new
`\sel` binder. The rewrite does not change `shift`, so that call site is unaffected — but a reader
sizing the re-test from the old sentence would have missed it.

**What the fix buys, and why the answer is model-dependent.** It turns `Σ abs×arg` into `Σ occ×arg`,
whose measured corpus total is 828,569 against 70,542,349. (Strictly an upper bound on the new cost: the
`lift == 0` arm makes depth-0 occurrences free, so the real figure is lower.) What that is *worth*
depends on which cost model prices it, because the fix removes only allocating work and leaves every
read-only traversal untouched:

| | flat model | two-price model |
| --- | --- | --- |
| corpus-wide work reduction | **7.0x** (81.3M → 11.6M `Σ model` nodes) | **18.0x** (73.8M → 4.1M `Σ alloc` nodes) |
| row 31 | 21.6x → ~55 ms | **45.5x → ~28 ms** |
| row 7 | 3.5x → ~63 ms | **10.7x → ~18 ms** |
| the 6.74x outlier | *inverts* — row 7 becomes the slower | **does not invert** — row 31 stays ~1.5x slower |

**And what it does *not* buy: any change to the sharing the trace retains.** The rewrite's effect is
entirely on allocations made and dropped *inside one `subst` call*. Every one of them is discarded
before the call returns to `beta`, because `beta`'s closing `shift(-1, 0, …)` rebuilds the reduct node
for node (§8 has the measurement: `subst`'s 6-distinct output becomes 9-distinct after the shift, and
`beta`'s result shares 0 allocations with either input). So this is a **pure allocation-count reduction
within one call, with no downstream sharing benefit** — the sharing gate's four pinned constants do not
improve, and nobody should expect them to. The win is real and it is a *time* win; it is not a memory
win measurable at the snapshot.

**These are predictions contingent on a model, not measurements**, and they are recorded in that form
precisely because re-running the probe after the fix falsifies whichever one is wrong. The two-price
column is the one this section is prepared to defend, on the diagnostics above; the flat column is kept
because the earlier draft asserted its inversion as a result, and the correction is more useful than a
silent replacement. Both agree on what matters — the worst case drops from 1.2 s to well inside a frame
budget — and disagree by 2x on how far, and about whether the outlier survives at all.

### Layers 2 and 3: not worth planning yet, and this is the evidence

**Neither layer addresses the 86.8%.**

- **Layer 2 (interning) cannot touch it, and would make it more expensive.** Every one of those 70.5M
  nodes is produced by `shift`, and a shifted copy carries *different de Bruijn indices* — it is a
  structurally new term, so interning has nothing to deduplicate (the probe's module doc has said this
  since layer 0; layer 1.5 is what turns it from a caveat into the whole answer). Worse, interning does
  not *avoid* constructing a node, it *hashes* one: those 70.5M `Rc::new` calls become 70.5M hash-and-
  probe operations, and the probe measures the intern pass at ~60 ns/node against the ~35 ns/node the
  reducer pays to construct one (the fitted allocating price; ~27 ns/node if every node is counted the
  same). **§3's memory case for interning is untouched by this** — the residual after
  `Rc` is still 10.3x and 50.0x on the two rows with allocation counts, and that argument stands on its
  own. What is refuted is the *speed corollary*.
- **Layer 3 (memoization) would cache a computation that can simply be deleted.** A `shift` memo keyed
  on `(d, cutoff, alloc_id)` does hit — sibling binders at equal depth request the same shift — so it
  would recover part of the 44x. But the fix above recovers *all* of it, in six lines, with no cache,
  no ids, no retained memory and no invalidation question. Caching redundant work is strictly worse
  than not doing it.

**And planning either now would be optimizing the 13% of nodes the substitution redundancy is not.** What is left after the `subst` fix, and which
traversal is then the largest, depends on which model prices it — and this is the one place where the
difference changes the answer rather than the size of it:

| traversal | nodes | nodes % | time % (flat) | **time % (two-price)** |
| --- | --- | --- | --- | --- |
| `depth_exceeds` — `Σ size` (read-only) | 7,433,964 | 64.4% | 64.4% | **5.2%** |
| `beta`'s closing `shift(-1,0,·)` — `Σ reduct` | 1,605,436 | 13.9% | 13.9% | **37.2%** |
| per-occurrence shift — `Σ occ×arg` | 828,569 | 7.2% | 7.2% | 19.2% |
| `beta`'s opening `shift(1,0,·)` — `Σ arg` | 820,096 | 7.1% | 7.1% | 19.0% |
| `subst`'s body walk — `Σ body` | 783,087 | 6.8% | 6.8% | 18.1% |
| spine rebuild — `Σ path` | 55,226 | 0.5% | 0.5% | 1.3% |
| redex search — `Σ scan` (read-only) | 25,698 | 0.2% | 0.2% | 0.0% |

**The largest remaining cost is not `depth_exceeds`.** Under the two-price fit it is `beta`'s closing
`shift(-1, 0, …)` over the reduct, at 37% — and read-only work as a whole is **64.6% of the remaining
nodes but 5.2% of the remaining time**. An earlier draft of this section read "the corpus's remaining
work is 64% `Σ size` … it becomes the **largest remaining cost**", prefixed *Measured*. That is a
**node** share reported as if it were a **time** share, and it pointed the next plan at the wrong
target: `depth_exceeds` is 9.1% of the nodes today but 0.3% of the time, and after the fix 64% of the
nodes but ~5% of the time. The correction holds across the whole `r` band, which eight runs now put at
−1.24 to 4.24 ns/node: `Σ size` lands anywhere from **−6.6% to 17.8%** of post-fix time across those
runs, and `Σ reduct` leads in **every one of them** (35.8%–39.8%). The ranking is what survives the
indeterminacy in `r`; the size of the gap is not.

So layer 3's case is **weaker than the earlier draft implied, not stronger**. A memoized `depth_exceeds`
would attack ~5% of post-fix time. The traversals worth attacking after the `subst` fix are the ones
that still *build* terms — most of all `beta`'s closing shift, which walks and rebuilds the entire
reduct on every step purely to decrement the free indices — and none of them is layer 2 or layer 3
either. That is a finding for the next plan, and it is one this section would have got backwards.

**A second, independent line of evidence points at the same closing shift, and it arrived from the
sharing side rather than the timing side.** §8 records the measurement: because `shift` has no
sharing-preserving arm, `beta`'s `shift(-1, 0, …)` rebuilds the entire reduct node for node, so its
output shares **zero** allocations with either of `beta`'s inputs and none of `subst`'s internal sharing
survives it. That is the same traversal the two-price fit ranks first, reached without any price at all:
it is the one place in the reducer where a whole term is copied for no reason but index bookkeeping, and
it is why the `subst` fix's win is confined to a single call (§10's "what the fix does not buy"). A
lift-carrying `beta` — the same technique as `subst_at`, pushing the −1 into the substitution rather
than applying it afterwards — is the obvious next candidate, and it would recover the sharing as well as
the time.

**`Σ arg` is removable by that same technique, and the table above does not say so.** `beta`'s opening
`shift(1, 0, arg)` exists only so the argument survives crossing the binder — which is exactly the lift
`subst_at` already carries, so `beta` can call `subst_at(0, 1, arg, body)` and drop the pre-shift
entirely. `Σ arg` is **~19% of remaining two-price time**, and that is the *ceiling* on what this buys,
not the expectation. The catch is the same trap the `lift == 0` arm exists for: starting at `lift = 1`
means depth-0 occurrences no longer reach that arm and pay `shift(1, 0, arg)` where they pay a refcount
bump today, moving work out of `Σ arg` and into `Σ occ×arg`. It is a strict win only where the step has
*no* depth-0 occurrence, a wash at one, and a loss at two or more — and on this corpus occurrences sit
close enough to one that the net is small either way.

**Two different means say so, and this parenthetical used to run them together.** It read "this corpus
averages ~1.04 occurrences per step (`Σ arg` 820,096 against `Σ occ×arg` 828,569)" until 2026-07-31, and
that pair does not yield 1.04 — it yields **1.010**. The 1.04 is the *unweighted* mean from §10's
opening: `subst` replaced 6,220 occurrences over 5,955 steps. The 1.010 is the **argument-weighted**
mean, and it is the one this paragraph actually wants, because `Σ occ×arg ÷ Σ arg` is precisely the
ratio between the two counters the rewrite trades against each other. The conclusion is unchanged on
either number: the net is small here and the sign is not obvious from the counters. Worth measuring rather than assuming; recorded beside the
`Σ reduct` recommendation because it is the same rewrite, not a separate idea.

**So the next plan is: fix `subst`, re-run the probe, and re-derive layers 2 and 3 from the new PART C.**
Not "fix `subst` and then do interning". The instrument that answered this question is committed and
reproducible, so the next bottleneck will be named by measurement the same way this one was, rather
than guessed at — which is the discipline that has now refuted two intuitions in this slice (hash-
consing priced as YAGNI in §3, substitution blowup here).

### ANSWERED 2026-07-31: the logical-vs-physical hazard is REACHABLE from 512 bytes of ordinary source, and it does not fail cleanly — it hangs

The bullet below this section used to say the shape was "**possible, and merely unreached**". The first
half stands. **The second half is falsified**, and this subsection is the correction rather than a
replacement of the text that stated it — the "merely unreached" wording is left in place under it, struck
through and dated, because what it got wrong is the useful part. Instrument:
`crates/redextape-core/examples/blowup_probe.rs`, committed with this slice for exactly this reason.
Full report: the investigation's own write-up, summarized here to the numbers.

**The multiplier is `lower.rs:453`, and it is not new.**

```rust
for j in 0..n {
    out = app(out, projection(group.clone(), j));   // lower_group, lower.rs:452-454
}
```

`group` is `app(fix(), abs(GROUP, fix_body))` and `fix_body` contains **every member's lowered value**,
so an n-member mutually recursive `fn` group puts n edges into one allocation. That alone is linear.
**It becomes exponential because it nests:** a member's value is a lowered `fn` body, a `fn` body is a
block, and a block may declare its own mutually recursive group, so level k's group sits inside level
k−1's and the factor multiplies — `logical(out_k) ≈ 2 · logical(out_{k+1})` while
`physical(out_k) = physical(out_{k+1}) + O(1)`. The comment at `lower.rs:397` already states the
duplication as a fact about the source map; what it does to *size* was never costed.

The smallest program that shows it is **47 bytes** and already 1.99x:
`fn f0(n) { n + g0(n) } fn g0(n) { f0(n) } g0(1)`.

| source | `lower` | physical | logical | ratio | depth |
| --- | --- | --- | --- | --- | --- |
| 47 B | 20 µs | 154 | 306 | 1.99x | 21 |
| 369 B | 194 µs | 1,197 | 76,760 | 64.13x | 105 |
| **512 B** | **196 µs** | **1,644** | **616,152** | **375x** | **141** |
| 1,124 B | ~600 µs | 3,432 | 2.52e9 | 7.4e5x | 285 |
| 3,215 B | 2.9 ms | 9,541 | 5.55e21 (2^72.2) | **5.8e17x** | 777 |

**`lower` stays linear and fast the whole way down that table** — 2.9 ms for a term of 2^72 logical
nodes — which is the entire problem. Every size intuition anyone has about the returned term is
satisfied.

**The 512-byte row is where it stops.** That term's **first β-step had not returned after 13 minutes**,
with the cgroup's peak resident set at **974 MB** (`memory.peak` = 1,021,349,888 B) and creeping ~1 MB
per 40 s. **I expected an OOM kill and did not get one**: the reducer is not accumulating toward a limit,
it is allocating and freeing gigabyte-scale terms over and over inside one call to `reduce_step`. The
honest characterisation is **an unbounded single β-step at GB scale, i.e. a hang** — worse than an OOM
for the same reason a silent wrong answer is worse than a panic. A 2 GiB cap contained the investigation;
nothing like it exists in production.

**No guard in the tree notices.**

- `MAX_TERM_DEPTH` is not approached — **depth 141 against 3,000**. Depth grows ~12 per nesting level,
  so 3,000 is reached around 250 levels, at a ratio of 2^250. The two quantities are independent,
  exactly as `depth_exceeds`'s own doc comment warns.
- `MAX_REDUCTION_STEPS` **is never consulted**, because control never returns from `reduce_step`.
- A wall-clock budget checked *between* steps cannot help: 90 s produced a 330-second run at nine
  levels. **Nothing placed between β-steps can bound a β-step.**

**What `Rc` changed is WHERE it detonates, and that is the sentence this slice most needs to hand
forward.** Under `Box`, `lower.rs:453`'s `group.clone()` was a deep copy, so the same program built the
2^m tree **during lowering** — physically, immediately, fatally, and at a much smaller m. It was already
a bomb. Under `Rc` the clone is n refcount bumps, so `lower` **succeeds** in 196 µs holding 1,644
allocations and the explosion moves into the reducer, where it presents as a hang rather than an
allocation failure. **The root cause is pre-existing in `lower_group`; this branch did not create it — it
moved the detonation**, converting a loud, deterministic, easy-to-attribute failure in a pure function
into a quiet one spread over an unbounded number of β-steps. That is also why the corpus never hit it:
nothing in the corpus nests mutual recursion, and under `Box` anyone who tried was told immediately.
(This half is an inference from the code, not a measurement — the `Box` representation is gone from the
branch and was not reconstructed. It is the one claim in this subsection without a number behind it.)

**Three supporting results, each worth keeping on its own.**

1. **`Drop`'s Θ(physical) claim holds, demonstrated rather than argued.** A 10,000-deep
   `app(c.clone(), c)` chain — 10,001 allocations, **2^10001 logical nodes** — is freed in **175 µs**.
   The mechanism is `Rc::into_inner` in the worklist loop (`term.rs:222`): a node with two parents is
   popped twice but expanded once, so total pops are bounded by 2 × allocations. It is the one traversal
   that survives this shape, which is what the bullet below already claimed and now has a number for.
2. **Reduction cannot COMPOUND the ratio — it MATERIALIZES it.** `beta`'s closing `shift(-1, 0, …)`
   rebuilds every node it visits, so a β-step's output aliases nothing and its allocation count *equals*
   its logical size. Measured: the within-term ratio is **exactly 1.00x after ≥6 steps**, from starting
   ratios of 1.99x, 4.67x, 12.45x and **114.28x**; at the last of those, 1,346 allocations become 230,632
   in six steps. **This corroborates §8's finding about that same closing `shift` from the opposite
   direction.** §8 established it by enumeration — `shift`'s output shares an allocation with its input
   in 0 of 10,008 cases, which is why none of `subst`'s sharing reaches a snapshot and why
   `tests/lambda_sharing.rs`'s four constants cannot move. This establishes it by consequence: feed
   `beta` a term that is 114x shared and the sharing is gone in six steps. Two independent lines, one
   conclusion, and it is load-bearing in both places.
3. **`PartialEq`'s `ptr_eq` fast path saves the same-allocation case and only that case.**
   `c == c.clone()` is one comparison at any n (0.000000 s at n = 64, 2^65 logical). A separately built,
   structurally identical `d` gets no help at all and pays the full 2^n, crossing 2 s at **n = 30**. The
   fast path is per-node and two independently built terms share no node. Relatedly, **`parse_lambda`
   introduces no sharing** — verified on three inputs at 1.00x, and argued structurally, which is
   stronger than the table: `syntax.rs` contains exactly one `.clone()` (line 162, on a binder *name*),
   and the parser only ever calls `var`/`abs`/`app` on freshly parsed subterms, each of which allocates.
   So a printed term is not a cheap way to carry a shared one — the round trip makes the point from the
   other side, 10 allocations / 512 logical printing to 770 bytes and re-parsing to 512 / 512.

**Sizing a fix — four options, and the obvious one does not work.** Nothing was built; the call is the
human's.

- **(a) A logical-size guard at the end of `lower`** — ~25 lines, O(allocations), microseconds. Exactly
  the probe's memoized `logical()` fold plus a `LowerError::TooLarge { node }`. It runs on the DAG, so it
  costs nothing on ordinary programs (194 allocations for `sum(5)`) and refuses the pathological ones
  before a single β-step. It composes with `MAX_LAMBDA_LOWER_DEPTH`, the tree's existing precedent for "a
  capability reduction recorded as an explicit decision": that guard bounds the lowering's own recursion,
  this one bounds the term it produces. **Capability cost:** it rejects deeply nested mutually recursive
  `fn` groups — programs that do not terminate today anyway — but the bound is a number someone has to
  pick and defend. **Scope note if this is chosen:** the guard belongs in `lower`, not the reducer, and it
  must measure **logical** size. Physical size is the obvious thing to measure and is exactly the number
  that looks fine here (1,644).
- **(b) Stop `lower_group` duplicating `group` — and it is NOT enough.** Binding it once,
  `(\g. (\f1 … fn. body) (proj_1 g) … (proj_n g)) G`, makes the *lowered term* linear. But `g` then occurs
  n times in the body, the first β-step substitutes `G` into all n occurrences and deep-copies the result,
  and the same expansion reappears at reduction time, one level per step. **Under call-by-name this is not
  a fix, it is a delay.** It also moves every pinned step count and every `Origins` path in `lower_group`
  (`lower.rs:411-418`, `447-453`), so it is not golden-preserving. **Do not take this one for the
  blow-up.** It may still be worth taking on its own merits.
- **(c) Make reduction share — call-by-need or a graph reducer.** The only change that removes the *class*
  rather than an instance, because the amplifier is normal-order argument duplication, not the lowering.
  A different project: `reduce.rs`'s module doc records that normal order is *required* here for three
  independent reasons, and any move must retire all three first. Out of scope for a guard decision.
- **(d) A node budget inside `LambdaCursor` — rejected.** A single β-step's output is |body| × |arg|
  logical nodes in the worst case, so a check between steps reads a number that says nothing about the
  next step. It would make the small cases fail and leave the fatal one untouched. Security theatre.

**Confidence, and what would falsify this.** Reachability is **certain** — 512 bytes of ordinary surface
syntax that parses, typechecks and lowers through the public pipeline, with the failure observed under a
hard cap rather than inferred. The mechanism attribution to `lower.rs:453` is **high confidence**: it is
the only `.clone()` of a user-controlled `LambdaTerm` in the lowering not immediately undone by a `shift`,
and the measured ratio is 2^levels to three significant figures for a 2-member group, which is what the
code predicts. **Falsified by:** a program family with an exponential ratio containing no `LetRecGroup`
(`desugar::contains_group` makes that cheap to check). The materialization claim is falsified by any
change that removes `beta`'s outer `shift(-1, 0, …)` — an optimization that skipped it when no index
needs decrementing would do it — or by any new term-producing path that does not funnel through `beta`.

**Not investigated, each a possible separate hazard:** whether `desugar` duplicates `Core` subtrees so as
to grow the *source* representation superlinearly; whether `store_of`/`update` nest to grow physical size
exponentially for k ≥ 3 mutable variables (each `update` re-projects k−1 slots and `store_of`'s `shift`
makes those physical, but the store threads through binders rather than nesting syntactically, so the
corpus ramp shows 1.00x and this was not pushed further); and the WASM shadow-stack sizing that
`MAX_TERM_DEPTH`'s doc defers, which is §9's first non-goal and stays there.

### Still open

- **Which of (a)–(d) above to take, and whether to take one at all.** This is the only genuinely open
  question the blow-up leaves: the measurement is done, the mechanism is attributed, and (b) — the option
  a reader arrives at first — is priced and rejected for this purpose. It is the next slice's brief.
- **Whether interning's memory win becomes a speed win.** Narrowed, not closed. Answered *no* for the
  reducer as written (above), because the cost interning would attack is 13% of the nodes and the 87%
  is structurally invisible to it. Re-askable after the `subst` fix — but note that the reason for
  re-asking it has changed: an earlier draft said re-ask "when `depth_exceeds` dominates", and it does
  not dominate the *clock* under any price the corpus supports (§10's closing table). What memoized
  traversals over interned ids would have to bite on post-fix is `beta`'s closing `shift(-1, 0, …)` and
  the two other allocating walks, not the read-only one. That is a harder target, because those
  traversals *build* the term the next step consumes.
- **Whether λ ever needs trace checkpoints.** Plan 4 left this unanswerable until `Rc` landed and λ
  replay was re-measured. It stays open, and the delta-shaped step stream keeps the option free.
- **A term's LOGICAL size can now exceed its PHYSICAL size, and four traversals walk the logical one.**
  Surfaced by layer 1's implementation, carried forward rather than closed there. `depth_exceeds`,
  `print_lambda`, `PartialEq` (below its `ptr_eq` short-circuit) and `decode` all traverse the
  expansion, so a shallow but heavily shared DAG is exponential work for them: **thirty nested
  `App(c, c)` levels is 30 allocations and 2^30 logical nodes**.

  **The two halves of this are different claims and both matter.** Under `Box` such a term was
  **impossible to construct** — every edge owned its subtree, so logical size *was* physical size.
  Under `Rc` it is ~~**possible, and merely unreached**: nothing in the corpus builds one (the whole
  suite passes at normal speed and the probe's node counts are unchanged, §3), and neither
  `reduce_step` nor `beta` produces that shape~~ — **FALSIFIED 2026-07-31, see the subsection above.**
  Left standing struck through, because the shape of the error is the lesson: every clause of it is
  individually true and the conclusion is wrong. Nothing in the corpus *does* build one; `reduce_step`
  and `beta` *do not* produce the shape. What was never checked is whether `lower` produces it, and it
  does, from 512 bytes. "No corpus program hits it" was correctly identified here as a weaker guarantee
  than `Box`'s — the mistake was treating a weaker guarantee as a guarantee. So this is still a hazard
  structural sharing *relocates* rather than a defect layer 1 shipped, and `MAX_TERM_DEPTH` still does
  not cover it: it bounds *depth*, and this is width by sharing (measured: depth 141 against 3,000).

  **`LambdaTerm`'s `Drop` is the one traversal that is not exposed.** It descends only through
  `Rc::into_inner`, which yields `Some` exactly when the popped handle was the last one, so teardown
  visits each *allocation* once and is bounded by allocation count rather than by logical size — the
  same property that makes it iterative on a shared graph (§6). Measured 2026-07-31 and it holds:
  2^10001 logical nodes over 10,001 allocations, freed in **175 µs**. Closing the gap for the other four
  means memoized traversals keyed on interned ids: layer 3, the same mechanism the speed question
  above needs — but note that layer 3 is not what the blow-up needs. Memoizing the *readers* leaves
  `beta` materializing the expansion regardless, which is (c) above.
