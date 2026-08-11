# The count nobody bounds — one gap, two hats, and an OOM reachable from the editor

**Status:** design. Two deliverables that share nothing but the review that found them: a missing
clippy row in `scripts/check-all.sh` (§1), and a bound gap that two agents found from opposite
directions (§2 onward).

**The headline correction is in §3.** The gap was filed as "not a live defect — a cast that cannot
truncate in practice". It is a live defect. A balanced arithmetic expression of about 6 KB, well
inside every existing guard, builds an 8.6 million state machine costing 6.0 GB; at 24 KB it
SIGKILLs an 8 GB budget. Both are ordinary programs a user can type into the editor.

---

## §1 The serde clippy row

`scripts/check-all.sh`'s LEG table builds and tests `redextape-core --features serde`, and checks it
compiles for `wasm32`, but never lints it:

```
  "base|test|-p redextape-core --features serde"
  "base|wasm|-p redextape-core --lib --features serde"
```

Benign today only because every serde site in `redextape-core` is a `derive`, and derive expansions
are not linted. The first hand-written `#[cfg(feature = "serde")]` function would land unlinted, and
the gate would stay green while covering less than its name claims — the defect this file's own
header is about.

**Fix:** one row, above the matching test row, with the `--all-targets` every other clippy row uses:

```
  "base|clippy|-p redextape-core --features serde --all-targets"
```

`check_legs()` already validates the tier and kind, so nothing else changes. This is independent of
everything below and is listed first only because it is finishable in a minute.

---

## §2 The gap, and why it wore two hats

Four sites narrow a count, and each justifies itself in prose rather than against a check:

| site | cast | justification as written |
| --- | --- | --- |
| `tm/build.rs:167` `state()` | `states.len() as StateId` | "~172 GB resident before this is reachable" |
| `tm/build.rs:177` `accept()` | same | "bounded the same way `state` is" |
| `sourcemap.rs:178` | `state as StateId` | the *same* 172 GB argument, written out a second time |
| `viewmodel.rs:588` | `NodeId -> i32` | cites `NodeGen::fresh` by name; refuses the cast |

Two agents reached this from opposite ends — one from `viewmodel.rs`/`core.rs` (the **node count**),
one from `tm/build.rs`/`sourcemap.rs` (**`Program::code.len()`**). It is one gap because the crate
**bounds source size at the front door (`MAX_TOKENS`) and bounds recursion depth in five places, but
bounds no intermediate count.** Every narrowing cast downstream therefore re-derives a RAM argument
independently, in prose, and the third row above is that prose already having been copied once.

`lower_tm_all`'s own doc says it plainly: none of its three guards constrains `prog.code.len()`.

---

## §3 The measurement, and the correction it forced

Measured with a probe kept as `crates/redextape-core/examples/state_cost_probe.rs`, alongside the
eight existing `*_probe.rs` examples. Native, release, `MemoryMax=8G` with swap off.

### 3.1 Bytes per state — 727, not 56

`size_of::<State>()` is 56 bytes and **understates the real cost 13×**: `State` carries a heap
`String` name and a `Vec<Rule>`. RSS delta around `lower_tm`:

| tokens | `code.len()` | states | RSS delta | bytes/state |
| --- | --- | --- | --- | --- |
| 1,022 | 512 | 575,861 | 398.1 MB | **725** |
| 4,094 | 2,048 | 8,595,317 | 5,959.3 MB | **727** |

Stable across a 15× size change, so 727 B/state is the figure every number below is priced at.

### 3.2 `code.len()` from source is bounded — by the wrong guard, and only for some shapes

Bisected, three generators:

| shape | max n | tokens | `code.len()` | what refused it |
| --- | --- | --- | --- | --- |
| 578 sibling `fn`s | 578 | 5,785 | 3,472 | `MAX_LOWER_DEPTH` |
| nested `let`s | 577 | 4,050 | 1,736 | `MAX_LOWER_DEPTH` |
| `1 + 1 + 1 …` chain | 579 | 1,160 | 1,160 | `MAX_LOWER_DEPTH` |

All three refuse at n≈578-580. That is `lower_asm`'s `MAX_LOWER_DEPTH = 580` — a guard aimed at the
native stack — not `MAX_TOKENS`. Width costs depth in this lowering, so `code.len()` is bounded
**incidentally**, by something that was not trying to bound it.

**What that ceiling costs in states, for the row above** — measured before `MAX_MACHINE_STATES`
existed (`state_cost_probe.rs`'s section D reports `REFUSED` for this row now that the ceiling is
live, since 2.8M exceeds it): the `bin_chain` generator at its bisected maximum, n=579, is the source
of the "2.8M states" figure quoted from section D's header line elsewhere in this document and in
that file's own summary table.

| generator | n | `code.len()` | unary states | binary states | unary rules |
| --- | --- | --- | --- | --- | --- |
| `bin_chain` | 579 | 1,160 | 2,702,203 | 2,808,221 | 8,085,748 |

**And the incidental bound does not hold for every shape.** A *balanced* expression tree is
depth-log, so `MAX_LOWER_DEPTH` never fires and the whole token budget goes into instructions:

| tokens | `code.len()` | slots | binary states | cost at 727 B |
| --- | --- | --- | --- | --- |
| 254 | 128 | 127 | 45,557 | 33 MB |
| 1,022 | 512 | 511 | 575,861 | 398 MB |
| 4,094 | 2,048 | 2,047 | 8,595,317 | **6.0 GB** |
| 16,382 | 8,192 | 8,191 | — | **SIGKILL (exit 137) at 8 GB** |

Growth is about O(`code.len()`^1.9): per-instruction cost scales with slot count, and slots scale
with instructions, so the two multiply.

### 3.3 The correction

**This is not a latent cast hazard. It is a live OOM reachable from the editor.**

- 4,094 tokens is **6,139 bytes**, about 6 KB of source, against a `MAX_TOKENS` of 100,000. (Tokens
  and bytes are not interchangeable and an earlier draft of this document treated them as such — and
  misattributed the rate besides: `balanced(0, 1024)` is 6,139 bytes over 4,094 tokens, **1.50 bytes
  per token**, and over 1,024 leaves, **6.00 bytes per leaf** (`1`, ` + `, and a paren pair, one per
  leaf). The 6-byte figure is the LEAF rate, not the token rate — applying it to a token count, as an
  earlier draft did, overstates the 16,382-token row to ~98 KB. At the correct **1.50 bytes per
  token**, that row is ~24 KB, not 16 KB.)
- `run_tm_described` is on the wasm session's compile path (`session.rs`'s `compile_with_caps`).
- In wasm32 a 6.0 GB allocation is not a slow tab, it is a dead module.
- The cast the two agents found cannot truncate, because the process dies at about 0.2% of the way
  to `StateId::MAX`. **The cast was the symptom. The unbounded product is the defect.**

The three existing guards bound the *multipliers* (`MAX_SLOTS` the register footprint,
`MAX_FRAME_LOC` the frame bank, `MAX_MUL_INSTRS` the `Mul` count) and nothing bounds the *base*, so
their product is unbounded.

### 3.3b The ceiling is width-dependent, and the other three refusals are not

Measured during Task 3's re-review, after the doc claiming otherwise was found. It matters because
`run_tm_fitted` searches widths, and a refusal that can first appear at a *later* width behaves
differently from one that cannot.

`MAX_SLOTS`, `MAX_FRAME_LOC` and `MAX_MUL_INSTRS` are properties of the `Program` alone, so they
refuse identically at every width. `MAX_MACHINE_STATES` bounds the *machine*, and under `Binary` a
gadget's state count scales with the field width:

| program | width 4 | 8 | 16 | 32 | 64 |
| --- | --- | --- | --- | --- | --- |
| `1 + 2 * 3`, `Binary` | 278 | 536 | 1,196 | 3,092 | 9,188 |
| `1 + 2 * 3`, `Unary` | 143 | 143 | 143 | 143 | 143 |

**`Unary` is width-independent; `Binary` is not.** So the phenomenon is a `Binary` one.

The straddling witness — `300` then 32×`* 2` then 194×`+ 1`, 454 asm instructions, under `Binary`:

| width | states | outcome |
| --- | --- | --- |
| 4 | 537,996 | laid out, ran, `Overflow` |
| 8 | 692,772 | laid out, ran, `Overflow` |
| 16 | — | **refused** |

`run_tm_fitted` returns `(TooLarge, None)` — the refusal surfaced at the **third** width tried. A
program can therefore lay out fine at `MIN_FIELD_WIDTH`, overflow its fields, and exceed the ceiling
only once widened. Retrying wider still is pointless either way, since a refused machine only grows,
so the loop returns on the first refusal at whatever width reached it.

### 3.4 What legitimate actually costs

The programs this project ships as demos (`FIRST_ORDER_DEMOS`, `native_oracle.rs:244`, 46 entries).
`state_cost_probe.rs`'s section G hand-copies the whole array — `redextape-core` cannot depend on
`redextape-native`, the dependency runs the other way — and is the authority for this table. That copy
is one of `tests/three_way_oracle.rs`'s `first_order_demos_stay_synced_across_all_seven_copies` rows,
so it cannot silently drift out of sync with the source array (a text-based check, not an import — the
dependency direction explains why it's a copy, not why the copy could go stale). This TABLE is still a
manual snapshot, though: re-run the probe and update the table by hand if `FIRST_ORDER_DEMOS` gains an
entry. Top six by cost:

| program | tokens | binary states |
| --- | --- | --- |
| `map` + `add1` + `ap2`, `map` called by name and used as a value | 97 | **49,135** |
| `map` + `fold` + `add` + `add1` | 123 | 38,070 |
| shared dispatcher over `b`/`v`, `b` declared first | 52 | 37,470 |
| shared dispatcher over `b`/`v`, `v` declared first | 52 | 35,912 |
| `tail` shadowing the builtin, plus a closure capture | 52 | 32,812 |
| curried `ap` over a two-argument lambda | 38 | 28,057 |

**Worst shipped demo: 49,135 states, 35.7 MB.** Real programs sit four orders of magnitude below
where the lowering falls apart.

**That worst demo is 97 tokens, so roughly 500 states per token (49,135 / 97).** At that rate —
order-of-magnitude only, since states per token varies with program shape — the 1,000,000-state
ceiling is reached at around 2,000 tokens of demo-style code, a few hundred lines, against a
`MAX_TOKENS` front door of 100,000. **That is the ~50x gap between what the parser accepts and what
this backend can lay out**, and it is the number a reader needs in order to judge "never rejects a
legitimate program": `MAX_TOKENS` alone cannot show it, because tokens are not what costs memory —
states are (§3.1-3.2).

**This table previously topped out at 38,070**, from a hand-picked 10-entry subset of
`FIRST_ORDER_DEMOS` that section G's header claimed — wrongly — were "the largest members" of the
array. They were not: the array has 46 entries and several of the omitted ones exceed 38,070, the
largest by 29%. Corrected 2026-08-11, verified by lowering every entry in the array rather than a
hand-picked subset.

### 3.5 Largest `NodeId` from source

| shape | tokens | max `NodeId` |
| --- | --- | --- |
| `1 + 1 + …` chain | 80,002 | **80,000** |
| nested `let`s | 70,011 | 40,004 |
| 5,000 sibling `fn`s | 50,005 | 25,002 |

`desugar` has no depth guard of its own, so `MAX_TOKENS` is what bounds this: roughly one `NodeId`
per token, about 100,000 at the ceiling.

---

## §4 The design

### 4.1 `MAX_MACHINE_STATES: usize = 1_000_000` — a ceiling inside `Builder`

**Why a ceiling and not a fourth `code.len()` guard.** A bare `MAX_CODE_LEN` cannot meet this
project's standard for a `MAX_*` — bound the resource *and* never reject a legitimate program —
because the per-instruction cost is not a constant. It ranges from 1 state (`Halt`, `Jmp`) to 571
(`Box`, binary) for straight-line code, and for `Call` it scales with the local bank: 973 states per
call site at `n_loc = 4`, 34,577 at `n_loc = 128` (log-log slope 1.03). At the largest `n_loc` the
frame guard permits, about 270,000 states per call site — **196 MB for a single `Call`**, at 727 B a
state. So the length that bounds the allocation is single digits, which rejects everything real, and
the length that admits real programs (say `MAX_TOKENS`' own 100,000) bounds nothing at all.

**Why not an estimate.** A `state_count_unrepresentable(prog, sm, enc)` that predicts the cost up
front would be symmetric with the other three guards and would refuse before allocating. It would
also duplicate per-gadget cost knowledge in a second place, which goes stale silently the first time
a gadget changes — the same failure mode as the prose being removed.

**`Builder::state`/`accept` is the single choke point every state goes through**, so a ceiling there
is exact rather than predicted, and cannot go stale.

```rust
pub const MAX_MACHINE_STATES: usize = 1_000_000;
```

- **20×** the worst shipped demo (49,135).
- **727 MB** at the ceiling, measured.
- **4,295×** below `StateId::MAX`, so `states.len() as StateId` is provable with three orders of
  magnitude to spare, one line above the cast.
- Accepts the 1,022-token balanced tree (575,861 states, 398 MB) which works today; refuses the
  4,094-token one (6.0 GB) which does not. **It admits every size measured to work and refuses the
  first size measured not to.**

`Builder` gains `overflowed: bool`. `state()`/`accept()` stop pushing at the ceiling, set the flag,
and return state 0. State 0 is necessarily in range at that point: the ceiling is positive, so a
million states already exist before it can trip. (It happens to be `halt` under `lower_tm_all`,
which allocates it first, but the in-range guarantee does not depend on that — it holds for ANY
`Builder`, because the very first `state()`/`accept()` call on a fresh one always succeeds (the
ceiling being positive means `states.len() == 0` can never already be at it), and once claimed,
index 0 stays valid for that `Builder`'s whole life. `encoding.rs`'s gadgets do not build their own
`Builder`s — every gadget takes `&mut Builder` from its caller — but their `#[cfg(test)]` modules do,
to exercise a gadget in isolation, and the same guarantee holds there too.)
`lower_tm_all` checks the flag once per iteration of the per-instruction layout loop and bails to
its existing degenerate-halt return, so a tripped ceiling stops work promptly instead of grinding
through the remaining instructions attaching rules to a sentinel.

`tm/build.rs:153-166` and `sourcemap.rs:168-176` then **delete the 172 GB prose** and cite the
ceiling. That is the duplicated-argument half of the gap closed.

### 4.2 Plumbing the refusal — `lower_tm_guarded -> Option`

`lower_and_size` (`tm.rs:156`) is documented as *"the single place `run_tm_fitted`/`run_tm_at` decide
'is this program representable at all'"* and pre-checks all three guards **before** `lower_tm` runs.

A states ceiling cannot be pre-checked — that is the whole point of §4.1. If the refusal does not
travel out, `attempt` simulates the degenerate machine, sees `Halted` at a state that is not the
overflow guard, and reports `TmRun::Ran { tapes }` over tapes that decode to nothing. That is
**exactly** the bug `lower_and_size`'s doc says it fixed for `MAX_SLOTS` and `MAX_FRAME_LOC`.

```rust
pub fn lower_tm_guarded(prog: &Program, enc: &dyn Encoding) -> Option<(Machine, StateId)>
```

`None` means refused. `attempt` maps it to `TmRun::TooLarge`, which is already wired through
`TmDecline::TooLarge` (`session.rs:401`) to the user-visible *"the machine this program needs is too
large to build"* (`session.rs:582`). **The whole refusal path already exists**; this adds a fourth
condition to it.

`Option` rather than a third tuple element or a bare bool: a `bool` in a tuple is the easiest thing
in this design to ignore, and ignoring it is the `Ran`-over-empty-tapes bug above.

`lower_and_size`'s doc must stop claiming to be the single place. It pre-checks three of four; the
fourth is reported by the lowering, because it can only be known after laying out.

**Rejected: a named refusal enum** (`Slots` / `FrameBank` / `MulCount` / `States`) plumbed out of
`lower_tm_all`. More informative, and it would let the three pre-checks collapse into the lowering
and remove the duplicated guard logic. Not taken here because folding the pre-checks in means
`MAX_SLOTS` no longer refuses *before* `init_reg`'s huge allocation, which `lower_and_size`'s doc
calls out as a reason it checks early. Worth revisiting as its own slice.

### 4.3 `MAX_NODE_ID: NodeId = 1_000_000_000` — capping issuance at the source

`NodeGen::fresh` is a bare counter; `self.next += 1` wraps silently in release (no `[profile]`
overrides in this workspace, so no debug assertion fires), re-issuing id 0 to whatever mints next.
`seeded` is `pub`, so `seeded(u32::MAX)` plus one `fresh()` reaches the wrap from outside the module.

`panic`, `expect` and `unwrap` are denied in library code (`clippy.toml` + `[workspace.lints]`), and
`fresh()` returns `NodeId` with no error channel, so the fix cannot be a panic and a fallible
`fresh()` would ripple through ~15 call sites and `desugar`'s own return type, which cannot express
refusal.

```rust
pub const MAX_NODE_ID: NodeId = 1_000_000_000;
```

- `seeded` clamps its argument to `MAX_NODE_ID`.
- `fresh` saturates at `MAX_NODE_ID` instead of wrapping, and sets an `exhausted` flag.
- `NodeGen::exhausted()` exposes it.

**The point of the specific value is `i32`.** `MAX_NODE_ID < i32::MAX` (2,147,483,647), so
`LinkIndex::build`'s `i32::try_from(n)` **provably succeeds**. That is precisely what `core.rs:203-208`
said capping at the source would buy: "Capping issuance here would close the gap at the source
instead of at every cast site." It is 12,500× the largest `NodeId` measured from source (80,000),
and no memory argument justifies a tighter number — a `Core` tree of 10⁹ nodes is impossible at ≥40
bytes per node.

Saturation still yields duplicate ids at the ceiling. That is worse than nothing and better than a
wrap: one known repeated id at a documented ceiling, rather than a silent restart at 0 that collides
with every early node in the tree.

**`viewmodel.rs`'s `tm_owner` doc must be corrected, not deleted.** Its premise — "nothing bounds how
many a `Core` tree can mint (`core::NodeGen::fresh` is a bare counter)" — becomes false. The
`i32::try_from` refusal stays as defence in depth, documented as provably unreachable rather than as
guarding a live hazard, and the recorded reasoning for why `-1` must not be the fallback stays as
written.

---

## §5 Testing

| what | where | tier |
| --- | --- | --- |
| a `Program` that trips the ceiling lowers to the degenerate machine — total, no panic, no OOM | `tm/build.rs` or `lower_tm.rs` tests | fast |
| `run_tm_described` on that program answers `TmRun::TooLarge`, never `Ran`/`HitCap` | `tm.rs` tests | fast |
| a program just under the ceiling still lowers to a genuine machine | `tests/guard_counterexamples.rs` | fast |
| **the worst shipped demo still lowers** (49,135 states, the "never rejects a legitimate program" claim) | `tests/guard_counterexamples.rs` | fast |
| the 1,022-token balanced tree still lowers; the 4,094-token one is refused | `tests/guard_counterexamples.rs` | **slow** (`#[ignore = "slow tier: ..."]`) |
| `NodeGen::seeded(u32::MAX)` then `fresh()` never returns 0 and never repeats an early id | `core.rs` tests | fast |
| `seeded` clamps past `MAX_NODE_ID`; `exhausted()` reports it | `core.rs` tests | fast |

The slow-tier row builds a 398 MB machine, which is why it is not in the merge gate — the same
reasoning `scripts/check-slow.sh` already encodes.

**`guard_counterexamples.rs` is the right home** for the "does the guard reject something real"
direction: it is the existing file for exactly that question.

---

## §6 What this does not do

- **Does not bound `Program::code.len()` directly.** §4.1 explains why a length cannot serve; the
  ceiling bounds the thing that actually costs memory. `code.len()` stays unbounded and that is now
  a deliberate, recorded choice rather than an oversight.
- **Does not collapse the three pre-checks into the lowering** (§4.2, rejected alternative).
- **Does not make `fresh()` fallible.** Saturation plus a flag, not correctness by construction.
- **Does not touch the λ backend.** Its guards (`MAX_REDUCTION_STEPS`, `MAX_TERM_DEPTH`) bound
  different quantities and were not implicated by either agent.
- **Does not measure the wasm32 ceiling in a browser.** The 727 B/state figure is native RSS. A
  browser measurement would give a better-justified `MAX_MACHINE_STATES`; it was weighed and
  deferred, so the constant rests on native measurement plus a 20× margin over the shipped demos.

- **Does not bound `parse_tm_full`'s state count, and that is correct.** §2 counted four cast sites.
  There is a fifth: `tm/syntax.rs`'s `parse_tm_full` narrows `i as StateId` over the `state <name>:`
  lines parsed out of a `.tm` text file, and it too argues from memory — "tens of GB already
  resident". Found during Task 2's review, recorded here so it does not read as an oversight.

  **It is sound, and the reason is exactly the distinction §4.1 turns on: amplification.** The
  lowering was dangerous because the state count is a *product* — a 6 KB program expands to 8.6M
  states, so bounding the input bounds nothing. Parsing has a multiplier of one: `parse_tm_full`
  takes a single in-memory `&str` and produces at most one state per line, so 4.29 billion states
  need 4.29 billion lines. The input is the bound, and it is a bound the allocator enforces before
  the cast is ever reached.

  The corollary is worth stating plainly, because it limits what §4.1 buys: **`MAX_MACHINE_STATES`
  bounds machines built through `Builder`, not machines parsed from text.** A `.tm` file loaded via
  `parse_tm_full` bypasses the ceiling entirely. That is fine on the amplification argument above,
  but anyone who later adds a path that *generates* `.tm` text — where a compact input could expand
  into many `state` lines — reintroduces the product, and the argument stops holding.
