# Single-tape reduction — design

> **Roadmap:** *Single-tape TM — backend/theory track*, and stage 1 of *Machine-model reductions — a
> PIPELINE*. Raised 2026-07-22, placed but never planned. This spec plans it, and corrects the
> roadmap's own sketch of the mechanism on measured grounds.

## What this delivers

A `Machine(k-tape) -> Machine(1-tape)` transformation, a tape interleaving and its inverse, and a
**fourth oracle leg**: `reference == λ == multitape-TM == singletape-TM`. It executes a second named
theorem — multi-tape ≡ single-tape — and touches **nothing** in Core, asm or `encoding`, which is the
architectural principle the roadmap states for this whole track.

## The roadmap's sketch does not fit this repo, and the numbers are why

The roadmap says to build it "via the textbook `2k`-track interleaving simulation (per tape: a content
track + a head-marker track on one tape over a **product alphabet**)" and to "keep the alphabet a
tuple, not a blown-up power set". Two facts about this tree make that impossible as written:

- `Symbol = char` (`tm/machine.rs`). There is no tuple to keep; a product symbol has to BE a `char`.
- `TAPES = 5` (`tm/build.rs`), fixed for every machine this project lowers.

For the checked-in `list_1_2.tm`, Γ = `{#, 1, @, _}`, so a product alphabet is 4⁵·2⁵ = **32,768**
symbols against 6,400 code points in the BMP private-use area. Under `binary` it is 5⁵·2⁵ = 100,000.
The textbook construction does not fit the type this repo has at the tape count this repo uses.

**The state cost is the harder half.** The textbook sweep *collects* the k marked symbols into the
control state, which multiplies states by |Γ|ᵏ: 146 × 4⁵ = **149,504** for the smallest real machine
there is, against `MAX_MACHINE_STATES = 1_000_000`, before any phase multiplier. Anything real blows
it.

## The mechanism: verify, never collect

Rules are already an ordered list per state, and determinism is "first matching rule wins". So the
single-tape machine never needs to know WHICH symbols are under the heads — only whether they match a
**specific candidate rule**. For candidate rule `r` of state `s`:

1. **Verify sweep.** Walk the tape; at each block, for each tape `i` whose marker says the head is
   here, check the content cell against `r.read[i]`. On the first mismatch, restart at candidate
   `r + 1`. If every position matches, proceed.
2. **Apply sweep.** Walk again, writing `r.write[i]` at each marked cell and moving each marker per
   `r.moves[i]`, then enter the state for `r.next`.

The control state encodes *"verifying tape i for rule r of state s"* — a comparison, not a symbol. The
|Γ|ᵏ factor disappears because no symbol is ever remembered.

`Move::S` moves no marker, so it costs nothing in the apply sweep. An `accept` state maps to an
`accept` state with no rules, so the single-tape machine halts exactly where the multi-tape one does —
which is what makes "the halt states agree" a real assertion rather than a tautology. A state whose
candidates are all exhausted without a match is a stuck halt, exactly as it is in the original: the
reduction must not invent an accept there.

**Wildcards fall out, and they are load-bearing rather than incidental.** `read[i] = None` is a
per-tape wildcard, so no verify state is emitted for that position at all; `write[i] = None` leaves the
cell. Measured over three real lowered demos and the checked-in fixture, **80.9%–82.0% of read
positions are wildcards** — fewer than one concrete read per rule across five tapes:

| machine | states | rules | read positions | wildcards | concrete reads/rule |
| --- | --- | --- | --- | --- | --- |
| `fn sum(n) … sum(5)` | 1,182 | 2,782 | 13,910 | 81.2% | 0.94 |
| `count_down(4)` | 1,365 | 3,354 | 16,770 | 80.9% | 0.95 |
| `let mut n = 4; while …` | 542 | 1,362 | 6,810 | 80.9% | 0.95 |
| `tests/fixtures/list_1_2.tm` | 146 | 309 | 1,545 | 82.0% | 0.90 |

Scaled to the largest machine the shipped demos build — **49,135 states**, `state_cost_probe`
section G — a naive `states × rules-per-state × k × phases` construction needs ≈ **1.77M** states and
does not fit. Emitting states only for the positions that need them fits.

**The projection is measured on three real machines rather than assumed, and it is higher than this
section's first estimate.** Per original state the construction emits
`rules/state × (1 + concrete-reads/rule + acting-tapes/rule) + 1`, where a tape *acts* when it has a
concrete write or a non-`S` move (measured: 0.91-0.94 per rule, essentially one tape per rule):

| machine | states | rules/state | reads/rule | acting/rule | states emitted per original state |
| --- | --- | --- | --- | --- | --- |
| `fn sum(n) … sum(5)` | 1,182 | 2.35 | 0.94 | 0.93 | **7.75** |
| `count_down(4)` | 1,365 | 2.46 | 0.95 | 0.94 | **8.12** |
| `[1, 2, 3]` | 240 | 2.21 | 0.92 | 0.91 | **7.26** |

At 7.26-8.12 the worst shipped demo needs **357,000-399,000** states, against the cap of 1,000,000. **THIS FORMULA COUNTS THE CHECK AND APPLY STATES AND NOT THE SCAN, REWIND, FAIL AND SEEK STATES AROUND THEM**, so the real ratio is higher by an amount nobody can know until the construction exists. The plan therefore gates the PROPERTY — under `1,000,000 / 49,135` = 20.4 per original state — and measures the ratio rather than restating this estimate.
An earlier draft of this section said 287,000; that formula counted three fixed phases and never
counted the apply passes at all.

**EVERY FIGURE IN THIS SECTION WAS FALSIFIED BY BUILDING THE THING, AND THE CORRECTED NUMBERS ARE
WORSE IN BOTH DIRECTIONS THAT MATTER.** The estimate above counts one state per concrete read and one
per acting tape. The construction actually emits, per rule, three states for the scan/rewind/fail
scaffolding, one `chk` per concrete read, and four or five per acting tape. Measured on the built
construction:

| machine | states | states emitted per original state |
| --- | --- | --- |
| `1 + 2 * 3` | 143 | **19.22**, and **17.51** after the no-write pass was split out |
| `cons(1, cons(2, nil))` | 146 | **18.75**, and **17.09** after that split |
| `fn sum(n) … sum(5)` | 1,182 | **21.20**, and **19.20** after the no-write pass was split out |
| the `map`/`ap2` higher-order demo | **49,135** | **39.51**, and **36.86** after that split |

So the estimate of 7.75 for `sum(5)` was 2.7x low, and the extrapolation from `sum(5)` to the largest
shipped demo was wrong on top of that: **that machine is a different SHAPE, not merely a bigger one.**
It carries **1.71 acting tapes per rule** where the first-order fixtures carry ~0.9, and only **53% of
its acting tapes have no write** where they carry ~88%, because it goes through `defunc`. Both of the
terms the cost is made of move against it at once.

Two more `FIRST_ORDER_DEMOS` members, measured the same way, sit far closer to the ceiling than any row
above: the program `let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc` is
542 states and measures **20.339483** against a ceiling of **20.352091** — a margin of 0.062% — and
`fn count_down(n) { let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc } count_down(4)` is
1,365 states at **20.147985** (+1.003%). Both are `FIRST_ORDER_DEMOS` members. Neither is in the gated
set, deliberately, because at 0.062% a seven-state change to an 11,024-state image would trip the
assertion.

**THE CONSEQUENCE, STATED PLAINLY: the largest machines the demo suite ships CANNOT BE REDUCED.** At
36.86 the `map`/`ap2` demo needs ~1.81M states against `MAX_MACHINE_STATES` of 1,000,000.

**AND THE REQUIREMENT THAT NUMBER WAS MEASURED AGAINST WAS THE WRONG ONE.** `1,000,000 / 49,135` = 20.4
asks whether the largest shipped demo can be BUILT. Nothing needs it to be. The reduction is quadratic
in tape length, so the single-tape image of a 49,135-state machine is unrunnable in STEPS by a margin
far larger than the one it misses in states — it was never going to execute, only exist. The requirement
that earns its place is the one the artifacts actually exercise: the oracle leg's corpus and the
slow-tier cost table, every member of which fits comfortably. The 20.4 figure stays in this document as
the boundary it is — the point past which a program can no longer be reduced at all — rather than as a
gate the construction failed.

Closing the 1.81x would mean collapsing the per-acting-tape passes into one sweep, which needs a third
marker per tape so a head already moved is not moved twice. That is a redesign of the phase, it is not
required by anything this slice delivers, and it is filed rather than done.

## Tape layout

`<` left sentinel, then blocks of `2k = 10` cells, then `>` right sentinel. Within a block, tape `i`
occupies a **marker cell followed by a content cell**.

**THE MARKER SYMBOL CARRIES THE TAPE INDEX, AND THAT IS WHAT MAKES THE MEASURED STATE COUNT REAL
RATHER THAN THE NAIVE ONE.** Marker cells use `H₀..H₄` (head is here) and `h₀..h₄` (head is not) —
spelled `A`-`E` and `a`-`e` — rather than one shared pair like `^`/`.`. With a shared pair, a machine
walking the tape cannot tell which tape a marker belongs to without COUNTING its offset within the
block, and that counter is `k` states on every walk: it multiplies the whole construction by 5 and
lands exactly on the naive figure this design exists to avoid. With per-tape markers the walk reads
the tape's identity out of the symbol, so it needs no counter and no offset tracking, and moving tape
`i`'s head right is "walk right to the next `hᵢ` or `Hᵢ`" — the next one is the next block's, because
a tape has one head.

Reserved characters in the `.tm` text form are `; * : [ ]` and whitespace (`tm/syntax.rs`), and `_` is
`BLANK`. `<`, `>` and the ten marker letters are all legal data symbols, so the layout costs
**`2k + 2` = 12** new symbols against an alphabet of 4 — cheap in exactly the dimension that is not
scarce, to buy back the one that is.

**THE BLOCK COUNT IS FIXED AT CONSTRUCTION, AND THAT IS FORCED BY THE STATE BUDGET RATHER THAN
CHOSEN FOR CONVENIENCE.** An earlier draft of this design had an apply sweep that owes a move past a
sentinel write one fresh blank block. That is cheap in STEPS and ruinous in STATES: **a Turing machine
has no return address**, so a shared subroutine must be duplicated at every call site, materialising a
block is `2k + 1` = 11 states, and the call sites are every rule that moves a head outward — measured
at 0.90 moves per rule. It raises the construction from ~7.8 states per original state to ~31, and the
worst shipped demo from ~380,000 to **~1.52M**, over the cap.

So `interleave` takes a **block count**, pre-writes that skeleton, and a head that would leave it
halts in a dedicated `overflow` state. Growth chains cost nothing because there is no growth. This is
the idiom this tree already uses everywhere else for the same reason — `MAX_SLOTS` and
`lower_tm_guarded`'s overflow state both refuse before building rather than growing — and it keeps the
failure NAMED: an overflow halt is distinguishable from a wrong answer, which is the property that
lets the oracle leg assert against it rather than around it.

## Surface

New module `crates/redextape-core/src/tm/single_tape.rs`:

- `to_single_tape(&Machine) -> Machine` — the transition table is independent of block count, so it
  takes no padding arguments; `left_pad`/`right_pad` are `interleave`'s alone
- `interleave(&[Vec<Symbol>], k: usize, left_pad: usize, right_pad: usize) -> Vec<Symbol>`
- `deinterleave(&Tape, k: usize) -> Option<Vec<(Vec<Symbol>, usize)>>` — contents AND head per tape, the shape `Tape::snapshot` returns
- `normalize(&[Symbol], usize) -> (Vec<Symbol>, usize)` — trims padding so the two sides are comparable at all

Nothing else changes. `Machine` gains no field — the rule `lower_tm.rs` states twice, and the rule the
self-describing-header slice held to.

## What the fourth leg asserts

Tape-identity, not value equality. Simulate multi-tape to get tapes `A`; interleave the same initial
tapes, simulate the single-tape machine, de-interleave to get `B`; assert `A == B` and that the halt
states agree. This is strictly stronger than value equality, and `decode_tape` then takes `B`
unchanged — so the value comparison comes free and **no second decode path exists that could drift**,
which is the failure the roadmap already recorded when `tm_val` was unary-only while its sibling in the
same file had been made four-way.

## Testing

- Proptest round-trip: `deinterleave ∘ interleave == id` for arbitrary tape contents and k.
- A hand-written 2-tape toy machine, checked cell-for-cell against its single-tape image.
- The leg over a small corpus (a monus, a comparison and an `if`, a two-element list) in the
  **normal tier**, so it is a live gate rather than something nobody runs. Every member is also a
  `FIRST_ORDER_DEMOS` entry, so the other three oracle legs already assert it and this leg only adds
  the fourth equality.
- THREE hand-copied real-lowered-machine programs (not the whole 46-entry `FIRST_ORDER_DEMOS`
  corpus) behind `#[ignore = "slow tier: …"]`, where `scripts/check-slow.sh` and CI's `rust-slow`
  job already run and so already reach them. This tier produces the **exact-integer cost table** —
  multi-tape steps against single-tape steps, per program — which is the roadmap's stated point:
  "polynomial slowdown is normally a hand-wave; here step counts are exact integers".
- A sabotage per this repo's practice: delete the wildcard skip. Measured directly, the oracle leg
  itself keeps PASSING — a bloated-but-correct construction is still correct, and an oracle leg
  checks correctness, never cost, so NO oracle leg can ever redden for this regression. The test
  that DOES redden is `single_tape.rs`'s own state-budget assertion
  (`real_lowered_machines_cost_far_more_than_the_toy_fixtures`), which measures
  `states_per_original` against the shared ceiling and is what actually says the 81% measurement
  is load-bearing rather than decorative.

## Deliberately out of scope

- **The alphabet reduction to `{0,1}` and the two-way→one-way fold.** Stages 2 and 3 of the roadmap's
  pipeline. This design keeps the alphabet small (Γ + 4) specifically so stage 2 stays cheap, but does
  not attempt it.
- **A `.tm` header for the single-tape machine.** The existing header records `tapes`, so `tapes 1`
  already round-trips; whether the reduced machine gets an `encoding`/`result` recipe is stage-2 work.
- **Making the reduction fast.** The cost IS the artifact. It is measured, not optimised.
