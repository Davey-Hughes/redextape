# Two-way → one-way tape fold — design

> **Roadmap:** stage 3 of *Machine-model reductions — a PIPELINE*
> (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`), the last Tier 1 stage. Stage 1 shipped as
> `tm/single_tape.rs` (spec `docs/superpowers/specs/2026-09-10-single-tape-reduction-design.md`, merged
> as #87); stage 2 as `tm/two_symbol.rs` (spec
> `docs/superpowers/specs/2026-09-10-alphabet-reduction-design.md`, merged as #88).

## What this delivers

A `Machine -> Machine` transformation onto tapes that are infinite in one direction only, its tape
layout and inverse, a **sixth oracle leg** adding `multitape-TM == one-way-TM` to the equalities the
earlier legs assert, and a **certificate** that a halted run never visited a cell left of cell 0. It
touches nothing in Core, asm or `encoding`, which is the architectural principle the roadmap states for
this whole track.

## The finding that reframes this stage: stages 1 and 2 already never go left

The roadmap says applying all three stages yields "one tape, one head, two symbols, infinite in one
direction only". Measured before designing, **the first two stages already have the last property.**

**Method.** `sim.rs`'s `Tape` materializes cells lazily and never discards one, so a head that ever
steps left of cell 0 pushes the run's starting cell off index 0 for good. A scratch probe (not
committed) ran each machine to a halt and checked whether the final snapshot still begins with the cells
the run started with:

| machine | encoding | steps | final state | left of cell 0? |
| --- | --- | --- | --- | --- |
| stage 1 image of `3 - 5` | unary | 257,216 | `q0.halt`, accept | no — `<` at cell 0 |
| stage 1 image of `if 2 > 1 { 10 } else { 20 }` | unary | 1,499,580 | `q0.halt`, accept | no — `<` at cell 0 |
| stage 1 image of `cons(1, cons(2, nil))` | unary | 397,970 | `q0.halt`, accept | no — `<` at cell 0 |
| stage 1 image of `1 + 2 * 3` | unary | 1,606,768 | `q0.halt`, accept | no — `<` at cell 0 |
| stage 1 then stage 2, `3 - 5`, `k = 4` | unary | 2,158,491 | `q0.halt`, accept | no — `code('<')` = `__11` at cell 0 |

**Why, by reading.** In `single_tape.rs`, every loop that walks left — `fail`, `rew` and `rap` — matches
`LEFT` first and moves right off it, and a marker seek that lands on `LEFT` halts in `OVERFLOW` without
moving (`single_tape.rs:357`, `:362`, `:446`, `:454`); the head starts on `<`. Stage 2 moves left only to
rewind within a block or to follow an original `Move::L` in whole `k`-cell strides
(`two_symbol.rs:483-501`), so it inherits the property from whatever it reduces.

**So the fold does no work on the pipeline as the roadmap composes it.** An oracle leg run only on
stage 1 images would pass for a fold that did nothing at all. The leg therefore runs where the left half
is actually used — the lowered multi-tape machines, measured by the same probe with a per-step watcher
(tape order `REG, WORK, STACK, HEAP, BOX`):

| program | encoding | states | tapes with a `Move::L` rule | tapes reaching cell -1 | of those, ending all-blank |
| --- | --- | --- | --- | --- | --- |
| `3 - 5` | unary | 60 | REG, WORK | WORK | WORK |
| `3 - 5` | binary | 58 | REG, WORK | — | — |
| `if 2 > 1 { 10 } else { 20 }` | unary | 96 | REG, WORK | WORK | — |
| `if 2 > 1 { 10 } else { 20 }` | binary | 101 | REG, WORK | — | — |
| `cons(1, cons(2, nil))` | unary | 146 | REG, WORK, HEAP | WORK, HEAP | — |
| `cons(1, cons(2, nil))` | binary | 201 | REG, WORK, HEAP | HEAP | — |
| `fn add1(x) … pair_sum(1, add1(2))` | unary | 636 | REG, WORK, STACK | WORK, STACK | STACK |
| `fn add1(x) … pair_sum(1, add1(2))` | binary | 743 | REG, WORK, STACK | STACK | STACK |
| `1 + 2 * 3` | unary | 143 | REG, WORK | WORK | — |
| `1 + 2 * 3` | binary | 278 | REG, WORK | — | — |
| `let x = 40; x + 2` | unary | 123 | REG, WORK | WORK | — |
| `let x = 40; x + 2` | binary | 112 | REG, WORK | — | — |
| `fn sum(n) … sum(5)` | unary | 1,182 | REG, WORK, STACK | WORK, STACK | STACK |
| `fn sum(n) … sum(5)` | binary | 1,371 | REG, WORK, STACK | STACK | STACK |

Four things to read off it, each of which shapes the design below:

- **No tape goes below cell -1 in any of the fourteen runs.** A fold that is correct only one cell deep
  passes a leg built on this corpus, so the leg cannot be the whole test.
- **Two or three of the five tapes have any `Move::L` rule, in each of these fourteen machines.** A tape
  with none can never go negative, which is what makes a per-tape side bit affordable.
- **Five of the thirteen excursions happen on a tape that ends all-blank** — every STACK excursion, and
  WORK for unary `3 - 5`. `single_tape.rs`'s `normalize` discards the head position on exactly such a
  tape, so this leg cannot inherit it the way stage 2's did.
- **All four members of stage 2's corpus reach cell -1 under unary**, so reusing that corpus gives the
  leg a live excursion in every program.

## Why not the roadmap's two-track fold

The roadmap's sketch folds the tape at the origin onto two tracks. It hits the wall stage 1's sketch did:
`Symbol = char` (`tm/machine.rs`), so a pair symbol must BE one `char`, and a rule cannot wildcard half of
it. A concrete read of `a` on one track becomes one rule per possible symbol on the other, and so does a
concrete write, since the other half must be rewritten unchanged. The alphabet becomes every pair plus
origin-marked copies — `2·n²` symbols for an `n`-symbol alphabet — which, over the 3–5-symbol alphabets
stage 2's spec measured on lowered machines, moves its block width from 2–3 bits to 5–6 when the two
compose.

The zig-zag layout below keeps every read and write in place, so rules are copied rather than
enumerated, and it spends its cost in steps — the currency this track measures anyway.

## Layout

The same on every tape:

| physical cell | holds |
| --- | --- |
| 0 | `LEFT_END` (`\|`) |
| `2j + 1` | original cell `j`, for `j ≥ 0` |
| `2j + 2` | original cell `-(j + 1)` |

**Every tape gets the layout, including tapes no initial content names.** `trace.rs`'s `TmCursor::new`
builds a missing tape as `Tape::new(&[])` — a plain blank tape with no marker — so `zigzag` takes the tape
count and emits a marker for each.

**The side is recoverable from the tape alone:** an odd physical cell is on the right half, an even one
(≥ 2) on the left. `unzigzag` needs no state from the run.

A cell no head has visited reads `BLANK` on both halves, which is correct for both: the original's
unvisited cells are blank too. Nothing needs pre-writing.

## Mechanism

**A preamble** — one state, one step — moves every head from `LEFT_END` onto physical cell 1, original
cell 0. `Tape::new` starts every head on cell 0, which here is the marker.

**Control states are pairs `(s, sides)`**, where `sides` holds one right/left side for every tape; a tape
with no `Move::L` rule in `m` never leaves the right. Pairs are emitted from a worklist starting at
`(m.start, all right)`, so only pairs reachable through the control graph are built, and
`2^(tapes with a Move::L rule)` is a ceiling on the multiplier. **Measured, the worklist saves nothing on
the corpus the ceiling gates:** every combination is reachable — 4 of 2^2 for `1 + 2 * 3`, and 8 of 2^3
for `cons(1, cons(2, nil))` and for `sum(5)`, under both encodings.

**Rules are copied, not rewritten.** State `(s, sides)` carries `s`'s rules in `s`'s order with identical
reads and writes, so first-match-wins is unchanged and no symbol is ever enumerated. Between original
steps every head sits on physical cell ≥ 1, so a wildcard read never sees `LEFT_END`. An accept state maps
to an accept state with no rules; a state with no rules maps to a state with no rules — a stuck halt stays
a stuck halt, and the reduction must not invent an accept there.

**Moves are the only thing replaced.** A move's first physical step depends only on its direction and the
tape's side, so every moving tape takes it inside the copied rule, together with the write. The rest of
each tape's move then runs in a chain, one tape at a time:

| side, move | step 1 (in the copied rule) | rest | steps in total | side flips |
| --- | --- | --- | --- | --- |
| right, `R` | `R` | `R` | 2 | never |
| left, `L` | `R` | `R` | 2 | never |
| right, `L` | `L` | reads `LEFT_END`? `R`, `R` : `L` | 3 if crossing, else 2 | when leaving cell 0 |
| left, `R` | `L` | `L`, then reads `LEFT_END`? `R` : stay | 3 | when leaving cell -1 |

The two crossing rows never step left of physical cell 0: from original cell 0 (physical 1) the first `L`
lands on the marker, and from original cell -1 (physical 2) the two `L`s land on it. Each crossing check
has two exits, so a later tape's chain is built once per exit it can be reached from, and the chain
carries the updated `sides` into `(rule.next, sides')`.

**States:** 1 extra per tape moving right on the right half or left on the left half; 2 per tape moving
toward the origin. **Steps:** as tabled. How these combine per original state depends on the reachable
`sides`, which only building the construction can count — stage 1's design estimated its own ratio 2.7×
low, so no figure is estimated here, and the plan gates a ceiling and prints the measured ratio.

## Naming: why nothing is called `ORIGIN`, `fold` or `anchored`

- **`ORIGIN`** appears in `encoding/binary.rs` and `encoding/unary.rs` prose meaning a tape's cell 0
  (`binary.rs:744`, `unary.rs:519`), and `encoding.rs` uses "origin" the same way. This design uses
  "origin" in prose in that sense only; the marker SYMBOL is `LEFT_END`, because a cell and the symbol in it
  are different things.
- **`fold`** is a mini-language demo function inside oracle test strings (`three_way_oracle.rs:234`) and
  `Iterator::fold` in every Rust file, so the layout pair is `zigzag` / `unzigzag`, after the layout.
- **`anchored`** is `.tm` comment anchoring (`comments.rs:191`), so the comparison is
  `OriginSnapshot::trimmed`.

Checked with `grep -rPl` over `crates/`, `web/src` and `docs/`, excluding this file, on the commit this
spec was branched from (`22229fb`): `one_way`, `LEFT_END`, `zigzag`, `OriginSnapshot` and
`left_end_collision` each had zero matches — which covers `to_one_way` and `unzigzag` as substrings. The
character literal `'|'` matched no file under `tm/`; its matches in source are `lexer.rs`, `printer.rs`
and `redextape-test-support`'s `ts_derive_scan.rs`.

## Surface

New module `crates/redextape-core/src/tm/one_way.rs`, plus one `pub mod` line in `tm.rs`:

- `pub const LEFT_END: Symbol = '|'`
- `to_one_way(m: &Machine) -> Machine`
- `left_end_collision(m: &Machine) -> bool` — the predicate `to_one_way`'s refusal is defined as, exported so
  a caller can pre-check instead of string-matching a refused machine's name; the counterpart to
  `two_symbol.rs`'s `uncovered_symbol`
- `zigzag(inits: &[Vec<Symbol>], tapes: usize) -> Option<Vec<Vec<Symbol>>>`
- `unzigzag(tape: &Tape) -> Option<OriginSnapshot>`
- `struct OriginSnapshot { cells: Vec<Symbol>, head: usize, origin: usize }` — a snapshot that also knows
  where original cell 0 is. Named fields because two `usize`s in a tuple invite a swap
- `OriginSnapshot::trimmed(&self) -> OriginSnapshot` — strips blanks outside the window spanning the
  non-blank cells, the head AND the origin, re-indexing both; two trimmed snapshots compare with `==`
- `states_per_original(m: &Machine) -> Option<f64>` — `None` on a refusal, so a one-state refused machine
  cannot read as an excellent ratio, the lesson `two_symbol.rs`'s `states_per_original` records

`Machine` gains no field, as in both earlier stages.

**Each refusal sits where it cannot be skipped:**

- **`to_one_way` refuses** when `m.alphabet()` contains `LEFT_END`, returning a one-state non-accept machine
  named `left-end-collision` — the shape both earlier stages' `refused` return.
- **`zigzag` returns `None`** when an initial tape contains `LEFT_END` — `Machine::alphabet` cannot see
  initial contents, which stage 1 left to caller discipline and stage 2 moved into `bitify`'s type — and
  when `inits.len() > tapes`, where stage 1's `interleave` documents silently dropping tapes.
- **`unzigzag` returns `None`** when physical cell 0 is not `LEFT_END`, when `LEFT_END` appears in any other
  materialized cell, or when the head is on physical cell 0 — never true between original steps, but a
  run stopped by a cap can leave it there.

**The one-way certificate is `unzigzag` returning `Some`.** Materialization is permanent, so a head that
ever went left of physical cell 0 leaves index 0 holding something other than `LEFT_END`: that cell
materializes as `BLANK`, and `to_one_way` never writes `LEFT_END` (its copied rules write only `m`'s
symbols, and the refusal excludes `LEFT_END` from those). A `Some` on a halted run is therefore proof
the run stayed right, not a hope.

**Composition.** `|` is none of stage 1's reserved symbols (`<`, `>`, `A`–`Z`, `a`–`z`), and stage 1's
`layout_collision` would refuse the pairing if it were. Stage 2 reserves no symbols.

**Not in the module:** recording where the ORIGINAL run's origin ends up. That needs a watcher over the
whole run and is test instrumentation, so it lives in the oracle test file. A tape grows on its left
exactly when, after a step, its materialized length has increased and its head is at index 0 — a step
moves a head at most one cell, and right growth leaves the head at index ≥ 1.

## What the legs assert

All new tests live in a new `crates/redextape-core/tests/one_way_oracle.rs`. **Added during execution (the
plan's Task 6):** `core_and_ty` and `build_machine` moved into `crates/redextape-core/tests/common/mod.rs`,
and `single_tape_oracle.rs`, `two_symbol_oracle.rs`, `one_way_oracle.rs` and `tm_header.rs` import what
they use from there instead of carrying their own copies.

**Leg 6 (normal tier): `m == to_one_way(m)`, by origin-anchored tape identity.**

1. Simulate `m` on `inits` with the watcher, giving an `OriginSnapshot` per tape.
2. Simulate `to_one_way(m)` on `zigzag(inits, m.tapes)` and `unzigzag` every tape.
3. In this order: per tape, `unzigzag` is `Some` (the certificate); then the run's status is
   `Status::Halted`; then per tape the two snapshots are equal after `trimmed()`; then the final state is an
   accept, not a stuck halt.

`OriginSnapshot::trimmed` rather than `normalize`, because of the five all-blank excursions measured above.

**Corpus:** stage 2's four programs — all members of `native_oracle.rs`'s `FIRST_ORDER_DEMOS`, whose
four-way oracle supplies the earlier equalities — under unary, plus `cons(1, cons(2, nil))` under binary,
whose HEAP reaches cell -1 and ends non-blank. **Asserted per program, not claimed:** the original run's
watcher saw at least one tape grow on its left. A corpus-wide floor would stay green while one member went
vacuous.

**Fold, then stage 2 (normal tier): `to_two_symbol(to_one_way(m))`** — multi-tape, two symbols, never left of
cell 0. Stage 2's leg assertions applied to the folded machine: folded tapes always hold `LEFT_END` at cell
0, so `normalize`'s all-blank blind spot cannot arise there. **Certificate:** every tape's first `k` cells
equal `code.pattern(LEFT_END)`. Sound because stage 2 moves in whole `k`-cell strides and neither stage
writes `LEFT_END`, so an excursion would put a different block, or the all-zero block, at cell 0.

**Stage 1 then stage 2, certificate only (normal tier):** `3 - 5`, 2,158,491 steps as measured above. The
first four cells equal `code.pattern('<')` = `__11`. This is the regression gate on the finding: a stage 1
change that lets a head cross `<` reddens it. Sound for the same reason, since stage 1 never writes `<`.

**All three, fold then stage 1 then stage 2 (slow tier, one program).** The roadmap's literal punchline — one
tape, one head, two symbols, one-way. Its doc states that in this order stage 1 bounds the tape anyway, so
the run shows the stages COMPOSE and is **not** evidence the fold works; leg 6 and the deep-excursion tests
below are. **As built, it compares a stage at a time** — the folded run against stage 1's image, stage 1's
image against stage 2's — because an accept plus a certificate does not show the stages compute the same
tapes, and it interleaves with no left padding (`interleave(&z, folded.tapes, 0, 1)`), since a folded
machine never visits a cell left of its marker. Measured on `3 - 5`: 7,088,578 steps, under a cap of
100,000,000.

## Testing

**Unit tests in `one_way.rs`:**

- **Round trip (proptest):** `zigzag` arbitrary tapes, run `to_one_way` of a machine whose start state
  accepts, so the preamble is the only step, and `unzigzag(..).trimmed()` must equal each initial tape's
  own trimmed snapshot, head and origin both at original cell 0. **Trimmed, because `unzigzag` alone
  reports origin > 0 here:** `zigzag` writes a blank left-half cell between every two content cells, so
  those cells are materialized. It goes through a run because `Tape::new` leaves the head on `LEFT_END`,
  where `unzigzag` correctly refuses.
- **A hand-written one-tape machine** checked cell for cell against its folded image.
- **`trimmed` against `normalize`:** two all-blank tapes with different heads compare equal under
  `normalize` and unequal under `trimmed` — the reason `trimmed` exists.
- **Refusals:** a machine writing `LEFT_END` is refused, `left_end_collision` is `true` and
  `states_per_original` is `None`; `zigzag` is `None` for `LEFT_END` in an initial tape and for
  `inits.len() > tapes`.

**The watcher, in the oracle file:** a machine stepping left 3 then right 5 reports origin 3; a machine that
only moves right reports 0.

**Deep excursions — the tests that make the fold's correctness past cell -1 observable at all:**

- **Depth 5, hand-written:** walk left five cells writing marks, cross back over cell 0, write again.
- **Two tapes crossing in one rule**, both leftward in one rule and both rightward in another, so both side
  bits flip at once and the chain must carry both.
- **Proptest over random acyclic machines**: one to three tapes, every rule targeting a higher-numbered
  state so every run halts, random concrete and wildcard reads, moves biased left. Asserts leg 6's
  certificate and tape identity, and that the final state's accept flag equals the original's — NOT leg 6's
  accept requirement, since a random machine can legitimately halt stuck. **The plan measures once what share of
  generated cases reaches depth ≥ 2 and records it**, rather than assuming a green proptest went there.

**Cost:**

- **A ceiling on `states_per_original`** over the corpus, printing the measured ratio. An oracle leg can
  never redden for a cost regression — a bloated-but-correct construction is still correct — which is
  stage 1's lesson. The ceiling is set from measurement: 40.0, above a measured maximum of 34.630197
  (binary `sum(5)`).
- **Reachable `sides` combinations per program**, printed, against the `2^n` ceiling.
- **The cost table (slow tier):** original steps against folded steps on stage 2's table programs — `1 + 2 * 3`,
  `let x = 40; x + 2`, `sum(5)` — under both encodings, each row naming its count of tapes with a `Move::L`
  rule. **Two predictions it tests:** roughly twice the steps, and a ratio independent of tape length,
  because the fold is local the way stage 2 is and stage 1 is not.
- **The largest shipped demo (49,135 states, per stage 1's spec):** whether it can be folded under
  `MAX_MACHINE_STATES` is measured once and recorded, not gated. Measured: 7,363,253 states, ratio
  149.857596, with four tapes carrying a `Move::L` rule — it cannot be folded under the cap.

**Sabotages** — each run on its own. A sabotage that reddens nothing is the finding, not a footnote. The
results below were measured on the finished code while planning; each row names what the plan's sabotage
steps check, not every test that reddens:

| sabotage | measured result |
| --- | --- |
| S1: drop the `LEFT_END` check, so a right-half `L` from cell 0 steps left twice | leg 6 reddens at the certificate on its first member, `3 - 5`'s WORK tape; the loop stops there, so this shows nothing about the later members |
| S2: a left-half `L` strides one physical cell instead of two | **leg 6 stays green**, since no corpus tape goes below cell -1; the depth-5 test and the proptest redden |
| S3 (never committed): stage 1's `rew` steps one cell past `<` before turning | the stage-1-then-stage-2 certificate reddens; `two_symbol_oracle.rs` and `single_tape_oracle.rs` stay green |
| S4 (added while planning): a crossing's flip is lost whenever a later tape also moves in the same rule | **leg 6, the depth-5 test and the toy unit test stay green**; the two-tape test, the proptest and the first assertion of `a_tape_with_no_left_move_is_never_on_the_left_half` redden |
| S5 (added while planning): a flip flips every tape | leg 6 reddens with `tape 0 differs for cons(1, cons(2, nil)) (Unary)`, and `a_tape_with_no_left_move_is_never_on_the_left_half` reddens at its second assertion, which S4 cannot reach |

**Every certificate is asserted before `Status::Halted`.** A sabotage whose run ends in `HitCap` otherwise
trips the status assertion first, and the certificate is never shown able to fail.

## Deliberately out of scope

- **Completing all tapes' moves in parallel.** It would save steps; the cost is the artifact, measured and
  not optimised.
- **Keeping each tape's side on the tape rather than in the control state.** Rejected: an unvisited cell
  reads `BLANK`, which says nothing about which half it is on.
- **A one-way mode in `sim.rs`.** The `.tm` text form defines tapes as two-way infinite
  (`syntax.rs:38`), and one-wayness here is certified per run instead.
- **A `.tm` header or fixture for folded machines.** It stays open.
- **In scope, as for every substantive branch:** the roadmap entry, and correcting the pipeline bullet,
  which says the tape-folding stage is "genuinely available" because `Tape` is two-way — true of the
  simulator, and not of anything stages 1 and 2 build.
