# Completing the WASM boundary — the five exports `web/` needs, and the depth guards wasm never had

**Status: designed, not built.** Companion to
[`2026-08-05-plan4-viewmodels-and-wasm-design.md`](2026-08-05-plan4-viewmodels-and-wasm-design.md),
whose §6.3 this document makes buildable, and to the roadmap's Plan 4 entry
([`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md)).

**This document amends that spec.** Its §10 landed PR 3 as "the boundary and the app" and PR 3a's
roadmap entry re-split it into 3a (`crates/redextape-wasm`) and 3b (`web/` + pnpm + Docker). That
split assumed the boundary PR 3a shipped was complete. §2 below shows it is not. **PR 3b becomes the
boundary completion; the app, the pnpm migration and arming the `docker` push move to PR 3c.**

## 0. Why this slice, and why now

Two independent reasons, found by asking what `web/` would actually call.

**§6.3 is not buildable on the boundary as shipped.** It asks for one editable pane — highlighted,
linted — with λ and TM results below: normal form, decoded value, both step counts, and each leg's
status when it declines. Five of those six need something the boundary does not expose, and one of
them needs a function whose cost makes it unusable on the path §6.3 puts it on. §2 is the evidence.

**The depth guards do not reach wasm, and the roadmap already said this slice was where to fix it.**
Plan 4's producer-slice entry records it verbatim: *"an 8 MiB-calibrated bound does not protect
WASM"*, the crash arriving near depth 180 against bounds set at 256–1500, and *"Decide it with the
WASM slice, where the target's real stack is known."* **CORRECTED 2026-08-07: that "near depth 180"
figure was never measured — PR 3b's measurement put it at 256–260, and the roadmap's own entry was
corrected to match.** PR 3a was that slice and did not take it up. PR 3c is the first slice with a
human typing into a box, so this is the last PR where it can be closed before it is a user-facing
defect.

## 1. Decisions taken

Each was decided during brainstorming; alternatives are recorded in §9 rather than discarded.

| # | decision |
| --- | --- |
| 1 | **Split again.** PR 3b is the boundary completion — Rust only, no JavaScript. PR 3c is `web/` + pnpm + `Dockerfile`/`ci.yml` + arming the `docker` push. |
| 2 | **Two free exports**, `classifySource` and `analyze`, so highlighting and linting never run a backend. |
| 3 | **`runLambda(budget)` is chunked**, returning `RunStatus` — not run-to-cap, and not `bool`. |
| 4 | **The TM needs no run loop.** `compile` already ran it; keep the result instead of re-running. |
| 5 | **A third leg.** `session.evaluate()` surfaces the reference interpreter, so disagreement is visible in the product and not only in CI. |
| 6 | **Decoded values cross as `String`**, in a four-state `Decoded` type. |
| 7 | **The wasm shadow stack is raised to 8 MiB**, then the real crash depth is measured and the seven bounds are checked against it. |
| 8 | **`web/` is vanilla TypeScript** — no framework — behind a `set`/`render` seam. Settled here, built in PR 3c. |

## 2. Five gaps, each verified against the code

§6.2 asserts that *"CodeMirror's headline feature is already delivered, in Rust."* The function is;
the boundary is not.

| §6.3 requires | on the boundary today | gap |
| --- | --- | --- |
| syntax highlight | — | `analysis::classify_source` is `pub` in core and **not exported**. |
| lint on type | only via `compile()` | `compile` lowers both backends **and runs the TM to a halt** — `run_tm_described`, 344,999 δ-steps on the `map` demo. Core's `analyze` (parse + typecheck + desugar, no backend) is **not exported**. |
| λ normal form + step count | only `stepLambda()` | `MAX_REDUCTION_STEPS` is 5,000,000, so `while (s.stepLambda()) {}` is up to 5M boundary crossings on the main thread. Plan 4's roadmap entry promised a `run_to_cap` export; **it never shipped**. |
| TM step count | — | `TmRun::Ran { tapes }` carries no count, and `session.rs` matches it as `Ran { .. }`. `sim::run` counts internally and reports nothing. |
| decoded value | — | `decode_lambda_ty` and `decode_tape_ty` are `pub` in core, reach no viewmodel and **no export**. |
| each leg's decline reason | `lambdaStatus` / `tmStatus` | ✅ the one row already served. |

**This is the same class of finding PR 3a recorded about itself** — *"FOUR THINGS CORE DID NOT
EXPOSE, none of them in the spec"* — arrived at the same way, by asking what the next consumer
calls. It is recorded here as a pattern rather than as an accident: a boundary designed without its
consumer in the tree will be short by roughly this much, every time.

**One gap is cheaper than it looks.** `TokenClass` (`analysis.rs:22`), `Span`, `Diagnostic` and
`Severity` already carry `#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]`, so
`classifySource` and `analyze` need no new derives and no new view-model types. They are marshalling
and nothing else.

## 3. The surface

Two free functions and four Session methods, added to what PR 3a shipped. Every one is marshalling
in `lib.rs` over a decision in `session.rs`, per the companion spec's §5.2.

```ts
// free — no session, both cheap enough to run on every keystroke
classifySource(src: string): [Span, TokenClass][]
analyze(src: string): Diagnostic[]

// Session
runLambda(budget: number): RunStatus
lambdaValue(): Decoded
tmValue(): Decoded
evaluate(): Decoded
```

**`classifySource`** wraps `analysis::classify_source`, which discards the lexer's diagnostics on
purpose — its own doc says highlighting a file with errors is when highlighting matters most, and
that the errors surface through `analyze`. That two-function split was anticipated in core before
either had a boundary; this gives it one.

**`analyze`** wraps `core::analyze` and returns diagnostics only. `Analysis.core` does not cross.
**Its separation from `compile` is the whole point:** linting through `compile` would simulate a
Turing machine to a halt on every keystroke.

**`runLambda(budget)`** advances the λ cursor up to `budget` steps and answers `RunStatus`.

- **Chunked, not run-to-cap.** A 5,000,000-step run in one call blocks the main thread with no
  progress and no cancellation. Chunked, the caller loops and yields — roughly 100 crossings at a
  50,000-step chunk, with progress rendering and cancellation for free.
- **`RunStatus`, not `bool`.** PR 3a's review found `stepLambda` answering `false` for every end
  condition and `raiseLambdaCap` shipping as API nothing could correctly decide to call. A run
  method returning `bool` reintroduces exactly that.
- **THE LOAD-BEARING DISTINCTION: a spent chunk budget is not a spent cap.** Exhausting `budget`
  leaves the run `Running`; only the cursor's own cap yields `Capped`. Getting this backwards puts a
  continue button on a finished run, which is the defect `LambdaCursor::raise_cap` fixed one layer in
  — and the boundary is where it would come back.

**`Decoded`** is one type for all three value-producing calls. **CORRECTED 2026-08-07: the block below
was this design's guess at the shape, written before anything crossed the boundary, and Task 8's
browser proof falsified it.** As designed:

```ts
// GUESSED — falsified by measurement; see the real shape below.
type Decoded =
  | { kind: "value";       text: string }     // format_value
  | { kind: "undecodable" }                   // ended; the result is not a recognizable encoding
  | { kind: "unfinished" }                    // the run has not ended
  | { kind: "fault";       message: string }  // RuntimeError
```

**That is not what crosses the boundary.** `Decoded` is an externally tagged Rust enum
(`session.rs:106-111`) with two unit variants and two struct variants:

```rust
pub enum Decoded {
    Value { text: String },
    Undecodable,
    Unfinished,
    Fault { message: String },
}
```

`serde-wasm-bindgen` does not normalize unit and struct variants to one shape. **MEASURED, not
derived**: the browser test `all_three_legs_agree_across_the_boundary` in
`crates/redextape-wasm/tests/browser.rs` ran `JSON.stringify` on all four reachable states from one
program and read both the tag and the payload back, not only their presence. Verbatim:

```
before    = "Unfinished"
lambda    = {"Value":{"text":"42"}}
tm        = {"Value":{"text":"42"}}
reference = {"Value":{"text":"42"}}
```

— confirmed against `serde-wasm-bindgen-0.6.5/src/ser.rs`: unit variants render as their bare name
string "for compatibility with serde-json"; struct variants wrap in a fresh `Object` keyed by the
variant name. So the shape that actually crosses is:

```ts
type Decoded =
  | "Undecodable"                      // unit variants cross as bare strings
  | "Unfinished"
  | { Value: { text: string } }        // struct variants cross as a single-key object
  | { Fault: { message: string } }
```

**The consequence for the consumer:** because `Decoded` mixes unit and struct variants, a TypeScript
consumer must branch on `typeof x === "string"` before it can index into `x` — `x.Value` is not valid
until that check has narrowed the object arm. **This is consistent with the rest of the boundary, not
a new wrinkle:** `RunStatus` and `Severity` already cross as bare variant-name strings, because both
are fieldless enums. `Decoded` is the first type on this boundary to mix a fieldless and a fielded
variant in one enum, which is why it is the first that needs the `typeof` branch at all.

**This is the seventh plan defect this branch corrected mid-flight** — the prior six are the accuracy
defects the `docs: six review findings on the wasm shadow-stack record, corrected` commit fixed. Its
shape is worth stating because it differs from those six: the plan's Task 8 Step 2 instructed the
implementer, if the guessed shape above turned out wrong, to *"fix the ASSERTION to match what
`serde-wasm-bindgen` actually produces and record the real shape in a comment"*. **That instruction was
itself the defect.** The implementer followed it exactly and correctly — the real shape landed,
verbatim, as a comment in `all_three_legs_agree_across_the_boundary` — but a comment in a test file is
not the contract PR 3c's renderer codes against; this spec is. A plan that tells its implementer to
correct a falsified design claim in a test comment, rather than in the design, launders the defect
instead of closing it. The fix is this section, not that comment.

**Four states rather than `string | null`**, for the reason `RunStatus` has four rather than three:
`decode_lambda_ty` returns `Option<Value>`, and "the run has not finished" and "it finished and the
normal form is not a Church numeral" are different facts about the program that a renderer must not
flatten into one blank field.

**Not every caller can produce every state, and the asymmetry is real rather than incidental:**

| | `Value` | `Undecodable` | `Unfinished` | `Fault` |
| --- | --- | --- | --- | --- |
| `lambdaValue()` | ✅ | ✅ | the cursor has not reached `Ended` | — |
| `tmValue()` | ✅ | ✅ | `TmRun::HitCap` — a working cursor, no final tapes | — |
| `evaluate()` | ✅ | — | — | ✅ |

`tmValue()`'s `Unfinished` is **not** λ-specific: `session.rs` gives both `Ran` and `HitCap` a working
cursor, so a capped machine yields a live session with no tapes to decode. `evaluate()` reaches
neither middle state — `interp::eval` answers a `Value` or a `RuntimeError`, with no decoding step to
fail and no partial run to report.

**`text` is `format_value` output, and `Value` itself cannot cross.** `Value::Closure { params, body:
Rc<Core>, env: Env }` carries an environment and a Core subtree; it has no serde derive and should
not acquire one. That is a property of the type, not a shortcut taken for convenience.

## 4. What the Session keeps

`compile` builds four things it needs and drops three of them.

| kept today | must also keep | read by |
| --- | --- | --- |
| `lambda`, `tm`, `program`, `map` | `core: Core` | `evaluate()` → `interp::eval(&core)` |
| | `ty: Ty` | `decode_lambda_ty(nf, &ty)` and `decode_tape_ty(&tapes, &ty, enc)` |
| | `final_tapes: Option<Vec<Tape>>` | `tmValue()` — the halted run's final tapes, today matched as `Ran { .. }` and dropped. `None` for `HitCap`, which is what makes that case `unfinished` |
| | `kind: EncodingKind` | `tmValue()`'s decoder instance |
| | `total_steps: Option<u64>` | `TmStatus.total_steps`, read off §5's `DescribedRun.steps` |

**`TmStatus` grows `total_steps`, and it is a different number about a different thing than `run`.**
`run` says where the *cursor* stands; `total_steps` says how long the *whole run* is, taken from the
run `compile` already performed. A renderer showing "step 40 of 2,870" needs both, and it does not
move as the cursor advances because it was never about the cursor. **`LambdaStatus` gets no
counterpart:** the TM's length is known at compile time because `compile` ran the machine, and λ's is
not, because `compile` builds the cursor and never reduces — there would be no honest number to put
there.

**`evaluate` is a Session method, not a free `evaluate(src)`.** A free function would re-run parse,
typecheck and desugar — work `compile` already did — purely to reach a `Core` the session had and
threw away. Keeping the `Core` makes the interpreter the only added work.

**The `kind` row carries no width.** `TmRun::Ran`'s own doc records that both encodings decode
structurally, delimiter to delimiter, so any instance decodes tapes produced at any width. No fitted
width is threaded to the decoder, and there is therefore no second object that can disagree with the
first — the shape that once mis-attributed 1,049 of 1,374 spans when a map built at one encoding was
read through a machine lowered at another.

**Two costs of this slice, stated rather than found later.** `Session` grows by a `Core`, a `Ty`, the
final tapes and an `EncodingKind`, so a compiled session is larger than PR 3a's — bounded by the
program, not by the run. And the browser now evaluates the program three times, once per model. That
is the product, not waste: nothing is recomputed, and the front end runs once.

## 5. The TM step count

`sim::run` builds a `TmCursor`, `TmCursor::steps_taken()` is `pub`, and every layer above discards
the number. Plumb it up and hang it on **`DescribedRun`**:

```rust
pub struct DescribedRun {
    pub run: TmRun,
    pub machine: Machine,
    pub header: TmHeader,
    pub steps: u64,   // new
}
```

**Not on `TmRun::Ran`, for two reasons.** `TmRun::Ran { tapes }` is destructured at **52 sites**
across the core, native and oracle test suites, every one of which would need a `..` added;
`DescribedRun` has **10 references**, exactly one struct literal, and no exhaustive destructuring —
all reads are field access. And it is the more honest home: `run_tm_described` answers `Err` for a
program that never ran, so a `DescribedRun` always describes a run that *started*, including
`HitCap` and `Overflow` — both of which have step counts and would have nowhere to put them if the
field hung off `Ran`.

`simulate_final` widens to report the count, at **7 call sites** (3 in `src`, 4 in tests and
examples), all mechanical. **A `simulate_final_counted` sibling is not taken** — and not for the
reason it first appears: it would not duplicate the loop, since `sim.rs` already has four one-line
wrappers (`simulate`, `simulate_final`, `simulate_watched`, `simulate_trace`) over a single private
`run`, and a fifth would be in keeping. It is not taken because the count is a fact about the run
that **every** caller could use and none could previously reach — `run` has always counted it to
enforce the step cap — so hiding it behind an opt-in wrapper preserves the gap rather than closing
it. The other four wrappers discard it, because none of their callers asked.

**For `Overflow`, `steps` describes the last attempt.** `run_tm_described` doubles the width and
retries, so a program that overflows at width 8 and fits at 64 simulates four times; the count
reported is the one belonging to the run whose outcome is reported.

## 6. The wasm stack, and how the number gets decided

```toml
# .cargo/config.toml
[target.wasm32-unknown-unknown]
rustflags = ["-C", "link-arg=-zstack-size=8388608"]
```

**Target-scoped**, so native builds are untouched. Nothing in `.forgejo/` or `scripts/` sets
`RUSTFLAGS` — checked, not assumed — which matters because an environment `RUSTFLAGS` silently
overrides config-file rustflags and would disarm this without failing anything.

The seven bounds this has to protect, all calibrated on a native 8 MiB stack:

| constant | value | file |
| --- | --- | --- |
| `MAX_PARSE_DEPTH` (source) | 300 | `parser.rs:46` |
| `MAX_PARSE_DEPTH` (λ syntax) | 256 | `lambda/syntax.rs:44` |
| `MAX_TYPE_DEPTH` | 1500 | `typeck.rs:78` |
| `MAX_EVAL_DEPTH` | 700 | `interp.rs:25` |
| `MAX_LAMBDA_LOWER_DEPTH` | 700 | `lambda/lower.rs:42` |
| `MAX_LOWER_DEPTH` | 580 | `tm/lower_asm.rs:30` |
| `MAX_DEFUNC_DEPTH` | 580 | `tm/defunc.rs:80` |

Every one sits above the ~180 the roadmap recorded for wasm at the time this was written — **corrected
by PR 3b's measurement to 256–260; the conclusion below held anyway and is now confirmed rather than
assumed.** **On wasm the guards are therefore decorative today: the trap fires first**, and a wasm
trap has no unwinding — which is precisely the outcome the companion spec's §7 says must never happen
("A Rust panic under wasm is an abort that poisons the module"). PR 3b's browser measurement bears
this out directly: `MAX_PARSE_DEPTH` itself was unreachable pre-flag — a 400-deep paren nest that
natively refuses with a diagnostic instead aborted the wasm module when run alone against the stock
1 MiB shadow stack.

**THE MEASUREMENT IS A ONE-OFF PROBE, NOT A SHIPPED TEST.** A trap poisons the module for every
later case in the same instance, so a binary search that deliberately overflows cannot live in CI —
it would take the rest of the file down with it, and the failure would read as unrelated.

1. **Probe manually in headless Chrome, once, before and after the flag**, finding the depth at which
   each recursive pass actually dies.
2. **Record both numbers in the roadmap.** The before/after delta is the diagnostic: if raising
   `-z stack-size` does not move the crash depth, the binding constraint was never the
   linear-memory shadow stack but V8's own wasm call-depth limit, which a module cannot set.
3. **Decision rule:** every bound must sit at or below **half** the measured crash depth — the same
   margin the native 700 was calibrated at (~1470 / 2.1). Any bound that does not clear it takes a
   `#[cfg(target_arch = "wasm32")]` value that does, documented at the constant, stating plainly
   that the browser then refuses programs the CLI accepts.
4. **Ship only the safe-side test:** at each guard's bound, the boundary answers a `Diagnostic` or a
   `TooDeep` rather than trapping. No test in CI ever crosses the line.

**Named risk, not deferred:** step 3's fallback is a capability reduction visible to users, and it
breaks the invariant the λ depth guard was calibrated to give — *"if the reference interpreter can
evaluate it, the λ backend can lower it"* — on wasm only. The measurement decides whether it is
needed; the spec does not pre-commit to a number it has not measured.

## 7. Error handling

The companion spec's §7 lists five refusal kinds and requires the UI not flatten them. This slice
adds one and re-homes none.

```
analyze()                → Error-severity Diagnostic[]   → no session      (unchanged)
lambda::lower            → LowerError::{StatefulClosure, Unsupported, TooDeep}   (unchanged)
tm lowering              → TmRun::{TooLarge, LowerError(..)}               (unchanged)
tm run                   → TmRun::Overflow                                 (unchanged)
either cursor, mid-run   → HitCap                                          (unchanged)
render budget exceeded   → truncated: true / ast() → None                  (unchanged)
interp::eval             → RuntimeError                → Decoded::fault    (NEW)
```

`RunError::Static` is **not** a new display path: it is the same `Vec<Diagnostic>` the lint path
already renders, and `evaluate()` cannot produce it at all — a session exists only for a program
that had no error-severity diagnostics, so the static half is unreachable from a Session method.
`RunError::Runtime` is the one genuinely new shape: `RuntimeError { message: String }`, which crosses
as a string.

**No panic may cross the boundary**, unchanged and now with a second reason. The workspace lints
already deny `unwrap_used`/`expect_used`/`panic`/`todo`/`unimplemented`, and `redextape-wasm`
inherits them; §6 closes the one abort those lints cannot see, which is the stack.

## 8. Testing and coverage

**Native, in `session.rs`, counting toward the gate:**

- `runLambda` — a chunk budget smaller than the run leaves `Running`; the cursor's cap yields
  `Capped`; a depth-refused term yields `DepthRefused` and never `Capped`.
- The `Decoded` producers, against §3's reachability table — `unfinished` before the λ run ends *and*
  for a `HitCap` machine; `undecodable` for a normal form that is not the expected encoding; `value`
  otherwise; `fault` only from `evaluate`, which reaches neither middle state.
- **λ, TM and the reference agree**, on the corpus, asserted through the boundary types rather than
  through core's. This is the three-way oracle the suite already runs, moved to the layer the product
  reads — which is the argument for exposing the third leg at all.
- **`DescribedRun.steps` equals `TmCursor::steps_taken()`** after driving the cursor to the same end.
  Two sources for one number is a drift hazard; this is the check that they cannot diverge, and it is
  the device PR 2 used for `TmCursor<&Machine>` versus `TmCursor<Rc<Machine>>`.
- `classifySource`/`analyze` — span coverage and diagnostics identical to the core functions they
  wrap, so the boundary is proven to add nothing.

**Browser, `wasm-bindgen-test`, every call through `Reflect`** as PR 3a established — holding a
`Session` as a Rust value would re-run the native tests in a browser and never touch the generated
glue:

- `classifySource` and `analyze` on a program with a deliberate type error.
- A `runLambda` chunk loop reaching `Ended`, pinning the same figures both sides already pin.
- All three legs' values agreeing on one ordinary program.
- The §6 safe-side depth cases: refusal, never a trap.

**Coverage expectation.** The tree is at **95.50%** against a floor of 80, with `lib.rs` at 0% over
64 lines by construction. **CORRECTED 2026-08-07: that 95.50% was the REGIONS column, not lines — PR
3a's own entry mislabeled it, and the mislabel propagated here.** The true baseline is **96.04% lines
/ 95.53% regions**; see the roadmap's boundary-completion entry for what it dropped to and, more to
the point, why the drop is not the evidence that matters. This slice grows `lib.rs` to roughly 110
lines of marshalling, so expect a further drop of a few tenths. **A materially larger drop means logic
leaked out of `session.rs`** — the same rule PR 3a set for itself, and the same response: more
inner-module tests, never an `--exclude`.

## 9. Considered and not taken

### 9.1 One PR for the boundary and the app

Rejected. The diff would mix two toolchains and two review skill sets, and it would bury the
registry-push arming — the side effect PR 3 was split to isolate in the first place. The companion
spec's §10 already names a PR with a tested contract and no consumer as *"a legitimate resting
point, not a half-finished one"*, which is exactly what PR 3b now is.

### 9.2 Trimming §6.3 instead of completing the boundary

Drop "decoded value" and both step counts, and the Rust half shrinks to `classifySource` +
`analyze`. Rejected: it cannot reach zero Rust — highlighting needs an export no matter what — and
it leaves PR 3c proving less than "the boundary works end to end", which is the only thing that slice
is for.

### 9.3 React in `web/`

**Seriously considered**, because the roadmap's Plan 5 line specifies *"Vite + React + TypeScript +
Biome"* while the companion spec's §6.1 dependency table has no framework at all. The contradiction
had to be settled here, since this is the slice that creates `web/`.

**What React would tangibly buy, in this project:** it removes the stale-render bug class across
Plan 5's ~dozen-field state (detach flags, both cursors, both statuses, the caps banner); it keeps
§7's nine mutually-exclusive result shapes legible as JSX; and it brings
`@testing-library/react` for Plan 5's component tests.

**Rejected on two facts specific to this UI.** It does not manage the largest DOM — three CodeMirror
panes mount in a ref and CM6 owns everything beneath, so the reconciler opts out of the main view.
And it is *worse* for the tape: `tmState(radius)` returns a fixed `2r+1` cells per tape updated every
step, which is a perfect case for allocating cells once and mutating them, and a poor one for
per-frame vdom.

**What replaces it is roughly 30 lines** — a state object behind a `set(patch)` that calls
`render()`, which removes the one win of the three that actually bites. `web/src/` keeps
`session.ts`, `highlight.ts` and `lint.ts` as framework-free modules, so a later React adoption
rewrites the shell and not the parts this slice proves.

### 9.4 `runLambdaToCap()` as well as the chunked primitive

Rejected. The convenience is one line of JavaScript over the primitive, and shipping both means two
ways to spend a 5,000,000-step budget, only one of which keeps a tab responsive.

### 9.5 Driving the `TmCursor` to produce the TM's results

Rejected: `compile` already ran the machine to a halt inside `run_tm_described`, so driving the
cursor for the same answer simulates the `map` demo's 344,999 steps a second time. The cursor exists
for *watching* a run, which is Plan 5's job; the results come from the run that already happened.
§8's equality test is what keeps the two answers from drifting.

### 9.6 A structured `Value` across the boundary

Rejected on the type, not on taste — see §3. `Value::Closure` holds `Rc<Core>` and an `Env`, and the
product renders `42`, `[1, 2, 3]` and `()`, which `format_value` already produces.

### 9.7 Per-target depth constants as the primary fix

Not taken as the *primary* fix, and explicitly kept as the fallback §6 step 3 defines. Taking it
first would diverge browser and CLI behaviour without first checking whether an 8 MiB shadow stack
makes the divergence unnecessary — answering by default a question that can be answered by
measurement.

## 10. Landing order

**PR 3b — the boundary completion.** Everything in §3–§8. Rust only, in **eight commits**: the core
step count; the two free exports; `runLambda`; `Decoded` + `evaluate`; `lambdaValue`; `tmValue` +
`total_steps`; the stack flag and its measurement; the browser proof.

**The `dead_code` constraint is real and does not force one commit here — corrected while writing
the plan.** PR 3a recorded its own three-commit split as infeasible because the pre-commit hook runs
clippy with `-D warnings` and a `Session` whose fields no method reads yet is `dead_code`. This
document originally inferred that §4's four new fields put PR 3b in the same position. They do not:
the constraint binds only when a field lands *separately from* its reader, and the split above lands
each field in the same commit as the method that reads it — `core` with `evaluate`, `ty` with
`lambdaValue`, `final_tapes`/`kind`/`total_steps` with `tmValue`. The lesson PR 3a recorded is about
commit *ordering*, not about an unavoidable single commit.

**PR 3c — the app.** `web/` (vanilla TS + CM6 + the `set`/`render` seam, per §9.3), the pnpm
migration of `Dockerfile` and `ci.yml` (companion spec §6.4), and arming the `docker` push
(companion spec §6.5). Unchanged from what that spec describes, except that its results block now
has a boundary to read.

## 11. Open risks

1. **The stack fix may not be sufficient**, and §6 step 2 is how that is found out rather than
   assumed. If V8's wasm call-depth limit binds before the shadow stack, per-target constants become
   forced and the CLI/browser divergence has to be explained in the UI.
2. **`decode_tape_ty` on the fitting run's tapes is untested at the boundary.** Core tests it
   directly; nothing has yet decoded tapes that travelled through a `Session`. §8's three-way
   agreement test is the guard, and it is the first consumer of that path.
3. **The three-legged results block triples the browser's compute per compile.** Bounded by the
   program and irrelevant at teaching scale, but the caps affordance (companion spec §6.4) now has
   three runs to describe rather than two, which is Plan 5's problem to render.
4. **Coverage headroom**, unchanged in character from the companion spec's §11.2 and slightly worse
   in degree: `lib.rs` roughly doubles and stays 0% by construction.
