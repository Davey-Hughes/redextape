# Plan 5a-i — the panes, and a history you can scrub

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `web/` from one source pane and a text readout into §6.1's three panes, each stepped forward and backward through a recorded, byte-budgeted frame history.

**Architecture:** The worker keeps its `Session` alive across messages, steps each leg one step at a time, and posts batches of rendered view models at yield boundaries. The main thread accumulates those frames in a byte-capped ring and owns the play head, so ◀ ▶ ⏵ ↺ are array arithmetic with no wasm call and no `postMessage`. Plain DOM throughout — no framework.

**Tech Stack:** Rust (`redextape-core`, `redextape-wasm`), TypeScript, Vite 8, CodeMirror 6, Vitest 4 (node + real-Chromium projects), Biome 2.5.7, pnpm 11.20.0.

Design: [`../specs/2026-08-07-plan5a-panes-and-history-design.md`](../specs/2026-08-07-plan5a-panes-and-history-design.md).
Measurements: `crates/redextape-core/examples/frame_cost_probe.rs`, commit `a382004`.

## Global Constraints

- **Never `--no-verify`.** `.pre-commit-config.yaml` runs `cargo fmt`, `cargo clippy` with `-D warnings`, `biome ci` and `tsc --noEmit` on every commit. A commit split that cannot pass the gate is infeasible; collapse the commits and say so.
- **No panic may cross the wasm boundary.** Every fallible export returns `Result<_, JsValue>`. `crates/redextape-core` lints `unwrap_used`, `expect_used`, `panic`, `todo`, `unimplemented` as warnings, denied in CI. Test code is exempt via `clippy.toml`; `tests/` and `examples/` targets need a file-level `#![allow(...)]`.
- **`redextape-core` must build for `wasm32-unknown-unknown`.** `scripts/check-all.sh`'s wasm leg checks it.
- **Every wire shape is measured, not designed.** A TypeScript type for a wasm return must be pinned by a test that reads it out of a real browser before anything consumes it.
- **`serde` does not rename.** Rust `snake_case` field names cross unchanged: `window_start`, `source_node`, `total_steps`.
- **Fieldless enum variants cross as the bare variant NAME; struct/tuple variants as a one-key object.**
- **`serialize_missing_as_null(true)`** is set once in `lib.rs::to_value`, so every `Option::None` arrives as `null`, never `undefined`.
- **Measured constants, from `frame_cost_probe`:** `FRAME_BYTES = 512`, `TM_RADIUS = 40`, `HISTORY_BYTES = 32 MiB`, `RECORD_CHUNK = 256`.
- **pnpm, not npm.** Run web commands from `web/`.
- A fresh clone needs `cd web && pnpm install && pnpm run build:wasm` once before `pnpm run dev` or `pnpm run typecheck` will work. **Every task that changes Rust must re-run `pnpm run build:wasm`** before the TypeScript that consumes it will typecheck or run.

---

## File Structure

```
crates/redextape-core/src/tm/build.rs     + TAPE_NAMES, + a test               T1
crates/redextape-core/src/tm.rs           + TAPE_NAMES to the re-export        T1
crates/redextape-wasm/src/lib.rs          + tapeNames() — the ninth export     T1
crates/redextape-wasm/tests/browser.rs    + pins for tapeNames                 T1

web/src/types.ts        + TmState, TmProgram, StateView, RuleView, Move        T2
web/src/protocol.ts     budgets, frame sizers, streaming message kinds         T3
web/src/history.ts      NEW  byte-budgeted ring + play head                    T4
web/src/tape.ts         NEW  one tape row from a window                        T5
web/src/controls.ts     NEW  which controls are live, and the step readout     T6
web/src/session-worker.ts  Session lifecycle, record loops, streaming          T7
web/src/session-client.ts  many replies per generation                         T8
web/src/banner.ts       NEW  the load-failure surface                          T9
web/src/lambda-pane.ts  NEW  λ text view + controls                            T10
web/src/tm-pane.ts      NEW  five tape rows + status line + controls           T10
web/index.html          the three-pane layout                                  T11
web/src/style.css       grid, panes, tape rows, controls                       T11
web/src/main.ts         wiring                                                 T11
web/tests/node/*.test.ts       history, tape, controls, protocol               T4-T6
web/tests/browser/*.test.ts    worker streaming, app end-to-end, frame cost    T7, T12
README.md, roadmap             the record                                      T13
```

**Dependency shape.** T1 → T2 → T3 → {T4, T5, T6, T9 in parallel} and T7 → T8 → T10 → T11 → T12 → T13. T4, T5, T6 and T9 touch disjoint files and depend only on T3's types; they are safe to run as one wave.

---

### Task 1: `tapeNames()` — the ninth export

**Files:**
- Modify: `crates/redextape-core/src/tm/build.rs` (add `TAPE_NAMES` after the five index constants at :22-26; add a test in the `mod tests` at :168)
- Modify: `crates/redextape-core/src/tm.rs:25-28` (the `pub use build::{…}` list)
- Modify: `crates/redextape-wasm/src/lib.rs` (add the export after `encodings()` at :76-79)
- Modify: `crates/redextape-wasm/tests/browser.rs`

**Interfaces:**
- Consumes: `redextape_core::tm::build::{TAPES, REG, WORK, STACK, HEAP, BOX}`
- Produces: `redextape_core::tm::TAPE_NAMES: [&str; 5]`; the wasm export `tapeNames(): string[]`

- [ ] **Step 1: Write the failing Rust test**

In `crates/redextape-core/src/tm/build.rs`, inside the existing `mod tests` block (starts at line 168), add:

```rust
    /// `TAPE_NAMES` is the display authority and the five constants are the code authority; nothing
    /// but this test stops them drifting apart. Indexing by the constant rather than by a literal is
    /// the whole point — a reordered array fails here rather than mislabelling a tape in the UI.
    #[test]
    fn tape_names_match_their_indices() {
        assert_eq!(TAPE_NAMES.len(), TAPES);
        assert_eq!(TAPE_NAMES[REG], "REG");
        assert_eq!(TAPE_NAMES[WORK], "WORK");
        assert_eq!(TAPE_NAMES[STACK], "STACK");
        assert_eq!(TAPE_NAMES[HEAP], "HEAP");
        assert_eq!(TAPE_NAMES[BOX], "BOX");
    }
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cargo test -p redextape-core --lib tm::build::tests::tape_names_match_their_indices
```
Expected: FAIL — `cannot find value 'TAPE_NAMES' in this scope`.

- [ ] **Step 3: Add the constant**

In `crates/redextape-core/src/tm/build.rs`, immediately after `pub const BOX: usize = 4;` (line 26):

```rust
/// The lowering's tape layout as display names, indexed by the five constants above.
///
/// A RENDERER NEEDS THIS AND `TmProgram` DOES NOT CARRY IT. `TmProgram` reports `tapes: usize` and no
/// names, so a five-row tape view either labels its rows from here or hardcodes five strings in
/// whatever language it is written in — which is the drift `encodings()` was exported to prevent, one
/// language further out.
///
/// IT DESCRIBES MACHINES THIS COMPILER PRODUCED, AND NOTHING ELSE. `Machine::tapes` is a runtime field
/// and `parse_tm` accepts a hand-written machine declaring up to `MAX_TAPES` (64), so a consumer must
/// label tape `i` positionally when `i >= TAPE_NAMES.len()` rather than assume every machine has five.
pub const TAPE_NAMES: [&str; TAPES] = ["REG", "WORK", "STACK", "HEAP", "BOX"];
```

- [ ] **Step 4: Re-export it**

In `crates/redextape-core/src/tm.rs`, add `TAPE_NAMES` to the `pub use build::{…}` list (lines 25-28), keeping the list alphabetically sorted as it already is — it goes between `STACK` and `TAPES`:

```rust
pub use build::{
    AT, BOX, Builder, HEAP, MARK, MAX_FIELD_WIDTH, MAX_TAPES, MIN_FIELD_WIDTH, REG, RuleSpec, SEP, STACK, Slot,
    TAPE_NAMES, TAPES, WORK, ZERO,
};
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cargo test -p redextape-core --lib tm::build::tests::tape_names_match_their_indices
```
Expected: PASS, 1 test.

- [ ] **Step 6: Add the wasm export**

In `crates/redextape-wasm/src/lib.rs`, immediately after `encodings()` (which ends at line 79):

```rust
/// The lowering's tape names, in tape order. The NINTH export.
///
/// EXPORTED RATHER THAN HARDCODED, for the reason `encodings()` gives one export up: a TypeScript
/// array of names is a second authoritative registry that not even the compiler is watching. Five
/// unlabeled tape rows are unreadable, so the UI needs names; this is where they come from.
///
/// A CONSUMER MUST NOT TREAT ITS LENGTH AS EVERY MACHINE'S TAPE COUNT. These name the tapes THIS
/// compiler emits. `tmProgram().tapes` is the count for the machine in hand, and Plan 5d's
/// hand-written machines may declare up to `MAX_TAPES`. Label tape `i` with `names[i]` when one
/// exists and positionally otherwise — see `TAPE_NAMES`' own doc.
#[wasm_bindgen(js_name = tapeNames)]
pub fn tape_names() -> Result<JsValue, JsValue> {
    to_value(&redextape_core::tm::TAPE_NAMES)
}
```

- [ ] **Step 7: Pin it in the browser test**

In `crates/redextape-wasm/tests/browser.rs`, add a new `#[wasm_bindgen_test]` function. Place it beside the existing `encodings` test — find it with `grep -n "encodings" crates/redextape-wasm/tests/browser.rs` and add after that function:

```rust
/// `tapeNames` crosses as an array of strings, and its length is the lowering's `TAPES`.
///
/// PINNED SEPARATELY FROM `tmProgram().tapes` ON PURPOSE. They agree for a compiled machine and are
/// different facts — one is this compiler's convention, the other is the machine in hand — so a test
/// that read only one would not notice the two coming apart.
#[wasm_bindgen_test]
fn tape_names_are_five_strings_in_tape_order() {
    let names: Array = redextape_wasm::tape_names().expect("tapeNames returns Ok").unchecked_into();
    assert_eq!(names.length(), 5, "the lowering emits five tapes");
    assert_eq!(names.get(0).as_string().as_deref(), Some("REG"));
    assert_eq!(names.get(4).as_string().as_deref(), Some("BOX"));
}
```

If the existing `encodings` test uses a different call convention (a `call(&…)` helper rather than a direct path), match that convention instead — read the surrounding function before writing this one.

- [ ] **Step 8: Run the whole Rust gate**

```bash
cargo test -p redextape-core --lib
wasm-pack test --headless --chrome crates/redextape-wasm
```
Expected: core lib tests pass; wasm browser suite **13/13** (12 before this task).

Chrome lives in `/usr/sbin` on this host and is off `PATH` for non-login shells. If `wasm-pack` reports no browser, prefix the command with `PATH="$PATH:/usr/sbin"`.

- [ ] **Step 9: Rebuild the wasm package**

```bash
cd web && pnpm run build:wasm
```
Expected: `wasm-pack` succeeds and `pkg/redextape_wasm.d.ts` now declares `tapeNames`.

- [ ] **Step 10: Commit**

```bash
git add crates/redextape-core/src/tm/build.rs crates/redextape-core/src/tm.rs \
        crates/redextape-wasm/src/lib.rs crates/redextape-wasm/tests/browser.rs
git commit -m "wasm: tapeNames(), so five tape labels cannot drift from build.rs"
```

---

### Task 2: The wire shapes the panes consume

**Files:**
- Modify: `web/src/types.ts`
- Test: `web/tests/browser/shapes.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's `tapeNames()`
- Produces:
  - `type Move = 'L' | 'R' | 'S'`
  - `type RuleView = { read: (string | null)[]; write: (string | null)[]; moves: string[]; next: number }`
  - `type StateView = { name: string; accept: boolean; rules: RuleView[] }`
  - `type TmProgram = { states: StateView[]; alphabet: string[]; tapes: number; width: number; start: number }`
  - `type TmState = { state: number; step: number; heads: number[]; window_start: number[]; window: string[][]; source_node: number | null }`

- [ ] **Step 1: Write the failing browser test**

Create `web/tests/browser/shapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import init, { compile, tapeNames } from '../../../pkg/redextape_wasm.js'
import type { TmProgram, TmState } from '../../src/types'

/// EVERY SHAPE IN `types.ts` IS MEASURED HERE, NOT DESIGNED. `pkg`'s generated declarations type each
/// method's return as `any`, so the only thing standing between a wrong TypeScript type and a runtime
/// surprise is a test that reads the value out of a real browser.
type Session = {
  tmProgram(): TmProgram
  tmState(radius: number): TmState
  stepTm(): boolean
  free(): void
}

describe('wire shapes', () => {
  it('tapeNames is five strings in tape order', async () => {
    await init()
    const names = tapeNames() as string[]
    expect(names).toEqual(['REG', 'WORK', 'STACK', 'HEAP', 'BOX'])
  })

  it('tmProgram and tmState arrive in the shapes types.ts declares', async () => {
    await init()
    const { session } = compile('let x = 40; x + 2', 'unary') as { session: Session | null }
    expect(session).not.toBeNull()
    if (!session) return

    const program = session.tmProgram()
    expect(program.tapes).toBe(5)
    expect(program.width).toBe(64)
    expect(program.states.length).toBe(123)
    expect(typeof program.states[0]?.name).toBe('string')
    expect(typeof program.states[0]?.accept).toBe('boolean')
    expect(Array.isArray(program.alphabet)).toBe(true)

    // A rule's `read`/`write` are `Option<Symbol>` per tape — wildcards arrive as null, NOT undefined,
    // because `to_value` sets `serialize_missing_as_null`.
    const ruled = program.states.find((s) => s.rules.length > 0)
    expect(ruled).toBeDefined()
    const rule = ruled?.rules[0]
    expect(rule?.read.length).toBe(5)
    expect(rule?.moves.length).toBe(5)
    expect(rule?.read.every((r) => r === null || typeof r === 'string')).toBe(true)
    expect(typeof rule?.next).toBe('number')

    // The cursor starts at step 0 — `compile` ran the TM leg, but the CURSOR is untouched.
    const first = session.tmState(40)
    expect(first.step).toBe(0)
    expect(first.window.length).toBe(5)
    expect(first.heads.length).toBe(5)
    expect(first.window_start.length).toBe(5)
    // snake_case survives: serde does not rename.
    expect('window_start' in first).toBe(true)
    expect('source_node' in first).toBe(true)

    session.stepTm()
    const second = session.tmState(40)
    expect(second.step).toBe(1)
    // A cell is a one-character string — `Symbol` is `char` in Rust.
    for (const cell of second.window[0] ?? []) expect(cell.length).toBe(1)

    session.free()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && pnpm run test:browser
```
Expected: FAIL — `web/src/types.ts` has no `TmProgram` or `TmState` export, so `tsc`/vite cannot resolve the import.

- [ ] **Step 3: Add the shapes**

Append to `web/src/types.ts`:

```ts
/// A head move, as `viewmodel::move_text` prints it.
///
/// A STRING UNION RATHER THAN AN ENUM, because `RuleView.moves` is `Vec<String>` on the Rust side —
/// the projection stringifies `Move` during `TmProgram::of`, so nothing structured survives to mirror.
export type Move = 'L' | 'R' | 'S'

/// One transition. `read`/`write` carry one entry PER TAPE, and `null` is a wildcard — `RuleSpec`
/// defaults every untouched tape to (wildcard read, unchanged write, Stay), which is what lets a
/// gadget name only the tapes it touches.
export type RuleView = { read: (string | null)[]; write: (string | null)[]; moves: string[]; next: number }

export type StateView = { name: string; accept: boolean; rules: RuleView[] }

/// The machine, projected ONCE per compile and never per step. `TmProgram::of`'s doc records why:
/// the `map` demo is 3,203 states over 344,999 steps, and re-projecting per frame is the cost this
/// split exists to avoid.
export type TmProgram = { states: StateView[]; alphabet: string[]; tapes: number; width: number; start: number }

/// One configuration, windowed. `heads` AND `window_start` ARE BOTH MATERIALIZED-TAPE COORDINATES,
/// not window-relative ones: the head's position inside `window[i]` is `heads[i] - window_start[i]`,
/// which is `tape.ts`'s whole job and is node-tested there.
///
/// `source_node` is honestly `null` for machine scaffolding, `defunc`-minted constructs, and any state
/// this lowering did not produce. It has no consumer until 5b.
export type TmState = {
  state: number
  step: number
  heads: number[]
  window_start: number[]
  window: string[][]
  source_node: number | null
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd web && pnpm run test:browser
```
Expected: PASS. Browser project: **12 tests** (10 before this task, +2 here).

If `program.states.length` is not 123 or `program.width` is not 64, **the plan's figures are stale, not the code** — take the real numbers from the failure, correct them here, and record the correction in the progress ledger. `crates/redextape-wasm/tests/browser.rs:216-221` is where these came from.

- [ ] **Step 5: Typecheck and lint**

```bash
cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings src tests
```
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/types.ts web/tests/browser/shapes.test.ts
git commit -m "web: the five wire shapes the panes consume, pinned in real Chromium"
```

---

### Task 3: The protocol — budgets, frame sizers, streaming

**Files:**
- Modify: `web/src/protocol.ts`
- Modify: `web/src/session-worker.ts` (one import line and one use — see Step 5)
- Modify: `web/src/main.ts` (one guard line — see Step 5)
- Test: `web/tests/node/protocol.test.ts` (create)

**Why this task touches three files when it is about one.** `pre-commit` runs `tsc --noEmit` over the whole project on every commit, so there is no intermediate state where `protocol.ts` has changed and its two consumers have not. Both edits are small, both are correct for the interim rather than provisional, and later tasks replace them wholesale. This is the "collapse the split and say so" case the Global Constraints describe — not scope creep.

**Interfaces:**
- Consumes: Task 2's `TmProgram`, `TmState`
- Produces:
  - `FRAME_BYTES = 512`, `TM_RADIUS = 40`, `HISTORY_BYTES`, `RECORD_CHUNK = 256`, `SPAN_BYTES = 80`, `EXTEND_STEPS`, `EXTEND_CELLS`
  - `lambdaFrameBytes(f: LambdaState): number`, `tmFrameBytes(f: TmState): number`
  - `type RecordEnd = 'ended' | 'capped' | 'depth-refused' | 'budget'`
  - `type Leg = 'lambda' | 'tm'`
  - `RunRequest` gains `{ kind: 'extend'; gen: number; leg: Leg }`
  - `RunReply` gains `compiled`, `lambda-frames`, `tm-frames`

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { lambdaFrameBytes, SPAN_BYTES, tmFrameBytes } from '../../src/protocol'
import type { LambdaState, TmState } from '../../src/types'

const lam = (text: string, spans: number): LambdaState => ({
  text,
  spans: Array.from({ length: spans }, (_, i) => [{ start: i, end: i + 1 }, 'Ident'] as const) as LambdaState['spans'],
  truncated: false,
  step: 0,
})

const tm = (tapes: number, cells: number): TmState => ({
  state: 0,
  step: 0,
  heads: Array.from({ length: tapes }, () => 0),
  window_start: Array.from({ length: tapes }, () => 0),
  window: Array.from({ length: tapes }, () => Array.from({ length: cells }, () => '_')),
  source_node: null,
})

describe('frame sizers', () => {
  // `frame_cost_probe` measured ~95% of a λ frame as SPANS, at every text budget: 261 bytes of text
  // serialized to 5,621. A sizer that counted only `text` would under-report by ~20x and the ring
  // would evict far too late.
  it('counts spans, which dominate a λ frame', () => {
    const textOnly = lambdaFrameBytes(lam('x'.repeat(100), 0))
    const withSpans = lambdaFrameBytes(lam('x'.repeat(100), 50))
    expect(withSpans - textOnly).toBe(50 * SPAN_BYTES)
    expect(withSpans).toBeGreaterThan(textOnly * 10)
  })

  it('scales a λ frame with its text', () => {
    expect(lambdaFrameBytes(lam('x'.repeat(200), 0)) - lambdaFrameBytes(lam('x'.repeat(100), 0))).toBe(100)
  })

  it('counts a TM frame by its cells across every tape', () => {
    // Five tapes at radius 40 is at most 5 x 81 cells; the probe measured ~550 bytes a frame there.
    const small = tmFrameBytes(tm(5, 10))
    const large = tmFrameBytes(tm(5, 20))
    expect(large).toBeGreaterThan(small)
    expect(tmFrameBytes(tm(5, 81))).toBeLessThan(2_000)
  })

  it('never reports a frame as free', () => {
    expect(lambdaFrameBytes(lam('', 0))).toBeGreaterThan(0)
    expect(tmFrameBytes(tm(0, 0))).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && pnpm run test:node
```
Expected: FAIL — `lambdaFrameBytes` is not exported from `protocol.ts`.

- [ ] **Step 3: Rewrite `protocol.ts`**

Replace the whole of `web/src/protocol.ts` with:

```ts
import type { Decoded, Diagnostic, LambdaState, LambdaStatus, Span, TmProgram, TmState, TmStatus } from './types'

/// The λ printer's byte budget FOR THE READOUT — the one term a user actually reads.
///
/// Truncation is shown, not hidden — see `results.ts`. Frames use `FRAME_BYTES` instead, and the two
/// being different is a measured decision, not an oversight: see `FRAME_BYTES`.
export const LAMBDA_BYTE_BUDGET = 65_536

/// The λ printer's byte budget FOR A HISTORY FRAME.
///
/// MEASURED, and the measurement moved it two orders of magnitude below the readout's budget
/// (`frame_cost_probe`, 2026-08-07). Dropping from 65,536 to 512 made rendering 10-31x faster and
/// frames ~22x smaller — `while4` went 59.67 -> 5.77 us/step and 229,528 -> 10,123 bytes/frame;
/// `list60` went 230.91 -> 7.40 us and 252,084 -> 11,464. `print_lambda_capped` short-circuits at the
/// budget, so speed and memory move together rather than trading against each other.
///
/// The thousandth term nobody will look at does not need the budget the first one gets.
export const FRAME_BYTES = 512

/// The tape window's radius. MEASURED FLAT ON TIME: `TmState::window` costs 0.12-0.18 us/step at
/// radius 10 and at radius 80 alike, so this is a legibility and memory choice and nothing else.
/// 40 costs ~550 bytes a frame against 20's ~350, and the wider window is worth the 200 bytes.
export const TM_RADIUS = 40

/// The ring's cap, PER LEG. ~3,200 λ frames at ~10 KB, or ~58,000 TM frames at ~550 B.
///
/// It is also what bounds RECORDING, because a step count cannot: the probe measured the λ leg at
/// 555 steps and the TM leg at 266,863 for the SAME program (`map_fold`), so one step figure would
/// mean two different things. The worker stops when it has produced this many bytes and says so.
export const HISTORY_BYTES = 32 * 1024 * 1024

/// Steps recorded between worker yields. At `FRAME_BYTES = 512` the λ leg renders in ~4-7 us/step, so
/// 256 steps is one abandon check per ~1.5 ms of recording.
///
/// NOT `CHUNK_STEPS`, WHICH IS GONE. That was 50,000 β-steps between yields, correct when a chunk was
/// one `runLambda` call and wrong the moment a chunk became 50,000 renders — the yield loop would stop
/// being a yield loop and supersession could not be seen for seconds at a time.
export const RECORD_CHUNK = 256

/// One `(Span, TokenClass)` entry's cost, as an estimate.
///
/// AN ESTIMATE, AND THE ONE NUMBER HERE THAT IS NOT MEASURED IN THE UNITS IT IS SPENT IN. The probe
/// measured ~76 bytes per span as JSON; the real path builds a JS object per span, which costs more.
/// 80 is the JSON figure rounded up, and Task 12 measures the real one in Chromium. Over-estimating
/// is the safe direction: the ring evicts sooner than it must.
export const SPAN_BYTES = 80

/// What one `[continue]` buys. Additive and saturating on the Rust side, so a caller wanting more
/// clicks again.
export const EXTEND_STEPS = 100_000
export const EXTEND_CELLS = 100_000

export type Leg = 'lambda' | 'tm'

/// Why recording stopped. FOUR OUTCOMES, NOT THREE, and conflating any two of them is the trap
/// `session.rs:415` names one layer in ("A SPENT `budget` IS NOT A SPENT CAP"):
///
///   * `ended`        — the cursor is exhausted. Nothing to continue.
///   * `capped`       — the cursor's own cap. `[continue]` raises it.
///   * `depth-refused`— the depth guard. `raise_cap` REFUSES to clear it, so there is no continue.
///   * `budget`       — `HISTORY_BYTES`. The run is still `Running` and continuing costs nothing.
export type RecordEnd = 'ended' | 'capped' | 'depth-refused' | 'budget'

/// A λ frame's size in bytes.
///
/// SPANS ARE ~95% OF IT, at every text budget — `frame_cost_probe` measured 261 bytes of text
/// serializing to 5,621. `LAMBDA_BYTE_BUDGET` bounds `text` and bounds `spans` not at all, which is
/// why the design's first draft was wrong about a frame's maximum size by a factor of twelve.
export function lambdaFrameBytes(f: LambdaState): number {
  return 64 + f.text.length + f.spans.length * SPAN_BYTES
}

/// A TM frame's size in bytes. Cells dominate; the three index arrays are one number per tape.
export function tmFrameBytes(f: TmState): number {
  let cells = 0
  for (const tape of f.window) cells += tape.length
  return 64 + cells * 2 + f.heads.length * 8 + f.window_start.length * 8
}

export type RunRequest =
  | { kind: 'run'; gen: number; src: string; encoding: string }
  /// Record further. For a `capped` leg the worker raises the cursor cap first; for a `budget` leg it
  /// simply allows another `HISTORY_BYTES` and resumes.
  | { kind: 'extend'; gen: number; leg: Leg }

/// `declinedSpan` IS RESOLVED IN THE WORKER, not on the main thread, because `sourceSpan` is a
/// `Session` method and the handle never leaves that thread. `LambdaStatus.node` alone would be
/// useless to a renderer that cannot ask what source range it names.
export type LambdaLeg = {
  status: LambdaStatus
  state: LambdaState | null
  value: Decoded | null
  declinedSpan: Span | null
}
export type TmLeg = { status: TmStatus; value: Decoded | null }

export type RunReply =
  /// The program did not analyze, so there is no session at all.
  | { kind: 'no-session'; gen: number; diagnostics: Diagnostic[] }
  /// A session exists. Sent BEFORE any recording, so the panes can mount and show their declines
  /// while the legs are still being stepped.
  ///
  /// `tmProgram` IS SENT ONCE, HERE. It is ~123 states for `let x = 40; x + 2` and does not change
  /// as the cursor moves; putting it on every frame would send it 2,870 times.
  | {
      kind: 'compiled'
      gen: number
      lambda: LambdaStatus
      tm: TmStatus
      declinedSpan: Span | null
      tmProgram: TmProgram | null
      tapeNames: string[]
    }
  | { kind: 'lambda-frames'; gen: number; frames: LambdaState[]; done: RecordEnd | null }
  | { kind: 'tm-frames'; gen: number; frames: TmState[]; done: RecordEnd | null }
  /// Both legs interrogated after recording finished — what `results.ts` renders. Unchanged in shape
  /// from PR 3c so that module needs no edit.
  | { kind: 'result'; gen: number; lambda: LambdaLeg; tm: TmLeg }
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd web && pnpm run test:node
```
Expected: PASS. Node project: **42 tests** (38 before this task, +4 here).

- [ ] **Step 5: Carry the two consumers across, so the gate stays green**

Two files break the moment `protocol.ts` changes, and both fixes are correct for the interim rather than provisional. **Do not `--no-verify`.**

In `web/src/session-worker.ts`, `CHUNK_STEPS` no longer exists. Change the import to `import { LAMBDA_BYTE_BUDGET, RECORD_CHUNK } from './protocol'` and replace the one use of `CHUNK_STEPS` inside `drive()` with `RECORD_CHUNK`. Task 7 rewrites the file entirely; this is only to keep it compiling.

In `web/src/main.ts`, `RunReply` now has four members where the callback assumed two, so `reply.lambda` no longer typechecks. Add one guard as the first line of the `SessionClient` callback:

```ts
  const client = new SessionClient(worker, (reply: RunReply) => {
    // The panes do not exist yet, so the streaming replies have no consumer here. Task 11 replaces
    // this whole callback with a switch over every variant.
    if (reply.kind !== 'result' && reply.kind !== 'no-session') return
    results.dataset.state = 'idle'
    // …the rest of the callback unchanged…
```

- [ ] **Step 6: Run the full gate**

```bash
cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings src tests && pnpm test
```
Expected: all green. Node **42**, browser **12**.

- [ ] **Step 7: Commit**

```bash
git add web/src/protocol.ts web/src/session-worker.ts web/src/main.ts web/tests/node/protocol.test.ts
git commit -m "web: the streaming protocol, and six budgets the probe measured"
```

---

### Task 4: `history.ts` — the byte-budgeted ring

**Files:**
- Create: `web/src/history.ts`
- Test: `web/tests/node/history.test.ts`

**Interfaces:**
- Consumes: nothing but `protocol.ts`'s constants at the call site
- Produces: `class History<T>` with `push(frame: T, bytes: number): void`, `clear(): void`, `seek(i: number): void`, `back(): boolean`, `forward(): boolean`, and getters `length`, `head`, `oldestStep`, `newestStep`, `atFrontier`, `evicted`, `current`

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/history.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { History } from '../../src/history'

describe('History', () => {
  let h: History<string>
  beforeEach(() => {
    h = new History<string>(1_000)
  })

  it('starts empty with no current frame', () => {
    expect(h.length).toBe(0)
    expect(h.current).toBeUndefined()
    expect(h.atFrontier).toBe(true)
  })

  it('numbers the first frame step 0 — the state before any step', () => {
    h.push('a', 10)
    expect(h.oldestStep).toBe(0)
    expect(h.newestStep).toBe(0)
    h.push('b', 10)
    expect(h.newestStep).toBe(1)
  })

  it('follows the frontier as frames arrive', () => {
    h.push('a', 10)
    h.push('b', 10)
    expect(h.current).toBe('b')
    expect(h.atFrontier).toBe(true)
  })

  it('does not move the head off a scrubbed-back position when new frames arrive', () => {
    h.push('a', 10)
    h.push('b', 10)
    h.back()
    expect(h.current).toBe('a')
    h.push('c', 10)
    expect(h.current).toBe('a')
    expect(h.atFrontier).toBe(false)
  })

  it('clamps back at the oldest and forward at the frontier', () => {
    h.push('a', 10)
    expect(h.back()).toBe(false)
    expect(h.forward()).toBe(false)
    h.push('b', 10)
    expect(h.forward()).toBe(true)
    expect(h.forward()).toBe(false)
  })

  // The ring caps BYTES, not frames. `frame_cost_probe` measured λ frames ranging from 5 KB to
  // 781 KB depending only on the program, so a frame count is a memory policy spanning three orders
  // of magnitude.
  it('evicts oldest-first when the byte budget is exceeded', () => {
    for (let i = 0; i < 5; i++) h.push(`f${i}`, 300)
    expect(h.length).toBeLessThan(5)
    expect(h.evicted).toBe(true)
    expect(h.oldestStep).toBeGreaterThan(0)
    expect(h.newestStep).toBe(4)
  })

  it('keeps at least one frame however large it is', () => {
    h.push('huge', 10_000)
    expect(h.length).toBe(1)
    expect(h.current).toBe('huge')
  })

  it('keeps the head pointing at the same frame across an eviction', () => {
    for (let i = 0; i < 3; i++) h.push(`f${i}`, 300)
    h.seek(0)
    const oldest = h.current
    h.push('f3', 300)
    // f0 is gone; the head cannot still point at it, so it clamps to the new oldest and SAYS so.
    expect(h.current).not.toBe(oldest)
    expect(h.head).toBe(0)
    expect(h.oldestStep).toBeGreaterThan(0)
  })

  it('seek clamps rather than throwing', () => {
    h.push('a', 10)
    h.push('b', 10)
    h.seek(-5)
    expect(h.current).toBe('a')
    h.seek(99)
    expect(h.current).toBe('b')
  })

  it('clear resets everything including the step numbering', () => {
    h.push('a', 10)
    h.push('b', 10)
    h.clear()
    expect(h.length).toBe(0)
    expect(h.evicted).toBe(false)
    h.push('x', 10)
    expect(h.oldestStep).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && pnpm run test:node
```
Expected: FAIL — cannot resolve `../../src/history`.

- [ ] **Step 3: Write `history.ts`**

Create `web/src/history.ts`:

```ts
/// A byte-budgeted ring of recorded frames, and the play head that walks it.
///
/// THE BUDGET IS BYTES, NOT FRAMES, and that is measured rather than tasteful. `frame_cost_probe`
/// found a λ frame ranging from ~5 KB to 781 KB across nine programs, so "keep 1,000 frames" is a
/// memory policy spanning three orders of magnitude depending on what the user typed.
///
/// GENERIC OVER THE FRAME, AND SIZING IS THE CALLER'S JOB. `lambdaFrameBytes`/`tmFrameBytes` live in
/// `protocol.ts` beside the budgets they are spent against; this class knows only how to add numbers
/// up. That is also what keeps it DOM-free and node-testable.
export class History<T> {
  #frames: T[] = []
  #sizes: number[] = []
  #bytes = 0
  #budget: number
  /// The step number of `#frames[0]`. Non-zero exactly when something has been evicted.
  #firstStep = 0
  #head = 0
  #following = true
  #evicted = false

  constructor(budgetBytes: number) {
    this.#budget = budgetBytes
  }

  get length(): number {
    return this.#frames.length
  }

  get head(): number {
    return this.#head
  }

  get current(): T | undefined {
    return this.#frames[this.#head]
  }

  /// The step number of the oldest RETAINED frame. §6's contract for scrubbing past the eviction
  /// point is stated in this number: the UI says where history begins rather than pretending it
  /// begins at zero.
  get oldestStep(): number {
    return this.#firstStep
  }

  get newestStep(): number {
    return this.#firstStep + Math.max(0, this.#frames.length - 1)
  }

  get currentStep(): number {
    return this.#firstStep + this.#head
  }

  /// Whether the head sits on the newest frame — so `▶` must ask the worker for more rather than
  /// walking the array.
  get atFrontier(): boolean {
    return this.#frames.length === 0 || this.#head === this.#frames.length - 1
  }

  get evicted(): boolean {
    return this.#evicted
  }

  /// Append a frame. The head FOLLOWS the frontier only while it was already there — a user who has
  /// scrubbed back is not yanked forward by frames still arriving behind them.
  push(frame: T, bytes: number): void {
    this.#frames.push(frame)
    this.#sizes.push(bytes)
    this.#bytes += bytes
    if (this.#following) this.#head = this.#frames.length - 1
    this.#evict()
  }

  /// Drop oldest-first until the budget holds. NEVER DOWN TO ZERO: one frame larger than the whole
  /// budget is still the frame the user is looking at, and an empty pane is a worse answer than an
  /// over-budget one.
  #evict(): void {
    while (this.#bytes > this.#budget && this.#frames.length > 1) {
      this.#frames.shift()
      this.#bytes -= this.#sizes.shift() ?? 0
      this.#firstStep += 1
      this.#evicted = true
      this.#head = Math.max(0, this.#head - 1)
    }
  }

  seek(i: number): void {
    if (this.#frames.length === 0) return
    this.#head = Math.min(Math.max(i, 0), this.#frames.length - 1)
    this.#following = this.#head === this.#frames.length - 1
  }

  back(): boolean {
    if (this.#head <= 0) return false
    this.#head -= 1
    this.#following = false
    return true
  }

  forward(): boolean {
    if (this.#head >= this.#frames.length - 1) return false
    this.#head += 1
    this.#following = this.#head === this.#frames.length - 1
    return true
  }

  clear(): void {
    this.#frames = []
    this.#sizes = []
    this.#bytes = 0
    this.#firstStep = 0
    this.#head = 0
    this.#following = true
    this.#evicted = false
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd web && pnpm run test:node
```
Expected: PASS. Node project: **53 tests** (42 after Task 3, +11 here).

- [ ] **Step 5: Commit**

```bash
git add web/src/history.ts web/tests/node/history.test.ts
git commit -m "web: a byte-budgeted frame ring, because a frame count is not a memory policy"
```

---

### Task 5: `tape.ts` — one tape row from a window

**Files:**
- Create: `web/src/tape.ts`
- Test: `web/tests/node/tape.test.ts`

**Interfaces:**
- Consumes: Task 2's `TmState`
- Produces: `type TapeRow = { label: string; cells: string[]; headIndex: number; headInWindow: boolean }`, `function tapeRows(state: TmState, names: string[]): TapeRow[]`

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/tape.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { tapeRows } from '../../src/tape'
import type { TmState } from '../../src/types'

const NAMES = ['REG', 'WORK', 'STACK', 'HEAP', 'BOX']

const state = (over: Partial<TmState> = {}): TmState => ({
  state: 0,
  step: 0,
  heads: [5],
  window_start: [3],
  window: [['a', 'b', 'c', 'd', 'e']],
  source_node: null,
  ...over,
})

describe('tapeRows', () => {
  // THE ONE PIECE OF ARITHMETIC IN THE TM PANE. `heads` and `window_start` are both
  // MATERIALIZED-TAPE coordinates (viewmodel.rs:108-115), so the head's position inside the window
  // is their difference. Getting it wrong draws the marker on the wrong cell, silently.
  it('places the head at heads[i] - window_start[i]', () => {
    const [row] = tapeRows(state(), NAMES)
    expect(row?.headIndex).toBe(2)
    expect(row?.cells[row.headIndex]).toBe('c')
    expect(row?.headInWindow).toBe(true)
  })

  it('places the head at 0 when the window starts at the head', () => {
    const [row] = tapeRows(state({ heads: [0], window_start: [0] }), NAMES)
    expect(row?.headIndex).toBe(0)
    expect(row?.headInWindow).toBe(true)
  })

  it('reports a head outside the window rather than clamping it', () => {
    // Not expected from `Tape::window`, which centres on the head — but a clamp would HIDE a
    // coordinate bug, and the pane can simply draw no marker.
    const [row] = tapeRows(state({ heads: [99], window_start: [3] }), NAMES)
    expect(row?.headInWindow).toBe(false)
  })

  it('labels each tape from the names it was given', () => {
    const s = state({
      heads: [0, 0, 0, 0, 0],
      window_start: [0, 0, 0, 0, 0],
      window: [['a'], ['b'], ['c'], ['d'], ['e']],
    })
    expect(tapeRows(s, NAMES).map((r) => r.label)).toEqual(NAMES)
  })

  // `tapeNames()` describes machines THIS compiler produced. A hand-written machine (Plan 5d) may
  // declare up to MAX_TAPES, and a positional label is the honest answer past the array's end.
  it('falls back to a positional label past the end of the names', () => {
    const s = state({ heads: [0, 0], window_start: [0, 0], window: [['a'], ['b']] })
    expect(tapeRows(s, ['ONLY']).map((r) => r.label)).toEqual(['ONLY', 'tape 1'])
  })

  it('returns one row per tape in the window, and no rows for none', () => {
    expect(tapeRows(state({ heads: [], window_start: [], window: [] }), NAMES)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && pnpm run test:node
```
Expected: FAIL — cannot resolve `../../src/tape`.

- [ ] **Step 3: Write `tape.ts`**

Create `web/src/tape.ts`:

```ts
import type { TmState } from './types'

export type TapeRow = {
  label: string
  cells: string[]
  /// The head's index INTO `cells`. May fall outside `cells` — see `headInWindow`.
  headIndex: number
  headInWindow: boolean
}

/// A `TmState`'s windows as labelled rows with the head located in each.
///
/// `headIndex = heads[i] - window_start[i]` IS THE WHOLE JOB, and it is here rather than inline in
/// the pane so it can be tested without a DOM. Both quantities are materialized-tape coordinates
/// (`viewmodel.rs:108-115`); neither is window-relative, and treating either as if it were puts the
/// marker on the wrong cell with nothing to notice it.
///
/// AN OUT-OF-WINDOW HEAD IS REPORTED, NOT CLAMPED. `Tape::window` centres on the head so it should
/// not happen; clamping would convert a coordinate bug into a marker that is merely in the wrong
/// place, which is the failure mode this codebase's conventions treat as worse than a visible gap.
export function tapeRows(state: TmState, names: string[]): TapeRow[] {
  return state.window.map((cells, i) => {
    const headIndex = (state.heads[i] ?? 0) - (state.window_start[i] ?? 0)
    return {
      label: names[i] ?? `tape ${i}`,
      cells,
      headIndex,
      headInWindow: headIndex >= 0 && headIndex < cells.length,
    }
  })
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd web && pnpm run test:node
```
Expected: PASS. Node project: **59 tests** (53 after Task 4, +6 here).

- [ ] **Step 5: Commit**

```bash
git add web/src/tape.ts web/tests/node/tape.test.ts
git commit -m "web: tape rows, and the one coordinate subtraction the TM pane depends on"
```

---

### Task 6: `controls.ts` — which controls are live

**Files:**
- Create: `web/src/controls.ts`
- Test: `web/tests/node/controls.test.ts`

**Interfaces:**
- Consumes: Task 3's `RecordEnd`
- Produces: `type LegView`, `type ControlState`, `function controlState(v: LegView): ControlState`

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/controls.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { controlState, type LegView } from '../../src/controls'

const view = (over: Partial<LegView> = {}): LegView => ({
  available: true,
  reason: '',
  head: 0,
  length: 1,
  oldestStep: 0,
  currentStep: 0,
  newestStep: 0,
  evicted: false,
  done: null,
  ...over,
})

describe('controlState', () => {
  it('disables everything for a declined leg and shows the reason', () => {
    const c = controlState(view({ available: false, reason: 'the λ backend does not support unbound `n`', length: 0 }))
    expect(c.canBack).toBe(false)
    expect(c.canForward).toBe(false)
    expect(c.canPlay).toBe(false)
    expect(c.canExtend).toBe(false)
    expect(c.continueLabel).toBeNull()
    expect(c.stepText).toBe('the λ backend does not support unbound `n`')
  })

  it('offers back only once there is somewhere to go back to', () => {
    expect(controlState(view()).canBack).toBe(false)
    expect(controlState(view({ length: 3, head: 1 })).canBack).toBe(true)
  })

  it('offers forward while frames remain ahead of the head', () => {
    expect(controlState(view({ length: 3, head: 1 })).canForward).toBe(true)
    expect(controlState(view({ length: 3, head: 2 })).canForward).toBe(false)
  })

  // `session.rs:415` names this trap one layer in: exhausting a BUDGET leaves the run Running, and
  // only the cursor's own cap yields Capped. Three stop reasons, three different sentences.
  it('words a spent recording budget as free to continue', () => {
    const c = controlState(view({ done: 'budget', length: 500, head: 499, newestStep: 499 }))
    expect(c.canExtend).toBe(true)
    expect(c.continueLabel).toBe('keep recording')
  })

  it('words a spent cursor cap as a cap raise', () => {
    const c = controlState(view({ done: 'capped', length: 500, head: 499, newestStep: 499 }))
    expect(c.canExtend).toBe(true)
    expect(c.continueLabel).toBe('continue — raise the step cap')
  })

  // THE TRAP. `LambdaCursor::raise_cap` refuses to clear `depth_capped` (trace.rs:98,
  // session.rs:76-77), so raising the cap provably cannot help. An affordance here would be a lie
  // the UI tells on the backend's behalf — so there is no affordance at all, not a disabled one.
  it('offers NO continue affordance for a depth refusal', () => {
    const c = controlState(view({ done: 'depth-refused', length: 9, head: 8, newestStep: 8 }))
    expect(c.canExtend).toBe(false)
    expect(c.continueLabel).toBeNull()
    expect(c.stepText).toContain('deeper than')
  })

  it('offers nothing to continue once the run ended', () => {
    const c = controlState(view({ done: 'ended', length: 8, head: 7, newestStep: 7 }))
    expect(c.canExtend).toBe(false)
    expect(c.continueLabel).toBeNull()
  })

  it('reads step N of M while recording is still in flight', () => {
    expect(controlState(view({ length: 5, head: 2, currentStep: 2, newestStep: 4 })).stepText).toBe('step 2 of 4…')
  })

  it('drops the ellipsis once recording finished', () => {
    expect(controlState(view({ done: 'ended', length: 5, head: 2, currentStep: 2, newestStep: 4 })).stepText).toBe(
      'step 2 of 4',
    )
  })

  // Scrubbing past the eviction point must SAY where history begins. The alternatives are lying
  // about where you are, or silently re-deriving at a cost nobody asked for.
  it('names the oldest retained step once frames have been evicted', () => {
    const c = controlState(view({ evicted: true, length: 100, head: 0, oldestStep: 412, currentStep: 412, newestStep: 511 }))
    expect(c.canBack).toBe(false)
    expect(c.stepText).toContain('412')
    expect(c.stepText).toContain('oldest kept')
  })

  it('allows play whenever more than one frame exists', () => {
    expect(controlState(view({ length: 1 })).canPlay).toBe(false)
    expect(controlState(view({ length: 2 })).canPlay).toBe(true)
  })

  it('allows restart whenever any frame exists', () => {
    expect(controlState(view({ length: 0 })).canRestart).toBe(false)
    expect(controlState(view({ length: 1 })).canRestart).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && pnpm run test:node
```
Expected: FAIL — cannot resolve `../../src/controls`.

- [ ] **Step 3: Write `controls.ts`**

Create `web/src/controls.ts`:

```ts
import type { RecordEnd } from './protocol'

/// Everything the control strip needs to know about one leg, and nothing about the DOM.
export type LegView = {
  available: boolean
  reason: string
  head: number
  length: number
  oldestStep: number
  currentStep: number
  newestStep: number
  evicted: boolean
  /// `null` while recording is still in flight.
  done: RecordEnd | null
}

export type ControlState = {
  canBack: boolean
  canForward: boolean
  canPlay: boolean
  canRestart: boolean
  /// Whether asking the worker for more frames would achieve anything.
  canExtend: boolean
  /// The continue button's label, or `null` for NO BUTTON AT ALL.
  continueLabel: string | null
  stepText: string
}

const n = (x: number) => x.toLocaleString('en-US')

/// How the recording stopped, as one line the user can act on.
///
/// THREE STOP REASONS AND THREE SENTENCES, because they are three different facts. A spent recording
/// budget leaves the run `Running` and costs nothing to continue; a spent cursor cap needs the cap
/// raised; and a depth refusal cannot be continued at all. `session.rs:415` records the first
/// distinction one layer in, and `trace.rs:98` records the second.
function doneText(done: RecordEnd): string {
  switch (done) {
    case 'ended':
      return ''
    case 'capped':
      return ' — spent its step budget'
    case 'depth-refused':
      return ' — the term is deeper than the reducer allows'
    case 'budget':
      return ' — history is full'
  }
}

export function controlState(v: LegView): ControlState {
  if (!v.available) {
    return {
      canBack: false,
      canForward: false,
      canPlay: false,
      canRestart: false,
      canExtend: false,
      continueLabel: null,
      stepText: v.reason,
    }
  }

  // `depth-refused` IS ABSENT FROM THIS LIST DELIBERATELY, and it is the one case worth stating out
  // loud: `raise_cap` refuses to clear `depth_capped`, so a continue button would offer something
  // that provably cannot work. No button, rather than a disabled-looking one.
  const continueLabel =
    v.done === 'capped' ? 'continue — raise the step cap' : v.done === 'budget' ? 'keep recording' : null

  const of = v.done === null ? `${n(v.newestStep)}…` : n(v.newestStep)
  const oldest = v.evicted ? ` (oldest kept: step ${n(v.oldestStep)})` : ''
  const stepText = v.length === 0 ? 'not run' : `step ${n(v.currentStep)} of ${of}${doneText(v.done ?? 'ended')}${oldest}`

  return {
    canBack: v.head > 0,
    canForward: v.head < v.length - 1,
    canPlay: v.length > 1,
    canRestart: v.length > 0,
    canExtend: continueLabel !== null,
    continueLabel,
    stepText,
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd web && pnpm run test:node
```
Expected: PASS. Node project: **71 tests** (59 after Task 5, +12 here).

- [ ] **Step 5: Commit**

```bash
git add web/src/controls.ts web/tests/node/controls.test.ts
git commit -m "web: the control state machine, and the depth-refusal trap it exists to hold"
```

---

### Task 7: The worker — lifecycle, record loops, streaming

**Files:**
- Modify: `web/src/session-worker.ts` (full rewrite)
- Test: `web/tests/browser/worker.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 1-3
- Produces: a worker answering `run` with `compiled` → `lambda-frames`* → `tm-frames`* → `result`, and `extend` with further `*-frames`

- [ ] **Step 1: Write the failing test**

Append to `web/tests/browser/worker.test.ts`, and replace the existing `ask` helper with one that collects every reply for a generation:

```ts
/// Collect EVERY reply for one request. PR 3c's worker answered once per generation; this one
/// answers many times, and a helper that resolved on the first message would silently test only the
/// `compiled` reply.
function askAll(req: RunRequest, timeoutMs = 30_000): Promise<{ replies: RunReply[]; worker: Worker }> {
  const worker = new Worker(new URL('../../src/session-worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const replies: RunReply[] = []
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error(`the worker did not finish in time; got ${replies.map((r) => r.kind).join(', ')}`))
    }, timeoutMs)
    worker.addEventListener('message', (e: MessageEvent<RunReply>) => {
      replies.push(e.data)
      if (e.data.kind === 'result' || e.data.kind === 'no-session') {
        clearTimeout(timer)
        resolve({ replies, worker })
      }
    })
    worker.postMessage(req)
  })
}

describe('session-worker recording', () => {
  it('sends compiled first, then frames, then the result', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    expect(replies[0]?.kind).toBe('compiled')
    expect(replies.at(-1)?.kind).toBe('result')
    expect(replies.some((r) => r.kind === 'lambda-frames')).toBe(true)
    expect(replies.some((r) => r.kind === 'tm-frames')).toBe(true)
  })

  it('records a frame per β-step plus the initial term', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    const frames = replies.flatMap((r) => (r.kind === 'lambda-frames' ? r.frames : []))
    // The run is 7 β-steps, so 8 frames: step 0 through step 7.
    expect(frames.length).toBe(8)
    expect(frames[0]?.step).toBe(0)
    expect(frames.at(-1)?.step).toBe(7)
    const last = replies.filter((r) => r.kind === 'lambda-frames').at(-1)
    expect(last?.kind === 'lambda-frames' && last.done).toBe('ended')
  })

  it('sends tmProgram and tapeNames once, on compiled', async () => {
    const { replies, worker } = await askAll(run('let x = 40; x + 2'))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.tapeNames).toEqual(['REG', 'WORK', 'STACK', 'HEAP', 'BOX'])
    expect(compiled?.kind === 'compiled' && compiled.tmProgram?.tapes).toBe(5)
    expect(replies.filter((r) => r.kind === 'compiled').length).toBe(1)
  })

  it('records TM frames from step 0 even though compile already ran the TM leg', async () => {
    const { replies, worker } = await askAll(run('[1, 2]'))
    worker.terminate()
    const frames = replies.flatMap((r) => (r.kind === 'tm-frames' ? r.frames : []))
    expect(frames[0]?.step).toBe(0)
    expect(frames[1]?.step).toBe(1)
    expect(frames.at(-1)?.step).toBeGreaterThan(100)
  })

  // THE DEFECT THAT HID IN PR 3c, one layer further in. `runLambda` threw for a declined leg and the
  // handler never replied; now there are more throwing call sites, and a declined λ leg must still
  // produce a complete TM history.
  it('still records the TM leg when the λ backend declines', async () => {
    const src = 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)'
    const { replies, worker } = await askAll(run(src))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.lambda.available).toBe(false)
    expect(replies.flatMap((r) => (r.kind === 'lambda-frames' ? r.frames : [])).length).toBe(0)
    expect(replies.flatMap((r) => (r.kind === 'tm-frames' ? r.frames : [])).length).toBeGreaterThan(0)
    expect(replies.at(-1)?.kind).toBe('result')
  })

  // `num200` — found by `frame_cost_probe`. The mirror image: a live λ leg and a declined TM leg.
  it('still records the λ leg when the TM backend declines', async () => {
    const { replies, worker } = await askAll(run('let x = 200; x + 1'))
    worker.terminate()
    const compiled = replies.find((r) => r.kind === 'compiled')
    expect(compiled?.kind === 'compiled' && compiled.tm.available).toBe(false)
    expect(replies.flatMap((r) => (r.kind === 'lambda-frames' ? r.frames : [])).length).toBeGreaterThan(0)
    expect(replies.at(-1)?.kind).toBe('result')
  })

  it('frames are rendered at FRAME_BYTES, not the readout budget', async () => {
    const { replies, worker } = await askAll(run('[1, 2, 3]'))
    worker.terminate()
    const frames = replies.flatMap((r) => (r.kind === 'lambda-frames' ? r.frames : []))
    for (const f of frames) expect(f.text.length).toBeLessThanOrEqual(512)
  })
})
```

Add `RunReply` to the file's existing type import.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && pnpm run test:browser
```
Expected: FAIL — the worker answers a single `result` and never a `compiled`.

- [ ] **Step 3: Rewrite `session-worker.ts`**

Replace the whole of `web/src/session-worker.ts` with:

```ts
/// The worker that owns the `Session`.
///
/// THE HANDLE CANNOT LEAVE THIS THREAD. `Session` is an opaque wasm-bindgen object with no serialized
/// form, so the worker owns it and answers questions about it rather than handing it over. That is
/// also why `classifySource` and `analyze` are NOT here: they are free functions, they are what the
/// editor calls on every keystroke, and a round trip per keystroke is exactly the lag this split
/// exists to avoid.
///
/// THE SESSION NOW OUTLIVES ITS MESSAGE, which is the one structural change in this file. PR 3c freed
/// the handle at the end of every request; `[continue]` needs it alive to resume. Exactly one is live
/// at a time and it is freed BEFORE the next compile, which makes the transient two-session window PR
/// 3c's review flagged strictly zero rather than merely bounded.
import init, { compile, tapeNames } from '../../pkg/redextape_wasm.js'
import type { Leg, LambdaLeg, RecordEnd, RunReply, RunRequest, TmLeg } from './protocol'
import {
  EXTEND_CELLS,
  EXTEND_STEPS,
  FRAME_BYTES,
  HISTORY_BYTES,
  LAMBDA_BYTE_BUDGET,
  RECORD_CHUNK,
  TM_RADIUS,
  lambdaFrameBytes,
  tmFrameBytes,
} from './protocol'
import type {
  Decoded,
  Diagnostic,
  LambdaState,
  LambdaStatus,
  RunStatus,
  Span,
  TmProgram,
  TmState,
  TmStatus,
} from './types'

/// The wasm-bindgen `Session`, described structurally — `pkg`'s generated declarations type every
/// method's return as `any`, so the shapes have to be asserted somewhere, and once is here.
type Session = {
  lambdaStatus(): LambdaStatus
  lambdaState(byteBudget: number): LambdaState
  lambdaValue(): Decoded
  stepLambda(): boolean
  raiseLambdaCap(extra: number): void
  tmStatus(): TmStatus
  tmProgram(): TmProgram
  tmState(radius: number): TmState
  stepTm(): boolean
  raiseTmCap(extraSteps: number, extraCells: number): void
  tmValue(): Decoded
  sourceSpan(node: number): Span | null
  free(): void
}

type CompileResult = { diagnostics: Diagnostic[]; session: Session | null }

/// Exactly what this worker uses of its global scope.
///
/// DECLARED RATHER THAN PULLED FROM THE `WebWorker` LIB, because that lib and `DOM` declare `self` and
/// `postMessage` incompatibly and `skipLibCheck` does not reconcile two libs.
type WorkerScope = {
  addEventListener(type: 'message', handler: (e: MessageEvent<RunRequest>) => void): void
  postMessage(message: RunReply): void
}
const ctx = self as unknown as WorkerScope

const ready = init()

/// The newest generation this worker has been asked for.
let latest = 0

/// The ONE live session, with the generation that owns it.
///
/// EVERY SESSION TOUCH GOES THROUGH THIS BINDING, never through a captured reference. A record loop
/// suspended at a yield can resume after its session has been freed; reading `live` each time means
/// it sees `null` (or a newer generation) and returns, instead of calling into a dangling handle and
/// raising "null pointer passed to rust" from a place no caller can see.
let live: { gen: number; session: Session } | null = null

/// Bytes recorded per leg, and the allowance each is spending against. `[continue]` on a `budget`
/// stop buys another `HISTORY_BYTES`; the main thread's ring evicts, so recording further is bounded
/// per click rather than unbounded.
const recorded: Record<Leg, number> = { lambda: 0, tm: 0 }
const allowance: Record<Leg, number> = { lambda: HISTORY_BYTES, tm: HISTORY_BYTES }

function dropLive(): void {
  const held = live
  // NULLED BEFORE FREED, in that order. A suspended loop that wakes between the two must see `null`
  // rather than a freed handle.
  live = null
  held?.session.free()
}

/// One macrotask. `queueMicrotask` would NOT do: a microtask runs before the message queue is drained,
/// so a newer request would never be seen and the abandon check could not fire.
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0))

/// A finished cursor's `RunStatus` as a `RecordEnd`.
///
/// `Running` maps to `ended` and cannot occur: this is only called once `stepLambda`/`stepTm` has
/// answered `false`, which means the cursor is finished. Mapped rather than thrown so a future
/// `RunStatus` variant degrades to a legible label instead of aborting the worker.
function endOf(run: RunStatus | null): RecordEnd {
  switch (run) {
    case 'Capped':
      return 'capped'
    case 'DepthRefused':
      return 'depth-refused'
    default:
      return 'ended'
  }
}

/// Step-and-record the λ leg until it finishes, its allowance runs out, or a newer request lands.
///
/// WRITTEN TWICE RATHER THAN GENERICALLY, and that is a judgement worth recording because it looks
/// like duplication. A generic version needs six callbacks (`available`, `initial`, `step`, `render`,
/// `size`, `status`) plus a `LambdaState | TmState` union that every caller then casts back out of —
/// more machinery than the twenty lines it removes, and it hides the one thing worth seeing: the two
/// loops have the same SHAPE and different MEANINGS. The TM run finished during `compile`, so
/// recording it replays a run whose answer is already known and exhausting its allowance costs
/// history alone. On the λ leg it costs the answer.
async function recordLambda(gen: number, emitInitial: boolean): Promise<void> {
  if (live?.gen !== gen) return
  if (!live.session.lambdaStatus().available) return

  let batch: LambdaState[] = []
  if (emitInitial) {
    const first = live.session.lambdaState(FRAME_BYTES)
    batch.push(first)
    recorded.lambda += lambdaFrameBytes(first)
  }

  for (;;) {
    if (live?.gen !== gen) return
    const s = live.session
    let done: RecordEnd | null = null
    let n = 0
    while (n < RECORD_CHUNK) {
      if (recorded.lambda >= allowance.lambda) {
        done = 'budget'
        break
      }
      if (!s.stepLambda()) {
        done = endOf(s.lambdaStatus().run)
        break
      }
      const f = s.lambdaState(FRAME_BYTES)
      batch.push(f)
      recorded.lambda += lambdaFrameBytes(f)
      n += 1
    }
    ctx.postMessage({ kind: 'lambda-frames', gen, frames: batch, done })
    batch = []
    if (done !== null) return
    await yieldToEventLoop()
  }
}

async function recordTm(gen: number, emitInitial: boolean): Promise<void> {
  if (live?.gen !== gen) return
  if (!live.session.tmStatus().available) return

  let batch: TmState[] = []
  if (emitInitial) {
    const first = live.session.tmState(TM_RADIUS)
    batch.push(first)
    recorded.tm += tmFrameBytes(first)
  }

  for (;;) {
    if (live?.gen !== gen) return
    const s = live.session
    let done: RecordEnd | null = null
    let n = 0
    while (n < RECORD_CHUNK) {
      if (recorded.tm >= allowance.tm) {
        done = 'budget'
        break
      }
      if (!s.stepTm()) {
        done = endOf(s.tmStatus().run)
        break
      }
      const f = s.tmState(TM_RADIUS)
      batch.push(f)
      recorded.tm += tmFrameBytes(f)
      n += 1
    }
    ctx.postMessage({ kind: 'tm-frames', gen, frames: batch, done })
    batch = []
    if (done !== null) return
    await yieldToEventLoop()
  }
}

function lambdaLeg(session: Session): LambdaLeg {
  const status = session.lambdaStatus()
  if (!status.available) {
    // `sourceSpan` IS RESOLVED HERE because the handle cannot leave this thread. A refusal that names
    // a node the main thread cannot look up would highlight nothing.
    const declinedSpan = status.node === null ? null : session.sourceSpan(status.node)
    return { status, state: null, value: null, declinedSpan }
  }
  return {
    status,
    state: session.lambdaState(LAMBDA_BYTE_BUDGET),
    value: session.lambdaValue(),
    declinedSpan: null,
  }
}

function tmLeg(session: Session): TmLeg {
  const status = session.tmStatus()
  if (!status.available) return { status, value: null }
  return { status, value: session.tmValue() }
}

async function onRun(req: Extract<RunRequest, { kind: 'run' }>): Promise<void> {
  await ready
  // FREED BEFORE THE NEXT COMPILE, not after. Two `Session` handles are never simultaneously live.
  dropLive()
  recorded.lambda = 0
  recorded.tm = 0
  allowance.lambda = HISTORY_BYTES
  allowance.tm = HISTORY_BYTES

  // `compile` RUNS THE WHOLE TM LEG and is one uninterruptible call — measured at 0.21-75.44 ms
  // across the demo suite (`frame_cost_probe` section A). Off the main thread that can only delay the
  // next result; it can never block input, highlighting or linting.
  const { diagnostics, session } = compile(req.src, req.encoding) as CompileResult
  if (session === null) {
    ctx.postMessage({ kind: 'no-session', gen: req.gen, diagnostics })
    return
  }
  if (latest !== req.gen) {
    session.free()
    return
  }
  live = { gen: req.gen, session }

  const lambda = session.lambdaStatus()
  const tm = session.tmStatus()
  ctx.postMessage({
    kind: 'compiled',
    gen: req.gen,
    lambda,
    tm,
    declinedSpan: lambda.available || lambda.node === null ? null : session.sourceSpan(lambda.node),
    // GUARDED: `tmProgram` throws `TmAbsent` for a declined leg, and a thrown error inside this async
    // handler rejects it with nothing catching — no reply, and a caller that waits forever. That is
    // exactly the shape of the defect PR 3c's browser tier caught in `drive`.
    tmProgram: tm.available ? session.tmProgram() : null,
    tapeNames: tapeNames() as string[],
  })

  await recordLambda(req.gen, true)
  await recordTm(req.gen, true)

  if (live?.gen !== req.gen) return
  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
}

async function onExtend(req: Extract<RunRequest, { kind: 'extend' }>): Promise<void> {
  if (live?.gen !== req.gen) return
  const s = live.session
  allowance[req.leg] += HISTORY_BYTES

  if (req.leg === 'lambda') {
    // Raising a cap that was not hit is harmless — `raise_cap` is additive — but calling it on a
    // DEPTH-refused cursor is pointless by contract, and this branch is never reached for one:
    // `controls.ts` ships no continue affordance for `depth-refused`, which is why that state has no
    // case here rather than a no-op one.
    if (s.lambdaStatus().run === 'Capped') s.raiseLambdaCap(EXTEND_STEPS)
    await recordLambda(req.gen, false)
  } else {
    if (s.tmStatus().run === 'Capped') s.raiseTmCap(EXTEND_STEPS, EXTEND_CELLS)
    await recordTm(req.gen, false)
  }

  if (live?.gen !== req.gen) return
  ctx.postMessage({ kind: 'result', gen: req.gen, lambda: lambdaLeg(live.session), tm: tmLeg(live.session) })
}

ctx.addEventListener('message', async (e: MessageEvent<RunRequest>) => {
  const req = e.data
  if (req.kind === 'run') {
    latest = req.gen
    await onRun(req)
  } else if (req.kind === 'extend') {
    await onExtend(req)
  }
})
```

- [ ] **Step 4: Run the browser tests**

```bash
cd web && pnpm run test:browser
```
Expected: PASS. Browser project: **19 tests** (12 after Task 2, +7 here).

- [ ] **Step 5: Typecheck and lint**

```bash
cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings src tests
```
Expected: both clean. `main.ts` already carries Task 3's interim guard and needs no change here.

- [ ] **Step 6: Commit**

```bash
git add web/src/session-worker.ts web/tests/browser/worker.test.ts
git commit -m "web: the worker records, streams, and keeps its Session alive between messages"
```

---

### Task 8: `session-client.ts` — many replies per generation

**Files:**
- Modify: `web/src/session-client.ts`
- Test: `web/tests/node/session-client.test.ts` (extend)

**Interfaces:**
- Consumes: Task 3's `RunRequest`, `RunReply`
- Produces: `SessionClient` with `request(src, encoding)`, `extend(leg: Leg)`, and `gen` exposed for the extend path

- [ ] **Step 1: Write the failing test**

Append to `web/tests/node/session-client.test.ts`:

```ts
describe('SessionClient streaming', () => {
  it('delivers every reply for the current generation, not just the first', () => {
    const seen: string[] = []
    const port = fakePort()
    const client = new SessionClient(port, (r) => seen.push(r.kind))
    client.request('x', 'unary')
    port.reply({ kind: 'compiled', gen: 1, lambda: LAMBDA_OK, tm: TM_OK, declinedSpan: null, tmProgram: null, tapeNames: [] })
    port.reply({ kind: 'lambda-frames', gen: 1, frames: [], done: null })
    port.reply({ kind: 'lambda-frames', gen: 1, frames: [], done: 'ended' })
    port.reply({ kind: 'result', gen: 1, lambda: LEG_OK, tm: TM_LEG_OK })
    expect(seen).toEqual(['compiled', 'lambda-frames', 'lambda-frames', 'result'])
  })

  it('drops every reply from a superseded generation', () => {
    const seen: string[] = []
    const port = fakePort()
    const client = new SessionClient(port, (r) => seen.push(r.kind))
    client.request('x', 'unary')
    client.request('y', 'unary')
    port.reply({ kind: 'lambda-frames', gen: 1, frames: [], done: null })
    port.reply({ kind: 'lambda-frames', gen: 2, frames: [], done: null })
    expect(seen).toEqual(['lambda-frames'])
  })

  it('extend addresses the current generation without advancing it', () => {
    const port = fakePort()
    const client = new SessionClient(port, () => {})
    client.request('x', 'unary')
    client.extend('lambda')
    expect(port.sent.at(-1)).toEqual({ kind: 'extend', gen: 1, leg: 'lambda' })
    client.extend('tm')
    expect(port.sent.at(-1)).toEqual({ kind: 'extend', gen: 1, leg: 'tm' })
  })

  it('ignores extend before any request', () => {
    const port = fakePort()
    const client = new SessionClient(port, () => {})
    client.extend('lambda')
    expect(port.sent).toEqual([])
  })
})
```

Add whatever fixtures the file's existing tests use for `fakePort`; if it has none, define at the top of the new `describe`:

```ts
const LAMBDA_OK = { available: true, reason: '', node: null, run: 'Ended' as const }
const TM_OK = { available: true, reason: '', width: 4, run: 'Ended' as const, total_steps: 1 }
const LEG_OK = { status: LAMBDA_OK, state: null, value: null, declinedSpan: null }
const TM_LEG_OK = { status: TM_OK, value: null }

function fakePort() {
  const sent: RunRequest[] = []
  let handler: ((e: { data: RunReply }) => void) | null = null
  return {
    sent,
    postMessage(m: RunRequest) {
      sent.push(m)
    },
    addEventListener(_t: 'message', h: (e: { data: RunReply }) => void) {
      handler = h
    },
    reply(data: RunReply) {
      handler?.({ data })
    },
  }
}
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && pnpm run test:node
```
Expected: FAIL — `client.extend is not a function`.

- [ ] **Step 3: Rewrite `session-client.ts`**

Replace the whole of `web/src/session-client.ts` with:

```ts
import type { Leg, RunReply, RunRequest } from './protocol'

/// What the client needs from a `Worker`, and nothing more.
///
/// AN INTERFACE RATHER THAN `Worker` SO THE RULE BELOW IS TESTABLE. The staleness check is the only
/// logic in this file and it does not need a thread to exercise — it needs an object with two methods.
export type ClientPort = {
  postMessage(m: RunRequest): void
  addEventListener(type: 'message', handler: (e: { data: RunReply }) => void): void
}

export class SessionClient {
  #gen = 0
  #port: ClientPort

  constructor(port: ClientPort, onReply: (r: RunReply) => void) {
    this.#port = port
    port.addEventListener('message', (e) => {
      // THE SECOND OF TWO GUARDS AGAINST THE SAME HAZARD, and both are needed. The worker abandons
      // superseded work at a chunk boundary so it does not compute results nobody wants; this drops
      // a reply that was already in flight when the next request was posted, which the worker's own
      // check cannot see. Generation 0 is "no request yet" and matches nothing.
      //
      // A GENERATION NOW PRODUCES MANY REPLIES — `compiled`, then frame batches, then `result` — so
      // this fires repeatedly and nothing here may treat any one of them as terminal.
      if (this.#gen !== 0 && e.data.gen === this.#gen) onReply(e.data)
    })
  }

  request(src: string, encoding: string): void {
    this.#gen += 1
    this.#port.postMessage({ kind: 'run', gen: this.#gen, src, encoding })
  }

  /// Ask for more frames on one leg. ADDRESSES THE CURRENT GENERATION AND DOES NOT ADVANCE IT: this
  /// continues the run already in the worker, and bumping the generation would abandon the very
  /// session it is trying to extend.
  extend(leg: Leg): void {
    if (this.#gen === 0) return
    this.#port.postMessage({ kind: 'extend', gen: this.#gen, leg })
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd web && pnpm run test:node
```
Expected: PASS. Node project: **75 tests** (71 after Task 6, +4 here).

- [ ] **Step 5: Commit**

```bash
git add web/src/session-client.ts web/tests/node/session-client.test.ts
git commit -m "web: a generation is many replies now, and extend addresses the live one"
```

---

### Task 9: `banner.ts` — the load-failure surface

**Files:**
- Create: `web/src/banner.ts`
- Test: `web/tests/node/banner.test.ts`

**Interfaces:**
- Produces: `function bannerText(e: unknown): string`

- [ ] **Step 1: Write the failing test**

Create `web/tests/node/banner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bannerText } from '../../src/banner'

describe('bannerText', () => {
  it('names the failure when there is a message to name', () => {
    expect(bannerText(new Error('failed to fetch'))).toContain('failed to fetch')
  })

  it('still says something for a thrown non-Error', () => {
    expect(bannerText('boom')).toContain('boom')
    expect(bannerText(null).length).toBeGreaterThan(0)
  })

  it('tells the reader what to do rather than only what broke', () => {
    // PR 3c shipped no failure surface at all, so the failure mode was a blank page and a console
    // message. A banner that only names the exception would be a smaller version of the same problem.
    expect(bannerText(new Error('x'))).toContain('pnpm run build:wasm')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd web && pnpm run test:node
```
Expected: FAIL — cannot resolve `../../src/banner`.

- [ ] **Step 3: Write `banner.ts`**

Create `web/src/banner.ts`:

```ts
/// The failure surface for "the app did not start".
///
/// PR 3c HAD NONE, and named the gap: if the worker or the wasm module fails to load, the page is
/// blank and the only evidence is a console message the user will not open. The design carries this
/// as a §6 row rather than a follow-up ticket because it is three lines and the alternative is a
/// blank page.
///
/// IT NAMES THE FIX, NOT ONLY THE FAULT. By far the most likely cause on a fresh clone is that
/// `pkg/` has never been built, and a message that says only "failed to fetch" sends the reader to
/// the network tab instead of to the one command that fixes it.
export function bannerText(e: unknown): string {
  const detail = e instanceof Error ? e.message : typeof e === 'string' ? e : 'no detail available'
  return `redextape did not start: ${detail}. If this is a fresh clone, run \`cd web && pnpm run build:wasm\` once — the app loads \`pkg/\` from the repo root and it is not checked in.`
}

/// Replace the page with the banner. Separate from `bannerText` so the wording is node-testable and
/// the DOM write is not.
export function showBanner(host: HTMLElement, e: unknown): void {
  const el = document.createElement('div')
  el.className = 'banner'
  el.setAttribute('role', 'alert')
  el.textContent = bannerText(e)
  host.replaceChildren(el)
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd web && pnpm run test:node
```
Expected: PASS. Node project: **78 tests** (75 after Task 8, +3 here).

- [ ] **Step 5: Commit**

```bash
git add web/src/banner.ts web/tests/node/banner.test.ts
git commit -m "web: say so when the app does not start, instead of a blank page"
```

---

### Task 10: The two pane renderers

**Files:**
- Create: `web/src/pane-chrome.ts`
- Create: `web/src/lambda-pane.ts`
- Create: `web/src/tm-pane.ts`

**Interfaces:**
- Consumes: Tasks 2-6, `theme.ts`'s `tokenClassName`, `spans.ts`'s `decorationRanges`
- Produces:
  - `type PaneEvents = { back(): void; forward(): void; play(): void; restart(): void; extend(): void }` and `controlStrip(on: PaneEvents): { el: HTMLElement; update(c: ControlState): void }`, both from `pane-chrome.ts`
  - `class LambdaPane` with `constructor(host: HTMLElement, on: PaneEvents)`, `render(frame: LambdaState | null, controls: ControlState): void`
  - `class TmPane` with `constructor(host: HTMLElement, on: PaneEvents)`, `setProgram(p: TmProgram | null, names: string[]): void`, `render(frame: TmState | null, controls: ControlState): void`

- [ ] **Step 1: Write `lambda-pane.ts`**

There is no node test for this task: both files are DOM writers with no logic of their own — every decision they render was computed and tested in Tasks 4-6. Task 12's browser tier is what exercises them.

Create `web/src/lambda-pane.ts`:

```ts
import type { ControlState } from './controls'
import { controlStrip, type PaneEvents } from './pane-chrome'
import { decorationRanges } from './spans'
import type { LambdaState } from './types'

export type { PaneEvents }

/// The λ pane: the term as text, syntax-coloured by the same token classes the source pane uses.
///
/// TRUNCATION IS SHOWN, NOT HIDDEN. `frame_cost_probe` measured a history frame's budget at 512
/// bytes, two orders below the readout's, so most non-trivial terms WILL truncate here — and a
/// truncated printed term is a prefix of the real one rather than a lie about its shape, which is why
/// showing it beats hiding it. `results.ts` still prints the full normal form at 64 KiB.
export class LambdaPane {
  #text: HTMLElement
  #strip: ReturnType<typeof controlStrip>

  constructor(host: HTMLElement, on: PaneEvents) {
    const title = document.createElement('h2')
    title.textContent = 'lambda'
    this.#text = document.createElement('pre')
    this.#text.className = 'term'
    this.#strip = controlStrip(on)
    host.replaceChildren(title, this.#text, this.#strip.el)
  }

  render(frame: LambdaState | null, controls: ControlState): void {
    this.#strip.update(controls)
    if (frame === null) {
      this.#text.replaceChildren()
      return
    }
    // Spans arrive as byte offsets into THIS frame's own text, so nothing here can be a keystroke
    // behind the way the source pane's can be — but `decorationRanges` sorts and clamps anyway, and
    // reusing it means one implementation of that rule rather than two.
    const ranges = decorationRanges(frame.spans, frame.text.length)
    const out: Node[] = []
    let at = 0
    for (const r of ranges) {
      if (r.from < at) continue
      if (r.from > at) out.push(document.createTextNode(frame.text.slice(at, r.from)))
      const el = document.createElement('span')
      el.className = r.className
      el.textContent = frame.text.slice(r.from, r.to)
      out.push(el)
      at = r.to
    }
    if (at < frame.text.length) out.push(document.createTextNode(frame.text.slice(at)))
    if (frame.truncated) {
      const more = document.createElement('span')
      more.className = 'truncated'
      more.textContent = ' … truncated'
      out.push(more)
    }
    this.#text.replaceChildren(...out)
  }
}
```

- [ ] **Step 2: Write the shared control strip**

Create `web/src/pane-chrome.ts`:

```ts
import type { ControlState } from './controls'

export type PaneEvents = {
  back(): void
  forward(): void
  play(): void
  restart(): void
  extend(): void
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.title = title
  b.addEventListener('click', onClick)
  return b
}

/// The ◀ ▶ ⏵ ↺ strip and its step readout, shared by both panes.
///
/// ONE IMPLEMENTATION, because the two panes' controls are the same controls. `controls.ts` already
/// computed which are live; this file only reflects that, so there is nothing here to get wrong twice.
///
/// THE CONTINUE BUTTON IS ADDED AND REMOVED, NEVER DISABLED. A `depth-refused` leg has no honest
/// continue — `raise_cap` refuses to clear `depth_capped` — and a greyed-out button still tells the
/// user the operation exists.
export function controlStrip(on: PaneEvents): { el: HTMLElement; update(c: ControlState): void } {
  const el = document.createElement('div')
  el.className = 'controls'
  const restart = button('↺', 'back to step 0', on.restart)
  const back = button('◀', 'one step back', on.back)
  const forward = button('▶', 'one step forward', on.forward)
  const play = button('⏵', 'play', on.play)
  const step = document.createElement('span')
  step.className = 'step'
  const extend = button('', 'record further', on.extend)
  extend.className = 'extend'
  el.append(restart, back, forward, play, step, extend)

  return {
    el,
    update(c: ControlState) {
      restart.disabled = !c.canRestart
      back.disabled = !c.canBack
      forward.disabled = !c.canForward
      play.disabled = !c.canPlay
      step.textContent = c.stepText
      if (c.continueLabel === null) {
        extend.hidden = true
      } else {
        extend.hidden = false
        extend.textContent = c.continueLabel
      }
    },
  }
}
```

- [ ] **Step 3: Write `tm-pane.ts`**

Create `web/src/tm-pane.ts`:

```ts
import type { ControlState } from './controls'
import { controlStrip, type PaneEvents } from './pane-chrome'
import { tapeRows } from './tape'
import type { TmProgram, TmState } from './types'

const n = (x: number) => x.toLocaleString('en-US')

/// The TM pane: five tape rows and a status line.
///
/// FIVE ROWS, NOT ONE. §6.1's mockup shows a single tape; the lowering emits `TAPES = 5` and showing
/// them together is the point — you cannot watch STACK move while REG is read otherwise.
///
/// THE STATE TABLE IS 5a-ii, not here. It needs virtualization (146 states for `[1, 2]`) and its
/// second consumer is 5b's click-linking; the status line names the current state in the meantime,
/// which is what `tmProgram().states[id].name` is read for.
export class TmPane {
  #status: HTMLElement
  #tapes: HTMLElement
  #strip: ReturnType<typeof controlStrip>
  #program: TmProgram | null = null
  #names: string[] = []

  constructor(host: HTMLElement, on: PaneEvents) {
    const title = document.createElement('h2')
    title.textContent = 'turing machine'
    this.#status = document.createElement('div')
    this.#status.className = 'tm-status'
    this.#tapes = document.createElement('div')
    this.#tapes.className = 'tapes'
    this.#strip = controlStrip(on)
    host.replaceChildren(title, this.#status, this.#tapes, this.#strip.el)
  }

  /// Set once per compile. `TmProgram` is ~123 states for `let x = 40; x + 2` and does not change as
  /// the cursor moves, which is what the `TmProgram`/`TmState` split exists for.
  setProgram(p: TmProgram | null, names: string[]): void {
    this.#program = p
    this.#names = names
  }

  render(frame: TmState | null, controls: ControlState): void {
    this.#strip.update(controls)
    if (frame === null || this.#program === null) {
      this.#status.textContent = ''
      this.#tapes.replaceChildren()
      return
    }

    // A `StateId` past the end yields no name rather than an index nobody can read — the same
    // no-fallback rule `TmState::source_node` follows one layer in.
    const name = this.#program.states[frame.state]?.name ?? `state ${frame.state}`
    this.#status.textContent = `${name} · width ${n(this.#program.width)}`

    this.#tapes.replaceChildren(
      ...tapeRows(frame, this.#names).map((row) => {
        const el = document.createElement('div')
        el.className = 'tape'
        const label = document.createElement('span')
        label.className = 'tape-label'
        label.textContent = row.label
        const cells = document.createElement('span')
        cells.className = 'cells'
        cells.append(
          ...row.cells.map((c, i) => {
            const cell = document.createElement('span')
            cell.className = i === row.headIndex && row.headInWindow ? 'cell head' : 'cell'
            cell.textContent = c
            return cell
          }),
        )
        el.append(label, cells)
        return el
      }),
    )
  }
}
```

- [ ] **Step 4: Typecheck and lint**

```bash
cd web && pnpm run typecheck && pnpm exec biome ci --error-on-warnings src tests
```
Expected: both clean. `main.ts` does not yet import these, which is fine — Biome's `noUnusedImports` is about imports, not unreferenced modules.

- [ ] **Step 5: Commit**

```bash
git add web/src/lambda-pane.ts web/src/tm-pane.ts web/src/pane-chrome.ts
git commit -m "web: the two pane renderers, and one control strip between them"
```

---

### Task 11: Layout and wiring

**Files:**
- Modify: `web/index.html`
- Modify: `web/src/style.css`
- Modify: `web/src/main.ts` (full rewrite)

**Interfaces:**
- Consumes: every prior task
- Produces: the running app

- [ ] **Step 1: Rewrite the layout**

Replace `web/index.html`'s `<main>` block (lines 17-20) with:

```html
    <main>
      <section id="source" class="pane">
        <h2>source</h2>
        <div id="editor"></div>
      </section>
      <section id="lambda" class="pane"></section>
      <section id="tm" class="pane wide"></section>
      <section id="results" class="pane results wide"></section>
    </main>
```

- [ ] **Step 2: Add the layout and pane styles**

Append to `web/src/style.css`:

```css
/* §6.1's arrangement: source and λ side by side, the TM across the bottom. Two columns because the
   two panes being compared are the two the divergence principle is about; the TM's five tapes need
   the full width and get their own row. */
main {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  align-items: start;
}
.pane.wide {
  grid-column: 1 / -1;
}
.pane h2 {
  font-size: var(--step--1);
  text-transform: lowercase;
  letter-spacing: 0.08em;
  color: var(--fg-dim);
  margin: 0 0 var(--space-2);
}

.term {
  font-family: var(--mono);
  font-size: var(--step--1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  min-height: 6lh;
}
.truncated {
  color: var(--fg-dim);
  font-style: italic;
}

.tm-status {
  font-family: var(--mono);
  font-size: var(--step--1);
  color: var(--fg-dim);
  margin-bottom: var(--space-2);
}

/* Tape rows scroll horizontally INSIDE the pane. A wide tape must never make the page scroll. */
.tapes {
  display: grid;
  gap: var(--space-1);
}
.tape {
  display: grid;
  grid-template-columns: 5ch 1fr;
  gap: var(--space-2);
  align-items: center;
}
.tape-label {
  font-family: var(--mono);
  font-size: var(--step--2);
  color: var(--fg-dim);
  text-align: right;
}
.cells {
  display: flex;
  overflow-x: auto;
  font-family: var(--mono);
}
.cell {
  flex: 0 0 auto;
  min-width: 1.6ch;
  text-align: center;
  padding: 0.1em 0;
  border: 1px solid transparent;
}
.cell.head {
  border-color: currentColor;
  border-radius: var(--radius);
  font-weight: 600;
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.controls button {
  font: inherit;
  font-family: var(--mono);
  padding: 0.15em 0.6em;
  border-radius: var(--radius);
  border: 1px solid var(--fg-dim);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.controls button:disabled {
  opacity: 0.35;
  cursor: default;
}
.controls button[hidden] {
  display: none;
}
.controls .step {
  font-family: var(--mono);
  font-size: var(--step--2);
  color: var(--fg-dim);
}

.banner {
  padding: var(--space-3);
  border: 1px solid currentColor;
  border-radius: var(--radius);
  font-family: var(--mono);
  font-size: var(--step--1);
}
```

If any of `--space-1`, `--space-3`, `--step--2`, `--mono` or `--fg-dim` is not declared in `style.css`'s existing `:root`, use the nearest token that is, or add the missing one beside its siblings — **do not invent a parallel scale.** `--step-2`, `--space-4` and `--radius` were declared in PR 3c and consumed by nothing; `--radius` is now used here. If `--step-2` and `--space-4` are still unused after this task, delete them: the design's §4.1 says they may not be carried a second time.

- [ ] **Step 3: Rewrite `main.ts`**

Replace the whole of `web/src/main.ts` with:

```ts
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view'
import init, { analyze, classifySource, encodings } from '../../pkg/redextape_wasm.js'
import { showBanner } from './banner'
import { controlState } from './controls'
import { declineMark, highlighting, setDecline, setSpans } from './highlight'
import { History } from './history'
import { LambdaPane } from './lambda-pane'
import { lintFromAnalyze } from './lint'
import type { Leg, RecordEnd, RunReply } from './protocol'
import { lambdaFrameBytes, HISTORY_BYTES, tmFrameBytes } from './protocol'
import type { Row } from './results'
import { noSessionRows, resultRows } from './results'
import { SessionClient } from './session-client'
import { TmPane } from './tm-pane'
import type { Classified, Diagnostic, LambdaState, LambdaStatus, TmState, TmStatus } from './types'

const DEBOUNCE_MS = 300
const SAMPLE = 'let x = 40; x + 2'
/// Frames per second during playback. A main-thread rAF walk over recorded frames — it never touches
/// wasm, which is the whole reason the history lives on this side.
const PLAY_MS = 120

function renderRows(host: HTMLElement, rows: Row[]): void {
  host.replaceChildren(
    ...rows.map((r) => {
      const el = document.createElement('div')
      el.className = 'row'
      const leg = document.createElement('span')
      leg.className = 'leg'
      leg.textContent = r.leg
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = r.label
      const value = document.createElement('span')
      value.className = 'value'
      value.textContent = r.value
      if (r.note) {
        const note = document.createElement('div')
        note.className = 'note'
        note.textContent = r.note
        value.append(note)
      }
      el.append(leg, label, value)
      return el
    }),
  )
}

/// One leg's live state on this side of the boundary: its history, how recording ended, and what the
/// worker said about it at compile time.
type LegState<T> = {
  hist: History<T>
  status: { available: boolean; reason: string }
  done: RecordEnd | null
  timer: ReturnType<typeof setInterval> | null
}

async function main(): Promise<EditorView> {
  const results = document.querySelector<HTMLElement>('#results')
  const editorHost = document.querySelector<HTMLElement>('#editor')
  const lambdaHost = document.querySelector<HTMLElement>('#lambda')
  const tmHost = document.querySelector<HTMLElement>('#tm')
  const picker = document.querySelector<HTMLSelectElement>('#encoding')
  const root = document.querySelector<HTMLElement>('main')
  if (!results || !editorHost || !lambdaHost || !tmHost || !picker || !root) {
    throw new Error('the page is missing a mount point')
  }

  // THE ONE PLACE THE APP CAN FAIL TO START. `init()` fetches the wasm; a worker constructed against
  // a missing module fails the same way. PR 3c had no surface for either and the failure was a blank
  // page.
  try {
    await init()
  } catch (e) {
    showBanner(root, e)
    throw e
  }

  for (const name of encodings() as string[]) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    picker.append(opt)
  }

  let view: EditorView

  const lam: LegState<LambdaState> = {
    hist: new History<LambdaState>(HISTORY_BYTES),
    status: { available: false, reason: '' },
    done: null,
    timer: null,
  }
  const tm: LegState<TmState> = {
    hist: new History<TmState>(HISTORY_BYTES),
    status: { available: false, reason: '' },
    done: null,
    timer: null,
  }

  const draw = () => {
    lambdaPane.render(
      lam.hist.current ?? null,
      controlState({
        available: lam.status.available,
        reason: lam.status.reason,
        head: lam.hist.head,
        length: lam.hist.length,
        oldestStep: lam.hist.oldestStep,
        currentStep: lam.hist.currentStep,
        newestStep: lam.hist.newestStep,
        evicted: lam.hist.evicted,
        done: lam.done,
      }),
    )
    tmPane.render(
      tm.hist.current ?? null,
      controlState({
        available: tm.status.available,
        reason: tm.status.reason,
        head: tm.hist.head,
        length: tm.hist.length,
        oldestStep: tm.hist.oldestStep,
        currentStep: tm.hist.currentStep,
        newestStep: tm.hist.newestStep,
        evicted: tm.hist.evicted,
        done: tm.done,
      }),
    )
  }

  /// Playback is an interval over recorded frames and stops at the frontier. It never asks the worker
  /// for more — `▶` at the frontier does that, deliberately, so play cannot run away with a cap raise
  /// nobody clicked.
  const play = <T>(leg: LegState<T>) => {
    if (leg.timer !== null) {
      clearInterval(leg.timer)
      leg.timer = null
      return
    }
    leg.timer = setInterval(() => {
      if (!leg.hist.forward()) {
        if (leg.timer !== null) clearInterval(leg.timer)
        leg.timer = null
      }
      draw()
    }, PLAY_MS)
  }

  const events = <T>(leg: LegState<T>, which: Leg) => ({
    back: () => {
      leg.hist.back()
      draw()
    },
    forward: () => {
      // At the frontier `▶` means "record one more", which is the same operation as `[continue]`.
      if (!leg.hist.forward() && leg.done !== null && leg.done !== 'ended' && leg.done !== 'depth-refused') {
        client.extend(which)
      }
      draw()
    },
    play: () => play(leg),
    restart: () => {
      leg.hist.seek(0)
      draw()
    },
    extend: () => client.extend(which),
  })

  const worker = new Worker(new URL('./session-worker.ts', import.meta.url), { type: 'module' })
  // THE SECOND HALF OF §6's LOAD-FAILURE ROW, and it is not the same failure as `init()`'s. A worker
  // whose module fails to load does not throw from the constructor — it fires `error` on the handle,
  // asynchronously, and nothing else in this file would ever hear it. Without this the pane sits on
  // "running…" forever, which is the same blank-page problem one layer in.
  worker.addEventListener('error', (e) => showBanner(root, e instanceof ErrorEvent ? e.error ?? e.message : e))
  const client = new SessionClient(worker, (reply: RunReply) => onReply(reply))
  const lambdaPane = new LambdaPane(lambdaHost, events(lam, 'lambda'))
  const tmPane = new TmPane(tmHost, events(tm, 'tm'))

  const resetLegs = (lambda: LambdaStatus | null, tmStatus: TmStatus | null) => {
    for (const leg of [lam, tm]) {
      leg.hist.clear()
      leg.done = null
      if (leg.timer !== null) clearInterval(leg.timer)
      leg.timer = null
    }
    lam.status = { available: lambda?.available ?? false, reason: lambda?.reason ?? '' }
    tm.status = { available: tmStatus?.available ?? false, reason: tmStatus?.reason ?? '' }
  }

  function onReply(reply: RunReply): void {
    switch (reply.kind) {
      case 'no-session':
        results.dataset.state = 'idle'
        renderRows(results, noSessionRows(reply.diagnostics))
        // STALE FRAMES MUST NOT SURVIVE A BROKEN PROGRAM. A pane still showing the last good run
        // under source that does not compile is the worst of both answers.
        resetLegs(null, null)
        tmPane.setProgram(null, [])
        view.dispatch({ effects: setDecline.of(null) })
        draw()
        return
      case 'compiled':
        resetLegs(reply.lambda, reply.tm)
        tmPane.setProgram(reply.tmProgram, reply.tapeNames)
        view.dispatch({ effects: setDecline.of(reply.declinedSpan) })
        draw()
        return
      case 'lambda-frames':
        for (const f of reply.frames) lam.hist.push(f, lambdaFrameBytes(f))
        lam.done = reply.done
        draw()
        return
      case 'tm-frames':
        for (const f of reply.frames) tm.hist.push(f, tmFrameBytes(f))
        tm.done = reply.done
        draw()
        return
      case 'result':
        results.dataset.state = 'idle'
        renderRows(results, resultRows(reply.lambda, reply.tm))
        return
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = (src: string) => {
    clearTimeout(timer)
    results.dataset.state = 'running'
    timer = setTimeout(() => client.request(src, picker.value), DEBOUNCE_MS)
  }

  // The picker is otherwise inert: `schedule` only reads `picker.value` when a keystroke's update
  // listener calls it, so choosing a different encoding would sit unused until the user typed again.
  picker.addEventListener('change', () => schedule(view.state.doc.toString()))

  view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: SAMPLE,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        highlighting,
        declineMark,
        lintGutter(),
        lintFromAnalyze((src) => analyze(src) as Diagnostic[]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const src = u.state.doc.toString()
          // Synchronous, in the same frame as the keystroke. This is the whole reason `classifySource`
          // is not behind the worker.
          u.view.dispatch({ effects: setSpans.of(classifySource(src) as Classified) })
          schedule(src)
        }),
      ],
    }),
  })

  view.dispatch({ effects: setSpans.of(classifySource(SAMPLE) as Classified) })
  schedule(SAMPLE)
  draw()
  return view
}

/// The app starts on import — `index.html` loads this module and nothing else.
///
/// THE VIEW IS EXPORTED AS A PROMISE so the browser tests can drive the editor through CodeMirror's own
/// API rather than synthesizing key events into a contenteditable. Nothing in the product reads it.
export const ready = main()
```

`draw`, `lambdaPane` and `tmPane` are referenced before their `const` declarations inside `draw`'s body — that is legal because `draw` is not *called* until after they are initialised. If Biome's `noInvalidUseBeforeDeclaration` objects, move the `lambdaPane`/`tmPane`/`client`/`worker` block above `draw` and pass `draw` in as a thunk.

- [ ] **Step 4: Run everything**

```bash
cd web && pnpm exec biome ci --error-on-warnings src tests && pnpm run typecheck && pnpm test
```
Expected: all green. Node **78**, browser **19**.

- [ ] **Step 5: Look at it**

```bash
cd web && pnpm run dev
```
Open the printed URL. Confirm by eye, and write down what you see for the progress ledger:
1. Three panes plus the readout, and the TM pane shows **five labelled tape rows** with a boxed head cell.
2. `◀` and `▶` move the λ term and the tape independently, and the step readout tracks.
3. `⏵` plays and stops at the end.
4. `↺` returns to step 0.
5. Typing `let x = ;` clears both panes rather than leaving the last good run on screen.
6. `let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)` leaves the TM pane steppable while the λ pane shows its refusal.
7. `let x = 200; x + 1` is the mirror image — a live λ pane and a declined TM pane.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/src/style.css web/src/main.ts
git commit -m "web: three panes, wired to a history the main thread owns"
```

---

### Task 12: The browser tier, and the boundary measurement

**Files:**
- Modify: `web/tests/browser/app.test.ts`
- Create: `web/tests/browser/frame-cost.test.ts`

**Interfaces:**
- Consumes: everything

- [ ] **Step 1: Write the end-to-end tests**

Append to `web/tests/browser/app.test.ts`. Read the file's existing helpers first — it already imports `ready` from `../../src/main` and waits on the results pane; reuse those rather than writing new ones.

```ts
describe('stepping', () => {
  const paneText = (id: string) => document.querySelector(`#${id} .term`)?.textContent ?? ''
  const stepText = (id: string) => document.querySelector(`#${id} .step`)?.textContent ?? ''
  const click = (id: string, label: string) => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(`#${id} .controls button`)].find(
      (x) => x.textContent === label,
    )
    b?.click()
    return b
  }

  it('steps the λ pane back and shows the same text it showed before', async () => {
    const view = await ready
    await settled(view, 'let x = 40; x + 2')
    // Recording finished, so the head sits on step 7.
    expect(stepText('lambda')).toContain('step 7')
    const atSeven = paneText('lambda')
    click('lambda', '◀')
    const atSix = paneText('lambda')
    expect(atSix).not.toBe(atSeven)
    click('lambda', '▶')
    expect(paneText('lambda')).toBe(atSeven)
  })

  it('shows five labelled tape rows with the head inside the window', async () => {
    const view = await ready
    await settled(view, 'let x = 40; x + 2')
    const labels = [...document.querySelectorAll('#tm .tape-label')].map((e) => e.textContent)
    expect(labels).toEqual(['REG', 'WORK', 'STACK', 'HEAP', 'BOX'])
    expect(document.querySelectorAll('#tm .cell.head').length).toBe(5)
  })

  it('clears both panes when the program stops compiling', async () => {
    const view = await ready
    await settled(view, 'let x = 40; x + 2')
    expect(paneText('lambda')).not.toBe('')
    await settled(view, 'let x = ;')
    expect(paneText('lambda')).toBe('')
    expect(document.querySelectorAll('#tm .tape').length).toBe(0)
  })

  // THE DEFECT CLASS THAT HID IN PR 3c, at the UI layer this time.
  it('leaves the TM pane steppable when the λ backend declines', async () => {
    const view = await ready
    await settled(view, 'let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)')
    expect(stepText('lambda')).toContain('does not support')
    expect(document.querySelectorAll('#tm .tape').length).toBe(5)
    expect(click('tm', '◀')?.disabled).toBe(false)
  })

  it('leaves the λ pane steppable when the TM backend declines', async () => {
    const view = await ready
    await settled(view, 'let x = 200; x + 1')
    expect(document.querySelectorAll('#tm .tape').length).toBe(0)
    expect(paneText('lambda')).not.toBe('')
  })

  // `raise_cap` refuses to clear `depth_capped`, so a continue button here would offer something that
  // provably cannot work. There must be no button, not a disabled one.
  it('offers no continue affordance once a run has ended', async () => {
    const view = await ready
    await settled(view, 'let x = 40; x + 2')
    const extend = document.querySelector<HTMLButtonElement>('#lambda .controls .extend')
    expect(extend?.hidden).toBe(true)
  })

  it('restart returns to step 0 and forward walks out again', async () => {
    const view = await ready
    await settled(view, 'let x = 40; x + 2')
    click('lambda', '↺')
    expect(stepText('lambda')).toContain('step 0')
    click('lambda', '▶')
    expect(stepText('lambda')).toContain('step 1')
  })
})
```

If `app.test.ts` has no `settled(view, src)` helper, add one: dispatch a full-document replacement through `view.dispatch`, then poll until `#results` has `dataset.state === 'idle'` and the pane has content, with a 30 s cap.

- [ ] **Step 2: Write the boundary measurement**

Create `web/tests/browser/frame-cost.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import init, { compile } from '../../../pkg/redextape_wasm.js'
import { FRAME_BYTES, lambdaFrameBytes, SPAN_BYTES } from '../../src/protocol'
import type { LambdaState } from '../../src/types'

type Session = { stepLambda(): boolean; lambdaState(b: number): LambdaState; free(): void }

/// THE HALF `frame_cost_probe` COULD NOT MEASURE. That probe timed the Rust: `print_lambda_capped`
/// plus classification, 4-7 us/step at `FRAME_BYTES`. The real path adds `serde_wasm_bindgen`
/// building a JS object per frame AND PER SPAN, and the probe's headline finding was that spans are
/// ~95% of a frame — so this is where that finding either holds or does not.
///
/// IT ASSERTS A CEILING, NOT A FIGURE. A timing assertion pinned to one machine is a flaky test; what
/// this protects is the design decision — that recording a frame per step is affordable at all.
describe('frame cost at the boundary', () => {
  it('renders a λ frame in well under a millisecond', async () => {
    await init()
    const { session } = compile('let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc', 'unary') as {
      session: Session | null
    }
    expect(session).not.toBeNull()
    if (!session) return

    let frames = 0
    let bytes = 0
    const t0 = performance.now()
    while (session.stepLambda() && frames < 400) {
      const f = session.lambdaState(FRAME_BYTES)
      bytes += lambdaFrameBytes(f)
      frames += 1
    }
    const perFrame = (performance.now() - t0) / Math.max(frames, 1)
    session.free()

    // eslint-disable-next-line no-console -- the number is the point; the assertion is only a floor.
    console.log(`boundary: ${frames} frames, ${perFrame.toFixed(3)} ms/frame, ${Math.round(bytes / frames)} B/frame`)
    expect(frames).toBeGreaterThan(100)
    expect(perFrame).toBeLessThan(1)
    // `SPAN_BYTES` is the one estimate in `protocol.ts` that is not measured in the units it is spent
    // in. If a frame's real size is wildly under our estimate the ring evicts far too early.
    expect(bytes / frames).toBeGreaterThan(SPAN_BYTES)
  })
})
```

- [ ] **Step 3: Run the full suite and record the number**

```bash
cd web && pnpm test
```
Expected: all green. Node **78**, browser **27** (19 after Task 7, +7 in `app.test.ts`, +1 here).

**Write the `boundary:` line from the console into the progress ledger.** It is the figure the design's §8 "still unmeasured" section is waiting for, and it decides whether `HISTORY_BYTES` and `SPAN_BYTES` stand. If ms/frame exceeds ~0.1, say so — recording a frame per step would then cost more in the browser than the Rust measurement predicted, and `RECORD_CHUNK` needs revisiting before this lands.

- [ ] **Step 4: Run the whole gate**

```bash
scripts/check-all.sh --no-llvm
PATH="$PATH:/usr/sbin" wasm-pack test --headless --chrome crates/redextape-wasm
cd web && pnpm exec biome ci --error-on-warnings src tests && pnpm run typecheck && pnpm test && pnpm run build
pre-commit run --all-files
```
Expected: every command green. Record the actual test counts and the `pkg/redextape_wasm_bg.wasm` byte size against PR #16's **608,037** — the delta is `tapeNames()` and should be small.

- [ ] **Step 5: Commit**

```bash
git add web/tests/browser/app.test.ts web/tests/browser/frame-cost.test.ts
git commit -m "web: the browser tier for stepping, and the boundary cost the Rust probe could not reach"
```

---

### Task 13: The record — README and the roadmap entry

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-19-redextape-roadmap.md`
- Modify: `docs/superpowers/specs/2026-08-07-plan5a-panes-and-history-design.md`

- [ ] **Step 1: Update the design's open risks**

§11 risk 3 says the boundary cost of a frame is unmeasured. Task 12 measured it. Strike the risk in place with the measured figure beside it, following the file's own convention — the design's §3.2 shows the form: name what the claim was, then what the measurement said. **Do not delete the original sentence.**

- [ ] **Step 2: Update `README.md`**

Read the existing web section first. Three things must become true rather than aspirational: the app has three panes rather than one, both legs are steppable forward and backward, and the ninth export exists. Keep the fresh-clone instructions as they are — `pnpm install && pnpm run build:wasm` is unchanged.

- [ ] **Step 3: Add the roadmap entry**

Append a Plan 5a-i entry in the same voice as the PR 3c entry above it (`grep -n "PLAN 4'S CONSUMER SLICE CLOSES" docs/superpowers/plans/2026-07-19-redextape-roadmap.md` to find the model). It must record, at minimum:

- **Plan 5 decomposed into 5a-5e**, and that 5c is blocked on a λ redex→source coordinate system that survives reduction — `LambdaState.source_node` was removed for that reason (`viewmodel.rs:36-55`), so §6.2's dual focus is half-buildable.
- **The design's own frame-size claim was falsified by the probe written to check it.** `LAMBDA_BYTE_BUDGET` bounds `text` and not `spans`; the largest measured frame was **781,038 bytes** against a claimed 64 KB, and spans are ~95% of a frame at every budget.
- **`FRAME_BYTES = 512`**, two orders of magnitude below the readout's budget: 10-31× faster to render and ~22× smaller.
- **The TM leg's constraint is step count, not frame cost** — `map_fold` is 266,863 δ-steps against 555 β-steps for the same program, which is why `RECORD_BUDGET` is derived from `HISTORY_BYTES` rather than being a step figure.
- **`compile()` is 0.21-75.44 ms**, closing PR 3c's open risk 1 and leaving §10's terminate-on-supersede rejected.
- **The two-session window closed rather than widened.** The design predicted it would lengthen; freeing before the next compile makes it zero.
- **The ninth export, `tapeNames()`**, and the limit it states about hand-written machines.
- **The gate:** the counts and the wasm byte size from Task 12 Step 4.
- **What 5a-ii still owes:** the `lambdaAst` arena verdict and the virtualized state table.

- [ ] **Step 4: Verify the whole gate one last time**

```bash
scripts/check-all.sh --no-llvm
PATH="$PATH:/usr/sbin" wasm-pack test --headless --chrome crates/redextape-wasm
cd web && pnpm exec biome ci --error-on-warnings src tests && pnpm run typecheck && pnpm test && pnpm run build
pre-commit run --all-files
```
Expected: every command green.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/plans/2026-07-19-redextape-roadmap.md \
        docs/superpowers/specs/2026-08-07-plan5a-panes-and-history-design.md
git commit -m "docs: the Plan 5a-i record, and the risk the browser tier closed"
```

---

## Verification

Before opening the PR, all of these must be true and observed rather than assumed:

- [ ] `scripts/check-all.sh --no-llvm` green
- [ ] `wasm-pack test --headless --chrome crates/redextape-wasm` — 13/13
- [ ] `cd web && pnpm test` — node **78**, browser **27**
- [ ] `cd web && pnpm run typecheck` green
- [ ] `cd web && pnpm exec biome ci --error-on-warnings src tests` green
- [ ] `cd web && pnpm run build` writes `web/dist/`
- [ ] `pre-commit run --all-files` green
- [ ] The app looked at by eye (Task 11 Step 5), all seven checks
- [ ] The boundary ms/frame figure recorded in the ledger (Task 12 Step 3)
- [ ] The wasm bundle size recorded against PR #16's 608,037 bytes
- [ ] `--step-2` and `--space-4` either used or deleted (Task 11 Step 2)

**The `docker` job is armed and PR-exempt.** `ci.yml` gates it on `github.event_name != 'pull_request'`, so a Dockerfile change lands on `main` untested. This plan changes no Dockerfile — but if one ends up touched, build it locally before merging, because CI will not.
