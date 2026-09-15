# A universal Turing machine — design

> **Roadmap:** Tier 2 of *Machine-model reductions — a PIPELINE*
> (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`), the universal TM. Independent of the state-guard,
> parse-linear and reduced-file branches; it builds on `main`.

## What this delivers

- **One fixed Turing machine**, generated in Rust with `tm::build::Builder`, that runs any guest machine given
  to it as tape contents. Its guests include every machine the TM backend compiles a program to.
- **`encode_guest`**, which lays a guest machine and its initial tapes out as the UTM's initial tapes.
- **`decode_guest`**, which reads the guest's final tapes, and whether it accepted, back out of the UTM's final
  tapes.
- **A new oracle leg:** each corpus program runs directly and through the UTM. Every guest tape must match, and
  then the decoded value must equal the reference interpreter's.

## Decisions, made 2026-09-14

| question | chosen | not chosen, and why |
| --- | --- | --- |
| What does the UTM run? | Lowered machines: the multi-tape machines the TM backend compiles programs to. | **Fully reduced one-tape, two-symbol machines:** the cheapest corpus row, `3 - 5` after stages 1+2, is estimated at 1.92×10^12 UTM steps, 192× over 10^10, and every all-three-stage table alone exceeds `TM_DEFAULT_CAPS.cells`. |
| How is the UTM obtained? | Generated in Rust with `Builder`. | **An `.rxt` interpreter compiled by redextape:** measured, it cannot run any corpus guest. See below. |
| How does it find a rule? | Scan the whole encoded table each guest step and take the first match. | **A scan of the current state's rules only:** estimated about 100× faster on `sum(5)`, but a more complex encoding. It is a later, measured change if the slow tier needs it. |
| What must match? | Every guest tape, aligned at its origin; then the decoded value. | **Tapes only:** the value is covered by other legs. **Value only:** a corrupted tape the value never reads would pass. |
| Is the guest's tape count fixed? | No: it is part of the input. | **Fixed at 5**, which every lowered machine has: simpler to build, but the UTM would then run only one shape of machine. |

## What was measured before designing

### The UTM cannot be an `.rxt` program

A research probe wrote a TM interpreter in the mini-language, over list-encoded rules and tapes, and compiled it
with the TM backend. The runs are in the untracked `utm_rxt_probe` and `utm_rxt_table_ramp` examples in the
scratch worktree `.claude/worktrees/agent-a389527aeb539cd2c`, logged in `scratchpad/utm-design/`:

- **A unary incrementer guest ran.** It lowers to 188,142 states under unary and 198,049 under binary, and every
  run that finished decoded to the reference interpreter's value.
- **Cost per guest step:** 3.4–9.0 million TM steps under unary, 1.0–1.7 million under binary. Unary overflowed
  at 32 guest steps.
- **Rule tables break it.**
  - A 256-element list literal alone lowers to 574,410 states.
  - 512 elements is refused `TooLarge`.
  - At 1,024 and 2,048, lowering is `TooDeep`, and the reference interpreter itself exceeds its evaluation depth
    of 700.
- **The smallest real guest is past every limit.** `3 - 5`'s table is 114 rules × 17 numbers = 1,938 elements.

### What lowered guests are made of

Measured by `utm_guest_survey` on `3 - 5`, `if 2 > 1 { 10 } else { 20 }`, `1 + 2 * 3`,
`cons(1, cons(2, nil))` and `sum(5)`, under unary and binary:

| property | measured |
| --- | --- |
| tapes | 5 in every machine |
| states (unary / binary) | `3 - 5` 60 / 58; `if` 96 / 101; `1 + 2 * 3` 143 / 278; `cons` 146 / 201; `sum(5)` 1,182 / 1,371 |
| rules per state | mean 1.97–2.66; max 3 under unary, 5 under binary |
| symbols, blank included | 3–5 |
| read entries that are wildcards | 74–82%, and every rule has at least one |
| write entries that write nothing | 92–98% |
| does rule order matter? | under unary yes, since some states have overlapping reads; under binary no |
| a wildcard-free table would be | 91–629× the rule count |
| furthest left of cell 0 | 1 cell, on WORK, STACK or HEAP, never REG |
| steps that stay in the same state | 56–90% |

**Consequences:**
- The encoding keeps wildcards and rule order.
- Guest tapes are two-way, with an origin.
- The UTM must tell an accepting guest from a stuck one: every lowered machine has a rule-less, non-accept
  `overflow` state.

### Cost, estimated

The feasibility probe charged one pass over the encoded table per guest step. It measured the guests and the
simulator (126 million steps per second) and estimated the rest:

| program (unary) | guest steps | encoded table, cells | UTM steps (estimate) | wall-clock (estimate) |
| --- | --- | --- | --- | --- |
| `3 - 5` | 253 | 6,733 | 1.71×10^6 | 0.014 s |
| `if 2 > 1 { 10 } else { 20 }` | 638 | 11,537 | 7.41×10^6 | 0.059 s |
| `cons(1, cons(2, nil))` | 422 | 22,566 | 9.54×10^6 | 0.076 s |
| `1 + 2 * 3` | 1,020 | 19,854 | 2.03×10^7 | 0.16 s |
| `sum(5)` | 50,542 | 191,970 | 9.72×10^9 | 77 s |

A whole-table scan with the UTM's own compare-and-return travel may cost a small multiple of this. The plan
measures it on `3 - 5` before trusting any other row.

### Decoding works

`utm_decode_check` rebuilt each lowered run's tapes as `Tape::new(&cells)` from origin-aligned snapshots and
decoded them with `decode_tape`, under each header's encoding. The result equalled `redextape_core::run` in all
10 program × encoding rows.

## Design

### The UTM's tapes

The UTM is one `Machine` with a fixed alphabet and a fixed tape count, the same for every guest.

| UTM tape | holds |
| --- | --- |
| table | a preamble (the guest's tape count, the width of a state id, and the width of a symbol code), the accept list, then every rule in the guest's own order |
| key | the guest's current state id, then the symbol under each guest head |
| guest | every guest tape as one track per tape, with a head marker and an origin marker per track |

- **Rule entries.** Each rule is: its state id, one read code per guest tape, one write code per guest tape, one
  move per guest tape, and its next state id.
- **Symbol codes.** They have a fixed width taken from the preamble, and reserve one code for "wildcard" (in a
  read) and one for "write nothing" (in a write).
- **Delimiters.** Fields are delimited, so the UTM compares them by walking and marking rather than by
  arithmetic.
- **Widths come from the input.** The state-id width, the symbol-code width and the guest tape count are all
  read from the preamble, so nothing about the guest's size is built into the UTM.

### One guest step

1. **Build the key.** Write the current state id, then read each guest track's symbol under its head.
2. **Find the first matching rule.** Walk the table from its start, and take the first rule whose state id
   equals the key's and whose every read code equals the key's symbol or is the wildcard.
3. **Apply it.** For each guest track, write unless the code says "write nothing", then move the head marker.
   Replace the key's state id with the rule's next state id.
4. **Halt when there is nothing to apply.**
   - The UTM checks the accept list first. If the current state is in it, it halts in `guest-accepted`.
   - Otherwise, if no rule matches, it halts in `guest-stuck`.

### API, in `tm/universal.rs`

- **`universal_machine() -> Machine`** builds the fixed UTM. It is built once, and a test pins its state count.
- **`encode_guest(m: &Machine, inits: &[Vec<Symbol>]) -> Option<Vec<Vec<Symbol>>>`** returns the UTM's initial
  tapes. It is `None` when the guest cannot be encoded:
  - too many symbols for any code width the UTM accepts;
  - a tape count beyond the limit this design sets;
  - a guest whose `validate()` is not empty.
- **`decode_guest(tapes: &[Tape]) -> Option<GuestRun>`** gives `GuestRun { accepted: bool, tapes:
  Vec<OriginSnapshot> }`. It is `None` when the UTM's tapes are not well formed.
- **The limits** — the largest tape count and the largest symbol-code width the UTM accepts — are constants in
  the module, named and justified there.

## Testing

### The oracle leg, `tests/universal_oracle.rs`

For each program × encoding:
1. Run the guest directly with `simulate_final`.
2. Run the UTM on `encode_guest`'s tapes.
3. Assert, in this order, so a failure names the first property broken:
   1. The UTM halted, and `decode_guest` reports `accepted`, as the direct run's final state is an accept.
   2. Every guest tape's `OriginSnapshot::trimmed` equals the direct run's.
   3. Decoding those tapes under the header's encoding gives the reference interpreter's value.

**Tiers:**
- **Fast:** `3 - 5`, `if 2 > 1 { 10 } else { 20 }`, `cons(1, cons(2, nil))` and `1 + 2 * 3`, under unary. Binary
  joins them if the plan measures them fast enough.
- **Slow (`#[ignore]`):** `sum(5)` under both encodings.

### Tape counts other than 5

Every corpus guest has 5 tapes, so the corpus alone would never show a UTM that ignores the preamble's tape count.
- **Hand-built guests** with 1, 2 and 3 tapes, each moving every tape at least once and one of them going left of
  cell 0, run through the same three assertions, apart from the value decode.
- **A proptest over small generated acyclic machines** with 1–3 tapes does the same, with its generator's reach
  held on a fixed seed, as `one_way_oracle.rs` holds its own.

### Halting

- A guest that halts in a non-accept state with no matching rule must decode as `accepted: false`, with its tapes.
- A lowered program that overflows its field width must decode the same way.

### Sabotages, run while planning

| sabotage | expected red |
| --- | --- |
| flip one bit of one encoded rule's next state id | a tape comparison, or halting |
| encode the rules of one unary state in reverse order | a tape comparison, for the program where order matters |
| treat the wildcard code as a literal symbol | halting (`guest-stuck`) |
| halt in `guest-accepted` when no rule matches | the halting test |
| read the tape count as one less | the 1–3 tape guests |

If an expected red stays green, it is recorded as a finding.

### A cost table, printed, not asserted

For each fast-tier row, print guest steps, UTM steps, UTM steps per guest step, and encoded table cells, beside
the estimate above.

## Not in scope

- fully reduced one-tape, two-symbol guests
- the state-local lookup
- a CLI command or web support
- a counter machine

## For the plan to measure

- **The UTM:** its state count.
- **Cost:** UTM steps per guest step on `3 - 5`, against the estimate.
- **Cells:** peak cells against `TM_DEFAULT_CAPS.cells`, for every fast-tier row.
- **Tiers:** which binary rows fit the fast tier.
- **Limits:** the tape-count and code-width limits, set from the corpus and the hand-built guests, with their
  justification.
