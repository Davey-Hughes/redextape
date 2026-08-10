# The print-depth cap — a guard calibrated against the stack it actually runs on

**Status: designed, not built.** Roadmap:
[`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md) — the entry
*"A large integer literal kills the wasm module, `MAX_TERM_DEPTH` cannot stop it, and the shadow stack
is the wrong suspect"* (raised 2026-08-09, during PR 5b) is the finding this closes.

**Typing `let x = 2690; x + 1` into the app destroys the session, unrecoverably.** This slice makes
the printer's depth guard fire before V8 does, by giving it a number measured on the thread the app
prints on rather than the one a test harness happened to use.

## 0. What was measured, and why every number previously on record was the wrong one

The printer's walk is bounded by `lambda::reduce::MAX_TERM_DEPTH` (3,000) — the *reducer's* constant,
borrowed. The engine kills the module below that, so the guard cannot fire. That much was already
known. What was not known is **where** the ceiling sits, and the answer depends on which thread asks.

| context | last surviving term depth | passes | measured |
| --- | --- | --- | --- |
| page thread, Chrome (wasm-pack) | ~2,690 | bisected once | 2026-08-09, `wasm-depth-investigation.md` |
| page thread, Chromium (playwright) | **2,833** | 5/5, spread 0 | 2026-08-09, this design |
| **worker thread, Chromium (playwright)** | **1,930** | 3/3, spread 0 | 2026-08-09, this design |

**The worker's stack is 31.9% smaller than the page's, and the worker is where the app prints.**
`session-worker.ts` calls `lambdaState(LAMBDA_BYTE_BUDGET)` on every compile (`:298`) and
`linkIndex(LAMBDA_BYTE_BUDGET)` right after `compile` (`:345`). Every figure recorded before today was
taken on a page thread, so every figure recorded before today describes a stack the app never uses.

**The worker figure was corroborated by an orthogonal route before anything was built on it**, because
the cap rests entirely on it and it came from a harness written the same day. Plain-JS recursion depth
in the same browser: page median **15,462** frames, worker median **6,159** — ratio **0.398**, against
wasm's 0.681. The absolute ratios differ (frame sizes and per-thread overhead are not the same
quantity) but both sit far below 1.0, so a worker's smaller stack is a property of the platform rather
than of the probe. **The same check found the one caveat worth carrying:** JS page depth swung 23%
across three back-to-back runs (11,946 → 15,598) while the wasm boundary measured spread 0 across
three passes — all inside one browser session. The wasm boundary's stability is therefore established
*within* a session, not across them, which is part of what the 22% margin in §2.1 is for.

**This is not a quibble about precision — it falsifies the mitigation the investigation recommended.**
That document named *"a guard on `LambdaTerm::depth()` … margined well under the measured ~2,690 crash
line (e.g. 2,000, matching this project's own convention of leaving real margin below a measured
boundary rather than hugging it)."* **2,000 is above 1,930.** Shipping it would have produced a second
guard that cannot fire — the same defect as `MAX_TERM_DEPTH = 3,000`, arrived at by the same route:
one measurement, taken somewhere convenient, generalized without checking.

### Three further facts, each of which closes off an alternative

**1. The guard does not merely fail to fire — it fires too late, by construction.** Past
`MAX_TERM_DEPTH` the walk *does* stop, at 3,000 frames. Measured on the page thread: n=3,001, 4,000
and 6,000 all `STACK-OVERFLOW`, because 3,000 frames is already ~170 past the 2,833 cliff. There is no
input size at which today's guard saves the module. "Decorative" understates it.

**2. The byte budget structurally cannot be the protection.** At n=2,780 — the last comfortable point
on the page thread — the term prints **in full** at 11,185 bytes with `truncated: false`, against a
65,536-byte budget. The budget has 5.9x headroom at the cliff. Lowering `LAMBDA_BYTE_BUDGET` (the
investigation's second candidate) would have to cut it by ~83% to bound depth, destroying the feature
it exists for.

| n | `truncated` | text bytes |
| --- | --- | --- |
| 1,000 | false | 4,065 |
| 2,000 | false | 8,065 |
| 2,600 | false | 10,465 |
| 2,700 | false | 10,865 |
| 2,780 | false | 11,185 |

**3. Reduction is not co-exposed, and this was checked rather than assumed.** `runLambda(10_000)`
returns cleanly at every n from 1,000 to 6,000, including 2,900–2,999 where both prints die. A second
probe drove the shape that *grows* under reduction (`let xs = [0..k]; head(xs)`, which the roadmap
measures going depth 607 → 1,805): k=200/400/600 all reach `Ended` with prints clean on both sides,
and k=800/900/950 are refused by λ lowering outright (*"this program has no λ leg"*). **The λ backend's
own limit fences this program family off from the print ceiling.** Recorded as a negative result, not
a fix — the scope decision for this slice was to locate the reducer's ceiling, and locating it means
being able to say it is not in range.

## 1. Scope

**In:** the print path's depth cap and the cause it reports; the two documentation errors below; tests
that pin both boundaries; the roadmap entries.

**Out, deliberately:**

- **Raising `MAX_TERM_DEPTH`.** It has its own pressure (roadmap: `sum(100)` reaches 3,001, hitting the
  cap exactly) and its own slice. Nothing here moves it. After this change it bounds only the reducer,
  which is what it was written for.
- **Making the printer iterative.** The structural fix — an explicit worklist, following `to_tree`'s
  `Enter`/`Abs`/`App` idiom — removes the engine-stack dependence entirely and is what the arena slice
  did one layer down. It is not taken here because it rewrites the file whose span-fidelity oracle was
  wrong three times in one slice, to fix a bug a parameter closes. **It becomes load-bearing the moment
  anyone wants to print deeper than the cap**, and is recorded in the roadmap as such.
- **Measuring the dev wasm build or non-Chromium engines.** Calibration is on release, which is what
  users load. The tripwire in §5 is what carries that risk.

## 2. The cap

### 2.1 Value: 1,500

**22% below the measured worker ceiling of 1,930.** The margin is sized against a real observation
rather than taste: Chrome and Chromium differ by ~5% on the page thread (2,690 vs 2,833), so a cap
must absorb engine-to-engine variation it has not seen. 1,500 survives an engine ~20% less generous
than the one measured.

**What it costs, stated plainly.** Terms deeper than 1,500 have their printed text cut and their link
spans past the cut absent. The roadmap records `[0..600]; head(xs)` reaching depth 1,805 under
reduction, so that program's final-term readout will show a depth cut where today it shows the term.

**What it does not cost, which is most of what a user looks at.** The per-frame λ pane prints at
`FRAME_BYTES` (512), which self-limits around depth 170 — roughly nine times below the cap. The
animation, the stepping, and the frame-by-frame display are untouched at any cap in this range. Only
two call sites use the 65,536-byte budget: the results pane's final term, and `linkIndex`'s spans.

### 2.1, CORRECTED — 2026-08-09, same branch, before merge

**This section is left as originally written above, because this document is a record of what was
designed, not a rewrite of history. The premise it argued from turned out to be the wrong quantity.**

**1,930 is the worker's FIRST-PRINT ceiling, not a bound on the worker the app keeps running.** It was
measured by bisecting term depth with a fresh worker per sample, so every sample was that worker's
*first* deep print. Driving one worker through repeated deep prints shows the ceiling is not fixed: it
drops after the first deep print, and lies somewhere in a lower, STEADY-STATE bracket of
**[1400, 1497)** — the endpoints actually sampled below, not a single measured point. Measured, one
worker, repeated prints at fixed depths:

| reps | n=1497 | n=1400 | n=1200 | n=1000 | n=700 |
| --- | --- | --- | --- | --- | --- |
| 2 | ok | ok | ok | ok | ok |
| 5 | fail@5 | ok | ok | ok | ok |
| 20 | fail@4 | ok | ok | ok | ok |
| 60 | fail@4 | ok | ok | ok | ok |

**The degradation is bounded** — the ceiling falls once, then holds, rather than eroding without
limit — which is what makes a cap set below it a real fix rather than a smaller guess.

**The shipped cap is 1,000, not the 1,500 argued for above** — below the measured steady-state bracket
of [1400, 1497), not 22% below 1,930.
The 22%-margin reasoning above is not wrong on its own terms; its premise was. This measurement was
made to explain a hang that reached this branch before merge: a program modestly deeper than 1,500
poisoned a worker's session (the aborted `&self` print call left wasm-bindgen's reentrancy borrow
taken), and `dropLive()` calling `held?.session.free()` unguarded on that poisoned session threw a
second time inside the error handler's own `catch`, before the `worker-error` postMessage could run —
so the client heard nothing. Fixed by two commits: `MAX_PRINT_DEPTH` lowered to 1,000, and `dropLive()`
made non-throwing as defence-in-depth. Full chain, each link measured:
`docs/superpowers/plans/2026-07-19-redextape-roadmap.md`'s closing print-depth-cap entry.

### 2.2 Shape: a parameter, with the default owned by `redextape-wasm`

```rust
// crates/redextape-core/src/lambda/syntax.rs
pub fn print_lambda_capped(t: &LambdaTerm, byte_budget: usize, depth_cap: u32)
    -> (String, Classified, Option<Cut>);
pub fn print_lambda_linked(t: &LambdaTerm, byte_budget: usize, depth_cap: u32,
                           want: &BTreeMap<NodeId, Path>)
    -> (String, Classified, Option<Cut>, Vec<(Span, NodeId)>);
```

`viewmodel.rs` threads `depth_cap` through `LambdaState::render` and `LinkIndex::build`, per that
file's own header: *"CORE NEVER PICKS A NUMBER … the budgets are PARAMETERS, never constants in this
file."*

**The constant lives in `redextape-wasm`, and needs no `cfg`.** That crate builds `rlib` as well as
`cdylib` specifically so `session.rs` compiles natively for tests, so a plain constant there is the
wasm boundary's policy on whichever target the test runs — and native tests then exercise the same
number the browser uses.

**It does not live beside `LAMBDA_BYTE_BUDGET` in `web/src/protocol.ts`, and the difference is the
point.** A byte budget is renderer taste — how much text a pane will hold — and getting it wrong makes
a pane ugly. A depth cap is a fact about an engine stack no module can size, and getting it wrong
poisons the wasm module. Those do not belong in the same file, and a number a UI author can adjust
without a browser measurement is a number that will drift back over the cliff.

**`print_lambda` and `print_lambda_mapped` keep passing `MAX_TERM_DEPTH`**, preserving today's native
behaviour exactly. They are unbudgeted convenience printers used by examples and tests, never by the
boundary.

## 3. The cause

### 3.1 Why a bool no longer suffices

`syntax.rs`'s own doc already says it: *"`truncated` means 'bounded, for either reason' — a caller
cannot tell from the bool alone which limit fired."* That was harmless only because the depth branch
was unreachable in the browser. Making it reachable makes the ambiguity live.

**The tree already solved this exact problem one layer over.** `trace.rs:317` —
*"`depth_capped` distinguishes `HitCap`'s two producers, which `status()` alone cannot."* — which is
why `RunStatus::DepthRefused` exists beside `Capped`, and why `raise_cap` refuses a depth-capped run
(`trace.rs:100`): extending a budget cannot make a term shallower. This slice applies the established
rule to the one flag that had not needed it yet.

### 3.2 The two cuts are not the same kind of object, and this is the stronger reason

Only the **byte** re-check gates a `parens` frame's closing paren (`syntax.rs:442`, `out.len() >=
budget` with no depth term). On a depth bail, every enclosing `parens` frame writes its `)` as the
stack unwinds. So:

- a **byte** cut is reliably malformed — an unclosed paren — and fails to reparse loudly;
- a **depth** cut can come out **well-formed**: valid λ text that reparses into a *different, shorter*
  term than the one printed.

`results.ts:44` currently asserts *"a truncated printed term is a prefix of the real one rather than a
lie about its shape."* True for bytes. **False for depth** — which is exactly the case this slice
makes reachable. That comment is corrected in §6.

### 3.3 Type and wire shape

```rust
/// Why a bounded print stopped early. `None` means it ran to completion.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Cut { Bytes, Depth }
```

- `LambdaState.truncated: bool` → `LambdaState.cut: Option<Cut>`
- `LinkIndex.lambda_truncated: bool` → `LinkIndex.lambda_cut: Option<Cut>`

**Renamed, not retyped.** `truncated: 'Bytes'` reads badly, and leaving the name would let
`if (state.truncated)` keep compiling while silently meaning something new. Renaming makes the
typechecker name every site.

**PascalCase on the wire** — `null | 'Bytes' | 'Depth'` — matching `RunStatus`, which already crosses
as `'Ended'` / `'DepthRefused'` and which `results.ts:42` compares against.

### 3.4 Precedence: first cause wins

The walk **continues at siblings** after a bail, so one subtree can be cut by depth and another by
bytes in the same print. With a bool that was invisible; with a cause it is arbitrary unless specified.
**`cut` is set only when it is `None`** — the reported cause is what stopped the walk *first*, which is
deterministic and reproducible. Pinned by a test (§5.3).

## 4. Consumers

- `results.ts:46` — `'… truncated at 64 KiB'` for `Bytes`; `'… too deep to show in full'` for `Depth`.
  The current string is a false statement in the depth case: the terms in question are ~6 KB.
- `lambda-pane.ts:145` — `' … truncated'` gains the same distinction.
- `main.ts:242` / `link-status.ts` — `lambdaTruncated` becomes `lambdaCut`; the existing
  `'truncated'` vs `'unmapped'` distinction is untouched, since it answers a different question
  (*was this construct cut* vs *was it never mapped*).

## 5. Tests

Four of these are only possible because the cap became a parameter: the depth branch can be driven at
`cap=3` instead of by building a 1,500-deep term.

1. **native** — depth cut at `cap=3` on a deeper term → `Some(Cut::Depth)`.
2. **native** — byte cut at `budget=64` → `Some(Cut::Bytes)` (extends the existing test).
3. **native** — both limits reachable in one print → first cause wins, deterministically (§3.4).
4. **native** — `cap=u32::MAX` keeps `an_unreachable_budget_is_identical_to_the_uncapped_printer` true.
5. **browser, `web/tests/browser/`, in a worker** — **the tripwire**: a term at exactly the cap prints
   without throwing. Fails if a future engine's stack drops to meet the cap. Same role as
   `a_deep_but_legal_program_needs_the_raised_shadow_stack`, one stack up.
6. **browser, `web/tests/browser/`, in a worker** — `let x = 2690; x + 1`, the original repro, returns
   `Cut::Depth` instead of poisoning the session, **and a later call on the same session still
   succeeds** — the second half is what proves the wasm-bindgen borrow guard was never left taken.
6b. **browser, `crates/redextape-wasm/tests/browser.rs`, page thread** — the same assertion at n=2,900,
   which is above the *page* ceiling of 2,833 and therefore meaningful where the test actually runs.
7. **web/node** — `results.ts` note text differs by cause.
8. **web/browser** — `lambdaLinkState`'s `truncated` branch end to end. **This is 5b's third open
   item**, which recorded *"Not deferred by choice … whoever fixes `MAX_TERM_DEPTH` unblocks this test
   as a side effect."* It needed a λ term past the byte budget, which needed a literal that crashed the
   module; with the cap in place a depth cut reaches the same branch without one.

**Tests 5 and 6 must run in a worker, which is why they are not Rust tests.** `wasm_bindgen_test` runs
on the page thread, where a cap of 1,500 passes trivially against a ceiling of 2,833 and proves nothing
about the 1,930 the app lives under — repeating, inside the fix, the exact error the fix exists to
correct. `wasm_bindgen_test_configure!(run_in_dedicated_worker)` would move the whole of `browser.rs`
onto a worker thread, re-homing every existing test there to buy two; a vitest browser test spawns a
worker in one line and already has `pkg/` on hand. **Test 6b stays on the Rust side at n=2,900**, where
the page thread's own ceiling makes the assertion bite — so the regression is pinned on both stacks
rather than only the one that is cheaper to reach.

## 6. Documentation corrected

1. **`reduce.rs:44-49`** — *"Effective only when the running thread's stack is large enough (WASM
   shadow-stack sizing is a Plan 4 follow-up)"* implies `-zstack-size` would help. It would not: the
   exhausted resource is V8's engine call stack, which no module can size, and `.cargo/config.toml`
   already says so in its own last paragraph. Anyone following that note to its obvious remedy spends
   the effort and still crashes.
2. **`results.ts:44-45`** — the "prefix, not a lie about its shape" claim, false for depth cuts (§3.2).
3. **`syntax.rs`** — `print_lambda_capped`'s doc: the depth bound is now the caller's, not
   `MAX_TERM_DEPTH`; the reparse warning gains the measured reason the depth case is the dangerous one.
4. **`.cargo/config.toml`** — its closing paragraph says the engine's call-depth limit is not what
   `-zstack-size` controls and that "the measurement recorded in the roadmap is what says whether it
   was enough." That measurement now exists and is 1,930 on a worker; point at it.

## 7. Roadmap

- A new entry for this slice, carrying the measurement table from §0 — scratch under
  `.superpowers/sdd/` does not survive `git clean -fdx`.
- The 2026-08-09 crash entry gains its resolution and the correction that its recommended 2,000 was
  above the real ceiling.
- 5b's open item 3 closes.
- **Folded in, per its being a finding that would otherwise die in scratch:** *all 8 uncovered web
  functions live in 3 files* — **function** coverage `banner.ts` 75%, `lambda-pane.ts` 83.33%,
  `main.ts` 82.35%; every other file is 100%. (Not to be confused with `banner.ts`'s 64.28% on a
  different metric, which is by design — `showBanner` is split from `bannerText` so the wording is
  node-testable and the DOM write is not.) Since `functions` is the tightest of the four floors —
  three new untested entries trip it, against 10 for branches and 14 for statements — those three
  files are the only sources of headroom, and `main.ts` is app wiring. This is what a future PR will
  hit when `functions` trips.

## 8. Risks, and what stays unmeasured

- **Non-Chromium engines and the dev wasm build are not measured.** SpiderMonkey and JSC have
  different limits; debug frames are larger, so `build:wasm:dev` has a lower ceiling than 1,500's basis.
  The 22% margin is the mitigation and the tripwire is the detector. Stated rather than smoothed over.
- **1,930 is one machine's Chromium.** Worker stack sizes are not specified by any standard.
- **The reducer's ceiling is bounded below, not located.** `runLambda` is clean to 6,000 and the λ
  backend refuses the list shapes that would grow deeper, so nothing in reach crosses it. If λ lowering
  is ever relaxed, this becomes an open question again.

### 8, CORRECTED — 2026-08-09, same branch, before merge

**This section is left as originally written above, for the same reason §2.1's correction gives: this
document is a record of what was designed, not a rewrite of history.** The risks above were written
against a 1,500 cap and a 1,930 first-print ceiling; neither is what shipped, so a reader consulting
this section for the shipped risk picture needs the update §2.1 already got.

- **The shipped cap is 1,000, not 1,500, and its basis is not 1,930 but the steady-state measurement in
  §2.1, CORRECTED:** one worker, repeated prints, held for 60 reps at n=1,400 and below, failed by the
  fourth or fifth rep at n=1,497. The ceiling therefore lies somewhere in **[1400, 1497)** — nothing
  between those two depths was sampled, so no single number in that range is itself a measured ceiling,
  only the bracket is. 1,000 sits below that whole bracket.
- Where the risk above says `build:wasm:dev` "has a lower ceiling than 1,500's basis" and "the 22%
  margin is the mitigation": read both against 1,000 and the [1400, 1497) bracket instead. The basis and
  the margin changed with the cap; the tripwire remains the detector either way.
- Where the risk above says "1,930 is one machine's Chromium": 1,930 is that machine's Chromium's
  FIRST-PRINT ceiling specifically. The figure the shipped cap is actually margined against, the
  [1400, 1497) bracket, carries the identical caveat — one machine's Chromium, measured only at the
  depths in §2.1, CORRECTED's table — and worker stack sizes remain unspecified by any standard either
  way.
