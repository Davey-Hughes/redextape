# The binary `Encoding` — Design Spec

> **Status:** DESIGN (2026-07-26). Implementation plan not yet written.
> **Context:** `Encoding` (`tm/encoding.rs:18`) has been the TM backend's declared "swappable seam" since
> Part 2b-1, and `Unary` has been its only implementation. Every slice since has repeated the same
> promise in its own words — "the HEAP's *structural* bookkeeping is unary-always; head-word *values*
> follow the encoding — a boundary the binary follow-on refines." This slice is that follow-on: a second
> `impl Encoding` in base 2, delivering the **unary↔binary toggle** the TM backend design spec named as
> "an explicit intended deliverable, not a maybe" (§13). It is **item 3 of the post-Plan-3 encoding
> track**, composing with items 1–2 (per-program width sizing + the overflow guard, merged 2026-07-26).

## Goal

One program, two machines. `lower_tm(prog, &Unary::at(w))` and `lower_tm(prog, &Binary::at(w))` produce
different Turing machines that compute the same answer, and the oracle proves it:

```
reference == λ == unary-TM == binary-TM
```

Toggling means **recompiling to a different machine**, not re-rendering the same one. The near-free
*display* toggle (render stored unary as binary — pure presentation) is a different, smaller thing and is
not this slice.

Three things fall out that are worth naming as goals in their own right:

1. **The value ceiling moves from 64 to 2⁶⁴.** `100 * 100` is today's documented `TmRun::Overflow`
   (`tm.rs:198`). Under `Binary` it is a value. A 64-cell binary field is exactly a `u64`.
2. **The seam gets tested instead of asserted.** A trait with one implementation is a claim about
   modularity, not a demonstration of it. Every place `Unary` leaks through the seam becomes a compile
   error — and there is at least one such leak today (Architecture §3.1).
3. **The step/space trade-off becomes measurable**, per program, on real machines rather than in
   argument (see "What the measurement is expected to show").

## Non-goals (this slice)

- **Variable-length (arbitrary-precision) fields.** Binary fields are fixed-width, like unary's. True
  unbounded fields would require a write to *shift* the rest of the bank, invalidating the fixed-window
  in-place-write invariant the whole register bank rests on. Deliberately deferred; see "What stays open".
- **Making `Binary` the default.** `Unary::default()` stays the default everywhere. `Binary` is selected
  explicitly. The goldens, the step survey and the width report gain a binary *column*, not a replacement.
- **The display toggle.** Independent and much smaller.
- **Optimizing either encoding.** Tier A/B passes are a separate track. This slice adds a second thing to
  optimize; it does not optimize it.

## Decisions

Four, settled in brainstorming, each with the alternative it beat.

**D1 — Fully binary, all at once.** Every value on every tape is a base-2 digit string: REG fields, WORK
scratch, STACK saved fields *and* return tags, HEAP head/tail words *and* cons pointers, BOX fields.

*Beat:* "binary values, unary structural bookkeeping" (pointers and tags stay marks). That sounds smaller
and is not: `cons` writes a heap pointer into a REG field, so a unary→binary conversion gadget becomes
mandatory, and WORK ends up holding two representations at once. One representation everywhere is both
more honest and less code.

*Also beat:* phasing it (REG+WORK first, STACK/HEAP/BOX later). That ships a green oracle leg sooner at the
cost of a partial `impl` that must error on unsupported gadgets — a temporary state with its own tests.

**D2 — `at_width(w)` means *w tape cells*, not "values `< w`".**

Under `Unary` these coincide, which is why the distinction has never had to be made. Under `Binary` they
diverge: `w` cells hold values `< 2^w`. Cells is the right reading, and it is the one that costs nothing:
`run_tm_fitted`'s existing 4→8→16→32→64 doubling search (`tm.rs:136`) works unmodified for both
encodings, and at the 64-cell ceiling `Binary` covers the entire `u64` range.

*Beat:* keeping `field_width()` as a value bound. Auto-fit's ceiling of 64 would then cap `Binary` at
values `< 64` too, discarding the whole capability win; raising `MAX_FIELD_WIDTH` to `u64::MAX` breaks the
doubling search.

*Consequence:* `field_width()`'s doc changes from "the strict value bound this instance was built at" to
"the field's width in tape cells". Its only non-test consumer is `run_tm_fitted`'s `is_none()` check, which
is unaffected. The ~20 test sites that use `MAX_FIELD_WIDTH` as a *value* bound stay correct for unary and
become merely conservative for binary.

**D3 — Carry-out routes to the shared overflow guard at every width, including 64.**

The reference saturates (`interp.rs:213`, `a.saturating_add(b)`). The binary TM does not: a carry out of
cell `w-1` goes to `Builder::overflow()`, auto-fit retries wider, and at 64 there is no wider, so `run_tm`
reports `TmRun::Overflow`. The claim becomes `reference == binary-TM` on everything below 2⁶⁴, with a
documented Overflow band above it — structurally identical to what unary does above 64 today.

*Beat:* saturating at the widest field only. That is attractive — it would make `reference == binary-TM`
*total* over every program the reference can run, a strictly stronger oracle claim than unary can make. It
was rejected because it makes arithmetic **semantics conditional on tape geometry**: `add` would need a
`saturate` flag true only at the widest width, so the same asm instruction would mean different things at
different widths. Auto-fit's soundness rests on "a narrower width either gives the identical answer or
guards and retries", and a width-dependent semantics is exactly what breaks that argument quietly.

**D4 — The full existing TM verification suite sweeps both encodings.**

Not a new dedicated binary oracle file alongside an untouched unary suite. The six-layer bank-safety
ladder was built to be reused, and `Binary` has its own bank with its own write sites; a ladder that
verifies only unary verifies nothing about the machine this slice adds. See "Testing" for what
generalizing costs — much less than it sounds, because the ladder is already well factored.

## Architecture

### 1. Representation

- **One new symbol.** `ZERO: Symbol = '0'` joins `MARK`/`SEP`/`AT`/`BLANK` in `build.rs`. `MARK` (`'1'`)
  doubles as the one-digit. The TM text form needs **no change**: `parse_sym` (`tm/syntax.rs:90`) accepts
  any single char as a symbol, so `parse_tm(print_tm(m)) == m` keeps holding over binary machines for free.
- **A binary field is exactly `w` cells, every cell a digit, LSB-first** — the leftmost cell is 2⁰. LSB-first
  makes ripple-carry a rightward walk (`Move::R` with the carry in the state), which is the direction every
  existing seek already travels.
- **No padding blanks.** A binary field is legitimately full.

That last point deletes a hazard rather than adding a case, and it is worth being explicit about because
the deleted hazard is load-bearing elsewhere. `MAX_FIELD_WIDTH`'s doc (`build.rs:33`) explains at length why
the unary bound is **strict** — a field written exactly full has no interior blank for the copy/write/erase
loops to land on, so they stop on the field's trailing `#` instead, and `rewind_home` then crosses one
delimiter too many and lands the REG head one field to the right of home. That entire failure mode is an
artifact of **content-driven** loops over a **mark/blank** alphabet. It does not exist in base 2, where
both digits are content and every field is the same length.

**So binary gadgets are counted chains, not content-driven loops** — walk exactly `w` cells, then stop. This
is not a new style to invent: it is already the house style on the BOX tape, where `box_skip_field_right`,
`box_skip_field_left` and `box_overwrite_field` are counted precisely because "the last field has no
delimiter to stop at" (`common/mod.rs:53`). Binary generalizes the BOX tape's discipline to every tape.

A second consequence, small but real: `write_literal` emits a chain of `n` states under unary
(`encoding.rs:940`), so a large literal inflates the state count linearly in its *value*. Binary emits `w`
states regardless of `n`.

### 2. Module layout

`encoding.rs` is 2,314 lines and a second implementation of comparable size makes it ~4,500. A prior slice
evaluated-and-skipped splitting it; a second `Encoding` forces the issue.

```
tm/encoding/mod.rs      the trait, the shared free helpers, the tape-shape parsers
tm/encoding/unary.rs    moved verbatim
tm/encoding/binary.rs   new
```

`pub use` paths in `tm.rs` stay identical, so **nothing outside `tm/` changes as a result of the split**.
Do the split as its own commit with no behaviour change, so the binary work reviews as new code rather than
as a diff against moved code.

**Shared verbatim, by parameterizing on a content-symbol set and a tape index:** `seek_slot`,
`rewind_home`, the `stack_*` primitives, `heap_seek_cell`, the `box_skip_*` chain. These already emit **one
rule per content symbol** — `MARK` and `BLANK` — rather than a wildcard read. Binary passes `('0', '1')`.
Two symbols either way, so the rule shape is unchanged and, critically, the static delimiter-safety rung
(which requires explicit non-wildcard reads, and for which three rules were deliberately rewritten to be
explicit) keeps working with no further change.

The tape-index parameter is needed because `seek_slot`/`rewind_home` hardcode `REG`, and `Binary` needs the
same navigation on WORK (Architecture §3.3).

### 3. The `Encoding` trait delta — three additions, one doc change

#### 3.1 `parse_heap_cells` moves onto the trait

This is the seam's one real leak, and it is exactly the kind this slice exists to expose. `decode_tape`
(`tm/decode.rs:19`) takes `enc: &dyn Encoding` and then calls the **free function**
`encoding::parse_heap_cells` directly, which hardcodes `@ <head marks> # <tail marks>`. A binary heap
decodes to garbage through it, silently.

It becomes `fn parse_heap_cells(&self, cells: &[Symbol]) -> Vec<(u64, u64)>`.

Note the shape change it enables: under `Binary` a heap cell is **fixed-width** (`@` + `w` digits + `#` +
`w` digits), where unary's is variable. That makes `heap_seek_cell` a counted skip rather than a content
scan — simpler, and consistent with Architecture §1.

#### 3.2 `fn field_symbols(&self) -> &[Symbol]`

What may legally appear *inside* a field. Unary returns `['1', '_']`; binary returns `['0', '1']`.

This one method is what makes D4 affordable. The bank-safety ladder's checkers currently hardcode "only
marks or blanks in between" — `reg_bank_is_well_formed`, `box_tape_is_well_formed` and
`heap_tape_is_well_formed` in `tests/common/mod.rs`. Each becomes encoding-generic by consulting
`field_symbols()` instead of naming `MARK`/`BLANK`. `heap_tape_is_well_formed` additionally needs the width,
so it takes `&dyn Encoding` rather than a symbol slice.

#### 3.3 `fn init_work(&self) -> Vec<Symbol>`

`Binary` needs structured scratch. Unary's WORK is an unstructured run of contiguous marks whose end is
found by scanning to a blank; binary's operands are fixed-width digit strings, and `mul` (Architecture §4)
needs three of them live at once. So under `Binary`, WORK becomes a small fixed bank with the same shape as REG — `#` then
(`w` digits + `#`) × 3:

| field | role |
|---|---|
| `W0` | accumulator / primary operand / the `0`-`1` boolean the comparisons produce |
| `W1` | secondary operand — the shifted multiplicand |
| `W2` | the multiplier, shifted right, doubling as the loop's termination test |

`Unary::init_work()` returns the empty vector, so today's behaviour is **bit-identical** — WORK starts
empty exactly as it does now. `attempt()` (`tm.rs:96`) gains one line setting `init[WORK]` alongside
`init[REG]`.

#### 3.4 The doc change

`field_width()`: "the strict value bound this instance was built at" → "the field's width in tape cells".
See D2. The `None` case (unbounded) keeps its meaning and stays unimplemented — see "What stays open".

### 4. The gadget library

The bulk of the new code. Each gadget preserves the existing home convention (all heads home/top on entry
and exit), so composition with `lower_tm`'s control flow is unchanged.

**`add`** — copy `ra` into `W0`, then ripple `rb` into `W0` in lockstep: one rule steps the REG head across
`rb`'s digits and the WORK head across `W0`'s digits simultaneously, with the carry held in the state (two
states: carry / no-carry). A carry out of cell `w-1` routes to `Builder::overflow()`.

**`sub`** — the same lockstep with a borrow instead of a carry. A borrow out of the top means the true
result is negative, so monus truncates: clear `W0` to all zeros. Matches `saturating_sub`.

**`mul`** — shift-and-add. `W0 ← 0`, `W1 ← ra`, `W2 ← rb`; then loop: if `W2`'s LSB is 1, add `W1` into
`W0`; shift `W1` left one cell; shift `W2` right one cell; repeat until `W2` is all zeros. Any carry-out —
from the accumulate, or a 1 shifted out of `W1`'s top — routes to the guard. This is the one gadget with
materially more states than its unary counterpart.

**`compare`** — **free**, and this is the payoff of mirroring unary's decomposition rather than inventing
one. `Unary::compare` derives all six comparisons from two primitives, `monus` and `is_zero`
(`encoding.rs:1007-1047`): `le(x,y) = is_zero(monus(x,y))`, `ge = le(rb,ra)`, `lt = !ge`, `gt = !le`,
`eq = le(ra,rb) && le(rb,ra)`, `ne = !eq`. Binary supplies binary `monus` (above) and a binary `is_zero`
(scan `w` cells for a non-`'0'`), and the entire derivation carries over unchanged.

**`jz`** — scan `w` cells of the field for a non-`'0'`; rewind home on both branches.

**`write_literal(n)`** — emit `n`'s bits as a counted chain of `w` writes. `n >= 2^w` is a compile-time
fact, so it emits a bare route to the guard and no write chain at all, mirroring `Unary`'s static-guard
arm and its pinning test `an_oversized_literal_emits_a_bare_route_to_the_guard`.

**`dispatch_tag`** — the one gadget whose *shape* changes rather than its representation. Unary fans out on
the tag's **mark count** by walking the tag field. Binary reads a `w`-bit value, so the fan-out becomes a
binary decision trie of depth `w` over `exits`. The defensive clamp is preserved: an out-of-range tag
routes to `exits.last()` and never over-indexes; an empty `exits` leaves `entry` rule-less so the machine
simply halts there.

**Everything else** (`mov`, `init_reg`, `decode_nat`, `push_frame`, `pop_frame_restore`, `cons`,
`is_empty_op`, `head_op`, `tail_op`, `box_op`, `box_get_op`, `box_set_op`) is a mechanical restatement over
counted `w`-cell fields, reusing the shared navigation primitives from Architecture §2.

## What this disturbs

1. **`decode_tape` gains a real dependency on `enc`** beyond `decode_nat` — the heap parser
   (Architecture §3.1). Any
   caller passing a *different* encoding than the machine was lowered with now decodes garbage instead of
   accidentally working. That is correct and worth a test.
2. **`attempt()` initializes two tapes**, not one. Unary's initializer is empty, so no unary behaviour or
   step count moves.
3. **`tests/common/mod.rs`'s checkers change signature** — three of its six:
   `reg_bank_is_well_formed`, `box_tape_is_well_formed`, `heap_tape_is_well_formed`. The other three —
   `unsafe_rules`, `assert_delimiter_safe`, `stack_is_empty` — need nothing (Testing, item 4).
4. **The `encoding.rs` split touches every `use` inside `tm/`** and nothing outside it.
5. **Step-count goldens gain binary entries.** No existing golden number changes; if one does, that is a
   defect in the split or in `init_work`, not an expected consequence.

## Testing

Every layer sweeps both encodings (D4). Numbered by what each layer costs.

1. **`tm_encoding.rs` + `encoding/binary.rs`'s unit tests — the bulk.** A parallel gadget-level suite:
   each of add/sub/mul/the six comparisons/jz/mov/literals/stack/heap/box computes correctly at several
   widths, plus the guard tests (`every_guard_rule_is_first_in_its_state`, the oversized-literal route,
   `work_gadget_overflows`) restated for binary carry-out.
2. **`tm_oracle.rs`, `three_way_oracle.rs` — the headline.** `reference == λ == unary-TM == binary-TM`
   over `FIRST_ORDER_DEMOS`, the fault demos, the λ-limitation demos, and the proptest generators. The
   generators' `MAX_FIELD_WIDTH` value bound stays as-is for unary; binary gets a **widened** generator
   whose leaves exceed 64, which is the only way to test what binary is *for*. `100 * 100` becomes a
   pinned two-encoding test: `Overflow` under unary, `Nat(10000)` under binary.
3. **`tm_bank_invariant.rs`, `tm_exhaustive_bank_safety.rs` — generic checkers, doubled runtime.** The
   per-step REG/BOX skeleton check and the 198,928-program enumeration both run under both encodings via
   `field_symbols()`. Already slow-tier, so the cost is acceptable; the enumeration should report its
   per-encoding program count so a silent halving is visible.
4. **`tm_static_delimiter_safety.rs` — free.** `unsafe_rules` reasons only about writing a non-`#` symbol
   while the head is on a `#`. It never names `MARK` or `BLANK`, so it is already encoding-independent and
   applies to binary machines unchanged. Add binary machines to its corpus; change no code.
5. **`tm_heap_stack_shape.rs`, `tm_width_equivalence.rs` — generic checkers.** Heap shape becomes
   `@ <w digits> # <w digits>`. Width equivalence — "the same program gives the same answer at every
   width" and "step count is non-decreasing in the width" — should hold for binary too and is a good
   independent check on the counted chains.

**Sabotage verification is required, not optional.** This repo's recurring defect class is "the guard
proves less than its name claims" — 13 instances in one recent slice, 8 in another, several found *in the
plan text*. Every new binary check must be verified by breaking the code and confirming the check goes red:
at minimum, drop the carry from `add`, delete the `mul` shift-out guard, make `write_literal` emit LSB-first
where MSB-first is expected, and make a `cons` write a digit over a `#`.

**Named risk — the exhaustive sweep's widths mean different things per encoding.**
`tm_exhaustive_bank_safety.rs`'s `WIDTHS = [2,3,4,5]` was chosen so "a narrow bank makes overflow the
COMMON case rather than a rare one, which is the regime the guard exists for". Under unary a 2-cell field
holds `{0,1}`; under binary it holds `{0,1,2,3}`, and a 5-cell field holds `{0..31}` where unary holds
`{0..4}`. Same constants, materially weaker coverage of the overflow regime for binary. The sweep must
state, per encoding, the value range each width covers, and binary's widths should be chosen for the
*regime* rather than copied for the *number*.

## Deliverables

1. `tm/encoding/` module split, behaviour-identical, as its own commit.
2. `Binary` — a complete second `impl Encoding`, plus `ZERO` in `build.rs`.
3. Three trait additions (`parse_heap_cells`, `field_symbols`, `init_work`) and the `field_width` doc change.
4. The full test suite swept over both encodings, sabotage-verified.
5. A binary column in `examples/width_report.rs` and `examples/step_survey.rs`: steps and final tape
   length, unary vs binary, per program — with a golden.

## What the measurement is expected to show, and why it is the point

The toggle is only worth having if it teaches something, and the interesting result is a *trade*, not a
win. Two predictions, both to be confirmed or refuted by the artifact rather than asserted here:

- **Binary banks are shorter.** Auto-fit settles binary at a narrower cell count for the same program —
  `1 + 2 * 3` needs 3 bits where unary needs 8 cells — and tape length is `1 + slots·(w+1)`.
- **Binary step counts are probably *higher* on this corpus.** Every value in the demo suite is under 64,
  which is precisely the regime where a `k`-cell unary add beats a `w`-cell ripple carry. The prior width
  measurement found the padding-traversal term to be 71–97% of all steps at `w = 64`; binary removes the
  padding but adds per-digit carry logic.

If both hold, the honest headline is that **binary buys range and space, and costs time at small values** —
which is a more useful thing to have measured than a speedup would have been, and is exactly the kind of
counterintuitive result the step survey has produced before (it overturned this roadmap's own recommended
pass ranking).

## What stays open

1. **`Encoding::at_width` on an *unbounded* encoding is still untestable.** Roadmap item 4 (line 452)
   predicted this would become free "the day `Binary` lands". Under D2 it does **not**: `Binary` is bounded,
   so `run_tm_fitted`'s `field_width() == None` branch still has no implementation to exercise it. Closing
   it now costs a test-only unbounded mock `Encoding`, which is cheap — fold it into this slice and correct
   the roadmap entry, which currently records a prediction this design falsifies.
2. **Arbitrary-precision (variable-length) fields.** The real answer to unbounded arithmetic, and a large
   separate slice: every widening write must shift the bank, which invalidates the fixed-window in-place
   invariant. Deferred, not rejected.
3. **The LENGTH half of the bank skeleton** still has no static cover, for binary as for unary (roadmap
   item 3). Unchanged by this slice.
4. **`Binary` as a fourth leg in `native_oracle.rs`.** Native's advertised distinctive capability is
   "no `MAX_FIELD_WIDTH` (64) ceiling" (`native_oracle.rs:13`). Binary narrows that gap considerably — the
   TM now reaches 2⁶⁴ — so those comments become inaccurate and the native suite's framing needs a pass.
   Small, but it must not be forgotten: it is a claim in a doc comment that this slice makes false.
