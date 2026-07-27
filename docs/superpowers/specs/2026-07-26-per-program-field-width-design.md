# Per-program `FIELD_WIDTH` sizing + the overflow guard — Design Spec

> **Status:** IMPLEMENTED (2026-07-26). Plan: `docs/superpowers/plans/2026-07-26-per-program-field-width.md`.
> The estimated tables below are superseded by `cargo run --release --example width_report`, which
> determines each fitted width with the guard instead of inferring it from answer agreement.
> **Context:** The TM backend's register bank is a fixed-width unary field bank, `FIELD_WIDTH = 64` cells
> per field, global and compile-time constant. This spec makes the width **per-program**, chosen
> automatically, and adds the **defensive overflow guard** that makes a chosen width mean anything.
> It is items 1 and 2 of the post-Plan-3 encoding track; the binary `Encoding` impl (item 3) and the
> Tier A optimizer passes (item 4) are separate slices that compose with this one.

## The measurement that motivates this (item 1, already done)

`FIELD_WIDTH` was swept over `{4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128}` against a 19-program
representative slice of the survey corpus (arithmetic, `while`, recursion, lists, defunctionalized
higher-order, mutual recursion, mutable capture). Four results, all measured:

**1. TM step count is exactly affine in the width.** `steps(W) = a + b·W`, with no residual over the range
where the program is not corrupting its own tape. `3 - 5` is exactly `109 + 18W`; `1 + 2 * 3` is
`348 + 84W`; `fold([3,1,2].map(add1), 0, add)` is `41,039 + 14,114·W`. At `W = 64` the `b·W` padding term
is **71%–97% of all steps, median 94%** — the great majority of the machine's work is traversing blank
padding, and the *spread* matters as much as the median (see "What this disturbs").

**2. Sizing per program buys 1.0×–8.4× fewer steps (median 5.6×) and 2–5× shorter tapes**, at
power-of-two widths.

| program | fitted W | steps @fitted | steps @64 | speedup |
|---|---|---|---|---|
| `head(tail(cons(1, cons(2, nil))))` | 4 | 790 | 6,670 | 8.4× |
| `[1, 2, 3]` | 4 | 802 | 6,682 | 8.3× |
| `while` counter to 4 | 8 | 13,824 | 92,000 | 6.7× |
| mutable capture (BOX tape) | 8 | 31,755 | 208,715 | 6.6× |
| `[3,1,2].map(add1)` | 8 | 55,927 | 344,999 | 6.2× |
| `1 + 2 * 3` | 8 | 1,020 | 5,724 | 5.6× |
| `sum(5)` | 16 | 50,542 | 178,222 | 3.5× |
| `fold([3,1,2].map(add1), 0, add)` | 16 | 266,863 | 944,335 | 3.5× |
| `let x = 40; x + 2` | 64 | 2,870 | 2,870 | 1.0× |

The programs that gain least are the ones holding a large *literal* — sizing cannot help a program that
genuinely needs 42 in a field. That is the honest bound on this work.

These fitted widths are **estimates**, for the reason in finding 4: this session could only measure the
smallest width at which a program still *answers correctly*, which is not the same as the smallest width
at which it is *safe*. The true per-program widths are a deliverable of the guard (`width_report.rs`),
not a result of item 1, and some will land one power of two higher than the table above.

**3. State count is width-independent — except on the BOX tape.** Every non-box program builds the same
machine at every width (142 states for `1 + 2 * 3`, at W=4 and W=128 alike), because `seek_slot` /
`rewind_home` / the REG store are content-driven loops. Box programs are the exception: the BOX tape's
navigation is content-blind and fixed-width, so it builds width-long state *chains* — mutable capture
goes 4,503 states at W=4 to 5,991 at W=128, ~12 states per unit width. So sizing shrinks the machine
itself, not merely the run, for exactly the programs that use boxing.

**4. Under-sizing corrupts the tape, and no observable this session could construct detects it.** The same
single defect — a value written past the end of its fixed-width window, destroying the field's trailing
`#` — surfaces as four different outcomes, and two of them look like success. All four were captured by
dumping the final REG tape at W=4:

```
5              → reg = #11111_               decode → None            (visible: no value)
5 - 0          → reg = —                     HitCap                   (visible: runaway)
3 - 5          → reg = #____#111_#11111_      decode → Nat(0)  ✓ RIGHT (invisible)
0 + 5          → reg = #11111____#11111_      decode → Nat(5)  ✓ RIGHT (invisible)
```

In the third the last field's delimiter is gone; in the fourth two 4-cell fields have merged into one
9-cell run. Both tapes are structurally destroyed. Both return the right answer.

Two candidate cheap detectors were tried against the corpus and **both fail**:

- *Answer agreement* — at least five of the nineteen programs are corrupt-but-right at their apparent
  minimum width.
- *The affine law from finding 1* — deviation from `a + b·W` does flag three of them (`let-chain`,
  `higher-order`, `both` all break the line exactly where they start overflowing), but `3 - 5` at W=4 is
  provably corrupt and sits **exactly on its line**.

This is the whole argument for the guard. "The answer came out right" and "the cost looked linear" are
both unsound evidence that a width is safe, so an auto-fit policy cannot be built on either; it needs a
*structural* signal, emitted at the moment of the write. Everything below follows from that.

## Goal

1. Make the unary field width a **property of the encoding instance**, not a global constant.
2. Add a **defensive overflow guard** so that writing a value ≥ the width halts in a distinguishable
   state instead of corrupting the tape.
3. Make `run_tm` **auto-fit** the width per program, by doubling from a floor until the guard stops
   firing — so the estimated median 5.6× is realized by the whole oracle suite, not just by an opt-in
   caller.

## Non-goals (this slice)

- **The binary `Encoding` impl.** Separate, additive slice. This design keeps the seam ready for it
  (`field_width() -> None` means "unbounded", and auto-fit degenerates to one attempt), and nothing here
  presumes unary.
- **Optimizer passes** (devirtualization, frame-restore ABI, inlining). Separate tier; see the ranking
  caveat under "What this disturbs".
- **Non-power-of-two widths / a shrink pass after fitting.** Doubling overshoots the true minimum by at
  most 2× and caps the search at 5 attempts. `let x = 40; x + 2` needs 43 and will run at 64; the
  measured cost of that rounding is 512 steps (2,358 at width 48 versus 2,870 at 64), accepted
  deliberately.
- **Per-slot widths.** One width per program, not one per register.
- **Changing the 64 ceiling.** `MAX_FIELD_WIDTH` keeps today's value, so representability is unchanged.
  What changes is that exceeding it is now *reported* instead of silently miscompiled.

## Architecture

### 1. Width becomes encoding state

```rust
pub struct Unary { width: usize }        // Default::default() == MAX_FIELD_WIDTH (64)
impl Unary { pub const fn at(width: usize) -> Unary; }

pub trait Encoding {
    /// The strict value bound this instance was built at — a stored value `v` must satisfy
    /// `v < width`. `None` means the encoding is unbounded (a future `Binary`), which is how
    /// auto-fit knows not to search.
    fn field_width(&self) -> Option<usize>;
    /// Re-instantiate this encoding at `width`. An unbounded encoding returns itself.
    fn at_width(&self, width: usize) -> Box<dyn Encoding>;
    …                                    // every existing method unchanged
}
```

`MIN_FIELD_WIDTH = 4`; `MAX_FIELD_WIDTH = 64` (today's `FIELD_WIDTH`, renamed — it is now the ceiling of
the search and the default, not "the" width; the old name would be actively misleading once width is
per-program).

The width reaches only four places, because almost every gadget is content-driven rather than
width-aware:

- `init_reg` — the padding of a zero field.
- `write_literal` — the static `n >= width` check (below).
- `box_skip_field_{right,left}` and `box_append_field` — the BOX tape's fixed-width, content-blind
  navigation, which builds width-long state chains.

`seek_slot`, `rewind_home`, `rewind_work`, `clear_work`, `copy_field_to_work`, `append_work_to_field`,
and every HEAP/STACK gadget need nothing: they stop on content (`#`, or a padding blank), not on a count.
`decode_nat` is already width-agnostic — it reads marks, then blanks, then requires a `#` — so **decoding
needs no change at all**, and a tape produced at width 8 decodes correctly against a default-width
`Unary`.

Cost: `&Unary` becomes `&Unary::default()` at roughly 30 call sites across tests, examples, and the
native crate. Mechanical, and the compiler finds every one.

### 2. One shared overflow state, allocated by `Builder`

```rust
impl Builder {
    /// The single shared overflow-guard state: rule-less and non-accept, so reaching it halts the
    /// machine immediately. Lazily allocated on first request; every gadget shares the one state.
    pub fn overflow(&mut self) -> StateId;
    pub fn overflow_state(&self) -> Option<StateId>;
}

pub fn lower_tm_guarded(prog: &Program, enc: &dyn Encoding) -> (Machine, Option<StateId>);
pub fn lower_tm(prog: &Program, enc: &dyn Encoding) -> Machine;   // == lower_tm_guarded(..).0
```

Putting the state on `Builder` — which already owns handing out fresh `StateId`s — is what keeps the
`Encoding` trait's method signatures unchanged. Returning it from `lower_tm_guarded` as an **artifact**
rather than storing it on `Machine` follows the pattern already established by `lower_tm_mapped`,
`defunc_mapped`, and `attribute`: the caller that needs provenance asks for it, and `Machine` stays a
plain machine that the text form round-trips.

`simulate` gains a sibling that also returns the final state (`simulate_trace` already returns one;
`simulate` currently drops it):

```rust
pub fn simulate_final(m: &Machine, init: &[Vec<Symbol>], caps: Caps) -> (Vec<Tape>, StateId, Status);
```

`TmStatus` is **not** touched. "Stuck in a non-accept state" keeps folding into `Halted` exactly as
today; the overflow state is identified by its id, not by a reclassified status. That keeps
`simulate`/`simulate_trace`/`simulate_counts` and their tests behaviour-identical, and it avoids claiming
an invariant ("no other stuck state is reachable") that this slice does not prove.

### 3. The guard sites

The invariant: **every REG and BOX field write is guarded; WORK, STACK, and HEAP stay unbounded.** That
is the right cut because WORK is where intermediates live (a `Mul` may build a large product in WORK and
monus it back down), STACK frames and HEAP cons cells are `#`/`@`-delimited and variable-width, and the
only fixed-width storage in the machine is the REG bank and the BOX tape.

| site | guard | catches |
|---|---|---|
| `append_work_to_field` — the universal REG store, reached by `mov`, `arith`, `compare`, `pop_frame_restore`, `cons`, `head_op`, `tail_op`, `is_empty_op`, `box_op`, `box_get_op` | one rule at the `wr` write loop: `REG = SEP → overflow`, **inserted before** the existing two rules | both `v == width` and `v > width` |
| `write_literal` | build time: `if n >= width` route `entry → overflow` and emit nothing else | static and exact |
| `box_append_field` | at the last window cell of the chain: `WORK = MARK → overflow`, inserted first | `v >= width` |
| `box_overwrite_field` | **converted from content-driven to a counted width-chain**, then the same guard | `v >= width` |
| `dispatch_tag`, `push_frame`, all HEAP/STACK sub-primitives | none needed | variable-width by construction |

Two of those deserve their reasoning recorded.

**Why one rule suffices at `append_work_to_field`.** The loop writes one REG mark per WORK mark with a
wildcard REG read, so it walks off the end of the window on overflow. The two overflow cases look
different at the boundary — at `v > width` the head reaches the trailing `#` with WORK still holding
marks, while at `v == width` the head reaches it with WORK exactly exhausted (this is the documented
`rewind_home` miscount: no padding blank remains, so the rewind crosses one delimiter too many and lands
one field to the right of home). A rule that reads `REG = SEP` and ignores WORK covers both, and it can
never fire legitimately: the loop is entered on the field's first cell with the window freshly blanked.

**Why `box_overwrite_field` is restructured rather than given a rule.** It is content-driven today, and
BOX fields have no trailing `#` after the last one — the top is a blank. So an overflowing write to the
*last* box field spills into the top blank with no delimiter to hit, and the corruption only surfaces
later, when the next `box_skip_field_right` lands mid-spill, reads a `MARK` where it expects `#` or
blank, and goes stuck-silent. Making it a counted chain of `width` cells, like `box_append_field` already
is, makes the guard uniform and matches the tape it writes to: BOX navigation is fixed-width everywhere
else.

**The property this design buys, and the test that proves it.** Guards add *rules*, never *steps*, on the
non-overflow path — a `RuleSpec` that never matches costs nothing, and rule lookup is first-match-wins.
Therefore **every committed step-count golden at width 64 must remain byte-identical** after this slice.
That is a mechanical, falsifiable check on the entire guard construction, and it is test #1 below.

### 4. How completely the guard holds — three layers, and where it stops

The table above is an **argument from enumeration**: it is sound only if those are genuinely all the
sites. That much is verified — a grep for value-writes (`Some(MARK)`) to REG and BOX returns exactly four
rules in the whole codebase (`encoding.rs` lines 206, 836, 696, 778); every other REG/BOX write emits
`BLANK` (an erase path) or `SEP` (a delimiter), neither of which can grow a value past its window, and
`lower_tm.rs` emits only bare `RuleSpec::new()` — control flow that touches no tape.

But enumeration alone is not a guarantee, for three reasons, each of which gets its own countermeasure:

| risk | countermeasure |
|---|---|
| **The enumeration decays.** A fifth write site added by a later slice is guarded by nobody, and nothing fails. | Layer 3 (below) — it observes the tape, not the site. |
| **Rule order is load-bearing and unchecked.** A guard only fires if inserted *before* the rules it shadows; lookup is first-match-wins and `validate()` performs no overlap check. This hazard is already documented in-tree at `append_field_to_work` ("INSERTION ORDER IS LOAD-BEARING… swapping the two `add_rule` calls would silently break this gadget"). A later prepended rule disables a guard silently. | Layer 2 — assert each guard rule is at index 0 of its state. |
| **The boundary derivations could be wrong.** That `v == width` and `v > width` both land the head on `SEP` while in `wr` is reasoned, not measured. | Layer 3 — it does not depend on the derivation being right. |

**Layer 1 — enumeration.** The four sites above, guarded individually. Verified by grep today.

**Layer 2 — the guard rule is first.** For each of the four guard states, assert the guard occupies rule
index 0. Cheap, structural, and it kills the rule-order risk exactly. Note that overlapping rules cannot
simply be *banned* in `validate()`: several gadgets rely on deliberate overlap, `append_field_to_work`
among them. So the check is positional and local, not a global well-formedness rule.

**Layer 3 — a per-step bank well-formedness invariant.** The one that does not rest on my audit. A
test-only simulator mode checks, after every step, that

- REG matches `#` then (exactly `width` cells of marks-then-blanks, then `#`) × slots, and
- BOX matches `#` then exactly `width` cells, repeated, then a blank top,

and reports the first step at which it fails. Run over the full corpus at every width from `4` to `64`,
and over the bounded proptest. Any corruption — from an unenumerated site, from a guard disabled by rule
order, from a boundary case I derived wrong — fires at the exact step it occurs, naming the gadget.

**What is still not guaranteed, stated plainly.** Layer 3 is corpus-bounded: it is an observation over
the programs and widths actually run, not a proof over all programs. It is strictly stronger than the
enumeration argument and strictly weaker than a proof, and this slice does not attempt the proof. Three
further limits are by design, not gaps: WORK, STACK and HEAP remain unbounded (they are variable-width
and bounded only by `caps.cells`); nil/dangling dereference stays the existing spin-to-cap fault and is
not an overflow; and auto-fit finds a *sufficient* width, never the minimal one.

### 5. Auto-fit

```rust
pub enum TmRun { Ran { tapes }, HitCap, Overflow, LowerError(LowerError) }   // + Overflow

pub fn run_tm(core, enc, caps) -> TmRun;                          // auto-fits
pub fn run_tm_fitted(core, enc, caps) -> (TmRun, Option<usize>);  // + the width it settled on
pub fn run_tm_at(core, enc, caps) -> TmRun;                       // pinned to `enc`'s own width
```

`run_tm` lowers to asm once, then attempts widths `4, 8, 16, 32, 64`. An attempt that halts in the
overflow state and is not yet at `MAX_FIELD_WIDTH` doubles and retries; anything else is the answer.
Reaching `MAX_FIELD_WIDTH` and still overflowing yields `TmRun::Overflow` — the program is not
representable on this tape. If `enc.field_width()` is `None`, there is exactly one attempt.

`run_tm_fitted` returns the width as an artifact rather than adding a field to `TmRun::Ran`, so every
existing `match` on `TmRun` keeps compiling apart from the new `Overflow` arm.

Each attempt gets its own `caps`. The retries are cheap *because* of the guard: a too-narrow run executes
the correct prefix of the program and then halts at its first overflowing store, so an attempt costs less
than the successful run it precedes, and the whole search costs under ~2× the final attempt. This is not
an assumption inherited from the old behaviour — today's under-sized runs burn the full 5,000,000-step
budget precisely *because* corruption sends the machine into a runaway, and the guard removes that path.
Test #8 pins the bound.

## What this disturbs

**1. `Overflow` at the ceiling is a correctness fix, not just a new variant.** Today a program whose value
exceeds 64 corrupts its tape and returns a wrong answer. `redextape-native`'s `BEYOND_FIELD_WIDTH_DEMOS`
currently only *documents in a comment* that the TM cannot represent these; that comment becomes an
assertion.

**2. The Tier A optimizer ranking does NOT move — measured after the fact, against this design's own
hypothesis.** This section originally argued that it might: steps are `a + b·W`, at W=64 the `b·W`
padding term is 91%–97% of the total, and the buckets need not share an `a/b` ratio, so shares
measured at 64 might be an artifact of the width. It went further and asserted a direction — that the
frame-restore ABI pass, targeting field traversal, would lose most of its measured win as fields
narrowed, while devirtualization, targeting whole instructions, would keep its.

`step_survey` now re-attributes the entire corpus at each program's own fitted width (`attribute_at`)
and compares. **The asserted direction is wrong and the concern is unfounded:**

| bucket | @64 | @fitted | change |
|---|---|---|---|
| user constructs | 57.3% | 54.8% | −2.5pp |
| frame-restore ABI target | 28.0% | 29.2% | **+1.2pp** |
| devirtualization target | 26.9% | 28.5% | +1.7pp |
| mutable-capture boxing | 0.4% | 0.2% | −0.2pp |

The corpus runs 3.59× fewer steps when sized, every share moves by at most 2.5pp, and the ABI share
*rises* rather than falling. Both scaffolding targets rise, because what shrinks fastest under sizing
is the user-construct bucket, not the scaffolding. The ordering is preserved.

What the measurement did surface is more consequential than the width question: **the two pass targets
are within ~1pp of each other at either width** (1.1pp at 64, 0.7pp fitted), on a corpus whose largest
single program is 17.7% of all steps. That is a tie, not a ranking, so the Tier A choice cannot rest on
these aggregate shares at all — it has to rest on the structural tie-breakers Part B already names.

`attribute` and `step_survey` still report their headline numbers at pinned width 64 (via `run_tm_at`),
so they stay comparable with what is already on `main`.

**3. The goldens split into two roles.** The committed step-count goldens move to `run_tm_at` at width 64
and keep their exact current values (5,724 / 2,174 / 178,222 / 239,971 / …). They remain the stable
regression signal for optimizer work, undisturbed by the fact that a program's fitted width — and hence
its end-to-end step count — moves discontinuously when a value crosses a power of two. The fitted widths
themselves get their own golden (test #7).

## Testing

Ranked by what they prove, not by where they live.

1. **Goldens byte-identical at width 64.** Every committed step count is unchanged. Proves the guard
   construction adds no steps on any non-overflow path — the whole-slice safety property.
2. **Overflow is reported, not silently wrong**, at each of the four guard sites, each driven by a program
   pinned to a deliberately narrow width. The two headline cases are `3 - 5` and `0 + 5` at width 4:
   today the first destroys a field delimiter and the second merges two fields into one 9-cell run, and
   *both still return the right answer*. No correctness-based test can see either defect, which is why
   these assert on `TmRun::Overflow` rather than on a value — and why the assertion must be on the
   reported outcome, not on a tape shape that happens to decode.
3. **The bank well-formedness invariant** (layer 3 of §4) over the full corpus at every width `4`–`64`
   and over the bounded proptest. This is the test that makes the guard's completeness an observation
   rather than an argument from my enumeration, so it is worth more than any individual guard's test.
4. **Sabotage.** Three mutants, each of which must turn a named test red: delete each guard rule; *move*
   each guard rule from index 0 to the end of its state (the silent-disable that rule ordering allows);
   and add an unguarded fifth REG write site. The third is the one that checks layer 3 is actually doing
   its job rather than passing because the guards already caught everything.
5. **Guard rules are at index 0** of their four states (layer 2).
6. **The oracle is unchanged under auto-fit.** `reference == λ == TM` across the full first-order corpus,
   the fault/divergence taxonomy, and the 2M-case bounded proptest.
7. **Fitted width per corpus program, pinned as a golden** — so a change in sizing behaviour is visible in
   a diff rather than inferred from a step count.
8. **Retry cost is bounded.** Total steps across all attempts versus the final attempt, asserted against a
   stated multiple.

## Deliverables

- `Unary { width }`, `Encoding::{field_width, at_width}`, `MIN_FIELD_WIDTH` / `MAX_FIELD_WIDTH`.
- `Builder::overflow`, `lower_tm_guarded`, `simulate_final`, the four guard sites, `box_overwrite_field`
  restructured to a counted chain.
- The completeness layers of §4: the positional check that each guard rule sits at rule index 0, and a
  test-only simulator mode that validates REG/BOX bank well-formedness after every step and reports the
  first step at which it breaks.
- `TmRun::Overflow`, `run_tm` (auto-fitting), `run_tm_fitted`, `run_tm_at`.
- `examples/width_report.rs` — the item 1 experiment made reproducible: it sweeps widths at *runtime*
  via `Unary::at(w)` instead of by editing a constant and rebuilding, and prints (a) the per-program
  affine fit `a + b·W` and its padding share at width 64, (b) each program's true fitted width, now that
  the guard can determine one, and (c) the speedup against width 64. It supersedes this document's
  estimated table; the throwaway probe used to produce that table is not committed.
- `step_survey` gains a fitted-width column and a printed statement of whether the pass ranking moves.
