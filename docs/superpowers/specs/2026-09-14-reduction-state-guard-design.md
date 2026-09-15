# A state ceiling for the three reductions — design

> **Roadmap:** closes the first bullet of stage 3's *What this did not close*
> (`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`, the entry headed *STAGE 3 SHIPS AS A ZIG-ZAG
> FOLD*): "`to_one_way` has no `MAX_MACHINE_STATES` guard of its own; neither do the two earlier stages."
> Stage 1 is `tm/single_tape.rs` (#87), stage 2 `tm/two_symbol.rs` (#88), stage 3 `tm/one_way.rs` (#90).
>
> **Revised while planning.** Building the plan's code corrected this design in several places; the plan,
> `docs/superpowers/plans/2026-09-14-reduction-state-guard.md`, lists each one under *Spec corrections found
> while planning*.

## What this delivers

- **No reduction builds more than `MAX_MACHINE_STATES` states.**
- **An input that would go over returns a named `too-many-states` refusal**, the same one-state shape as the
  four refusals the stages already return.
- **A refusal survives any later stage**, so one call at the end of a pipeline answers for every stage.
- **One public `refusal(m)`** says whether a machine is any of the five refusals.

The signatures of `to_single_tape`, `to_two_symbol` and `to_one_way` do not change. One public signature
does: stage 1's `states_per_original` returns `Option<f64>`, as stage 2's and stage 3's already do. Nothing in
Core, asm, `encoding`, `Builder` or `lower_tm` changes.

## What was measured before designing

Every file position this section cites is at `78ebea6`, where it was measured. This branch has since moved
or deleted several of those lines; the `WORST_SHIPPED_DEMO` const is now local to `reduction.rs`'s
`worst_shipped_demo`.

### Every stage goes over the ceiling on the largest shipped demo

The largest shipped demo is `WORST_SHIPPED_DEMO` (`single_tape.rs:1144`). Lowered with
`run_tm_described_at(.., EncodingKind::Binary, .., MAX_FIELD_WIDTH)` (`single_tape.rs:1155`) it is 49,135
states, 142,560 rules, 5 tapes, and a `Code` of 5 symbols in 3 bits.

| stage | states without a ceiling | source |
| --- | --- | --- |
| stage 1, `to_single_tape` | 1,811,054 | roadmap, stage 1's entry |
| stage 2, `to_two_symbol` applied directly to the lowered machine | 2,601,972 (ratio 52.955571, built in 1.35 s) | scratch probe, below |
| stage 3, `to_one_way` | 7,363,253 | roadmap, stage 3's entry |

`MAX_MACHINE_STATES` is 1,000,000 (`build.rs:134`). Its doc measures about 727 bytes per state, on lowered
machines; at that figure an unguarded fold of this demo would hold about 5.4 GB. The peak for a reduced
machine is measured while planning, not assumed from that figure.

**Stage 2 is taken on the lowered machine so that all three slow-tier tests share one program.**

### A refusal does not survive the next stage

Each stage's private `refused` (`single_tape.rs:206`, `two_symbol.rs:223`, `one_way.rs:183`, three identical
bodies) builds one non-accept state with no rules on one tape. A scratch probe fed each of the four existing
refusal machines through each stage:

| stage | output for every one of the four refusals |
| --- | --- |
| stage 1 | 2 states, `["q0.c0.scan", "overflow"]` |
| stage 2 | 2 states, `["q0.stuck", "q0.enter"]` |
| stage 3 | 2 states, `["pre", "q0.r"]` |

12 of 12 lose the name. **A pipeline that checks only its last stage cannot see a refusal from an earlier
one.**

### Where the states are created

All three stages create every state through a private `Names::id` (`single_tape.rs:245`,
`two_symbol.rs:255`, `one_way.rs:255`) with the same body: look the name up, otherwise push a new non-accept
`State`. Outside the test modules (from `single_tape.rs:466`, `two_symbol.rs:517`, `one_way.rs:388`), nothing
else pushes a state. Outside `id`, the stages touch their state vectors through `states.get_mut` (rule pushes
and accept marking: `single_tape.rs:270`, `:284`; `two_symbol.rs:280`, `:403`; `one_way.rs:266`, `:309`), and
read `ids` without creating a state in two places: `ids.contains_key` in the fold's `pair` (`one_way.rs:293`),
and `ids.get` in stage 2's `finish` (`two_symbol.rs:508-512`), which reads the entry state's id.

`Builder::state` and `Builder::accept` (`build.rs:252`, `:268`) already enforce the ceiling for lowering.
When `states.len() >= MAX_MACHINE_STATES` they set `overflowed`, push nothing and return state 0.

## Design

### `tm/reduction.rs`, a new module

The module is named `reduction.rs` rather than `reduce.rs` because `lambda/reduce.rs` already exists, and
`scripts/check-attributions.sh` resolves citations by bare filename.

```rust
pub(crate) struct StateTable {
    ids: HashMap<String, StateId>,
    states: Vec<State>,
    ceiling: usize,
    overflowed: bool,
}

impl StateTable {
    pub(crate) fn new(ceiling: usize) -> StateTable;
    /// The existing `Names::id` body, with `Builder::state`'s ceiling in front of the push:
    /// at `states.len() >= ceiling` it sets `overflowed`, pushes nothing, records nothing, returns 0.
    /// A name already in the table still resolves after the trip.
    pub(crate) fn id(&mut self, name: &str) -> StateId;
    /// The id `name` already has, without creating a state.
    pub(crate) fn get(&self, name: &str) -> Option<StateId>;
    pub(crate) fn get_mut(&mut self, id: StateId) -> Option<&mut State>;
    pub(crate) fn overflowed(&self) -> bool;
    pub(crate) fn into_states(self) -> Vec<State>;
}

pub const TOO_MANY_STATES: &str = "too-many-states";
pub const TOO_MANY_TAPES: &str = "too-many-tapes";
pub const ALPHABET_COLLISION: &str = "alphabet-collision";
pub const CODE_DOES_NOT_COVER_ALPHABET: &str = "code-does-not-cover-alphabet";
pub const LEFT_END_COLLISION: &str = "left-end-collision";

/// Every refusal name. [`refusal`] recognises a machine only when its one state carries one of these.
pub const REFUSALS: [&str; 5] =
    [TOO_MANY_STATES, TOO_MANY_TAPES, ALPHABET_COLLISION, CODE_DOES_NOT_COVER_ALPHABET, LEFT_END_COLLISION];

/// The one refusal shape: one non-accept state with no rules, on one tape, start 0.
pub(crate) fn refused(name: &'static str) -> Machine;

/// `Some(name)` exactly when `m` has the refusal shape AND its state's name is one of the five above.
pub fn refusal(m: &Machine) -> Option<&'static str>;
```

- **There is no `StateTable::new()` without a ceiling.** No production path constructs a `StateTable` outside
  a stage's `_within` function: each stage's `Names::new` is the only production caller of `StateTable::new`,
  and that stage's `_within` the only production caller of `Names::new`. Tests construct both directly. A
  constructor without a ceiling would have no caller, so it would be dead code under clippy's `-D warnings`.
- **`refused` replaces the three private copies.** The stages call it with the constants, so a refusal name
  is spelled in one place.
- **The shape is structural, not just a name.** `refusal()` returns `None` for a machine whose one state
  carries a rule, is an accept state, or sits on more than one tape, whatever its name.

### Each stage

`to_single_tape(m)`, `to_two_symbol(m, code)` and `to_one_way(m)` each become a one-line call to a new
`pub(crate)` function taking a ceiling, passing `MAX_MACHINE_STATES` and keeping the machine it returns:

- `to_single_tape_within(m, ceiling) -> (Machine, usize)`
- `to_two_symbol_within(m, code, ceiling) -> (Machine, usize)`
- `to_one_way_within(m, ceiling) -> (Machine, usize)`

The `usize` is the count described under *The count of work started after a trip*, below.

Each stage's `Names` holds a `StateTable` in place of its own `ids` and `states`. Its stage-specific methods
stay where they are.

**The order inside each `_within`:**

1. **A refused input is returned unchanged.** `if refusal(m).is_some() { return (m.clone(), 0); }`
2. **The existing refusal checks**, unchanged in meaning, now calling the shared `refused`.
3. **Building, checked as it goes.** After each original state (the loop over `m.states` in
   `to_single_tape_within` and in `to_two_symbol_within`) or each worklist item (the `queue.pop_front()` loop
   in `to_one_way_within`), if `overflowed()` then return `refused(TOO_MANY_STATES)`. This stops the work,
   not just the answer. In the fold, `Names::pair` also queues nothing once the table has tripped: a name the
   table refuses is never recorded, so queueing it would queue it again every time it is named, and the
   worklist would never end.
4. **A final check in stage 1 only.** Stage 1's `Names::finish` creates states of its own (`OVERFLOW` and the
   entry state), so a table can trip after the loop's last check. Stage 2's `finish` and the fold create no
   state after their loops, so they have no final check, and a comment after each loop says why.
5. **In the fold, a check before the worklist.** `pre` trips a ceiling of 0 before the start pair is named,
   so nothing is queued and the check after each pair never runs; this check refuses it. At a ceiling of 1
   the start pair is queued just before its own name trips the table, and this check refuses before the
   worklist starts it.

**What a trip holds at most:** `ceiling` states, plus the rules pushed while building the one item in
progress when it tripped. Past the trip those rules land on state 0 or on nothing, and the machine is
discarded.

**`states_per_original`.** Stage 1's returned a bare `f64`, so once `to_single_tape` refuses the largest
shipped demo it would report a ratio of 1/49,135, and `the_worst_shipped_demo_measured_directly`, which
asserts only a finite, positive ratio, would stay green while measuring a refusal. All three
`states_per_original` return `None` for any refusal, checked with `refusal()` on the built machine, and that
test measures through `to_single_tape_within(.., usize::MAX)`.

### The count of work started after a trip

**In stage 1 the check inside the loop cannot be seen on the machine.** Without it, the loop goes on building
every remaining original state against a full table, and `finish`'s check returns the same refusal. Stage 2
and the fold have no final check, so deleting theirs returns an unrefused machine, which the refusal
assertions see. The count pins, in every stage, that no work starts after a trip.

**So each `_within` also returns a count:** the original states (stages 1 and 2) or worklist items (the fold)
its loop began after the table had already refused a name. The item that trips the table is not counted,
because the table was not full when it began.

- With the check, the count is 0 in stages 1 and 2, because nothing creates a state before their loops.
- In the fold it is 0 too: a trip in the preamble is refused before the worklist starts.
- The public `to_X` discards the count. Returning it from `_within`, rather than storing it in a field that
  only a test reads, keeps it clear of clippy's `dead_code`.

### Known edge: a real machine with the refusal shape

A hand-written machine with exactly the refusal shape — one non-accept state, no rules, one tape, named
`alphabet-collision` — now passes through every stage unchanged, and `refusal()` reports it as a refusal.
**It is indistinguishable from a refusal by construction, and this design accepts that rather than adding a
side channel.**

### Sentences this branch makes false

The plan must search for these, including files no task edits:

- **`MAX_MACHINE_STATES`'s doc** calls `Builder::state`/`accept` "the single choke point every state goes
  through". That stays true for lowering and becomes false for the crate.
- **`single_tape.rs`'s `to_single_tape` doc** argues for a named refusal over `Option<Machine>`. It gains a
  pointer to `refusal()`.
- **Stage 3's roadmap bullet** saying no stage has a guard.
- **Any sentence** saying the largest shipped demo "cannot be reduced" should now say it is refused, where it
  describes what the code returns rather than what it would cost.
- **`two_symbol_oracle.rs`'s `canonical.states.len() < MAX_MACHINE_STATES`**, which a one-state refusal passes.
  It becomes a `refusal()` check.
- **`two_symbol.rs`'s three citations of "`single_tape.rs`'s `refused`"**, a function this branch deletes.
- **`two_symbol.rs`'s comment in `emit_candidate`** naming `to_two_symbol`'s loop, which moves into
  `to_two_symbol_within`.
- **`one_way.rs`'s `STATE_CEILING` doc**, which records the 7,363,253-state fold as measured and not gated.
- **`state_cost_probe.rs`'s list of copies** of the largest demo's source, which gains `reduction.rs`'s.

Search terms: `choke point`, `MAX_MACHINE_STATES`, `cannot be reduced`, `cannot be folded`, `refused`,
`no guard`, `states.len() <`.

## Testing

### Fast tier

1. **`StateTable` at ceiling 3.**
   - `a`, `b`, `c` get 0, 1, 2.
   - `d` returns 0 and sets `overflowed`; `get("d")` is `None`, and the table still holds only `a`, `b`, `c`.
   - `b` still returns 1.
2. **Each stage at every ceiling from 0 to its own size**, on small inputs from that module's existing tests,
   with `N` taken from the unguarded output in the same test:
   - At every `ceiling < N`, `refusal()` is `Some("too-many-states")`; at `ceiling = N` the machine equals
     `to_X`'s output.
   - Every failing ceiling is collected and reported, not only the first, so a ceiling that escapes unrefused
     anywhere below `N` is named.
3. **Pass-through.**
   - Each of the five refusal machines through each of the three stages comes back equal to its input.
   - A refusal through stage 1 then stage 2, through the fold then stage 2, and through the fold then stage 1
     then stage 2, still reports its own name.
4. **`refusal()` negatives.** It returns `None` for:
   - each stage's output on a real machine
   - a one-state machine named `too-many-states` that carries one rule
   - the same machine with `accept: true`
   - the same machine on two tapes
   - a refusal whose `start` is not 0
5. **The four existing refusals** are recognised by `refusal()` in the tests that already trigger them
   (`single_tape.rs`'s alphabet-collision and too-many-tapes tests, `two_symbol.rs`'s uncovered-code test,
   `one_way.rs`'s left-end test).
6. **No work starts after a trip**, one test per stage, each asserting the refusal and a count of 0:
   - stage 1: `two_candidates`, three original states, at ceiling 1, where the first state trips
   - stage 2: `chain(3)`, four original states, at ceiling 1, where the first state trips
   - the fold: a four-step `walk`, at ceiling 2, so the preamble fits and the first worklist item trips
7. **A tripped table queues no more pairs**: `Names::pair` at ceiling 1, after the start pair's name trips the
   table, queues neither a new pair nor the pair the trip refused.

### Slow tier — `#[ignore]`, run by `scripts/check-slow.sh`

`check-slow.sh` runs `cargo test --release --workspace -- --ignored --nocapture`, so an ignored test is picked
up wherever it lives. The precedent is `attribute.rs`'s
`a_program_past_the_state_ceiling_attributes_as_unrepresentable`, ignored because it allocates a ceiling's
worth of states.

**Three tests, one per stage, not one test with three assertions.** A sabotage of stage 2's wiring must
redden a test that reaches stage 2, and a single test stops at its first failing assertion. They live in
`reduction.rs`'s tests. Each lowers the demo through `reduction.rs`'s `#[cfg(test)] pub(crate) fn
worst_shipped_demo()`, which `the_worst_shipped_demo_measured_directly` calls too, since that test's source was
a `const` local to its function, and asserts that the PUBLIC `to_X` refuses with `too-many-states`, then
that the same stage's `states_per_original` is `None` on the same demo:

- stage 1 on the lowered machine
- stage 2 on the lowered machine, with `Code::new(m, header.init(m.tapes))`
- stage 3 on the lowered machine

Peak RSS of each, as the release test binary's `ru_maxrss` with that test run alone, is 746,100 KB for stage 1,
675,104 KB for stage 2 and 722,860 KB for the fold, each in 2.0–2.4 s, and is written into the test's doc.

`the_worst_shipped_demo_measured_directly` builds the unguarded image, and ran in the normal tier before this
branch. Its peak RSS, measured after the final whole-branch review as the test binary's `ru_maxrss` with that
test run alone, is 1,264,160 KB in 4.3 s in a debug build and 1,262,508 KB in 3.2 s in release, and is written
into its doc. On that measurement it moved to the slow tier.

### Sabotages — run while planning, on the finished code, and recorded

| sabotage | red | green |
| --- | --- | --- |
| `to_one_way` passes `usize::MAX` instead of `MAX_MACHINE_STATES` | stage 3's slow test | **every fast test**, which is why both tiers exist |
| delete the pass-through in `to_single_tape_within` | the composition test through stage 1, and `single_tape.rs`'s own pass-through test | — |
| `refusal()` checks only the name | the has-a-rule negative | — |
| `StateTable::id` checks `>` instead of `>=` | `StateTable` at ceiling 3, every every-ceiling test at `N - 1`, and the `Names::pair` test | — |
| stage 1: delete only the check inside the loop, keeping `finish`'s | stage 1's count test, which counts 2 | the other 69 tests in the four reduction modules |
| stage 2: delete the check inside the loop, its only check | stage 2's count test at its refusal assertion, and its every-ceiling test at every ceiling below each fixture's size | the other 68 tests in the four reduction modules |
| the fold: delete the check inside the worklist | the fold's count test at its refusal assertion, and its every-ceiling test at every ceiling from 2 up; ceilings 0 and 1 stay refused by the check before the worklist; nothing times out | the other 68 tests in the four reduction modules |
| `Names::pair` queues after a trip | `a_tripped_table_queues_no_more_pairs`, which counts 3 queued | the other 69 tests in the four reduction modules |
| the fold: delete the check before the worklist | the fold's every-ceiling test, at ceiling 0 on each fixture and no other ceiling | the other 69 tests in the four reduction modules |
| stage 1's `states_per_original`: delete its `refusal()` check | `single_tape.rs`'s alphabet-collision test, at its `states_per_original` assertion, `left: Some(0.5)` | the other 69 tests in the four reduction modules |
| stage 1: delete `Names::finish`'s check, keeping the loop's | stage 1's every-ceiling test at `N - 1` on `wildcard_only` and `two_candidates`, whose `OVERFLOW` state is first created in `finish`, and at no other ceiling or fixture: `left: [(0, 5, 6), (1, 10, 11)]` | the other 69 tests in the four reduction modules |
| `refusal()`: delete `m.start != 0` | the start-not-0 negative, the last assertion of `refusal_checks_the_shape_and_not_only_the_name`: `left: Some("too-many-states")` | the other 69 tests in the four reduction modules |
| stage 2's `states_per_original`: its pre-branch `uncovered_symbol` pre-check in place of its `refusal()` check | stage 2's slow test, at its `states_per_original` assertion: `left: Some(2.0352091177368475e-5)` | **the 70 tests in `tm::single_tape`, `tm::two_symbol`, `tm::one_way` and `tm::reduction`**; no test outside those modules calls `two_symbol.rs`'s `states_per_original` |
| the fold's `states_per_original`: its pre-branch `left_end_collision` pre-check in place of its `refusal()` check | the fold's slow test, at its `states_per_original` assertion: `left: Some(2.0352091177368475e-5)` | not run: only that slow test ran under this sabotage |

The last five rows were run after the final whole-branch review: the first three on `1645937`, the fourth on
`c2a823f`, the fifth on `0daa177`.

If a row's red stays green, that is a finding and is recorded as one, not fixed away quietly. Every
sabotage runs under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`: the `usize::MAX`
row builds the whole 7,363,253-state fold, and if the test binary is killed rather than failing, that is
recorded as what happened. The runs over the four reduction modules set a 30-second nextest per-test
timeout, so a sabotage that stops a loop from ending fails instead of hanging the run. The whole normal tier
runs without it: `tm_bank_invariant`'s `the_reg_bank_stays_well_formed_at_width_64_binary` timed out under it.

### Regressions

Every existing test stays green unchanged. **No existing test pins a reduced machine's structure:** the cost
rows, `one_way.rs`'s `the_fold_stays_under_its_state_ceiling` and `two_symbol.rs`'s
`the_construction_stays_under_its_state_ceiling`, print their ratios and assert only that each ratio exists and
is under `STATE_CEILING`, and the oracles check behaviour. So before the refactor, the plan records a digest of
`print_tm` of each stage's output over the oracle corpus, and checks the same digests after it. That is what
shows that wrapping `Names` in a `StateTable` builds the same machines.

## Not in scope

- a `.tm` header for reduced machines, which is designed separately and builds on `refusal()`
- a typed `Result` in place of the named refusal
- any change to `Builder`, `lower_tm` or the ceiling's value
- predicting a stage's state count before building it; `MAX_MACHINE_STATES`'s doc gives the reason:
  counting at the choke point cannot drift from what is built

## Provenance of the scratch measurements

Neither probe is committed, and nothing in the tree re-derives these figures. Both ran on 2026-09-14 at
`78ebea6` in a scratch worktree with its own `CARGO_TARGET_DIR`, under
`systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 --`.

- **`examples/stage2_worst_probe.rs`** via `cargo run --release --example stage2_worst_probe -p redextape-core`:
  - lowered: 49,135 states, 142,560 rules, 5 tapes
  - `Code`: 5 symbols, 3 bits
  - stage 2 on the lowered machine: 2,601,972 states, start `q2.enter`, ratio 52.955571, 1.35 s
- **`examples/refusal_passthrough_probe.rs`** via `cargo run --release --example refusal_passthrough_probe -p redextape-core`:
  the 12 outputs in the pass-through table above.
