# PR 3c — `web/`, the first real consumer

**Status: designed, not built.** Amends
[`2026-08-05-plan4-viewmodels-and-wasm-design.md`](2026-08-05-plan4-viewmodels-and-wasm-design.md)
§6 with the decisions that document deferred, and consumes the boundary
[`2026-08-06-wasm-boundary-completion-design.md`](2026-08-06-wasm-boundary-completion-design.md)
completed. Roadmap:
[`../plans/2026-07-19-redextape-roadmap.md`](../plans/2026-07-19-redextape-roadmap.md), Plan 4.

**This is the last PR in Plan 4's five-PR landing order** — the wasm32 gate, `viewmodel.rs`,
`crates/redextape-wasm` (3a), the boundary completion (3b), and this. It is also the first slice in
the project that a human can click.

## 0. Why this slice, and why now

Everything below the boundary is built and tested and has no consumer. §6 of the plan-4 design
settled the stack and the CodeMirror integration path a fortnight before the boundary existed; three
questions it could not answer then are answerable now, because 3b shipped the exports and #15 closed
the `lambdaAst` hazard that gated this PR.

The slice's purpose is narrow and worth stating so it is not quietly widened: **prove that the
decoration path and the lint path work end to end against real core output.** The λ and TM panes,
click-linking, dual-focus highlight, detach-on-edit and the caps affordance are Plan 5 (§6.3). What
lands here is one editable source pane and a results readout.

**One question this slice was expected to answer, and deliberately does not.** The roadmap's PR #15
entry says *"`lambdaAst` still has no v1 consumer — PR 3c is the first slice that can say whether an
arena is the shape a renderer actually wants."* Under §6.3's scope nothing here calls `lambdaAst`, so
that verdict moves to Plan 5 unanswered. Recorded rather than silently skipped: the alternative was
building a throwaway tree view purely to have an opinion, and a throwaway consumer's opinion is not
evidence about a real one.

## 1. Decisions taken

| # | decision | §  |
| --- | --- | --- |
| 1 | Scope holds at §6.3 — source pane plus plain-text results; no `lambdaAst` consumer | §0 |
| 2 | **Hybrid threading**: `classifySource`/`analyze` synchronous on the main thread, the `Session` in a Web Worker | §3 |
| 3 | Compile+run is **debounced auto-run** at 300 ms, superseded runs abandoned inside the worker | §3.2 |
| 4 | The worker **yields between λ chunks** rather than being terminated on supersede | §3.3 |
| 5 | An **eighth wasm export, `encodings()`**, so the picker cannot drift from `encoding_kinds!` | §5 |
| 6 | A **deliberate minimal token set** — type scale, palette, light and dark — rather than CM6 defaults | §7 |
| 7 | Tests run in **two vitest projects**: node for pure logic, real Chromium for the end-to-end smoke | §8 |

## 2. Module boundaries

```
web/
├─ index.html
├─ package.json          packageManager: pnpm@11.20.0
├─ pnpm-lock.yaml
├─ vite.config.ts        vitest projects: node | browser(chromium)
├─ tsconfig.json
├─ biome.json
└─ src/
   ├─ main.ts            wiring only — build the editor, mount results, own the debounce
   ├─ types.ts           the wasm boundary's wire shapes, mirrored from Rust and pinned by browser tests
   ├─ protocol.ts        message types, shared by both threads (pure data)
   ├─ session-client.ts  main-side proxy: postMessage + generation counter
   ├─ session-worker.ts  worker entry — owns the Session handle
   ├─ spans.ts           classify_source's spans → ordered, in-bounds decoration ranges
   ├─ highlight.ts       spans → RangeSet<Decoration>, as a StateField
   ├─ diagnostics.ts     analyze()'s Diagnostic[] → CM6 lint ranges, the zero-width case handled
   ├─ lint.ts            Diagnostic[] → CM6 lint source
   ├─ results.ts         results view model → DOM
   └─ theme.ts           tokens: type scale, palette, light and dark, the .tok-* classes
```

**The split is drawn on one line: anything needing real wasm or a real DOM lives in `main.ts` and
`session-worker.ts`; everything else takes plain data.** `highlight.ts` receives a span array, not a
source string. `lint.ts` receives `Diagnostic[]`, not source. `session-client.ts`'s staleness logic is
separable from `postMessage`. `results.ts` receives a view model, not a `Session`.

That line is what makes §8's split possible at all. It is a testability boundary first and a tidiness
boundary second, and if a later change blurs it the test tier is what pays.

**The wasm package is built to repo-root `pkg/`, not `web/pkg/`.** The `Dockerfile`'s stage 2 copies
the stage-1 output to `/app/pkg` with the app at `/app/web`, so the app's import is `../pkg/…` and the
existing Dockerfile paths need no change. `/pkg/` is already in `.gitignore`.

Two wasm instantiations, deliberately: the main thread imports `pkg` for `classifySource` and
`analyze` only; the worker imports it for `compile` and the `Session`. The binary is ~605 KB and is
byte-code-cached by the browser, so the second instantiation is a memory cost, not a download.

## 3. Threading and data flow

### 3.1 Why hybrid rather than all-main-thread or all-worker

CodeMirror computes decorations in a `StateField` **synchronously**, during the state update. Putting
`classifySource` behind a worker makes every keystroke's highlight arrive a round trip late — a visible
lag on the exact feature this slice exists to prove.

`compile()`, meanwhile, is one uninterruptible call **and it runs the entire TM leg inside it**
(`Session::compile` performs `run_tm_fitted` and stores `final_tapes`). On the main thread that janks
the tab for an unmeasured duration.

`classifySource` and `analyze` are free functions, not `Session` methods, so they can be split from
it. The hybrid takes the sync path for the two that need it and the worker for the one that blocks.

**This argument was measured for `classifySource` and was NOT measured for `analyze`, until a
post-review fix made it true.** `classifySource`'s same-frame placement is pinned by
`tests/browser/app.test.ts`, which asserts the highlight with no `await` between keystroke and
decoration — a worker round trip really would arrive a frame late. `analyze` shipped wired through
`lint.ts`'s bare `linter(fn)` call, which — unset — takes `@codemirror/lint`'s own default `delay` of
**750 ms**, re-armed on every document change (`lintConfig`'s facet `combine`,
`@codemirror/lint/dist/index.js`). At 750 ms a ~1 ms `postMessage` round trip is invisible inside the
debounce, so for `analyze` specifically this section's latency argument held by construction rather
than by anything the placement itself bought — the library's own default made the placement moot, and
the results pane and the lint gutter disagreed on screen in the meantime (results at `main.ts`'s 300 ms
debounce, markers at 750 ms). Fixed by passing `{ delay: 100 }` explicitly (`lint.ts`), which restores
the argument rather than having ever quietly relied on it.

**The now-trimmed half of this argument used to also claim the worker path "forces a second transaction
to apply it."** It does not distinguish the two placements: the built code dispatches a second
transaction for `classifySource`'s result on the main thread too, deliberately, because §2's
testability boundary requires `highlight.ts` to take a span array rather than a source string. The
round-trip half of the argument stands on its own without it.

### 3.2 Per keystroke, and on the debounce

```
doc change ─┬─▶ classifySource(doc) ─▶ spans          ─▶ StateField ─▶ decorations   [sync]
            ├─▶ analyze(doc)        ─▶ Diagnostic[]   ─▶ lint markers                [sync]
            └─▶ [300 ms debounce] ─▶ gen++ ─▶ post {gen, src, encoding} to the worker
```

`analyze` runs on the main thread even though `compile` returns the same diagnostics, because lint
markers must appear while the program is mid-edit and unparseable — the same reason `classifySource`
takes no session. The worker's diagnostics are used only to decide whether a session exists.

### 3.3 In the worker

```
on message {gen, src, encoding}:
  latest = gen
  previousSession?.free()           ← wasm-bindgen handles are not GC'd; free explicitly
  {diagnostics, session} = compile(src, encoding)
  if (!session) → post {gen, diagnostics, session: null}; return
  loop {
    status = session.runLambda(50_000)
    await yieldToWorkerEventLoop()  ← lets a newer message land
    if (latest !== gen) → return    ← superseded: abandon, keep the wasm instance
  } while (status === "Running")
  post {gen, λ leg, TM leg}
```

**The worker yields between chunks rather than being terminated.** Terminating on supersede would
discard the wasm instance and pay a fresh instantiation on every superseded edit — and with a 300 ms
debounce, supersession is the common case, not the rare one. Yielding costs one macrotask per 50,000
β-steps, which `session.rs:422`'s own doc prices at ~100 crossings for a full 5,000,000-step run.

**`compile()` stays uninterruptible, and that is now harmless rather than merely accepted.** Off the
main thread it can only delay the *next* result; it can never block input, highlighting, or linting.
This is the gap the roadmap handed forward from PR 3b — *"`evaluate()` runs with a 5,000,000-step
default budget in one uninterruptible call"* — closed by placement rather than by chunking. The same
placement covers `compile`, which the roadmap entry did not name but which has the same shape.

**The main thread drops any reply whose `gen` is not current.** Two mechanisms guard the same hazard
at two layers on purpose: the worker abandons superseded work so it does not compute results nobody
wants, and the client discards superseded replies so a race that slips past the first cannot render
stale output. Neither alone is sufficient — the worker's check happens only at a chunk boundary, and
a reply posted just before a new request arrives is already in flight.

### 3.4 `evaluate()` is not called

The reference-interpreter leg is not part of §6.3's readout. The λ and TM legs each decode their own
answer through `lambdaValue()` / `tmValue()`, which is what "decoded value" means here. `evaluate`
and `evaluateWithBudget` stay unconsumed in this slice; the three-way oracle they serve is a test
concern, not a v1 UI one.

## 4. What the results pane shows

| row | source |
| --- | --- |
| λ availability, refusal reason, offending node | `lambdaStatus()` → `{available, reason, node, run}` |
| λ normal form, as text | `lambdaState(65536)` → `{text, spans, truncated, step}` |
| λ β-steps | `lambdaState().step` |
| λ value | `lambdaValue()` → `Value{text}` / `Undecodable` / `Unfinished` / `Fault{message}` |
| TM availability, refusal reason | `tmStatus()` → `{available, reason, width, run, …}` |
| TM fitted width | `tmStatus().width` |
| TM δ-steps, whole run | `tmStatus().total_steps` — **not** the cursor's `run` |
| TM value | `tmValue()` |

**`total_steps` is a length only when the machine reached a final configuration, and `run` is NOT how
you tell.** Its doc says the field is the cap it stopped at rather than a length for a `HitCap` run,
which is right — but `run` reports where the **cursor** stands, and this slice never steps the TM
cursor. So `run` reads `"Running"` for a run `compile` already finished. `browser.rs` asserts exactly
that pair: `total_steps == 2870` alongside `run == "Running"`.

**The signal is `tmValue()`.** It answers `Unfinished` precisely when there is no final configuration
anywhere — no halted run recorded at compile time and a cursor that has not halted either. So:

| `tmValue()` | `total_steps` means | wording |
| --- | --- | --- |
| anything but `Unfinished` | the completed run's length | `2,870 δ-steps` |
| `Unfinished` | the count at which it hit a cap | `stopped after 2,870 δ-steps at a cap` |

The capped wording deliberately does not name **which** cap. `TmCursor` caps on the step budget and on
the live-cell budget, `trace.rs` says no test can tell those two apart, and under the cell cap
`total_steps` lands well below `caps.steps` — so a message like "the 2,870-step cap" would be a guess
presented as a fact.

`LambdaStatus` has no counterpart and the asymmetry is deliberate: `compile` already ran the machine,
so the TM's length is known at compile time, while the λ cursor has not reduced anything yet. λ's step
count comes from `lambdaState().step`, which moves as the run advances.

**§6.3 says "normal form" for both legs, and the TM leg has no text normal form.** Its end state is a
set of tapes, and rendering tapes is Plan 5's job. Read literally, §6.3 would have this slice build a
tape view it also says is out of scope. The resolution taken here: **λ shows normal-form text; TM
shows fitted width, δ-step count and decoded value; both show status and reason when they decline.**
Recorded as an amendment rather than an interpretation, because the sentence is ambiguous and the next
reader should not have to re-derive which way it was resolved.

`lambdaState`'s `byte_budget` is **65,536**. Truncation renders the returned text followed by
`… truncated at 64 KiB` — the text is shown rather than suppressed, because unlike `lambdaAst`'s
`None` a truncated *printed* term is not a lie about the term's shape, it is a prefix of it, and
`lambdaValue()` is unaffected either way.

The λ chunk size is **50,000** β-steps, the figure `session.rs:422`'s doc uses.

## 5. The eighth export: `encodings()`

`compile(src, encoding)` takes an encoding name and `EncodingKind::parse` rejects anything else, but
**nothing exports the valid set to JavaScript.** A picker in TypeScript would hardcode
`["unary", "binary"]` — reintroducing, one language over, exactly the drift the `encoding_kinds!`
macro was written to prevent. `header.rs`'s own comment states the problem: *"nothing in stable Rust
compares a written-out list against the variant set."* A hand-written list in TypeScript is worse
still, because not even the compiler is watching.

```rust
/// Every encoding name `compile` accepts, from `EncodingKind::ALL`.
#[wasm_bindgen]
pub fn encodings() -> Result<JsValue, JsValue> {
    to_value(&EncodingKind::ALL.iter().map(|k| k.name()).collect::<Vec<_>>())
}
```

Generated from the same macro rows as `ALL`, `name` and `parse`, so a third encoding appears in the
picker with no TypeScript edit. This makes the boundary **eight exports, not seven**, and it is a Rust
change inside a PR otherwise scoped to `web/` — stated plainly, because a scope change that lands
unremarked is the defect class the roadmap's PR 3b entry called out by name.

The picker sits in the header bar and defaults to the first name `encodings()` returns.

## 6. Error handling

All five refusal kinds from the plan-4 design's §7 reach the UI distinctly. None are flattened.

| refusal | surface |
| --- | --- |
| `analyze()` Error-severity diagnostics | gutter marker + underline; results read "not compiled" |
| `LowerError::{StatefulClosure, Unsupported, TooDeep}` | λ row shows `reason`; `node` → `sourceSpan(node)` highlights the source range |
| `TmRun::TooLarge`, TM `LowerError` | TM row shows `reason`, no width |
| `TmRun::Overflow` | TM row shows "a value does not fit the encoding at any width up to the ceiling", no width |
| `RunStatus::Capped` | shown as a spent budget that *could* be continued |
| `RunStatus::DepthRefused` | shown as a refusal that raising the cap provably cannot lift |
| `Decoded::Fault{message}` | shown as a fault, not as an empty value |
| `Decoded::Undecodable` | shown as "no encoding for this type", not as an empty value |
| `truncated: true` | text plus `… truncated at 64 KiB` |

**`Capped` and `DepthRefused` are worded differently and neither gets a button.** The caps affordance
is Plan 5 (§6.3). The distinction is still surfaced in words, because `RunStatus` exists precisely so
a renderer can tell a run that can be continued from one that cannot, and collapsing them in the text
would waste the split one layer up.

`Severity` has two variants, `Error` and `Warning`, and both map to CM6 severities rather than being
folded into one.

## 7. The source pane and its tokens

`classify_source` reaches **six** of `TokenClass`'s fourteen variants: `Nat`, `Ident`, `Bool`,
`Keyword`, `Operator`, `Punct`. The other eight — `Comment`, `Binder`, `Mnemonic`, `Register`,
`Label`, `StateName`, `TapeSymbol`, `Move` — belong to the λ text form and the asm/TM text forms,
which this pane never renders. (`Comment` is unreachable from `class_of` at all today; the source
lexer emits no comment token.)

**All fourteen still get a CSS class.** Six are tuned; the rest inherit a neutral default. Defining
only the reachable six would leave a future λ pane rendering unstyled spans with no signal that
anything was missing, and the cost of the other eight is eight lines.

Tokens: a type scale, spacing and radius steps, and a palette defined against
`prefers-color-scheme` in both directions. This is a foundation for Plan 5, not a visual identity —
the results readout stays plain text.

The decoration path re-tokenizes the whole document on every change; §6.2 of the plan-4 design records
this as a known limitation and prices it at microseconds for a source file, with a large `.tm`
document as the case that would matter. This slice's only editor is the source pane, so it is not hit
here.

## 8. Testing

Two vitest projects in one `vite.config.ts`.

**`node`** — no DOM, no wasm. `@codemirror/state` is DOM-free, which is what lets the decoration
builder be tested without a browser:

- `highlight.ts` — spans → `RangeSet`: sorted, non-overlapping, empty document yields an empty set
- `lint.ts` — `Diagnostic` → `{from, to, severity, message}`, both severities
- `session-client.ts` — a stale generation is dropped, the current one applied, out-of-order replies
- `protocol.ts` — request/response round-trip against a mocked port
- `results.ts` — each row of §6's table renders its expected text, and `total_steps` is worded as a
  length or as a cap according to `tmValue()`, not according to `run` (§4)

**`browser`** — real Chromium via Playwright. The end-to-end path no unit test can reach, because it
needs wasm, a worker, and a real contenteditable at once:

- type `let x = 40; x + 2` → `.tok-kw` lands on `let`; results show the λ and TM values and both step
  counts
- type a syntax error → lint underline appears and the results pane reads "not compiled"
- a program the λ backend refuses → λ row shows its reason, TM row still answers

The browser tier is the same philosophy as the existing `rust-browser` job: the wasm boundary is
tested where it actually runs. It costs a `playwright install chromium` step in CI.

**There is no coverage threshold on `web`.** The `gate` job requires the `web` job to succeed and
nothing more, so the test list above is a judgment about what is worth pinning, not a number to hit.

## 9. Toolchain migration and CI

```
Dockerfile   stage 2: node:26-slim + pnpm@11.20.0 pinned and installed explicitly
                      COPY web/package.json web/pnpm-lock.yaml
                      npm ci        → pnpm install --frozen-lockfile
                      npm run build → pnpm run build
ci.yml web:           npm ci        → pnpm install --frozen-lockfile
                      npx biome ci  → pnpm exec biome ci
                      npm run X     → pnpm run X
                      cache ~/.npm keyed on package-lock.json
                           → pnpm store keyed on pnpm-lock.yaml
                      + pnpm exec playwright install --with-deps chromium
detect:               unchanged — still gates on web/package.json
```

pnpm is pinned by a `packageManager` field *and* installed at a pinned version in both images, rather
than relying on corepack being bundled. **Why pnpm over npm** is the plan-4 design's §6.4: npm's flat
install permits importing an undeclared package that happens to be a transitive dependency, until a
version bump moves it; pnpm's symlinked layout makes that a hard error. Same shape as §2's gate — a
mechanical check replacing a rule nobody enforces.

Two build details:

- `vite.config.ts` needs `server.fs.allow: ['..']`, because `pkg/` sits outside the Vite root.
- `pnpm run build` must invoke `wasm-pack` before `vite build`. The CI step's existing comment
  (*"Build (invokes wasm-pack, then the bundler)"*) already assumes this; the `package.json` scripts
  are where it becomes true.

Package versions are the plan-4 design's §6.1 table, verified against the registries on 2026-08-05.
**The implementation plan re-verifies them rather than trusting a two-day-old table**, and records any
that moved.

**Landing `web/package.json` arms the `docker` job.** That job is conditioned on
`github.event_name != 'pull_request'`, not on a tag, so every push to `main` thereafter builds and
pushes an image to `forge.daveynet.xyz`. §6.5 records this as intended and confirmed; it is restated
here because it is the one irreversible side effect of the merge. The buildx-collision hazard the
job's own comment describes was already resolved by the per-repo builder name from PR #2.

## 10. Considered and not taken

**All-main-thread, chunked.** Everything sync, λ driven by a yielding chunk loop. Smallest possible
slice and it is what `session.rs:422` prescribes for a caller — but it leaves `compile()` blocking the
main thread for the whole TM run, and that gap would have been re-recorded for Plan 5 rather than
closed. Rejected for the reason the hybrid exists: the cost of closing it is a small message protocol.

**All-in-a-worker.** One owner for every wasm call, no split-brain about which thread holds what.
Rejected because the `Session` handle is opaque and cannot cross `postMessage`, so the worker would
own `classifySource` too, and highlighting would lag a round trip behind typing — degrading the one
feature the slice exists to prove in order to tidy the one that already works.

**A `worker.terminate()` on supersede.** Simpler to write than a generation check inside the worker,
and it gives hard cancellation of an in-flight `compile()`. Rejected because with a 300 ms debounce
supersession is the common case, and paying a fresh wasm instantiation on every superseded keystroke
is a worse trade than one macrotask per 50,000 β-steps. Reconsider if `compile()` is ever measured
long enough that abandoning only at a chunk boundary is too coarse.

**A minimal `lambdaAst` consumer, to settle the arena question.** §0 says why not: a throwaway
renderer's opinion about whether a `u32`-index arena suits a real renderer is not evidence about a
real one, and building one would widen a slice whose scope §6.3 fixed deliberately.

**Hardcoding the encoding list in TypeScript.** §5. Rejected in favour of an eighth export.

**A `jsdom` middle tier for the CM6 view layer.** Cheaper than Chromium, but jsdom's `Range` and
`contenteditable` support is partial, CM6 tests there are known-fiddly, and it still cannot load the
wasm worker — so it would add a flaky tier that closes none of the gap the browser tier closes.

## 11. Landing order

One PR. The pieces are not independently useful: `web/` without the pnpm migration does not build in
CI, and the migration without `web/` changes nothing (`detect` gates on `web/package.json`).

Within the PR the build order is forced — `encodings()` before the picker, `protocol.ts` before both
sides of it, `theme.ts` before the decoration classes mean anything — and the implementation plan is
where that becomes a task sequence. The pre-commit gate runs clippy with `-D warnings` on every
commit, so the Rust half of §5 must be complete and clean in whatever commit contains it.

## 12. Open risks

1. **`compile()`'s wall-clock is unmeasured.** Off the main thread it cannot block input, but a
   TM-heavy program still delays the results pane by an unknown amount with only a "running…" state to
   show for it. Measuring it is cheap once there is a UI to measure from, and the answer decides
   whether §10's terminate-on-supersede should be reconsidered.
2. **The `lambdaAst` verdict is deferred, not answered** (§0). It travels to Plan 5, which is also the
   slice that would act on a negative answer by reopening the deletion the arena design's §9.3 came
   close to taking.
3. **Two wasm instantiations doubles module memory.** ~605 KB of code plus two linear memories. Not
   expected to matter, and unmeasured.
4. **The browser test tier is new to this repo's `web` job.** `rust-browser` establishes the pattern
   for Rust, but Playwright in a `node:26-bookworm` container is not yet proven here; a first run that
   needs extra system packages is the likely friction.
5. **`TokenClass` is hand-copied into TypeScript and nothing checks it against the Rust enum.** §5
   exports `encodings()` precisely because that hand-copy was avoidable for encoding names; it is not
   avoidable here without a second export, and §6.3's scope does not carry one. Inside TypeScript the
   copy is self-consistent — the union is derived from the array, so the compiler catches any name the
   app uses that the array lacks — but a variant added to `analysis::TokenClass` and not mirrored
   arrives as an unstyled span rather than an error. The cheap close is a `tokenClasses()` export in
   the same shape as `encodings()`, deferred to whichever slice first needs it.
6. **`desugar_mapped`'s span attribution for synthesized nodes** is a judgment no renderer has yet
   exercised, and §6's `sourceSpan(node)` highlight is the first thing that will. If nearest-enclosing
   is wrong, the fix is local to `desugar.rs`. Carried forward from the plan-4 design's §11.4.
