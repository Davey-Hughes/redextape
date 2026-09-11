# Alphabet reduction to two symbols — design

> **Roadmap:** stage 2 of *Machine-model reductions — a PIPELINE*
> (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`), which names it as the reduction to do
> after single-tape. Stage 1 shipped as `tm/single_tape.rs` (spec
> `docs/superpowers/specs/2026-09-10-single-tape-reduction-design.md`, merged as #87).

## What this delivers

A `Machine -> Machine` transformation onto a **two-symbol** tape alphabet, its tape encoding and
inverse, and a **fifth oracle leg**: `reference == λ == multitape-TM == singletape-TM ==
two-symbol-TM`. Composed with stage 1 it produces **one tape, one head, two symbols** — the canonical
machine, minus stage 3's one-way fold. It touches nothing in Core, asm or `encoding`, which is the
architectural principle the roadmap states for this whole track.

## The two senses of "binary", which is why nothing here is named `binary`

The roadmap asks for this contrast to be written down, on the grounds that conflating the two is the
obvious misreading. They are independent axes and they compose freely:

| | what varies | where it lives | what it changes |
| --- | --- | --- | --- |
| `EncodingKind::Binary` | how a **number** is represented inside a field | `tm/encoding/binary.rs` | field width, arithmetic gadgets |
| alphabet reduction | how a **symbol** is represented in **cells** | this module | the tape alphabet itself |

A machine under `EncodingKind::Binary` stores numerals in base 2 using the data symbols `0` and `1` —
and its tape alphabet is still `#01`, three symbols, plus `_` and `@` where lists are in play. The
alphabet reduction takes *any* such alphabet down to two symbols by spending cells. Measured on the
demos below, the two axes even disagree about which is "smaller": `EncodingKind::Binary` makes the
alphabet **larger** (`#@_01` against unary's `#@_`), so it costs the alphabet reduction a bit per
symbol.

The module is therefore `tm/two_symbol.rs` and the function is `to_two_symbol`. `tm/encoding/binary.rs`
already owns the name `binary` in this tree, and a second, different meaning under the same name is
the drift `scripts/check-attributions.sh` exists downstream of.

## The blank IS the zero bit, and that is forced rather than chosen

`BLANK` is a fixed `const` (`_`, `tm/machine.rs`) and `sim.rs`'s `Tape` materializes cells lazily, so
an unvisited cell reads `BLANK` and no construction can change that. A machine whose alphabet is
literally `{'0', '1'}` would therefore read a third symbol the moment a head stepped past its written
region — the alphabet would be three, not two, and the extra one would appear only on inputs that ran
far enough to find it.

So the two symbols are `_` and `1`, with `_` playing zero, and **`code(BLANK) = 0ᵏ` is an invariant
rather than a convention**: an unwritten region is an infinite run of zero-bits, and it must decode
back to the run of `BLANK`s that the original tape has there. Any other assignment makes the
correspondence false exactly where a tape is shortest.

The consequence worth stating plainly: *written zero* and *never written* are indistinguishable on the
reduced tape. That is the point of the encoding, not a defect of it — the original machine cannot
distinguish them either, because `BLANK` is an ordinary symbol it may write.

## The layout

Original cell `j` of tape `i` occupies reduced cells `[j·k, (j+1)·k)`, most significant bit first.
MSB-first is arbitrary and is documented as arbitrary; nothing depends on it beyond `bitify` and
`unbitify` agreeing, which they do by construction because they share one `Code`.

**Invariant: between original steps, every head sits on the first cell of its block.** Blocks tile the
integers from the origin in both directions, so a left move is `k` cells left and lands on a block
start again.

**No skeleton, no sentinels, no overflow state.** Stage 1 needed a fixed block count because its
markers coexist with data on one tape and a head could walk off the end of the interleaving; the
alphabet reduction has no reserved symbols at all — *every* cell of a reduced tape is a bit — so the
tapes stay two-way infinite and grow exactly as the original's do.

**THIS SECTION CLAIMED "there is no `layout_collision` analogue here and none is needed". THE FIRST
HALF WAS TRUE AND THE SECOND WAS FALSE.** Nothing of the original alphabet survives on the reduced
tape, so no *collision* is possible — that much holds. But the reduction still has a pairing it cannot
represent: a `Code` that does not cover the machine it is handed. A read symbol with no pattern was
guarded from the start; a **write** symbol with no pattern was not, and silently became "no write",
firing the rule and reporting an ordinary accept on a tape that was never written. `to_two_symbol`
therefore refuses such a pairing and `uncovered_symbol` is the predicate to pre-check it with — the
same shape stage 1 uses, arrived at for a different reason.

## The mechanism: verify, never collect

Stage 1's trick transfers unchanged, for the same reason. Collecting a block's `k` bits into the
control state to learn *which* symbol it is costs `2ᵏ = |Γ|` states per read position. But rules are
an ordered list and determinism is first-match-wins, so the reduced machine never needs to know which
symbol is under a head — only whether it equals the symbol a **specific candidate rule** asks for, and
comparing against a known `k`-bit pattern costs `k`.

For candidate rule `r` of state `s`, in the original's rule order:

1. **Verify.** For each tape `i` whose `read[i]` is concrete: walk right over the block comparing
   bit by bit (`k` states), then rewind to the block start. On a mismatch at bit `p`, rewind `p` cells
   and restart at candidate `r + 1`. Tapes verified earlier are already back at their block starts, so
   nothing else needs unwinding.

   **THE TWO REWIND LADDERS CANNOT SHARE, WHICH THIS SECTION ORIGINALLY GOT WRONG.** It said "a shared
   chain of `k-1`". Both ladders walk left over the same cells and differ only in where rung 0 goes —
   the success path continues to the next tape, the failure path abandons the candidate — and a Turing
   machine has no return address to carry that difference in. So a concrete read costs `k` checks plus
   `2(k - 1)` rungs: **`3k - 2`**, not the `2k` the cost section below estimated. The two agree at
   `k = 2` and diverge after.
2. **Apply.** Per tape, the write and the move **fuse**. `write[i] = Some(y)` walks right writing
   `code(y)`'s `k` bits and lands on the next block (`k` states) — so `Move::R` costs nothing further,
   `Move::S` costs `k` back, and `Move::L` costs `2k` back. `write[i] = None` is `k` states for `L` or
   `R` and **zero for `S`**. Stage 1 found that splitting the no-write path out was worth ~9% of its
   state count; here it falls out of the layout instead of being an optimisation.
3. Enter the state standing for `r.next`.

A state whose candidates are all exhausted enters a no-rule, non-accept state — the original's stuck
halt. The reduction must not invent an accept there, which is what makes "the halt states agree" an
assertion rather than a tautology. An `accept` state maps to an `accept` state with no rules.

**Wildcards emit nothing**, exactly as in stage 1: `read[i] = None` gets no verify states and
`write[i] = None` gets no write pass. Stage 1 measured 80.9%–82.0% of read positions as wildcards on
real lowered machines, which is the same corpus this reduction runs on.

## The alphabet is small, and that is the whole cost argument

`k = max(1, ceil(log₂ n))` over the symbols that can appear on a tape. Measured on shipped demos —
reproduce any row with

```sh
cargo run --release -q -p redextape-cli -- emit PROG.rxt --lang tm --encoding ENC \
  | grep -oE '\[[^]]*\]' | grep -vE '^\[[LRS ]*\]$' | tr -d '[] ' | fold -w1 \
  | grep -v '^\*$' | sort -u | tr -d '\n'
```

| program | unary | `k` | binary | `k` |
| --- | --- | --- | --- | --- |
| `1 + 2 * 3` | `#_1` (3) | 2 | `#01` (3) | 2 |
| `cons(1, cons(2, nil))` | `#@_1` (4) | 2 | `#@_01` (5) | **3** |
| `fn sum(n) … sum(5)` | `#_1` (3) | 2 | `#_01` (4) | 2 |
| single-tape image of `1 + 2 * 3` | `#1<>AB_ab` (9) | 4 | — | — |
| single-tape image of `cons(1, cons(2, nil))` | `#1<>@ABD_abd` (12) | 4 | — | — |

Two things to read off it. **`k` is 2 for the machines this project actually lowers**, so the
reduction is cheap on its own; the expensive case is the composed one, where stage 1's markers push
the alphabet to 9–12 and `k` to 4. And **the single-tape images use only the markers for tapes their
rules touch** — `1 + 2 * 3` reduced uses `A B a b`, two tapes of five — which is why 9 rather than the
16 a full five-tape marker set would need.

**The composed rows are also the concrete instance of why `Code::new` takes the initial tapes.** Those
two counts are `Machine::alphabet()`, i.e. rules only, and `interleave` writes a marker for **every**
tape in `0..k` into the skeleton whether its rules mention that tape or not. So the tape handed to the
reduced machine carries markers its rules never name. Measured as
`single.alphabet() ∪ interleave(inits, tapes, 2, 2) ∪ {BLANK}`, which is exactly the set `Code::new`
builds: `1 + 2 * 3` is `#1<>ABCDE_abcde`, **15 symbols against the 9 its rules mention**, and
`cons(1, cons(2, nil))` is `#1<>@ABCDE_abcde`, **16 against 12**. Both still land at `k = 4`, so **this
particular pair of programs would not have caught the bug** — which is why the plan sabotages the check
rather than trusting the corpus to exercise it, and why the plan pins both counts in a test.

## Cost: estimated here, gated as a property, measured by the plan

Per rule the construction emits `2k` states per concrete read, `k` to `2k` per acting tape, and a small
fixed scaffold. **The first term is wrong: a concrete read costs `3k - 2`**, for the reason the
mechanism section above now gives. The estimate is left standing with its error named, because what it
was wrong about is the point. Written out, with `k = 2` and the rule shapes measured on the demos above (0.90–0.94
concrete reads and 0.83–0.93 acting tapes per rule, 2.1–2.4 rules per state):

```
per rule   = 2k·reads + 1.5k·acting + scaffold
           = 4(0.90) + 3(0.87) + 2               = 8.2
per state  = 8.2 × 2.2 rules/state                ≈ 18 states per original state
```

Steps come out near the same shape, because the same passes run: ≈8 per original step for the matching
candidate plus ≈4 for one failed candidate ahead of it, so **≈12×**.

**THESE ARE ESTIMATES AND STAGE 1's EQUIVALENT ESTIMATE WAS 2.7× LOW.** That design projected 7.75
generated states per original state for `sum(5)` and the construction emitted 21.2; the extrapolation
to the largest shipped demo was then wrong again on top of it, because that machine is a different
shape rather than a bigger one. So the plan **gates a ceiling and prints the ratio**, and no number in
this section is restated as a fact anywhere in the shipped tree.

**One property here is genuinely different from stage 1 and is the thing most worth measuring.** Every
simulated single-tape step sweeps the whole block skeleton, which is why stage 1 is quadratic in tape
length and why its raw blowup ratio turned out to be dominated by a padding constant. The alphabet
reduction is **local**: a head moves at most `k` cells to read, `k` back to rewind, and `k` to move, so
the per-step cost is `O(k)` and **independent of tape length**. If that holds, stage 2's cost table
covers real programs rather than toys. It is a prediction until the table exists.

## Surface

New module `crates/redextape-core/src/tm/two_symbol.rs`:

- `struct Code` — the symbol ↔ bit-pattern table and `k`
- `Code::new(m: &Machine, inits: &[Vec<Symbol>]) -> Code`
- `to_two_symbol(m: &Machine, code: &Code) -> Machine`
- `bitify(inits: &[Vec<Symbol>], code: &Code) -> Option<Vec<Vec<Symbol>>>` — `Option`, because a symbol
  with no code cannot be encoded, and returning a silently wrong tape is the failure `Code::new` exists
  to prevent. The obligation belongs in the type rather than in a caller's discipline
- `uncovered_symbol(m: &Machine, code: &Code) -> Option<Symbol>` — the predicate `to_two_symbol`'s
  refusal is defined as, exported so a caller can pre-check instead of string-matching a refused
  machine's name. The counterpart to `single_tape.rs`'s `layout_collision`
- `unbitify(tape: &Tape, code: &Code) -> Option<(Vec<Symbol>, usize)>`
- `states_per_original(m: &Machine, code: &Code) -> Option<f64>` — `None` on a pairing
  `to_two_symbol` refuses, so a refusal cannot be read as an excellent ratio

`Machine` gains no field — the rule `lower_tm.rs` states twice, and the one stage 1 held to.

**`Code` is the anti-drift device, and it takes `inits` because `Machine::alphabet()` is not the set of
symbols that can appear on a tape.** `alphabet()` collects reads ∪ writes. A rule with a wildcard read
and a wildcard write carries an *initial* symbol past untouched without ever mentioning it, and `BLANK`
need not appear in any rule at all. The set that matters is `writes ∪ inits ∪ {BLANK}`, and
`alphabet() ∪ inits ∪ {BLANK}` is the safe superset `Code::new` builds. This is stage 2's version of
the hazard `layout_collision` exists for in stage 1 — there a missed symbol corrupted the tape while
the machine reported an ordinary accept; here a missed symbol has **no code at all**.

Because one `Code` feeds `to_two_symbol`, `bitify` and `unbitify` alike, the encode and decode paths
cannot disagree about `k` or about any symbol's pattern. That is stage 1's "no second decode path that
could drift", obtained structurally rather than by discipline.

`unbitify` returns `None` on a tape that is not a whole number of aligned blocks — a structural failure
of the reduction rather than a computation that went wrong, so it carries no reason, the same call
`deinterleave` makes.

Comparison reuses `single_tape::normalize` rather than growing a second trimmer, so the two reductions'
oracle legs compare tapes the same way. **That function's documented limitation is inherited:** on an
all-blank tape it discards the head position, so any assertion it backs is satisfied by any head on
either side whenever that tape ends all-blank.

## What the fifth leg asserts

Tape identity, not value equality, the same as stage 1. Simulate the original to get tapes `A`;
`bitify` the same initial tapes, simulate the two-symbol machine, `unbitify` to get `B`; assert
`A == B` per tape and that the halt states agree. `decode_tape` then takes `B` unchanged, so the value
comparison comes free and no second decode path exists.

## Testing

- Proptest round-trip: `unbitify ∘ bitify == id` for arbitrary tape contents and alphabets.
- `Code` unit tests: `code(BLANK) == 0ᵏ`, determinism across builds, and `k` for a one-symbol alphabet.
- A hand-written toy machine checked cell for cell against its two-symbol image.
- The fifth leg over a small corpus in the **normal tier**, so it is a live gate. **Every member must
  be a `FIRST_ORDER_DEMOS` entry** (`crates/redextape-native/tests/native_oracle.rs`): that array's
  four-way oracle already asserts `reference == λ == multitape-TM == native` for its members, so a
  program drawn from it gets the first equalities for free and this leg only adds the fifth. A
  non-member would establish `multitape == two-symbol` and nothing else — the mistake stage 1's
  corpus made before it was corrected.
- **One leg under `EncodingKind::Binary`**, because that is the one axis measured above that moves
  `k` (`#@_01` is 5 symbols, so `k = 3`, against unary's 4 and `k = 2`). The roadmap asks whether the
  oracle runs the product of the axes or a diagonal; stage 1 ran unary only, and this is a diagonal
  with one deliberate off-axis point, not a product.
- **The composed canonical machine**, `to_two_symbol(to_single_tape(m))` — one tape, one head, two
  symbols — on tiny programs in the **slow tier**, where `scripts/check-slow.sh` and CI's `rust-slow`
  job already run.
- The **cost table** in the slow tier: original steps against two-symbol steps against composed steps,
  with `k` named per row, since a blowup quoted without its `k` is not a property of the reduction.
- A **state-ratio assertion** gating a ceiling, with the measured ratio printed alongside — stage 1's
  lesson that an oracle leg can never redden for a cost regression, because a bloated-but-correct
  construction is still correct.
- **A sabotage**, per this repo's practice: build `Code` from `m.alphabet()` alone, dropping `inits`
  and `BLANK`. The property it aims at is precisely "the code table covers every symbol that can reach
  a tape, not merely every symbol a rule names". The plan records which test reddens and whether the
  oracle leg does — and if the leg stays green, that is the finding, not a footnote.

## Deliberately out of scope

- **Stage 3, the two-way → one-way fold.** The remaining stage of the pipeline. Nothing here forecloses
  it: the reduced tape is still two-way infinite and still an ordinary `Tape`.
- **A `.tm` header or checked-in fixture for the reduced machine.** The roadmap's note that the
  self-describing-header slice becomes load-bearing once a family of machine shapes exists is not
  discharged here, exactly as stage 1 did not discharge it.
- **Making the reduction fast.** The cost is the artifact. It is measured, not optimised.
- **The oracle axis product.** One off-diagonal point is added, not a sweep. The roadmap's question of
  whether CI runs every combination stays open, and stays cheap to answer later because the reductions
  are `Machine -> Machine` and compose without a new simulator.
