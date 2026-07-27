# Bounded-exhaustive bank safety — Design Spec (rung 2)

> **Status:** IMPLEMENTED (2026-07-26), and rung 3 with it — the cheap form described under
> "Non-goals" turned out to be worth doing immediately, because this slice MEASURED how big the gap it
> closes is: 50.6% of enumerated programs never terminate, so simulation verifies only a prefix of them.
> Follow-on to
> `docs/superpowers/specs/2026-07-26-per-program-field-width-design.md` (§4, the guard's completeness
> layers).
> **Prerequisite, already on `main`:** layer 3 (`tests/tm_bank_invariant.rs`) — the per-step bank
> skeleton checker — and rung 1, which runs it over generated programs.

## The gap this closes

Layer 3 asserts the right property (the REG/BOX banks stay well-formed at every step) with the right
epistemics (it inspects the actual tape, so it does not depend on my enumeration of write sites, my
boundary reasoning, or rule ordering being correct). Its limitation is quantification: it is an
observation over the programs that ran.

Rung 1 raised the sample from 19 programs to thousands of generated ones. That is a bigger sample, not
a different kind of claim — a random generator explores a space it was written to explore, and the
defects that survive are the ones nobody thought to generate.

Rung 2 changes the kind of claim, for a bounded space:

> **For EVERY asm `Program` of length ≤ N over a fixed small alphabet of instructions, registers and
> literals, and for every field width in a fixed range, no execution corrupts the bank.**

That is a universally quantified statement, verified by enumeration rather than sampling. It rests on
the small-scope hypothesis — that most defects manifest on small inputs — which is an empirical claim
about where bugs live, not a proof. But within its bound it is exhaustive, and unlike rung 3 (a static
head-offset dataflow analysis) **it introduces nothing new to trust**: it reuses layer 3's existing
checker verbatim, and the checker's own correctness is already pinned by its accepting and rejecting
tests.

## Why enumerate the asm IR rather than source programs

Enumerating source text would be enormously wasteful — most strings do not parse, most that parse are
semantically equivalent, and the parser/desugarer sit between the generator and the thing under test.

`asm::Program` is the right level:

- It is the direct input to `lower_tm`, which is what this verifies.
- It is small: 16 `Instr` variants over `Reg::{Rr, Loc(k), Arg(k)}` and a `u64` literal.
- Layer 3's checker consumes exactly a lowered machine plus a width, so no adapter is needed.

The cost is that an enumerated `Program` need not be one `lower_asm` would ever emit. That is a feature
here, not a defect: the gadget library's safety should not depend on the lowerer's habits, and
`lower_tm` is already documented as total and panic-free on ANY `Program` (`MAX_SLOTS`,
`MAX_FRAME_LOC`). This is the test of that claim it currently lacks.

## The enumeration

**Alphabet (the tuning knobs, all constants in one place):**

| dimension | proposed bound | why |
|---|---|---|
| program length | ≤ 3 instructions | the combinatorics; see the sizing below |
| registers | `Rr`, `Loc(0)`, `Loc(1)`, `Arg(0)` | 4 distinct slots exercises seek/rewind across several fields |
| literals | `0, 1, w-1, w, w+1` for the width under test | the boundary values — the strict bound lives exactly here |
| widths | 2, 3, 4, 5 | small enough to be fast, and `w=2` makes overflow the common case |
| labels | one, at index 0 | enough for `Jz`/`Jmp`/`Call` to form a loop |

**Sizing.** With ~4 registers and ~5 literals, the per-position instruction count is roughly:
`Li` 4×5=20, `Mov`/`Head`/`Tail`/`IsEmpty`/`Box`/`BoxGet`/`BoxSet` 7×16=112, `Bin` 9×64=576, `Cons`
64, `Jz` 4, `Nil` 4, plus `Jmp`/`Call`/`Ret`/`Halt` = 4. Call it ~800 per position. Length ≤ 3 is then
~800³ ≈ 5×10⁸ — **too many.** Two reductions, applied in this order:

1. **Restrict `Bin` to one representative per class** (`Add` for arithmetic, `Lt` for comparison, plus
   `Mul` because it alone uses `rd` as scratch and `Sub` because it alone truncates). 9 ops → 4. Per
   position ≈ 400.
2. **Enumerate length ≤ 2 exhaustively (~160,000 programs), and length 3 by random sampling** from the
   same alphabet. Length 2 is where a store-then-read interaction first appears, which is the shape the
   bank invariant is about.

At ~0.5 ms per (program, width) that is ~160,000 × 4 widths × 0.5 ms ≈ 5 minutes — **too slow for the
default suite.** So:

- The exhaustive sweep is `#[ignore]`d and run explicitly (`cargo test -- --ignored --nocapture`) and
  in CI's slow job.
- A **fixed deterministic subset** (every length-1 program, plus a seeded stratified sample of length-2)
  runs by default in a few seconds, so a regression is caught on every commit rather than only in CI.

Both numbers above are estimates from the existing suite's timings, not measurements. **Task 1 of the
plan is to measure the real per-program cost and re-derive these bounds before building anything on
them** — an enumeration that silently truncates would be exactly the "the check verifies less than its
name claims" failure this codebase keeps finding.

## What is checked per enumerated program

For each `(program, width)`:

1. `lower_tm_guarded(&program, &Unary::at(width))`.
2. `simulate_watched` with layer 3's existing `reg_bank_is_well_formed` (and the BOX checker from
   `tm_width_equivalence.rs`) as the watcher, under a small step cap.
3. Assert no violation, and assert the run reached a defined outcome (`Halted` or `HitCap`) rather than
   panicking.

Three properties come free from the same sweep and should be asserted, because they are the other
things `lower_tm` claims for arbitrary `Program`s and never tests exhaustively:

- **Totality.** No panic, no abort, on any enumerated program at any width.
- **`Machine::validate()` is empty** for every lowered machine.
- **Text round-trip.** `parse_tm(print_tm(m)) == (Some(m), [])`, currently checked on a handful of
  compiled machines.

## Non-goals

- **Semantic correctness of enumerated programs.** Most are meaningless; the claim is only that they
  cannot corrupt the bank or crash the lowerer. Checking values would need a reference for arbitrary
  asm, which is `run_asm` — a worthwhile but separate differential (`run_asm == TM` over the same
  enumeration) that should be its own slice.
- **Rung 3.** ~~Not attempted here~~ — DONE in the same slice (`tests/tm_static_delimiter_safety.rs`),
  because this sweep produced the number that justified it. The assessment of it changed twice and both corrections are
  recorded because they bear on whether this slice is the right next step.

  First, the framing "a proof for all inputs" was WRONG. The TM is a closed program — `init_reg` is an
  all-zero bank and every other tape starts empty — so each `(program, width)` pair has exactly ONE
  execution. Running it already verifies it completely. Rung 3's real value is narrower: it covers
  executions that are CAPPED or non-terminating (layer 3 only checks steps that actually ran, so a
  program stopping at the step cap leaves its tail unverified), and it is cheap enough to apply to
  every machine ever lowered rather than only the ones simulated.

  Second, a much cheaper rung 3 exists than the dataflow analysis originally sketched. The syntactic
  check fails today only because `write_literal`'s unrolled chain and the two BOX chains write with a
  WILDCARD read (`on(REG, None, Some(MARK), R)`). Those windows are known to contain only marks and
  blanks, so each such rule can read EXPLICITLY instead — one wildcard arm split into a MARK arm and a
  BLANK arm. Same number of steps (so the goldens are untouched), a few more rules, and the check then
  passes by construction: no rule can write a non-`#` symbol while the head is on a `#`, verified
  per-rule in O(rules) on every machine, with nothing new to trust.

  That would prove the DELIMITER half of the bank skeleton for all executions. The LENGTH half (the
  head walking off the end of the bank and extending the tape) is not covered by it and would still
  rest on this slice. The two are complementary, and rung 3 is the cheaper of the pair — but it is
  strictly weaker on its own, which is why this slice goes first.
- **Raising the ceiling or changing any gadget.** Verification only. If the sweep finds a defect, fixing
  it is a separate slice with its own regression test.

## Success criteria

1. The exhaustive length-≤2 sweep passes at widths 2–5, or reports a defect with a minimal reproducing
   `Program`.
2. The fast default subset runs in under 5 seconds and is sabotage-verified: removing any one of the
   four overflow guards turns it red.
3. The bounds (alphabet, length, widths) are stated as named constants with the measured cost that
   justifies them, so a later reader can see what was and was not covered — and `log`/print what the
   sweep skipped, rather than letting a truncation read as coverage.
