# Counter machines — design

> **Roadmap:** Tier 2 of *Machine-model reductions — a PIPELINE*
> (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`), the two-counter (Minsky) machine bullet, whose
> caveat reads "realistically demonstrable only on trivial programs". This design measures that caveat and
> builds what the measurements allow. It is independent of the other open branches and builds on `main`.

## What this delivers

1. **A counter-machine model** in `redextape-core`: programs over counters, made of literal `Inc`, `Dec` and
   `Stop` instructions and macros, each with a fixed literal expansion — one macro per head move.
2. **A compiler** from a stage 1 image (`to_single_tape`'s one-tape machine) to a 3-counter program.
3. **An accelerated simulator** that executes each move as arithmetic on the counters' values, in an in-tree
   bignum, and keeps the exact literal step count beside the counters. **It computes those steps; it does not take them**, and every report and doc comment
   says so.
4. **A literal simulator,** and a compiler from 3-counter programs to 2-counter programs by Gödel numbering,
   run literally, on hand-built toy machines only.
5. **A readback** from the counters to the stage 1 tape, and through `deinterleave` to a value, with an oracle leg
   built on it.

## Decisions, made 2026-09-14

| question | chosen | not chosen, and why |
| --- | --- | --- |
| What to build | Compiled programs as accelerated 3-counter machines, plus a literal 2-counter step on toys. | **Toy 2-counter only:** it runs no compiled program. **Defer:** the construction would exist only on paper. |
| Which machine the route starts from | The stage 1 image. | **The lowered machine:** its 5 tapes are 10 stacks, so 11 counters, and packing them into the 3 this design targets needs a Gödel number of 10^12.64 bits (506.7 GiB) for `3 - 5`. **Stages 1+2:** it runs more macros than stage 1 does, about 5.6× as many for both `3 - 5` and `if`. |
| Where the simulator lives, and its bignum | In `redextape-core`, on an in-tree bignum, `counter/nat.rs`, that divides by the program's base through a precomputed reciprocal. Chosen on 2026-09-14, reversing `num-bigint`: the merged `Move` on `num-bigint` ran `sum(5)` at stage 1 in 146.9 s, with dividing by `b` at 55% of `let x = 40; x + 2`'s profile, because `num-bigint` spends a hardware `div` on every limb. | **`num-bigint`:** its division by a small number is a hardware `div` per limb. **Outside the core library:** the CLI and web could never run it. |
| How an accelerated run holds a counter | As `hi·b^j + lo`: `lo` a `u64` holding the counter's `j` lowest base-`b` digits, `j` at most the largest `k` with `b^k` in a `u64`, and `hi` a bignum touched only when `lo` fills or empties. The step tally is deferred to match. Chosen on 2026-09-14, after the in-tree bignum, with reciprocal division and a lazily carried step count, still ran `sum(5)` in 110.2 s: every move still passed over every limb of two counters. Buffered, it ran in 11.9 s. | **A plain bignum per counter:** a pass over every limb of two counters on every move. |
| One macro per head move, or three | **Merge macro sequences:** each head move is one `Move` macro whose literal expansion is exactly the transfer, add and divide sequence it replaced. Chosen on 2026-09-14, after the first build of the plan, executing `Transfer`, `Add` and `DivMod` as separate macros, ran `let x = 40; x + 2` at stage 1 in 35.3 s and stopped `sum(5)` at a 400,000,000-macro cap after 103.4 s. | **Three macros, as first designed:** about 4.5 macros per head move — 1,162,185 for `3 - 5`'s 256,351 moves. |

## What was measured before designing

A prototype, `counter_accel_probe.rs`, is untracked in the scratch worktree
`.claude/worktrees/agent-a2a739466c9221403`, with its output in `scratchpad/counter-design/run2.txt`. It ran
under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`, in `--release`.

### Accelerated 3-counter runs

| program | start | macros executed | largest counter, bits | literal steps (exact, computed) | wall |
| --- | --- | --- | --- | --- | --- |
| `3 - 5` | lowered, 11 counters | 1,034 | 42 | 10^14.02 | under 1 ms |
| `3 - 5` | stage 1 | 1,162,185 | 1,253 | 10^380.32 | 0.062 s |
| `3 - 5` | stages 1+2 | 6,540,075 | 1,285 | 10^390.78 | 0.603 s, with Gödel tracking on |
| `if 2 > 1 { 10 } else { 20 }` | lowered, 11 counters | 2,548 | 107 | 10^33.70 | under 1 ms |
| `if 2 > 1 { 10 } else { 20 }` | stage 1 | 6,757,306 | 2,855 | 10^862.94 | 0.601 s |
| `if 2 > 1 { 10 } else { 20 }` | stages 1+2 | 37,684,495 | 2,925 | 10^884.89 | 4.912 s, with Gödel tracking on |

**Every run matched the TM simulator:** the same final tapes, the same final state, and a zero scratch counter.
The two stage 1 walls were measured with Gödel tracking off and the exact step count still kept.

### Accelerated and literal execution agree

- **On the lowered `1 + 1` program,** the literal 3-counter run took 206,024,328 steps.
- **At every one of its 570 macro entries,** its (macro, steps so far) pairs equalled the accelerated run's, and so
  did its final counters and its stop.
- **The prototype checked the same agreement on its hand-built toy machines at n = 0..8,** a unary incrementer
  among them.

### Literal 2-counter runs on toys

Each is a real Gödel-compiled program, and each agreed with its 3-counter run.

| toy | n | program | literal steps | wall |
| --- | --- | --- | --- | --- |
| unary incrementer | 4 | 131 instructions | 2,974,863 | under 0.01 s |
| parity eraser | 5 | 252 instructions | 220,027,664 | 0.34 s |
| binary incrementer | 3 | 675 instructions | 2,530,013,456 | 3.90 s |

The literal 2-counter simulator ran at about 6.5×10^8 steps per second.

### The dependency

**No dependency is added.** The counters' arithmetic is in the tree, in `counter/nat.rs`, and no `Cargo.toml` or
`Cargo.lock` changes.

## Design

### Where it lives

- **The module root is `crates/redextape-core/src/counter.rs`**, beside `tm.rs`, `lambda/` and `trace/`, with
  its parts in `src/counter/`.
- **File names match no tracked file,** because `scripts/check-attributions.sh` resolves citations by bare
  filename. `tm/` already has `sim.rs`, `machine.rs` and `decode.rs`, and `tests/common/mod.rs` exists. These
  names were checked free: `counter.rs`, `program.rs`, `compile.rs`, `accel.rs`, `godel.rs`, `readback.rs`, `nat.rs`.

### The program — `counter/program.rs`

- **Counters** are numbered; a program is a list of instructions, addressed by index.
- **Literal instructions:**
  - `Inc { c, next }`
  - `Dec { c, nonzero, zero }` — decrement if non-zero, and branch on which
  - `Stop` — halt
- **One base per program.** A compiled program's base `b` is its Turing machine's alphabet size, stated once on
  the program, not on each move.
- **Macros**, each with one fixed literal expansion and an exact step count, for `P` the value of the counter a
  move pushes onto and `Q` the value of the counter it pops:

  | macro | effect | literal steps |
  | --- | --- | --- |
  | `Move { push, pop, s, exits }` | `push = b·P + s`, `pop = ⌊Q / b⌋`, then go to `exits[Q mod b]` | (b+3)·P + s + Q + 3·⌊Q/b⌋ + 4 |
  | `Stop { state, head }` | halt, recording the TM state and the digit under each head | 0 |
  | `Spin` | run forever | never ends |

- **A `Move`'s expansion is five loops** over the scratch counter: copy `push` into scratch (2P + 1 steps), copy
  it back multiplied by `b` ((b+1)·P + 1), add the digit (s), divide `pop` by `b` into scratch
  (Q + ⌊Q/b⌋ + 1), and copy the quotient back through the exit its remainder names (2·⌊Q/b⌋ + 1). That is
  4·b + 4 + s instructions.
- **`Spin`** marks a cycle of stay rules: the TM never moves again, so the program never stops.
- **Macros are emitted, not recognised.** The compiler writes macros directly, and each has exactly one literal
  expansion, so acceleration never has to pattern-match code.

### The compiler — `counter/compile.rs`

- **Its input is a stage 1 image,** the `Machine` `to_single_tape` returns, with the interleaved initial tape.
- **Its tape model:**
  - the cells left of the head are a base-b number on a left counter, nearest cell least significant;
  - the head cell and the cells right of it are a base-b number on a right counter;
  - a third counter is scratch;
  - `b` is the image's alphabet size, and `BLANK` is digit 0.
- **The head digit lives in the control label** — the TM state and the digit under the head — so a label reads
  no counter.
- **Moves.** A move right is one `Move` that pushes the written digit onto the left counter and pops the right
  counter's least digit into the control. A move left mirrors it.
- **Stays.** A stay compiles to no instructions, and a cycle of stays becomes `Spin`.
- **It works from a worklist over reachable labels.**
- **The origin.** A stage 1 image never steps left of cell 0: `one_way_oracle.rs`'s
  `stages_one_and_two_never_step_left_of_cell_zero` holds that on its corpus, and `single_tape.rs`'s sentinel
  makes it so by construction. So the left counter's most significant digit is cell 0, and readback needs no
  position counter.

### The simulators — `counter/accel.rs`

- **Counters and the literal step count are `counter/nat.rs`'s `Nat`:** 64-bit limbs, least significant first,
  multiplied and added in place, and divided by a fixed divisor through its reciprocal (Möller and Granlund's
  2-by-1 division), so no limb costs a hardware `div`.
- **Accelerated mode** holds a counter as `hi·b^j + lo`. A push or a pop is arithmetic on the `u64` `lo`; a full
  `lo` is flushed into `hi` and an empty one refilled from it, dividing by `b^k`.
- **The step tally is deferred.** A move's steps are `(b+3)·(P + ⌊Q/b⌋) + (Q mod b) + s + 4`, and `P` and
  `⌊Q/b⌋` are two counter values. Each value's `lo` is added to a `u128` at once, and its `b^j` to a per-counter
  weight; `hi·weight` joins the tally only when `hi` is about to change or a total is read.
- **Literal mode** expands every macro and runs each instruction.
- **Both modes can emit the (macro, steps so far) trace** at macro entries, which the agreement test compares.
- **Caps:** instructions executed, and counter bit length. A run that hits a cap reports it, never a value.

### The 2-counter compiler — `counter/godel.rs`

- **It compiles a literal-only 3-counter program** — every macro expanded first — **to a 2-counter program.**
  Counter A holds `2^x · 3^y · 5^z`, and counter B is scratch.
- **Each instruction becomes a loop:** `Inc` multiplies A by that counter's prime, and `Dec` and its zero test
  divide by it, with the remainder deciding the branch.
- **It runs literally, on toys only.** No compiled program's Gödel number can be stored: `3 - 5` after stage 1
  would need about 10^377 bits.

### Readback — `counter/readback.rs`

1. **Counters to tape:** the counters and the stopping label give the stage 1 tape, as base-b digits mapped
   back to symbols.
2. **Tape to tapes:** `deinterleave(tape, k)` gives the lowered tapes.
3. **Tapes to value:** `decode_tape_ty` gives the value.

## Testing

### The oracle leg — `tests/counter_oracle.rs`

For each corpus program under unary, compiled from its stage 1 image, run in accelerated mode:
1. The stop's TM state equals `simulate_final`'s final state on the stage 1 image.
2. The read-back stage 1 tape equals the simulator's final tape, both under `normalize`.
3. `deinterleave`, then `decode_tape_ty`, gives the reference interpreter's value.

**Tiers.** A test is fast when it ran in under 1 s in the debug build `cargo nextest` runs, timed on its own;
every slow-tier (`#[ignore]`) test ran in under 60 s in the release build `scripts/check-slow.sh` runs. The
accelerated runs, release, under the 8G cap, starting at a load average of 27.8:

| program | moves | accelerated run | tier |
| --- | --- | --- | --- |
| `3 - 5` | 256,351 | 0.004 s | fast |
| `cons(1, cons(2, nil))` | 396,441 | 0.007 s | fast |
| `if 2 > 1 { 10 } else { 20 }` | 1,497,261 | 0.034 s | fast: its test took 0.58–0.60 s in debug |
| `1 + 2 * 3` | 1,603,003 | 0.030 s | fast: 0.68–0.69 s in debug |
| `pair_sum(1, add1(2))` | 6,747,237 | 0.145 s | slow: 3.1–3.2 s in debug |
| `let x = 40; x + 2` | 22,495,905 | 1.171 s | slow |
| `sum(5)` | 303,419,137 | 11.861 s | slow |

The literal-against-accelerated test on the lowered `1` took 0.003 s in debug and is fast; on the lowered `1 + 1`,
2.3 s, and it is slow.

### Accelerated equals literal

- **Where:** on hand-built toys at n = 0..8 (0..6 for the binary incrementer), and on the lowered machines of `1`
  and `1 + 1`, compiled to 11 counters.
- **What must be equal:** the (macro, steps so far) trace at every macro entry, the final counters, and the stop.
- **For `Move`:** a proptest over small `P`, `Q`, `b` and `s`, in both directions, asserts that its literal
  expansion takes exactly its formula's steps, leaves by the exit its formula names, and leaves the same counters.
- **For the buffered counters and the deferred tally:** a proptest drives them through hundreds of moves, over
  bases whose digit buffer holds 1, 4, 16 or 40 digits, and requires the values plain arithmetic gives and the
  formula summed move by move.

### The bignum

- **Against `u128`:** a proptest requires `Nat`'s addition, multiplication-and-add, division with remainder and
  bit length to equal `u128` arithmetic wherever the result fits.
- **Identities on numbers of up to 40 limbs:** `q·b + r == n` with `r < b`, and `(n·b + s) / b == n` with
  remainder `s`, for bases including 1, every power of two and `u64::MAX`.

### The 2-counter toys, literal

- **The runs:** the unary incrementer and the parity eraser at n ≤ 4 in the fast tier; the parity eraser at n = 5,
  1.9 s in debug, and the binary incrementer at n = 3 in the slow tier.
- **The checks:** each Gödel run's decoded counters equal its 3-counter run's, and its read-back tape equals the TM
  simulator's.

### The wasm gate

The wasm rows of `scripts/check-all.sh` stay green on the finished code.

### Sabotages, run while planning

| sabotage | expected red |
| --- | --- |
| `Move`'s step formula returns one step too many | the `Move` proptest, and accelerated equals literal |
| `Move`'s step formula charges `(b+2)·P` for copying `push` | the `Move` proptest, and accelerated equals literal |
| the reciprocal division skips its final correction | the bignum's tests against `u128` and its identities |
| the deferred tally skips folding a counter's `hi` before a refill changes it | the buffered-counter proptest, and accelerated equals literal |
| the compiler uses base `b - 1` | the oracle leg's tape comparison |
| one `Inc` in the 2-counter compiler multiplies by 5 instead of 3 | a 2-counter toy |
| a stay cycle compiles to no instructions instead of `Spin` | a test running a machine that spins |

If an expected red stays green, it is recorded as a finding.

## Not in scope

- 2-counter execution of compiled programs
- the 11-counter route from lowered machines
- starting from stages 1+2
- a CLI command or web support
- the universal Turing machine

## For the plan to measure

- **Corpus timings:** accelerated wall time, macros executed and largest counter for every corpus program at stage
  1, and so which join the fast tier.
- **Tiers:** the literal 2-counter toys' runtimes on this machine, against the tiers above.
- **The wasm check,** on the real module.
- **Spin:** a small TM whose stay rules cycle, to give `Spin` a test.
