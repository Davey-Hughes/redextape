# Binary return tags that do not fit the width — short design

## The bug

Under binary auto-fit, a program whose values all fit four bits but which has seventeen call sites gets
a wrong TM answer and no overflow:

```
fn f(x) { x } let c = 1; if c == 0 { f(0) + …16 calls… + 7 } else { f(3) }
```

The reference answers `3`; the binary TM answered `10`. The `else` call is call site 16, so its frame's
return tag is 16. `Binary::push_frame` (`crates/redextape-core/src/tm/encoding/binary.rs`) wrote the tag
with `stack_push_literal`, which had no `fits` check, unlike `write_literal`. At width 4, 16 (`10000`)
was stored as `0000`. `Binary::dispatch_tag` compared the popped tag with each call site's ordinal,
also cut to the width, so the `Ret` resumed after call site 0, inside the `then` branch's sum. Nothing
reached the overflow guard, so auto-fit never widened. `run_tm_fitted`, `run_tm_described` and
`run_tm_described_program` (the web app's path) all build the machine this way.

Unary is not affected: a unary return tag is a run of marks on the STACK with no fixed window, and
`Unary::dispatch_tag` counts the marks.

## The fix

The user chose the approach (2026-11-16): a tag that does not fit at the width goes to the overflow
guard, the way a literal that does not fit does in `write_literal`. Auto-fit then widens and gets the
right answer; a pinned narrow width halts in `overflow`.

- `Binary::push_frame` checks `fits(tag)` first. A tag that does not fit routes `entry` straight to the
  guard and builds no push chain, the same static guard `write_literal` uses: the tag is a build-time
  constant, so no runtime check is needed.
- `Binary::dispatch_tag` compares only against call sites whose ordinal fits, which are a prefix of
  `exits` (ordinals count up from 0). A site past that prefix never pushes a frame, and its ordinal cut
  to the width equals a real tag, so comparing against it could only ever shadow a real site. My call:
  trim `exits` to the fitting prefix before the chain, rather than skipping inside the chain. Trimmed,
  the chain's last exit (the defensive clamp) is the last site that fits; when every field value is a
  site's ordinal, the one value not compared is that site's, so the clamp is correct as well as
  defensive. Skipping inside the chain would leave the clamp on a site no frame can name.

## Every structural number, in both encodings

Enumerated from every caller of `stack_push_literal`, `branch_on_equals` and `Binary::bit`, and every
gadget that stores a count or pointer. "Guarded" names the check that sends a value too big for the
width to the overflow guard.

| number | where it is written or compared | status |
|---|---|---|
| a literal (`Li`, `Nil`, compare and `is_empty` results) | `Binary::write_literal`, `Unary::write_literal` | guarded: `fits(n)` / `n >= width`, static |
| call-site return tag, binary | `Binary::push_frame` → `stack_push_literal` | **the bug; fixed** (`fits(tag)` in `push_frame`) |
| call-site ordinal compared, binary | `Binary::dispatch_tag` → `branch_on_equals` | **fixed**: only ordinals that fit are compared |
| call-site return tag, unary | `Unary::push_frame` → unary `stack_push_literal` | not width-bound: STACK fields are unbounded mark runs |
| call-site ordinal compared, unary | `Unary::dispatch_tag` | not width-bound: counts marks against `exits.len()` |
| `Binary::bit` | `write_literal`, `stack_push_literal`, `branch_on_equals` only | covered by the three rows above |
| cons cell pointer | binary `heap_count_cells_bin` → `inc_acc`; unary `heap_count_cells_to_work` → `append_work_to_field` | guarded: carry out of the top digit; the field's trailing `#` |
| box pointer | binary `box_count_fields_bin` + `inc_acc`; unary `box_count_fields_to_work` + `inc_work` → `append_work_to_field` | guarded, as cons |
| box field contents | unary `box_append_field`, `box_overwrite_field`; binary copies a REG field at the same width | guarded on the last window cell (unary); fits by construction (binary) |
| defunctionalized closure tag | `defunc.rs` builds `cons(tag, env)` and `if tag == k` from `nat` literals | guarded: both lower to `Li` → `write_literal`, and `Eq` compares two REG fields already written under a guard |
| runtime compares (`compare`, `jz`, `branch_on_zero`) | REG fields against REG fields or zero, never a build-time constant | guarded: each operand was written under one of the guards above |
| slot indices, `n_loc`, label indices | `seek_slot` walks, `push_frame`/`pop_frame_restore` unrolling | never stored in a field: build-time counts only |
| universal-machine state ids and symbol codes | `universal.rs` `bits(value, width)` | fits by construction: `width_for(n)` over the count encoded; chars at 21 bits hold `U+10FFFF` |
| two-symbol block codes | `two_symbol.rs` `Code::bits` | fits by construction: the smallest `k` with `2^k >=` the symbol count |

No new bug was found outside the two binary rows.

The two binary helpers that cut a build-time constant to the width, `stack_push_literal` and
`branch_on_equals`, still rely on their callers' `fits`. After review, each states that precondition
and `debug_assert!`s it, so a new caller that forgets fails in a debug build instead of pushing or
matching a different number. Two unit tests in `binary.rs` hand each helper 16 at width 4 and expect
the panic; they are compiled only with debug assertions, since a release build drops a `debug_assert!`.
`scripts/check-slow.sh --all` runs the whole suite in release; by default, and in CI, the script runs
only the `#[ignore]` slow tier, which these two are not in.

## Tests

- `tests/tm_oracle.rs`: the probe (seventeen call sites, binary and unary, the reference against the
  fitted TM), and a pinned-width test: the same program halts in `overflow` under `Binary::at(4)`,
  answers `3` under `Binary::at(5)`, and auto-fits to 8.
- `tests/tm_binary_gadgets.rs`: `push_frame` with tag 16 at width 4 halts in the guard while tag 15
  pushes; `dispatch_tag` at width 4 over twenty exits lands every tag `0..=15` on its own exit and no
  rule targets an exit past 15.
- The seven web examples keep their binary widths: is-even, map-fold and sum-to at 4; arithmetic,
  closure and fact at 8; fact-12 at 32 (the `width` header of `redextape emit --no-config --lang tm
  --encoding binary web/src/examples/<name>.rxt`).

## Addendum: a continued run that halts in `overflow`

Added to this PR by the user, 2026-11-16.

### The bug

Auto-fit keeps the narrowest width whose attempt did not overflow, and an attempt that stops at the
step cap has not overflowed yet. The web app's session builds its TM cursor from that capped attempt,
and raising the cap lets the cursor run on into the `overflow` guard. `Session::tm_value` then decoded
the halted cursor's tapes, whose fields are cut to the width, and answered a wrong value. With a
ten-step cap, binary `let a = 9; let b = 9; a + b` fits to width 4 and answered `0`; the answer is 18.
It is reachable with the real 5,000,000-step cap: binary `fn g(n) { if n == 0 { 1 } else { g(n - 1) *
g(n - 1) } }` then `g(13) + 20` caps at width 4, and the continued cursor halted in `overflow` and
answered `1`; the answer is 21 (a temporary test in `crates/redextape-wasm/src/session.rs`, since
removed).

### The fix

The user ruled (2026-11-16): say it overflowed. A TM that halts in `overflow` never reports a value; its
status names the width it ran at and points at a wider one, with no automatic re-fit or re-run.

- `Session::tm_value` answers `Decoded::Fault` when the cursor halted in the guard: "a number the
  machine stores (a value, an address or a call's return tag) outgrew the 4-cell tape field this run
  was fitted to; it needs a field wider than 4 cells". At the widest width, 64, there is no wider one,
  so it says that width is the encoding's limit instead. (The first version said "a value outgrew";
  see "The overflow words" below.)
- My call: the words travel as the value's `Fault`, the shape a `.tm` buffer already uses for the same
  overflow, rather than as a new `TmStatus` or `RunStatus` field. The results rows and the readout show
  the TM leg's width beside its value, so the line names the width with no change to a wire type or to
  the web app.
- The guard test is one predicate, `tm::is_overflow_guard`, which `value_of_run` now calls too, so the
  two readers cannot drift.

### Every place a TM value is read off a halted run

| reader | reads | status |
|---|---|---|
| `Session::tm_value`, the run `compile` recorded | `final_tapes` | safe: only a `TmRun::Ran` is recorded, and `attempt` turns a halt in the guard into `TmRun::Overflow`, which `compile` declines |
| `Session::tm_value`, the cursor after a raised cap | the cursor's tapes | **the bug; fixed** |
| results rows, the readout (`results.ts`, `readout.ts`) | `tmValue()` | fixed with it: they decode nothing themselves |
| `.tm` buffers and edited copies (`TmValueRun::value`) | `value_of_run` | guarded: `RunFailure::Overflow` is a fault naming the header's width |
| `redextape run` on a `.tm` file | `value_of_run` | guarded |
| `redextape run --backend tm` | `run_tm_fitted` | guarded: `TmRun::Overflow` is reported, not decoded |
| `redextape emit` | `run_tm_described`, `run_tm_described_at` | guarded: refuses `TmRun::Overflow` |
| `reduce` | a `TmRun::Ran`'s tapes only | guarded by `attempt` |
| counter readback (`counter/readback.rs`) | a stage 1 image | test-only |

### Tests

`crates/redextape-wasm/src/session.rs`: the ten-step-cap program, driven as the app drives it (step to
the cap, raise it, step to the halt), answers the fault and not a value, with the halt in the guard
asserted as its premise; and the widest-width wording.

## The overflow words (after review)

Review 1 found that the words said "a value outgrew" where the number that outgrew may be a call's
return tag (M2), and that a copy of the session's machine worded the same overflow differently, with
"this is the encoding's limit" at every width, false below 64 (M3).

Checking the class found a third kind of number with the same problem: an address. Every value of
`head(tail([0, 0, …twenty zeros]))` is 0, yet `redextape emit --no-config --lang tm --encoding binary
--field-width 4` refused it with "a value does not fit a 4-cell tape field" (twenty cons cells need a
five-bit address), and seventy zeros under `--encoding unary` were refused at the 64-cell ceiling with
"a value does not fit this encoding's widest tape field". Those were the words of `main`'s `emit.rs`;
the probes' sources and their run after the change are in the lane's record directory.

My calls:

- One phrase names what outgrew, `tm::OVERFLOWING_NUMBER` in `tm/build.rs`: "a number the machine
  stores (a value, an address or a call's return tag)". Every message that reports an overflow uses
  it: `overflowed_at` (the session's leg and every copy), the session's `Overflow` decline reason,
  `redextape run`'s `.tm` overflow and `--backend tm` overflow, and `redextape emit`'s refusal.
- `overflowed_at(width, from)` is the one place the web app's overflow fault is worded. `from` says where
  the width came from: `Fit` for the session's leg ("this run was fitted to"), `Header` for a copy or a
  `.tm` buffer ("its header records"). Below 64 both point at a wider field ("it needs a field wider
  than 4 cells"), which is true for a copy too, though a copy cannot widen itself; at 64 both name the
  encoding's limit.
- Left as they are: help text and docs that describe what binary can hold ("holds a far larger value
  in the same field") or what auto-fit does ("widens until the values fit"). They describe capacity,
  not a reported overflow.

Tests: `a_return_tag_continued_into_overflow_is_named_in_the_fault` drives the seventeen-call-site
program into the guard at width 4 through a raised cap (the values it computes are 1, 0 and 3), and
the copy's test `a_lowered_run_that_overflows_its_field_is_a_fault` now expects the copy's words. Both
failed on the old words.

## Addendum 2: a continued run's length (after review)

Added to this PR by the user, 2026-11-16: after a raised step cap carries a TM run to a halt, the TM
`steps` row showed the cap (5,000,000 under the default caps) as the run's length. The bug is older
than this branch: the lane's first dispatch noted it as pre-existing, and review 1 (extra item 4)
confirmed it is on `main`. The controller added the rxm leg's twin to this PR the same day, as the
same mistake.

### The bug

`TmStatus::total_steps` was always the count of `compile`'s run, and for a capped run that is the
cap. `results.ts` shows `total_steps` as the run's length whenever the value is not `Unfinished`, and
`tm_value` reads the halted cursor once a raised cap has carried it to the end. So the row put the
cap beside the cursor's real answer. `RxmLeg::status` did the same: `RxmLeg::value` reads the cursor
once a raised cap carries it to a halt or a fault, and `rxmRows` showed `compile`'s capped count
beside it.

### The fix

My call: the count follows the value. The condition that makes `tm_value` read the cursor
(`final_tapes` is `None` and the cursor has halted) makes `tm_status` report the cursor's
`steps_taken()`. The condition that makes `RxmLeg::value` read the cursor (`end` is `Capped` and the
cursor has halted or faulted) makes `RxmLeg::status` report the cursor's count. A rewind puts the
cursor back at step 0, and both answers go back to `compile`'s run together; the worker's
`keepDecided` keeps the whole decided part, length and value, so the readout keeps the real length.
No web change is needed: the rows already read `total_steps`. The wire docs of both `total_steps`
fields say what the count now is.

### A continue that stops short again

The fix above covered a continue that reaches the end. The roadmap entry's first version (`479b45e`)
listed, as found by reading, that a continue stopping at a cap again left both rows saying
`stopped after <compile's count> at a cap`, a stop the cursor had gone past. The controller put it
in this PR, 2026-11-16, as the same mistake the user ruled on.

My call: the count is how far the run has gone. While `compile`'s run was capped (`final_tapes` is
`None`; `end` is `Capped`), `total_steps` is the larger of `compile`'s count and the cursor's
`steps_taken()`, in place of the halt and fault conditions above. At a halt or a fault that is the run's
length, as before; at a later cap it is where that cap stopped the run; with the recording stopped
on its history budget past `compile`'s count it is the cursor's count, the furthest the run is
known to reach. The larger of the two, rather than the cursor's count only once it stops, so the
figure never falls back to `compile`'s while the cursor is past it, after a second `[continue]`
for instance. A rewind puts the cursor at step 0 under `compile`'s caps, so the count is
`compile`'s again, which is where the run now stops. A finished `compile` is left alone: the
cursor runs the same machine under the same caps and stops where that run did.

What it leaves: with the recording stopped on its budget past `compile`'s count, the row still
reads "stopped after N at a cap", with N the right count but no cap at N; the rows cannot tell
that stop from a cap's without a web change.

### Every place that shows a run's length

| where | the count it reads | status |
|---|---|---|
| TM `steps` row: the strip segment and the inspector (`tmRows`) | `TmStatus::total_steps` | **the bug; fixed** in `Session::tm_status`, at a halt and at a later cap |
| rxm `steps` row (`rxmRows`) | `RxmStatus::total_steps` | **the twin; fixed** in `RxmLeg::status`, at a halt, a fault and a later cap |
| an rxm copy's status (`RxmScratch::rxm_status`) | `RxmLeg::status` | fixed with the leg; no copy line shows it |
| λ `steps` row (`lambdaRows`) | `LambdaState::step`, the live cursor's | already right, at a later cap too: `compile` never reduces, so there is no stored count to go stale |
| the readout's `recording` row | the recording's newest step | already right: it reports the recording, not the run |
| copy lines, TM, rxm and λ (`COPY_FACTS`) | the recording's newest step | already right: `TmScratchStatus` has no total, and a copy's line counts what it recorded |
| a TM buffer's value line (`valueLine`) | `ValueRun` steps and cap | already right: shown only while `Running`; an ended run shows its value |
| a reduced file's `reduced: … · N steps` | the header's recorded count | not a run's length |
| the views' step lines | the recording's history | already right |

### Tests

`crates/redextape-wasm/src/session.rs`: `a_tm_run_carried_to_a_halt_by_a_raised_cap_reports_its_own_length`
(binary `let a = 2; let b = 3; a + b`, a ten-step cap, then continued: `total_steps` is the uncapped
compile's 348, and 10 again after a rewind) and
`an_rxm_run_carried_to_a_halt_by_a_raised_cap_reports_its_own_length` (a three-instruction cap over
a program that halts and one that faults). Both failed before the fix, reporting 10 and 3, on code
where the `total_steps` that `tm_status` reports, and all of `RxmLeg::status`, are `main`'s: `git diff
19256df f3c9395` changes one line of `tm_status`, the `Overflow` decline's reason, and nothing in
`RxmLeg::status`.
Sabotage: the rxm fix without its `Faulted` arm fails the faulting program (3 where the run is 10).

For the continue that stops short again: `a_tm_run_a_raised_cap_stops_short_again_reports_how_far_it_has_gone`
(the same TM program, a ten-step cap raised by 100 to a stop at 110, raised again and stepped 50
times, then rewound) and `an_rxm_run_a_raised_cap_stops_short_again_reports_how_far_it_has_gone`
(the same two rxm programs, a three-instruction cap raised by 2 to a stop at 5, raised again and
stepped once, then rewound). Both failed on the code before, reporting 10 and 3 at the raised cap.
Sabotage: taking the cursor's count alone, without `compile`'s as the floor, fails both at the
rewind (0 where `compile`'s run stopped at 10 and 3).
